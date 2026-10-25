# Patches to the vendored FableCut source

## Compact monitor and localized menus

The monitor header keeps one row of tabs and icon controls. Canvas aspect, frame rate, export framing and resolution move into a keyboard-accessible popover; the original controls and stored values remain unchanged. Snap targets and sequence actions follow the selected language while user sequence names stay untouched and escaped. Playback controls wrap when the monitor is narrow, avoiding overlap with timecodes. Six browser tests cover menu localization, raw values, escaped names, popover operation and layout at five viewport widths.

## Icon-first controls

Thirteen media and timeline actions use inline SVG icons with localized accessible names, shortcut tooltips and visually hidden text. Their IDs, handlers and enum values remain unchanged. Import keeps a keyboard-focusable file input and visible focus ring. Empty states use one short prompt; Export, navigation and field labels remain visible. The two range-delete labels remain distinct. Eleven tests cover names, keyboard access, action behavior and 32-pixel targets at three viewport widths.

## Responsive editor layout

The client toolbar now has primary and secondary rows with wrapping controls and a non-wrapping zoom group. Media and inspector panels have accessible collapse/restore rails with browser-local preferences and responsive defaults. The monitor meter occupies a separate gutter outside the picture; monitor fitting uses the remaining picture area without changing canvas resolution. Chinese monitor and range-edit terminology was revised. Six browser tests cover English/Chinese layouts at 1280x900, 923x899 and 720x800, panel restoration, meter separation and monitor zoom. Host checks covered the empty workspace and a synthetic timeline; the test project is retained separately.

Everything under `miniapp/node/vendor/fablecut/` and `miniapp/client/` is
vendored from [FableCut](https://github.com/ronak-create/FableCut) 1.16.0,
commit `fd2af081d73ec94464b88df8c21f640adcc78985` (MIT, © 2026 ronak-create).
The upstream revision is recorded in `upstream.json`.

The changes below are the whole difference. Each one says what it is for, so
the upstream files can be re-vendored later and the patches re-applied.

Files this package adds that are not upstream:

| File | What it is |
| --- | --- |
| `miniapp/node/server.mjs` | The Node entry: `start(context)`, the HTTP server, the routing, the lifecycle. |
| `miniapp/node/adapters/local-api.mjs` | The in-process transport that lets the MCP tools call the editor without a socket. |
| `miniapp/node/adapters/mcp-http.mjs` | The Streamable HTTP MCP endpoint; rejects browser Origin/Fetch Metadata requests so page scripts cannot acquire Agent file capabilities. |
| `miniapp/node/adapters/export-tool.mjs` | The wrapper that adds `minimax_cut_export` to the upstream tool list without touching the upstream dispatcher. |
| `miniapp/node/export/job-state.mjs` | The state of one export job: ids, the managed root, the atomic state file. |
| `miniapp/node/export/prepare.mjs` | Copies the saved project, its media, the library assets, the editor and the runner into a job folder under the data dir. |
| `miniapp/node/export/export-mcp.mjs` | The `minimax_cut_export` tool definition and the text it answers with. |
| `miniapp/node/export/runner.mjs` | The standalone runner: its own loopback server, its own secret, its own headless browser. Copied into every job folder. |
| `miniapp/node/vendor/puppeteer/` | A bundled build of Puppeteer Core and the 55 runtime packages it pulls in, the browser automation library the runner drives the render with. See its `PROVENANCE.md` and `licenses/INVENTORY.md`. |
| `miniapp/node/vendor/fablecut/processes.js` | Tracks media child processes and waits for their termination when the Host stops the runtime. |

---

## `miniapp/node/vendor/fablecut/server.js`

1. **The static root is configurable.** `ROOT` stays the module's own folder
   (the encode profiles are watched there); a new `STATIC_DIR` takes the
   editor's static files from `FABLECUT_STATIC_DIR`, which the entry points at
   the client payload. The last two lines of the request handler serve from
   `STATIC_DIR` instead of `ROOT`.

2. **The request handler is a plain function.** `const server = http.createServer(async (req, res) => {…})`
   became `async function handleRequest(req, res) {…}`, and the module exports
   it. A Mini App must bind only the port the Host assigns, so the upstream
   server cannot create and listen on a server of its own.

3. **The standalone listener is gone.** The `server.listen(PORT, HOST, …)`
   block, with its banner and its `console.log` lines, was removed together
   with the `PORT`/`HOST` constants: the Host owns stdout, and a fixed port
   is not allowed. `startExportSweep()` now runs at load, where the listen
   callback used to call it.

4. **`shutdown()` is a library call.** It no longer closes a server or calls
   `process.exit`, and it no longer registers `SIGINT`/`SIGTERM` handlers.
   It closes the export sweep, the export sessions, the auto-version timer,
   the two debounce timers, the directory watchers and the live-reload
   clients; the entry calls it from `dispose()`. The `fs.watch` calls now keep
   their handles in a `watchers` array so they can be closed.

5. **The logger is injectable.** `console.warn` on a damaged `project.json`
   goes through `log.warn`, which reads `globalThis.__FABLECUT_LOG__` — the
   entry sets that to `context.logger`. The fallback is stderr.

6. **The host gate has a same-origin rule.** `FABLECUT_TRUST_HOST=1` accepts a
   request whose `Origin` names the same host as the request itself, whatever
   host name the Host serves the page under. A cross-origin request still
   fails the origin check. The Host already guards the assigned port with a
   per-run credential, so a request that reaches the handler is authenticated.

7. **`path=` needs the local transport, not a header.** The `X-FableCut-Client:
   mcp` header is gone as the gate: the page is same-origin and can set any
   header it likes. The absolute-path capability is granted to a request that
   carries the symbol `Symbol.for("fablecut.localRequest")`, which only the
   in-process transport sets and which cannot be forged from a page.

   The split is the upstream one, with the page on the outside of it: the page
   cannot name a file outside `media/` and `library/` at all, while the local
   MCP client — which the user asked for, and which can read any file the user
   can — still can. The editor page itself never uses `path=`; it reads served
   `src=` paths only.

## `miniapp/node/vendor/fablecut/mcp-server.js`

1. **A transport can replace the HTTP client.** `apiJSON`, `apiBytes` and
   `httpOk` use a transport when one is installed (`setTransport`), and
   `ensureUIServer()` then reports that the editor is there. Upstream reaches
   the editor over HTTP on 127.0.0.1:7777; here the editor is this same
   process, so the tools call its request handler in-process. Without a
   transport the upstream HTTP path is unchanged.

2. **The stdio plumbing is gone.** The newline-delimited JSON-RPC loop over
   stdin and its `process.stdout.write` were replaced by `handleMessage(msg)`,
   which answers with the response object, and by the module exports. The
   Host owns stdin and stdout.

3. **`fablecut_set_project` compares the submitted document's revision.**
   Upstream compared the file's revision with `lastReadRevision`, a
   process-global that records the last read. With several MCP sessions in
   one process, another session's read answered for this write and a stale
   document slipped through. The base is now the revision carried by the
   submitted document — the same rule `fablecut_patch_project` applies to
   `baseRevision` — and a document without a revision falls back to the last
   read, because it makes no claim of its own. The write helper also refuses
   writes after runtime disposal has begun.

4. **`relinkMedia` and `replaceMedia` see the file's details.** The ops are
   applied synchronously, but the details come from ffprobe, which is
   asynchronous: upstream handed the op a Promise, so a replaced media entry
   kept no duration and no width and its clips were never trimmed to fit. The
   files the ops name are probed first, and the op reads a plain value.

5. **The editor's location is settable.** Upstream printed its own loopback
   URL, so the user could open the editor in a browser. A host that serves the
   page itself has no such URL to print: `setEditorLocation()` replaces the
   three strings, and the entry points them at the Mini App.

6. **`fablecut_import_project` was added.** The upstream editor can import a
   project document, but a document on its own is not portable: its media
   entries name `/media/…` paths that belong to the data folder it was made
   in. The new tool imports a project *folder*: the document is read, the
   media files it uses are copied into this installation's library (never
   overwriting anything), the entries point at the copies, the originals are
   left untouched, and the project is saved as the open one at the actual
   current revision. It prevalidates document/media real paths, refuses missing
   or escaping sources, supports nested source folders, and copies into safe
   unique destination names. Library references are resolved by content rather
   than silently reusing a different asset. It snapshots the existing project
   before replacement and refuses concurrent changes during probing. It writes
   the same shared `project.json` that `fablecut_set_project` writes.

7. **The `where` parameters say what is possible.** The four `where`
   descriptions and the `fablecut_export` and `fablecut_frame` descriptions
   no longer offer a headless browser: in this package there is none, because
   a background browser cannot load the editor's authenticated origin.

## `miniapp/node/vendor/fablecut/export-jobs.js`

`createExportJobs` takes `allowHeadless`. When it is false — as it is here —
`where: "headless"` is refused with an explanation, and `where: "auto"` with
no editor tab open is refused as well. The compositor is the editor tab.

## The standalone export runner

This package adds a second way to render, beside the editor-tab export. It is
built entirely from this package's own files; the vendored FableCut sources are
unchanged for it.

`minimax_cut_export {action:"prepare"}` copies into a job folder under the
data dir:

- the saved project document,
- every media and library file the document names (byte-for-byte copies, never
  hard links), plus the user's saved presets, templates, delivery presets and
  fonts,
- the editor's client payload and the whole `vendor/fablecut/` runtime,
- a copy of `runner.mjs` and `job-state.mjs`,
- the bundled Puppeteer Core build under `vendor/puppeteer/`.

The copy refuses a source that is missing or that resolves outside the
project's own media or library folder, before the job becomes runnable.

The copied runtime folder gets a `package.json` of its own that says
`"type": "commonjs"`. Without it the nearest `package.json` above the job
folder decides how the runtime's `.js` files are read, and an ancestor that
says `"type": "module"` turns them into ES modules - the runner's
`require` of `server.js` then fails with "require is not defined".

The runner then loads its **copy** of the runtime with `FABLECUT_DATA_DIR` and
`FABLECUT_STATIC_DIR` pointing at the job folder, so it reads the snapshot and
never the live project, and it does not depend on the installed package
directory after the handoff. It serves the editor on an ephemeral loopback port
of its own:

- every request has to carry a secret the runner generated for that run; the
  secret never appears in a URL, in an argument or in a log line,
- only the packaged render assets, the snapshot, the media and library copies
  and the render's own begin/frame/audio/end endpoints are served; every other
  route, method and query parameter is refused before the upstream handler sees
  it,
- the page may not reach any other origin: the browser's requests are
  intercepted and anything that is not this origin is aborted.

The render itself is upstream's: the editor page's `fastExport`, its
`renderAudioMix` and the upstream server's ffmpeg encoding are used unchanged.
The upstream `allowHeadless: false` is left alone - the runner does not use
upstream's headless path, it drives its own browser.

## Media process ownership
`analyze.js`, `denoise.js`, `encode-profiles.js`, `export-jobs.js`,
`import-url.js`, `mcp-server.js`, `media-probe.js`, `proxy.js`, and `server.js`
import the local `processes.js` adapter instead of `child_process`. Their
argument arrays and media operations remain unchanged. The adapter tracks
asynchronous children, stops them on disposal and rejects new work after
shutdown. The entry also cleans up children when binding the Host port fails.

## `miniapp/node/vendor/fablecut/analyze.js`

The `node analyze.js <video>` command line entry was removed: it writes a
frame or a beat sheet to stdout, and the Host owns stdout. The functions it
used are still exported and still reachable through the editor and the tools.

## `miniapp/node/vendor/fablecut/paths.js`

The keys of the `SUPERSEDED` map follow the font file names, which this
package had to rename (see below), so the five entries with a space in the
name were changed to the hyphenated name. The checksums are unchanged.

## `miniapp/client/app.js`

The font family a library font is registered under is now read through
`shippedFontFamily()`. The file names of the shipped fonts carry no space in
this package (a package path may not contain one), and the map keeps the
upstream family names — "Abril Fatface", "Archivo Black", "Bebas Neue",
"DM Sans", "Playfair Display" — that the text presets ask for. A font the
user drops in is still registered under its own name.

## Interface localization (English / 简体中文)

This package adds a second interface language to the editor. The upstream
editor has no translation layer, so the whole feature is local to the client
payload; the Node side, the MCP tools and the project format are untouched.

Three files are new:

- `miniapp/client/i18n.js` — the runtime. It owns the locale, the
  browser-local preference (`localStorage`, key `fablecut-locale`), the
  lookup (`t()`), the static `data-i18n` pass, the `html lang` attribute and
  the document title. A key that is not in a dictionary is returned
  untouched; a key that is in one is translated, which is why the editor
  never hands user text to the translator.
- `miniapp/client/i18n-en.js` — the English dictionary. Its values are the
  keys, so it is the fallback locale and the source of truth for the key set.
- `miniapp/client/i18n-zh-CN.js` — the Simplified Chinese dictionary.

The key is the English source phrase. Both dictionaries hold exactly the same
key set — 1799 keys — which `tests/i18n.test.mjs` checks. A plain key's English
value is that same phrase, so English is the fallback locale and the source of
truth for the key set. Labels that would collide across contexts are grouped
with a prefix (`kf.`, `fx.`, `anim.`, `delivery.`, `fit.`, `blend.`, `preset.`,
`align.`, `vAlign.`, `direction.`, `channel.`, `denoise.`, `matte.`, `kind.`,
`shape.`, `transition.`, `textAnim.`); a grouped key's English value is a
readable label (`fit.contain` → `Contain`) rather than the id, and a grouped
label is translated at the display site only, so the stored value never changes.

How the translation reaches the screen:

- The static markup carries `data-i18n`, `data-i18n-title`,
  `data-i18n-aria-label` and `data-i18n-placeholder`. `data-i18n` writes
  `textContent`, never `innerHTML`.
- The parts the editor builds at runtime call `T()` at the point where the
  text is produced: a toast, a `textContent`, a `title`, an `aria-label`, a
  placeholder, a label in an HTML template, a menu item, a select option.
- A built-in constant keeps its English source (`TITLE_STYLES`,
  `ASPECT_PRESETS`, the audio-FX and colour and delivery tables, the
  template and animation-preset names). Only the text on screen is
  translated, at the display site.
- Nothing rewrites the page: there is no `MutationObserver` and no bulk text
  replacement, so user text is never touched by accident.

An option whose label is translated always carries an explicit `value`
attribute holding the raw id (`<option value="${x}" …>${enumLabel("transition",
x)}</option>`). Without it the browser would use the translated text as the
value and the saved project would store the label instead of the id.

User text never reaches the translator. The editor writes it straight into the
DOM, escaped (`escapeHtml(p.name)`, `escapeHtml(c.name || "")`,
`escapeHtml(m.name)`, `escapeHtml(comp.name)`). The only places a `.name` is
translated are `templateLabel()` and `animPresetLabel()`, which first check
that the name belongs to one of the built-in templates or animation presets;
`deliveryPresetLabel()` and `encodeProfileLabel()` do the same for delivery
presets and encoding profiles. A template group the user typed is kept as it
is — only the built-in group names are translated.

What was deliberately left alone:

- Text the user typed — project, media and clip names, captions, project
  notes, template group names, template field values. It is written straight
  into the DOM.
- Technical values: track and clip ids, stored enum values, file names,
  codec, container and colour-space names, pixel formats, ffmpeg arguments.
- Developer and server error details (`[FableCut] …`) stay in English.
- The text that ends up in the picture: a caption or a title is drawn from
  the project, so an exported frame does not depend on the interface
  language.

What is left in English, counted over the whole client payload, is 124
strings, all of them deliberate: 35 codec, container and platform names
("Apple ProRes", "YouTube Shorts"), 32 CSS class selectors and pixel-format
labels ("4:2:0 10-bit"), 16 developer and server error details, 15 pieces of
sample text inside the built-in templates ("Big news is here"), 13 CSS
selectors and style values, 8 `[FableCut] …` log lines, 3 ffmpeg argument
strings, the keyboard key name "Backspace" and the default names
"Untitled Project" and "Main".

The choice is made in **Settings → Appearance → Language** and applies
without a reload. `repaintForLocale()` redraws the surfaces the editor
builds at runtime (the bin, the inspector, the mixer, the colour page, the
project dashboard, the export queue, the track headers) and keeps the caret
where it was. A redraw never schedules a save: `scheduleSave()` returns
early while `localeRepainting` is set, so a language switch never changes
the project.

The i18n scripts are loaded before every other client script, so `T()` is
defined while the other scripts evaluate their own labels. The export runner
copies the whole client directory, so the dictionaries travel with the job
and an exported frame is identical in both languages.

`tests/i18n.test.mjs` (29 tests, no dependency, no browser) checks the
dictionary parity, the English value rule, the runtime behaviour and the way
the client payload uses it. `tests/i18n-browser.test.mjs` (3 tests) drives a
real headless Chrome against a real Mini App instance and skips itself when
the machine has no Chromium-based browser.

## `miniapp/client/library/fonts/*` and `miniapp/node/vendor/fablecut/library/fonts/*`

The five font files whose names contain a space were renamed to their
hyphenated form (`Abril Fatface.woff2` → `Abril-Fatface.woff2`, and so on):
a path inside a Mini App package may not contain a space. The files are
byte-identical; only the names changed.

Each bundled font has its full family-specific OFL text and embedded font
copyright recorded beside it. `library/fonts/LICENSES.md` maps the files,
sources and known version/header differences. Font binaries are unchanged.

## Preview seek ordering

The active-clip branch in `miniapp/client/app.js` seeks before starting
playback and keeps the clip silent while seeking. Audio clips now receive the
same lookahead pre-seek as video clips. This prevents a nonzero audio In point
from briefly playing the beginning of its source file. After seeking/loading,
chained elements restore unity element volume before playback; Web Audio owns
the clip gain. Chainless elements restore the requested clip gain. Regression
tests execute the actual sync function for both paths and all waiting states.

## URL import DNS pinning

HTTPS imports validate resolved addresses and pin that validated result into
the connection lookup rather than allowing a second DNS resolution. The URL
hostname remains the HTTP Host and TLS identity. Each redirect is independently
validated before any request is sent to its target. Deterministic transport tests
exercise rebinding and private-address refusals without contacting real hosts.

## Managed reference paths and bounded MCP sessions

Reference analysis resolves `/media/` URLs through decoded-path and realpath
containment checks; explicit absolute source paths remain supported. MCP retains
at most 256 sessions. Once full, initialization returns 503 until a client deletes
an unused session or the runtime restarts. Existing sessions and active jobs are
not timed out or evicted. Provenance lists `mp4-demux.js` only in the client payload.

Test fixtures live under repository `.fablecut-acceptance/` (or the explicit
`FABLECUT_TEST_ROOT` override), outside the installable package. Verbatim font
license whitespace and the upstream `analyze.js` final blank line remain intact;
these produce existing `git diff --cached --check` diagnostics.

## Export recovery messages

The editor-tab timeout message suggests checking/reopening the Mini App and
retrying with `where: "tab"`; it no longer recommends the unavailable headless
mode.

---

## Branding and identity (MiniMax Cut)

The package was renamed from `fablecut` to `minimax-cut` and now presents the
product name **MiniMax Cut**. The rename is deliberately shallow: the public
tool surface keeps its upstream names, so a later upstream revision can still
be applied without renaming anything.

Changed in the vendored files:

1. **`miniapp/node/vendor/fablecut/mcp-server.js` — the MCP server identity.**
   `serverInfo.name` answers `minimax-cut` instead of `fablecut`. The version
   stays `1.16.0`: that is the upstream revision this server implements.

2. **`miniapp/node/vendor/fablecut/mcp-server.js` — the product name in the
   tool descriptions and in two error messages.** "the FableCut project" reads
   as "the MiniMax Cut project", "FableCut's media library" as "MiniMax Cut's
   media library", "another FableCut data folder" as "another MiniMax Cut data
   folder", and the two messages that name the data folder and the project
   document follow. These strings are the only product references in the file
   that changed.

Deliberately unchanged:

- **Every existing tool name.** The 19 upstream tools and the project-folder
  import tool keep their existing `fablecut_*` names, in the definitions, the dispatch switch, the descriptions,
  the served manual and the tests. Renaming them would break every saved
  prompt, recipe and `mcode-tools` call that uses the upstream names, and would
  make a later upstream update a rewrite rather than a re-vendor. The package
  adds one tool of its own, `minimax_cut_export`, under its own name; it is
  appended to the list by a wrapper and the upstream dispatcher is untouched.
- **The module globals** (`self.FableCutEdit`, `self.FableCutMotion`, …), the
  `FABLECUT_*` environment variables, the `X-FableCut-Client` and
  `X-FableCut-Project` headers, the `Symbol.for("fablecut.localRequest")`
  marker and the `vendor/fablecut/` directory itself. These are the upstream
  internals; they are not user-visible names.
- **The upstream agent manual** (`vendor/fablecut/CLAUDE.md`), which the
  `fablecut_docs` tool serves verbatim. It is upstream's own documentation,
  including its "FableCut" wording.
- **The upstream file banners and log prefixes** (`/* FableCut … */`,
  `console.warn("[FableCut] …")`) in the vendored sources.

In the package's own files:

3. **`miniapp/client/index.html` — the visible brand.** The document title is
   `MiniMax Cut - Video Editor` and the top-bar logo reads `MiniMax Cut`. The
   logo mark and the rest of the layout are untouched.

4. **`miniapp/client/app.js` — the user-visible status text.** The two
   context-menu entries and the proxy entry that say "Needs the FableCut
   server" now say "Needs the MiniMax Cut server".

Not vendored changes, but part of the same rename: the plugin directory, the
plugin id, the package name, the Skill directory and id, the MCP endpoint
(`/mcp/minimax-cut`), the entry's log event names and the READMEs. The
`references/media-generation.md` guidance was removed from the package because
media generation is out of scope; it was archived outside the package at
`.fablecut-acceptance/rename-archive/`.
