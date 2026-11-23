# -*- coding: utf-8 -*-
"""doctor：上手前的环境与项目自检（不是闸门）。

回答一个问题：「我想跑 audit，但这台机器／这个项目还缺什么？」

检查分两层：

* **环境**：Python 版本、编译引擎、PDF 回检工具、中文字体、git；
* **项目**：项目声明、事实账、人签清单、证据冻结、章节。

每项只给一句人话和一条修复命令。本命令不判定、不产生分数、不改项目；
退出码恒为 0（目录不存在等用法错仍走 exit 2），与 `prescribe` / `polish`
同属「不是闸门」的一类。
"""
from __future__ import annotations

import shlex
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

from .buildpdf import find_cjk_font, find_fandol_fonts
from .config import (Config, ConfigError, find_config_file, load_config,
                     load_facts, load_sections, load_toml)
from .evidence import LOCK_REL, read_lock, unfrozen_info
from .scaffold import INIT_FILES

LEVEL_OK = "ok"
LEVEL_WARN = "warn"
LEVEL_FAIL = "fail"

_MARK = {LEVEL_OK: "✓", LEVEL_WARN: "!", LEVEL_FAIL: "✗"}


def _check(name: str, label: str, level: str, detail: str,
           fix: str | None = None) -> dict:
    return {"name": name, "label": label, "level": level,
            "detail": detail, "fix": fix}


def _cmd(*parts: str) -> str:
    """拼一条可直接复制的命令（路径带空格时自动加引号）。"""
    return " ".join(shlex.quote(str(p)) for p in parts)


def _tool_version(exe: str) -> str:
    try:
        proc = subprocess.run([exe, "--version"], capture_output=True,
                              text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return ""
    lines = ((proc.stdout or "") + (proc.stderr or "")).strip().splitlines()
    return lines[0][:80] if lines else ""


def _read_text(path: Path, limit: int = 400_000) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")[:limit]
    except OSError:
        return ""


def _uses_cjk(cfg: Config) -> bool:
    """项目里有没有中文（看 ctex 与 CJK 字符）：英文项目不必查中文字体。"""
    texts: list[str] = []
    main = cfg.root / (cfg.root_tex or "main.tex")
    if main.is_file():
        texts.append(_read_text(main))
    try:
        texts.extend(text for _, text in load_sections(cfg))
    except ConfigError:
        pass
    blob = "\n".join(texts)
    if "ctex" in blob:
        return True
    return any("\u4e00" <= ch <= "\u9fff" for ch in blob)


def _python_check() -> dict:
    version = sys.version.split()[0]
    if sys.version_info >= (3, 10):
        return _check("python", "Python", LEVEL_OK, "%s（≥ 3.10）" % version)
    return _check("python", "Python", LEVEL_FAIL,
                  "%s 太旧，本工具要 3.10 以上" % version,
                  fix="装 Python 3.10+ 后用该解释器跑 factscribe")


def _build_check(cfg: Config | None, which) -> dict:
    if cfg is not None and cfg.build.strip():
        return _check("build", "编译引擎", LEVEL_OK,
                      "使用项目自带的 project.build：%s" % cfg.build)
    exe = which("tectonic")
    if exe:
        version = _tool_version(exe)
        return _check("build", "编译引擎", LEVEL_OK,
                      "%s%s" % (exe, "（%s）" % version if version else ""))
    return _check(
        "build", "编译引擎", LEVEL_WARN,
        "找不到 tectonic：不带 --build 的 audit 不需要它，要编 PDF 就需要",
        fix="brew install tectonic")


def _pdf_check(which) -> dict:
    missing = [name for name in ("pdftotext", "pdfinfo", "pdfimages")
               if not which(name)]
    if not missing:
        return _check("pdf", "PDF 回检工具", LEVEL_OK,
                      "pdftotext / pdfinfo / pdfimages 齐备")
    return _check(
        "pdf", "PDF 回检工具", LEVEL_WARN,
        "缺 %s：只影响 verify-pdf 与 audit --build 的 PDF 层" % "、".join(missing),
        fix="brew install poppler")


def _fonts_check(cfg: Config | None) -> dict:
    if cfg is None:
        return _check("fonts", "中文字体", LEVEL_OK, "未加载项目，跳过")
    if not _uses_cjk(cfg):
        return _check("fonts", "中文字体", LEVEL_OK,
                      "未检测到中文，跳过（英文项目不需要）")
    fandol = find_fandol_fonts()
    if fandol is not None:
        return _check("fonts", "中文字体", LEVEL_OK,
                      "Fandol 缓存完整：%s" % fandol)
    font = find_cjk_font()
    if font is not None:
        return _check("fonts", "中文字体", LEVEL_OK,
                      "系统字体可用（fc-match 命中 %s），编译失败时会用它兜底" % font)
    return _check(
        "fonts", "中文字体", LEVEL_WARN,
        "中文项目，但 Fandol 缓存缺失、系统也没有 fc-match 能找到的中文字体",
        fix="python3 -m factscribe fonts --fetch")


def _git_check(root: Path, which) -> dict:
    exe = which("git")
    if not exe:
        return _check("git", "git", LEVEL_WARN,
                      "没有 git：改动史只能靠文件本身",
                      fix="brew install git")
    try:
        proc = subprocess.run([exe, "-C", str(root), "rev-parse",
                               "--is-inside-work-tree"],
                              capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return _check("git", "git", LEVEL_WARN, "git 存在但跑不起来",
                      fix="检查 git 安装")
    if (proc.stdout or "").strip() == "true":
        return _check("git", "git", LEVEL_OK, "%s（项目在 git 仓内）" % exe)
    return _check(
        "git", "git", LEVEL_WARN,
        "项目不在 git 仓内：解冻/冻结等流水账没有版本史可回看",
        fix="git init")


def _looks_like_paper(root: Path) -> bool:
    """根目录下有没有一篇论文的主文件（`\\documentclass` 在根级 .tex 里）。

    只在根级找：源码仓的 `.tex` 藏在 fixtures/examples/tests 深处，不能因为
    「递归数到 57 个 .tex」就建议 `init --force`——那会覆盖仓库自己的 README。
    """
    for path in sorted(root.glob("*.tex")):
        if not path.is_file():
            continue
        if "\\documentclass" in _read_text(path, limit=65536):
            return True
    return False


def _project_check(root: Path) -> tuple[dict, Config | None]:
    try:
        cfg = load_config(root)
    except ConfigError as exc:
        if (root / "factscribe.toml").is_file():
            return (_check("project", "项目声明", LEVEL_FAIL, str(exc),
                           fix="按报错修项目声明"), None)
        if _looks_like_paper(root):
            clashes = [name for name in INIT_FILES[1:] if (root / name).is_file()]
            detail = ("%s；根目录下有论文主文件（含 \\documentclass），"
                      "像是一篇写完的论文——init 需要空目录。接入步骤见 "
                      "docs/ADOPT.md" % exc)
            if clashes:
                detail += "；--force 会覆盖同名文件：%s" % "、".join(clashes)
                fix = ("先备份 %s，再跑：%s"
                       % ("、".join(clashes),
                          _cmd("python3", "-m", "factscribe", "init", str(root),
                               "--force")))
            else:
                fix = _cmd("python3", "-m", "factscribe", "init", str(root),
                           "--force")
            return (_check("project", "项目声明", LEVEL_FAIL, detail, fix=fix),
                    None)
        entries = list(root.iterdir())
        if not entries:
            return (_check(
                "project", "项目声明", LEVEL_FAIL, str(exc),
                fix=_cmd("python3", "-m", "factscribe", "init", str(root))), None)
        return (_check(
            "project", "项目声明", LEVEL_FAIL,
            "%s；目录非空，init 需要空目录，而这里也没有可识别的论文主文件"
            "（根级 .tex 含 \\documentclass）" % exc,
            fix="换一个空目录建项目：python3 -m factscribe init <新目录>"), None)
    shape = getattr(cfg, "config_shape", "") or ("v3" if cfg.is_v3 else "v1")
    config_shown = find_config_file(cfg.root) or (cfg.root / "factscribe.toml")
    detail = "%s（形态 %s" % (config_shown, shape)
    if cfg.title:
        detail += "，标题「%s」" % cfg.title
    detail += "）"
    warnings = list(getattr(cfg, "warnings", []) or [])
    if warnings:
        return (_check("project", "项目声明", LEVEL_WARN,
                       "%s；另有 %d 条配置告警：%s"
                       % (detail, len(warnings), "；".join(warnings[:2])),
                       fix="按告警改 factscribe.toml"), cfg)
    return _check("project", "项目声明", LEVEL_OK, detail), cfg


def _sections_check(cfg: Config) -> dict:
    try:
        sections = load_sections(cfg)
    except ConfigError as exc:
        return _check("sections", "章节", LEVEL_FAIL, str(exc),
                      fix="检查 factscribe.toml 的 sections / root_tex")
    if not sections:
        return _check("sections", "章节", LEVEL_WARN,
                      "没有匹配到任何 .tex 章节，audit 会对着空正文跑",
                      fix="把正文放进 sections/ 或改 sections 配置")
    return _check("sections", "章节", LEVEL_OK, "%d 个文件" % len(sections))


def _facts_check(cfg: Config) -> tuple[dict, list]:
    try:
        facts = load_facts(cfg)
    except ConfigError as exc:
        return (_check("facts", "事实账", LEVEL_FAIL, str(exc),
                       fix="按报错修 facts/ 下的 TOML"), [])
    if not facts:
        return (_check(
            "facts", "事实账", LEVEL_WARN,
            "账里还没有事实：空账不能通过 check（exit 2）",
            fix=_cmd("python3", "-m", "factscribe", "fact", "add", str(cfg.root),
                     "--id", "A1", "--claim", "一句话主张",
                     "--value", "42", "--source", "results/…")), [])
    return (_check("facts", "事实账", LEVEL_OK, "%d 条" % len(facts)), facts)


def _manifest_check(cfg: Config, facts: list) -> dict:
    if cfg.is_v3:
        return _check("manifest", "人签清单", LEVEL_OK,
                      "V3 项目：证据链走审批目标，不查 results/MANIFEST.toml")
    mpath = cfg.root / cfg.manifest
    if not mpath.is_file():
        return _check(
            "manifest", "人签清单", LEVEL_WARN,
            "缺 %s：工具只能证明账与正文自洽，不能证明 results/ 当初没被编"
            % cfg.manifest,
            fix=_cmd("python3", "-m", "factscribe", "check", str(cfg.root)))
    try:
        data = load_toml(mpath)
    except ConfigError as exc:
        return _check("manifest", "人签清单", LEVEL_FAIL, str(exc),
                      fix="按报错修 %s" % cfg.manifest)
    meta = data.get("manifest")
    signed_by = str(meta.get("signed_by") or "").strip() if isinstance(meta, dict) else ""
    files = data.get("files") if isinstance(data.get("files"), dict) else {}
    if not signed_by:
        return _check(
            "manifest", "人签清单", LEVEL_WARN,
            "%s 还没有 signed_by——没人签的清单不算锚" % cfg.manifest,
            fix="在清单里写 signed_by / signed_at，再跑 check")
    if not files:
        return _check(
            "manifest", "人签清单", LEVEL_WARN,
            "%s 有 signed_by，但 [files] 是空的——没有锁住任何原始材料"
            % cfg.manifest,
            fix=_cmd("python3", "-m", "factscribe", "check", str(cfg.root)))
    missing = []
    for fact in facts:
        src = fact.source.strip()
        if src and src not in files and src not in missing:
            missing.append(src)
    if missing:
        shown = "、".join(missing[:3]) + ("…" if len(missing) > 3 else "")
        return _check(
            "manifest", "人签清单", LEVEL_WARN,
            "%d 条事实的来源没签（%s）" % (len(missing), shown),
            fix=_cmd("python3", "-m", "factscribe", "check", str(cfg.root)))
    return _check("manifest", "人签清单", LEVEL_OK,
                  "%d 个来源已签（signed_by=%s）" % (len(files), signed_by))


def _evidence_check(cfg: Config) -> dict:
    if not getattr(cfg, "evidence_defined", False):
        return _check("evidence", "证据冻结", LEVEL_OK,
                      "未声明 [evidence]（可选；声明了才钉）")
    if read_lock(cfg.root) is None:
        return _check(
            "evidence", "证据冻结", LEVEL_WARN,
            "声明了 [evidence] 但还没有冻结件 %s" % LOCK_REL,
            fix=_cmd("python3", "-m", "factscribe", "evidence", "--freeze",
                     str(cfg.root)))
    frozen = unfrozen_info(cfg.root)
    if frozen is not None:
        return _check(
            "evidence", "证据冻结", LEVEL_WARN,
            "证据清单处于解冻状态（理由：%s），改完必须重新冻结"
            % (frozen.get("reason") or "未写"),
            fix=_cmd("python3", "-m", "factscribe", "evidence", "--freeze",
                     str(cfg.root)))
    return _check("evidence", "证据冻结", LEVEL_OK, "已冻结且未解冻")


def collect(project: Path) -> dict:
    """跑完全部检查；返回可直接进 JSON 的字典。"""
    root = Path(project).expanduser()
    if not root.exists() or not root.is_dir():
        raise ConfigError(
            "目录不存在：%s——先用 `%s` 建项目"
            % (root, _cmd("python3", "-m", "factscribe", "init", str(root))))
    root = root.resolve()

    project, cfg = _project_check(root)
    checks = [_python_check(), _build_check(cfg, shutil.which),
              _pdf_check(shutil.which), project]
    if cfg is not None:
        checks.extend([_sections_check(cfg)])
        facts_check, facts = _facts_check(cfg)
        checks.extend([facts_check, _manifest_check(cfg, facts),
                       _evidence_check(cfg)])
        checks.append(_fonts_check(cfg))
    checks.append(_git_check(root, shutil.which))

    summary = {
        "ok": sum(1 for c in checks if c["level"] == LEVEL_OK),
        "warn": sum(1 for c in checks if c["level"] == LEVEL_WARN),
        "fail": sum(1 for c in checks if c["level"] == LEVEL_FAIL),
    }
    next_steps = []
    for check in checks:
        if check["level"] != LEVEL_OK and check["fix"]:
            if check["fix"] not in next_steps:
                next_steps.append(check["fix"])
    return {"project": str(root), "checks": checks, "summary": summary,
            "next": next_steps}


def _display_width(text: str) -> int:
    """按终端显示宽度算：中文/全角算 2 格，其余 1 格（stdlib 的 unicodedata）。"""
    return sum(2 if unicodedata.east_asian_width(ch) in "WF" else 1
               for ch in text)


def render_human(info: dict) -> str:
    lines = ["== factscribe doctor ==", "项目：%s" % info["project"], ""]
    width = max((_display_width(c["label"]) for c in info["checks"]), default=0)
    for c in info["checks"]:
        pad = " " * (width - _display_width(c["label"]) + 2)
        lines.append("%s %s%s%s" % (_MARK[c["level"]], c["label"], pad,
                                    c["detail"]))
        if c["level"] != LEVEL_OK and c["fix"]:
            lines.append("    修：%s" % c["fix"])
    s = info["summary"]
    lines.append("")
    if s["fail"]:
        verdict = "有 %d 项阻塞，先修；其余可以之后再补。" % s["fail"]
    elif s["warn"]:
        verdict = "能跑；有 %d 项待补，不影响先试 audit。" % s["warn"]
    else:
        verdict = "全部正常。"
    lines.append("结论：%d 项正常 / %d 项待补 / %d 项阻塞。%s"
                 % (s["ok"], s["warn"], s["fail"], verdict))
    if info["next"]:
        lines.append("")
        lines.append("下一步：")
        for i, step in enumerate(info["next"], 1):
            lines.append("  %d. %s" % (i, step))
    else:
        lines.append("可以跑了：%s"
                     % _cmd("python3", "-m", "factscribe", "audit",
                            info["project"]))
    return "\n".join(lines)
