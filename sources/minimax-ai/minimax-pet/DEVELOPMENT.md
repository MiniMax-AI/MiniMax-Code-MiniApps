# MiniMax Pet development notes

Work from this directory with Node.js 22 or later:

```sh
npm ci --ignore-scripts
npm test
npm run test:smoke
npm run package
npm run check:package
```

`npm run build:markdown` rebuilds `miniapp/client/vendor/markdown.mjs` and its license file from the pinned `unified` / `remark-parse` / `remark-gfm` versions; run it only when those versions change, and commit both outputs.

`npm run dev -- --port 8080 --data-dir /tmp/minimax-pet-local-data` starts an isolated local resource/API server. Outside a supported MiniMax Code Host, the read/observe, desktop-window, Host navigation, and theme bridges are unavailable. This launcher does not emulate them or send Agent messages. Never use a real Host data directory for smoke tests.

## Behavior to preserve

- The appearance/tasks/settings navigation responds to clicks and ArrowLeft/ArrowRight/Home/End. Background task events, preference saves and thumbnail results never navigate or steal focus.
- Imports are an inline subview with explicit preview/confirm/cancel. Late file reads and image results are fenced by generation. A successful import updates the gallery without switching away from a tab the user has since chosen.
- Wide task views show list and detail together; narrow views provide a return action with focus/scroll restoration. Reading a reply must survive background polls without scroll reset.
- The desktop pet uses compact five-line notification cards and keeps the pet visible while reading. Completed status and answer-needed state must agree across notification, list and detail.
- One global observation plus three detailed observations share the Host budget. Cancellation does not free a slot until its subscription settles. Global reconnect also waits for the previous observation.
- A reply that is still streaming changes on every activity poll: `renderMarkdown` keeps the DOM when the text is unchanged and restores `scrollTop` when it replaces it, so reading is not interrupted.
- A task's latest reply renders through `markdown.mjs`: the vendored parser produces an mdast tree and the module builds DOM nodes from it. Never assign parsed HTML to `innerHTML`; raw HTML in a reply is inert text, links are not opened, and images are not fetched. Notification cards and reminder previews use the flat-text output, which must stay one line per logical line.
- **打开对话** / **去回答** calls `host.navigation.open` synchronously inside the click (the Host checks user activation), never retries automatically, and drops a late result once another task is selected. Without the API the button stays hidden.
- The page follows `host.ui.subscribe` themes through `data-theme`; without it the CSS falls back to `prefers-color-scheme`.
- Preference and imported-resource writes are local to `context.dataDir`. Interrupted replacements retain enough information to restore or finish safely before the next read/write. Legacy ambiguous trash is retained for recovery.
- Resizing the desktop pet first brings the transparent window inside the available screen area so smaller sprites remain reachable.

## Verification

The Node test suite covers state aggregation, observer admission/release, reminders, page navigation, Host navigation and theme, window geometry, import races, and interrupted disk replacement. DOM tests use jsdom; API tests use temporary listeners and directories and close them. Simulated boundaries do not prove real GUI, model, or released-client behavior. See the README for the current acceptance boundary.
