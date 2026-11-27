# -*- coding: utf-8 -*-
"""段六：知识库（项目资料 → 上下文）。

这一层的规矩（段六硬约束）：

1. **只在项目目录里动手**——所有文件操作都过写闸 `_safe_knowledge_file`
   （新目录类型对应的新防护函数，与段二的 `_safe_section_file` 同族）：
   路径不许绝对、不许 `..`、不许越出盘根；落盘只落在 `knowledge/` 里。
2. **PDF 本段只登记**——文件名与大小照收，内容标注「文本提取段七接入」，
   不假装已经读过。
3. **上下文有长度上限**——知识库文本拼进 `/api/chat` 上下文时截断，
   超预算的部分明说「已截断」，不让上下文被一份长文件撑爆。

文件来源：项目目录（盘根）下**递归**收集 `.tex` / `.md` / `.toml` / `.txt`；
`.pdf` 只登记。上传的文件落在 `knowledge/` 目录（项目级 `workbench.toml`
的 `[workbench].knowledge_dir`，缺省 `knowledge/`）。
"""
from __future__ import annotations

import hashlib
import time
from pathlib import Path, PurePosixPath

from ..textio import read_text_exact

#: 项目级工作台配置文件名（与 `ai.py` 同源：`[ai]` 节就在这个文件里）。
CONFIG_NAME = "workbench.toml"

#: `[workbench]` 节的名字。
WORKBENCH_SECTION = "workbench"

#: 知识库目录的缺省名（相对项目目录）。
DEFAULT_KNOWLEDGE_DIR = "knowledge"

#: 认作文本、能直接读的文件后缀。
TEXT_SUFFIXES = (".tex", ".md", ".toml", ".txt")

#: 认作「只登记不解析」的后缀（PDF 文本提取段七接入）。
PDF_SUFFIXES = (".pdf",)

#: 允许落进知识库的后缀（文本 ＋ PDF 登记）。
ALLOWED_SUFFIXES = TEXT_SUFFIXES + PDF_SUFFIXES

#: 扫描时跳过的目录（版本库、依赖、缓存、归档……）。
SKIP_DIRS = {
    ".git", ".hg", ".svn", "__pycache__", "node_modules", ".venv", "venv",
    ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", ".idea", ".vscode",
    "attic", "bundle", ".ipynb_checkpoints",
}

#: 文件状态标签。
STATUS_READY = "可用"
STATUS_PENDING = "待提取"

#: 单个文件预览的上限（字符）。
PREVIEW_CHARS = 20000

#: 拼进对话上下文的知识库文本上限（字符）。
CONTEXT_CHARS = 4000

#: 单个文件进上下文的份额上限（字符）——免得一份长文件吃掉全部预算。
CONTEXT_PER_FILE = 1200


class KnowledgeError(Exception):
    """知识库操作的结构化失败（路径越界 / 目录不对 / 后缀不认）。"""

    def __init__(self, message: str, code: str = "KNOWLEDGE_FAILED") -> None:
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------- 配置

def _find_config(disk: Path) -> tuple[Path | None, dict]:
    """找 `workbench.toml`：盘目录优先，其次盘的上级（项目目录）。"""
    from ..config import load_toml

    for candidate in (disk, disk.parent):
        path = candidate / CONFIG_NAME
        if not path.is_file():
            continue
        try:
            data = load_toml(path)
        except Exception:  # noqa: BLE001 - 坏配置当没有
            continue
        table = data.get(WORKBENCH_SECTION)
        return path, (table if isinstance(table, dict) else {})
    return None, {}


def knowledge_dir(disk_path: str | Path) -> Path:
    """这个项目的知识库目录（缺省 `<盘>/knowledge/`）。

    配置项在项目级 `workbench.toml` 的 `[workbench].knowledge_dir`；
    相对路径按**盘根**解析，绝对路径一律拒绝（硬约束：只在项目目录内动手）。
    """
    disk = Path(disk_path).expanduser()
    _, table = _find_config(disk)
    raw = str(table.get("knowledge_dir") or "").strip() or DEFAULT_KNOWLEDGE_DIR
    candidate = Path(raw).expanduser()
    if candidate.is_absolute():
        raise KnowledgeError("knowledge_dir 只许相对项目目录的路径：%s" % raw,
                             "KNOWLEDGE_DIR_INVALID")
    root = disk.resolve()
    target = (disk / candidate).resolve()
    try:
        target.relative_to(root)
    except (OSError, ValueError):
        raise KnowledgeError("knowledge_dir 越出项目目录：%s" % raw,
                             "KNOWLEDGE_DIR_INVALID") from None
    return target


# ---------------------------------------------------------------- 写闸

def _safe_knowledge_file(disk_root: Path, rel: str) -> Path:
    """写闸：只许写知识库目录里的文件（与段二 `_safe_section_file` 同族）。

    四道闸：相对路径；不许 `..`；不许越出盘根；必须在 `knowledge/` 内。
    """
    raw = str(rel or "").strip()
    pure = PurePosixPath(raw.replace("\\", "/"))
    if not raw or pure.is_absolute() or any(part == ".." for part in pure.parts):
        raise KnowledgeError("知识库文件路径不合法：%s" % rel,
                             "KNOWLEDGE_PATH_INVALID")
    root = Path(disk_root).resolve()
    target = Path(disk_root).joinpath(*[p for p in pure.parts if p not in ("", ".")])
    try:
        inside = target.resolve().relative_to(root)
    except (OSError, ValueError):
        raise KnowledgeError("知识库文件越出项目目录：%s" % rel,
                             "KNOWLEDGE_PATH_INVALID") from None
    folder = knowledge_dir(disk_root)
    try:
        target.resolve().relative_to(folder)
    except (OSError, ValueError):
        raise KnowledgeError("只许写知识库目录里的文件：%s" % rel,
                             "KNOWLEDGE_PATH_INVALID") from None
    return target


def _safe_project_file(disk_root: Path, rel: str) -> Path:
    """读闸：只许读项目目录里的文件（不许越出盘根）。"""
    raw = str(rel or "").strip()
    pure = PurePosixPath(raw.replace("\\", "/"))
    if not raw or pure.is_absolute() or any(part == ".." for part in pure.parts):
        raise KnowledgeError("文件路径不合法：%s" % rel, "KNOWLEDGE_PATH_INVALID")
    root = Path(disk_root).resolve()
    target = Path(disk_root).joinpath(*[p for p in pure.parts if p not in ("", ".")])
    try:
        target.resolve().relative_to(root)
    except (OSError, ValueError):
        raise KnowledgeError("文件越出项目目录：%s" % rel,
                             "KNOWLEDGE_PATH_INVALID") from None
    return target


# ---------------------------------------------------------------- 收集

def _human_size(size: int) -> str:
    value = float(size)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return ("%d %s" % (int(value), unit)) if unit == "B" \
                else ("%.1f %s" % (value, unit))
        value /= 1024.0
    return "%d B" % size


def _iter_project_files(disk_root: Path):
    """递归走项目目录，跳过噪声目录。"""
    stack = [disk_root]
    while stack:
        current = stack.pop()
        try:
            entries = sorted(current.iterdir(), key=lambda p: p.name)
        except OSError:
            continue
        for entry in entries:
            name = entry.name
            if name.startswith("."):
                continue
            if entry.is_dir():
                if name in SKIP_DIRS:
                    continue
                stack.append(entry)
                continue
            if not entry.is_file():
                continue
            yield entry


def list_files(disk_path: str | Path) -> list[dict]:
    """项目目录下的真实文件清单（知识库左栏）。

    每行：`{name, path, size, size_label, ext, status, status_label, mtime,
    in_knowledge}`。文本类状态「可用」；PDF 只登记，状态「待提取」。
    """
    disk = Path(disk_path).expanduser()
    if not disk.is_dir():
        return []
    try:
        folder = knowledge_dir(disk)
    except KnowledgeError:
        folder = disk / DEFAULT_KNOWLEDGE_DIR
    rows: list[dict] = []
    for entry in _iter_project_files(disk):
        suffix = entry.suffix.lower()
        if suffix not in ALLOWED_SUFFIXES:
            continue
        try:
            stat = entry.stat()
        except OSError:
            continue
        try:
            rel = entry.resolve().relative_to(disk.resolve()).as_posix()
        except (OSError, ValueError):
            continue
        pending = suffix in PDF_SUFFIXES
        try:
            # 在知识库目录里吗？（只看是否落在 knowledge/ 内，不比路径写法）
            entry.resolve().relative_to(folder)
            in_knowledge = True
        except (OSError, ValueError):
            in_knowledge = False
        rows.append({
            "name": entry.name,
            "path": rel,
            "size": int(stat.st_size),
            "size_label": _human_size(int(stat.st_size)),
            "ext": suffix,
            "status": "pending" if pending else "ready",
            "status_label": STATUS_PENDING if pending else STATUS_READY,
            "mtime": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(stat.st_mtime)),
            "in_knowledge": in_knowledge,
        })
    rows.sort(key=lambda row: (not row["in_knowledge"], row["path"]))
    return rows


def preview(disk_path: str | Path, rel: str) -> dict:
    """点开一个文件：文本类直接读；PDF 只给登记信息。"""
    disk = Path(disk_path).expanduser()
    target = _safe_project_file(disk, rel)
    suffix = target.suffix.lower()
    if suffix in PDF_SUFFIXES:
        try:
            size = target.stat().st_size
        except OSError:
            size = 0
        return {"ok": True, "name": target.name, "path": str(rel),
                "ext": suffix, "size": size, "size_label": _human_size(size),
                "status": "pending", "status_label": STATUS_PENDING,
                "sha256": sha256_of(target)[:12] if target.is_file() else "",
                "text": "", "truncated": False,
                "note": "PDF 只登记文件名与大小，文本提取段七接入。"}
    if suffix not in TEXT_SUFFIXES:
        raise KnowledgeError("这个后缀不认：%s" % suffix, "KNOWLEDGE_SUFFIX_INVALID")
    try:
        text = read_text_exact(target, errors="replace")
    except OSError as exc:
        raise KnowledgeError("读不了这个文件：%s" % exc, "KNOWLEDGE_READ_FAILED") from exc
    truncated = len(text) > PREVIEW_CHARS
    return {"ok": True, "name": target.name, "path": str(rel), "ext": suffix,
            "size": len(text.encode("utf-8")),
            "size_label": _human_size(len(text.encode("utf-8"))),
            "status": "ready", "status_label": STATUS_READY,
            "sha256": sha256_of(target)[:12],
            "text": text[:PREVIEW_CHARS], "truncated": truncated,
            "note": ""}


def delete_file(disk_path: str | Path, rel: str) -> dict:
    """删一个**知识库目录里**的文件（写闸 `_safe_knowledge_file`）。

    项目源文件（`.tex` 等）不在知识库目录里 → 写闸直接拒，
    源文件由章节管理管，知识库不碰。
    """
    disk = Path(disk_path).expanduser()
    target = _safe_knowledge_file(disk, rel)     # 写闸：只许 knowledge/ 内的
    if not target.is_file():
        raise KnowledgeError("文件不在：%s" % rel, "KNOWLEDGE_NOT_FOUND")
    try:
        target.unlink()
    except OSError as exc:
        raise KnowledgeError("删不掉：%s" % exc, "KNOWLEDGE_DELETE_FAILED") from exc
    return {"ok": True, "name": target.name, "path": str(rel)}


# ---------------------------------------------------------------- 上传

def sha256_of(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def save_upload(disk_path: str | Path, filename: str, payload: bytes) -> dict:
    """上传一个文件 → 存进知识库目录（multipart 落盘的唯一入口）。"""
    disk = Path(disk_path).expanduser()
    safe = Path(str(filename or "")).name
    if not safe or safe in (".", ".."):
        raise KnowledgeError("没有收到文件", "KNOWLEDGE_FILE_MISSING")
    suffix = Path(safe).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise KnowledgeError("只认 %s 文件" % " / ".join(ALLOWED_SUFFIXES),
                             "KNOWLEDGE_SUFFIX_INVALID")
    folder = knowledge_dir(disk)
    target = _safe_knowledge_file(disk, str((Path(folder.name) / safe).as_posix()))
    try:
        folder.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
    except OSError as exc:
        raise KnowledgeError("存文件失败：%s" % exc, "KNOWLEDGE_WRITE_FAILED") from exc
    return {"ok": True, "name": safe, "path": target.name, "size": len(payload),
            "size_label": _human_size(len(payload)), "sha256": sha256_of(target),
            "status": "pending" if suffix in PDF_SUFFIXES else "ready",
            "status_label": STATUS_PENDING if suffix in PDF_SUFFIXES else STATUS_READY,
            "dir": str(folder)}


# ---------------------------------------------------------------- 上下文

def context_text(disk_path: str | Path, limit: int = CONTEXT_CHARS) -> str:
    """知识库文本（拼进 `/api/chat` 上下文用）。

    顺序：知识库目录里的文件优先，其余项目文件随后；每份文件有份额上限，
    总量有上限——超了明说「已截断」，不假装读全了。
    """
    disk = Path(disk_path).expanduser()
    if limit <= 0 or not disk.is_dir():
        return ""
    rows = list_files(disk)
    if not rows:
        return ""
    pieces: list[str] = []
    used = 0
    truncated = False
    for row in rows:
        if used >= limit:
            truncated = True
            break
        if row["ext"] not in TEXT_SUFFIXES:
            continue
        try:
            target = _safe_project_file(disk, row["path"])
            text = read_text_exact(target, errors="replace")
        except (KnowledgeError, OSError):
            continue
        text = text.strip()
        if not text:
            continue
        budget = min(CONTEXT_PER_FILE, limit - used)
        if len(text) > budget:
            text = text[:budget] + "…（本文件已截断）"
            truncated = True
        head = "【知识库文件：%s】" % row["path"]
        piece = head + "\n" + text
        if used + len(piece) > limit:
            piece = piece[:max(0, limit - used)]
            truncated = True
        if not piece:
            break
        pieces.append(piece)
        used += len(piece)
    if not pieces:
        return ""
    text = "\n\n".join(pieces)
    if truncated:
        text += "\n\n（知识库文本已截断：只取了前面的部分）"
    return text
