# 蹬王之王 · 排查手册（v2.0 裁剪版）

> 对象：`plugins/hylouis233/expiry-guardian`
> 诊断口径：2026-10-20 首版 → 2026-10-20 晚间重写为「唤醒通道排查手册」→
> **2026-10-20 夜按 v2.0 裁剪版重写**（Bot 看门狗与唤醒通道已移除）。

这份手册回答一个问题：**「到期雷达不显示 / 结论不对 / 守护进程不跑，怎么查？」**

---

## 零、先跑这 5 步（90% 的问题在这里面）

```bash
cd ~/.config/mcode-reset-card

# ① 账本在不在、能不能解析？（唯一数据源）
ls -l ledger.json
python3 -c "import json;d=json.load(open('ledger.json'));print('quota:',bool(d.get('quota')),'cards:',len(d.get('cards',[])),'credits:',len(d.get('credits',[])))"

# ② 守护进程在不在、跑了多久
launchctl list | grep reset-card
tail -20 /tmp/mcode-reset-card.log

# ③ 它算出来的结论
cat daemon-status.json

# ④ 跑一轮，看它说什么
~/mcode-reset-card-autouse/rust/target/release/reset-card-daemon once

# ⑤ 三方逻辑有没有漂移
cd <插件目录> && node daemon/verify-parity.mjs
```

---

## 一、现象 A：面板上「读不到数据」/ 一直转圈

**查什么**

```bash
ls -l ~/.config/mcode-reset-card/ledger.json
tail -30 /tmp/mcode-reset-card.log
```

**怎么判断**

| 观察到 | 结论 | 怎么办 |
| --- | --- | --- |
| 账本文件不存在 | **没有数据源** | 在面板底部的「本地账本」区里填一份并保存，或直接创建 `ledger.json` |
| 账本 JSON 坏了 | 解析失败 | 修 JSON（面板会报出具体的解析错误） |
| 账本里有 `credits` 字段但面板不显示 | 字段形状不对 | `credits[]` 每项要有 `label` / `balance` / `expireTimeMs`；`balance` 必须是数字 |
| 日志里没有「Bot 看门狗」那类行 | **正常** | v2.0 没有 Bot 看门狗了，日志里看的是「决策:」/「理由:」 |

---

## 二、现象 B：结论一直停在「暂不处理」

**这是设计如此**，不是 bug。

**查什么**

```bash
python3 -c "
import json;d=json.load(open('/Users/lh/.config/mcode-reset-card/ledger.json'))
print('有 credits 字段吗:', 'credits' in d)
print('fiveHour 用量:', (d.get('quota') or {}).get('fiveHour',{}).get('usedPercent'))
"
```

**怎么判断**

| 观察到 | 结论 |
| --- | --- |
| 账本里**没有** `credits` 字段 | 「数据不完整」⇒ 结论停在「暂不处理」。⚠️ 这是刻意的：**读不到 ≠ 没有**，宁可不给建议也不给错建议（一个错建议 = 烧掉一张真卡） |
| `credits` 是空数组 `[]` | 确实没有积分 ⇒ 结论会变成「建议用卡」（如果额度到线且有卡） |
| 额度没到触发线（默认 99%） | 结论就是「额度充足」 |
| 距刷新不到 `cardSkipBeforeResetMinutes`（默认 60 分钟） | 结论是「暂不消耗重置卡」—— 额度马上就自己回来了，烧卡纯浪费 |

---

## 三、现象 C：卡明明在账本里，却说「没有可用的重置卡」

**查什么**

```bash
python3 -c "
import json,time;d=json.load(open('/Users/lh/.config/mcode-reset-card/ledger.json'))
now=int(time.time()*1000)
for c in d.get('cards',[]):
    print(c.get('cardId'), 'outBizNo=',bool(c.get('outBizNo')), 'sourceType=',bool(c.get('sourceType')), '过期=',(c.get('expireTimeMs') or 0)<=now)
"
```

**怎么判断**

| 观察到 | 结论 |
| --- | --- |
| `outBizNo` 或 `sourceType` 是空的 | 这张卡**不算可用**（两个字段缺一不可） |
| `expireTimeMs` 已经过去了 | 已过期，不算可用 |
| 字段名写错了（比如写成 `expireTime`） | 取不到值 ⇒ 不算可用。**字段名必须逐字一致** |

---

## 四、现象 D：守护进程没在跑

**查什么**

```bash
launchctl list | grep reset-card
tail -20 /tmp/mcode-reset-card.log
tail -20 /tmp/mcode-reset-card.err
```

**怎么判断**

| 观察到 | 结论 | 怎么办 |
| --- | --- | --- |
| `launchctl list` 里没有这一行 | 没装或没加载 | 装好插件后重新安装 launchd 作业 |
| 日志里连续刷「读不到账本」 | 守护进程在跑，但**账本读不到** | 见现象 A |
| 日志里连续刷「连续 5 轮读不到账本」 | 同上，且已升级告警 | 同上 |
| `.err` 里有 panic | 守护进程崩了 | `cargo build --release` 后重装二进制 |

⚠️ **守护进程崩了不会丢结论**：结论只写在账本与状态文件里，
守护进程只是重算它。

---

## 五、现象 E：面板和守护进程的结论不一样

**查什么**

```bash
cd <插件目录> && node daemon/verify-parity.mjs
```

**怎么判断**

| 观察到 | 结论 |
| --- | --- |
| 报「19/19 三方完全一致」 | 三份**逻辑**没问题 ⇒ 差异来自**输入不同**（面板读账本的瞬间与守护进程读的不是同一份）⇒ 刷新一下页面 |
| 报「N 条不符」 | 🔴 **决策逻辑漂移**了：Rust / Mini App / Python 三份实现不再一致 |

⚠️ **三方的理由文本必须逐字一致**。改了一处就要同步三处，
否则「面板说用卡、守护进程说留积分」这种矛盾会静悄悄地出现。

---

## 六、附录：v1.x 的排查资料去哪了

v1.x 的 Bot 看门狗与唤醒通道（读 minimax-bot 的 `state.json`、写唤醒请求、
用 `session send` 投递）**已随 v2.0 移除** —— 社区插件不能读别的插件的数据目录。

那套机制的实测结论与踩过的坑，完整保留在 git 历史里：

```bash
git log --oneline -- plugins/hylouis233/expiry-guardian/docs/BOT_DIAGNOSIS.md
git show <commit>:plugins/hylouis233/expiry-guardian/docs/BOT_DIAGNOSIS.md
```

其中仍然适用的教训：

1. **「读不到」≠「没有」** —— 缺字段必须当成「数据不完整」，不能当成「没有数据」
2. **粘在对象上的状态会变陈值** —— 判现状要看最近一次动作的结果
3. **一个「窗口」别同时管两件事** —— 「投递过了吗」与「多久能再救」必须拆开
4. **单测覆盖了算法 ≠ 覆盖了接线** —— 取数那层也要有测试（见 `tests/server-lint.test.mjs`）
5. **静默失效比报错更坏** —— 读不到就必须说出来
