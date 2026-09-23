# Mini App Node runtime

Verified against MiniMax Code 3.0.73.

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

## `start(context)`

- Install every route and start listening before resolving. Resolution is the readiness signal;
  there is no health route.
- Return `{ dispose }` or `undefined`. An object without `dispose` is rejected as an invalid
  lifecycle. Throwing fails the start; a port collision is reported as its own error.
- Do not fetch business data inside `start`. Register handlers and resolve.

## `dispose()`

Close everything the entry started: the HTTP server, timers, child processes, streams, and any
open file or database handles. The Host stops only the entry process; it does not discover or
terminate processes the entry spawned.

## stdout and stdin

Both belong to the Host. Never call `console.log`, `console.info`, `console.debug`,
`console.dir`, `console.table`, or `process.stdout.write`; log through `context.logger`.

## Lifecycle

The process starts on demand and may be stopped at any time. Only a small number of Mini Apps run at
once, so assume yours can be stopped and restarted between two page views: keep durable state in
`dataDir`, not in memory.

## Client

Serve the page yourself on `surface.path`; a static HTML file is a complete Client. The Client calls
only the routes your Node entry exposes.

## Platforms

MiniMax Code runs on macOS and Windows. Use `node:path` for paths and avoid Unix-only commands.
