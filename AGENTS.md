# AGENTS.md

This repository hosts community Mini App packages for MiniMax Code. One task dominates: add or
update one package at `plugins/<github-username>/<plugin-id>/`.

## Add or update a Mini App

1. New package: copy `examples/hello-miniapp/` to `plugins/<you>/<plugin-id>/`, then replace
   `name`, `displayName`, `description`, `author`, `exampleQueries`, the `<title>`, the README, and
   the LICENSE holder. Update: open the existing package. Read `docs/package-contract.md` before
   editing any manifest.
2. Read `docs/runtime.md` before editing `miniapp/node/*`. Read `docs/security.md` before the
   Node code reads or writes files, spawns processes, or makes network requests. Read
   `docs/client.md` before the page calls `window.mcode`, and `docs/agent.md` before declaring
   `agentAccess`.
3. Write `README.md` (English; `README.zh-CN.md` optional): what it does, how to install and open
   it, and the headings `## Tested environment` and `## Data & access` (files read/written,
   network hosts, spawned processes, Agent turns, where state is stored). When the package uses a
   feature with a minimum client version (`docs/package-contract.md`), name a MiniMax Code version
   at or above it under `## Tested environment`.
4. Add one row to the table in both root READMEs.
5. Run `npm run check`. Done when it reports no errors and every warning is either fixed or
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
  App payload, the page APIs, and the Agent API; treat `context.hostConnector` and the other
  capabilities as outside its scope.
- `agentAccess` gives an Agent with files, shell, and MCP. Declare it only when needed, and never
  answer a `permission.requested` with `allowOnce` unless the user chose it.
- The runtime payload is exactly `miniapp/client` and `miniapp/node`. Keep tests and docs outside
  `miniapp/`. Vendor third-party code inside the payload; `node_modules` is never committed.
- Paths are portable: ASCII, no symlinks, no `..`. `npm run check` enforces the full rule set.
- Secrets stay in the Node process: never in HTML, Client JavaScript, logs, or error responses.
- Plugin ID = directory name = `plugin.json.name`, unique across the repository.

## Review policy

Maintainers gate on three things: manifests pass `npm run check`; the README describes real
behaviour (files, network, processes, Agent turns, tested environment); the package cannot damage
Host or user data. Everything else is a suggestion.

## Navigation

- `docs/package-contract.md` — layout, the three manifests, portable paths, limits, minimum client
  versions
- `docs/runtime.md` — `start(context)`, `dispose`, logger, lifecycle, loopback authentication
- `docs/client.md` — page APIs: `message.append`, `agent`, `window`
- `docs/agent.md` — `agentAccess`, sessions, calls, events, errors
- `docs/security.md` — process boundary, state, writing outside `dataDir`, spawning, network, Agent
  turns
- `examples/hello-miniapp/` — the copyable starting point
- `CONTRIBUTING.md` — fork, pull request, and license steps for people
