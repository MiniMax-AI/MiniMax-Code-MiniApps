"""关系网系统（M2-3）

五个 AI 之间的好感值，范围 -100 ~ +100。
它的存在意义：让"AI 互相交流"有历史、有立场，而不是每次都从零开始。

设计要点：
- 关系是**成对**的但存单向便利（A→B 与 B→A 分开存，允许不对称）
- 所有变更走 change()，自动做上下限裁剪并记日志
- 互动机制（M2-4 抢单 / M2-5 吐槽 / M2-6 甩锅）通过 bump() 写入
- Jev 决策时读关系，用来决定"结伴行动"或"避开"
"""
import itertools

ALL = ["m3", "flash", "longcat", "kimi", "step5"]
NAMES = {"m3": "M3", "flash": "Flash", "longcat": "LongCat",
         "kimi": "Kimi", "step5": "Step5"}

REL_MIN, REL_MAX = -100, 100


def _initial():
    """初始关系（DESIGN 4.3）：
    M3 与 Kimi 互相认同（同为慢思考派）；两人都嫌弃 Flash（糙、快而浅）；
    Step5 反倒欣赏 Flash 的执行力；LongCat 是老好人，谁都不得罪。
    """
    r = {}
    for a, b in itertools.permutations(ALL, 2):
        r[(a, b)] = 0
    r[("m3", "kimi")] = 30
    r[("kimi", "m3")] = 28
    r[("m3", "flash")] = -25
    r[("flash", "m3")] = -20
    r[("kimi", "flash")] = -22
    r[("flash", "kimi")] = -18
    r[("step5", "flash")] = 15
    r[("flash", "step5")] = 12
    r[("longcat", "m3")] = 8
    r[("longcat", "flash")] = 5
    r[("longcat", "kimi")] = 6
    r[("longcat", "step5")] = 9
    return r


REL = _initial()
LOG = []          # (tick, a, b, delta, reason)
VERSION = 1


def reset():
    global REL, LOG
    REL = _initial()
    LOG = []


def get(a, b) -> float:
    return REL.get((a, b), 0.0)


def change(a, b, delta, reason="", tick=0):
    """调整 a 对 b 的好感。自动裁剪到 [-100,100]。"""
    if a == b or a not in ALL or b not in ALL:
        return 0.0
    old = REL.get((a, b), 0.0)
    new = max(REL_MIN, min(REL_MAX, old + delta))
    REL[(a, b)] = new
    actual = new - old
    if actual != 0.0:
        LOG.append({"tick": tick, "a": a, "b": b, "delta": round(actual, 1),
                    "reason": reason, "value": round(new, 1)})
        LOG[:] = LOG[-200:]
    return actual


# ── 互动事件的固定增减（供 M2-4 ~ M2-7 调用）────────────────────────────
EVENT_DELTAS = {
    "grab_lose":   (-3,  "抢活输了，对赢家有意见"),
    "unfair_judge": (-5, "裁决不公平"),
    "grab_win":    (3,   "抢活赢了，得意"),
    "banter_victim": (-2, "被路过吐槽"),
    "banter_retaliate": (-1, "成功反击"),
    "blame_accused": (-4, "复盘会上被指责"),
    "blame_shift":  (1,  "成功甩锅"),
    "boss_praise": (5,   "被老板表扬"),
    "boss_scold":  (-5,  "被老板批评"),
    "work_together": (1,  "一起干活"),
    "accept_pass":  (2,  "验收通过，认可他的活"),
    "accept_fail":  (-3, "这单干砸了"),
}


def bump(event, a, b, tick=0, scale=1.0):
    """按事件名调整关系。返回实际变化量。"""
    if event not in EVENT_DELTAS:
        raise KeyError("未知关系事件：%s" % event)
    d, reason = EVENT_DELTAS[event]
    return change(a, b, d * scale, reason, tick)


# ── 关系驱动的行为（供 Jev 决策读取）──────────────────────────────────────
def allies_of(who: str, threshold=60.0):
    """好感 > threshold 的人，可能结伴行动。"""
    return [o for o in ALL if o != who and get(who, o) >= threshold]


def enemies_of(who: str, threshold=-50.0):
    """好感 < threshold 的人，Jev 会尽量不让��同时出现在同一处。"""
    return [o for o in ALL if o != who and get(who, o) <= threshold]


def quit_followers(gone, threshold=-40.0):
    """谁会因为 gone 离职而跟着走。

    判定方向是 **o → gone**（还在的人对走掉的人的好感），
    不是 gone → o：老板对谁不满，和谁对谁不满，是两回事。
    """
    return [o for o in ALL if o != gone and get(o, gone) < threshold]


def describe_pair(a, b) -> str:
    v = get(a, b)
    if v >= 60:
        return "很铁"
    if v >= 30:
        return "合得来"
    if v >= 10:
        return "还行"
    if v > -10:
        return "一般"
    if v > -30:
        return "有点摩擦"
    if v > -60:
        return "不对付"
    return "互相看不上"


def summary():
    return {f"{a}→{b}": round(get(a, b), 1)
            for a in ALL for b in ALL if a != b and get(a, b) != 0}


# ── 持久化（M4-3 存档用）─────────────────────────────────────────────────
def to_dict():
    return {"version": VERSION,
            "rel": {f"{a}|{b}": v for (a, b), v in REL.items()},
            "log": LOG[-100:]}


def from_dict(d):
    global REL, LOG, VERSION
    if not isinstance(d, dict):
        return False
    VERSION = int(d.get("version", 1))
    REL = _initial()
    for k, v in (d.get("rel") or {}).items():
        parts = k.split("|")
        if len(parts) == 2:
            REL[(parts[0], parts[1])] = max(REL_MIN, min(REL_MAX, float(v)))
    LOG = list(d.get("log") or [])[-200:]
    return True
