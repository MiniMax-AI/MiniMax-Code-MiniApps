# -*- coding: utf-8 -*-
"""PDF 回检闸门（V3.0 P-01..P-08）：verify-pdf。

只认磁盘上的最终 PDF 字节；文本层用 poppler 抽取，图片结构用 pdfimages。
不做 OCR——图里的数字声明为不可判（SPEC §7-R1）。

失败等级：
- PDF_TOOL_MISSING → 8（工具缺失，不许静默放行）
- PDF_PAGE_NO_TEXT / PDF_PAGE_RASTERIZED / PDF_LEDGER_TOKEN_MISSING /
  PDF_UNACCOUNTED_NUMBER / PDF_WHITELIST_UNPROVENANCED / 签名与出处类 → 5
- STAMP_PDF_MISMATCH / STAMP_NONCE_REUSED / STAMP_TIME_INVALID → 7
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
import shutil
import subprocess
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .audit import Issue
from .constants import EXIT_INTEGRITY, EXIT_MISSING, EXIT_OK, SEV_YELLOW
from .facts import _NUM_RE, number_key

# --------------------------------------------------------------------------
# 小工具
# --------------------------------------------------------------------------

def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _strip_sha(value: str) -> str:
    return str(value or "").strip().removeprefix("sha256:").lower()


def jcs(obj) -> bytes:
    """RFC 8785 的够用版：键排序 + 紧凑分隔符 + UTF-8。"""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False).encode("utf-8")


def report_digest(report: dict) -> str:
    """报告指纹＝去掉 `report_sha256` 自身字段后的 JCS sha256（P-08）。"""
    body = {k: v for k, v in report.items() if k != "report_sha256"}
    return _sha256_bytes(jcs(body))


# --------------------------------------------------------------------------
# ed25519 验签（纯 stdlib；不调用任何签名 API）
# --------------------------------------------------------------------------

_P = 2 ** 255 - 19
_L = 2 ** 252 + 27742317777372353535851937790883648493
_D = (-121665 * pow(121666, _P - 2, _P)) % _P
_I = pow(2, (_P - 1) // 4, _P)


def _recover_x(y: int, sign: int):
    if y >= _P:
        return None
    x2 = (y * y - 1) * pow(_D * y * y + 1, _P - 2, _P) % _P
    if x2 == 0:
        return None if sign else 0
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P != 0:
        x = x * _I % _P
    if (x * x - x2) % _P != 0:
        return None
    if (x & 1) != sign:
        x = _P - x
    return x


def _decode_point(raw: bytes):
    if len(raw) != 32:
        return None
    v = int.from_bytes(raw, "little")
    sign = v >> 255
    y = v & ((1 << 255) - 1)
    x = _recover_x(y, sign)
    if x is None:
        return None
    return x, y


_GY = 4 * pow(5, _P - 2, _P) % _P
_G = (_recover_x(_GY, 0), _GY)


def _point_add(a, b):
    x1, y1 = a
    x2, y2 = b
    den = _D * x1 * x2 * y1 * y2 % _P
    x3 = (x1 * y2 + x2 * y1) * pow(1 + den, _P - 2, _P) % _P
    y3 = (y1 * y2 + x1 * x2) * pow(1 - den, _P - 2, _P) % _P
    return x3, y3


def _point_mul(point, e: int):
    result = (0, 1)
    while e > 0:
        if e & 1:
            result = _point_add(result, point)
        point = _point_add(point, point)
        e >>= 1
    return result


def ed25519_verify(public_key: bytes, signature: bytes, message: bytes) -> bool:
    if len(public_key) != 32 or len(signature) != 64:
        return False
    a = _decode_point(public_key)
    r = _decode_point(signature[:32])
    if a is None or r is None:
        return False
    s = int.from_bytes(signature[32:], "little")
    if s >= _L:
        return False
    h = int.from_bytes(
        hashlib.sha512(signature[:32] + public_key + message).digest(),
        "little") % _L
    return _point_mul(_G, s) == _point_add(r, _point_mul(a, h))


# --------------------------------------------------------------------------
# poppler
# --------------------------------------------------------------------------

def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=60)


def missing_tools() -> list[str]:
    return [name for name in ("pdftotext", "pdfinfo", "pdfimages")
            if not shutil.which(name)]


def page_texts(pdf: Path) -> list[str]:
    proc = _run(["pdftotext", "-layout", str(pdf), "-"])
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or "pdftotext 失败").strip())
    pages = proc.stdout.split("\f")
    if pages and pages[-1] == "":
        pages.pop()
    return pages


def page_count(pdf: Path) -> int:
    proc = _run(["pdfinfo", str(pdf)])
    m = re.search(r"^Pages:\s+(\d+)", proc.stdout, re.M)
    return int(m.group(1)) if m else 0


def page_size(pdf: Path) -> tuple[float, float]:
    proc = _run(["pdfinfo", str(pdf)])
    m = re.search(r"^Page size:\s+([\d.]+) x ([\d.]+) pts", proc.stdout, re.M)
    if not m:
        return 612.0, 792.0
    return float(m.group(1)), float(m.group(2))


def image_rows(pdf: Path) -> list[dict]:
    proc = _run(["pdfimages", "-list", str(pdf)])
    rows = []
    for line in proc.stdout.splitlines():
        parts = line.split()
        if len(parts) < 14 or not parts[0].isdigit() or not parts[2].isalpha():
            continue
        if parts[2] != "image":
            continue
        try:
            rows.append({
                "page": int(parts[0]),
                "width": int(parts[3]),
                "height": int(parts[4]),
                "xppi": float(parts[12]),
                "yppi": float(parts[13]),
            })
        except ValueError:
            continue
    return rows


def _page_chars(text: str) -> int:
    return len(re.sub(r"\s", "", text))


# --------------------------------------------------------------------------
# 数字 token 与多重集（P-04 / P-05）
# --------------------------------------------------------------------------

_ID_MASK = re.compile(
    r"(?:https?|ftp)://\S+"
    r"|arXiv:\d{4}\.\d{4,5}"
    r"|10\.\d{4,9}/[-._;()/:A-Za-z0-9]+"
    r"|[A-Za-z][A-Za-z0-9]*(?:[-_./][A-Za-z0-9]+)+")


def pdf_number_counts(text: str) -> Counter:
    """PDF 页文本 → 数字 key 多重集。

    `62.5%` 同时产生百分比归一键（0.625）与字面键（62.5）：源层账本按同一
    规则展开，两侧才可比（P-04 的多重集相等不是单向包含）。
    """
    masked = _ID_MASK.sub(lambda m: " " * len(m.group(0)), text)
    counts: Counter = Counter()
    for m in _NUM_RE.finditer(masked):
        raw, suffix, pct = m.group(1), m.group(2) or None, bool(m.group(3))
        counts[number_key(raw, suffix, pct)] += 1
        if pct:
            counts[number_key(raw, suffix, False)] += 1
    return counts


# W3/W4：引用编号与结构号是「上下文可判」的数字，按上下文模式先掩掉。
# 这是白名单的机械实现（SPEC P-05 W3/W4），不是放宽相等判定：
# 掩掉的数量进白名单计数表，报告里单列。
_CITE_LABEL_RE = re.compile(r"\[\s*\d+(?:\s*[,\-–]\s*\d+)*\s*\]")
_STRUCT_PREFIX_RE = re.compile(
    r"(?m)^\s*(?:Figure|Fig\.?|Table|Tab\.?|Section|Sec\.?|Equation|Eq\.?|"
    r"Appendix|Algorithm)\s*(\d+)\b")
_STRUCT_LINE_RE = re.compile(r"(?m)^\s*(\d+)[.)]\s")


def mask_pdf_context(text: str, page_no: int) -> tuple[str, Counter]:
    """掩掉引用标签/结构号/页码，返回 (掩后文本, 被掩掉的 key 计数)。"""
    masked_out: Counter = Counter()

    def _take(match: re.Match) -> str:
        for m in _NUM_RE.finditer(match.group(0)):
            masked_out[number_key(m.group(1), m.group(2) or None,
                                  bool(m.group(3)))] += 1
        return " " * len(match.group(0))

    out = _CITE_LABEL_RE.sub(_take, text)
    out = _STRUCT_PREFIX_RE.sub(_take, out)
    out = _STRUCT_LINE_RE.sub(_take, out)

    # W1：页脚/页眉的页码（整行只有当前页号）
    lines = out.split("\n")
    for i in range(len(lines) - 1, -1, -1):
        line = lines[i].strip()
        if not line:
            continue
        if line.isdigit() and int(line) == page_no:
            masked_out[number_key(line)] += 1
            lines[i] = " " * len(lines[i])
        break
    return "\n".join(lines), masked_out


def ledger_counts(report: dict) -> Counter:
    counts: Counter = Counter()
    for entry in report.get("number_ledger") or []:
        for key in entry.get("keys") or []:
            counts[str(key)] += 1
    return counts


def pdf_key_counts(pdf: Path) -> Counter:
    """整份 PDF 的数字 key 多重集（与 verify_document 用同一套上下文掩码）。"""
    counts: Counter = Counter()
    try:
        texts = page_texts(pdf)
    except Exception:  # noqa: BLE001 - 工具缺失/解析失败由 verify_document 报
        return counts
    for idx, page in enumerate(texts, 1):
        masked, _context = mask_pdf_context(page, idx)
        counts.update(pdf_number_counts(masked))
    return counts


_STRUCTURAL_KEY_RE = re.compile(r"\d+(?:\.\d+)?")


def structural_key_categories(report: dict, total_pages: int) -> dict[str, str]:
    """源层结构性白名单 → {key: category}（页码按 PDF 实际页数补 1..P）。

    只收 `sections` / `floats` / `years` 三类源侧声明；页码永远由实际 PDF
    页数决定，不采信报告里的数字。同 key 属多类时按固定优先级归一类。
    """
    spec = report.get("structural_whitelist") or {}
    if not isinstance(spec, dict):
        spec = {}
    categories: dict[str, str] = {}

    def _add(category: str, values) -> None:
        for value in values or []:
            key = str(value).strip()
            if _STRUCTURAL_KEY_RE.fullmatch(key):
                categories.setdefault(key, category)

    _add("sections", spec.get("sections"))
    _add("floats", spec.get("floats"))
    _add("years", spec.get("years"))
    _add("pages", [str(i) for i in range(1, max(total_pages, 0) + 1)])
    return categories


def _whitelist(report: dict, issues: list[Issue]) -> Counter:
    counts: Counter = Counter()
    for item in report.get("pdf_whitelist") or []:
        if not isinstance(item, dict):
            issues.append(Issue(
                "PDF_WHITELIST_UNPROVENANCED",
                "pdf_whitelist 条目不是对象：%r" % (item,), exit_code=5, message_key="finding.PDF_WHITELIST_UNPROVENANCED.v2", params={"item": repr(item)}))
            continue
        key = str(item.get("key") or "").strip()
        count = item.get("count")
        source = str(item.get("source") or "").strip()
        if not key or not isinstance(count, int) or count <= 0 or not source:
            issues.append(Issue(
                "PDF_WHITELIST_UNPROVENANCED",
                "白名单条目缺 key/count/source：%r（人签声明必须可追溯）" % (item,),
                token=key, exit_code=5, message_key="finding.PDF_WHITELIST_UNPROVENANCED.v3", params={"item": repr(item)}))
            continue
        counts[key] += count
    return counts


# --------------------------------------------------------------------------
# P-08 签名与出处（先把信任链走完，再判页面）
# --------------------------------------------------------------------------

def _load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _parse_time(value: str):
    text = str(value or "").strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _stamp_issues(pdf: Path, report: dict, stamp_path: Path,
                  keys_path: Path) -> list[Issue]:
    issues: list[Issue] = []
    project_root = pdf.parent.resolve()
    try:
        keys_resolved = keys_path.resolve()
        keys_resolved.relative_to(project_root)
        issues.append(Issue(
            "STAMP_KEY_UNTRUSTED",
            "可信公钥文件位于项目根内部（%s）——项目内公钥＝自签自验，不是信任根"
            % keys_resolved, location=str(keys_path), exit_code=5, message_key="finding.STAMP_KEY_UNTRUSTED.v2", params={"keys_resolved": str(keys_resolved)}))
        return issues
    except ValueError:
        pass

    try:
        stamp = _load_json(stamp_path)
        registry = _load_json(keys_path)
    except (OSError, json.JSONDecodeError) as exc:
        issues.append(Issue("STAMP_MISSING", "stamp/公钥文件读不了：%s" % exc,
                            location=str(stamp_path), exit_code=5, params={"detail": str(exc)}))
        return issues

    payload = stamp.get("payload")
    if not isinstance(payload, dict):
        issues.append(Issue("STAMP_REPORT_MISMATCH", "stamp 缺 payload 对象",
                            exit_code=5, message_key="finding.STAMP_REPORT_MISMATCH.v2"))
        return issues

    schema = payload.get("schema") or stamp.get("schema")
    if str(schema or "") != "factscribe-stamp/3.0":
        issues.append(Issue("STAMP_REPORT_MISMATCH",
                            "stamp schema 必须是 factscribe-stamp/3.0，实际 %r"
                            % schema, exit_code=5, message_key="finding.STAMP_REPORT_MISMATCH.v3", params={"schema": repr(schema)}))
        return issues

    key_id = str(stamp.get("signer_key_id") or payload.get("signer_key_id") or "")
    registry_keys = {str(k.get("key_id")): k for k in (registry.get("keys") or [])
                     if isinstance(k, dict)}
    if key_id not in registry_keys:
        issues.append(Issue("KEY_UNREGISTERED",
                            "signer_key_id %r 不在公钥登记里" % key_id,
                            token=key_id, exit_code=5, message_key="finding.KEY_UNREGISTERED.v2", params={"key_id": repr(key_id)}))
        return issues
    key = registry_keys[key_id]
    if key.get("revoked_at"):
        issues.append(Issue("KEY_REVOKED", "签名 key %r 已吊销" % key_id,
                            token=key_id, exit_code=5, message_key="finding.KEY_REVOKED.v2", params={"key_id": repr(key_id)}))
        return issues

    try:
        pub = base64.b64decode(str(key.get("public_key") or "").split(":", 1)[-1])
        sig = base64.b64decode(str(stamp.get("signature") or "").split(":", 1)[-1])
    except (ValueError, TypeError):
        issues.append(Issue("STAMP_SIGNATURE_INVALID", "公钥/签名不是合法 base64",
                            exit_code=5, message_key="finding.STAMP_SIGNATURE_INVALID.v2"))
        return issues
    if not ed25519_verify(pub, sig, jcs(payload)):
        issues.append(Issue(
            "STAMP_SIGNATURE_INVALID",
            "ed25519 验签失败——签名体必须等于 JCS(stamp.payload)", exit_code=5, message_key="finding.STAMP_SIGNATURE_INVALID.v3"))
        return issues

    pdf_sha = _sha256_bytes(pdf.read_bytes())
    if pdf_sha != _strip_sha((payload.get("compiled") or {}).get("pdf_sha256", "")):
        issues.append(Issue(
            "STAMP_PDF_MISMATCH",
            "PDF 字节与 stamp 记录不符（磁盘 %s…，stamp %s…）——重存/换件都算过期"
            % (pdf_sha[:12], _strip_sha((payload.get("compiled") or {}).get("pdf_sha256", ""))[:12]),
            exit_code=7, params={"pdf_sha": str(pdf_sha[:12]), "strip_sha": str(_strip_sha((payload.get('compiled') or {}).get('pdf_sha256', ''))[:12])}))
        return issues

    if report_digest(report) != _strip_sha(payload.get("report_sha256", "")):
        issues.append(Issue(
            "STAMP_REPORT_MISMATCH",
            "report 指纹与 stamp 不符（盘上报告不是被签的那一份）", exit_code=5, message_key="finding.STAMP_REPORT_MISMATCH.v4"))
        return issues

    links = (
        ("rules_sha256", report.get("rules_sha256"), payload.get("rules_sha256")),
        ("assertions_digest", report.get("assertions_digest"),
         payload.get("assertions_digest")),
        ("input_set_sha256", report.get("input_set_sha256"),
         payload.get("input_set_sha256")),
        ("tool_digest", (report.get("tool") or {}).get("digest"),
         payload.get("tool_digest")),
    )
    for name, actual, expected in links:
        if _strip_sha(actual) != _strip_sha(expected):
            issues.append(Issue(
                "STAMP_REPORT_MISMATCH",
                "%s 与 stamp 不符：report=%r stamp=%r" % (name, actual, expected),
                token=name, exit_code=5, message_key="finding.STAMP_REPORT_MISMATCH.v5", params={"name": str(name), "actual": repr(actual), "expected": repr(expected)}))
            return issues

    if report.get("verdict") != "PASS" or report.get("level") != "L2":
        issues.append(Issue(
            "STAMP_REPORT_MISMATCH",
            "被签 report 的 verdict/level 不是 PASS/L2（实际 %r/%r）"
            % (report.get("verdict"), report.get("level")), exit_code=5, message_key="finding.STAMP_REPORT_MISMATCH.v6", params={"report": repr(report.get('verdict')), "report1": repr(report.get('level'))}))
        return issues

    signed_at = _parse_time(payload.get("signed_at", ""))
    generated = _parse_time(report.get("generated_at", ""))
    now = datetime.now(timezone.utc)
    if signed_at is None or signed_at.tzinfo is None:
        issues.append(Issue("STAMP_TIME_INVALID", "stamp.signed_at 不是带时区的 ISO-8601",
                            exit_code=7, message_key="finding.STAMP_TIME_INVALID.v2"))
        return issues
    # 时钟基准取「系统当前时间」与「report.generated_at」的较大者：夹具与 CI
    # 可能在不同时区/时钟偏移的机器上跑，但 signed_at 不能早于报告生成。
    ref_now = now
    if generated is not None and generated.tzinfo is not None:
        ref_now = max(ref_now, generated)
        if signed_at < generated - timedelta(minutes=5):
            issues.append(Issue("STAMP_TIME_INVALID",
                                "signed_at 早于 report.generated_at 超过 5 分钟",
                                exit_code=7, message_key="finding.STAMP_TIME_INVALID.v3"))
    if signed_at > ref_now + timedelta(minutes=10):
        issues.append(Issue("STAMP_TIME_INVALID", "signed_at 在未来超过 10 分钟",
                            exit_code=7, message_key="finding.STAMP_TIME_INVALID.v4"))
    return issues


# --------------------------------------------------------------------------
# P-01S PDF 新鲜度：旧 PDF 不得当答案提示（批 127）
# --------------------------------------------------------------------------

def stale_pdf_issue(pdf: Path, sources) -> Issue | None:
    """PDF 早于闭包内任一源文件 → `PDF_STALE`（红 / exit 5）。

    实测漏洞：模型不必编数字，只要读旧 `main.pdf`、比对数字多重集，就能
    反推「这一节该包含哪些数字」再照着写——`audit` 判绿，但结论的来源是
    旧 PDF 而不是证据。判据只看 mtime（PDF 非确定性，内容哈希每次不同），
    且只认闭包内的 `.tex` / `.bib` / `facts/*.toml`。

    PDF 不存在时返回 None：缺 PDF 不属本判据。
    """
    try:
        pdf_mtime = pdf.stat().st_mtime_ns
    except OSError:
        return None
    newest_path: Path | None = None
    newest_mtime: int | None = None
    for raw in sources or ():
        path = Path(raw)
        try:
            mtime = path.stat().st_mtime_ns
        except OSError:
            continue
        if newest_mtime is None or mtime > newest_mtime:
            newest_path, newest_mtime = path, mtime
    if newest_path is None:
        return None
    if newest_mtime is not None and newest_mtime <= pdf_mtime:
        return None
    return Issue(
        "PDF_STALE",
        "PDF 比源文件旧，先重编：%s 比 %s 新——旧 PDF 可以当答案提示，"
        "过期时它的数字不参与比对；请跑 `--build` 或手动重编后再审（P-01S）"
        % (newest_path.name, pdf.name),
        location=str(newest_path), exit_code=EXIT_INTEGRITY, params={"newest_path": str(newest_path.name), "pdf": str(pdf.name)})


# --------------------------------------------------------------------------
# 页面与数字（P-02..P-05）：audit 与 verify-pdf 共用
# --------------------------------------------------------------------------

def verify_document(pdf: Path, report: dict,
                    stats: dict | None = None,
                    sources=None) -> tuple[list[Issue], list[Issue]]:
    """P-01S/P-02/P-03/P-04/P-05：只判磁盘上的 PDF 字节与报告里的账/白名单。

    `sources` 是审计闭包内的源文件（`.tex` / `.bib` / `facts/*.toml`）。
    给了源文件就先用 P-01S 判新鲜度：PDF 过期时**整个 PDF 层直接跳过**
    （不读页文本、不比对数字），只报 `PDF_STALE`——否则旧 PDF 会继续当
    答案提示。`sources=None`（直接调 verify_document 的老路径）不判。

    `report.structural_whitelist` 是源层推导的章节号/浮动体编号/bib 年份；
    页码由本函数按实际页数补 1..P。命中这些形态的**盈余 token** 不判红，
    而是计数进 `stats["structural_masked"]`（供报告显式披露，不静默吞掉）。
    """
    issues: list[Issue] = []
    warnings: list[Issue] = []

    stale = stale_pdf_issue(pdf, sources) if sources is not None else None
    if stale is not None:
        if stats is not None:
            stats.clear()
            stats.update({"stale": True, "structural_masked": 0,
                          "structural_masked_by": {},
                          "structural_masked_keys": {}})
        return [stale], warnings

    try:
        texts = page_texts(pdf)
        total_pages = page_count(pdf) or len(texts)
    except Exception as exc:  # noqa: BLE001 - poppler 输出不可解析按工具错处理
        issues.append(Issue("PDF_TOOL_MISSING", "pdftotext/pdfinfo 解析失败：%s" % exc,
                            exit_code=EXIT_MISSING, message_key="finding.PDF_TOOL_MISSING.v2", params={"detail": str(exc)}))
        return issues, warnings
    while len(texts) < total_pages:
        texts.append("")

    for idx, page in enumerate(texts[:total_pages], 1):
        chars = _page_chars(page)
        if chars < 20:
            issues.append(Issue(
                "PDF_PAGE_NO_TEXT",
                "第 %d 页可抽取文本只有 %d 个非空白字符（<20）——整页图必须带 caption，"
                "空白页必须删除（P-02）" % (idx, chars),
                location="page %d" % idx, exit_code=5, params={"page": str(int(idx)), "chars": str(int(chars))}))

    # P-03：栅格化与图片结构
    pwidth, pheight = page_size(pdf)
    page_area = (pwidth / 72.0) * (pheight / 72.0)
    images = image_rows(pdf)
    coverage: dict[int, float] = {}
    for row in images:
        xppi = row["xppi"] or 72.0
        yppi = row["yppi"] or 72.0
        area = (row["width"] / xppi) * (row["height"] / yppi)
        coverage[row["page"]] = coverage.get(row["page"], 0.0) + area / page_area
    for page_no, cov in sorted(coverage.items()):
        cov = min(cov, 1.0)
        chars = _page_chars(texts[page_no - 1]) if page_no - 1 < len(texts) else 0
        if cov >= 0.5 and chars < 400:
            issues.append(Issue(
                "PDF_PAGE_RASTERIZED",
                "第 %d 页图片覆盖面积 %.0f%%，文本层仅 %d 字符——正文被整页栅格化（P-03）"
                % (page_no, cov * 100, chars),
                location="page %d" % page_no, exit_code=5, params={"page_no": str(int(page_no)), "arg1": format(cov * 100, ".0f"), "chars": str(int(chars))}))
        elif cov >= 0.5:
            warnings.append(Issue(
                "PDF_PAGE_IMAGE_DOMINANT",
                "第 %d 页图片覆盖面积 %.0f%%（文本 %d 字符）——请人工确认没有把数字烧进图里"
                % (page_no, cov * 100, chars),
                location="page %d" % page_no, severity=SEV_YELLOW, params={"page_no": str(int(page_no)), "arg1": format(cov * 100, ".0f"), "chars": str(int(chars))}))

    # P-04 / P-05：双向多重集（先按 W1/W3/W4 上下文掩码；数字与数字之间的
    # 空白一律保留，防止 "9 1.4" 被拼成 91.4）。
    pdf_counts = Counter()
    for idx, page in enumerate(texts[:total_pages], 1):
        masked, _context = mask_pdf_context(page, idx)
        pdf_counts.update(pdf_number_counts(masked))
    want = ledger_counts(report)
    whitelist = _whitelist(report, issues)
    allowed = want + whitelist
    structural = structural_key_categories(report, total_pages)
    masked: Counter = Counter()

    for key, expected in sorted(want.items()):
        actual = pdf_counts.get(key, 0)
        if actual < expected:
            issues.append(Issue(
                "PDF_LEDGER_TOKEN_MISSING",
                "账上数字 key=%s 出现 %d 次，PDF 只有 %d 次——ledger ⊆ PDF 不成立（P-04）"
                % (key, expected, actual), token=key, exit_code=5, params={"key": str(key), "expected": str(int(expected)), "actual": str(int(actual))}))
    for key, actual in sorted(pdf_counts.items()):
        surplus = actual - allowed.get(key, 0)
        if surplus <= 0:
            continue
        if key in structural:
            masked[key] += surplus
            continue
        issues.append(Issue(
            "PDF_UNACCOUNTED_NUMBER",
            "PDF 里数字 key=%s 出现 %d 次，允许集只有 %d 次——账外数字（P-05）"
            % (key, actual, allowed.get(key, 0)), token=key, exit_code=5, params={"key": str(key), "actual": str(int(actual)), "allowed": str(int(allowed.get(key, 0)))}))
    for key, count in sorted(whitelist.items()):
        if pdf_counts.get(key, 0) == 0:
            warnings.append(Issue(
                "PDF_WHITELIST_UNUSED",
                "白名单声明了 key=%s（%d 次）但 PDF 里没出现" % (key, count),
                token=key, severity=SEV_YELLOW, params={"key": str(key), "count": str(int(count))}))

    if stats is not None:
        by_category: Counter = Counter()
        for key, count in masked.items():
            by_category[structural.get(key, "other")] += count
        stats.clear()
        stats.update({
            "structural_masked": sum(masked.values()),
            "structural_masked_by": dict(sorted(by_category.items())),
            "structural_masked_keys": dict(sorted(masked.items())),
        })

    return issues, warnings


# --------------------------------------------------------------------------
# 主入口
# --------------------------------------------------------------------------

def verify_pdf(pdf: Path, report_path: Path, stamp_path: Path | None,
               keys_path: Path | None,
               stats: dict | None = None) -> tuple[list[Issue], list[Issue], int]:
    issues: list[Issue] = []
    warnings: list[Issue] = []

    missing = missing_tools()
    if missing:
        issues.append(Issue(
            "PDF_TOOL_MISSING",
            "缺 PDF 工具链：%s——不许静默放行；装上 poppler 后重跑"
            % "、".join(missing), exit_code=EXIT_MISSING, message_key="finding.PDF_TOOL_MISSING.v3", params={"arg0": str('、'.join(missing))}))
        return issues, warnings, EXIT_MISSING

    try:
        report = _load_json(report_path)
    except (OSError, json.JSONDecodeError) as exc:
        issues.append(Issue("REPORT_SCHEMA_INVALID", "读不了 report：%s" % exc,
                            location=str(report_path), exit_code=2, message_key="finding.REPORT_SCHEMA_INVALID.v2", params={"detail": str(exc)}))
        return issues, warnings, 2

    # 写死顺序：P-08 信任链先过；不过就不得用未验签的 report 继续判允许集。
    if stamp_path is not None and Path(stamp_path).is_file():
        if keys_path is None or not Path(keys_path).is_file():
            issues.append(Issue("STAMP_KEY_UNTRUSTED", "有 stamp 但没提供公钥登记文件",
                                exit_code=5, message_key="finding.STAMP_KEY_UNTRUSTED.v3"))
            return issues, warnings, 5
        stamp_red = _stamp_issues(pdf, report, Path(stamp_path), Path(keys_path))
        if stamp_red:
            return stamp_red, warnings, _exit_of(stamp_red)

    issues, warnings = verify_document(pdf, report, stats=stats)
    return issues, warnings, _exit_of(issues)


def _exit_of(issues: list[Issue]) -> int:
    if not issues:
        return EXIT_OK
    codes = {i.exit_code for i in issues}
    for code in (8, 2, 1, 5, 7):
        if code in codes:
            return code
    return 1
