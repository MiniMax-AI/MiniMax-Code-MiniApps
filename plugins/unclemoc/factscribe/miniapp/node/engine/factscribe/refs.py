# -*- coding: utf-8 -*-
"""文献登记面：跨条目查重、待补登记、联网检索候选（CARD-G1）。

这个模块回答三个问题：

1. **同一篇文献有没有两条假名？** —— `refs dedupe`：解析 bib 全集，按
   DOI / arXiv id 归一化后跨条目比对，同标识即报 `REF_DUP_ID`。
2. **还欠哪些文献、欠什么字段？** —— `refs register`：读可选登记表
   `refs/todo.toml`（人填机器收），逐项点名缺哪个字段、planned_key 撞不撞
   既有 bib key、落点节在不在。
3. **候选从哪来？** —— `refs search`：唯一联网面。按查询词去 Crossref /
   arXiv 取候选题录（DOI / arXiv id / 作者 / 年份），原始响应落
   `refs/candidates/` 并钉 sha256，编号列给人挑；`--pick` 把人挑中的候选
   写进登记表。

三条纪律（照 CARD-G1 与工单 G1）：

* **零 LLM、零第三方依赖**：纯标准库（urllib / json / xml / hashlib）。
* **默认离线身份不变**：只有 `refs search` 联网，其余命令零网络。联网时
  **只发查询词与标识**——不发正文、不发本地路径（与既有 `audit --resolve`
  同口径）。UA 自报工具名，单次查询条数上限 5，超时 10 秒。
* **机器不代签**：检索结果只是候选；`--pick` 也只写登记表，**入正式
  `refs.bib` 必须人采**（与本仓 `fact add` 同纪律）。

退出码（照 factscribe 家规）：

| 命令 | 0 | 非 0 |
|------|---|------|
| `refs dedupe` | 零重复 | **3**（黄，`REF_DUP_ID`）；2＝结构错 |
| `refs register` | 登记表逐条齐 | **1**（红：缺字段／撞 key／落点节缺）；2＝无表或表坏 |
| `refs search` | 候选已落盘 | 2＝网络失败（超时／无网／HTTP 错，各有各的信息） |

错误码按不透明数据键处理（`REF_` 前缀），不进错误码词册。
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .citations import parse_bib
from .config import ConfigError, load_config, load_toml
from .constants import EXIT_OK, EXIT_RED, EXIT_YELLOW, VERSION
from .scaffold import toml_array, toml_string

# --------------------------------------------------------------------------
# 码（不透明数据键；不进错误码词册）
# --------------------------------------------------------------------------

CODE_DUP_ID = "REF_DUP_ID"                 # 跨条目同 DOI / 同 arXiv id（黄）
CODE_MISSING_FIELD = "REF_TODO_MISSING_FIELD"   # 登记表缺必填字段（红）
CODE_KEY_COLLISION = "REF_TODO_KEY_COLLISION"   # planned_key 撞既有 bib key（红）
CODE_SECTION_MISSING = "REF_TODO_SECTION_MISSING"  # 落点节不存在（红）
CODE_TABLE_MISSING = "REF_TODO_TABLE_MISSING"  # 没有 refs/todo.toml（用法错）
CODE_TABLE_INVALID = "REF_TODO_TABLE_INVALID"  # 登记表坏（用法错）
CODE_CANDIDATE_DUP = "REF_CANDIDATE_DUPLICATE"  # 候选与既有 bib/todo 重复
CODE_SEARCH_TIMEOUT = "REF_SEARCH_TIMEOUT"    # 联网超时
CODE_SEARCH_NETWORK = "REF_SEARCH_NETWORK"    # 无网 / 连接错
CODE_SEARCH_HTTP = "REF_SEARCH_HTTP"          # HTTP 错误
CODE_SEARCH_BADPAYLOAD = "REF_SEARCH_BADPAYLOAD"  # 响应解析不了
CODE_PICK_INVALID = "REF_PICK_INVALID"        # 候选号不存在／不可采纳

# --------------------------------------------------------------------------
# 常量（网络礼貌与登记表契约）
# --------------------------------------------------------------------------

#: 单次查询最多取几条候选（工单 G1：≤5，不做批量爬取）。
MAX_RESULTS = 5
#: 单次请求超时（秒）。工单 G1：超时 10s。
NET_TIMEOUT = 10.0
#: UA 自报工具名（与 `audit --resolve` 同口径）。
USER_AGENT = "factscribe/%s (refs search)" % VERSION
#: 登记表路径（相对项目根）。可选：不配不跑。
TODO_REL = "refs/todo.toml"
#: 候选落盘目录（相对项目根）。
CANDIDATES_REL = "refs/candidates"
#: 登记表必填字段（照卡：CARD-G1 §3 登记面）。
REQUIRED_FIELDS = ("slug", "title", "authors", "year",
                   "venue_or_id", "planned_key", "section")

#: 唯一键种类：DOI 与 arXiv id（工作面口径：唯一键＝DOI/arXiv id）。
ID_KIND_DOI = "doi"
ID_KIND_ARXIV = "arxiv"

_DOI_RE = re.compile(r"10\.\d{4,9}/[^\s\"'<>,;]+")
_ARXIV_NEW_RE = re.compile(r"\d{4}\.\d{4,5}(?:v\d+)?")
_ARXIV_OLD_RE = re.compile(r"[a-z-]+(?:\.[A-Z]{2})?/\d{7}(?:v\d+)?")


# --------------------------------------------------------------------------
# 归一化（唯一键口径）
# --------------------------------------------------------------------------

def _doi_norm(value: str) -> str:
    """DOI 归一：去 `https://doi.org/` 与 `doi:` 前缀，小写。

    与 `mirror._doi_norm` 同口径（同一篇文献的两种写法不算两条）。
    """
    v = (value or "").strip()
    v = re.sub(r"^https?://(dx\.)?doi\.org/", "", v, flags=re.I)
    v = re.sub(r"^doi:\s*", "", v, flags=re.I)
    return v.strip().lower()


def _arxiv_norm(value: str) -> str:
    """arXiv id 归一：去 `arXiv:` 与 abs/pdf 链接前缀，去版本号，小写。

    版本号（`2406.07016v2`）不是另一篇文献——同 id 不同版本不判重。
    """
    v = (value or "").strip()
    v = re.sub(r"^https?://arxiv\.org/(abs|pdf)/", "", v, flags=re.I)
    v = re.sub(r"^arxiv:\s*", "", v, flags=re.I)
    v = re.sub(r"\.pdf$", "", v, flags=re.I)
    v = re.sub(r"v\d+$", "", v)
    return v.strip().lower()


def _entry_ids(entry) -> list[tuple[str, str]]:
    """一条 bib 条目身上的唯一键（DOI / arXiv id 各至多一个）。

    crossref 继承来的字段不参与判定：父子同 DOI 是 BibTeX 的正常用法
    （与 `citations.bib_duplicates` 同口径）。
    """
    out: list[tuple[str, str]] = []
    fields = entry.fields or {}
    doi = (fields.get("doi") or "").strip()
    if doi and "doi" not in (entry.inherited or set()):
        out.append((ID_KIND_DOI, _doi_norm(doi)))
    arxiv = (fields.get("arxiv") or fields.get("eprint") or "").strip()
    if arxiv and "arxiv" not in (entry.inherited or set()) \
            and "eprint" not in (entry.inherited or set()):
        out.append((ID_KIND_ARXIV, _arxiv_norm(arxiv)))
    return [(kind, value) for kind, value in out if value]


def _scan_id(text: str) -> tuple[str, str]:
    """从自由文本（venue_or_id）里抽唯一键：先 DOI，再 arXiv id。

    抽不到就返回 ("", "")——venue_or_id 也可能只写了个 venue 名。
    """
    raw = (text or "").strip()
    if not raw:
        return "", ""
    m = _DOI_RE.search(raw)
    if m:
        return ID_KIND_DOI, _doi_norm(m.group(0))
    m = _ARXIV_NEW_RE.search(raw) or _ARXIV_OLD_RE.search(raw)
    if m:
        return ID_KIND_ARXIV, _arxiv_norm(m.group(0))
    return "", ""


# --------------------------------------------------------------------------
# bib 文件集合（与引用页同一口径）
# --------------------------------------------------------------------------

def _bib_files(cfg) -> list[tuple[str, Path]]:
    """bib 文件集合＝配置里的 `bib` ＋ 正文 `\\bibliography{}` 提到的。

    与 `citeview._bib_paths` 同一口径（两个面看到同一片 bib 宇宙），
    这里只读不改它的行为。
    """
    from .citeview import _bib_paths, _tex_sources   # 局部导入：不引入循环
    return _bib_paths(cfg, _tex_sources(cfg))


def _load_entries(cfg) -> tuple[list, list[str]]:
    """解析 bib 全集，返回 (条目列表, 用了哪些 bib 文件)。"""
    entries: list = []
    files: list[str] = []
    for rel, path in _bib_files(cfg):
        files.append(rel)
        entries.extend(parse_bib(path, cfg.root))
    return entries, files


# --------------------------------------------------------------------------
# dedupe：跨条目同唯一键
# --------------------------------------------------------------------------

@dataclass
class DupGroup:
    """一组同标识条目。"""
    id_kind: str
    id_value: str
    detail: list = field(default_factory=list)   # [{"key","file","line"}]

    @property
    def code(self) -> str:
        return CODE_DUP_ID

    @property
    def keys(self) -> list:
        return [d["key"] for d in self.detail]

    @property
    def pairs(self) -> list:
        """冲突 key 对（两两组合）。"""
        out = []
        for i in range(len(self.detail)):
            for j in range(i + 1, len(self.detail)):
                out.append([self.detail[i]["key"], self.detail[j]["key"]])
        return out

    def as_dict(self) -> dict:
        where = "、".join("%s（%s:%s）" % (d["key"], d["file"], d["line"])
                          for d in self.detail)
        return {
            "code": self.code,
            "severity": "yellow",
            "message": "%s = %s：%s 挂同一个唯一键（同一篇文献两条假名）"
                       % (self.id_kind, self.id_value, where),
            "id_kind": self.id_kind,
            "id_value": self.id_value,
            "keys": self.keys,
            "pairs": self.pairs,
            "entries": list(self.detail),
        }


@dataclass
class DedupeResult:
    """一次跨条目查重的结果。"""
    root: Path
    bib_files: list = field(default_factory=list)
    total: int = 0
    keyed: int = 0
    groups: list = field(default_factory=list)
    unkeyed: list = field(default_factory=list)   # 缺唯一键的条目（只列不判红）

    @property
    def dup_count(self) -> int:
        return len(self.groups)

    @property
    def exit_code(self) -> int:
        """0＝零重复；3＝黄（有 `REF_DUP_ID`）。缺唯一键不判红、不改退出码。"""
        return EXIT_YELLOW if self.groups else EXIT_OK

    def summary(self) -> dict:
        return {
            "bib_files": list(self.bib_files),
            "entries": self.total,
            "with_unique_key": self.keyed,
            "without_unique_key": len(self.unkeyed),
            "dup_groups": self.dup_count,
        }


def dedupe(project) -> DedupeResult:
    """bib 跨条目查重：同 DOI / 同 arXiv id 即报 `REF_DUP_ID`。

    只读、离线。缺唯一键（无 DOI 无 arXiv id）的条目只列清单，不判红。
    """
    cfg = load_config(Path(project))
    entries, files = _load_entries(cfg)

    buckets: dict = {}
    unkeyed: list = []
    for entry in entries:
        ids = _entry_ids(entry)
        if not ids:
            unkeyed.append({"key": entry.key, "file": entry.file,
                             "line": entry.line})
            continue
        for kind, value in ids:
            buckets.setdefault((kind, value), []).append(
                {"key": entry.key, "file": entry.file, "line": entry.line})

    groups: list = []
    for (kind, value), detail in sorted(buckets.items()):
        if len(detail) < 2:
            continue
        groups.append(DupGroup(id_kind=kind, id_value=value, detail=detail))

    keyed = len(entries) - len(unkeyed)
    return DedupeResult(root=cfg.root, bib_files=files, total=len(entries),
                        keyed=keyed, groups=groups, unkeyed=unkeyed)


# --------------------------------------------------------------------------
# register：待补文献登记表（refs/todo.toml）
# --------------------------------------------------------------------------

@dataclass
class TodoEntry:
    """登记表中的一条待补文献。"""
    index: int
    fields: dict = field(default_factory=dict)
    missing: list = field(default_factory=list)      # 缺的必填字段名
    problems: list = field(default_factory=list)     # [{"code","message"}]

    def get(self, name: str) -> str:
        return str(self.fields.get(name) or "").strip()

    @property
    def slug(self) -> str:
        return self.get("slug")

    @property
    def planned_key(self) -> str:
        return self.get("planned_key")

    @property
    def ok(self) -> bool:
        return not self.missing and not self.problems

    def as_dict(self) -> dict:
        return {
            "index": self.index,
            "slug": self.get("slug"),
            "title": self.get("title"),
            "authors": self.fields.get("authors") or [],
            "year": self.get("year"),
            "venue_or_id": self.get("venue_or_id"),
            "planned_key": self.planned_key,
            "section": self.get("section"),
            "missing_fields": list(self.missing),
            "problems": [dict(p) for p in self.problems],
            "ok": self.ok,
        }

    def findings(self) -> list:
        """把这条摊成 findings（一条缺字段／一条问题各一个码）。"""
        out = []
        if self.missing:
            out.append({
                "code": CODE_MISSING_FIELD,
                "severity": "red",
                "message": "第 %d 条（%s）缺必填字段：%s"
                           % (self.index, self.slug or "（无 slug）",
                              "、".join(self.missing)),
                "index": self.index,
                "slug": self.slug,
                "missing_fields": list(self.missing),
            })
        for problem in self.problems:
            out.append({
                "code": problem["code"],
                "severity": "red",
                "message": "第 %d 条（%s）%s"
                           % (self.index, self.slug or "（无 slug）",
                              problem["message"]),
                "index": self.index,
                "slug": self.slug,
            })
        return out


@dataclass
class RegisterResult:
    """一次登记表核对的结果。"""
    root: Path
    table: Path
    entries: list = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.entries)

    @property
    def complete(self) -> int:
        return sum(1 for e in self.entries if e.ok)

    @property
    def problems(self) -> list:
        return [e for e in self.entries if not e.ok]

    @property
    def exit_code(self) -> int:
        """0＝逐条齐；1＝红（有缺字段／撞 key／落点节缺）。"""
        return EXIT_RED if self.problems else EXIT_OK

    def summary(self) -> dict:
        return {
            "table": str(self.table),
            "entries": self.total,
            "complete": self.complete,
            "incomplete": self.total - self.complete,
        }


def _todo_path(cfg) -> Path:
    """登记表路径（相对项目根）。"""
    return Path(cfg.root) / TODO_REL


def _load_todo(cfg) -> list:
    """读登记表（可选文件；缺＝不跑，报用法错）。"""
    path = _todo_path(cfg)
    if not path.is_file():
        raise ConfigError(
            "项目里没有 %s（待补文献登记表是可选的：不配不跑）" % TODO_REL,
            code=CODE_TABLE_MISSING)
    try:
        data = load_toml(path)
    except ConfigError as exc:
        raise ConfigError("%s：%s" % (TODO_REL, exc), code=CODE_TABLE_INVALID)
    raw = data.get("ref") or []
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list):
        raise ConfigError("%s：`ref` 必须是表数组（[[ref]]）" % TODO_REL,
                          code=CODE_TABLE_INVALID)
    return raw


def _tex_files_under(root: Path, rel_dir: str) -> list:
    """某目录下的 .tex 文件（相对项目根的 POSIX 路径）。"""
    base = Path(root) / rel_dir
    if not base.is_dir():
        return []
    out = []
    for path in sorted(base.rglob("*.tex")):
        try:
            out.append(path.relative_to(Path(root)).as_posix())
        except ValueError:
            continue
    return out


def _section_names(cfg) -> set:
    """项目里可用的节名（相对路径、文件名、文件名干三种写法都收）。

    节集合是三个面的并集：审计闭包（编译进 PDF 的）、项目声明的节文件、
    以及项目里实际存在的节目录文件。登记表要问的是「项目里有没有这一节」
    ——还没接进 main.tex 的节也算有；压根没有这个文件才是问题。
    """
    from .citeview import _tex_sources   # 局部导入：不引入循环

    names: set = set()

    def _add(rel: str) -> None:
        rel = str(rel).replace("\\", "/")
        if not rel:
            return
        names.add(rel)
        names.add(Path(rel).name)
        names.add(Path(rel).stem)

    for rel in _tex_sources(cfg):
        _add(rel)
    for rel in (getattr(cfg, "section_files", None) or []):
        _add(rel)
    dirs = {"sections"}
    glob = str(getattr(cfg, "sections_glob", "") or "")
    if glob and "*" in glob:
        parent = str(Path(glob).parent)
        if parent not in (".", ""):
            dirs.add(parent)
    for rel_dir in sorted(dirs):
        for rel in _tex_files_under(Path(cfg.root), rel_dir):
            _add(rel)
    return names


def _authors_text(value) -> list:
    """作者字段：字符串或字符串数组都收，统一成列表。"""
    if value is None:
        return []
    if isinstance(value, str):
        parts = [p.strip() for p in value.split(";")]
        return [p for p in parts if p]
    if isinstance(value, (list, tuple)):
        out = []
        for item in value:
            text = str(item or "").strip()
            if text:
                out.append(text)
        return out
    return [str(value).strip()] if str(value).strip() else []


def _todo_entries(cfg, todo_raw: list, bib_keys: set) -> list:
    """逐条核对登记表：缺字段逐项点名、撞 key、落点节存不存在。"""
    sections = _section_names(cfg)
    out: list = []
    for i, raw in enumerate(todo_raw, 1):
        fields = raw if isinstance(raw, dict) else {}
        entry = TodoEntry(index=i, fields=dict(fields))
        for name in REQUIRED_FIELDS:
            if name == "authors":
                if not _authors_text(fields.get("authors")):
                    entry.missing.append(name)
                continue
            if not str(fields.get(name) or "").strip():
                entry.missing.append(name)

        key = entry.planned_key
        if key and key.casefold() in bib_keys:
            entry.problems.append({
                "code": CODE_KEY_COLLISION,
                "message": "planned_key %r 撞既有 bib 里的 key——同一 key 不能挂两条"
                           % key,
            })
        section = entry.get("section")
        if section:
            want = Path(section).name
            stem = Path(section).stem
            if not (section in sections or want in sections or stem in sections):
                entry.problems.append({
                    "code": CODE_SECTION_MISSING,
                    "message": "落点节 %r 在项目里找不到（正文没有这一节）"
                               % section,
                })
        out.append(entry)
    return out


def _existing_bib_keys(cfg) -> set:
    entries, _files = _load_entries(cfg)
    return {e.key.casefold() for e in entries}


def register(project) -> RegisterResult:
    """核对待补文献登记表 `refs/todo.toml`。

    只读。缺必填字段逐项点名、planned_key 撞既有 bib key、落点节不存在，
    都判红（exit 1）；逐条齐且不撞才 exit 0。
    """
    cfg = load_config(Path(project))
    todo_raw = _load_todo(cfg)
    bib_keys = _existing_bib_keys(cfg)
    entries = _todo_entries(cfg, todo_raw, bib_keys)
    return RegisterResult(root=cfg.root, table=_todo_path(cfg), entries=entries)


# --------------------------------------------------------------------------
# search：联网检索候选（唯一联网面）
# --------------------------------------------------------------------------

@dataclass
class Candidate:
    """一条检索候选。"""
    source: str
    title: str = ""
    authors: list = field(default_factory=list)
    year: str = ""
    doi: str = ""
    arxiv_id: str = ""
    venue: str = ""
    duplicate: bool = False
    duplicates: list = field(default_factory=list)  # 撞上的既有 key / slug
    number: int = 0        # 采纳号（0＝重复，不给采纳号）

    @property
    def ids(self) -> list:
        out = []
        if self.doi:
            out.append((ID_KIND_DOI, _doi_norm(self.doi)))
        if self.arxiv_id:
            out.append((ID_KIND_ARXIV, _arxiv_norm(self.arxiv_id)))
        return out

    @property
    def id_kind(self) -> str:
        ids = self.ids
        return ids[0][0] if ids else ""

    @property
    def id_value(self) -> str:
        ids = self.ids
        return ids[0][1] if ids else ""

    @property
    def venue_or_id(self) -> str:
        """登记表里的 `venue_or_id`：有 DOI/arXiv id 用它，否则退 venue。"""
        if self.doi:
            return "doi:%s" % _doi_norm(self.doi)
        if self.arxiv_id:
            return "arXiv:%s" % _arxiv_norm(self.arxiv_id)
        return self.venue

    def as_dict(self) -> dict:
        return {
            "number": self.number,
            "source": self.source,
            "title": self.title,
            "authors": list(self.authors),
            "year": self.year,
            "doi": self.doi,
            "arxiv_id": self.arxiv_id,
            "venue": self.venue,
            "id_kind": self.id_kind,
            "id_value": self.id_value,
            "duplicate": self.duplicate,
            "duplicates": list(self.duplicates),
        }


@dataclass
class SearchResult:
    """一次检索的结果。"""
    root: Path
    query: str
    source: str
    request_url: str
    candidates: list = field(default_factory=list)
    raw_path: Path = None
    envelope_path: Path = None
    raw_sha256: str = ""
    picked: dict = None

    @property
    def adoptable(self) -> list:
        return [c for c in self.candidates if not c.duplicate]

    @property
    def duplicated(self) -> list:
        return [c for c in self.candidates if c.duplicate]

    @property
    def exit_code(self) -> int:
        return EXIT_OK

    def summary(self) -> dict:
        return {
            "query": self.query,
            "source": self.source,
            "request_url": self.request_url,
            "candidates": len(self.candidates),
            "adoptable": len(self.adoptable),
            "duplicated": len(self.duplicated),
            "raw_file": str(self.raw_path) if self.raw_path else "",
            "raw_sha256": self.raw_sha256,
            "envelope_file": str(self.envelope_path) if self.envelope_path else "",
        }


def _slugify(text: str) -> str:
    """查询词 → 文件名片段（只留 ASCII 字母数字与连字符）。"""
    out = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return out[:48] or "query"


def _now_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _http_get(url: str, timeout: float = NET_TIMEOUT) -> bytes:
    """取一次响应。失败一律显式报错：超时／无网／HTTP 错各有各的信息。

    绝不静默放行，也绝不拿假数据顶上。
    """
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        raise ConfigError(
            "检索失败：HTTP %s %s——不取假数据，命令中止" % (exc.code, exc.reason),
            code=CODE_SEARCH_HTTP)
    except TimeoutError:
        raise ConfigError(
            "检索失败：超时（%g 秒）——不取假数据，命令中止" % timeout,
            code=CODE_SEARCH_TIMEOUT)
    except urllib.error.URLError as exc:
        reason = exc.reason
        text = str(reason)
        if isinstance(reason, TimeoutError) or "timed out" in text.lower():
            raise ConfigError(
                "检索失败：超时（%g 秒）——不取假数据，命令中止" % timeout,
                code=CODE_SEARCH_TIMEOUT)
        raise ConfigError(
            "检索失败：无网或连接被拒（%s）——不取假数据，命令中止" % text,
            code=CODE_SEARCH_NETWORK)
    except OSError as exc:
        raise ConfigError(
            "检索失败：网络错误（%s）——不取假数据，命令中止" % exc,
            code=CODE_SEARCH_NETWORK)


def _crossref_url(query: str, rows: int) -> str:
    """Crossref 检索 URL：只带查询词与条数，不带任何本地内容。"""
    return ("https://api.crossref.org/works?"
            + urllib.parse.urlencode({"query.bibliographic": query,
                                      "rows": str(rows)}))


def _arxiv_url(query: str, rows: int) -> str:
    """arXiv 检索 URL：只带查询词与条数，不带任何本地内容。"""
    return ("https://export.arxiv.org/api/query?"
            + urllib.parse.urlencode({"search_query": "all:%s" % query,
                                      "start": "0",
                                      "max_results": str(rows)}))


def _parse_crossref(payload: bytes) -> list:
    """Crossref 响应 → 候选字段列表。"""
    try:
        data = json.loads(payload.decode("utf-8", "replace"))
    except ValueError as exc:
        raise ConfigError("Crossref 响应不是合法 JSON：%s" % exc,
                          code=CODE_SEARCH_BADPAYLOAD)
    message = data.get("message") if isinstance(data, dict) else None
    items = (message or {}).get("items") if isinstance(message, dict) else None
    out = []
    for item in (items or []):
        if not isinstance(item, dict):
            continue
        title = " ".join(" ".join(item.get("title") or []).split())
        authors = []
        for person in item.get("author") or []:
            if not isinstance(person, dict):
                continue
            name = " ".join(x for x in (person.get("given"),
                                        person.get("family")) if x)
            name = name or str(person.get("name") or "")
            name = " ".join(name.split())
            if name:
                authors.append(name)
        year = ""
        issued = item.get("issued") or {}
        parts = (issued.get("date-parts") or [[]])[0] \
            if isinstance(issued, dict) else []
        for part in parts:
            if isinstance(part, int):
                year = str(part)
                break
        venue = " ".join(" ".join(item.get("container-title") or []).split())
        out.append({
            "source": "crossref",
            "title": title,
            "authors": authors,
            "year": year,
            "doi": str(item.get("DOI") or "").strip(),
            "arxiv_id": "",
            "venue": venue,
        })
    return out


_ATOM = "{http://www.w3.org/2005/Atom}"
_ARXIV = "{http://arxiv.org/schemas/atom}"


def _parse_arxiv(payload: bytes) -> list:
    """arXiv Atom 响应 → 候选字段列表。"""
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as exc:
        raise ConfigError("arXiv 响应不是合法 Atom XML：%s" % exc,
                          code=CODE_SEARCH_BADPAYLOAD)
    out = []
    for node in root.findall(_ATOM + "entry"):
        raw_id = (node.findtext(_ATOM + "id") or "").strip()
        arxiv_id = _arxiv_norm(raw_id)
        title = " ".join((node.findtext(_ATOM + "title") or "").split())
        authors = []
        for person in node.findall(_ATOM + "author"):
            name = " ".join((person.findtext(_ATOM + "name") or "").split())
            if name:
                authors.append(name)
        published = (node.findtext(_ATOM + "published") or "").strip()
        year = published[:4] if len(published) >= 4 else ""
        doi = (node.findtext(_ARXIV + "doi") or "").strip()
        out.append({
            "source": "arxiv",
            "title": title,
            "authors": authors,
            "year": year,
            "doi": doi,
            "arxiv_id": arxiv_id,
            "venue": "arXiv preprint",
        })
    return out


def _known_ids(cfg) -> dict:
    """既有唯一键 → 撞上的名字（bib key 与登记表 slug）。

    候选查重面：既有 bib 条目 ＋ 既有登记表条目。
    """
    known: dict = {}
    entries, _files = _load_entries(cfg)
    for entry in entries:
        for kind, value in _entry_ids(entry):
            known.setdefault((kind, value), []).append("bib:%s" % entry.key)
    todo_path = _todo_path(cfg)
    if todo_path.is_file():
        try:
            raw = _load_todo(cfg)
        except ConfigError:
            raw = []
        for i, item in enumerate(raw, 1):
            fields = item if isinstance(item, dict) else {}
            label = str(fields.get("slug") or "").strip() or "ref#%d" % i
            for name in ("doi", "arxiv", "eprint"):
                text = str(fields.get(name) or "").strip()
                if text:
                    kind = ID_KIND_DOI if name == "doi" else ID_KIND_ARXIV
                    known.setdefault((kind, _doi_norm(text) if kind == ID_KIND_DOI
                                      else _arxiv_norm(text)), []).append(
                        "todo:%s" % label)
            kind, value = _scan_id(str(fields.get("venue_or_id") or ""))
            if kind and value:
                known.setdefault((kind, value), []).append("todo:%s" % label)
    return known


def _mark_duplicates(candidates: list, known: dict) -> None:
    """给候选标「重复」：与既有 bib/todo 撞唯一键的不给采纳号。"""
    for cand in candidates:
        hits = []
        for kind, value in cand.ids:
            for label in known.get((kind, value), []):
                if label not in hits:
                    hits.append(label)
        if hits:
            cand.duplicate = True
            cand.duplicates = hits


def _write_atomic(path: Path, data: bytes) -> None:
    """原子写：同目录临时文件 + rename（要么旧内容，要么完整新内容）。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name("%s.tmp-%d" % (path.name, os.getpid()))
    try:
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(str(tmp), str(path))
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def search(query: str, project=".", source: str = "crossref",
           rows: int = MAX_RESULTS, timeout: float = NET_TIMEOUT) -> SearchResult:
    """联网检索候选元数据。

    只发查询词与标识（**不发正文、不发本地路径**）。原始响应落
    `refs/candidates/` 并钉 sha256（出处可查），候选编号列表给人挑。

    失败一律显式报错：超时／无网／HTTP 错各有各的信息，不静默放行，
    不拿假数据顶上。
    """
    query = str(query or "").strip()
    if not query:
        raise ConfigError("查询词不能为空", code=CODE_PICK_INVALID)
    if source not in ("crossref", "arxiv"):
        raise ConfigError("检索源只认 crossref / arxiv，收到 %r" % source,
                          code=CODE_PICK_INVALID)
    rows = max(1, min(int(rows or MAX_RESULTS), MAX_RESULTS))

    cfg = load_config(Path(project))
    url = _crossref_url(query, rows) if source == "crossref" \
        else _arxiv_url(query, rows)
    payload = _http_get(url, timeout=timeout)
    raw_items = (_parse_crossref(payload) if source == "crossref"
                 else _parse_arxiv(payload))

    candidates = [Candidate(**item) for item in raw_items[:rows]]
    _mark_duplicates(candidates, _known_ids(cfg))

    # 采纳号：只给非重复候选（重复的不给采纳号）。
    number = 0
    for cand in candidates:
        if cand.duplicate:
            continue
        number += 1
        cand.number = number

    # 落盘：原始响应（逐字节）＋ 信封（sha256 与出处）。
    digest = hashlib.sha256(payload).hexdigest()
    stamp = _now_stamp()
    stem = "%s-%s-%s-%s" % (stamp, source, _slugify(query), digest[:8])
    cdir = Path(cfg.root) / CANDIDATES_REL
    suffix = ".raw.json" if source == "crossref" else ".raw.xml"
    raw_path = cdir / (stem + suffix)
    envelope_path = cdir / (stem + ".candidates.json")
    _write_atomic(raw_path, payload)
    envelope = {
        "schema": "factscribe-refs-candidates/1.0",
        "query": query,
        "source": source,
        "requested_at": stamp,
        "request_url": url,
        "raw_file": raw_path.name,
        "raw_sha256": digest,
        "raw_bytes": len(payload),
        "candidates": [c.as_dict() for c in candidates],
        "note": "机器检索候选；入正式 refs.bib 必须人采——本工具不代签。",
    }
    _write_atomic(envelope_path, (json.dumps(envelope, ensure_ascii=False,
                                             indent=2) + "\n").encode("utf-8"))

    return SearchResult(root=cfg.root, query=query, source=source,
                        request_url=url, candidates=candidates,
                        raw_path=raw_path, envelope_path=envelope_path,
                        raw_sha256=digest)


# --------------------------------------------------------------------------
# pick：把候选写进登记表（仍非正式 bib）
# --------------------------------------------------------------------------

def _slug_for(cand: Candidate, fallback: str = "") -> str:
    """候选 → 登记表 slug：首位作者姓 + 年份。

    这是标签不是身份断言；正式 key 由人给（`--key`），机器不编。
    """
    year = (cand.year or "").strip()
    name = ""
    if cand.authors:
        first = cand.authors[0]
        name = first.split(",")[0] if "," in first else first.split()[-1]
    slug = re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_").lower()
    if not slug:
        slug = _slugify(fallback).replace("-", "_")
    return "%s_%s" % (slug, year) if year else slug


def _render_ref_block(fields: dict) -> str:
    """一条 `[[ref]]`（字段顺序固定，便于人读与 diff）。"""
    order = ("slug", "title", "authors", "year", "venue_or_id",
             "planned_key", "section")
    lines = ["[[ref]]"]
    for name in order:
        value = fields.get(name)
        if name == "authors":
            lines.append("authors = %s" % toml_array(value or []))
        else:
            lines.append("%s = %s" % (name, toml_string(value or "")))
    for name in sorted(fields):
        if name in order:
            continue
        lines.append("%s = %s" % (name, toml_string(fields.get(name) or "")))
    return "\n".join(lines) + "\n"


TODO_HEADER = (
    "# refs/todo.toml —— 待补文献登记表（人填机器收）。\n"
    "# 机器只收不签：入正式 refs.bib 必须人采。\n"
    "# 必填字段：slug / title / authors / year / venue_or_id / planned_key / section\n"
)


def _append_ref(root, fields: dict) -> Path:
    """把一条待补文献追加进登记表（不存在则先建表头）。

    `root` 是项目根（不是 Config）——登记表固定在 `<root>/refs/todo.toml`。
    """
    path = Path(root) / TODO_REL
    if path.is_file():
        existing = path.read_bytes()
    else:
        existing = b""
    sep = b""
    if existing:
        if not existing.endswith(b"\n"):
            sep += b"\n"
        sep += b"\n"
    elif not existing:
        existing = TODO_HEADER.encode("utf-8")
        sep = b"\n"
    block = _render_ref_block(fields)
    _write_atomic(path, existing + sep + block.encode("utf-8"))
    return path


def pick_candidate(result: SearchResult, number: int, planned_key: str = "",
                    section: str = "") -> dict:
    """把人挑中的候选写进登记表（**不碰 refs.bib**）。

    `number` 是候选的采纳号；重复候选没有采纳号，挑不动。
    """
    want = int(number)
    match = None
    for cand in result.candidates:
        if cand.number == want:
            match = cand
            break
    if match is None:
        valid = ", ".join(str(c.number) for c in result.adoptable) or "（无）"
        raise ConfigError(
            "候选号 %d 不存在（可采纳的候选号：%s）" % (want, valid),
            code=CODE_PICK_INVALID)
    fields = {
        "slug": _slug_for(match, result.query),
        "title": match.title,
        "authors": list(match.authors),
        "year": match.year,
        "venue_or_id": match.venue_or_id,
        "planned_key": str(planned_key or "").strip(),
        "section": str(section or "").strip(),
    }
    path = _append_ref(result.root, fields)
    info = dict(fields)
    info["table"] = str(path)
    info["candidate"] = match.as_dict()
    return info


def pick_from_latest(project, number: int, planned_key: str = "",
                     section: str = "") -> tuple:
    """从项目里最近一次检索的候选集中挑一条，写进登记表。

    读的是 `refs/candidates/*.candidates.json` 里最新的一份。
    """
    cfg = load_config(Path(project))
    cdir = Path(cfg.root) / CANDIDATES_REL
    files = sorted(cdir.glob("*.candidates.json")) if cdir.is_dir() else []
    if not files:
        raise ConfigError(
            "项目里没有检索候选（%s 下没有 *.candidates.json）；"
            "先跑 `factscribe refs search <查询词>`" % CANDIDATES_REL,
            code=CODE_PICK_INVALID)
    latest = files[-1]
    try:
        envelope = json.loads(latest.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ConfigError("候选文件读不了：%s（%s）" % (latest, exc),
                          code=CODE_PICK_INVALID)
    cands = []
    for item in envelope.get("candidates") or []:
        cand = Candidate(source=item.get("source") or envelope.get("source") or "",
                         title=item.get("title") or "",
                         authors=list(item.get("authors") or []),
                         year=item.get("year") or "",
                         doi=item.get("doi") or "",
                         arxiv_id=item.get("arxiv_id") or "",
                         venue=item.get("venue") or "",
                         duplicate=bool(item.get("duplicate")),
                         duplicates=list(item.get("duplicates") or []),
                         number=int(item.get("number") or 0))
        cands.append(cand)
    raw_name = str(envelope.get("raw_file") or "")
    raw_path = latest.with_name(raw_name) if raw_name else None
    result = SearchResult(root=cfg.root, query=envelope.get("query") or "",
                          source=envelope.get("source") or "",
                          request_url=envelope.get("request_url") or "",
                          candidates=cands,
                          raw_path=raw_path,
                          envelope_path=latest,
                          raw_sha256=envelope.get("raw_sha256") or "")
    info = pick_candidate(result, number, planned_key, section)
    info["candidates_file"] = str(latest)
    return info, result


# --------------------------------------------------------------------------
# 报告（人读）
# --------------------------------------------------------------------------

def render_dedupe(result: DedupeResult) -> str:
    lines = ["== factscribe refs dedupe ==",
             "项目：%s" % result.root,
             "bib 文件：%s" % ("、".join(result.bib_files) or "（无）"),
             "条目：%d 条（带唯一键 %d，缺唯一键 %d）"
             % (result.total, result.keyed, len(result.unkeyed))]
    if not result.groups:
        lines.append("零重复：没有两条条目挂同一 DOI / arXiv id。")
    else:
        lines.append("重复 %d 组（码 %s，黄级）：" % (result.dup_count, CODE_DUP_ID))
        for i, group in enumerate(result.groups, 1):
            lines.append("  %d) %s = %s" % (i, group.id_kind, group.id_value))
            for detail in group.detail:
                lines.append("     - %s（%s:%s）"
                             % (detail["key"], detail["file"], detail["line"]))
    if result.unkeyed:
        lines.append("缺唯一键的条目（无 DOI 无 arXiv id，只列不判红）：")
        for item in result.unkeyed:
            lines.append("  - %s（%s:%s）" % (item["key"], item["file"],
                                            item["line"]))
    return "\n".join(lines)


def render_register(result: RegisterResult) -> str:
    lines = ["== factscribe refs register ==",
             "项目：%s" % result.root,
             "登记表：%s" % result.table,
             "条目：%d 条（齐 %d，缺 %d）"
             % (result.total, result.complete, result.total - result.complete)]
    if not result.entries:
        lines.append("登记表里没有条目。")
        return "\n".join(lines)
    for entry in result.entries:
        head = "  %d) %s" % (entry.index, entry.slug or "（无 slug）")
        if entry.ok:
            lines.append(head + " —— 字段齐")
            continue
        lines.append(head)
        if entry.missing:
            lines.append("     缺字段：%s" % "、".join(entry.missing))
        for problem in entry.problems:
            lines.append("     [%s] %s" % (problem["code"], problem["message"]))
    return "\n".join(lines)


def render_search(result: SearchResult) -> str:
    lines = ["== factscribe refs search ==",
             "项目：%s" % result.root,
             "查询词：%s" % result.query,
             "源：%s" % result.source,
             "请求：%s" % result.request_url,
             "候选原始响应：%s" % result.raw_path,
             "sha256：%s" % result.raw_sha256,
             "候选 %d 条（可采纳 %d，重复 %d）："
             % (len(result.candidates), len(result.adoptable),
                len(result.duplicated))]
    for cand in result.candidates:
        mark = "" if not cand.duplicate else "［重复·不给采纳号］"
        head = "  %s%s" % (("%d)" % cand.number) if cand.number else "－)", mark)
        lines.append("%s %s" % (head, cand.title or "（无题名）"))
        meta = []
        if cand.authors:
            meta.append("作者：%s" % "；".join(cand.authors[:3]))
        if cand.year:
            meta.append("年份：%s" % cand.year)
        if cand.doi:
            meta.append("DOI：%s" % cand.doi)
        if cand.arxiv_id:
            meta.append("arXiv：%s" % cand.arxiv_id)
        if cand.venue:
            meta.append("出处：%s" % cand.venue)
        if meta:
            lines.append("     " + "｜".join(meta))
        if cand.duplicates:
            lines.append("     撞既有：%s" % "、".join(cand.duplicates))
    if result.picked:
        lines.append("已写进登记表：%s" % result.picked.get("table"))
        lines.append("  slug=%s planned_key=%s section=%s"
                     % (result.picked.get("slug"), result.picked.get("planned_key"),
                        result.picked.get("section") or "（空，待人填）"))
    lines.append("提示：候选只是候选——入正式 refs.bib 必须人采，机器不代签。")
    return "\n".join(lines)
