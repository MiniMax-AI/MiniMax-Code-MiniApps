# -*- coding: utf-8 -*-
"""控制台输出：非 UTF-8 控制台上，人读输出不许把命令自己搞崩。

背景（Windows 真机实测，2026-11-25）：中文 Windows 的本地编码是
gbk/cp936（ACP=936，区域 zh-CN），**编不出**人读输出里的装饰字符
（`✓` / `✗` / `↔` …）。
`print()` 撞上就抛 `UnicodeEncodeError`，命令层把它当成
「工具内部错误」→ 退成 **exit 4**，而不是这条命令本来的判定码与退出码。
真机实测原话：

    > python -m factscribe doctor examples/minimal
    factscribe: 工具内部错误：UnicodeEncodeError: 'gbk' codec can't encode
    character '\\u2713' in position 113: illegal multibyte sequence
    （退出码 4）

修法（口径）：**降级的是字符，不是命令的判定**。

* 人读输出编不出来时，换成**同义的 ASCII**（`✓`→`v`、`✗`→`x`、`↔`→`<->`…），
  语义不丢（通过仍是「通过」、失败仍是「失败」，不改成问号——问号
  分不清这两者），命令照常跑完、退出码照旧。
* **编码不动**：流仍用它自己的编码（中文 Windows 上就是 cp936），
  所以重定向到文件的中文还是那个编码，外部读它的工具不用改。
* 结构化输出（`--json`）不受影响：载荷里没有编不出来的字符时，
  `--json` 的内容逐字节不变（仓内用例把这条锁住）。

macOS / Linux 的流本来就是 UTF-8，装上这套处理器**不改变任何一个字节**
（UTF-8 能编下所有字符，处理器根本不会被叫醒）。
"""
from __future__ import annotations

import codecs
import sys

# 编码错误处理器的名字（进程内唯一）。
ERROR_HANDLER = "factscribe.safe"

# 编不出来的字符 → 同义 ASCII。表里的每一项都是仓里真在用的字符：
# 扫 factscribe/ 全量，cp936 编不出来的装饰字符就这八个（另有几个
# 生僻汉字与一个落单代理字符，只在分词测试样本里，不会进人读输出）。
_ASCII_FALLBACK = {
    "✓": "v",     # U+2713 CHECK MARK —— 通过
    "✗": "x",     # U+2717 BALLOT X —— 失败
    "↔": "<->",   # U+2194 LEFT RIGHT ARROW
    "⇒": "=>",    # U+21D2 RIGHTWARDS DOUBLE ARROW
    "⊆": "<=",    # U+2286 SUBSET OF OR EQUAL TO
    "«": "<<",    # U+00AB
    "»": ">>",    # U+00BB
    "²": "^2",    # U+00B2
}


def _replace_handler(exc):
    """编码错误处理器：编不出来的字符换同义 ASCII，其余照旧。

    只处理「编码」方向的错（UnicodeEncodeError）；解码方向的错照旧抛
    出去（那是输入坏了，不该悄悄改）。
    """
    if not isinstance(exc, UnicodeEncodeError):
        raise exc
    chunk = exc.object[exc.start:exc.end]
    out = "".join(_ASCII_FALLBACK.get(ch, "?") for ch in chunk)
    return (out, exc.end)


def _register_handler() -> None:
    """注册处理器（进程内一次就够；重复注册同名会报错，所以先查）。"""
    try:
        codecs.lookup_error(ERROR_HANDLER)
    except LookupError:
        codecs.register_error(ERROR_HANDLER, _replace_handler)


def safe_stream(stream) -> bool:
    """给一个文本流装上「安全降级」的编码错误处理器。

    返回是否真的装了：流不是 `TextIOWrapper`（测试里常见的 StringIO、
    被换过的 stdout）或重配失败 → 返回 False，不抛。
    """
    reconfigure = getattr(stream, "reconfigure", None)
    if reconfigure is None:
        return False
    _register_handler()
    try:
        reconfigure(errors=ERROR_HANDLER)
    except (ValueError, OSError, LookupError):
        return False
    return True


def safe_stdio() -> None:
    """CLI 入口统一把 stdout/stderr 装上安全降级（幂等，可重复调用）。

    只换**错误处理器**，不换编码：流的编码是环境的事（中文 Windows 上
    就是 cp936），我们不替用户改；改的只是「编不出来时怎么办」。
    """
    for stream in (sys.stdout, sys.stderr):
        safe_stream(stream)
