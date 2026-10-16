"""五模型统一调用封装。
每家的 endpoint / 思考内容格式都不同，这里统一成同一种流式事件。
"""
import os, json, time, threading
import requests
from dotenv import load_dotenv

load_dotenv(os.environ.get("AI_OFFICE_ENV_PATH") or
            os.path.join(os.path.dirname(__file__), "..", ".env"))

# ── 实测通过的 endpoint（2026-10-04 探测，见 server/probe.py）────────────────
PROVIDERS = {
    "m3": {
        "name": "M3",
        "full": "MiniMax-M3",
        "base": "https://api.minimaxi.com/v1",
        "model": "MiniMax-M3",
        "key_env": "MINIMAX_API_KEY",
        "color": "#7DC6FF",
        "tag": "严谨派",
        "blurb": "分点狂魔，输出长，讲方法论",
        "latency": 3.9,
    },
    "flash": {
        "name": "Flash",
        "full": "MiniMax-M3.1-Flash-Preview",
        "base": "https://api.minimaxi.com/v1",
        "model": "MiniMax-M3.1-Flash-Preview",
        "key_env": "MINIMAX_API_KEY",
        "color": "#FFD166",
        "tag": "话痨派",
        "blurb": "秒回打杂王，速度就是正义",
        "latency": 1.4,
    },
    "longcat": {
        "name": "LongCat",
        "full": "LongCat-2.5-Preview",
        "base": "https://api.longcat.chat/openai/v1",
        "model": "LongCat-2.5-Preview",
        "key_env": "LONGCAT_API_KEY",
        "color": "#06D6A0",
        "tag": "性价比派",
        "blurb": "美团出品，能干且不挑活",
        "latency": 3.2,
    },
    "kimi": {
        "name": "Kimi",
        "full": "kimi-k3",
        "base": "https://api.kimi.com/coding/v1",
        "model": "kimi-k3",
        "key_env": "KIMI_API_KEY",
        "color": "#B388FF",
        "tag": "慢热派",
        "blurb": "2.8 万亿参数，想得比谁都久",
        "latency": 55.2,
    },
    "step5": {
        "name": "Step5",
        "full": "step-5-preview",
        # 注意：这是 Step Plan 订阅额度专用路径。开放平台的 api.stepfun.com/v1 会返回 402
        "base": "https://api.stepfun.com/step_plan/v1",
        "model": "step-5-preview",
        "key_env": "STEPFUN_API_KEY",
        "color": "#FF6B6B",
        "tag": "实干派",
        "blurb": "阶跃星辰，主打真实 agentic 任务",
        "latency": 1.7,
    },
}

ORDER = ["m3", "flash", "longcat", "kimi", "step5"]


def persona(who: str) -> str:
    """闲聊/会议场景的人设。强调短。"""
    p = PROVIDERS[who]
    return (
        f"你是{p['name']}（{p['full']}），一个 AI 团队的成员，人设是「{p['tag']}」：{p['blurb']}。\n"
        f"现在你和另外几个模型同事一起在开会，老板给了一个任务，你们各自会怎么接、各自会说什么。\n"
        f"【硬性输出限制，违反会被扣工资】\n"
        f"1. 最多 3 句话，总字数不超过 80 字。\n"
        f"2. 用中文口语，像真人在群里发言。禁止分点罗列、禁止写小标题、禁止总结全场。\n"
        f"3. 直接说你要说的话，不要任何解释、前缀或后缀。\n"
        f"4. 如果话要说不完，就只说最关键的那一句。"
    )


# ★ 防线 1：交付场景的硬约束。
# 背景：实测 M3 交付需求时输出了 4397 字（人设要求 100 字），会把游戏 UI 撑爆。
def deliver_system(who: str) -> str:
    p = PROVIDERS[who]
    return (
        f"你是{p['name']}（{p['full']}），事务所员工，人设「{p['tag']}」：{p['blurb']}。\n"
        f"客户要你交付一个成果。\n"
        f"【硬性输出限制，这是最重要的要求】\n"
        f"- 总字数必须控制在 150 字以内，绝对不超过 200 字。\n"
        f"- 最多 3 句话，不分点，不写小标题，不写'以下是'之类的开场白。\n"
        f"- 只说这个成果里最关键的 1-2 个要点，其余一概省略。\n"
        f"- 写完立刻停笔。不要展开，不要举例，不要总结。\n"
        f"说白了：这是一句微信语音的长度，不是 PRD 的长度。"
    )


def deliver_user_msg(task: str) -> str:
    return f"客户的需求是：{task}\n\n用 150 字以内告诉我你交付了什么要点。"


# ★ 防线 3（后端侧）：统一截断，保证任何出口都不会吐出长文本
DISPLAY_LIMIT = 200


def truncate(text: str, limit: int = DISPLAY_LIMIT) -> str:
    t = (text or "").strip()
    if len(t) <= limit:
        return t
    return t[:limit] + f"（他话太多了，已截断）"


# ★ 防线2：max_completion_tokens 按模型分配，不能一刀切。
# 思考 token 也占这个额度，而各家思考量差异极大（实测 M3 思考占输出 98%）。
# 一刀切到 800 会让 M3 有约 8% 概率思考完就没额度写正文了（返回 0 字）。
DELIVER_MAX_TOKENS = {
    "m3": 2400,      # 思考占其输出 98%，1600 仍有 25% 空交付，2400 才稳
    "kimi": 1200,    # 思考次重
    "step5": 900,
    "longcat": 900,
    "flash": 700,    # 思考最轻
}


def deliver_max_tokens(who: str) -> int:
    return DELIVER_MAX_TOKENS.get(who, 1000)


# 短文本对话（吐槽、复盘发言）同样被思考 token 支配：M3 思考占其输出 98%。
# 一刀切 500/600 会让 M3 思考完就没额度写正文（实测 m3 复盘发言 10.5s 后返回空）。
#
# ★ 这张表比 DELIVER_MAX_TOKENS 宽，不是"短文本就少给点"，而是因为：
#   带 history 的多轮对话思考量明显更大，而额度里还得分给思考。
#   实测 step5 带 4 段历史时，900 额度返回 **0 个 delta 事件**（不是报错，
#   是思考刚好把额度吃光），1800 才稳定。所以这里的下限必须按"带历史"来定。
CHAT_MAX_TOKENS = {
    "m3": 2400,
    "kimi": 1800,
    "step5": 1800,
    "longcat": 1200,
    "flash": 900,
}


def chat_max_tokens(who: str) -> int:
    return CHAT_MAX_TOKENS.get(who, 1200)


def error_event(who, status=0, payload=None, category=None):
    """仅透出稳定的游戏状态；原始上游正文可能含凭据，不能进客户端。"""
    detail = json.dumps(payload or {}, ensure_ascii=False).lower()
    quota_marks = ("insufficient_quota", "exceeded_current_quota", "quota_exceeded",
                   "quota exhausted", "quota exceeded", "exceeded your current quota",
                   "insufficient balance", "insufficient credit", "credit balance",
                   "usage limit", "usage_limit_reached", "billing_hard_limit_reached",
                   "plan limit", "quota_limit_exceeded", "credit limit",
                   "额度用完", "额度耗尽", "额度不足", "余额耗尽", "余额不足", "套餐额度", "token quota")
    base = (payload or {}).get("base_resp", {}) if isinstance(payload, dict) else {}
    err = payload.get("error", {}) if isinstance(payload, dict) else {}
    code = str(base.get("status_code") or (err.get("code") if isinstance(err, dict) else ""))
    if category is None:
        if status == 402 or any(mark in detail for mark in quota_marks) or \
                (who in ("m3", "flash") and code == "1008"):
            category = "quota"
        elif status in (401, 403) or code == "1004":
            category = "auth"
        elif status == 404:
            category = "model_unavailable"
        elif status == 429 or code == "1002":
            category = "rate_limit"
        else:
            category = "temporary"
    down = category in ("quota", "auth", "config", "model_unavailable")
    reason = {"quota": "额度用完了", "auth": "API 暂不可用", "config": "API 尚未配置",
              "model_unavailable": "模型暂不可用", "rate_limit": "请求太快了，稍后再试",
              "temporary": "这次没连上，稍后再试"}.get(category, "本次调用已取消")
    scope = "model" if category == "model_unavailable" or \
        "model quota" in detail or "per-model" in detail else "credential"
    return {"type": "error", "who": who, "category": category, "brain_down": down,
            "scope": scope, "retryable": not down,
            "message": ("脑袋宕机了（%s）" % reason) if down else reason}


def deliver_stream(who: str, task: str, retries: int = 1, stream=None):
    """交付专用流式调用。空结果自动重试一次（重试即"没写出来，重来一遍"）。"""
    for attempt in range(retries + 1):
        txt = ""
        for ev in (stream or stream_chat)(who, deliver_user_msg(task),
                              system=deliver_system(who),
                              max_completion_tokens=deliver_max_tokens(who)):
            if ev.get("type") == "delta":
                txt += ev["text"]
                # ★M4-2：把 delta 透出去。之前这里只累加成 txt，
                #   外面完全看不到"模型正在一个字一个字往外吐"这件事，
                #   客户端就没法让打字音跟着输出走——只能瞎放一段循环，
                #   那不叫"跟 LLM 流同步"，那叫配了个音。
                yield {"type": "delta", "who": who, "text": ev["text"]}
            elif ev.get("type") == "error":
                yield ev
                return                 # 上游失败不能伪造成交付，也不继续消耗额度
        if txt.strip():
            if attempt:
                yield {"type": "retry", "who": who, "attempt": attempt}
            yield {"type": "deliver", "who": who, "text": truncate(txt.strip())}
            return
        if attempt < retries:
            yield {"type": "retry", "who": who, "attempt": attempt + 1,
                   "reason": "没写出来"}
    yield {"type": "deliver", "who": who,
           "text": "（想半天没憋出东西，这单算我糊弄了）"}


def stream_chat(who, user_msg: str, history=None, system: str = None,
                max_completion_tokens: int = 2000, temperature: float = 1.0):
    """流式调用单个模型，产出 {'type': ...} 事件字典。

    system=None 时用闲聊人设；传 system 则覆盖（交付场景用 deliver_system）。
    max_completion_tokens 注意：思考 token 也占这个额度。
    """
    p = PROVIDERS[who]
    key = os.getenv(p["key_env"])
    if not key:
        yield error_event(who, category="config")
        return

    msgs = [{"role": "system", "content": system if system else persona(who)},
            {"role": "user", "content": user_msg}]
    for h in (history or [])[-6:]:
        msgs.append(h)

    url = p["base"].rstrip("/") + "/chat/completions"
    body = {
        "model": p["model"],
        "messages": msgs,
        "max_completion_tokens": max_completion_tokens,
        "temperature": temperature,
        "stream": True,
    }
    t0 = time.time()
    got_text = False
    # M3 把思考塞在 <think>...</think> 里，Flash/Kimi/LongCat 用独立 reasoning_content 字段。
    # 这里用状态机把 think 块整段吃掉，只往外发最终正文。
    in_think = False
    closing = False
    try:
        with requests.post(url, json=body, stream=True, timeout=300, headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }) as r:
            r.encoding = "utf-8"          # SSE 头常不带 charset，requests 会退回 Latin-1 导致中文乱码
            if r.status_code != 200:
                try:
                    payload = r.json()
                except Exception:
                    payload = {"message": r.text[:1000]}
                yield error_event(who, r.status_code, payload)
                return
            for raw in r.iter_lines(decode_unicode=True):
                if not raw or not raw.startswith("data:"):
                    continue
                data = raw[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except Exception:
                    continue
                if chunk.get("error") or str((chunk.get("base_resp") or {}).get("status_code", 0)) not in ("0", "None", ""):
                    yield error_event(who, payload=chunk)
                    return
                for ch in chunk.get("choices", []):
                    d = ch.get("delta") or {}
                    txt = d.get("content")
                    if not txt:
                        continue
                    # ── <think> 状态机 ──
                    while txt:
                        if in_think:
                            if "</think>" in txt:
                                txt = txt.split("</think>", 1)[1]
                                in_think = False
                            else:
                                txt = ""            # 整段丢弃思考内容
                        else:
                            if "<think>" in txt:
                                txt = txt.split("<think>", 1)[1]
                                in_think = True
                            else:
                                # 首个正文块去掉思考结束后残留的换行/空白
                                if not got_text:
                                    txt = txt.lstrip()
                                    if not txt:
                                        continue
                                got_text = True
                                yield {"type": "delta", "who": who, "text": txt}
                                txt = ""
    except GeneratorExit:
        closing = True
        raise
    except Exception:
        yield error_event(who, category="temporary")
    finally:
        if not closing:
            yield {"type": "done", "who": who, "seconds": round(time.time() - t0, 1),
                   "got_text": got_text}


def health(who: str) -> dict:
    """轻量健康检查用，不真发大请求。"""
    p = PROVIDERS[who]
    return {"who": who, "name": p["name"], "full": p["full"], "color": p["color"],
            "tag": p["tag"], "blurb": p["blurb"],
            "has_key": bool(os.getenv(p["key_env"]))}
