"""数值与经济系统（M2-8）

四条动态属性（体力/心情/声望/疲劳）+ 玩家经济（资金/声誉）。
本模块**只做计算与判定，不碰游戏状态**——所有函数都是纯函数，
这样边界规则能被逐条测掉，不用起游戏。

DESIGN 4.2 与 DEV_PLAN M2-8 步骤 2 在"体力 < 15"这条上不一致：
  DESIGN 4.2 写的是「< 15 罢工」
  DEV_PLAN 写的是「< 15 拒绝接单 / = 0 强制去休息」
两者不冲突（罢工是疲劳系统的，体力线是接单系统的），这里按 DEV_PLAN 分开实现：
  体力 < 15   → 拒绝接单（不是罢工，罢工归疲劳）
  体力 = 0    → 强制去休息
"""

# ── 范围 ────────────────────────────────────────────────────────────────────
STAMINA_MAX = 100
MOOD_MIN, MOOD_MAX = 0, 100
REP_MIN, REP_MAX = 0, 100
FATIGUE_MAX = 3

# ── 阈值（DEV_PLAN M2-8 步骤 2）─────────────────────────────────────────────
LOW_STAMINA = 30        # < 30 效率 -30%
REFUSE_STAMINA = 15     # < 15 拒绝接单
LOW_MOOD = 40           # < 40 只接简单单
SLACK_MOOD = 20         # < 20 摸鱼概率 +50%
STRIKE_FATIGUE = 3      # 疲劳满 → 罢工
QUIT_STRIKE_DAYS = 2    # 罢工连续 2 天 → 离职

# ── 经济（DESIGN 7.2）───────────────────────────────────────────────────────
# ★M4-4 全部重标定，理由是模拟器给出了实测证据（data/balance_report.json）：
#   旧版 30 天把 500 块做成了 21921 块（44 倍），声誉第 7 天顶到 100 再也不动，
#   "资金 < 0 持续 3 天破产"这个失败条件**在设计上不可能触发**——
#   也就是说 M3-9 判的"体力经济崩了"和真正的问题都不是体力，是收入没有上限。
#   现在四条一起收：
#     ① 报酬基数 60~110 → 35~90（实测 3.2 单/天，30 天 96 单）
#     ② 报酬倍率挂声誉（0.55~1.05）而不是挂天数（原来 1.0~4.5 复利）
#     ③ 声誉涨幅带饱和曲线，不会第 7 天就顶格
#     ④ 日薪恢复 DESIGN 7.2 的 20/人（M3-9 降到 12 是为了救一个"收入过高"的局，
#        收入降下来之后这个降薪就多余了，留着只会让钱更没用）
SALARY_PER_DAY = 20
# 兜底的扁平区间。生产路径优先用下面的 DESIGN_REWARD（分类型）。
REWARD_RANGE = (35, 90)
# ★DESIGN 5.1 原表，代码 kind → 设计稿类型。
#   跨度 40~300（7.5 倍）是路由驱动力：长文/急单只值得派 Kimi 和 Flash，
#   跑腿给谁都能干但显掉价。压平成一个区间就把这个决策拿掉了。
DESIGN_REWARD = {
    "document": (80, 120),    # 文档 ★★
    "review": (100, 160),     # 分析 ★★★
    "ideate": (70, 110),      # 创意 ★★
    "execute": (120, 180),    # 执行 ★★★
    "summarize": (160, 240),  # 长文 ★★★★
    "estimate": (40, 60),     # 跑腿 ★
    "_default": (120, 180),
}
MAX_STAFF = 5
BASE_WAGES = SALARY_PER_DAY * MAX_STAFF      # 100
OVERTIME = 30                                # 每个加班日
TEAM_BUILD = 80                              # 团建
TEAM_BUILD_MOOD = 25                         # 团建全员心情加成

# 初始（DESIGN 7.1）
INIT_MONEY = 500
INIT_REP = 50

# 破产
BANKRUPT_DAYS = 3


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


# ── 体力边界 ────────────────────────────────────────────────────────────────
def efficiency(stamina):
    """体力 < 30 → 效率打七折。返回 1.0 或 0.7。"""
    return 0.7 if stamina < LOW_STAMINA else 1.0


def can_accept(stamina):
    """体力 < 15 → 拒绝接单。"""
    return stamina >= REFUSE_STAMINA


def must_rest(stamina):
    """体力见底 → 强制去休息，不接受任何指令。"""
    return stamina <= 0


def work_need(base_need, stamina):
    """实际需要的"有效工作秒"。效率低 → 需要更多时间。"""
    e = efficiency(stamina)
    return base_need / e if e else base_need


# ── 心情边界 ────────────────────────────────────────────────────────────────
def accepts_complex(mood):
    """心情 < 40 → 只接简单单，不碰复杂活。"""
    return mood >= LOW_MOOD


def slack_multiplier(mood):
    """心情 < 20 → 摸鱼概率 ×1.5。"""
    return 1.5 if mood < SLACK_MOOD else 1.0


# ── 疲劳与罢工 ──────────────────────────────────────────────────────────────
def next_fatigue(fatigue, worked):
    """工作一天疲劳 +1，休息一天归零。封顶 FATIGUE_MAX。"""
    if not worked:
        return 0
    return clamp(fatigue + 1, 0, FATIGUE_MAX)


def should_strike(fatigue):
    return fatigue >= STRIKE_FATIGUE


def should_quit(strike_days):
    """连续罢工几天了。今天罢工后到 2 → 离职。"""
    return strike_days >= QUIT_STRIKE_DAYS


# ── 声望影响 ────────────────────────────────────────────────────────────────
def rep_grab_bonus(rep):
    """声望 0~100 → 抢单权重 1.0~1.2（DESIGN 4.2：声望高的抢好单）。"""
    return 1.0 + (clamp(rep, REP_MIN, REP_MAX) / 100.0) * 0.2


def reward_scale(rep):
    """声誉 0~100 → 客户报酬倍率 0.55~1.05（DESIGN 7.1「声誉影响报酬」）。

    ★M4-4：报酬倍率必须**有上限**。原来按天复利（每天 +12%，30 天 4.5 倍），
    模拟器实测 30 天把 500 块滚到 21921 块，破产条件形同虚设。
    挂在声誉上就两头都稳：声誉封顶 100 → 倍率封顶 1.05；
    而且这份钱是玩家一单一单挣的，不是日历送的。
    """
    r = clamp(rep, REP_MIN, REP_MAX)
    return 0.55 + (r / 100.0) * 0.5


def rep_gain(rep):
    """完成一单声誉涨多少：越接近 100 涨得越少，50→100 不会 7 天就顶格。

    ★M4-4 实测：原来固定 +3，3.2 单/天 → 第 7 天顶到 100，
    此后声誉这条线就完全没有变量了（后面 23 天全在 100）。
    现在按 3×(100-rep)/50 衰减并四舍五入，90 以上基本不再涨——
    声誉要靠打回少、交付多慢慢磨，而不是几天就封顶。
    """
    r = clamp(rep, REP_MIN, REP_MAX)
    return max(0, int(round(3 * (100.0 - r) / 50.0)))


# ── 经济 ────────────────────────────────────────────────────────────────────
def daily_wages(staff_count):
    """在职人数 × 日薪。人走了工资当然不用发。"""
    return max(0, staff_count) * SALARY_PER_DAY


def daily_settle(money, staff_count, overtime_days=0, team_built=False):
    """一天的开销结算。返回 (新资金, 明细)。"""
    wages = daily_wages(staff_count)
    over = OVERTIME * max(0, overtime_days)
    build = TEAM_BUILD if team_built else 0
    spent = wages + over + build
    return money - spent, {
        "wages": wages, "overtime": over, "team_build": build, "total": spent}


def apply_team_build(mood_dict, delta=TEAM_BUILD_MOOD):
    """团建：全员回血。返回新心情字典。"""
    return {k: clamp(v + delta, MOOD_MIN, MOOD_MAX) for k, v in mood_dict.items()}


def natural_decay(stamina_dict, mood_dict, rested=(), slackers=()):
    """每日自然衰减：不休息掉体力，心情轻微下滑（不上班心情也不会自己变好）。

    rested 里的人体力回满；slackers 里的是罢工的，体力也回。
    """
    out_s, out_m = {}, {}
    for who, st in stamina_dict.items():
        if who in rested:
            out_s[who] = STAMINA_MAX
        elif who in slackers:
            out_s[who] = clamp(st + 40, 0, STAMINA_MAX)
        else:
            out_s[who] = clamp(st - 6, 0, STAMINA_MAX)
    for who, md in mood_dict.items():
        out_m[who] = clamp(md - 3, MOOD_MIN, MOOD_MAX)
    return out_s, out_m


# ── 失败条件（DESIGN 7.3）───────────────────────────────────────────────────
def bankrupt(money, neg_days):
    """资金 < 0 且持续 3 天。"""
    return money < 0 and neg_days >= BANKRUPT_DAYS


def game_over(money, rep, on_duty, neg_days=0):
    """返回失败原因字符串，没失败返回 None。"""
    if len(on_duty) == 0:
        return "全员离职，事务所关门"
    if rep <= REP_MIN:
        return "声誉归零，被行业除名"
    if bankrupt(money, neg_days):
        return "资金为负已经 %d 天，破产了" % neg_days
    return None
