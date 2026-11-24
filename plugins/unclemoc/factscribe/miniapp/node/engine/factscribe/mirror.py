# -*- coding: utf-8 -*-
"""双语双盘账本逐条比对（`factscribe mirror-check`）。

两个论文盘（paper-b ↔ paper-b-zh）靠人手保持账本一致：改了这边忘了另一边
没有任何工具会提醒，等到发现时两边账已经对不上了。本模块只做**读侧**的
机械比对——不写盘、不自动同步、不改正文（同步动作留给人与 git 流程）。

比对面（语义字段级，非字节级）：

* `facts/*.toml` 逐 id 比对承重字段（FACTS-SCHEMA.md §11.1 / SPEC-V3.0 §11.1）；
* `refs.bib` 条目级比对（key / title / author / year / doi / arXiv id）。

豁免面（合法差异，整体不判漂）：

* `sections/` 正文与 `main.tex` 导言区（翻译差异）；
* `GLOSSARY.md` 等单盘独有件；
* `figures/` 等生成物（重跑生成即可再生）；
* fact 的 `confidence`（带人签的置信升级）与 `note`（自由备注）——不比。

退出码照 factscribe 家规：**0**＝零漂移、**1**＝漂移红（逐条列盘/文件/id/
字段/两侧值）、**2**＝用法或结构错（缺 facts/ 目录等，不静默放行）。

本模块只读，不改任何既有模块的行为；错误码按不透明数据键处理
（`MIRROR_` 前缀），不进错误码词册。
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from dataclasses import field as dc_field
from pathlib import Path

from .citations import parse_bib
from .config import ConfigError, load_config, load_facts
from .facts import latex_display

# --------------------------------------------------------------------------
# 承重字段清单（比对面）
# --------------------------------------------------------------------------
# 卡片 CARD-G5 §3 写的是七字段（id/claim/value/display/source/source_sha256/
# expr／derived_from），工单 G5 写的是另一组七字段（id/value/source/
# source_sha256/locator/expr/kind）并要求「以 FACTS-SCHEMA.md 为准校正字段
# 清单」。两份规格的并集＝下面 9 个待比字段＋id 本身作匹配键，全部落在
# FACTS-SCHEMA.md §11.1 的字段表里（`kind` 是账模型里的合法取值位
# claim/config，见 SPEC §11.4 BAD_KIND）。两份规格都点名、又都被 §11.1
# 归一化口径覆盖的字段，一个都不漏；两份都没点名的注解位（role/dup_ok/
# supersedes/metric/…）按 §11.1「未知字段忽略」的前向兼容口径不参与比对。
LOAD_BEARING_FIELDS = (
    "claim",           # 人读断言（卡片点名；MVP 按「两盘逐字相同」的实盘口径判相等）
    "value",           # 规范数字形
    "display",         # 渲染形（比较前还原 LaTeX 转义，SPEC §11.1 归一化 3）
    "source",          # 证据路径
    "source_sha256",   # 内容锚（去 sha256: 前缀后比）
    "locator",         # 人在源里的定位
    "expr",            # 派生算式
    "derived_from",    # 派生父 id 集合
    "kind",            # claim/config
)
# 豁免字段：不进比对面（卡片 §3 豁免语义）。
EXEMPT_FACT_FIELDS = ("confidence", "note")

# bib 条目级比对字段（卡片 §3：key/title/author/year/doi 或 arXiv id）。
# `key` 作匹配键，`arxiv` 是逻辑字段名：取 eprint 或 arxiv 两种写法里的
# 那个（同一篇文献的两种写法不算漂）。
BIB_FIELDS = ("title", "author", "year", "doi", "arxiv")

# 漂移码（不透明数据键；不进错误码词册）。
CODE_FIELD_DRIFT = "MIRROR_FIELD_DRIFT"
CODE_MISSING_MIRROR = "MIRROR_MISSING_MIRROR"
CODE_EXTRA_MIRROR = "MIRROR_EXTRA_MIRROR"


# --------------------------------------------------------------------------
# 归一化（SPEC §11.1「归一化（写死）」）
# --------------------------------------------------------------------------
def _sha256_norm(value: str) -> str:
    """去 `sha256:` 前缀并小写化（§11.1 归一化 2）。"""
    v = (value or "").strip().lower()
    if v.startswith("sha256:"):
        v = v[len("sha256:"):]
    return v.strip()


def _doi_norm(value: str) -> str:
    """doi 归一：去 https://doi.org/ 前缀与 doi: 前缀，小写。"""
    v = (value or "").strip()
    v = re.sub(r"^https?://(dx\.)?doi\.org/", "", v, flags=re.I)
    v = re.sub(r"^doi:", "", v, flags=re.I)
    return v.strip().lower()


def _arxiv_norm(value: str) -> str:
    """arXiv id 归一：去 arXiv:/arXiv abs/pdf 链接前缀，小写。"""
    v = (value or "").strip()
    v = re.sub(r"^https?://arxiv\.org/(abs|pdf)/", "", v, flags=re.I)
    v = re.sub(r"^arxiv:", "", v, flags=re.I)
    return v.strip().lower()


def _fact_fields(fact) -> dict:
    """一条 fact 的承重字段取值（已按 §11.1 归一化口径收敛）。"""
    return {
        "claim": (fact.claim or "").strip(),
        "value": (fact.value or "").strip(),
        "display": [latex_display(d.get("text") or "")
                    for d in (fact.display or [])],
        "source": (fact.source or "").strip(),
        "source_sha256": _sha256_norm(fact.source_sha256),
        "locator": (fact.locator or "").strip(),
        "expr": (fact.expr or "").strip(),
        # 父 id 集合：顺序不是语义（§11.1 判重/引用按 casefold()）。
        "derived_from": sorted((str(x).strip().casefold()
                                for x in (fact.derived_from or []))),
        "kind": (fact.kind or "").strip(),
    }


def _bib_fields(entry) -> dict:
    """一条 bib 条目的比对字段取值。"""
    fields = entry.fields or {}
    arxiv = fields.get("arxiv") or fields.get("eprint") or ""
    return {
        "title": (fields.get("title") or "").strip(),
        "author": (fields.get("author") or "").strip(),
        "year": (fields.get("year") or "").strip(),
        "doi": _doi_norm(fields.get("doi") or ""),
        "arxiv": _arxiv_norm(arxiv),
    }


# --------------------------------------------------------------------------
# 结果模型
# --------------------------------------------------------------------------
@dataclass
class Drift:
    """一条漂移。

    `kind`：`field`＝同一 id/key 的字段值两侧不同；`missing`＝只在盘 A 有
    （缺镜像）；`extra`＝只在盘 B 有（B 多出来的一条）。
    """
    kind: str                 # field | missing | extra
    target: str               # fact | bib
    key: str                  # fact 的 id 或 bib 的 key
    field: str = ""           # 比对字段名（kind=field 时有意义）
    a_value: str = ""
    b_value: str = ""
    a_file: str = ""
    b_file: str = ""
    a_present: bool = True
    b_present: bool = True

    @property
    def code(self) -> str:
        if self.kind == "field":
            return CODE_FIELD_DRIFT
        if self.kind == "missing":
            return CODE_MISSING_MIRROR
        return CODE_EXTRA_MIRROR

    def as_dict(self) -> dict:
        return {
            "code": self.code,
            "kind": self.kind,
            "target": self.target,
            "id": self.key,
            "field": self.field,
            "disk_a": {"present": self.a_present, "file": self.a_file,
                       "value": self.a_value},
            "disk_b": {"present": self.b_present, "file": self.b_file,
                       "value": self.b_value},
        }


@dataclass
class MirrorResult:
    """一次双盘比对的结果。"""
    disk_a: Path
    disk_b: Path
    facts_a: int = 0
    facts_b: int = 0
    bib_a: int = 0
    bib_b: int = 0
    drifts: list = dc_field(default_factory=list)
    compared_fields: tuple = LOAD_BEARING_FIELDS
    compared_bib_fields: tuple = BIB_FIELDS

    @property
    def drift_count(self) -> int:
        return len(self.drifts)

    @property
    def exit_code(self) -> int:
        """0＝零漂移；1＝漂移红。结构错由 ConfigError 走 exit 2。"""
        return 1 if self.drifts else 0

    def summary(self) -> dict:
        return {
            "facts_a": self.facts_a,
            "facts_b": self.facts_b,
            "bib_a": self.bib_a,
            "bib_b": self.bib_b,
            "drift_count": self.drift_count,
            "fact_fields_compared": list(self.compared_fields),
            "fact_fields_exempt": list(EXEMPT_FACT_FIELDS),
            "bib_fields_compared": list(self.compared_bib_fields),
        }


# --------------------------------------------------------------------------
# 比对
# --------------------------------------------------------------------------
def _load_disk(root: Path, label: str):
    """读一个盘：项目声明＋事实账＋参考文献。

    结构错一律 ConfigError（exit 2，不静默放行）。
    """
    if not root.exists():
        raise ConfigError("%s 不存在：%s" % (label, root),
                          code="MIRROR_DISK_MISSING")
    if not root.is_dir():
        raise ConfigError("%s 不是目录：%s" % (label, root),
                          code="MIRROR_DISK_INVALID")
    try:
        cfg = load_config(root)
    except ConfigError as exc:
        raise ConfigError("%s：%s" % (label, exc),
                          code="MIRROR_CONFIG_INVALID")
    files = sorted(p for p in cfg.root.glob(cfg.facts_glob) if p.is_file())
    if not files:
        raise ConfigError(
            "%s 没有事实账：%s 下匹配不到任何 *.toml 事实文件"
            "（facts 目录形如 %s）" % (label, cfg.root, cfg.facts_glob),
            code="MIRROR_FACTS_MISSING")
    bib_path = cfg.root / cfg.bib
    if not bib_path.is_file():
        raise ConfigError("%s 没有参考文献：%s" % (label, bib_path),
                          code="MIRROR_BIB_MISSING")
    try:
        facts = load_facts(cfg)
    except ConfigError as exc:
        raise ConfigError("%s：%s" % (label, exc),
                          code="MIRROR_FACTS_INVALID")
    try:
        entries = parse_bib(bib_path, cfg.root)
    except ConfigError as exc:
        raise ConfigError("%s：%s" % (label, exc),
                          code="MIRROR_BIB_INVALID")
    return cfg, facts, entries


def _fmt_value(value) -> str:
    if isinstance(value, (list, tuple)):
        if not value:
            return "（空）"
        return "；".join(str(v) for v in value)
    text = str(value or "")
    return text if text else "（空）"


def _compare_maps(a_items: dict, b_items: dict, a_files: dict, b_files: dict,
                  fields: tuple, target: str,
                  a_labels: dict = None, b_labels: dict = None) -> list:
    """逐 key 逐字段比对两侧字典，返回漂移列表。

    key 两侧都有 → 比每个字段；只在 A 有 → 缺镜像；只在 B 有 → 多出来。
    `a_labels`/`b_labels` 给的是 key 的原样写法（匹配按 casefold，报告按
    原样 id／key）。
    """
    a_labels = a_labels or {}
    b_labels = b_labels or {}
    drifts = []
    for key in sorted(a_items):
        a_fields = a_items[key]
        label = a_labels.get(key, key)
        if key not in b_items:
            drifts.append(Drift(
                kind="missing", target=target, key=label,
                a_file=a_files.get(key, ""), b_file="",
                a_present=True, b_present=False))
            continue
        b_fields = b_items[key]
        for name in fields:
            a_value = a_fields.get(name)
            b_value = b_fields.get(name)
            if a_value == b_value:
                continue
            drifts.append(Drift(
                kind="field", target=target, key=label, field=name,
                a_value=_fmt_value(a_value), b_value=_fmt_value(b_value),
                a_file=a_files.get(key, ""), b_file=b_files.get(key, ""),
                a_present=True, b_present=True))
    for key in sorted(b_items):
        if key in a_items:
            continue
        drifts.append(Drift(
            kind="extra", target=target, key=b_labels.get(key, key),
            a_file="", b_file=b_files.get(key, ""),
            a_present=False, b_present=True))
    return drifts


def check(disk_a: Path, disk_b: Path) -> MirrorResult:
    """比对两个盘的事实账与参考文献。

    只读。零漂移返回 `exit_code == 0`；有漂移返回 1；结构错抛 ConfigError
    （由 CLI 转成 exit 2）。
    """
    disk_a = Path(disk_a)
    disk_b = Path(disk_b)
    cfg_a, facts_a, bib_a = _load_disk(disk_a, "盘A")
    cfg_b, facts_b, bib_b = _load_disk(disk_b, "盘B")

    # facts：按 id 配对（§11.1：判重与引用解析都按 casefold()；报告按原样 id）。
    a_items, a_files, a_labels = {}, {}, {}
    for fact in facts_a:
        key = fact.id.strip().casefold()
        a_items[key] = _fact_fields(fact)
        a_files[key] = fact.file
        a_labels[key] = fact.id.strip()
    b_items, b_files, b_labels = {}, {}, {}
    for fact in facts_b:
        key = fact.id.strip().casefold()
        b_items[key] = _fact_fields(fact)
        b_files[key] = fact.file
        b_labels[key] = fact.id.strip()

    drifts = _compare_maps(a_items, b_items, a_files, b_files,
                           LOAD_BEARING_FIELDS, "fact", a_labels, b_labels)

    # bib：按条目 key 配对（key 是引用面的稳定标识）。
    a_items, a_files = {}, {}
    for entry in bib_a:
        a_items[entry.key] = _bib_fields(entry)
        a_files[entry.key] = entry.file
    b_items, b_files = {}, {}
    for entry in bib_b:
        b_items[entry.key] = _bib_fields(entry)
        b_files[entry.key] = entry.file

    drifts += _compare_maps(a_items, b_items, a_files, b_files,
                            BIB_FIELDS, "bib")

    return MirrorResult(
        disk_a=cfg_a.root, disk_b=cfg_b.root,
        facts_a=len(facts_a), facts_b=len(facts_b),
        bib_a=len(bib_a), bib_b=len(bib_b),
        drifts=drifts,
    )


# --------------------------------------------------------------------------
# 报告
# --------------------------------------------------------------------------
def drift_dicts(result: MirrorResult) -> list:
    return [d.as_dict() for d in result.drifts]


def render(result: MirrorResult) -> str:
    """人读报告：逐条列「漂移件＋盘＋字段＋两侧值」。"""
    lines = ["== factscribe mirror-check ==",
             "盘A：%s" % result.disk_a,
             "盘B：%s" % result.disk_b,
             "比对面：facts %d↔%d 条 × %d 承重字段；bib %d↔%d 条 × %d 字段"
             % (result.facts_a, result.facts_b, len(result.compared_fields),
                result.bib_a, result.bib_b, len(result.compared_bib_fields)),
             "豁免面：sections/ 正文、main.tex 导言区、GLOSSARY.md、生成物、"
             "fact 的 %s（人签升级不判漂）" % "/".join(EXEMPT_FACT_FIELDS)]
    if not result.drifts:
        lines.append("零漂移：两侧承重字段逐条一致（%d 条 fact ＋ %d 条 bib 条目）。"
                     % (result.facts_a, result.bib_a))
        return "\n".join(lines)

    lines.append("漂移 %d 项：" % result.drift_count)
    for i, d in enumerate(result.drifts, 1):
        what = "fact" if d.target == "fact" else "bib 条目"
        if d.kind == "field":
            lines.append("  %d) [%s] %s %s" % (i, d.code, what, d.key))
            lines.append("     字段：%s" % d.field)
            lines.append("     盘A（%s）= 「%s」" % (d.a_file or "—", d.a_value))
            lines.append("     盘B（%s）= 「%s」" % (d.b_file or "—", d.b_value))
        elif d.kind == "missing":
            lines.append("  %d) [%s] %s %s —— 缺镜像"
                         % (i, d.code, what, d.key))
            lines.append("     盘A 有（%s）；盘B 无此 %s"
                         % (d.a_file or "—", "id" if d.target == "fact" else "key"))
        else:
            lines.append("  %d) [%s] %s %s —— 只在盘B 多出来"
                         % (i, d.code, what, d.key))
            lines.append("     盘B 有（%s）；盘A 无此 %s"
                         % (d.b_file or "—", "id" if d.target == "fact" else "key"))
    return "\n".join(lines)
