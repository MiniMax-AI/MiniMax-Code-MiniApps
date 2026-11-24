# -*- coding: utf-8 -*-
"""段四：AI 对话适配层（OpenAI 兼容 `chat/completions`，只用标准库 urllib）。

这一层只干一件事：**把工作台的提问变成一次真的模型调用**。

规矩（段四硬约束）：
  * 不引新依赖——只用 `urllib`＋标准库；
  * 后端地址与模型可配：项目级 `workbench.toml` 的 `[ai]` 节
    （`base_url` / `model` / `api_key`，`api_key` 可选；
    条目 42 起另认 `models`——可选模型清单，供界面下拉）；
  * 缺省 `base_url=http://127.0.0.1:8220/v1`（本机 Q 席 vLLM）、`model=qwen`；
  * 后端不可达 / 超时（限时 60s）→ 结构化降级：`ok=False, fallback=True`，
    模拟回复的**首行必须**是 `模拟回答（未接模型）`——绝不静默造假。
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

#: 缺省后端（本机 Q 席 vLLM）。
DEFAULT_BASE_URL = "http://127.0.0.1:8220/v1"
DEFAULT_MODEL = "qwen"

#: 单次调用的限时（秒）。后端慢也不能把工作台挂死。
TIMEOUT = 60.0

#: 降级回复的首行标记。**不许改**——前端靠它、以及靠 fallback 字段分辨真假。
FALLBACK_MARK = "模拟回答（未接模型）"

#: 项目级配置文件名（`[ai]` 节在里面）。
CONFIG_NAME = "workbench.toml"
AI_SECTION = "ai"

#: 上下文里正文紧凑文本的上限（字符）。
CONTEXT_CHARS = 6000

SYSTEM_PROMPT = (
    "你是 FactScribe 的论文写作助手。只依据给定材料回答，"
    "材料里没有的就说材料里没有，不要编造数字或出处。"
    "回答用中文，简洁分条。"
)

EXPLAIN_SYSTEM_PROMPT = (
    "你是 FactScribe 的论文写作助手。下面给的是当前稿件的检查报告摘要。"
    "请用大白话解读：红黄灯各代表什么、要动手做哪几件、哪些不用管。"
    "不要编造材料里没有的数字。"
)

#: 段六：两个模式档（智能助手对话头部的 tab）。系统提示互不相同。
IDEA_SYSTEM_PROMPT = (
    "你在「聊想法」档：这一档不急着写正文，先帮作者把问题想清楚——"
    "追问贡献到底在哪儿、哪条主张还没有证据、哪条路走不通就直说。"
    "只依据给定材料说事；材料里没有的，就说材料里没有，"
    "不要编造数字或出处。回答用中文，简洁分条。"
)

PAPER_SYSTEM_PROMPT = (
    "你在「写论文」档：这一档只围着当前稿件转——"
    "对照已有正文，指出这一段该怎么接、怎么写才合得上前后文。"
    "只依据给定材料说事；材料里没有的，就说材料里没有，"
    "不要编造数字或出处。回答用中文，简洁分条。"
)

#: 段六：段落三动作的系统提示（续写 / 改写 / 提问）。
ACTION_CONTINUE_PROMPT = (
    "你要**续写**用户引用的那一段：接着往下写，"
    "和引用的段落语气、话题、详略一致。只输出续写的正文，"
    "不要重复引用的原文，不要加解释。"
)

ACTION_REWRITE_PROMPT = (
    "你要**改写**用户引用的那一段：意思不变，把话说得更清楚、更紧凑。"
    "引用的原文里若有 \\fact{} / \\cite{} 这类标记，原样保留、位置不变。"
    "只输出改写后的正文，不要加解释。"
)

ACTION_ASK_PROMPT = (
    "你要**回答**关于用户引用的那一段的提问："
    "先直接回答问题，再给一条能落到纸面上的改法。"
    "只依据给定材料说事，不要编造数字或出处。"
)

#: 动作名 → 系统提示。`ask` 是缺省。
ACTION_PROMPTS = {
    "continue": ACTION_CONTINUE_PROMPT,
    "rewrite": ACTION_REWRITE_PROMPT,
    "ask": ACTION_ASK_PROMPT,
}

#: 模式名 → 系统提示。`paper` 是缺省（`ask` 视同 `paper`）。
MODE_PROMPTS = {
    "idea": IDEA_SYSTEM_PROMPT,
    "paper": PAPER_SYSTEM_PROMPT,
    "ask": PAPER_SYSTEM_PROMPT,
}



#: 英文界面的角色提示（宿主 Agent 通道用；界面切英文时整套提示也切英文）。
SYSTEM_PROMPT_EN = (
    "You are FactScribe's paper-writing assistant. Answer only from the given material; "
    "if it is not in the material, say so — never invent numbers or sources. "
    "Answer in English, concise and bulleted."
)

EXPLAIN_SYSTEM_PROMPT_EN = (
    "You are FactScribe's paper-writing assistant. Below is a summary of the current "
    "manuscript's check report. Explain it in plain words: what the red and yellow marks "
    "mean, what to fix, and what can be ignored. Do not invent numbers that are not in "
    "the material. Answer in English, concise and bulleted."
)

IDEA_SYSTEM_PROMPT_EN = (
    "You are in the \"brainstorm\" mode: no writing yet — help the author think the problem "
    "through. Ask where the contribution really is, which claim still lacks evidence, and "
    "say plainly when a path does not work. Answer only from the given material; if it is "
    "not there, say so — never invent numbers or sources. Answer in English, concise and "
    "bulleted."
)

PAPER_SYSTEM_PROMPT_EN = (
    "You are in the \"write the paper\" mode: stay on the current manuscript — compare "
    "against the existing text and say how this passage should connect and what would "
    "fit the surrounding context. Answer only from the given material; if it is not there, "
    "say so — never invent numbers or sources. Answer in English, concise and bulleted."
)

ACTION_CONTINUE_PROMPT_EN = (
    "You must **continue** the passage the user quoted: carry on from it, matching its "
    "tone, topic and level of detail. Output only the continued text — do not repeat the "
    "quoted passage and do not add explanations."
)

ACTION_REWRITE_PROMPT_EN = (
    "You must **rewrite** the passage the user quoted: same meaning, clearer and tighter. "
    "Keep markers such as \\fact{} / \\cite{} verbatim and in place. Output only the "
    "rewritten text — do not add explanations."
)

ACTION_ASK_PROMPT_EN = (
    "You must **answer** the question about the passage the user quoted: answer first, "
    "then give one concrete change that can land on the page. Answer only from the given "
    "material — never invent numbers or sources."
)

#: 模式名 → 英文角色提示。
MODE_PROMPTS_EN = {
    "idea": IDEA_SYSTEM_PROMPT_EN,
    "paper": PAPER_SYSTEM_PROMPT_EN,
    "ask": PAPER_SYSTEM_PROMPT_EN,
}

#: 动作名 → 英文动作提示。
ACTION_PROMPTS_EN = {
    "continue": ACTION_CONTINUE_PROMPT_EN,
    "rewrite": ACTION_REWRITE_PROMPT_EN,
    "ask": ACTION_ASK_PROMPT_EN,
}

class AIError(Exception):
    """后端不可达 / 超时 / 返回体不认。调用方据此降级。"""

    def __init__(self, message: str, code: str = "AI_UNAVAILABLE") -> None:
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------- 配置

def _read_ai_table(path: Path) -> dict:
    """读一个 `workbench.toml` 里的 `[ai]` 节；读不到就当没有。"""
    if not path.is_file():
        return {}
    try:
        from ..config import load_toml
        data = load_toml(path)
    except Exception:  # noqa: BLE001 - 坏配置不该让对话崩掉
        return {}
    table = data.get(AI_SECTION)
    return table if isinstance(table, dict) else {}


def ai_config(disk_path: str | Path) -> dict:
    """这个盘用的 AI 配置。

    找 `workbench.toml` 的顺序：盘目录 → 项目目录（盘的上一级）。
    环境变量 `FACTSCRIBE_AI_BASE_URL` / `FACTSCRIBE_AI_MODEL` /
    `FACTSCRIBE_AI_API_KEY` 优先级最高（临时换机不用改文件）。
    """
    disk = Path(disk_path).expanduser()
    table: dict = {}
    for candidate in (disk, disk.parent):
        found = _read_ai_table(candidate / CONFIG_NAME)
        if found:
            table = found
            break
    base_url = str(table.get("base_url") or "").strip()
    base_url = base_url or os.environ.get("FACTSCRIBE_AI_BASE_URL", "").strip()
    base_url = base_url or DEFAULT_BASE_URL
    model = str(table.get("model") or "").strip()
    model = model or os.environ.get("FACTSCRIBE_AI_MODEL", "").strip()
    model = model or DEFAULT_MODEL
    api_key = str(table.get("api_key") or "").strip()
    api_key = api_key or os.environ.get("FACTSCRIBE_AI_API_KEY", "").strip()
    return {"base_url": base_url.rstrip("/"), "model": model, "api_key": api_key}


# ---------------------------------------------------------------- 调用

def chat_completion(base_url: str, model: str, messages: list[dict],
                    api_key: str = "", timeout: float = TIMEOUT,
                    effort: str = "") -> str:
    """打一次 OpenAI 兼容的 `chat/completions`，返回文本。

    任何异常都收敛成 `AIError`——调用方只有「成功」与「降级」两条路。
    """
    url = base_url.rstrip("/") + "/chat/completions"
    payload = {"model": model, "messages": messages, "stream": False,
               "temperature": 0.2}
    # effort（思考等级）：缺省＝不给，后端按自己的默认走。
    level = str(effort or "").strip()
    if level:
        payload["reasoning_effort"] = level
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST")
    request.add_header("Content-Type", "application/json")
    request.add_header("Accept", "application/json")
    if api_key:
        request.add_header("Authorization", "Bearer %s" % api_key)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        raise AIError("后端返回 HTTP %s" % exc.code, "AI_HTTP_ERROR") from exc
    except urllib.error.URLError as exc:
        raise AIError("连不上后端 %s：%s" % (url, exc.reason)) from exc
    except OSError as exc:  # 超时 / 连接被拒
        raise AIError("连不上后端 %s：%s" % (url, exc)) from exc
    try:
        body = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise AIError("后端返回的不是 JSON", "AI_BAD_RESPONSE") from exc
    return _extract_text(body)


def _extract_text(body: object) -> str:
    """从 OpenAI 兼容返回体里挖出正文；挖不出就报 `AIError`。"""
    if not isinstance(body, dict):
        raise AIError("后端返回体不是对象", "AI_BAD_RESPONSE")
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        raise AIError("后端返回体里没有 choices", "AI_BAD_RESPONSE")
    first = choices[0]
    if not isinstance(first, dict):
        raise AIError("后端返回体里 choices[0] 不是对象", "AI_BAD_RESPONSE")
    message = first.get("message")
    if isinstance(message, dict):
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
        text = message.get("reasoning_content")
        if isinstance(text, str) and text.strip():
            return text.strip()
    text = first.get("text")
    if isinstance(text, str) and text.strip():
        return text.strip()
    raise AIError("后端返回体里没有可读文本", "AI_BAD_RESPONSE")


# ---------------------------------------------------------------- 上下文

def _strip_html(text: str) -> str:
    import re
    out = re.sub(r"<[^>]+>", " ", str(text or ""))
    return " ".join(out.split())


def disk_text(disk_path: str | Path, limit: int = CONTEXT_CHARS) -> str:
    """当前盘的正文紧凑文本（标题 + 段落，纯文本）。"""
    from .projects import disk_sections

    try:
        data = disk_sections(Path(disk_path))
    except Exception:  # noqa: BLE001 - 读不到盘就当空正文
        return ""
    pieces: list[str] = []
    for block in data.get("blocks") or []:
        title = str(block.get("title") or "").strip()
        if title:
            pieces.append("## %s" % title)
        body = _strip_html(block.get("html") or "")
        if body:
            pieces.append(body)
    text = "\n".join(pieces)
    if len(text) > limit:
        text = text[:limit] + "\n…（正文已截断）"
    return text


def report_summary(disk_path: str | Path) -> str:
    """检查报告摘要（解读模式用）。读不到就当没有。"""
    from .checkreport import report_payload

    try:
        payload = report_payload(Path(disk_path))
    except Exception:  # noqa: BLE001
        return ""
    if not payload.get("ok"):
        return ""
    health = payload.get("health") or {}
    findings = payload.get("findings") or []
    chain = payload.get("chain") or []
    lines = [
        "体检：红 %s，黄 %s，提醒 %s，事实 %s，章节 %s，状态 %s。" % (
            health.get("red", 0), health.get("yellow", 0),
            health.get("hints", 0), health.get("facts", 0),
            health.get("sections", 0), health.get("status", "?")),
        "发现 %s 条：" % len(findings),
    ]
    for item in findings[:20]:
        lines.append("- [%s] %s：%s" % (
            item.get("severity", ""), item.get("code", ""),
            item.get("message", "") or item.get("title", "")))
    if chain:
        lines.append("四步链：" + "；".join(
            "%s=%s" % (step.get("key", ""), step.get("state", "")) for step in chain))
    return "\n".join(lines)


def build_context(disk_path: str | Path, quote: dict | None = None,
                  mode: str = "ask", action: str = "ask",
                  use_knowledge: bool = True) -> str:
    """组装喂给模型的上下文：正文 ＋ 知识库 ＋ 可选引用段 ＋ 可选检查报告摘要。"""
    blocks: list[str] = []
    if mode == "explain":
        summary = report_summary(disk_path)
        if summary:
            blocks.append("【检查报告摘要】\n" + summary)
    if use_knowledge:
        try:
            from .knowledge import context_text

            knowledge = context_text(disk_path)
        except Exception:  # noqa: BLE001 - 知识库读不到不该让对话崩掉
            knowledge = ""
        if knowledge:
            blocks.append("【知识库】\n" + knowledge)
    text = disk_text(disk_path)
    if text:
        blocks.append("【当前稿件正文】\n" + text)
    if quote:
        section = str(quote.get("section") or "").strip()
        quoted = str(quote.get("text") or "").strip()
        if quoted:
            head = "【用户引用的段落%s】" % ("（%s）" % section if section else "")
            blocks.append(head + "\n" + quoted)
    return "\n\n".join(blocks)


# ---------------------------------------------------------------- 降级

def simulated_reply(question: str = "", reason: str = "") -> str:
    """模拟回复。**首行必须是** `模拟回答（未接模型）`。"""
    lines = [FALLBACK_MARK,
             "后端没连上，下面这段不是模型的回答，只是占位，别当结论用。"]
    if reason:
        lines.append("（原因：%s）" % reason)
    if question:
        lines.append("（收到的提问：%s）" % question)
    lines.append("把 workbench.toml 的 [ai].base_url 指到能用的后端，再问一次。")
    return "\n".join(lines)


def _last_question(messages: list[dict]) -> str:
    for item in reversed(messages or []):
        if isinstance(item, dict) and item.get("role") == "user":
            return str(item.get("content") or "").strip()
    return ""


# ---------------------------------------------------------------- 主入口

def chat(disk_path: str | Path, messages: list[dict],
         quote: dict | None = None, mode: str = "ask",
         action: str = "ask", timeout: float = TIMEOUT,
         model: str | None = None, effort: str = "") -> dict:
    """工作台的 AI 入口。

    返回结构**恒定**：
      `{"ok", "fallback", "reply", "model", "base_url", "code", "error"}`

    成功时 `ok=True, fallback=False`；后端不可达 / 超时 / 返回体不认时
    `ok=False, fallback=True`，且 `reply` 首行是 `模拟回答（未接模型）`。

    `mode` 决定大方向（`idea` 聊想法 / `paper` 写论文 / `explain` 解读报告）；
    `action` 决定这一轮干什么（`continue` 续写 / `rewrite` 改写 / `ask` 提问）。
    条目 42：`model` 给了非空串就覆盖配置里的模型去调用；返回体的
    `model` 字段一律回报**实际用的**模型。
    """
    config = ai_config(disk_path)
    chosen = str(model or "").strip()
    if chosen:
        config["model"] = chosen
    history = [m for m in (messages or [])
               if isinstance(m, dict) and m.get("role")
               and isinstance(m.get("content"), str)]
    question = _last_question(history)
    context = build_context(disk_path, quote=quote, mode=mode, action=action)
    system = EXPLAIN_SYSTEM_PROMPT if mode == "explain" \
        else MODE_PROMPTS.get(str(mode or "ask"), PAPER_SYSTEM_PROMPT)
    action_prompt = ACTION_PROMPTS.get(str(action or "ask"))
    # 动作提示只在「段落动作」时加：续写／改写一定要；提问要带段落引用；
    # 普通闲聊（没有引用）别套上「回答关于这一段的问题」这种话。
    if action_prompt and mode != "explain":
        if action in ("continue", "rewrite") or quote:
            system = system + "\n\n" + action_prompt
    payload: list[dict] = [{"role": "system", "content": system}]
    if context:
        payload.append({"role": "system", "content": context})
    payload.extend(history)
    try:
        reply = chat_completion(config["base_url"], config["model"], payload,
                                api_key=config["api_key"], timeout=timeout,
                                effort=str(effort or ""))
    except AIError as exc:
        return {
            "ok": False, "fallback": True,
            "reply": simulated_reply(question, str(exc)),
            "model": config["model"], "base_url": config["base_url"],
            "code": exc.code, "error": str(exc),
            "mode": str(mode or "ask"), "action": str(action or "ask"),
        }
    return {
        "ok": True, "fallback": False, "reply": reply,
        "model": config["model"], "base_url": config["base_url"],
        "code": "", "error": "",
        "mode": str(mode or "ask"), "action": str(action or "ask"),
    }


#: 宿主 Agent 回合的「不许动手」要求（面板是只读的，不授权工具调用）。
AGENT_NO_TOOLS = {
    "zh": "不要调用任何工具、不要读写文件、不要执行命令；只按上面的材料回答。",
    "en": ("Do not call any tools, do not read or write files, do not run commands; "
           "answer only from the material above."),
}

#: 界面语言 → 回答口径（面板跟界面走）。
ANSWER_LANG = {
    "zh": "只依据上面的材料回答；材料里没有的，就说材料里没有，不要编造数字或出处。回答用中文，简洁分条。",
    "en": ("Only answer from the material above; if it is not there, say so. "
           "Never invent numbers or sources. Answer in English, concise and bulleted."),
}


def prepare_prompt(disk_path: str | Path, messages: list[dict],
                   quote: dict | None = None, mode: str = "ask",
                   action: str = "ask", lang: str = "") -> dict:
    """把一轮提问组装成**给宿主 Agent 的一段提示词**（不调任何模型）。

    宿主 Agent 回合自带系统提示，我们改不了它的角色设定；所以这里把
    「角色说明 ＋ 材料 ＋ 此前对话 ＋ 用户提问」拼成一段用户消息交给它，
    材料那部分与 `chat()` 用的是同一套 `build_context`，两边口径一致。

    返回：`{"ok", "prompt", "mode", "action", "question"}`。
    """
    history = [m for m in (messages or [])
               if isinstance(m, dict) and m.get("role")
               and isinstance(m.get("content"), str)]
    question = _last_question(history)
    context = build_context(disk_path, quote=quote, mode=mode, action=action)
    speak = "en" if str(lang or "").lower() == "en" else "zh"
    if speak == "en":
        system = EXPLAIN_SYSTEM_PROMPT_EN if mode == "explain" \
            else MODE_PROMPTS_EN.get(str(mode or "ask"), PAPER_SYSTEM_PROMPT_EN)
        action_prompt = ACTION_PROMPTS_EN.get(str(action or "ask"))
    else:
        system = EXPLAIN_SYSTEM_PROMPT if mode == "explain" \
            else MODE_PROMPTS.get(str(mode or "ask"), PAPER_SYSTEM_PROMPT)
        action_prompt = ACTION_PROMPTS.get(str(action or "ask"))
    if action_prompt and mode != "explain":
        if action in ("continue", "rewrite") or quote:
            system = system + "\n\n" + action_prompt
    parts = ["【角色】\n" + system]
    if context:
        parts.append("【材料】\n" + context)
    older = [m for m in history[:-1]][-6:]
    if older:
        lines = []
        for item in older:
            who = "用户" if str(item.get("role")) == "user" else "助手"
            lines.append("%s：%s" % (who, str(item.get("content") or "").strip()))
        parts.append("【此前对话】\n" + "\n".join(lines))
    parts.append("【用户提问】\n" + (question or "（空）"))
    tail = ANSWER_LANG[speak] + " " + AGENT_NO_TOOLS[speak]
    parts.append("【要求】" + tail)
    return {"ok": True, "prompt": "\n\n".join(parts),
            "mode": str(mode or "ask"), "action": str(action or "ask"),
            "question": question}


def available_models(disk_path: str | Path) -> list[str]:
    """条目 42：这个盘可选的模型清单（`workbench.toml` 的 `[ai].models`）。

    读法沿用 `_read_ai_table`（盘目录 → 项目目录，先找到先用）；
    缺省模型（`ai_config` 的 `model` 结果）保证在列——不在就补在最前；
    去重、滤空串；读不到 / 没有 `models` → 只返回 `[缺省模型]`。
    """
    default = str(ai_config(disk_path).get("model") or "").strip()
    disk = Path(disk_path).expanduser()
    raw: list = []
    for candidate in (disk, disk.parent):
        table = _read_ai_table(candidate / CONFIG_NAME)
        if table:
            value = table.get("models")
            raw = value if isinstance(value, list) else []
            break
    models: list[str] = []
    for item in raw:
        name = str(item or "").strip()
        if name and name not in models:
            models.append(name)
    if default and default not in models:
        models.insert(0, default)
    return models if models else ([default] if default else [])


#: 模型 id 的来源前缀（与 MiniApp 薄壳同一套）。
MODEL_PREFIX_ENGINE = "engine:"


def model_catalog(disk_path: str | Path) -> dict:
    """模型档位声明——**两侧共用的那一份**。

    形状＝MiniApp 面板用的那套：``id`` / ``kind`` / ``label`` /
    ``model`` / ``efforts`` / ``defaultEffort``。核心的 ``[ai].models``
    与 MiniApp 的三路（宿主／引擎／自定义）都按这个形状声明——
    这样「同一个模型」在两侧是同一个概念，换机器也不会断。

    核心这一路只有引擎本地后端（``kind="engine"``）， efforts 留空：
    本地 OpenAI 兼容端点没有思考等级的概念。
    """
    default = str(ai_config(disk_path).get("model") or "").strip()
    models = []
    for name in available_models(disk_path):
        models.append({"id": MODEL_PREFIX_ENGINE + name,
                       "kind": "engine",
                       "label": name,
                       "model": name,
                       "efforts": [],
                       "defaultEffort": "",
                       "default": bool(default) and name == default})
    return {"source": "engine", "default": default,
            "defaultEffort": "", "models": models}
