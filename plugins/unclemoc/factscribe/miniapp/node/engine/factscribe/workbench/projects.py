# -*- coding: utf-8 -*-
"""工作台段一：项目发现、盘聚合与只读渲染。

这里只读磁盘：找 `factscribe.toml`、把同根名的两语言盘配成一个项目、
把 `.tex` 章节渲染成轻量 HTML。任何写操作都不在本模块里。

聚合规则（段一约定）：
  * `paper` 与 `paper-zh` 是同一个项目的两个盘（en 盘 + zh 盘）；
  * `paper-b` 与 `paper-b-zh` 同理；
  * 没有配对的盘自己成一个单盘项目。
项目名取项目声明里的标题，取不到就退回目录名。
"""
from __future__ import annotations

import hashlib
import html
import re
from datetime import datetime, timezone
from pathlib import Path

from ..textio import read_text_exact

CONFIG_NAME = "factscribe.toml"
MAX_DEPTH = 3

#: 扫描时跳过的目录名（版本库、依赖目录、构建产物……）。
SKIP_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "__pycache__", ".venv", "venv",
    ".mypy_cache", ".pytest_cache", ".ruff_cache", ".cache", ".idea",
    ".vscode", ".tox", ".eggs", "site-packages", "dist", "build",
    ".factscribe", ".DS_Store", "__MACOSX",
}

#: 目录名 → 语言。带 `-zh` 的是中文盘，其余按英文盘算。
_ZH_SUFFIX = "-zh"
_EN_SUFFIX = "-en"


# ---------------------------------------------------------------- 发现

def disk_language(name: str) -> str:
    """按目录名判断盘的语言：`xxx-zh` 是中文盘，`xxx-en` 与裸名是英文盘。"""
    lowered = name.lower()
    if lowered.endswith(_ZH_SUFFIX):
        return "zh"
    if lowered.endswith(_EN_SUFFIX):
        return "en"
    return "en"


def disk_base_name(name: str) -> str:
    """去掉语言后缀，得到配对用的根名。"""
    lowered = name.lower()
    for suffix in (_ZH_SUFFIX, _EN_SUFFIX):
        if lowered.endswith(suffix) and len(name) > len(suffix):
            return name[: -len(suffix)]
    return name


def discover_disks(root: str | Path, max_depth: int = MAX_DEPTH) -> list[Path]:
    """在 root 下面（深度受限）找出所有含 `factscribe.toml` 的目录。"""
    base = Path(root).expanduser()
    try:
        base = base.resolve()
    except OSError:
        return []
    if not base.is_dir():
        return []
    found: list[Path] = []
    base_depth = len(base.parts)

    def walk(current: Path, depth: int) -> None:
        if depth > max_depth:
            return
        try:
            entries = sorted(current.iterdir(), key=lambda p: p.name)
        except OSError:
            return
        for entry in entries:
            try:
                if not entry.is_dir() or entry.is_symlink():
                    continue
            except OSError:
                continue
            if entry.name in SKIP_DIRS or entry.name.startswith("."):
                continue
            if (entry / CONFIG_NAME).is_file():
                found.append(entry)
                continue
            walk(entry, depth + 1)

    if (base / CONFIG_NAME).is_file():
        found.append(base)
    walk(base, 1)
    unique: list[Path] = []
    seen: set[str] = set()
    for path in found:
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        unique.append(path)
    return unique


# ---------------------------------------------------------------- 聚合

_TITLE_CMD_RE = re.compile(r"\\title\s*\{")
# 标题里的排版命令：只影响观感，不该出现在页面上。
_TITLE_NOISE = ("\\large", "\\Large", "\\LARGE", "\\huge", "\\Huge",
                "\\bfseries", "\\rmfamily", "\\sffamily", "\\mdseries",
                "\\itshape", "\\upshape", "\\normalfont")
# `\\`（换行）后面可跟 `[4pt]` 这样的可选参数。
_TITLE_BREAK_RE = re.compile(r"\\\\(?:\[[^\]]*\])?")


def _clean_title(text: str) -> str:
    """去掉标题里的 LaTeX 排版味，留人读得懂的一句。"""
    out = text.replace("\\%", "%").replace("\\&", "&").replace("\\_", "_")
    for cmd in _TITLE_NOISE:
        out = out.replace(cmd, "")
    out = out.replace("{", "").replace("}", "")
    return " ".join(out.split())


def _title_files(path: Path) -> list[Path]:
    """这个盘自己的入口 .tex：先按项目声明的 `root_tex`，再按常见文件名。"""
    out: list[Path] = []
    try:
        from ..config import ConfigError, load_config
        cfg = load_config(path)
        if cfg.root_tex:
            target = path / cfg.root_tex
            if target.is_file():
                out.append(target)
    except Exception:  # noqa: BLE001 - 读不到声明就按常见文件名找
        pass
    for name in ("main.tex", "paper.tex", "root.tex"):
        target = path / name
        if target.is_file() and target not in out:
            out.append(target)
    return out


def _title_command(target: Path) -> tuple[int, int, str] | None:
    """这个文件里 `\\title{…}` 这条命令的位置：(起, 止, 原文)。

    找不到、标题体是空的、或剥掉排版味之后标题是空的 → 给 None
    （换下一个候选文件）。判定口径与读侧一字不差。
    """
    try:
        text = read_text_exact(target, errors="replace")
    except OSError:
        return None
    match = _TITLE_CMD_RE.search(text)
    if not match:
        return None
    body, end = _balanced(text, match.end() - 1)
    if not body.strip():
        return None
    pieces = [p for p in _TITLE_BREAK_RE.split(body)]
    if not (_clean_title(pieces[0]) if pieces else ""):
        return None
    return match.start(), end, text[match.start():end]


def title_command_span(path: Path) -> tuple[Path, int, int, str] | None:
    """盘入口 .tex 里 `\\title{…}` 的位置：(文件, 起, 止, 原文)。

    **读的是哪一条，写的就是哪一条**——读侧（封面标题）与写侧
    （`write.set_disk_title`）共用这一处定位，两边不许各自找一遍。
    """
    for target in _title_files(path):
        found = _title_command(target)
        if found is not None:
            start, end, raw = found
            return target, start, end, raw
    return None


def _tex_title_parts(path: Path) -> tuple[str, str]:
    """盘自己的标题：读这个盘入口 .tex 的 `\\title{…}` → (主标题, 副标题)。

    段二起，标题**分盘取**：中文盘显示中文标题，不再统一挂英题。
    段三再进一步：把 `\\large …`、`\\[4pt]` 这类排版命令剥掉，
    副标题（`\\` 之后那半句）单独返回，不跟主标题挤在一行里。
    """
    found = title_command_span(path)
    if found is None:
        return "", ""
    _target, _start, _end, raw = found
    body = raw[raw.index("{") + 1:raw.rindex("}")]
    pieces = [p for p in _TITLE_BREAK_RE.split(body)]
    title = _clean_title(pieces[0]) if pieces else ""
    subtitle = _clean_title(pieces[1]) if len(pieces) > 1 else ""
    return title, subtitle


def _tex_title(path: Path) -> str:
    """盘自己的主标题（分盘取，去排版味）。"""
    return _tex_title_parts(path)[0]


def _tex_subtitle(path: Path) -> str:
    """盘自己的副标题（`\\title{…}` 里 `\\` 之后那半句）。"""
    return _tex_title_parts(path)[1]


def _disk_title(path: Path) -> str:
    """盘名：先取这个盘自己的 `main.tex` 标题，再退回项目声明，最后目录名。"""
    from ..config import ConfigError, load_config

    tex_title = _tex_title(path)
    if tex_title:
        return tex_title
    try:
        cfg = load_config(path)
    except (ConfigError, OSError, ValueError):
        return path.name
    return (cfg.name or cfg.title or "").strip() or path.name


def _config_title(path: Path) -> str:
    """项目声明里的标题（不分盘）。"""
    from ..config import ConfigError, load_config

    try:
        cfg = load_config(path)
    except (ConfigError, OSError, ValueError):
        return ""
    return (cfg.name or cfg.title or "").strip()


def _disk_counts(path: Path) -> tuple[int, int]:
    """(sections 数, facts 数)；读坏了就当 0，不让整页崩掉。"""
    from ..config import ConfigError, load_config, load_facts, load_sections

    try:
        cfg = load_config(path)
    except (ConfigError, OSError, ValueError):
        return 0, 0
    try:
        sections = load_sections(cfg)
    except Exception:  # noqa: BLE001 - 坏文件不该让整页崩
        sections = []
    try:
        facts = load_facts(cfg)
    except Exception:  # noqa: BLE001
        facts = []
    return len(sections), len(facts)


def _disk_progress(path: Path) -> dict:
    """进度口径（写在这里，前端只显示，不另算）：

    **进度 = 已绑事实数 / 定量事实总数**。
    * 分母：账本（`facts/*.toml`）里 `value` 非空的事实数（定量事实）；
    * 分子：其中在本盘正文里出现过 `\\fact{ID}` 标记的事实数（已绑）；
    * 分母为 0（还没有定量事实）时进度记 0，界面显示「暂无定量事实」。
    """
    from ..config import ConfigError, load_config, load_facts

    empty = {"bound": 0, "total": 0, "percent": 0}
    try:
        cfg = load_config(path)
        facts = load_facts(cfg)
    except (ConfigError, OSError, ValueError):
        return empty
    total = {f.id for f in facts if str(getattr(f, "value", "") or "").strip()}
    if not total:
        return empty
    marked: set[str] = set()
    for _name, text in _section_files(path):
        for match in re.finditer(r"\\fact\s*\{([^{}]*)\}", text):
            for fid in match.group(1).split(","):
                fid = fid.strip()
                if fid:
                    marked.add(fid)
    bound = len(total & marked)
    return {"bound": bound, "total": len(total),
            "percent": int(round(bound * 100 / len(total)))}


def _workbench_table(path: Path) -> dict:
    """项目配置里的 `[workbench]` 表（工作台自己的字段：目录、最近打开…）。"""
    from ..config import load_toml

    config = path / CONFIG_NAME
    if not config.is_file():
        return {}
    try:
        data = load_toml(config)
    except Exception:  # noqa: BLE001 - 坏配置当没有
        return {}
    table = data.get("workbench")
    return table if isinstance(table, dict) else {}


def _disk_last_opened(path: Path) -> str:
    """最近打开时间：项目配置 `factscribe.toml` 的 `[workbench].last_opened`。"""
    return str(_workbench_table(path).get("last_opened") or "").strip()


def _disk_last_disk(path: Path) -> str:
    """这个盘自己记的「当前盘」标记：`[workbench].last_disk`。

    打开一个盘时由 `write.touch_opened` 写进去，值＝这个盘自己的盘号
    （目录名）。标记是**自指的**：某个盘的标记指向自己，就说明这个盘是
    这个项目最近打开的那一个。
    """
    return str(_workbench_table(path).get("last_disk") or "").strip()


def _opened_sort_key(text: str) -> float:
    """`last_opened` 的排序键（ISO 时间戳；认不出来的排最后）。"""
    raw = str(text or "").strip()
    if not raw:
        return 0.0
    try:
        return datetime.fromisoformat(raw).timestamp()
    except ValueError:
        return 0.0


def _config_mtime(disk_path: str) -> float:
    """盘配置文件的修改时间——`last_opened` 只到秒，同秒内靠它定先后。"""
    try:
        return (Path(disk_path) / CONFIG_NAME).stat().st_mtime
    except (OSError, TypeError, ValueError):
        return 0.0


def aggregate(disks: list[Path]) -> list[dict]:
    """把盘按根名聚合成项目。

    同一个父目录下、去掉语言后缀后同名的盘属于同一个项目；
    项目 id 取根名（重复时加序号），项目名取声明里的标题。
    """
    groups: dict[tuple[str, str], list[Path]] = {}
    for disk in disks:
        parent = str(disk.parent)
        base = disk_base_name(disk.name)
        groups.setdefault((parent, base), []).append(disk)

    projects: list[dict] = []
    used_ids: set[str] = set()
    for (parent, base), members in sorted(groups.items(), key=lambda kv: kv[0][1]):
        members = sorted(members, key=lambda p: (disk_language(p.name) != "en", p.name))
        project_id = _unique_id(base, used_ids)
        used_ids.add(project_id)
        disks_out = []
        for member in members:
            sections, facts = _disk_counts(member)
            bench = _workbench_table(member)
            disks_out.append({
                "id": member.name,
                "lang": disk_language(member.name),
                "name": _disk_title(member),
                "subtitle": _tex_subtitle(member),
                "path": str(member),
                "sections": sections,
                "facts": facts,
                "progress": _disk_progress(member),
                "last_opened": _disk_last_opened(member),
                "last_disk": _disk_last_disk(member),
                "project_dir": str(bench.get("project_dir") or member.name),
                "reports_dir": str(bench.get("reports_dir")
                                   or (bench.get("project_dir") or member.name)
                                   + "/reports"),
            })
        primary = next((d for d in disks_out if d["lang"] == "en"), disks_out[0])
        # 当前盘（P0-5）：项目里**最近打开过**的那一个盘——判据是盘自己的
        # [workbench].last_disk 指向自己，且 last_opened 最新。
        # 没有标记（从没在这个工作台打开过）就回落英文盘 → 第一个盘。
        marked = [d for d in disks_out
                  if d.get("last_disk") == d["id"] and d.get("last_opened")]
        current = primary
        if marked:
            # 次序：先看打开时间（到秒），同一秒里再看配置文件谁写得晚
            # （原子写会更新 mtime，精度到纳秒）——同秒内切盘也记得住。
            current = max(marked, key=lambda d: (
                _opened_sort_key(d.get("last_opened")),
                _config_mtime(d.get("path")),
                str(d.get("id") or "")))
        projects.append({
            "id": project_id,
            "name": _config_title(Path(primary["path"])) or primary["name"],
            "root": parent,
            "disks": disks_out,
            "last_disk": current["id"],
            # 单语项目（只有一个盘）→ 导航面板上的中/EN 切换整组隐藏。
            "multi_lang": len(disks_out) > 1,
            "langs": sorted({d["lang"] for d in disks_out if d.get("lang")}),
        })
    return projects


def _unique_id(base: str, used: set[str]) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", base).strip("-") or "project"
    if slug not in used:
        return slug
    index = 2
    while "%s-%d" % (slug, index) in used:
        index += 1
    return "%s-%d" % (slug, index)


def load_projects(root: str | Path, max_depth: int = MAX_DEPTH) -> list[dict]:
    """发现 + 聚合：给 `/api/projects` 用。"""
    return aggregate(discover_disks(root, max_depth=max_depth))


# ---------------------------------------------------------------- 渲染

_ENV_RE = re.compile(r"\\(begin|end)\s*\{([A-Za-z*]+)\}")
_HEADING_RE = re.compile(r"\\(section|subsection|subsubsection)\s*\*?\s*\{")
_FACT_RE = re.compile(r"\\fact\s*\{([^{}]*)\}")
_CITE_RE = re.compile(r"\\(cite|citep|citet|Cite)\s*\{([^{}]*)\}")
_REF_RE = re.compile(r"\\(ref|eqref|autoref)\s*\{([^{}]*)\}")
_TEXT_CMD_RE = re.compile(
    r"\\(textbf|bfseries|emph|textit|texttt|underline|textsf)\s*\{")
_INLINE_KEEP = ("url", "href")


def short_sha(text: str) -> str:
    """块指纹：raw 的 sha256（hex 前 16 位）——前端保存时带回当凭证。"""
    return hashlib.sha256(str(text or "").encode("utf-8")).hexdigest()[:16]


def bound_values_of(disk_root) -> set[str]:
    """盘里事实账上的 value（用于认「已绑定数字令牌」）；读不到就空集。"""
    from ..config import load_config, load_facts

    try:
        cfg = load_config(disk_root)
        facts = load_facts(cfg)
    except Exception:  # noqa: BLE001 - 账读不到就不按账认数字
        return set()
    return {fact.value for fact in facts if getattr(fact, "value", "")}

# ---------------------------------------------------------------- AI 草稿块

#: AI 草稿块的标记（写进 .tex 的注释行，渲染层与写回层共用）。
AI_DRAFT_BEGIN = "FACTSCRIBE-AI-DRAFT-BEGIN"
AI_DRAFT_END = "FACTSCRIBE-AI-DRAFT-END"

#: AI 草稿块用的环境（标准 LaTeX 的 quote——不需要改导言区就能编过）。
AI_DRAFT_ENV = "quote"

_AI_DRAFT_RE = re.compile(
    r"^[ \t]*%[ \t]*" + AI_DRAFT_BEGIN + r"[ \t]+(?P<id>\S+)[^\n]*\n"
    r"(?P<body>.*?)"
    r"^[ \t]*%[ \t]*" + AI_DRAFT_END + r"[ \t]+(?P<id2>\S+)[^\n]*",
    re.DOTALL | re.MULTILINE)

_AI_DRAFT_ENV_RE = re.compile(
    r"^[ \t]*\\begin\{" + AI_DRAFT_ENV + r"\}[ \t]*\n"
    r"(?P<inner>.*?)"
    r"^[ \t]*\\end\{" + AI_DRAFT_ENV + r"\}[ \t]*\n?",
    re.DOTALL | re.MULTILINE)


def ai_draft_regions(text: str) -> list[dict]:
    r"""找出文件里所有 AI 草稿块。

    每个区域给：`{id, region_start, region_end, inner_start, inner_end}`。
    `inner_*` 是**可编辑的散文区间**（环境的 `\begin`/`\end` 标记在外头，
    属文件结构，不进编辑块）；`region_*` 是整块（含标记行）的区间。
    """
    out: list[dict] = []
    for match in _AI_DRAFT_RE.finditer(text):
        body = match.group("body")
        body_start = match.start("body")
        inner_start, inner_end = body_start, match.end("body")
        env = _AI_DRAFT_ENV_RE.match(body)
        if env:
            inner_start = body_start + env.start("inner")
            inner_end = body_start + env.end("inner")
        # 散文区间不含结尾那个换行（那是环境的边界，不是正文）。
        while inner_end > inner_start and text[inner_end - 1] in "\n\r":
            inner_end -= 1
        out.append({
            "id": match.group("id"),
            "region_start": match.start(),
            "region_end": match.end(),
            "inner_start": inner_start,
            "inner_end": inner_end,
        })
    return out



def _strip_comments(text: str) -> str:
    r"""去掉 `%` 注释（`\%` 是字面百分号，保留）。"""
    out: list[str] = []
    for line in text.splitlines(keepends=True):
        kept: list[str] = []
        index = 0
        length = len(line)
        while index < length:
            char = line[index]
            if char == "\\" and index + 1 < length:
                kept.append(line[index:index + 2])
                index += 2
                continue
            if char == "%":
                while index < length and line[index] != "\n":
                    kept.append(" ")
                    index += 1
                continue
            kept.append(char)
            index += 1
        out.append("".join(kept))
    return "".join(out)


def _balanced(text: str, start: int) -> tuple[str, int]:
    """从 `{`（text[start]）起取配对花括号里的内容；返回 (内容, 结束下标)。"""
    if start >= len(text) or text[start] != "{":
        return "", start
    depth = 0
    index = start
    while index < len(text):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return text[start + 1:index], index + 1
        index += 1
    return text[start + 1:], len(text)


def _heading_title(text: str) -> tuple[str, str, int]:
    """读一行开头的 `\\section{...}`；返回 (级别, 标题, 消费到的下标)。"""
    match = _HEADING_RE.match(text)
    if not match:
        return "", "", 0
    level = {"section": 1, "subsection": 2, "subsubsection": 3}[match.group(1)]
    body, end = _balanced(text, match.end() - 1)
    return level, body, end


def _inline(text: str) -> str:
    """行内命令 → HTML（文本已经转义过）。"""
    out = text
    # \fact{ID} → 事实芯片（沿用原型的 .fc 样式）
    out = _FACT_RE.sub(
        lambda m: '<span class="fc" tabindex="0" data-fact="%s" role="button" '
                  'aria-label="有据的数字，查看出处">✓</span>' % m.group(1).strip(),
        out)
    # 强调类命令：把花括号内容换成带标签的
    def emph(match: re.Match) -> str:
        body, end = _balanced(out, match.end() - 1)
        tag = {"textbf": "b", "bfseries": "b", "emph": "i", "textit": "i",
               "texttt": "code", "underline": "u", "textsf": "span"}[match.group(1)]
        return "<%s>%s</%s>" % (tag, body, tag)

    previous = None
    while previous != out:
        previous = out
        out = _TEXT_CMD_RE.sub(emph, out)
    # 引用与交叉引用
    out = _CITE_RE.sub(
        lambda m: '<span class="cite">[%s]</span>' % m.group(2).strip(), out)
    out = _REF_RE.sub(
        lambda m: '<span class="xref">[%s]</span>' % m.group(2).strip(), out)
    # 其余命令一律去掉（含花括号参数）
    out = re.sub(r"\\[A-Za-z@]+\s*\*?\s*\[[^\]]*\]\s*\{[^{}]*\}", "", out)
    out = re.sub(r"\\[A-Za-z@]+\s*\*?\s*\[[^\]]*\]", "", out)
    out = re.sub(r"\\[A-Za-z@]+\s*\*?\s*\{[^{}]*\}", "", out)
    out = re.sub(r"\\[A-Za-z@]+\s*\*?", "", out)
    out = out.replace("~", " ").replace("---", "—").replace("--", "–")
    out = out.replace("\\%", "%").replace("\\&", "&").replace("\\_", "_")
    return out


# ------------------------------------------------ 条目 43：保护面芯片烤进渲染

#: 客户端与服务端之间的占位符（私用区字符，LaTeX 正文里不会出现）。
#: 定义在渲染层（芯片烤进 html 要用），写回层从这里 import——单一来源，
#: 两边口径永不走样。
TOKEN_OPEN = "\ue000"
TOKEN_CLOSE = "\ue001"
TOKEN_RE = re.compile(TOKEN_OPEN + r"P(\d+)" + TOKEN_CLOSE)

#: 芯片显示文案的字数上限（与写回层 _display 同口径：>18 截到 17＋省略号）。
_CHIP_DISPLAY_LIMIT = 18


def token_of(index: int) -> str:
    """段内第 i 个保护面的占位符：\\ue000P<i>\\ue001。"""
    return "%sP%d%s" % (TOKEN_OPEN, index, TOKEN_CLOSE)


def chip_display(label: str, text: str) -> str:
    """芯片上的字（写回层 _display 的同源实现，两边不许走样）：

    \\fact{A1} → 「✓ A1」，\\cite{k} → 「[k]」，数字 → 数字，
    环境 → 「⟨名⟩」，其余原样（过长截断）。
    """
    if label == "fact":
        match = re.match(r"\\fact\s*\{([^{}]*)\}", text)
        if match:
            return "✓ %s" % match.group(1).strip()
        return "✓"
    if label in ("cite", "ref"):
        match = re.search(r"\{([^{}]*)\}", text)
        if match:
            return "[%s]" % match.group(1).strip()
        return text
    if label == "num":
        return text
    if label == "env":
        env = re.search(r"\{([^{}]*)\}", text)
        return "⟨%s⟩" % (env.group(1) if env else "env")
    if len(text) > _CHIP_DISPLAY_LIMIT:
        return text[:_CHIP_DISPLAY_LIMIT - 1] + "…"
    return text


def _prot_chip_html(index: int, label: str, raw: str) -> str:
    """一枚保护面芯片的 html：data-token 带身份，芯片内不可编辑。"""
    token = token_of(index)
    display = chip_display(label, raw)
    if label == "fact":
        match = re.match(r"\\fact\s*\{([^{}]*)\}", raw)
        fact_id = match.group(1).strip() if match else ""
        return ('<span class="fc prot-chip" tabindex="0" data-fact="%s" '
                'data-token="%s" contenteditable="false" role="button" '
                'title="%s" aria-label="有据的数字，查看出处">%s</span>'
                % (html.escape(fact_id, quote=True), token,
                   html.escape(raw, quote=True), html.escape(display)))
    return ('<span class="prot-chip" data-token="%s" contenteditable="false" '
            'title="%s">%s</span>'
            % (token, html.escape(raw, quote=True), html.escape(display)))


def render_prot_html(chunk: str, bound_values=frozenset()) -> str:
    """一段原文 → 带保护面芯片的行内 html（不含 ``<p>`` 外壳）。

    条目 43：页面本身就是编辑器——保护面（``\\fact{}``、``\\cite{}``、
    ``\\ref{}``、绑定数字、整块环境……）直接以芯片形态烤进渲染 html，
    每枚芯片自带 ``data-token``（与写回层 scan 的段内序号一一对应）。
    前端收集文本时读回「散文＋token」，服务端原样拼回，不再有渲染态↔编辑态。
    """
    from .write import scan

    segments = scan(chunk, bound_values)
    plain = "".join(
        seg.text if seg.kind == "text" else token_of(seg.index)
        for seg in segments)
    body = _inline(html.escape(plain, quote=False))
    body = re.sub(r"[ \t]+", " ", body)
    body = re.sub(r"\n+", " ", body).strip()
    if not body:
        return ""
    # 占位符换成芯片（最后一步做：芯片里的显示文本不再过转义/剥命令管线）。
    for seg in segments:
        if seg.kind != "prot":
            continue
        body = body.replace(token_of(seg.index),
                            _prot_chip_html(seg.index, seg.label, seg.text))
    return body


def render_tex(text: str, stem: str = "sec",
               disk_root=None) -> list[dict]:
    """把一段 LaTeX 渲染成块列表。

    块：`{"kind", "id", "level", "title", "title_en", "html", "start", "end",
    "raw", "sha"}`。`kind` 取 abstract / section / subsection / para。

    `start`/`end` 是这一块在**原文**里的偏移（`_strip_comments` 等长替换，
    偏移与原文一一对应），`raw` 是原文片段——段二的写回按偏移精确回填。

    条目 43：`disk_root` 给了就拿盘上的事实账认绑定数字，保护面以芯片形态
    烤进 html（`data-token` 序号与写回层 `editable_model` 的 scan 完全一致）；
    没给就退化——命令类片段（fact/cite/ref/env）与紧跟 `\\fact` 的数字照编，
    账本同值数字（规则二）无账可对不编。每块另带 `sha`（raw 的短指纹，
    保存闸用）。
    """
    values = (bound_values_of(disk_root)
              if disk_root is not None else frozenset())
    source = _strip_comments(text)
    blocks: list[dict] = []
    buffer: list[str] = []
    buffer_start = 0
    #: 这一段在**文件**里的右界（缓冲区最后一个字符之后的位置）。
    buffer_end = 0
    #: 这一段是不是已经开着了（开了就不改左界——环境标记也算段的一部分）。
    region_open = False
    in_abstract = False
    index = 0
    counter = 0
    length = len(source)
    # 段六：AI 草稿块——整块跳过普通扫描，单独渲染成一块。
    regions = ai_draft_regions(text)
    region_at = 0

    def flush() -> None:
        nonlocal buffer, buffer_start, buffer_end, region_open
        raw = "".join(buffer)
        chunk = raw.strip()
        # 起止按**文件偏移**算，不再用「缓冲区长度」倒推。
        # 环境标记（begin/end 标记）不进缓冲区，却占着文件里的位置——
        # 拿缓冲区长度当长度，这一段会被截断在半截命令上（渲染少半句、
        # 写回按同样的偏移回填，尾巴错位）。
        span_source = source[buffer_start:buffer_end]
        lead = len(span_source) - len(span_source.lstrip())
        trail = len(span_source) - len(span_source.rstrip())
        start = buffer_start + lead
        end = buffer_end - trail
        buffer = []
        buffer_start = index
        buffer_end = index
        region_open = False
        if not chunk:
            return
        # 条目 43：html 一律从**块原文（span）**烤出——环境标记虽不进缓冲区，
        # 却落在 span 里；写回层的模型对同一份 raw scan，两边 token 序号
        # 只有在同一份原文上才对得齐（烤自缓冲区会错位）。
        span = text[start:end]
        body = render_prot_html(span, values)
        if not body:
            return
        blocks.append({
            "kind": "abstract" if in_abstract else "para",
            "id": "%s-p%d" % (stem, len(blocks)),
            "level": 0, "title": "", "title_en": "",
            "html": "<p>%s</p>" % body,
            "start": start, "end": end, "raw": span,
            "sha": short_sha(span),
        })

    while index < length:
        if region_at < len(regions) and index >= regions[region_at]["region_start"]:
            region = regions[region_at]
            region_at += 1
            flush()
            inner = text[region["inner_start"]:region["inner_end"]]
            body = render_prot_html(inner, values)
            blocks.append({
                "kind": "ai_draft",
                "id": "%s-%s" % (stem, region["id"]),
                "level": 0, "title": "", "title_en": "",
                "html": ('<div class="aidraft"><p>%s</p></div>' % body) if body else "",
                "start": region["inner_start"], "end": region["inner_end"],
                "raw": inner,
                "sha": short_sha(inner),
                "draft_id": region["id"],
                "region_start": region["region_start"],
                "region_end": region["region_end"],
            })
            index = region["region_end"]
            continue
        char = source[index]
        if char == "\\":
            env = _ENV_RE.match(source, index)
            if env:
                name = env.group(2).lower()
                if env.group(1) == "begin" and name == "abstract":
                    flush()
                    in_abstract = True
                elif env.group(1) == "end" and name == "abstract":
                    flush()
                    in_abstract = False
                if not region_open:
                    buffer_start = index
                    region_open = True
                index = env.end()
                buffer_end = index
                continue
            level, title, end = _heading_title(source[index:])
            if level:
                flush()
                counter += 1
                clean = _inline(html.escape(title, quote=False)).strip()
                blocks.append({
                    "kind": "section" if level == 1 else "subsection",
                    "id": "%s-s%d" % (stem, counter),
                    "level": level, "title": clean, "title_en": "",
                    "html": "",
                    "start": index, "end": index + end,
                    "raw": text[index:index + end],
                    "sha": short_sha(text[index:index + end]),
                })
                index += end
                buffer_end = index
                continue
        if char == "\n" and source[index:index + 2] == "\n":
            flush()
            index += 2
            continue
        if not region_open:
            buffer_start = index
            region_open = True
        buffer.append(char)
        index += 1
        buffer_end = index
    flush()
    return blocks


def _section_files(path: Path) -> list[tuple[str, str]]:
    r"""读盘里的章节文件：[(相对名, 文本)]。

    走审计那套闭包（`load_sections`）：配置写 `sections/*.tex` 时收章节，
    写 `main.tex` 时收 `\input` 链。根文件（main.tex）的导言区不当作正文，
    还有别的章节文件时把它剔掉。
    """
    from ..config import ConfigError, load_config, load_sections

    try:
        cfg = load_config(path)
    except (ConfigError, OSError, ValueError):
        return []
    rows: list[tuple[str, str]] = []
    try:
        for row in load_sections(cfg):
            try:
                name, text = row
            except (TypeError, ValueError):
                continue
            rows.append((str(name), str(text)))
    except Exception:  # noqa: BLE001 - 坏文件不该让整页崩
        rows = []
    if rows:
        root_tex = Path(cfg.root_tex or "main.tex").name
        kept = [(name, text) for name, text in rows
                if Path(name).name != root_tex
                and not _is_generated(name)]
        kept.sort(key=lambda row: _file_order(row[0]))
        return kept or rows
    pattern = cfg.sections_glob or "sections/*.tex"
    out: list[tuple[str, str]] = []
    try:
        candidates = sorted(path.glob(pattern))
    except (OSError, ValueError):
        candidates = []
    for candidate in candidates:
        try:
            out.append((str(candidate.relative_to(path)),
                        read_text_exact(candidate, errors="replace")))
        except (OSError, ValueError):
            continue
    return out


def _is_generated(rel: str) -> bool:
    """生成的工件（audit/ 下的宏定义等）不是正文。"""
    parts = Path(rel).parts
    return bool(parts) and parts[0] in ("audit", "results")


def _file_order(rel: str) -> tuple:
    """正文顺序：sections/ 在前，其余按路径排。"""
    parts = Path(rel).parts
    head = parts[0] if parts else ""
    return (0 if head == "sections" else 1, rel)


def _titles_by_stem(path: Path) -> dict[str, str]:
    """{章节文件名: 标题}——给双语盘配英文标题用。"""
    titles: dict[str, str] = {}
    for name, text in _section_files(path):
        stem = Path(name).stem
        for block in render_tex(text, stem=stem):
            if block["kind"] == "section" and block["title"]:
                titles[stem] = block["title"]
                break
    return titles


def disk_sections(path: str | Path, lang: str = "") -> dict:
    """一个盘的章节内容：块列表 + 标题（含配对盘的英文标题）。

    封面摘要块（`cover-abstract`）也在这份列表里：渲染层与写回层共用同一套
    闭包定位——摘要在哪个文件就定位在哪个文件（根文件的 abstract 环境，
    或独立节文件 `sections/00_abstract.tex`）。
    """
    root = Path(path)
    paired = _paired_titles(root) if lang == "zh" else {}
    blocks: list[dict] = []
    for name, text in _section_files(root):
        stem = Path(name).stem
        for block in render_tex(text, stem=stem, disk_root=root):
            block["file"] = name
            if block["kind"] == "section" and not block["title_en"]:
                block["title_en"] = paired.get(stem, "")
            blocks.append(block)
    _attach_cover_abstract(root, blocks)
    return {"blocks": blocks, "count": len(blocks)}


# ---------------------------------------------------------------- 封面摘要（渲染闭包）

#: 封面摘要块的固定 id（前端按这个 id 就地编辑）。
ABSTRACT_BLOCK_ID = "cover-abstract"

_ABSTRACT_BEGIN_RE = re.compile(r"\\begin\s*\{abstract\}")
_ABSTRACT_END_RE = re.compile(r"\\end\s*\{abstract\}")

#: 独立摘要节文件的名字特征（`00_abstract.tex` / `abstract.tex` / `00-abstract.tex`…）。
_ABSTRACT_FILE_RE = re.compile(r"^(?:[\d_.-]*[-_])?abstract$", re.IGNORECASE)


def abstract_env_spans(text: str) -> list[tuple[int, int]]:
    """文件里所有 `abstract` 环境的内容区间（绝对偏移，平衡配对）。

    配对时数嵌套：`\\begin{abstract} … \\begin{abstract} … \\end{abstract} …
    \\end{abstract}` 里，外层环境的区间**包含**内层那一段。
    """
    spans: list[tuple[int, int]] = []
    pos = 0
    while True:
        begin = _ABSTRACT_BEGIN_RE.search(text, pos)
        if not begin:
            break
        depth = 1
        scan = begin.end()
        end_pos = None
        while depth > 0:
            nested = _ABSTRACT_BEGIN_RE.search(text, scan)
            closing = _ABSTRACT_END_RE.search(text, scan)
            if closing is None:
                break
            if nested is not None and nested.start() < closing.start():
                depth += 1
                scan = nested.end()
                continue
            depth -= 1
            end_pos = closing.start()
            scan = closing.end()
        if end_pos is None:
            break
        spans.append((begin.end(), end_pos))
        pos = scan
    return spans


def abstract_content_range(text: str) -> tuple[int, int] | None:
    """摘要**散文**的内容区间（绝对偏移，不含环境标记）。

    取最内层 `abstract` 环境的内容（嵌套时外层区间含内层，故要往里再挖一层）；
    找不到环境返回 None。
    """
    spans = abstract_env_spans(text)
    if not spans:
        return None
    start, end = spans[-1]
    inner = text[start:end]
    nested = abstract_env_spans(inner)
    if nested:
        s2, e2 = nested[-1]
        return (start + s2, start + e2)
    return (start, end)


def abstract_env_span(text: str) -> tuple[int, int, int, int] | None:
    """摘要散文区间 + 两头空白长度。

    返回 (内容起点, 内容终点, 前导空白长度, 尾部空白长度)；找不到返回 None。
    内容两头的空白另算——写回时照原样保留，版式不塌。
    """
    rng = abstract_content_range(text)
    if rng is None:
        return None
    start, end = rng
    core = text[start:end]
    lead = len(core) - len(core.lstrip())
    trail = len(core) - len(core.rstrip())
    return (start, end, lead, trail)


def abstract_prose(text: str) -> str:
    """提交文本里的摘要散文。

    提交文本若**自带** `abstract` 环境（整段环境甚至整份文件被回传），只取
    环境内的散文：写回时不再包一层环境，也不重生成环境外的标记行
    （`% FACTS-USED` 之类属于文件原有结构，不在编辑块范围内）。
    没有环境时原样返回。
    """
    rng = abstract_content_range(text)
    if rng is None:
        return text
    start, end = rng
    return text[start:end].strip()



def _looks_like_abstract_file(rel: str) -> bool:
    """这个节文件是不是「独立摘要节」（`00_abstract.tex` 这种）。"""
    stem = Path(rel).stem
    if _ABSTRACT_FILE_RE.match(stem):
        return True
    return False


def cover_abstract_block(path: str | Path) -> dict | None:
    """封面摘要块：走渲染闭包定位（file/start/end/raw 一起给）。

    两种布局都认：

    1. **节文件式**（sectioned）：摘要是独立节文件 `sections/00_abstract.tex`
       （内容自带 `\\begin{abstract}…\\end{abstract}`），经 `\\input` 装配；
    2. **根文件式**：摘要在根文件 `main.tex` 的 `abstract` 环境里。

    找不到就返回 None（前端据此不渲染封面摘要区）。
    """
    root = Path(path)
    values = bound_values_of(root)
    # 1) 闭包里的节文件：优先「像摘要文件」的，其次任何带 abstract 环境的。
    fallback = None
    for name, text in _section_files(root):
        span = abstract_env_span(text)
        if not span:
            continue
        start, end, lead, trail = span
        raw = text[start + lead:end - trail]
        info = {"id": ABSTRACT_BLOCK_ID, "kind": "abstract", "file": name,
                "start": start + lead, "end": end - trail,
                "raw": raw, "title": "",
                "level": 0,
                "html": render_abstract_html(raw, values),
                "sha": short_sha(raw), "title_en": ""}
        if _looks_like_abstract_file(name):
            return info
        if fallback is None:
            fallback = info
    if fallback is not None:
        return fallback
    # 2) 根文件（main.tex）的 abstract 环境（sectioned 布局下根文件被闭包剔除）
    rel, root_tex = _root_tex_rel_and_path(root)
    if root_tex is None:
        return None
    try:
        text = read_text_exact(root_tex)
    except (OSError, UnicodeDecodeError):
        return None
    span = abstract_env_span(text)
    if not span:
        return None
    start, end, lead, trail = span
    raw = text[start + lead:end - trail]
    return {"id": ABSTRACT_BLOCK_ID, "kind": "abstract", "file": rel,
            "start": start + lead, "end": end - trail,
            "raw": raw, "title": "",
            "level": 0,
            "html": render_abstract_html(raw, values),
            "sha": short_sha(raw), "title_en": ""}


def render_abstract_html(raw: str, values=frozenset()) -> str:
    """摘要散文的带芯片渲染（``<p>`` 一层壳，前端就地换 innerHTML 用）。"""
    body = render_prot_html(raw, values)
    return ("<p>%s</p>" % body) if body else ""


def _root_tex_rel_and_path(root: Path) -> tuple[str, Path | None]:
    """根文件（配置里的 `root_tex`，没有就 `main.tex`）：相对名与绝对路径。"""
    from ..config import ConfigError, load_config

    rel = ""
    try:
        cfg = load_config(root)
        rel = str(getattr(cfg, "root_tex", "") or "").strip()
    except (ConfigError, OSError, ValueError):
        rel = ""
    rel = rel or "main.tex"
    target = root / rel
    return rel, (target if target.is_file() else None)


def _attach_cover_abstract(root: Path, blocks: list[dict]) -> None:
    """把封面摘要块挂进块列表（固定 id `cover-abstract`）。

    闭包里本来就有 abstract 块 → 就地换 id（渲染层与写回层同一套定位）；
    没有（摘要在根文件里）→ 补一块进来。
    """
    cover = cover_abstract_block(root)
    if not cover:
        return
    for block in blocks:
        if (block.get("kind") == "abstract"
                and block.get("file") == cover["file"]
                and block.get("start") == cover["start"]):
            block["id"] = cover["id"]
            return
    blocks.insert(0, cover)



def _paired_titles(path: Path) -> dict[str, str]:
    """找同父目录下另一个语言盘的 {文件名: 标题}。"""
    sibling = None
    name = path.name
    base = disk_base_name(name)
    for candidate in path.parent.iterdir():
        if not candidate.is_dir() or candidate == path:
            continue
        if not (candidate / CONFIG_NAME).is_file():
            continue
        if disk_base_name(candidate.name) != base:
            continue
        if disk_language(candidate.name) == disk_language(name):
            continue
        sibling = candidate
        break
    if sibling is None:
        return {}
    return _titles_by_stem(sibling)


def disk_meta(path: str | Path, lang: str = "") -> dict:
    """状态行数据：事实条数、章节数、最近编译时间。"""
    from ..config import ConfigError, load_config

    root = Path(path)
    sections, facts = _disk_counts(root)
    title = _disk_title(root)
    subtitle = _tex_subtitle(root)
    # 标题那条命令的短指纹——改标题时上交给服务端的指纹闸用
    # （状态行里多带一个字段：只增不改，读数形状不变）。
    span = title_command_span(root)
    title_sha = short_sha(span[3]) if span else ""
    built = ""
    built_file = ""
    try:
        cfg = load_config(root)
        output = cfg.output or "main.pdf"
    except (ConfigError, OSError, ValueError):
        output = "main.pdf"
    for candidate in (output, "main.pdf", "main.log"):
        target = root / candidate
        if target.is_file():
            try:
                stamp = datetime.fromtimestamp(target.stat().st_mtime, timezone.utc)
            except OSError:
                continue
            built = stamp.isoformat(timespec="seconds")
            built_file = candidate
            break
    return {
        "path": str(root),
        "name": title,
        "subtitle": subtitle,
        "title_sha": title_sha,
        "lang": lang or disk_language(root.name),
        "facts": facts,
        "sections": sections,
        "last_build": built,
        "last_build_file": built_file,
    }
