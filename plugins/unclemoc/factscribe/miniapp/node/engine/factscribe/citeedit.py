# -*- coding: utf-8 -*-
"""引用页的写侧：往 bib 里加一条、把一条删掉。

`citeview.py` 是读侧（多 bib 汇总 + 每条状态），这里是对应的写侧：

* **添加**：在项目的 `cfg.bib` 末尾追加一条 `@article{…}`。原子写：先读原文，
  拼好新内容，再写临时文件 + rename——写到一半断电也不会留下半个条目。
* **删除**：用 `citations.parse_bib` 定位该 key 的条目范围（行号），把那一段
  从文件里抠掉，再原子写回。

三条硬规矩：

1. key 只许 `[A-Za-z0-9:._-]+`（BibTeX 的 key 本来就这样写）；
2. key 已存在 → `CITATION_EXISTS`（409）；找不到 → `CITATION_MISSING`（404）；
3. 只读工作台一律拒（`READ_ONLY`，403）——写 bib 是写盘。
"""
from __future__ import annotations

import os
import re
from pathlib import Path, PurePosixPath

from .citeview import _bib_paths, _tex_sources
from .citations import parse_bib
from .config import ConfigError, load_config

# BibTeX 的 key：字母数字，外加冒号、点、下划线、连字符。
KEY_RE = re.compile(r"^[A-Za-z0-9:._-]+$")

# 一次追加的字段顺序（只写非空的）。
_FIELDS = (("title", "标题"), ("author", "作者"), ("year", "年份"),
           ("doi", "DOI"), ("arxiv", "arXiv"))


def _require_write(allow_write: bool) -> None:
    if not allow_write:
        raise ConfigError(
            "serve 当前是只读模式；改 bib 需要启动时加 --allow-write",
            code="READ_ONLY")


def _clean_key(raw: str) -> str:
    """把用户给的 key 收拾干净并校验；不合法当场拒（400）。"""
    key = str(raw or "").strip()
    if not key:
        raise ConfigError("引用 key 必填：要加哪一条", code="CITATION_INVALID")
    if not KEY_RE.match(key):
        raise ConfigError(
            "引用 key %r 不合法：只许字母数字与 : . _ -" % key,
            code="CITATION_INVALID")
    return key


def _bib_value(raw: str) -> str:
    """字段值：压成一行，并把不平衡的花括号配平（不然 bib 会被写坏）。"""
    text = " ".join(str(raw or "").split())
    out: list = []
    depth = 0
    for ch in text:
        if ch == "{":
            depth += 1
            out.append(ch)
        elif ch == "}":
            if depth == 0:
                continue  # 多出来的右括号：丢掉
            depth -= 1
            out.append(ch)
        else:
            out.append(ch)
    out.append("}" * depth)  # 没闭合的左括号：补上
    return "".join(out)


def _write_atomic(path: Path, text: str) -> None:
    """原子写：同目录临时文件 + rename。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name("%s.tmp-%d" % (path.name, os.getpid()))
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(str(tmp), str(path))
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def _project_bib(cfg) -> Path:
    """项目自己的 bib 文件（配置里的 `bib`）。越出项目根一律拒。"""
    rel = str(getattr(cfg, "bib", "") or "refs.bib").strip()
    pure = PurePosixPath(rel.replace("\\", "/"))
    if pure.is_absolute() or any(part == ".." for part in pure.parts):
        raise ConfigError("配置里的 bib 必须是项目内的相对路径：%s" % rel,
                          code="BIB_PATH_ESCAPE")
    root = cfg.root.resolve()
    target = root.joinpath(*[p for p in pure.parts if p not in ("", ".")])
    try:
        target.resolve().relative_to(root)
    except ValueError:
        raise ConfigError("bib 越出项目根：%s" % rel, code="BIB_PATH_ESCAPE")
    return target


def _bib_set(cfg) -> list:
    """bib 文件集合（与引用页一致）：配置里的 + 正文 \\bibliography{} 提到的。"""
    try:
        return _bib_paths(cfg, _tex_sources(cfg))
    except ConfigError:
        return []


def _keys_of(path: Path, root: Path) -> set:
    """一个 bib 文件里已有的 key。"""
    if not path.is_file():
        return set()
    try:
        return {e.key for e in parse_bib(path, root)}
    except ConfigError:
        return set()


def _entry_text(key: str, fields: dict) -> str:
    """一条 @article 的正文。空字段不写。"""
    lines = ["@article{%s," % key]
    for name, _label in _FIELDS:
        value = _bib_value(fields.get(name) or "")
        if not value:
            continue
        lines.append("  %s = {%s}," % (name, value))
    if _bib_value(fields.get("arxiv") or ""):
        lines.append("  archivePrefix = {arXiv},")
    lines.append("}")
    return "\n".join(lines) + "\n"


def citation_add_data(project: Path | str, body: dict,
                       allow_write: bool = False) -> dict:
    """POST /api/citations/add 的数据面：往 `cfg.bib` 末尾追加一条。"""
    _require_write(allow_write)
    if not isinstance(body, dict):
        raise ConfigError("请求体必须是 JSON 对象", code="CITATION_INVALID")
    key = _clean_key(body.get("key"))
    cfg = load_config(Path(project))
    root = cfg.root.resolve()

    # key 已存在 → 409。查的是整个 bib 集合：加到 refs.bib 里撞上 extra.bib
    # 的同名 key，一样是重复。
    for _rel, path in _bib_set(cfg):
        if key in _keys_of(path, root):
            raise ConfigError("这个 key 已经有了：%s" % key,
                              code="CITATION_EXISTS")

    target = _project_bib(cfg)
    try:
        old = target.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        old = ""
    fields = {
        "title": str(body.get("title") or ""),
        "author": str(body.get("author") or ""),
        "year": str(body.get("year") or ""),
        "doi": str(body.get("doi") or ""),
        "arxiv": str(body.get("arxiv") or ""),
    }
    entry = _entry_text(key, fields)
    text = old
    if text and not text.endswith("\n"):
        text += "\n"
    if text:
        text += "\n"
    text += entry
    _write_atomic(target, text)
    try:
        rel = target.relative_to(root).as_posix()
    except ValueError:
        rel = target.name
    return {"key": key, "path": rel, "entry": entry}


def citation_delete_data(project: Path | str, body: dict,
                         allow_write: bool = False) -> dict:
    """POST /api/citations/delete 的数据面：把该 key 的条目从 bib 里抠掉。"""
    _require_write(allow_write)
    if not isinstance(body, dict):
        raise ConfigError("请求体必须是 JSON 对象", code="CITATION_INVALID")
    key = _clean_key(body.get("key"))
    cfg = load_config(Path(project))
    root = cfg.root.resolve()

    # 定位：parse_bib 给出每条的行范围（line..end）。
    hits = []
    for rel, path in _bib_set(cfg):
        if not path.is_file():
            continue
        try:
            entries = parse_bib(path, root)
        except ConfigError:
            continue
        for entry in entries:
            if entry.key != key:
                continue
            hits.append({"file": rel, "path": path,
                         "line": entry.line, "end": entry.end})
    if not hits:
        raise ConfigError("找不到这条引用：%s" % key, code="CITATION_MISSING")

    removed = []
    for hit in hits:
        path = hit["path"]
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            raise ConfigError("bib 读不了：%s" % hit["file"], code="CITATION_INVALID")
        lines = text.splitlines(keepends=True)
        start = max(1, hit["line"])
        end = max(start, hit["end"])
        del lines[start - 1:end]
        _write_atomic(path, "".join(lines))
        removed.append({"file": hit["file"], "line": start, "end": end})
    return {"key": key, "removed": removed,
            "files": sorted({hit["file"] for hit in hits})}
