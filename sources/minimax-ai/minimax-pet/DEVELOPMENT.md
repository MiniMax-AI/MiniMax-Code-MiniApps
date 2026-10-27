# MiniMax Pet development notes

Work from this directory with Node.js 22 or later:

```sh
npm ci --ignore-scripts
npm test
npm run test:smoke
npm run package
npm run check:package
```

`npm run dev -- --port 8080 --data-dir /tmp/minimax-pet-local-data` starts an isolated local resource/API server. Outside a supported MiniMax Code Host, the read/observe, desktop-window, confirmed draft, and transcription bridges are unavailable. This launcher does not emulate them or send Agent messages. Never use a real Host data directory for smoke tests.

## Behavior to preserve

- The appearance/tasks/settings navigation responds to clicks and ArrowLeft/ArrowRight/Home/End. Background task events, preference saves and thumbnail results never navigate or steal focus.
- Imports are an inline subview with explicit preview/confirm/cancel. Late file reads and image results are fenced by generation. A successful import updates the gallery without switching away from a tab the user has since chosen.
- Wide task views show list and detail together; narrow views provide a return action with focus/scroll restoration. Reading a reply must survive background polls without scroll reset.
- The desktop pet uses compact five-line notification cards and keeps the pet visible while reading. Completed status and answer-needed state must agree across notification, list and detail.
- One global observation plus three detailed observations share the Host budget. Cancellation does not free a slot until its subscription settles. Global reconnect also waits for the previous observation.
- Draft input targets the original chat via confirmed `message.append(text)` and never auto-sends. Leaving the draft cancels recording/transcription but preserves typed text.
- Preference and imported-resource writes are local to `context.dataDir`. Interrupted replacements retain enough information to restore or finish safely before the next read/write. Legacy ambiguous trash is retained for recovery.
- Resizing the desktop pet first brings the transparent window inside the available screen area so smaller sprites remain reachable.

## Verification

The Node test suite covers state aggregation, observer admission/release, reminders, page navigation, draft and speech cancellation, window geometry, import races, and interrupted disk replacement. DOM tests use jsdom; API tests use temporary listeners and directories and close them. Simulated boundaries do not prove real GUI, microphone, model, or released-client behavior. See the README for the current acceptance boundary.
