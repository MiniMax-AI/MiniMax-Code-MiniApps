# -*- coding: utf-8 -*-
"""术语候选抽取与人工入表（SPEC-TERM-SUGGEST）。

纯统计＋规则，零 LLM、零第三方依赖：

* 语料遮罩复用 ``style._source_view``（TeX 走 ``prose_of``，Markdown 走
  ``mdscan``），代码块/注释/数学/表格先被抹成等长空白；
* 归一化与在册判断复用 ``terms``（``key_of`` / ``normalize_surface`` /
  ``Glossary``），不另写一套匹配键；
* 候选只做统计排序，交人用 ``terms add --pick`` 点名入表；本模块**不自动
  写词表**、不合并同义词。
"""
from __future__ import annotations

import bisect
import re
from collections import Counter
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from .config import ConfigError, load_config, load_sections
from .style import _source_view
from .terms import (load_glossary, key_of, normalize_surface,
                    parse_glossary)

# --------------------------------------------------------------------------
# 语料收集
# --------------------------------------------------------------------------

_SOURCE_SUFFIXES = {
    ".tex": "tex",
    ".md": "markdown",
    ".markdown": "markdown",
    ".txt": "text",
    ".text": "text",
}
# 生成物与结构化产物（表格、图、审计输出）不是论文正文语料。
_SKIP_DIRS = {
    "audit", "figures", "results", "tables", "build", "dist",
    "node_modules", "__pycache__", ".venv", ".git",
}


def _format_of(name: str) -> str:
    return _SOURCE_SUFFIXES.get(Path(name).suffix.lower(), "text")


def _walk_sources(root: Path) -> list[tuple[str, str]]:
    """递归收语料文件；路径排序，结果与文件系统枚举顺序无关。"""
    out: list[tuple[str, str]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() not in _SOURCE_SUFFIXES:
            continue
        rel = path.relative_to(root)
        if any(part.startswith(".") or part in _SKIP_DIRS
               for part in rel.parts[:-1]):
            continue
        out.append((rel.as_posix(),
                    path.read_text(encoding="utf-8", errors="replace")))
    return out


def _project_sources(root: Path) -> list[tuple[str, str]] | None:
    """有项目声明时按 ``sections`` 闭包取正文；坏配置退回递归扫描。"""
    try:
        cfg = load_config(root)
        sections = load_sections(cfg)
    except ConfigError:
        return None
    if not sections:
        return None
    return [(str(name), str(text)) for name, text in sections]


def collect_sources(root: Path) -> list[tuple[str, str]]:
    root = Path(root)
    if not root.is_dir():
        raise ConfigError("terms suggest 的目录不存在：%s" % root)
    return _project_sources(root) or _walk_sources(root)


# --------------------------------------------------------------------------
# 中文切分
# --------------------------------------------------------------------------

_CJK_RUN_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+")

# 先按多字虚词/套话切；长词在前，避免短词先把长词拆碎。
_ZH_MULTI_STOP = sorted({
    "以及", "并且", "但是", "而且", "因为", "所以", "如果", "虽然", "因此",
    "从而", "对于", "关于", "通过", "进行", "可以", "能够", "需要", "必须",
    "应该", "我们", "你们", "他们", "她们", "它们", "自己", "大家", "这个",
    "那个", "这些", "那些", "这类", "那类", "这种", "那种", "一个", "一种",
    "一些", "一样", "一直", "一起", "一般", "一旦", "每个", "各个", "各种",
    "什么", "怎么", "为什么", "这样", "那样", "同样", "其实", "只是", "不是",
    "而是", "还有", "比如", "例如", "已经", "仍然", "可能", "也许", "大概",
    "几乎", "完全", "非常", "比较", "相当", "十分", "更加", "最好", "最后",
    "首先", "其次", "此外", "另外", "其中", "所有", "任何", "有些", "有的",
    "有时", "有人", "没有", "无法", "不能", "不会", "不再", "就是", "还是",
    "或者", "然后", "然而", "当然", "之前", "之后", "之间", "现在", "以前",
    "用于", "来自", "作为", "成为", "具有", "存在", "包括", "属于", "位于",
    # 定义句式本身不是候选，也要当断点；否则「称为 / 记为」会被「为」拆碎。
    "称为", "记为", "定义为", "是指", "指的是", "即为", "也就是",
}, key=len, reverse=True)
_ZH_MULTI_RE = re.compile("|".join(re.escape(word) for word in _ZH_MULTI_STOP))

_ZH_SINGLE_STOP = set(
    "的了着过和与及或而但则就都也还又再很更最把被让使是在对向从由并即若因"
    "这那哪吗呢吧啊呀哦嗯之其所以为于什怎")
# 保留位置切的片段正则：不消费，只找出非虚词/非空白段。
_ZH_TOKEN_RE = re.compile(
    "[^" + re.escape("".join(sorted(_ZH_SINGLE_STOP))) + r"\s]+")


def _chinese_segments(run: str):
    """按多字/单字虚词切分，产出 ``(2–8 字片段, 片段终点)``。

    多字虚词按原长抹成空白（不再缩短字符串），这样片段的终点下标仍能
    对应原文，供定义句式「紧跟 是/指/称为/记为」判断使用。
    """
    masked = _ZH_MULTI_RE.sub(lambda m: " " * len(m.group(0)), run)
    for match in _ZH_TOKEN_RE.finditer(masked):
        segment = run[match.start():match.end()]
        if 2 <= len(segment) <= 8:
            yield segment, match.end()


# --------------------------------------------------------------------------
# 英文切分
# --------------------------------------------------------------------------

_EN_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9'’\-]*")

# 功能词与常见动词都当断点；不做词性标注，靠这张表近似「实词串＝名词短语」。
_EN_STOP = frozenset("""
a an the this that these those each every some any no all both either neither
another other such what which whose its their his her our your my
i we you he she it they them us me him one ones someone something anything
everything nothing everyone anyone nobody
of in on at to for from by with without about into onto over under between
among through during before after above below across per via as than like
unlike within upon toward towards against around behind beyond
and or but nor so yet because although though while whereas if unless since
whether not
is are was were be been being am do does did done doing have has had having
can could will would shall should may might must need needs ought
use uses used using show shows showed shown showing see sees saw seen make
makes made making take takes took taken get gets got give gives gave given go
goes went come comes came keep keeps kept put puts run runs ran running set
sets setting call calls called consider considers considered require requires
required allow allows allowed ensure ensures ensured provide provides provided
include includes included increase increases increased decrease decreases
decreased reduce reduces reduced add adds added remain remains remained become
becomes became appear appears appeared seem seems seemed want wants wanted try
tries tried work works worked working report reports reported measure measures
measured test tests tested testing evaluate evaluates evaluated compare
compares compared choose chooses chose chosen treat treats treated label
labels labeled emit emits emitted leak leaks leaked mask masks masked drop
drops dropped deliver delivers delivered compile compiles compiled assemble
assembles assembled load loads loaded cache caches cached prune prunes pruned
truncate truncates truncated
refer refers referred referring denote denotes denoted denoting
describe describes described describing define defines defined defining
record records recorded recording request requests requested requesting
body bodies fail fails failed failing pass passes passed passing
version versions
same different new old first second third last next previous following
above below main full whole large small high low good bad simple complex
single multiple many few more less most least only also very really
actually exactly roughly even still well often usually typically generally
specifically particularly especially approximately nearly almost
one two three four five six seven eight nine ten long short
""".split())


def _english_phrases(line: str):
    """逐行产 ``(1–4 词实词短语, 短语终点下标)``；标点/换行即断句。"""
    run: list[tuple[str, int, int]] = []

    def flush():
        nonlocal run
        if not run:
            return
        for i in range(0, len(run), 4):
            chunk = run[i:i + 4]
            if len(chunk) >= 2:
                yield " ".join(item[0] for item in chunk), chunk[-1][2]
            elif "-" in chunk[0][0] or chunk[0][0][0].isupper():
                yield chunk[0][0], chunk[0][2]
        run = []

    prev_end = None
    for match in _EN_TOKEN_RE.finditer(line):
        if prev_end is not None and line[prev_end:match.start()].strip(" \t"):
            yield from flush()
        word = match.group(0)
        if word.lower() in _EN_STOP:
            yield from flush()
        else:
            run.append((word, match.start(), match.end()))
        prev_end = match.end()
    yield from flush()


# --------------------------------------------------------------------------
# 泛词表（内置；命中即丢，但只按整条候选精确匹配——嵌在更长候选里的
# 泛词不受影响，例如「系统提示」「system prompt」）
# --------------------------------------------------------------------------

_ZH_GENERIC = frozenset("""
模型 任务 方法 结果 数据 问题 系统 实验 正文 小节 表格 文章 工作 研究
过程 情况 影响 原因 结论 假设 机制 测试 输出 输入 内容 形式 部分 方面
时间 关系 标准 指标 参数 变量 因素 元素 成分 材料 资源 环境 场景 案例
例子 情形 状态 反馈 信息 知识 经验 观点 看法 想法 建议 意见 要求 需求
项目 产品 服务 用户 读者 作者 人员 团队 组织 机构 部门 领域 学科 专业
行业 市场 社会 国家 地区 城市 世界 历史 未来 当前 目前 现在 过去 期间
时期 年代 月份 日期 数字 数值 大小 高低 长短 多少 主要 重要 关键 核心
基本 一般 具体 实际 真实 有效 明显 显著 必然 直接 间接 相对 绝对 上限
下限 系数 效应 曲线 失败 区别 差别 改动 东西 官方 便宜 修好 一行 一条
记录下来 重复 运行 工具 记录 不一致 函数 实例
""".split())

_EN_GENERIC = frozenset("""
model method result table figure section paper system work study approach
example value case data datum set number task experiment analysis process
problem question answer finding claim evidence information detail part
aspect type kind form way time point level degree range amount effect
impact cause reason conclusion assumption mechanism feature property
structure function behavior performance quality quantity size length rate
score stage step phase goal purpose meaning importance role state status
context setting environment resource material content output input test
baseline metric measure measurement improvement difference change increase
decrease comparison evaluation candidate instance version source target
user author reader person group team organization project product service
field area domain industry request response body policy
analyses studies properties bodies policies
""".split())

# 复数形自动补齐（不规则复数已在上表显式列出）。
_EN_GENERIC_KEYS = {key_of(word) for word in _EN_GENERIC}
_EN_GENERIC_KEYS |= {key_of(word + "s") for word in _EN_GENERIC}
_ZH_GENERIC_KEYS = {normalize_surface(word) for word in _ZH_GENERIC}

# 中文专业后缀：带这些结尾的候选排序 +2（只影响排序，不影响入选）。
_ZH_PRO_SUFFIX = ("率", "度", "曲线", "假设", "效应", "系数", "机制",
                  "约束", "预算", "协议", "口径")


def _is_generic(lang: str, surface: str) -> bool:
    if lang == "zh":
        return normalize_surface(surface) in _ZH_GENERIC_KEYS
    return key_of(surface) in _EN_GENERIC_KEYS


# --------------------------------------------------------------------------
# 噪音遮罩：LaTeX 命令参数与模型名
# --------------------------------------------------------------------------

_LATEX_ARG_RE = re.compile(
    r"\\(?:ref|eqref|cite|citep|citet|label|fact|input)\*?"
    r"(?:\[[^\]]*\])?\{[^}]*\}")

_MODEL_NAME_RE = re.compile(
    r"(?i)(?<![A-Za-z0-9])(?:"
    r"deepseek|minimax|gpt|chatgpt|claude|gemini|llama|qwen|glm|mistral|"
    r"opus|sonnet|haiku|flash|pro"
    r")"
    r"(?:[\s._-]*[a-z]?\d+(?:\.\d+)*[a-z]*)?"
    r"(?:[\s._-]*(?:flash|pro|mini|max|turbo|preview|chat|lite|plus|"
    r"ultra|thinking|instruct))?"
    r"(?:[\s._-]*v?[a-z]?\d+(?:\.\d+)*[a-z]*)?"
    r"(?![A-Za-z0-9])")

_VERSION_RE = re.compile(
    r"(?i)(?<![A-Za-z0-9])[a-z]\d+(?:\.\d+)+(?![A-Za-z0-9])")


def _blank_matches(text: str, pattern: re.Pattern) -> str:
    """把匹配段抹成等长空白（保留换行，行列号不漂）。"""
    chars = list(text)
    for match in pattern.finditer(text):
        for i in range(match.start(), match.end()):
            if chars[i] != "\n":
                chars[i] = " "
    return "".join(chars)


def _mask_noise(text: str) -> str:
    text = _blank_matches(text, _LATEX_ARG_RE)
    text = _blank_matches(text, _MODEL_NAME_RE)
    return _blank_matches(text, _VERSION_RE)


# --------------------------------------------------------------------------
# 统计
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Candidate:
    surface: str
    lang: str
    count: int
    sections: int
    first_location: str
    score: int

    def as_dict(self) -> dict:
        return {
            "surface": self.surface,
            "lang": self.lang,
            "count": self.count,
            "sections": self.sections,
            "first_location": self.first_location,
            "score": self.score,
        }


class _Bucket:
    __slots__ = ("lang", "count", "sections", "first_location", "surfaces",
                 "in_heading", "definition", "zh_suffix", "en_form")

    def __init__(self, lang: str):
        self.lang = lang
        self.count = 0
        self.sections: set[str] = set()
        self.first_location = ""
        self.surfaces: Counter = Counter()
        self.in_heading = False
        self.definition = False
        self.zh_suffix = False
        self.en_form = False

    def add(self, surface: str, section: str, location: str) -> None:
        self.count += 1
        self.sections.add(section)
        if not self.first_location:
            self.first_location = location
        normalized = normalize_surface(surface)
        self.surfaces[normalized] += 1
        if self.lang == "zh":
            if normalized.endswith(_ZH_PRO_SUFFIX):
                self.zh_suffix = True
        elif "-" in surface or (surface and surface[0].isupper()):
            self.en_form = True

    def display_surface(self) -> str:
        # 出现次数最多的写法；同数取字典序最小，保证确定性。
        return sorted(self.surfaces.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]


def _section_index(heading_lines: list[int], line: int) -> int:
    return bisect.bisect_right(heading_lines, line)


_ZH_DEF_MARKERS = ("是", "指", "称为", "记为", "是指", "指的是", "定义为",
                   "即为", "也就是")
_EN_DEF_RE = re.compile(r"(?:is|are|refers?\s+to|denotes?)\b", re.I)


def _collect_heading_keys(headings, zh_keys: set, en_keys: set) -> None:
    """标题里出现过的术语（按候选键）记下来，供标题 +3 排序加分。"""
    for heading in headings:
        title = str(heading.get("title") or "")
        for match in _CJK_RUN_RE.finditer(title):
            for segment, _end in _chinese_segments(match.group(0)):
                zh_keys.add(segment)
        for phrase, _end in _english_phrases(title):
            en_keys.add(key_of(phrase))


def _scan_document(rel: str, text: str, buckets: dict,
                   heading_zh: set, heading_en: set) -> None:
    fmt = _format_of(rel)
    prose, headings, _raw, _list_prose, _list_spans = _source_view(text, fmt)
    prose = _mask_noise(prose)
    heading_lines = sorted({int(h["line"]) for h in headings
                            if isinstance(h.get("line"), int)})
    _collect_heading_keys(headings, heading_zh, heading_en)

    def section_of(line: int) -> str:
        return "%s#%d" % (rel, _section_index(heading_lines, line))

    for line_no, line in enumerate(prose.split("\n"), 1):
        for match in _CJK_RUN_RE.finditer(line):
            run = match.group(0)
            for segment, end in _chinese_segments(run):
                bucket = buckets.setdefault(
                    ("zh", segment), _Bucket("zh"))
                bucket.add(segment, section_of(line_no),
                           "%s:%d" % (rel, line_no))
                if run[end:].lstrip().startswith(_ZH_DEF_MARKERS):
                    bucket.definition = True
        for phrase, end in _english_phrases(line):
            bucket = buckets.setdefault(
                ("en", key_of(phrase)), _Bucket("en"))
            bucket.add(phrase, section_of(line_no),
                       "%s:%d" % (rel, line_no))
            if _EN_DEF_RE.match(line[end:].lstrip()):
                bucket.definition = True


def suggest(root, min_count: int = 4, min_sections: int = 3,
            glossary_path=None) -> list[Candidate]:
    """挖候选：返回按 (score 降序, surface 升序) 排好的列表。"""
    if min_count < 1:
        raise ConfigError("--min-count 必须 ≥ 1")
    if min_sections < 1:
        raise ConfigError("--min-sections 必须 ≥ 1")
    glossary = load_glossary(glossary_path) if glossary_path else load_glossary()
    buckets: dict = {}
    heading_zh: set = set()
    heading_en: set = set()
    for rel, text in collect_sources(Path(root)):
        _scan_document(rel, text, buckets, heading_zh, heading_en)

    rows: list[Candidate] = []
    for (lang, key), bucket in buckets.items():
        if bucket.count < min_count:
            continue
        if len(bucket.sections) < min_sections:
            continue
        surface = bucket.display_surface()
        if glossary.canonical_of(surface) is not None:
            continue
        if _is_generic(lang, surface):
            continue
        if lang == "zh":
            bucket.in_heading = key in heading_zh
        else:
            bucket.in_heading = key in heading_en
        score = bucket.count * len(bucket.sections)
        if bucket.in_heading:
            score += 3
        if bucket.definition:
            score += 2
        if bucket.zh_suffix:
            score += 2
        if bucket.en_form:
            score += 1
        rows.append(Candidate(
            surface=surface,
            lang=lang,
            count=bucket.count,
            sections=len(bucket.sections),
            first_location=bucket.first_location,
            score=score,
        ))
    rows.sort(key=lambda row: (-row.score, row.surface))
    return rows


def render_tsv(rows) -> str:
    lines = ["surface\tlang\tcount\tsections\tfirst_location\tscore"]
    for row in rows:
        lines.append("%s\t%s\t%d\t%d\t%s\t%d" % (
            row.surface, row.lang, row.count, row.sections,
            row.first_location, row.score))
    return "\n".join(lines) + "\n"


def json_payload(rows, root, min_count: int, min_sections: int) -> dict:
    return {
        "tool": "terms",
        "action": "suggest",
        "root": str(Path(root)),
        "min_count": min_count,
        "min_sections": min_sections,
        "candidates": [row.as_dict() for row in rows],
        "count": len(rows),
    }


# --------------------------------------------------------------------------
# 入表（只写人工 pick）
# --------------------------------------------------------------------------

_CANDIDATE_COLUMNS = ("surface", "lang", "count", "sections",
                      "first_location", "score")


def _read_candidates(path: Path) -> list[dict]:
    if not path.is_file():
        raise ConfigError("候选文件不存在：%s" % path)
    lines = [line for line in path.read_text(encoding="utf-8").splitlines()
             if line.strip() and not line.lstrip().startswith("#")]
    if not lines:
        raise ConfigError("候选文件为空：%s" % path)
    header = [cell.strip() for cell in lines[0].split("\t")]
    if tuple(header[:6]) != _CANDIDATE_COLUMNS:
        raise ConfigError(
            "候选文件首行必须是 %s，现在是 %r"
            % ("\t".join(_CANDIDATE_COLUMNS), lines[0]))
    rows = []
    for raw in lines[1:]:
        cols = raw.split("\t")
        if len(cols) < 6:
            raise ConfigError("候选行缺列：%r" % raw)
        rows.append(dict(zip(_CANDIDATE_COLUMNS, cols[:6])))
    return rows


def add_from_tsv(from_path, picks, glossary_path=None,
                 today: str | None = None) -> dict:
    """把人工 ``picks`` 里点名的表面形式追加进词表；不合并同义词。"""
    source = Path(from_path)
    rows = _read_candidates(source)
    targets = Path(glossary_path) if glossary_path else None
    if targets is None:
        from .terms import DEFAULT_PAPER_PATH
        targets = DEFAULT_PAPER_PATH
    if not targets.is_file():
        raise ConfigError("词表不存在：%s" % targets)

    wanted: dict[str, str] = {}
    for raw in picks:
        for piece in str(raw).split(","):
            piece = piece.strip()
            if piece:
                wanted.setdefault(key_of(piece), piece)
    if not wanted:
        raise ConfigError("terms add 需要至少一个 --pick 表面形式")

    existing = load_glossary(targets)
    added: list[str] = []
    skipped: list[dict] = []
    matched: set[str] = set()
    for row in rows:
        key = key_of(row["surface"])
        if key not in wanted:
            continue
        matched.add(key)
        surface = row["surface"].strip()
        if not surface:
            continue
        if existing.canonical_of(surface) is not None:
            skipped.append({"surface": surface, "reason": "已在该词表"})
            continue
        added.append(surface)

    missing = [wanted[key] for key in wanted if key not in matched]
    if missing:
        raise ConfigError(
            "--pick 不在候选文件里：%s" % "、".join(repr(x) for x in missing))

    if added:
        text = targets.read_text(encoding="utf-8")
        if text and not text.endswith("\n"):
            text += "\n"
        stamp = today or date.today().isoformat()
        comment = "# terms add %s：来源 %s" % (stamp, source)
        body = [comment]
        body += ["%s\t\t\t待分类" % surface for surface in added]
        targets.write_text(text + "\n".join(body) + "\n", encoding="utf-8")
        # 写完立刻重解析：词表坏了必须当场报错，不能留给 style 才发现。
        parsed = parse_glossary(targets.read_text(encoding="utf-8"))
        for surface in added:
            if parsed.canonical_of(surface) is None:
                raise ConfigError("写入后词表无法解析新术语：%s" % surface)

    return {
        "glossary": str(targets),
        "source": str(source),
        "added": added,
        "skipped": skipped,
        "comment": ("# terms add %s：来源 %s"
                    % (today or date.today().isoformat(), source))
        if added else "",
    }
