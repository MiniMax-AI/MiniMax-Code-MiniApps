# Mini App Agent API

Verified against MiniMax Code 3.1.2. Earlier clients reject packages that declare `agentAccess`.

A Mini App can run Agent turns from its Node entry (`context.agent`) or its page
(`window.mcode.miniapp.agent`). The Agent keeps its full capabilities: files, shell, Skills, and MCP,
including this Mini App's own MCP tools. Declare it only when the Mini App genuinely needs an Agent
at runtime; a page that only prepares text for the user to send should use
`window.mcode.miniapp.message.append` instead (see `docs/client.md`).

## Grant

```json
{
  "agentAccess": ["session.run"],
  "agentConcurrency": 4
}
```

- `agentAccess` in `miniapp/miniapp.json` is the only grant. Absent or `[]` means no access:
  `context.agent` is absent and page calls reject with `not_permitted`.
- `"session.read"` (MiniMax Code 3.1.4 or later, observed on 3.1.4-preview) adds read access to
  sessions: on the page, `agent.session()` with no argument returns the chat the Mini App is open in
  (`sessionId`, `title`, `agent`, `status`, `workspaceDir`, `isDefaultWorkspace`, `createdAtMs`,
  `updatedAtMs`, `model`, `lastAssistantText`) and rejects with `not_permitted` when it is not open
  in a chat; `agent.session(sessionId)` reads one session and `agent.sessions()` lists the user's
  sessions with their titles and folders. Read only what you need and say so in the README.
- `agentConcurrency` (1–32, default 4) caps how many turns of this Mini App run at once. Each session
  runs one turn at a time. Further `run` / `answer` calls wait in order, up to four times
  `agentConcurrency`; beyond that they fail with `busy`.
- Changing either field restarts the Mini App process when the package is updated.
- State in the README `## Data & access` that the Mini App runs Agent turns and what it asks them
  to do (see `docs/security.md`).

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

## Calls

Node calls take an options object `{ signal?, onEvent? }`; page calls take `{ onEvent? }` and use
`requestId` with `cancel(requestId)` instead of a signal.

| Call | Result |
| --- | --- |
| `run({ text, sessionId?, model?, agent? })` (page also `requestId?`) | `{ sessionId, turnId?, model?, status, text?, error?, pendingQuestion? }` when the turn ends. `status` is `finished`, `error`, or `aborted`; `text` is the final reply. `text` input is at most 100,000 UTF-16 code units. |
| `answer({ sessionId, answers, model? })` with `requestId` (Node) or `questionId` (page) naming the questionnaire | Same as `run`, for the continuation turn. |
| `reply({ sessionId, requestId, decision })` | Decides a waiting `permission.requested`; `decision` is `allowOnce` or `deny`. There is no "always allow". |
| `models()` | `{ models, default, host? }`: the models the user can use, the runtime default, and (page only) the chat's current model. `default` and `host` can be passed as `model` directly. |
| `agents()` | `{ agents }`: each `{ name, displayName, primary }`. |
| `create({ agent? })` | `{ sessionId }`, without running a turn. |
| `open(sessionId)` (page only) | Shows the session as a tab in the side panel of the chat the Mini App is open in, where the user can read it and answer its cards. Idempotent. |
| `cancel(requestId)` (page only) | Cancels that call; unknown or finished ids do nothing. |

- A model is `{ providerId, modelId, variant?, thinking?: { effort } }`. Build it from a `models()`
  entry; pick `variant` from `variants` and `effort` from `thinking.efforts`. `variant: ''` means
  thinking is off and must be passed as is.
- Call `context.agent` from request handlers, never inside `start(context)`.
- Node allows 16 outstanding `run` / `answer` / `models` / `agents` / `create` requests (shared with
  Host Connector requests) plus 16 for `reply`, so a full queue can still answer approvals.

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
| `run.queued` | All slots are taken; `position` is the call's 1-based place in line. Sent once, before the turn. |
| `turn.started` | The turn began; `model` is the model it runs with. |
| `text.delta` | The next piece of the streaming reply. |
| `message.committed` | One complete assistant message; a turn can have several. |
| `tool.started` / `tool.finished` | The Agent called tool `name`; `ok` is `false` when it failed. |
| `permission.requested` | Tool `toolName` waits for `reply`; carries `requestId`, `reason`, `toolInput?`. |
| `question.requested` | The turn paused on a questionnaire; carries `requestId`, `mode`, `request`. |
| `turn.finished` | Always last; same `status`, `text?`, `error?` as the result. |

## Errors

Node errors carry `code` and `retryable`; page errors are an `Error` whose `message` is the code.

| Node `code` | Page `message` | Meaning |
| --- | --- | --- |
| `NOT_PERMITTED` | `not_permitted` | No `agentAccess`, or (page `open`) the Mini App is not open in a chat. |
| `BUSY` | `busy` | The session already runs a turn, or the queue is full. Retryable. |
| `SESSION_NOT_FOUND` | `session_not_found` | Not a session this Mini App owns. |
| `INVALID_ARGUMENTS` | `invalid_request` | Malformed input, an unusable model, or `agent` on an existing session. |
| `AGENT_UNAVAILABLE` | `runtime_unavailable` | Nothing was started; retry later. Also returned to a page or process left over from before a restart. |
| `REQUEST_CANCELLED` | `cancelled` | Cancelled before anything ran. |
| `AGENT_OUTCOME_UNKNOWN` | `result_unknown` | The turn may have run. Never retry automatically; check the session first. |
| `REQUEST_NOT_FOUND` | `request_not_found` | The permission request or questionnaire is unknown or already settled. |

A cancelled turn resolves with `status: "aborted"` only when the Host confirmed the abort. A process
restart cancels in-flight turns, and reloading or closing the page cancels the page's turns.

The type declarations are in `examples/hello-miniapp/miniapp/node/miniapp-api.ts` (Node) and
`examples/hello-miniapp/miniapp/client/client-api.ts` (page).
