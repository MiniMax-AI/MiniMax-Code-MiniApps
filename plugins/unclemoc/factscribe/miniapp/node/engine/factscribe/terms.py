# -*- coding: utf-8 -*-
"""术语归一化与同义词层（SPEC-TERMS）。

词表分两层，运行时不读 ``sia-harness``：

* ``terms/workspace.tsv``：从 nomenclator 导入的工作区流程词，**只用于查词
  与同义归一，不参与 TERM_VARIANT**（流程词的别名是宽松近义，直接当同义
  词会把 ``成本`` / ``预算`` 误报成同一概念的两种写法）；
* ``terms/paper.tsv``：论文领域术语，由 ``scripts/import-glossary.py`` 从
  ``paper-zh/GLOSSARY.md`` 生成；第五列 ``blocked(cn)`` 是备注里声明的
  **禁用变体**。同名表面形式以 ``paper.tsv`` 为准。

一份词表（TSV：canonical / aliases(en) / aliases(cn) / category /
blocked(cn)）＋两种归一化：

* 拉丁文：NFKC → 小写 → 去首尾空白；
* 中文：不做分词，正文从左到右做**最长匹配**扫描。

标点、空白、连字符与全半角差异不参与匹配；匹配键只保留字母、数字、
CJK 字符与单个空格。拉丁表面形式保留词边界（避免 ``id`` 命中 ``did``
内部），中文表面形式不加词边界。

本模块只服务 ``factscribe style``；纯标准库，不 import ``audit`` / ``protect``。
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

DEFAULT_TERMS_DIR = Path(__file__).resolve().parent / "terms"
DEFAULT_WORKSPACE_PATH = DEFAULT_TERMS_DIR / "workspace.tsv"
DEFAULT_PAPER_PATH = DEFAULT_TERMS_DIR / "paper.tsv"
# 向后兼容：旧代码把默认词表当 glossary.tsv 读；现在默认是「论文＋流程」两层。
DEFAULT_GLOSSARY_PATH = DEFAULT_WORKSPACE_PATH

_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
_SPACE_RE = re.compile(r"\s+")

# 最长匹配 trie 的终止标记（字符键都是 str，None 不冲突）。
_END = None


def normalize_surface(text: str) -> str:
    """拉丁文表面形式归一：NFKC → 小写 → 去首尾空白（内部空白压一个）。"""
    text = unicodedata.normalize("NFKC", str(text)).lower().strip()
    return _SPACE_RE.sub(" ", text)


def _keep_char(ch: str) -> bool:
    """匹配键保留的字符：字母、数字、CJK；空白另作单词分隔。"""
    return ch.isalnum() or bool(_CJK_RE.match(ch))


def _key_with_map(text: str) -> tuple[str, list[int]]:
    """生成匹配键与「键下标 → 原串下标」映射。

    逐字符做 NFKC + 小写，避免整串归一改变长度后行号漂移；标点、连字符
    与空白都不进键（空白差异不参与匹配）。拉丁词边界在匹配后回到原串
    检查，见 ``Glossary._boundary_ok``。
    """
    out: list[str] = []
    idx: list[int] = []
    for i, ch in enumerate(str(text)):
        for norm in unicodedata.normalize("NFKC", ch).lower():
            if _keep_char(norm):
                out.append(norm)
                idx.append(i)
    return "".join(out), idx


def key_of(text: str) -> str:
    """归一化匹配键：NFKC + 小写 + 去标点/连字符/空白差异。"""
    return _key_with_map(text)[0]


def _is_latin_word(ch: str) -> bool:
    return ch.isascii() and ch.isalnum()


def _is_orig_word(ch: str) -> bool:
    """原串字符是否属于拉丁单词（全半角先 NFKC；CJK 不算拉丁词边界）。"""
    norm = unicodedata.normalize("NFKC", ch).lower()
    return bool(norm) and all(c.isascii() and c.isalnum() for c in norm)


@dataclass(frozen=True)
class Term:
    index: int
    canonical: str
    category: str
    forms: tuple
    blocked: tuple = ()
    source: str = "paper"       # "paper" / "workspace"

    def is_blocked(self, form_key: str) -> bool:
        """该匹配键是否属于本条的禁用变体。"""
        return form_key in {key_of(x) for x in self.blocked if key_of(x)}


@dataclass(frozen=True)
class Match:
    term: Term
    surface: str             # 原文表面形式
    form: str                # 归一化匹配键（用于判「不同写法」）
    start: int               # 原串起止（左闭右开）
    end: int
    key_start: int
    key_end: int

    @property
    def canonical(self) -> str:
        return self.term.canonical


@dataclass(frozen=True)
class _Form:
    term: Term
    key: str


class Glossary:
    """词表与最长匹配扫描器。同一匹配键先到先得（导入脚本已挡冲突）。

    装载分层词表时把 ``paper`` 放在前面，因此同名表面形式以论文表为准。
    """

    def __init__(self, terms):
        self.terms = tuple(terms)
        self._trie: dict = {}
        self._form_map: dict[str, _Form] = {}
        for term in self.terms:
            for raw in term.forms:
                key = key_of(raw)
                if not key or key in self._form_map:
                    continue
                form = _Form(term, key)
                self._form_map[key] = form
                node = self._trie
                for ch in key:
                    node = node.setdefault(ch, {})
                node.setdefault(_END, form)

    # ---- 词表查询 ----

    def __len__(self) -> int:
        return len(self.terms)

    def __bool__(self) -> bool:
        return bool(self.terms)

    @property
    def form_count(self) -> int:
        return len(self._form_map)

    @property
    def paper_terms(self) -> tuple:
        """只参与 TERM_VARIANT 的论文术语（workspace 词只查词）。"""
        return tuple(t for t in self.terms if t.source == "paper")

    def canonical_of(self, text: str) -> str | None:
        """整段文本恰好是某个表面形式时返回 canonical；否则 None。"""
        form = self._form_map.get(key_of(text))
        return form.term.canonical if form else None

    def covers(self, text: str) -> bool:
        """文本的每个非空白字符都被在册表面形式覆盖（可多词拼接）。"""
        key = key_of(text)
        if not key:
            return False
        covered = [False] * len(key)
        for match in self.matches(text):
            for pos in range(match.key_start, match.key_end):
                covered[pos] = True
        return all(covered)

    # ---- 最长匹配扫描 ----

    def matches(self, text: str) -> list[Match]:
        text = str(text)
        key, idx = _key_with_map(text)
        out: list[Match] = []
        i, n = 0, len(key)
        while i < n:
            node = self._trie
            j = i
            best = None
            while j < n:
                nxt = node.get(key[j])
                if nxt is None:
                    break
                node = nxt
                j += 1
                form = node.get(_END)
                if form is None:
                    continue
                start, end = idx[i], idx[j - 1] + 1
                if self._boundary_ok(text, start, end, form.key):
                    best = (form, j)
            if best is None:
                i += 1
                continue
            form, j = best
            start, end = idx[i], idx[j - 1] + 1
            out.append(Match(form.term, text[start:end], form.key,
                             start, end, i, j))
            i = j
        return out

    @staticmethod
    def _boundary_ok(text: str, start: int, stop: int, form_key: str) -> bool:
        """拉丁表面形式保留词边界；中文（含 CJK）表面形式不加边界。

        边界在原串上检查；原串里的空白与标点天然隔开单词，所以拉丁短语
        内部的空格/连字符差异不影响命中。
        """
        if _CJK_RE.search(form_key):
            return True
        if form_key and _is_latin_word(form_key[0]):
            if start > 0 and _is_orig_word(text[start - 1]):
                return False
        if form_key and _is_latin_word(form_key[-1]):
            if stop < len(text) and _is_orig_word(text[stop]):
                return False
        return True

    # ---- 供文风闸使用的小工具 ----

    def canonicalize(self, text: str) -> str:
        """把命中的表面形式替换为 canonical（只用于比对，不改正文）。"""
        matches = self.matches(text)
        if not matches:
            return text
        parts = []
        last = 0
        for match in matches:
            parts.append(text[last:match.start])
            parts.append(match.canonical)
            last = match.end
        parts.append(text[last:])
        return "".join(parts)

    def strip_terms(self, text: str) -> tuple[str, set]:
        """删掉命中的术语，返回（剩余文本, 命中的 canonical 集合）。"""
        matches = self.matches(text)
        if not matches:
            return text, set()
        parts = []
        last = 0
        canonicals = set()
        for match in matches:
            parts.append(text[last:match.start])
            last = match.end
            canonicals.add(match.canonical)
        parts.append(text[last:])
        return "".join(parts), canonicals


# --------------------------------------------------------------------------
# 装载
# --------------------------------------------------------------------------

def _source_for_path(path: Path) -> str:
    """按文件名判层：workspace.tsv → workspace；其余（含项目 glossary）→ paper。"""
    return "workspace" if "workspace" in path.stem.lower() else "paper"


def parse_glossary(text: str, source: str = "paper") -> Glossary:
    """解析 TSV；空行与 # 注释忽略，列名行忽略。

    第五列（可选）是 ``blocked(cn)``：禁用变体。它们**仍进匹配表**，这样
    同义归一能把禁用写法视同正名；``TERM_VARIANT`` 再按禁用变体单独报。
    """
    rows = []
    for raw in str(text).splitlines():
        line = raw.rstrip("\n")
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        cols = line.split("\t")
        canonical = cols[0].strip()
        if not canonical or canonical == "canonical":
            continue
        aliases_en = cols[1].split("|") if len(cols) > 1 else []
        aliases_cn = cols[2].split("|") if len(cols) > 2 else []
        category = cols[3].strip() if len(cols) > 3 else ""
        blocked = cols[4].split("|") if len(cols) > 4 else []
        blocked = [x.strip() for x in blocked if x.strip()]
        forms = [canonical]
        forms += [x.strip() for x in aliases_en if x.strip()]
        forms += [x.strip() for x in aliases_cn if x.strip()]
        forms += [x for x in blocked if x not in forms]
        rows.append(Term(len(rows), canonical, category or "未分类",
                         tuple(forms), tuple(blocked), source))
    return Glossary(rows)


def _load_glossary_file(path: Path, source: str | None = None) -> Glossary:
    return parse_glossary(path.read_text(encoding="utf-8"),
                          source or _source_for_path(path))


def load_glossary(path: str | Path | None = None) -> Glossary:
    """读词表。

    * 给定路径：只读该文件（项目 ``glossary.tsv`` 视为论文术语表）；
    * 未给路径：读仓内分层默认词表——``paper.tsv`` 在前、``workspace.tsv``
      在后，同名表面形式以论文表为准；文件缺失时跳过该层。
    """
    if path is not None:
        target = Path(path)
        if not target.is_file():
            return Glossary(())
        return _load_glossary_file(target)
    terms = []
    for target in (DEFAULT_PAPER_PATH, DEFAULT_WORKSPACE_PATH):
        if target.is_file():
            terms.extend(_load_glossary_file(target).terms)
    return Glossary(terms)
