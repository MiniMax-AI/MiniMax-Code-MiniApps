# 蹬王之王 · Local Expiry Ledger & Card Decision

Track when your credits and reset cards expire, and decide — from a **ledger you keep
yourself** — whether to spend a card or let the credits burn first.

**v2.0 (trimmed) — 2026-10-20.**

## What it does

| | |
| --- | --- |
| **Local ledger** | The only data source: `~/.config/mcode-reset-card/ledger.json`, which *you* maintain. Edit it in the panel or in any editor. |
| **"Expiring first" decision** | When the 5-hour quota crosses the trigger line, it compares expiry dates and says whether to spend a card or keep the credits — with the reasoning spelled out. |
| **Honest failures** | If the ledger can't be read, it says so plainly instead of quietly concluding "you have nothing". |
| **Backend daemon** | A Rust daemon under `launchd` re-runs the same decision on a timer and writes the conclusion to a status file. |

## What it deliberately does *not* do

Community plugins must not touch the host's private data. So this version:

| Boundary | v1.x (removed) | v2.0 |
| --- | --- | --- |
| **No reading MiniMax Code's login credentials** | Read the lease socket / `.cap` for an access token and called the account APIs | **Doesn't.** The ledger is the only data source |
| **No reading/writing the host's internal database** | `UPDATE`/`DELETE`/`INSERT` on goals and the execution queue, and read turn records | **Doesn't touch it.** Only reads its own directory |
| **No reading other plugins' data directories** | Read `minimax-bot`'s `state.json` for bot and session ids, then messaged those sessions | **Doesn't.** The Bot watchdog is gone |

⇒ **v2.0 never spends a card, never pauses a goal, never wakes a Bot.** It computes the
conclusion and explains it; **you** do the action.

⇒ The upside: v2.0 is code that can live in a community repository. It touches no
private host data and its behaviour is fully predictable.

## The ledger

```json
{
  "schemaVersion": 1,
  "updatedAtMs": 1792480000000,
  "quota": {
    "fiveHour": { "usedPercent": 3, "totalPercent": 100, "unlimited": false, "resetTimeMs": 1792497600000 },
    "weekly":  { "usedPercent": 0, "totalPercent": 100, "unlimited": true,  "resetTimeMs": 1792944000000 }
  },
  "cards": [
    { "cardId": "card_1", "label": "Card A", "sourceType": "code",
      "outBizNo": "biz_1", "expireTimeMs": 1795000000000 }
  ],
  "credits": [
    { "label": "Granted", "source": "code", "granted": 400, "used": 0,
      "balance": 400, "expireTimeMs": 1795017600000 }
  ]
}
```

A card counts as usable only if it has **both** `outBizNo` and `sourceType`.
A credit counts only if `balance > 0` and it has not expired.

> ⚠️ **A missing `credits` field does not mean "no credits".**
> A missing field is treated as *incomplete data* ⇒ the conclusion stays "hold off".
> It will **never** recommend burning a real card because it couldn't read the data.

The panel has a ledger editor at the bottom — edit the JSON there and save, or edit
the file in any editor and hit refresh.

## The decision

| Situation | Conclusion |
| --- | --- |
| Quota below the trigger line | Hold — nothing to do |
| At the line, no usable credits, card available | **Spend a card** |
| At the line, no usable credits, no card | Hold |
| At the line, credits available, no card | **Keep the credits** |
| At the line, both, card expires first | **Spend a card** |
| At the line, both, credits expire first | **Keep the credits** |
| At the line, but the quota refreshes within N minutes | Hold — spending a card would be pure waste |
| Data incomplete | Hold — better no advice than wrong advice |

## Three-way consistency

The decision logic has **three isomorphic implementations**:

| Implementation | Where | Role |
| --- | --- | --- |
| Rust | `daemon/rust/src/decision.rs` | The backend daemon |
| Mini App | `miniapp/node/server.mjs` (`decide()`) | The dashboard |
| Python | `daemon/reset_card_autouse.py` (`decide_background()`) | The **reference** (pure, no network) |

`daemon/verify-parity.mjs` feeds all three the *same* cases and compares the
action **and the reason text, character for character**:

```
$ node daemon/verify-parity.mjs
19/19 三方完全一致（动作 + 理由文本逐字）
```

The reason text has to match character for character — change one side and you must
change all three, or the checker goes red. That check is the most valuable guard in
this project: it stops the three implementations from slowly drifting apart until
they contradict each other.

## Backend daemon

The Rust daemon runs under `launchd` and is **read-only**: it reads the ledger, runs
the decision, and writes the conclusion to the log and to
`~/.config/mcode-reset-card/daemon-status.json`. It performs **no write operations**.

If the ledger can't be read it says so explicitly ("no conclusion this round") and
escalates the warning as consecutive failures pile up — it never pretends the answer
is "you have no cards and no credits".

```bash
cd daemon/rust && cargo test --release   # 25/25
./reset-card-daemon once                 # one round, prints the conclusion
./reset-card-daemon status               # print the current conclusion only
```

## Local MCP endpoint

The plugin declares one MCP endpoint (`server=expiry-guardian`,
`path=/mcp/expiry-guardian`) so other plugins can ask it directly:

| Tool | What it does |
| --- | --- |
| `watchdog_status` | Quota, cards, credits and the current conclusion from the ledger |
| `watchdog_decide` | Decide right now — **decides only, never spends a card** |

⚠️ **Spending a card is deliberately not exposed**: it is a real write operation, and
letting another plugin spend your card on a whim is too dangerous.

## Configuration

`~/.config/mcode-reset-card/config.json` (read by Rust, the Mini App and Python):

```json
{
  "schemaVersion": 1,
  "cardTriggerPercent": 99,
  "cardSkipBeforeResetMinutes": 60,
  "quotaLevels": { "tight": 80, "low": 95 }
}
```

Config fields are **rebuilt from a whitelist** (`normalizeConfig`): a missing field is
a silently dead channel, so the config shape has to be changed in **three** places
(Rust config, the Mini App's `normalizeConfig`, and the real `config.json`).

## Tests

| Suite | Result |
| --- | --- |
| Rust (`daemon/rust`) | **25/25** |
| Python decision unit tests | **20/20** |
| Mini App (`tests/`) | **102/102** |
| Three-way parity | **19/19** |
| Upstream `npm run validate` | **OK** for this plugin (0 errors, 0 warnings); `repository: OK` |
| Upstream `npm test` | 69/69 |

One Mini App test is a **static guard** (`tests/server-lint.test.mjs`): it catches
identifiers that are used but never declared. It exists because of a real incident —
a typo in the dashboard's data layer made the whole snapshot throw, so the panel
(quota, decision, cards) was **completely broken**, while the unit tests kept passing
because they only cover the pure `decide()` function. The data layer itself was never
executed. The guard makes that class of error fail loudly.

## What v1.x used to do

The full history is in git (the v1.1–v1.6 commits). v1.x spent cards, paused goals,
and revived crashed Bots by reading the account API and other plugins' data — all of
which a community plugin must not do.

The hardening v1.x added — tolerant JSON parsing, judging "is it broken?" by the
latest *turn* rather than a stale error code, per-instance request ids, failure
counters that reset only on success, the static guard — **survived into v2.0**; it
just guards the local ledger now instead of the host's private state.

## Tested environment

- **MiniMax Code 3.1.2 or later.**
- Verified on macOS; the upstream checks run on **Node 20**.
- The Rust daemon needs a Rust toolchain to build (`cargo build --release`).

## Data & access

This plugin reads and writes **only its own directory**:

| Path | What |
| --- | --- |
| `~/.config/mcode-reset-card/ledger.json` | The ledger **you** maintain (read by the panel, writable from the panel's editor) |
| `~/.config/mcode-reset-card/config.json` | Shared configuration (trigger lines) |
| `~/.config/mcode-reset-card/daemon-status.json` | The backend daemon's latest conclusion |

It deliberately does **not**:

- read MiniMax Code's **login credentials** (no lease socket, no `.cap` file, no token on disk)
- open or write **`~/.minimax/v2/sqlite/runtime-state.sqlite`** (the host's internal database)
- read **another plugin's data directory** (e.g. `~/.minimax/v2/plugin-data/liveboards/*/state.json`)

It performs **no write operations** outside its own directory: it never spends a
reset card, never pauses a goal, and never writes into another plugin's sessions.
The backend daemon is optional — the dashboard works on its own.

## Boundaries

- **No host credentials, no host database, no other plugins' data** (hard constraints)
- **No write operations** — spending a card and pausing a goal are yours to click
- The conclusion is advice only: it is based on a ledger *you* wrote
- Incomplete data yields *no* conclusion rather than a guess

## Documentation

- [docs/README.zh-CN.md](docs/README.zh-CN.md) — Chinese documentation
