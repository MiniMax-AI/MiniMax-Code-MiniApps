# OpenViking Mini Studio (`mini-studio`)

English | [简体中文](README.zh-CN.md)

A read-only navigator for your [OpenViking](https://github.com/volcengine/OpenViking) context inside
MiniMax Code. Browse `viking://` as a tree, search it (semantic find, grep, glob), preview Markdown /
JSON / JSONL with the L0 / L1 / L2 levels, and add the selected URI or file content to the current
MiniMax Code chat.

The UI is built from [OpenViking Studio](https://github.com/volcengine/OpenViking/tree/main/web-studio)'s
components and design tokens (base-ui + Tailwind, the OpenViking wordmark, Noto Sans), with the
navigation features and content renderers of [Atlas](https://github.com/ZaynJarvis/atlas-fs). It is
precompiled into `miniapp/client`; nothing is loaded from a CDN. The theme follows the MiniMax Code
light / dark appearance (`prefers-color-scheme`) and can be pinned to light or dark from the toolbar or
settings. Below 720 px wide (the side panel) the tree sits above the preview with a draggable divider.
This package
contains no hooks, Skills, or MCP servers. Session capture and recall are expected to go through the
OpenViking Context Gateway configured as a MiniMax Code model provider; this Mini App does not
capture anything.

## Install and open

Copy this directory, including `.minimax-plugin/`, into the MiniMax Code plugin directory as
`mini-studio/`, restart MiniMax Code, and ask "Open OpenViking Mini Studio".

On first launch, with no saved connection, a dialog asks for the server URL and API key. Later,
open the gear icon to change the server URL, API key (shown only as "key saved"), account, user, and
the URL of a Studio you host yourself. **Test connection** checks `GET /health` and a root listing
with the entered values (and the saved key unless you type a new one) without saving; **Save** stores
them.

- **URI** (link icon) adds `OpenViking context: viking://...` for the selected file or folder to the chat input.
- **Content** (file-plus icon) reads the selected file and adds it, wrapped in `<context uri="...">`, to the chat
  input (truncated at 90,000 characters).
- MiniMax Code shows its own confirmation for each addition; nothing is sent until you press Send.
- **Open full Studio** (in settings, only when a Studio URL is saved) asks the client to open that URL
  in a new window. Nothing is embedded in the page.

## Tested environment

- MiniMax Code 3.1.2 package contract (no features with a higher minimum version).
- Node.js 22 on Linux: `npm test` against a fake OpenViking server, and headless Chromium renders of
  the page through `npm run dev` (light, dark, 420 px, first-run) against a live OpenViking server.
- Not yet verified inside the MiniMax Code client: the `message.append` confirmation and the
  **Open full Studio** new-window behaviour.

## Data & access

- **Files read**: the package's own `miniapp/client` and `miniapp/node` files.
- **Files written**: `connection.json` in the plugin data directory (`context.dataDir`), holding the
  server URL, API key, account, user, and Studio URL. Written atomically with mode `0600`. Nothing is
  written anywhere else.
- **Browser storage**: view preferences only (theme, sort, show hidden files, tree / preview split). No credentials and no OpenViking content.
- **Network**: the Node process connects only to the OpenViking server URL you configure, and only for
  these read-only routes: `GET /health`, `GET /api/v1/fs/{ls,tree,stat}`,
  `GET /api/v1/content/{read,abstract,overview}`, `POST /api/v1/search/{find,grep,glob}`. Any other
  method, path, or query key is refused with no upstream call; `uri` / `target_uri` must be
  `viking://` URIs; redirects are refused. The API key is sent as `Authorization: Bearer` and
  `X-API-Key`. The page itself talks only to the Mini App's own loopback port. When you press
  **Open full Studio**, the client opens the Studio URL you entered.
- **Credentials**: entered by you in settings, stored only in `connection.json`, never returned to
  the page, logged, or included in error responses. There is no fallback to a root key or to
  `~/.openviking` configuration files.
- **Processes**: none spawned.
- **Agent turns**: none. No `agentAccess`. The page only asks the Host to append text to the unsent
  chat draft (`window.mcode.miniapp.message.append`) after a click.

## Development

```sh
npm test          # in-plugin tests: proxy allowlist, key handling, test connection, static files
npm run dev       # preview at http://127.0.0.1:4317/context (binds 127.0.0.1 only)
npm install --include=dev && npm run build   # rebuild miniapp/client from src/ with Vite
```

`npm run dev` stores its connection settings in `$TMPDIR/mini-studio-dev`
(override with `OV_MINIAPP_DATA_DIR`). Outside MiniMax Code, **+ URI** / **+ Content** copy to the
clipboard instead.

```text
.minimax-plugin/plugin.json   Mini App declaration only (no hooks, Skills, or MCP)
miniapp/node/server.mjs       Page, static files, connection settings + test, /ov-api proxy
miniapp/node/openviking.mjs   Settings storage, connection test, read-only route allowlist
miniapp/client/               Generated by `npm run build`: index.html + static/assets (JS, CSS, font)
src/App.jsx                   App shell: tree, preview, search, settings, first-run dialog
src/components/ui/            Studio UI components (base-ui + Tailwind)
src/legacy/                   Atlas data layer and content renderers
vite.config.js                Build config
tests/                        node:test suite
```

## License

[AGPL-3.0](./LICENSE). Third-party code: see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
