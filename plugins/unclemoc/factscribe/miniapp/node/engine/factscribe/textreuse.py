# -*- coding: utf-8 -*-
"""双目录字面重合检测（`factscribe textreuse`）。

查重的第一步是**字面层**：两段文字是不是逐字一样（只差空白、LaTeX 注释、
LaTeX 命令这类排版噪声），或者是不是**近字面**——同一句话被插了几个词、
换了个说法但用词基本一致。这一层是纯机械的，词级 n-gram 镶嵌＋句级词集
包含就能判，不需要模型，也不需要网络。本模块只做这一层。

**能力边界（硬声明，写进人读输出与 JSON）**：本卡查的是**字面层**——逐字照搬，
以及**近字面的机械重合**（多尺度词窗 ＋ 句级词集包含）；**语义改写／换词改写／
洗稿／AI 拼装属语义层，本卡不覆盖**——漏检属语义层，本卡不覆盖。字面层绿了
不等于没有抄，只等于「没有逐字照搬，也没有近字面的机械重合」。语义/改写层是
身份外延，另裁（P-139/P-143）。

**两层检测（互相独立，可各自关）**：

* **词窗层（word-window）**：词级 n-gram 镶嵌。默认**多尺度**同时跑 `n∈{8,5}`
  （`--n` 保留单窗模式；`--scales` 可自定义尺度集）。固定单尺度会被词级扰动
  打断，多尺度能把断掉的长段重新接上；跨尺度的重合段按**并集区间**合并。
* **句级包含层（sentence-containment）**：两文档分句后，逐句算词集重合率
  （`|交集| ÷ 较短短句词集`，阈值默认 0.7，`--sentence-threshold` 可配）。
  达到阈值即报重合段，两侧定位到句。**性能护栏**：先用最小尺度的词窗粗筛
  候选句对（有连续词窗重合的句子对才进入全句比对），不做 O(n²) 全量比对。

**匹配来源可归因**：每段带 `match_source`（`word-window`／`sentence-containment`），
人读报告与 `--json` 都给出来，便于事后归因「这处是窗命中的还是句命中的」。

机械口径：

* 收文件：递归 `.tex`/`.md`/`.txt`（`--ext` 可扩），零配置——**裸目录也能跑**
  （不读 `factscribe.toml`，不需要任何项目声明）。
* 归一：空白折叠（跨行也算同一个分隔）；LaTeX 注释行默认去（`--no-strip-comments`
  可留）；LaTeX 命令与其花括号实参默认去（排版骨架不算重合）；大小写折叠。
* 分词：拉丁/数字按词切；CJK 汉字按字切（中文没有空格，按字切才分得出
  词级 n-gram 的步进）。
* 分句：句末标点（`.!?。！？`）切分；跨行不断句（硬换行不算句末）；空行断句；
  缩写（Mr./e.g. 等）、小数（3.5）、首字母缩写（J. / U.S.）不切。
* 镶嵌：词级 n-gram（默认多尺度 n∈{8,5}），相邻命中聚成段。
* 报告：逐段两侧 `文件:行-行`＋重合词数＋匹配来源；汇总各文件对的重合词数与
  A 侧占比。

退出码照 factscribe 家规：**0**＝无超阈重合、**1**＝发现重合（逐段列）、
**2**＝用法错（目录不存在、n 越界、两侧同一目录等）。

本模块只读，不改任何既有模块的行为；错误码按不透明数据键处理
（`TR_` 前缀），不进错误码词册。
"""
from __future__ import annotations

import bisect
import re
from dataclasses import dataclass
from dataclasses import field as dc_field
from pathlib import Path

from .config import ConfigError
from .textio import read_text_exact, to_lf

# --------------------------------------------------------------------------
# 常量（口径与预注册阈值）
# --------------------------------------------------------------------------
# 默认收的文件类型（`--ext` 是**扩**，不是替换）。
DEFAULT_EXTS = (".tex", ".md", ".txt")
# n-gram 长度范围（工单 G6：可调 5–20）。
N_MIN = 5
N_MAX = 20
DEFAULT_N = 8
# 默认词窗尺度集：多尺度同时跑（固定单尺度会被词级扰动打断）。
DEFAULT_SCALES = (8, 5)
# 小段过滤阈值：重合词数少于它的小段不报（工单 G6：缺省 8）。
DEFAULT_MIN_TOKENS = 8
# 句级包含层的阈值（词集重合率下限）。
DEFAULT_SENTENCE_THRESHOLD = 0.7
# 句级包含层的最少共享词数（防「短句整句撞车」型误报）。
# 口径由 dev 集定标：PAN random 档 20 例与 172 例非评测 none 档样本上，
# 共享词数 ≤15 的命中全部是偶合短语（两本 1910 年代小说里的套话），
# 门槛取 16 后误配大幅下降而覆盖读数不变（见 REPORT-PAN-V2.md）。
DEFAULT_SENTENCE_MIN_WORDS = 16
# 句级粗筛用的锚点尺度（候选句对上限，性能护栏）。
DEFAULT_SENTENCE_ANCHOR_N = 5
SENTENCE_PAIR_CAP = 20000

# 码（不透明数据键；不进错误码词册）。
CODE_OVERLAP = "TR_OVERLAP"
CODE_SELF_COMPARE = "TR_SELF_COMPARE"
CODE_DIR_MISSING = "TR_DIR_MISSING"
CODE_DIR_INVALID = "TR_DIR_INVALID"
CODE_N_RANGE = "TR_N_RANGE"
CODE_MIN_TOKENS_RANGE = "TR_MIN_TOKENS_RANGE"
CODE_NO_FILES = "TR_NO_FILES"
CODE_SENTENCE_THRESHOLD_RANGE = "TR_SENTENCE_THRESHOLD_RANGE"
CODE_SENTENCE_MIN_WORDS_RANGE = "TR_SENTENCE_MIN_WORDS_RANGE"

# 匹配来源标注（报告与 JSON 里逐字出现，便于归因）。
SRC_WORD_WINDOW = "word-window"
SRC_SENTENCE = "sentence-containment"

# 能力边界声明——人读输出与 JSON 里逐字出现这一句，不许改写口径。
BOUNDARY = ("本卡只查字面层：逐字照搬与近字面的机械重合（多尺度词窗＋句级包含）"
            "才算重合；改写／洗稿／AI 拼装属语义层，本卡不覆盖——"
            "漏检属语义层，本卡不覆盖。")

# CJK 逐字切，其余按词切（`[^\W_]+`＝Unicode 字母数字连读）。
_CJK = "぀-ヿ㐀-䶿一-鿿豈-﫿가-힯"
_TOKEN_RE = re.compile(r"[%s]|[^\W_]+" % _CJK)
# 一个「单元」＝一个词 或 一串句末标点（标点后允许跟收尾引号/括号）。
_UNIT_RE = re.compile(r"[%s]|[^\W_]+|[.!?。！？]+[\"'’”\)\]」』]*" % _CJK)
_SENT_END_CHARS = ".!?。！？"
# LaTeX 命令（含可选的方括号参与花括号实参）——排版骨架不算文字重合。
_LATEX_CMD_RE = re.compile(r"\\[a-zA-Z@]+\s*\*?(?:\[[^\]]*\])?(?:\{[^{}]*\})*")
# 注释行首的百分号（未转义的）。
_PERCENT_RE = re.compile(r"(?<!\\)%.*$")
# 句末缩写：不切句（否则 Mr. Smith / e.g. this 会把句子切碎）。
_ABBREV = {"mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "fig",
           "figs", "no", "nos", "vol", "pp", "ed", "eds", "al", "ca", "cf",
           "approx", "viz", "ibid", "idem", "e.g", "i.e"}


# --------------------------------------------------------------------------
# 归一与分词
# --------------------------------------------------------------------------
def _strip_latex_comments(text: str) -> str:
    """去 LaTeX 注释（`%` 到行尾；`\\%` 保留）。行数不变，行号可对齐。"""
    out = []
    for line in text.splitlines():
        out.append(_PERCENT_RE.sub("", line))
    return "\n".join(out)


def _strip_latex_commands(text: str) -> str:
    """去 LaTeX 命令与其花括号实参（`\\cite{key}`、`\\section{标题}` 之类）。"""
    return _LATEX_CMD_RE.sub(" ", text)


def _strip_latex_commands_keep_lines(text: str) -> str:
    """同上，但**保留换行**（换行位置不动 → 行号仍与原文对齐）。"""
    return _LATEX_CMD_RE.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), text)


def _normalize(text: str, strip_comments: bool = True) -> str:
    """归一：去注释（可选）→ 去 LaTeX 命令（保留换行）。"""
    if strip_comments:
        text = _strip_latex_comments(text)
    return _strip_latex_commands_keep_lines(text)


def _tokenize_full(text: str, strip_comments: bool = True):
    """文本 → `(tokens, lines, sent_ids)`。

    归一顺序：去 LaTeX 注释（默认开）→ 去 LaTeX 命令（保留换行）→ 空白折叠
    （跨行也算同一分隔）→ 大小写折叠 → 分词（拉丁/数字按词，CJK 按字）
    → 分句（句末标点切；跨行不断；空行断；缩写/小数不切）。
    """
    norm = _normalize(text, strip_comments=strip_comments)
    tokens: list = []
    lines: list = []
    sent_ids: list = []
    sent = 0
    for lineno, line in enumerate(norm.split("\n"), 1):
        if not line.strip():
            # 空行＝段落边界：断句（避免无标点的段落粘成巨句）。
            if tokens and sent_ids[-1] == sent:
                sent += 1
            continue
        for m in _UNIT_RE.finditer(line):
            s = m.group(0)
            if s[0] in _SENT_END_CHARS:
                prev = tokens[-1] if tokens else ""
                nxt = line[m.end():m.end() + 1]
                if s == "." and prev.isdigit() and nxt.isdigit():
                    continue          # 小数（3.5）
                if s == "." and (prev.lower() in _ABBREV
                                 or (len(prev) == 1 and prev.isalpha())):
                    continue          # 缩写（Mr. / J. / U.S.）
                if nxt and nxt.isalnum():
                    continue          # 标点后紧跟字母数字：不作句末
                sent += 1
                continue
            tokens.append(s.casefold())
            lines.append(lineno)
            sent_ids.append(sent)
    return tokens, lines, sent_ids


def tokenize(text: str, strip_comments: bool = True) -> list:
    """文本 → `[(词, 行号), ...]`（只分词，不分句）。"""
    tokens, lines, _ = _tokenize_full(text, strip_comments=strip_comments)
    return list(zip(tokens, lines))


def tokenize_sentences(text: str, strip_comments: bool = True) -> list:
    """文本 → `[(词, 行号, 句号), ...]`。"""
    tokens, lines, sent_ids = _tokenize_full(text, strip_comments=strip_comments)
    return list(zip(tokens, lines, sent_ids))


def sentences(text: str, strip_comments: bool = True) -> list:
    """文本 → `[[词, ...], ...]`（逐句的词表）。

    分句口径：句末标点（`.!?。！？`）切；跨硬换行**不断句**；空行断句；
    缩写（Mr./e.g. 等）、小数（3.5）、首字母缩写（J. / U.S.）不切。
    """
    tokens, _, sent_ids = _tokenize_full(text, strip_comments=strip_comments)
    out = []
    cur = []
    last = None
    for tok, sent in zip(tokens, sent_ids):
        if last is not None and sent != last:
            out.append(cur)
            cur = []
        cur.append(tok)
        last = sent
    if cur:
        out.append(cur)
    return out


def parse_exts(values) -> tuple:
    """`--ext` 列表 → 扩展名元组（补点、小写、允许逗号分隔、去重、保持顺序）。"""
    exts = []
    for value in values or ():
        for part in str(value).split(","):
            part = part.strip().lower()
            if not part:
                continue
            if not part.startswith("."):
                part = "." + part
            if part not in exts:
                exts.append(part)
    return tuple(exts)


def parse_scales(values) -> tuple:
    """`--scales` 字符串/列表 → 尺度元组（去重、降序、保持确定性）。"""
    if values is None:
        return DEFAULT_SCALES
    if isinstance(values, str):
        values = [values]
    out = []
    for value in values:
        for part in str(value).split(","):
            part = part.strip()
            if not part:
                continue
            try:
                num = int(part)
            except ValueError:
                raise ConfigError("尺度必须是整数（给了 %s）" % part,
                                  code=CODE_N_RANGE)
            if num not in out:
                out.append(num)
    if not out:
        raise ConfigError("尺度集不能为空", code=CODE_N_RANGE)
    return tuple(sorted(out, reverse=True))


def collect_files(root: Path, exts: tuple) -> list:
    """递归收文件（扩展名在清单内），按相对路径排序（结果可复现）。"""
    files = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() not in exts:
            continue
        files.append(path)
    return files


# --------------------------------------------------------------------------
# 结果模型
# --------------------------------------------------------------------------
@dataclass
class Doc:
    """一侧的一个文件：词流＋逐词行号＋（可选）逐词句号。"""
    rel: str                      # 相对该侧根目录的路径（报告用）
    tokens: list = dc_field(default_factory=list)   # 词形
    lines: list = dc_field(default_factory=list)    # 逐词行号
    total: int = 0                # 总词数
    sent_ids: list = dc_field(default_factory=list)  # 逐词句号
    sent_spans: list = dc_field(default_factory=list)  # [(起词, 止词), ...]
    _sent_sets: list = dc_field(default_factory=list)  # 逐句词集（懒填）

    def line_of(self, index: int) -> int:
        if not self.lines:
            return 0
        index = max(0, min(index, len(self.lines) - 1))
        return self.lines[index]

    def sent_set(self, index: int) -> set:
        """第 index 句的词集（懒填，缓存在文档上）。"""
        if not self._sent_sets:
            sets = [set() for _ in self.sent_spans]
            for tok_idx, sent in enumerate(self.sent_ids):
                if 0 <= sent < len(sets):
                    sets[sent].add(self.tokens[tok_idx])
            self._sent_sets = sets
        if 0 <= index < len(self._sent_sets):
            return self._sent_sets[index]
        return set()


@dataclass
class Segment:
    """一段跨侧重合（两侧都是一段连续的行区间）。"""
    a_file: str
    a_line_start: int
    a_line_end: int
    b_file: str
    b_line_start: int
    b_line_end: int
    overlap_tokens: int           # 重合词数（两侧共有的那段文字有多长）
    a_span_tokens: int            # A 侧该段覆盖的词数
    b_span_tokens: int            # B 侧该段覆盖的词数
    a_token_start: int = 0        # A 侧词流起点（算并集用）
    a_token_end: int = 0
    b_token_start: int = 0
    b_token_end: int = 0
    match_source: str = SRC_WORD_WINDOW   # 匹配来源：word-window／sentence-containment
    scale: int = 0                # 词窗尺度（句级段为 0）
    sentence_ratio: float = 0.0   # 句级包含率（词窗段为 0.0）

    @property
    def code(self) -> str:
        return CODE_OVERLAP

    @property
    def source_label(self) -> str:
        """人读标签：来源＋尺度（或包含率）。"""
        if self.match_source == SRC_SENTENCE:
            return "%s 含 %.0f%%" % (self.match_source, self.sentence_ratio * 100)
        return "%s n=%d" % (self.match_source, self.scale)

    def as_dict(self) -> dict:
        return {
            "code": self.code,
            "a_file": self.a_file,
            "a_line_start": self.a_line_start,
            "a_line_end": self.a_line_end,
            "a_span_tokens": self.a_span_tokens,
            "b_file": self.b_file,
            "b_line_start": self.b_line_start,
            "b_line_end": self.b_line_end,
            "b_span_tokens": self.b_span_tokens,
            "overlap_tokens": self.overlap_tokens,
            "match_source": self.match_source,
            "scale": self.scale,
            "sentence_ratio": round(self.sentence_ratio, 6),
        }


@dataclass
class Pair:
    """一个文件对的重合汇总。

    `overlap_tokens`＝**A 侧被复制的词数**（A 侧被覆盖区间的并集长度）：
    同一段 A 文字在 B 侧出现三次也只按一份算，所以 A 侧占比恒 ≤ 100%。
    `shared_tokens` 是各段重合词数之和（同一段在 B 侧多次出现会重复计）。
    """
    a_file: str
    b_file: str
    overlap_tokens: int
    a_total_tokens: int
    b_total_tokens: int
    segments: int
    b_overlap_tokens: int = 0
    shared_tokens: int = 0
    segments_by_source: dict = dc_field(default_factory=dict)

    @property
    def a_ratio(self) -> float:
        """A 侧占比＝重合词数 ÷ A 侧该文件总词数。"""
        if not self.a_total_tokens:
            return 0.0
        return self.overlap_tokens / self.a_total_tokens

    @property
    def b_ratio(self) -> float:
        """B 侧占比＝重合词数 ÷ B 侧该文件总词数。"""
        if not self.b_total_tokens:
            return 0.0
        return self.b_overlap_tokens / self.b_total_tokens

    def as_dict(self) -> dict:
        return {
            "a_file": self.a_file,
            "b_file": self.b_file,
            "overlap_tokens": self.overlap_tokens,
            "a_total_tokens": self.a_total_tokens,
            "b_total_tokens": self.b_total_tokens,
            "b_overlap_tokens": self.b_overlap_tokens,
            "shared_tokens": self.shared_tokens,
            "a_ratio": round(self.a_ratio, 6),
            "b_ratio": round(self.b_ratio, 6),
            "segments": self.segments,
            "segments_by_source": dict(self.segments_by_source),
        }


@dataclass
class TextReuseResult:
    """一次双目录字面重合扫描的结果。"""
    dir_a: Path
    dir_b: Path
    n: int = DEFAULT_N
    min_tokens: int = DEFAULT_MIN_TOKENS
    exts: tuple = DEFAULT_EXTS
    strip_comments: bool = True
    files_a: int = 0
    files_b: int = 0
    tokens_a: int = 0
    tokens_b: int = 0
    segments: list = dc_field(default_factory=list)
    pairs: list = dc_field(default_factory=list)
    boundary: str = BOUNDARY
    scales: tuple = DEFAULT_SCALES      # 实际跑的词窗尺度集
    sentences: bool = True              # 句级包含层开关
    sentence_threshold: float = DEFAULT_SENTENCE_THRESHOLD
    sentence_min_words: int = DEFAULT_SENTENCE_MIN_WORDS
    sentence_anchor_n: int = DEFAULT_SENTENCE_ANCHOR_N

    @property
    def exit_code(self) -> int:
        """0＝无超阈重合；1＝有重合段。用法错由 ConfigError 走 exit 2。"""
        return 1 if self.segments else 0

    def summary(self) -> dict:
        by_source = {}
        for seg in self.segments:
            by_source[seg.match_source] = by_source.get(seg.match_source, 0) + 1
        return {
            "n": self.n,
            "scales": list(self.scales),
            "min_tokens": self.min_tokens,
            "exts": list(self.exts),
            "strip_comments": self.strip_comments,
            "sentences": self.sentences,
            "sentence_threshold": self.sentence_threshold,
            "sentence_min_words": self.sentence_min_words,
            "sentence_anchor_n": self.sentence_anchor_n,
            "files_a": self.files_a,
            "files_b": self.files_b,
            "tokens_a": self.tokens_a,
            "tokens_b": self.tokens_b,
            "segment_count": len(self.segments),
            "segments_by_source": by_source,
            "overlap_tokens": sum(p.overlap_tokens for p in self.pairs),
            "pair_count": len(self.pairs),
        }


# --------------------------------------------------------------------------
# 扫描
# --------------------------------------------------------------------------
def _load_side(root: Path, exts: tuple, strip_comments: bool, sentences: bool):
    """读一侧：文件清单＋逐文件词流。"""
    docs = []
    for path in collect_files(root, exts):
        try:
            text = to_lf(read_text_exact(path, errors="replace"))
        except OSError:
            continue
        if sentences:
            tokens, lines, sent_ids = _tokenize_full(text, strip_comments=strip_comments)
        else:
            pairs = tokenize(text, strip_comments=strip_comments)
            tokens = [t for t, _ in pairs]
            lines = [ln for _, ln in pairs]
            sent_ids = []
        if not tokens:
            continue
        doc = Doc(
            rel=str(path.relative_to(root)),
            tokens=tokens,
            lines=lines,
            total=len(tokens),
            sent_ids=sent_ids,
        )
        if sentences:
            doc.sent_spans = _sentence_spans(sent_ids)
        docs.append(doc)
    return docs


def _sentence_spans(sent_ids: list) -> list:
    """逐词句号 → 逐句词区间 `[(起, 止), ...]`。"""
    if not sent_ids:
        return []
    spans = []
    start = 0
    cur = sent_ids[0]
    for idx in range(1, len(sent_ids)):
        if sent_ids[idx] != cur:
            spans.append((start, idx - 1))
            start = idx
            cur = sent_ids[idx]
    spans.append((start, len(sent_ids) - 1))
    return spans


def _shingles(doc: Doc, n: int) -> dict:
    """一个文件的 n-gram → 起始位置列表（升序）。"""
    index = {}
    toks = doc.tokens
    for i in range(len(toks) - n + 1):
        key = tuple(toks[i:i + n])
        index.setdefault(key, []).append(i)
    return index


def _match_runs(index_a: dict, toks_b: list, n: int) -> list:
    """贪心延伸：命中连成 run（run 内 A、B 两侧位置都连续）。

    每个 B 位置只延伸一个 run（优先延伸能接上的那个），所以命中数与文本体量
    同阶——同一个 n-gram 在文件里重复出现时不会把命中表炸成天文数字。
    位置查找用二分（候选位置表是升序的）。
    """
    runs = []
    active = []          # 上一位置命中、还可能接上的 run
    for j in range(len(toks_b) - n + 1):
        cands = index_a.get(tuple(toks_b[j:j + n]))
        if not cands:
            active = []
            continue
        extended = False
        for run in active:
            want = run["a_end"] + 1
            k = bisect.bisect_left(cands, want)
            if k < len(cands) and cands[k] == want:
                run["a_end"] = want
                run["b_end"] = j
                run["hits"] += 1
                extended = True
                break
        if not extended:
            run = {"a_start": cands[0], "a_end": cands[0],
                   "b_start": j, "b_end": j, "hits": 1}
            runs.append(run)
            active.append(run)
        active = [r for r in active if r["b_end"] == j]
    return runs


def _merge_runs(runs: list, n: int) -> list:
    """合并跨度重叠的 run（A 侧重叠或 B 侧重叠）——同一段文字重复出现时
    不该被算成两段。返回 `(a_start, a_end, b_start, b_end, shared)` 列表。"""
    spans = []
    for run in runs:
        spans.append((run["a_start"], run["a_end"] + n - 1,
                      run["b_start"], run["b_end"] + n - 1,
                      run["hits"] + n - 1))
    spans.sort(key=lambda s: (s[0], s[2]))
    merged = []
    for a_start, a_end, b_start, b_end, shared in spans:
        if merged:
            last = merged[-1]
            if a_start <= last[1] or b_start <= last[3]:
                merged[-1] = (min(last[0], a_start), max(last[1], a_end),
                              min(last[2], b_start), max(last[3], b_end),
                              max(last[4], shared))
                continue
        merged.append((a_start, a_end, b_start, b_end, shared))
    return merged


def _merge_across_scales(spans: list) -> list:
    """跨尺度合并：同源重合段取**并集区间**。

    输入 `(a_start, a_end, b_start, b_end, shared, scale)`，输出同构列表。
    合并判据与单尺度一致（A 侧重叠或 B 侧重叠即同源）；尺度取贡献该段的
    最大值（最强证据），共享词数取各尺度的最大值（同一区域不重复计数）。
    """
    ordered = sorted(spans, key=lambda s: (s[0], s[2]))
    merged = []
    for a_start, a_end, b_start, b_end, shared, scale in ordered:
        if merged:
            last = merged[-1]
            if a_start <= last[1] or b_start <= last[3]:
                merged[-1] = (min(last[0], a_start), max(last[1], a_end),
                              min(last[2], b_start), max(last[3], b_end),
                              max(last[4], shared), max(last[5], scale))
                continue
        merged.append((a_start, a_end, b_start, b_end, shared, scale))
    return merged


def _candidate_sentence_pairs(doc_a: Doc, doc_b: Doc, n: int) -> set:
    """句级粗筛：只用「有连续 n 词窗重合」的句子对做全句比对。

    这是性能护栏——不做 O(句数²) 的全量比对。返回 `(A句号, B句号)` 集合。

    A 侧向左右各放宽一句：词级扰动常在句中插入带标点的词，把一句劈成两句，
    只认锚点所在那一句会漏掉被劈开的另一半（段覆盖会缺一块）。
    """
    pairs = set()
    index_a = _shingles(doc_a, n)
    runs = _match_runs(index_a, doc_b.tokens, n)
    n_a = len(doc_a.sent_spans)
    for run in runs:
        a0, b0 = run["a_start"], run["b_start"]
        a1 = run["a_end"]
        prev = None
        for k in range(a1 - a0 + 1):
            key = (doc_a.sent_ids[a0 + k], doc_b.sent_ids[b0 + k])
            if key != prev:
                pairs.add(key)
                prev = key
                if len(pairs) > SENTENCE_PAIR_CAP:
                    return pairs
    if not pairs:
        return pairs
    widened = set()
    for a_sent, b_sent in pairs:
        for da in (-1, 0, 1):
            aa = a_sent + da
            if 0 <= aa < n_a:
                widened.add((aa, b_sent))
    return widened

def _sentence_segments(doc_a: Doc, doc_b: Doc, scales: tuple,
                       threshold: float, min_words: int,
                       min_tokens: int, anchor_n: int = None) -> list:
    """句级包含段：词集重合率 ≥ 阈值的句子对（两侧定位到句）。

    * 口径：`|交集| ÷ 较短短句词集` ≥ `threshold`；
    * 防误报：共享词数与两侧句长都不得少于 `min_words`（短句整句撞车不算）；
    * 合并：两侧句号都连续的命中合成一段（并集区间），报告按段给。
    """
    anchor = anchor_n or (min(scales) if scales else DEFAULT_N)
    cands = _candidate_sentence_pairs(doc_a, doc_b, anchor)
    matches = []
    for a_sent, b_sent in sorted(cands):
        set_a = doc_a.sent_set(a_sent)
        if len(set_a) < min_words:
            continue
        # B 侧句窗：以锚点句为起点，向前取 1–3 句、向后延 1–3 句。
        # （两侧句界常常对不齐——逐句对逐句会把一段拆碎，窗口才接得上。）
        best = None
        for shift in (-2, -1, 0):
            start = b_sent + shift
            if start < 0 or start >= len(doc_b.sent_spans):
                continue
            acc = set()
            for width in range(1, 5):
                if start + width - 1 >= len(doc_b.sent_spans):
                    break
                acc = acc | doc_b.sent_set(start + width - 1)
                if len(acc) < min_words:
                    continue
                inter = len(set_a & acc)
                if inter < min_words:
                    continue
                ratio = inter / min(len(set_a), len(acc))
                if ratio < threshold:
                    continue
                cand = (ratio, inter, start, start + width - 1)
                if best is None or cand[0] > best[0]:
                    best = cand
        if best is not None:
            matches.append((a_sent, best[2], best[3], best[1], best[0]))
    if not matches:
        return []
    groups = []
    for m in matches:
        if (groups and m[0] == groups[-1][-1][0] + 1
                and m[1] <= groups[-1][-1][2] + 1):
            groups[-1].append(m)
        else:
            groups.append([m])
    out = []
    for group in groups:
        shared = sum(x[3] for x in group)
        if shared < min_tokens:
            continue
        a_start = doc_a.sent_spans[group[0][0]][0]
        a_end = doc_a.sent_spans[group[-1][0]][1]
        b_start = doc_b.sent_spans[group[0][1]][0]
        b_end = doc_b.sent_spans[group[-1][2]][1]
        out.append(Segment(
            a_file=doc_a.rel,
            a_line_start=doc_a.line_of(a_start),
            a_line_end=doc_a.line_of(min(a_end, doc_a.total - 1)),
            b_file=doc_b.rel,
            b_line_start=doc_b.line_of(b_start),
            b_line_end=doc_b.line_of(min(b_end, doc_b.total - 1)),
            overlap_tokens=shared,
            a_span_tokens=a_end - a_start + 1,
            b_span_tokens=b_end - b_start + 1,
            a_token_start=a_start,
            a_token_end=a_end,
            b_token_start=b_start,
            b_token_end=b_end,
            match_source=SRC_SENTENCE,
            scale=0,
            sentence_ratio=min(x[4] for x in group),
        ))
    return out


def _covered_by_window(seg: Segment, window_segs: list) -> bool:
    """句级段是否已被词窗段覆盖（覆盖则不重复报——词窗证据更强）。

    判据取 **A 侧区间**：词窗段已把同一段 A 文字整段报出时，句级段是同一区域
    的二次表述，不再重复占一行（否则逐字照搬的段落会同时出一段窗段一段句段）。
    """
    for ws in window_segs:
        if (ws.a_token_start <= seg.a_token_start
                and ws.a_token_end >= seg.a_token_end):
            return True
    return False


def _segments_for_pair(doc_a: Doc, doc_b: Doc, scales: tuple, min_tokens: int,
                       sentences: bool, threshold: float, min_words: int,
                       anchor_n: int = None) -> list:
    """两个文件之间的重合段（词窗层 ＋ 句级包含层）。"""
    spans = []
    for scale in scales:
        index_a = _shingles(doc_a, scale)
        runs = _match_runs(index_a, doc_b.tokens, scale)
        for a_start, a_end, b_start, b_end, shared in _merge_runs(runs, scale):
            spans.append((a_start, a_end, b_start, b_end, shared, scale))
    merged = _merge_across_scales(spans)
    segs = []
    for a_start, a_end, b_start, b_end, shared, scale in merged:
        if shared < min_tokens:
            continue
        segs.append(Segment(
            a_file=doc_a.rel,
            a_line_start=doc_a.line_of(a_start),
            a_line_end=doc_a.line_of(min(a_end, doc_a.total - 1)),
            b_file=doc_b.rel,
            b_line_start=doc_b.line_of(b_start),
            b_line_end=doc_b.line_of(min(b_end, doc_b.total - 1)),
            overlap_tokens=shared,
            a_span_tokens=a_end - a_start + 1,
            b_span_tokens=b_end - b_start + 1,
            a_token_start=a_start,
            a_token_end=a_end,
            b_token_start=b_start,
            b_token_end=b_end,
            match_source=SRC_WORD_WINDOW,
            scale=scale,
        ))
    if sentences:
        for sseg in _sentence_segments(doc_a, doc_b, scales, threshold,
                                       min_words, min_tokens, anchor_n):
            if _covered_by_window(sseg, segs):
                continue
            segs.append(sseg)
    return segs


def scan(dir_a: Path, dir_b: Path, n: int = None, scales: tuple = None,
         min_tokens: int = DEFAULT_MIN_TOKENS, exts: tuple = None,
         strip_comments: bool = True, sentences: bool = True,
         sentence_threshold: float = DEFAULT_SENTENCE_THRESHOLD,
         sentence_min_words: int = None,
         sentence_anchor_n: int = None) -> TextReuseResult:
    """扫描两个目录的字面重合。只读。

    用法错（目录不存在、n 越界、两侧同一目录）抛 ConfigError（exit 2）。

    `n` 给了＝**单窗模式**（只用这一个尺度）；`n` 不给＝**多尺度模式**
    （默认 `scales=(8, 5)`）。`sentences` 控制句级包含层（默认开）。
    """
    dir_a = Path(dir_a)
    dir_b = Path(dir_b)
    exts = tuple(exts) if exts else DEFAULT_EXTS

    if n is not None:
        if not (N_MIN <= int(n) <= N_MAX):
            raise ConfigError("n 必须在 %d–%d 之间（给了 %s）" % (N_MIN, N_MAX, n),
                              code=CODE_N_RANGE)
        scale_set = (int(n),)
    else:
        scale_set = parse_scales(scales)
        for sc in scale_set:
            if not (N_MIN <= int(sc) <= N_MAX):
                raise ConfigError("尺度必须在 %d–%d 之间（给了 %s）"
                                  % (N_MIN, N_MAX, sc), code=CODE_N_RANGE)
    if int(min_tokens) < 1:
        raise ConfigError("--min-tokens 必须 ≥1（给了 %s）" % min_tokens,
                          code=CODE_MIN_TOKENS_RANGE)
    if not (0.0 < float(sentence_threshold) <= 1.0):
        raise ConfigError("--sentence-threshold 必须在 (0, 1] 之间（给了 %s）"
                          % sentence_threshold,
                          code=CODE_SENTENCE_THRESHOLD_RANGE)
    min_words = (DEFAULT_SENTENCE_MIN_WORDS if sentence_min_words is None
                 else int(sentence_min_words))
    anchor_n = (DEFAULT_SENTENCE_ANCHOR_N if sentence_anchor_n is None
                else int(sentence_anchor_n))
    if anchor_n < 1:
        raise ConfigError("--sentence-anchor-n 必须 ≥1（给了 %s）" % anchor_n,
                          code=CODE_SENTENCE_MIN_WORDS_RANGE)
    if min_words < 1:
        raise ConfigError("--sentence-min-words 必须 ≥1（给了 %s）" % min_words,
                          code=CODE_SENTENCE_MIN_WORDS_RANGE)
    for root, label in ((dir_a, "目录A"), (dir_b, "目录B")):
        if not root.exists():
            raise ConfigError("%s 不存在：%s" % (label, root),
                              code=CODE_DIR_MISSING)
        if not root.is_dir():
            raise ConfigError("%s 不是目录：%s" % (label, root),
                              code=CODE_DIR_INVALID)
    if _same_dir(dir_a, dir_b):
        raise ConfigError(
            "自身对账无查重意义：目录A 与目录B 是同一个目录（%s）" % dir_a.resolve(),
            code=CODE_SELF_COMPARE)

    docs_a = _load_side(dir_a, exts, strip_comments, sentences)
    docs_b = _load_side(dir_b, exts, strip_comments, sentences)
    if not docs_a:
        raise ConfigError("目录A 下没有可读文件（找的是 %s）"
                          % "/".join(exts), code=CODE_NO_FILES)
    if not docs_b:
        raise ConfigError("目录B 下没有可读文件（找的是 %s）"
                          % "/".join(exts), code=CODE_NO_FILES)

    segments = []
    for doc_a in docs_a:
        for doc_b in docs_b:
            segments.extend(_segments_for_pair(doc_a, doc_b, scale_set,
                                               int(min_tokens), sentences,
                                               float(sentence_threshold),
                                               min_words, anchor_n))
    segments.sort(key=lambda s: (-s.overlap_tokens, s.a_file, s.a_line_start,
                                  s.b_file, s.b_line_start))

    totals_a = {d.rel: d.total for d in docs_a}
    totals_b = {d.rel: d.total for d in docs_b}
    pair_map = {}
    for seg in segments:
        key = (seg.a_file, seg.b_file)
        agg = pair_map.get(key)
        if agg is None:
            agg = Pair(a_file=seg.a_file, b_file=seg.b_file, overlap_tokens=0,
                       a_total_tokens=totals_a.get(seg.a_file, 0),
                       b_total_tokens=totals_b.get(seg.b_file, 0), segments=0)
            pair_map[key] = agg
        agg.segments += 1
        agg.shared_tokens += seg.overlap_tokens
        agg.segments_by_source[seg.match_source] = \
            agg.segments_by_source.get(seg.match_source, 0) + 1
    # 覆盖量取区间并集：同一段 A 文字在 B 侧出现多次也只按一份算。
    for key, agg in pair_map.items():
        a_spans, b_spans = [], []
        for seg in segments:
            if (seg.a_file, seg.b_file) != key:
                continue
            a_spans.append((seg.a_token_start, seg.a_token_end))
            b_spans.append((seg.b_token_start, seg.b_token_end))
        agg.overlap_tokens = _union_len(a_spans)
        agg.b_overlap_tokens = _union_len(b_spans)
    pairs = sorted(pair_map.values(),
                   key=lambda p: (-p.overlap_tokens, p.a_file, p.b_file))

    return TextReuseResult(
        dir_a=dir_a, dir_b=dir_b, n=max(scale_set), min_tokens=int(min_tokens),
        exts=exts, strip_comments=strip_comments,
        files_a=len(docs_a), files_b=len(docs_b),
        tokens_a=sum(d.total for d in docs_a),
        tokens_b=sum(d.total for d in docs_b),
        segments=segments, pairs=pairs,
        scales=scale_set, sentences=sentences,
        sentence_threshold=float(sentence_threshold),
        sentence_min_words=min_words,
        sentence_anchor_n=anchor_n,
    )


def _union_len(spans: list) -> int:
    """若干闭区间的并集长度（词数）。"""
    if not spans:
        return 0
    ordered = sorted(spans)
    total = 0
    cur_start, cur_end = ordered[0]
    for start, end in ordered[1:]:
        if start <= cur_end + 1:
            cur_end = max(cur_end, end)
            continue
        total += cur_end - cur_start + 1
        cur_start, cur_end = start, end
    return total + (cur_end - cur_start + 1)


def _same_dir(dir_a: Path, dir_b: Path) -> bool:
    """两个路径是不是同一个目录（同一路径，或同一 inode＝同盘同一目录）。"""
    try:
        a_resolved = dir_a.resolve()
        b_resolved = dir_b.resolve()
    except OSError:
        a_resolved = dir_a.absolute()
        b_resolved = dir_b.absolute()
    if a_resolved == b_resolved:
        return True
    try:
        if dir_a.exists() and dir_b.exists() and dir_a.samefile(dir_b):
            return True
    except OSError:
        pass
    return False


# --------------------------------------------------------------------------
# 报告
# --------------------------------------------------------------------------
def segment_dicts(result: TextReuseResult) -> list:
    return [s.as_dict() for s in result.segments]


def pair_dicts(result: TextReuseResult) -> list:
    return [p.as_dict() for p in result.pairs]


def render(result: TextReuseResult) -> str:
    """人读报告：逐段两侧行区间＋重合词数＋匹配来源，末尾给汇总与能力边界。"""
    scales = "/".join(str(s) for s in result.scales)
    lines = ["== factscribe textreuse ==",
             "目录A：%s" % result.dir_a,
             "目录B：%s" % result.dir_b,
             "口径：词级多尺度 n=%s 字面重合；归一＝空白折叠＋LaTeX 注释行%s＋LaTeX 命令去"
             "＋大小写折叠；扩展名 %s"
             % (scales, "已去" if result.strip_comments else "保留",
                "/".join(result.exts))]
    if result.sentences:
        lines.append("句级包含层：开（词集重合率阈值 %.2f，最少共享 %d 词，"
                     "n=%d 词窗粗筛候选句对）"
                     % (result.sentence_threshold, result.sentence_min_words,
                        result.sentence_anchor_n))
    else:
        lines.append("句级包含层：关（--no-sentences）")
    lines.append("覆盖：A 侧 %d 个文件 / %d 词；B 侧 %d 个文件 / %d 词"
                 % (result.files_a, result.tokens_a, result.files_b, result.tokens_b))
    lines.append("能力边界：%s" % result.boundary)
    if not result.segments:
        lines.append("零重合：两侧没有 ≥%d 词的字面重合段。" % result.min_tokens)
        lines.append("注意：这不等于没有抄——改写与语义重合不在本卡口径内。")
        return "\n".join(lines)

    lines.append("重合段 %d 段（≥%d 词）：" % (len(result.segments), result.min_tokens))
    for i, seg in enumerate(result.segments, 1):
        lines.append("  %d) [%s][%s] 重合 %d 词"
                     % (i, seg.code, seg.source_label, seg.overlap_tokens))
        lines.append("     A：%s:%d-%d" % (seg.a_file, seg.a_line_start, seg.a_line_end))
        lines.append("     B：%s:%d-%d" % (seg.b_file, seg.b_line_start, seg.b_line_end))
    lines.append("汇总（按文件对，A 侧被复制词数降序）：")
    for pair in result.pairs:
        lines.append("  %s ↔ %s：A 侧被复制 %d 词（占该文件 %.1f%%，%d/%d 词）；"
                     "B 侧被覆盖 %d 词（占该文件 %.1f%%）；共 %d 段"
                     % (pair.a_file, pair.b_file, pair.overlap_tokens,
                        pair.a_ratio * 100, pair.overlap_tokens,
                        pair.a_total_tokens, pair.b_overlap_tokens,
                        pair.b_ratio * 100, pair.segments))
    return "\n".join(lines)
