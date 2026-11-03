# Mini App Node runtime

Verified against MiniMax Code 3.1.11.

## Loading

MiniMax Code imports `runtime.entry` as an ES module from a `file:` URL and requires a named export
`start`. The entry's real path must be inside the package. The manifest accepts `.js`, `.mjs`, and
`.cjs`; this repository requires ESM export syntax, so use `.mjs` and do not depend on
`package.json#type`.

```js
export async function start(context) {
  // install routes, start the server, return { dispose }
}
```

`miniapp/node/miniapp-api.ts` in `examples/hello-miniapp/` declares the types below. Copy it next
to your entry for editor type checking; it is never imported at runtime.

## `context`

| Field | Meaning |
| --- | --- |
| `pluginId` | The plugin ID (`plugin.json.name`). |
| `pluginRoot` | Real path of the installed package. Read your Client files from here. |
| `dataDir` | a private directory the Host creates and owns for this plugin; its location is opaque and may change; there is no supported way to reach Host files from it. Store durable state here. |
| `listen` | `{ host: "127.0.0.1", port }`. Bind exactly this address; never pick your own port. |
| `signal` | An `AbortSignal` that fires when the Host stops the Mini App. |
| `logger` | `debug` / `info` / `warn` / `error` `(message, fields?)`. Messages are truncated at 4 KiB. Only the **keys** of `fields` leave the process; values stay local, so put diagnostic detail in the message. |
| `hostConnector` | May be absent. Its use is outside the scope of this repository. |
| `agent` | Present when `miniapp.json` declares `agentAccess` (`"session.run"`, and from MiniMax Code 3.1.6 also `"session.read"`). See `docs/agent.md`. |
| `tool` | Present when `miniapp.json` declares `"toolAccess": ["call"]` (MiniMax Code 3.1.6 or later). See `docs/tool.md`. |
| `capabilities` | `has(name)` answers whether this client supports a feature, such as `has('agent.observe')`; the names are listed in `docs/client.md`. Absent before MiniMax Code 3.1.6, so write `context.capabilities?.has(...)`. |

`agent` and `tool` follow the manifest, not the user's permission switches: when the user switches
a granted item off, the object stays and its calls fail until the item is switched back on (see
"Permission switches" in `docs/package-contract.md`).

## `start(context)`

- Install every route and start listening before resolving. Resolution is the readiness signal;
  there is no health route.
- Return `{ dispose }` or `undefined`. An object without `dispose` is rejected as an invalid
  lifecycle. Throwing fails the start; a port collision is reported as its own error.
- Do not fetch business data inside `start`. Register handlers and resolve.
- Do not call `context.agent` or `context.tool` inside `start`; call them from a request handler.

## `dispose()`

Close everything the entry started: the HTTP server, timers, child processes, streams, and any
open file or database handles. The Host stops only the entry process; it does not discover or
terminate processes the entry spawned.

Finish within 2 seconds. After a stop the Host waits 2 s, then sends `SIGTERM`, then force-kills the
entry 2 s later; on Windows `SIGTERM` already ends the process. A forced end runs no callback, so
do not leave durable writes for `dispose()`.

## Loopback authentication

From MiniMax Code 3.1.2, the Host guards the assigned port. Before it loads your entry, it installs a
check on every `node:http` server in the process. The Mini App page and the Host's MCP client send a
per-run credential; every other request gets `401` (WebSocket upgrades are closed) before your
handler runs, and the credential header is removed before a request reaches your code. After
`start` resolves, the Host confirms the check answers on the assigned port, and only then treats the
Mini App as ready. Your code needs no auth logic for this.

- Serve `context.listen.port` with a `node:http` server: `createServer` from `node:http`, or a
  framework built on it. Do not bind that port with `https`, `http2`, `tls`, a raw `net` server,
  or a child process. Those are not covered, so the Mini App never becomes ready and startup fails
  with a readiness timeout. A backend in another runtime (Python, Java) must listen on its own
  internal port behind a proxy in the Node entry. `npm run check` warns when a Node file creates
  an `https`, `http2`, `net`, or `tls` server.
- The check covers every `node:http` server in the process, not only the assigned port. A second
  in-process server (for example an OAuth callback listener) also answers `401` to callers without
  the credential, including third-party redirects. Accept such requests on the assigned port's own
  handler instead.
- The `/__mavis/` path prefix belongs to the Host. Do not declare or handle routes under it.
  `npm run check` rejects manifest routes there and warns when Node code mentions it.
- Build page requests from relative or same-origin URLs. Requests from a Service Worker, a popup,
  an external browser, or an ordinary Browser tab carry no credential and get `401`.
- Do not read, forward, or log authentication headers.
- A restart issues a new credential. An already-open page keeps the old one and gets `401` until
  the user clicks Refresh or opens the Mini App again. This is expected, not a plugin bug.

## stdout and stdin

Both belong to the Host. Never call `console.log`, `console.info`, `console.debug`,
`console.dir`, `console.table`, or `process.stdout.write`; log through `context.logger`.

## Lifecycle

The process starts on demand. While no page of the Mini App is visible, the Host may stop the
process, and it may destroy a hidden page and load it again when the user comes back. Neither comes
with notice, and no callback is guaranteed to run.

MiniMax Code 3.1.10 and earlier run at most three Mini Apps at once. From 3.1.11 the limit depends on
the device's memory, from 3 to 10, and the Host frees memory in two cases only:

- **The user opens a Mini App while the limit is reached.** The Host stops the least recently used
  Mini App that is not in use, keeps its tabs, and tells the user with a toast. Opens by the Agent
  never do this; they fail with `BUSY` instead.
- **The system is short of memory.** The Host first destroys hidden pages, oldest first, and keeps
  their tabs; selecting one loads the page again. Under critical pressure it then stops whole Mini
  Apps. On Windows, moderate pressure only destroys pages that have been hidden for 10 minutes or
  more.

There is no idle timeout and no keep-alive grant. Page requests, WebSocket traffic, and timers in
your process do not count as use, so polling or heartbeats keep nothing alive.

Reclaim never stops a Mini App that has a visible page, that the current chat turn mentions with
`@`, whose MCP tools the Agent is calling, or that started less than 60 seconds ago; the user can
still stop it, and an update or restart replaces its process. A Mini App whose Node entry has a Host
request in flight (`context.agent`, `context.tool`, `context.hostConnector`), or finished one less
than 10 minutes ago, is not stopped to make room for another, and under critical pressure is
stopped only after the others. That makes a stop less likely but never rules it out. An open
`agent.observe` counts only when it starts.

Write the Mini App so that a stop or reload loses nothing:

- Write durable state to `dataDir` as it changes. Write files atomically (a temporary file in the
  same directory, then rename it over the target) or use a transactional store such as SQLite.
- In the page, save view state when `visibilitychange` reports `document.visibilityState` as
  `hidden`, and restore it on load. Do not rely on `beforeunload` or `unload`.
- A popped-out window counts as hidden while it is minimized or hidden, including after
  `window.update({ visible: false })`. The window stays, and the page reloads in it when it is shown
  again.
- Background work, such as ongoing data collection, saves its progress and resumes after a restart.

## Client

Serve the page yourself on `surface.path`; a static HTML file is a complete Client. The Client calls
only the routes your Node entry exposes, plus the page APIs in `docs/client.md`.

## Platforms

MiniMax Code runs on macOS and Windows. Use `node:path` for paths and avoid Unix-only commands.
