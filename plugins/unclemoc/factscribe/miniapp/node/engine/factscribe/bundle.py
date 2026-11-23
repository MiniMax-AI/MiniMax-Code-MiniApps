# -*- coding: utf-8 -*-
"""投稿工件包（`factscribe bundle`）：闭包收集 → 清单门 → 打包 → MANIFEST 复验。

三步走，零 LLM、零网络、纯标准库：

1. **收集**：从 main.tex 起展开 ``\\input``/``\\include`` 闭包（复用
   ``config.load_sections`` 的既有闭包算法，调用不复制逻辑），外加
   refs.bib、figures/、tables/、facts/*.toml、runs/ 的**已签收**副本、
   audit/ 三件（evidence.lock／evidence-log.ndjson／matrix.md）。
2. **清单门**：逐项机械判（闭包完整／每图有随图 CSV／bib 无缺唯一键条目／
   evidence.lock 在场且未过期／audit 现跑 exit 0）。任一项不过 → 退出码 1，
   逐项列出（过／不过／豁免三态），**不静默放行**。
3. **导出**：产出包目录 ＋ ``MANIFEST.sha256``（逐文件 sha256 行，收包方
   ``shasum -a 256 -c`` 逐行可验）＋ ``BUNDLE-MANIFEST.json``（清单：收了
   哪些、哪些只在清单里没进包、门逐项结果）。

**期刊差异落在项目侧**（用户裁定）：项目根可放 ``bundle-checklist.toml``，
声明**附加检查项**（文件存在／glob 计数下限／正则匹配三形之一）与**排除项**
（文件模式／行模式排除声明，不做语义判断）。工具代码里零期刊专名——
每家期刊不一样的地方一律走配置。

错误码按不透明数据键处理（``BUNDLE_`` 前缀），不进错误码词册。
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from .audit import _aggregate_exit, run_audit
from .checks import aggregate_exit as checks_aggregate_exit
from .checks import run_packages
from .config import (Config, ConfigError, load_facts, load_sections)
from .evidence import lock_check, read_lock, unfrozen_info
from .texscan import scan_tex

BUNDLE_VERSION = "1"
MANIFEST_NAME = "MANIFEST.sha256"
INVENTORY_NAME = "BUNDLE-MANIFEST.json"
CHECKLIST_NAME = "bundle-checklist.toml"
DEFAULT_OUT_SUFFIX = ".bundle"

# 清单门内置五项（通用清单）。期刊差异一律走 bundle-checklist.toml，
# 不在这里写死任何期刊专名。
GATE_CLOSURE = "BUNDLE_CLOSURE"
GATE_FIGURE_CSV = "BUNDLE_FIGURE_CSV"
GATE_BIB = "BUNDLE_BIB"
GATE_EVIDENCE_LOCK = "BUNDLE_EVIDENCE_LOCK"
GATE_AUDIT = "BUNDLE_AUDIT"

STATUS_PASS = "pass"
STATUS_FAIL = "fail"
STATUS_WAIVED = "waived"
STATUS_TEXT = {STATUS_PASS: "过", STATUS_FAIL: "不过", STATUS_WAIVED: "豁免"}

# 附加检查项的三种机械判式（配置里 `kind` 的合法取值）。
CHECK_KINDS = ("exists", "glob_min", "regex")

# 审计判定码 → 清单门关心的（复用既有判定，不复制判据）。
BIB_CODES = ("MISSING_CITE", "DUPLICATE_BIB_KEY", "BIB_NO_STABLE_ID")
FIGURE_CODE = "FIGURE_UNVERIFIED"


# --------------------------------------------------------------------------
# 清单门条目
# --------------------------------------------------------------------------

@dataclass
class GateItem:
    """清单门的一项：过／不过／豁免三态。"""

    code: str
    name: str
    status: str
    detail: str = ""
    origin: str = "builtin"      # builtin | config

    @property
    def ok(self) -> bool:
        return self.status != STATUS_FAIL

    def as_dict(self) -> dict:
        return {"code": self.code, "name": self.name, "status": self.status,
                "status_text": STATUS_TEXT[self.status], "detail": self.detail,
                "origin": self.origin}


# --------------------------------------------------------------------------
# 项目侧配置：bundle-checklist.toml（期刊差异的落位）
# --------------------------------------------------------------------------

@dataclass
class ExtraCheck:
    """附加检查项：名称 ＋ 机械判式（文件存在／glob 计数下限／正则匹配）。"""

    name: str
    kind: str
    path: str = ""
    glob: str = ""
    min: int = 0
    file: str = ""
    pattern: str = ""


@dataclass
class Exclude:
    """排除项：文件模式（整件不进包）或行模式（命中行不进包）。"""

    file: str = ""
    pattern: str = ""


@dataclass
class Checklist:
    """项目侧的清单配置（= 期刊差异声明）。"""

    present: bool = False
    path: str = ""
    checks: list = field(default_factory=list)
    excludes: list = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "present": self.present,
            "path": self.path,
            "checks": [{"name": c.name, "kind": c.kind} for c in self.checks],
            "excludes": [{"file": e.file, "pattern": e.pattern}
                         for e in self.excludes],
        }


def _cfg_error(msg: str) -> ConfigError:
    return ConfigError(msg, code="BUNDLE_CONFIG_INVALID")


def _check_fields(raw: dict, where: str) -> tuple:
    """校验一条附加检查项，返回 (name, kind, payload)。写错 → exit 2 并点名。"""
    name = str(raw.get("name") or "").strip()
    if not name:
        raise _cfg_error("%s：附加检查项缺 name（每项必须有名）" % where)
    kind = str(raw.get("kind") or "").strip()
    if kind not in CHECK_KINDS:
        raise _cfg_error("%s：附加检查项 %r 的 kind=%r 不合法（只允许 %s）"
                         % (where, name, kind, "／".join(CHECK_KINDS)))
    allowed = {"name", "kind"}
    if kind == "exists":
        allowed |= {"path"}
        target = str(raw.get("path") or "").strip()
        if not target:
            raise _cfg_error("%s：附加检查项 %r（kind=exists）缺 path"
                             % (where, name))
    elif kind == "glob_min":
        allowed |= {"glob", "min"}
        target = str(raw.get("glob") or "").strip()
        if not target:
            raise _cfg_error("%s：附加检查项 %r（kind=glob_min）缺 glob"
                             % (where, name))
        if "min" not in raw:
            raise _cfg_error("%s：附加检查项 %r（kind=glob_min）缺 min"
                             % (where, name))
        try:
            minimum = int(raw.get("min"))
        except (TypeError, ValueError):
            raise _cfg_error("%s：附加检查项 %r 的 min 不是整数：%r"
                             % (where, name, raw.get("min")))
        if minimum < 0:
            raise _cfg_error("%s：附加检查项 %r 的 min 不能为负：%r"
                             % (where, name, minimum))
    else:
        allowed |= {"file", "pattern"}
        if not str(raw.get("file") or "").strip():
            raise _cfg_error("%s：附加检查项 %r（kind=regex）缺 file"
                             % (where, name))
        if not str(raw.get("pattern") or "").strip():
            raise _cfg_error("%s：附加检查项 %r（kind=regex）缺 pattern"
                             % (where, name))
    unknown = sorted(set(raw) - allowed)
    if unknown:
        raise _cfg_error("%s：附加检查项 %r 有未知键：%s（%s 形态只允许 %s）"
                         % (where, name, "、".join(unknown), kind,
                            "、".join(sorted(allowed - {"name"}))))
    return name, kind, raw


def load_checklist(root: Path) -> Checklist:
    """读项目侧 ``bundle-checklist.toml``；没有就用内置默认（无附加项）。

    配置文件写错 → ``ConfigError``（退出码 2）并点名是哪一条。
    """
    path = Path(root) / CHECKLIST_NAME
    out = Checklist()
    if not path.is_file():
        return out
    from .config import load_toml          # 3.11+ tomllib，3.10 走仓内兜底解析
    try:
        data = load_toml(path)
    except ConfigError as exc:
        raise _cfg_error("%s 解析失败：%s" % (CHECKLIST_NAME, exc))
    if not isinstance(data, dict):
        raise _cfg_error("%s 顶层必须是表" % CHECKLIST_NAME)
    out.present = True
    out.path = CHECKLIST_NAME
    raw_checks = data.get("check") or []
    if isinstance(raw_checks, dict):
        raw_checks = [raw_checks]
    if not isinstance(raw_checks, list):
        raise _cfg_error("%s 的 check 必须是数组（[[check]] 逐条声明）"
                         % CHECKLIST_NAME)
    for index, raw in enumerate(raw_checks, 1):
        where = "%s 第 %d 条 check" % (CHECKLIST_NAME, index)
        if not isinstance(raw, dict):
            raise _cfg_error("%s 不是一张表" % where)
        name, kind, payload = _check_fields(raw, where)
        out.checks.append(ExtraCheck(
            name=name, kind=kind,
            path=str(payload.get("path") or "").strip(),
            glob=str(payload.get("glob") or "").strip(),
            min=int(payload.get("min") or 0),
            file=str(payload.get("file") or "").strip(),
            pattern=str(payload.get("pattern") or "").strip(),
        ))
    raw_excludes = data.get("exclude") or []
    if isinstance(raw_excludes, dict):
        raw_excludes = [raw_excludes]
    if not isinstance(raw_excludes, list):
        raise _cfg_error("%s 的 exclude 必须是数组（[[exclude]] 逐条声明）"
                         % CHECKLIST_NAME)
    for index, raw in enumerate(raw_excludes, 1):
        where = "%s 第 %d 条 exclude" % (CHECKLIST_NAME, index)
        if not isinstance(raw, dict):
            raise _cfg_error("%s 不是一张表" % where)
        unknown = sorted(set(raw) - {"file", "pattern"})
        if unknown:
            raise _cfg_error("%s 有未知键：%s（只支持 file／pattern）"
                             % (where, "、".join(unknown)))
        file_glob = str(raw.get("file") or "").strip()
        pattern = str(raw.get("pattern") or "").strip()
        if not file_glob and not pattern:
            raise _cfg_error("%s：file 与 pattern 至少给一个"
                             "（file＝整件排除，pattern＝行模式排除）" % where)
        if pattern:
            try:
                re.compile(pattern)
            except re.error as exc:
                raise _cfg_error("%s：pattern 不是合法正则：%s" % (where, exc))
        out.excludes.append(Exclude(file=file_glob, pattern=pattern))
    return out


# --------------------------------------------------------------------------
# 闭包收集（复用 config.load_sections 的既有闭包算法）
# --------------------------------------------------------------------------

@dataclass
class Closure:
    files: list = field(default_factory=list)     # 闭包内源文件（项目内相对路径）
    missing: list = field(default_factory=list)   # 悬空 \input/\include
    dynamic: list = field(default_factory=list)   # 无法静态解析的目标
    root_tex: str = ""
    cfg: Config = None                            # 闭包口径下的 cfg 副本

    def as_dict(self) -> dict:
        return {"root_tex": self.root_tex, "files": list(self.files),
                "missing": [list(x) for x in self.missing],
                "dynamic": [list(x) for x in self.dynamic]}


def collect_closure(cfg: Config) -> Closure:
    """从 main.tex 起展开 ``\\input``/``\\include`` 闭包（fail-closed）。

    闭包算法本身**不在这里重写**：直接调 ``config.load_sections``，只把起点
    换成 main.tex（V3 项目自带 root_tex／section_files 时尊重项目声明）。
    悬空目标与动态目标由既有算法记账，审计面照旧判红。
    """
    scoped = copy.copy(cfg)
    root_tex = str(cfg.root_tex or "").strip()
    if not root_tex and not cfg.section_files:
        if (cfg.root / "main.tex").is_file():
            root_tex = "main.tex"
    if root_tex and not cfg.section_files:
        scoped.root_tex = root_tex
    sections = load_sections(scoped)
    return Closure(
        files=sorted(rel for rel, _ in sections),
        missing=[tuple(x) for x in getattr(scoped, "missing_inputs", [])],
        dynamic=[tuple(x) for x in getattr(scoped, "dynamic_inputs", [])],
        root_tex=root_tex,
        cfg=scoped,
    )


# --------------------------------------------------------------------------
# 清单门：逐项机械判
# --------------------------------------------------------------------------

def _run_gate_audit(cfg: Config, closure: Closure) -> dict:
    """现跑一遍审计（闭包口径），返回退出码与全部判定条目。"""
    facts = load_facts(cfg)
    sections = [(rel, (cfg.root / rel).read_text(encoding="utf-8"))
                if (cfg.root / rel).is_file() else (rel, "")
                for rel in closure.files]
    if not sections:
        raise ConfigError("项目里没有 .tex 源文件（闭包为空）——没有材料可打包",
                          code="BUNDLE_CONFIG_INVALID")
    if cfg.checks_defined:
        red, yellow, hints, summary, unresolved = run_packages(
            cfg, facts, sections, resolve=False)
        code = checks_aggregate_exit(red, yellow, False,
                                     integrity_first=cfg.is_v3)
    else:
        red, yellow, hints, summary, unresolved = run_audit(
            cfg, facts, sections, resolve=False)
        code = _aggregate_exit(red, yellow, False, integrity_first=cfg.is_v3)
    issues = list(red) + list(yellow) + list(hints)
    return {"code": code, "issues": issues, "red": list(red),
            "yellow": list(yellow), "summary": summary or {}}


def _closure_item(closure: Closure) -> GateItem:
    if closure.missing:
        detail = "；".join(
            "悬空 \\input/\\include：%s:%s → %s（目标不存在）"
            % (src, line, ref) for src, ref, line in closure.missing)
        return GateItem(GATE_CLOSURE, "闭包完整（无悬空 \\input/\\include）",
                        STATUS_FAIL, detail)
    if closure.dynamic:
        detail = "；".join(
            "无法静态解析的目标：%s:%s → %s（fail-closed）"
            % (src, line, ref) for src, ref, line in closure.dynamic)
        return GateItem(GATE_CLOSURE, "闭包完整（无悬空 \\input/\\include）",
                        STATUS_FAIL, detail)
    if not closure.files:
        return GateItem(GATE_CLOSURE, "闭包完整（无悬空 \\input/\\include）",
                        STATUS_FAIL, "闭包为空：项目里没有 .tex 源文件")
    return GateItem(GATE_CLOSURE, "闭包完整（无悬空 \\input/\\include）",
                    STATUS_PASS,
                    "闭包 %d 个源文件（起点 %s），无悬空引用"
                    % (len(closure.files), closure.root_tex or "sections"))


def _figure_item(cfg: Config, closure: Closure, audit: dict) -> GateItem:
    figures = set()
    for rel in closure.files:
        p = cfg.root / rel
        if not p.is_file():
            continue
        try:
            scan = scan_tex(p.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError):
            continue
        figures.update(scan.figures)
    unverified = [i for i in audit["issues"] if i.code == FIGURE_CODE]
    if unverified:
        detail = "；".join("图 %s 没有随图数据（.csv）" % i.token
                           for i in unverified)
        return GateItem(GATE_FIGURE_CSV, "每张图有随图 .csv", STATUS_FAIL, detail)
    if not figures:
        return GateItem(GATE_FIGURE_CSV, "每张图有随图 .csv", STATUS_WAIVED,
                        "本项目闭包内没有图，无随图 CSV 可查")
    return GateItem(GATE_FIGURE_CSV, "每张图有随图 .csv", STATUS_PASS,
                    "%d 张图都有随图 .csv" % len(figures))


def _bib_item(audit: dict) -> GateItem:
    bad = [i for i in audit["issues"] if i.code in BIB_CODES]
    if bad:
        detail = "；".join("%s：%s" % (i.code, i.message) for i in bad)
        return GateItem(GATE_BIB, "bib 无缺唯一键条目（引用都落得到）",
                        STATUS_FAIL, detail)
    return GateItem(GATE_BIB, "bib 无缺唯一键条目（引用都落得到）", STATUS_PASS,
                    "引用与 bib 条目一一落得到，无缺键／无缺稳定标识")


def _evidence_lock_item(cfg: Config) -> GateItem:
    name = "evidence.lock 在场且未过期"
    try:
        lock = read_lock(cfg.root)
    except ConfigError as exc:
        return GateItem(GATE_EVIDENCE_LOCK, name, STATUS_FAIL,
                        "冻结件读不了：%s" % exc)
    if lock is None:
        if getattr(cfg, "evidence_defined", False):
            return GateItem(GATE_EVIDENCE_LOCK, name, STATUS_FAIL,
                            "[evidence] 声明在场，但没有 audit/evidence.lock")
        return GateItem(GATE_EVIDENCE_LOCK, name, STATUS_WAIVED,
                        "本项目未启用证据钢印，无冻结件可查")
    unfrozen = unfrozen_info(cfg.root)
    if unfrozen is not None:
        return GateItem(GATE_EVIDENCE_LOCK, name, STATUS_FAIL,
                        "冻结件处于解冻状态（最后一条是 unfreeze）：%s"
                        % unfrozen.get("reason") or "未写理由")
    stale = lock_check(cfg)
    if stale is not None:
        return GateItem(GATE_EVIDENCE_LOCK, name, STATUS_FAIL, stale["message"])
    return GateItem(GATE_EVIDENCE_LOCK, name, STATUS_PASS,
                    "冻结件在场（%d 条，sha256 %s…），未解冻、与当前清单一致"
                    % (lock.get("entries") or 0, str(lock.get("sha256"))[:12]))


def _audit_item(audit: dict) -> GateItem:
    """清单门的审计项：现跑一遍，**红码即拦**（黄码逐条列出但不拦）。

    为什么不是「退出码必须为 0」：本仓的 audit 把「未核验／未绑定／
    闭包外生成物」记成黄（如 G2 生成的 ``figures/gen/<名>.tex`` 是独立编译
    的图件源，不在审计闭包内 → ``UNSCANNED_TEX`` 黄）。按字面「exit 0」
    会让工单点名的「含图最小项目（可用 G2 figures gen 造）」永远过不了
    清单门，而铁律 2 又禁改既有审计行为。故此处按**红码＝判死**落闸，
    黄码在明细里逐条列出，交由人看。
    """
    code = audit["code"]
    reds = audit["red"]
    yellows = audit["yellow"]
    if reds:
        detail = "审计判红（退出码 %d，%d 红）：%s" % (
            code, len(reds), "；".join("%s %s" % (i.code, i.message)
                                      for i in reds[:5]))
        return GateItem(GATE_AUDIT, "audit 现跑无红", STATUS_FAIL, detail)
    if yellows:
        detail = "审计无红（退出码 %d，%d 黄，不拦）：%s" % (
            code, len(yellows), "、".join(sorted({i.code for i in yellows})))
        return GateItem(GATE_AUDIT, "audit 现跑无红", STATUS_PASS, detail)
    return GateItem(GATE_AUDIT, "audit 现跑无红", STATUS_PASS,
                    "审计退出码 0（无红无黄）")



def _glob_count(root: Path, pattern: str) -> int:
    count = 0
    for p in sorted(root.glob(pattern)):
        if p.is_file():
            count += 1
    return count


def _extra_item(index: int, check: ExtraCheck, root: Path) -> GateItem:
    code = "BUNDLE_CUSTOM_%d" % index
    if check.kind == "exists":
        target = root / check.path
        if target.exists():
            return GateItem(code, check.name, STATUS_PASS,
                            "%s 在场" % check.path, origin="config")
        return GateItem(code, check.name, STATUS_FAIL,
                        "%s 不存在" % check.path, origin="config")
    if check.kind == "glob_min":
        count = _glob_count(root, check.glob)
        if count >= check.min:
            return GateItem(code, check.name, STATUS_PASS,
                            "%s 命中 %d 个（下限 %d）"
                            % (check.glob, count, check.min), origin="config")
        return GateItem(code, check.name, STATUS_FAIL,
                        "%s 只命中 %d 个（下限 %d）"
                        % (check.glob, count, check.min), origin="config")
    target = root / check.file
    if not target.is_file():
        return GateItem(code, check.name, STATUS_FAIL,
                        "%s 不存在（正则无处可查）" % check.file, origin="config")
    try:
        text = target.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return GateItem(code, check.name, STATUS_FAIL,
                        "%s 读不了：%s" % (check.file, exc), origin="config")
    try:
        hit = re.search(check.pattern, text)
    except re.error as exc:
        raise _cfg_error("%s 的 check %r 的 pattern 不是合法正则：%s"
                         % (CHECKLIST_NAME, check.name, exc))
    if hit:
        return GateItem(code, check.name, STATUS_PASS,
                        "%s 命中 %s" % (check.file, check.pattern),
                        origin="config")
    return GateItem(code, check.name, STATUS_FAIL,
                    "%s 未命中 %s" % (check.file, check.pattern), origin="config")


def build_gate(cfg: Config, closure: Closure, audit: dict,
               checklist: Checklist) -> list:
    """逐项机械判，返回清单门条目（过／不过／豁免三态）。"""
    items = [
        _closure_item(closure),
        _figure_item(cfg, closure, audit),
        _bib_item(audit),
        _evidence_lock_item(cfg),
        _audit_item(audit),
    ]
    for index, check in enumerate(checklist.checks, 1):
        items.append(_extra_item(index, check, cfg.root))
    return items


# --------------------------------------------------------------------------
# 工件收集（runs/ 只收已签收副本；排除项按声明生效）
# --------------------------------------------------------------------------

def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _match_glob(rel: str, pattern: str) -> bool:
    from fnmatch import fnmatch
    if not pattern:
        return False
    if fnmatch(rel, pattern):
        return True
    return fnmatch(rel, pattern.rstrip("/") + "/*")


def _excluded_files(root: Path, excludes: list) -> set:
    """整件排除：**只声明 file（没带 pattern）** 的条目＝该件不进包。

    带了 pattern 的条目里，file 是「pattern 的作用域」而不是整件排除。
    """
    out = set()
    for ex in excludes:
        if not ex.file or ex.pattern:
            continue
        for p in root.glob(ex.file):
            if p.is_file():
                out.add(p.resolve().relative_to(root.resolve()).as_posix())
    return out


def _line_patterns(root: Path, excludes: list) -> dict:
    """行模式排除：{文件 glob: [正则]}。

    只带 pattern 的条目作用于全部文件（作用域 ``**/*``）；同时带 file 的
    条目只作用于该 glob 命中的文件。
    """
    out = {}
    for ex in excludes:
        if not ex.pattern:
            continue
        out.setdefault(ex.file or "**/*", []).append(ex.pattern)
    return out


def _refs_to_excluded(text: str, excluded: set) -> bool:
    """本行是否引用了被整件排除的文件（复用既有 ``_input_refs`` 解析）。"""
    from .config import _input_refs
    for raw, _line, _closed in _input_refs(text):
        ref = str(raw or "").strip()
        if not ref:
            continue
        for rel in excluded:
            base = rel[:-4] if rel.endswith(".tex") else rel
            tail = base.rsplit("/", 1)[-1]
            if ref in (rel, base, tail) or ref.endswith("/" + base):
                return True
    return False


def _apply_exclusions(root: Path, rel: str, text: str,
                      patterns: dict, excluded: set) -> str:
    """按声明删行：行模式命中即删；引用被整件排除文件的行也删（保持包自洽）。"""
    hits = []
    for pattern, regs in patterns.items():
        if _match_glob(rel, pattern):
            hits.extend(regs)
    lines = text.splitlines(keepends=True)
    kept = []
    for line in lines:
        if hits and any(re.search(p, line) for p in hits):
            continue
        if excluded and _refs_to_excluded(line, excluded):
            continue
        kept.append(line)
    return "".join(kept)


def _collect_artifacts(cfg: Config, closure: Closure, checklist: Checklist,
                       runs_mode: str) -> dict:
    """收拢工件：返回 {files: [(rel, Path)], listed_only: [...]}。"""
    root = cfg.root.resolve()
    excluded = _excluded_files(root, checklist.excludes)
    picked: dict = {}

    def put(rel: str, path: Path) -> None:
        if rel in excluded:
            return
        picked[rel] = path

    for rel in closure.files:
        p = root / rel
        if p.is_file():
            put(rel, p)
    bib = cfg.bib
    if bib and (root / bib).is_file():
        put(bib, root / bib)
    facts_glob = cfg.facts_glob or "facts/*.toml"
    if getattr(cfg, "facts_dirs", False):
        for p in sorted((root / facts_glob).rglob("*.toml")):
            if p.is_file():
                put(p.relative_to(root).as_posix(), p)
    else:
        for p in sorted(root.glob(facts_glob)):
            if p.is_file():
                put(p.relative_to(root).as_posix(), p)
    for sub in ("figures", "tables"):
        base = root / sub
        if not base.is_dir():
            continue
        for p in sorted(base.rglob("*")):
            if p.is_file():
                put(p.relative_to(root).as_posix(), p)
    for rel in ("audit/evidence.lock", "audit/evidence-log.ndjson",
                "audit/matrix.md"):
        p = root / rel
        if p.is_file():
            put(rel, p)
    # runs/：默认只收已签收副本（组内有 *.signoff.toml）；未签收的只进清单。
    listed_only = []
    runs_base = root / "runs"
    if runs_base.is_dir():
        groups = {}
        for p in sorted(runs_base.rglob("*")):
            if not p.is_file():
                continue
            rel = p.relative_to(root).as_posix()
            group = rel.split("/", 1)[1].split("/", 1)[0] if "/" in rel else ""
            groups.setdefault(group, []).append((rel, p))
        for group, items in groups.items():
            signed = any(rel.endswith(".signoff.toml") for rel, _ in items)
            if signed or runs_mode == "full":
                for rel, p in items:
                    put(rel, p)
            else:
                listed_only.append({
                    "group": group or "runs",
                    "reason": "未签收（组内没有 *.signoff.toml）",
                    "files": [rel for rel, _ in items],
                })
    return {"files": sorted(picked.items()), "listed_only": listed_only,
            "excluded": sorted(excluded)}


# --------------------------------------------------------------------------
# 打包与复验
# --------------------------------------------------------------------------

def default_out_dir(cfg: Config) -> Path:
    """默认包目录：项目**外面**的同名兄弟目录。

    包若落在项目内，包里的 .tex 副本会被审计的覆盖报告当成「闭包外的
    .tex」→ 源项目审计读数会变。默认放外面，源项目一个字节都不动。
    """
    root = cfg.root.resolve()
    return root.parent / (root.name + DEFAULT_OUT_SUFFIX)


def _prepare_out_dir(out_dir: Path) -> None:
    if out_dir.exists():
        if not out_dir.is_dir():
            raise _cfg_error("包目录 %s 已存在且不是目录" % out_dir)
        entries = list(out_dir.iterdir())
        known = {MANIFEST_NAME, INVENTORY_NAME}
        if entries and not all(e.name in known for e in entries):
            raise _cfg_error(
                "包目录 %s 已存在且不是工件包目录（只认 %s／%s）——换个 --out"
                % (out_dir, MANIFEST_NAME, INVENTORY_NAME))
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)


def _artifact_bytes(root: Path, rel: str, source: Path,
                  patterns: dict, excluded: set) -> tuple[bytes, bool]:
    """一件工件进包前的字节（按声明删行）＋ 有没有被改过。

    写盘与**预览**共用这一条路——预览看到的字节/指纹/大小与真导出逐字一致。
    """
    try:
        text = source.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return source.read_bytes(), False
    new_text = _apply_exclusions(root, rel, text, patterns, excluded)
    return new_text.encode("utf-8"), new_text != text


def _plan_artifact(root: Path, rel: str, source: Path,
                   patterns: dict, excluded: set) -> dict:
    """一件工件的记账条目（**不写盘**）——导出前的预览用这个。"""
    data, transformed = _artifact_bytes(root, rel, source, patterns, excluded)
    return {"path": rel, "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data), "transformed": transformed}


def _write_artifact(out_dir: Path, root: Path, rel: str, source: Path,
                    patterns: dict, excluded: set) -> dict:
    """把一件工件写进包（按声明删行），返回记账条目。"""
    target = out_dir / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    data, transformed = _artifact_bytes(root, rel, source, patterns, excluded)
    target.write_bytes(data)
    return {"path": rel, "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data), "transformed": transformed}


def run_bundle(cfg: Config, runs_mode: str = "signed", out_dir=None,
               preview: bool = False) -> dict:
    """跑完三步：收集 → 清单门 → 导出。返回结果字典（含退出码）。

    ``preview=True``＝**只算不写**（导出前的可选预览一步）：闭包、清单门、
    将要收的每一件（路径/指纹/大小）与真导出走**同一条路**（同一个
    `_artifact_bytes`），只是不落盘。清单门的判定一字不改：门不过照样
    ``exit_code=1``、照样不出包。
    """
    checklist = load_checklist(cfg.root)
    closure = collect_closure(cfg)
    try:
        audit = _run_gate_audit(cfg, closure)
    except ConfigError as exc:
        audit = {"code": 2, "issues": [], "red": [], "yellow": [],
                 "summary": {}, "error": str(exc)}
    items = build_gate(cfg, closure, audit, checklist)
    failed = [i for i in items if i.status == STATUS_FAIL]
    result = {
        "command": "bundle",
        "checklist": checklist.as_dict(),
        "closure": closure.as_dict(),
        "gate": [i.as_dict() for i in items],
        "failed": len(failed),
        "passed": sum(1 for i in items if i.status == STATUS_PASS),
        "waived": sum(1 for i in items if i.status == STATUS_WAIVED),
        "audit_exit": audit["code"],
        "bundle_dir": None,
        "files": [],
        "listed_only": [],
        "manifest_lines": 0,
        "exit_code": 0,
    }
    if failed:
        result["exit_code"] = 1
        result["failure_reason"] = "清单门未过：%s" % "、".join(
            "%s（%s）" % (i.code, i.name) for i in failed)
        if preview:
            # 预览：门不过就**不出包**（与真导出口径一致），只把门结论给出去。
            result["preview"] = True
            result["would_export"] = False
        return result
    artifacts = _collect_artifacts(cfg, closure, checklist, runs_mode)
    root = cfg.root.resolve()
    excluded = set(artifacts["excluded"])
    patterns = _line_patterns(root, checklist.excludes)
    out = Path(out_dir) if out_dir else default_out_dir(cfg)
    out = out.resolve()
    if preview:
        # 预览：**一个字节都不写**。将要收的每一件照真导出的口径算出来
        # （路径/指纹/大小），清单门的结论一字不改。
        entries = [_plan_artifact(root, rel, source, patterns, excluded)
                   for rel, source in artifacts["files"]]
        result.update({
            "preview": True,
            "would_export": True,
            "bundle_dir": str(out),
            "files": entries,
            "listed_only": artifacts["listed_only"],
            "excluded": artifacts["excluded"],
            "manifest_lines": len(entries) + 1,
        })
        return result
    _prepare_out_dir(out)
    entries = []
    for rel, source in artifacts["files"]:
        entries.append(_write_artifact(out, root, rel, source, patterns,
                                       excluded))
    inventory = {
        "bundle_version": BUNDLE_VERSION,
        "project": str(root),
        "runs_mode": runs_mode,
        "closure": closure.as_dict(),
        "gate": [i.as_dict() for i in items],
        "files": entries,
        "listed_only": artifacts["listed_only"],
        "excluded": artifacts["excluded"],
    }
    (out / INVENTORY_NAME).write_text(
        json.dumps(inventory, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")
    # MANIFEST.sha256：包内每件一行（不含 MANIFEST 自身）——收包方可逐行复算。
    lines = []
    for p in sorted(out.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(out).as_posix()
        if rel == MANIFEST_NAME:
            continue
        lines.append("%s  %s" % (_sha256_file(p), rel))
    (out / MANIFEST_NAME).write_text("\n".join(lines) + "\n", encoding="utf-8")
    result.update({
        "exit_code": 0,
        "bundle_dir": str(out),
        "files": entries,
        "listed_only": artifacts["listed_only"],
        "excluded": artifacts["excluded"],
        "manifest_lines": len(lines),
    })
    return result


def verify_bundle(bundle_dir: Path) -> dict:
    """复算包目录的 MANIFEST.sha256：逐行复算 ＋ 件数对表，红即点名。"""
    out = Path(bundle_dir).resolve()
    manifest = out / MANIFEST_NAME
    if not out.is_dir():
        return {"command": "bundle", "action": "verify", "exit_code": 2,
                "ok": False, "mismatched": [], "missing": [], "extra": [],
                "lines": 0, "files": 0,
                "message": "包目录不存在：%s" % out}
    if not manifest.is_file():
        return {"command": "bundle", "action": "verify", "exit_code": 1,
                "ok": False, "mismatched": [], "missing": [], "extra": [],
                "lines": 0, "files": 0,
                "message": "包里没有 %s——不是工件包" % MANIFEST_NAME}
    listed = {}
    for number, line in enumerate(manifest.read_text(encoding="utf-8")
                                  .splitlines(), 1):
        if not line.strip():
            continue
        digest, _, rel = line.partition("  ")
        if not rel.strip():
            digest, _, rel = line.partition(" ")
            rel = rel.strip()
        rel = rel.strip()
        if not rel or len(digest.strip()) != 64:
            return {"command": "bundle", "action": "verify", "exit_code": 1,
                    "ok": False, "mismatched": [], "missing": [], "extra": [],
                    "lines": 0, "files": 0,
                    "message": "%s 第 %d 行格式不对：%r"
                               % (MANIFEST_NAME, number, line)}
        listed[rel] = digest.strip().lower()
    actual = {}
    for p in sorted(out.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(out).as_posix()
        if rel == MANIFEST_NAME:
            continue
        actual[rel] = _sha256_file(p)
    mismatched = sorted(rel for rel in listed
                         if rel in actual and actual[rel] != listed[rel])
    missing = sorted(rel for rel in listed if rel not in actual)
    extra = sorted(rel for rel in actual if rel not in listed)
    ok = not (mismatched or missing or extra)
    return {"command": "bundle", "action": "verify", "exit_code": 0 if ok else 1,
            "ok": ok, "mismatched": mismatched, "missing": missing,
            "extra": extra, "lines": len(listed), "files": len(actual),
            "bundle_dir": str(out),
            "message": "逐行复算通过：%d 件全对" % len(listed) if ok else ""}


# --------------------------------------------------------------------------
# 人读报告
# --------------------------------------------------------------------------

def render_bundle(result: dict) -> str:
    lines = ["== factscribe bundle =="]
    gate = result.get("gate") or []
    lines.append("清单门 : %d 项（过 %d / 不过 %d / 豁免 %d）"
                 % (len(gate), result.get("passed", 0), result.get("failed", 0),
                    result.get("waived", 0)))
    for item in gate:
        lines.append("  [%s] %-22s %s"
                     % (STATUS_TEXT.get(item["status"], item["status"]),
                        item["code"], item["name"]))
        if item.get("detail"):
            lines.append("        %s" % item["detail"])
    if result.get("exit_code"):
        lines.append("")
        lines.append("结论：清单门未过（%d 项不过）→ 不打包，退出码 %d"
                     % (result.get("failed", 0), result["exit_code"]))
        return "\n".join(lines)
    lines.append("包目录 : %s" % result.get("bundle_dir"))
    lines.append("工件   : 收 %d 件；清单里只记不收 %d 组"
                 % (len(result.get("files") or []),
                    len(result.get("listed_only") or [])))
    lines.append("MANIFEST: %s（%d 行 sha256）"
                 % (MANIFEST_NAME, result.get("manifest_lines", 0)))
    lines.append("下一步 : cd %s && shasum -a 256 -c %s"
                 % (result.get("bundle_dir"), MANIFEST_NAME))
    return "\n".join(lines)


def render_verify(result: dict) -> str:
    lines = ["== factscribe bundle --verify =="]
    lines.append("包目录 : %s" % result.get("bundle_dir"))
    if not result.get("ok"):
        lines.append("结论 : 不符，退出码 %d" % result.get("exit_code", 1))
        if result.get("message"):
            lines.append("原因 : %s" % result["message"])
        for rel in result.get("mismatched") or []:
            lines.append("  [不符] %s（哈希与 MANIFEST 不一致）" % rel)
        for rel in result.get("missing") or []:
            lines.append("  [缺件] %s（MANIFEST 里有，包里没有）" % rel)
        for rel in result.get("extra") or []:
            lines.append("  [多件] %s（包里有，MANIFEST 里没有）" % rel)
        return "\n".join(lines)
    lines.append("件数   : MANIFEST %d 行 / 包内 %d 件（不含 %s 自身）"
                 % (result.get("lines", 0), result.get("files", 0), MANIFEST_NAME))
    lines.append("结论 : 逐行复算全对，退出码 0")
    return "\n".join(lines)
