# -*- coding: utf-8 -*-
"""版本号、退出码分层与严重级别常量。"""
from __future__ import annotations

VERSION = "1.3.0"
SCHEMA_VERSION = "1.0"

CONFIDENCE_OK = {"high", "med", "low"}
KINDS_OK = {"claim", "config"}

# 退出码分层（SPEC-V1 §5）
EXIT_OK = 0        # 绿：完整覆盖且无红无黄
EXIT_RED = 1       # 红：违例（编造/不自洽/账坏）
EXIT_CONFIG = 2    # 配置或用法错（工具没跑起来）
EXIT_YELLOW = 3    # 黄：跑完了但有「未核验/未绑定/未签名/冲突」，不判死但必须列
EXIT_INTERNAL = 4  # 工具内部错误（异常）
EXIT_INTEGRITY = 5 # 覆盖缺口 / PDF 与签名信任链失败（V3.0）
EXIT_STALE = 7     # 报告/PDF 过期、nonce 重放
EXIT_MISSING = 8   # 必需工具缺失（PDF 工具链）——不许静默放行

# 退出码全闭集（裁定 2026-11-16：全闭集入宪——「值↔语义配对」永不变化；
# 唯一权威表＝SPEC-V3.0 §2.5）。上面 0/1/2/3/4/5/7/8 是本仓折算现行使用的
# 分层；下面补齐权威表里其余两值，使闭集在代码里有完整的名字可对照。
# 新增或改义任何一值＝修约（major，BREAKING）。
EXIT_PROOF = 6        # RED(PROOF)：--require-proof 未达标（SPEC-V3.0 §2.5）
EXIT_ATTACK_OPEN = 9  # RED(ATTACK_OPEN)：ATTACKS.md 有 blocking/open 条目

SEV_RED = "red"
SEV_YELLOW = "yellow"
SEV_INFO = "info"

# ---------------------------------------------------------------------------
# 判定码闭集（2026-11-26：第 ② 步把段落级线并进 main 时入宪）
#
# 为什么入宪：退出码闭集早就是「全闭集入宪」的既有原则（见上 EXIT_* 那段
# 注释）。判定码此前散落在各模块的 code= 里——第三方与上游社区包没法
# 对照一份完整的码表。这里把**引擎会抛出的每一个判定码**登记成闭集：
#
# * 只加不改：既有码的名字与含义一个字不动；本次新增登记的是段落级线
#   独有的 13 个（见 PARAGRAPH_ONLY_CODES）；法律侧第 ② 步并进来时又补登了
#   法律集成件自己的 3 个（PROPOSAL_STALE／PROPOSAL_INVALID／PROPOSAL_UNKNOWN）。
# * 登记 ≠ 触发：这 13 个码全部落在**写侧**（提议单／段落写回／value 硬闸），
#   审计（audit --json）那条路上一个都不会抛——27 盘逐盘 cmp 27/27 与金样例
#   逐字节未动，就是这件事的实测证据。
# * 码表是**机械扫描**出来的（AST 扫 code= 关键字／常量／默认值），
#   增删码时重扫一次，别手抄；tests/test_code_closed_set.py 会核对。
# ---------------------------------------------------------------------------

#: 段落级线独有、本次（第 ② 步并入段落级线时）补登进闭集的 13 个判定码。
#: 全部落在**写侧**（提议单／段落写回／value 硬闸），审计那条路一个都不抛。
PARAGRAPH_ONLY_CODES = frozenset({
    'BLOCK_STALE',
    'EDIT_TOKEN_MISMATCH',
    'EDIT_TOKEN_COUNT_MISMATCH',
    'EDIT_SHAPE_MISMATCH',
    'EDIT_UNBALANCED',
    'PROPOSAL_SHAPE_MISMATCH',
    'PROPOSAL_TOKEN_MISMATCH',
    'PROPOSAL_FAILED',
    'PROPOSAL_ID_INVALID',
    'PROPOSAL_NOT_FOUND',
    'PROPOSAL_UNREADABLE',
    'PROPOSAL_ALREADY_RESOLVED',
    'VALUE_SOURCE_NOT_TEXT',
})

#: 判定码权威闭集：引擎会抛出的每一个判定码（机械扫描生成，别手抄）。
CODE_CLOSED_SET = frozenset({
    'ABSTRACT_MISSING',
    'AI_UNAVAILABLE',
    'ASSEMBLY_MISSING',
    'ASSET_INVALID',
    # 图片预览通道（factscribe/workbench/assets.py ＋ serve.py 的 /api/asset）
    # 抛的码。它在第 ④ 步之前就由 serve.py 抛了，只是那时闭集扫描器看不见
    # （扫描认的是 code= 关键字与异常默认值，不认 _error() 的位置参数）；
    # 第 ④ 步并进来的 assets.py 用了 code="ASSET_NOT_FOUND"，闭集核对照实
    # 把它点出来了——补登即可，码的名字与含义一个字没改，运行行为零变化
    # （CODE_CLOSED_SET 是登记表，不是派发表）。
    'ASSET_NOT_FOUND',
    'BAD_ENUM',
    'BAD_TOML',
    'BAD_VALUE',
    'BIB_PATH_ESCAPE',
    'BLOCK_MISSING',
    'BLOCK_STALE',
    'BUNDLE_CONFIG_INVALID',
    'BUNDLE_FAILED',
    'CHECK_FAILED',
    'CITATION_EXISTS',
    'CITATION_INVALID',
    'CITATION_MISSING',
    'DRAFT_EMPTY',
    'DRAFT_NOT_AI',
    'EDIT_SHAPE_MISMATCH',
    'EDIT_TOKEN_COUNT_MISMATCH',
    'EDIT_TOKEN_MISMATCH',
    'EDIT_UNBALANCED',
    'EVIDENCE_NOT_FROZEN',
    'EVIDENCE_REASON_REQUIRED',
    'FACT_ALREADY_BOUND',
    'FACT_BIND_NOT_PARA',
    'FACT_CONTAINER_INVALID',
    'FACT_ID_MISSING',
    'FACT_NOT_IN_LEDGER',
    'FACT_SCHEMA_INVALID',
    'FACT_VALUE_EMPTY',
    'FIG_SPEC_UNPLOTTABLE',
    'FILE_NOT_FOUND',
    'FILE_TOO_LARGE',
    'FLOAT_NOT_ALLOWED',
    'IMPORT_FAILED',
    'KNOWLEDGE_FAILED',
    'LEDGER_NOT_IN_GLOB_DIR',
    'LEDGER_OUTSIDE_GLOB',
    'LEDGER_PATH_INVALID',
    'LEDGER_PREFIX_TAKEN',
    'LEDGER_STYLE_MISMATCH',
    'LOCK_MISMATCH',
    'LOCK_MISSING',
    'MIRROR_BIB_INVALID',
    'MIRROR_BIB_MISSING',
    'MIRROR_CONFIG_INVALID',
    'MIRROR_DISK_INVALID',
    'MIRROR_DISK_MISSING',
    'MIRROR_FACTS_INVALID',
    'MIRROR_FACTS_MISSING',
    'MISSING_FIELD',
    'NO_PROJECT',
    'ORDER_INVALID',
    'PATH_ESCAPE',
    'PATH_NOT_FILE',
    'PDFTOTEXT_MISSING',
    'PDF_MISSING',
    'PDF_TEXT_FAILED',
    'POPPLER_MISSING',
    'PROBE_ERROR',
    'PROBE_MISMATCH',
    'PROBE_PARSE',
    'PROJECT_CREATE_FAILED',
    'PROJECT_DIR_NOT_EMPTY',
    'PROJECT_INVALID',
    'PROJECT_NOT_REGISTERED',
    'PROJECT_PARENT_INVALID',
    'PROJECT_PARENT_MISSING',
    'PROJECT_SLUG_INVALID',
    'PROJECT_TITLE_MISSING',
    'PROPOSAL_ALREADY_RESOLVED',
    'PROPOSAL_FACT_MISSING',
    'PROPOSAL_FAILED',
    'PROPOSAL_ID_INVALID',
    'PROPOSAL_INVALID',
    'PROPOSAL_KIND_INVALID',
    'PROPOSAL_NOT_FOUND',
    'PROPOSAL_SHAPE_MISMATCH',
    # 法律侧待批提案通道的三个码（integrations/factscribe-legal/factscribe_legal/
    # proposals.py）：PROPOSAL_STALE＝指纹闸不过（before_sha 与现算的不符），
    # PROPOSAL_INVALID＝提议单本身不合形状，PROPOSAL_UNKNOWN＝单号查无此单。
    # 法律侧第 ② 步并进 main 时补登——那个分支的基点早于闭集入宪那笔，
    # 扫描器看不见这三个码。登记 ≠ 触发：三个码全落在**写侧**（建单／采纳），
    # 审计那条路一个都不抛（27 盘逐盘 cmp 与金样例逐字节未动即是证据）。
    'PROPOSAL_STALE',
    'PROPOSAL_TEXT_EMPTY',
    'PROPOSAL_TOKEN_MISMATCH',
    'PROPOSAL_UNKNOWN',
    'PROPOSAL_UNREADABLE',
    'PROTECT_FILE_SET_CHANGED',
    'PROTECT_HEADING_RENAMED',
    'PROTECT_MATH_CHANGED',
    'PROTECT_TABLE_CHANGED',
    'READ_ONLY',
    'REF_PICK_INVALID',
    'REF_SEARCH_BADPAYLOAD',
    'REF_SEARCH_HTTP',
    'REF_SEARCH_NETWORK',
    'REF_SEARCH_TIMEOUT',
    'REF_TODO_TABLE_INVALID',
    'REF_TODO_TABLE_MISSING',
    'REPORT_ERROR',
    'REPORT_EXISTS',
    'REPORT_ID_INVALID',
    'SAMPLE_COPY_FAILED',
    'SAMPLE_FAILED',
    'SAMPLE_MISSING',
    'SAMPLE_REMOVE_FAILED',
    'SECTIONS_DIR_MISSING',
    'SECTION_EXISTS',
    'SECTION_INVALID',
    'SECTION_MISSING',
    'SECTION_NOT_HEADING',
    'SECTION_NOT_INCLUDED',
    'SECTION_PARENT_MISSING',
    'SECTION_PATH_INVALID',
    'SECTION_READONLY',
    'SECTION_REFERENCED',
    'SECTION_TITLE_MISSING',
    'TITLE_MISSING',
    'TR_DIR_INVALID',
    'TR_DIR_MISSING',
    'TR_MIN_TOKENS_RANGE',
    'TR_NO_FILES',
    'TR_N_RANGE',
    'TR_SELF_COMPARE',
    'TR_SENTENCE_MIN_WORDS_RANGE',
    'TR_SENTENCE_THRESHOLD_RANGE',
    'USAGE',
    'VALUE_NOT_IN_SOURCE',
    'VALUE_SOURCE_NOT_TEXT',
    'VALUE_SOURCE_UNREADABLE',
    'VALUE_TEXT_NOT_IN_SOURCE',
    'VENUE_FAILED',
    'WORKSPACE_MISSING',
})
