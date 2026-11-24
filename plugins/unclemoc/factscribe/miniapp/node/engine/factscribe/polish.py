# -*- coding: utf-8 -*-
"""润色工单：把 ``style`` 的命中翻译成「改什么、用什么处方、不许动什么」。

两条输出（见 ``docs/implementation/POLISH.md``）：

* ``polish --print``：打印写给执行改写的模型看的操作手册
  （数据文件 ``factscribe/patterns/PLAYBOOK.md``）；
* ``polish --plan <项目>``：扫 ``style`` 的命中，按处方优先序出一条工作单。

硬边界：

* **不新增判据**——命中集合直接来自 ``style.analyze`` 的 ``findings`` /
  ``advisories`` / ``info`` 三个通道，本模块只排序与注释；
* **处方映射直接读 ``prescribe``**——``prescriptions_for`` 按
  ``patterns/priority.toml`` 的优先序给出该码的处方；查不到就是一码一处方都没有；
* **没有处方的码一律标 ``无处方：只提示，不许为它改句子``**——这是防「为过规则
  而改坏」的最后一道闸；本模块不提供任何替代改法；
* 工作单不是闸门：成功永远退出 ``0``，配置/用法错才退出 ``2``。
"""
from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from pathlib import Path

from .config import ConfigError, load_config, load_sections
from .prescribe import (LEVELS, load_prescriptions, prescriptions_for)
from .style import analyze, load_style_rules

PLAYBOOK_FILE = Path(__file__).resolve().parent / "patterns" / "PLAYBOOK.md"

#: 没有处方的条目在「处方」列里必须逐字出现这一句。
NO_RX_NOTE = "无处方：只提示，不许为它改句子"
NO_RX_CONSTRAINT = "只作参考读数或整篇聚合，不是逐句改法；不许为它改句子。"

#: 无处方条目的排序位：排在全部五级优先序之后。
NO_RX_LEVEL = max(LEVELS.values()) + 1

#: 每条处方的「约束一句话」。只转述 RULE.md 的禁做要点，不是新判据。
CONSTRAINTS = {
    "heading-shorten": "只删修饰语压长度；对比对象、主语与关系词一项都不许少。",
    "heading-malformed": "只去标点与括号解释；关系词保留，两个对象一个不少。",
    "heading-subject-keep": "每个对比对象必须出现在新标题或本节首句里。",
    "section-completeness": "首段要有任务句与可检验结论句；不铺背景、不推后。",
    "term-first-sentence": "首句给定义或可检验断言；不许复述标题、垫话、设问。",
    "drop-the-proof": "删掉反射式解释，让断言自己站住；解释里的数字与条件不许丢。",
    "dash-rewrite": "破折号三种改法只挑一种；插入语里的信息与数字留在原处。",
    "unbury-the-verb": "把动作写成动词；宾语与限定不许为去名词而删。",
    "cut-the-de": "只拆「的」链；每句要有主谓，数字与读数不许丢。",
    "trim-to-budget": "只删重复的数字与举例、合并同义句；论点与每条论点的最后一条证据一条都不许少。",
    "thin-the-numbers": "只在起草阶段用；每个论点只留一条证据；改稿/验收阶段用 style --stage revision，不许删数字（项目内写 numeral_density_stage 不生效）。",
    "merge-overlap": "同一事实只留一个主节；后文只引用或留本节独有结论，数字与引用一条都不许丢。",
    "shift-to-implication": "把主语从「我们」换成对象或结论，补出「所以呢」；事实、数字与因果不许改。",
}


@dataclass(frozen=True)
class PlanEntry:
    """工作单的一行。字段顺序即输出顺序。"""

    index: int
    file: str
    line: int
    code: str
    prescription: str
    constraint: str

    @property
    def has_prescription(self) -> bool:
        return self.prescription != NO_RX_NOTE

    @property
    def location(self) -> str:
        return "%s:%d" % (self.file, self.line) if self.line else self.file

    def as_dict(self) -> dict:
        return {"index": self.index, "file": self.file, "line": self.line,
                "code": self.code, "prescription": self.prescription,
                "constraint": self.constraint}


@dataclass(frozen=True)
class Plan:
    project: str
    entries: tuple

    @property
    def prescribed(self) -> int:
        return sum(1 for e in self.entries if e.has_prescription)

    @property
    def no_prescription(self) -> int:
        return len(self.entries) - self.prescribed


# --------------------------------------------------------------------------
# 手册
# --------------------------------------------------------------------------

def playbook_text() -> str:
    """操作手册原文。缺文件是配置错（fail closed），不输出空手册。"""
    try:
        text = PLAYBOOK_FILE.read_text(encoding="utf-8")
    except OSError as exc:
        raise ConfigError("读不了操作手册 %s：%s" % (PLAYBOOK_FILE, exc))
    except UnicodeDecodeError as exc:
        raise ConfigError("%s 不是合法 UTF-8：%s" % (PLAYBOOK_FILE, exc))
    if not text.strip():
        raise ConfigError("操作手册 %s 是空的" % PLAYBOOK_FILE)
    return text if text.endswith("\n") else text + "\n"


# --------------------------------------------------------------------------
# 命中 → 工作单
# --------------------------------------------------------------------------

def scan(project: Path | str):
    """跑一次 ``style`` 的分析，返回 ``StyleResult``（与 ``style --json`` 同源）。"""
    cfg = load_config(Path(project))
    sections = load_sections(cfg)
    rules, rules_path = load_style_rules(cfg.root)
    return analyze(cfg, sections, rules, rules_path=rules_path)


def _hits(result) -> list:
    """三个通道的全部命中：findings、advisories（参考读数）、info（提示）。

    同一 (码, 文件, 行, 原文) 只留一次，防止通道重叠时重复出条目。
    """
    seen = set()
    out = []
    for group in (getattr(result, "findings", []),
                  getattr(result, "advisories", []),
                  getattr(result, "info", [])):
        for finding in group:
            key = (finding.code, finding.file, finding.line, finding.text)
            if key in seen:
                continue
            seen.add(key)
            out.append(finding)
    return out


def constraint_for(prescription_name: str) -> str:
    """约束一句话：处方取 CONSTRAINTS 的转述，无处方取固定红线。"""
    if prescription_name == NO_RX_NOTE:
        return NO_RX_CONSTRAINT
    return CONSTRAINTS.get(prescription_name,
                           "按 `prescribe %s` 的「必做／禁做」执行。"
                           % prescription_name)


def build_entries(result, prescriptions: dict | None = None) -> list[PlanEntry]:
    """把 ``StyleResult`` 的命中排成条目：优先序 → 文件 → 行 → 码 → 原文。"""
    items = prescriptions if prescriptions is not None else load_prescriptions()
    rows = []
    for finding in _hits(result):
        matched = prescriptions_for(finding.code, items)
        if matched:
            name = matched[0].name
            level = matched[0].level_number
        else:
            name, level = NO_RX_NOTE, NO_RX_LEVEL
        rows.append((level, finding.file, finding.line, finding.code,
                     finding.text, name))
    rows.sort(key=lambda row: row[:5])
    return [PlanEntry(index=index, file=row[1], line=row[2], code=row[3],
                      prescription=row[5],
                      constraint=constraint_for(row[5]))
            for index, row in enumerate(rows, 1)]


def build_plan(project: Path | str) -> Plan:
    shown = str(project)
    result = scan(project)
    return Plan(project=shown, entries=tuple(build_entries(result)))


def no_prescription_codes(prescriptions: dict | None = None) -> list[str]:
    """``style`` 全部错误码里没有任何处方的那批（含默认关闭的提示码）。"""
    from .style import CODE_OF

    items = prescriptions if prescriptions is not None else load_prescriptions()
    return sorted(code for code in set(CODE_OF.values())
                  if not prescriptions_for(code, items))


def plan_payload(plan: Plan) -> dict:
    return {
        "project": plan.project,
        "summary": {"total": len(plan.entries),
                    "prescribed": plan.prescribed,
                    "no_prescription": plan.no_prescription},
        "entries": [entry.as_dict() for entry in plan.entries],
    }


# --------------------------------------------------------------------------
# 人读工作单
# --------------------------------------------------------------------------

def _width(text: str) -> int:
    return sum(2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
               for ch in text)


def _pad(text: str, width: int, right: bool = False) -> str:
    gap = " " * (width - _width(text))
    return gap + text if right else text + gap


def render_plan(plan: Plan) -> str:
    lines = [
        "== factscribe polish --plan ==",
        "项目：%s" % plan.project,
        "条目：%d（有处方 %d，无处方 %d）"
        % (len(plan.entries), plan.prescribed, plan.no_prescription),
        "",
    ]
    if not plan.entries:
        lines.append("（没有命中：不需要润色。）")
        return "\n".join(lines)

    headers = ["序号", "文件:行", "错误码", "处方", "约束"]
    rows = [[str(e.index), e.location, e.code, e.prescription, e.constraint]
            for e in plan.entries]
    widths = [max(_width(row[i]) for row in [headers] + rows)
              for i in range(len(headers))]
    # 序号列右对齐，其余左对齐。
    lines.append("  ".join(_pad(h, widths[i], right=(i == 0))
                           for i, h in enumerate(headers)).rstrip())
    lines.append("  ".join("-" * widths[i] for i in range(len(headers))))
    for row in rows:
        lines.append("  ".join(_pad(cell, widths[i], right=(i == 0))
                               for i, cell in enumerate(row)).rstrip())
    return "\n".join(lines)
