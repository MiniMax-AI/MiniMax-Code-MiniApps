# -*- coding: utf-8 -*-
"""证据钢印：人钉清单、机器执行（SPEC-EVIDENCE-STAMP，批 131）。

两条判据，都是红（阻断）：

* ``REQUIRED_EVIDENCE_MISSING``：`[evidence]` 声明的节里找不到某个
  ``\\fact{id}``；
* ``EVIDENCE_DROPPED``：改前本节有的 ``\\fact{id}``，改后本节没有
  （只在 ``style --diff`` / ``review`` 有 before 时运行，不依赖声明）；
* ``EVIDENCE_SET_CHANGED``（批 132）：`[evidence]` 与 ``audit/evidence.lock``
  的规范化哈希不符（``audit`` / ``review`` 都判；lock 不存在不检查）；
* ``EVIDENCE_UNFROZEN``（批 133，黄）：清单处在「已解冻、未重冻」状态
  （``audit/evidence-log.ndjson`` 最后一条是 ``unfreeze``）。

硬边界：

* **只执行清单**：清单可由人、LLM 或工具提出（``evidence --suggest``），
  机器不推导「该引哪些」；声明/冻结之后 id 一个不补全（见规范 §8）；
* **存在性判据**：复用 ``texscan.scan_tex`` 的 markers——注释、verbatim、
  批注宏里的 ``\\fact{}`` 不算引用，与本工具其它数字判据同一套遮罩；
* **不新增退出码**：红＝1，与 ``protect`` 同一套；本模块只服务 ``style`` /
  ``review``，不改 ``audit``。
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

from .config import Config, ConfigError, load_facts, load_toml
from .safepath import guard_project_write
from .texscan import scan_tex

MISSING_CODE = "REQUIRED_EVIDENCE_MISSING"
DROPPED_CODE = "EVIDENCE_DROPPED"
CHANGED_CODE = "EVIDENCE_SET_CHANGED"
UNFROZEN_CODE = "EVIDENCE_UNFROZEN"
EVIDENCE_CODES = (MISSING_CODE, DROPPED_CODE, CHANGED_CODE, UNFROZEN_CODE)

#: 冻结件相对项目根的路径（批 132）。
LOCK_REL = "audit/evidence.lock"
LOCK_HEADER = "# 冻结时间由使用者填写（不用系统时钟，保持确定性）"
#: 解冻/冻结流水账相对项目根的路径（批 133，append-only）。
LOG_REL = "audit/evidence-log.ndjson"


@dataclass(frozen=True)
class EvidenceIssue:
    """一条证据缺钉：style 负责转成 Finding（红）。"""

    code: str
    file: str
    line: int
    text: str
    suggestion: str
    metric: str = "evidence"

    def as_dict(self) -> dict:
        return {"code": self.code, "severity": "red", "file": self.file,
                "line": self.line, "text": self.text,
                "suggestion": self.suggestion}


def fact_ids(text: str) -> list[tuple[str, int]]:
    """正文里 ``\\fact{id}`` 的 (id, 行号)，按出现顺序、按 id 去重。

    ``texscan`` 已经剥掉注释与 verbatim；这里只做去重（同一节重复引用同一
    事实是正常写法，存在性判据只看「有没有」）。
    """
    seen: set[str] = set()
    out: list[tuple[str, int]] = []
    for fid, line in scan_tex(text).markers:
        key = str(fid).strip().casefold()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append((str(fid).strip(), line))
    return out


def _fact_index(facts: list) -> dict:
    return {f.id_key: f for f in facts}


def _safe_facts(cfg: Config) -> list:
    """账读不出来时不让 style 崩：message 写「账里没有这条 fact」，仍然红。"""
    try:
        return load_facts(cfg)
    except ConfigError:
        return []


def _describe(fid: str, facts: dict[str, object]) -> str:
    fact = facts.get(fid.casefold())
    if fact is None:
        return "账里没有这条 fact"
    claim = str(getattr(fact, "claim", "") or "—")
    value = str(getattr(fact, "value", "") or "—")
    return "claim：%s；value：%s" % (claim, value)


def check_evidence(cfg: Config, sections: list[tuple[str, str]],
                   before: tuple[Config, list[tuple[str, str]]] | None = None
                   ) -> tuple[list[EvidenceIssue], dict]:
    """跑两条判据；返回 (issues, 读数明细)。

    ``sections`` 是 ``load_sections`` 的 [(相对路径, 正文)]；``before`` 是
    ``style --diff`` / ``review`` 的 (改前 Config, 改前 sections)。
    """
    issues: list[EvidenceIssue] = []
    by_key: dict[str, tuple[str, str]] = {}
    for rel, text in sections:
        by_key.setdefault(rel.rsplit("/", 1)[-1].rsplit(".", 1)[0], (rel, text))

    declared = dict(getattr(cfg, "evidence_sections", {}) or {})
    unknown = [key for key in declared if key not in by_key]
    facts = _fact_index(_safe_facts(cfg)) if declared else {}

    # ---- 1. REQUIRED_EVIDENCE_MISSING：只查声明过的节 ----
    missing = 0
    for key, ids in declared.items():
        if key not in by_key:
            continue
        rel, text = by_key[key]
        present = {fid for fid, _line in fact_ids(text)}
        present_keys = {fid.casefold() for fid in present}
        for fid in ids:
            if fid.casefold() in present_keys:
                continue
            missing += 1
            issues.append(EvidenceIssue(
                MISSING_CODE, rel, 1,
                "节 %s 缺必需证据 %s（%s）"
                % (key, fid, _describe(fid, facts)),
                "把 %s 的 `\\fact{%s}` 绑定补回本节正文（值与账本逐字一致）；"
                "不许改 id、不许改数字、不许把论点搬到别节冒充。"
                % (fid, fid)))

    # ---- 2. EVIDENCE_DROPPED：只在有 before 时跑，不依赖声明 ----
    dropped = 0
    if before is not None:
        before_cfg, before_sections = before
        after_map = {rel: text for rel, text in sections}
        before_facts = facts or _fact_index(_safe_facts(before_cfg))
        for rel, text in before_sections:
            after_text = after_map.get(rel, "")
            after_ids = {fid.casefold() for fid, _line in fact_ids(after_text)}
            for fid, _line in fact_ids(text):
                if fid.casefold() in after_ids:
                    continue
                dropped += 1
                issues.append(EvidenceIssue(
                    DROPPED_CODE, rel, 1,
                    "节 %s 丢了改前已有的证据 %s（%s）"
                    % (rel, fid, _describe(fid, before_facts)),
                    "把 `\\fact{%s}` 与对应数字补回本节；若确属结构调整，先改 "
                    "[evidence] 清单与账，不许用 nearly/most/some 这类定性说法顶替。"
                    % fid))

    details = {
        "declared": [{"section": key, "ids": list(ids)}
                     for key, ids in declared.items()],
        "unknown_sections": unknown,
        "missing": missing,
        "dropped": dropped,
    }
    return issues, details


# --------------------------------------------------------------------------
# 批 132：清单可由 LLM 产出，但由机器冻结（SPEC-EVIDENCE-STAMP §8）
# --------------------------------------------------------------------------

def _section_key(rel: str) -> str:
    """节键＝节文件名去扩展名（与 ``[evidence]`` / ``[budget.sections]`` 同口径）。"""
    return Path(str(rel)).stem


def suggest_evidence(sections: list[tuple[str, str]]) -> dict[str, list[str]]:
    """现状快照：每节正文里 ``\\fact{id}`` 的 id，按出现顺序去重。

    只列**实际有引用**的节（没有引用的节不写空数组，免得看起来像声明过）；
    节键按名字排序，保证同输入同输出。不判断该不该引。
    """
    out: dict[str, list[str]] = {}
    for rel, text in sections:
        ids = [fid for fid, _line in fact_ids(text)]
        if not ids:
            continue
        key = _section_key(rel)
        bucket = out.setdefault(key, [])
        seen = {fid.casefold() for fid in bucket}
        for fid in ids:
            if fid.casefold() in seen:
                continue
            seen.add(fid.casefold())
            bucket.append(fid)
    return {key: out[key]
            for key in sorted(out, key=lambda k: (k.casefold(), k))}


def render_toml(evidence: dict[str, list[str]]) -> str:
    """可直接粘进 ``factscribe.toml`` 的 ``[evidence]`` 块（确定性）。"""
    lines = ["[evidence]"]
    for key in sorted(evidence, key=lambda k: (k.casefold(), k)):
        ids = ", ".join(json.dumps(str(i), ensure_ascii=False)
                        for i in evidence[key])
        lines.append('"%s" = [%s]' % (key.replace('"', '\\"'), ids))
    return "\n".join(lines) + "\n"


def suggest_summary(scanned: int, evidence: dict[str, list[str]]) -> str:
    """``--suggest`` 的人话摘要（批 134）。

    只进 stderr 与 ``--json`` 的 ``summary`` 字段，**绝不进 stdout 的 TOML**
    ——摘要混进 TOML 会让重定向产物解析失败、后续命令 exit 2。
    """
    return ("扫描 %d 节，%d 节有 fact 引用，共 %d 条 id（未冻结）"
            % (scanned, len(evidence), entry_count(evidence)))


def _norm_ids(ids) -> list[str]:
    """去空白、按大小写不敏感去重、按大小写不敏感排序（冻结口径）。"""
    seen: set[str] = set()
    out: list[str] = []
    for raw in ids or ():
        fid = str(raw).strip()
        if not fid or fid.casefold() in seen:
            continue
        seen.add(fid.casefold())
        out.append(fid)
    return sorted(out, key=lambda s: (s.casefold(), s))


def _norm_sections(evidence: dict) -> dict[str, list[str]]:
    return {str(key).strip(): _norm_ids(ids)
            for key, ids in (evidence or {}).items() if str(key).strip()}


def canonical_form(evidence: dict) -> str:
    """冻结的规范化正文：节名排序，节内 id 排序去重，无尾换行。"""
    normal = _norm_sections(evidence)
    lines = []
    for key in sorted(normal, key=lambda k: (k.casefold(), k)):
        lines.append("%s\t%s" % (key, ",".join(normal[key])))
    return "\n".join(lines)


def canonical_sha256(evidence: dict) -> str:
    """同一份清单的唯一指纹：同输入同哈希，与书写顺序无关。"""
    return hashlib.sha256(canonical_form(evidence).encode("utf-8")).hexdigest()


def entry_count(evidence: dict) -> int:
    return sum(len(ids) for ids in _norm_sections(evidence).values())


def write_lock(project_root: Path, evidence: dict) -> dict:
    """写 ``audit/evidence.lock``；不碰系统时钟，同输入逐字节一致。"""
    normal = _norm_sections(evidence)
    digest = canonical_sha256(normal)
    entries = entry_count(normal)
    lines = [LOCK_HEADER,
             'canonical_sha256 = "%s"' % digest,
             "entries = %d" % entries,
             ""]
    if normal:
        lines.append("[sections]")
        for key in sorted(normal, key=lambda k: (k.casefold(), k)):
            ids = ", ".join(json.dumps(i, ensure_ascii=False)
                            for i in normal[key])
            lines.append('"%s" = [%s]' % (key.replace('"', '\\"'), ids))
    path = Path(project_root) / LOCK_REL
    # 写侧落点闸：冻结件必须落在项目根内（软链绕出去就拒写，不落盘）。
    guard_project_write(Path(project_root), path, what="证据冻结件", rel=LOCK_REL)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"path": LOCK_REL, "sha256": digest, "entries": entries,
            "sections": normal}


def read_lock(project_root: Path) -> dict | None:
    """读冻结件；不存在返回 ``None``（向后兼容：不检查）。

    形态不合法即配置错（退出码 2）：冻结件坏了不能静默当成「没冻结」。
    """
    path = Path(project_root) / LOCK_REL
    if not path.is_file():
        return None
    data = load_toml(path)
    digest = data.get("canonical_sha256")
    if not isinstance(digest, str) or not digest.strip():
        raise ConfigError("%s 缺少 canonical_sha256——冻结件不可用" % path)
    raw_sections = data.get("sections")
    if raw_sections is None:
        sections: dict[str, list[str]] = {}
    elif not isinstance(raw_sections, dict):
        raise ConfigError("%s 的 [sections] 必须是表" % path)
    else:
        sections = {}
        for key, value in raw_sections.items():
            if not isinstance(value, list) or not all(
                    isinstance(i, str) for i in value):
                raise ConfigError(
                    "%s 的 [sections].%s 必须是字符串数组"
                    % (path, key))
            sections[str(key)] = list(value)
    return {"path": LOCK_REL, "sha256": digest.strip().lower(),
            "entries": data.get("entries"), "sections": sections}


# --------------------------------------------------------------------------
# 批 133：解冻与重冻（SPEC-EVIDENCE-STAMP §9）
# --------------------------------------------------------------------------

def read_log(project_root: Path) -> list[dict]:
    """读 ``audit/evidence-log.ndjson``；不存在返回空列表。

    一行一个 JSON 对象，append-only。坏行是配置错（退出码 2）：流水账坏了
    不能静默当成「没解冻」，否则黄判据会悄悄消失。
    """
    path = Path(project_root) / LOG_REL
    if not path.is_file():
        return []
    records: list[dict] = []
    for number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ConfigError("%s 第 %d 行不是合法 JSON：%s"
                              % (path, number, exc.msg))
        if not isinstance(record, dict):
            raise ConfigError("%s 第 %d 行必须是 JSON 对象" % (path, number))
        records.append(record)
    return records


def append_log(project_root: Path, record: dict) -> None:
    """追加一条流水账；只用调用方给的字段，不碰系统时钟。"""
    path = Path(project_root) / LOG_REL
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(record, ensure_ascii=False,
                                separators=(",", ":")) + "\n")


def log_state(project_root: Path) -> dict:
    """流水账的最后状态：最后一条是不是 ``unfreeze``。"""
    records = read_log(project_root)
    if not records:
        return {"count": 0, "action": None, "unfrozen": False,
                "reason": "", "at": "", "last": None}
    last = records[-1]
    action = last.get("action")
    return {"count": len(records), "action": action,
            "unfrozen": action == "unfreeze",
            "reason": str(last.get("reason") or ""),
            "at": str(last.get("at") or ""), "last": last}


def unfrozen_info(project_root: Path) -> dict | None:
    """解冻状态 → 黄判据的明细；已重冻或从未解冻 → ``None``。"""
    state = log_state(project_root)
    if not state["unfrozen"]:
        return None
    reason = state["reason"] or "（未写理由）"
    return {
        "code": UNFROZEN_CODE,
        "message": ("[evidence] 处于解冻状态（%s 最后一条是 unfreeze）："
                    "最近一次解冻理由「%s」。改完清单必须重新 "
                    "`evidence --freeze --reason \"...\"`，让差异留在版本账里。"
                    % (LOG_REL, reason)),
        "location": LOG_REL,
        "reason": state["reason"],
        "at": state["at"],
        "hash_before": str(state["last"].get("hash_before") or ""),
    }


def _clean_reason(reason) -> str:
    text = str(reason or "").strip()
    if not text:
        raise ConfigError("--unfreeze 必须带非空 --reason（为什么改），"
                          "理由会写进 %s" % LOG_REL)
    return text


def unfreeze_evidence(project_root: Path, reason, at="") -> dict:
    """解冻：写一条 ``unfreeze`` 记录（含 hash_before）；已解冻则幂等。"""
    text = _clean_reason(reason)
    stamp = str(at or "").strip()
    if stamp and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", stamp):
        raise ConfigError("--at 必须是 YYYY-MM-DD（例：2026-11-11），"
                          "不许用系统时钟")
    root = Path(project_root)
    lock = read_lock(root)
    if lock is None:
        raise ConfigError("尚未冻结（没有 %s）：无冻可解，先 evidence --freeze"
                          % LOCK_REL)
    state = log_state(root)
    if state["unfrozen"]:
        return {"path": LOG_REL, "action": "unfreeze",
                "reason": state["reason"] or text,
                "hash_before": str(state["last"].get("hash_before") or
                                   lock["sha256"][:16]),
                "at": state["at"], "idempotent": True}
    record = {"action": "unfreeze", "reason": text,
              "hash_before": lock["sha256"][:16], "at": stamp}
    append_log(root, record)
    return {"path": LOG_REL, "action": "unfreeze", "reason": text,
            "hash_before": record["hash_before"], "at": stamp,
            "idempotent": False}


def freeze_evidence(project_root: Path, evidence: dict, reason="") -> dict:
    """冻结：写 lock 并记一条 ``freeze``；已冻结且哈希未变则幂等不写。"""
    root = Path(project_root)
    normal = _norm_sections(evidence)
    digest = canonical_sha256(normal)
    entries = entry_count(normal)
    note = str(reason or "")
    lock = read_lock(root)
    state = log_state(root)
    if (lock is not None and lock["sha256"] == digest
            and not state["unfrozen"]):
        return {"path": LOCK_REL, "sha256": digest, "entries": entries,
                "sections": normal, "reason": note, "idempotent": True}
    info = write_lock(root, evidence)
    append_log(root, {"action": "freeze", "hash": info["sha256"],
                      "entries": info["entries"], "reason": note})
    info["reason"] = note
    info["idempotent"] = False
    return info


def _id_sets(evidence: dict) -> dict[str, tuple[str, list[str]]]:
    """casefold(id) → (原样 id, 声明该 id 的节键列表)。"""
    out: dict[str, tuple[str, list[str]]] = {}
    for key, ids in _norm_sections(evidence).items():
        for fid in ids:
            display, sections = out.setdefault(fid.casefold(), (fid, []))
            if key not in sections:
                sections.append(key)
    return {k: (fid, sorted(secs, key=lambda s: (s.casefold(), s)))
            for k, (fid, secs) in out.items()}


def diff_evidence(locked: dict, current: dict) -> dict:
    """两份清单的差异：新增 / 删除 / 移动（同一 id 换了节集合）。

    按 (节, id) 对比较：同一 id 一边少一边多 ⇒ 报「移动」；只多 ⇒ 新增；
    只少 ⇒ 删除。这样重复声明（同一 id 出现在两节）也有确定说法。
    """
    old, new = _id_sets(locked), _id_sets(current)
    added_ids = [k for k in new if k not in old]
    removed_ids = [k for k in old if k not in new]
    moved_ids = [k for k in new if k in old and old[k][1] != new[k][1]]
    added = [(sec, new[k][0]) for k in added_ids for sec in new[k][1]]
    removed = [(sec, old[k][0]) for k in removed_ids for sec in old[k][1]]
    moved = [(old[k][1], new[k][1], new[k][0]) for k in moved_ids]
    return {"added": sorted(added), "removed": sorted(removed),
            "moved": sorted(moved)}


def _fmt_pairs(pairs) -> str:
    return "、".join("%s:%s" % (sec, fid) for sec, fid in pairs) or "无"


def _fmt_moved(pairs) -> str:
    return "、".join("%s 从 %s 到 %s"
                     % (fid, "、".join(src), "、".join(dst))
                     for src, dst, fid in pairs) or "无"


def lock_check(cfg: Config) -> dict | None:
    """冻结后的检查：哈希不符即红；lock 不存在返回 ``None``（不检查）。

    只判「冻结后有没有被改」，不判「该不该引」。差异只用于给人看。
    """
    lock = read_lock(cfg.root)
    if lock is None:
        return None
    current = dict(getattr(cfg, "evidence_sections", {}) or {})
    digest = canonical_sha256(current)
    if digest == lock["sha256"]:
        return None
    diff = diff_evidence(lock["sections"], current)
    if lock["sections"] or current:
        if not lock["sections"]:
            detail = ("冻结件没有 [sections] 映射，只能确认哈希不符；"
                      "请重新 `evidence --freeze` 留底")
        else:
            detail = ("新增 %s；删除 %s；移动 %s"
                      % (_fmt_pairs(diff["added"]),
                         _fmt_pairs(diff["removed"]),
                         _fmt_moved(diff["moved"])))
    else:
        detail = "冻结件与当前清单都为空，但哈希不符（冻结件可能被手改）"
    message = ("[evidence] 与冻结件 %s 不一致（当前 %s…，冻结 %s…）——%s。"
               "改清单是允许的，但必须重新冻结并提交，让差异留在版本账里"
               % (LOCK_REL, digest[:12], lock["sha256"][:12], detail))
    return {"message": message, "location": LOCK_REL,
            "current_sha256": digest, "locked_sha256": lock["sha256"],
            "entries": lock.get("entries"), "diff": {
                "added": [{"section": s, "id": i} for s, i in diff["added"]],
                "removed": [{"section": s, "id": i} for s, i in diff["removed"]],
                "moved": [{"from": f, "to": t, "id": i}
                          for f, t, i in diff["moved"]],
            }}
