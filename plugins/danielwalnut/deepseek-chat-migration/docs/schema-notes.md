# DeepSeek export schema notes

Research date: 2026-11-17.

## Primary source

The parser's version-3 path follows DeepSeek's open-source `deepseek-ai/chat-demo` implementation:

- [`src/services/chat/history/format.ts`](https://github.com/deepseek-ai/chat-demo/blob/main/src/services/chat/history/format.ts)
- [`src/services/chat/history/schema.ts`](https://github.com/deepseek-ai/chat-demo/blob/main/src/services/chat/history/schema.ts)
- [`src/services/chat/history/README.md`](https://github.com/deepseek-ai/chat-demo/blob/main/src/services/chat/history/README.md)

That source defines `manifest.json` with `export_format_version: 3`,
`chat_sessions/{session_id}.json`, `chat_session_index.json`, and optional image entries.
Session files contain an `id`/`parent_id` message tree and `current_message_id`. Message fragments
include `REQUEST`, `RESPONSE`, `THINK`, `TOOL_SEARCH`, `TOOL_OPEN`, `TOOL_FIND`, `READ_LINK`,
`FILE`, `TOOL_IMAGE_SEARCH`, notices, template responses, and partial-file markers.

## Corroborating community sources

- [`urumchi/deepseek-keeper`](https://github.com/urumchi/deepseek-keeper), especially
  `src/dskeeper/parser.py`, confirms an older official `conversations.json` export with a
  `mapping` tree, message `fragments`, ZIP/JSON inputs, and conversation-ID dedupe.
- [`Lumjiel/deepseek-mindtrace`](https://github.com/Lumjiel/deepseek-mindtrace) documents the
  flat API-era `chat_session` + `chat_messages` shape and `message_id`/`parent_id` branches.
- [`niushuanan/dsh-chat-migration`](https://github.com/niushuanan/dsh-chat-migration) confirms
  selective preview, duplicate skipping, original ordering, and preservation of exported thinking
  as practical migration behavior.

The app does not use the scraping or authenticated-fetch paths found in some community tools.

## Native MiniMax Code session migration

The Mini App runtime context documented by this repository exposes `context.dataDir`, but that is
the plugin's private state directory and is not the MiniMax Code target data directory. It exposes
no active Agent name. The migration therefore always targets the current user's `~/.minimax`
directory and the `mavis` agent; neither is user-configurable.

The importer is bundled in `miniapp/python/` (listed under `artifacts.node`), so no other plugin is
needed. It is adapted from the MiniMax Code team's `agent-session-migration` plugin (author:
Insider): `deepseek_core.py` keeps that plugin's storage core, `import_deepseek.py` its
checkpointed job, and `deepseek_export.py` reads the export. This app streams the uploaded ZIP to a
temporary path under `context.dataDir`, runs `import_deepseek.py plan` into a fresh report,
displays it, and runs `apply` on the same report only after explicit confirmation. The command is
spawned directly as `python3` with an argument array and no shell.

`apply` does not copy the database. Each run opens an undo journal at
`<data-dir>/deepseek-migration/<run>/undo.json` (format `deepseek-undo/1`) on its first write, then
commits batches of `--batch-size` sessions (the Mini App passes 10). A preview, and
each batch's re-check, share one open ZIP and one read snapshot of the target; the snapshot is
closed before the batch writes. stderr carries one JSON line per step:
`{"event":"start","total":N}` and, after every batch,
`{"event":"progress","done":n,"total":N,"sessions":[{"sourceId","status"}]}`. The Node runtime folds
these into `GET /api/migration/progress?planId=`, which the page polls every 500 ms, and records
rows in `state.json` as they land.

### What one import writes, and how undo reverses it

Per new session, inside the batch transaction:

| Target | Change | Undo |
| --- | --- | --- |
| `local_runtime_projects` | INSERT the `~/DeepSeek` project only if it does not exist; otherwise UPDATE its `hidden` (to 0, `--restore-projects`) and `extra_data_json` (restore marker) | delete it if this run created it and it is empty; otherwise put back the journaled before-image of `hidden` and `extra_data_json`, unless something else changed them since |
| `local_runtime_sessions` | INSERT | DELETE |
| trigger `trg_local_runtime_project_session_insert_v5` | sets the session's `project_id`, updates the project's `latest_activity_at_ms` and `session_count` | the delete trigger recomputes both |
| `local_runtime_session_fts_keys`, `local_runtime_sessions_fts` | INSERT one key row and one FTS row | DELETE by the journaled rowids |
| `local_runtime_message_rows` | INSERT the history rows | DELETE by the journaled ids |
| `local_runtime_pi_history_file_migrations` | INSERT | DELETE |
| `v2/sessions/<dated dir>/` | `messages.jsonl`, `manifest.json`, `deepseek-source.json`, `deepseek-migration.json` (marker, with `undoRun`), plus any parent folders it had to create | removed when only these files remain; anything else is moved to `deepseek-migration/<run>/undone/` |

No other existing row is updated. `sqlite_sequence` counters are left advanced. Before each batch
commits, its journal entries are `pending`; after the read-back they become `committed` with the
message-row and FTS rowids and a fingerprint (record hash, `updated_at_ms`, title, archive state,
message-row count and last id, history hash, file list). A failed batch marks its entries
`rolled-back`.

`import_deepseek.py undo --report <job.json>` (or `--run <undo.json>`) takes the same write lock,
compares every session with its fingerprint, and refuses with exit code 3 and the changed fields
if any was used since the import, unless `--force`. It deletes in one transaction, reads back that
no row is left, cleans up files, then marks the journal `undone` and the report `undone`, so a
stale report cannot be applied again. Running it twice reports everything as already absent. A
session re-imported by a later run carries that run's `undoRun` and is left alone.

### Opening the DeepSeek project

`docs/client.md` (MiniMax Code 3.1.11+) lists `host.navigation.open` targets `home`, `plugins`,
`schedule`, `settings` (with a section) and `{ id: 'session', sessionId, source: 'local' }`. There
is no project or workspace target and no session-list filter. So **打开 DeepSeek 项目**, in the
header at all times and in the result dialog, opens the most recent session of the DeepSeek
project from the click handler. `GET /api/project` finds it with `import_deepseek.py project`
(a read-only query on the `mavis` agent and the `~/DeepSeek` workspace), falling back to the
latest row in `state.json`. With nothing imported, without that API, or when it rejects (other
than `result_unknown`), the page calls `POST /api/workspace/open`, which creates `~/DeepSeek` if
needed and opens it with `open`, `explorer.exe` or `xdg-open`.

Report entries are `{sourceId, status, error?, plan}` with status `ready`, `already-imported`,
`imported`, `incompatible`, `failed` or `running`; the UI shows them as ready, skipped, imported
or failed, and reads the target session id from `plan.targetId`.

The target is the runtime's `v2/sqlite/runtime-state.sqlite` (columnar version 3, session data
version 4) plus `v2/sessions/<dated dir>/messages.jsonl`. The target agent must already have at
least one native session. Sessions without a working directory are attached to the `~/DeepSeek`
workspace project.

## Observed production export

An export inspected on 2026-11-17 contained 177 sessions, 326 user turns and seven sessions with
branches. It included request, response, thinking, search and file fragments. ZIP local headers
used the data-descriptor flag (`0x08`), so the reader takes compressed sizes and offsets from the
central directory. No user data from that export is included in this repository.

## Unconfirmed or intentionally unsupported

- Whether every production account has moved from `conversations.json` to format version 3.
- Whether production ZIPs ever use data descriptors, ZIP64, encryption, or compression methods
  beyond STORE and DEFLATE. The official implementation currently writes STORE.
- Semantics of unknown future fragment types. They are ignored rather than mixed into answers.
- Attachment availability outside version-3 image entries. Metadata is preserved; binaries found
  under the official session `_files` path are copied into generated archives, while absent
  binaries remain references.
- The exact meaning and stability of API-era `status`, `feedback`, token-usage, and file fields.
- Legacy `mapping` exports do not consistently expose an explicit role; the parser infers it from
  `REQUEST` and `RESPONSE` fragments when needed.
