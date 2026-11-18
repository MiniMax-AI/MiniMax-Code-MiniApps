"""Undo journal for DeepSeek imports: what one apply run added, and how to take it back.

An import only adds rows keyed by its own target session ids, so instead of copying the
whole database first (gigabytes on a long-used install) each run keeps a small journal:

- before a batch writes, inside its write transaction: the target ids, the history
  directories it will create, and the before-image of the one pre-existing row it may
  update (the DeepSeek workspace project: hidden, extra_data_json, counters);
- after the batch commits and is read back: the ids of every inserted row and a
  fingerprint of each session (record, message rows, history file) to detect later use.

`undo` removes exactly those sessions and rows, restores the project before-image when
the project still looks the way the import left it, deletes the history files it wrote,
and refuses when a session changed after import (the user kept chatting) unless forced.
"""

import hashlib
import os
import time
import uuid
from pathlib import Path

import deepseek_core as m

UNDO_DIR = "deepseek-migration"
JOURNAL = "undo.json"
JOURNAL_FORMAT = "deepseek-undo/1"
OWN_FILES = {m.MARKER, m.ARCHIVE, "messages.jsonl", "manifest.json"}
PROJECT_COLUMNS = (
    "project_id",
    "hidden",
    "extra_data_json",
    "latest_activity_at_ms",
    "session_count",
    "updated_at_ms",
)


class UndoRefused(m.MigrationError):
    def __init__(self, message, sessions):
        super().__init__(message)
        self.sessions = sessions


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def session_state(db, target, sid, relative):
    """What later use of a session would change: its record, rows and history file."""
    row = db.execute(
        "SELECT record_json,updated_at_ms,title,archived,status FROM local_runtime_sessions WHERE session_id=?",
        (sid,),
    ).fetchone()
    if row is None:
        return None
    count, highest = db.execute(
        "SELECT COUNT(*),MAX(id) FROM local_runtime_message_rows WHERE session_id=?",
        (sid,),
    ).fetchone()
    directory = target / "v2/sessions" / relative
    history = directory / "messages.jsonl"
    files = sorted(p.name for p in directory.iterdir()) if directory.is_dir() else None
    return {
        "record": hashlib.sha256(row["record_json"].encode("utf-8")).hexdigest(),
        "updatedAtMs": row["updated_at_ms"],
        "title": row["title"],
        "archived": row["archived"],
        "status": row["status"],
        "messageRows": count,
        "maxMessageRowId": highest,
        "history": sha256_file(history) if history.is_file() else None,
        "files": files,
    }


def project_row(db, workspace):
    present = {
        r["name"] for r in db.execute('PRAGMA table_info("local_runtime_projects")')
    }
    columns = [c for c in PROJECT_COLUMNS if c in present]
    row = db.execute(
        "SELECT "
        + ",".join(columns)
        + " FROM local_runtime_projects WHERE project_kind='workspace' AND workspace_dir=?",
        (workspace,),
    ).fetchone()
    return dict(row) if row else None


class Journal:
    def __init__(self, path, data):
        self.path = path
        self.dir = path.parent
        self.data = data

    @classmethod
    def create(cls, target, agent, source):
        root = m.safe_directory(target, UNDO_DIR)
        root.mkdir(mode=0o700, exist_ok=True)
        run = str(int(time.time() * 1000)) + "-" + uuid.uuid4().hex[:8]
        directory = m.safe_directory(target, UNDO_DIR + "/" + run)
        directory.mkdir(mode=0o700)
        journal = cls(
            directory / JOURNAL,
            {
                "format": JOURNAL_FORMAT,
                "runId": run,
                "state": "active",
                "target": str(target),
                "agent": agent,
                "source": str(source),
                "createdAtMs": int(time.time() * 1000),
                "projects": {},
                "sessions": [],
            },
        )
        journal.save()
        return journal

    @classmethod
    def load(cls, path, target):
        path = Path(path).expanduser().absolute()
        if path.is_dir():
            path = path / JOURNAL
        path = m.regular(path)
        data = m.parse(path.read_text(encoding="utf-8"), str(path))
        if data.get("format") != JOURNAL_FORMAT or data.get("target") != str(target):
            raise m.MigrationError(
                "Undo journal does not belong to this data directory"
            )
        if path.parent.parent != m.safe_directory(target, UNDO_DIR):
            raise m.MigrationError("Undo journal is outside " + UNDO_DIR)
        return cls(path, data)

    @property
    def run_id(self):
        return self.data["runId"]

    def save(self):
        temporary = self.path.with_name(
            self.path.name + "." + uuid.uuid4().hex + ".tmp"
        )
        try:
            m.private_write(temporary, m.compact(self.data) + "\n")
            os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)

    def batch_dir(self):
        directory = self.dir / (
            "batch-" + str(int(time.time() * 1000)) + "-" + uuid.uuid4().hex[:8]
        )
        directory.mkdir(mode=0o700)
        return directory

    def prepare(self, db, target, rows):
        """Inside the batch's write transaction, before any write: intent + before-images."""
        sessions_root = target / "v2/sessions"
        for r in rows:
            workspace = r["workspace"]
            if workspace not in self.data["projects"]:
                before = project_row(db, workspace)
                self.data["projects"][workspace] = {
                    "existed": before is not None,
                    "before": before,
                    "after": None,
                }
            created = []
            path = sessions_root
            for part in Path(r["historyRelativeDir"]).parts:
                path = path / part
                if not path.exists():
                    created.append(str(path))
            self.data["sessions"].append(
                {
                    "targetId": r["targetId"],
                    "sourceId": r["sourceId"],
                    "historyRelativeDir": r["historyRelativeDir"],
                    "workspace": workspace,
                    "createdDirs": created,
                    "status": "pending",
                }
            )
        self.save()

    def _entries(self, rows):
        ids = {r["targetId"] for r in rows}
        return [
            e
            for e in self.data["sessions"]
            if e["targetId"] in ids and e["status"] == "pending"
        ]

    def committed(self, db, target, rows):
        """After commit and read-back: inserted row ids and a fingerprint per session."""
        for entry in self._entries(rows):
            sid = entry["targetId"]
            entry["rows"] = {
                "messageRowIds": [
                    r[0]
                    for r in db.execute(
                        "SELECT id FROM local_runtime_message_rows WHERE session_id=? ORDER BY id",
                        (sid,),
                    )
                ],
                "ftsRowids": [
                    r[0]
                    for r in db.execute(
                        "SELECT fts_rowid FROM local_runtime_session_fts_keys WHERE session_id=?",
                        (sid,),
                    )
                ],
                "projectId": db.execute(
                    "SELECT project_id FROM local_runtime_sessions WHERE session_id=?",
                    (sid,),
                ).fetchone()[0],
                "historyFileMigration": True,
            }
            entry["fingerprint"] = session_state(
                db, target, sid, entry["historyRelativeDir"]
            )
            entry["status"] = "committed"
        for workspace, project in self.data["projects"].items():
            after = project_row(db, workspace)
            if after is not None:
                project["after"] = {
                    k: after[k] for k in ("project_id", "hidden", "extra_data_json")
                }
        self.save()

    def rolled_back(self, rows):
        for entry in self._entries(rows):
            entry["status"] = "rolled-back"
        self.save()


def changes(saved, current):
    return sorted(k for k in saved if saved.get(k) != current.get(k))


def undo(target, journal_path, force=False):
    """Remove what one apply run added. Idempotent; refuses on later use unless forced."""
    target = m.target_path(target)
    with m.migration_lock(target):
        journal = Journal.load(journal_path, target)
        return _undo_locked(target, journal, force)


def _undo_locked(target, journal, force):
    dbfile = target / "v2/sqlite/runtime-state.sqlite"
    entries = [
        e
        for e in journal.data["sessions"]
        if e["status"] in ("committed", "pending", "undone")
    ]
    removed, absent, foreign, modified, warnings = [], [], [], [], []
    with m.connect(dbfile, True) as db:
        db.execute("BEGIN IMMEDIATE")
        for entry in entries:
            sid = entry["targetId"]
            row = db.execute(
                "SELECT history_relative_dir,agent_name FROM local_runtime_sessions WHERE session_id=?",
                (sid,),
            ).fetchone()
            if row is None:
                absent.append(entry)
                continue
            if (
                row["history_relative_dir"] != entry["historyRelativeDir"]
                or row["agent_name"] != journal.data["agent"]
            ):
                raise m.MigrationError("Undo target identity conflict: " + sid)
            marker = target / "v2/sessions" / entry["historyRelativeDir"] / m.MARKER
            owner = None
            if marker.is_file():
                owner = m.parse(marker.read_text(encoding="utf-8"), str(marker)).get(
                    "undoRun"
                )
            if owner not in (None, journal.run_id):
                if entry["status"] == "undone":
                    # Undone here, then imported again by a later run: not ours now.
                    foreign.append(entry)
                    continue
                raise m.MigrationError("Session belongs to another import run: " + sid)
            current = session_state(db, target, sid, entry["historyRelativeDir"])
            if entry["status"] != "committed":
                modified.append(
                    {
                        "targetId": sid,
                        "sourceId": entry["sourceId"],
                        "changed": ["unverified"],
                    }
                )
            else:
                changed = changes(entry["fingerprint"], current)
                if changed:
                    modified.append(
                        {
                            "targetId": sid,
                            "sourceId": entry["sourceId"],
                            "changed": changed,
                        }
                    )
            removed.append(entry)
        if modified and not force:
            db.rollback()
            raise UndoRefused(
                str(len(modified))
                + " imported session(s) changed after import (for example the conversation "
                "was continued); nothing was undone. Repeat with --force to remove them anyway",
                modified,
            )
        for entry in removed:
            sid = entry["targetId"]
            db.execute(
                "DELETE FROM local_runtime_message_rows WHERE session_id=?", (sid,)
            )
            db.execute(
                "DELETE FROM local_runtime_pi_history_file_migrations WHERE session_id=?",
                (sid,),
            )
            for (rowid,) in db.execute(
                "SELECT fts_rowid FROM local_runtime_session_fts_keys WHERE session_id=?",
                (sid,),
            ).fetchall():
                db.execute(
                    "DELETE FROM local_runtime_sessions_fts WHERE rowid=?", (rowid,)
                )
            db.execute(
                "DELETE FROM local_runtime_session_fts_keys WHERE session_id=?", (sid,)
            )
            # The session delete trigger recomputes the project's counters.
            db.execute("DELETE FROM local_runtime_sessions WHERE session_id=?", (sid,))
        for workspace, project in journal.data["projects"].items():
            after = project.get("after")
            if not after:
                continue
            current = db.execute(
                "SELECT project_id,hidden,extra_data_json FROM local_runtime_projects WHERE project_id=?",
                (after["project_id"],),
            ).fetchone()
            if current is None:
                continue
            if not project["existed"]:
                left = db.execute(
                    "SELECT COUNT(*) FROM local_runtime_sessions WHERE project_id=?",
                    (after["project_id"],),
                ).fetchone()[0]
                if left:
                    warnings.append(
                        "Kept the DeepSeek project: it now holds sessions not from this import"
                    )
                else:
                    db.execute(
                        "DELETE FROM local_runtime_projects WHERE project_id=?",
                        (after["project_id"],),
                    )
                continue
            if dict(current) == after:
                before = project["before"]
                db.execute(
                    "UPDATE local_runtime_projects SET hidden=?,extra_data_json=? WHERE project_id=?",
                    (before["hidden"], before["extra_data_json"], after["project_id"]),
                )
            elif {
                "hidden": current["hidden"],
                "extra_data_json": current["extra_data_json"],
            } != {
                "hidden": project["before"]["hidden"],
                "extra_data_json": project["before"]["extra_data_json"],
            }:
                warnings.append(
                    "The DeepSeek project changed after import; its settings were left as they are"
                )
        db.commit()
    with m.connect(dbfile) as check:
        for entry in removed:
            sid = entry["targetId"]
            for table in (
                "local_runtime_sessions",
                "local_runtime_message_rows",
                "local_runtime_session_fts_keys",
                "local_runtime_pi_history_file_migrations",
            ):
                if check.execute(
                    "SELECT 1 FROM " + table + " WHERE session_id=? LIMIT 1", (sid,)
                ).fetchone():
                    raise m.MigrationError("Undo read-back found rows left in " + table)
            for rowid in entry.get("rows", {}).get("ftsRowids", []):
                if check.execute(
                    "SELECT 1 FROM local_runtime_sessions_fts WHERE rowid=?", (rowid,)
                ).fetchone():
                    raise m.MigrationError("Undo read-back found a search entry left")
    kept = []
    for entry in removed + absent:
        directory = target / "v2/sessions" / entry["historyRelativeDir"]
        marker = directory / m.MARKER
        if marker.is_file() and m.parse(
            marker.read_text(encoding="utf-8"), str(marker)
        ).get("undoRun") not in (None, journal.run_id):
            continue
        if directory.is_dir() and not m.is_link(directory):
            names = {p.name for p in directory.iterdir()}
            if names <= OWN_FILES:
                for name in names:
                    (directory / name).unlink()
                directory.rmdir()
            else:
                # Later writes (e.g. a continued chat, forced undo): keep them aside.
                keep = journal.dir / "undone" / entry["targetId"]
                keep.parent.mkdir(mode=0o700, exist_ok=True)
                os.replace(directory, keep)
                kept.append(str(keep))
        for parent in reversed(entry.get("createdDirs", [])[:-1]):
            path = Path(parent)
            try:
                path.rmdir()
            except OSError:
                pass
        entry["status"] = "undone"
    journal.data["state"] = "undone"
    journal.data["undoneAtMs"] = int(time.time() * 1000)
    journal.save()
    return {
        "status": "undone",
        "journal": str(journal.path),
        "removed": len(removed),
        "alreadyAbsent": len(absent) + len(foreign),
        "forced": len(modified),
        "keptDirectories": kept,
        "warnings": warnings,
        "sessions": [
            {"sourceId": e["sourceId"], "targetId": e["targetId"]}
            for e in removed + absent
        ],
    }
