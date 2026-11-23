# -*- coding: utf-8 -*-
"""工作台段五：常用功能（渲染 PDF / 导出投稿包 / 打开项目目录）。

三条硬规矩：

1. **真做，不假装**——渲染 PDF 走 `buildpdf.auto_build`（真调 tectonic），
   导出投稿包走 `bundle.run_bundle`（真收集＋真清单门）。做不出来就把
   失败原因原样报回去，绝不编一个「已生成」糊弄人。
2. **不越权**——PDF 落在盘里的 `main.pdf`（引擎产物），投稿包落在项目**外面**
   的兄弟目录（`bundle` 自己的规矩：包放项目里会污染源项目的审计读数）。
3. **只读盘**——这三个动作都不改论文正文；`打开项目目录` 只是把路径交给
   系统的文件管理器（macOS 的 `open`），非 macOS 就退回「展示路径」。
"""
from __future__ import annotations

import platform
import subprocess
import time
from pathlib import Path

from ..config import ConfigError, load_config

#: 渲染 PDF 的产物名（引擎默认也写这个名字）。
PDF_NAME = "main.pdf"

#: 打开项目目录时给系统的超时（秒）。
OPEN_TIMEOUT = 10

#: 「别真开」闸（条目 32）：这个环境变量非空时，`open_project_dir` **不执行**
#: macOS 的 `open`，只回报路径。端到端脚本与仓库测试一律设它——
#: 跑测试不应该在测试机上弹访达窗口。
NO_OPEN_ENV = "FACTSCRIBE_NO_OPEN"


def _no_open() -> bool:
    """闸门状态：环境变量 `FACTSCRIBE_NO_OPEN` 非空＝不许真开。"""
    import os

    return bool(str(os.environ.get(NO_OPEN_ENV, "") or "").strip())


def _cfg(disk: Path):
    try:
        return load_config(disk)
    except ConfigError:
        raise
    except (OSError, ValueError) as exc:
        raise ConfigError("读项目配置失败：%s" % exc)


def render_pdf(disk: str | Path, engine: str = "tectonic") -> dict:
    """真编译 PDF（tectonic 链路）。返回产物路径、页数与引擎信息。"""
    from ..buildpdf import auto_build

    disk = Path(disk)
    cfg = _cfg(disk)
    root_tex = str(getattr(cfg, "root_tex", "") or "main.tex")
    output = PDF_NAME
    started = time.time()
    rc, message, info = auto_build(disk, output=output, engine=engine,
                                   root_tex=root_tex)
    pdf_path = info.get("pdf_path")
    duration = int((time.time() - started) * 1000)
    ok = rc == 0 and bool(pdf_path)
    result = {
        "ok": ok,
        "action": "pdf",
        "disk": str(disk),
        "engine": info.get("engine"),
        "engine_requested": engine,
        "root_tex": root_tex,
        "pdf_path": pdf_path,
        "pdf_bytes": int(info.get("pdf_bytes") or 0),
        "pdf_pages": int(info.get("pdf_pages") or 0),
        "attempts": info.get("attempts") or [],
        "message": message,
        "duration_ms": duration,
        "exit_code": rc,
    }
    if not ok:
        result["code"] = "PDF_BUILD_FAILED"
        result["error"] = message
    return result


def preview_bundle(disk: str | Path) -> dict:
    """投稿包的**导出前预览**（只读，可选的一步）。

    口径：与真导出**同一条路**（``run_bundle(preview=True)``）——闭包、清单门、
    将要收的每一件（路径/指纹/大小）都照真导出口径算，**一个字节都不写**。

    清单门不过就说不过（``would_export=False``）——预览只是给人看，判定权
    仍在清单门手上，导出口径一个字没改。
    """
    from ..bundle import run_bundle

    disk = Path(disk)
    cfg = _cfg(disk)
    started = time.time()
    try:
        result = run_bundle(cfg, preview=True)
    except ConfigError as exc:
        return {"ok": False, "action": "bundle_preview", "disk": str(disk),
                "code": "BUNDLE_PREVIEW_FAILED", "error": str(exc),
                "duration_ms": int((time.time() - started) * 1000)}
    gate = result.get("gate") or []
    failed = int(result.get("failed") or 0)
    payload = {
        "ok": True,
        "action": "bundle_preview",
        "preview": True,
        "disk": str(disk),
        # 门过不过：与真导出同一套判定（failed>0 就是不过）。
        "would_export": bool(result.get("would_export")),
        "bundle_dir": result.get("bundle_dir"),
        "files": result.get("files") or [],
        "file_count": len(result.get("files") or []),
        "listed_only": result.get("listed_only") or [],
        "excluded": result.get("excluded") or [],
        "manifest_lines": int(result.get("manifest_lines") or 0),
        "gate": gate,
        "failed": failed,
        "passed": int(result.get("passed") or 0),
        "waived": int(result.get("waived") or 0),
        "audit_exit": result.get("audit_exit"),
        "exit_code": int(result.get("exit_code") or 0),
        "failure_reason": result.get("failure_reason", ""),
        "duration_ms": int((time.time() - started) * 1000),
    }
    return payload


def export_bundle(disk: str | Path) -> dict:
    """导出投稿包（真收集＋真清单门）。返回包目录与清单门结论。"""
    from ..bundle import run_bundle

    disk = Path(disk)
    cfg = _cfg(disk)
    started = time.time()
    try:
        result = run_bundle(cfg)
    except ConfigError as exc:
        return {"ok": False, "action": "bundle", "disk": str(disk),
                "code": "BUNDLE_FAILED", "error": str(exc),
                "duration_ms": int((time.time() - started) * 1000)}
    duration = int((time.time() - started) * 1000)
    gate = result.get("gate") or []
    failed = int(result.get("failed") or 0)
    payload = {
        "ok": bool(result.get("exit_code") == 0),
        "action": "bundle",
        "disk": str(disk),
        "bundle_dir": result.get("bundle_dir"),
        "files": result.get("files") or [],
        "file_count": len(result.get("files") or []),
        "listed_only": result.get("listed_only") or [],
        "excluded": result.get("excluded") or [],
        "manifest_lines": int(result.get("manifest_lines") or 0),
        "gate": gate,
        "failed": failed,
        "passed": int(result.get("passed") or 0),
        "waived": int(result.get("waived") or 0),
        "audit_exit": result.get("audit_exit"),
        "exit_code": int(result.get("exit_code") or 0),
        "failure_reason": result.get("failure_reason", ""),
        "duration_ms": duration,
    }
    if not payload["ok"]:
        payload["code"] = "BUNDLE_GATE_FAILED"
        payload["error"] = payload["failure_reason"] or "清单门未过"
    return payload


def open_project_dir(disk: str | Path) -> dict:
    """打开项目目录：macOS 用 `open`；别的系统退回「展示路径」。"""
    disk = Path(disk)
    target = disk.resolve()
    system = platform.system()
    base = {"ok": True, "action": "open_dir", "disk": str(target),
            "system": system, "path": str(target), "opened": False}
    if _no_open():
        # 闸门关着：不调 `open`，只报路径（测试机不应弹访达）。
        base["dry_run"] = True
        base["code"] = "OPEN_SUPPRESSED"
        base["error"] = "设了 %s：不真开，只报路径。" % NO_OPEN_ENV
        base["message"] = base["error"]
        return base
    if system != "Darwin":
        base["code"] = "OPEN_UNSUPPORTED"
        base["error"] = "本机不是 macOS，没法直接唤起文件管理器；路径就在上面。"
        base["message"] = base["error"]
        return base
    try:
        proc = subprocess.run(["open", str(target)], capture_output=True,
                              text=True, timeout=OPEN_TIMEOUT)
    except subprocess.TimeoutExpired:
        base["ok"] = False
        base["code"] = "OPEN_TIMEOUT"
        base["error"] = "打开目录超时（%d 秒）" % OPEN_TIMEOUT
        return base
    except OSError as exc:
        base["ok"] = False
        base["code"] = "OPEN_FAILED"
        base["error"] = "起不动 `open`：%s" % exc
        return base
    if proc.returncode != 0:
        base["ok"] = False
        base["code"] = "OPEN_FAILED"
        base["error"] = (proc.stderr or proc.stdout or "open 退出码 %d"
                         % proc.returncode).strip()
        return base
    base["opened"] = True
    base["message"] = "已在访达里打开：%s" % target
    return base
