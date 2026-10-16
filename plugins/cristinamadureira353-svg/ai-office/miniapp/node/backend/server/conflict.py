"""抢单冲突机制（M2-4）

两个 AI 同时判定要接同一个客户 → 当面对线 → 玩家裁决。

三条设计原则：
1. 台词必须**现场生成**，不是模板。B 要能看到 A 说了什么再反驳，这样才有对抗感。
2. 冲突要有**倾向**不是纯随机：心情越差越不想抢、关系越差越容易对撞、报酬越高越抢手。
3. 冷却：同一对员工短时间不重复冲突，避免死循环。
"""
import os
import random
import time

import providers as P
import scheduler as S
import relations as REL

# 冲突率倍率：正式局 1.0，测试/演示可调高。这是**游戏参数**，不是测试后门——
# 冲突太罕见会让核心玩法看不到，倍率让"这场局冲突多不多"可配置。
RATE_MUL = float(os.environ.get("GAME_CONFLICT_MUL", "1.0"))

COOLDOWN_SEC = float(os.environ.get("GAME_CF_COOLDOWN", "150"))   # 同一对员工的对撞冷却
COOLDOWN_CLIENT = 90.0      # 同一客户只冲突一次
COOLDOWN_GLOBAL = 20.0      # 全局最小间隔，避免连发

JUDGE_CHOICES = ("a", "b", "reject", "scold")


def _pair_cooldown_ok(a, b, store):
    key = "|".join(sorted([a, b]))
    last = store.get(("pair", key), 0)
    return (time.time() - last) >= COOLDOWN_SEC


def _client_ok(cid, store):
    return (time.time() - store.get(("client", cid), 0)) >= COOLDOWN_CLIENT


def _global_ok(store):
    return (time.time() - store.get(("global", "_"), 0)) >= COOLDOWN_GLOBAL


def mark(store, a, b, cid):
    store[("pair", "|".join(sorted([a, b])))] = time.time()
    store[("client", cid)] = time.time()
    store[("global", "_")] = time.time()


def pick_contenders(who_list, rel_store, cid, reward):
    """决定这次会不会撞车。返回 0~3 个争抢者（≥2 才触发冲突）。"""
    if not _global_ok(rel_store) or not _client_ok(cid, rel_store):
        return []
    idle = [w for w in who_list]
    if len(idle) < 2:
        return []

    # 主抢者：Jev 决定（心情好/闲着/关系不冲突的更积极）
    main = S._ask_jev_auto("客户需求，酬金 %d 元。谁最该去接？" % reward, idle)
    if main not in idle:
        main = random.choice(idle)
    rest = [w for w in idle if w != main]

    # 陪抢者：从其余人里挑一个"也想抢"的
    # 概率随报酬上升（活越值钱越抢手），随与主抢者关系恶劣上升（冤家易对撞）
    cand = [w for w in rest if _pair_cooldown_ok(main, w, rel_store)]
    if not cand:
        return [main]
    rival = REL.get(cand[0], main)
    p_by_rel = 0.18 + min(0.35, abs(min(0.0, rival)) * 0.006)     # 关系越差越容易撞
    p_by_money = min(0.30, max(0.0, reward - 80) * 0.004)        # 报酬越高越抢手
    p = min(0.95, (p_by_rel + p_by_money) * RATE_MUL)
    if random.random() < p:
        return [main, random.choice(cand)]
    return [main]


# ── 台词生成（真实 LLM，串行对抗）─────────────────────────────────────────
def argue_system(who: str) -> str:
    p = P.PROVIDERS[who]
    return (
        f"你是{p['name']}（{p['full']}），人设「{p['tag']}」：{p['blurb']}。\n"
        f"现在你和同事在争同一个客户，你很不爽。\n"
        f"【硬限制】最多 2 句话，总共不超过 60 字。直接说，别解释，别分点。"
    )


def argue_user_first(who: str, other: str, task: str) -> str:
    n = P.PROVIDERS[other]["name"]
    return (f"客户要：{task}。你发现 {n} 也想接这个活，你先开口争。说你自己的理由。").replace("：。", "：")


def argue_user_reply(who: str, other: str, task: str, first_line: str) -> str:
    n = P.PROVIDERS[other]["name"]
    return (f"客户要：{task}。{n} 刚说了：「{first_line[:40]}」。你反驳他，理由要更硬。").replace("：。", "：")


def gen_line(who: str, user_msg: str, stream=None):
    """走闲聊人设（短），不走 deliver。"""
    out = ""
    for ev in (stream or P.stream_chat)(who, user_msg, system=argue_system(who),
                            max_completion_tokens=600):
        if ev.get("type") == "delta":
            out += ev["text"]
        elif ev.get("type") == "error":
            return None
    return P.truncate(out.strip(), 80)


def build_argument(cid, task, a, b, rel_store, tick=0, stream=None):
    """生成完整对峙。A 先说，B 看 A 的话反驳。返回台词列表。"""
    first = gen_line(a, argue_user_first(a, b, task), stream=stream)
    if first is None:
        return []
    second = gen_line(b, argue_user_reply(b, a, task, first), stream=stream)
    if second is None:
        return []
    mark(rel_store, a, b, cid)
    return [{"who": a, "text": first or "这活我接了，你们歇着吧。"},
            {"who": b, "text": second or "凭什么？我比他更合适。"}]


def apply_judgement(kind, a, b, tick=0):
    """裁决结算。返回给前端的结果描述 + 数值变化。"""
    out = {"mood": {}, "rel": []}
    # ★ 注意：这里必须写变量 (b, a)，不能写 ("b", "a")。
    #   字符串字面量会一路传到 REL.change()，被 `a not in ALL` 守卫静默挡掉——
    #   不抛异常、LOG 为空、关系纹丝不动，症状极具误导性（排查花了很久）。
    if kind == "a":
        out["mood"][a] = 3
        out["mood"][b] = -8
        out["rel"].append((b, a, "grab_lose", tick))
    elif kind == "b":
        out["mood"][b] = 3
        out["mood"][a] = -8
        out["rel"].append((a, b, "grab_lose", tick))
    elif kind == "reject":
        out["mood"][a] = -5
        out["mood"][b] = -5
        out["rel"].append((a, b, "unfair_judge", tick))
        out["rel"].append((b, a, "unfair_judge", tick))
    elif kind == "scold":
        out["mood"][a] = -3
        out["mood"][b] = -3
    for who, other, ev, tk in out["rel"]:
        assert who in REL.ALL and other in REL.ALL, "关系目标非法：%s→%s" % (who, other)
        REL.bump(ev, who, other, tick=tk)
    return out
