# Stage 1 冻结 spec：把 L2 在文档里收成连续的

> # ⛔ 不采纳 — 请勿实施
>
> **状态：已否决（2026-10-11）。本文件保留只为记录否决理由，任何人不得据此改动页面代码。**
>
> **否决理由**：上游把「查询条件在文档里被 KPI 区隔开」当成了需要偿还的结构债（D1）。这个判断是错的——
> 查询条件是一个**聚合**，前端 UI 与最终请求参数本来就该拆开，两块甚至更多块 UI 各拼一部分参数是正常形态
> （是否 MVVM 与此无关）。要求它们在文档里连续，是把「层要连续」当成了设计洁癖。
>
> 提的搬动方案（把搜索框与时间区间移进 sticky 筛选带）也被否决：**窄屏上 sticky 会占满视口，可用区域反而更小**，
> 搜索框尤其如此。
>
> `LAYERS.md` 的 D1 已同步改写为「设计如此，不是缺陷」，并指向真正的问题 **D9（钉住偏移的重算责任只挂在一根线上）**——
> 那一条已经修掉了，与本 spec 无关。
>
> 下面 17KB 的正文（15 条断言 V1–V12、7 条后果 F1–F7、4 条浏览器补测 B1–B4）全部作废，只作为「这条路走过」的记录保留。

状态：**不采纳**
日期：2026-10-11 · 上游：`docs/LAYERS.md` D1（已撤回） · 查漏：`codex / gpt-5.6-sol`（OpenAI，跨家族）

这一份把 `LAYERS.md` 第 4 节的四个问题在本阶段答完，并把它们变成可判定的断言。
**实现代码在本文件冻结之前一行都不写。**

> 修订记录见文末第 8 节。那一轮查漏改了 6 条断言、撤了 1 条、加了 3 条后果，
> 并改正了我自己写错的一个函数名和一条错误理由。

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

- 不动 L1：`#session-select` / `#generation-select` 留在容器外。
- 不动 Stage 2：异常轴仍是三字段（`anomalyRules` / `multiAnomaly` / `anomalyLast`），
  `visibleEntries()` 与 `spanPassesFilter()` 仍是两个入口。**这一阶段不碰模型。**
- 不改任何数字口径 —— 见第 4 问，本阶段一个数字都不改。
- 不删任何现有守卫。断言位置变了就重推，不是因为「搬家了不好测」而删。
- 不改 `#kpi-scope` 的三句措辞，也不动它发布的两个数字。

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
- `#kpi-scope` 与 L2：**从属**。它是 L4 对 L2 的一句声明，视觉上必须与 L2 区隔。

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

| 读点 | 谁写的 | 读什么 | 现在断言它的守卫 |
| --- | --- | --- | --- |
| 5 张卡 | `renderKpi()` | `messages` `toolCalls` `turns` `tokens` `duration` | `client-check.mjs`（类型链接走 `onKindToggle`）、`mutate-turn-breakdown.py` |
| `#kpi-scope` 措辞 | `applyFilterScope()`（5372） | —（纯文本） | 无功能断言 |
| **`#kpi-scope` 里的数字** | `applyFilterScope()`（5383-5387） | `stats.messages`、**`stats.turnsWithPrompt`** | 无 |
| `#range-hint` | `updateRangeHint()` | `stats.messages` | `verify-time-range.mjs` 234/236 |
| `#generation-hint` | `statsAll()` | `payload.stats.messagesAll` | 无 |

> 上一版把写 `#kpi-scope` 的函数记成了 `updateKpiScope()`——**那个函数不存在**，
> 真正的写入者是 `applyFilterScope()`，也就是第 F4 条说「名字与职责不符」的那个。
> 我在同一份文档里把它的名字写错了一次，正好印证那条结论。

**风险，必须写下来**：守着 KPI↔区间这条口径的功能性断言（`verify-time-range.mjs`）
在 `run.mjs` 的 `SKIP` 集合里，**默认不跑**——它的数字针对的是多代长会话，而提交的夹具是单代几十行。
所以这条口径在**默认 24 项验收**里没有覆盖。Stage 1 恰好改 KPI 的位置，因此必须补一条能在
默认套件里跑的断言，而不是依赖那个跳过文件。（补法见 V6。）

---

## 3. 不变量（可判定的）

| | 不变量 | 怎么判 |
| --- | --- | --- |
| I1 | L2 容器的**直属子节点**恰好是四组控件，顺序为 搜索 → 区间 → 类型轴 → 异常轴，且它们之间不夹任何别的元素 | 解析容器子树的**标签序列**，按 id 定位四组；断言它们在子节点序列里**连续**。不能只比下标大小——那样一个插在中间的 KPI 段不会被发现 |
| I2 | `#kpi-grid` 与 `#kpi-scope` 都不在 L2 容器内部 | 子树解析 |
| I3 | `#session-select` / `#generation-select` 不在 L2 容器内部 | 子树解析 |
| I4 | L2 容器不透明 | 解析出的 `background` 必须是**已定义的 `--mcode-*` token**；`transparent` / `rgba` / `hsla` / 含 `/ 0` 的 rgb 一律不算 |
| I5 | L2 容器的偏移仍在 `render()` **末尾**实测写入 | 静态：`syncStickyOffsets();` 是 render 最后一句。运行态由浏览器实测补（见 §6） |
| I6 | `#kpi-scope` 的三句措辞与它发布的两个数字一字未改 | 运行态断言，见 V6 |

---

## 4. verify 清单

每条给出：**断言名** / **它必须拒绝的错误实现** / **配套变异**。
变异之间必须**互不等价**：两条断言共用一个变异，等于其中一条没被测到。

| 断言名 | 必须拒绝的错误实现 | 变异 |
| --- | --- | --- |
| V1 `the four filter controls are direct children of one layer, in order, with nothing between them` | 在搜索与区间之间塞一个 KPI 摘要条或标题 div（**插在中间**，不是接在末尾） | 把 `#kpi-section` 整段移到 `#search-input` 的 field 之后、`#range-from` 之前 |
| V2 `the KPI cards are not inside the filter layer` | 为了「视觉统一」把 KPI 并入筛选容器，且**接在四组之后** | 把 `kpi-section` 追加到 `.anomaly-bar` 之后（仍在容器内） |
| V3 `the session picker stays out of the filter layer` | 顺手把会话选择器也搬进去（它是 L1，搬了就等于把上下文选择说成筛选） | 把 `#session-select` 的 field 挪进容器 |
| V4 `the filter layer is opaque` | 去掉背景色「让页面更透气」，或改成 `rgb(0 0 0 / 0)` | 把 `background: var(--mcode-bg)` 换成 `transparent` |
| V5 `the layer height is still measured at the end of render` | 把 `syncStickyOffsets()` 上移到 `syncAnomalyMode()` 之前 | 交换两行 |
| V6 `the KPI says in words and in numbers which filter it follows` | KPI 位置移动后，那句声明或那两个数字消失／被改成与 `kpiStats()` 行为不符的话 | 把 `整场会话 · 类型与搜索只筛列表` 换回旧措辞 |
| V7 `the range filter and the type chips are siblings inside one layer` | 把区间做成类型轴的子控件（读者会以为区间是「某一类记录的区间」） | 把时间区间 field 嵌进 `#kind-controls` |
| V8 `the time range no longer depends on a toolbar row for its layout` | 搬进容器却没给 L2 容器自己的 flex 规则，靠 `.toolbar-row` 的旧样式蒙混过关 | 删掉 L2 容器的 `display:flex` |
| V9 `the search form no longer calls itself a search landmark` | 保留 `role="search"` 于一个已不含搜索框的表单 | 把 `role="search"` 加回去 |
| V10a/b/c `anomaly mode still silences the other three filter groups` | 搜索、区间、类型轴中**任意一组**丢掉 `data-filter-scope` | 分别给三个 field 去掉该属性，**三条独立变异** |
| V11 `the anomaly axis is not silenced by its own mode` | 给 `.anomaly-bar` 加上 `data-filter-scope` | 给 `.anomaly-bar` 加 `data-filter-scope` |
| V12 `the KPI publishes the same numbers kpiStats returns` | 让 `#kpi-scope` 里的 `N 条消息` 变成别处的数字 | 把 `stats.messages` 换成 `statsAll()` |

V7 是这一阶段最容易犯的错：为了少一个容器，把区间塞进类型轴。两者是同层并列，不是从属。

**为什么 V1 的变异必须插在中间**：上一版写的是「把 KPI 整段移进容器」，而接在四组**之后**时四组仍然连续，
V1 照样通过——**那是一条空操作变异**。现在改成插在搜索与区间之间，它才会真正打断连续性。

### 4.1 静态断言测不到、必须浏览器补的

| | 内容 | 怎么测 |
| --- | --- | --- |
| B1 | 异常模式下搜索 / 区间 / 类型轴确实 `inert`（运行时属性），且 Tab 到不了 | 浏览器读 `element.inert` + 逐个 Tab |
| B2 | 异常轴在异常模式下**仍可 Tab 到** | 同上 |
| B3 | 三个 sticky 带在窄屏换行、提示出现/消失后仍不重叠 | 735px 视口截图 + 量盒 |
| B4 | 最小视口高度下四组控件没有把可用高度吃光 | 断言 `filter-sticky` 高度 < 视口高度的某个比例 |

V10 与 B1 不是一回事：V10 证明标记还在（静态），B1 证明浏览器真的把它 inert 了（运行态）。

### 4.2 结构改动会引出的后果（本阶段必须显式决策）

| | 后果 | 证据 | 本阶段决定 |
| --- | --- | --- | --- |
| **F1** | `.toolbar-row` 承载区间那一行的 `display:flex; flex-wrap: wrap; align-items: center`。区间 field 一旦移出表单，这段规则不再命中它——**布局会静默变样，没有任何报错** | 两条 `.toolbar-row` 规则（默认 + 窄屏 `align-items: stretch`） | L2 容器自己给布局规则，V8 断言 |
| **F2** | `form#toolbar` 上的 `submit` → `preventDefault()` 唯一职责是拦搜索框的隐式提交。移走后表单里只剩两个 `<select>`，handler 成了死代码 | `index.html:6660-6662` | **删掉 handler**。`<form>` 外壳保留（它给这一行一个语义容器），但 `role="search"` 必须去掉——一个不含搜索框的 search landmark 是假话。V9 断言。**更正**：上一版说「保留 form 因为 select 需要 label 关联」——这是错的，`<label for>` 按 `id` 关联，与是否在 form 内无关 |
| **F3** | 异常模式靠 `body[data-anomaly-mode='on'] [data-filter-scope]` 把其它三组标 inert。这是**后代选择器**，搬家后仍生效；异常轴本身不带该属性 | `563` 规则；`6517-6518` 写入；`2032/2039/2065/2083` 四处标记 | V10a/b/c + V11 + B1/B2 |
| **F4** | `applyFilterScope()` 名字说 L2、只写 L4 的口径行；真正的 inert 在 `syncAnomalyMode()` | 函数体首行 `if (!dom.kpiScope) return;` | **不在本阶段改名**（属 Stage 2）。但已记进 `LAYERS.md` D7。**注意**：上一版本 spec 把这个函数的名字写错成 `updateKpiScope()`，已更正 |
| **F5** | **Tab 顺序变了**：现在是 会话→代→搜索→区间→KPI，搬家后变成 会话→代→KPI→搜索→区间，KPI 折叠按钮插进了筛选流程中间 | `2022-2083` 的 DOM 顺序 | **必须决策**：要么把 KPI 的折叠按钮移出 Tab 序列（`tabindex="-1"` + 保留可点击），要么明确接受这个顺序并在 §6 验收。**不能列为「不验证」** |
| **F6** | `#kind-controls` 的 `aria-controls="overview"` 只说了总览条，但同一批筛选同时控制账本；新建的 L2 容器也没有整体名称 | `2083` | 给 L2 容器一个可访问名称（如 `role="group"` + `aria-label`），并复核 `aria-controls` 的目标 |
| **F7** | 窄屏下四组控件全部 sticky，动态高度可能占满视口——实测偏移正确 ≠ 内容可用 | `6131-6138` | B3 + B4：断言 `filter-sticky` 高度不超过视口的 60%，且换行后不重叠 |

---

## 5. 现有断言中会被这一阶段触及的（只重推，不删）

| 断言 | 判断 | 处理 |
| --- | --- | --- |
| `verify-anomaly.mjs:712`「KPI 卡不再夹在两条轴之间」 | 表达式 `!(kindAt < kpiAt && kpiAt < anomalyAt)` 在 KPI 位于两轴之前时通过，**Stage 1 后仍成立**（KPI 留在容器上方，三者相对先后不变） | 但这条只证明「KPI 不在三者的**之间**」，**不证明两轴相邻、同容器、或 KPI 不在 L2 内**。连续性由 V1 保证，容器边界由 V2 保证。**不得把它当作 Stage 1 的连续性保护** |
| `verify-sticky.mjs` 20 条 | 「只改指向」**不足**。现有子树断言只要求 `kind-controls` 与 `anomaly-bar` 同在 band 内 | **必须重写子树成员与排他性**：覆盖搜索、区间、`#range-hint` 四组，并显式排除 L1（会话/代）与 L4（kpi-grid/kpi-scope）。三条内核（band 是一个块 / 偏移实测 / 被钉住的层不透明）保持 |
| `client-check.mjs`「KPI kind links go through onKindToggle」 | 不受影响 | 浏览器点一遍确认 |

---

## 6. 验收

- 现有 24 个守卫全绿，V1–V12 与 B1–B4 各自的断言与变异全绿
- `make-fixtures.mjs --check` 无漂移、`npm run validate` OK
- 浏览器在**三个滚动位置**（页顶 / 面板标题刚滚走 / 账本底部）截图判读：L2 四组连续、无缝隙、无重叠
- 键盘：735px 视口下逐个 Tab 走一遍 L2，确认 F5 的顺序是**决策过**的，且异常模式下 Tab 到不了的三组确实到不了（B1/B2）

> 上一版把「窄屏键盘可达性」划在本阶段不验证，**已撤销**：DOM 顺序与 sticky 高度正是本阶段直接改变的行为，
> 把它排除在外等于把最该验的东西排除掉。

---

## 7. 冻结

**仍未冻结。** 需要下面两项都完成：

1. 把这份**修订版**再交给跨家族只读查漏一轮
2. 查漏结论回写，标明哪些不变量被补、哪些被撤及理由

### 7.1 第一次查漏：跑通了

Windows 沙箱在 `codex exec` 下初始化失败（`setup refresh had errors`），三种执行方式全被拒，
第一次评审因此**交白卷**（它明确拒绝捏造 `文件:行`，且哈希确认未改动文件）。改为把材料
内联进 stdin 后跑通：

```
codex exec -s read-only --skip-git-repo-check -m gpt-5.6-sol -
```

模型只有 `gpt-6.1-sol` 被 ChatGPT 账号拒绝（`not supported when using Codex with a ChatGPT account`），
`gpt-5.6-sol` / `gpt-6-sol` / `gpt-5.5` 等均可。详见 `~/.codex/models_cache.json`。

---

## 8. 第一次查漏的结论与处置

| # | 它指出的 | 处置 |
| --- | --- | --- |
| 1 | V1 的变异是空操作（KPI 接在末尾时四组仍连续） | **接受**，改为插在搜索与区间之间 |
| 2 | V1 与 V2 共用同一变异 | **接受**，V2 改为「接在四组之后」 |
| 3 | V10 只覆盖「异常轴被加了属性」一种 | **接受**，拆成 V10a/b/c + V11 |
| 4 | `#kpi-scope` 不只是措辞，还发布 `messages` / `turnsWithPrompt` 两个数字 | **接受**，口径表补一行，spec 自己漏了这个读点 |
| 5 | 写 `#kpi-scope` 的函数是 `applyFilterScope()` 不是 `updateKpiScope()` | **接受**，那是我写错的，已更正 |
| 6 | 「保留 form 因为 select 需要 label 关联」不成立 | **接受**，`for`/`id` 与 form 无关，我的理由错了 |
| 7 | `verify-sticky.mjs`「只改指向」不足，子树断言要重写 | **接受**，§5 已改 |
| 8 | I1 用下标比大小发现不了中间的插入 | **接受**，改为解析容器子节点的标签序列 |
| 9 | I4 的不透明判断太粗 | **接受**，限定为已定义的 `--mcode-*` token |
| 10 | 焦点顺序变化不能列为「不验证」 | **接受**，新增 F5 并撤销 §6 的排除 |
| 11 | `aria-controls` 目标与容器可访问名称 | **接受**，新增 F6 |
| 12 | 窄屏 sticky 可能占满视口 | **接受**，新增 F7 + B3/B4 |
| 13 | `kpiStats()` 的调用者集合应被断言 | **接受**，新增 V12 |
| 14 | 「目前没有保护」过度表述 | **不成立**。spec 第 94 行原文是「在**默认套件里**目前没有保护」，已经限定了范围；它引的是第 88 行的表格行，那一行里没有这句话 |
| 15 | `verify-anomaly.mjs:712` / `verify-sticky.mjs:79` 的行号 | **部分不成立**。`:712` 正确；`:79` 落在 `value()` 这个辅助函数上，它要谈的是子树成员断言，行号引错 |