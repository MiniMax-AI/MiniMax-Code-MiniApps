# Mini App tool API

Verified against MiniMax Code 3.1.6. Clients before 3.1.5 reject packages that declare
`toolAccess`.

`context.tool` lets the Node entry call the tools installed on the user's MiniMax Code: every
plugin's MCP servers (this one's included), the user's own MCP servers, the Host's built-in MCP
servers, and every Connector provider the user has connected. Agent built-in tools such as files,
shell, and browser are not reachable. Declare it only when the Mini App really calls tools.

```json
{ "toolAccess": ["call"] }
```

- `context.tool` is present whenever the manifest declares `"toolAccess": ["call"]`, the only
  accepted value. `hostConnectorAccess` does not grant it.
- The grant only lets the Mini App ask. Every call is judged by the user's permission rules, and the
  user may be prompted.
- The user can switch `tool:call` off in the plugin details. `context.tool` stays and nothing
  restarts: new calls fail with `TOOL_NOT_PERMITTED`, `list()` reports every tool as `deny`, and
  `request()` answers `deny` without a prompt. A call already running finishes.
- Feature-detect with `context.capabilities?.has('tool')`, and `has('tool.request')` before using
  `request()`.
- List in the README `## Data & access` which tools the Mini App calls and why.

## Listing and calling

```js
const { tools, partial } = await context.tool.list();
const search = tools.find((tool) => tool.kind === 'mcp' && tool.server === 'notes' && tool.tool === 'search');
if (search && search.permission !== 'deny') {
  const result = await context.tool.call(search.name, { query: 'budget' }, { signal });
}
```

- A tool is called by the runtime name an Agent sees: `mcp__<server>__<tool>` or
  `connector__<provider>__<tool>`. The Host may shorten or disambiguate MCP names, so take `name`
  from `list()`, matching on `kind`, `server` or `provider`, and `tool`; do not build it.
- `list()` returns `{ tools, partial }`; each tool is
  `{ name, kind, server | provider, tool, description?, inputSchema, permission }`. `permission`
  (`allow`, `ask`, or `deny`) is what a call would meet now; every call is judged again. `partial` is
  true when a source could not be listed (a Connector login, an MCP server still starting); the
  listed tools still work.
- Call `call()` from request handling, never inside `start(context)`.
- A Connector result is `{ invocationId, kind: 'connector', value }` with the provider's raw value.
  An MCP result is `{ invocationId, kind: 'mcp', isError, content, structuredContent? }`;
  `isError: true` is the tool reporting its own failure, so show `content` rather than treating it
  as a transport error.
- Connector calls time out after 30 seconds and MCP calls after at most 120 seconds, counted after
  any prompt. A result over 8 MiB fails with `TOOL_RESULT_TOO_LARGE` even though the tool ran; have
  such a tool return a file path or URL instead.
- A server this Mini App serves through `mcpEndpoints` runs in the same Node process: call your own
  function instead of `context.tool`.

## Permission

Each call meets the user's global permission rules and global permission mode, as an Agent would.
Agent and session rules do not apply, because the call belongs to no Agent or session.

- `allow` runs the tool. With no rule, MCP and Connector tools are allowed, as for an Agent;
  arguments that name paths outside the Host's data directory ask.
- `deny` fails with `TOOL_NOT_PERMITTED`.
- `ask` shows a Host prompt naming this Mini App, the tool, and the arguments, with **Allow once**,
  **Always allow**, and **Deny**. Always allow writes the same global rule as the chat approval
  card, so it also applies to Agents. The prompt appears when the Host window is visible or this
  Mini App has an open page; otherwise the call fails with `TOOL_APPROVAL_REQUIRED`. It waits at
  most five minutes (`TOOL_TIMEOUT`).
- The Host owns the prompt. Mini App code cannot draw, answer, or skip it. Plugin hooks do not run
  for these calls.

### Asking ahead with `request()`

When the Mini App calls tools while nobody is watching, ask for "always allow" while the user is
present:

```js
// Page, inside a click handler such as a "Connect tools" button.
const states = await window.mcode?.miniapp?.tool?.request([searchName, sendName]);
// Node, while a page of this Mini App is open.
const state = await context.tool.request([searchName]);
```

- One Host prompt lists the named tools that are still `ask`, each with a checkbox. The result maps
  every name to its state afterwards; it is for your UI only.
- The page may call `request()` only inside a user gesture, with 1 to 10 names; otherwise it
  rejects with `invalid_request`. Names come from Node `list()`, passed to the page through your
  own route. The page has no `list()` or `call()`.
- In Node, when nobody can be asked, `request()` rejects with `TOOL_APPROVAL_REQUIRED` and the error
  carries `permissions`, the unchanged state.

## Errors

Errors carry `code`, `message`, `disposition`, and `retryable`. Only `disposition` says whether the
tool may have run: `not_dispatched` means it did not, so retrying is safe when `retryable` is
true; `unknown_after_dispatch` means it may have, so read the domain state before repeating a
write. The Host never retries.

| `code` | Cause | `disposition` |
| --- | --- | --- |
| `INVALID_ARGUMENTS` | The name is not listed (list again), or the arguments or name list are malformed | `not_dispatched` |
| `TOOL_NOT_PERMITTED` | `tool:call` switched off, a deny rule, or the user chose Deny | `not_dispatched` |
| `TOOL_APPROVAL_REQUIRED` | The rules ask and no Host window can show the prompt | `not_dispatched` |
| `TOOL_REF_STALE` | The tool disappeared between listing and the call; list again | `not_dispatched` |
| `TOOL_UNAVAILABLE` | Tools are not available to this process yet | `not_dispatched` |
| `MCP_SERVER_UNAVAILABLE` | The MCP server failed or is still starting (retryable) | `not_dispatched` |
| `SERVICE_RESTARTED` | The Mini App is restarting (retryable) | `not_dispatched` |
| `TOOL_TIMEOUT` | The prompt or the call ran out of time | either; retryable only when `not_dispatched` |
| `REQUEST_CANCELLED` | Your `signal` aborted the call | either |
| `TOOL_RESULT_TOO_LARGE` | The tool finished but its result exceeds 8 MiB | `unknown_after_dispatch` |
| `TOOL_OUTCOME_UNKNOWN` | The outcome was lost, for example because the channel closed | `unknown_after_dispatch` |

Connector tools also keep their Connector codes, such as `CONNECTOR_PROVIDER_ERROR` and
`CONNECTOR_UNAVAILABLE`. Page `request()` rejects with an `Error` whose `message` is
`invalid_request`, `not_permitted`, `approval_required`, `runtime_unavailable`, or `result_unknown`.

The type declarations are `MiniAppToolClient` in `examples/hello-miniapp/miniapp/node/miniapp-api.ts`
and `MiniAppToolRequestAPI` in `examples/hello-miniapp/miniapp/client/client-api.ts`.
