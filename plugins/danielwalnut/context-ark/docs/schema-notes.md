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

## Unconfirmed or intentionally unsupported

- Whether every production account has moved from `conversations.json` to format version 3.
- Whether production ZIPs ever use data descriptors, ZIP64, encryption, or compression methods
  beyond STORE and DEFLATE. The official implementation currently writes STORE.
- Semantics of unknown future fragment types. They are ignored rather than mixed into answers.
- Attachment availability outside version-3 image entries. Metadata is preserved, but this
  prototype does not copy binaries into its generated archive.
- The exact meaning and stability of API-era `status`, `feedback`, token-usage, and file fields.
- Legacy `mapping` exports do not consistently expose an explicit role; the adapter infers it from
  `REQUEST` and `RESPONSE` fragments when needed.
