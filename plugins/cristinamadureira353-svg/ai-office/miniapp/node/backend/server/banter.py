"""路过吐槽机制（M2-5）

一个 AI 干活时，另一个路过，阴阳怪气两句。干活者可能反击。

与抢单冲突的区别：
- 抢单冲突：为了**争利益**，有明确的对立对象，必须裁决
- 路过吐槽：只是**日常摩擦**，不需要玩家介入，但会悄悄改关系和心情

触发条件（三条全满足）：
  1. 有人在干活（job != None）
  2. 有另一个人在附近（距离 ≤ NEAR_CELLS）
  3. Jev 判定"要不要开口"——这一步保证吐槽不是每对都发生

对话最多 MAX_ROUNDS 轮，避免成本失控。
"""
import os
import time

import providers as P
import scheduler as S
import relations as REL

NEAR_CELLS = float(os.environ.get("GAME_BANTER_NEAR", "4.5"))
RATE_MUL = float(os.environ.get("GAME_BANTER_MUL", "1.0"))
COOLDOWN = float(os.environ.get("GAME_BANTER_CD", "100"))     # 同一对
COOLDOWN_WORKER = float(os.environ.get("GAME_BANTER_CD_WORKER", "60"))  # 同一个干活的人
MAX_ROUNDS = 3

STORE = {}   # 冷却与防抖


def _pair_ok(a, b, store):
    key = "|".join(sorted([a, b]))
    return (time.time() - store.get(("p", key), 0)) >= COOLDOWN


def _worker_ok(worker, store):
    return (time.time() - store.get(("w", worker), 0)) >= COOLDOWN_WORKER


def mark(store, a, b, worker):
    store[("p", "|".join(sorted([a, b])))] = time.time()
    store[("w", worker)] = time.time()


def nearby_idle(worker, others, pos_fn):
    """找出在附近、且没在忙的人。"""
    out = []
    for o in others:
        if o.who == worker.who or o.job or getattr(o, "seat_cmd", False) or getattr(o, "brain_down", False):
            continue
        d = _dist(pos_fn(worker), pos_fn(o))
        if d <= NEAR_CELLS:
            out.append((o, d))
    return out


def _dist(a, b):
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


def should_speak(worker_who, passer_who, worker_mood, passer_mood, rel, store):
    """要不要开口？心情差 + 关系差 概率高；好感度高概率低。"""
    if not _pair_ok(worker_who, passer_who, store) or not _worker_ok(worker_who, store):
        return False
    p = 0.30
    p -= min(0.18, max(0.0, rel) * 0.002)          # 关系好 → 少说
    p += min(0.25, max(0, 40 - worker_mood) * 0.008)  # 干活的人心情差 → 爱抱怨
    p -= min(0.10, max(0, 60 - passer_mood) * 0.002)  # 路过的人心情好 → 懒得挑事
    p = min(0.8, max(0.02, p * RATE_MUL))
    import random
    return random.random() < p


# ── 台词 ──────────────────────────────────────────────────────────────────
def system(who: str) -> str:
    p = P.PROVIDERS[who]
    return (
        f"你是{p['name']}（{p['full']}），人设「{p['tag']}」：{p['blurb']}。\n"
        f"【硬限制】最多 2 句话，总共不超过 55 字。像真人随口说的，别写书面语。"
    )


def line(who: str, msg: str, stream=None) -> str:
    out = ""
    # ★ 额度按模型分配（providers.chat_max_tokens）：M3 思考占其输出 98%，
    #   一刀切 500 会让它思考完就没额度写正文。
    for ev in (stream or P.stream_chat)(who, msg, system=system(who),
                            max_completion_tokens=P.chat_max_tokens(who)):
        if ev.get("type") == "delta":
            out += ev["text"]
        elif ev.get("type") == "error":
            return ""
    return P.truncate(out.strip(), 75)


def build_dialog(worker_who, passer_who, task, retaliate, store, tick=0, stream=None):
    """生成 1~MAX_ROUNDS 轮。retaliate 决定干活的人要不要反击。"""
    task_short = (task or "这活")[:14]
    msgs = []
    # 第 1 轮：路过者开口
    a = line(passer_who,
             f"同事正在接「{task_short}」，你路过他工位。随口说一句带点刺的话，不超过 2 句。", stream=stream)
    if not a:
        return []
    msgs.append({"who": passer_who, "text": a, "kind": "poke"})
    if not retaliate or not msgs:
        return msgs
    # 第 2 轮：干活的人反击
    b = line(worker_who, f"有人刚阴阳怪气地说：「{a[:34]}」。你回一句，别怂。", stream=stream)
    if not b:
        return msgs
    msgs.append({"who": worker_who, "text": b, "kind": "retort"})
    if len(msgs) < MAX_ROUNDS:
        # 第 3 轮：路过者再补一刀（或认怂）
        c = line(passer_who, f"对方回你：「{b[:34]}」。你再接一句，收尾。", stream=stream)
        if c:
            msgs.append({"who": passer_who, "text": c, "kind": "poke2"})
    mark(store, worker_who, passer_who, worker_who)
    return msgs


def settle(msgs, worker, passer, tick=0):
    """结算：被吐槽的（干活的）心情掉；反击成功则吐槽者也掉；关系双向变化。

    ★ worker/passer 必须显式传入，不能从 msgs[0] 猜：
      只有 1 轮台词时 msgs[0] 就是 passer 本身，
      拿它当 victim 等于让 A 吐槽 A，`change()` 的 `a == b` 守卫会静默返回 0。
    """
    out = {"mood": {}, "rel": []}
    if not msgs:
        return out
    retaliator = None
    for m in msgs[1:]:
        if m["kind"] == "retort":
            retaliator = m["who"]
            break

    # worker 被戳，passer 嘴欠
    if worker != passer:
        out["mood"][worker] = out["mood"].get(worker, 0) - 3
        out["rel"].append((worker, passer, "banter_victim", tick))
        if retaliator and retaliator == worker:
            out["mood"][passer] = out["mood"].get(passer, 0) - 2
            out["rel"].append((passer, worker, "banter_retaliate", tick))
    for who, other, ev, tk in out["rel"]:
        if who == other:
            raise ValueError("关系目标不能是自己：%s" % who)
        REL.bump(ev, who, other, tick=tk)
    return out
