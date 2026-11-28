# -*- coding: utf-8 -*-
"""论文项目登记册（与 MiniApp 共用同一份文件）。

一个论文项目＝一个含 `factscribe.toml` 的
文件夹。登记册固定在
`~/.factscribe/projects.json`，只存路径、显示名、上次使用时间与解释器设置，
不复制正文、不写项目文件夹。

MiniApp 侧（Node）读写同一个文件，格式必须保持一致：
`{version, projects: [{path, name, lastOpenedAt}], lastPath, python, pythonpath}`。
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from .safepath import guard_project_write
from .textio import (dominant_newline, read_text_exact, split_keepends,
                     write_text_exact)

REGISTRY_VERSION = 1
MAX_PROJECTS = 30
CONFIG_NAME = "factscribe.toml"


def config_file(root: str | os.PathLike[str]) -> Path:
    """项目自己的声明文件：factscribe.toml。"""
    return Path(root) / CONFIG_NAME

# 文件夹名只允许这些字符：不做拼音转换（中文名自己写），也不许路径分隔符。
SLUG_RE = re.compile(r"[A-Za-z0-9._-]+")


class ProjectCreateError(Exception):
    """新建项目失败：`code` 给机器看（HTTP 状态跟着 `status`）。"""

    def __init__(self, message: str, code: str = "PROJECT_CREATE_FAILED",
                 status: int = 400):
        super().__init__(message)
        self.code = code
        self.status = status



def home_dir() -> Path:
    return Path(os.environ.get("HOME") or Path.home())


def factscribe_dir() -> Path:
    return home_dir() / ".factscribe"


def registry_path() -> Path:
    return factscribe_dir() / "projects.json"


def empty_registry() -> dict:
    return {"version": REGISTRY_VERSION, "projects": [], "lastPath": "",
            "python": "", "pythonpath": ""}


def normalize_registry(raw: object) -> dict:
    data = raw if isinstance(raw, dict) else {}
    rows = data.get("projects")
    rows = rows if isinstance(rows, list) else []
    seen: set[str] = set()
    projects = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        path = str(row.get("path") or "").strip()
        if not path or path in seen:
            continue
        seen.add(path)
        projects.append({"path": path,
                         "name": str(row.get("name") or ""),
                         "description": str(row.get("description") or ""),
                         "lastOpenedAt": str(row.get("lastOpenedAt") or "")})
    return {"version": REGISTRY_VERSION,
            "projects": projects,
            "lastPath": str(data.get("lastPath") or ""),
            "python": str(data.get("python") or ""),
            "pythonpath": str(data.get("pythonpath") or "")}


def read_registry() -> dict:
    try:
        return normalize_registry(json.loads(registry_path().read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        # 没有登记册、或被手改坏：当空册，不因此拒绝启动
        return empty_registry()


def write_registry(registry: dict) -> None:
    directory = factscribe_dir()
    directory.mkdir(parents=True, exist_ok=True)
    file = registry_path()
    tmp = file.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(normalize_registry(registry), ensure_ascii=False, indent=2) + "\n",
                   encoding="utf-8")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, file)


def resolve_project(raw: str | os.PathLike[str] | None) -> Path:
    """展开 `~`、要求绝对路径、必须是含 factscribe.toml 的文件夹；返回真实路径。"""
    from .config import ConfigError, load_config

    text = str(raw or "").strip()
    if not text:
        raise ConfigError("请填论文项目文件夹", code="PROJECT_INVALID")
    if text == "~":
        expanded = home_dir()
    elif text.startswith("~/"):
        expanded = home_dir() / text[2:]
    else:
        expanded = Path(text)
    if not expanded.is_absolute():
        raise ConfigError("请填绝对路径（以 / 开头）：%s" % text,
                          code="PROJECT_INVALID")
    if not expanded.exists():
        raise ConfigError("文件夹不存在：%s" % expanded, code="PROJECT_INVALID")
    if not expanded.is_dir():
        raise ConfigError("不是文件夹：%s" % expanded, code="PROJECT_INVALID")
    root = expanded.resolve()
    if not (root / CONFIG_NAME).exists():
        raise ConfigError("这个文件夹不是论文项目：缺 %s（%s）"
                          % (CONFIG_NAME, root), code="PROJECT_INVALID")
    load_config(root)  # 坏配置在这里就报，别等界面加载到一半才炸
    return root


def project_name(path: str | os.PathLike[str]) -> str:
    from .config import ConfigError, load_config

    root = Path(path)
    try:
        cfg = load_config(root)
        name = (cfg.name or cfg.title or "").strip()
    except ConfigError:
        name = ""
    return name or root.name


def upsert_project(registry: dict, path: str | os.PathLike[str],
                   name: str = "") -> dict:
    reg = normalize_registry(registry)
    root = str(Path(path).resolve())
    when = datetime.now(timezone.utc).isoformat(timespec="seconds")
    # 已经在册的项目：简介留着（登记册里的 description 是项目自己的那一行）。
    old = next((p for p in reg["projects"] if p["path"] == root), None)
    entry = {"path": root, "name": name or project_name(root),
             "description": (old or {}).get("description", ""),
             "lastOpenedAt": when}
    rest = [p for p in reg["projects"] if p["path"] != root]
    reg["projects"] = ([entry] + rest)[:MAX_PROJECTS]
    reg["lastPath"] = root
    return reg


def remove_project(registry: dict, path: str) -> dict:
    reg = normalize_registry(registry)
    reg["projects"] = [p for p in reg["projects"] if p["path"] != path]
    if reg["lastPath"] == path:
        reg["lastPath"] = ""
    return reg


def project_description(path: str | os.PathLike[str]) -> str:
    """项目的一句话简介（`[project] description`；读不到就是空串）。

    简介写在项目自己的声明里，不进登记册——改了 `factscribe.toml` 立刻见效，
    登记册的格式也就不用跟着变（MiniApp 侧读同一个文件）。
    """
    from .config import ConfigError, load_config

    try:
        return load_config(Path(path)).description
    except (ConfigError, OSError):
        return ""


# ---------------------------------------------------------------- 建项目

def _toml_value(text: str) -> str:
    """TOML 基本字符串（与 config 的迷你解析器兼容的最小转义集）。"""
    out = (str(text or "")
           .replace("\\", "\\\\")
           .replace('"', '\\"')
           .replace("\n", "\\n")
           .replace("\r", "\\r")
           .replace("\t", "\\t"))
    return '"%s"' % out


def _write_parts(path: Path, parts: list[tuple[str, str]],
                  fallback: str = "\n") -> None:
    """把 `[(行内容, 行尾), ...]` 写回文件。

    与原来的 `"\n".join(lines).rstrip("\n") + "\n"` 意图一致（末尾不留
    空行、末尾恰好一个换行），但**行尾用文件自己的那一种**：CRLF 的声明
    文件不会被顺手改成 LF，Windows 上也不会被翻译成 CRLF。
    """
    rows = list(parts)
    had_rows = bool(rows)
    while rows and rows[-1][0] == "":
        rows.pop()          # 末尾的空行不留
    out: list[str] = []
    last = len(rows) - 1
    for index, (content, term) in enumerate(rows):
        if index < last:
            out.append(content + (term or fallback))
        else:
            out.append(content)
    text = "".join(out)
    if text:
        text += fallback
    elif had_rows:
        text = fallback
    write_text_exact(path, text)


def _rewrite_project_table(path: Path, values: dict) -> None:
    """改写项目声明（`factscribe.toml`）的 `[project]` 表：只替换/追加给定的键，别的原样保留。

    骨架模板里已经有的键就地替换；没有的追加到 `[project]` 段末尾。
    其它段（`[budget]`/`[evidence]` 之类）一个字都不动。
    `values` 的值是**已经排版好的 TOML 字面量**（字符串带引号、数组带方括号）。

    行尾按原样保留：改一个键不牵动整份文件的换行。
    """
    # 写侧落点闸：声明文件必须留在项目根内（软链绕出去就拒写，不落盘）。
    guard_project_write(path.parent, path, what="项目声明", rel=path.name)
    raw = read_text_exact(path)
    parts = split_keepends(raw)
    contents = [content for content, _ in parts]
    nl = dominant_newline(raw)
    start = None
    end = len(contents)
    for index, line in enumerate(contents):
        stripped = line.strip()
        if not stripped.startswith("["):
            continue
        if start is None:
            if stripped == "[project]":
                start = index + 1
            continue
        end = index
        break
    if start is None:
        section: list[tuple[str, str]] = [("", nl), ("[project]", nl)]
        for key, value in values.items():
            section.append(("%s = %s" % (key, value), nl))
        new_parts = parts + section
    else:
        pending = dict(values)
        section = []
        for index in range(start, end):
            content, term = parts[index]
            match = re.match(r"^\s*([A-Za-z0-9_-]+)\s*=", content)
            key = match.group(1) if match else ""
            if key in pending:
                section.append(("%s = %s" % (key, pending.pop(key)), term))
            else:
                section.append((content, term))
        for key, value in pending.items():
            section.append(("%s = %s" % (key, value), nl))
        new_parts = parts[:start] + section + parts[end:]
    _write_parts(path, new_parts, nl)


def create_project(*, title: str, parent: str, slug: str,
                   authors: list | None = None, description: str = "",
                   lang: str = "zh", sections: str = "", facts: str = "",
                   bib: str = "", root_tex: str = "", build: str = "",
                   source_root: str = "", output: str = "") -> dict:
    """新建一个论文项目：落骨架 → 补声明 → 登记册置顶。

    只生成骨架，不编译、不写事实。返回
    `{"path", "name", "description", "created", "files"}`。
    """
    from .scaffold import init_project

    clean_title = str(title or "").strip()
    if not clean_title:
        raise ProjectCreateError("请填项目名称", code="PROJECT_TITLE_MISSING")
    raw_parent = str(parent or "").strip()
    if not raw_parent:
        raw_parent = str(home_dir())
    base = Path(raw_parent).expanduser()
    if not base.is_absolute():
        raise ProjectCreateError(
            "父目录要填绝对路径（以 / 开头）：%s" % raw_parent,
            code="PROJECT_PARENT_INVALID")
    if not base.exists():
        raise ProjectCreateError("父目录不存在：%s" % base,
                                 code="PROJECT_PARENT_MISSING")
    if not base.is_dir():
        raise ProjectCreateError("父目录不是文件夹：%s" % base,
                                 code="PROJECT_PARENT_INVALID")
    clean_slug = str(slug or "").strip()
    if not clean_slug or clean_slug in (".", "..") or not SLUG_RE.fullmatch(clean_slug):
        raise ProjectCreateError(
            "文件夹名只允许字母、数字、点、下划线和连字符（不许 . 或 ..）：%r"
            % clean_slug, code="PROJECT_SLUG_INVALID")
    target = (base / clean_slug).resolve()
    if target.exists():
        if not target.is_dir():
            raise ProjectCreateError("目标已存在且不是文件夹：%s" % target,
                                     code="PROJECT_DIR_NOT_EMPTY", status=409)
        if any(target.iterdir()):
            raise ProjectCreateError(
                "目标目录不空（里面已经有东西）：%s" % target,
                code="PROJECT_DIR_NOT_EMPTY", status=409)

    author_list = [str(a).strip() for a in (authors or []) if str(a).strip()]
    created = init_project(target, title=clean_title,
                           author=author_list[0] if author_list else "",
                           lang=lang)
    values = {
        "description": _toml_value(str(description or "").strip()),
        "build": _toml_value(str(build or "").strip()),
        "source_root": _toml_value(str(source_root or "").strip() or str(base)),
        "sections": _toml_value(str(sections or "").strip() or "sections/*.tex"),
        "facts": _toml_value(str(facts or "").strip() or "facts/*.toml"),
        "bib": _toml_value(str(bib or "").strip() or "refs.bib"),
        "root_tex": _toml_value(str(root_tex or "").strip() or "main.tex"),
        "output": _toml_value(str(output or "").strip() or "main.pdf"),
    }
    if author_list:
        values["authors"] = "[%s]" % ", ".join(_toml_value(a) for a in author_list)
    _rewrite_project_table(target / CONFIG_NAME, values)

    registry = upsert_project(read_registry(), target, clean_title)
    write_registry(registry)
    return {
        "path": str(target),
        "name": clean_title,
        "description": str(description or "").strip(),
        "created": True,
        "files": list(created.get("files") or []),
    }


# ------------------------------------------------------------ 改项目名与简介

def _top_level_keys(text: str) -> list:
    """顶层键（第一张表之前的那段）里的 `键 = 值`。"""
    head = []
    for line in text.splitlines():
        if line.strip().startswith("["):
            break
        match = re.match(r"^\s*([A-Za-z0-9_-]+)\s*=", line)
        if match:
            head.append(match.group(1))
    return head


def _has_project_table(text: str) -> bool:
    return any(line.strip() == "[project]" for line in text.splitlines())


def _rewrite_flat_keys(path: Path, values: dict) -> None:
    """改写扁平 schema（v3 形态 A）的顶层键：只替换/追加给定的键。

    只动第一张表之前的那些行；表里的内容一个字都不改。行尾按原样保留。
    """
    if not values:
        return
    raw = read_text_exact(path)
    parts = split_keepends(raw)
    contents = [content for content, _ in parts]
    nl = dominant_newline(raw)
    end = len(contents)
    for index, line in enumerate(contents):
        if line.strip().startswith("["):
            end = index
            break
    pending = dict(values)
    head: list[tuple[str, str]] = []
    for index in range(end):
        content, term = parts[index]
        match = re.match(r"^\s*([A-Za-z0-9_-]+)\s*=", content)
        key = match.group(1) if match else ""
        if key in pending:
            head.append(("%s = %s" % (key, pending.pop(key)), term))
        else:
            head.append((content, term))
    for key, value in pending.items():
        head.append(("%s = %s" % (key, value), nl))
    _write_parts(path, head + parts[end:], nl)


def update_project(registry: dict, path: str, name: str = "",
                   description: str = "") -> dict:
    """改一个**已在登记册里**的项目的名字与简介。

    两处一起改：登记册的 `name`/`description`，以及项目自己的
    `factscribe.toml`（`title` 与 `description`；其它键原样保留）。
    路径不在册子里就拒绝——不然就变成「凭空造一个项目」。
    """
    reg = registry if isinstance(registry, dict) else {}
    rows = reg.get("projects")
    rows = rows if isinstance(rows, list) else []
    raw = str(path or "").strip()
    if not raw:
        raise ProjectCreateError("先填论文项目文件夹", code="PROJECT_INVALID")
    candidates = {raw}
    try:
        candidates.add(str(Path(raw).expanduser().resolve()))
    except OSError:
        pass
    entry = next((p for p in rows
                  if isinstance(p, dict)
                  and str(p.get("path") or "") in candidates), None)
    if entry is None:
        raise ProjectCreateError(
            "这个项目不在登记册里：%s（先在项目页加入它）" % raw,
            code="PROJECT_NOT_REGISTERED")
    new_name = str(name or "").strip() or entry.get("name", "")
    new_desc = str(description or "").strip()
    cfg_file = config_file(Path(entry["path"]))
    if cfg_file.is_file():
        text = read_text_exact(cfg_file)
        values = {"description": _toml_value(new_desc)}
        if _has_project_table(text):
            # v1 与 v3 形态 B/C：名字在 [project].title。
            values["title"] = _toml_value(new_name)
            _rewrite_project_table(cfg_file, values)
            # v3 里顶层 name/title 优先于表里的：顶层有就一起改。
            top = _top_level_keys(text)
            flat = {}
            if "name" in top:
                flat["name"] = _toml_value(new_name)
            elif "title" in top:
                flat["title"] = _toml_value(new_name)
            _rewrite_flat_keys(cfg_file, flat)
        else:
            # 扁平 schema（v3 形态 A）：名字写在顶层。
            key = "name" if "name" in _top_level_keys(text) else "title"
            values[key] = _toml_value(new_name)
            _rewrite_flat_keys(cfg_file, values)
    entry["name"] = new_name
    entry["description"] = new_desc
    return {"path": entry["path"], "name": new_name, "description": new_desc}

