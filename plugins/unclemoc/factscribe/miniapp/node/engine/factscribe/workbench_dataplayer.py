# -*- coding: utf-8 -*-
"""本地工作台的数据层：serve（HTTP）与 mcp（stdio）共用。

这里只做「读项目 / 改一节 / 追加事实 / 跑审计」的数据动作；不涉及 HTTP、
JSON-RPC、token 或页面。判定仍由 audit/brief 原函数给出。
"""
from __future__ import annotations

import os
import re
import shutil
import time
from pathlib import Path, PurePosixPath

from .audit import _aggregate_exit, run_audit, source_path
from .brief import build_brief, payload as brief_payload
from .config import (ConfigError, load_config, load_facts, load_sections)
from .landing import resolve_landing
from .textio import read_text_exact, restore_newlines, write_text_exact
from .evidence import (freeze_evidence, lock_check, log_state, read_lock,
                       unfreeze_evidence, unfrozen_info)
from .i18n import issue_dict
from .report import _config_block, _severity_of
from .scaffold import add_fact
from .workbench.projects import short_sha
from .workbench.proposal import (STATUS_APPLIED, STATUS_STALE, ProposalError,
                                 new_id, read_proposal, resolve_proposal,
                                 write_proposal)


def _config_bits(cfg) -> dict:
    return {"config": _config_block(cfg),
            "config_warnings": list(cfg.warnings)}


def _require_write(allow_write: bool) -> None:
    if not allow_write:
        raise ConfigError("当前是只读模式；写操作需要 --allow-write",
                          code="READ_ONLY")


def status_data(project: Path | str, allow_write: bool = False) -> dict:
    cfg = load_config(Path(project))
    facts = load_facts(cfg)
    sections = load_sections(cfg)
    return {
        "project": cfg.name or cfg.title,
        "root": str(cfg.root),
        "facts": len(facts),
        "sections": len(sections),
        "facts_glob": cfg.facts_glob,
        "sections_glob": cfg.sections_glob,
        "read_only": not allow_write,
        **_config_bits(cfg),
    }


def project_data(project: Path | str, allow_write: bool = False,
                 allow_build: bool = False) -> dict:
    cfg = load_config(Path(project))
    facts = load_facts(cfg)
    sections = load_sections(cfg)
    source_rows: dict[str, dict] = {}
    for fact in facts:
        src = fact.source.strip()
        if not src or src in source_rows:
            continue
        text = ""
        try:
            base = source_path(cfg, "").resolve()
            path = source_path(cfg, src).resolve()
            path.relative_to(base)
            text = read_text_exact(path)
        except (OSError, ValueError, UnicodeDecodeError):
            text = ""
        source_rows[src] = {"id": src, "name": src, "text": text,
                            "sha256": fact.source_sha256}
    bib_path = cfg.root / cfg.bib
    try:
        bib = read_text_exact(bib_path)
    except (OSError, UnicodeDecodeError):
        bib = ""
    return {
        "read_only": not allow_write,
        "build_allowed": bool(allow_build),
        "project": cfg.name or cfg.title,
        "root": str(cfg.root),
        # sha：这一节的指纹（sha256 hex 前 16 位）——客户端保存时带回来当
        # expect_sha，指纹闸据此拒写「在别处被改过」的节。
        "sections": [{"file": rel, "text": text, "sha": short_sha(text)}
                     for rel, text in sections],
        "facts": [{
            "id": f.id, "claim": f.claim, "value": f.value,
            "source": f.source, "sourceSha256": f.source_sha256,
            "locator": f.locator, "confidence": f.confidence,
            "derivedFrom": list(f.derived_from), "expr": f.expr,
            "report": f.report, "report_metric": f.report_metric,
            "dupOk": f.dup_ok, "notes": f.note,
        } for f in facts],
        "sources": list(source_rows.values()),
        "bib": bib,
        **_config_bits(cfg),
    }


def brief_data(project: Path | str, section: str | None = None) -> dict:
    brief = build_brief(Path(project), section)
    cfg = load_config(Path(project))
    return {**brief_payload(brief), **_config_bits(cfg)}


def audit_data(project: Path | str, lang: str = "zh") -> dict:
    cfg = load_config(Path(project))
    facts = load_facts(cfg)
    sections = load_sections(cfg)
    red, yellow, hints, summary, unresolved = run_audit(
        cfg, facts, sections, resolve=False)
    code = _aggregate_exit(red, yellow, False,
                           integrity_first=cfg.is_v3)
    return {
        "exit": code,
        "verdict": _severity_of(code),
        "summary": summary,
        "findings": ([issue_dict(i, lang) for i in red]
                     + [issue_dict(w, lang) for w in yellow]),
        "issues": [issue_dict(i, lang) for i in red],
        "warnings": [issue_dict(w, lang) for w in yellow],
        "hints": [issue_dict(h, lang) for h in hints],
        "coverage": summary.get("coverage", {}),
        "resolved": unresolved,
        **_config_bits(cfg),
    }


#: 指纹闸：客户端所基于的那一版正文与服务端现算的不一致 → 拒写（HTTP 409）。
#: 段落级那条闸的同一个码（见 factscribe/workbench/write.py 的 BLOCK_STALE）。
BLOCK_STALE_CODE = "BLOCK_STALE"


def write_section_data(project: Path | str, file: str, text: str,
                       allow_write: bool = False,
                       expect_sha: str = "") -> dict:
    """写一节正文（节级兼容层的写入口）。

    **指纹闸**（口径 3 补的那道）：客户端带 `expect_sha`（它所基于的那一版
    正文的指纹）来，服务端现算的指纹对不上就拒写（`BLOCK_STALE`）——这节
    在别处（另一个窗口／外部编辑器）已被改过，照单写回会覆盖别人的字。
    不带 `expect_sha` 就走老路（裸覆盖），与段落级同一条闸的语义。
    """
    _require_write(allow_write)
    cfg = load_config(Path(project))
    rel = str(file or "").strip()
    if not rel:
        raise ConfigError("file 必填：要写哪一节")
    if not isinstance(text, str):
        raise ConfigError("text 必须是字符串")
    # 落点先解析：解不出来（成环软链等）→ 判成不可解 → 拒写，不许裸崩成
    # 「工具内部错误」（exit 4）。判据是语义，不是 errno 白名单（D1）。
    root = cfg.root.resolve()
    target = resolve_landing(cfg.root / rel, what="章节", name=rel,
                             code="PATH_ESCAPE")
    try:
        target.relative_to(root)
    except ValueError:
        raise ConfigError("章节越出项目根：%s" % rel)
    sections = dict(load_sections(cfg))
    if rel not in sections:
        raise ConfigError("file 不在审计闭包内：%s" % rel)
    if not rel.endswith(".tex"):
        raise ConfigError("只允许写 .tex 章节：%s" % rel)
    tmp = target.with_name(target.name + ".tmp")
    # 落盘原文：这一节当前在盘上的字节（行尾原样）。
    try:
        original = read_text_exact(target)
    except (OSError, UnicodeDecodeError):
        original = ""
    # 指纹闸：对不上就拒写（409），不许覆盖别人的字。
    expect = str(expect_sha or "").strip()
    if expect and expect != short_sha(original):
        raise ConfigError("这一节在别处已被改动，请重新编辑。",
                          code=BLOCK_STALE_CODE)
    # 行尾还原：浏览器的 <textarea> 交回的正文恒是 LF（HTML 规范把 textarea
    # 的 API value 归一为 LF），直接逐字写回会把 CRLF 稿整篇压成 LF——
    # 内容一个字没动，行尾却全被换掉了。这里按**落盘原文**逐行还原行尾，
    # 正文内容（数字、\fact{}/\cite{} 保护面、token）一个字都不改。
    # newline=""：不翻译换行。正文里的 '\r\n' 原样落盘——
    # Windows 上默认文本模式会把它写成 '\r\r\n'（内容损坏）。
    final = restore_newlines(text, original) if original else text
    write_text_exact(tmp, final)
    os.replace(tmp, target)
    # bytes 报的是**真正落盘**的那份（还原行尾后），不是客户端交来的那份。
    return {"file": rel, "bytes": len(final.encode("utf-8")),
            "sha": short_sha(final)}


# ============================================================ 章节增删改
#
# 写节（PUT /api/sections）只能改审计闭包里已有的节；这里是「目录级」动作：
# 新建一节、给一节改名、删一节。三条硬规矩：
#
#   1. 路径只能是项目内的普通 .tex 文件——`..`、绝对路径、软链、非 .tex 一律拒；
#   2. 改名只改文件名，不碰正文里的 \input 引用（改引用是人的决定）；
#   3. 删之前先扫一遍谁在引用它——被引用就 409 拦下来，force 才真删。

DEFAULT_SECTION_TEXT = "\\section{新章节}\n"


class SectionError(ConfigError):
    """章节增删改的失败：带 HTTP 状态码（409 = 冲突）。

    `code` 给机器看（SECTION_EXISTS / SECTION_REFERENCED / PATH_ESCAPE…），
    `message` 给人看，`extra` 是补充信息（引用位置等）。
    """

    def __init__(self, message: str, code: str = "SECTION_INVALID",
                 status: int = 400, **extra):
        super().__init__(message, code=code)
        self.status = status
        self.extra = extra


def _section_rel(raw: str) -> str:
    """把用户给的相对路径收拾成 POSIX 相对路径（内容不动，只收拾写法）。"""
    rel = str(raw or "").strip()
    if not rel:
        raise SectionError("file 必填：要动哪一节", code="SECTION_INVALID")
    if "\\" in rel:
        raise SectionError("章节路径用 / 分隔：%s" % rel, code="SECTION_INVALID")
    pure = PurePosixPath(rel)
    if pure.is_absolute():
        raise SectionError("章节路径必须是项目内的相对路径：%s" % rel,
                           code="PATH_ESCAPE")
    parts = [part for part in pure.parts if part not in ("", ".")]
    if not parts:
        raise SectionError("章节路径不完整：%s" % rel, code="SECTION_INVALID")
    if any(part == ".." for part in parts):
        raise SectionError("章节路径不能带 ..：%s" % rel, code="PATH_ESCAPE")
    if PurePosixPath(rel).suffix.lower() != ".tex":
        raise SectionError("只允许 .tex 章节：%s" % rel, code="SECTION_INVALID")
    return "/".join(parts)


def _section_path(cfg, rel: str) -> Path:
    """项目内的 .tex 普通文件路径；软链、越界一律拒。

    项目根自己允许是软链（macOS 的 /var 就是），根以下不许有软链——
    软链能把「项目内的路径」指到项目外，写进去的东西就管不到了。
    """
    rel = _section_rel(rel)
    root = cfg.root.resolve()
    parts = rel.split("/")
    cur = root
    for part in parts[:-1]:
        cur = cur / part
        if cur.is_symlink():
            raise SectionError("章节路径里有软链，不许走：%s" % rel,
                               code="PATH_ESCAPE")
    target = root.joinpath(*parts)
    if target.is_symlink():
        raise SectionError("章节是软链，不许动：%s" % rel, code="PATH_ESCAPE")
    try:
        target.resolve().relative_to(root)
    except ValueError:
        raise SectionError("章节越出项目根：%s" % rel, code="PATH_ESCAPE")
    return target


def _scan_project_tex(cfg) -> list[tuple[str, str]]:
    r"""谁在正文里提到了这个文件名：闭包里的节 + root_tex + 项目根下的 .tex。

    主文件（main.tex 之类）常常不在闭包里（glob 形态的闭包只含 sections/），
    可 \input 引用恰恰写在那里——不扫它就会漏掉真正的引用。
    """
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    try:
        out.extend(load_sections(cfg))
        seen.update(rel for rel, _ in out)
    except ConfigError:
        pass  # 闭包坏了也得能删：退回到 root_tex 与根目录
    extra: list[str] = []
    root_tex = str(getattr(cfg, "root_tex", "") or "").strip()
    if root_tex:
        extra.append(root_tex)
    try:
        for path in sorted(cfg.root.glob("*.tex")):
            extra.append(path.relative_to(cfg.root).as_posix())
    except OSError:
        pass
    for rel in extra:
        if rel in seen:
            continue
        seen.add(rel)
        try:
            out.append((rel, read_text_exact(cfg.root / rel)))
        except (OSError, UnicodeDecodeError):
            pass
    return out


def _mentions(line: str, base: str) -> bool:
    """这一行是不是提到了这个文件。

    两种写法都算：完整文件名（`\\input{sections/01-intro.tex}`），以及
    LaTeX 常见的省略后缀（`\\input{sections/01-intro}`）——后者按「整词」匹配，
    免得 "introduction" 里一个 "intro" 就被当成引用。
    """
    if base in line:
        return True
    stem = base[:-4] if base.lower().endswith(".tex") else base
    if not stem:
        return False
    return re.search(r"(?<![\w.\-])" + re.escape(stem) + r"(?![\w.\-])",
                     line) is not None


def _section_references(cfg, rel: str) -> list[dict]:
    """谁在正文里提到了这个文件名（按 basename 找）。"""
    base = PurePosixPath(rel).name
    hits: list[dict] = []
    for src_rel, text in _scan_project_tex(cfg):
        if src_rel == rel:
            continue  # 自己提到自己不算引用
        for index, line in enumerate(text.splitlines(), 1):
            if _mentions(line, base):
                hits.append({"file": src_rel, "line": index,
                             "text": line.strip()[:160]})
    return hits


def create_section_data(project: Path | str, file: str, text=None,
                        allow_write: bool = False) -> dict:
    """新建一节：目标不能已存在，父目录必须已在项目内。"""
    _require_write(allow_write)
    cfg = load_config(Path(project))
    rel = _section_rel(file)
    target = _section_path(cfg, rel)
    if target.exists() or target.is_symlink():
        raise SectionError("已经有这个文件了：%s" % rel,
                           code="SECTION_EXISTS", status=409)
    if not target.parent.is_dir():
        raise SectionError("父目录不存在：%s（先建目录再建节）" % rel,
                           code="SECTION_PARENT_MISSING")
    content = text if isinstance(text, str) else DEFAULT_SECTION_TEXT
    write_text_exact(target, content)
    return {"file": rel, "bytes": len(content.encode("utf-8"))}


def rename_section_data(project: Path | str, from_file: str, to_file: str,
                        allow_write: bool = False) -> dict:
    """给一节改名：只改文件名，正文里的引用一个字都不动。"""
    _require_write(allow_write)
    cfg = load_config(Path(project))
    src_rel = _section_rel(from_file)
    dst_rel = _section_rel(to_file)
    src = _section_path(cfg, src_rel)
    dst = _section_path(cfg, dst_rel)
    if not src.is_file():
        raise SectionError("源文件不存在：%s" % src_rel, code="SECTION_MISSING")
    if dst.exists() or dst.is_symlink():
        raise SectionError("目标已存在：%s" % dst_rel,
                           code="SECTION_EXISTS", status=409)
    if not dst.parent.is_dir():
        raise SectionError("父目录不存在：%s" % dst_rel,
                           code="SECTION_PARENT_MISSING")
    refs = _section_references(cfg, src_rel)
    os.replace(src, dst)
    return {"file": dst_rel, "from": src_rel, "references": refs,
            "note": "只改了文件名；正文里的 \\input 引用没动，需要自己改"}


def delete_section_data(project: Path | str, file: str, force: bool = False,
                        allow_write: bool = False) -> dict:
    """删一节：正文还在引用它就 409 拦下来；force 才继续。

    **删＝挪 attic（可逆），不真删**（口径 8：与段落级的删节语义统一）。
    原文件挪到项目根下的 `attic/`（保持相对路径），人后悔了搬回去就恢复；
    放 attic 而不是 `sections/attic/` 是因为闭包按 `sections/**/*.tex`
    扫——搁在 sections 里等于没删（那一节照样进审计）。

    409 提醒照旧：正文还引用它就报 `SECTION_REFERENCED`（附引用位置），
    `force:true` 才继续。
    """
    _require_write(allow_write)
    cfg = load_config(Path(project))
    rel = _section_rel(file)
    target = _section_path(cfg, rel)
    if not target.is_file():
        raise SectionError("文件不存在：%s" % rel, code="SECTION_MISSING")
    refs = _section_references(cfg, rel)
    if refs and not force:
        where = "、".join("%s:%d" % (hit["file"], hit["line"]) for hit in refs)
        raise SectionError("正文还在引用它：%s" % where,
                           code="SECTION_REFERENCED", status=409,
                           references=refs)
    attic = cfg.root / "attic" / rel
    attic.parent.mkdir(parents=True, exist_ok=True)
    if attic.exists():
        attic.unlink()
    shutil.move(str(target), str(attic))
    return {"file": rel, "references": refs, "forced": bool(force),
            "attic": attic.relative_to(cfg.root).as_posix()}


#: 节级改稿提议单的类型（正文改稿；与段落级的 block_edit 同一形状）。
KIND_SECTION_WRITE = "section_write"


def propose_section_data(project: Path | str, file: str, text: str,
                         expect_sha: str = "", source: str = "",
                         rationale: str = "") -> dict:
    """算一张**节级**改稿提议单（**不碰正文**）。

    口径 7：AI 的采纳写回统一走提议单＋指纹闸——AI 候选先落成一张待人确认
    的单子，人点了确认才写回；提议之后正文被别处改过，指纹对不上就拒写。

    形状与段落级的提议单一致：kind / before_sha / before_text / after_text /
    warnings（落盘层一字不改，只多给 message/params 那套展示原料之外的东西）。
    """
    cfg = load_config(Path(project))
    rel = _section_rel(file)
    target = _section_path(cfg, rel)
    if not target.is_file():
        raise SectionError("文件不存在：%s" % rel, code="SECTION_MISSING")
    original = read_text_exact(target)
    expect = str(expect_sha or "").strip()
    if expect and expect != short_sha(original):
        raise ConfigError("这一节在别处已被改动，请重新编辑。",
                          code=BLOCK_STALE_CODE)
    after = restore_newlines(text, original)
    return {"kind": KIND_SECTION_WRITE,
            "file": rel,
            "before_sha": short_sha(original),
            "before_text": original,
            "proposed_text": text,
            "after_text": after,
            "warnings": [],
            "source": str(source or ""),
            "rationale": str(rationale or "")}


def create_section_proposal(project: Path | str, file: str, text: str,
                            expect_sha: str = "", source: str = "",
                            rationale: str = "", state: str = "") -> dict:
    """建一张节级改稿提议单（**不碰正文**）——状态落在提议单目录里。"""
    calc = propose_section_data(project, file, text, expect_sha=expect_sha,
                                source=source, rationale=rationale)
    record = {"version": 1,
              "id": new_id(),
              "project": str(Path(project)),
              "disk": "",
              "status": "pending",
              "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    record.update(calc)
    write_proposal(state, record)
    return record


def apply_section_proposal(project: Path | str, pid: str,
                            allow_write: bool = False,
                            state: str = "") -> dict:
    """人确认之后才写回（口径 7 的写回口）。

    指纹闸：提议记下的 before_sha 与盘上现算的不一致 ⇒ 别人在提议之后改过
    这一节 ⇒ 拒写（BLOCK_STALE），并把这张单标成 stale。
    """
    _require_write(allow_write)
    record = read_proposal(state, pid)
    if str(record.get("kind") or "") != KIND_SECTION_WRITE:
        raise ProposalError("这张提议单不是节级改稿单。",
                            code="PROPOSAL_KIND_INVALID", status=400)
    if str(record.get("status") or "") != "pending":
        raise ProposalError("这张提议单已经处理过了（%s）。"
                            % record.get("status"),
                            code="PROPOSAL_ALREADY_RESOLVED", status=409)
    rel = str(record.get("file") or "")
    try:
        result = write_section_data(project, rel,
                                     str(record.get("proposed_text") or ""),
                                     True,
                                     str(record.get("before_sha") or ""))
    except ConfigError as exc:
        if getattr(exc, "code", "") == BLOCK_STALE_CODE:
            resolve_proposal(state, pid, STATUS_STALE)
        raise
    resolve_proposal(state, pid, STATUS_APPLIED)
    result = dict(result)
    result["proposal"] = pid
    return result


def add_fact_data(project: Path | str, body: dict,
                  allow_write: bool = False) -> dict:
    _require_write(allow_write)
    if not isinstance(body, dict):
        raise ConfigError("参数必须是对象")
    return add_fact(
        Path(project),
        fid=str(body.get("id") or ""),
        claim=str(body.get("claim") or ""),
        value=str(body.get("value") or ""),
        source=str(body.get("source") or ""),
        locator=str(body.get("locator") or ""),
        confidence=str(body.get("confidence") or "med"),
        expr=str(body.get("expr") or ""),
        derived_from=body.get("derived_from") or body.get("derivedFrom"),
        note=str(body.get("note") or ""),
        ledger=str(body.get("ledger") or ""))


def evidence_status_data(project: Path | str) -> dict:
    cfg = load_config(Path(project))
    lock = read_lock(cfg.root)
    return {
        "defined": bool(getattr(cfg, "evidence_defined", False)),
        "declared_sections": len(getattr(cfg, "evidence_sections", {}) or {}),
        "lock": lock,
        "mismatch": lock_check(cfg),
        "unfrozen": unfrozen_info(cfg.root),
        "log": log_state(cfg.root),
    }


def freeze_evidence_data(project: Path | str, reason: str = "",
                         allow_write: bool = False) -> dict:
    _require_write(allow_write)
    cfg = load_config(Path(project))
    return freeze_evidence(cfg.root, dict(getattr(cfg, "evidence_sections", {}) or {}),
                           reason)


def unfreeze_evidence_data(project: Path | str, reason: str, at: str = "",
                           allow_write: bool = False) -> dict:
    _require_write(allow_write)
    cfg = load_config(Path(project))
    return unfreeze_evidence(cfg.root, reason, at)
