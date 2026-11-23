# -*- coding: utf-8 -*-
"""内置示例论文：把随包发布的那份复制到 `~/.factscribe/samples/guide`。

新手引导用。规矩只有一条：**只写这一个目录**——用户的论文一个字都不动。

* 目标目录固定：`~/.factscribe/samples/guide`（跟着 HOME 走，测试可以换 HOME）。
* 源目录在包内：`factscribe/samples/guide`（用 `Path(__file__).parent` 定位，
  装成 wheel 之后照样找得到）。
* 三种情形：不存在 → 整份复制；已存在且 reset → 先删再复制；已存在且不 reset →
  原样返回，不覆盖用户的改动。

也能当脚本跑（Node 侧没有工作台时靠它落地示例）：

    python3 -m factscribe.samples [--reset] [--json]
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from .projects import factscribe_dir

SAMPLE_NAME = "guide"


class SampleError(Exception):
    """示例安装失败：`code` 给机器看（HTTP 状态跟着 `status`）。"""

    def __init__(self, message: str, code: str = "SAMPLE_FAILED",
                 status: int = 400):
        super().__init__(message)
        self.code = code
        self.status = status


def package_root() -> Path:
    """包目录（`factscribe/` 本身）。"""
    return Path(__file__).resolve().parent


def guide_source() -> Path:
    """包内的示例源目录。"""
    return package_root() / "samples" / SAMPLE_NAME


def guide_target() -> Path:
    """用户机器上的示例目录：`~/.factscribe/samples/guide`。"""
    return factscribe_dir() / "samples" / SAMPLE_NAME


def is_guide_path(path) -> bool:
    """这个路径是不是内置示例论文？

    登记册里认得它，是为了在项目列表里把它挑出去（列表只放人自己的论文）。
    """
    target = guide_target()
    try:
        return Path(path).resolve() == target.resolve()
    except OSError:
        return str(path) == str(target)


def install_guide_sample(reset: bool = False) -> dict:
    """把示例装到 `~/.factscribe/samples/guide`。

    返回 `{"path": str, "created": bool, "reset": bool}`：
    `created` 表示「这一次调用真的写了目录」（新建或重置后重装），
    已存在且没要求重置时为 False（什么都没动）。
    """
    source = guide_source()
    target = guide_target()
    if not source.is_dir():
        raise SampleError("内置示例不在包里：%s" % source,
                          code="SAMPLE_MISSING", status=500)
    existed = target.exists() or target.is_symlink()
    if existed and not reset:
        # 原样返回：用户在这份示例里改过的东西不许被悄悄冲掉。
        return {"path": str(target), "created": False, "reset": False}
    if existed:
        _remove(target)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(source, target)
    except OSError as exc:
        raise SampleError("复制示例失败：%s" % exc,
                          code="SAMPLE_COPY_FAILED", status=500)
    return {"path": str(target), "created": True, "reset": bool(reset)}


def _remove(target: Path) -> None:
    """删掉旧的示例目录（文件也一起删）。"""
    try:
        if target.is_dir() and not target.is_symlink():
            shutil.rmtree(target)
        else:
            target.unlink()
    except OSError as exc:
        raise SampleError("删不掉旧示例：%s" % exc,
                          code="SAMPLE_REMOVE_FAILED", status=500)


def main(argv: list[str] | None = None) -> int:
    """`python3 -m factscribe.samples`：装示例，往 stdout 打一行 JSON。"""
    import argparse

    parser = argparse.ArgumentParser(
        prog="factscribe.samples",
        description="把内置示例论文装到 ~/.factscribe/samples/guide")
    parser.add_argument("--reset", action="store_true",
                        help="已存在时先删掉再复制")
    parser.add_argument("--json", action="store_true",
                        help="输出 JSON（默认也输出 JSON，这只是显式写法）")
    args = parser.parse_args(argv)
    try:
        data = install_guide_sample(reset=bool(args.reset))
    except SampleError as exc:
        print(json.dumps({"ok": False,
                          "error": {"code": exc.code, "message": str(exc)}},
                         ensure_ascii=False))
        return 1
    print(json.dumps({"ok": True, **data}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
