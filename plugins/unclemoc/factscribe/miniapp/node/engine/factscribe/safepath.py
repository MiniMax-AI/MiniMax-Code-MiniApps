# -*- coding: utf-8 -*-
"""写盘落点闸：写入目标经软链解析后越出项目根 → 拒写（不落盘、不留半截）。

为什么写侧也要有闸：读侧已经守住「事实账的真实目标不得越出项目根」
（`FACT_FILE_OUTSIDE_PROJECT`，red / exit 5；读侧见
`fix/facts-symlink-outside-20261125`），但写侧此前没有对应的闸——
`fact add` 直接 `write_bytes`，账本文件是指向项目外的软链时，
写入就跟着软链落到项目外去了。本模块把同一条信任根规则用在写侧：
落点越界就拒写，错误可预期（不是 traceback，不是 exit 4），拒绝时
不删、不覆盖、不留临时文件，也不留 .bak。

判定口径只有一份（写侧与读侧同一套 realpath 规则）：

* 落点存在（含软链、含断链）→ 解析它的真实目标；
* 落点还不存在 → 解析它爹目录的真实位置，再拼上文件名
  （目录本身是软链的话，新文件就落在软链那边）；
* 真实目标**解不出来**（成环是最常见的那种）→ 落点不可解
  （`FACT_FILE_UNRESOLVED`），同样拒写。

「解不出来」的判据取**语义**，不拿某个 errno 常量当白名单——各平台写
errno 的口径不一样（Windows 真机实测：成环抛的是
`OSError(winerror=1921, errno=22 EINVAL)`，不是 POSIX 的 `ELOOP`；
Windows 的 `errno.ELOOP` 常量还是 10062，跟这里收到的 errno 不是一回事）。
拿 errno 白名单判，Windows 上写侧成环就会漏判 → 退成 exit 4（工具内部
错误），而不是 `FACT_FILE_UNRESOLVED` / exit 5。

用 `os.path.realpath` 而不是 `Path.resolve()`：后者在软链成环时
3.10–3.12 抛 RuntimeError、3.13+ 不抛，跨版本读数会漂（读侧同因）。

两个入口，两个码（各有各的对象，不混）：

* `guard_facts_write`：事实账文件（`facts/*.toml`）——与读侧同一对象、
  同一现象（真实目标越出项目根），**复用读侧已登记的码**，
  severity / exit 一律不动（red / exit 5）；
* `guard_project_write`：其它项目内写盘（图表、登记表、证据锁、声明文件…）——
  不是事实账，是另一个对象，复用仓里既有的写侧越界码 `PATH_ESCAPE`
  （章节写回、资产通道在用），exit 2（配置/用法层），不新增码。
"""
from __future__ import annotations

import errno
import os
from pathlib import Path

from .config import ConfigError
from .constants import EXIT_INTEGRITY

# 事实账写盘被拒时的两个码：与读侧同一对（红、exit 5），severity/exit 不动。
CODE_FACTS_OUTSIDE = "FACT_FILE_OUTSIDE_PROJECT"
CODE_FACTS_UNRESOLVED = "FACT_FILE_UNRESOLVED"
# 其它项目内写盘：仓里既有的写侧越界码（章节写回 / 资产通道在用）。
CODE_PATH_ESCAPE = "PATH_ESCAPE"


class WriteRefused(ConfigError):
    """写盘被拒（落点越出项目根）：拒写，不落盘，不留半截文件。

    `exit_code` 让命令层按码分层退出：事实账是信任链失败（exit 5），
    不是配置错（exit 2），也不是工具内部错误（exit 4）。
    """

    def __init__(self, message: str, code: str,
                 exit_code: int = EXIT_INTEGRITY):
        super().__init__(message, code=code)
        self.exit_code = exit_code


def _real(path: Path) -> str:
    """真实路径。

    存在（含软链）→ 解析后的真实目标；不存在（还没建、或是断链）→
    按 strict=False 尽力解析（断链给出「本来要写到哪」）。
    解不出来（成环等）→ 抛 OSError，由调用方判「不可解」。

    errno 口径各平台不同（成环：POSIX 是 `ELOOP`，Windows 是
    `winerror=1921` + `errno=EINVAL`），所以这里只负责把错误**抛出去**，
    「算不算不可解」由调用方按语义判（见 `_unresolved_reason`）。
    """
    try:
        return os.path.realpath(str(path), strict=True)
    except OSError as exc:
        if exc.errno == errno.ENOENT:
            return os.path.realpath(str(path), strict=False)
        raise


# Windows 真机实测（2026-11-25）：软链成环时
# `os.path.realpath(strict=True)` 抛的是
# `OSError(winerror=1921 ERROR_CANT_RESOLVE_FILENAME, errno=22 EINVAL)`，
# **不是** POSIX 的 `ELOOP`（Windows 的 `errno.ELOOP` 常量是 10062，
# 跟这里收到的 errno 不是同一个东西）。断链则是 `errno=ENOENT`（winerror=2）。
# 所以「成环」的判据不能写成 `exc.errno == errno.ELOOP`。
_WINERROR_CANT_RESOLVE_FILENAME = 1921


def _is_cycle(exc: OSError) -> bool:
    """这次失败是不是「软链成环」（文案用；判定不依赖它）。
    """
    if getattr(exc, "winerror", None) == _WINERROR_CANT_RESOLVE_FILENAME:
        return True
    return exc.errno == errno.ELOOP


def _unresolved_reason(exc: OSError, cycle_detail: str = "") -> str:
    """落点不可解的一句人话（为什么算不出来）。

    判据是**语义**：「strict realpath 解不出来」就是不可解——成环只是其中
    最常见的一种。各平台写 errno 的口径会变（见上面那段实测），拿 errno
    白名单判必然在某个平台上漏判 → 写侧成环退成 exit 4（工具内部错误），
    而不是 `FACT_FILE_UNRESOLVED` / exit 5。能判出是成环就直说成环，
    判不出就说「算不出来」，不编原因。

    `cycle_detail` 是成环时补的那半句：两个入口的原话口径不同（事实账
    那条原来写「是成环软链，真实落点算不出来」，别的项目内写盘那条原来
    写「是成环软链」），补在参数里，两边的原话一个字节都不动。
    """
    if _is_cycle(exc):
        return "是成环软链" + cycle_detail
    detail = exc.strerror or str(exc)
    return "真实落点算不出来（%s）" % detail


def landing_point(target: Path) -> str:
    """写入落点的真实位置（绝对路径字符串）。

    落点还不存在时看它爹目录的真实位置——目录是软链的话，新文件就落在
    软链那边（可能是项目外）。
    """
    path = Path(target)
    if not os.path.lexists(str(path)):
        parent = Path(path).parent
        return os.path.join(_real(parent), path.name)
    return _real(path)


def _parent_unresolved(path: Path) -> bool:
    """落点的爹目录本身是断链软链——写不进去。

    这种落点 `mkdir(exist_ok=True)` 会抛 FileExistsError（命令层退成 exit 4
    的内部错误），不是「明确拒写」。这里提前判成「落点不可解」。
    """
    parent = Path(path).parent
    return parent.is_symlink() and not parent.is_dir()


def _root_real(root: Path) -> str:
    """项目根的真实位置（项目根本身可以是软链，macOS 的 /tmp 就是）。"""
    return os.path.realpath(str(root), strict=False)


def _outside(root_real: str, real: str) -> bool:
    """落点是否越出项目根。"""
    try:
        Path(real).relative_to(Path(root_real))
    except ValueError:
        return True
    return False


def guard_facts_write(root: Path, target: Path, *, rel: str = "") -> None:
    """事实账写盘闸：落点越出项目根 → 拒写。

    越界 → `FACT_FILE_OUTSIDE_PROJECT`（red，exit 5，与读侧同一码）；
    软链成环 → `FACT_FILE_UNRESOLVED`（red，exit 5，与读侧同一码）。
    两个码都是读侧已登记的，severity / exit 一律不动。
    """
    path = Path(target)
    name = rel or path.name
    try:
        real = landing_point(path)
    except OSError as exc:
        # 落点解不出来（成环等）＝ 不可解：判红、拒写、exit 5。
        # 判据按语义（解不出来就是不可解），不按 errno 白名单——
        # Windows 上成环是 winerror=1921/errno=EINVAL，白名单判不到它，
        # 漏判就退成 exit 4（工具内部错误），坏了退出码与判定码的契约。
        raise WriteRefused(
            "事实账写入落点不可解：%s %s——"
            "拒绝写入（没有落盘，也没有改原文件）"
            % (name, _unresolved_reason(exc, "，真实落点算不出来")),
            CODE_FACTS_UNRESOLVED)
    if _parent_unresolved(path):
        raise WriteRefused(
            "事实账写入落点不可解：%s 所在的目录是断链软链——"
            "拒绝写入（没有落盘，也没有改原文件）" % name,
            CODE_FACTS_UNRESOLVED)
    if _outside(_root_real(root), real):
        raise WriteRefused(
            "事实账写入落点越出项目根：%s → %s（真实目标在项目外）——"
            "拒绝写入（没有落盘，也没有改原文件）；"
            "把软链指回项目内，或改项目声明里的 facts 路径" % (name, real),
            CODE_FACTS_OUTSIDE)


def guard_project_write(root: Path, target: Path, *, what: str = "",
                        rel: str = "") -> None:
    """其它项目内写盘闸：落点越出项目根 → 拒写（`PATH_ESCAPE`，exit 2）。

    与事实账不是同一个对象（不是 `facts/*.toml`），所以不套事实账的码：
    仓里既有的写侧越界码是 `PATH_ESCAPE`（章节写回、资产通道在用）。
    """
    path = Path(target)
    name = rel or path.name
    label = what or "写盘"
    try:
        real = landing_point(path)
    except OSError as exc:
        # 同一族：解不出来＝不可解，按语义判（跨平台同一口径，见
        # `_unresolved_reason`）。不许让 OSError 裸崩成 exit 4。
        raise ConfigError(
            "%s落点不可解：%s %s——拒绝写入（没有落盘）"
            % (label, name, _unresolved_reason(exc)), code=CODE_PATH_ESCAPE)
    if _parent_unresolved(path):
        raise ConfigError(
            "%s落点不可解：%s 所在的目录是断链软链——拒绝写入（没有落盘）"
            % (label, name), code=CODE_PATH_ESCAPE)
    if _outside(_root_real(root), real):
        raise ConfigError(
            "%s落点越出项目根：%s → %s——拒绝写入（没有落盘，也没有改原文件）"
            % (label, name, real), code=CODE_PATH_ESCAPE)
