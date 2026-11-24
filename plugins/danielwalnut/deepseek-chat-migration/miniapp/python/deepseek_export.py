"""DeepSeek official export reader for the DeepSeek Chat Migration Mini App. Python 3.9+.

Source layout (DeepSeek web "export data", export_format_version 3), either the
downloaded zip itself or a folder it was unpacked into:
  manifest.json                    {"export_format_version": 3}
  user.json                        account record; only user_id is read (stable identity)
  chat_session_index.json          [{id, title, pinned, message_count, inserted_at, updated_at}]
  chat_sessions/<id>.json          {id, title, pinned, current_message_id, inserted_at,
                                    updated_at, messages[]}
  chat_sessions/<id>_files/...     uploaded attachment bytes (never copied)

Each message is a tree node {id, parent_id, role USER|ASSISTANT, status, fragments[]}.
Regenerated answers and edited questions are sibling branches; the branch the user
last looked at ends at current_message_id. This module only reads and normalizes. It
emits the ZCode-shaped item the shared `migrate.convert` consumes:

  REQUEST                   -> user text
  RESPONSE / TEMPLATE_RESPONSE -> assistant text
  THINK                     -> reasoning part (display only, never model context)
  TOOL_SEARCH               -> read-only historical tool record (queries + results)
  CONTENT_RISK              -> labeled text notice
  FILE                      -> attachment reference; bytes are not copied
  status != FINISHED        -> historical error note on that message

Only the active branch (root to current_message_id) is shown and becomes model
context, matching what DeepSeek displayed last; regenerated answers and edited
questions on other branches stay in the per-session source archive.
The zip is never extracted or modified. Sessions have no working directory: they
are associated with the `~/DeepSeek` workspace project unless --workspace is given.
Adapted from the DeepSeek source written for agent-session-migration; ids and
fingerprints are identical so either tool recognizes the other's imports.
"""

import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from deepseek_core import MigrationError, digest, is_link

FORMAT_VERSION = 3
MAX_ENTRY = (
    64 * 1024 * 1024
)  # per JSON entry; larger entries are refused, not truncated
MAX_TEXT = 1024 * 1024  # per text field; longer values are truncated with a marker
WORKSPACE_NAME = "DeepSeek"
TEXT_FRAGMENTS = {"REQUEST", "RESPONSE", "TEMPLATE_RESPONSE"}
SEARCH_RESULT_KEYS = ("title", "url", "site_name", "published_at", "snippet")


def ms(value, fallback=0):
    """ISO-8601 or epoch -> unix milliseconds. Degrades to fallback, never raises."""
    if isinstance(value, bool):
        return fallback
    if isinstance(value, (int, float)):
        number = int(value)
        return number if number > 10_000_000_000 else number * 1000
    if not isinstance(value, str) or not value:
        return fallback
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return fallback
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp() * 1000)


def clip(text, counter=None):
    if not isinstance(text, str):
        return text
    if len(text) > MAX_TEXT:
        if counter is not None:
            counter[0] += 1
        return text[:MAX_TEXT] + "\n[truncated by migration]"
    return text


def default_workspace():
    return str(Path.home() / WORKSPACE_NAME)


class Export:
    """Read-only view over the zip or its unpacked folder."""

    def __init__(self, root):
        self.root = root
        self.zip = zipfile.ZipFile(root) if root.is_file() else None

    def close(self):
        if self.zip is not None:
            self.zip.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def names(self):
        if self.zip is not None:
            return [i.filename for i in self.zip.infolist() if not i.is_dir()]
        base = self.root / "chat_sessions"
        found = ["manifest.json", "user.json", "chat_session_index.json"]
        if base.is_dir() and not is_link(base):
            found += [
                "chat_sessions/" + p.name
                for p in base.iterdir()
                if p.is_file() and not is_link(p)
            ]
        return found

    def size(self, name):
        if self.zip is not None:
            try:
                return self.zip.getinfo(name).file_size
            except KeyError:
                return None
        path = self.root / name
        return path.stat().st_size if path.is_file() and not is_link(path) else None

    def has(self, name):
        if self.zip is not None:
            try:
                self.zip.getinfo(name)
                return True
            except KeyError:
                return False
        path = self.root / name
        return path.exists() and not is_link(path)

    def json(self, name, required=True):
        size = self.size(name)
        if size is None:
            if required:
                raise MigrationError("DeepSeek export is missing " + name)
            return None
        if size > MAX_ENTRY:
            raise MigrationError("Oversized DeepSeek export entry: " + name)
        try:
            if self.zip is not None:
                raw = self.zip.read(name)
            else:
                raw = (self.root / name).read_bytes()
            return json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError, zipfile.BadZipFile) as exc:
            raise MigrationError("Malformed JSON in DeepSeek export: " + name) from exc


def source_path(value=None):
    """The DeepSeek source is the official export zip (or its unpacked folder)."""
    if not value:
        raise MigrationError(
            "DeepSeek requires --source <deepseek_data-*.zip or unpacked export folder>"
        )
    root = Path(value).expanduser().absolute()
    if is_link(root) or not (root.is_file() or root.is_dir()):
        raise MigrationError(
            "DeepSeek export must be an existing non-symlink zip file or folder: "
            + str(root)
        )
    root = root.resolve()
    if root.is_file() and not zipfile.is_zipfile(root):
        raise MigrationError("DeepSeek export file is not a zip archive: " + str(root))
    with Export(root) as export:
        manifest = export.json("manifest.json")
        if not isinstance(manifest, dict):
            raise MigrationError("Invalid DeepSeek manifest.json")
        version = manifest.get("export_format_version")
        if version != FORMAT_VERSION:
            raise MigrationError(
                "Unsupported DeepSeek export_format_version: %r (supported: %d)"
                % (version, FORMAT_VERSION)
            )
    return root


def identity_root(source):
    """Stable target identity across re-uploads of the same account's exports.

    The Mini App stores every uploaded zip under a fresh temporary path; keying target
    identity on that path would let the same conversation import twice. The account
    id is hashed into the target id and never written in clear text.
    """
    with Export(source) as export:
        user = export.json("user.json", required=False)
    uid = user.get("user_id") if isinstance(user, dict) else None
    if isinstance(uid, (str, int)) and not isinstance(uid, bool) and str(uid):
        return "deepseek-account:" + str(uid)
    return str(source.resolve())


def session_entry(sid):
    if (
        not isinstance(sid, str)
        or not sid
        or len(sid) > 256
        or any(c in sid for c in "/\\\0")
        or sid in (".", "..")
    ):
        raise MigrationError("Invalid DeepSeek session identity: " + repr(sid)[:80])
    return "chat_sessions/" + sid + ".json"


def discover(export, errors=None):
    """Index ids plus any session files the index omits. Returns {id: index row}."""
    index = export.json("chat_session_index.json")
    if not isinstance(index, list):
        raise MigrationError("Invalid DeepSeek chat_session_index.json")
    rows, duplicates = {}, set()
    for row in index:
        if not isinstance(row, dict):
            raise MigrationError("Invalid DeepSeek chat_session_index.json row")
        sid = row.get("id")
        session_entry(sid)
        if sid in rows:
            duplicates.add(sid)
        rows[sid] = row
    for name in export.names():
        if (
            name.startswith("chat_sessions/")
            and name.endswith(".json")
            and name.count("/") == 1
        ):
            sid = name[len("chat_sessions/") : -len(".json")]
            if sid and sid not in rows:
                rows[sid] = {"id": sid}
    for sid in sorted(duplicates):
        error = "Duplicate DeepSeek session identity in index: " + sid
        if errors is None:
            raise MigrationError(error)
        errors.append({"sourceId": sid, "error": error})
        rows.pop(sid, None)
    return rows


def active_branch(session, by_id):
    """current_message_id -> root, returned root-first. Cycles and gaps fail closed."""
    current = session.get("current_message_id")
    chain, seen = [], set()
    while current is not None:
        if current in seen:
            raise MigrationError("DeepSeek message tree has a cycle")
        if current not in by_id:
            raise MigrationError(
                "DeepSeek current branch references a missing message: " + str(current)
            )
        seen.add(current)
        chain.append(current)
        current = by_id[current].get("parent_id")
    chain.reverse()
    return chain


def search_output(results):
    lines = []
    for number, result in enumerate(results or [], 1):
        if not isinstance(result, dict):
            continue
        # site_icon is an image URL/payload with no reading value; it is not migrated.
        head = "[%d] %s" % (number, result.get("title") or "")
        body = [head.rstrip()]
        for key in SEARCH_RESULT_KEYS[1:]:
            value = result.get(key)
            if value not in (None, ""):
                body.append("%s: %s" % (key, value))
        lines.append("\n".join(body))
    return "\n\n".join(lines)


def read_session(export, sid, index_row=None):
    """One DeepSeek session -> (session meta, normalized messages, histories, warnings)."""
    name = session_entry(sid)
    raw = export.json(name)
    if not isinstance(raw, dict):
        raise MigrationError("Invalid DeepSeek session record: " + sid)
    if raw.get("id") != sid:
        raise MigrationError(
            "DeepSeek session identity does not match its file: " + sid
        )
    source_messages = raw.get("messages")
    if not isinstance(source_messages, list):
        raise MigrationError("DeepSeek session has no message list: " + sid)
    by_id = {}
    for msg in source_messages:
        if not isinstance(msg, dict):
            raise MigrationError("Invalid DeepSeek message record")
        mid = msg.get("id")
        if isinstance(mid, bool) or not isinstance(mid, (int, str)) or mid == "":
            raise MigrationError("Invalid DeepSeek message identity")
        if mid in by_id:
            raise MigrationError("Duplicate DeepSeek message identity: " + str(mid))
        if msg.get("role") not in ("USER", "ASSISTANT"):
            raise MigrationError(
                "Unsupported DeepSeek message role: " + str(msg.get("role"))
            )
        if not isinstance(msg.get("fragments"), list):
            raise MigrationError("DeepSeek message has no fragment list: " + str(mid))
        parent = msg.get("parent_id")
        if parent is not None and (
            isinstance(parent, bool) or not isinstance(parent, (int, str))
        ):
            raise MigrationError("Invalid DeepSeek parent identity: " + str(mid))
        by_id[mid] = msg
    for msg in source_messages:
        parent = msg.get("parent_id")
        if parent is not None and parent not in by_id:
            raise MigrationError(
                "DeepSeek message references a missing parent: " + str(msg["id"])
            )
    chain = active_branch(raw, by_id)
    created = ms(raw.get("inserted_at"))
    warnings, counters = [], {"truncated": [0], "files": 0, "unknown": {}}
    messages = []
    # Active branch first, root to leaf, so the shared converter assigns every reply
    # to its own question. Inactive branches follow chronologically, archive-only.
    on_branch = set(chain)
    rest = sorted(
        (pair for pair in enumerate(source_messages) if pair[1]["id"] not in on_branch),
        key=lambda pair: (ms(pair[1].get("inserted_at"), created), pair[0]),
    )
    ordered = [by_id[x] for x in chain] + [msg for _, msg in rest]
    for msg in ordered:
        key = str(msg["id"])
        at = ms(msg.get("inserted_at"), created)
        role = "user" if msg["role"] == "USER" else "assistant"
        parts = []
        for number, fragment in enumerate(msg["fragments"]):
            pid = key + "-" + str(number)
            if not isinstance(fragment, dict):
                raise MigrationError("Invalid DeepSeek fragment in message " + key)
            typ = fragment.get("type")
            content = fragment.get("content")
            if typ in TEXT_FRAGMENTS:
                if not isinstance(content, str):
                    raise MigrationError("Invalid DeepSeek text fragment: " + pid)
                data = {"type": "text", "text": clip(content, counters["truncated"])}
            elif typ == "THINK":
                if not isinstance(content, str):
                    raise MigrationError("Invalid DeepSeek thinking fragment: " + pid)
                data = {
                    "type": "reasoning",
                    "text": clip(content, counters["truncated"]),
                }
            elif typ == "TOOL_SEARCH":
                queries = fragment.get("queries")
                results = fragment.get("results")
                if queries is not None and not isinstance(queries, list):
                    raise MigrationError("Invalid DeepSeek search queries: " + pid)
                if results is not None and not isinstance(results, list):
                    raise MigrationError("Invalid DeepSeek search results: " + pid)
                data = {
                    "type": "tool",
                    "tool": "web_search",
                    "callID": "deepseek-search-" + pid,
                    "state": {
                        "status": str(fragment.get("status") or "completed").lower(),
                        "input": {"queries": queries or []},
                        "output": clip(search_output(results), counters["truncated"]),
                    },
                }
            elif typ == "CONTENT_RISK":
                notice = "[DeepSeek 内容风险提示"
                if fragment.get("style"):
                    notice += "（" + str(fragment["style"]) + "）"
                notice += "]"
                if isinstance(content, str) and content:
                    notice += "\n" + clip(content, counters["truncated"])
                data = {"type": "text", "text": notice}
            elif typ == "FILE":
                files = fragment.get("files")
                if not isinstance(files, list):
                    raise MigrationError("Invalid DeepSeek file fragment: " + pid)
                for index, item in enumerate(files):
                    if not isinstance(item, dict):
                        raise MigrationError("Invalid DeepSeek file record: " + pid)
                    reference = {
                        "type": "file",
                        "filename": item.get("file_name") or "附件",
                        "mime": "image" if item.get("is_image") else None,
                        "size": item.get("file_size"),
                        "path": item.get("export_path"),
                        "inExport": bool(
                            isinstance(item.get("export_path"), str)
                            and export.has(item["export_path"])
                        ),
                    }
                    parts.append(
                        {
                            "id": pid + "-" + str(index),
                            "createdAtMs": ms(item.get("inserted_at"), at),
                            "data": {
                                k: v for k, v in reference.items() if v is not None
                            },
                        }
                    )
                    counters["files"] += 1
                continue
            else:
                counters["unknown"][str(typ)] = counters["unknown"].get(str(typ), 0) + 1
                continue
            parts.append({"id": pid, "createdAtMs": at, "data": data})
        data = {"role": role}
        status = msg.get("status")
        if status not in (None, "FINISHED"):
            data["error"] = {"status": status}
        messages.append({"id": key, "data": data, "createdAtMs": at, "parts": parts})
    active = [str(x) for x in chain]
    active_set = set(active)
    off_branch = sum(1 for msg in messages if msg["id"] not in active_set)
    if off_branch:
        warnings.append(
            "DeepSeek inactive branches retained only in source archive: %d messages"
            % off_branch
        )
    if counters["truncated"][0]:
        warnings.append(
            "Truncated %d oversized DeepSeek text fields" % counters["truncated"][0]
        )
    for typ, count in sorted(counters["unknown"].items()):
        warnings.append(
            "Unsupported DeepSeek fragment retained only in source archive: %s x%d"
            % (typ, count)
        )
    index_row = index_row or {}
    title = raw.get("title") if isinstance(raw.get("title"), str) else None
    title = (title or index_row.get("title") or "").strip()
    if not title:
        for msg in messages:
            if msg["data"]["role"] != "user":
                continue
            text = next(
                (
                    p["data"]["text"]
                    for p in msg["parts"]
                    if p["data"].get("type") == "text" and p["data"]["text"].strip()
                ),
                "",
            )
            if text:
                title = text.strip().splitlines()[0][:80]
                break
    meta = {
        "id": sid,
        "title": (title or "DeepSeek session " + sid[:8])[:200],
        "created": created,
        "updated": ms(raw.get("updated_at"), created),
        "pinned": bool(raw.get("pinned")),
    }
    return meta, messages, {"display": active, "active": active}, warnings


def inventory(root):
    root = source_path(root)
    errors = []
    with Export(root) as export:
        rows = discover(export, errors)
        ids, sizes = [], {}
        for sid in sorted(rows):
            try:
                size = export.size(session_entry(sid))
            except MigrationError as exc:
                errors.append({"sourceId": sid, "error": str(exc)})
                continue
            if size is None:
                errors.append(
                    {
                        "sourceId": sid,
                        "error": "DeepSeek session file is missing: " + sid,
                    }
                )
                continue
            ids.append(sid)
            sizes[sid] = size
    return {
        "root": root,
        "ids": ids,
        "index": rows,
        "errors": errors,
        "bytes": sum(sizes.values()),
    }


def load_source(root, ids=None):
    """Same contract as migrate.load_source: a list of fingerprinted items."""
    data = inventory(root)
    if ids:
        unknown = sorted(set(ids) - set(data["ids"]))
        if unknown:
            raise MigrationError("Unknown DeepSeek session IDs: " + ", ".join(unknown))
        wanted = list(ids)
    else:
        failed = {e.get("sourceId") for e in data["errors"]}
        wanted = [sid for sid in data["ids"] if sid not in failed]
    return load_inventory(data, wanted, selected=bool(ids))


def load_inventory(data, ids, selected=True, export=None):
    """export: an open Export of data["root"] to reuse; otherwise one is opened here."""
    if export is None:
        with Export(data["root"]) as opened:
            return load_inventory(data, ids, selected, opened)
    result = []
    for sid in sorted(set(ids)):
        if sid not in data["index"]:
            raise MigrationError("Unknown DeepSeek session ID: " + sid)
        meta, messages, histories, warnings = read_session(
            export, sid, data["index"].get(sid)
        )
        if not messages or not histories["active"]:
            if selected:
                raise MigrationError(
                    "Selected DeepSeek session has no readable messages: " + sid
                )
            continue
        updated = max(
            [meta["updated"], meta["created"]]
            + [msg["createdAtMs"] for msg in messages]
        )
        item = {
            "session": {
                "id": sid,
                "directory": default_workspace(),
                "title": meta["title"],
                "time_created": meta["created"] or messages[0]["createdAtMs"],
                "time_updated": updated,
                "pinned": meta["pinned"],
            },
            "messages": messages,
            "histories": histories,
            "desktop": None,
            "warnings": warnings,
        }
        item["fingerprint"] = digest(item)
        result.append(item)
    result.sort(key=lambda x: (x["session"]["time_created"], x["session"]["id"]))
    return result


def overview(root, ids=None):
    """Cheap listing for `scan`: metadata from chat_session_index.json only."""
    root = source_path(root)
    workspace = default_workspace()
    rows = []
    with Export(root) as export:
        index = discover(export)
        wanted = set(ids or index)
        unknown = sorted(wanted - set(index))
        if unknown:
            raise MigrationError("Unknown DeepSeek session IDs: " + ", ".join(unknown))
        for sid in sorted(wanted):
            row = index[sid]
            title = row.get("title")
            size = export.size(session_entry(sid))
            rows.append(
                {
                    "id": sid,
                    "title": title.strip()
                    if isinstance(title, str) and title.strip()
                    else None,
                    "workspace": workspace,
                    "workspaceExists": Path(workspace).is_dir(),
                    "createdAt": ms(row.get("inserted_at")),
                    "updatedAt": ms(row.get("updated_at")),
                    "messageCount": row.get("message_count"),
                    "pinned": bool(row.get("pinned")),
                    "archived": False,
                    "bytes": size or 0,
                    "missing": size is None,
                }
            )
    rows.sort(key=lambda row: row["updatedAt"] or 0, reverse=True)
    return rows
