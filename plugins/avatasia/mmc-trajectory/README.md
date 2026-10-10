# Session Trajectory

English | [简体中文](README.zh-CN.md)

Browse the model trajectory of a MiniMax Code conversation: messages, reasoning, tool calls and their results, Token usage, and per-turn timing.

Author: [avatasia](https://github.com/avatasia) · Version: `1.0.0`

## Install and use

Copy this entire directory into your active MiniMax Code data directory, including the hidden `.minimax-plugin` directory. By default, `<dataDir>` is the `.minimax` directory in your home folder (`~/.minimax`), so plugins go in `~/.minimax/plugins/`. If you have configured a different data directory, use that directory instead:

```text
<dataDir>/plugins/mmc-trajectory/.minimax-plugin/plugin.json
```

The author directory is only used to group contributions in the community repository; the installed path does not include it. Restart a MiniMax Code version that supports MiniApps, confirm the plugin is recognized and enabled, and open "会话轨迹" (Session Trajectory) from the `@` menu, or ask the Agent to open it.

The page follows the most recent conversation by default and re-reads it every 2.5 seconds, so it stays live while you work; it pauses while the page is hidden. Each read is validated with an HTTP `ETag`: when the session file has not grown, the service answers `304 Not Modified` with no body and the page keeps what it already rendered. An idle tab therefore costs a few bytes per poll instead of the whole trajectory. Use the session picker to switch to any other conversation. No API key and no dependency installation are required — the package is dependency-free and needs no build step.

## What it shows

The ledger groups records by turn, following the `turn_id` recorded in the session file. Each record is classified as user, assistant, thinking, tool call, tool result, or system, and each turn header carries that turn's own Token counts and elapsed time. Selecting a record opens a detail panel with summary, raw JSON, tool arguments, tool result, and reasoning, plus a button that hands the record to the Agent's chat input.

The toolbar's turn, thinking, and call toggles are layer switches rather than collapse controls: turn governs the conversation layer (user and assistant messages), thinking governs the model's reasoning, and call governs the tool layer (tool calls and tool results).

**The three buttons and the type chips are two handles on one piece of state, not two filters.** Only one thing is ever being filtered — which record kinds are visible — and the buttons are presets over it: turn = user + assistant, thinking = thinking, call = tool call + tool result. Switching a button off unchecks exactly the kinds it covers, and editing the chips moves the button that covers them. Running them as two independent filters is how the same question ends up with two answers that contradict each other.

The chips stay for that reason: they express subsets no button combination can reach, such as only the user's questions or only system records.

A button therefore has three states, based on how many of the kinds it covers are checked. **All** of them lit, the button is lit. **None**, it reads 当前已隐藏 · 点击显示. **Some**, it reads 当前部分显示 · 点击全部显示. That last one is the only case where clicking a button changes a selection the reader did not directly ask about — unchecking 助手 while leaving 用户 checked does not hide the conversation, so the button does not claim it did, and it says that clicking fills the layer in rather than pretending to be a plain toggle. Thinking is a layer of its own rather than riding along with turn because the two answer different questions — someone reading the conversation usually wants it in the way, and someone looking at how the model reached a conclusion usually wants it out. Turning one off drops those rows from the render entirely — no placeholder summary row is left behind, and the button is the only way to bring them back. The three layers do not overlap, so switching off one never takes part of another with it, and each turn header recomputes from the rows that survive, which makes every count you see under a filter a real post-filter count.

Values that the session file does not record are rendered as `—`. Nothing is inferred or filled in: a tool call with no matching result has no duration, an assistant message carries no model attribution if the file omitted it, and a message with no Token usage shows no Token usage.

An assistant message is always displayed in one fixed order — **reasoning, then the answer, then the tool calls it asked for** — regardless of the order the blocks appear in the session file. Token usage stays with the answer; a message that produced reasoning but no answer shows its usage on the reasoning block, because that is all the message contains.

One model call produces one row per block, so a rail down the left edge joins the rows that arrived together — a response split into reasoning, answer and tool calls reads as one unit. A response that produced a single row shows a dot instead. The grouping is also stated in each row's tooltip, so it is never conveyed by position alone. Tool results are not model responses, carry no rail, and are not joined to the call that caused them.

When a session has been compacted, the runtime does not trim it in place: it rotates the previous `messages.jsonl` into `snapshots/`, opens a new generation, and starts a fresh active file. **The ledger still shows the whole conversation.** The app walks the generation chain the same way the runtime does — it opens the active file, reads the generation that file declares, and steps back one generation at a time through the parent each file names — and then concatenates every reachable generation oldest-first. A snapshot whose parent generation is not exactly one lower ends the chain rather than being stitched on, and a snapshot the chain never reaches (a fork leaves those behind) is reported as an orphan instead of being shown.

A **上下文代** (context generation) picker appears once a session has more than one generation, so the ledger can be narrowed to any single slice; it defaults to **全部（默认）**, the whole lineage. Narrowing to an older generation says plainly that it is a frozen snapshot rather than live history, and the message tile then shows the session-wide total next to the slice.

## Data & access

**Files read.** The service resolves the session root in this order: the `MAVIS_HOME` environment variable, then `.minimax` in the home directory, giving `<dataDir>/v2/sessions`. An `MMC_TRAJECTORY_ROOT` environment variable overrides the whole path for testing. From each session directory it reads `messages.jsonl` (the active generation), `manifest.json` (the session id and creation time), and `history-catalog.json` (the generation list, plus a committed byte length per artifact). Each snapshot reachable from the active generation is then read from `snapshots/`, bounded by the length the catalog recorded, and only the first 64 KB of each candidate is needed to decide whether it belongs to the chain at all. It also opens `<dataDir>/v2/sqlite/runtime-state.sqlite` **read-only** to resolve which conversation is active and to read real session titles.

The catalog length bounds the read so a file that is being appended to is never parsed mid-line; any unparsable line is skipped and counted. The session directory name is `base64url(sessionId)`, so a session id can be recovered from the filename alone; the service cross-checks that against `manifest.json` and the database before reading any file.

Snapshot file names come out of `history-catalog.json`, which is data rather than code, so a name is only used when it is a plain basename with no path separator and no `..`, and the resolved path is then required to still sit inside the session directory. Both checks have to pass before anything is opened.

**Files written.** None. The runtime never writes to disk.

**Network.** None. The app makes no outbound requests, has no telemetry, and needs no credential configuration.

**Processes spawned.** None.

**State.** Cache state is kept in process memory only and is discarded on exit. Nothing is persisted between runs.

Session titles and message text are your real local data — take care when sharing screenshots or your screen.

Three details of the session format are worth knowing, because they change what you see:

- Host-injected blocks such as `<system-reminder>` are recorded with role `user` but are not user prompts. The service splits them off using the recorded `canonicalTextRange` and shows them as `系统` (system) records, so the ledger does not present injected context as something you typed.
- A `user` message whose text is only an injected block has no prompt, so sub-agent and background-task sessions legitimately show no user record.
- A `compactionSummary` message is the runtime's own context checkpoint — not something you or the model said. It is labelled `压缩` (compaction) rather than `系统`, holds no Token usage of its own, and reports the context size it replaced, so a long session shows where its earlier context went. Its detail panel also names the generation it opened, who produced it, and the revision it replaced.

## Diagnostics

The Node runtime also serves `GET /api/runtime`, a diagnostic route reporting what the process can observe about its own session identity: the Node version, the count and names of environment variables, whether any environment value or argv entry has the shape of a session id, and whether the runtime database could be opened and what it resolved to. It returns names and structure only — filesystem locations are reduced to a bare filename, and no absolute path appears in the response.

The Host assigns the listening port at startup and logs it as `miniapp.runtime.listening`. This route is the reason the claims in the next section were established rather than assumed, and it is the first thing to check when a build of MiniMax Code changes how the runtime is spawned. On the verified build it reports 13 environment variable names, with no environment value and no argv entry matching a session id.

## How the active session is chosen

MiniMax Code does not tell a Mini App which conversation opened its page: the runtime context passed to `start(context)` has no session id, the Host bridge exposed to the page provides only `miniapp.message.append`, and the page URL carries no parameter. This app therefore infers the conversation and **always states how it decided**, in the page footer.

The runtime database is asked first. Among conversations (`session_kind = 'conversation'` with no `purpose`, not archived), it prefers one holding a live turn lease in `local_runtime_session_locks`, then one with status `started`, then the most recently updated. Cron runs and background worker tasks are excluded by `session_kind`.

If no conversation is running a turn, or the database cannot be read, the app falls back to the most recently written session file. If two or more conversations hold live turn leases at the same time, the app reports the ambiguity, names every candidate, and asks you to confirm instead of silently picking one.

The runtime database is opened in read-only mode. If it is missing, unreadable, or its schema no longer matches, the app degrades to the file-based heuristic rather than failing.

## Limits and known gaps

- The app depends on undocumented internal formats: the `v2/sessions` directory layout and the runtime database schema. A client update can change either, which may break session identification or parsing.
- Session identification is an inference, not a binding. With one conversation active it is reliable; with none running it degrades to most-recently-written.
- A single `messages.jsonl` is read up to 64 MB. Larger sessions are truncated and the page says so.
- The ledger renders only the newest 200 records by default rather than using true virtual scrolling. A sticky window bar offers three explicit controls: load 200 earlier records, jump back to the latest 200, and show everything. "Show everything" builds every record in the session into the DOM at once and gets noticeably slower on large sessions; incoming records do not knock it back down to 200.
- `messageCount` and `turnCount` in the session picker are estimates derived from a bounded prefix of the file; exact values come from the selected session.
- Light theme token coverage is verified — every `--mcode-*` token the page consumes is defined for both themes — but its rendered appearance was not visually checked; the page was exercised under a dark system preference.

## Tested environment

- **MiniMax Code:** 3.1.1.178 (desktop, Windows build)
- **Operating system:** Windows 10.0.26200 (x64)
- **Node in the Mini App runtime:** v24.18.0

Verified manually in the client: publishing and startup, live polling during an active turn, session switching, type filtering, record inspection, and error states. A 19.6 MB session loads without truncation. Session resolution was cross-checked against the conversation title shown in the client and against the session's own manifest.

**Not verified:** macOS and Linux, and the light theme's rendered appearance. Compatibility with unofficial or source builds is also unverified.

Source layout: the page is `miniapp/client/index.html` and the Node service is `miniapp/node/server.mjs`. No build step and no third-party dependency is required; `miniapp/node/miniapp-api.ts` is a type declaration only and is never imported at runtime.

## License

[MIT](LICENSE).