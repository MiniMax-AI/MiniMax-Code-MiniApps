"""Synthetic DeepSeek export_format_version 3 fixture shared by the importer tests."""

import io
import json
import zipfile
from datetime import datetime

TARGET_SCHEMA = """CREATE TABLE local_runtime_sessions(session_id TEXT PRIMARY KEY,record_json TEXT,updated_at_ms INTEGER,columnar_version INTEGER,agent_name TEXT,runtime TEXT,session_type TEXT,status TEXT,archived INTEGER,visibility TEXT,session_kind TEXT,purpose_kind TEXT,workspace_dir TEXT,project_workspace_dir TEXT,is_default_workspace INTEGER,title TEXT,created_at_ms INTEGER,extra_data_json TEXT,project_id INTEGER,history_relative_dir TEXT);
CREATE TABLE local_runtime_message_rows(id INTEGER PRIMARY KEY,session_id TEXT,msg_id TEXT,role TEXT,turn_id TEXT,source TEXT,created_at_ms INTEGER,data_json TEXT,UNIQUE(session_id,msg_id));
CREATE TABLE local_runtime_pi_history_file_migrations(session_id TEXT PRIMARY KEY,migrated_at_ms INTEGER NOT NULL,source TEXT NOT NULL,message_count INTEGER NOT NULL,target_revision TEXT NOT NULL);
CREATE TABLE local_runtime_projects(project_id INTEGER PRIMARY KEY,project_kind TEXT,workspace_dir TEXT,created_at_ms INTEGER,updated_at_ms INTEGER,hidden INTEGER NOT NULL DEFAULT 0,extra_data_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE local_runtime_session_fts_keys(fts_rowid INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL UNIQUE REFERENCES local_runtime_sessions(session_id) ON DELETE CASCADE);
CREATE VIRTUAL TABLE local_runtime_sessions_fts USING fts5(session_id UNINDEXED,session_id_terms,agent_name_terms,title_terms,workspace_dir_terms,purpose_terms,status_terms,session_type_terms,tokenize='unicode61');
INSERT INTO local_runtime_sessions(session_id,columnar_version,agent_name,extra_data_json) VALUES('existing',3,'mavis','{}');"""


def epoch_ms(text):
    return int(datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp() * 1000)


BRANCHY = "11111111-aaaa-4bbb-8ccc-000000000001"  # regenerate + THINK + search
FILES = "22222222-aaaa-4bbb-8ccc-000000000002"  # FILE attachment
CUT = "33333333-aaaa-4bbb-8ccc-000000000003"  # timed-out reply, untitled


def msg(mid, parent, role, at, fragments, status="FINISHED", **extra):
    record = {
        "id": mid,
        "parent_id": parent,
        "role": role,
        "status": status,
        "thinking_enabled": any(f["type"] == "THINK" for f in fragments),
        "search_enabled": any(f["type"] == "TOOL_SEARCH" for f in fragments),
        "accumulated_token_usage": 10 * mid,
        "inserted_at": "2026-10-01T08:00:%02d.%03dZ" % (at, mid),
        "fragments": fragments,
    }
    record.update(extra)
    return record


def sessions():
    return {
        BRANCHY: {
            "id": BRANCHY,
            "title": "量子计算入门",
            "pinned": True,
            "current_message_id": 5,
            "inserted_at": "2026-10-01T08:00:00.000Z",
            "updated_at": "2026-10-01T09:30:00.000Z",
            "messages": [
                msg(
                    1,
                    None,
                    "USER",
                    1,
                    [{"type": "REQUEST", "content": "什么是量子比特？"}],
                ),
                msg(
                    2,
                    1,
                    "ASSISTANT",
                    2,
                    [{"type": "RESPONSE", "content": "OLD_ANSWER_DISCARDED"}],
                ),
                msg(
                    3,
                    1,
                    "ASSISTANT",
                    3,
                    [
                        {
                            "type": "THINK",
                            "content": "HIDDEN_REASONING_ONLY",
                            "elapsed_secs": 1.5,
                        },
                        {
                            "type": "TOOL_SEARCH",
                            "status": "FINISHED",
                            "queries": ["qubit definition"],
                            "results": [
                                {
                                    "url": "https://example.org/qubit",
                                    "title": "Qubit - Example",
                                    "snippet": "A qubit is a two-state system.",
                                    "published_at": "2025-01-01",
                                    "site_icon": "ICON_PAYLOAD_NOT_MIGRATED",
                                    "site_name": "Example",
                                }
                            ],
                        },
                        {"type": "RESPONSE", "content": "量子比特是 NEW_ANSWER_KEPT。"},
                        {
                            "type": "CONTENT_RISK",
                            "content": "RISK_NOTICE",
                            "style": "WARNING",
                        },
                    ],
                ),
                msg(4, 3, "USER", 4, [{"type": "REQUEST", "content": "再举个例子"}]),
                msg(
                    5,
                    4,
                    "ASSISTANT",
                    5,
                    [{"type": "TEMPLATE_RESPONSE", "content": "TEMPLATE_KEPT"}],
                ),
            ],
        },
        FILES: {
            "id": FILES,
            "title": "总结这份 PDF",
            "pinned": False,
            "current_message_id": 2,
            "inserted_at": "2026-10-02T08:00:00.000Z",
            "updated_at": "2026-10-02T08:05:00.000Z",
            "messages": [
                msg(
                    1,
                    None,
                    "USER",
                    1,
                    [
                        {
                            "type": "FILE",
                            "files": [
                                {
                                    "id": "file-1",
                                    "file_name": "report.pdf",
                                    "file_size": 9,
                                    "token_usage": 3,
                                    "inserted_at": "2026-10-02T08:00:00.500Z",
                                    "export_path": "chat_sessions/"
                                    + FILES
                                    + "_files/report.pdf",
                                    "is_image": False,
                                    "width": None,
                                    "height": None,
                                }
                            ],
                        },
                        {"type": "REQUEST", "content": "帮我总结"},
                    ],
                ),
                msg(
                    2,
                    1,
                    "ASSISTANT",
                    2,
                    [{"type": "RESPONSE", "content": "SUMMARY_TEXT"}],
                ),
            ],
        },
        CUT: {
            "id": CUT,
            "title": "",
            "pinned": False,
            "current_message_id": 2,
            "inserted_at": "2026-10-03T08:00:00.000Z",
            "updated_at": "2026-10-03T08:01:00.000Z",
            "messages": [
                msg(
                    1,
                    None,
                    "USER",
                    1,
                    [{"type": "REQUEST", "content": "写一首长诗\n第二行"}],
                ),
                msg(2, 1, "ASSISTANT", 2, [], status="TIMEOUT"),
            ],
        },
    }


class Unseekable(io.RawIOBase):
    """Forces zipfile to stream entries with data descriptors, like DeepSeek's export."""

    def __init__(self, sink):
        self.sink = sink

    def writable(self):
        return True

    def write(self, data):
        return self.sink.write(data)

    def seekable(self):
        return False

    def tell(self):
        raise OSError("unseekable")


def write_export(path, records, user_id="user-42", version=3):
    with open(path, "wb") as raw:
        with zipfile.ZipFile(Unseekable(raw), "w", zipfile.ZIP_DEFLATED) as out:

            def put(name, value):
                with out.open(name, "w") as handle:
                    handle.write(
                        value
                        if isinstance(value, bytes)
                        else json.dumps(value, ensure_ascii=False).encode()
                    )

            put("manifest.json", {"export_format_version": version})
            put(
                "user.json",
                {
                    "user_id": user_id,
                    "email": None,
                    "mobile": None,
                    "oauth_profiles": [],
                },
            )
            put(
                "chat_session_index.json",
                [
                    {
                        "id": s["id"],
                        "title": s["title"],
                        "pinned": s["pinned"],
                        "message_count": len(s["messages"]),
                        "inserted_at": s["inserted_at"],
                        "updated_at": s["updated_at"],
                    }
                    for s in records.values()
                ],
            )
            for s in records.values():
                put("chat_sessions/" + s["id"] + ".json", s)
            put("chat_sessions/" + FILES + "_files/report.pdf", b"%PDF-1.4\n")
    return path
