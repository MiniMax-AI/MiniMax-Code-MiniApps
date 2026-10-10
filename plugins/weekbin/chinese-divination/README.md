# 灵签易占 (`chinese-divination`)

English | [简体中文](README.zh-CN.md)

A Chinese classical divination Mini App. It casts hexagrams with the Plum Blossom method
(梅花易数), reads the result through the classical 体用生克 rules, and ships a searchable
library of all sixty-four hexagrams plus a ganzhi almanac. Everything runs locally; the app
makes no network requests. The only file it reads outside its own directory is its own
reading log, inside the private `dataDir` the Host creates for it.

The interface is in Chinese. To get going, read the **Usage guide** below; the derivation rules
and capability disclosures follow it.

## Usage guide

### Thirty seconds

After installing, say "打开灵签易占" to MiniMax Code. The page opens on four tabs:
**起卦 / 卦库 / 历法 / 卦历** (cast / library / almanac / log).

To cast inside the conversation instead, just say "帮我起一卦" — see
[casting in the conversation](#casting-in-the-conversation).

### Asking properly

**The first field is the one that matters.** What you type into 所问何事 decides which kind of
matter you are asking about, and that changes what the reading emphasises:

| You write | Topic recognised | 应期 points to |
| --- | --- | --- |
| 下个月这份 offer 该不该接 | 事业功名 (career) | 巳午, then 辰戌丑未 |
| 这笔投资还能不能赚 | 财运 (wealth) | 申酉, then 亥子丑 |
| 他会不会主动来找我 | 感情 (love) | 亥子, then 寅卯 |
| 明年春天结婚日子好不好 | 婚恋 (marriage) | 寅卯, then 巳午 |
| 父亲的手术要不要等 | 疾病 (health) | 辰戌丑未, then 申酉 |
| 这套房该不该买 | 房产车契 (property) | 辰戌丑未, then 申酉 |
| 下周的考试能过吗 | 学业文书 (study) | 寅卯, then 巳午 |

Be specific. "Should I take this offer" gets a topic, a 类神, and a real 应期; "how's my luck
lately" gets nothing and falls back to the 用卦. If what you wrote genuinely does not match a
topic, the app does not force one — it says so in the reading and falls back to the 用卦.
**"You wrote nothing" and "you wrote something this table does not cover" are different, and the
reading says so differently.** The second case lists the nine topic classes it does cover, naming
the layer that is missing, instead of telling you that you failed to ask.

**Your question does not change the verdict.** The same hexagram asked about money and asked
about marriage cannot flip from 凶 to 吉: 吉凶 comes from the hexagram's own 体用生克 and the
month's vitality. What your question moves is the 应期, which 取象 is emphasised, and the one
sentence at the top of the result that names the thing you actually asked about — 「问的是事业功名，
卦里说的就是这份前程」. Rewording swaps that sentence, never the 吉凶. This is deliberate —
divination should help you think, not let you buy a good answer by phrasing.

That sentence needs the question to name a recognisable matter. The nine classes it covers are
listed under 「所问之事」; write about something outside them and the line is simply left off
rather than filled with a phrase that happens to fit.

### Picking a method

| Your situation | Use | Changes every |
| --- | --- | --- |
| You have a "what is happening right now" question | **时间起卦** | 时辰 (two hours) |
| You just want today's picture | **每日一卦** | once a day |
| You already know what to ask and want to pick your own numbers | **数字起卦** | whenever you change the numbers |
| You want something genuinely random | **铜钱摇卦** | every single toss |

The first two derive their numbers from the clock, so casting twice inside the same 时辰 or on
the same day gives the same hexagram. That is the method working, not a stuck program — the
reading states its own cadence, including the hexagram the next change will produce. Use coins or
numbers when you want variety.

### Using 数字起卦

1. Click 数字起卦; the number fields appear.
2. Quietly hold the question in mind and **think of two numbers** (any two will do).
3. Fill them in and click 起卦. First gives the upper trigram, second the lower, their sum the
   moving line.
4. The fields clear themselves afterwards, so clicking twice cannot look like a frozen result.

「随手取数」 picks two random 1–99 numbers for you.

### Using 铜钱摇卦

Click 铜钱摇卦, then 掷钱 six times from the bottom line up. A progress bar and a 「已摇 n / 6 爻」
counter sit above the buttons and move with every toss, so you can see how many lines are still
missing without counting them. Each toss is shown as it lands; when six lines are in, click 成卦解卦.
「重来」 starts over. This is the only method that differs every single time.

### Reading the result

| Where | What |
| --- | --- |
| Title | your question if you wrote one, otherwise the method's name |
| Verdict block | full width, directly under the title and **above** both columns, so the plain-language answer is the first thing on the page rather than something buried mid-scroll. In order: the verdict in large type with its one-word action (大吉 可进), the sentence saying why in 体用生克 terms, the sentence saying what the hexagram is talking about *in your case*, a grey line showing how the score was reached, 宜 / 忌, and any caution. The derivation below it is the 「凭什么」 — read it or don't, it stays where it is |
| Top right | the same verdict and the 体用 relation, as a badge. It is the same number the block leads with; nothing on the page states two different 吉凶 |
| Left | 本卦 and 变卦 as six-line diagrams with 卦辞 and 象辞; each line carries its 六神 to the left of the bars, and the 干支 and 六亲 to the right, with 世 and 应 boxed in red, a 伏神 under its line in dashed small type, and 空 / 破 / 墓 / 暗 / 日破 / 冲散 as small marks, with the 用神's 元神 / 忌神 / 仇神 tagged 元 / 忌 / 仇 on their own lines; moving lines marked in red, the 动爻's 爻辞 with its 象传 quoted under the 本卦; and, on the eighteen 六冲/六合 hexagrams, three thin arcs in the margin joining 初四、二五、三六 |
| Right | 体卦/用卦 elements and directions, 主客, 六亲世应, 卦体冲合 (whether this hexagram is 六冲 or 六合, and what the changed one is), 用神 (saying where the line sits, or which line the 伏神 hides under), 暗动 · 日破 · 冲散 when the day's branch clashes a line, 爻之合 (合起, 合绊, 合好, 化扶 on each line that meets a combination), 爻之刑 (who punishes whom), the month's vitality, the 旬空 and the month's 月破, the 八宫名单 (one palace's eight hexagrams in generation order, each marking the lines it flips), the four-derivation diagram, and the 消长 ring |
| 断语 | seventeen to twenty-two sections, with 【动爻爻辞】 as the second; 【暗动 · 日破 · 冲散】 is inserted after 【用神】 only when the day's branch actually clashes a line (about 46% of readings); 【犯刑】 follows 【逢合】 and appears only when a line really is punished by another line or by the day's or the month's branch (about 90% of readings — 37 of the sixty-four have 纳甲 that collides on its own, and the rest are covered by the day/month path), and 【六冲】 only when the hexagram itself is 六冲 or 六合, or the changed hexagram is, or a moving line clashes its own transformed line (about 48%); 【反伏与卦变】 follows 【犯刑】 and appears only when there really is a 反伏 or a 卦变 — about 6.4% of hand-tossed readings, and never under 时间, 每日 or 数字 casting, all three of which move exactly one line |
| 起卦依据 | every number that went into the cast, shown rather than hidden |
| 存入卦历 | add a one-line note and keep it on this machine |

The **应期** section is the most practically useful: it names the months and days when the
matter is likely to show itself.

### 卦历 — your own log

Saved castings appear newest first, with the question, hexagram, verdict, time and note, and can
be deleted one at a time. Up to 500 entries. They live only on this machine.

### Casting in the conversation (MCP)

Besides opening the page, the Agent can cast for you **without the page ever opening** — it calls
this package's registered MCP endpoint, which runs the same derivation on this machine. Both
routes use identical logic and give identical results.

#### Making sure it works

1. The package must be **installed** into MiniMax Code (copied to
   `~/.minimax/plugins/chinese-divination/`; see Install below).
2. **Restart MiniMax Code** so the Host scans the plugin directory and registers the MCP server.
3. Then just talk to it. No page needed.

#### What to say, and what the Agent does

| You say | Agent calls | Key arguments |
| --- | --- | --- |
| 帮我起一卦 / what's happening right now | `divination_cast` | `method: time` (the default) |
| 今天什么日子 / today's almanac | `divination_almanac` | no arguments |
| 谦卦什么意思 / look up 水雷屯 | `divination_hexagram_lookup` | `query: 谦` |
| 掷铜钱 / something random | `divination_cast` | `method: coins`; the tool tosses six times for you |
| 今天这一卦 | `divination_cast` | `method: daily` |
| I'm thinking of 3 and 8, cast with those | `divination_cast` | `method: numbers`, `upper: 3` `lower: 8` |

You do **not** have to name a method — the Agent picks from your wording. To force one, say
「用时间起卦」「掷铜钱」「按今天的日子起」.

**The one thing that matters: say what you are asking about.** The Agent puts your words into
`question` and works out the topic itself, then passes it as `topic`. "Cast me a hexagram" with
no subject still works, but no topic is recognised and the timing falls back to the 用卦.

That division is deliberate. On the page there is nobody to read your question, so a keyword
table has to guess, and a phrasing like 「他对我还有没有真心」 matches nothing in it. In a
conversation the Agent has just read the question in full — it can file that under 感情 without
any keyword hitting. The keyword path stays as the fallback for when `topic` is omitted.

#### The three tools, in detail

**`divination_cast` — cast and interpret**

| Argument | Type | Meaning |
| --- | --- | --- |
| `question` | string, ≤120 chars | What you are asking, in your own words |
| `topic` | `wealth` / `career` / `love` / `marriage` / `health` / `study` / `property` / `dispute` / `journey` | Which of the nine classes it is. **The Agent's call**, not a keyword lookup — omit it when unsure and the keyword table takes over. Sets the 类神五行, the 用神 and the 应期; never the 吉凶. An unrecognised value is rejected rather than ignored, so the Agent finds out instead of assuming it landed |
| `method` | `time` / `daily` / `numbers` / `coins` | Defaults to `time` |
| `upper` / `lower` | integer 1–1e9 | Only for `numbers`: the upper and lower trigram numbers |

Two blocks come back: `content[0].text` is prose written for the model, and `structuredContent` is
for programs (`method` / `question` / `topic` / `hexagram` / `changed` / `verdict` / `useGod` /
`transforms` / `dayClash` / `clash` / `fanfu` / `timing` / `disclaimer`). `fanfu` names the branch this reading falls in (`kind` is 「内卦」, 「外卦」, 「内外」 or 「卦变」), says whether the inner and outer trigrams are 反伏, and on the 反伏 side gives the 纳支 set it came from and the one it changed to (`innerSwap` / `outerSwap`); `dayClash` gives the 爻 positions of any 暗动,
日破 and 冲散, and the header gains a 【日冲】 line only when there is something to say. `clash` gives
whether the hexagram is a 六冲卦 or a 六合卦, whether the changed one is, whether the pair is
六合变六冲 or 六冲变六冲, which moving lines clash their own transformed line, the three 爻 pairs with
each one's verdict, and any incidental 爻与爻冲 as 爻-position pairs; the header gains a 【卦体】 line
when there is something to say — which is most readings, so the line is kept to a few words. The header also gains a 【反伏与卦变】 line, on about 6.4% of readings, reporting the two branches separately because they cannot be merged. Both lines stay short on purpose.
`useGod` names the 六亲 taken and, when the 用神 is not on the hexagram,
carries the 伏神 as `hidden` — `position`, `hushen`, `feishen`, `flying` and an `emerges` verdict —
and, when a single 用神 is settled, carries its circle as `circle` — the 爻 positions of the 元神, 忌神
and 仇神 with their elements under `circle.elements` —
so a model never has to dig the answer back out of the prose. A real response:

```text
【起法】数字起卦
【所问】下个月要不要接这个offer
所问事类：事业功名（由 Agent 指定），类神五行 火。
【卦名】火地晋（第 35 卦，⚊⚋⚊⚋⚋⚋），上卦 离火、下卦 坤土
【变卦】天地否（上卦 乾、下卦 坤）；动爻去向 五爻化泄
【爻象】初爻 静爻、二爻 静爻、三爻 静爻、四爻 静爻、五爻 老阴、上爻 静爻
【体用】体卦 离火，用卦 坤土
【京房】乾宫游魂卦，属金；世爻四爻持兄弟，应爻初爻为父母
【卦体】本卦非六冲非六合
【犯刑】月建与4爻酉自刑
【月令旺衰】当令 金，体 囚、用 休
【吉凶】大凶 —— 大凶：宜止
【断语】
【卦象总断】本卦火地晋，晋，康侯用锡马蕃庶，昼日三接。…
【所问之事】所问归「事业功名」，类神取火。…类神火生体卦离火…
（sixteen sections）
【宜】守成，不宜扩张、先处理内务再对外、避开正面对抗
【忌】正面强争、额外投入与加码、在对方主场行事
【起卦依据】第一数 3 除 8 余 3 → 离卦；第二数 8 除 8 余 8 → 坤卦；动爻 11 除 6 余 5 → 五爻
【大白话】
你问的是「下个月要不要接这个offer」。
我把它归到「事业功名」这一类——这一类以火为事。
这一卦给的是「大凶」，宜止。
体卦离火是你，用卦坤土是那件事——这件事要你往外掏；你被局面困住，处境受制。照两人之间的关系本该是凶，你这个月的状态把它拉到了「大凶」。
问的是事业功名，卦里说的就是这份前程——这件事要你往外掏，这一卦落在它上面不顺。
时间上：巳午月或巳午日见端倪，到辰戌丑未前后渐明。
该做的是：守成，不宜扩张、先处理内务再对外、避开正面对抗。别做的是：正面强争、额外投入与加码、在对方主场行事。
体用相制：局面不在你手上，宜守宜退，不宜正面强求。
【提示】本结果由传统占卜法按规则推演……（免责声明全文）
```

Read the top half and you have the apparatus; read the bottom half and you have the answer.

**The last block is the one you are meant to read.** Everything above it is for the Agent to
work from — 卦名, 纳支, 六亲, 用神, the whole apparatus. 【大白话】 at the very end, just before
the disclaimer, is the same reading with the terminology taken out:

- **体卦 is you, 用卦 is the matter at hand.** That is the one translation the page can never
  make for you and the Agent never had to learn: a trigram called 体 is not your body, it is
  whichever side holds the moving line, and that side is the querent.
- **旺相休囚死 is how much force you have right now**, not a ranking of five elements. 旺 is
  「你此刻最有力气」; 死 is 「你气力最弱，此时强推反而吃亏」.
- **The 生克 relation becomes a sentence about who is doing what to whom** — 体生用 reads as
  「这件事要你往外掏」, 用克体 as 「外头的力压着这件事」.
- **Where the two layers disagree, it says so.** 体克用 is 小吉 on 生克 alone, but a 体卦 on
  death ground drags the total down to 平; the plain block spells that difference out instead of
  leaving the reader to think the arithmetic went wrong.
- The topic sentence, the timing, the 宜/忌 and the caution ride along in the same register.

Nothing in it is new judgement — every clause comes from a field the block above already
settled, and it stays silent about anything the reading never decided. The Agent is told in
`initialize` to relay that block rather than re-narrate the hexagram in technical language.

**`divination_hexagram_lookup` — search the sixty-four**

| Argument | Type | Meaning |
| --- | --- | --- |
| `query` | string, ≤40 chars | hexagram name, trigram name, or keyword. Omit for the full table |
| `limit` | integer 1–64, default 8 | how many to return |
| `detail` | `brief` / `full`, default `brief` | `brief` omits the 彖传 text (≈45% shorter), `full` includes it |

**This tool never casts a hexagram for you.** Ask "what does 谦 mean" and you get 谦's texts — not
an unrelated new reading.

The default is 卦辞 and 象辞 only. A lookup is usually a "what does this mean" question, and the
彖传 (about 61 characters per hexagram) is the layer of principle the Agent rarely needs, so it is
left out by default with a note at the end. Pass `detail: full` when you want it.

```text
匹配「谦」的卦共 1 个，如下：

【地山谦】第 15 卦，⚋⚋⚋⚊⚋⚋，上坤下艮
卦辞：亨，君子有终。
象辞：地中有山，谦；君子以裒多益寡，称物平施。
京房：兑宫五世卦（属金），世五爻持子孙，应二爻为官鬼
互卦 雷水解，错卦 天泽履，综卦 雷地豫

（以上省去了彖传原文；需要时传 detail="full" 补上。）
```

**`divination_almanac` — today's almanac**

No arguments. Returns the four ganzhi pillars, the current solar term, the month's element, the
current 时辰 with its pillar and auspiciousness, the lucky hours, the 建除 day, and 数九.

```text
【日期】2026-09-29
【干支】丙午年 丁酉月 丙午日 戊子时
【节气】白露，月建 丁酉（金）
【当前时辰】子时（23:00 - 01:00，司命·黄道吉时）
【黄黑道吉时】子时、寅时、卯时、午时、未时、酉时
【建除十二神】收
【数九】未入数九（数九只在三九、九九两段）
```

#### A full round trip

> **You**: Should I take this offer next month? I'm torn.

The Agent calls `divination_cast` with your words as `question` and `method: time`. Your wording
is recognised as 事业功名 with a 火 类神, so the 应期 lands on 巳午. It explains the hexagram in
its own words — **the interpretation is written live by the model; the hexagram is computed by this
package**.

> **You**: And if I don't take it?

It can cast again (same 时辰, same hexagram — say 「掷铜钱」 if you want a different one), look up
related hexagrams with `divination_hexagram_lookup`, or check dates with `divination_almanac`.

The division of labour: **this package computes accurately; the Agent explains it in terms of
your situation.** The package never calls a model, makes no outbound request, and holds no
credentials.

#### Troubleshooting

**The Agent seems not to know this exists.**
Almost always a missing restart. The Host scans the plugin directory — and registers the MCP
server — only at startup. Restart MiniMax Code and ask again.

**I said "cast me a hexagram" and it didn't.**
Be explicit: 「用梅花易数起一卦」or name the plugin. The bundled
`skills/divination/SKILL.md` already tells it when to cast versus merely look something up; when
it cannot tell, name the method yourself.

**It left out the disclaimer.**
That should not happen — the skill requires it on every reading. Ask it to add it.

**Can I use it in chat without installing?**
No. Both the page and the MCP endpoint need this package loaded from `~/.minimax/plugins/`.

### FAQ

**Same 时辰, same result twice?**
Yes. The clock is a fixed input, so the same 时辰 gives the same hexagram. Use coins or numbers
when you want variety.

**Does my question actually do anything, or is it just reframing?**
It sets the topic and the 应期, not the verdict. In the same 时辰, "should I switch jobs" and
"should we wait for my father's surgery" produce the same hexagram and the same 吉凶, but the 应期
lands on 巳午 versus 辰戌丑未 and the 取象 emphasises different things. That is how Plum Blossom
works; it is not something an AI made up.

**Is it accurate?**
That depends on you. A hexagram does not predict the future; it turns an existing question around
so you can see your own situation and options more clearly. For medical, legal or financial
decisions, get a professional.

**Who wrote all this text?**
The hexagrams are computed from the traditional rules by code. Organising the findings into fluent
Chinese is the AI's job. See "A note on use" below.

**Where do my questions go?**
Nowhere. Saved castings only touch `context.dataDir` on your own machine. The app does not go
online, and the one file it reads outside its own directory is that same reading log.

## What it does

Four ways to cast, one place where the verdict is decided, and the classical layers that
decide timing, imagery and the moving lines. The full derivation — how each rule is applied,
and which parts of the texts this package deliberately does not follow — is in
[docs/derivation.md](./docs/derivation.md).

## Install

Copy this directory, including the hidden `.minimax-plugin/`, into the MiniMax Code plugins
directory as `chinese-divination/` (`~/.minimax/plugins/chinese-divination/` by default; the root
README's Install section explains where that directory is). Restart MiniMax Code and ask the Agent
to "打开灵签易占".

## Tested environment
- A scripted smoke test boots this package's `start(context)` against a throwaway `dataDir` on
  loopback and exercises it end to end: the page, all four cast methods, the coin toss, the 64-entry
  library, the almanac, history create/read/delete, the same-second id collision that used to make
  one delete remove two entries, a deliberately corrupted `readings.json`, and the MCP endpoint's
  `initialize` / `tools/list` / all three `tools/call` / notification / unknown-tool / bad-topic
  paths. It also asserts that the `Host` and `Origin` guards reject a non-loopback name — driven
  through a raw HTTP request, because `fetch` silently drops a caller-supplied `Host` — that `dispose`
  really closes the listener and is idempotent, that no log line carries the `dataDir` path or the
  operating-system user name, and that the `dataDir` afterwards holds nothing but the reading log.
  macOS, Node 22.23.2: all 83 checks pass.
- The suite is run under nine timezones spanning UTC-8 to UTC+14 (`America/New_York`, `UTC`,
  `Asia/Shanghai`, `Pacific/Kiritimati`, `Pacific/Apia`, `America/Los_Angeles`,
  `Pacific/Honolulu`, `Pacific/Chatham`, `Australia/Eucla` — the last two sit on UTC+12:45 and
  UTC+8:45) and under `LC_ALL=C LANG=C`. 248 pass, 0 fail in every combination.
- Two guards keep it that way, because the suite has twice broken on a date: no test may build a
  moment from an absolute instant (`new Date('…')`), since `castByTime` and `castDaily` take the
  hour and the day pillar from the machine's own zone, and no test may reach for the bare clock
  without saying `real-clock:` and why. Every MCP call has to pass a `now` explicitly — the two
  cast results follow the day's ganzhi, which is exactly how an assertion about 出伏 or 日破 once
  started passing or failing depending on the day it was run.
- A path audit over the package reports no problems: every path segment is ASCII and matches the
  portable-path rule, no segment collides with a Windows reserved device name, every text file is
  UTF-8 with no BOM and no CRLF, no two files differ only by case, every relative import resolves to
  a file that exists, and the worst-case `dataDir` path is 112 characters — well inside `MAX_PATH`.
- **Windows and Linux have been run.** All three platforms are exercised, not only reasoned about.
  The macOS round is the scripted one described below — the one whose every step is listed here.
  On Windows and Linux the package was installed, opened through the Agent, and the four sections
  driven, with the coin-toss, history and MCP paths checked along the way. The static checking
  stands behind that run and is what the two platform-specific design decisions rest on: every path
  is assembled with `node:path` (`join` normalises the forward slashes in
  `miniapp/client/index.html` into backslashes on Windows, UNC paths included); no source file
  contains a hardcoded separator or drive letter; there is no `__dirname`, which does not exist in
  ESM, and `import.meta.url` appears only in the test file as `new URL(relative, import.meta.url)`
  plus `fileURLToPath` — the cross-platform-correct ESM form, and outside the runtime payload
  anyway; the three on-disk names (`readings.json`, its `.tmp`, and its `.corrupt-<timestamp>`) are
  legal Windows names, free of reserved device names and characters; the longest of them reaches
  139 characters in the worst dataDir shape simulated, well inside `MAX_PATH`; the two path literals
  in the source match the on-disk spelling character for character, which macOS would have accepted
  even if they did not; and every text file is UTF-8 with no BOM and no CRLF.
- **One thing remains unverified on every platform:** the layout below the 760px breakpoint has not
  been checked on a real screen. Narrowing the content area is not a substitute — the container
  queries below react to block width, not viewport width, so only a real narrow viewport exercises
  that path.
- MiniMax Code 3.0.73 on macOS, Node 22. Installed from this directory, opened through the Agent,
  page rendered and all four tabs exercised.
- The MCP endpoint's `initialize`, `tools/list`, `tools/call`, and error paths were exercised
  locally.
Every further change in this package came with a defect write-up and a mutation-tested
assertion; those are collected in [docs/testing.md](./docs/testing.md).

## Data & access

- Files read: `miniapp/client/index.html`, the Node payload under this package's own directory, and
  `readings.json` inside `context.dataDir` (the reading log, on every request that touches the
  history — list, read one, save, delete). No Host file, user document, or any other path outside
  the package and that one file is read.
- Request parameters are all validated. Every query for a reading id must match `[A-Za-z0-9-]{1,80}`,
  so an entry that could be written is always one that can be deleted. Casting validates the
  method and every numeric bound before the engine sees it.
- Saving a reading takes `{ id, note }` and nothing else. The id must name a hexagram **this
  process just cast** — the server keeps the last 500 — so what lands in `readings.json` is always
  the engine's own output and the page cannot put arbitrary content there. The note is the only
  free text, capped at 2000 characters. Saving the same id twice is refused with `409`, because two
  entries sharing an id would make one delete remove both. One consequence worth knowing: a reading
  has to be saved in the same session as its cast, since a restart drops the server's memory of it.
- Files written: `readings.json` inside `context.dataDir`, the private directory the Host creates
  for this Mini App. It holds saved castings and their notes, newest first, capped at
  500 entries. Writes go to a temporary file in the same directory and are renamed into place, so
  an interrupted write cannot leave a half-written file. The rename is retried with backoff when
  the target is momentarily held open by another process, which is what Windows does when a virus
  scanner or the search indexer has the file. A `readings.json` that cannot be parsed is renamed
  aside to `readings.json.corrupt-<timestamp>` rather than deleted, so a hand-written note inside
  it can still be recovered, and the history then reads as empty instead of failing every request.
  Nothing is written anywhere else.
- Network: **no outbound connections.** The Node process opens no outbound connections, calls no
  model API, and the page loads no remote assets, fonts, or scripts. The MCP endpoint listens only
  on the Host-assigned loopback address `context.listen` and accepts POST only.
- Processes: none spawned. Coin tosses use `node:crypto.randomInt` inside the Node process.
- Secrets: none are read or held. There are no credentials and no Host connector access.
- Requests are accepted only when their `Host` header, and their `Origin` header when one is sent,
  name a loopback host. Two headers, two holes: a site that points its own domain at `127.0.0.1`
  (DNS rebinding) is stopped by `Host`, which then carries the attacker's name; a cross-origin
  request aimed straight at the port is stopped by `Origin`, since `Host` is genuine there. A
  missing header is not treated as forged, because the Host's MCP client is a Node program and
  sends no `Origin`. A rejected request gets `403` and an echo of nothing.
- Log messages carry the error code and never the error text. Node's file-system errors embed the
  full absolute path, operating-system user name included, in `error.message`; `dataDir` is opaque
  by contract and that path does not leave this process. Logs get pasted into issues and uploaded.

## Files

```text
.minimax-plugin/plugin.json   Plugin manifest
package.json                  Mini App declaration
servers.mcp.json              MCP endpoint declaration
skills/divination/SKILL.md    Casting and interpretation rules for the Agent
miniapp/miniapp.json          Payload roots, Node entry, page route, MCP endpoint
miniapp/client/index.html     The page served at /divination
miniapp/node/server.mjs       Node entry: routes, MCP mount, start(context) → { dispose }
miniapp/node/hexagrams.mjs    Trigrams and the sixty-four hexagrams
miniapp/node/yao.mjs           The 384 爻辞, cross-checked against the hexagram diagrams
miniapp/node/xiang-chuan.mjs    The 384 小象传, cross-checked between two editions
miniapp/node/tuan.mjs           The 64 彖传, cross-checked between two editions
miniapp/node/guaqi.mjs          The twelve 辟卦, one per month branch
miniapp/node/jingfang.mjs       京房's eight palaces, 纳支歌诀, 六亲, 世应
miniapp/node/xiang.mjs        Line positions and response timing
miniapp/node/topics.mjs       Element-to-topic: question → topic → 类神
miniapp/node/almanac.mjs      Ganzhi, the twelve offices, solar terms, zodiac
miniapp/node/divination.mjs   Plum Blossom casting and interpretation
miniapp/node/cast-params.mjs  The one place incoming cast parameters are validated
miniapp/node/store.mjs        Reading log persistence in dataDir
miniapp/node/mcp/divination-http.mjs  MCP protocol layer and its three tools
miniapp/node/miniapp-api.ts   Type declarations for the runtime context
docs/derivation.md            How each rule is derived, and which ones are deliberately not followed
docs/testing.md               What changed, why, and which assertion pins it
tests/divination.test.mjs     Unit tests, outside the runtime payload
icon.png                      Plugin icon
```

## A note on use

**The text in this app is generated by AI. It is for entertainment only and has no predictive
function.** A disclaimer saying exactly that sits at the bottom of every page.

The app implements a traditional method of divination faithfully; it is a cultural and
philosophical tool, not a forecasting service. Treat a reading as a prompt to think clearly about
a question you already have, not as a prediction to act on. Nothing here should inform medical,
legal, or financial decisions.

## License

[MIT](./LICENSE)
