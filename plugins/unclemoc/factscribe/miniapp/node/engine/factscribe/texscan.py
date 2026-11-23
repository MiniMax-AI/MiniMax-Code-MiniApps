# -*- coding: utf-8 -*-
"""TeX 遮罩、scan_tex 与数字抽取。"""
from __future__ import annotations

import posixpath
import re
from dataclasses import dataclass, field

from .facts import THIN, _NUM_RE, canon_text, number_key
from .texrules import strip_comments_and_verbatim

# --------------------------------------------------------------------------
# LaTeX 扫描：注释、命令名、结构参数、\fact{} 绑定
# --------------------------------------------------------------------------

# 命令 -> 要吞掉的必选参数（{...}）个数
_SKIP_ARGS = {
    "cite": 1, "citep": 1, "citet": 1, "citealp": 1, "citealt": 1,
    "citeauthor": 1, "citeyear": 1, "Cite": 1, "Citep": 1, "Citet": 1,
    "nocite": 1,
    "ref": 1, "eqref": 1, "pageref": 1, "autoref": 1, "cref": 1, "Cref": 1,
    "nameref": 1, "vref": 1,
    "label": 1, "input": 1, "include": 1, "includeonly": 1, "subfile": 1,
    "includegraphics": 1,
    "begin": 2, "end": 2,                 # \begin{tabular}{p{2cm}l}
    "bibitem": 1, "bibliography": 1, "bibliographystyle": 1,
    "addbibresource": 1,
    "documentclass": 1, "usepackage": 1, "RequirePackage": 1,
    "url": 1, "href": 2,
    "setlength": 2, "addtolength": 2, "setcounter": 2,
    "hspace": 1, "vspace": 1, "rule": 2, "raisebox": 2,
    "graphicspath": 1, "linespread": 1,
    "multicolumn": 2, "multirow": 2,
    "newcommand": 2, "renewcommand": 2, "providecommand": 2,
    "color": 1, "textcolor": 2, "resizebox": 2, "scalebox": 1,
    "fontsize": 2, "setmainfont": 1, "setCJKmainfont": 1,
}

_CMD_RE = re.compile(r"\\([A-Za-z]+[0-9]*)(\*?)")
_MACRO_DEF_CMDS = {"newcommand", "renewcommand", "providecommand",
                   "DeclareRobustCommand", "NewDocumentCommand",
                   "DeclareDocumentCommand", "def"}
_WIKI_FACT_RE = re.compile(r"\[\[\s*fact\s*:\s*([^\]]+?)\s*\]\]")

# 引用命令：任何名字里带 cite 的命令都算「引用家族」（红队 B2 的 fail-closed）。
# - 已知合法：照常抽 key；
# - 明确不是 key 的排版命令：忽略；
# - 其余未知的 *cite* 命令：判红，不许静默放行。
_CITE_IGNORE = {"citestyle", "citetext", "bibcite", "citeindextrue", "citeindexfalse"}
_CITE_KNOWN = {
    "cite", "citep", "citet", "citealp", "citealt", "citeauthor", "citeyear",
    "citenum", "cites", "nocite", "upcite", "parencite", "textcite", "autocite",
    "footcite", "fullcite", "smartcite", "supercite", "notecite", "citeurl",
    "citefield", "citetitle", "citedate", "citejournal", "citelist",
}
_CITE_RE = re.compile(
    r"\\([A-Za-z]*[Cc]ite[A-Za-z]*)\*?((?:\s*\[[^\]]*\])*)\s*\{([^}]*)\}")
_FIGURE_RE = re.compile(r"\\includegraphics\*?(?:\s*\[[^\]]*\])*\s*\{([^}]*)\}")
_BIBRES_RE = re.compile(r"\\(?:bibliography|addbibresource)\s*\{([^}]*)\}")

# 整体跳过的环境：verbatim 里的 % 不是注释（红队 B3）；fsignore 是显式豁免区。
# thebibliography：渲染的是文献表（W2/W3 白名单面），不是正文定量断言；
# 文献里的年份/页码不能按「正文数字」判，PDF 层用白名单显式计数兜住（P-05）。
_SKIP_ENVS = r"(?:verbatim\*?|Verbatim|lstlisting|minted|comment\*?|fsignore|thebibliography)"
_SKIP_ENV_RE = re.compile(
    r"\\begin\{(%s)\}.*?\\end\{\1\}" % _SKIP_ENVS, re.S)
_VERB_RE = re.compile(r"\\verb\*?([^A-Za-z\s])")


def _blank(chars: list, start: int, stop: int) -> None:
    """把 [start, stop) 抹成空格，保留换行（保证行列号不漂）。"""
    stop = min(stop, len(chars))
    for i in range(start, stop):
        if chars[i] != "\n":
            chars[i] = " "


def _skip_ws(s: str, i: int) -> int:
    while i < len(s) and s[i] in " \t\r\n":
        i += 1
    return i


def _balanced(s: str, start: int, opener: str, closer: str) -> int:
    """s[start] == opener；返回配对 closer 之后的位置（找不到则到串尾）。"""
    depth = 0
    i = start
    while i < len(s):
        c = s[i]
        if c == "\\":
            i += 2
            continue
        if c == opener:
            depth += 1
        elif c == closer:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return len(s)


def _line_of(s: str, pos: int) -> int:
    return s.count("\n", 0, pos) + 1


# 写作批注宏（v1.1）：内容是作者给作者的问题，不是正文命题。
# 抽数字前整块剥离（连同参数），不参与审计，只计数上报。
_ANNOTATION_CMDS = ("todoq", "todo", "fsignore", "pknote", "fixme", "note", "tbd")


def _mask_envs_and_verb(tex: str) -> tuple[list, list[tuple[str, int]], list[tuple[str, int, str]]]:
    """第一刀：verbatim/verb/fsignore 整块与写作批注宏抹掉（在剥注释之前）。

    返回 (chars, annotations, annotation_args)，annotations 是 [(宏名, 行号)]，
    annotation_args 额外带参数原文（供 R-07 的 FSIGNORE_QUANT 检查），供审计
    报告单列「已跳过 N 处批注」——跳过不等于放行，必须让人看见跳了多少。
    """
    chars = list(tex)
    annotations: list[tuple[str, int]] = []
    annotation_args: list[tuple[str, int, str]] = []
    for m in _SKIP_ENV_RE.finditer(tex):
        _blank(chars, m.start(), m.end())
    # \verb|...|（同一行内，分隔符为任意非字母非空白字符）；在环境掩码之后做，
    # 免得 verbatim 内容里的 \verb 把范围抹歪。
    s = "".join(chars)
    for m in _VERB_RE.finditer(s):
        delim = m.group(1)
        end = s.find(delim, m.end())
        if end < 0:
            end = s.find("\n", m.end())
            end = len(s) if end < 0 else end
        else:
            end += 1
        _blank(chars, m.start(), end)
    # \fsignore{...} / \todoq{...} / \todo[...]{...}：整条批注连同参数抹成空白。
    # 行号用抹除前的文本算（结构未被改动前的位置）。
    s = "".join(chars)
    ann_re = re.compile(r"\\(%s)\b" % "|".join(_ANNOTATION_CMDS))
    for m in ann_re.finditer(s):
        # 注释里的批注不算（先剥注释做不到——verbatim 里的 % 不是注释）
        line_start = s.rfind("\n", 0, m.start()) + 1
        if re.search(r"(?<!\\)%", s[line_start:m.start()]):
            continue
        j = m.end()
        while True:
            k = _skip_ws(s, j)
            if k < len(s) and s[k] == "[":
                j = _balanced(s, k, "[", "]")
            else:
                break
        k = _skip_ws(s, j)
        arg_text = ""
        if k < len(s) and s[k] == "{":
            end = _balanced(s, k, "{", "}")
            arg_text = s[k + 1:end - 1]
        else:
            end = s.find("\n", m.end())
            end = len(s) if end < 0 else end
        annotations.append((m.group(1), _line_of(s, m.start())))
        annotation_args.append((m.group(1), _line_of(s, m.start()), arg_text))
        _blank(chars, m.start(), end)
    return chars, annotations, annotation_args


def _mask_scripts(chars: list) -> None:
    """上下标是结构量：R^2 / x_{12} / a_1 里的数字不算命题（红队 C1）。"""
    s = "".join(chars)
    for m in re.finditer(r"[\^_]\s*", s):
        j = m.end()
        if j < len(s) and s[j] == "{":
            end = _balanced(s, j, "{", "}")
        elif j < len(s) and s[j].isalnum():
            end = j + 1
        else:
            continue
        _blank(chars, m.start(), end)


@dataclass
class ScanResult:
    masked: str                     # 抹掉注释/命令/参数后的正文
    bindings: dict[int, list[str]]  # 行号 -> [fact id]（兼容旧口径；审计按 BU 归属）
    markers: list[tuple[str, int]]  # (fact id, 行号)
    cites: list[tuple[str, int, int]]  # (key, 行号, 列)
    nocite_all: bool = False        # 正文出现 \nocite{*}（整库引用）
    unknown_cites: list[tuple[str, int, int]] = field(default_factory=list)
    bib_files: list[str] = field(default_factory=list)
    figures: list[tuple[str, int]] = field(default_factory=list)
    annotations: list[tuple[str, int]] = field(default_factory=list)  # (宏名, 行号)
    annotation_args: list[tuple[str, int, str]] = field(default_factory=list)
    marker_groups: list[dict] = field(default_factory=list)  # [{ids, end, line}]
    adjacency: str = ""             # 命令名未抹除的结构层（邻接判据用）


def scan_tex(tex: str) -> ScanResult:
    # ---- pass 1a：verbatim/verb/批注宏整块跳过 ----
    masked, annotations, annotation_args = _mask_envs_and_verb(tex)

    # ---- pass 1b：{,} 当千分位哨兵（数学里 1{,}024） ----
    s0 = "".join(masked)
    for m in re.finditer(r"\{,\}", s0):
        for k in range(m.start(), m.end()):
            masked[k] = THIN

    # ---- pass 1c：注释与转义（唯一顺序：\% 不是注释；~ / \, 是千分位哨兵） ----
    i, n = 0, len(s0)
    while i < n:
        c = s0[i]
        if c == "\\":
            nxt = s0[i + 1] if i + 1 < n else ""
            if nxt == "%":
                masked[i], masked[i + 1] = "%", " "   # 10\% -> "10 %"
                i += 2
                continue
            if nxt in "$&#_{}":
                masked[i], masked[i + 1] = " ", nxt
                i += 2
                continue
            if nxt in ",;:!~":
                if nxt == "~":
                    masked[i], masked[i + 1] = " ", " "
                else:
                    masked[i], masked[i + 1] = THIN, THIN
                i += 2
                continue
            if nxt in " \t":
                masked[i], masked[i + 1] = THIN, THIN
                i += 2
                continue
            i += 2
            continue
        if c == "~":
            masked[i] = THIN
            i += 1
            continue
        if c == "%":
            while i < n and s0[i] != "\n":
                masked[i] = " "
                i += 1
            continue
        i += 1

    s = "".join(masked)

    # ---- pass 2：引用 / 图 / bib 文件（在参数被抹掉之前）----
    cites: list[tuple[str, int, int]] = []
    nocite_all = False
    unknown_cites: list[tuple[str, int, int]] = []
    for m in _CITE_RE.finditer(s):
        name = m.group(1)
        lname = name.lower()
        if lname in _CITE_IGNORE:
            continue
        keys = [(km.start(), km.group(0)) for km in re.finditer(r"[^,\s]+", m.group(3))]
        if lname not in _CITE_KNOWN:
            line = _line_of(s, m.start())
            col = m.start() - s.rfind("\n", 0, m.start())
            unknown_cites.append((name, line, col))
        if lname == "nocite":
            # \nocite{*} = 整库；具体 key 仍要核
            if any(key.strip() == "*" for _off, key in keys):
                nocite_all = True
        for off, key in keys:
            if key == "*":
                continue
            offset = m.start(3) + off
            line = _line_of(s, offset)
            col = offset - s.rfind("\n", 0, offset)
            cites.append((key, line, col))

    figures: list[tuple[str, int]] = []
    for m in _FIGURE_RE.finditer(s):
        figures.append((m.group(1).strip(), _line_of(s, m.start())))

    bib_files: list[str] = []
    for m in _BIBRES_RE.finditer(s):
        for part in m.group(1).split(","):
            part = part.strip()
            if part:
                if part.lower().endswith(".bib") or "\\" not in part:
                    bib_files.append(part if part.lower().endswith(".bib") else part + ".bib")

    # ---- pass 3：上下标 ----
    _mask_scripts(masked)
    s = "".join(masked)

    # ---- pass 4：命令名与结构参数 ----
    out = list(s)
    adj = list(s)          # 邻接判据用；只把 \fact 标记抹掉，其它命令名保留
    bindings: dict[int, list[str]] = {}
    markers: list[tuple[str, int]] = []
    marker_groups: list[dict] = []

    def add_markers(ids: list[str], start: int, end: int,
                    next_only: bool = False) -> None:
        line = _line_of(s, start)
        for fid in ids:
            bindings.setdefault(line, []).append(fid)
            markers.append((fid, line))
        if marker_groups and not next_only:
            prev = marker_groups[-1]
            gap = s[prev["end"]:start]
            if (not prev.get("next_only")
                    and re.fullmatch(r"[\s,.;:，。；：、]*", gap)):
                prev["ids"].extend(ids)
                prev["end"] = end
                return
        marker_groups.append({"ids": list(ids), "end": end, "line": line,
                              "next_only": next_only})

    pos = 0
    while True:
        m = _CMD_RE.search(s, pos)
        if not m:
            break
        name = m.group(1)
        j = m.end()
        while True:
            k = _skip_ws(s, j)
            if k < len(s) and s[k] == "[":
                j = _balanced(s, k, "[", "]")
            else:
                break
            # 只吞一层可选项；再往后若还是 '[' 继续吞（如 \cite[a][b]{k}）
        if name == "fact":
            k = _skip_ws(s, j)
            if k < len(s) and s[k] == "{":
                end = _balanced(s, k, "{", "}")
                ids = [x.strip() for x in s[k + 1:end - 1].split(",") if x.strip()]
                # V3 的 \fact{ID}{value}：第二个参数是**要渲染的数字**，必须留在
                # 扫描流里参与数字审计；只抹掉命令名与 ID 参数。
                k2 = _skip_ws(s, end)
                has_body = k2 < len(s) and s[k2] == "{"
                if has_body:
                    body_end = _balanced(s, k2, "{", "}")
                    add_markers(ids, m.start(), body_end)
                    _blank(out, m.start(), end)
                    _blank(adj, m.start(), end)
                    pos = body_end
                else:
                    # 单参数标记的两种惯例：`10/16\fact{A1}`（token 在前，v1）
                    # 与 `\fact{A1}10/16`（token 紧随其后，V3）。看紧跟的
                    # 非空白字符是不是数字来决定「向后绑定」。
                    nxt = _skip_ws(s, end)
                    next_only = nxt < len(s) and s[nxt].isdigit()
                    add_markers(ids, m.start(), end, next_only=next_only)
                    _blank(out, m.start(), end)
                    _blank(adj, m.start(), end)
                    pos = end
                continue
        # 宏定义：名字组 + [参数个数] + [默认值] + 宏体整段吞掉。
        # 参数个数 [1] 是结构，不是正文数字；不吞掉会让 \tableinput 的
        # `[1]` 变成一条假数字（内部 B1 的噪声来源）。
        if name in _MACRO_DEF_CMDS:
            if name == "def":
                k = s.find("{", j)
                j2 = _balanced(s, k, "{", "}") if k >= 0 else j
                _blank(out, m.start(), j2)
                pos = max(j2, m.end())
                continue
            j2 = j
            k = _skip_ws(s, j2)
            if k < len(s) and s[k] == "{":
                j2 = _balanced(s, k, "{", "}")
            elif k < len(s) and s[k] == "\\":
                m2 = _CMD_RE.match(s, k)
                if m2:
                    j2 = m2.end()
            while True:
                k = _skip_ws(s, j2)
                if k < len(s) and s[k] == "[":
                    j2 = _balanced(s, k, "[", "]")
                elif k < len(s) and s[k] == "{":
                    j2 = _balanced(s, k, "{", "}")
                else:
                    break
            _blank(out, m.start(), j2)
            pos = max(j2, m.end())
            continue
        # 引用家族（含未知 *cite*）：命令名 + 可选参数 + key 参数整段吞掉
        if "cite" in name.lower():
            k = _skip_ws(s, j)
            if k < len(s) and s[k] == "{":
                end = _balanced(s, k, "{", "}")
                _blank(out, m.start(), end)
                pos = end
                continue
        count = _SKIP_ARGS.get(name, 0)
        if count:
            j2 = j
            for _ in range(count):
                k = _skip_ws(s, j2)
                if k < len(s) and s[k] == "{":
                    j2 = _balanced(s, k, "{", "}")
                else:
                    break
            _blank(out, m.start(), j2)
            pos = max(j2, m.end())
            continue
        # 普通命令：只抹命令名本身（吃掉 \foo2 里的数字）
        _blank(out, m.start(), m.end())
        pos = m.end()

    masked2 = "".join(out)
    adjacency_text = "".join(adj)

    # ---- pass 5：[[fact:A1]] 形式 ----
    chars = list(masked2)
    for m in _WIKI_FACT_RE.finditer(masked2):
        ids = [x.strip() for x in m.group(1).split(",") if x.strip()]
        add_markers(ids, m.start(), m.end())
        _blank(chars, m.start(), m.end())
    masked2 = "".join(chars)

    return ScanResult(masked=masked2, bindings=bindings, markers=markers,
                      cites=cites, nocite_all=nocite_all,
                      unknown_cites=unknown_cites,
                      bib_files=bib_files, figures=figures,
                      annotations=annotations, annotation_args=annotation_args,
                      marker_groups=marker_groups, adjacency=adjacency_text)


# --------------------------------------------------------------------------
# 可审计内容判定（UNSCANNED_TEX 的噪声豁免，批 135）
#
# 闭包外的 `.tex` 一律报「未扫描」是噪声：只含导言区命令与 `\input` 的主
# 文件没东西可扫。豁免口径写死：去掉注释、去掉 `\begin{document}` 之前
# 的一切之后，须**同时**满足——
#   1. 正文为空或只剩空白/命令（结构参数不算正文）；
#   2. 没有阿拉伯数字 token（口径同 `_extract_numbers`：命令参数不算）；
#   3. 没有 `\fact{}`、没有 `\cite` 家族、没有 `\label`/`\ref` 家族。
# 任一条不满足而文件又不在闭包里 → 照旧报黄（fail-closed 不变）。
# --------------------------------------------------------------------------

_DOC_BEGIN_RE = re.compile(r"\\begin\s*\{document\}")
_DOC_END_RE = re.compile(r"\\end\s*\{document\}")
# `\fact` / `\cite` 家族 / `\label`/`\ref` 家族：出现即有可审计内容
_CONTENT_CMD_RE = re.compile(
    r"\\([A-Za-z]*[Cc]ite[A-Za-z]*|fact|label|ref|eqref|pageref|autoref|"
    r"cref|Cref|nameref|vref)\b")
# 一次抹掉「命令名 + 紧随其后的可选/必选参数」；反复跑到不动点，即可
# 从内向外吃掉嵌套花括号。
_STRUCT_CMD_RE = re.compile(r"\\[A-Za-z]+\*?\s*(?:\{[^{}]*\}|\[[^\[\]]*\])*")


def _document_body(tex: str) -> str:
    """正文区：`\\begin{document}` 之后、`\\end{document}` 之前。

    没有 `\\begin{document}` 的文件（`\\input` 的章节件）整份都是正文。
    """
    m = _DOC_BEGIN_RE.search(tex)
    body = tex[m.end():] if m else tex
    e = _DOC_END_RE.search(body)
    return body[:e.start()] if e else body


def _only_structural_left(text: str) -> bool:
    """抹掉全部命令与其参数后是否已无正文（空白/命令以外的字符都算正文）。"""
    s = text
    while True:
        nxt = _STRUCT_CMD_RE.sub(" ", s)
        if nxt == s:
            return not s.strip()
        s = nxt


def has_auditable_content(tex: str) -> bool:
    """该 `.tex` 是否有可审计内容（无内容时 `UNSCANNED_TEX` 不报）。"""
    body = _document_body(strip_comments_and_verbatim(tex))
    if not body.strip():
        return False
    for m in _CONTENT_CMD_RE.finditer(body):
        if m.group(1) not in _CITE_IGNORE:
            return True
    scan = scan_tex(body)
    if _NUM_RE.search(scan.masked):
        return True
    return not _only_structural_left(body)


# --------------------------------------------------------------------------
# 结构性 token 白名单（PDF 回检用；全部在源文件解析阶段推导）
#
# PDF 里的章节号、浮动体编号、页码、参考文献年份不是正文定量断言，却会被
# P-05 的多重集判成「账外数字」。这里从源文件算出它们的**允许形态**：
#   - 章节号：\section/\subsection/\subsubsection 的实际层级与顺序；
#   - 浮动体：figure/table/公式环境的计数，产出 1..N；
#   - 年份：refs.bib 的 year 字段；
#   - 页码：由 PDF 实际页数在 pdfgate 侧补 1..P。
# 只进 PDF 比对的白名单，不进 number_ledger，也不影响 check。
# --------------------------------------------------------------------------

_INPUT_REF_RE = re.compile(r"\\(?:input|include|subfile)\s*\{([^{}]*)\}")
_FLOAT_COUNT_RE = re.compile(
    r"\\begin\{(figure\*?|table\*?|equation|align|eqnarray|gather|multline)\}")
_YEAR_RE = re.compile(r"(?<!\d)(?:19|20)\d{2}(?!\d)")


def _document_texts(sections: list[tuple[str, str]],
                    root_tex: str | None = None):
    """按 `\\input/\\include` 编译顺序产出清理后的文本块（含父文件上下文）。

    `Config.load_sections` 返回的列表按文件名排序，不是编译顺序；章节号
    必须按后者算。父文件在 `\\input` 前后的内容要分别落在子文件两侧——
    `\\appendix` 的位置因此才不会被搬到开头。根文件不可得时退回文件名顺序。
    """
    by_rel = {rel: text for rel, text in sections}

    def _resolve(ref: str, base_rel: str) -> str | None:
        ref = ref.strip()
        if not ref or "\\" in ref or "#" in ref:
            return None
        base = posixpath.dirname(base_rel)
        for cand in (posixpath.normpath(posixpath.join(base, ref)),
                     posixpath.normpath(ref)):
            for name in (cand, cand + ".tex"):
                if name in by_rel:
                    return name
        return None

    seen: set[str] = set()

    def _walk(rel: str):
        if rel in seen or rel not in by_rel:
            return
        seen.add(rel)
        clean = strip_comments_and_verbatim(by_rel[rel])
        pos = 0
        for m in _INPUT_REF_RE.finditer(clean):
            yield clean[pos:m.start()]
            target = _resolve(m.group(1), rel)
            if target is not None:
                yield from _walk(target)
            pos = m.end()
        yield clean[pos:]

    if root_tex and root_tex in by_rel:
        yield from _walk(root_tex)
    for rel in sorted(by_rel):
        if rel not in seen:
            yield from _walk(rel)


def section_number_tokens(sections: list[tuple[str, str]],
                          root_tex: str | None = None) -> list[str]:
    """按 LaTeX 规则算出会被排版出来的章节号（不含星号节与附录字母）。"""
    counters = [0, 0, 0]
    appendix = False
    tokens: list[str] = []
    for clean in _document_texts(sections, root_tex):
        events = re.finditer(
            r"\\appendix\b|\\(section|subsection|subsubsection)(\*?)"
            r"\s*(?:\[[^\]]*\])?\s*\{", clean)
        for m in events:
            if m.group(0).startswith("\\appendix"):
                appendix = True
                continue
            level_name, starred = m.group(1), m.group(2)
            if starred:
                continue          # \section* 不编号，也不推进计数器
            if appendix:
                continue          # \appendix 之后是 A/B，不是数字 token
            if level_name == "section":
                counters[0] += 1
                counters[1] = counters[2] = 0
                tokens.append(str(counters[0]))
            elif level_name == "subsection":
                counters[1] += 1
                counters[2] = 0
                tokens.append("%d.%d" % (counters[0], counters[1]))
            else:
                counters[2] += 1
                tokens.append("%d.%d.%d" % tuple(counters))
    return tokens


def float_number_tokens(sections: list[tuple[str, str]],
                        root_tex: str | None = None) -> list[str]:
    """figure/table/公式环境的编号：按最大计数器产出 1..N。

    同名计数器在 LaTeX 里各自递增；PDF 只剩裸数字，故取各类计数的最大值
    做上界（1..N 覆盖所有可能的编号）。`equation*`/`align*` 不编号，不计数。
    """
    counts = {"figure": 0, "table": 0, "math": 0}
    for clean in _document_texts(sections, root_tex):
        for m in _FLOAT_COUNT_RE.finditer(clean):
            env = m.group(1)
            if env.startswith("figure"):
                counts["figure"] += 1
            elif env.startswith("table"):
                counts["table"] += 1
            else:
                counts["math"] += 1
    return [str(i) for i in range(1, max(counts.values()) + 1)]


def bib_year_tokens(bib_entries) -> list[str]:
    """refs.bib 里所有 4 位年份（只认 year 字段）。"""
    years: set[str] = set()
    for entry in bib_entries or []:
        fields = getattr(entry, "fields", None) or {}
        for m in _YEAR_RE.finditer(str(fields.get("year") or "")):
            years.add(m.group(0))
    return sorted(years)


def structural_whitelist(sections: list[tuple[str, str]],
                         bib_entries=(), root_tex: str | None = None) -> dict:
    """PDF 回检的结构性白名单（页码由 pdfgate 按实际页数补齐）。"""
    return {
        "sections": section_number_tokens(sections, root_tex),
        "floats": float_number_tokens(sections, root_tex),
        "years": bib_year_tokens(bib_entries),
    }


def _extract_numbers(masked: str, original: str) -> list[dict]:
    orig_lines = original.split("\n")
    out = []
    offset = 0
    for ln, line in enumerate(masked.split("\n"), 1):
        toks: list[dict] = []
        for m in _NUM_RE.finditer(line):
            raw, suffix, pct = m.group(1), m.group(2) or "", bool(m.group(3))
            item = {
                "raw": raw,
                "suffix": suffix,
                "pct": pct,
                "key": number_key(raw, suffix or None, pct),
                "line": ln,
                "col": m.start(1) + 1,
                "end": m.end(),
                "start_abs": offset + m.start(1),
                "end_abs": offset + m.end(),
                "text": orig_lines[ln - 1].strip() if ln - 1 < len(orig_lines) else "",
            }
            # 千分位合并：1<THIN>000<THIN>000 -> 1000000（只合并 3 位整数段）
            if toks:
                prev = toks[-1]
                gap = line[prev["end"]:m.start(1)]
                if (gap and set(gap) <= {THIN}
                        and not prev["suffix"] and not prev["pct"]
                        and not suffix and not pct
                        and re.fullmatch(r"\d{3}", raw)):
                    prev["raw"] += raw
                    prev["end"] = m.end()
                    prev["end_abs"] = offset + m.end()
                    prev["key"] = number_key(prev["raw"])
                    continue
            toks.append(item)
        for it in toks:
            out.append({
                "token": it["raw"] + it["suffix"] + ("%" if it["pct"] else ""),
                "key": it["key"],
                "line": it["line"],
                "col": it["col"],
                "text": it["text"],
                "start_abs": it["start_abs"],
                "end_abs": it["end_abs"],
                "raw": it["raw"],
                "suffix": it["suffix"],
                "pct": it["pct"],
            })
        offset += len(line) + 1
    return out


def _merge_number_units(nums: list[dict], masked: str) -> list[dict]:
    """把 `10/16` 的两个抽取片段合并成一个 QUANT 单元（R-01 FRAC）。

    抽取层为了兼容旧读数保留「分子、分母各一个 token」；归属判定必须按
    一个分数整体算（否则 `5/16` 会变成两个可被并集吞下的数）。
    """
    units: list[dict] = []
    i = 0
    while i < len(nums):
        tok = nums[i]
        if i + 1 < len(nums):
            nxt = nums[i + 1]
            gap = masked[tok["end_abs"]:nxt["start_abs"]]
            if (re.fullmatch(r"\s*/\s*", gap or "")
                    and re.fullmatch(r"\d+", tok["raw"])
                    and re.fullmatch(r"\d+", nxt["raw"])):
                raw = tok["raw"] + "/" + nxt["raw"]
                units.append({
                    "token": raw,
                    "keys": [tok["key"], nxt["key"]],
                    "canon": canon_text(raw),
                    "line": tok["line"],
                    "col": tok["col"],
                    "text": tok["text"],
                    "start_abs": tok["start_abs"],
                    "end_abs": nxt["end_abs"],
                    "tokens": [tok, nxt],
                })
                i += 2
                continue
        units.append({
            "token": tok["token"],
            "keys": [tok["key"]],
            "canon": tok["key"],
            "line": tok["line"],
            "col": tok["col"],
            "text": tok["text"],
            "start_abs": tok["start_abs"],
            "end_abs": tok["end_abs"],
            "tokens": [tok],
        })
        i += 1
    return units


_ABBREV = {"et al", "fig", "eq", "sec", "vs", "e.g", "i.e", "approx",
           "no", "ref", "dr", "mr", "mrs", "ms", "prof"}


def sentence_spans(text: str) -> list[tuple[int, int]]:
    """R-02 的切句：BU 是句子，不是物理行。

    只在句末标点＋守卫成立时切；中文句末符总是切。行尾单独一个 ``\\\\``
    也切。空行切。这样「标记只闭合自己那一句」——同一行另一句里的数字
    不会再被行级绑定顺带背书（内部 B3）。
    """
    spans: list[tuple[int, int]] = []
    start = 0
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        boundary = False
        skip = 1
        if c == "\\" and i + 1 < n and text[i + 1] == "\\":
            boundary = True
            skip = 2
        elif c in "。！？；":
            boundary = True
        elif c in ".!?;":
            prev = text[i - 1] if i > 0 else ""
            nxt = text[i + 1] if i + 1 < n else ""
            if prev.isdigit() and nxt.isdigit():
                boundary = False
            elif nxt and not nxt.isspace():
                boundary = False
            elif prev.isupper() and (i < 2 or text[i - 2].isspace()
                                     or text[i - 2] in "([\"'"):
                boundary = False
            else:
                w = re.search(r"([A-Za-z.]+)$", text[start:i])
                word = w.group(1).lower().rstrip(".") if w else ""
                boundary = word not in _ABBREV
        elif c == "\n":
            if re.match(r"[^\S\n]*\n", text[i + 1:]):
                boundary = True
        if boundary:
            spans.append((start, i + skip))
            start = i + skip
            i += skip
            continue
        i += 1
    if start < n:
        spans.append((start, n))
    if not spans:
        spans = [(0, 0)]
    return spans


def sentence_index(spans: list[tuple[int, int]], pos: int) -> int:
    for idx, (s, e) in enumerate(spans):
        if s <= pos < e:
            return idx
    return len(spans) - 1
