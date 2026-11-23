# -*- coding: utf-8 -*-
"""改写保护面比对（SPEC-V3.0 §14）。

改写（换句、润色、重排）之后，机械比对「不许变」的内容：

* 硬面（变了即红）：事实标记、数字、引用、公式、表格、交叉引用；
* 软面（黄）：章节标题文字、文件集合（`--allow-renames` 只把标题降为信息）。

输出必须给 `文件:行: 多/少/改成了什么`。本模块只服务 ``protect`` 子命令，
不改 ``audit`` / ``style`` 的判据与退出码；数字抽取直接复用 ``texscan``
与 ``audit`` 的同一套 tokenizer 和 ``number_key`` 归一。
"""
from __future__ import annotations

import difflib
import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

from .config import ConfigError
from .constants import (EXIT_OK, EXIT_RED, EXIT_YELLOW, SEV_INFO, SEV_RED,
                        SEV_YELLOW)
from .texscan import (_balanced, _blank, _extract_numbers,
                      _line_of, _mask_envs_and_verb, scan_tex)


# --------------------------------------------------------------------------
# 结果模型
# --------------------------------------------------------------------------

@dataclass
class ProtectFinding:
    code: str
    severity: str
    file: str
    line: int
    message: str
    before: str = ""
    after: str = ""

    def as_dict(self) -> dict:
        d = {"severity": self.severity, "code": self.code,
             "file": self.file, "line": self.line,
             "message": self.message,
             "before": self.before, "after": self.after}
        return d


@dataclass
class ProtectResult:
    before: Path
    after: Path
    allow_renames: bool
    findings: list[ProtectFinding] = field(default_factory=list)

    @property
    def exit_code(self) -> int:
        if any(f.severity == SEV_RED for f in self.findings):
            return EXIT_RED
        if any(f.severity == SEV_YELLOW for f in self.findings):
            return EXIT_YELLOW
        return EXIT_OK

    def summary(self) -> dict:
        counts = {SEV_RED: 0, SEV_YELLOW: 0, SEV_INFO: 0}
        for f in self.findings:
            counts[f.severity] = counts.get(f.severity, 0) + 1
        return {"red": counts[SEV_RED], "yellow": counts[SEV_YELLOW],
                "info": counts[SEV_INFO], "total": len(self.findings)}


# --------------------------------------------------------------------------
# 文件收集与代码视图
# --------------------------------------------------------------------------

def _tex_files(root: Path) -> dict[str, Path]:
    """递归收集 *.tex；跳过隐藏目录与隐藏文件。返回 {相对路径: Path}。"""
    out: dict[str, Path] = {}
    for p in sorted(root.rglob("*.tex")):
        if not p.is_file():
            continue
        rel = p.relative_to(root)
        if any(part.startswith(".") for part in rel.parts):
            continue
        out[rel.as_posix()] = p
    return out


def _code_view(tex: str) -> str:
    """等长遮罩：verbatim/verb/批注宏与注释都抹成空格（保留换行）。

    公式、表格、命令与参数原样保留，供结构面抽取；行号与源文件一致。
    """
    chars, _annotations, _args = _mask_envs_and_verb(tex)
    s = "".join(chars)
    i, n = 0, len(s)
    while i < n:
        c = s[i]
        if c == "\\":
            i += 2
            continue
        if c == "%":
            while i < n and s[i] != "\n":
                chars[i] = " "
                i += 1
            continue
        i += 1
    return "".join(chars)


def _clip(text: str, limit: int = 48) -> str:
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    return text if len(text) <= limit else text[:limit - 1] + "…"


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------
# 公式
# --------------------------------------------------------------------------

@dataclass
class _MathItem:
    kind: str
    pos: int
    line: int
    digest: str
    snippet: str


_MATH_ENV_RE = re.compile(
    r"\\begin\{(equation|align)\*?\}(.*?)\\end\{\1\*?\}", re.S)


def _math_item(kind: str, content: str, text: str, pos: int) -> _MathItem:
    # 公式里的空白不承载语义：去光再哈希，避免重排/换行造成误报。
    norm = re.sub(r"\s+", "", content)
    return _MathItem(kind=kind, pos=pos, line=_line_of(text, pos),
                     digest=_digest(norm), snippet=_clip(content))


def _math_items(view: str) -> list[_MathItem]:
    items: list[_MathItem] = []
    chars = list(view)
    spans: list[tuple[int, int]] = []
    for m in _MATH_ENV_RE.finditer(view):
        spans.append((m.start(), m.end()))
        items.append(_math_item("environment", m.group(2), view, m.start()))
    for start, end in spans:
        _blank(chars, start, end)
    s = "".join(chars)

    i, n = 0, len(s)
    while i < n:
        c = s[i]
        if c == "\\":
            if s.startswith("\\[", i):
                end = s.find("\\]", i + 2)
                stop = n if end < 0 else end
                items.append(_math_item("display", s[i + 2:stop], s, i))
                i = n if end < 0 else end + 2
                continue
            if s.startswith("\\(", i):
                end = s.find("\\)", i + 2)
                stop = n if end < 0 else end
                items.append(_math_item("inline", s[i + 2:stop], s, i))
                i = n if end < 0 else end + 2
                continue
            i += 2
            continue
        if c == "$":
            if s.startswith("$$", i):
                end = s.find("$$", i + 2)
                stop = n if end < 0 else end
                items.append(_math_item("display", s[i + 2:stop], s, i))
                i = n if end < 0 else end + 2
                continue
            j = i + 1
            while j < n:
                if s[j] == "\\":
                    j += 2
                    continue
                if s[j] == "$":
                    break
                j += 1
            if j >= n:
                i += 1                    # 未闭合的 $：当字面量跳过，别吞掉后文公式
                continue
            items.append(_math_item("inline", s[i + 1:j], s, i))
            i = j + 1
            continue
        i += 1
    items.sort(key=lambda x: x.pos)
    return items


# --------------------------------------------------------------------------
# 表格
# --------------------------------------------------------------------------

@dataclass
class _TableRow:
    count: int
    digest: str
    line: int
    cells: list[str]


@dataclass
class _TableItem:
    pos: int
    line: int
    rows: list[_TableRow]

    @property
    def signature(self) -> tuple:
        return tuple(r.digest for r in self.rows)


_TABULAR_RE = re.compile(r"\\begin\{(tabular\*?)\}(.*?)\\end\{\1\}", re.S)
_ROW_BREAK_RE = re.compile(r"\\\\")
_ROW_OPT_RE = re.compile(r"\s*\[[^\]]*\]")
_RULE_RE = re.compile(
    r"\\(?:hline|toprule|midrule|bottomrule|addlinespace)\b"
    r"|\\(?:cline|cmidrule|specialrule)(?:\([^)]*\))?\s*\{[^}]*\}"
    r"(?:\s*\{[^}]*\})?")
_CELL_SPLIT_RE = re.compile(r"(?<!\\)&")


def _skip_ws_at(s: str, i: int) -> int:
    while i < len(s) and s[i] in " \t\r\n":
        i += 1
    return i


def _table_rows(body: str, base: int, view: str) -> list[_TableRow]:
    rows: list[_TableRow] = []
    pos = 0

    def add_row(raw: str, raw_start: int) -> None:
        cleaned = _RULE_RE.sub(" ", raw)
        if not cleaned.strip():
            return
        cells = [re.sub(r"\s+", " ", c).strip()
                 for c in _CELL_SPLIT_RE.split(cleaned)]
        # 行尾可能只剩空白产生的假列：保留实际 cell 数（LaTeX 也这么数）。
        if len(cells) == 1 and not cells[0]:
            return
        lead = len(raw) - len(raw.lstrip())
        rows.append(_TableRow(
            count=len(cells),
            digest=_digest("|".join(cells)),
            line=_line_of(view, raw_start + lead),
            cells=cells))

    for m in _ROW_BREAK_RE.finditer(body):
        add_row(body[pos:m.start()], base + pos)
        pos = m.end()
        opt = _ROW_OPT_RE.match(body, pos)
        if opt:
            pos = opt.end()
    if pos < len(body):
        add_row(body[pos:], base + pos)
    return rows


def _table_items(view: str) -> list[_TableItem]:
    items: list[_TableItem] = []
    for m in _TABULAR_RE.finditer(view):
        body = m.group(2)
        body_start = m.start(2)
        i = _skip_ws_at(body, 0)
        if i < len(body) and body[i] == "[":
            i = _balanced(body, i, "[", "]")
        i = _skip_ws_at(body, i)
        if i < len(body) and body[i] == "{":
            i = _balanced(body, i, "{", "}")
            if m.group(1) == "tabular*":
                i = _skip_ws_at(body, i)
                if i < len(body) and body[i] == "{":
                    i = _balanced(body, i, "{", "}")
        items.append(_TableItem(
            pos=m.start(), line=_line_of(view, m.start()),
            rows=_table_rows(body[i:], body_start + i, view)))
    return items


# --------------------------------------------------------------------------
# 交叉引用与章节标题
# --------------------------------------------------------------------------

_LABEL_RE = re.compile(r"\\(label|ref|eqref)\s*\{([^}]*)\}")


def _label_items(view: str) -> list[tuple[str, str, int]]:
    """[(key, display, line)]；按 key 去重（集合语义）。"""
    seen: set[str] = set()
    out: list[tuple[str, str, int]] = []
    for m in _LABEL_RE.finditer(view):
        key = m.group(2).strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append((key, key, _line_of(view, m.start())))
    return out


_HEADING_RE = re.compile(
    r"\\(part|chapter|section|subsection|subsubsection|paragraph)\*?"
    r"\s*(?:\[[^\]]*\])?\s*\{")


@dataclass
class _Heading:
    level: str
    title: str
    line: int


def _heading_items(view: str) -> list[_Heading]:
    out: list[_Heading] = []
    for m in _HEADING_RE.finditer(view):
        end = _balanced(view, m.end() - 1, "{", "}")
        stop = end - 1 if end > m.end() else len(view)
        title = re.sub(r"\s+", " ", view[m.end():stop]).strip()
        out.append(_Heading(level=m.group(1), title=title,
                            line=_line_of(view, m.start())))
    return out


# --------------------------------------------------------------------------
# 每文件的保护面快照
# --------------------------------------------------------------------------

@dataclass
class _FileSurface:
    facts: list[tuple[str, str, int]]
    numbers: list[tuple[str, str, int]]
    cites: list[tuple[str, str, int]]
    math: list[_MathItem]
    tables: list[_TableItem]
    labels: list[tuple[str, str, int]]
    headings: list[_Heading]


def _surface(text: str) -> _FileSurface:
    scan = scan_tex(text)
    view = _code_view(text)
    facts = [(fid, fid, line) for fid, line in scan.markers]
    numbers = [(n["key"], n["token"], n["line"])
               for n in _extract_numbers(scan.masked, text)]
    cites = [(key, key, line) for key, line, _col in scan.cites]
    return _FileSurface(facts=facts, numbers=numbers, cites=cites,
                        math=_math_items(view), tables=_table_items(view),
                        labels=_label_items(view),
                        headings=_heading_items(view))


# --------------------------------------------------------------------------
# 多重集差异 → 发现
# --------------------------------------------------------------------------

def _diff_by_position(before: list, after: list, key_of, line_of
                      ) -> tuple[list, list, list]:
    """先按「同键 + 最近行号」配对未变项，再把剩下的按最近行号配成「改成了」。"""
    used: set[int] = set()
    matched_after: set[int] = set()
    for ai, a in enumerate(after):
        akey = key_of(a)
        aline = line_of(a)
        best: int | None = None
        best_dist: int | None = None
        for bi, b in enumerate(before):
            if bi in used or key_of(b) != akey:
                continue
            dist = abs(line_of(b) - aline)
            if best_dist is None or dist < best_dist:
                best, best_dist = bi, dist
        if best is not None:
            used.add(best)
            matched_after.add(ai)
    before_unmatched = [b for idx, b in enumerate(before) if idx not in used]
    after_unmatched = [a for idx, a in enumerate(after)
                       if idx not in matched_after]
    pairs, before_left, after_left = _pair_nearest(
        before_unmatched, after_unmatched, line_of)
    return pairs, before_left, after_left


def _after_note(before_line: int, after_line: int) -> str:
    return "" if before_line == after_line else "（改后第 %d 行）" % after_line


def _pair_nearest(before: list, after: list, line_of) -> tuple[list, list, list]:
    """按行号最近配对「改成了」；先配近的，剩下的才算多/少。

    同一个数字在文里出现两次、只改了一处时，删掉的应是**靠近改动点**那一处，
    而不是文档里第一次出现的那一处——否则报出来的行号会指错地方。
    """
    used: set[int] = set()
    pairs: list[tuple] = []
    leftovers_after: list = []
    for a in after:
        aline = line_of(a)
        best: int | None = None
        best_dist: int | None = None
        for idx, b in enumerate(before):
            if idx in used:
                continue
            dist = abs(line_of(b) - aline)
            if best_dist is None or dist < best_dist:
                best, best_dist = idx, dist
        if best is None:
            leftovers_after.append(a)
            continue
        used.add(best)
        pairs.append((before[best], a))
    leftovers_before = [b for idx, b in enumerate(before) if idx not in used]
    pairs.sort(key=lambda pair: line_of(pair[0]))
    return pairs, leftovers_before, leftovers_after


def _multiset_findings(rel: str, code: str, noun: str,
                       before: list[tuple[str, str, int]],
                       after: list[tuple[str, str, int]]) -> list[ProtectFinding]:
    """事实标记/数字/引用/交叉引用共用：多重集差异，按行号最近配对成「改成了」。"""
    pairs, b_left, a_left = _diff_by_position(
        before, after, lambda item: item[0], lambda item: item[2])
    out: list[ProtectFinding] = []
    for (_bkey, bdisp, bline), (_akey, adisp, aline) in pairs:
        out.append(ProtectFinding(
            code=code, severity=SEV_RED, file=rel, line=bline,
            message='%s "%s" 改成了 "%s"%s'
                    % (noun, bdisp, adisp, _after_note(bline, aline)),
            before=bdisp, after=adisp))
    for _key, disp, line in b_left:
        out.append(ProtectFinding(
            code=code, severity=SEV_RED, file=rel, line=line,
            message='少了%s "%s"' % (noun, disp), before=disp))
    for _key, disp, line in a_left:
        out.append(ProtectFinding(
            code=code, severity=SEV_RED, file=rel, line=line,
            message='多出%s "%s"' % (noun, disp), after=disp))
    return out


def _math_findings(rel: str, before: list[_MathItem],
                   after: list[_MathItem]) -> list[ProtectFinding]:
    pairs, b_left, a_left = _diff_by_position(
        before, after, lambda item: item.digest, lambda item: item.line)
    out: list[ProtectFinding] = []
    for b, a in pairs:
        out.append(ProtectFinding(
            code="PROTECT_MATH_CHANGED", severity=SEV_RED, file=rel,
            line=b.line,
            message='公式内容改了（"%s" → "%s"）%s'
                    % (_clip(b.snippet, 32), _clip(a.snippet, 32),
                       _after_note(b.line, a.line)),
            before=b.snippet, after=a.snippet))
    for m in b_left:
        out.append(ProtectFinding(
            code="PROTECT_MATH_CHANGED", severity=SEV_RED, file=rel,
            line=m.line, message='少了公式（"%s"）' % _clip(m.snippet),
            before=m.snippet))
    for m in a_left:
        out.append(ProtectFinding(
            code="PROTECT_MATH_CHANGED", severity=SEV_RED, file=rel,
            line=m.line, message='多出公式（"%s"）' % _clip(m.snippet),
            after=m.snippet))
    return out


def _row_findings(rel: str, before: _TableItem,
                  after: _TableItem) -> list[ProtectFinding]:
    pairs, b_left, a_left = _diff_by_position(
        before.rows, after.rows, lambda row: row.digest, lambda row: row.line)
    out: list[ProtectFinding] = []
    for b, a in pairs:
        if b.count != a.count:
            detail = '列数 %d 改成了 %d' % (b.count, a.count)
        else:
            idx = next((i for i, (x, y) in enumerate(zip(b.cells, a.cells))
                        if x != y), 0)
            detail = '第 %d 列 "%s" 改成了 "%s"' % (
                idx + 1, _clip(b.cells[idx], 24), _clip(a.cells[idx], 24))
        out.append(ProtectFinding(
            code="PROTECT_TABLE_CHANGED", severity=SEV_RED, file=rel,
            line=b.line,
            message='表格行改了：%s%s' % (detail, _after_note(b.line, a.line)),
            before=" | ".join(b.cells), after=" | ".join(a.cells)))
    for r in b_left:
        out.append(ProtectFinding(
            code="PROTECT_TABLE_CHANGED", severity=SEV_RED, file=rel,
            line=r.line, message='少了表格行（列数 %d）' % r.count,
            before=" | ".join(r.cells)))
    for r in a_left:
        out.append(ProtectFinding(
            code="PROTECT_TABLE_CHANGED", severity=SEV_RED, file=rel,
            line=r.line, message='多出表格行（列数 %d）' % r.count,
            after=" | ".join(r.cells)))
    return out


def _table_findings(rel: str, before: list[_TableItem],
                    after: list[_TableItem]) -> list[ProtectFinding]:
    pairs, b_left, a_left = _diff_by_position(
        before, after, lambda table: table.signature, lambda table: table.line)
    out: list[ProtectFinding] = []
    for b, a in pairs:
        out += _row_findings(rel, b, a)
    for t in b_left:
        out.append(ProtectFinding(
            code="PROTECT_TABLE_CHANGED", severity=SEV_RED, file=rel,
            line=t.line, message='少了表格（%d 行）' % len(t.rows)))
    for t in a_left:
        out.append(ProtectFinding(
            code="PROTECT_TABLE_CHANGED", severity=SEV_RED, file=rel,
            line=t.line, message='多出表格（%d 行）' % len(t.rows)))
    return out


def _heading_findings(rel: str, before: list[_Heading], after: list[_Heading],
                      allow_renames: bool) -> list[ProtectFinding]:
    if [h.title for h in before] == [h.title for h in after]:
        return []
    severity = SEV_INFO if allow_renames else SEV_YELLOW
    out: list[ProtectFinding] = []
    matcher = difflib.SequenceMatcher(
        a=[h.title for h in before], b=[h.title for h in after],
        autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag != "replace":
            continue                      # 纯新增/删除标题不是保护面
        for b, a in zip(before[i1:i2], after[j1:j2]):
            if b.level != a.level or b.title == a.title:
                continue
            out.append(ProtectFinding(
                code="PROTECT_HEADING_RENAMED", severity=severity, file=rel,
                line=b.line,
                message='标题 "%s" 改成了 "%s"%s'
                        % (b.title, a.title, _after_note(b.line, a.line)),
                before=b.title, after=a.title))
    return out


# --------------------------------------------------------------------------
# 主入口
# --------------------------------------------------------------------------

def compare(before: Path | str, after: Path | str,
            allow_renames: bool = False) -> ProtectResult:
    before = Path(before)
    after = Path(after)
    for flag, path in (("--before", before), ("--after", after)):
        if not path.is_dir():
            raise ConfigError("%s 目录不存在或不是目录：%s" % (flag, path))

    bfiles = _tex_files(before)
    afiles = _tex_files(after)
    findings: list[ProtectFinding] = []

    for rel in sorted(set(afiles) - set(bfiles)):
        findings.append(ProtectFinding(
            code="PROTECT_FILE_SET_CHANGED", severity=SEV_YELLOW,
            file=rel, line=0, message="多出文件 %s" % rel, after=rel))
    for rel in sorted(set(bfiles) - set(afiles)):
        findings.append(ProtectFinding(
            code="PROTECT_FILE_SET_CHANGED", severity=SEV_YELLOW,
            file=rel, line=0, message="少了文件 %s" % rel, before=rel))

    for rel in sorted(set(bfiles) & set(afiles)):
        try:
            btext = bfiles[rel].read_text(encoding="utf-8", errors="replace")
            atext = afiles[rel].read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            raise ConfigError("读不了 %s：%s" % (rel, exc)) from exc
        b = _surface(btext)
        a = _surface(atext)
        findings += _multiset_findings(
            rel, "PROTECT_FACT_CHANGED", "事实标记", b.facts, a.facts)
        findings += _multiset_findings(
            rel, "PROTECT_NUMBER_CHANGED", "数字", b.numbers, a.numbers)
        findings += _multiset_findings(
            rel, "PROTECT_CITE_CHANGED", "引用", b.cites, a.cites)
        findings += _math_findings(rel, b.math, a.math)
        findings += _table_findings(rel, b.tables, a.tables)
        findings += _multiset_findings(
            rel, "PROTECT_LABEL_CHANGED", "交叉引用键", b.labels, a.labels)
        findings += _heading_findings(rel, b.headings, a.headings,
                                      allow_renames)

    findings.sort(key=lambda f: (f.file, f.line, f.code))
    return ProtectResult(before=before, after=after,
                         allow_renames=allow_renames, findings=findings)


_SEV_LABEL = {SEV_RED: "红", SEV_YELLOW: "黄", SEV_INFO: "信息"}


def render_human(result: ProtectResult) -> str:
    lines = ["== factscribe protect ==",
             "改写前：%s" % result.before,
             "改写后：%s" % result.after]
    summary = result.summary()
    lines.append("红：%d   黄：%d   信息：%d   退出码：%d"
                 % (summary["red"], summary["yellow"], summary["info"],
                    result.exit_code))
    if not result.findings:
        lines.append("保护面全部一致。")
        return "\n".join(lines)
    for f in result.findings:
        loc = "%s:%d" % (f.file, f.line) if f.line else f.file
        lines.append("[%s] %s %s: %s"
                     % (_SEV_LABEL.get(f.severity, f.severity), f.code,
                        loc, f.message))
    return "\n".join(lines)
