# Cutline for MiniMax Code

[简体中文](README.zh-CN.md)

A local video editor with 19 upstream Agent-facing tools, a project-folder import tool and a standalone export tool, packaged as a Mini App. It vendors FableCut 1.16.0 rather than requiring a separate installation or Git submodule. Use the timeline directly, or ask the Agent to import media, edit clips, add captions and motion graphics, adjust audio, and export.

Cutline is a community adaptation of [FableCut](https://github.com/ronak-create/FableCut) packaged for MiniMax Code. It is not an official FableCut release and is not endorsed by the upstream project.

## Install and open

Install this complete directory as a local Plugin in MiniMax Code, then select Cutline from the Mini App launcher or ask the Agent to open it. Keep the directory's hidden `.minimax-plugin` folder. The Host starts the service and opens its page; there is no fixed localhost URL or separate server to launch.

FFmpeg and FFprobe must be available on the runtime's PATH for media analysis, proxies, audio processing and video encoding. They are not bundled. Install an appropriate build for your operating system and restart the app after changing PATH.

The included `cutline` Skill documents the editing operations and the tool calls that drive them.

## Scope

Cutline edits media. It imports video, audio and images, lays them on a timeline, and renders the result.

Built-in media generation is out of scope for this package: there is no image, video, speech or music generation step, and the plugin configures no provider keys. New material reaches the timeline the way any other material does - as an imported file, through `fablecut_import_media` or the project-folder import.

## Interface language

The editor's interface is available in English and in Simplified Chinese. Pick one in **Settings → Appearance → Language**. The change applies straight away - there is no reload, and it never changes the project - and the choice is remembered in that browser only, under the `fablecut-locale` key of the browser's own `localStorage`. Nothing is sent anywhere: the two dictionaries are local files in the editor's payload (`miniapp/client/i18n-en.js` and `miniapp/client/i18n-zh-CN.js`), and the editor makes no network request for them.

On the first run the editor follows the browser: a Chinese browser (`zh*`) starts in Chinese, every other browser starts in English. A choice made once wins over that detection from then on.

What is translated: the shell, the menus, the tooltips, the accessible names and the placeholders, the Settings and Help dialogs, the project dashboard, the media bin and its filters, the timeline and its context menus, the Inspector, the mixer, the Colour page, the export dialog with its progress, the confirmations and the toasts.

What is **not** translated, on purpose:

- **Text you typed.** Project, media and clip names, captions, the notes on a project, the group you gave a saved template and the values you put into a template field stay byte-for-byte what you wrote, in every language - even when they read like one of ours ("Settings", "Export", "Color"). The editor never hands such text to the translator.
- **Technical values.** Track and clip ids, stored enum values, file names, codec, container and colour-space names, pixel formats and ffmpeg arguments keep their spelling. Where an enum value is shown, only the label next to it is translated; the stored value never changes, so a project written in one language opens in the other.
- **Developer and server error details.** The `[FableCut] …` lines and the raw server messages stay in English so that a bug report can be read as it was written.
- **The text that ends up in the picture.** A caption, a title or a template's own content is drawn from the project, never from the interface language, so an exported frame is identical in both languages.

## Tool names

The 21 Agent-facing tools include 19 upstream tools and the project-folder import tool under their existing `fablecut_*` names - `fablecut_status`, `fablecut_get_project`, `fablecut_import_media`, `fablecut_export` and the rest - plus `cutline_export`, this package's own standalone export tool. The plugin, the Mini App and the Skill are branded Cutline, but the upstream tools keep their upstream names, so a later upstream update can be applied without renaming the public tool surface. The MCP server itself is registered as `cutline` and answers on `/mcp/cutline`.

## Using the tools

- Open the Mini App and call `fablecut_status` to identify the active project.
- Read `fablecut_docs` with a relevant `section`, and `fablecut_get_project` with `compact: true`.
- Import a local file with `fablecut_import_media`, then reference the returned media ID in timeline clips.
- Use `fablecut_patch_project` for targeted edits. Supply `baseRevision` when the edits depend on a previously read revision; resolve conflicts by reading the current document again.
- Whole-document replacement with `fablecut_set_project` requires the `baseRevision` returned by `fablecut_get_project`. Pass the document and that unchanged base revision; the server advances the stored revision after a successful write. Do not increment the document's revision yourself.
- Use `fablecut_versions` for saved versions and `fablecut_projects` for project management.
- `fablecut_import_project {folder}` copies an existing project's media and replaces the active timeline after saving its previous version. Originals remain unchanged. Missing, escaping or unsupported non-media files refuse the import; nested source media is supported. The UI's JSON-only import does not bring external media with it.
- Open the editor before requesting composed frames, scopes, tracking or export. For long exports, use `wait: false` and query the returned job ID.

### Local files and absolute paths

The MCP tools run with the permissions of the person who started the app, and they are not confined to the plugin's own folders.

- A tool that takes a `path` - `fablecut_import_media`, `fablecut_analyze_reference`, `fablecut_frame` - resolves an absolute local path and reads that file directly. **Any file the user can read is readable this way**; there is no directory allowlist and no sandbox around it. Only pass paths the user asked for.
- `fablecut_import_media` copies the file into the private data directory and leaves the original untouched; the project refers to the copy.
- `fablecut_import_project {folder}` reads a project folder anywhere on disk that the user can read, copies the media and library files it names into the private data directory, and saves the imported document as the open project. The originals are not modified.

The service is shared across conversations. The upstream project dashboard has one active project shared by all pages; opening another project changes that selection for everyone using this plugin. Coordinate project switches and re-check the active project before editing.

## Two ways to export

`fablecut_export` renders in the editor tab that is open in the Mini App panel. The user watches the
progress bar, the export uses the editor's job slot, and several files can come out of one render.
It needs the Mini App to be open.

`cutline_export` is this package's own tool. It does not render. It **prepares** a job and
hands the Agent an exact path:

- The Mini App copies the saved project, every media and library file that project names, the
  editor's client payload, the FableCut runtime and a standalone runner into a new job folder under
  its private data directory. The copies are byte-for-byte; nothing is hard-linked, and a source
  file that is missing or that points outside the project folder refuses the job before it becomes
  runnable.
- The Agent starts that runner itself, in the foreground of one of its own background shell tasks:
  `node "<job folder>/runner/runner.mjs" --job "<job folder>"`.
- The runner serves its own copy of the editor on its own ephemeral loopback port, guarded by a
  secret it generates for that run, and drives a headless Chrome or Edge through it. The render is
  the editor's own Fast export - the same compositor, audio mix and ffmpeg encoding - so the file
  matches what the editor would produce.
- `cutline_export {action:"status"}` reports the progress, the attempt id, the runner's pid and
  its last heartbeat; `{action:"cancel"}` asks a running job to stop.

The runner is a plain Node process that the Agent owns. It is not a child of the Mini App, so
stopping the Mini App does not stop a render that has already been accepted; and it is not a
detached daemon. Cancellation, timeouts and client exit remain subject to the Agent task manager;
continued rendering after client exit is not supported or tested. One job runs at a time: a second attempt on the same
job is refused without touching the running one's state or its output. Re-rendering means preparing
a new job.

The finished file is written as provisional and is only marked finished after `ffprobe` has read it
and `ffmpeg` has decoded it all the way through. A file that was made but failed one of those checks
is kept in the job folder's `provisional` directory instead of being deleted: it is what the renderer
actually produced, and it can still be looked at. Nothing removes it.

The job folder is where the file lands, and it is not cleaned up for you. It holds the project
snapshot, copies of the media and library files, the renderer and the video, so it costs disk space
of its own. The status gives the finished file's absolute path; copy the file out where you want it
and delete the job folder when you are done with it.

The runner needs `ffmpeg`, `ffprobe` and a Chrome or Edge install on the machine. It never
downloads a browser and never installs software. Because it has no network access, a font that is
not on the machine and a clip that uses background removal are refused with a clear message rather
than rendered differently from what the editor would produce. Unknown delivery preset IDs are also
refused during preparation rather than silently falling back to Custom. This release renders one
file per job: batch outputs are a `fablecut_export` feature.

## Rendering limits

`fablecut_export` uses the original editor-tab compositor. External headless Chrome cannot access the Host-authenticated Mini App page and is not a fallback for it. Keep the editor open during those renders. Browser resource limits can affect long or high-resolution exports; a successful short export does not establish sustained long-form rendering reliability. This package does not include a separate general-purpose FFmpeg timeline renderer.

The editor preserves FableCut's timeline and effect model. The Skill describes tool usage rather than prescribing a production workflow. Whatever produced a file, the boundary is an imported media file, and the timeline format does not change.

## Tested environment

- Target: MiniMax Code 3.1.2 or later (managed Mini App runtime and detachable window).
- Development environment: Windows 11 x64, Node.js 26.10.0, FFmpeg/FFprobe 8.1.1, Google Chrome (found automatically).
- The standalone export path was exercised on 2026-10-25 outside the Host: a synthetic 3-second 640x360 project with a video clip, a sine tone and an Anton-font title was prepared through `cutline_export`, rendered by the standalone runner in 3.6 seconds, and the result was read back with `ffprobe` (H.264 640x360 at 30 fps plus AAC, 3.000 s) and decoded end to end with `ffmpeg`. A cancelled job was stopped through the cancel request and left no browser or ffmpeg process behind. That is a short synthetic smoke test, not long-form rendering certification, and it was not run inside an installed Mini App.
- Historical, recorded under the former `fablecut` plugin identity: on 2026-10-24 a local Host publish/inspect/open passed. Browser checks covered synthetic video import, linked video/audio placement, title creation, playback controls, reload persistence and a 4-second 1280x720/30 fps export. The editor reported export checks passed; console and failed-request diagnostics were empty. That is a short smoke test, not long-form rendering certification.
- Historical, recorded under the former `fablecut` plugin identity: on 2026-10-25 a fresh conversation received the Host-injected MCP tools and successfully called `fablecut_status`, `fablecut_get_project` and `fablecut_docs`. Live write calls and macOS remain unverified. Local integration tests exercised the managed HTTP protocol, discovery of all 21 tools and representative editing/import calls.
- On 2026-10-25, Cutline was installed and opened in the Host. Its page and Settings interaction worked with no console warnings/errors or failed requests at that check. Live MCP import and patch calls built a synthetic acceptance project. The installed `cutline_export` prepared a 180-second job; the root-chat Agent launched its runner, then stopped the Mini App after observing 7.3% progress. After the Host confirmed service exit, the same runner advanced to 49.3% and completed about 42 seconds later. The output was 1280x720, 30 fps, 5400 frames, H.264/AAC, 180.000 seconds and 56,238,485 bytes; ffprobe and full decoding passed. Reopening the Mini App and querying the installed tool returned the completed job. No task-specific Node, Chrome/Edge or FFmpeg processes remained. The render logged expected refusals of editor-only proxy requests; this does not establish support for every effect or long-form workload.
- The plugin suite has 188 tests; the final serial run on 2026-10-26 passed 187, with one symlink-boundary test skipped because Windows denied symlink creation (EPERM). Six monitor/menu tests additionally cover snap and sequence translations, preserved values and user names, canvas-settings popover behavior and non-overlapping controls at five viewport widths. Eleven icon-control tests cover accessible names, keyboard import, translated tooltips, click behavior and responsive hit targets. Six layout tests cover both languages at 1280x900, 923x899 and 720x800, sidebar restoration, meter separation and monitor zoom. Installed-Host checks covered the empty workspace and synthetic timeline; a standalone export smoke check still produced a 3-second 1280x720 H.264/AAC file after the layout changes. The localization subset has 37 unit tests and 9 browser tests. Package validation reports no errors or warnings. Intermittent `ECONNRESET` failures have also occurred in export transport tests, including a serial run; isolated reruns passed. The underlying transport flake remains unresolved.
- The localization work added 37 dependency-free tests (`tests/i18n.test.mjs`) and 9 browser tests (`tests/i18n-browser.test.mjs`). The browser tests drive a real headless Chrome against a real Mini App instance and skip themselves when the machine has no Chromium-based browser. They were exercised on 2026-10-25 outside the Host: the page loads with the browser's own language detected, switching to English and back to Chinese takes effect in about 12 ms without a reload, the `html lang` attribute and the document title follow the choice, the choice survives a reload, and a project name that reads like one of ours ("Settings") is left untouched by the switch. A third browser test adds a title card, checks that the transition and text-animation selects keep their raw ids ("fade", "none", "word-pop") while only their labels follow the language, and reads the saved project back to confirm it stores "word-pop" rather than the label. That is a short smoke test of the language switch on one machine, not a certification of the installed Mini App.
- The repository check retains its two pre-existing Windows symlink-fixture EPERM failures (the other 67 root tests pass); other packages also retain their existing warnings.

Run plugin integration tests with `npm test --prefix plugins/klarkxy/cutline` from the repository root. Run repository package validation and checks with `npm run check`. No dependency installation or build is required to install the finished directory.

## Data & access

- **State:** projects, media copies, versions, analysis caches, proxies, library data and exports are stored in the Host-provided private `context.dataDir`. Its physical location is opaque. Plugin source files are not a workspace for user projects. Export jobs live in `export-jobs/<job id>/` inside the same directory; each holds the project snapshot, the copies of the media and library files it names, the editor and renderer copies, the job state and the finished file. The folder is not deleted automatically: it costs disk space of its own, and the user removes it once the file has been copied out. A file that failed its checks stays in the job's `provisional` directory.
- **Files read:** packaged editor assets; imported media selected by the user or passed to an editing tool; project data and generated analysis artifacts. A tool that takes a local path reads that absolute path with the user's own permissions - **any file the user can read, not only files inside the data directory** - and an import copies what it read into the private data directory. Importing a local media file copies it into managed storage and does not edit the original. Preparing an export job reads the saved project and the media and library files it names; nothing outside the project's own media and library folders is read, and a source that points elsewhere refuses the job.
- **Files written:** project documents, project/version records, imported media, analysis/proxy artifacts and export files under the private data directory. Project operations and file deletion are explicit tool or UI actions. Managed media accepts only the supported video, audio, image and SVG extensions; fonts are confined to the library, and HTML and other non-media documents are refused at upload, project-import and standalone-export preparation boundaries. All Node and standalone-runner responses use `nosniff`, and browser-executable document types are served with a sandbox CSP as defense in depth for older files. A prepared export job writes only inside its own job folder.
- **Network:** the editor and MCP endpoint use the single Host-assigned loopback listener. HTTPS media imports contact the URL's host and permitted redirect destinations; there is no fixed third-party host required for local editing. Upstream's optional Google font loader contacts `fonts.googleapis.com` and `fonts.gstatic.com`; optional background removal loads MediaPipe assets from `cdn.jsdelivr.net`. These inherited features have not been exercised in this port. The standalone export runner binds one ephemeral loopback port on 127.0.0.1 for the duration of a render; it contacts no other host and the page it serves may not reach the network.
- **Processes:** the Node runtime invokes local `ffmpeg` and `ffprobe` for media operations. It does not launch a second editor server or an external headless browser. Those programs must be installed separately. The standalone export runner is a separate Node process that the Agent starts in its own background task; it launches a headless Chrome or Edge on the machine, and it starts and stops `ffmpeg` and `ffprobe` itself.
- **Agent turns:** the Mini App does not initiate Agent turns and declares no `agentAccess`. Its MCP tools are called by the user's existing conversation.
- **Host access:** no Host configuration, credentials, private logs or session databases are read. The Host owns transport authentication. The standalone runner holds no Host credential: it guards its own port with a secret it generates for that run, which never appears in a URL, an argument or a log line.

## Upstream and maintenance

Source: [ronak-create/FableCut](https://github.com/ronak-create/FableCut), version 1.16.0, commit `fd2af081d73ec94464b88df8c21f640adcc78985`. Original copyright and MIT terms are retained in [LICENSE](LICENSE). Third-party asset licenses remain beside the included assets.

The source is vendored directly in this package. See `upstream.json` for provenance and `PATCHES.md` for local adaptations, including the branding changes made for this package. Updates are deliberate: compare the selected upstream revision, reapply necessary Host adaptations, run integration and repository checks, then exercise the installed editor and export path. Installing or updating the plugin does not fetch upstream code or install system software.
