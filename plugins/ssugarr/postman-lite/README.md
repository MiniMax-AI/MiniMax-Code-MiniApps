# Postman Lite (`postman-lite`)

A lightweight, local-first API request tool. Build a request in the page, send it through a Node
proxy that sidesteps browser CORS limits, and read the response — status, timing, size, headers,
body, and an HTML preview — with collections kept as plain JSON on disk.

The Mini App hosts the Node runtime, so there is nothing to install and no service to start: open
the panel and send requests.

## Install

Copy this directory, including the hidden `.minimax-plugin/`, into the MiniMax Code plugins
directory as `postman-lite/` (`~/.minimax/plugins/postman-lite/` by default; the root README's
Install section explains where that directory is). Restart MiniMax Code and ask the Agent to
"Open Postman Lite".

## What it does

- **Request builder** — method, URL, query parameters, request headers, and a body in
  `none` / `raw` / JSON / `x-www-form-urlencoded` / `form-data` form. Redirect following and
  the timeout are switchable per request.
- **Response viewer** — status code, elapsed time, and byte size; body as pretty JSON, raw text, or
  an HTML preview in an iframe; binary responses preview inline or download.
- **Collections** — collections, folders, and requests in a tree; create, rename, delete, and
  automatic persistence.

## Tested environment

- MiniMax Code 3.1.2 or later on Windows 11. The package uses `surface.window`, whose minimum
  client version is 3.1.2; the Agent cannot read the exact client build number in this session.
- Client acceptance exercised: initial render and structure, light and dark themes, creating a
  collection, sending GET and POST JSON through the proxy, error handling for an unresolvable host,
  and collection persistence across a page reload.
- Runtime diagnostics: no console errors and no failed or 4xx/5xx network requests.
- Requests were exercised against a local echo server as the target.

Not verified: requests against third-party hosts that need credentials or are unreachable from this
network; behaviour on macOS and Linux.

## Data & access

- **Files** — reads its own `miniapp/client/` payload and `miniapp/node/` code. Writes
  `state.json` in the Host-assigned data directory.
- **Network** — the host the user explicitly requests through the proxy, plus whatever
  host a redirect points to: redirect following is on by default, so a response can send the request
  on to a different host than the one in the address bar. Turning off "Follow redirects" keeps the
  request on the original host. No telemetry.
- **Processes** — none.
- **Agent turns** — none.
- **Conversations read** — none.
- **Tools called** — none.
- **Microphone / camera / notifications** — not used.
- **Host navigation read** — not declared.
- **State** — the Host-assigned plugin data directory. `state.json` holds the collection tree and is
  replaced atomically, so a forced stop never leaves a half-written file. Request headers are stored
  as written, so credentials such as `Authorization`, `Cookie`, or `X-Api-Key` are kept in
  plaintext in `state.json` and are returned by `GET /api/state`. Clearing that directory resets
  every collection.

## Files

```text
.minimax-plugin/plugin.json   Plugin manifest
package.json                  Mini App declaration
miniapp/miniapp.json          Payload roots, Node entry, page route
miniapp/client/index.html     The page served at /
miniapp/client/assets/        Built front-end bundle
miniapp/node/server.mjs       Node entry: start(context) -> { dispose }
miniapp/node/miniapp-api.ts   Type declarations for the runtime context
miniapp/node/api.js           Routes: /api/send, /api/state, /api/health
miniapp/node/proxy.js         Request forwarding, timing, binary handling
miniapp/node/store.js         Atomic JSON persistence
miniapp/node/static.js        Static file serving
miniapp/node/config.js        Data directory and limits
miniapp/node/shared/          Shared request-building logic
icon.png                      Plugin icon
```

## License

[MIT](./LICENSE)
