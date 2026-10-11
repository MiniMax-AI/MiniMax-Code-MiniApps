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
| `mutate-anomaly.py` | each of the 45 异常 mutations, in the page, has a guard that can fail |
| `mutate-steer.py` | the steer split and the turn classification hold |
| `mutate-window-default.py` | the window defaults, labels, resets and load-more hold |

## The 异常 axis, and what it promises

`异常` is a second filter system, not a fourth field of the first one. Entering it switches the
type axis, the search box, the time range and the overview brush off; leaving it switches them
back on with their values intact. Four properties are asserted, each with a mutation control,
because each was observed to be false in this file's own history:

1. **The number on a button is what you get when you tick that button.** `anomalyCounts()` walks
   the same records `visibleEntries()` does and neither of them walks the other axis. Counting
   through `passesBaseFilter` — which is what this guard used to *require* — produced a button
   promising 283 rows above a list of 1,494, and no functional assertion could tell, because the
   ledger was filtering the same way the count was.
2. **The unit is part of the claim.** A rule scoped to a record is published in 条; a rule scoped
   to a turn is published in 轮, and counted once per *turn*. `无答复` counted in records is how
   a session broken 13 times came to advertise 1,244 "unanswered" rows, none of which carried a
   sign of being unanswered. `verify-anomaly.mjs` checks the unit against the rule table, not
   against a literal, so renaming or rescoping a rule cannot leave the two disagreeing.
3. **The two axes are alternatives, not a stack.** `visibleEntries()` and `spanPassesFilter()`
   branch on the mode before the other axis. The strip has to agree with the list: when it
   drew spans for records the list was not rendering, the "filtered but nothing changed" failure
   the overview had already paid for once came straight back.
4. **A control that cannot change what is on screen must not look like it can.** The inactive
   axis is `inert`, not merely dimmed, so neither the pointer nor keyboard focus can reach a
   button that does nothing. The session and generation pickers are deliberately unmarked — they
   choose which session is on screen, not which records of it — and the guard asserts exactly
   which four elements carry the marker.

Position is asserted too, on its own terms: the axis has to come after the type axis, must not
be a field of the search form any more, and the KPI cards must not come between them. It used
to be the last field of the form, four cards above the axis it reads as part of — a layout defect
that no functional assertion in the suite could see.

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