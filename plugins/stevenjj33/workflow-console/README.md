# Dynamic Workflow Console (`workflow-console`)

[简体中文](README.zh-CN.md) | English

> **中文速览**：一个把 MiniMax Code 动态工作流跑起来、盯住、看清的 Mini App。内置 Workflow Studio
> 引擎，**无需另装插件即可运行**：运行列表、实时事件流、按阶段与依赖画出的流程图、每个节点的输出、
> 审核后开始执行、暂停 / 取消 / 恢复、模板保存与复用、报告导出。引擎启动前必须先选定项目目录，
> 它不会替你猜。完整中文说明见 [README.zh-CN.md](README.zh-CN.md)。

A Mini App that runs, supervises, and inspects MiniMax Code dynamic workflows from one page.

It embeds the `mcode-dynamic-workflows` runtime, so it works on a machine where that plugin was
never installed. Open the app and the console starts its own Workflow Studio engine, binds it to a
project directory, and shows every run of that project: status, live event log, a stage-and-dependency
flow graph, per-node output, and the final report. Runs can be approved, started, paused, cancelled,
resumed, exported to Markdown or HTML, saved as a template, and restored from a template.

The user interface is in Chinese, so this README quotes the page's own wording. The terms you will
meet on screen are: 「工作目录」 (Working directory), 「待审核」 (pending review), 「开始执行」 (start),
「内置引擎」 (the bundled engine), 「还没有选择项目目录」 (no project directory chosen yet), and
「审核版本已更新，请刷新后再开始执行」 (the reviewed version changed, refresh and start again).

## Based on which project

This package is built **on top of the `mcode-dynamic-workflows` plugin** by `hetaoBackend`, from
<https://github.com/MiniMax-AI/MiniMax-Code-Plugins/tree/main/plugins/hetaoBackend/mcode-dynamic-workflows>
(Apache-2.0).

That plugin is an MCP server that orchestrates multi-agent workflows. It normally has to be installed
as a MiniMax Code plugin and reached through MCP. This package takes its runtime and runs it as a
**self-contained Mini App**:

- The upstream runtime is vendored into `miniapp/node/vendor/dynamic-workflows/`, and the console
  starts it as a child process.
- The upstream `web/` canvas (`graph-model.mjs`) is imported directly, so the flow graph in this
  console is the same graph model Workflow Studio draws, not a second implementation.
- The console adds what the plugin does not provide: a per-project run list, a live event stream,
  run approval and control, template management, report export, and a working-directory picker.

### Vendored runtime: exact version and provenance

| | |
| --- | --- |
| Upstream repository | `MiniMax-AI/MiniMax-Code-Plugins` |
| Upstream path | `plugins/hetaoBackend/mcode-dynamic-workflows` |
| Upstream commit | `6481e4ae1e0375a4ddb3d5e9b29845354ab1cead` (2026-09-21) |
| Upstream plugin version | **0.8.0** (the only version upstream has ever published) |
| License | Apache-2.0 — `LICENSE` and `THIRD_PARTY_NOTICES.txt` in the vendor directory |

Every vendored file is a byte-for-byte copy of that commit. This is not a claim but a check:
`tests/vendor-integrity.test.mjs` records each file's **git blob object ID** in the upstream
repository and recomputes the git blob hash locally (`sha1("blob <size>\0" + content)`) to compare.
Any edit, any version drift, and the test fails.

The bundle is about 2.3 MB (`dist/main.mjs` ~1.0 MB, `dist/quickjs.wasm` ~0.5 MB, `web/` ~0.27 MB).
It is pinned to one commit and does not follow upstream automatically; the update procedure — how to
copy the files, how to refresh the recorded blob IDs, and what to re-check afterwards — is written
down in `miniapp/node/vendor/dynamic-workflows/VENDOR.md`.

## Install

Copy this directory, including the hidden `.minimax-plugin/`, into the MiniMax Code plugins
directory as `workflow-console/` (`~/.minimax/plugins/workflow-console/` by default; the root
README's Install section explains where that directory is). Restart MiniMax Code and ask the Agent
to "打开动态工作流控制台" (open the Dynamic Workflow Console).

The app has no configuration step and no build step.

### Choosing a project directory

The console needs to know which project the engine should work in, and it will **not guess**:

- If the Host declares the current project through an environment variable
  (`MCODE_WORKSPACE`, `MCODE_PROJECT_DIR`, `PROJECT_DIR`, `WORKSPACE`), that directory is used.
- Otherwise the console uses the directory you typed in the always-visible **Working directory**
  (「工作目录」) bar at the top of the page, remembered under `context.dataDir`.
- If neither is available, **the engine does not start at all** and the page asks for an absolute
  project path; the empty state reads 「还没有选择项目目录」 (no project directory chosen yet). It
  never falls back to your home directory — a run started there could act on your whole home
  folder — and it never uses the Host's temporary deployment directory.

Saving the bar restarts the embedded engine against the new directory; run history is kept in the
engine's own database and is not affected by the change.

Running real workflows still requires a working `mcode` CLI: the engine orchestrates agents through
it. The demo executor works without it.

## Prerequisites

The console itself needs nothing: no configuration step, no build step, and no other plugin
installed. It ships the Workflow Studio engine and starts it as a child process.

**The `mcode` CLI is a prerequisite for real runs only.** The engine drives agents through the
`mcode` CLI, so a run on the real executor needs that CLI installed, logged in, and able to call a
model. Everything else works without it:

| | needs `mcode` CLI |
| --- | --- |
| Opening the page, starting the engine, choosing a project directory | no |
| Approving a draft, pausing, cancelling, resuming | no |
| A run on the **demo** executor (placeholder results, no model call) | no |
| A run on the **real** executor (`mcode`, actual agent calls) | **yes** |

A new workflow starts in **demo** mode: the Studio's execution-mode picker defaults to demo, so
creating and running a workflow needs no CLI at all. Switch it to "MCode · real agents" only when
you want real agents — that is the point where the CLI becomes required.

Note that the MiniMax Code desktop app does **not** bundle the CLI. The CLI is a separate
`@minimax-ai/code` install (npm prefix `~/.minimax-code`), so having the desktop app installed is
not the same as having the CLI.

Where the engine looks for the CLI, in the order it tries:

1. `mcode` on `PATH`;
2. the official user install — `~/.minimax-code/bin/mcode` on macOS and Linux,
   `~/.minimax-code/mcode.cmd` on Windows. `MCODE_INSTALL_DIR` replaces `~/.minimax-code`
   as that root, so the engine then looks for `$MCODE_INSTALL_DIR/bin/mcode`;
3. a workflow-managed toolchain, if that directory has been populated —
   `~/.mcode-dynamic-workflows/toolchain/lib/node_modules/@minimax-ai/code/cli.js` on macOS and
   Linux, `~/.mcode-dynamic-workflows/toolchain/node_modules/@minimax-ai/code/cli.js` on Windows.

The status line reports "MCode CLI 可用/不可用". That flag only means **the executable was found** —
it says nothing about whether the CLI is logged in or still has model quota, which the CLI itself
decides when a real run starts. When the CLI is missing, the console says so in a banner and
refuses to start a real run instead of failing halfway through; the engine's own error for that
case is "找不到 MCode CLI，请安装并登录后开始。"

## Skill

The package ships one Skill, `skills/workflow-console/SKILL.md`. It tells the Agent how to drive
this console: that a project directory must be chosen before the engine can start, that a run sits
in `pending_review` (「待审核」) until it is approved, what "approve" (「开始执行」), "pause",
"cancel" and "resume" mean, that reusing a template creates a new draft rather than running
anything, and that the `demo` executor calls no model. It also tells the Agent not to pick a
working directory on the user's behalf and not to approve a run without the user's say-so.

The Skill is what the Host loads when it registers this plugin; the console process itself never
reads it.

## Tested environment

- MiniMax Code 3.1.4 on Windows 11, Node.js 22 and 26. Installed from this directory, opened
  through the Agent, page rendered, engine started, run approved and executed with the demo
  executor.
- MiniMax Code on macOS (arm64), Node.js 26.8.1. Installed from this directory on a machine where
  the upstream plugin had never been installed; working-directory resolution, the "no project
  directory yet" state, and the same demo-executor run were verified there.
- Browser: Chromium-based desktop browser, 1280x720 and 589x899 viewports, light and dark themes.

Not verified: real model execution, and the pause/resume/cancel path on the real executor. Every
execution in testing used the `demo` executor, which does not call a model. `mcodeAvailable: true`
only means the `mcode` binary exists on the machine; its login state and quota are not checked by
this app.

## Data & access

### Files

Read:

- `miniapp/client/` and `miniapp/node/vendor/` — this package's own assets.
- `skills/workflow-console/SKILL.md` — read by the Host when it registers this plugin, not by the
  console process.
- The project directory it is bound to — the engine runs with it as its working directory, and the
  `mcode` CLI it launches reads and writes inside it.

This app reads **nothing** outside its own package and the project directory. In particular it does
not read `~/.mcode-dynamic-workflows/`, which belongs to the separate `mcode-dynamic-workflows`
plugin: that directory holds that plugin's service addresses and access tokens, and the console
neither reads it nor connects to the services registered there. The console runs its own bundled
engine and nothing else.

Written — always under `context.dataDir`, never elsewhere:

- `workspace.json` — the working directory the embedded engine is bound to.
- `hidden-runs.json` — the list of runs hidden locally. Hiding is not deletion; the run record
  stays in the bundled engine's own database — `workflows.sqlite` under `context.dataDir/engine/` —
  and can be restored.
- `engine/` — `address.json`, `endpoint.json`, `service.log`, and `workflows.sqlite`, written by the
  embedded engine.

### Network

Loopback only. The embedded engine binds `http://127.0.0.1:<port>` and the console proxies the
page to it. No outbound internet host is contacted, and no other local service is contacted.

### Processes

One child process, spawned with an argv array and no shell:

```
node <pluginRoot>/miniapp/node/vendor/dynamic-workflows/dist/main.mjs --workspace <directory> --data-dir <directory>
```

`<directory>` is the working directory shown in the page's top bar: either declared by the Host or
typed by the user. User input is passed as a separate argv element, never concatenated into a
command line. The process tree is terminated when the app is disposed.

The engine itself may launch the local `mcode` CLI to run agents. See **Agent turns** below.

### Agent turns

None started by this package. The package declares no `agentAccess` and starts no Agent turn itself.

The embedded engine may invoke the local `mcode` CLI when a run uses the real executor. That is the
behaviour of the upstream plugin, and it is worth spelling out: the engine calls
`mcode exec --permission smart`, so **during a run some file writes and commands are approved
automatically, and any step that would need the user's confirmation fails that node instead of
waiting for you**. The "开始执行" (start) confirmation dialog in the page says the same thing before
you approve a run.

### State

Everything durable lives in `context.dataDir` (see **Files** above). The page keeps no domain data
in browser storage.

## Files

```text
.minimax-plugin/plugin.json                 Plugin manifest
package.json                                Mini App declaration
skills/workflow-console/SKILL.md            Skill the Agent loads to drive this console
miniapp/miniapp.json                        Payload roots, Node entry, page route
miniapp/client/index.html                   The page served at /dashboard
miniapp/client/app.js                       Front end (plain HTML/CSS/JS, no framework, no build)
miniapp/client/style.css                    Styling, light and dark themes
miniapp/node/server.mjs                     Node entry: start(context) -> { dispose }
miniapp/node/miniapp-api.ts                 Type declarations for the runtime context
miniapp/node/vendor/dynamic-workflows/      Vendored upstream runtime (0.8.0, Apache-2.0)
tests/workspace-resolution.test.mjs         Working-directory resolution
tests/engine-isolation.test.mjs             The bundled engine is the only backend
tests/vendor-integrity.test.mjs             Vendored files match the recorded upstream commit
tests/end-to-end.test.mjs                   Full engine lifecycle, from empty workspace to a finished run
tests/manual-mac-scenario.mjs               Boots an isolated instance that mimics a fresh macOS host
icon.png                                    Plugin icon
```

## Tests

The tests use Node's built-in test runner and start an isolated console instance in a sandbox home
directory, so they never touch a real project:

```bash
npm test
```

`npm test` runs `node --test "tests/*.test.mjs"` in this directory; the same command works
without npm.

`tests/workspace-resolution.test.mjs` covers working-directory resolution: the Host's temporary
deployment directory and other implausible paths are rejected, the home directory is never used as
a fallback, and the engine does not start until a project directory is known.
`tests/engine-isolation.test.mjs` plants a fake registry of the other plugin's services — pointing
at a local server that records every request — and asserts the console never contacts it.
`tests/vendor-integrity.test.mjs` verifies that every vendored file still matches the upstream
commit recorded above.
`tests/end-to-end.test.mjs` starts the real bundled engine and walks the whole path: empty
workspace → project directory chosen → engine live → a demo run created → the flow graph →
approve → the run finishing → report export → hide and restore → switching to another project →
invalid directories refused. It uses the `demo` executor, so it calls no model.
`tests/manual-mac-scenario.mjs` starts a console whose working directory is a temporary deployment
directory and prints the URL to open for manual inspection.

## License

[MIT](./LICENSE). The vendored upstream runtime keeps its own Apache-2.0 license.

<!-- plugin-tests workflow trial, do not merge -->
