# Architecture

```text
Chat Agent + wechat-project-preview skill
  -> managed wechat-preview MCP endpoint
  -> project/path validation + PreviewService
  -> module/WXML/WXSS compilation + immutable build cache + source watcher
  -> preview descriptor / active-frame lease / project Storage revision
  -> authenticated shell requests a self-contained document
  -> sandboxed data iframe
       |- Mini Program: glass-easel + component adapter + Page/wx bridge
       `- Mini Game: Canvas2D/WebGL + scheduler/input/resource adapters
  -> status, route and storage messages bound to the active frame identity
```

## Package layout

- `miniapp/node/server.mjs`: Host entry, HTTP routing, CSP and MCP.
- `miniapp/node/compiler.mjs`, `module-graph.mjs`, `wxml.mjs`, `wxss.mjs`: native project compilation.
- `miniapp/node/game-compiler.mjs`: game entry graph and configuration.
- `miniapp/node/preview-service.mjs`, `preview-contexts.mjs`, `preview-shells.mjs`: context ownership,
  operation identity and metadata-only recovery.
- `miniapp/node/project-storage.mjs`: project-level versioned Storage, atomic writes and migration.
- `miniapp/client/shell.js`: single-refresh page, frame lifecycle, storage drain and recovery UI.
- `miniapp/client/sim-runtime.js`: retained page entries, built-in component adapters and wx stubs.
- `src/component-runtime.mjs`: glass-easel bridge source; its browser bundle is committed under
  `miniapp/client/vendor/`.
- `miniapp/client/game-runtime.js`: separate game runtime; does not load glass-easel.
- `src/js-transform.mjs`: Sucrase-based module transform/analyzer source, bundled into Node vendor.
- `tests/`: explicit Node test files, with synthetic temporary projects and jsdom helpers.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `preview_open_project` | Read/build an explicit native project and return its Host open action |
| `preview_list` | List descriptors without choosing or stealing one |
| `preview_status`, `preview_logs` | Inspect build/runtime/connection diagnostics |
| `preview_navigate` | Request an explicit route; this is not the app's push/back navigation |
| `preview_rebuild` | Compile and request a safe frame reload |
| `preview_game_control` | Pause, resume or restart a selected game preview |
| `preview_recover` | Retry, export or explicitly confirm discard/takeover/close on a live shell |
| `preview_close` | Close an idle context without deleting project source or saved Storage |

An `accepted` command needs a subsequent runtime acknowledgement. Old frame messages cannot
be relabeled as current: project, preview, build, server epoch, lease epoch, client and instance
identities are checked. The shell owns pending in-memory Storage; a metadata response never
proves an export file was downloaded successfully.

## Page stack and rendering

`navigateTo` retains the previous Page/Component/DOM root and pushes another entry. Inactive
entries remain laid out, but use `inert`, `aria-hidden`, hidden visibility and zero opacity so
they cannot receive user input and do not restart CSS animations when revealed. Their viewport
dimensions/variables are retained while another page changes navigation layout.

`navigateBack(delta)` disposes only popped entries. `redirectTo` replaces the top entry;
`switchTab` retains created tab pages; `reLaunch` disposes the stack and tab cache. Page data and
native drafts survive ordinary navigation. They do not survive a new iframe or runtime.

This is not the official multi-WebView renderer: native transitions, gestures, process isolation
between pages and complete EventChannel semantics are outside its scope.

## Dependencies and reproducibility

Development dependencies are pinned in `package.json` and `pnpm-lock.yaml`. `scripts/build.mjs`
generates self-contained browser/Node bundles and license notices. The public package includes
both sources and generated runtime assets; installation never resolves npm modules.

`scripts/package.mjs` stages only installable files, verifies import/compile/basic jsdom startup,
rejects links and node_modules, and creates a ZIP with a SHA-256 result. `miniapp.publish` accepts
an extracted, complete package directory rather than a ZIP and does not run the build.

## Security and compatibility

See the README's **Data & access** section before opening a project. Host loopback authentication
is external to this package. Never send its credentials to the iframe or expose a generic file
proxy. The Node runtime does not spawn tools, request remote resources or run business code.
The iframe may load project-provided HTTPS images; do not describe the preview as fully offline.

Focused unit/protocol tests, isolated Chromium checks, desktop Host checks and official WeChat
device checks establish different claims. A green build or mocked lifecycle test alone is not
visual acceptance or proof of full WeChat compatibility.
