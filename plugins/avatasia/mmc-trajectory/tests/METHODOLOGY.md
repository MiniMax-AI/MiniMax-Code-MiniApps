# How to verify a change here

`README.md` in this directory says what the guards are. This says how to arrive at them, and — more
usefully — what has gone wrong when this was not followed. Every rule below is here because it
cost a real defect or a real false alarm, not because it is good practice in the abstract.

The short version:

> Black-box the behaviour first. Freeze the data before you write any number. Derive the expected
> value by hand. Then make the guard fail on purpose, and keep the failing mutation or fix the
> guard — never delete it.

---

## 1. Drive the page before you read the code

Reading a 285 KB client file to find a defect in a filter row is slow, and it is how you end up
asserting the implementation you happened to read instead of the behaviour someone reported.

Open the dashboard and walk the states. For the 异常 row the matrix that matters is:

| | no rule | one rule | several | 重置 pressed |
| --- | --- | --- | --- | --- |
| **单选** | 重置 | replace on each press | unreachable | — |
| **多选** | 重置 | stack | union, untick one at a time | — |

That walk found three defects that no amount of reading would have surfaced, because all three are
about what a control *says* rather than what it computes.

### Reading the state of a row of controls

Read the **parent container's** `outerHTML`, not a filtered set of children:

```
query(kind="dom", selector="#anomaly-bar")     → every button with its aria-pressed
```

A selector like `#anomaly-controls button[aria-pressed="true"]` returns only the **first** match,
and a comma-separated list returns one of the matches in unspecified order. Both look exactly like
"the stacking did not work". During this work that reading produced a confident claim that a
working feature was broken, and the only reason it was caught is that the note text disagreed with
it.

Two more that matter on this page:

- **checkbox state does not appear in serialised DOM.** `syncAnomalyMode` writes
  `dom.anomalyMulti.checked`, which is a property; the serialised `<input>` is identical whether it
  is ticked or not. `query(kind="semantic")` does not expose it either. To see it, screenshot.
- **the session grows while you measure.** Every number on this page moves every 2.5 seconds. A
  reading of `1,705` against a ledger of `1,706` is not a defect. See §2.

---

## 2. Never take a number from the page as the expectation

This is the rule that would have prevented the original 异常 defects, and the one that is easiest to
break while writing new guards.

The counts on the 异常 row are computed by walking the session. If a guard computes its expected
value with the same walk, it is a tautology: two implementations of the same mistake agree.

Every expected number comes from **committed fixture data**, counted by code that shares nothing
with the client — the guard reads `payload.turns[]` itself and never calls `anomalyCounts()`:

```
node tests/verify-anomaly.mjs
fixture: 23 turns, 88 records, 21 turns that never answered
OK  (234 assertions; 70 anomalous records of 88)
```

If you must compare against the live page to close a report, do it on a **stable** quantity — the
ledger window, which shows `已显示 N 条 · 更早的 M 条未加载`, so the total is `N + M` and readable in
one snapshot. Even then, treat a ±1 difference as the session growing, and re-read before calling
it a bug.

`--real` runs the same guards against this machine's `~/.minimax`. It is a second opinion about
*shape*, never a source of expected values: that file grows too.

---

## 3. Derive the expectation by hand, and write down the derivation

Before writing an assertion, work out what it should be and check that it is not boring:

```
noReply   → 21 turns are `closed === false` and are not the live turn   → 21 轮
           those turns hold N records in total                        → N 条 shown
toolError → a `toolResult`/`toolCall` pair whose result says it failed → some 条
```

Three things this catches that a green suite does not:

- **Units.** `byRule` counts turns for a turn rule and records for a record rule. `21 轮` and `N 条`
  are not comparable, and a session broken 21 times once advertised 1,244 "unanswered" rows.
- **Unions do not add up.** One record can trip two rules. `工具失败 335 条` and `上下文压缩 19 条`
  can be `354 条` or `353 条` and both are correct. A guard that asserts `a + b == total` will be
  flaky, and one that asserts `a + b == total` while the fixture happens to have no overlap will
  pass forever without testing anything — hence the explicit `some pair of rules genuinely overlaps`
  assertion, which fails loudly if the fixture stops containing an overlap.
- **Partial selections.** `全部异常` is the union of **all** rules. It is never the total of the two
  rules currently ticked. An earlier version of the hint said `合计见「全部异常」`, which was true
  only for the full set; for a two-rule stack it pointed 1,300 rows above the ledger.

---

## 4. Give every invariant a mutation, and keep it alive

A guard that cannot fail reads as coverage. For each new invariant, add a case to
`mutate-anomaly.py` that breaks exactly that rule, and require it to be caught **by the assertion
that owns it**:

```
python tests/mutate-anomaly.py
OK  (70 mutations, each caught by the guard that owns the defect)
index.html restored byte-for-byte
```

The runner refuses three outcomes, and all three are things that have happened here:

| runner reports | what it means | what to do |
| --- | --- | --- |
| `anchor matched N times` | the anchor is not unique, or the source moved | re-derive the anchor from the current file. **Never** loosen it to `>= 1` |
| `NOT CAUGHT` | the guard is not testing what it claims | fix the guard. Do not delete the mutation |
| `CRASHED` | the probe died before reporting | this is not a catch. Fix the crash |

### A mutation that is a no-op is worse than no mutation

The first attempt at "count the partial union" was:

```python
# wrong — `sel.length === 0` is false whenever rules are ticked, so this changes nothing
-  if (sel.indexOf(hits[s]) >= 0) {
-    selected += 1;
-    break;
-  }
+  if (sel.length === 0 || sel.indexOf(hits[s]) >= 0) { ... }
```

It survived, and the survival was correct: the mutation was dead code. The replacement drops the
`break`, which turns the union into a count of rule-hits — wrong exactly when two rules overlap on
one record, and correct otherwise. **Prefer mutations that only differ under the condition the
invariant is about.** A mutation that is always different is usually breaking something the
assertion never covered.

### The owner must have a stable name

`assert()` names are the runner's interface. Two traps:

- **No colons.** The probe used to recover names with `split(':')[0]`, so `单选: ticking a second…`
  was truncated to `单选` and mutations that *had* been caught were reported as uncaught. Names are
  now collected separately; keep them colon-free anyway, because it is still how failures are read.
- **A name that varies with the input cannot own a mutation.** Per-pair assertions named
  `… — compaction + toolError` are excellent for a human reading a failure and unusable as a
  mutation owner, because *which* pair fires depends on the fixture. Keep both: one family-level
  assertion with a stable name, plus the per-instance ones for diagnostics.

---

## 5. Assert prose by running it

A sentence can be grammatical and wrong. `合计见「全部异常」` was, and no regex over the source
would have said so.

`syncAnomalyMode` is loaded into the VM and its **rendered text** is read back:

```js
page.dom.anomalyNote = { hidden: true, textContent: '' };
vm.runInContext(fnSource('function syncAnomalyMode(counts)'), page);
page.syncAnomalyMode(page.anomalyCounts());
const printed = page.dom.anomalyNote.textContent;   // what the reader is actually shown
```

and the number is **parsed back out** of the string rather than matched as a phrase, so rewording
the sentence does not break the guard while repointing the number still does:

```js
const countOf = (text) => Number((text.match(/合计 ([\d,]+) 条/) || [])[1]?.replace(/,/g, ''));
```

Use source-shape assertions for wiring — is it wired to `change` or `click`, is it marked
`data-filter-scope` — and use execution for anything a reader would be misled by.

---

## 6. When a guard goes red after an unrelated change, re-derive it

Changing a signature breaks every `fnSource('function syncAnomalyButtons()')` anchor at once. The
failure is noise, not evidence. Re-read what the function now promises and rewrite the assertion
onto the new contract.

Two of the 14 red assertions in this session were **inverted on purpose** and say so in their own
comment:

- `ticking a second keeps table order, not click order` required the toggle to stack
  unconditionally. True of the code, false of the requirement. It now asserts 单选 replacement,
  and the union it described is re-asserted in the 多选 block with the checkbox actually on.
- `重置 is pressed exactly when no rule is` was true of the *filter* and false of the *row*: 多选 is
  part of the row's state and is the only control that turns it off.

An assertion that has to be deleted has usually found a requirement that was not written down yet.
Write that down in the assertion's comment, or the next reader will delete it too.

---

## 7. One render, one snapshot

`render()` took the counts twice — once for the hint, once for the buttons. Two walks of a session
that is still growing can disagree, and the note would have published a number the button row did
not have.

```js
var anomaly = anomalyCounts();
syncAnomalyMode(anomaly);
syncAnomalyButtons(anomaly);
```

Two guards hold this: the exact call sequence, and that `render()` contains exactly **one**
`anomalyCounts()` call. Anything a reader can add up must come from one read.

---

## 8. Measure the layout; never write it down

A sticky offset is a measurement, not a constant. This file carried `top: 32px` and `top: 83px`
with a comment explaining them, and both were correct only while the layout had exactly one filter
row above the strip. Adding a second filter row — one that wraps at narrow widths and grows a line
when its note appears — invalidated them silently: nothing overlaps at the width the comment was
written at, and at 735px the window bar sits on top of the strip.

```css
/* wrong: correct for one layout, and there is no way to tell from reading it */
.overview  { top: 32px; }
.window-bar { top: 83px; }
```

```js
function syncStickyOffsets() {
  if (!dom.filterSticky || !dom.overview || !dom.windowBar) return;
  var root = document.documentElement.style;
  var band = dom.filterSticky.offsetHeight;
  var overview = dom.overview.offsetHeight;
  root.setProperty('--sticky-band-h', band + 'px');
  root.setProperty('--sticky-overview-h', overview + 'px');
  root.setProperty('--sticky-window-h', dom.windowBar.offsetHeight + 'px');
}
```

`offsetHeight`, not `getBoundingClientRect().height`: this runs on every 2.5s poll, and a
fractional device-pixel ratio would otherwise accumulate a third of a pixel per poll into an
overlap nobody can see and everybody inherits.

Three rules make that hold, and each of them needed a mutation before it was believed:

- **Pin what answers one question as one block.** The two filter rows were pinned separately, which
  allowed the state where the type row is still on screen and the 异常 row is not. Half a filter
  visible is worse than none: the reader is told nothing is filtered.
- **The set of variables the stylesheet reads must equal the set the measurement writes.** One
  direction lets a fallback govern a band that nothing measures; the other lets the measurement
  keep writing a variable nobody reads, which is what "the offsets went back to being constants"
  looks like from the outside.
- **Everything pinned over the ledger paints a background.** The rows underneath are
  `background: transparent`, so a pinned band that stops covering them shows them through.

And the general form of the third one: **an element named in markup and an element named in a
selector are two names, and nothing checks that they agree.** A band looked up by an id the markup
does not ship measures nothing, all three offsets fall back to their constants, and no error is
raised anywhere. A guard that hands the function a stub cannot catch this — the stub supplies
exactly what the function asked for — so the binding is checked against the markup instead.

### 8.1 Assert the thing, not its name, and not its prefix

Two assertions written for the folded inspector state survived their own mutations, and both were
the same mistake wearing different clothes.

**A regex that stops early.** The rule was "the handle stays in the folded state":

```js
/toggle\.hidden\s*=\s*!narrow\s*\|\|\s*!docked/    // passes on `… || docked || folded`
/toggle\.hidden\s*=\s*!narrow\s*\|\|\s*!docked\s*;/ // does not
```

The mutation appended `|| folded` — the exact defect — and the pattern matched the prefix and never
read what followed. **An unanchored pattern is satisfied by the correct code plus anything at all.**
When the assertion is about a whole statement, anchor it at the statement's end.

**An assertion about a name instead of about the thing.** The rule was "folded carries no cap of its
own":

```js
valueIn(sel, 'display') === 'none' && !jsHtml.includes('--inspector-folded-h')   // insufficient
```

Nothing stops a `max-height: 51px` being added to the same rule. The cap was back, and the guard was
still green, because the guard had been about a *variable name* rather than about *a cap*. Assert
the shape instead: the rule declares **exactly one** property and it is the one.

The common form: **「there is no X」 must be asserted as "the thing that would be X is absent", never
as "the name we used to call X is absent".** The first is a property of the code; the second is a
property of one spelling of it.

### 8.2 The same trap, catching the other one

§8.1 was written about guards that are too narrow. D36 lost a mutation to the mirror image: a guard
naming a handle, where the mutation reaches the same handle through a local.

```js
!/filterSticky\s*\.\s*(classList|setAttribute|dataset|hidden|style)/.test(updateFn)   // passes
```

The rule it was meant to enforce is 「the dock decision writes nothing anywhere」. The mutation
aliases the band (`var band = dom.filterSticky;`) and writes `band.classList.toggle(...)`, which
writes to the filter layer exactly as much and passes the name check. Naming the handle only ever
caught writes spelled that one way.

Both failures are the same sentence: **the assertion was about a spelling, and the mutation was free
to use another one.** The narrow pattern that reads "not `filterSticky.something`" has to become
the wide one that reads "not `.classList` / `.setAttribute(` / `.dataset` / `.style` / `.hidden =`
anywhere in this function" — a claim about the function rather than about one identifier in it. The
wider pattern is less specific about *what* was written and more specific about *that nothing* was,
which is what the rule actually claims.

The tell in both cases: the assertion's subject could be renamed, aliased or reformatted without the
code changing what it does. If that is possible, the assertion is measuring the spelling.

### 8.3 "Adjacent" is not "first", and "in the file" is not "in the thing"

D38 lost four mutations to two related mistakes, and the first one is the more general of the two.

**Adjacency only excludes what sits *between*.** The rule was "the dock writer must not early-return on
a same-value call", because the drag calls it with `'docked'` on every `pointermove` and an early
return freezes the panel halfway through a resize. The first assertion asked for the assignment and the
repaint to be adjacent:

```js
/state\.inspectorDock\s*=\s*next\s*;\s*applyInspectorDock\(\)\s*;\s*\}\s*$/   // passes
```

The mutation inserts `if (state.inspectorDock === next) return;` **above** both of them. They are still
adjacent, still in that order, still the last two statements — and the guard stays green through a
defect that silently breaks every drag. The rule is not "nothing between these two statements", it is
**"these two statements are the whole body"**, so the assertion has to say that:

```js
setFn.replace(/^[^]*?\{/, '').replace(/\}\s*$/, '').replace(/\s+/g, ' ').trim()
  === 'state.inspectorDock = next; applyInspectorDock();'
```

The general form: **an ordering or proximity assertion answers a weaker question than the rule it
stands for.** Proving `A` precedes `B` is not proving `A` is the first thing. When the rule is about
an *absence*, the assertion has to bound the whole region, not draw a line inside it.

**A name looked up in the whole file is a name looked up in the wrong file.** The same rule read "both
controls ship inside the panel head", and the first version found `<div class="panel-head">` with
`html.indexOf`. The ledger has its own `.panel-head`, it appears earlier in the document, and the
result was a green assertion on a head that contained neither control. Containment is a relation
between two positions, so it has to be resolved relatively:

```js
const head = elementRegion(html, 'div', '<div class="panel-head">', panelRegion.start);
```

The tell is the same as §8.2's, pointed the other way: not "the subject could be renamed" but **"the
subject could be the wrong one and the assertion would not know"**. A lookup with no `from` is a
claim that the thing is unique in the document. If it is not unique — or you have not checked — it is
a claim about the first occurrence.

And the two together are why so much of this file reads as it does: **every assertion has to name the
region it is talking about, and every absence has to be bounded rather than spotted.**

### 8.4 A contract can be wrong while the control is exactly right

D38 split one three-state cycling button into two, one job each, and that was correct. D39 then found
that the folded button's exit said 「恢复到半高」 as a **literal** — so folding a fully expanded panel
brought it back to half height. The button existed, was wired, reported both directions, and did
exactly what it said. It was just saying the wrong thing half the time.

The shape worth naming: **splitting a control decides which branch each control owns; it does not
decide what that branch points at.** The exit target is a function of something the reader did
earlier, so it needs a field and a function:

```js
function setInspectorDock(next) {
  if (next === 'folded') state.inspectorDockBeforeFold = state.inspectorDock;
  state.inspectorDock = next;
  applyInspectorDock();
}
```

The property that makes it correct is narrow and worth copying: **the field is written only on the way
IN and read only while folded.** There is no window in which the dock has moved on and the memory has
not, so nothing has to clear it — no reset in `resetInspectorDock`, no reset when the selection is
lost. "Can this go stale?" is answered structurally rather than by adding the clearing code that would
have needed its own guard.

Three sub-rules came out of writing the guards for it, and all three are about the same seam:

- **Two readers of one rule must call the same function.** The label and the click both pick a branch;
  spelled separately they are free to disagree, and disagreeing IS the defect. The guard counts the
  calls rather than checking either spelling, so a third reader fails too.
- **A parser that only understands literals stops seeing the control at all.** The transition table's
  `state.X === P ? A : B` matcher needed `A` to become "a literal *or* a call", and until it did, four
  assertions silently went quiet rather than going red. A parser that cannot represent the code is
  indistinguishable from code that is not there — so when a matcher is widened, check that the
  assertions downstream came *back*, not that they still pass.
- **Following one call is not seeing both branches.** `resolveDestination` reads the exit function and
  takes the branch the memory currently points at, which is a fact about the reader, not about the
  file. A mutation putting `'flow'` in the *other* branch survived every reachability assertion, and
  the fix was a separate rule over the tokens: **every state the exit is capable of naming must be a
  declared one.** The reachability table can only ever prove one branch; the token rule covers the
  other, and the gap is a property of static checking, not something to fix with a cleverer regex.

The general form, and the one to check before writing a guard for any new control: **「is the control
wired correctly」 and 「does the control say the truth」 are different claims, and the second one is not
implied by the first.** D34 → D38 → D39 is three rounds of the same page rediscovering that, in
ascending order of how invisible it was: three class values with one unreachable, then one control
covering three heights, then two controls with one of them lying about its own destination.

---

### 8.5 Reading the text is not the same as parsing it

A guard that reads `index.html` sees the same characters the browser sees. It is still possible
for a rule to be in the file, every assertion about it to pass, and the browser to have no such
rule — because between "the characters are there" and "the parser built a rule out of them"
there is a step nothing in this suite was watching.

That is what happened to D40. The wide-screen `@media (min-width: 1081px)` block shipped with
the inspector pinned to the top of the stack. The block was in the file. `verify-inspector-dock`
had ten assertions naming it, every mutation was caught, `npm run validate` said OK, 53/53
passed twice, and the braces balanced. In the browser's CSSOM there were **zero** rules
mentioning `#inspector-panel`, and the panel computed `position: static`, `max-height: none`.

The cause was the comment directly above it. CSS comments **do not nest** — the first `*/`
found inside one ends it there. That comment was explaining `verify-comment-shape`'s own rule
and spelled the terminator inline to do it. So it ended mid-sentence, the rest of the prose
plus the `@media` keyword became the prelude of a qualified rule, its selector was invalid, and
the browser dropped the rule, declarations included, without a word. The braces balanced
because both blocks were still there — one of them just swallowed the other.

Two things make this worth its own section:

- **Brace balance cannot see it.** The damaged parse has exactly the same `{` and `}` as the
  healthy one. Any assertion of the form "the block is well formed" is satisfied by the broken
  version, which is why `verify-comment-shape` was green.
- **The evidence was in the residue, not in the rule.** Prose standing at the top level of a
  stylesheet is never valid CSS. This file quotes prose with a backtick every time, so an
  early-closed comment leaves backticks standing outside any comment. That is an assertion now,
  and `mutate-comment-shape.py` reproduces the shipped line on purpose.

The rule: **an assertion about a rule proves the text is there; only the browser proves a rule
exists.** When a measurement contradicts a green suite, suspect the parse before the logic —
and check whether the runtime is even serving the bytes on disk, because a stale runtime looks
exactly like a broken rule and costs an hour to tell apart.

Two more from the same afternoon, both about reading:

**A hand-written character can vanish without a word.** The first version of that new assertion
held a regular expression typed by hand whose closing slash was lost in transit — `\*\/.test`
instead of `\*\//.test`. It did not fail an assertion; it failed to parse, and the error pointed
at a later line complaining about invalid flags, so it read like a V8 quirk. It was found by
printing the bytes: `2f 5c 2a 5c 2f 2e` where a second `2f` belonged. **When code you wrote by
hand will not parse, print the characters before you theorise.** The assertion now uses string
slicing and contains no pattern at all.

**A probe that finds nothing must not exit 0.** The scan looking for a record taller than the
ceiling reported `0 samples, 0 skipped` — not because every panel was hidden, but because
`#tablist` is empty in the markup until a record is chosen, so the loop never ran. Only the
deliberate "found nothing → exit non-zero" turned that into a failure instead of a pass. And
`if (r.cssRules)` is no longer a safe way to walk CSSOM: **CSS Nesting gave `CSSStyleRule` a
`cssRules` property**, so an empty list is truthy, every ordinary style rule gets recursed into
instead of read, and the walker reports an empty stylesheet that is in fact full.
## 9. Say what you did not manage to check

Some things cannot be driven through the browser harness. The honest form is the useful one:

> Keyboard operation of the 多选 checkbox is not verified end to end. `Shift+Tab` does not move
> focus in this harness — the focus ring stayed on 重置 and `Space` did nothing. The guard asserts
> the binding is `change` rather than `click` (`click` does not fire for a keyboard-toggled
> checkbox), with a mutation that fails if it is rewritten. That plus the platform guarantee is the
> whole of the claim.

A harness limitation reported as a limitation is useful. The same limitation silently treated as
"probably works" is how a keyboard-only path ships broken.

---

## Checklist

```
[ ] walked the states in the browser first, and read a parent container for a row of controls
[ ] every expected number comes from the fixture, counted without calling the code under test
[ ] units, unions and partial selections worked out by hand before the assertion was written
[ ] each new invariant has a mutation that is non-trivial (differs under the condition) and unique-anchored
[ ] family-level assertions own the mutations; per-instance ones are for humans
[ ] prose assertions are produced by running the function, numbers parsed back out of the string
[ ] no assertion name contains a colon
[ ] everything one reader can compare came from one snapshot
[ ] no layout offset is written down; anything pinned is measured, and measured at the end of render
[ ] every variable the stylesheet reads is written by the measurement, and one written is one read
[ ] every element the measurement reads is bound to an id the markup actually ships
[ ] anything not verified is written down as not verified
```

```
node tests/run.mjs            # everything
node tests/run.mjs --real     # same guards, this machine's ~/.minimax
node tests/make-fixtures.mjs --check   # the committed fixture: parses, covers all ten shapes, no machine paths
node tests/make-fixtures.mjs --checkselftest    # prove that --check can reject a bad fixture
```

**Never run two suites at once in the same working tree.** The mutation harnesses write in
place: `mutate-anomaly.py` mutates `index.html` and puts it back, `mutate-fixture.py` does the same
to `make-fixtures.mjs`. Two suites running together read each other's mid-mutation state as their
own baseline. Measured: `run.mjs` and `run.mjs --real` side by side produced "the kind test
inverted" and "got 1, want 2" — both artifacts of the two runs clobbering each other, not defects.
After stopping them, `index.html` was in fact left mid-mutation (SHA256 differed from the workspace
copy); restoring from the workspace brought `git hash-object` back in line with HEAD.

Same root cause as the rest of this document: **a harness that wrote something must not be the only
thing that judges what it wrote.** Concurrency is just another way to become the thing you are
checking against.

`--check` judges the committed tree in place and never reads `~/.minimax`, so it works on a clean
runner. It compares shape, not bytes: the live store moves under every run, so a byte comparison
would be permanently red and chasing it is how a fixture gets half-regenerated for no reason anyone
can name. `mutate-fixture.py` is the record of how that decision was forced — see the note on
mutation A below.