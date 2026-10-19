# OpenVideo

[简体中文](README.zh-CN.md)

A local video editing workspace for MiniMax Code, adapted from [OpenChatCut](https://github.com/0xsline/OpenChatCut). Import media, edit a multitrack timeline, add captions, preview AI changes, and export your video. The floating assistant uses the Agent and generation tools you already configured in MiniMax Code. You review timeline edits before applying them.

## Install and use

Requires MiniMax Code **3.1.2 or later**. Copy this entire `openchatcut` directory, including `.minimax-plugin`, into `<dataDir>/plugins/openchatcut/`, then restart the client and ask it to open **OpenVideo**. The ID remains `openchatcut` to preserve existing installations and project data. Do not install a second copy under another name.

On first launch, choose China mainland or global download sources. Media dependencies are downloaded for the current platform and verified against pinned checksums. You do not need to install Node, FFmpeg, or npm yourself. Open **Settings & About** to change download sources later. Cached downloads are reused; missing resources need network access.

1. Click **打开示例** (Open sample). It creates a separate 12-second project with three original title cards, captions, and music; existing projects remain intact.
2. Play it, or upload your own video, image, and audio files.
3. Open **剪辑助手** and request an edit, for example: “Change the final caption to Hello, OpenVideo; leave everything else unchanged and submit a preview.”
4. Preview the proposal, select the changes you want, then apply them.
5. Export MP4, or select **音轨 MP3** for audio only. Other advanced export formats are inherited but are not all verified in this adaptation.

For generated media, configure a suitable tool in MiniMax Code first. Ask for one image and a three-second ending. If import needs confirmation, approve the exact source and file name. If the Agent has already finished its reply, send “Continue the approved import using the same generated file; do not regenerate.” Generation can incur provider charges and watermarks. Importing a file is separate from applying a timeline proposal.

## Tested environment

- MiniMax Code **3.1.3-preview.4675** (Internal Code), macOS Apple Silicon, 2026-10-19. Minimum supported manifest version: MiniMax Code 3.1.2.
- Native host: sample creation/playback, project preservation, assistant history recovery, China/global source switching, MP3 export, and Agent image generation → import → draft frame inspection → preview → apply → MP4 export.
- Export evidence: a 12-second non-silent MP3 and a 15-second 1280×720, 30 fps H.264/AAC MP4; complete decode and inspection of the generated ending frame passed.
- Platform manifests include macOS arm64/x64, Windows x64 and Linux glibc x64/arm64. **Only macOS arm64 was tested.** Windows ARM64 and Linux musl are not supported. Platform selection uses the host process architecture.
- Windows, every advanced effect/export format, all generation providers, and a completely offline first installation are unverified.
- UI is primarily Chinese. Local assistant history is tied to browser storage/origin and can be lost when that storage is cleared or the origin changes. Use the full Agent conversation to check interrupted work; never regenerate paid media merely because a reply timed out.

## Data & access

- Durable project documents, uploaded/generated media, export records, resource caches and native dependencies are stored in the Host-provided `context.dataDir`. No Host conversation database or credential files are read. Browser storage holds assistant display history, session references and view preferences; project documents are stored on disk.
- User-selected imports are copied into the app's media storage. Downloads/exports are saved through the client save dialog; explicit export destinations may write user-selected paths. System font discovery reads installed fonts. Do not delete the whole app data directory to clear a download cache.
- The Node server binds only the Host-assigned loopback address/port. Media work starts FFmpeg, FFprobe, Remotion compositor and a headless Chromium renderer when needed; these are app-owned processes. The Host supplies Node. The installer extracts pinned packages without running npm lifecycle scripts or modifying global PATH.
- Native downloads use `registry.npmjs.org`, `registry.npmmirror.com`, `github.com` / GitHub release redirects (`release-assets.githubusercontent.com`), and `npmmirror.com` binary mirrors. Exact versions and integrity values are in `miniapp/node/native-dependencies.json` and the installer. Optional fonts, sounds and browser AI assets use `filecdn.minimax.chat` (China) or `file.cdn.minimax.io` (global); exact URLs and hashes are in `resource-manifest.json`.
- User-requested URL imports contact the URL's host. Optional upstream browser inference/stock integrations can contact their configured services (including Hugging Face, jsDelivr and stock providers); these are separate from the mirrored bundled resources and are not all verified. Do not assume every online feature works offline or has a China mirror.
- **This app runs Agent turns** using `session.run`. The assistant asks the host Agent to inspect projects, generate/import media using configured tools, and prepare edits. That Agent can read/write files, run shell commands and call MCP tools under the user's Host permissions. Requests may send prompts, representative frames or media to the configured model/provider. No provider keys are bundled or requested in chat. Host approval/question cards remain user decisions.
- The plugin exposes its own `openchatcut` MCP tools. Manual drafts require review before application. Concurrent edits require fresh draft reads; conflicting project changes are not silently overwritten.

## Updating, source and license

Close OpenVideo and exit MiniMax Code before replacing this complete plugin directory. Keep backups outside `plugins/` and preserve its separate data directory. Uninstalling the plugin does not necessarily remove project data.

The runtime is prebuilt: do not install npm dependencies inside this directory. Corresponding modifications, the pinned upstream revision and reconstruction instructions are in [sources/webguhui/openchatcut](../../../sources/webguhui/openchatcut/README.md). Source files live outside the installable package to keep it within the 1,024-file / 64 MiB host limit.

OpenVideo is an adaptation, not an official OpenChatCut release. OpenChatCut code and this derivative are distributed under **AGPL-3.0-or-later**; see [LICENSE](LICENSE). Preserve the upstream copyright notices. Bundled dependencies retain their own licenses, including [third-party notices](miniapp/node/THIRD-PARTY-NOTICES.txt), font licenses and [shadcn notices](SHADCN-LICENSE.md). Remotion has its own licensing terms included in those notices; inclusion here does not replace them.

For reliable saving inside the embedded Mini App, use **Choose…** in the export dialog to select a destination before exporting. The browser-download fallback depends on the Host download behavior.
