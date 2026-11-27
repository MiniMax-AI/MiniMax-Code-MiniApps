# -*- coding: utf-8 -*-
"""发现文案的 i18n 目录（检查报告里每条 finding 的 message）。

**为什么有这一层**：真闸（audit / style）产出的发现原本只有一段中文
`message`。EN 界面上就出现「PDF 比源文件旧，先重编……」这种半中半英。
仓库里已有 `label_key` / `detail_key` 的做法（后端给结构化 key，前端翻），
本模块把 `message` 也纳入同一套：后端给 `message_key` + `params`，
前端（或 MCP 消费者）按 key 取模板渲染。

**口径**：

* 目录是**双语的唯一事实源**：中文模板与真闸原来的中文 message 逐字一致
  （`scripts/gen_finding_i18n.py` 机械推出来，测试逐条比对），英文模板
  是同一句话的英文版。
* key 的形状：`finding.<CODE>`；同一个 code 有多种文案形态时，
  按形态首次出现的位置排 `finding.<CODE>.v2` / `.v3`……
  （同一形态的多个站点共用同一个 key——它们是同一条文案）。
* `message` 旧字段**一字不改**：CLI、JSON 输出的中文 message 原样保留，
  目录只是多给一条可本地化的读数（只增键不改名不删键）。
* 英文模板**不许有中文**：EN 界面无中文残留是硬指标，测试逐条查。

**渲染**：`render(key, params, lang)` 做一次单遍槽位替换——
`{slot}` 换成 `params[slot]` 的字符串形式。没给到的槽位**原样留着**
（宁可看得见 `{slot}`，也不要静默渲染成空串）。
"""
from __future__ import annotations

import re

LANGS = ("zh", "en")
DEFAULT_LANG = "zh"

# 槽位：{名字}。名字只许字母数字下划线。
_SLOT_RE = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")


def finding_key(code: str, variant: str = "") -> str:
    """`finding.<CODE>` / `finding.<CODE>.<variant>`。"""
    return "finding." + code + (("." + variant) if variant else "")


def has_message(key: str) -> bool:
    """目录里有没有这条 key。"""
    return key in FINDING_MESSAGES


def template_for(key: str, lang: str = DEFAULT_LANG,
                 catalog: dict | None = None) -> str:
    """取模板：先要这个语言，没有就退到中文，都没有就返回 key 本身。

    catalog＝目录（默认＝发现文案目录 FINDING_MESSAGES）；工作台自己
    生成的说明文案走 WORKBENCH_MESSAGES，同一套机制、另一份目录。
    """
    source = FINDING_MESSAGES if catalog is None else catalog
    entry = source.get(key) or {}
    text = entry.get(lang) or entry.get(DEFAULT_LANG) or ""
    return text or key


def missing_slots(key: str, params: dict | None) -> list:
    """模板里有、但 `params` 没给的槽位（渲染出来会留着 `{slot}`）。"""
    params = params or {}
    names = set(_SLOT_RE.findall(template_for(key)))
    return sorted(n for n in names if n not in params)


def render(key: str, params: dict | None = None, lang: str = DEFAULT_LANG,
            catalog: dict | None = None) -> str:
    """渲染一条文案。槽位替换只走一遍（值里带 `{x}` 不会被二次替换）。"""
    params = params or {}
    text = template_for(key, lang, catalog)

    def sub(match):
        name = match.group(1)
        if name not in params:
            return match.group(0)
        value = params[name]
        if value is None:
            return ""
        if isinstance(value, bool):
            return "true" if value else "false"
        return str(value)

    return _SLOT_RE.sub(sub, text)


def issue_dict(issue, lang: str = DEFAULT_LANG) -> dict:
    """一条审计发现 → 报告用的字典：旧形状一字不动，另给 i18n 原料。

    ``message_key`` ＋ ``params`` 始终给出（只增键）；
    ``lang`` 不是 zh 时，``message`` 走目录里的对应语言模板。
    """
    data = issue.as_dict()
    key = getattr(issue, "message_key", "") or finding_key(
        str(data.get("code") or ""))
    params = dict(getattr(issue, "params", {}) or {})
    if str(lang or DEFAULT_LANG).lower() != DEFAULT_LANG:
        message = render(key, params, str(lang).lower())
        if message:
            data["message"] = message
    data["message_key"] = key
    data["params"] = params
    return data


def style_finding_dict(finding, lang: str = DEFAULT_LANG) -> dict:
    """一条文风发现 → 报告用的字典：旧形状一字不动，另给 message ＋ i18n 原料。

    文风发现的旧形状里没有 ``message``（只有 ``suggestion``）；这里补一条
    ``message``（按 lang 渲染）——与工作台报告里的那条一一对应。
    """
    data = finding.as_dict()
    key = getattr(finding, "message_key", "") or finding_key(
        str(data.get("code") or ""))
    params = dict(getattr(finding, "params", {}) or {})
    message = render(key, params, str(lang or DEFAULT_LANG).lower())
    if message:
        data["message"] = message
    data["message_key"] = key
    data["params"] = params
    return data


def catalog_for(keys, langs=LANGS, catalog: dict | None = None) -> dict:
    """载荷里出现过的 key 的模板子集（前端按它翻译，省得再抄一份目录）。"""
    source = FINDING_MESSAGES if catalog is None else catalog
    out = {}
    for key in keys:
        entry = source.get(key)
        if not entry:
            continue
        picked = {lang: entry[lang] for lang in langs if entry.get(lang)}
        if picked:
            out[key] = picked
    return out


# --- BEGIN FINDING_MESSAGES ---
FINDING_MESSAGES: dict = {
    "finding.ABBREV_FIRST_USE": {
        "zh": "缩写「{token}」首次出现时没有展开。同句或前一句写成「全称（{token1}）」或「Expanded Name ({token2})」，后文再用缩写。",
        "en": "The abbreviation \"{token}\" is not expanded at its first occurrence. Write it in the same sentence or the one before as \"Full Name ({token1})\" or \"Expanded Name ({token1})\", then use the abbreviation from then on.",
    },
    "finding.APPROVAL_MISSING_ASSERTIONS.v2": {
        "zh": "fact {fact} 有定量值 {value}，但活跃正文里没有任何 \\fact{{fact1}} 标记——没有断言可签（宏定义体/被丢弃的宏参数/附录外都算没写）",
        "en": "fact {fact} has the quantitative value {value}, but no \\fact{{fact1}} marker exists in the live body — there is no assertion to sign (macro bodies, discarded macro arguments, and text outside the appendix all count as not written)",
    },
    "finding.APPROVAL_MISSING_ASSERTIONS.v3": {
        "zh": "审批目标 {loc} 读不了或不是对象",
        "en": "approval target {loc} cannot be read or is not an object",
    },
    "finding.APPROVAL_MISSING_ASSERTIONS.v4": {
        "zh": "审批目标 {loc} 没有签名（缺 .sig / signature）",
        "en": "approval target {loc} has no signature (missing .sig / signature)",
    },
    "finding.APPROVAL_REPLAY": {
        "zh": "审批 nonce {nonce} 已在账上出现过——重放",
        "en": "approval nonce {nonce} already appears in the ledger — replay",
    },
    "finding.APPROVAL_STALE.v2": {
        "zh": "fact {fact} 的 source_sha256 与磁盘现算值不符——审批对象（S-03 的 approve_target）已过期，必须重签",
        "en": "fact {fact}: source_sha256 does not match the value recomputed from disk — the approval target (approve_target in S-03) has expired and must be re-signed",
    },
    "finding.APPROVAL_STALE.v3": {
        "zh": "审批目标 {loc} 指向账上没有的 fact {fid}",
        "en": "approval target {loc} points to fact {fid}, which is not in the ledger",
    },
    "finding.APPROVAL_STALE.v4": {
        "zh": "审批签名无效：签名消息必须是 target_sha256={digest}",
        "en": "approval signature is invalid: the signed message must be target_sha256={digest}",
    },
    "finding.APPROVAL_STALE.v5": {
        "zh": "report.approvals[{fid}].target_sha256 与现值不符——签过的目标被换过",
        "en": "report.approvals[{fid}].target_sha256 does not match the current value — the signed target was swapped",
    },
    "finding.APPROVAL_STALE.v6": {
        "zh": "report 里的 assertion_digest 与审批目标不符（{fid}）",
        "en": "the assertion_digest in the report does not match the approval target ({fid})",
    },
    "finding.ARITH_IN_BODY": {
        "zh": "算术/计数器命令 \\{name} 会产生账上没有的数字——数值不可寻址（R-01A-A）",
        "en": "the arithmetic/counter command \\{name} produces a number that is not in the ledger — the value is not addressable (R-01A-A)",
    },
    "finding.ASSERTION_DRIFT.display": {
        "zh": "fact {fact} 的批准显示形与 value 不等价：display {display} 与 value {value} 不等价（严格 canon 比较，不再有 round_to 容差）（S-03）",
        "en": "fact {fact}: the approved display form is not equivalent to the value — display {display} is not equivalent to value {value} (strict canon comparison, no round_to tolerance) (S-03)",
    },
    "finding.ASSERTION_DRIFT.v3": {
        "zh": "fact {fact} 在正文断言的数字 {unit} 不在被签的 value/display 里——句子与账的断言漂移（S-03）",
        "en": "fact {fact}: the number asserted in the body, {unit}, is not in the signed value/display — the sentence drifts from the ledger (S-03)",
    },
    "finding.ASSERTION_DRIFT.v4": {
        "zh": "fact {fact} 的定量断言不在活跃正文里（标记缺失或只出现在不会渲染的位置）",
        "en": "the quantitative assertion of fact {fact} is not in the live body (the marker is missing or appears only where it will not be rendered)",
    },
    "finding.ASSERTION_DRIFT.v5": {
        "zh": "fact {fact} 的标记所在句子没有任何数字——定量值不是源文本字面量（计数器/表达式算出来的数无法核对）",
        "en": "the sentence carrying the marker of fact {fact} contains no number — the quantitative value is not a literal in the source text (a number produced by a counter or an expression cannot be checked)",
    },
    "finding.ASSERTION_DRIFT.v6": {
        "zh": "fact {fact} 声明 role={fact1}，但标记只在 \\appendix 之后出现——结论被搬进附录，正文角色对不上（S-03）",
        "en": "fact {fact} declares role={fact1}, but the marker appears only after \\appendix — the conclusion was moved into the appendix, so the body role does not match (S-03)",
    },
    "finding.ASSERTION_DRIFT.v7": {
        "zh": "fact {fact} 的定量断言不在正文跨度里：正文只剩指代，数字落在附录",
        "en": "the quantitative assertion of fact {fact} is not in the body span: only a reference remains in the body, the number falls into the appendix",
    },
    "finding.ASSERTION_DRIFT.v8": {
        "zh": "fact {fact} 的断言指向 {bu_id}，但闭包里没有这个 BU——句子被删/被搬走",
        "en": "the assertion of fact {fact} points to {bu_id}, but that BU is not in the closure — the sentence was deleted or moved",
    },
    "finding.ASSERTION_DRIFT.v9": {
        "zh": "fact {fact} 的断言句子指纹不符（{bu_id} 声明 {claimed}…，现值 {bu}…），且该 BU 里没有 \\fact{{fact1}} 标记——值被搬到别的句子",
        "en": "the assertion sentence fingerprint of fact {fact} does not match ({bu_id} declares {claimed}…, current value {bu}…), and that BU has no \\fact{{fact1}} marker — the value was moved to another sentence",
    },
    "finding.BAD_CONFIDENCE": {
        "zh": "fact {fact} 的 confidence={fact1} 不合法（只允许 high/med/low）",
        "en": "fact {fact}: confidence={fact1} is invalid (only high/med/low allowed)",
    },
    "finding.BAD_DERIVED_FROM": {
        "zh": "fact {fact} 的 derived_from 指向不存在的 id {dep}",
        "en": "fact {fact}: derived_from points to nonexistent id {dep}",
    },
    "finding.BAD_ID_FORMAT.v2": {
        "zh": "fact id {fact} 不合法：{id_hint}",
        "en": "fact id {fact} is invalid: {id_hint}",
    },
    "finding.BAD_ID_FORMAT.v3": {
        "zh": "fact id {fact} 不合法：只允许字母/数字/下划线/点/连字符（SPEC-V3.0 §11.1）",
        "en": "fact id {fact} is invalid: only letters/digits/underscore/dot/hyphen are allowed (SPEC-V3.0 §11.1)",
    },
    "finding.BAD_KIND": {
        "zh": "fact {fact} 的 kind={fact1} 不合法（只允许 claim/config）",
        "en": "fact {fact}: kind={fact1} is invalid (only claim/config allowed)",
    },
    "finding.BAD_SOURCE_PATH": {
        "en": "the source of fact {fact} must be a relative path (no URL, no absolute path, no parent traversal): {src}",
    },
    "finding.BAD_STABLE_ID_FORMAT": {
        "zh": "{key} 的 {name}={value} 格式不合法（不能解析成真实标识）",
        "en": "{key}: {name}={value} has an invalid format (it cannot be parsed into a real identifier)",
    },
    "finding.BAD_SUPERSEDES": {
        "zh": "fact {fact} 的 supersedes 指向不存在的 id {sup}",
        "en": "fact {fact}: supersedes points to nonexistent id {sup}",
    },
    "finding.BIB_FILE_MISSING": {
        "zh": "正文声明的参考文献 {decl} 不存在",
        "en": "the bibliography {decl} declared in the text does not exist",
    },
    "finding.BIB_NO_STABLE_ID.v2": {
        "zh": "bib 条目 {key}（@{entry}）没有 arxiv/doi{arg2}（不可远端复核）",
        "en": "bib entry {key} (@{entry}) has no arxiv/doi{arg2} (cannot be verified remotely)",
    },
    "finding.BIB_NO_STABLE_ID.v3": {
        "zh": "bib 条目 {e} 既没有 arxiv 也没有 doi（不可复核）",
        "en": "bib entry {e} has neither arxiv nor doi (not verifiable)",
    },
    "finding.BINDING_ATTRIBUTION": {
        "zh": "组内第 {utokens} 个数字 {unit} 归 {fact}，但不在它的 value 里——标记组成员按书写顺序一一对应（想真·同值请写 co_claim）",
        "en": "the {utokens}-th number in the group, {unit}, is attributed to {fact}, but is not in its value — the members of a marker group correspond one by one in written order (write co_claim if the values really are the same)",
    },
    "finding.BOUND_MISMATCH.v2": {
        "zh": "该段绑定 {arg0}，但数字 {unit} 不在其 value 里（内联绑定是硬约束）",
        "en": "this segment binds {arg0}, but the number {unit} is not in its value (inline binding is a hard constraint)",
    },
    "finding.BOUND_MISMATCH.v3": {
        "zh": "该行绑定 {arg0}，但数字 {tok} 不在其 value 里（内联绑定是硬约束）",
        "en": "this line binds {arg0}, but the number {tok} is not in its value (inline binding is a hard constraint)",
    },
    "finding.CITE_UNVERIFIED": {
        "zh": "{key} 的 {name}={value} 未能联网核验（{detail}），不判红",
        "en": "{name}={value} of {key} could not be verified online ({detail}); not flagged red",
    },
    "finding.COLLOQUIAL_TRIAD": {
        "zh": "同构三点并列在相邻段落重复：把其中一段的三项改成两项或拆成两句，只留有信息的两项；结构跟着内容走，不改事实。",
        "en": "A parallel three-item list repeats in adjacent paragraphs: change one of them to two items or split it into two sentences, keeping only the two informative items; let the structure follow the content, do not change facts.",
    },
    "finding.COMPUTED_VALUE_UNREGISTERED.command": {
        "zh": "现场计算命令 \\{name} 会生成账上没有的数字且未登记——计算值不可寻址（P-06）",
        "en": "the computed-value command \\{name} produces a number that is not in the ledger and is not registered — a computed value is not addressable (P-06)",
    },
    "finding.COMPUTED_VALUE_UNREGISTERED.number": {
        "zh": "数字 {num} 由现场计算（\\frac/\\numexpr 等）生成且未登记——计算出的值不可寻址（P-06）",
        "en": "the number {num} is produced by an on-the-fly computation (\\frac, \\numexpr and similar) and is not registered — a computed value is not addressable (P-06)",
    },
    "finding.CONNECTIVE_DENSITY": {
        "zh": "删去「{token}」，直接陈述：{clip}",
        "en": "Delete \"{token}\" and state it directly: {clip}",
    },
    "finding.DASH_PARENTHETICAL": {
        "zh": "插入语破折号：按优先级改 ① 去掉「——」，改成逗号从属句；② 改用括号括起；③ 拆成独立一句。三种都不改事实与数字。",
        "en": "Parenthetical dash: fix it in priority order. 1) remove the em dash and make it a comma-delimited subordinate clause; 2) put it in parentheses instead; 3) split it into a standalone sentence. None of the three changes facts or numbers.",
    },
    "finding.DERIVED_CYCLE": {
        "zh": "推算链成环：{arg0}",
        "en": "derivation chain forms a cycle: {arg0}",
    },
    "finding.DISPLAY_INCONSISTENT": {
        "zh": "fact {fact}：display {display} 与 value {value} 不等价（严格 canon 比较，不再有 round_to 容差）",
        "en": "fact {fact}: display {display} is not equivalent to value {value} (strict canon comparison, no round_to tolerance)",
    },
    "finding.DISPLAY_ROUNDTO_INVALID": {
        "zh": "fact {fact}：display {display} 的 round_to={round_to} 必须等于 text 的小数位数 {decimals}",
        "en": "fact {fact}: the round_to of display {display} is {round_to}, but it must equal the number of decimal places in the text ({decimals})",
    },
    "finding.DUPLICATE_BIB_KEY": {
        "zh": "bib 里 key {key} 定义了不止一次",
        "en": "key {key} is defined more than once in the bib",
    },
    "finding.DUPLICATE_ID.v2": {
        "zh": "fact id {fact} 重复（{seen} 与 {fact1}；id 按大小写不敏感判重）",
        "en": "fact id {fact} is duplicated ({seen} and {fact1}; ids are compared case-insensitively)",
    },
    "finding.DUPLICATE_ID.v3": {
        "zh": "fact id {fact} 重复（{seen_ids} 与 {fact1}；id 按大小写不敏感判重）",
        "en": "fact id {fact} is duplicated ({seen_ids} and {fact1}; ids are compared case-insensitively)",
    },
    "finding.DUPLICATE_STABLE_ID": {
        "zh": "{ident} 挂在多个 key 上：{arg1}",
        "en": "{ident} is attached to multiple keys: {arg1}",
    },
    "finding.DUPLICATE_VALUE.v2": {
        "zh": "同一个值（归一后 {key}）挂在 {arg1} 上，claim 却各不相同——像在拿第二张授权票把同一个数重复登记；确属同值的请显式写 dup_ok = true（R-04）",
        "en": "the same value (normalized {key}) is attached to {arg1}, but the claims differ — like using a second authorization ticket to register the same number twice; if it really is the same value, write dup_ok = true explicitly (R-04)",
    },
    "finding.DUPLICATE_VALUE.v3": {
        "zh": "同一个 value={value} 挂在 {arg1} 上——像在拿一份数字白名单充事实账",
        "en": "the same value={value} is attached to {arg1} — like passing off a numeric whitelist as the fact ledger",
    },
    "finding.EMPTY_ADJECTIVE": {
        "zh": "删掉「{phrase}」这个标签，改成可核验的事实（例：'This step is {token}' → 'This step raises resolved instances from 5 to 10'）",
        "en": "Delete the \"{phrase}\" label and turn it into a verifiable fact (e.g. 'This step is {token}' -> 'This step raises resolved instances from 5 to 10')",
    },
    "finding.EMPTY_VALUE": {
        "zh": "fact {fact} 的 value 为空（账上没有数）",
        "en": "fact {fact}: value is empty (no number in the ledger)",
    },
    "finding.EVIDENCE_CHAIN_BROKEN.v10": {
        "zh": "fact {fact} 的回执 source={rec_src} 与 fact.source={src} 不符",
        "en": "fact {fact}: the receipt source={rec_src} does not match fact.source={src}",
    },
    "finding.EVIDENCE_CHAIN_BROKEN.v11": {
        "zh": "fact {fact} 的回执 source_sha256 与磁盘现算不符",
        "en": "fact {fact}: the receipt source_sha256 does not match the value recomputed from disk",
    },
    "finding.EVIDENCE_CHAIN_BROKEN.v12": {
        "zh": "回执 {rel_to_root} 指向账上不存在的 fact id {raw_id}",
        "en": "receipt {rel_to_root} points to fact id {raw_id}, which does not exist in the ledger",
    },
    "finding.EVIDENCE_CHAIN_BROKEN.v2": {
        "zh": "fact {fact} 没有 source/observation——证据链第 1 节（事实→运行记录）断开",
        "en": "fact {fact} has no source/observation — section 1 of the evidence chain (fact → run record) is broken",
    },
    "finding.EVIDENCE_CHAIN_BROKEN.v3": {
        "zh": "fact {fact} 缺 source_sha256——证据链第 2 节（运行记录→内容锚）断开",
        "en": "fact {fact} lacks source_sha256 — section 2 of the evidence chain (run record → content anchor) is broken",
    },
    "finding.EVIDENCE_CHAIN_BROKEN.v4": {
        "zh": "fact {fact} 缺回执 {rel_to_root}——证据链第 3 节（运行记录→回执）断开",
        "en": "fact {fact} lacks the receipt {rel_to_root} — section 3 of the evidence chain (run record → receipt) is broken",
    },
    "finding.EVIDENCE_CHAIN_BROKEN.v5": {
        "zh": "fact {fact} 的回执 {rel_to_root} 不可读或不是 JSON",
        "en": "fact {fact}: the receipt {rel_to_root} is unreadable or is not JSON",
    },
    "finding.EVIDENCE_CHAIN_BROKEN.v6": {
        "zh": "fact {fact} 的回执不是对象",
        "en": "fact {fact}: the receipt is not an object",
    },
    "finding.EVIDENCE_CHAIN_BROKEN.v7": {
        "zh": "fact {fact} 的回执 run_id={rec} 与运行目录 {run_id} 不符",
        "en": "fact {fact}: the receipt run_id={rec} does not match the run directory {run_id}",
    },
    "finding.EVIDENCE_CHAIN_BROKEN.v8": {
        "zh": "fact {fact} 的回执缺 facts[]——无法证明回执指向哪条事实",
        "en": "fact {fact}: the receipt lacks facts[] — it cannot prove which fact the receipt points to",
    },
    "finding.EVIDENCE_CHAIN_BROKEN.v9": {
        "zh": "fact {fact} 不在回执 facts[] 里（回执没有指向这条事实）",
        "en": "fact {fact} is not in the receipt's facts[] (the receipt does not point to this fact)",
    },
    "finding.EVIDENCE_SET_CHANGED": {
        "en": "the [evidence] list no longer matches the frozen copy (current {current}, frozen {frozen}) — editing the manifest is allowed, but it must be frozen again and committed so the difference stays in the version record",
    },
    "finding.EVIDENCE_UNFROZEN": {
        "en": "the [evidence] list is in the unfrozen state (the last entry of {log} is an unfreeze) — after editing the manifest, freeze it again with `evidence --freeze --reason \"...\"` so the difference stays in the version record",
    },
    "finding.EXPLAINER_DENSITY": {
        "zh": "句首「{token}」是解释性套语：先删掉它，让断言自己站住（例：'{clip}'）；证据只在真正需要它的那一处出现一次。",
        "en": "The sentence-initial \"{token}\" is an explanatory formula: delete it first and let the assertion stand on its own (e.g. '{clip}'); evidence appears once, only where it is really needed.",
    },
    "finding.EXPR_INVALID": {
        "zh": "fact {fact} 的 expr 不可用：{detail}",
        "en": "fact {fact}: expr is unusable: {detail}",
    },
    "finding.EXPR_MISMATCH": {
        "zh": "fact {fact} 的 expr={fact1} 算出 {got}，与 value={value}（{want}）不符：误差 {detail} 超过容差 {limit}",
        "en": "fact {fact}: expr={fact1} evaluates to {got}, which does not match value={value} ({want}): error {detail} exceeds tolerance {limit}",
    },
    "finding.FACT_OUT_OF_SPAN": {
        "zh": "fact {fact} 声明 role={fact1}，但标记只在 \\appendix 之后出现——事实落在正文跨度之外（R-03）",
        "en": "fact {fact} declares role={fact1}, but the marker appears only after \\appendix — the fact falls outside the body span (R-03)",
    },
    "finding.FACT_UNUSED_IN_SPAN": {
        "zh": "fact {fact} 的 \\fact{} 标记留在正文，但正文这一句没有任何数字承载 value={value}（只剩指代）——定量断言不在正文跨度里，数字只出现在 \\appendix 之后（R-03）",
        "en": "the \\fact{} marker of fact {fact} stays in the body, but no number in that sentence carries value={value} (only a reference remains) — the quantitative assertion is not in the body span; the number appears only after \\appendix (R-03)",
    },
    "finding.FIGURE_UNVERIFIED": {
        "zh": "图 {path} 没有随图数据（.csv），图里的数字不在本闸门覆盖范围内",
        "en": "figure {path} has no accompanying data (.csv); its numbers are outside this gate's coverage",
    },
    "finding.FSIGNORE_QUANT": {
        "zh": "\\fsignore 参数里出现定量（{hits}）——豁免宏不得用来抹掉结论句：{arg}",
        "en": "quantitative content appears in \\fsignore arguments ({hits}) — the exemption macro must not be used to erase conclusion sentences: {arg}",
    },
    "finding.HEADING_ECHO": {
        "zh": "首句只是复述标题；改成一句定义或可检验的断言（例：预注册是在收集数据前固定假设与分析计划的做法）。复述标题、垫话（「相关工作里，」）与设问都不算定义。",
        "en": "The first sentence only repeats the heading; replace it with a definition or a testable assertion (e.g. pre-registration is the practice of fixing hypotheses and the analysis plan before data collection). Repeating the heading, filler openers (\"In related work,\") and rhetorical questions do not count as a definition.",
    },
    "finding.HEADING_RELATION_CHANGED": {
        "zh": "标题里的对立关系词被删除或替换了（旧：{arg0}；新：{arg1}）。关系词承载论证方向，替换或删除前先确认结论没变；要改就连正文一起改。",
        "en": "A contrastive relation word in the heading was deleted or replaced (old: {arg0}; new: {arg1}). Relation words carry the direction of the argument: confirm that the conclusion is unchanged before replacing or deleting one; if you change it, change the body with it.",
    },
    "finding.HEADING_SUBJECT_LOST": {
        "zh": "旧标题的实义成分在新标题与新首句里都消失了（{arg0}）：要么写回新标题，要么在新首句里交代它去了哪里。",
        "en": "A substantive component of the old heading disappeared from both the new heading and the new first sentence ({arg0}): either write it back into the new heading, or state in the new first sentence where it went.",
    },
    "finding.HEADING_SUBSTITUTED": {
        "zh": "标题只是把冒号换成了{kind}「{token}」，没有重写（旧：「{clip}」；新：「{clip1}」）。两截结构没变，不算改写：删掉类别词，重写成能独立指路的名词短语，正文事实不动。",
        "en": "The heading only swapped the colon for {kind} \"{token}\" and did not rewrite (old: \"{clip}\"; new: \"{clip1}\"). The two-part structure is unchanged, so this is not a rewrite: delete the category word and rewrite it as a noun phrase that points the way on its own; do not change the body facts.",
    },
    "finding.HEADING_TOO_LONG": {
        "zh": "标题压到 {limit_txt} 以内：把副标题或解释移到正文首句，标题只留名词短语；不改正文事实。",
        "en": "Compress the heading to within {limit_txt}: move the subtitle or explanation into the first sentence of the body and keep only the noun phrase in the heading; do not change the body facts.",
    },
    "finding.HEDGE_STACK": {
        "zh": "双重限定叠在一起：把「{token}」减成一层「{short}」；能给出证据就删掉限定",
        "en": "Two qualifiers are stacked: reduce \"{token}\" to a single \"{short}\"; if you can supply evidence, drop the qualifier.",
    },
    "finding.INPUT_DYNAMIC": {
        "zh": "\\input/\\include 目标 {ref} 含宏、#、嵌套花括号或为空（{src_rel}:{line}）——无法静态解析，审计覆盖不了这一段（R-05）",
        "en": "\\input/\\include target {ref} contains macros, #, nested braces, or is empty ({src_rel}:{line}) — it cannot be resolved statically, so the audit cannot cover this part (R-05)",
    },
    "finding.FACT_FILE_OUTSIDE_PROJECT": {
        "zh": "事实账文件 {rel} 是指向项目外的软链（真实目标 {target}）——账本不收它，这些事实没进审计（信任根被突破）",
        "en": "ledger file {rel} is a symlink pointing outside the project (real target {target}) — the ledger does not accept it, so those facts never entered the audit (the trust root is broken)",
    },
    "finding.FACT_FILE_UNRESOLVED": {
        "zh": "事实账文件 {rel} 的软链不可解（{why}）——账本不收它，这些事实没进审计",
        "en": "the symlink of ledger file {rel} cannot be resolved ({why}) — the ledger does not accept it, so those facts never entered the audit",
    },
    "finding.INPUT_OUTSIDE_PROJECT": {
        "zh": "\\input 目标 {ref} 越出项目根（{src_rel}:{line}）——闭包不收它，这一段可能整体没进审计（R-05）",
        "en": "\\input target {ref} is outside the project root ({src_rel}:{line}) — the closure does not accept it, so this part may not have entered the audit at all (R-05)",
    },
    "finding.INPUT_OUTSIDE_PROJECT.start": {
        "zh": "闭包起点 {src_rel} 是软链，越出项目根（目标 {ref}）——闭包不收它，这一段可能整体没进审计（R-05）",
        "en": "closure start {src_rel} is a symlink pointing outside the project root (target {ref}) — the closure does not accept it, so this part may not have entered the audit at all (R-05)",
    },
    "finding.INPUT_TARGET_MISSING": {
        "zh": "\\input 目标 {ref} 不存在（{src_rel}:{line}）——闭包展开失败，这一段可能整体没进审计（R-05）",
        "en": "\\input target {ref} does not exist ({src_rel}:{line}) — closure expansion failed, so this part may not have entered the audit at all (R-05)",
    },
    "finding.JUSTIFY_CHAIN.v2": {
        "zh": "同一段有 {arg0} 句以解释套语开头：留一句解释就够，其余删掉；让断言自己站住，不要每句都补一个理由。",
        "en": "{arg0} sentences in the same paragraph start with an explanatory formula: one explanation is enough, delete the rest; let the assertion stand on its own, do not attach a reason to every sentence.",
    },
    "finding.JUSTIFY_CHAIN.v3": {
        "zh": "连续 {run} 段都用解释句收尾：删掉最后一段的解释句，让段落停在事实或结论上；解释只在读者会误解的地方出现一次。",
        "en": "{run} consecutive paragraphs all end with an explanatory sentence: delete the explanatory sentence of the last paragraph and let the paragraph stop on a fact or a conclusion; explanation appears once, only where a reader would misread.",
    },
    "finding.KEY_REVOKED.v2": {
        "zh": "签名 key {key_id} 已吊销",
        "en": "the signing key {key_id} has been revoked",
    },
    "finding.KEY_REVOKED.v3": {
        "zh": "审批 key {key_id} 已吊销（{loc}）",
        "en": "approval key {key_id} has been revoked ({loc})",
    },
    "finding.KEY_UNREGISTERED.v2": {
        "zh": "signer_key_id {key_id} 不在公钥登记里",
        "en": "signer_key_id {key_id} is not in the public key registry",
    },
    "finding.KEY_UNREGISTERED.v3": {
        "zh": "审批目标 {loc} 的 key_id={key_id} 不在项目外公钥登记里",
        "en": "key_id={key_id} of approval target {loc} is not in the out-of-project public key registry",
    },
    "finding.LEDGER_CONFLICT": {
        "zh": "账本自相矛盾（黄）：同一 claim/metric 有不同 value 且没有被 supersedes：{detail}",
        "en": "the ledger contradicts itself (yellow): the same claim/metric carries different values with no supersedes record ({detail})",
    },
    "finding.LIGHT_VERB_NOMINALIZATION": {
        "zh": "「{norm_space}」是轻动词＋名义化：动词是空的，动作藏在名词里。{hint}",
        "en": "\"{norm_space}\" is a light verb plus nominalization: the verb is empty and the action is hidden in the noun. {hint}",
    },
    "finding.LOW_BINDING_RATE": {
        "zh": "内联绑定率 {bound}/{denom} 低于 50%——大部分数字只是「回得到账」，还没回到对的那条账",
        "en": "inline binding rate {bound}/{denom} is below 50% — most numbers only reach the ledger, not the right ledger entry",
    },
    "finding.MANIFEST_HASH_MISMATCH": {
        "zh": "清单里 {src} 的 sha256 与文件现值不符——签过之后被改过",
        "en": "the sha256 of {src} in the manifest does not match the file's current value — it was modified after signing",
    },
    "finding.MANIFEST_INVALID": {
        "en": "the human-signed manifest could not be parsed",
    },
    "finding.MANIFEST_NO_FILES": {
        "zh": "清单 {cfg} 没有 [files] 段",
        "en": "manifest {cfg} has no [files] section",
    },
    "finding.MANIFEST_NO_TIMESTAMP": {
        "zh": "清单 {cfg} 缺 signed_at（签的时间点）",
        "en": "manifest {cfg} lacks signed_at (the signing time)",
    },
    "finding.MANIFEST_UNSIGNED": {
        "zh": "清单 {cfg} 没有 signed_by——没人签的清单不算锚",
        "en": "manifest {cfg} has no signed_by — an unsigned manifest is not an anchor",
    },
    "finding.MISSING_CITE": {
        "zh": "引用了 bib 里不存在的 key {key}",
        "en": "cited key {key}, which does not exist in the bib",
    },
    "finding.MISSING_EXPR": {
        "zh": "fact {fact} 是推算值，但没写 expr——只写 derived_from 不算可复核",
        "en": "fact {fact} is a derived value but has no expr — derived_from alone is not checkable",
    },
    "finding.MISSING_SOURCE": {
        "zh": "fact {fact} 的 source 不存在或不是普通文件：{src}",
        "en": "fact {fact}: source does not exist or is not a regular file: {src}",
    },
    "finding.MISSING_SOURCE_FIELD": {
        "zh": "fact {fact} 缺 source 字段",
        "en": "fact {fact} lacks the source field",
    },
    "finding.MISSING_SOURCE_SHA256": {
        "zh": "fact {fact} 缺 source_sha256——没有内容锚定，账就无法证明「从签过那刻起没被改」",
        "en": "fact {fact} lacks source_sha256 — without a content anchor the ledger cannot prove it has not changed since it was signed",
    },
    "finding.NOMINALIZATION_RATE": {
        "zh": "名词化密度 {rate}/百词（阈值 {arg1}）：名词化把动作压成了名词。{fix}。已剥离本文高频术语（前 {strip_top} 个）：{listed}。",
        "en": "Nominalization density {rate} per 100 words (threshold {arg1}): nominalization compresses actions into nouns. {fix}. High-frequency terms of this document are already stripped (top {strip_top}): {listed}.",
    },
    "finding.NONQUANT_BACKS_QUANT": {
        "zh": "只有机制陈述（{arg0}）来背数字 {unit}——非定量 fact 不能授权定量断言",
        "en": "only a mechanism statement ({arg0}) backs the number {unit} — a non-quantitative fact cannot authorize a quantitative claim",
    },
    "finding.NO_MANIFEST": {
        "zh": "缺人签清单 {cfg}：工具只能证明「账与正文自洽」，不能证明 results/ 当初没被编",
        "en": "missing human-signed manifest {cfg}: the tool can only prove the ledger and the text agree, not that results/ was not made up in the first place",
    },
    "finding.NUMBER_AS_CROSSREF": {
        "zh": "数字 {num} 是手写的结构编号（Table/Figure 等），不是数据，也不能替代 \\ref 的稳定标识",
        "en": "the number {num} is a hand-written structural label (Table, Figure and the like), not data, and it cannot stand in for the stable identifier of \\ref",
    },
    "finding.NUMERAL_DENSITY.v2": {
        "zh": "--stage revision：本条只报告、不要求删数字。改稿阶段数字受 PROTECT_NUMBER_CHANGED 保护，删数字会被保护面判红；起草阶段（--stage draft）才用 thin-the-numbers。",
        "en": "--stage revision: this finding only reports and does not ask you to delete numbers. In the revision stage numbers are protected by PROTECT_NUMBER_CHANGED, so deleting a number turns the protection surface red; thin-the-numbers applies only in the drafting stage (--stage draft).",
    },
    "finding.NUMERAL_DENSITY.v3": {
        "zh": "数字太密：每个论点只留一条证据，其余数字删掉或改成定性说法（多数/少量/接近）。本条只用于起草阶段；进入改写验收前加 --stage revision，避免与 PROTECT_NUMBER_CHANGED 冲突。",
        "en": "Numbers are too dense: keep one piece of evidence per argument, delete the other numbers or turn them into qualitative statements (most / few / close to). This finding is for the drafting stage only; add --stage revision before rewrite acceptance, to avoid a conflict with PROTECT_NUMBER_CHANGED.",
    },
    "finding.NUMERIC_IN_MACRO": {
        "zh": "宏 \\{name} 的定义体携带数字（{digit}）——宏可以携带 fact id，不可以携带数字（R-01A-B；确属布局宏请进 project.numeric_macro_allow 人签登记）",
        "en": "macro \\{name} carries a number in its body ({digit}) — a macro may carry a fact id, not a number (R-01A-B; if it really is a layout macro, register it in project.numeric_macro_allow with a human signature)",
    },
    "finding.NUMERIC_MACRO_DOUBLE_SIGN": {
        "zh": "{label} 的双签没有两个不同的 key（signed_by={signers}）——数值宏必须双 key 签署（S-08）",
        "en": "the double signature of {label} does not have two distinct keys (signed_by={signers}) — numeric macros must be signed by two keys (S-08)",
    },
    "finding.NUMERIC_MACRO_EXPIRED": {
        "zh": "{label} 已于 {expires} 过期——过期登记不放行（S-08）",
        "en": "{label} expired on {expires} — an expired registration is not accepted (S-08)",
    },
    "finding.NUMERIC_MACRO_SHAPE_INVALID.v2": {
        "zh": "{label} 的形状不合法：parameter_kind={kind}，body_regex={body}——只允许逐字等于内置长度/宽度/计数模板（S-08）",
        "en": "{label} has an invalid shape: parameter_kind={kind}, body_regex={body} — only verbatim equality with the built-in length/width/count templates is allowed (S-08)",
    },
    "finding.NUMERIC_MACRO_SHAPE_INVALID.v3": {
        "zh": "{label} 声明 parameter_kind=count，但宏名不以 {arg1} 结尾——计数宏只允许这一族名字（S-08）",
        "en": "{label} declares parameter_kind=count, but the macro name does not end with {arg1} — count macros are restricted to this family of names (S-08)",
    },
    "finding.NUM_ADJACENT_GROUP": {
        "zh": "空组 {} 把两个数字粘在一起（{num}）——渲染出的数字必须由连续字面数字构成",
        "en": "an empty group {} glues two numbers together ({num}) — a rendered number must consist of consecutive literal digits",
    },
    "finding.NUM_ADJACENT_MACRO.left": {
        "zh": "数字紧贴宏 \\{macro}（{num}）——渲染出的数字必须由连续字面数字构成",
        "en": "the number {num} is glued to the macro \\{macro} — a rendered number must consist of consecutive literal digits",
    },
    "finding.NUM_ADJACENT_MACRO.right": {
        "zh": "宏 \\{macro} 紧跟数字（{num}）——渲染出的数字必须由连续字面数字构成",
        "en": "the macro \\{macro} is glued to the number {num} — a rendered number must consist of consecutive literal digits",
    },
    "finding.NUM_AFTER_GROUP": {
        "zh": "数字紧跟一个闭合组（{num}）——渲染出的数字必须由连续字面数字构成",
        "en": "the number {num} immediately follows a closed group — a rendered number must consist of consecutive literal digits",
    },
    "finding.PARAGRAPH_TEMPLATE": {
        "zh": "段末不要用套话收尾：删掉句首的「Therefore/Overall/Thus」等，让最后一句停在具体证据上（例：'Therefore, X is better' → 'X resolved 10 of 16 instances'）",
        "en": "Do not close a paragraph with a formula: delete the sentence-initial \"Therefore/Overall/Thus\" and let the last sentence stop on concrete evidence (e.g. 'Therefore, X is better' -> 'X resolved 10 of 16 instances')",
    },
    "finding.PDF_LEDGER_TOKEN_MISSING": {
        "zh": "账上数字 key={key} 出现 {expected} 次，PDF 只有 {actual} 次——ledger ⊆ PDF 不成立（P-04）",
        "en": "the ledger number key={key} appears {expected} times, but the PDF has only {actual} - ledger ⊆ PDF does not hold (P-04)",
    },
    "finding.PDF_PAGE_IMAGE_DOMINANT": {
        "zh": "第 {page_no} 页图片覆盖面积 {arg1}%（文本 {chars} 字符）——请人工确认没有把数字烧进图里",
        "en": "page {page_no} has an image coverage of {arg1}% ({chars} characters of text) - check by hand that no numbers were burned into the image",
    },
    "finding.PDF_PAGE_NO_TEXT": {
        "zh": "第 {page} 页可抽取文本只有 {chars} 个非空白字符（<20）——整页图必须带 caption，空白页必须删除（P-02）",
        "en": "page {page} has only {chars} non-whitespace characters of extractable text (<20) - a full-page image must carry a caption, and a blank page must be deleted (P-02)",
    },
    "finding.PDF_PAGE_RASTERIZED": {
        "zh": "第 {page_no} 页图片覆盖面积 {arg1}%，文本层仅 {chars} 字符——正文被整页栅格化（P-03）",
        "en": "page {page_no} has an image coverage of {arg1}% and only {chars} characters in the text layer - the body text is fully rasterized (P-03)",
    },
    "finding.PDF_STALE": {
        "zh": "PDF 比源文件旧，先重编：{newest_path} 比 {pdf} 新——旧 PDF 可以当答案提示，过期时它的数字不参与比对；请跑 `--build` 或手动重编后再审（P-01S）",
        "en": "PDF is older than the source files; rebuild first: {newest_path} is newer than {pdf} - the old PDF can serve as an answer hint, but while stale its numbers do not take part in the comparison; run `--build` or rebuild by hand, then audit again (P-01S)",
    },
    "finding.PDF_TOOL_MISSING.v2": {
        "zh": "pdftotext/pdfinfo 解析失败：{detail}",
        "en": "pdftotext/pdfinfo parsing failed: {detail}",
    },
    "finding.PDF_TOOL_MISSING.v3": {
        "zh": "缺 PDF 工具链：{arg0}——不许静默放行；装上 poppler 后重跑",
        "en": "the PDF toolchain is missing: {arg0} - no silent pass; install poppler and rerun",
    },
    "finding.PDF_UNACCOUNTED_NUMBER": {
        "zh": "PDF 里数字 key={key} 出现 {actual} 次，允许集只有 {allowed} 次——账外数字（P-05）",
        "en": "in the PDF the number key={key} appears {actual} times, but the allowed set has only {allowed} - an off-ledger number (P-05)",
    },
    "finding.PDF_WHITELIST_UNPROVENANCED.v2": {
        "zh": "pdf_whitelist 条目不是对象：{item}",
        "en": "the pdf_whitelist entry is not an object: {item}",
    },
    "finding.PDF_WHITELIST_UNPROVENANCED.v3": {
        "zh": "白名单条目缺 key/count/source：{item}（人签声明必须可追溯）",
        "en": "the whitelist entry is missing key/count/source: {item} (a human-signed declaration must be traceable)",
    },
    "finding.PDF_WHITELIST_UNUSED": {
        "zh": "白名单声明了 key={key}（{count} 次）但 PDF 里没出现",
        "en": "the whitelist declares key={key} ({count} times) but it does not appear in the PDF",
    },
    "finding.REPEATED_OPENER": {
        "zh": "本段与上一段（第 {prev_line} 行）都以「{info}」开头：把本段首句改成以研究对象开头（例：'We use X to ...' → 'X is used to ...'）",
        "en": "This paragraph and the previous one (line {prev_line}) both start with \"{info}\": rewrite the first sentence of this paragraph to start with the object of study (e.g. 'We use X to ...' -> 'X is used to ...')",
    },
    "finding.REPORT_METRIC_MISMATCH": {
        "zh": "fact {fact} 的值 {value} 与报告指标 {mid} 的显示值 {metric} 对不上",
        "en": "the value {value} of fact {fact} does not match the display value {metric} of report metric {mid}",
    },
    "finding.REPORT_METRIC_MISSING.v2": {
        "zh": "fact {fact} 指向的报告 {rel} 读不了：{loaded}",
        "en": "the report {rel} that fact {fact} points to cannot be read: {loaded}",
    },
    "finding.REPORT_METRIC_MISSING.v3": {
        "zh": "fact {fact} 指向的指标 {mid} 不在报告 {rel} 里",
        "en": "the metric {mid} that fact {fact} points to is not in the report {rel}",
    },
    "finding.REPORT_MISSING": {
        "zh": "fact {fact} 指向的报告 {rel} 找不到（相对工作区的路径）",
        "en": "the report {rel} that fact {fact} points to cannot be found (path relative to the workspace)",
    },
    "finding.REPORT_NOT_SIGNED": {
        "zh": "fact {fact} 指向的报告 {rel} 没签收或签收已失效：{verified}",
        "en": "the report {rel} that fact {fact} points to is not signed off, or the sign-off has expired: {verified}",
    },
    "finding.REPORT_SCHEMA_INVALID.v2": {
        "zh": "读不了 report：{detail}",
        "en": "the report cannot be read: {detail}",
    },
    "finding.REPORT_SCHEMA_INVALID.v3": {
        "zh": "audit/report.json 不是合法 JSON",
        "en": "audit/report.json is not valid JSON",
    },
    "finding.REPORT_SOURCE_MISMATCH": {
        "zh": "fact {fact} 的来源 {fact1} 不是报告指标 {mid} 的任何来源",
        "en": "the source {fact1} of fact {fact} is not any source of report metric {mid}",
    },
    "finding.REPORT_STALE": {
        "zh": "report.inputs 里的 {rel} 已被改动（审后改源）",
        "en": "{rel} in report.inputs has been modified (source changed after the review)",
    },
    "finding.RESOLVE_DEGRADED": {
        "zh": "联网核验 {bad}/{arg1} 条都没成功（限流/无网？）——引用存在性本轮等于没验",
        "en": "online verification failed for {bad}/{arg1} entries (rate limit/no network?) — citation existence is effectively unverified this round",
    },
    "finding.RHYTHM_PLATEAU": {
        "zh": "{where}连续 {arg1} 句长度都在 {arg2}–{arg3} {unit}：节奏成了平台，在其中插入一句 8–15 {unit1}的短句，或把相邻两句合并，让长短有起伏；内容与结构不动",
        "en": "At {where}, {arg1} consecutive sentences are all {arg2}-{arg3} {unit} long: the rhythm has become a plateau. Insert one short sentence of 8-15 {unit1} among them, or merge two adjacent sentences, so that long and short alternate; leave content and structure unchanged.",
    },
    "finding.SECTION_LENGTH": {
        "zh": "按顺序压：先删重复引用的数字，再删举例，最后合并同义句。禁做：不删论点、不删每个论点的最后一条证据、不把句子改短来凑数（拆成短句但词数没降，不算改完）。",
        "en": "Cut in this order: first delete numbers cited more than once, then delete examples, finally merge synonymous sentences. Forbidden: deleting arguments, deleting the last piece of evidence for any argument, and rewriting sentences shorter just to hit the count (splitting into short sentences without reducing the word count does not count as done).",
    },
    "finding.SECTION_OVERLAP": {
        "zh": "把重复段落并进被引用的那一节，或删掉本节的重复句，只保留本节独有的结论；数字、事实与引用一条都不许丢。",
        "en": "Merge the duplicated paragraph into the section it is cited in, or delete the repeated sentences here and keep only the conclusion that is unique to this section; not one number, fact or citation may be lost.",
    },
    "finding.SENTENCE_LENGTH_EXTREME": {
        "zh": "这句 {units} 词超过 {limit}，且句内没有从句/分号/破折号/括号断点：这一句又长又平铺，保留原有结构，考虑在语义边界换气（例：{clip}）；长而有结构的句子不必改，也不要整段拆短",
        "en": "This sentence has {units} words, over {limit}, and has no clause, semicolon, dash or parenthesis break inside: it is long and flat. Keep the existing structure and consider taking a breath at a semantic boundary (e.g. {clip}); long but structured sentences need no change, and do not split the whole paragraph into shorter ones.",
    },
    "finding.SENTENCE_UNIFORMITY": {
        "zh": "句长太整齐（CV={uniformity}，低于健康下界 {thresholds}）：交替长短句，插入一句 8–15 词的短句，或把相邻短句合并；最短句在 {short}:{line_of}（{short1} 词），最长句在 {long}:{line_of1}（{long1} 词）",
        "en": "Sentence lengths are too uniform (CV={uniformity}, below the healthy lower bound {thresholds}): alternate long and short sentences, insert one short sentence of 8-15 words, or merge adjacent short sentences; the shortest sentence is at {short}:{line_of} ({short1} words), the longest at {long}:{line_of1} ({long1} words)",
    },
    "finding.SOURCE_NOT_SIGNED": {
        "zh": "fact {fact} 的 source {src} 不在人签清单里——没人确认过它",
        "en": "fact {fact}: source {src} is not in the human-signed manifest — nobody confirmed it",
    },
    "finding.SOURCE_OUTSIDE_RESULTS": {
        "zh": "fact {fact} 的 source 不在 {dir}/ 下（{src}）——原始产物必须由人签清单/审批目标锁死；跨目录请配 source_root",
        "en": "the source of fact {fact} is not under {dir}/ ({src}) — raw artifacts must be pinned by a human-signed manifest or an approval target; configure source_root for cross-directory sources",
    },
    "finding.SOURCE_OUTSIDE_RUNS": {
        "zh": "fact {fact} 的 source 不在 {dir}/ 下（{src}）——原始产物必须由人签清单/审批目标锁死；跨目录请配 source_root",
        "en": "the source of fact {fact} is not under {dir}/ ({src}) — raw artifacts must be pinned by a human-signed manifest or an approval target; configure source_root for cross-directory sources",
    },
    "finding.SOURCE_OUTSIDE_SOURCE_ROOT": {
        "zh": "fact {fact} 的 source 越出 source_root（{base}）：{src}",
        "en": "fact {fact}: source escapes source_root ({base}): {src}",
    },
    "finding.SOURCE_SHA256_MISMATCH": {
        "zh": "fact {fact} 的 source_sha256 与现算不符（声明 {fact1}…，实际 {digest}…）——产物被改过",
        "en": "fact {fact}: source_sha256 does not match the recomputed value (declared {fact1}…, actual {digest}…) — the artifact was modified",
    },
    "finding.STAMP_KEY_UNTRUSTED.v2": {
        "zh": "可信公钥文件位于项目根内部（{keys_resolved}）——项目内公钥＝自签自验，不是信任根",
        "en": "the trusted public key file is inside the project root ({keys_resolved}) - a public key inside the project means self-signed and self-verified, not a trust root",
    },
    "finding.STAMP_KEY_UNTRUSTED.v3": {
        "zh": "有 stamp 但没提供公钥登记文件",
        "en": "there is a stamp but no public key registry file was provided",
    },
    "finding.STAMP_KEY_UNTRUSTED.v4": {
        "zh": "{label} 指向项目根内部的公钥文件（{raw}）——项目内公钥＝自签自验，不是项目外信任根（§2.4 / P-08）",
        "en": "{label} points to a public key file inside the project root ({raw}) — an in-project public key means self-signed and self-verified, not an out-of-project trust root (§2.4 / P-08)",
    },
    "finding.STAMP_MISSING": {
        "zh": "stamp/公钥文件读不了：{detail}",
        "en": "the stamp / public key file cannot be read: {detail}",
    },
    "finding.STAMP_PDF_MISMATCH": {
        "zh": "PDF 字节与 stamp 记录不符（磁盘 {pdf_sha}…，stamp {strip_sha}…）——重存/换件都算过期",
        "en": "the PDF bytes do not match the stamp record (on disk {pdf_sha}..., stamp {strip_sha}...) - re-saving or swapping the file also counts as stale",
    },
    "finding.STAMP_REPORT_MISMATCH.v2": {
        "zh": "stamp 缺 payload 对象",
        "en": "the stamp has no payload object",
    },
    "finding.STAMP_REPORT_MISMATCH.v3": {
        "zh": "stamp schema 必须是 factscribe-stamp/3.0，实际 {schema}",
        "en": "the stamp schema must be factscribe-stamp/3.0, actual {schema}",
    },
    "finding.STAMP_REPORT_MISMATCH.v4": {
        "zh": "report 指纹与 stamp 不符（盘上报告不是被签的那一份）",
        "en": "the report digest does not match the stamp (the report on disk is not the signed one)",
    },
    "finding.STAMP_REPORT_MISMATCH.v5": {
        "zh": "{name} 与 stamp 不符：report={actual} stamp={expected}",
        "en": "{name} does not match the stamp: report={actual} stamp={expected}",
    },
    "finding.STAMP_REPORT_MISMATCH.v6": {
        "zh": "被签 report 的 verdict/level 不是 PASS/L2（实际 {report}/{report1}）",
        "en": "the verdict/level of the signed report is not PASS/L2 (actual {report}/{report1})",
    },
    "finding.STAMP_REPORT_MISMATCH.v7": {
        "zh": "report_sha256 与报告内容不符——报告被改过",
        "en": "report_sha256 does not match the report content — the report was modified",
    },
    "finding.STAMP_SIGNATURE_INVALID.v2": {
        "zh": "公钥/签名不是合法 base64",
        "en": "the public key / signature is not valid base64",
    },
    "finding.STAMP_SIGNATURE_INVALID.v3": {
        "zh": "ed25519 验签失败——签名体必须等于 JCS(stamp.payload)",
        "en": "ed25519 signature verification failed - the signed body must equal JCS(stamp.payload)",
    },
    "finding.STAMP_TIME_INVALID.v2": {
        "zh": "stamp.signed_at 不是带时区的 ISO-8601",
        "en": "stamp.signed_at is not a timezone-aware ISO-8601 timestamp",
    },
    "finding.STAMP_TIME_INVALID.v3": {
        "zh": "signed_at 早于 report.generated_at 超过 5 分钟",
        "en": "signed_at is more than 5 minutes earlier than report.generated_at",
    },
    "finding.STAMP_TIME_INVALID.v4": {
        "zh": "signed_at 在未来超过 10 分钟",
        "en": "signed_at is more than 10 minutes in the future",
    },
    "finding.SUPERSEDED_PARENT": {
        "zh": "fact {fact} 从已被 supersedes 的 {dep} 推算——父值已作废",
        "en": "fact {fact} is derived from {dep}, which has already been superseded — the parent value is void",
    },
    "finding.TABLE_UNBOUND": {
        "zh": "表格 cell 里的数字 {unit} 回不到任何 fact.value——表格必须进扫描闭包并带 cell→fact 映射（R-06）",
        "en": "the number {unit} in the table cell traces back to no fact.value — the table must enter the scan closure and carry a cell→fact mapping (R-06)",
    },
    "finding.TERM_FIRST_IN_HEADING": {
        "zh": "标题里的「{cand}」第一次出现时，请在该节首句用一句话定义或点明它是什么（例：预注册是在收集数据前固定假设与分析计划的做法）；复述标题、垫话（如「相关工作里，」）与设问都不算定义。可在 term-allow.txt 登记白名单，只改措辞，不改事实。",
        "en": "When \"{cand}\" first appears in a heading, define it or state what it is in one sentence in the first sentence of that section (e.g. pre-registration is the practice of fixing hypotheses and the analysis plan before data collection); repeating the heading, filler openers (such as \"In related work,\") and rhetorical questions do not count as a definition. You can register a whitelist in term-allow.txt; change wording only, not facts.",
    },
    "finding.TERM_UNREGISTERED": {
        "zh": "「{cand}」不在术语表内：建议登记到 paper.tsv，或换用已登记的规范形。本条只提示，不进 findings 计数、不影响退出码。",
        "en": "\"{cand}\" is not in the glossary: register it in paper.tsv, or use an already registered canonical form. Informational only: it does not count toward the findings count and does not affect the exit code.",
    },
    "finding.TERM_VARIANT.v2": {
        "zh": "术语表声明的禁用变体出现了：{arg0}；正名是「{canonical}」。只把这个写法改回正名，不改事实、数字与引用。",
        "en": "A forbidden variant declared by the glossary appeared: {arg0}; the canonical name is \"{canonical}\". Rewrite only this surface form back to the canonical name; do not change facts, numbers or citations.",
    },
    "finding.TERM_VARIANT.v3": {
        "zh": "同一概念在一篇里用了 {arg0} 种写法；统一用规范形「{canonical}」，其余写法改回它（只改措辞，不改事实）。",
        "en": "The same concept uses {arg0} surface forms in one document; standardize on the canonical form \"{canonical}\" and rewrite the other forms back to it (change wording only, not facts).",
    },
    "finding.UNBOUND_NUMBER": {
        "zh": "数字 {tok} 回得到账（{arg1}），但正文没内联绑定——只算黄，不算已核验",
        "en": "the number {tok} reaches the ledger ({arg1}), but the text has no inline binding — yellow only, not verified",
    },
    "finding.UNKNOWN_CITE_COMMAND": {
        "zh": "认不出的引用命令 \\{name}——引用闸门默认 fail-closed，请改用已知的 cite 家族命令",
        "en": "unrecognized citation command \\{name} — the citation gate is fail-closed by default; use a known cite-family command",
    },
    "finding.UNKNOWN_FACT_MARKER": {
        "zh": "正文标记了不存在的 fact {fid}（账上没有这个 id）",
        "en": "the text marks a nonexistent fact {fid} (the ledger has no such id)",
    },
    "finding.UNMATCHED_NUMBER": {
        "zh": "数字 {tok} 回不到任何 fact.value",
        "en": "the number {tok} traces back to no fact.value",
    },
    "finding.UNREADABLE_SOURCE": {
        "zh": "fact {fact} 的 source 读不了：{src}（{detail}）",
        "en": "fact {fact}: source cannot be read: {src} ({detail})",
    },
    "finding.UNRESOLVED_CITE": {
        "zh": "引用 {key} 的 {name}={value} 在远端不存在（{detail}）",
        "en": "{name}={value} of citation {key} does not exist remotely ({detail})",
    },
    "finding.UNSCANNED_TEX": {
        "zh": "{p} 不在审计闭包里（未被扫描）",
        "en": "{p} is not in the audit closure (not scanned)",
    },
    "finding.UNSIGNED_RESULT": {
        "zh": "results/ 下有未签文件 {rel}——它没有被任何清单锁住",
        "en": "unsigned file {rel} under results/ — it is locked by no manifest",
    },
    "finding.UNUSED_BIB": {
        "zh": "bib 条目 {e} 在审计闭包内从未被 \\cite 引用——参考文献里有它、正文没用它（R-11）；确属保留请写 bib_allow_unused = [{e1}] 或在正文 \\nocite{{e2}}",
        "en": "bib entry {e} is never referenced by \\cite within the audit closure — it is in the references but not used in the text (R-11); if it is deliberately kept, write bib_allow_unused = [{e1}] or put \\nocite{{e1}} in the text",
    },
    "finding.UNUSED_FACT": {
        "zh": "账上有、文里没用：fact {fact}（{fact1}）",
        "en": "in the ledger but unused in the text: fact {fact} ({fact1})",
    },
    "finding.VALUE_NOT_IN_SOURCE": {
        "zh": "fact {fact} 的 value 数字 {arg1} 没有出现在 source 里（内容回查失败）",
        "en": "the value numbers {arg1} of fact {fact} do not appear in the source (content re-check failed)",
    },
    "finding.WE_ACTION_DENSITY": {
        "zh": "「我们做了 X」多于「X 意味着 Y」：把动作句改成「X 意味着 Y」，主语换成对象或结论；只改主语与谓语，事实、数字与引用不动。",
        "en": "\"We did X\" outweighs \"X means Y\": rewrite the action sentence as \"X means Y\", with the subject switched to the object or the conclusion; change only the subject and the predicate, leave facts, numbers and citations untouched.",
    },
    "finding.WORDINESS_BLOAT": {
        "zh": "「{phrase}」是膨胀短语：直接写「{arg1}」，信息不减",
        "en": "\"{phrase}\" is a bloated phrase: write \"{arg1}\" directly, with no loss of information",
    },
    "finding.ZH_ASPECT_ZHE": {
        "zh": "「{phrase}」是动词＋「着」的进行体。{arg1}",
        "en": "\"{phrase}\" is a verb plus the Chinese progressive aspect particle. {arg1}",
    },
    "finding.ZH_COLLOCATION_REDUNDANCY": {
        "zh": "「{m}」是搭配冗余（{label}，两个词说同一件事）：{fix}。",
        "en": "\"{m}\" is a redundant collocation ({label}, both words say the same thing): {fix}.",
    },
    "finding.ZH_DANG_WHEN": {
        "zh": "「{m}」是翻译腔的「当…{tail}」结构（英文 when 语序）。{fix}。{note}。",
        "en": "\"{m}\" is a translation-style \"when ... {tail}\" construction (English when order). {fix}. {note}.",
    },
    "finding.ZH_DE_STACK": {
        "zh": "短修饰链：连续两层定语的间隔只有 {len_a} / {len_b} 字（「{gap_a}」「{gap_b}」）。把其中一层改成动词句，或拆成两句（例：'A 的 B 的 C' → 'C 由 B 做，B 属于 A'）；事实与数字不动。",
        "en": "Short attributive chain: the gap between two consecutive attributive layers is only {len_a} / {len_b} characters (\"{gap_a}\" \"{gap_b}\"). Turn one of the layers into a verb clause, or split it into two sentences (e.g. 'A's B's C' -> 'C is done by B, B belongs to A'); facts and numbers stay unchanged.",
    },
    "finding.ZH_DUE_TO_MAKE": {
        "zh": "「{m}…」是介词短语，不能作主语，全句缺主。删掉「{m1}」，让原因自己当主语，后半句直接给结果（例：「由于数据缺失，使得结果不可靠」→「数据缺失，结果不可靠」）；这是语法错，不只是文风。",
        "en": "\"{m}...\" is a prepositional phrase and cannot serve as the subject; the sentence has no subject. Delete \"{m1}\" and let the cause become the subject, with the result stated directly in the second half (e.g. \"Because the data are missing, which makes the results unreliable\" -> \"The data are missing, the results are unreliable\"); this is a grammar error, not just a style problem.",
    },
    "finding.ZH_LIGHT_VERB_NOUN": {
        "zh": "「{phrase}」是轻动词＋名词：动词是空的，动作藏在名词里。动作其实是什么——「{direct}」；直接写「{direct1}」，把「{token}」删掉。",
        "en": "\"{phrase}\" is a light verb plus a noun: the verb is empty and the action is hidden in the noun. What the action actually is - \"{direct}\"; write \"{direct1}\" directly and delete \"{token}\".",
    },
    "finding.ZH_POSTPOSED_CONDITION": {
        "zh": "条件从句后置（英文语序）：中文条件在前。把「{cond}」移到逗号前 → 「{cond1}，{main}」",
        "en": "Postposed conditional clause (English order): the Chinese condition comes first. Move \"{cond}\" before the comma -> \"{cond1}, {main}\"",
    },
}
# --- END FINDING_MESSAGES ---

# --------------------------------------------------------------------------
# 工作台自己生成的说明文案（wb.*）
# --------------------------------------------------------------------------
#
# 与 FINDING_MESSAGES **同一套机制**（key → {zh, en} ＋ render），但目录
# 分开：finding.* 是真闸的话（audit.py / style.py 产出的发现），wb.* 是
# 工作台自己说的话（机器视图的命令清单、提议单的正文与告警）。
#
# 口径：
#
# * 中文模板与工作台原来的中文原话**逐字相同**——提议单落盘的 before_text /
#   after_text 就是拿它渲染出来的，所以「展示层」与「落盘层」在中文下
#   长得一模一样，翻译只发生在展示层；
# * 英文模板**不许有中文**（EN 界面无中文残留是硬指标）；
# * 槽位里塞的是**数据**（路径、指纹、条数、账本片段）——值结构稳定，
#   不翻译、不改语义。
WORKBENCH_MESSAGES: dict = {
    # ---- 机器视图：导出与命令 ----
    "wb.mv.cmd.audit": {
        "zh": "真闸体检（只读）",
        "en": "Full gate check (read-only)",
    },
    "wb.mv.cmd.check": {
        "zh": "账本体检（只读）",
        "en": "Ledger check (read-only)",
    },
    "wb.mv.cmd.matrix": {
        "zh": "追溯矩阵（写 audit/matrix.md）",
        "en": "Traceability matrix (writes audit/matrix.md)",
    },
    "wb.mv.cmd.freeze": {
        "zh": "证据冻结（写 audit/evidence.lock）",
        "en": "Evidence freeze (writes audit/evidence.lock)",
    },
    "wb.mv.note": {
        "zh": "本视图只读；上面前两条是只读命令，后两条会写盘，需人自己跑。",
        "en": "This view is read-only: the first two commands are read-only, the last two write to disk and have to be run by a human.",
    },

    # ---- 提议单：冻结证据清单 ----
    "wb.prop.freeze.before.head": {
        "zh": "当前清单（[evidence] 声明）：{sections} 节 / {entries} 条",
        "en": "Current list ([evidence] declarations): {sections} sections / {entries} entries",
    },
    "wb.prop.freeze.after.path": {
        "zh": "冻结件将写入 {path}：",
        "en": "The lock will be written to {path}:",
    },
    "wb.prop.freeze.section": {
        "zh": "节 {section} → {ids}",
        "en": "section {section} -> {ids}",
    },
    "wb.prop.freeze.sectionNone": {
        "zh": "节 {section} → （无）",
        "en": "section {section} -> (none)",
    },
    "wb.prop.freeze.summaryEmpty": {
        "zh": "（清单为空）",
        "en": "(the list is empty)",
    },
    "wb.prop.lock.none": {
        "zh": "冻结件：无（还没冻结过）",
        "en": "Lock: none (never frozen yet)",
    },
    "wb.prop.lock.some": {
        "zh": "冻结件：{path}（sha256 {sha}…，{entries} 条）",
        "en": "Lock: {path} (sha256 {sha}..., {entries} entries)",
    },
    "wb.prop.counts": {
        "zh": "{sections} 节 / {entries} 条",
        "en": "{sections} sections / {entries} entries",
    },
    "wb.prop.digest": {
        "zh": "canonical_sha256 = {digest}",
        "en": "canonical_sha256 = {digest}",
    },
    "wb.prop.freeze.reason": {
        "zh": "冻结理由：{reason}",
        "en": "Freeze reason: {reason}",
    },
    "wb.prop.freeze.warnEmpty": {
        "zh": "当前清单是空的（[evidence] 没声明任何节）——冻结下来只会留一个空件。",
        "en": "The current list is empty ([evidence] declares no sections) - freezing it would only leave an empty lock.",
    },
    "wb.prop.freeze.warnIdempotent": {
        "zh": "当前清单与冻结件一致——冻结是幂等的，不会改任何东西。",
        "en": "The current list matches the lock - freezing is idempotent and changes nothing.",
    },

    # ---- 提议单：解冻证据清单 ----
    "wb.prop.unfreeze.before.counts": {
        "zh": "清单：{sections} 节 / {entries} 条",
        "en": "List: {sections} sections / {entries} entries",
    },
    "wb.prop.unfreeze.before.state": {
        "zh": "状态：已冻结",
        "en": "State: frozen",
    },
    "wb.prop.unfreeze.after.keep": {
        "zh": "冻结件保留（{sha}），但清单进入「解冻」状态",
        "en": "The lock is kept ({sha}), but the list enters the \"unfrozen\" state",
    },
    "wb.prop.unfreeze.after.log": {
        "zh": "日志将追加一条 unfreeze 记录到 audit/evidence-log.ndjson",
        "en": "An unfreeze entry will be appended to audit/evidence-log.ndjson",
    },
    "wb.prop.unfreeze.after.reason": {
        "zh": "解冻理由：{reason}",
        "en": "Unfreeze reason: {reason}",
    },
    "wb.prop.unfreeze.after.date": {
        "zh": "日期：{date}",
        "en": "Date: {date}",
    },

    # ---- 提议单：追加一条事实 ----
    "wb.prop.addFact.before.ledger": {
        "zh": "账本 {ledger}：当前没有 id={id} 的事实",
        "en": "Ledger {ledger}: there is no fact with id={id} yet",
    },
    "wb.prop.addFact.before.ledgerUnknown": {
        "zh": "账本（未定位）：当前没有 id={id} 的事实",
        "en": "Ledger (not located): there is no fact with id={id} yet",
    },
    "wb.prop.addFact.before.newLedger": {
        "zh": "（这个账本文件还不存在，采纳时新建）",
        "en": "(this ledger file does not exist yet; it will be created on adoption)",
    },
    "wb.prop.addFact.before.note": {
        "zh": "（这条将追加到账本末尾）",
        "en": "(it will be appended at the end of the ledger)",
    },
    "wb.prop.addFact.after.head": {
        "zh": "将向账本 {ledger} 追加一条事实：",
        "en": "One fact will be appended to ledger {ledger}:",
    },
    "wb.prop.addFact.after.headUnknown": {
        "zh": "将向账本（未定位）追加一条事实：",
        "en": "One fact will be appended to the (not located) ledger:",
    },

    # ---- 提议单：导出投稿包 ----
    "wb.prop.bundle.before": {
        "zh": "投稿包：还没导出过（本提议会真收集一次并过清单门）",
        "en": "Submission bundle: not exported yet (this proposal will collect it once and run it through the manifest gate)",
    },
    "wb.prop.bundle.after.head": {
        "zh": "将导出投稿包：正文 ＋ 事实账 ＋ 参考文献 ＋ PDF",
        "en": "The submission bundle will be exported: body + fact ledger + references + PDF",
    },
    "wb.prop.bundle.after.gate": {
        "zh": "清单门逐条核对；门不过就不出包（提议单留在待确认，人可重提）",
        "en": "Every item is checked against the manifest; if the gate fails nothing is exported (the proposal stays pending and can be raised again)",
    },

    # ---- 告警：保护面重建（改稿／插入草稿） ----
    "wb.warn.protect.injected": {
        "zh": "正文里新写的 {dropped} 已被剥掉：工作台不让人凭空造账本绑定",
        "en": "{dropped} newly written in the body was stripped: the workbench does not let you invent ledger bindings",
    },
    "wb.warn.protect.duplicate": {
        "zh": "同一个保护面被复制了一次，只保留第一处",
        "en": "The same protected marker was duplicated; only the first occurrence was kept",
    },
    "wb.warn.protect.restored": {
        "zh": "被删掉的 {label} 标记已按原文位置补回",
        "en": "The deleted {label} marker was restored to its original position",
    },
    "wb.warn.protect.restoredGeneric": {
        "zh": "被删掉的 保护 标记已按原文位置补回",
        "en": "The deleted protected marker was restored to its original position",
    },

    # ---- 告警：块形状（改稿／插入草稿） ----
    "wb.warn.shape.noHeading": {
        "zh": "这一段本身是节标题，但替换文本里没有节标题命令——采纳后这个标题会消失，请确认这是你要的。",
        "en": "This block is itself a section heading, but the replacement text carries no heading command - the heading will disappear once adopted, make sure that is what you want.",
    },
    "wb.warn.shape.input": {
        "zh": "替换文本里有 \\input/\\include{{file}}——正文段里搬整个文件进来，形状不对。",
        "en": "The replacement text contains \\input/\\include{{file}} - moving a whole file into a body paragraph breaks the block shape.",
    },
    "wb.warn.shape.tooLong": {
        "zh": "替换文本比原文长很多（{old} 字 → {new} 字）——确认不是贴错了地方吗？",
        "en": "The replacement text is much longer than the original ({old} chars -> {new} chars) - check that it was not pasted in the wrong place.",
    },

    # ---- 追加事实表单（引擎侧读数说明） ----
    "wb.form.fact.note.manifestUnsigned": {
        "zh": "这份人签清单还没签字（signed_by 是空的）——清单里的产物现在还不算「签过」。",
        "en": "This human-signed manifest is not signed yet (signed_by is empty) - the artifacts it lists do not count as signed yet.",
    },
    "wb.form.fact.note.noSigned": {
        "zh": "人签清单里一条产物都没有——先签字，再来挑产物。",
        "en": "The signed manifest lists no artifacts - sign it first, then pick one.",
    },
    "wb.form.fact.note.drifted": {
        "zh": "有 {count} 个已签产物在签字之后被改过——挑它们之前先核对内容。",
        "en": "{count} signed artifact(s) changed after they were signed - check them before picking one.",
    },
    "wb.form.fact.note.missing": {
        "zh": "清单里的 {count} 个产物现在找不到文件了。",
        "en": "{count} artifact(s) in the manifest can no longer be found on disk.",
    },
    "wb.form.fact.note.scanScope": {
        "zh": "未进清单的产物只扫到 {roots} 下 {depth} 层，一共 {total} 个文件；更深的不在候选里。",
        "en": "Artifacts not in the manifest are scanned only {depth} level(s) under {roots} - {total} file(s) in total; anything deeper is not listed.",
    },
    "wb.form.fact.note.noLedger": {
        "zh": "这个盘还没有账本文件——挑一个现有的，或按本盘命名风格新建一个。",
        "en": "This disk has no ledger file yet - pick an existing one, or create a new one following this disk naming style.",
    },
    "wb.form.fact.note.sourceDir": {
        "zh": "这个盘没配 source_root：source 只能取 {dir}/ 下的文件。",
        "en": "This disk has no source_root configured: source can only be a file under {dir}/.",
    },

    # ---- 追加事实表单的错误码（界面据此翻语言） ----
    "wb.form.fact.err.LEDGER_PATH_INVALID": {
        "zh": "目标账本必须是项目内的相对路径。",
        "en": "The target ledger must be a project-relative path.",
    },
    "wb.form.fact.err.LEDGER_OUTSIDE_GLOB": {
        "zh": "目标账本不在项目声明的 facts 里——写了也读不到。",
        "en": "The target ledger is outside the project facts glob - anything written there would never be read back.",
    },
    "wb.form.fact.err.LEDGER_NOT_IN_GLOB_DIR": {
        "zh": "目标账本必须直接放在 facts 的目录下面。",
        "en": "The target ledger must sit directly in the facts directory.",
    },
    "wb.form.fact.err.LEDGER_STYLE_MISMATCH": {
        "zh": "这个账本文件名不合本盘账本的命名风格——新建文件请沿用现有命名。",
        "en": "This ledger file name does not follow the naming style of this disk - a new file must follow the existing names.",
    },
    "wb.form.fact.err.LEDGER_PREFIX_TAKEN": {
        "zh": "这个账本文件名的前缀已被本盘现有账本文件占用。",
        "en": "The prefix of this ledger file name is already taken by an existing ledger file on this disk.",
    },
    # ---- value 硬校验（数字必须真的在产物里） ----
    "wb.form.fact.err.VALUE_NOT_IN_SOURCE": {
        "zh": "value「{value}」里的数字在产物 {source} 里找不到：{missing}"
              "（数字按出现顺序逐个比对，单位不参与比对）。"
              "你说的位置是「{locator}」——请照产物原文写 value，或换一件产物。",
        "en": "The value \"{value}\" does not match the artifact {source}: "
              "the number(s) {missing} were not found (compared one by one, in order; "
              "units are not compared). You said the location is \"{locator}\" - "
              "rewrite the value to match the artifact text, or pick another artifact.",
    },
    "wb.form.fact.err.VALUE_TEXT_NOT_IN_SOURCE": {
        "zh": "value「{value}」这句原文在产物 {source} 里找不到。"
              "你说的位置是「{locator}」——请照产物原文写 value，或换一件产物。",
        "en": "The value \"{value}\" was not found verbatim in the artifact {source}. "
              "You said the location is \"{locator}\" - rewrite the value to match "
              "the artifact text, or pick another artifact.",
    },
    "wb.form.fact.err.VALUE_SOURCE_NOT_TEXT": {
        "zh": "产物 {source} 不是 UTF-8 文本，没法核对 value——换一件文本产物。",
        "en": "The artifact {source} is not UTF-8 text, so the value cannot be checked - "
              "pick a text artifact.",
    },
    "wb.form.fact.err.VALUE_SOURCE_UNREADABLE": {
        "zh": "读不到产物 {source}，没法核对 value。",
        "en": "The artifact {source} cannot be read, so the value cannot be checked.",
    },
}


# --------------------------------------------------------------------------
# 展示层文案：key ＋ params
# --------------------------------------------------------------------------


def part(key: str, params: dict | None = None) -> dict:
    """一条展示层文案：key（双语目录里的模板）＋ params（槽位取值）。

    槽位里塞的是**数据**（路径、指纹、条数、账本片段）——值结构稳定，
    不翻译、不改语义。翻译只发生在 key 指向的那一句模板上。
    """
    return {"key": str(key), "params": dict(params or {})}


def literal(text: str) -> dict:
    """一条**不翻译**的展示层文案（契约／落盘内容，逐字保留）。"""
    return {"text": str(text)}


def render_parts(parts, lang: str = DEFAULT_LANG, catalog: dict | None = None,
                 sep: str = "\n") -> str:
    """一组展示层文案 → 一段文本（逐条按 lang 渲染，用 sep 拼起来）。

    目录里缺这一条时，渲染出来的是 key 本身——调用方拿它跟中文原话
    对不上就该回落到原话（宁可显示中文原话，也不要半中半英）。
    """
    out = []
    for item in parts or []:
        if not isinstance(item, dict):
            out.append(str(item))
            continue
        if "text" in item:
            out.append(str(item.get("text") or ""))
            continue
        key = str(item.get("key") or "")
        if not key:
            continue
        params = dict(item.get("params") or {})
        out.append(render(key, params, lang, catalog))
    return sep.join(out)


def parts_keys(parts) -> set:
    """这组展示层文案用到的 key 集合（挑要随载荷发出去的模板子集）。"""
    keys = set()
    for item in parts or []:
        if isinstance(item, dict):
            key = str(item.get("key") or "")
            if key:
                keys.add(key)
    return keys
