#!/usr/bin/env python3
"""决策基准（纯函数，无网络、无凭据、无状态）。

社区插件不能读取 MiniMax Code 的登录凭据、不能读写宿主内部数据库
（2026-10-20 管理员 review），所以这个文件**不再**是「后台守护进程」，
而只保留**决策逻辑本身** —— 作为三方一致性校验的第三个比对基准：

    Rust 守护进程  ·  Mini App「蹬王之王」  ·  本文件（Python）
                  ↘ 动作 + 理由文本逐字比对 ↙

⚠️ 理由文本必须**逐字一致**（`verify-parity.mjs` 会逐字比对），
所以本文件里的 `decide_background()` 与 Rust 的 `decision::decide()`、
Mini App 的 `decide()` 是**同构实现**，改一处就要同步三处。
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any

# ── 常量：与桌面端保持一致 ────────────────────────────────────────────────────
# 账号/计费接口的真实根地址（取自桌面端 d5 的生产分支）。
# 注意：不是 agent.minimax.cn —— 那是网页域，对 /backend/account/* 一律 404。
# Code 积分走另一个域名（platform 域对这些路径返回非 JSON）

QUOTA_FIVE_HOUR = 1
QUOTA_WEEKLY = 2
QUOTA_VIDEO = 3

# 判定阈值的**默认值**，仅在 config.json 缺失/非法时兜底。
# 实际生效值一律来自 load_config() —— 与 Node / Rust 读同一个文件。
QUOTA_TRIGGER_PERCENT = 99.0
# 四档红绿灯的两个分界点（功能3）。燃尽档由 used >= total 判定，不可配。
QUOTA_TIGHT_PERCENT = 80.0
QUOTA_LOW_PERCENT = 95.0
# 距 5 小时额度刷新不足这么多分钟时，不消耗重置卡（额度马上就自己回来了）。
# 实际生效值来自 config.json 的 cardSkipBeforeResetMinutes。
QUOTA_CARD_SKIP_BEFORE_RESET_MINUTES = 60.0

# 等级 → 中文。**属于 parity 契约的一部分**，改一个字三方都要改。
LEVEL_LABEL = {
    "comfortable": "额度充足",
    "tight": "额度紧张",
    "low": "额度不足",
    "burned": "额度燃尽",
}

QUOTA_LABEL = {
    QUOTA_FIVE_HOUR: "5小时限额",
    QUOTA_WEEKLY: "周限额",
    QUOTA_VIDEO: "视频限额",
}

# ── 共享配置（功能1/2/3）────────────────────────────────────────────────────
# 与 Mini App 侧、Rust 侧读同一个文件：
#   ~/.config/mcode-reset-card/config.json
CONFIG_PATH = os.path.expanduser("~/.config/mcode-reset-card/config.json")

CONFIG_DIR = os.path.dirname(CONFIG_PATH)


def default_config() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "cardTriggerPercent": QUOTA_TRIGGER_PERCENT,
        "cardSkipBeforeResetMinutes": QUOTA_CARD_SKIP_BEFORE_RESET_MINUTES,
        "quotaLevels": {"tight": QUOTA_TIGHT_PERCENT, "low": QUOTA_LOW_PERCENT},
    }


def _clamp(v: Any, lo: float, hi: float, fallback: float) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return fallback
    if f != f:  # NaN
        return fallback
    return min(hi, max(lo, f))


def normalize_config(raw: Any) -> tuple[dict[str, Any], list[str]]:
    """逐字段校验并夹紧，返回 (配置, 问题列表)。

    非法组合**整体回退默认并报出来**，绝不静默纠正 ——
    静默纠正会让人以为自己设的生效了。
    """
    d = default_config()
    issues: list[str] = []
    src = raw if isinstance(raw, dict) else {}
    if raw is not None and not isinstance(raw, dict):
        issues.append("配置根节点不是对象")

    raw_card = src.get("cardTriggerPercent")
    card = _clamp(raw_card, 1.0, 100.0, d["cardTriggerPercent"])
    if raw_card is not None:
        try:
            if float(raw_card) != card:
                issues.append(f"cardTriggerPercent={raw_card} 超出 1..100，已夹到 {card}")
        except (TypeError, ValueError):
            issues.append(f"cardTriggerPercent={raw_card} 不是数字，已用默认值 {card}")

    lv = src.get("quotaLevels") if isinstance(src.get("quotaLevels"), dict) else {}
    tight = _clamp(lv.get("tight"), 1.0, 100.0, d["quotaLevels"]["tight"])
    low = _clamp(lv.get("low"), 1.0, 100.0, d["quotaLevels"]["low"])
    if not tight < low:
        if lv:
            issues.append(
                f"quotaLevels 需满足 tight < low（收到 tight={tight} low={low}），已整体回退默认")
        tight = d["quotaLevels"]["tight"]
        low = d["quotaLevels"]["low"]

    raw_skip = src.get("cardSkipBeforeResetMinutes")
    skip = _clamp(raw_skip, 0.0, 1440.0, d["cardSkipBeforeResetMinutes"])
    if raw_skip is not None and skip != _clamp(raw_skip, 0.0, 1440.0, d["cardSkipBeforeResetMinutes"]):
        issues.append(f"cardSkipBeforeResetMinutes={raw_skip} 超出 0..1440，已夹到 {skip}")
    return {
        "schemaVersion": 1,
        "cardTriggerPercent": card,
        "cardSkipBeforeResetMinutes": skip,
        "quotaLevels": {"tight": tight, "low": low},
    }, issues


def load_config() -> tuple[dict[str, Any], list[str]]:
    """读配置。文件不存在是正常情况（首次运行），返回默认值且不报 issue。"""
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            raw = json.load(f)
    except FileNotFoundError:
        return default_config(), []
    except (OSError, ValueError) as e:
        return default_config(), [f"配置读取失败（{e}），正在用默认值"]
    return normalize_config(raw)

# 桌面端 base_resp 业务错误码 → 语义
ERR_UNAUTHORIZED = 1004
ERR_GROUP_NOT_MEMBER = 1003
ERR_PERMISSION_DENIED = 2029
ERR_INVALID_PARAMS = 2013


@dataclass
class QuotaState:
    """一个限额维度的用量状态。"""

    quota_type: int
    total: float = 0.0
    used: float = 0.0
    is_unlimited: bool = False
    reset_time: int | None = None

    def is_triggered(self, trigger_percent: float) -> bool:
        """是否达到扣卡触发线。

        阈值必须**显式传入** —— 写死在本类里正是当初三方漂移的根源：
        配置改了，这里还按 99 算，而且不报错。
        """
        if self.is_unlimited or self.total <= 0.0:
            return False
        return self.used >= self.total * trigger_percent / 100.0

    def level(self, tight: float = QUOTA_TIGHT_PERCENT,
              low: float = QUOTA_LOW_PERCENT) -> str:
        """四档红绿灯分档。与 Rust ``quota_level()`` 逐行对应。

        燃尽档由 used >= total 判定，**不可配** —— 它是事实，不是阈值。
        """
        if self.is_unlimited or self.total <= 0.0:
            return "comfortable"
        if self.used >= self.total:
            return "burned"
        ratio = self.used / self.total * 100.0
        if ratio >= low:
            return "low"
        if ratio >= tight:
            return "tight"
        return "comfortable"

    @property
    def exhausted(self) -> bool:
        """是否已耗尽。

        接口语义（对齐桌面端 V/q 两个转换函数）：
          used  = *_used_percent   → **已用百分比**，如 "71%" → 71
          total = *_total_percent  → 总额度百分比，缺省按 100 计

        所以耗尽就是「已用百分比 ≥ 总额度百分比」。不限量（status===3）不算耗尽。
        """
        if self.is_unlimited or self.total <= 0:
            return False
        return self.used >= self.total - 1e-9

    @property
    def remaining_percent(self) -> float:
        if self.is_unlimited or self.total <= 0:
            return 100.0
        return max(0.0, (self.total - self.used) / self.total * 100.0)

    def describe(self) -> str:
        if self.is_unlimited:
            return f"{QUOTA_LABEL.get(self.quota_type, self.quota_type)}=不限量"
        return (f"{QUOTA_LABEL.get(self.quota_type, self.quota_type)}="
                f"已用{self.used:.0f}% / 剩余{self.remaining_percent:.0f}%")


def _amount(value: Any, default: float = 0.0) -> float:
    if isinstance(value, str):
        value = value.replace(",", "").strip()
    try:
        n = float(value)
        return n if n == n else default
    except (TypeError, ValueError):
        return default


def _fmt_day(ms: int | None) -> str:
    if not ms:
        return "未知"
    d = datetime.fromtimestamp(ms / 1000)
    return f"{d.month}月{d.day}日"


def _minutes_to_reset(q: "QuotaState | None", now_ms: int) -> float | None:
    """某个额度维度距离刷新还有多少分钟。取不到刷新时间时返回 None。

    与 Rust 的 `minutes_to_reset()` 同一口径：已过去的时间按 0 算。
    """
    if q is None or q.reset_time is None:
        return None
    return max(0.0, (q.reset_time - now_ms) / 60_000.0)


def decide_background(
    quotas: list[QuotaState],
    usable_cards: list[dict[str, Any]],
    credit_expiry_ms: int | None,
    credit_desc: str,
    cfg: dict[str, Any] | None = None,
    now_ms: int | None = None,
    credit_data_complete: bool = True,
) -> tuple[str, str]:
    """后台扣卡决策，返回 (动作, 理由)。

    `credit_data_complete` 表示「积分数据是否**完整读到**」。

    ⚠️ 2026-10-19 PR #28 review 修：读不到 ≠ 没有。
    `credit_expiry_ms = None` 同时可能表示「确实没有积分」与「接口读失败」，
    以前两者都落到 use-card —— 而扣卡是真实写操作，
    网络故障会被当成业务状态，可能误扣真卡。
    ⇒ 数据不完整时一律**不做写操作**（wait），只如实报出来。

    动作 ∈ {"use-card", "keep-credit", "idle", "wait"}。纯函数，不触碰网络，可直接单测。

    **分支与 Mini App「蹬王之王」的 decide() 一一对应**，刻意保持同构：

      未耗尽                     → idle        （额度等级 + 已用量 + 未到触发线）
      耗尽 + 无积分 + 有卡        → use-card    （没有可用积分，用卡重置额度）
      耗尽 + 无积分 + 无卡        → wait
      耗尽 + 有积分 + 无卡        → keep-credit （没卡可用，让积分先消耗）
      耗尽 + 都有，卡先过期        → use-card    （先用卡保住积分）
      耗尽 + 都有，积分先过期      → keep-credit （让积分先消耗，留住更耐放的卡）

    `cfg` 省略时从共享配置文件读取（与 Node / Rust 读同一个文件）。
    `now_ms` 用于判断「额度是不是马上就要刷新了」。
    """
    if cfg is None:
        cfg, _issues = load_config()
    if now_ms is None:
        now_ms = int(time.time() * 1000)

    trigger = float(cfg["cardTriggerPercent"])
    tight = float(cfg["quotaLevels"]["tight"])
    low = float(cfg["quotaLevels"]["low"])
    skip_minutes = float(cfg.get("cardSkipBeforeResetMinutes", QUOTA_CARD_SKIP_BEFORE_RESET_MINUTES))

    by_type = {q.quota_type: q for q in quotas}
    five = by_type.get(QUOTA_FIVE_HOUR)
    weekly = by_type.get(QUOTA_WEEKLY)

    five_exhausted = bool(five and five.is_triggered(trigger))
    weekly_exhausted = bool(weekly and weekly.is_triggered(trigger))

    # ── 5 小时额度即将自己刷新 → 不烧重置卡（纯浪费）──
    reset_in_min = _minutes_to_reset(five, now_ms)
    skip_card_reason = None
    if skip_minutes > 0 and reset_in_min is not None and reset_in_min <= skip_minutes:
        skip_card_reason = f"5 小时额度 {reset_in_min:.0f} 分钟后刷新，暂不消耗重置卡"

    # ── 未到触发线：与 Mini App 一致，不做任何事 ──
    if not five_exhausted and not weekly_exhausted:
        used5 = five.used if five is not None else 0.0
        # 等级词随分档走，而不是永远写「额度充足」——
        # 否则用量 92% 时页面上仍显示「额度充足」，是误导。
        # 把触发线也说进来：否则「额度不足但暂不需要处理」看起来自相矛盾。
        # burned 永远不会出现在这里：它必然已 triggered，走的是下面用卡/留卡分支。
        level = five.level(tight, low) if five is not None else "comfortable"
        return "idle", (
            f"{LEVEL_LABEL[level]}（5 小时已用 {used5:.0f}%），"
            f"未到 {trigger:.0f}% 触发线，暂不动用重置卡"
        )

    # ── 积分数据没读全 ⇒ 无法判断「卡先过期还是积分先过期」──
    # ⇒ 绝不做写操作（扣卡是真实消耗，宁可等下一轮）。
    if not credit_data_complete:
        return "wait", "积分数据读取不完整，本轮不执行写操作（等下一轮重新判定）"

    # ── 无可用积分：只能靠卡把额度重置回来 ──
    if credit_expiry_ms is None:
        if usable_cards:
            if skip_card_reason:
                return "wait", skip_card_reason
            return "use-card", "没有可用积分，使用重置卡重置额度"
        return "wait", "额度已耗尽，既没有积分也没有可用的重置卡"

    # ── 有积分但没有可用卡：让积分先消耗 ──
    if not usable_cards:
        return "keep-credit", (
            f"没有可用的重置卡，让{credit_desc}（{_fmt_day(credit_expiry_ms)}到期）先消耗"
        )

    card_expiry = usable_cards[0].get("expire_time")
    if card_expiry is None:
        return "keep-credit", "没有可用重置卡，让积分先消耗"

    # ── 两者都有：比「先过期先用」 ──
    if card_expiry < credit_expiry_ms:
        if skip_card_reason:
            return "wait", skip_card_reason
        return "use-card", (
            f"重置卡（{_fmt_day(card_expiry)}）比{credit_desc}（{_fmt_day(credit_expiry_ms)}）先过期，"
            f"先用卡保住积分"
        )
    return "keep-credit", (
        f"{credit_desc}（{_fmt_day(credit_expiry_ms)}）比重置卡（{_fmt_day(card_expiry)}）先过期，"
        f"不用卡，让积分先消耗"
    )


def decide_background(
    quotas: list[QuotaState],
    usable_cards: list[dict[str, Any]],
    credit_expiry_ms: int | None,
    credit_desc: str,
    cfg: dict[str, Any] | None = None,
    now_ms: int | None = None,
    credit_data_complete: bool = True,
) -> tuple[str, str]:
    """后台扣卡决策，返回 (动作, 理由)。

    `credit_data_complete` 表示「积分数据是否**完整读到**」。

    ⚠️ 2026-10-19 PR #28 review 修：读不到 ≠ 没有。
    `credit_expiry_ms = None` 同时可能表示「确实没有积分」与「接口读失败」，
    以前两者都落到 use-card —— 而扣卡是真实写操作，
    网络故障会被当成业务状态，可能误扣真卡。
    ⇒ 数据不完整时一律**不做写操作**（wait），只如实报出来。

    动作 ∈ {"use-card", "keep-credit", "idle", "wait"}。纯函数，不触碰网络，可直接单测。

    **分支与 Mini App「蹬王之王」的 decide() 一一对应**，刻意保持同构：

      未耗尽                     → idle        （额度等级 + 已用量 + 未到触发线）
      耗尽 + 无积分 + 有卡        → use-card    （没有可用积分，用卡重置额度）
      耗尽 + 无积分 + 无卡        → wait
      耗尽 + 有积分 + 无卡        → keep-credit （没卡可用，让积分先消耗）
      耗尽 + 都有，卡先过期        → use-card    （先用卡保住积分）
      耗尽 + 都有，积分先过期      → keep-credit （让积分先消耗，留住更耐放的卡）

    `cfg` 省略时从共享配置文件读取（与 Node / Rust 读同一个文件）。
    `now_ms` 用于判断「额度是不是马上就要刷新了」。
    """
    if cfg is None:
        cfg, _issues = load_config()
    if now_ms is None:
        now_ms = int(time.time() * 1000)

    trigger = float(cfg["cardTriggerPercent"])
    tight = float(cfg["quotaLevels"]["tight"])
    low = float(cfg["quotaLevels"]["low"])
    skip_minutes = float(cfg.get("cardSkipBeforeResetMinutes", QUOTA_CARD_SKIP_BEFORE_RESET_MINUTES))

    by_type = {q.quota_type: q for q in quotas}
    five = by_type.get(QUOTA_FIVE_HOUR)
    weekly = by_type.get(QUOTA_WEEKLY)

    five_exhausted = bool(five and five.is_triggered(trigger))
    weekly_exhausted = bool(weekly and weekly.is_triggered(trigger))

    # ── 5 小时额度即将自己刷新 → 不烧重置卡（纯浪费）──
    reset_in_min = _minutes_to_reset(five, now_ms)
    skip_card_reason = None
    if skip_minutes > 0 and reset_in_min is not None and reset_in_min <= skip_minutes:
        skip_card_reason = f"5 小时额度 {reset_in_min:.0f} 分钟后刷新，暂不消耗重置卡"

    # ── 未到触发线：与 Mini App 一致，不做任何事 ──
    if not five_exhausted and not weekly_exhausted:
        used5 = five.used if five is not None else 0.0
        # 等级词随分档走，而不是永远写「额度充足」——
        # 否则用量 92% 时页面上仍显示「额度充足」，是误导。
        # 把触发线也说进来：否则「额度不足但暂不需要处理」看起来自相矛盾。
        # burned 永远不会出现在这里：它必然已 triggered，走的是下面用卡/留卡分支。
        level = five.level(tight, low) if five is not None else "comfortable"
        return "idle", (
            f"{LEVEL_LABEL[level]}（5 小时已用 {used5:.0f}%），"
            f"未到 {trigger:.0f}% 触发线，暂不动用重置卡"
        )

    # ── 积分数据没读全 ⇒ 无法判断「卡先过期还是积分先过期」──
    # ⇒ 绝不做写操作（扣卡是真实消耗，宁可等下一轮）。
    if not credit_data_complete:
        return "wait", "积分数据读取不完整，本轮不执行写操作（等下一轮重新判定）"

    # ── 无可用积分：只能靠卡把额度重置回来 ──
    if credit_expiry_ms is None:
        if usable_cards:
            if skip_card_reason:
                return "wait", skip_card_reason
            return "use-card", "没有可用积分，使用重置卡重置额度"
        return "wait", "额度已耗尽，既没有积分也没有可用的重置卡"

    # ── 有积分但没有可用卡：让积分先消耗 ──
    if not usable_cards:
        return "keep-credit", (
            f"没有可用的重置卡，让{credit_desc}（{_fmt_day(credit_expiry_ms)}到期）先消耗"
        )

    card_expiry = usable_cards[0].get("expire_time")
    if card_expiry is None:
        return "keep-credit", "没有可用重置卡，让积分先消耗"

    # ── 两者都有：比「先过期先用」 ──
    if card_expiry < credit_expiry_ms:
        if skip_card_reason:
            return "wait", skip_card_reason
        return "use-card", (
            f"重置卡（{_fmt_day(card_expiry)}）比{credit_desc}（{_fmt_day(credit_expiry_ms)}）先过期，"
            f"先用卡保住积分"
        )
    return "keep-credit", (
        f"{credit_desc}（{_fmt_day(credit_expiry_ms)}）比重置卡（{_fmt_day(card_expiry)}）先过期，"
        f"不用卡，让积分先消耗"
    )


