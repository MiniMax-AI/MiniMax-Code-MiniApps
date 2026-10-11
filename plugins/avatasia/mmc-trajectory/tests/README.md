# Regression guards

These are the checks that decide whether this plugin is still correct. They are not part of the
runtime payload — `miniapp.json` declares only `artifacts.client` and `artifacts.node`, and this
directory is neither, so nothing here is shipped.

```
node tests/run.mjs              run everything
node tests/run.mjs verify-      only the verifiers
node tests/run.mjs mutate-      only the mutation controls
node tests/run.mjs --real       read this machine's ~/.minimax instead of the fixture
```

Requires Node (the client guards run the inline script through `node --check`) and Python 3 (the
mutation controls are Python). No network, no running Mini App, no machine-specific paths: every
path resolves from this directory's own location.

## Why half of these are `mutate-*`

A guard that cannot fail is not a guard, because it reads as coverage. Each `mutate-*` file breaks
exactly one rule in the shipped source, runs the guard that owns that rule, requires it to fail
**and** to name the right check, then restores the file and requires green again. If a mutation is
reported as surviving, the guard it exercised was not testing anything.

That is also why they exist as separate files rather than as extra assertions: the mutation has to
be able to make the real guard go red, which an assertion inside the guard cannot do to itself.

`METHODOLOGY.md` is the other half: not what these guards are, but how to arrive at new ones — why
an expected number may never come from the code under test, what to do when a mutation survives, and
why an assertion that has to be deleted usually means a requirement was never written down.

## The session store under test

`verify-parsers.mjs` and `verify-prompt-fix.mjs` need a session store on disk. Reading the
developer's own `~/.minimax` made them machine-dependent: on a clean CI runner the suite dropped
to 13/15 — `verify-parsers` crashed and `verify-prompt-fix` failed two checks. They now read the
committed synthetic store under `fixtures/minimax-home/`.

The fixture is **distilled from real transcripts, not hand-written**. `make-fixtures.mjs` reads
this machine's `~/.minimax` and keeps exactly the structure the assertions depend on — roles,
content-part types, `stopReason` (the reply/narration split turns on it), `toolCallId` pairing,
usage numbers, and the injection markers `splitUserMessage()` branches on — while replacing every
string payload. No conversation text, path, or identifier from the real machine reaches the
fixture: a leak assertion on the rendered bytes refuses to write if one would.

Regenerate it when the store's format changes:

```
node tests/make-fixtures.mjs            report what would change, write nothing
node tests/make-fixtures.mjs --record   rewrite fixtures/minimax-home/
node tests/make-fixtures.mjs --selftest prove the leak assertion can actually fail
```

The generator also refuses to write unless every shape the guards rely on is present — user
prompt, injected block, tool call, thinking, reply, narration, tool result, compaction. Without
that gate a sparse sample would pass CI by accident and fail the moment anyone read it.

Run both ways when you touch the parsers: the fixture proves the verdicts are reproducible,
`--real` proves they still hold against transcripts nobody curated.

## The payload

Seven guards used to want one `/api/trajectory` body and got it by booting the service and
fetching from a port. The route at `server.mjs` is `buildTrajectoryPayload(...)` plus a handful of
`session.*` fields, so the same body falls out of the fixture store offline. `make-payload.mjs`
writes it once:

```
node tests/make-payload.mjs            report, write nothing
node tests/make-payload.mjs --record   rewrite fixtures/trajectory.json
node tests/make-payload.mjs --check    fail if the committed payload is stale
node tests/make-payload.mjs --real     the same report against this machine's ~/.minimax
```

`--check` is what keeps the two fixtures honest with each other: change `make-fixtures.mjs` and
forget `--record`, and the payload stops matching the store it claims to come from.

The fixture distiller walks a session's whole lineage, not just `messages.jsonl`. A compacted
session keeps its old messages in `snapshots/g<gen>--ctx_*.jsonl`, and the shapes the guards need
— an empty reply above all — live in those older generations. Reading only the active file finds
none of them, and the guards then fail for want of something to find.

## Files

| file | what it pins |
| --- | --- |
| `client-check.mjs` | the inline script parses; the DOM-free helpers; the static policy rules |
| `check-light-theme.mjs` | every `--mcode-*` token the page consumes is defined in both themes |
| `verify-overview.mjs` | the overview strip, toolbar controls and window bar |
| `verify-generations.mjs` | the compaction lineage walk: chain, orphans, generation totals |
| `verify-parsers.mjs` | session labels and multi-session parse counts |
| `verify-compaction-turn.mjs` | a compaction checkpoint is attributed to the turn it interrupted |
| `verify-pr15-fixes.mjs` | the six fixes made for the PR #15 review comments |
| `verify-prompt-fix.mjs` | injected-block splitting via `canonicalTextRange` |
| `verify-window-widen.mjs` | `向上加载更早的 N 条` survives the next poll (self-contained: the shipped rule is transcribed) |
| `verify-anomaly.mjs` | the four 异常 rules, their units, their position on the page, and their exclusivity with the other axis |
| `verify-sticky.mjs` | both filter rows pin as one band, and every band below it is measured rather than written down |
| `verify-block-order.mjs` | assistant blocks are ordered per message: thinking → text → toolCall |
| `verify-response-rail.mjs` | every row carries the rail of the response it came from |
| `verify-call-fold-coverage.mjs` | folding every tool call really removes them from the rendered build |
| `make-fixtures.mjs` | distils the local session store into the committed fixture; refuses to write on a leak |
| `make-payload.mjs` | builds `/api/trajectory` offline from that fixture; `--check` catches drift |
| `mutate-index-col.py` | the record-index column has room for the numbers it shows |
| `mutate-label-source.py` | kind button labels come from `KIND_LABELS`, not from markup |
| `mutate-name-collision.py` | no record kind is labelled with a name that means something else |
| `mutate-turn-breakdown.py` | the turn breakdown parts sum to the headline |
| `mutate-compaction-turn.py` | the compaction-turn attribution is not a free-text label |
| `mutate-pr15-fixes.py` | each of the six PR #15 fixes has a guard that can fail |
| `mutate-anomaly.py` | each of the 70 异常 mutations, in the page, has a guard that can fail |
| `mutate-steer.py` | the steer split and the turn classification hold |
| `mutate-window-default.py` | the window defaults, labels, resets and load-more hold |
| `mutate-sticky.py` | each of the 18 pinned-band rules has a guard that can fail |

## The 异常 axis, and what it promises

`异常` is a second filter system, not a fourth field of the first one. Entering it switches the
type axis, the search box, the time range and the overview brush off **and puts them back to their
default**; `重置` returns the row to its default, where the table is filtered by the row above
again. Five properties are asserted, each with a mutation control, because each was observed to
be false in this file's own history:

1. **Ticking a rule puts the row above back to its default.** In this mode that row filters
   nothing, so leaving it holding 「用户」 would be the page displaying a condition that is not in
   force — the same defect as a button whose number does not match its list, one control over.
   `resetBaseFilters()` sets the state *and* calls `syncKindButtons()`; a write without the sync
   leaves the axis drawing what was there before, and that is what the last mutation control here
   breaks. `重置` is not a toggle either: the second press filters nothing, it does nothing at all.
   And `重置` carries no count, because 「怎么多会留下多少」 is a question about a rule, and a control
   that keeps whatever the row above says has no answer to it.
2. **The number on a button is what you get when you tick that button.** `anomalyCounts()` walks
   the same records `visibleEntries()` does and neither of them walks the other axis. Counting
   through `passesBaseFilter` — which is what this guard used to *require* — produced a button
   promising 283 rows above a list of 1,494, and no functional assertion could tell, because the
   ledger was filtering the same way the count was.
3. **The unit is part of the claim.** A rule scoped to a record is published in 条; a rule scoped
   to a turn is published in 轮, and counted once per *turn*. `无答复` counted in records is how
   a session broken 13 times came to advertise 1,244 "unanswered" rows, none of which carried a
   sign of being unanswered. `verify-anomaly.mjs` checks the unit against the rule table, not
   against a literal, so renaming or rescoping a rule cannot leave the two disagreeing.
4. **The two axes are alternatives, not a stack.** `visibleEntries()` and `spanPassesFilter()`
   branch on the mode before the other axis. The strip has to agree with the list: when it
   drew spans for records the list was not rendering, the "filtered but nothing changed" failure
   the overview had already paid for once came straight back.
5. **A control that cannot change what is on screen must not look like it can.** The inactive
   axis is `inert`, not merely dimmed, so neither the pointer nor keyboard focus can reach a
   button that does nothing. The session and generation pickers are deliberately unmarked — they
   choose which session is on screen, not which records of it — and the guard asserts exactly
   which four elements carry the marker.

Position is asserted too, on its own terms: the axis has to come after the type axis, must not
be a field of the search form any more, and the KPI cards must not come between them. It used
to be the last field of the form, four cards above the axis it reads as part of — a layout defect
that no functional assertion in the suite could see.

## The pinned bands, and why none of them carries a number

Four things pin themselves while the ledger scrolls under them: the filter band (both axes), the
overview strip, the window bar, and the turn head. Three properties are asserted, and each one was
false in this file's own history.

1. **The two filter rows pin as one block.** They answer the same question — which records the
   ledger shows — so a state where the type row is still pinned and the 异常 row has scrolled away
   is the worst of both: the reader is told nothing is filtered while half the filter is off
   screen. Only the type row ever claimed `position: sticky` and it did not survive; the guard
   now asserts that neither row pins itself and that both are inside the band, because a band that
   does not contain both is the same defect wearing a different hat.
2. **No pinned offset is written down.** The band is two rows whose height changes when the 异常 row
   wraps at narrow widths and when its note appears or disappears, so `0–32` and `32–83` were
   correct only for a layout without the 异常 row. `syncStickyOffsets()` measures the three bands at
   the end of `render()` and writes them into `--sticky-band-h`, `--sticky-overview-h` and
   `--sticky-window-h`; the stylesheet only ever reads those. The guard runs that function against
   stub heights of 137 / 65 / 57 — no constant in the file is any of them — so a version that
   writes a number instead of a measurement fails, and so does one that measures the band for the
   strip.
3. **Anything pinned over the ledger has to paint a background.** The rows underneath are
   `background: transparent`, so a pinned band that stops covering them shows them through. The
   strip paints through `.overview-plot` rather than through the sticky section, which is why the
   guard names that rule and not `.overview`.

Two more assertions exist because the mutation control found them missing: the set of variables the
stylesheet reads has to be **exactly** the set the measurement writes (one side alone lets a stale
fallback or a dead measurement through), and every band the function reads has to be bound to an
element the markup actually ships. A band that is never bound measures nothing, all three offsets
fall back to their constants, and no error is reported anywhere — the stub the guard measures with
cannot catch it, so the binding is checked against the markup instead.

The order of `render()` is asserted too: the measurement has to be the last statement, because the
异常 note is written by `syncAnomalyMode()` and that note is what changes the band's height.

## Deliberately not in the default run

Shipping a suite that is red teaches reviewers to ignore it, so these are present but skipped,
with the reason stated rather than quietly dropped.

- **`mutate-filter-guards.mjs`** — not carried. Guards the layer buttons (`turns-btn`, `setLayer`,
  `LAYER_KINDS`, `applyLayerToKinds`). Those were removed when the layer presets were dropped in
  favour of the type chips; all five symbols now occur zero times in `index.html`. The rule it
  guards is gone.
- **`mutate-qa-lens.py`** — not carried. Guards the 问答 turn-lens. Same removal; no lens symbol
  remains.
- **`verify-time-range.mjs`** and its control **`mutate-time-range.py`** — present, skipped by
  `run.mjs`. Its assertions are calibrated against a full multi-generation session:
  `stats.messages > 1000`, and a checkpoint nested inside a turn rather than being one. The
  committed fixture is a single-file session of a few dozen rows. Reproducing those numbers
  faithfully would mean committing a multi-megabyte payload; relaxing them would stop exercising
  the timezone arithmetic the file exists for. Run it by hand against a booted service:
  `node tests/verify-time-range.mjs <port>`.

### Two anchors that were wrong, and one mutation that could not be caught

Kept here because each cost real time to find, and each would look like "the guard is stale":

- **`mutate-steer.py`** was not stale. `server.mjs` is CRLF and the anchor joined its lines with
  `\n`, so a multi-line anchor matched zero times and read as drift. Single-line anchors in the
  same file matched fine. Anchors are now built in the file's own line ending.
- **`mutate-window-default.py`** was genuinely stale, but not where it looked: the rule still
  exists, and `rePinWindow` had gained a time-range early-return *between* the two lines the
  anchor spanned. It is anchored on the one line that is the rule.
- **`mutate-anomaly.py`** does not carry a case that nulls the page's `liveTurn`, even though that
  looked like the obvious thing to break. `verify-anomaly.mjs` re-derives the live turn itself
  instead of calling the page's function, so the mutation is invisible to every assertion in the
  file — it was tried and the probe passed. Shipping it would mean shipping a mutation known to
  be unobservable. Until the harness stops re-deriving it, the page's `liveTurn` has no guard of
  its own.

## One-shot patches are not here either

Development also produced scripts that **write the package** to apply one specific edit. They are
deliberately excluded: they have no dry-run and no backup, they write straight back to
`index.html` / `server.mjs` / the READMEs, and re-running one now edits text that has since moved
on. They have since been removed rather than kept with a warning header — what each one did is
recorded in the development directory's index instead.

**Do not go looking for a one-shot patch runner.** If you need to change the client or the service,
edit the file and let the guards below tell you whether you broke something.