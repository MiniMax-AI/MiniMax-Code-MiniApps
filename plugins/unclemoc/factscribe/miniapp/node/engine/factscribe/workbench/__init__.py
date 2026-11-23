# -*- coding: utf-8 -*-
"""factscribe 工作台（本地网页）：段一＝骨架与真数据只读面。

- `projects.py`：项目发现、盘聚合、章节轻量渲染（只读）。
- `server.py`：标准库 HTTP 服务，只提供 GET。
- `checkreport.py`：段三＝检查报告 / 机器视图的数据层（只读真闸读数）。
- `actions.py`：段五＝常用功能（渲染 PDF / 导出投稿包 / 打开项目目录）。
- `static/`：前端单页（结构移植自 workbench-redesign/prototype-v4.html）。

旧的 `serve` / `mcp` 数据层原封不动搬到了 `factscribe/workbench_dataplayer.py`
（改名前是 `factscribe/workbench.py`）。它与本包同名会互相遮蔽，所以搬了一层，
原来的公开名字从这里原样再导出——`from .workbench import SectionError` 之类
的既有 import 一行都不用改。
"""
from __future__ import annotations

import importlib as _importlib

__all__ = ["projects", "server"]

_DATA_LAYER = "factscribe.workbench_dataplayer"


def __getattr__(name):
    """把旧数据层的公开名字懒搬过来（PEP 562）。"""
    if name.startswith("__"):
        raise AttributeError(name)
    module = _importlib.import_module(_DATA_LAYER)
    try:
        value = getattr(module, name)
    except AttributeError:
        raise AttributeError("module %r has no attribute %r"
                             % (__name__, name)) from None
    globals()[name] = value
    return value


def __dir__():
    module = _importlib.import_module(_DATA_LAYER)
    return sorted(set(list(globals()) + dir(module)))
