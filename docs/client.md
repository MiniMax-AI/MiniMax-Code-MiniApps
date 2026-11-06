# Mini App page APIs

Verified against MiniMax Code 3.1.11.

MiniMax Code injects `window.mcode.miniapp` into the Mini App's own page. Older clients, ordinary
Browser tabs, and other browsers do not provide it, so check that a method exists before calling
it. No SDK is needed. For type checking, copy `examples/hello-miniapp/miniapp/client/client-api.ts`
next to your Client source and reference it from TypeScript or JSDoc; never load it with a script
tag or import it at runtime.

The bridge only works in the page's own top-level document on its own origin. Keep third-party
scripts out of that document: anything running there shares the page's access to the bridge.

## `miniapp.capabilities.has(name)`

From MiniMax Code 3.1.6, `window.mcode.miniapp.capabilities.has(name)` answers synchronously whether
this client supports a feature, named by its API path: `message.append`, `agent.run`, `agent.open`,
`agent.models`, `agent.agents`, `agent.create`, `agent.observe`, `agent.sessions`,
`agent.session`, `speech.transcribe`, `tool`, `tool.request`, `window`, `hostConnector`, and from
3.1.11 `host.ui.getState`, `host.ui.subscribe`, `host.navigation.getState`,
`host.navigation.subscribe`, `host.navigation.open`. The list is
the same on the page and in Node (`context.capabilities`), and it describes the client, not this
Mini App's grants: `has('agent.run')` is true even without `agentAccess`. Earlier clients have no
`capabilities`, so write `window.mcode?.miniapp?.capabilities?.has('agent.observe')`.

## Browser permissions

From MiniMax Code 3.1.6 the Host decides every browser permission request from a Mini App page and
never shows a browser prompt. Sanitized clipboard writes, fullscreen, pointer lock, and keyboard
lock work without a declaration. The microphone, the camera, and system notifications work only when
`miniapp.json` declares their `deviceAccess` value (`docs/package-contract.md`) and the user has not
switched it off, and only from the page's main frame. Geolocation, clipboard reads, screen
capture, and everything else a browser would prompt for are always denied. Earlier clients granted
these requests silently.

- **Microphone** (`"microphone"`): `getUserMedia({ audio: true })`; without the grant it rejects with
  `NotAllowedError`. Call `getUserMedia` instead of querying first: from 3.1.9
  `navigator.permissions.query({ name: 'microphone' })` reports whether the value is declared and
  switched on, but 3.1.6 to 3.1.8 report `granted` only after a granted `getUserMedia`.
- **Camera** (`"camera"`, MiniMax Code 3.1.9 or later): `getUserMedia({ video: true })`. A request
  for audio and video together needs both values and fails with `NotAllowedError` when either is
  missing or switched off, so request them separately when the page can work with one. The operating
  system may also ask once whether MiniMax Code may use the camera; a refusal there makes
  `getUserMedia` fail as well. The Host shows no camera indicator: show your own while the stream is
  open, and stop its tracks as soon as the page is done.
- **Notifications** (`"notifications"`, MiniMax Code 3.1.9 or later): `new Notification(title, { body })`.
  They appear as MiniMax Code's own notifications. `Notification.permission` reads `granted` when
  the value is declared and switched on, and `denied` otherwise, never `default`;
  `Notification.requestPermission()` resolves at once without a prompt. After the user switches it
  off, notifications are not shown; listen for `error` if the page needs to know.

A click on a notification counts as a user gesture inside its `click` handler, so the page can bring
itself back with `window.focus()` (see [`miniapp.window`](#miniappwindow-proposed)):

```js
const notice = new Notification('Build finished', { body: 'All 42 checks passed.' });
notice.addEventListener('click', () => {
  window.mcode?.miniapp?.window?.focus().catch(() => {});
});
```

A popped-out page shows and focuses its window; a page in the side panel brings MiniMax Code forward
and selects its tab. This works only while the page that created the notification is still open:
after that page closes or reloads, clicking its notification does nothing.

## `miniapp.message.append(text)`

Asks the user to add plain text to the chat input of the conversation the Mini App is open in. The
Host shows its own confirmation with the plugin, the target conversation, and the text. After the
user confirms, the text is appended to the unsent draft; the user can still edit it and must press
Send. The page cannot send messages, read chat history, or change sent messages.

```js
async function addToChat(text, status) {
  const message = window.mcode?.miniapp?.message;
  if (!message?.append) {
    status.textContent = 'This version of MiniMax Code cannot add text to the chat input.';
    return;
  }
  try {
    await message.append(text);
    status.textContent = 'Added to the chat input. Review it there and press Send.';
  } catch (error) {
    status.textContent = error?.message === 'user_cancelled' ? 'Cancelled.' : `Not added (${error?.message}).`;
  }
}
```

- Call it from a user action, such as a button click. `text` is at most 100,000 UTF-16 code units
  and is appended literally. Every call needs its own confirmation.
- Failures reject with an `Error` whose `message` is `user_cancelled`, `invalid_request`,
  `text_too_large`, `not_allowed`, `target_unavailable` (no conversation to add to), or
  `result_unknown`. After `result_unknown` the text may already be in the draft; never repeat the
  call automatically.
- A resolved promise means the text reached the draft, not that the Agent started or replied.

## `miniapp.agent`

Runs Agent turns from the page, and from MiniMax Code 3.1.6 also reads and observes the user's
conversations. Present only on MiniMax Code 3.1.2 or later; calls reject with `not_permitted`
unless `miniapp.json` declares the matching `agentAccess` value. The calls, sessions, events, and
errors are in `docs/agent.md`.

## `miniapp.speech.transcribe(input, options?)`

From MiniMax Code 3.1.6, `window.mcode.miniapp.speech.transcribe({ audio, format }, { onPartial? })`
turns one utterance the page recorded into text with the Host's speech recognition and resolves
`{ text }`. The page owns the microphone and the interaction; the Host only transcribes. It needs
`deviceAccess: ["microphone"]` and the user's microphone switch on, or it rejects with
`not_permitted`.

- `format` must be exactly `{ sampleRate: 16000, channelCount: 1, sampleFormat: 's16' }`, and
  `audio` an `Int16Array` (or the buffer behind one) of 16 kHz mono samples, at most 16,000,000
  bytes (500 seconds). WAV, WebM, Ogg, FLAC, MP3, and `MediaRecorder` output are rejected with
  `invalid_request`. `docs/snippets/audio-capture.ts` records in exactly this format: copy it next
  to your Client source.
- The Host returns text after it has the whole utterance; it does not caption live speech.
  `onPartial` reports the transcript so far while it works. Decide in the page when an utterance
  ends (push to talk, a toggle, or splitting on silence) and call once per utterance.
- One call per Mini App runs at a time; a second call rejects with `busy`.
- Other failures: `runtime_unavailable` (speech recognition is off or the user is signed out;
  offer typing instead), `transcription_failed` and `result_unknown` (the same audio may be sent
  again), `audio_too_large`.
- The Host shows nothing while a page records. Show your own recording indicator, stop the
  microphone as soon as the utterance ends, and make the stop path work even when the pointer is
  released outside the button or `getUserMedia` has not resolved yet.

## `miniapp.tool.request(names)`

From MiniMax Code 3.1.6, a page whose manifest declares `toolAccess: ["call"]` can ask the user,
inside a click handler, to always allow tools its Node entry calls. Listing and calling stay in
Node. See `docs/tool.md`.

## `miniapp.host`

From MiniMax Code 3.1.11, `window.mcode.miniapp.host` reads MiniMax Code's display preferences and,
with `hostAccess`, which part of the app the user is on, and opens a few Host pages. Feature-detect
`window.mcode?.miniapp?.host`; without it, use the Mini App's own defaults. The Host does not style
or translate the page for you.

| Call | Resolves or delivers | Needs |
| --- | --- | --- |
| `host.ui.getState()` | `{ theme, language }` | Nothing |
| `host.ui.subscribe(listener, { onError }?)` | The full state at once, then every change. Returns `{ dispose() }`. | Nothing |
| `host.navigation.getState()` | `{ key, view, overlay }` | `hostAccess: ["navigation.read"]`, its switch on, and the page visible |
| `host.navigation.subscribe(listener, { onError }?)` | The full state at once, then every change. Returns `{ dispose() }`. | The same; paused while the page is hidden |
| `host.navigation.open(target)` | `{ status: 'opened' }` or `{ status: 'cancelled', reason }` | A user gesture |

```js
const host = window.mcode?.miniapp?.host;
const display = host?.ui.subscribe(
  ({ theme, language }) => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = language;
  },
  { onError: ({ code }) => console.warn('Host preferences unavailable:', code) },
);
addEventListener('pagehide', () => display?.dispose(), { once: true });

settingsButton.addEventListener('click', () => {
  host?.navigation.open({ id: 'settings', section: 'appearance' }).catch(({ code }) => showError(code));
});
```

- `theme` is the theme in effect, `light` or `dark`; a "follow the system" setting is already
  resolved. `language` is the interface language in effect, currently `en` or `zh-Hans`. A new
  language setting takes effect, and is reported, only after MiniMax Code restarts.
- `view` is `home`, `conversation`, `plugins`, `schedule`, or `other`. `overlay` is
  `{ type: 'settings' }` while settings are open, otherwise `null`. `key` changes with every
  navigation, also when the user returns to a view they just left. It is an opaque value for this
  page only: it contains no session ID or URL, and `open` does not accept it. Navigating does not
  change the conversation the Mini App is bound to.
- Navigation is delivered only while the page is visible: `getState()` rejects while it is hidden,
  and a subscription pauses and, once the page is shown again, delivers only the latest state. A
  page in the side panel still counts as visible while settings cover it.
- Call `open(target)` directly in a click or key handler; it checks
  `navigator.userActivation.isActive`. Targets: `{ id: 'home' }`, `{ id: 'plugins' }`,
  `{ id: 'schedule' }`, `{ id: 'settings', section }` with an optional `section` of `'appearance'`
  or `'language'`, and `{ id: 'session', sessionId, source: 'local' }`. Paths and URLs are not
  accepted. Opening a session whose ID the Mini App already holds needs no `"session.read"` and
  grants no access to it. A session that does not exist and one the Mini App may not see both fail
  with `target_unavailable`; any `source` but `'local'` fails with `unsupported_source`.
- `opened` means the page is shown, not that its data has loaded. `cancelled` with
  `user_cancelled` means the user chose to stay on unsaved work; `superseded` means another
  navigation replaced the request.
- Failures reject with a plain object `{ code, message }`, not an `Error`: read `code`, and do not
  test `instanceof Error`. `code` is `invalid_request`, `not_permitted`, `host_unavailable`,
  `unsupported_source`, `unsupported_target`, `target_unavailable`, or `result_unknown`.
  Subscriptions report the same object through `onError` when they fail to start or end.
- `result_unknown`, which `open` also returns after 60 seconds without an answer, means the outcome
  is unknown. Do not repeat `open` automatically.
- A page holds at most 64 Host subscriptions; dispose them when done. A subscription ended by the
  user switching `navigation.read` off, or by `host_unavailable`, does not resume: subscribe again
  later.

## `miniapp.window` (proposed)

Present on MiniMax Code 3.1.2 or later. **Proposed:** the shape may still change. Feature-detect
`window.mcode?.miniapp?.window` and do not rely on it long-term.

The handle controls this Mini App's own window: whether the page sits in the side panel (`inline`)
or is popped out (`window`), and, when popped out, its position, size, and a few flags.

```js
const handle = window.mcode?.miniapp?.window;
if (handle) {
  const state = await handle.getState(); // { mode: 'inline' } or { mode: 'window', window: {...} }
  button.addEventListener('click', () => {
    void handle.update({ mode: 'window', width: 900, height: 650 }).catch(showError);
  });
  const subscription = handle.onDidChangeState((next) => render(next));
  addEventListener('pagehide', () => subscription.dispose());
}
```

- `id` is an opaque string that stays the same while the page pops out and back.
- `update(patch)` accepts `mode`, `width`, `height`, `x`, `y`, `visible`, `resizable`,
  `alwaysOnTop`, `clickThrough`, and `skipTaskbar`; omitted fields are unchanged. `frame`,
  `transparent`, `minWidth`, and `minHeight` can only be declared in `surface.window`
  (`docs/package-contract.md`), and a patch containing them is rejected.
- Changing `mode`, and `focus()`, must come from a user gesture (for example, synchronously inside
  a click handler, or in the `click` handler of a notification the page created); otherwise they
  reject with `not_permitted`.
- When `getState()` includes `modeChangeReloadsPage: true`, changing `mode` reloads the page. The
  window `id` and the Node process stay, but the document, its JavaScript state, streams, and
  pending promises do not. Save what the page needs before calling `update({ mode })`, do not put
  required work after it, and read the state again when the new page loads. MiniMax Code asks the
  user to confirm the switch first; when they cancel, `update` resolves with the unchanged state, so
  check `mode` instead of assuming it changed.
- `alwaysOnTop: true` and `clickThrough: true` are allowed only when `surface.window` declares that
  field `true`. `width` / `height` are rejected when the window is not resizable. `x` / `y` are
  rejected when the window would not overlap any display.
- Several `update` calls in one animation frame are merged into one request and share its outcome.
- Failures reject with an `Error` whose `message` is `inline_mode` (only `mode` may change while
  inline), `not_permitted`, `busy` (a confirmation, `mode` change, or page reload is already in
  progress), `invalid_request`, or `result_unknown`.

Pitfalls:

- `frame: false` removes the title bar. Add a CSS `-webkit-app-region: drag` area so the user can
  move the window.
- `transparent: true` also needs a transparent page background. The window has no native shadow;
  use CSS `box-shadow` with transparent padding.
- The window does not resize with content. Keep `html, body { height: 100%; overflow: hidden }` and
  scroll inside the page.
- Leaving `clickThrough` on makes the whole window, including its own controls, unclickable. Turn
  it on only for the state that needs it.
- `update({ visible: false })` hides the window but the page keeps running. A hidden or minimized
  window counts as hidden, so the Host may reload its page (see "Lifecycle" in `docs/runtime.md`).
- The window title is always the plugin's `displayName`.
