"""AI 事务所 —— 游戏状态与核心循环

设计要点：
- 五个 AI 在网格地图上自主移动，去向由 Jev 决策（约 2.5s 一次，五角色并行单次调用）
- 移动本身是本地寻路 + 插值，不消耗 API
- 客户/任务等关键事件才调 LLM（真实交付物）
- 玩家可随时对任意角色下达指令，指令优先级高于 Jev
"""
import os, json, math, random, threading, time, uuid

SPAWN_SEC = float(os.environ.get("GAME_SPAWN_SEC", "25"))
# 复盘会结算后留给客户端展示结果的秒数，超时就自动散会把人放回工位
BLAME_HOLD = float(os.environ.get("GAME_BLAME_HOLD", "15"))
# 复盘会为了不打断在跑的活，最多先等这么久（等不到就插进去）
BLAME_MAX_WAIT = float(os.environ.get("GAME_BLAME_WAIT", "45"))

# ── 时间单位（M4-4）─────────────────────────────────────────────────────────
# ★M4-4 发现：这套数值里**"游戏日"从来没有被定义过**。
#   跨天只能靠外部打 /api/newday，于是 M3-9 的"30 天长局"其实是
#   30 × 1.2 秒 = 36 秒的游戏过程（见 tools/long_run.py），
#   而那边的策略**从不派任何人去休息**——于是每单 -22 体力只扣不还，
#   工资照发。测出来的"体力经济崩了"，一大半是驱动脚本自己造的。
#   单位混用是这个 bug 的根：耐心的单位是 tick、体力衰减的单位是 tick、
#   工资的单位是天，三者之间**没有换算关系**，谁也没法验算。
#
# 现在把它钉死：
#   TICK_SEC   一个 tick 的真实秒数（0.12 保持不变 → 屏幕上的移动手感不变）
#   DAY_TICKS  一个游戏日多少 tick（720 tick = 86.4 秒 ≈ 1.4 分钟）
#   TIME_SCALE 时间倍速，默认 1.0 = 正常游玩；平衡模拟器用 30。
#
# ★ 为什么是 720：游戏内钟是「1 tick = 2 游戏分钟」，720 tick 正好一整天，
#   clock 显示不会一天绕三圈。（原来注释写「1 tick = 5 分钟、1 天 = 288 tick」，
#   那是"一天 34 秒"的意思——一次交付 45~75 秒比一整天还长，比例本身就不成立。）
#   720 tick = 86.4 游戏秒时，一次交付 45~75 秒 ≈ 半天到 0.9 天，
#   一个人一天能干 1~2 单，五个人一天 5~8 单，与 3.5 个客户/天的到店节奏匹配。
#
# TIME_SCALE 的语义是**"墙上时钟缩放"**：整个游戏按同样比例跑快，
# 所有比例（每单扣多少体力、一天几单、工资多少）**一个都不变**。规则：
#   · "每 tick 多少"的量（体力/心情/耐心）→ ×K（K = 1/TIME_SCALE）
#   · "每游戏秒多少"的量（移动速度）      → **不乘 K**
#   · "按真实秒计的阈值"（Jev/到店/开会等）→ ÷TIME_SCALE
#   （移动那条我一开始也乘了 K，工人直接 30 倍慢，永远走不到接待处，30 天 0 单。）
TICK_SEC = float(os.environ.get("GAME_TICK_SEC", "0.12"))
TIME_SCALE = float(os.environ.get("GAME_TIME_SCALE", "1.0"))
if not (TIME_SCALE > 0):
    TIME_SCALE = 1.0
K = 1.0 / TIME_SCALE              # 每 tick 量的缩放系数
DAY_TICKS = int(os.environ.get("GAME_DAY_TICKS", "720"))
TICK_GAME_MIN = int(os.environ.get("GAME_TICK_MIN", "2"))   # 1 tick = 2 游戏分钟
# 自动跨天：默认关（Godot 客户端自己按剧本推日），平衡模拟器打开
AUTO_DAY = os.environ.get("GAME_AUTO_DAY", "0") == "1"
from collections import deque
import requests

from dotenv import load_dotenv
HERE = os.path.dirname(__file__)
load_dotenv(os.environ.get("AI_OFFICE_ENV_PATH") or os.path.join(HERE, "..", ".env"))

import providers as P
import scheduler as S
import relations as REL
import conflict as CF
import banter as BT
import blame_game as BG
import stats as ST

# ── 地图 ────────────────────────────────────────────────────────────────────
# 一张连续大地图，分三个功能区。客户和员工必须在同一空间才能互动，
# 所以不做成三张独立场景（M2-1 的设计修正，原 DEV_PLAN 写的是"三场景"）。
#
#   x: 1 ── 12      14 ── 26        28 ── 38
#      大堂          办公区           会议室 / 茶水 / 摸鱼
#      客户进门      干活 / 休息       开会
GW, GH = 40, 24
FLOOR = {(x, y) for x in range(GW) for y in range(GH)}
WALLS = set()
# 四周墙
for x in range(GW):
    WALLS.add((x, 0)); WALLS.add((x, GH - 1))
for y in range(GH):
    WALLS.add((0, y)); WALLS.add((GW - 1, y))
# 大门的两格开口与门图、地垫、客户出生点共用同一条通道。
WALLS.difference_update({(0, 11), (0, 12)})
# 区域隔断（留门）
for y in range(3, 21):          # 大堂 | 办公区
    WALLS.add((13, y))
for y in range(1, 23):          # 办公区 | 会议室区
    WALLS.add((27, y))
WALLS.discard((13, 5)); WALLS.discard((13, 18))       # 大堂两个门
WALLS.discard((27, 6)); WALLS.discard((27, 17))      # 办公区两个门
# 茶水间上方隔断；休息角的椅子前方保持开放。
for x in range(22, 27):
    WALLS.add((x, 2))
# 会议室隔墙（下半部分隔开，形成独立房间）
for x in range(29, 38):
    WALLS.add((x, 17))
WALLS.discard((33, 17))

LOCATIONS = {
    "entrance":  (0, 12),     # 大门：客户从墙体开口进来
    "reception": (7, 9),      # 接待台：客户在这排队
    "waiting":   (9, 17),     # 等候沙发
    "desk":      (20, 7),     # 工位：干活
    "lounge":    (24, 6),     # 茶水台前的可站立点：回体力
    "slack":     (24, 20),    # 摸鱼角：回心情
    "meeting":   (33, 12),    # 会议室
}
LOC_LABEL = {"entrance": "大门", "reception": "接待处", "waiting": "等候区",
             "desk": "工位", "lounge": "茶水间", "slack": "摸鱼角",
             "meeting": "会议室"}

# ── 会议室座位（M2-2）────────────────────────────────────────────────────────
# 长桌横卧在 y=9，五个座位分列上下：M3 坐主席位（北侧中间），其余分列两侧。
# 座位固定分配：同一 who 每次都坐同一个位置，玩家能形成空间记忆。
MEETING_TABLE = (33, 9)
SEATS = {
    "m3":      (31, 7),     # 主席位
    "flash":   (33, 7),
    "kimi":    (35, 7),
    "longcat": (32, 11),
    "step5":   (34, 11),
}
# 开会时的状态标签
MEETING_ACT = "开会中"

# V2 五个完整工位，桌椅和可站立点分开，避免五人挤在同一排窄格。
DESKS = {"m3": (16, 10), "flash": (20, 10), "longcat": (24, 10),
         "kimi": (16, 14), "step5": (20, 14)}
REST_SPOTS = {
    "lounge": {"m3": (23, 6), "flash": (25, 6), "longcat": (22, 7),
               "kimi": (24, 7), "step5": (26, 7)},
    "slack": {"flash": (17, 21), "longcat": (20, 21), "step5": (23, 21)},
}
FURNITURE_CELLS = set()



_LAYOUT = os.path.join(HERE, "..", "data", "office_layout_v2.json")
ARCHITECTURE_WALLS = WALLS.copy()
with open(_LAYOUT, encoding="utf-8") as _layout_file:
    for _prop in json.load(_layout_file)["props"]:
        FURNITURE_CELLS.update(tuple(cell) for cell in _prop.get("blocked_cells", []))
WALLS.update(FURNITURE_CELLS)


def seat_of(who: str):
    return SEATS.get(who)

# 每个角色可去的地方
CAN_GO = {
    "m3":      ["desk", "meeting", "lounge"],
    "flash":   ["desk", "meeting", "lounge", "slack"],
    "longcat": ["desk", "meeting", "lounge", "slack"],
    "kimi":    ["desk", "meeting", "lounge"],
    "step5":   ["desk", "meeting", "lounge", "slack"],
}

# 角色属性：速度(格/秒) / 体力上限 / 干活速度倍率
ATTR = {
    "m3":      {"speed": 1.6, "stamina_max": 100, "work_rate": 1.0, "quality": 0.92},
    "flash":   {"speed": 2.8, "stamina_max": 100, "work_rate": 1.5, "quality": 0.62},
    "longcat": {"speed": 2.2, "stamina_max": 120, "work_rate": 1.2, "quality": 0.75},
    "kimi":    {"speed": 1.4, "stamina_max": 100, "work_rate": 0.9, "quality": 0.95},
    "step5":   {"speed": 2.4, "stamina_max": 110, "work_rate": 1.35, "quality": 0.80},
}

CLIENT_TASKS = [
    ("帮我写一份产品需求文档", "document"),
    ("把这个功能的需求讲清楚", "document"),
    ("审一下这个方案有哪些坑", "review"),
    ("整理这堆资料出个总结", "summarize"),
    ("给这个需求估个工期", "estimate"),
    ("想三个可落地的功能方向", "ideate"),
    # ★DESIGN 5.1 有 7 类需求，原来只实现了 5 类，缺「执行」。
    #   执行是 ★★★ 中高档（120-180），是"派 Step5/LongCat"这条路由的主要载体；
    #   少了它，模拟器 SKILL 表里的 execute 分支从来没被跑到过。
    ("帮我把这套流程跑通", "execute"),
]


def passable(p):
    return p in FLOOR and p not in WALLS


def nearest_passable(pos):
    """旧存档的位置若落在新家具里，只在内存中移到最近空格。"""
    cell = (int(round(pos[0])), int(round(pos[1])))
    if passable(cell):
        return tuple(pos)
    return min(FLOOR - WALLS,
               key=lambda p: (abs(p[0] - pos[0]) + abs(p[1] - pos[1]),
                              p[1], p[0]))


def bfs_path(start, goal):
    """网格 BFS。够用（26x15=390 格），不引入 A* 依赖。"""
    if not passable(goal):
        return []
    if start == goal:
        return []
    prev = {start: None}
    q = deque([start])
    while q:
        cur = q.popleft()
        for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nxt = (cur[0] + dx, cur[1] + dy)
            if nxt in prev or not passable(nxt):
                continue
            prev[nxt] = cur
            if nxt == goal:
                path = []
                while prev[nxt] is not None:
                    path.append(nxt)
                    nxt = prev[nxt]
                return path[::-1]
            q.append(nxt)
    return []


class Worker:
    def __init__(self, who, pos):
        self.who = who
        self.pos = pos
        self.path = []
        self.stamina = ATTR[who]["stamina_max"]
        self.mood = 70
        self.job = None            # 当前接的活
        self.working = 0.0         # 已工作进度（秒）
        self.need = ATTR[who]["work_rate"] * 10   # 完成这个活需要的"有效工作秒"
        self.order = None          # 玩家指令（优先级最高）
        self.acting = "闲逛"
        self.log = []
        self.busy = False
        self.seated = False          # 是否已就座（开会中）
        self.seat_cmd = False        # 会议指令：优先级高于 goto / 接单 / Jev 自主
        # M2-8 动态属性
        self.fatigue = 0             # 连续工作天数，满 3 罢工
        self.strike_days = 0        # 连续罢工天数，到 2 离职
        self.quit = False           # 离职后永久不可用
        self.strike = False          # 今天罢工中（当天不干活）
        self.eff = 1.0               # 本单开工时的效率（受体力影响）
        self.worked_today = False    # 今天有没有真的出活（算疲劳用）
        # ★M4-4 新增：今天轮休。DESIGN 6.5 写着「玩家的应对：主动安排轮休」，
        #   但原来**根本没有"不上工"这个指令**——`rest` 只是把人送进茶水间，
        #   他照样接单、照样算 worked_today，于是疲劳只涨不跌，
        #   5 个人第 5~7 天集体罢工、两天后全离职（实测 8 天局全员走光）。
        #   设计承诺的应对手段没实现，任何调参都救不回来：不是数值太狠，
        #   是玩家手里没有那个牌。
        self.off_today = False       # 轮休：今天不接单、不涨疲劳
        self.brain_down = False
        self.brain_reason = ""
        self.brain_scope = "model"
        self.brain_epoch = 0
        self.brain_checking = False
        # ── M4-2：打字活动（给客户端同步打字音用）──
        #   关键在于**速率**而不是"有没有在干活"：只知道"他在干活"，
        #   客户端只能按固定节奏放音，模型在长思考（停顿）时照样哒哒哒。
        #   type_cps 是滑动窗口的字/秒，客户端按它调间隔。
        self.typing = False
        self.type_cps = 0.0
        self._t_start = 0.0
        self._t_win = 0.0

    # ★M4-2 实测（2026-10-05，m3 真实交付）：
    #   41 个 delta 块 / 128 字，**首块之前空了 1.46 秒**（模型在思考），
    #   吐字窗口只有 1.74 秒，块间间隔中位数 12ms、最大 672ms。
    #   也就是说：大部分时间模型在**想**，不是在"打"字。
    #   所以打字音必须在**收到第一个字之后**才开，不是一进"干活中"就开——
    #   否则那 1.46 秒的思考期客户端会按角色基础手速一直哒哒哒，
    #   正好违反计划里"停顿处也停顿"那条。
    TYPING_GAP = 0.6          # 超过这么久没吐字就当停了（M3-2 实测最大间隔 0.67s）

    def begin_typing(self) -> None:
        """只是"准备干活"，**不等于在打字**。要等第一个 delta。"""
        self.typing = False
        self.type_cps = 0.0
        self._t_start = time.time()
        self._t_win = 0.0

    def feed_typing(self, n: int) -> None:
        """喂进 n 个字符，更新字/秒。窗口至少 0.4s，太短会被抖成噪声。"""
        now = time.time()
        if self._t_start <= 0.0:
            self._t_start = now
        self._t_win += max(0, n)
        dt = now - self._t_start
        if dt < 0.4:
            self.typing = True      # 有字进来了 → 真的在打字
            return
        inst = self._t_win / dt
        # 一阶低通：跟上一个窗口做指数平滑，免得间隔忽快忽慢听着神经衰弱
        self.type_cps = inst if self.type_cps <= 0.0 else self.type_cps * 0.45 + inst * 0.55
        self.typing = True
        self._t_start = now
        self._t_win = 0.0

    def tick_typing(self) -> None:
        """看门狗：太久没吐字就停。主循环每 tick 调一次。

        没有它的话，41 块吐完之后模型去"想下一步"的那 672ms 里，
        客户端会一直以为还在打字——停顿处不停，等于没同步。
        """
        if self.typing and self._t_start > 0.0 and \
                time.time() - self._t_start > self.TYPING_GAP:
            self.typing = False
            self.type_cps = 0.0
            self._t_start = 0.0
            self._t_win = 0.0

    def end_typing(self) -> None:
        self.typing = False
        self.type_cps = 0.0
        self._t_start = 0.0
        self._t_win = 0.0

    @property
    def meta(self):
        return P.PROVIDERS[self.who]

    @property
    def on_duty(self):
        """还在职。离职的人不算人力，不发工资、不接单、不参会。"""
        return not self.quit

    @property
    def available(self):
        return self.on_duty and not self.brain_down

    def say(self, t):
        self.log.append(t)
        self.log = self.log[-6:]


class Client:
    # ★M3-7：人形。DESIGN 5.1 的"基础人形 5 种"之前只有设定、没有实现，
    #   kind 存的是需求类型，和人形是两回事，别混。
    PERSONAS = {
        "normal":     "普通上班族",
        "boss":       "创业公司老板",
        "client_hard": "甲方大人",
        "geek":       "极客程序员",
        "young":      "年轻客户",
    }

    def __init__(self, task, reward, patience, need, persona=None):
        self.id = uuid.uuid4().hex[:6]
        self.task = task
        self.kind = need                        # 需求类型 document/analysis/…
        self.persona = persona or random.choice(list(self.PERSONAS))
        self.reward = reward
        self.patience_max = patience
        self.patience = patience
        self.slot = None
        self.served_by = None
        self.status = "等待"      # 等待 / 抢单中 / 服务中 / 待验收 / 已完成 / 已流失
        self.result = None
        self.grab_tick = 10**9
        self.pos = tuple(LOCATIONS["entrance"])

    @property
    def persona_name(self):
        return self.PERSONAS.get(self.persona, "普通上班族")


class Game:
    def __init__(self):
        self.reset()

    def reset(self):
        self.day = 1
        # ★M4-4：原来这里写死 300，而 stats.INIT_MONEY 是 500（DESIGN 7.1）。
        #   两处不一致的直接后果：平衡模拟器按 500 起跑，真实游戏按 300 起跑，
        #   模拟结论和实玩对不上，差 200 块。唯一正确的做法是这里读常量。
        self.money = ST.INIT_MONEY
        self.rep = ST.INIT_REP
        self._day_start = 0        # 本天第几个 tick（M4-4 自动跨天的分母）
        # ★M4-3 世代号：reset() / 读档都会 +1。
        #   起因是「读档不撤销在跑的 LLM 线程」——一次交付要 45~75 秒，
        #   期间玩家按了读档，还原出一个**全新的 clients 列表和 Worker 对象**，
        #   那个线程醒来后照样会执行 c.result=... / worker.worked_today=True，
        #   甚至可能往 self.clients / self.slots 上插东西。
        #   办法：线程每步拿自己的起点世代号比一下，对不上就地收工。
        self.gen = 0
        self.workers = {
            "m3":      Worker("m3", (16, 10)),
            "flash":   Worker("flash", (20, 10)),
            "longcat": Worker("longcat", (24, 10)),
            "kimi":    Worker("kimi", (16, 14)),
            "step5":   Worker("step5", (20, 14)),
        }
        self.clients = []
        self.slots = {}            # 接待位 -> client
        self.events = []           # 全局事件流
        self.log = []
        self.running = False
        self.tick = 0
        self.meeting = None          # {"topic","seated","phase","started"}
        self.conflicts = {}          # client_id -> {"a","b","lines","task"}
        self._cf_store = {}          # 冲突冷却
        self._bt_store = {}          # 吐槽冷却
        self.banters = []            # 最近的吐槽对话（给客户端气泡）
        self.failures = []           # M2-6：今天干砸的单（发生时就记，不事后反推）
        self.finished = []           # M3-9：已完结客户的滚动存档（上限 4）
        self._blame_store = {}       # 复盘会冷却（记 last_blame_day）
        self.neg_days = 0            # M2-8：资金为负已持续几天（满 3 天破产）
        self._blame_want_at = 0.0    # 复盘会想开但还在等活干完的时刻
        self.game_over_reason = None  # M2-8：失败原因，非 None 即游戏结束
        self.last_settle = None      # 最近一次每日结算明细
        self._jev_at = 0
        self._spawn_at = 0
        self._lock = threading.RLock()

    # ── 事件 ──
    def event(self, kind, text, who=None, extra=None):
        e = {"t": round(time.time(), 2), "kind": kind, "text": text, "who": who}
        if extra:
            e.update(extra)
        self.events.append(e)
        self.events = self.events[-120:]
        return e

    def note(self, text):
        self.log.append(f"第{self.day}天 · {text}")
        self.log = self.log[-40:]

    def _freeze_brain(self, w):
        w.order = None
        w.path = []
        w.goal_key = None
        w.job = None
        w.seat_cmd = False
        w.seated = False
        w.busy = False
        w.acting = "脑袋宕机了"
        w.end_typing()

    def shutdown_model(self, who, error, gen=None):
        """停掉耗尽额度的模型，并把尚未交付的客户交还给其他人。"""
        with self._lock:
            if gen is not None and not self.gen_alive(gen):
                return
            affected = [who]
            if error.get("scope") == "credential":
                key = P.PROVIDERS[who]["key_env"]
                affected = [k for k in self.workers if P.PROVIDERS[k]["key_env"] == key]
            for cid, cf in list(self.conflicts.items()):
                if not set((cf["a"], cf["b"])).intersection(affected):
                    continue
                self.conflicts.pop(cid, None)
                for peer in (cf["a"], cf["b"]):
                    w = self.workers[peer]
                    w.job, w.order, w.path = None, None, []
                    w.brain_epoch += 1
                    if not w.brain_down:
                        w.acting = "在工位待命"
                c = next((c for c in self.clients if c.id == cid), None)
                if c:
                    c.status, c.served_by, c.result = "等待", None, ""
                    c.grab_tick = self.tick + 90
            for w in self.workers.values():
                if w.who not in affected or w.brain_down:
                    continue
                w.brain_down = True
                w.brain_reason = error.get("category", "quota")
                w.brain_scope = error.get("scope", "model")
                w.brain_epoch += 1
                w.brain_checking = False
                self._freeze_brain(w)
                if self.meeting:
                    self.meeting["seated"] = [p for p in self.meeting.get("seated", []) if p != w.who]
                for c in self.clients:
                    if c.served_by == w.who and c.status in ("等待", "服务中", "抢单中"):
                        c.status, c.served_by, c.result = "等待", None, ""
                        c.grab_tick = self.tick + 90
                        c.patience = max(c.patience, c.patience_max)
                self.event("brain_down", "%s：%s，暂停接单和行动" %
                           (w.meta["name"], error["message"]), who=w.who)

    def model_stream(self, who, *args, **kwargs):
        w = self.workers[who]
        gen, epoch = self.gen, w.brain_epoch
        if not w.available:
            yield {**P.error_event(who, category=w.brain_reason or "auth"),
                   "message": "脑袋宕机了，额度恢复后再重启脑袋"}
            return
        for ev in P.stream_chat(who, *args, **kwargs):
            if not self.gen_alive(gen) or self.workers.get(who) is not w or w.brain_epoch != epoch:
                yield P.error_event(who, category="cancelled")
                return
            if ev.get("type") == "error" and ev.get("brain_down"):
                self.shutdown_model(who, ev, gen)
            yield ev
            if ev.get("type") == "error":
                return

    def _reboot_thread(self, who, gen, epoch):
        w = self.workers[who]
        if not self.gen_alive(gen) or w.brain_epoch != epoch:
            return
        failed = False
        accepted = False
        try:
            for ev in P.stream_chat(who, "只回复：好", system="检查连接，只回复一个字。",
                                    max_completion_tokens=64):
                if ev.get("type") == "error":
                    failed = True
                    break
                if ev.get("type") == "done":
                    accepted = True
            with self._lock:
                if not self.gen_alive(gen) or self.workers.get(who) is not w or w.brain_epoch != epoch:
                    return
                w.brain_checking = False
                if failed or not accepted:
                    self.event("brain_check", "%s 还没恢复，继续宕机" % w.meta["name"], who=who)
                    return
                reason, scope = w.brain_reason, w.brain_scope
                for other in self.workers.values():
                    shared = scope == "credential" and other.brain_scope == "credential" and \
                        P.PROVIDERS[other.who]["key_env"] == P.PROVIDERS[who]["key_env"]
                    if other is w or (shared and other.brain_reason == reason):
                        other.brain_down, other.brain_reason = False, ""
                        other.brain_checking = False
                        other.brain_epoch += 1
                        other.acting = "在工位待命"
                self.event("brain_reboot", "%s 脑袋重启成功，可以继续接单" % w.meta["name"], who=who)
        finally:
            if self.gen_alive(gen) and self.workers.get(who) is w and w.brain_epoch == epoch:
                w.brain_checking = False

    # ── 客户 ──
    # ★DESIGN 3.2：「客户到达节奏：第 1 天 3 个，每过一天 +1，上限 5 个同时在等」
    #   原来这里是硬编码的 3 —— 客流从第 1 天到第 30 天**完全不变**，
    #   于是"越玩越忙"的成长感不存在，后期压力也上不来。
    # ★DESIGN 7.1：「声誉 0-100，影响客户数量**和**报酬」——
    #   声誉对报酬那半早就实现了（stats.reward_scale），数量这半一直缺。
    #   现在：基础槽位随天数 3→5，声望 ≥80 提前一天多一席。
    @staticmethod
    def client_slots(day, rep):
        base = 3 + (max(1, day) - 1) // 2      # 1~2天:3  3~4天:4  5天起:5
        bonus = 1 if rep >= 80 else 0          # 口碑好，客人来得更早
        return max(3, min(5, base + bonus))

    def spawn_client(self):
        cap = self.client_slots(self.day, self.rep)
        if len(self.slots) >= cap:
            return
        free = [i for i in range(cap) if i not in self.slots]
        if not free:
            return
        # 需求去重：最近 8 个任务不重复，避免同一批客户全是同一个需求
        recent = [getattr(c, "task", None) for c in self.clients][-8:]
        pool = [t for t in CLIENT_TASKS if t[0] not in recent] or CLIENT_TASKS
        task, kind = random.choice(pool)
        # ★M4-4：难度/报酬挂**声誉**，不是挂天数。
        #   原来 `diff = 1 + (self.day - 1) * 0.12` 是按天复利 12%，
        #   30 天后单子值 4.5 倍，钱从 500 涨到 21921（44 倍）、声誉第 7 天顶到 100，
        #   破产这个失败条件在设计上根本不可能触发——调参前先确认这一条。
        #   DESIGN 7.1 原话是「声誉 0-100，影响客户数量和报酬」，
        #   声誉有上限（100），报酬就不会无限膨胀，而且膨胀得靠玩家挣。
        diff = ST.reward_scale(self.rep)
        # 耐心按 tick 计。1 tick = 2 游戏分钟，1 天 = 720 tick（DAY_TICKS）。
        # ★M3-9 实测修正：耐心原来 170~280 tick，接单后 ×2.2 也只有 53~88 tick，
        #   而一次真实交付要 375~625 tick——**耐心比交付还短**，
        #   客户系统性地在活干完之前就走了，游戏先天不可赢。
        #   提到 400~700（接单后 880~1540 tick = 176~308 游戏秒），
        #   给慢模型（M3 思考占输出 98%）留够余量。
        # ★M4-4 重做：DESIGN 5.1 给了**分类型**报酬表（跑腿 40-60 / 长文 160-240 /
        #   急单 200-300），那个跨度不是装饰——它是"派谁干"的路由驱动力。
        #   M4-4 第一版把它压平成 randint(35, 90)：均值只有设计稿的 45%，
        #   跨度从 7.5 倍缩到 2.6 倍，设计意图被平掉了。
        #   现在按类型取区间；REWARD_BY_KIND 没设时才退回扁平的 REWARD_RANGE
        #   （模拟器的对照实验用这个开关，生产路径默认走类型表）。
        # ★DESIGN 5.1 给了分类型报酬表，这是设计稿的数字，不是调出来的。
        #   M4-4 第一版把它压平成 randint(35, 90)（均值只有设计的 45%、
        #   跨度从 7.5 倍缩到 2.6 倍），是"双向钢人"里反方赢了这一条。
        by_kind = getattr(ST, "REWARD_BY_KIND", None) or ST.DESIGN_REWARD
        if by_kind:
            lo, hi = by_kind.get(kind, by_kind.get("_default", ST.REWARD_RANGE))
            reward = random.randint(lo, hi)
        else:
            reward = random.randint(*ST.REWARD_RANGE)
        c = Client(task, int(reward * diff), int(random.randint(400, 700)), kind)
        c.slot = free[0]
        c.pos = tuple(LOCATIONS["entrance"])
        self.slots[free[0]] = c
        self.clients.append(c)
        c.grab_tick = self.tick + 70        # 玩家 70 tick(~8s) 不派单，AI 就自己抢
        self.event("client_arrive", f"新客户来了：{c.task}", extra={"client": c.id})

    def _auto_grab(self, c):
        """玩家没派人，AI 自己抢。可能是单抢，也可能撞车（M2-4）。"""
        # M2-8：离职 / 罢工 / 体力见底的人不参与抢单。
        # 心情低的只挑简单单（client 有 difficulty 的话）也在这里挡。
        idle = [w for w in self.workers.values()
                if not w.job and w.stamina > 20 and w.available
                and not w.strike and not w.off_today
                and ST.can_accept(w.stamina)]
        if not idle:
            return
        # 心情 < 40 的不接复杂单
        if getattr(c, "difficulty", 1) >= 2:
            calm = [w for w in idle if ST.accepts_complex(w.mood)]
            if calm:
                idle = calm
        contenders = CF.pick_contenders([w.who for w in idle], self._cf_store, c.id, c.reward)
        if not contenders:
            contenders = [random.choice(idle).who]
        if len(contenders) >= 2:
            self._start_conflict(c, contenders[0], contenders[1])
            return
        who = contenders[0]
        c.served_by = who
        c.status = "抢单中"
        w = self.workers[who]
        w.job = c.id
        w.acting = "去抢单"
        w.order = ("goto", ("reception", c.slot))
        self.event("grab", f"{w.meta['name']} 自己把「{c.task}」抢走了", who=who)
        threading.Thread(target=self._serve_client_thread,
                             args=(c.id, self.gen), daemon=True).start()

    # ── 抢单冲突（M2-4）──
    def _start_conflict(self, c, a, b):
        if c.id in self.conflicts:
            return                      # 已有冲突，不重复起线程
        c.status = "冲突中"
        self.conflicts[c.id] = {"a": a, "b": b, "task": c.task, "lines": [],
                                "client": c.id, "judged": False}
        for who in (a, b):
            w = self.workers[who]
            w.job = c.id                 # 锁定：冲突期间不能被别人接走
            w.order = ("goto", ("reception", c.slot))
            w.acting = "去理论"
        self.event("conflict_start",
                   f"{self.workers[a].meta['name']} 和 {self.workers[b].meta['name']} 为「{c.task}」吵起来了")
        threading.Thread(target=self._conflict_thread, args=(c.id, a, b), daemon=True).start()

    def _conflict_thread(self, cid, a, b):
        cf = self.conflicts.get(cid)
        if not cf:
            return
        original, gen = cf, self.gen
        lines = CF.build_argument(cid, cf["task"], a, b, self._cf_store, self.tick,
                                  stream=self.model_stream)
        with self._lock:
            cf = self.conflicts.get(cid)
            if cf is not original or not self.gen_alive(gen):
                return
            cf["lines"] = lines
        for ln in lines:
            self.event("argue", f"{P.PROVIDERS[ln['who']]['name']}：{ln['text'][:40]}",
                       who=ln["who"])

    def judge(self, cid, kind, tick=0):
        """玩家裁决。kind ∈ a/b/reject/scold"""
        if kind not in CF.JUDGE_CHOICES:
            return {"ok": False, "msg": "未知裁决"}
        with self._lock:
            cf = self.conflicts.get(cid)
            if not cf or cf.get("judged"):
                return {"ok": False, "msg": "这场冲突已经判过了"}
            c = next((x for x in self.clients if x.id == cid), None)
            a, b = cf["a"], cf["b"]
            res = CF.apply_judgement(kind, a, b, tick)
            for who, dm in res["mood"].items():
                w = self.workers[who]
                w.mood = max(0, min(100, w.mood + dm))
            cf["judged"] = True
            winner = {"a": a, "b": b}.get(kind)
            if winner:
                c.served_by = winner
                c.status = "抢单中"
                w = self.workers[winner]
                w.order = ("goto", ("reception", c.slot))
                w.acting = "去接单"
                self.workers[a if winner == b else b].job = None
                self.event("judge", f"你把活判给 {w.meta['name']}")
                threading.Thread(target=self._serve_client_thread,
                                     args=(cid, self.gen),
                                     daemon=True).start()
            else:
                c.served_by = None
                c.status = "等待"
                c.patience = max(0, c.patience - 50)
                # 玩家刚裁决"都不接"，要给他喘息时间重新决定派谁。
                # 不然下一个 tick _auto_grab 立刻又把单抢走，玩家裁决形同虚设。
                c.grab_tick = self.tick + 90
                for who in (a, b):
                    self.workers[who].job = None
                    self.workers[who].order = None
                    self.workers[who].acting = "理论输了"
                self.event("judge", "你谁也没让，客户还在等（稍后可能又被抢）")
            self.conflicts.pop(cid, None)
        return {"ok": True, "kind": kind, "winner": winner}

    def conflicts_view(self):
        return [{"client": k, "a": v["a"], "b": v["b"], "task": v["task"],
                 "lines": v["lines"], "judged": v.get("judged", False)}
                for k, v in self.conflicts.items() if not v.get("judged")]

    def _serve_client_thread(self, cid, gen=None):
        """AI 走到客户那里接单，然后走到工位干活，最后交付。

        gen 是**本线程启动时**的世代号。每跨一次长等待、每次要写回状态之前都验一次
        ——中间可能已经读档了，那时候继续写就是往已还原的状态上糊东西。
        """
        if gen is None:
            gen = self.gen
        c = next((x for x in self.clients if x.id == cid), None)
        if not c:
            return
        try:
            w = c.served_by
            worker = self.workers.get(w)
            if not worker or not worker.available:
                return
            c.status = "服务中"
            # 既然有人接了，客户愿意等——把耐心重置并放大，别让 AI 干到一半客户跑了
            c.patience = int(c.patience_max * 2.2)
            # 1) 走去接待（会议优先：正在开会就先去开会，客户等得起）
            if not self._seat_ready(worker, 90):
                if not worker.available:
                    return
                c.status = "已流失"
                self.slots.pop(c.slot, None)
                return
            # ★_seat_ready 返回"已就座"意味着会议还在开。这会儿直接派他去接待处是走不到的
            #   （seat_cmd 压过 goto），只能白等 _await_at 超时、客户耐心耗尽而流失。
            #   所以这里等会议真的散了再继续干活。
            self._await_meeting_end(worker, c, 120)
            if not self.gen_alive(gen) or c.status == "已流失" or not worker.available or c.served_by != w:
                return
            worker.order = ("goto", ("reception", c.slot))
            worker.acting = "去接客户"
            self._await_at(worker, "reception", c.slot, 90)
            # ★每次长等待之后都验世代
            if not self.gen_alive(gen) or c.status == "已流失" or not worker.available or c.served_by != w:
                return
            worker.say(f"接下了：{c.task}")
            self.event("accept", f"{worker.meta['name']} 接下了「{c.task}」", who=w)
            # 2) 去工位干活（真实调用）
            worker.order = ("goto", ("desk", worker.who))
            worker.acting = "去工位"
            self._await_at(worker, "desk", worker.who, 120)
            if not self.gen_alive(gen) or c.status == "已流失" or not worker.available or c.served_by != w:
                return
            worker.acting = "干活中"
            # 3) 干活：真实 LLM 调用产出交付物
            #    ★ 三道防线见 providers.py：deliver_system 硬约束 + 按模型分配
            #      max_completion_tokens + truncate 兜底。空结果自动重试一次。
            worker.working = 0
            # M2-8：体力低 → 效率打折。真正落地在收入上（accept 里按 eff 折质量），
            # 不然"效率 -30%"只是个没人看得见的数字。
            worker.eff = ST.efficiency(worker.stamina)
            worker.need = ST.work_need(ATTR[worker.who]["work_rate"] * 10,
                                       worker.stamina)
            deliver = ""
            # ★M4-2：干活期间开打字活动，逐个 delta 喂字符数进去。
            #   异常路径也一定要 end_typing()，否则这个人会一直"打着字"，
            #   而且 finally 里再调一次是幂等的（end_typing 只是置位）。
            worker.begin_typing()
            try:
                for ev in P.deliver_stream(w, c.task, stream=self.model_stream):
                    if ev.get("type") == "delta":
                        worker.feed_typing(len(ev.get("text", "")))
                    elif ev.get("type") == "deliver":
                        deliver = ev.get("text", "")
                    elif ev.get("type") == "error":
                        if worker.available and c.served_by == w:
                            c.status, c.served_by = "等待", None
                            c.grab_tick = self.tick + 90
                            worker.job, worker.order = None, None
                            worker.acting = "在工位待命"
                        return
            finally:
                worker.end_typing()
            # ★最关键的一处：LLM 回来了，确认还是同一代才允许写回交付物。
            #   不确认的话这行会把结果写进读档后那个全新的状态里，
            #   而那个 Client 对象根本不在 clients 列表里了。
            if not self.gen_alive(gen) or not worker.available or c.served_by != w:
                return
            c.result = deliver or "（这次没交出东西）"
            if deliver:
                worker.worked_today = True
            # 4) 回接待处交付
            worker.order = ("goto", ("reception", c.slot))
            worker.acting = "回去交付"
            self._await_at(worker, "reception", c.slot, 90)
            if not self.gen_alive(gen) or c.status == "已流失" or not worker.available or c.served_by != w:
                return
            c.status = "待验收"
            worker.order = None
            worker.acting = "在工位待命"
            self.event("deliver", f"{worker.meta['name']} 交付了「{c.task}」，等你验收", who=w,
                       extra={"client": cid})
        except Exception as e:
            self.event("error", f"服务出错：{e}")

    def _seat_ready(self, worker, timeout=90):
        """等这个角色在会议中就座。会议优先于接单。"""
        t0 = time.time()
        while time.time() - t0 < timeout:
            if not worker.available:
                return False
            if worker.seated:
                return True
            if not self.meeting:
                return True          # 会议已散，直接去干活
            time.sleep(0.3)
        return False

    def _await_meeting_end(self, worker, client=None, timeout=120):
        """等这个角色从会议里出来。已经在外面就立刻返回。

        会议散了 / 客户跑了，任一条件满足就停，别白等。
        """
        t0 = time.time()
        while time.time() - t0 < timeout:
            if not worker.available:
                return False
            if not worker.seated and not worker.seat_cmd:
                return True
            if client is not None and client.status == "已流失":
                return False
            time.sleep(0.3)
        return False

    def _await_at(self, worker, loc, idx, timeout=90):
        """等到角色走到目标位置附近（或超时）。"""
        t0 = time.time()
        while time.time() - t0 < timeout:
            if not worker.available:
                return False
            tgt = self._loc_of(loc, idx)
            if math.dist(worker.pos, tgt) <= 0.12 and not worker.path:
                return True
            time.sleep(0.3)
        return False

    def _seat_of(self, who):
        return SEATS.get(who)

    def _loc_of(self, loc, idx):
        if loc == "seat":
            return self._seat_of(idx)
        if loc == "desk":
            return DESKS.get(idx, DESKS["m3"])
        if loc in REST_SPOTS and idx in REST_SPOTS[loc]:
            return REST_SPOTS[loc][idx]
        base = LOCATIONS[loc]
        if loc == "reception" and isinstance(idx, int):
            return (10, base[1] - 1 + idx * 2)  # 员工站在客户右侧交流
        return base

    # ── 玩家指令 ──
    def command(self, who, action, arg=None):
        w = self.workers.get(who)
        if not w:
            return {"ok": False, "msg": "没有这个角色"}
        if action == "reboot":
            if not w.brain_down or w.brain_checking:
                return {"ok": False, "msg": "脑袋正常，或正在检查恢复"}
            w.brain_checking = True
            threading.Thread(target=self._reboot_thread,
                             args=(who, self.gen, w.brain_epoch), daemon=True).start()
            return {"ok": True, "msg": "尝试重启脑袋，只检测一次"}
        if w.brain_down:
            return {"ok": False, "brain_down": True, "msg": "脑袋宕机了，额度恢复后再重启脑袋"}
        if action == "goto":
            if arg not in CAN_GO[who]:
                return {"ok": False, "msg": f"{w.meta['name']} 不去那儿"}
            w.order = ("goto", (arg, who))
            w.acting = f"前往{LOC_LABEL[arg]}"
            return {"ok": True, "msg": f"{w.meta['name']} 去{LOC_LABEL[arg]}"}
        if action == "meeting":
            return self.start_meeting(arg or "周会")
        if action == "dismiss":
            return self.dismiss_meeting()
        if action == "blame_talk":
            return self.blame_talk(arg)
        if action == "rest":
            w.order = ("goto", ("lounge", who))
            w.acting = "去休息"
            return {"ok": True, "msg": f"{w.meta['name']} 去茶水间休息"}
        # ★M4-4：轮休。DESIGN 6.5「主动安排轮休」的实现。
        #   off  = 今天不上工（不接单、疲劳归零、体力回满）
        #   back = 取消轮休，回到正常排班
        if action in ("off", "back"):
            w.off_today = (action == "off")
            if action == "off":
                w.order = ("goto", ("lounge", who))
                w.acting = "今天轮休"
            else:
                w.acting = "已恢复排班"
            return {"ok": True,
                    "msg": (f"{w.meta['name']} 今天轮休（不涨疲劳，体力回满）" if action == "off"
                            else f"{w.meta['name']} 恢复排班")}
        if action == "assign":
            if arg in self.conflicts:
                return {"ok": False, "msg": "这单正在被人抢，轮不到你派"}
            c = next((x for x in self.clients if x.id == arg and x.status == "等待"), None)
            if not c:
                return {"ok": False, "msg": "这个客户不在等待中"}
            if c.served_by:
                return {"ok": False, "msg": f"这个客户已经由 {self.workers[c.served_by].meta['name']} 接了"}
            if w.job:
                return {"ok": False, "msg": f"{w.meta['name']} 手上有活"}
            # M2-8 派单前置条件：不然后面所有数值规则都能被玩家一条指令绕过
            if not w.on_duty:
                return {"ok": False, "msg": f"{w.meta['name']} 已经离职了"}
            if w.strike:
                return {"ok": False, "msg": f"{w.meta['name']} 今天在罢工，说什么都不听"}
            if w.off_today:
                return {"ok": False, "msg": f"{w.meta['name']} 今天轮休，不接单"}
            if not ST.can_accept(w.stamina):
                return {"ok": False,
                        "msg": f"{w.meta['name']} 体力只剩 {int(w.stamina)}，接不动了（<{ST.REFUSE_STAMINA}）"}
            if not ST.accepts_complex(w.mood) and getattr(c, "difficulty", 1) >= 2:
                return {"ok": False,
                        "msg": f"{w.meta['name']} 心情太差（{int(w.mood)}），不肯接复杂单"}
            c.served_by = who
            w.job = c.id
            w.acting = "去接单"
            threading.Thread(target=self._serve_client_thread,
                             args=(c.id, self.gen), daemon=True).start()
            return {"ok": True, "msg": f"{w.meta['name']} 去接「{c.task}」"}
        return {"ok": False, "msg": "未知指令"}

    def accept(self, cid, approved):
        c = next((x for x in self.clients if x.id == cid), None)
        if not c or c.status != "待验收":
            return {"ok": False}
        w = self.workers.get(c.served_by)
        # M2-8：疲劳/累的时候干活，质量打折，收入自然也打折
        q = ATTR[c.served_by]["quality"] * (getattr(w, "eff", 1.0) if w else 1.0)
        if approved:
            gain = int(c.reward * (0.6 + q * 0.6))
            self.money += gain
            # ★M4-4：声誉涨幅走饱和曲线（stats.rep_gain），不是固定 +3
            rg = ST.rep_gain(self.rep)
            self.rep = min(100, self.rep + rg)
            c.status = "已完成"
            self.event("accept", f"验收通过：+{gain} 元，声誉 +{rg}", who=c.served_by)
            txt = f"通过！入账 {gain} 元"
        else:
            self.rep = max(0, self.rep - 5)
            self.money = max(0, self.money - int(c.reward * 0.3))
            c.status = "已完成"
            self.failures.append({"task": c.task, "why": "老板打回了",
                                  "who": c.served_by})
            self.event("reject", "你打回了这单，声誉 -5", who=c.served_by)
            txt = "已打回该单，声誉 -5"
        if w:
            w.job = None
            w.stamina = max(0, w.stamina - 22)
            w.mood = max(0, w.mood - 8)
        self.slots.pop(c.slot, None)
        self._retire_client(c)
        self.note(txt)
        return {"ok": True, "msg": txt}

    def _retire_client(self, c):
        """把走完流程的客户挪出活跃列表，只留最近 4 单做记录。

        ★M3-9 抓到：完成/流失的客户原来只 pop 了 slot，人还留在 self.clients 里。
          实测第 6 天就积到 24 条（20 条已是终态），而 snapshot() 每 0.4 秒
          把整个列表序列化一次 —— 30 天会涨到上百条，既拖慢又占内存。
        """
        self.finished.append(c)
        if len(self.finished) > 4:
            self.finished = self.finished[-4:]
        self.clients = [x for x in self.clients if x is not c]

    # ── 地图移动 ──
    def move(self):
        for w in self.workers.values():
            if w.brain_down:
                self._freeze_brain(w)
                continue
            if w.path:
                tgt = w.path[0]
                dx, dy = tgt[0] - w.pos[0], tgt[1] - w.pos[1]
                d = math.hypot(dx, dy)
                # ★M4-4：这里**不能**乘 K。
                #   速度是"每游戏秒多少格"，是设计常量（speed），不随倍速变。
                #   倍速只改墙上时钟：每真实秒跑 S× 个 tick，于是每真实秒走 S× 格，
                #   折回游戏秒正好还是 speed 格。所以每 tick 的距离 = speed × TICK_SEC，
                #   **和 TIME_SCALE 无关**。
                #   我一开始在这里乘了 K（=1/S），结果工人 30 倍慢：
                #   实测 211 游戏秒只走了 7.3 格（应 6.25 秒走完 10 格），
                #   于是永远走不到接待处，30 天 0 单交付。
                #   判据：**凡是"每游戏秒多少"的量，一律不乘 K；
                #   凡是"每 tick 多少"的量（体力/心情/耐心），才乘 K。**
                sp = ATTR[w.who]["speed"] * TICK_SEC
                if d <= sp:
                    w.pos = tgt
                    w.path.pop(0)
                else:
                    w.pos = (w.pos[0] + dx / d * sp, w.pos[1] + dy / d * sp)

    def refresh_paths(self):
        for w in self.workers.values():
            if w.brain_down:
                self._freeze_brain(w)
                continue
            goal = None
            # ★ 会议优先：seat_cmd 一旦为真，goto / 接单 / Jev 自主都让位
            if w.seat_cmd:
                goal = self._seat_of(w.who)
            elif w.order and w.order[0] == "seat":
                goal = self._seat_of(w.who)
            elif w.order and w.order[0] == "goto":
                goal = self._loc_of(w.order[1][0], w.order[1][1])
            if goal is None and w.job:
                c = next((x for x in self.clients if x.id == w.job), None)
                if c:
                    goal = self._loc_of("reception", c.slot)
            # ★ 目标变了就必须重算。原写法 `if goal and w.path: continue`
            #   只看"有没有路"，不看"这条路通不通往新目标"：
            #   工人正溜达去茶水间时被派单，order 改成去接待处，旧 path 却被一直复用，
            #   人就一直往茶水间走 —— 实测全场没一个人到得了工位，干活中 0 帧。
            key = tuple(goal) if goal else None
            if key is not None and getattr(w, "goal_key", None) == key:
                continue
            w.goal_key = key
            if goal:
                w.path = bfs_path((int(w.pos[0]), int(w.pos[1])), goal)
            else:
                # 没任务：Jev 决定去哪（已由 jev_tick 写入 order）
                w.path = []

    # ── Jev 决策 ──
    def jev_decide(self):
        if not os.environ.get("OPENROUTER_API_KEY", "").strip():
            return
        # ★M4-4：轮休的人不进调度池。`off_today` 已经挡住了 assign 和 _auto_grab，
        #   但 Jev 每 3 秒仍会把他从茶水间支去工位——玩家明明说了"今天轮休"，
        #   看着像指令失效。挡在**进池前**而不是事后忽略，还省一次 API 调用。
        pool = [w.who for w in self.workers.values()
                if w.available and not w.order and not w.seat_cmd and not w.off_today]
        if not pool:
            return
        # 这里的时钟和 snapshot() 是两套算法（都是老的 tick*5），
        #   M4-4 已经把游戏日定义成 720 tick / 2 分钟一 tick，一并对齐。
        _t = max(0, self.tick - self._day_start) * TICK_GAME_MIN
        lines = ["你是一个像素办公室里五个人格的调度器。现在时间 %02d:%02d，他们各自该去哪儿。" %
                 ((_t // 60) % 24, _t % 60)]
        waiting = len([c for c in self.clients if c.status == "等待"])
        lines.append(f"当前有 {waiting} 个客户在等。")
        for w in self.workers.values():
            allies = REL.allies_of(w.who)
            foes = REL.enemies_of(w.who)
            rel_txt = ""
            if allies:
                rel_txt += "，和 " + "、".join(w2 for w2 in allies) + " 处得好"
            if foes:
                rel_txt += "，和 " + "、".join(w2 for w2 in foes) + " 合不来"
            lines.append(f"- {w.meta['name']}：体力 {int(w.stamina)}/{ATTR[w.who]['stamina_max']}，心情 {int(w.mood)}，"
                         f"手上{'有活' if w.job else '没事干'}，当前状态：{w.acting}{rel_txt}")
        for name, d in LOC_LABEL.items():
            lines.append(f"{name} = {d}")
        state = "\n".join(lines)
        qs = {}
        for who in pool:
            foes = set(REL.enemies_of(who))
            allies = set(REL.allies_of(who))
            busy_loc = self._who_loc.get(who) if hasattr(self, "_who_loc") else None
            opts = {}
            for loc in CAN_GO[who]:
                tip = "常规位置"
                # 关系影响：优先和盟友待一起，避开仇人
                if loc == "lounge" and (allies or foes):
                    tip = "适合" + ("和盟友一起歇着" if allies else "躲清静")
                if loc == "slack" and foes:
                    tip = "自己摸鱼，谁也别理"
                if loc == "meeting" and waiting:
                    tip = "这里正有客户等着"
                if loc == "desk" and foes:
                    tip = "埋头干活，少看人脸色"
                opts[loc] = f"去{LOC_LABEL[loc]}（{tip}）"
            qs[who] = {
                "type": "choice",
                "instructions": f"Given stamina/mood/workload, where should {who.upper()} go now? Choose one.",
                "criteria": opts,
            }
        try:
            r = requests.post(S.JEV_URL, timeout=15, headers={
                "Authorization": f"Bearer {os.environ.get('OPENROUTER_API_KEY', '')}",
                "Content-Type": "application/json",
            }, json={"model": S.JEV_MODEL, "state": state, "questions": qs})
            if r.status_code != 200:
                return
            for who, ans in (r.json().get("answers") or {}).items():
                pick = ans.get("choice")
                if pick in CAN_GO.get(who, []):
                    w = self.workers[who]
                    if w.available and not w.order:
                        w.order = ("goto", (pick, who))
                        w.acting = f"去{LOC_LABEL[pick]}"
        except Exception:
            pass

    # ── 主循环 ──
    def _wander_idle(self):
        """M2-5：闲人走动，制造"路过"。

        为什么必须有：五个工人各有各的工位，不主动走动的话地图上根本不会擦肩，
        路过吐槽就成了永不触发的死代码（实测 60s 自然触发 0 次）。
        茶水间/摸鱼角都在工位区旁边，走过去必然横穿工位排 —— 这才是"路过"。
        刻意不交给 Jev 决定去哪儿：实测 60s 内 Jev 一次都没派去茶水间/摸鱼角。
        """
        for w in self.workers.values():
            if w.job or w.seated or w.seat_cmd or w.order:
                continue
            # M2-8：离职的和今天罢工的，不该还在办公室里晃
            if not w.available or w.strike:
                continue
            if w.acting not in ("在工位待命", "闲逛", "散会", "理论输了", "在茶水间休息", "在摸鱼"):
                continue
            w.wander_at = getattr(w, "wander_at", 0)
            if self.tick < w.wander_at:
                continue
            spots = [l for l in CAN_GO[w.who] if l in ("lounge", "slack")]
            if not spots:
                continue
            # 已经在茶水间/摸鱼角了就换个地方，别原地重复
            here = "lounge" if w.acting == "在茶水间休息" else (
                "slack" if w.acting == "在摸鱼" else None)
            dest = random.choice([s for s in spots if s != here] or spots)
            # M2-8：心情 < 20 → 摸鱼概率 +50%（用间隔除以倍率来表达）
            base = random.randint(45, 130)
            w.wander_at = self.tick + max(10, int(base / ST.slack_multiplier(w.mood)))
            w.order = ("goto", (dest, w.who))
            w.acting = f"溜达去{LOC_LABEL[dest]}"

    def _check_exhausted(self, w):
        """M2-8 体力见底 → 强制去休息，压过一切指令（连手上的活都扔下）。

        单独抽成方法是为了能直接测它：内联在主循环里就只能靠肉眼观察。
        """
        if w.brain_down or not ST.must_rest(w.stamina):
            return False
        if w.order and w.order[1][0] == "lounge":
            return False            # 已经在去休息的路上了
        w.order = ("goto", ("lounge", w.who))
        w.acting = "累趴了，去休息"
        if w.job:
            # 把单子放回队列：累趴一个人不该把客户也拖死，
            # 别人体力还够就能接。（不还回去的话这单会一直挂在"服务中"直到流失）
            cid = w.job
            c = next((x for x in self.clients if x.id == cid), None)
            if c is not None and c.status in ("服务中", "抢单中"):
                c.served_by = None
                c.status = "等待"
                c.grab_tick = self.tick + 30
            self.event("exhausted",
                       f"{w.meta['name']} 体力见底，扔下手上的活去休息", who=w.who)
            w.job = None
        return True

    def _maybe_banter(self):
        """M2-5：干活的人 + 附近闲人 → 可能触发吐槽。"""
        if self.banters and len(self.banters) > 6:
            self.banters = self.banters[-6:]
        pos_fn = lambda w: (w.pos[0], w.pos[1])
        workers = list(self.workers.values())
        for w in workers:
            # ★ 闸门只用 w.job（手上有活 = 正在干活，走去工位途中也算）。
            #   原来还要求 acting == "干活中"，但那是**显示用的标签**，
            #   会被抢单冲突覆盖成"去理论"（实测 295 个工人帧里只有 11 帧是干活中），
            #   等于把玩法闸门建在一个会被别人踩掉的字符串上。
            if not w.job or w.seated or not w.available or w.strike:
                continue
            c = next((x for x in self.clients if x.id == w.job), None)
            task = c.task if c else ""
            for o, dist in BT.nearby_idle(w, workers, pos_fn):
                rel = REL.get(o.who, w.who)
                if not BT.should_speak(w.who, o.who, w.mood, o.mood, rel, self._bt_store):
                    continue
                # 让 Jev 决定干活的人要不要反击 —— ★ 问法挪进 _banter_thread。
                #   原来在主循环里同步调，网络请求把整个 tick 堵住：
                #   实测主循环被拖到 3.40 tick/s，只有 sleep(0.12) 理论值的 41%，
                #   全场移动跟着慢 2.4 倍，于是没人走得到工位、干活中 0 帧。
                #   这一处是全场唯一没开线程的网络调用（serve/conflict/jev 都开了）。
                BT.mark(self._bt_store, w.who, o.who, w.who)   # 先占冷却，避免同 tick 重复排队
                threading.Thread(target=self._banter_thread,
                                 args=(w.who, o.who, task), daemon=True).start()
                return      # 一 tick 只触发一次，避免刷屏
            # ★ 循环体末尾不能有 return：否则只检查 workers 里的第一个人，
            #   第一个人没在干活 / 附近没人 / 冷却未到，整 tick 直接结束，
            #   另外四个人永远轮不到 —— 实测 70s 自然触发 0 次就是这么来的。

    def _banter_thread(self, worker_who, passer_who, task):
        # ★ 这个方法跑在 daemon 线程里，异常会被线程机制打印到 stderr 然后吃掉。
        #   本次就因为把 ["要反击","装没听见"] 传给了只认 worker id 的
        #   _ask_jev_auto（KeyError），吐槽**一次都没发生过**，而所有测试都显示通过
        #   —— 因为那两条用例是"可选项，本次未触发不判失败"。
        #   崩了就必须留下事件痕迹，不能悄无声息。
        try:
            gen = self.gen
            if not self.workers[worker_who].available or not self.workers[passer_who].available:
                return
            retal = S.ask_jev_choose(
                "同事 %s 刚被 %s 说了一句带刺的话：对方阴阳怪气地挑了他的刺。"
                "%s 手上有活正干着。%s 要不要当场反击？\n"
                "（不反击不会扣关系，只是咽下这口气；反击会把对方也得罪一下。）"
                % (self.workers[worker_who].meta["name"],
                   self.workers[passer_who].meta["name"],
                   self.workers[worker_who].meta["name"],
                   self.workers[worker_who].meta["name"]),
                {"反击": "当场怼回去，嘴上不能输",
                 "装没听见": "当作没听见，犯不着为这种小事吵架"},
                "A colleague was just mocked by a passing coworker while working. "
                "Should the worker snap back, or let it go?",
                qid="retaliate")
            retaliate = (retal == "反击")
            msgs = BT.build_dialog(worker_who, passer_who, task, retaliate,
                                   self._bt_store, self.tick, stream=self.model_stream)
            if not msgs:
                return
            if not self.gen_alive(gen) or not self.workers[worker_who].available or not self.workers[passer_who].available:
                return
            res = BT.settle(msgs, worker_who, passer_who, self.tick)
            with self._lock:
                for who, dm in res["mood"].items():
                    w = self.workers.get(who)
                    if w:
                        w.mood = max(0, min(100, w.mood + dm))
                self.banters.append({
                    "worker": worker_who, "passer": passer_who, "task": task,
                    "lines": msgs, "tick": self.tick})
                self.banters = self.banters[-6:]
            for m in msgs:
                self.event("banter",
                           f"{P.PROVIDERS[m['who']]['name']}：{m['text'][:34]}",
                           who=m["who"])
        except Exception as e:
            self.event("error", f"吐槽出错：{e}")

    def loop(self):
        self.running = True
        last_jev = 0
        last_spawn = 0
        # ★M4-4：固定步长用"累计截止时间"而不是"每次 sleep 一个定值"。
        #   实测 `time.sleep(0.006)` 在 macOS 上实际睡 ~19ms，空转 tick 只有
        #   理论 166/s 的 31%——**睡得越久偏得越多**，而且倍速越高偏得越狠。
        #   固定 sleep 的误差是累积的，deadline 是自校正的：落后就只补那一点。
        #   （落后太多时直接重置，不追赶，否则会变成零 sleep 的忙等。）
        next_tick = time.perf_counter()
        while self.running:
            with self._lock:
                self.tick += 1
                # 到达后清指令
                for w in self.workers.values():
                    if w.brain_down:
                        self._freeze_brain(w)
                        continue
                    # M2-8：离职的人不再接指令、不再走动
                    if not w.on_duty:
                        w.order = None
                        w.path = []
                        w.acting = "已离职"
                        continue
                    if w.seat_cmd or (w.order and w.order[0] == "seat"):
                        tgt = self._seat_of(w.who)
                        if tgt and math.dist(w.pos, tgt) <= 0.12 and not w.path:
                            w.order = None
                            w.seated = True
                            w.acting = MEETING_ACT
                        continue
                    if w.order:
                        loc, idx = w.order[1]
                        tgt = self._loc_of(loc, idx)
                        if math.dist(w.pos, tgt) <= 0.12 and not w.path:
                            if loc == "lounge":
                                w.order = None
                                w.acting = "在茶水间休息"
                            elif loc == "slack":
                                w.order = None
                                w.acting = "在摸鱼"
                            elif not w.job:
                                w.order = None
                                w.acting = f"在{LOC_LABEL[loc]}"
                    # 体力/心情恢复
                    if w.acting in ("在茶水间休息",):
                        w.stamina = min(ATTR[w.who]["stamina_max"],
                                        w.stamina + 0.9 * K)
                        w.mood = min(100, w.mood + 0.5 * K)
                    if w.acting in ("在摸鱼",):
                        w.mood = min(100, w.mood + 1.2 * K)
                        w.stamina = max(0, w.stamina - 0.15 * K)   # M4-4：-0.3 → -0.15
                    # M2-8：★这里**不能**按 tick 连续扣体力。
                    #   实测按 0.45/tick 扣（≈3.15 点/秒）→ 100 体力只撑 32 秒，
                    #   而一次真实交付要 40~60 秒，于是每个工人都在交付中途累趴、
                    #   扔下手上的活，60 秒内 0 单到达待验收、3 单流失。
                    #   体力的账记在交付完成时（accept 里每单扣 22），这里只保留微量的涣散。
                    if w.job:
                        w.stamina = max(0, w.stamina - 0.02 * K)
                    elif not w.seat_cmd and w.acting.startswith("在") \
                            and w.acting not in ("在茶水间休息", "在摸鱼"):
                        # ★M4-4：原来 -0.12/tick = -74/天，**站着不动比干活还掉得快 6 倍**。
                        #   而体力 <15 就接不了单 → 没活干 → 只能站着 → 越闲越累，死循环。
                        #   实测 23 天长局里体力均值在第 4~7 天塌到 4~19，就是这么来的。
                        #   现在站着只微耗（-0.03/tick × 900 tick/天 = -27/天，
                        #   比干一单还少，且被茶水间 +0.9/tick 一次就拉满盖过去），
                        #   真正的消耗是 accept 的 -22/单，
                        #   恢复仍然要去茶水间 —— 该休息还是得休息，只是不会自己饿死。
                        w.stamina = max(0, w.stamina - 0.03 * K)
                    # M2-8：体力见底 → 强制去休息，压过一切指令
                    self._check_exhausted(w)
                    # 客户耐心 + AI 自主抢单
                for c in self.clients:
                    if c.status == "等待":
                        if self.tick >= getattr(c, "grab_tick", 10**9):
                            self._auto_grab(c)
                    if c.status in ("等待", "服务中", "抢单中"):
                        c.patience -= K
                        if c.patience <= 0:
                            c.status = "已流失"
                            self.slots.pop(c.slot, None)
                            self.rep = max(0, self.rep - 3)
                            self.money = max(0, self.money - 15)
                            self.event("lost", f"客户等太久走了：{c.task}", extra={"client": c.id})
                            # M2-6：失败在发生的这一刻记下来。打回的那单在 clients 里
                            # status 是"已完成"，事后反推查不出来。
                            self.failures.append({"task": c.task,
                                                  "why": "客户等太久走了",
                                                  "who": c.served_by})
                            if c.served_by and self.workers.get(c.served_by):
                                self.workers[c.served_by].job = None
                            self._retire_client(c)     # M3-9：不 retire 的话会一直堆积
                            self.note("跑了一个客户，声誉-3")
                for w in self.workers.values():
                    w.tick_typing()      # M4-2：太久没吐字就当停了
                self._wander_idle()
                self._maybe_banter()
                self.maybe_start_blame()
                # 复盘会结算完不能一直开着：留着不走，五个人在会议室站到天亮。
                # 玩家想多看两眼可以先手动 dismiss；BLAME_HOLD 秒后自动散会放人。
                if (self.meeting and self.meeting.get("kind") == "blame"
                        and self.meeting.get("phase") == "settled"
                        and self.meeting.get("settled_at")
                        and time.time() - self.meeting["settled_at"] > BLAME_HOLD / TIME_SCALE):
                    self.meeting = None
                    for w in self.workers.values():
                        if w.brain_down:
                            continue
                        w.seat_cmd = False
                        w.seated = False
                        w.order = None
                        w.acting = "散会"
                    self.send_all_back()
                    self.event("meeting_end", "复盘会结束")
                self.refresh_paths()
                self.move()

            # Jev 决策：每 3 秒一次（真实时间 ÷ TIME_SCALE）
            if time.time() - last_jev > 3.0 / TIME_SCALE:
                last_jev = time.time()
                threading.Thread(target=self.jev_decide, daemon=True).start()
            # 客户刷新：每 SPAWN_SEC 秒来一个（测试可调快）
            if time.time() - last_spawn > SPAWN_SEC / TIME_SCALE:
                last_spawn = time.time()
                with self._lock:
                    self.spawn_client()
            # ★M4-4 自动跨天：DAY_TICKS 到了就结算。
            #   以前跨天只能靠外部打 /api/newday，而"30 天长局"那边一天只给
            #   1.2 秒，于是体力/工资这些**按天计**的量根本没有任何一天的分母。
            if AUTO_DAY and self.tick - self._day_start >= DAY_TICKS:
                self._advance_day()
            next_tick += TICK_SEC / TIME_SCALE
            now = time.perf_counter()
            # 允许**有界追赶**：落后几拍就在后面几拍补回来。
            # 直接 `next_tick = now` 会把每一次偶发卡顿（GC、线程抢 GIL）都变成
            # 永久丢时——实测 0.12s 步长能跑满，6ms 步长只有理论值的 65%，
            # 差的就是这部分被吞掉的补偿。落后超过 4 拍才认定是真卡死，重置。
            if next_tick < now - 4 * TICK_SEC / TIME_SCALE:
                next_tick = now
            else:
                time.sleep(max(0.0, next_tick - now))

    # ── 每日结算（M2-8）──
    def bump_gen(self) -> int:
        """换代。所有长线程每步都该拿它和自己的起点比。"""
        self.gen += 1
        return self.gen

    def gen_alive(self, g) -> bool:
        """线程还该不该继续。世代号变了 = 状态被重置/读档过了 = 该收工。"""
        return g == self.gen

    def _advance_day(self):
        """跨天。自动跨天（AUTO_DAY）和 /api/newday 共用这一个入口。

        ★M4-4：以前这两条路各写各的，`/api/newday` 只加 day 不重置计数，
        手动推日和自动推日混用时会把一天结算两次。统一到这里就没有第二条路了。
        """
        self.day += 1
        self._day_start = self.tick
        self.note("新的一天")
        self.event("newday", f"第 {self.day} 天开始")
        return self.daily_settle()

    def daily_settle(self):
        """跨天时跑一次：工资 → 疲劳/罢工/离职 → 自然衰减 → 失败检测。

        返回一份明细，直接透给客户端当日结算面板。
        """
        on_duty = [w for w in self.workers.values() if w.on_duty]
        # 1) 工资 + 加班补贴（疲劳高的是在加班）
        overtime = sum(1 for w in on_duty if w.fatigue >= 2)
        self.money, detail = ST.daily_settle(self.money, len(on_duty), overtime)
        self.event("wages", "发工资 -%d 元%s"
                   % (detail["wages"] + detail["overtime"],
                      ("（含加班补贴 %d）" % detail["overtime"]) if overtime else ""))
        if self.money < 0:
            self.neg_days += 1
        else:
            self.neg_days = 0

        # 2) 疲劳 → 罢工 → 离职
        quits, strikes = [], []
        for w in on_duty:
            if w.brain_down:
                w.worked_today = False
                continue
            if w.strike:
                w.fatigue = ST.FATIGUE_MAX          # 罢工中，疲劳维持
            elif w.off_today:
                # ★M4-4 轮休：疲劳清零。这是 DESIGN 6.5「主动安排轮休」的兑现，
                #   也是这套疲劳系统唯一能被玩家影响的入口（原来只涨不跌）。
                w.fatigue = 0
            elif w.worked_today:
                w.fatigue = ST.next_fatigue(w.fatigue, True)
            else:
                w.fatigue = max(0, w.fatigue - 1)   # 歇一天缓一点
            if ST.should_strike(w.fatigue):
                w.strike = True
                w.strike_days += 1
                strikes.append(w)
                if ST.should_quit(w.strike_days):
                    w.quit = True
                    w.strike = False
                    quits.append(w)
            else:
                w.strike_days = 0
            w.worked_today = False
            w.off_today = False        # 轮休只管当天，跨天自动恢复排班
        for w in strikes:
            self.event("strike", "%s 罢工了，今天什么都不干（连续第 %d 天）"
                       % (w.meta["name"], w.strike_days), who=w.who)
        for w in quits:
            self.event("quit", "%s 罢工满两天，递交辞呈，离职了" % w.meta["name"], who=w.who)
            # 关系差的人跟着走（M2-3）：判定方向是"还在的人对走掉的人"
            for other in REL.quit_followers(w.who):
                ow = self.workers.get(other)
                if ow and ow.on_duty and random.random() < 0.5:
                    ow.quit = True
                    ow.strike = False
                    self.event("quit", f"{ow.meta['name']} 和 {w.meta['name']} 处不来，"
                                       f"也跟着走了", who=other)

        # 3) 自然衰减
        # ★M4-4：轮休的人算"歇了"——体力回满，和在茶水间休息一个待遇。
        #   不这样的话轮休只清疲劳不回体力，轮休反而是亏的，玩家不会用。
        rested = [w.who for w in on_duty
                  if w.acting in ("在茶水间休息", "散会") or w.off_today]
        slackers = [w.who for w in on_duty if w.strike]
        st, md = ST.natural_decay(
            {w.who: w.stamina for w in self.workers.values()},
            {w.who: w.mood for w in self.workers.values()},
            rested=rested, slackers=slackers)
        for w in self.workers.values():
            if not w.brain_down:
                w.stamina, w.mood = st[w.who], md[w.who]

        # 4) 失败检测
        on_duty = [w for w in self.workers.values() if w.on_duty]
        reason = ST.game_over(self.money, self.rep, on_duty, self.neg_days)
        if reason:
            self.game_over_reason = reason
            self.event("game_over", "游戏结束：%s" % reason)
        out = {
            "wages": detail, "overtime_days": overtime,
            "quits": [w.who for w in quits],
            "strikes": [w.who for w in strikes],
            "on_duty": [w.who for w in on_duty],
            "game_over": reason,
        }
        self.last_settle = out
        return out

    def team_build(self):
        """团建：花钱给全员回心情。"""
        if self.money < ST.TEAM_BUILD:
            return {"ok": False, "msg": "钱不够团建（要 %d）" % ST.TEAM_BUILD}
        self.money -= ST.TEAM_BUILD
        for w in self.workers.values():
            if w.brain_down:
                continue
            w.mood = min(ST.MOOD_MAX, w.mood + ST.TEAM_BUILD_MOOD)
            w.fatigue = max(0, w.fatigue - 1)
        self.event("team_build", "团建，花了 %d 元，全员心情 +%d"
                   % (ST.TEAM_BUILD, ST.TEAM_BUILD_MOOD))
        return {"ok": True, "msg": "团建完成，全员心情 +%d" % ST.TEAM_BUILD_MOOD}

    # ── 老板聊天（M2-7）──
    CHAT_HISTORY = {}          # who -> [{"role","content"}]，跨请求保留

    # 老板聊天里的特殊指令。用**整句精确匹配**，不用 `kw in text`：
    # 子串匹配会把"今天天气不错啊"判成表扬（它确实含"不错"），这种假阳性很难查。
    CHAT_REST = {"休息", "去休息", "歇会", "去茶水间", "休息一下"}
    CHAT_PRAISE = {"干得不错", "干得好", "辛苦了", "厉害", "干得漂亮",
                   "做得好", "不错啊你", "牛", "好样的"}

    def chat_command(self, who, text):
        """聊天框里的特殊指令。识别到就**不调模型**，直接改状态。

        识别不到返回 None，走正常对话。识别到返回 dict，HTTP 层直接回结果。
        """
        w = self.workers.get(who)
        if not w:
            return None
        if w.brain_down:
            return {"kind": "brain_down", "msg": "脑袋宕机了，额度恢复后再重启脑袋"}
        t = (text or "").strip()
        norm = t.rstrip("！!。.，,、~～ ").strip()
        if norm in self.CHAT_REST:
            self.command(who, "rest")
            return {"kind": "rest", "msg": f"{w.meta['name']} 去茶水间休息了"}
        if norm in self.CHAT_PRAISE:
            w.mood = min(100, w.mood + 5)
            self.event("boss_praise", f"你夸了 {w.meta['name']} 一句，心情 +5", who=who)
            return {"kind": "praise", "msg": f"{w.meta['name']} 心情 +5（现在是 {w.mood}）"}
        return None

    def chat_brief(self, who):
        """给老板聊天用的开场状态。比普通状态全：带上这个角色自己的状态和关系。"""
        w = self.workers.get(who)
        parts = [f"第{self.day}天 · {self.money}元 · 声誉{self.rep}"]
        if w:
            job = ""
            if w.job:
                c = next((x for x in self.clients if x.id == w.job), None)
                job = c.task if c else "手上的活"
            parts.append(f"你自己：心情 {int(w.mood)}/100 体力 "
                         f"{int(w.stamina)}/{ATTR[who]['stamina_max']} "
                         f"{'手上有活「%s」' % job if job else '手上没活'}（{w.acting}）")
            others = [o for o in REL.ALL if o != who]
            best = max(others, key=lambda o: REL.get(who, o))
            worst = min(others, key=lambda o: REL.get(who, o))
            parts.append(f"和同事：跟 {P.PROVIDERS[best]['name']} "
                         f"{REL.describe_pair(who, best)}，"
                         f"和 {P.PROVIDERS[worst]['name']} {REL.describe_pair(who, worst)}")
        return "【事务所状态】" + "；".join(parts) + "。\n"

    def chat_push(self, who, user_text, reply_text):
        """把这一轮存进历史，下一轮老板接着聊时模型还记得。"""
        log = self.CHAT_HISTORY.setdefault(who, [])
        log.append({"role": "user", "content": user_text})
        if reply_text:
            log.append({"role": "assistant", "content": reply_text})
        # 只留最近 8 轮：再往前老板自己都忘了，留着纯烧 token
        if len(log) > 16:
            del log[:-16]

    def chat_history(self, who):
        return list(self.CHAT_HISTORY.get(who, []))

    # ── 会议室流程（M2-2 座位 / M2-6 复盘发言）──
    def start_meeting(self, topic: str = "周会", kind: str = "normal"):
        """召集全员到会议室坐下。kind="blame" 时走 M2-6 的逐个发言。"""
        with self._lock:
            if self.meeting:
                return {"ok": False, "msg": "已经在开会了"}
            who_list = [w.who for w in self.workers.values() if w.available]
            if not who_list:
                return {"ok": False, "msg": "大家的脑袋都宕机了，暂时开不了会"}
            self.meeting = {"topic": topic, "seated": [], "phase": "gathering",
                            "started": self.tick, "kind": kind,
                            "lines": [], "settled": None}
            self.event("meeting_start", f"开会：{topic}")
            for w in who_list:
                self.workers[w].order = ("seat", None)
                self.workers[w].seat_cmd = True
                self.workers[w].acting = "去开会"
        threading.Thread(target=self._meeting_thread, daemon=True).start()
        return {"ok": True, "msg": f"开会：{topic}"}

    def _meeting_thread(self):
        with self._lock:
            topic = self.meeting["topic"] if self.meeting else "周会"
            kind = (self.meeting.get("kind") or "normal") if self.meeting else "normal"
        # 等所有人走到座位（最多 60s）
        t0 = time.time()
        while time.time() - t0 < 60 / TIME_SCALE:
            with self._lock:
                if not self.meeting:
                    return
                seated = [w.who for w in self.workers.values()
                          if w.seated and w.available]
                self.meeting["seated"] = seated
            on_duty = [w for w in self.workers.values() if w.available]
            if not on_duty or len(seated) >= len(on_duty):
                break
            time.sleep(0.4 / TIME_SCALE)
        with self._lock:
            if not self.meeting:
                return
            self.meeting["phase"] = "seated"
            for w in self.workers.values():
                if w.available:
                    w.acting = MEETING_ACT
        if kind == "blame":
            try:
                self._blame_dialogue()
            except Exception as e:
                self.event("error", f"复盘会出错：{e}")
        else:
            time.sleep(1.0 / TIME_SCALE)

    # ── M2-6 甩锅复盘 ──
    def _blame_dialogue(self):
        """五人依次发言，带上前文；老板可随时插话。全部真实 LLM 调用。"""
        with self._lock:
            if not self.meeting:
                return
            failures = list(self.failures)
            day = self.day
            meeting, gen = self.meeting, self.gen
            pool = [who for who in S.ORDER if self.workers[who].available]
        # jev_order 返回完整顺序；网络等待期间不持有游戏状态锁。
        order = S.jev_order("复盘会：这一单砸了，谁先开口定性最合适", pool=pool) if pool else None
        with self._lock:
            if self.meeting is not meeting or not self.gen_alive(gen):
                return
            seq = order or pool
            self.meeting["phase"] = "talking"
        for idx, who in enumerate(seq):
            with self._lock:
                if not self.meeting:
                    return
                if not self.workers[who].available:
                    continue
                lines = list(self.meeting["lines"])
                workers = [w.who for w in self.workers.values() if w.available]
            out = BG.speak(who, failures, day, workers, lines, first=(idx == 0),
                           stream=self.model_stream)
            if not out:
                continue
            with self._lock:
                if not self.meeting:
                    return
                self.meeting["lines"].append(out)
            self.event("blame",
                       "%s：%s" % (P.PROVIDERS[who]["name"], out["text"]),
                       who=who)
        # 结算：被点名最多的那个背锅
        with self._lock:
            if not self.meeting:
                return
            lines = list(self.meeting["lines"])
        res = BG.settle(lines, self.tick)
        with self._lock:
            if not self.meeting:
                return
            for who, dm in res["mood"].items():
                w = self.workers.get(who)
                if w and not w.brain_down:
                    w.mood = max(0, min(100, w.mood + dm))
            self.meeting["settled"] = res
            self.meeting["phase"] = "settled"
            self.meeting["settled_at"] = time.time()
            self._blame_store["last_blame_day"] = self.day
            self.failures = []          # 这批已经复盘过
        if res["culprit"]:
            self.event("blame_result",
                       "%s 被推出来背锅，心情 -6"
                       % P.PROVIDERS[res["culprit"]]["name"],
                       who=res["culprit"])
        else:
            self.event("blame_result", "没人被点名，这锅没着落")

    def blame_talk(self, text: str):
        """老板插话。内容进 transcript，后面的发言会看到。"""
        text = P.truncate((text or "").strip(), 80)
        if not text:
            return {"ok": False, "msg": "说点什么"}
        with self._lock:
            if not self.meeting or self.meeting.get("kind") != "blame":
                return {"ok": False, "msg": "现在没有复盘会"}
            if self.meeting.get("phase") == "settled":
                return {"ok": False, "msg": "会已经开完了"}
            self.meeting["lines"].append({"who": "boss", "text": text,
                                          "blames": []})
        self.event("boss_say", f"老板插话：{text}")
        return {"ok": True, "msg": "插话成功，后面的人会听见"}

    def maybe_start_blame(self):
        """主循环里轮询：有失败单就开复盘会。冷却一天。

        ★不能在有活在跑的时候**立刻**开：会议 seat_cmd 优先级压过干活，
        正在交付的工人会被叫去开会、扔下手上的活，客户耐心耗尽就流失了，
          流失又产生新的失败单 → 又触发下一场复盘会（实测会把派单闭环卡死）。

        但也不能无限等：客户源源不断的时候几乎永远有人在干活，
        复盘会就成了永不触发的死代码（实测 90s 内 0 次触发）。
        所以是**有上限的等待**：先护一会儿，超时就插进去——
        交付线程里有 _await_meeting_end 兜底，散会后会继续干，不至于丢单。
        """
        with self._lock:
            if self.meeting or not BG.should_trigger(self.failures, self.day,
                                                    self._blame_store):
                return
            busy = [w for w in self.workers.values()
                    if w.job and w.on_duty and not w.strike]
            if busy:
                if not self._blame_want_at:
                    self._blame_want_at = time.time()
                if time.time() - self._blame_want_at < BLAME_MAX_WAIT / TIME_SCALE:
                    return          # 先护着手上的活
            else:
                self._blame_want_at = 0
            self._blame_want_at = 0
            topic = "复盘会：这一单砸了"
        r = self.start_meeting(topic, kind="blame")
        if r.get("ok"):
            self.event("blame_start", "出事了，全员开复盘会")

    def send_all_back(self):
        """会开完把人送回工位，否则散会后一群人站在会议室不走。"""
        with self._lock:
            for w in self.workers.values():
                if w.seated or not w.available:
                    continue
                w.order = ("goto", ("desk", w.who))
                w.acting = "回工位"

    def dismiss_meeting(self):
        with self._lock:
            if not self.meeting:
                return {"ok": False, "msg": "没在开会"}
            self.meeting = None
            for w in self.workers.values():
                if w.brain_down:
                    continue
                if w.order and w.order[0] == "seat":
                    w.order = None
                w.seat_cmd = False
                w.seated = False
                w.acting = "散会"
            self.send_all_back()
            self.event("meeting_end", "散会")
        return {"ok": True, "msg": "散会"}

    def snapshot(self):
        with self._lock:
            _rx, _ry = LOCATIONS["reception"]
            return {
                "version": 1,                 # 契约版本，客户端据此判断格式是否变更
                "art_layout_version": 3,
                "gameplay_version": 5,
                "scene": "office",
                "day": self.day, "money": self.money, "rep": self.rep,
                "tick": self.tick,
                "clock": "%02d:%02d" % (((self.tick - self._day_start) * TICK_GAME_MIN // 60) % 24,
                                         (self.tick - self._day_start) * TICK_GAME_MIN % 60),
                "grid": {"w": GW, "h": GH},
                "walls": [list(p) for p in WALLS],
                "locations": {k: list(v) for k, v in LOCATIONS.items()},
                "loc_label": LOC_LABEL,
                "workers": [{
                    "id": w.who, "name": w.meta["name"], "color": w.meta["color"],
                    "tag": w.meta["tag"], "blurb": w.meta["blurb"],
                    "x": round(w.pos[0], 2), "y": round(w.pos[1], 2),
                    "speed": ATTR[w.who]["speed"],
                    "path": [list(p) for p in w.path],
                    "stamina": round(w.stamina), "stamina_max": ATTR[w.who]["stamina_max"],
                    "mood": round(w.mood),
                    "acting": w.acting, "job": w.job, "seated": w.seated, "seat_cmd": w.seat_cmd,
                    "quality": ATTR[w.who]["quality"],
                    # M2-8 动态属性透出，客户端据此画状态条
                    "fatigue": w.fatigue, "strike": w.strike,
                    # M4-2：客户端据此让打字音跟模型输出同步
                    "typing": w.typing, "type_cps": round(w.type_cps, 1),
                    # ★M4-4 轮休状态。客户端要能显示"今天轮休"，
                    #   否则玩家看板上这个人和"罢工"长得一样，分不清是奖赏还是惩罚。
                    "off_today": w.off_today,
                    "brain_down": w.brain_down, "brain_reason": w.brain_reason,
                    "brain_checking": w.brain_checking,
                    "strike_days": w.strike_days, "quit": w.quit,
                    "eff": round(getattr(w, "eff", 1.0), 2),
                    "log": w.log,
                } for w in self.workers.values()],
                "clients": [{
                    "id": c.id, "task": c.task, "reward": c.reward,
                    "patience": c.patience, "patience_max": c.patience_max,
                    "status": c.status, "served_by": c.served_by,
                    "slot": c.slot, "result": c.result,
                    "grab_in": max(0, c.grab_tick - self.tick),
                    # M3-7：需求类型 + 人形，客户端据此挑 sprite
                    "kind": c.kind, "persona": c.persona,
                    "persona_name": c.persona_name,
                    # 客户端要画客户：入场动画中在 pos，完成后在队列位
                    "x": c.pos[0], "y": c.pos[1],
                    "queue_x": 8, "queue_y": round(_ry - 1 + (c.slot or 0) * 2, 2),
                } for c in self.clients],
                # ★M4-4：把滚动存档里的最近 4 单也透出去。
                #   M3-9 加 _retire_client() 之后，完成/流失的客户立刻从 clients 移走
                #   （那是对的：clients 原来会无界增长，30 天到上百条），
                #   但 finished 没进快照，于是**完成这一态在接口上彻底不可见**——
                #   e2e_m1 用例 8「客户状态变已完成」就是这么红的。
                #   补上这个字段，而不是把 _retire_client 撤回去：
                #   两个问题里只有"完成态看不见"需要修，"列表增长"是真 bug。
                "finished": [{
                    "id": c.id, "task": c.task, "reward": c.reward,
                    "status": c.status, "served_by": c.served_by,
                    "result": c.result,
                } for c in self.finished],
                "conflicts": self.conflicts_view(),
                # M2-8 经济与失败状态
                "neg_days": self.neg_days,
                "game_over": self.game_over_reason,
                "last_settle": self.last_settle,
                "on_duty": [w.who for w in self.workers.values() if w.on_duty],
                "banters": self.banters[-4:],
                "relations": REL.summary(),
                "relation_log": REL.LOG[-20:],
                "meeting": self.meeting,
                "seats": {w: list(p) for w, p in SEATS.items()},
                "table": list(MEETING_TABLE),
                "slots": sorted(self.slots.keys()),
                "events": self.events[-40:],
                "log": self.log[-20:],
            }


GAME = Game()
