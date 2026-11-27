# -*- coding: utf-8 -*-
"""图片资产：盘里那张图要能真的看见（只读通道）。

从旧节级网页前端搬过来（那边在 `factscribe/serve.py::_asset()`，给了一条
`/api/asset` 只读通道；预览要能看见 `\\includegraphics{figs/a.png}`）。
搬到这里后**规则不变**：

* 路径必须留在盘根里：`..`、绝对路径、软链、目录一律拒；
* 只放行图片与 PDF；单个文件不超过 20 MiB；
* PDF 交给 pdftoppm 转第一页 PNG 再返回（本机没有 poppler 就明说）。

另加一条清单（:func:`list_assets`）：把盘里的图片列出来，前端画缩略图用。
清单与取字节走同一套路径闸——列出来的路径一定能取到，取不到的不列。
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

#: 预览要能真的看见论文里的图：只放行这些扩展名，其余一律 ASSET_INVALID。
ASSET_CONTENT_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
}

#: 单个文件的上限：20 MiB。超了就是 400，不给读。
ASSET_MAX_BYTES = 20 * 1024 * 1024

#: 清单接口的三个上限：目录深度、条数、单文件大小。
LIST_MAX_DEPTH = 6
LIST_MAX_ITEMS = 300
LIST_MAX_BYTES = 20 * 1024 * 1024

#: 遍历时跳过的目录（版本库与构建中间物，不进清单）。
SKIP_DIRS = {"node_modules", "venv", ".venv", "__pycache__"}


class AssetError(Exception):
    """资产通道的失败：`code` 给机器看（HTTP 状态跟着 `status`）。"""

    def __init__(self, message: str, code: str = "ASSET_INVALID",
                 status: int = 400):
        super().__init__(message)
        self.code = code
        self.status = status


def _safe_target(root: Path, rel: str) -> Path:
    """把相对路径落到盘根里；越界、软链、绝对路径一律拒。"""
    root = Path(root).resolve()
    text = str(rel or "").strip().replace("\\", "/")
    if not text:
        raise AssetError("path 不能为空")
    if text.startswith("/") or os.path.isabs(text) or (len(text) > 1 and text[1] == ":"):
        raise AssetError("path 必须是盘内的相对路径：%s" % text,
                         code="PATH_ESCAPE")
    if any(part == ".." for part in text.split("/")):
        raise AssetError("path 不许带 ..：%s" % text, code="PATH_ESCAPE")
    # 软链一律不给：项目里可能指着项目外的东西。
    walk = root
    for part in text.split("/"):
        if not part:
            continue
        walk = walk / part
        if walk.is_symlink():
            raise AssetError("不接受软链：%s" % text, code="PATH_ESCAPE")
    target = root / text
    try:
        target.resolve().relative_to(root)
    except (ValueError, OSError):
        raise AssetError("路径越出盘根：%s" % text, code="PATH_ESCAPE")
    return target


def read_asset(root: Path, rel: str) -> tuple[bytes, str]:
    """读盘里的一张图（只读）。返回 `(字节, Content-Type)`。

    PDF 走 pdftoppm 转第一页 PNG——浏览器不认 PDF 的第一页，这里只给预览用。
    """
    target = _safe_target(root, rel)
    suffix = target.suffix.lower()
    if suffix not in ASSET_CONTENT_TYPES:
        raise AssetError("只支持图片与 PDF：%s" % (suffix or rel))
    if not target.exists():
        raise AssetError("文件不存在：%s" % rel, code="ASSET_NOT_FOUND",
                         status=404)
    if not target.is_file():
        raise AssetError("不是普通文件：%s" % rel)
    try:
        size = target.stat().st_size
    except OSError:
        raise AssetError("文件读不了：%s" % rel, code="ASSET_NOT_FOUND",
                         status=404)
    if size > ASSET_MAX_BYTES:
        raise AssetError("文件超过 %d MiB 上限：%s"
                         % (ASSET_MAX_BYTES // 1024 // 1024, rel))
    if suffix == ".pdf":
        return pdf_first_page_png(target), "image/png"
    try:
        return target.read_bytes(), ASSET_CONTENT_TYPES[suffix]
    except OSError:
        raise AssetError("文件读不了：%s" % rel, code="ASSET_NOT_FOUND",
                         status=404)


def list_assets(root: Path) -> dict:
    """盘里的图片清单（只读）：给前端画缩略图。

    只列 `ASSET_CONTENT_TYPES` 里的后缀；软链与超限文件不列。
    条数与深度有上限，超了给 `truncated: true`（前端据此说清"只列了前 N 个"）。
    """
    root = Path(root)
    items: list[dict] = []
    truncated = False
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(name for name in dirnames
                             if name not in SKIP_DIRS and not name.startswith("."))
        if len(Path(dirpath).relative_to(root).parts) >= LIST_MAX_DEPTH:
            dirnames[:] = []
        for name in sorted(filenames):
            path = Path(dirpath) / name
            if path.is_symlink() or not path.is_file():
                continue
            suffix = path.suffix.lower()
            if suffix not in ASSET_CONTENT_TYPES:
                continue
            try:
                size = path.stat().st_size
            except OSError:
                continue
            if size > LIST_MAX_BYTES:
                continue
            try:
                rel = path.relative_to(root).as_posix()
            except ValueError:
                continue
            items.append({"path": rel, "name": name, "size": size,
                          "type": ASSET_CONTENT_TYPES[suffix]})
            if len(items) >= LIST_MAX_ITEMS:
                truncated = True
                break
        if truncated:
            break
    return {"assets": items, "total": len(items), "truncated": truncated}


def pdf_first_page_png(pdf: Path) -> bytes:
    """PDF 的第一页转成 PNG（pdftoppm）；本机没有 poppler 就抛 POPPLER_MISSING。"""
    binary = shutil.which("pdftoppm")
    if not binary:
        raise AssetError("本机没有 pdftoppm（poppler），不能把 PDF 转成图片",
                         code="POPPLER_MISSING", status=500)
    tmp = tempfile.mkdtemp(prefix="factscribe-asset-")
    try:
        prefix = os.path.join(tmp, "page")
        proc = subprocess.run(
            [binary, "-f", "1", "-l", "1", "-png", "-r", "150", str(pdf), prefix],
            capture_output=True, timeout=60)
        if proc.returncode != 0:
            detail = (proc.stderr or b"").decode("utf-8", "replace").strip()
            raise AssetError("PDF 转图片失败：%s"
                             % (detail or "pdftoppm 退出码 %d" % proc.returncode))
        produced = sorted(Path(tmp).glob("page*.png"))
        if not produced:
            raise AssetError("PDF 转图片失败：没有产出 PNG")
        return produced[0].read_bytes()
    except subprocess.TimeoutExpired:
        raise AssetError("PDF 转图片超时")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
