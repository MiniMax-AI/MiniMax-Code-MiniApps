# -*- coding: utf-8 -*-
"""用户正文内容的换行保真读写。

事项约定：**保存必须逐字保留正文内容**——用户正文（论文正文 `.tex`、
参考文献 `.bib`、事实账、项目声明、术语表）里的任何字符，**包括行尾**，
都不许被保存链路改写。

Windows 上默认文本模式两头都动手：

* **写**：`newline=None`（默认）时，任何 `'\n'` 都被翻译成 `os.linesep`
  （Windows 上是 `'\r\n'`）；已经存在的 `'\r\n'` 会被写成
  `'\r\r\n'`——CR 被复制，是内容损坏。
* **读**：`newline=None`（默认）时做通用换行翻译（universal newlines），
  `'\r\n'` 被读成 `'\n'`。于是「读入 → 编辑 → 写回」跑一遍，正文的
  行尾就被悄悄换掉了——这同样违反「逐字保留」。

这里统一收口：

* **读**用 `newline=""`：不做任何换行翻译，`'\r\n'` 原样留在字符串里；
* **写**用 `newline=""`：不翻译，`'\n'` 就是 `'\n'`，`'\r\n'` 就是
  `'\r\n'`。

换行交还给人：文件里原本是什么行尾，写回还是什么行尾，一个字符不多、
一个字符不少。

机器产物（JSON 报告、审计矩阵、证据锁、清单 manifest、日志……）**不用**
这一套——它们是工具自己生成、自己消费，格式由工具定，行尾统一成 `'\n'`
反而更可预期。哪些算「用户内容」、划分依据见
`docs/design/SPEC-V3.0.md` 与本次修复的交付报告。
"""
from __future__ import annotations

from difflib import SequenceMatcher
from pathlib import Path

__all__ = [
    "read_text_exact",
    "write_text_exact",
    "append_text_exact",
    "split_keepends",
    "split_lines",
    "dominant_newline",
    "to_lf",
    "restore_newlines",
]


def read_text_exact(path: Path | str, errors: str | None = None) -> str:
    """按原样读文本：不做通用换行翻译，`'\r\n'` 原样保留。

    与 `Path.read_text()` 的差别只有一处——换行。其它行为一致：
    按 UTF-8 解码（非 UTF-8 抛 `UnicodeDecodeError`，读不动抛
    `OSError`），不剥离 BOM，不动末尾换行。

    `errors` 透传给 `open()`：`"replace"` 时坏字节换成 U+FFFD，
    与 `Path.read_text(errors="replace")` 行为一致。
    """
    with open(path, "r", encoding="utf-8", newline="", errors=errors) as handle:
        return handle.read()


def write_text_exact(path: Path | str, text: str) -> None:
    """按原样写文本：`'\n'` 不翻译成 `'\r\n'`，`'\r\n'` 不变成
    `'\r\r\n'`。写出去的字节与传进来的字符串逐字节对应。"""
    with open(path, "w", encoding="utf-8", newline="") as handle:
        handle.write(text)


def append_text_exact(path: Path | str, text: str,
                     newline: str | None = None) -> None:
    """按原样追加文本：不翻译换行。

    `newline` 给定时用它当行尾（`'\r\n'` / `'\n'` / `'\r'`），
    追加进去的每一行都带这个行尾；不给时原样追加（调用方自己保证文本里
    的行尾已经对）。

    Windows 上默认文本模式（`newline=None`）会把追加的 `'\n'` 翻译成
    `'\r\n'`——一份 LF 账本会被追写成一半 LF 一半 CRLF 的混合行尾。
    """
    with open(path, "a", encoding="utf-8", newline="") as handle:
        if newline is None:
            handle.write(text)
        else:
            handle.write(text.replace("\r\n", "\n").replace("\r", "\n")
                          .replace("\n", newline))


def to_lf(text: str) -> str:
    """把 `'\r\n'` / `'\r'` 归一成 `'\n'`——**分析层**专用。

    为什么需要它：读盘侧一律按原样读（`read_text_exact`），正文里的
    `'\r\n'` 原样留在字符串里。可分析层（审计、闸门、文风、数号抽取）
    是**按行**做事的，它假设 `'\n'` 是行分隔符，正则里也用 `$` 锚行尾。
    若把带 `'\r\n'` 的文本直接丢进去，行尾会多出一个 `'\r'`，`$`
    锚点会失配、发现条数会漂。

    所以边界要显式：`.textio` 只负责「读进来不丢字节」，**分析入口**调
    这条把行尾归一——归一的是**内存里的副本**，磁盘上的字节一个不动。
    """
    return text.replace("\r\n", "\n").replace("\r", "\n")


def split_lines(text: str) -> list[str]:
    """按行切开，行尾（CRLF／CR／LF）都不带进行内容。

    等价于「先 `to_lf` 再 `split('\n')`」，但只切 `'\r\n'`/`'\r'`/
    `'\n'` 三种行尾——不像 `str.splitlines()` 那样把 `'\x0b'`、
    `'\x0c'`、`'\u2028'` 也当行尾切。
    """
    return to_lf(text).split("\n")


def split_keepends(text: str) -> list[tuple[str, str]]:
    """把文本切成 `[(行内容, 行尾), ...]`，行尾**原样保留**。

    `str.splitlines()` 会把行尾吃掉——重建时行尾就丢了（CRLF 的文件会被
    悄悄改成 LF）。这里把行尾单独摘出来，改哪一行都不影响其它行的行尾。
    """
    out: list[tuple[str, str]] = []
    index = 0
    size = len(text)
    while index < size:
        stop = index
        while stop < size and text[stop] not in "\r\n":
            stop += 1
        if stop >= size:
            out.append((text[index:stop], ""))
            break
        if text[stop] == "\r" and stop + 1 < size and text[stop + 1] == "\n":
            end = stop + 2
        else:
            end = stop + 1
        out.append((text[index:stop], text[stop:end]))
        index = end
    return out


def dominant_newline(text: str, default: str = "\n") -> str:
    """文本里占多数的行尾（`'\r\n'` / `'\n'` / `'\r'`）。

    追加内容时用它做新行的行尾：CRLF 的文件补进去的也是 CRLF，不会补出
    一份混合行尾的文件。一行行尾都没有时用 `default`。
    """
    crlf = text.count("\r\n")
    lf = text.count("\n") - crlf
    cr = text.count("\r") - crlf
    best = max(crlf, lf, cr)
    if best <= 0:
        return default
    if crlf == best:
        return "\r\n"
    if lf == best:
        return "\n"
    return "\r"


def restore_newlines(new_text: str, original: str,
                     fallback: str | None = None) -> str:
    r"""把 `new_text` 的行尾还原成 `original` 里各行**原有**的行尾。

    为什么需要它：编辑器交回来的正文恒是 LF——浏览器按 HTML 规范把
    `<textarea>` 的 API value 与 contenteditable 的 textContent 一律归一
    成 LF。若照单写回，CRLF 稿子存一次就变成 LF，或者变成一半 CRLF 一半
    LF 的混合稿子，违反「保存必须逐字保留正文内容」。

    口径（**只动行尾，不动一个字的内容**）：

    * `original` 是这一块**落盘原文**（按原样读，行尾原样）；
    * `new_text` 是客户端交回的新正文；
    * 与原文**逐行对得上**的行 → 用原文那一行的行尾（原文是混合行尾时，
      哪一行原本是 CRLF，改完还是 CRLF，一行不差）；
    * 内容改过时按**行内容**对齐（SequenceMatcher），把原文那一行的行尾
      还给对应的新行；用户**新输入**的行 → 用 fallback（缺省是该块的主导
      行尾 `dominant_newline(original)`）；
    * 客户端自己明确给了 CRLF/CR 的行 → **原样保留**（那是调用方的显式
      意图，这里一个字都不许改写）；
    * 换行的**个数**只由客户端那份文本决定：还原只改风格，不改个数；
    * 没有原文可依（`original` 为空——新建的块／草稿块）→ 全部用
      fallback（调用方给的是**文件**的主导行尾）。

    original 是**这一块**的原文（不是整份文件）：块的行尾归这一块自己
    管，块外的行尾一个都不碰。
    """
    old = split_keepends(original)
    new = split_keepends(new_text)
    if not new:
        return new_text
    extra = fallback or dominant_newline(original)
    old_content = [content for content, _ending in old]
    new_content = [content for content, _ending in new]
    inherited: dict[int, str] = {}
    if old and old_content == new_content:
        # 最常见的一档：内容一个字没改（浏览器归一了行尾而已）——逐行照旧。
        for index, (_content, ending) in enumerate(old):
            inherited[index] = ending
    elif old:
        # 内容改过：按行内容对齐，把原文那一行的行尾还给对应的新行。
        matcher = SequenceMatcher(a=old_content, b=new_content, autojunk=False)
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                for offset in range(j2 - j1):
                    inherited[j1 + offset] = old[i1 + offset][1]
            elif tag == "replace":
                # 改写掉的行：按位置继承原文那一行的行尾；多出来的新行走主导行尾。
                for offset in range(min(i2 - i1, j2 - j1)):
                    inherited[j1 + offset] = old[i1 + offset][1]
    out: list[str] = []
    for index, (content, ending) in enumerate(new):
        if ending == "":
            # 最后一行本来就没有行尾——没什么可还原的。
            out.append(content)
            continue
        if ending != "\n":
            # 客户端明确给了 CRLF/CR：那是调用方的显式意图，一个字符都不动。
            out.append(content + ending)
            continue
        target = inherited.get(index) or extra
        out.append(content + target)
    return "".join(out)
