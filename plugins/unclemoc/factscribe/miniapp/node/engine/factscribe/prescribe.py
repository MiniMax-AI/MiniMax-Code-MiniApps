# -*- coding: utf-8 -*-
"""处方层：只给「怎么改」的可执行处方，不参与判据、不产生分数。

契约见 ``docs/design/SPEC-PRESCRIPTION.md``。

硬边界：

* 本模块不 import ``style`` / ``terms`` / ``tide``；处方不产生 ``Finding``，
  不进 ``style`` 的 findings，也不改变任何退出码；
* 处方是数据：``factscribe/patterns/<name>/RULE.md``，六段固定结构；
* 冲突按 ``factscribe/patterns/priority.toml`` 的五级优先序裁决，序号小的胜，
  被压制的一条在输出里明写「让位」；
* 成功永远返回 0；只有用法/配置错才让 CLI 以 2 退出。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from .config import ConfigError, load_toml

PATTERNS_DIR = Path(__file__).resolve().parent / "patterns"
RULE_FILE = "RULE.md"
PRIORITY_FILE = "priority.toml"

#: 六段固定结构；「名称」来自一级标题 ``# 名称``，其余来自二级标题。
SECTION_KEYS = (
    "名称",
    "治的判据",
    "必做",
    "禁做（含反例）",
    "改写示例（旧 → 新）",
    "验收命令",
)
SECTION_HEADINGS = SECTION_KEYS[1:]

#: 冲突优先序（SPEC-PRESCRIPTION §3）。序号小的胜。
LEVELS = {"facts": 1, "structure": 2, "heading": 3, "term": 4, "style": 5}
LEVEL_LABELS = {
    "facts": "事实与数字",
    "structure": "结构完整",
    "heading": "标题指向内容",
    "term": "术语首现解释",
    "style": "文句风格",
}

NOTE = ("处方层不参与判据、不产生分数；style 的 findings 与退出码不受影响。")

_CODE_RE = re.compile(r"\b([A-Z][A-Z0-9_]{2,})\b")
_TARGET_LINE_RE = re.compile(r"^\s*[-*]\s*错误码\s*[：:]\s*(.+?)\s*$")


class PrescriptionError(ConfigError):
    """处方数据或优先序配置不合法（CLI 以 2 退出）。"""


@dataclass
class Prescription:
    """一条处方：原文、六段字段、绑定的错误码与优先序。"""

    name: str
    title: str
    target_codes: tuple[str, ...]
    sections: dict
    path: Path
    text: str
    level: str = ""
    level_number: int = 0
    level_label: str = ""

    @property
    def fields(self) -> dict:
        """六段视图：一级标题当「名称」，其余取二级标题正文。"""
        return {"名称": self.title, **self.sections}

    @property
    def priority(self) -> dict:
        return {"level": self.level, "number": self.level_number,
                "label": self.level_label}

    def as_dict(self, include_text: bool = True) -> dict:
        try:
            shown = self.path.relative_to(Path(__file__).resolve().parent.parent)
            shown_path = shown.as_posix()
        except ValueError:  # pragma: no cover - 仅当处方目录被挪到仓外
            shown_path = str(self.path)
        data = {
            "name": self.name,
            "title": self.title,
            "target_codes": list(self.target_codes),
            "priority": self.priority,
            "sections": dict(self.sections),
            "fields": self.fields,
            "path": shown_path,
        }
        if include_text:
            data["text"] = self.text
        return data


@dataclass(frozen=True)
class PriorityConfig:
    """优先序配置：级别、级别名、处方→级别、显式冲突对。"""

    levels: dict = field(default_factory=lambda: dict(LEVELS))
    labels: dict = field(default_factory=lambda: dict(LEVEL_LABELS))
    ranks: dict = field(default_factory=dict)
    conflicts: tuple = ()

    def level_of(self, name: str) -> str:
        if name not in self.ranks:
            raise PrescriptionError("处方 %r 没有在 priority.toml 的 [ranks] 里登记"
                                    % name)
        return self.ranks[name]

    def number_of(self, name: str) -> int:
        return self.levels[self.level_of(name)]

    def label_of(self, name: str) -> str:
        return self.labels[self.level_of(name)]


# --------------------------------------------------------------------------
# 优先序配置
# --------------------------------------------------------------------------

def _as_str(value, what: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise PrescriptionError("%s 必须是非空字符串，现在是 %r" % (what, value))
    return value.strip()


def _check_levels(raw) -> dict:
    if not isinstance(raw, dict):
        raise PrescriptionError("priority.toml 缺少 [levels] 表")
    levels = {}
    for key, value in raw.items():
        if not isinstance(value, int) or isinstance(value, bool):
            raise PrescriptionError("[levels].%s 必须是整数，现在是 %r"
                                    % (key, value))
        levels[str(key)] = value
    if levels != LEVELS:
        raise PrescriptionError(
            "[levels] 必须与规范一致（%s），现在是 %r"
            % (", ".join("%s=%d" % item for item in LEVELS.items()), levels))
    return levels


def _check_labels(raw, levels: dict) -> dict:
    if not isinstance(raw, dict):
        raise PrescriptionError("priority.toml 缺少 [names] 表")
    labels = {}
    for key in levels:
        labels[key] = _as_str(raw.get(key), "[names].%s" % key)
    unknown = sorted(set(raw) - set(levels))
    if unknown:
        raise PrescriptionError("[names] 有不认识的级别：%s" % "、".join(unknown))
    return labels


def _check_ranks(raw, levels: dict, path: Path) -> dict:
    if not isinstance(raw, dict) or not raw:
        raise PrescriptionError("%s 缺少 [ranks]（每条处方都要登记优先序）"
                                % path)
    ranks = {}
    for name, level in raw.items():
        name = _as_str(name, "[ranks] 的键")
        level = _as_str(level, "[ranks].%s" % name)
        if level not in levels:
            raise PrescriptionError(
                "[ranks].%s=%r 不是已登记级别（%s）"
                % (name, level, " / ".join(levels)))
        ranks[name] = level
    return ranks


def _check_conflicts(raw, ranks: dict, levels: dict) -> tuple:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise PrescriptionError("priority.toml 的 [[conflicts]] 必须是表数组")
    out = []
    seen = set()
    for item in raw:
        if not isinstance(item, dict):
            raise PrescriptionError("[[conflicts]] 里有非表条目：%r" % (item,))
        a = _as_str(item.get("a"), "[[conflicts]].a")
        b = _as_str(item.get("b"), "[[conflicts]].b")
        reason = _as_str(item.get("reason"), "[[conflicts]].reason")
        for name in (a, b):
            if name not in ranks:
                raise PrescriptionError("冲突对里的 %r 不在 [ranks] 里" % name)
        if a == b:
            raise PrescriptionError("冲突对不能自己和自己冲突：%r" % a)
        if levels[ranks[a]] == levels[ranks[b]]:
            raise PrescriptionError(
                "冲突对 %s / %s 落在同一序号 %d——优先序无法裁决"
                % (a, b, levels[ranks[a]]))
        key = tuple(sorted((a, b)))
        if key in seen:
            raise PrescriptionError("冲突对重复登记：%s / %s" % (a, b))
        seen.add(key)
        out.append({"a": a, "b": b, "reason": reason})
    return tuple(out)


def load_priority(path: Path | None = None) -> PriorityConfig:
    """读取并校验 ``patterns/priority.toml``。任何不一致都按配置错处理。"""
    path = Path(path) if path else PATTERNS_DIR / PRIORITY_FILE
    if not path.is_file():
        raise PrescriptionError("找不到优先序配置 %s" % path)
    data = load_toml(path)
    levels = _check_levels(data.get("levels"))
    labels = _check_labels(data.get("names"), levels)
    ranks = _check_ranks(data.get("ranks"), levels, path)
    conflicts = _check_conflicts(data.get("conflicts"), ranks, levels)
    return PriorityConfig(levels=levels, labels=labels, ranks=ranks,
                          conflicts=conflicts)


# --------------------------------------------------------------------------
# RULE.md 解析
# --------------------------------------------------------------------------

def _target_codes(section: str) -> tuple[str, ...]:
    """只认「- 错误码：…」条目行；散文里顺带提到的码不算绑定。"""
    found: list[str] = []
    for line in section.splitlines():
        m = _TARGET_LINE_RE.match(line)
        if not m:
            continue
        for code in _CODE_RE.findall(m.group(1)):
            if code not in found:
                found.append(code)
    return tuple(found)


def parse_rule(path: Path, name: str | None = None) -> Prescription:
    """解析一条 ``RULE.md``；缺段或没有错误码绑定即配置错（fail closed）。"""
    path = Path(path)
    if not path.is_file():
        raise PrescriptionError("找不到处方文件 %s" % path)
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise PrescriptionError("%s 不是合法 UTF-8：%s" % (path, exc))
    except OSError as exc:
        raise PrescriptionError("读不了 %s：%s" % (path, exc))

    title = ""
    sections: dict[str, str] = {}
    current: str | None = None
    buf: list[str] = []

    def flush() -> None:
        if current is not None:
            sections[current] = "\n".join(buf).strip()

    for line in text.splitlines():
        if line.startswith("## "):
            heading = line[3:].strip()
            if heading in SECTION_HEADINGS:
                flush()
                current = heading
                buf = []
                continue
        if current is None:
            if not title and line.startswith("# "):
                title = line[2:].strip()
            continue
        buf.append(line)
    flush()

    missing = [key for key in SECTION_HEADINGS
               if not sections.get(key, "").strip()]
    if not title:
        missing.insert(0, "名称")
    if missing:
        raise PrescriptionError(
            "%s 缺段：%s（六段固定结构见 SPEC-PRESCRIPTION §1）"
            % (path, "、".join(missing)))

    targets = _target_codes(sections["治的判据"])
    if not targets:
        raise PrescriptionError(
            "%s 没有错误码绑定：请在「治的判据」里写 "
            "`- 错误码：<CODE>`（SPEC-PRESCRIPTION §1.1）" % path)

    return Prescription(name=name or path.parent.name, title=title,
                        target_codes=targets, sections=sections,
                        path=path, text=text)


def load_prescriptions(patterns_dir: Path | None = None) -> dict[str, Prescription]:
    """装载全部处方，并挂上优先序。返回 {name: Prescription}。"""
    base = Path(patterns_dir) if patterns_dir else PATTERNS_DIR
    config = load_priority(base / PRIORITY_FILE)
    found: dict[str, Prescription] = {}
    for child in sorted(base.iterdir() if base.is_dir() else []):
        if not child.is_dir():
            continue
        rule = child / RULE_FILE
        if not rule.is_file():
            continue
        prescription = parse_rule(rule, name=child.name)
        if prescription.name in found:
            raise PrescriptionError("处方名重复：%r" % prescription.name)
        if prescription.name not in config.ranks:
            raise PrescriptionError(
                "处方 %r 没有在 priority.toml 的 [ranks] 里登记"
                % prescription.name)
        prescription.level = config.level_of(prescription.name)
        prescription.level_number = config.number_of(prescription.name)
        prescription.level_label = config.label_of(prescription.name)
        found[prescription.name] = prescription
    if not found:
        raise PrescriptionError("%s 下没有任何 <name>/RULE.md" % base)
    return found


# --------------------------------------------------------------------------
# 查询与冲突裁决
# --------------------------------------------------------------------------

def ordered(prescriptions: dict[str, Prescription]
            ) -> list[Prescription]:
    """按优先序（序号小在前）、再按名字排序。"""
    return sorted(prescriptions.values(),
                  key=lambda p: (p.level_number, p.name))


def prescriptions_for(code: str,
                      prescriptions: dict[str, Prescription] | None = None
                      ) -> list[Prescription]:
    """``--for <错误码>``：返回所有绑定该码的处方（按优先序）。"""
    code = (code or "").strip().upper()
    items = prescriptions if prescriptions is not None else load_prescriptions()
    return [p for p in ordered(items) if code in p.target_codes]


def resolve_conflicts(names: list[str],
                      prescriptions: dict[str, Prescription] | None = None,
                      config: PriorityConfig | None = None) -> dict:
    """按配置裁决冲突：序号小的胜；被压制者在 ``suppressed`` 里记「让位」。

    返回 ``{"order": [...names], "suppressed": {loser: {...}},
    "conflicts": [...]}``。``order`` 已按优先序排好；单条输入时不产生冲突。
    """
    items = prescriptions if prescriptions is not None else load_prescriptions()
    config = config if config is not None else load_priority()
    selected: list[str] = []
    for name in names:
        if name not in items:
            raise PrescriptionError("没有处方 %r；可用：%s"
                                    % (name, "、".join(sorted(items))))
        if name not in selected:
            selected.append(name)
    order = sorted(selected, key=lambda n: (items[n].level_number, n))
    suppressed: dict[str, dict] = {}
    conflicts: list[dict] = []
    for pair in config.conflicts:
        a, b = pair["a"], pair["b"]
        if a not in selected or b not in selected:
            continue
        na, nb = items[a].level_number, items[b].level_number
        if na == nb:  # 配置已在加载期拦截；这里再兜一层
            raise PrescriptionError(
                "冲突对 %s / %s 同序号 %d，无法裁决" % (a, b, na))
        winner, loser = (a, b) if na < nb else (b, a)
        win_n, lose_n = min(na, nb), max(na, nb)
        suppressed[loser] = {"by": winner, "reason": pair["reason"],
                             "winner_number": win_n, "loser_number": lose_n}
        conflicts.append({"winner": winner, "loser": loser,
                          "reason": pair["reason"],
                          "winner_number": win_n, "loser_number": lose_n})
    return {"order": order, "suppressed": suppressed, "conflicts": conflicts}


def render_bundle(names: list[str],
                  prescriptions: dict[str, Prescription] | None = None,
                  config: PriorityConfig | None = None) -> str:
    """多条处方一起输出：按优先序排列；被压制者显式写「让位」。"""
    items = prescriptions if prescriptions is not None else load_prescriptions()
    config = config if config is not None else load_priority()
    result = resolve_conflicts(names, items, config)
    total = len(result["order"])
    blocks: list[str] = []
    for idx, name in enumerate(result["order"], 1):
        p = items[name]
        lines = ["===== 处方 %d/%d：%s（优先序 %d %s）====="
                 % (idx, total, name, p.level_number, p.level_label)]
        yielding = result["suppressed"].get(name)
        if yielding:
            lines.append(
                "让位：与 %s 冲突（%s）；按优先序 %d < %d 让位，本处方不执行。"
                % (yielding["by"], yielding["reason"],
                   yielding["winner_number"], yielding["loser_number"]))
        lines.append("")
        lines.append(p.text.strip())
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks) + "\n"


def priority_payload(config: PriorityConfig | None = None) -> dict:
    config = config if config is not None else load_priority()
    return {
        "levels": dict(config.levels),
        "labels": dict(config.labels),
    }
