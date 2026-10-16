"""发言顺序调度器。

Jev 通过 OpenRouter 的 decisions 端点接入（不是 chat/completions）。
单次成本约 0.00002 元，confidence 实测 0.5~0.8。

失败/未配置时自动降级到 fallback 策略，不影响游戏运行。
"""
import json, os, random, time
import requests

HERE = os.path.dirname(__file__)
PRESET_PATH = os.path.join(HERE, "..", "scheduler_orders.json")

JEV_URL = "https://openrouter.ai/api/alpha/decisions"
JEV_MODEL = "~typesafe/jev-latest"      # 注意：models 列表里的 typesafe/jev-router 在这个端点不可用

ORDER = ["m3", "flash", "longcat", "kimi", "step5"]

NAMES = {
    "m3": "M3", "flash": "Flash", "longcat": "LongCat",
    "kimi": "Kimi", "step5": "Step5",
}

# 每个角色的能力与性格。喂给 Jev 当 criteria。
PERSONA = {
    "m3":      "严谨规划派。擅长拆解需求、写方案文档、分析根因。慢，会先追问前提条件。爱分点。",
    "flash":   "话痨执行派。速度极快，什么杂活都接。输出糙但从不拖堂。",
    "longcat": "性价比实干派。什么活都能干，不挑不抱怨，先做完再说。",
    "kimi":    "慢热深思派。擅长长文档和战略思考。傲气，说话留半句，总要过一遍脑子才开口。",
    "step5":   "行动派。讨厌空谈方案，主张先干起来让现实检验。会给具体到明天就能做的动作。",
}

# 每个角色擅长什么。用于在没有 Jev 时做近似调度。
SKILLS = {
    "m3":     ["文档", "方案", "分析", "架构", "需求", "规划", "复盘", "分析"],
    "flash":  ["杂活", "快", "简单", "格式", "整理", "翻译", "跑腿", "简单"],
    "longcat": ["代码", "实现", "性价比", "批处理", "测试", "部署", "实现"],
    "kimi":   ["长文", "总结", "阅读", "资料", "调研", "对比", "论文", "长文"],
    "step5":  ["动手", "执行", "流程", "工具", "自动化", "跑起来", "执行"],
}

PERSONALITY = {          # 谁爱抢话、谁爱压轴（影响同分时的排序）
    "flash": 1.5,        # 秒回型，最爱抢第一个
    "kimi":  -0.6,       # 慢热，永远最后
    "m3":     0.2,
    "step5":  0.1,
    "longcat": 0.0,
}


def load_env():
    env = os.path.join(HERE, "..", ".env")
    if os.path.exists(env):
        for line in open(env, encoding="utf-8"):
            line = line.strip()
            if line.startswith("OPENROUTER_API_KEY="):
                os.environ.setdefault("OPENROUTER_API_KEY", line.split("=", 1)[1])


def _ask_jev(task: str, pool: list):
    """问 Jev：在这个任务里，谁最该第一个开口。返回 who 或 None。"""
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key or len(pool) < 2:
        return None
    state = (f"你是一个 AI 团队会议的主持调度器。五个 AI 同事同时接到了同一个任务，"
             f"你决定谁先开口。\n任务：{task}\n同事画像：\n" +
             "\n".join(f"- {NAMES[w]}：{PERSONA[w]}" for w in pool))
    body = {
        "model": JEV_MODEL,
        "state": state,
        "questions": {
            "first_speaker": {
                "type": "choice",
                "instructions": "Given the task, which one of these characters should speak FIRST? "
                                "Pick exactly one.",
                "criteria": {w: f"{NAMES[w]} — {PERSONA[w]}" for w in pool},
            }
        },
    }
    try:
        r = requests.post(JEV_URL, json=body, timeout=20, headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        })
        if r.status_code != 200:
            return None
        ans = (r.json().get("answers") or {}).get("first_speaker") or {}
        pick = ans.get("choice")
        return pick if pick in pool else None
    except Exception:
        return None


def _ask_jev_auto(task: str, pool: list):
    """玩家没派单时，让 Jev 决定谁自己去抢这个活。"""
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key or not pool:
        return None
    state = (f"一家 AI 事务所来了个客户需求：{task}\n"
             f"你没安排人，闲着的人会自己抢。谁最该去接这个活？\n"
             + "\n".join(f"- {NAMES[w]}：{PERSONA[w]}" for w in pool))
    try:
        r = requests.post(JEV_URL, timeout=15, headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }, json={
            "model": JEV_MODEL, "state": state,
            "questions": {"taker": {
                "type": "choice",
                "instructions": "Who should volunteer to take this job? Choose exactly one.",
                "criteria": {w: f"{NAMES[w]} — {PERSONA[w]}" for w in pool},
            }}})
        if r.status_code != 200:
            return None
        pick = ((r.json().get("answers") or {}).get("taker") or {}).get("choice")
        return pick if pick in pool else None
    except Exception:
        return None


def ask_jev_choose(state: str, options: dict, instructions: str, qid: str = "choice"):
    """通用 Jev 单选：options = {返回键: 说明文字}，返回被选中的键或 None。

    _ask_jev / _ask_jev_auto 都是"从五个人里选一个"的专用形状：它们把 options
    当 worker id 去查 NAMES/PERSONA，传别的键会直接 KeyError。
    凡是要问"选 A 还是 B"的场合都走这里（M2-5 反击与否、M2-6 甩锅、M2-7 老板问话）。
    instructions 用英文：Jev 的判定质量对指令语言敏感。
    """
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key or not options:
        return None
    try:
        r = requests.post(JEV_URL, timeout=15, headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }, json={
            "model": JEV_MODEL, "state": state,
            "questions": {qid: {
                "type": "choice",
                "instructions": instructions,
                "criteria": dict(options),
            }}})
        if r.status_code != 200:
            return None
        pick = ((r.json().get("answers") or {}).get(qid) or {}).get("choice")
        return pick if pick in options else None
    except Exception:
        return None


def _preset():
    if os.path.exists(PRESET_PATH):
        try:
            return json.load(open(PRESET_PATH, encoding="utf-8"))
        except Exception:
            return {}
    return {}


def jev_order(task: str, pool: list = None):
    """只决定第一个开口的人；其余按技能匹配排。
    串行排满 5 次要多花约 4s，而决定权最集中在"谁先抢话"这一步。"""
    pool = pool or ORDER
    pick = _ask_jev(task, pool)
    if not pick:
        return None
    rest = [w for w in pool if w != pick]
    rest.sort(key=lambda w: -_score(w, task))
    return [pick] + rest


def _score(who: str, task: str) -> float:
    t = task.lower()
    hit = sum(1 for k in SKILLS[who] if k in t)
    return hit * 1.0 + PERSONALITY[who] + random.uniform(-0.45, 0.45)


def order_for(task: str, enabled: list = None) -> list:
    """返回发言顺序（who 列表）。enabled 为空则五个全上。"""
    pool = enabled or ORDER
    j = jev_order(task, pool)
    if j:
        return j
    pre = _preset()
    for k, v in pre.items():
        if k in task:
            rest = [w for w in pool if w not in v]
            return v + rest
    return sorted(pool, key=lambda w: -_score(w, task))


load_env()   # 必须在所有 def 之后执行
