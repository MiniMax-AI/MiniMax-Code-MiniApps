# -*- coding: utf-8 -*-
"""写作简报：把起草要遵守的全部约束从账里生成（SPEC-BRIEF，批 126）。

``brief`` 不判断文字好坏，只把账里的材料摆齐：项目名与节结构、可用主张与
数字、术语正名与禁用变体、五条硬约束、验收命令。写给写作模型读，不是审计
报告——所以事实表只列 ``claim`` / ``value``，不列 ``source``。

硬边界：

* **只读账**：事实来自 ``config.load_facts``，术语来自 ``terms.load_glossary``，
  节清单来自 ``config.load_sections`` 与主文件的 ``\\input`` 顺序；本模块不
  新写第二套解析，不推导、不换算、不补全数字；
* **不新增判据**：本命令不产生红/黄/绿，成功永远退出 ``0``；
* **确定输出**：同输入两跑逐字节一致，不写时间戳、不写绝对路径。

规范见 ``docs/design/SPEC-BRIEF.md``。
"""
from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass
from pathlib import Path

from .config import (Config, ConfigError, load_config, load_facts,
                     load_sections, section_budget, section_evidence)
from .evidence import suggest_evidence
from .style import _headings                     # 复用既有标题抽取，不另写一套
from .terms import Term, load_glossary
from .textio import read_text_exact, to_lf
from .texrules import strip_comments_and_verbatim
from .texscan import scan_tex

#: 五条硬约束（结构冻结；改这里等于改规范，必须同步 SPEC-BRIEF §3.4）。
CONSTRAINTS = (
    "不许编数字：正文里的每个数字都必须来自第 2 节，并用 `\\fact{id}` 绑定；"
    "id 与表中逐字一致，表外的数字一律不许写。",
    "标题不带冒号（`：` / `:`）、问号（`？` / `?`）与句号（`。` / `.`）；"
    "行内标题（如 `\\paragraph`）除外。",
    "不用插入式破折号（`——` / `—`）；改用逗号、括号或拆句。",
    "术语首次出现要在首句解释：给定义或可检验的断言，不许只报名字。",
    "不写「首先／其次／最后」式排比；按论证需要组织句子，不按序数词铺陈。",
)

_OPENING = "本件由 `factscribe brief` 从项目账里生成：只给写作依据，不判断文字好坏。"

_INPUT_RE = re.compile(r"\\(?:input|include)\s*\{([^{}]*)\}")


@dataclass(frozen=True)
class SectionRow:
    """节清单的一行：相对文件、当前标题、该节已绑定的事实条数、篇幅预算、
    人声明必须引用的事实。"""

    file: str
    title: str
    facts: int
    budget: int = 0     # 0＝没有可用预算（写「—」）
    evidence: tuple = ()  # 批 131：`[evidence]` 声明的 fact id（空＝「—」）
    # 批 132：清单来源——declared（`[evidence]`）/ suggested（现状快照，
    # 未冻结）/ none（本节没有引用任何 fact）。
    evidence_source: str = "none"

    def as_dict(self) -> dict:
        return {"file": self.file, "title": self.title, "facts": self.facts,
                "budget": self.budget, "evidence": list(self.evidence),
                "evidence_source": self.evidence_source}


@dataclass(frozen=True)
class Brief:
    project: str          # 项目名（name 优先，其次 title），不打印路径
    root_tex: str         # 主文件相对路径；空＝按文件名排序
    section: str          # --section 前缀；空＝全项目
    sections: tuple       # tuple[SectionRow]
    facts: tuple          # tuple[Fact]，账本装载顺序
    terms: tuple          # tuple[Term]，词表行序
    notes: tuple          # 文首说明（节过滤时的全列提示等）
    facts_total: int = 0  # 账上的全部事实条数（不含节过滤）

    def shown_fact_count(self) -> int:
        return len(self.facts)


# --------------------------------------------------------------------------
# 节清单：主文件 \input 顺序
# --------------------------------------------------------------------------

def _root_tex(cfg: Config) -> str:
    """主文件：root_tex 优先；没有则项目根 main.tex；再没有就空串。"""
    if cfg.root_tex:
        return cfg.root_tex
    if (cfg.root / "main.tex").is_file():
        return "main.tex"
    return ""


def _resolve_ref(cfg: Config, root_rel: str, ref: str) -> str | None:
    """把 ``\\input{...}`` 的目标解成项目内相对路径；不存在返回 None。"""
    ref = str(ref or "").strip().replace("\\", "/")
    if not ref or "\\" in ref or "#" in ref:
        return None
    root_file = cfg.root / root_rel
    for base in (root_file.parent, cfg.root):
        candidate = base / ref
        options = [candidate]
        if candidate.suffix != ".tex":
            options.append(base / (ref + ".tex"))
        for path in options:
            if not path.is_file():
                continue
            try:
                return path.resolve().relative_to(cfg.root.resolve()).as_posix()
            except ValueError:
                continue
    return None


def _input_order(cfg: Config, known: set[str]) -> list[str]:
    """主文件里 ``\\input`` / ``\\include`` 的出现顺序（只留实际存在且已装载的）。"""
    root_rel = _root_tex(cfg)
    root_file = cfg.root / root_rel if root_rel else None
    if root_file is None or not root_file.is_file():
        return []
    try:
        text = to_lf(read_text_exact(root_file))
    except (OSError, UnicodeDecodeError):
        return []
    body = strip_comments_and_verbatim(text)
    order: list[str] = []
    for match in _INPUT_RE.finditer(body):
        rel = _resolve_ref(cfg, root_rel, match.group(1))
        if rel and rel in known and rel != root_rel and rel not in order:
            order.append(rel)
    return order


def _section_candidates(cfg: Config, loaded: list[str],
                        order: list[str]) -> list[str]:
    """哪些已装载文件算「节」：显式清单 → sections 目录约定 → 主文件输入。"""
    known = set(loaded)
    if cfg.section_files:
        return [rel for rel in cfg.section_files if rel in known]
    pattern = cfg.sections_glob
    if "*" in pattern:
        return sorted(rel for rel in loaded if fnmatch.fnmatch(rel, pattern))
    # V3 的 sections_glob 常被 root_tex 占位；退到「主文件输入、去掉工具目录」。
    return [rel for rel in order if not rel.startswith("audit/")]


def _first_title(text: str) -> str:
    """该文件第一个标题命令的文字；优先 section/chapter，没有标题返回空串。"""
    heads = _headings(text)
    if not heads:
        return ""
    for head in heads:
        if head["cmd"] in ("part", "chapter", "section"):
            return head["title"]
    return heads[0]["title"]


def _bound_fact_ids(text: str) -> set[str]:
    """该文件里 ``\\fact{ID}`` 绑定到的不同 fact id。"""
    return {fid.strip() for fid, _line in scan_tex(text).markers if fid.strip()}


def bound_fact_ids(text: str) -> tuple:
    """该文件里绑到的不同 fact id（确定顺序的列表）。

    与 ``_bound_fact_ids`` 同一口径，只是给出**排序后**的列表——
    工作台的简报读数要按「这一节已回账哪些数」逐条列出来。
    """
    return tuple(sorted(_bound_fact_ids(text)))


def build_sections(cfg: Config, sections: list[tuple[str, str]]
                   ) -> list[SectionRow]:
    """按主文件 ``\\input`` 顺序出节清单；未出现在主文件里的节按文件名补在后面。"""
    loaded = [rel for rel, _text in sections]
    texts = dict(sections)
    order = _input_order(cfg, set(loaded))
    candidates = _section_candidates(cfg, loaded, order)
    chosen: list[str] = []
    for rel in order:
        if rel in candidates and rel not in chosen:
            chosen.append(rel)
    for rel in sorted(candidates):
        if rel not in chosen:
            chosen.append(rel)
    rows: list[SectionRow] = []
    # 批 132：没有 `[evidence]` 声明的节，用 --suggest 的即时结果（未冻结）。
    suggestions = suggest_evidence(sections)
    for rel in chosen:
        text = texts.get(rel, "")
        key = Path(rel).stem
        if key in (getattr(cfg, "evidence_sections", {}) or {}):
            evidence = section_evidence(cfg, rel)
            source = "declared" if evidence else "none"
        else:
            evidence = tuple(suggestions.get(key, ()))
            source = "suggested" if evidence else "none"
        rows.append(SectionRow(file=rel, title=_first_title(text),
                               facts=len(_bound_fact_ids(text)),
                               budget=section_budget(cfg, rel),
                               evidence=evidence, evidence_source=source))
    return rows


# --------------------------------------------------------------------------
# 组装
# --------------------------------------------------------------------------

def _load_terms(cfg: Config) -> tuple[Term, ...]:
    """项目根 glossary.tsv 优先，否则仓内分层词表（与 style 同一解析顺序）。"""
    project_glossary = cfg.root / "glossary.tsv"
    glossary = (load_glossary(project_glossary) if project_glossary.is_file()
                else load_glossary())
    terms = glossary.paper_terms
    return tuple(terms) if terms else tuple(glossary.terms)


def _filter_facts(facts: list, prefix: str) -> tuple[list, str]:
    """按节前缀过滤 fact id；过滤不到任何一条时全列并给出文首说明。"""
    if not prefix:
        return list(facts), ""
    hit = [f for f in facts if f.id.strip().casefold().startswith(
        prefix.casefold())]
    if hit:
        return hit, ""
    return list(facts), (
        "本节简报的事实无法按 id 前缀 `%s` 过滤（账里的 id 不以节前缀命名），"
        "故「可用主张与数字」全列 %d 条。" % (prefix, len(facts)))


def build_brief(project: Path | str, section: str | None = None) -> Brief:
    """读项目账并组装简报。没有事实/节、节前缀匹配不到一律 fail closed。"""
    root = Path(project)
    cfg = load_config(root)

    facts = load_facts(cfg)
    if not facts:
        raise ConfigError(
            "facts 为空（%s 没匹配到任何 fact）——没有可用主张与数字，"
            "简报无从生成；请先补账。" % cfg.facts_glob)

    sections = load_sections(cfg)
    sections = [(rel, to_lf(text)) for rel, text in sections]
    rows = build_sections(cfg, sections)
    if not rows:
        raise ConfigError(
            "sections 为空（%s 没匹配到任何节文件）——没有可写的节，简报无从生成。"
            % cfg.sections_glob)

    prefix = (section or "").strip()
    if section is not None and not prefix:
        raise ConfigError("--section 不能给空串（给节文件名词干前缀，例：04）")
    if prefix:
        matched = [row for row in rows if Path(row.file).stem.startswith(prefix)]
        if not matched:
            raise ConfigError(
                "--section %s 没匹配到任何节文件（按文件名词干前缀匹配；"
                "现有节：%s）" % (prefix, "、".join(Path(r.file).stem
                                                   for r in rows)))
    else:
        matched = rows

    shown_facts, note = _filter_facts(facts, prefix)
    notes = (note,) if note else ()

    name = (cfg.name or cfg.title or "").strip() or "（未命名项目）"
    return Brief(project=name, root_tex=_root_tex(cfg) or "",
                 section=prefix, sections=tuple(matched),
                 facts=tuple(shown_facts), terms=_load_terms(cfg),
                 notes=notes, facts_total=len(facts))


# --------------------------------------------------------------------------
# 渲染（Markdown，写给 LLM 读）
# --------------------------------------------------------------------------

def _cell(value) -> str:
    """表格单元格：空值写 —，竖线转义，换行压成空格。"""
    text = str(value if value not in (None, "") else "—")
    return " ".join(text.split()).replace("|", "\\|")


def _alias_forms(term: Term) -> list[str]:
    """可用别名：去掉正名与禁用变体后剩下的表面形式（保持词表顺序）。"""
    blocked = {x for x in term.blocked if x}
    out: list[str] = []
    for form in term.forms:
        if form and form != term.canonical and form not in blocked:
            if form not in out:
                out.append(form)
    return out


def render(brief: Brief) -> str:
    """五节 Markdown；不写时间戳、不写绝对路径。"""
    lines: list[str] = ["# 写作简报：%s" % brief.project, ""]
    for note in brief.notes:
        lines.append("> %s" % note)
    if brief.notes:
        lines.append("")
    lines.append("> %s" % _OPENING)
    lines.append("")

    # ---- 1. 写作任务 ----
    lines.append("## 1. 写作任务")
    lines.append("")
    lines.append("- 项目名：%s" % brief.project)
    if brief.root_tex:
        lines.append("- 主文件：`%s`（节清单按它的 `\\input` 顺序）"
                     % brief.root_tex)
    else:
        lines.append("- 主文件：无（节清单按 `sections/` 文件名排序）")
    lines.append("- 节清单：")
    lines.append("")
    lines.append("| # | 文件 | 当前标题 | 该节已有事实条数 | 篇幅预算 | 必须引用的事实 |")
    lines.append("| --- | --- | --- | --- | --- | --- |")
    for index, row in enumerate(brief.sections, 1):
        cell = "、".join(row.evidence) if row.evidence else ""
        if row.evidence_source == "suggested":
            cell += "（未冻结）"
        lines.append("| %d | `%s` | %s | %d | %s | %s |"
                     % (index, row.file, _cell(row.title or "（无标题）"),
                        row.facts,
                        str(row.budget) if row.budget else "—",
                        _cell(cell)))
    lines.append("")
    lines.append("「必须引用的事实」取自 `[evidence]`（人钉清单：这些 id 必须出现在"
                 "该节的正文里，缺一条即红 `REQUIRED_EVIDENCE_MISSING`）；某节没有"
                 "声明时，用 `evidence --suggest` 的现状快照填上并标「未冻结」——"
                 "这类清单还没有进 `audit/evidence.lock`，改动不受 EVIDENCE_SET_CHANGED 管。"
                 "没有引用任何 fact 的节写「—」，不表示可以少写。")

    # ---- 2. 可用主张与数字 ----
    lines.append("## 2. 可用主张与数字")
    lines.append("")
    lines.append("正文必须用 `\\fact{id}` 绑定：id 与下表逐字一致，表外的数字"
                 "一律不许写。只列主张与数字，来源见账本，不在本简报里。")
    lines.append("")
    lines.append("| id | claim（一句话主张） | value（可用数字） |")
    lines.append("| --- | --- | --- |")
    for fact in brief.facts:
        lines.append("| `%s` | %s | %s |"
                     % (_cell(fact.id), _cell(fact.claim), _cell(fact.value)))
    lines.append("")

    # ---- 3. 术语表 ----
    lines.append("## 3. 术语表")
    lines.append("")
    lines.append("同一概念全篇只用正名；「禁用变体」一列出现即判违规。")
    lines.append("")
    lines.append("| 正名（canonical） | 类别 | 可用别名 | 禁用变体 |")
    lines.append("| --- | --- | --- | --- |")
    if brief.terms:
        for term in brief.terms:
            lines.append("| %s | %s | %s | %s |"
                         % (_cell(term.canonical), _cell(term.category),
                            _cell("、".join(_alias_forms(term))),
                            _cell("、".join(term.blocked))))
    else:
        lines.append("| — | — | — | — |")
    lines.append("")

    # ---- 4. 硬约束 ----
    lines.append("## 4. 硬约束")
    lines.append("")
    for index, rule in enumerate(CONSTRAINTS, 1):
        lines.append("%d. %s" % (index, rule))
    lines.append("")

    # ---- 5. 验收 ----
    lines.append("## 5. 验收")
    lines.append("")
    lines.append("交稿前必须跑这两条命令（占位符换成实际目录）：")
    lines.append("")
    lines.append("```bash")
    lines.append("python3 -m factscribe audit <项目目录> --build")
    lines.append("python3 -m factscribe review --before <改前目录> --after <改后目录>")
    lines.append("```")
    lines.append("")
    lines.append("- **红＝不许交**：出现红（退出码 1）即打回，改正后重跑。")
    lines.append("- **黄＝要人看**：黄（退出码 3）不阻断，但必须由人逐条看过再决定。")
    lines.append("- **绿＝可以交**：退出码 0 才算通过。")
    return "\n".join(lines)


def payload(brief: Brief) -> dict:
    """``--json`` 的稳定载荷（不含 source / 绝对路径）。"""
    return {
        "project": brief.project,
        "root_tex": brief.root_tex,
        "section": brief.section or None,
        "facts_total": brief.facts_total,
        "sections": [row.as_dict() for row in brief.sections],
        "facts": [{"id": f.id, "claim": f.claim, "value": f.value}
                  for f in brief.facts],
        "terms": [{"canonical": t.canonical, "category": t.category,
                   "aliases": _alias_forms(t), "blocked": list(t.blocked)}
                  for t in brief.terms],
        "notes": list(brief.notes),
    }
