"""甩锅复盘机制（M2-6）

一单干砸了，全员开会互相推责任。老板（玩家）可以中途插话，插话会进入后续发言的上下文。

和 M2-4 抢单冲突、M2-5 路过吐槽的区别：
- 抢单冲突：为争利益，有明确对立对象，必须裁决
- 路过吐槽：日常摩擦，不需要玩家介入
- 甩锅复盘：**出了事故**，责任归属是会议的核心议题，必须有人被点名

三条设计要点：
1. 发言必须**串行**且带上前文，否则五个人各说各话，就不是会而是五次独白
2. "被指责"必须结构化，不能从自由文本里猜名字 —— 约定输出格式再解析
3. 老板插话和 AI 发言进同一条 history，谁先说谁后说对后面的影响是一样的
"""
import re

import providers as P
import relations as REL

# 输出格式：两行，解析失败也不崩（退化成"没点名"）
LINE_RE = re.compile(r"台词[：:]\s*(.+)")
BLAME_RE = re.compile(r"甩锅给[：:]\s*(.+)")

NAMES = {"m3": "M3", "flash": "Flash", "longcat": "LongCat",
         "kimi": "Kimi", "step5": "Step5"}

MAX_TEXT = 60          # 单句台词上限
MAX_HISTORY_CHARS = 90  # 注入上下文时每条历史截断


# ── 触发条件 ────────────────────────────────────────────────────────────────
# 失败单由 game 维护（self.failures），不在这里反推：
# 老板打回的那单在 clients 里 status 是"已完成"，事后根本查不出来，
# 所以失败必须在**发生的那一刻**就记下来，不能等结算时再数。


def should_trigger(failures, day, store):
    """有失败单 + 不是今天已经开过的复盘会，才触发。冷却一天。"""
    if not failures:
        return False
    return day > store.get("last_blame_day", -1)


# ── 会议开场 ────────────────────────────────────────────────────────────────
def brief(failures, day, workers):
    """给 LLM 的案情说明。写得具体，模型才说得具体。"""
    lines = ["第 %d 天，出事了。你们五个要开一个复盘会，说清楚这单是怎么砸的。" % day]
    for f in failures:
        who = f.get("who")
        nm = NAMES.get(who, who or "没人接")
        lines.append("失手单：「%s」——%s（当时负责：%s）"
                     % (f["task"], f["why"], nm))
    lines.append("在座：" + "、".join(NAMES[w] for w in workers))
    lines.append("每个人都要发言，要针对前面说过的话，别各说各话。")
    return "\n".join(lines)


def system(who: str) -> str:
    p = P.PROVIDERS[who]
    return (
        f"你是{p['name']}（{p['full']}），人设「{p['tag']}」：{p['blurb']}。\n"
        f"你在一个复盘会上。{p['name']}此刻的立场由你自己决定：可以认领责任、"
        f"可以甩锅、可以阴阳怪气，但要像真人开会，不要客套。\n"
        f"【输出格式：只写下面这两行，别写别的】\n"
        f"台词：（你的话，1~2 句，总共不超过 40 字）\n"
        f"甩锅给：（你要点名的同事，用英文小写 id，如 m3、flash；不甩就写 无）\n"
        f"——照这个样子写——\n"
        f"台词：这锅我不背，需求单子上就没写清楚验收标准。\n"
        f"甩锅给：m3"
    )


# ── 发言 ────────────────────────────────────────────────────────────────────
def parse(raw: str):
    """把模型输出拆成 (台词, 点名列表)。格式没按规矩来也不崩。

    ★ 兜底很重要：实测 flash/kimi 会直接写一句自然话，不带"甩锅给："。
      如果只认显式格式，"被指责最多的人"这个结算就几乎永远算不出来，
      功能会静默退化成"每次都没人背锅"。所以认不出显式标记时，
      退化成"这段话里点了谁的名"——会上的点名九成都是推责。
      但要把两条路径区分开记下来，否则兜底会掩盖"格式从来没被遵守过"。
    """
    raw = P.truncate((raw or "").strip(), 200)
    m = LINE_RE.search(raw)
    if m:
        text = m.group(1).strip()
    else:
        text = raw.splitlines()[0].strip() if raw else ""
    text = re.sub(r"^甩锅给[：:].*$", "", text).strip()
    bl = BLAME_RE.search(raw)
    blamed, explicit = [], False
    if bl:
        explicit = True
        seg = bl.group(1)
        if "无" not in seg and "不甩" not in seg and "自己" not in seg:
            for k in NAMES:
                if NAMES[k] in seg or k in seg.lower():
                    blamed.append(k)
    return P.truncate(text, MAX_TEXT), blamed, explicit


def _history_text(lines):
    """把已有发言（含老板插话）压成可注入的历史。

    ★ 只截断、不裁条数：谁先说谁后说对后面的影响是一样的，
      按"最近 N 条"裁会让早先的定性发言消失，模型就跟着跑偏。
    """
    out = []
    for ln in lines:
        who = ln.get("who", "?")
        nm = "老板" if who == "boss" else NAMES.get(who, who)
        txt = (ln.get("text") or "")[:MAX_HISTORY_CHARS]
        if not txt:
            continue
        role = "user" if who == "boss" else "assistant"
        out.append({"role": role, "content": f"{nm}：{txt}"})
    return out


def speak(who, failures, day, workers, lines, first=False, retries=1, stream=None):
    """一个人发言。lines 是**已经说过的**发言（含老板插话），会带进上下文。

    空稿**加码重试**，不是同额度重试：思考 token 和正文抢同一个额度，
    带历史时思考量明显变大，额度不够的表现是 `done` 但**一个 delta 都没有**
    （实测 step5 带 4 段历史、900 额度返回 0 字，而且不报错）。
    同额度重试多少次都没用——必须把额度加上去。
    """
    hist = _history_text(lines)
    if first:
        ask = brief(failures, day, workers) + "\n你先说。其他人还没开口。"
    else:
        prev = "、".join(NAMES.get(l.get("who"), l.get("who", "")) for l in lines[-3:])
        ask = ("接着说。前面说过的人：%s。\n"
               "针对他们的话接，别重复你已经说过的。\n"
               "你可以点名反驳他们，也可以顺势把锅推给在场任何人。" % prev)
    budget = P.chat_max_tokens(who)
    for _ in range(retries + 1):
        raw = ""
        for ev in (stream or P.stream_chat)(who, ask, system=system(who), history=hist or None,
                                max_completion_tokens=budget):
            if ev.get("type") == "delta":
                raw += ev["text"]
            elif ev.get("type") == "error":
                return None
        if raw.strip():
            text, blamed, explicit = parse(raw)
            if text:
                if not explicit:
                    # 格式没遵守：从台词里找点名的人（不含自己）
                    for k, nm in NAMES.items():
                        if k != who and (nm in text or k in text.lower()):
                            if k not in blamed:
                                blamed.append(k)
                return {"who": who, "text": text, "blames": blamed, "fmt": explicit}
        budget = min(budget * 2, 6000)
    return None


# ── 结算 ────────────────────────────────────────────────────────────────────
def tally(lines):
    """数谁被点名最多。只数同事之间的甩锅，不数老板说的。"""
    cnt = {w: 0 for w in REL.ALL}
    for ln in lines:
        if ln.get("who") == "boss":
            continue
        for b in (ln.get("blames") or []):
            if b in cnt and b != ln.get("who"):
                cnt[b] += 1
    return cnt


def settle(lines, tick=0):
    """被指责最多的那个心情 -6。没人被点名就不罚。"""
    cnt = tally(lines)
    if not any(cnt.values()):
        return {"culprit": None, "mood": {}, "count": cnt}
    culprit = max(cnt, key=lambda k: cnt[k])
    return {"culprit": culprit, "mood": {culprit: -6}, "count": cnt}
