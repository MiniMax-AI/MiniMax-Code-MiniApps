# -*- coding: utf-8 -*-
"""账与证据面的提议单（宿主能提，人点才写）。

正文改稿走 write.py 的提议单；这里管另外几件非正文的写动作：

* 证据冻结 / 解冻（evidence.freeze_evidence / unfreeze_evidence）；
* 追加一条事实（scaffold.add_fact）；
* 导出投稿包（actions.export_bundle）。

形状纪律与正文提议单完全一致：

* 提议单只落状态目录，不碰正文、不碰账、不碰冻结件；
* 每张单都带 before_sha 指纹闸——提议之后状态被别处改过，采纳时拒写
  （BLOCK_STALE），不覆盖别人的改动；
* 差异卡展示的 after_text 就是真正会落盘的那一份。

铁律：不得凭空造事实——add_fact 走的是 CLI fact add 同一条路，
它自己查 id 重复、查来源文件、查 value 形态。
"""
from __future__ import annotations

from pathlib import Path

from .. import i18n
from ..config import ConfigError, load_config
from ..evidence import (canonical_sha256, entry_count, freeze_evidence,
                         read_lock, unfreeze_evidence)
from ..facts import sha256_file
from ..scaffold import (add_fact, check_value_in_source, prepare_fact,
                         resolve_ledger, resolve_source)

KIND_EVIDENCE_FREEZE = "evidence_freeze"
KIND_EVIDENCE_UNFREEZE = "evidence_unfreeze"
KIND_ADD_FACT = "add_fact"
KIND_EXPORT_BUNDLE = "export_bundle"

#: 提议单类型 → 人类可读的标题（页面差异卡上的标签）。
KIND_LABELS = {
    KIND_EVIDENCE_FREEZE: "冻结证据清单",
    KIND_EVIDENCE_UNFREEZE: "解冻证据清单",
    KIND_ADD_FACT: "追加事实",
    KIND_EXPORT_BUNDLE: "导出投稿包",
}


#: 工作台自己的文案目录（机器视图的命令清单、提议单正文与告警）。
_MESSAGES = i18n.WORKBENCH_MESSAGES


def _zh(parts) -> str:
    """展示层文案 → 中文原话（落盘/契约层的那一份，逐字不变）。"""
    return i18n.render_parts(parts, "zh", _MESSAGES)


def _declared_parts(declared: dict) -> list:
    """[evidence] 声明的清单 → 展示层文案（一节一条）。"""
    if not declared:
        return [i18n.part("wb.prop.freeze.summaryEmpty")]
    parts = []
    for key in sorted(declared):
        ids = ", ".join(str(i) for i in (declared.get(key) or []))
        if ids:
            parts.append(i18n.part("wb.prop.freeze.section",
                                   {"section": key, "ids": ids}))
        else:
            parts.append(i18n.part("wb.prop.freeze.sectionNone",
                                   {"section": key}))
    return parts


def _lock_parts(lock) -> list:
    """冻结件现状 → 展示层文案。"""
    if not lock:
        return [i18n.part("wb.prop.lock.none")]
    return [i18n.part("wb.prop.lock.some", {
        "path": str(lock.get("path") or "audit/evidence.lock"),
        "sha": str(lock.get("sha256") or "")[:12],
        "entries": int(lock.get("entries") or 0)})]


def _declared_of(disk_root: Path) -> dict:
    cfg = load_config(Path(disk_root))
    return dict(getattr(cfg, "evidence_sections", {}) or {})


def display_catalog(records) -> dict:
    """这些提议单用到的展示层文案目录子集（前端按界面语言翻，不抄第二份）。

    目录随载荷走：页面拿到的是 key ＋ params ＋ 模板，缺哪条就回落到
    提议单里那份中文原话（宁可显示原话，也不要半中半英）。
    """
    keys = set()
    for record in records or []:
        display = dict((record or {}).get("display") or {})
        for field in ("before", "after"):
            keys |= i18n.parts_keys(display.get(field))
        for item in display.get("warnings") or []:
            keys |= i18n.parts_keys([item])
    return i18n.catalog_for(keys, catalog=i18n.WORKBENCH_MESSAGES)


# ---------------------------------------------------------------- 冻结


def propose_evidence_freeze(disk_root: Path, reason: str = "",
                             source: str = "", rationale: str = "") -> dict:
    """算一份「冻结证据清单」的提议（不写盘）。

    指纹闸用清单本身的 canonical_sha256：提议之后清单被改过，
    采纳时拒写（BLOCK_STALE）——冻结的必须是提议时那份清单。
    """
    declared = _declared_of(disk_root)
    digest = canonical_sha256(declared)
    entries = entry_count(declared)
    lock = read_lock(Path(disk_root))
    warnings = []
    warning_parts = []
    if not declared:
        warning_parts.append(i18n.part("wb.prop.freeze.warnEmpty"))
        warnings.append(_zh(warning_parts[-1:]))
    if lock and str(lock.get("sha256") or "") == digest:
        warning_parts.append(i18n.part("wb.prop.freeze.warnIdempotent"))
        warnings.append(_zh(warning_parts[-1:]))
    before_parts = [i18n.part("wb.prop.freeze.before.head",
                              {"sections": len(declared), "entries": entries})]
    before_parts += _declared_parts(declared)
    before_parts += _lock_parts(lock)
    after_parts = [
        i18n.part("wb.prop.freeze.after.path",
                  {"path": str((lock or {}).get("path")
                               or "audit/evidence.lock")}),
        i18n.part("wb.prop.counts",
                  {"sections": len(declared), "entries": entries}),
    ]
    after_parts += _declared_parts(declared)
    after_parts.append(i18n.part("wb.prop.digest", {"digest": digest}))
    if str(reason or "").strip():
        after_parts.append(i18n.part("wb.prop.freeze.reason",
                                     {"reason": str(reason).strip()}))
    return {"kind": KIND_EVIDENCE_FREEZE,
            "file": "", "block": "",
            "before_sha": digest,
            "before_text": _zh(before_parts),
            "proposed_text": str(reason or ""),
            "after_text": _zh(after_parts),
            "warnings": warnings,
            "display": {"before": before_parts, "after": after_parts,
                        "warnings": warning_parts},
            "source": source,
            "rationale": rationale,
            "reason": str(reason or "").strip(),
            "entries": entries,
            "declared": {key: list(value)
                         for key, value in sorted(declared.items())}}


# ---------------------------------------------------------------- 解冻


def propose_evidence_unfreeze(disk_root: Path, reason: str = "", at: str = "",
                               source: str = "", rationale: str = "") -> dict:
    """算一份「解冻证据清单」的提议（不写盘）。

    解冻必须带非空理由——理由会写进 audit/evidence-log.ndjson，
    那是给未来的人看的「为什么当时改了清单」。
    """
    text = str(reason or "").strip()
    if not text:
        raise ConfigError("解冻必须带非空理由（为什么改）——理由会写进 "
                          "audit/evidence-log.ndjson",
                          code="EVIDENCE_REASON_REQUIRED")
    lock = read_lock(Path(disk_root))
    if lock is None:
        raise ConfigError("尚未冻结（没有 audit/evidence.lock）：无冻可解。",
                          code="EVIDENCE_NOT_FROZEN")
    declared = _declared_of(disk_root)
    before_parts = _lock_parts(lock)
    before_parts.append(i18n.part("wb.prop.unfreeze.before.counts",
                                   {"sections": len(declared),
                                    "entries": entry_count(declared)}))
    before_parts += _declared_parts(declared)
    before_parts.append(i18n.part("wb.prop.unfreeze.before.state"))
    after_parts = [
        i18n.part("wb.prop.unfreeze.after.keep",
                  {"sha": str(lock.get("sha256") or "")[:12]}),
        i18n.part("wb.prop.unfreeze.after.log"),
        i18n.part("wb.prop.unfreeze.after.reason", {"reason": text}),
    ]
    if str(at or "").strip():
        after_parts.append(i18n.part("wb.prop.unfreeze.after.date",
                                     {"date": str(at).strip()}))
    return {"kind": KIND_EVIDENCE_UNFREEZE,
            "file": "", "block": "",
            "before_sha": str(lock.get("sha256") or ""),
            "before_text": _zh(before_parts),
            "proposed_text": text,
            "after_text": _zh(after_parts),
            "warnings": [],
            "display": {"before": before_parts, "after": after_parts,
                        "warnings": []},
            "source": source,
            "rationale": rationale,
            "reason": text,
            "at": str(at or "").strip()}


# ---------------------------------------------------------------- 追加事实


def propose_add_fact(disk_root: Path, body: dict, source: str = "",
                      rationale: str = "") -> dict:
    """算一份「追加一条事实」的提议（不写盘）。

    校验走 scaffold.prepare_fact——与 CLI fact add 同一套，
    算出来的 block 就是真正会追加进账本的那几行 TOML。

    本批加两道闸（**只加不改**，既有字段与文案一字未动）：

    1. **value 硬校验**：填的 value 必须能在所选 source 产物原文里命中
       （口径见 scaffold.check_value_in_source／valuecheck.py）；命中不了
       → 拒建单，消息里说清哪些数字没找到、产物是哪一件、人写的定位是啥。
    2. **before_sha 指纹闸**：以**目标账本文件**的 sha256 为闸——提议之后
       账本被别处改过，采纳时拒写（BLOCK_STALE），不覆盖别人的追加。
       账本本来不存在时记「本来没有」，采纳时若被别处建出来，同样拒写。

    ``ledger``＝目标账本文件（相对项目根）：留空沿用默认，指定则必须是
    facts 的 glob 里的文件（详见 scaffold.resolve_ledger）。
    """
    body = body or {}
    root = Path(disk_root)
    prepared = prepare_fact(root,
                            fid=str(body.get("id") or ""),
                            claim=str(body.get("claim") or ""),
                            value=str(body.get("value") or ""),
                            source=str(body.get("source") or ""),
                            locator=str(body.get("locator") or ""),
                            confidence=str(body.get("confidence") or "med"),
                            expr=str(body.get("expr") or ""),
                            derived_from=(body.get("derived_from")
                                          or body.get("derivedFrom")),
                            note=str(body.get("note") or ""),
                            ledger=str(body.get("ledger") or ""))
    # 闸 1：value 必须真的在那件产物里（不许编）。口径见 valuecheck.py。
    check_value_in_source(root, load_config(root),
                          str(prepared.get("source") or ""),
                          Path(str(prepared.get("source_path") or "")),
                          str(prepared.get("value") or ""),
                          locator=str(prepared.get("locator") or ""))
    ledger = str(prepared.get("ledger") or "")
    fact_id = str(prepared.get("id") or "")
    if ledger:
        before_parts = [i18n.part("wb.prop.addFact.before.ledger",
                                  {"ledger": ledger, "id": fact_id})]
        after_parts = [i18n.part("wb.prop.addFact.after.head",
                                 {"ledger": ledger})]
    else:
        before_parts = [i18n.part("wb.prop.addFact.before.ledgerUnknown",
                                  {"id": fact_id})]
        after_parts = [i18n.part("wb.prop.addFact.after.headUnknown")]
    if ledger and not (Path(disk_root) / ledger).is_file():
        before_parts.append(i18n.part("wb.prop.addFact.before.newLedger"))
    before_parts.append(i18n.part("wb.prop.addFact.before.note"))
    # 账本片段是**契约内容**（落盘的就是它），逐字保留、不翻译。
    after_parts.append(i18n.literal(str(prepared.get("block") or "")))
    fact = {key: prepared.get(key) for key in
            ("id", "claim", "value", "source", "source_sha256", "locator",
             "confidence", "derived_from", "expr", "note", "ledger",
             "ledger_explicit", "manifest", "manifest_line")}
    # 闸 2：指纹闸——目标账本文件的 sha256（账本还不存在时记「本来没有」）。
    before_sha = ""
    before_absent = False
    if ledger:
        ledger_path = root / ledger
        if ledger_path.is_file():
            before_sha = sha256_file(ledger_path)
        else:
            before_absent = True
    return {"kind": KIND_ADD_FACT,
            "file": "", "block": "",
            "before_sha": before_sha,
            "before_absent": before_absent,
            "before_text": _zh(before_parts),
            "proposed_text": str(prepared.get("block") or ""),
            "after_text": _zh(after_parts),
            "warnings": [],
            "display": {"before": before_parts, "after": after_parts,
                        "warnings": []},
            "source": source,
            "rationale": rationale,
            "fact": fact}


# ---------------------------------------------------------------- 投稿包


def propose_export_bundle(disk_root: Path, source: str = "",
                           rationale: str = "") -> dict:
    """算一份「导出投稿包」的提议（不写盘）。

    投稿包是真收集：把正文、账、文献、PDF 收进一个目录，
    再逐条过清单门。清单门不过＝不出包。
    """
    before_parts = [i18n.part("wb.prop.bundle.before")]
    after_parts = [i18n.part("wb.prop.bundle.after.head"),
                   i18n.part("wb.prop.bundle.after.gate")]
    return {"kind": KIND_EXPORT_BUNDLE,
            "file": "", "block": "",
            "before_sha": "",
            "before_text": _zh(before_parts),
            "proposed_text": "",
            "after_text": _zh(after_parts),
            "warnings": [],
            "display": {"before": before_parts, "after": after_parts,
                        "warnings": []},
            "source": source,
            "rationale": rationale}


# ---------------------------------------------------------------- 落盘


def _guard(expect: str, current: str, what: str) -> None:
    """指纹闸：提议之后状态被别处改过 → 拒写（BLOCK_STALE）。"""
    expect = str(expect or "")
    current = str(current or "")
    if not expect:
        return
    if expect != current:
        raise ConfigError("%s在提议之后被改过（当前 %s…，提议时 %s…）——"
                          "请重新提一张单。"
                          % (what, current[:12], expect[:12]),
                          code="BLOCK_STALE")


def apply_evidence_freeze(disk_root: Path, proposal: dict) -> dict:
    """采纳「冻结证据清单」：真写冻结件 ＋ 流水账。"""
    root = Path(disk_root)
    declared = _declared_of(root)
    _guard(str(proposal.get("before_sha") or ""),
            canonical_sha256(declared), "证据清单")
    info = freeze_evidence(root, declared,
                            str(proposal.get("reason") or ""))
    return {"ok": True, "kind": KIND_EVIDENCE_FREEZE,
            "path": str(info.get("path") or ""),
            "sha256": str(info.get("sha256") or ""),
            "entries": int(info.get("entries") or 0),
            "idempotent": bool(info.get("idempotent")),
            "warnings": []}


def apply_evidence_unfreeze(disk_root: Path, proposal: dict) -> dict:
    """采纳「解冻证据清单」：真写一条 unfreeze 记录。"""
    root = Path(disk_root)
    lock = read_lock(root)
    _guard(str(proposal.get("before_sha") or ""),
            str((lock or {}).get("sha256") or ""), "冻结件")
    info = unfreeze_evidence(root, str(proposal.get("reason") or ""),
                              str(proposal.get("at") or ""))
    return {"ok": True, "kind": KIND_EVIDENCE_UNFREEZE,
            "path": str(info.get("path") or ""),
            "action": str(info.get("action") or ""),
            "reason": str(info.get("reason") or ""),
            "at": str(info.get("at") or ""),
            "idempotent": bool(info.get("idempotent")),
            "warnings": []}


def apply_add_fact(disk_root: Path, proposal: dict) -> dict:
    """采纳「追加事实」：真写账本（走 CLI fact add 同一条路）。

    两道闸在采纳时**再走一遍**（与其它提议单同一条纪律：状态被别处改过就
    拒写，不覆盖别人的改动）：

    * **账本指纹闸**：提议之后账本被别处追加过 → BLOCK_STALE 拒写；
      提议时账本本来不存在、这时被别处建出来 → 同样拒写。
    * **value 硬校验**：产物在提议之后被改过、数字对不上了 → 不落账
      （消息说清哪些数字没找到）。
    """
    fact = dict(proposal.get("fact") or {})
    if not fact:
        raise ConfigError("这张提议单里没有事实内容——没法落账。",
                          code="PROPOSAL_FACT_MISSING")
    root = Path(disk_root)
    cfg = load_config(root)
    ledger_rel = (str(fact.get("ledger") or "")
                  if fact.get("ledger_explicit") else "")
    ledger_path, _ = resolve_ledger(root, cfg, ledger_rel)
    if str(proposal.get("before_absent") or ""):
        # 提议时账本本来不存在：现在若被别处建出来了，也是「状态变了」。
        if ledger_path.is_file():
            raise ConfigError(
                "账本文件 %s 在提议之后被建出来了——请重新提一张单。"
                % ledger_path.relative_to(root).as_posix(),
                code="BLOCK_STALE")
    else:
        current = sha256_file(ledger_path) if ledger_path.is_file() else ""
        _guard(str(proposal.get("before_sha") or ""), current, "账本文件")
    # value 硬校验（采纳时再核一次：产物可能已经变了）。
    rel, full = resolve_source(root, cfg, str(fact.get("source") or ""))
    check_value_in_source(root, cfg, rel, full,
                          str(fact.get("value") or ""),
                          locator=str(fact.get("locator") or ""))
    info = add_fact(root,
                    fid=str(fact.get("id") or ""),
                    claim=str(fact.get("claim") or ""),
                    value=str(fact.get("value") or ""),
                    source=str(fact.get("source") or ""),
                    locator=str(fact.get("locator") or ""),
                    confidence=str(fact.get("confidence") or "med"),
                    expr=str(fact.get("expr") or ""),
                    derived_from=fact.get("derived_from"),
                    note=str(fact.get("note") or ""),
                    ledger=(str(fact.get("ledger") or "")
                            if fact.get("ledger_explicit") else ""))
    return {"ok": True, "kind": KIND_ADD_FACT,
            "id": str(info.get("id") or ""),
            "claim": str(info.get("claim") or ""),
            "value": str(info.get("value") or ""),
            "source": str(info.get("source") or ""),
            "source_sha256": str(info.get("source_sha256") or ""),
            "ledger": str(info.get("ledger") or ""),
            "manifest_line": str(info.get("manifest_line") or ""),
            "warnings": []}


def apply_export_bundle(disk_root: Path, proposal: dict) -> dict:
    """采纳「导出投稿包」：真收集 ＋ 真过清单门。"""
    from .actions import export_bundle

    info = export_bundle(Path(disk_root))
    if not info.get("ok"):
        raise ConfigError("投稿包没过清单门：%s"
                          % (str(info.get("failure_reason")
                                 or info.get("error") or "见明细")),
                          code="BUNDLE_FAILED")
    return {"ok": True, "kind": KIND_EXPORT_BUNDLE,
            "bundle_dir": str(info.get("bundle_dir") or ""),
            "file_count": int(info.get("file_count") or 0),
            "passed": int(info.get("passed") or 0),
            "waived": int(info.get("waived") or 0),
            "failed": int(info.get("failed") or 0),
            "exit_code": int(info.get("exit_code") or 0),
            "warnings": []}
