# 蹬王之王 · 本地到期账本与用卡决策

> English version: [../README.md](../README.md)

**v2.0（裁剪版）— 2026-10-20。**

这个 Mini App 现在只做一件事：**看你自己维护的本地账本，算出「该用卡还是该留积分」**。

---

## v2.0 做了什么、为什么变成这样

v1.x 的功能更激进：它自己去调账号接口拿额度与积分、去读写 MiniMax Code 的内部数据库
去暂停目标、去读别的插件的数据目录去把挂掉的 bot 叫醒。

上游社区插件有三条硬红线（2026-10-20 管理员 review 明确列出）：

| 红线 | v1.x 的做法 | v2.0 的做法 |
| --- | --- | --- |
| **不能读 MiniMax Code 的登录凭据** | 读 lease socket / `.cap` 取 access token，再拿它调账号接口 | **不读**。额度/积分/卡的信息改由**本地账本**提供 |
| **不能读写 MiniMax Code 的内部数据库** | `sqlite3` 直接 `UPDATE`/`DELETE`/`INSERT` 目标与队列，还读回合记录 | **不碰**。只读插件自己的目录 |
| **不能读别的插件的数据目录** | 读 minimax-bot 的 `state.json` 拿 bot 与会话 id，再往那些会话发消息 | **不读**。整个 Bot 看门狗移除 |

⇒ 代价是明确的：**v2.0 不再自动扣卡、不再自动暂停目标、不再自动叫醒 bot。**
它只负责把结论算准、说清楚，**动作由你自己做**。

⇒ 好处也很明确：v2.0 是一份**能进社区仓库**的代码。
它不碰宿主任何私有数据，行为全部可预测。

---

## 它现在的样子

```
你手写的账本                蹬王之王（只读）                 你做决定
~/.config/mcode-reset-card/ ──▶  算「先过期先用」  ──▶   面板上的建议 + 理由
  ledger.json                                          （扣卡/暂停由你手动执行）
```

### 本地账本长什么样

路径：`~/.config/mcode-reset-card/ledger.json`

```json
{
  "schemaVersion": 1,
  "updatedAtMs": 1792480000000,
  "quota": {
    "fiveHour": { "usedPercent": 3, "totalPercent": 100, "unlimited": false, "resetTimeMs": 1792497600000 },
    "weekly":  { "usedPercent": 0, "totalPercent": 100, "unlimited": true,  "resetTimeMs": 1792944000000 }
  },
  "cards": [
    { "cardId": "card_1", "label": "重置卡 A", "sourceType": "code",
      "outBizNo": "biz_1", "expireTimeMs": 1795000000000 }
  ],
  "credits": [
    { "label": "赠送", "source": "code", "granted": 400, "used": 0,
      "balance": 400, "expireTimeMs": 1795017600000 }
  ]
}
```

字段说明：

| 字段 | 含义 |
| --- | --- |
| `quota.fiveHour` / `quota.weekly` | 5 小时与周限额的用量百分比、是否无限、刷新时刻 |
| `cards[]` | 可用的重置卡。`outBizNo` 与 `sourceType` **两个都要有**，否则这张卡不算「可用」 |
| `credits[]` | 积分明细。`balance > 0` 且未过期的才算「还可用」 |
| `updatedAtMs` | 你最后一次更新账本的时刻（面板会显示） |

面板底部有一个**账本编辑区**：可以直接在页面上改 JSON 并保存，
也可以用任何编辑器改这个文件（改完点一下「刷新」）。

> ⚠️ **缺 `credits` 字段 ≠ 没有积分。**
> 字段缺失会被判成「数据不完整」⇒ 结论停在「暂不处理」，
> **绝不会**因为「读不到」就反过来建议你烧掉一张真卡。
> 这条规则在 Rust、Mini App、Python 三份实现里是同构的。

### 决策逻辑：先过期先用

额度打到触发线（默认 99%）时，按「**谁先过期先用谁**」给结论：

| 情况 | 结论 | 理由 |
| --- | --- | --- |
| 额度没到触发线 | 额度充足 | 不动 |
| 额度到线 + 没有可用积分 + 有卡 | **建议用卡** | 没有积分，用卡把额度换回来 |
| 额度到线 + 没有可用积分 + 没卡 | 暂不处理 | 两样都没有 |
| 额度到线 + 有积分 + 没卡 | **建议留积分** | 没卡可用，让积分先消耗 |
| 额度到线 + 都有，卡先过期 | **建议用卡** | 先用卡保住更耐放的积分 |
| 额度到线 + 都有，积分先过期 | **建议留积分** | 让积分先消耗，留住更耐放的卡 |
| 额度到线 + 距刷新不到 N 分钟 | 暂不处理 | 额度马上就自己刷新了，**烧卡纯浪费** |
| 数据不完整 | 暂不处理 | 宁可不给建议，也不给错建议 |

### 三方一致性

决策逻辑有**三份同构实现**：

| 实现 | 位置 | 作用 |
| --- | --- | --- |
| Rust | `daemon/rust/src/decision.rs` | 后台守护进程 |
| Mini App | `miniapp/node/server.mjs` 的 `decide()` | 看板 |
| Python | `daemon/reset_card_autouse.py` 的 `decide_background()` | **比对基准**（纯函数，不联网） |

`daemon/verify-parity.mjs` 让三方读**同一份用例**，逐字比对「动作 + 理由文本」：

```
$ node daemon/verify-parity.mjs
19/19 三方完全一致（动作 + 理由文本逐字）
```

**理由文本必须逐字一致** —— 改一处就要同步三处，否则校验器会红。
这条是本项目最值钱的一道保险：它挡住的正是「三方慢慢漂移，最后结论互相矛盾」。

---

## 后台守护进程

Rust 守护进程通过 macOS `launchd` 常驻，**只读**：

- 每轮读一次本地账本
- 跑一遍上面那套决策
- 把结论写进日志与 `~/.config/mcode-reset-card/daemon-status.json`
- 账本读不到 ⇒ **明确报出来**（「本轮没有任何结论」），而不是当成「没有卡、没有积分」

```bash
cd daemon/rust && cargo test --release   # 25/25
./reset-card-daemon --selftest           # 用合成账本跑一遍决策
./reset-card-daemon once                 # 跑一轮，打印结论
./reset-card-daemon status               # 只打印当前结论
```

⚠️ **它不做任何写操作**：不扣卡、不暂停目标、不改宿主任何数据。

### 诚实的失败

这一版特别在意一件事：**「看起来一切正常、实际什么都没发生」比直接报错更坏**。

所以：

- 账本读不到 ⇒ 日志明确说「本轮**没有任何结论**」，且连续失败会逐级升级（5 轮 / 每 30 轮）
- 同一个原因只说一次（换原因了才再说），不刷屏
- 决策永远带**理由文本**，不是光给一个动作
- 读不到 ≠ 没有：**数据不完整时永远不给「用卡」这种会花钱的建议**

---

## local MCP 端点

插件声明了一个 MCP 端点（`server=expiry-guardian`, `path=/mcp/expiry-guardian`），
别的插件可以在自己的回合里直接问它：

| 工具 | 作用 |
| --- | --- |
| `watchdog_status` | 查账本里的额度、重置卡、积分与当前结论 |
| `watchdog_decide` | 立即判定一次（**只判定不扣卡**） |

⚠️ **刻意不暴露「扣卡」**：扣卡是真实写操作，让别的插件随手就能扣太危险。

---

## 配置

`~/.config/mcode-reset-card/config.json`（Rust / Mini App / Python 读同一个文件）：

```json
{
  "schemaVersion": 1,
  "cardTriggerPercent": 99,
  "cardSkipBeforeResetMinutes": 60,
  "quotaLevels": { "tight": 80, "low": 95 }
}
```

| 字段 | 含义 |
| --- | --- |
| `cardTriggerPercent` | 5 小时额度到这个值就进入「该动手了」的判定 |
| `cardSkipBeforeResetMinutes` | 距刷新不足这么多分钟就不烧卡（0 = 关闭该保护） |
| `quotaLevels` | 额度紧张 / 额度不足两档的显示分界 |

配置里的字段是**白名单式重建**的（`normalizeConfig`）：
少一个字段就是一条静默失效的通道，所以改配置结构时**必须三处同步**
（Rust 配置、Mini App 的 `normalizeConfig`、真实 `config.json`）。

---

## 测试

| 套件 | 结果 |
| --- | --- |
| Rust（`daemon/rust`） | **25/25** |
| Python 决策单测（`daemon/bg_decision.test.py`） | **20/20** |
| Mini App（`tests/`） | **102/102** |
| 三方一致性（`daemon/verify-parity.mjs`） | **19/19** |
| 上游 `npm run validate` | 本插件 **OK**（0 错 0 警）、`repository: OK` |
| 上游 `npm test` | 69/69 |

Mini App 侧另有一个**静态守卫**（`tests/server-lint.test.mjs`）：
抓「用了但没声明」的标识符。
它是在一个真实事故之后加的 —— 看板取数层里一个拼写错误
（`platform` 写成 `platformRes`）让整个取数抛异常，
**看板（额度、决策、卡片）整个是坏的**，而单测测的是纯函数 `decide()`，
**取数那层从来没被跑过**。这个守卫就是为了让那类错当场暴露。

---

## v1.x 曾经做过什么

v1.x（现在已裁掉）的完整历史在 git 里（`git log` 的 v1.1~v1.6 提交），它做过：

- 自动扣卡、自动暂停/恢复目标
- Bot 看门狗：把因临时故障挂掉的 bot 复用原会话叫醒
- 读账号接口拿真实额度

这些都是**对宿主私有数据的操作**，社区插件不能做。
v1.x 里那套「静默失效全部变成会说话」的加固（解析容错、按最新回合判定、
acked 永久化、失败计数只在成功时归零、静态守卫……）**保留了下来**，
它们在 v2.0 里仍然有意义 —— 只是守护的东西换成了本地账本。

---

## 运行环境

- **MiniMax Code 3.1.2 或更高版本**
- macOS 上验证过；上游校验跑在 **Node 20** 上
- Rust 守护进程需要 Rust 工具链来编译（`cargo build --release`）

## 数据与访问范围

本插件**只读写自己的目录**：

| 路径 | 是什么 |
| --- | --- |
| `~/.config/mcode-reset-card/ledger.json` | **你**维护的账本（面板读它，也能直接在面板里改） |
| `~/.config/mcode-reset-card/config.json` | 共享配置（触发线等） |
| `~/.config/mcode-reset-card/daemon-status.json` | 后台守护进程最近一次的结论 |

它**刻意不做**：

- 不读 MiniMax Code 的**登录凭据**（不碰 lease socket、不碰 `.cap`、不落盘 token）
- 不打开也不写 **`~/.minimax/v2/sqlite/runtime-state.sqlite`**（宿主内部数据库）
- 不读**别的插件的数据目录**（如 `~/.minimax/v2/plugin-data/liveboards/*/state.json`）

它在自己目录之外**不做任何写操作**：不扣重置卡、不暂停目标、不往别的插件的会话里写消息。
后台守护进程是可选的 —— 看板自己就能用。

## 前提与边界

- **不读宿主凭据、不碰宿主数据库、不读别的插件的数据**（v2.0 的硬约束）
- **不做任何写操作**：扣卡、暂停目标都要你自己在面板上点
- 结论**仅供参考**：它基于你手写的账本，账本准不准只有你知道
- 数据不完整时**不给结论**，而不是猜一个

## 文档

- 本文件 —— 中文文档
- [../README.md](../README.md) —— 英文版
