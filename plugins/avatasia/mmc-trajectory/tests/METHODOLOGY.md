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

---

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