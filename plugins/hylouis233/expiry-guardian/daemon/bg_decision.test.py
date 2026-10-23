#!/usr/bin/env python3
"""后台决策测试 —— 逐条对齐 Mini App「蹬王之王」的 decide()。

Mini App 的分支（packages/expiry-guardian/miniapp/node/server.mjs::decide）：
    未耗尽                      → idle
    耗尽 + 无积分 + 有卡        → use-card
    耗尽 + 无积分 + 无卡        → wait
    耗尽 + 有积分 + 无卡        → keep-credit
    耗尽 + 都有，卡先过期        → use-card
    耗尽 + 都有，积分先过期      → keep-credit

本文件逐条复刻这些分支，任一不一致即视为失败。
纯函数测试：不触网、不扣卡。
"""
import importlib.util
import sys
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "bg", Path(__file__).with_name("reset_card_autouse.py")
)
m = importlib.util.module_from_spec(spec)
sys.modules["bg"] = m
spec.loader.exec_module(m)

NOW = int(time.time() * 1000)
DAY = 86400000


def qs(quota_type, used, total=100.0, unlimited=False):
    return m.QuotaState(quota_type=quota_type, total=total, used=used, is_unlimited=unlimited)


def card(days):
    return {
        "card_id": f"C{days}",
        "out_biz_no": f"biz:{days}",
        "source_type": "mcode_signin",
        "expire_time": NOW + days * DAY,
    }


passed = failed = 0


def check(name, got, want):
    global passed, failed
    if got == want:
        passed += 1
        print(f"  PASS  {name} -> {got}")
    else:
        failed += 1
        print(f"  FAIL  {name} -> {got} (want {want})")


def decide(used5, used7d=None, cards=None, credit_days=None):
    quotas = [qs(1, used5)]
    quotas.append(qs(2, 0, unlimited=True) if used7d is None else qs(2, used7d))
    exp = None if credit_days is None else NOW + credit_days * DAY
    return m.decide_background(quotas, cards or [], exp, "平台积分")[0]


print("=== Mini App 分支 1：未到触发线(99%) → idle ===")
# 上界取 98 而不是 99：触发线就是 99%，99% 已经属于「该动手了」，
# 那条在下面单独断言。早先这里写的是 99，是 99% 提前触发设计落地之前的残留。
for pct in (0, 50, 90, 98):
    check(f"5h 已用 {pct}% → idle", decide(pct, cards=[card(7)], credit_days=13), "idle")

# 触发线本身就应该动手 —— 额度没真正耗尽，但再等一次请求就会失败。
check("5h 已用 99% → use-card（触发线）", decide(99, cards=[card(7)], credit_days=13), "use-card")

print("\n=== Mini App 分支 2：耗尽 + 无积分 + 有卡 → use-card ===")
check("5h 100% + 无积分 + 有卡", decide(100, cards=[card(7)], credit_days=None), "use-card")

print("\n=== Mini App 分支 3：耗尽 + 无积分 + 无卡 → wait ===")
check("5h 100% + 无积分 + 无卡", decide(100, cards=[], credit_days=None), "wait")

print("\n=== Mini App 分支 4：耗尽 + 有积分 + 无卡 → keep-credit ===")
check("5h 100% + 有积分 + 无卡", decide(100, cards=[], credit_days=13), "keep-credit")

print("\n=== Mini App 分支 5：耗尽 + 都有 + 卡先过期 → use-card ===")
check("卡 7 天 / 积分 13 天", decide(100, cards=[card(7)], credit_days=13), "use-card")
check("卡 5 天 / 积分 30 天", decide(100, cards=[card(5)], credit_days=30), "use-card")

print("\n=== Mini App 分支 6：耗尽 + 都有 + 积分先过期 → keep-credit ===")
check("卡 20 天 / 积分 5 天", decide(100, cards=[card(20)], credit_days=5), "keep-credit")
check("卡 30 天 / 积分 1 天", decide(100, cards=[card(30)], credit_days=1), "keep-credit")

print("\n=== 周限额单独耗尽也应触发（与 Mini App 的 weekly.exhausted 一致）===")
check("5h 未耗尽 + 周 100% → 进入判定",
      decide(10, used7d=100, cards=[card(7)], credit_days=13), "use-card")
check("5h 未耗尽 + 周未耗尽 → idle",
      decide(10, used7d=50, cards=[card(7)], credit_days=13), "idle")

print("\n=== 不限量的周限额不算耗尽（与 is_unlimited 判定一致）===")
check("周不限量 + 5h 100% + 卡先过期", decide(100, cards=[card(7)], credit_days=13), "use-card")

print("\n=== 理由文本 ===")
cases = [
    ("未耗尽", ([qs(1, 50), qs(2, 0, unlimited=True)], [card(7)], NOW + 13 * DAY, "平台积分"), "额度充足"),
    ("无积分用卡", ([qs(1, 100), qs(2, 0, unlimited=True)], [card(7)], None, ""), "没有可用积分"),
    ("无卡留积分", ([qs(1, 100), qs(2, 0, unlimited=True)], [], NOW + 13 * DAY, "平台积分"), "没有可用的重置卡"),
    ("卡先过期", ([qs(1, 100), qs(2, 0, unlimited=True)], [card(7)], NOW + 13 * DAY, "平台积分"), "先用卡保住积分"),
    ("积分先过期", ([qs(1, 100), qs(2, 0, unlimited=True)], [card(20)], NOW + 5 * DAY, "平台积分"), "让积分先消耗"),
]
for label, args, needle in cases:
    _, reason = m.decide_background(*args)
    ok = isinstance(reason, str) and needle in reason
    if ok:
        passed += 1
    else:
        failed += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}: {reason}")

print(f"\n{passed}/{passed + failed} passed")
sys.exit(0 if failed == 0 else 1)
