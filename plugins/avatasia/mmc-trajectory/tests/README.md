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
| `make-fixtures.mjs` | distils the local session store into the committed fixture; refuses to write on a leak |
| `mutate-index-col.py` | the record-index column has room for the numbers it shows |
| `mutate-label-source.py` | kind button labels come from `KIND_LABELS`, not from markup |
| `mutate-name-collision.py` | no record kind is labelled with a name that means something else |
| `mutate-turn-breakdown.py` | the turn breakdown parts sum to the headline |
| `mutate-compaction-turn.py` | the compaction-turn attribution is not a free-text label |
| `mutate-pr15-fixes.py` | each of the six PR #15 fixes has a guard that can fail |

## Deliberately not here

Four mutation controls from development guard rules that no longer exist, or whose anchor has
moved. Shipping a suite that is red teaches reviewers to ignore it, so they were left out rather
than carried:

- **`mutate-filter-guards.mjs`** — guards the layer buttons (`turns-btn`, `setLayer`,
  `LAYER_KINDS`, `applyLayerToKinds`). Those were removed when the layer presets were dropped in
  favour of the type chips; all five symbols now occur zero times in `index.html`. The rule it
  guards is gone.
- **`mutate-qa-lens.py`** — guards the 问答 turn-lens. Same removal; no lens symbol remains.
- **`mutate-steer.py`** — the rule is still live but its anchor string (`const steered =
  turn.records.some(...)`) no longer matches `server.mjs`. Needs re-anchoring.
- **`mutate-window-default.py`** — same: the rule (a poll resetting a widened window) is live and
  `verify-window-widen.mjs` still covers it, but the mutation's anchor into `index.html` no longer
  matches. Needs re-anchoring, and `verify-window-widen.mjs` has no mutation control yet.

## One-shot patches are not here either

Development also produced scripts that **write the package** to apply one specific edit. They are
deliberately excluded: they have no dry-run and no backup, they write straight back to
`index.html` / `server.mjs` / the READMEs, and re-running one now edits text that has since moved
on. They have since been removed rather than kept with a warning header — what each one did is
recorded in the development directory's index instead.

**Do not go looking for a one-shot patch runner.** If you need to change the client or the service,
edit the file and let the guards below tell you whether you broke something.