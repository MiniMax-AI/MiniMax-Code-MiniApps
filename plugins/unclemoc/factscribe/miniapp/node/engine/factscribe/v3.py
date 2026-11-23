# -*- coding: utf-8 -*-
"""V3.0 证据模型（SPEC §2.2 / §2.4 / P-08 / S-01..S-08）。

本模块只做「V3 项目声明」才启用的判据，v1 项目照旧走 audit.py 的老路径：

- §2.2 断言：`bu_text_sha256` 是 BU（句子）指纹；断言指向的 BU 必须真的
  承载这条 fact（指纹相符，或该 BU 里确实有这条 fact 的 `\\fact{ID}` 标记）。
- S-03 审批：`approvals/<id>.target.json` + `.sig`，签名对象是
  `target_sha256 = sha256(JCS(target - signature))`，签名消息是这个字符串本身。
- §2.4 信任根：任何被引用的 key 文件 `resolve()` 后落在项目根内 →
  `STAMP_KEY_UNTRUSTED`（项目内公钥＝自签自验，不是信任根）。
- S-08 数值宏：结构化登记必须逐字命中内置模板，双签必须两个不同 key。

所有判据都是通用规则；不认项目名、不认路径、不认哈希白名单。
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from .audit import Issue
from .pdfgate import ed25519_verify, jcs
from .texscan import sentence_spans

# --------------------------------------------------------------------------
# §2.2 BU（句子）指纹
# --------------------------------------------------------------------------

_MARK = "\x02"


def _balanced(text: str, start: int) -> int:
    """text[start] == '{'；返回配对 '}' 之后的位置（转义不配对）。"""
    depth = 0
    i = start
    while i < len(text):
        c = text[i]
        if c == "\\":
            i += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return len(text)


def _skip_ws(text: str, i: int) -> int:
    while i < len(text) and text[i] in " \t\r\n":
        i += 1
    return i


def _strip_comments(tex: str) -> str:
    """去掉 TeX 注释（`\\%` 不是注释），保留换行。"""
    out: list[str] = []
    i = 0
    n = len(tex)
    while i < n:
        c = tex[i]
        if c == "\\" and i + 1 < n:
            out.append(tex[i:i + 2])
            i += 2
            continue
        if c == "%":
            while i < n and tex[i] != "\n":
                i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _canon_bu(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _mark_facts(text: str):
    """把 `\\fact{IDS}`（可带第二个花括号的值）替换成 \\x02。

    返回 (canonical_text, markers)，markers = [(pos_in_canonical, [ids])]。
    """
    out: list[str] = []
    markers: list[tuple[int, list[str]]] = []
    i = 0
    n = len(text)
    while i < n:
        if text.startswith("\\fact", i):
            j = _skip_ws(text, i + 5)
            if j < n and text[j] == "{":
                e1 = _balanced(text, j)
                ids = [x.strip() for x in text[j + 1:e1 - 1].split(",") if x.strip()]
                k = _skip_ws(text, e1)
                e2 = e1
                if k < n and text[k] == "{":
                    e2 = _balanced(text, k)
                markers.append((len(out), ids))
                out.append(_MARK)
                i = e2
                continue
        out.append(text[i])
        i += 1
    return "".join(out), markers


@dataclass
class BU:
    bu_id: str
    text: str
    sha256: str
    fact_ids: set = field(default_factory=set)


def bu_index(sections: list[tuple[str, str]]) -> dict[str, BU]:
    """每个源文件按句子切 BU，编号 `file#ordinal`（1 起）。"""
    index: dict[str, BU] = {}
    for rel, raw in sections:
        canon, markers = _mark_facts(_strip_comments(raw))
        spans = sentence_spans(canon)
        for ordinal, (start, end) in enumerate(spans, 1):
            chunk = canon[start:end]
            if not chunk.strip():
                continue
            ids: set[str] = set()
            for pos, mids in markers:
                if start <= pos < end:
                    ids.update(mids)
            text = _canon_bu(chunk)
            digest = "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()
            index["%s#%d" % (rel, ordinal)] = BU(
                bu_id="%s#%d" % (rel, ordinal), text=text,
                sha256=digest, fact_ids=ids)
    return index


def _sha(value: str) -> str:
    return str(value or "").strip().lower().removeprefix("sha256:")


def assertion_issues(facts, index: dict[str, BU]) -> list[Issue]:
    """S-03：审批/断言对象必须仍然指向承载该 fact 的 BU。"""
    out: list[Issue] = []
    for f in facts:
        for a in f.assertions:
            bu_id = str(a.get("bu_id") or "").strip()
            claimed = _sha(str(a.get("bu_text_sha256") or ""))
            bu = index.get(bu_id)
            loc = "%s:%s" % (f.file, f.line or "?")
            if bu is None:
                out.append(Issue(
                    "ASSERTION_DRIFT",
                    "fact %r 的断言指向 %r，但闭包里没有这个 BU——句子被删/被搬走"
                    % (f.id, bu_id), location=loc, token=f.id, message_key="finding.ASSERTION_DRIFT.v8", params={"fact": repr(f.id), "bu_id": repr(bu_id)}))
                continue
            if claimed and bu.sha256.removeprefix("sha256:") == claimed:
                continue
            # 指纹不相符：如果该 BU 里连这条 fact 的标记都没有，就是漂移；
            # 有标记说明句子仍承载这条断言（指纹算法版本差异不应误红）。
            if f.id not in bu.fact_ids:
                out.append(Issue(
                    "ASSERTION_DRIFT",
                    "fact %r 的断言句子指纹不符（%s 声明 %s…，现值 %s…），"
                    "且该 BU 里没有 \\fact{%s} 标记——值被搬到别的句子"
                    % (f.id, bu_id, claimed[:12], bu.sha256[7:19], f.id),
                    location=loc, token=f.id, message_key="finding.ASSERTION_DRIFT.v9", params={"fact": repr(f.id), "bu_id": str(bu_id), "claimed": str(claimed[:12]), "bu": str(bu.sha256[7:19]), "fact1": str(f.id)}))
    return out


# --------------------------------------------------------------------------
# S-01 / §2.4 key 信任根
# --------------------------------------------------------------------------

def _keys_path(cfg, raw: str) -> Path | None:
    text = str(raw or "").strip()
    if not text:
        return None
    p = Path(text).expanduser()
    return p if p.is_absolute() else (cfg.root / p)


def key_trust_issues(cfg) -> list[Issue]:
    """被引用的 key 文件必须在项目根之外（S-01 / §2.4）。"""
    out: list[Issue] = []
    for label, raw in (("approver_keys_file", cfg.approver_keys_file),
                       ("release_keys_file", cfg.release_keys_file)):
        path = _keys_path(cfg, raw)
        if path is None:
            continue
        try:
            path.resolve().relative_to(cfg.root.resolve())
        except ValueError:
            continue
        out.append(Issue(
            "STAMP_KEY_UNTRUSTED",
            "%s 指向项目根内部的公钥文件（%s）——项目内公钥＝自签自验，"
            "不是项目外信任根（§2.4 / P-08）" % (label, raw),
            location=str(raw), token=label, exit_code=5, message_key="finding.STAMP_KEY_UNTRUSTED.v4", params={"label": str(label), "raw": str(raw)}))
    return out


# --------------------------------------------------------------------------
# S-03 / S-04 审批目标与签名
# --------------------------------------------------------------------------

def _load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _target_digest(target: dict) -> str:
    body = {k: v for k, v in target.items() if k != "signature"}
    return "sha256:" + hashlib.sha256(jcs(body)).hexdigest()


def _sig_of(target: dict, sig_path: Path) -> bytes | None:
    text = ""
    if sig_path.is_file():
        try:
            text = sig_path.read_text(encoding="utf-8").strip()
        except OSError:
            text = ""
    if not text:
        text = str(target.get("signature") or "")
    if not text:
        return None
    try:
        return base64.b64decode(text.split(":", 1)[-1])
    except (ValueError, TypeError):
        return None


def _registry_keys(path: Path | None) -> dict[str, dict]:
    if path is None or not path.is_file():
        return {}
    data = _load_json(path)
    if not isinstance(data, dict):
        return {}
    return {str(k.get("key_id")): k for k in (data.get("keys") or [])
            if isinstance(k, dict)}


def approval_issues(cfg, facts, report: dict | None = None) -> list[Issue]:
    """审批目标：签名对象、断言摘要、输入集、nonce。

    只校验**存在的**审批：V3 允许项目只走 PDF/源层证据（无 approvals/），
    那由覆盖面报告，不在本函数判红。
    """
    out: list[Issue] = []
    adir = cfg.root / "approvals"
    targets = sorted(adir.glob("*.target.json")) if adir.is_dir() else []
    if not targets:
        return out

    keys = _registry_keys(_keys_path(cfg, cfg.approver_keys_file))
    nonces: set[str] = set()
    kp = _keys_path(cfg, cfg.approver_keys_file)
    if kp is not None:
        npath = kp.parent / "nonces.ndjson"
        if npath.is_file():
            for line in npath.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if isinstance(rec, dict) and rec.get("nonce"):
                    nonces.add(str(rec["nonce"]))

    report_approvals = {}
    if isinstance(report, dict):
        for a in report.get("approvals") or []:
            if isinstance(a, dict) and a.get("fact_id"):
                report_approvals[str(a["fact_id"])] = a

    fact_ids = {f.id for f in facts}
    for tpath in targets:
        target = _load_json(tpath)
        loc = str(tpath.relative_to(cfg.root))
        if not isinstance(target, dict):
            out.append(Issue("APPROVAL_MISSING_ASSERTIONS",
                             "审批目标 %s 读不了或不是对象" % loc,
                             location=loc, exit_code=1, message_key="finding.APPROVAL_MISSING_ASSERTIONS.v3", params={"loc": str(loc)}))
            continue
        fid = str(target.get("id") or "").strip()
        if fid and fid not in fact_ids:
            out.append(Issue("APPROVAL_STALE",
                             "审批目标 %s 指向账上没有的 fact %r" % (loc, fid),
                             location=loc, token=fid, message_key="finding.APPROVAL_STALE.v3", params={"loc": str(loc), "fid": repr(fid)}))
            continue

        digest = _target_digest(target)
        key_id = str(target.get("key_id") or "")
        key = keys.get(key_id)
        if not key:
            out.append(Issue("KEY_UNREGISTERED",
                             "审批目标 %s 的 key_id=%r 不在项目外公钥登记里"
                             % (loc, key_id), location=loc, token=key_id, message_key="finding.KEY_UNREGISTERED.v3", params={"loc": str(loc), "key_id": repr(key_id)}))
            continue
        if key.get("revoked_at"):
            out.append(Issue("KEY_REVOKED",
                             "审批 key %r 已吊销（%s）" % (key_id, loc),
                             location=loc, token=key_id, message_key="finding.KEY_REVOKED.v3", params={"key_id": repr(key_id), "loc": str(loc)}))
            continue
        sig = _sig_of(target, Path(str(tpath).replace(".target.json", ".sig")))
        if sig is None:
            out.append(Issue("APPROVAL_MISSING_ASSERTIONS",
                             "审批目标 %s 没有签名（缺 .sig / signature）" % loc,
                             location=loc, token=fid, message_key="finding.APPROVAL_MISSING_ASSERTIONS.v4", params={"loc": str(loc)}))
            continue
        try:
            pub = base64.b64decode(str(key.get("public_key") or "").split(":", 1)[-1])
        except (ValueError, TypeError):
            pub = b""
        if not ed25519_verify(pub, sig, digest.encode("utf-8")):
            out.append(Issue("APPROVAL_STALE",
                             "审批签名无效：签名消息必须是 target_sha256=%s"
                             % digest, location=loc, token=fid, message_key="finding.APPROVAL_STALE.v4", params={"digest": str(digest)}))
            continue

        if report_approvals:
            entry = report_approvals.get(fid)
            if entry and str(entry.get("target_sha256") or "") != digest:
                out.append(Issue("APPROVAL_STALE",
                                 "report.approvals[%s].target_sha256 与现值不符——"
                                 "签过的目标被换过" % fid, location=loc, token=fid, message_key="finding.APPROVAL_STALE.v5", params={"fid": str(fid)}))
            entry_digest = str((entry or {}).get("assertion_digest") or "")
            if entry_digest and entry_digest != str(target.get("assertions_digest") or ""):
                out.append(Issue("APPROVAL_STALE",
                                 "report 里的 assertion_digest 与审批目标不符（%s）" % fid,
                                 location=loc, token=fid, message_key="finding.APPROVAL_STALE.v6", params={"fid": str(fid)}))

        nonce = str(target.get("nonce") or "")
        if nonce and nonce in nonces:
            out.append(Issue("APPROVAL_REPLAY",
                             "审批 nonce %s 已在账上出现过——重放" % nonce,
                             location=loc, token=fid, params={"nonce": str(nonce)}))
    return out


# --------------------------------------------------------------------------
# S-08 数值宏结构化登记
# --------------------------------------------------------------------------

_LENGTH_BODY = (r"^[0-9.]+ *(?:linewidth|textwidth|columnwidth|paperwidth|"
                r"baselineskip|ex|em|pt|mm|cm|in)$")
_WIDTH_BODY = r"^[0-9.]+ *(?:linewidth|textwidth|columnwidth)$"
_COUNT_BODY = r"^[0-9]+$"
# SPEC-V3.0 §4 S-08 正文里写的那张「长度/宽度」模板（逐字可复制形态）。
# 它用了 `\(...` 而不是 `(?:...`，且 baselineskip 重复了一次；两处写法
# 是同一张模板的转义/归一差异，按 §11 的归一说明视为同一形状。
_SPEC_LENGTH_BODY = (r"^[0-9.]+ *\(linewidth|textwidth|columnwidth|paperwidth|"
                     r"baselineskip|baselineskip|ex|em|pt|mm|cm|in)$")
_BUILTIN_BODIES = {"length": {_LENGTH_BODY, _SPEC_LENGTH_BODY},
                   "width": {_WIDTH_BODY, _SPEC_LENGTH_BODY},
                   "count": {_COUNT_BODY}}
_COUNT_NAMES = ("num", "width", "height", "size")


def numeric_macro_issues(cfg) -> list[Issue]:
    """S-08：`numeric_macro_allow` 条目只允许三张内置模板 + 双 key + 到期。"""
    out: list[Issue] = []
    for idx, rule in enumerate(getattr(cfg, "numeric_macro_rules", []) or [], 1):
        name = str(rule.get("name") or "").strip().lstrip("\\")
        kind = str(rule.get("parameter_kind") or "").strip()
        body = str(rule.get("body_regex") or "").strip()
        label = "numeric_macro_allow#%d（%s）" % (idx, name or "?")
        if kind not in _BUILTIN_BODIES or body not in _BUILTIN_BODIES[kind]:
            out.append(Issue(
                "NUMERIC_MACRO_SHAPE_INVALID",
                "%s 的形状不合法：parameter_kind=%r，body_regex=%r——"
                "只允许逐字等于内置长度/宽度/计数模板（S-08）"
                % (label, kind, body), location="factscribe.toml", token=name, message_key="finding.NUMERIC_MACRO_SHAPE_INVALID.v2", params={"label": str(label), "kind": repr(kind), "body": repr(body)}))
        if kind == "count" and name and not name.endswith(_COUNT_NAMES):
            out.append(Issue(
                "NUMERIC_MACRO_SHAPE_INVALID",
                "%s 声明 parameter_kind=count，但宏名不以 %s 结尾——"
                "计数宏只允许这一族名字（S-08）"
                % (label, "/".join(_COUNT_NAMES)),
                location="factscribe.toml", token=name, message_key="finding.NUMERIC_MACRO_SHAPE_INVALID.v3", params={"label": str(label), "arg1": str('/'.join(_COUNT_NAMES))}))
        signers = rule.get("signed_by") or []
        if isinstance(signers, str):
            signers = [signers]
        if len({str(s) for s in signers if str(s).strip()}) < 2:
            out.append(Issue(
                "NUMERIC_MACRO_DOUBLE_SIGN",
                "%s 的双签没有两个不同的 key（signed_by=%r）——"
                "数值宏必须双 key 签署（S-08）" % (label, signers),
                location="factscribe.toml", token=name, params={"label": str(label), "signers": repr(signers)}))
        expires = str(rule.get("expires") or "").strip()
        if expires:
            try:
                day = date.fromisoformat(expires)
            except ValueError:
                day = None
            if day is not None and day < date.today():
                out.append(Issue(
                    "NUMERIC_MACRO_EXPIRED",
                    "%s 已于 %s 过期——过期登记不放行（S-08）" % (label, expires),
                    location="factscribe.toml", token=name, params={"label": str(label), "expires": str(expires)}))
    return out


# --------------------------------------------------------------------------
# 源层：断言里声明的 fact 必须真的出现在闭包里
# --------------------------------------------------------------------------

def approval_report_issues(cfg) -> list[Issue]:
    """`audit/` 下的 report 与 stamp 只是指针；这里检查它自称的工具与时效。

    只校验「存在且自洽」的最低面：report 的 report_sha256 自洽、
    report.inputs 与磁盘现值一致。签名链的完整验证属于 verify-pdf。
    """
    out: list[Issue] = []
    rpath = cfg.root / "audit" / "report.json"
    if not rpath.is_file():
        return out
    report = _load_json(rpath)
    if not isinstance(report, dict):
        out.append(Issue("REPORT_SCHEMA_INVALID", "audit/report.json 不是合法 JSON",
                         location="audit/report.json", exit_code=2, message_key="finding.REPORT_SCHEMA_INVALID.v3"))
        return out
    body = {k: v for k, v in report.items() if k != "report_sha256"}
    want = "sha256:" + hashlib.sha256(jcs(body)).hexdigest()
    if report.get("report_sha256") and str(report["report_sha256"]) != want:
        out.append(Issue("STAMP_REPORT_MISMATCH",
                         "report_sha256 与报告内容不符——报告被改过",
                         location="audit/report.json", exit_code=5, message_key="finding.STAMP_REPORT_MISMATCH.v7"))
    for rel, digest in (report.get("inputs") or {}).items():
        path = cfg.root / str(rel)
        if not path.is_file():
            continue
        actual = "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()
        if str(digest) != actual:
            out.append(Issue("REPORT_STALE",
                             "report.inputs 里的 %s 已被改动（审后改源）" % rel,
                             location=str(rel), token=str(rel), exit_code=7, params={"rel": str(rel)}))
            break
    return out
