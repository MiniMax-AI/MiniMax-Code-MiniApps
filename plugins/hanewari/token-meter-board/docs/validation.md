# 验收说明 / Validation notes

本页记录本包提交官方 Mini App 市场前的自检结果，供审阅者复核。所有数字均来自本机实测。

**2.0.0 相对 1.9.0 的唯一主题：去掉对宿主内部存储的全部访问。**
1.9.0 从 `context.dataDir` 向上定位并打开了 MiniMax Code 的内部数据库，同时扫描观测日志、读取宿主 `config.yaml`。2.0.0 把这整条数据路径拿掉，改读客户端为**用户自己的对话**写下的会话记录。

---

## 一、评审意见逐条对照

评审结论为 `changes requested`，7 条内联意见。下面逐条列出 2.0.0 的处理方式。

| # | 评审意见（原文要点） | 评审定位 | 2.0.0 的处理 |
| --- | --- | --- | --- |
| 1 | `DatabaseSync` 直接打开了 MiniMax Code 的内部数据库，"只读模式不能作为例外" | `common.mjs:55` | **整个 `lib/common.mjs` 已删除**。包内不再有任何 `import ... from 'node:sqlite'`，回归测试对此有静态断言。 |
| 2 | 从插件 `dataDir` 向上查找并定位宿主内部数据库文件，"请去掉整条数据路径" | `server.mjs:29` | 向上查找的目标从数据库文件改为**会话记录目录** `v2/sessions`（与画廊 `mcode-token-usage-board` 同一套解析），数据库定位逻辑整段移除。 |
| 3 | 全表扫描宿主内部库的消息行，并取出用户消息前 200 字 | `facts.mjs:53` | **整个 `lib/facts.mjs` 已删除**。逐轮消息预览已从页面移除，对话表改用「所属会话」标识一轮。 |
| 4 | 从宿主内部库的会话表读取 `title` / `workspace_dir`；绝对工作区路径不应经插件 API 带出 | `queries.mjs:67` | 不再读宿主库。会话标题改取 transcript 中**首条用户消息的前 80 字**（与画廊同规则），会话 id 与模型 id 除外，**页面上没有任何绝对路径**。 |
| 5 | 观测日志属于宿主内部存储，"请与内部库访问一并移除" | `common.mjs:304` | 不再访问。模型显示名改用 transcript 里记录的原始模型 id，不再去别处补齐。 |
| 6 | 整文件读取宿主 `config.yaml`（可能含自定义 provider 配置） | `common.mjs:138` | 不再读取。 |
| 7 | 建议：`/api/health` 返回了绝对 `dataDir`，"请只返回 basename，或省略该字段" | `server.mjs:173` | 已改为 basename：`sessionsDir: "sessions"`。查询 `meta` 不再携带任何路径字段。 |
| 8 | 建议：报错文案里的绝对路径应脱敏 | `common.mjs:52` | 入口统一走 `redactPaths()`，页面收到的错误文案中绝对路径被替换为 `<path>`；完整原文只进 Host 自己的日志。 |
| 9 | 建议：参考已有插件对 loopback `Host`（以及 `Origin`）的检查，降低 DNS rebinding 风险 | — | 已加 `isLoopbackRequest()`，与画廊 `plugins/yujiachen-y/repo-xray` 的实现逐行同款。 |
| 10 | `ENTRY_STDOUT` warning 可以保留；若整条子进程读库路径随红线一起删掉，warning 也会自然消失 | — | `lib/db-child.mjs` 已删除，warning 自然消失。**当前校验结果是 0 error 0 warning。** |

### 为什么数据源换成会话记录

评审明确建议"例如画廊里已有、基于会话记录文件的做法"。本包采用的就是这一条：

- 画廊里已合入的 `plugins/amszuidas/mcode-token-usage-board` 读的就是 `v2/sessions/**/messages.jsonl` + `manifest.json`；
- 路径解析方式一致：从宿主注入的 `context.dataDir` 向上找 `v2/sessions`，找不到时回落到 `~/.minimax`；
- 标题规则一致：取首条用户消息的前 80 字并剥离注入的 system reminder。

### 因此失去的能力（如实说明）

会话记录里**没有**耗时，也**没有**工作区路径，所以 2.0.0 相应地取消了：

- 输出速率、请求全程速率、P50/P90（原口径依赖 decode 耗时，transcript 里没有）；
- 会话排行里的绝对工作区路径 tooltip；
- 每轮用户消息前 200 字预览；
- 来自 `config.yaml` 的模型显示名（表里写原始模型 id）。

保留的是：token 用量、缓存命中率、按模型分布、按天趋势、逐次调用台账、对话（turn）明细与对话状态、会话排行。**对话状态改由 transcript 的 `stopReason` 推导**（`stop` → 已完成，`toolUse` → 未收尾，`aborted` → 已中止，尚无模型调用 → 进行中）。

---

## 二、包检查（官方校验器）

用官方仓 `MiniMax-AI/MiniMax-Code-MiniApps` 的 `scripts/validate.mjs` 直接检查本包目录：

```text
token-meter-board: OK
```

**0 error、0 warning。** 1.9.0 时的 `ENTRY_STDOUT` warning（`lib/db-child.mjs` 写 stdout）随该文件删除而消失；不再需要"可解释的误报"说明。

---

## 三、红线回归守卫

除了包校验器，回归脚本里另有一条针对评审红线的**静态断言**：直接扫描随包发布的运行时代码（`server.mjs`、`lib/sessions.mjs`、`lib/queries.mjs`、`client/index.html`），以下路径形态的字符串必须一处都不出现：

```text
v2/sqlite        runtime-state      node:sqlite      DatabaseSync
v2/observability                   config.yaml      workspace_dir
workspaceDir     userPreview
```

守卫用的 needle 是**路径形态**而不是普通词，所以源码里"我们不读观测日志"这类说明性注释不会误触发。

### 端到端回归（`tmb-v2-test.mjs`）

对本机真实会话记录跑完整 HTTP 流程，全部通过：

| 检查 | 结果 |
| --- | --- |
| `/api/health` 200，`source = session-records` | PASS |
| `/api/health` 不含绝对路径（`sessionsDir = "sessions"`） | PASS |
| 扫描到 > 100 个 transcript 文件、> 5000 次调用 | PASS |
| `/api/window` 的 tokens / calls / turns 均非零，模型分布存在 | PASS |
| 模型名中无数据库相关串 | PASS |
| `/api/models`、`/api/sessions`、`/api/daily`、`/api/turns`、`/api/calls` 均 200 | PASS |
| 以上 5 个端点的响应体均不含绝对路径 | PASS |
| 非回环 `Host` → **403**；回环 `Host` → **200** | PASS |
| 未知查询参数（含 `?dataDir=C:\Windows`）被丢弃，不进入查询层 | PASS |
| 增量重扫 < 1500 ms（实测 **147–172 ms**） | PASS |
| 扫描游标落在插件 `dataDir` 内（1.46 MiB） | PASS |
| 上述 9 条"无禁用引用"静态断言 | PASS |
| 报错文案脱敏：`<path>` 替换生效，400 响应体无绝对路径 | PASS |

---

## 四、覆盖率：会话记录里还剩多少

会话记录不是完整账本。长对话被压缩（compaction）时，被压缩的那一段会被换成摘要，其中的调用就**不在任何** `messages.jsonl` 里了。

测量方式：左边用**插件自己的读取器**（`SessionStore`）数，与看板显示的数字完全一致；右边打开客户端的内部账本**仅用于测量**（这段脚本不属于插件、也不会随包发布）。两边限制在**同一个时间窗**内比较——内部账本有自己的保留期，最早一行比会话记录晚三个多月，直接拿全量会话记录去比会高估缺口。

参考机器实测（2026-10-23）：

**左侧 —— 会话记录（看板读到的）**

| 项 | 值 |
| --- | --- |
| transcript 文件数 | 162 |
| 总体积 | 343.8 MiB |
| 调用次数（按 message id 全局去重） | 8,640 |
| 对话（turn）数 | 417 |
| 会话数 | 151 |
| 覆盖时间 | 2026-06-17 → 2026-10-23 |

**右侧 —— 内部账本（仅参考，插件不读）**

| 项 | 值 |
| --- | --- |
| 记录行数 | 13,124 |
| 会话数 | 121 |
| 覆盖时间 | 2026-09-28 → 2026-10-23（更早的行已被账本自己丢弃） |

**同窗对比（2026-09-28 → 2026-10-23）**

| | 会话记录 | 内部账本 | 覆盖率 |
| --- | --- | --- | --- |
| 调用次数 | 8,422 | 13,124 | **64.2%** |
| token 总量 | 1,133,235,393 | 2,099,198,213 | **54.0%** |

缺口是**被压缩掉的调用**，不是统计口径错误。反方向也有：账本最早一行是 2026-09-28，那之前的 **220 次调用只剩会话记录还留着**——内部账本自己的保留期更短。

> 这些数字是"你的会话记录里还留着多少"，**不是账单**。计费与配额以客户端自己的"用量"页面为准。

---

## 五、性能

同机、真实 HTTP 端到端实测（参考机器，162 个文件 / 343.8 MiB）：

| 场景 | 耗时 |
| --- | --- |
| 服务启动（不触发扫描） | 26 ms |
| **冷启动后第一个查询**（全量扫描所有 transcript） | **1,957 ms** |
| 增量重扫（3 秒 TTL 过期后的下一次刷新） | **168 ms** |
| TTL 命中（3 秒内的重复请求） | 3 ms |
| 新窗口的聚合构建 | 17 ms |

各端点（聚合已就绪）：

| 端点 | 耗时 | 响应体 |
| --- | --- | --- |
| `/api/window?days=7` | 12 ms | 3,855 B |
| `/api/trend?days=7` | 17 ms | 2,766 B |
| `/api/summary?days=7` | 7 ms | 1,068 B |
| `/api/models?days=30` | 9 ms | 3,082 B |
| `/api/sessions?days=30&limit=50` | 11 ms | 24,416 B |
| `/api/daily?days=30` | 12 ms | 9,057 B |
| `/api/turns?days=7&limit=100` | 7 ms | 52,927 B |
| `/api/calls?days=1&limit=200` | 2 ms | 55,708 B |

扫描游标 `session-scan-state.json`：**1.46 MiB**。

**关于增量读取。** 读取器为每个文件记住字节游标与首部哈希，只解析上次之后新追加的内容。上面 168 ms 是**真实的增量重扫**（已在 3 秒 TTL 之外计时）；3 ms 那一行是 TTL 命中，什么都没重扫——两者不是一回事，不应混用。1.9.0 时代 README 里写的"一次刷新 2 毫秒"其实是 TTL 命中被当成了刷新成本，本版已按实测改正。

全量扫描 1,957 ms 是**冷启动的一次性代价**：游标写在插件自己的数据目录里，因此 Mini App 重启后也是接着上次继续，不会每次从头再读一遍。

---

## 六、数据与访问（摘要）

| 项 | 实际情况 |
| --- | --- |
| 读取的文件 | `<dataDir>/v2/sessions/**/messages.jsonl`、`<dataDir>/v2/sessions/**/manifest.json`（**只读**） |
| 不再读取 | `v2/sqlite/runtime-state.sqlite`、`v2/observability/logs/`、`config.yaml` —— 任何模式都不会打开 |
| 写入的文件 | 仅 `<插件数据目录>/session-scan-state.json`（扫描游标，原子写入：先写临时文件再改名） |
| 网络 | 无。不访问任何远端主机，除了自己的源之外不发任何请求 |
| 子进程 | 无。不派生任何进程，不使用 shell |
| 查询参数 | 逐端点显式白名单；未列出的键在进入查询层之前就被丢弃 |
| Host / Origin | `Host` 头不指向回环地址、或 `Origin` 头不指向本监听端口 → **403** |
| 错误文案 | 绝对路径在出页面之前被替换为 `<path>` |

---

## 七、已验证环境

- MiniMax Code 桌面端 **3.1.4**（build 186），Windows 11（10.0.22631，x64）
- 随附 Node.js **v24.18.0**；本版本只用 `node:fs/promises` 与 `node:http`，不需要实验特性开关或原生模块
- 已在桌面客户端中验证：插件安装、窗口切换、自定义起止窗口、逐次调用台账、对话明细实时增长、自动刷新、明暗双主题，以及找不到会话记录时的报错路径
- macOS 与 Linux **未验证**：代码中没有平台相关逻辑（数据路径由 `context.dataDir` 解析），但请把其他平台视为未测

`docs/preview.png` 使用合成数据实拍，界面为中文。
