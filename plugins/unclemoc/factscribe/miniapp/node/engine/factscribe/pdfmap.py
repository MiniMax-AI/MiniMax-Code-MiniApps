# -*- coding: utf-8 -*-
"""把「当前节」映射到编译后 PDF 的页码。

LaTeX 只会整篇编译，单节编译缺前言区与交叉引用，不可信。所以预览的做法是：
整篇编译 → 用 pdftotext 抽文本 → 找到这一节标题出现在第几页 → 预览翻到那一页。

这里只做纯文本判断，不碰 PDF 结构；页码从 1 开始。
"""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

_TOC_HINT = re.compile(r"(目录|Contents)", re.IGNORECASE)
_DOT_LEADER = re.compile(r"\.{4,}")
_SPACE = re.compile(r"\s+")
_CMD = re.compile(r"\\[a-zA-Z@]+\*?")
_BRACE = re.compile(r"[{}]")
_DOLLAR = re.compile(r"\$+")


def section_title(tex: str) -> str:
    """从一节 tex 里取第一个 ``\\section{...}`` 的标题（去命令、去花括号）。"""
    text = str(tex or "")
    start = text.find("\\section")
    while start >= 0:
        i = start + len("\\section")
        if text.startswith("*", i):
            i += 1
        while i < len(text) and text[i] in " \t\r\n":
            i += 1
        if i < len(text) and text[i] == "{":
            depth = 0
            for j in range(i, len(text)):
                if text[j] == "{":
                    depth += 1
                elif text[j] == "}":
                    depth -= 1
                    if depth == 0:
                        raw = text[i + 1:j]
                        return _plain(raw)
        start = text.find("\\section", start + 1)
    return ""


def _plain(raw: str) -> str:
    text = _CMD.sub(" ", raw)
    text = _BRACE.sub(" ", text)
    text = _DOLLAR.sub(" ", text)
    text = text.replace("~", " ").replace("\\", " ")
    return _SPACE.sub(" ", text).strip()


def split_pages(text: str) -> list[str]:
    """pdftotext 用 \\f 分页；返回每页文本（保持顺序）。"""
    return str(text or "").split("\f")


def _norm(text: str) -> str:
    return _SPACE.sub("", str(text or "")).casefold()


def pick_page(pages: list[str], title: str) -> int:
    """标题所在页码（1 基）。找不到返回 0。

    跳过目录页与带点导引的目录行，避免翻到目录而不是正文。
    """
    needle = _norm(title)
    if not needle:
        return 0
    first = 0
    for number, page in enumerate(pages, 1):
        if not page or needle not in _norm(page):
            continue
        if _TOC_HINT.search(page) and _DOT_LEADER.search(page):
            continue
        if _DOT_LEADER.search(page) and page.find(title) >= 0:
            continue
        if first == 0:
            first = number
    return first


def locate(pdf: Path, title: str, timeout: int = 30) -> dict:
    """调 pdftotext 把整本 PDF 拆页，返回 {page, pages, found, title}。

    pdftotext 缺失时抛 FileNotFoundError（由调用方翻译成 400）。
    """
    binary = shutil.which("pdftotext")
    if not binary:
        raise FileNotFoundError("pdftotext")
    proc = subprocess.run([binary, "-layout", str(pdf), "-"],
                          capture_output=True, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or b"").decode("utf-8", "replace").strip()
                           or "pdftotext 退出码 %d" % proc.returncode)
    pages = split_pages(proc.stdout.decode("utf-8", "replace"))
    page = pick_page(pages, title)
    return {"page": page or 1, "pages": len(pages), "found": bool(page),
            "title": title}
