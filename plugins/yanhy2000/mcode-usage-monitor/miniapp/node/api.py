#!/usr/bin/env python3
"""mcode-usage-monitor Mini App 的数据后端（一次性 CLI 模式）。

由 Node 入口(server.mjs)按需 spawn，查询结果以单个 JSON 写到 stdout 后退出。
不做 HTTP 监听：Mini App 运行时内 Node 到本机端口的直连不可用，子进程 stdout 是稳定通道。
数据逻辑:
  - SQLite 官方 backup API 只读快照(不锁库, 不影响运行中的 MiniMax Code)
  - 按 msg_id 跨会话去重(保留最早一条)
  - 时间分桶 / 模型聚合 / 项目聚合 / 工具统计 / 最近调用

用法: python api.py [--range all|today|1h|12h|24h|7d|30d|<N>h] [--models a,b] [--db PATH]
  <N>h 为自定义整数小时, 允许 1..8760
"""

import argparse
import base64
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def data_dir() -> Path:
    return Path(os.environ.get("MINIMAX_DATA_DIR") or (Path.home() / ".minimax"))


def default_db_path() -> Path:
    return data_dir() / "v2" / "sqlite" / "runtime-state.sqlite"


def open_snapshot(db_path: Path) -> sqlite3.Connection:
    """只读快照: 官方 backup API 优先, 极端锁场景回退到复制三件套。"""
    try:
        uri = f"file:{db_path.as_posix()}?mode=ro"
        src = sqlite3.connect(uri, uri=True, timeout=3)
        dst = sqlite3.connect(":memory:")
        with dst:
            src.backup(dst)
        src.close()
        return dst
    except sqlite3.Error:
        tmpdir = Path(tempfile.mkdtemp(prefix="mcode-usage-monitor-"))
        try:
            base = tmpdir / "snap.db"
            shutil.copy2(db_path, base)
            for suffix in ("-wal", "-shm"):
                side = Path(str(db_path) + suffix)
                if side.exists():
                    shutil.copy2(side, Path(str(base) + suffix))
            con = sqlite3.connect(str(base))
            con.execute("PRAGMA journal_mode=DELETE")
            return con
        except Exception:
            shutil.rmtree(tmpdir, ignore_errors=True)
            raise


MSG_SQL = """
SELECT m.created_at_ms AS ts,                            -- [0]
       json_extract(m.data_json,'$.context_usage_telemetry.model') AS model,  -- [1]
       m.session_id,                                     -- [2]
       m.turn_id,                                        -- [3]
       json_extract(m.data_json,'$.usage.input_tokens')    AS inp,   -- [4]
       json_extract(m.data_json,'$.usage.output_tokens')   AS outp,  -- [5]
       json_extract(m.data_json,'$.usage.cache_read')      AS cr,    -- [6]
       json_extract(m.data_json,'$.usage.request_duration_ms') AS dur, -- [7]
       s.title AS session_title,                         -- [8]
       s.workspace_dir AS ws,                            -- [9]
       (SELECT group_concat(json_extract(j.value,'$.tool_name'))
          FROM json_each(m.data_json,'$.tool_calls') j) AS tools,    -- [10]
       m.msg_id                                          -- [11] 去重键(保持最后一列)
FROM local_runtime_message_rows m
LEFT JOIN local_runtime_sessions s ON s.session_id = m.session_id
WHERE json_extract(m.data_json,'$.usage') IS NOT NULL
ORDER BY m.created_at_ms, m.id
"""

LEDGER_SQL = """
SELECT COUNT(*), SUM(input_tokens), SUM(output_tokens), SUM(reasoning_tokens),
       SUM(cache_read_tokens), SUM(cache_write_tokens), MIN(ts), MAX(ts),
       COUNT(DISTINCT session_id), COUNT(DISTINCT turn_id)
FROM local_runtime_token_usage
"""


def dedup_by_msg_id(rows):
    """按 msg_id 跨会话去重(保留最早一条), 返回 (去重后的行, 丢弃行数)。"""
    seen = set()
    out = []
    dropped = 0
    for r in rows:
        mid = r[-1]
        if mid is None or mid not in seen:
            if mid is not None:
                seen.add(mid)
            out.append(r)
        else:
            dropped += 1
    return out, dropped


def fetch_all(db_path: Path):
    con = open_snapshot(db_path)
    try:
        rows, dropped = dedup_by_msg_id(con.execute(MSG_SQL).fetchall())
        try:
            ledger = con.execute(LEDGER_SQL).fetchone()
        except sqlite3.Error:
            ledger = None
    finally:
        con.close()
    return rows, ledger, dropped


RANGE_MS = {"1h": 3600_000, "12h": 12 * 3600_000, "24h": 86400_000,
            "7d": 7 * 86400_000, "30d": 30 * 86400_000, "all": None}
CUSTOM_RANGE_RE = re.compile(r"(\d+)h")
MAX_CUSTOM_HOURS = 8760  # 一年, 上限防爆(下限 1, 负号/小数/超限一律不匹配)


def is_valid_range(key: str) -> bool:
    if key in RANGE_MS or key == "today":
        return True
    m = CUSTOM_RANGE_RE.fullmatch(key or "")
    return bool(m) and 1 <= int(m.group(1)) <= MAX_CUSTOM_HOURS


def range_cutoff_ms(range_key: str, now_ms: int):
    """返回筛选下限(ms); None 表示不过滤(all)。today = 本地当天 00:00。"""
    if range_key == "today":
        lt = time.localtime(now_ms / 1000)
        midnight = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1))
        return int(midnight * 1000)
    m = CUSTOM_RANGE_RE.fullmatch(range_key or "")
    if m:
        return now_ms - int(m.group(1)) * 3600_000
    span = RANGE_MS.get(range_key)
    return now_ms - span if span is not None else None


def pick_bucket_step(span_ms: int) -> int:
    for step in (600_000, 3_600_000, 3 * 3_600_000, 6 * 3_600_000,
                 86_400_000, 7 * 86_400_000):
        if span_ms <= step * 120:
            return step
    return 30 * 86_400_000


def fmt_bucket_label(ts_ms: int, step_ms: int) -> str:
    lt = time.localtime(ts_ms / 1000)
    if step_ms < 86_400_000:
        return time.strftime("%m-%d %H:%M", lt)
    if step_ms < 7 * 86_400_000:
        return time.strftime("%m-%d", lt)
    return time.strftime("%Y-%m-%d", lt)


def discover_session_files(db_path: Path) -> dict:
    """扫描 <data root>/v2/sessions 下真实存在的会话文件。

    只有目录里带 messages.jsonl 的才算真正的会话文件；目录名形如
    01-26-32-226-session_<base64(session_id)>，由此还原会话 id。
    返回 {session_id: {"mtime": ms, "size": bytes}}。
    """
    root = db_path.parent.parent / "sessions"
    found = {}
    if not root.is_dir():
        return found
    for f in root.rglob("messages.jsonl"):
        name = f.parent.name
        if "-session_" not in name:
            continue
        b64 = name.split("-session_", 1)[1]
        try:
            sid = base64.b64decode(b64 + "=" * (-len(b64) % 4)).decode("utf-8")
        except Exception:
            continue
        try:
            st = f.stat()
        except OSError:
            continue
        found[sid] = {"mtime": int(st.st_mtime * 1000), "size": st.st_size}
    return found


WS_UNKNOWN_KEY = "\x00unknown"
WS_TEMP_KEY = "\x00temp"
WS_UNKNOWN_LABEL = "(未知工作区)"
WS_TEMP_LABEL = "(无项目对话)"


def is_temp_workspace(ws: str) -> bool:
    """会话临时工作区固定形如 <dataDir>/sessions/mvs_<id>/workspace, 整体归并为一组。

    跟随 MINIMAX_DATA_DIR: 与数据库位置同一口径。
    """
    base = os.path.normcase(str(data_dir()).replace("/", "\\")).rstrip("\\")
    return os.path.normcase(str(ws).replace("/", "\\")).startswith(base + "\\sessions\\mvs_")


def ws_parts(ws):
    """工作区 -> (分组键, 展示用路径段, 完整路径)。

    空值与临时会话目录归入固定分组, 完整路径留空; 其余按完整路径分组, 展示取末级目录。
    """
    if not ws:
        return WS_UNKNOWN_KEY, [WS_UNKNOWN_LABEL], ""
    if is_temp_workspace(ws):
        return WS_TEMP_KEY, [WS_TEMP_LABEL], ""
    full = str(ws).replace("/", "\\").rstrip("\\")
    segs = [s for s in full.split("\\") if s]
    if not segs:
        return WS_UNKNOWN_KEY, [WS_UNKNOWN_LABEL], ""
    return full, segs, full


def project_label(segs, all_segs):
    """展示名取末级目录; 与其他项目重名时逐级补上父目录, 保证图上可区分。"""
    for depth in range(1, len(segs) + 1):
        label = "/".join(segs[-depth:])
        if sum(1 for o in all_segs if "/".join(o[-depth:]) == label) == 1:
            return label
    return "/".join(segs)


def build_payload(db_path: Path, range_key: str, models_filter=None,
                  sessions_filter=None) -> dict:
    rows_all, ledger, dedup_dropped = fetch_all(db_path)
    now_ms = int(time.time() * 1000)
    cutoff = range_cutoff_ms(range_key, now_ms)
    if cutoff is not None:
        rows_all = [r for r in rows_all if r[0] >= cutoff]
    span = (now_ms - cutoff) if cutoff is not None else None

    avail = {}
    for r in rows_all:
        key = r[1] or "unknown"
        m = avail.setdefault(key, {"model": key, "calls": 0, "output": 0})
        m["calls"] += 1
        m["output"] += r[5] or 0
    available_models = sorted(avail.values(), key=lambda x: -x["output"])

    # 会话清单以磁盘上的真实会话文件为准（与产品内展示口径一致）
    stats = {}
    for r in rows_all:
        d = stats.setdefault(r[2], {"title": r[8] or "", "calls": 0, "tokens": 0, "last_ts": r[0]})
        d["calls"] += 1
        d["tokens"] += (r[4] or 0) + (r[5] or 0) + (r[6] or 0)
        d["last_ts"] = max(d["last_ts"], r[0])

    files = discover_session_files(db_path)
    available_sessions = []
    if files:
        session_source = "files"
        for sid, meta in files.items():
            st = stats.get(sid)
            if not st:  # 当前时间范围内没有用量: 不列出(此时标题也无从取得)
                continue
            available_sessions.append({
                "session_id": sid,
                "title": st["title"] or sid,
                "calls": st["calls"],
                "tokens": st["tokens"],
                "last_ts": st["last_ts"],
                "file_mtime": meta["mtime"],
            })
        available_sessions.sort(key=lambda x: -x["file_mtime"])
    else:  # 兜底：一个会话文件都没有时，退回按库内会话列举
        session_source = "db"
        for sid, st in stats.items():
            available_sessions.append({
                "session_id": sid,
                "title": st["title"] or sid,
                "calls": st["calls"], "tokens": st["tokens"], "last_ts": st["last_ts"],
            })
        available_sessions.sort(key=lambda x: -x["last_ts"])

    rows = rows_all
    if models_filter:
        wanted = set(models_filter)
        rows = [r for r in rows if (r[1] or "unknown") in wanted]
    if sessions_filter:
        wanted_s = set(sessions_filter)
        rows = [r for r in rows if r[2] in wanted_s]

    n = len(rows)
    sum_in = sum((r[4] or 0) for r in rows)
    sum_out = sum((r[5] or 0) for r in rows)
    sum_cr = sum((r[6] or 0) for r in rows)
    sum_dur = sum((r[7] or 0) for r in rows)
    hit_rate = (sum_cr / (sum_cr + sum_in) * 100) if (sum_cr + sum_in) else 0.0
    tok_s = (sum_out / (sum_dur / 1000)) if sum_dur else 0.0
    sessions = {r[2] for r in rows}

    series = []
    split = {"labels": [], "models": []}
    if n:
        lo, hi = rows[0][0], rows[-1][0]
        span_ms = max(hi - lo, 1)
        step = pick_bucket_step(span_ms if span is None else min(span, span_ms))
        buckets = {}
        per_model = {}
        for r in rows:
            b = r[0] // step * step
            d = buckets.setdefault(b, [0, 0, 0, 0, 0])
            d[0] += r[4] or 0
            d[1] += r[5] or 0
            d[2] += r[6] or 0
            d[3] += 1
            d[4] += r[7] or 0
            mk = r[1] or "unknown"
            pm = per_model.setdefault(mk, {})
            pm[b] = pm.get(b, 0) + (r[5] or 0)
        keys = sorted(buckets)
        for b in keys:
            d = buckets[b]
            series.append({
                "label": fmt_bucket_label(b, step),
                "input": d[0], "output": d[1], "cache_read": d[2],
                "calls": d[3],
                "tok_s": round(d[1] / (d[4] / 1000), 1) if d[4] else 0,
            })
        models_sorted = sorted(per_model, key=lambda m: -sum(per_model[m].values()))
        split = {
            "labels": [fmt_bucket_label(b, step) for b in keys],
            "models": [{"model": m, "output": [per_model[m].get(b, 0) for b in keys]}
                       for m in models_sorted],
        }

    models = {}
    for r in rows:
        m = models.setdefault(r[1] or "unknown",
                              {"model": r[1] or "unknown", "calls": 0,
                               "input": 0, "output": 0, "cache_read": 0, "dur": 0})
        m["calls"] += 1
        m["input"] += r[4] or 0
        m["output"] += r[5] or 0
        m["cache_read"] += r[6] or 0
        m["dur"] += r[7] or 0
    model_list = []
    for m in sorted(models.values(), key=lambda x: -(x["output"] + x["input"] + x["cache_read"])):
        tot_in = m["cache_read"] + m["input"]
        model_list.append({
            "model": m["model"], "calls": m["calls"],
            "input": m["input"], "output": m["output"],
            "cache_read": m["cache_read"],
            "hit_rate": round(m["cache_read"] / tot_in * 100, 1) if tot_in else 0,
            "avg_dur_ms": round(m["dur"] / m["calls"]) if m["calls"] else 0,
            "tok_s": round(m["output"] / (m["dur"] / 1000), 1) if m["dur"] else 0,
        })

    recent = []
    for r in reversed(rows[-60:]):
        dur = r[7] or 0
        title = r[8] or r[2] or ""
        recent.append({
            "ts": r[0],
            "time": time.strftime("%m-%d %H:%M:%S", time.localtime(r[0] / 1000)),
            "model": r[1] or "unknown",
            "session": (title[:24] + "…") if len(title) > 25 else title,
            "session_id": r[2], "turn_id": (r[3] or "")[:8],
            "input": r[4] or 0, "output": r[5] or 0, "cache_read": r[6] or 0,
            "dur_ms": dur,
            "tok_s": round((r[5] or 0) / (dur / 1000), 1) if dur else 0,
        })

    # 项目维度: 按会话工作区目录汇总(跟随当前筛选)
    projects = {}
    for r in rows:
        key, segs, full = ws_parts(r[9])
        p = projects.get(key)
        if p is None:
            p = projects[key] = {"segs": segs, "dir": full, "calls": 0,
                                 "input": 0, "output": 0, "cache_read": 0}
        p["calls"] += 1
        p["input"] += r[4] or 0
        p["output"] += r[5] or 0
        p["cache_read"] += r[6] or 0
    top = sorted(projects.values(),
                 key=lambda x: -(x["input"] + x["output"] + x["cache_read"]))[:8]
    all_segs = [p["segs"] for p in top]
    project_list = []
    for p in top:
        project_list.append({"name": project_label(p["segs"], all_segs),
                             "dir": p["dir"], "calls": p["calls"], "input": p["input"],
                             "output": p["output"], "cache_read": p["cache_read"],
                             "tokens": p["input"] + p["output"] + p["cache_read"]})

    # 工具调用: 从每条响应的 tool_calls 提取名称计数(跟随当前筛选)
    tool_counter = {}
    for r in rows:
        names = r[10]
        if not names:
            continue
        for name in names.split(","):
            if name:
                tool_counter[name] = tool_counter.get(name, 0) + 1
    tool_list = [{"tool": k, "calls": v} for k, v in
                 sorted(tool_counter.items(), key=lambda x: -x[1])[:10]]

    ledger_obj = None
    if ledger:
        ledger_obj = {
            "rows": ledger[0], "input": ledger[1], "output": ledger[2],
            "reasoning": ledger[3], "cache_read": ledger[4],
            "cache_write": ledger[5],
            "sessions": ledger[8], "turns": ledger[9],
        }
        if ledger[6]:
            ledger_obj["first_ts"] = ledger[6]
            ledger_obj["last_ts"] = ledger[7]

    return {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "range": range_key,
        "available_models": available_models,
        "selected_models": sorted(models_filter) if models_filter else [],
        "dedup_dropped": dedup_dropped,
        "overview": {
            "calls": n,
            "sessions": len(sessions),
            "input_tokens": sum_in,
            "output_tokens": sum_out,
            "cache_read_tokens": sum_cr,
            "total_tokens": sum_in + sum_cr + sum_out,
            "hit_rate_pct": round(hit_rate, 2),
            "avg_tok_s": round(tok_s, 1),
            "sum_dur_s": round(sum_dur / 1000, 1),
        },
        "series": series,
        "split": split,
        "models": model_list,
        "available_sessions": available_sessions,
        "selected_sessions": sorted(sessions_filter) if sessions_filter else [],
        "session_files": len(available_sessions),
        "session_source": session_source,
        "recent": recent,
        "projects": project_list,
        "tools": tool_list,
        "ledger": ledger_obj,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--range", default="all", dest="range_key",
                    help="all | today | 1h | 12h | 24h | 7d | 30d | <N>h(1..8760)")
    ap.add_argument("--models", default="", help="逗号分隔的模型列表, 留空为全部")
    ap.add_argument("--sessions", default="", help="逗号分隔的会话 id 列表, 留空为全部")
    ap.add_argument("--db", default=str(default_db_path()))
    args = ap.parse_args()

    def emit(obj, code):
        sys.stdout.write(json.dumps(obj, ensure_ascii=False))
        sys.exit(code)

    rng = args.range_key if is_valid_range(args.range_key) else "all"
    models = [p.strip() for p in args.models.split(",") if p.strip()] or None
    sessions = [p.strip() for p in args.sessions.split(",") if p.strip()] or None

    db = Path(args.db)
    if not db.exists():
        emit({"error": f"database not found: {db}"}, 1)
    try:
        payload = build_payload(db, rng, models, sessions)
    except Exception as e:  # 结构化错误交给 Node, 不打 traceback
        emit({"error": str(e)}, 1)
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
