<div align="center">

<img src="icon.png" alt="蹬王之王" width="120" />

# 蹬王之王 · Expiry Sentinel

**看清谁先过期，就先用哪一个。**

[English](README.md) | 简体中文

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

MiniMax Code 的积分和重置卡都会到期。放着不管，最快到期的那笔会悄悄作废，
而你一直在用最耐放的那笔。**蹬王之王**把每笔余额和到期日摊开给你看，然后
「先过期先用」——不浪费，也不过期。

## 界面

<div align="center">
<img src="docs/preview.png" alt="看板：到期预警、额度、积分与重置卡到期" width="820" />
</div>

顶部只回答一个最要紧的问题：**有多少快要过期了**。下面是 5 小时限额、积分总余额、
最早到期日和剩余重置卡数量。

<div align="center">
<img src="docs/preview-cards.png" alt="重置卡到期列表与已用统计" width="820" />
</div>

积分明细、重置卡、平台积分池各一张表，全部按到期日排序。

> **关于截图**：截图取自真实账号，因此其中的余额、日期与合计都是真实数据，
> 并非示意样例。界面任何位置都不展示卡号。

## 决策规则

5 小时或周限额耗尽时，请求开始扣积分——这就是该动手的时刻。应用会比两个日期：

| 情况 | 决策 | 原因 |
| --- | --- | --- |
| 重置卡比最早到期的积分**更早**过期 | **用卡** | 重置额度，保住更耐放的积分 |
| 积分比重置卡**更早**过期 | **留卡** | 让积分先消耗掉，卡留到以后更有价值 |
| 额度未耗尽 | **不动** | 还没在烧积分 |

Node 服务和后台守护进程实现同一套规则，并有逐字比对的一致性校验，防止两边漂移。

## 安装

把整个目录（含隐藏的 `.minimax-plugin` 目录）复制到 MiniMax Code 的数据目录。
默认为用户目录下的 `.minimax`，即：

```text
<dataDir>/plugins/expiry-sentinel/
```

如果你配置了其他数据目录，请用那个目录。重启 MiniMax Code，确认插件已被识别并启用，
然后打开 **蹬王之王**，也可以直接让 Agent 帮你打开。

## 使用

**只看不动（默认）。** 打开看板读数据，不消耗任何东西。

**页面内自动执行。** 打开「自动执行」并设置间隔（秒或分钟）。页面开着时按间隔
判定并执行。「立即判定一次」可随时手动触发，无节流。

**全天候后台执行。** 打开「后台服务」。它会安装一个 launchd 代理，关掉页面也在跑，
macOS 上开机自启。页面上能看到它的 PID，也可以随时停掉。

两条路径共用同一套决策规则，服务端按幂等键去重——即使同时开着，卡也不会被扣两次。

## 后台守护进程（可选）

`daemon/` 里是同一套决策逻辑的 Rust 版本，为长时间无人值守而写：

```bash
cd daemon
cargo build --release
```

它需要 token：通过桌面端的 OAuth lease socket
（`~/.minimax/run/mcode-auth-lease-v1.sock`）获取，也就是说 MiniMax Code 需要在运行。
也可以设置 `MCODE_TOKEN` 使用固定凭据。

实测常驻内存不到 1 MB，每轮只请求一个接口，其余按各自变化频率缓存。

## 测试环境

- macOS（Apple Silicon）上的 MiniMax Code 桌面端
- 已在真实账号验证：额度轮询、积分明细、卡列表、扣卡，以及额度耗尽时触发的自动执行
- **未验证**：跨平台表现与其他客户端版本——守护进程走 launchd，目前只在 macOS 上跑过
- 所用接口是私有接口，可能随时变化；接口变化时应用会如实报错，不会编造数据

## 数据与访问

**读取的文件。** 桌面端的 OAuth lease capability 文件
（`~/.minimax/run/mcode-auth-lease-v1.cap`）及其同目录的 lease socket，
用于获取与桌面端相同的登录态。这些路径是客户端内部实现细节，并非公开接口；
一旦变化，后台守护进程会失效。

**写入的文件。**

- `~/.config/mcode-reset-card/token` —— 仅当你提供 `MCODE_TOKEN` 时
- `~/.config/mcode-reset-card/bg-state.json` —— 守护进程记录已尝试过的卡，
  避免重启后重复扣同一张
- `~/Library/LaunchAgents/com.local.mcode-reset-card.plist` —— 仅在启用「后台服务」时写入

**网络地址。** 两个，均为 MiniMax：

- `https://www.minimaxi.com` —— 额度、平台积分池、重置卡
- `https://agent.minimaxi.com` —— MiniMax Code 积分明细、会员汇总

**启动的进程。** 仅 `launchctl load` / `unload`（后台服务）与 `launchctl list`（读状态）。

**Agent 调用。** 无。本应用从不调用 Agent。

**凭据。** 会话 token 只存在于 Node 进程和守护进程内存中，绝不进入 HTML、
客户端 JavaScript、日志或 API 响应。

**扣卡是真实写操作。** 开启自动执行会在你的账号上真实消耗重置卡。
建议先用只读模式熟悉一下。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
