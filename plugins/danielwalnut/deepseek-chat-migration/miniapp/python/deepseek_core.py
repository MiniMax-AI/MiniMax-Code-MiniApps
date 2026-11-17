"""Native MiniMax Code session writer for the DeepSeek Chat Migration Mini App.

Python 3.9+, standard library only. Adapted from the storage core of MiniMax Code's
agent-session-migration plugin (author: Insider), reduced to the DeepSeek source:
the migration lock, single write transaction, rollback, post-commit read-back and
first-turn history initialization are kept as they were. The plugin's full database
backup is replaced by a per-run undo journal (deepseek_undo.py).
Target identities, marker files and the lock directory match that plugin's DeepSeek
source so imports from either tool are recognized by the other.
"""

import base64
import contextlib
import hashlib
import json
import os
import sqlite3
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

FORMAT = 1
ADAPTER_VERSION = 2
SOURCE_TYPE = "deepseek"
LABEL = "DeepSeek"
MARKER = "deepseek-migration.json"
ARCHIVE = "deepseek-source.json"
ID_PREFIX = "msg-deepseek-"
TURN_PREFIX = "deepseek-"
PROVIDER = "deepseek-history"
DISPLAY_KIND = "deepseek_history_archive"
# Shared with agent-session-migration so the two tools never write concurrently.
LOCK_DIR = "zcode-migration"
MAX_RECORD = 16 * 1024 * 1024
TARGET_COLUMNS = {
    "local_runtime_pi_history_file_migrations": {
        "session_id",
        "migrated_at_ms",
        "source",
        "message_count",
        "target_revision",
    },
    "local_runtime_sessions": {
        "session_id",
        "record_json",
        "updated_at_ms",
        "columnar_version",
        "agent_name",
        "runtime",
        "session_type",
        "status",
        "archived",
        "visibility",
        "session_kind",
        "purpose_kind",
        "workspace_dir",
        "project_workspace_dir",
        "is_default_workspace",
        "title",
        "created_at_ms",
        "extra_data_json",
        "project_id",
        "history_relative_dir",
    },
    "local_runtime_message_rows": {
        "session_id",
        "msg_id",
        "role",
        "turn_id",
        "source",
        "created_at_ms",
        "data_json",
    },
    "local_runtime_projects": {
        "project_id",
        "project_kind",
        "workspace_dir",
        "created_at_ms",
        "updated_at_ms",
        "hidden",
        "extra_data_json",
    },
    "local_runtime_session_fts_keys": {"fts_rowid", "session_id"},
    "local_runtime_sessions_fts": {
        "session_id",
        "session_id_terms",
        "agent_name_terms",
        "title_terms",
        "workspace_dir_terms",
        "purpose_terms",
        "status_terms",
        "session_type_terms",
    },
}


class MigrationError(Exception):
    pass


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(compact(value).encode()).hexdigest()


def history_revision(records):
    # The importer emits canonical envelopes with ASCII keys and integer numbers.
    # Match Runtime's recursively key-sorted JSON semantic revision exactly.
    raw = json.dumps(
        records,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    )
    return "sha256:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def initialize_history(db, sid, records):
    # 'empty' describes the legacy MCode source. The imported JSONL is already
    # authoritative; first-turn materialization must not compare it to no history.
    insert(
        db,
        "local_runtime_pi_history_file_migrations",
        {
            "session_id": sid,
            "migrated_at_ms": int(time.time() * 1000),
            "source": "empty",
            "message_count": len(records),
            "target_revision": history_revision(records),
        },
    )


def is_link(path):
    # Windows junctions are reparse points too; Python 3.9 has no Path.is_junction.
    import stat

    try:
        return path.is_symlink() or bool(
            getattr(path.lstat(), "st_file_attributes", 0)
            & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        )
    except FileNotFoundError:
        return False


def regular(path):
    path = Path(path).expanduser().absolute()
    if is_link(path) or not path.is_file():
        raise MigrationError("Expected an existing regular file: " + str(path))
    return path


@contextlib.contextmanager
def connect(path, writable=False):
    path = regular(path).resolve()
    db = sqlite3.connect(
        path.as_uri() + ("?mode=rw" if writable else "?mode=ro"), uri=True, timeout=10
    )
    try:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        if not writable:
            db.execute("PRAGMA query_only=ON")
            db.execute("BEGIN")
        yield db
    except sqlite3.OperationalError as exc:
        if not writable and "unable to open database file" in str(exc):
            raise MigrationError(
                "Cannot read SQLite database: "
                + str(path)
                + "; verify directory access and open the owning app so SQLite can initialize WAL sidecars. "
                "Do not delete WAL/SHM files or bypass them with immutable mode."
            ) from exc
        raise
    finally:
        db.close()


def schema(db, required):
    for table, columns in required.items():
        found = {r["name"] for r in db.execute('PRAGMA table_info("' + table + '")')}
        if not columns <= found:
            raise MigrationError(
                "Unsupported schema for "
                + table
                + ": missing "
                + ", ".join(sorted(columns - found))
            )


def parse(raw, location):
    if not isinstance(raw, str) or len(raw.encode()) > MAX_RECORD:
        raise MigrationError("Oversized/invalid JSON at " + location)
    try:
        result = json.loads(raw)
    except (ValueError, TypeError) as exc:
        raise MigrationError("Malformed JSON at " + location) from exc
    if not isinstance(result, dict):
        raise MigrationError("Expected JSON object at " + location)
    return result


def timestamp(value):
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 0 <= value <= 253402300799999
    ):
        raise MigrationError("Expected Unix milliseconds")
    return value


def target_path(value):
    if not value:
        raise MigrationError(
            "An explicit --data-dir (MiniMax Code data directory) is required"
        )
    root = Path(value).expanduser().absolute()
    if is_link(root) or not root.is_dir():
        raise MigrationError("Target must be an existing non-symlink data directory")
    root = root.resolve()
    safe_directory(root, "v2/sqlite")
    regular(root / "v2/sqlite/runtime-state.sqlite")
    return root


def safe_directory(root, relative):
    path = root
    for part in Path(relative).parts:
        if part in ("..", ".", "") or Path(part).is_absolute():
            raise MigrationError("Unsafe output path")
        path = path / part
        if is_link(path):
            raise MigrationError("Symlink in output path: " + str(path))
        if path.exists() and not path.is_dir():
            raise MigrationError("Not a directory: " + str(path))
    return path


def private_write(path, value):
    data = value.encode("utf-8")
    with open(path, "xb") as out:
        os.chmod(path, 0o600)
        out.write(data)
        out.flush()
        os.fsync(out.fileno())


def identity(root, source_id):
    """root is the stable account key from deepseek_export.identity_root, not a path:
    every upload lands at a fresh temporary path, and the same chat must map to the
    same target session each time."""
    return "mvs_" + hashlib.sha256((root + "\0" + source_id).encode()).hexdigest()[:32]


def history_dir(sid, created):
    dt = datetime.fromtimestamp(created / 1000, timezone.utc)
    encoded = base64.urlsafe_b64encode(sid.encode()).decode().rstrip("=")
    return (
        dt.strftime("%Y/%m/%d/%H-%M-%S-")
        + str(created % 1000).zfill(3)
        + "-session_"
        + encoded
    )


def message_identity(sid, msg):
    raw = hashlib.sha256((sid + "\0" + msg["id"]).encode()).digest()
    if msg["data"].get("role") == "user":
        return "msg-user-v1-" + base64.urlsafe_b64encode(raw).decode().rstrip("=")
    return ID_PREFIX + raw.hex()[:32]


def historical_detail(value):
    """Plain code-panel text with real line breaks, not a quoted JSON blob."""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return "\n\n".join(
            str(k) + ":\n" + historical_detail(v) for k, v in value.items()
        )
    if isinstance(value, list):
        return "\n\n".join(
            "[" + str(i + 1) + "]\n" + historical_detail(v) for i, v in enumerate(value)
        )
    return compact(value)


def historical_tool_view(evidence, mid, index, label):
    """Display-only protocol record. Never a canonical/provider tool invocation."""
    # Do not dispatch arbitrary source names to native interactive tool renderers.
    # The original status is metadata; even unfinished source calls are inert here.
    args = {
        "来源": label,
        "工具": evidence.get("tool"),
        "原始状态": evidence.get("status"),
        "说明": "历史记录，仅供阅读，不重新执行",
        "输入": evidence.get("input"),
    }
    result = {k: v for k, v in evidence.items() if k not in ("tool", "input")}
    return {
        "tool_name": "历史工具记录",
        "tool_call_id": mid + "-history-" + str(index),
        "tool_call_status": 2,
        "tool_call_args": compact(historical_detail(args)),
        "tool_call_result_data": compact(
            {"content": [{"type": "text", "text": historical_detail(result)}]}
        ),
    }


def historical_file_text(part, label):
    """A reference is not an uploaded attachment and must not imply copied bytes."""
    name = part.get("filename") or part.get("name") or "附件"
    path = part.get("url") or part.get("path") or part.get("file_path")
    return (
        "["
        + label
        + " 历史附件引用，未复制文件]\n"
        + str(name)
        + ("\n" + str(path) if path else "\n" + compact(part))
    )


def select_histories(item):
    """The reader names the displayed and the model-context message ids explicitly."""
    messages = item["messages"]
    by_id = {msg["id"]: msg for msg in messages}
    if len(by_id) != len(messages):
        raise MigrationError("Duplicate source message identity")
    histories = item.get("histories")
    if not isinstance(histories, dict) or set(histories) != {"display", "active"}:
        raise MigrationError("Invalid source history selection")
    selected = []
    for key in ("display", "active"):
        values = histories[key]
        if not isinstance(values, list) or len(values) != len(set(values)):
            raise MigrationError("Invalid source history selection")
        for value in values:
            if value not in by_id:
                raise MigrationError(
                    "Missing/invalid source history boundary reference: " + str(value)
                )
        selected.append([by_id[value] for value in values])
    return tuple(selected)


def convert(item, sid):
    """Normalized DeepSeek item -> (display rows, canonical history, warnings).

    Display rows feed the UI; canonical records are the model's continuation history.
    Reasoning is display-only, tools are inert historical records, files are references.
    """
    label = LABEL
    display, canonical, warnings = [], [], list(item.get("warnings") or [])
    turn = TURN_PREFIX + sid
    zero_usage = {
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0,
        "totalTokens": 0,
        "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0},
    }
    display_messages, active_messages = select_histories(item)
    visible_ids = {msg["id"] for msg in display_messages}
    active_ids = {msg["id"] for msg in active_messages}
    canonical_by_id = {}
    for msg in item["messages"]:
        if msg["id"] not in visible_ids and msg["id"] not in active_ids:
            continue
        data = msg["data"]
        role = data.get("role")
        if role not in ("user", "assistant"):
            raise MigrationError("Unsupported normalized role: " + str(role))
        mid = message_identity(sid, msg)
        if role == "user":
            turn = TURN_PREFIX + msg["id"]
        texts, thoughts = [], []
        view_texts, view_tools = [], []
        for part in msg["parts"]:
            p = part["data"]
            typ = p.get("type")
            if typ == "text":
                if not isinstance(p.get("text"), str):
                    raise MigrationError("Invalid text part: " + part["id"])
                texts.append(p["text"])
                view_texts.append(p["text"])
            elif typ == "reasoning":
                if isinstance(p.get("text"), str):
                    thoughts.append(p["text"])
            elif typ == "tool":
                state = p.get("state")
                if not isinstance(state, dict):
                    raise MigrationError("Invalid tool state: " + part["id"])
                evidence = {
                    "tool": p.get("tool"),
                    "callID": p.get("callID"),
                    "status": state.get("status"),
                    "input": state.get("input"),
                }
                for key in ("output", "error", "title"):
                    if key in state:
                        evidence[key] = state[key]
                texts.append(
                    "["
                    + label
                    + " 历史工具记录；仅供阅读，不重新执行]\n"
                    + compact(evidence)
                )
                view_tools.append(
                    historical_tool_view(evidence, mid, len(view_tools), label)
                )
            elif typ == "file":
                view_texts.append(historical_file_text(p, label))
                texts.append("[" + label + " 历史附件引用]\n" + compact(p))
                warnings.append(
                    "Attachment reference retained; bytes not copied: " + part["id"]
                )
            else:
                raise MigrationError("Unsupported normalized part: " + str(typ))
        if data.get("error"):
            texts.append("[" + label + " 历史错误]\n" + compact(data["error"]))
            view_texts.append(texts[-1])
        text = "\n\n".join(texts)
        ts = timestamp(msg["createdAtMs"])
        if msg["id"] in visible_ids and (text or thoughts):
            view = {
                "msg_id": mid,
                "role": role,
                "msg_type": 1,
                "msg_content": "\n\n".join(view_texts),
                "timestamp": ts,
                "turnId": turn,
                "turn_id": turn,
                "query_key": turn,
                "source": "desktop",
                "canonical_message_id": mid,
            }
            if msg["id"] not in active_ids or not text:
                view["displayKind"] = DISPLAY_KIND
            if view_tools:
                view["tool_calls"] = view_tools
            if thoughts:
                view["thinking_content"] = "\n\n".join(thoughts)
            if role == "assistant":
                view["finish_reason"] = "stop"
            display.append(view)
        if not text or msg["id"] not in active_ids:
            continue
        native = {
            "role": role,
            "content": [{"type": "text", "text": text}],
            "timestamp": ts,
        }
        if role == "assistant":
            native.update(
                {
                    "api": "openai-completions",
                    "provider": PROVIDER,
                    "model": "historical-transcript",
                    "usage": zero_usage,
                    "stopReason": "stop",
                }
            )
        canonical_by_id[msg["id"]] = {
            "message_id": mid,
            "turn_id": turn,
            "message": native,
        }
    canonical = [
        canonical_by_id[msg["id"]]
        for msg in active_messages
        if msg["id"] in canonical_by_id
    ]
    return display, canonical, warnings


def check_target(db, agent):
    schema(db, TARGET_COLUMNS)
    if not agent or any(x in agent for x in ("/", "\\", "\0")):
        raise MigrationError("Invalid target agent name")
    versions = {
        r[0]
        for r in db.execute(
            "SELECT DISTINCT columnar_version FROM local_runtime_sessions"
        )
    }
    if versions - {0, 3}:
        raise MigrationError("Unsupported target session columnar version")
    for row in db.execute(
        "SELECT session_id,record_json FROM local_runtime_sessions WHERE columnar_version=0"
    ):
        record = parse(row["record_json"], "legacy session " + row["session_id"])
        if record.get("sessionId") != row["session_id"]:
            raise MigrationError(
                "Invalid legacy session identity; retain it for runtime recovery"
            )
        legacy_version = record.get("sessionDataVersion", 0)
        if (
            isinstance(legacy_version, bool)
            or not isinstance(legacy_version, int)
            or legacy_version < 0
        ):
            raise MigrationError("Invalid legacy session data version")
        if legacy_version > 4:
            raise MigrationError("Newer legacy session data contract detected")
    if not db.execute(
        "SELECT 1 FROM local_runtime_sessions WHERE agent_name=? AND columnar_version=3 LIMIT 1",
        (agent,),
    ).fetchone():
        raise MigrationError(
            "Target agent has no existing session; initialize it in MiniMax Code first"
        )
    future = db.execute(
        "SELECT 1 FROM local_runtime_sessions WHERE json_extract(extra_data_json,'$.sessionDataVersion') > 4 LIMIT 1"
    ).fetchone()
    if future:
        raise MigrationError(
            "Newer session data contract detected; update the DeepSeek Chat Migration Mini App"
        )
    return db.execute(
        "SELECT COUNT(*) FROM local_runtime_sessions WHERE columnar_version=0"
    ).fetchone()[0]


def plan(source, key, target, agent, items, workspace=None, restore_projects=False):
    """Read-only preview of normalized items against the target. key: stable identity root."""
    with connect(target / "v2/sqlite/runtime-state.sqlite") as db:
        legacy_count = check_target(db, agent)
        return plan_in(
            db, legacy_count, key, target, agent, items, workspace, restore_projects
        )


def plan_in(
    db, legacy_count, key, target, agent, items, workspace=None, restore_projects=False
):
    """plan() on an open read connection whose target was already checked; lets a
    preview of many sessions share one snapshot instead of reconnecting per session."""
    planned = []
    for item in items:
        s = item["session"]
        sid = identity(key, s["id"])
        created = timestamp(s["time_created"])
        timestamp(s["time_updated"])
        cwd = str(Path(workspace or s["directory"]).expanduser().resolve())
        if not Path(cwd).is_dir():
            raise MigrationError("Missing workspace; use --workspace: " + cwd)
        rel = history_dir(sid, created)
        directory = safe_directory(target, "v2/sessions/" + rel)
        display, canonical, warnings = [], [], []
        status = "new"
        existing = db.execute(
            "SELECT title,history_relative_dir,agent_name,created_at_ms,updated_at_ms FROM local_runtime_sessions WHERE session_id=?",
            (sid,),
        ).fetchone()
        if existing:
            marker = directory / MARKER
            if not marker.is_file() or is_link(marker):
                raise MigrationError(
                    "Existing target identity has no migration provenance: " + sid
                )
            provenance = parse(marker.read_text(encoding="utf-8"), str(marker))
            if provenance.get("fingerprint") != item["fingerprint"]:
                raise MigrationError(
                    "Source changed after migration; refusing to overwrite continued target session: "
                    + s["id"]
                )
            if (
                existing["history_relative_dir"] != rel
                or existing["agent_name"] != agent
                or provenance.get("workspace") != cwd
            ):
                raise MigrationError("Existing migration target differs: " + sid)
            regular(directory / "messages.jsonl")
            # Readback counts describe persisted target state, including continued turns.
            display = [
                dict(row)
                for row in db.execute(
                    "SELECT msg_id FROM local_runtime_message_rows WHERE session_id=?",
                    (sid,),
                )
            ]
            with open(directory / "messages.jsonl", encoding="utf-8") as history:
                canonical = [
                    parse(line, str(directory / "messages.jsonl"))
                    for line in history
                    if line.strip()
                ]
            created = timestamp(existing["created_at_ms"])
            if provenance.get("adapterVersion", 1) < ADAPTER_VERSION:
                warnings.append(
                    "Imported by an older adapter; existing history is unchanged and is not automatically repaired"
                )
            if not db.execute(
                "SELECT 1 FROM local_runtime_pi_history_file_migrations WHERE session_id=?",
                (sid,),
            ).fetchone():
                raise MigrationError(
                    "Existing import needs history repair (agent-session-migration repair --target-session): "
                    + sid
                )
            status = "already-imported"
        elif directory.exists():
            raise MigrationError(
                "Uncommitted history directory exists; inspect recovery manifest before retry: "
                + str(directory)
            )
        project_state = None
        restore_boundary = None
        source_created = timestamp(s["time_created"])
        updated = timestamp(
            existing["updated_at_ms"] if existing else s["time_updated"]
        )
        if status == "new":
            display, canonical, warnings = convert(item, sid)
            project = db.execute(
                "SELECT project_id,hidden,extra_data_json,updated_at_ms FROM local_runtime_projects WHERE project_kind='workspace' AND workspace_dir=?",
                (cwd,),
            ).fetchone()
            if project:
                project_state = dict(project)
                removal = parse(project["extra_data_json"], "project extra data").get(
                    "sidebarRemoval"
                )
                cutoff = (
                    timestamp(removal["atMs"])
                    if isinstance(removal, dict) and "atMs" in removal
                    else None
                )
                if removal is not None and cutoff is None:
                    raise MigrationError("Unsupported project removal boundary")
                if project["hidden"]:
                    latest = (
                        db.execute(
                            "SELECT MAX(created_at_ms) FROM local_runtime_sessions WHERE project_id=?",
                            (project["project_id"],),
                        ).fetchone()[0]
                        or 0
                    )
                    cutoff = max(
                        int(time.time() * 1000),
                        project["updated_at_ms"],
                        cutoff or 0,
                        latest,
                    )
                    at_boundary = [
                        r[0]
                        for r in db.execute(
                            "SELECT session_id FROM local_runtime_sessions WHERE project_id=? AND created_at_ms=?",
                            (project["project_id"], cutoff),
                        )
                    ]
                    restore_boundary = {"atMs": cutoff, "boundaryIds": at_boundary}
                removed = cutoff is not None and (
                    created < cutoff
                    or created == cutoff
                    and sid in (restore_boundary or removal).get("boundaryIds", [])
                )
                if project["hidden"] or removed:
                    if not restore_projects:
                        raise MigrationError(
                            "Workspace project was removed; use --restore-projects only after explicitly accepting restoration: "
                            + cwd
                        )
                    if removed:
                        created = max(int(time.time() * 1000), cutoff + 1)
                    updated = max(updated, created)
                    warnings.append(
                        "Project explicitly restored; original source timestamps remain in provenance and source archive"
                    )
        if legacy_count:
            warnings.append(
                "Preserved existing legacy columnar_version=0 rows: "
                + str(legacy_count)
            )
        source_title = item["desktop"]["title"] if item["desktop"] else s["title"]
        prefix = "[From " + LABEL + "]"
        title = source_title
        if existing:
            title = existing["title"]
        elif not title.startswith(prefix):
            title = prefix + " " + title
        planned.append(
            {
                "sourceCreatedAtMs": source_created,
                "sourceUpdatedAtMs": timestamp(s["time_updated"]),
                "projectState": project_state,
                "restoreBoundary": restore_boundary,
                "canonicalMessageCount": len(canonical),
                "sourceId": s["id"],
                "targetId": sid,
                "title": title,
                "archived": bool(
                    item["desktop"]["archived"]
                    if item["desktop"]
                    else dict(s).get("time_archived")
                ),
                "workspace": cwd,
                "historyRelativeDir": rel,
                "createdAtMs": created,
                "updatedAtMs": updated,
                "fingerprint": item["fingerprint"],
                "messageCount": len(display),
                "warnings": warnings,
                "status": status,
                "item": item,
                "display": display,
                "canonical": canonical,
            }
        )
    return planned


def public_plan(rows):
    return [
        {
            k: v
            for k, v in r.items()
            if k
            not in ("item", "display", "canonical", "projectState", "restoreBoundary")
        }
        for r in rows
    ]


def insert(db, table, record):
    columns = list(record)
    db.execute(
        "INSERT INTO "
        + table
        + " ("
        + ",".join(columns)
        + ") VALUES ("
        + ",".join("?" for _ in columns)
        + ")",
        [record[x] for x in columns],
    )


@contextlib.contextmanager
def migration_lock(target):
    root = safe_directory(target, LOCK_DIR)
    root.mkdir(mode=0o700, exist_ok=True)
    # Legacy releases use an exclusive-create lock; never remove their lock.
    if (root / "apply.lock").exists():
        raise MigrationError(
            "Legacy migration lock requires inspection: " + str(root / "apply.lock")
        )
    path = root / "writer.lock"
    if is_link(path):
        raise MigrationError("Linked migration lock")
    if path.exists():
        regular(path)
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        if os.fstat(fd).st_size == 0:
            os.write(fd, b"0")
        os.lseek(fd, 0, os.SEEK_SET)
        try:
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise MigrationError("Migration lock is held by another writer") from exc
        yield
    finally:
        # Closing releases OS locks even after an abrupt process exit. Do not unlink
        # the inode: another process may already be waiting on this same file.
        os.close(fd)


def apply(
    source,
    key,
    target,
    agent,
    items,
    workspace=None,
    restore_projects=False,
    fail_after=None,
):
    with migration_lock(target):
        return _apply_locked(
            source, key, target, agent, items, workspace, restore_projects, fail_after
        )


def _apply_locked(
    source,
    key,
    target,
    agent,
    items,
    workspace=None,
    restore_projects=False,
    fail_after=None,
    journal=None,
):
    # journal: the run's undo journal (deepseek_undo.Journal). No full database copy:
    # an import only adds rows keyed by its own target ids, so the journal records
    # those ids and the before-image of the one existing row it may update.
    # Files precede the DB commit. A failed/crashed import never publishes partial DB rows.
    # Orphan files are retained with an explicit recovery report, never mistaken for success.
    lock = safe_directory(target, LOCK_DIR)
    lock.mkdir(mode=0o700, exist_ok=True)
    created_dirs = []
    committed = False
    committing = False
    prepared = False
    report_file = None
    new = []
    try:
        rows = plan(source, key, target, agent, items, workspace, restore_projects)
        new = [r for r in rows if r["status"] == "new"]
        # DeepSeek attachments are migrated as references (name, size, export path);
        # the Mini App accepts that by default and reports it as a warning.
        if not new:
            return {"status": "unchanged", "sessions": public_plan(rows)}
        if journal is None:
            import deepseek_undo

            journal = deepseek_undo.Journal.create(target, agent, source)
        batch = journal.batch_dir()
        report_file = batch / "report.json"
        report = {
            "format": FORMAT,
            "state": "prepared",
            "source": str(source),
            "target": str(target),
            "sessions": public_plan(rows),
            "createdDirectories": [],
        }
        private_write(report_file, compact(report) + "\n")
        dbfile = target / "v2/sqlite/runtime-state.sqlite"
        with connect(dbfile, True) as db:
            db.execute("BEGIN IMMEDIATE")
            check_target(db, agent)
            # Under the write lock and before any write: intent and before-images.
            journal.prepare(db, target, new)
            prepared = True
            checked_projects = set()
            for r in new:
                if db.execute(
                    "SELECT 1 FROM local_runtime_sessions WHERE session_id=?",
                    (r["targetId"],),
                ).fetchone():
                    raise MigrationError("Concurrent target identity conflict")
                directory = safe_directory(
                    target, "v2/sessions/" + r["historyRelativeDir"]
                )
                directory.mkdir(mode=0o700, parents=True, exist_ok=False)
                created_dirs.append(directory)
                provenance = {
                    k: r[k]
                    for k in (
                        "sourceId",
                        "targetId",
                        "fingerprint",
                        "workspace",
                        "sourceCreatedAtMs",
                        "sourceUpdatedAtMs",
                    )
                }
                provenance.update(
                    {
                        "format": FORMAT,
                        "adapterVersion": ADAPTER_VERSION,
                        "sourceType": SOURCE_TYPE,
                        "source": str(source),
                        "importedAtMs": int(time.time() * 1000),
                        "undoRun": journal.run_id,
                    }
                )
                private_write(directory / MARKER, compact(provenance) + "\n")
                private_write(directory / ARCHIVE, compact(r["item"]) + "\n")
                private_write(
                    directory / "messages.jsonl",
                    "".join(compact(x) + "\n" for x in r["canonical"]),
                )
                private_write(
                    directory / "manifest.json",
                    compact(
                        {
                            "schemaVersion": 1,
                            "sessionId": r["targetId"],
                            "createdAtMs": r["createdAtMs"],
                            "updatedAtMs": r["updatedAtMs"],
                            "source": "local-runtime",
                            "layout": "v2-final-dated-session",
                            "paths": {
                                "sessionDir": str(directory),
                                "messages": str(directory / "messages.jsonl"),
                                "reports": str(directory / "reports"),
                            },
                        }
                    )
                    + "\n",
                )
                extra = {
                    "appMode": "coding",
                    "sessionDataVersion": 4,
                    "sessionOrigin": "local-runtime",
                    "origin": "user",
                }
                session = {
                    "sessionId": r["targetId"],
                    "agentName": agent,
                    "workspaceDir": r["workspace"],
                    "runtime": "pi-agent",
                    "sessionType": "branch",
                    "sessionKind": "conversation",
                    "archived": r["archived"],
                    "visibility": "visible",
                    "title": r["title"],
                    "status": "idle",
                    "createdAtMs": r["createdAtMs"],
                    "updatedAtMs": r["updatedAtMs"],
                    "historyRelativeDir": r["historyRelativeDir"],
                    **extra,
                }
                project = db.execute(
                    "SELECT project_id FROM local_runtime_projects WHERE project_kind='workspace' AND workspace_dir=?",
                    (r["workspace"],),
                ).fetchone()
                if (
                    r["workspace"] not in checked_projects
                    and r["projectState"] is not None
                ):
                    current = db.execute(
                        "SELECT project_id,hidden,extra_data_json,updated_at_ms FROM local_runtime_projects WHERE project_id=?",
                        (r["projectState"]["project_id"],),
                    ).fetchone()
                    if current is None or dict(current) != r["projectState"]:
                        raise MigrationError(
                            "Project changed during migration; preview again"
                        )
                elif r["workspace"] not in checked_projects and project:
                    raise MigrationError(
                        "Project appeared during migration; preview again"
                    )
                if not project:
                    insert(
                        db,
                        "local_runtime_projects",
                        {
                            "project_kind": "workspace",
                            "workspace_dir": r["workspace"],
                            "created_at_ms": r["createdAtMs"],
                            "updated_at_ms": r["updatedAtMs"],
                        },
                    )
                    project = db.execute(
                        "SELECT project_id FROM local_runtime_projects WHERE project_kind='workspace' AND workspace_dir=?",
                        (r["workspace"],),
                    ).fetchone()
                if (
                    r["workspace"] not in checked_projects
                    and r["restoreBoundary"] is not None
                ):
                    project_extra = parse(
                        r["projectState"]["extra_data_json"], "project extra data"
                    )
                    project_extra["sidebarRemoval"] = r["restoreBoundary"]
                    db.execute(
                        "UPDATE local_runtime_projects SET extra_data_json=? WHERE project_id=?",
                        (compact(project_extra), project[0]),
                    )
                checked_projects.add(r["workspace"])
                if restore_projects:
                    db.execute(
                        "UPDATE local_runtime_projects SET hidden=0 WHERE project_id=? AND hidden=1",
                        (project[0],),
                    )
                insert(
                    db,
                    "local_runtime_sessions",
                    {
                        "session_id": r["targetId"],
                        "record_json": compact(session),
                        "updated_at_ms": r["updatedAtMs"],
                        "columnar_version": 3,
                        "agent_name": agent,
                        "runtime": "pi-agent",
                        "session_type": "branch",
                        "status": "idle",
                        "archived": int(r["archived"]),
                        "visibility": "visible",
                        "session_kind": "conversation",
                        "purpose_kind": "",
                        "workspace_dir": r["workspace"],
                        "project_workspace_dir": r["workspace"],
                        "is_default_workspace": 0,
                        "title": r["title"],
                        "created_at_ms": r["createdAtMs"],
                        "extra_data_json": compact(extra),
                        "project_id": project[0],
                        "history_relative_dir": r["historyRelativeDir"],
                    },
                )
                write_search_document(db, r, agent)
                for msg in r["display"]:
                    insert(
                        db,
                        "local_runtime_message_rows",
                        {
                            "session_id": r["targetId"],
                            "msg_id": msg["msg_id"],
                            "role": msg["role"],
                            "turn_id": msg["turnId"],
                            "source": "desktop",
                            "created_at_ms": msg["timestamp"],
                            "data_json": compact(msg),
                        },
                    )
                initialize_history(db, r["targetId"], r["canonical"])
                if fail_after is not None and len(created_dirs) >= fail_after:
                    raise MigrationError("Injected transaction failure")
            committing = True
            db.commit()
            committed = True
        report.update(
            {"state": "committed", "createdDirectories": [str(p) for p in created_dirs]}
        )
        temp = report_file.with_suffix(".complete")
        private_write(temp, compact(report) + "\n")
        os.replace(temp, report_file)
        # Read-back is independent from the write transaction.
        with connect(dbfile) as check:
            for row in new:
                count = check.execute(
                    "SELECT COUNT(*) FROM local_runtime_message_rows WHERE session_id=?",
                    (row["targetId"],),
                ).fetchone()[0]
                if count < row["messageCount"]:
                    raise MigrationError(
                        "Committed import failed message readback; see "
                        + str(report_file)
                    )
                if not check.execute(
                    "SELECT 1 FROM local_runtime_sessions WHERE session_id=?",
                    (row["targetId"],),
                ).fetchone():
                    raise MigrationError("Committed session missing during readback")
                row["status"] = "already-imported"
            journal.committed(check, target, new)
        verified = rows
        return {
            "status": "imported",
            "imported": len(new),
            "undo": str(journal.path),
            "report": str(report_file),
            "sessions": public_plan(verified),
        }
    except BaseException as exc:
        if prepared and not committed and not committing:
            try:
                journal.rolled_back(new)
            except OSError:
                pass
        if not committed and not committing:
            # Only remove files this invocation just created, never historical/user-owned dirs.
            for directory in reversed(created_dirs):
                for filename in (
                    MARKER,
                    ARCHIVE,
                    "messages.jsonl",
                    "manifest.json",
                ):
                    (directory / filename).unlink(missing_ok=True)
                directory.rmdir()
        if committed:
            raise MigrationError(
                "Import COMMITTED, but final readback/report failed; inspect "
                + str(report_file)
                + "; do not restore the whole DB: "
                + str(exc)
            ) from exc
        if committing:
            raise MigrationError(
                "Commit outcome uncertain; history files preserved. Inspect "
                + str(report_file)
            ) from exc
        raise


def search_terms(value):
    return " ".join(
        "c" + format(ord(char), "x")
        for char in unicodedata.normalize("NFKC", value or "").strip().lower()
    )


def write_search_document(db, row, agent):
    db.execute(
        "INSERT INTO local_runtime_session_fts_keys(session_id) VALUES (?)",
        (row["targetId"],),
    )
    key = db.execute(
        "SELECT fts_rowid FROM local_runtime_session_fts_keys WHERE session_id=?",
        (row["targetId"],),
    ).fetchone()[0]
    values = [
        row["targetId"],
        agent,
        row["title"],
        row["workspace"],
        "",
        "idle",
        "branch",
    ]
    db.execute(
        "INSERT INTO local_runtime_sessions_fts(rowid,session_id,session_id_terms,agent_name_terms,title_terms,workspace_dir_terms,purpose_terms,status_terms,session_type_terms) VALUES (?,?,?,?,?,?,?,?,?)",
        [key, row["targetId"]] + [search_terms(value) for value in values],
    )


def print_result(value, file=None):
    # JSON escapes round-trip UTF-8 text even through a legacy GBK PowerShell pipe.
    print(
        json.dumps(value, ensure_ascii=True, separators=(",", ":"), allow_nan=False),
        file=file,
    )
