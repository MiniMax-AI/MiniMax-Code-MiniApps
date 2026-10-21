# Dynamic Workflow Console (`workflow-console`)

A Mini App that runs, supervises, and inspects MiniMax Code dynamic workflows from one page.

It embeds the `mcode-dynamic-workflows` runtime, so it works on a machine where that plugin was
never installed. Open the app and the console starts its own Workflow Studio engine, binds it to a
project directory, and shows every run of that project: status, live event log, a stage-and-dependency
flow graph, per-node output, and the final report. Runs can be approved, started, paused, cancelled,
resumed, exported to Markdown or HTML, saved as a template, and restored from a template.

The user interface is in Chinese.

## Based on which project

This package is built **on top of the `mcode-dynamic-workflows` plugin** by `hetaoBackend`, from
<https://github.com/MiniMax-AI/MiniMax-Code-Plugins/tree/main/plugins/hetaoBackend/mcode-dynamic-workflows>
(version 0.8.2, Apache-2.0).

That plugin is an MCP server that orchestrates multi-agent workflows. It normally has to be installed
as a MiniMax Code plugin and reached through MCP. This package takes its runtime and runs it as a
**self-contained Mini App**:

- The upstream `dist/` runtime is vendored unmodified into
  `miniapp/node/vendor/dynamic-workflows/`, and the console starts it as a child process.
- The upstream `web/` canvas (`graph-model.mjs`) is imported directly, so the flow graph in this
  console is the same graph model Workflow Studio draws, not a second implementation.
- The console adds what the plugin does not provide: a per-project run list, a live event stream,
  run approval and control, template management, report export, and a running-directory picker.

`miniapp/node/vendor/dynamic-workflows/VENDOR.md` records the vendored files and every behavioural
difference between the upstream plugin and this console.

## Install

Copy this directory, including the hidden `.minimax-plugin/`, into the MiniMax Code plugins
directory as `workflow-console/` (`~/.minimax/plugins/workflow-console/` by default; the root
README's Install section explains where that directory is). Restart MiniMax Code and ask the Agent
to "打开动态工作流控制台" (open the Dynamic Workflow Console).

The app has no configuration step and no build step. On first launch it needs a project directory:
the console resolves one from the running Workflow Studio services, then from the project registry
left by earlier plugin runs, and otherwise falls back to your home directory and asks you to type an
absolute path in the always-visible **Working directory** bar at the top of the page. Saving that bar
restarts the embedded engine against the new directory; run history is kept in the engine's own
database and is not affected by the change.

Running real workflows still requires a working `mcode` CLI: the engine orchestrates agents through
it. The demo executor works without it.

## Tested environment

- MiniMax Code 3.1.4 on Windows 11, Node.js 22 and 26. Installed from this directory, opened
  through the Agent, page rendered, engine started, run approved and executed with the demo
  executor.
- MiniMax Code on macOS (arm64), Node.js 22.22.3. Installed from this directory on a machine where
  the upstream plugin had never been installed; service discovery, working-directory resolution,
  and the same demo-executor run were verified there.
- Browser: Chromium-based desktop browser, 1280x720 and 589x899 viewports, light and dark themes.

Not verified: real model execution, and the pause/resume/cancel path on the real executor. Every
execution in testing used the `demo` executor, which does not call a model. `mcodeAvailable: true`
only means the `mcode` binary exists on the machine; its login state and quota are not checked by
this app.

## Data & access

### Files

Read:

- `miniapp/client/` and `miniapp/node/vendor/` — this package's own assets.
- `~/.mcode-dynamic-workflows/projects/<sha256>/address.json` and `endpoint.json` — **a Host-side
  directory with no supported API**. It is located as `<home>/.mcode-dynamic-workflows/projects/`
  and read only to learn which project other Workflow Studio services are bound to, and to pick a
  default working directory. This relies on an unspecified layout that MiniMax Code may change at
  any time. If the directory does not exist, the app works normally and the working directory falls
  back to your home directory.

Written — always under `context.dataDir`, never elsewhere:

- `selection.json` — the service id the console points at.
- `workspace.json` — the working directory the embedded engine is bound to.
- `hidden-runs.json` — the list of runs hidden locally. Hiding is not deletion; the run record
  stays in the engine's database and can be restored.
- `engine/` — `address.json`, `endpoint.json`, `service.log`, and `workflows.sqlite`, written by the
  embedded engine.

### Network

Loopback only. The embedded engine binds `http://127.0.0.1:<port>` and the console proxies the
page to it. Discovered Workflow Studio services are contacted on `http://127.0.0.1` as well. No
outbound internet host is contacted.

### Processes

One child process, spawned with an argv array and no shell:

```
node <pluginRoot>/miniapp/node/vendor/dynamic-workflows/dist/main.mjs --workspace <directory> --data-dir <directory>
```

`<directory>` is the working directory shown in the page's top bar: either typed by the user or
resolved from a discovered service. User input is passed as a separate argv element, never
concatenated into a command line. The process tree is terminated when the app is disposed.

### Agent turns

None. The package declares no `agentAccess` and starts no Agent turn itself. The embedded engine
may invoke the local `mcode` CLI when a run uses the real executor, which is the behaviour of the
upstream plugin and is documented by it.

### State

Everything durable lives in `context.dataDir` (see **Files** above). The page keeps no domain data
in browser storage.

## Files

```text
.minimax-plugin/plugin.json                 Plugin manifest
package.json                                Mini App declaration
miniapp/miniapp.json                        Payload roots, Node entry, page route
miniapp/client/index.html                   The page served at /dashboard
miniapp/client/app.js                       Front end (plain HTML/CSS/JS, no framework, no build)
miniapp/client/style.css                    Styling, light and dark themes
miniapp/node/server.mjs                     Node entry: start(context) -> { dispose }
miniapp/node/miniapp-api.ts                 Type declarations for the runtime context
miniapp/node/vendor/dynamic-workflows/      Vendored upstream runtime (0.8.2, Apache-2.0)
tests/workspace-resolution.test.mjs         Working-directory resolution
tests/service-discovery.test.mjs            Service discovery on a machine without the upstream plugin
tests/manual-mac-scenario.mjs               Boots an isolated instance that mimics a fresh macOS host
icon.png                                    Plugin icon
```

## Tests

The tests use Node's built-in test runner and start an isolated console instance in a sandbox home
directory, so they never touch a real project:

```bash
node --test "tests/*.test.mjs"
```

`tests/service-discovery.test.mjs` covers the case where `~/.mcode-dynamic-workflows/projects` does
not exist, which is what a machine that never installed the upstream plugin looks like.
`tests/workspace-resolution.test.mjs` covers working-directory resolution, including the Host's
temporary deployment directory, which must never be used as a project.
`tests/manual-mac-scenario.mjs` starts a console whose working directory is a temporary deployment
directory and prints the URL to open for manual inspection.

## License

[MIT](./LICENSE). The vendored upstream runtime keeps its own Apache-2.0 license.
