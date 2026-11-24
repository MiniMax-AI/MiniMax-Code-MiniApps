# -*- coding: utf-8 -*-
"""工作台的另外三条只读读数：证据锁（G1）＋写作简报（G3）＋追加事实表单（G4）。

口径纪律（与四步链同一条原则）：**真闸算一次，界面与 MCP 都只做读数**。

* ``evidence_gate`` 复用 ``factscribe.evidence`` 的原件（``lock_check`` /
  ``unfrozen_info`` / ``log_state``），与 CLI 的 ``factscribe_evidence_status``
  同一条路——不另算一遍哈希，也不另判一次冻结。
* ``brief_reading`` 复用 ``factscribe.brief``（CLI ``factscribe brief`` 同一条路），
  只在其上**只增不改**地补三组读数：每节的「可引用／已绑／未绑」、每条事实的
  「绑在哪些节」、以及账上的「已绑／未绑」计数。

* ``fact_form`` 给追加事实表单备料：已签产物、未进清单的产物、盘内账本
  文件与命名风格。它只列候选，不替人挑，也不写盘。

三者都只读：不写盘、不改稿、不改冻结件。
"""
from __future__ import annotations

import os
from pathlib import Path, PurePosixPath

from .. import i18n
from ..brief import CONSTRAINTS, bound_fact_ids, build_brief, payload
from ..config import (ConfigError, load_config, load_facts, load_sections,
                      load_toml)
from ..evidence import (canonical_sha256, lock_check, log_state, read_lock,
                         unfrozen_info)
from ..scaffold import ledger_naming


# --------------------------------------------------------------------------
# 追加事实表单：产物候选 ＋ 账本文件（只读）
# --------------------------------------------------------------------------

#: 未进清单的产物只扫到这么多层（相对清单里那些产物所在的目录）。
#: 深目录动辄几十万文件，全量遍历会把页面拖死——扫了多少写在 scan 里，
#: 界面照实说，不装「全都在这儿」。
UNSIGNED_SCAN_DEPTH = 2

#: 未进清单的产物最多列多少个（超了就说超了）。
UNSIGNED_SCAN_LIMIT = 20000

#: 追加事实表单的错误码 → 目录键（界面据此翻语言；目录里缺了才回落中文原话）。
FACT_FORM_ERROR_KEYS = tuple(
    "wb.form.fact.err.%s" % name for name in (
        "LEDGER_PATH_INVALID", "LEDGER_OUTSIDE_GLOB",
        "LEDGER_NOT_IN_GLOB_DIR", "LEDGER_STYLE_MISMATCH",
        "LEDGER_PREFIX_TAKEN",
        "VALUE_NOT_IN_SOURCE", "VALUE_TEXT_NOT_IN_SOURCE",
        "VALUE_SOURCE_NOT_TEXT", "VALUE_SOURCE_UNREADABLE"))


def fact_form(disk: Path) -> dict:
    """追加事实表单的只读读数：产物候选 ＋ 账本文件 ＋ 命名风格。

    三组读数（都只读，不写盘）：

    * **已签产物**：该盘 results/MANIFEST.toml 的 [files]——人签过的那一组。
      每条附清单里的 sha256 与现算 sha256 的比对：签过之后被改过的标出来。
    * **未进清单的产物**：清单里那些产物**所在的目录**下（这里是
      experiments/）存在但没进清单的文件。只扫到有限深度——扫描范围写在
      scan 里。
    * **账本文件**：盘内现有 facts/*.toml ＋ 本盘的命名风格（新建账本文件
      要沿用它，前缀不能撞）。

    哈希一律现算；界面只读不改——source_sha256 由建单那一步的
    scaffold.prepare_fact 落到事实条目上，界面不让人碰哈希，也不给手打
    source 路径的入口。
    """
    from ..audit import source_base
    from ..facts import sha256_file

    disk = Path(disk)
    base = {"ok": True, "disk": str(disk)}
    try:
        cfg = load_config(disk)
    except ConfigError as exc:
        return {**base, "ok": False, "code": "CONFIG_INVALID", "error": str(exc)}
    except (OSError, ValueError) as exc:
        return {**base, "ok": False, "code": "READ_FAILED",
                "error": "读项目失败：%s" % exc}

    src_base = source_base(cfg)
    manifest_rel = str(cfg.manifest or "")
    manifest_data = {}
    if manifest_rel:
        try:
            manifest_data = load_toml(disk / manifest_rel)
        except (ConfigError, OSError):
            manifest_data = {}
    head = dict(manifest_data.get("manifest") or {})
    files = dict(manifest_data.get("files") or {})
    signed_by = str(head.get("signed_by") or "").strip()

    signed = []
    drifted = 0
    missing = 0
    for path in sorted(files):
        want = str(files.get(path) or "")
        live = ""
        gone = False
        full = src_base / str(path)
        if full.is_file():
            try:
                live = sha256_file(full)
            except OSError:
                live = ""
        else:
            gone = True
            missing += 1
        drift = bool(want and live and live != want)
        if drift:
            drifted += 1
        signed.append({"path": str(path), "sha256": want,
                       "live_sha256": live, "drift": drift,
                       "missing": gone})

    # 未进清单的产物：清单里那些产物**所在的目录**（第一段路径）。
    roots = []
    for path in files:
        parts = PurePosixPath(str(path)).parts
        if parts and parts[0] not in roots:
            roots.append(parts[0])
    roots.sort()

    unsigned = []
    total = 0
    truncated = False
    for root in roots:
        root_dir = src_base / root
        if not root_dir.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root_dir):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            rel_dir = os.path.relpath(dirpath, root_dir)
            depth = 0 if rel_dir == "." else len(Path(rel_dir).parts)
            if depth >= UNSIGNED_SCAN_DEPTH:
                dirnames[:] = []
            for name in sorted(filenames):
                if name.startswith("."):
                    continue
                if depth == 0:
                    rel = "/".join([root, name])
                else:
                    rel = "/".join([root, rel_dir.replace(os.sep, "/"), name])
                if rel in files:
                    continue
                total += 1
                if len(unsigned) >= UNSIGNED_SCAN_LIMIT:
                    truncated = True
                    continue
                unsigned.append(rel)
    unsigned.sort()

    naming = ledger_naming(disk, cfg)
    counts = {}
    try:
        for fact in load_facts(cfg):
            key = str(fact.file)
            counts[key] = counts.get(key, 0) + 1
    except (ConfigError, OSError, ValueError):
        counts = {}
    ledgers = [{"path": row["path"], "facts": counts.get(row["path"], 0)}
               for row in (naming.get("files") or [])]

    notes = []
    if not signed_by:
        notes.append(i18n.part("wb.form.fact.note.manifestUnsigned"))
    if not files:
        notes.append(i18n.part("wb.form.fact.note.noSigned"))
    if drifted:
        notes.append(i18n.part("wb.form.fact.note.drifted", {"count": drifted}))
    if missing:
        notes.append(i18n.part("wb.form.fact.note.missing", {"count": missing}))
    if roots:
        notes.append(i18n.part("wb.form.fact.note.scanScope",
                                {"roots": ", ".join(roots),
                                 "depth": UNSIGNED_SCAN_DEPTH,
                                 "total": total}))
    if not ledgers:
        notes.append(i18n.part("wb.form.fact.note.noLedger"))
    if not (cfg.source_root or "").strip():
        notes.append(i18n.part("wb.form.fact.note.sourceDir",
                                {"dir": cfg.source_dir}))

    try:
        inside = src_base.resolve().is_relative_to(disk.resolve())
    except (OSError, ValueError):
        inside = False

    style = str(naming.get("style") or "")
    prefix = str(naming.get("next_prefix") or "")
    sep = "_" if style == "letter_topic" else "-"
    example = ("%s%stopic.toml" % (prefix, sep)) if prefix else ""

    return {
        **base,
        "source_root": str(src_base),
        "source_root_in_project": bool(inside),
        "manifest": manifest_rel,
        "manifest_signed": bool(signed_by),
        "manifest_signed_by": signed_by,
        "signed": signed,
        "unsigned": unsigned,
        "scan": {"roots": roots, "depth": UNSIGNED_SCAN_DEPTH,
                 "total": total, "listed": len(unsigned),
                 "truncated": truncated},
        "ledgers": ledgers,
        "ledger_glob": str(cfg.facts_glob),
        "ledger_style": style,
        "ledger_next_prefix": prefix,
        "ledger_style_pattern": str(naming.get("pattern") or ""),
        "ledger_style_example": example,
        "ledger_used_prefixes": list(naming.get("used_prefixes") or []),
        "notes": notes,
        "notes_text": i18n.render_parts(notes, "zh", i18n.WORKBENCH_MESSAGES),
        "i18n": i18n.catalog_for(set(i18n.parts_keys(notes))
                                  | set(FACT_FORM_ERROR_KEYS),
                                  catalog=i18n.WORKBENCH_MESSAGES),
    }

def evidence_gate(disk: Path) -> dict:
    """证据锁读数：冻结状态／差异明细／最后一条日志（只读）。

    形状对齐 CLI MCP 的 ``factscribe_evidence_status``：
    ``frozen`` / ``entries`` / ``sha256`` / ``mismatch`` / ``unfrozen`` /
    ``diff{added,removed,moved}`` / ``last_log{action,reason,at}``。
    读不动就结构化报错，绝不抛 500。
    """
    disk = Path(disk)
    base = {"ok": True, "disk": str(disk)}
    try:
        cfg = load_config(disk)
    except ConfigError as exc:
        return {**base, "ok": False, "code": "CONFIG_INVALID", "error": str(exc)}
    except (OSError, ValueError) as exc:
        return {**base, "ok": False, "code": "READ_FAILED",
                "error": "读项目失败：%s" % exc}

    lock = None
    try:
        lock = read_lock(disk)
    except Exception:  # noqa: BLE001 - 锁读不动不该掀翻整页
        lock = None
    declared = dict(getattr(cfg, "evidence_sections", {}) or {})
    try:
        current_sha = canonical_sha256(declared)
    except Exception:  # noqa: BLE001
        current_sha = ""
    try:
        mismatch = lock_check(cfg)
    except Exception:  # noqa: BLE001
        mismatch = None
    try:
        unfrozen = unfrozen_info(disk)
        log = log_state(disk)
    except Exception:  # noqa: BLE001
        unfrozen, log = None, {}
    diff = (mismatch or {}).get("diff") or {"added": [], "removed": [], "moved": []}
    return {
        **base,
        "defined": bool(getattr(cfg, "evidence_defined", False)),
        "declared_sections": len(declared),
        "declared": {key: list(value)
                     for key, value in sorted(declared.items())},
        "frozen": bool(lock),
        "entries": int((lock or {}).get("entries") or 0),
        "sha256": (lock or {}).get("sha256", ""),
        "sha256_short": ((lock or {}).get("sha256") or "")[:8],
        "current_sha256": current_sha,
        "current_sha256_short": current_sha[:8],
        # mismatch＝None 表示「冻结件与当前清单一致」；不一致时带明细。
        "mismatch": mismatch,
        "diff": diff,
        "unfrozen": unfrozen,
        "log": log,
        "last_log": {"action": str(log.get("action") or ""),
                     "reason": str(log.get("reason") or ""),
                     "at": str(log.get("at") or ""),
                     "count": int(log.get("count") or 0)},
    }


def facts_list(disk: Path) -> dict:
    """事实账清单（只读）：「插入事实」面板的备料。

    只列账上**已有**的事实（id／主张／value／出处）——面板里能选的每一条
    都来自这里，所以插进正文的数字天生是账上的数字（不是现编的）。

    口径复用机器视图的账本表（checkreport._ledger_rows）：同一份事实、
    同一套字段，不另算一遍。
    """
    from .checkreport import _ledger_rows

    disk = Path(disk)
    try:
        cfg = load_config(disk)
        facts = load_facts(cfg)
    except ConfigError as exc:
        return {"ok": False, "code": "CONFIG_INVALID", "error": str(exc)}
    except (OSError, ValueError) as exc:
        return {"ok": False, "code": "READ_FAILED",
                "error": "读事实账失败：%s" % exc}
    rows = _ledger_rows(facts)
    return {"ok": True, "rows": rows, "count": len(rows)}


def brief_reading(disk: Path, section: str = "",
                       fact: str = "") -> dict:
    """写作简报读数：可引用的事实、已绑的、还没绑的（只读）。

    口径复用 ``factscribe.brief``（CLI ``factscribe brief`` 同一条路）：
    事实表来自账，节清单来自主文件的 input 顺序，术语表来自词表。

    本函数**只增不改**：brief 原有的 ``sections`` / ``facts`` / ``terms``
    字段一字不动，另加三组读数，让宿主不必自己判断「能不能引」：

    * 每节：``usable``（可引用）、``bound``（已绑）、``unbound``（可引用
      但还没绑）、``reconciled``（声明是否都绑上了）；
    * 每条事实：``bound_in``（绑在哪些节）、``status``（bound / unbound）；
    * 汇总：``counts``（账上总数／已绑／未绑）。

    ``fact``＝按事实 id 定位：给一个 id，就在 ``focus`` 里回一条
    「这条事实绑在哪几节」的定位（比 ``fs_query_facts`` 的 bound_in 更好用：
    它把每一节的绑定与否都列出来，还带上 claim／value／出处）。**只增不改**：
    不给 fact 时，载荷与从前逐字节一致。
    """
    disk = Path(disk)
    base = {"ok": True, "disk": str(disk)}
    # 先把参数取下来——下面有个同名的循环变量（fact），会把它盖掉。
    wanted_fact = str(fact or "").strip()
    try:
        cfg = load_config(disk)
        sections = load_sections(cfg)
        brief = build_brief(disk, (section or "").strip() or None)
    except ConfigError as exc:
        return {**base, "ok": False, "code": "BRIEF_UNAVAILABLE", "error": str(exc)}
    except (OSError, ValueError) as exc:
        return {**base, "ok": False, "code": "READ_FAILED",
                "error": "读项目失败：%s" % exc}

    data = payload(brief)
    bound_map = {rel: list(bound_fact_ids(text)) for rel, text in sections}

    # 每条事实绑在哪些节（跨全项目，不只本节）。
    fact_sections: dict = {}
    for rel, ids in bound_map.items():
        for fid in ids:
            fact_sections.setdefault(fid, []).append(rel)

    rows = []
    for row in data.get("sections") or []:
        rel = str(row.get("file") or "")
        bound = bound_map.get(rel, [])
        usable = [str(x) for x in (row.get("evidence") or [])]
        unbound = [fid for fid in usable if fid not in bound]
        rows.append({
            **row,
            "bound": bound,
            "usable": usable,
            "unbound": unbound,
            "reconciled": bool(usable) and not unbound,
        })

    facts = []
    bound_total = 0
    for fact in data.get("facts") or []:
        fid = str(fact.get("id") or "")
        where = sorted(fact_sections.get(fid, []))
        if where:
            bound_total += 1
        facts.append({**fact, "bound_in": where,
                      "status": "bound" if where else "unbound"})

    total = len(facts)

    # 按 fact id 定位（可选）：这条事实绑在哪几节。
    focus = {}
    wanted = wanted_fact
    if wanted:
        hit = None
        for row in facts:
            if str(row.get("id") or "").casefold() == wanted.casefold():
                hit = row
                break
        where = []
        for row in rows:
            rel = str(row.get("file") or "")
            where.append({
                "file": rel,
                "title": str(row.get("title") or ""),
                "bound": wanted in [str(x) for x in (row.get("bound") or [])],
                "usable": wanted in [str(x) for x in (row.get("usable") or [])],
            })
        focus = {
            "fact": wanted,
            "found": hit is not None,
            "claim": str((hit or {}).get("claim") or ""),
            "value": str((hit or {}).get("value") or ""),
            "source": str((hit or {}).get("source") or ""),
            "locator": str((hit or {}).get("locator") or ""),
            "bound_in": list((hit or {}).get("bound_in") or []),
            "status": str((hit or {}).get("status") or ""),
            "sections": where,
        }

    payload_out = {
        **base,
        "project": data.get("project", ""),
        "root_tex": data.get("root_tex", ""),
        "section": data.get("section") or "",
        "facts_total": int(data.get("facts_total") or total),
        "counts": {"ledger_total": total, "bound": bound_total,
                   "unbound": total - bound_total,
                   "sections_total": len(rows)},
        "sections": rows,
        "facts": facts,
        "terms": data.get("terms") or [],
        "notes": list(data.get("notes") or []),
        "constraints": list(CONSTRAINTS),
    }
    if focus:
        payload_out["focus"] = focus
    return payload_out
