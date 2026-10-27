# AGENTS.md

This repository hosts community Mini App packages for MiniMax Code. Most tasks add or update one
package at `plugins/<github-username>/<plugin-id>/`; the rest change the checks or the docs (see
"Change the checks or the docs").

## Add or update a Mini App

1. New package: copy `examples/hello-miniapp/` to `plugins/<you>/<plugin-id>/`, then replace
   `name`, `displayName`, `description`, `author`, `exampleQueries`, the `<title>`, the README, and
   the LICENSE holder. Update: open the existing package, keep its plugin ID, and raise `version`
   in `plugin.json`. A newly declared field that raises the minimum client version
   (`docs/package-contract.md`) drops older clients; say so in the README and the PR. Read
   `docs/package-contract.md` before editing any manifest.
2. Read `docs/runtime.md` before editing `miniapp/node/*`. Read `docs/security.md` before the
   Node code reads or writes files, spawns processes, or makes network requests. Read
   `docs/client.md` before the page calls `window.mcode` or a browser permission such as
   `getUserMedia`, `docs/agent.md` before declaring `agentAccess`, and `docs/tool.md` before
   declaring `toolAccess`.
3. Write `README.md` (English; `README.zh-CN.md` optional): what it does, how to install and open
   it, and the headings `## Tested environment` and `## Data & access` (files read/written,
   network hosts, spawned processes, Agent turns, conversations read, tools called, microphone use,
   where state is stored). When the package uses a feature with a minimum client version
   (`docs/package-contract.md`), name a MiniMax Code version at or above it under
   `## Tested environment`.
4. Add one row to the table in both root READMEs.
5. Tests are optional. Put them in the package directory (for example `tests/`) and run them
   through `scripts.test` in the package's `package.json`; the Plugin tests workflow runs `npm test`
   there when a pull request changes the package. Keep them off external hosts (loopback is fine),
   install dependencies only inside the package with a committed `package-lock.json`, and delete
   that `node_modules` before the next step.
6. Run `npm run check`. Done when it reports no errors and every warning is either fixed or
   explained in the PR description.

## Hard rules

- `context.dataDir` is your private state directory, created and owned by the Host. Store durable
  state there and treat its location as opaque. Reading Host files has no supported API; a plugin
  that does so must state in its README which files, how it locates them, and that this relies on
  unspecified layout.
- stdout and stdin belong to the Host. Log through `context.logger`.
- The Node entry is ESM with a named export `start(context)`. Resolve `start` only after the
  listener accepts connections on `context.listen`. Return `{ dispose }`; `dispose` closes
  everything the entry started: server, timers, child processes, streams, file handles.
- Bind only `context.listen.host` / `context.listen.port`, with a `node:http` server (or a framework
  on top of it); `https`, `http2`, `tls`, raw `net`, or a child process on that port never becomes
  ready. Serve `surface.path` plus your own routes, none under `/__mavis/`.
- A Mini App package is a MiniMax Plugin. Skills, subagents (`agents`), MCP servers, hooks, host
  bindings, MCP endpoints, and `hostConnectorAccess` may all be declared; `npm run check` validates
  their shape only, and the Host validates them at install time. This repository documents the Mini
  App payload, the page APIs, the Agent API, and the tool API; treat `context.hostConnector` and the
  other capabilities as outside its scope.
- Declare exactly the access the code uses: `agentAccess` (`session.run`, `session.read`),
  `toolAccess`, `deviceAccess`. A call without its declaration fails at runtime, and
  `npm run check` reports it as `ACCESS_UNDECLARED`; do not declare access the app does not use.
- `agentAccess` gives an Agent with files, shell, and MCP, and `session.read` exposes every user
  conversation. Never answer a `permission.requested` with `allowOnce` unless the user chose it.
- The user can switch any declared access off at any time. Handle `NOT_PERMITTED`
  (`not_permitted` on the page), `TOOL_NOT_PERMITTED`, and `NotAllowedError` where the call is made,
  and keep the app running.
- The runtime payload is exactly `miniapp/client` and `miniapp/node`. Keep tests and docs outside
  `miniapp/`. Vendor third-party code inside the payload; `node_modules` is never committed.
- Paths are portable: ASCII, no symlinks, no `..`. `npm run check` enforces the full rule set.
- Secrets stay in the Node process: never in HTML, Client JavaScript, logs, or error responses.
- Plugin ID = directory name = `plugin.json.name`, unique across the repository.

## Review policy

Maintainers gate on three things: manifests pass `npm run check`; the README describes real
behaviour (files, network, processes, Agent turns, conversations read, tools called, microphone
use, tested environment); the package cannot damage Host or user data. Everything else is a
suggestion.

## Change the checks or the docs

`scripts/` mirrors the MiniMax Code package reader; `docs/` publishes the same contract.

- A minimum in `FEATURE_MIN_HOST_VERSION` is the first released MiniMax Code that accepts the
  field. Preview builds ship features early and are not evidence.
- Change `scripts/lib/contract.mjs`, the rule, its `test/<rule>.test.mjs`, and the matching
  `docs/` page together, and update the docs' `Verified against` line. The checker stays
  dependency-free.
- CI validates every package under `plugins/`. A new error must leave existing packages at zero
  errors; otherwise ship it as a warning first.
- Keep contract changes in their own PR, apart from package updates.

## Navigation

- `docs/package-contract.md` — layout, the three manifests, portable paths, limits, permission
  switches, minimum client versions, declared access versus code
- `docs/runtime.md` — `start(context)`, `dispose`, logger, lifecycle, loopback authentication
- `docs/client.md` — page APIs: `capabilities`, browser permissions, `message.append`, `agent`,
  `speech.transcribe`, `tool.request`, `window`
- `docs/agent.md` — `agentAccess`, sessions, calls, `whenBusy`, reading and observing sessions,
  events, errors
- `docs/tool.md` — `toolAccess`, `context.tool`, permission prompts, errors
- `docs/security.md` — process boundary, state, writing outside `dataDir`, spawning, network, Agent
  turns, reading conversations, calling tools, microphone
- `docs/snippets/audio-capture.ts` — microphone capture in the format `speech.transcribe` takes
- `examples/hello-miniapp/` — the copyable starting point
- `CONTRIBUTING.md` — fork, pull request, and license steps for people
