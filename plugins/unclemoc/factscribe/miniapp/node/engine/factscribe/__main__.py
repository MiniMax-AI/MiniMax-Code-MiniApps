# -*- coding: utf-8 -*-
"""``python -m factscribe`` 入口：等价于拆分前的 ``python factscribe.py``。"""
from __future__ import annotations

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())
