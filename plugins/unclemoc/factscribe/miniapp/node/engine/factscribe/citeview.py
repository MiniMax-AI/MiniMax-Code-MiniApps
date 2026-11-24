# -*- coding: utf-8 -*-
"""引用页的数据层：多 bib 汇总 + 每条的状态（只读、离线）。

这个页面回答一个问题：**这篇论文引了哪些文献，哪些还没被引到，
哪些条目的标识不可复核。** 它只读、只算，不改 bib、不联网核对
（联网核对仍然走 `audit`）。

口径（写死在这里，页面与接口共用）：

* **bib 文件集合** = 配置里的 `bib`（默认 refs.bib）+ 正文里
  `\\bibliography{a,b}` 提到的那些。两者都按项目根解析，越界的路径直接丢掉。
* **正文引用次数** = `\\cite` 家族（citep / citet / nocite…）在正文里
  出现该 key 的次数；`\\nocite{*}` ＝整库引用，此时没被点名的条目也算被引到。
* **状态**（一条一个，取第一个命中的）：

  | status    | 含义                                   | 判定                       |
  |-----------|----------------------------------------|----------------------------|
  | `bad_id`  | 标识不合法，或跨文件重复 key           | 格式不过 `valid_stable_id` |
  | `no_id`   | 缺稳定标识（没有 doi / arXiv / url）   | `stable_id` 为空           |
  | `unused`  | 标识没问题，但正文没引到               | 引用次数为 0               |
  | `ok`      | 有可复核的标识，正文也引了             | 其余                       |

  重复 key 额外给 `duplicate: true`，并在 `files` 里列出它出现在哪几个 bib 里。

* **汇总**：`total`（条目总数）、`used`（被引到的条目数）、`unused`
  （没被引到的条目数；两者相加等于 total）、`no_id`（缺标识的条目数）、
  `bad_id`（标识不合法或重复的条目数）、`files`（每个 bib 文件一条：
  `path` + `entries` 条数 + `keys`）。
* **entries**：全部条目（每条含 `key, kind, title, doi, arxiv, url, file,
  line, used, files, duplicate, status`），供界面画表格。
"""
from __future__ import annotations

import os
import re
from pathlib import Path

from .citations import parse_bib, valid_stable_id
from .config import (ConfigError, _glob_paths, load_config, load_sections)
from .texscan import scan_tex

# 正文里点名的 bib：`\bibliography{a,b}`（逗号分隔，通常不带 .bib）。
_BIB_RE = re.compile(r"\\bibliography\s*\{([^}]*)\}")
# 扫描器兜底：scan_tex 抽不出引用时用它（只认 `\cite` 家族的小写写法）。
_CITE_FALLBACK_RE = re.compile(r"\\cite[a-zA-Z]*\{([^}]*)\}")

STATUS_OK = "ok"
STATUS_NO_ID = "no_id"
STATUS_BAD_ID = "bad_id"
STATUS_UNUSED = "unused"
STATUS_DUPLICATE = "duplicate"


def _read(path: Path) -> str:
    """读文本；读不动就当空文件（只读页面不该因为一个坏文件整页报错）。"""
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def _tex_sources(cfg) -> dict:
    """正文文件（相对路径 → 文本）：审计闭包 + glob 命中 + root_tex。

    闭包（load_sections）覆盖 `\\input` 展开的节；glob 命中覆盖没被
    `\\input` 的同级节；root_tex 覆盖 V3 的主文件。三者取并集——
    `\\bibliography{}` 常写在主文件里，只看闭包会漏。
    """
    out: dict = {}
    try:
        for rel, text in load_sections(cfg):
            out[rel] = text
    except ConfigError:
        pass  # 闭包坏了也要能看 bib：退回 glob 与 root_tex
    try:
        for rel, path in _glob_paths(cfg.root, cfg.sections_glob).items():
            out.setdefault(rel, _read(path))
    except (OSError, ConfigError):
        pass  # glob 坏了也要能看 bib：退回闭包与 root_tex
    root_tex = str(getattr(cfg, "root_tex", "") or "").strip()
    if root_tex:
        path = cfg.root / root_tex
        if path.is_file():
            out.setdefault(root_tex, _read(path))
    # v1 没有 root_tex：主文件（main.tex 之类）常常就在项目根，
    # `\bibliography{a,b}` 写在那里；不扫它就会漏掉多 bib。
    for path in sorted(cfg.root.glob("*.tex")):
        if path.is_file():
            out.setdefault(path.relative_to(cfg.root).as_posix(), _read(path))
    return out


def _bib_paths(cfg, texs: dict) -> list:
    """bib 文件集合：配置里的 bib + 正文 `\\bibliography{}` 提到的。

    路径一律按项目根解析；越界（`..`、绝对路径）与不存在的文件直接丢掉。
    返回 [(相对路径, 绝对路径), …]，按相对路径排序。
    """
    root = Path(os.path.normpath(str(cfg.root)))
    found: dict = {}

    def add(raw: str) -> None:
        rel = str(raw or "").strip()
        if not rel:
            return
        if not rel.lower().endswith(".bib"):
            rel += ".bib"
        path = Path(os.path.normpath(str(root / rel)))
        try:
            key = path.relative_to(root).as_posix()
        except ValueError:
            return  # 越出项目根：不许读
        if not path.is_file():
            return
        found[key] = path

    add(str(getattr(cfg, "bib", "") or ""))
    for text in texs.values():
        for m in _BIB_RE.finditer(text):
            for part in m.group(1).split(","):
                add(part)
    return [(key, found[key]) for key in sorted(found)]


def _scan_cite_keys(text: str) -> tuple:
    """正文里的引用 key 与次数，以及有没有 `\\nocite{*}`（整库引用）。

    复用 texscan.scan_tex 的既有口径（它已经会跳过注释、verbatim，
    并且认 citep / citet / nocite 这一族）；抽不出东西时用正则兜底。
    """
    counts: dict = {}
    nocite_all = False
    try:
        scan = scan_tex(text)
    except Exception:  # noqa: BLE001 - 兜底：扫描器坏了不该让整页报错
        scan = None
    if scan is not None:
        nocite_all = bool(scan.nocite_all)
        for key, _line, _col in scan.cites:
            key = str(key or "").strip()
            if key and key != "*":
                counts[key] = counts.get(key, 0) + 1
    if not counts:
        for m in _CITE_FALLBACK_RE.finditer(text):
            for part in m.group(1).split(","):
                key = part.strip()
                if key and key != "*":
                    counts[key] = counts.get(key, 0) + 1
    return counts, nocite_all


def _entry_row(entry, counts: dict) -> dict:
    """一条 bib 条目在页面上的样子。"""
    fields = entry.fields
    name, value = entry.stable_id
    return {
        "key": entry.key,
        "kind": entry.kind,
        "title": (fields.get("title") or "").strip(),
        "doi": (fields.get("doi") or "").strip(),
        "arxiv": (fields.get("arxiv") or fields.get("eprint") or "").strip(),
        "url": (fields.get("url") or "").strip(),
        "file": entry.file,
        "line": entry.line,
        "used": int(counts.get(entry.key, 0)),
        "files": [entry.file],
        "duplicate": False,
        "status": STATUS_OK,
        "id_type": name or "",
        "id_value": value or "",
    }


def _status_of(row: dict) -> str:
    """一条的状态：bad_id > no_id > unused > ok。"""
    if row["duplicate"]:
        return STATUS_DUPLICATE
    name = row.get("id_type") or ""
    value = row.get("id_value") or ""
    if not name:
        return STATUS_NO_ID
    if not valid_stable_id(name, value):
        return STATUS_BAD_ID
    if row["used"] <= 0:
        return STATUS_UNUSED
    return STATUS_OK


def citations_data(project) -> dict:
    """GET /api/citations 的数据面（只读，不联网）。"""
    cfg = load_config(Path(project))
    texs = _tex_sources(cfg)

    counts: dict = {}
    nocite_all = False
    for text in texs.values():
        part, all_cited = _scan_cite_keys(text)
        nocite_all = nocite_all or all_cited
        for key, n in part.items():
            counts[key] = counts.get(key, 0) + n

    rows: list = []
    by_key: dict = {}
    files: list = []
    root = Path(os.path.normpath(str(cfg.root)))
    for rel, path in _bib_paths(cfg, texs):
        entries = parse_bib(path, root)
        keys = []
        for entry in entries:
            row = _entry_row(entry, counts)
            rows.append(row)
            by_key.setdefault(row["key"], []).append(len(rows) - 1)
            keys.append(entry.key)
        files.append({"path": rel, "entries": len(entries), "keys": keys})

    # 跨文件重复 key：都算 bad_id，并说清它出现在哪几个 bib 里。
    for _key, idxs in by_key.items():
        if len(idxs) < 2:
            continue
        paths = sorted({rows[i]["file"] for i in idxs})
        for i in idxs:
            rows[i]["duplicate"] = True
            rows[i]["files"] = paths

    # \nocite{*} = 整库引用：没被点名的条目也算被引到（与 audit 的 R-11 豁免一致）。
    if nocite_all:
        for row in rows:
            if row["used"] <= 0:
                row["used"] = 1

    for row in rows:
        row["status"] = _status_of(row)

    total = len(rows)
    used = sum(1 for row in rows if row["used"] > 0)
    return {
        "total": total,
        "used": used,
        "unused": total - used,
        "no_id": sum(1 for row in rows if row["status"] == STATUS_NO_ID),
        "bad_id": sum(1 for row in rows if row["status"] == STATUS_BAD_ID),
        "duplicate": sum(1 for row in rows if row["status"] == STATUS_DUPLICATE),
        "files": files,
        "entries": rows,
        "nocite_all": nocite_all,
        "bib": str(getattr(cfg, "bib", "") or ""),
    }
