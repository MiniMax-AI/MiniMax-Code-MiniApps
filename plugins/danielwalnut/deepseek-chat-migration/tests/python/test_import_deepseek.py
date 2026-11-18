"""Behavior tests for the bundled DeepSeek importer (miniapp/python).

Ported from the DeepSeek source tests written for the team's agent-session-migration
plugin. The fixture is synthetic (see fixture.py); no real user data is used.
"""

import contextlib
import io
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SCRIPT = ROOT / "miniapp/python/import_deepseek.py"
sys.path.insert(0, str(SCRIPT.parent))
sys.path.insert(0, str(HERE))

import deepseek_core as m  # noqa: E402
import deepseek_export as ds  # noqa: E402
import import_deepseek as importer  # noqa: E402
from fixture import (  # noqa: E402
    BRANCHY,
    CUT,
    FILES,
    TARGET_SCHEMA,
    epoch_ms,
    sessions,
    write_export,
)


class ImporterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.env = patch.dict(
            os.environ, {"HOME": str(self.home), "USERPROFILE": str(self.home)}
        )
        self.env.start()
        self.zip = write_export(self.root / "deepseek_data-2026-10-03.zip", sessions())
        self.target = self.root / "data"
        (self.target / "v2/sqlite").mkdir(parents=True)
        with self.db() as db:
            db.executescript(TARGET_SCHEMA)
        self.reports = 0

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def db(self):
        return contextlib.closing(
            sqlite3.connect(self.target / "v2/sqlite/runtime-state.sqlite")
        )

    def args(self, command, ids=None, report=None, **options):
        if report is None:
            self.reports += 1
            report = self.root / ("job-%d.json" % self.reports)
        values = dict(
            command=command,
            source=str(self.zip),
            session=list(ids) if ids else None,
            all=not ids,
            report=str(report),
            data_dir=str(self.target),
            agent="mavis",
            workspace=str(self.home / "DeepSeek"),
            batch_size=20,
            retry_failed=False,
            restore_projects=False,
        )
        values.update(options)
        return SimpleNamespace(**values)

    def run_job(self, command, ids=None, **options):
        with contextlib.redirect_stderr(io.StringIO()):
            code, result = importer.execute(self.args(command, ids, **options))
        report = json.loads(Path(result["report"]).read_text())
        return code, result, report

    def imported(self, sid=BRANCHY):
        code, result, report = self.run_job("apply", [sid])
        self.assertEqual(code, 0, report)
        row = report["sessions"][0]["plan"]
        directory = self.target / "v2/sessions" / row["historyRelativeDir"]
        canonical = [
            json.loads(x)
            for x in (directory / "messages.jsonl").read_text().splitlines()
        ]
        with self.db() as db:
            display = [
                json.loads(r[0])
                for r in db.execute(
                    "SELECT data_json FROM local_runtime_message_rows WHERE session_id=? ORDER BY id",
                    (row["targetId"],),
                )
            ]
        return row, directory, display, canonical

    def cli(self, *argv):
        return subprocess.run(
            [sys.executable, str(SCRIPT), *argv],
            capture_output=True,
            timeout=60,
            env=dict(os.environ),
        )

    def test_fixture_uses_data_descriptors_like_the_official_export(self):
        with zipfile.ZipFile(self.zip) as archive:
            self.assertTrue(all(info.flag_bits & 0x08 for info in archive.infolist()))

    def test_scan_lists_sessions_without_writes(self):
        before = self.zip.read_bytes()
        out = self.cli("scan", "--source", str(self.zip))
        self.assertEqual(out.returncode, 0, out.stderr)
        rows = {r["id"]: r for r in json.loads(out.stdout)["sessions"]}
        self.assertEqual(set(rows), {BRANCHY, FILES, CUT})
        self.assertEqual(rows[BRANCHY]["title"], "量子计算入门")
        self.assertEqual(rows[BRANCHY]["messageCount"], 5)
        self.assertIsNone(rows[CUT]["title"])
        self.assertEqual(before, self.zip.read_bytes())
        self.assertFalse((self.home / "DeepSeek").exists())

    def test_zip_and_unpacked_folder_are_equivalent(self):
        folder = self.root / "unpacked"
        with zipfile.ZipFile(self.zip) as archive:
            archive.extractall(folder)
        zipped = ds.load_source(ds.source_path(str(self.zip)), [BRANCHY])[0]
        unpacked = ds.load_source(ds.source_path(str(folder)), [BRANCHY])[0]
        self.assertEqual(zipped["fingerprint"], unpacked["fingerprint"])

    def test_source_contract_is_checked(self):
        bad = write_export(self.root / "v2.zip", sessions(), version=2)
        with self.assertRaisesRegex(m.MigrationError, "export_format_version"):
            ds.source_path(str(bad))
        text = self.root / "not.zip"
        text.write_text("nope")
        with self.assertRaises(m.MigrationError):
            ds.source_path(str(text))
        link = self.root / "link.zip"
        link.symlink_to(self.zip)
        with self.assertRaises(m.MigrationError):
            ds.source_path(str(link))

    def test_plan_is_preview_only_and_creates_the_workspace(self):
        code, result, report = self.run_job("plan", [BRANCHY, FILES, CUT])
        self.assertEqual((code, result["counts"]), (0, {"ready": 3}))
        self.assertTrue((self.home / "DeepSeek").is_dir())
        plans = {e["sourceId"]: e["plan"] for e in report["sessions"]}
        self.assertEqual(plans[BRANCHY]["title"], "[From DeepSeek] 量子计算入门")
        self.assertEqual(plans[CUT]["title"], "[From DeepSeek] 写一首长诗")
        self.assertEqual(
            plans[BRANCHY]["createdAtMs"], epoch_ms("2026-10-01T08:00:00.000Z")
        )
        self.assertEqual(
            plans[BRANCHY]["sourceUpdatedAtMs"], epoch_ms("2026-10-01T09:30:00.000Z")
        )
        self.assertEqual(
            plans[BRANCHY]["workspace"], str((self.home / "DeepSeek").resolve())
        )
        with self.db() as db:
            self.assertEqual(
                db.execute("SELECT COUNT(*) FROM local_runtime_sessions").fetchone()[0],
                1,
            )
        self.assertFalse((self.target / "v2/sessions").exists())

    def test_workspace_must_be_a_real_directory(self):
        (self.home / "DeepSeek").write_text("file")
        with self.assertRaisesRegex(m.MigrationError, "not a directory"):
            self.run_job("plan", [BRANCHY])

    def test_only_active_branch_is_displayed_and_continued(self):
        row, directory, display, canonical = self.imported()
        self.assertEqual((row["messageCount"], row["canonicalMessageCount"]), (4, 4))
        dumped = json.dumps([display, canonical], ensure_ascii=False)
        self.assertNotIn("OLD_ANSWER_DISCARDED", dumped)
        self.assertIn("NEW_ANSWER_KEPT", dumped)
        self.assertIn("TEMPLATE_KEPT", dumped)
        self.assertEqual(
            [r["message"]["role"] for r in canonical],
            ["user", "assistant", "user", "assistant"],
        )
        archive = (directory / "deepseek-source.json").read_text(encoding="utf-8")
        self.assertIn("OLD_ANSWER_DISCARDED", archive)
        self.assertTrue(any("inactive branches" in w for w in row["warnings"]))
        self.assertEqual(display[0]["turn_id"], display[1]["turn_id"])
        self.assertEqual(display[2]["turn_id"], display[3]["turn_id"])
        self.assertNotEqual(display[0]["turn_id"], display[2]["turn_id"])

    def test_thinking_is_display_only(self):
        _, _, display, canonical = self.imported()
        self.assertEqual(display[1]["thinking_content"], "HIDDEN_REASONING_ONLY")
        self.assertNotIn(
            "HIDDEN_REASONING_ONLY", json.dumps(canonical, ensure_ascii=False)
        )

    def test_search_results_are_historical_reference_text(self):
        _, _, display, canonical = self.imported()
        tools = display[1]["tool_calls"]
        self.assertEqual(len(tools), 1)
        self.assertEqual(tools[0]["tool_name"], "历史工具记录")
        self.assertIn("web_search", tools[0]["tool_call_args"])
        context = canonical[1]["message"]["content"][0]["text"]
        self.assertIn("[DeepSeek 历史工具记录；仅供阅读，不重新执行]", context)
        self.assertIn("qubit definition", context)
        self.assertIn("https://example.org/qubit", context)
        self.assertIn("RISK_NOTICE", context)
        self.assertNotIn("ICON_PAYLOAD_NOT_MIGRATED", json.dumps([display, canonical]))

    def test_message_timestamps_and_identity_scheme(self):
        _, _, display, canonical = self.imported()
        self.assertEqual(display[0]["timestamp"], epoch_ms("2026-10-01T08:00:01.001Z"))
        self.assertEqual(
            canonical[3]["message"]["timestamp"], epoch_ms("2026-10-01T08:00:05.005Z")
        )
        self.assertTrue(canonical[0]["message_id"].startswith("msg-user-v1-"))
        self.assertTrue(canonical[1]["message_id"].startswith("msg-deepseek-"))
        self.assertEqual(canonical[1]["message"]["provider"], "deepseek-history")

    def test_attachments_are_reference_only_by_default(self):
        row, directory, display, canonical = self.imported(FILES)
        self.assertIn(
            "[DeepSeek 历史附件引用，未复制文件]\nreport.pdf", display[0]["msg_content"]
        )
        self.assertIn("report.pdf", canonical[0]["message"]["content"][0]["text"])
        self.assertTrue(any("Attachment reference" in w for w in row["warnings"]))
        self.assertEqual(
            sorted(p.name for p in directory.iterdir()),
            [
                "deepseek-migration.json",
                "deepseek-source.json",
                "manifest.json",
                "messages.jsonl",
            ],
        )
        self.assertNotIn("%PDF", (directory / "deepseek-source.json").read_text())

    def test_incomplete_reply_keeps_error_note(self):
        _, _, _, canonical = self.imported(CUT)
        text = canonical[1]["message"]["content"][0]["text"]
        self.assertIn("[DeepSeek 历史错误]", text)
        self.assertIn("TIMEOUT", text)

    def test_history_initialized_searchable_and_in_deepseek_project(self):
        row, _, _, canonical = self.imported()
        with self.db() as db:
            checkpoint = db.execute(
                "SELECT message_count,target_revision FROM local_runtime_pi_history_file_migrations WHERE session_id=?",
                (row["targetId"],),
            ).fetchone()
            self.assertEqual(checkpoint, (4, m.history_revision(canonical)))
            hits = db.execute(
                "SELECT session_id FROM local_runtime_sessions_fts WHERE local_runtime_sessions_fts MATCH ?",
                ('"' + m.search_terms("From DeepSeek") + '"',),
            ).fetchall()
            self.assertEqual(hits, [(row["targetId"],)])
            project = db.execute(
                "SELECT p.workspace_dir FROM local_runtime_projects p JOIN local_runtime_sessions s USING(project_id) WHERE s.session_id=?",
                (row["targetId"],),
            ).fetchone()[0]
            self.assertEqual(Path(project).name, "DeepSeek")

    def test_provenance_is_deepseek_scoped_and_hides_account_id(self):
        _, directory, _, _ = self.imported()
        marker = json.loads((directory / "deepseek-migration.json").read_text())
        self.assertEqual(
            (marker["sourceType"], marker["sourceId"]), ("deepseek", BRANCHY)
        )
        self.assertNotIn("user-42", json.dumps(marker))

    def counts(self):
        tables = (
            "local_runtime_sessions",
            "local_runtime_message_rows",
            "local_runtime_session_fts_keys",
            "local_runtime_sessions_fts",
            "local_runtime_pi_history_file_migrations",
        )
        with self.db() as db:
            result = {
                t: db.execute("SELECT COUNT(*) FROM " + t).fetchone()[0] for t in tables
            }
            result["projects"] = [
                tuple(r)
                for r in db.execute(
                    "SELECT project_id,workspace_dir,hidden,extra_data_json,session_count,latest_activity_at_ms FROM local_runtime_projects ORDER BY project_id"
                )
            ]
            result["integrity"] = db.execute("PRAGMA integrity_check").fetchone()[0]
        result["files"] = (
            sorted(
                str(p.relative_to(self.target))
                for p in (self.target / "v2/sessions").rglob("*")
            )
            if (self.target / "v2/sessions").exists()
            else []
        )
        return result

    def undo(self, report, **options):
        values = dict(
            command="undo",
            source=None,
            session=None,
            all=False,
            report=str(report),
            run=None,
            data_dir=str(self.target),
            force=False,
        )
        values.update(options)
        with contextlib.redirect_stderr(io.StringIO()):
            return importer.execute(SimpleNamespace(**values))

    def test_no_database_copy_one_undo_journal_per_run(self):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            code, result = importer.execute(
                self.args("apply", [BRANCHY, FILES, CUT], batch_size=1)
            )
        self.assertEqual(code, 0)
        self.assertEqual(result["counts"], {"imported": 3})
        report = json.loads(Path(result["report"]).read_text())
        self.assertEqual(len(report["batches"]), 3)
        self.assertEqual({b["undo"] for b in report["batches"]}, {report["undo"]})
        journal = Path(report["undo"])
        self.assertEqual(journal.parent.parent, self.target / "deepseek-migration")
        data = json.loads(journal.read_text())
        self.assertEqual([e["status"] for e in data["sessions"]], ["committed"] * 3)
        self.assertTrue(all(e["rows"]["messageRowIds"] for e in data["sessions"]))
        self.assertTrue(all(e["rows"]["ftsRowids"] for e in data["sessions"]))
        # The project did not exist before: no before-image, created by this run.
        project = data["projects"][str((self.home / "DeepSeek").resolve())]
        self.assertFalse(project["existed"])
        databases = [
            p
            for p in self.target.rglob("*")
            if p.suffix == ".sqlite" and p.name != "runtime-state.sqlite"
        ]
        self.assertEqual(databases, [])

    def test_undo_removes_exactly_the_run_and_is_idempotent(self):
        before = self.counts()
        _, result, report = self.run_job("apply", [BRANCHY, FILES, CUT])
        self.assertEqual(result["counts"], {"imported": 3})
        self.assertNotEqual(self.counts(), before)
        code, undone = self.undo(result["report"])
        self.assertEqual(code, 0)
        self.assertEqual((undone["removed"], undone["alreadyAbsent"]), (3, 0))
        self.assertEqual(self.counts(), before)
        again = self.undo(result["report"])[1]
        self.assertEqual((again["removed"], again["alreadyAbsent"]), (0, 3))
        self.assertEqual(self.counts(), before)
        # The undone report cannot be resumed; a fresh preview imports again.
        with self.assertRaises(m.MigrationError):
            importer.execute(self.args("apply", [BRANCHY], report=result["report"]))
        old_report = result["report"]
        _, result, _ = self.run_job("apply", [BRANCHY, FILES, CUT])
        self.assertEqual(result["counts"], {"imported": 3})
        imported = self.counts()
        # Undoing the old run again must not touch the later run's sessions.
        stale = self.undo(old_report)[1]
        self.assertEqual((stale["removed"], stale["alreadyAbsent"]), (0, 3))
        self.assertEqual(self.counts(), imported)

    def test_undo_restores_the_project_before_image(self):
        workspace = str((self.home / "DeepSeek").resolve())
        (self.home / "DeepSeek").mkdir()
        with self.db() as db:
            db.execute(
                "INSERT INTO local_runtime_projects(project_kind,workspace_dir,created_at_ms,updated_at_ms,hidden,extra_data_json) VALUES('workspace',?,1,1,1,'{\"note\":1}')",
                (workspace,),
            )
            db.commit()
        before = self.counts()
        _, result, _ = self.run_job("apply", [BRANCHY, CUT], restore_projects=True)
        self.assertEqual(result["counts"], {"imported": 2})
        with self.db() as db:
            hidden, count = db.execute(
                "SELECT hidden,session_count FROM local_runtime_projects"
            ).fetchone()
        self.assertEqual((hidden, count), (0, 2))
        self.undo(result["report"])
        self.assertEqual(self.counts(), before)

    def test_undo_refuses_sessions_used_after_import_unless_forced(self):
        before = self.counts()
        _, result, report = self.run_job("apply", [BRANCHY, CUT])
        plan = report["sessions"][0]["plan"]
        directory = self.target / "v2/sessions" / plan["historyRelativeDir"]
        # Continue the conversation: one more row and history line, plus a new file.
        with self.db() as db:
            db.execute(
                "INSERT INTO local_runtime_message_rows(session_id,msg_id,role,created_at_ms,data_json) VALUES(?,?,?,?,?)",
                (plan["targetId"], "msg-later", "user", 1, "{}"),
            )
            db.commit()
        with open(directory / "messages.jsonl", "a") as history:
            history.write('{"later":true}\n')
        (directory / "reports").mkdir()
        with self.assertRaises(importer.undo_journal.UndoRefused) as refused:
            self.undo(result["report"])
        self.assertEqual(
            [s["targetId"] for s in refused.exception.sessions], [plan["targetId"]]
        )
        self.assertIn("messageRows", refused.exception.sessions[0]["changed"])
        self.assertTrue(directory.exists())
        with self.db() as db:
            self.assertEqual(
                db.execute(
                    "SELECT COUNT(*) FROM local_runtime_sessions WHERE title LIKE '[From DeepSeek]%'"
                ).fetchone()[0],
                2,
            )
        _, forced = self.undo(result["report"], force=True)
        self.assertEqual((forced["removed"], forced["forced"]), (2, 1))
        # Later writes are kept aside in the run directory, never deleted.
        self.assertEqual(len(forced["keptDirectories"]), 1)
        self.assertTrue(Path(forced["keptDirectories"][0], "reports").is_dir())
        after = self.counts()
        self.assertEqual(
            {k: v for k, v in after.items() if k != "files"},
            {k: v for k, v in before.items() if k != "files"},
        )

    def test_cli_undo_exit_codes(self):
        _, result, report = self.run_job("apply", [BRANCHY])
        plan = report["sessions"][0]["plan"]
        with self.db() as db:
            db.execute(
                "UPDATE local_runtime_sessions SET title='renamed' WHERE session_id=?",
                (plan["targetId"],),
            )
            db.commit()
        base = ["undo", "--report", result["report"], "--data-dir", str(self.target)]
        refused = self.cli(*base)
        self.assertEqual(refused.returncode, 3)
        error = json.loads(refused.stderr.decode().strip().splitlines()[-1])
        self.assertEqual(error["type"], "UndoRefused")
        self.assertEqual(error["modified"][0]["changed"], ["title"])
        forced = self.cli(*base, "--force")
        self.assertEqual(forced.returncode, 0, forced.stderr)
        self.assertEqual(json.loads(forced.stdout)["removed"], 1)

    def test_apply_reports_progress_after_every_batch(self):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            importer.execute(self.args("apply", [BRANCHY, FILES, CUT], batch_size=2))
        events = []
        for line in stderr.getvalue().splitlines():
            value = json.loads(line)
            if "event" in value:
                events.append(value)
        self.assertEqual(
            [e["event"] for e in events], ["start", "progress", "progress"]
        )
        self.assertEqual(events[0]["total"], 3)
        self.assertEqual(
            [(e["done"], e["total"]) for e in events[1:]], [(2, 3), (3, 3)]
        )
        landed = [s for e in events[1:] for s in e["sessions"]]
        self.assertEqual(
            sorted(s["sourceId"] for s in landed), sorted([BRANCHY, FILES, CUT])
        )
        self.assertEqual({s["status"] for s in landed}, {"imported"})

    def test_nothing_to_write_opens_no_journal(self):
        self.run_job("apply", [BRANCHY])
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            _, result = importer.execute(self.args("apply", [BRANCHY]))
        report = json.loads(Path(result["report"]).read_text())
        self.assertEqual(result["counts"], {"already-imported": 1})
        self.assertIsNone(report.get("undo"))
        # Only the first import's journal exists.
        self.assertEqual(len(list((self.target / "deepseek-migration").iterdir())), 1)

    def test_idempotent_even_when_the_same_export_is_uploaded_again(self):
        first, _, _, _ = self.imported()
        code, result, _ = self.run_job("apply", [BRANCHY])
        self.assertEqual(result["counts"], {"already-imported": 1})
        copy = self.root / "upload-2" / "deepseek-export.zip"
        copy.parent.mkdir()
        shutil.copyfile(self.zip, copy)
        self.zip = copy
        _, result, report = self.run_job("apply", [BRANCHY])
        self.assertEqual(result["counts"], {"already-imported": 1})
        self.assertEqual(report["sessions"][0]["plan"]["targetId"], first["targetId"])
        self.zip = write_export(self.root / "other.zip", sessions(), user_id="user-43")
        _, _, report = self.run_job("plan", [BRANCHY])
        self.assertNotEqual(
            report["sessions"][0]["plan"]["targetId"], first["targetId"]
        )

    def test_matches_agent_session_migration_identity(self):
        # Same hash input as the plugin's DeepSeek source: "deepseek-account:<id>".
        key = ds.identity_root(ds.source_path(str(self.zip)))
        self.assertEqual(key, "deepseek-account:user-42")
        self.assertRegex(m.identity(key, BRANCHY), r"^mvs_[0-9a-f]{32}$")

    def test_changed_source_is_isolated_not_overwritten(self):
        self.imported()
        records = sessions()
        records[BRANCHY]["messages"][4]["fragments"][0]["content"] = "REWRITTEN"
        self.zip = write_export(self.root / "later-export.zip", records)
        code, result, report = self.run_job("apply", [BRANCHY, CUT])
        self.assertEqual(code, 2)
        status = {e["sourceId"]: e for e in report["sessions"]}
        self.assertEqual(status[BRANCHY]["status"], "incompatible")
        self.assertIn("Source changed", status[BRANCHY]["error"])
        self.assertEqual(status[CUT]["status"], "imported")

    def test_broken_branch_pointer_fails_only_that_session(self):
        records = sessions()
        records[CUT]["current_message_id"] = 99
        self.zip = write_export(self.root / "broken.zip", records)
        code, result, _ = self.run_job("apply", [BRANCHY, FILES, CUT])
        self.assertEqual(code, 2)
        self.assertEqual(result["counts"], {"imported": 2, "incompatible": 1})

    def test_failed_batch_is_split_and_retried_per_session(self):
        with contextlib.redirect_stderr(io.StringIO()):
            code, result = importer.execute(
                self.args("apply", [BRANCHY, FILES, CUT]), fail_after=2
            )
        # The 3-session batch rolls back; single-session retries then succeed until
        # the injected failure point is no longer reachable.
        report = json.loads(Path(result["report"]).read_text())
        self.assertEqual(
            {e["status"] for e in report["sessions"]} - {"imported", "failed"}, set()
        )
        with self.db() as db:
            rows = db.execute("SELECT COUNT(*) FROM local_runtime_sessions").fetchone()[
                0
            ]
        self.assertEqual(rows - 1, result["counts"].get("imported", 0))

    def test_cli_plan_then_apply_reuses_the_report(self):
        report = self.root / "cli.json"
        base = [
            "--source",
            str(self.zip),
            "--session",
            BRANCHY,
            "--session",
            FILES,
            "--report",
            str(report),
            "--data-dir",
            str(self.target),
            "--agent",
            "mavis",
            "--workspace",
            str(self.home / "DeepSeek"),
        ]
        planned = self.cli("plan", *base)
        self.assertEqual(planned.returncode, 0, planned.stderr)
        self.assertEqual(json.loads(planned.stdout)["counts"], {"ready": 2})
        self.assertEqual(self.cli("plan", *base).returncode, 1)  # never overwritten
        applied = self.cli("apply", *base)
        self.assertEqual(applied.returncode, 0, applied.stderr)
        result = json.loads(applied.stdout)
        self.assertEqual(
            (result["status"], result["counts"], result["sourceType"]),
            ("completed", {"imported": 2}, "deepseek"),
        )
        again = self.cli("apply", *base)
        self.assertEqual(json.loads(again.stdout)["counts"], {"imported": 2})
        # Changing options against the same report is refused, not silently widened.
        mismatch = self.cli("apply", *base, "--restore-projects")
        self.assertEqual(mismatch.returncode, 1)

    def test_cli_apply_without_preview_previews_first(self):
        report = self.root / "direct.json"
        out = self.cli(
            "apply",
            "--source",
            str(self.zip),
            "--session",
            CUT,
            "--report",
            str(report),
            "--data-dir",
            str(self.target),
        )
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(json.loads(out.stdout)["counts"], {"imported": 1})
        self.assertTrue((self.home / "DeepSeek").is_dir())  # default workspace

    def test_cli_reports_contract_errors(self):
        out = self.cli(
            "plan",
            "--source",
            str(self.zip),
            "--session",
            BRANCHY,
            "--report",
            str(self.root / "x.json"),
            "--data-dir",
            str(self.root / "missing"),
        )
        self.assertEqual(out.returncode, 1)
        self.assertIn(b'"error"', out.stderr)
        with self.db() as db:
            db.execute("DELETE FROM local_runtime_sessions")
            db.commit()
        out = self.cli(
            "plan",
            "--source",
            str(self.zip),
            "--session",
            BRANCHY,
            "--report",
            str(self.root / "y.json"),
            "--data-dir",
            str(self.target),
        )
        self.assertEqual(out.returncode, 1)
        self.assertIn(b"initialize it in MiniMax Code first", out.stderr)


if __name__ == "__main__":
    unittest.main()
