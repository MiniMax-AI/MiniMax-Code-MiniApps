# -*- coding: utf-8 -*-
"""value 硬校验：这条数字必须能在它所指的产物原文里命中。

铁律（账上没有的数字不得编造）：事实的 value 是「正文要绑的那个数字原文」
——它必须真的出现在它指向的那件产物里。不在，就是编的。

判定口径（代码与文档同源；改这里就要同步改
docs/MINIAPP-PAPER-ALIGNMENT-GAPS-20261122.md 与验收报告）：

1. 产物必须是文本：UTF-8 解不开（二进制／别的编码）→ 拒
   （VALUE_SOURCE_NOT_TEXT）。宁可拒，也不「大概对」。
2. 两侧同一条归一化（NFKC 之后）：
   - LaTeX 的百分号（反斜杠 + %）→ %；
   - LaTeX 的分数命令（frac / tfrac / dfrac）→ A/B；
   - 去掉强调标记 * 与反引号（**90,431** → 90,431）；
   - 千分位逗号（3 位一组）去掉：1,234 → 1234；
   - 窄空格／不换行空格当千分位去掉；
   - 小数点逗号（2 位）→ 小数点：56,25 → 56.25。
3. 抽数字项：带符号的数字（可带千分位与小数部分），紧跟 % 的记成百分号项。
   数值按十进制比：03 == 3、1,234 == 1234。
4. 比对：
   - value 里有数字项 → 这些数字项必须能按出现顺序在产物的数字项序列里
     找到（子序列匹配；数值相等、百分号一致）。
     单位不参与比较：产物写「16 instances」、value 写「16」也算命中
     （单位写法千差万别，比它只会制造假拒绝）。
   - value 里没有数字项（纯文字，例如「请求体里搜不到 _asciidoc_row」）
     → 归一化后的 value 必须是产物文本的子串。
5. 拿不准就拒：找不到就报「哪些数字没找到」，不放过、不模糊过关。

本模块只做纯计算（不读盘、不写盘）：读盘与报错在
factscribe/scaffold.py::check_value_in_source。
"""
from __future__ import annotations

import re
import unicodedata
from decimal import Decimal, InvalidOperation

#: 反斜杠（源码里不直接写，免得正则里的转义看花眼）。
BS = chr(92)

#: 归一化规则（写在这里，测试与文档都照它抄）。
NORMALIZE_RULES = (
    "NFKC",
    "LaTeX 百分号 → %",
    "LaTeX 分数命令 → A/B",
    "去掉强调标记 * 与反引号",
    "千分位逗号（3 位一组）去掉",
    "窄空格当千分位去掉",
    "小数点逗号（2 位）→ 小数点",
)

_FRAC_RE = re.compile(BS + r"[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}")
_THOUSANDS_COMMA_RE = re.compile(r"(?<=\d),(?=\d{3}(?!\d))")
_DECIMAL_COMMA_RE = re.compile(r"(?<=\d),(\d{2})(?!\d)")
_NARROW_SPACE_RE = re.compile(r"(?<=\d)[\u00a0\u2009\u202f](?=\d{3}(?!\d))")
_NUMBER_RE = re.compile(r"[+-]?\d[\d,]*(?:\.\d+)?\s*%?")


def normalize(text: str) -> str:
    """两侧同一条归一化（见模块文档第 2 条）。"""
    out = unicodedata.normalize("NFKC", str(text or ""))
    out = _FRAC_RE.sub(r"\1/\2", out)
    out = out.replace(BS + "%", "%")
    out = out.replace("*", "").replace("`", "")
    out = _THOUSANDS_COMMA_RE.sub("", out)
    out = _NARROW_SPACE_RE.sub("", out)
    out = _DECIMAL_COMMA_RE.sub(r".\1", out)
    return out


def _collapse(text: str) -> str:
    """纯文字比对用的形态：空白并成单个空格。"""
    return re.sub(r"\s+", " ", str(text or "")).strip()


def numeric_items(text: str) -> list:
    """文本里的数字项：{"num": Decimal, "percent": bool, "raw": str}。"""
    out = []
    for match in _NUMBER_RE.finditer(normalize(text)):
        raw = match.group(0)
        percent = "%" in raw
        core = raw.replace("%", "").replace(" ", "")
        if not core:
            continue
        try:
            num = Decimal(core)
        except InvalidOperation:
            continue
        out.append({"num": num, "percent": percent, "raw": raw.strip()})
    return out


def _same(left: dict, right: dict) -> bool:
    return left["percent"] == right["percent"] and left["num"] == right["num"]


def _match_in_order(items: list, pool: list) -> tuple:
    """items 能不能按顺序在 pool 里找到（子序列匹配）。

    返回 (是否全找到, 没找到的那些原文)。贪心取最早的位置——存在性判定上
    贪心就是最优的。
    """
    index = 0
    missing = []
    for item in items:
        found_at = -1
        probe = index
        while probe < len(pool):
            if _same(item, pool[probe]):
                found_at = probe
                break
            probe += 1
        if found_at < 0:
            # 没找到：游标**不动**——后面那些项继续往后找，
            # 别把「其实有」的数字也报成没有。
            missing.append(item["raw"])
            continue
        index = found_at + 1
    return (not missing), missing


def check_value_in_source(value: str, source_text: str) -> dict:
    """value 能不能在产物原文里命中。

    返回 {"ok", "mode", "missing", "value", "items"}：
    mode 是 numbers（按数字项比）或 text（按归一化子串比）。
    """
    raw_value = str(value or "").strip()
    value_items = numeric_items(raw_value)
    if value_items:
        pool = numeric_items(source_text)
        ok, missing = _match_in_order(value_items, pool)
        return {"ok": ok, "mode": "numbers", "missing": missing,
                "value": raw_value,
                "items": [item["raw"] for item in value_items]}
    haystack = _collapse(normalize(source_text))
    needle = _collapse(normalize(raw_value))
    ok = bool(needle) and needle in haystack
    return {"ok": ok, "mode": "text",
            "missing": [] if ok else [raw_value],
            "value": raw_value, "items": []}
