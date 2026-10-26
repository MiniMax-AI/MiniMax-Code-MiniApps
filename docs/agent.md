# Mini App Agent API

Verified against MiniMax Code 3.1.6. Clients before 3.1.2 reject packages that declare
`agentAccess`, and clients before 3.1.5 reject `"session.read"`.

A Mini App can run Agent turns from its Node entry (`context.agent`) or its page
(`window.mcode.miniapp.agent`). The Agent keeps its full capabilities: files, shell, Skills, and MCP,
including this Mini App's own MCP tools. Declare it only when the Mini App genuinely needs an Agent
at runtime; a page that only prepares text for the user to send should use
`window.mcode.miniapp.message.append` instead (see `docs/client.md`).

## Grant

```json
{
  "agentAccess": ["session.run", "session.read"],
  "agentConcurrency": 4
}
```

- `agentAccess` in `miniapp/miniapp.json` is the only grant. Absent or `[]` means no access:
  `context.agent` is absent and page calls reject with `not_permitted`.
- `"session.run"` runs Agent turns in this Mini App's own sessions: `run`, `answer`, `reply`,
  `cancel`, `open`, `models`, `agents`, `create`.
- `"session.read"` (MiniMax Code 3.1.5 or later) lists, reads, and observes the user's own
  conversations, including the final reply of every turn: `sessions()`, `session()`, and
  `observe()` (see [Reading and observing the user's sessions](#reading-and-observing-the-users-sessions)).
  It does not let the Mini App run, answer, or continue those conversations.
- The two values are independent; declare both when the Mini App needs both. Either one lets the
  Mini App read and observe its own sessions.
- `agentConcurrency` (1–32, default 4) caps how many turns of this Mini App run at once.
- Changing any of these fields restarts the Mini App process when the package is updated.
- The user can switch either value off in the plugin details (MiniMax Code 3.1.5 or later). The
  Mini App keeps running and `context.agent` stays; calls covered by that value fail with
  `NOT_PERMITTED` / `not_permitted` until the user switches it back on. Show an explanation in the
  page instead of failing.
- State in the README `## Data & access` that the Mini App runs Agent turns or reads the user's
  conversations, and what it does with them (see `docs/security.md`).
- Feature-detect calls added after 3.1.2 with `capabilities?.has(...)`: `agent.observe`,
  `agent.sessions`, and `agent.session` exist from 3.1.5.

## Sessions

Each Mini App owns its sessions and can continue only those. They are hidden from the user's
session list.

| | Page-initiated new session | Node-initiated new session |
| --- | --- | --- |
| Agent | The agent of the chat the Mini App is open in; the primary agent when it is not open in a chat. | The primary agent. |
| Working directory | That chat's project directory when it has one; otherwise this Mini App's own Agent directory. | This Mini App's own Agent directory. |
| Model | A snapshot of that chat's model and thinking level; the runtime default otherwise. | The runtime default. |

- Pass `agent` (a `name` from `agents()`) to `create` or to the first `run` to start the session as
  another agent. The alias `main` is rejected. A session never changes its agent; passing `agent`
  when continuing is `INVALID_ARGUMENTS` / `invalid_request`.
- A continued session keeps its agent and directory. Its model is fixed at creation and does not
  follow later changes in the chat; pass `model` to `run` or `answer` to switch it first.
- `create({ agent? })` makes a session without running a turn and returns `{ sessionId }`. A page can
  create a session bound to its chat and hand the `sessionId` to its Node code to continue there.
- Inside a session this Mini App started, the Agent cannot publish, restart, or stop Mini Apps, and
  `@`-mentions do not start other Mini Apps. Sessions it delegates to sub-agents are not covered.

## Calls

Node calls take an options object `{ signal?, onEvent? }`; page calls take `{ onEvent? }` and use
`requestId` with `cancel(requestId)` instead of a signal.

| Call | Result |
| --- | --- |
| `run({ text, sessionId?, model?, agent?, whenBusy? })` (page also `requestId?`) | `{ sessionId, turnId?, model?, status, text?, error?, pendingQuestion? }` when the turn ends. `status` is `finished`, `error`, `aborted`, or (only with `whenBusy`) `steered`; `text` is the final reply. `text` input is at most 100,000 UTF-16 code units. |
| `answer({ sessionId, answers, model? })` with `requestId` (Node) or `questionId` (page) naming the questionnaire | Same as `run`, for the continuation turn. |
| `reply({ sessionId, requestId, decision })` | Decides a waiting `permission.requested`; `decision` is `allowOnce` or `deny`. There is no "always allow". |
| `models()` | `{ models, default, host? }`: the models the user can use, the runtime default, and (page only) the chat's current model. `default` and `host` can be passed as `model` directly. |
| `agents()` | `{ agents }`: each `{ name, displayName, primary }`. |
| `create({ agent? })` | `{ sessionId }`, without running a turn. |
| `open(sessionId)` (page only) | Shows the session as a tab in the side panel of the chat the Mini App is open in, where the user can read it and answer its cards. Idempotent. |
| `cancel(requestId)` (page only) | Cancels that call or observer; unknown or finished ids do nothing. |
| `sessions()`, `session()`, `observe()` | See [Reading and observing the user's sessions](#reading-and-observing-the-users-sessions). |

- A model is `{ providerId, modelId, variant?, thinking?: { effort } }`. Build it from a `models()`
  entry; pick `variant` from `variants` and `effort` from `thinking.efforts`. `variant: ''` means
  thinking is off and must be passed as is.
- Call `context.agent` from request handlers, never inside `start(context)`.
- Node allows 16 outstanding `run` / `answer` / `models` / `agents` / `create` requests (shared with
  Host Connector requests) plus 16 for `reply`, so a full queue can still answer approvals.

### Follow-ups while the session is busy (`whenBusy`)

From MiniMax Code 3.1.5, `run({ sessionId, text, whenBusy })` decides what happens when that session
is already running a turn; without `whenBusy` the call fails with `busy`. On an idle session both
values just start a turn.

- `'queue'`: the text waits in the session queue and runs as its own turn after the turns ahead of
  it. You get `run.queued` with its queue `position`, then the call resolves like any `run`.
  Cancelling it removes the text from the queue.
- `'steer'`: the text is handed to the running turn, which reads it at its next step and adjusts its
  work. You get `message.pending`, then `message.steered`, and the call resolves with
  `status: 'steered'` and no `text`: the reply arrives with the running turn's own call. If that
  turn answers before reading the text, the text runs as the next turn and the call follows it like
  `'queue'`. A steered text cannot be withdrawn.

For a chat-style Mini App, send each incoming message with `whenBusy: 'queue'` and post each result's
`text`; use `'steer'` for messages meant to change the work in progress, and post nothing for a
`steered` result. If the user stopped the session while messages were queued, a `whenBusy` call
waits behind them until the user resumes the queue; it keeps its run slot meanwhile, so cancel it
to free the slot.

### Limits

- At most `agentConcurrency` turns per Mini App run at once, one per session. Further `run` /
  `answer` calls wait in order, up to four times `agentConcurrency`; beyond that they fail with
  `busy`.
- A Mini App starts at most 12 turns per 60 seconds, or 5 × `agentConcurrency` when that is larger
  (MiniMax Code 3.1.5 or later). Past that, calls fail with `busy`. The count survives a Mini App
  restart.
- Node sees why a call is `BUSY` in `reason`: `session_busy`, `queue_full`, `rate_limited`, or
  `observer_limit`. The page only receives `busy`.

## Interaction

Two interactions block a turn. The Mini App renders them itself, or lets the Host do it with the
page's `open(sessionId)`:

- `permission.requested` → `reply`: a tool call waits for approval.
- `question.requested` → `answer`: the turn paused on a questionnaire (a question to the user, a
  feature enable, or a plan review). The same questionnaire is in `result.pendingQuestion`, so a run
  without `onEvent` can render it too. Call `answer` only after the paused `run` has resolved; an
  earlier `answer` fails with `busy`.

A permission request waits only while someone can answer it: the run that owns the session passed
`onEvent`, or the session is open in a chat side panel through `open`. Otherwise the Host denies it
and tells the model that nobody can answer. A run that passes `onEvent` must handle
`permission.requested`, or it waits until it is cancelled or the page closes; there is no timeout.
When the Agent delegates to a child session, the child's requests arrive with the child's
`sessionId` and `turnId`; reply with those and do not filter events by the root turn.

```js
async function runWithApproval(agent, text, confirmTool, askUser) {
  const onEvent = (event) => {
    if (event.type !== 'permission.requested') return;
    void confirmTool(event.toolName, event.reason)
      .then((allowed) =>
        agent.reply({ sessionId: event.sessionId, requestId: event.requestId, decision: allowed ? 'allowOnce' : 'deny' }),
      )
      .catch(() => {}); // request_not_found: the run was cancelled meanwhile
  };
  let result = await agent.run({ text }, { onEvent });
  while (result.pendingQuestion) {
    const answers = await askUser(result.pendingQuestion.request);
    // Node names the questionnaire `requestId`; the page names it `questionId`.
    result = await agent.answer(
      { sessionId: result.sessionId, requestId: result.pendingQuestion.requestId, answers },
      { onEvent },
    );
  }
  return result;
}
```

`answers` holds one `{ stepId, selectedOptionIds, selectedOther, otherText?, skipped? }` per
questionnaire step.

## Events

`onEvent` receives events in this vocabulary. Every event except `run.queued` carries `sessionId`.
Ignore any `type` you do not know; new types may be added.

| Event | Meaning |
| --- | --- |
| `run.queued` | The call waits; `position` is its 1-based place in line. Sent once per wait, before the turn: for a run slot, or with `whenBusy: 'queue'` for the session queue. |
| `message.pending` / `message.steered` | Only with `whenBusy: 'steer'`: the text was handed to the running turn, then read by it. `message.steered` is the call's last event. |
| `turn.started` | The turn began; `model` is the model it runs with. |
| `text.delta` | The next piece of the streaming reply. |
| `message.committed` | One complete assistant message; a turn can have several. |
| `tool.started` / `tool.finished` | The Agent called tool `name`; `ok` is `false` when it failed. |
| `permission.requested` | Tool `toolName` waits for `reply`; carries `requestId`, `reason`, `toolInput?`. |
| `question.requested` | The turn paused on a questionnaire; carries `requestId`, `mode`, `request`. |
| `turn.finished` | Last unless the call ended `steered`; same `status`, `text?`, `error?` as the result. |

## Reading and observing the user's sessions

These calls exist from MiniMax Code 3.1.5. They need `"session.read"`, except for this Mini App's own
sessions, which either `agentAccess` value covers. They change nothing: a lost answer is
`AGENT_UNAVAILABLE` / `runtime_unavailable` and safe to retry.

- `sessions()` resolves with `{ sessions }`, the 50 most recently updated user conversations, each
  `{ sessionId, title?, agent, status, workspaceDir, isDefaultWorkspace, createdAtMs, updatedAtMs }`.
  `status` is `idle`, `running`, `error`, or `aborted`; `isDefaultWorkspace` is `true` when the
  conversation has no project. Mini App, scheduled, and sub-agent sessions are not listed.
- `session(sessionId)` adds `model?`, `error?: { message }` while `status` is `error`, and
  `lastAssistantText?`, the final text of the latest reply.
- On the page, `session()` without an id reads the chat the page is open in, for example to work in
  its project directory; it resolves with `undefined` outside a chat. That chat is the user's
  conversation, so it needs `"session.read"` too. Node has no current chat: the page passes the id.
- `observe({ all: true }, { onEvent })` reports `turn.started`, `message.committed` (the final
  reply), and `turn.finished` of every user conversation, each with `sessionId` and the
  conversation's `title` when it has one. `observe({ sessionId }, { onEvent })` reports every
  progress event of one session, turn after turn. Pass exactly one target.
- An observer never receives `permission.requested` or `question.requested`, and cannot answer
  them. `turn.started` carries `model` only when the Host could read it, and `turn.finished` comes
  without `text` when the Host could not read the final reply; read `session()` if you need it.
  When events back up, `text.delta` and `tool.*` events may be dropped, never the start, the final
  reply, or the finish.
- `observe` resolves when the subscription ends: Node aborts its `signal`, the page calls
  `cancel(requestId)` with the `requestId` it passed, the session is deleted, the Mini App stops, or
  the user switches `"session.read"` off. It rejects when it could not start. At most 4 observers per
  Mini App (`busy`); they use no run slots. Missed events are not replayed, so refresh with
  `session()` after re-subscribing.

## Errors

Node errors carry `code` and `retryable`; page errors are an `Error` whose `message` is the code.

| Node `code` | Page `message` | Meaning |
| --- | --- | --- |
| `NOT_PERMITTED` | `not_permitted` | Not declared in `agentAccess`, switched off by the user, or (page `open`) the Mini App is not open in a chat. |
| `BUSY` | `busy` | The session already runs a turn, the queue is full, the per-minute limit was hit, or 4 observers are running. Retryable. |
| `SESSION_NOT_FOUND` | `session_not_found` | Not a session this Mini App may use. |
| `INVALID_ARGUMENTS` | `invalid_request` | Malformed input, an unusable model, `agent` on an existing session, or not exactly one `observe` target. |
| `AGENT_UNAVAILABLE` | `runtime_unavailable` | Nothing was started; retry later. Also returned to a page or process left over from before a restart. |
| `REQUEST_CANCELLED` | `cancelled` | Cancelled before anything ran, or removed from the session queue. |
| `AGENT_OUTCOME_UNKNOWN` | `result_unknown` | The turn may have run, or a steered text could not be withdrawn. Never retry automatically; check the session first. |
| `REQUEST_NOT_FOUND` | `request_not_found` | The permission request or questionnaire is unknown or already settled. |

A cancelled turn resolves with `status: "aborted"` only when the Host confirmed the abort. A process
restart cancels in-flight turns, and reloading or closing the page cancels the page's turns.

The type declarations are in `examples/hello-miniapp/miniapp/node/miniapp-api.ts` (Node) and
`examples/hello-miniapp/miniapp/client/client-api.ts` (page).
