# -*- coding: utf-8 -*-
"""工作台段二的本地 HTTP 服务（只用标准库）。

段一只有 GET；段二加了写接口（正文写回、章节管理、项目新建/编辑）；
段三加了检查报告与机器视图（只读真闸读数）；
段七加了追加事实表单的备料（只读）。

端点：
  GET  /api/projects                              项目 + 盘 + 计数 + 进度
  GET  /api/disk/<project>/<disk>/sections        节列表 + 带保护面芯片的 HTML（条目 43：每块带 sha）
  GET  /api/disk/<project>/<disk>/meta            状态行数据
  GET  /api/disk/<project>/<disk>/assembly        装配清单（main.tex 的 \\input 列表，条目 43：每条带 sha）
  GET  /api/disk/<project>/<disk>/block/<id>      一段的可编辑模型（散文 + 保护面 + html + sha）
  GET  /api/disk/<project>/<disk>/pdf              盘里已编译好的 PDF（预览/下载）
  GET  /api/disk/<project>/<disk>/report          检查报告（体检摘要 + 发现 + 四步链）
  GET  /api/disk/<project>/<disk>/machine         机器视图（账本表/正文扫描/证据链/命令）
  GET  /api/disk/<project>/<disk>/fact-form       追加事实表单的备料（已签产物/未签产物/账本文件/命名风格）
  GET  /api/disk/<project>/<disk>/facts           事实账清单（只读）：插入事实面板的备料
  POST /api/disk/<project>/<disk>/edit            写回一段（block=cover-abstract 写摘要；条目 43：带 expect_sha 保存闸，
                                                  应答 blocks=同文件全部块的新鲜 html，指纹不符 → 409 BLOCK_STALE）
  POST /api/disk/<project>/<disk>/action          常用功能（pdf / bundle / open_dir）
  POST /api/disk/<project>/<disk>/toc/move        调序
  POST /api/disk/<project>/<disk>/toc/delete      删除（挪 attic）
  POST /api/disk/<project>/<disk>/toc/create      新建一节
  POST /api/disk/<project>/<disk>/toc/rename      改一节的标题（只动标题命令）
  POST /api/disk/<project>/<disk>/title           改论文标题/副标题（入口 .tex 的 \\title）
  POST /api/disk/<project>/<disk>/fact/insert     把账上的一条事实绑进正文（插 \\fact{} 标记）
  POST /api/disk/<project>/<disk>/report/rerun    只读重跑真闸（限时 120s，零写入）
  POST /api/project/new                           新建论文项目（落盘）
  POST /api/project/update                        改项目（标题等）
  POST /api/project/opened                        记「最近打开」
  POST /api/chat                                  AI 对话（OpenAI 兼容后端；不可达→降级）
  POST /api/chat/prepare                          只组装给宿主 Agent 的提示词（**不调模型**）
  GET  /api/ai/models?project=&disk=              可选模型清单（[ai].models；缺省模型保证在列）
  GET  /api/project/<p>/reports                   报告页的卡（含导入草稿）
  GET  /api/project/<p>/reports/dir               列实验报告目录下的真实文件
  POST /api/project/<p>/reports/upload            上传报告文件进该目录（multipart）
  POST /api/project/<p>/reports/parse             解析报告（预览 + 自动映射）
  POST /api/project/<p>/reports/confirm           写草稿（绝不写活账本）
  GET  /api/project/<p>/knowledge                 知识库文件清单（项目目录里真有的）
  GET  /api/project/<p>/knowledge/preview         看一个文件的内容（文本类直接读）
  POST /api/project/<p>/knowledge/upload          上传进知识库目录（multipart）
  GET  /api/project/<p>/venue                     版式配置（刊物/截稿/语言锁定）
  POST /api/project/<p>/venue                     存版式配置（落 workbench.toml）
  POST /api/disk/<project>/<disk>/draft/insert    AI 草稿块写进稿（该段之后）
  POST /api/disk/<project>/<disk>/draft/delete    删掉一个 AI 草稿块
  GET  /                                           前端单页
  GET  /static/<name>                             前端静态文件
"""
from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from ..config import ConfigError
from .projects import MAX_DEPTH, disk_meta, disk_sections, load_projects
from .proposal import (ProposalError, create_proposal, list_proposals,
                        read_proposal, resolve_proposal)
from .proposals import display_catalog
from .write import (ABSTRACT_BLOCK_ID, BLOCK_STALE_CODE,
                    TOKEN_MISMATCH_CODE, TOKEN_COUNT_MISMATCH_CODE,
                    abstract_block,
                    apply_proposal, create_paper_project, create_section,
                    delete_section, editable_model, find_block,
                    insert_fact_binding, move_section, rename_section,
                    save_abstract, save_block, set_disk_title, touch_opened,
                    update_paper_project)

STATIC_DIR = Path(__file__).resolve().parent / "static"
STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


def _lang_of(query: str) -> str:
    """查询串里的 lang（zh / en）——发现文案的渲染语言。

    缺省＝zh（中文界面＝真闸原话）。认不出的一律当 zh。
    """
    for part in str(query or "").split("&"):
        if part.startswith("lang="):
            value = part[5:].strip().lower()
            return "en" if value == "en" else "zh"
    return "zh"


def _param_of(query: str, name: str) -> str:
    """查询串里的一个参数（没有就是空串）。

    只认 ``name=value``；值原样返回（调用方自己收拾）。
    """
    prefix = name + "="
    for part in str(query or "").split("&"):
        if part.startswith(prefix):
            return part[len(prefix):].strip()
    return ""


def _parse_multipart_file(content_type: str, raw: bytes) -> tuple[str, bytes]:
    """从 multipart/form-data 里取出第一个文件：(文件名, 字节)。

    只用标准库：`cgi` 在 3.13 已被移除，这里走 `email` 的解析器。
    """
    if not raw:
        return "", b""
    ctype = str(content_type or "")
    if "multipart/form-data" not in ctype:
        return "", b""
    header = ("Content-Type: %s\r\nMIME-Version: 1.0\r\n\r\n" % ctype).encode("utf-8")
    try:
        from email.parser import BytesParser
        from email.policy import default as default_policy

        message = BytesParser(policy=default_policy).parsebytes(header + raw)
    except Exception:  # noqa: BLE001 - 解析不了就当没收到文件
        return "", b""
    for part in message.iter_parts():
        filename = part.get_filename()
        if not filename:
            continue
        payload = part.get_payload(decode=True)
        if payload is None:
            continue
        return str(filename), bytes(payload)
    return "", b""


class ProjectIndex:
    """项目索引：短 TTL 缓存，避免每次请求都重扫磁盘。"""

    def __init__(self, root: str | Path, max_depth: int = MAX_DEPTH,
                 ttl: float = 2.0, state_dir: str = "") -> None:
        self.root = Path(root).expanduser()
        self.max_depth = max_depth
        self.ttl = ttl
        # 提议单落哪儿（v2）：显式传入 → 环境变量 → 工具自己的家目录。
        self.state_dir = state_dir
        self._lock = threading.Lock()
        self._stamp = 0.0
        self._projects: list[dict] = []

    def projects(self, refresh: bool = False) -> list[dict]:
        now = time.monotonic()
        with self._lock:
            if not refresh and self._projects and (now - self._stamp) < self.ttl:
                return self._projects
            self._projects = load_projects(self.root, max_depth=self.max_depth)
            self._stamp = now
            return self._projects

    def disk_path(self, project_id: str, disk_id: str) -> Path | None:
        for project in self.projects():
            if project["id"] != project_id:
                continue
            for disk in project["disks"]:
                if disk["id"] == disk_id:
                    return Path(disk["path"])
        return None

    def disk_lang(self, project_id: str, disk_id: str) -> str:
        for project in self.projects():
            if project["id"] != project_id:
                continue
            for disk in project["disks"]:
                if disk["id"] == disk_id:
                    return str(disk.get("lang") or "")
        return ""

    def writable_disk(self, project_id: str, disk_id: str) -> Path | None:
        """写操作的目标盘：必须在这个根目录下面（只写页面打开过的项目）。"""
        path = self.disk_path(project_id, disk_id)
        if path is None:
            return None
        try:
            path.resolve().relative_to(self.root.resolve())
        except (OSError, ValueError):
            return None
        return path

    def project_disks(self, project_id: str) -> list[dict]:
        """这个项目的盘（英文盘在前）。"""
        for project in self.projects():
            if project["id"] == project_id:
                return list(project.get("disks") or [])
        return []

    def sibling_disk_path(self, project_id: str, disk_id: str) -> Path | None:
        """同一项目里**另一个**盘（优先另一个语言）——双语双盘对账用。

        没有第二个盘就返回 None（对账读数就是「不适用」，不是错）。
        """
        disks = self.project_disks(project_id)
        current = next((d for d in disks if d["id"] == disk_id), None)
        if current is None:
            return None
        others = [d for d in disks if d["id"] != disk_id]
        if not others:
            return None
        other = next((d for d in others
                      if d.get("lang") != current.get("lang")), others[0])
        try:
            return Path(other["path"])
        except (KeyError, TypeError):
            return None

    def project_disk_path(self, project_id: str) -> Path | None:
        """项目的主盘（英文盘优先）：报告目录与草稿都跟着它走。"""
        disks = self.project_disks(project_id)
        if not disks:
            return None
        primary = next((d for d in disks if d.get("lang") == "en"), disks[0])
        return Path(primary["path"])


class WorkbenchHandler(BaseHTTPRequestHandler):
    """只读 JSON + 静态文件。"""

    server_version = "FactScribeWorkbench/1"
    index: ProjectIndex  # 由 create_server 注入

    # ---- 基础输出 ----

    def log_message(self, fmt, *args):  # noqa: D102 - 安静一点
        if getattr(self.server, "verbose", False):
            super().log_message(fmt, *args)

    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, payload: object, code: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(code, body, "application/json; charset=utf-8")

    def _error(self, code: int, message: str, err_code: str = "",
               err_params: dict | None = None) -> None:
        # err_code＝机器可读的错因（展示层据此翻语言）；code 仍是 HTTP 状态。
        # err_params＝那些文案的槽位取值（key ＋ params 那套）。
        payload = {"ok": False, "error": message, "code": code}
        if err_code:
            payload["err_code"] = str(err_code)
        if err_params:
            payload["err_params"] = dict(err_params)
        self._json(payload, code=code)

    # ---- 路由 ----

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler 的约定
        parsed = urlparse(self.path)
        route = unquote(parsed.path)
        query = parsed.query
        if route in ("/", "/index.html"):
            return self._static("index.html")
        if route.startswith("/static/"):
            return self._static(route[len("/static/"):])
        if route == "/api/projects":
            refresh = "refresh=1" in query
            projects = self.index.projects(refresh=refresh)
            return self._json({"ok": True, "root": str(self.index.root),
                               "count": len(projects), "projects": projects})
        if route == "/api/ai/models":
            return self._ai_models_get(query)
        if route.startswith("/api/project/"):
            parts = [part for part in route.split("/") if part]
            # /api/project/<project>/reports[/<what>]
            if len(parts) in (4, 5) and parts[3] == "reports":
                return self._reports_get(parts[2], parts[4] if len(parts) > 4 else "",
                                         query)
            # 段六：/api/project/<project>/knowledge[/preview]
            if len(parts) in (4, 5) and parts[3] == "knowledge":
                return self._knowledge_get(parts[2], parts[4] if len(parts) > 4 else "",
                                           query)
            # 段六：/api/project/<project>/venue
            if len(parts) == 4 and parts[3] == "venue":
                return self._venue_get(parts[2])
        if route.startswith("/api/disk/"):
            parts = [part for part in route.split("/") if part]
            # /api/disk/<project>/<disk>/<what>[/<arg>]
            if len(parts) not in (5, 6):
                return self._error(404, "路径不对：/api/disk/<project>/<disk>/<sections|meta|assembly|block>")
            project_id, disk_id, what = parts[2], parts[3], parts[4]
            disk_path = self.index.disk_path(project_id, disk_id)
            if disk_path is None:
                return self._error(404, "没有这个盘：%s/%s" % (project_id, disk_id))
            lang = self.index.disk_lang(project_id, disk_id)
            if what == "sections":
                data = disk_sections(disk_path, lang=lang)
                data.update({"ok": True, "project": project_id, "disk": disk_id,
                             "lang": lang})
                return self._json(data)
            if what == "meta":
                data = disk_meta(disk_path, lang=lang)
                data.update({"ok": True, "project": project_id, "disk": disk_id})
                return self._json(data)
            if what == "assembly":
                from .write import read_assembly
                data = read_assembly(disk_path)
                data.update({"ok": True, "project": project_id, "disk": disk_id})
                return self._json(data)
            if what == "block" and len(parts) == 6:
                rel = parts[5]
                return self._json(self._block_model(project_id, disk_id,
                                                    disk_path, rel))
            if what == "pdf":
                return self._serve_pdf(disk_path)
            if what == "report":
                from .checkreport import report_payload
                data = report_payload(
                    disk_path,
                    sibling_disk=self.index.sibling_disk_path(project_id,
                                                               disk_id),
                    lang=_lang_of(query))
                data.update({"project": project_id, "disk": disk_id})
                return self._json(data)
            if what == "style":
                from .checkreport import style_gate
                data = style_gate(disk_path, lang=_lang_of(query))
                data.update({"project": project_id, "disk": disk_id})
                return self._json(data)
            if what == "mirror":
                from .checkreport import mirror_gate
                data = mirror_gate(
                    disk_path,
                    self.index.sibling_disk_path(project_id, disk_id),
                    lang=_lang_of(query))
                data.update({"project": project_id, "disk": disk_id})
                return self._json(data)
            if what == "evidence":
                from .readings import evidence_gate
                data = evidence_gate(disk_path)
                data.update({"project": project_id, "disk": disk_id})
                return self._json(data)
            if what == "brief":
                from .readings import brief_reading
                data = brief_reading(disk_path, _param_of(query, "section"),
                                     _param_of(query, "fact"))
                data.update({"project": project_id, "disk": disk_id})
                return self._json(data)
            if what == "facts":
                from .readings import facts_list
                data = facts_list(disk_path)
                data.update({"project": project_id, "disk": disk_id})
                return self._json(data)
            if what == "fact-form":
                from .readings import fact_form
                data = fact_form(disk_path)
                data.update({"project": project_id, "disk": disk_id})
                return self._json(data)
            if what == "bundle-preview":
                # 投稿包导出前的**可选预览**（只读）：将要收什么、清单门过不过。
                # 判定权仍在清单门；预览一个字节都不写。
                from .actions import preview_bundle
                data = preview_bundle(disk_path)
                data.update({"project": project_id, "disk": disk_id})
                return self._json(data)
            if what == "machine":
                from .checkreport import machine_payload
                data = machine_payload(disk_path)
                data.update({"project": project_id, "disk": disk_id})
                return self._json(data)
            if what == "proposal":
                return self._proposal_get(project_id, disk_id,
                                           parts[5] if len(parts) > 5 else "",
                                           query)
            return self._error(404, "没有这个接口：%s" % what)
        return self._error(404, "没有这个接口：%s" % route)

    def _block_model(self, project_id: str, disk_id: str,
                     disk_path: Path, rel: str) -> dict:
        """一段的可编辑模型：散文（带占位符）＋保护面芯片。"""
        if rel == ABSTRACT_BLOCK_ID:
            # 封面摘要：根文件 abstract 环境（不是 sections/ 下的段）。
            try:
                block = abstract_block(disk_path)
            except ConfigError as exc:
                return {"ok": False, "error": str(exc),
                        "code": getattr(exc, "code", "ABSTRACT_MISSING"),
                        "status": 400}
            data = editable_model(disk_path, block)
            data.update({"ok": True, "project": project_id, "disk": disk_id})
            return data
        blocks = disk_sections(disk_path)["blocks"]
        target = next((b for b in blocks if b["id"] == rel), None)
        if target is None:
            return {"ok": False, "error": "没有这一段：%s" % rel, "code": 404}
        from .write import Block
        block = Block(file=target.get("file", ""), block_id=target["id"],
                      kind=target["kind"], start=target["start"],
                      end=target["end"], raw=target.get("raw", ""),
                      title=target.get("title", ""))
        data = editable_model(disk_path, block)
        data.update({"ok": True, "project": project_id, "disk": disk_id})
        return data

    def _serve_pdf(self, disk_path: Path) -> None:
        """回传盘里已编译好的 PDF（预览/下载用）。"""
        from .actions import PDF_NAME

        target = disk_path / PDF_NAME
        if not target.is_file():
            return self._error(404, "这个盘还没有编译好的 PDF（先点「渲染 PDF」）")
        try:
            body = target.read_bytes()
        except OSError as exc:
            return self._error(404, "读不到 PDF：%s" % exc)
        return self._send(200, body, "application/pdf")

    def do_HEAD(self) -> None:  # noqa: N802
        self.do_GET()

    def do_POST(self) -> None:  # noqa: N802
        """段二：写接口；段四：AI 对话与实验报告导入。"""
        parsed = urlparse(self.path)
        route = unquote(parsed.path)
        # 上传走 multipart：自己读原始字节，别让 _body 吞掉。
        if route.startswith("/api/project/") and route.endswith("/reports/upload"):
            parts = [part for part in route.split("/") if part]
            if len(parts) == 5:
                return self._reports_upload(parts[2])
        if route.startswith("/api/project/") and route.endswith("/knowledge/upload"):
            parts = [part for part in route.split("/") if part]
            if len(parts) == 5:
                return self._knowledge_upload(parts[2])
        body = self._body()
        # 只有这几个接口接受写；其余的路由仍是只读（405，跟段一一致）。
        if route == "/api/chat":
            return self._chat(body)
        if route == "/api/chat/prepare":
            return self._chat_prepare(body)
        if not (route.startswith("/api/disk/") or route.startswith("/api/project/")):
            return self._error(405, "这个接口只有 GET（段一就是只读的）")
        try:
            if route.startswith("/api/disk/"):
                parts = [part for part in route.split("/") if part]
                # 段三：只读重跑（不是写接口，不必是可写盘）。
                if (len(parts) == 6 and parts[4] == "report"
                        and parts[5] == "rerun"):
                    return self._report_rerun(parts[2], parts[3])
                return self._disk_post(route, body)
            if route == "/api/project/new":
                return self._project_new(body)
            if route == "/api/project/update":
                return self._project_update(body)
            if route == "/api/project/opened":
                return self._project_opened(body)
            if route.startswith("/api/project/"):
                parts = [part for part in route.split("/") if part]
                # /api/project/<project>/reports/<what>
                if len(parts) == 5 and parts[3] == "reports":
                    if parts[4] == "parse":
                        return self._reports_parse(parts[2], body)
                    if parts[4] == "confirm":
                        return self._reports_confirm(parts[2], body)
                    if parts[4] == "delete":
                        return self._reports_delete(parts[2], body)
                    return self._error(404, "没有这个报告操作：%s" % parts[4])
                # /api/project/<project>/knowledge/delete
                if len(parts) == 5 and parts[3] == "knowledge" and parts[4] == "delete":
                    return self._knowledge_delete(parts[2], body)
                # /api/project/<project>/venue
                if len(parts) == 4 and parts[3] == "venue":
                    return self._venue_save(parts[2], body)
        except ConfigError as exc:
            return self._error(400, str(exc))
        except (OSError, ValueError) as exc:
            return self._error(400, "写盘失败：%s" % exc)
        return self._error(404, "没有这个接口：%s" % route)

    # ---- 写接口的实现 ----

    def _report_rerun(self, project_id: str, disk_id: str) -> None:
        """段三：只读重跑真闸（subprocess，限时 120s，跑前跑后哈希对比）。"""
        disk = self.index.disk_path(project_id, disk_id)
        if disk is None:
            return self._error(404, "没有这个盘：%s/%s" % (project_id, disk_id))
        from .checkreport import rerun
        result = rerun(disk)
        result.update({"project": project_id, "disk": disk_id})
        return self._json(result)

    def _disk_post(self, route: str, body: dict) -> None:
        parts = [part for part in route.split("/") if part]
        # /api/disk/<project>/<disk>/<action>[/<arg>]
        if len(parts) < 5:
            return self._error(404, "路径不对")
        project_id, disk_id, action = parts[2], parts[3], parts[4]
        disk = self.index.writable_disk(project_id, disk_id)
        if disk is None:
            return self._error(404, "没有这个盘（或不在根目录下）：%s/%s"
                               % (project_id, disk_id))
        if action == "edit":
            rel = str(body.get("file") or "")
            block_id = str(body.get("block") or "")
            text = body.get("text")
            # 条目 43：保存闸——客户端上报它所基于的块原文指纹，对不上拒写。
            expect = str(body.get("expect_sha") or "")
            # 结构闸：客户端那份 DOM 是哪一版**结构**渲染出来的（几枚保护面）。
            expect_tokens = str(body.get("expect_tokens") or "")
            if not block_id or not isinstance(text, str):
                return self._error(400, "block / text 都要给")
            if block_id == ABSTRACT_BLOCK_ID:
                # 封面摘要：根文件 abstract 环境（id 固定，不带 file）。
                try:
                    result = save_abstract(disk, text, expect_sha=expect,
                                        expect_tokens=expect_tokens)
                except ConfigError as exc:
                    code = getattr(exc, "code", "")
                    if code in (BLOCK_STALE_CODE, TOKEN_MISMATCH_CODE,
                                TOKEN_COUNT_MISMATCH_CODE):
                        stale_file = ""
                        try:
                            stale_file = abstract_block(disk).file
                        except ConfigError:
                            stale_file = ""
                        return self._stale_response(disk, stale_file, block_id,
                                                   code=code)
                    raise
                # 条目 36：写回之后对这一块做轻渲染，前端据此原地更新。
                result["block"] = block_id
                result["html"] = self._rerender_block(disk, "", block_id)
                # 条目 43：同文件全部块的新鲜渲染（带 token），兄弟段就地刷新。
                result["blocks"] = self._fresh_blocks(
                    disk, str(result.get("file") or ""))
                return self._json(result)
            if not rel:
                return self._error(400, "file / block / text 都要给")
            try:
                result = save_block(disk, rel, block_id, text,
                                     expect_sha=expect,
                                     expect_tokens=expect_tokens)
            except ConfigError as exc:
                code = getattr(exc, "code", "")
                if code in (BLOCK_STALE_CODE, TOKEN_MISMATCH_CODE,
                            TOKEN_COUNT_MISMATCH_CODE):
                    return self._stale_response(disk, rel, block_id, code=code)
                raise
            # 条目 36：写回之后对这一块做轻渲染，前端据此原地更新。
            result["block"] = block_id
            result["html"] = self._rerender_block(disk, rel, block_id)
            # 条目 43：同文件全部块的新鲜渲染（带 token），兄弟段就地刷新。
            result["blocks"] = self._fresh_blocks(disk, rel)
            return self._json(result)
        if action == "action":
            return self._disk_action(project_id, disk_id, disk, body)
        if action == "assembly":
            from .write import read_assembly
            return self._json({"ok": True, **read_assembly(disk)})
        if action == "toc":
            what = parts[5] if len(parts) > 5 else ""
            if what == "move":
                result = move_section(disk, str(body.get("file") or ""),
                                      str(body.get("direction") or ""))
            elif what == "delete":
                result = delete_section(disk, str(body.get("file") or ""))
            elif what == "create":
                result = create_section(disk, str(body.get("title") or ""),
                                        slug=str(body.get("slug") or ""),
                                        after=str(body.get("after") or ""))
            elif what == "rename":
                rel = str(body.get("file") or "")
                try:
                    result = rename_section(disk, rel,
                                            str(body.get("block") or ""),
                                            str(body.get("title") or ""),
                                            expect_sha=str(body.get("expect_sha") or ""))
                except ConfigError as exc:
                    return self._write_error(exc)
            else:
                return self._error(404, "没有这个目录操作：%s" % what)
            return self._json(result)
        if action == "title":
            # 改论文标题：写的就是封面读的那一条标题命令。
            try:
                result = set_disk_title(disk, str(body.get("title") or ""),
                                        subtitle=str(body.get("subtitle") or ""),
                                        expect_sha=str(body.get("expect_sha") or ""))
            except ConfigError as exc:
                return self._write_error(exc)
            return self._json(result)
        if action == "fact" and len(parts) > 5 and parts[5] == "insert":
            # 把账上的一条事实绑进正文：数字来自账本，且过既有 value 硬闸。
            rel = str(body.get("file") or "")
            block_id = str(body.get("block") or "")
            if not rel or not block_id:
                return self._error(400, "file / block 都要给")
            try:
                result = insert_fact_binding(disk, rel, block_id,
                                             str(body.get("fact") or ""),
                                             expect_sha=str(body.get("expect_sha") or ""))
            except ConfigError as exc:
                if str(getattr(exc, "code", "")) == BLOCK_STALE_CODE:
                    return self._stale_response(disk, rel, block_id, str(exc))
                return self._write_error(exc)
            # 插进去的事实标记是新的保护面：同文件的新鲜渲染给前端原地换。
            result["blocks"] = self._fresh_blocks(disk, rel)
            result["shas"] = self._fresh_shas(disk, rel)
            result["html"] = self._rerender_block(disk, rel, block_id)
            return self._json(result)
        if action == "draft":
            return self._draft_post(disk, parts[5] if len(parts) > 5 else "", body)
        if action == "proposal":
            return self._proposal_post(project_id, disk_id, disk,
                                       parts[5:], body)
        return self._error(404, "没有这个操作：%s" % action)

    # ---- 提议单（v2）：AI 提议 → 人确认才写回 ----

    def _proposal_get(self, project_id: str, disk_id: str, pid: str,
                      query: str) -> None:
        """列提议单 / 取一张提议单（只读）。"""
        state = self.index.state_dir
        if pid:
            try:
                data = read_proposal(state, pid)
            except ProposalError as exc:
                return self._error(exc.status, str(exc))
            return self._json({"ok": True, "proposal": data})
        status = "pending"
        for pair in query.split("&"):
            if pair.startswith("status="):
                status = pair.split("=", 1)[1] or "pending"
        rows = list_proposals(state, project=project_id, disk=disk_id,
                              status=status)
        # 展示层文案目录随列表走：前端按界面语言翻（EN 不留中文）。
        return self._json({"ok": True, "count": len(rows), "proposals": rows,
                           "i18n": display_catalog(rows)})

    def _proposal_post(self, project_id: str, disk_id: str, disk: Path,
                       rest: list, body: dict) -> None:
        """建单（不碰正文）／采纳（落盘）／丢弃。"""
        state = self.index.state_dir
        pid = rest[0] if rest else ""
        what = rest[1] if len(rest) > 1 else ""
        if not pid:
            try:
                record = create_proposal(state, project_id, disk_id, disk, body)
            except ConfigError as exc:
                return self._error(400, str(exc),
                                   err_code=str(getattr(exc, "code", "") or ""),
                                   err_params=getattr(exc, "params", None))
            except ProposalError as exc:
                return self._error(exc.status, str(exc))
            return self._json({"ok": True, "proposal": record})
        if what == "confirm":
            try:
                proposal = read_proposal(state, pid)
            except ProposalError as exc:
                return self._error(exc.status, str(exc))
            if str(proposal.get("status") or "") != "pending":
                return self._error(409, "这张提议单已经处理过了（%s）。"
                                   % proposal.get("status"))
            try:
                applied = apply_proposal(disk, proposal)
            except ConfigError as exc:
                if getattr(exc, "code", "") == BLOCK_STALE_CODE:
                    # 提议之后状态被别处改过：拒写，把新鲜块回给前端。
                    try:
                        resolve_proposal(state, pid, "stale")
                    except ProposalError:
                        pass
                    return self._stale_response(
                        disk, str(proposal.get("file") or ""),
                        str(proposal.get("block") or ""),
                        message=str(exc))
                return self._error(400, str(exc),
                                   err_code=str(getattr(exc, "code", "") or ""),
                                   err_params=getattr(exc, "params", None))
            record = resolve_proposal(state, pid, "applied")
            result = {"ok": True, "proposal": record, "applied": applied,
                      "warnings": applied.get("warnings") or []}
            rel = str(applied.get("file") or "")
            if rel:
                result["html"] = self._rerender_block(
                    disk, rel, str(applied.get("block") or ""))
                result["blocks"] = self._fresh_blocks(disk, rel)
            return self._json(result)
        if what == "reject":
            try:
                record = resolve_proposal(state, pid, "rejected")
            except ProposalError as exc:
                return self._error(exc.status, str(exc))
            return self._json({"ok": True, "proposal": record})
        return self._error(404, "没有这个提议操作：%s" % what)

    def _rerender_block(self, disk: Path, rel: str, block_id: str) -> str:
        """写回之后，对**这一个块**做轻渲染，返回它的新 html。

        条目 36：前端不再整篇重载，靠这个 html 原地换掉那一块的 DOM。
        条目 43：渲染带盘上下文（拿事实账认绑定数字），token 与模型同源。
        """
        from .projects import disk_sections, render_tex

        try:
            if block_id == ABSTRACT_BLOCK_ID:
                for block in disk_sections(disk).get("blocks", []):
                    if block.get("id") == block_id:
                        return str(block.get("html") or "")
                return ""
            if not rel:
                return ""
            path = Path(disk) / rel
            text = path.read_text(encoding="utf-8", errors="replace")
            for block in render_tex(text, stem=Path(rel).stem, disk_root=disk):
                if block.get("id") == block_id:
                    return str(block.get("html") or "")
        except (OSError, ValueError):
            return ""
        return ""

    def _fresh_blocks(self, disk: Path, rel: str) -> dict:
        """条目 43：同一文件全部块的新鲜渲染（带 token）：``{block_id: html}``。

        本轮保存后，同文件其他段落烤在 DOM 里的 token 能立刻刷新，
        杜绝「兄弟段 token 过期」错映射。``rel`` 为空＝不限文件。
        """
        out: dict = {}
        try:
            for block in disk_sections(disk).get("blocks", []):
                if rel and block.get("file") != rel:
                    continue
                html = str(block.get("html") or "")
                if html:
                    out[str(block.get("id"))] = html
        except (OSError, ValueError):
            return out
        return out

    def _write_error(self, exc: ConfigError) -> None:
        """写接口的 ConfigError → 结构化错误（机器码 ＋ 槽位，界面据此翻语言）。"""
        code = str(getattr(exc, "code", "") or "")
        status = 409 if code == BLOCK_STALE_CODE else 400
        self._error(status, str(exc), code,
                    getattr(exc, "params", None) or None)

    def _fresh_shas(self, disk: Path, rel: str) -> dict:
        """同文件各块的**新鲜指纹**（写回之后前端要跟上，否则下一轮撞指纹闸）。

        与 _fresh_blocks 同源（同一份块列表），只是取的是 sha 字段。
        """
        out: dict = {}
        try:
            from .projects import disk_sections

            for block in disk_sections(disk).get("blocks", []):
                if rel and block.get("file") != rel:
                    continue
                if block.get("sha"):
                    out[str(block.get("id"))] = str(block.get("sha"))
        except (OSError, ValueError):
            return out
        return out

    def _stale_response(self, disk: Path, rel: str, block_id: str,
                        message: str = "",
                        code: str = BLOCK_STALE_CODE) -> None:
        """条目 43：保存闸拒写（HTTP 409 BLOCK_STALE）。

        附同文件全部块的新鲜渲染，前端原地重载（未保存的字会丢，提示说清）。
        账与证据面的提议单（正文文件为空）不附块——它们不碰正文。

        保护面序号对不上（EDIT_TOKEN_MISMATCH）也走这条：客户端那份 DOM 是
        旧版本渲染的，重建出来会改掉用户没打过的字——宁可拒写并让前端重载。
        """
        return self._json({
            "ok": False,
            "error": message or "这段在别处已被改动，请重新编辑。",
            "code": code,
            "block": block_id,
            "blocks": self._fresh_blocks(disk, rel) if rel else {},
        }, code=409)

    def _draft_post(self, disk: Path, what: str, body: dict) -> None:
        """段六：AI 草稿块——写进稿 ＋ 删除。"""
        from .write import delete_ai_draft, insert_ai_draft

        rel = str(body.get("file") or "")
        block_id = str(body.get("block") or "")
        if not rel or not block_id:
            return self._error(400, "file / block 都要给")
        try:
            if what == "insert":
                text = body.get("text")
                if not isinstance(text, str) or not text.strip():
                    return self._error(400, "text 要给（要写进稿的正文）")
                result = insert_ai_draft(disk, rel, block_id, text)
            elif what == "delete":
                result = delete_ai_draft(disk, rel, block_id)
            else:
                return self._error(404, "没有这个草稿操作：%s" % what)
            # 条目 36：把受影响那块的新 html 一并回传，前端原地更新。
            affected = str(result.get("block") or block_id)
            result["html"] = self._rerender_block(disk, rel, affected)
            result["affected"] = affected
        except ConfigError as exc:
            return self._error(400, str(exc))
        except (OSError, ValueError) as exc:
            return self._error(400, "写盘失败：%s" % exc)
        return self._json(result)

    def _disk_action(self, project_id: str, disk_id: str,
                     disk: Path, body: dict) -> None:
        """常用功能：渲染 PDF / 导出投稿包 / 打开项目目录（真做）。"""
        from .actions import export_bundle, open_project_dir, render_pdf

        what = str(body.get("action") or body.get("what") or "").strip()
        try:
            if what == "pdf":
                result = render_pdf(disk)
            elif what == "bundle":
                result = export_bundle(disk)
            elif what == "open_dir":
                result = open_project_dir(disk)
            else:
                return self._error(404, "没有这个动作：%s" % what)
        except ConfigError as exc:
            return self._error(400, str(exc))
        except (OSError, ValueError) as exc:
            return self._error(400, "动作失败：%s" % exc)
        result.update({"project": project_id, "disk": disk_id})
        # 失败也是 200：前端要拿 detail 渲染人话原因（HTTP 码只管路由）。
        return self._json(result, code=200)

    def _project_new(self, body: dict) -> None:
        root = self.index.root
        result = create_paper_project(
            root,
            slug=str(body.get("slug") or ""),
            title=str(body.get("title") or ""),
            langs=body.get("langs") or ["en"],
            journal=str(body.get("journal") or ""),
            template=str(body.get("template") or ""),
            question=str(body.get("question") or ""),
            project_dir=str(body.get("project_dir") or ""),
            reports_dir=str(body.get("reports_dir") or ""))
        self.index.projects(refresh=True)
        return self._json(result)

    def _project_update(self, body: dict) -> None:
        disk = self.index.writable_disk(str(body.get("project") or ""),
                                         str(body.get("disk") or ""))
        if disk is None:
            return self._error(404, "没有这个盘")
        result = update_paper_project(
            disk,
            title=str(body.get("title") or ""),
            journal=str(body.get("journal") or ""),
            template=str(body.get("template") or ""),
            question=str(body.get("question") or ""),
            reports_dir=str(body.get("reports_dir") or ""),
            last_disk=str(body.get("last_disk") or ""))
        self.index.projects(refresh=True)
        return self._json(result)

    def _project_opened(self, body: dict) -> None:
        disk = self.index.writable_disk(str(body.get("project") or ""),
                                         str(body.get("disk") or ""))
        if disk is None:
            return self._error(404, "没有这个盘")
        result = touch_opened(disk)
        self.index.projects(refresh=True)
        return self._json({"ok": True, **result})

    # ---- 段四：AI 对话 ----

    def _chat_prepare(self, body: dict) -> None:
        """组装给宿主 Agent 的提示词（**不调模型**）。

        MiniApp 侧由薄壳用宿主 Agent 跑这一轮：宿主 Agent 自带系统提示，
        改不了它的角色，所以把「角色＋材料＋此前对话＋用户提问」拼成一段
        用户消息交给它。材料与 `/api/chat` 用的是同一套 `build_context`。
        """
        from .ai import prepare_prompt

        project_id = str(body.get("project") or "")
        disk_id = str(body.get("disk") or "")
        messages = body.get("messages")
        if not isinstance(messages, list) or not messages:
            return self._error(400, "messages 要给（非空数组）")
        disk = self.index.disk_path(project_id, disk_id)
        if disk is None:
            return self._error(404, "没有这个盘：%s/%s" % (project_id, disk_id))
        quote = body.get("quote")
        if not isinstance(quote, dict):
            quote = None
        result = prepare_prompt(disk, messages, quote=quote,
                                mode=str(body.get("mode") or "ask"),
                                action=str(body.get("action") or "ask"),
                                lang=str(body.get("lang") or ""))
        result.update({"project": project_id, "disk": disk_id})
        return self._json(result, code=200)


    def _chat(self, body: dict) -> None:
        """AI 对话：组装上下文 → 打真后端 → 渲染回复。

        后端不可达 / 超时时返回 `ok=False, fallback=True`，模拟回复首行
        标注「模拟回答（未接模型）」——绝不静默造假。
        """
        from .ai import chat

        project_id = str(body.get("project") or "")
        disk_id = str(body.get("disk") or "")
        messages = body.get("messages")
        if not isinstance(messages, list) or not messages:
            return self._error(400, "messages 要给（非空数组）")
        disk = self.index.disk_path(project_id, disk_id)
        if disk is None:
            return self._error(404, "没有这个盘：%s/%s" % (project_id, disk_id))
        quote = body.get("quote")
        if not isinstance(quote, dict):
            quote = None
        mode = str(body.get("mode") or "ask")
        action = str(body.get("action") or "ask")
        # 条目 42：可选 model 字段透传给 chat()（给了非空串就覆盖配置模型）。
        model = str(body.get("model") or "").strip()
        # effort（思考等级）：缺省＝不给，后端按自己的默认走（口径不变）。
        effort = str(body.get("effort") or "").strip()
        result = chat(disk, messages, quote=quote, mode=mode, action=action,
                      model=model or None, effort=effort)
        result.update({"project": project_id, "disk": disk_id})
        # 降级也是 200：前端要拿 reply 渲染，并靠 fallback 分辨真假。
        return self._json(result, code=200)

    def _ai_models_get(self, query: str) -> None:
        """条目 42：`GET /api/ai/models?project=<id>&disk=<id>`。

        这个盘可选的模型清单（`workbench.toml` 的 `[ai].models`，
        缺省模型保证在列）＋ 缺省模型名。
        """
        from urllib.parse import parse_qs

        from .ai import ai_config, available_models, model_catalog

        params = parse_qs(query or "")
        project_id = (params.get("project") or [""])[0]
        disk_id = (params.get("disk") or [""])[0]
        disk = self.index.disk_path(project_id, disk_id)
        if disk is None:
            return self._error(404, "没有这个盘：%s/%s" % (project_id, disk_id))
        # catalog＝**两侧共用的模型档位声明**（id / kind / label / model /
        # efforts / defaultEffort）；models / model 是旧字段，一字不动。
        return self._json({"ok": True, "project": project_id, "disk": disk_id,
                           "models": available_models(disk),
                           "model": ai_config(disk)["model"],
                           "catalog": model_catalog(disk)})

    # ---- 段四：实验报告导入 ----

    def _reports_dir(self, project_id: str) -> Path:
        from .importer import reports_dir

        disk = self.index.project_disk_path(project_id)
        if disk is None:
            raise ConfigError("没有这个项目：%s" % project_id)
        return reports_dir(disk)

    def _reports_get(self, project_id: str, what: str, query: str = "") -> None:
        """`GET /api/project/<p>/reports`（卡）｜`…/reports/dir`（真实文件清单）
        ｜`…/reports/detail?name=`（一条导入记录的详情）。"""
        from .importer import (ImportError_, list_drafts, list_report_files,
                                read_draft)

        try:
            directory = self._reports_dir(project_id)
        except ConfigError as exc:
            return self._error(404, str(exc))
        if what == "dir":
            files = list_report_files(directory)
            return self._json({"ok": True, "project": project_id,
                               "dir": str(directory),
                               "exists": directory.is_dir(),
                               "count": len(files), "files": files})
        if what == "detail":
            from urllib.parse import parse_qs

            params = parse_qs(query or "")
            name = (params.get("name") or [""])[0]
            if not name:
                return self._error(400, "name 要给（导入记录名）")
            disk = self.index.project_disk_path(project_id)
            if disk is None:
                return self._error(404, "没有这个项目：%s" % project_id)
            try:
                data = read_draft(disk, name)
            except ImportError_ as exc:
                return self._error(400, str(exc))
            data.update({"project": project_id})
            return self._json(data)
        if what in ("", "list"):
            disk = self.index.project_disk_path(project_id)
            drafts = list_drafts(disk) if disk else []
            reports = []
            for item in drafts:
                reports.append({
                    "id": item["id"], "name": item["name"], "file": item["file"],
                    "time": item["time"], "bound": item.get("bound", 0),
                    "status": "pending_check", "status_label": "待核对",
                    "from": "import", "draft_path": item["draft_path"],
                })
            return self._json({"ok": True, "project": project_id,
                               "count": len(reports), "reports": reports})
        return self._error(404, "没有这个接口：%s" % what)

    def _reports_upload(self, project_id: str) -> None:
        """上传报告文件（multipart）→ 存进该项目的实验报告目录。"""
        from .importer import REPORT_SUFFIXES, sha256_of

        try:
            directory = self._reports_dir(project_id)
        except ConfigError as exc:
            return self._error(404, str(exc))
        raw = self._raw_body()
        filename, payload = _parse_multipart_file(self.headers.get("Content-Type") or "",
                                                   raw)
        if not filename:
            return self._error(400, "没有收到文件（multipart 字段名要是 file）")
        if Path(filename).suffix.lower() not in REPORT_SUFFIXES:
            return self._error(400, "只认 %s 文件" % " / ".join(REPORT_SUFFIXES))
        safe = Path(filename).name
        try:
            directory.mkdir(parents=True, exist_ok=True)
            target = directory / safe
            target.write_bytes(payload)
        except OSError as exc:
            return self._error(400, "存文件失败：%s" % exc)
        return self._json({"ok": True, "project": project_id,
                           "name": safe, "path": str(target),
                           "size": len(payload), "sha256": sha256_of(target)})

    def _reports_parse(self, project_id: str, body: dict) -> None:
        """解析报告 → 行 ＋ 坏行 ＋ 自动映射。"""
        from .importer import ImportError_, parse_report, sha256_of, suggest_mapping

        try:
            directory = self._reports_dir(project_id)
        except ConfigError as exc:
            return self._error(404, str(exc))
        name = str(body.get("name") or body.get("file") or "").strip()
        if not name:
            return self._error(400, "name 要给（报告目录下的文件名）")
        target = (directory / Path(name).name)
        try:
            target.resolve().relative_to(directory.resolve())
        except (OSError, ValueError):
            return self._error(400, "路径越界")
        try:
            parsed = parse_report(target)
        except ImportError_ as exc:
            return self._error(400, str(exc))
        return self._json({
            "ok": True, "project": project_id, "name": target.name,
            "path": str(target), "sha256": sha256_of(target),
            "rows": parsed["rows"], "failed": parsed["failed"],
            "suggested": suggest_mapping(parsed["rows"]),
        })

    def _reports_confirm(self, project_id: str, body: dict) -> None:
        """写草稿：`facts/draft/<报告名>.draft.toml`。绝不写活账本。"""
        from .importer import ImportError_, sha256_of, write_draft

        disk = self.index.project_disk_path(project_id)
        if disk is None:
            return self._error(404, "没有这个项目：%s" % project_id)
        directory = self._reports_dir(project_id)
        name = str(body.get("name") or body.get("file") or "").strip()
        if not name:
            return self._error(400, "name 要给")
        source = directory / Path(name).name
        rows = body.get("rows")
        if not isinstance(rows, list):
            return self._error(400, "rows 要给（数组）")
        mapping = body.get("mapping")
        mapping = mapping if isinstance(mapping, dict) else {}
        report_name = str(body.get("report_name") or "").strip() or source.name
        digest = sha256_of(source) if source.is_file() else ""
        try:
            result = write_draft(disk, report_name, rows, mapping=mapping,
                                 source_path=source, report_sha256=digest)
        except ImportError_ as exc:
            return self._error(400, str(exc))
        result.update({"project": project_id, "source": str(source),
                       "report_sha256": digest})
        return self._json(result)

    def _reports_delete(self, project_id: str, body: dict) -> None:
        """删一条导入记录（草稿）。源报告文件不动。"""
        from .importer import ImportError_, delete_draft

        disk = self.index.project_disk_path(project_id)
        if disk is None:
            return self._error(404, "没有这个项目：%s" % project_id)
        name = str(body.get("name") or body.get("id") or "").strip()
        if not name:
            return self._error(400, "name 要给")
        try:
            result = delete_draft(disk, name)
        except ImportError_ as exc:
            return self._error(404, str(exc))
        result.update({"project": project_id})
        return self._json(result)

    # ---- 段六：知识库 ----

    def _knowledge_disk(self, project_id: str) -> Path:
        disk = self.index.project_disk_path(project_id)
        if disk is None:
            raise ConfigError("没有这个项目：%s" % project_id)
        return disk

    def _knowledge_get(self, project_id: str, what: str, query: str) -> None:
        """`GET /api/project/<p>/knowledge`（清单）｜`…/knowledge/preview`（预览）。"""
        from .knowledge import (KnowledgeError, knowledge_dir, list_files,
                                preview)

        try:
            disk = self._knowledge_disk(project_id)
        except ConfigError as exc:
            return self._error(404, str(exc))
        if what in ("", "list"):
            try:
                folder = str(knowledge_dir(disk))
            except KnowledgeError as exc:
                return self._error(400, str(exc))
            files = list_files(disk)
            return self._json({"ok": True, "project": project_id,
                               "dir": folder, "count": len(files),
                               "files": files})
        if what == "preview":
            from urllib.parse import parse_qs

            params = parse_qs(query or "")
            rel = (params.get("path") or [""])[0]
            if not rel:
                return self._error(400, "path 要给（项目目录里的相对路径）")
            try:
                data = preview(disk, rel)
            except KnowledgeError as exc:
                return self._error(400, str(exc))
            data.update({"project": project_id})
            return self._json(data)
        return self._error(404, "没有这个接口：%s" % what)

    def _knowledge_delete(self, project_id: str, body: dict) -> None:
        """删一个知识库目录里的文件（写闸：只许 knowledge/ 内的）。"""
        from .knowledge import KnowledgeError, delete_file

        try:
            disk = self._knowledge_disk(project_id)
        except ConfigError as exc:
            return self._error(404, str(exc))
        rel = str(body.get("path") or "").strip()
        if not rel:
            return self._error(400, "path 要给（知识库目录里的相对路径）")
        try:
            result = delete_file(disk, rel)
        except KnowledgeError as exc:
            return self._error(400, str(exc))
        result.update({"project": project_id})
        return self._json(result)

    def _knowledge_upload(self, project_id: str) -> None:
        """上传文件进知识库目录（multipart）。"""
        from .knowledge import KnowledgeError, save_upload

        try:
            disk = self._knowledge_disk(project_id)
        except ConfigError as exc:
            return self._error(404, str(exc))
        raw = self._raw_body()
        filename, payload = _parse_multipart_file(self.headers.get("Content-Type") or "",
                                                   raw)
        if not filename:
            return self._error(400, "没有收到文件（multipart 字段名要是 file）")
        try:
            result = save_upload(disk, filename, payload)
        except KnowledgeError as exc:
            return self._error(400, str(exc))
        result.update({"project": project_id})
        return self._json(result)

    # ---- 段六：版式 ----

    def _venue_get(self, project_id: str) -> None:
        """版式配置（刊物 / 截稿 / 语言锁定 / 模板库）。"""
        from .venue import venue_payload

        try:
            disk = self._knowledge_disk(project_id)
        except ConfigError as exc:
            return self._error(404, str(exc))
        lang = self.index.disk_lang(project_id, disk.name)
        payload = venue_payload(disk, lang=lang)
        payload.update({"project": project_id})
        return self._json(payload)

    def _venue_save(self, project_id: str, body: dict) -> None:
        """存版式配置（落进项目级 `workbench.toml` 的 `[venue]` 表）。"""
        from .venue import VenueError, save_venue

        try:
            disk = self._knowledge_disk(project_id)
        except ConfigError as exc:
            return self._error(404, str(exc))
        lang = self.index.disk_lang(project_id, disk.name)
        try:
            result = save_venue(disk,
                                venue=str(body.get("venue") or ""),
                                deadline=str(body.get("deadline") or ""),
                                lang=lang)
        except VenueError as exc:
            return self._error(400, str(exc))
        except (OSError, ValueError) as exc:
            return self._error(400, "写配置失败：%s" % exc)
        result.update({"project": project_id})
        return self._json(result)

    # ---- 原始请求体 ----

    def _raw_body(self) -> bytes:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            length = 0
        return self.rfile.read(length) if length > 0 else b""

    def _body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            length = 0
        raw = self.rfile.read(length) if length > 0 else b""
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}
        return data if isinstance(data, dict) else {}

    do_PUT = do_POST
    do_DELETE = do_POST
    do_PATCH = do_POST

    # ---- 静态文件 ----

    def _static(self, name: str) -> None:
        target = (STATIC_DIR / name).resolve()
        try:
            target.relative_to(STATIC_DIR)
        except ValueError:
            return self._error(403, "路径越界")
        if not target.is_file():
            return self._error(404, "没有这个文件：%s" % name)
        try:
            body = target.read_bytes()
        except OSError:
            return self._error(404, "读不到文件：%s" % name)
        ctype = STATIC_TYPES.get(target.suffix.lower(), "application/octet-stream")
        self._send(200, body, ctype)


def create_server(root: str | Path, host: str = "127.0.0.1", port: int = 0,
                  max_depth: int = MAX_DEPTH, ttl: float = 2.0,
                  verbose: bool = False, state_dir: str = ""):
    """起服务；返回 (server, index)。server.server_address 有真实端口。"""
    index = ProjectIndex(root, max_depth=max_depth, ttl=ttl, state_dir=state_dir)

    class Handler(WorkbenchHandler):
        pass

    Handler.index = index
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.verbose = verbose  # type: ignore[attr-defined]
    return server, index
