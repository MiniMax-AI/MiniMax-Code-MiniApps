# Regex Lab (`regex-lab`)

A live regular-expression workbench that runs inside MiniMax Code. Type a pattern and some
sample text, watch every match appear with its capture groups and named groups, and preview a
replacement — all computed by the Mini App's own Node backend. Nothing is sent anywhere; the text
never leaves the app.

## What it does

- **Live matching** against the sample text, with match position (`index`–`end`), the matched
  substring, numbered capture groups, and named capture groups.
- **Replacement preview** using the standard `$1`, `$<name>`, `$$`, `$&`, `` $` ``, `$'` tokens.
- **Flag toggles** for `g` / `i` / `m` / `s` / `u` / `y`, with a plain-text flag box if you prefer
  to type them.
- **Invalid-pattern feedback** — a bad regex shows the engine's error instead of failing silently.

The computation lives in `miniapp/node/regex-engine.mjs` (pure functions, no DOM), shared by the
Node HTTP API and the unit tests, so the logic you see is the logic that runs.

## Install

Copy this directory, including the hidden `.minimax-plugin/`, into the MiniMax Code plugins
directory as `regex-lab/` (`~/.minimax/plugins/regex-lab/` by default). Restart MiniMax Code and
ask the Agent to "Open Regex Lab" (or "打开 Regex Lab 正则测试器").

## Tested environment

- Validated locally with Node.js 22: `node scripts/validate.mjs plugins/lym308758/regex-lab` reports
  no errors, and `node --test plugins/lym308758/regex-lab/tests/` passes (engine + HTTP handler).
- **Not verified in the MiniMax Code host UI**: this environment has no MiniMax Code desktop client,
  so the page was not opened inside the side panel and the in-app rendering/click-through was not
  exercised end to end. The Node backend (page serving + `/api/match` + `/api/replace`) is covered
  by `tests/server.test.mjs` against a real `node:http` server, and the regex engine by
  `tests/regex-engine.test.mjs`.

## Data & access

- **Files:** reads only its own `miniapp/client/index.html` to serve the page. Writes nothing.
- **Network:** none beyond the Host loopback that serves the page and the JSON API to the page.
- **Processes:** none spawned.
- **Agent turns:** none; the Mini App declares no `agentAccess`.
- **State:** none stored. Each evaluation runs on the text you paste into the page.

## Files

```text
.minimax-plugin/plugin.json   Plugin manifest
package.json                  Mini App declaration
miniapp/miniapp.json          Payload roots, Node entry, page route
miniapp/client/index.html     The page served at /dashboard
miniapp/node/server.mjs       Node entry: start(context) -> { dispose } and the JSON API
miniapp/node/regex-engine.mjs Pure regex functions (match / replace), shared with the tests
icon.png                      Plugin icon
tests/regex-engine.test.mjs   Engine unit tests
tests/server.test.mjs         HTTP handler + start() lifecycle tests
README.md                     This file
README.zh-CN.md               Chinese README
LICENSE                       MIT
```

## License

[MIT](./LICENSE)
