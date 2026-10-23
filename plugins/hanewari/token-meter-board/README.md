# Token Meter Board

English | [简体中文](README.zh-CN.md)

A near-real-time token-usage dashboard for MiniMax Code, running entirely on your own machine. It reads the session records the client writes for your own conversations — the same source the official gallery's token-usage board uses — and nothing else. It never opens the runtime's internal database, its observability logs or its configuration file.

Author: [HaneWari](https://github.com/HaneWari) · Version: `2.0.0` · License: [Apache-2.0](LICENSE)

![Token Meter Board, synthetic data](docs/preview.png)

*The preview uses synthetic sessions and usage data. The app interface is currently in Chinese.*

## What you get

- **Usage trend** — stacked bars per model with the cache-hit-rate curve drawn on top. Buckets adapt from minutes to hours to days as the window grows.
- **Five detail tables** — per-model breakdown, daily totals, a **per-call ledger**, a **conversation (turn) table**, and a session ranking.
- **Conversation detail** — one row per question you asked. The row shows the session it belongs to, whether it is finished, how many model calls the turn took, and the tokens. A turn that is still running is marked as running and grows live — you do **not** have to close the session first.
- **Per-call ledger** — every model call with its timestamp, model, all four token classes and how the call ended.
- **Time windows** — last hour / today / last 7 days / last 30 days, or any custom start and end. The time bar is laid out in two rows so the native date picker can never cover the *Apply* button, and pressing Enter inside a time field applies the window too.
- **5-second auto refresh** with a manual refresh button. Switching a window never blanks the tables and never waits: the previous window stays on screen until the new values arrive, and a late response from an older window is discarded rather than overwriting the newer one.

## What it reads, and what that costs

The board reads one kind of file:

```text
<dataDir>/v2/sessions/<YYYY>/<MM>/<DD>/<session>/messages.jsonl
```

Each line of a transcript is one message. An assistant message carries the token counts the runtime recorded for that call:

```json
{ "role": "assistant", "model": "MiniMax-M3.1-Flash", "timestamp": 1792769579471,
  "stopReason": "toolUse",
  "usage": { "input": 1204, "output": 331, "cacheRead": 61044, "cacheWrite": 0, "totalTokens": 62579 } }
```

That is enough for everything this board shows: token usage, model distribution, daily trend, per-call detail, turn grouping and turn status.

Two things the transcripts do **not** carry, and therefore two things this board does not show:

- **No timings.** There is no decode duration and no request duration in a transcript, so there is no token speed to compute. Output speed is gone in this version, and the page says so instead of showing an empty column.
- **No paths.** A transcript has no workspace directory, so the session ranking shows no absolute path.

Two more things the board deliberately does not show, even though the data would allow it:

- **No message text.** The conversation table identifies a turn by its session, not by your own words. The per-turn preview of the first 200 characters of your message is gone.
- **No model display names.** A transcript records the raw model id, so the tables show `MiniMax-M3.1-Flash` rather than a name looked up in the client's configuration file.

## Coverage: what the transcripts do not keep

Session records are not a complete accounting of what the client did. When a long conversation is compacted, the runtime replaces the compacted part of the transcript with a summary, and the calls inside that part are no longer in any `messages.jsonl`.

On the reference machine used for development (measured 2026-10-23), the board counted **8,640 calls across 151 sessions**, covering everything from 2026-06-17 onwards. The client's own internal ledger — which this board does not read — held **13,124** calls over the window it keeps (2026-09-28 onwards).

Restricting both sides to the **same window** (2026-09-28 onwards):

| | Session records | Internal ledger | Coverage |
| --- | --- | --- | --- |
| Calls | 8,422 | 13,124 | **64.2%** |
| Total tokens | 1,133,235,393 | 2,099,198,213 | **54.0%** |

The difference is calls that were compacted out, not calls that were mis-counted. It works the other way round too: the ledger's earliest row is 2026-09-28, more than three months after the transcripts begin — **the ledger itself has passed its retention window**, and those 220 calls survive only in the session records.

So: **these numbers are what your session records still contain, not a bill.** The client's own "usage" page remains the authoritative figure for billing and quota, and it is computed server-side.

## Why this one

- **It only reads your own session records.** No internal database, no observability logs, no client configuration. The same source the official gallery's `mcode-token-usage-board` uses — with two additions on top: a **per-call ledger** and a **turn-level table with live status**.
- **Incremental, not re-read.** A full scan of every transcript on the reference machine is ~344 MiB of JSON. The reader keeps a byte cursor per file and only parses what was appended since the last scan, so a full scan costs about **2.0 seconds** while each later refresh costs about **170 ms**. The cursor is persisted in the plugin's own data directory, so even a cold start of the Mini App resumes instead of re-reading everything.
- **No Python, no extra process, no dependency.** Pure Node, no third-party runtime code except a vendored copy of Chart.js. The subprocess fallback that the previous version needed for `node:sqlite` is gone with the database.
- **Strictly local.** The Mini App serves one page on `127.0.0.1` and answers its own API routes. It never contacts a remote host, and it makes no request other than to its own origin.

## Install

Copy this entire directory into the MiniMax Code data directory. By default `<dataDir>` is `.minimax` in your home folder (`~/.minimax`), so the default path is:

```text
<dataDir>/plugins/token-meter-board/
```

| System | Target path |
| --- | --- |
| Windows | `C:\Users\<you>\.minimax\plugins\token-meter-board` |
| macOS | `/Users/<you>/.minimax/plugins/token-meter-board` |
| Linux | `/home/<you>/.minimax/plugins/token-meter-board` |

Keep the hidden `.minimax-plugin` directory — the plugin is recognised by it. If you set a custom data directory (`MINIMAX_DATA_DIR`), use that directory's `plugins/` folder instead.

Restart MiniMax Code, confirm the plugin is enabled, then open **Token 仪表盘** (Token Meter Board), or just ask the Agent to open it.

## Use it

Pick a window (preset or custom), and read the trend, the KPI strip, and the five tables below it. Model chips filter the charts and tables; the sessions ranking and the daily table have their own independent range selectors, so changing the main window never disturbs them. The page refreshes every 5 seconds, and the refresh button forces an immediate reload.

Example prompts, and what you get back:

- **"打开 Token 仪表盘"** → the dashboard opens on the current window.
- **"查看我的模型用量趋势"** → the trend chart with the per-model stacked bars and the cache-hit-rate curve.
- **"哪个模型消耗最多？"** → the per-model table with calls, tokens and cache hit rate per model.

The board also offers **让 Agent 分析此窗口** (let the Agent analyse this window): it appends the current window's totals, call count, cache hit rate and turn count to the chat input so you can ask follow-up questions about the same numbers you were just looking at.

## Data & access

**Files read (read-only, never modified):**

| Path | Used for |
| --- | --- |
| `<dataDir>/v2/sessions/**/messages.jsonl` | The transcript of every session: token counts per model call, model id, timestamp, turn id and stop reason. |
| `<dataDir>/v2/sessions/**/manifest.json` | The session id of a session directory. |

Nothing else is read. The runtime's internal database (`v2/sqlite/runtime-state.sqlite`), its observability logs (`v2/observability/logs/`) and its configuration file (`config.yaml`) are **not** opened, in any mode.

The location is resolved from the Host-provided `context.dataDir` (the active MiniMax Code data directory), falling back to `~/.minimax`. **The transcript layout is not a published API** — it is the client's own storage, so a future client release may change it. When that happens the board shows an explicit error instead of an empty dashboard.

**What the page displays.** The dashboard renders real local data, which means a screenshot of it can contain:

- **Session titles** — the first 80 characters of your first message in that session, with injected system reminders removed. The same rule the official gallery's token-usage board uses. The message body itself is never loaded, and no per-turn preview is shown.
- **Session ids** and model ids.

Everything stays on the machine and on the page. If you plan to share a screenshot, remember that your own first question and your model list are in it.

**What is written.** Exactly one file: a scan cursor at `<plugin data dir>/session-scan-state.json`, written atomically (temp file + rename) when transcripts changed. It holds file paths, session ids, session titles and per-call counters so that a restart resumes instead of re-reading every transcript. It is a cache: deleting it only costs one full rescan. The page stores exactly one thing in your browser's `localStorage`: the theme choice, under the key `tmb-theme`.

**Network:** none. The Mini App serves one page on `127.0.0.1` and answers its own API routes. It never contacts a remote host, and it makes no request other than to its own origin. The query parameters it accepts are an explicit allow-list per endpoint — anything else, including anything that looks like a data-directory override, is dropped before the query runs. Requests whose `Host` header does not name the loopback interface, or whose `Origin` header does not name this listener, are refused with 403.

**Subprocess:** none. No process is spawned, and no shell is used.

**Node.js:** any Node.js that ships `node:fs/promises` and `node:http` — no experimental flag and no native module is needed. The bundled runtime used for testing is Node.js v24.18.0.

## Metrics

| Metric | Definition |
| --- | --- |
| Total tokens | `input + output + cacheRead + cacheWrite` — the four classes a transcript records. There is no reasoning class in a transcript, so it is not part of the sum. |
| Cache hit rate | `cacheRead / (cacheRead + input)` — the share of the prompt that came from cache. Cache writes are not in the denominator. |
| Conversation (turn) | One user message plus however many model calls the agent needed before answering. |
| Turn status | From the stop reason of the turn's last model call: `stop` → completed, `toolUse` → unfinished, `aborted` → aborted, no model call yet → running. |
| Calls | One assistant message that carries a usage block. Calls that were compacted out of a transcript are not visible. |

The same message can appear in more than one transcript when a session is rebuilt, so calls are de-duplicated by their message id.

The client interface shows its own figure over its own live session. The board uses the transcript records on a window you choose, so the two can differ: the interface counts what the runtime recorded, the board counts what the transcripts still contain.

## Tested environment

- MiniMax Code Desktop **3.1.4** (build 186), Windows 11 (10.0.22631, x64)
- Bundled Node.js **v24.18.0**
- Verified in the desktop client: plugin install, window switching, custom start/end windows, per-call ledger, live turn growth, auto refresh, light and dark themes, and the error path when no session records are found.
- macOS and Linux are **not** verified. Nothing in the code is platform-specific — the data paths are resolved from `context.dataDir` — but treat the other platforms as untested.

The full validation record for this release — package checker result, the coverage measurement against the internal ledger, and a same-machine performance measurement — is in [`docs/validation.md`](docs/validation.md).

## Limitations

- This is a **local observation tool**, not an invoice. Billing and quota are the product's own "usage" page, which is computed server-side and may catch up later.
- Numbers cover what your session records still contain. Calls that were compacted out of a transcript, and usage on another machine, are not visible here.
- The transcript format is internal to the client and can change without notice. If the layout changes, the board reports that instead of showing zeros.
- No token speed and no workspace paths, for the reasons above.

## Third-party components

- [Chart.js](https://www.chartjs.org/) v4.4.3 — vendored at `miniapp/client/vendor/chart.umd.min.js` for offline use. MIT License, © Chart.js Contributors. The full licence text ships with the package at `miniapp/client/vendor/LICENSE-chartjs.txt`.

## Source layout

```text
miniapp/
  client/index.html              The whole page: markup, styles, and the client script
  client/vendor/                 Chart.js (MIT), vendored for offline use
  client/vendor/LICENSE-chartjs.txt  Full MIT licence text for the vendored copy
  node/server.mjs                HTTP server, routing, the loopback guard
  node/lib/sessions.mjs          Transcript reader: incremental parse, de-duplication, aggregation
  node/lib/queries.mjs           Window, trend, summary, session, daily, call and turn queries
```

No build step is required: the page and the Node service are used as they are.

## License

[Apache-2.0](LICENSE) — see the file for the full text. The vendored Chart.js copy keeps its own MIT licence, reproduced in `miniapp/client/vendor/LICENSE-chartjs.txt`.
