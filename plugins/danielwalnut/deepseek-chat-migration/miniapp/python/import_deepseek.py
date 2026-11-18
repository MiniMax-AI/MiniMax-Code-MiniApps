#!/usr/bin/env python3
"""Import selected DeepSeek conversations as native MiniMax Code sessions.

Bundled with the DeepSeek Chat Migration Mini App; Python 3.9+, standard library only.
The checkpointed job below is adapted from the team's agent-session-migration plugin.

  import_deepseek.py scan  --source <export.zip>
  import_deepseek.py plan  --source <export.zip> (--session ID... | --all) --report <job.json>
  import_deepseek.py apply --source <export.zip> (--session ID... | --all) --report <job.json>
  import_deepseek.py undo  (--report <job.json> | --run <undo.json>) [--force]
  import_deepseek.py project   (read-only: DeepSeek project session count + latest id)

Defaults: --data-dir ~/.minimax, --agent mavis, --workspace ~/DeepSeek (created when
missing; mkdir only). `plan` writes a preview report and changes nothing else.
`apply` resumes that report; given a report path that does not exist yet, it previews
into it first. There is no full database copy: before each batch writes, inside its
transaction, the run's undo journal (~/.minimax/deepseek-migration/<run>/undo.json)
records what the batch will add and the before-image of the one existing row it may
update; each batch commits in its own transaction and is read back, a failed session
never blocks the others, and re-running is idempotent. `undo` removes exactly what one
run added and refuses if those sessions were used since (unless --force).

Exit codes: 0 completed, 2 completed with per-session errors, 1 configuration or
contract error, 3 undo refused (sessions used since import), 130 interrupted. A one-line JSON summary goes to stdout, progress
and errors to stderr; the report file holds per-session status. During apply, stderr
carries one JSON line per step: {"event":"start","total":N} and, after each batch, {"event":"progress","done":n,"total":N,"sessions":[{sourceId,status}]}.
Statuses:
  ready | already-imported | imported | incompatible | failed | running
"""

import argparse
import contextlib
import json
import os
import sqlite3
import sys
import uuid
from pathlib import Path

if sys.version_info < (3, 9):
    sys.stderr.write(
        '{"error":"Python 3.9 or newer is required","type":"RuntimeError"}\n'
    )
    sys.exit(1)

sys.path.insert(0, str(Path(__file__).resolve().parent))

import deepseek_core as m  # noqa: E402
import deepseek_export as ds  # noqa: E402
import deepseek_undo as undo_journal  # noqa: E402

VERSION = 1
DONE = {"imported", "already-imported"}
ERRORS = (m.MigrationError, sqlite3.Error, OSError, ValueError)


def save(path, report, create=False):
    if create:
        m.private_write(path, m.compact(report) + "\n")
        return
    m.regular(path)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        m.private_write(temporary, m.compact(report) + "\n")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def summary(report, path):
    counts = {}
    for entry in report["sessions"]:
        counts[entry["status"]] = counts.get(entry["status"], 0) + 1
    return {
        "status": report["state"],
        "report": str(path),
        "total": len(report["sessions"]),
        "counts": counts,
        "discoveryErrors": len(report["discoveryErrors"]),
        "sourceBytes": report["sourceBytes"],
        "undo": report.get("undo"),
    }


def emit(event, **fields):
    """One progress line on stderr; the Mini App reads these while apply runs."""
    m.print_result(dict(event=event, **fields), file=sys.stderr)
    sys.stderr.flush()


@contextlib.contextmanager
def reader(job, data):
    """One open export and one read snapshot of the checked target, shared by every
    session previewed or re-checked in a step. Close it before writing."""
    with ds.Export(data["root"]) as export:
        with m.connect(job["target"] / "v2/sqlite/runtime-state.sqlite") as db:
            legacy = m.check_target(db, job["config"]["agent"])
            yield {"export": export, "db": db, "legacy": legacy}


def compatible(job, data, sid, view):
    try:
        items = ds.load_inventory(data, [sid], export=view["export"])
        if len(items) != 1 or not items[0]["messages"]:
            raise m.MigrationError("Selected session has no readable messages: " + sid)
        rows = m.plan_in(
            view["db"],
            view["legacy"],
            job["key"],
            job["target"],
            job["config"]["agent"],
            items,
            workspace=job["config"]["workspace"],
            restore_projects=job["config"]["restoreProjects"],
        )
        return items, m.public_plan(rows)[0]
    except (TypeError, KeyError, AttributeError, OverflowError) as exc:
        raise m.MigrationError(
            "Invalid source record structure for " + sid + ": " + str(exc)
        ) from exc


def recover(job, entry, committed_only=False):
    """Reconcile only an in-flight transaction, under the migration lock."""
    source, target, config = job["source"], job["target"], job["config"]
    row = entry["plan"]
    sid = m.identity(job["key"], entry["sourceId"])
    relative = m.history_dir(sid, row["sourceCreatedAtMs"])
    if row["targetId"] != sid or row["historyRelativeDir"] != relative:
        raise m.MigrationError("Invalid recovery identity")
    directory = m.safe_directory(target, "v2/sessions/" + relative)
    with m.connect(target / "v2/sqlite/runtime-state.sqlite") as db:
        existing = db.execute(
            "SELECT history_relative_dir,agent_name FROM local_runtime_sessions WHERE session_id=?",
            (sid,),
        ).fetchone()
        if existing:
            if (
                existing["history_relative_dir"] != relative
                or existing["agent_name"] != config["agent"]
            ):
                raise m.MigrationError("Recovery target identity conflict")
            marker = m.parse(
                m.regular(directory / m.MARKER).read_text(encoding="utf-8"),
                "migration marker",
            )
            if any(
                marker.get(key) != row[key]
                for key in ("fingerprint", "sourceId", "targetId", "workspace")
            ):
                raise m.MigrationError("Recovery provenance mismatch")
            # A session found already imported at preview time may come from an
            # earlier upload of the same export at another temporary path; identity
            # and fingerprint above already prove it. Only this job's own writes must
            # name this exact source file.
            own_write = entry["status"] != "already-imported"
            if marker.get("sourceType") != m.SOURCE_TYPE or (
                own_write and marker.get("source") != str(source)
            ):
                raise m.MigrationError("Recovery source mismatch")
            m.regular(directory / "messages.jsonl")
            count = db.execute(
                "SELECT COUNT(*) FROM local_runtime_message_rows WHERE session_id=?",
                (sid,),
            ).fetchone()[0]
            initialized = db.execute(
                "SELECT 1 FROM local_runtime_pi_history_file_migrations WHERE session_id=?",
                (sid,),
            ).fetchone()
            if count < row["messageCount"] or not initialized:
                raise m.MigrationError(
                    "Recovery found an incomplete committed session; inspect target"
                )
            entry["status"] = "imported"
            entry.pop("error", None)
            return
    if committed_only:
        raise m.MigrationError(
            "Previously completed target session is missing; inspect target before retry"
        )
    if directory.exists():
        # The running intent is saved before mkdir and the DB transaction. Keep this
        # uncommitted attempt aside; never delete history or restore the whole DB.
        quarantine = m.safe_directory(
            target, m.LOCK_DIR + "/recovered-" + uuid.uuid4().hex
        )
        os.replace(directory, quarantine)
        entry.setdefault("recoveredDirectories", []).append(str(quarantine))
    entry["status"] = "ready"


def preview(job, path, ids, batch_size):
    with m.connect(job["target"] / "v2/sqlite/runtime-state.sqlite") as db:
        m.check_target(db, job["config"]["agent"])
    data = ds.inventory(job["source"])
    selected = set(ids or [])
    preview_ids = sorted(data["ids"] if not ids else selected)
    discovery_errors = [
        e for e in data["errors"] if not ids or e.get("sourceId") in selected
    ]
    report = {
        "version": VERSION,
        "config": job["config"],
        "state": "previewing",
        "sessions": [],
        "discoveryErrors": discovery_errors,
        "batches": [],
        "sourceBytes": data["bytes"],
    }
    save(path, report, create=True)
    failures = {e.get("sourceId"): e["error"] for e in discovery_errors}
    known = set(data["ids"])
    with reader(job, data) as view:
        for sid in preview_ids:
            entry = {"sourceId": sid}
            try:
                if sid in failures:
                    raise m.MigrationError(failures[sid])
                if sid not in known:
                    raise m.MigrationError("Unknown DeepSeek session ID: " + sid)
                _, row = compatible(job, data, sid, view)
                entry.update(
                    status="already-imported"
                    if row["status"] == "already-imported"
                    else "ready",
                    plan=row,
                )
            except ERRORS as exc:
                entry.update(status="incompatible", error=str(exc))
            report["sessions"].append(entry)
    report["state"] = "planned"
    save(path, report)
    return report


def load_report(job, path):
    report = json.loads(m.regular(path).read_text(encoding="utf-8"))
    if (
        not isinstance(report, dict)
        or report.get("version") != VERSION
        or report.get("config") != job["config"]
    ):
        raise m.MigrationError(
            "Report source/target/options mismatch; preview again with the same options"
        )
    if report.get("state") == "undone":
        raise m.MigrationError("This import was undone; generate a new preview")
    if report.get("state") not in (
        "planned",
        "running",
        "completed",
        "completed-with-errors",
    ):
        raise m.MigrationError("Preview is incomplete; generate a new preview first")
    entries = report.get("sessions")
    if not isinstance(entries, list) or not isinstance(
        report.get("discoveryErrors"), list
    ):
        raise m.MigrationError("Invalid report lists")
    seen = set()
    for entry in entries:
        if (
            not isinstance(entry, dict)
            or not isinstance(entry.get("sourceId"), str)
            or entry["sourceId"] in seen
        ):
            raise m.MigrationError("Invalid or duplicate report identity")
        seen.add(entry["sourceId"])
        if entry.get("status") not in DONE | {
            "ready",
            "running",
            "failed",
            "incompatible",
        }:
            raise m.MigrationError("Invalid report status")
        if entry["status"] in DONE | {"ready", "running"} and not isinstance(
            entry.get("plan"), dict
        ):
            raise m.MigrationError("Missing report plan")
    report.setdefault("batches", [])
    return report


def run_apply(job, path, report, batch_size, retry_failed, fail_after=None):
    config = job["config"]
    with m.migration_lock(job["target"]):
        with m.connect(job["target"] / "v2/sqlite/runtime-state.sqlite") as db:
            m.check_target(db, config["agent"])
        for entry in report["sessions"]:
            if entry["status"] == "running" or entry["status"] in DONE:
                previous = entry["status"]
                recover(job, entry, committed_only=previous in DONE)
                if previous in DONE:
                    entry["status"] = previous
        report["state"] = "running"
        save(path, report)
        data = ds.inventory(job["source"])
        errors = {e.get("sourceId"): e["error"] for e in data["errors"]}
        pending = [
            e
            for e in report["sessions"]
            if e["status"] == "ready"
            or retry_failed
            and e["status"] in ("failed", "incompatible")
        ]

        emit("start", total=len(pending))
        run_journal = []

        def journal():
            # One undo journal per apply run, created right before its first write.
            if not run_journal:
                run_journal.append(
                    undo_journal.Journal.create(
                        job["target"], config["agent"], job["source"]
                    )
                )
                report["undo"] = str(run_journal[0].path)
            return run_journal[0]

        def commit(entries, items):
            for entry in entries:
                entry["status"] = "running"
            save(path, report)
            try:
                result = m._apply_locked(
                    job["source"],
                    job["key"],
                    job["target"],
                    config["agent"],
                    items,
                    workspace=config["workspace"],
                    restore_projects=config["restoreProjects"],
                    fail_after=fail_after,
                    journal=journal(),
                )
                report["batches"].append(
                    {k: result[k] for k in ("status", "undo", "report") if k in result}
                )
                for entry in entries:
                    entry["status"] = (
                        "imported"
                        if result["status"] == "imported"
                        else "already-imported"
                    )
                    entry.pop("error", None)
            except ERRORS as exc:
                # A commit can succeed before its report is saved. Reconcile against
                # SQLite before isolating failed members of a rolled-back batch.
                retry = []
                for entry, item in zip(entries, items):
                    try:
                        recover(job, entry)
                        if entry["status"] not in DONE:
                            retry.append((entry, item))
                    except ERRORS as recovery_error:
                        entry.update(status="failed", error=str(recovery_error))
                if len(entries) == 1:
                    for entry, _ in retry:
                        entry.update(status="failed", error=str(exc))
                else:
                    for entry, item in retry:
                        commit([entry], [item])
            save(path, report)
            m.print_result(summary(report, path), file=sys.stderr)

        done = 0
        for offset in range(0, len(pending), batch_size):
            chunk = pending[offset : offset + batch_size]
            entries, items = [], []
            # Re-check this batch against a fresh snapshot, then close it before writing.
            with reader(job, data) as view:
                for entry in chunk:
                    sid = entry["sourceId"]
                    try:
                        if sid in errors:
                            raise m.MigrationError(errors[sid])
                        loaded, row = compatible(job, data, sid, view)
                        if (
                            "plan" in entry
                            and row["fingerprint"] != entry["plan"]["fingerprint"]
                        ):
                            raise m.MigrationError(
                                "Source changed since preview; generate a new preview"
                            )
                        entry["plan"] = row
                        if row["status"] == "already-imported":
                            entry["status"] = "already-imported"
                            entry.pop("error", None)
                            continue
                        entries.append(entry)
                        items.extend(loaded)
                    except ERRORS as exc:
                        entry.update(status="failed", error=str(exc))
            save(path, report)
            if entries:
                commit(entries, items)
            done += len(chunk)
            emit(
                "progress",
                done=done,
                total=len(pending),
                sessions=[
                    {"sourceId": e["sourceId"], "status": e["status"]} for e in chunk
                ],
            )
        report["state"] = (
            "completed-with-errors"
            if report["discoveryErrors"]
            or any(e["status"] not in DONE for e in report["sessions"])
            else "completed"
        )
        save(path, report)
    return report


def prepare_workspace(value):
    """~/DeepSeek groups imported chats as one sidebar project. mkdir only."""
    path = Path(value).expanduser().absolute()
    if m.is_link(path):
        raise m.MigrationError("Workspace must not be a symlink: " + str(path))
    if path.exists() and not path.is_dir():
        raise m.MigrationError("Workspace exists but is not a directory: " + str(path))
    path.mkdir(parents=True, exist_ok=True)
    return str(path.resolve())


def run_undo(args):
    target = m.target_path(args.data_dir)
    if bool(args.report) == bool(args.run):
        raise m.MigrationError(
            "undo needs exactly one of --report <job.json> or --run <undo.json>"
        )
    report_path = None
    if args.report:
        report_path = Path(args.report).expanduser().absolute()
        report = json.loads(m.regular(report_path).read_text(encoding="utf-8"))
        journal_path = report.get("undo") if isinstance(report, dict) else None
        if not journal_path:
            raise m.MigrationError("This report has no import to undo")
    else:
        journal_path = args.run
    result = undo_journal.undo(target, journal_path, force=args.force)
    if report_path is not None:
        report["state"] = "undone"
        save(report_path, report)
    return 0, result


def project(args):
    """Read-only: the DeepSeek project's session count and most recently active session."""
    target = m.target_path(args.data_dir)
    workspace = str(Path(args.workspace).expanduser().absolute().resolve())
    with m.connect(target / "v2/sqlite/runtime-state.sqlite") as db:
        where = (
            " FROM local_runtime_sessions WHERE agent_name=? AND workspace_dir=?"
            " AND columnar_version=3 AND archived=0"
        )
        count = db.execute(
            "SELECT COUNT(*)" + where, (args.agent, workspace)
        ).fetchone()[0]
        latest = db.execute(
            "SELECT session_id" + where + " ORDER BY updated_at_ms DESC LIMIT 1",
            (args.agent, workspace),
        ).fetchone()
    return 0, {
        "workspace": workspace,
        "sessionCount": count,
        "latestSessionId": latest[0] if latest else None,
    }


def execute(args, fail_after=None):
    if args.command == "undo":
        return run_undo(args)
    if args.command == "project":
        return project(args)
    if not args.source:
        raise m.MigrationError("scan/plan/apply require --source <export.zip>")
    source = ds.source_path(args.source)
    if args.command == "scan":
        return 0, {"source": str(source), "sessions": ds.overview(source, args.session)}
    if bool(args.all) == bool(args.session):
        raise m.MigrationError(
            "Choose exactly one scope: --all or one/more --session IDs"
        )
    if not args.report:
        raise m.MigrationError("plan/apply require --report <job.json>")
    if not 1 <= args.batch_size <= 100:
        raise m.MigrationError("--batch-size must be between 1 and 100")
    if args.retry_failed and args.command != "apply":
        raise m.MigrationError("--retry-failed requires apply")
    target = m.target_path(args.data_dir)
    path = Path(args.report).expanduser().absolute()
    if m.is_link(path):
        raise m.MigrationError("Linked report path")
    path = path.resolve()
    if path == source or source in path.parents:
        raise m.MigrationError("Report must be outside the DeepSeek export")
    workspace = prepare_workspace(args.workspace)
    job = {
        "source": source,
        "key": ds.identity_root(source),
        "target": target,
        "config": {
            "source": str(source),
            "target": str(target),
            "agent": args.agent,
            "sourceType": m.SOURCE_TYPE,
            "adapterVersion": m.ADAPTER_VERSION,
            "restoreProjects": args.restore_projects,
            "selection": {"mode": "all"}
            if args.all
            else {"mode": "selected", "ids": sorted(set(args.session))},
            "workspace": workspace,
        },
    }
    if args.command == "plan":
        if path.exists():
            raise m.MigrationError(
                "Preview report already exists; use a new report path or run apply"
            )
        report = preview(job, path, args.session, args.batch_size)
    else:
        if path.exists():
            report = load_report(job, path)
        else:
            report = preview(job, path, args.session, args.batch_size)
        report = run_apply(
            job, path, report, args.batch_size, args.retry_failed, fail_after
        )
    result = summary(report, path)
    result["sourceType"] = m.SOURCE_TYPE
    return (2 if result["status"] == "completed-with-errors" else 0), result


def parser():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("command", choices=["scan", "plan", "apply", "undo", "project"])
    p.add_argument("--source", help="DeepSeek export zip or unpacked folder")
    p.add_argument(
        "--session", action="append", help="DeepSeek session id (repeatable)"
    )
    p.add_argument("--all", action="store_true", help="Every session in the export")
    p.add_argument("--report", help="Preview and progress JSON path (plan/apply)")
    p.add_argument("--data-dir", default=str(Path.home() / ".minimax"))
    p.add_argument("--agent", default="mavis")
    p.add_argument("--workspace", default=str(Path.home() / "DeepSeek"))
    p.add_argument("--batch-size", type=int, default=20)
    p.add_argument("--retry-failed", action="store_true")
    p.add_argument("--run", help="undo: the run's undo.json (or its directory)")
    p.add_argument(
        "--force",
        action="store_true",
        help="undo: also remove sessions that were used after import",
    )
    p.add_argument(
        "--restore-projects",
        action="store_true",
        help="Restore the workspace project if it was removed from the sidebar",
    )
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        code, result = execute(args)
    except undo_journal.UndoRefused as exc:
        m.print_result(
            {"error": str(exc), "type": "UndoRefused", "modified": exc.sessions},
            file=sys.stderr,
        )
        return 3
    except ERRORS as exc:
        m.print_result({"error": str(exc), "type": type(exc).__name__}, file=sys.stderr)
        return 1
    m.print_result(result)
    return code


if __name__ == "__main__":
    import signal

    def interrupted(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        m.print_result(
            {
                "status": "interrupted",
                "resume": "Repeat apply with the same --report and options",
            },
            file=sys.stderr,
        )
        sys.exit(130)
