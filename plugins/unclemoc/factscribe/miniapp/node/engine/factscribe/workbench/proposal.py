# -*- coding: utf-8 -*-
"""提议单：AI／助手提出的改稿，落在状态目录，不碰正文；人确认后才写回。

一个提议单＝一条**待人确认**的改稿意图。它是状态，不是论文内容：

- 落在状态目录（缺省 `~/.factscribe/state`），不在论文目录里——论文目录不因为
  「有人提了个建议」而变脏；
- 写回正文只有一条路：人点确认 → 复用工作台既有的写回保护链
  （指纹闸 → 保护面重建 → 花括号配平 → 原子写＋.bak）。

本模块只管「存、列、读、删」；算（保护链试算）在 `write.py`，落盘也在 `write.py`。
"""
from __future__ import annotations

import json
import os
import re
import secrets
import time
from pathlib import Path

from ..config import ConfigError

PROPOSAL_VERSION = 1

KIND_BLOCK_EDIT = "block_edit"
KIND_AI_DRAFT = "ai_draft"
#: 账与证据面的提议单（见 workbench/proposals.py）。正文改稿仍是上面两种。
KIND_EVIDENCE_FREEZE = "evidence_freeze"
KIND_EVIDENCE_UNFREEZE = "evidence_unfreeze"
KIND_ADD_FACT = "add_fact"
KIND_EXPORT_BUNDLE = "export_bundle"

STATUS_PENDING = "pending"
STATUS_APPLIED = "applied"
STATUS_REJECTED = "rejected"
STATUS_STALE = "stale"

DEFAULT_STATE_DIR = "~/.factscribe/state"
PROPOSALS_SUBDIR = "proposals"

#: 提议单号：prop-<日期>-<时间>-<4位十六进制>。只认这一种形状（防路径穿越）。
_ID_RE = re.compile(r"^prop-[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$")


class ProposalError(Exception):
    """提议单出错：`code` 给机器看（HTTP 状态跟着 `status` 走）。"""

    def __init__(self, message: str, code: str = "PROPOSAL_FAILED",
                 status: int = 400):
        super().__init__(message)
        self.code = code
        self.status = status


def state_dir(explicit: str = "") -> Path:
    """状态目录：显式参数 → 环境变量 → 工具自己的家目录。

    MiniApp 侧由宿主分配的 dataDir 显式传入；浏览器模式落在 `~/.factscribe/state`。
    """
    raw = str(explicit or "").strip()
    if not raw:
        raw = str(os.environ.get("FACTSCRIBE_STATE_DIR") or "").strip()
    if not raw:
        raw = DEFAULT_STATE_DIR
    return Path(raw).expanduser()


def proposals_dir(state: str | Path = "") -> Path:
    """提议单目录。"""
    base = state if isinstance(state, Path) else state_dir(str(state))
    return base / PROPOSALS_SUBDIR


def new_id(now: float | None = None) -> str:
    """新的提议单号。"""
    stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(now if now is not None else time.time()))
    return "prop-%s-%s" % (stamp, secrets.token_hex(2))


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def proposal_path(state: str | Path, pid: str) -> Path:
    """提议单文件路径；单号形状不对直接拒（不许拿 id 拼路径穿越）。"""
    text = str(pid or "")
    if not _ID_RE.match(text):
        raise ProposalError("提议单号不对：%s" % text,
                            code="PROPOSAL_ID_INVALID", status=400)
    return proposals_dir(state) / ("%s.json" % text)


def write_proposal(state: str | Path, record: dict) -> Path:
    """落一张提议单（原子写：同目录临时文件 → rename）。"""
    path = proposal_path(state, str(record.get("id") or ""))
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name("%s.tmp-%d" % (path.name, os.getpid()))
    tmp.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")
    os.replace(tmp, path)
    return path


def read_proposal(state: str | Path, pid: str) -> dict:
    """读一张提议单。"""
    path = proposal_path(state, pid)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ProposalError("没有这张提议单：%s" % pid,
                            code="PROPOSAL_NOT_FOUND", status=404)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProposalError("这张提议单读不出来：%s（%s）" % (pid, exc),
                            code="PROPOSAL_UNREADABLE", status=500)
    if not isinstance(data, dict):
        raise ProposalError("这张提议单坏了：%s" % pid,
                            code="PROPOSAL_UNREADABLE", status=500)
    return data


def list_proposals(state: str | Path = "", project: str = "",
                   disk: str = "", status: str = STATUS_PENDING) -> list[dict]:
    """列提议单（默认只列待确认；按创建时间倒序）。"""
    directory = proposals_dir(state)
    if not directory.is_dir():
        return []
    rows: list[dict] = []
    for path in sorted(directory.glob("prop-*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        if project and str(data.get("project") or "") != project:
            continue
        if disk and str(data.get("disk") or "") != disk:
            continue
        if status and str(data.get("status") or "") != status:
            continue
        rows.append(data)
    rows.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
    return rows


def resolve_proposal(state: str | Path, pid: str, status: str) -> dict:
    """把提议单标记成已处理（applied / rejected / stale）。"""
    record = read_proposal(state, pid)
    if str(record.get("status") or "") != STATUS_PENDING:
        raise ProposalError("这张提议单已经处理过了（%s）。"
                            % record.get("status"),
                            code="PROPOSAL_ALREADY_RESOLVED", status=409)
    record["status"] = status
    record["resolved_at"] = _now_iso()
    write_proposal(state, record)
    return record


def _propose_non_text(disk_root: Path, kind: str, body: dict,
                     source: str, rationale: str) -> dict:
    """账与证据面的提议（不碰正文）——算完就停，等人点。

    与正文提议单同一形状：kind / before_sha / before_text / after_text / warnings。
    """
    from .proposals import (KIND_ADD_FACT, KIND_EVIDENCE_FREEZE,
                            KIND_EVIDENCE_UNFREEZE, KIND_EXPORT_BUNDLE,
                            propose_add_fact, propose_evidence_freeze,
                            propose_evidence_unfreeze, propose_export_bundle)

    if kind == KIND_EVIDENCE_FREEZE:
        return propose_evidence_freeze(disk_root,
                                        reason=str(body.get("reason") or ""),
                                        source=source, rationale=rationale)
    if kind == KIND_EVIDENCE_UNFREEZE:
        return propose_evidence_unfreeze(
            disk_root, reason=str(body.get("reason") or ""),
            at=str(body.get("at") or ""), source=source, rationale=rationale)
    if kind == KIND_ADD_FACT:
        # 事实的 source（results/ 下的文件）与提议单的来源（mcp／page）
        # 是两件事，不能共用一个键：新式把事实字段装在 fact 子对象里，
        # 旧式（平铺）仍认——平铺时 source 会被当成来源，卡片上就成
        # 了「来源不明」。
        fact_body = dict(body.get("fact") or {}) or dict(body)
        return propose_add_fact(disk_root, fact_body, source=source,
                                rationale=rationale)
    if kind == KIND_EXPORT_BUNDLE:
        return propose_export_bundle(disk_root, source=source,
                                      rationale=rationale)
    raise ConfigError("不会认的提议类型：%s" % kind,
                      code="PROPOSAL_KIND_INVALID")


def create_proposal(state: str | Path, project: str, disk: str,
                    disk_root: Path, body: dict) -> dict:
    """建一张提议单（**不碰正文**）。

    算的部分交给 `write.propose_*`——那才是保护链所在的地方；
    这里只负责把算出来的结果存成一张单。
    """
    from .write import propose_ai_draft, propose_block_edit

    kind = str((body or {}).get("kind") or KIND_BLOCK_EDIT)
    text = (body or {}).get("text")
    expect = str((body or {}).get("expect_sha") or "")
    source = str((body or {}).get("source") or "")
    rationale = str((body or {}).get("rationale") or "")
    rel = str((body or {}).get("file") or "")
    block = str((body or {}).get("block") or "")
    if kind == KIND_AI_DRAFT:
        anchor = str((body or {}).get("after_block") or block)
        calc = propose_ai_draft(disk_root, rel, anchor, text,
                                expect_sha=expect, source=source,
                                rationale=rationale)
    elif kind in (KIND_EVIDENCE_FREEZE, KIND_EVIDENCE_UNFREEZE,
                  KIND_ADD_FACT, KIND_EXPORT_BUNDLE):
        calc = _propose_non_text(disk_root, kind, body or {}, source, rationale)
    else:
        calc = propose_block_edit(disk_root, rel, block, text,
                                  expect_sha=expect, source=source,
                                  rationale=rationale)
    record = {"version": PROPOSAL_VERSION,
              "id": new_id(),
              "project": project,
              "disk": disk,
              "status": STATUS_PENDING,
              "created_at": _now_iso()}
    record.update(calc)
    write_proposal(state, record)
    return record
