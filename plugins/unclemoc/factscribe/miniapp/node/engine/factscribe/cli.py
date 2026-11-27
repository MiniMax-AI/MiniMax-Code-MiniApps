# -*- coding: utf-8 -*-
"""argparse、子命令实现、退出码与 python -m factscribe 入口。"""
from __future__ import annotations

import argparse
import hashlib
import webbrowser
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from . import figures
from . import bundle
from . import mirror
from . import mdscan
from . import refs
from . import textreuse
from .audit import _aggregate_exit, run_audit, run_check, source_base
from .checks import aggregate_exit as checks_aggregate_exit
from .checks import run_packages
from .brief import build_brief
from .brief import payload as brief_payload
from .brief import render as render_brief
from .buildpdf import _is_font_error, auto_build
from .config import (Config, ConfigError, load_config, load_facts,
                     load_sections)
from .console import safe_stdio
from .safepath import WriteRefused, guard_facts_write, guard_project_write
from .constants import (EXIT_CONFIG, EXIT_INTERNAL, EXIT_OK, EXIT_RED,
                        EXIT_YELLOW, VERSION)
from .doctor import collect as collect_doctor
from .doctor import render_human as render_doctor
from .evidence import (freeze_evidence, render_toml, suggest_evidence,
                       suggest_summary, unfreeze_evidence)
from .fonts import FontCacheError, fetch as fetch_fandol, font_status
from .fonts import render_fetch as render_fonts_fetch
from .fonts import render_status as render_fonts_status
from .i18n import issue_dict, style_finding_dict
from .pdfgate import verify_pdf
from .polish import (build_plan, plan_payload, playbook_text, render_plan)
from .prescribe import (NOTE, load_prescriptions, prescriptions_for,
                        priority_payload, render_bundle, resolve_conflicts)
from .protect import compare as compare_protect
from .protect import render_human as render_protect
from .report import (PREAMBLE_TEXT, ReportError, _artifact_path, _config_block,
                     _emit, _human_audit, _human_audit_domains, _human_check,
                     _payload,
                     _rel_posix, _resolve_in_ws, _severity_of, _sha256_of,
                     _toml_str, _ws_root, _write_atomic, check_report,
                     evidence_digest, load_report, lock_report, report_card,
                     semantic_digest, sign_report, verify_signoff,
                     render_matrix)
from .review import payload as review_payload
from .review import render_human as render_review
from .review import run_review
from .safepath import (WriteRefused, guard_facts_write,
                       guard_project_write)
from .scaffold import add_fact, init_project
from .serve import LOOPBACK_HOSTS, create_server
from .style import (DISCLAIMER, STAGE_DRAFT, STAGE_VALUES, analyze,
                    build_prompt, filter_new_findings,
                    load_style_rules_info, project_rule_report, render_human)
from .term_suggest import (add_from_tsv, json_payload, render_tsv,
                           suggest)
from .tide import DEFAULT_SNAPSHOT_ROOT
from .tide import render_human as render_tide
from .textio import read_text_exact, to_lf
from .tide import render_restore as render_tide_restore
from .tide import render_snapshot as render_tide_snapshot
from .tide import restore_snapshot, run_tide, save_snapshot

# --------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------

def run_build(cfg: Config) -> tuple[int, str]:
    if not cfg.build.strip():
        return EXIT_OK, "project.build 为空，按契约跳过编译"
    try:
        proc = subprocess.run(cfg.build, shell=True, cwd=str(cfg.root),
                              capture_output=True, text=True, timeout=600)
    except subprocess.TimeoutExpired:
        return EXIT_RED, "$ %s\n构建超时（600 秒）被终止" % cfg.build
    out = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        return EXIT_RED, "$ %s\n%s\n构建失败：退出码 %d" % (cfg.build, out.rstrip(), proc.returncode)
    return EXIT_OK, "$ %s\n%s\n构建成功：退出码 0" % (cfg.build, out.rstrip())


def run_build_step(cfg: Config, engine: str = "tectonic",
                   cjk_font: str | None = None,
                   keep_temp: bool = False,
                   font_fallback: bool = False) -> tuple[int, str, dict]:
    """批 122：build 子命令与 audit/verify-pdf --build 共用同一条编译路。

    ``font_fallback`` 只在闸门（audit/verify-pdf --build）打开：``project.build``
    非空时仍按原样跑 shell，但若它败在字体上（批 120 §3.2 的特征），就复用
    自动路径的临时副本 CJK 兜底重试——项目里的 ``.tex`` 仍不改。
    """
    if cfg.build.strip():
        code, out = run_build(cfg)
        if code != EXIT_OK and font_fallback and _is_font_error(out):
            return auto_build(cfg.root, output=cfg.output, engine=engine,
                              cjk_font=cjk_font, keep_temp=keep_temp,
                              root_tex=cfg.root_tex or "main.tex")
        return code, out, {}
    return auto_build(cfg.root, output=cfg.output, engine=engine,
                      cjk_font=cjk_font, keep_temp=keep_temp,
                      root_tex=cfg.root_tex or "main.tex")


def _build_block(cfg: Config, code: int, info: dict,
                 ran: bool = True) -> dict:
    """--json 的 build 字段：ran/ok/pdf_bytes（pdf_bytes 只在成功时非零）。"""
    ok = code == EXIT_OK
    size = 0
    if ok:
        size = int(info.get("pdf_bytes") or 0)
        if size == 0:
            pdf = cfg.root / cfg.output
            if pdf.is_file():
                size = pdf.stat().st_size
    return {"ran": ran, "ok": ok, "pdf_bytes": size}


def _exit_code(red: int, yellow: int, strict: bool = False) -> int:
    if red:
        return EXIT_RED
    if yellow:
        return EXIT_RED if strict else EXIT_YELLOW
    return EXIT_OK

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="factscribe",
        description="论文数字与引用的机械闸门（doctor / check / audit / style / protect / review …）")
    p.add_argument("--version", action="version", version="factscribe %s" % VERSION)
    sub = p.add_subparsers(dest="command", required=True)

    sp = sub.add_parser(
        "init",
        help="上手第一步：生成最小可用项目骨架（7 个文件，确定性别名）",
        description="生成最小可用项目骨架：factscribe.toml / main.tex / "
                    "sections/01-intro.tex / facts/01-core.toml / "
                    "results/MANIFEST.toml / refs.bib / README.md。"
                    "不写时间戳、不写绝对路径（同参数两次生成逐字节一致）；"
                    "目标目录非空拒绝，除非 --force。")
    sp.add_argument("directory", help="目标目录（不存在则创建）")
    sp.add_argument("--title", default=None, help="论文标题（缺省为按语言的占位标题）")
    sp.add_argument("--author", default=None, help="作者（写进 project.authors）")
    sp.add_argument("--lang", choices=("zh", "en"), default="zh",
                    help="模板语言（默认 zh）")
    sp.add_argument("--force", action="store_true",
                    help="目标目录非空也写：覆盖本命令的 7 个同名文件，其他文件不动")
    sp.add_argument("--json", action="store_true", help="机器可读输出（stdout 只出 JSON）")

    sp = sub.add_parser(
        "doctor",
        help="上手第一步：环境与项目自检（缺什么、怎么修；不判定、不产生分数）",
        description="检查跑 audit 之前需要的东西：Python 版本、tectonic、"
                    "poppler、中文字体、git，以及项目声明、章节、事实账、"
                    "人签清单、证据冻结。每项给一句人话和一条修复命令；"
                    "本命令不是闸门，退出码恒为 0（用法错仍为 2）。")
    sp.add_argument("project", nargs="?", default=".",
                    help="项目目录（默认当前目录）")
    sp.add_argument("--json", action="store_true", help="机器可读输出（stdout 只出 JSON）")

    sp = sub.add_parser(
        "serve",
        help="本地工作台 HTTP API：只绑回环，默认随机 token；只读不落盘",
        description="把 config / facts / brief / audit 暴露成本机 HTTP，"
                    "供 Mini FactScribe、本地页面或外部 agent 调用。"
                    "只绑 127.0.0.1 / localhost；每次启动生成随机 Bearer token；"
                    "serve 本身不写项目、不改退出码，audit 的判定仍在 payload.exit。")
    sp.add_argument("project", nargs="?", default=None,
                    help="项目目录（省略＝只起服务，在页面里从项目列表选）")
    sp.add_argument("--host", default="127.0.0.1",
                    choices=sorted(LOOPBACK_HOSTS),
                    help="监听地址（只允许回环；默认 127.0.0.1）")
    sp.add_argument("--port", type=int, default=0,
                    help="端口（默认 0＝让系统分配，启动时打印实际端口）")
    sp.add_argument("--token", default=None,
                    help="固定 token（默认每次随机生成；空串视为未给）")
    sp.add_argument("--allow-write", dest="allow_write", action="store_true",
                    help="打开写接口（PUT /api/sections、POST /api/facts）；"
                         "默认只读")
    sp.add_argument("--allow-build", dest="allow_build", action="store_true",
                    help="允许 POST /api/build 编译 PDF；会执行 project.build")
    sp.add_argument("--ui", action="store_true",
                    help="同时在这个端口提供页面（GET /）：旧节级网页前端已按第 ④ 步"
                         "废弃，这条闸留给集成件自带的页面（如 legal 集成件）；"
                         "产品前端是段落级工作台 factscribe workbench")
    sp.add_argument("--dev", action="store_true",
                    help="开发模式：页面把 MiniApp 专属区（AI、启动）也显示出来，只做界面预览")
    sp.add_argument("--no-token", dest="no_token", action="store_true",
                    help="不要求 token（只靠同源检查：带 Origin 的请求必须是本监听"
                         "地址，否则 403 CROSS_ORIGIN；不带 Origin 的请求一律放行"
                         "——命令行与 MiniApp 代理走这条；个人机器可用）")
    sp.add_argument("--no-open", dest="no_open", action="store_true",
                    help="网页模式不自动打开浏览器")
    sp.add_argument("--json", action="store_true",
                    help="启动行只出 JSON（服务仍阻塞，直到 Ctrl+C）")

    sp = sub.add_parser(
        "workbench",
        help="工作台网页：扫根目录聚合论文项目，起本地服务",
        description="在 --root 下面（深度受限）找出所有含 factscribe.toml 的目录，"
                    "把同根名的两语言盘（paper 与 paper-zh）聚合成一个项目，"
                    "起一个只绑回环的本地服务：项目列表、章节渲染、状态行都是真数据。"
                    "段二起带写接口：正文写回、章节调序/删除/新建、项目新建/编辑。")
    sp.add_argument("--root", default=".",
                    help="扫描根目录（默认当前目录；深度受限，找 factscribe.toml）")
    sp.add_argument("--host", default="127.0.0.1",
                    choices=sorted(LOOPBACK_HOSTS),
                    help="监听地址（只允许回环；默认 127.0.0.1）")
    sp.add_argument("--port", type=int, default=0,
                    help="端口（默认 0＝让系统分配，启动时打印实际端口）")
    sp.add_argument("--max-depth", type=int, default=3,
                    help="扫描深度（默认 3；只数目录层数）")
    sp.add_argument("--no-browser", dest="no_browser", action="store_true",
                    help="不自动打开浏览器")
    sp.add_argument("--json", action="store_true", help="启动行只出 JSON（服务仍阻塞）")
    sp.add_argument("--state-dir", default="",
                    help="提议单落盘目录（v2；缺省 ~/.factscribe/state，"
                         "MiniApp 侧由宿主指定 dataDir）")
    sp_subs = sp.add_subparsers(dest="workbench_action")

    sp_new = sp_subs.add_parser(
        "new", help="新建论文项目：在 --root 下落目录骨架",
        description="在 --root 下建论文项目目录：factscribe.toml（最小合法内容"
                    "＋[workbench] 表）、sections/、facts/、README.md、main.tex；"
                    "语言盘按 --lang 建（both＝英文盘＋中文盘各一个目录）。")
    sp_new.add_argument("--root", default=".",
                        help="落盘根目录（默认当前目录）")
    sp_new.add_argument("--title", default="", help="论文标题")
    sp_new.add_argument("--slug", default="",
                        help="目录名（默认按标题生成；只允许字母数字点下划线连字符）")
    sp_new.add_argument("--lang", default="en",
                        choices=["en", "zh", "both"],
                        help="写作语言：en / zh / both（默认 en）")
    sp_new.add_argument("--project-dir", dest="project_dir", default="",
                        help="项目目录字段（写进 [workbench].project_dir）")
    sp_new.add_argument("--reports-dir", dest="reports_dir", default="",
                        help="实验报告目录字段（默认〈项目目录〉/reports）")
    sp_new.add_argument("--json", action="store_true", help="只出 JSON")

    sp = sub.add_parser(
        "mcp",
        help="MCP stdio 服务器：把 status/project/brief/audit（可选写）暴露给 agent",
        description="以 MCP stdio 协议暴露本地工作台：status / project / brief / audit；"
                    "加 --allow-write 才多出 write_section / add_fact。"
                    "stdout 只走 JSON-RPC，诊断走 stderr；由 Claude Code / Codex / "
                    "OpenCode 等作为子进程启动。")
    sp.add_argument("project", nargs="?", default=".",
                    help="项目目录（默认当前目录）")
    sp.add_argument("--allow-write", dest="allow_write", action="store_true",
                    help="开放 write_section / add_fact（默认只读）")

    for name, help_text in (
        ("check", "校验事实账：id/sha256/人签清单/expr 算术/冲突"),
        ("audit", "核心：内联绑定 + 数字回账 + 引用落稳定标识 + 覆盖报告"),
        ("matrix", "生成 audit/matrix.md 追溯矩阵"),
        ("build", "执行 project.build；为空时用 tectonic 自动编译 main.tex"),
        ("preamble", "生成 audit/preamble.tex（\\fact / \\fsignore 宏定义）"),
    ):
        sp = sub.add_parser(name, help=help_text)
        sp.add_argument("project", nargs="?", default=".", help="项目目录（默认当前目录）")
        sp.add_argument("--json", action="store_true", help="机器可读输出（stdout 只出 JSON）")
        if name in ("check", "audit"):
            sp.add_argument("--strict", action="store_true",
                            help="黄也当红（CI 用：未核验不许过）")
        if name == "audit":
            sp.add_argument("--lang", choices=("zh", "en"), default=None,
                            help="findings 文案语言（只影响 --json 的输出；"
                                 "不给＝中文原话，一字不动）")
            sp.add_argument("--resolve", action="store_true",
                            help="联网核验 arXiv/DOI（超时 5 秒；失败标 unverified 黄）")
            sp.add_argument("--build", action="store_true",
                            help="审计前先编 PDF（project.build 非空跑它；空则用 tectonic 自动编）")
        if name == "matrix":
            sp.add_argument("--out", default=None, help="默认 audit/matrix.md")
        if name == "preamble":
            sp.add_argument("--out", default=None, help="默认 audit/preamble.tex")
        if name == "build":
            sp.add_argument("--engine", default="tectonic",
                            help="自动编译用的引擎（默认 tectonic；可给绝对路径）")
            sp.add_argument("--cjk-font", default=None, metavar="PATH",
                            help="中文字体文件（缺省用 fc-match 找 STHeiti）")
            sp.add_argument("--keep-temp", action="store_true",
                            help="保留临时副本并打印路径（默认清理）")
    sp = sub.add_parser(
        "mirror-check",
        help="双语双盘账本逐条比对（facts 承重字段＋bib 条目级）",
        description="比对两个论文盘（如 paper-b 与 paper-b-zh）的账本："
                    "facts/*.toml 逐 id 比对承重字段（claim/value/display/source/"
                    "source_sha256/locator/expr/derived_from/kind），"
                    "refs.bib 条目级比对（title/author/year/doi/arXiv id）。"
                    "豁免面不判漂：sections/ 正文、main.tex 导言区、GLOSSARY.md、"
                    "生成物、以及 fact 的 confidence（人签置信升级）与 note。"
                    "只读：不写盘、不自动同步。退出码 0＝零漂移、1＝漂移红"
                    "（逐条列盘/文件/id/字段/两侧值）、2＝用法或结构错。")
    sp.add_argument("disk_a", metavar="盘A", help="第一个论文盘（项目目录）")
    sp.add_argument("disk_b", metavar="盘B", help="第二个论文盘（项目目录）")
    sp.add_argument("--json", action="store_true",
                    help="机器可读输出（stdout 只出 JSON）")
    sp = sub.add_parser(
        "refs",
        help="文献登记面：跨条目查重 / 待补登记 / 联网检索候选（CARD-G1）",
        description="文献登记命令组。三个动作："
                    "refs dedupe 查 bib 跨条目同 DOI／同 arXiv id；"
                    "refs register 核对待补登记表 refs/todo.toml；"
                    "refs search 联网取候选题录（唯一联网面）。"
                    "零 LLM、零第三方依赖；除 refs search 外全部零网络；"
                    "检索结果只是候选，入正式 refs.bib 必须人采，机器不代签。")
    rp = sp.add_subparsers(dest="refs_action", required=True)
    rd = rp.add_parser(
        "dedupe",
        help="bib 跨条目查重：同 DOI / 同 arXiv id 即报 REF_DUP_ID",
        description="解析 bib 全集，按 DOI / arXiv id 归一化后跨条目比对；"
                    "同标识即报 REF_DUP_ID（黄级），JSON 给出冲突 key 对与"
                    "文件行号。唯一键缺失（无 DOI 无 arXiv id）的条目只列清单，"
                    "不判红。退出码 0＝零重复、3＝黄（有重复）、2＝结构错。")
    rd.add_argument("project", nargs="?", default=".", help="项目目录（默认当前目录）")
    rd.add_argument("--json", action="store_true",
                    help="机器可读输出（stdout 只出 JSON）")
    rr = rp.add_parser(
        "register",
        help="核对待补文献登记表 refs/todo.toml（人填机器收）",
        description="读可选登记表 refs/todo.toml，逐条核对必填字段"
                    "（slug/title/authors/year/venue_or_id/planned_key/section）"
                    "齐不齐、planned_key 撞不撞既有 bib key、落点节在不在；"
                    "缺项逐项点名。退出码 0＝逐条齐、1＝红（缺字段／撞 key／"
                    "落点节缺）、2＝没有登记表或表坏。")
    rr.add_argument("project", nargs="?", default=".", help="项目目录（默认当前目录）")
    rr.add_argument("--pick", type=int, default=None, metavar="候选号",
                    help="从最近一次检索的候选里挑一条写进登记表（仍非正式 bib）")
    rr.add_argument("--key", default=None, metavar="KEY",
                    help="配合 --pick：人给的 planned_key（机器不编 key）")
    rr.add_argument("--section", default=None, metavar="节",
                    help="配合 --pick：人给的落点节（如 02_related.tex）")
    rr.add_argument("--json", action="store_true",
                    help="机器可读输出（stdout 只出 JSON）")
    rs = rp.add_parser(
        "search",
        help="联网检索候选元数据（只发查询词；唯一联网面）",
        description="按查询词去 Crossref / arXiv 取候选题录（题录/作者/年份/"
                    "DOI 或 arXiv id），原始响应落 refs/candidates/ 并钉 sha256，"
                    "编号列给人挑。候选与既有 bib/todo 按 DOI/id 查重并标注，"
                    "重复的不给采纳号。--pick 把挑中的候选写进登记表——"
                    "仍非正式 refs.bib，入正式 bib 必须人采。退出码 0＝候选已落盘、"
                    "2＝网络失败（超时／无网／HTTP 错各有各的信息）。")
    rs.add_argument("query", help="查询词（只发这个词，不发正文与本地路径）")
    rs.add_argument("--project", default=".", help="项目目录（默认当前目录）")
    rs.add_argument("--source", choices=("crossref", "arxiv"), default="crossref",
                    help="检索源（默认 crossref）")
    rs.add_argument("--pick", type=int, default=None, metavar="候选号",
                    help="顺手把这条候选写进 refs/todo.toml（仍非正式 bib）")
    rs.add_argument("--key", default=None, metavar="KEY",
                    help="配合 --pick：人给的 planned_key（机器不编 key）")
    rs.add_argument("--section", default=None, metavar="节",
                    help="配合 --pick：人给的落点节（如 02_related.tex）")
    rs.add_argument("--json", action="store_true",
                    help="机器可读输出（stdout 只出 JSON）")
    sp = sub.add_parser(
        "figures",
        help="画图管线：账本驱动的图表生成与四面对账（CARD-G2）",
        description="画图管线（零 LLM、零网络、纯标准库）。人填图规格 "
                    "figures/*.fig.toml：图型（bar/line/table）、轴标签、caption，"
                    "数据点只许引 fact id；规格里出现裸数字即配置错（退出码 2）。"
                    "figures gen 读规格＋事实账，机械产出 pgfplots 的 .tex、"
                    "随图数据 .csv 与绑定表 .bind.toml（每个数据点记 fact_id、"
                    "生成时的值与 source_sha256），覆盖旧产物前先打印绑定表差异；"
                    "figures check 四面比对（规格↔绑定表↔随图 CSV↔现行账本），"
                    "账动过而图未重生成必红（逐点点名）。"
                    "退出码 0＝绿、1＝红、2＝规格/用法错；无图规格时 skip（0）。")
    fsp = sp.add_subparsers(dest="figures_action", required=True)
    fg = fsp.add_parser(
        "gen",
        help="按人填规格生成图（.tex ＋ 随图 .csv ＋ 绑定表）",
        description="读 figures/*.fig.toml ＋ facts/*.toml，机械产出三件套："
                    "figures/gen/<名>.tex（pgfplots 代码，可独立编译出 PDF）、"
                    "figures/gen/<名>.csv（随图数据，既有 FIGURE_UNVERIFIED 的对账物）、"
                    "figures/gen/<名>.bind.toml（绑定表：每个数据点 ↔ fact id ↔ "
                    "生成时的值与 source_sha256），另有项目级 figures/bind.toml。"
                    "数据点只许引 fact id；裸数字／未知图型／缺数据点一律退出码 2。")
    fg.add_argument("project", nargs="?", default=".", help="项目目录（默认当前目录）")
    fg.add_argument("--json", action="store_true",
                    help="机器可读输出（stdout 只出 JSON）")
    fc = fsp.add_parser(
        "check",
        help="四面比对：规格 ↔ 绑定表 ↔ 随图 CSV ↔ 现行账本",
        description="逐点比对四个面：人填规格、绑定表、随图 .csv、现行事实账。"
                    "数据点数不等、值不等、source_sha256 不等、账上 fact 不见了，"
                    "都逐点点名并退出码 1；规格本身坏掉退出码 2；全一致退出码 0。")
    fc.add_argument("project", nargs="?", default=".", help="项目目录（默认当前目录）")
    fc.add_argument("--json", action="store_true",
                    help="机器可读输出（stdout 只出 JSON）")
    sp = sub.add_parser(
        "bundle",
        help="投稿工件包：闭包收集 → 清单门 → 打包 + MANIFEST（CARD-G4）",
        description="投稿工件包（零 LLM、零网络、纯标准库）。三步："
                    "①收集——main.tex 起的 \\input/\\include 闭包（复用既有闭包"
                    "算法）＋refs.bib＋figures/＋tables/＋facts/＋runs/ 的已签收"
                    "副本＋audit/ 三件；②清单门——逐项机械判（闭包完整／每图有"
                    "随图 CSV／bib 无缺唯一键条目／evidence.lock 在场且未过期／"
                    "audit 现跑无红），任一项不过即退出码 1 并逐项列出"
                    "（过／不过／豁免三态），不静默放行；③导出——包目录＋"
                    "MANIFEST.sha256（逐文件 sha256 行，收包方 shasum -c 可验）"
                    "＋BUNDLE-MANIFEST.json（清单：收了哪些、哪些只记不收）。"
                    "期刊差异走项目侧 bundle-checklist.toml（附加检查项＋排除项），"
                    "工具代码里零期刊专名。--verify 不打包，只复算包目录的 MANIFEST。")
    sp.add_argument("project", nargs="?", default=".",
                    help="项目目录（默认当前目录）")
    sp.add_argument("--verify", metavar="BUNDLE_DIR", default=None,
                    help="不打包：复算包目录的 MANIFEST.sha256（逐行复算＋件数对表）")
    sp.add_argument("--out", default=None, metavar="DIR",
                    help="包目录（默认 <项目>.bundle，放在项目外面——"
                         "包留在项目里会让审计的覆盖报告把包的 .tex 副本当成闭包外文件）")
    sp.add_argument("--runs-mode", choices=("signed", "full"), default="signed",
                    help="runs/ 收哪些：signed＝只收已签收副本（默认，组内有 "
                         "*.signoff.toml）；full＝全收")
    sp.add_argument("--json", action="store_true",
                    help="机器可读输出（stdout 只出 JSON）")
    sp = sub.add_parser(
        "textreuse",
        help="双目录字面重合检测：查重的字面层 MVP（CARD-G6）",
        description="双目录字面重合检测（零 LLM、零网络、纯标准库）。"
                    "递归收 .tex/.md/.txt（--ext 可扩），归一（空白折叠、"
                    "LaTeX 注释行默认去、LaTeX 命令去、大小写折叠），"
                    "词级 n-gram 镶嵌（默认多尺度 n=8/5，--n 走单窗模式，"
                    "--scales 自定义尺度集），"
                    "跨两侧找重合段（相邻命中聚成段，跨尺度取并集区间），"
                    "逐段给两侧「文件:行-行」与重合词数，并汇总各文件对的重合词数"
                    "与 A 侧占比。另有句级包含层（默认开，--no-sentences 关）："
                    "分句后按词集重合率判近字面机械重合，"
                    "报告与 JSON 每段带匹配来源（word-window／sentence-containment）。"
                    "零配置：裸目录也能跑，不读项目声明。"
                    "能力边界：本卡只查字面层（逐字照搬与近字面机械重合），"
                    "改写／洗稿／AI 拼装属语义层，本卡不覆盖——"
                    "漏检属语义层，本卡不覆盖。"
                    "退出码 0＝无超阈重合、1＝发现重合（逐段列）、"
                    "2＝用法错（目录不存在、n 越界、两侧同一目录）。")
    sp.add_argument("dir_a", metavar="目录A", help="第一个目录（比较侧）")
    sp.add_argument("dir_b", metavar="目录B", help="第二个目录（比较侧）")
    sp.add_argument("--n", type=int, default=None, metavar="N",
                    help="n-gram 长度（5–20）——给了就是**单窗模式**；"
                         "不给＝多尺度默认 8/5")
    sp.add_argument("--scales", action="append", default=None, metavar="N,N",
                    help="词窗尺度集（可重复／逗号分隔，如 --scales 30,15,8,5；"
                         "默认 8,5；给了 --n 则本项忽略）")
    sp.add_argument("--ext", action="append", default=None, metavar="EXT",
                    help="扩收的文件类型（可重复；如 --ext .rst）")
    sp.add_argument("--min-tokens", type=int, default=8, metavar="N",
                    help="小段过滤阈值：重合词数少于它不报（默认 8）")
    sp.add_argument("--sentences", action=argparse.BooleanOptionalAction,
                    default=True,
                    help="句级包含层（默认开；--no-sentences 关）")
    sp.add_argument("--sentence-threshold", type=float, default=0.7, metavar="T",
                    help="句级包含的词集重合率阈值（0, 1]，默认 0.7")
    sp.add_argument("--sentence-min-words", type=int, default=16, metavar="N",
                    help="句级包含的最少共享词数（防短句整句撞车型误报，默认 16）")
    sp.add_argument("--sentence-anchor-n", type=int, default=5, metavar="N",
                    help="句级粗筛的锚点词窗长度（默认 5；调小＝候选更全、更慢）")
    sp.add_argument("--strip-comments", action=argparse.BooleanOptionalAction,
                    default=True,
                    help="去 LaTeX 注释行（默认开；--no-strip-comments 保留）")
    sp.add_argument("--json", action="store_true",
                    help="机器可读输出（stdout 只出 JSON）")
    sp = sub.add_parser(
        "fact", help="事实账：只追加（fact add 自动算 sha256，不代签）",
        description="事实账命令组。fact add 校验 id 与 source，自动把 sha256 写进 "
                    "source_sha256，再往目标账本（--ledger，缺省 facts/01-core.toml）"
                    "末尾追加一条 [[fact]]；它只提醒人把对应行抄进人签清单，绝不替你签。")
    fp = sp.add_subparsers(dest="fact_action", required=True)
    fa = fp.add_parser("add", help="追加一条 fact：自动算 sha256，不代签")
    fa.add_argument("project", nargs="?", default=".",
                    help="项目目录（默认当前目录）")
    fa.add_argument("--id", required=True, metavar="ID",
                    help="账本键（字母开头；不许与账上现有 id 重复）")
    fa.add_argument("--claim", required=True, metavar="TEXT",
                    help="一句话主张（人话）")
    fa.add_argument("--value", required=True, metavar="VALUE",
                    help="正文要绑的数字原文（例 10/16、56.25%%、42）")
    fa.add_argument("--source", required=True, metavar="FILE",
                    help="项目内原始产物路径（v1：results/ 下）")
    fa.add_argument("--locator", default="", metavar="TEXT",
                    help="数字在 source 里的位置（强烈建议填，例 §二 汇总表）")
    fa.add_argument("--confidence", default="med",
                    choices=("high", "med", "low"),
                    help="置信度（默认 med）")
    fa.add_argument("--expr", default=None, metavar="EXPR",
                    help="推算式（--derived-from 必配）")
    fa.add_argument("--derived-from", dest="derived_from", default=None,
                    metavar="IDS", help="父 fact id，逗号分隔（例 A1,A3）")
    fa.add_argument("--note", default=None, metavar="TEXT", help="备注（可选）")
    fa.add_argument("--ledger", default=None, metavar="FILE",
                    help="目标账本文件（相对项目根；必须仍在 facts 的 glob 里，"
                         "新建文件要沿用本盘既有命名风格；缺省＝默认那本账）")
    fa.add_argument("--json", action="store_true",
                    help="机器可读输出（stdout 只出 JSON）")

    fi = fp.add_parser("import", help="把已签收的报告导进事实账（带签收门）")
    fi.add_argument("ws", help="工作区根（报告与原始产物所在处）")
    fi.add_argument("--report", required=True, metavar="PATH",
                    help="报告路径（相对工作区或绝对）")
    fi.add_argument("--paper", default=None, metavar="DIR",
                    help="论文项目目录（缺省 <ws>/paper）")
    fi.add_argument("--dry-run", dest="dry_run", action="store_true",
                    help="只检查与生成，不写盘")
    fi.add_argument("--json", action="store_true",
                    help="机器可读输出（stdout 末行是单行 JSON）")

    sp = sub.add_parser(
        "report", help="报告域：check / lock / sign（归一化实验报告 factscribe/report@1）",
        description="报告域命令组。report check 只读地跑一遍探针并比对；"
                    "report lock 写锁文件（0600，原子写）；report sign 出审阅卡并"
                    "写签收文件与哈希链流水。退出码只用 0/1/2。")
    rp = sp.add_subparsers(dest="report_action", required=True)
    for action, help_text in (
        ("check", "校验报告：探针取数与报告写的对不对得上"),
        ("lock", "check 过关后写锁文件（<report_id>.lock.json）"),
        ("sign", "出审阅卡并签收（<report_id>.signoff.toml + 流水）"),
    ):
        rq = rp.add_parser(action, help=help_text)
        rq.add_argument("ws", help="工作区根（报告与原始产物所在处）")
        rq.add_argument("--report", required=True, metavar="PATH",
                        help="报告路径（相对工作区或绝对）")
        rq.add_argument("--json", action="store_true",
                        help="机器可读输出（stdout 末行是单行 JSON）")
        if action == "sign":
            rq.add_argument("--by", default="", metavar="NAME",
                            help="签收人（必填，空串当用法错）")
            rq.add_argument("--card-out", dest="card_out", default=None,
                            metavar="PATH",
                            help="把审阅卡另存到工作区内的这个路径（不许越界）")

    sp = sub.add_parser("verify-pdf", help="PDF 回检：文本层/栅格/双向多重集/stamp（V3.0）")
    sp.add_argument("pdf", help="最终 PDF 路径")
    sp.add_argument("--report", required=True, help="audit/report.json（被签的那一份）")
    sp.add_argument("--stamp", default=None, help="audit/stamp.json（有则必须先验信任链）")
    sp.add_argument("--keys", default=None, help="项目外公钥登记 approver_keys.json")
    sp.add_argument("--project", default=None,
                    help="--build 用的项目目录（默认取 PDF 所在目录）")
    sp.add_argument("--build", action="store_true",
                    help="回检前先编 PDF（项目目录默认取 PDF 上一级）")
    sp.add_argument("--json", action="store_true", help="（本命令默认只输出 JSON）")
    sp = sub.add_parser(
        "style", help="文风闸：只报公式化写作特征（黄牌 exit 3）；证据钢印红 exit 1")
    sp.add_argument("project", nargs="?", default=None,
                    help="项目目录（默认当前目录；与 --doc 互斥）")
    sp.add_argument("--doc", action="append", nargs="+", default=None,
                    metavar="FILE",
                    help="文档模式：直接扫文件，不需要 factscribe.toml；"
                         "按扩展名判定格式（.md/.markdown = Markdown，"
                         ".tex = LaTeX，其它 = 纯文本）。可重复，可一次多个")
    sp.add_argument("--json", action="store_true", help="机器可读输出（stdout 只出 JSON）")
    sp.add_argument("--prompt", action="store_true",
                    help="只输出给 LLM 的改写指令（≤ 400 字）")
    sp.add_argument("--lang", choices=("zh", "en"), default=None,
                    help="findings 文案语言（只影响 --json 的输出；"
                         "不给＝中文原话）")
    sp.add_argument("--rules", default=None,
                    help="style-rules.toml 路径（默认项目根，其次仓根）")
    sp.add_argument("--stage", choices=list(STAGE_VALUES), default=STAGE_DRAFT,
                    help="数字密度阶段开关（只从命令行来，项目内规则文件"
                         "写了也不认）：draft（默认，正常判定）| "
                         "revision（改稿阶段，NUMERAL_DENSITY 降为 info）")
    sp.add_argument("--diff", default=None, metavar="BEFORE",
                    help="改写前目录：只报本次改写新增的违规，并启用标题"
                         "关系词/主语丢失比对（需该目录有 factscribe.toml）")
    sp.add_argument("--report-unregistered", action="store_true",
                    help="打开 TERM_UNREGISTERED 提示（默认关；只查标题，"
                         "结果进 info 通道，不进 findings、不影响退出码）")
    sp.add_argument("--report-abbrev", action="store_true",
                    help="打开 ABBREV_FIRST_USE（默认关；缩写首现未展开，"
                         "按条报，进 findings）")
    sp = sub.add_parser(
        "protect", help="改写保护面比对：前后目录的 facts/数字/引用/公式/表格/交叉引用")
    sp.add_argument("--before", required=True, help="改写前目录")
    sp.add_argument("--after", required=True, help="改写后目录")
    sp.add_argument("--json", action="store_true", help="机器可读输出（stdout 只出 JSON）")
    sp.add_argument("--allow-renames", action="store_true",
                    help="章节标题变化降为信息（不让它拉黄）")
    sp = sub.add_parser(
        "tide", help="潮汐式改动账：涨/落/波及面/闭合三条件，全成或全退")
    sp.add_argument("--before", default=None, help="改前目录（比对模式必填）")
    sp.add_argument("--after", default=None,
                    help="改后目录（比对模式必填；快照模式为要快照的目录）")
    sp.add_argument("--out", default=None,
                    help="事件账本（默认 <after>/audit/tide-events.ndjson）")
    sp.add_argument("--snapshot", default=None, metavar="STORE",
                    help="快照库根（默认 ./.tide）；给了即保存模式")
    sp.add_argument("--restore", default=None, metavar="SNAPSHOT_ID",
                    help="按快照ID（全宽或任意唯一前缀）恢复，需配 --into")
    sp.add_argument("--into", default=None, metavar="DIR",
                    help="恢复目标目录（与 --restore 一起用）")
    sp.add_argument("--ignore", action="append", default=None, metavar="GLOB",
                    help="追加忽略规则（可重复），在默认 LaTeX 构建产物表之上"
                         "；fnmatch 对相对路径匹配")
    sp.add_argument("--no-default-ignore", action="store_true",
                    help="关掉默认忽略表（排查用）")
    sp.add_argument("--json", action="store_true",
                    help="机器可读输出（stdout 只出 JSON）")
    sp = sub.add_parser(
        "review",
        help="改写验收一条命令：protect + style --diff + tide 的组合，不新增判据",
        description="改写验收一条命令：protect + style --diff + tide 的组合，"
                    "不新增判据。保护面有红或 tide 不闭合即拒绝（exit 1）；"
                    "新增违规超过 --allow-new 即需复核（exit 3）；三项全过才"
                    "通过（exit 0）。--snapshot 只在通过时存快照。")
    sp.add_argument("--before", required=True, help="改写前目录")
    sp.add_argument("--after", required=True, help="改写后目录")
    sp.add_argument("--snapshot", default=None, metavar="STORE",
                    help="判定为「通过」时保存快照的库根（其余判定不存）")
    sp.add_argument("--allow-new", dest="allow_new", type=int, default=0,
                    metavar="N", help="允许的新增 style 违规条数（默认 0）")
    sp.add_argument("--json", action="store_true",
                    help="机器可读输出（stdout 只出 JSON）")
    sp = sub.add_parser(
        "polish",
        help="润色工单：打印操作手册，或按处方优先序出工作单（不新增判据）",
        description="润色工单：--print 打印写给执行改写的模型的操作手册；"
                    "--plan <项目> 扫描 style 的命中，按处方优先序出工作单。"
                    "没有处方的错误码一律标「无处方：只提示，不许为它改句子」。"
                    "本命令不是闸门，成功永远退出 0。")
    group = sp.add_mutually_exclusive_group(required=True)
    group.add_argument("--print", dest="print_playbook", action="store_true",
                       help="打印操作手册（Markdown）")
    group.add_argument("--plan", nargs="?", const=".", default=None,
                       metavar="PROJECT",
                       help="打印工作单（项目目录，默认当前目录）")
    sp.add_argument("--json", action="store_true",
                    help="机器可读输出（stdout 只出 JSON；仅 --plan 有效）")
    sp = sub.add_parser(
        "brief",
        help="写作简报：从账里生成起草依据（任务/事实/术语/硬约束/验收）",
        description="写作简报：把项目名、节结构、可用 fact 的 claim/value、术语"
                    "正名与禁用变体、五条硬约束、验收命令装成一份 Markdown，"
                    "交给写作模型当依据。只读账，不判断文字好坏；没有 fact 或"
                    "节即 exit 2，不输出空简报。")
    sp.add_argument("project", nargs="?", default=".", help="项目目录（默认当前目录）")
    sp.add_argument("--section", default=None, metavar="PREFIX",
                    help="只出某一节：按节文件名词干前缀匹配（例：04）")
    sp.add_argument("--out", default=None, metavar="FILE",
                    help="把 Markdown 写到文件（默认只出 stdout）")
    sp.add_argument("--json", action="store_true",
                    help="机器可读输出（stdout 只出 JSON）")
    sp = sub.add_parser(
        "prescribe",
        help="处方层：只给可执行改法（数据文件），不参与判据、不产生分数")
    sp.add_argument("names", nargs="*", metavar="NAME",
                    help="处方名（可多个；多个一起输出时按优先序裁决并标「让位」）")
    sp.add_argument("--list", action="store_true", help="列出全部处方")
    sp.add_argument("--for", dest="for_code", default=None, metavar="CODE",
                    help="按错误码查处方（例：HEADING_ECHO）")
    sp.add_argument("--json", action="store_true",
                    help="机器可读输出（stdout 只出 JSON）")
    sp = sub.add_parser(
        "fonts", help="Fandol 中文字体缓存：--status 看状态，--fetch 按需下载")
    fgroup = sp.add_mutually_exclusive_group(required=True)
    fgroup.add_argument("--status", action="store_true",
                        help="查看缓存目录与四个必需 OTF 是否齐")
    fgroup.add_argument("--fetch", action="store_true",
                        help="下载 Fandol 包并解压到缓存（已完整则跳过）")
    sp.add_argument("--url", default=None, metavar="URL",
                    help="字体包地址或本地路径（默认 CTAN fandol.zip）")
    sp.add_argument("--force", action="store_true",
                    help="缓存已完整也重下")
    sp.add_argument("--json", action="store_true",
                    help="机器可读输出（stdout 只出 JSON）")
    sp = sub.add_parser(
        "terms", help="术语候选抽取与人工入表（零 LLM：suggest / add）")
    tsp = sp.add_subparsers(dest="terms_action", required=True)
    ss = tsp.add_parser("suggest", help="从论文语料抽术语候选（TSV）")
    ss.add_argument("root", help="论文目录")
    ss.add_argument("--min-count", type=int, default=4, metavar="N",
                    help="最少出现次数（默认 4）")
    ss.add_argument("--min-sections", type=int, default=3, metavar="N",
                    help="最少跨小节数（默认 3）")
    ss.add_argument("--out", default=None, metavar="FILE",
                    help="候选 TSV 落盘路径（默认只出 stdout）")
    ss.add_argument("--glossary", default=None, metavar="TSV",
                    help="既有词表（默认仓内 paper.tsv ＋ workspace.tsv）")
    ss.add_argument("--json", action="store_true",
                    help="机器可读输出（stdout 只出 JSON）")
    sa = tsp.add_parser("add", help="只把人工 --pick 点名的形式写进 paper.tsv")
    sa.add_argument("--from", dest="from_path", required=True, metavar="FILE",
                    help="terms suggest 产出的候选 TSV")
    sa.add_argument("--pick", action="append", required=True,
                    metavar="SURFACE",
                    help="人工指定的表面形式；逗号分隔，可重复")
    sa.add_argument("--glossary", default=None, metavar="TSV",
                    help="目标词表（默认 factscribe/terms/paper.tsv）")
    sa.add_argument("--json", action="store_true",
                    help="机器可读输出（stdout 只出 JSON）")
    sp = sub.add_parser(
        "evidence",
        help="证据清单：--suggest 出 [evidence] 块，--freeze/--unfreeze 冻结与解冻",
        description="证据清单可由人或 LLM 产出，但由机器冻结：--suggest 扫描"
                    "正文 \\fact{} 引用，输出可直接粘进 factscribe.toml 的 "
                    "[evidence] 块；--freeze 读当前清单，写 audit/evidence.lock"
                    "（规范化哈希 + 明文底稿）。冻结后 audit/review 检查清单"
                    "有没有被改，改了就红 EVIDENCE_SET_CHANGED。"
                    "--unfreeze 必须先写理由，解冻记录进 audit/evidence-log.ndjson；"
                    "改完必须重新 --freeze。")
    eg = sp.add_mutually_exclusive_group(required=True)
    eg.add_argument("--suggest", metavar="PROJECT",
                    help="扫描项目各节正文，输出 [evidence] TOML 块"
                         "（stdout 只有 TOML，可重定向）")
    eg.add_argument("--freeze", metavar="PROJECT",
                    help="读当前 [evidence]，写 audit/evidence.lock 并记一条 freeze")
    eg.add_argument("--unfreeze", metavar="PROJECT",
                    help="解冻清单：必须带 --reason，记一条 unfreeze 后允许改")
    sp.add_argument("--reason", default=None, metavar="TEXT",
                    help="为什么改（--unfreeze 必填）/ 本次冻结说明（--freeze 可选）")
    sp.add_argument("--at", default="", metavar="YYYY-MM-DD",
                    help="解冻时间（不传则写空，由人补；不读系统时钟）")
    sp.add_argument("--json", action="store_true",
                    help="机器可读输出（stdout 只出 JSON）")
    return p


def cmd_init(args) -> int:
    info = init_project(Path(args.directory), title=args.title,
                        author=args.author, lang=args.lang,
                        force=args.force)
    if args.json:
        payload = _payload("init", "ok", EXIT_OK, **info)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return EXIT_OK
    zh = info["lang"] == "zh"
    head = ("已生成最小项目：%s（lang=%s，%d 个文件）"
            % (args.directory, info["lang"], len(info["files"])) if zh else
            "Created minimal project: %s (lang=%s, %d files)"
            % (args.directory, info["lang"], len(info["files"])))
    lines = [head] + ["  " + name for name in info["files"]]
    if info.get("overwritten"):
        lines.append("")
        lines.append("覆盖了已存在的 %d 个文件：%s"
                     % (len(info["overwritten"]),
                        "、".join(info["overwritten"])))
    lines.append("")
    lines.append("下一步（三条命令）：" if zh else "Next (three commands):")
    lines += info["next"]
    print("\n".join(lines))
    return EXIT_OK


def cmd_doctor(args) -> int:
    """环境与项目自检：只报告，不判定；成功永远 exit 0。"""
    info = collect_doctor(Path(args.project))
    payload = _payload("doctor", "ok", EXIT_OK, **info)
    _emit(payload, render_doctor(info), args.json)
    return EXIT_OK


def cmd_serve(args) -> int:
    """本地工作台 HTTP API：启动后阻塞，直到 Ctrl+C。"""
    project = Path(args.project) if args.project else None
    no_token = bool(getattr(args, "no_token", False))
    server, token = create_server(
        project, host=args.host, port=args.port,
        token=(args.token or None), allow_write=bool(args.allow_write),
        serve_ui=bool(getattr(args, "ui", False)),
        allow_build=bool(args.allow_build),
        require_token=not no_token)
    host, port = server.server_address[0], server.server_address[1]
    url = "http://%s:%d" % (host, port)
    dev = bool(getattr(args, "dev", False))
    ui_url = ""
    legal_url = ""
    if getattr(args, "ui", False):
        query = ("token=" + token if token else "")
        if dev:
            query = (query + "&" if query else "") + "dev=1"
        ui_url = url + "/" + ("?" + query if query else "")
        # 法律侧工作台页面（法律集成件自带的前端；只读档案）。
        legal_url = url + "/legal" + ("?" + query if query else "")
    command = "web" if getattr(args, "web", False) else "serve"
    if args.json:
        print(json.dumps({
            "event": "listening", "ok": True, "command": command,
            "url": url, "ui": ui_url or None,
            "legal_ui": legal_url or None,
            "token": token,
            "token_required": not no_token,
            "project": str(server.project) if server.project else None,
            "api": ["/api/health", "/api/capabilities", "/api/status",
                    "/api/brief", "/api/audit", "/api/project"],
            "write": bool(args.allow_write),
            "build": bool(args.allow_build),
        }, ensure_ascii=False), flush=True)
    else:
        print("== factscribe %s ==" % command)
        print("项目：%s" % (server.project or "未选择（在页面里选）"))
        print("URL：%s" % url)
        if ui_url:
            print("页面：%s" % ui_url)
            print("  （旧的节级网页前端已按第 ④ 步废弃；产品前端是段落级工作台："
                  "factscribe workbench --root <目录>。--ui 这条闸留给集成件"
                  "自带的页面。）")
        if legal_url:
            print("法律侧页面：%s" % legal_url)
        if token:
            print("Token：%s" % token)
        mode = "可写（--allow-write）" if args.allow_write else "只读"
        if args.allow_build:
            mode += " · 可编译（--allow-build）"
        if dev:
            mode += " · 开发模式（显示 MiniApp 专属区）"
        if no_token:
            mode += " · 无 token（只允许本机同源）"
        print("模式：%s" % mode)
        print("接口：/api/health  /api/capabilities  /api/status  "
              "/api/brief  /api/audit  /api/project")
        print("只绑回环；按 Ctrl+C 停止。", flush=True)
        if ui_url and not getattr(args, "no_open", False):
            try:
                webbrowser.open(ui_url)
            except Exception:  # noqa: BLE001 - 打不开浏览器不影响服务
                pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        server.server_close()
    return EXIT_OK


def cmd_workbench(args) -> int:
    """工作台网页：发现项目 → 起本地服务 → 阻塞到 Ctrl+C。"""
    if getattr(args, "workbench_action", None) == "new":
        return cmd_workbench_new(args)
    from .workbench.server import create_server

    root = Path(args.root).expanduser()
    if not root.exists():
        raise ConfigError("根目录不存在：%s" % root, code="PROJECT_INVALID")
    if not root.is_dir():
        raise ConfigError("根目录不是文件夹：%s" % root, code="PROJECT_INVALID")
    server, index = create_server(root, host=args.host, port=args.port,
                                  max_depth=int(getattr(args, "max_depth", 3)),
                                  state_dir=str(getattr(args, "state_dir", "") or ""))
    host, port = server.server_address[0], server.server_address[1]
    url = "http://%s:%d/" % (host, port)
    projects = index.projects(refresh=True)
    if args.json:
        print(json.dumps({
            "event": "listening", "ok": True, "command": "workbench",
            "url": url, "root": str(root), "projects": len(projects),
            "api": ["/api/projects",
                    "/api/disk/<project>/<disk>/sections",
                    "/api/disk/<project>/<disk>/meta",
                    "/api/disk/<project>/<disk>/assembly",
                    "/api/disk/<project>/<disk>/block/<id>",
                    "POST /api/disk/<project>/<disk>/edit",
                    "POST /api/disk/<project>/<disk>/toc/{move,delete,create}",
                    "POST /api/disk/<project>/<disk>/proposal[/<id>/{confirm,reject}]",
                    "POST /api/project/{new,update,opened}"],
            "write": True,
        }, ensure_ascii=False), flush=True)
    else:
        print("== factscribe workbench ==")
        print("根目录：%s" % root)
        print("项目：%d 个" % len(projects))
        print("URL：%s" % url)
        print("接口：/api/projects  /api/disk/<project>/<disk>/sections  "
              "/api/disk/<project>/<disk>/meta  /api/disk/<project>/<disk>/assembly")
        print("写接口：正文写回、章节调序/删除/新建、项目新建/编辑"
              "（只写根目录下的项目；保存前留 .bak）")
        print("只绑回环；按 Ctrl+C 停止。", flush=True)
    if not getattr(args, "no_browser", False):
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001 - 打不开浏览器不影响服务
            pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        server.server_close()
    return EXIT_OK


def cmd_workbench_new(args) -> int:
    """新建论文项目：落目录骨架（factscribe.toml ＋ sections/ ＋ facts/ ＋ README）。"""
    from .workbench.write import create_paper_project

    lang = str(getattr(args, "lang", "en") or "en")
    langs = ["en", "zh"] if lang == "both" else [lang]
    result = create_paper_project(
        Path(args.root).expanduser(),
        slug=str(getattr(args, "slug", "") or ""),
        title=str(getattr(args, "title", "") or ""),
        langs=langs,
        project_dir=str(getattr(args, "project_dir", "") or ""),
        reports_dir=str(getattr(args, "reports_dir", "") or ""))
    if getattr(args, "json", False):
        print(json.dumps({"ok": True, "command": "workbench new", **result},
                         ensure_ascii=False, indent=2))
        return EXIT_OK
    print("已建项目（%d 个盘）：" % len(result["created"]))
    for disk in result["disks"]:
        print("  %s（%s 盘）→ %s" % (disk["id"], disk["lang"], disk["path"]))
        print("    项目目录字段：%s" % disk["project_dir"])
        print("    实验报告目录：%s" % disk["reports_dir"])
    print("配置写在 factscribe.toml 的 [workbench] 表里。")
    return EXIT_OK


def cmd_mcp(args) -> int:
    """MCP stdio 服务器：阻塞读 stdin，stdout 只出 JSON-RPC。"""
    from .mcp import run_stdio
    return run_stdio(Path(args.project), allow_write=bool(args.allow_write))


def cmd_fact(args) -> int:
    action = getattr(args, "fact_action", None)
    if action == "import":
        return cmd_fact_import(args)
    if action != "add":  # argparse 已保证，防御一手
        raise ConfigError("fact 目前只有 add / import 子命令")
    info = add_fact(
        Path(args.project), fid=args.id, claim=args.claim, value=args.value,
        source=args.source, locator=args.locator,
        confidence=args.confidence, expr=args.expr or "",
        derived_from=args.derived_from or "", note=args.note or "",
        ledger=args.ledger or "")
    if args.json:
        payload = _payload("fact", "ok", EXIT_OK, action="add", **info)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return EXIT_OK
    print("已写入 fact %s：%s = %s（source %s）"
          % (info["id"], info["claim"], info["value"], info["source"]))
    print("别忘了把这一行加进 %s 并签上你的名字：%s"
          % (info["manifest"], info["manifest_line"]))
    return EXIT_OK


class _Usage(Exception):
    """用法错：退出码 2（不是「有违例」的 1）。"""


# --------------------------------------------------------------------------
# report / fact import（P0 第二步）
#
# 这一层只做编排：真正的读报告、跑探针、上锁、出卡、签收都在 report.py 里，
# 这里不重复实现它的语义。退出码只用 0/1/2。
# --------------------------------------------------------------------------

def _report_json_line(payload: dict) -> None:
    """stdout 末行必须是单行 JSON（`tail -1` 就能解析）。"""
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def _report_fail(args, command: str, exit_code: int, report: str,
                 code: str, message: str, details=None, **kw) -> int:
    """失败出口：JSON 模式只出单行 JSON；人读模式出错到 stderr。"""
    if getattr(args, "json", False):
        payload = _payload(command, "error", exit_code, ok=False, report=report,
                           error={"code": code, "message": message}, **kw)
        _report_json_line(payload)
    else:
        print("factscribe: %s 失败（%s）：%s" % (command, code, message),
              file=sys.stderr)
        for item in details or []:
            print("  - %s: %s" % (item.get("code", ""), item.get("message", "")),
                  file=sys.stderr)
    return exit_code


def _report_ok(args, command: str, report: str, **kw) -> int:
    if getattr(args, "json", False):
        payload = _payload(command, "ok", EXIT_OK, ok=True, report=report, **kw)
        _report_json_line(payload)
    return EXIT_OK


def _ws_arg(args) -> Path:
    """工作区根：必须是存在的目录，否则是用法错（2）。"""
    raw = str(getattr(args, "ws", "") or "").strip()
    if not raw:
        raise _Usage("工作区根不能为空")
    path = Path(raw).expanduser()
    if not path.is_dir():
        raise _Usage("工作区 %s 不存在或不是目录" % path)
    return path.resolve()


def _lock_state(ws: Path, report: dict) -> tuple:
    """锁的状态：("ok"|"missing"|"stale", 人话)。"""
    lock_path = _artifact_path(ws, report, ".lock.json")
    if not lock_path.exists():
        return "missing", "还没有锁文件 %s（先 lock 再入账）" % lock_path.name
    try:
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return "stale", "锁文件 %s 读不了：%s" % (lock_path.name, exc)
    if not isinstance(lock, dict):
        return "stale", "锁文件 %s 不是 JSON 对象" % lock_path.name
    try:
        report_file = _resolve_in_ws(ws, report.get("path", ""))
        current = {
            "report_sha256": _sha256_of(report_file),
            "semantic_digest": semantic_digest(report),
            "evidence_digest": evidence_digest(ws, report),
        }
    except ReportError as exc:
        return "stale", exc.message
    for key, value in current.items():
        if lock.get(key) != value:
            return "stale", ("锁里的 %s 与现在对不上（锁里 %s，现在 %s）"
                             % (key, str(lock.get(key))[:12], value[:12]))
    return "ok", "锁与现在一致"


def cmd_report_check(args) -> int:
    command = "report check"
    ref = str(getattr(args, "report", "") or "")
    try:
        ws = _ws_arg(args)
    except _Usage as exc:
        return _report_fail(args, command, EXIT_CONFIG, ref, "USAGE", str(exc))
    try:
        result = check_report(ws, ref)
    except ReportError as exc:
        return _report_fail(args, command, EXIT_RED, ref, exc.code, exc.message)
    if not result["ok"]:
        first = result["errors"][0]
        return _report_fail(args, command, EXIT_RED, ref,
                            first.get("code", "REPORT_ERROR"),
                            first.get("message", ""),
                            details=result["errors"], errors=result["errors"])
    if not getattr(args, "json", False):
        print("报告检查通过：%s（%d 个指标）" % (ref, len(result["metrics"])))
    return _report_ok(args, command, ref, metrics=result["metrics"])


def cmd_report_lock(args) -> int:
    command = "report lock"
    ref = str(getattr(args, "report", "") or "")
    try:
        ws = _ws_arg(args)
    except _Usage as exc:
        return _report_fail(args, command, EXIT_CONFIG, ref, "USAGE", str(exc))
    try:
        lock = lock_report(ws, ref)
    except ReportError as exc:
        return _report_fail(args, command, EXIT_RED, ref, exc.code, exc.message)
    try:
        report = load_report(ws, ref)
    except ReportError as exc:
        return _report_fail(args, command, EXIT_RED, ref, exc.code, exc.message)
    lock_path = _artifact_path(ws, report, ".lock.json")
    if not getattr(args, "json", False):
        print("已上锁：%s" % lock_path)
        print("语义摘要 %s；证据摘要 %s"
              % (str(lock.get("semantic_digest", ""))[:12],
                 str(lock.get("evidence_digest", ""))[:12]))
    return _report_ok(args, command, report.get("path", ref),
                      lock=str(lock_path), lock_path=_rel_posix(ws, lock_path))


def cmd_report_sign(args) -> int:
    command = "report sign"
    ref = str(getattr(args, "report", "") or "")
    by = str(getattr(args, "by", "") or "")
    if not by.strip():
        return _report_fail(args, command, EXIT_CONFIG, ref, "USAGE",
                            "--by 不能为空（要写清楚是谁签的）")
    try:
        ws = _ws_arg(args)
    except _Usage as exc:
        return _report_fail(args, command, EXIT_CONFIG, ref, "USAGE", str(exc))
    card_out = getattr(args, "card_out", None)
    try:
        signoff = sign_report(ws, ref, by, card_out=card_out)
    except ReportError as exc:
        return _report_fail(args, command, EXIT_RED, ref, exc.code, exc.message)
    report = load_report(ws, ref)
    signoff_path = _artifact_path(ws, report, ".signoff.toml")
    log_path = _artifact_path(ws, report, ".signoff.log")
    lines = list(signoff.get("card_lines") or [])
    if not getattr(args, "json", False):
        print("== 审阅卡 ==")
        for line in lines:
            print(line)
        print("")
        print("签收位置：%s" % signoff_path)
        print("签收流水：%s" % log_path)
        print("签收人：%s" % by)
        if card_out:
            print("审阅卡另存：%s" % _resolve_in_ws(ws, card_out))
    return _report_ok(args, command, report.get("path", ref), card=lines,
                      signed_by=by, signoff=str(signoff_path),
                      signoff_path=_rel_posix(ws, signoff_path),
                      card_out=str(card_out) if card_out else "")


# ---- fact import --------------------------------------------------------

def _locator_for(source: dict) -> str:
    """探针定位的人话（例：jsonl.count_where resolved=true）。"""
    probe = str(source.get("probe", ""))
    if probe == "jsonl.count_where":
        return "jsonl.count_where %s" % str(source.get("where", ""))
    if probe == "jsonl.count":
        return "jsonl.count"
    if probe == "csv.cell":
        return ("csv.cell %s=%s column=%s"
                % (source.get("row_column", ""), source.get("row_key", ""),
                   source.get("column", "")))
    if probe == "json.pointer":
        return "json.pointer %s" % str(source.get("pointer", ""))
    return probe


def _fact_id(experiment: str, report_id: str, metric_id: str) -> str:
    """<experiment>.<report_id>.<metric_id>：只许 [A-Za-z0-9._-]，最长 100 字符。"""
    raw = "%s.%s.%s" % (experiment, report_id, metric_id)
    clean = re.sub(r"[^A-Za-z0-9._-]", "_", raw)
    if len(clean) > 100:
        digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:8]
        clean = clean[:91] + "-" + digest
    return clean


def _facts_dir(cfg: Config) -> Path:
    """事实账目录（只写一级，不许子目录）。"""
    glob = (cfg.facts_glob or "facts/*.toml").strip()
    rel = Path(glob).parent if any(ch in glob for ch in "*?[") else Path(glob)
    return cfg.root / rel


def cmd_fact_import(args) -> int:
    command = "fact import"
    ref = str(getattr(args, "report", "") or "")
    try:
        ws = _ws_arg(args)
    except _Usage as exc:
        return _report_fail(args, command, EXIT_CONFIG, ref, "USAGE", str(exc))
    try:
        report = load_report(ws, ref)
    except ReportError as exc:
        return _report_fail(args, command, EXIT_RED, ref, exc.code, exc.message)
    rel_report = report.get("path", ref)

    # 1. 只有 final 的报告能入账
    if report.get("status") != "final":
        return _report_fail(args, command, EXIT_RED, rel_report, "REPORT_NOT_FINAL",
                            "报告状态是 %r，只有 final 的报告能入账"
                            % report.get("status", ""))

    # 2a. 锁必须在且与现在一致
    state, reason = _lock_state(ws, report)
    if state != "ok":
        return _report_fail(args, command, EXIT_RED, rel_report,
                            "REPORT_LOCK_MISMATCH", reason)

    # 2b. 签收必须在且核得过
    verified = verify_signoff(ws, ref)
    if not verified.get("ok"):
        return _report_fail(args, command, EXIT_RED, rel_report,
                            "REPORT_NOT_SIGNED",
                            verified.get("reason", "没有签收"))

    # 3. 论文项目目录
    paper_raw = getattr(args, "paper", None)
    if paper_raw:
        paper = Path(str(paper_raw)).expanduser()
    else:
        # 默认 <ws>/paper；没有就试 ws 本身（单项目工作区，例如内置示例）
        candidate = ws / "paper"
        paper = candidate if candidate.is_dir() else ws
    if not paper.is_dir():
        return _report_fail(args, command, EXIT_CONFIG, rel_report, "PAPER_MISSING",
                            "论文项目目录 %s 不存在（--paper 给对了吗）" % paper)
    paper = paper.resolve()
    try:
        cfg = load_config(paper)
    except ConfigError as exc:
        return _report_fail(args, command, EXIT_CONFIG, rel_report,
                            "PAPER_CONFIG_INVALID", str(exc))

    # 4. 每条 metric 生成一条 fact
    base = source_base(cfg)
    experiment = str(report.get("experiment") or "").strip() or str(report.get("id", ""))
    report_id = str(report.get("id", "")).strip()
    facts_out: list = []
    for metric in report.get("metrics", []):
        sources = metric.get("sources") or []
        primary = next((s for s in sources if s.get("role") == "value"), None)
        if primary is None and sources:
            primary = sources[0]
        if primary is None:
            return _report_fail(args, command, EXIT_RED, rel_report,
                                "REPORT_NO_SOURCE",
                                "指标 %s 没有来源，导不进账" % metric.get("id", ""))
        try:
            abs_src = _resolve_in_ws(ws, primary.get("path", ""))
        except ReportError as exc:
            return _report_fail(args, command, EXIT_RED, rel_report,
                                exc.code, exc.message)
        try:
            rel_src = abs_src.resolve().relative_to(base.resolve()).as_posix()
        except ValueError:
            return _report_fail(args, command, EXIT_RED, rel_report,
                                "SOURCE_OUTSIDE_PROJECT",
                                "来源 %s 不在 source_root（%s）里——它必须能按项目的"
                                "source_root 解析出来" % (primary.get("path", ""), base))
        if not rel_src or rel_src.startswith(".."):
            return _report_fail(args, command, EXIT_RED, rel_report,
                                "SOURCE_OUTSIDE_PROJECT",
                                "来源 %s 跑出了论文项目/source_root 之外"
                                % primary.get("path", ""))
        try:
            digest = _sha256_of(abs_src)
        except OSError as exc:
            return _report_fail(args, command, EXIT_RED, rel_report,
                                "SOURCE_UNREADABLE",
                                "来源 %s 读不了：%s" % (primary.get("path", ""), exc))
        facts_out.append({
            "id": _fact_id(experiment, report_id, str(metric.get("id", ""))),
            "claim": str(metric.get("claim", "")),
            "value": str(metric.get("display", "")),
            "source": rel_src,
            "source_sha256": digest,
            "locator": _locator_for(primary),
            "confidence": "high",
            "kind": "claim",
            "report": rel_report,
            "report_metric": str(metric.get("id", "")),
        })

    # 5. 写 facts/<experiment>.<report_id>.toml
    stem = re.sub(r"[^A-Za-z0-9._-]", "_", "%s.%s" % (experiment, report_id))
    facts_dir = _facts_dir(cfg)
    target = facts_dir / ("%s.toml" % stem)
    if target.parent.resolve() != facts_dir.resolve():
        return _report_fail(args, command, EXIT_CONFIG, rel_report, "FACTS_PATH_INVALID",
                            "只许写 facts/ 一级，不许写子目录")
    # 写侧信任根闸：账本的真实目标越出项目根就拒写——不落盘、不留半截文件。
    # 与读侧同一对码（FACT_FILE_OUTSIDE_PROJECT / FACT_FILE_UNRESOLVED，
    # red / exit 5），severity 与 exit 一律不动。
    try:
        target_rel = target.relative_to(cfg.root).as_posix()
    except ValueError:
        target_rel = target.name
    try:
        guard_facts_write(cfg.root, target, rel=target_rel)
    except WriteRefused as exc:
        return _report_fail(args, command, exc.exit_code, rel_report,
                            exc.code, str(exc))
    header = ("# managed by factscribe fact import; report=%s digest=%s"
              % (rel_report, semantic_digest(report)))
    body = [header, ""]
    for item in facts_out:
        body.append("[[fact]]")
        for key in ("id", "claim", "value", "source", "source_sha256",
                    "locator", "confidence", "kind", "report", "report_metric"):
            body.append("%s = %s" % (key, _toml_str(item[key])))
        body.append("")
    text = "\n".join(body)
    data = text.encode("utf-8")

    rel_target = _rel_posix(paper, target)
    if getattr(args, "dry_run", False):
        if not getattr(args, "json", False):
            print("演练（不写盘）：将写 %s（%d 条 fact）" % (rel_target, len(facts_out)))
        return _report_ok(args, command, rel_report, facts_file=rel_target,
                          facts=facts_out, unchanged=False, dry_run=True,
                          written=False)

    if target.exists():
        try:
            current = target.read_bytes()
        except OSError as exc:
            return _report_fail(args, command, EXIT_RED, rel_report,
                                "FACTS_FILE_UNREADABLE",
                                "%s 读不了：%s" % (rel_target, exc))
        if current == data:
            if not getattr(args, "json", False):
                print("账上已是最新，未改动：%s（%d 条 fact）"
                      % (rel_target, len(facts_out)))
            return _report_ok(args, command, rel_report, facts_file=rel_target,
                              facts=facts_out, unchanged=True, dry_run=False,
                              written=False)
        return _report_fail(args, command, EXIT_RED, rel_report, "FACTS_FILE_DIRTY",
                            "%s 已经存在但内容不一致（人改过，或报告变了）——"
                            "删掉它再重新导入" % rel_target)

    try:
        facts_dir.mkdir(parents=True, exist_ok=True)
        _write_atomic(target, data)
    except OSError as exc:
        return _report_fail(args, command, EXIT_RED, rel_report, "FACTS_WRITE_FAILED",
                            "%s 写不了：%s" % (rel_target, exc))
    if not getattr(args, "json", False):
        print("已导入 %d 条 fact：%s" % (len(facts_out), rel_target))
    return _report_ok(args, command, rel_report, facts_file=rel_target,
                      facts=facts_out, unchanged=False, dry_run=False, written=True)


def cmd_report(args) -> int:
    action = getattr(args, "report_action", None)
    if action == "check":
        return cmd_report_check(args)
    if action == "lock":
        return cmd_report_lock(args)
    if action == "sign":
        return cmd_report_sign(args)
    raise ConfigError("report 目前只有 check / lock / sign 子命令")


def cmd_check(args) -> int:
    cfg = load_config(Path(args.project))
    facts = load_facts(cfg)
    issues, warnings, conflicts, summary = run_check(cfg, facts)
    code = _aggregate_exit(issues, warnings, getattr(args, "strict", False))
    text = _human_check(cfg, facts, issues, warnings, conflicts, summary, code)
    if cfg.warnings:
        text += "\n配置告警：%d 条（--json 的 config.warnings 有明细）" % len(cfg.warnings)
    payload = _payload("check", _severity_of(code), code,
                       summary=summary,
                       issues=[i.as_dict() for i in issues],
                       warnings=[i.as_dict() for i in warnings],
                       hints=[], conflicts=conflicts)
    payload["config"] = _config_block(cfg)
    payload["config_warnings"] = list(cfg.warnings)
    _emit(payload, text, args.json)
    return code


def cmd_mirror_check(args) -> int:
    """双语双盘账本逐条比对（CARD-G5）：只读，不写盘。"""
    result = mirror.check(Path(args.disk_a), Path(args.disk_b))
    code = result.exit_code
    payload = _payload("mirror-check",
                       "drift" if code == EXIT_RED else "ok", code,
                       summary=result.summary(),
                       drift=mirror.drift_dicts(result))
    payload["disk_a"] = str(result.disk_a)
    payload["disk_b"] = str(result.disk_b)
    _emit(payload, mirror.render(result), args.json)
    return code


def _figures_config_error(args, command: str, exc) -> int:
    """figures 子命令的结构错：退出码 2，且 JSON 里有 code 与 findings。"""
    code = getattr(exc, "code", "CONFIG_INVALID")
    finding = {"severity": "red", "code": code, "message": str(exc)}
    payload = _payload(command, "error", EXIT_CONFIG, message=str(exc), code=code,
                       findings=[finding], issues=[finding])
    if getattr(args, "json", False):
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print("factscribe: 配置/用法错：%s" % exc, file=sys.stderr)
    return EXIT_CONFIG


def cmd_figures_gen(args) -> int:
    """账本驱动的图表生成（CARD-G2）：人填规格 → 机械出三件套。"""
    try:
        result = figures.generate(Path(args.project))
    except ConfigError as exc:
        return _figures_config_error(args, "figures-gen", exc)
    code = result.exit_code
    payload = _payload("figures-gen",
                       "ok" if code == EXIT_OK else "violation", code,
                       summary=result.summary(),
                       skipped=result.skipped,
                       figures=[f.as_dict() for f in result.figures],
                       findings=[f.as_dict() for f in result.findings],
                       issues=[f.as_dict() for f in result.findings])
    _emit(payload, figures.render_gen(result), args.json)
    return code


def cmd_figures_check(args) -> int:
    """四面比对（CARD-G2）：规格 ↔ 绑定表 ↔ 随图 CSV ↔ 现行账本。"""
    try:
        result = figures.check(Path(args.project))
    except ConfigError as exc:
        return _figures_config_error(args, "figures-check", exc)
    code = result.exit_code
    payload = _payload("figures-check",
                       "ok" if code == EXIT_OK else "violation", code,
                       summary=result.summary(),
                       skipped=result.skipped,
                       figures=[f.as_dict() for f in result.figures],
                       findings=[f.as_dict() for f in result.findings],
                       issues=[f.as_dict() for f in result.findings])
    _emit(payload, figures.render_check(result), args.json)
    return code


def cmd_figures(args) -> int:
    """画图管线命令族（CARD-G2）。"""
    if args.figures_action == "gen":
        return cmd_figures_gen(args)
    return cmd_figures_check(args)


def cmd_bundle(args) -> int:
    """投稿工件包：收集 → 清单门 → 打包；--verify 只复算 MANIFEST。"""
    if getattr(args, "verify", None):
        result = bundle.verify_bundle(Path(args.verify))
        payload = _payload(
            "bundle", "ok" if result.get("ok") else "red",
            result.get("exit_code", EXIT_RED), action="verify",
            bundle_dir=result.get("bundle_dir"),
            lines=result.get("lines", 0), files=result.get("files", 0),
            mismatched=result.get("mismatched") or [],
            missing=result.get("missing") or [],
            extra=result.get("extra") or [],
            message=result.get("message", ""))
        _emit(payload, bundle.render_verify(result), args.json)
        return int(result.get("exit_code", EXIT_RED))
    cfg = load_config(Path(args.project))
    result = bundle.run_bundle(
        cfg, runs_mode=getattr(args, "runs_mode", "signed"),
        out_dir=getattr(args, "out", None))
    payload = _payload(
        "bundle", "ok" if result.get("exit_code") == EXIT_OK else "red",
        result.get("exit_code", EXIT_RED),
        gate=result.get("gate") or [],
        bundle_dir=result.get("bundle_dir"),
        files=result.get("files") or [],
        listed_only=result.get("listed_only") or [],
        excluded=result.get("excluded") or [],
        manifest_lines=result.get("manifest_lines", 0),
        checklist=result.get("checklist") or {},
        closure=result.get("closure") or {},
        audit_exit=result.get("audit_exit"))
    _emit(payload, bundle.render_bundle(result), args.json)
    return int(result.get("exit_code", EXIT_RED))


def cmd_textreuse(args) -> int:
    """双目录字面重合检测（CARD-G6）：只读，零配置。

    用法错（目录不存在、n 越界、两侧同一目录）由 ConfigError 走 exit 2。
    """
    result = textreuse.scan(
        Path(args.dir_a), Path(args.dir_b),
        n=args.n, scales=textreuse.parse_scales(args.scales) if args.scales else None,
        min_tokens=args.min_tokens,
        exts=textreuse.parse_exts(args.ext),
        strip_comments=args.strip_comments,
        sentences=args.sentences,
        sentence_threshold=args.sentence_threshold,
        sentence_min_words=args.sentence_min_words,
        sentence_anchor_n=args.sentence_anchor_n)
    code = result.exit_code
    payload = _payload("textreuse",
                       "ok" if code == EXIT_OK else "violation", code,
                       summary=result.summary(),
                       dir_a=str(result.dir_a), dir_b=str(result.dir_b),
                       segments=textreuse.segment_dicts(result),
                       pairs=textreuse.pair_dicts(result),
                       boundary=result.boundary)
    _emit(payload, textreuse.render(result), args.json)
    return code


def cmd_refs_dedupe(args) -> int:
    """bib 跨条目查重（CARD-G1）：只读、离线。"""
    result = refs.dedupe(Path(args.project))
    code = result.exit_code
    payload = _payload("refs-dedupe",
                       "ok" if code == EXIT_OK else "violation", code,
                       summary=result.summary(),
                       findings=[g.as_dict() for g in result.groups],
                       issues=[g.as_dict() for g in result.groups],
                       without_unique_key=list(result.unkeyed))
    _emit(payload, refs.render_dedupe(result), args.json)
    return code


def cmd_refs_register(args) -> int:
    """待补文献登记表核对（CARD-G1）：只读。"""
    picked = None
    if args.pick is not None:
        picked, _result = refs.pick_from_latest(
            Path(args.project), args.pick,
            planned_key=args.key or "", section=args.section or "")
    result = refs.register(Path(args.project))
    code = result.exit_code
    findings = [f for entry in result.entries for f in entry.findings()]
    payload = _payload("refs-register",
                       "ok" if code == EXIT_OK else "violation", code,
                       summary=result.summary(),
                       findings=findings,
                       issues=findings,
                       entries=[e.as_dict() for e in result.entries])
    if picked:
        payload["picked"] = picked
    _emit(payload, refs.render_register(result), args.json)
    return code


def cmd_refs_search(args) -> int:
    """联网检索候选（CARD-G1）：唯一联网面；只发查询词。"""
    result = refs.search(args.query, Path(args.project),
                         source=args.source)
    if args.pick is not None:
        result.picked = refs.pick_candidate(
            result, args.pick, planned_key=args.key or "",
            section=args.section or "")
    code = result.exit_code
    payload = _payload("refs-search", "ok", code,
                       summary=result.summary(),
                       candidates=[c.as_dict() for c in result.candidates])
    if result.picked:
        payload["picked"] = result.picked
    _emit(payload, refs.render_search(result), args.json)
    return code


def cmd_refs(args) -> int:
    """文献登记面命令族（CARD-G1）。"""
    if args.refs_action == "dedupe":
        return cmd_refs_dedupe(args)
    if args.refs_action == "register":
        return cmd_refs_register(args)
    return cmd_refs_search(args)


def cmd_audit(args) -> int:
    cfg = load_config(Path(args.project))
    # 批 130：audit 也把「本项目改过规则」摆在报告里（informational，
    # 不进 findings、不改退出码）。
    try:
        rule_report = project_rule_report(cfg.root)
    except ConfigError as exc:
        rule_report = {"present": True, "path": None, "source": "project",
                       "count": 0, "keys": [], "ignored": [],
                       "error": str(exc)}
    build = {"ran": False, "ok": True, "pdf_bytes": 0}
    if getattr(args, "build", False):
        bcode, bout, binfo = run_build_step(cfg, font_fallback=True)
        build = _build_block(cfg, bcode, binfo)
        if bcode != EXIT_OK:
            payload = _payload("audit", _severity_of(bcode), bcode,
                               build=build, build_output=bout)
            payload["config"] = _config_block(cfg)
            payload["config_warnings"] = list(cfg.warnings)
            _emit(payload, "== factscribe audit ==\n编译失败，审计中止（退出码 %d）\n%s"
                  % (bcode, bout), args.json)
            return bcode
    facts = load_facts(cfg)
    sections = load_sections(cfg)
    strict = getattr(args, "strict", False)
    resolve = getattr(args, "resolve", False)
    if getattr(cfg, "checks_defined", False):
        # [checks] 节在场即走核验槽（裁定③，2026-11-16）：显式点名 packages
        # 按点名跑；节存在但省 packages ⇒ 默认 ["paper"]（仍走槽，输出带
        # domain 键与 by_domain——只增键，报告其余逐条相同）。
        # 无 [checks] 节才直跑：宪法承诺「无节＝逐字节不变」（SPEC-CHECKS §5.2）。
        red, yellow, hints, summary, unresolved = run_packages(
            cfg, facts, sections, resolve=resolve)
        code = checks_aggregate_exit(red, yellow, strict,
                                     integrity_first=cfg.is_v3)
        # 域序＝点名序（by_domain 按包迭代序插入，dict 保序）；裸节默认
        # paper 时即 ["paper"]。走到这说明全部已注册（未注册在 resolve 即 exit 2）。
        domains = list((summary or {}).get("by_domain", {}))
        if any(d != "paper" for d in domains):
            # 多域：人读报告按域分节（paper 节在前，其余域按点名序在后）；
            # 结论行红黄计数是跨域合并数（与折算同口径）。单 paper 点名
            # 保持 M1 版式不变。
            text = _human_audit_domains(cfg, red, yellow, hints, summary,
                                        unresolved, code, domains)
        else:
            text = _human_audit(cfg, red, yellow, hints, summary, unresolved, code)
    else:
        # 无 [checks] 节：宪法保证——行为与槽引入前逐字节一致（SPEC-CHECKS
        # §5.2；[budget]/[evidence] 先例口径）。裁定③后裸节不再走此路。
        red, yellow, hints, summary, unresolved = run_audit(
            cfg, facts, sections, resolve=resolve)
        code = _aggregate_exit(red, yellow, strict, integrity_first=cfg.is_v3)
        text = _human_audit(cfg, red, yellow, hints, summary, unresolved, code)
    if rule_report.get("present"):
        keys = list(rule_report.get("keys") or [])
        if keys:
            text += ("\n覆盖    : 本项目覆盖了 %d 个规则键：%s"
                     % (len(keys), "、".join(keys)))
        else:
            text += "\n覆盖    : 本项目覆盖了 0 个规则键（与内置默认一致）"
    if rule_report.get("ignored"):
        text += ("\n规则告警：RULES_OVERRIDE_IGNORED（%s 只允许命令行控制，"
                 "已忽略）" % "、".join(rule_report["ignored"]))
    if build["ran"]:
        text += "\nbuild  : 已编译（%d 字节）" % build["pdf_bytes"]
    if cfg.warnings:
        text += "\n配置告警：%d 条（--json 的 config.warnings 有明细）" % len(cfg.warnings)
    # --lang：只影响 JSON 里的 findings 文案。**不给就是现在的样子**
    # （金样例 tests/golden/audit_findings_baseline.json 逐字节锁着这条路的
    # 四个数组，所以默认路径一个字都不许动）。
    lang = str(getattr(args, "lang", "") or "")
    if lang:
        findings = ([issue_dict(i, lang) for i in red]
                    + [issue_dict(w, lang) for w in yellow])
        issues = [issue_dict(i, lang) for i in red]
        warnings = [issue_dict(w, lang) for w in yellow]
        hint_items = [issue_dict(h, lang) for h in hints]
    else:
        findings = [i.as_dict() for i in red] + [w.as_dict() for w in yellow]
        issues = [i.as_dict() for i in red]
        warnings = [i.as_dict() for i in yellow]
        hint_items = [h.as_dict() for h in hints]
    payload = _payload("audit", _severity_of(code), code,
                       summary=summary,
                       findings=findings,
                       issues=issues,
                       warnings=warnings,
                       hints=hint_items,
                       coverage=summary.get("coverage", {}),
                       resolved=unresolved,
                       build=build,
                       rule_overrides=rule_report)
    payload["config"] = _config_block(cfg)
    payload["config_warnings"] = list(cfg.warnings)
    _emit(payload, text, args.json)
    return code


def cmd_verify_pdf(args) -> int:
    build = {"ran": False, "ok": True, "pdf_bytes": 0}
    if getattr(args, "build", False):
        project = Path(args.project) if args.project else Path(args.pdf).parent
        cfg = load_config(project)
        bcode, bout, binfo = run_build_step(cfg, font_fallback=True)
        build = _build_block(cfg, bcode, binfo)
        if bcode != EXIT_OK:
            payload = _payload("verify-pdf", _severity_of(bcode), bcode,
                               build=build, build_output=bout)
            _emit(payload, "", True)
            return bcode
    stats: dict = {}
    issues, warnings, code = verify_pdf(
        Path(args.pdf), Path(args.report),
        Path(args.stamp) if args.stamp else None,
        Path(args.keys) if args.keys else None,
        stats=stats)
    masked = int(stats.get("structural_masked", 0))
    by_cat = stats.get("structural_masked_by", {})
    human = ("== factscribe verify-pdf ==\n%s\n结构性 token 掩掉 %d 个（%s）\n"
             "红：%d   黄：%d   退出码：%d" % (
                 args.pdf, masked,
                 "、".join("%s %d" % (k, v) for k, v in by_cat.items()) or "无",
                 len(issues), len(warnings), code))
    payload = _payload("verify-pdf", _severity_of(code), code,
                       issues=[i.as_dict() for i in issues],
                       warnings=[w.as_dict() for w in warnings],
                       structural_masked=masked,
                       structural_masked_by=by_cat,
                       build=build)
    _emit(payload, human, True)
    return code


def cmd_matrix(args) -> int:
    cfg = load_config(Path(args.project))
    facts = load_facts(cfg)
    sections = load_sections(cfg)
    text, rows = render_matrix(cfg, facts, sections)
    out = Path(args.out) if getattr(args, "out", None) else cfg.root / "audit" / "matrix.md"
    if not getattr(args, "out", None):
        # 写侧落点闸：默认落点（项目内 audit/）必须留在项目根内。
        guard_project_write(cfg.root, out, what="矩阵产物", rel="audit/matrix.md")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    human = "== factscribe matrix ==\n写盘：%s\n行数：%d（每行一条 fact）\n%s" % (
        out, len(rows), text)
    payload = _payload("matrix", "ok", EXIT_OK, path=str(out), rows=rows,
                       facts=len(rows))
    payload["config"] = _config_block(cfg)
    payload["config_warnings"] = list(cfg.warnings)
    _emit(payload, human, args.json)
    return EXIT_OK


def cmd_preamble(args) -> int:
    cfg = load_config(Path(args.project))
    out = Path(args.out) if getattr(args, "out", None) else cfg.root / "audit" / "preamble.tex"
    if not getattr(args, "out", None):
        # 写侧落点闸：默认落点（项目内 audit/）必须留在项目根内。
        guard_project_write(cfg.root, out, what="前言产物", rel="audit/preamble.tex")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(PREAMBLE_TEXT, encoding="utf-8")
    human = "== factscribe preamble ==\n写盘：%s\n%s" % (out, PREAMBLE_TEXT)
    payload = _payload("preamble", "ok", EXIT_OK, path=str(out))
    payload["config"] = _config_block(cfg)
    payload["config_warnings"] = list(cfg.warnings)
    _emit(payload, human, args.json)
    return EXIT_OK


def cmd_fonts(args) -> int:
    if args.status:
        info = font_status()
        payload = _payload("fonts", "ok", EXIT_OK, action="status", **info)
        _emit(payload, render_fonts_status(info), args.json)
        return EXIT_OK
    try:
        info = fetch_fandol(url=args.url, force=args.force)
    except FontCacheError as exc:
        payload = _payload("fonts", "error", EXIT_INTERNAL,
                           action="fetch", message=str(exc))
        _emit(payload, "== factscribe fonts ==\n%s" % exc, args.json)
        return EXIT_INTERNAL
    payload = _payload("fonts", "ok", EXIT_OK, action="fetch", **info)
    _emit(payload, render_fonts_fetch(info), args.json)
    return EXIT_OK


def cmd_build(args) -> int:
    cfg = load_config(Path(args.project))
    code, out, info = run_build_step(
        cfg, engine=args.engine, cjk_font=args.cjk_font,
        keep_temp=args.keep_temp, font_fallback=True)
    payload = _payload("build", "ok" if code == EXIT_OK else "violation", code,
                       build=cfg.build, output=out)
    payload.update(info)
    payload["config"] = _config_block(cfg)
    payload["config_warnings"] = list(cfg.warnings)
    _emit(payload, "== factscribe build ==\n" + out, args.json)
    return code


def _cmd_style_doc(args, paths: list[str]) -> int:
    """``style --doc``：文档模式，不读项目配置，按扩展名分派解析器。"""
    if args.project is not None:
        raise ConfigError("--doc 与项目目录不能同时给出：doc 模式不需要 "
                          "factscribe.toml；项目模式请去掉 --doc")
    if getattr(args, "diff", None):
        raise ConfigError("--doc 不支持 --diff：改写前目录属于项目形态")
    root = Path.cwd()
    sections = []
    formats = {}
    for raw in paths:
        path = Path(raw)
        if not path.is_file():
            raise ConfigError("--doc 指向的 %s 不存在" % raw)
        sections.append((raw, to_lf(read_text_exact(path))))
        formats[raw] = mdscan.format_of(raw)
    rules_info = load_style_rules_info(root, args.rules)
    cfg = Config(root=root)
    result = analyze(cfg, sections, rules_info.rules,
                     rules_path=rules_info.path,
                     report_unregistered=bool(args.report_unregistered),
                     report_abbrev=bool(args.report_abbrev),
                     formats=formats, stage=args.stage,
                     rule_report=rules_info.report)
    code = result.exit_code

    if args.prompt and not args.json:
        print(build_prompt(result))
        return code

    human = render_human(result, root)
    human += "\n文档模式：%d 个文件（%s）" % (
        len(sections), "、".join(formats.get(p, "text") for p in paths))
    # --lang：findings 的文案语言。**只增键**——message_key / params 始终
    # 给出，message 按 lang 渲染（不给＝中文原话）。
    lang = str(getattr(args, "lang", "") or "zh")
    style_findings = [style_finding_dict(f, lang) for f in result.findings]
    style_info = [style_finding_dict(f, lang)
                    for f in getattr(result, "info", [])]
    style_advisories = [style_finding_dict(f, lang)
                         for f in getattr(result, "advisories", [])]
    payload = _payload("style", _severity_of(code), code,
                       metrics=result.metrics,
                       thresholds=dict(result.thresholds),
                       findings=style_findings,
                       info=style_info,
                       advisories=style_advisories,
                       paragraphs=[p.as_dict() for p in result.paragraphs],
                       fired=result.fired,
                       summary=result.summary,
                       stage_assessment=dict(result.stage_assessment),
                       metric_details=dict(result.metric_details),
                       disclaimer=DISCLAIMER,
                       rules=rules_info.path,
                       rule_overrides=dict(result.rule_overrides),
                       rule_warnings=list(result.rule_warnings),
                       stage=result.stage,
                       mode="doc",
                       documents=[{"file": raw, "format": formats.get(raw, "text")}
                                  for raw in paths])
    if args.prompt:
        payload["prompt"] = build_prompt(result)
    payload["config"] = _config_block(cfg)
    payload["config_warnings"] = list(cfg.warnings)
    _emit(payload, human, args.json)
    return code


def cmd_style(args) -> int:
    doc_paths = [p for group in (args.doc or []) for p in group]
    if doc_paths:
        return _cmd_style_doc(args, doc_paths)
    cfg = load_config(Path(args.project or "."))
    sections = load_sections(cfg)
    rules_info = load_style_rules_info(cfg.root, args.rules)
    before = None
    baseline = None
    if getattr(args, "diff", None):
        before_cfg = load_config(Path(args.diff))
        before_sections = load_sections(before_cfg)
        before = (before_cfg, before_sections)
    result = analyze(cfg, sections, rules_info.rules,
                     rules_path=rules_info.path, before=before,
                     report_unregistered=bool(args.report_unregistered),
                     report_abbrev=bool(args.report_abbrev),
                     stage=args.stage, rule_report=rules_info.report)
    if before is not None:
        baseline = analyze(before[0], before[1], rules_info.rules,
                           rules_path=rules_info.path, stage=args.stage,
                           rule_report=rules_info.report)
        result = filter_new_findings(result, baseline)
    code = result.exit_code

    if args.prompt and not args.json:
        print(build_prompt(result))
        return code

    human = render_human(result, cfg.root)
    if before is not None:
        human += ("\n对比    : %s（改前 %d 处 → 只报新增 %d 处）"
                  % (Path(args.diff), len(baseline.findings),
                     len(result.findings)))
    if cfg.warnings:
        human += "\n配置告警：%d 条（--json 的 config.warnings 有明细）" % len(cfg.warnings)
    # --lang：findings 的文案语言。**只增键**——message_key / params 始终
    # 给出，message 按 lang 渲染（不给＝中文原话）。
    lang = str(getattr(args, "lang", "") or "zh")
    style_findings = [style_finding_dict(f, lang) for f in result.findings]
    style_info = [style_finding_dict(f, lang)
                    for f in getattr(result, "info", [])]
    style_advisories = [style_finding_dict(f, lang)
                         for f in getattr(result, "advisories", [])]
    payload = _payload("style", _severity_of(code), code,
                       metrics=result.metrics,
                       thresholds=dict(result.thresholds),
                       findings=style_findings,
                       info=style_info,
                       advisories=style_advisories,
                       paragraphs=[p.as_dict() for p in result.paragraphs],
                       fired=result.fired,
                       summary=result.summary,
                       stage_assessment=dict(result.stage_assessment),
                       metric_details=dict(result.metric_details),
                       disclaimer=DISCLAIMER,
                       rules=rules_info.path,
                       rule_overrides=dict(result.rule_overrides),
                       rule_warnings=list(result.rule_warnings),
                       stage=result.stage)
    if before is not None:
        payload["diff"] = {"before": str(Path(args.diff)),
                           "baseline_findings": len(baseline.findings),
                           "new_findings": len(result.findings)}
    if args.prompt:
        payload["prompt"] = build_prompt(result)
    payload["config"] = _config_block(cfg)
    payload["config_warnings"] = list(cfg.warnings)
    _emit(payload, human, args.json)
    return code


def cmd_protect(args) -> int:
    result = compare_protect(Path(args.before), Path(args.after),
                             allow_renames=args.allow_renames)
    code = result.exit_code
    payload = _payload("protect", _severity_of(code), code,
                       before=str(result.before), after=str(result.after),
                       allow_renames=bool(result.allow_renames),
                       summary=result.summary(),
                       findings=[f.as_dict() for f in result.findings])
    _emit(payload, render_protect(result), args.json)
    return code


def cmd_tide(args) -> int:
    """四种模式：比对 / 纯存快照 / 先判闭合再存快照 / 快照恢复。"""
    if args.restore:
        return _tide_restore(args)
    if args.into:
        raise ConfigError("--into 只能与 --restore 一起使用")
    # 批 109：--before/--after/--snapshot 三者同给＝先判闭合，闭合才存快照。
    if args.before and args.after and args.snapshot:
        return _tide_compare_and_snapshot(args)
    if args.snapshot or (args.after and not args.before):
        return _tide_snapshot(args)
    return _tide_compare(args)


def _tide_payload(result, mode: str = "compare") -> dict:
    payload = _payload("tide", "ok" if result.exit_code == EXIT_OK
                       else "violation", result.exit_code,
                       mode=mode, tx=result.tx,
                       criteria=result.criteria(),
                       reasons=list(result.reasons),
                       rises=[r.as_dict() for r in result.rises],
                       falls=[f.as_dict() for f in result.falls],
                       affect=list(result.affect),
                       findings=[f.as_dict() for f in result.findings],
                       ledger=str(result.ledger_path),
                       view=(str(result.view_path)
                             if result.view_written else None),
                       ignored=list(result.ignored),
                       ignore=list(result.ignore),
                       events=len(result.rises) + len(result.falls) + 1)
    payload["status"] = result.status      # 事务状态：commit / rollback
    return payload


def _tide_compare(args) -> int:
    if not args.before or not args.after:
        raise ConfigError("比对模式需要 --before 与 --after")
    result = run_tide(Path(args.before), Path(args.after),
                      Path(args.out) if args.out else None,
                      ignore=args.ignore,
                      default_ignore=not args.no_default_ignore)
    code = result.exit_code
    _emit(_tide_payload(result), render_tide(result), args.json)
    return code


def _tide_compare_and_snapshot(args) -> int:
    """批 109：先判闭合，闭合才存快照；不闭合整次失败，不落快照。"""
    if not args.before or not args.after:
        raise ConfigError("闭合＋快照模式需要 --before 与 --after")
    result = run_tide(Path(args.before), Path(args.after),
                      Path(args.out) if args.out else None,
                      ignore=args.ignore,
                      default_ignore=not args.no_default_ignore)
    if not result.closed:
        payload = _tide_payload(result, mode="compare-snapshot")
        payload["snapshot_saved"] = False
        payload["snapshot"] = None
        human = (render_tide(result)
                 + "\n未保存快照：闭合判定未通过（不落快照、不落账）。")
        _emit(payload, human, args.json)
        return EXIT_RED

    snap = save_snapshot(Path(args.after),
                         Path(args.snapshot) if args.snapshot else None,
                         ignore=args.ignore,
                         default_ignore=not args.no_default_ignore)
    payload = _tide_payload(result, mode="compare-snapshot")
    payload.update({
        "snapshot_saved": True,
        "snapshot_id": snap.snapshot_id,
        "snapshot": snap.short,
        "files": snap.files,
        "bytes": snap.bytes,
        "blobs_new": snap.blobs_new,
        "blobs_shared": snap.blobs_shared,
        "store": str(snap.store),
        "manifest": str(snap.manifest_path),
    })
    human = render_tide(result) + "\n" + render_tide_snapshot(snap)
    _emit(payload, human, args.json)
    return EXIT_OK


def _tide_snapshot(args) -> int:
    if not args.after:
        raise ConfigError("快照保存需要 --after（要快照的目录）")
    result = save_snapshot(Path(args.after),
                           Path(args.snapshot) if args.snapshot else None,
                           ignore=args.ignore,
                           default_ignore=not args.no_default_ignore)
    payload = _payload("tide", "ok", EXIT_OK, mode="snapshot",
                       snapshot_id=result.snapshot_id,
                       snapshot=result.short, ok=True,
                       files=result.files, bytes=result.bytes,
                       blobs_new=result.blobs_new,
                       blobs_shared=result.blobs_shared,
                       store=str(result.store),
                       manifest=str(result.manifest_path),
                       ignored=list(result.ignored),
                       ignore=list(result.ignore),
                       closure_checked=False,
                       notice="未做闭合判定（未给 --before；纯存快照）")
    human = render_tide_snapshot(result)
    if not args.before:
        human += "\n说明：未给 --before，本趟是纯存快照，未做闭合判定。"
    _emit(payload, human, args.json)
    return EXIT_OK


def _tide_restore(args) -> int:
    if args.before or args.after:
        raise ConfigError("--restore 不能与 --before/--after 同时使用")
    if not args.into:
        raise ConfigError("快照恢复需要 --into（还原到哪个目录）")
    result = restore_snapshot(
        Path(args.snapshot) if args.snapshot else Path(DEFAULT_SNAPSHOT_ROOT),
        args.restore, Path(args.into))
    code = result.exit_code
    payload = _payload("tide", "ok" if code == EXIT_OK else "violation", code,
                       mode="restore", snapshot_id=result.snapshot_id,
                       snapshot=result.short, ok=result.ok,
                       files=result.files, bytes=result.bytes,
                       verified=result.verified, written=result.written,
                       reasons=list(result.reasons),
                       into=str(result.into), store=str(result.store))
    _emit(payload, render_tide_restore(result), args.json)
    return code


def cmd_review(args) -> int:
    """改写验收：一次跑保护面、复检、闭合三项，合成一个 final verdict。"""
    result = run_review(
        Path(args.before), Path(args.after),
        allow_new=args.allow_new,
        snapshot=Path(args.snapshot) if args.snapshot else None)
    code = result.exit_code
    data = _payload("review", _severity_of(code), code, **review_payload(result))
    _emit(data, render_review(result), args.json)
    return code


def _write_stdout(text: str) -> int:
    """写 stdout；下游提前关闭（如 ``| head``）时安静退出，不报内部错误。"""
    try:
        sys.stdout.write(text)
        sys.stdout.flush()
    except BrokenPipeError:
        devnull = os.open(os.devnull, os.O_WRONLY)
        os.dup2(devnull, sys.stdout.fileno())
    return EXIT_OK


def cmd_polish(args) -> int:
    """润色工单：手册或工作单。不是闸门，成功永远 EXIT_OK。"""
    if args.print_playbook:
        return _write_stdout(playbook_text())
    plan = build_plan(Path(args.plan))
    data = _payload("polish", "ok", EXIT_OK, **plan_payload(plan))
    _emit(data, render_plan(plan), args.json)
    return EXIT_OK


def cmd_brief(args) -> int:
    """写作简报：只读账、只出 Markdown；成功永远 EXIT_OK。"""
    brief = build_brief(Path(args.project), section=args.section)
    text = render_brief(brief)
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text if text.endswith("\n") else text + "\n",
                       encoding="utf-8")
        if not args.json:
            print("简报已写入 %s" % args.out, file=sys.stderr)
            return EXIT_OK
    data = _payload("brief", "ok", EXIT_OK, **brief_payload(brief))
    _emit(data, text, args.json)
    return EXIT_OK


def cmd_prescribe(args) -> int:
    """处方层：只输出处方原文或清单；成功永远 EXIT_OK，不产生 findings。"""
    prescriptions = load_prescriptions()
    names = list(getattr(args, "names", None) or [])
    for_code = (getattr(args, "for_code", None) or "").strip().upper()

    if args.list and (names or for_code):
        raise ConfigError("--list 不能与处方名或 --for 同时使用")
    if for_code and names:
        raise ConfigError("--for 不能与处方名同时使用")

    if args.list:
        ordered = sorted(prescriptions.values(),
                         key=lambda p: (p.level_number, p.name))
        payload = _payload(
            "prescribe", "ok", EXIT_OK,
            prescriptions=[p.as_dict(include_text=False) for p in ordered],
            priority=priority_payload(),
            conflicts=[], suppressed={}, note=NOTE)
        lines = ["== factscribe prescribe ==",
                 "处方：%d 条（只给改法；不参与判据、不产生分数）"
                 % len(ordered), ""]
        for p in ordered:
            lines.append("%-22s 优先 %d %-8s %s"
                         % (p.name, p.level_number, p.level_label,
                            "、".join(p.target_codes)))
        _emit(payload, "\n".join(lines), args.json)
        return EXIT_OK

    if for_code:
        matched = prescriptions_for(for_code, prescriptions)
        resolution = resolve_conflicts([p.name for p in matched],
                                       prescriptions)
        payload = _payload(
            "prescribe", "ok", EXIT_OK,
            for_code=for_code,
            prescriptions=[p.as_dict() for p in matched],
            conflicts=resolution["conflicts"],
            suppressed=resolution["suppressed"], note=NOTE)
        if args.json:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        elif not matched:
            print("没有处方治 %s（处方层不处理该码）" % for_code)
        else:
            print(render_bundle([p.name for p in matched], prescriptions))
        return EXIT_OK

    if not names:
        raise ConfigError(
            "prescribe 需要处方名、--list 或 --for <错误码>"
            "（例：factscribe prescribe heading-shorten）")
    unknown = [n for n in names if n not in prescriptions]
    if unknown:
        raise ConfigError(
            "没有处方 %s；可用：%s"
            % ("、".join(repr(n) for n in unknown),
               "、".join(sorted(prescriptions))))

    if len(names) == 1 and not args.json:
        print(prescriptions[names[0]].text.rstrip())
        return EXIT_OK

    resolution = resolve_conflicts(names, prescriptions)
    if args.json:
        payload = _payload(
            "prescribe", "ok", EXIT_OK,
            prescriptions=[prescriptions[n].as_dict()
                           for n in resolution["order"]],
            conflicts=resolution["conflicts"],
            suppressed=resolution["suppressed"], note=NOTE)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(render_bundle(names, prescriptions))
    return EXIT_OK


def cmd_terms(args) -> int:
    """术语候选抽取 / 人工入表。零 LLM；不自动写词表。"""
    if args.terms_action == "suggest":
        rows = suggest(args.root, min_count=args.min_count,
                       min_sections=args.min_sections,
                       glossary_path=args.glossary)
        text = render_tsv(rows)
        out = Path(args.out) if args.out else None
        if out is not None:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(text, encoding="utf-8")
        if args.json:
            print(json.dumps(
                json_payload(rows, args.root, args.min_count,
                             args.min_sections),
                ensure_ascii=False, indent=2))
            return EXIT_OK
        lines = ["== factscribe terms suggest ==",
                 "根：%s" % args.root,
                 "候选：%d 条（min-count=%d，min-sections=%d）"
                 % (len(rows), args.min_count, args.min_sections)]
        if out is not None:
            lines.append("写盘：%s" % out)
        print("\n".join(lines))
        print(text, end="")
        return EXIT_OK

    info = add_from_tsv(args.from_path, args.pick,
                        glossary_path=args.glossary)
    if args.json:
        payload = _payload("terms", "ok", EXIT_OK, **info)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return EXIT_OK
    lines = ["== factscribe terms add ==",
             "词表：%s" % info["glossary"],
             "来源：%s" % info["source"],
             "新增：%d 条%s" % (len(info["added"]),
                              ("（%s）" % "、".join(info["added"]))
                              if info["added"] else ""),
             "跳过：%d 条" % len(info["skipped"])]
    for item in info["skipped"]:
        lines.append("  - %s：%s" % (item["surface"], item["reason"]))
    print("\n".join(lines))
    return EXIT_OK


def cmd_evidence(args) -> int:
    """证据清单：--suggest 出 TOML，--freeze/--unfreeze 冻结与解冻。"""
    if args.suggest is not None:
        cfg = load_config(Path(args.suggest))
        sections = load_sections(cfg)
        mapping = suggest_evidence(sections)
        text = render_toml(mapping)
        note = suggest_summary(len(sections), mapping)
        if args.json:
            payload = _payload(
                "evidence", "ok", EXIT_OK, action="suggest",
                scanned=len(sections), sections_with_facts=len(mapping),
                sections=[{"section": key, "ids": list(ids)}
                          for key, ids in mapping.items()],
                facts=sum(len(ids) for ids in mapping.values()),
                summary=note, toml=text)
            _emit(payload, "", True)
            return EXIT_OK
        # stdout 只有 TOML：摘要一律走 stderr，保证重定向产物可直接粘配置
        sys.stdout.write(text)
        sys.stdout.flush()
        print(note, file=sys.stderr)
        return EXIT_OK

    if args.unfreeze is not None:
        cfg = load_config(Path(args.unfreeze))
        info = unfreeze_evidence(cfg.root, args.reason, args.at)
        if args.json:
            payload = _payload("evidence", "ok", EXIT_OK, **info)
            _emit(payload, "", True)
            return EXIT_OK
        if info["idempotent"]:
            lines = ["== factscribe evidence unfreeze ==",
                     "已处于解冻状态，不重复写记录。",
                     "理由：%s" % info["reason"],
                     "hash_before：%s" % info["hash_before"]]
        else:
            lines = ["== factscribe evidence unfreeze ==",
                     "写盘：%s" % info["path"],
                     "理由：%s" % info["reason"],
                     "hash_before：%s" % info["hash_before"],
                     "at：%s" % (info["at"] or "（空，由人补）"),
                     "下一步：改清单 → evidence --freeze --reason \"...\""]
        print("\n".join(lines))
        return EXIT_OK

    cfg = load_config(Path(args.freeze))
    info = freeze_evidence(cfg.root,
                           dict(getattr(cfg, "evidence_sections", {}) or {}),
                           args.reason)
    if args.json:
        payload = _payload("evidence", "ok", EXIT_OK, action="freeze", **info)
        _emit(payload, "", True)
        return EXIT_OK
    if info["idempotent"]:
        lines = ["== factscribe evidence freeze ==",
                 "已冻结且哈希未变：幂等，不重复写记录。",
                 "canonical_sha256：%s" % info["sha256"],
                 "entries：%d" % info["entries"]]
    else:
        lines = ["== factscribe evidence freeze ==",
                 "写盘：%s" % info["path"],
                 "canonical_sha256：%s" % info["sha256"],
                 "entries：%d" % info["entries"],
                 "理由：%s" % (info["reason"] or "（未写）"),
                 "说明：清单可由人或 LLM 提出；冻结是机械动作，改动须重新冻结。"]
    print("\n".join(lines))
    return EXIT_OK


def main(argv=None) -> int:
    # 非 UTF-8 控制台（中文 Windows 的 cp936/gbk）上，人读输出里的装饰字符
    # 编不出来 → UnicodeEncodeError → 命令退成 exit 4（工具内部错误）。
    # 这里在入口把 stdout/stderr 装上「安全降级」的编码错误处理器：
    # 编不出来的字符换同义 ASCII，命令照常跑完、退出码照旧。
    safe_stdio()
    try:
        args = build_parser().parse_args(argv)
    except SystemExit as exc:
        # argparse 的用法错自带退出码 2；这里转成返回值，别把异常抛给调用方。
        code = exc.code if isinstance(exc.code, int) else EXIT_CONFIG
        return code
    handlers = {"check": cmd_check, "audit": cmd_audit, "matrix": cmd_matrix,
                "mirror-check": cmd_mirror_check,
                "bundle": cmd_bundle,
                "textreuse": cmd_textreuse,
                "figures": cmd_figures,
                "refs": cmd_refs,
                "build": cmd_build, "preamble": cmd_preamble,
                "init": cmd_init, "fact": cmd_fact,
                "doctor": cmd_doctor,
                "serve": cmd_serve,
                "workbench": cmd_workbench,
                "mcp": cmd_mcp,
                "report": cmd_report,
                "verify-pdf": cmd_verify_pdf, "style": cmd_style,
                "protect": cmd_protect, "tide": cmd_tide,
                "review": cmd_review,
                "polish": cmd_polish,
                "brief": cmd_brief,
                "prescribe": cmd_prescribe, "terms": cmd_terms,
                "evidence": cmd_evidence,
                "fonts": cmd_fonts}
    try:
        return handlers[args.command](args)
    except ConfigError as exc:
        code = getattr(exc, "code", "CONFIG_INVALID")
        # 写盘被拒的码自带退出码（事实账越界＝信任链失败 exit 5）；
        # 其它配置/用法错仍是 exit 2。severity 与 exit 都按码走，不改既有码。
        exit_code = getattr(exc, "exit_code", EXIT_CONFIG)
        if getattr(args, "json", False):
            payload = _payload(args.command, "error", exit_code,
                               message=str(exc))
            payload["code"] = code
            # §8：CONFIG 类码也必须出现在 findings/issues 里，判卷器不用
            # 猜顶层 code 字段。唯一映射：一个错误一个码。
            finding = {"severity": "red", "code": code, "message": str(exc)}
            payload["findings"] = [finding]
            payload["issues"] = [finding]
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        else:
            label = ("配置/用法错" if exit_code == EXIT_CONFIG
                     else "信任链失败")
            print("factscribe: %s：%s" % (label, exc), file=sys.stderr)
        return exit_code
    except Exception as exc:  # noqa: BLE001 - 内部错误必须与「有违例」分开
        if getattr(args, "json", False):
            print(json.dumps(_payload(args.command, "error", EXIT_INTERNAL,
                                      message="%s: %s" % (type(exc).__name__, exc)),
                             ensure_ascii=False, indent=2))
        else:
            print("factscribe: 工具内部错误：%s: %s" % (type(exc).__name__, exc),
                  file=sys.stderr)
        return EXIT_INTERNAL


if __name__ == "__main__":
    sys.exit(main())
