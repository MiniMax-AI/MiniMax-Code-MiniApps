# -*- coding: utf-8 -*-
"""核验槽（check slot）：注册表＋[checks] 解析＋发现汇总＋退出码折算。

SPEC-CHECKS（docs/design/SPEC-CHECKS.md，2026-11-16 已批）§2.2：core 新增且仅新增
一个机构＝核验槽。槽只做四件事——①点名 ②收发现 ③折算退出码 ④出报告；
一切领域判据都在核验包里，core 不为任何具体领域保留判据代码。
paper（论文三闸，判据在 audit.py）是第一个注册进槽的核验包；legal（M2）是
第二个；style 与 pdf（文风闸＋PDF 回检层，M1.5 第二批，裁定⑤）是 core 自带的
第三、四个——只被 [checks].packages 显式点名时才跑，缺省（无节／裸节）不跑，
缺省行为逐字节不变。两包判据物理位置都不动，卡＋注册＋路径接槽，最小搬动。

宪法纪律（本模块是宪法面，改动＝修约）：

- **退出码值永不变**：折算只认 SPEC-V3.0 §2.5 唯一权威表的值↔语义配对
  （全闭集 0/1/2/3/4/5/6/7/8/9，见 constants.py）；包只报 findings，
  不产生退出码。
- **无 `[checks]` 节＝槽不启用**：audit 行为与槽引入前逐字节一致
  （§5.2 兼容承诺；实现模式照 `[budget]`/`[evidence]` 先例：节不出现＝
  判据不跑、行为与之前完全一致）。**`[checks]` 节在场即走槽**（裁定③，
  2026-11-16）：显式点名 `packages` 按点名；节存在但省 `packages` ⇒
  默认 `["paper"]` 走槽——与无节的差别只有「输出带 domain 键与
  by_domain」两处只增键，发现本体逐条相同。
- **确定性**：同一输入字节 ⇒ 同一 findings 字节；槽不读系统钟、不联网、
  不写盘（零 LLM，沿用 SPEC.md §5 硬性要求）。

包契约（§3.1 注册卡五样的代码面）：`domain_id`（全局唯一小写）、
冻结码表（在 docs/design/SPEC-V3.0.md §8 总表）、config 节名
`[checks.<domain_id>]`（键集由卡声明）、材料依赖声明（卡上写明，
材料缺失必须 fail-closed）、`verify() → findings`（纯函数）。
M1 的包结果协议 v1：`verify(cfg, facts, sections, resolve=False) →
(red, yellow, hints, summary, unresolved)`——与 `audit.run_audit` 的
返回形一致；M2 的 legal 挂槽时按同一协议收敛（判据与码表零改动）。

注册形态（裁定⑧「核验包入仓注册形态」）：core 自带域的卡在本模块
`register_builtins()`；外来域包走 `integrations/<pkg>/` 入仓注册——件内
放一枚 `check-package.toml`（domain＋adapter 两个字段），`[checks]` 点名
而槽内未注册时 `load_integration()` 按约定路径延迟载入适配器，适配器调
`register_package()` 挂卡（M2 起；先例：factscribe-legal）。core 不
import 任何集成件，载入方向＝扩展件 import 宿主。

冻结锁（裁定⑨「每域一把冻结锁」）：`evidence_lock_path()`——内建 paper
域沿用既有 `audit/evidence.lock`（既有冻结件字节不破坏，canonical 形态
一个字节不改）；其他域用 `audit/evidence-<domain>.lock`（§6 第 2 条）。
"""
from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .config import Config, ConfigError, _config_warn, load_toml
from .constants import EXIT_RED, EXIT_YELLOW, SEV_INFO
from .textio import to_lf
from .i18n import finding_key

# --------------------------------------------------------------------------
# 退出码全闭集（裁定②：全闭集入宪表述；值↔语义配对以 SPEC-V3.0 §2.5
# 为唯一权威表，永不变化）。constants.py 只列了本仓当前折算会用到的值；
# 这里把闭集整表列出供槽与核验包对照——新增退出码＝修约（major）。
# --------------------------------------------------------------------------

EXIT_CODE_CLOSED_SET = {
    0: "PASS／UNVERIFIED（不阻断）",
    1: "RED(FACT)：源层违例",
    2: "RED(CONFIG)：配置、用法、工具缺失",
    3: "ADVISORY：仅黄",
    4: "RED(INTERNAL)：异常、两份实现漂移",
    5: "RED(COVERAGE|INTEGRITY)：覆盖缺口、PDF/stamp 信任链失败",
    6: "RED(PROOF)：--require-proof 未达标",
    7: "RED(STALE|REPLAY)：报告/PDF 过期、nonce 重放",
    8: "UNVERIFIED（阻断）：--gate/--ci 下 level < L2、必需工具缺失",
    9: "RED(ATTACK_OPEN)：ATTACKS.md 有 blocking/open 条目",
}

# --------------------------------------------------------------------------
# 退出码折算（槽第 3 件事）。逻辑自 audit.py 原样迁入（audit 模块以旧名
# `_aggregate_exit` 再导出，调用方零改动）；折算规则一字不改，值永不变化。
# --------------------------------------------------------------------------


def aggregate_exit(red, yellow, strict: bool = False,
                   integrity_first: bool = False) -> int:
    """红黄发现 → 退出码。包不产生退出码，折算只在这里发生。"""
    if red:
        codes = {i.exit_code for i in red}
        if integrity_first and 5 in codes:
            return 5
        for code in (8, 1, 5, 7):
            if code in codes:
                return code
        return 1
    if yellow:
        return 1 if strict else 3
    return 0


# --------------------------------------------------------------------------
# 发现的域标（信封 §3.2 的 domain 键）：只在槽路径（显式 [checks] 点名）出现，
# 缺省路径不带域标——金样例逐字节锁的前提。
# --------------------------------------------------------------------------


class DomainIssue:
    """包一层既有 Issue、加域标的发现：as_dict 时前置 `domain` 键。

    只增键不改名不删键（§8.1 判定表：非 BREAKING）；旧消费者按
    「新增键忽略」口径不受影响。其余属性透传给被包的 Issue，
    折算（exit_code）与人读渲染（code/location/…）零感知。
    """

    def __init__(self, domain: str, issue):
        self.domain = domain
        self.issue = issue

    @property
    def exit_code(self) -> int:
        return self.issue.exit_code

    def as_dict(self) -> dict:
        d = {"domain": self.domain}
        d.update(self.issue.as_dict())
        return d

    def __getattr__(self, name):
        # 常规属性找不到才走这里；issue 自身缺失时别递归。
        if name == "issue":
            raise AttributeError(name)
        return getattr(self.__dict__["issue"], name)


# --------------------------------------------------------------------------
# 核验包注册卡与注册表（槽第 1 件事：点名的前提）
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class CheckPackage:
    """核验包注册卡（SPEC-CHECKS §3.1 一张卡写死五样的代码面）。

    verify 的包结果协议 v1：
        verify(cfg, facts, sections, resolve=False)
            -> (red, yellow, hints, summary, unresolved)
    summary 是该包的信封 summary（dict）；单包时槽原样采用并追加
    `by_domain`。多包合并语义（M2 卡上契约）：非首包的 summary 挂在
    自己的 domain_id 键下（只增键），首包（惯例＝内建 paper）的 summary
    仍是信封基座——见 run_packages。
    """

    domain_id: str
    verify: Callable
    config_keys: frozenset = frozenset()   # [checks.<domain>] 认识的键集
    description: str = ""

    def __post_init__(self):
        bad = [ch for ch in self.domain_id if ch not in
               "abcdefghijklmnopqrstuvwxyz0123456789-"]
        if not self.domain_id or bad:
            raise ConfigError(
                "核验包 domain_id %r 不合法：必须是 [a-z0-9-] 的小写 id"
                "（全局唯一，即配置节名 [checks.<domain_id>] 与码表命名空间）"
                % self.domain_id)


# 注册表：domain_id → 卡。槽要求全局唯一；重复注册＝修约级错误。
_REGISTRY: dict[str, CheckPackage] = {}
_BUILTINS_DONE = False

# 缺省包（裁定③：[checks] 缺省只跑 paper）。
DEFAULT_DOMAIN = "paper"


def register_package(pkg: CheckPackage) -> None:
    """把一张核验包卡挂进槽。domain_id 全局唯一，重复注册即报错。"""
    if pkg.domain_id in _REGISTRY:
        raise ConfigError(
            "核验包 %r 重复注册——槽要求 domain_id 全局唯一" % pkg.domain_id)
    _REGISTRY[pkg.domain_id] = pkg


def get_package(domain_id: str) -> CheckPackage | None:
    return _REGISTRY.get(domain_id)


def registered_domains() -> list[str]:
    return sorted(_REGISTRY)


def register_builtins() -> None:
    """注册 core 自带核验包（paper、style、pdf）。幂等；惰性导入避免环。

    - paper（M1）：卡在这里，verify 指向 run_audit——G1 数字绑定／G2 源头
      锚定／G3 引用对账（SPEC-V1 §4）连同 run_audit 内的源层判据，从本卡起
      是 paper 包的实现细节。判据代码物理位置仍在 audit.py（最小搬动）。
    - style（M1.5 第二批，裁定⑤）：文风闸——公式化写作特征黄牌（exit 3）＋
      证据钢印红（exit 1）；判据物理位置仍在 style.py 不动（4092 行不搬家），
      卡＋verify 接槽。码为存量无前缀码，按 SPEC-CHECKS §4.3「core 存量码
      一字不改」祖父条款照旧发射，不补前缀不改名。
    - pdf（M1.5 第二批，裁定⑤）：PDF 回检层——文本层／栅格化／双向数字
      多重集／stamp 信任链；判据物理位置仍在 pdfgate.py 不动，verify 指向
      verify_pdf。材料依赖＝main.pdf（cfg.output）与编译产物
      （audit/report.json、audit/stamp.json）——材料缺失按 pdfgate 现行
      语义 fail-closed（PDF_TOOL_MISSING=8／REPORT_SCHEMA_INVALID），不许
      静默绿。码 PDF_*/STAMP_* 系同为存量码，照旧发射。

    新包缺省都不改变行为：只有 [checks].packages 显式点名 style／pdf 才跑
    （裁定③不变——无节直跑、裸节默认只跑 paper）。
    legal 等外来域走 integrations/ 约定路径发现（load_integration）。
    """
    global _BUILTINS_DONE
    if _BUILTINS_DONE:
        return
    register_package(CheckPackage(
        domain_id=DEFAULT_DOMAIN,
        verify=_paper_verify,
        config_keys=frozenset(),   # 本批 paper 节没有键；写了即告警
        description="论文三闸：G1 数字绑定／G2 源头锚定／G3 引用对账"
                    "（SPEC-V1 §4；判据在 audit.run_audit）",
    ))
    register_package(CheckPackage(
        domain_id=STYLE_DOMAIN,
        verify=_style_verify,
        config_keys=STYLE_CONFIG_KEYS,
        description="文风闸：公式化写作特征黄牌＋证据钢印红"
                    "（M1.5 第二批，裁定⑤；判据在 style.analyze）",
    ))
    register_package(CheckPackage(
        domain_id=PDF_DOMAIN,
        verify=_pdf_verify,
        config_keys=PDF_CONFIG_KEYS,
        description="PDF 回检：文本层/栅格化/双向数字多重集/stamp 信任链"
                    "（M1.5 第二批，裁定⑤；判据在 pdfgate.verify_pdf，"
                    "材料缺失 fail-closed 不静默绿）",
    ))
    _BUILTINS_DONE = True


def _paper_verify(cfg: Config, facts, sections, resolve: bool = False):
    from .audit import run_audit
    return run_audit(cfg, facts, sections, resolve=resolve)


# --------------------------------------------------------------------------
# style 包（M1.5 第二批，裁定⑤）：文风闸接槽
#
# 判据零改动：verify 只做「读 [checks.style] 子表 → analyze() → Finding 映
# Issue」。Finding→Issue 映射（字段一一对应，码与严重度零改动）：
#   findings（severity red＝证据钢印 REQUIRED_EVIDENCE_MISSING/EVIDENCE_DROPPED，
#   其余 yellow）→ red/yellow 两串；info（TERM_UNREGISTERED、revision 档的
#   NUMERAL_DENSITY）与 advisories（RHYTHM_PLATEAU 参考读数）→ hints。
# 折算边界：style 红只有证据钢印（exit 1），与 style 命令的退出码语义一致；
# 黄在槽内照全局口径折 3（--strict 折 1）。
# --------------------------------------------------------------------------

STYLE_DOMAIN = "style"
STYLE_CONFIG_KEYS = frozenset(
    {"rules", "stage", "report_unregistered", "report_abbrev"})


def _style_verify(cfg: Config, facts, sections, resolve: bool = False):
    from .audit import Issue
    from .style import (STAGE_DRAFT, STAGE_VALUES, analyze,
                        load_style_rules_info)
    del facts, resolve          # 文风判据只读正文与规则，不看账、不联网
    table = dict((cfg.checks_tables or {}).get(STYLE_DOMAIN) or {})

    # 键值校验（卡上契约：键值非法＝配置错 exit 2，fail-closed 不静默改判）
    rules_path = table.get("rules")
    if rules_path is not None and (
            not isinstance(rules_path, str) or not rules_path.strip()):
        raise ConfigError(
            "[checks.style] 的 rules 必须是非空路径字符串，现在是 %r"
            % (rules_path,))
    stage = table.get("stage") or STAGE_DRAFT
    if not isinstance(stage, str) or stage not in STAGE_VALUES:
        raise ConfigError(
            "[checks.style] 的 stage 只能是 \"draft\" 或 \"revision\"，现在是 %r"
            % (stage,))
    flags = {}
    for key in ("report_unregistered", "report_abbrev"):
        value = table.get(key, False)
        if not isinstance(value, bool):
            raise ConfigError(
                "[checks.style] 的 %s 必须是布尔值，现在是 %r" % (key, value))
        flags[key] = value

    rules_info = load_style_rules_info(cfg.root, rules_path)
    result = analyze(cfg, sections, rules_info.rules,
                     rules_path=rules_info.path, stage=stage,
                     report_unregistered=flags["report_unregistered"],
                     report_abbrev=flags["report_abbrev"],
                     rule_report=rules_info.report)

    red, yellow, hints = [], [], []
    for f in result.findings:
        sev = getattr(f, "severity", "yellow")
        (red if sev == "red" else yellow).append(Issue(
            code=f.code, message=f.suggestion,
            location="%s:%d" % (f.file, f.line), token=f.metric or "",
            context=f.text, severity=sev,
            exit_code=EXIT_RED if sev == "red" else EXIT_YELLOW,
            message_key=getattr(f, "message_key", "") or finding_key(f.code),
            params=dict(getattr(f, "params", {}) or {})))
    for f in list(result.info) + list(result.advisories):
        hints.append(Issue(
            code=f.code, message=f.suggestion,
            location="%s:%d" % (f.file, f.line), token=f.metric or "",
            context=f.text, severity=SEV_INFO, exit_code=0,
            message_key=getattr(f, "message_key", "") or finding_key(f.code),
            params=dict(getattr(f, "params", {}) or {})))

    summary = dict(result.summary)
    summary["domain"] = STYLE_DOMAIN
    summary["rules"] = result.rules_path
    summary["lines"] = [
        "rules   : %s" % (result.rules_path or "内置默认"),
        "stage   : %s（%s）　触发 %d 项　黄 %d　红 %d" % (
            result.summary.get("stage", ""),
            result.summary.get("advice", ""),
            result.summary.get("triggered", 0),
            result.summary.get("findings", 0) - result.summary.get("red", 0),
            result.summary.get("red", 0)),
    ]
    return red, yellow, hints, summary, []


# --------------------------------------------------------------------------
# pdf 包（M1.5 第二批，裁定⑤）：PDF 回检层接槽
#
# 判据零改动：verify 指向 pdfgate.verify_pdf（P-08 信任链先于页面判定的
# 写死顺序原样保留）。材料依赖（卡上声明）与缺省路径：
#   main.pdf        ← cfg.output（[project]/output，默认 main.pdf）
#   audit/report.json ← 编译产物（被签的那一份审计报告）
#   audit/stamp.json  ← 有则必须先验信任链（verify_pdf 自跳不存在的 stamp）
#   keys            ← [checks.pdf] keys＝项目外公钥登记（appover 登记不在
#                     项目内是信任根的语义要求；缺省不配，有 stamp 没 keys
#                     ＝ STAMP_KEY_UNTRUSTED 红，fail-closed）
# 材料缺失按 pdfgate 现行语义走（不许静默绿）：PDF 缺／读不了＝
# PDF_TOOL_MISSING（exit 8）；report 缺／坏＝REPORT_SCHEMA_INVALID（exit 2）。
# 折算边界：槽折算只认 aggregate_exit 单一入口——8/5/7 三值语义不变
# （STAMP_PDF_MISMATCH=7、PDF_STALE=5、PDF_TOOL_MISSING=8）；exit 2 类红
# （REPORT_SCHEMA_INVALID）在槽内按全局红折 1，与 verify-pdf 独立命令的 2
# 不同——这是槽折算的既有口径（M1 起），不是本批新规则。
# --------------------------------------------------------------------------

PDF_DOMAIN = "pdf"
PDF_CONFIG_KEYS = frozenset({"pdf", "report", "stamp", "keys"})
_PDF_DEFAULTS = (("pdf", ""), ("report", "audit/report.json"),
                 ("stamp", "audit/stamp.json"), ("keys", ""))


def _pdf_verify(cfg: Config, facts, sections, resolve: bool = False):
    from .pdfgate import verify_pdf
    del facts, sections, resolve   # PDF 回检只认盘上字节与报告，不看账
    table = dict((cfg.checks_tables or {}).get(PDF_DOMAIN) or {})
    for key, _default in _PDF_DEFAULTS:
        value = table.get(key)
        if value is not None and (
                not isinstance(value, str) or not value.strip()):
            raise ConfigError(
                "[checks.pdf] 的 %s 必须是非空路径字符串，现在是 %r"
                % (key, value))
    rel = {key: str(table.get(key) if table.get(key) is not None
                    else default).strip()
           for key, default in _PDF_DEFAULTS}
    if not rel["pdf"]:
        rel["pdf"] = cfg.output        # [project]/output，默认 main.pdf

    root = cfg.root
    pdf_path = root / rel["pdf"]
    report_path = root / rel["report"]
    stamp_path = root / rel["stamp"] if rel["stamp"] else None
    keys_path = root / rel["keys"] if rel["keys"] else None
    issues, warnings, gate_exit = verify_pdf(
        pdf_path, report_path, stamp_path, keys_path)
    # verify_pdf 的契约：issues＝红（阻断），warnings＝黄（advisory）——
    # 码与严重度零改动，槽只按信封收拢。
    red, yellow = list(issues), list(warnings)
    summary = {
        "domain": PDF_DOMAIN,
        "checked": True,
        "pdf": rel["pdf"],
        "report": rel["report"],
        "stamp": "有" if stamp_path is not None and stamp_path.is_file() else "无",
        "keys": rel["keys"] or "（未配）",
        "red": len(red),
        "yellow": len(yellow),
        "gate_exit": gate_exit,
        "lines": [
            "pdf     : %s    report: %s" % (rel["pdf"], rel["report"]),
            "stamp   : %s    keys: %s" % (
                "有（先验信任链）" if stamp_path is not None
                and stamp_path.is_file() else "无",
                rel["keys"] or "（未配）"),
        ],
    }
    return red, yellow, [], summary, []




# --------------------------------------------------------------------------
# 外来域包的约定路径发现（裁定⑧「核验包入仓注册形态」的代码面，M2 起）：
# integrations/<dir>/check-package.toml 声明 domain＋adapter；[checks] 点名
# 未注册 id 时按本机制延迟载入适配器。core 不 import integrations——载入
# 方向＝扩展件 import 宿主的 factscribe.checks 并调 register_package()；
# integrations/ 整目录删掉＝对应 id 回到「未注册」（点名即 exit 2），
# 「integrations 独立、可卸载」先例不破。
# --------------------------------------------------------------------------

_INTEGRATIONS_TRIED: set[str] = set()


def _integration_marker(domain_id: str):
    """在 <仓根>/integrations/*/check-package.toml 里找 domain==domain_id 的声明。"""
    base = Path(__file__).resolve().parent.parent / "integrations"
    if not base.is_dir():
        return None
    for d in sorted(base.iterdir()):
        marker = d / "check-package.toml"
        if not marker.is_file():
            continue
        try:
            meta = load_toml(marker)
        except Exception:
            continue   # 坏声明不当致命：这个件本批不可发现，点名即未注册
        if str(meta.get("domain") or "").strip() == domain_id:
            return d, str(meta.get("adapter") or "").strip()
    return None


def load_integration(domain_id: str) -> None:
    """按约定路径载入外来核验包（幂等；只对点名而未注册的 id 调用）。

    载入＝把集成件目录挂上 sys.path 后 import 声明的适配器模块，适配器
    自己调 register_package 挂卡。声明存在但载入失败＝配置错（exit 2）；
    没有声明＝静默返回，调用方按「未注册」处理。
    """
    if domain_id in _INTEGRATIONS_TRIED:
        return
    _INTEGRATIONS_TRIED.add(domain_id)
    hit = _integration_marker(domain_id)
    if hit is None:
        return
    d, module = hit
    if not module:
        raise ConfigError(
            "integrations/%s/check-package.toml 缺 adapter 字段——"
            "无法载入核验包 %r" % (d.name, domain_id))
    import importlib
    sys.path.insert(0, str(d))
    try:
        importlib.import_module(module)
    except ImportError as exc:
        raise ConfigError(
            "核验包 %r 的适配器 %s 载入失败（%s）——集成件不完整或依赖缺失"
            % (domain_id, module, exc)) from exc


# --------------------------------------------------------------------------
# 点名（槽第 1 件事）＋域节键集校验
# --------------------------------------------------------------------------


def resolve_packages(cfg: Config) -> list[CheckPackage]:
    """按 `[checks]` 配置点名本次要跑的核验包（只在槽路径被调用）。

    - 节存在但省 `packages`（或缺省构造的 Config）⇒ 默认 `["paper"]`
      （裁定③，2026-11-16：裸节走槽，cmd_audit 以 checks_defined 判挂槽）；
    - `packages` 点了未注册的 id ⇒ 先按约定路径发现 integrations/ 件
      （M2 起，见 load_integration）；仍无 ⇒ exit 2（CONFIG），点名该 id
      与已注册域清单（§5.2）；
    - `[checks.<domain>]` 键集错误 ⇒ CONFIG_UNKNOWN_FIELD 告警（info），
      不改退出码；未注册域的节同样告警并忽略（§5.2）。
    """
    register_builtins()
    wanted = list(cfg.checks_packages) if cfg.checks_packages \
        else [DEFAULT_DOMAIN]
    packages: list[CheckPackage] = []
    for pid in wanted:
        pkg = _REGISTRY.get(pid)
        if pkg is None:
            load_integration(pid)   # 约定路径延迟载入（幂等；失败即配置错）
            pkg = _REGISTRY.get(pid)
        if pkg is None:
            raise ConfigError(
                "[checks].packages 点名的核验包 %r 未注册（已注册：%s）——"
                "先注册进槽才能点名（SPEC-CHECKS §5.2）"
                % (pid, "、".join(registered_domains()) or "无"))
        packages.append(pkg)
    for domain, table in sorted((cfg.checks_tables or {}).items()):
        pkg = _REGISTRY.get(domain)
        if pkg is None:
            _config_warn(
                cfg, "CONFIG_UNKNOWN_FIELD",
                "[checks.%s] 的域未注册——该节已忽略（已注册：%s）"
                % (domain, "、".join(registered_domains())),
                field=domain, location="factscribe.toml [checks.%s]" % domain)
            continue
        for key in sorted(table):
            if key in pkg.config_keys:
                continue
            _config_warn(
                cfg, "CONFIG_UNKNOWN_FIELD",
                "[checks.%s] 的键 %r 不在 %s 包的契约里——已忽略"
                "（也不参与任何判据）" % (domain, key, domain),
                field=str(key), location="factscribe.toml [checks.%s]" % domain)
    return packages


# --------------------------------------------------------------------------
# 收发现＋出报告（槽第 2/4 件事）：跑点名包、加域标、按域计数、收拢信封
# --------------------------------------------------------------------------


def run_packages(cfg: Config, facts, sections, resolve: bool = False):
    """跑 `[checks]` 点名的全部核验包，返回信封五元组。

    返回形与 `audit.run_audit` 一致：(red, yellow, hints, summary,
    unresolved)，调用方（cli.cmd_audit）零学习成本。差异只有两处、都
    只发生在槽路径：每条发现多 `domain` 键（DomainIssue.as_dict），
    summary 末尾多 `by_domain` 计数（§3.2 只增键）。
    """
    # 分析入口归一行尾：读盘侧按原样读（CRLF 不丢），分析层按行做事；
    # 归一的是内存副本，磁盘字节不动。
    sections = [(rel, to_lf(text)) for rel, text in sections]
    packages = resolve_packages(cfg)
    red, yellow, hints = [], [], []
    unresolved: list = []
    by_domain: dict[str, dict] = {}
    summary: dict | None = None
    for pkg in packages:
        p_red, p_yellow, p_hints, p_summary, p_unresolved = pkg.verify(
            cfg, facts, sections, resolve=resolve)
        red += [DomainIssue(pkg.domain_id, i) for i in p_red]
        yellow += [DomainIssue(pkg.domain_id, i) for i in p_yellow]
        hints += [DomainIssue(pkg.domain_id, i) for i in p_hints]
        unresolved += list(p_unresolved)
        by_domain[pkg.domain_id] = {"red": len(p_red), "yellow": len(p_yellow),
                                    "hints": len(p_hints)}
        if summary is None:
            summary = dict(p_summary)
        elif p_summary is not None:
            # 多包合并（M2 卡上契约，§3.2 只增键）：非首包的 summary 挂在
            # 自己的 domain_id 键下，键不与信封基座冲突由各包自己保证
            #（域内键归域）。首包（惯例＝内建 paper）的 summary 仍是基座。
            summary[pkg.domain_id] = dict(p_summary)
    if summary is not None:
        summary["by_domain"] = by_domain
    return red, yellow, hints, summary or {}, unresolved


# --------------------------------------------------------------------------
# 每域一把冻结锁（裁定⑨）：锁件路径的唯一权威函数
# --------------------------------------------------------------------------


def evidence_lock_path(root: Path, domain: str = "") -> Path:
    """域级冻结锁件路径：paper 沿用既有锁，其他域各用各的锁。

    - paper（或空串＝内建缺省域）⇒ `audit/evidence.lock`——既有冻结件的
      canonical 形态与路径一个字节都不改（§6 第 2 条；既有锁就是 paper
      域的锁）；
    - 其他域 ⇒ `audit/evidence-<domain>.lock`（M2 legal 起用；canonical
      形态由该域的卡写死）。
    """
    if domain == DEFAULT_DOMAIN or not domain:
        return root / "audit" / "evidence.lock"
    return root / "audit" / ("evidence-%s.lock" % domain)
