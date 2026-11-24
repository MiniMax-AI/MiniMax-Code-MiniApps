# -*- coding: utf-8 -*-
"""源层「断言是否真的活在正文里」判据（SPEC-V3.0 S-03）。

三条通用规则，不认项目名、不认路径：

1. 定量事实在活跃正文里没有任何 `\\fact{}` 标记
   → `APPROVAL_MISSING_ASSERTIONS`（没有断言可签）＋ `ASSERTION_DRIFT`（签过的断言不在正文）。
   「活跃正文」＝去掉注释、宏定义体、被丢弃的宏参数、`\\iffalse` 块之后的文本。
   宏定义体与 `\\newcommand{\\ignore}[1]{}` 的参数都不会被渲染，写在那里的
   标记等于没写（宏藏数 / 忽略宏包住结论 / 无标记定量句）。
2. 标记活着，但所在句子里连一个数字都没有，且标记没自带 `\\fact{ID}{值}`
   的第二参数 → 这句话没有断言任何定量值（计数器/表达式算出来的数不在
   源文本里）→ `ASSERTION_DRIFT`。
3. 事实声明了正文角色（role ∈ 正文节），而它的标记只出现在 `\\appendix`
   之后 → 角色变了（正文结论被搬进附录）→ `FACT_OUT_OF_SPAN`（红）＋
   `ASSERTION_DRIFT`（红，多码原则见 SPEC §8）。
4. 定量 fact 的标记留在正文，但正文那一句里没有任何数字承载它（只剩
   「见附录／见 Table X／如前述」这类指代），数字只在 `\\appendix` 之后
   出现（带 `\\fact{}` 标记或同值裸数字都算） → `FACT_UNUSED_IN_SPAN`
   （黄，exit 3）＋ `ASSERTION_DRIFT`（红）。良性近邻（正文句带数字、
   附录只是同值复述）不触发：判据看「正文有没有数字承载」，不看有没有附录。
"""
from __future__ import annotations

import re

from .audit import Issue
from .constants import SEV_YELLOW
from .facts import fact_value_keys
from .v3 import _balanced

BODY_ROLES = {"abstract", "introduction", "methods", "results", "discussion",
              "conclusion", "background", "related", "analysis"}

_DEF_RE = re.compile(
    r"\\(?:newcommand|renewcommand|providecommand)\*?\s*"
    r"(?:\{\s*\\([A-Za-z@]+)\s*\}|\\\\([A-Za-z@]+))\s*"
    r"(?:\[(\d)\])?\s*(?:\[[^\]]*\])?\s*\{")
_FACT_RE = re.compile(r"\\fact\s*\{([^{}]*)\}")
_IFFALSE_RE = re.compile(r"\\iffalse\b.*?\\fi\b", re.S)
_SENTENCE_END = re.compile(r"[.!?。！？]")


def _blank(chars: list, start: int, stop: int) -> None:
    for i in range(max(0, start), min(stop, len(chars))):
        if chars[i] != "\n":
            chars[i] = " "


def _strip_comments(tex: str) -> str:
    """去掉 TeX 注释（`\\%` 不是注释），保留换行。"""
    out: list[str] = []
    i, n = 0, len(tex)
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


def _macro_definitions(tex: str) -> list[dict]:
    """`\\newcommand` 家族的定义体：名字、参数个数、体文本、覆盖区间。"""
    out: list[dict] = []
    for m in _DEF_RE.finditer(tex):
        name = m.group(1) or m.group(2) or ""
        arity = int(m.group(3) or 0)
        body_start = m.end() - 1
        body_end = _balanced(tex, body_start)
        out.append({"name": name, "arity": arity,
                    "body": tex[body_start + 1:body_end - 1],
                    "start": m.start(), "end": body_end})
    return out


def _live_text(tex: str) -> tuple[str, list[dict]]:
    """活跃正文：抹掉宏定义体、被丢弃的宏参数、`\\iffalse` 块。

    返回 (活跃文本, 宏定义列表)。活跃文本保留原长度（空白替换），
    所以标记的位置/行号在原文里仍然有效。
    """
    text = _strip_comments(tex)
    chars = list(text)
    defs = _macro_definitions(text)
    for d in defs:
        _blank(chars, d["start"], d["end"])
    # 参数被丢弃的宏（`\\newcommand{\\ignore}[1]{}`）：调用点的参数也不渲染。
    for d in defs:
        used = {int(k) for k in re.findall(r"#(\d)", d["body"])}
        missing = [p for p in range(1, d["arity"] + 1) if p not in used]
        if not missing:
            continue
        call_re = re.compile(r"\\%s\b" % re.escape(d["name"]))
        for m in call_re.finditer("".join(chars)):
            j = m.end()
            for param in range(1, d["arity"] + 1):
                k = j
                while k < len(chars) and chars[k] in " \t\r\n":
                    k += 1
                if k < len(chars) and chars[k] == "{":
                    end = _balanced("".join(chars), k)
                else:
                    break
                if param in missing:
                    _blank(chars, k, end)
                j = end
    for m in _IFFALSE_RE.finditer(text):
        _blank(chars, m.start(), m.end())
    return "".join(chars), defs


def _live_markers(tex: str) -> tuple[str, list[dict]]:
    live, _defs = _live_text(tex)
    out: list[dict] = []
    for m in _FACT_RE.finditer(live):
        ids = [x.strip() for x in m.group(1).split(",") if x.strip()]
        has_value = False
        k = m.end()
        while k < len(live) and live[k] in " \t":
            k += 1
        if k < len(live) and live[k] == "{":
            has_value = True
        out.append({"ids": ids, "pos": m.start(), "has_value": has_value})
    return live, out


def _sentence_of(tex: str, pos: int) -> str:
    """标记所在句子的文本（向前后各找到句末标点或空行）。"""
    head = max(tex.rfind("\n\n", 0, pos), tex.rfind(". ", 0, pos),
               tex.rfind("。", 0, pos))
    start = 0 if head < 0 else head + 1
    m = _SENTENCE_END.search(tex, pos)
    end = m.end() if m else len(tex)
    return tex[start:end]


def live_text_issues(cfg, facts, sections) -> list[Issue]:
    """三条源层「断言活着吗」判据；只对 V3 项目生效。"""
    if not cfg.is_v3:
        return []
    out: list[Issue] = []
    # 每条 fact 的活跃标记：[(rel, pos, has_value)]
    live: dict[str, list[tuple[str, int, bool]]] = {}
    live_sentences: dict[str, list[str]] = {}
    # 批 58：正文（\appendix 之前）与附录分开记「这一句有没有数字承载」。
    body_marker_count: dict[str, int] = {}
    body_carries: dict[str, bool] = {}
    appendix_carries: dict[str, bool] = {}
    appendix_line: dict[str, int] = {}
    appendix_texts: list[str] = []
    for rel, text in sections:
        stripped = _strip_comments(text)
        app = re.search(r"\\appendix\b", stripped)
        appendix_line[rel] = (stripped.count("\n", 0, app.start()) + 1) if app else 0
        if app:
            appendix_texts.append(stripped[app.end():])
        live_tex, marks = _live_markers(text)
        for m in marks:
            line = stripped.count("\n", 0, m["pos"]) + 1
            # 句子里的 \fact{} 标记本身不含值（A1 的 1 不是数字断言）。
            sentence = _FACT_RE.sub(" ", _sentence_of(live_tex, m["pos"]))
            has_number = bool(fact_value_keys(sentence))
            in_body = (not appendix_line[rel]) or line < appendix_line[rel]
            for fid in m["ids"]:
                live.setdefault(fid, []).append((rel, line, m["has_value"]))
                live_sentences.setdefault(fid, []).append(sentence)
                if in_body:
                    body_marker_count[fid] = body_marker_count.get(fid, 0) + 1
                    if m["has_value"] or has_number:
                        body_carries[fid] = True
                elif m["has_value"] or has_number:
                    appendix_carries[fid] = True

    for f in facts:
        loc = "%s:%s" % (f.file, f.line or "?")
        marks = live.get(f.id, [])
        if not marks:
            if f.quantitative or f.value.strip():
                out.append(Issue(
                    "APPROVAL_MISSING_ASSERTIONS",
                    "fact %r 有定量值 %r，但活跃正文里没有任何 \\fact{%s} 标记——"
                    "没有断言可签（宏定义体/被丢弃的宏参数/附录外都算没写）"
                    % (f.id, f.value, f.id), location=loc, token=f.id, message_key="finding.APPROVAL_MISSING_ASSERTIONS.v2", params={"fact": repr(f.id), "value": repr(f.value), "fact1": str(f.id)}))
                out.append(Issue(
                    "ASSERTION_DRIFT",
                    "fact %r 的定量断言不在活跃正文里（标记缺失或只出现在不会渲染的位置）"
                    % f.id, location=loc, token=f.id, message_key="finding.ASSERTION_DRIFT.v4", params={"fact": repr(f.id)}))
            continue

        # 规则 2：标记活着，但句子里没有任何数字，也没有 \\fact{ID}{值} 的第二参数。
        drift_emitted = False
        if f.quantitative and not any(has_value for _rel, _line, has_value in marks):
            sentences = live_sentences.get(f.id, [])
            if sentences and not any(fact_value_keys(s) for s in sentences):
                out.append(Issue(
                    "ASSERTION_DRIFT",
                    "fact %r 的标记所在句子没有任何数字——定量值不是源文本字面量"
                    "（计数器/表达式算出来的数无法核对）" % f.id,
                    location=loc, token=f.id, message_key="finding.ASSERTION_DRIFT.v5", params={"fact": repr(f.id)}))
                drift_emitted = True

        # 规则 3：正文角色的事实，标记只在 \\appendix 之后出现。
        role = (f.role or "").strip().lower()
        if role in BODY_ROLES:
            body_marks = [rel for rel, line, _v in marks
                          if not appendix_line.get(rel) or line < appendix_line[rel]]
            if not body_marks:
                out.append(Issue(
                    "FACT_OUT_OF_SPAN",
                    "fact %r 声明 role=%r，但标记只在 \\appendix 之后出现——"
                    "事实落在正文跨度之外（R-03）" % (f.id, f.role),
                    location=loc, token=f.id, params={"fact": repr(f.id), "fact1": repr(f.role)}))
                out.append(Issue(
                    "ASSERTION_DRIFT",
                    "fact %r 声明 role=%r，但标记只在 \\appendix 之后出现——"
                    "结论被搬进附录，正文角色对不上（S-03）" % (f.id, f.role),
                    location=loc, token=f.id, message_key="finding.ASSERTION_DRIFT.v6", params={"fact": repr(f.id), "fact1": repr(f.role)}))

        # 规则 4（批 58/62）：定量 fact 的标记在正文只剩指代，数字只在附录里。
        # 附录里的数字可以带 \fact{} 标记，也可以只是同值的裸数字
        # （「The measured count was 42.」）——两种都算「正文跨度没承载」。
        has_quant = bool(f.quantitative or f.value.strip())
        appendix_has_value = False
        if has_quant:
            keys = set(f.value_keys or fact_value_keys(f.value))
            appendix_has_value = any(
                keys & fact_value_keys(region) for region in appendix_texts)
        if (has_quant and body_marker_count.get(f.id)
                and not body_carries.get(f.id)
                and (appendix_carries.get(f.id) or appendix_has_value)):
            out.append(Issue(
                "FACT_UNUSED_IN_SPAN",
                "fact %r 的 \\fact{} 标记留在正文，但正文这一句没有任何数字承载 "
                "value=%r（只剩指代）——定量断言不在正文跨度里，数字只出现在 "
                "\\appendix 之后（R-03）" % (f.id, f.value),
                location=loc, token=f.id, severity=SEV_YELLOW, params={"fact": repr(f.id), "value": repr(f.value)}))
            if not drift_emitted:
                out.append(Issue(
                    "ASSERTION_DRIFT",
                    "fact %r 的定量断言不在正文跨度里：正文只剩指代，数字落在附录"
                    % f.id, location=loc, token=f.id, message_key="finding.ASSERTION_DRIFT.v7", params={"fact": repr(f.id)}))
    return out
