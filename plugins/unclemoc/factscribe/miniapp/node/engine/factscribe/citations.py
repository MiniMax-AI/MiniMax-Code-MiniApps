# -*- coding: utf-8 -*-
"""natbib 引用命令家族与 bib 解析。"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from .config import ConfigError
from .textio import read_text_exact
from .texscan import _balanced

# --------------------------------------------------------------------------
# bib 解析
# --------------------------------------------------------------------------

_BIB_ENTRY_RE = re.compile(r"@([A-Za-z]+)\s*[{(]\s*([^,\s]+)\s*,")
_STRING_RE = re.compile(r"@string\s*[{(]\s*([A-Za-z][\w-]*)\s*=\s*(?:\{([^{}]*)\}|\"([^\"]*)\")",
                        re.I)
_URL_OK_TYPES = {"misc", "online", "software", "dataset", "unpublished",
                 "manual", "techreport", "webpage", "www"}
_ARXIV_NEW = re.compile(r"^\d{4}\.\d{4,5}(v\d+)?$")
_ARXIV_OLD = re.compile(r"^[a-z-]+(?:\.[A-Z]{2})?/\d{7}(v\d+)?$")
_DOI_RE = re.compile(r"^10\.\d{4,9}/\S+$")
_URL_RE = re.compile(r"^https?://\S+$")


def valid_stable_id(name: str, value: str) -> bool:
    v = (value or "").strip()
    if name in ("arxiv", "eprint"):
        v = re.sub(r"^(arxiv:|https?://arxiv\.org/abs/)", "", v, flags=re.I)
        v = v.rstrip("/")
        return bool(_ARXIV_NEW.match(v) or _ARXIV_OLD.match(v))
    if name == "doi":
        v = re.sub(r"^(doi:|https?://(dx\.)?doi\.org/)", "", v, flags=re.I)
        return bool(_DOI_RE.match(v))
    if name == "url":
        return bool(_URL_RE.match(v))
    return False


@dataclass
class BibEntry:
    key: str
    kind: str
    file: str
    line: int
    # 条目最后一行（含）。`line` 是 `@type{key,` 那行；
    # 两者合起来就是这条在文件里占的那几行——删条目要靠它。
    end: int = 0
    fields: dict = field(default_factory=dict)
    inherited: set = field(default_factory=set)

    @property
    def stable_id(self):
        for name in ("arxiv", "eprint", "doi"):
            v = (self.fields.get(name) or "").strip()
            if v:
                return name, v
        if self.kind in _URL_OK_TYPES:
            v = (self.fields.get("url") or "").strip()
            if v:
                return "url", v
        return None, ""


def parse_bib(path: Path, root: Path) -> list[BibEntry]:
    try:
        text = read_text_exact(path)
    except OSError as exc:
        raise ConfigError("读不了参考文献 %s：%s" % (path, exc))
    rel = path.relative_to(root).as_posix()
    macros = {}
    for sm in _STRING_RE.finditer(text):
        macros[sm.group(1).lower()] = " ".join((sm.group(2) or sm.group(3) or "").split())
    entries: list[BibEntry] = []
    for m in _BIB_ENTRY_RE.finditer(text):
        kind, key = m.group(1).lower(), m.group(2)
        if kind in ("comment", "string", "preamble"):
            continue
        body_start = m.end()
        depth = 1
        i = body_start
        while i < len(text) and depth > 0:
            c = text[i]
            if c == "\\":
                i += 2
                continue
            if c in "{(":
                depth += 1
            elif c in "})":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        body = text[body_start:i]
        fields = {}
        for fm in re.finditer(r"([A-Za-z][A-Za-z0-9_-]*)\s*=\s*", body):
            name = fm.group(1).lower()
            j = fm.end()
            while j < len(body) and body[j] in " \t\r\n":
                j += 1
            if j < len(body) and body[j] == "{":
                end = _balanced(body, j, "{", "}")
                value = body[j + 1:end - 1]
            elif j < len(body) and body[j] == '"':
                end = body.find('"', j + 1)
                end = len(body) if end < 0 else end
                value = body[j + 1:end]
            else:
                vm = re.match(r"[^,\n]+", body[j:])
                value = vm.group(0) if vm else ""
            fields.setdefault(name, " ".join(value.split()))
        # @string 宏替换（红队 C8-C）
        for name, value in list(fields.items()):
            bare = value.strip()
            if bare and " " not in bare and bare.lower() in macros:
                fields[name] = macros[bare.lower()]
        entries.append(BibEntry(
            key=key, kind=kind, file=rel,
            line=text.count("\n", 0, m.start()) + 1,
            end=text.count("\n", 0, i) + 1,
            fields=fields,
        ))
    # crossref 一层继承（红队 C8-D）
    by_key = {e.key: e for e in entries}
    for e in entries:
        parent = (e.fields.get("crossref") or "").strip()
        if parent and parent in by_key:
            for name, value in by_key[parent].fields.items():
                if name not in e.fields:
                    e.fields[name] = value
                    e.inherited.add(name)
    return entries


def unused_bib_entries(entries: list[BibEntry], used_keys, nocite_all: bool = False,
                       allow=()) -> list[BibEntry]:
    """R-11：bib 里有、闭包内从未被 `\\cite*` 家族引用的条目（UNUSED_BIB）。

    三条豁免（窄，写死）：

    - `\\nocite{*}`：整库引用，所有条目都算「被引用」；
    - `\\nocite{key}`：逐条引用，该 key 已由扫描器记进 `used_keys`；
    - `bib_allow_unused = ["key", ...]`：人签白名单（大小写不敏感）。

    返回按 key 去重后的条目（同一 key 定义多次已由 DUPLICATE_BIB_KEY 判红）。
    """
    allowed = {str(k).strip().casefold() for k in (allow or ()) if str(k).strip()}
    if nocite_all:
        return []
    out: list[BibEntry] = []
    seen: set[str] = set()
    for e in entries:
        if e.key in seen:
            continue
        seen.add(e.key)
        if e.key in used_keys:
            continue
        if e.key.casefold() in allowed:
            continue
        out.append(e)
    return out


def bib_duplicates(entries: list[BibEntry]) -> tuple[list[str], list[tuple[str, list[str]]]]:
    """返回 (重复 key 列表, [(稳定标识, [key...]), ...])。

    crossref 继承来的标识不参与「重复标识」判定：父子同 DOI 是 BibTeX 的正常用法。
    """
    keys: dict[str, int] = {}
    ids: dict[tuple[str, str], list[str]] = {}
    for e in entries:
        keys[e.key] = keys.get(e.key, 0) + 1
        name, value = e.stable_id
        if name and name not in e.inherited:
            ids.setdefault((name, value.lower()), []).append(e.key)
    dup_keys = sorted(k for k, n in keys.items() if n > 1)
    dup_ids = [(name + "=" + value, ks) for (name, value), ks in ids.items() if len(ks) > 1]
    return dup_keys, dup_ids
