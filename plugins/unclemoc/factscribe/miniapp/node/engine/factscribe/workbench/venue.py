# -*- coding: utf-8 -*-
"""段六：版式面（目标刊物配置 ＋ 截止日期 ＋ 语言锁定）。

项目级 `workbench.toml` 里的两张表：

```toml
[workbench]
knowledge_dir = "knowledge"     # 知识库目录（缺省 knowledge/）

[venue]
venue = "ACL 2026"              # 目标刊物 / 会议
deadline = "2026-05-15"         # 截稿日期（YYYY-MM-DD）
```

规矩（段六硬约束）：

1. **只改版式不改语言盘**（复用条目 24 的口径）——中文稿不能换成英文刊；
   这一条在版式面里常驻提示，存配置时也不许把语言盘换掉。
2. **提醒徽标**：截止日期前 7 天内，导航钮上带提醒徽标；过期了另说。
3. **写盘只在项目目录内**——配置落在项目自己的 `workbench.toml`，
   路径由盘根决定，不接受外部路径。
"""
from __future__ import annotations

import time
from datetime import date, datetime
from pathlib import Path

from ..textio import write_text_exact

#: 项目级工作台配置文件名（与 `ai.py` / `knowledge.py` 同源）。
CONFIG_NAME = "workbench.toml"

#: 目标刊物那张表的名字。
VENUE_SECTION = "venue"

#: 工作台自己的那张表（`knowledge_dir` 也在里面）。
WORKBENCH_SECTION = "workbench"

#: 截稿前多少天开始带提醒徽标。
WARN_DAYS = 7

#: 日期输入的格式。
DATE_FORMAT = "%Y-%m-%d"

#: 模板库里内置的一枚占位模板（模板库建设中）。
BUILTIN_TEMPLATES = [
    {"id": "article", "name": "article（通用单栏论文版式）",
     "name_key": "vn.tplArticle", "note": "模板库建设中",
     "note_key": "vn.tplBuilding", "builtin": True},
]


class VenueError(Exception):
    """版式配置的结构化失败（日期不合法 / 项目目录不对）。"""

    def __init__(self, message: str, code: str = "VENUE_FAILED") -> None:
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------- 配置读写

def config_path(disk_path: str | Path) -> Path:
    """项目级 `workbench.toml` 的位置（盘根下）。"""
    return Path(disk_path).expanduser() / CONFIG_NAME


def _read_table(path: Path, table: str) -> dict:
    from ..config import load_toml

    if not path.is_file():
        return {}
    try:
        data = load_toml(path)
    except Exception:  # noqa: BLE001 - 坏配置当空表
        return {}
    value = data.get(table)
    return value if isinstance(value, dict) else {}


def read_venue(disk_path: str | Path) -> dict:
    """读 `[venue]` 表（`{venue, deadline}`）。读不到就是空表。"""
    return _read_table(config_path(disk_path), VENUE_SECTION)


def read_workbench(disk_path: str | Path) -> dict:
    """读 `[workbench]` 表（`{knowledge_dir, ...}`）。"""
    return _read_table(config_path(disk_path), WORKBENCH_SECTION)


def _toml_value(text: str) -> str:
    out = (str(text or "")
           .replace("\\", "\\\\")
           .replace('"', '\\"')
           .replace("\n", "\\n")
           .replace("\r", "\\r")
           .replace("\t", "\\t"))
    return '"%s"' % out


def _ensure_config(path: Path) -> None:
    """配置文件不在就建一个空的（带说明头）。"""
    if path.is_file():
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        write_text_exact(
            path,
            "# FactScribe 工作台配置（项目级）。\n"
            "# [ai] 放模型后端；[workbench] 放工作台自己的字段；[venue] 放目标刊物。\n")
    except OSError as exc:
        raise VenueError("建不了 %s：%s" % (path, exc),
                         "VENUE_CONFIG_FAILED") from exc


def save_venue(disk_path: str | Path, venue: str = "", deadline: str = "",
               lang: str = "") -> dict:
    """把目标刊物配置写进项目级 `workbench.toml` 的 `[venue]` 表。

    `lang` 是这一盘的写作语言——**只读不改**：语言盘是身份的一部分，
    改版式不碰它（条目 24）。
    """
    from .write import rewrite_table

    disk = Path(disk_path).expanduser()
    if not disk.is_dir():
        raise VenueError("没有这个项目：%s" % disk, "PROJECT_INVALID")
    clean_venue = str(venue or "").strip()
    clean_deadline = str(deadline or "").strip()
    if clean_deadline:
        parse_deadline(clean_deadline)      # 日期不合法就不许存（也不建文件）
    path = config_path(disk)
    _ensure_config(path)
    values: dict = {}
    values["venue"] = _toml_value(clean_venue)
    values["deadline"] = _toml_value(clean_deadline)
    try:
        rewrite_table(path, VENUE_SECTION, values)
    except OSError as exc:
        raise VenueError("写配置失败：%s" % exc, "VENUE_CONFIG_FAILED") from exc
    # 知识库目录字段跟着落个缺省值（不覆盖已有的）。
    from .knowledge import DEFAULT_KNOWLEDGE_DIR

    bench = _read_table(path, WORKBENCH_SECTION)
    if "knowledge_dir" not in bench:
        try:
            rewrite_table(path, WORKBENCH_SECTION,
                          {"knowledge_dir": _toml_value(DEFAULT_KNOWLEDGE_DIR)})
        except OSError:
            pass
    return venue_payload(disk, lang=lang)


# ---------------------------------------------------------------- 截止日期

def parse_deadline(text: str) -> date:
    """解析 `YYYY-MM-DD`（也接受 `YYYY/MM/DD`）。不合法就抛 `VenueError`。"""
    raw = str(text or "").strip()
    if not raw:
        raise VenueError("截稿日期要填", "VENUE_DEADLINE_REQUIRED")
    for fmt in (DATE_FORMAT, "%Y/%m/%d"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    raise VenueError("截稿日期要写成 YYYY-MM-DD：%s" % raw,
                     "VENUE_DEADLINE_INVALID")


def deadline_state(deadline: str, today: date | None = None) -> dict:
    """截止日期的状态：`{days_left, due_soon, overdue, label, deadline}`。

    * `days_left` 为负＝已经过期；
    * `due_soon`＝还有 7 天以内（含今天）——导航钮在这时候带提醒徽标。
    """
    raw = str(deadline or "").strip()
    if not raw:
        return {"deadline": "", "days_left": None, "due_soon": False,
                "overdue": False, "label": ""}
    try:
        target = parse_deadline(raw)
    except VenueError:
        return {"deadline": raw, "days_left": None, "due_soon": False,
                "overdue": False, "label": "", "invalid": True}
    now = today or date.today()
    days = (target - now).days
    if days < 0:
        label = "已过期 %d 天" % (-days)
    elif days == 0:
        label = "今天截稿"
    elif days <= WARN_DAYS:
        label = "还有 %d 天截稿" % days
    else:
        label = "还有 %d 天截稿" % days
    return {"deadline": target.isoformat(), "days_left": days,
            "due_soon": 0 <= days <= WARN_DAYS, "overdue": days < 0,
            "label": label}


# ---------------------------------------------------------------- 语言锁定

#: 语言锁定的口径（条目 24：改版式不改语言盘）。
LANG_LOCK_ZH = ("这一盘是中文稿：版式只管排版与刊物要求，不动语言盘——"
                "中文稿不能换成英文刊。")
LANG_LOCK_EN = ("这一盘是英文稿：版式只管排版与刊物要求，不动语言盘——"
                "要写中文稿就另开一个中文盘。")


def lang_lock(lang: str) -> dict:
    """语言锁定的提示（`{lang, locked, note, note_key}`）。

    `note` 是中文口径（给 API 用）；`note_key` 给前端做 i18n——
    界面切到 EN 时那句提示也得是英文，不能露中文。
    """
    code = str(lang or "").strip().lower()
    if code == "zh":
        return {"lang": "zh", "locked": True, "note": LANG_LOCK_ZH,
                "note_key": "vn.lockZh"}
    if code == "en":
        return {"lang": "en", "locked": False, "note": LANG_LOCK_EN,
                "note_key": "vn.lockEn"}
    return {"lang": code, "locked": False, "note": LANG_LOCK_EN,
            "note_key": "vn.lockEn"}


# ---------------------------------------------------------------- 汇总

def venue_payload(disk_path: str | Path, lang: str = "") -> dict:
    """版式面要的一整包：刊物配置 ＋ 截止状态 ＋ 语言锁定 ＋ 模板库。"""
    disk = Path(disk_path).expanduser()
    table = read_venue(disk)
    venue = str(table.get("venue") or "").strip()
    deadline = str(table.get("deadline") or "").strip()
    state = deadline_state(deadline)
    return {
        "ok": True,
        "venue": venue,
        "deadline": deadline,
        "days_left": state["days_left"],
        "due_soon": state["due_soon"],
        "overdue": state["overdue"],
        "deadline_label": state["label"],
        "warn_days": WARN_DAYS,
        "lang_lock": lang_lock(lang),
        "templates": [dict(item) for item in BUILTIN_TEMPLATES],
        "config": str(config_path(disk)),
        "updated": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
