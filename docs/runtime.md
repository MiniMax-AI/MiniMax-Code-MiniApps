# Mini App Node runtime

Verified against MiniMax Code 3.1.6.

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
| `agent` | Present when `miniapp.json` declares `agentAccess` (`"session.run"`, and from MiniMax Code 3.1.5 also `"session.read"`). See `docs/agent.md`. |
| `tool` | Present when `miniapp.json` declares `"toolAccess": ["call"]` (MiniMax Code 3.1.5 or later). See `docs/tool.md`. |
| `capabilities` | `has(name)` answers whether this client supports a feature, such as `has('agent.observe')`; the names are listed in `docs/client.md`. Absent before MiniMax Code 3.1.5, so write `context.capabilities?.has(...)`. |

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

The process starts on demand and may be stopped at any time. Only a small number of Mini Apps run at
once, so assume yours can be stopped and restarted between two page views: keep durable state in
`dataDir`, not in memory.

## Client

Serve the page yourself on `surface.path`; a static HTML file is a complete Client. The Client calls
only the routes your Node entry exposes, plus the page APIs in `docs/client.md`.

## Platforms

MiniMax Code runs on macOS and Windows. Use `node:path` for paths and avoid Unix-only commands.
