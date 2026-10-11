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

The ledger groups records by turn, following the `turn_id` recorded in the session file. Each record is classified as user, answer, narration, thinking, tool call, tool result, system, or compaction, and each turn header carries that turn's own Token counts and elapsed time. Selecting a record opens a detail panel with summary, raw JSON, tool arguments, tool result, and reasoning, plus a button that hands the record to the Agent's chat input.

**The type chips are the only filter over kinds.** One thing is being filtered — which record kinds are visible — and it is one array in the client, written from exactly three controls: the eight kind buttons, 全部, and 清除筛选. An earlier version also had a row of layer buttons (turn / thinking / call) sitting above the list as presets over those same chips. They were removed, because any preset a reader outgrows becomes a button that contradicts the chips it was supposed to summarise: untick 问答 while leaving 用户 ticked, and the turn button goes dark and claims the conversation is hidden when in fact it was narrowed. One control that cannot drift is worth more than three convenient ones that can. Two further controls cut across kinds instead of over them: a time range, which bounds the ledger to a wall-clock window, and an anomaly filter, whose rules pick out records that are wrong — a failed tool call, a compaction, a turn that never got an answer, an answer that came back empty — rather than records of a particular kind. Neither rewrites the kind array, so every kind chip still answers exactly one question.

Naming kinds directly costs one extra click and reaches everything a preset did — tick 用户 *and* 答复 for the conversation, untick both for its absence, and any scattered subset in between, such as only the user's questions or only system records.

A kind is whatever the filter can act on, which is the rule that decided 压缩 being a kind of its own rather than a `system` record with a different title. Filed under `system`, a context checkpoint could not be kept or dropped on its own and unticking 系统 took every checkpoint with it — the same "one question, two answers" problem the layer buttons had, hiding in a second field instead of a second row of controls.

The one control that is **not** a filter is 总览轴, in the window bar under the strip: it switches the strip between equal width and a real time axis. It was labelled 时长 and sat with the filters at the top of the page, which made it read as a filter on duration — it changes neither the rows nor any count on the page. Its label now names the strip and both axes, and it sits directly under the thing it changes.

Unticking a kind drops those rows from the render entirely. No placeholder summary row is left behind, so nothing on screen can miscount what it covers, and a chip is the only way to bring them back. The kinds are independent, so unticking one never takes part of another with it, and each turn header recomputes from the rows that survive, which makes every count you see under a filter a real post-filter count. Nothing marks a turn as filtered: the figures moving is the signal, and a label repeating that on every turn is noise.

Values that the session file does not record are rendered as `—`. Nothing is inferred or filled in: a tool call with no matching result has no duration, an assistant message carries no model attribution if the file omitted it, and a message with no Token usage shows no Token usage.

Assistant text arrives in two roles and they are filed separately. **答复** is the answer a turn ended on, and it is not a judgement call: `stopReason` records why the model stopped, and `stop` means it finished, so that text is the delivered answer. **过程** is the text it wrote on the way to a tool call, where `stopReason` is `toolUse`. In an agentic session the two are nowhere near equal — 51 answers against 901 preambles in a typical working session — so filing them together buries the answers under several times their own volume. An assistant message is always displayed in one fixed order — **reasoning, then the answer, then the tool calls it asked for** — regardless of the order the blocks appear in the session file. Token usage stays with the answer; a message that produced reasoning but no answer shows its usage on the reasoning block, because that is all the message contains.

**Two numbers that look like they should match, and what makes them match.** A turn either ends with
exactly one reply (`stopReason: stop`) or with none — measured over every prompted turn in a
working session, 54 closed, 5 stopped to ask the reader something, 4 were cut off. So the turn
count and the reply count are the same number seen twice, and the KPI card says which each one
means: the headline is the turns somebody typed into, and the line under it splits them into
closed, waiting on the reader, and cut off. Those parts sum to the headline.

**问答 is a prompted turn that has not closed, not a turn of its own.** It is the turn whose last record
is the "waiting for the local user" result of `ask_user` or `request_feature_enable`. The reader's
answer never reaches the trajectory file as a record — the tool result in the asking turn only ever
says the questionnaire is waiting — so the turn that answers has no prompt of its own and is filed
as a continuation: still conversation, still one reply. An earlier version filed *that* turn as 问答,
which meant a turn could be labelled 问答 while the reader still had not answered, and turns holding
hundreds of tool calls were labelled a Q&A. There is no record and no filter called 问答 for the same
reason: nothing in the file describes one.

**A message the reader sent while a turn was still running is filed as 追加, apart from 用户.** One turn can
hold several of them — the prompt that opened it, plus whatever arrived while the agent was still
working — and only the first counts as dialogue, so the message count and the turn count stop
disagreeing. Nothing in the file marks it: compared field by field, a 追加 is byte-identical to a typed
prompt in role, `stopReason`, api, model, provider, tokens and `producedBy`. The signal available is
position — measured across every turn that has a prompt, it sits at record 1 or 2 and never further
in — so this is an inference from ordering, not a fact the file asserts, and the detail panel says
so where it shows.

One model call produces one row per block, so a rail down the left edge joins the rows that arrived together — a response split into reasoning, answer and tool calls reads as one unit. A response that produced a single row shows a dot instead. The grouping is also stated in each row's tooltip, so it is never conveyed by position alone. Tool results are not model responses, carry no rail, and are not joined to the call that caused them.

When a session has been compacted, the runtime does not trim it in place: it rotates the previous `messages.jsonl` into `snapshots/`, opens a new generation, and starts a fresh active file. **The ledger still shows the whole conversation.** The app walks the generation chain the same way the runtime does — it opens the active file, reads the generation that file declares, and steps back one generation at a time through the parent each file names — and then concatenates every reachable generation oldest-first. A snapshot whose parent generation is not exactly one lower ends the chain rather than being stitched on, and a snapshot the chain never reaches (a fork leaves those behind) is reported as an orphan instead of being shown.

A **上下文代** (context generation) picker appears once a session has more than one generation, so the ledger can be narrowed to any single slice; it defaults to **全部（默认）**, the whole lineage. Narrowing to an older generation says plainly that it is a frozen snapshot rather than live history, and the message tile then shows the session-wide total next to the slice.

## Data & access

**Files read.** The service resolves the session root in this order: the `MAVIS_HOME` environment variable, then `.minimax` in the home directory, giving `<dataDir>/v2/sessions`. Setting `MMC_TRAJECTORY_ROOT` replaces the data directory itself, for testing; `v2/sessions` and `v2/sqlite` are still resolved beneath it. From each session directory it reads `messages.jsonl` (the active generation), `manifest.json` (the session id and creation time), and `history-catalog.json` (the generation list, plus a committed byte length per artifact). Each snapshot reachable from the active generation is then read from `snapshots/`, bounded by the app's own 64 MB cap rather than by the length the catalog recorded, and only the first 64 KB of each candidate is needed to decide whether it belongs to the chain at all. A session that has never compacted has no `history-catalog.json` at all, and is read from its active file alone. It also opens `<dataDir>/v2/sqlite/runtime-state.sqlite` **read-only** to resolve which conversation is active and to read real session titles.

Reads are bounded by `MAX_MESSAGE_BYTES` and `readHead` clamps each one to the last complete line, so a file that is being appended to is never parsed mid-line; any unparsable line is skipped and counted. The cap in force is sent to the page with the payload and rendered from there, rather than written as a number in two places that then drift apart. The session directory name is `base64url(sessionId)`, so a session id can be recovered from the filename alone; the service cross-checks that against `manifest.json` and the database before reading any file.

Snapshot file names come out of `history-catalog.json`, which is data rather than code, so a name is only used when it is a plain basename with no path separator and no `..`, and the resolved path is then required to still sit inside the session directory. Both checks have to pass before anything is opened.

**Files written.** None. The runtime never writes to disk.

**Network.** None. The app makes no outbound requests, has no telemetry, and needs no credential configuration.

**Processes spawned.** None.

**State.** Cache state is kept in process memory only and is discarded on exit. Nothing is persisted between runs.

Session titles and message text are your real local data — take care when sharing screenshots or your screen.

Three details of the session format are worth knowing, because they change what you see:

- Host-injected blocks such as `<system-reminder>` are recorded with role `user` but are not user prompts. The service splits them off using the recorded `canonicalTextRange` and shows them as `系统` (system) records, so the ledger does not present injected context as something you typed.
- A `user` message whose text is only an injected block has no prompt, so sub-agent and background-task sessions legitimately show no user record.
- A `compactionSummary` message is the runtime's own context checkpoint — not something you or the model said. It gets its own type, 压缩 (compaction), rather than a `system` record with a different label, so you can keep or drop it on its own; that is also why the filter can see it. It holds no Token usage of its own, and reports the context size it replaced, so a long session shows where its earlier context went. Its detail panel also names the generation it opened, who produced it, and the revision it replaced.

## Diagnostics

The Node runtime also serves `GET /api/runtime`, a diagnostic route reporting what the process can observe about its own session identity: the Node version, whether the runtime database could be opened and which conversation it resolved to, and the basenames of the working and data directories. It returns names and structure only — every filesystem location is reduced to a bare filename, and no absolute path, process id or command-line argument appears in the response. An earlier version also returned the names of the environment variables and scanned them for anything shaped like a session id; those fields are gone, because handing the host process's environment to a page is a liability and the scan answered nothing this route still needs.

The Host assigns the listening port at startup and logs it as `miniapp.runtime.listening`. This route is the reason the claims in the next section were established rather than assumed, and it is the first thing to check when a build of MiniMax Code changes how the runtime is spawned. 

## How the active session is chosen

MiniMax Code does not tell a Mini App which conversation opened its page: the runtime context passed to `start(context)` has no session id, the Host bridge exposed to the page provides only `miniapp.message.append`, and the page URL carries no parameter. This app therefore infers the conversation and **always states how it decided**, in the page footer.

The runtime database is asked first. Among conversations (`session_kind = 'conversation'` with no `purpose`, not archived), it prefers one holding a live turn lease in `local_runtime_session_locks`, then one with status `started`, then the most recently updated. Cron runs and background worker tasks are excluded by `session_kind`.

If no conversation is running a turn, or the database cannot be read, the app falls back to the most recently written session file. If two or more conversations hold live turn leases at the same time, the app reports the ambiguity, names every candidate, and asks you to confirm instead of silently picking one.

The runtime database is opened in read-only mode. If it is missing, unreadable, or its schema no longer matches, the app degrades to the file-based heuristic rather than failing.

## Limits and known gaps

- The app depends on undocumented internal formats: the `v2/sessions` directory layout and the runtime database schema. A client update can change either, which may break session identification or parsing.
- Session identification is an inference, not a binding. With one conversation active it is reliable; with none running it degrades to most-recently-written.
- A single `messages.jsonl` is read up to 64 MB. Larger sessions are truncated and the page says so.
- The ledger does not use virtual scrolling; every rendered row is a real element. The page therefore opens on the newest 200 records, and the window bar button switches to the whole session. The button names what pressing it will do, not the current state: 「显示全部」 at the default and 「显示最新 200 条」 once everything is showing, while the count beside it reports what is on screen. That full view is opt-in for a reason: on a 9,900-record session it is roughly 57,000 elements rebuilt every 2.5s poll, which was measured to freeze the page rather than be read. 「向上加载更早的 N 条」 widens the window in steps and a poll does not undo it. A sticky window bar under the overview strip offers that choice behind four explicit controls: switch the strip between equal width and a real time axis, load 200 earlier records, jump back to the latest 200, and show everything. "Show everything" builds every record in the session into the DOM at once and gets noticeably slower on large sessions; incoming records do not knock it back down to 200.
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