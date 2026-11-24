# 润色操作手册（给执行改写的模型）

你拿到的是一张工作单，不是一篇待重写的文章。按下面的规矩改，改到机器不再命中就停。

## 1. 目标与边界

你只做**机械可判的润色**：在句子层面调整措辞，让正文不再命中 `style` 的机械判据。

- 只改工作单条目所指的那一句/那一行。工作单没列的句子，一个字都不动。
- 不改观点，不改论证方向，不合并或拆分小节，不新增或删除论断。
- 不改事实、数字、引用、公式、表格与交叉引用——它们属于保护面（见 §2）。
- 不追求「读起来更漂亮」。判据只有机器那几条，不命中就停，不要顺手多改。
- 工作单里标`无处方：只提示，不许为它改句子`的条目，一律跳过。那是整篇读数或聚合指标，不是逐句改法；为它改句子必然改坏。

## 2. 绝对不许动的

下面六面由 `factscribe review` 的保护面机械比对。任何一面变了，判定就是「拒绝」，本轮改动全部作废。

| 保护面 | 不许动的内容 |
|---|---|
| 事实标记 | 全文 `\fact{...}` 的 id 与顺序，`[[fact:...]]` 同算 |
| 数字 | 所有阿拉伯数字、百分比、区间、量级（`53`、`62.5\%`、`13--19`、`53k`） |
| 引用 | `\cite` 家族的全部命令与 key：`\cite` `\citep` `\citet` `\citealp` `\citeauthor` `\nocite` 等 |
| 公式 | 行内 `$...$`、`$$...$$`、`\[...\]`、`equation` / `align`（含星号）环境的内容 |
| 表格行 | `tabular` / `tabular*` 每一行的单元格数与单元格内容 |
| 交叉引用 | `\label` / `\ref` / `\eqref` 的 key 集合 |

另外三条，保护面查不到但同样是红线：

- 标题不许改论证方向：不删对比对象，不换关系词（`versus` 不许改成 `or`，`对` 不许改成 `和`）。
- 不许整段删除，不许把一段拆成一串残句，不许把解释搬到别的段落。
- 不许新增数字，不许把文字改写成数字，不许改文件名或章节名。

## 3. 流程

1. 读工作单：`python3 -m factscribe polish --plan <项目目录>`。五列：序号、文件:行、错误码、处方、约束。
2. 逐条查处方原文：`python3 -m factscribe prescribe <处方名>`。照「必做」做，「禁做（含反例）」一条都不许碰。
3. 按处方改这一处。一次只改一个条目，改完立刻记下改了哪一句。
4. 跑验收：`python3 -m factscribe review --before 原稿 --after 改后`。看三项明细：保护面、复检（只算新增）、闭合。
5. 三项都过就收工；有新增违规，只回退或重改造成新增的那几条，其它已通过的不要动。
6. 复跑 `review`。最多 3 轮；3 轮不达标按 §6 停手。

十三条处方速查（处方原文以 `prescribe <名>` 为准）：

| 处方 | 治的错误码 | 一句话 |
|---|---|---|
| `heading-shorten` | `HEADING_TOO_LONG` | 删修饰语压标题长度，保留对比对象、主语与关系词 |
| `heading-malformed` | `HEADING_MALFORMED`、`HEADING_RELATION_CHANGED` | 去掉标题里的标点与括号解释，不改关系方向 |
| `heading-subject-keep` | `HEADING_SUBJECT_LOST`、`HEADING_RELATION_CHANGED` | 改写后每个对比对象仍在标题或本节首句里 |
| `section-completeness` | `SECTION_INCOMPLETE` | 每节首段有任务句与可检验的结论句 |
| `term-first-sentence` | `HEADING_ECHO`、`TERM_FIRST_IN_HEADING` | 标题术语首次出现时，首句给定义或可检验断言 |
| `drop-the-proof` | `EXPLAINER_DENSITY`、`JUSTIFY_CHAIN` | 删掉反射式解释，让断言自己站住 |
| `dash-rewrite` | `DASH_PARENTHETICAL` | 插入语破折号改成逗号从属句、括号或拆句 |
| `unbury-the-verb` | `LIGHT_VERB_NOMINALIZATION` | 把埋在名词里的动作写成动词 |
| `cut-the-de` | `ZH_DE_STACK` | 拆掉「的」链，让定语回到动词 |
| `trim-to-budget` | `SECTION_LENGTH` | 先删重复的数字、再删举例、最后合并同义句；论点与每条论点的最后一条证据不许动 |
| `thin-the-numbers` | `NUMERAL_DENSITY` | 只在起草阶段用；每个论点只留一条证据，其余数字删掉或改成定性说法 |
| `merge-overlap` | `SECTION_OVERLAP` | 把重复段落并进被引用的那一节，或删掉本节的重复句，保留本节独有结论 |
| `shift-to-implication` | `WE_ACTION_DENSITY` | 把「我们做了 X」改成「X 意味着 Y」，主语换成对象或结论 |

「无处方」的条目不要去找处方：工作单已经写了它没有处方。

## 4. 验收

验收只有一条命令：

```bash
python3 -m factscribe review --before 原稿 --after 改后
```

只认三种结论，各自这样处理：

- **通过**（退出码 0）：保护面全一致、没有新增违规、闭合三项全过。本轮结束，不用再改。
- **需复核**（退出码 3）：保护面与闭合都过，但新增违规超过允许条数。只定位造成新增的那几处，回退或按处方重改，再跑一次；不许为了压条数把句子改僵。
- **拒绝**（退出码 1）：保护面有红，或闭合不过。立刻把相关改动退回原文措辞，再重新改；不许硬撑，也不许绕过。

读三项明细时按这个顺序定位问题：先看保护面（有红就只修保护面），再看闭合（涨/落/波及面是否对得上），最后看复检的新增违规。

## 5. 已知坏改法（禁做，各带反例）

这些改法能骗过某条判据，但会把文字改坏。一条都不许做。

1. **复述标题**：首句只是把标题换个说法，零新信息。
   反例：标题「摘要」→ 首句`摘要。`
2. **删掉标题里的对比对象**：压长度压掉了论证对象。
   反例：`提示词对机制` → `提示词`（「机制」消失）。
3. **替换关系词**：把对立关系改成选择或并列，论证方向被改。
   反例：`Prompt versus mechanism` → `Prompt or mechanism`。
4. **垫话、设问开头**：用套话或提问代替定义与断言。
   反例：`相关工作里，预注册很重要。`；反例：`什么是预注册？`
5. **为过规则把句子改僵**：为降低「的」密度把定语拆成病句。
   反例：`最后一臂的 5/5 是一个任务的五次运行。` → `最后一臂的，是五次运行的任务的。`（数字还在，句子不成句）。
6. **换一个套语继续解释**：解释链没断，只换了说法。
   反例：`也就是说` → `换句话说`。
7. **换一个破折号当替身**：插入语破折号还在。
   反例：`结果——即 53 个样本——显著` → `结果 – 即 53 个样本 – 显著`。
8. **禁止换标点过关、也禁止换介词过关**：被判定违规的标点（冒号、破折号、句号、括号）不许换成另一种标点蒙混过关——顿号、逗号、括号都不行；冒号标题也不许用 `as` / `with` / `for` / `of` 等介词把两截接起来。正解只有一个：删掉类别词，重写成能独立指路的**名词短语**。
   反例（中文·换标点）：`结论：一项草稿阶段的干预` → `结论、一项草稿阶段的干预`（错：顿号还是把标题劈成两截，结构没改）。
   反例（英文·换介词 `as`）：`Design: A Contract Before a Judge` → `Design as a Contract Before a Judge`（错：介词顶替冒号，两截结构没变）。
   反例（英文·换介词 `with`）：`Method: Indicators, Bidirectional Rules, and Stage` → `Method with Indicators, Bidirectional Rules, and Stage`（错：同上）。
   反例（英文·换介词 `with`）：`Experiment: Three Comparisons and a Blind Protocol` → `Experiment with Three Comparisons and a Blind Protocol`（错：同上）。
   反例（英文·换介词 `as`）：`Conclusion: A Draft-Stage Intervention` → `Conclusion as a Draft-Stage Intervention`（错：同上）。
   正例（中文）：`结论：一项草稿阶段的干预` → `草稿阶段的干预`。
   正例（中文）：`结论：一项草稿阶段的干预` → `一项草稿阶段的干预`（删类别词「结论」，其余照留）。
   正例（英文）：`Results: The Gate Wins on Drafts and Loses on Polished Text` → `Gate Wins on Drafts, Loses on Polished Text`（删类别词，改名词短语）。
   正例（英文）：`Conclusion: A Draft-Stage Intervention` → `A Draft-Stage Intervention`。
   正例（英文）：`Design: A Contract Before a Judge` → `Contract-first design`。
   第 8 条由 `HEADING_SUBSTITUTED` 机械复核：`style --diff` 带 `--before` 时，旧冒号标题只换成 `、` / `，` / `,` / `（` / `）` 或 `as` / `with` / `for` / `of` 即报（细则见 `docs/design/SPEC-SYNTAX-C.md`）。
9. **禁止只删词不重写**：标题压长度时，删掉类别词后必须仍然是一个能独立指路的短语，不许留下残句。
   反例：`结论：一项草稿阶段的干预` → `一项草稿阶段`（删掉中心词「干预」，只剩定语，不成短语）。
   正例：`结论：一项草稿阶段的干预` → `一项草稿阶段的干预`（删掉类别词「结论」，剩下的仍是完整名词短语）。
10. **禁止拆句凑数**：篇幅超预算是要删重复、删举例、合并同义句，不是把句子拆短。
   反例：`模型在十六次运行里都保持稳定，只在措辞层面有变化。` → `模型在十六次运行里。都保持稳定。只在措辞层面有变化。`（三行短句，词数没降，句子还残了）。
   正例：一段 180 词压到 120 词，论点与证据都在；`SECTION_LENGTH` 的读数降到预算 120% 以内。

## 6. 什么时候停

- 3 轮 `review` 仍不达标，就停手。写「改不动」，不许继续硬改。
- 报告里写清：条目（文件:行）、错误码、试过的改法、`review` 的拒绝原因。
- 停手时保留原文，比改坏好。已通过的条目不要回退。
- 任何情况下都不许为过规则去动保护面、把句子改僵、或删掉条目蒙混。
