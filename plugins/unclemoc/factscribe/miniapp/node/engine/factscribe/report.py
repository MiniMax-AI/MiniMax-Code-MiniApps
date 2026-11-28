# -*- coding: utf-8 -*-
"""人读文本渲染、追溯矩阵与 JSON 载荷。

外加 P0：归一化实验报告核心（schema = ``factscribe/report@1``）——读报告、
用探针去原始产物取数并比对。详见文件末尾「报告核心」一节。
"""
from __future__ import annotations

import csv
import datetime
import hashlib
import json
import os
import re
import unicodedata
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath

from .audit import Issue
from .config import (Config, ConfigError, load_toml, outside_closure_note,
                     outside_facts_note)
from .constants import (EXIT_ATTACK_OPEN, EXIT_CONFIG, EXIT_INTEGRITY,
                        EXIT_INTERNAL, EXIT_MISSING, EXIT_OK, EXIT_PROOF,
                        EXIT_RED, EXIT_STALE, EXIT_YELLOW, SCHEMA_VERSION,
                        SEV_RED, SEV_YELLOW, VERSION)
from .facts import Fact
from .texscan import scan_tex

# --------------------------------------------------------------------------
# matrix
# --------------------------------------------------------------------------

def _cell(v) -> str:
    return str(v if v not in (None, "") else "—").replace("|", "\\|").replace("\n", " ")


def render_matrix(cfg: Config, facts: list[Fact], sections: list[tuple[str, str]]):
    if not facts:
        # 空账有两种：真没账（配置错，exit 2）；或账文件是越界／不可解的软链、
        # 被账本拒收（信任根缺口，exit 5）。后者要说清是哪一种，不许混。
        note = outside_facts_note(cfg)
        if note:
            raise ConfigError(note)
        raise ConfigError("facts 为空（%s 没匹配到任何 fact）——矩阵无从生成" % cfg.facts_glob)
    if not sections:
        note = outside_closure_note(cfg)
        if note:
            raise ConfigError(note)
        raise ConfigError("sections 为空（%s 没匹配到任何 .tex）" % cfg.sections_glob)

    used_sections: dict[str, list[str]] = {f.id: [] for f in facts}
    counts: dict[str, int] = {f.id: 0 for f in facts}
    for rel, text in sections:
        scan = scan_tex(text)
        for fid, _line in scan.markers:
            f = next((x for x in facts if x.id_key == fid.strip().casefold()), None)
            if f is not None:
                counts[f.id] += 1
                if rel not in used_sections[f.id]:
                    used_sections[f.id].append(rel)

    lines = [
        "# Fact 追溯矩阵",
        "",
        "- 项目：%s" % (cfg.title or "（未命名）"),
        "- 生成：FactScribe %s（schema %s）" % (VERSION, SCHEMA_VERSION),
        "- facts：%d 条；sections：%d 个" % (len(facts), len(sections)),
        "",
        "| fact id | claim | value | source | locator | confidence | 被引用次数 | 被哪些节引用 | kind | source_sha256(前12) |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for f in facts:
        used = used_sections[f.id]
        lines.append("| %s | %s | %s | %s | %s | %s | %d | %s | %s | %s |" % (
            _cell(f.id), _cell(f.claim), _cell(f.value), _cell(f.source),
            _cell(f.locator), _cell(f.confidence), counts[f.id],
            _cell("、".join(used) if used else "（未使用）"),
            _cell(f.kind), _cell(f.source_sha256[:12] if f.source_sha256 else ""),
        ))
    unused = [f.id for f in facts if counts[f.id] == 0]
    lines += ["", "## 提示", ""]
    lines.append("- 账上有、文里没用：%s" % ("、".join(unused) if unused else "无"))
    lines.append("- 正文引用只在 marker（`\\fact{A1}` 或 `[[fact:A1]]`）里计数。")
    lines.append("- 绿＝「有账、账有据、据未被改」；不是「内容为真」。")
    lines.append("")

    rows = [{
        "id": f.id, "claim": f.claim, "value": f.value, "source": f.source,
        "locator": f.locator, "confidence": f.confidence, "kind": f.kind,
        "source_sha256": f.source_sha256,
        "citations": counts[f.id], "sections": used_sections[f.id],
    } for f in facts]
    return "\n".join(lines), rows


# --------------------------------------------------------------------------
# preamble：给正文里的 \fact / \fsignore 一个真宏（红队 C10）
# --------------------------------------------------------------------------

PREAMBLE_TEXT = """% 由 factscribe 生成：把本文件 \\input 到导言区（main.tex 的 \\begin{document} 之前）。
% \\fact{ID} 只做审计绑定，排版上不产生可见字符，避免 PDF 里出现字面量。
\\providecommand{\\fact}[1]{}
% \\fsignore{...} 是显式的数字豁免区：内容照排，但不进数字审计。
\\providecommand{\\fsignore}[1]{#1}
"""

# --------------------------------------------------------------------------
# 人读输出
# --------------------------------------------------------------------------

def _print_issue(i: Issue, idx: int) -> str:
    head = " %2d. %-22s %s" % (idx, i.code, i.location or "-")
    lines = [head]
    if i.token:
        lines[0] += "  →  " + i.token
    lines.append("     " + i.message)
    if i.context:
        lines.append("     行: " + i.context[:200])
    return "\n".join(lines)


def _status_word(code: int) -> str:
    """退出码 → 人读结论词。

    闭集里每个码都要有说法：原先只映射 0–4，5/6/7/8/9 一律落进默认的
    "?"，于是「1 红 / 0 黄 → ?（退出码 5）」这种红闸结论行会印一个问号。
    说法与 checks.EXIT_CODE_CLOSED_SET 的语义对齐。
    """
    return {EXIT_OK: "绿", EXIT_RED: "红（有违例）", EXIT_YELLOW: "黄（未核验，不判死）",
            EXIT_CONFIG: "配置/用法错", EXIT_INTERNAL: "工具内部错误",
            EXIT_INTEGRITY: "红（覆盖/信任链缺口）", EXIT_PROOF: "红（未达证明要求）",
            EXIT_STALE: "红（过期/重放）", EXIT_MISSING: "工具缺失",
            EXIT_ATTACK_OPEN: "红（攻击面未闭合）"}.get(code, "?")


def _human_check(cfg, facts, issues, warnings, conflicts, summary, code) -> str:
    lines = ["== factscribe check ==", "project : %s" % cfg.root,
             "facts   : %d 条（id %d 个，source 均在位 %d 条，sha 钉住 %d 条）"
             % (summary["facts"], summary["ids"], summary["sources_ok"],
                summary["sha_pinned"]), ""]
    if warnings:
        lines.append("[黄] %d 处（账本自相矛盾/未签名/未核验——必须列出来给人看）"
                     % len(warnings))
        lines += [_print_issue(i, n) for n, i in enumerate(warnings, 1)]
        lines.append("")
    else:
        lines.append("[黄] 0 处")
    if issues:
        lines.append("[红] %d 处" % len(issues))
        lines += [_print_issue(i, n) for n, i in enumerate(issues, 1)]
    else:
        lines.append("[红] 0 处 —— 账本身干净（不等于内容为真）")
    lines.append("")
    lines.append("结论：%s（退出码 %d）" % (_status_word(code), code))
    return "\n".join(lines)


def _audit_header(cfg, summary) -> list[str]:
    """audit 人读报告的头块（标题＋账面摘要行）。summary 是 paper 形状的基座。"""
    cov = summary.get("coverage", {})
    lines = [
        "== factscribe audit ==",
        "project : %s" % cfg.root,
        "facts   : %d 条      sections: %d 个（扫描 %d 个 .tex）" % (
            summary["facts"], summary["sections"], cov.get("files_scanned_count", 0)),
        "numbers : %d 个（bound %d / unbound %d / unmatched %d）" % (
            summary["numbers_total"], summary["numbers_bound"],
            summary.get("numbers_unbound", 0), summary["numbers_unmatched"]),
        "notes   : 已跳过 %d 处批注（\\todoq/\\todo/\\fsignore 等，内容不参与审计）"
        % summary.get("annotations_skipped", 0),
        "cites   : %d 次调用、%d 个 key；bib %d 条（命中 %d）" % (
            summary["cites_total"], summary["cites_unique"],
            summary["bib_entries"], summary["bib_used"]),
        "coverage: %s" % ("、".join(cov.get("files_scanned", [])) or "（无）"),
        "",
    ]
    pdf = summary.get("pdf") or {}
    if pdf.get("checked"):
        by_cat = pdf.get("structural_masked_by") or {}
        detail = "、".join("%s %d" % (k, v) for k, v in by_cat.items()) or "无"
        lines.insert(6, "pdf     : %s；结构性 token 掩掉 %d 个（%s）" % (
            pdf.get("file", ""), pdf.get("structural_masked", 0), detail))
    return lines


def _domain_summary(summary, domain: str) -> dict:
    """取某域自己的 summary：信封基座若是该域（单域点名）直接用，否则取嵌套键。"""
    if isinstance(summary, dict):
        if summary.get("domain") == domain:
            return summary
        nested = summary.get(domain)
        if isinstance(nested, dict):
            return nested
    return {}


def _human_audit_domains(cfg, red, yellow, hints, summary, unresolved, code,
                         domains) -> str:
    """槽路径多域的人读报告（SPEC-CHECKS §2.2 槽第 4 件事）。

    paper 节在前（版式与单域完全一致），其余域各一节、按点名序（legal 在后
    是点名序的自然结果）；每域的发现只进自己的节（域标归位），结论行的红黄
    计数是跨域合并数——退出码由 aggregate_exit 单一入口折算，报告口径一致。
    各域 summary 若带 ``lines``（该域卡声明的人读域头），core 原样打印
    （core 不懂域义，只认这个键）。
    """
    buckets: dict = {}
    for sev, items in (("yellow", yellow), ("red", red), ("hints", hints)):
        for i in items:
            buckets.setdefault(getattr(i, "domain", "paper"),
                               {}).setdefault(sev, []).append(i)
    base = summary if isinstance(summary, dict) and "facts" in summary \
        else _domain_summary(summary, "paper")
    lines = list(_audit_header(cfg, base)) if base else \
        ["== factscribe audit ==", "project : %s" % cfg.root, ""]
    for n, domain in enumerate(domains):
        bucket = buckets.get(domain, {})
        d_y = bucket.get("yellow", [])
        d_r = bucket.get("red", [])
        d_h = [h for h in bucket.get("hints", []) if h.severity != SEV_YELLOW]
        own = domain != "paper" or n > 0
        if own:
            lines.append("")
            lines.append("---- 核验域：%s ----" % domain)
            for ln in _domain_summary(summary, domain).get("lines") or []:
                lines.append(str(ln))
        if d_y:
            lines.append("[黄] %d 处（未核验/未绑定/未签名——不判死，但不许当绿）"
                         % len(d_y))
            lines += [_print_issue(i, k) for k, i in enumerate(d_y, 1)]
            lines.append("")
        else:
            lines.append("[黄] 0 处")
        if d_r:
            lines.append("[红] %d 处（必须修）" % len(d_r))
            lines += [_print_issue(i, k) for k, i in enumerate(d_r, 1)]
        elif own:
            lines.append("[红] 0 处")
        else:
            lines.append("[红] 0 处 —— 数字与引用全部有账、有据")
        if d_h:
            lines.append("")
            lines.append("[提示] %d 条（非红非黄，不拦）" % len(d_h))
            for h in d_h:
                lines.append(" - %-16s %s %s" % (h.code, h.location, h.message))
    if unresolved:
        lines.append("")
        lines.append("联网核验：")
        for u in unresolved:
            lines.append(" - %-18s %s=%s -> %s（%s）" % (
                u["key"], u["id_type"], u["id"], u["status"], u["detail"]))
    lines.append("")
    lines.append("结论：%d 红 / %d 黄 → %s（退出码 %d）" % (
        len(red), len(yellow), _status_word(code), code))
    lines.append("注意：绿只代表「账、据、正文自洽且据未被改」，不代表内容为真。")
    return "\n".join(lines)


def _human_audit(cfg, red, yellow, hints, summary, unresolved, code) -> str:
    lines = list(_audit_header(cfg, summary))
    if yellow:
        lines.append("[黄] %d 处（未核验/未绑定/未签名——不判死，但不许当绿）" % len(yellow))
        lines += [_print_issue(i, n) for n, i in enumerate(yellow, 1)]
        lines.append("")
    else:
        lines.append("[黄] 0 处")
    if red:
        lines.append("[红] %d 处（必须修）" % len(red))
        lines += [_print_issue(i, n) for n, i in enumerate(red, 1)]
    else:
        lines.append("[红] 0 处 —— 数字与引用全部有账、有据")
    shown = [h for h in hints if h.severity != SEV_YELLOW]
    if shown:
        lines.append("")
        lines.append("[提示] %d 条（非红非黄，不拦）" % len(shown))
        for h in shown:
            lines.append(" - %-16s %s %s" % (h.code, h.location, h.message))
    if unresolved:
        lines.append("")
        lines.append("联网核验：")
        for u in unresolved:
            lines.append(" - %-18s %s=%s -> %s（%s）" % (
                u["key"], u["id_type"], u["id"], u["status"], u["detail"]))
    lines.append("")
    lines.append("结论：%d 红 / %d 黄 → %s（退出码 %d）" % (
        len(red), len(yellow), _status_word(code), code))
    lines.append("注意：绿只代表「账、据、正文自洽且据未被改」，不代表内容为真。")
    return "\n".join(lines)

# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def _config_block(cfg: Config) -> dict:
    """配置归一化的机器可读面：来源形态 + 告警（未知字段/别名）。

    与判据面的 `warnings`（check/audit 里是黄项列表）分开：这里只讲
    「配置是怎么读进来的」，不参与退出码，也不许静默吞掉打错的字段名。
    """
    block = {"shape": cfg.config_shape or "v1",
             "schema": cfg.schema,
             "file": "factscribe.toml",
             "warnings": list(cfg.warnings)}
    return block


def _emit(payload: dict, text: str, as_json: bool) -> None:
    if as_json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(text)

def _severity_of(code: int) -> str:
    if code == EXIT_OK:
        return "ok"
    if code == EXIT_RED:
        return SEV_RED
    if code == EXIT_YELLOW:
        return SEV_YELLOW
    return "error"


def _payload(command: str, status: str, code: int, /, **kw) -> dict:
    """统一 JSON payload 骨架：`exit` 是退出码，其余键走 **kw。

    G2-FIX：前三个形参是**仅位置**的（`/` 之后）。理由：`code` 同时是本函数
    的第 3 个形参名，而调用方常要往 payload 里塞一个 `code=` 键（错误码）。
    形参不是仅位置时，`_payload(cmd, "error", EXIT_CONFIG, code=code)` 会同时
    按位置与按关键字绑定 `code` → `TypeError: _payload() got multiple values
    for argument 'code'`——正是 G2 验收时 `figures gen` 崩成 exit 4 的根因。
    仅位置之后，`code=` 只会落进 **kw（payload 里的 "code" 键），不再撞形参。
    """
    d = {"schema_version": SCHEMA_VERSION, "tool": "factscribe", "version": VERSION,
         "command": command, "status": status, "severity": _severity_of(code),
         "exit": code}
    d.update(kw)
    return d


# ==========================================================================
# 报告核心（factscribe/report@1）
#
# 这一层只做三件事：读归一化报告 → 用探针去原始产物取数 → 比对。
# 不写盘、不碰事实账、不做 CLI（CLI 是第二步，会 import 下面这些固定名字）：
#   SCHEMA / ReportError / load_report / check_report / lock_report /
#   report_card / sign_report / verify_signoff / digest_of /
#   semantic_digest / evidence_digest
# ==========================================================================

SCHEMA = "factscribe/report@1"
LOCK_SCHEMA = "factscribe/report-lock@1"
SIGNOFF_SCHEMA = "factscribe/report-signoff@1"

VALUE_TYPES = ("count", "ratio", "percent", "float")
STATUSES = ("final", "partial", "superseded")
ROLES = ("value", "numerator", "denominator", "cross_check")
PROBES = ("jsonl.count", "jsonl.count_where", "csv.cell", "json.pointer")

# 单文件上限 2 GiB（SPEC §12.8）：超限报错，不截断。
MAX_FILE_BYTES = 2 * 1024 ** 3

# 摘要覆盖的字段（SPEC §12.4：只对显式列出的字段做摘要）。
SEMANTIC_METRIC_FIELDS = ("id", "claim", "value", "value_type", "display", "precision")
SEMANTIC_SOURCE_FIELDS = ("role", "path", "probe", "where", "pointer",
                           "row_key", "row_column", "column", "expect_total")

_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")
_INT_RE = re.compile(r"^\d+$")
_RATIO_RE = re.compile(r"^(\d+)/(\d+)$")
_ZERO_HASH = "0" * 64


class ReportError(Exception):
    """带 code 的失败；原因写人话。

    code 给机器看（MISSING_FIELD / BAD_ENUM / PROBE_MISMATCH / PATH_ESCAPE…），
    message 给人看。`metric` / `source` 指明错在哪个指标、哪个来源。
    """

    def __init__(self, message: str, code: str = "REPORT_ERROR",
                 metric: str = "", source: str = ""):
        super().__init__(message)
        self.code = code
        self.metric = metric
        self.source = source

    @property
    def message(self) -> str:
        return str(self)


# --------------------------------------------------------------------------
# 路径安全：路径必须解析后仍留在工作区根内
# --------------------------------------------------------------------------

def _ws_root(ws) -> Path:
    root = Path(ws).expanduser().resolve()
    if not root.is_dir():
        raise ReportError("工作区 %s 不存在或不是目录" % root,
                          code="WORKSPACE_MISSING")
    return root


def _resolve_in_ws(root: Path, raw) -> Path:
    """把报告里写的路径解析成工作区内的路径；越界/软链一律拒绝。"""
    text = str(raw or "").strip()
    if not text:
        raise ReportError("路径不能为空", code="MISSING_FIELD")
    p = Path(text)
    if p.is_absolute():
        try:
            p = Path(os.path.realpath(str(p))).relative_to(root)
        except ValueError:
            raise ReportError("路径 %s 不在工作区 %s 内" % (text, root),
                              code="PATH_ESCAPE")
    if ".." in p.parts:
        raise ReportError("路径 %s 里有 ..，会跑出工作区" % text,
                          code="PATH_ESCAPE")
    candidate = root / p
    # 逐段查软链：软链可以把读取引到工作区外，v1 直接拒。
    cur = root
    for part in candidate.relative_to(root).parts:
        cur = cur / part
        if cur.is_symlink():
            raise ReportError("路径 %s 经过软链 %s，不许读" % (text, cur.name),
                              code="PATH_ESCAPE")
    real = Path(os.path.realpath(str(candidate)))
    if real != root and root not in real.parents:
        raise ReportError("路径 %s 解析后跑出工作区 %s" % (text, root),
                          code="PATH_ESCAPE")
    return candidate


def _check_file(path: Path, what: str) -> int:
    """只读普通文件；缺文件/非普通文件/超 2 GiB 都报错。返回字节数。"""
    if not path.exists():
        raise ReportError("%s %s 不存在" % (what, path.name), code="FILE_NOT_FOUND")
    if not path.is_file():
        raise ReportError("%s %s 不是普通文件" % (what, path.name),
                          code="PATH_NOT_FILE")
    size = path.stat().st_size
    if size > MAX_FILE_BYTES:
        raise ReportError("%s %s 太大（%d 字节 > 2 GiB）" % (what, path.name, size),
                          code="FILE_TOO_LARGE")
    return size


def _rel_posix(root: Path, path: Path) -> str:
    """工作区相对、POSIX、大小写敏感的路径串。"""
    try:
        return Path(os.path.realpath(str(path))).relative_to(root).as_posix()
    except ValueError:
        return Path(path).as_posix()


def _sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _iso_now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).replace(
        microsecond=0).isoformat().replace("+00:00", "Z")


# --------------------------------------------------------------------------
# digest@1：规范 JSON → sha256
# --------------------------------------------------------------------------

def _posix_path_str(text: str, ws=None) -> str:
    """路径统一成 POSIX 相对工作区；大小写敏感（不折叠大小写）。"""
    raw = str(text).replace("\\", "/")
    if ws is not None:
        p = Path(raw)
        if p.is_absolute():
            root = Path(ws).resolve()
            try:
                return p.resolve().relative_to(root).as_posix()
            except ValueError:
                return p.as_posix()
    return PurePosixPath(raw).as_posix()


def _digest_norm(value, ws=None, key=""):
    """摘要前的归一：字符串走 NFC；路径字段走 POSIX 相对；浮点一律拒。"""
    if value is None or isinstance(value, bool) or isinstance(value, int):
        return value
    if isinstance(value, float):
        raise ReportError("摘要里不许有浮点数：%r（请写成十进制字符串）" % (value,),
                          code="FLOAT_NOT_ALLOWED")
    if isinstance(value, str):
        if key.endswith("path"):
            return _posix_path_str(value, ws)
        return unicodedata.normalize("NFC", value)
    if isinstance(value, list):
        return [_digest_norm(v, ws) for v in value]
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if not isinstance(k, str):
                raise ReportError("摘要对象的键必须是字符串：%r" % (k,),
                                  code="BAD_VALUE")
            out[unicodedata.normalize("NFC", k)] = _digest_norm(v, ws, k)
        return out
    raise ReportError("摘要只接受 None/bool/int/str/list/dict，现在收到 %s"
                      % type(value).__name__, code="BAD_VALUE")


def digest_of(value, ws=None) -> str:
    """digest@1：规范 JSON 序列化后取 sha256 十六进制。

    只接受 None / bool / int / str / list / dict（键为 str）；浮点抛
    ReportError。字符串做 NFC 归一；键名以 path 结尾的字段转 POSIX 相对工作区。
    """
    norm = _digest_norm(value, ws)
    text = json.dumps(norm, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def semantic_digest(report: dict) -> str:
    """语义摘要：报告说了什么（指标与来源声明），与磁盘内容无关。"""
    metrics = []
    for m in report.get("metrics", []) or []:
        item = {f: m.get(f) for f in SEMANTIC_METRIC_FIELDS}
        item["sources"] = []
        for s in m.get("sources", []) or []:
            src = {f: s.get(f) for f in SEMANTIC_SOURCE_FIELDS if f in s}
            item["sources"].append(src)
        metrics.append(item)
    payload = {
        "schema": report.get("schema", ""),
        "id": report.get("id", ""),
        "experiment": report.get("experiment", ""),
        "status": report.get("status", ""),
        "population": report.get("population", {}),
        "metrics": metrics,
    }
    return digest_of(payload)


def evidence_digest(ws, report: dict) -> str:
    """证据摘要：原始产物现在长什么样（现读现算 sha256）。"""
    root = _ws_root(ws)
    entries = []
    for m in report.get("metrics", []) or []:
        for s in m.get("sources", []) or []:
            path = _resolve_in_ws(root, s.get("path", ""))
            _check_file(path, "来源文件")
            entries.append({
                "path": _rel_posix(root, path),
                "sha256": _sha256_of(path),
                "size": path.stat().st_size,
                "role": s.get("role", ""),
                "probe": s.get("probe", ""),
            })
    return digest_of(entries)


# --------------------------------------------------------------------------
# TOML 读取
# --------------------------------------------------------------------------

def _load_report_toml(path: Path) -> dict:
    """读报告 TOML：统一走 config.load_toml。

    3.11+ 走标准库 tomllib，3.10 走仓内那份严格兜底解析器 —— 两条路径
    读出同一个结果、对坏文件给出同一个结论。

    为什么不再留一份 3.10 专用解析器：旧代码在 3.10 上另起炉灶写了一份
    宽松解析器（只为认 inline table），那份是**宽松**的：坏表头当表名收下、
    裸词当字符串收下、重复键默默覆盖 —— 同一份坏报告在 3.10 上"能读"，
    在 3.11+ 上被拒，两种解释器两个结论。现在仓内兜底解析器既严格又认
    inline table，这层分叉没有存在理由了。
    """
    try:
        return load_toml(path)
    except ConfigError as exc:
        raise ReportError("报告 TOML 读不了：%s" % exc, code="BAD_TOML")


# --------------------------------------------------------------------------
# 报告结构校验
# --------------------------------------------------------------------------

def _need_str(data: dict, key: str, where: str, errors: list,
              metric: str = "", source: str = "") -> str:
    if key not in data:
        errors.append({"code": "MISSING_FIELD",
                       "message": "%s 缺少字段 %s" % (where, key),
                       "metric": metric, "source": source})
        return ""
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        errors.append({"code": "MISSING_FIELD",
                       "message": "%s 的 %s 必须是非空字符串，现在是 %r"
                                  % (where, key, value),
                       "metric": metric, "source": source})
        return ""
    return value.strip()


def _need_enum(data: dict, key: str, allowed, where: str, errors: list,
               metric: str = "", source: str = "") -> str:
    if key not in data:
        errors.append({"code": "MISSING_FIELD",
                       "message": "%s 缺少字段 %s" % (where, key),
                       "metric": metric, "source": source})
        return ""
    value = data.get(key)
    if value not in allowed:
        errors.append({"code": "BAD_ENUM",
                       "message": "%s 的 %s 只能是 %s 之一，现在是 %r"
                                  % (where, key, " / ".join(allowed), value),
                       "metric": metric, "source": source})
        return ""
    return value


def _validate_source(raw, where: str, metric_id: str, errors: list) -> dict:
    """校验一个 source：role/path/probe 必填，探针参数按探针名必填。"""
    if not isinstance(raw, dict):
        errors.append({"code": "BAD_VALUE",
                       "message": "%s 的 source 必须是表" % where,
                       "metric": metric_id, "source": ""})
        return {}
    role = _need_enum(raw, "role", ROLES, where, errors, metric_id)
    path = _need_str(raw, "path", where, errors, metric_id)
    probe = _need_enum(raw, "probe", PROBES, where, errors, metric_id)
    out = {"role": role, "path": path, "probe": probe}
    for key in ("where", "pointer", "row_key", "row_column", "column"):
        if key in raw and raw.get(key) is not None:
            value = raw.get(key)
            if not isinstance(value, str):
                errors.append({"code": "BAD_VALUE",
                               "message": "%s 的 %s 必须是字符串，现在是 %r"
                                          % (where, key, value),
                               "metric": metric_id, "source": path})
            else:
                out[key] = value
    if "expect_total" in raw and raw.get("expect_total") is not None:
        total = raw.get("expect_total")
        if isinstance(total, bool) or not isinstance(total, int):
            errors.append({"code": "BAD_VALUE",
                           "message": "%s 的 expect_total 必须是整数，现在是 %r"
                                      % (where, total),
                           "metric": metric_id, "source": path})
        else:
            out["expect_total"] = total
    # 探针自己的必填参数
    if probe == "jsonl.count_where" and not out.get("where"):
        errors.append({"code": "MISSING_FIELD",
                       "message": "%s 用 jsonl.count_where 必须写 where" % where,
                       "metric": metric_id, "source": path})
    if probe == "json.pointer" and "pointer" not in out:
        errors.append({"code": "MISSING_FIELD",
                       "message": "%s 用 json.pointer 必须写 pointer" % where,
                       "metric": metric_id, "source": path})
    if probe == "csv.cell":
        for key in ("row_column", "row_key", "column"):
            if not out.get(key):
                errors.append({"code": "MISSING_FIELD",
                               "message": "%s 用 csv.cell 必须写 %s" % (where, key),
                               "metric": metric_id, "source": path})
    return out


def _validate_metric(raw, index: int, seen_ids: set, errors: list) -> dict:
    where = "第 %d 个 metric" % (index + 1)
    if not isinstance(raw, dict):
        errors.append({"code": "BAD_VALUE",
                       "message": "%s 必须是表" % where,
                       "metric": "", "source": ""})
        return {}
    mid = _need_str(raw, "id", where, errors)
    if mid:
        if not _ID_RE.match(mid) or ".." in mid:
            errors.append({"code": "BAD_VALUE",
                           "message": "%s 的 id %r 不合法（只许字母数字 . _ -，且不许 ..）"
                                      % (where, mid),
                           "metric": mid, "source": ""})
        if mid in seen_ids:
            errors.append({"code": "DUP_METRIC_ID",
                           "message": "metric id %r 重复了（报告内必须唯一）" % mid,
                           "metric": mid, "source": ""})
        seen_ids.add(mid)
    claim = _need_str(raw, "claim", where, errors, mid)
    value = _need_str(raw, "value", where, errors, mid)
    vtype = _need_enum(raw, "value_type", VALUE_TYPES, where, errors, mid)
    display = _need_str(raw, "display", where, errors, mid)
    precision = raw.get("precision")
    if vtype in ("percent", "float"):
        if precision is None:
            errors.append({"code": "MISSING_FIELD",
                           "message": "%s 是 %s，必须写 precision" % (where, vtype),
                           "metric": mid, "source": ""})
        elif isinstance(precision, bool) or not isinstance(precision, int) or precision < 0:
            errors.append({"code": "BAD_VALUE",
                           "message": "%s 的 precision 必须是非负整数，现在是 %r"
                                      % (where, precision),
                           "metric": mid, "source": ""})
    elif precision is not None and (isinstance(precision, bool)
                                    or not isinstance(precision, int) or precision < 0):
        errors.append({"code": "BAD_VALUE",
                       "message": "%s 的 precision 必须是非负整数，现在是 %r"
                                  % (where, precision),
                       "metric": mid, "source": ""})
    sources_raw = raw.get("sources")
    sources = []
    if not isinstance(sources_raw, list) or not sources_raw:
        errors.append({"code": "MISSING_FIELD",
                       "message": "%s 必须有 sources 数组" % where,
                       "metric": mid, "source": ""})
    else:
        for s in sources_raw:
            sources.append(_validate_source(s, where, mid, errors))
    metric = {"id": mid, "claim": claim, "value": value, "value_type": vtype,
              "display": display, "sources": sources}
    if precision is not None:
        metric["precision"] = precision
    _validate_value_form(metric, where, errors)
    _validate_source_set(metric, where, errors)
    return metric


def _validate_value_form(metric: dict, where: str, errors: list):
    """value 必须是规范形：count 整数；ratio 写 n/d；percent/float 十进制。"""
    mid = metric.get("id", "")
    value = metric.get("value", "")
    vtype = metric.get("value_type", "")
    if not value:
        return
    if vtype == "count":
        if not _INT_RE.match(value):
            errors.append({"code": "BAD_VALUE",
                           "message": "%s 的 count 值必须写成整数，现在是 %r"
                                      % (where, value),
                           "metric": mid, "source": ""})
    elif vtype == "ratio":
        m = _RATIO_RE.match(value)
        if not m:
            errors.append({"code": "BAD_VALUE",
                           "message": "%s 的 ratio 值必须写成 n/d，现在是 %r"
                                      % (where, value),
                           "metric": mid, "source": ""})
        elif int(m.group(2)) == 0:
            errors.append({"code": "ZERO_DENOMINATOR",
                           "message": "%s 的 ratio 分母是 0，比值没意义" % where,
                           "metric": mid, "source": ""})
    else:
        try:
            dec = Decimal(value)
        except InvalidOperation:
            errors.append({"code": "BAD_VALUE",
                           "message": "%s 的 %s 值必须是十进制数，现在是 %r"
                                      % (where, vtype, value),
                           "metric": mid, "source": ""})
            return
        if vtype == "percent" and not (Decimal(0) <= dec <= Decimal(100)):
            errors.append({"code": "BAD_VALUE",
                           "message": "%s 的 percent 值必须在 0–100 之间，现在是 %r"
                                      % (where, value),
                           "metric": mid, "source": ""})
        precision = metric.get("precision")
        if isinstance(precision, int) and not isinstance(precision, bool):
            digits = dec.normalize().as_tuple().exponent
            if isinstance(digits, int) and -digits > precision:
                errors.append({"code": "BAD_VALUE",
                               "message": "%s 的值小数位超过 precision=%d（%r）"
                                          % (where, precision, value),
                               "metric": mid, "source": ""})


def _validate_source_set(metric: dict, where: str, errors: list):
    """必需 source 集合：count/percent/float → role=value；ratio → 分子+分母。"""
    mid = metric.get("id", "")
    vtype = metric.get("value_type", "")
    roles = [s.get("role", "") for s in metric.get("sources", []) or []]
    counts = {r: roles.count(r) for r in ROLES}
    if vtype == "ratio":
        if counts.get("numerator", 0) != 1:
            errors.append({"code": "SOURCE_SET_INVALID",
                           "message": "%s 是 ratio，必须恰好一个 numerator 来源（现在 %d 个）"
                                      % (where, counts.get("numerator", 0)),
                           "metric": mid, "source": ""})
        if counts.get("denominator", 0) != 1:
            errors.append({"code": "SOURCE_SET_INVALID",
                           "message": "%s 是 ratio，必须恰好一个 denominator 来源（现在 %d 个）"
                                      % (where, counts.get("denominator", 0)),
                           "metric": mid, "source": ""})
        if counts.get("value", 0):
            errors.append({"code": "SOURCE_SET_INVALID",
                           "message": "%s 是 ratio，不许有 role=value 的来源" % where,
                           "metric": mid, "source": ""})
    else:
        if counts.get("value", 0) != 1:
            errors.append({"code": "SOURCE_SET_INVALID",
                           "message": "%s 必须恰好一个 role=value 的来源（现在 %d 个）"
                                      % (where, counts.get("value", 0)),
                           "metric": mid, "source": ""})
        if counts.get("numerator", 0) or counts.get("denominator", 0):
            errors.append({"code": "SOURCE_SET_INVALID",
                           "message": "%s 不许有 numerator/denominator 来源" % where,
                           "metric": mid, "source": ""})


def _validate_report(data: dict, rel_path: str) -> tuple:
    """结构校验。返回 (规范化报告, 错误列表)。错误列表为空才算结构过关。"""
    errors: list = []
    if not isinstance(data, dict):
        return {}, [{"code": "BAD_TOML", "message": "报告内容不是一张表",
                     "metric": "", "source": ""}]
    schema = data.get("schema")
    if schema != SCHEMA:
        errors.append({"code": "BAD_SCHEMA",
                       "message": "schema 必须是 %r，现在是 %r" % (SCHEMA, schema),
                       "metric": "", "source": ""})
        return {}, errors
    report = {"schema": schema}
    report["id"] = _need_str(data, "id", "报告", errors)
    if report["id"] and (not _ID_RE.match(report["id"]) or ".." in report["id"]):
        errors.append({"code": "BAD_VALUE",
                       "message": "报告 id %r 不合法（只许字母数字 . _ -，且不许 ..）"
                                  % report["id"], "metric": "", "source": ""})
    report["experiment"] = _need_str(data, "experiment", "报告", errors)
    report["status"] = _need_enum(data, "status", STATUSES, "报告", errors)
    report["generated_at"] = _need_str(data, "generated_at", "报告", errors)
    if report["generated_at"]:
        try:
            datetime.datetime.fromisoformat(
                report["generated_at"].replace("Z", "+00:00"))
        except ValueError:
            errors.append({"code": "BAD_VALUE",
                           "message": "generated_at %r 不是 ISO8601 时间"
                                      % report["generated_at"],
                           "metric": "", "source": ""})
    population = data.get("population")
    if not isinstance(population, dict):
        errors.append({"code": "MISSING_FIELD",
                       "message": "报告必须有 population 表（含 id）",
                       "metric": "", "source": ""})
        population = {}
    else:
        pid = _need_str(population, "id", "报告的 population", errors)
        population = dict(population)
        population["id"] = pid
    report["population"] = population
    metrics_raw = data.get("metric")
    if metrics_raw is None:
        metrics_raw = data.get("metrics")
    if not isinstance(metrics_raw, list) or not metrics_raw:
        errors.append({"code": "MISSING_FIELD",
                       "message": "报告必须有 metric 数组（[[metric]]）",
                       "metric": "", "source": ""})
        metrics_raw = []
    seen: set = set()
    metrics = []
    for index, raw in enumerate(metrics_raw):
        metrics.append(_validate_metric(raw, index, seen, errors))
    report["metrics"] = metrics
    report["path"] = rel_path
    return report, errors


def load_report(ws, report_path) -> dict:
    """读并校验归一化报告，返回规范化 dict。

    结构有问题直接抛 ReportError（带 code）。写盘的事一律不管。
    """
    root = _ws_root(ws)
    path = _resolve_in_ws(root, report_path)
    _check_file(path, "报告文件")
    rel = _rel_posix(root, path)
    data = _load_report_toml(path)
    report, errors = _validate_report(data, rel)
    if errors:
        first = errors[0]
        raise ReportError(first["message"], code=first["code"],
                          metric=first.get("metric", ""),
                          source=first.get("source", ""))
    # 来源路径必须在工作区内（越界/软链当场拒，不等到探针才发现）。
    for metric in report.get("metrics", []):
        for source in metric.get("sources", []):
            try:
                _resolve_in_ws(root, source.get("path", ""))
            except ReportError as exc:
                raise ReportError(exc.message, code=exc.code,
                                  metric=metric.get("id", ""),
                                  source=source.get("path", ""))
    return report


# --------------------------------------------------------------------------
# 探针
# --------------------------------------------------------------------------

def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise ReportError("%s 不是合法 UTF-8：%s" % (path.name, exc),
                          code="PROBE_PARSE")
    except OSError as exc:
        raise ReportError("%s 读不了：%s" % (path.name, exc),
                          code="FILE_NOT_FOUND")


def _probe_jsonl_count(path: Path):
    """数非空行，返回整数。"""
    text = _read_text(path)
    lines = text.splitlines()
    nonempty = [ln for ln in lines if ln.strip()]
    return len(nonempty), "非空行 %d 行" % len(nonempty), {"nonempty": len(nonempty)}


def _parse_literal(text: str):
    """where 的右值：按 JSON 字面量解析（true/false/数字/带引号串），失败按普通字符串。"""
    raw = str(text).strip()
    try:
        return json.loads(raw)
    except ValueError:
        return raw


def _literal_equal(actual, expected) -> bool:
    """顶层字段与字面量比较；类型不同不算命中（True != 1）。"""
    if expected is None:
        return actual is None
    if isinstance(expected, bool):
        return isinstance(actual, bool) and actual == expected
    if isinstance(expected, int):
        return isinstance(actual, int) and not isinstance(actual, bool) and actual == expected
    if isinstance(expected, float):
        if isinstance(actual, bool) or not isinstance(actual, (int, float)):
            return False
        return Decimal(str(actual)) == Decimal(str(expected))
    if isinstance(expected, str):
        return isinstance(actual, str) and actual == expected
    return actual == expected


def _probe_jsonl_count_where(path: Path, source: dict):
    """按顶层字段过滤计数，返回 (命中数, 说明, 计数)。"""
    where = str(source.get("where", ""))
    field, sep, literal_text = where.partition("=")
    field = field.strip()
    if not sep or not field:
        raise ReportError("where %r 不是 field=value 的写法" % where,
                          code="PROBE_ERROR")
    expected = _parse_literal(literal_text)
    text = _read_text(path)
    lines = [ln for ln in text.splitlines() if ln.strip()]
    matched = 0
    for number, line in enumerate(lines, 1):
        try:
            obj = json.loads(line)
        except ValueError as exc:
            raise ReportError("第 %d 行不是合法 JSON：%s" % (number, exc),
                              code="PROBE_PARSE")
        if not isinstance(obj, dict):
            raise ReportError("第 %d 行不是 JSON 对象" % number,
                              code="PROBE_PARSE")
        if field in obj and _literal_equal(obj.get(field), expected):
            matched += 1
    total = len(lines)
    expect_total = source.get("expect_total")
    if isinstance(expect_total, int) and not isinstance(expect_total, bool):
        if total != expect_total:
            raise ReportError("总行数 %d 与 expect_total %d 对不上" % (total, expect_total),
                              code="PROBE_MISMATCH")
    detail = "命中 %d / 共 %d 行（%s=%s）" % (matched, total, field, literal_text.strip())
    return matched, detail, {"matched": matched, "total": total}


def _probe_csv_cell(path: Path, source: dict):
    """CSV 单元探针：表头列名 + 行键定位，返回单元格字符串。"""
    row_column = str(source.get("row_column", ""))
    row_key = str(source.get("row_key", ""))
    column = str(source.get("column", ""))
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as fh:
            rows = list(csv.reader(fh))
    except UnicodeDecodeError as exc:
        raise ReportError("%s 不是合法 UTF-8：%s" % (path.name, exc),
                          code="PROBE_PARSE")
    if not rows:
        raise ReportError("%s 是空的，没有表头" % path.name, code="PROBE_ERROR")
    header = [h.strip() for h in rows[0]]
    if row_column not in header:
        raise ReportError("%s 的表头里没有列 %r（表头：%s）"
                          % (path.name, row_column, "、".join(header)),
                          code="PROBE_ERROR")
    if column not in header:
        raise ReportError("%s 的表头里没有列 %r（表头：%s）"
                          % (path.name, column, "、".join(header)),
                          code="PROBE_ERROR")
    ridx = header.index(row_column)
    cidx = header.index(column)
    hits = []
    for row in rows[1:]:
        if not row:
            continue
        key = row[ridx].strip() if ridx < len(row) else ""
        if key == row_key:
            hits.append(row)
    if not hits:
        raise ReportError("%s 里没有 %s=%r 的行" % (path.name, row_column, row_key),
                          code="PROBE_ERROR")
    if len(hits) > 1:
        raise ReportError("%s 里 %s=%r 命中 %d 行，必须恰好 1 行"
                          % (path.name, row_column, row_key, len(hits)),
                          code="PROBE_ERROR")
    cell = hits[0][cidx] if cidx < len(hits[0]) else ""
    detail = "行 %s=%s 的 %s 列 = %s" % (row_column, row_key, column, cell)
    return cell, detail, {"rows": len(rows) - 1, "hits": 1}


def _pointer_tokens(pointer: str) -> list:
    if pointer == "":
        return []
    if not pointer.startswith("/"):
        raise ReportError("JSON Pointer %r 必须以 / 开头" % pointer,
                          code="PROBE_ERROR")
    tokens = []
    for raw in pointer.split("/")[1:]:
        token = raw.replace("~1", "/").replace("~0", "~")
        tokens.append(token)
    return tokens


def _probe_json_pointer(path: Path, source: dict):
    """RFC 6901 指针取值，终点必须是标量。"""
    pointer = str(source.get("pointer", ""))
    text = _read_text(path)
    try:
        doc = json.loads(text, parse_float=Decimal)
    except ValueError as exc:
        raise ReportError("%s 不是合法 JSON：%s" % (path.name, exc),
                          code="PROBE_PARSE")
    node = doc
    for token in _pointer_tokens(pointer):
        if isinstance(node, dict):
            if token not in node:
                raise ReportError("JSON Pointer %r 在 %r 处找不到"
                                  % (pointer, token), code="PROBE_ERROR")
            node = node[token]
        elif isinstance(node, list):
            if not re.fullmatch(r"0|[1-9]\d*", token):
                raise ReportError("JSON Pointer %r 的数组下标 %r 不合法"
                                  % (pointer, token), code="PROBE_ERROR")
            index = int(token)
            if index >= len(node):
                raise ReportError("JSON Pointer %r 的下标 %d 越界"
                                  % (pointer, index), code="PROBE_ERROR")
            node = node[index]
        else:
            raise ReportError("JSON Pointer %r 走到了标量上" % pointer,
                              code="PROBE_ERROR")
    if isinstance(node, (dict, list)):
        raise ReportError("JSON Pointer %r 指的是容器，不是标量" % pointer,
                          code="PROBE_ERROR")
    detail = "%s = %s" % (pointer, node)
    return node, detail, {}


def _run_probe(root: Path, source: dict):
    """跑一个探针：返回 (值, 人话说明, 中间计数)。"""
    probe = source.get("probe", "")
    path = _resolve_in_ws(root, source.get("path", ""))
    _check_file(path, "来源文件")
    if probe == "jsonl.count":
        return _probe_jsonl_count(path)
    if probe == "jsonl.count_where":
        return _probe_jsonl_count_where(path, source)
    if probe == "csv.cell":
        return _probe_csv_cell(path, source)
    if probe == "json.pointer":
        return _probe_json_pointer(path, source)
    raise ReportError("不认识的探针 %r" % probe, code="BAD_ENUM")


# --------------------------------------------------------------------------
# 值比较：一律用 Decimal，不许 float 参与
# --------------------------------------------------------------------------

def _as_decimal(value, where: str):
    if isinstance(value, bool):
        raise ReportError("%s 取到的是布尔值，不是数字" % where,
                          code="PROBE_MISMATCH")
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):  # 兜底：探针不该产出 float
        return Decimal(str(value))
    text = str(value).strip()
    if not text:
        raise ReportError("%s 取到的是空值" % where, code="PROBE_MISMATCH")
    try:
        return Decimal(text)
    except InvalidOperation:
        raise ReportError("%s 取到的 %r 不是数字" % (where, text),
                          code="PROBE_MISMATCH")


def _compare_metric(metric: dict, probed: dict) -> list:
    """把探针结果和报告里写的 value 比一遍，返回错误列表。"""
    errors: list = []
    mid = metric.get("id", "")
    vtype = metric.get("value_type", "")
    value = metric.get("value", "")

    def err(code, msg):
        errors.append({"code": code, "message": msg, "metric": mid, "source": ""})

    if vtype == "count":
        if "value" not in probed:
            return errors
        try:
            got = _as_decimal(probed["value"], "指标 %s 的 value 来源" % mid)
        except ReportError as exc:
            err(exc.code, exc.message)
            return errors
        if got != got.to_integral_value():
            err("BAD_VALUE", "指标 %s 是 count，但探针取到 %s，不是整数" % (mid, got))
            return errors
        want = Decimal(value)
        if got != want:
            err("PROBE_MISMATCH",
                "指标 %s 写的是 %s，探针数出来是 %s" % (mid, value, got))
    elif vtype == "ratio":
        m = _RATIO_RE.match(value)
        if not m:
            return errors
        want_num, want_den = Decimal(m.group(1)), Decimal(m.group(2))
        if want_den == 0:
            err("ZERO_DENOMINATOR", "指标 %s 的分母是 0，比值没意义" % mid)
            return errors
        if "denominator" in probed:
            try:
                got_den = _as_decimal(probed["denominator"],
                                      "指标 %s 的 denominator 来源" % mid)
            except ReportError as exc:
                err(exc.code, exc.message)
                return errors
            if got_den == 0:
                err("ZERO_DENOMINATOR",
                    "指标 %s 的分母探针数出来是 0，比值没意义" % mid)
                return errors
            if got_den != want_den:
                err("PROBE_MISMATCH",
                    "指标 %s 的分母写的是 %s，探针数出来是 %s"
                    % (mid, want_den, got_den))
        if "numerator" in probed:
            try:
                got_num = _as_decimal(probed["numerator"],
                                      "指标 %s 的 numerator 来源" % mid)
            except ReportError as exc:
                err(exc.code, exc.message)
                return errors
            if got_num != want_num:
                err("PROBE_MISMATCH",
                    "指标 %s 的分子写的是 %s，探针数出来是 %s"
                    % (mid, want_num, got_num))
    else:
        if "value" not in probed:
            return errors
        try:
            got = _as_decimal(probed["value"], "指标 %s 的 value 来源" % mid)
        except ReportError as exc:
            err(exc.code, exc.message)
            return errors
        precision = metric.get("precision")
        if not isinstance(precision, int) or isinstance(precision, bool):
            err("MISSING_FIELD", "指标 %s 是 %s，必须写 precision" % (mid, vtype))
            return errors
        want = Decimal(value)
        tolerance = Decimal("0.5") * (Decimal(10) ** Decimal(-precision))
        if abs(want - got) > tolerance:
            err("PROBE_MISMATCH",
                "指标 %s 写的是 %s，探针取到 %s（precision=%d，容差 ±%s）"
                % (mid, value, got, precision, tolerance))
    return errors


# --------------------------------------------------------------------------
# check / lock / card / signoff
# --------------------------------------------------------------------------

def _jsonable(value):
    """JSON 能写的形态：Decimal 写成十进制字符串（不许 float 混进摘要）。"""
    if isinstance(value, Decimal):
        return format(value.normalize(), "f")
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    if isinstance(value, Path):
        return value.as_posix()
    return value


def _artifact_path(root: Path, report: dict, suffix: str) -> Path:
    """<report 同目录>/<report_id><suffix>。"""
    rp = _resolve_in_ws(root, report.get("path", ""))
    return rp.parent / ("%s%s" % (report.get("id", "report"), suffix))


def check_report(ws, report_path) -> dict:
    """不写盘。把报告跑一遍探针并比对，返回 {ok, errors, metrics}。"""
    errors: list = []
    metrics_out: list = []
    try:
        root = _ws_root(ws)
        path = _resolve_in_ws(root, report_path)
        _check_file(path, "报告文件")
        rel = _rel_posix(root, path)
        data = _load_report_toml(path)
    except ReportError as exc:
        return {"ok": False,
                "errors": [{"code": exc.code, "message": str(exc),
                            "metric": exc.metric, "source": exc.source}],
                "metrics": []}
    report, errors = _validate_report(data, rel)
    if errors:
        return {"ok": False, "errors": errors, "metrics": []}

    for metric in report.get("metrics", []):
        mid = metric.get("id", "")
        probed: dict = {}
        sources_out: list = []
        for source in metric.get("sources", []):
            role = source.get("role", "")
            entry = {"path": source.get("path", ""), "sha256": "", "size": 0,
                     "role": role, "probe": source.get("probe", ""), "detail": ""}
            try:
                target = _resolve_in_ws(root, source.get("path", ""))
                entry["size"] = _check_file(target, "来源文件")
                entry["sha256"] = _sha256_of(target)
                value, detail, counts = _run_probe(root, source)
                entry["detail"] = detail
                if role in ("value", "numerator", "denominator"):
                    probed[role] = value
            except ReportError as exc:
                entry["detail"] = str(exc)
                errors.append({"code": exc.code, "message": str(exc),
                               "metric": mid, "source": source.get("path", "")})
            sources_out.append(entry)
        errors.extend(_compare_metric(metric, probed))
        metrics_out.append({
            "id": mid,
            "value": metric.get("value", ""),
            "probed": _jsonable(probed),
            "sources": sources_out,
        })

    errors.extend(_check_lock_consistency(root, report, path))
    return {"ok": not errors, "errors": errors, "metrics": metrics_out}


def _check_lock_consistency(root: Path, report: dict, report_file: Path) -> list:
    """锁在就在：报告哈希、三项摘要、输入哈希都得跟现在一致（R7）。"""
    errors: list = []
    lock_path = _artifact_path(root, report, ".lock.json")
    if not lock_path.exists():
        return errors
    try:
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return [{"code": "LOCK_MISMATCH",
                 "message": "锁文件 %s 读不了：%s" % (lock_path.name, exc),
                 "metric": "", "source": ""}]
    if not isinstance(lock, dict):
        return [{"code": "LOCK_MISMATCH",
                 "message": "锁文件 %s 不是 JSON 对象" % lock_path.name,
                 "metric": "", "source": ""}]
    if lock.get("report_sha256") != _sha256_of(report_file):
        errors.append({"code": "LOCK_MISMATCH",
                       "message": "报告文件在锁之后被改过（报告哈希对不上）",
                       "metric": "", "source": report.get("path", "")})
    try:
        sem = semantic_digest(report)
        ev = evidence_digest(root, report)
    except ReportError as exc:
        errors.append({"code": exc.code, "message": str(exc),
                       "metric": "", "source": ""})
        return errors
    if lock.get("semantic_digest") != sem:
        errors.append({"code": "LOCK_MISMATCH",
                       "message": "报告语义摘要与锁里记的对不上（报告被改过）",
                       "metric": "", "source": report.get("path", "")})
    if lock.get("evidence_digest") != ev:
        errors.append({"code": "LOCK_MISMATCH",
                       "message": "证据摘要与锁里记的对不上（原始产物或来源声明被改过）",
                       "metric": "", "source": report.get("path", "")})
    # 输入文件逐个核哈希：谁被动了要指名道姓。
    for item in lock.get("inputs", []) or []:
        if not isinstance(item, dict):
            continue
        try:
            target = _resolve_in_ws(root, item.get("path", ""))
            _check_file(target, "来源文件")
        except ReportError as exc:
            errors.append({"code": exc.code, "message": str(exc),
                           "metric": "", "source": item.get("path", "")})
            continue
        got = _sha256_of(target)
        if got != item.get("sha256"):
            errors.append({"code": "HASH_MISMATCH",
                           "message": "原始产物 %s 的哈希与锁里记的对不上"
                                      "（锁里 %s，现在 %s）"
                                      % (item.get("path", ""),
                                         str(item.get("sha256", ""))[:12], got[:12]),
                           "metric": "", "source": item.get("path", "")})
    return errors


def lock_report(ws, report_path) -> dict:
    """check 通过后写锁文件（0600，原子写）。check 有错直接抛 ReportError。"""
    result = check_report(ws, report_path)
    if not result["ok"]:
        first = result["errors"][0]
        raise ReportError("报告没过 check，不能上锁：%s" % first["message"],
                          code="CHECK_FAILED", metric=first.get("metric", ""),
                          source=first.get("source", ""))
    root = _ws_root(ws)
    report = load_report(ws, report_path)
    report_file = _resolve_in_ws(root, report["path"])
    lock = {
        "schema": LOCK_SCHEMA,
        "report": report["path"],
        "report_sha256": _sha256_of(report_file),
        "locked_at": _iso_now(),
        "inputs": [],
        "semantic_digest": semantic_digest(report),
        "evidence_digest": evidence_digest(root, report),
        "probe_results": [],
    }
    seen = set()
    for metric in report["metrics"]:
        for source in metric["sources"]:
            target = _resolve_in_ws(root, source.get("path", ""))
            rel = _rel_posix(root, target)
            key = (rel, source.get("role", ""))
            if key in seen:
                continue
            seen.add(key)
            lock["inputs"].append({
                "path": rel,
                "sha256": _sha256_of(target),
                "size": target.stat().st_size,
                "role": source.get("role", ""),
            })
    for metric in report["metrics"]:
        for source in metric["sources"]:
            value, _detail, counts = _run_probe(root, source)
            lock["probe_results"].append({
                "metric": metric.get("id", ""),
                "role": source.get("role", ""),
                "probe": source.get("probe", ""),
                "value": _jsonable(value),
                "counts": _jsonable(counts),
            })
    lock_path = _artifact_path(root, report, ".lock.json")
    _write_atomic(lock_path,
                  (json.dumps(lock, ensure_ascii=False, indent=2,
                              sort_keys=True) + "\n").encode("utf-8"))
    return lock


def _write_atomic(path: Path, data: bytes, mode: int = 0o600):
    """原子写：同目录临时文件 + rename；权限 0600。"""
    tmp = path.with_name("%s.tmp-%d" % (path.name, os.getpid()))
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.chmod(str(tmp), mode)
        os.replace(str(tmp), str(path))
        os.chmod(str(path), mode)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def _question_for(metric: dict) -> str:
    """每个指标要人回答的一个问题（卡上最后一段）。"""
    vtype = metric.get("value_type", "")
    if vtype == "ratio":
        return "分母是不是这次实验的全部样本？"
    if vtype == "count":
        return "这个数是不是在同一批样本上数的？"
    return "这个百分比跟论文里写的一致吗？"


def _card_lines(report: dict, result: dict) -> list:
    """审阅卡：每行一个指标（值 + 来源与定位 + 中间计数 + 一个问题）。最多 6 行。"""
    by_id = {m.get("id", ""): m for m in result.get("metrics", [])}
    lines = []
    for metric in report.get("metrics", []):
        mid = metric.get("id", "")
        got = by_id.get(mid, {})
        sources = got.get("sources", []) or []
        where = "、".join("%s（%s）" % (s.get("path", ""), s.get("detail", ""))
                          for s in sources) or "（没有来源）"
        shown = metric.get("display") or metric.get("value", "")
        lines.append("· %s：%s（规范值 %s）｜来源 %s｜请确认：%s"
                     % (mid, shown, metric.get("value", ""), where,
                        _question_for(metric)))
    # 不截断：被截掉的指标会变成「人没看见却签了字」，比卡片长更危险。
    return lines


def report_card(ws, report_path) -> dict:
    """渲染审阅卡；check 与锁都必须过关，否则抛 ReportError。"""
    result = check_report(ws, report_path)
    if not result["ok"]:
        first = result["errors"][0]
        raise ReportError("报告没过 check，出不了卡：%s" % first["message"],
                          code="CHECK_FAILED", metric=first.get("metric", ""),
                          source=first.get("source", ""))
    root = _ws_root(ws)
    report = load_report(ws, report_path)
    report_file = _resolve_in_ws(root, report["path"])
    lock_path = _artifact_path(root, report, ".lock.json")
    if not lock_path.exists():
        raise ReportError("还没有锁文件 %s，先 lock 再出卡" % lock_path.name,
                          code="LOCK_MISSING")
    try:
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ReportError("锁文件 %s 读不了：%s" % (lock_path.name, exc),
                          code="LOCK_MISMATCH")
    current = {
        "report_sha256": _sha256_of(report_file),
        "semantic_digest": semantic_digest(report),
        "evidence_digest": evidence_digest(root, report),
    }
    for key, value in current.items():
        if lock.get(key) != value:
            raise ReportError("锁里的 %s 与现在对不上（锁里 %s，现在 %s）"
                              % (key, str(lock.get(key))[:12], value[:12]),
                              code="LOCK_MISMATCH")
    lines = _card_lines(report, result)
    return {
        "lines": lines,
        "card_digest": digest_of(lines),
        "report_sha256": current["report_sha256"],
        "semantic_digest": current["semantic_digest"],
        "evidence_digest": current["evidence_digest"],
    }


def _toml_str(text: str) -> str:
    """TOML 基本字符串：JSON 的转义是 TOML 基本串的子集，直接用。"""
    return json.dumps(str(text), ensure_ascii=False)


def _toml_dump(data: dict) -> str:
    lines = []
    for key, value in data.items():
        if isinstance(value, bool):
            lines.append("%s = %s" % (key, "true" if value else "false"))
        elif isinstance(value, int):
            lines.append("%s = %d" % (key, value))
        elif isinstance(value, str):
            lines.append("%s = %s" % (key, _toml_str(value)))
        elif isinstance(value, list) and all(isinstance(v, str) for v in value):
            lines.append("%s = [%s]" % (key, ", ".join(_toml_str(v) for v in value)))
        else:
            raise ReportError("签收文件里暂不支持 %s 这种值" % type(value).__name__,
                              code="BAD_VALUE")
    return "\n".join(lines) + "\n"


def _last_entry_sha(log_path: Path) -> str:
    """流水里最后一条的 entry_sha256；没有流水就是 64 个 0。"""
    if not log_path.exists():
        return _ZERO_HASH
    last = ""
    try:
        for line in log_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                last = line
    except OSError:
        return _ZERO_HASH
    if not last:
        return _ZERO_HASH
    try:
        entry = json.loads(last)
    except ValueError:
        return _ZERO_HASH
    return str(entry.get("entry_sha256", _ZERO_HASH))


def sign_report(ws, report_path, by, card_out=None) -> dict:
    """人签收：写 <id>.signoff.toml，并向 <id>.signoff.log 追加一条哈希链流水。"""
    card = report_card(ws, report_path)
    root = _ws_root(ws)
    report = load_report(ws, report_path)
    log_path = _artifact_path(root, report, ".signoff.log")
    signoff_path = _artifact_path(root, report, ".signoff.toml")
    prev = _last_entry_sha(log_path)
    signoff = {
        "schema": SIGNOFF_SCHEMA,
        "report": report["path"],
        "report_id": report["id"],
        "signed_by": str(by or ""),
        "signed_at": _iso_now(),
        "report_sha256": card["report_sha256"],
        "semantic_digest": card["semantic_digest"],
        "evidence_digest": card["evidence_digest"],
        "card_digest": card["card_digest"],
        "card_lines": list(card["lines"]),
        "prev_sha256": prev,
    }
    entry = {k: v for k, v in signoff.items() if k not in ("schema", "card_lines")}
    entry_sha = digest_of(entry)
    signoff["entry_sha256"] = entry_sha
    _write_atomic(signoff_path, _toml_dump(signoff).encode("utf-8"))
    line = dict(entry)
    line["entry_sha256"] = entry_sha
    with log_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(line, ensure_ascii=False, sort_keys=True,
                            separators=(",", ":")) + "\n")
    if card_out:
        # 输出同样不许跑出工作区：否则 --card-out ../../x 能覆盖任意文件
        out = _resolve_in_ws(root, card_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("\n".join(card["lines"]) + "\n", encoding="utf-8")
    return signoff


def _verify_chain(log_path: Path, signoff: dict) -> tuple:
    """核签收流水：链不能断、每条的 entry_sha256 必须自己算得出来。"""
    if not log_path.exists():
        return False, "签收流水 %s 不在" % log_path.name
    try:
        lines = [ln for ln in log_path.read_text(encoding="utf-8").splitlines()
                 if ln.strip()]
    except OSError as exc:
        return False, "签收流水读不了：%s" % exc
    if not lines:
        return False, "签收流水是空的"
    prev = _ZERO_HASH
    last_sha = ""
    for number, line in enumerate(lines, 1):
        try:
            entry = json.loads(line)
        except ValueError as exc:
            return False, "签收流水第 %d 行不是 JSON：%s" % (number, exc)
        if not isinstance(entry, dict):
            return False, "签收流水第 %d 行不是对象" % number
        if entry.get("prev_sha256") != prev:
            return False, "签收流水第 %d 行断链了（prev 对不上）" % number
        body = {k: v for k, v in entry.items() if k != "entry_sha256"}
        if digest_of(body) != entry.get("entry_sha256"):
            return False, "签收流水第 %d 行的 entry_sha256 算不出来" % number
        prev = str(entry.get("entry_sha256", ""))
        last_sha = prev
    if signoff.get("entry_sha256") and last_sha != signoff.get("entry_sha256"):
        return False, "签收流水最后一条与签收文件对不上"
    return True, "签收流水链完整（%d 条）" % len(lines)


def verify_signoff(ws, report_path) -> dict:
    """核签收：签收文件在不在、摘要对不对得上、流水链完不完整。"""
    try:
        root = _ws_root(ws)
        report = load_report(ws, report_path)
    except ReportError as exc:
        return {"ok": False, "reason": "报告读不了：%s" % exc, "signoff": None}
    signoff_path = _artifact_path(root, report, ".signoff.toml")
    log_path = _artifact_path(root, report, ".signoff.log")
    if not signoff_path.exists():
        return {"ok": False,
                "reason": "还没有签收文件 %s" % signoff_path.name,
                "signoff": None}
    try:
        signoff = _load_report_toml(signoff_path)
    except ReportError as exc:
        return {"ok": False, "reason": "签收文件读不了：%s" % exc, "signoff": None}
    if not isinstance(signoff, dict):
        return {"ok": False, "reason": "签收文件不是一张表", "signoff": None}
    try:
        report_file = _resolve_in_ws(root, report["path"])
        current = {
            "report_sha256": _sha256_of(report_file),
            "semantic_digest": semantic_digest(report),
            "evidence_digest": evidence_digest(root, report),
        }
    except ReportError as exc:
        return {"ok": False, "reason": str(exc), "signoff": signoff}
    for key, value in current.items():
        if signoff.get(key) != value:
            return {"ok": False,
                    "reason": "%s 对不上（签收时 %s，现在 %s）"
                              % (key, str(signoff.get(key))[:12], value[:12]),
                    "signoff": signoff}
    try:
        card = report_card(ws, report_path)
    except ReportError as exc:
        return {"ok": False, "reason": "审阅卡重算失败：%s" % exc,
                "signoff": signoff}
    if signoff.get("card_digest") != card["card_digest"]:
        return {"ok": False,
                "reason": "card_digest 对不上（签收时 %s，现在 %s）"
                          % (str(signoff.get("card_digest"))[:12],
                             card["card_digest"][:12]),
                "signoff": signoff}
    ok, reason = _verify_chain(log_path, signoff)
    if not ok:
        return {"ok": False, "reason": reason, "signoff": signoff}
    return {"ok": True, "reason": reason, "signoff": signoff}
