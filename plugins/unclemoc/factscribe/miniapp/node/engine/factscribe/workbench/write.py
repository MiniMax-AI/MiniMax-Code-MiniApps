# -*- coding: utf-8 -*-
"""工作台段二：写回与章节管理（唯一的落盘入口）。

前端与 CLI 都只调这一层。硬规矩四条：

1. **只写正文**：只写盘里 `sections/` 下的 `.tex`，以及根文件（`main.tex`）的
   装配行；`facts/`、`audit/`、`results/` 一律只读——事实账与证据链不归工作台管。
2. **原子写**：同目录写 `.tmp` 再 `rename` 覆盖；原文件权限原样保留；
   每次保存前把原文件复制成同目录 `.bak`；正文保存留**多份**（`.bak` 是上一版、
   `.bak.1` 是上上版……轮转不互相覆盖），配置文件只留固定名那一份。
3. **保护面**（硬要求）：`\\fact{}`、`\\cite{}`、`\\ref{}` 等命令与其参数，
   以及与 `\\fact` 绑定的数字令牌，写回时原样保留——用户改散文改不掉它们。
   用户把芯片删掉了也不要紧：写回时按原文的相对次序补回来（见 `_rebuild`）。
4. **删除可逆**：删章节＝从装配移除＋把文件挪到 `sections/attic/`，不真删。

保护面的口径（写在这里，代码注释与文档同源）：

* **命令级**：凡是带参数的 LaTeX 命令（`\\fact`、`\\cite`、`\\ref`、`\\label`、
  `\\textbf`…）连同参数整体原样保留；
* **环境级**：`figure/table/tabular/equation/align/verbatim` 等整块保留；
  `abstract/itemize/enumerate` 只保留 `\\begin`/`\\end` 标记，里面照常可改；
* **数字级**：紧跟在 `\\fact{ID}` 标记前的那个数字（可以有空白或 `~`）＝
  **已绑定数字令牌**，原样保留；账本里同一条 fact 的 `value` 在本段里再出现
  也按绑定令牌处理。
"""
from __future__ import annotations

import os
import re
import shutil
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .. import i18n
from ..config import ConfigError, load_config, load_facts
from .projects import (ABSTRACT_BLOCK_ID as _ABSTRACT_BLOCK_ID,
                       CONFIG_NAME, TOKEN_CLOSE, TOKEN_OPEN, TOKEN_RE,
                       abstract_env_span as _abstract_env_span,
                       abstract_prose as _abstract_prose,
                       bound_values_of as _bound_values_of,
                       render_abstract_html as _render_abstract_html,
                       render_prot_html as _render_prot_html, render_tex,
                       short_sha as _short_sha)

#: 章节删除后的归档目录名（放在章节文件所在目录下）。
ATTIC_DIR = "attic"

#: 正文与主文件的备份保留份数（.bak ＋ .bak.1 … .bak.9）。
#: 「原稿留在 .bak」仍成立（.bak ＝ 上一版）；更早的几代在 .bak.1、.bak.2……
#: 轮转保留，**不互相覆盖**——连续存两次也不会把最初的原稿弄丢。
BACKUP_KEEP = 10
#: 配置文件（factscribe.toml）的备份只留固定名那一份：「打开磁盘」这个动作
#: 本身就会写一次配置，留多份会在盘上堆垃圾——这条既有副作用保持原样。
CONFIG_BACKUP_KEEP = 1

#: 整块保留的环境（内容不是散文）。
SOLID_ENVS = {
    "figure", "figure*", "table", "table*", "tabular", "tabular*",
    "equation", "equation*", "align", "align*", "gather", "multline",
    "verbatim", "lstlisting", "minted", "tikzpicture", "thebibliography",
}

#: 命令类别：决定芯片上的标签与图标。
CMD_KIND = {
    "fact": "fact",
    "label": "ref", "ref": "ref", "eqref": "ref", "pageref": "ref",
    "autoref": "ref", "cref": "ref", "Cref": "ref", "crefrange": "ref",
    "vref": "ref", "nameref": "ref", "hyperref": "ref",
    "cite": "cite", "citep": "cite", "citet": "cite", "Cite": "cite",
    "citealp": "cite", "citealt": "cite", "citeauthor": "cite",
    "citeyear": "cite", "citeyearpar": "cite", "parencite": "cite",
    "textcite": "cite", "autocite": "cite", "footcite": "cite",
    "nocite": "cite",
}

_NUM_RE = re.compile(r"\d+(?:[.,]\d+)*(?:/\d+(?:[.,]\d+)*)?(?:\\?%)?")
_CMD_RE = re.compile(r"\\([A-Za-z@]+)\*?")
_INPUT_RE = re.compile(r"\\(input|include)\s*\{([^}]*)\}")

#: 保护面序号对不上（客户端 DOM 是旧版本渲染的）→ 拒写，不静默丢保护面。
#: 直写通道用 EDIT_…，提议通道用 PROPOSAL_…（与形状闸同一套命名口径）。
TOKEN_MISMATCH_CODE = "EDIT_TOKEN_MISMATCH"


# ---------------------------------------------------------------- 段模型

@dataclass
class Segment:
    """一段：普通散文（kind=text）或保护面（kind=prot）。"""

    kind: str
    text: str
    index: int = -1
    label: str = ""


@dataclass
class Block:
    """一次编辑的落点：哪个文件、哪一段、原文是什么。"""

    file: str
    block_id: str
    kind: str
    start: int
    end: int
    raw: str
    title: str = ""
    segments: list = field(default_factory=list)
    #: AI 草稿块的整块区间（含标记行）——删除时用；普通段是 -1。
    region_start: int = -1
    region_end: int = -1


# ---------------------------------------------------------------- 保护面扫描

def _match_braces(text: str, start: int, end: int) -> int:
    """text[start] == '{' → 返回配对 '}' 之后的下标（找不到就返回 end）。"""
    depth = 0
    index = start
    while index < end:
        char = text[index]
        if char == "\\":
            index += 2
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index + 1
        index += 1
    return end


def _parse_command(text: str, start: int, end: int):
    """解析一个命令：返回 (名字, 参数区间列表, 结束下标)；不是命令就 None。"""
    match = _CMD_RE.match(text, start)
    if not match or match.end() > end:
        return None
    name = match.group(1)
    index = match.end()
    while index < end and text[index] in " \t":
        index += 1
    if index < end and text[index] == "[":
        close = text.find("]", index)
        index = end if close < 0 else close + 1
    args: list[tuple[int, int]] = []
    while True:
        probe = index
        while probe < end and text[probe] in " \t":
            probe += 1
        if probe < end and text[probe] == "{":
            stop = _match_braces(text, probe, end)
            args.append((probe, stop))
            index = stop
            continue
        break
    return name, args, index


def _env_name(text: str, args: list) -> str:
    if not args:
        return ""
    start, stop = args[0]
    return text[start + 1:stop - 1].strip() if stop - 1 > start else ""


def _norm_number(text: str) -> str:
    """数字归一：去空白、去千分位逗号、去 `\\%` 的反斜杠。"""
    out = str(text or "").replace("\\", "")
    out = re.sub(r"(?<=\d),(?=\d)", "", out)
    return out.replace(" ", "")


def scan(text: str, bound_values=frozenset()) -> list[Segment]:
    """把一段 LaTeX 切成 [散文|保护面] 序列。

    `bound_values` 是账本里出现过的 fact value（归一后）；出现在本段里的
    同值数字按「已绑定数字令牌」处理。
    """
    segments = _scan_commands(text, 0, len(text))
    segments = _protect_numbers(segments, bound_values)
    index = 0
    out: list[Segment] = []
    for seg in segments:
        if seg.kind != "prot":
            out.append(seg)
            continue
        seg.index = index
        index += 1
        out.append(seg)
    return out


def _scan_commands(text: str, start: int, end: int) -> list[Segment]:
    """第一遍：命令 / 数学 / 环境层面的保护面。"""
    out: list[Segment] = []
    buffer: list[str] = []
    index = start

    def flush() -> None:
        if buffer:
            out.append(Segment("text", "".join(buffer)))
            buffer.clear()

    while index < end:
        char = text[index]
        if char == "\\":
            parsed = _parse_command(text, index, end)
            if parsed is None:
                # 不是命令＝转义字符（\%、\\、\&、\$_…）：反斜杠连下一个字符
                # 一起当普通文本。**否则 \% 会被当成注释开头**，把这一行
                # 剩下的东西（连同里面的 \cite）整段吞成「注释」保护面。
                buffer.append(char)
                index += 1
                if index < end:
                    buffer.append(text[index])
                    index += 1
                continue
            name, args, stop = parsed
            # 环境：整块保留 or 只留标记。
            if name == "begin" and args:
                env = _env_name(text, args)
                close = _find_env_end(text, stop, end, env)
                if env in SOLID_ENVS and close is not None:
                    flush()
                    out.append(Segment("prot", text[index:close], label="env"))
                    index = close
                    continue
            flush()
            label = CMD_KIND.get(name, "cmd" if args else "")
            out.append(Segment("prot", text[index:stop], label=label or "cmd"))
            index = stop
            continue
        if char == "$":
            stop = _find_math_end(text, index, end)
            if stop is not None:
                flush()
                out.append(Segment("prot", text[index:stop], label="math"))
                index = stop
                continue
        if char == "%":
            # 注释：整段留白（写回时原样保留，不让用户改坏注释）
            stop = text.find("\n", index)
            stop = end if stop < 0 else stop
            flush()
            out.append(Segment("prot", text[index:stop], label="comment"))
            index = stop
            continue
        buffer.append(char)
        index += 1
    flush()
    return out


def _find_math_end(text: str, start: int, end: int):
    """`$…$` / `\\[…\\]` / `\\(…\\)` 的结束下标；找不到返回 None。"""
    if text.startswith("\\[", start):
        stop = text.find("\\]", start + 2)
        return None if stop < 0 else stop + 2
    if text.startswith("\\(", start):
        stop = text.find("\\)", start + 2)
        return None if stop < 0 else stop + 2
    if text.startswith("$$", start):
        stop = text.find("$$", start + 2)
        return None if stop < 0 else stop + 2
    probe = start + 1
    while probe < end:
        if text[probe] == "\\":
            probe += 2
            continue
        if text[probe] == "$":
            return probe + 1
        probe += 1
    return None


def _find_env_end(text: str, start: int, end: int, env: str):
    """找 `\\end{env}` 的下标（从 start 起）。"""
    if not env:
        return None
    pattern = re.compile(r"\\end\s*\{" + re.escape(env) + r"\}")
    match = pattern.search(text, start, end)
    return match.end() if match else None


def _protect_numbers(segments: list[Segment], bound_values) -> list[Segment]:
    """第二遍：数字令牌。

    * 紧跟在 `\\fact{…}` 标记前的数字（中间只允许空白或 `~`）＝绑定令牌；
    * 账本里同条 fact 的 value 在本段再出现，也按绑定令牌处理。
    """
    values = {_norm_number(v) for v in (bound_values or ()) if str(v).strip()}
    out: list[Segment] = []
    for seg in segments:
        if seg.kind != "text":
            out.append(seg)
            continue
        out.append(seg)
    # 规则一：紧跟 fact 标记的数字。
    result: list[Segment] = []
    for seg in out:
        if seg.kind == "prot" and seg.label == "fact" and result:
            prev = result[-1]
            if prev.kind == "text":
                pieces = _split_trailing_number(prev.text)
                if pieces is not None:
                    before, number, after = pieces
                    result.pop()
                    if before:
                        result.append(Segment("text", before))
                    result.append(Segment("prot", number, label="num"))
                    if after:
                        result.append(Segment("text", after))
        result.append(seg)
    # 规则二：账本同值数字。
    final: list[Segment] = []
    for seg in result:
        if seg.kind != "text" or not values:
            final.append(seg)
            continue
        pieces: list[Segment] = []
        cursor = 0
        for match in _NUM_RE.finditer(seg.text):
            if _norm_number(match.group(0)) not in values:
                continue
            if match.start() > cursor:
                pieces.append(Segment("text", seg.text[cursor:match.start()]))
            pieces.append(Segment("prot", match.group(0), label="num"))
            cursor = match.end()
        if not pieces:
            final.append(seg)
            continue
        if cursor < len(seg.text):
            pieces.append(Segment("text", seg.text[cursor:]))
        final.extend(pieces)
    return final


def _split_trailing_number(text: str):
    """末尾是数字（后面只跟空白/波浪号）→ 返回 (前, 数字, 后)；否则 None。"""
    matches = list(_NUM_RE.finditer(text))
    if not matches:
        return None
    match = matches[-1]
    gap = text[match.end():]
    if gap.strip(" \t~ ") != "":
        return None
    return text[:match.start()], match.group(0), gap


# ---------------------------------------------------------------- 写回

def _warn(key: str, params: dict | None = None) -> dict:
    """一条告警：展示层（key ＋ params）＋ 契约层（中文原话）两层一体。

    中文原话由目录渲染（同一个 key），所以两层不会漂；warnings 字段
    仍然是 list[str]（形状不动），展示层另走 display.warnings。
    """
    params = dict(params or {})
    return {"text": i18n.render(key, params, "zh", i18n.WORKBENCH_MESSAGES),
            "key": str(key), "params": params}


def _warn_texts(warnings) -> list[str]:
    """告警列表 → 契约层的中文原话（形状不变：list[str]）。"""
    return [str((w or {}).get("text") or "") for w in warnings or []]


def _warn_parts(warnings) -> list[dict]:
    """告警列表 → 展示层文案（key ＋ params，按界面语言渲染）。"""
    return [{"key": str((w or {}).get("key") or ""),
             "params": dict((w or {}).get("params") or {})}
            for w in warnings or []]


def _rebuild(segments: list[Segment], client_text: str,
             code: str = TOKEN_MISMATCH_CODE) -> tuple[str, list[dict]]:
    """把客户端改后的文本与保护面拼回 LaTeX。

    返回 (新文本, 告警列表)。规则：

    * 客户端把某个保护面删了 → 按原文的相对次序**补回来**（改不掉）；
    * 客户端在散文里**原样抄回**原文的保护面 → 认回来（当成本来的那个，
      不当新写的），保证「保护面逐字相同」时写回是字节级一致的；
    * 客户端在散文里塞了**原文没有**的 `\\fact{…}`/`\\cite{…}`/`\\ref{…}` →
      **剥掉**（不许凭空造账本绑定），并记一条告警；
    * 客户端把保护面挪了位置 → 保留客户端的顺序（挪引用是合法的散文编辑）。
    """
    warnings: list[dict] = []
    regions = [seg for seg in segments if seg.kind == "prot"]
    by_index = {seg.index: seg for seg in regions}

    parts = TOKEN_RE.split(client_text or "")
    # TOKEN_RE 有一个捕获组 → split 的结果是 [散文, 编号, 散文, 编号, …]：
    # 偶数位是散文，奇数位是保护面的编号。
    items: list[tuple[str, object]] = []
    seen: list[int] = []
    # 客户端这一轮**用占位符认领着**的保护面（它的 DOM 里还在的那些）。
    sent = {int(parts[position]) for position in range(1, len(parts), 2)
            if parts[position] is not None}
    for position in range(0, len(parts), 2):
        free = parts[position]
        token = parts[position + 1] if position + 1 < len(parts) else None
        if free:
            # 先认回「原样抄回」的保护面，剩下的才当散文处理。
            for kind, value in _absorb_verbatim(free, regions, seen,
                                                         sent):
                if kind == "text":
                    clean, dropped = _strip_injected(value)
                    if dropped:
                        warnings.append(
                            _warn("wb.warn.protect.injected", {"dropped": dropped}))
                    if clean:
                        items.append(("text", clean))
                else:
                    items.append(("prot", value))
        if token is None:
            continue
        index = int(token)
        seg = by_index.get(index)
        if seg is None:
            # 占位符序号在**当前**扫描里不存在——客户端那份 DOM 是旧版本
            # 渲染的：正文里插一个字，绑定数字令牌可能整段消失，后面所有
            # 保护面序号都往前挪一位（实测：正文 `…at 0/3\\fact{E5}` 里插
            # 探针，`0/3` 不再是绑定令牌，`\\fact{E5}` 的序号从 1 变成 0）。
            #
            # 旧口径在这里是 `continue`：**静默丢掉这枚保护面**，用户没打过
            # 的字就此被改掉（条目 43 的 BLOCK_STALE 安全网本该拦住这件事，
            # 是客户端提前推进了块指纹才漏过去）。现在改成**拒写**：宁可这
            # 一轮不落盘，也不改用户的内容。
            raise ConfigError(
                "这一段在别处被改动过（保护面序号对不上），没有保存——"
                "请重新载入这一段再改。", code=code)
        if index in seen:
            warnings.append(_warn("wb.warn.protect.duplicate"))
            continue
        seen.append(index)
        items.append(("prot", seg))

    # 缺失的保护面按原文位置补回来。
    missing = [seg for seg in regions if seg.index not in seen]
    for seg in missing:
        spot = _anchor_spot(segments, seg, items)
        if spot is None:
            position = len(items)
            for offset, item in enumerate(items):
                if item[0] == "prot" and item[1].index > seg.index:
                    position = offset
                    break
            items.insert(position, ("prot", seg))
        else:
            index, cut = spot
            text = str(items[index][1])
            items[index] = ("text", text[:cut])
            items.insert(index + 1, ("prot", seg))
            if text[cut:]:
                items.insert(index + 2, ("text", text[cut:]))
        label = str(seg.label or "")
        if label:
            warnings.append(_warn("wb.warn.protect.restored", {"label": label}))
        else:
            warnings.append(_warn("wb.warn.protect.restoredGeneric"))

    return "".join(item[1].text if item[0] == "prot" else str(item[1])
                   for item in items), warnings


def _surface_of(segments: list[Segment]) -> list[str]:
    """保护面里「命令类」的原文清单（不含派生出来的绑定数字令牌）。

    绑定数字令牌（num）是**派生**的：正文里插一个字，它可能整段消失或出
    现——那是合法编辑，不该拦。命令类（\\fact{} / \\cite{} / 公式 / 环境 /
    注释……）是文件里既有的内容：客户端删了，服务端按原位补回，**绝不该
    在一次保存里凭空消失**。
    """
    return [seg.text for seg in segments
            if seg.kind == "prot" and seg.label != "num"]


def _lost_surface(before: list[Segment], new_raw: str,
                  bound_values) -> list[str]:
    """重建之后丢了哪些命令类保护面（按出现次数比，顺序不算）。"""
    need = Counter(_surface_of(before))
    have = Counter(_surface_of(scan(new_raw, bound_values)))
    lost: list[str] = []
    for text, count in need.items():
        gap = count - have.get(text, 0)
        if gap > 0:
            lost.extend([text] * gap)
    return lost


def _guard_surface_kept(before: list[Segment], new_raw: str,
                         bound_values, code: str) -> None:
    """保护面不许丢：重建后少了一枚命令类保护面 → 拒写。

    这道是「保存不许改内容」的兜底：客户端那份 DOM 若是旧版本渲染的，占位
    符序号会整体错位，重建出来的正文会把某枚 \\fact{}/\\cite{} 换成别的内容
    （用户没打过的字被改掉）。宁可这一轮不落盘——落盘是不可逆的内容改动。
    """
    lost = _lost_surface(before, new_raw, bound_values)
    if not lost:
        return
    raise ConfigError(
        "这一段在别处被改动过（保护面会丢：%s），没有保存——"
        "请重新载入这一段再改。" % "、".join(lost[:3]), code=code)


def _anchor_spot(segments: list[Segment], seg: Segment,
                 items: list) -> tuple[int, int] | None:
    """被删掉的保护面补回到哪里：找原文里的锚（前一段散文的尾巴）。

    返回 (条目下标, 该条目内的切分位置)；找不到锚就返回 None（调用方退回
    「按保护面相对次序」插到下一个保护面之前）。

    锚点要连**它后面的空白**一起找：原文里芯片紧跟在这段空白之后，漏掉
    空白会把芯片插到空白前面（位置差一格：`见\\cite{x} 。`）。
    """
    anchor = ""
    for item in segments:
        if item is seg:
            break
        if item.kind == "text":
            anchor = item.text
    stripped = anchor.strip()
    tail = stripped[-24:] if len(stripped) > 24 else stripped
    if not tail:
        return None
    gap = anchor[len(anchor.rstrip()):]
    current = "".join(item[1].text if item[0] == "prot" else str(item[1])
                      for item in items)
    for probe in (tail + gap, tail):
        spot = current.rfind(probe)
        if spot < 0:
            continue
        target = spot + len(probe)
        offset = 0
        for index, item in enumerate(items):
            if item[0] != "text":
                length = len(item[1].text)
                if offset < target < offset + length:
                    return None          # 锚点落在保护面里：别切它
                offset += length
                continue
            length = len(str(item[1]))
            if offset + length > target:
                return index, max(0, target - offset)
            offset += length
    return None


def _absorb_verbatim(text: str, regions: list[Segment],
                     seen: list[int],
                     sent: set[int] | None = None) -> list[tuple[str, object]]:
    """把散文里**原样抄回**的保护面认回来。

    客户端有时不用占位符，而是把原文的保护面（`\\fact{A1}`、`\\cite{k}`…）
    原样抄回正文。这样的回写必须认成「原来的那个保护面」——若当成
    「凭空新写的命令」剥掉，再把原文的保护面补回来，就会写出重复内容
    （残渣）。认回来的判据是**逐字相同**：与某个原文保护面完全一致。

    返回 [("text", 片段) | ("prot", 保护面)]，按出现顺序。已被占位符认领过
    的保护面（`seen`）不再重复认领——多出来的那份照旧按「新写的」剥掉。

    **绑定数字令牌（num）不按文字认领**：它是**派生**的保护面（紧邻 \fact{}
    或与账本同值），字面在正文里本来就可能出现（正文写「还是 8 题」）。客户端
    **还认领着**这枚令牌（占位符还在）时，正文里同名的那份数字是**另一处**出现
    的同字面：按文字认领会把令牌搬到正文位置，芯片旁边的绑定数字整段消失——
    用户没打过的字被改掉。派生令牌只认占位符。
    客户端**没**用占位符认领它（把整份文件原样回传、或自己删了那枚芯片）时，
    仍然按文字认回来——否则服务端会把这枚令牌当成「被删了」补回来，数字变成
    两份。
    """
    out: list[tuple[str, object]] = []
    buffer: list[str] = []
    index = 0
    length = len(text)
    while index < length:
        best: Segment | None = None
        for seg in regions:
            if seg.index in seen or not seg.text:
                continue
            if seg.label == "num" and seg.index in (sent or set()):
                # 绑定数字令牌是**派生**的保护面（紧邻 \fact{} 或与账本同值），
                # 它的字面在正文里本来就可能出现（正文写「还是 8 题」）。
                # 按文字认领会把别处那枚令牌搬到正文位置：芯片旁边的绑定数字
                # 整段消失，用户没打过的字被改掉（实测：still gave 0/3\fact{E2}
                # 变成 still gave \fact{E2}）。派生令牌只认占位符，不认文字。
                continue
            if text.startswith(seg.text, index):
                # 同一位置命中多个时取最长的（短的可能嵌在长的里面）。
                if best is None or len(seg.text) > len(best.text):
                    best = seg
        if best is not None:
            if buffer:
                out.append(("text", "".join(buffer)))
                buffer.clear()
            out.append(("prot", best))
            seen.append(best.index)
            index += len(best.text)
            continue
        buffer.append(text[index])
        index += 1
    if buffer:
        out.append(("text", "".join(buffer)))
    return out


_INJECT_RE = re.compile(r"\\(fact|cite[a-zA-Z]*|ref|label|eqref|pageref|"
                        r"autoref|cref|Cref|hyperref)\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}")


def _strip_injected(text: str) -> tuple[str, str]:
    """剥掉正文里新写的保护类命令；返回 (剩下的文本, 剥掉的命令名)。"""
    dropped: list[str] = []

    def kill(match: re.Match) -> str:
        dropped.append("\\" + match.group(1))
        return ""

    return _INJECT_RE.sub(kill, text), "、".join(dropped)


def _balanced_ok(text: str) -> bool:
    """花括号配平（写回前自检：写坏了不许落盘）。"""
    depth = 0
    index = 0
    while index < len(text):
        char = text[index]
        if char == "\\":
            index += 2
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth < 0:
                return False
        index += 1
    return depth == 0


def backup_paths(path: Path, keep: int = 1) -> list:
    """备份文件名（沿用本盘既有命名风格）：<file>.bak、<file>.bak.1、…

    第 0 个是**固定名** `.bak`（既有的那一份——「原稿留在 .bak」指它）；
    后面的 `.bak.1`、`.bak.2`… 是更早的几代，轮转保留、**不互相覆盖**。
    """
    base = Path(path)
    names = [base.with_name(base.name + ".bak")]
    for index in range(1, max(1, int(keep or 1))):
        names.append(base.with_name(base.name + ".bak.%d" % index))
    return names


def atomic_write(path: Path, text: str, backup: bool = True,
                 keep: int = 1) -> dict:
    """原子写：同目录 `.tmp` → `rename`；保留原权限；先存 `.bak`。

    `.bak` 是「上一次保存前」的原文，同目录、固定名。
    ``keep`` > 1 时多留几代：`.bak`（上一版）、`.bak.1`（上上版）……
    轮转保留，**不互相覆盖**——正文保存走这条（见 :data:`BACKUP_KEEP`）。
    """
    path = Path(path)
    data = text.encode("utf-8")
    mode = None
    backup_path = ""
    backups: list = []
    if path.exists():
        try:
            mode = path.stat().st_mode & 0o7777
        except OSError:
            mode = None
        if backup:
            backups = backup_paths(path, keep)
            # 轮转：最老的那代被上一代顶掉，其余往后挪一位（.bak 始终是上一版）。
            for index in range(len(backups) - 1, 0, -1):
                older = backups[index - 1]
                newer = backups[index]
                if older.exists():
                    try:
                        os.replace(str(older), str(newer))
                    except OSError:
                        pass
            backup_path = str(backups[0])
            tmp_bak = path.with_name(path.name + ".bak.tmp-%d" % os.getpid())
            try:
                shutil.copyfile(str(path), str(tmp_bak))
                if mode is not None:
                    os.chmod(str(tmp_bak), mode)
                os.replace(str(tmp_bak), str(backup_path))
            finally:
                if tmp_bak.exists():
                    try:
                        tmp_bak.unlink()
                    except OSError:
                        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name("%s.tmp-%d" % (path.name, os.getpid()))
    try:
        with open(tmp, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        if mode is not None:
            os.chmod(str(tmp), mode)
        os.replace(str(tmp), str(path))
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
    return {"path": str(path), "backup": backup_path,
            "backups": [str(item) for item in backups]}


# ---------------------------------------------------------------- 段落定位

def _bound_values(disk_root: Path) -> set[str]:
    """盘里事实账上的 value（用于认「已绑定数字令牌」）。

    实现在渲染层（projects.bound_values_of）——渲染与写回共用同一份，
    保证 html 里烤的 token 与可编辑模型的 chips 口径一致。
    """
    return _bound_values_of(disk_root)


def _safe_section_file(disk_root: Path, rel: str) -> Path:
    """只许写盘里的**章节正文文件**。

    四道闸（段二硬约束「只写 sections 外的账本文件不许碰」）：

    1. 相对路径：不许绝对路径、不许 `..`；
    2. 不许越出盘根；
    3. 只写 `.tex`；
    4. 只写 `sections/` 下的（或配置 `sections` glob 命中的）文件——
       `facts/`、`audit/`、`results/` 一律只读。
    """
    from pathlib import PurePosixPath

    raw = str(rel or "").strip()
    pure = PurePosixPath(raw.replace("\\", "/"))
    if not raw or pure.is_absolute() or any(part == ".." for part in pure.parts):
        raise ConfigError("章节文件路径不合法：%s" % rel,
                          code="SECTION_PATH_INVALID")
    root = disk_root.resolve()
    target = disk_root.joinpath(*[p for p in pure.parts if p not in ("", ".")])
    try:
        inside = target.resolve().relative_to(root)
    except (OSError, ValueError):
        raise ConfigError("章节文件越出项目根：%s" % rel,
                          code="SECTION_PATH_INVALID")
    if target.suffix.lower() != ".tex":
        raise ConfigError("只写 .tex 章节文件：%s" % rel,
                          code="SECTION_PATH_INVALID")
    parts = inside.parts
    if parts and parts[0] in ("facts", "audit", "results", "runs"):
        raise ConfigError("账本与产物目录只读：%s" % rel,
                          code="SECTION_READONLY")
    glob = ""
    try:
        cfg = load_config(disk_root)
        glob = str(getattr(cfg, "sections_glob", "") or "")
    except (ConfigError, OSError, ValueError):
        glob = ""
    in_sections = bool(parts) and parts[0] == "sections"
    matched = False
    if glob:
        import fnmatch
        matched = fnmatch.fnmatchcase(inside.as_posix(), glob)
    if not (in_sections or matched):
        raise ConfigError("只写 sections/ 下的章节文件：%s" % rel,
                          code="SECTION_PATH_INVALID")
    return target


# ---------------------------------------------------------------- 摘要（封面）

#: 摘要块的固定 id（封面摘要区只有一个摘要，前端按这个 id 就地编辑）。
#: 与渲染层同源（projects.ABSTRACT_BLOCK_ID）——渲染与写回共用一套闭包定位。
ABSTRACT_BLOCK_ID = _ABSTRACT_BLOCK_ID

#: `abstract` 环境的内容区间：与渲染层同一份实现（projects.abstract_env_span）。
_abstract_span = _abstract_env_span


def _root_tex_file(disk_root: Path) -> tuple[str, Path]:
    """根文件（配置里的 `root_tex`，没有就 `main.tex`）——相对名与绝对路径。

    摘要住在根文件的 `abstract` 环境里；根文件**不在** `sections/` 下，
    所以它自己一套闸（不许越出盘根、不许写账本目录、只写 .tex）。
    """
    rel = ""
    try:
        cfg = load_config(disk_root)
        rel = str(getattr(cfg, "root_tex", "") or "").strip()
    except (ConfigError, OSError, ValueError):
        rel = ""
    rel = rel or "main.tex"
    from pathlib import PurePosixPath

    pure = PurePosixPath(rel.replace("\\", "/"))
    if pure.is_absolute() or any(part == ".." for part in pure.parts):
        raise ConfigError("根文件路径不合法：%s" % rel,
                          code="SECTION_PATH_INVALID")
    root = Path(disk_root).resolve()
    target = Path(disk_root).joinpath(*[p for p in pure.parts if p not in ("", ".")])
    try:
        inside = target.resolve().relative_to(root)
    except (OSError, ValueError):
        raise ConfigError("根文件越出项目根：%s" % rel,
                          code="SECTION_PATH_INVALID")
    if target.suffix.lower() != ".tex":
        raise ConfigError("根文件必须是 .tex：%s" % rel,
                          code="SECTION_PATH_INVALID")
    parts = inside.parts
    if parts and parts[0] in ("facts", "audit", "results", "runs"):
        raise ConfigError("账本与产物目录只读：%s" % rel,
                          code="SECTION_READONLY")
    return inside.as_posix(), target


def abstract_block(disk_root: Path) -> Block:
    """封面摘要块：**走渲染闭包**定位——摘要在哪个文件就定位在哪个文件。

    两种布局都认：

    1. **节文件式**（sectioned）：摘要是独立节文件 `sections/00_abstract.tex`
       （自带 `\\begin{abstract}…\\end{abstract}`），经 `\\input` 装配；
    2. **根文件式**：摘要在根文件 `main.tex` 的 `abstract` 环境里。
    """
    from .projects import cover_abstract_block

    info = cover_abstract_block(disk_root)
    if not info:
        raise ConfigError("这个盘里找不到摘要（既没有 abstract 环境，也没有独立的摘要节文件）",
                          code="ABSTRACT_MISSING")
    return Block(file=info["file"], block_id=ABSTRACT_BLOCK_ID, kind="abstract",
                 start=info["start"], end=info["end"], raw=info["raw"],
                 title="摘要")


def _writable_target(disk_root: Path, rel: str) -> Path:
    """摘要所在文件的写闸：根文件走根文件闸，节文件走段二的章节文件闸。"""
    root_rel, root_path = _root_tex_file(disk_root)
    if rel == root_rel:
        return root_path
    return _safe_section_file(disk_root, rel)


def save_abstract(disk_root: Path, client_text: str,
                  expect_sha: str = "",
                  expect_tokens: str = "") -> dict:
    """把改后的摘要写回它所在的那个文件。

    **span 权威**：写回位置＝渲染闭包给出的那块（file/start/end），块外的东西
    （`\\begin{abstract}`/`\\end{abstract}` 环境标记、`% FACTS-USED` 标记行）属
    于文件原有结构，不在编辑块范围内——原样留着，不补、不重生成。

    **不套娃**：提交文本若自带 abstract 环境（前端把整段环境甚至整份文件回传
    了），只取环境内的散文写进去，不再包一层；同一份文本连存 N 次，文件字节
    稳定。

    保护通道不变：保护面（`\\fact{}` 等）原样保留、删了按原位补回、花括号不
    配平不落盘、原子写、保存前留 `.bak`。条目 43：带 `expect_sha` 保存闸与
    新块 `sha`（同 save_block）。
    """
    block = abstract_block(disk_root)
    _check_expect_sha(block, expect_sha)
    prose = _abstract_prose(client_text)
    bound_values = _bound_values(disk_root)
    segments = scan(block.raw, bound_values)
    _check_token_count(segments, expect_tokens)
    new_raw, warnings = _rebuild(segments, prose, code=TOKEN_MISMATCH_CODE)
    if not _balanced_ok(new_raw):
        raise ConfigError("摘要的花括号不配平（写下去会编不过），没有保存。",
                          code="EDIT_UNBALANCED")
    _guard_surface_kept(segments, new_raw, bound_values, TOKEN_MISMATCH_CODE)
    rel = block.file
    path = _writable_target(disk_root, rel)
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ConfigError("读不到摘要所在文件：%s（%s）" % (rel, exc),
                          code="SECTION_MISSING")
    # 重新定位：文件可能被人外部改过（绕过服务端），按当前结构再算一次——
    # 写回落在**现在**的摘要块里，不会叠出第二层。
    span = _abstract_span(text)
    if span is None:
        raise ConfigError("摘要已经被挪走了（或文件变了）：%s，请刷新页面重试" % rel,
                          code="ABSTRACT_MISSING")
    start, end, lead, trail = span
    new_text = text[:start + lead] + new_raw + text[end - trail:]
    result = atomic_write(path, new_text, keep=BACKUP_KEEP)
    return {"ok": True, "file": rel, "block": ABSTRACT_BLOCK_ID,
            "before": block.raw, "after": new_raw,
            "sha": _short_sha(new_raw),
            "backup": result["backup"], "warnings": _warn_texts(warnings)}



def find_block(disk_root: Path, rel_file: str, block_id: str) -> Block:
    """按 id 找到一段：返回它所在文件、偏移与原文。"""
    path = _safe_section_file(disk_root, rel_file)
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ConfigError("读不到章节文件：%s（%s）" % (rel_file, exc),
                          code="SECTION_MISSING")
    for block in render_tex(text, stem=Path(rel_file).stem, disk_root=disk_root):
        if block["id"] == block_id:
            return Block(file=rel_file, block_id=block_id, kind=block["kind"],
                         start=block["start"], end=block["end"],
                         raw=block.get("raw", ""), title=block.get("title", ""),
                         region_start=int(block.get("region_start", -1)),
                         region_end=int(block.get("region_end", -1)))
    raise ConfigError("这一段已经不在文件里了（请刷新页面）：%s" % block_id,
                      code="BLOCK_MISSING")


def editable_model(disk_root: Path, block: Block) -> dict:
    """给前端的可编辑模型：散文 + 保护面芯片。

    条目 43：另带 ``html``（与渲染层同一套芯片烤法——前端摘要就用它渲染）
    与 ``sha``（raw 短指纹，保存闸 expect_sha 用）。
    """
    values = _bound_values(disk_root)
    segments = scan(block.raw, values)
    plain = ""
    chips: list[dict] = []
    for seg in segments:
        if seg.kind == "text":
            plain += seg.text
            continue
        token = "%sP%d%s" % (TOKEN_OPEN, seg.index, TOKEN_CLOSE)
        plain += token
        chips.append({"i": seg.index, "label": seg.label,
                      "raw": seg.text, "display": _display(seg)})
    html = ""
    if block.kind in ("para", "abstract", "ai_draft"):
        html = (_render_abstract_html(block.raw, values) if
                block.kind in ("abstract", "para")
                else "<p>%s</p>" % _render_prot_html(block.raw, values))
    return {"id": block.block_id, "file": block.file, "kind": block.kind,
            "title": block.title, "plain": plain, "chips": chips,
            "html": html, "sha": _short_sha(block.raw),
            "raw": block.raw}


def _display(seg: Segment) -> str:
    """芯片上的字：\\fact{A1} → 「✓ A1」，\\cite{k} → 「[k]」，数字 → 数字。"""
    text = seg.text
    if seg.label == "fact":
        match = re.match(r"\\fact\s*\{([^{}]*)\}", text)
        if match:
            return "✓ %s" % match.group(1).strip()
        return "✓"
    if seg.label in ("cite", "ref"):
        match = re.search(r"\{([^{}]*)\}", text)
        if match:
            return "[%s]" % match.group(1).strip()
        return text
    if seg.label == "num":
        return text
    if seg.label == "env":
        return "⟨%s⟩" % (re.search(r"\{([^{}]*)\}", text).group(1)
                         if re.search(r"\{([^{}]*)\}", text) else "env")
    if len(text) > 18:
        return text[:17] + "…"
    return text


#: 指纹闸（条目 43）：客户端上报的 expect_sha 与服务端现算的不一致 → 拒写。
BLOCK_STALE_CODE = "BLOCK_STALE"


def _check_expect_sha(block: Block, expect_sha: str) -> None:
    """保存闸：客户端所基于的块原文与服务端当前原文必须同一份。

    不一致说明这段在别处（另一个窗口／外部编辑器）已被改过——照单写回会
    覆盖别人的字，抛 ``BLOCK_STALE`` 拒写（HTTP 409），让前端重载新文。
    """
    expect = str(expect_sha or "").strip()
    if not expect:
        return
    if expect != _short_sha(block.raw):
        raise ConfigError("这段在别处已被改动，请重新编辑。",
                          code=BLOCK_STALE_CODE)


#: 保护面数量对不上（客户端那份 DOM 是**旧结构**渲染的）→ 拒写。
#: 指纹闸管「哪一版内容」，这一道管「哪一版结构」。
TOKEN_COUNT_MISMATCH_CODE = "EDIT_TOKEN_COUNT_MISMATCH"


def _check_token_count(segments: list[Segment], expect_tokens: str,
                       code: str = TOKEN_COUNT_MISMATCH_CODE) -> None:
    """客户端渲染的保护面数量与服务端当前扫描对不上 → 拒写。

    客户端报的是「这份 DOM 是哪一版**结构**渲染出来的」（几枚保护面芯片）。
    账本变了（新事实的 value 出现在正文里 → 同一段原文多出绑定数字令牌），
    同一段原文的保护面数量就变了，客户端那份 DOM 里的占位符序号**整体错位**：
    按旧序号重建，用户没打过的字会被改掉。宁可这一轮不落盘。
    """
    raw = str(expect_tokens or "").strip()
    if not raw:
        return
    try:
        want = int(raw)
    except ValueError:
        return
    mine = len([seg for seg in segments if seg.kind == "prot"])
    if want == mine:
        return
    raise ConfigError(
        "这一段在别处被改动过（保护面数量对不上：客户端 %d 枚、服务端 %d 枚），"
        "没有保存——请重新载入这一段再改。" % (want, mine),
        code=code)


# ---------------------------------------------------------------- 块形状闸
#
# 挡的是一类真踩过的坑（2026-11-22 体检报告 P0-2 实测）：把**整个文件**当成
# 某一段的替换文本传进来，引擎照单全收——采纳后文件里多了一份
# \section{Introduction} 与其后的内容，而指纹闸、保护面重建、花括号配平、
# 原子写四道全部放行、零告警。
#
# 根因：替换文本原来只查「非空／指纹／花括号」，没有「块形状」这一道。
#
# 判据与 projects.render_tex 的切块命令集保持一致：只有 \section／\subsection／
# \subsubsection 会自成一个块。它们出现在**正文段**的替换文本里，就一定是
# 「别的块的节标题」混进来了。

#: 会自成一个块的标题命令（与 render_tex 的 _HEADING_RE 同集）。
_SHAPE_HEADING_RE = re.compile(
    r"\\(section|subsection|subsubsection)\s*\*?\s*\{([^{}]*)\}")
#: 锚命令（LaTeX 里全篇必须唯一）。
_SHAPE_LABEL_RE = re.compile(r"\\label\s*\{([^{}]*)\}")
#: 整块搬进来的命令（正文段里出现就是形状不对）。
_SHAPE_INPUT_RE = re.compile(r"\\(input|include)\s*\{([^{}]*)\}")

#: 形状不匹配的机器码（提议单用 PROPOSAL_…，直接保存用 EDIT_…）。
SHAPE_MISMATCH_CODE = "PROPOSAL_SHAPE_MISMATCH"


def _block_shape_guard(block: Block, text: str, disk_root: Path,
                       code: str = SHAPE_MISMATCH_CODE) -> list[dict]:
    r"""替换文本的**块形状**校验：形状不对直接拒收，形状可疑只给告警。

    返回告警列表（不拦）；形状不匹配抛 ConfigError（拦）。

    拦的三条（硬闸）：

    1. 正文段（para/abstract/ai_draft）的替换文本里出现节标题命令
       ——「混进了别的块的节标题」，最常见成因是整份文件贴了进来；
    2. 标题块（section/subsection）的替换文本里出现**一个以上**节标题
       ——一份替换文本只该对应一个标题；
    3. 替换文本里的 \label{} 与**同文件别的块**重名 ——重复锚。

    告警的两条（软闸，只提示，不拦）：

    4. 标题块的替换文本里没有节标题 ——写下去标题就没了；
    5. 替换文本比原文长出很多 ——多半是贴错了地方。
    """
    warnings: list[dict] = []
    headings = _SHAPE_HEADING_RE.findall(text)
    is_heading_block = block.kind in ("section", "subsection")
    if is_heading_block:
        if len(headings) > 1:
            names = "、".join("\\%s{%s}" % (cmd, title)
                              for cmd, title in headings[:3])
            raise ConfigError(
                "替换文本里有 %d 个节标题（%s）——这一段本身就是一个标题，"
                "一份替换文本只能对应一个标题。" % (len(headings), names),
                code=code)
        if not headings:
            warnings.append(_warn("wb.warn.shape.noHeading"))
    elif headings:
        names = "、".join("\\%s{%s}" % (cmd, title)
                          for cmd, title in headings[:3])
        raise ConfigError(
            "替换文本里混进了别的块的节标题（%s）——这一段是正文段落"
            "（%s），不带节标题。你是不是把整个文件贴进来了？"
            "请只改这一段的文字。" % (names, block.block_id),
            code=code)

    # 重复锚：替换文本里的 label 若与同文件**别的块**重名 → 拒收。
    own_labels = set(_SHAPE_LABEL_RE.findall(block.raw))
    if _SHAPE_LABEL_RE.search(text):
        try:
            file_text = _writable_target(disk_root, block.file).read_text(
                encoding="utf-8")
        except (ConfigError, OSError, UnicodeDecodeError):
            file_text = ""
        file_labels = set(_SHAPE_LABEL_RE.findall(file_text))
        dup = sorted({lab for lab in _SHAPE_LABEL_RE.findall(text)
                      if lab and lab in file_labels and lab not in own_labels})
        if dup:
            raise ConfigError(
                "替换文本里的锚 \\label{%s} 与 %s 里另一处重复——"
                "锚必须全篇唯一，请换个锚，或只改这一段。"
                % ("、".join(dup[:3]), block.file),
                code=code)

    inputs = _SHAPE_INPUT_RE.findall(text)
    if inputs and not is_heading_block:
        warnings.append(_warn("wb.warn.shape.input", {"file": inputs[0][1]}))

    old_len = len(block.raw.strip())
    new_len = len(text.strip())
    if new_len > max(3 * old_len, old_len + 2000):
        warnings.append(_warn("wb.warn.shape.tooLong",
                              {"old": old_len, "new": new_len}))
    return warnings


def save_block(disk_root: Path, rel_file: str, block_id: str,
               client_text: str, expect_sha: str = "",
               expect_tokens: str = "") -> dict:
    """把改后的段落写回原文件。

    条目 43：`expect_sha` 是客户端所基于的该块 raw 指纹（sha256 前 16 位）；
    给了就对不上拒写（BLOCK_STALE）。应答带 `sha`（新块的指纹），前端存下
    供下一次保存用。
    """
    block = find_block(disk_root, rel_file, block_id)
    _check_expect_sha(block, expect_sha)
    shape_warnings = _block_shape_guard(block, client_text, disk_root,
                                       code="EDIT_SHAPE_MISMATCH")
    bound_values = _bound_values(disk_root)
    segments = scan(block.raw, bound_values)
    _check_token_count(segments, expect_tokens)
    new_raw, warnings = _rebuild(segments, client_text,
                                code=TOKEN_MISMATCH_CODE)
    warnings = list(warnings) + shape_warnings
    if not _balanced_ok(new_raw):
        raise ConfigError("这段的花括号不配平（写下去会编不过），没有保存。",
                          code="EDIT_UNBALANCED")
    _guard_surface_kept(segments, new_raw, bound_values, TOKEN_MISMATCH_CODE)
    path = _safe_section_file(disk_root, rel_file)
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ConfigError("读不到章节文件：%s（%s）" % (rel_file, exc),
                          code="SECTION_MISSING")
    new_text = text[:block.start] + new_raw + text[block.end:]
    result = atomic_write(path, new_text, keep=BACKUP_KEEP)
    return {"ok": True, "file": rel_file, "block": block_id,
            "before": block.raw, "after": new_raw,
            "sha": _short_sha(new_raw),
            "backup": result["backup"], "warnings": _warn_texts(warnings)}


# ---------------------------------------------------------------- 提议单


def propose_block_edit(disk_root: Path, rel_file: str, block_id: str,
                       client_text: str, expect_sha: str = "",
                       source: str = "", rationale: str = "") -> dict:
    """算一份改稿提议（**不写正文**）。

    走的是与 `save_block` 同一条保护链，只是算完就停：
    指纹闸 → 保护面重建 → 花括号配平。
    算出来的 `after_text` 就是真正会落盘的那一份——差异卡展示它，所见即落盘。
    """
    block = find_block(disk_root, rel_file, block_id)
    _check_expect_sha(block, expect_sha)
    text = client_text if isinstance(client_text, str) else ""
    if not text.strip():
        raise ConfigError("提议内容是空的，没什么可改的。",
                          code="PROPOSAL_TEXT_EMPTY")
    shape_warnings = _block_shape_guard(block, text, disk_root,
                                       code=SHAPE_MISMATCH_CODE)
    bound_values = _bound_values(disk_root)
    segments = scan(block.raw, bound_values)
    new_raw, warnings = _rebuild(segments, text,
                                code="PROPOSAL_TOKEN_MISMATCH")
    warnings = list(warnings) + shape_warnings
    if not _balanced_ok(new_raw):
        raise ConfigError("这段的花括号不配平（写下去会编不过），没有保存。",
                          code="EDIT_UNBALANCED")
    _guard_surface_kept(segments, new_raw, bound_values,
                         "PROPOSAL_TOKEN_MISMATCH")
    return {"kind": "block_edit",
            "file": rel_file,
            "block": block_id,
            "before_sha": _short_sha(block.raw),
            "before_text": block.raw,
            "proposed_text": text,
            "after_text": new_raw,
            "warnings": _warn_texts(warnings),
            # 展示层：正文是契约内容（逐字落盘），只有告警需要翻译。
            "display": {"warnings": _warn_parts(warnings)},
            "source": source,
            "rationale": rationale}


def propose_ai_draft(disk_root: Path, rel_file: str, after_block_id: str,
                     text: str, expect_sha: str = "",
                     source: str = "", rationale: str = "") -> dict:
    """算一份「在锚段之后插入草稿块」的提议（**不写正文**）。

    插入位置与内容由 `_draft_insertion` 算——与真写回共用同一份计算。
    """
    block = find_block(disk_root, rel_file, after_block_id)
    _check_expect_sha(block, expect_sha)
    body = _escape_draft(str(text or "")).strip()
    if not body:
        raise ConfigError("回复是空的，没什么可写进稿的。", code="DRAFT_EMPTY")
    path = _safe_section_file(disk_root, rel_file)
    try:
        source_text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ConfigError("读不到章节文件：%s（%s）" % (rel_file, exc),
                          code="SECTION_MISSING")
    marker, insertion, insert_at = _draft_insertion(source_text, block, body)
    after_text = source_text[:insert_at] + insertion + source_text[insert_at:]
    return {"kind": "ai_draft",
            "file": rel_file,
            "block": after_block_id,
            "after_block": after_block_id,
            "before_sha": _short_sha(block.raw),
            "before_text": block.raw,
            "proposed_text": body,
            "after_text": after_text,
            "marker": marker,
            "warnings": [],
            "display": {"warnings": []},
            "source": source,
            "rationale": rationale}


def apply_proposal(disk_root: Path, proposal: dict) -> dict:
    """把提议单落成正文（**人确认之后才走这里**）。

    复用既有写回通道：`block_edit` → `save_block`；`ai_draft` → `insert_ai_draft`。
    两条都带 `expect_sha`（提议时记下的块指纹）：正文在提议之后被别处改过，
    这里抛 `BLOCK_STALE` 拒写，不覆盖别人的字。

    账与证据面（`evidence_freeze` / `evidence_unfreeze` / `add_fact` /
    `export_bundle`）走 `workbench/proposals.py`：它们不碰正文，但同样是
    「人点才写」，同样带指纹闸。
    """
    kind = str(proposal.get("kind") or "")
    expect = str(proposal.get("before_sha") or "")
    if kind == "block_edit":
        return save_block(disk_root, str(proposal.get("file") or ""),
                          str(proposal.get("block") or ""),
                          str(proposal.get("proposed_text") or ""),
                          expect_sha=expect)
    if kind == "ai_draft":
        anchor = str(proposal.get("after_block") or proposal.get("block") or "")
        return insert_ai_draft(disk_root, str(proposal.get("file") or ""),
                               anchor,
                               str(proposal.get("proposed_text") or ""),
                               expect_sha=expect)
    if kind in ("evidence_freeze", "evidence_unfreeze", "add_fact",
                "export_bundle"):
        # 账与证据面的提议（workbench/proposals.py）：不碰正文，但同样
        # 「人点才写」——指纹闸对不上就拒写。
        from .proposals import (apply_add_fact, apply_evidence_freeze,
                                apply_evidence_unfreeze, apply_export_bundle)
        if kind == "evidence_freeze":
            return apply_evidence_freeze(disk_root, proposal)
        if kind == "evidence_unfreeze":
            return apply_evidence_unfreeze(disk_root, proposal)
        if kind == "add_fact":
            return apply_add_fact(disk_root, proposal)
        return apply_export_bundle(disk_root, proposal)
    raise ConfigError("不会认的提议类型：%s" % kind,
                      code="PROPOSAL_KIND_INVALID")


# ---------------------------------------------------------------- AI 草稿块

def _escape_draft(text: str) -> str:
    """AI 草稿进 LaTeX 前的最小转义。

    只转 `%`（它会把后面整行变成注释，破坏文件）——其余原样留着，
    免得作者在稿子里看到一堆反斜杠。
    """
    return str(text or "").replace("%", r"\%")


def _next_draft_id(text: str) -> str:
    """这一段文件里下一个 AI 草稿块的标记 id（`aidraft-N`）。"""
    from .projects import ai_draft_regions

    used = set()
    for region in ai_draft_regions(text):
        used.add(str(region.get("id") or ""))
    number = 1
    while ("aidraft-%d" % number) in used:
        number += 1
    return "aidraft-%d" % number


def _draft_region(marker: str, body: str) -> str:
    """AI 草稿块在文件里的样子（标记行 ＋ quote 环境 ＋ 标记行）。"""
    from .projects import AI_DRAFT_BEGIN, AI_DRAFT_END, AI_DRAFT_ENV

    lines = [
        "%% %s %s" % (AI_DRAFT_BEGIN, marker),
        "\\begin{%s}" % AI_DRAFT_ENV,
    ]
    lines.extend(body.splitlines() or [""])
    lines.append("\\end{%s}" % AI_DRAFT_ENV)
    lines.append("%% %s %s" % (AI_DRAFT_END, marker))
    return "\n".join(lines)


def _draft_insertion(source: str, block: Block, body: str) -> tuple[str, str, int]:
    """草稿块插在哪、插什么（纯计算，不落盘）。

    提议单与真写回共用这一份计算——差异卡上看到的落盘结果，
    与人点确认后真正写进文件的那一份，是同一条路算出来的。
    """
    marker = _next_draft_id(source)
    region = _draft_region(marker, body)
    newline = source.find("\n", block.end)
    if newline == -1:
        insert_at = len(source)
        insertion = "\n\n" + region + "\n"
    else:
        insert_at = newline + 1
        insertion = "\n" + region + "\n"
    return marker, insertion, insert_at


def insert_ai_draft(disk_root: Path, rel_file: str, after_block_id: str,
                    text: str, expect_sha: str = "") -> dict:
    """把一段 AI 回复**写进稿**：在该段之后插一个 AI 标记块。

    写进去的样子（.tex）：

    ```
    % FACTSCRIBE-AI-DRAFT-BEGIN aidraft-1
    \\begin{quote}
    …回复正文…
    \\end{quote}
    % FACTSCRIBE-AI-DRAFT-END aidraft-1
    ```

    * 标记行与环境标记属**文件结构**，不进编辑块——作者再编辑这个块时，
      标记行不会丢；
    * 内容独立成块，**不混进正文**；
    * 原子写，落盘前留 `.bak`（与段二同一条写回通道）；
    * 指纹闸：`expect_sha` 给了就比对锚段指纹，对不上抛 `BLOCK_STALE` 拒写
      （草稿通道以前是裸写——这是 v2 补上的那道闸）。
    """
    block = find_block(disk_root, rel_file, after_block_id)
    # 指纹闸（条目 43 的同一条闸）：锚段在别处被改过，就别插。
    _check_expect_sha(block, expect_sha)
    path = _safe_section_file(disk_root, rel_file)
    try:
        source = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ConfigError("读不到章节文件：%s（%s）" % (rel_file, exc),
                          code="SECTION_MISSING")
    body = _escape_draft(str(text or "")).strip()
    if not body:
        raise ConfigError("回复是空的，没什么可写进稿的。", code="DRAFT_EMPTY")
    marker, insertion, insert_at = _draft_insertion(source, block, body)
    new_text = source[:insert_at] + insertion + source[insert_at:]
    result = atomic_write(path, new_text, keep=BACKUP_KEEP)
    return {"ok": True, "file": rel_file, "after": after_block_id,
            "marker": marker, "block": "%s-%s" % (Path(rel_file).stem, marker),
            "draft": body, "backup": result["backup"]}


def delete_ai_draft(disk_root: Path, rel_file: str, block_id: str) -> dict:
    """删掉一个 AI 草稿块（标记行 ＋ 环境 ＋ 正文一起拿掉）。

    只动这个块，别人的正文一个字不碰。删除可逆：`.bak` 留着。
    """
    block = find_block(disk_root, rel_file, block_id)
    if block.kind != "ai_draft":
        raise ConfigError("这不是 AI 草稿块，删不了：%s" % block_id,
                          code="DRAFT_NOT_AI")
    path = _safe_section_file(disk_root, rel_file)
    try:
        source = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ConfigError("读不到章节文件：%s（%s）" % (rel_file, exc),
                          code="SECTION_MISSING")
    start = block.region_start if block.region_start >= 0 else block.start
    end = block.region_end if block.region_end >= 0 else block.end
    if not (0 <= start <= end <= len(source)):
        raise ConfigError("这个 AI 草稿块已经不在文件里了（请刷新页面）：%s"
                          % block_id, code="BLOCK_MISSING")
    # 前面那行空行是这块跟正文之间的分隔——一起吃掉，别留两个空行。
    if start >= 2 and source[start - 2:start] == "\n\n":
        start -= 1
    # 连着后面那个换行一起吃掉。
    while end < len(source) and source[end] == "\n":
        end += 1
    new_text = source[:start] + source[end:]
    result = atomic_write(path, new_text, keep=BACKUP_KEEP)
    return {"ok": True, "file": rel_file, "block": block_id,
            "deleted": block.raw, "backup": result["backup"]}


# ---------------------------------------------------------------- 装配

def assembly_file(disk_root: Path, cfg=None) -> Path:
    """装配文件（根文件）：配置里的 `root_tex`，没有就 `main.tex`。"""
    rel = ""
    if cfg is not None:
        rel = str(getattr(cfg, "root_tex", "") or "").strip()
    rel = rel or "main.tex"
    return disk_root / rel


def read_assembly(disk_root: Path, cfg=None) -> dict:
    """读装配：main.tex 里 `\\input`/`\\include` 的章节列表。"""
    path = assembly_file(disk_root, cfg)
    if not path.is_file():
        return {"file": "", "entries": []}
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return {"file": str(path), "entries": []}
    base = path.parent
    entries: list[dict] = []
    for number, line in enumerate(text.splitlines()):
        for match in _INPUT_RE.finditer(line):
            target = match.group(2).strip()
            if not target or "\\" in target or "#" in target:
                continue
            candidate = base / target
            if not candidate.is_file() and candidate.with_suffix(".tex").is_file():
                candidate = candidate.with_suffix(".tex")
            try:
                rel = candidate.resolve().relative_to(disk_root.resolve()).as_posix()
            except (OSError, ValueError):
                continue
            title, sha = _section_meta(candidate)
            entries.append({"rel": rel, "target": target, "line": number,
                            "raw": line, "title": title, "sha": sha})
    return {"file": str(path), "entries": entries}


def _section_meta(path: Path) -> tuple[str, str]:
    """章节文件的（一级标题, 短指纹）——目录显示与条目 43 的 sha 同源。"""
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return "", ""
    for block in render_tex(text, stem=path.stem):
        if block["kind"] == "section" and block.get("title"):
            return block["title"], _short_sha(text)
    return "", _short_sha(text)


def _rewrite_assembly(path: Path, entries: list[dict], text: str) -> str:
    """按新的条目顺序重写装配文件（保持其余行原样）。

    槽位＝原来那些条目所在的行号（升序）；第 i 个新条目写进第 i 个槽位，
    这样调序只动装配行，不动文件里的其它内容。
    """
    lines = text.splitlines()
    slots = sorted(entry["line"] for entry in entries)
    for index, entry in enumerate(entries):
        if index >= len(slots):
            break
        number = slots[index]
        if number >= len(lines):
            continue
        original = lines[number]
        cmd = "\\input" if "\\input" in original else "\\include"
        lines[number] = "%s{%s}" % (cmd, entry["target"])
    return "\n".join(lines) + ("\n" if text.endswith("\n") else "")


def move_section(disk_root: Path, rel: str, direction: str) -> dict:
    """调序：把某节在装配里往上/往下挪一格。"""
    if direction not in ("up", "down"):
        raise ConfigError("调序只能是 up 或 down", code="ORDER_INVALID")
    cfg = _safe_config(disk_root)
    assembly = read_assembly(disk_root, cfg)
    path = Path(assembly["file"]) if assembly["file"] else None
    if path is None or not path.is_file():
        raise ConfigError("这个盘没有装配文件（%s），调不了序"
                          % assembly_file(disk_root, cfg).name,
                          code="ASSEMBLY_MISSING")
    entries = assembly["entries"]
    index = next((i for i, e in enumerate(entries) if e["rel"] == rel), None)
    if index is None:
        raise ConfigError("装配里没有这一节：%s" % rel, code="SECTION_NOT_INCLUDED")
    other = index - 1 if direction == "up" else index + 1
    if other < 0 or other >= len(entries):
        return {"ok": True, "moved": False, "order": [e["rel"] for e in entries]}
    entries[index], entries[other] = entries[other], entries[index]
    text = path.read_text(encoding="utf-8")
    new_text = _rewrite_assembly(path, entries, text)
    result = atomic_write(path, new_text, keep=BACKUP_KEEP)
    return {"ok": True, "moved": True, "order": [e["rel"] for e in entries],
            "backup": result["backup"], "file": str(path)}


def delete_section(disk_root: Path, rel: str) -> dict:
    """删节：从装配移除 + 把文件挪到 `attic/`（可逆，不真删）。"""
    cfg = _safe_config(disk_root)
    assembly = read_assembly(disk_root, cfg)
    path = Path(assembly["file"]) if assembly["file"] else None
    if path is None or not path.is_file():
        raise ConfigError("这个盘没有装配文件（%s），删不了节"
                          % assembly_file(disk_root, cfg).name,
                          code="ASSEMBLY_MISSING")
    entries = assembly["entries"]
    index = next((i for i, e in enumerate(entries) if e["rel"] == rel), None)
    if index is None:
        raise ConfigError("装配里没有这一节：%s" % rel, code="SECTION_NOT_INCLUDED")
    source = disk_root / rel
    attic_dir = source.parent / ATTIC_DIR
    attic_dir.mkdir(parents=True, exist_ok=True)
    attic = attic_dir / source.name
    if attic.exists():
        attic.unlink()
    moved = False
    if source.is_file():
        shutil.move(str(source), str(attic))
        moved = True
    lines = path.read_text(encoding="utf-8").splitlines()
    dropped = entries.pop(index)
    if 0 <= dropped["line"] < len(lines):
        lines.pop(dropped["line"])
    text = "\n".join(lines) + "\n"
    result = atomic_write(path, text, keep=BACKUP_KEEP)
    return {"ok": True, "removed": rel, "attic": str(attic),
            "moved": moved, "backup": result["backup"],
            "order": [e["rel"] for e in entries]}


def create_section(disk_root: Path, title: str, slug: str = "",
                   after: str = "") -> dict:
    """新建一节：建 `sections/NN-slug.tex` ＋ 挂进装配。"""
    clean_title = str(title or "").strip()
    if not clean_title:
        raise ConfigError("新章节要有个标题", code="SECTION_TITLE_MISSING")
    cfg = _safe_config(disk_root)
    sections_dir = disk_root / "sections"
    if not sections_dir.is_dir():
        raise ConfigError("这个盘没有 sections/ 目录，建不了节",
                          code="SECTIONS_DIR_MISSING")
    stem = _slugify(slug or clean_title)
    numbers = []
    for item in sections_dir.glob("*.tex"):
        head = item.stem.split("-", 1)[0]
        if head.isdigit():
            numbers.append(int(head))
    number = (max(numbers) + 1) if numbers else 1
    name = "%02d-%s.tex" % (number, stem)
    target = sections_dir / name
    if target.exists():
        raise ConfigError("这一节已经存在：%s" % name, code="SECTION_EXISTS")
    content = "\\section{%s}\n\n" % clean_title
    atomic_write(target, content, backup=False)
    assembly = read_assembly(disk_root, cfg)
    path = Path(assembly["file"]) if assembly["file"] else None
    if path is None or not path.is_file():
        return {"ok": True, "file": str(target), "rel": target.name,
                "assembled": False}
    text = path.read_text(encoding="utf-8")
    line = "\\input{%s}" % target.relative_to(disk_root).as_posix()[:-len(".tex")]
    entries = assembly["entries"]
    position = len(entries)
    if after:
        for index, entry in enumerate(entries):
            if entry["rel"] == after:
                position = index + 1
                break
    lines = text.splitlines()
    insert_at = None
    if entries and position > 0:
        insert_at = entries[position - 1]["line"] + 1
    else:
        insert_at = _before_end_document(lines)
    lines.insert(insert_at, line)
    new_text = "\n".join(lines) + ("\n" if text.endswith("\n") else "")
    result = atomic_write(path, new_text, keep=BACKUP_KEEP)
    return {"ok": True, "file": str(target),
            "rel": target.relative_to(disk_root).as_posix(),
            "assembled": True, "backup": result["backup"]}


def _before_end_document(lines: list[str]) -> int:
    for index in range(len(lines) - 1, -1, -1):
        if "\\end{document}" in lines[index]:
            return index
    return len(lines)


def _slugify(text: str) -> str:
    """章节文件名：只留 ASCII 字母数字与短横线；中文标题退回 `section`。"""
    out = re.sub(r"[^A-Za-z0-9]+", "-", str(text or "")).strip("-").lower()
    return out or "section"


# ---------------------------------------------------------------- 标题/章节名/事实绑定
#
# 这三条走**独立通道**，不碰 /edit 的「散文＋token」写回：
#
# * 标题块经那条通道回写时，客户端交上来的是标题文字本身，服务端会把
#   \section{…} 整条写掉；
# * 客户端在散文里新写的 \fact{…} 会被那条通道剥掉（不许凭空造账本
#   绑定）——所以绑定标记必须由本节这几条通道落盘。
#
# 三条通道的共同纪律：只动**那一处**，其余字节一字不改；指纹闸
# （expect_sha 对不上 → BLOCK_STALE）；原子写 + .bak（多代轮转）。

#: 节标题命令（改名只动花括号里的那一段）。
_HEADING_CMD_RE = re.compile(r"\\(section|subsection|subsubsection)\s*\*?\s*\{")


def _tex_text(text: str) -> str:
    """写进 .tex 的文本：LaTeX 特殊字符按核心既有约定转义（scaffold.tex_escape）。"""
    from ..scaffold import tex_escape
    return tex_escape(text)


def _rewrite_heading_title(raw: str, title: str) -> str:
    """把一条节标题命令里的标题换成新的；命令本身与其余部分一字不动。"""
    match = _HEADING_CMD_RE.search(raw)
    if not match:
        raise ConfigError("这一段不是节标题，改不了名字。",
                          code="SECTION_NOT_HEADING")
    open_at = match.end() - 1
    close_at = _match_braces(raw, open_at, len(raw))
    if close_at <= open_at + 1 or raw[close_at - 1] != "}":
        raise ConfigError("这一段的节标题没写完（花括号不配平），改不了名字。",
                          code="SECTION_NOT_HEADING")
    return raw[:open_at + 1] + _tex_text(title) + raw[close_at - 1:]


def rename_section(disk_root: Path, rel_file: str, block_id: str, title: str,
                   expect_sha: str = "") -> dict:
    r"""改一节的标题（\section{…} / \subsection{…} 里那一段）。

    * 只改标题命令的花括号里那一段，文件里其余字节一字不动；
    * 指纹闸与正文同一条（expect_sha 对不上 → BLOCK_STALE 拒写）；
    * 原子写，落盘前留 .bak（多代轮转，与正文同一条）。
    """
    clean = " ".join(str(title or "").split())
    if not clean:
        raise ConfigError("新标题不能空。", code="SECTION_TITLE_MISSING")
    block = find_block(disk_root, rel_file, block_id)
    if block.kind not in ("section", "subsection"):
        raise ConfigError("这不是一节标题，改不了名字：%s" % block_id,
                          code="SECTION_NOT_HEADING")
    _check_expect_sha(block, expect_sha)
    new_raw = _rewrite_heading_title(block.raw, clean)
    if new_raw == block.raw:
        return {"ok": True, "changed": False, "file": rel_file,
                "block": block_id, "title": clean, "before": block.raw,
                "after": new_raw, "sha": _short_sha(new_raw)}
    path = _safe_section_file(disk_root, rel_file)
    try:
        source = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ConfigError("读不到章节文件：%s（%s）" % (rel_file, exc),
                          code="SECTION_MISSING")
    new_text = source[:block.start] + new_raw + source[block.end:]
    result = atomic_write(path, new_text, keep=BACKUP_KEEP)
    return {"ok": True, "changed": True, "file": rel_file, "block": block_id,
            "title": clean, "before": block.raw, "after": new_raw,
            "sha": _short_sha(new_raw), "backup": result["backup"]}


def set_disk_title(disk_root: Path, title: str, subtitle: str = "",
                   expect_sha: str = "") -> dict:
    r"""改论文标题：盘自己入口 .tex 的 \title{…}。

    * 标题**分盘取**——改的就是封面读的那一条命令（projects.title_command_span，
      与读侧同源：读的是哪一条，写的就是哪一条）；
    * 主标题与副标题分别落在 \title{…} 的两半（中间是 \\）；
    * 指纹闸：expect_sha 对不上 → BLOCK_STALE 拒写；
    * 原子写，落盘前留 .bak（多代轮转）。
    """
    from .projects import title_command_span
    root = Path(disk_root)
    clean_title = " ".join(str(title or "").split())
    if not clean_title:
        raise ConfigError("标题不能空。", code="TITLE_MISSING")
    clean_sub = " ".join(str(subtitle or "").split())
    span = title_command_span(root)
    if span is None:
        raise ConfigError("这个盘的入口 .tex 里没有 \\title{…}——"
                          "先在 main.tex 里写上标题，再来改。",
                          code="TITLE_MISSING")
    target, start, end, raw = span
    if expect_sha and _short_sha(raw) != expect_sha:
        raise ConfigError("标题在别处被改动过（指纹对不上），没有写入——"
                          "请刷新页面再改。", code=BLOCK_STALE_CODE)
    body = _tex_text(clean_title)
    if clean_sub:
        body += " \\\\ " + _tex_text(clean_sub)
    open_at = raw.index("{")
    new_raw = raw[:open_at + 1] + body + raw[raw.rindex("}"):]
    try:
        source = target.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ConfigError("读不到入口文件：%s（%s）" % (target.name, exc),
                          code="SECTION_MISSING")
    new_text = source[:start] + new_raw + source[end:]
    result = atomic_write(target, new_text, keep=BACKUP_KEEP)
    return {"ok": True, "changed": new_raw != raw, "file": target.name,
            "title": clean_title, "subtitle": clean_sub,
            "before": raw, "after": new_raw, "sha": _short_sha(new_raw),
            "backup": result["backup"]}


def _number_spot(raw: str, value: str) -> tuple[int, str] | None:
    """正文里这条事实**认得**的那处数字 → (插标记的位置, 命中的字面)。

    判据与 audit 的内联绑定**同一套**（facts.fact_value_keys）：一个 fact
    接受哪些数字由它的 value 说了算——`10/16` 认 "10" 也认 "16"（还认精确商
    0.625），`56.25%` 认 "56.25"。所以插出来的标记一定是 audit 认的那一种，
    不会插出一个必然判红的绑定。

    落点优先取 value **字面写出的第一个数字**（分数取分子，与样例稿的写法
    一致：`10/16` 绑在 "10" 后面），再退到其它认得的数字。

    只在**散文段**里找（命令、公式、环境、注释这些保护面里的数字不算），
    且跳过已经跟着 \\fact{…} 的那处（已绑过的不重复绑）。
    """
    from ..facts import _NUM_RE as _FACT_NUM_RE
    from ..facts import fact_value_keys, literal_tokens, number_key
    allowed = fact_value_keys(value)
    if not allowed:
        return None
    # 优先级：value 里字面写出的数字（按书写顺序）→ 其它认得的数字。
    order: list[str] = []
    for raw_token, suffix, pct in literal_tokens(value):
        key = number_key(raw_token, suffix, pct)
        if key not in order:
            order.append(key)
    for key in sorted(allowed):
        if key not in order:
            order.append(key)
    segments = scan(raw, frozenset())
    spans = []
    offset = 0
    for seg in segments:
        if seg.kind == "text":
            spans.append((offset, offset + len(seg.text)))
        offset += len(seg.text)
    for want in order:
        for start, end in spans:
            for match in _FACT_NUM_RE.finditer(raw, start, end):
                token = match.group(1)
                suffix = match.group(2) or ""
                pct = bool(match.group(3))
                at = match.end()
                # LaTeX 的 \\% 紧跟在数字后面——audit 那边先还原成 % 再算，
                # 这里照着还原（键与 audit 一致），标记也插在 \\% 之后。
                if not pct and raw[at:at + 2] == "\\%":
                    pct = True
                    at += 2
                if number_key(token, suffix, pct) != want:
                    continue
                if raw[at:at + 6] == "\\fact{":
                    continue
                return at, match.group(0)
    return None


def insert_fact_binding(disk_root: Path, rel_file: str, block_id: str,
                         fact_id: str, expect_sha: str = "") -> dict:
    """把账上的一条事实绑进正文：在那个数字后面插 \\fact{id} 标记。

    铁律（账上没有的数字不得编造）——三条都要过：

    1. 事实必须**在账上**（facts/*.toml 里查得到）；
    2. 它的 value 必须过既有 value 硬闸（factscribe/valuecheck.py 的
       check_value_in_source——与「追加事实」同一道闸，不绕、不改判据）；
    3. 数字只能来自账本里的 value 原文：正文里已经有这个数字就只补标记，
       没有就把「数字＋标记」一起插在段末——不猜位置、不编数字。

    本段里已经有同一条事实的标记 → 拒（不重复绑）。
    """
    root = Path(disk_root)
    fid = str(fact_id or "").strip()
    if not fid:
        raise ConfigError("要绑哪一条事实？给个事实 id。",
                          code="FACT_ID_MISSING")
    block = find_block(disk_root, rel_file, block_id)
    if block.kind not in ("para", "abstract", "ai_draft"):
        raise ConfigError("只能往正文段落里绑事实（这一段是标题）。",
                          code="FACT_BIND_NOT_PARA")
    _check_expect_sha(block, expect_sha)
    cfg = load_config(root)
    fact = None
    for item in load_facts(cfg):
        if str(item.id) == fid:
            fact = item
            break
    if fact is None:
        raise ConfigError("账上没有这条事实：%s（先在「追加事实」里入账）" % fid,
                          code="FACT_NOT_IN_LEDGER")
    value = str(fact.value or "").strip()
    if not value:
        raise ConfigError("这条事实没有 value，绑不了：%s" % fid,
                          code="FACT_VALUE_EMPTY")
    # value 硬闸：数字必须真的在那件产物里（与追加事实同一道，不绕）。
    from ..scaffold import check_value_in_source, resolve_source
    source_rel, source_path = resolve_source(root, cfg, str(fact.source or ""))
    check_value_in_source(root, cfg, source_rel, source_path, value,
                          locator=str(fact.locator or ""))
    marker = "\\fact{%s}" % fid
    if marker in block.raw:
        raise ConfigError("这一段里已经有这条事实的标记了（%s）。" % fid,
                          code="FACT_ALREADY_BOUND")
    spot = _number_spot(block.raw, value)
    if spot is not None:
        at, literal = spot
        insertion = marker
        mode = "marker"
    else:
        at = len(block.raw)
        literal = ""
        lead = "" if (not block.raw or block.raw[-1].isspace()) else " "
        insertion = lead + _tex_text(value) + marker
        mode = "value"
    new_raw = block.raw[:at] + insertion + block.raw[at:]
    path = _safe_section_file(disk_root, rel_file)
    try:
        source = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ConfigError("读不到章节文件：%s（%s）" % (rel_file, exc),
                          code="SECTION_MISSING")
    new_text = source[:block.start] + new_raw + source[block.end:]
    result = atomic_write(path, new_text, keep=BACKUP_KEEP)
    return {"ok": True, "file": rel_file, "block": block_id, "fact": fid,
            "value": value, "mode": mode, "matched": literal,
            "before": block.raw, "after": new_raw,
            "sha": _short_sha(new_raw), "backup": result["backup"]}


def _safe_config(disk_root: Path):
    try:
        return load_config(disk_root)
    except (ConfigError, OSError, ValueError):
        return None


# ---------------------------------------------------------------- 项目级配置

def _toml_value(text: str) -> str:
    """TOML 基本字符串（与 config 的迷你解析器兼容的最小转义集）。"""
    out = (str(text or "")
           .replace("\\", "\\\\")
           .replace('"', '\\"')
           .replace("\n", "\\n")
           .replace("\r", "\\r")
           .replace("\t", "\\t"))
    return '"%s"' % out


def read_table(path: Path, table: str) -> dict:
    """读 factscribe.toml 里某张表（读不到就空表）。"""
    from ..config import load_toml
    try:
        data = load_toml(path)
    except Exception:  # noqa: BLE001 - 坏配置当空表
        return {}
    value = data.get(table)
    return value if isinstance(value, dict) else {}


def rewrite_table(path: Path, table: str, values: dict) -> None:
    """改写 factscribe.toml 里某张表的给定键；别的行一个字都不动。

    `values` 的值是**排版好的 TOML 字面量**（字符串带引号）。
    """
    lines = path.read_text(encoding="utf-8").splitlines()
    start = None
    end = len(lines)
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped.startswith("["):
            continue
        if start is None:
            if stripped == "[%s]" % table:
                start = index + 1
            continue
        end = index
        break
    if start is None:
        if lines and lines[-1].strip():
            lines.append("")
        lines.append("[%s]" % table)
        for key, value in values.items():
            lines.append("%s = %s" % (key, value))
    else:
        pending = dict(values)
        section: list[str] = []
        for line in lines[start:end]:
            match = re.match(r"^\s*([A-Za-z0-9_-]+)\s*=", line)
            key = match.group(1) if match else ""
            if key in pending:
                section.append("%s = %s" % (key, pending.pop(key)))
            else:
                section.append(line)
        for key, value in pending.items():
            section.append("%s = %s" % (key, value))
        lines[start:end] = section
    atomic_write(path, "\n".join(lines).rstrip("\n") + "\n")


def workbench_config(disk_root: Path) -> dict:
    """项目级工作台配置（factscribe.toml 的 `[workbench]` 表）。"""
    path = disk_root / CONFIG_NAME
    if not path.is_file():
        return {}
    return read_table(path, "workbench")


def save_workbench_config(disk_root: Path, values: dict) -> None:
    """写 `[workbench]` 表（原子写 + .bak）。"""
    path = disk_root / CONFIG_NAME
    if not path.is_file():
        raise ConfigError("这个项目没有 %s" % CONFIG_NAME, code="PROJECT_INVALID")
    literals = {key: _toml_value(value) for key, value in values.items()}
    rewrite_table(path, "workbench", literals)


def touch_opened(disk_root: Path) -> dict:
    """记「最近打开」（写进项目配置的 `[workbench]` 表）。

    写两样：
      * last_opened＝打开时间（原本就有）；
      * last_disk＝这个盘自己的盘号——「打开」据此记住上次开的是哪个盘
        （P0-5）。双语项目不再每次回落英文盘。

    写的是**被打开的那个盘自己的 factscribe.toml**，[workbench] 同一张表、
    同一次原子写（同一个 .bak），不碰 facts/ 与正文。
    """
    when = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    disk_id = Path(disk_root).name
    values = workbench_config(disk_root)
    values["last_opened"] = when
    values["last_disk"] = disk_id
    save_workbench_config(disk_root, values)
    return {"last_opened": when, "last_disk": disk_id}


def create_paper_project(root: Path, *, slug: str, title: str,
                         langs=("en",), journal: str = "",
                         template: str = "", question: str = "",
                         project_dir: str = "",
                         reports_dir: str = "") -> dict:
    """新建论文项目：在 `root` 下落目录骨架（每个语言盘一个目录）。

    骨架复用 `factscribe init` 的模板（`scaffold.init_project`），再补
    `[workbench]` 表：项目目录、实验报告目录、标题等。
    """
    from ..scaffold import init_project

    base = Path(root).expanduser()
    if not base.is_dir():
        raise ConfigError("根目录不存在：%s" % base, code="PROJECT_PARENT_MISSING")
    clean_title = str(title or "").strip()
    if not clean_title:
        raise ConfigError("请填论文标题", code="PROJECT_TITLE_MISSING")
    clean_slug = str(slug or "").strip()
    if not clean_slug:
        clean_slug = _slugify(clean_title)
    if not re.fullmatch(r"[A-Za-z0-9._-]+", clean_slug) or clean_slug in (".", ".."):
        raise ConfigError("文件夹名只允许字母、数字、点、下划线和连字符：%r"
                          % clean_slug, code="PROJECT_SLUG_INVALID")
    wanted = [lang for lang in (langs or ["en"]) if lang in ("zh", "en")]
    if not wanted:
        wanted = ["en"]

    created: list[str] = []
    disks: list[dict] = []
    for lang in wanted:
        name = clean_slug if lang == "en" else "%s-zh" % clean_slug
        target = base / name
        if target.exists():
            raise ConfigError("目标已存在：%s" % target, code="PROJECT_DIR_NOT_EMPTY")
        init_project(target, title=clean_title, author="", lang=lang)
        disk_project_dir = project_dir.strip() or name
        disk_reports = reports_dir.strip() or (disk_project_dir + "/reports")
        save_workbench_config(target, {
            "project_dir": disk_project_dir,
            "reports_dir": disk_reports,
            "lang": lang,
            "title": clean_title,
            "journal": journal,
            "template": template,
            "question": question,
        })
        created.append(str(target))
        disks.append({"id": name, "lang": lang, "path": str(target),
                      "project_dir": disk_project_dir,
                      "reports_dir": disk_reports})
    return {"ok": True, "created": created, "disks": disks,
            "title": clean_title, "slug": clean_slug}


def update_paper_project(disk_root: Path, *, title: str = "",
                          journal: str = "", template: str = "",
                          question: str = "", reports_dir: str = "",
                          last_disk: str = "") -> dict:
    """改项目：标题与几个可改字段。

    锁死的字段（FEEDBACK-v4 条目 24 的裁定）：**项目目录**（身份锚）与
    **写作语言／盘集合**——这两个这里根本不接受参数。
    """
    root = Path(disk_root)
    cfg_path = root / CONFIG_NAME
    if not cfg_path.is_file():
        raise ConfigError("这个目录不是论文项目：%s" % root, code="PROJECT_INVALID")
    values = workbench_config(root)
    changed: list[str] = []
    clean_title = str(title or "").strip()
    if clean_title:
        project = read_table(cfg_path, "project")
        if project.get("title") != clean_title:
            rewrite_table(cfg_path, "project",
                          {"title": _toml_value(clean_title)})
            changed.append("title")
        values["title"] = clean_title
    for key, value in (("journal", journal), ("template", template),
                       ("question", question), ("reports_dir", reports_dir),
                       ("last_disk", last_disk)):
        text = str(value or "").strip()
        if not text:
            continue
        if values.get(key) != text:
            values[key] = text
            changed.append(key)
    if changed:
        save_workbench_config(root, values)
    return {"ok": True, "changed": changed, "config": values}
