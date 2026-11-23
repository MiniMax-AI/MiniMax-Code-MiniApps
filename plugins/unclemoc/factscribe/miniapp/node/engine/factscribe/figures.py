# -*- coding: utf-8 -*-
"""账本驱动的图表生成与四面对账（`factscribe figures`）。

人填图规格（`figures/*.fig.toml`），机器机械出产物：

* `figures/gen/<名>.tex` —— pgfplots 画图代码（可独立编译出 PDF）；
* `figures/gen/<名>.csv` —— 随图数据（既有 `FIGURE_UNVERIFIED` 判定的对账物）；
* `figures/gen/<名>.bind.toml` —— 绑定表：每个数据点 ↔ fact id ↔ 生成时的
  值与 `source_sha256`；另有项目级汇总 `figures/bind.toml`（同一份数据按图分组）。

身份审：**图型与规格由人定，机器只保证「图上每个数都能回账本」**。规格里的
数据点只许引 fact id；出现裸数字即配置错（exit 2）——图里从此没有账外自由
数字。机器不做「智能荐图」，也不替人挑数据点（卡 CARD-G2 §4）。

命令：

* `factscribe figures gen <项目>`：读规格＋账本 → 出产物；覆盖旧产物**前**
  先比对旧绑定表并打印差异（卡 §3）。
* `factscribe figures check <项目>`：四面数据点比对——规格 ↔ 绑定表 ↔ 随图
  CSV ↔ 现行账本。账动过而图未重生成必红（逐点点名）。

退出码：**0**＝绿、**1**＝红（账改图旧／解引失败／四面不齐）、**2**＝配置或
用法错（规格格式错：未知图型、缺数据点、裸数字）。无图规格时 `gen`/`check`
报「无图可生成」并 exit 0（skip，不静默放行）。

本模块零第三方依赖、零网络、零 LLM；错误码按不透明数据键处理（`FIG_` 前缀），
不进错误码词册。
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from dataclasses import field as dc_field
from pathlib import Path

from .config import (Config, ConfigError, facts_digest, find_config_file,
                     load_config, load_facts, load_toml)
from .facts import canon_text, latex_display
from .scaffold import toml_string

# --------------------------------------------------------------------------
# 契约常量
# --------------------------------------------------------------------------
SPEC_DIR = "figures"
SPEC_GLOB = "figures/*.fig.toml"
GEN_DIR = "figures/gen"
BIND_INDEX = "figures/bind.toml"
BIND_SCHEMA = "factscribe-figbind/1.0"

# 图型（MVP：bar / line / table 三型；扩型按需另批）。
KINDS = ("bar", "line", "table")

# 规格表认识的键（闭集：写错键名要报错，不许默默忽略）。
SPEC_KEYS = ("name", "kind", "caption", "xlabel", "ylabel", "data", "labels")

# 嵌套形态的规格：`[figure]` 表（图型与文字位）＋ `[[point]]` 表数组（数据点）。
# 外行手写的最小规格多半长这样；本工具把它摊平成上面那套扁平键，
# 两种形态只走一套判据（见 `_flatten_nested_spec`）。
NESTED_FIGURE_KEYS = ("name", "kind", "caption", "xlabel", "ylabel")
NESTED_POINT_KEYS = ("fact_id", "label")

_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")
_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")
# 「自由数字」＝**独立**的数字token：前后不挨着字母/数字/下划线。
# "X1"、"A1" 这类**标识符里的数字**不是自由数字（图上那个 "1" 是名字的一部分，
# 不是一笔账外数字）；"56.25"、"Figure 1"、"n=3" 是。
_FREE_NUM_RE = re.compile(
    r"(?<![A-Za-z0-9_])[-+]?\d+(?:[.,]\d+)*(?:%|\\%)?(?![A-Za-z0-9_])")
_PLAIN_NUM_RE = re.compile(r"^[+-]?\d+(?:\.\d+)?$")
_FRACTION_RE = re.compile(r"^([+-]?\d+(?:\.\d+)?)\s*/\s*([+-]?\d+(?:\.\d+)?)$")

# 错误码（不透明数据键；不进错误码词册）。
CODE_BARE_NUMBER = "FIG_BARE_NUMBER"
CODE_SPEC_BAD_KIND = "FIG_SPEC_BAD_KIND"
CODE_SPEC_NO_POINTS = "FIG_SPEC_NO_POINTS"
CODE_SPEC_BAD_DATA = "FIG_SPEC_BAD_DATA"
CODE_SPEC_BAD_ID = "FIG_SPEC_BAD_ID"
CODE_SPEC_UNKNOWN_KEY = "FIG_SPEC_UNKNOWN_KEY"
CODE_SPEC_BAD_NAME = "FIG_SPEC_BAD_NAME"
CODE_SPEC_BAD_LABELS = "FIG_SPEC_BAD_LABELS"
CODE_SPEC_UNIT_MIXED = "FIG_SPEC_UNIT_MIXED"
CODE_SPEC_UNPLOTTABLE = "FIG_SPEC_UNPLOTTABLE"
CODE_FACT_NOT_FOUND = "FIG_FACT_NOT_FOUND"
CODE_FACTS_INVALID = "FIG_FACTS_INVALID"
CODE_VALUE_DRIFT = "FIG_VALUE_DRIFT"
CODE_SOURCE_DRIFT = "FIG_SOURCE_DRIFT"
CODE_CSV_DRIFT = "FIG_CSV_DRIFT"
CODE_CSV_ROW_DRIFT = "FIG_CSV_ROW_DRIFT"
CODE_SPEC_DRIFT = "FIG_SPEC_DRIFT"
CODE_ARTIFACT_MISSING = "FIG_ARTIFACT_MISSING"
CODE_BIND_INDEX_DRIFT = "FIG_BIND_INDEX_DRIFT"


# --------------------------------------------------------------------------
# 小工具
# --------------------------------------------------------------------------
def _sha256_norm(value: str) -> str:
    """去 `sha256:` 前缀并小写化（FACTS-SCHEMA.md §11.1 归一化 2）。"""
    v = str(value or "").strip().lower()
    if v.startswith("sha256:"):
        v = v[len("sha256:"):]
    return v.strip()


def _value_key(value: str) -> str:
    """一个值的比较键（§11.1：display 与 value 严格等价，无舍入容差）。

    `10/16` ≡ `0.625` ≡ `62.5%` 归到同一个键；解析不了就退回原文。
    """
    key = canon_text(latex_display(str(value or "")))
    return key if key is not None else str(value or "").strip()


def _latex_escape(text: str) -> str:
    """LaTeX 转义（规格里的文字要进 .tex；`%` 不转义会吃掉后半行）。"""
    out = str(text or "")
    out = out.replace("\\", r"\textbackslash{}")
    for src, dst in (("%", r"\%"), ("&", r"\&"), ("$", r"\$"), ("#", r"\#"),
                     ("_", r"\_"), ("{", r"\{"), ("}", r"\}"),
                     ("~", r"\textasciitilde{}"), ("^", r"\textasciicircum{}")):
        out = out.replace(src, dst)
    return out


def _value_form(value: str) -> tuple[str, str]:
    """值的口径与画图用字符串。

    口径：`percent`（带 %）、`ratio`（a/b）、`plain`（纯数）。
    返回 `(口径, 画图用字符串)`；画不出来的值抛 ConfigError（exit 2）。
    """
    text = latex_display(str(value or "")).strip()
    if not text:
        # 值是空的：多半是这条 fact 压根没写 value（FACTS-SCHEMA §11.1：
        # value 是必需字段）。点名缺哪个，别只说「画不了」。
        raise ConfigError(
            "缺 value（FACTS-SCHEMA §11.1：value 是必需字段）——画不了",
            code=CODE_SPEC_UNPLOTTABLE)
    if "%" in text:
        body = text.replace("%", "").strip()
        if not _PLAIN_NUM_RE.match(body):
            raise ConfigError(
                "值 %r 带百分号但剩下的 %r 不是纯数——画不了" % (value, body),
                code=CODE_SPEC_UNPLOTTABLE)
        return "percent", body
    if _FRACTION_RE.match(text):
        return "ratio", text
    if _PLAIN_NUM_RE.match(text):
        return "plain", text
    raise ConfigError(
        "值 %r 不是纯数／分数／百分数——画不了（只接受这三种）" % (value,),
        code=CODE_SPEC_UNPLOTTABLE)


# --------------------------------------------------------------------------
# 结果模型
# --------------------------------------------------------------------------
@dataclass
class Finding:
    """一条发现（红＝可回账失败；config＝规格/结构错，退出码 2）。"""
    code: str
    message: str
    severity: str = "red"       # red | config
    figure: str = ""
    fact_id: str = ""

    def as_dict(self) -> dict:
        return {"code": self.code, "severity": self.severity,
                "message": self.message, "figure": self.figure,
                "fact_id": self.fact_id}


@dataclass
class FigureSpec:
    """一张图的人填规格。"""
    path: Path
    rel: str
    name: str
    kind: str
    caption: str = ""
    xlabel: str = ""
    ylabel: str = ""
    data: list = dc_field(default_factory=list)      # fact id 列表
    labels: list = dc_field(default_factory=list)    # 与 data 等长


@dataclass
class Point:
    """一个数据点：fact id ＋ 生成时的值 ＋ 证据锚 ＋ 画图形态。"""
    index: int
    fact_id: str
    value: str
    source_sha256: str
    label: str
    unit: str
    plot: str

    def as_dict(self) -> dict:
        return {"index": self.index, "fact_id": self.fact_id,
                "value": self.value, "source_sha256": self.source_sha256,
                "label": self.label, "unit": self.unit, "plot": self.plot}


@dataclass
class FigureArtifact:
    """一张图的生成产物。"""
    spec: FigureSpec
    points: list = dc_field(default_factory=list)
    files: dict = dc_field(default_factory=dict)
    changes: list = dc_field(default_factory=list)   # 覆盖前的旧→新差异

    def as_dict(self) -> dict:
        return {"name": self.spec.name, "kind": self.spec.kind,
                "spec": self.spec.rel, "points": len(self.points),
                "files": dict(self.files),
                "point_detail": [p.as_dict() for p in self.points],
                "changes": list(self.changes)}


@dataclass
class GenResult:
    """`figures gen` 的结果。"""
    root: Path
    skipped: bool = False
    figures: list = dc_field(default_factory=list)
    findings: list = dc_field(default_factory=list)

    @property
    def exit_code(self) -> int:
        if any(f.severity == "config" for f in self.findings):
            return 2
        return 1 if self.findings else 0

    def summary(self) -> dict:
        return {"figures": len(self.figures), "points": sum(len(f.points) for f in self.figures),
                "skipped": self.skipped, "findings": len(self.findings)}


@dataclass
class FigureCheck:
    """一张图的四面比对读数。"""
    spec: FigureSpec
    spec_points: int = 0
    bind_points: int = 0
    csv_rows: int = 0
    points_ok: int = 0
    points_total: int = 0
    facts_digest: str = ""
    digest_now: str = ""

    def as_dict(self) -> dict:
        return {"name": self.spec.name, "kind": self.spec.kind, "spec": self.spec.rel,
                "spec_points": self.spec_points, "bind_points": self.bind_points,
                "csv_rows": self.csv_rows,
                "counts_equal": (self.spec_points == self.bind_points == self.csv_rows),
                "points_ok": self.points_ok, "points_total": self.points_total,
                "facts_digest_at_gen": self.facts_digest,
                "facts_digest_now": self.digest_now}


@dataclass
class CheckResult:
    """`figures check` 的结果。"""
    root: Path
    skipped: bool = False
    figures: list = dc_field(default_factory=list)
    findings: list = dc_field(default_factory=list)

    @property
    def exit_code(self) -> int:
        if any(f.severity == "config" for f in self.findings):
            return 2
        return 1 if self.findings else 0

    def summary(self) -> dict:
        return {"figures": len(self.figures),
                "points": sum(f.points_total for f in self.figures),
                "points_ok": sum(f.points_ok for f in self.figures),
                "skipped": self.skipped, "findings": len(self.findings)}


# --------------------------------------------------------------------------
# 规格读取
# --------------------------------------------------------------------------
def _looks_numeric(text: str) -> bool:
    """这个字符串是不是一个「裸数字」（含分数／百分数形）。"""
    if _PLAIN_NUM_RE.match(text):
        return True
    if _FRACTION_RE.match(text):
        return True
    if "%" in text:
        return True
    return False


def _has_free_number(text: str) -> bool:
    """这段文字里有没有**账外自由数字**（G2-FIX）。

    "图上每个数都要能回账"指的是**数字**：caption 里写 "56.25" 是账外数字，
    写 "Figure 1" 也是（那个 1 不在任何 fact 里）。但 "X1"、"A1" 这类**标识符**
    里的数字是名字的一部分，不是数字主张——照抄 fact id 当标签是本工具的
    正道，不该被当成裸数字拒收。

    判据：数字token 前后不挨着字母/数字/下划线 ＝ 独立数字（＝自由数字）。
    """
    return bool(_FREE_NUM_RE.search(str(text or "")))


def _flatten_nested_spec(raw: dict, rel: str) -> tuple:
    """嵌套形态的规格（`[figure]` ＋ `[[point]]`）→ 扁平形态那套键。

    外行手写的最小规格多半是嵌套的：图型与 caption 放 `[figure]`，数据点
    放 `[[point]]`（每点一个 `fact_id`，可选 `label`）。这里只做**形状**的
    摊平与点名，语义判据（裸数字、图型、口径…）仍旧走扁平那套——两种形态
    只许一套语义。

    返回 `(flat, findings, data_broken)`；`flat["data"]` 一定是 list（缺则空），
    `data_broken=True` 表示数据点这一块已经点过名了（别再报第二遍）。
    """
    findings: list = []
    flat: dict = {}

    fig = raw.get("figure")
    if fig is None:
        findings.append(Finding(
            CODE_SPEC_BAD_DATA,
            "%s：缺 [figure] 表（图型 kind 与 caption 写在这里）" % rel,
            severity="config"))
        fig = {}
    elif not isinstance(fig, dict):
        findings.append(Finding(
            CODE_SPEC_BAD_DATA,
            "%s：[figure] 必须是表（现在是 %r）" % (rel, type(fig).__name__),
            severity="config"))
        fig = {}
    else:
        unknown = sorted(k for k in fig if k not in NESTED_FIGURE_KEYS)
        if unknown:
            findings.append(Finding(
                CODE_SPEC_UNKNOWN_KEY,
                "%s：[figure] 里未知键 %s（只认 %s）"
                % (rel, "、".join(unknown), "、".join(NESTED_FIGURE_KEYS)),
                severity="config"))
    for key in NESTED_FIGURE_KEYS:
        if key in fig:
            flat[key] = fig[key]

    points = raw.get("point")
    ids: list = []
    labels: list = []
    label_flags: list = []
    data_broken = False
    if points is None:
        findings.append(Finding(
            CODE_SPEC_NO_POINTS,
            "%s：缺数据点（[[point]]）——图里没有数据点" % rel, severity="config"))
        data_broken = True
    elif not isinstance(points, list):
        findings.append(Finding(
            CODE_SPEC_BAD_DATA,
            "%s：[[point]] 必须是表数组（现在是 %r）"
            % (rel, type(points).__name__), severity="config"))
        data_broken = True
    else:
        for i, point in enumerate(points, 1):
            if not isinstance(point, dict):
                findings.append(Finding(
                    CODE_SPEC_BAD_DATA, "%s：[[point]] 第 %d 项不是表" % (rel, i),
                    severity="config"))
                continue
            unknown = sorted(k for k in point if k not in NESTED_POINT_KEYS)
            if unknown:
                findings.append(Finding(
                    CODE_SPEC_UNKNOWN_KEY,
                    "%s：[[point]] 第 %d 项未知键 %s（只认 %s）"
                    % (rel, i, "、".join(unknown), "、".join(NESTED_POINT_KEYS)),
                    severity="config"))
            if "fact_id" not in point:
                findings.append(Finding(
                    CODE_SPEC_BAD_DATA,
                    "%s：[[point]] 第 %d 项缺 fact_id（数据点只许引 fact id）"
                    % (rel, i), severity="config"))
                continue
            ids.append(point["fact_id"])
            has_label = "label" in point
            label_flags.append(has_label)
            if has_label:
                labels.append(point["label"])
        if labels and not all(label_flags):
            findings.append(Finding(
                CODE_SPEC_BAD_LABELS,
                "%s：有的 [[point]] 写了 label、有的没写——要么都写，要么都不写"
                % rel, severity="config"))
            labels = []
    flat["data"] = ids
    if labels:
        flat["labels"] = labels

    unknown_top = sorted(k for k in raw if k not in ("figure", "point"))
    if unknown_top:
        findings.append(Finding(
            CODE_SPEC_UNKNOWN_KEY,
            "%s：未知键 %s（规格只认 %s 与 [[point]]）"
            % (rel, "、".join(unknown_top), "、".join(NESTED_FIGURE_KEYS)),
            severity="config"))
    return flat, findings, data_broken


def _parse_spec(path: Path, root: Path, known_ids: set) -> tuple:
    """读一张规格表；返回 (spec|None, findings)。

    规格错**逐条点名**：一个文件里可能同时有错、未知图型、缺数据点，
    这里一次全收齐，不是一条一条挤牙膏。

    两种形态都收：扁平的顶层键（`kind`/`data`/…），或嵌套的
    `[figure]` ＋ `[[point]]`（外行手写的那一种）。
    """
    rel = path.relative_to(root).as_posix()
    findings: list = []
    try:
        raw = load_toml(path)
    except ConfigError as exc:
        return None, [Finding(CODE_SPEC_BAD_DATA, "%s：规格表读不出来：%s" % (rel, exc),
                              severity="config")]

    nested = "figure" in raw or "point" in raw
    data_label = "data"
    data_broken = False
    if nested:
        raw, shape_findings, data_broken = _flatten_nested_spec(raw, rel)
        findings.extend(shape_findings)
        data_label = "[[point]]"
    else:
        unknown = sorted(k for k in raw if k not in SPEC_KEYS)
        if unknown:
            findings.append(Finding(
                CODE_SPEC_UNKNOWN_KEY,
                "%s：未知键 %s（规格只认 %s）" % (rel, "、".join(unknown), "、".join(SPEC_KEYS)),
                severity="config"))

    # 图名：写了就用写的；没写就拿文件名（`demo.fig.toml` → `demo`）——
    # 外行手写规格时未必想得起还要写个 name。
    name = str(raw.get("name") or "").strip()
    if not name:
        name = path.name[:-len(".fig.toml")] if path.name.endswith(".fig.toml") else path.stem
    if not name:
        findings.append(Finding(CODE_SPEC_BAD_NAME, "%s：缺图名（name）" % rel,
                                severity="config"))
    elif not _NAME_RE.match(name):
        findings.append(Finding(
            CODE_SPEC_BAD_NAME,
            "%s：图名 %r 不合法（只许字母数字与 . _ -）" % (rel, name),
            severity="config"))

    kind = str(raw.get("kind") or "").strip().lower()
    if kind not in KINDS:
        findings.append(Finding(
            CODE_SPEC_BAD_KIND,
            "%s：未知图型 %r（只认 %s）" % (rel, kind or "（空）", "、".join(KINDS)),
            severity="config"))

    data = raw.get("data")
    ids: list = []
    if data_broken:
        pass                                    # 上面已经点名过了，不重复报
    elif data is None:
        findings.append(Finding(CODE_SPEC_NO_POINTS, "%s：缺数据点（%s）" % (rel, data_label),
                                severity="config"))
    elif not isinstance(data, list):
        findings.append(Finding(
            CODE_SPEC_BAD_DATA,
            "%s：%s 必须是 fact id 列表（现在是 %r）" % (rel, data_label, type(data).__name__),
            severity="config"))
    elif not data:
        findings.append(Finding(CODE_SPEC_NO_POINTS, "%s：%s 是空的——图里没有数据点" % (rel, data_label),
                                severity="config"))
    else:
        for i, entry in enumerate(data, 1):
            if not isinstance(entry, str):
                findings.append(Finding(
                    CODE_SPEC_BAD_DATA,
                    "%s：%s 第 %d 项不是字符串（%r）" % (rel, data_label, i, entry),
                    severity="config"))
                continue
            text = entry.strip()
            if not text:
                findings.append(Finding(
                    CODE_SPEC_BAD_ID, "%s：%s 第 %d 项是空串" % (rel, data_label, i),
                    severity="config"))
                continue
            if _looks_numeric(text):
                # 裸数字：图里的数必须能回账，裸数字回不到任何 fact。
                # （账上真有这个 id 的除外——那是引用，不是裸数字。）
                if text.casefold() not in known_ids:
                    findings.append(Finding(
                        CODE_BARE_NUMBER,
                        "%s：%s 第 %d 项 %r 是裸数字——数据点只许引 fact id"
                        % (rel, data_label, i, text),
                        severity="config"))
                    continue
            if not _ID_RE.match(text):
                findings.append(Finding(
                    CODE_SPEC_BAD_ID,
                    "%s：%s 第 %d 项 %r 不是合法的 fact id 写法（只许字母数字与 . _ -）"
                    % (rel, data_label, i, text),
                    severity="config"))
                continue
            ids.append(text)

    # 文字位（会进图面）不许带**账外自由数字**：图上每个数都要能回账。
    texts: dict = {}
    for key in ("caption", "xlabel", "ylabel"):
        value = raw.get(key)
        if value is None:
            texts[key] = ""
            continue
        if not isinstance(value, str):
            findings.append(Finding(
                CODE_SPEC_BAD_DATA, "%s：%s 必须是字符串（现在是 %r）"
                % (rel, key, type(value).__name__), severity="config"))
            texts[key] = ""
            continue
        if _has_free_number(value):
            findings.append(Finding(
                CODE_BARE_NUMBER,
                "%s：%s 里出现账外数字 %r——图上的数只许来自 fact id 引用的数据点"
                % (rel, key, value),
                severity="config"))
        texts[key] = value.strip()

    labels_raw = raw.get("labels")
    labels: list = []
    if labels_raw is not None:
        if not isinstance(labels_raw, list):
            findings.append(Finding(
                CODE_SPEC_BAD_DATA, "%s：labels 必须是字符串列表（现在是 %r）"
                % (rel, type(labels_raw).__name__), severity="config"))
        else:
            for i, entry in enumerate(labels_raw, 1):
                if not isinstance(entry, str):
                    findings.append(Finding(
                        CODE_SPEC_BAD_DATA, "%s：labels 第 %d 项不是字符串" % (rel, i),
                        severity="config"))
                    continue
                if _has_free_number(entry):
                    findings.append(Finding(
                        CODE_BARE_NUMBER,
                        "%s：labels 第 %d 项 %r 里出现账外数字——图上的数只许来自 fact id"
                        % (rel, i, entry),
                        severity="config"))
                labels.append(entry.strip())
            if labels and len(labels) != len(ids):
                findings.append(Finding(
                    CODE_SPEC_BAD_LABELS,
                    "%s：labels %d 项与 %s %d 项对不上" % (rel, len(labels), data_label, len(ids)),
                    severity="config"))

    if findings:
        return None, findings

    spec = FigureSpec(path=path, rel=rel, name=name, kind=kind,
                      caption=texts["caption"], xlabel=texts["xlabel"],
                      ylabel=texts["ylabel"], data=ids, labels=labels)
    return spec, []


def load_specs(root: Path, known_ids: set) -> tuple:
    """读项目里全部图规格；返回 (specs, findings)。"""
    specs: list = []
    findings: list = []
    files = sorted(p for p in (root / SPEC_DIR).glob("*.fig.toml") if p.is_file())
    names: dict = {}
    for path in files:
        spec, errs = _parse_spec(path, root, known_ids)
        findings.extend(errs)
        if spec is None:
            continue
        if spec.name in names:
            findings.append(Finding(
                CODE_SPEC_BAD_NAME,
                "%s：图名 %r 与 %s 撞了——图名要唯一" % (spec.rel, spec.name, names[spec.name]),
                severity="config"))
            continue
        names[spec.name] = spec.rel
        specs.append(spec)
    return specs, findings


# --------------------------------------------------------------------------
# 数据点解引
# --------------------------------------------------------------------------
def _resolve_points(spec: FigureSpec, facts: dict, findings: list):
    """把规格里的 fact id 解成数据点；解不开的逐个点名（exit 1）。

    返回 `(points, ok)`：`ok=False` 表示这张图不该出产物（解引失败或口径混了）。
    """
    points: list = []
    units: list = []
    failed = False
    for i, fact_id in enumerate(spec.data, 1):
        fact = facts.get(fact_id.casefold())
        if fact is None:
            failed = True
            findings.append(Finding(
                CODE_FACT_NOT_FOUND,
                "%s：数据点 %d 引的 fact id %r 不在账上——图里不许出现账外的数"
                % (spec.rel, i, fact_id),
                severity="red", figure=spec.name, fact_id=fact_id))
            continue
        try:
            unit, plot = _value_form(fact.value)
        except ConfigError as exc:
            failed = True
            findings.append(Finding(
                exc.code, "%s：数据点 %d 的 fact %r —— %s" % (spec.rel, i, fact_id, exc),
                severity="config", figure=spec.name, fact_id=fact_id))
            continue
        units.append(unit)
        label = spec.labels[i - 1] if i - 1 < len(spec.labels) else fact_id
        points.append(Point(index=i, fact_id=fact.id.strip(), value=fact.value,
                            source_sha256=_sha256_norm(fact.source_sha256),
                            label=label, unit=unit, plot=plot))
    if len(set(units)) > 1:
        failed = True
        findings.append(Finding(
            CODE_SPEC_UNIT_MIXED,
            "%s：数据点的单位口径不一致（%s）——同一张图里混着百分比／分数／纯数，"
            "纵轴没法画" % (spec.rel, "、".join(sorted(set(units)))),
            severity="config", figure=spec.name))
        return [], False
    return points, (not failed)


# --------------------------------------------------------------------------
# 产物渲染
# --------------------------------------------------------------------------
def _figure_body(spec: FigureSpec, points: list) -> str:
    """图型 → LaTeX 片段（pgfplots / tabular）。"""
    labels = [p.label for p in points]
    if spec.kind == "table":
        head_left = _latex_escape(spec.xlabel or "fact")
        head_right = _latex_escape(spec.ylabel or "value")
        rows = ["\\begin{table}[htbp]", "\\centering",
                "\\begin{tabular}{lr}", "\\hline",
                "%s & %s \\\\" % (head_left, head_right), "\\hline"]
        for p in points:
            rows.append("%s & %s \\\\" % (_latex_escape(p.label),
                                         _latex_escape(p.value)))
        rows += ["\\hline", "\\end{tabular}"]
        if spec.caption:
            rows.append("\\caption{%s}" % _latex_escape(spec.caption))
        rows.append("\\end{table}")
        return "\n".join(rows)

    axis = ["ybar,"] if spec.kind == "bar" else []
    opts = list(axis)
    if spec.xlabel:
        opts.append("xlabel={%s}," % _latex_escape(spec.xlabel))
    if spec.ylabel:
        opts.append("ylabel={%s}," % _latex_escape(spec.ylabel))
    opts.append("xtick=data,")
    if labels:
        opts.append("xticklabels={%s}," % ",".join("{%s}" % _latex_escape(x) for x in labels))
    if spec.kind == "bar":
        opts.append("nodes near coords,")
        opts.append("bar width=14pt,")
    else:
        opts.append("grid=both,")
        opts.append("legend entries={},")
    opts.append("width=0.82\\textwidth,")
    opts.append("height=6cm,")
    coords = " ".join("(%d,%s)" % (p.index, p.plot) for p in points)
    plot_line = ("\\addplot coordinates {%s};" % coords if spec.kind == "bar"
                 else "\\addplot+[mark=*] coordinates {%s};" % coords)
    return "\n".join([
        "\\begin{figure}[htbp]", "\\centering", "\\begin{tikzpicture}",
        "\\begin{axis}[", "\n".join("    " + o for o in opts), "]",
        plot_line, "\\end{axis}", "\\end{tikzpicture}",
    ] + (["\\caption{%s}" % _latex_escape(spec.caption)] if spec.caption else []) +
        ["\\end{figure}"])


def _tex_document(spec: FigureSpec, points: list, spec_rel: str) -> str:
    """一张图的完整 .tex（可独立编译出 PDF，再由正文 \\includegraphics 引）。"""
    head = [
        "%% factscribe figures 生成（CARD-G2）—— 数据点只引 fact id，",
        "%% 图上每个数都来自事实账；改账后重跑 `factscribe figures gen`。",
        "%% 规格：%s" % spec_rel,
        "%% 编译：tectonic -X compile %s/%s.tex" % (GEN_DIR, spec.name),
        "%% 引用：\\includegraphics{%s/%s.pdf}" % (GEN_DIR, spec.name),
        "%% 随图数据：%s/%s.csv（对账物）；绑定表：%s/%s.bind.toml"
        % (GEN_DIR, spec.name, GEN_DIR, spec.name),
        "\\documentclass{article}",
        "\\usepackage[UTF8]{ctex}",
        "\\usepackage{graphicx}",
        "\\usepackage{pgfplots}",
        "\\pgfplotsset{compat=1.18}",
        "\\begin{document}",
    ]
    body = _figure_body(spec, points)
    tail = ["\\end{document}", ""]
    return "\n".join(head + body.splitlines() + tail)


def _csv_text(spec: FigureSpec, points: list) -> str:
    """随图数据 .csv：表头一行 ＋ 每个数据点一行。"""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(["index", "fact_id", "label", "value"])
    for p in points:
        writer.writerow([p.index, p.fact_id, p.label, p.value])
    return buf.getvalue()


def _bind_text(spec: FigureSpec, points: list, digest: str) -> str:
    """绑定表：每个数据点 ↔ fact id ↔ 生成时的值与 source_sha256。"""
    lines = [
        "# factscribe figures 绑定表（CARD-G2）——每个数据点 ↔ fact id ↔ 生成时的值。",
        "# 改账后重跑 `factscribe figures gen`；`factscribe figures check` 逐点回账。",
        'schema = "%s"' % BIND_SCHEMA,
        "name = %s" % toml_string(spec.name),
        "kind = %s" % toml_string(spec.kind),
        "spec = %s" % toml_string(spec.rel),
        "facts_digest = %s" % toml_string(digest),
        "count = %d" % len(points),
    ]
    for p in points:
        lines += ["", "[[point]]",
                  "index = %d" % p.index,
                  "fact_id = %s" % toml_string(p.fact_id),
                  "value = %s" % toml_string(p.value),
                  "source_sha256 = %s" % toml_string(p.source_sha256)]
    lines.append("")
    return "\n".join(lines)


def _bind_index_text(artifacts: list, digest: str) -> str:
    """项目级绑定表 `figures/bind.toml`：同一份数据按图分组。

    每张图的点写成**内联表数组**（不是 `[[figure.point]]`）：3.10 的
    fallback TOML 解析器读不了「数组表里再套数组表」，内联表两边都读得动。
    """
    lines = [
        "# factscribe figures 项目级绑定表（CARD-G2）——与 figures/gen/<名>.bind.toml",
        "# 同源同数据；`factscribe figures check` 交叉核对两份是否一致。",
        'schema = "%s"' % BIND_SCHEMA,
        "facts_digest = %s" % toml_string(digest),
    ]
    for art in artifacts:
        spec = art.spec
        points = ", ".join(
            "{index = %d, fact_id = %s, value = %s, source_sha256 = %s}"
            % (p.index, toml_string(p.fact_id), toml_string(p.value),
               toml_string(p.source_sha256))
            for p in art.points)
        lines += ["", "[[figure]]",
                  "name = %s" % toml_string(spec.name),
                  "kind = %s" % toml_string(spec.kind),
                  "spec = %s" % toml_string(spec.rel),
                  "count = %d" % len(art.points),
                  "points = [%s]" % points]
    lines.append("")
    return "\n".join(lines)


# --------------------------------------------------------------------------
# 写盘
# --------------------------------------------------------------------------
def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _read_bind(path: Path) -> dict:
    """读一张绑定表；读不出来当空表（覆盖前的差异比对容错）。"""
    try:
        return load_toml(path)
    except ConfigError:
        return {}


def _bind_points(raw: dict) -> list:
    """绑定表里的数据点（`[[point]]` 数组表 或 内联表数组）。"""
    out = []
    for raw_point in (raw.get("point") or raw.get("points") or []):
        if not isinstance(raw_point, dict):
            continue
        out.append({
            "index": raw_point.get("index"),
            "fact_id": str(raw_point.get("fact_id") or "").strip(),
            "value": str(raw_point.get("value") or "").strip(),
            "source_sha256": _sha256_norm(str(raw_point.get("source_sha256") or "")),
        })
    return out


def _diff_points(old: list, new: list) -> list:
    """旧绑定表 vs 新绑定表的逐点差异（覆盖前打印）。"""
    changes: list = []
    old_by_id = {p["fact_id"].casefold(): p for p in old}
    new_by_id = {p["fact_id"].casefold(): p for p in new}
    for key in sorted(set(old_by_id) | set(new_by_id)):
        o, n = old_by_id.get(key), new_by_id.get(key)
        if o is None:
            changes.append({"fact_id": n["fact_id"], "field": "point",
                            "old": None, "new": n["value"]})
            continue
        if n is None:
            changes.append({"fact_id": o["fact_id"], "field": "point",
                            "old": o["value"], "new": None})
            continue
        if _value_key(o["value"]) != _value_key(n["value"]):
            changes.append({"fact_id": n["fact_id"], "field": "value",
                            "old": o["value"], "new": n["value"]})
        if _sha256_norm(o["source_sha256"]) != _sha256_norm(n["source_sha256"]):
            changes.append({"fact_id": n["fact_id"], "field": "source_sha256",
                            "old": o["source_sha256"], "new": n["source_sha256"]})
    return changes


# --------------------------------------------------------------------------
# gen
# --------------------------------------------------------------------------
def _project_config(root: Path) -> Config:
    """项目声明：有 factscribe.toml 就读它；没有就用默认布局。

    figures 只读两样东西——账本 `facts/*.toml` 与图规格 `figures/*.fig.toml`，
    不碰 sections/bib/build。所以「外行手写的最小项目」不该因为没先写一份
    项目声明就跑不动（G2-FIX：原先这里直接 ConfigError，而报错出口自己又崩，
    整条命令落成 exit 4 的「工具内部错误」）。

    有项目声明时一律照声明走（facts_glob 等仍由项目说了算）。
    """
    if find_config_file(root) is None:
        return Config(root=root)
    return load_config(root)


def _load_ledger(cfg: Config) -> tuple:
    """读账本＋账本指纹；读不出来 → (None, "", finding)。

    账本坏了是**账面问题**：一律命名错误码＋人话，退出码 2，
    不许裸异常逃逸到用户面前（G2-FIX）。
    """
    try:
        facts = load_facts(cfg)
        digest = facts_digest(cfg)
    except ConfigError as exc:
        code = getattr(exc, "code", "") or ""
        if not code or code == "CONFIG_INVALID":
            code = CODE_FACTS_INVALID
        return None, "", Finding(code, "账本读不出来：%s" % exc, severity="config")
    except OSError as exc:
        return None, "", Finding(CODE_FACTS_INVALID,
                                 "账本读不出来：%s" % exc, severity="config")
    return facts, digest, None


def generate(root: Path) -> GenResult:
    """按规格生成图产物（CARD-G2 §3）。

    只写 `figures/gen/` 与 `figures/bind.toml`；不改既有模块行为。
    规格错（exit 2）时**不写任何产物**（不半生成）；解引失败（exit 1）
    时坏图不写、好图照写。
    """
    root = Path(root)
    cfg = _project_config(root)
    facts, digest, ledger_err = _load_ledger(cfg)
    if ledger_err is not None:
        return GenResult(root=cfg.root, findings=[ledger_err])
    known_ids = {f.id.strip().casefold() for f in facts}

    specs, findings = load_specs(root, known_ids)
    if findings:
        return GenResult(root=cfg.root, findings=findings)
    if not specs:
        return GenResult(root=cfg.root, skipped=True)

    fact_map = {f.id.strip().casefold(): f for f in facts}
    artifacts: list = []
    for spec in specs:
        points, ok = _resolve_points(spec, fact_map, findings)
        if any(f.severity == "config" for f in findings):
            return GenResult(root=cfg.root, findings=findings)
        if not ok:
            continue                       # 解引失败／口径混了：这张图不写
        art = FigureArtifact(spec=spec, points=points)
        artifacts.append(art)

    gen_dir = cfg.root / GEN_DIR
    for art in artifacts:
        spec = art.spec
        bind_path = gen_dir / ("%s.bind.toml" % spec.name)
        old_points = _bind_points(_read_bind(bind_path)) if bind_path.is_file() else []
        new_points = [{"index": p.index, "fact_id": p.fact_id, "value": p.value,
                       "source_sha256": p.source_sha256} for p in art.points]
        art.changes = _diff_points(old_points, new_points)
        art.files = {
            "tex": "%s/%s.tex" % (GEN_DIR, spec.name),
            "csv": "%s/%s.csv" % (GEN_DIR, spec.name),
            "bind": "%s/%s.bind.toml" % (GEN_DIR, spec.name),
        }
        _write(gen_dir / ("%s.tex" % spec.name),
               _tex_document(spec, art.points, spec.rel))
        _write(gen_dir / ("%s.csv" % spec.name), _csv_text(spec, art.points))
        _write(bind_path, _bind_text(spec, art.points, digest))
    _write(cfg.root / BIND_INDEX, _bind_index_text(artifacts, digest))

    return GenResult(root=cfg.root, figures=artifacts, findings=findings)


# --------------------------------------------------------------------------
# check
# --------------------------------------------------------------------------
def _read_csv_rows(path: Path) -> list:
    """读随图 .csv 的数据行（表头不算数据行）。"""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return []
    head = [c.strip() for c in rows[0]]
    if "fact_id" in head:
        rows = rows[1:]
    return [r for r in rows if r and any(c.strip() for c in r)]


def check(root: Path) -> CheckResult:
    """四面比对：规格 ↔ 绑定表 ↔ 随图 CSV ↔ 现行账本（CARD-G2 §3）。

    账本动过而图未重生成必红：value 或 source_sha256 不一致逐点点名。
    """
    root = Path(root)
    cfg = _project_config(root)
    facts, digest, ledger_err = _load_ledger(cfg)
    if ledger_err is not None:
        return CheckResult(root=cfg.root, findings=[ledger_err])
    known_ids = {f.id.strip().casefold() for f in facts}

    specs, findings = load_specs(root, known_ids)
    if findings:
        return CheckResult(root=cfg.root, findings=findings)
    if not specs:
        return CheckResult(root=cfg.root, skipped=True)

    fact_map = {f.id.strip().casefold(): f for f in facts}
    gen_dir = cfg.root / GEN_DIR
    checks: list = []
    index_raw = _read_bind(cfg.root / BIND_INDEX)

    for spec in specs:
        item = FigureCheck(spec=spec, digest_now=digest)
        item.spec_points = len(spec.data)
        bind_path = gen_dir / ("%s.bind.toml" % spec.name)
        csv_path = gen_dir / ("%s.csv" % spec.name)
        if not bind_path.is_file():
            findings.append(Finding(
                CODE_ARTIFACT_MISSING,
                "%s：绑定表 %s 不存在——图还没生成（先跑 `factscribe figures gen`）"
                % (spec.rel, "%s/%s.bind.toml" % (GEN_DIR, spec.name)),
                severity="red", figure=spec.name))
            checks.append(item)
            continue
        if not csv_path.is_file():
            findings.append(Finding(
                CODE_ARTIFACT_MISSING,
                "%s：随图数据 %s 不存在——图还没生成（先跑 `factscribe figures gen`）"
                % (spec.rel, "%s/%s.csv" % (GEN_DIR, spec.name)),
                severity="red", figure=spec.name))
            checks.append(item)
            continue

        bind_raw = _read_bind(bind_path)
        bind_points = _bind_points(bind_raw)
        item.bind_points = len(bind_points)
        item.facts_digest = str(bind_raw.get("facts_digest") or "")
        rows = _read_csv_rows(csv_path)
        item.csv_rows = len(rows)

        if item.spec_points != item.bind_points:
            findings.append(Finding(
                CODE_SPEC_DRIFT,
                "%s：规格 %d 个数据点，绑定表 %d 个——规格改过，图没重生成"
                % (spec.rel, item.spec_points, item.bind_points),
                severity="red", figure=spec.name))
        if item.bind_points != item.csv_rows:
            findings.append(Finding(
                CODE_CSV_DRIFT,
                "%s：绑定表 %d 个数据点，随图 CSV %d 行——两边对不上"
                % (spec.rel, item.bind_points, item.csv_rows),
                severity="red", figure=spec.name))

        # 项目级汇总表 vs 单图绑定表：同一份数据，两处必须一致。
        index_points = []
        for fig in (index_raw.get("figure") or []):
            if isinstance(fig, dict) and str(fig.get("name") or "") == spec.name:
                index_points = _bind_points(fig)
        if index_raw and not index_points:
            findings.append(Finding(
                CODE_BIND_INDEX_DRIFT,
                "%s：项目级绑定表 %s 里没有这张图——两份绑定表对不上"
                % (spec.rel, BIND_INDEX),
                severity="red", figure=spec.name))
        elif index_points and len(index_points) != item.bind_points:
            findings.append(Finding(
                CODE_BIND_INDEX_DRIFT,
                "%s：项目级绑定表 %d 个数据点，单图绑定表 %d 个——两份对不上"
                % (spec.rel, len(index_points), item.bind_points),
                severity="red", figure=spec.name))
        elif index_points:
            diff = _diff_points(index_points, bind_points)
            for ch in diff:
                findings.append(Finding(
                    CODE_BIND_INDEX_DRIFT,
                    "%s：两份绑定表在 fact %s 的 %s 上不一致（%s → %s）"
                    % (spec.rel, ch["fact_id"], ch["field"], ch["old"], ch["new"]),
                    severity="red", figure=spec.name, fact_id=ch["fact_id"]))

        for i, bind_point in enumerate(bind_points, 1):
            fact_id = bind_point["fact_id"]
            item.points_total += 1
            # 规格 ↔ 绑定表：数据点 id 逐个对。
            if i <= len(spec.data) and spec.data[i - 1].casefold() != fact_id.casefold():
                findings.append(Finding(
                    CODE_SPEC_DRIFT,
                    "%s：第 %d 个数据点规格写 %r，绑定表写 %r——规格改过，图没重生成"
                    % (spec.rel, i, spec.data[i - 1], fact_id),
                    severity="red", figure=spec.name, fact_id=fact_id))
            # 绑定表 ↔ 账本：值与证据锚。
            fact = fact_map.get(fact_id.casefold())
            if fact is None:
                findings.append(Finding(
                    CODE_FACT_NOT_FOUND,
                    "%s：第 %d 个数据点的 fact %r 不在账上了——账删了/改了，图还在引用它"
                    % (spec.rel, i, fact_id),
                    severity="red", figure=spec.name, fact_id=fact_id))
                continue
            if _value_key(bind_point["value"]) != _value_key(fact.value):
                findings.append(Finding(
                    CODE_VALUE_DRIFT,
                    "%s：第 %d 个数据点 fact %s 的值对不上——绑定表 %r，账上 %r"
                    "（账动过而图未重生成）"
                    % (spec.rel, i, fact_id, bind_point["value"], fact.value),
                    severity="red", figure=spec.name, fact_id=fact_id))
                continue
            if bind_point["source_sha256"] != _sha256_norm(fact.source_sha256):
                findings.append(Finding(
                    CODE_SOURCE_DRIFT,
                    "%s：第 %d 个数据点 fact %s 的 source_sha256 对不上——绑定表 %r，账上 %r"
                    % (spec.rel, i, fact_id, bind_point["source_sha256"],
                       _sha256_norm(fact.source_sha256)),
                    severity="red", figure=spec.name, fact_id=fact_id))
                continue
            # 绑定表 ↔ CSV：逐行对。
            if i <= len(rows):
                row = rows[i - 1]
                row_id = row[1].strip() if len(row) > 1 else ""
                row_value = row[3].strip() if len(row) > 3 else ""
                if row_id.casefold() != fact_id.casefold():
                    findings.append(Finding(
                        CODE_CSV_ROW_DRIFT,
                        "%s：随图 CSV 第 %d 行的 fact id 是 %r，绑定表写 %r"
                        % (spec.rel, i, row_id, fact_id),
                        severity="red", figure=spec.name, fact_id=fact_id))
                elif _value_key(row_value) != _value_key(bind_point["value"]):
                    findings.append(Finding(
                        CODE_CSV_ROW_DRIFT,
                        "%s：随图 CSV 第 %d 行的值是 %r，绑定表写 %r"
                        % (spec.rel, i, row_value, bind_point["value"]),
                        severity="red", figure=spec.name, fact_id=fact_id))
                else:
                    item.points_ok += 1
            else:
                findings.append(Finding(
                    CODE_CSV_DRIFT,
                    "%s：随图 CSV 只有 %d 行，绑定表有 %d 个数据点"
                    % (spec.rel, len(rows), item.bind_points),
                    severity="red", figure=spec.name))
        checks.append(item)

    return CheckResult(root=cfg.root, figures=checks, findings=findings)


# --------------------------------------------------------------------------
# 人读报告
# --------------------------------------------------------------------------
def render_gen(result: GenResult) -> str:
    """`figures gen` 的人读报告。"""
    lines = ["== factscribe figures gen ==",
             "项目：%s" % result.root]
    if result.skipped:
        lines.append("无图可生成：项目里没有 %s 规格表（skip，退出码 0）" % SPEC_GLOB)
        return "\n".join(lines)
    for art in result.figures:
        spec = art.spec
        lines.append("图 %s（%s）：规格 %s，%d 个数据点"
                     % (spec.name, spec.kind, spec.rel, len(art.points)))
        for p in art.points:
            lines.append("  [%d] %s = %s（证据 %s）"
                         % (p.index, p.fact_id, p.value,
                            (p.source_sha256 or "—")[:12]))
        if art.changes:
            lines.append("  覆盖前比对旧绑定表，有 %d 处变化：" % len(art.changes))
            for ch in art.changes:
                lines.append("    %s %s：%s → %s"
                             % (ch["fact_id"], ch["field"], ch["old"], ch["new"]))
        for key in ("tex", "csv", "bind"):
            lines.append("  写入：%s" % art.files.get(key, ""))
    lines.append("项目级绑定表：%s" % BIND_INDEX)
    if result.figures:
        lines.append("下一步：tectonic -X compile %s/%s.tex → %s/%s.pdf"
                     % (GEN_DIR, result.figures[0].spec.name, GEN_DIR,
                        result.figures[0].spec.name))
        lines.append("        正文里 \\includegraphics{%s/%s.pdf}"
                     % (GEN_DIR, result.figures[0].spec.name))
    if result.findings:
        lines.append("问题 %d 项：" % len(result.findings))
        for i, f in enumerate(result.findings, 1):
            lines.append("  %d) [%s] %s" % (i, f.code, f.message))
    return "\n".join(lines)


def render_check(result: CheckResult) -> str:
    """`figures check` 的人读报告。"""
    lines = ["== factscribe figures check ==",
             "项目：%s" % result.root]
    if result.skipped:
        lines.append("无图可对账：项目里没有 %s 规格表（skip，退出码 0）" % SPEC_GLOB)
        return "\n".join(lines)
    for item in result.figures:
        spec = item.spec
        same = "相等" if item.spec_points == item.bind_points == item.csv_rows else "不等"
        lines.append("图 %s（%s）：规格 %d 点／绑定表 %d 点／随图 CSV %d 行——三面%s"
                     % (spec.name, spec.kind, item.spec_points, item.bind_points,
                        item.csv_rows, same))
        lines.append("  逐点回账：%d/%d 一致（值与 source_sha256 全对）"
                     % (item.points_ok, item.points_total))
        if (item.facts_digest and item.facts_digest != item.digest_now
                and item.points_ok == item.points_total):
            lines.append("  账本指纹与生成时不同（账本整体动过；本图数据点仍逐点一致）")
    if result.findings:
        lines.append("问题 %d 项：" % len(result.findings))
        for i, f in enumerate(result.findings, 1):
            lines.append("  %d) [%s] %s" % (i, f.code, f.message))
        lines.append("结论：四面不齐——账动过而图未重生成，或产物被改过。")
    else:
        total = sum(i.points_total for i in result.figures)
        lines.append("零漂移：%d 张图、%d 个数据点全部可回账。"
                     % (len(result.figures), total))
    return "\n".join(lines)
