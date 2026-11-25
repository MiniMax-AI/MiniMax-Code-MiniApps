# -*- coding: utf-8 -*-
"""落点解析：写盘前把「真实写到哪儿」判清楚。

**为什么有它**（D1，Windows 真机 2026-11-25 实测）：

写侧闸要回答两个问题：这个路径能不能解析（落点解不解得出来）？解析出来的
落点还在盘根里面吗？答不上来的时候，引擎**不许裸崩**。

本条 miniapp 线上的引擎没有主仓那套写侧落点闸（那是主仓 PR #56 才加的，
本线还没有），所以这里只收口「落点解析」这一件事：

* 落点**解不出来**（软链成环是最常见的一种）→ 判成不可解 → 拒写，带着
  调用点**自己已有的那个判定码**出去，不许裸崩成「工具内部错误」（exit 4）；
* 落点解出来了但**不在盘根里面** → 同样是拒写（各调用点的原话不动）。

**判据取语义，不取 errno 白名单**：各平台写 errno 的口径不一样——
Windows 真机实测，软链成环时 `os.path.realpath(strict=True)` 抛的是
`OSError(winerror=1921 ERROR_CANT_RESOLVE_FILENAME, errno=22 EINVAL)`，
不是 POSIX 的 `ELOOP`（Windows 的 `errno.ELOOP` 常量是 10062，跟这里收到的
errno 不是一回事）。拿某个 errno 常量当白名单，必然在某个平台上漏判 →
裸崩 → exit 4。所以这里按「解不出来就是解不出来」判。

**为什么用 `os.path.realpath` 而不是 `pathlib.Path.resolve()`**：后者在软链
成环时 3.10–3.12 抛 `RuntimeError`、3.13+ 干脆不抛（跨版本读数会漂）。
`os.path.realpath(strict=True)` 各版本一个样：解不出来就抛错。
"""
from __future__ import annotations

import errno
import os
from pathlib import Path

from .config import ConfigError

__all__ = ["landing_point", "resolve_landing", "unresolved_reason"]

# Windows 真机实测（2026-11-25）：软链成环时
# `os.path.realpath(strict=True)` 抛的是
# `OSError(winerror=1921 ERROR_CANT_RESOLVE_FILENAME, errno=22 EINVAL)`，
# 不是 POSIX 的 `ELOOP`（Windows 的 `errno.ELOOP` 常量是 10062，跟这里收到的
# errno 不是一回事）。断链则是 `errno=ENOENT`（winerror=2）。
# 这个常量只用来判「文案上要不要直说是成环」，判定本身不依赖它。
_WINERROR_CANT_RESOLVE_FILENAME = 1921


def _real(path: Path | str) -> str:
    """真实路径。

    存在（含软链）→ 解析后的真实目标；不存在（还没建、或是断链）→ 按
    strict=False 尽力解析（断链给出「本来要写到哪」）。解不出来（成环等）→
    抛 OSError，由调用方判「不可解」。

    errno 口径各平台不同（成环：POSIX 是 `ELOOP`，Windows 是
    `winerror=1921` + `errno=EINVAL`），所以这里只负责把错误**抛出去**，
    「算不算不可解」由调用方按语义判（见 `unresolved_reason`）。
    """
    try:
        return os.path.realpath(str(path), strict=True)
    except OSError as exc:
        if exc.errno == errno.ENOENT:
            return os.path.realpath(str(path), strict=False)
        raise


def landing_point(target: Path | str) -> str:
    """写入落点的真实位置（绝对路径字符串）。

    落点还不存在时看它爹目录的真实位置——目录是软链的话，新文件就落在
    软链那边（可能是项目外）。
    """
    path = Path(target)
    if not os.path.lexists(str(path)):
        parent = Path(path).parent
        return os.path.join(_real(parent), path.name)
    return _real(path)


def _is_cycle(exc: OSError) -> bool:
    """这次失败是不是「软链成环」（文案用；判定不依赖它）。"""
    if getattr(exc, "winerror", None) == _WINERROR_CANT_RESOLVE_FILENAME:
        return True
    return exc.errno == errno.ELOOP


def unresolved_reason(exc: OSError) -> str:
    """落点不可解的一句人话（为什么算不出来）。

    判据是**语义**：「strict realpath 解不出来」就是不可解——成环只是其中
    最常见的一种。能判出是成环就直说成环，判不出就说「算不出来」，不编原因。
    """
    if _is_cycle(exc):
        return "是成环软链，真实落点算不出来"
    detail = exc.strerror or str(exc)
    return "真实落点算不出来（%s）" % detail


def resolve_landing(target: Path | str, *, what: str, name: str,
                    code: str) -> Path:
    """解析落点（真实写到哪儿）；解不出来 → 拒写，不许裸崩。

    * `target`：要写的那个路径；
    * `what`：文案里的主语（「章节文件」/「根文件」/「章节」）；
    * `name`：给人看的那份路径名（调用方的相对名，原话用它）；
    * `code`：判定码——调用点**沿用它自己已有的那个码**，不新开。

    返回解析后的真实路径。解不出来时抛 `ConfigError`（带 `code`）。
    """
    try:
        return Path(landing_point(target))
    except OSError as exc:
        # 落点解不出来（成环等）＝ 不可解：判红、拒写。判据按语义
        # （解不出来就是不可解），不按 errno 白名单——Windows 上成环是
        # winerror=1921/errno=EINVAL，白名单判不到它，漏判就退成 exit 4
        # （工具内部错误），坏了退出码与判定码的契约。
        raise ConfigError("%s落点不可解：%s %s——拒绝写入（没有落盘）"
                          % (what, name, unresolved_reason(exc)),
                          code=code)
