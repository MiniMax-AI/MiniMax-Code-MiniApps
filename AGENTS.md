# AGENTS.md

This repository hosts community Mini App packages for MiniMax Code. One task dominates: add or
update one package at `plugins/<github-username>/<plugin-id>/`.

## Add or update a Mini App

1. New package: copy `examples/hello-miniapp/` to `plugins/<you>/<plugin-id>/`, then replace
   `name`, `displayName`, `description`, `author`, `exampleQueries`, the `<title>`, the README, and
   the LICENSE holder. Update: open the existing package. Read `docs/package-contract.md` before
   editing any manifest.
2. Read `docs/runtime.md` before editing `miniapp/node/*`. Read `docs/security.md` before the
   Node code reads or writes files, spawns processes, or makes network requests.
3. Write `README.md` (English; `README.zh-CN.md` optional): what it does, how to install and open
   it, and the headings `## Tested environment` and `## Data & access` (files read/written,
   network hosts, spawned processes, where state is stored).
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
- Bind only `context.listen.host` / `context.listen.port`. Serve `surface.path` plus your own
  routes.
- A Mini App package is a MiniMax Plugin. Skills, MCP servers, hooks, host bindings, MCP endpoints,
  and `hostConnectorAccess` may all be declared; `npm run check` validates their shape only, and the
  Host validates them at install time. This repository documents the Mini App payload; treat
  `context.hostConnector` and those capabilities as outside its scope.
- The runtime payload is exactly `miniapp/client` and `miniapp/node`. Keep tests and docs outside
  `miniapp/`. Vendor third-party code inside the payload; `node_modules` is never committed.
- Paths are portable: ASCII, no symlinks, no `..`. `npm run check` enforces the full rule set.
- Secrets stay in the Node process: never in HTML, Client JavaScript, logs, or error responses.
- Plugin ID = directory name = `plugin.json.name`, unique across the repository.

## Review policy

Maintainers gate on three things: manifests pass `npm run check`; the README describes real
behaviour (files, network, processes, tested environment); the package cannot damage Host or user
data. Everything else is a suggestion.

## Navigation

- `docs/package-contract.md` — layout, the three manifests, portable paths, limits
- `docs/runtime.md` — `start(context)`, `dispose`, logger, lifecycle
- `docs/security.md` — process boundary, state, writing outside `dataDir`, spawning, network
- `examples/hello-miniapp/` — the copyable starting point
- `CONTRIBUTING.md` — fork, pull request, and license steps for people
