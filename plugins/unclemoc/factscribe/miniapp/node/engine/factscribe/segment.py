# -*- coding: utf-8 -*-
"""中文分词底座（纯标准库）。

规范见 ``docs/design/SPEC-SEGMENT.md``：

* 词表 ``terms/seg.tsv.gz``，三列 ``词 词频 词性``，UTF-8；
* 中文段做正向最大概率切分（单次匹配上限 10 字），非中文段原样保留；
* ``segment(text)`` 返回 ``[(token, start, end, pos)]``；
* ``load()`` 惰性加载、进程内缓存。

它只服务 ``style`` 的中文判据（`ZH_LIGHT_VERB_NOUN`），不参与
``audit`` 的数字/引用链路，也不引入任何第三方依赖。
"""
from __future__ import annotations

import gzip
import math
from pathlib import Path

MAX_WORD = 10

# 中文段：扩展 A、基本区、兼容区。只用来判断「要不要查词表」。
_CJK_RANGES = (
    ("\u3400", "\u4dbf"),
    ("\u4e00", "\u9fff"),
    ("\uf900", "\ufaff"),
)

_TERMS_FILE = Path(__file__).resolve().parent / "terms" / "seg.tsv.gz"

# 进程内缓存：路径 -> (词表, 总词频, LOG(总词频))
_CACHE_PATH: Path | None = None
_CACHE_DICT: dict[str, tuple[int, str]] | None = None
_CACHE_TOTAL: int = 0
_CACHE_LOG_TOTAL: float = 0.0


class SegmentError(ValueError):
    """词表格式错误或不可读。宁可报错，不静默跳过。"""


def _is_cjk(ch: str) -> bool:
    for low, high in _CJK_RANGES:
        if low <= ch <= high:
            return True
    return False


def load(path=None) -> dict[str, tuple[int, str]]:
    """加载词表；同一路径第二次调用直接返回缓存。

    ``path`` 缺省为包内 ``terms/seg.tsv.gz``。返回 ``词 -> (词频, 词性)``。
    列数不对、词频不是正整数、词性为空都按 ``SegmentError`` 抛出。
    """
    global _CACHE_PATH, _CACHE_DICT, _CACHE_TOTAL, _CACHE_LOG_TOTAL
    resolved = Path(path) if path is not None else _TERMS_FILE
    resolved = resolved.expanduser().resolve()
    if _CACHE_DICT is not None and _CACHE_PATH == resolved:
        return _CACHE_DICT
    if not resolved.is_file():
        raise SegmentError("分词词表不存在：%s" % resolved)

    table: dict[str, tuple[int, str]] = {}
    total = 0
    try:
        with gzip.open(resolved, "rt", encoding="utf-8") as handle:
            for lineno, line in enumerate(handle, 1):
                line = line.rstrip("\r\n")
                if not line:
                    continue
                parts = line.split(" ")
                if len(parts) != 3:
                    raise SegmentError(
                        "分词词表第 %d 行列数不是 3：%r" % (lineno, line))
                word, raw_freq, pos = parts
                if not word or not pos:
                    raise SegmentError(
                        "分词词表第 %d 行缺词或缺词性：%r" % (lineno, line))
                try:
                    freq = int(raw_freq)
                except ValueError:
                    raise SegmentError(
                        "分词词表第 %d 行词频不是整数：%r" % (lineno, line))
                if freq <= 0:
                    raise SegmentError(
                        "分词词表第 %d 行词频必须为正：%r" % (lineno, line))
                total += freq
                old = table.get(word)
                # 重复词条（源表只有 B超）：按词频取高；同频按词性字典序，
                # 不依赖文件遍历顺序。
                if old is None or (freq, pos) > (old[0], old[1]):
                    table[word] = (freq, pos)
    except (OSError, EOFError) as exc:
        raise SegmentError("分词词表读取失败：%s（%s）" % (resolved, exc))
    if not table or total <= 0:
        raise SegmentError("分词词表为空：%s" % resolved)

    _CACHE_PATH = resolved
    _CACHE_DICT = table
    _CACHE_TOTAL = total
    _CACHE_LOG_TOTAL = math.log(total)
    return table


def _segment_run(text: str, start: int, end: int,
                 table: dict[str, tuple[int, str]]) -> list[tuple]:
    """对一个纯中文段做最大概率切分。返回 (token, start, end, pos)。"""
    length = end - start
    # best[k] = (score, token_len, token, pos)；k 是段内相对下标。
    best: list[tuple | None] = [None] * (length + 1)
    best[length] = (0.0, 0, "", "")
    log_total = _CACHE_LOG_TOTAL
    unknown = -log_total          # log(1 / total)
    for k in range(length - 1, -1, -1):
        candidates = []
        limit = min(MAX_WORD, length - k)
        for size in range(1, limit + 1):
            token = text[start + k:start + k + size]
            entry = table.get(token)
            if entry is None:
                continue
            score = math.log(entry[0]) - log_total + best[k + size][0]
            candidates.append((score, size, token, entry[1], entry[0]))
        if not candidates:
            # 未登录字：只能单字，固定低分。
            candidates.append((unknown + best[k + 1][0], 1,
                               text[start + k], "", 1))
        # 分数高优先；同分取较长；再同长取词频高；最后按词面定序。
        candidates.sort(key=lambda x: (-x[0], -x[1], -x[4], x[2]))
        score, size, token, pos, _freq = candidates[0]
        best[k] = (score, size, token, pos)

    out = []
    k = 0
    while k < length:
        _score, size, token, pos = best[k]
        out.append((token, start + k, start + k + size, pos))
        k += size
    return out


def segment(text: str, path=None) -> list[tuple[str, int, int, str]]:
    """切分 ``text``，返回 ``[(token, start, end, pos)]``。

    ``start`` / ``end`` 是相对 ``text`` 的字符下标，``text[start:end]``
    恒等于 ``token``。英文、数字、标点与空白连续成块原样保留，词性为空。
    """
    if not text:
        return []
    table = load(path)
    out: list[tuple[str, int, int, str]] = []
    i = 0
    n = len(text)
    while i < n:
        if _is_cjk(text[i]):
            j = i + 1
            while j < n and _is_cjk(text[j]):
                j += 1
            out.extend(_segment_run(text, i, j, table))
            i = j
        else:
            j = i + 1
            while j < n and not _is_cjk(text[j]):
                j += 1
            out.append((text[i:j], i, j, ""))
            i = j
    return out
