# MiniMax Cut for MiniMax Code

[简体中文](README.zh-CN.md)

A local video editor with 19 upstream Agent-facing tools and one project-folder import tool, packaged as a Mini App. It vendors FableCut 1.16.0 rather than requiring a separate installation or Git submodule. Use the timeline directly, or ask the Agent to import media, edit clips, add captions and motion graphics, adjust audio, and export.

MiniMax Cut is a community adaptation of [FableCut](https://github.com/ronak-create/FableCut) packaged for MiniMax Code. It is not an official FableCut release and is not endorsed by the upstream project.

## Install and open

Install this complete directory as a local Plugin in MiniMax Code, then select MiniMax Cut from the Mini App launcher or ask the Agent to open it. Keep the directory's hidden `.minimax-plugin` folder. The Host starts the service and opens its page; there is no fixed localhost URL or separate server to launch.

FFmpeg and FFprobe must be available on the runtime's PATH for media analysis, proxies, audio processing and video encoding. They are not bundled. Install an appropriate build for your operating system and restart the app after changing PATH.

The included `minimax-cut` Skill documents the editing operations and the tool calls that drive them.

## Scope

MiniMax Cut edits media. It imports video, audio and images, lays them on a timeline, and renders the result.

Built-in media generation is out of scope for this package: there is no image, video, speech or music generation step, and the plugin configures no provider keys. New material reaches the timeline the way any other material does - as an imported file, through `fablecut_import_media` or the project-folder import.

## Tool names

The 20 Agent-facing tools keep their upstream names: `fablecut_status`, `fablecut_get_project`, `fablecut_import_media`, `fablecut_export` and the rest. The plugin, the Mini App and the Skill are branded MiniMax Cut, but the tools are the upstream ones under their upstream names, so a later upstream update can be applied without renaming the public tool surface. The MCP server itself is registered as `minimax-cut` and answers on `/mcp/minimax-cut`.

## Using the tools

- Open the Mini App and call `fablecut_status` to identify the active project.
- Read `fablecut_docs` with a relevant `section`, and `fablecut_get_project` with `compact: true`.
- Import a local file with `fablecut_import_media`, then reference the returned media ID in timeline clips.
- Use `fablecut_patch_project` for targeted edits. Supply `baseRevision` when the edits depend on a previously read revision; resolve conflicts by reading the current document again.
- Use `fablecut_versions` for saved versions and `fablecut_projects` for project management.
- `fablecut_import_project {folder}` copies an existing project's media and replaces the active timeline after saving its previous version. Originals remain unchanged. Missing or escaping media paths refuse the import; nested source media is supported. The UI's JSON-only import does not bring external media with it.
- Open the editor before requesting composed frames, scopes, tracking or export. For long exports, use `wait: false` and query the returned job ID.

The service is shared across conversations. The upstream project dashboard has one active project shared by all pages; opening another project changes that selection for everyone using this plugin. Coordinate project switches and re-check the active project before editing.

## Rendering limits

This port uses the original editor-tab compositor. External headless Chrome cannot access the Host-authenticated Mini App page and is not a fallback. Keep the editor open during rendering. Browser resource limits can affect long or high-resolution exports; a successful short export does not establish sustained long-form rendering reliability. This package does not include a separate general-purpose FFmpeg timeline renderer.

The editor preserves FableCut's timeline and effect model. The Skill describes tool usage rather than prescribing a production workflow. Whatever produced a file, the boundary is an imported media file, and the timeline format does not change.

## Tested environment

- Target: MiniMax Code 3.1.2 or later (managed Mini App runtime and detachable window).
- Development environment: Windows 11 x64, Node.js 26.10.0, FFmpeg/FFprobe 8.1.1.
- Historical, recorded under the former `fablecut` plugin identity: on 2026-10-24 a local Host publish/inspect/open passed. Browser checks covered synthetic video import, linked video/audio placement, title creation, playback controls, reload persistence and a 4-second 1280x720/30 fps export. The editor reported export checks passed; console and failed-request diagnostics were empty. That is a short smoke test, not long-form rendering certification.
- Historical, recorded under the former `fablecut` plugin identity: on 2026-10-25 a fresh conversation received the Host-injected MCP tools and successfully called `fablecut_status`, `fablecut_get_project` and `fablecut_docs`. Live write calls and macOS remain unverified. Local integration tests exercised the managed HTTP protocol, discovery of all 20 tools and representative editing/import calls.
- The MiniMax Cut identity itself has not been installed in a Host or exercised in a browser. The rename changed the plugin id, the package path, the Skill id, the MCP server identity and endpoint, and the visible branding; the editing code paths are the ones the checks above cover.
- The plugin's own suite passes: 70 tests, including assertions on the renamed manifest, the Skill and the page title. Package validation reports no errors and no warnings for this package.
- The repository check retains its two pre-existing Windows symlink-fixture EPERM failures (the other 67 root tests pass); other packages also retain their existing warnings.

Run plugin integration tests with `npm test --prefix plugins/klarkxy/minimax-cut` from the repository root. Run repository package validation and checks with `npm run check`. No dependency installation or build is required to install the finished directory.

## Data & access

- **State:** projects, media copies, versions, analysis caches, proxies, library data and exports are stored in the Host-provided private `context.dataDir`. Its physical location is opaque. Plugin source files are not a workspace for user projects.
- **Files read:** packaged editor assets; imported media selected by the user or passed to an editing tool; project data and generated analysis artifacts. Importing a local media file copies it into managed storage and does not edit the original.
- **Files written:** project documents, project/version records, imported media, analysis/proxy artifacts and export files under the private data directory. Project operations and file deletion are explicit tool or UI actions.
- **Network:** the editor and MCP endpoint use the single Host-assigned loopback listener. HTTPS media imports contact the URL's host and permitted redirect destinations; there is no fixed third-party host required for local editing. Upstream's optional Google font loader contacts `fonts.googleapis.com` and `fonts.gstatic.com`; optional background removal loads MediaPipe assets from `cdn.jsdelivr.net`. These inherited features have not been exercised in this port.
- **Processes:** the Node runtime invokes local `ffmpeg` and `ffprobe` for media operations. It does not launch a second editor server or an external headless browser. Those programs must be installed separately.
- **Agent turns:** the Mini App does not initiate Agent turns and declares no `agentAccess`. Its MCP tools are called by the user's existing conversation.
- **Host access:** no Host configuration, credentials, private logs or session databases are read. The Host owns transport authentication.

## Upstream and maintenance

Source: [ronak-create/FableCut](https://github.com/ronak-create/FableCut), version 1.16.0, commit `fd2af081d73ec94464b88df8c21f640adcc78985`. Original copyright and MIT terms are retained in [LICENSE](LICENSE). Third-party asset licenses remain beside the included assets.

The source is vendored directly in this package. See `upstream.json` for provenance and `PATCHES.md` for local adaptations, including the branding changes made for this package. Updates are deliberate: compare the selected upstream revision, reapply necessary Host adaptations, run integration and repository checks, then exercise the installed editor and export path. Installing or updating the plugin does not fetch upstream code or install system software.
