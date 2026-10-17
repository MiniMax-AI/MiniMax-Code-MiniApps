"""AI 事务所 —— 游戏后端（Godot 客户端的唯一数据源）

端口 8850。API key 只存在这一层，Godot 客户端永远拿不到。

启动：.venv/bin/python server/game_app.py
客户端：http://127.0.0.1:8849/ （开发用 Web 原型，非最终游戏）
"""
import os
import json
import threading
import time
from flask import Flask, Response, request, jsonify, send_from_directory

HERE = os.path.dirname(__file__)

import game as G
import save as SAVE
import providers as P

app = Flask(__name__, static_folder=None)
_boot_lock = threading.Lock()

# 老板单次对话上限（防玩家打一篇长文烧掉额度）
CHAT_MAX_CHARS = 200

# ★M4-4 加的 off/back 必须也在这个白名单里。
#   game.Game.command() 认它们，但 HTTP 层有**自己一份** allowlist，
#   漏了的话 API 直接 400「未知指令：off」——而单测是直接调 g.command() 的，
#   绕过了这一层，所以 82 条断言全绿、真发 HTTP 才发现。
VALID_ACTIONS = ("goto", "rest", "assign", "accept", "meeting", "dismiss",
                 "blame_talk", "team_build", "off", "back", "reboot")
# 这些动作由游戏整体执行，不需要指定单个角色
GLOBAL_ACTIONS = ("accept", "meeting", "dismiss", "judge", "blame_talk",
                  "team_build")


@app.after_request
def no_cache(resp):
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.errorhandler(404)
def not_found(_e):
    return jsonify({"ok": False, "error": "not found"}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({"ok": False, "error": "internal"}), 500


@app.route("/")
def index():
    return send_from_directory(os.path.join(HERE, "..", "web"), "game.html")


@app.route("/api/state")
def state():
    return jsonify(G.GAME.snapshot())


@app.route("/api/command", methods=["POST"])
def command():
    d = request.get_json(silent=True) or {}
    action, arg = d.get("action"), d.get("arg")
    who = d.get("who") or d.get("id")

    # 全局动作不需要 who —— 必须在 who 校验之前分出去，
    # 否则发 {action:"accept"/"meeting"/"dismiss"} 会被误判成"缺少 who"。
    if action == "accept":
        return jsonify(G.GAME.accept(arg, bool(d.get("approved", True))))
    if action == "judge":
        return jsonify(G.GAME.judge(arg, d.get("kind", ""), G.GAME.tick))
    if action == "meeting":
        return jsonify(G.GAME.start_meeting(arg or "周会"))
    if action == "dismiss":
        return jsonify(G.GAME.dismiss_meeting())
    if action == "blame_talk":
        # 同样是全局动作：老板在复盘会上插话，不带 who
        return jsonify(G.GAME.blame_talk(arg))
    if action == "team_build":
        return jsonify(G.GAME.team_build())
    if not who:
        return jsonify({"ok": False, "msg": "缺少 who"}), 400
    if action not in VALID_ACTIONS:
        return jsonify({"ok": False, "msg": f"未知指令：{action}",
                        "valid": list(VALID_ACTIONS)}), 400
    return jsonify(G.GAME.command(who, action, arg))


@app.route("/api/accept", methods=["POST"])
def accept():
    d = request.get_json(silent=True) or {}
    return jsonify(G.GAME.accept(d.get("client"), bool(d.get("approved"))))


# ── M4-3 存档 ───────────────────────────────────────────────────────────
@app.route("/api/save", methods=["POST"])
def api_save():
    d = request.get_json(silent=True) or {}
    name = d.get("name") or "手动存档"
    try:
        sid = SAVE.save_game(G.GAME, name=name, auto=bool(d.get("auto")),
                             why=d.get("why", ""))
    except Exception as e:                      # 存不了不能把游戏带崩
        return jsonify({"ok": False, "msg": "存档失败：%s" % e}), 500
    SAVE.prune(keep=int(os.environ.get("GAME_SAVE_KEEP", "40")))
    return jsonify({"ok": True, "id": sid, "name": name})


@app.route("/api/load", methods=["POST"])
def api_load():
    d = request.get_json(silent=True) or {}
    got = SAVE.load_game(d.get("id"))
    if not got.get("ok"):
        return jsonify(got), 200          # 坏档不是服务器错误，是玩家的选择问题
    # ★读档前必须停主循环：否则下一 tick 就会把还原出来的位置/路径重算一遍，
    #   读档等于没读。停 → 还原 → 重启，中间这段就是读档窗口。
    G.GAME.running = False
    time.sleep(0.4)
    r = SAVE.restore(G.GAME, got)
    if r.get("ok"):
        threading.Thread(target=G.GAME.loop, daemon=True).start()
    return jsonify({**r, "id": d.get("id"), "name": got.get("name"),
                    "day": G.GAME.day, "money": G.GAME.money})


@app.route("/api/saves", methods=["GET"])
def api_saves():
    return jsonify({"ok": True, "saves": SAVE.list_saves()})


@app.route("/api/newday", methods=["POST"])
def newday():
    # M4-4：走 game._advance_day()，不再自己 day += 1。
    # 手动推日原来不重置 _day_start，和 AUTO_DAY 混用会一天结算两次。
    settle = G.GAME._advance_day()
    # M4-3：跨天自动存档。失败现场**先**单独存一份手动档——
    # 破产那一刻的现场是玩家最想回看的，而自动档会被 prune 清掉。
    over = G.GAME.game_over_reason
    fail_sid = None
    if over:
        fail_sid = SAVE.save_game(G.GAME, name="第%d天失败现场" % G.GAME.day,
                                  auto=False, why=over)
    sid = SAVE.save_game(G.GAME, name="第%d天结算" % G.GAME.day, auto=True,
                         why=over or "每日结算")
    SAVE.prune(keep=int(os.environ.get("GAME_SAVE_KEEP", "40")))
    return jsonify({"ok": True, "day": G.GAME.day, "settle": settle,
                    "money": G.GAME.money, "rep": G.GAME.rep,
                    "autosave": sid, "fail_save": fail_sid})


CHAT_SYSTEM_MAX_CHARS = 600


def chat_system(who):
    """老板 1:1 聊天的人设。和 providers.persona 分开：
    那份是"五个人开会"的口径（会复述别人的发言），单聊时要换掉。"""
    p = P.PROVIDERS[who]
    return (
        f"你是{p['name']}（{p['full']}），人设「{p['tag']}」：{p['blurb']}。\n"
        f"现在你在事务所里，**单独**和老板说话，别的同事不在场。\n"
        f"【硬性输出限制】\n"
        f"1. 最多 3 句，总字数不超过 80 字。\n"
        f"2. 口语化，像真人回消息。禁止分点罗列、写小标题、总结全场。\n"
        f"3. 不要复述上面给你的状态信息，老板已经知道了。\n"
        f"4. 可以带点你自己的脾气和立场。"
    )


@app.route("/api/chat", methods=["POST"])
def chat():
    """老板与单个 AI 对话。SSE 流式。"""
    d = request.get_json(silent=True) or {}
    who, text = d.get("who"), (d.get("text") or "").strip()
    if who not in P.PROVIDERS:
        # 用例要求"错误事件，不 500"：光回 400 不够，游戏里也要留下痕迹
        G.GAME.event("error", f"老板想找「{who}」说话，但没这个人")
        return jsonify({"ok": False, "msg": f"没有这个角色：{who}"}), 400
    if not text:
        return jsonify({"ok": False, "msg": "说点什么吧"}), 400
    if len(text) > CHAT_MAX_CHARS:
        # ★ 必须在调模型之前挡住：否则玩家一篇长文就把额度烧掉了
        G.GAME.event("chat_reject",
                     f"老板给 {who} 发了一段 {len(text)} 字的长文，被挡下")
        return jsonify({"ok": False,
                        "msg": f"太长了（{len(text)}字），一次最多 {CHAT_MAX_CHARS} 字"}), 400

    # 特殊指令：识别到就不调模型，直接改状态
    act = G.GAME.chat_command(who, text)
    if act:
        if act.get("kind") == "brain_down":
            return Response("data: %s\n\n" % json.dumps(
                {"type": "error", "who": who, "brain_down": True, "message": act["msg"]},
                ensure_ascii=False), mimetype="text/event-stream")
        G.GAME.chat_push(who, text, act["msg"])
        return jsonify({"ok": True, "msg": act["msg"], "effect": act})

    w = G.GAME.workers.get(who)
    brief = G.GAME.chat_brief(who)
    hist = G.GAME.chat_history(who)
    budget = P.chat_max_tokens(who)
    generation = G.GAME.gen

    def gen():
        yield "data: %s\n\n" % json.dumps({"type": "start", "who": who})
        got = ""
        failed = False
        for ev in G.GAME.model_stream(who, brief + text, history=hist or None,
                                system=chat_system(who),
                                max_completion_tokens=budget):
            if ev.get("type") == "delta":
                got += ev["text"]
            elif ev.get("type") == "error":
                failed = True
            yield "data: %s\n\n" % json.dumps(ev, ensure_ascii=False)
        if not G.GAME.gen_alive(generation) or G.GAME.workers.get(who) is not w:
            return
        if failed:
            got = ""
        reply = P.truncate(got.strip(), 200)
        G.GAME.chat_push(who, text, reply)
        yield "data: %s\n\n" % json.dumps(
            {"type": "finish", "who": who, "got_text": bool(reply)})
        if w and w.available:
            w.say("老板：%s" % text[:16])
            if reply:
                w.say(reply[:16])

    return Response(gen(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def boot():
    with _boot_lock:
        threading.Thread(target=G.GAME.loop, daemon=True).start()


if __name__ == "__main__":
    # 切换美术版本时先还原局面，再启动循环。
    resume_id = os.environ.get("AI_OFFICE_LOAD_SAVE", "")
    if resume_id:
        loaded = SAVE.load_game(resume_id)
        if not loaded.get("ok"):
            raise SystemExit("无法恢复接入前的存档")
        restored = SAVE.restore(G.GAME, loaded)
        if not restored.get("ok"):
            raise SystemExit("存档恢复失败")
        print("[BOOT] 已恢复接入前局面", flush=True)
    boot()
    print("=" * 58)
    print("  AI 事务所 后端 · http://127.0.0.1:8850")
    for w in P.ORDER:
        p = P.PROVIDERS[w]
        print(f"  · {p['name']:10s} {p['full']}")
    print("=" * 58, flush=True)
    app.run(host="127.0.0.1", port=8850, threaded=True, debug=False)
