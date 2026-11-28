# -*- coding: utf-8 -*-
"""`factscribe mcp`：把本地工作台挂成 MCP stdio 服务器。

工具就是 workbench 数据层：status / project / brief / audit；
加 `--allow-write` 才多出 write_section / add_fact。
stdout 只走 JSON-RPC，诊断一律 stderr。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from .constants import VERSION
from .workbench import (add_fact_data, audit_data, brief_data,
                        evidence_status_data, freeze_evidence_data,
                        project_data, status_data, unfreeze_evidence_data,
                        write_section_data)

PROTOCOL_VERSION = "2024-11-05"

_WRITE_TOOLS = {
    "factscribe_write_section": {
        "description": "Write one .tex section that is already in the audit closure. "
                       "Writes to the project on disk; atomic replace. "
                       "Requires the server to be started with --allow-write.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file": {"type": "string",
                         "description": "Project-relative .tex path, e.g. sections/03.tex"},
                "text": {"type": "string", "description": "Full new file content"},
                "expect_sha": {"type": "string",
                               "description": "Optional fingerprint of the section "
                                              "version this edit was based on "
                                              "(sha256 hex, first 16 chars). If it "
                                              "no longer matches the file on disk, "
                                              "the write is refused (BLOCK_STALE)."},
            },
            "required": ["file", "text"],
            "additionalProperties": False,
        },
    },
    "factscribe_evidence_freeze": {
        "description": "Freeze the current [evidence] list into audit/evidence.lock "
                       "with an optional reason. Requires --allow-write.",
        "inputSchema": {
            "type": "object",
            "properties": {"reason": {"type": "string"}},
            "additionalProperties": False,
        },
    },
    "factscribe_evidence_unfreeze": {
        "description": "Unfreeze the evidence list; reason is mandatory and is "
                       "written to audit/evidence-log.ndjson. Requires --allow-write.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "reason": {"type": "string"},
                "at": {"type": "string", "description": "YYYY-MM-DD (optional)"},
            },
            "required": ["reason"],
            "additionalProperties": False,
        },
    },
    "factscribe_add_fact": {
        "description": "Append one fact to the ledger (same rules as `fact add`; "
                       "the tool never signs the manifest). Requires --allow-write.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "claim": {"type": "string"},
                "value": {"type": "string"},
                "source": {"type": "string",
                           "description": "Project-relative source path under results/ (v1)"},
                "locator": {"type": "string"},
                "confidence": {"type": "string", "enum": ["high", "med", "low"]},
                "expr": {"type": "string"},
                "derived_from": {"type": "string",
                                 "description": "Comma-separated parent fact ids"},
                "note": {"type": "string"},
                "ledger": {"type": "string",
                           "description": "Target ledger file, project-relative "
                                          "(must stay inside the project facts glob)"},
            },
            "required": ["id", "claim", "value", "source"],
            "additionalProperties": False,
        },
    },
}

_READ_TOOLS = {
    "factscribe_status": {
        "description": "Project status: number of facts and sections, config shape, "
                       "and whether the workbench is read-only.",
        "inputSchema": {"type": "object", "properties": {},
                        "additionalProperties": False},
    },
    "factscribe_project": {
        "description": "Read the project projection: sections (file + text), facts, "
                       "sources, and refs.bib.",
        "inputSchema": {"type": "object", "properties": {},
                        "additionalProperties": False},
    },
    "factscribe_evidence_status": {
        "description": "Evidence freeze status: declared sections, lock hash/entries, "
                       "lock mismatch, unfrozen state and the last log record.",
        "inputSchema": {"type": "object", "properties": {},
                        "additionalProperties": False},
    },
    "factscribe_brief": {
        "description": "Drafting brief: section list, usable facts and numbers, terms.",
        "inputSchema": {
            "type": "object",
            "properties": {"section": {"type": "string",
                                       "description": "Section filename stem prefix, e.g. 04"}},
            "additionalProperties": False,
        },
    },
    "factscribe_audit": {
        "description": "Run the mechanical gate. Returns exit (0 green / 1 red / 3 yellow), "
                       "summary and findings. HTTP-free; verdict is in `exit`. "
                       "Every finding carries message_key and params (the i18n raw "
                       "material); lang=en renders the finding text in English "
                       "(default zh = the gate's own wording).",
        "inputSchema": {"type": "object",
                        "properties": {
                            "lang": {"type": "string", "enum": ["zh", "en"],
                                     "description": "Language of the finding text "
                                                    "(default zh)"},
                        },
                        "additionalProperties": False},
    },
}


def _tools(allow_write: bool) -> list[dict]:
    names = dict(_READ_TOOLS)
    if allow_write:
        names.update(_WRITE_TOOLS)
    return [{"name": name, **defn} for name, defn in names.items()]


def _dispatch(project: Path, allow_write: bool, name: str,
              arguments: dict) -> dict:
    args = arguments or {}
    if name == "factscribe_status":
        return status_data(project, allow_write)
    if name == "factscribe_project":
        return project_data(project, allow_write)
    if name == "factscribe_brief":
        return brief_data(project, args.get("section"))
    if name == "factscribe_audit":
        return audit_data(project, str(args.get("lang") or "zh"))
    if name == "factscribe_evidence_status":
        return evidence_status_data(project)
    if name == "factscribe_evidence_freeze":
        return freeze_evidence_data(project, str(args.get("reason") or ""),
                                    allow_write)
    if name == "factscribe_evidence_unfreeze":
        return unfreeze_evidence_data(project, str(args.get("reason") or ""),
                                      str(args.get("at") or ""), allow_write)
    if name == "factscribe_write_section":
        return write_section_data(project, str(args.get("file") or ""),
                                  args.get("text"), allow_write,
                                  str(args.get("expect_sha") or ""))
    if name == "factscribe_add_fact":
        return add_fact_data(project, args, allow_write)
    raise KeyError(name)


def _result(req_id, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _error(req_id, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": req_id,
            "error": {"code": code, "message": message}}


def _tool_result(data: dict) -> dict:
    text = json.dumps(data, ensure_ascii=False, indent=2)
    return {
        "content": [{"type": "text", "text": text}],
        "isError": False,
    }


def _tool_error(message: str) -> dict:
    return {"content": [{"type": "text", "text": message}], "isError": True}


def _handle(project: Path, allow_write: bool, message: dict) -> dict | None:
    method = message.get("method")
    req_id = message.get("id")
    params = message.get("params") or {}
    if method == "initialize":
        return _result(req_id, {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "factscribe", "version": VERSION},
        })
    if method == "ping":
        return _result(req_id, {})
    if method == "tools/list":
        return _result(req_id, {"tools": _tools(allow_write)})
    if method == "tools/call":
        name = str(params.get("name") or "")
        arguments = params.get("arguments") or {}
        if name not in {t["name"] for t in _tools(allow_write)}:
            return _result(req_id, _tool_error(
                "没有这个工具：%s（当前%s）" % (
                    name, "可写" if allow_write else "只读")))
        try:
            data = _dispatch(project, allow_write, name, arguments)
        except Exception as exc:  # noqa: BLE001 - 工具错不能打死服务器
            message = getattr(exc, "code", None)
            detail = str(exc)
            return _result(req_id, _tool_error(
                ("%s: %s" % (message, detail)) if message else detail))
        return _result(req_id, _tool_result(data))
    if method == "shutdown":
        return _result(req_id, {})
    if method in ("exit", "notifications/initialized",
                  "notifications/cancelled"):
        return None
    if req_id is None:
        return None
    return _error(req_id, -32601, "Method not found: %s" % method)


def run_stdio(project: Path | str, allow_write: bool = False) -> int:
    """阻塞读 stdin 的 JSON-RPC 行，写 stdout；EOF 或 exit 返回 0。"""
    try:
        sys.stdin.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except AttributeError:
        pass
    root = Path(project).expanduser()
    if root.is_dir():
        root = root.resolve()
    # 启动即校验，坏项目在协议开始前就 exit 2。
    from .config import load_config
    load_config(root)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            print(json.dumps(_error(None, -32700, "Parse error"),
                             ensure_ascii=False), flush=True)
            continue
        if not isinstance(message, dict):
            print(json.dumps(_error(None, -32600, "Invalid Request"),
                             ensure_ascii=False), flush=True)
            continue
        if message.get("method") == "exit":
            return 0
        response = _handle(root, allow_write, message)
        if response is not None:
            print(json.dumps(response, ensure_ascii=False), flush=True)
    return 0
