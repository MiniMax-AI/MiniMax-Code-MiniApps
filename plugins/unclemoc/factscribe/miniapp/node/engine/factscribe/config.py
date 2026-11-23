# -*- coding: utf-8 -*-
"""项目声明读取：factscribe.toml、迷你 TOML、facts/sections 装载。"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

from .facts import Fact, canon_text, fact_value_keys, latex_display
from .constants import SEV_INFO
from .texrules import strip_comments_and_verbatim

# --------------------------------------------------------------------------
# TOML 读写（3.11+ 用 tomllib；3.10 用内置极简解析器兜底）
# --------------------------------------------------------------------------

try:  # pragma: no cover - 解释器相关
    import tomllib as _tomllib
except ModuleNotFoundError:  # pragma: no cover
    _tomllib = None


class ConfigError(Exception):
    """配置/用法层面的错误 -> 退出码 2。

    `code` 供 --json 消费：SPEC-V3.0 §11.4 冻结的事实账错误码（如
    `FACT_ID_MISSING` 指向 §11.1）。

    `params` 是展示层文案目录的槽位取值（key ＋ params 那套）：错误消息
    本身逐字不变，但界面可以按 `code` 翻语言、按 `params` 填槽位。
    """

    code = "CONFIG_INVALID"

    def __init__(self, message: str, code: str | None = None,
                 params: dict | None = None):
        super().__init__(message)
        if code:
            self.code = code
        self.params = dict(params or {})


def _strip_toml_comment(line: str) -> str:
    out = []
    quote = None
    i = 0
    while i < len(line):
        c = line[i]
        if quote:
            out.append(c)
            if c == "\\" and quote == '"' and i + 1 < len(line):
                out.append(line[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
        else:
            if c in "\"'":
                quote = c
                out.append(c)
            elif c == "#":
                break
            else:
                out.append(c)
        i += 1
    return "".join(out)


def _split_top_level(body: str) -> list[str]:
    """按顶层逗号切：顾引号，也顾 {}/[] 嵌套——内联表不当劈开。"""
    items: list[str] = []
    buf: list[str] = []
    quote: str | None = None
    depth = 0
    for c in body:
        if quote:
            buf.append(c)
            if c == quote:
                quote = None
        elif c in "\"'":
            quote = c
            buf.append(c)
        elif c in "[{":
            depth += 1
            buf.append(c)
        elif c in "]}":
            depth -= 1
            buf.append(c)
        elif c == "," and depth == 0:
            items.append("".join(buf))
            buf = []
        else:
            buf.append(c)
    if "".join(buf).strip():
        items.append("".join(buf))
    return items


def _mini_toml_inline_table(raw: str) -> dict:
    """内联表 `{ key = 值, … }`（3.11+ tomllib 本就支持；此处补齐 3.10 同形）。"""
    out: dict = {}
    for part in _split_top_level(raw[1:-1]):
        part = part.strip()
        if not part:
            continue
        key, sep, value = part.partition("=")
        if not sep:
            raise ValueError("内联表缺 key=value：%r" % raw)
        out[key.strip().strip("\"'")] = _mini_toml_value(value)
    return out


def _mini_toml_value(raw: str):
    raw = raw.strip()
    if raw.startswith('"') and raw.endswith('"') and len(raw) >= 2:
        return raw[1:-1].replace('\\"', '"').replace("\\n", "\n").replace("\\\\", "\\")
    if raw.startswith("'") and raw.endswith("'") and len(raw) >= 2:
        return raw[1:-1]
    if raw in ("true", "false"):
        return raw == "true"
    if raw.startswith("[") and raw.endswith("]"):
        return [_mini_toml_value(x)
                for x in _split_top_level(raw[1:-1]) if x.strip()]
    if raw.startswith("{") and raw.endswith("}"):
        return _mini_toml_inline_table(raw)
    try:
        if any(ch in raw for ch in ".eE") and not raw.startswith("0x"):
            return float(raw)
        return int(raw)
    except ValueError:
        return raw  # 裸词，容错


def _needs_more(value: str) -> bool:
    depth = 0
    quote = None
    for c in value:
        if quote:
            if c == quote:
                quote = None
        elif c in "\"'":
            quote = c
        elif c in "[{":
            depth += 1
        elif c in "]}":
            depth -= 1
    return depth > 0


def _table_for(root: dict, name: str):
    """按点号分段建表：`[budget.sections]` → root["budget"]["sections"]。"""
    table = root
    for part in name.split("."):
        part = part.strip().strip("\"'")
        existing = table.setdefault(part, {})
        if not isinstance(existing, dict):
            raise ValueError("表 %r 与同名非表值冲突" % name)
        table = existing
    return table


def _mini_toml(text: str) -> dict:
    """只覆盖 factscribe 契约用得到的子集：表、表数组、字符串、数组、数字、布尔。"""
    root: dict = {}
    cur: dict = root
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        raw = lines[i]
        i += 1
        s = _strip_toml_comment(raw).strip()
        if not s:
            continue
        if s.startswith("[[") and s.endswith("]]"):
            name = s[2:-2].strip()
            parent, _, leaf = name.rpartition(".")
            holder = _table_for(root, parent) if parent else root
            arr = holder.setdefault(leaf.strip().strip("\"'"), [])
            if not isinstance(arr, list):
                raise ValueError("[[%s]] 与同名表冲突" % name)
            cur = {}
            arr.append(cur)
            continue
        if s.startswith("[") and s.endswith("]"):
            name = s[1:-1].strip()
            tbl = _table_for(root, name)
            cur = tbl
            continue
        if "=" not in s:
            raise ValueError("无法解析的 TOML 行：%r" % raw)
        key, value = s.split("=", 1)
        value = value.strip()
        while _needs_more(value) and i < len(lines):
            value += " " + _strip_toml_comment(lines[i]).strip()
            i += 1
        cur[key.strip().strip("\"'")] = _mini_toml_value(value)
    return root


def load_toml(path: Path) -> dict:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise ConfigError("读不了 %s：%s" % (path, exc))
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ConfigError("%s 不是合法 UTF-8：%s" % (path, exc))
    try:
        if _tomllib is not None:
            return _tomllib.loads(text)
        return _mini_toml(text)
    except (ValueError, Exception) as exc:  # tomllib.TOMLDecodeError 是 ValueError 子类
        raise ConfigError("TOML 解析失败 %s：%s" % (path, exc))

# --------------------------------------------------------------------------
# 项目 / facts / 正文 读取
# --------------------------------------------------------------------------

@dataclass
class Config:
    root: Path
    title: str = ""
    description: str = ""      # 一句话简介（`[project] description`；缺省空串）
    authors: list = field(default_factory=list)
    sections_glob: str = "sections/*.tex"
    facts_glob: str = "facts/*.toml"
    bib: str = "refs.bib"
    build: str = ""
    manifest: str = "results/MANIFEST.toml"
    source_root: str = ""        # source 的解析根；空＝只许项目内 results/（V3＝runs/）
    numeric_macro_allow: list = field(default_factory=list)  # 人签登记的数值宏名
    numeric_macro_rules: list = field(default_factory=list)  # V3：结构化数值宏登记（S-08）
    facts_dirs: bool = False     # V3：facts 配的是目录而不是 glob

    # ---- V3.0 扁平项目声明（schema = "factscribe-project/3.x"）----
    # v1 配置不写顶层 schema，以下字段保持默认值，行为与旧版完全一致。
    schema: str = ""
    name: str = ""
    root_tex: str = ""           # V3：审计闭包起点（非空即「从 root 文件展开」）
    section_files: list = field(default_factory=list)  # V3：显式章节清单（与 root_tex 二选一）
    level: str = "l1"            # V3：审计层 l0|l1|l2（默认 l1＝只跑源层）
    config_shape: str = ""       # 归一化来源形态：flat-schema|project-root|project-sections|v1
    warnings: list = field(default_factory=list)  # 配置归一化告警（未知字段/别名），非阻断
    output: str = "main.pdf"     # V3：最终 PDF（PDF 回检用）
    signing_mode: str = ""       # V3：offline_manifest | local_key
    number_locale: str = "period"  # V3：period | comma
    approver_keys_file: str = ""   # V3：审批公钥（项目外）
    release_keys_file: str = ""    # V3：发布公钥（项目外）
    image_budget_extra: int = 0    # V3：图片预算宽限（人签）
    frac_allow: list = field(default_factory=list)         # V3：允许的 \frac 登记
    inline_images_allow: list = field(default_factory=list)  # V3：行内小图登记
    bib_allow_unused: list = field(default_factory=list)     # R-11：UNUSED_BIB 人签白名单
    # R-05：闭包展开时找不到的 \input/\include/\subfile 目标，
    # 元素为 (声明文件, 目标, 行号)。由 load_sections 填充，audit 判红。
    missing_inputs: list = field(default_factory=list)
    # R-05（v1.3）：无法静态解析的闭包目标（宏、#、嵌套花括号、空目标），
    # 元素同上。审计覆盖不了 ⇒ fail-closed 判红（INPUT_DYNAMIC）。
    dynamic_inputs: list = field(default_factory=list)
    # 批 128：篇幅预算（`[budget]`，可选）。budget_defined=False 时判据不跑，
    # 行为与批 127 完全一致。键＝节文件名去扩展名（sections/04_x.tex → 04_x）。
    budget_defined: bool = False
    budget_default: int = 0                    # 0＝未设
    budget_sections: dict = field(default_factory=dict)  # {节键: 词/字数}
    # 批 131：证据钢印（`[evidence]`，可选）。人声明「哪一节必须出现哪几个
    # fact id」，机器照单钉死。键＝节文件名去扩展名。
    evidence_defined: bool = False
    evidence_sections: dict = field(default_factory=dict)  # {节键: [fact id]}
    # 核验槽（`[checks]`，可选；SPEC-CHECKS §5）。checks_defined=False（无节）
    # 时槽不启用：audit 行为与槽引入前逐字节一致（宪法保证）。节在场即走槽
    #（裁定③，2026-11-16）：省 packages ⇒ 槽侧默认 ["paper"]（输出带域标）；
    # 显式 packages 按点名。
    checks_defined: bool = False
    checks_packages: list = field(default_factory=list)   # 点名的包 id（去重保序）
    checks_tables: dict = field(default_factory=dict)     # {域: 原始子表}，core 只透传

    @property
    def is_v3(self) -> bool:
        return is_v3_project_schema(self.schema)

    @property
    def source_dir(self) -> str:
        """未配 source_root 时，source 必须落在这个项目内目录下。

        v1 的原始产物在 `results/`；V3 的证据模型把运行产物放在 `runs/`
        （`runs/<run_id>/summary.json`），闭包从 `root_tex` 展开。
        """
        return "runs" if self.is_v3 else "results"


# V3.0 项目声明有两个已冻结的字面量：规范正文里的 `factscribe-project/3.x`
# 与早期盲测/工单里使用的 `factscribe/3.x`。两者是同一套扁平声明的别名。
V3_PROJECT_SCHEMA_PREFIXES = ("factscribe-project/3.", "factscribe/3.")
V3_PROJECT_SCHEMA_PREFIX = V3_PROJECT_SCHEMA_PREFIXES[0]
V3_FACT_SCHEMA_PREFIXES = ("factscribe-fact/3.",)
V3_FACT_SCHEMA_PREFIX = V3_FACT_SCHEMA_PREFIXES[0]
SIGNING_MODES = ("offline_manifest", "local_key")
NUMBER_LOCALES = ("period", "comma")
# `dot` 是 `period` 的同义写法（盲测工单用 dot）；两者都表示小数点用 `.`
NUMBER_LOCALE_ALIASES = {"dot": "period", "point": "period",
                         "period": "period", "comma": "comma"}


def is_v3_project_schema(schema: str) -> bool:
    return any(str(schema or "").startswith(p) for p in V3_PROJECT_SCHEMA_PREFIXES)


def is_v3_fact_schema(schema: str) -> bool:
    return any(str(schema or "").startswith(p) for p in V3_FACT_SCHEMA_PREFIXES)


def _v3_str(data: dict, key: str, path: Path, *, default=None,
            required: bool = False) -> str:
    """取 V3 顶层字符串字段：缺省/空白按 default，类型不符直接报错。"""
    if key not in data:
        if required:
            raise ConfigError(
                "%s 缺少顶层 %s（schema=%r 必填）" % (path, key, data.get("schema")))
        return "" if default is None else default
    raw = data[key]
    if raw is None:
        if required:
            raise ConfigError("%s 的 %s 不能为空" % (path, key))
        return "" if default is None else default
    if not isinstance(raw, str):
        raise ConfigError(
            "%s 的 %s 必须是字符串，现在是 %r" % (path, key, raw))
    raw = raw.strip()
    if not raw:
        if required:
            raise ConfigError("%s 的 %s 不能为空" % (path, key))
        return "" if default is None else default
    return raw


def _v3_rel_path(raw: str, key: str, path: Path) -> str:
    """V3 里的项目内路径：必须是相对路径，不许 absolute / ..。"""
    p = Path(raw)
    if p.is_absolute() or ".." in p.parts:
        raise ConfigError(
            "%s 的 %s 必须是项目内相对路径（不许绝对路径或 ..）：%s" % (path, key, raw))
    return p.as_posix()


def _v1_rel_path(raw, key: str, path: Path) -> str:
    """v1 的 sections/facts/bib/manifest：同样只许项目内相对路径。

    不做这层校验时，`sections = "../elsewhere/*.tex"` 会 glob 到项目外，
    再在算相对路径时抛裸 `ValueError`（exit 4）；`facts` 更糟——直接读项目外
    的账本而不报错。配置错必须是 exit 2，且说清是哪个键。
    """
    text = str(raw or "").strip()
    if not text:
        raise ConfigError("%s 的 %s 不能为空" % (path, key))
    return _v3_rel_path(text, key, path)


def _v3_str_list(data: dict, key: str, path: Path) -> list:
    raw = data.get(key)
    if raw is None:
        return []
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        raise ConfigError("%s 的 %s 必须是字符串数组，现在是 %r" % (path, key, raw))
    out: list[str] = []
    for item in raw:
        if isinstance(item, dict):
            item = item.get("name") or item.get("token") or ""
        if not isinstance(item, str) or not item.strip():
            raise ConfigError(
                "%s 的 %s 里有非字符串条目：%r" % (path, key, item))
        out.append(item.strip())
    return out


# --------------------------------------------------------------------------
# 批 128：篇幅预算（`[budget]`，可选节）
# --------------------------------------------------------------------------

BUDGET_TABLE = "budget"


def _budget_int(value, what: str, path: Path) -> int:
    """预算值必须是正整数；布尔、字符串、小数、<=0 一律配置错（不猜）。"""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ConfigError("%s 的 %s 必须是正整数，现在是 %r"
                          % (path, what, value))
    if value <= 0:
        raise ConfigError("%s 的 %s 必须是正整数（> 0），现在是 %r"
                          % (path, what, value))
    return value


def _parse_budget(data: dict, path: Path) -> tuple[bool, int, dict]:
    """读 `[budget]`：返回 (是否声明, 默认预算, 按节覆盖)。

    没有 `[budget]` ⇒ (False, 0, {})，所有判据都不跑（向后兼容）。
    `[budget.sections]` 的键是节文件名去扩展名（sections/04_x.tex → 04_x）。
    """
    raw = data.get(BUDGET_TABLE)
    # 3.10 的极简 TOML 解析器历史上把点号表名存成扁平键；两种形态都认。
    dotted = data.get(BUDGET_TABLE + ".sections")
    if raw is None and dotted is None:
        return False, 0, {}
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ConfigError("%s 的 [budget] 必须是表（default / sections 两项），"
                          "现在是 %r" % (path, raw))
    table = dict(raw)
    if dotted is not None and "sections" not in table:
        table["sections"] = dotted

    default = 0
    if "default" in table and table["default"] is not None:
        default = _budget_int(table["default"], "[budget].default", path)

    sections_raw = table.get("sections") or {}
    if not isinstance(sections_raw, dict):
        raise ConfigError("%s 的 [budget.sections] 必须是表（节键 = 值），"
                          "现在是 %r" % (path, sections_raw))
    sections: dict[str, int] = {}
    for key, value in sections_raw.items():
        if not isinstance(key, str) or not key.strip():
            raise ConfigError("%s 的 [budget.sections] 里有一个非字符串/空键：%r"
                              % (path, key))
        sections[key.strip()] = _budget_int(
            value, "[budget.sections].%s" % key.strip(), path)
    return True, default, sections


def section_budget(cfg: Config, file: str) -> int:
    """某节文件的预算：按节覆盖优先，其次 `default`；0＝该节不判。

    键＝节文件名去扩展名。章节与附录按文件分开算，互不借用预算。
    """
    if not getattr(cfg, "budget_defined", False):
        return 0
    key = Path(str(file)).stem
    if key in cfg.budget_sections:
        return cfg.budget_sections[key]
    return cfg.budget_default


# --------------------------------------------------------------------------
# 批 131：证据钢印（`[evidence]`，可选）
# --------------------------------------------------------------------------

EVIDENCE_TABLE = "evidence"


def _parse_evidence(data: dict, path: Path) -> tuple[bool, dict]:
    """读 `[evidence]`：返回 (是否声明, {节键: [fact id]})。

    没有 `[evidence]` ⇒ (False, {})，`REQUIRED_EVIDENCE_MISSING` 不跑。
    键＝节文件名去扩展名；值是 fact id 字符串数组（人写的清单，机器不推导）。
    值形态不合法即配置错（退出码 2），不猜、不截断；同一节里重复的 id
    按一条处理（存在性判据）。
    """
    raw = data.get(EVIDENCE_TABLE)
    if raw is None:
        return False, {}
    if not isinstance(raw, dict):
        raise ConfigError("%s 的 [evidence] 必须是表（节键 = fact id 数组），"
                          "现在是 %r" % (path, raw))
    sections: dict[str, list[str]] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not key.strip():
            raise ConfigError("%s 的 [evidence] 里有一个非字符串/空键：%r"
                              % (path, key))
        if not isinstance(value, list):
            raise ConfigError(
                "%s 的 [evidence].%s 必须是 fact id 数组，现在是 %r"
                % (path, key.strip(), value))
        ids: list[str] = []
        for item in value:
            if not isinstance(item, str) or not item.strip():
                raise ConfigError(
                    "%s 的 [evidence].%s 里有非字符串/空条目：%r"
                    % (path, key.strip(), item))
            fid = item.strip()
            if fid not in ids:
                ids.append(fid)
        sections[key.strip()] = ids
    return True, sections


def section_evidence(cfg: Config, file: str) -> tuple:
    """某节文件在 `[evidence]` 里声明的 fact id（没声明 ⇒ 空元组）。"""
    if not getattr(cfg, "evidence_defined", False):
        return ()
    return tuple(cfg.evidence_sections.get(Path(str(file)).stem, ()))


# --------------------------------------------------------------------------
# 核验槽（`[checks]`，可选；SPEC-CHECKS §5）
# --------------------------------------------------------------------------

CHECKS_TABLE = "checks"


def _parse_checks(data: dict, path: Path,
                  cfg: Config) -> tuple[bool, list, dict]:
    """读 `[checks]`：返回 (是否声明, packages 点名, {域: 原始子表})。

    没有 `[checks]` ⇒ (False, [], {})——槽不启用，audit 行为与引入前逐字
    节一致（§5.2 兼容承诺）。节存在但省 `packages` ⇒ checks_defined=True、
    点名空表——cmd_audit 照样挂槽，槽侧默认 ["paper"]（裁定③，2026-11-16：
    裸节走槽，输出带 domain 键与 by_domain；发现本体与直跑逐条相同）。
    `packages` 顺序无关：去重保序。

    顶层只认 `packages` 一个键；其余顶层键若是表按域节透传给槽（键集由
    该包的卡声明，core 不校验、只透传），非表的值记 CONFIG_UNKNOWN_FIELD
    告警、不阻断。`[checks]` 不参与形态判定七步，v1/V3 项目都可挂。
    """
    raw = data.get(CHECKS_TABLE)
    if raw is None:
        return False, [], {}
    if not isinstance(raw, dict):
        raise ConfigError("%s 的 [checks] 必须是表（packages ＋ 各域子表），"
                          "现在是 %r" % (path, raw))
    packages: list[str] = []
    packages_raw = raw.get("packages")
    if packages_raw is not None:
        if isinstance(packages_raw, str):
            packages_raw = [packages_raw]
        if not isinstance(packages_raw, list):
            raise ConfigError("%s 的 [checks].packages 必须是字符串数组，"
                              "现在是 %r" % (path, packages_raw))
        for item in packages_raw:
            if not isinstance(item, str) or not item.strip():
                raise ConfigError(
                    "%s 的 [checks].packages 里有非字符串/空条目：%r"
                    % (path, item))
            pid = item.strip()
            if pid not in packages:
                packages.append(pid)
    tables: dict[str, dict] = {}
    for key, value in raw.items():
        if key == "packages":
            continue
        if not isinstance(key, str) or not key.strip():
            raise ConfigError("%s 的 [checks] 里有一个非字符串/空键：%r"
                              % (path, key))
        if isinstance(value, dict):
            tables[key.strip()] = dict(value)
        else:
            _config_warn(cfg, "CONFIG_UNKNOWN_FIELD",
                         "[checks] 的顶层键 %r 不是域子表——已忽略"
                         "（也不参与任何判据）" % key,
                         field=str(key), location=str(path))
    return True, packages, tables


def _load_v1_config(root: Path, path: Path, data: dict) -> Config:
    """旧版：顶层 [project] 表（title/sections/facts/bib/build…），行为不变。"""
    proj = data.get("project")
    if not isinstance(proj, dict):
        raise ConfigError("%s 缺少 [project] 段" % path)
    for key in ("sections", "facts"):
        if not proj.get(key):
            raise ConfigError("%s 缺少 project.%s" % (path, key))
    authors = proj.get("authors") or []
    if isinstance(authors, str):
        authors = [authors]
    allow = proj.get("numeric_macro_allow") or []
    if isinstance(allow, (str, dict)):
        allow = [allow]
    macro_allow: list[str] = []
    for item in allow:
        name = item.get("name") if isinstance(item, dict) else item
        if str(name or "").strip():
            macro_allow.append(str(name).strip().lstrip("\\"))
    cfg = Config(
        root=root,
        title=str(proj.get("title") or ""),
        description=str(proj.get("description") or ""),
        authors=[str(a) for a in authors],
        sections_glob=_v1_rel_path(proj["sections"], "sections", path),
        facts_glob=_v1_rel_path(proj["facts"], "facts", path),
        bib=str(proj.get("bib") or "refs.bib"),
        build=str(proj.get("build") or ""),
        manifest=str(proj.get("manifest") or "results/MANIFEST.toml"),
        source_root=str(proj.get("source_root") or ""),
        output=str(proj.get("output") or "main.pdf"),
        numeric_macro_allow=macro_allow,
        bib_allow_unused=_v3_str_list(
            {"bib_allow_unused": proj.get("bib_allow_unused")},
            "bib_allow_unused", path),
        config_shape="v1",
    )
    cfg.budget_defined, cfg.budget_default, cfg.budget_sections = \
        _parse_budget(data, path)
    cfg.evidence_defined, cfg.evidence_sections = _parse_evidence(data, path)
    cfg.checks_defined, cfg.checks_packages, cfg.checks_tables = \
        _parse_checks(data, path, cfg)
    # v1 的未知字段同样不静默（判据仍不看它们，行为不变）。
    _unknown_field_warnings(cfg, proj, V1_KNOWN_FIELDS, path, "[project]")
    return cfg


def _v3_get(data: dict, key: str, default=None):
    """V3 扁平声明允许把属性写在顶层，或写进 `[project]` 表（两处都认）。

    顶层优先：`factscribe/3.0` 的工单里 `root_tex/facts/refs` 在顶层，
    `signing_mode/number_locale/...` 在 `[project]` 表里。
    """
    if key in data:
        return data[key]
    proj = data.get("project")
    if isinstance(proj, dict) and key in proj:
        return proj[key]
    return default


def _v3_facts_glob(raw: str, path: Path) -> str:
    """V3 的 `facts` 可以是 glob，也可以是一个目录名（目录＝其下 *.toml）。"""
    text = str(raw or "").strip()
    if not text:
        return "facts/*.toml"
    if any(ch in text for ch in "*?["):
        return _v3_rel_path(text, "facts", path)
    return _v3_rel_path(text.rstrip("/"), "facts", path) + "/*.toml"


def _v3_macro_rules(data: dict, path: Path) -> tuple[list[str], list[dict]]:
    """`numeric_macro_allow` 两种形态：v1 的宏名数组 / V3 的结构化登记表。

    返回 (纯宏名, 结构化条目)。结构化条目里缺字段不在读取期判死——判据
    （形状/双签/到期）留给审计面，才能给出具体 code。
    """
    raw = _v3_get(data, "numeric_macro_allow") or []
    if isinstance(raw, (str, dict)):
        raw = [raw]
    if not isinstance(raw, list):
        raise ConfigError("%s 的 numeric_macro_allow 必须是数组，现在是 %r"
                          % (path, raw))
    names: list[str] = []
    rules: list[dict] = []
    for item in raw:
        if isinstance(item, str):
            if item.strip():
                names.append(item.strip().lstrip("\\"))
            continue
        if not isinstance(item, dict):
            raise ConfigError("%s 的 numeric_macro_allow 里有非字符串/非表条目：%r"
                              % (path, item))
        name = str(item.get("name") or "").strip().lstrip("\\")
        if name:
            names.append(name)
        rules.append(dict(item))
    return names, rules


# --------------------------------------------------------------------------
# V3.0 项目声明的三种写法与允许的别名（SPEC-V3.0 §10「项目配置（冻结）」）
# --------------------------------------------------------------------------

# 形态 A（扁平 schema）/ B（[project] + root_tex）/ C（[project] + sections）
# 共用同一张字段表；这里列的是「认识的键」，其余键忽略但记一条告警。
V3_KNOWN_FIELDS = {
    "schema", "name", "title", "description", "root_tex", "sections", "facts",
    "bib", "refs", "output", "level", "number_locale", "signing_mode",
    "approver_keys_file", "release_keys_file", "image_budget_extra",
    "frac_allow", "inline_images_allow", "numeric_macro_allow", "authors",
    "build", "manifest", "source_root", "bib_allow_unused", "budget", "evidence",
    "checks",
}

# `[project]` 里出现这些键才按 v3 读；一个只有 title 的 [project] 仍是 v1
# （错误信息照旧点名 project.sections，不改老项目的报错）。
V3_MARKER_FIELDS = {
    "root_tex", "sections", "output", "signing_mode", "number_locale", "level",
    "approver_keys_file", "release_keys_file", "image_budget_extra",
    "frac_allow", "inline_images_allow",
}

# v1 认识的键（行为不变；root_tex 是 V3 键，v1 里出现按「忽略」处理但不告警，
# 因为 v1 的判据从来不看它）。output 在 v1 里是「最终 PDF 的文件名」——
# 以前恒为 main.pdf，现在允许显式写。
V1_KNOWN_FIELDS = {
    "title", "authors", "sections", "facts", "bib", "build", "manifest",
    "source_root", "numeric_macro_allow", "root_tex", "bib_allow_unused",
    "description", "output",
}

LEVELS = ("l0", "l1", "l2")
LEVEL_ALIASES = {"l0": "l0", "0": "l0", "l1": "l1", "1": "l1",
                 "l2": "l2", "2": "l2"}


def _config_warn(cfg: Config, code: str, message: str, field: str = "",
                 location: str = "") -> None:
    """记一条非阻断的配置告警（只在 --json 的 config_warnings 里出现）。"""
    item = {"code": code, "severity": SEV_INFO, "message": message}
    if field:
        item["field"] = field
    if location:
        item["location"] = location
    cfg.warnings.append(item)


def _unknown_field_warnings(cfg: Config, table: dict, known: set, path: Path,
                            where: str) -> None:
    for key in table:
        if key in known:
            continue
        _config_warn(
            cfg, "CONFIG_UNKNOWN_FIELD",
            "%s 的字段 %r 不在冻结契约里——已忽略（也不参与任何判据）" % (where, key),
            field=str(key), location=str(path))


def _v3_sections(raw, path: Path) -> list[str]:
    """`sections`：字符串数组（或单个字符串）＝显式章节清单。"""
    if raw is None:
        return []
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        raise ConfigError(
            "%s 的 sections 必须是字符串数组（显式 .tex 清单），现在是 %r"
            % (path, raw))
    out: list[str] = []
    for item in raw:
        if not isinstance(item, str) or not item.strip():
            raise ConfigError("%s 的 sections 里有非字符串条目：%r" % (path, item))
        if any(ch in item for ch in "*?["):
            raise ConfigError(
                "%s 的 sections 里不允许 glob（%r）——显式清单请逐个列文件；"
                "要用通配请写 v1 形态（sections = \"sections/*.tex\" 且配 facts）"
                % (path, item))
        out.append(_v3_rel_path(item.strip(), "sections", path))
    return out


def _load_v3_config(root: Path, path: Path, data: dict,
                    shape: str = "flat-schema") -> Config:
    """V3.0 项目声明归一化：三种写法 → 同一个 Config。

    - 形态 A `flat-schema`：顶层 `schema/name/root_tex/...`；
    - 形态 B `project-root`：`[project]` 表里有 `root_tex`；
    - 形态 C `project-sections`：`[project]` 表里有 `sections = [...]`。

    属性可以写在顶层或 `[project]` 表里（顶层优先）；未知字段忽略并记告警；
    闭包起点（root_tex 或 sections）缺一不可，缺了 exit 2 并点名。
    """
    schema = str(data.get("schema") or "").strip()
    if not schema:
        # 形态 B/C 没有顶层 schema：这是同一套 v3 声明的简写，按规范默认值补齐。
        schema = V3_PROJECT_SCHEMA_PREFIX + "0"

    raw_root = _v3_get(data, "root_tex")
    raw_sections = _v3_get(data, "sections")
    section_files: list[str] = []
    if isinstance(raw_sections, list):
        section_files = _v3_sections(raw_sections, path)
    elif isinstance(raw_sections, str) and raw_sections.strip():
        section_files = _v3_sections([raw_sections], path)
    elif raw_sections is not None and not isinstance(raw_sections, str):
        raise ConfigError(
            "%s 的 sections 必须是字符串数组（显式 .tex 清单），现在是 %r"
            % (path, raw_sections))

    root_tex = ""
    if raw_root is not None:
        root_tex = _v3_str({"root_tex": raw_root}, "root_tex", path)
        if root_tex:
            root_tex = _v3_rel_path(root_tex, "root_tex", path)
    if root_tex and section_files:
        # 两种写法都给＝两份闭包起点。按规范 §10：root_tex 优先，
        # 但必须说得清是哪一个，不许静默丢掉另一份。
        cfg_warn_text = ("root_tex=%r 与 sections 同时给出，按 §10.2 root_tex 优先，"
                         "sections 已忽略" % root_tex)
        section_files = []
    else:
        cfg_warn_text = ""
    if not root_tex and section_files:
        root_tex = section_files[0]      # §10 冻结推导：sections 首个文件当起点
    if not root_tex:
        raise ConfigError(
            "%s 缺少闭包起点：必须给 root_tex（推荐）或 sections（显式 .tex 清单）"
            "——两者都缺，没法知道从哪展开审计闭包" % path)

    output = _v3_str({"output": _v3_get(data, "output")}, "output", path,
                     default="main.pdf")
    if output:
        output = _v3_rel_path(output, "output", path)
    signing_mode = _v3_str({"signing_mode": _v3_get(data, "signing_mode")},
                           "signing_mode", path, default="offline_manifest")
    if signing_mode not in SIGNING_MODES:
        raise ConfigError(
            "%s 的 signing_mode=%r 不认识（只允许 %s）"
            % (path, signing_mode, " / ".join(SIGNING_MODES)))
    raw_locale = _v3_str({"number_locale": _v3_get(data, "number_locale")},
                         "number_locale", path, default="period")
    number_locale = NUMBER_LOCALE_ALIASES.get(raw_locale.strip().lower())
    if number_locale is None:
        raise ConfigError(
            "%s 的 number_locale=%r 不认识（只允许 %s）"
            % (path, raw_locale, " / ".join(sorted(NUMBER_LOCALE_ALIASES))))
    raw_level = _v3_str({"level": _v3_get(data, "level")}, "level", path,
                        default="l1")
    level = LEVEL_ALIASES.get(raw_level.strip().lower())
    if level is None:
        raise ConfigError(
            "%s 的 level=%r 不认识（只允许 %s）"
            % (path, raw_level, " / ".join(LEVELS)))
    budget = _v3_get(data, "image_budget_extra", 0)
    if isinstance(budget, bool) or not isinstance(budget, int) or budget < 0:
        raise ConfigError(
            "%s 的 image_budget_extra 必须是非负整数，现在是 %r" % (path, budget))
    name = _v3_str({"name": _v3_get(data, "name") or _v3_get(data, "title")},
                   "name", path)
    proj = data.get("project") if isinstance(data.get("project"), dict) else {}
    macro_names, macro_rules = _v3_macro_rules(data, path)
    cfg = Config(
        root=root,
        title=name,
        description=str(_v3_get(data, "description") or ""),
        authors=[str(a) for a in (proj.get("authors") or [])],
        sections_glob=root_tex,
        facts_glob=_v3_facts_glob(_v3_get(data, "facts", "facts"), path),
        bib=str(_v3_get(data, "refs") or _v3_get(data, "bib") or "refs.bib"),
        build="",
        manifest="results/MANIFEST.toml",
        schema=schema,
        name=name,
        root_tex=root_tex,
        output=output,
        signing_mode=signing_mode,
        number_locale=number_locale,
        approver_keys_file=_v3_str(
            {"approver_keys_file": _v3_get(data, "approver_keys_file")},
            "approver_keys_file", path),
        release_keys_file=_v3_str(
            {"release_keys_file": _v3_get(data, "release_keys_file")},
            "release_keys_file", path),
        image_budget_extra=budget,
        frac_allow=_v3_str_list(
            {"frac_allow": _v3_get(data, "frac_allow")}, "frac_allow", path),
        inline_images_allow=_v3_str_list(
            {"inline_images_allow": _v3_get(data, "inline_images_allow")},
            "inline_images_allow", path),
        bib_allow_unused=_v3_str_list(
            {"bib_allow_unused": _v3_get(data, "bib_allow_unused")},
            "bib_allow_unused", path),
        numeric_macro_allow=macro_names,
        numeric_macro_rules=macro_rules,
        facts_dirs=not any(ch in str(_v3_get(data, "facts", "facts"))
                           for ch in "*?["),
        section_files=section_files,
        level=level,
        config_shape=shape,
    )
    cfg.budget_defined, cfg.budget_default, cfg.budget_sections = \
        _parse_budget(data, path)
    cfg.evidence_defined, cfg.evidence_sections = _parse_evidence(data, path)
    cfg.checks_defined, cfg.checks_packages, cfg.checks_tables = \
        _parse_checks(data, path, cfg)
    # 未知字段：允许忽略，但绝不静默（进 --json 的 config.warnings）。
    # 形态 A 的声明在顶层；B/C 在 [project] 表里。两处都查，免得换个写法
    # 就把打错的字段名吞掉。
    _unknown_field_warnings(cfg, proj, V3_KNOWN_FIELDS, path, "[project]")
    _unknown_field_warnings(
        cfg, {k: v for k, v in data.items() if k != "project"},
        V3_KNOWN_FIELDS, path, "顶层")
    if not _v3_get(data, "name") and _v3_get(data, "title"):
        _config_warn(cfg, "CONFIG_ALIAS", "name 缺省，按别名 title 取值",
                     field="title", location=str(path))
    if _v3_get(data, "refs") is not None:
        _config_warn(cfg, "CONFIG_ALIAS", "参考文献用别名 refs（等价于 bib）",
                     field="refs", location=str(path))
    if raw_locale.strip().lower() != number_locale:
        _config_warn(cfg, "CONFIG_ALIAS",
                     "number_locale=%r 归一化为 %r" % (raw_locale, number_locale),
                     field="number_locale", location=str(path))
    if cfg_warn_text:
        _config_warn(cfg, "CONFIG_ALIAS", cfg_warn_text,
                     field="sections", location=str(path))
    if not data.get("schema"):
        _config_warn(cfg, "CONFIG_SCHEMA_IMPLICIT",
                     "没写顶层 schema，按 %s 简写形态读取（%s）"
                     % (schema, shape), field="schema", location=str(path))
    return cfg


CONFIG_FILENAME = "factscribe.toml"


def find_config_file(root: Path) -> Path | None:
    """项目声明文件：factscribe.toml。"""
    path = root / CONFIG_FILENAME
    if path.is_file():
        return path
    return None


def load_config(root: Path) -> Config:
    path = find_config_file(root)
    if path is None:
        raise ConfigError(
            "找不到项目声明 %s（缺 factscribe.toml 不敢跑）"
            % (root / CONFIG_FILENAME))
    data = load_toml(path)

    # ---- 形态判定（SPEC-V3.0 §10 冻结顺序，自上而下，先命中先用）----
    # 1) 顶层 schema            -> 形态 A（扁平 schema）
    # 2) [project].sections 数组 -> 形态 C（project + sections）
    # 3) [project].root_tex 且没配 facts -> 形态 B（project + root_tex）
    # 4) [project].sections 是 glob 且有 facts -> v1（行为不变）
    # 5) 其余 [project]           -> 形态 B（字段校验，缺起点 exit 2 点名）
    # 6) 顶层有 v3 标记键         -> 形态 A（schema 缺省）
    # 7) 什么都没有               -> 老错误「缺少 [project] 段」
    if "schema" in data:
        schema = data.get("schema")
        if not isinstance(schema, str) or not schema.strip():
            raise ConfigError(
                "%s 的顶层 schema 必须是非空字符串，现在是 %r" % (path, schema))
        if not is_v3_project_schema(schema.strip()):
            raise ConfigError(
                "%s 的 schema=%r 不认识——本工具只认 %s 的扁平声明；"
                "旧版配置请去掉顶层 schema、改用 [project] 表"
                % (path, schema, " / ".join(p + "x" for p in V3_PROJECT_SCHEMA_PREFIXES)))
        return _load_v3_config(root, path, data, shape="flat-schema")

    proj = data.get("project")
    if isinstance(proj, dict):
        sections = proj.get("sections")
        raw_root = proj.get("root_tex")
        has_root = isinstance(raw_root, str) and bool(raw_root.strip())
        if isinstance(sections, list):
            return _load_v3_config(root, path, data, shape="project-sections")
        if has_root and not proj.get("facts"):
            return _load_v3_config(root, path, data, shape="project-root")
        if (isinstance(sections, str)
                and any(ch in sections for ch in "*?[")
                and proj.get("facts")):
            return _load_v1_config(root, path, data)
        # 单文件 sections（例 "ms.tex"）配了 facts：按 v1 处理。否则会落进
        # 下面的 V3 marker 分支，`fact add` 随即拒绝——用户只是想让审计
        # 从这一节/这个主文件开始，不该被当成 V3 的显式清单。
        if (isinstance(sections, str) and proj.get("facts")
                and not has_root
                and not any(k in proj for k in V3_MARKER_FIELDS - {"sections"})):
            return _load_v1_config(root, path, data)
        if any(k in proj for k in V3_MARKER_FIELDS):
            return _load_v3_config(root, path, data,
                                   shape="project-root" if has_root
                                   else "project-sections")
        # 没有任何 v3 标记的 [project]：仍是 v1，错误信息照旧点名 project.sections
        return _load_v1_config(root, path, data)

    if any(k in data for k in ("root_tex", "sections", "output", "signing_mode",
                               "number_locale", "level")):
        return _load_v3_config(root, path, data, shape="flat-schema")

    return _load_v1_config(root, path, data)


def _normalise_display(raw, latex: bool = False) -> list[dict]:
    """display 项：字符串简写或 `{text, round_to?, setting?}` 表。

    SPEC §11.1：display 是**渲染形**（LaTeX 里就是 `62.5\\%`），严格等价
    比较前先把 `\\%`、`\\,` 这类转义还原成字面数字形。
    """
    if raw is None:
        return []
    if isinstance(raw, (str, dict)):
        raw = [raw]
    out: list[dict] = []
    for item in raw:
        if isinstance(item, str):
            text, round_to, setting = item, None, None
        elif isinstance(item, dict):
            text = str(item.get("text") or "")
            round_to = item.get("round_to")
            setting = item.get("setting")
        else:
            continue
        out.append({
            "text": latex_display(text) if latex else text,
            "round_to": round_to,
            "setting": setting,
        })
    return out


def _locate_id_line(path: Path, fid: str) -> int:
    pat = re.compile(r"""^\s*id\s*=\s*["']%s["']""" % re.escape(fid))
    try:
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if pat.match(line):
                return i
    except OSError:
        pass
    return 0


def _fact_from_mapping(raw: dict, path: Path, cfg: Config) -> Fact:
    fid = str(raw.get("id") or "").strip()
    rel = path.relative_to(cfg.root).as_posix()
    locator = str(raw.get("locator") or "")
    if not locator:
        # V3 用 pointer 指向原始产物内部（如 "/summary/rate"）；落到 locator 供人看。
        locator = str(raw.get("pointer") or "")
    source = str(raw.get("source") or "").strip()
    obs = raw.get("observation")
    obs = obs if isinstance(obs, dict) else {}
    obs_run_id = str(raw.get("run_id") or obs.get("run_id") or "").strip()
    obs_pointer = str(raw.get("pointer") or obs.get("pointer") or "")
    if not source and cfg.is_v3:
        # SPEC §11.1：v3 的事实可以只给 observation（run_id/pointer）＋
        # source_sha256；证据路径缺省推导为 runs/<run_id>/summary.json。
        if obs_run_id and not locator:
            locator = obs_pointer
        if obs_run_id:
            candidate = "runs/%s/summary.json" % obs_run_id
            if (cfg.root / candidate).is_file():
                source = candidate
    display = _normalise_display(raw.get("display"), latex=cfg.is_v3)
    if not display and cfg.is_v3 and str(raw.get("value") or "").strip():
        # SPEC §11.1：display 缺省时回填 value；这条是定义等价的，不参与
        # R-04 的严格 canon 判定（auto 标记）。
        display = [{"text": str(raw.get("value")), "round_to": None,
                    "setting": None, "auto": True}]
    # v1.3：expr↔value 比较允许显式容差（相对误差）；不写就用既有 1e-9 口径。
    tol_raw = raw.get("expr_tolerance")
    expr_tolerance = None
    if tol_raw not in (None, ""):
        try:
            expr_tolerance = float(tol_raw)
        except (TypeError, ValueError):
            raise ConfigError(
                "%s 的 fact %r expr_tolerance=%r 不是数字（相对误差，例：1e-6）"
                % (path, fid, tol_raw))
        if expr_tolerance < 0:
            raise ConfigError(
                "%s 的 fact %r expr_tolerance=%r 不能为负（相对误差）"
                % (path, fid, tol_raw))
    f = Fact(
        id=fid,
        claim=str(raw.get("claim") or ""),
        value=str(raw.get("value") or ""),
        source=source,
        source_sha256=str(raw.get("source_sha256") or "").strip().lower(),
        locator=locator,
        confidence=str(raw.get("confidence") or ""),
        kind=str(raw.get("kind") or "claim"),
        derived_from=[str(x) for x in (raw.get("derived_from") or [])],
        supersedes=[str(x) for x in (raw.get("supersedes") or [])],
        expr=str(raw.get("expr") or "").strip(),
        expr_tolerance=expr_tolerance,
        metric=str(raw.get("metric") or ""),
        scope=str(raw.get("scope") or ""),
        note=str(raw.get("note") or ""),
        display=display,
        co_claim=[str(x) for x in (raw.get("co_claim") or [])],
        file=rel,
        line=_locate_id_line(path, fid),
        role=str(raw.get("role") or ""),
        headline=bool(raw.get("headline")),
        quantitative=bool(raw.get("quantitative")),
        dup_ok=bool(raw.get("dup_ok")),
        run_id=obs_run_id,
        pointer=obs_pointer,
        assertions=[dict(a) for a in (raw.get("assertions") or [])
                    if isinstance(a, dict)],
        # P0：报告来源（可选）。缺省空串＝旧账，行为不变。
        report=str(raw.get("report") or "").strip(),
        report_metric=str(raw.get("report_metric") or "").strip(),
    )
    if not f.id:
        raise ConfigError(
            "%s 里有一条 fact 缺 id（不准匿名入账）——V3 事实账 schema 见 "
            "docs/design/SPEC-V3.0.md §11.1，id 是必需且唯一的入账键" % path,
            code="FACT_ID_MISSING")
    f.value_keys = fact_value_keys(f.value)
    # display 只允许追加与 value **严格等价**的写法（R-04）；这里先把
    # 它们的字面规范键并入值域，等价性另由 DISPLAY_INCONSISTENT 检查。
    for item in f.display:
        f.value_keys |= fact_value_keys(item["text"])
        canon = canon_text(item["text"])
        if canon is not None:
            f.value_keys.add(canon)
    return f


def load_facts(cfg: Config) -> list[Fact]:
    files = sorted(p for p in cfg.root.glob(cfg.facts_glob) if p.is_file())
    facts: list[Fact] = []
    for path in files:
        data = load_toml(path)
        # V3 的 fact 文件是「一文件一条、顶层扁平」；有 schema 就按 3.x 读，
        # 未知 fact schema 明确报错。没写 schema 的仍是 v1 的 [[fact]] 表数组。
        if "schema" in data:
            schema = data.get("schema")
            if not isinstance(schema, str) or not is_v3_fact_schema(schema.strip()):
                raise ConfigError(
                    "%s 的 schema=%r 不认识——本工具只认 %s 的扁平 fact 文件"
                    "（SPEC-V3.0 §11.1）"
                    % (path, schema,
                       " / ".join(p + "x" for p in V3_FACT_SCHEMA_PREFIXES)),
                    code="FACT_SCHEMA_INVALID")
            # SPEC §11.1：`schema` 只是声明头，账体仍是 `[[fact]]` 表数组；
            # 「一文件一条、顶层扁平」是兼容形态，只在没有 `fact` 键时成立。
            if "fact" in data:
                entries = data.get("fact")
                if not isinstance(entries, list):
                    raise ConfigError(
                        "%s 里 fact 必须是 [[fact]] 表数组（SPEC-V3.0 §11.1）" % path,
                        code="FACT_CONTAINER_INVALID")
            else:
                entries = [data]
        else:
            entries = data.get("fact")
            if entries is None:
                # V3 的 flat fact 文件可以省略 schema（一文件一条、顶层扁平）；
                # v1 仍是 [[fact]] 表数组，绝不猜。
                if cfg.is_v3 and ("id" in data or "value" in data):
                    entries = [data]
                else:
                    continue
            if not isinstance(entries, list):
                raise ConfigError("%s 里 fact 必须是 [[fact]] 表数组" % path,
                                  code="FACT_CONTAINER_INVALID")
        for raw in entries:
            if not isinstance(raw, dict):
                raise ConfigError("%s 里有一条 fact 不是表" % path,
                                  code="FACT_SCHEMA_INVALID")
            facts.append(_fact_from_mapping(raw, path, cfg))
    return facts


def _glob_paths(root: Path, pattern: str) -> dict[str, Path]:
    """glob 默认递归：sections/*.tex 同时匹配 sections/**/*.tex（红队 B4）。"""
    pats = [pattern]
    if "**" not in pattern:
        d, sep, base = pattern.rpartition("/")
        if base:
            pats.append((d + "/**/" + base) if d else ("**/" + base))
    found: dict[str, Path] = {}
    for pat in pats:
        try:
            matches = list(root.glob(pat))
        except (NotImplementedError, ValueError) as exc:
            raise ConfigError("glob 模式不合法：%r（%s）" % (pat, exc))
        for p in matches:
            if not p.is_file():
                continue
            try:
                rel = p.relative_to(root).as_posix()
            except ValueError:
                raise ConfigError(
                    "glob 越出项目根：%r——sections/facts 只许项目内相对路径"
                    % pat)
            found[rel] = p
    return found


_INPUT_CMD_RE = re.compile(r"\\(?:input|include|subfile|import)\b")
_DEF_RE = re.compile(
    r"\\(?:newcommand|renewcommand|providecommand)\*?\s*\{\s*\\([A-Za-z@]+)\s*\}"
    r"\s*(?:\[(\d)\])?\s*(?:\[[^\]]*\])?\s*\{")
_DEF_SIMPLE_RE = re.compile(r"\\def\s*\\[A-Za-z@]+(?:\s*#\d)*\s*")
_INPUT_WRAPPER_RE = re.compile(r"^\s*\\input\s*\{([^{}]*#(\d)[^{}]*)\}\s*$")
_SKIP_DIRS = {".git", ".venv", "__pycache__", "audit", "node_modules", ".pytest_cache"}


def _balanced_braces(text: str, start: int) -> int:
    """text[start] == '{'；返回配对 '}' 之后的位置。"""
    depth = 0
    i = start
    while i < len(text):
        c = text[i]
        if c == "\\":
            i += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return len(text)


def _input_arg_end(text: str, start: int) -> int:
    """text[start] == '{'；返回配对 '}' 之后的位置；不平衡返回 -1。"""
    depth = 0
    i = start
    while i < len(text):
        c = text[i]
        if c == "\\":
            i += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return -1


def _input_refs(text: str):
    """产出 `\\input/\\include/\\subfile/\\import` 的 (原始目标串, 行号, 是否闭合)。

    用平衡花括号读取参数，而不是 `[^}]*`：`\\input{\\foo{bar}}` 的原始目标
    是 `\\foo{bar}`，不能被截成 `\\foo{bar` 后当成静态路径去猜。目标是否
    可静态解析由 `_dynamic_ref_reason` 判定（R-05，v1.3）；花括号没收口
    同样算「无法静态解析」。
    """
    for m in _INPUT_CMD_RE.finditer(text):
        k = m.end()
        while k < len(text) and text[k] in " \t\r\n":
            k += 1
        if k >= len(text) or text[k] != "{":
            continue
        line = text.count("\n", 0, m.start()) + 1
        end = _input_arg_end(text, k)
        if end < 0:
            yield text[k + 1:], line, False
        else:
            yield text[k + 1:end - 1], line, True


def _mask_macro_defs(text: str) -> str:
    """把宏定义体抹成空白（保留换行），避免把定义里的 `\\input{#1}` 当闭包。

    `\\newcommand{\\tableinput}[1]{\\input{tables/#1}}` 是包装宏的定义，
    不是一次实际包含；闭包由 ``_input_wrappers`` + ``_wrapper_calls`` 展开。
    不抹掉的话，定义体里的 `#1` 会被误判成 ``INPUT_DYNAMIC``。
    """
    out = list(text)

    def blank(start: int, end: int) -> None:
        for k in range(start, min(end, len(out))):
            if out[k] != "\n":
                out[k] = " "

    for m in _DEF_RE.finditer(text):
        start = m.end() - 1
        if start < len(text) and text[start] == "{":
            blank(start + 1, _balanced_braces(text, start) - 1)
    for m in _DEF_SIMPLE_RE.finditer(text):
        start = m.end()
        if start < len(text) and text[start] == "{":
            blank(start + 1, _balanced_braces(text, start) - 1)
    return "".join(out)


def _dynamic_ref_reason(ref: str) -> str:
    """闭包目标为什么不能静态解析；空串＝静态可解析。"""
    s = str(ref or "").strip()
    if not s:
        return "目标为空"
    if "\\" in s:
        return "目标含宏/控制序列"
    if "#" in s:
        return "目标含参数占位符"
    if "{" in s or "}" in s:
        return "目标含嵌套花括号"
    return ""


def _input_wrappers(text: str) -> dict[str, tuple[str, str]]:
    """识别 `\\newcommand{\\X}[1]{\\input{#1}}` 这类「审计隧道」包装宏。

    V2.2 R-05 / 内部 B1：闭包必须展开纯 `\\input` 包装宏，否则表格整体
    绕开审计。返回 {宏名: (参数号, 目标模板)}，模板里保留 `#1` 占位。
    """
    out: dict[str, tuple[str, str]] = {}
    for m in _DEF_RE.finditer(text):
        name = m.group(1)
        body_start = m.end() - 1
        body_end = _balanced_braces(text, body_start)
        body = text[body_start + 1:body_end - 1].strip()
        w = _INPUT_WRAPPER_RE.match(body)
        if w:
            out[name] = (w.group(2), w.group(1))
    return out


def _wrapper_calls(text: str, wrappers: dict[str, tuple[str, str]]):
    for name, (argn, template) in wrappers.items():
        pat = re.compile(r"\\%s\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}" % re.escape(name))
        for m in pat.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            yield template.replace("#" + argn, m.group(1).strip()), line


def load_sections(cfg: Config) -> list[tuple[str, str]]:
    """sections = glob 递归命中 + `\\input/\\include/\\subfile` 闭包（红队 B4）
    + 纯 `\\input` 包装宏展开（V2.2 R-05 / 内部 B1）。

    文件边界不是句子边界（R-02）；这里只负责把「会被编译进 PDF 的文本文件」
    收齐，拼流与切句交给 texscan。闭包目标不存在时记进 ``cfg.missing_inputs``，
    由 audit 判 ``INPUT_TARGET_MISSING``（R-05）：不存在的目标不会静默放行。
    目标含宏/`#`/嵌套花括号/为空时记进 ``cfg.dynamic_inputs``，由 audit 判
    ``INPUT_DYNAMIC``：静态审计覆盖不了的目标一律 fail-closed，不许静默跳过。
    """
    cfg.missing_inputs = []
    cfg.dynamic_inputs = []
    if cfg.section_files:
        # V3 形态 C：显式章节清单（不是 glob）。闭包仍从这些文件各自的
        # `\input` 展开，但不会把目录里同名的无关 main.tex 也卷进来。
        found = {}
        for rel in cfg.section_files:
            p = cfg.root / rel
            if not p.is_file():
                raise ConfigError(
                    "sections 指向的 %s 不存在——没有起点就无法展开审计闭包" % rel)
            found[rel] = p
    elif cfg.root_tex:
        # V3：闭包从 root_tex 这个文件出发（不是 glob），避免递归把子目录里
        # 同名的 main.tex 也卷进来。
        root_file = cfg.root / cfg.root_tex
        if not root_file.is_file():
            raise ConfigError(
                "root_tex 指向的 %s 不存在——没有起点就无法展开审计闭包"
                % cfg.root_tex)
        found = {cfg.root_tex: root_file}
    else:
        found = _glob_paths(cfg.root, cfg.sections_glob)
    seen: dict[str, Path] = dict(found)
    queue: list[Path] = list(found.values())

    def add_ref(ref: str, bases: list[Path], src_rel: str, line: int) -> bool:
        ref = ref.strip()
        if not ref or "\\" in ref or "#" in ref:
            return False
        for base_dir in bases:
            for candidate in (base_dir / ref, base_dir / (ref + ".tex")):
                if not candidate.is_file():
                    continue
                try:
                    rel = candidate.resolve().relative_to(cfg.root.resolve()).as_posix()
                except ValueError:
                    return False
                if rel in seen:
                    return False
                seen[rel] = candidate
                queue.append(candidate)
                return True
        entry = (src_rel, ref, line)
        if entry not in cfg.missing_inputs:
            cfg.missing_inputs.append(entry)
        return False

    def add_raw_ref(raw: str, bases: list[Path], src_rel: str, line: int,
                    closed: bool = True) -> bool:
        """记录一个闭包目标：动态目标进 dynamic_inputs，静态目标走 add_ref。"""
        ref = str(raw or "").strip()
        if not closed or _dynamic_ref_reason(ref):
            entry = (src_rel, ref, line)
            if entry not in cfg.dynamic_inputs:
                cfg.dynamic_inputs.append(entry)
            return False
        return add_ref(ref, bases, src_rel, line)

    while True:
        # 普通 \input 闭包（注释/verbatim 里的 \input 不算引用，避免误判）
        while queue:
            p = queue.pop(0)
            text = _read_text(p, cfg.root)
            body = _mask_macro_defs(strip_comments_and_verbatim(text))
            src_rel = p.resolve().relative_to(cfg.root.resolve()).as_posix()
            for ref, line, closed in _input_refs(body):
                add_raw_ref(ref, [p.parent, cfg.root], src_rel, line,
                            closed=closed)
        # 包装宏：定义可能出现在后加载的文件里，故反复扫到稳定为止
        wrappers: dict[str, tuple[str, str]] = {}
        for p in list(seen.values()):
            wrappers.update(_input_wrappers(_read_text(p, cfg.root)))
        if not wrappers:
            break
        grew = False
        for p in list(seen.values()):
            text = strip_comments_and_verbatim(_read_text(p, cfg.root))
            src_rel = p.resolve().relative_to(cfg.root.resolve()).as_posix()
            for ref, line in _wrapper_calls(text, wrappers):
                if add_raw_ref(ref, [p.parent, cfg.root], src_rel, line):
                    grew = True
        if not grew:
            break

    out = []
    for rel in sorted(seen):
        out.append((rel, _read_text(seen[rel], cfg.root)))
    return out


def _read_text(path: Path, root: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise ConfigError("%s 不是合法 UTF-8：%s" % (path, exc))
    except OSError as exc:
        raise ConfigError("读不了 %s：%s" % (path, exc))


def all_tex_files(cfg: Config) -> list[str]:
    """项目内全部 .tex（用于「闭包外文件是否从未被审计」的覆盖报告）。"""
    out = []
    for p in cfg.root.glob("**/*.tex"):
        if not p.is_file():
            continue
        parts = set(p.relative_to(cfg.root).parts)
        if parts & _SKIP_DIRS:
            continue
        out.append(p.relative_to(cfg.root).as_posix())
    return sorted(out)


def facts_digest(cfg: Config) -> str:
    """账本输入指纹：所有 facts 文件按路径排序后串哈希（红队 D7）。"""
    h = hashlib.sha256()
    for name, path in sorted(_glob_paths(cfg.root, cfg.facts_glob).items()):
        h.update(name.encode("utf-8"))
        h.update(path.read_bytes())
    return h.hexdigest()


def git_commit(root: Path) -> str:
    """尽力读 git 提交号；读不到就空串（不联网、不调 git 命令）。"""
    head = root / ".git" / "HEAD"
    try:
        raw = head.read_text(encoding="utf-8").strip()
    except OSError:
        return ""
    if raw.startswith("ref:"):
        ref = raw.split(":", 1)[1].strip()
        try:
            return (root / ".git" / ref).read_text(encoding="utf-8").strip()
        except OSError:
            return ""
    return raw
