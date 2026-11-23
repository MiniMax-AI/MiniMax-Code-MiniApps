# -*- coding: utf-8 -*-
"""project.build 为空时的自动编译：用本机 tectonic 编 main.tex。

设计见 docs/design/SPEC-BUILD.md。要点：

* 只在 tempfile.mkdtemp() 下的**项目副本**里编译，项目目录只落最终 PDF；
* 中文（ctexart + fontset=fandol）第一次编失败时，只改临时副本：
  fontset=none + 插 CJK 字体行，再试一次；
* 字体优先用本地缓存的 Fandol（见 SPEC-FONTS.md）；缓存缺失才退回系统字体。
* 纯标准库；子进程只调 tectonic 与 fc-match。
"""
from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
import zlib
from pathlib import Path

from . import fonts as fontcache
from .constants import EXIT_CONFIG, EXIT_INTERNAL, EXIT_MISSING, EXIT_OK

TIMEOUT_SECONDS = 600
TAIL_LINES = 20
FONT_ERROR_MARKERS = ("fontset", "could not be found", "fontspec error")

_FONTSET_RE = re.compile(r"fontset\s*=\s*[A-Za-z0-9_\-]+")
_DOCCLASS_RE = re.compile(r"^[^\n]*\\documentclass[^\n]*$", re.MULTILINE)
_PAGE_OBJ_RE = re.compile(rb"/Type\s*/Page(?![s])")
_PAGE_COUNT_RE = re.compile(rb"/Count\s+(\d+)")
_STREAM_RE = re.compile(rb"stream\r?\n")


def _count_in(blob: bytes) -> int:
    hits = _PAGE_OBJ_RE.findall(blob)
    if hits:
        return len(hits)
    counts = [int(x) for x in _PAGE_COUNT_RE.findall(blob)]
    return max(counts) if counts else 0


def pdf_page_count(data: bytes) -> int:
    """从 PDF 字节里数页数（纯标准库）。

    先看明文；PDF 1.5 起页对象常压在 FlateDecode 流里（tectonic 的 XeTeX
    输出就是），此时逐个解压流再数 /Type /Page 或 /Count。
    """
    count = _count_in(data)
    if count:
        return count
    for match in _STREAM_RE.finditer(data):
        start = match.end()
        end = data.find(b"endstream", start)
        if end <= start:
            continue
        try:
            blob = zlib.decompress(data[start:end])
        except zlib.error:
            continue
        count = _count_in(blob)
        if count:
            return count
    return 0


def _insert_after_documentclass(patched: str, lines: list[str]) -> str:
    match = _DOCCLASS_RE.search(patched)
    if match is None:
        raise ValueError("main.tex 里找不到 \\documentclass 行，无法注入 CJK 字体")
    block = "\n" + "\n".join(lines)
    return patched[:match.end()] + block + patched[match.end():]


def rewrite_cjk_font(text: str, font_file: Path) -> str:
    """把 fontset=<值> 换成 none，并在 \\documentclass 行后插系统 CJK 字体行。"""
    patched, _count = _FONTSET_RE.subn("fontset=none", text)
    line = "\\setCJKmainfont[Path=%s,BoldFont=%s]{%s}" % (
        font_file.parent.as_posix().rstrip("/") + "/",
        font_file.name, font_file.name)
    return _insert_after_documentclass(patched, [line])


def _fandol_opts(directory: Path, name: str, bold: str | None = None) -> str:
    opts = ["Path=%s/" % directory.as_posix().rstrip("/")]
    if bold and (directory / bold).is_file():
        opts.append("BoldFont=%s" % bold)
    return "[%s]{%s}" % (",".join(opts), name)


def rewrite_cjk_font_fandol(text: str, directory: Path) -> str:
    """fontset=none + Fandol 四条注入（宋/黑/仿/楷）。"""
    patched, _count = _FONTSET_RE.subn("fontset=none", text)
    lines = [
        "\\setCJKmainfont" + _fandol_opts(
            directory, "FandolSong-Regular.otf", "FandolSong-Bold.otf"),
        "\\setCJKsansfont" + _fandol_opts(
            directory, "FandolHei-Regular.otf", "FandolHei-Bold.otf"),
        "\\setCJKmonofont" + _fandol_opts(
            directory, "FandolFang-Regular.otf"),
        "\\setCJKfamilyfont{zhkai}" + _fandol_opts(
            directory, "FandolKai-Regular.otf"),
    ]
    return _insert_after_documentclass(patched, lines)


def find_fandol_fonts() -> Path | None:
    """缓存完整时返回 Fandol 目录，否则 None。"""
    directory = fontcache.cache_dir()
    return directory if fontcache.is_complete(directory) else None


def _fc_match(query: str) -> Path | None:
    fc = shutil.which("fc-match")
    if fc is None:
        return None
    try:
        proc = subprocess.run([fc, "-f", "%{file}", query],
                              capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    out = (proc.stdout or "").strip()
    if proc.returncode != 0 or not out:
        return None
    path = Path(out)
    return path if path.is_file() else None


def find_cjk_font(explicit: str | None = None) -> Path | None:
    """按 --cjk-font → fc-match STHeiti → fc-match "Heiti SC" 找字体文件。"""
    if explicit:
        path = Path(explicit).expanduser()
        return path if path.is_file() else None
    for query in ("STHeiti", "Heiti SC"):
        path = _fc_match(query)
        if path is not None:
            return path
    return None


def _tail(text: str) -> str:
    return "\n".join(text.splitlines()[-TAIL_LINES:])


def _run_engine(exe: str, work: Path, tex_name: str) -> tuple[int, str]:
    try:
        proc = subprocess.run([exe, "-X", "compile", tex_name],
                              cwd=str(work), capture_output=True, text=True,
                              timeout=TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        return -1, "构建超时（%d 秒）被终止" % TIMEOUT_SECONDS
    except OSError as exc:
        return -1, "启动引擎失败：%s" % exc
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def _is_font_error(output: str) -> bool:
    lowered = output.lower()
    return any(marker in lowered for marker in FONT_ERROR_MARKERS)


def auto_build(root: Path, output: str = "main.pdf",
               engine: str = "tectonic", cjk_font: str | None = None,
               keep_temp: bool = False,
               root_tex: str = "main.tex") -> tuple[int, str, dict]:
    """自动编译；返回 (退出码, 人读文本, 机器可读信息)。"""
    info: dict = {
        "engine": None,
        "engine_requested": engine,
        "attempts": [],
        "pdf_path": None,
        "pdf_bytes": 0,
        "pdf_pages": 0,
        "temp_dir": None,
    }
    tex = root / root_tex
    if not tex.is_file():
        return EXIT_CONFIG, ("自动编译需要 %s，但项目里没有这个文件：%s"
                             % (root_tex, tex)), info

    exe = shutil.which(engine)
    if exe is None:
        return EXIT_MISSING, (
            "PDF_TOOL_MISSING：本机找不到 %s——不静默跳过。\n"
            "装好 tectonic，或用 --engine 给出可执行文件路径。" % engine), info
    info["engine"] = exe

    base = Path(tempfile.mkdtemp(prefix="factscribe-build-"))
    info["temp_dir"] = str(base)
    work = base / "project"
    try:
        shutil.copytree(root, work, symlinks=True,
                        ignore=shutil.ignore_patterns(
                            ".git", ".venv", "__pycache__", "*.pyc"))
        rc, out = _run_engine(exe, work, tex.name)
        info["attempts"].append({"attempt": 1, "mode": "direct",
                                 "returncode": rc, "ok": rc == 0})

        if rc != 0 and _is_font_error(out):
            target = work / tex.name
            # 显式 --cjk-font 优先（用户点名）；否则缓存完整用 Fandol，
            # 缓存缺失才退回 fc-match 的系统字体。
            font = find_cjk_font(cjk_font) if cjk_font else None
            fandol_dir = None if cjk_font else find_fandol_fonts()
            if cjk_font and font is None:
                info["attempts"].append({
                    "attempt": 2, "mode": "temp-cjk-font",
                    "returncode": None, "ok": False,
                    "error": "--cjk-font 指向的文件不存在"})
                return EXIT_INTERNAL, (
                    "字体兜底失败：--cjk-font 指定的文件不存在：%s\n%s"
                    % (cjk_font, _tail(out))), info
            if font is not None:
                patched = rewrite_cjk_font(
                    target.read_text(encoding="utf-8"), font)
                info["font_source"] = "system"
                info["cjk_font"] = str(font)
                mode = "temp-cjk-font"
            elif fandol_dir is not None:
                patched = rewrite_cjk_font_fandol(
                    target.read_text(encoding="utf-8"), fandol_dir)
                info["font_source"] = "fandol"
                info["font_dir"] = str(fandol_dir)
                mode = "temp-fandol-font"
            else:
                font = find_cjk_font(None)
                if font is None:
                    info["attempts"].append({
                        "attempt": 2, "mode": "temp-cjk-font",
                        "returncode": None, "ok": False,
                        "error": "CJK 字体未找到（Fandol 缓存缺失）"})
                    return EXIT_INTERNAL, (
                        "字体兜底失败：Fandol 缓存缺失，系统 CJK 字体也未找到"
                        "（先跑 `python3 -m factscribe fonts --fetch`，"
                        "或试 --cjk-font <路径>）。\n%s" % _tail(out)), info
                patched = rewrite_cjk_font(
                    target.read_text(encoding="utf-8"), font)
                info["font_source"] = "system"
                info["cjk_font"] = str(font)
                mode = "temp-cjk-font"
            target.write_text(patched, encoding="utf-8")
            rc, out = _run_engine(exe, work, tex.name)
            info["attempts"].append({
                "attempt": 2, "mode": mode, "returncode": rc,
                "ok": rc == 0, "font_source": info["font_source"]})

        if rc != 0:
            return EXIT_INTERNAL, (
                "编译失败：引擎退出码 %d\n%s" % (rc, _tail(out))), info

        produced = work / (tex.stem + ".pdf")
        if not produced.is_file():
            return EXIT_INTERNAL, (
                "编译退出码 0，但没有产出 %s\n%s"
                % (produced.name, _tail(out))), info

        target = root / output
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(produced, target)
        data = target.read_bytes()
        pages = pdf_page_count(data)
        info.update(pdf_path=str(target), pdf_bytes=len(data),
                    pdf_pages=pages)
        lines = [
            "引擎：%s" % exe,
            "尝试：%d 次" % len(info["attempts"]),
            "产出：%s（%d 页，%d 字节）" % (target, pages, len(data)),
        ]
        if info.get("font_source") == "fandol":
            lines.append("字体：Fandol（%s）" % info.get("font_dir"))
        elif info.get("font_source") == "system":
            lines.append("字体：系统兜底 %s——用了系统字体，未用 Fandol"
                         % info.get("cjk_font"))
            lines.append("提示：跑 `python3 -m factscribe fonts --fetch` "
                         "下载 Fandol 后重编，版式与 Overleaf 一致")
        if keep_temp:
            lines.append("临时副本保留在：%s" % base)
        else:
            info["temp_dir"] = None
        return EXIT_OK, "\n".join(lines), info
    finally:
        if not keep_temp:
            shutil.rmtree(base, ignore_errors=True)
