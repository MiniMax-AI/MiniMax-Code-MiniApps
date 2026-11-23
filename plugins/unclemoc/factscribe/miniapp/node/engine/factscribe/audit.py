# -*- coding: utf-8 -*-
"""源头锚定、check/audit 各类检查、报告模型与错误码。"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from .citations import (BibEntry, _URL_OK_TYPES, bib_duplicates, parse_bib,
                        unused_bib_entries, valid_stable_id)
from .checks import aggregate_exit
from .config import (Config, ConfigError, _glob_paths, _read_text,
                     all_tex_files, facts_digest, git_commit, load_toml)
from .constants import (CONFIDENCE_OK, EXIT_INTEGRITY, KINDS_OK, SEV_INFO,
                        SEV_RED, SEV_YELLOW, VERSION)
from .evidence import CHANGED_CODE, UNFROZEN_CODE, lock_check, unfrozen_info
from .facts import (Fact, ExprError, _cycles, _declared_number, canon_text,
                    eval_expr, literal_tokens, number_key, sha256_file)
from .i18n import finding_key
from .texrules import (adjacency_hits, arith_hits, display_hits,
                       fsignore_quant_hits, numeric_macro_hits,
                       tabular_regions)
from .texscan import (_balanced, _blank, _extract_numbers,
                      _merge_number_units, has_auditable_content, scan_tex,
                      sentence_index, sentence_spans, structural_whitelist)

# --------------------------------------------------------------------------
# 问题单
# --------------------------------------------------------------------------

@dataclass
class Issue:
    code: str
    message: str
    location: str = ""
    token: str = ""
    context: str = ""
    severity: str = SEV_RED
    exit_code: int = 1        # 1=FACT/CONFIG，5=COVERAGE/INTEGRITY，7=STALE，8=工具缺失
    # i18n（只增字段，不动 as_dict 的形状）：message_key 指向
    # factscribe/i18n.py 的双语目录，params 是模板槽位的取值。
    # 旧字段 message 仍是中文原文——CLI/JSON 输出与金样例一字不动。
    message_key: str = ""
    params: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        d = {"severity": self.severity, "code": self.code, "message": self.message}
        if self.location:
            d["location"] = self.location
        if self.token:
            d["token"] = self.token
        if self.context:
            d["context"] = self.context
        return d

def _source_rel_ok(src: str) -> str:
    """source 必须是相对路径；返回错误码或空串。"""
    if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*://", src):
        return "BAD_SOURCE_PATH"
    p = Path(src)
    if p.is_absolute() or ".." in p.parts:
        return "BAD_SOURCE_PATH"
    return ""


def _display_issues(facts: list[Fact]) -> list[Issue]:
    """R-04：display 只能追加与 value 严格等价的写法（内部 B2/2-B2）。"""
    out: list[Issue] = []
    for f in facts:
        loc = "%s:%s" % (f.file, f.line or "?")
        for code, detail, extra in display_hits(f):
            out.append(Issue(code, "fact %r：%s" % (f.id, detail),
                             location=loc, token=f.id,
                             message_key=finding_key(code),
                             params={"fact": repr(f.id), **extra}))
    return out


# v1.3：expr 与 value 的数值比较口径沿用 check（相对 1e-9）。不新造浮点
# 规则；fact 需要更宽/更窄的显式容差时写 ``expr_tolerance``（相对误差）。
EXPR_REL_TOL = 1e-9


def _expr_issues(f: Fact, known: dict[str, Fact]) -> list[Issue]:
    """派生 fact 的 expr 求值必须与 value 相符（G5，check/audit 共用）。

    报错给两侧数值与误差；容差默认是既有的 1e-9 相对口径，fact 可用
    ``expr_tolerance`` 显式覆盖。expr 不可求值仍是 ``EXPR_INVALID``。
    """
    if not f.expr:
        return []
    loc = "%s:%s" % (f.file, f.line or "?")
    try:
        got = eval_expr(f.expr, known)
        want = _declared_number(f.value)
    except ExprError as exc:
        return [Issue("EXPR_INVALID", "fact %r 的 expr 不可用：%s" % (f.id, exc),
                      location=loc, token=f.id, params={"fact": repr(f.id), "detail": str(exc)})]
    rel = f.expr_tolerance if f.expr_tolerance is not None else EXPR_REL_TOL
    limit = rel * max(1.0, abs(want))
    err = abs(got - want)
    if err > limit:
        return [Issue(
            "EXPR_MISMATCH",
            "fact %r 的 expr=%r 算出 %.10g，与 value=%r（%.10g）不符："
            "误差 %.3g 超过容差 %.3g" % (f.id, f.expr, got, f.value, want,
                                      err, limit),
            location=loc, token=f.id, params={"fact": repr(f.id), "fact1": repr(f.expr), "got": format(got, ".10g"), "value": repr(f.value), "want": format(want, ".10g"), "detail": format(err, ".3g"), "limit": format(limit, ".3g")})]
    return []


def _mask_fact_bodies(tex: str) -> str:
    """V3：`\\fact{ID}{value}` 的 value 是**被绑定**的显示形。

    `\\the\\value{counter}` 这类计数渲染出现在绑定体内时，数字由 fact 授权、
    再由 PDF 闸门核对；不该在这里重复判 ARITH_IN_BODY。空白保留换行以
    维持行号。
    """
    out = list(tex)
    i = 0
    n = len(tex)
    while i < n:
        if tex.startswith("\\fact", i):
            j = i + 5
            while j < n and tex[j] in " \t\r\n":
                j += 1
            if j < n and tex[j] == "{":
                e1 = _balanced(tex, j, "{", "}")
                k = e1
                while k < n and tex[k] in " \t\r\n":
                    k += 1
                if k < n and tex[k] == "{":
                    e2 = _balanced(tex, k, "{", "}")
                    _blank(out, i, e2)
                    i = e2
                    continue
        i += 1
    return "".join(out)


def _source_rule_issues(cfg: Config, sections) -> list[Issue]:
    """R-01A / R-05 / R-07 的闭包级判据（对每个扫描到的文本文件跑）。"""
    out: list[Issue] = []
    # V3：计数器**声明/赋值**（\newcounter/\setcounter…）是证据源定义，不是
    # 渲染出的数字；真正把计数器渲染成数字的 \the/\value/\numexpr 仍判红，
    # 绑定体内的渲染由 _mask_fact_bodies 交给 PDF 闸门核对。
    counter_setup = {"newcounter", "setcounter", "addtocounter",
                     "stepcounter", "refstepcounter"} if cfg.is_v3 else set()
    for rel, text in sections:
        for name, line in arith_hits(_mask_fact_bodies(text) if cfg.is_v3 else text):
            if name in counter_setup:
                continue
            computed = cfg.is_v3 and name in {"numexpr", "dimexpr", "inteval"}
            out.append(Issue(
                "COMPUTED_VALUE_UNREGISTERED" if computed else "ARITH_IN_BODY",
                ("现场计算命令 \\%s 会生成账上没有的数字且未登记——计算值不可寻址（P-06）"
                 if computed else
                 "算术/计数器命令 \\%s 会产生账上没有的数字——数值不可寻址（R-01A-A）")
                % name, location="%s:%s" % (rel, line), token="\\" + name,
                message_key=("finding.COMPUTED_VALUE_UNREGISTERED.command"
                             if computed else "finding.ARITH_IN_BODY"),
                params={"name": name}))
        for name, line, digit in numeric_macro_hits(text, cfg.numeric_macro_allow):
            out.append(Issue(
                "NUMERIC_IN_MACRO",
                "宏 \\%s 的定义体携带数字（%r）——宏可以携带 fact id，不可以携带数字"
                "（R-01A-B；确属布局宏请进 project.numeric_macro_allow 人签登记）"
                % (name, digit), location="%s:%s" % (rel, line), token="\\" + name, params={"name": str(name), "digit": repr(digit)}))
        for line, arg, hits in fsignore_quant_hits(scan_tex(text).annotation_args):
            out.append(Issue(
                "FSIGNORE_QUANT",
                "\\fsignore 参数里出现定量（%s）——豁免宏不得用来抹掉结论句：%r"
                % (hits, arg), location="%s:%s" % (rel, line), token=hits, params={"hits": str(hits), "arg": repr(arg)}))
    return out


# 退出码折算已迁核验槽（factscribe/checks.py，SPEC-CHECKS §2.2 槽第 3 件事）：
# 折算规则一字不改、值永不变化（包不产生退出码，折算只在槽发生）。
# 旧名 `_aggregate_exit` 保留为再导出别名，cli/workbench 的既有 import 零改动。
_aggregate_exit = aggregate_exit


def _v3_source_issues(cfg: Config, facts: list[Fact],
                      sections: list[tuple[str, str]]) -> list[Issue]:
    """V3 专属的源层判据：key 信任根、数值宏形状、断言/审批（S-01/S-03/S-08）。"""
    from .v3 import (_load_json, approval_issues, approval_report_issues,
                     assertion_issues, bu_index, key_trust_issues,
                     numeric_macro_issues)
    from .livetext import live_text_issues

    out: list[Issue] = []
    out += key_trust_issues(cfg)
    out += numeric_macro_issues(cfg)
    out += assertion_issues(facts, bu_index(sections))
    out += live_text_issues(cfg, facts, sections)
    # display 也是审批对象的一部分（S-03 的 approve_target 含 display）：
    # 追加一个与 value 不等价的显示形，就是断言漂移。
    for f in facts:
        loc = "%s:%s" % (f.file, f.line or "?")
        for code, detail, extra in display_hits(f):
            if code == "DISPLAY_INCONSISTENT":
                out.append(Issue(
                    "ASSERTION_DRIFT",
                    "fact %r 的批准显示形与 value 不等价：%s（S-03）" % (f.id, detail),
                    location=loc, token=f.id,
                    message_key="finding.ASSERTION_DRIFT.display",
                    params={"fact": repr(f.id), **extra}))
    rpath = cfg.root / "audit" / "report.json"
    report = _load_json(rpath) if rpath.is_file() else None
    out += approval_issues(cfg, facts, report)
    out += approval_report_issues(cfg)
    return out


def _duplicate_value_issues(facts: list[Fact]) -> list[Issue]:
    r"""批 58（§8.1 DUPLICATE_VALUE / R-04）：同值重复入账判黄。

    「同值」按 `canon_text` 归一化后比较（`62.5\%`≡`0.625`≡`10/16`），不是
    字符串比较——否则换个写法就绕过。判定只看 **kind=claim** 的条目：

    - `claim` 相同的同值不算本码（同一句话重复两次由 DUPLICATE_ID 管）；
    - `dup_ok = true` 显式承认「这两个值本来就是一个数」→ 免判（人签豁免）；
    - `supersedes` 指向组内任一条（父值已被替换）→ 整组免判；
    - `derived_from`/`expr` 的派生值不算独立授权票（父值与换算值本来就同值）。

    误报边界：派生值、supersedes、dup_ok 是三条窄豁免，其余一律报黄——
    因为「第二张授权票」正是用第二个 id 把同一个数再登记一次。
    """
    superseded = {s.strip().casefold() for f in facts for s in f.supersedes}
    groups: dict[str, list[Fact]] = {}
    for f in facts:
        if f.kind != "claim" or not f.value.strip():
            continue
        if f.dup_ok or f.is_derived or f.id_key in superseded:
            continue
        key = canon_text(f.value) or f.value.strip()
        groups.setdefault(key, []).append(f)

    out: list[Issue] = []
    for key, group in groups.items():
        if len(group) < 2:
            continue
        ids = {f.id_key for f in group}
        if any(s.strip().casefold() in ids for f in group for s in f.supersedes):
            continue           # 组内互相 supersedes：旧值已被替换，不算重复
        if len({f.claim.strip() for f in group}) < 2:
            continue           # 同一句话的同值：不是「第二张授权票」
        out.append(Issue(
            "DUPLICATE_VALUE",
            "同一个值（归一后 %s）挂在 %s 上，claim 却各不相同——像在拿第二张"
            "授权票把同一个数重复登记；确属同值的请显式写 dup_ok = true（R-04）"
            % (key, "、".join(f.id for f in group)),
            location="%s:%s" % (group[0].file, group[0].line or "?"),
            token=",".join(f.id for f in group), severity=SEV_YELLOW, message_key="finding.DUPLICATE_VALUE.v2", params={"key": str(key), "arg1": str('、'.join((f.id for f in group)))}))
    return out


def _fact_form_keys(value: str) -> list[str]:
    """把 value/display 这种字面写法展开成 PDF 侧会抽到的 key（去重）。"""
    keys: list[str] = []
    for raw, suffix, pct in literal_tokens(value):
        keys.append(number_key(raw, suffix or None, pct))
        if pct:
            keys.append(number_key(raw, suffix or None, False))
    return sorted(set(keys))


def _v3_whitelist(bib_entries, used_keys: dict) -> list[dict]:
    """P-05 W2：被引用文献的字段数字是白名单（每 entry 同一值最多 3 次）。

    W1（页码）/W3（引用标签）/W4（结构号）由 pdfgate 的上下文掩码处理，
    不在这里重复计数——避免同一数字被「掩掉 + 白名单」双重放行。
    """
    declared: dict[str, dict] = {}
    for e in bib_entries:
        if used_keys and e.key not in used_keys:
            continue
        for field in ("year", "volume", "number", "pages", "doi", "eprint"):
            text = str(e.fields.get(field) or "")
            for raw, suffix, pct in literal_tokens(text):
                key = number_key(raw, suffix or None, pct)
                entry = declared.setdefault(key, {"key": key, "count": 0,
                                                  "source": "%s#%s.%s"
                                                            % (e.file, e.key, field)})
                if entry["count"] < 3:
                    entry["count"] += 1
    return list(declared.values())


def _drift_issues(cfg: Config, fact_id: str, unit: dict, rel: str) -> list[Issue]:
    """V3：正文断言的数字与账上的值不符 ＝ 断言漂移（S-03）。

    v1 里同一件事叫 BOUND_MISMATCH；V3 的审批对象是「断言」，值与句子
    一起被签，所以同一处同时记一条 ASSERTION_DRIFT，供盲测/审计分诊。
    """
    if not cfg.is_v3:
        return []
    return [Issue(
        "ASSERTION_DRIFT",
        "fact %r 在正文断言的数字 %s 不在被签的 value/display 里——"
        "句子与账的断言漂移（S-03）" % (fact_id, unit["token"]),
        location="%s:%s:%s" % (rel, unit["line"], unit["col"]),
        token=unit["token"], context=unit["text"], message_key="finding.ASSERTION_DRIFT.v3", params={"fact": repr(fact_id), "unit": str(unit['token'])})]


def source_base(cfg: Config) -> Path:
    """source 的解析根（v1.1）。

    - 配了 project.source_root：source 相对它解析（论文项目指到工作区根，
      原始产物留在 experiments/ 原地，不必为过闸复制）；
    - 没配：兼容 v1，source 只许在项目内 results/ 下。
    """
    raw = (cfg.source_root or "").strip()
    if not raw:
        return cfg.root
    p = Path(raw).expanduser()
    return p if p.is_absolute() else (cfg.root / p)


def source_path(cfg: Config, src: str) -> Path:
    return source_base(cfg) / src


def _source_text_keys(text: str) -> set[str]:
    keys = set()
    for raw, suffix, pct in literal_tokens(text):
        keys.add(number_key(raw, suffix or None, pct))
    return keys


def _source_line(text: str, line: int) -> str:
    lines = text.split("\n")
    return lines[line - 1] if 1 <= line <= len(lines) else ""


_FRAC_RE = re.compile(r"\\[dt]?frac\s*\{\s*([^{}]+?)\s*\}\s*\{\s*([^{}]+?)\s*\}")
_COMPUTED_RE = re.compile(r"\\(?:numexpr|dimexpr|inteval)\b")
_CROSSREF_BEFORE_RE = re.compile(
    r"(?i)(?:^|[^A-Za-z])(Table|Figure|Fig\.?|Section|Sec\.?|Equation|Eq\.?|"
    r"Algorithm|Appendix|Theorem|Lemma|Corollary|Listing)\s*[~ ]?\s*\(?\s*$")


def _computed_construct(text: str, tok: dict, cfg: Config) -> str:
    """若 token 由 `\\frac`/`\\numexpr` 这类现场计算产生且未登记，返回专属码。"""
    line = _source_line(text, int(tok.get("line") or 0))
    pos = max(int(tok.get("col") or 1) - 1, 0)
    allowed = {str(x).strip() for x in cfg.frac_allow}
    for m in _FRAC_RE.finditer(line):
        if not (m.start() <= pos <= m.end()):
            continue
        form = "frac:%s/%s" % (m.group(1).strip(), m.group(2).strip())
        if form in allowed:
            return ""
        return "COMPUTED_VALUE_UNREGISTERED"
    numexpr = _COMPUTED_RE.search(line)
    if numexpr is not None and numexpr.start() <= pos:
        return "COMPUTED_VALUE_UNREGISTERED"
    return ""


def _crossref_construct(text: str, tok: dict) -> str:
    """手写的结构编号（`Table 3`、`Figure 2`）不是数据，给专属码。"""
    line = _source_line(text, int(tok.get("line") or 0))
    prefix = line[:max(int(tok.get("col") or 1) - 1, 0)]
    if _CROSSREF_BEFORE_RE.search(prefix):
        return "NUMBER_AS_CROSSREF"
    return ""


def _rel_to_root(cfg: Config, path: Path) -> str:
    try:
        return path.relative_to(cfg.root).as_posix()
    except ValueError:
        return str(path)


def _evidence_chain_issues(cfg: Config, facts: list[Fact]) -> list[Issue]:
    """§11.6 证据链：fact.source → runs/ 记录 → 回执 record.json。

    断链按最具体的既有码报（MISSING_SOURCE / SOURCE_SHA256_MISMATCH）；
    没有更具体码的节点断口统一报 EVIDENCE_CHAIN_BROKEN。
    """
    out: list[Issue] = []
    known = {f.id_key for f in facts}
    for f in facts:
        loc = "%s:%s" % (f.file, f.line or "?")
        src = f.source.strip()
        if not src:
            out.append(Issue(
                "EVIDENCE_CHAIN_BROKEN",
                "fact %r 没有 source/observation——证据链第 1 节（事实→运行记录）断开"
                % f.id, location=loc, token=f.id, message_key="finding.EVIDENCE_CHAIN_BROKEN.v2", params={"fact": repr(f.id)}))
            continue
        full = source_path(cfg, src)
        if not full.is_file():
            # 文件存在性已有 MISSING_SOURCE（唯一映射：更具体的码优先）。
            continue
        try:
            digest = sha256_file(full)
        except OSError:
            continue
        if not f.source_sha256:
            out.append(Issue(
                "EVIDENCE_CHAIN_BROKEN",
                "fact %r 缺 source_sha256——证据链第 2 节（运行记录→内容锚）断开"
                % f.id, location=loc, token=f.id, message_key="finding.EVIDENCE_CHAIN_BROKEN.v3", params={"fact": repr(f.id)}))
            continue
        if f.source_sha256.removeprefix("sha256:").strip() != digest:
            # 哈希不符已有 SOURCE_SHA256_MISMATCH（唯一映射）。
            continue
        rec_path = full.parent / "record.json"
        if not rec_path.is_file():
            out.append(Issue(
                "EVIDENCE_CHAIN_BROKEN",
                "fact %r 缺回执 %s——证据链第 3 节（运行记录→回执）断开"
                % (f.id, _rel_to_root(cfg, rec_path)),
                location=loc, token=f.id, message_key="finding.EVIDENCE_CHAIN_BROKEN.v4", params={"fact": repr(f.id), "rel_to_root": str(_rel_to_root(cfg, rec_path))}))
            continue
        try:
            rec = json.loads(rec_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            out.append(Issue(
                "EVIDENCE_CHAIN_BROKEN",
                "fact %r 的回执 %s 不可读或不是 JSON"
                % (f.id, _rel_to_root(cfg, rec_path)),
                location=loc, token=f.id, message_key="finding.EVIDENCE_CHAIN_BROKEN.v5", params={"fact": repr(f.id), "rel_to_root": str(_rel_to_root(cfg, rec_path))}))
            continue
        if not isinstance(rec, dict):
            out.append(Issue(
                "EVIDENCE_CHAIN_BROKEN",
                "fact %r 的回执不是对象" % f.id, location=loc, token=f.id, message_key="finding.EVIDENCE_CHAIN_BROKEN.v6", params={"fact": repr(f.id)}))
            continue
        run_id = f.run_id.strip() or full.parent.name
        if str(rec.get("run_id") or "").strip() != run_id:
            out.append(Issue(
                "EVIDENCE_CHAIN_BROKEN",
                "fact %r 的回执 run_id=%r 与运行目录 %r 不符"
                % (f.id, rec.get("run_id"), run_id),
                location=loc, token=f.id, message_key="finding.EVIDENCE_CHAIN_BROKEN.v7", params={"fact": repr(f.id), "rec": repr(rec.get('run_id')), "run_id": repr(run_id)}))
            continue
        ids = rec.get("facts")
        if not isinstance(ids, list):
            out.append(Issue(
                "EVIDENCE_CHAIN_BROKEN",
                "fact %r 的回执缺 facts[]——无法证明回执指向哪条事实"
                % f.id, location=loc, token=f.id, message_key="finding.EVIDENCE_CHAIN_BROKEN.v8", params={"fact": repr(f.id)}))
            continue
        id_set = {str(x).strip().casefold() for x in ids}
        if f.id_key not in id_set:
            out.append(Issue(
                "EVIDENCE_CHAIN_BROKEN",
                "fact %r 不在回执 facts[] 里（回执没有指向这条事实）"
                % f.id, location=loc, token=f.id, message_key="finding.EVIDENCE_CHAIN_BROKEN.v9", params={"fact": repr(f.id)}))
            continue
        rec_src = str(rec.get("source") or "").strip()
        if rec_src and rec_src != src:
            out.append(Issue(
                "EVIDENCE_CHAIN_BROKEN",
                "fact %r 的回执 source=%r 与 fact.source=%r 不符"
                % (f.id, rec_src, src), location=loc, token=f.id, message_key="finding.EVIDENCE_CHAIN_BROKEN.v10", params={"fact": repr(f.id), "rec_src": repr(rec_src), "src": repr(src)}))
            continue
        rec_sha = str(rec.get("source_sha256") or "").strip().lower()
        if rec_sha.startswith("sha256:"):
            rec_sha = rec_sha[7:].strip()
        if rec_sha and rec_sha != digest:
            out.append(Issue(
                "EVIDENCE_CHAIN_BROKEN",
                "fact %r 的回执 source_sha256 与磁盘现算不符" % f.id,
                location=loc, token=f.id, message_key="finding.EVIDENCE_CHAIN_BROKEN.v11", params={"fact": repr(f.id)}))
            continue

    # 反向指针：回执里列出的 fact id 必须在账上存在。
    receipt_paths = sorted((cfg.root / cfg.source_dir).glob("*/record.json"))
    flat = cfg.root / cfg.source_dir / "record.json"
    if flat.is_file():
        receipt_paths.append(flat)
    for rec_path in receipt_paths:
        try:
            rec = json.loads(rec_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        if not isinstance(rec, dict) or not isinstance(rec.get("facts"), list):
            continue
        for raw_id in rec["facts"]:
            fid = str(raw_id).strip().casefold()
            if fid and fid not in known:
                out.append(Issue(
                    "EVIDENCE_CHAIN_BROKEN",
                    "回执 %s 指向账上不存在的 fact id %r"
                    % (_rel_to_root(cfg, rec_path), raw_id),
                    location=_rel_to_root(cfg, rec_path), message_key="finding.EVIDENCE_CHAIN_BROKEN.v12", params={"rel_to_root": str(_rel_to_root(cfg, rec_path)), "raw_id": repr(raw_id)}))
    return out


def verify_sources(cfg: Config, facts: list[Fact]) -> tuple[list[Issue], list[Issue]]:
    red: list[Issue] = []
    yellow: list[Issue] = []
    root = cfg.root
    # v1 的原始产物在 results/；V3 证据模型在 runs/（SPEC-V3.0 证据根）。
    results_dir = (root / cfg.source_dir)
    base = source_base(cfg)
    texts: dict[str, str] = {}
    actual: dict[str, str] = {}

    for f in facts:
        loc = "%s:%s" % (f.file, f.line or "?")
        src = f.source.strip()
        if not src:
            if cfg.is_v3:
                # SPEC §11.6：V3 的证据链由 `_evidence_chain_issues` 统一判。
                # 只有 observation／source_sha256 但没有可定位的运行记录，
                # 同样算第 1 节断开；这里不重复出码。
                continue
            red.append(Issue("MISSING_SOURCE_FIELD", "fact %r 缺 source 字段" % f.id,
                             location=loc, token=f.id, params={"fact": repr(f.id)}))
            continue
        bad = _source_rel_ok(src)
        if bad:
            red.append(Issue(bad, "fact %r 的 source 必须是相对路径（不许 URL/绝对路径/%s）：%s"
                             % (f.id, ".. 越界" if ".." in Path(src).parts else "绝对路径", src),
                             location=loc, token=f.id,
                             message_key=finding_key(bad),
                             params={"fact": repr(f.id), "src": src}))
            continue
        full = base / src
        try:
            full.resolve().relative_to(base.resolve())
        except ValueError:
            red.append(Issue(
                "SOURCE_OUTSIDE_SOURCE_ROOT",
                "fact %r 的 source 越出 source_root（%s）：%s" % (f.id, base, src),
                location=loc, token=f.id, params={"fact": repr(f.id), "base": str(base), "src": str(src)}))
            continue
        if not cfg.source_root.strip():
            # 未配 source_root：沿用口径，source 必须在项目 results/（v1）
            # 或 runs/（V3）下
            try:
                full.resolve().relative_to(results_dir.resolve())
            except ValueError:
                red.append(Issue(
                    "SOURCE_OUTSIDE_RESULTS" if not cfg.is_v3 else "SOURCE_OUTSIDE_RUNS",
                    "fact %r 的 source 不在 %s/ 下（%s）——原始产物必须由人签清单/"
                    "审批目标锁死；跨目录请配 source_root"
                    % (f.id, cfg.source_dir, src),
                    location=loc, token=f.id,
                    message_key=finding_key(
                        "SOURCE_OUTSIDE_RESULTS" if not cfg.is_v3 else "SOURCE_OUTSIDE_RUNS"),
                    params={"fact": repr(f.id), "dir": cfg.source_dir, "src": src}))
                continue
        if not full.is_file():
            red.append(Issue("MISSING_SOURCE", "fact %r 的 source 不存在或不是普通文件：%s"
                             % (f.id, src), location=loc, token=f.id, params={"fact": repr(f.id), "src": str(src)}))
            continue
        try:
            digest = sha256_file(full)
            texts[src] = full.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            red.append(Issue("UNREADABLE_SOURCE", "fact %r 的 source 读不了：%s（%s）"
                             % (f.id, src, exc), location=loc, token=f.id, params={"fact": repr(f.id), "src": str(src), "detail": str(exc)}))
            continue
        actual[src] = digest
        if not f.source_sha256:
            # V3 的内容锚在审批目标的 source_sha256 上（S-03）；v1 仍然要求
            # fact 本件钉住 sha256。
            if not cfg.is_v3:
                red.append(Issue(
                    "MISSING_SOURCE_SHA256",
                    "fact %r 缺 source_sha256——没有内容锚定，账就无法证明「从签过那刻起没被改」"
                    % f.id, location=loc, token=f.id, params={"fact": repr(f.id)}))
        elif f.source_sha256.removeprefix("sha256:").strip() != digest:
            red.append(Issue(
                "SOURCE_SHA256_MISMATCH",
                "fact %r 的 source_sha256 与现算不符（声明 %s…，实际 %s…）——产物被改过"
                % (f.id, f.source_sha256[:12], digest[:12]), location=loc, token=f.id, params={"fact": repr(f.id), "fact1": str(f.source_sha256[:12]), "digest": str(digest[:12])}))
            if cfg.is_v3:
                # S-03：source_sha256 是 approve_target 的字段。它比现算值旧，
                # 就等于「被签的审批对象已经不是磁盘上这一份」。
                red.append(Issue(
                    "APPROVAL_STALE",
                    "fact %r 的 source_sha256 与磁盘现算值不符——审批对象（S-03 的 "
                    "approve_target）已过期，必须重签" % f.id,
                    location=loc, token=f.id, message_key="finding.APPROVAL_STALE.v2", params={"fact": repr(f.id)}))

        # value 回查：非派生 claim 的数字必须字面出现在 source 里（B6 的内容锚）。
        # 报告背书的 fact 例外：它的值由探针重算并进了签收摘要，字面回查对
        # JSONL 计数/CSV 取格没有意义。
        if (not f.is_derived and f.kind == "claim" and src in texts
                and not str(getattr(f, "report", "")).strip()):
            src_keys = _source_text_keys(texts[src])
            missing = []
            for raw, suffix, pct in literal_tokens(f.value):
                keys = [number_key(raw, suffix or None, pct)]
                # V3 的 runs/ 摘要常把百分比存成整数（40 / 0.4 都是 40%），
                # 源层回查接受这两种写法；值域判定仍用严格 canon。
                if cfg.is_v3 and pct:
                    keys.append(number_key(raw, suffix or None, False))
                if not any(k in src_keys for k in keys):
                    missing.append(raw + suffix + ("%" if pct else ""))
            if missing:
                yellow.append(Issue(
                    "VALUE_NOT_IN_SOURCE",
                    "fact %r 的 value 数字 %s 没有出现在 source 里（内容回查失败）"
                    % (f.id, "、".join(missing)), location=loc, token=f.id,
                    severity=SEV_YELLOW, params={"fact": repr(f.id), "arg1": str('、'.join(missing))}))

    if cfg.is_v3:
        # V3 没有 results/MANIFEST.toml：证据是项目外审批目标 + runs/ 产物，
        # 由 v3.approval_issues / key_trust_issues 单独判。
        red += _evidence_chain_issues(cfg, facts)
        return red, yellow

    # ---- 人签清单 ----
    mpath = cfg.root / cfg.manifest
    if not mpath.is_file():
        yellow.append(Issue(
            "NO_MANIFEST",
            "缺人签清单 %s：工具只能证明「账与正文自洽」，不能证明 results/ 当初没被编"
            % cfg.manifest, location=cfg.manifest, severity=SEV_YELLOW, params={"cfg": str(cfg.manifest)}))
        return red, yellow
    try:
        data = load_toml(mpath)
    except ConfigError as exc:
        red.append(Issue("MANIFEST_INVALID", str(exc), location=cfg.manifest,
                         message_key=finding_key("MANIFEST_INVALID")))
        return red, yellow
    meta = data.get("manifest")
    if not isinstance(meta, dict) or not str(meta.get("signed_by") or "").strip():
        red.append(Issue(
            "MANIFEST_UNSIGNED",
            "清单 %s 没有 signed_by——没人签的清单不算锚" % cfg.manifest,
            location=cfg.manifest, params={"cfg": str(cfg.manifest)}))
    if isinstance(meta, dict) and not str(meta.get("signed_at") or "").strip():
        yellow.append(Issue(
            "MANIFEST_NO_TIMESTAMP", "清单 %s 缺 signed_at（签的时间点）" % cfg.manifest,
            location=cfg.manifest, severity=SEV_YELLOW, params={"cfg": str(cfg.manifest)}))
    files = data.get("files")
    if not isinstance(files, dict):
        files = {}
        yellow.append(Issue("MANIFEST_NO_FILES", "清单 %s 没有 [files] 段" % cfg.manifest,
                            location=cfg.manifest, severity=SEV_YELLOW, params={"cfg": str(cfg.manifest)}))
    signed = {str(k): str(v).strip().lower() for k, v in files.items()}

    for f in facts:
        src = f.source.strip()
        if src not in actual:
            continue
        if src not in signed:
            red.append(Issue(
                "SOURCE_NOT_SIGNED",
                "fact %r 的 source %s 不在人签清单里——没人确认过它" % (f.id, src),
                location="%s:%s" % (f.file, f.line or "?"), token=f.id, params={"fact": repr(f.id), "src": str(src)}))
        elif signed[src] != actual[src]:
            red.append(Issue(
                "MANIFEST_HASH_MISMATCH",
                "清单里 %s 的 sha256 与文件现值不符——签过之后被改过" % src,
                location=cfg.manifest, token=f.id, params={"src": str(src)}))

    if results_dir.is_dir():
        for p in sorted(results_dir.rglob("*")):
            if not p.is_file() or p.resolve() == mpath.resolve():
                continue
            rel = p.relative_to(root).as_posix()
            if rel not in signed:
                yellow.append(Issue(
                    "UNSIGNED_RESULT",
                    "results/ 下有未签文件 %s——它没有被任何清单锁住" % rel,
                    location=rel, severity=SEV_YELLOW, params={"rel": str(rel)}))
    return red, yellow

# --------------------------------------------------------------------------
# check
# --------------------------------------------------------------------------

def _find_report_base(cfg: Config, rel: str):
    """找报告：报告路径是相对工作区的，审计跑在论文项目根上。

    依次试论文项目根与其上若干层（工作区通常是论文项目的父目录）。
    找不到返回 (None, None)。只读，不写盘。
    """
    text = str(rel or "").strip().replace("\\", "/")
    if not text:
        return None, None
    p = Path(text)
    if p.is_absolute() or ".." in p.parts:
        return None, None
    bases = [cfg.root] + list(cfg.root.parents)[:4]
    for base in bases:
        if (base / p).is_file():
            return base, p.as_posix()
    return None, None


def _report_issues(cfg: Config, facts: list[Fact]) -> list[Issue]:
    """P0：带 report 的 fact 必须跟报告对账（报告在、指标在、签过、值一致）。

    只对带 report 字段的 fact 生效：旧账零行为变化。
    """
    out: list[Issue] = []
    if not any((f.report or "").strip() for f in facts):
        return out
    # report.py 顶层 import 本模块；这里必须函数内局部 import，否则循环依赖。
    from .report import ReportError, load_report, verify_signoff

    # 同一份报告可能背书很多条事实：读一次、核一次，别让审计变成 O(事实×原始文件)
    cache: dict = {}
    for f in facts:
        rel = str(f.report or "").strip()
        if not rel:
            continue
        loc = "%s:%s" % (f.file, f.line or "?")
        base, rel_path = _find_report_base(cfg, rel)
        if base is None:
            out.append(Issue(
                "REPORT_MISSING",
                "fact %r 指向的报告 %s 找不到（相对工作区的路径）" % (f.id, rel),
                location=loc, token=f.id, params={"fact": repr(f.id), "rel": str(rel)}))
            continue
        key = (str(base), rel_path)
        if key not in cache:
            try:
                cache[key] = (load_report(base, rel_path),
                              verify_signoff(base, rel_path))
            except ReportError as exc:
                cache[key] = (exc, None)
        loaded, verified = cache[key]
        if isinstance(loaded, ReportError):
            out.append(Issue(
                "REPORT_METRIC_MISSING",
                "fact %r 指向的报告 %s 读不了：%s" % (f.id, rel, loaded),
                location=loc, token=f.id, message_key="finding.REPORT_METRIC_MISSING.v2", params={"fact": repr(f.id), "rel": str(rel), "loaded": str(loaded)}))
            continue
        report = loaded
        mid = str(f.report_metric or "").strip()
        metric = next((m for m in report.get("metrics", [])
                       if m.get("id", "") == mid), None)
        if metric is None:
            out.append(Issue(
                "REPORT_METRIC_MISSING",
                "fact %r 指向的指标 %r 不在报告 %s 里" % (f.id, mid, rel),
                location=loc, token=f.id, message_key="finding.REPORT_METRIC_MISSING.v3", params={"fact": repr(f.id), "mid": repr(mid), "rel": str(rel)}))
            continue
        if not verified.get("ok"):
            out.append(Issue(
                "REPORT_NOT_SIGNED",
                "fact %r 指向的报告 %s 没签收或签收已失效：%s"
                % (f.id, rel, verified.get("reason", "")),
                location=loc, token=f.id, params={"fact": repr(f.id), "rel": str(rel), "verified": str(verified.get('reason', ''))}))
        # 来源归属：账里那条 fact 必须指向该指标声明的某个来源文件。
        # 只比路径、不比哈希——哈希不符已有 SOURCE_SHA256_MISMATCH，别为同一个
        # 现象出两个码。路径比较用 realpath，兼容 source_root 的不同写法。
        allowed = cache.get(("paths", key, mid))
        if allowed is None:
            allowed = {os.path.realpath(str(base / str(source.get("path", ""))))
                       for source in (metric.get("sources") or [])}
            cache[("paths", key, mid)] = allowed
        try:
            fact_path = os.path.realpath(str(source_path(cfg, f.source)))
        except (OSError, ValueError):
            fact_path = ""
        if allowed and fact_path not in allowed:
            out.append(Issue(
                "REPORT_SOURCE_MISMATCH",
                "fact %r 的来源 %s 不是报告指标 %s 的任何来源"
                % (f.id, f.source, mid),
                location=loc, token=f.id, params={"fact": repr(f.id), "fact1": str(f.source), "mid": str(mid)}))
        if str(f.value).strip() != str(metric.get("display", "")).strip():
            out.append(Issue(
                "REPORT_METRIC_MISMATCH",
                "fact %r 的值 %r 与报告指标 %s 的显示值 %r 对不上"
                % (f.id, f.value, mid, metric.get("display", "")),
                location=loc, token=f.id, params={"fact": repr(f.id), "value": repr(f.value), "mid": str(mid), "metric": repr(metric.get('display', ''))}))
    return out


def run_check(cfg: Config, facts: list[Fact]):
    issues: list[Issue] = []
    warnings: list[Issue] = []
    conflicts: list[dict] = []

    if not facts:
        raise ConfigError("facts 为空（%s 没匹配到任何 fact）——空账不算通过" % cfg.facts_glob)

    red_src, yellow_src = verify_sources(cfg, facts)
    issues += red_src
    warnings += yellow_src
    issues += _display_issues(facts)
    # P0：报告来源的 fact 要跟报告对账（只有带 report 字段的 fact 受影响）。
    issues += _report_issues(cfg, facts)

    seen: dict[str, Fact] = {}
    superseded = {s.strip().casefold() for f in facts for s in f.supersedes}
    for f in facts:
        loc = "%s:%s" % (f.file, f.line or "?")
        key = f.id_key
        if key in seen:
            issues.append(Issue(
                "DUPLICATE_ID", "fact id %r 重复（%s 与 %s；id 按大小写不敏感判重）"
                % (f.id, seen[key].file, f.file), location=loc, token=f.id, message_key="finding.DUPLICATE_ID.v2", params={"fact": repr(f.id), "seen": str(seen[key].file), "fact1": str(f.file)}))
        else:
            seen[key] = f
        if cfg.is_v3:
            id_ok = re.fullmatch(r"[A-Za-z0-9._-]+", f.id)
            id_hint = "只允许字母/数字/下划线/点/连字符（SPEC-V3.0 §11.1）"
        else:
            id_ok = re.fullmatch(r"[A-Za-z][A-Za-z0-9_.:-]*", f.id) and not re.search(r"\s", f.id)
            id_hint = "只允许字母开头，后接字母/数字/_ . : -（不许空白）"
        if not id_ok:
            issues.append(Issue(
                "BAD_ID_FORMAT",
                "fact id %r 不合法：%s" % (f.id, id_hint),
                location=loc, token=f.id, message_key="finding.BAD_ID_FORMAT.v2", params={"fact": repr(f.id), "id_hint": str(id_hint)}))
        if f.confidence not in CONFIDENCE_OK:
            issues.append(Issue(
                "BAD_CONFIDENCE", "fact %r 的 confidence=%r 不合法（只允许 high/med/low）"
                % (f.id, f.confidence), location=loc, token=f.id, params={"fact": repr(f.id), "fact1": repr(f.confidence)}))
        if f.kind not in KINDS_OK:
            issues.append(Issue(
                "BAD_KIND", "fact %r 的 kind=%r 不合法（只允许 claim/config）"
                % (f.id, f.kind), location=loc, token=f.id, params={"fact": repr(f.id), "fact1": repr(f.kind)}))
        if not f.value:
            issues.append(Issue("EMPTY_VALUE", "fact %r 的 value 为空（账上没有数）" % f.id,
                                location=loc, token=f.id, params={"fact": repr(f.id)}))

    known = {f.id_key: f for f in facts}
    for f in facts:
        loc = "%s:%s" % (f.file, f.line or "?")
        for dep in f.derived_from:
            if dep.strip().casefold() not in known:
                issues.append(Issue(
                    "BAD_DERIVED_FROM", "fact %r 的 derived_from 指向不存在的 id %r" % (f.id, dep),
                    location=loc, token=dep, params={"fact": repr(f.id), "dep": repr(dep)}))
        for sup in f.supersedes:
            if sup.strip().casefold() not in known:
                issues.append(Issue(
                    "BAD_SUPERSEDES", "fact %r 的 supersedes 指向不存在的 id %r" % (f.id, sup),
                    location=loc, token=sup, params={"fact": repr(f.id), "sup": repr(sup)}))
        for dep in f.derived_from:
            if dep.strip().casefold() in superseded:
                issues.append(Issue(
                    "SUPERSEDED_PARENT",
                    "fact %r 从已被 supersedes 的 %r 推算——父值已作废" % (f.id, dep),
                    location=loc, token=dep, params={"fact": repr(f.id), "dep": repr(dep)}))

        # derived 值必须写可求值算式
        if f.derived_from and not f.expr:
            issues.append(Issue(
                "MISSING_EXPR",
                "fact %r 是推算值，但没写 expr——只写 derived_from 不算可复核" % f.id,
                location=loc, token=f.id, params={"fact": repr(f.id)}))
        if f.expr:
            issues += _expr_issues(f, known)
        elif not f.derived_from and f.is_derived:
            # is_derived 只看 expr/derived_from，这里不会发生；保底留白
            pass

    for cyc in _cycles(facts):
        issues.append(Issue(
            "DERIVED_CYCLE", "推算链成环：%s" % " -> ".join(cyc),
            location="facts/", token=",".join(cyc), params={"arg0": str(' -> '.join(cyc))}))

    # 冲突：结构化 (metric, scope) 优先，否则 claim 全文；用 supersedes 封冲突
    groups: dict[tuple, list[Fact]] = {}
    for f in facts:
        if f.metric.strip():
            key = ("metric", f.metric.strip(), f.scope.strip())
        else:
            key = ("claim", f.claim.strip(), "")
        groups.setdefault(key, []).append(f)
    for _key, group in groups.items():
        label = group[0].metric.strip() or group[0].claim.strip()
        if not label or len(group) < 2:
            continue
        if len({f.value.strip() for f in group}) < 2:
            continue
        live = [f for f in group if f.id_key not in superseded]
        if len({f.value.strip() for f in live}) < 2:
            continue
        conflicts.append({
            "claim": label,
            "ids": [f.id for f in live],
            "values": [f.value for f in live],
            "message": "同一 claim/metric 有不同 value 且没有被 supersedes：%s"
                       % " / ".join("%s=%s" % (f.id, f.value) for f in live),
        })
        warnings.append(Issue(
            "LEDGER_CONFLICT",
            "账本自相矛盾（黄）：" + conflicts[-1]["message"],
            location="%s:%s" % (live[0].file, live[0].line or "?"),
            token=",".join(f.id for f in live), severity=SEV_YELLOW,
            message_key=finding_key("LEDGER_CONFLICT"),
            params={"detail": " / ".join("%s=%s" % (f.id, f.value)
                                         for f in live)}))

    # 账本卫生：同一 value 挂在多条不同 claim 上 -> 疑似「数字白名单」（红队 C6）
    by_value: dict[str, list[Fact]] = {}
    for f in facts:
        if (f.kind == "claim" and f.value.strip() and f.id_key not in superseded
                and not f.dup_ok):
            by_value.setdefault(f.value.strip(), []).append(f)
    for value, group in by_value.items():
        if len(group) > 1 and len({f.claim.strip() for f in group}) > 1:
            warnings.append(Issue(
                "DUPLICATE_VALUE",
                "同一个 value=%r 挂在 %s 上——像在拿一份数字白名单充事实账"
                % (value, "、".join(f.id for f in group)),
                location="%s:%s" % (group[0].file, group[0].line or "?"),
                token=",".join(f.id for f in group), severity=SEV_YELLOW, message_key="finding.DUPLICATE_VALUE.v3", params={"value": repr(value), "arg1": str('、'.join((f.id for f in group)))}))

    summary = {
        "facts": len(facts),
        "ids": len(known),
        "sources_ok": sum(1 for f in facts if f.source and source_path(cfg, f.source).is_file()),
        "sha_pinned": sum(1 for f in facts if f.source_sha256),
        "conflicts": len(conflicts),
        "red": len(issues),
        "yellow": len(warnings),
        "confidence": {
            "high": sum(1 for f in facts if f.confidence == "high"),
            "med": sum(1 for f in facts if f.confidence == "med"),
            "low": sum(1 for f in facts if f.confidence == "low"),
        },
        "derived": sum(1 for f in facts if f.derived_from),
        "attestation": {"facts_sha256": facts_digest(cfg),
                        "git_commit": git_commit(cfg.root)},
    }
    return issues, warnings, conflicts, summary

def _resolve_arxiv(arxiv_id: str) -> tuple[str, str]:
    """返回 (status, detail)：verified / not_found / unverified。"""
    url = "https://export.arxiv.org/api/query?" + urllib.parse.urlencode(
        {"id_list": arxiv_id, "max_results": "1"})
    req = urllib.request.Request(url, headers={"User-Agent": "factscribe/%s" % VERSION})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            body = resp.read().decode("utf-8", "replace")
            status = getattr(resp, "status", 200)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return "not_found", "arXiv API 返回 HTTP 404"
        return "unverified", "联网核验失败（%s）" % exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return "unverified", "联网核验失败（%s）" % exc
    if status != 200:
        return "unverified", "arXiv API 返回 HTTP %s" % status
    if re.search(r"<entry\b", body):
        return "verified", "arXiv API 命中"
    if "<opensearch:totalResults>0<" in body or "totalResults>0<" in body:
        return "not_found", "arXiv API 明确返回 0 条"
    return "unverified", "arXiv API 响应无法判定"


def _resolve_doi(doi: str) -> tuple[str, str]:
    url = "https://doi.org/api/handles/" + urllib.parse.quote(doi, safe="/")
    req = urllib.request.Request(url, headers={"User-Agent": "factscribe/%s" % VERSION})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            body = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return "not_found", "doi.org 返回 HTTP 404（该 DOI 不存在）"
        return "unverified", "联网核验失败（%s）" % exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return "unverified", "联网核验失败（%s）" % exc
    if '"responseCode":1' in body.replace(" ", "") or '"responseCode": 1' in body:
        return "verified", "doi.org handle 命中"
    if '"responseCode":100' in body.replace(" ", "") or '"responseCode": 100' in body:
        return "not_found", "doi.org 明确返回不存在"
    return "unverified", "doi.org 响应无法判定"


def _needs_scan(cfg: Config, rel: str) -> bool:
    """闭包外的 `.tex` 是否仍须报 `UNSCANNED_TEX`（批 135）。

    只有导言区命令与 `\\input` 的文件没有可审计内容——它没东西可扫，报
    「未扫描」是噪声。读不了的文件照旧报（fail-closed）。
    """
    try:
        text = _read_text(cfg.root / rel, cfg.root)
    except ConfigError:
        return True
    return has_auditable_content(text)


def run_audit(cfg: Config, facts: list[Fact], sections: list[tuple[str, str]],
              resolve: bool = False):
    if not facts:
        raise ConfigError("facts 为空（%s 没匹配到任何 fact）——空账不算通过" % cfg.facts_glob)
    if not sections:
        raise ConfigError("sections 为空（%s 没匹配到任何 .tex）——没正文不算通过"
                          % cfg.sections_glob)

    red: list[Issue] = []
    yellow: list[Issue] = []
    hints: list[Issue] = []

    red_src, yellow_src = verify_sources(cfg, facts)
    red += red_src
    yellow += yellow_src

    # P0：报告来源的 fact 要跟报告对账（只有带 report 字段的 fact 受影响）。
    red += _report_issues(cfg, facts)

    scanned = {rel: scan_tex(text) for rel, text in sections}

    # ---- bib 文件集合：config + 正文声明的多 bib（红队 C8-B）----
    bib_paths: list[Path] = []
    cfg_bib = cfg.root / cfg.bib
    if not cfg_bib.is_file():
        raise ConfigError("找不到参考文献 %s——引用对账无从做起" % cfg_bib)
    bib_paths.append(cfg_bib)
    for rel, scan in scanned.items():
        for decl in scan.bib_files:
            p = (cfg.root / decl)
            if not p.is_file():
                red.append(Issue(
                    "BIB_FILE_MISSING", "正文声明的参考文献 %s 不存在" % decl,
                    location=rel, token=decl, params={"decl": str(decl)}))
                continue
            if p.resolve() not in {q.resolve() for q in bib_paths}:
                bib_paths.append(p)
    bib_entries: list[BibEntry] = []
    for p in bib_paths:
        try:
            bib_entries += parse_bib(p, cfg.root)
        except ConfigError:
            raise
    bib_by_key: dict[str, BibEntry] = {}
    for e in bib_entries:
        bib_by_key.setdefault(e.key, e)
    dup_keys, dup_ids = bib_duplicates(bib_entries)
    for k in dup_keys:
        e = bib_by_key[k]
        red.append(Issue("DUPLICATE_BIB_KEY", "bib 里 key %r 定义了不止一次" % k,
                         location="%s:%s" % (e.file, e.line), token=k, params={"key": repr(k)}))
    for ident, ks in dup_ids:
        yellow.append(Issue(
            "DUPLICATE_STABLE_ID", "%s 挂在多个 key 上：%s" % (ident, "、".join(ks)),
            location="%s:%s" % (bib_by_key[ks[0]].file, bib_by_key[ks[0]].line),
            token=",".join(ks), severity=SEV_YELLOW, params={"ident": str(ident), "arg1": str('、'.join(ks))}))

    fact_by_id = {f.id_key: f for f in facts}
    # SPEC §11.4：id 必须唯一（大小写不敏感）。审计面也要判，否则字典会把
    # 后一条悄悄覆盖前一条，重复入账就成了「谁最后一次写谁赢」。
    _seen_ids: dict[str, Fact] = {}
    for f in facts:
        loc = "%s:%s" % (f.file, f.line or "?")
        if f.id_key in _seen_ids:
            red.append(Issue(
                "DUPLICATE_ID",
                "fact id %r 重复（%s 与 %s；id 按大小写不敏感判重）"
                % (f.id, _seen_ids[f.id_key].file, f.file),
                location=loc, token=f.id, message_key="finding.DUPLICATE_ID.v3", params={"fact": repr(f.id), "seen_ids": str(_seen_ids[f.id_key].file), "fact1": str(f.file)}))
        else:
            _seen_ids[f.id_key] = f
        if (cfg.is_v3 and not re.fullmatch(r"[A-Za-z0-9._-]+", f.id)):
            red.append(Issue(
                "BAD_ID_FORMAT",
                "fact id %r 不合法：只允许字母/数字/下划线/点/连字符"
                "（SPEC-V3.0 §11.1）" % f.id, location=loc, token=f.id, message_key="finding.BAD_ID_FORMAT.v3", params={"fact": repr(f.id)}))
    # 全局值域只收 claim 事实：config 事实不能当「数字白名单」用（红队 C3/C6）
    key_to_facts: dict[str, list[str]] = {}
    for f in facts:
        if f.kind != "claim":
            continue
        for k in f.value_keys:
            key_to_facts.setdefault(k, []).append(f.id)

    numbers_total = 0
    matched = 0        # 旧口径：回得到账（含未绑定）
    bound = 0          # 内联绑定且对得上
    unbound_yellow = 0
    unmatched = 0
    annotations_total = 0
    annotation_sites: list[str] = []
    usage: dict[str, list[str]] = {f.id: [] for f in facts}
    marker_count: dict[str, int] = {f.id: 0 for f in facts}
    used_keys: dict[str, int] = {}
    unresolved: list[dict] = []
    seen_figures: set[str] = set()
    ledger: list[dict] = []          # P-04 的账（V3 用来对 PDF 多重集）

    def _ledger_add(rel: str, fid: str, unit: dict) -> None:
        keys: list[str] = []
        for tok in unit["tokens"]:
            keys.append(tok["key"])
            if tok["pct"]:
                keys.append(number_key(tok["raw"], tok["suffix"] or None, False))
        ledger.append({"fact_id": fid, "raw": unit["token"],
                       "keys": sorted(set(keys)), "file": rel, "page": 1,
                       "line": unit["line"], "col": unit["col"]})

    red += _display_issues(facts)
    # v1.3 G5：派生 fact 的 expr 与 value 不一致也要在 audit 面判红。此前
    # 只有 `check` 判 EXPR_MISMATCH，发布闸 audit 会放行「算错但自洽」的数。
    for f in facts:
        if f.expr:
            red += _expr_issues(f, fact_by_id)
    red += _source_rule_issues(cfg, sections)
    # R-05：闭包展开时 \input/\include/\subfile 指向不存在的文件——正文
    # 可能整段没进审计，属覆盖缺口（exit 5），不许静默放行。
    for src_rel, ref, line in getattr(cfg, "missing_inputs", []):
        red.append(Issue(
            "INPUT_TARGET_MISSING",
            "\\input 目标 %r 不存在（%s:%s）——闭包展开失败，"
            "这一段可能整体没进审计（R-05）" % (ref, src_rel, line),
            location="%s:%s" % (src_rel, line), token=ref,
            exit_code=EXIT_INTEGRITY, params={"ref": repr(ref), "src_rel": str(src_rel), "line": str(line)}))
    # R-05（v1.3）：目标含宏/#/嵌套花括号或为空——静态审计无法确定它拉进
    # 哪个文件；覆盖不了就判红，不许静默跳过（fail-closed）。
    for src_rel, ref, line in getattr(cfg, "dynamic_inputs", []):
        red.append(Issue(
            "INPUT_DYNAMIC",
            "\\input/\\include 目标 %r 含宏、#、嵌套花括号或为空"
            "（%s:%s）——无法静态解析，审计覆盖不了这一段（R-05）"
            % (ref, src_rel, line),
            location="%s:%s" % (src_rel, line), token=ref,
            exit_code=EXIT_INTEGRITY, params={"ref": repr(ref), "src_rel": str(src_rel), "line": str(line)}))
    if cfg.is_v3:
        red += _v3_source_issues(cfg, facts, sections)
        # 批 58：同值重复入账（§8.1 DUPLICATE_VALUE）也进审计面；v1 保持
        # 旧行为（只在 check 里判），避免改动已冻结的 v1 审计读数。
        yellow += _duplicate_value_issues(facts)

    for rel, text in sections:
        scan = scanned[rel]
        nums = _extract_numbers(scan.masked, text)
        units = _merge_number_units(nums, scan.masked)
        numbers_total += len(nums)
        annotations_total += len(scan.annotations)
        annotation_sites += ["%s:%s \\%s" % (rel, line, name)
                             for name, line in scan.annotations]

        for fid, _line in scan.markers:
            f = fact_by_id.get(fid.strip().casefold())
            if f is None:
                red.append(Issue(
                    "UNKNOWN_FACT_MARKER",
                    "正文标记了不存在的 fact %r（账上没有这个 id）" % fid,
                    location="%s:%s" % (rel, _line), token=fid, params={"fid": repr(fid)}))
            else:
                marker_count[f.id] += 1
                if rel not in usage[f.id]:
                    usage[f.id].append(rel)

        for name, line, col in scan.unknown_cites:
            red.append(Issue(
                "UNKNOWN_CITE_COMMAND",
                "认不出的引用命令 \\%s——引用闸门默认 fail-closed，请改用已知的 cite 家族命令"
                % name, location="%s:%s:%s" % (rel, line, col), token=name, params={"name": str(name)}))

        # ---- R-01A C：数字不得贴宏 / 不得紧跟闭合组 / 不得被空组拼接 ----
        seen_adj: set[tuple[str, int]] = set()
        for num in nums:
            for code, detail, extra in adjacency_hits(scan.adjacency, num):
                mark = (code, num["start_abs"])
                if mark in seen_adj:
                    continue
                seen_adj.add(mark)
                red.append(Issue(
                    code, "%s（%r）——渲染出的数字必须由连续字面数字构成"
                    % (detail, num["token"]),
                    location="%s:%s:%s" % (rel, num["line"], num["col"]),
                    token=num["token"], context=num["text"],
                    message_key=finding_key(code)
                    + (("." + extra["side"]) if extra.get("side") else ""),
                    params={"num": repr(num["token"]), **extra}))

        # ---- R-02/R-03：BU 是句子；标记组只闭合自己那一句，token 按出现顺序归属 ----
        spans = sentence_spans(scan.masked)
        groups = scan.marker_groups
        group_sentence = [sentence_index(spans, max(0, g["end"] - 1))
                          for g in groups]
        covered: dict[int, list[dict]] = {i: [] for i in range(len(groups))}
        ungrouped: list[dict] = []
        for unit in units:
            unit["sentence"] = sentence_index(spans, unit["start_abs"])
            owner = None
            for gi, g in enumerate(groups):
                if group_sentence[gi] != unit["sentence"]:
                    continue
                if g.get("next_only"):
                    continue          # 向后绑定，交给下面的 next_only 分配
                if g["end"] > unit["start_abs"]:
                    owner = gi
                    break
            if owner is None:
                ungrouped.append(unit)
            else:
                covered[owner].append(unit)

        # 单参数标记（`\fact{A1}10/16`）绑定**紧随其后**的数字：v1 的
        # `10/16\fact{A1}` 由上面的「闭合句子」规则处理，这里补上 V3 的
        # 前置标记写法。一个 token 只归一个组。
        assigned = {id(u) for group in covered.values() for u in group}
        for gi, g in enumerate(groups):
            if not g.get("next_only") or covered[gi]:
                continue
            for unit in units:
                if id(unit) in assigned:
                    continue
                if unit["sentence"] != group_sentence[gi]:
                    continue
                if unit["start_abs"] >= g["end"]:
                    covered[gi].append(unit)
                    assigned.add(id(unit))
                    break
        ungrouped = [u for u in units if id(u) not in assigned]

        for gi, g in enumerate(groups):
            utokens = covered[gi]
            if not utokens:
                continue
            known_facts = []
            for fid in g["ids"]:
                f = fact_by_id.get(fid.strip().casefold())
                if f is not None:
                    known_facts.append(f)
            if not known_facts:
                continue       # 未知 id 已由 UNKNOWN_FACT_MARKER 判红
            quant_facts = [f for f in known_facts if f.value_keys]
            if not quant_facts:
                for unit in utokens:
                    unmatched += len(unit["tokens"])
                    red.append(Issue(
                        "NONQUANT_BACKS_QUANT",
                        "只有机制陈述（%s）来背数字 %s——非定量 fact 不能授权定量断言"
                        % ("/".join(f.id for f in known_facts), unit["token"]),
                        location="%s:%s:%s" % (rel, unit["line"], unit["col"]),
                        token=unit["token"], context=unit["text"], params={"arg0": str('/'.join((f.id for f in known_facts))), "unit": str(unit['token'])}))
                continue
            allowed: set[str] = set()
            for f in quant_facts:
                allowed |= f.value_keys
            sequential = (len(utokens) == len(quant_facts)
                          and not any(f.co_claim for f in quant_facts))
            if sequential and len(quant_facts) > 1:
                # ① 归属分支：第 k 个 token 归第 k 个 fact（内部 B3 / 2-S1）
                for unit, f in zip(utokens, quant_facts):
                    if unit["canon"] in f.value_keys:
                        bound += len(unit["tokens"])
                        _ledger_add(rel, f.id, unit)
                    else:
                        unmatched += len(unit["tokens"])
                        red.append(Issue(
                            "BINDING_ATTRIBUTION",
                            "组内第 %d 个数字 %s 归 %s，但不在它的 value 里——"
                            "标记组成员按书写顺序一一对应（想真·同值请写 co_claim）"
                            % (utokens.index(unit) + 1, unit["token"], f.id),
                            location="%s:%s:%s" % (rel, unit["line"], unit["col"]),
                            token=unit["token"], context=unit["text"], params={"utokens": str(int(utokens.index(unit) + 1)), "unit": str(unit['token']), "fact": str(f.id)}))
                        red += _drift_issues(cfg, f.id, unit, rel)
            else:
                # ② 并集分支：token 数≠fact 数时整段取并集（R-03）
                for unit in utokens:
                    if all(k in allowed for k in unit["keys"]):
                        bound += len(unit["tokens"])
                        _ledger_add(rel, quant_facts[0].id, unit)
                    else:
                        unmatched += len(unit["tokens"])
                        red.append(Issue(
                            "BOUND_MISMATCH",
                            "该段绑定 %s，但数字 %s 不在其 value 里（内联绑定是硬约束）"
                            % ("/".join(f.id for f in quant_facts), unit["token"]),
                            location="%s:%s:%s" % (rel, unit["line"], unit["col"]),
                            token=unit["token"], context=unit["text"], message_key="finding.BOUND_MISMATCH.v2", params={"arg0": str('/'.join((f.id for f in quant_facts))), "unit": str(unit['token'])}))
                        red += _drift_issues(cfg, quant_facts[0].id, unit, rel)

        # ---- 未被任何标记组闭合的尾段/远句 ----
        tables = tabular_regions(text)

        def _line_bound_quant(line_no: int) -> list[Fact]:
            """该行（不是该句）绑定了哪些定量 fact——用于分诊 BOUND_MISMATCH。"""
            found: list[Fact] = []
            for fid in scan.bindings.get(line_no, []):
                f = fact_by_id.get(fid.strip().casefold())
                if f is not None and f.value_keys and f not in found:
                    found.append(f)
            return found

        for unit in ungrouped:
            in_table = any(s <= unit["start_abs"] < e for s, e in tables)
            keys_known = all(k in key_to_facts for k in unit["keys"])
            if in_table and not keys_known:
                # R-06：表格 cell 里的数字必须能被账回查，否则整表绕开审计
                unmatched += len(unit["tokens"])
                red.append(Issue(
                    "TABLE_UNBOUND",
                    "表格 cell 里的数字 %s 回不到任何 fact.value——表格必须进扫描闭包"
                    "并带 cell→fact 映射（R-06）" % unit["token"],
                    location="%s:%s:%s" % (rel, unit["line"], unit["col"]),
                    token=unit["token"], context=unit["text"], exit_code=5, params={"unit": str(unit['token'])}))
                continue
            if keys_known and unit["keys"]:
                _ledger_add(rel, key_to_facts[unit["keys"][0]][0], unit)
            for tok in unit["tokens"]:
                loc = "%s:%s:%s" % (rel, tok["line"], tok["col"])
                if tok["key"] in key_to_facts:
                    unbound_yellow += 1
                    yellow.append(Issue(
                        "UNBOUND_NUMBER",
                        "数字 %s 回得到账（%s），但正文没内联绑定——只算黄，不算已核验"
                        % (tok["token"], "/".join(key_to_facts[tok["key"]])),
                        location=loc, token=tok["token"], context=tok["text"],
                        severity=SEV_YELLOW, params={"tok": str(tok['token']), "arg1": str('/'.join(key_to_facts[tok['key']]))}))
                else:
                    unmatched += 1
                    computed = _computed_construct(text, tok, cfg) if cfg.is_v3 else ""
                    crossref = _crossref_construct(text, tok) if cfg.is_v3 else ""
                    if computed:
                        red.append(Issue(
                            computed,
                            "数字 %s 由现场计算（\\frac/\\numexpr 等）生成且未登记——"
                            "计算出的值不可寻址（P-06）" % tok["token"],
                            location=loc, token=tok["token"], context=tok["text"],
                            message_key=finding_key(computed) + ".number",
                            params={"num": tok["token"]}))
                    elif crossref:
                        yellow.append(Issue(
                            crossref,
                            "数字 %s 是手写的结构编号（Table/Figure 等），不是数据，"
                            "也不能替代 \\ref 的稳定标识" % tok["token"],
                            location=loc, token=tok["token"], context=tok["text"],
                            message_key=finding_key(crossref),
                            params={"num": tok["token"]},
                            severity=SEV_YELLOW))
                    else:
                        # v1.3 分诊：该行已经绑定了定量 fact，只是这个数字不在
                        # 它的值域里 → BOUND_MISMATCH；真的没有任何 fact 可
                        # 命中 → UNMATCHED_NUMBER。两者都是红、exit 1。
                        bound_line = _line_bound_quant(tok["line"])
                        if bound_line:
                            red.append(Issue(
                                "BOUND_MISMATCH",
                                "该行绑定 %s，但数字 %s 不在其 value 里"
                                "（内联绑定是硬约束）"
                                % ("/".join(f.id for f in bound_line),
                                   tok["token"]),
                                location=loc, token=tok["token"],
                                context=tok["text"], message_key="finding.BOUND_MISMATCH.v3", params={"arg0": str('/'.join((f.id for f in bound_line))), "tok": str(tok['token'])}))
                            red += _drift_issues(cfg, bound_line[0].id,
                                                 tok, rel)
                        else:
                            red.append(Issue(
                                "UNMATCHED_NUMBER", "数字 %s 回不到任何 fact.value"
                                % tok["token"], location=loc, token=tok["token"],
                                context=tok["text"], params={"tok": str(tok['token'])}))
        matched = bound + unbound_yellow

        for key, line, col in scan.cites:
            used_keys[key] = used_keys.get(key, 0) + 1
            entry = bib_by_key.get(key)
            line_text = text.split("\n")[line - 1].strip() if line - 1 < len(text.split("\n")) else ""
            if entry is None:
                red.append(Issue(
                    "MISSING_CITE", "引用了 bib 里不存在的 key %r" % key,
                    location="%s:%s:%s" % (rel, line, col), token=key,
                    context=line_text, params={"key": repr(key)}))
                continue
            name, value = entry.stable_id
            if name is None:
                # V3 的证据模型不把「远端稳定标识」当发布闸：本地审计只要求
                # 引用 key 在 bib 里有条目；缺 DOI/arXiv 记提示，供人工补。
                issue = Issue(
                    "BIB_NO_STABLE_ID",
                    "bib 条目 %r（@%s）没有 arxiv/doi%s（不可远端复核）"
                    % (key, entry.kind, "/url" if entry.kind in _URL_OK_TYPES else ""),
                    location="%s:%s" % (entry.file, entry.line), token=key,
                    severity=SEV_INFO if cfg.is_v3 else SEV_RED, message_key="finding.BIB_NO_STABLE_ID.v2", params={"key": repr(key), "entry": str(entry.kind), "arg2": str('/url' if entry.kind in _URL_OK_TYPES else '')})
                if cfg.is_v3:
                    hints.append(issue)
                else:
                    red.append(issue)
                continue
            if not valid_stable_id(name, value):
                red.append(Issue(
                    "BAD_STABLE_ID_FORMAT",
                    "%r 的 %s=%r 格式不合法（不能解析成真实标识）" % (key, name, value),
                    location="%s:%s" % (entry.file, entry.line), token=key, params={"key": repr(key), "name": str(name), "value": repr(value)}))
                continue
            if resolve:
                status, detail = (_resolve_doi(value) if name == "doi"
                                  else _resolve_arxiv(value))
                item = {"key": key, "id_type": name, "id": value,
                        "status": status, "detail": detail}
                unresolved.append(item)
                if status == "not_found":
                    red.append(Issue(
                        "UNRESOLVED_CITE",
                        "引用 %r 的 %s=%s 在远端不存在（%s）" % (key, name, value, detail),
                        location="%s:%s" % (entry.file, entry.line), token=key, params={"key": repr(key), "name": str(name), "value": str(value), "detail": str(detail)}))
                elif status == "unverified":
                    hints.append(Issue(
                        "CITE_UNVERIFIED",
                        "%r 的 %s=%s 未能联网核验（%s），不判红" % (key, name, value, detail),
                        location="%s:%s" % (entry.file, entry.line), token=key,
                        severity=SEV_YELLOW, params={"key": repr(key), "name": str(name), "value": str(value), "detail": str(detail)}))
                    yellow.append(hints[-1])

        # 图的数据面：没有随图 CSV 的图，数字不可核（红队 D10）
        for path, line in scan.figures:
            p = (cfg.root / path)
            candidates = [p.with_suffix(".csv") if p.suffix else Path(str(p) + ".csv"),
                          Path(str(p) + ".csv")]
            if any(c.is_file() for c in candidates):
                continue
            if path in seen_figures:
                continue
            seen_figures.add(path)
            yellow.append(Issue(
                "FIGURE_UNVERIFIED",
                "图 %s 没有随图数据（.csv），图里的数字不在本闸门覆盖范围内" % path,
                location="%s:%s" % (rel, line), token=path, severity=SEV_YELLOW, params={"path": str(path)}))

    # 未进 bib 可复核字段的条目（即使没被引用也要说一声）
    for e in bib_entries:
        if e.key not in used_keys and e.stable_id[0] is None:
            hints.append(Issue(
                "BIB_NO_STABLE_ID", "bib 条目 %r 既没有 arxiv 也没有 doi（不可复核）" % e.key,
                location="%s:%s" % (e.file, e.line), token=e.key, severity=SEV_INFO, message_key="finding.BIB_NO_STABLE_ID.v3", params={"e": repr(e.key)}))
        if e.key in used_keys and e.stable_id[0] is not None and not valid_stable_id(*e.stable_id):
            pass  # 已在引用处判红

    for f in facts:
        if marker_count.get(f.id, 0) == 0:
            hints.append(Issue(
                "UNUSED_FACT", "账上有、文里没用：fact %r（%s）" % (f.id, f.claim),
                location="%s:%s" % (f.file, f.line or "?"), token=f.id, severity=SEV_INFO, params={"fact": repr(f.id), "fact1": str(f.claim)}))

    # R-11：bib 里有、闭包内从未被 \cite* 家族引用 → 黄（exit 3）。
    # 引用卫生不是编造风险，--strict/L2 也保持黄（§8.1 UNUSED_BIB）。
    # 三条窄豁免：\nocite{*}（整库）、\nocite{key}（该 key 已进 used_keys）、
    # 配置里的 bib_allow_unused 人签白名单。
    nocite_all = any(scan.nocite_all for scan in scanned.values())
    unused_bib = unused_bib_entries(bib_entries, used_keys, nocite_all,
                                    cfg.bib_allow_unused)
    for e in unused_bib:
        yellow.append(Issue(
            "UNUSED_BIB",
            "bib 条目 %r 在审计闭包内从未被 \\cite 引用——参考文献里有它、正文没用它"
            "（R-11）；确属保留请写 bib_allow_unused = [%r] 或在正文 \\nocite{%s}"
            % (e.key, e.key, e.key),
            location="%s:%s" % (e.file, e.line), token=e.key, severity=SEV_YELLOW, params={"e": repr(e.key), "e1": repr(e.key), "e2": str(e.key)}))

    # 覆盖：闭包外还有 .tex 从未被审计 -> 黄（红队 B4/B8）。
    # 批 135：只含导言区/`\input`、没有可审计内容的文件不报（它没东西可扫）。
    all_tex = all_tex_files(cfg)
    unscanned = [p for p in all_tex
                 if p not in scanned and _needs_scan(cfg, p)]
    for p in unscanned:
        yellow.append(Issue(
            "UNSCANNED_TEX", "%s 不在审计闭包里（未被扫描）" % p,
            location=p, token=p, severity=SEV_YELLOW, params={"p": str(p)}))

    # 绑定率过低 = 还在靠白名单（红队 C6/C11）
    denom = bound + unbound_yellow + unmatched
    if denom >= 4 and (bound / denom) < 0.5:
        yellow.append(Issue(
            "LOW_BINDING_RATE",
            "内联绑定率 %d/%d 低于 50%%——大部分数字只是「回得到账」，还没回到对的那条账"
            % (bound, denom), location="audit", severity=SEV_YELLOW, params={"bound": str(int(bound)), "denom": str(int(denom))}))

    if resolve and len(unresolved) >= 3:
        bad = sum(1 for u in unresolved if u["status"] == "unverified")
        if bad / len(unresolved) > 0.5:
            yellow.append(Issue(
                "RESOLVE_DEGRADED",
                "联网核验 %d/%d 条都没成功（限流/无网？）——引用存在性本轮等于没验"
                % (bad, len(unresolved)), location="refs.bib", severity=SEV_YELLOW, params={"bad": str(int(bad)), "arg1": str(int(len(unresolved)))}))

    pdf_summary: dict = {"checked": False}
    if cfg.is_v3:
        # 账上每条定量 fact 都必须能在 PDF 里找到（未被正文绑定的 fact 也
        # 要出现：账上的数被删/漏渲染同样是完整性缺口，P-04）。
        bound_ids = {e["fact_id"] for e in ledger}
        for f in facts:
            if f.kind != "claim" or not f.value_keys or f.id in bound_ids:
                continue
            forms = [f.value] + [d.get("text", "") for d in f.display]
            keys: list[str] = []
            for form in forms:
                keys.extend(_fact_form_keys(form))
            keys = sorted(set(keys))
            if keys:
                ledger.append({"fact_id": f.id, "raw": f.value, "keys": keys,
                               "file": f.file, "page": 1,
                               "line": f.line or 1, "col": 1})

        pdf_path = cfg.root / cfg.output
        if pdf_path.is_file():
            from .pdfgate import pdf_key_counts, verify_document
            actual = pdf_key_counts(pdf_path)
            declared = _v3_whitelist(bib_entries, used_keys)
            whitelist = []
            for item in declared:
                present = actual.get(item["key"], 0)
                if present <= 0:
                    continue
                whitelist.append({"key": item["key"],
                                  "count": min(item["count"], present),
                                  "source": item["source"],
                                  "category": "W2-bib"})
            # 结构性白名单来自源文件（章节号/浮动体/bib 年份），页码由
            # pdfgate 按实际页数补。它只影响 PDF 比对，不进 ledger/check。
            struct_sections = sections
            struct_root = cfg.root_tex
            if not struct_root and (cfg.root / "main.tex").is_file():
                struct_root = "main.tex"
                shell = (cfg.root / "main.tex").read_text(encoding="utf-8")
                if all(rel != "main.tex" for rel, _text in sections):
                    struct_sections = list(sections) + [("main.tex", shell)]
            structural = structural_whitelist(
                struct_sections, bib_entries, struct_root)
            # P-01S（批 127）：闭包内所有 .tex / .bib / facts/*.toml 都是
            # 「这一节该写什么」的源；旧 PDF 比它们新不了才算现编件。
            pdf_sources = [cfg.root / rel for rel, _text in sections]
            pdf_sources += list(bib_paths)
            pdf_sources += sorted(p for p in cfg.root.glob(cfg.facts_glob)
                                  if p.is_file())
            pdf_stats: dict = {}
            pdf_red, pdf_yellow = verify_document(
                pdf_path, {"number_ledger": ledger,
                           "pdf_whitelist": whitelist,
                           "structural_whitelist": structural},
                stats=pdf_stats, sources=pdf_sources)
            red += pdf_red
            yellow += pdf_yellow
            pdf_summary = {"checked": True, "file": cfg.output,
                           "ledger": len(ledger),
                           "whitelist": len(whitelist),
                           "stale": bool(pdf_stats.get("stale", False)),
                           "red": len(pdf_red), "yellow": len(pdf_yellow),
                           "structural_masked": pdf_stats.get(
                               "structural_masked", 0),
                           "structural_masked_by": pdf_stats.get(
                               "structural_masked_by", {})}

    # 批 132：冻结后的检查——只判「冻结后有没有被改」。lock 不存在不检查。
    lock = lock_check(cfg)
    if lock is not None:
        red.append(Issue(CHANGED_CODE, lock["message"],
                         location=lock["location"],
                         token=lock["current_sha256"][:12],
                         message_key=finding_key(CHANGED_CODE),
                         params={"current": lock["current_sha256"][:12],
                                 "frozen": lock["locked_sha256"][:12]}))

    # 批 133：处在解冻状态（log 最后一条是 unfreeze）→ 黄，不改退出码语义。
    unfrozen = unfrozen_info(cfg.root)
    if unfrozen is not None:
        yellow.append(Issue(UNFROZEN_CODE, unfrozen["message"],
                            location=unfrozen["location"], token="unfreeze",
                            severity=SEV_YELLOW,
                            message_key=finding_key(UNFROZEN_CODE),
                            params={"log": unfrozen["location"]}))

    summary = {
        "facts": len(facts),
        "sections": len(sections),
        "numbers_total": numbers_total,
        "numbers_matched": matched,
        "numbers_bound": bound,
        "numbers_unbound": unbound_yellow,
        "numbers_unmatched": unmatched,
        "annotations_skipped": annotations_total,
        "annotation_sites": annotation_sites,
        "cites_total": sum(used_keys.values()),
        "cites_unique": len(used_keys),
        "bib_entries": len(bib_entries),
        "bib_files": [p.relative_to(cfg.root).as_posix() for p in bib_paths],
        "bib_used": len([k for k in used_keys if k in bib_by_key]),
        "bib_unused": [e.key for e in unused_bib],
        "red": len(red),
        "yellow": len(yellow),
        "hints": len(hints),
        "pdf": pdf_summary,
        "confidence": {
            "high": sum(1 for f in facts if f.confidence == "high"),
            "med": sum(1 for f in facts if f.confidence == "med"),
            "low": sum(1 for f in facts if f.confidence == "low"),
        },
        "coverage": {
            "files_scanned": sorted(scanned),
            "files_scanned_count": len(scanned),
            "files_matched_by_glob": len(_glob_paths(cfg.root, cfg.sections_glob)),
            "files_unscanned": unscanned,
            "facts_loaded": len(facts),
            "parse_errors": 0,
            "sha_pinned": sum(1 for f in facts if f.source_sha256),
            "numbers_total": numbers_total,
            "numbers_bound": bound,
        },
        "usage": {k: v for k, v in usage.items()},
        "marker_count": marker_count,
        "attestation": {
            "facts_sha256": facts_digest(cfg),
            "sources_sha256": {src: digest for src, digest in sorted(
                (f.source, f.source_sha256) for f in facts if f.source_sha256)},
            "git_commit": git_commit(cfg.root),
        },
    }
    return red, yellow, hints, summary, unresolved
