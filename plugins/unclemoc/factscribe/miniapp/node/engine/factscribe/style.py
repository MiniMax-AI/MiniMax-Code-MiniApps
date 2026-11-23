# -*- coding: utf-8 -*-
"""文风闸 v4/v5：机械检测「公式化写作特征」，只出黄牌、不阻断、不改正文。

规则清单见 ``docs/design/SPEC-V3.0.md`` §13 与 §15：

* 插入语破折号、标题过长/带解释、标题术语未在首句定义；
* 节奏平台、同构三点并列在相邻段重复、套话连接词、空泛形容词、超长句；
* 改写后复检：首句复述标题（``HEADING_ECHO``）、标题关系词变化
  （``HEADING_RELATION_CHANGED``）、旧标题主语丢失（``HEADING_SUBJECT_LOST``）、
  只换冒号不重写（``HEADING_SUBSTITUTED``），以及只报新增违规的
  ``style --diff <before>``。

* 本工具**不评估、也不试图规避任何 AI 检测器**。它只检测可机械复算的
  写法；输出是「文件:行 + 原文 + 具体改法」，不是「像 AI」的分数。
* 退出码 0（无触发）、3（黄牌，仍是提示）与 1（证据钢印红：
  ``REQUIRED_EVIDENCE_MISSING`` / ``EVIDENCE_DROPPED``，批 131）。
* 阈值、词表与术语白名单来自 ``style-rules.toml``（项目根优先，其次
  仓根，最后内置默认值），改阈值即改判定。
* 例外：``numeral_density_stage`` 是**阶段开关**，只能由命令行
  ``style --stage draft|revision`` 决定（默认 draft）。项目内规则文件写了
  也不认（输出 ``RULES_OVERRIDE_IGNORED`` 告警）——判据开关不能放在
  被测物里（批 130）。

LaTeX 正文的遮罩保持原长度、保留换行，所以任何位置都能直接换算回
源文件行号；公式、图表、文献表、verbatim 与批注宏不参与文风统计。
"""
from __future__ import annotations

import bisect
import re
from dataclasses import dataclass, field
from pathlib import Path

from . import mdscan
from .config import Config, ConfigError, load_toml, section_budget
from .constants import EXIT_OK, EXIT_RED, EXIT_YELLOW
from .evidence import EVIDENCE_CODES, check_evidence
from .i18n import finding_key
from .livetext import _live_text
from .segment import segment
from .terms import Glossary, key_of, load_glossary
from .texscan import sentence_spans

DISCLAIMER = ("本工具不评估、也不试图规避任何 AI 检测器；它检测的是可机械判定的"
              "公式化写作特征。黄牌只是改写提示，不阻断、不改正文；证据钢印"
              "（REQUIRED_EVIDENCE_MISSING / EVIDENCE_DROPPED）除外——那是红，"
              "阻断且退出码 1。")

STYLE_RULES_NAME = "style-rules.toml"

# 批 130：只允许命令行控制的规则键。这些键写在项目内 style-rules.toml
# 里也不认——被判据管的正文与被测项目不得改动判据开关（否则「改规则」
# 就能让检查消失）。
CLI_ONLY_RULE_KEYS = ("numeral_density_stage",)

# 批 131：允许显式写 null 的阈值（null＝不判）。目前只有数字密度：
# 默认 null，因为它会诱导删证据；显式给数字即恢复旧行为。
NULLABLE_THRESHOLDS = ("numeral_density",)

# 阶段开关的合法值。``revision``＝改稿/改写验收阶段：数字受
# PROTECT_NUMBER_CHANGED 保护，NUMERAL_DENSITY 降为 info。
STAGE_DRAFT = "draft"
STAGE_REVISION = "revision"
STAGE_VALUES = (STAGE_DRAFT, STAGE_REVISION)

# --------------------------------------------------------------------------
# 内置默认规则（与仓根 style-rules.toml 同构；文件缺失时兜底）
# --------------------------------------------------------------------------

DEFAULT_RULES: dict = {
    # 术语白名单：两层——项目内 GLOSSARY.md ＋ 用户自维护纯文本（一行一个词）
    "term_allow_files": ["GLOSSARY.md", "term-allow.txt"],
    # 项目术语表覆盖（相对项目根）；空串＝用仓内分层词表
    # （factscribe/terms/paper.tsv ＋ workspace.tsv）
    "term_glossary": "",
    # TERM_UNREGISTERED 默认关闭；只由 `style --report-unregistered` 显式打开。
    # 打开时只查标题，结果单独走 info 通道，不进 findings、不影响退出码。
    "term_unregistered": False,
    # 批 109：RHYTHM_PLATEAU 默认只作参考读数（info）。10 词分桶会把「长度
    # 接近」误当成「节奏平台」，且它与 SENTENCE_UNIFORMITY（句长 CV）测的是
    # 同一件事。节奏的正式判据是 SENTENCE_UNIFORMITY；把本项设为 "yellow"
    # 可恢复旧的黄牌行为。
    "rhythm_plateau_level": "info",
    # 批 105（B5）：ABBREV_FIRST_USE 默认关闭。四份语料里专名与通用缩写
    # 混在一起，判「该不该展开」仍需人看；只由 `--report-abbrev` 打开。
    "abbrev_first_use": False,
    # 批 129/130：数字密度只在起草阶段当判据。改稿/改写验收时数字属于
    # PROTECT_NUMBER_CHANGED 的保护面，删数字会被保护面判红；此时阶段开关
    # 把判据降为 info（仍给读数，但不要求删数字）。
    # 批 130：本键**只能由命令行** ``style --stage draft|revision`` 决定，
    # 项目内 style-rules.toml 写了也不认（见 CLI_ONLY_RULE_KEYS）。
    "numeral_density_stage": "draft",
    "thresholds": {
        "connective_density": 8.0,
        # 句长 CV 的健康区间是 [sentence_uniformity, sentence_uniformity_high]；
        # 只有低于下界才算「太平」——高于上界是散，散不是 AI 特征。
        "sentence_uniformity": 0.45,
        "sentence_uniformity_high": 0.80,
        "empty_adjective": 6.0,
        "paragraph_template": 0.5,
        "hedge_stack": 1,
        "repeated_opener": 2,
        "sentence_length_extreme_en": 60,
        "sentence_length_extreme_zh": 110,
        "rhythm_plateau_run": 3,
        "rhythm_plateau_window": 10,
        # v4 新规则
        "dash_budget": 0,
        "heading_max_chars_zh": 12,
        "heading_max_words_en": 8,
        "colloquial_triad_repeats": 2,
        # P-152：HEADING_ECHO 收紧为「字面高度重复」——首句相对标题新引入的
        # 实义词不得超过这个数（首句基本就是标题的回声，才算回声）。
        "heading_echo_max_new_terms": 3,
        # 术语层：同一 canonical 在一篇里出现多少种不同表面形式才报 TERM_VARIANT
        "term_variant_min_forms": 2,
        # 批 99：解释性套语密度（每千词/字，> 触发）与反射式解释链
        "explainer_density": 6.0,
        "justify_chain_min_sentences": 2,
        "justify_chain_min_paragraphs": 2,
        # 批 102：句法级判据。数字型指标按条计，>= 1 触发，无密度闸。
        "light_verb_nominalization": 1,
        # P-152：轻动词＋名义化收紧到「重度」——同一篇里命中达到这么多次，
        # 才算系统性写法（个别措辞不报）。
        "light_verb_doc_min": 5,
        "wordiness_bloat": 1,
        "zh_postposed_condition": 1,
        "zh_due_to_make": 1,
        "zh_de_stack": 1,
        # 批 103：单句式「的」堆叠改为「短修饰链」判据——同一句内至少
        # 两对相邻「的」的间隔不超过 zh_de_stack_max_gap 个汉字才算成链。
        # 不看「的」总数或整句长度（正常复句里定语再长也不报）。
        "zh_de_stack_max_gap": 6,
        # 批 104：中文轻动词＋名词（按条报，>= 1 触发，无密度闸）。
        "zh_light_verb_noun": 1,
        # 批 105（B 档）：密度型指标必须写死单位。
        # nominalization_rate 单位＝每百词百分数（Sword 口径）：
        # 4.5 表示每 100 个英文词里 4.5 个名词化（剥离 5 个高频术语后）。
        "nominalization_rate": 4.5,
        # zh_aspect_zhe 单位＝每千个汉字：0.8 表示每 1000 汉字 0.8 个「动词＋着」。
        "zh_aspect_zhe": 0.8,
        # 其余三条按条/处计，>= 1 触发，无密度闸。
        "zh_dang_when": 1,
        "zh_collocation_redundancy": 1,
        # B5 只在打开时计；阈值 1＝首现一处即报（默认开关见顶层）。
        "abbrev_first_use": 1,
        # 批 128：篇幅预算的宽限。超预算超过这个百分比才报 SECTION_LENGTH
        # （20 表示「超过 120% 才算超」；正好 120% 不报）。
        "section_length_excess_percent": 20.0,
        # 批 129：读者感觉三项的代理判据。
        # NUMERAL_DENSITY：每千词（英）/每千汉字（中）的阿拉伯数字 token 数。
        # 批 131：默认阈值改为 null（不判）——它会诱导删证据：模型为了把密度
        # 降回阈值内，会把正文里的核心数字换成 nearly/most/some，审计仍绿而
        # 论证被抽空。实现与配置保留：显式写一个非负数字即恢复旧行为。
        "numeral_density": None,
        # SECTION_OVERLAP：节与节之间 8 词（英）/12 字（中）片段的重合率
        # （百分比）。重合率 = 共有片段数 ÷ 两节中较短一节的片段数。
        "section_overlap": 12.0,
        # WE_ACTION_DENSITY：主语为 we/我们且谓语是动作动词的句子占比。
        "we_action_density": 0.15,
    },
    "limits": {
        "max_findings_per_metric": 20,
        "min_paragraph_units": 8,
        "uniformity_min_sentences": 10,
    },
    "connectives": {
        "english": ["Moreover", "Furthermore", "Additionally", "In addition",
                    "Overall", "In conclusion"],
        "chinese": ["首先", "其次", "此外", "综上所述", "总而言之"],
    },
    # 批 99：句首解释性套语（EXPLAINER_DENSITY / JUSTIFY_CHAIN）。
    # 只收「替上一句补解释/补举证」的固定说法；普通因果连词（因为/由于）
    # 属正常论证，不进本表。
    "explainers": {
        "english": ["This means", "That is", "In other words",
                    "This is because", "The reason is", "Which is why",
                    "This shows that", "It follows that"],
        "chinese": ["这说明", "这意味着", "也就是说", "换句话说", "换言之",
                    "说白了", "简单说", "原因在于", "这是因为", "之所以",
                    "由此可见", "正因如此", "这就是为什么", "这正是",
                    "它证明", "它不证明", "可见"],
    },
    "empty_adjectives": {
        "english": ["crucial", "robust", "comprehensive", "significant",
                    "essential", "vital"],
        # 批 102 A6：移除「显著」——统计写作里它是术语，不是空泛标签。
        "chinese": ["至关重要", "全面", "深入"],
        "exempt_phrases": ["statistically significant",
                           "robust standard error", "robust to",
                           "more robust", "less robust",
                           "significant at the",
                           # 批 102：中文统计短语豁免（防词表回填后误伤）
                           "统计显著", "显著差异", "显著性", "显著水平",
                           "显著优于", "显著低于", "显著提高", "不显著"],
    },
    "paragraph_closers": {
        "english": ["Therefore", "Overall", "Thus", "In conclusion"],
        "chinese": ["综上", "因此", "总之", "总而言之", "总体而言"],
    },
    "hedge_stacks": {
        "english": ["may potentially", "might potentially", "could potentially",
                    "may possibly", "might possibly", "could possibly",
                    "may conceivably", "could conceivably",
                    "seems to suggest", "appears to indicate",
                    "appears to suggest", "seems to indicate"],
        "chinese": ["可能会", "或许会", "或许能够", "也许可能", "似乎可能",
                    "大概可能", "可能会是"],
    },
    "repeated_opener": {
        # 虚词开头不算「模板化同头」，否则正常论文会被大量误伤
        "stopwords": ["the", "a", "an", "this", "that", "these", "those",
                      "it", "its", "they", "their", "we", "our", "i", "in",
                      "on", "for", "to", "as", "at", "by", "with", "from",
                      "there", "and", "but", "or", "if", "when", "while",
                      "because", "since", "of",
                      # 中文虚词/代词开头同样不算模板化同头
                      "如果", "那么", "因为", "所以", "但是", "因此", "并且",
                      "而且", "这", "那", "我们", "它", "其", "在", "对",
                      "从", "当", "为了", "通过", "由", "被", "把", "让",
                      "使", "一个", "一种", "本文", "本节", "每一", "每"],
    },
    # v5：标题关系词。只收承载「对立/否定」的关系词；并列连接
    # （and / or / 与 / 及 / 、）不进本表——删掉它们不改变论证方向。
    "heading_relation_words": ["versus", "vs", "not", "without",
                               "对", "而非", "不是"],
    # 批 119：标题换标点/换介词规避（HEADING_SUBSTITUTED）。旧标题带冒号、
    # 新标题不带冒号，且把冒号换成下列 token 后与新高标题逐字相同 → 报。
    # 只换 token 不重写，与手册第 8 条「禁止换标点过关、也禁止换介词过关」同源。
    "heading_substitute": {
        "punctuation": ["、", "，", ",", "（", "）"],
        "prepositions": ["as", "with", "for", "of"],
    },
    # v5：HEADING_ECHO 的可配词表（泛化词不算「新实义」；垫话开头视为复述式）
    "heading_echo": {
        # P-152：字面回声口径——标题至少要有这么多个实义词（单词标题不算回声）。
        "literal_min_terms": 2,
        "generic_terms_en": ["limitation", "problem", "issue", "result",
                             "question", "thing", "aspect", "case", "point",
                             "claim", "matter", "area", "topic", "subject",
                             "part", "example", "work", "study", "approach",
                             "method", "way"],
        "generic_terms_zh": ["限制", "问题", "结果", "内容", "方面", "部分",
                             "事情", "情况", "因素", "要点", "工作", "研究",
                             "方法", "做法", "角度", "例子"],
        "meta_openers_en": ["is about", "is concerned with", "is discussed",
                            "we discuss", "this section", "this subsection",
                            "in this section", "in this subsection", "here we"],
        "meta_openers_zh": ["里", "中", "方面", "来说", "而言", "要先", "先要",
                            "先问", "首先要", "需要先", "本节讨论", "本节讲",
                            "这里讨论", "这一节讨论", "我们讨论", "本文讨论",
                            "讨论的是", "讲的是", "谈的是"],
    },
    # 批 102：英文轻动词＋名义化（LIGHT_VERB_NOMINALIZATION）。
    # 甲组（english）可直接跟名义化名词；乙组（article_verbs）只认
    # 「a/an＋名词」或复数名词，排除 "make the X legible" 这类宾语补足语
    # 与 "take the decision away" 这类短语动词。
    "light_verbs": {
        "english": ["perform", "performs", "performed", "performing",
                    "conduct", "conducts", "conducted", "conducting",
                    "carry out", "carries out", "carried out", "carrying out",
                    "undertake", "undertakes", "undertook", "undertaking",
                    "provide", "provides", "provided", "providing",
                    "offer", "offers", "offered", "offering"],
        "article_verbs": ["make", "makes", "made", "making",
                          "give", "gives", "gave", "giving",
                          "take", "takes", "took", "taking",
                          "have", "has", "had", "having",
                          "do", "does", "did", "doing",
                          "reach", "reaches", "reached", "reaching",
                          "achieve", "achieves", "achieved", "achieving",
                          "establish", "establishes", "established",
                          "establishing"],
        # 不含裸 -al：several / partial / beneficial 会大面积误命中。
        "suffixes": ["tion", "sion", "ment", "ance", "ence", "ity",
                     "ness", "sis"],
        "exempt_phrases": ["have a chance", "provide a basis",
                           "have a role", "take a look", "give a view",
                           "make a difference"],
        # 「动作其实是什么」：查表优先，查不到给通用提示（不瞎猜变形）。
        "actions": {
            "distinction": "distinguish", "analysis": "analyze",
            "decision": "decide", "explanation": "explain",
            "evaluation": "evaluate", "assessment": "assess",
            "implementation": "implement", "measurement": "measure",
            "observation": "observe", "description": "describe",
            "discussion": "discuss", "conclusion": "conclude",
            "assumption": "assume", "comparison": "compare",
            "definition": "define", "application": "apply",
            "performance": "perform", "improvement": "improve",
            "requirement": "require", "statement": "state",
            "treatment": "treat", "judgment": "judge",
            "agreement": "agree", "consideration": "consider",
            "investigation": "investigate", "identification": "identify",
            "verification": "verify", "validation": "validate",
            "demonstration": "demonstrate", "estimation": "estimate",
            "reduction": "reduce", "production": "produce",
            "introduction": "introduce", "contribution": "contribute",
            "classification": "classify", "specification": "specify",
            "justification": "justify", "motivation": "motivate",
            "transformation": "transform", "configuration": "configure",
            "optimization": "optimize", "selection": "select",
            "detection": "detect", "collection": "collect",
            "inspection": "inspect", "protection": "protect",
            "construction": "construct", "adoption": "adopt",
            "addition": "add", "allocation": "allocate",
            "reliance": "rely", "appearance": "appear",
            "existence": "exist", "occurrence": "occur",
            "preference": "prefer", "resistance": "resist",
        },
    },
    # 批 102：英文膨胀短语（WORDINESS_BLOAT）。只收「删掉/替换后不丢信息」
    # 的固定说法；in order to / in terms of 这类属正常学术行文，不进表。
    "wordiness": {
        "replacements": {
            "due to the fact that": "because",
            "at this point in time": "now",
            "in spite of the fact that": "although",
            "in the event that": "if",
            "on account of the fact that": "because",
        },
    },
    # 批 102：后置条件从句（ZH_POSTPOSED_CONDITION）。中文条件前置；
    # 「……，如果 B。」是英文语序。只锁条件标记，不锁「因为」（后置追补正常）。
    "zh_postposed_condition": {
        "chinese": ["如果", "假如", "倘若", "一旦", "要是", "若"],
    },
    # 批 102：由于/因为 X，使得/致使/导致 Y（ZH_DUE_TO_MAKE）。
    # 介词短语不能作主语，全句缺主，是语法错。
    "zh_due_to_make": {
        "chinese": ["由于", "因为"],
        "effects": ["使得", "致使", "导致"],
    },
    # 批 104：中文轻动词＋名词（ZH_LIGHT_VERB_NOUN）。词性来自分词底座
    # factscribe/segment.py；只认名词侧（n 开头，另含 vn 动名词）。
    "zh_light_verb_noun": {
        "verbs": ["进行", "作出", "加以", "给予", "予以"],
        # 正常搭配：状态/时间/既定说法，不报。
        "exempt_phrases": ["进行中", "进行时", "作出决定"],
        # 「动作其实是什么」：名词 -> 动词。查不到时给通用改法，不瞎猜。
        "actions": {
            "分析": "分析", "研究": "研究", "评估": "评估",
            "调整": "调整", "优化": "优化", "改进": "改进",
            "调查": "调查", "检验": "检验", "测量": "测量",
            "管理": "管理", "建设": "建设", "发展": "发展",
            "改革": "改革", "实验": "实验", "测试": "测试",
            "验证": "验证", "分类": "分类", "定义": "定义",
            "总结": "总结", "报告": "报告", "计划": "计划",
            "贡献": "贡献", "建议": "建议", "决定": "决定",
            "讨论": "讨论", "说明": "说明", "比较": "比较",
            "介绍": "介绍", "解释": "解释", "描述": "描述",
            "观察": "观察", "计算": "计算", "处理": "处理",
            "支持": "支持", "帮助": "帮助", "保护": "保护",
            "控制": "控制", "限制": "限制", "关注": "关注",
            "考虑": "考虑", "理解": "理解", "要求": "要求",
        },
    },
    # 批 105 B1：英文名词化密度（NOMINALIZATION_RATE）。
    # 先按后缀数「名词化词形」，再剥离本文词频最高的 5 个类型（当作领域
    # 术语），最后按每百词百分数报。后缀不含裸 -al/-ic/-ive。
    "nominalization": {
        "suffixes": ["tion", "sion", "ment", "ance", "ence", "ity",
                     "ness", "ism"],
        "min_length": 5,
        "strip_top": 5,
    },
    # 批 105 B2：动词后「着」（ZH_ASPECT_ZHE）。分词后只认
    # 「动词 ＋ 着」与「动词词尾着」；词内用法（沿着/照着/接着/意味着）
    # 不是进行体，进排除表。
    "zh_aspect_zhe": {
        "exclude": ["意味着", "标志着", "象征着", "预示着", "代表着",
                    "照着", "沿着", "朝着", "向着", "随着", "接着",
                    "跟着", "当着", "为着", "冲着", "凭着", "按着",
                    "依着", "据着", "本着", "对着", "关于", "够得着",
                    "够不着", "来着", "合着"],
    },
    # 批 105 B3：当……的时候 / 当……之后 / 当……时。
    # 形态固定，按条报；「当成/当作/当然/当天」这类词内「当」不算。
    "zh_dang_when": {
        "tails": ["的时候", "之后", "时"],
        # 「当」后紧跟这些字时是词内用法（当成/当作/当天/当时…）。
        "forbid_heads": ["成", "作", "然", "即", "初", "场", "时", "天",
                         "年", "月", "日", "前", "中", "下", "上", "面",
                         "真", "众", "地", "晚", "夜", "早", "代", "今"],
    },
    # 批 105 B4：搭配冗余。每条给匹配式与删法；单位＝处。
    "zh_collocation_redundancy": {
        "items": [
            {"label": "大约…左右",
             "pattern": "大约[^。！？；]{0,20}左右",
             "fix": "删「大约」或「左右」，只留一个"},
            {"label": "唯一一个",
             "pattern": "唯一一个",
             "fix": "删「一个」，写「唯一」"},
            {"label": "相互之间",
             "pattern": "相互之间",
             "fix": "删「相互」，写「之间」"},
            {"label": "彼此互相",
             "pattern": "彼此互相",
             "fix": "删「彼此」或「互相」，只留一个"},
            {"label": "提前预…",
             "pattern": "提前预[先进订定约热租告测]",
             "fix": "删「提前」，写「预订/预支/预约」"},
            {"label": "免费赠送",
             "pattern": "免费赠送",
             "fix": "删「免费」，赠送本身就不收钱"},
            {"label": "亲眼目睹",
             "pattern": "亲眼目睹",
             "fix": "删「亲眼」，目睹本身就是亲眼看见"},
            {"label": "再次重申",
             "pattern": "再次重申",
             "fix": "删「再次」，重申就是再说一次"},
            {"label": "一致公认",
             "pattern": "一致公认",
             "fix": "删「一致」，公认就是一致认为"},
            {"label": "首先第一",
             "pattern": "首先第一",
             "fix": "删「首先」或「第一」，只留一个"},
        ],
    },
    # 批 105 B5：缩写首现（ABBREV_FIRST_USE）。≥2 个大写字母的缩写，
    # 首次出现时同句或前一句须有「全称（ABC）」。罗马数字与文献标记
    # 不是缩写，进排除表。
    "abbrev_rules": {
        "min_letters": 2,
        "exclude": ["II", "III", "IV", "VI", "VII", "VIII", "IX", "XI",
                    "XII", "XIII", "XIV", "XV", "TODO", "TBD", "FIXME"],
    },
    # 批 129：WE_ACTION_DENSITY 的动作动词表。只收「做了一件事」的动词；
    # 提出/主张/认为/说明这类修辞或认知动词不收（「我们提出」不算动作句）。
    "we_action": {
        "english": ["ran", "run", "runs", "running",
                    "did", "do", "does", "doing",
                    "tried", "try", "tries", "trying",
                    "changed", "change", "changes", "changing",
                    "added", "add", "adds", "adding",
                    "removed", "remove", "removes", "removing",
                    "tested", "test", "tests", "testing",
                    "looked", "look", "looks", "looking"],
        "chinese": ["跑", "做", "试", "改", "加", "删", "测", "查", "记",
                    "尝试", "修改", "增加", "添加", "删除", "运行",
                    "测试", "测量", "检查", "记录", "核对", "查验"],
    },
}

# 指标方向：True = 超过阈值触发；False = 低于阈值触发；单点指标用下限。
DIRECTIONS = {
    "connective_density": "above",
    "sentence_uniformity": "below",
    "empty_adjective": "above",
    "paragraph_template": "above",
    "explainer_density": "above",
    "justify_chain": "at_least",
    "hedge_stack": "at_least",
    "repeated_opener": "at_least",
    "sentence_length_extreme": "at_least",
    "rhythm_plateau": "at_least",
    # v4
    "dash_parenthetical": "above",
    "heading_too_long": "at_least",
    "term_first_in_heading": "at_least",
    "colloquial_triad": "at_least",
    # v5 改写后复检
    "heading_echo": "at_least",
    "heading_relation_changed": "at_least",
    "heading_subject_lost": "at_least",
    "heading_substituted": "at_least",
    # 批 90 术语层（TERM_UNREGISTERED 只提示，不进本表）
    "term_variant": "at_least",
    # 批 102 句法级判据（按条件计数，>= 1 触发）
    "light_verb_nominalization": "at_least",
    "wordiness_bloat": "at_least",
    "zh_de_stack": "at_least",
    "zh_postposed_condition": "at_least",
    "zh_due_to_make": "at_least",
    # 批 104
    "zh_light_verb_noun": "at_least",
    # 批 105 B 档
    "nominalization_rate": "above",
    "zh_aspect_zhe": "above",
    "zh_dang_when": "at_least",
    "zh_collocation_redundancy": "at_least",
    "abbrev_first_use": "at_least",
    # 批 128：篇幅预算（值＝超预算最狠的百分比）
    "section_length": "above",
    # 批 129：读者感觉三项的代理判据（全黄，退出码不变）
    "numeral_density": "above",
    "section_overlap": "above",
    "we_action_density": "above",
}

CODE_OF = {
    "connective_density": "CONNECTIVE_DENSITY",
    "sentence_uniformity": "SENTENCE_UNIFORMITY",
    "empty_adjective": "EMPTY_ADJECTIVE",
    "paragraph_template": "PARAGRAPH_TEMPLATE",
    "explainer_density": "EXPLAINER_DENSITY",
    "justify_chain": "JUSTIFY_CHAIN",
    "hedge_stack": "HEDGE_STACK",
    "repeated_opener": "REPEATED_OPENER",
    "sentence_length_extreme": "SENTENCE_LENGTH_EXTREME",
    "rhythm_plateau": "RHYTHM_PLATEAU",
    # v4
    "dash_parenthetical": "DASH_PARENTHETICAL",
    "heading_too_long": "HEADING_TOO_LONG",
    "term_first_in_heading": "TERM_FIRST_IN_HEADING",
    "colloquial_triad": "COLLOQUIAL_TRIAD",
    # v5 改写后复检
    "heading_echo": "HEADING_ECHO",
    "heading_relation_changed": "HEADING_RELATION_CHANGED",
    "heading_subject_lost": "HEADING_SUBJECT_LOST",
    "heading_substituted": "HEADING_SUBSTITUTED",
    # 批 90 术语层
    "term_variant": "TERM_VARIANT",
    "term_unregistered": "TERM_UNREGISTERED",
    # 批 102 句法级判据
    "light_verb_nominalization": "LIGHT_VERB_NOMINALIZATION",
    "wordiness_bloat": "WORDINESS_BLOAT",
    "zh_de_stack": "ZH_DE_STACK",
    "zh_postposed_condition": "ZH_POSTPOSED_CONDITION",
    "zh_due_to_make": "ZH_DUE_TO_MAKE",
    "zh_light_verb_noun": "ZH_LIGHT_VERB_NOUN",
    # 批 105 B 档
    "nominalization_rate": "NOMINALIZATION_RATE",
    "zh_aspect_zhe": "ZH_ASPECT_ZHE",
    "zh_dang_when": "ZH_DANG_WHEN",
    "zh_collocation_redundancy": "ZH_COLLOCATION_REDUNDANCY",
    "abbrev_first_use": "ABBREV_FIRST_USE",
    # 批 128
    "section_length": "SECTION_LENGTH",
    # 批 129
    "numeral_density": "NUMERAL_DENSITY",
    "section_overlap": "SECTION_OVERLAP",
    "we_action_density": "WE_ACTION_DENSITY",
}

FINDING_ORDER = ["REQUIRED_EVIDENCE_MISSING", "EVIDENCE_DROPPED",
                 "SENTENCE_LENGTH_EXTREME", "DASH_PARENTHETICAL",
                 "HEADING_TOO_LONG",
                 "HEADING_ECHO", "HEADING_RELATION_CHANGED",
                 "HEADING_SUBJECT_LOST", "HEADING_SUBSTITUTED",
                 "TERM_FIRST_IN_HEADING",
                 "TERM_VARIANT", "TERM_UNREGISTERED",
                 "LIGHT_VERB_NOMINALIZATION", "WORDINESS_BLOAT",
                 "ZH_DE_STACK", "ZH_POSTPOSED_CONDITION", "ZH_DUE_TO_MAKE",
                 "ZH_LIGHT_VERB_NOUN",
                 "NOMINALIZATION_RATE", "ZH_ASPECT_ZHE", "ZH_DANG_WHEN",
                 "ZH_COLLOCATION_REDUNDANCY", "ABBREV_FIRST_USE",
                 "SECTION_LENGTH",
                 "NUMERAL_DENSITY", "SECTION_OVERLAP", "WE_ACTION_DENSITY",
                 "HEDGE_STACK", "CONNECTIVE_DENSITY", "EMPTY_ADJECTIVE",
                 "COLLOQUIAL_TRIAD", "PARAGRAPH_TEMPLATE", "EXPLAINER_DENSITY",
                 "JUSTIFY_CHAIN", "REPEATED_OPENER",
                 "RHYTHM_PLATEAU", "SENTENCE_UNIFORMITY"]

_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
_LATIN_WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9'’\-]*")

# 批 129：读者感觉三项的代理判据。
# 阿拉伯数字 token：整数、小数、千分位都算一个 token；斜杠两侧分开算。
_NUMERAL_TOKEN_RE = re.compile(r"\d+(?:[.,]\d+)*")
# SECTION_OVERLAP 的片段长度：英文 8 词、中文 12 字（固定口径，见规范）。
_OVERLAP_SHINGLE_EN = 8
_OVERLAP_SHINGLE_ZH = 12
# 太短的节不判重叠：单句引用同一事实会因分母太小被误判成重复。
_OVERLAP_MIN_SHINGLES = 20
# WE_ACTION_DENSITY：主语与谓语之间允许出现的副词/助动词。
_WE_EN_SKIP = {
    "then", "also", "first", "finally", "still", "only", "not", "never",
    "again", "now", "already", "recently", "separately", "jointly",
    "have", "has", "had", "having", "will", "would", "can", "could",
    "may", "might", "must", "shall", "should", "subsequently", "later",
}
_WE_ZH_SKIP = ("也", "又", "还", "再", "先", "随后", "接着", "然后",
               "分别", "已经", "已", "曾", "都", "就", "便", "只", "仍",
               "仍然", "再次", "依次", "逐一", "随后又")


# --------------------------------------------------------------------------
# 规则装载
# --------------------------------------------------------------------------

def _merge(base: dict, override: dict) -> dict:
    out = {k: (dict(v) if isinstance(v, dict) else list(v) if isinstance(v, list) else v)
           for k, v in base.items()}
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


def _rules_candidates(project_root: Path) -> list[Path]:
    here = Path(__file__).resolve().parent
    return [Path(project_root) / STYLE_RULES_NAME,
            here.parent / STYLE_RULES_NAME,
            here / STYLE_RULES_NAME]


def _flatten_override_keys(raw: dict, base: dict = DEFAULT_RULES,
                           prefix: str = "") -> list[str]:
    """把文件里的键展开成点号路径，只留与内置默认**不同**的键。

    值相等的不算覆盖（把默认文件整份抄进项目不会报「覆盖了 60 个键」）。
    未知键也算覆盖——它们同样改变了判定面。
    """
    keys: list[str] = []
    for key, value in (raw or {}).items():
        dotted = prefix + key
        if key not in base:
            keys.append(dotted)
        elif isinstance(value, dict) and isinstance(base.get(key), dict):
            keys.extend(_flatten_override_keys(value, base[key], dotted + "."))
        elif value != base.get(key):
            keys.append(dotted)
    return keys


def _strip_cli_only(raw: dict) -> tuple[dict, list[str]]:
    """去掉只允许命令行控制的键；返回 (干净配置, 被忽略的键名)。"""
    ignored = [key for key in CLI_ONLY_RULE_KEYS if key in (raw or {})]
    if not ignored:
        return raw or {}, []
    clean = {key: value for key, value in raw.items()
             if key not in CLI_ONLY_RULE_KEYS}
    return clean, ignored


def _rule_report(raw: dict, path: Path, source: str,
                 ignored: list[str]) -> dict:
    clean, stripped = _strip_cli_only(raw)
    ignored = list(ignored or []) + [k for k in stripped if k not in ignored]
    keys = [k for k in _flatten_override_keys(clean)
            if k not in CLI_ONLY_RULE_KEYS]
    return {"present": True, "path": str(path), "source": source,
            "count": len(keys), "keys": keys, "ignored": ignored}


def project_rule_report(project_root: Path) -> dict:
    """只读项目内 style-rules.toml，与内置默认逐键比较（不装载规则）。

    ``style`` / ``review`` / ``audit`` 共用这一份读数：本项目覆盖了哪些
    规则键、哪些键因为「只能命令行控制」而被忽略。没文件时
    ``present=False``，输出里不出现覆盖行。
    """
    path = Path(project_root) / STYLE_RULES_NAME
    if not path.is_file():
        return {"present": False, "path": None, "source": "default",
                "count": 0, "keys": [], "ignored": []}
    return _rule_report(load_toml(path), path, "project", [])


def _ignored_warning(report: dict) -> dict | None:
    """把「被忽略的键」装成一条 ``RULES_OVERRIDE_IGNORED`` 告警。"""
    ignored = list((report or {}).get("ignored") or [])
    if not ignored:
        return None
    return {
        "code": "RULES_OVERRIDE_IGNORED",
        "severity": "warning",
        "keys": ignored,
        "ignored": ignored,
        "message": ("项目内 %s 设置了只允许命令行控制的键：%s。这些键已被"
                    "忽略；阶段开关请用 style --stage draft|revision。"
                    % (STYLE_RULES_NAME, "、".join(ignored))),
    }


@dataclass
class RulesLoad:
    """装载结果：规则本体＋来源＋覆盖/忽略读数（批 130）。"""

    rules: dict
    path: str
    source: str
    report: dict


def load_style_rules_info(project_root: Path, explicit: str | None = None
                          ) -> RulesLoad:
    """装载规则，并报告项目覆盖了哪些键、哪些键被忽略（批 130）。"""
    if explicit:
        path = Path(explicit)
        if not path.is_file():
            raise ConfigError("--rules 指向的 %s 不存在" % path)
        raw = load_toml(path)
        report = _rule_report(raw, path, "explicit", [])
        clean, _ignored = _strip_cli_only(raw)
        return RulesLoad(_merge(DEFAULT_RULES, clean), str(path),
                         "explicit", report)
    for index, path in enumerate(_rules_candidates(project_root)):
        if not path.is_file():
            continue
        raw = load_toml(path)
        if index == 0:
            report = _rule_report(raw, path, "project", [])
        else:
            # 仓根/发行包自带文件不是「被测项目的覆盖」，只静默去掉
            # 命令行专属键，不进覆盖清单。
            clean, _ignored = _strip_cli_only(raw)
            report = {"present": False, "path": str(path), "source": "repo",
                      "count": 0, "keys": [], "ignored": []}
            return RulesLoad(_merge(DEFAULT_RULES, clean), str(path),
                             "repo", report)
        clean, _ignored = _strip_cli_only(raw)
        return RulesLoad(_merge(DEFAULT_RULES, clean), str(path),
                         "project", report)
    return RulesLoad(_merge(DEFAULT_RULES, {}), "内置默认值", "default",
                     {"present": False, "path": None, "source": "default",
                      "count": 0, "keys": [], "ignored": []})


def load_style_rules(project_root: Path, explicit: str | None = None
                     ) -> tuple[dict, str]:
    """返回 (规则, 来源说明)。显式 --rules 缺失即配置错；默认文件缺失走内置。"""
    info = load_style_rules_info(project_root, explicit)
    return info.rules, info.path


def _thresholds(rules: dict) -> dict:
    raw = rules.get("thresholds") or {}
    out = {}
    for key, default in DEFAULT_RULES["thresholds"].items():
        value = raw.get(key, default)
        if value is None:
            if key in NULLABLE_THRESHOLDS:
                out[key] = None
                continue
            raise ConfigError("style-rules.toml 的 thresholds.%s 不能为 null，"
                              "必须是数字" % key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ConfigError("style-rules.toml 的 thresholds.%s 必须是数字，"
                              "现在是 %r" % (key, value))
        if value < 0:
            raise ConfigError("style-rules.toml 的 thresholds.%s 不能为负" % key)
        out[key] = value
    return out


def _limits(rules: dict) -> dict:
    raw = rules.get("limits") or {}
    out = {}
    for key, default in DEFAULT_RULES["limits"].items():
        value = raw.get(key, default)
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise ConfigError("style-rules.toml 的 limits.%s 必须是正整数，"
                              "现在是 %r" % (key, value))
        out[key] = value
    return out


def _words(rules: dict, group: str) -> list[str]:
    raw = (rules.get(group) or {}).get("english") or []
    return [str(x) for x in raw if str(x).strip()]


def _cn_words(rules: dict, group: str) -> list[str]:
    raw = (rules.get(group) or {}).get("chinese") or []
    return [str(x) for x in raw if str(x).strip()]


def _phrase_regex(phrases: list[str]) -> re.Pattern | None:
    if not phrases:
        return None
    parts = []
    for phrase in sorted(phrases, key=len, reverse=True):
        parts.append(re.escape(phrase).replace(r"\ ", r"\s+"))
    return re.compile(r"(?<![A-Za-z0-9])(?:%s)(?![A-Za-z0-9])" % "|".join(parts),
                      re.IGNORECASE)


# --------------------------------------------------------------------------
# LaTeX -> 纯正文（等长遮罩，保留换行）
# --------------------------------------------------------------------------

_SKIP_ENV_RE = re.compile(
    r"\\begin\s*\{(verbatim\*?|Verbatim|lstlisting|minted|comment\*?|fsignore"
    r"|quote|quotation|verse"
    r"|equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?|displaymath|math"
    r"|figure\*?|table\*?|tabular\*?|tabularx|thebibliography"
    r"|algorithm\*?|algorithmic|tikzpicture)\}.*?\\end\s*\{\1\}",
    re.S)
_HEADING_RE = re.compile(
    r"\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph"
    r"|caption|title|author|date|thanks)\*?\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}")
_CITE_RE = re.compile(
    r"\\[A-Za-z]*[Cc]ite[A-Za-z]*\*?(?:\s*\[[^\]]*\])*(?:\s*\{[^{}]*\})")
_SKIP_CMDS = {
    "ref", "eqref", "pageref", "autoref", "cref", "Cref", "nameref", "vref",
    "label", "input", "include", "includeonly", "subfile", "includegraphics",
    "bibliography", "bibliographystyle", "addbibresource", "url", "href",
    "centering", "raggedright", "raggedleft", "noindent", "newpage",
    "clearpage", "appendix", "maketitle", "tableofcontents", "linebreak",
    "pagebreak", "hfill", "vfill", "quad", "qquad", "item",
}
_CMD_RE = re.compile(r"\\([A-Za-z]+)\*?")
_FACT_RE = re.compile(r"\\fact\s*\{[^{}]*\}")


def _blank(chars: list, start: int, stop: int) -> None:
    for i in range(max(0, start), min(stop, len(chars))):
        if chars[i] != "\n":
            chars[i] = " "


def _find_math_closer(s: str, start: int, closer: str) -> int:
    """从 start 起找未转义的数学闭合符（\\) 或 \\]）；找不到返回 -1。

    反斜杠一律按「转义下一个字符」跳过，因此 `\\\\)`（换行命令后跟右括号）
    不会被误认为闭合符。
    """
    i, n = start, len(s)
    while i < n:
        if s.startswith(closer, i):
            return i
        if s[i] == "\\":
            i += 2
            continue
        i += 1
    return -1


def _mask_inline_math(chars: list) -> None:
    """把 $...$、$$...$$、\\(...\\)、\\[...\\] 抹成空白（保留换行）。

    转义序列必须先于定界符处理：`\\$` 是**字面美元符号**（价格），不是数学
    模式起点；`\\\\` 是换行命令，后面的 `[` 也不能被当成 `\\[` 数学定界符。
    否则正文里出现一个 `\\$0.05` 就会把后面整段吞进数学模式，导致词数、句数
    与句长统计系统性偏低（批 71）。
    """
    s = "".join(chars)
    i, n = 0, len(s)
    while i < n:
        c = s[i]
        if c == "\\":
            nxt = s[i + 1] if i + 1 < n else ""
            if nxt in ("(", "["):
                closer = "\\)" if nxt == "(" else "\\]"
                end = _find_math_closer(s, i + 2, closer)
                if end < 0:
                    end = n
                else:
                    end += 2
                _blank(chars, i, end)
                i = end
                continue
            # `\$`、`\%`、`\\`、`\{` 等：转义后是字面字符或换行命令，
            # 都不是数学模式；连反斜杠一起跳过。
            i += 2
            continue
        if c == "$":
            if i + 1 < n and s[i + 1] == "$":
                j = i + 2
                while j < n:
                    if s[j] == "\\":
                        j += 2
                        continue
                    if s.startswith("$$", j):
                        break
                    j += 1
                end = n if j >= n else j + 2
            else:
                j = i + 1
                while j < n:
                    if s[j] == "\\":
                        j += 2
                        continue
                    if s[j] == "$":
                        break
                    j += 1
                end = n if j >= n else j + 1
            _blank(chars, i, end)
            i = end
            continue
        i += 1


def prose_of(tex: str) -> str:
    """返回纯正文：保留换行，行号与源文件一一对应。

    注释在剥离时会缩短该行（列位置左移），但换行全部保留，因此位置→行号
    的映射仍然有效；文风统计只用到行号。
    """
    live, _defs = _live_text(tex)
    chars = list(live)
    for m in _SKIP_ENV_RE.finditer(live):
        _blank(chars, m.start(), m.end())
    s = "".join(chars)
    # 写作批注宏：连同参数整块去掉（不是正文命题）
    for m in re.finditer(r"\\(?:todoq|todo|fixme|tbd|pknote|note)\b"
                         r"(?:\s*\[[^\]]*\])?\s*(?:\{[^{}]*\})?", s):
        _blank(chars, m.start(), m.end())
    _mask_inline_math(chars)
    s = "".join(chars)
    for m in _HEADING_RE.finditer(s):
        _blank(chars, m.start(), m.end())
    s = "".join(chars)
    for m in _CITE_RE.finditer(s):
        _blank(chars, m.start(), m.end())
    s = "".join(chars)
    # \fact{ID} 只抹 ID 参数；V3 的第二个参数是渲染出来的数字，保留
    for m in _FACT_RE.finditer(s):
        _blank(chars, m.start(), m.end())
    s = "".join(chars)
    # 结构命令名与「不渲染内容」的命令参数
    out = list(s)
    pos = 0
    while True:
        m = _CMD_RE.search(s, pos)
        if not m:
            break
        name = m.group(1)
        j = m.end()
        if name in _SKIP_CMDS:
            # 吞掉紧随的一个可选参数与一个必选参数
            k = j
            while k < len(s) and s[k] in " \t":
                k += 1
            if k < len(s) and s[k] == "[":
                k = _balanced_end(s, k, "[", "]")
            k2 = k
            while k2 < len(s) and s[k2] in " \t":
                k2 += 1
            if k2 < len(s) and s[k2] == "{":
                k = _balanced_end(s, k2, "{", "}")
            _blank(out, m.start(), k)
            pos = max(k, m.end())
            continue
        _blank(out, m.start(), j)
        pos = m.end()
    prose = "".join(out)
    # 换行命令 \\ 与其可选间距参数（\\[2pt]）是排版结构，不参与文风统计
    prose = re.sub(r"\\\\\*?(?:\[[^\]]*\])?",
                   lambda m: " " * len(m.group(0)), prose)
    # 残余的转义与结构字符：等长替换
    prose = re.sub(r"\\%", "%", prose)
    prose = re.sub(r"\\&", "&", prose)
    prose = re.sub(r"\\\$", "$", prose)
    prose = re.sub(r"\\_", "_", prose)
    prose = re.sub(r"\\#", "#", prose)
    prose = re.sub(r"\\{", "{", prose)
    prose = re.sub(r"\\}", "}", prose)
    prose = re.sub(r"\\[A-Za-z]+\*?", lambda m: " " * len(m.group(0)), prose)
    prose = re.sub(r"~", " ", prose)
    prose = re.sub(r"[{}\[\]]", " ", prose)
    return prose


def _balanced_end(s: str, start: int, opener: str, closer: str) -> int:
    depth = 0
    i = start
    while i < len(s):
        if s[i] == "\\":
            i += 2
            continue
        if s[i] == opener:
            depth += 1
        elif s[i] == closer:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return len(s)


# --------------------------------------------------------------------------
# 计数单元与句子
# --------------------------------------------------------------------------

def units_of(text: str) -> int:
    """英文按词、中文按字；混排时中文 1 字＝1 单元，英文 1 词＝1 单元。"""
    cjk = len(_CJK_RE.findall(text))
    latin = len(_LATIN_WORD_RE.findall(text))
    return cjk + latin


def _cjk_heavy(text: str) -> bool:
    cjk = len(_CJK_RE.findall(text))
    latin = len(_LATIN_WORD_RE.findall(text))
    return cjk > 0 and cjk >= latin


def _norm_space(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _clip(text: str, limit: int) -> str:
    text = _norm_space(text)
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


@dataclass
class Finding:
    code: str
    file: str
    line: int
    text: str
    suggestion: str
    metric: str = ""
    severity: str = "yellow"
    # i18n（只增字段）：message_key 指向 factscribe/i18n.py 的双语目录，
    # params 是模板槽位的取值。suggestion 仍是中文原文。
    message_key: str = ""
    params: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {"code": self.code, "severity": self.severity,
                "file": self.file, "line": self.line,
                "text": self.text, "suggestion": self.suggestion}


@dataclass
class ParagraphInfo:
    file: str
    line: int
    words: int
    flags: list = field(default_factory=list)
    first_word: str = ""

    def as_dict(self) -> dict:
        return {"file": self.file, "line": self.line, "words": self.words,
                "flags": self.flags}


@dataclass
class StyleResult:
    metrics: dict
    thresholds: dict
    fired: list
    findings: list
    paragraphs: list
    instances: dict
    summary: dict
    rules_path: str = ""
    stage_assessment: dict = field(default_factory=dict)
    info: list = field(default_factory=list)
    advisories: list = field(default_factory=list)
    metric_details: dict = field(default_factory=dict)
    # 批 130：规则覆盖读数（informational，不进 findings、不改退出码）。
    rule_overrides: dict = field(default_factory=lambda: {
        "present": False, "path": None, "source": "default",
        "count": 0, "keys": [], "ignored": []})
    rule_warnings: list = field(default_factory=list)
    stage: str = STAGE_DRAFT

    @property
    def exit_code(self) -> int:
        # 批 131：证据钢印是红（阻断，退出码 1）；其余命中仍是黄。
        if any(getattr(f, "severity", "yellow") == "red"
               for f in self.findings):
            return EXIT_RED
        return EXIT_YELLOW if self.fired else EXIT_OK

    def as_dict(self) -> dict:
        return {
            "metrics": self.metrics,
            "thresholds": dict(self.thresholds),
            "findings": [f.as_dict() for f in self.findings],
            "info": [f.as_dict() for f in self.info],
            "advisories": [f.as_dict() for f in self.advisories],
            "paragraphs": [p.as_dict() for p in self.paragraphs],
            "fired": self.fired,
            "summary": self.summary,
            "stage_assessment": dict(self.stage_assessment),
            "rules": self.rules_path,
            "metric_details": dict(self.metric_details),
            "rule_overrides": dict(self.rule_overrides),
            "rule_warnings": list(self.rule_warnings),
            "stage": self.stage,
            "disclaimer": DISCLAIMER,
        }


@dataclass
class _Doc:
    file: str
    prose: str
    newlines: list
    raw: str = ""
    headings: list = field(default_factory=list)
    list_prose: str = ""
    list_spans: list = field(default_factory=list)


def _source_view(text: str, fmt: str = "tex"
                 ) -> tuple[str, list, str, str, list]:
    """格式分派入口：返回 (prose, 标题清单, 活跃原文, 列表视图, 列表区间)。

    ``tex`` 走既有 LaTeX 路径（行为逐字节不变）；``markdown`` 走 mdscan；
    ``text`` 按纯文本处理（不遮罩、无标题、无列表视图）。
    """
    if fmt == "markdown":
        scan = mdscan.scan_markdown(text)
        return (scan.prose, scan.headings, text,
                scan.list_prose, scan.list_spans)
    if fmt == "text":
        scan = mdscan.scan_plain(text)
        return scan.prose, scan.headings, text, "", []
    prose = prose_of(text)
    live, _defs = _live_text(text)   # 标题扫描走活跃正文（注释里的标题不算）
    return prose, _headings(live), live, "", []


def _line_of(doc: _Doc, pos: int) -> int:
    return bisect.bisect_right(doc.newlines, pos) + 1


def _paragraphs(doc: _Doc, min_units: int):
    """按空行切段，返回 [(start, end)]。"""
    out = []
    for m in re.finditer(r"[^\n]*(?:\n(?!\s*\n)[^\n]*)*", doc.prose):
        start, end = m.start(), m.end()
        if not doc.prose[start:end].strip():
            continue
        if units_of(doc.prose[start:end]) >= min_units:
            out.append((start, end))
    return out


def _sentences(prose: str, base: int = 0):
    """句子区间（绝对位置），只保留有内容的。"""
    spans = sentence_spans(prose)
    out = []
    for start, end in spans:
        if not prose[start:end].strip():
            continue
        if units_of(prose[start:end]) < 2:
            continue
        out.append((base + start, base + end))
    return out


# --------------------------------------------------------------------------
# 各项指标
# --------------------------------------------------------------------------

def _iter_matches(text: str, eng_re, cn_words):
    """返回 [(start, end, matched)]；英文按词边界、中文按子串。"""
    found = []
    if eng_re is not None:
        for m in eng_re.finditer(text):
            found.append((m.start(), m.end(), m.group(0)))
    for word in cn_words:
        start = 0
        while True:
            idx = text.find(word, start)
            if idx < 0:
                break
            if not any(s <= idx < e for s, e, _ in found):
                found.append((idx, idx + len(word), word))
            start = idx + len(word)
    found.sort()
    return found


def _strip_connective(sentence: str, token: str) -> str:
    """给出「删掉连接词」后的替换示例。"""
    low = sentence.lower()
    idx = low.find(token.lower())
    if idx < 0:
        return sentence
    end = idx + len(token)
    tail = sentence[end:]
    tail = re.sub(r"^[\s,，、;；:：]+", "", tail)
    return tail


# 句首允许出现的前置符号（引号、括号、Markdown 强调符）。
_LEAD_STRIP = " \t\r\n\"'“”‘’`«»「」『』()[]{}【】（）《》>#*_"


def _explainer_opener(sentence: str, eng_re, cn_words) -> str:
    """句首解释性套语；没有则返回空串。

    中文按前缀匹配，英文按词边界匹配，两者取最长命中。只判句首——
    句中的「这意味着」是正常行文，不算反射式解释。
    """
    head = sentence.lstrip(_LEAD_STRIP)
    if not head:
        return ""
    best = ""
    for word in cn_words:
        if head.startswith(word) and len(word) > len(best):
            best = word
    if eng_re is not None:
        m = eng_re.match(head)
        if m and len(m.group(0)) > len(best):
            best = m.group(0)
    return best


def _strip_opener(sentence: str, token: str) -> str:
    """给出「删掉句首套语」后的替换示例。"""
    head = sentence.lstrip(_LEAD_STRIP)
    if not head.lower().startswith(token.lower()):
        return sentence
    tail = head[len(token):]
    tail = re.sub(r"^[\s,，、;；:：。.!?！？—–-]+", "", tail)
    return tail or sentence


def _extreme_split(sentence: str) -> str:
    """在句子中段找一个可断点，给出拆分示例。"""
    words = list(re.finditer(r"\S+", sentence))
    if len(words) < 6:
        return sentence
    mid = len(words) // 2
    best = None
    best_dist = 10 ** 9
    for i, m in enumerate(words[:-1]):
        token = m.group(0)
        if token.endswith(",") or token.endswith("，") or token.endswith(";") \
                or token.endswith("；") or token == "and" or token == "but":
            dist = abs(i - mid)
            if dist < best_dist:
                best, best_dist = i, dist
    if best is None:
        return sentence
    left = " ".join(w.group(0) for w in words[:best + 1]).rstrip(",;，；")
    right = " ".join(w.group(0) for w in words[best + 1:])
    if not right:
        return sentence
    right = right[0].upper() + right[1:]
    return left + ". " + right


# 长句里的「结构断点」：从句引导词、分号、破折号、括号。
# 有断点的长句是专家写法，不报；只有「又长又平铺」才报。
_EN_BREAK_RE = re.compile(
    r"\b(?:which|that|who|whom|whose|because|although|though|while|whereas"
    r"|since|unless|if|when|whenever|where|wherever|after|before|as|whether"
    r"|despite|given|provided|such\s+that|so\s+that|in\s+order\s+that"
    r"|not\s+only|thereby|hence|thus)\b"
    r"|[;()\[\]]|—|–|--", re.IGNORECASE)
_CN_BREAK_RE = re.compile(
    r"因为|由于|虽然|尽管|如果|若是|只要|只有|无论|不论|即使|即便"
    r"|但是|然而|而且|并且|同时|因此|因而|从而|于是|以便|以致|甚至"
    r"|尤其|其中|以及|则|却|而|；|：|—|（|）|《|》|「|」")


def _has_structural_break(sentence: str) -> bool:
    """句内是否有从句/分号/破折号/括号这类换气点。"""
    if _cjk_heavy(sentence):
        return bool(_CN_BREAK_RE.search(sentence))
    return bool(_EN_BREAK_RE.search(sentence))


def _first_word(text: str) -> str:
    m = re.search(r"[A-Za-z][A-Za-z'’\-]*|[\u4e00-\u9fff]{1,4}", text)
    return m.group(0).lower() if m else ""


def _is_stopword(first: str, stops: set) -> bool:
    if not first:
        return True
    if _CJK_RE.match(first):
        return any(first.startswith(s) for s in stops
                   if s and _CJK_RE.match(s))
    return first in stops


# 批 110：同构排比只认模板式标记。顿号、逗号列举是正文内容（真实实验
# 条件、约束清单），不是模板；三项并列本身不报，只有同一模板在相邻段落
# 重复才算。列表项必须整体计数，不能截成三项。
_TRIAD_TEMPLATE_SERIES = (
    ("cn_first", ("首先", "其次", "再次", "最后"), 3),
    ("cn_di", ("第一", "第二", "第三"), 3),
    ("cn_yishi", ("一是", "二是", "三是"), 3),
    ("cn_qiyi", ("其一", "其二", "其三"), 3),
)
# 序数词后面必须跟分隔符，避免把「第一台机器」这类记数当成模板。
_TRIAD_ORDINAL_SEP = r"\s*[，,、：:]"


# --------------------------------------------------------------------------
# v4：破折号插入语、标题、术语白名单、同构三点并列
# --------------------------------------------------------------------------

_EM_DASH_RE = re.compile(r"——|—")
_HEADING_CMD_RE = re.compile(
    r"\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?"
    r"\s*(?:\[[^\]]*\])?\s*\{")
_TERM_SEP_RE = re.compile(r"[的和与及在对从为是]")
_TERM_STOP = {
    "a", "an", "the", "of", "for", "and", "or", "to", "in", "on", "with",
    "by", "from", "as", "at", "is", "are", "be", "this", "that", "these",
    "those", "how", "why", "what", "when", "where", "which", "who", "its",
    "our", "their", "we", "you", "i", "via", "using", "toward", "towards",
}


def _line_start(doc: _Doc, line: int) -> int:
    """第 ``line`` 行（1 起）在 prose 中的起点；越界返回文末。"""
    if line <= 1:
        return 0
    idx = line - 2
    if idx < len(doc.newlines):
        return doc.newlines[idx] + 1
    return len(doc.prose)


def _is_range_dash(prose: str, start: int, end: int) -> bool:
    """破折号是否属于数值范围或文献页码（这些不算插入语）。"""
    left = prose[max(0, start - 32):start]
    right = prose[end:end + 32]
    left_num = re.search(r"(\d+)\s*$", left)
    right_num = re.match(r"\s*(\d+)", right)
    if left_num and right_num:
        return True
    if right_num:
        if re.search(r"(?:pp?\.?|pages?)\s*\d+\s*$", left.lower()):
            return True
        if re.search(r"第\s*\d+\s*$", left) and re.match(r"\s*\d+\s*页", right):
            return True
    return False


def _heading_title(tex: str, brace: int) -> tuple[str, int]:
    """从 ``\\section{`` 的左花括号位置取出清理后的标题与闭合后的位置。"""
    end = _balanced_end(tex, brace, "{", "}")
    raw = tex[brace + 1:max(brace + 1, end - 1)]
    raw = re.sub(r"\\(?:label|thanks|footnote)\s*\{[^{}]*\}", " ", raw)
    raw = re.sub(r"\\[A-Za-z]+\*?", " ", raw)
    raw = re.sub(r"[$~{}\\^_]", " ", raw)
    return _norm_space(raw), end


def _headings(tex: str) -> list[dict]:
    """扫描源文件的章节标题（``\\title{}`` 不在其中，因此天然豁免）。"""
    out = []
    for m in _HEADING_CMD_RE.finditer(tex):
        brace = m.end() - 1          # 正则以 `{` 结尾
        title, end = _heading_title(tex, brace)
        if not title:
            continue
        out.append({
            "cmd": m.group(1),
            "title": title,
            "start": m.start(),
            "end": end,
            "line": tex.count("\n", 0, m.start()) + 1,
            "end_line": tex.count("\n", 0, end) + 1,
        })
    return out


def _term_candidates(title: str) -> list[str]:
    """从标题抽「术语样」词：中文 ≥4 字段；英文 ≥2 词短语。

    这是 ``TERM_FIRST_IN_HEADING`` 的候选面，沿用批 90 口径；
    ``TERM_UNREGISTERED`` 用更严格的 ``_unregistered_candidates``。
    """
    raw: list[str] = []
    for run in re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff]{4,}", title):
        for seg in _TERM_SEP_RE.split(run):
            if len(seg) >= 4:
                raw.append(seg)
    words = re.findall(r"[A-Za-z][A-Za-z0-9'’\-]*", title)
    run: list[str] = []
    for word in words:
        if word.lower() in _TERM_STOP:
            if len(run) >= 2:
                raw.append(" ".join(run))
            run = []
        else:
            run.append(word)
    if len(run) >= 2:
        raw.append(" ".join(run))
    out: list[str] = []
    seen: set[str] = set()
    for cand in raw:
        norm = _norm_space(cand)
        key = norm.lower()
        if norm and key not in seen:
            seen.add(key)
            out.append(norm)
    return out


_CJK_RUN_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+")
_LATIN_PHRASE_RE = re.compile(
    r"[A-Za-z][A-Za-z0-9'’\-]*(?:[ \t]+[A-Za-z][A-Za-z0-9'’\-]*)+")
# 候选两端是虚词时不是术语，是句子碎片。
_EDGE_FUNCTION_CHARS = set("的了和与在对是把被而或")
# 候选内部夹着强虚词/句法助词时更像从句，不是术语（如「好让时间线留档」）。
_INNER_CLAUSE_CHARS = set("让把被是的了而或且却")


def _overlaps(start: int, stop: int, spans: list[tuple[int, int]]) -> bool:
    return any(start < e and s < stop for s, e in spans)


def _bounded(text: str, start: int, stop: int) -> bool:
    """两侧必须是标点/空白/行首尾（不能紧贴字母或数字）。"""
    before = text[start - 1] if start > 0 else ""
    after = text[stop] if stop < len(text) else ""
    return not before.isalnum() and not after.isalnum()


def _unregistered_candidates(title: str, glossary: Glossary | None
                             ) -> list[str]:
    """TERM_UNREGISTERED 的候选：只从标题抽，形态收紧。

    * 中文：CJK 2–7 字，两侧被标点/空白/标题边界隔开；不与任何更长命中重叠；
    * 拉丁：≥2 个连续词（可含连字符），同样不与在册命中重叠；
    * 以虚词（的/了/和/与/在/对/是/把/被/而/或）开头或结尾的候选不收；
    * 候选内部夹着强句法助词（让/把/被/是/的/了/而/或/且/却）的不收。
    """
    spans = [(m.start, m.end) for m in glossary.matches(title)] if glossary else []
    out: list[str] = []
    seen: set[str] = set()

    def add(cand: str) -> None:
        cand = _norm_space(cand)
        key = cand.lower()
        if cand and key not in seen:
            seen.add(key)
            out.append(cand)

    for m in _CJK_RUN_RE.finditer(title):
        cand = m.group(0)
        if not (2 <= len(cand) <= 7):
            continue
        if cand[0] in _EDGE_FUNCTION_CHARS or cand[-1] in _EDGE_FUNCTION_CHARS:
            continue
        if any(ch in _INNER_CLAUSE_CHARS for ch in cand):
            continue
        if not _bounded(title, m.start(), m.end()):
            continue
        if _overlaps(m.start(), m.end(), spans):
            continue
        add(cand)

    for m in _LATIN_PHRASE_RE.finditer(title):
        if not _bounded(title, m.start(), m.end()):
            continue
        run: list[str] = []
        for word in m.group(0).split():
            if word.lower() in _TERM_STOP:
                if len(run) >= 2:
                    add(" ".join(run))
                run = []
            else:
                run.append(word)
        if len(run) >= 2:
            add(" ".join(run))
        # 单字/被虚词切断的残片不报；Latin ≥2 词是硬条件。
    return out


def _paper_term_matches(text: str, glossary: Glossary | None) -> list:
    """只保留论文词表（``paper.tsv`` / 项目 ``glossary.tsv``）的命中。

    ``TERM_FIRST_IN_HEADING`` 只判在册术语：README 这类非学术标题里的
    「黄牌规则」「已知缺口」不该被当成术语。未在册的词交给默认关闭的
    ``TERM_UNREGISTERED``。
    """
    if not glossary:
        return []
    return [m for m in glossary.matches(text) if m.term.source == "paper"]


def _glossary_for(rules: dict, project_root: Path) -> Glossary:
    """解析顺序：rules.term_glossary → 项目根 glossary.tsv → 仓内分层词表。

    项目自带的 ``glossary.tsv`` 视为论文术语表（参与 TERM_VARIANT）；
    仓内默认是 ``paper.tsv`` ＋ ``workspace.tsv`` 两层，同名以 paper 为准。
    """
    configured = str(rules.get("term_glossary") or "").strip()
    if configured:
        path = Path(configured)
        if not path.is_absolute():
            path = project_root / path
        if not path.is_file():
            raise ConfigError("style-rules.toml 的 term_glossary 指向的 %s 不存在"
                              % path)
        return load_glossary(path)
    project = project_root / "glossary.tsv"
    if project.is_file():
        return load_glossary(project)
    return load_glossary()


def _term_allowlist(rules: dict, project_root: Path,
                    glossary: Glossary | None = None
                    ) -> tuple[set[str], set[str]]:
    """读取术语白名单，返回（归一化匹配键, canonical）两个集合。

    条目先做归一化，再分别以匹配键与 canonical 入册；查白名单时两者都比。
    """
    names = rules.get("term_allow_files", DEFAULT_RULES["term_allow_files"])
    if not isinstance(names, (list, tuple)):
        names = [names]
    keys: set[str] = set()
    canonicals: set[str] = set()
    for name in names:
        path = project_root / str(name)
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            keys.add(key_of(line))
            if glossary is not None:
                canon = glossary.canonical_of(line)
                if canon:
                    canonicals.add(canon)
    return keys, canonicals


def _first_sentence_span_after(doc: _Doc, line: int,
                               stop_line: int | None = None
                               ) -> tuple[str, int]:
    """标题结束行之后的第一个非空句子；返回 (文本, 绝对起点)。

    ``stop_line`` 给定时，若该句落在下一个标题之后（本标题没有自己的正文），
    返回空——避免拿下一节的句子判本节。
    """
    if line < 1:
        line = 1
    base = _line_start(doc, line)
    for start, end in _sentences(doc.prose[base:], base):
        text = _norm_space(doc.prose[start:end])
        if not text:
            continue
        if stop_line is not None and _line_of(doc, start) >= stop_line:
            return "", -1
        return text, start
    return "", -1


def _first_sentence_after(doc: _Doc, line: int) -> str:
    """标题结束行之后的第一个非空句子（标题在 prose 里已被等长遮罩）。"""
    return _first_sentence_span_after(doc, line)[0]


# --------------------------------------------------------------------------
# v5：改写后复检（HEADING_ECHO / HEADING_RELATION_CHANGED /
#     HEADING_SUBJECT_LOST / HEADING_SUBSTITUTED / style --diff）
# --------------------------------------------------------------------------

_ECHO_STOP_EN = set(_TERM_STOP) | {
    "these", "those", "this", "that", "there", "here", "it", "its", "they",
    "their", "them", "we", "our", "us", "you", "your", "i", "my", "me",
    "he", "she", "his", "her", "are", "is", "was", "were", "be", "been",
    "being", "am", "do", "does", "did", "done", "have", "has", "had",
    "having", "will", "would", "can", "could", "should", "may", "might",
    "must", "shall", "not", "no", "nor", "only", "just", "also", "so",
    "then", "than", "but", "if", "because", "as", "at", "by", "for", "from",
    "in", "into", "of", "on", "or", "to", "with", "without", "and", "via",
    "using", "toward", "towards", "about", "all", "any", "each", "every",
    "some", "such", "same", "more", "most", "less", "least", "very",
    "which", "who", "whom", "whose", "what", "when", "where", "why", "how",
    "whether", "section", "subsection", "chapter", "paragraph", "paper",
    "one", "two", "three", "first", "second", "third", "per",
}

_ECHO_STOP_ZH_PHRASES = (
    "这些", "那些", "这个", "那个", "本节", "本文", "本小节", "这一节", "该节",
    "我们", "你们", "他们", "它们", "什么", "为什么", "如何", "以及", "或者",
    "并且", "可以", "需要", "应当", "应该", "已经", "正在", "还是", "不是",
    "没有", "一个", "一种", "一份", "一套", "方面", "来说", "而言", "说明",
)

_ECHO_STOP_ZH_CHARS = set(
    "的了着过吗呢吧啊呀哦嗯是在和与及对从为且而并或把被让使由向其之此该"
    "本我你他她它们这那就都也还又再很更最则即等有要会能可应需先将")

_ECHO_PUNCT_RE = re.compile(r"[\s。．.!！?？:：;；,，、\"'“”‘’()（）\[\]【】]+")

# 对比结构识别（§15.4）。「对」只认「A 对 B」里的介词，排除
# 对照 / 针对 / 面对 / 对比 / 对于 / 相对 / 绝对 等词内部的对。
_DUI_RE = re.compile(
    r"(?<![针面绝反相应核比一])对(?=\s*[A-Za-z0-9\u4e00-\u9fff])"
    r"(?![照于比此方应称象着])")
_YU_COMPARE_RE = re.compile(r"(.+?)与(.+?)(?:对比|相比|比较)")
_ORDINAL_EN = {"one", "two", "three", "four", "first", "second", "third",
               "fourth"}
_ORDINAL_ZH = set("一二三四")
# 同义关系词分组：组内互换不报，跨组替换报（§15.3）。
_RELATION_GROUPS = {
    "versus": "comparison", "vs": "comparison", "对": "comparison",
    "not": "negation", "不是": "negation",
    "without": "exclusion", "而非": "exclusion",
}

# 这些垫话单独出现在句首就是元话语，不需要先复述标题；
# 「里/中/方面/来说/而言」只在标题后紧跟时才算（见 _heading_echo）。
_DIRECT_META_ZH = ("本节讨论", "本节讲", "这里讨论", "这一节讨论", "我们讨论",
                   "本文讨论", "讨论的是", "讲的是", "谈的是", "要先", "先要",
                   "先问", "首先要", "需要先")


def _stem_en(word: str) -> str:
    """极轻量英文归一：大小写、所有格、常见复数。只为「同词」比较服务。"""
    w = word.lower().strip("'-")
    if w.endswith("'s"):
        w = w[:-2]
    if len(w) > 3 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not w.endswith(("ss", "us", "is")):
        return w[:-1]
    return w


def _en_terms(text: str, stop: set | None = None) -> list[str]:
    stop = _ECHO_STOP_EN if stop is None else stop
    out = []
    for raw in _LATIN_WORD_RE.findall(text):
        word = _stem_en(raw)
        if word and word not in stop:
            out.append(word)
    return out


def _echo_generic(rules: dict) -> tuple[set, list]:
    cfg = rules.get("heading_echo") or {}
    en = {_stem_en(str(x)) for x in (cfg.get("generic_terms_en") or [])}
    zh = [str(x) for x in (cfg.get("generic_terms_zh") or [])]
    return en, zh


def _cjk_content_chars(text: str, generic_zh: list) -> set:
    s = text
    for term in sorted(generic_zh, key=len, reverse=True):
        if term:
            s = s.replace(term, " ")
    for phrase in _ECHO_STOP_ZH_PHRASES:
        s = s.replace(phrase, " ")
    for ch in _ECHO_STOP_ZH_CHARS:
        s = s.replace(ch, " ")
    return set(_CJK_RE.findall(s))


def _new_content_terms(title: str, sentence: str, rules: dict,
                       glossary: Glossary | None = None) -> list[str]:
    """首句相对标题「新引入」的实义词；中文按字，英文按词。

    术语先归一：命中的表面形式从文本里删掉，canonical 作为独立单位参与
    比较。于是「预注册」与「事前登记」（同 canonical）互相抵消，不再被
    当成新信息；不同 canonical 仍然各算一个新单位。
    """
    def prepared(text: str) -> tuple[str, set]:
        if glossary is None:
            return text, set()
        return glossary.strip_terms(text)

    title_text, title_can = prepared(title)
    sentence_text, sentence_can = prepared(sentence)
    generic_en, generic_zh = _echo_generic(rules)
    if _cjk_heavy(title) or _cjk_heavy(sentence):
        head = {("§" + c) for c in title_can}
        sent = {("§" + c) for c in sentence_can}
        head |= _cjk_content_chars(title_text, generic_zh)
        sent |= _cjk_content_chars(sentence_text, generic_zh)
        return sorted(sent - head)
    head = {("§" + c) for c in title_can}
    sent = {("§" + c) for c in sentence_can}
    head |= {t for t in _en_terms(title_text) if t not in generic_en}
    sent |= {t for t in _en_terms(sentence_text) if t not in generic_en}
    return sorted(sent - head)


def _heading_key(text: str) -> str:
    return _ECHO_PUNCT_RE.sub(" ", text).strip().lower()


def _echo_meta_openers(rules: dict) -> tuple[tuple, tuple]:
    cfg = rules.get("heading_echo") or {}
    en = tuple(str(x).lower() for x in (cfg.get("meta_openers_en") or []))
    zh = tuple(str(x) for x in (cfg.get("meta_openers_zh") or []))
    return en, zh


def _echo_title_words(title: str, rules: dict,
                      glossary: Glossary | None = None) -> list[str]:
    """标题的实义词（去停用词、去泛化词；术语按 canonical 归一）。

    中文按实义字计（去停用字与泛化词），英文按实义词计。
    """
    generic_en, generic_zh = _echo_generic(rules)
    # 计数用标题原字面：术语归一只用于「首句 vs 标题」的比较，
    # 不用来判断标题本身是不是短语（否则在册术语会被剥掉）。
    text = title
    if _cjk_heavy(text):
        return sorted(_cjk_content_chars(text, generic_zh))
    return [t for t in _en_terms(text) if t not in generic_en]


def _echo_literal_span(title: str, sentence: str) -> bool:
    """标题的实义词是否在首句里成团连续出现（字面重复）。

    口径：标题归一（标点→空格、小写）后整串出现在首句归一串里。中间夹了
    别的实义词就不算「成团」——那是顺带提到，不是复述。
    """
    tkey = _heading_key(title)
    if not tkey:
        return False
    return tkey in _heading_key(sentence)


def _echo_is_opener(title: str, sentence: str, rules: dict) -> bool:
    """首句是不是「节首过渡句」（只报回声，不报正文里的同名表述）。"""
    meta_en, meta_zh = _echo_meta_openers(rules)
    sent_key = _heading_key(sentence)
    if any(sent_key.startswith(op) for op in meta_en):
        return True
    stripped = sentence.strip()
    if any(stripped.startswith(op) for op in _DIRECT_META_ZH):
        return True
    key = _heading_key(title)
    if key and sent_key.startswith(key):
        rest = sent_key[len(key):].lstrip()
        if any(rest.startswith(op) for op in meta_zh):
            return True
        if any(rest.startswith(op) for op in meta_en):
            return True
    return False


def _heading_echo(title: str, sentence: str, rules: dict,
                  thresholds: dict,
                  glossary: Glossary | None = None) -> bool:
    """节首句是否是节标题的「字面高度重复」（P-152 收紧口径）。

    只报回声，标题的实义词必须在首句里成团连续出现（字面重复，不是同义
    改写），且首句相对标题几乎不引入新实义：
      ① 首句一个实义词都没引入 → 整句就是标题的复述；或
      ② 首句是节首过渡句（「In this section, we …」「本节讨论…」这类开口）
         且新引入的实义词 ≤ heading_echo_max_new_terms（默认 3）。

    首句逐字等于标题的（解析把标题当正文的产物）不算回声。
    旧口径「首句没有新实义词」已按校准证据撤掉：真实语料里那一档几乎
    都是正常过渡，盲评 R2 轴成立的正例（F029/F036/F037/F039）全部是
    「In this section, we …」这一类节首过渡句，且都以标题字面复述开头。
    """
    if not sentence:
        return False
    cfg = rules.get("heading_echo") or {}
    min_terms = int(cfg.get("literal_min_terms", 2))
    max_new = int(thresholds["heading_echo_max_new_terms"])
    if _cjk_heavy(title) or _cjk_heavy(sentence):
        max_new = max_new * 2      # 汉字是更小的单位，按两倍算
    words = _echo_title_words(title, rules, glossary)
    if len(words) < min_terms:
        return False
    if not _echo_literal_span(title, sentence):
        return False
    if _heading_key(sentence) == _heading_key(title):
        return False
    new_terms = _new_content_terms(title, sentence, rules, glossary)
    if not new_terms:
        # 首句没有引入任何新实义词：整句就是标题的复述。
        return True
    if not _echo_is_opener(title, sentence, rules):
        return False
    return len(new_terms) <= max_new


def _relation_words(rules: dict) -> list[str]:
    raw = rules.get("heading_relation_words")
    if raw is None:
        raw = DEFAULT_RULES["heading_relation_words"]
    if not isinstance(raw, (list, tuple)):
        raw = [raw]
    return [str(x) for x in raw if str(x).strip()]


def _relation_hits(title: str, words: list[str]) -> list[str]:
    hits = []
    low = title.lower()
    for word in words:
        if _CJK_RE.search(word):
            if word == "对":
                # 只认「A 对 B」里的介词：排除 对照 / 针对 / 面对 / 对比 /
                # 对于 / 相对 / 绝对 这类词内部的「对」。
                if _DUI_RE.search(title) or _YU_COMPARE_RE.search(title):
                    hits.append(word)
            elif word in title:
                hits.append(word)
        elif re.search(r"(?<![A-Za-z])%s(?![A-Za-z])" % re.escape(word.lower()), low):
            hits.append(word.lower())
    return sorted(set(hits))


def _canon_relation(word: str) -> str:
    """关系词同义归一：同义关系词互换不算「对立关系被删」。

    比较：versus / vs / 对（含「与…对比」）；否定：not / 不是；
    排除：without / 而非。跨组替换仍算关系变化。
    """
    low = word.lower()
    return _RELATION_GROUPS.get(low, low)


def _contrast_sides(title: str) -> list[str]:
    """旧标题若是对比结构，返回对比双方（各取实义成分）；否则返回 []。

    只认 §15.4 列出的结构：英文 ``X versus/vs Y``；中文 ``X 对 Y``、
    ``X 与 Y 对比/相比/比较``、``X 而非 Y``、``X 不是 Y``。
    「并列连接」（and / 与 / 及 / 、）与普通修饰语不激活本规则。
    """
    if _cjk_heavy(title):
        m = _DUI_RE.search(title)
        if m:
            return [title[:m.start()], title[m.end():]]
        m = _YU_COMPARE_RE.search(title)
        if m:
            return [m.group(1), m.group(2)]
        for marker in ("而非", "不是"):
            if marker in title:
                left, right = title.split(marker, 1)
                return [left, right]
        return []
    m = re.search(r"(?<![A-Za-z])(?:versus|vs)(?![A-Za-z])", title, re.I)
    if not m:
        return []
    return [title[:m.start()], title[m.end():]]


def _heading_subjects(title: str, rules: dict) -> list[str]:
    """旧标题里的实义成分（中文按分隔字切段、英文按词），用于判「主语丢失」。

    序数词与单字词不承载对比对象，直接忽略。
    """
    generic_en, generic_zh = _echo_generic(rules)
    if _cjk_heavy(title):
        out = []
        for seg in _TERM_SEP_RE.split(title):
            seg = re.sub(r"[\s。．.!！?？:：;；,，、\"'“”‘’()（）\[\]【】]+",
                         "", seg)
            for phrase in _ECHO_STOP_ZH_PHRASES:
                seg = seg.replace(phrase, "")
            seg = "".join(ch for ch in seg if ch not in _ECHO_STOP_ZH_CHARS
                          and ch not in _ORDINAL_ZH)
            for term in generic_zh:
                seg = seg.replace(term, "")
            if len(seg) >= 2 and seg not in out:
                out.append(seg)
        return out
    out = []
    relation = {_canon_relation(w) for w in _relation_words(rules)}
    for word in _en_terms(title):
        if (len(word) < 2 or word in generic_en or word in _ORDINAL_EN
                or _canon_relation(word) in relation or word in out):
            continue
        out.append(word)
    return out


def _contrast_objects(title: str, rules: dict) -> list[str]:
    """对比结构里的「对象名词」；标题不是对比结构时返回 []。"""
    sides = _contrast_sides(title)
    if not sides:
        return []
    objects: list[str] = []
    for side in sides:
        for term in _heading_subjects(side, rules):
            if term not in objects:
                objects.append(term)
    return objects


def _lost_subjects(old_title: str, new_title: str, new_first: str,
                   rules: dict) -> list[str]:
    """只在旧标题是对比结构时，报「对比对象在新标题与新首句里都消失」。"""
    objects = _contrast_objects(old_title, rules)
    if not objects:
        return []
    lost = []
    if _cjk_heavy(old_title):
        probe = (new_title + " " + new_first)
        for obj in objects:
            if obj not in probe:
                lost.append(obj)
    else:
        probe = set(_en_terms(new_title + " " + new_first))
        for obj in objects:
            if _stem_en(obj) not in probe and obj not in probe:
                lost.append(obj)
    return lost


_COLON_RE = re.compile(r"[：:]")


def _substitute_tokens(rules: dict) -> tuple[list[str], list[str]]:
    """HEADING_SUBSTITUTED 的替换 token 表（项目根可覆盖）。"""
    cfg = rules.get("heading_substitute")
    if not isinstance(cfg, dict):
        cfg = {}
    punct = cfg.get("punctuation")
    if punct is None:
        punct = DEFAULT_RULES["heading_substitute"]["punctuation"]
    prep = cfg.get("prepositions")
    if prep is None:
        prep = DEFAULT_RULES["heading_substitute"]["prepositions"]
    if not isinstance(punct, (list, tuple)):
        punct = [punct]
    if not isinstance(prep, (list, tuple)):
        prep = [prep]
    return ([str(x) for x in punct if str(x)],
            [str(x).strip() for x in prep if str(x).strip()])


def _heading_substitution(old_title: str, new_title: str,
                          rules: dict) -> tuple[str, str] | None:
    """旧标题的冒号被纯替换成标点/介词时返回 ``(类别, token)``，否则 None。

    判据（见 ``docs/design/SPEC-SYNTAX-C.md``）：

    1. 旧标题含冒号（``:`` / ``：``），新标题不含冒号；
    2. 把旧标题的冒号换成 ``、，,（）`` 之一后与新标题逐字相同（只容
       首尾空白），或换成 ``as / with / for / of`` 之一后与新标题相同
       （大小写不敏感，冒号两侧空白可增减）。除替换 token 外不再改动
       别的词——改了别的词就不是「纯替换」，交给真重写。
    """
    old = _norm_space(old_title)
    new = _norm_space(new_title)
    if not old or not new:
        return None
    if not _COLON_RE.search(old) or _COLON_RE.search(new):
        return None
    punct_tokens, prep_tokens = _substitute_tokens(rules)
    for match in _COLON_RE.finditer(old):
        idx = match.start()
        for token in punct_tokens:
            candidate = old[:idx] + token + old[idx + 1:]
            if candidate.strip() == new.strip():
                return "标点", token
        left = old[:idx].rstrip()
        right = old[idx + 1:].lstrip()
        for token in prep_tokens:
            word = re.escape(token)
            if left and right:
                pattern = r"%s\s+(?i:%s)\s+%s" % (
                    re.escape(left), word, re.escape(right))
            elif left:
                pattern = r"%s\s+(?i:%s)" % (re.escape(left), word)
            elif right:
                pattern = r"(?i:%s)\s+%s" % (word, re.escape(right))
            else:
                continue
            if re.fullmatch(pattern, new, re.IGNORECASE):
                return "介词", token
    return None


def _rewrite_heading_findings(docs: list["_Doc"], before_docs: list["_Doc"],
                              rules: dict) -> list[Finding]:
    """改写前后按文件、按标题出现顺序配对，报关系词变化与主语丢失。"""
    relation_words = _relation_words(rules)
    before_by_file = {d.file: d.headings for d in before_docs}
    findings: list[Finding] = []
    for doc in docs:
        old_heads = before_by_file.get(doc.file)
        if not old_heads:
            continue
        new_heads = doc.headings
        for idx, (old, new) in enumerate(zip(old_heads, new_heads)):
            if old["cmd"] != new["cmd"]:
                continue
            old_title, new_title = old["title"], new["title"]
            if old_title == new_title:
                continue
            substitution = _heading_substitution(old_title, new_title, rules)
            if substitution is not None:
                kind, token = substitution
                findings.append(Finding(
                    "HEADING_SUBSTITUTED", doc.file, new["line"],
                    _clip(new_title, 160),
                    "标题只是把冒号换成了%s「%s」，没有重写（旧：「%s」；新："
                    "「%s」）。两截结构没变，不算改写：删掉类别词，重写成能"
                    "独立指路的名词短语，正文事实不动。"
                    % (kind, token, _clip(old_title, 80), _clip(new_title, 80)),
                    "heading_substituted", params={"kind": str(kind), "token": str(token), "clip": str(_clip(old_title, 80)), "clip1": str(_clip(new_title, 80))}))
            old_rel = _relation_hits(old_title, relation_words)
            new_rel = _relation_hits(new_title, relation_words)
            old_set = {_canon_relation(w) for w in old_rel}
            new_set = {_canon_relation(w) for w in new_rel}
            if old_set and (old_set - new_set):
                findings.append(Finding(
                    "HEADING_RELATION_CHANGED", doc.file, new["line"],
                    _clip(new_title, 160),
                    "标题里的对立关系词被删除或替换了（旧：%s；新：%s）。"
                    "关系词承载论证方向，替换或删除前先确认结论没变；"
                    "要改就连正文一起改。"
                    % ("、".join(old_rel), "、".join(new_rel) or "无"),
                    "heading_relation_changed", params={"arg0": str('、'.join(old_rel)), "arg1": str('、'.join(new_rel) or '无')}))
            stop_line = None
            if idx + 1 < len(new_heads) and new_heads[idx + 1]["cmd"] not in (
                    "paragraph", "subparagraph"):
                stop_line = new_heads[idx + 1]["line"]
            first, _pos = _first_sentence_span_after(doc, new["end_line"],
                                                     stop_line=stop_line)
            lost = _lost_subjects(old_title, new_title, first, rules)
            if lost:
                findings.append(Finding(
                    "HEADING_SUBJECT_LOST", doc.file, new["line"],
                    _clip(new_title, 160),
                    "旧标题的实义成分在新标题与新首句里都消失了（%s）：要么写回"
                    "新标题，要么在新首句里交代它去了哪里。" % "、".join(lost),
                    "heading_subject_lost", params={"arg0": str('、'.join(lost))}))
    return findings


def _term_variant_findings(docs: list["_Doc"], glossary: Glossary,
                           min_forms: int) -> list[Finding]:
    """只在 paper.tsv 的条目上判 TERM_VARIANT。

    优先级：
    1. 出现术语表声明的**禁用变体**即报（给出哪一行用了哪个变体、正名是什么）；
    2. 否则同一 canonical 在一篇里出现 ≥ ``min_forms`` 种表面形式才报。

    workspace.tsv 的流程词只用于查词，不参与本规则——它们的别名是宽松
    近义（``成本`` 的别名含 ``预算``），直接当同义词会误报。
    """
    findings: list[Finding] = []
    if not glossary or min_forms < 2:
        return findings
    for doc in docs:
        groups: dict = {}

        def add(match, line: int) -> None:
            if match.term.source != "paper":
                return
            group = groups.setdefault(match.canonical, {
                "forms": {}, "blocked": {}})
            entry = group["forms"].setdefault(
                match.form, {"lines": set(), "surface": match.surface})
            entry["lines"].add(line)
            if match.term.is_blocked(match.form):
                bucket = group["blocked"].setdefault(match.surface, set())
                bucket.add(line)

        for match in glossary.matches(doc.prose):
            add(match, _line_of(doc, match.start))
        for head in doc.headings:
            for match in glossary.matches(head["title"]):
                add(match, head["line"])
        for canonical in sorted(groups):
            group = groups[canonical]
            blocked = group["blocked"]
            if blocked:
                pieces = []
                lines: list[int] = []
                for surface in sorted(blocked,
                                      key=lambda s: (min(blocked[s]), s)):
                    line_txt = "、".join(str(x) for x in sorted(blocked[surface]))
                    pieces.append("「%s」（第%s行）" % (surface, line_txt))
                    lines.extend(blocked[surface])
                findings.append(Finding(
                    "TERM_VARIANT", doc.file, min(lines),
                    _clip("%s ← %s" % (canonical, "、".join(pieces)), 180),
                    "术语表声明的禁用变体出现了：%s；正名是「%s」。"
                    "只把这个写法改回正名，不改事实、数字与引用。"
                    % ("、".join(pieces), canonical),
                    "term_variant", message_key="finding.TERM_VARIANT.v2", params={"arg0": str('、'.join(pieces)), "canonical": str(canonical)}))
                continue
            forms = group["forms"]
            # 只把中文表面形式计入「用词不一致」：英文列是同一术语的译法，
            # 同一篇里出现 submit / hand in 不代表中文术语层不统一。
            cjk_forms = [item for item in forms.values()
                         if _CJK_RE.search(item["surface"])]
            if len(cjk_forms) < min_forms:
                continue
            ordered = sorted(cjk_forms,
                             key=lambda item: (min(item["lines"]),
                                               item["surface"]))
            pieces = []
            lines = []
            for item in ordered:
                line_txt = "、".join(str(x) for x in sorted(item["lines"]))
                pieces.append("%s（第%s行）" % (item["surface"], line_txt))
                lines.extend(item["lines"])
            line = min(lines) if lines else 1
            findings.append(Finding(
                "TERM_VARIANT", doc.file, line,
                _clip("%s：%s" % (canonical, "、".join(pieces)), 180),
                "同一概念在一篇里用了 %d 种写法；统一用规范形「%s」，"
                "其余写法改回它（只改措辞，不改事实）。"
                % (len(cjk_forms), canonical),
                "term_variant", message_key="finding.TERM_VARIANT.v3", params={"arg0": str(int(len(cjk_forms))), "canonical": str(canonical)}))
    return findings


def _unregistered_findings(doc: "_Doc", line: int, text: str,
                           glossary: Glossary, allow_keys: set,
                           allow_canon: set, seen: set) -> list[Finding]:
    """标题里的术语样候选归一化后不在册 → 只提示（单独走 info 通道）。"""
    out: list[Finding] = []
    if not glossary or not text:
        return out
    for cand in _unregistered_candidates(text, glossary):
        if glossary.canonical_of(cand) is not None:
            continue
        if glossary.covers(cand):
            continue
        cand_key = key_of(cand)
        canon = glossary.canonical_of(cand)
        if cand_key in allow_keys or (canon and canon in allow_canon):
            continue
        signature = (doc.file, line, cand_key)
        if signature in seen:
            continue
        seen.add(signature)
        out.append(Finding(
            "TERM_UNREGISTERED", doc.file, line, _clip(cand, 160),
            "「%s」不在术语表内：建议登记到 paper.tsv，或换用已登记的"
            "规范形。本条只提示，不进 findings 计数、不影响退出码。" % cand,
            "term_unregistered", severity="info", params={"cand": str(cand)}))
    return out


def _finding_signature(f: Finding) -> tuple[str, str, str]:
    return (f.code, f.file, _norm_space(f.text))


def filter_new_findings(after: StyleResult, before: StyleResult) -> StyleResult:
    """``style --diff``：只保留改后新增的违规（改前没有、改后有）。

    批 131：证据钢印（``REQUIRED_EVIDENCE_MISSING`` / ``EVIDENCE_DROPPED``）
    不被滤重——它们是闸门的红，不是「新增文风违规」。尤其是
    ``REQUIRED_EVIDENCE_MISSING``：改前也缺、改后还缺时，滤重会把它当
    「非新增」吞掉，让 ``--diff`` 比单跑更松。
    """
    allowance: dict = {}
    for f in before.findings:
        if f.code in EVIDENCE_CODES:
            continue
        key = _finding_signature(f)
        allowance[key] = allowance.get(key, 0) + 1
    new_findings = []
    for f in after.findings:
        if f.code in EVIDENCE_CODES:
            new_findings.append(f)
            continue
        key = _finding_signature(f)
        if allowance.get(key, 0) > 0:
            allowance[key] -= 1
            continue
        new_findings.append(f)
    fired_codes = {f.code for f in new_findings}
    fired = [item for item in after.fired if item["code"] in fired_codes]
    summary = dict(after.summary)
    red_count = sum(1 for f in new_findings
                    if getattr(f, "severity", "yellow") == "red")
    summary["findings"] = len(new_findings)
    summary["triggered"] = len(fired)
    summary["red"] = red_count
    summary["exit_code"] = (EXIT_RED if red_count
                            else EXIT_YELLOW if new_findings else EXIT_OK)
    return StyleResult(metrics=after.metrics, thresholds=after.thresholds,
                       fired=fired, findings=new_findings,
                       paragraphs=after.paragraphs, instances=after.instances,
                       summary=summary, rules_path=after.rules_path,
                       stage_assessment=after.stage_assessment,
                       info=list(after.info),
                       advisories=list(after.advisories),
                       metric_details=dict(after.metric_details),
                       rule_overrides=dict(after.rule_overrides),
                       rule_warnings=list(after.rule_warnings),
                       stage=after.stage)


def _paragraph_triads(text: str, base: int) -> list[tuple]:
    """返回段内模板式三点并列的 (绝对起点, 绝对终点, 原文, 模板指纹)。

    只认模板标记；顿号/逗号列举不算。同一段内标记必须按序出现。
    """
    hits = []
    for name, markers, need in _TRIAD_TEMPLATE_SERIES:
        found = []
        for index, marker in enumerate(markers):
            pattern = re.escape(marker)
            if name == "cn_di":
                pattern += _TRIAD_ORDINAL_SEP
            m = re.search(pattern, text)
            if m is not None:
                found.append((m.start(), m.end(), index))
        if len(found) < need:
            continue
        found.sort()
        indexes = [index for _start, _end, index in found]
        # 必须以首项起头，其余按模板顺序递增；「再次」可省。
        if found[0][2] != 0 or indexes != sorted(set(indexes)):
            continue
        start = found[0][0]
        end = found[-1][1]
        # 摘录延伸到第三项所在句的句末，避免只截到标记本身。
        tail = re.search(r"[。！？!?]", text[end:])
        if tail:
            end += tail.end()
        hits.append((base + start, base + end,
                     _norm_space(text[start:end]), name))
    return sorted(hits)


# --------------------------------------------------------------------------
# 阶段判断：初稿 vs 成品稿
# --------------------------------------------------------------------------

STAGE_DRAFT = "draft"
STAGE_POLISHED = "polished"
ADVICE_REWRITE = "rewrite"
ADVICE_REPORT_ONLY = "report_only"

# 盲评结论（批 67–70）：文风闸对 LLM 初稿有效，对已打磨的人写稿有害。
# 因此只在「初稿特征明显」时给逐条改写指令；成品稿只报告、明确建议不改。
DRAFT_TRIGGER_FLOOR = 3
DRAFT_CV_LOW = 0.45
POLISHED_CV_HIGH = 0.80

REPORT_ONLY_PROMPT = "指标健康，建议不改；强行改写有降低自然度风险"


def assess_stage(triggers: int, cv: float, fired: list) -> dict:
    """按「触发项数 + 句长 CV」判初稿/成品稿。

    * ``triggers >= 3`` 或 ``cv < 0.45`` → draft + rewrite；
    * 其余（``triggers <= 2`` 且 CV 不在「太整齐」区）→ polished + report_only。

    CV 高于 0.80 是「散」，散不是公式化特征，同样按成品稿只报告。
    """
    codes = "、".join(f["code"] for f in fired) or "无"
    cv_shown = round(cv, 3)
    if triggers >= DRAFT_TRIGGER_FLOOR or cv < DRAFT_CV_LOW:
        parts = []
        if triggers >= DRAFT_TRIGGER_FLOOR:
            parts.append("触发 %d 项指标（%s）" % (triggers, codes))
        if cv < DRAFT_CV_LOW:
            parts.append("句长 CV=%.2f 低于 0.45（句子过于整齐）" % cv)
        reason = "；".join(parts) + "：呈现初稿的公式化特征，建议按改写清单处理。"
        return {"stage": STAGE_DRAFT, "advice": ADVICE_REWRITE,
                "reason": reason, "triggers": triggers, "cv": cv_shown}
    if cv > POLISHED_CV_HIGH:
        reason = ("仅 %d 项指标触发（%s）；句长 CV=%.2f 高于 0.80，属自然散落"
                  "（散不是公式化特征）：稿子已到打磨阶段，建议不改。"
                  % (triggers, codes, cv))
    else:
        reason = ("仅 %d 项指标触发（%s），句长 CV=%.2f 在健康区间 [0.45, 0.80]："
                  "稿子已到打磨阶段，建议不改。" % (triggers, codes, cv))
    return {"stage": STAGE_POLISHED, "advice": ADVICE_REPORT_ONLY,
            "reason": reason, "triggers": triggers, "cv": cv_shown}


# --------------------------------------------------------------------------
# 批 102：句法级判据（轻动词名义化 / 的-堆叠 / 语序 / 语法错 / 冗词）
# --------------------------------------------------------------------------

def _light_verb_patterns(rules: dict) -> tuple[re.Pattern | None,
                                               re.Pattern | None]:
    """返回 (甲组模式, 乙组模式)。甲组可直接跟名义化名词；乙组只认
    「a/an＋名词」或复数名词。"""
    group = rules.get("light_verbs") or {}
    suffixes = [str(x) for x in group.get("suffixes") or [] if str(x).strip()]
    if not suffixes:
        return None, None
    noun = r"\w+(?:%s)s?\b" % "|".join(re.escape(s) for s in suffixes)
    plural = r"\w+(?:%s)s\b" % "|".join(re.escape(s) for s in suffixes)

    def alts(key: str) -> str:
        items = sorted({str(x) for x in group.get(key) or [] if str(x).strip()},
                       key=len, reverse=True)
        return "|".join(re.escape(x).replace(r"\ ", r"\s+") for x in items)

    direct = alts("english")
    article = alts("article_verbs")
    pat_direct = pat_article = None
    if direct:
        pat_direct = re.compile(
            r"\b(?:%s)\s+(?:(?:a|an|the)\s+)?(?:\w+ly\s+)?(?P<noun>%s)"
            % (direct, noun), re.IGNORECASE)
    if article:
        pat_article = re.compile(
            r"\b(?:%s)\s+(?:(?:a|an)\s+(?:\w+ly\s+)?(?P<noun>%s)"
            r"|(?P<plural>%s))" % (article, noun, plural), re.IGNORECASE)
    return pat_direct, pat_article


def _span_intersects(regex: re.Pattern | None, text: str,
                     start: int, end: int) -> bool:
    if regex is None:
        return False
    for m in regex.finditer(text):
        if m.start() < end and start < m.end():
            return True
    return False


def _exempt_phrase_regex(phrases: list[str]) -> re.Pattern | None:
    """白名单短语的匹配式：动词按常见屈折展开（have/has/had）。"""
    forms = {
        "have": ["have", "has", "had", "having"],
        "provide": ["provide", "provides", "provided", "providing"],
        "take": ["take", "takes", "took", "taking"],
        "give": ["give", "gives", "gave", "giving"],
        "make": ["make", "makes", "made", "making"],
    }
    variants: list[str] = []
    for phrase in phrases:
        phrase = str(phrase).strip()
        if not phrase:
            continue
        variants.append(phrase)
        first, _, rest = phrase.partition(" ")
        for form in forms.get(first.lower(), []):
            if rest:
                variants.append("%s %s" % (form, rest))
    return _phrase_regex(variants)


def _light_verb_findings(sentences, rules: dict, thresholds: dict) -> list[Finding]:
    pat_direct, pat_article = _light_verb_patterns(rules)
    group = rules.get("light_verbs") or {}
    actions = {str(k).lower(): str(v)
               for k, v in (group.get("actions") or {}).items()}
    exempt_re = _exempt_phrase_regex(
        [str(x) for x in group.get("exempt_phrases") or []])
    out: list[Finding] = []
    for doc, start, end, _units in sentences:
        sentence = _norm_space(doc.prose[start:end])
        seen: set = set()
        for regex in (pat_direct, pat_article):
            if regex is None:
                continue
            for m in regex.finditer(sentence):
                groups = m.groupdict()
                noun = (groups.get("noun") or groups.get("plural") or "").strip()
                if not noun or m.span() in seen:
                    continue
                if _span_intersects(exempt_re, sentence, m.start(), m.end()):
                    continue
                seen.add(m.span())
                action = actions.get(noun.lower())
                if action:
                    hint = "把动作写成动词：「%s」→ %s" % (noun, action)
                else:
                    hint = ("把动作写成动词：把「%s」还原成对应的动词"
                            % noun)
                out.append(Finding(
                    "LIGHT_VERB_NOMINALIZATION", doc.file, _line_of(doc, start),
                    _clip(sentence, 180),
                    "「%s」是轻动词＋名义化：动词是空的，动作藏在名词里。%s"
                    % (_norm_space(m.group(0)), hint),
                    "light_verb_nominalization", params={"norm_space": str(_norm_space(m.group(0))), "hint": str(hint)}))
    # P-152：只报「重度」——同一篇里命中数达到 light_verb_doc_min 才算系统性
    # 写法；个别措辞（盲评 R1 轴 18 条双洁＋3 条分歧全判无缺陷）不报。
    doc_min = int(thresholds["light_verb_doc_min"])
    if len(out) < doc_min:
        return []
    return out


# 「的」链内的谓词/连接断点：出现这些字说明不是连续定语修饰，而是
# 「是…的」结构或小句（如「难度档用的是…」「那些臂是更小的…」）。
_DE_CHAIN_BREAKS = set(
    "是用有在把被而并或和与及也就都还又不没无未为对从向给让使得会能可要"
    "这那其之于以所等着了过"
)


def _zh_de_stack_findings(sentences, thresholds: dict) -> list[Finding]:
    max_gap = int(thresholds["zh_de_stack_max_gap"])
    out: list[Finding] = []
    for doc, start, end, _units in sentences:
        sentence = _norm_space(doc.prose[start:end])
        if not _cjk_heavy(sentence):
            continue
        positions = [i for i, ch in enumerate(sentence) if ch == "的"]
        links: list = []          # 每对相邻「的」：合格＝(间隔, 字数)，否则 None
        for left, right in zip(positions, positions[1:]):
            gap = re.sub(r"\s+", "", sentence[left + 1:right])
            ok = (bool(gap)
                  and all(_CJK_RE.fullmatch(ch) for ch in gap)
                  and not any(ch in _DE_CHAIN_BREAKS for ch in gap)
                  and len(gap) <= max_gap)
            links.append((gap, len(gap)) if ok else None)
        chain = next(((links[i], links[i + 1])
                      for i in range(len(links) - 1)
                      if links[i] and links[i + 1]), None)
        if chain is None:
            continue
        (gap_a, len_a), (gap_b, len_b) = chain
        out.append(Finding(
            "ZH_DE_STACK", doc.file, _line_of(doc, start),
            _clip(sentence, 180),
            "短修饰链：连续两层定语的间隔只有 %d / %d 字（「%s」「%s」）。"
            "把其中一层改成动词句，或拆成两句（例：'A 的 B 的 C' → "
            "'C 由 B 做，B 属于 A'）；事实与数字不动。"
            % (len_a, len_b, gap_a, gap_b),
            "zh_de_stack", params={"len_a": str(int(len_a)), "len_b": str(int(len_b)), "gap_a": str(gap_a), "gap_b": str(gap_b)}))
    return out


def _zh_postposed_condition_findings(sentences, rules: dict
                                     ) -> list[Finding]:
    markers = [str(x) for x in
               (rules.get("zh_postposed_condition") or {}).get("chinese") or []
               if str(x).strip()]
    if not markers:
        return []
    alt = "|".join(re.escape(m) for m in
                   sorted(markers, key=len, reverse=True))
    pat = re.compile(r"[^。！？\n]{4,}[，,]\s*(?P<marker>%s)(?P<cond>[^。！？\n]{2,})"
                     r"[。！？]" % alt)
    out: list[Finding] = []
    for doc, start, end, _units in sentences:
        sentence = _norm_space(doc.prose[start:end])
        m = pat.search(sentence)
        if not m or m.group("cond").startswith("干"):   # 「若干」不是条件
            continue
        cond = m.group("marker") + m.group("cond")
        main = sentence[:m.start("marker")].rstrip(" ，,；;")
        out.append(Finding(
            "ZH_POSTPOSED_CONDITION", doc.file, _line_of(doc, start),
            _clip(sentence, 180),
            "条件从句后置（英文语序）：中文条件在前。把「%s」移到逗号前 → "
            "「%s，%s」" % (cond.rstrip("。！？"),
                            cond.rstrip("。！？"), main),
            "zh_postposed_condition", params={"cond": str(cond.rstrip('。！？')), "cond1": str(cond.rstrip('。！？')), "main": str(main)}))
    return out


def _zh_due_to_make_findings(sentences, rules: dict) -> list[Finding]:
    group = rules.get("zh_due_to_make") or {}
    causes = [str(x) for x in group.get("chinese") or [] if str(x).strip()]
    effects = [str(x) for x in group.get("effects") or [] if str(x).strip()]
    if not causes or not effects:
        return []
    pat = re.compile(r"(?P<prep>%s)[^。；]{1,40}(?:%s)"
                     % ("|".join(map(re.escape, causes)),
                        "|".join(map(re.escape, effects))))
    out: list[Finding] = []
    for doc, start, end, _units in sentences:
        sentence = _norm_space(doc.prose[start:end])
        m = pat.search(sentence)
        if not m:
            continue
        out.append(Finding(
            "ZH_DUE_TO_MAKE", doc.file, _line_of(doc, start),
            _clip(sentence, 180),
            "「%s…」是介词短语，不能作主语，全句缺主。删掉「%s」，让原因"
            "自己当主语，后半句直接给结果（例：「由于数据缺失，使得结果"
            "不可靠」→「数据缺失，结果不可靠」）；这是语法错，不只是文风。"
            % (m.group("prep"), m.group("prep")),
            "zh_due_to_make", params={"m": str(m.group('prep')), "m1": str(m.group('prep'))}))
    return out


def _is_noun_side(pos: str) -> bool:
    """名词侧：n 开头（n/nr/ns/nt/nz/nrt…）外加 vn（动名词）。

    结巴把「分析/研究/评估/调整/优化」标成 vn；只认 n 会让
    「进行了分析」永远报不出来。纯动词 v 不进来。
    """
    return pos.startswith("n") or pos == "vn"


def _is_content_pos(pos: str) -> bool:
    """实词（名词或动词）。用来识别「专门优化」里的修饰语。"""
    return pos.startswith("n") or pos.startswith("v")


def _zh_light_verb_noun_findings(sentences, rules: dict) -> list[Finding]:
    group = rules.get("zh_light_verb_noun") or {}
    verbs = [str(x) for x in group.get("verbs") or [] if str(x).strip()]
    if not verbs:
        return []
    verb_set = set(verbs)
    exempt = [str(x) for x in group.get("exempt_phrases") or []
              if str(x).strip()]
    actions = {str(k): str(v)
               for k, v in (group.get("actions") or {}).items()}
    out: list[Finding] = []
    for doc, start, end, _units in sentences:
        sentence = _norm_space(doc.prose[start:end])
        if not any(verb in sentence for verb in verbs):
            continue
        tokens = segment(sentence)
        for idx, (token, tstart, _tend, _pos) in enumerate(tokens):
            if token not in verb_set:
                continue
            j = idx + 1
            # 体标记：进行了分析 / 进行着讨论 / 进行过比较。
            if j < len(tokens) and tokens[j][0] in ("了", "着", "过"):
                j += 1
            # 可选「的」：进行的研究。
            if j < len(tokens) and tokens[j][0] == "的":
                j += 1
            if j >= len(tokens):
                continue
            noun, _ns, nend, npos = tokens[j]
            if not _is_noun_side(npos):
                continue
            # 名词后面紧跟另一个名词/动词：它是修饰语，真正的中心词在
            # 后面（如「专门优化」「数据分析」）。精度优先，不报修饰语。
            if (j + 1 < len(tokens)
                    and _is_content_pos(tokens[j + 1][3])):
                continue
            phrase = sentence[tstart:nend]
            if any(phrase == item or phrase.startswith(item)
                   for item in exempt):
                continue
            action = actions.get(noun, noun)
            direct = action + "了"
            out.append(Finding(
                "ZH_LIGHT_VERB_NOUN", doc.file, _line_of(doc, start),
                _clip(sentence, 180),
                "「%s」是轻动词＋名词：动词是空的，动作藏在名词里。动作"
                "其实是什么——「%s」；直接写「%s」，把「%s」删掉。"
                % (phrase, direct, direct, token),
                "zh_light_verb_noun", params={"phrase": str(phrase), "direct": str(direct), "direct1": str(direct), "token": str(token)}))
    return out


def _nominalization_rate_findings(sentences, rules: dict
                                  ) -> tuple[list[Finding], float, list[str]]:
    """B1：英文名词化密度。单位＝每百词百分数（Sword 口径）。

    先按后缀数词形（词长 ≥ min_length），再剥离本文频次最高的 strip_top
    个类型（当作领域术语），最后算 ``保留数 × 100 / 英文词数``。
    """
    group = rules.get("nominalization") or {}
    suffixes = [str(x).lower() for x in group.get("suffixes") or []
                if str(x).strip()]
    min_length = int(group.get("min_length") or 5)
    strip_top = int(group.get("strip_top") or 5)
    if not suffixes:
        return [], 0.0, []
    actions = {str(k).lower(): str(v)
               for k, v in ((rules.get("light_verbs") or {})
                            .get("actions") or {}).items()}

    hits: list[tuple[_Doc, int, str, str]] = []
    counts: dict[str, int] = {}
    total_words = 0
    for doc, start, end, _units in sentences:
        sentence = _norm_space(doc.prose[start:end])
        for m in _LATIN_WORD_RE.finditer(sentence):
            word = m.group(0).lower()
            total_words += 1
            if len(word) < min_length:
                continue
            if not any(word.endswith(suffix) for suffix in suffixes):
                continue
            counts[word] = counts.get(word, 0) + 1
            hits.append((doc, start, sentence, word))
    stripped = [word for word, _n in
                sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:strip_top]]
    stripped_set = set(stripped)
    kept = [h for h in hits if h[3] not in stripped_set]
    rate = round(len(kept) * 100.0 / total_words, 2) if total_words else 0.0
    listed = "、".join(stripped) or "无"
    out: list[Finding] = []
    for doc, start, sentence, word in kept:
        action = actions.get(word)
        fix = ("把「%s」还原成动词「%s」" % (word, action) if action
               else "把「%s」还原成对应的动词，或删掉多余的名词" % word)
        out.append(Finding(
            "NOMINALIZATION_RATE", doc.file, _line_of(doc, start),
            _clip(sentence, 180),
            "名词化密度 %.2f/百词（阈值 %.1f）：名词化把动作压成了名词。"
            "%s。已剥离本文高频术语（前 %d 个）：%s。"
            % (rate, float((rules.get("thresholds") or {}).get(
                "nominalization_rate", 4.5)), fix, strip_top, listed),
            "nominalization_rate", params={"rate": format(rate, ".2f"), "arg1": format(float((rules.get('thresholds') or {}).get('nominalization_rate', 4.5)), ".1f"), "fix": str(fix), "strip_top": str(int(strip_top)), "listed": str(listed)}))
    return out, rate, stripped


_ZHE_CHARS = ("着", "著")


def _zh_aspect_zhe_findings(sentences, rules: dict
                            ) -> tuple[list[Finding], int]:
    """B2：中文「动词＋着」进行体。单位＝每千汉字。

    分词后只认两种形态：单独一个「着」跟在动词后；或整个词以「着」结尾
    且词性是动词（有着）。词内用法（沿着/照着/接着/意味着）走排除表。
    """
    group = rules.get("zh_aspect_zhe") or {}
    exclude = {str(x) for x in group.get("exclude") or [] if str(x).strip()}
    out: list[Finding] = []
    hits = 0
    for doc, start, end, _units in sentences:
        sentence = _norm_space(doc.prose[start:end])
        if not _cjk_heavy(sentence):
            continue
        tokens = segment(sentence)
        for idx, (token, tstart, tend, pos) in enumerate(tokens):
            phrase = ""
            if token in _ZHE_CHARS:
                if idx == 0 or not tokens[idx - 1][3].startswith("v"):
                    continue
                phrase = tokens[idx - 1][0] + token
            elif (len(token) > 1 and token.endswith(_ZHE_CHARS)
                  and pos.startswith("v")):
                if token in exclude:
                    continue
                phrase = token
            else:
                continue
            hits += 1
            out.append(Finding(
                "ZH_ASPECT_ZHE", doc.file, _line_of(doc, start),
                _clip(sentence, 180),
                "「%s」是动词＋「着」的进行体。%s"
                % (phrase, "写「有」或「存在」即可，删掉「着」；"
                   "只有确实在进行时才保留进行体。"
                   if phrase.startswith(("有着", "存在著", "存在着", "存在著"))
                   else "多数时候删掉「着」更干净，或改成「了」「过」；"
                        "只有确实在进行时才保留进行体。"),
                "zh_aspect_zhe", params={"phrase": str(phrase), "arg1": str('写「有」或「存在」即可，删掉「着」；只有确实在进行时才保留进行体。' if phrase.startswith(('有着', '存在著', '存在着', '存在著')) else '多数时候删掉「着」更干净，或改成「了」「过」；只有确实在进行时才保留进行体。')}))
    return out, hits


def _zh_dang_when_findings(paragraph_sentences, rules: dict) -> list[Finding]:
    """B3：当……的时候 / 当……之后 / 当……时（同段成串才报）。"""
    group = rules.get("zh_dang_when") or {}
    tails = [str(x) for x in group.get("tails") or []
             if str(x).strip()]
    forbid = {str(x) for x in group.get("forbid_heads") or []}
    if not tails:
        return []
    min_hits = max(1, int(group.get("min_per_paragraph", 2) or 2))
    alts = []
    for tail in sorted(tails, key=len, reverse=True):
        piece = re.escape(tail)
        if tail.endswith("时") and "候" not in tail:
            piece += "(?!候)"
        alts.append(piece)
    # 尾巴后面必须是一个停顿或主句标记：逗号/分号/句末/才就则便方。
    # 否则「只有当运行时把决定权拿走」里的「运行时」会被当成「当…时」。
    pat = re.compile(r"当(?P<body>[^。！？；：\n]{1,30}?)(?P<tail>%s)"
                     r"(?=[，,、：:；;。！？!?]|$|才|就|则|便|方)"
                     % "|".join(alts))
    out: list[Finding] = []
    # 段内累计：单次出现是正常中文，同一段至少 min_hits 处才报；
    # 跨段不累计。
    for seq in paragraph_sentences:
        hits = []
        for doc, start, end, _units in seq:
            sentence = _norm_space(doc.prose[start:end])
            for m in pat.finditer(sentence):
                if m.group("body")[:1] in forbid:
                    continue
                hits.append((doc, start, sentence, m))
        if len(hits) < min_hits:
            continue
        positions = "；".join(
            "%s:%d「%s」" % (doc.file, _line_of(doc, start), m.group(0))
            for doc, start, _sentence, m in hits)
        note = "本段共 %d 处：%s" % (len(hits), positions)
        for doc, start, sentence, m in hits:
            body = m.group("body")
            tail = m.group("tail")
            if tail == "之后":
                fix = "删「当」，写「%s之后」，时间关系自己站住" % body
            else:
                fix = ("删「当」和「%s」，让条件自己站住 → 「%s」"
                       % (tail, body))
            out.append(Finding(
                "ZH_DANG_WHEN", doc.file, _line_of(doc, start),
                _clip(sentence, 180),
                "「%s」是翻译腔的「当…%s」结构（英文 when 语序）。%s。%s。"
                % (m.group(0), tail, fix, note),
                "zh_dang_when", params={"m": str(m.group(0)), "tail": str(tail), "fix": str(fix), "note": str(note)}))
    return out


def _zh_collocation_findings(sentences, rules: dict) -> list[Finding]:
    """B4：搭配冗余。单位＝处，每条给删法。"""
    items = (rules.get("zh_collocation_redundancy") or {}).get("items") or []
    compiled = []
    for item in items:
        pattern = str(item.get("pattern") or "")
        if not pattern:
            continue
        try:
            compiled.append((re.compile(pattern),
                             str(item.get("label") or pattern),
                             str(item.get("fix") or "删掉重复的那一半")))
        except re.error:
            continue
    out: list[Finding] = []
    for doc, start, end, _units in sentences:
        sentence = _norm_space(doc.prose[start:end])
        for regex, label, fix in compiled:
            for m in regex.finditer(sentence):
                out.append(Finding(
                    "ZH_COLLOCATION_REDUNDANCY", doc.file,
                    _line_of(doc, start), _clip(sentence, 180),
                    "「%s」是搭配冗余（%s，两个词说同一件事）：%s。"
                    % (m.group(0), label, fix),
                    "zh_collocation_redundancy", params={"m": str(m.group(0)), "label": str(label), "fix": str(fix)}))
    return out


def _abbrev_first_use_findings(sentences, rules: dict) -> list[Finding]:
    """B5：缩写首现未展开。默认关闭，只由 --report-abbrev 打开。"""
    group = rules.get("abbrev_rules") or {}
    min_letters = int(group.get("min_letters") or 2)
    exclude = {str(x).upper() for x in group.get("exclude") or []}
    token_re = re.compile(r"\b([A-Z]{%d,})\b" % max(min_letters, 2))
    groups: dict[str, list[tuple[_Doc, int, str]]] = {}
    order: list[str] = []
    for doc, start, end, _units in sentences:
        if doc.file not in groups:
            groups[doc.file] = []
            order.append(doc.file)
        groups[doc.file].append((doc, start,
                                 _norm_space(doc.prose[start:end])))
    out: list[Finding] = []
    seen: set[str] = set()
    for name in order:
        previous = ""
        for doc, start, sentence in groups[name]:
            context = (previous + " " + sentence) if previous else sentence
            for m in token_re.finditer(sentence):
                token = m.group(1)
                if token in seen or token in exclude:
                    continue
                seen.add(token)
                expanded = re.search(r"[（(]\s*%s\s*[）)]" % re.escape(token),
                                     context)
                if expanded:
                    continue
                out.append(Finding(
                    "ABBREV_FIRST_USE", doc.file, _line_of(doc, start),
                    _clip(sentence, 180),
                    "缩写「%s」首次出现时没有展开。同句或前一句写成"
                    "「全称（%s）」或「Expanded Name (%s)」，后文再用缩写。"
                    % (token, token, token),
                    "abbrev_first_use", params={"token": str(token), "token1": str(token), "token2": str(token)}))
            previous = sentence
    return out


def _wordiness_bloat_findings(sentences, rules: dict) -> list[Finding]:
    replacements = {str(k): str(v) for k, v in
                    ((rules.get("wordiness") or {}).get("replacements") or {}).items()}
    pat = _phrase_regex(list(replacements))
    if pat is None:
        return []
    out: list[Finding] = []
    for doc, start, end, _units in sentences:
        sentence = _norm_space(doc.prose[start:end])
        for m in pat.finditer(sentence):
            phrase = _norm_space(m.group(0))
            repl = replacements.get(phrase.lower()) or replacements.get(phrase)
            if not repl:
                # 索引按原表键（大小写不敏感匹配）
                repl = next((v for k, v in replacements.items()
                             if k.lower() == phrase.lower()), "")
            out.append(Finding(
                "WORDINESS_BLOAT", doc.file, _line_of(doc, start),
                _clip(sentence, 180),
                "「%s」是膨胀短语：直接写「%s」，信息不减"
                % (phrase, repl or "更短的写法"),
                "wordiness_bloat", params={"phrase": str(phrase), "arg1": str(repl or '更短的写法')}))
    return out


def _section_length_findings(cfg: Config, docs: list["_Doc"],
                             tolerance: float) -> tuple[list, list, float]:
    """批 128：篇幅预算——每节正文单元数对预算，超 20% 报一条。

    返回 (findings, 逐节读数, 最狠的超出百分比)。没有 `[budget]` 时判据不跑，
    findings 与读数都为空（向后兼容）。正文单元复用 ``units_of``：英文按词、
    中文按汉字，LaTeX 命令与注释已在 ``prose_of`` 里剥掉。
    """
    if not getattr(cfg, "budget_defined", False):
        return [], [], 0.0
    findings: list = []
    details: list = []
    worst = 0.0
    root_rel = getattr(cfg, "root_tex", "") or ""
    for doc in docs:
        # 主文件是容器不是一节；剥成空白的文件（只有宏定义）没有篇幅可判。
        if root_rel and doc.file == root_rel:
            continue
        if units_of(doc.prose) <= 0:
            continue
        budget = section_budget(cfg, doc.file)
        if not budget:
            continue
        actual = units_of(doc.prose)
        excess = round(max(0.0, (actual - budget) * 100.0 / budget), 1)
        details.append({"file": doc.file, "actual": actual, "budget": budget,
                        "excess_percent": excess})
        if (actual - budget) * 100.0 / budget <= tolerance:
            continue
        worst = max(worst, excess)
        unit = "字" if _cjk_heavy(doc.prose) else "词"
        start = next((i for i, ch in enumerate(doc.prose) if not ch.isspace()),
                     0)
        findings.append(Finding(
            "SECTION_LENGTH", doc.file, _line_of(doc, start),
            "本节 %d %s / 预算 %d %s（超出 %.1f%%）"
            % (actual, unit, budget, unit, excess),
            "按顺序压：先删重复引用的数字，再删举例，最后合并同义句。"
            "禁做：不删论点、不删每个论点的最后一条证据、不把句子改短来凑数"
            "（拆成短句但词数没降，不算改完）。",
            "section_length"))
    details.sort(key=lambda item: item["file"])
    return findings, details, round(worst, 1)


def _is_container(doc: "_Doc") -> bool:
    """主文件是不是「容器」：只 \\input/\\include 别的文件，自己没有正文。

    容器不该按节算密度（否则 3 个数字/27 个词的导言区会误报）；有正文的
    单文件项目照常判。
    """
    return bool(re.search(r"\\(?:input|include|subfile)\b", doc.raw or ""))


def _numeral_density_findings(docs: list["_Doc"], threshold,
                              stage: str, root_file: str = ""
                              ) -> tuple[list, list, float, list]:
    """批 129 NUMERAL_DENSITY：每千词（英）/每千汉字（中）的数字 token 数。

    ``stage == "revision"`` 时读数照算，但条目降为 info（不改 findings、
    不影响退出码）：改稿/改写验收阶段数字属于 PROTECT_NUMBER_CHANGED 的
    保护面。阶段只由命令行 ``--stage`` 决定（批 130）。

    批 131：``threshold is None`` ⇒ 不判。逐节读数照算（``threshold`` 记
    null），但不产生 finding、不进 info；显式配数字即恢复旧行为。
    主文件若是只 ``\\input`` 别的文件的容器，跳过（容器不是一节）。
    """
    findings: list = []
    details: list = []
    info: list = []
    paused = stage in ("revision", "off")
    worst = 0.0
    for doc in docs:
        if root_file and doc.file == root_file and _is_container(doc):
            continue
        cjk = len(_CJK_RE.findall(doc.prose))
        latin = len(_LATIN_WORD_RE.findall(doc.prose))
        if cjk > 0 and cjk >= latin:
            units, unit = cjk, "汉字"
        else:
            units, unit = latin, "词"
        if units <= 0:
            continue
        count = len(_NUMERAL_TOKEN_RE.findall(doc.prose))
        density = count * 1000.0 / units
        worst = max(worst, density)
        details.append({"file": doc.file, "numerals": count, "units": units,
                        "unit": unit, "density": round(density, 1),
                        "threshold": threshold})
        if threshold is None:       # 批 131：默认不判，读数保留
            continue
        if density <= threshold:
            continue
        first = _NUMERAL_TOKEN_RE.search(doc.prose)
        pos = first.start() if first else 0
        shown = int(threshold) if float(threshold).is_integer() else threshold
        text = ("本节 %d 个数字 / 阈值 %s / 密度 %.1f/千%s"
                % (count, shown, density, unit))
        if paused:
            info.append(Finding(
                "NUMERAL_DENSITY", doc.file, _line_of(doc, pos), text,
                "--stage revision：本条只报告、不要求删数字。改稿阶段数字受 "
                "PROTECT_NUMBER_CHANGED 保护，删数字会被保护面判红；起草阶段"
                "（--stage draft）才用 thin-the-numbers。",
                "numeral_density", severity="info", message_key="finding.NUMERAL_DENSITY.v2"))
        else:
            findings.append(Finding(
                "NUMERAL_DENSITY", doc.file, _line_of(doc, pos), text,
                "数字太密：每个论点只留一条证据，其余数字删掉或改成定性说法"
                "（多数/少量/接近）。本条只用于起草阶段；进入改写验收前加 "
                "--stage revision，避免与 PROTECT_NUMBER_CHANGED 冲突。",
                "numeral_density", message_key="finding.NUMERAL_DENSITY.v3"))
    details.sort(key=lambda item: item["file"])
    return findings, details, round(worst, 1), info


def _blocks_of(doc: "_Doc") -> list[tuple[str, int, int]]:
    """按标题把一篇拆成节/小节块：[(节名, 起点, 终点)]。

    标题本身在 ``prose`` 里已被等长遮罩，所以块内容只含正文；第一个块是
    文件里第一个标题之前的正文（通常是导言或空块）。
    """
    heads = sorted(doc.headings, key=lambda h: h["start"])
    starts = [0] + [h["end"] for h in heads]
    ends = [h["start"] for h in heads] + [len(doc.prose)]
    names = [doc.file] + [h["title"] for h in heads]
    out = []
    for name, start, end in zip(names, starts, ends):
        if end > start:
            out.append((name, start, end))
    return out


def _shingle_map(text: str, start: int, end: int) -> dict:
    """返回 {片段: 首次出现位置}；英文 8 词、中文 12 字。"""
    segment = text[start:end]
    cjk = len(_CJK_RE.findall(segment))
    latin = len(_LATIN_WORD_RE.findall(segment))
    if cjk > 0 and cjk >= latin:
        size = _OVERLAP_SHINGLE_ZH
        tokens = [(m.group(0), start + m.start())
                  for m in _CJK_RE.finditer(segment)]
    else:
        size = _OVERLAP_SHINGLE_EN
        tokens = [(m.group(0).lower(), start + m.start())
                  for m in _LATIN_WORD_RE.finditer(segment)]
    out: dict = {}
    for i in range(len(tokens) - size + 1):
        key = tuple(token for token, _pos in tokens[i:i + size])
        if key not in out:
            out[key] = tokens[i][1]
    return out


def _section_overlap_findings(docs: list["_Doc"], threshold: float,
                              root_file: str = ""
                              ) -> tuple[list, list, float]:
    """批 129 SECTION_OVERLAP：节与节之间的 8 词/12 字片段重合率。

    重合率 = 共有片段数 ÷ 两节中较短一节的片段数（取较短一节为分母，
    避免长节把短节的整段重复稀释掉）。``prose_of`` 已排除 ``\\fact``、
    引用、公式与 LaTeX 命令，因此片段只由正文词/字组成。
    """
    blocks = []
    for doc in docs:
        if root_file and doc.file == root_file and _is_container(doc):
            continue
        for name, start, end in _blocks_of(doc):
            shingles = _shingle_map(doc.prose, start, end)
            if len(shingles) < _OVERLAP_MIN_SHINGLES:
                continue
            blocks.append({"doc": doc, "name": name, "start": start,
                           "shingles": shingles})
    blocks.sort(key=lambda b: (b["doc"].file, b["start"]))
    findings: list = []
    details: list = []
    worst = 0.0
    for i, first in enumerate(blocks):
        for second in blocks[i + 1:]:
            common = set(first["shingles"]) & set(second["shingles"])
            if not common:
                continue
            denom = min(len(first["shingles"]), len(second["shingles"]))
            rate = len(common) * 100.0 / denom if denom else 0.0
            worst = max(worst, rate)
            if rate <= threshold:
                continue
            key = min(common, key=lambda sh: (second["shingles"][sh],
                                              first["shingles"][sh]))
            line_second = _line_of(second["doc"], second["shingles"][key])
            line_first = _line_of(first["doc"], first["shingles"][key])
            if first["doc"].file == second["doc"].file:
                other = "「%s」节" % first["name"]
            else:
                other = "「%s」节（%s）" % (first["name"], first["doc"].file)
            excerpt = " ".join(key)
            findings.append(Finding(
                "SECTION_OVERLAP", second["doc"].file, line_second,
                _clip("本节与%s重复：重合率 %.1f%%（> %.1f%%），本节第 %d 行"
                      " ↔ 对方第 %d 行；共有片段：%s"
                      % (other, rate, threshold, line_second, line_first,
                         excerpt), 220),
                "把重复段落并进被引用的那一节，或删掉本节的重复句，只保留"
                "本节独有的结论；数字、事实与引用一条都不许丢。",
                "section_overlap"))
            details.append({
                "file": second["doc"].file, "section": second["name"],
                "other_file": first["doc"].file,
                "other_section": first["name"],
                "rate": round(rate, 1), "line": line_second,
                "other_line": line_first,
                "shared_shingles": len(common),
                "denominator": denom})
    details.sort(key=lambda item: (item["file"], item["line"]))
    return findings, details, round(worst, 1)


def _we_action_words(rules: dict) -> tuple[set, list]:
    group = rules.get("we_action") or {}
    english = {str(x).lower() for x in group.get("english") or []
               if str(x).strip()}
    chinese = sorted((str(x) for x in group.get("chinese") or []
                      if str(x).strip()), key=len, reverse=True)
    return english, chinese


def _we_action_en(text: str, verbs: set) -> str:
    """英文句：主语 we 后（跳过副词/助动词）的第一个实义动词是动作动词。"""
    for match in re.finditer(r"\bwe\b", text, re.I):
        words = re.findall(r"[A-Za-z][A-Za-z'’\-]*", text[match.end():])
        index = 0
        while index < len(words) and index < 4:
            word = words[index].lower()
            if word in verbs:
                # do/does/did 后跟否定词时是助动词，不算动作。
                if word in ("do", "does", "did") and index + 1 < len(words) \
                        and words[index + 1].lower() in ("not", "never"):
                    index += 2
                    continue
                # do/does/did 后跟另一个动作动词时是助动词，跳到实义动词。
                if word in ("do", "does", "did") and index + 1 < len(words) \
                        and words[index + 1].lower() in verbs:
                    index += 1
                    continue
                return words[index]
            if word in _WE_EN_SKIP:
                index += 1
                continue
            break
    return ""


def _we_action_zh(text: str, verbs: list) -> str:
    """中文句：出现「我们」，其后（跳过副词）紧跟动作动词。"""
    for match in re.finditer("我们", text):
        rest = text[match.end():].lstrip(" \t，,、；;：:。")
        for skip in _WE_ZH_SKIP:
            if rest.startswith(skip):
                rest = rest[len(skip):].lstrip(" \t，,、；;：:")
                break
        if rest.startswith("的"):
            continue
        if rest.startswith("加以"):
            continue
        for verb in verbs:
            if rest.startswith(verb):
                return verb
    return ""


def _we_action_findings(sentences, rules: dict) -> tuple[list, dict]:
    """批 129 WE_ACTION_DENSITY：动作句 ÷ 总句数。

    只认「主语 we/我们 ＋ 动作动词」；``we propose`` / 「我们提出」不算。
    """
    english, chinese = _we_action_words(rules)
    hits = []
    for doc, start, end, _units in sentences:
        text = _norm_space(doc.prose[start:end])
        if _cjk_heavy(text):
            verb = _we_action_zh(text, chinese)
        else:
            verb = _we_action_en(text, english)
        if verb:
            hits.append((doc, start, text, verb))
    total = len(sentences)
    ratio = len(hits) / total if total else 0.0
    details = {"hits": len(hits), "sentences": total,
               "ratio": round(ratio, 3),
               "examples": [{"file": doc.file,
                             "line": _line_of(doc, start),
                             "verb": verb, "text": _clip(text, 120)}
                            for doc, start, text, verb in hits[:10]]}
    if not hits:
        return [], details
    first = hits[0]
    return [Finding(
        "WE_ACTION_DENSITY", first[0].file, _line_of(first[0], first[1]),
        "动作句 %d / 总句 %d = %.1f%%（阈值 %.1f%%）"
        % (len(hits), total, ratio * 100.0,
           float(rules.get("thresholds", {}).get("we_action_density", 0.15))
           * 100.0),
        "「我们做了 X」多于「X 意味着 Y」：把动作句改成「X 意味着 Y」，"
        "主语换成对象或结论；只改主语与谓语，事实、数字与引用不动。",
        "we_action_density")], details


def analyze(cfg: Config, sections: list[tuple[str, str]], rules: dict,
            rules_path: str = "",
            before: tuple[Config, list[tuple[str, str]]] | None = None,
            report_unregistered: bool = False,
            report_abbrev: bool = False,
            formats: dict[str, str] | None = None,
            stage: str = STAGE_DRAFT,
            rule_report: dict | None = None
            ) -> StyleResult:
    thresholds = _thresholds(rules)
    limits = _limits(rules)
    min_units = limits["min_paragraph_units"]
    cap = limits["max_findings_per_metric"]
    rhythm_level = str(rules.get("rhythm_plateau_level", "info")).strip().lower()
    if rhythm_level not in ("info", "yellow"):
        raise ConfigError("rhythm_plateau_level 只能是 \"info\" 或 \"yellow\"：%r"
                          % rules.get("rhythm_plateau_level"))
    rhythm_yellow = rhythm_level == "yellow"
    # 批 130：阶段开关只从命令行来，rules 里即使有同名字段也不读。
    numeral_stage = str(stage or STAGE_DRAFT).strip().lower()
    if numeral_stage == "off":       # 旧内部值，等价于 revision
        numeral_stage = STAGE_REVISION
    if numeral_stage not in STAGE_VALUES:
        raise ConfigError("--stage 只能是 \"draft\" 或 \"revision\"：%r"
                          % stage)
    report = dict(rule_report or {"present": False, "path": None,
                                  "source": "default", "count": 0,
                                  "keys": [], "ignored": []})
    ignored_warning = _ignored_warning(report)

    connective_re = _phrase_regex(_words(rules, "connectives"))
    connective_cn = _cn_words(rules, "connectives")
    adjective_re = _phrase_regex(_words(rules, "empty_adjectives"))
    adjective_cn = _cn_words(rules, "empty_adjectives")
    exempts = [str(x).lower() for x in
               (rules.get("empty_adjectives") or {}).get("exempt_phrases") or []]
    closer_re = _phrase_regex(_words(rules, "paragraph_closers"))
    closer_cn = _cn_words(rules, "paragraph_closers")
    hedge_re = _phrase_regex(_words(rules, "hedge_stacks"))
    hedge_cn = _cn_words(rules, "hedge_stacks")
    explainer_re = _phrase_regex(_words(rules, "explainers"))
    explainer_cn = _cn_words(rules, "explainers")
    chain_min_sentences = int(thresholds["justify_chain_min_sentences"])
    chain_min_paragraphs = int(thresholds["justify_chain_min_paragraphs"])

    docs: list[_Doc] = []
    for rel, text in sections:
        fmt = (formats or {}).get(rel, "tex")
        prose, heads, raw, list_prose, list_spans = _source_view(text, fmt)
        docs.append(_Doc(rel, prose,
                         [i for i, c in enumerate(prose) if c == "\n"],
                         raw, heads, list_prose, list_spans))
    before_docs: list[_Doc] = []
    if before is not None:
        for rel, text in before[1]:
            prose, heads, raw, _lprose, _lspans = _source_view(text, "tex")
            before_docs.append(_Doc(rel, prose,
                                    [i for i, c in enumerate(prose) if c == "\n"],
                                    raw, heads))

    # ---- 批 131：证据钢印（只查人写的 [evidence]；丢了改前已有的事实另判）----
    evidence_issues, evidence_details = check_evidence(
        cfg, sections, before=before)
    evidence_findings = [
        Finding(issue.code, issue.file, issue.line, issue.text,
                issue.suggestion, issue.metric, severity="red",
                message_key=getattr(issue, "message_key", "")
                or finding_key(issue.code),
                params=dict(getattr(issue, "params", {}) or {}))
        for issue in evidence_issues]

    total_units = sum(units_of(d.prose) for d in docs)
    all_sentences = []          # [(doc, start, end, units)]
    all_paragraphs = []         # [(doc, start, end, units)]
    paragraph_sentences = []    # 每段的句子序列（节奏平台按段判，不跨段）
    # 含短段的全量分段：B3 只按「同段」计数，不因段短而漏计。
    dang_paragraphs = []
    for doc in docs:
        for start, end in _paragraphs(doc, 0):
            unit_count = units_of(doc.prose[start:end])
            seq = [(doc, s, e, units_of(doc.prose[s:e]))
                   for s, e in _sentences(doc.prose[start:end], start)]
            dang_paragraphs.append(seq)
            if unit_count >= min_units:
                all_paragraphs.append((doc, start, end, unit_count))
                all_sentences.extend(seq)
                paragraph_sentences.append(seq)

    instances: dict[str, list[Finding]] = {code: [] for code in CODE_OF.values()}
    paragraph_infos: dict[tuple[str, int], ParagraphInfo] = {}

    # ---- 批 128：篇幅预算（只在项目配了 [budget] 时跑）----
    budget_findings, budget_details, budget_worst = _section_length_findings(
        cfg, docs, float(thresholds["section_length_excess_percent"]))
    instances["SECTION_LENGTH"].extend(budget_findings)

    # ---- 批 129：读者感觉三项的代理判据（全黄，退出码不变）----
    root_rel = getattr(cfg, "root_tex", "") or ""
    numeral_findings, numeral_details, numeral_worst, numeral_info = \
        _numeral_density_findings(
            docs, thresholds["numeral_density"], numeral_stage,
            root_file=root_rel)
    instances["NUMERAL_DENSITY"].extend(numeral_findings)
    overlap_findings, overlap_details, overlap_worst = \
        _section_overlap_findings(
            docs, float(thresholds["section_overlap"]), root_file=root_rel)
    instances["SECTION_OVERLAP"].extend(overlap_findings)
    we_findings, we_details = _we_action_findings(all_sentences, rules)
    instances["WE_ACTION_DENSITY"].extend(we_findings)

    # ---- 批 102：句法级判据（各按条计，无密度闸）----
    instances["LIGHT_VERB_NOMINALIZATION"].extend(
        _light_verb_findings(all_sentences, rules, thresholds))
    instances["WORDINESS_BLOAT"].extend(
        _wordiness_bloat_findings(all_sentences, rules))
    instances["ZH_DE_STACK"].extend(
        _zh_de_stack_findings(all_sentences, thresholds))
    instances["ZH_POSTPOSED_CONDITION"].extend(
        _zh_postposed_condition_findings(all_sentences, rules))
    instances["ZH_DUE_TO_MAKE"].extend(
        _zh_due_to_make_findings(all_sentences, rules))
    instances["ZH_LIGHT_VERB_NOUN"].extend(
        _zh_light_verb_noun_findings(all_sentences, rules))

    # ---- 批 105 B 档：两条密度型 + 三条按条型 ----
    nom_findings, nom_rate, nom_stripped = _nominalization_rate_findings(
        all_sentences, rules)
    instances["NOMINALIZATION_RATE"].extend(nom_findings)
    zhe_findings, zhe_hits = _zh_aspect_zhe_findings(all_sentences, rules)
    instances["ZH_ASPECT_ZHE"].extend(zhe_findings)
    instances["ZH_DANG_WHEN"].extend(
        _zh_dang_when_findings(dang_paragraphs, rules))
    instances["ZH_COLLOCATION_REDUNDANCY"].extend(
        _zh_collocation_findings(all_sentences, rules))
    abbrev_enabled = bool(report_abbrev
                          or rules.get("abbrev_first_use", False))
    if abbrev_enabled:
        instances["ABBREV_FIRST_USE"].extend(
            _abbrev_first_use_findings(all_sentences, rules))
    cjk_chars = sum(len(_CJK_RE.findall(d.prose)) for d in docs)
    zhe_rate = round(zhe_hits * 1000.0 / cjk_chars, 2) if cjk_chars else 0.0
    metric_details = {
        "nominalization_stripped": nom_stripped,
        "abbrev_first_use_enabled": abbrev_enabled,
        "zh_aspect_zhe_raw_hits": zhe_hits,
        "rhythm_plateau_level": rhythm_level,
        "section_budget": budget_details,
        "numeral_density_stage": numeral_stage,
        "numeral_density_sections": numeral_details,
        "evidence": evidence_details,
        "evidence_sections_declared": evidence_details["declared"],
        "evidence_sections_unknown": evidence_details["unknown_sections"],
        "section_overlap_pairs": overlap_details,
        "we_action_density": we_details,
    }

    # ---- 1. 套话连接词 ----
    connective_hits = 0
    for doc, start, end, _w in all_sentences:
        sentence = _norm_space(doc.prose[start:end])
        for s, _e, token in _iter_matches(sentence, connective_re, connective_cn):
            # 只把句首（或分句首）的连接词算作「套话连接」；"overall accuracy"
            # 这类定语用法不算，避免误伤。
            if sentence[:s].strip(" \"'“‘(["):
                continue
            connective_hits += 1
            replacement = _strip_connective(sentence, token)
            instances["CONNECTIVE_DENSITY"].append(Finding(
                "CONNECTIVE_DENSITY", doc.file, _line_of(doc, start), _clip(sentence, 180),
                "删去「%s」，直接陈述：%s" % (token, _clip(replacement, 120)),
                "connective_density", params={"token": str(token), "clip": str(_clip(replacement, 120))}))

    # ---- 1b. 解释性套语：密度 + 反射式解释链（批 99）----
    explainer_hits = 0
    for doc, start, end, _w in all_sentences:
        sentence = _norm_space(doc.prose[start:end])
        token = _explainer_opener(sentence, explainer_re, explainer_cn)
        if not token:
            continue
        explainer_hits += 1
        replacement = _strip_opener(sentence, token)
        instances["EXPLAINER_DENSITY"].append(Finding(
            "EXPLAINER_DENSITY", doc.file, _line_of(doc, start),
            _clip(sentence, 180),
            "句首「%s」是解释性套语：先删掉它，让断言自己站住（例：'%s'）；"
            "证据只在真正需要它的那一处出现一次。" % (token, _clip(replacement, 120)),
            "explainer_density", params={"token": str(token), "clip": str(_clip(replacement, 120))}))

    chain_findings: list[Finding] = []
    for doc in docs:
        closing = []        # [(line, 原句, 是否解释句)]
        for pstart, pend in _paragraphs(doc, 1):
            sents = []
            for s, e in _sentences(doc.prose[pstart:pend], pstart):
                text = _norm_space(doc.prose[s:e])
                token = _explainer_opener(text, explainer_re, explainer_cn)
                sents.append((s, text, token))
            if not sents:
                continue
            hits = [x for x in sents if x[2]]
            if len(hits) >= chain_min_sentences:
                second = hits[1]
                chain_findings.append(Finding(
                    "JUSTIFY_CHAIN", doc.file, _line_of(doc, second[0]),
                    _clip(second[1], 180),
                    "同一段有 %d 句以解释套语开头：留一句解释就够，其余删掉；"
                    "让断言自己站住，不要每句都补一个理由。" % len(hits),
                    "justify_chain", message_key="finding.JUSTIFY_CHAIN.v2", params={"arg0": str(int(len(hits)))}))
            last_start, last_text, last_token = sents[-1]
            closing.append((_line_of(doc, last_start), last_text,
                            bool(last_token)))
        # 连续段落都以解释句收尾：一段连续的解释收尾只报一处。
        i = 0
        while i < len(closing):
            if not closing[i][2]:
                i += 1
                continue
            j = i
            while j + 1 < len(closing) and closing[j + 1][2]:
                j += 1
            run = j - i + 1
            if run >= chain_min_paragraphs:
                line, text, _flag = closing[j]
                chain_findings.append(Finding(
                    "JUSTIFY_CHAIN", doc.file, line, _clip(text, 180),
                    "连续 %d 段都用解释句收尾：删掉最后一段的解释句，让段落停在"
                    "事实或结论上；解释只在读者会误解的地方出现一次。" % run,
                    "justify_chain", message_key="finding.JUSTIFY_CHAIN.v3", params={"run": str(int(run))}))
            i = j + 1

    seen_chain: set = set()
    unique_chain: list[Finding] = []
    for finding in chain_findings:
        key = (finding.file, finding.line)
        if key in seen_chain:
            continue
        seen_chain.add(key)
        unique_chain.append(finding)
    instances["JUSTIFY_CHAIN"].extend(unique_chain)

    # ---- 2. 空泛形容词 ----
    adjective_hits = 0
    for doc, start, end, _w in all_sentences:
        sentence = _norm_space(doc.prose[start:end])
        for s, e, token in _iter_matches(sentence, adjective_re, adjective_cn):
            context = sentence[max(0, s - 24):min(len(sentence), e + 24)].lower()
            if any(x in context for x in exempts):
                continue
            adjective_hits += 1
            nxt = re.match(r"[A-Za-z][A-Za-z'’\-]*",
                           sentence[e:].lstrip(" ,，"))
            phrase = token + (" " + nxt.group(0) if nxt else "")
            instances["EMPTY_ADJECTIVE"].append(Finding(
                "EMPTY_ADJECTIVE", doc.file, _line_of(doc, start), _clip(sentence, 180),
                "删掉「%s」这个标签，改成可核验的事实（例：'This step is %s' → "
                "'This step raises resolved instances from 5 to 10'）" % (phrase, token),
                "empty_adjective", params={"phrase": str(phrase), "token": str(token)}))

    # ---- 3. 插入语破折号（逐处报；数值范围/页码/数学环境排除）----
    dash_hits = 0
    for doc in docs:
        for m in _EM_DASH_RE.finditer(doc.prose):
            if _is_range_dash(doc.prose, m.start(), m.end()):
                continue
            dash_hits += 1
            excerpt = _norm_space(doc.prose[max(0, m.start() - 40):
                                            min(len(doc.prose), m.end() + 40)])
            instances["DASH_PARENTHETICAL"].append(Finding(
                "DASH_PARENTHETICAL", doc.file, _line_of(doc, m.start()),
                _clip(excerpt, 180),
                "插入语破折号：按优先级改 ① 去掉「——」，改成逗号从属句；"
                "② 改用括号括起；③ 拆成独立一句。三种都不改事实与数字。",
                "dash_parenthetical"))

    # ---- 3b. 标题：过长 / 带解释 / 术语未在首句定义 / 首句复述标题 ----
    heading_counts = {"HEADING_TOO_LONG": 0,
                      "HEADING_ECHO": 0, "HEADING_RELATION_CHANGED": 0,
                      "HEADING_SUBJECT_LOST": 0, "HEADING_SUBSTITUTED": 0,
                      "TERM_FIRST_IN_HEADING": 0}
    glossary = _glossary_for(rules, cfg.root)
    allow_keys, allow_canon = _term_allowlist(rules, cfg.root, glossary)
    seen_unregistered: set = set()
    for doc in docs:
        heads = doc.headings
        for idx, head in enumerate(heads):
            title, line = head["title"], head["line"]
            if _cjk_heavy(title):
                too_long = (len(_CJK_RE.findall(title))
                            > thresholds["heading_max_chars_zh"])
                limit_txt = "%d 字" % thresholds["heading_max_chars_zh"]
            else:
                too_long = (len(_LATIN_WORD_RE.findall(title))
                            > thresholds["heading_max_words_en"])
                limit_txt = "%d 词" % thresholds["heading_max_words_en"]
            if too_long:
                heading_counts["HEADING_TOO_LONG"] += 1
                instances["HEADING_TOO_LONG"].append(Finding(
                    "HEADING_TOO_LONG", doc.file, line, _clip(title, 160),
                    "标题压到 %s 以内：把副标题或解释移到正文首句，标题只留"
                    "名词短语；不改正文事实。" % limit_txt,
                    "heading_too_long", params={"limit_txt": str(limit_txt)}))
            # v5：首句只是复述标题（复述/垫话/设问）——只判本节自己的正文。
            # 下一标题若是行内 \paragraph，它的首句可能和标题同在一行，
            # 仍算本节正文，不能用 stop_line 跳过。
            stop_line = None
            if idx + 1 < len(heads) and heads[idx + 1]["cmd"] not in (
                    "paragraph", "subparagraph"):
                stop_line = heads[idx + 1]["line"]
            first_txt, first_pos = _first_sentence_span_after(
                doc, head["end_line"], stop_line=stop_line)
            # ---- 批 90：TERM_FIRST_IN_HEADING 按 canonical 比对 ----
            first_key = key_of(first_txt)
            first_canon = {m.canonical for m in glossary.matches(first_txt)}
            # 批 94：只判在册术语（paper.tsv / 项目 glossary.tsv）。README
            # 的「黄牌规则」「已知缺口」不是学术术语，不该按术语判；未在册
            # 的词交给默认关闭的 TERM_UNREGISTERED。
            # Markdown 标题常是整句，因此直接用标题里命中的在册表面形式作为
            # 候选（整句粗切会切出伪术语，且 2–3 字术语会被漏掉）。
            if head.get("format") == "markdown":
                candidates = []
                seen_canon: set = set()
                for match in _paper_term_matches(title, glossary):
                    if match.canonical in seen_canon:
                        continue
                    seen_canon.add(match.canonical)
                    candidates.append(match.surface)
            else:
                candidates = [cand for cand in _term_candidates(title)
                              if _paper_term_matches(cand, glossary)]
            for cand in candidates:
                cand_key = key_of(cand)
                canon = glossary.canonical_of(cand)
                if cand_key in allow_keys:
                    continue
                if canon is not None and canon in allow_canon:
                    continue
                if canon is not None:
                    if canon in first_canon:
                        continue
                elif cand_key and cand_key in first_key:
                    continue
                elif glossary:
                    cand_canon = {m.canonical for m in glossary.matches(cand)}
                    if cand_canon and cand_canon <= first_canon:
                        continue
                heading_counts["TERM_FIRST_IN_HEADING"] += 1
                instances["TERM_FIRST_IN_HEADING"].append(Finding(
                    "TERM_FIRST_IN_HEADING", doc.file, line, _clip(title, 160),
                    "标题里的「%s」第一次出现时，请在该节首句用一句话定义或"
                    "点明它是什么（例：预注册是在收集数据前固定假设与分析"
                    "计划的做法）；复述标题、垫话（如「相关工作里，」）与设问"
                    "都不算定义。可在 term-allow.txt 登记白名单，只改措辞，"
                    "不改事实。" % cand,
                    "term_first_in_heading", params={"cand": str(cand)}))
            # ---- 批 91：TERM_UNREGISTERED（默认关；打开时只查标题）----
            if report_unregistered:
                instances["TERM_UNREGISTERED"].extend(
                    _unregistered_findings(doc, line, title, glossary,
                                           allow_keys, allow_canon,
                                           seen_unregistered))
            if first_txt and _heading_echo(title, first_txt, rules, thresholds,
                                           glossary):
                heading_counts["HEADING_ECHO"] += 1
                instances["HEADING_ECHO"].append(Finding(
                    "HEADING_ECHO", doc.file, _line_of(doc, first_pos),
                    _clip(first_txt, 180),
                    "首句只是复述标题；改成一句定义或可检验的断言（例：预注册"
                    "是在收集数据前固定假设与分析计划的做法）。复述标题、"
                    "垫话（「相关工作里，」）与设问都不算定义。",
                    "heading_echo"))

    # ---- 批 90：TERM_VARIANT（同一 canonical 一篇多写法）----
    variant_findings = _term_variant_findings(
        docs, glossary, int(thresholds["term_variant_min_forms"]))
    instances["TERM_VARIANT"].extend(variant_findings)

    # v5：改写前后标题比对（只在 style --diff 传入 --before 时运行）
    if before is not None:
        for finding in _rewrite_heading_findings(docs, before_docs, rules):
            heading_counts[finding.code] += 1
            instances[finding.code].append(finding)

    # ---- 3c. 同构三点并列：相邻段落重复才算 ----
    para_triads = []
    for doc, start, end, _units in all_paragraphs:
        hits = _paragraph_triads(doc.prose[start:end], start)
        para_triads.append((doc, hits))
    repeated_triads = []
    seen_triad = set()
    prev_sigs: dict = {}
    prev_file = None
    for doc, hits in para_triads:
        if prev_file != doc.file:
            prev_sigs = {}
        cur_sigs: dict = {}
        for start, end, raw, sig in hits:
            cur_sigs.setdefault(sig, []).append((doc, start, end, raw))
            if sig in prev_sigs:
                for occ in prev_sigs[sig] + [(doc, start, end, raw)]:
                    key = (occ[0].file, occ[1])
                    if key not in seen_triad:
                        seen_triad.add(key)
                        repeated_triads.append(occ)
        prev_sigs = cur_sigs
        prev_file = doc.file
    for doc, start, _end, raw in repeated_triads:
        instances["COLLOQUIAL_TRIAD"].append(Finding(
            "COLLOQUIAL_TRIAD", doc.file, _line_of(doc, start), _clip(raw, 160),
            "同构三点并列在相邻段落重复：把其中一段的三项改成两项或拆成两句，"
            "只留有信息的两项；结构跟着内容走，不改事实。",
            "colloquial_triad"))

    # ---- 4. 段末套话收尾 / 5. 相邻段同头 ----
    template_flags = 0
    repeated = 0
    opener_stop = {str(x).lower() for x in
                   (rules.get("repeated_opener") or {}).get("stopwords") or []}
    prev_first = None
    prev_line = 0
    prev_file = None
    for doc, start, end, units in all_paragraphs:
        text = doc.prose[start:end]
        sentences = _sentences(text, start)
        info = ParagraphInfo(doc.file, _line_of(doc, start), units,
                             [], _first_word(text))
        if sentences:
            last_start, last_end = sentences[-1]
            last = _norm_space(doc.prose[last_start:last_end])
            head = last.lstrip(" \"'“”‘’`")
            closes = bool(closer_re and closer_re.match(head)) or \
                any(head.startswith(w) for w in closer_cn)
            if closes:
                template_flags += 1
                info.flags.append("PARAGRAPH_TEMPLATE")
                instances["PARAGRAPH_TEMPLATE"].append(Finding(
                    "PARAGRAPH_TEMPLATE", doc.file, _line_of(doc, last_start),
                    _clip(last, 180),
                    "段末不要用套话收尾：删掉句首的「Therefore/Overall/Thus」等，"
                    "让最后一句停在具体证据上（例：'Therefore, X is better' → "
                    "'X resolved 10 of 16 instances'）", "paragraph_template"))
            if (prev_file == doc.file and prev_first
                    and info.first_word == prev_first
                    and not _is_stopword(info.first_word, opener_stop)):
                repeated += 1
                info.flags.append("REPEATED_OPENER")
                instances["REPEATED_OPENER"].append(Finding(
                    "REPEATED_OPENER", doc.file, info.line,
                    _clip(_norm_space(text), 180),
                    "本段与上一段（第 %d 行）都以「%s」开头：把本段首句改成以研究对象"
                    "开头（例：'We use X to ...' → 'X is used to ...'）"
                    % (prev_line, info.first_word), "repeated_opener", params={"prev_line": str(int(prev_line)), "info": str(info.first_word)}))
        prev_first = info.first_word
        prev_line = info.line
        prev_file = doc.file
        paragraph_infos[(doc.file, info.line)] = info

    # ---- 6. 双重模糊限定 ----
    hedge_hits = 0
    for doc in docs:
        for m in _iter_matches(doc.prose, hedge_re, hedge_cn):
            start, end, token = m
            line = _line_of(doc, start)
            excerpt = _norm_space(doc.prose[start:min(end + 80, len(doc.prose))])
            hedge_hits += 1
            low = token.lower()
            if low.startswith(("may", "might", "could")):
                short = token.split()[0]
            elif "suggest" in low:
                short = "suggests"
            elif "indicate" in low:
                short = "indicates"
            elif _CJK_RE.search(token):
                short = "可能" if token.startswith("可能") else token
            else:
                short = token
            instances["HEDGE_STACK"].append(Finding(
                "HEDGE_STACK", doc.file, line, _clip(excerpt, 180),
                "双重限定叠在一起：把「%s」减成一层「%s」；能给出证据就删掉限定"
                % (token, short), "hedge_stack", params={"token": str(token), "short": str(short)}))

    # ---- 7. 超长句（只报「又长又没有结构」的；长而有结构的句子不报） ----
    extreme_hits = 0
    sentence_units = [(units, doc, start, _norm_space(doc.prose[start:end]))
                      for doc, start, end, units in all_sentences]
    # 列表行不进段落/节奏统计，但列表里真有超长句仍要报（批 94）：
    # 列表视图按「行」切句——同一列表的两项不并成一句。
    extreme_items = list(all_sentences)
    for doc in docs:
        for line_start, line_end in doc.list_spans:
            line = doc.list_prose[line_start:line_end]
            for s, e in sentence_spans(line):
                piece = line[s:e]
                if not piece.strip() or units_of(piece) < 2:
                    continue
                extreme_items.append(
                    (doc, line_start + s, line_start + e, units_of(piece)))
    for doc, start, end, units in extreme_items:
        raw_sentence = doc.prose[start:end]
        if not raw_sentence.strip():
            raw_sentence = doc.list_prose[start:end]
        sentence = _norm_space(raw_sentence)
        limit = (thresholds["sentence_length_extreme_zh"] if _cjk_heavy(sentence)
                 else thresholds["sentence_length_extreme_en"])
        if units > limit and not _has_structural_break(sentence):
            extreme_hits += 1
            instances["SENTENCE_LENGTH_EXTREME"].append(Finding(
                "SENTENCE_LENGTH_EXTREME", doc.file, _line_of(doc, start),
                _clip(sentence, 220),
                "这句 %d 词超过 %d，且句内没有从句/分号/破折号/括号断点：这一句"
                "又长又平铺，保留原有结构，考虑在语义边界换气（例：%s）；"
                "长而有结构的句子不必改，也不要整段拆短"
                % (units, limit, _clip(_extreme_split(sentence), 120)),
                "sentence_length_extreme", params={"units": str(int(units)), "limit": str(int(limit)), "clip": str(_clip(_extreme_split(sentence), 120))}))

    # ---- 7b. 节奏平台：连续 >=N 句落在同一 10 词区间 ----
    plateau_run = int(thresholds["rhythm_plateau_run"])
    plateau_window = int(thresholds["rhythm_plateau_window"])
    plateau_hits = 0
    for seq in paragraph_sentences:
        i = 0
        while i < len(seq):
            bucket = seq[i][3] // plateau_window
            j = i + 1
            while j < len(seq) and seq[j][3] // plateau_window == bucket:
                j += 1
            if j - i >= plateau_run:
                plateau_hits += 1
                first = seq[i]
                last = seq[j - 1]
                joined = " ".join(_norm_space(first[0].prose[it[1]:it[2]])
                                  for it in seq[i:j])
                unit = "字" if _cjk_heavy(joined) else "词"
                l1 = _line_of(first[0], first[1])
                l2 = _line_of(last[0], last[2])
                where = ("第 %d 行" % l1) if l1 == l2 else ("第 %d–%d 行" % (l1, l2))
                instances["RHYTHM_PLATEAU"].append(Finding(
                    "RHYTHM_PLATEAU", first[0].file, l1, _clip(joined, 220),
                    "%s连续 %d 句长度都在 %d–%d %s：节奏成了平台，"
                    "在其中插入一句 8–15 %s的短句，或把相邻两句合并，"
                    "让长短有起伏；内容与结构不动"
                    % (where, j - i, bucket * plateau_window,
                       bucket * plateau_window + plateau_window - 1, unit,
                       unit),
                    "rhythm_plateau", params={"where": str(where), "arg1": str(int(j - i)), "arg2": str(int(bucket * plateau_window)), "arg3": str(int(bucket * plateau_window + plateau_window - 1)), "unit": str(unit), "unit1": str(unit)}))
                i = j
            else:
                i += 1

    # ---- 8. 句长均匀度 ----
    sizes = [u for u, _d, _s, _t in sentence_units]
    min_sentences = limits["uniformity_min_sentences"]
    if sizes:
        raw_mean = sum(sizes) / len(sizes)
        raw_variance = sum((x - raw_mean) ** 2 for x in sizes) / len(sizes)
        raw_cv = (raw_variance ** 0.5 / raw_mean) if raw_mean else 0.0
    else:
        raw_cv = 1.0
    if len(sizes) >= min_sentences:
        mean = sum(sizes) / len(sizes)
        variance = sum((x - mean) ** 2 for x in sizes) / len(sizes)
        std = variance ** 0.5
        uniformity = (std / mean) if mean else 0.0
    else:
        mean = sum(sizes) / len(sizes) if sizes else 0.0
        std = 0.0
        # 句太少不判「整齐」（避免短文本误伤）：指标侧用 1.0 表示「不判」。
        # 阶段判断仍用 raw_cv（能算就算），否则 6 句高度同构的初稿会被误判成品。
        uniformity = 1.0

    # ---- 指标汇总与触发判定 ----
    def density(count: int) -> float:
        return round(count * 1000.0 / total_units, 2) if total_units else 0.0

    template_ratio = round(template_flags / len(all_paragraphs), 3) if all_paragraphs else 0.0
    metrics = {
        "connective_density": density(connective_hits),
        "sentence_uniformity": round(uniformity, 3),
        "empty_adjective": density(adjective_hits),
        "paragraph_template": template_ratio,
        "explainer_density": density(explainer_hits),
        "justify_chain": len(unique_chain),
        "hedge_stack": hedge_hits,
        "repeated_opener": repeated,
        "sentence_length_extreme": extreme_hits,
        "rhythm_plateau": plateau_hits,
        "dash_parenthetical": dash_hits,
        "heading_too_long": heading_counts["HEADING_TOO_LONG"],
        "heading_echo": heading_counts["HEADING_ECHO"],
        "heading_relation_changed": heading_counts["HEADING_RELATION_CHANGED"],
        "heading_subject_lost": heading_counts["HEADING_SUBJECT_LOST"],
        "heading_substituted": heading_counts["HEADING_SUBSTITUTED"],
        "term_first_in_heading": heading_counts["TERM_FIRST_IN_HEADING"],
        "term_variant": len(variant_findings),
        "term_unregistered": len(instances["TERM_UNREGISTERED"]),
        "colloquial_triad": len(repeated_triads),
        # 批 102
        "light_verb_nominalization":
            len(instances["LIGHT_VERB_NOMINALIZATION"]),
        "wordiness_bloat": len(instances["WORDINESS_BLOAT"]),
        "zh_de_stack": len(instances["ZH_DE_STACK"]),
        "zh_postposed_condition": len(instances["ZH_POSTPOSED_CONDITION"]),
        "zh_due_to_make": len(instances["ZH_DUE_TO_MAKE"]),
        "zh_light_verb_noun": len(instances["ZH_LIGHT_VERB_NOUN"]),
        # 批 105 B 档
        "nominalization_rate": nom_rate,
        "zh_aspect_zhe": zhe_rate,
        "zh_dang_when": len(instances["ZH_DANG_WHEN"]),
        "zh_collocation_redundancy":
            len(instances["ZH_COLLOCATION_REDUNDANCY"]),
        "abbrev_first_use": len(instances["ABBREV_FIRST_USE"]),
        # 批 128：超预算最狠的百分比（0.0＝没有节超预算／没配预算）
        "section_length": budget_worst,
        # 批 129：读者感觉三项
        "numeral_density": numeral_worst,
        "section_overlap": overlap_worst,
        "we_action_density": we_details["ratio"],
    }

    fired = []
    for metric, direction in DIRECTIONS.items():
        if metric not in metrics:
            continue
        value = metrics[metric]
        if metric == "sentence_length_extreme":
            limit = 1
            hit = extreme_hits >= 1
            shown = limit
        elif metric == "rhythm_plateau":
            limit = int(thresholds["rhythm_plateau_run"])
            hit = rhythm_yellow and plateau_hits >= 1
            shown = limit
        elif metric in ("hedge_stack", "repeated_opener"):
            limit = thresholds[metric]
            hit = value >= limit
            shown = limit
        elif metric == "dash_parenthetical":
            limit = int(thresholds["dash_budget"])
            hit = dash_hits > limit
            shown = limit
        elif metric == "colloquial_triad":
            limit = int(thresholds["colloquial_triad_repeats"])
            hit = len(repeated_triads) >= limit
            shown = limit
        elif metric == "term_variant":
            limit = int(thresholds["term_variant_min_forms"])
            hit = bool(variant_findings)
            shown = limit
        elif metric == "justify_chain":
            limit = 1
            hit = bool(unique_chain)
            shown = limit
        elif metric == "section_length":
            limit = thresholds["section_length_excess_percent"]
            hit = value > limit
            shown = limit
        elif metric == "numeral_density":
            limit = thresholds["numeral_density"]
            if limit is None:       # 批 131：null＝不判
                continue
            hit = numeral_stage not in ("revision", "off") and value > limit
            shown = limit
        elif metric in ("light_verb_nominalization", "wordiness_bloat",
                        "zh_de_stack", "zh_postposed_condition",
                        "zh_due_to_make", "zh_light_verb_noun",
                        "zh_dang_when", "zh_collocation_redundancy",
                        "abbrev_first_use"):
            limit = 1
            hit = value >= limit
            shown = limit
        elif metric in ("heading_too_long",
                        "term_first_in_heading", "heading_echo",
                        "heading_relation_changed", "heading_subject_lost",
                        "heading_substituted"):
            limit = 1
            hit = value >= limit
            shown = limit
        elif direction == "above":
            limit = thresholds[metric]
            hit = value > limit
            shown = limit
        else:
            limit = thresholds[metric]
            hit = value < limit
            if metric == "sentence_uniformity":
                if len(sizes) < min_sentences:
                    hit = False
                # 上界只做健康区间说明：CV 高＝散，散不是 AI 特征，不报
                if value > thresholds["sentence_uniformity_high"]:
                    hit = False
            shown = limit
        if hit:
            fired.append({"code": CODE_OF[metric], "metric": metric,
                          "value": value, "threshold": shown,
                          "direction": direction})

    # 句长均匀度：整篇一条，指出最短/最长句的位置，便于具体改
    if (len(sizes) >= min_sentences
            and uniformity < thresholds["sentence_uniformity"]
            and uniformity <= thresholds["sentence_uniformity_high"]
            and sentence_units):
        short = min(sentence_units, key=lambda x: x[0])
        long = max(sentence_units, key=lambda x: x[0])
        doc = max(docs, key=lambda d: len(d.prose)) if docs else None
        instances["SENTENCE_UNIFORMITY"].append(Finding(
            "SENTENCE_UNIFORMITY", doc.file if doc else "", 1,
            "全文 %d 句：句长均值 %.1f，标准差 %.1f，CV=%.2f"
            % (len(sizes), mean, std, uniformity),
            "句长太整齐（CV=%.2f，低于健康下界 %.2f）：交替长短句，"
            "插入一句 8–15 词的短句，或把相邻短句合并；"
            "最短句在 %s:%d（%d 词），最长句在 %s:%d（%d 词）"
            % (uniformity, thresholds["sentence_uniformity"],
               short[1].file, _line_of(short[1], short[2]), short[0],
               long[1].file, _line_of(long[1], long[2]), long[0]),
            "sentence_uniformity", params={"uniformity": format(uniformity, ".2f"), "thresholds": format(thresholds['sentence_uniformity'], ".2f"), "short": str(short[1].file), "line_of": str(int(_line_of(short[1], short[2]))), "short1": str(int(short[0])), "long": str(long[1].file), "line_of1": str(int(_line_of(long[1], long[2]))), "long1": str(int(long[0]))}))

    # ---- findings：只对触发的指标出具体条目；单点指标已按条目计 ----
    fired_metrics = {f["metric"] for f in fired}
    findings: list[Finding] = []
    for code, items in instances.items():
        # TERM_UNREGISTERED 单独走 info 通道，永不进 findings 计数。
        if code == "TERM_UNREGISTERED":
            continue
        metric = next((m for m, c in CODE_OF.items() if c == code), "")
        if metric not in fired_metrics:
            continue
        findings.extend(items[:cap])
    findings.sort(key=lambda f: (FINDING_ORDER.index(f.code)
                                 if f.code in FINDING_ORDER else 99,
                                 f.file, f.line))
    # 批 131：证据钢印排在最前（红），剩下的文风命中仍是黄。
    findings = list(evidence_findings) + findings
    info = sorted(instances.get("TERM_UNREGISTERED", []) + numeral_info,
                  key=lambda f: (f.file, f.line, f.text))
    # 批 109：RHYTHM_PLATEAU 在 info 档只做参考读数，不进 findings。
    advisories = []
    if not rhythm_yellow:
        advisories = sorted(instances.get("RHYTHM_PLATEAU", []),
                            key=lambda f: (f.file, f.line, f.text))

    paragraphs = sorted(paragraph_infos.values(), key=lambda p: (p.file, p.line))
    stage = assess_stage(len(fired), raw_cv, fired)
    red_count = len(evidence_findings)
    summary = {
        "files": len(docs),
        "words": total_units,
        "sentences": len(all_sentences),
        "paragraphs": len(all_paragraphs),
        "triggered": len(fired),
        "findings": len(findings),
        "red": red_count,
        "exit_code": (EXIT_RED if red_count
                      else EXIT_YELLOW if fired else EXIT_OK),
        "stage": stage["stage"],
        "advice": stage["advice"],
    }
    return StyleResult(metrics=metrics, thresholds=dict(thresholds), fired=fired,
                       findings=findings, paragraphs=paragraphs,
                       instances=instances, summary=summary,
                       rules_path=rules_path, stage_assessment=stage,
                       info=info, advisories=advisories,
                       metric_details=metric_details,
                       rule_overrides=report,
                       rule_warnings=([ignored_warning]
                                      if ignored_warning else []),
                       stage=numeral_stage)


# --------------------------------------------------------------------------
# 给 LLM 的改写指令（<= 400 字）
# --------------------------------------------------------------------------

PROMPT_LIMIT = 400


def build_prompt(result: StyleResult, limit: int = PROMPT_LIMIT) -> str:
    red = [f for f in result.findings
           if getattr(f, "severity", "yellow") == "red"]
    if red:
        head = ("证据钢印红（阻断，退出码 1）：把下列缺的 `\\fact{id}` 按节补回，"
                "值与账本逐字一致；不许改 id、不许改数字、不许用 nearly/most/"
                "some 这类定性说法顶替。")
        items = ["%d. %s:%d 「%s」" % (idx, Path(f.file).name, f.line,
                                      _clip(f.text, 60))
                 for idx, f in enumerate(red[:6], 1)]
        text = head + "\n" + "\n".join(items)
        return text[:limit]
    # 成品稿（polished）只输出一句「建议不改」，不给逐条改写指令——盲评显示
    # 对已打磨的稿子强行改写会降低自然度（批 67–70）。
    if (result.stage_assessment or {}).get("advice") == ADVICE_REPORT_ONLY:
        return REPORT_ONLY_PROMPT[:limit]
    if not result.findings:
        text = ("未发现需要改写的公式化痕迹。不要为改写而改写；优先保留原有结构"
                "与修辞，事实、数字、引用保持原样。")
        return text[:limit]

    head = ("下列均为黄牌提示，只改措辞，不改事实、数字、引用；"
            "不得删数字、不得删引用、不得整段删除。优先保留原有结构与修辞，"
            "禁止整段拆短；节奏只在 SENTENCE_UNIFORMITY 命中处调整"
            "（RHYTHM_PLATEAU 仅作参考）。逐条处理后重新提交。")
    items = []
    # 先每个指标取一条，保证覆盖面，再补其余
    seen = set()
    ordered = []
    for f in result.findings:
        if f.code not in seen:
            seen.add(f.code)
            ordered.append(f)
    ordered += [f for f in result.findings if f not in ordered]

    for idx, f in enumerate(ordered, 1):
        item = "%d. %s:%d 「%s」→ %s" % (
            idx, Path(f.file).name, f.line, _clip(f.text, 34),
            _clip(f.suggestion, 46))
        trial = head + "\n" + "\n".join(items + [item])
        if len(trial) > limit:
            break
        items.append(item)
    tail = ""
    if len(items) < len(result.findings):
        tail = "\n（共 %d 处，先改前 %d 处。）" % (len(result.findings), len(items))
    text = head + "\n" + "\n".join(items) + tail
    if len(text) > limit:
        # 极端情况下裁掉条目，保证硬上限
        while items and len(head + "\n" + "\n".join(items) + tail) > limit:
            items.pop()
        text = head + "\n" + "\n".join(items)
        if len(text) > limit:
            text = text[:limit]
    return text


# --------------------------------------------------------------------------
# 人读报告
# --------------------------------------------------------------------------

def render_human(result: StyleResult, project: Path) -> str:
    m = result.metrics
    stage = result.stage_assessment or {}
    stage_line = ""
    if stage:
        verdict = "建议不改" if stage.get("advice") == ADVICE_REPORT_ONLY else "建议改写"
        stage_line = "阶段    : %s（%s，triggers=%d，cv=%.2f）\n判断    : %s" % (
            stage.get("stage", "?"), verdict, stage.get("triggers", 0),
            stage.get("cv", 0.0), stage.get("reason", ""))
    lines = ["== factscribe style ==",
             "project : %s" % project,
             "正文    : %d 个文件，%d 词/字，%d 句，%d 段"
             % (result.summary["files"], result.summary["words"],
                result.summary["sentences"], result.summary["paragraphs"]),
             "规则    : %s" % result.rules_path]
    overrides = result.rule_overrides or {}
    if overrides.get("present"):
        keys = list(overrides.get("keys") or [])
        if keys:
            lines.append("覆盖    : 本项目覆盖了 %d 个规则键：%s"
                         % (len(keys), "、".join(keys)))
        else:
            lines.append("覆盖    : 本项目覆盖了 0 个规则键（与内置默认一致）")
    for warning in result.rule_warnings or []:
        lines.append("规则告警：%s（%s）"
                     % (warning.get("code"), warning.get("message", "")))
    if stage_line:
        lines.append(stage_line)
    lines += ["",
              "注意：" + DISCLAIMER,
              "",
              "指标                    读数      阈值     状态",
              "-----------------------  --------  -------  ----"]
    labels = [
        ("sentence_length_extreme", "SENTENCE_LENGTH_EXTREME", ">="),
        ("dash_parenthetical", "DASH_PARENTHETICAL", ">"),
        ("heading_too_long", "HEADING_TOO_LONG", ">="),
        ("heading_echo", "HEADING_ECHO", ">="),
        ("heading_relation_changed", "HEADING_RELATION_CHANGED", ">="),
        ("heading_subject_lost", "HEADING_SUBJECT_LOST", ">="),
        ("heading_substituted", "HEADING_SUBSTITUTED", ">="),
        ("term_first_in_heading", "TERM_FIRST_IN_HEADING", ">="),
        ("term_variant", "TERM_VARIANT", ">="),
        ("term_unregistered", "TERM_UNREGISTERED", "提示"),
        ("light_verb_nominalization", "LIGHT_VERB_NOMINALIZATION", ">="),
        ("wordiness_bloat", "WORDINESS_BLOAT", ">="),
        ("zh_de_stack", "ZH_DE_STACK", ">="),
        ("zh_postposed_condition", "ZH_POSTPOSED_CONDITION", ">="),
        ("zh_due_to_make", "ZH_DUE_TO_MAKE", ">="),
        ("zh_light_verb_noun", "ZH_LIGHT_VERB_NOUN", ">="),
        ("nominalization_rate", "NOMINALIZATION_RATE", ">"),
        ("zh_aspect_zhe", "ZH_ASPECT_ZHE", ">"),
        ("zh_dang_when", "ZH_DANG_WHEN", ">="),
        ("zh_collocation_redundancy", "ZH_COLLOCATION_REDUNDANCY", ">="),
        ("abbrev_first_use", "ABBREV_FIRST_USE", ">="),
        ("numeral_density", "NUMERAL_DENSITY", ">"),
        ("section_overlap", "SECTION_OVERLAP", ">"),
        ("we_action_density", "WE_ACTION_DENSITY", ">"),
        ("rhythm_plateau", "RHYTHM_PLATEAU", ">="),
        ("colloquial_triad", "COLLOQUIAL_TRIAD", ">="),
        ("connective_density", "CONNECTIVE_DENSITY", ">"),
        ("empty_adjective", "EMPTY_ADJECTIVE", ">"),
        ("sentence_uniformity", "SENTENCE_UNIFORMITY", "<"),
        ("paragraph_template", "PARAGRAPH_TEMPLATE", ">"),
        ("explainer_density", "EXPLAINER_DENSITY", ">"),
        ("justify_chain", "JUSTIFY_CHAIN", ">="),
        ("hedge_stack", "HEDGE_STACK", ">="),
        ("repeated_opener", "REPEATED_OPENER", ">="),
    ]
    fired_codes = {f["code"] for f in result.fired}
    for key, label, op in labels:
        if key == "sentence_length_extreme":
            threshold = ">%d/%d" % (result.thresholds["sentence_length_extreme_en"],
                                    result.thresholds["sentence_length_extreme_zh"])
        elif key == "sentence_uniformity":
            threshold = "%s-%s" % (_fmt(result.thresholds["sentence_uniformity"]),
                                   _fmt(result.thresholds["sentence_uniformity_high"]))
        elif key == "rhythm_plateau":
            threshold = "run>=%d" % result.thresholds["rhythm_plateau_run"]
        elif key == "dash_parenthetical":
            threshold = "<=%d" % result.thresholds["dash_budget"]
        elif key == "heading_too_long":
            threshold = "<=%d字/%d词" % (
                result.thresholds["heading_max_chars_zh"],
                result.thresholds["heading_max_words_en"])
        elif key == "colloquial_triad":
            threshold = "repeat>=%d" % result.thresholds["colloquial_triad_repeats"]
        elif key == "term_variant":
            threshold = "forms>=%d" % result.thresholds["term_variant_min_forms"]
        elif key == "justify_chain":
            threshold = "chain>=%d/%d" % (
                result.thresholds["justify_chain_min_sentences"],
                result.thresholds["justify_chain_min_paragraphs"])
        elif key == "term_unregistered":
            threshold = "提示"
        elif key == "zh_de_stack":
            threshold = "gap<=%d字" % (
                result.thresholds["zh_de_stack_max_gap"],)
        elif key in ("light_verb_nominalization", "wordiness_bloat",
                     "zh_postposed_condition", "zh_due_to_make",
                     "zh_light_verb_noun"):
            threshold = ">=1"
        elif key == "nominalization_rate":
            threshold = ">%s/100词" % _fmt(
                result.thresholds.get("nominalization_rate", 0))
        elif key == "zh_aspect_zhe":
            threshold = ">%s/千字" % _fmt(
                result.thresholds.get("zh_aspect_zhe", 0))
        elif key in ("zh_dang_when", "zh_collocation_redundancy",
                     "abbrev_first_use"):
            threshold = ">=1处"
        elif key == "numeral_density":
            limit = result.thresholds.get("numeral_density")
            threshold = ("—" if limit is None
                         else ">%s/千词(字)" % _fmt(limit))
        elif key == "section_overlap":
            threshold = ">%s%%" % _fmt(
                result.thresholds.get("section_overlap", 0))
        elif key == "we_action_density":
            threshold = ">%s%%" % _fmt(
                result.thresholds.get("we_action_density", 0) * 100.0)
        elif key in ("term_first_in_heading", "heading_echo",
                     "heading_relation_changed", "heading_subject_lost",
                     "heading_substituted"):
            threshold = ">=1"
        else:
            threshold = "%s" % _fmt(result.thresholds.get(key, 0))
        value = m[key]
        value_shown = (("%.1f%%" % (value * 100.0))
                       if key == "we_action_density" else _fmt(value))
        status = "触发" if label in fired_codes else "ok"
        if key == "rhythm_plateau" and not result.metric_details.get(
                "rhythm_plateau_level") == "yellow":
            status = "参考"
        if (key == "abbrev_first_use"
                and not result.metric_details.get("abbrev_first_use_enabled")):
            status = "关"
        if (key == "numeral_density"
                and result.metric_details.get("numeral_density_stage")
                in ("revision", "off")):
            status = "关"
        if (key == "numeral_density"
                and result.thresholds.get("numeral_density") is None):
            status = "关（默认不判）"
        if key == "term_unregistered" and m.get("term_unregistered"):
            status = "提示"
        lines.append("%-23s  %-8s  %-7s  %s"
                     % (label, value_shown, threshold, status))
    stripped = result.metric_details.get("nominalization_stripped") or []
    if stripped:
        lines.append("")
        lines.append("名词化剥离（本文高频术语，前 %d 个）：%s"
                     % (len(stripped), "、".join(stripped)))
    lines.append("")
    red = [f for f in result.findings
           if getattr(f, "severity", "yellow") == "red"]
    if red:
        lines.append("[红] %d 处证据缺钉（阻断；退出码 1）" % len(red))
        for idx, f in enumerate(red, 1):
            lines.append(" %2d. %-22s %s:%d" % (idx, f.code, f.file, f.line))
            lines.append("     原文：" + _clip(f.text, 160))
            lines.append("     改法：" + f.suggestion)
    if result.fired and stage.get("advice") == ADVICE_REPORT_ONLY:
        lines.append("[观察] %d 处清单（成品稿：建议不改，以下只作报告）"
                     % len([f for f in result.findings
                            if getattr(f, "severity", "yellow") != "red"]))
    elif result.fired:
        lines.append("[黄] %d 处具体改法（只提示，不阻断；退出码 3）"
                     % len([f for f in result.findings
                            if getattr(f, "severity", "yellow") != "red"]))
    elif not red:
        lines.append("[黄] 0 处——所有指标在阈值内。")
    if result.fired:
        yellow = [f for f in result.findings
                  if getattr(f, "severity", "yellow") != "red"]
        for idx, f in enumerate(yellow, 1):
            lines.append(" %2d. %-22s %s:%d" % (idx, f.code, f.file, f.line))
            lines.append("     原文：" + _clip(f.text, 160))
            lines.append("     改法：" + f.suggestion)
    info = getattr(result, "info", [])
    if info:
        lines.append("")
        lines.append("[信息] %d 条未登记术语提示（不计数、不影响退出码）"
                     % len(info))
        for idx, f in enumerate(info, 1):
            lines.append(" %2d. %-22s %s:%d  %s"
                         % (idx, f.code, f.file, f.line, _clip(f.text, 80)))
    advisories = getattr(result, "advisories", [])
    if advisories:
        lines.append("")
        lines.append("[参考] %d 条节奏平台读数（info：不计数、不影响退出码；"
                     "节奏的正式判据是 SENTENCE_UNIFORMITY）" % len(advisories))
        for idx, f in enumerate(advisories, 1):
            lines.append(" %2d. %-22s %s:%d  %s"
                         % (idx, f.code, f.file, f.line, _clip(f.text, 80)))
    flagged = [p for p in result.paragraphs if p.flags]
    if flagged:
        lines.append("")
        lines.append("段级标记（%d 段）：" % len(flagged))
        for p in flagged[:40]:
            lines.append("  %s:%d  %d 词  %s"
                         % (p.file, p.line, p.words, "、".join(p.flags)))
    lines.append("")
    lines.append("说明：本闸只报「可机械判定的公式化写法」，不评估、也不试图规避"
                 "任何 AI 检测器；黄牌不阻断构建、不改正文，证据钢印红例外"
                 "（REQUIRED_EVIDENCE_MISSING / EVIDENCE_DROPPED 阻断）。")
    return "\n".join(lines)


def _fmt(value) -> str:
    if isinstance(value, float):
        return ("%.2f" % value).rstrip("0").rstrip(".")
    return str(value)
