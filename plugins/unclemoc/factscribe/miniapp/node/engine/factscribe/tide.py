# -*- coding: utf-8 -*-
"""潮汐式改动账（SPEC-TIDE，批 89）。

改动本身是一个事务：**涨**（两个目录的哈希差）、**落**（改后真实文件状态）、
**波及面**（\\input/\\include 反向引用闭包）全部由工具派生，人不提供任何清单。

闭合＝ ``paired ∧ hash_ok ∧ pass_all``；闭合才写 append-only 账本与派生视图，
否则全退（不落盘、退出码 1）。

保护面的抽取与判据**复用** ``protect``：``_code_view`` / ``_heading_items`` /
``compare``，不改 ``audit`` / ``style`` / ``protect`` 的任何既有判据与退出码。
"""
from __future__ import annotations

import difflib
import fnmatch
import hashlib
import json
import os
import posixpath
import re
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from .config import ConfigError
from .constants import EXIT_OK, EXIT_RED, SEV_RED
from .protect import _code_view, _heading_items
from .protect import compare as compare_protect

RISE = "rise"
FALL = "fall"
VERDICT = "verdict"
_KINDS = (RISE, FALL, VERDICT)

LEDGER_NAME = "tide-events.ndjson"
VIEW_NAME = "tide-ledger.md"

# 默认忽略表：LaTeX 编译中间产物（批 89b）。只按后缀忽略，源码/资料照常入账。
DEFAULT_IGNORE = (
    "*.aux", "*.log", "*.out", "*.blg", "*.bbl", "*.fls",
    "*.fdb_latexmk", "*.synctex.gz", "*.toc", "*.lof", "*.lot",
    "*.nav", "*.snm", "*.vrb",
)


# --------------------------------------------------------------------------
# 数据模型
# --------------------------------------------------------------------------

@dataclass
class Rise:
    path: str
    before: str | None
    after: str | None
    lines: list[str] = field(default_factory=list)
    sections: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"event": RISE, "path": self.path, "before": self.before,
                "after": self.after, "lines": list(self.lines),
                "sections": list(self.sections)}


@dataclass
class Fall:
    path: str
    exists: bool
    sha256: str | None

    def as_dict(self) -> dict:
        return {"event": FALL, "path": self.path, "exists": self.exists,
                "sha256": self.sha256}


@dataclass
class TideResult:
    before: Path
    after: Path
    tx: str
    status: str
    paired: bool
    hash_ok: bool
    pass_all: bool
    rises: list[Rise]
    falls: list[Fall]
    affect: list[str]
    findings: list
    reasons: list[str]
    ledger_path: Path
    view_path: Path
    view_written: bool = False
    rows: list[dict] = field(default_factory=list)
    appends: int = 0
    ignored: list[str] = field(default_factory=list)
    ignore: tuple[str, ...] = ()

    @property
    def closed(self) -> bool:
        return self.status == "commit"

    @property
    def exit_code(self) -> int:
        return EXIT_OK if self.closed else EXIT_RED

    def criteria(self) -> dict:
        return {"paired": self.paired, "hash_ok": self.hash_ok,
                "pass_all": self.pass_all}


# --------------------------------------------------------------------------
# 哈希与库存
# --------------------------------------------------------------------------

def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _read_bytes(path: Path, rel: str) -> bytes:
    try:
        return path.read_bytes()
    except OSError as exc:
        raise ConfigError("读不了 %s：%s" % (rel, exc)) from exc


def _text(root: Path, rel: str) -> str | None:
    path = root / rel
    if not path.is_file():
        return None
    try:
        return _read_bytes(path, rel).decode("utf-8")
    except UnicodeDecodeError:
        return None


def _ignored(rel: str, patterns: tuple[str, ...]) -> bool:
    """相对路径是否命中忽略表（fnmatch；``*`` 跨目录，``*.aux`` 覆盖任意层级）。"""
    return any(fnmatch.fnmatchcase(rel, pattern) for pattern in patterns)


def _scan(root: Path, exclude: set[str], patterns: tuple[str, ...]
          ) -> tuple[dict[str, str], dict[str, str]]:
    """扫一棵树 → (入账文件, 被忽略文件)，两者都是 相对路径 → 字节 sha256。

    跳过隐藏路径、顶层 audit/ 与产出本体；命中忽略表的文件不进入账面
    （因此既不产生涨，也不进波及面），但哈希照记，便于报「忽略了几项」。
    """
    counted: dict[str, str] = {}
    ignored: dict[str, str] = {}
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        parts = rel.split("/")
        if any(part.startswith(".") for part in parts):
            continue
        if parts[0] == "audit":
            continue
        if str(p.resolve()) in exclude:
            continue
        digest = _sha256_bytes(_read_bytes(p, rel))
        if _ignored(rel, patterns):
            ignored[rel] = digest
        else:
            counted[rel] = digest
    return counted, ignored


# --------------------------------------------------------------------------
# 涨：行区间与章节
# --------------------------------------------------------------------------

def _span(start: int, end: int) -> str:
    return str(start) if start == end else "%d-%d" % (start, end)


def _diff_spans(before: str, after: str) -> list[tuple[int, int]]:
    """行级差异 → 合并后的行区间（改后侧行号；纯删除用改前侧行号）。"""
    a = before.splitlines()
    b = after.splitlines()
    matcher = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    spans: list[tuple[int, int]] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        if tag in ("replace", "insert"):
            if j2 > j1:
                spans.append((j1 + 1, j2))
        elif i2 > i1:
            spans.append((i1 + 1, i2))
    spans.sort()
    merged: list[tuple[int, int]] = []
    for start, end in spans:
        if merged and start <= merged[-1][1] + 1:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _sections_of(text: str, spans: list[tuple[int, int]]) -> list[str]:
    if not text or not spans:
        return []
    headings = _heading_items(_code_view(text))
    out: list[str] = []
    for start, _end in spans:
        chosen = None
        for head in headings:
            if head.line <= start:
                chosen = head
            else:
                break
        if chosen is not None and chosen.title and chosen.title not in out:
            out.append(chosen.title)
    return out


def _touch(before_text: str | None, after_text: str | None
           ) -> tuple[list[str], list[str]]:
    if before_text is None and after_text is None:
        return [], []
    if before_text is None:
        n = len(after_text.splitlines())
        spans = [(1, n)] if n else []
        return [_span(*s) for s in spans], _sections_of(after_text, spans)
    if after_text is None:
        n = len(before_text.splitlines())
        spans = [(1, n)] if n else []
        return [_span(*s) for s in spans], _sections_of(before_text, spans)
    spans = _diff_spans(before_text, after_text)
    return [_span(*s) for s in spans], _sections_of(after_text, spans)


def _rises(before: Path, after: Path, bfiles: dict[str, str],
           afiles: dict[str, str]) -> list[Rise]:
    out: list[Rise] = []
    for rel in sorted(set(bfiles) | set(afiles)):
        bhash = bfiles.get(rel)
        ahash = afiles.get(rel)
        if bhash == ahash:
            continue
        lines: list[str] = []
        sections: list[str] = []
        if rel.endswith(".tex"):
            lines, sections = _touch(_text(before, rel), _text(after, rel))
        out.append(Rise(path=rel, before=bhash, after=ahash,
                        lines=lines, sections=sections))
    return out


# --------------------------------------------------------------------------
# 落：改后真实文件状态（重新读盘）
# --------------------------------------------------------------------------

def _falls(after: Path, rises: list[Rise]) -> list[Fall]:
    out: list[Fall] = []
    for rise in rises:
        path = after / rise.path
        exists = path.is_file()
        digest = (_sha256_bytes(_read_bytes(path, rise.path))
                  if exists else None)
        out.append(Fall(path=rise.path, exists=exists, sha256=digest))
    return out


# --------------------------------------------------------------------------
# 波及面：\input / \include 反向闭包
# --------------------------------------------------------------------------

_INPUT_RE = re.compile(r"\\(?:input|include)\s*\{([^}]*)\}")


def _ref_candidates(base: str, raw: str) -> list[str]:
    """\\input 目标的两个候选：项目根相对（LaTeX 默认）→ 引用文件目录相对。"""
    name = raw.strip()
    if not name or name.startswith("/"):
        return []
    if not name.endswith(".tex"):
        name += ".tex"
    out = [posixpath.normpath(name)]
    if base:
        alt = posixpath.normpath(posixpath.join(base, name))
        if alt not in out:
            out.append(alt)
    return out


def _referrers(before: Path, after: Path, bfiles: dict[str, str],
               afiles: dict[str, str]) -> dict[str, set[str]]:
    known = set(bfiles) | set(afiles)
    refs: dict[str, set[str]] = {}
    for root, files in ((before, bfiles), (after, afiles)):
        for rel in sorted(files):
            if not rel.endswith(".tex"):
                continue
            text = _text(root, rel)
            if text is None:
                continue
            base = posixpath.dirname(rel)
            for match in _INPUT_RE.finditer(_code_view(text)):
                for target in _ref_candidates(base, match.group(1)):
                    if target in known:
                        refs.setdefault(target, set()).add(rel)
                        break
    return refs


def _closure(changed: set[str], refs: dict[str, set[str]]) -> list[str]:
    seen = set(changed)
    stack = list(changed)
    while stack:
        cur = stack.pop()
        for referrer in sorted(refs.get(cur, ())):
            if referrer not in seen:
                seen.add(referrer)
                stack.append(referrer)
    return sorted(seen)


# --------------------------------------------------------------------------
# 账本读写
# --------------------------------------------------------------------------

def _read_ledger(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ConfigError("读不了账本 %s：%s" % (path, exc)) from exc
    events: list[dict] = []
    for lineno, line in enumerate(raw.splitlines(), 1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ConfigError("账本第 %d 行不是合法 JSON：%s"
                              % (lineno, exc)) from exc
        if not isinstance(event, dict) or event.get("event") not in _KINDS:
            raise ConfigError("账本第 %d 行事件类型不合法" % lineno)
        if not event.get("tx"):
            raise ConfigError("账本第 %d 行缺 tx" % lineno)
        events.append(event)
    return events


def _event_line(event: dict) -> str:
    return json.dumps(event, sort_keys=True, ensure_ascii=False)


def _append_ledger(path: Path, events: list[dict]) -> int:
    """append-only 追加；整行去重（同一事务重复跑不重复记账）。"""
    lines = [_event_line(e) for e in events]
    existing: set[str] = set()
    if path.exists():
        try:
            existing = {line for line in
                        path.read_text(encoding="utf-8").splitlines()
                        if line.strip()}
        except OSError as exc:
            raise ConfigError("读不了账本 %s：%s" % (path, exc)) from exc
    new = [line for line in lines if line not in existing]
    if not new:
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        for line in new:
            fh.write(line + "\n")
    return len(new)


def _tx_id(rises: list[Rise], falls: list[Fall]) -> str:
    blob = json.dumps({"rises": [r.as_dict() for r in rises],
                       "falls": [f.as_dict() for f in falls]},
                      sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def _tx_events(tx: str, rises: list[Rise], falls: list[Fall],
               affect: list[str], status: str) -> list[dict]:
    events: list[dict] = []
    for rise in rises:
        event = rise.as_dict()
        event["tx"] = tx
        events.append(event)
    for fall in falls:
        event = fall.as_dict()
        event["tx"] = tx
        events.append(event)
    events.append({"event": VERDICT, "tx": tx, "status": status,
                   "rises": len(rises), "falls": len(falls),
                   "affect": list(affect)})
    return events


# --------------------------------------------------------------------------
# 判据：paired / hash_ok
# --------------------------------------------------------------------------

def _paired(rises: list[Rise], falls: list[Fall], ledger: list[dict]) -> tuple:
    reasons: list[str] = []
    rise_paths = sorted(r.path for r in rises)
    fall_paths = sorted(f.path for f in falls)
    ok = rise_paths == fall_paths

    groups: dict[str, dict[str, set]] = {}
    for event in ledger:
        if event.get("event") not in (RISE, FALL):
            continue
        group = groups.setdefault(event.get("tx"),
                                  {RISE: set(), FALL: set()})
        group[event["event"]].add(event.get("path"))
    for tx in sorted(groups):
        missing = groups[tx][RISE] - groups[tx][FALL]
        if missing:
            ok = False
            reasons.append("账本事务 %s 有涨无落（漏报）：%s"
                           % (tx, "、".join(sorted(missing))))
    return ok, reasons


def _hash_ok(before: Path, after: Path, rises: list[Rise],
             falls: list[Fall], ledger: list[dict], tx: str) -> tuple:
    reasons: list[str] = []
    ok = True
    for fall in falls:
        if not fall.exists:
            ok = False
            reasons.append("落的目标缺失：%s（改后文件不存在，哈希不可复算）"
                           % fall.path)
            continue
        actual = _sha256_bytes(_read_bytes(after / fall.path, fall.path))
        if actual != fall.sha256:
            ok = False
            reasons.append("落哈希复算不符：%s" % fall.path)

    # 账链连续性：账本里既有的落记录描述的是「改前状态」，必须与改前目录一致。
    prior: dict[str, dict] = {}
    for event in ledger:
        if event.get("event") != FALL or event.get("tx") == tx:
            continue
        prior[event.get("path")] = event
    for rise in rises:
        event = prior.get(rise.path)
        if event is None:
            continue
        path = before / rise.path
        actual = (_sha256_bytes(_read_bytes(path, rise.path))
                  if path.is_file() else None)
        if event.get("sha256") != actual:
            ok = False
            reasons.append("账本既有落与改前目录不符：%s（账链断了或账被改过）"
                           % rise.path)
    return ok, reasons


# --------------------------------------------------------------------------
# 派生视图
# --------------------------------------------------------------------------

_MARK = {True: "✓", False: "✗"}


def render_ledger(result: TideResult) -> str:
    lines = [
        "# 潮汐账（tide ledger）",
        "",
        "- 事务：%s" % result.tx,
        "- 涨：%d   落：%d   波及面：%d   事件：%d" % (
            len(result.rises), len(result.falls), len(result.affect),
            len(result.rises) + len(result.falls) + 1),
        "- 判定：paired %s   hash_ok %s   pass_all %s" % (
            _MARK[result.paired], _MARK[result.hash_ok],
            _MARK[result.pass_all]),
        "- 状态：%s" % result.status,
        "",
        "| 文件 | 改前(前8) | 改后(前8) | 波及面 | paired | hash_ok | pass_all |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in result.rows:
        lines.append("| %s | %s | %s | %s | %s | %s | %s |" % (
            row["path"],
            (row["before"] or "")[:8] or "—",
            (row["after"] or "")[:8] or "—",
            "、".join(row["affect"]) or "—",
            _MARK[row["paired"]], _MARK[row["hash_ok"]],
            _MARK[row["pass_all"]]))
    lines.append("")
    return "\n".join(lines)


def _rel(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path)


def render_human(result: TideResult) -> str:
    lines = [
        "== factscribe tide ==",
        "事务：%s    状态：%s" % (result.tx, result.status),
        "涨：%d   落：%d   波及面：%d   事件：%d" % (
            len(result.rises), len(result.falls), len(result.affect),
            len(result.rises) + len(result.falls) + 1),
        "入账文件：%d   忽略：%d" % (len(result.rises), len(result.ignored)),
        "判定：paired %s   hash_ok %s   pass_all %s" % (
            _MARK[result.paired], _MARK[result.hash_ok],
            _MARK[result.pass_all]),
    ]
    if result.ignored:
        lines.append("忽略明细：%s" % "、".join(result.ignored))
    if result.reasons:
        lines.append("未闭合：")
        lines += ["- " + reason for reason in result.reasons]
    if result.closed:
        lines.append("账本：%s（append-only）"
                     % _rel(result.ledger_path, result.after))
        if result.view_written:
            lines.append("派生视图：%s" % _rel(result.view_path, result.after))
    else:
        lines.append("全退：未写账本、未产出派生视图。")
    return "\n".join(lines)


# --------------------------------------------------------------------------
# 主入口
# --------------------------------------------------------------------------

def run_tide(before: Path | str, after: Path | str,
             out: Path | str | None = None, *,
             ignore: list[str] | tuple[str, ...] | None = None,
             default_ignore: bool = True) -> TideResult:
    before = Path(before)
    after = Path(after)
    for flag, path in (("--before", before), ("--after", after)):
        if not path.is_dir():
            raise ConfigError("%s 目录不存在或不是目录：%s" % (flag, path))

    patterns = (tuple(DEFAULT_IGNORE) if default_ignore else ()) + \
        tuple(ignore or ())

    ledger_path = Path(out) if out is not None else after / "audit" / LEDGER_NAME
    view_path = after / "audit" / VIEW_NAME
    exclude = {str(ledger_path.resolve()), str(view_path.resolve())}

    bfiles, bignored = _scan(before, exclude, patterns)
    afiles, aignored = _scan(after, exclude, patterns)
    ignored = sorted(rel for rel in set(bignored) | set(aignored)
                     if bignored.get(rel) != aignored.get(rel))
    rises = _rises(before, after, bfiles, afiles)
    falls = _falls(after, rises)
    tx = _tx_id(rises, falls)
    ledger = _read_ledger(ledger_path)

    paired, paired_reasons = _paired(rises, falls, ledger)
    hash_ok, hash_reasons = _hash_ok(before, after, rises, falls, ledger, tx)

    refs = _referrers(before, after, bfiles, afiles)
    affect = _closure({r.path for r in rises}, refs)
    affect_set = set(affect)
    protect_result = compare_protect(before, after)
    hard = [f for f in protect_result.findings
            if f.severity == SEV_RED and f.file in affect_set]
    pass_all = not hard

    reasons = []
    reasons += paired_reasons
    reasons += hash_reasons
    if not pass_all:
        codes = sorted({f.code for f in hard})
        reasons.append("波及面内保护面有 %d 条红：%s"
                       % (len(hard), "、".join(codes)))

    status = "commit" if (paired and hash_ok and pass_all) else "rollback"
    closed = status == "commit"

    rows = []
    for rise in rises:
        fall = next((f for f in falls if f.path == rise.path), None)
        rows.append({
            "path": rise.path,
            "before": rise.before,
            "after": rise.after,
            "affect": _closure({rise.path}, refs),
            "paired": fall is not None,
            "hash_ok": bool(fall and fall.exists and fall.sha256),
            "pass_all": not any(f.file == rise.path for f in hard),
        })

    result = TideResult(before=before, after=after, tx=tx, status=status,
                        paired=paired, hash_ok=hash_ok, pass_all=pass_all,
                        rises=rises, falls=falls, affect=affect,
                        findings=hard, reasons=reasons,
                        ledger_path=ledger_path, view_path=view_path,
                        rows=rows, ignored=ignored, ignore=patterns)

    if closed:
        events = _tx_events(tx, rises, falls, affect, status)
        events[-1].update({"paired": paired, "hash_ok": hash_ok,
                           "pass_all": pass_all})
        if rises:
            result.appends = _append_ledger(ledger_path, events)
        if out is None:
            view_path.parent.mkdir(parents=True, exist_ok=True)
            view_path.write_text(render_ledger(result), encoding="utf-8")
            result.view_written = True
    return result


# --------------------------------------------------------------------------
# 快照与回滚（批 106，SPEC-TIDE §12）
# --------------------------------------------------------------------------
# 快照是纯内容副本：blobs/ 按内容寻址，snapshots/<ID>/manifest.tsv 是唯一清单，
# 快照ID＝清单字节的 sha256。恢复先全校验再动笔；任何一处不符即零写入。

SNAPSHOTS_DIR = "snapshots"
BLOBS_DIR = "blobs"
MANIFEST_NAME = "manifest.tsv"
DEFAULT_SNAPSHOT_ROOT = ".tide"

_ID_RE = re.compile(r"^[0-9a-f]{4,64}$")
_SHA_RE = re.compile(r"^[0-9a-f]{64}$")


@dataclass
class SnapshotEntry:
    path: str
    sha256: str
    size: int


@dataclass
class SnapshotResult:
    store: Path
    source: Path
    snapshot_id: str
    files: int
    bytes: int
    blobs_new: int
    blobs_shared: int
    ignored: list[str]
    manifest_path: Path
    ignore: tuple[str, ...] = ()

    @property
    def short(self) -> str:
        return self.snapshot_id[:16]

    @property
    def exit_code(self) -> int:
        return EXIT_OK


@dataclass
class RestoreResult:
    store: Path
    into: Path
    snapshot_id: str
    files: int
    bytes: int
    verified: int = 0
    written: int = 0
    reasons: list[str] = field(default_factory=list)

    @property
    def short(self) -> str:
        return self.snapshot_id[:16]

    @property
    def ok(self) -> bool:
        return not self.reasons

    @property
    def exit_code(self) -> int:
        return EXIT_OK if self.ok else EXIT_RED


def _check_rel(rel: str, where: str = "路径") -> None:
    """清单路径必须安全：相对、无 `..`/空段/制表符/换行（清单是裸 TSV）。"""
    if not rel:
        raise ConfigError("%s为空" % where)
    if rel.startswith("/") or "\\" in rel:
        raise ConfigError("%s不是相对 POSIX 路径：%s" % (where, rel))
    if any(ch in rel for ch in "\t\r\n"):
        raise ConfigError("%s含制表符/换行，清单无法表示：%r" % (where, rel))
    if any(part in ("", ".", "..") for part in rel.split("/")):
        raise ConfigError("%s含空段或 `..`，拒绝写入库外：%s" % (where, rel))


def _render_manifest(entries: list[SnapshotEntry]) -> bytes:
    return "".join("%s\t%s\t%d\n" % (e.path, e.sha256, e.size)
                   for e in entries).encode("utf-8")


def _write_atomic(path: Path, data: bytes) -> None:
    """临时文件 + 原子替换：要么旧内容，要么完整新内容，不留半个文件。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tide-part-")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _skip_roots(source: Path, store: Path) -> list[Path]:
    """库根落在被快照目录内时，整个库跳过（快照不许自吞自己）。"""
    resolved = store.resolve()
    try:
        resolved.relative_to(source.resolve())
    except ValueError:
        return []
    return [resolved]


def _snapshot_entries(source: Path, patterns: tuple[str, ...],
                      store: Path) -> tuple[list[SnapshotEntry], list[str]]:
    entries: list[SnapshotEntry] = []
    ignored: list[str] = []
    skip = _skip_roots(source, store)
    for p in sorted(source.rglob("*")):
        if not p.is_file() or p.is_symlink():
            continue
        rel = p.relative_to(source).as_posix()
        if any(part.startswith(".") for part in rel.split("/")):
            continue
        resolved = p.resolve()
        if any(resolved == root or root in resolved.parents for root in skip):
            continue
        if _ignored(rel, patterns):
            ignored.append(rel)
            continue
        _check_rel(rel, "源文件相对路径")
        data = _read_bytes(p, rel)
        entries.append(SnapshotEntry(rel, _sha256_bytes(data), len(data)))
    entries.sort(key=lambda e: e.path)
    return entries, sorted(ignored)


def save_snapshot(after: Path | str, store: Path | str | None = None, *,
                  ignore: list[str] | tuple[str, ...] | None = None,
                  default_ignore: bool = True) -> SnapshotResult:
    """为 `after` 目录建快照；返回快照ID（清单字节的 sha256）。"""
    source = Path(after)
    if not source.is_dir():
        raise ConfigError("--after 目录不存在或不是目录：%s" % source)
    root = Path(store) if store is not None else Path(DEFAULT_SNAPSHOT_ROOT)
    patterns = (tuple(DEFAULT_IGNORE) if default_ignore else ()) + \
        tuple(ignore or ())

    entries, ignored = _snapshot_entries(source, patterns, root)
    manifest = _render_manifest(entries)
    snapshot_id = _sha256_bytes(manifest)

    blobs_dir = root / BLOBS_DIR
    new = shared = 0
    for entry in entries:
        data = _read_bytes(source / entry.path, entry.path)
        if _sha256_bytes(data) != entry.sha256:
            raise ConfigError("快照过程中源文件发生变化：%s" % entry.path)
        blob = blobs_dir / entry.sha256
        if blob.is_file() and blob.stat().st_size == entry.size:
            shared += 1
            continue
        _write_atomic(blob, data)
        new += 1

    manifest_path = root / SNAPSHOTS_DIR / snapshot_id / MANIFEST_NAME
    _write_atomic(manifest_path, manifest)
    return SnapshotResult(store=root, source=source, snapshot_id=snapshot_id,
                          files=len(entries),
                          bytes=sum(e.size for e in entries),
                          blobs_new=new, blobs_shared=shared,
                          ignored=ignored, manifest_path=manifest_path,
                          ignore=patterns)


def _resolve_snapshot(store: Path, snapshot_id: str) -> Path:
    sid = (snapshot_id or "").strip().lower()
    if not _ID_RE.match(sid):
        raise ConfigError("快照ID 不合法（需 4–64 位十六进制）：%r" % snapshot_id)
    snaps = store / SNAPSHOTS_DIR
    if not snaps.is_dir():
        raise ConfigError("快照库不存在：%s" % snaps)
    hits = sorted(p.name for p in snaps.iterdir()
                  if p.is_dir() and p.name.startswith(sid))
    if not hits:
        raise ConfigError("快照不存在：%s" % snapshot_id)
    if len(hits) > 1:
        raise ConfigError("快照ID 前缀不唯一（命中 %d 个）：%s"
                          % (len(hits), snapshot_id))
    return snaps / hits[0]


def parse_manifest(raw: bytes) -> list[SnapshotEntry]:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ConfigError("清单不是 UTF-8：%s" % exc) from exc
    entries: list[SnapshotEntry] = []
    for lineno, line in enumerate(text.splitlines(), 1):
        where = "清单第 %d 行" % lineno
        if not line:
            raise ConfigError("%s为空行" % where)
        parts = line.split("\t")
        if len(parts) != 3:
            raise ConfigError("%s不是「路径\\t哈希\\t字节数」" % where)
        rel, digest, size_text = parts
        _check_rel(rel, where + "路径")
        if not _SHA_RE.match(digest):
            raise ConfigError("%s哈希不是 64 位十六进制" % where)
        if not size_text.isdigit():
            raise ConfigError("%s字节数不是非负整数" % where)
        entries.append(SnapshotEntry(rel, digest, int(size_text)))
    paths = [e.path for e in entries]
    if paths != sorted(paths):
        raise ConfigError("清单未按路径升序")
    if len(set(paths)) != len(paths):
        raise ConfigError("清单有重复路径")
    return entries


def restore_snapshot(store: Path | str, snapshot_id: str,
                     into: Path | str) -> RestoreResult:
    """把快照还原到 `into`：先全校验，任何一处不符即零写入（失败关闭）。"""
    root = Path(store) if store is not None else Path(DEFAULT_SNAPSHOT_ROOT)
    target = Path(into)
    snap = _resolve_snapshot(root, snapshot_id)
    manifest_path = snap / MANIFEST_NAME
    if not manifest_path.is_file():
        raise ConfigError("快照缺清单：%s" % manifest_path)

    raw = manifest_path.read_bytes()
    result = RestoreResult(store=root, into=target, snapshot_id=snap.name,
                           files=0, bytes=0)

    # 先验清单完整性：清单字节的 sha256 必须等于目录名（清单被改过即失败，
    # 不再尝试解释这份清单）。
    if _sha256_bytes(raw) != snap.name:
        result.reasons.append("清单哈希与快照ID不符（清单被改过）")
        return result

    entries = parse_manifest(raw)
    result.files = len(entries)
    result.bytes = sum(e.size for e in entries)

    blobs = root / BLOBS_DIR
    for entry in entries:
        blob = blobs / entry.sha256
        if not blob.is_file():
            result.reasons.append("缺 blob：%s（%s）"
                                  % (entry.sha256[:16], entry.path))
            continue
        data = blob.read_bytes()
        if len(data) != entry.size:
            result.reasons.append("长度不符：%s（清单 %d，实际 %d）"
                                  % (entry.path, entry.size, len(data)))
            continue
        if _sha256_bytes(data) != entry.sha256:
            result.reasons.append("哈希不符：%s（blob 被改过）" % entry.path)
            continue
        result.verified += 1

    if result.reasons:
        return result

    target.mkdir(parents=True, exist_ok=True)
    for entry in entries:
        data = (blobs / entry.sha256).read_bytes()
        path = target.joinpath(*entry.path.split("/"))
        _write_atomic(path, data)
        back = path.read_bytes()
        if len(back) != entry.size or _sha256_bytes(back) != entry.sha256:
            result.reasons.append("写后复算不符：%s" % entry.path)
            continue
        result.written += 1
    return result


def render_snapshot(result: SnapshotResult) -> str:
    lines = [
        "== factscribe tide 快照 ==",
        "快照ID：%s（全宽 %s）" % (result.short, result.snapshot_id),
        "文件：%d   字节：%d" % (result.files, result.bytes),
        "blob：新增 %d   复用 %d" % (result.blobs_new, result.blobs_shared),
        "清单：%s/%s/%s" % (SNAPSHOTS_DIR, result.snapshot_id, MANIFEST_NAME),
    ]
    if result.ignored:
        lines.append("忽略：%d 项（%s）"
                     % (len(result.ignored), "、".join(result.ignored)))
    return "\n".join(lines)


def render_restore(result: RestoreResult) -> str:
    lines = [
        "== factscribe tide 快照还原 ==",
        "快照ID：%s（全宽 %s）" % (result.short, result.snapshot_id),
        "文件：%d   字节：%d" % (result.files, result.bytes),
        "校验：%d/%d 通过" % (result.verified, result.files),
    ]
    if result.ok:
        lines.append("结果：已还原 %d 个文件（写后逐字节复算通过）"
                     % result.written)
    else:
        lines.append("结果：失败关闭，未写任何文件")
        lines.append("原因：")
        lines += ["- " + reason for reason in result.reasons]
    return "\n".join(lines)
