# 开发与测试记录

这一份记的是「改了什么、为什么这么改、哪条断言把它钉住」——按缺陷逐条排列，
包括每轮变异测试的结果。README 的「测试环境」一节给的是结论，那一节是过程。

## 测试覆盖

- The package's own tests (`node --test "tests/**/*.test.mjs"` from this directory) cover the
  hexagram table, the 错卦/综卦/互卦 derivations, the ganzhi anchors, the twelve offices, the
  建除 cycle, the nine-day period, the coin rules, the response timing table, each method's change
  cadence, the element-to-topic matching, and store round-trips. The classic texts are covered
  entry by entry: all 384 爻辞 are checked against the hexagram diagrams, all 384 小象传 against
  their 爻题, and all 64 彖传 against the hexagram table. The twelve 辟卦 are checked against
  both the month branches and the hexagram table, and the four derivations against their own rules, and the casting timing against the typing budget, and the lookup default plus its explicit full-text
return. The 京房 layer is checked on nine more counts: the palace order against the transmitted
table, 归魂's and 游魂's flipped lines, the eight 纳支歌诀 clauses, branches following the
trigram's polarity, the 六亲 mapping, 世应 pairing without overflow, the reading and diagram
call sites, both lookup levels, and 主客 always straddling the two trigrams. 用神 is checked on
four more counts: the nine topics against their sources, the line-picking order, 婚恋 refusing
to pick for the querent, and 用神不上卦 refusing to invent. 伏神 is checked on five more: both
worked examples reproduced character for character, all 64 hexagrams scanned so every missing 六亲
resolves to exactly one 伏神 **from its own palace**, the four 飞伏 names, the emergence conditions
naming what they cannot check, the right-hand panel reporting the line it hides under, and the
MCP response carrying the same thing as a field. 旬空, 月破 and 入墓 are checked on fourteen more:
the 旬空 歌诀 against the algorithm, both worked examples from the text recovered from their day
pillars, the twelve months of 月破, the five elements' 墓, the seasonal void, false-void rescue
and true-void grounds, the emergence path actually reaching 「终不得出」 on void alone, the
休囚无气 clause, 空 破 墓 暗 日破 冲散 reaching the diagram and the right-hand panel, a 月破 line
counting as 真空 even when it is not 旬空, that sentence no longer telling the reader to wait for a
clash, and the 逢月破 ground not being said twice once the mark already names it. 六神 is checked on four
more: the 歌诀 verbatim, all thirty-two cells of the six-row table, both 乾为天 examples, and the rule
that a god must not move the verdict — the same hexagram cast across twenty-eight days has to hold its
verdict while the god under its first line changes hands. 化爻 is checked on nine more: the two
quoted directions of 回头生 and 回头克, all twenty ordered element pairs landing in five classes of
five, 《卜筮正宗》's five 回头克 cases checked against the 生克 table, the other three relations
carrying no verdict, the 歌诀's sixteen pairs stored verbatim and each checked same-element and
reverse, the quote that confines a changed line to its own moving line, the changed line kept still
so it cannot be rescued as 发动, the reading and the structured field agreeing, and MCP carrying
it. The removed 绝 mark is checked too — a test asserts no 纳支 can land on its own 绝 branch, so
nobody adds the label back thinking it was forgotten. The 元神 / 忌神 / 仇神 circle is checked on
eight more: the book's 金 example reproduced exactly, all five elements following 「余仿此」 with the
three positions never colliding, the 仇神 proved to 反生忌神 and not 生用神, the circle withheld when
the 用神 went to the 伏神 or when two candidates stand, each of the three reported with its line, its
动/暗动/静/动而逢日冲 and its 旺衰, 「勿以仇神即仇人也」 kept, 回头克 read four ways — 凶 on the 用神, 不作凶论 on a
忌神 or 仇神, unjudged on a 元神, and not borrowed when there is no circle — and MCP carrying it.
暗动 · 日破 · 冲散 is checked on fifteen more: the chapter's 坤之师 example reproduced line by line and
pinned as 日破 so the definition and the example cannot drift apart unnoticed, a clashed line dropping out
of both still-line lists once it is moving, all sixty-four hexagrams over twelve months and twelve days
confirming no line ever lands in two of the three, 暗动 and 日破 never sharing a reading, the 用神 section
reporting 暗动 as its own state rather than folding it into 动 or 静, 元神 暗动 coming out 喜 and 忌神 暗动
coming out 忌, 仇神 and off-circle 暗动 left unjudged, no verdict attached when the 用神 is not
settled, the 「用神休囚」 premise called out when the 用神 is 旺相, the chapter's own 风水涣 to 坎为水
example reproduced (丑月丁酉, top line 卯木 moving and clashed by 酉), 旺相 and 元神 and 用神 cases each
placing the 冲散 exactly, the sentence refused the right to pronounce 凶, 冲散 proven independent of the
month's build the way the test could actually fail, the 用神 section giving 「动而逢日冲」 its own tier
instead of folding it into 动, and the diagram and MCP both carrying it. The two MCP header tests sweep all
sixty-four hexagrams rather than pinning one cast, because the tool runs on the real clock and a fixed cast
would quietly stop exercising the branch it names. 旺衰 is checked against all eight non-seasonal months
of 《四时旺相章》 when the module loads, so transposing 囚 and 死 throws instead of silently reporting.
六冲 · 六合 is checked on nine more: the ten and the eight pinned name for name, the pairing offsets
pinned to 初四、二五、三六 so the naive inner/outer pairing cannot creep back, the pairing table
itself read from 纳甲, the 「one pair proves three」 fact held across all sixty-four, no hexagram
counted as both, each of the four reportable ways placed on a real reading, 爻与爻冲 kept below
六冲卦 and never opening a section on its own, the 用神-conditional half applied at 旺 and at 囚 and
declined when the 用神 is not settled, the 近病/久病 rule quoted without a side picked, the
官讼 clause joined only when the matter really is 官讼是非, and the diagram plus MCP carrying it.
The margin arcs are checked too: that they are drawn only after the diagram is on the page (measuring
row heights while the node is still detached yields an empty picture), that they take their width from
the gutter rather than out of the hexagram, that the arc's reach still fits inside that gutter, that
they are muted and never red, that they do not intercept clicks, and that each one names its two
branches. The 八宫名单 is checked too, on both sides. Ten checks on the data: the eight slots sit in generation
order and their names match the received ordering palace by palace (each slot's name and key must be
the same hexagram); the 世 walks up one line at a time from 一世 to 五世 while the flipped lines grow
by one each step; the 游魂 slot does not flip the fourth line; the 归魂 slot flips only the fifth;
every slot's 世 and 应 sit three apart; all sixty-four hexagrams find their own slot and agree on 世 and
应 with the hexagram's own reading; exactly sixteen hexagrams are 游魂 or 归魂 (that slot carries two
marks when it is your own hexagram, which is what the client's "red wins over bold" rule is there
for); and the whole roster including each slot's flipped lines is frozen, since the eight hexagrams
of one palace read the same array. The roster is also checked not to be a second copied table — it
must be the one that came out of the same derivation as the palace and generation themselves. Eight
checks on the page: the row is really inserted rather than a function that is never called, it sits
ahead of the four derivations, the heading names the palace and its element, the caption explains
where 游 and 归 come from, the small-hexagram styles are not scoped back under .derive (doing that
would drop the red flipped lines from the eight slots), the derivation diagram's own arrows and row
spacing stay scoped under .derive, the red self-slot rule is written after the bold 游归 rule at the
same specificity, and the eight slots mark flipped lines but not the 世 (the hexagram to the left
already boxes it in red).
爻之合 is checked too. Nine checks: the 六合 table pairs the twelve branches without repeat or gap
and the pairing is bidirectional; a day branch equal to the month branch counts once rather than
twice; 合起 takes only still lines and 合绊 only moving ones, the two never overlapping; 合好
requires both lines moving (a still-moving pair does not count, and exactly twenty of the sixty-four
have a harmonizing pair outside 初四二五三六 — 雷火丰's first 卯 against its top 戌 gives the
one-moving/one-still contrast); 化扶 requires a moving line whose transformed line combines back; the
combined-line positions are exactly the union of the four paths; the reading names all four without
deciding 吉凶 (both closing lines of the chapter are quoted verbatim); the hexagram gets a muted 「合」
mark, and among the mark rules that take 朱砂 only `po` and `tomb` may appear; and MCP carries a
`combine` field plus a 【逢合】 header line. 爻之刑 is checked too. Six checks: the base text's six and the fate-reading set of eight are not merged (卯刑午 stands, not 卯刑子, and 未辰相刑 is not split into 未刑丑 and 戌刑未, since merging both sets would make 「how many lines are punished」 meaningless); punishment has a direction (卯刑午 holds while 午刑卯 does not); self-punishing 辰 is always 0 across the sixty-four, fixed by the 纳甲 (辰 only sits in the inner lines and a hexagram has one lower trigram), while 午, 酉 and 亥 all come out and a self-punishing pair is reported only once; the book's case reproduces step by step (寅月申日, 风火家人 changing to 离卦, the month branch 寅 punishing the fifth line's 巳 and the day branch 申 punished by that same 巳, both on one line); the reading does not decide 吉凶 from punishment and checks 「用神休囚」 and 「又兼他爻犯之」 one by one; the hexagram gets a muted 「刑」 mark and MCP carries a `punish` field plus a 【犯刑】 header line. A load-time check sweeps all sixty-four hexagrams across
twelve day branches, twelve month branches and all sixty-four motion patterns, verifying what makes
each of the four paths valid rather than merely whether it fired.
The client tests read the source, since there is no DOM in the test runner.
212 passing.

## 逐轮的缺陷与修法

- The type scale and the page layout were raised together, twice, and checked page by page at a
  1524x1304 viewport: casting, reading (the hexagram rows, the four-hexagram derivation, the
  twelve-辟卦 growth ring, the eight-palace list), library, almanac (twelve hours, solar terms,
  zodiac), and history with a 40-character question saved into it. Nothing wrapped or overflowed,
  and the browser console stayed clean.
- The hexagram drawings are pinned by a test on two counts, both of which were once true and
  read as a grey smudge: the yin lines may not be painted in `--border-strong` (two tenths of
  black, used so that yin would recede), and no line drawing may fall back to a 4-5px hairline.
  Yang and yin are told apart by shape — one whole bar against two broken halves — so brightness
  has nothing to add, and the main hexagram on the reading page is held to a heavier minimum
  than the thumbnails it sits beside.
- The twelve-hour grid is pinned by a test: its column count must divide 12 and the time and
  office lines must not wrap, because an `auto-fit` track silently squeezed each cell until
  `03:00 - 05:00` broke across two lines and left that row of cards at two different heights.
- Three more layout defects are pinned by tests, all found by looking at the running page rather
  than by reasoning about it. The eight-palace roster aligned its items to the top, and the
  current hexagram alone carried a border and padding for its seal frame, so that one cell sat
  five pixels lower than the other seven; the frame is an outline now, which draws without taking
  up room. On the twelve-辟卦 ring the bars reach further out than the labels were hung, so on the
  two sectors carrying all six lines the bars fell across the characters — the labels moved out
  and the canvas grew from 200 to 232 units square to make room for them. The ring's breathing
  animation dipped the current sector to 0.55 opacity, flickering the very bars it was pointing
  at out of legibility twice every 2.6 seconds; it now bottoms out at 0.8.
- The reading page is two columns with the right one far longer than the left, so scrolling left a
  large blank behind. The title and the four sections are now one pinned top bar — a translucent
  blurred ground with a rule under it — and on a wide viewport with enough height the left column
  is pinned and offset by the top bar's own height. That height was a number written into `:root`,
  and measuring showed it was the 1340px value: narrow the content area to 700px and the title, the
  subtitle and the ganzhi pills stop fitting on one line, the top bar grows to about 195px, and the
  left column still offsets by 132px — which pushed the 天风姤 heading out from under the bar. The
  height is now measured by a `ResizeObserver` and written back; `--topbar-h` is only the first-paint
  fallback, and the two places no longer carry a number each.
- The four-hexagram derivation and the eight-palace roster now lay themselves out from their own
  width rather than the viewport's. Both were flex-wrap: narrow the content area and the four steps
  folded into 3+1, the eight cells into 7+1, and the orphan sat centred on its own as though it had
  dropped out of the list. Each block is now a named container (`container-type: inline-size`) and
  its column count comes from `@container` — four or two for the derivation, eight or four for the
  roster, every count dividing the total so that no row is left one short. Both sit in the right-hand
  column, whose width the left column and the page margin decide rather than the viewport; a
  viewport query would happily pair a wide screen with a narrow column and pack them unevenly. A
  test asserts that no `@media` rule touches either block, which is what keeps the column count from
  drifting back onto the viewport.
- Inside the derivation the arrow and the hexagram are one cell now, not two siblings. The
  mutual-hexagram note runs to two lines and the other three to one, and the arrow was a centred
  flex column, so that one sat half a line below the other three and the four were not on a line. The
  note is a centred flex box held at two lines tall, the current hexagram's lone cell spans the whole
  row so it centres instead of sitting in the first column, and the line break comes from the `\n` in
  the data (`white-space: pre-line`) rather than from wherever `max-width` happened to fall. That
  width was 88px, and the longest note segment is seven CJK characters — 91px at the note's 13px — so
  that note wrapped to three lines and pushed its arrow off the line with the others. A test measures
  every hard-broken segment against the note's width, so a box narrower than the text goes red.
- The page margin is one value now. `.app` padded 32px either side, spending 64px of width on a
  1149px viewport, and that is what pushed the derivation and the roster into wrapping. It is
  `--app-pad: clamp(14px, 2.1vw, 32px)`; `.app` uses it and `.topbar` uses its negation, because two
  places carrying a number each drift apart the moment the margin moves. The top bar's margin and
  padding, the gap between the reading page's two columns, and the left column's width are each
  asserted to follow that one value.
- The left column was briefly narrowed to `clamp(232px, 21vw, 366px)` to give the right column more
  room, and that was wrong. A hexagram row is `34px + 42px + 1fr + 32px + auto` plus four 12px seams,
  so 156px is gone to the fixed parts before the 纳甲 cell — ganzhi, relative, 世 and 应, void and
  broken, every one of them `nowrap` — gets its 140-odd px to live in. Under 300px the 纳甲 pushes
  through its track into the right column, and the line drawing is squeezed flat at the same time, so
  yin and yang stop being readable at a glance. It is `clamp(300px, 26vw, 366px)` now, with the
  floor asserted against the width the rows actually need. `minmax(clamp(...), 366px)` was tried
  first and is a no-op: with a fixed maximum the track sits at 366px for as long as the content is
  wide enough, so the lower bound never comes into play.
- The six tests added for this round were each mutation-tested: twenty-seven mutations broken on
  purpose across the two container queries, the four column counts, the cell wrapper, the note box,
  the margin's single source, the left column's floor, and the negative case that no viewport query
  reaches either block. Each was checked to turn the matching assertion red, and all 27 were caught;
  the suite reports 212 passing after the script restored the files. Two traps turned up while
  writing the script, and one of them was a real gap in a test. The script had been matching each
  mutation's expected assertion against the *test name*, but those expectations are assertion
  messages, so a run in which every single mutation behaved correctly reported 26 of 27 unpinned;
  it now reads the failure detail instead. And the narrow-screen assertion read
  `grid-template-columns: 1fr`, which `1fr 1fr` also matches — the test was vouching for the
  two-column case while claiming to check the one-column case. The trailing semicolon is what
  separates them now. Restoring the files only in `finally` is a third trap, already noted above:
  mutation N then runs against the file mutation 1 broke, which reads as a test that never pinned
  anything when it was contamination. Every mutation here restores from a clean baseline first.
- A review of the whole package turned up three defects, all in the history store and the cast id,
  all now fixed and pinned. The id was a second-resolution timestamp hashed together with the
  hexagram order and the moving lines. Number casting depends only on the two numbers, so casting
  the same pair twice inside one second produced byte-identical ids — and the 起卦 button is never
  disabled while the casting animation holds for `CASTING_HOLD_MS`, so an ordinary double-click
  sends two requests. Both readings get saved, and `remove(id)` filters by id, so deleting one
  deleted the other as well: measured, two entries with the same id, one delete, zero left. The id
  seed carries a process-local counter now, and the test pins the consequence rather than a
  literal string — two readings of the same hexagram in the same second must differ, and deleting
  one must leave the other.
- On Windows, renaming a file over an existing one fails outright with `EPERM` or `EACCES` when
  another process holds the target open without delete sharing — a virus scanner or the search
  indexer, which is not rare. Nothing is half-written; the save simply fails. The rename now
  retries with backoff on `EPERM`/`EACCES`/`EBUSY` up to four times (about 400ms in total) and
  throws everything else immediately, since retrying a full disk or a read-only mount only holds
  the request. The decision is a pure function so it can be tested without provoking a real lock,
  and the call site is pinned separately — the predicate alone stays green if someone deletes the
  loop that uses it.
- A `readings.json` that cannot be parsed used to throw out of every history endpoint, so a
  truncated write, a hand edit or a sync conflict left the history permanently unopenable with no
  way to recover. It is now renamed aside to `readings.json.corrupt-<timestamp>` — moved, not
  deleted, so a hand-written note can still be recovered — and the history reads as empty.
  Separately, `ReadingStore.update()` had no route, no caller and no test; the only field it
  produced was `updatedAt`, which `toSummary` copied out to become a field that was always
  `undefined`. Both are gone rather than left as a branch that can never run and a key that
  implies a note-editing feature the package does not have. `GET /history/:id` stays: its store
  method is covered by a test, and it is the natural shape of the resource.
- The fifteen assertions added for these three were each mutation-tested, and all 15 were caught
  with the suite reporting 212 passing after the script restored the files. Three of the first
  run reported unpinned and all three were the script's fault rather than a loose test: one
  expectation named an assertion the mutation tripped *after* an earlier one had already fired, one
  mutation deleted the call that an earlier assertion already covered, and one threw out of the
  test before reaching the assertion that named the contract — the test now catches the rejection
  and folds the cause into the message, so a failure reports the contract that broke rather than a
  raw JSON parse error. The suite's own wording is also worth repeating: `assert.match` and
  `assert.equal` without a message throw Node's default text, so any keyword-based "did this
  mutation pin anything" check can never match. Two of those assertions carry an explicit message
  for that reason.
- The 起卦 button had no in-flight guard, and that is the other half of the id defect above. The
  cast beat holds for `CASTING_HOLD_MS` — over four seconds — and throughout it every method
  button and the 起卦 button stayed clickable, so an ordinary double-click sent two cast requests,
  two casting logs typed over each other, and whichever answered last won. The only `disabled` in
  that panel belonged to `toss-finish`, and that one encodes a different rule — six tosses
  required — not "a cast is in flight". All three casting paths (daily/time, numbers, coins) go
  through `cast()`, so that is where the gate now lives: a `casting` flag set synchronously before
  the first `await`, and the triggers locked for the duration.
- The restore is the part that is easy to get wrong, so it is pinned explicitly. Unlock puts every
  control back to the value it had rather than clearing `disabled` across the board: `toss-finish`
  is meant to be disabled whenever fewer than six coins have been thrown, and a blanket re-enable
  would leave a "成卦解卦" button that looks available and does nothing. The unlock sits in
  `finally`, because a single failed request must not leave the whole casting panel permanently
  dead. And `cast()` now returns whether the reading was actually cast: the numbers path clears
  its two inputs only on success, since clearing them after a skipped or failed cast throws away
  what the user just typed.
- Verified on the running page rather than by reading: double-clicking 时间起卦 produced exactly
  one `POST /api/divination/cast` in the network log, and after the cast finished `toss-finish`
  still carried `disabled=""` while the method buttons carried none. The disabled state *during*
  the four-second beat was not observed directly — the round trip between tool calls is longer than
  that window — but the assignment sits in the same synchronous block as the `casting` flag that
  the double-click test proves took effect. The twelve assertions covering this were each
  mutation-tested and all 12 were caught, the suite reporting 212 passing after the script restored
  the files. Two failed the first run for reasons in the script rather than in the test: one
  mutation was an empty change that altered no behaviour, and another removed the whole `finally`
  block, so it tripped the earlier "there is no finally" assertion rather than the one it aimed at.
- The two coin-toss buttons used to contradict each other. `renderToss()` computed which one should be
  disabled from how many tosses had landed, and then the tail of `tossOnce()` hard-wrote an unconditional
  re-enable on top of that, wiping the "six tosses is enough, disable 掷钱" it had just computed. Past six
  tosses both buttons were therefore live at once: a seventh toss could be thrown — a line that fits into
  neither a six-line hexagram nor anything the user can take back, so the reading shifts — and the six
  tosses could still be cast. Neither button meant anything. Availability now lives in one place,
  `syncTossButtons()`, derived only from `state.tosses.length`, and the in-flight tail calls it to
  recompute rather than blanket-enabling. Same lesson as the cast lock above: unlocking has to be computed
  from state, never by clearing `disabled` wholesale.
- Two related holes are closed in the same pass. 重来 is held while a toss is in flight — resetting
  halfway through would drop the line already on its way into a list that was just emptied, leaving a line
  in the hexagram with no visible origin. And the "six tosses, then 重来" path runs no in-flight tail at
  all, so its button state has to come from the redraw itself rather than from whatever the previous tail
  happened to leave behind.
- This part of the suite **runs** the logic instead of matching source text: `syncTossButtons`, `lockToss`,
  `tossOnce` and `renderToss` are lifted out verbatim and driven against a fake DOM and a fake fetch
  through seven paths — idle, one to five tosses, the sixth, a seventh, 重来, in-flight, and a failed
  request. The defect lived in *who writes `disabled` last*, which source text cannot show. All
  thirty-six assertions were mutation-tested and all 15 mutations were caught, the suite reporting 212
  passing after the script restored the files. Seven failed the first run for reasons in the script: the
  expect named a later assertion while the test went red on an earlier one carrying the same meaning —
  relaxing "成卦解卦 is always enabled" to `> 6`, for instance, trips the idle-state assertion first.
  **One of them was a genuinely loose test**: it measured "did a failed toss record a line?" by counting
  rows in the hexagram log, but a failed request never reaches `renderToss`, so the log is empty no
  matter what — it now measures `state.tosses.length` directly.
- Verified on the running page as well: with a throwaway runtime up, six clicks on 掷钱 left `#toss-btn`
  carrying `disabled=""` and `#toss-finish` enabled, and 重来 put both back exactly at the start state
  (one clickable, one disabled).
- The casting beat used to play only the engine's own 取数 steps — two for the coins, three for
  numbers — so the speech ran out before the hexagram was even formed. It now follows with the four
  lines that come after, in order of importance: the upper trigram, lower trigram and resulting
  hexagram, the moving lines and the changed hexagram, the palace with its 世 and 应, and the body
  and use with their elements. All four methods produce all four, and every word comes from a field
  the engine has already computed. When the budget runs short it is the body-and-use line that goes;
  the other three may never be squeezed out. That budget had a hole in it once: the closing line's
  characters were never counted, so on a wordier cast the real duration pushed past the budget and
  the last line was cut off by the page change. The closing line reserves its share now, and the hold
  takes its length from the constant `CASTING_HOLD_MS` (the 4s typing budget plus 400ms) instead of
  a second number at the call site. The four methods measure 3904-4000ms of typing against a 4400ms
  hold. The log is held at 320px, which fits the 11 lines the beat can reach (10 under the line cap
  plus the closing one) — each is nowrap at a fixed line height, so a pixel short of that is a
  missing pixel.
- The fourteen assertions added for this round were each mutation-tested: six on the top bar
  (pinned, blurred ground, rule, stacking, cancelled padding, wrapping the sections), five on the
  left column (pinned, offset following the bar, viewport-bounded, height measured back, not a dead
  number), four on the beat (all four lines present, the three important ones never squeezed, the
  closing line kept, the fixed height fitting 11 lines), and two on the timings (not through the
  budget, hold taken from the constant). Each implementation was broken on purpose to confirm the
  matching test really went red; all 22 were caught, and the suite reports 212 passing after the
  script restored the files. One trap turned up while writing the script: restoring only in
  `finally` means mutation N runs against the file mutation 1 already broke, so anchors go missing
  and the red counts climb — which reads as "the test never pinned it" when it was contamination.
- The package's own tests (`node --test "tests/**/*.test.mjs"` from this directory) cover the
  hexagram table, the 错卦/综卦/互卦 derivations, the ganzhi anchors, the twelve offices, the
  建除 cycle, the nine-day period, the coin rules, the response timing table, each method's change
  cadence, the element-to-topic matching, and store round-trips. The classic texts are covered
  entry by entry: all 384 爻辞 are checked against the hexagram diagrams, all 384 小象传 against
  their 爻题, and all 64 彖传 against the hexagram table. The twelve 辟卦 are checked against
  both the month branches and the hexagram table, and the four derivations against their own rules, and the casting timing against the typing budget, and the lookup default plus its explicit full-text
return. The 京房 layer is checked on nine more counts: the palace order against the transmitted
table, 归魂's and 游魂's flipped lines, the eight 纳支歌诀 clauses, branches following the
trigram's polarity, the 六亲 mapping, 世应 pairing without overflow, the reading and diagram
call sites, both lookup levels, and 主客 always straddling the two trigrams. 用神 is checked on
four more counts: the nine topics against their sources, the line-picking order, 婚恋 refusing
to pick for the querent, and 用神不上卦 refusing to invent. 伏神 is checked on five more: both
worked examples reproduced character for character, all 64 hexagrams scanned so every missing 六亲
resolves to exactly one 伏神 **from its own palace**, the four 飞伏 names, the emergence conditions
naming what they cannot check, the right-hand panel reporting the line it hides under, and the
MCP response carrying the same thing as a field. 旬空, 月破 and 入墓 are checked on fourteen more:
the 旬空 歌诀 against the algorithm, both worked examples from the text recovered from their day
pillars, the twelve months of 月破, the five elements' 墓, the seasonal void, false-void rescue
and true-void grounds, the emergence path actually reaching 「终不得出」 on void alone, the
休囚无气 clause, 空 破 墓 暗 日破 冲散 reaching the diagram and the right-hand panel, a 月破 line
counting as 真空 even when it is not 旬空, that sentence no longer telling the reader to wait for a
clash, and the 逢月破 ground not being said twice once the mark already names it. 六神 is checked on four
more: the 歌诀 verbatim, all thirty-two cells of the six-row table, both 乾为天 examples, and the rule
that a god must not move the verdict — the same hexagram cast across twenty-eight days has to hold its
verdict while the god under its first line changes hands. 化爻 is checked on nine more: the two
quoted directions of 回头生 and 回头克, all twenty ordered element pairs landing in five classes of
five, 《卜筮正宗》's five 回头克 cases checked against the 生克 table, the other three relations
carrying no verdict, the 歌诀's sixteen pairs stored verbatim and each checked same-element and
reverse, the quote that confines a changed line to its own moving line, the changed line kept still
so it cannot be rescued as 发动, the reading and the structured field agreeing, and MCP carrying
it. The removed 绝 mark is checked too — a test asserts no 纳支 can land on its own 绝 branch, so
nobody adds the label back thinking it was forgotten. The 元神 / 忌神 / 仇神 circle is checked on
eight more: the book's 金 example reproduced exactly, all five elements following 「余仿此」 with the
three positions never colliding, the 仇神 proved to 反生忌神 and not 生用神, the circle withheld when
the 用神 went to the 伏神 or when two candidates stand, each of the three reported with its line, its
动/暗动/静/动而逢日冲 and its 旺衰, 「勿以仇神即仇人也」 kept, 回头克 read four ways — 凶 on the 用神, 不作凶论 on a
忌神 or 仇神, unjudged on a 元神, and not borrowed when there is no circle — and MCP carrying it.
暗动 · 日破 · 冲散 is checked on fifteen more: the chapter's 坤之师 example reproduced line by line and
pinned as 日破 so the definition and the example cannot drift apart unnoticed, a clashed line dropping out
of both still-line lists once it is moving, all sixty-four hexagrams over twelve months and twelve days
confirming no line ever lands in two of the three, 暗动 and 日破 never sharing a reading, the 用神 section
reporting 暗动 as its own state rather than folding it into 动 or 静, 元神 暗动 coming out 喜 and 忌神 暗动
coming out 忌, 仇神 and off-circle 暗动 left unjudged, no verdict attached when the 用神 is not
settled, the 「用神休囚」 premise called out when the 用神 is 旺相, the chapter's own 风水涣 to 坎为水
example reproduced (丑月丁酉, top line 卯木 moving and clashed by 酉), 旺相 and 元神 and 用神 cases each
placing the 冲散 exactly, the sentence refused the right to pronounce 凶, 冲散 proven independent of the
month's build the way the test could actually fail, the 用神 section giving 「动而逢日冲」 its own tier
instead of folding it into 动, and the diagram and MCP both carrying it. The two MCP header tests sweep all
sixty-four hexagrams rather than pinning one cast, because the tool runs on the real clock and a fixed cast
would quietly stop exercising the branch it names. 旺衰 is checked against all eight non-seasonal months
of 《四时旺相章》 when the module loads, so transposing 囚 and 死 throws instead of silently reporting.
六冲 · 六合 is checked on nine more: the ten and the eight pinned name for name, the pairing offsets
pinned to 初四、二五、三六 so the naive inner/outer pairing cannot creep back, the pairing table
itself read from 纳甲, the 「one pair proves three」 fact held across all sixty-four, no hexagram
counted as both, each of the four reportable ways placed on a real reading, 爻与爻冲 kept below
六冲卦 and never opening a section on its own, the 用神-conditional half applied at 旺 and at 囚 and
declined when the 用神 is not settled, the 近病/久病 rule quoted without a side picked, the
官讼 clause joined only when the matter really is 官讼是非, and the diagram plus MCP carrying it.
The margin arcs are checked too: that they are drawn only after the diagram is on the page (measuring
row heights while the node is still detached yields an empty picture), that they take their width from
the gutter rather than out of the hexagram, that the arc's reach still fits inside that gutter, that
they are muted and never red, that they do not intercept clicks, and that each one names its two
branches. The 八宫名单 is checked too, on both sides. Ten checks on the data: the eight slots sit in generation
order and their names match the received ordering palace by palace (each slot's name and key must be
the same hexagram); the 世 walks up one line at a time from 一世 to 五世 while the flipped lines grow
by one each step; the 游魂 slot does not flip the fourth line; the 归魂 slot flips only the fifth;
every slot's 世 and 应 sit three apart; all sixty-four hexagrams find their own slot and agree on 世 and
应 with the hexagram's own reading; exactly sixteen hexagrams are 游魂 or 归魂 (that slot carries two
marks when it is your own hexagram, which is what the client's "red wins over bold" rule is there
for); and the whole roster including each slot's flipped lines is frozen, since the eight hexagrams
of one palace read the same array. The roster is also checked not to be a second copied table — it
must be the one that came out of the same derivation as the palace and generation themselves. Eight
checks on the page: the row is really inserted rather than a function that is never called, it sits
ahead of the four derivations, the heading names the palace and its element, the caption explains
where 游 and 归 come from, the small-hexagram styles are not scoped back under .derive (doing that
would drop the red flipped lines from the eight slots), the derivation diagram's own arrows and row
spacing stay scoped under .derive, the red self-slot rule is written after the bold 游归 rule at the
same specificity, and the eight slots mark flipped lines but not the 世 (the hexagram to the left
already boxes it in red).
爻之合 is checked too. Nine checks: the 六合 table pairs the twelve branches without repeat or gap
and the pairing is bidirectional; a day branch equal to the month branch counts once rather than
twice; 合起 takes only still lines and 合绊 only moving ones, the two never overlapping; 合好
requires both lines moving (a still-moving pair does not count, and exactly twenty of the sixty-four
have a harmonizing pair outside 初四二五三六 — 雷火丰's first 卯 against its top 戌 gives the
one-moving/one-still contrast); 化扶 requires a moving line whose transformed line combines back; the
combined-line positions are exactly the union of the four paths; the reading names all four without
deciding 吉凶 (both closing lines of the chapter are quoted verbatim); the hexagram gets a muted 「合」
mark, and among the mark rules that take 朱砂 only `po` and `tomb` may appear; and MCP carries a
`combine` field plus a 【逢合】 header line. 爻之刑 is checked too. Six checks: the base text's six and the fate-reading set of eight are not merged (卯刑午 stands, not 卯刑子, and 未辰相刑 is not split into 未刑丑 and 戌刑未, since merging both sets would make 「how many lines are punished」 meaningless); punishment has a direction (卯刑午 holds while 午刑卯 does not); self-punishing 辰 is always 0 across the sixty-four, fixed by the 纳甲 (辰 only sits in the inner lines and a hexagram has one lower trigram), while 午, 酉 and 亥 all come out and a self-punishing pair is reported only once; the book's case reproduces step by step (寅月申日, 风火家人 changing to 离卦, the month branch 寅 punishing the fifth line's 巳 and the day branch 申 punished by that same 巳, both on one line); the reading does not decide 吉凶 from punishment and checks 「用神休囚」 and 「又兼他爻犯之」 one by one; the hexagram gets a muted 「刑」 mark and MCP carries a `punish` field plus a 【犯刑】 header line. A load-time check sweeps all sixty-four hexagrams across
twelve day branches, twelve month branches and all sixty-four motion patterns, verifying what makes
each of the four paths valid rather than merely whether it fired.
The client tests read the source, since there is no DOM in the test runner.
212 passing.
- This round read the verdict block on the **real page** field by field, one cast per question across
  seven of them. Five named their matter — 事业, 财运, 疾病, 房产 and 出行 came back as 「这份前程」,
  「这笔进项」, 「这桩病症」, 「这处房产或这纸契」 and 「这趟行程或这件失物」. Two left the sentence off
  by design: 「明天的会议会顺利吗」 is simply outside the nine classes, and 「他对我还有没有真心」 is a
  real gap — the 感情 keyword list does not catch that phrasing, so the line disappears rather than
  being filled with something that happens to fit. Adding a word for it means weighing phrasings like
  「公司对我是不是真心的」, so it is recorded here rather than quietly widening the table. The seven
  runs covered 大凶, 大吉, 吉 and 平; the caution appears on every non-平 reading and is absent on 平,
  as coded. In the DOM the block really does precede both columns and the right column no longer
  carries a second copy of the summary. The toss progress is a `role="group"` named 「摇卦进度」 holding a
  `role="status"` 「已摇 0 / 6 爻」, with the bar width and the counter pinned across 0–6.
- One environment note worth keeping: **the in-app Browser on this machine does not deliver clicks.**
  `click` returns `success` / `dispatched: true` and the page does not react — the section tabs do not
  switch, the input keeps its placeholder — and every `ref`-based click reports `STALE_ELEMENT_REF`.
  The page's own JavaScript is alive (setting `document.title` takes effect at once), and timers in a
  background tab really are throttled (`setInterval` goes tens of seconds without a callback). The way
  through is to let the page drive itself: a second same-origin proxy in front of the same server
  injects a driver script into the real page, clicks are fired by that script, and waiting uses the
  `load` event of a deliberately delayed image as the timer, since events are not throttled. Results
  are written into a `<pre>` on the page and the Browser only reads. That path did produce a result
  page from a real click — the check that stayed blocked in the previous round. Casting a second
  time in the same tab sent `POST /cast` and never saw it return; hitting the real server and the
  proxy directly both cast repeatedly in milliseconds, so the stall is the client animation's
  throttled timers, not the server or the proxy.
- Every new assertion this round went through mutation testing: the block's position and the order of
  its seven parts, 宜/忌 and the caution each rendered exactly once, no duplicate summary in the right
  column, no arrow in the fact table, the short word taken only from after the colon; one distinct
  取象 sentence for each of the nine classes with none repeated, none when the class is unrecognised,
  strength following the total score; and the progress bar's width and counter across 0–6. Each was
  broken in turn to confirm the matching test actually goes red — all 17 pinned, and 214 pass with 0
  fail after the script restores the baseline.
- This round moved two decisions out of static analysis and into the model. `divination_cast` gained a
  `topic` enum that the Agent fills in after reading the user's own words; the page still uses the
  keyword table, because on a page there is nobody to read the question for you. Both paths were
  checked: for 「他对我还有没有真心」 the keyword table catches nothing (`detectTopic` returns null and
  the topic sentence is left off entirely), while `topic: love` puts the class, the topic sentence, the
  用神 and the 应期 all where they belong; and for 「这工作该不该跳」, which the keywords *would* have
  filed under 事业功名, an explicit `wealth` wins. A value outside the nine is rejected outright
  (`INVALID_ARGUMENTS`, with "omit it if you are unsure") rather than ignored — silently ignoring it
  leaves the Agent believing it landed. Across five topics the 吉凶 was checked item by item: `label`,
  `score` and the 体用 relation do not move.
- The plain block is that same apparatus with the terminology taken out, not a second opinion. 体卦
  becomes 「你」, 用卦 becomes 「那件事」, and 旺相休囚死 becomes how much force you have right now —
  the three most abstract things in the method. None of 「体卦 / 用卦 / 旺衰 / 类神 / 月令」 may appear
  anywhere in it, checked one by one in the tests. Writing that assertion is what caught 「月令」 and
  then 「旺衰」 slipping into my own copy; it took two passes to get clean. Where the 生克 layer and the
  total disagree (体克用 is 小吉 on 生克 alone, but a 体卦 on death ground drags the total to 平), the
  difference is spelled out rather than left for the reader to suspect a broken calculation. The sample
  response in the README was generated by running the code, not written by hand.
- Every new assertion this round went through mutation testing — all 26 pinned, and 217 pass with 0
  fail after the script restores the baseline. The first run left eight unpinned, and six of those were
  the tests being too soft rather than the mutations being clever: the 旺衰 check only asked whether a
  term had *leaked* and never whether it had been *translated* (pasting the raw 旺 back in stayed
  green); the blank-line check pointed at the wrong function; the ordering check passed with the other
  line deleted, because `indexOf` on a missing string returns -1 and -1 is still less than -1; and two
  places read `.topic.key` directly, which throws a TypeError when the topic is null — and a TypeError
  carries no message, so a keyword-based "is it pinned" check can never match it. Optional chaining
  fixed those two. The other two were faults in the mutations themselves: one left the file a syntax
  error, so the run reported a SyntaxError instead of any assertion, and one edited the *main* block's
  filter rather than `plainBlock`, which has nothing to do with what it claimed to break.
- **The coins path was broken end to end over MCP, and the user is the one who reported it.**
  `divination_cast` with `method: coins` always failed with 「六次掷钱结果必须是 6 到 9 之间的整数」:
  `tossCoins()` performs one toss and returns a `{ sum, coins }` object, while `castByCoins()` wants
  the six results as an array, so the object's `.length` is `undefined` and not one call got through.
  The page route (`server.mjs`) collects six tosses separately and composes them, so only the MCP side
  was affected — the user found it by casting through the engine directly, bypassing MCP. The fix is
  one line. The same read turned up that `castByCoins` does not reject `NaN` or `undefined` (a
  non-number compares false against anything), so a hand-made request quietly composed an all-zero
  坤卦 that looked like a hexagram while nothing had been tossed; `Number.isInteger` closes that too.
- Why earlier rounds missed it: the engine-level `castByCoins` has dozens of tests that all feed it an
  array, and the MCP end-to-end coverage only ever exercised `numbers` — `time`, `daily` and `coins`
  were never called at all. No method had end-to-end coverage. All four are exercised now: the hexagram
  name and order land in 1–64, the verdict is one of the five, the plain block is at the end, and **all
  four must pass the Agent's topic through** (dropping it on one still yields a complete reading, which
  is invisible from outside); coins additionally checks that the 起卦依据 line really lists six tosses,
  and that twelve consecutive tosses do not all produce the same hexagram.
- 「Time casting uses the present 时辰」 now has evidence behind it too: the 「月 · 日」 line in 起卦依据
  is checked against today's date. **Comparing the 月令旺衰 instead does not work** — that comes from
  `buildReading`'s `now`, so passing 1970 to `castByTime` still yields the current month's element and
  both sides agree. The midnight boundary is covered by accepting either the date before or after the call.
- The SKILL gained a step 「起卦前先把这件事问清楚」: casting the moment the user asks produces an
  interpretation that will not attach to their actual situation — abstract and thin, which is exactly the
  failure being avoided. That section, the nine topic keys and 「relay the plain block at the end」 are all
  asserted: it is the Agent's entry point, the repository check only verifies the file exists, and one
  tidy-up edit can remove any of it silently.
- All 14 mutations this round are pinned, and 219 tests pass with 0 fail after the script restores the
  baseline. The first run left five unpinned: two were real gaps (no method was checked for passing the
  topic through, and 「present time」 had nothing to check against), two were wrong expect keywords on my
  side, and one was **an equivalent mutation** — `Array.isArray` is redundant next to the length check, so
  removing it changes no behaviour at all and the knife had to be replaced.
