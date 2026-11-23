# -*- coding: utf-8 -*-
"""源层闸门（V2.2 R-01A / R-05 / R-06 / R-07、R-04 display）。

本模块只做「从 RAW 文本里找证据」，不依赖 audit 的 Issue 模型，返回轻量
记录；audit 负责把它们装成 Issue（错误码、退出层级、位置）。
"""
from __future__ import annotations

import re

from .facts import _NUM_RE, canon_text, decimal_places

# --------------------------------------------------------------------------
# 注释 / verbatim：这些区域里的命令与数字不是渲染内容
# --------------------------------------------------------------------------

_VERBATIM_ENVS = r"(verbatim\*?|Verbatim|lstlisting|minted|comment\*?)"
_VERBATIM_RE = re.compile(r"\\begin\{(%s)\}.*?\\end\{\1\}" % _VERBATIM_ENVS, re.S)


def strip_comments(tex: str) -> str:
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


def _blank(match: re.Match) -> str:
    return "".join("\n" if ch == "\n" else " " for ch in match.group(0))


def strip_comments_and_verbatim(tex: str) -> str:
    return strip_comments(_VERBATIM_RE.sub(_blank, tex))


# --------------------------------------------------------------------------
# R-01A A：ARITH_IN_BODY（算术/计数器命令族，命中即红）
# --------------------------------------------------------------------------

_ARITH_CMDS = (
    "numexpr dimexpr inteval the value arabic roman Roman alph Alph "
    "fnsymbol setcounter addtocounter stepcounter refstepcounter newcounter "
    "count newcount advance multiply divide number romannumeral csname "
    "expandafter pgfmathparse pgfmathresult pgfmathsetmacro "
    "pgfmathtruncatemacro directlua luadirect write18"
).split()
_ARITH_RE = re.compile(r"\\(%s)\b" % "|".join(_ARITH_CMDS))


def arith_hits(tex: str) -> list[tuple[str, int]]:
    """返回 [(命令名, 行号)]。命中即红，不判断它是否真的产出了数字。"""
    text = strip_comments_and_verbatim(tex)
    out = []
    for m in _ARITH_RE.finditer(text):
        out.append((m.group(1), text.count("\n", 0, m.start()) + 1))
    return out


# --------------------------------------------------------------------------
# R-01A B：NUMERIC_IN_MACRO（宏体携带数字且未人签登记）
# --------------------------------------------------------------------------

_MACRO_CMDS = ("newcommand", "renewcommand", "providecommand",
               "DeclareRobustCommand", "NewDocumentCommand",
               "DeclareDocumentCommand")
_MACRO_RE = re.compile(r"\\(%s)\*?\s*" % "|".join(_MACRO_CMDS))
_DEF_CMD_RE = re.compile(r"\\def\s*\\([A-Za-z@]+)")


def _balanced(text: str, start: int) -> int:
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


def _macro_name(text: str, pos: int) -> tuple[str, int]:
    i = pos
    while i < len(text) and text[i] in " \t\r\n":
        i += 1
    if i < len(text) and text[i] == "{":
        j = _balanced(text, i)
        name = text[i + 1:j - 1].strip().lstrip("\\")
        return name, j
    if i < len(text) and text[i] == "\\":
        m = re.match(r"\\([A-Za-z@]+)", text[i:])
        if m:
            return m.group(1), i + m.end()
    return "", i


def macro_definitions(tex: str) -> list[tuple[str, str, int]]:
    """返回 [(宏名, 定义范围文本（含默认值/宏体，不含 [n]）, 行号)]。"""
    text = strip_comments_and_verbatim(tex)
    out: list[tuple[str, str, int]] = []
    for m in _MACRO_RE.finditer(text):
        name, i = _macro_name(text, m.end())
        if not name:
            continue
        j = i
        # 跳过可选的 [参数个数]（结构参数，不算渲染数字）
        while True:
            k = j
            while k < len(text) and text[k] in " \t\r\n":
                k += 1
            if k < len(text) and text[k] == "[":
                end = text.find("]", k)
                j = len(text) if end < 0 else end + 1
            else:
                break
        k = j
        while k < len(text) and text[k] in " \t\r\n":
            k += 1
        if k < len(text) and text[k] == "{":
            end = _balanced(text, k)
            body = text[k + 1:end - 1]
            line = text.count("\n", 0, m.start()) + 1
            out.append((name, body, line))
    for m in _DEF_CMD_RE.finditer(text):
        name = m.group(1)
        j = m.end()
        # \def\name#1#2{body}：先跳过参数骨架到第一个 '{'
        k = text.find("{", j)
        if k < 0:
            continue
        end = _balanced(text, k)
        body = text[k + 1:end - 1]
        line = text.count("\n", 0, m.start()) + 1
        out.append((name, body, line))
    return out


def numeric_macro_hits(tex: str, allow: list[str] | None = None) -> list[tuple[str, int, str]]:
    """宏体里出现数字且宏名未登记 → [(宏名, 行号, 命中的数字)]。"""
    allowed = {a.lstrip("\\") for a in (allow or [])}
    out = []
    for name, body, line in macro_definitions(tex):
        if name in allowed:
            continue
        # 参数占位 #1..#9 是结构，不是渲染数字
        cleaned = re.sub(r"#[0-9]", "", body)
        m = re.search(r"[0-9]", cleaned)
        if m:
            out.append((name, line, cleaned[m.start():m.start() + 20]))
    return out


# --------------------------------------------------------------------------
# R-07：\fsignore 参数里的定量
# --------------------------------------------------------------------------

_ANNOTATION_IDENT = re.compile(r"[A-Za-z][A-Za-z0-9]*(?:[-_./][A-Za-z0-9]+)+")
_URL_RE = re.compile(r"(?:https?|ftp)://\S+")


def fsignore_quant_hits(annotation_args) -> list[tuple[int, str, str]]:
    """[(行号, 参数字面, 命中的数字)]；表格块走 R-06 通道，不算偷渡。"""
    out = []
    for name, line, arg in annotation_args:
        if name != "fsignore" or not arg:
            continue
        if re.search(r"\\begin\{(?:table|tabular|longtable|tabularx)\*?\}", arg):
            continue
        cleaned = _URL_RE.sub(" ", arg)
        cleaned = _ANNOTATION_IDENT.sub(" ", cleaned)
        hits = [m.group(1) for m in _NUM_RE.finditer(cleaned)]
        if hits:
            out.append((line, arg.strip()[:120], ", ".join(hits[:5])))
    return out


# --------------------------------------------------------------------------
# R-06：表格区域（V2.2 §8）
# --------------------------------------------------------------------------

_TABULAR_RE = re.compile(
    r"\\begin\{(tabular\*?|longtable|tabularx)\}.*?\\end\{\1\}", re.S)


def tabular_regions(tex: str) -> list[tuple[int, int]]:
    return [(m.start(), m.end()) for m in _TABULAR_RE.finditer(tex)]


# --------------------------------------------------------------------------
# R-01A C：数字邻接宏 / 数字紧跟闭合组 / 空组拼数字
# --------------------------------------------------------------------------

_SAFE_CMDS = {"fact", "ref", "eqref", "autoref", "cref", "Cref", "label",
              "cite", "citep", "citet", "citealp", "nocite",
              "pageref", "nameref", "vref", "url", "href"}
_LEFT_MACRO_RE = re.compile(r"\\([A-Za-z]+)$")
_RIGHT_MACRO_RE = re.compile(r"\\([A-Za-z]+)")
_EMPTY_GROUP_DIGIT_RE = re.compile(r"\s*\{\s*\}\s*\d")


def adjacency_hits(adjacency: str, num: dict) -> list[tuple[str, str, dict]]:
    """[(code, detail, params)]：NUM_AFTER_GROUP / NUM_ADJACENT_MACRO / NUM_ADJACENT_GROUP。

    detail 是中文原文（一字不改）；params 是给 i18n 目录用的**数据**槽位
    （宏名等）——英文文案靠 params，不靠 detail 里的中文。
    """
    s = num["start_abs"]
    e = num["end_abs"]
    out: list[tuple[str, str, dict]] = []
    if s > 0 and adjacency[s - 1] == "}":
        out.append(("NUM_AFTER_GROUP", "数字紧跟一个闭合组", {}))
    left = adjacency[max(0, s - 60):s]
    m = _LEFT_MACRO_RE.search(left)
    if m and m.group(1) not in _SAFE_CMDS:
        out.append(("NUM_ADJACENT_MACRO", "数字紧贴宏 \\%s" % m.group(1),
                    {"macro": m.group(1), "side": "left"}))
    right = adjacency[e:e + 60]
    m = _RIGHT_MACRO_RE.match(right)
    if m and m.group(1) not in _SAFE_CMDS:
        out.append(("NUM_ADJACENT_MACRO", "宏 \\%s 紧跟数字" % m.group(1),
                    {"macro": m.group(1), "side": "right"}))
    if _EMPTY_GROUP_DIGIT_RE.match(right):
        out.append(("NUM_ADJACENT_GROUP", "空组 {} 把两个数字粘在一起", {}))
    return out


# --------------------------------------------------------------------------
# R-04：display 严格等价
# --------------------------------------------------------------------------

def display_hits(fact) -> list[tuple[str, str, dict]]:
    """[(code, detail, params)]：DISPLAY_INCONSISTENT / DISPLAY_ROUNDTO_INVALID。

    detail 是中文原文；params 是给 i18n 目录用的**数据**槽位（display 写法与
    value 本身）——英文文案靠 params。
    """
    out: list[tuple[str, str, dict]] = []
    value_canon = canon_text(fact.value)
    for item in getattr(fact, "display", []) or []:
        if item.get("auto"):
            # SPEC §11.1：display 缺省回填 value，按定义等价。
            continue
        text = item.get("text", "")
        canon = canon_text(text)
        if canon is None or value_canon is None or canon != value_canon:
            out.append((
                "DISPLAY_INCONSISTENT",
                "display %r 与 value %r 不等价（严格 canon 比较，不再有 round_to 容差）"
                % (text, fact.value),
                {"display": repr(text), "value": repr(fact.value)}))
            continue
        round_to = item.get("round_to")
        if round_to is not None:
            if (not isinstance(round_to, int) or isinstance(round_to, bool)
                    or round_to < 0 or round_to != decimal_places(text)):
                out.append((
                    "DISPLAY_ROUNDTO_INVALID",
                    "display %r 的 round_to=%r 必须等于 text 的小数位数 %d"
                    % (text, round_to, decimal_places(text)),
                    {"display": repr(text), "round_to": repr(round_to),
                     "decimals": str(decimal_places(text))}))
    return out
