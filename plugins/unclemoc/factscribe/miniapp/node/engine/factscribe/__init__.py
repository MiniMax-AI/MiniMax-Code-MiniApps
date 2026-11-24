# -*- coding: utf-8 -*-
"""FactScribe—— 论文数字与引用的机械闸门。

包结构拆分后，本 `__init__` 把各子模块的名字原样再导出，保证
``import factscribe`` 与拆分前的单文件模块具有同一属性面（含下划线私有
名字，供测试与外部脚本使用）。
"""
from __future__ import annotations

import importlib as _importlib

__version__ = "1.1.0"

_MODULES = ("constants", "facts", "config", "texscan", "texrules",
            "citations", "audit", "pdfgate", "report", "style", "cli")

for _mod_name in _MODULES:
    _mod = _importlib.import_module("." + _mod_name, __name__)
    for _name in dir(_mod):
        if not _name.startswith("__"):
            globals()[_name] = getattr(_mod, _name)

__version__ = globals()["VERSION"]

del _importlib, _mod, _mod_name, _name, _MODULES
