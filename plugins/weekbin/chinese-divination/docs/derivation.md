# How the reading is derived

What each rule of this package is derived from and how it is applied, including the places where
it deliberately does not follow the looser practice. The README covers what the app does and how
to use it; this is the "why that judgement" behind it.

**起卦 — four ways to cast**
| Method | How it works |
| --- | --- |
| 每日一卦 | Deterministic from today's date, so the same day always yields the same hexagram. |
| 时间起卦 | 年支序 + 公历月 + 日 gives the upper trigram, adding 时支序 gives the lower trigram and the moving line. Best for "right now" questions. |
| 数字起卦 | Two numbers thought of quietly: the first gives the upper trigram, the second the lower, their sum the moving line. |
| 铜钱摇卦 | Three coins, six tosses, from the bottom line up. 6 is 老阴, 7 少阳, 8 少阴, 9 老阳; 6 and 9 mark a moving line. |
**解卦 — reading the result**
The verdict is decided in exactly one place, from a single score. 体用生克 sets the weight —
the trigram holding the moving line is the 体卦 (you), the other is the 用卦 (the matter at
hand): 用生体 is +2, 体克用 and 比和 are +1, 体生用 is −1, 用克体 is −2. The body's 五行
vitality in the current month — 旺相休囚死, measured against the month branch set by the nearest
节 — then adds or takes off a point. A score of +2 or more is 大吉, +1 吉, 0 平, −1 凶, −2 or
worse 大凶. The textbook verdict for the 生克 layer on its own (体克用 reads 小吉, 比和 reads 吉)
is kept and shown as the *reason* next to the total, never as a second answer: the page leads with
one number and explains the two layers that produced it. The 歌诀 reads 「当令者旺，令生者相，
生令者休，克令者囚，令克者死」, where
令 is the month: 旺 same element, 相 fed by the month, 休 feeding the month, 囚 overcoming the month,
死 overcome by it. The 囚 and 死 positions are the pair most easily transposed, so all eight
non-seasonal months are pinned at load time against 《增删卜易·四时旺相章》 — read it as 令 in 寅月
and 寅月 gives 木旺, 火相, 水休, **金囚, 土死**. The four 四季土 months are deliberately left out
of that check: the same chapter adds a refinement there (a branch clashing the month counts 休囚,
the other keeps 余气), and it does not say which of the five states the 余气 side falls into, so
following it would mean guessing. 旺相 in 辰戌丑未 months is computed from the plain table.
**How often each method changes**
This is worth stating plainly, because the four methods do not refresh at the same rate:
| Method | Refreshes | Same result again if you… |
| --- | --- | --- |
| 铜钱摇卦 | every toss | never — coins are random |
| 数字起卦 | whenever you change the two numbers | reuse the same numbers |
| 时间起卦 | every 时辰, i.e. every two hours | cast again inside the same 时辰 |
| 每日一卦 | once a day, at midnight | cast again on the same date |
That is the method working, not the app repeating itself. Every reading therefore states its own
cadence on the card: the current basis, the next change, and — for the two time-based methods — the
hexagram the next change will produce, so you can watch the cycle rather than guess at it.
**所问何事 — the question picks the topic and the timing**
The question you type above the methods is matched to a **topic**, and the topic carries a **类神
element**. This is what lets the same hexagram read differently from one hour to the next:
| Topic | 类神 element |
| --- | --- |
| 财运 | 金 |
| 事业功名 | 火 |
| 感情 | 水 |
| 婚恋 | 木 |
| 疾病 | 土 |
| 学业文书 | 木 |
| 房产车契 | 土 |
| 官讼是非 | 金 |
| 出行寻物 | 水 |
**The 类神 changes the timing and the imagery, never the verdict.** 吉凶 stays exactly where
体用生克 and the month's vitality put it, so the same hexagram asked about money and asked about
marriage cannot flip from 凶 to 吉 — only the 应期 months and the 取象 emphasis move. When no topic
is recognised, nothing is forced: the timing falls back to the 用卦 and says so.
> This element-to-topic table is **this package's own convention**, not a transmitted one. Plum
> Blossom has no 六亲 用神 the way 六爻 divination does, so 京房's 六亲 and 纳甲 are given as a
> separate layer (see 「京房一层」 below) and never rewrite the 体用 verdict.
**Fifteen sections, every time**
卦象总断, 动爻爻辞, 体用关系, 旺衰应期, 卦气 for the month's governing hexagram, 互卦 for the
middle course, 变卦 for the outcome, 错卦 for the other side, 综卦 seen from the other position,
六亲世应, 用神, 主客, 取象 of both trigrams, 爻位 for the moving line's position, and 方所 for the
后天八卦 directions. A recognised topic adds one more, 所问之事, naming the topic, its 类神, and how that
element stands to the 体卦.
Three more come and go with the reading. 暗动 · 日破 · 冲散 appears only when the day's branch really
does clash a line. 化爻 · 变出之爻 appears whenever anything moves. 六冲 appears when the hexagram
itself is 六冲 or 六合, or the changed one is, or a moving line clashes its own transformed line. So a
reading runs seventeen to twenty-two sections.
**动爻爻辞 — the line that actually moved**
卦辞 states the whole hexagram's tendency; the 爻辞 states the situation on the line that moved,
which is the one your question lands on. All 384 are stored, and the reading quotes the moving
one's under the 本卦 — one line, not six, because six would bury the hexagram. 爻题 follows the
traditional form (初九、六二、上六) and the 九 / 六 always agrees with whether that line is 阳 or 阴;
the tests check all 384 against the hexagram diagrams, so a line that drifts out of place fails
the suite.
**动爻象传 — why that line reads that way**
The 爻辞 is the judgement; the 小象传 is the ground for it. All 384 are stored too, and the
reading prints the moving line's underneath its 爻辞 in smaller type and appends it to the same
断语 section — one place, not two. Cross-checking two editions turned up places where they
disagree with each other and, in two spots, with the received text: 大有九四 needs 尫 (both
editions print 彭, which the 爻辞 does not), and 困六三 splits across them — 蒺藜 from one,
不祥 from the other. Those are pinned by tests, along with 需九五's 「酒食贞吉」, which the
second edition expands to 「需于酒食」 against every other source.
Two spellings that are easy to "simplify" away are pinned by tests: 损's 已事遄往 keeps 已
(already) while 革's 巳日乃革之 keeps 巳 (the sixth earthly branch), and 噬嗑's 噬乾胏 borrows 乾
for 干 while 乾卦's 终日乾乾 means something else entirely.
**彖传 — why this hexagram is shaped this way**
The 卦辞 says what the hexagram is; the 彖传 says why. There is one per hexagram, all 64 stored,
printed between the 卦辞 and the 象辞 and set in a lighter tone behind a left rule to mark that it
is commentary rather than the hexagram's own voice. The long ones run to a hundred characters or
more: 乾's walks from 「大哉乾元」 to 「万国咸宁」, unpacking 元亨利贞 one step at a time.
Cross-checking two editions turned up ten substantive differences; nine take the base text. 蒙's
「初筮告」 (the other edition prints 「初噬告」), 小畜's 「健而巽」 (missing from one edition), and
革's 「革而信之」 with 「巳日乃孚」 all agree with the 爻辞. The tenth is 乾 itself: the two
editions give 「保和大和」 and 「保合太和」, and the received text reads 太和. Each ruling is pinned
by a test, as is the traditional-to-simplified mapping, which is derived rather than recalled: a
simplified source is aligned position by position against the traditional base, only agreeing pairs
are kept, and three false pairs produced by source typos are then removed by hand.
**The three seconds of casting — how the hexagram forms**
Press a method and the trigram ring turns while the derivation types out line by line. The six
lines used to appear only in the result, unrelated to what the log was saying; now the hexagram
body grows with the derivation, one line at a time from the bottom. **The moving line is marked
only after all six are in** — marking it early gives the answer away, and the whole point of
casting is that the hexagram forms first and only then the moving line is settled. Timing is
covered statically: the wait must not be shorter than the typing budget, and six lines at the
minimum interval must still fit inside it, so 「the typing finished but the diagram did not」 cannot
slip through. With reduced motion on, all six appear at once.
**The four derivations — where 互, 变, 错, 综 come from**
The reading says 「互卦为XX」 and leaves the derivation invisible. This puts the cast hexagram on
one row and the four derived ones below, each arrow labelled with how it is taken: 互 takes lines
2-3-4 as the lower trigram and 3-4-5 as the upper; 变 flips the moving line; 错 inverts all six;
综 reverses their order. In 变, the line that actually moved is vermilion, so 「that one changed」 is
visible rather than stated. The four are not four parallel conclusions but four directions onto one
question. The derivations are themselves under test — 互 really is 2-3-4 and 3-4-5, 错 really
inverts, 综 really reverses, 变 moves only what moved — so a wrong line in the diagram fails the
suite.
**京房一层 — 六亲, 世应, 纳甲**
A layer that runs beside Plum Blossom rather than inside it. Plum Blossom takes the trigram holding
the moving line as the 体 and reads **me against this matter**; 京房 takes the palace and the
generation to read what each of the six lines *is* — which line is me (世), which is the other party
(应), and which person's what each line is under the five phases. The two answer different questions,
so 世应 belongs to 京房 and the Plum Blossom section is called 主客: two different 世爻 positions in
one reading is simply confusing.
The eight palaces and their generations come from the 《京氏易传》, and this package **derives them
rather than transcribing a table**: change the first line for 一世, the first two for 二世, the first
three for 三世, the first four for 四世, the first five for 五世; flip the fifth-generation hexagram's
fourth line back for 游魂; then draw 游魂's lower three lines back for 归魂. The derived result is
checked against the transmitted palace order hexagram by hexagram, and all sixty-four match. 归魂 is
the clause people get wrong — it returns 游魂's *lower* three lines, so relative to the palace hexagram
only the fifth line differs. Written as "flip the fourth and fifth", the 归魂 column of all eight
palaces silently becomes another palace's 二世 hexagram, and a test pins that on its own.
纳支 follows the 纳支歌诀 that has been in use for two thousand years (乾金甲子外壬午、坎水戊寅外戊申、
艮土丙辰外丙戌、震木庚子外庚午、巽木辛丑外辛未、离火己卯外己酉、坤土乙未外癸丑、兑金丁巳外丁亥),
checked line by line. **The branches follow the trigram, not the palace**: 山水蒙 belongs to 离宫
(a 阴 palace), but its lower 艮 and upper 坎 are both 阳, so all six of its lines take 阳 branches. The
六亲 take the palace's own element as "me" — what generates me is 父母, what I generate is 子孙, what
overcomes me is 官鬼, what I overcome is 妻财, and my own element is 兄弟; the element comes from the
branch, not from the 纳音.
世爻 sits on the first line for 一世, the second for 二世, and so on, on the top line for a pure
palace hexagram, the fourth for 游魂 and the third for 归魂. 应爻 **pairs** with it three positions
away: 1 with 4, 2 with 5, 3 with 6, and back round. Taking that as a plain "世 + 3" sends a pure
palace hexagram or a 五世 hexagram to the eighth or ninth line, which do not exist — a test pins
exactly that.
On the hexagram itself, the 纳甲 column sits to the right of the bars: 干支 fixes the element, 六亲
fixes the identity, and 世 and 应 each get a red box. The reading gains a 六亲世应 section naming the
palace and generation, who the 世 and 应 lines are, how they stand to each other, and which 亲 the
moving line falls on — with what each 亲 covers. The 变卦 gets its own palace and generation; it never
inherits the 本卦's.
**八宫名单 — the eight slots of one palace**
The hard part of the 京房 layer is not which palace you are in; it is the **order** of the eight
hexagrams inside that palace. 一世 through 五世 walk the 世 line up one line at a time, which reads
like a ladder — and then 游魂 and 归魂 walk it back down (世 on the fourth and third line) while still
being called 世. Written out as "离宫一世卦", nobody would guess the ladder has two rungs that run
backwards.
So all eight are laid out in one row, ahead of the four derivations — settle which palace and which
rung you are on before looking at how 梅花 derives anything. Each slot is a small hexagram marking the
lines it flips relative to the palace's pure hexagram, in 朱砂. The 朱砂 box is your hexagram, and the
generation is written under it. 游魂 and 归魂 have their generation in bold: they are the two
exceptions on that ladder, and without it the row reads as six of a kind.
Your own hexagram can itself be the 游魂 or the 归魂 — sixteen of the sixty-four, a quarter of all
casts. That slot carries both marks at once, and 朱砂 wins over the bold: box and text both 朱砂, so
you can tell at a glance that it is yours *and* that yours is one of the exceptions.
No 世 line is marked on the small hexagrams. The 世 is already boxed in 朱砂 on the hexagram to the
left, and marking it again here would be a second account for the reader to reconcile. This row is
about order only.
The row is not a copied table. It is derived from the palace's pure hexagram by each generation's
flips, so it comes out of the same derivation as the palace and generation themselves — which is why
every slot's name and position matches the received ordering, all sixty-four of them. The whole roster,
including each slot's flipped lines, is frozen: the eight hexagrams of one palace read the same array,
so editing it after looking at one palace's row would silently feed the edit to every other hexagram
in that palace, with nothing on screen to show where it came from.
**用神 — which line your question falls on**
The 六亲 sit there until a question points at one of them. The first step of 六爻 reading is 取用神:
ask what this is about, take that 亲 as the 用神. This one **has transmitted rules behind it**, unlike
the element-to-topic table above, which is this package's own convention.
| The question | 用神 | Source |
| --- | --- | --- |
| 财运, 买卖, 失物 | 妻财 | the 财 line is what the querent can actually get hold of |
| 事业功名, 官司 | 官鬼 | 官鬼 is the post, the boss, the legal action; if you overcome 官鬼 you win |
| 学业文书, 房产车契 | 父母 | 父母 is documents, grades, licences, contracts |
| 感情, 婚恋 | 妻财 (male querent), 官鬼 (female querent) | 《增删卜易》: 男测婚以财为用，女测婚以官为用 |
| 疾病 | 官鬼 for the illness, 子孙 for the remedy | 子孙 overcomes 官鬼; a strong 子孙 means the illness recedes |
| 出行寻物 | 妻财 | the thing sought counts as 财; to seek a *person* you pick by the relationship, which this package will not guess for you |
Two deliberate restraints:
- **婚恋 is gender-dependent and this package will not guess the querent's gender**, so both 妻财
  and 官鬼 are reported and the querent picks the one that applies. Picking for them would be
  deciding their gender for them.
- **占病 takes two lines** (the illness and the remedy) and likewise reports both without choosing
  between them. Choosing would be reading their illness for them.
The line-picking order is deliberately reduced to two steps: **a moving line first, otherwise the one
nearest the 世爻**. Transmitted practice is finer — if both move take the stronger one, if both are
still take the stronger or the one at 世/应 — and it also weighs the day branch, the void, and the
tomb. This package has none of those inputs, so it does not invent a rule that looks complete and
cannot be checked. "Nearest" is the plain distance in line positions.
When no 用神 appears on the hexagram at all, tradition takes the **伏神** — and that is a real
rule with a source, so this package follows it. 《增删卜易·飞伏神章第二十八》:
> 若用神不现，即以日月为用神，倘日月非用神者，则于本宫首卦寻之，因本宫首卦，父子财官六亲
> 俱全之故耳。
The position rule that follows: find that 六亲 in the **palace's first hexagram**, and it hides
under the same line of the hexagram you are reading. Whatever sits on that line is the **飞神**.
The book works two examples and this package reproduces both to the character — 天风姤 with 妻财
hidden under 亥水, and 天山遁 with 子孙 hidden under 辰土.
How the two relate is named four ways, and each carries its own meaning:
| Relation | Reading |
| --- | --- |
| 飞来生伏 | the line on top feeds the one below; favourable |
| 伏去生飞 | the hidden one spends itself upward; effortful, slow return |
| 伏来克飞 | the hidden one kicks the cover aside; sudden, and mostly bad |
| 飞来克伏 | the line on top pins the one below; suppressed, cannot come out |
Whether it can **emerge** is the follow-up question. 《增删卜易》 lists six conditions for usefulness
and five for never emerging, and this package now checks **all of them** — 旬空, 月破 and 入墓 were
added once their tables were in hand, so nothing here is left unsaid. What comes out is always
出得来 or 出不来: 旺衰 runs 旺相休囚死 with no sixth state, so 旺相 always lands in the first list
and 休囚死 always in the second, and the two between them cover every case.
On the diagram the 用神 line carries a **solid red badge**, against the outlined 世/应 boxes; a
伏神 sits under its line as smaller dashed text reading 「伏 丙子水妻财」.
**元神 · 忌神 · 仇神 — the circle around the 用神**
Picking the 用神 is only the first step. 《增删卜易》卷之一·用神元神忌神仇神章第九 gives the rest
with a worked example, and the reading follows it clause by clause:
> 元神者，生用神之爻，即为元神。忌神者，克用神之爻也，即为忌神。仇神者，克制元神不能生用神，
> 反生忌神而克害用神，即为仇神。假令金为用神，生金者土也，土为元神；克金者火也，火为忌神；
> 克土生火者木也，木为仇神。余仿此。
All three sit in this hexagram's six lines, none of them is borrowed from outside:
| | Which line | Reads as |
| --- | --- | --- |
| 元神 | the line that 生 the 用神 | helps feed the 用神 |
| 忌神 | the line that 克 the 用神 | strikes the 用神 |
| 仇神 | the line that 克 the 元神 | indirect — see below |
野鹤 says what to look at next, and the reading reports exactly that per line — which 爻, 动 or 静,
and its 旺衰 under the month:
> 既得用神，須看旺衰否？有元神動而生扶否？有忌神動而克害否？
**仇神 does not strike the 用神 directly**, and the wording is careful about that: it pins the
元神 so the 元神 cannot feed the 用神, and it feeds the 忌神 instead — help on both counts. Saying
「仇神克用神」 would be a misreading of how the mechanism works. All three are fixed test
invariants: the 仇神 must 反生忌神 and must not 生用神, in all five cases.
A line the hexagram simply does not have is reported as such — 六爻 carry eight 地支 and the five
elements rarely fill out, so the reading says 「本卦六爻里没有这一行」 instead of borrowing one.
The circle exists only when a single 用神 has been settled: a 用神 that went to the 伏神 is off the
board, and 婚恋's two candidates are two questions at once, so neither gets a circle.
And one line from the same chapter this package takes to heart:
> 勿以仇神即仇人也
The 仇神 is a position in the five-element scheme, not a person in the reading. The source is blunt
about it: whoever it calls the enemy is someone else — an 应爻 that 克 the 世爻.
This also fills in something the 回头克 rule had been quoting without computing:
> 凡遇回頭剋者,徹底剋盡,原用二神遇之則凶,忌仇二神遇之反吉也
Once the circle is known, the reading can say which of the four the 回头克 actually lands on — 凶 on
the 用神, 不作凶论 on a 忌神 or 仇神, and for 元神, where the text says nothing, it says so rather
than filling the gap. Each case has its own test: a 回头克 falling on the 元神 must *not* come out
judged, and one with no circle at all must not borrow the clause.
On the diagram each of the three sits on its own line as a small outlined tag reading 元, 忌 or 仇;
忌神 gets the red outline, since it is the one actually striking the 用神, while 元神 and 仇神 stay
in the muted tone of the 伏神.
**暗动 · 日破 — the still line that starts moving today**
The circle above leaves a question open, and the same chapter that posed it answers it four
chapters later. After listing 元神, 忌神 and 仇神, 野鹤 asks:
> 既得用神，須看旺衰否？有元神動而生扶否？有忌神動而克害否？
"Is the 元神 moving to feed it? Is the 忌神 moving to strike it?" — and the answer needs a third
kind of movement, from 《增删卜易》卷一·暗动章第二十二:
> 靜爻旺相日辰沖之爲暗動，靜爻休囚日辰沖之爲破。
One sentence, two halves. A **still** line clashed by the day's branch is 暗动 when it is 旺 or 相,
and 日破 when it is 休, 囚 or 死. Not an edge case: across the sixty-four hexagrams over all twelve
months and days and every combination of moving lines, about **24%** of readings have at least one
such line — 10% 暗动 and 14% 日破 — and 42% of all clashed still lines are 暗动 rather than 日破.
Until now this package treated every still line as simply still,
so 「忌神暗动克害用神」 and 「元神暗动生扶用神」 — the two things the chapter is actually about —
could never be reported at all.
| | Source | How it is worked out |
| --- | --- | --- |
| 暗动 | 《增删卜易·暗动章第二十二》 | Still line, the day's branch clashes it, 于月建旺 or 相. |
| 日破 | same chapter, second half | Still line, the day's branch clashes it, 于月建休, 囚 or 死. |
The chapter number is **第二十二**, per the volume-one table of contents and the transmitted page
heading. Some secondary sites label it 025 — that is the whole-book running order, not the chapter
number within the volume, and is not followed here.
Only **still** lines qualify. A clashed line that is already moving is 冲散, which belongs to
动散章第二十三 and is covered in the next section; the two are kept apart, and a test pins that a
clashed line drops out of both lists the moment it starts moving.
旺衰 has five states and the split is exhaustive, so there is no third case and no "cannot tell"
fallback. Two structural facts fall out and are checked rather than assumed: the day's branch can
clash only one branch, and when two lines share a 纳支 (22 of the 64 hexagrams do, e.g. 水雷屯's
first and top lines are both 子) they share the element, hence the 旺衰, hence land on the **same**
side of the split — a reading never has both 暗动 and 日破.
**Three places this package deliberately does not follow the looser practice.** The chapter's own
worked example is the reason; the reading is stricter than the example:
> 即如寅月乙未日占女痘得坤之師卦…二爻巳火動而克金，得未日沖動丑土，土動生金
That is 坤为地 with the second line moving, 巳火 striking the 用神 酉金子孙, and the 未 day
stirring 四爻丑土 so that earth feeds the metal. But 丑土 in 寅月 is not 旺相 — it is 死 — so by the
chapter's own wording this line is 日破, and the example uses it as a rescue anyway. What rescues it
in practice is that 巳火 is a moving line and 火生土, i.e. the *static* line has 动爻 support. That
is a reasonable refinement and later writers adopt it, but it is not what the chapter says, and
patching an example into the definition would be changing a 通例 by a 个例. This package keeps the
stated definition and says so here. The test reproduces the whole example step by step — 坤为地,
世 on the top line, 应 on the third, 二爻 moving to 地水师, 未 clashing 丑, 丑土 in 寅月 falling to
死 — and pins it as 日破, so that if someone later widens the rule to match the example, the test
tells them plainly that the definition and the example now disagree.
The 忌 half carries a variant. The received text reads 「若遇忌神克害用神」 without 暗动; most later
commentators read 「忌神暗动克害用神」. This package takes the reading **with** 暗动, because the 喜
half right above it does say 暗动 — 「得元神暗動以相生」 — and the chapter is titled 暗动 and opens
by saying 「暗動者有喜有忌」. One further half-sentence in the same passage, 「忌神明動於卦中，得
元神暗動而生用神」, is self-contradictory: a 忌神 克 the 用神 by definition and cannot feed it. The
transmitted text and most later editions leave it uncorrected, and nothing here is built on it.
The reading reports the whole chain: which lines are 暗动, which is which of 元 / 忌 / 仇, and then
the chapter's own two verdicts — 元神 暗动 feeding the 用神 is 喜, 忌神 暗动 striking it is 忌. Two
things it refuses to do. If the 用神 is not settled there is no circle and no verdict is attached.
And both verdicts are written under a 「用神休囚」 premise, so when the 用神 is 旺 or 相 the reading
says that premise does not hold instead of applying them anyway. A 仇神 暗动 gets neither: the
chapter divides 喜忌 between 元神 and 忌神 only, so it says the text does not cover that case.
野鹤 refutes the common saying in the same chapter, and the reading quotes both halves:
> 占以暗動福來而不知，禍來而不覺。
> 吉凶之應於動，有急緩之應，則緩非此論，何當不知不覺，報應亦非緩也。
暗动 is therefore not read as slow. On the diagram 暗动 is a small 暗 mark and 日破 a small 日破,
in the same slot as 空 / 破 / 墓. 日破 takes the red of the 月破 it belongs with; 暗动 stays muted,
because its 吉凶 depends on whether the line happens to be the 元神's or the 忌神's, and a single
cell in the diagram does not know that. The 野鹤 exchange above is printed only when a 暗动 is
actually found — it answers the saying about 暗动 being slow, so quoting it in a reading that has
only a 冲散 would be off-topic.
**冲散 — the moving line the day clashes**
The very next chapter, 《增删卜易》卷一·动散章第二十三, opens with the rule in one line:
> 占以日辰而沖動爻，謂之沖散。
A **moving** line clashed by the day's branch is 冲散. It is the third way the day's clash lands, and
it is commoner than the other two put together: across the same sample, **24%** of readings have one,
against 10% 暗动 and 14% 日破. At 1.05 lines per reading, and never more than two.
The three are kept strictly apart. A line is sorted by whether it is moving first and by 旺衰 second,
so no line can ever land in two of them, and a clashed moving line is never also called 暗动 or 日破.
暗动 and 日破 are additionally mutually exclusive on their own, for a reason already given: two lines
sharing a 纳支 share an element, hence a 旺衰, hence the same side of the split.
**The chapter's own conclusion is that it does not disperse.** 野鹤 does not simply define the term,
he then reports testing it:
> 予屢試之，旺相者沖之不散，有气者沖之不散，休囚者間有沖散，亦千百中之一二也。
旺 or 相 lines survive the clash; 休 or 囚 lines mostly do. Even those only scatter "once in a
thousand or two". He closes by pointing at where the omen actually lives: 「神兆機於動，動必有因」 —
the mechanism sits in the movement, and movement has a cause. So the reading **reports the fact and
does not turn it into a verdict**. Where a clashed moving line is 旺 or 相 it says so and quotes 「旺相者沖之不散」; in no case does it call the line weak today and pronounce bad news, and a test pins that — mutating the sentence into 「该爻今日无力，凶」 turns the suite red.
**The exemption that came from elsewhere.** 《易冒·日冲章》 narrows the rule with four characters:
> 如動爻遇日辰相沖，苟非月建，則謂之散。
「苟非月建」 exempts the month's build: a moving line clashed by the **month**, not the day, is not
冲散 — that case is 月破 and already has its own section. So 冲散 is decided by the day's branch
alone. A test holds exactly that, and holds it in the form that could fail: across all twelve months
under one day's branch, the set of 冲散 lines never changes, and a line clashed only by the 月建 never
appears in it.
**One part of the chapter is not implemented, deliberately.** 「有气者沖之不散」 names a third state
— 有气 — and the chapter does not say which of the five 旺衰 states it corresponds to. 《四时旺相章》
has a clause giving the branch clashed by the 月建 the weaker 休 or 囚 and leaving the others with
their 余气, but it does not say where the 余气 lands. Guessing would be inventing a 通例, so only the
旺相 and 休囚 halves are read. 爻动 clashing another 爻 is a separate judgement about which of the two
is stronger and is likewise not attempted.
On the diagram 冲散 is a small 冲散 mark in the same slot as 空 / 破 / 墓 / 暗 / 日破, and it stays
muted with a tooltip giving the rule — no red, because the chapter's finding is that the line does
**not** come apart. Inside the 用神 circle the state is a fourth tier, 「动而逢日冲」, sitting beside
动, 暗动 and 静: earlier the reading only distinguished moving from still, so a 用神 that was itself
being clashed apart was reported as simply 动. The two sections that mention it — the 用神 circle and
the 用神 line of the 断语 — now take their wording from one shared helper, so they cannot drift apart.
**六冲 · 六合 — the clash that belongs to the whole hexagram**
Everything above is a clash the **day's branch** brings to a single line. The chapter right after
动散章第二十三 is about a different kind entirely: a clash built into the hexagram itself.
《增删卜易》卷一·六冲章第二十 opens by naming the six branches that clash, then counts the ways:
> 子午相冲、丑未相冲、寅申相冲、卯酉相冲、辰戌相冲、巳亥相冲。相冲之法有六：日月冲爻者一也，
> 卦逢六冲者二也，六合卦变六冲者三也，冲变六冲者四也。动爻变冲者五也，爻与爻冲者六也。
The first way is the day's and month's branches against a line — already computed, line by line, in
暗动章第二十二 and 动散章第二十三. The other five are what this section adds. 「冲变六冲」 is how
the base text reads the fourth; 明天机一系 writes it out as 「六冲卦变六冲」, meaning the same thing
(the hexagram that comes out is also a 六冲卦), and this package uses the expanded wording.
**The pairing is 初四、二五、三六 — and getting it wrong finds nothing.** 纳甲 loads the inner three
branches at positions 1–3 and the outer three at 4–6 from an offset of one, so 乾 carries 子寅辰 inside
and 午申戌 outside: the counterpart of a line is three places away, not at the same height. Pair them
the naive way and not one of the sixty-four hexagrams comes out 六冲. With the right pairing there are
exactly **ten** 六冲卦 and **eight** 六合卦, matching the transmitted lists name for name:
| | which | names |
| --- | --- | --- |
| 六冲卦 | eight 八纯卦, plus the two 乾/震 crosses | 乾为天、坤为地、天雷无妄、坎为水、离为火、雷天大壮、震为雷、艮为山、巽为风、兑为泽 |
| 六合卦 | — | 地天泰、天地否、雷地豫、山火贲、地雷复、泽水困、火山旅、水泽节 |
乾 and 震 load the same branches, which is why 天雷无妄 and 雷天大壮 are 六冲 too. The lists are
re-derived from 纳甲 and checked against these names when the module loads, so a wrong 纳甲 table
throws rather than quietly reporting a different set.
**One pair proves three.** The received rule says 「这三组，只要有一组相冲，其他两组必定相冲，
一看就知」. That is not an observation, it is forced: the six branches are one sequence translated,
six clash partners split the twelve into disjoint pairs, and each branch has exactly one. So one hit
means three. A test holds that for all sixty-four hexagrams, and the module-load check refuses to
start if it ever stops holding.
**爻与爻冲 is not 六冲卦.** Any two lines clashing inside one hexagram happens in 30 of the 64 — twenty
of them are not 六冲卦 at all. A 六冲卦 is the whole structure, all three pairs; an incidental clash
is a local fact. Conflating them would call a third of the hexagrams 六冲. So the reading reports
those pairs without ever raising them to that, and it does not open a section for them alone.
**The chapter's verdicts, and what this package refuses to decide.** 冲 is 散, and 散 helps a bad
matter and hurts a good one — but the chapter immediately qualifies itself with 「亦必兼用神而言，
用神若旺，虽冲不碍；用神失陷，凶而又凶」. That half is decidable and the reading applies it: with the
用神 settled it says 旺 or 相 leaves the clash harmless, 休 囚 死 makes it harmful, and if the 用神 is
not settled it says the layer does not apply. Two halves are quoted and not applied. Whether the
matter asked about is a 吉事 or a 凶事 is the querent's own framing, not something a question string
carries, so both halves are put on the table and neither is chosen. And 「近病逢冲即愈，久病逢冲则
死」 turns on whether an illness is recent or long-standing, which only the person asking knows, so
占病 gets the rule quoted and no side picked. The one conditional the reading *can* join up is the
last half of 「惟占官非、盗贼、结绝事者宜之」: when the question has been recognised as 官讼是非,
that half applies and the reading says so. When it has not, it says the matter is not of that kind
rather than re-judging it.
The chapter also writes the pattern up hard in both directions — 六合变六冲 as 「先合后离、先亲后疏、
先浓后淡、始荣终悴、得而复失、成而后败」, and 六冲变六冲 as 「内外变动，交相冲击，必主上下不和，
至亲反目，彼此怀奸，始终不就」 — and then in the same breath refuses to decide the hexagram:
> 古以六冲卦，诸占不吉。予屡试之，用神失陷，实不为吉；用若得地，须以用神断之。
So a 六冲卦 on its own is not bad news, and this package does not colour it as such: on the diagram
the 六冲 and 六合 marks are thin and muted, never red.
**The pairing, drawn.** 「初四、二五、三六」 is the one rule in this chapter that is easier to see
than to read. Pair the lines at the same height and not one of the sixty-four hexagrams comes out
六冲; pair them three apart and the ten and the eight fall out on their own. So the diagram draws
it: three thin arcs in the margin, each joining one pair, bowing away from the hexagram. They show
the thing the prose keeps having to insist on — the two branches that come together are always
three rows apart, never side by side.
The arcs sit in the gutter between the two columns, not in the hexagram. That is deliberate and it
cost something to find: the bars are a `1fr` track, so any width reserved for the arcs comes straight
out of them, and on the 变卦 the row carrying 回头生 + 应 + 六亲 + 干支 is already the widest — one
reserved column wide enough for the arcs and that row's bars collapse to nothing, at which point the
line no longer reads as 阴 or 阳 at all. Putting them in the gutter costs the diagram nothing.
There is no label on the arcs. The three pairs are already spelled out in the right-hand 卦体冲合
row, and a second copy to check against the first is a second thing to get wrong. Each arc carries a
`<title>` naming its two branches, which is what a screen reader and anyone reading the source get.
The arcs appear on eighteen hexagrams and on no others, because the three pairs come out either all
clashing or all not: the ten 六冲 and the eight 六合, and the remaining forty-six draw nothing at all.
There is no hexagram that clashes on one pair only, so there is no case for drawing a single arc —
and the module-load check now holds that, not just 「one pair implies three」.
**爻之合 — 合起, 合绊, 合好, 化扶**
The 六冲/六合 section above is about the hexagram as a whole. The 六合 chapter has a second layer
that lands on single lines, which this package had not implemented until now.
The chapter states 「相合法有六」, and the six divide in two: the last three (卦逢六合, 六冲变六合,
六合变六合) are whole-hexagram structures, already computed and already drawn as the three arcs
beside the hexagram. The first three (日月合爻, 爻与爻合, 爻动化合) land line by line.
「爻之合者，静而逢合，谓之合起；动而逢合，谓之合绊；爻与爻合谓之合好，爻动化合谓之化扶」 —
the four names follow from the line's own motion and from where the combination comes from:
| Name | When | The book's words |
| --- | --- | --- |
| 合起 | a still line combines with the day's or the month's branch | 「得合而起，即使爻值休囚亦有旺相之意」 |
| 合绊 | a moving line combines with the day's or the month's branch | 「动逢合而绊住，反不能动之意」 |
| 合好 | two lines combine, and **both are moving** | 「乃得他来合我，与我和好相助之意」 |
| 化扶 | a moving line's transformed line turns back to combine with it | 「得他扶助之意」 |
合好 carries an explicit limit: **「但有一爻不动，亦不为合」**. So a still line combining with a
moving one is not counted as 合好. A later sentence in the same chapter, 「爻静或与日月动爻合者」,
is punctuated two ways; read as 「与日月、动爻合者」 it would let a still line combine with a moving
one, which contradicts the sentence above. This package takes the reading that can be checked and
leaves the conflicting branch out, with the reasoning recorded in the code rather than papered over.
合好 only takes pairs other than 初四, 二五, 三六 — those three belong to 卦逢六合 and are already
drawn beside the hexagram, and listing them again here would be a second account to reconcile. Twenty
of the sixty-four have such a further pair (雷火丰 pairs its first 卯 with its top 戌, 山泽损 pairs
二四 and 三五), and 合好 is what fires on those.
**This layer does not decide 吉凶, and that is the book drawing the line itself.** Three places in
the chapter say so: 「然必用神有气相宜，用若失陷无益」, 「用神受克，六合有何益哉」, and at the very
end 「宜合吉，不宜合凶」. So the reading reports the relation and the name only; the verdict stays
with 用神 vitality. The 「合」 mark on the hexagram is muted like 暗动 and 冲散 and never takes 朱砂 —
colour should not speak for something whose 吉凶 has not been settled.
Measured over 365 days × 256 toss patterns (93,440 readings): about **81%** produce this section;
合绊 52%, 化扶 30%, 合起 29%, 合好 16%, averaging 1.97 combined lines per reading and at most all
six. 合起 and 合绊 both appear in the same reading about 12% of the time (one still line lifted while
another moving line is held).
**爻之刑 — 犯刑**
三刑章第二十一: 「寅刑巳、巳刑申、子刑卯、卯刑午、丑戌相刑、未辰相刑。又云：辰午酉亥谓之自刑。」
**The base text's six, not the fate-reading set of eight.** They differ in two substantive places: the
base text has 卯刑午, not 卯刑子, and it has 未辰相刑 as one entry rather than splitting it into
未刑丑 and 戌刑未. The eight touch 48 of the sixty-four; the six touch 28. Merging both sets into
fourteen would leave 「how many lines are punished」 without an answer, so the variant reading is recorded
here and kept out of the table.
**Punishment has a direction.** 丑刑戌 comes out on twelve hexagrams, 卯刑午 on eight. The direction is
carried through as it stands — who punishes whom — and never folded into a flat 「this line is punished」,
because folding it away loses the only thing that says who acted.
**Of the four self-punishing branches, 辰 can never come out on the line-to-line path.** That is not an
oversight but a structural fact: 辰 only sits in the three inner lines (乾 carries 子寅辰, 坎 carries
寅辰午, 艮 carries 辰午申), and a hexagram has one lower trigram, so at most one 辰 appears and
本支见本支 cannot be formed. 午, 酉 and 亥 all come out (8, 6 and 8 hexagrams). The 辰 branch is not dead
either — when the month's branch is 辰 and a 辰 line is present, 「月建自刑辰爻」 holds, and 4.2% of
readings over 365 days take that path. The load-time check pins 「self-punishing 辰 is always 0 on the
line-to-line path」 so nobody later adds it back as an apparent omission.
All three paths are reported: line against line, 本支见本支 self-punishment, and the day or month branch
against a line. Self-punishment is symmetric, so a pair is reported once; collecting it from both
ends would put 「二爻亥自刑四爻」 and 「四爻亥自刑二爻」 side by side, which reads as two separate
things. The six directed pairs are unaffected. The book's own case reproduces step by step — 寅月申日, 风火家人 changing to 离卦: the
month branch 寅 punishes the fifth line's 巳, and the day branch 申 is punished by that same 巳. Both
land on one line, which is the 子孙 line.
**This layer does not decide 吉凶, and here the book draws the line itself.** 「夫三刑者，予屡试之，
或因用神休囚又兼他爻犯之，刑者则见凶，而独犯三刑得验者少，占过数十年只验得一卦。」 Ye He tried it
himself for decades and it verified on a single reading. So the reading reports who punishes whom and
then checks the two preconditions — 用神休囚 and 又兼他爻犯之 — one by one, saying plainly whether each
holds; the verdict stays with 用神 vitality. The 「刑」 mark on the hexagram is muted, like 「合」, and
never takes 朱砂.
Measured over 19,800 readings by the numbers method: about **90%** carry this section. A separate sweep of
the sixty-four hexagrams across 365 days (23,260 readings) gives 90.7%, and the two agree. Of those, 58%
come from the line-to-line path and 80% from the day/month path, averaging 1.05 punished lines per
reading and at most three.
**What is deliberately not here.** 卦身 and 世身 appear on most traditional charts, and this package
draws neither. Not an oversight: 《增删卜易》 is the base text here, and removing them is stated as
one of the book's own features — 「删除卦身世身、星煞本命，使人无歧路之虞」. 《卜筮全书》 and
《卜筮正宗》 record the terms without using them, 韩艺's 连三易 leans on 世身 heavily, and later
writers split three ways. A package that follows 《增删卜易》 as its spine and adds a layer the spine
deleted would be arguing with its own source. The rules are recorded here for anyone who wants them
— 阳世从初爻起子、阴世起午，数至世爻那一支便是卦身; 世身按世爻地支定爻位（子午居初、丑未居二、
寅申居三、卯酉居四、辰戌居五、巳亥居六）— but they are not drawn and not used to judge anything.
**反伏与卦变 — the two ends of the same thing turn over**
反伏章第二十五 puts two things side by side from its first line, but their conditions do not match, so
this package reports them as two separate branches rather than folding them into one:
> 卦有卦變，爻有爻變。卦變者內外動而反伏者同一卦也。如乾卦變坤卦。爻變者內外爻動而反伏者，非同一卦也。
> 如升之觀是也。又有外卦反伏而內卦不動者，如觀之坤是也。又有內卦反伏而外卦不動者如巽之觀是也
**The 反伏 branch: the inner or outer trigram's 纳支 has been replaced, as a set, by the one that clashes
with it position by position.** All three of the book's cases fit that: 观之坤 moves the fifth and sixth
lines, so only the outer set changed; 巽之观 moves the second and third, so only the inner set did; 升之观
moves the second, third, fifth and sixth, so both did. In every case the set it changed to clashes with the
original position by position — 观's outer 巽 carries 未巳卯 and 坤's carries 丑亥酉, and each of the three
pairs really is a 六冲 pair. The package judges inner and outer separately, so 「inner only」, 「outer only」
and 「both」 stay distinguishable instead of being flattened into one flat 「this hexagram is 反伏」.
Across the sixty-four hexagrams and the sixty-three non-empty moving patterns — 4,032 combinations — this
branch lands on 252 (4 with both, 124 inner only, 124 outer only).
**The 卦变 branch: all six lines move, and both the original and the changed hexagram are 八纯卦.** The
乾变坤 in the book's first line clashes in not a single position (子 against 未, 寅 against 巳, 辰 against 卯),
so it is not in the branch above — what it rests on is 「同一卦」: 乾坤, 坎离, 震巽, 艮兑, the four
complementary pairs. The 「all six」 condition cannot be dropped: 乾 moving only the first and fourth also
reaches 巽为风, and both ends are 八纯卦, but nothing like the book's 「內外動」 happened. A full sweep puts
this branch at eight, and its overlap with the 反伏 branch is **zero** — fold them into one and 乾变坤 is
either dropped or the 反伏 criterion has to be loosened until it can no longer be checked. The load-time
self-check pins both the zero overlap and the count (252 + 8 = 260).
**Each of the three situations has its own line, and this package does not pick one for you.** When both
the inner and the outer trigram are 反伏, both of the book's lines — 「內卦反伏，我亂他定」 and
「外卦反伏，他亂我定」 — apply, and the reading says so rather than reciting one.
**This layer does not decide 吉凶, and here the book draws the line itself.** The closing line leaves no
room:
> 反伏卦用神旺相不變沖克者則反復，事之必成，第恐用神而化回頭之沖克者，卽是卦變大凶之象。
Both preconditions are stated in terms of the 用神, so the reading only checks them: 用神旺相 is checked
against the 用神's vitality in the month's branch, and 用神化回头冲克 is checked by whether the 用神 line
moves at all and whether the line it turns into 克s it back. Each is reported plainly as holding or not, and
**「事之必成」 is never stated as an unconditional verdict**. When no 用神 can be taken, the first
precondition cannot be checked at all, and the reading says which layer is missing rather than talking past it.
**Only the 分占 lines that match the topic asked are taken from the chapter's ten.** 占功名, 占财物,
占墳墓宅捨, 占婚姻, 占疾病, 占盗贼官非 and 占出行 each land on one of this package's topics (恋爱 and 婚嫁
share 占婚姻), and the 占彼此 line is quoted separately for the inner and the outer case. 占天时 and 占行人
have no matching topic here, and rather than borrow another 占法 to fill the gap the reading says it cannot
connect them.
Measured by hand-tossed coins: about **6.4%** of readings carry this section — 内卦 47.7%, 外卦 47.7%,
both 1.5%, 卦变 3.1%. **时间起卦, 每日一卦 and 数字起卦 never produce it**: not an omission, but a
consequence of the method — all three move exactly one line by the book's own rule (the moving line is the
total divided by six), while 反伏 needs at least two moving lines and 卦变 needs all six, so the conditions
cannot meet. Zero hits in 9,125 casts; 6.4% across the sixty-four hexagrams × 63 moving patterns × 31 sampled
days (124,992 readings).
**What is deliberately not here: a 反伏 mark on the hexagram.** 空, 破, 墓, 暗, 日破, 冲, 合 and 刑 all hang
on a single line; 反伏 and 卦变 cannot, because they describe the relation between the original and the
changed hexagram rather than any one line's situation, and pinning them to a line would point at the wrong
place. They reach the reading and the MCP header only.
**六神 — what the day's stem says about the mood**
The sixth column a 六爻 chart has always carried. 《卜筮全书·卷之一·启蒙节要》:
> 甲乙起青龍，丙丁起朱雀，戊日起勾陳，己日起螣蛇，庚辛起白虎，壬癸起玄武。（俱從下起至上。）
The day stem fixes which god sits on the **first line**; from there they run upward in one fixed
order, 青龙 → 朱雀 → 勾陈 → 螣蛇 → 白虎 → 玄武, wrapping around. The song is stored verbatim and
checked cell by cell against the six-row table that follows it — thirty-two cells, since 甲乙, 丙丁,
庚辛 and 壬癸 are paired. The two worked 乾为天 charts in the same chapter are checked line by line:
on a 甲子 day 子水子孙 carries 青龙, on a 戊子 day it carries 勾陈.
| God | Element | Stands for |
| --- | --- | --- |
| 青龙 | 木 | 喜庆、喜事、贵人、酒色、正直 |
| 朱雀 | 火 | 口舌、文书、消息、是非、诉讼 |
| 勾陈 | 土 | 田土、房产、牵连、迟滞、牢狱 |
| 螣蛇 | 火 | 怪异、虚惊、缠绕、噩梦、欺诈 |
| 白虎 | 金 | 凶险、血光、伤病、丧事、威猛 |
| 玄武 | 水 | 暗昧、盗贼、隐私、暧昧、欺瞒 |
螣蛇's element is disputed — fire in most circulating editions, yin earth in others. This package
takes **fire** and says so, because taking earth would make it identical to 勾陈, and 虚惊 and
迟滞 are not the same thing.
One line this package will not cross, and the reading says so out loud every time it names a god:
> 吉凶全憑五行生克，情態方看六神吉凶。
The gods **do not take part in 生克 and do not move the verdict**. They say what kind of matter
this is. A test casts the same hexagram across twenty-eight different days — the god under the first
line changes hands several times over — and requires the verdict not to move by so much as a
character.
**化爻 · 变出之爻 — where a moving line goes**
The last layer of 京房: a moving line does not stay itself, it turns into another 纳支 line in the
变卦. What that line is to the one it came from is the whole of 化爻.
| | What it is | Reads as |
| --- | --- | --- |
| 回头生 | 变爻生本爻 | 吉 |
| 回头克 | 变爻克本爻 | 凶 |
| 化泄 | 本爻生变爻 | stated, no verdict |
| 化耗 | 本爻克变爻 | stated, no verdict |
| 化比和 | 同行 | stated, no verdict |
The two names are fixed by quoted text, and the two directions matter:
> 巽木变坎水，谓之化生，水回头以生木也，即以吉断。
> 震木变乾金，谓之化克，金回头以克木也，即以凶推。
Both watch one direction only — **变爻 to 本爻**. 《卜筮正宗·十八问答第二问》 then spells out all
five 回头克 cases and they land exactly on the five element pairs where 变爻克本爻: 土爻动变木、
木爻动变金、金爻动变火、火爻动变水、水爻动变土. That list is stored as `HUI_TOU_KE_PAIRS` and
checked against the 生克 table when the module loads, so the definition cannot drift from the code.
The same chapter adds the clause that makes 回头克 more than a flat verdict:
> 凡遇回頭剋者,徹底剋盡,原用二神遇之則凶,忌仇二神遇之反吉也
so the reading always says it — a 回头克 landing on the 用神 is bad, landing on a 忌神 turns
auspicious. The other three relations get **no** tone: 《增删卜易》 names them but assigns no
吉凶, and inventing one would be making it up.
**进退神** is the branch-level companion, from 《增删卜易·进退神章第二十九》:
> 进神：亥化子，寅化卯，巳化午，申化酉，丑化辰，辰化未，未化戌，戍化丑。
> 退神：子化亥，卯化寅，午化巳，酉化申，辰化丑，未化辰，戍化未，丑化戍。
Sixteen pairs, two ways, each pair same-element, each the other's reverse. Four pairs are earth
(丑→辰→未→戌→丑, one step along the ring each way) — that is the 歌诀 as written, not a slip.
Pairs not in the 歌诀 are simply not judged. 化空 and 化墓 on the changed line are reported as
fact, with no verdict attached: 野鹤's emptiness rules are about the moving line, and no text
makes a changed line's own emptiness good or bad.
One rule bounds the whole layer, and the reading quotes it before giving any of it:
> 夫變出之爻，能生克沖合本位之動爻，不能生克他爻，而他爻與本位之動爻，亦不能生克變爻。
A changed line is weighed **only against the moving line it came from** — not against the other
lines, and not against 世 and 应. Related: the changed line is a *still* line in the 变卦, so it is
never credited with 发动 or 得动爻生扶; it occupies the same position as the moving line, and
mistaking one for the other silently turns a true 真空 into a 假空.
**旬空 · 月破 · 入墓 — what the day and month do to a line**
These three sit on top of 京房's 纳甲 and decide whether a line is doing anything today.
| | Source | How it is worked out |
| --- | --- | --- |
| 旬空 | 《增删卜易·旬空章第二十六》 | The six-line 歌诀 is stored verbatim and checked line by line against the algorithm. Ten stems pair with twelve branches, so every ten-day 旬 leaves two branches unmatched — those are void. |
| 月破 | 《增删卜易》: 月破者，月建冲爻之谓 | The month branch clashes the line, matching the monthly table 正月申破 through 十二月未破. |
| 入墓 | 《纳甲筮法讲义·生旺墓绝》 | Per element, the 自墓 branch: 金墓丑, 木墓未, 水土墓辰, 火墓戌. |
| 绝地 | — | Not in the output, and not by oversight. 绝 is the branch right after 墓 (金绝寅, 木绝申, 水土绝巳, 火绝亥), but 纳甲 gives each element only two branches — 金申酉, 木寅卯, 水子亥, 火巳午, 土丑辰未戌 — and not one of those 绝 branches falls among them. No line in any of the sixty-four hexagrams can land on one. The 绝 mark was removed rather than left as a label that can never light up; loading `jingfang.mjs` checks the fact and throws if it ever stops holding. |
野鹤 himself splits void into false and true, and the reading follows his wording clause by clause
rather than inventing a rule of its own:
> 旺不爲空，動不爲空，有日建動爻生扶者不爲空，動而化空、伏而旺相皆不爲空。月破爲空。
> 有卦不動爲空，爻反伏而被克爲空，真空爲空，真空卽春土、夏金、秋木、三冬逢火是真空。
So **假空** means the void is not to be trusted as emptiness — 旺, 动, 得生扶, 动而化空 or 伏而旺相
rescue it, and it counts once the 旬 passes or a clashing day arrives. **真空** means genuinely
useless this 旬: 月破, or the element the season voids (earth in spring, metal in summer, wood in
autumn, fire in winter), or a hidden line being struck. The two are kept apart on the diagram: 假空
shows as 空假, 真空 as 空真.
One reading is a judgement call, and it is flagged rather than hidden: 野鹤's text reads 「有卦不動
爲空」, while most later copies read 「有氣無動爲空」 — the difference decides whether a still line
with vitality counts as void. This package takes the **latter**, because 旺不爲空 sits in the very
same passage and would otherwise have nowhere to apply.
Each line carries a small mark on the diagram — 空, 破, 墓, 暗, 日破, 冲散 — and the right-hand panel names
the 旬 and the month's broken branch outright.
A line that is 月破 but not 旬空 is 真空 too, on the strength of 「月破爲空」 in the same passage. It
used to come out as 「暂看不出真假，等出旬或逢冲之日再定」, which was wrong twice over: it left the
one ground the text names undecided, and it told the reader to wait for a clashing day when
《月破章》 says the opposite —
> 雖現於卦，有亦如無；伏於卦中，終難透露。即有日辰之生，亦不能生。
A 月破 line is therefore reported as 真空 with 「待出月、逢值再论」 rather than 「逢冲」 — out of the
month and onto its own branch is what helps it; a clash only does it more harm. A 旬空 line without
月破 still gets the full 「等出旬逢值或逢冲再论」, because for that kind of void a clash genuinely does
restore it.
**卦气 · 当令主卦 — which hexagram holds the month**
Han-dynasty 易学 assigns twelve hexagrams to the twelve months, called the 十二辟卦: 复 rules 子月
and 临 rules 丑月, round to 坤 in 亥月. This is not the same as 旺衰应期 above — that one reads how
strong the five elements are in the month, this one reads how the hexagram itself waxes and wanes
with the solar terms. 复 through 乾 are the 息 hexagrams, yang growing from the lowest line upward;
姤 through 坤 are the 消 hexagrams, yin growing the same way. The year turns once on that cycle.
The reading names the month's governing hexagram and says where the cast hexagram sits in it: on
the same 消长 side means the direction agrees with the season, opposite sides means you are running
against it and should slow down. Only twelve of the sixty-four are 辟卦; the other fifty-two are not
forced into the scheme.
**The 消长 ring — what that theory looks like**
The twelve 辟卦 are abstract until you see them. The ring has twelve segments, one hexagram each,
and each segment draws N short bars where N is how many lines that month has gained: 复 grows from
one to 乾's six as yang reaches its height, then folds back and 姤 grows to 坤's six as yin does.
One full turn is a year. The dashed diameters at 子午 and 卯酉 mark the two poles. The current month
is highlighted; if your own hexagram is one of the twelve, a vermilion dot marks where it sits. The
ring sits above the reading — the reading is the conclusion, the ring is the seasonal coordinate
behind it, so the shape comes first and 「当月主卦是哪一卦」 stops being a bare sentence. With
reduced motion on, the current segment stops pulsing.
**应期 — when it lands**
Taken from the 类神 when a topic was recognised, otherwise from the 用卦. It surfaces during the
branches where that element 当令, and resolves during the branches where it is 相. 乾金为用卦, so
the reading looks to 申酉 months and days.
**爻位之象 — what the line's position means**
初爻 is a beginning with nothing yet showing, 二爻 is near you but still under authority, 三爻 is
the threshold where things turn, 四爻 is the anxious position closest to other people, 五爻 is the
ruler's seat and where benefactors sit, 上爻 is the ending.
**方所 — directions**
The 后天八卦 directions of the 体 and 用 trigrams, for lost things and for travel.
Where the verdict is 吉 but the 用卦 drains the 体卦, the reading adds a caution rather than a
clean yes: 方向可进，力气要省.
**卦库 — all sixty-four hexagrams**
Search by name or by upper/lower trigram, then read the 卦辞, 彖传, 象辞, and the 互卦 / 错卦 / 综卦
cross-references for any hexagram.
**历法 — the almanac**
Ganzhi for the year, month, day and hour; the twelve 时辰 with their 黄道/黑道 office; the
建除十二神 day; the 二十四节气 calendar; the nine-day 数九 period; and the twelve zodiac with
harmony and clash relations.
**卦历 — your own log**
Castings you save are stored on this machine, with a one-line note you can add before saving,
newest first, up to 500 entries, and can be deleted individually. A casting you gave a question is
titled by that question; one cast without a question is titled by its method (today / at this moment
/ from numbers / tossed by hand).
**在对话里起卦 — the MCP endpoint**
This package also offers the Agent an MCP (streamable-http) endpoint at `/mcp/divination`, so it
can cast without the page ever opening. Its three tools are `divination_cast` (cast and
interpret), `divination_hexagram_lookup` (search the sixty-four), and `divination_almanac`
(today's ganzhi almanac).
**The package itself calls no model and makes no outbound request.** The Agent *is* the model: it
calls this endpoint, then explains the reading in its own words. Keys, billing and context stay in
the session; this package only has to be right.
For arguments, response shapes, trigger phrases, and troubleshooting, see
[Casting in the conversation (MCP)](#casting-in-the-conversation-mcp) above.

## 算法口径

- 算法口径: the day pillar is computed from the Julian day number and matches the traditional
  almanac (2000-01-01 is 戊午). The month branch follows the nearest of the twelve 节, whose dates
  are the usual yearly approximations and can be off by a day. The year branch turns at 立春,
  approximated as February 4. There is no lunar calendar in this package, so it does not convert
  lunar dates and does not claim to.
- 时间起卦 uses 公历月 and 日, which is the common modern simplification; the classical form uses
  the lunar ones. The app states this in the 起卦依据 panel rather than hiding it.
- The cadence claims are test-backed: a test casts inside one 时辰 and across the boundary, and
  checks the predicted next-时辰 hexagram against a real cast in that 时辰.
