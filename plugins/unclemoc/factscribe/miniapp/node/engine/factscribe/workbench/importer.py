# -*- coding: utf-8 -*-
"""段四：实验报告导入（真文件 → 草稿）。

铁律（段四硬约束）：
  * **绝不写活账本** `facts/*.toml`。导入只写 `facts/draft/<报告名>.draft.toml`
    （子目录，`facts/*.toml` 的 glob 吃不到它）；
  * 每条事实都带 provenance（来源路径 ＋ sha256）、`confidence="low"`
    （银标制口径）、`status="待核对"`——导入的东西一律等人核。

支持的文件：`toml` / `json`。行形：`{id, claim, value, source?}`。
容错：坏行不吞掉，列进 `failed` 让人看。
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from pathlib import Path

#: 报告目录里认的扩展名。
REPORT_SUFFIXES = (".toml", ".json")

#: 草稿所在的子目录（活账本 glob 吃不到）。
DRAFT_SUBDIR = "draft"

#: 导入条目的默认状态。
PENDING_STATUS = "待核对"

#: 导入条目的默认置信（银标制：导入的东西一律低置信，等人核）。
PENDING_CONFIDENCE = "low"

DRAFT_SCHEMA = "factscribe/draft/1.0"

_ID_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,64}$")


class ImportError_(Exception):
    """导入流程的结构化失败（目录不对 / 文件读不到 / 报告名非法）。"""

    def __init__(self, message: str, code: str = "IMPORT_FAILED") -> None:
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------- 目录

def _workbench_table(disk: Path) -> dict:
    from ..config import load_toml
    from .projects import CONFIG_NAME

    path = disk / CONFIG_NAME
    if not path.is_file():
        return {}
    try:
        data = load_toml(path)
    except Exception:  # noqa: BLE001 - 坏配置当没有
        return {}
    table = data.get("workbench")
    return table if isinstance(table, dict) else {}


def reports_dir(disk_path: str | Path) -> Path:
    """这个盘的实验报告目录（项目配置里那个目录）。

    `reports_dir` 是**相对工作区根**（盘的上一级）的相对路径；缺省是
    「〈项目目录〉/reports」。绝对路径照用。
    """
    disk = Path(disk_path).expanduser()
    table = _workbench_table(disk)
    base = disk.parent
    project_dir = str(table.get("project_dir") or "").strip() or disk.name
    reports = str(table.get("reports_dir") or "").strip()
    if not reports:
        reports = project_dir + "/reports"
    candidate = Path(reports).expanduser()
    if candidate.is_absolute():
        return candidate
    return (base / candidate).resolve()


def list_report_files(directory: str | Path) -> list[dict]:
    """列报告目录下的真实文件（只认 toml / json）。"""
    path = Path(directory).expanduser()
    out: list[dict] = []
    if not path.is_dir():
        return out
    for entry in sorted(path.iterdir(), key=lambda p: p.name):
        if not entry.is_file():
            continue
        if entry.suffix.lower() not in REPORT_SUFFIXES:
            continue
        try:
            stat = entry.stat()
        except OSError:
            continue
        out.append({
            "name": entry.name,
            "path": str(entry),
            "size": stat.st_size,
            "mtime": time.strftime("%Y-%m-%d %H:%M:%S",
                                  time.localtime(stat.st_mtime)),
            "ext": entry.suffix.lower(),
        })
    return out


def sha256_of(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


# ---------------------------------------------------------------- 解析

def _toml_scalar(text: str):
    raw = str(text).strip()
    if not raw:
        return ""
    if raw[0] in "\"'" and raw[-1] == raw[0] and len(raw) >= 2:
        return raw[1:-1]
    if raw in ("true", "false"):
        return raw == "true"
    try:
        return int(raw)
    except ValueError:
        pass
    try:
        return float(raw)
    except ValueError:
        pass
    return raw


def _lenient_toml(text: str) -> tuple[list[dict], list[dict]]:
    """逐行兜底解析：整文件坏掉时，至少把能认的行捞出来。"""
    rows: list[dict] = []
    failed: list[dict] = []
    section: list[str] = []
    current: dict = {}
    index = 0

    def flush() -> None:
        nonlocal current
        if current:
            rows.append(current)
        current = {}

    for number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("[["):
            flush()
            name = stripped.strip("[]").strip()
            section = [part.strip('"') for part in name.split(".")]
            current = {}
            continue
        if stripped.startswith("["):
            flush()
            section = [part.strip('"') for part in stripped.strip("[]").split(".")]
            continue
        if "=" not in stripped:
            failed.append({"line": number, "raw": line,
                           "error": "这一行不是 key = value"})
            continue
        key, _, value = stripped.partition("=")
        key = key.strip().strip('"')
        if not key:
            failed.append({"line": number, "raw": line, "error": "键名为空"})
            continue
        current[key] = _toml_scalar(value)
    flush()
    return rows, failed


def _rows_from_container(container: object) -> list[dict]:
    """从「行数组」里挑出行。"""
    out: list[dict] = []
    if isinstance(container, list):
        for item in container:
            if isinstance(item, dict):
                out.append(item)
        return out
    if isinstance(container, dict):
        for key, value in container.items():
            if isinstance(value, list) and any(isinstance(x, dict) for x in value):
                out.extend(x for x in value if isinstance(x, dict))
    return out


def _normalise_row(raw: dict, line: int = 0) -> tuple[dict | None, dict | None]:
    """一行原始数据 → (规范行, 失败信息)。"""
    if not isinstance(raw, dict):
        return None, {"line": line, "raw": json.dumps(raw, ensure_ascii=False),
                      "error": "这一项不是对象"}
    identifier = str(raw.get("id") or raw.get("metric") or raw.get("key") or "").strip()
    if not identifier:
        return None, {"line": line,
                      "raw": json.dumps(raw, ensure_ascii=False)[:200],
                      "error": "缺 id"}
    if not _ID_RE.match(identifier):
        return None, {"line": line, "raw": identifier,
                      "error": "id 只许字母、数字、下划线、点、连字符（≤64）"}
    value = raw.get("value")
    if value is None:
        value = ""
    elif not isinstance(value, str):
        value = str(value)
    claim = raw.get("claim") or raw.get("label") or raw.get("name") or ""
    if not isinstance(claim, str):
        claim = str(claim)
    source = raw.get("source") or raw.get("src") or ""
    if not isinstance(source, str):
        source = str(source)
    return ({"id": identifier, "claim": claim.strip(), "value": value.strip(),
             "source": source.strip(), "line": int(line or 0)}, None)


def parse_report(path: str | Path) -> dict:
    """解析一份报告文件 → `{"rows", "failed"}`。坏行不吞，列出来。"""
    target = Path(path).expanduser()
    if not target.is_file():
        raise ImportError_("报告文件不在：%s" % target, "REPORT_FILE_MISSING")
    try:
        text = target.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise ImportError_("读不了报告文件：%s" % exc, "REPORT_READ_FAILED") from exc
    suffix = target.suffix.lower()
    raw_rows: list[tuple[dict, int]] = []
    failed: list[dict] = []
    if suffix == ".json":
        try:
            data = json.loads(text)
        except ValueError as exc:
            raise ImportError_("JSON 解析失败：%s" % exc, "REPORT_PARSE_FAILED") from exc
        container = data
        if isinstance(data, dict):
            for key in ("rows", "metrics", "facts", "report", "items"):
                if key in data and isinstance(data[key], (list, dict)):
                    container = data[key]
                    break
        for item in _rows_from_container(container):
            raw_rows.append((item, 0))
    else:
        data = None
        try:
            from ..config import load_toml
            data = load_toml(target)
        except Exception:  # noqa: BLE001 - 整文件坏掉走逐行兜底
            data = None
        if isinstance(data, dict):
            rows = _rows_from_container(data)
            if rows:
                raw_rows.extend((item, 0) for item in rows)
            else:
                # 扁平的 id = value 表：每个标量算一行。
                for key, value in data.items():
                    if isinstance(value, (dict, list)):
                        continue
                    raw_rows.append(({"id": key, "value": value}, 0))
        else:
            parsed, bad = _lenient_toml(text)
            raw_rows.extend((item, 0) for item in parsed)
            failed.extend(bad)
    rows: list[dict] = []
    for item, line in raw_rows:
        good, bad = _normalise_row(item, line)
        if good is None:
            failed.append(bad or {"line": line, "raw": "", "error": "解析失败"})
        else:
            rows.append(good)
    seen: set[str] = set()
    unique: list[dict] = []
    for row in rows:
        if row["id"] in seen:
            failed.append({"line": row.get("line", 0), "raw": row["id"],
                           "error": "id 重复，后一条被跳过"})
            continue
        seen.add(row["id"])
        unique.append(row)
    return {"rows": unique, "failed": failed}


def suggest_mapping(rows: list[dict]) -> list[dict]:
    """自动映射：报告行的 id → 事实账字段（先按同名 id 对上）。"""
    return [{"id": row["id"], "target": row["id"]} for row in rows or []]


# ---------------------------------------------------------------- 草稿

def _toml_str(text: str) -> str:
    out = str(text).replace("\\", "\\\\").replace('"', '\\"')
    out = out.replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
    return '"%s"' % out


def draft_path(disk_path: str | Path, report_name: str) -> Path:
    """草稿落盘位置：`<盘>/facts/draft/<报告名>.draft.toml`。

    报告名可以带报告后缀（`.toml`/`.csv`…）或草稿后缀（`.draft`）——
    两种写法都落到同一个草稿文件。
    """
    disk = Path(disk_path).expanduser()
    stem = Path(str(report_name)).name
    for suffix in REPORT_SUFFIXES:
        if stem.lower().endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    if stem.lower().endswith(".draft"):
        stem = stem[: -len(".draft")]
    stem = stem or "report"
    return disk / "facts" / DRAFT_SUBDIR / ("%s.draft.toml" % stem)


def write_draft(disk_path: str | Path, report_name: str, rows: list[dict],
                mapping: dict | None = None, source_path: str | Path = "",
                report_sha256: str = "") -> dict:
    """把导入的行写成**草稿**（不碰活账本）。"""
    disk = Path(disk_path).expanduser()
    target = draft_path(disk, report_name)
    mapping = mapping or {}
    source_path = str(source_path or "")
    digest = report_sha256 or (sha256_of(source_path) if source_path
                               and Path(source_path).is_file() else "")
    lines: list[str] = [
        "# FactScribe 导入草稿：由「导入实验报告」生成。",
        "# 这是草稿，不是活账本：账本在 facts/*.toml，这里是 facts/draft/。",
        "# 全部条目状态「待核对」、置信 low（银标制口径），等人核。",
        "schema = %s" % _toml_str(DRAFT_SCHEMA),
        "status = %s" % _toml_str(PENDING_STATUS),
        "confidence = %s" % _toml_str(PENDING_CONFIDENCE),
        "report = %s" % _toml_str(Path(source_path).name if source_path
                                  else str(report_name)),
        "report_sha256 = %s" % _toml_str(digest),
        "imported_at = %s" % _toml_str(time.strftime("%Y-%m-%dT%H:%M:%S%z")),
        "",
    ]
    written = 0
    for row in rows or []:
        identifier = str(row.get("id") or "").strip()
        if not identifier:
            continue
        target_field = str(mapping.get(identifier, "") or "").strip()
        lines.append("[[fact]]")
        lines.append("id = %s" % _toml_str(identifier))
        lines.append("claim = %s" % _toml_str(str(row.get("claim") or "")))
        lines.append("value = %s" % _toml_str(str(row.get("value") or "")))
        lines.append("source = %s" % _toml_str(str(row.get("source") or "")))
        lines.append("confidence = %s" % _toml_str(PENDING_CONFIDENCE))
        lines.append("status = %s" % _toml_str(PENDING_STATUS))
        lines.append("mapping = %s" % _toml_str(target_field))
        lines.append("[fact.provenance]")
        lines.append("path = %s" % _toml_str(source_path))
        lines.append("sha256 = %s" % _toml_str(digest))
        lines.append("line = %d" % int(row.get("line") or 0))
        lines.append("")
        written += 1
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("\n".join(lines), encoding="utf-8")
    except OSError as exc:
        raise ImportError_("写草稿失败：%s" % exc, "DRAFT_WRITE_FAILED") from exc
    return {"ok": True, "draft_path": str(target), "count": written,
            "name": target.name, "sha256": sha256_of(target)}


def _draft_fact_count(path: Path) -> int:
    """草稿里的条目数（`[[fact]]` 的个数）。"""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return 0
    return text.count("[[fact]]")


def list_drafts(disk_path: str | Path) -> list[dict]:
    """这个盘已导入的草稿（报告页的卡）。"""
    disk = Path(disk_path).expanduser()
    folder = disk / "facts" / DRAFT_SUBDIR
    out: list[dict] = []
    if not folder.is_dir():
        return out
    for entry in sorted(folder.glob("*.draft.toml"), key=lambda p: p.name):
        try:
            stat = entry.stat()
        except OSError:
            continue
        out.append({
            "id": entry.stem,
            "name": entry.name.replace(".draft.toml", ""),
            "file": entry.name,
            "path": str(entry),
            "draft_path": str(entry),
            "time": time.strftime("%Y-%m-%d %H:%M:%S",
                                  time.localtime(stat.st_mtime)),
            "size": stat.st_size,
            "bound": _draft_fact_count(entry),
        })
    return out


def _unquote_toml(text: str) -> str:
    """去掉 TOML 字符串的引号与转义（草稿是本模块自己写的，格式已知）。"""
    raw = str(text or "").strip()
    if len(raw) >= 2 and raw[0] == '"' and raw[-1] == '"':
        body = raw[1:-1]
        out = []
        i = 0
        escapes = {"n": "\n", "r": "\r", "t": "\t", '"': '"', "\\": "\\"}
        while i < len(body):
            ch = body[i]
            if ch == "\\" and i + 1 < len(body):
                out.append(escapes.get(body[i + 1], body[i + 1]))
                i += 2
                continue
            out.append(ch)
            i += 1
        return "".join(out)
    return raw


def read_draft(disk_path: str | Path, report_name: str) -> dict:
    """读一条导入草稿的详情（报告名 / 来源文件 / sha256 / 逐条绑定清单）。

    只读草稿记录本身，不碰活账本、不碰报告源文件。
    """
    disk = Path(disk_path).expanduser()
    target = draft_path(disk, report_name)
    if not target.is_file():
        raise ImportError_("找不到这条导入记录：%s" % report_name, "DRAFT_NOT_FOUND")
    try:
        text = target.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise ImportError_("读不了草稿：%s" % exc, "DRAFT_READ_FAILED") from exc
    head: dict = {}
    facts: list[dict] = []
    cur: dict | None = None
    for line in text.splitlines():
        item = line.strip()
        if not item or item.startswith("#"):
            continue
        if item == "[[fact]]":
            cur = {"id": "", "claim": "", "value": "", "source": "",
                   "status": "", "confidence": "", "mapping": "",
                   "path": "", "sha256": "", "line": ""}
            facts.append(cur)
            continue
        if item.startswith("["):
            continue
        if "=" not in item:
            continue
        key, value = item.split("=", 1)
        key = key.strip()
        if cur is None:
            head[key] = _unquote_toml(value)
        else:
            cur[key] = _unquote_toml(value)
    try:
        stat = target.stat()
        mtime = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(stat.st_mtime))
    except OSError:
        mtime = ""
    return {"ok": True, "id": target.stem.replace(".draft", ""),
            "name": target.name.replace(".draft.toml", ""),
            "file": target.name, "path": str(target),
            "time": mtime, "size": len(text.encode("utf-8")),
            "report": head.get("report", ""),
            "report_sha256": head.get("report_sha256", ""),
            "imported_at": head.get("imported_at", ""),
            "status": head.get("status", ""),
            "bound": len(facts), "facts": facts}


def delete_draft(disk_path: str | Path, report_name: str) -> dict:
    """删掉一条导入草稿（报告记录）。

    只删 `facts/draft/<名>.draft.toml` 这条草稿记录；**报告源文件不动**
    （源文件在 reports/ 目录里，是人自己的材料）。
    """
    disk = Path(disk_path).expanduser()
    name = str(report_name or "").strip()
    if not name:
        raise ImportError_("要删的报告名要给", "REPORT_NAME_REQUIRED")
    target = draft_path(disk, name)
    if not target.is_file():
        raise ImportError_("没有这条导入记录：%s" % name, "DRAFT_MISSING")
    source = ""
    try:
        text = target.read_text(encoding="utf-8", errors="replace")
    except OSError:
        text = ""
    for line in text.splitlines():
        if line.startswith("report = "):
            source = line.split("=", 1)[1].strip().strip('"')
            break
    try:
        target.unlink()
    except OSError as exc:
        raise ImportError_("删不掉这条导入记录：%s" % exc,
                           "DRAFT_DELETE_FAILED") from exc
    return {"ok": True, "deleted": str(target), "name": name,
            "source_file": source, "source_untouched": True}

