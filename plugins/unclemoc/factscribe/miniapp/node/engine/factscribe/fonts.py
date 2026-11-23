# -*- coding: utf-8 -*-
"""Fandol 中文字体：按需下载、本地缓存与完整性校验。

设计见 docs/design/SPEC-FONTS.md。要点：

* 字体包约 26.7 MB，不入 git——缓存到 ``~/.cache/factscribe/fonts/fandol``，
  可用环境变量 ``FACTSCRIBE_FONT_CACHE`` 覆盖；
* 只认四个必需 OTF（宋/黑/楷/仿），缺一即失败，不静默回退；
* 纯标准库（urllib / zipfile / hashlib），尊重 ``HTTPS_PROXY`` 等代理变量。
"""
from __future__ import annotations

import hashlib
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_URL = "https://mirrors.ctan.org/fonts/fandol.zip"
REQUIRED_FONTS = (
    "FandolSong-Regular.otf",
    "FandolHei-Regular.otf",
    "FandolKai-Regular.otf",
    "FandolFang-Regular.otf",
)
# 有则保留：让 \textbf 用真粗体（缺了也不影响四个必需字体的完整性）。
OPTIONAL_FONTS = ("FandolSong-Bold.otf", "FandolHei-Bold.otf")
SOURCE_NAME = "SOURCE.txt"
_CHUNK = 1 << 20
_TIMEOUT = 120


class FontCacheError(Exception):
    """下载、解压或校验失败。CLI 统一映射到 exit 4。"""


def cache_dir() -> Path:
    """默认缓存目录；``FACTSCRIBE_FONT_CACHE`` 指向的就是 fandol 目录本身。"""
    override = os.environ.get("FACTSCRIBE_FONT_CACHE")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".cache" / "factscribe" / "fonts" / "fandol"


def missing_fonts(directory: Path) -> list[str]:
    return [name for name in REQUIRED_FONTS if not (directory / name).is_file()]


def is_complete(directory: Path) -> bool:
    return not missing_fonts(directory)


def _read_source(directory: Path) -> dict:
    path = directory / SOURCE_NAME
    if not path.is_file():
        return {}
    out: dict = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition(":")
        if sep:
            out[key.strip().lower()] = value.strip()
    return {
        "url": out.get("url"),
        "downloaded": out.get("downloaded"),
        "zip_bytes": int(out["zip-bytes"]) if out.get("zip-bytes", "").isdigit() else None,
        "sha256": out.get("sha256"),
    }


def font_status(directory: Path | None = None) -> dict:
    """缓存现状（只读，不建目录、不联网）。"""
    directory = Path(directory) if directory is not None else cache_dir()
    fonts = []
    for name in REQUIRED_FONTS:
        path = directory / name
        fonts.append({
            "name": name,
            "present": path.is_file(),
            "bytes": path.stat().st_size if path.is_file() else 0,
        })
    cache_bytes = 0
    if directory.is_dir():
        cache_bytes = sum(p.stat().st_size for p in directory.iterdir()
                          if p.is_file())
    return {
        "path": str(directory),
        "present": directory.is_dir(),
        "complete": is_complete(directory),
        "fonts": fonts,
        "missing": missing_fonts(directory),
        "cache_bytes": cache_bytes,
        "source": _read_source(directory),
    }


def _as_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme:
        return url
    return Path(url).expanduser().resolve().as_uri()


def _download(url: str, target: Path) -> tuple[int, str]:
    """流式下载到 target；返回 (字节数, sha256)。失败一律 FontCacheError。"""
    digest = hashlib.sha256()
    total = 0
    try:
        with urllib.request.urlopen(url, timeout=_TIMEOUT) as resp, \
                open(target, "wb") as fh:
            while True:
                chunk = resp.read(_CHUNK)
                if not chunk:
                    break
                total += len(chunk)
                digest.update(chunk)
                fh.write(chunk)
    except (urllib.error.URLError, urllib.error.HTTPError, OSError,
            ValueError) as exc:
        raise FontCacheError("下载失败：%s（%s）" % (url, exc)) from exc
    if total == 0:
        raise FontCacheError("下载失败：%s 返回空响应" % url)
    return total, digest.hexdigest()


def _is_license_name(name: str) -> bool:
    lowered = name.lower()
    return ("license" in lowered or "copying" in lowered
            or lowered.startswith("readme"))


def _extract(zip_path: Path, directory: Path) -> list[str]:
    """只摊平解出四个必需 OTF 与许可/说明文本；返回缺失的必需字体。"""
    try:
        with zipfile.ZipFile(zip_path) as zf:
            for member in zf.infolist():
                if member.is_dir():
                    continue
                base = Path(member.filename).name
                if (base not in REQUIRED_FONTS and base not in OPTIONAL_FONTS
                        and not _is_license_name(base)):
                    continue
                (directory / base).write_bytes(zf.read(member))
    except (zipfile.BadZipFile, OSError) as exc:
        raise FontCacheError("解压失败：不是有效的 zip 包（%s）" % exc) from exc
    return missing_fonts(directory)


def _write_source(directory: Path, url: str, downloaded: str, zip_bytes: int,
                  digest: str) -> None:
    text = "\n".join([
        "URL: %s" % url,
        "Downloaded: %s" % downloaded,
        "Zip-Bytes: %d" % zip_bytes,
        "SHA256: %s" % digest,
        "Fonts: %s" % ", ".join(REQUIRED_FONTS),
        "",
    ])
    (directory / SOURCE_NAME).write_text(text, encoding="utf-8")


def fetch(url: str | None = None, directory: Path | None = None,
          force: bool = False) -> dict:
    """下载并解压 Fandol；已完整且未 force 时幂等返回。"""
    url = url or DEFAULT_URL
    directory = Path(directory) if directory is not None else cache_dir()
    if is_complete(directory) and not force:
        return {"downloaded": False, "skipped": True,
                "reason": "缓存已完整（--force 可重下）", **font_status(directory)}

    directory.mkdir(parents=True, exist_ok=True)
    archive = directory / ".fandol.zip.part"
    started = time.monotonic()
    try:
        zip_bytes, digest = _download(_as_url(url), archive)
        missing = _extract(archive, directory)
        if missing:
            raise FontCacheError(
                "字体包缺必需文件：%s（四个 OTF 必须齐）" % "、".join(missing))
        downloaded_at = datetime.now(timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ")
        _write_source(directory, _as_url(url), downloaded_at, zip_bytes,
                      digest)
    finally:
        archive.unlink(missing_ok=True)

    status = font_status(directory)
    status.update({
        "downloaded": True,
        "skipped": False,
        "url": _as_url(url),
        "zip_bytes": zip_bytes,
        "sha256": digest,
        "duration_seconds": round(time.monotonic() - started, 2),
    })
    return status


def render_status(info: dict) -> str:
    lines = ["== factscribe fonts ==", "缓存目录：%s" % info["path"]]
    if info["complete"]:
        lines.append("状态：完整（4/4）")
    elif info["present"]:
        lines.append("状态：缺失（%d/4）——缓存目录存在但不完整"
                     % (4 - len(info["missing"])))
    else:
        lines.append("状态：缺失（0/4）——缓存目录还不存在")
    for item in info["fonts"]:
        mark = "✓" if item["present"] else "✗"
        lines.append("  %s %-28s %12s 字节" % (
            mark, item["name"], "{:,}".format(item["bytes"])))
    source = info.get("source") or {}
    if source.get("url"):
        lines.append("来源：%s" % source["url"])
    if source.get("downloaded"):
        lines.append("下载：%s（zip %s 字节）" % (
            source["downloaded"],
            "{:,}".format(source["zip_bytes"]) if source.get("zip_bytes")
            else "?"))
    lines.append("缓存体积：%s 字节" % "{:,}".format(info["cache_bytes"]))
    if not info["complete"]:
        lines.append("修复：python3 -m factscribe fonts --fetch")
    return "\n".join(lines)


def render_fetch(info: dict) -> str:
    if info.get("skipped"):
        head = "已完整，跳过下载（用 --force 重下）"
    else:
        head = "下载完成：%s（%s 字节，%.2f 秒）" % (
            info.get("url"), "{:,}".format(info.get("zip_bytes") or 0),
            info.get("duration_seconds") or 0.0)
    return "\n".join(["== factscribe fonts ==", head,
                      render_status(info).split("\n", 1)[1]])
