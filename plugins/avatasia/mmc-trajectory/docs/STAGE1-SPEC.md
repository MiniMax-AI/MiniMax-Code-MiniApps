# Stage 1 冻结 spec：把 L2 在文档里收成连续的

状态：**待外部查漏，尚未冻结**
日期：2026-10-11 · 上游：`docs/LAYERS.md` Stage 1

这一份把 `LAYERS.md` 第 4 节的四个问题在本阶段答完，并把它们变成可判定的断言。
**实现代码在本文件冻结之前一行都不写。**

---

## 0. 这一阶段只解决一个缺陷

`LAYERS.md` D1：「看哪些记录」这一个职责住在文档位置 3（`form.toolbar`）和位置 5（`.filter-sticky`）两处，
中间隔着整块 KPI 区。读者要滚过 5 张统计卡才够得着筛选控件。

上一轮的 sticky 修复是这笔债的利息。Stage 1 动本金：**让这一层在文档里就是连续的**，
sticky 从「补丁」退化成「这一层本来就该一直在手边」。

---

## 1. Scope

**做**：

- 新建 L2 容器，包住全部四组「看哪些记录」的控件：
  1. 搜索框（`.field.field-grow` / `#search-input`）
  2. 时间区间（`#range-from` `#range-to` + 4 个快捷 + `#range-refresh` + `#range-clear` + `#range-hint`）
  3. 类型轴（`.traj-controls#kind-controls`）
  4. 异常轴（`.anomaly-bar#anomaly-bar`，含多选 + `#anomaly-mode-note`）
- 这四组在**文档顺序上连续**，中间不插入任何非 L2 元素。
- 容器不透明、带 sticky。保留现有实测偏移机制（`syncStickyOffsets()`）。

**不做**（范围闸门，超出即停）：

- 不动 L1：`#session-select` / `#generation-select` 留在容器外，单独一行。
- 不动 Stage 2：异常轴仍是三字段（`anomalyRules` / `multiAnomaly` / `anomalyLast`），
  `visibleEntries()` 与 `spanPassesFilter()` 仍是两个入口。**这一阶段不碰模型。**
- 不改任何数字口径 —— 见第 4 问，本阶段一个数字都不改。
- 不删任何现有守卫。断言位置变了就重推，不是因为「搬家了不好测」而删。
- 不改 `#kpi-scope` 的三句措辞。

---

## 2. 四问

### ① 归层

| 控件 | 归属 | 写的 state |
| --- | --- | --- |
| `#search-input` | L2 | `query` |
| 时间区间全部 | L2 | `rangeFrom` `rangeTo` `rangeCutoff` `rangeFromText` `rangeToText` |
| 类型轴 | L2 | `kinds` |
| 异常轴 | L2 | `anomalyRules` `multiAnomaly` `anomalyLast` |
| `#session-select` `#generation-select` | **L1** | `sessionId` `generation` |
| `#kpi-grid` `#kpi-scope` | L4 | —（只读） |

### ② 关联

- 搜索 / 区间 / 类型轴 / 异常轴：**同层并列**，四组同时可读、互不置灰。
- 异常轴与其它三者：**互斥**，且这个互斥只由 `visibleEntries()` / `spanPassesFilter()` 表达一次
  （`resetBaseFilters()` 负责把另外三者写回默认值）。本阶段不动这段逻辑，只保证容器不破坏它。
- `#kpi-scope` 与 L2：**从属**。它是 L4 对 L2 的一句声明（「我跟随区间」/「类型与搜索只筛列表」），
  视觉上必须与 L2 区隔，不能被读成 L2 的一部分。

### ③ 布局

```
header.page-header
#error-bar / #stale-bar
form.toolbar#toolbar            ← 只剩 L1 一行（会话 / 上下文代）
section.kpi-section#kpi-section ← L4，在 L2 之外，带自己的口径行
div.filter-sticky#filter-sticky ← L2，四组控件，连续，不透明
section.overview#overview
main.columns > panel 轨迹 / panel 检视
```

KPI **留在 L2 上方**（它不是筛选的一部分，视觉上要分开），但它上方已有的 `#kpi-scope`
措辞已经承担了口径声明，本阶段不新增任何标注。

### ④ 口径

**本阶段不改变任何数字。** 但「KPI 跟区间、不跟类型轴/搜索/异常轴」这条口径的全部读点，
必须先盘清楚，因为 Stage 1 动的正是 KPI 与筛选层的相对位置：

| 读点 | 位置 | 现在断言它的守卫 |
| --- | --- | --- |
| 5 张卡（消息 / 工具调用 / 对话轮次 / Token 总量 / 总耗时） | `renderKpi()` | `client-check.mjs`（类型链接走 `onKindToggle`）、`mutate-turn-breakdown.py` |
| `#kpi-scope` 三句措辞 | `updateKpiScope()` | 无**功能**断言；`verify-time-range.mjs` 只覆盖其中两句 |
| `#range-hint` 的「关键指标已按此区间统计 · N 条消息」 | `updateRangeHint()` | `verify-time-range.mjs` 234/236 |
| `#generation-hint` 的「全部上下文共 N 条消息」 | `statsAll()` | 无 |

**风险，必须写下来**：守着 KPI↔区间这条口径的功能性断言（`verify-time-range.mjs`）
在 `run.mjs` 的 `SKIP` 集合里，**默认不跑**——它的数字针对的是多代长会话，而提交的夹具是单代几十行。
所以「KPI 跟区间」这条口径在默认套件里目前**没有保护**。
Stage 1 恰好改 KPI 的位置，因此 Stage 1 必须补一条能在默认套件里跑的断言来覆盖它，
而不是依赖那个跳过文件。（补法见 5 节的 V6。）

---

## 3. 不变量（可判定的）

| | 不变量 |
| --- | --- |
| I1 | L2 的四组控件在文档顺序上连续，中间不插入非 L2 元素 |
| I2 | `#kpi-grid` 不在 L2 容器内部 |
| I3 | `#session-select` / `#generation-select` 不在 L2 容器内部 |
| I4 | L2 容器不透明（账本行是 `background: transparent`，透明容器等于漏行） |
| I5 | L2 容器的偏移仍在 `render()` 末尾实测写入 |
| I6 | `#kpi-scope` 的三句措辞一字未改 |

---

## 4. verify 清单

每条给出：**断言名** / **它必须拒绝的错误实现** / **配套变异**。
第二列不是形式主义——一条只在「实现正确」时通过、在「实现常见错误」时也通过的断言不是守卫。

| 断言名 | 必须拒绝的错误实现 | 变异 |
| --- | --- | --- |
| V1 `the four filter controls are one continuous region` | 把 KPI 区或 `#generation-note` 塞进 L2 容器中间，使某一组控件被隔开 | 把 `#kpi-section` 整段移进容器 |
| V2 `the KPI cards are not inside the filter layer` | 为了「视觉统一」把 KPI 并入筛选容器 | 把 `kpi-section` 挪进 `filter-sticky` |
| V3 `the session picker stays out of the filter layer` | 顺手把会话选择器也搬进去（它是 L1，搬了就等于把上下文选择说成筛选） | 把 `#session-select` 的 field 挪进容器 |
| V4 `the filter layer is opaque` | 去掉背景色「让页面更透气」 | 删 `background:` 声明 |
| V5 `the layer height is still measured at the end of render` | 把 `syncStickyOffsets()` 上移到 `syncAnomalyMode()` 之前 | 交换两行 |
| V6 `the KPI says in words which filter it follows` | 让 KPI 位置移动后，读者看不出它跟不跟区间——即三句措辞被删或被改 | 把 `整场会话 · 类型与搜索只筛列表` 换成旧措辞 |
| V7 `the range filter and the type chips are siblings inside one layer` | 把区间做成类型轴的子控件（读者会以为区间是「某一类记录的区间」） | 把时间区间 field 嵌进 `#kind-controls` |

V7 是这一阶段最容易犯的错：为了少一个容器，把区间塞进类型轴。两者是同层并列，不是从属。

### 4.1 结构改动会引出的后果（本阶段必须显式决策，不能顺手带过）

下面四条不是推测，是对当前代码逐行核过的结果。它们都不在原始 scope 里，但都会因这次搬家而改变。

| | 后果 | 证据 | 本阶段决定 |
| --- | --- | --- | --- |
| **F1** | `.toolbar-row` 承载区间那一行的 `display:flex; flex-wrap: wrap; align-items: center`。区间 field 一旦移出表单，这段规则不再命中它——**布局会静默变样，没有任何报错** | `index.html` 两条 `.toolbar-row` 规则（默认 + 窄屏 `align-items: stretch`） | L2 容器自己给布局规则，且 verify 必须断言区间不再依赖 `.toolbar-row` |
| **F2** | `form#toolbar` 上挂着 `submit` → `preventDefault()`，它唯一的职责是拦下搜索框的隐式提交（搜索是 debounce 实时搜，没有提交动作）。搜索与区间移出后，表单里只剩两个 `<select>`，**这个 handler 和 `role="search"` 都失去对象** | `index.html:6660-6662` | 保留表单（两个 select 仍需要它们的 label 关联），但**去掉 `role="search"`**——一个不含搜索框的 `search` landmark 是一句假话。verify 断言表单内不再有文本输入、且不再声明 `role="search"` |
| **F3** | 异常模式靠 `body[data-anomaly-mode='on'] [data-filter-scope]` 把其它三组标 inert。这是**后代选择器**，搬家后仍然生效；异常轴本身**不带**这个属性（否则会把自己 inert 掉） | `index.html:563` 规则；`6517-6518` 写入；`2032/2039/2065/2083` 四处标记，异常轴不在其中 | 保留现状并加断言：异常模式下四组仍 inert、异常轴不 inert |
| **F4** | `applyFilterScope()` 这个名字和它做的事不符：它写的是 `#kpi-scope`（L4 的口径行），真正的 inert 在 `syncAnomalyMode()` 里 | `index.html` 函数体首行 `if (!dom.kpiScope) return;` | **不在本阶段改**（改名属于 Stage 2 的模型整理）。但必须写进 spec，否则它会在下一次有人读代码时继续误导 |

### 4.2 verify 清单的补充（F1–F3 对应）

| 断言名 | 必须拒绝的错误实现 | 变异 |
| --- | --- | --- |
| V8 `the time range no longer depends on a toolbar row for its layout` | 搬进容器却没给 L2 容器自己的 flex 规则，靠 `.toolbar-row` 的旧样式蒙混过关 | 删掉 L2 容器的 `display:flex` |
| V9 `the search form no longer calls itself a search landmark` | 保留 `role="search"` 于一个已不含搜索框的表单 | 把 `role="search"` 加回去 |
| V10 `anomaly mode still silences the other three filter groups` | 把某个 `[data-filter-scope]` 标记摘掉，或给异常轴也加上它 | 给 `.anomaly-bar` 加 `data-filter-scope` |

---

## 5. 现有断言中会被这一阶段触及的（只重推，不删）

| 断言 | 预期 | 处理 |
| --- | --- | --- |
| `verify-anomaly.mjs`「the KPI cards are no longer between the two axes」 | **仍成立**：KPI 在容器外且位于容器上方，`kind` 与 `anomaly` 会先后进入容器，KPI 不再夹在两者之间 | 实测确认，不靠推理 |
| `client-check.mjs`「KPI kind links go through onKindToggle」 | 不受影响 | 浏览器点一遍确认 |
| `verify-sticky.mjs` 20 条 | 结构改了要改断言名指向，但三条内核（band 是一个块 / 偏移实测 / 被钉住的层不透明）必须保持 | 改指向，不删 |

---

## 6. 验收

- 现有 24 个守卫全绿，新增断言全绿
- `make-fixtures.mjs --check` 无漂移、`npm run validate` OK
- 浏览器三个滚动位置（页顶 / 面板标题刚滚走 / 账本底部）截图判读：L2 四组连续、无缝隙、无重叠
- **不在本阶段验证**：键盘在窄屏下对 L2 的可达性（沿用 METHODOLOGY 第 9 节的既有说明）

---

## 7. 冻结

**本文件尚未冻结。** 冻结需要下面两项都完成：

1. 另一模型家族对 `docs/LAYERS.md` + 本文件的**只读查漏**
2. 查漏结论回写，并标明哪些不变量被补、哪些被删及理由

### 7.1 外部查漏：尝试过，卡在认证

跨家族查漏的想法来自 MCode 官方博客《Agent 越多，我越忙》——「让一个工作单元的验证者和执行者使用不同的模型
家族」，理由是作者的盲点在自己的上下文里，同族也容易有相近的盲点。本机三个跨家族 CLI 都试了，全部未能跑起来：

| CLI | 家族 | 结果 |
| --- | --- | --- |
| `codex exec -s read-only` | OpenAI | 拒绝：默认模型 `gpt-6.1-sol` 与显式 `-m gpt-5-codex` 都返回 `not supported when using Codex with a ChatGPT account` |
| `claude -p --allowedTools Read Grep Glob` | Anthropic | 拒绝：`OAuth session expired and could not be refreshed`（无人值守无法续期） |
| `codebuddy -p --permission-mode plan` | 腾讯 | 拒绝：`Authentication required. Please use /login` |

三次都设了只读机制（`-s read-only` / `--allowedTools` / `--permission-mode plan`），并且前后比对过
`LAYERS.md` 与本文件的哈希——**文件未被改动**，读点盘点与自查全部由本方完成。

**这意味着**：本 spec 目前只有同族自查。它不是「查过漏的 spec」，是「还没查过漏的 spec」。
解锁只需要你在任一 CLI 里登录一次，然后重跑 `.probe\stage1-review-brief.md`——brief 已经写好了，
命令是 `codebuddy -p --tools "Read,Grep,Glob" --permission-mode plan`（或对应 CLI 的只读参数）。