# WeChat Mini Program & Game Preview

English | [简体中文](README.zh-CN.md)

A local MiniMax Code Mini App for previewing an **existing native WeChat project**. It compiles
WXML/WXSS/JavaScript/TypeScript into a browser approximation, or runs a Canvas2D/WebGL mini game,
inside the same preview plugin. It does not replace your project with a generated HTML app.

The page contains a phone preview and one **Refresh preview** button. Project selection, build
errors, runtime logs and recovery are handled through the chat's MCP tools. The interface and
bundled workflow skill are currently in Chinese.

## Features

- Native project discovery from `project.config.json`, `app.json`, or `game.json`; JS/TS, CommonJS,
  ESM and prebuilt npm module graphs. Taro/uni-app projects must first produce native output.
- Page/component rendering using bundled glass-easel 1.2.0 and its miniprogram adapter, with a
  custom WXML/WXSS bridge and a limited `wx` API implementation.
- Retained page stacks: `navigateTo`, `navigateBack`, `redirectTo`, `switchTab`, `reLaunch` and
  `getCurrentPages`. Returning preserves instances, native input drafts, scroll positions and
  animation timelines, rather than replaying the page's initial animation.
- Separate Canvas2D/WebGL mini-game runtime, local images, orientation/DPR handling and chat-side
  pause/resume/restart controls.
- Source watching, debounced rebuilds, immutable build resources and project-scoped persistent
  Storage with revision checks. Automatic rebuilds are **not state-preserving HMR**.
- A fixed, decorative WeChat-style capsule and device notch. Capsule colors follow navigation
  configuration (default white, explicit black supported), not scrolling page content. The
  simulated status bar shows time, Wi-Fi and battery, without a cellular signal icon.

## Install and open

The runtime bundles are committed: **installation requires no npm install or build**.

1. Copy this complete directory, including `.minimax-plugin`, into
   `<dataDir>/plugins/wechat-miniprogram-preview/`. The default `dataDir` is `~/.minimax`; use your
   configured directory if different. Do not include the `adherez` parent directory.
2. Follow the repository's [installation instructions](../../../README.md#2-install). Do not
   copy over a running plugin without first saving/exporting any pending preview data.
3. In your project chat, ask:

   ```text
   Use the installed wechat-miniprogram-preview Mini App to preview this native WeChat project.
   Reuse this plugin; do not create a replacement HTML Mini App or modify project code just to open it.
   ```

The bundled `wechat-project-preview` skill tells the Agent to list existing previews, open the
explicit project path, and execute the returned **`hostOpenAction`** with the Host's `miniapp`
tool. A successful compile alone does not open the side panel. Internal paths such as
`/preview?previewId=...` are Host routes, not public links or ordinary browser URLs.

Opening `/preview` without a preview ID shows an empty-state instruction; it never selects another
chat's project automatically. Normal explicit project opens do not require a second directory
authorization dialog. An occupied preview is not automatically taken over.

## Tested environment

- MiniMax Code **3.1.4**, macOS on Apple Silicon; Node.js 22 for development checks.
- The local development version has been installed and started through the desktop Host. Native
  Mini Program and Canvas2D/WebGL demo previews have been exercised during development.
- Page-stack, capsule/default-color and notch changes have focused Node/jsdom tests and isolated
  Chromium checks. The final cellular-icon removal was installed without an additional visual
  acceptance pass; do not interpret that as a new full Host acceptance run.
- Windows, Linux desktop hosts, real-device rendering, large game engines, and the exact
  public-package install flow have not been manually verified. No claim of complete parity with
  WeChat DevTools or a WeChat device is made.

## Data & access

- **Files read:** the explicit project directory's supported source/configuration/media files,
  its configured source root and referenced local dependencies; the plugin's own runtime/demo
  assets. No project scripts, package install commands, or Node business modules are executed by
  the compiler. It checks canonical paths, directory identity and resource/size limits, rejecting
  broad system/home/configuration roots and escaping links. These checks are not a per-chat
  filesystem permission sandbox; only preview projects you trust.
- **Files written:** preview descriptors (including canonical project paths), Storage and migration
  metadata under the Host-provided **`context.dataDir`**. This directory is treated as opaque.
  The runtime does not edit your project, read Host credentials, inspect chat history, or depend on
  Host database locations. User-requested Storage export downloads a JSON file through the browser.
- **Network:** Node makes no outbound requests. Its HTTP/MCP/SSE server binds only the Host-assigned
  loopback address/port. The preview iframe allows **HTTPS image URLs authored by the project**
  (`img-src https:`), which can contact arbitrary project-chosen image hosts and disclose usual
  network metadata; there is no fixed host allowlist. `wx.request` and other network APIs are not
  implemented; iframe `connect-src` is `none`. There is no analytics or upload service.
- **Processes:** the plugin spawns none. MiniMax Code starts its Node runtime. Development-only
  build/test commands are run explicitly by contributors, not during installation or startup.
- **Agent turns:** the Mini App page does not run Agent turns and declares no `agentAccess` or
  `hostConnectorAccess`. The surrounding chat Agent can invoke the declared `wechat-preview` MCP
  tools and read build diagnostics/logs. Logs may contain application text; do not log secrets in
  a project you preview. Storage recovery passes metadata to the Agent, not saved business data.
- **Execution boundary:** project JavaScript runs in an opaque sandboxed iframe (`allow-scripts`,
  no `allow-same-origin`), without Node or Host credentials. The interpreter requires CSP
  `unsafe-eval`. This is not an arbitrary-malicious-code sandbox: loops can stall rendering,
  HTTPS images can make requests, and browser scheduling is not a native debugger.

## Refresh, state and recovery

Within one live preview, navigation retains up to 10 page entries. Returning calls `onShow`; it
does not suppress project code that deliberately reloads data there. Rebuild, manual refresh,
device changes and runtime restarts replace the iframe: page-stack memory and uncommitted input
are lost, while confirmed Storage and the last route persist.

Storage is scoped by canonical project directory, not chat. Multiple previews of the same
directory share saved data and use revision/CAS checks. A project has a 1 MiB JSON Storage limit.
The process permits at most 8 preview descriptors, 4 active projects and 4 connected preview
pages. Resource limits return diagnostics rather than silently closing another preview.

On conflicts, lost responses or occupied previews, use `preview_status` / `preview_logs` and the
reported recovery actions. `takeover`, `discard_local` and `close` require explicit confirmation.
Do not keep creating new previews or editing private state files to bypass ownership. Before
updates, export valuable pending data; stop/start only this Mini App if the Host retains an old
runtime. Reopen its original `previewId` after restart. Saved Storage is not a backup of page memory.

## Known limitations

This is an H5 approximation, not the WeChat runtime or compiler. It does not implement login,
payment, cloud services, scanning, real-device preview, upload/release, Worker/WASM, open-data
contexts, game subpackage loading or the full WeChat API. WebAudio and several native controls
are unsupported. Custom tab bars, complex WXS/CSS, native navigation transitions and EventChannel
are not fully reproduced. The capsule is decoration, not a working WeChat menu/exit button.

## Development

From this package directory, use Node.js 22 and pnpm 9.15.9:

```sh
pnpm install --frozen-lockfile
pnpm run build
node --test tests/client.test.mjs tests/page-stack.test.mjs tests/viewport-controls.test.mjs
node --test tests/project-access.test.mjs tests/preview-service.test.mjs tests/project-storage.test.mjs
node --test tests/preview-http.test.mjs tests/game-http.test.mjs tests/shell-protocol.test.mjs
node scripts/package.mjs /absolute/path/to/wechat-preview.zip
```

The build regenerates the committed vendor bundles and their notices. The packaging script
includes the runtime, skill, README files, LICENSE and docs, but not dependencies, tests or build
sources. Its isolated import/compile/jsdom checks do not prove Host rendering. From the repository
root also run `npm run check` before contributing.

[Architecture and tools](docs/architecture.md) · [MIT License](LICENSE). Third-party bundle
licenses are preserved in `miniapp/client/vendor/THIRD-PARTY-NOTICES.txt` and
`miniapp/node/vendor/THIRD-PARTY-NOTICES.txt`. No WeChat DevTools/WorkBuddy executable, SDK bundle,
SVG asset or user project is included.
