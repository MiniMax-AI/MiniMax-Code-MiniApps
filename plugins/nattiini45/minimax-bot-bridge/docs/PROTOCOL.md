# Protocol

Version `1`: one JSON frame per WebSocket message. Shared types and envelope
validation live in [`https://github.com/nattiini45/minimax-bot-mobile/blob/main/packages/protocol`](https://github.com/nattiini45/minimax-bot-mobile/blob/main/packages/protocol/src/types.ts).
Runtime behavior is implemented by the relay, bridge and app.

## Roles

| Role | Runs in | Talks to |
|---|---|---|
| `app` | Expo client on iOS / Android / web | relay |
| `bridge` | MiniMax Code Mini App plugin | relay, `@minimax-bot` tools, Host agent (approvals only) |
| `relay` | Cloudflare Worker + Durable Object | bridge, app |

WebSocket peer roles are `device` and `bridge`; the phone's frame source is `app`.
The relay authenticates peers, validates envelopes and routes events. It can read
the JSON and keeps a bounded plaintext event replay buffer in memory. There is no
application-level end-to-end encryption. It persists authentication state and device
metadata, but does not execute tools or require MiniMax account credentials.

## Frame envelope

```jsonc
{
  "v": 1,                     // protocol version
  "id": "f_9c1e",             // unique frame id
  "ts": 1793181000000,        // epoch ms
  "type": "op.send_message",
  "source": "app",            // app | bridge | relay
  "payload": { "chatId": "bot:chief", "text": "hello" },
  "opId": "op_1753_a91f"       // optional; operation deduplication key
}
```

Optional `in_reply_to` names the frame being answered. The relay alone adds `seq`
to bridge `evt.*` frames and `from` (device id) to device frames. Peers must not set
`seq` or `from`; the relay drops frames that do. Replies carry the operation id in
`payload.opId`, not at envelope level.

[`decodeFrame`](https://github.com/nattiini45/minimax-bot-mobile/blob/main/packages/protocol/src/frames.ts) validates required envelope
fields and optional field types, not payload schemas. Its errors are:

`MALFORMED_JSON` · `NOT_AN_OBJECT` · `UNSUPPORTED_VERSION` · `MISSING_ID` ·
`MISSING_TYPE` · `BAD_SOURCE` · `MISSING_TS` · `MISSING_PAYLOAD` · `BAD_SEQ` ·
`BAD_FROM` · `BAD_IN_REPLY_TO` · `BAD_OP_ID`.

## Frame types and connection setup

| Type | Direction | Purpose |
|---|---|---|
| `op.*` | app → bridge | Request; expects `ack` or `err` |
| `evt.*` | bridge → app | Notification; sequenced by relay |
| `hello.ok` | relay → app | Resume metadata after authenticated upgrade |
| `hello` | Declared legacy control type | Not used to authenticate current connections |
| `ack` | bridge → app | Operation result |
| `err` | bridge → app | Operation failure |

`isRequest()` and `isEvent()` are prefix checks. `OP_TYPES` and `EVENT_TYPES` list
the shared operation and event names.

A peer normally calls `POST /r/:accountId/ws-ticket` with
`Authorization: Bearer <token>`, then opens `/r/:accountId/ws` with `role`,
`subject`, `ticket` and, for resume, `lastSeq` query parameters. Tickets expire in
30 seconds; the running relay session rejects reuse. Authentication is part of
the upgrade. The relay sends `hello.ok` with `{ seq, bridgeOnline, truncated }`;
this is resume metadata, not a second credential exchange.

Both clients can fall back to a longer-lived `token` query parameter when ticket
acquisition or the ticket connection fails. URL logs or proxies may therefore
capture a token. Tickets reduce exposure; they do not guarantee credential-free
URLs. See [app client](https://github.com/nattiini45/minimax-bot-mobile/blob/main/apps/app/src/net/relay-client.ts) and
[bridge client](miniapp/node/relay-client.mjs).

## Operations (app → bridge)

`OP_TOOL` maps tool-backed operations. `TEAM_ROUTED_OPS`, `AGENT_BACKED_OPS` and
`BRIDGE_LOCAL_OPS` identify the remaining handlers. The tables summarize common
fields; live tool schemas govern tool arguments.

### Reading the team

| Operation | Handler | Payload | Result |
|---|---|---|---|
| `op.list_team` | `list_team` + desktop metadata | — | `{ bots, groups, diagnostics }` |
| `op.bot_avatar` | bridge local | `{ botId }` | `{ botId, mime, data, source }` |
| `op.list_history` | bridge memory | `{ chatId, limit? }` | `{ messages, reactions, activity? }` |
| `op.list_tasks` | `get_tasks` | `{ taskId? \| batchId?, waitMs?, resultOffset? }` | `{ tasks, batchIds?, partial?, note? }` |
| `op.list_helpers` | `list_helpers` | — | `{ helpers }` |
| `op.list_schedules` | `list_schedules` | — | `{ schedules }` |
| `op.get_usage` | bridge ledger | `{ days? }` | `{ buckets, byBot, totals }` |
| `op.list_models` | bridge local | — | `{ supported, default?, models }` |
| `op.list_capabilities` | bridge local | — | `{ skills, plugins, agents, mcp }` |

`op.list_models` is the Host's own model catalog: the models that can run, each with the
reasoning efforts it offers. The phone offers these as lists, because a model that is
not in the catalog cannot be picked and a model cannot be asked for an effort it does not
have. On a Host that does not let a run pick its model, `supported` is `false` and the
list is empty.

`op.list_capabilities` is what the desktop can do beyond answering in a chat: its
skills, its plugins, its agents and its MCP servers, read from the Host's installation.
The bridge reads them and never runs them — the phone puts a skill into a conversation's
composer, in the form the desktop writes it, `/name`, and the user decides what to ask
of it.

`op.bot_avatar` reads the desktop's uploaded picture or skin artwork and sends the
bytes base64-encoded in one frame. `source` is `avatar` or `skin`. Missing pictures
return an error; the client draws a fallback rather than bundling product artwork.

`op.list_history` merges the desktop's read-only team transcript with bridge-owned
messages and returns the latest 200 messages. The optional `limit` is currently
ignored. The bridge targets 50 chats of its own messages/activity, preserving
active chats above the target and evicting settled chats together. Hosted messages,
bridge-only notes and reactions are in memory and lost on restart. Team history
is reread from the desktop and survives a bridge restart. `activity` carries the
calls of retained turns, using the shared 400-call soft target: oldest whole turns
are dropped, but the newest and running turns stay even above the target. This is
not a hard cap on bridge activity memory. `ledger.json` persists usage, decisions,
access changes and batch ids, **not a transcript**.

The task tool queries one batch or task at a time. With neither id supplied, the
bridge queries its remembered dispatched batches and marks the list `partial: true`;
it is not a complete list of work started elsewhere.

### Acting

| Operation | Handler | Payload |
|---|---|---|
| `op.send_message` | team (`message_bot` / `post_group`) | `{ chatId, text, mentions?, attachments?, clientMessageId? }` |
| `op.abort_turn` | team (`cancel_tasks`) | `{ turnId }` |
| `op.dispatch` | `dispatch_tasks` | `{ botIds, prompt, title?, requestId? }` |
| `op.cancel_task` | `cancel_tasks` | `{ taskId \| batchId }` |
| `op.start_helper` | `start_helper` | `{ title?, task, targetBotId? }` |
| `op.stop_helper` | `stop_helper` | `{ helperId }` |
| `op.recall` | `recall` | `{ botId, query, limit?, key?, offset?, textOffset?, scope? }` |
| `op.remember` | `remember` | `{ botId, text, key?, replaceId?, scope?, pinned?, source? }` |
| `op.forget` | `forget` | `{ botId, id }` |
| `op.create_bot` | `create_bot` | `{ name, role?, instructions?, skin?, color?, model?, main? }` |
| `op.update_bot` | `update_bot` | `{ botId, … }` |
| `op.delete_bot` | `delete_bot` | `{ botId }` |
| `op.set_bot_mode` | bridge | `{ botId, mode }`, where `mode` is `hosted` or `team` |
| `op.create_group` | `create_group` | `{ name, memberIds, admin?, notice?, replyMode? }` |
| `op.update_group` | `update_group` | `{ groupId, … }` |
| `op.delete_group` | `delete_group` | `{ groupId }` |
| `op.create_schedule` | `create_schedule` | `{ name, kind, spec, targetBotId?, prompt? }` |
| `op.delete_schedule` | `delete_schedule` | `{ scheduleId }` |
| `op.react` | bridge memory | `{ messageId, emoji }` |

`op.update_bot` takes a Bot's `model` as `provider/model` (or `default` to follow the
desktop's own model) and its `effort` as one of the levels `op.list_models` reports for
that model (`default` for the model's own). A level the model does not offer is refused
by the desktop, so the phone only sends what the catalog lists.

### Agent interaction

`op.respond_permission` and `op.answer_question` use `context.agent`, and so does a
**hosted** turn: a turn the bridge owns is a run the Host lets the bridge answer for.
A **team** turn does not: the team owns that run, so the Bot answers with its own
instructions, model, effort and session, and the phone is told where a question has to
be answered.

| Operation | Payload |
|---|---|
| `op.respond_permission` | `{ requestId, decision }`, where `decision` is `allowOnce` or `deny` |
| `op.answer_question` | `{ requestId, answers[] }` |

### Where a turn runs

`CHAT_ROUTING` maps the chat a turn belongs to to the team tool that runs it:

| Chat id | Tool | Target |
|---|---|---|
| `bot:<botId>` | `message_bot` | `to: <botId>` |
| `group:<groupId>` | `post_group` | `group: <groupId>` |

The bridge hands the turn to the team itself, which answers with a durable receipt
and finishes the work later; the bridge asks `get_tasks` until the task settles, so
the reply is the Bot's own text. Mentions are translated from Bot ids to the
`@Name` the team reads before the text goes out, and a mention of a Bot the roster
does not know is dropped rather than sent as an id. The team's receipt carries the id
of the record the turn wrote into the desktop's own transcript, and the bridge reads
that record back: the parts it holds become the turn's messages and the tool calls it
recorded become the turn's activity. The phone therefore shows the exchange the
desktop shows, in the desktop's own order and under the desktop's own ids.

The tool calls of a team turn are not streamed while the turn runs. The desktop writes
its record when the turn ends, so the live view of a running turn is the time it has
been running; the whole exchange — the narration, the calls and the answer — arrives
with the turn's end. A task the team reports as `waiting_for_user` ends
the turn with a note saying where the answer is given.

A Bot's own chat can run the other way instead: **hosted**, on the desktop, under the
bridge. The Host only lets the Mini App that owns a run answer its questions, so this
is where a permission check or a questionnaire the Bot raises is answered from the
phone. The Bot keeps its name, role, instructions, model and effort, but uses a
separate bridge-owned session per Bot, reused for later hosted turns during that
bridge process. It does not continue the desktop Bot's session and is not written
into the desktop Bot app's transcript. `op.set_bot_mode` chooses, per Bot, and the choice is kept in the bridge's
configuration. A turn runs in the team unless the phone says otherwise, so that the
desktop's own conversation is the record of what was said. The roster carries the mode
back to the phone as `Bot.runMode`. A group is always the team's.

The thread a phone reads (`op.list_history`) is the desktop's own transcript for a turn
the team ran — the same messages, with the same ids the desktop shows — together with
the turns the bridge ran itself, which the desktop does not know about. Each message is
recorded once, by whoever owns it. The tool calls of those turns travel with it in
`activity`, so a thread opened after the fact shows the work a turn did and not only
the words it ended with.

Up to 32 turns may run concurrently; excess calls return retryable `BUSY` rather
than entering a bridge queue. `attachments` is declared in the contract but is not
forwarded by the current send handler.

## Events (bridge → app)

| Event | Payload |
|---|---|
| `evt.team_snapshot` | `{ bots, groups, diagnostics, tools }` |
| `evt.turn_started` | `{ chatId, turnId, startedAt? }` |
| `evt.message_chunk` | `{ chatId, turnId, messageId, text }` |
| `evt.message_committed` | `{ message }` |
| `evt.tool_started` | `{ chatId, turnId, toolName, callId }` |
| `evt.tool_finished` | `{ chatId, turnId, toolName, callId, ok, status?, usage?, error? }` |
| `evt.turn_finished` | `{ chatId, turnId, status, reason?, text?, error? }` |
| `evt.permission_requested` | `{ request }`, where the request carries the `chatId` it was raised in |
| `evt.permission_resolved` | `{ requestId, decision }` |
| `evt.question_requested` | `{ request }`, where the request carries the `chatId` it was asked in |
| `evt.question_answered` | `{ requestId }` |
| `evt.task_updated` | `{ task }` |
| `evt.helper_updated` | `{ helper }` |
| `evt.schedule_updated` | `{ schedule }` |
| `evt.bridge_status` | `{ desktopOnline, agentAvailable, teamToolsAvailable, linkedAt? }` |
| `evt.reaction_added` | `{ reaction }` |

### Agent event translation

| Agent event | Protocol event |
|---|---|
| `turn.started` | `evt.turn_started` |
| `text.delta` | `evt.message_chunk` |
| `message.committed` | `evt.message_committed` |
| `tool.started` | `evt.tool_started` |
| `tool.finished` | `evt.tool_finished` |
| `permission.requested` | `evt.permission_requested` |
| `question.requested` | `evt.question_requested` |
| `turn.finished` | `evt.turn_finished` |

The shared chunk type permits `final?`. Normal team transcript replay emits no
chunks; the unreadable-transcript fallback can emit one chunk with `final: true`.
Use message commits and `evt.turn_finished` as completion signals. The bridge
assigns `callId` to correlate repeated calls of the same tool.

These are the Host agent's events, and they apply to a run the bridge itself owns: a
**hosted** turn, and the continuation of an answered question. A team turn is not
translated from Host agent events: the team reports the finished result, and the
bridge publishes that.

## Sequencing, resume and idempotency

- **Sequencing:** the relay stamps `seq` on bridge `evt.*` frames. The client drops
  already-applied sequence numbers and detects gaps.
- **Replay:** the relay retains a plaintext event tail in memory, bounded by 512
  entries and 4 MiB by default. The sequence counter is persisted; the replay ring
  is not. `lastSeq` requests events after that cursor; `truncated: true` signals a
  gap and prompts app resynchronization. A fresh snapshot cannot restore chat text
  already lost by a bridge restart.
- **Frame size:** incoming frames over 512 KiB are dropped before JSON parsing.
  Account status includes `droppedFrames`.
- **Deduplication:** the bridge keys its process-local cache by operation type,
  sender and `opId` (falling back to frame id). Entries expire after ten minutes;
  a shared 500-entry cap can evict them earlier, including in-flight entries.
  Retries reuse cached outcomes only while retained. Restart, expiry or eviction
  can repeat effects: this is best effort, not durable exactly-once execution.
- **Control frames:** `ack`, `err`, `hello` and `hello.ok` are not sequenced or
  buffered for replay. The current relay broadcasts bridge replies to connected
  devices; clients correlate them using `in_reply_to` / `payload.opId`.

## HTTP surface

Relay routes are prefixed `/r/:accountId`. HTTP token authentication uses
`Authorization: Bearer <token>` unless the upgrade query is specified below.

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/ws` | GET (upgrade) | `role`, `subject`, `ticket` (or fallback `token`) in query | Connect bridge or device |
| `/ws-ticket` | POST | bridge or device bearer token | Issue connection ticket |
| `/pair/code` | POST | bridge bearer token | Issue pairing code; default 5 min, clamped 1–15 min |
| `/pair` | POST | pairing code in body | Exchange code for device token |
| `/status` | GET | bridge or device bearer token | Presence, counts, `lastSeq`, `droppedFrames` |
| `/devices` | GET | bridge bearer token | List device metadata, excluding token/hash |
| `/devices/:deviceId` | DELETE | bridge bearer token | Revoke device |
| `/devices/me` | DELETE | device bearer token | Release own credential |
| `/bridge/token` | POST | bridge bearer token | Rotate token and revoke older tokens |
| `/bridge/token` | DELETE | bridge bearer token | Revoke tokens issued at or before current cutoff |

The browser WebSocket API cannot set an Authorization header, so the upgrade uses
a query credential. Bridge tokens require an `acc` claim matching the path and the
account's owner bridge id when set. Device tokens are checked against the account's
device registry. See [Pairing](PAIRING.md) for storage and renewal limits.

## Bridge loopback surface

The bridge listens on the Host-assigned loopback address. Its handler checks `Host`,
optional `Origin` and fetch metadata. Mutations require JSON content type and the
per-process `x-bridge-secret`; sensitive reads require the secret too. A native
local caller can obtain the secret with matching headers: this is not native
process isolation or a human-only API. Additional live Host hardening is not
established by these repository checks.

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Liveness |
| `/api/session` | GET | Obtain per-process surface secret after caller checks |
| `/api/status` | GET | Bridge and relay state, diagnostics, pending count |
| `/api/pair/code` | POST | Ask relay for pairing code |
| `/api/devices` | GET | Paired devices |
| `/api/devices/:deviceId` | DELETE | Revoke device |
| `/api/snapshot` | GET | Team snapshot and tool catalogue |
| `/api/config` | POST | Update relay settings and credential |
| `/api/rotate-token` | POST | Rotate bridge token |

## Error handling

Example complete bridge error frame:

```json
{
  "v": 1,
  "id": "f_error_1",
  "ts": 1793181000000,
  "type": "err",
  "source": "bridge",
  "in_reply_to": "f_9c1e",
  "payload": {
    "opId": "op_1753_a91f",
    "code": "INVALID_ARGUMENTS",
    "message": "A required tool argument is missing.",
    "retryable": false
  }
}
```

`retryable` indicates whether the bridge classifies the failure as retryable. It
does not extend the deduplication window. Tool argument errors can additionally
include `payload.details` with schema-derived field-name lists such as `missing`,
`required`, `unmapped` and `properties`; the full `inputSchema` is not returned.

Relay errors include `UNAUTHORIZED`, `PAIRING_CODE_INVALID`, `PAIRING_CODE_EXPIRED`,
`PAIRING_CODE_UNKNOWN`, `DEVICE_REVOKED`, `BRIDGE_OFFLINE`, `BAD_REQUEST`,
`ACCOUNT_OWNED` and `RATE_LIMITED`. See `RelayErrorCode` / `describeRelayError` in
[`pairing.ts`](https://github.com/nattiini45/minimax-bot-mobile/blob/main/packages/protocol/src/pairing.ts).

## Schema-driven tool arguments

The bridge reads each live tool's `inputSchema` and uses an alias table to map
operation fields (`botId` → `to` / `bot_id` / `target`, `text` → `message` /
`content`, …). Mapping or validation failures return `INVALID_ARGUMENTS` with
field-name details, rather than assuming a fixed parameter spelling.

Sources: [tool gateway](miniapp/node/tools.mjs),
[bridge handlers](miniapp/node/bridge.mjs),
[agent translation](miniapp/node/agent.mjs),
[relay session](https://github.com/nattiini45/minimax-bot-mobile/blob/main/packages/relay/src/session.ts),
[relay HTTP routes](https://github.com/nattiini45/minimax-bot-mobile/blob/main/packages/relay/src/index.ts).
