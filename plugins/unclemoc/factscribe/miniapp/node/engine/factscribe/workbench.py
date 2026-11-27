# -*- coding: utf-8 -*-
"""节级工作台的**兼容层入口**（实现不在本文件）。

实现住在 `factscribe/workbench_dataplayer.py`——那是本仓把原来这份
`factscribe/workbench.py` 搬进段落级包同名的目录空间之后的新位置（
`factscribe/workbench/` 是段落级的包，与本文件同名；同名时 Python 优先
取包，所以 `from factscribe.workbench import ...` 走的是包的 `__getattr__`，
由它转发到数据层）。

本文件保留下来：main 的节级模块文件不丢、可查；它**不是**第二份实现——
下面全部转发到数据层。节级那套 HTTP 面（`PUT /api/sections` 等）在第 ④ 步
收口前保留，只做映射与转接，不改判定语义。

节级写入口（`write_section_data`）现已带两道闸：

* **指纹闸**（`expect_sha`）：客户端所基于的那一版正文与服务端现算的指纹
  对不上就拒写（`BLOCK_STALE`，HTTP 409）——这节在别处被改过，不许覆盖；
* **行尾还原**：按**落盘原文**逐行还原行尾（浏览器交回的正文恒是 LF，
  CRLF 稿存一次不该变成 LF）。
"""
from __future__ import annotations

from .workbench_dataplayer import *  # noqa: F401,F403
from .workbench_dataplayer import (  # noqa: F401  —— 公开名字原样再导出
    SectionError, add_fact_data, audit_data, brief_data,
    create_section_data, delete_section_data, evidence_status_data,
    freeze_evidence_data, project_data, rename_section_data, status_data,
    unfreeze_evidence_data, write_section_data,
)
