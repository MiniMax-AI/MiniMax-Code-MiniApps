# -*- coding: utf-8 -*-
"""实验报告（factscribe/report@1）在工作台接口里的数据层。

只做编排：读报告、跑探针、上锁、出卡、签收、入账全部走 report.py 与 cli.py
的既有语义；这里不重新实现任何一条判定，也不改它们的退出码。

工作区（workspace）＝报告与原始产物所在的那个目录：

* ``cfg.source_root`` 非空 → ``(cfg.root / cfg.source_root).resolve()``；
* 否则 → ``cfg.root``。

扫描面（只读）：

* ``<工作区>/experiments/<实验>/reports/*.report.toml``
* ``<工作区>/reports/*.report.toml``
"""
from __future__ import annotations

import argparse
import contextlib
import datetime
import io
import json
import os
import re
from pathlib import Path

from .config import ConfigError, load_config
from .report import (ReportError, _artifact_path, _rel_posix, _resolve_in_ws,
                     _ws_root, check_report, load_report, lock_report,
                     report_card, sign_report, verify_signoff)
from .textio import write_text_exact

# 报告扫描面：两个 glob，顺序即展示顺序。
REPORT_PATTERNS = ("experiments/*/reports/*.report.toml",
                   "reports/*.report.toml")

ACTIONS = ("check", "lock", "sign", "import")
WRITE_ACTIONS = ("lock", "sign", "import")

_REPORT_SUFFIX = ".report.toml"

# 报告 id 的白名单：字母数字与 . _ -（与 report._ID_RE 一致，但更严：
# 连 ".." 也不许，免得拼出目录外的东西）。
_REPORT_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def workspace_of(cfg) -> Path:
    """工作区根：source_root 指哪儿，报告就在哪儿找。"""
    raw = str(getattr(cfg, "source_root", "") or "").strip()
    if not raw:
        return cfg.root.resolve()
    p = Path(raw).expanduser()
    return (p if p.is_absolute() else cfg.root / p).resolve()


def report_files(ws: Path) -> list[Path]:
    """扫报告文件（只读）。同一份文件只算一次，按工作区相对路径排序。"""
    found: dict[str, Path] = {}
    for pattern in REPORT_PATTERNS:
        for path in ws.glob(pattern):
            if not path.is_file():
                continue
            try:
                key = _rel_posix(ws, path)
            except (OSError, ValueError):
                continue
            found[key] = path
    return [found[key] for key in sorted(found)]


def _lock_state(ws: Path, report: dict) -> tuple:
    """锁的状态：("ok"|"missing"|"stale", 人话)。与 cli 的同名判断一致。"""
    from .cli import _lock_state as cli_lock_state  # cli→serve→本模块是环
    return cli_lock_state(ws, report)


def report_entry(ws: Path, path: Path) -> dict:
    """一份报告在列表里的样子。读不动也要列出，并说清为什么。"""
    rel = _rel_posix(ws, path)
    entry = {
        "path": rel,
        "id": path.name[:-len(_REPORT_SUFFIX)]
        if path.name.endswith(_REPORT_SUFFIX) else path.stem,
        "experiment": "",
        "status": "",
        "metrics": 0,
        "locked": False,
        "lock_ok": False,
        "signed": False,
        "reason": "",
        "card": [],
    }
    try:
        report = load_report(ws, rel)
    except ReportError as exc:
        entry["reason"] = exc.message
        return entry

    entry["id"] = str(report.get("id") or entry["id"])
    entry["experiment"] = str(report.get("experiment") or "")
    entry["status"] = str(report.get("status") or "")
    entry["metrics"] = len(report.get("metrics", []) or [])

    lock_path = _artifact_path(ws, report, ".lock.json")
    entry["locked"] = lock_path.exists()
    state, reason = _lock_state(ws, report)
    entry["lock_ok"] = state == "ok"

    verified = verify_signoff(ws, rel)
    entry["signed"] = bool(verified.get("ok"))

    if entry["lock_ok"]:
        try:
            entry["card"] = list(report_card(ws, rel).get("lines", []) or [])
        except ReportError as exc:
            entry["card"] = []
            if not entry["reason"]:
                entry["reason"] = exc.message

    if not entry["reason"]:
        if entry["locked"] and not entry["lock_ok"]:
            entry["reason"] = reason
        elif not entry["signed"]:
            entry["reason"] = str(verified.get("reason") or "还没有签收")
    return entry


def reports_data(project: Path | str) -> dict:
    """GET /api/reports 的数据面。"""
    cfg = load_config(Path(project))
    ws = _ws_root(workspace_of(cfg))
    return {
        "workspace": str(ws),
        "reports": [report_entry(ws, path) for path in report_files(ws)],
    }


def _require_write(allow_write: bool) -> None:
    if not allow_write:
        raise ConfigError(
            "serve 当前是只读模式；新建模板/封存/签收/导入需要启动时加 --allow-write",
            code="READ_ONLY")


def _report_ref(ws: Path, raw: str) -> str:
    """把请求里的报告路径解析成工作区内的相对路径（越界当场拒）。"""
    text = str(raw or "").strip()
    if not text:
        raise ConfigError("report 必填：要处理哪一份报告", code="USAGE")
    path = _resolve_in_ws(ws, text)
    return _rel_posix(ws, path)


def _fact_import(paper: Path, ws: Path, rel: str, dry_run: bool) -> dict:
    """入账：走 cli 里那三道门（final / 锁一致 / 已签收），不另写一套。

    cli → serve → reportapi 是个环，所以延迟导入；命令行的判据与退出码原样
    复用，这里只把结果翻译成接口的返回。
    """
    from .cli import cmd_fact_import  # 延迟导入，避免 cli↔serve 循环

    args = argparse.Namespace(ws=str(ws), report=rel, paper=str(paper),
                              dry_run=bool(dry_run), json=True)
    out = io.StringIO()
    err = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = cmd_fact_import(args)
    payload = _last_json(out.getvalue())
    if code != 0:
        info = payload.get("error") or {}
        raise ConfigError(str(info.get("message") or "导入失败"),
                          code=str(info.get("code") or "IMPORT_FAILED"))
    return {
        "facts_file": str(payload.get("facts_file") or ""),
        "written": bool(payload.get("written")),
        "unchanged": bool(payload.get("unchanged")),
        "dry_run": bool(payload.get("dry_run")),
        "facts": len(payload.get("facts") or []),
    }


def _last_json(text: str) -> dict:
    """stdout 末行是单行 JSON（tail -1 能解析）。"""
    for line in reversed(text.strip().splitlines()):
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            data = json.loads(line)
        except ValueError:
            continue
        if isinstance(data, dict):
            return data
    return {}


def report_action_data(project: Path | str, body: dict,
                       allow_write: bool = False) -> dict:
    """POST /api/reports/action 的数据面。

    check 只读；lock / sign / import 要 --allow-write。失败一律抛
    ConfigError（带 code）或 ReportError（带 code），由 serve 翻译成
    403 / 400 的 JSON，不让异常变成空响应。
    """
    if not isinstance(body, dict):
        raise ConfigError("请求体必须是 JSON 对象", code="USAGE")
    action = str(body.get("action") or "").strip().lower()
    if action not in ACTIONS:
        raise ConfigError(
            "action 只能是 %s" % " / ".join(ACTIONS), code="USAGE")
    if action in WRITE_ACTIONS:
        _require_write(allow_write)
    by = str(body.get("by") or "").strip()
    if action == "sign" and not by:
        raise ConfigError("签收必须写签收人（不能替人签字）", code="USAGE")

    cfg = load_config(Path(project))
    ws = _ws_root(workspace_of(cfg))
    rel = _report_ref(ws, str(body.get("report") or ""))

    if action == "check":
        return {"action": action,
                "result": check_report(ws, rel)}

    if action == "lock":
        lock = lock_report(ws, rel)
        report = load_report(ws, rel)
        lock_path = _artifact_path(ws, report, ".lock.json")
        return {"action": action, "result": {
            "locked": True,
            "lock_path": _rel_posix(ws, lock_path),
            "locked_at": str(lock.get("locked_at") or ""),
            "report_sha256": str(lock.get("report_sha256") or ""),
            "semantic_digest": str(lock.get("semantic_digest") or ""),
            "evidence_digest": str(lock.get("evidence_digest") or ""),
        }}

    if action == "sign":
        signoff = sign_report(ws, rel, by)
        report = load_report(ws, rel)
        return {"action": action, "result": {
            "signed": True,
            "signed_by": by,
            "signed_at": str(signoff.get("signed_at") or ""),
            "card": list(signoff.get("card_lines") or []),
            "signoff_path": _rel_posix(ws, _artifact_path(ws, report,
                                                          ".signoff.toml")),
            "log_path": _rel_posix(ws, _artifact_path(ws, report,
                                                       ".signoff.log")),
        }}

    # import：入账走既有三道门，写进论文项目的事实账。
    result = _fact_import(cfg.root, ws, rel, bool(body.get("dry_run")))
    return {"action": action, "result": result}


# ============================================================ 新建报告模板
#
# 报告页的下拉一直是空的，是因为报告由实验脚本产出；没跑实验就一份都没有。
# 这个动作给一个起点：在工作区的 reports/ 下写一份**带注释的模板**，
# 人填完 metrics 就能走「检查 → 封存 → 签收 → 导入」。
#
# 三条硬规矩：
#   1. id 白名单 `[A-Za-z0-9._-]`，且不许 ".."（否则拼出目录外的东西）；
#   2. 目标已存在 → REPORT_EXISTS（409），不覆盖人的报告；
#   3. 要写盘，所以只读工作台一律拒（READ_ONLY）。

_REPORT_TEMPLATE = """\
# 实验报告模板（schema = factscribe/report@1）
#
# 这是一份起点，不是成品。按顺序填：
#   1. 把 experiment 改成你的实验名（实验目录 experiments/<实验>/reports/ 就按它分）；
#   2. 取消下面 metric 的注释，改成你自己的指标；
#   3. sources 里的 path 指向工作区里的原始产物（相对路径）；
#   4. 填好之后回工作台：检查 → 封存 → 签收 → 导入事实账。
schema = "factscribe/report@1"
id = "%(id)s"
experiment = "%(experiment)s"
status = "partial"
generated_at = "%(generated_at)s"
population = { id = "%(experiment)s" }

# 示例 metric：取消注释并改成你自己的（一个 metric 至少要一个 role=value 的来源）。
# [[metric]]
# id = "p95"
# claim = "端到端时延 p95（毫秒）"
# value = "12.5"
# value_type = "float"
# precision = 1
# display = "12.5"
# sources = [
#   { role = "value", path = "results/summary.json", probe = "json.pointer", pointer = "/p95_ms" },
# ]
"""


def _report_id(raw: str) -> str:
    """报告 id：白名单 + 不许 ".."（400）。"""
    rid = str(raw or "").strip()
    if not rid:
        raise ConfigError("报告 id 必填：要建哪一份", code="REPORT_ID_INVALID")
    if not _REPORT_ID_RE.match(rid) or ".." in rid or rid in (".", ".."):
        raise ConfigError(
            "报告 id %r 不合法：只许字母数字与 . _ -" % rid,
            code="REPORT_ID_INVALID")
    return rid


def _write_atomic(path: Path, text: str) -> None:
    """原子写：同目录临时文件 + rename。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name("%s.tmp-%d" % (path.name, os.getpid()))
    try:
        # newline=""：不翻译换行，报告模板里用户填的数字与注释逐字落盘。
        write_text_exact(tmp, text)
        os.replace(str(tmp), str(path))
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def report_template_data(project: Path | str, body: dict,
                          allow_write: bool = False) -> dict:
    """POST /api/reports/template 的数据面：写一份带注释的报告模板。"""
    _require_write(allow_write)
    if not isinstance(body, dict):
        raise ConfigError("请求体必须是 JSON 对象", code="REPORT_ID_INVALID")
    rid = _report_id(body.get("id"))
    cfg = load_config(Path(project))
    ws = _ws_root(workspace_of(cfg))
    target = ws / "reports" / (rid + _REPORT_SUFFIX)
    if target.exists() or target.is_symlink():
        raise ConfigError("已经有这份报告了：%s" % rid, code="REPORT_EXISTS")
    # 实验名：默认从 id 推（report-20261115 → 20261115），人自己改。
    experiment = rid[len("report-"):] if rid.startswith("report-") else rid
    generated_at = datetime.datetime.now(datetime.timezone.utc).replace(
        microsecond=0).isoformat().replace("+00:00", "Z")
    text = _REPORT_TEMPLATE % {"id": rid, "experiment": experiment,
                               "generated_at": generated_at}
    _write_atomic(target, text)
    return {"id": rid, "path": _rel_posix(ws, target),
            "experiment": experiment}
