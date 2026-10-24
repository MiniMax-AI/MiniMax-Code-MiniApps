# OpenFilm MiniApp

English | [简体中文](README.zh-CN.md)

> **原作者 / Original project: [openfilm/openfilm](https://github.com/openfilm/openfilm).** OpenFilm is an open-source project by its authors.
> **This repository only packages OpenFilm as a MiniApp for MiniMax Code** — it is not the OpenFilm project, is not affiliated with its authors, and contains no OpenFilm source code. **The original author has authorized this packaging and public sharing.** See [NOTICE.md](NOTICE.md).

Run **OpenFilm inside MiniMax Code** — the desktop app's interface (the Studio editor **with the chat column and local agents**), not just the web Studio.

The panel is the OpenFilm desktop page itself. The native bridge the desktop app normally gets from Electron (`window.openfilmNative`) is replaced with an HTTP one, and the desktop app's own main-process handlers (chat, local agents, skills, agent roster) are reused as plain Node modules. So the chat, the agent menu and Settings → Agents behave like the desktop app, because they *are* the desktop app's code.

## What you get

- The full OpenFilm editor: media pool, viewer, inspector, timeline, export.
- The desktop chat column: conversation history, composer, agent menu, local agent turns.
- Settings → Agents with the real roster (Codex, Claude Code, MiniMax Code, BYOK, …).
- Opens your most recent OpenFilm project on launch; switching projects happens inside OpenFilm itself (no extra chrome of our own).
- An agent-callable endpoint (`POST /miniapp/open-desktop`) that launches/activates the installed OpenFilm desktop app.
- A pure web-Studio fallback when the desktop mode is unavailable.

## Requirements

- MiniMax Code **3.1.2 or newer** on macOS (the Host's loopback credential guards the panel's port).
- Node.js 22+ and `npx` (the panel starts OpenFilm with `npx -y openfilm@0.2.5`).
- **Desktop mode only:** a local clone of [openfilm/openfilm](https://github.com/openfilm/openfilm) and one shell build. `@openfilm/desktop` is not published to npm, so the desktop handlers can only come from the repository.

```sh
git clone https://github.com/openfilm/openfilm.git ~/Developer/openfilm
cd ~/Developer/openfilm && pnpm install
pnpm --filter @openfilm/desktop build:shell
```

Without the repository the panel still works — it falls back to the plain web Studio (no chat column).

## Install

Copy this whole plugin directory (including the hidden `.minimax-plugin/` directory) into your MiniMax Code plugins directory, e.g. `~/.minimax/plugins/openfilm/`, restart MiniMax Code, then ask the Agent to "打开 OpenFilm 面板".

The manifest must end up at `~/.minimax/plugins/openfilm/.minimax-plugin/plugin.json`.

## Configuration

Edit `miniapp.config.json` in the plugin directory. Put machine-specific overrides in `miniapp.config.local.json` (gitignored, never committed).

| Key | Default | Meaning |
|---|---|---|
| `openfilmBin` / `openfilmArgs` | `npx` / `["-y","openfilm@0.2.5"]` | Which OpenFilm to start. |
| `flavor` | `release` | Which project list to show: `release` (`~/.openfilm`, `~/Movies/OpenFilm/Projects`) or `dev` (`~/.openfilm-dev`). |
| `desktopMode` | `true` | Desktop interface + chat + local agents. `false` = plain web Studio. |
| `openfilmRepo` | `~/Developer/openfilm` | Where the OpenFilm clone is (also `OPENFILM_REPO` env). Needed for desktop mode. |
| `shellDist` | `<repo>/apps/desktop/shell/dist` | The built desktop page. |
| `desktopApp` | auto-detected | The app the `POST /miniapp/open-desktop` endpoint launches. `[{ "path": "…", "args": ["…"] }]`; auto-detects `/Applications/OpenFilm.app` and dev runtimes in the clone. |
| `studioHome` / `studioPort` | `context.dataDir/openfilm-studio` / `4823` | The panel's own Studio home/port. Change them for isolated tests. |

## Data & access

- Starts `openfilm open` (via `npx`) on `127.0.0.1`, with its own `OPENFILM_HOME` (`openfilm-studio/` under the Host-assigned `context.dataDir`). Your desktop app's own Studio home is never taken over.
- State (Studio home, preferences, caches, logs, BYOK master key) is stored in that `context.dataDir` directory only.
- Reads (never writes) `studio.json` and each project's `.film/id` under the selected OpenFilm home to list projects.
- Reads/writes project data through OpenFilm's own API and desktop handlers (chat records under `.film/`, agent sessions in project folders), exactly as the desktop app does.
- Network: `npx` downloads OpenFilm on first run; agents you invoke use their own accounts/network as usual.

## Security

- **Loopback authentication is done by the Host.** Since MiniMax Code 3.1.2 the Host installs a per-run credential check on every `node:http` server in the MiniApp process: requests without the credential — including direct local connections and WebSocket upgrades — get `401` before reaching this package. This package therefore implements no token logic of its own.
- **No secrets in pages, client JavaScript, logs, or error responses.** The Studio key stays in the Node process and is only attached when proxying `/api/*` to Studio. Nothing is injected into the served HTML.
- **State lives in `context.dataDir`** (`openfilm-studio/` under it), owned by the Host. Nothing durable is written into the plugin directory.
- BYOK keys saved through the panel are sealed with AES-256-GCM using a local `0600` master key in that state directory (the desktop app uses the OS keychain instead; the two do not share key storage).

The panel can drive local agents in project folders — install it only if you trust it, and review what you let an agent do.

## Limitations

- The Electron window itself cannot be embedded in a MiniApp; this runs the desktop *interface* with an HTTP native bridge.
- Native file/folder pickers and screen capture return `null` (no native dialogs in a browser).
- Desktop mode needs the OpenFilm clone + shell build (see Requirements).
- Tested on macOS only. Windows/Linux are untested (some code paths use `open`, `pbcopy`, `ps`).

## Tested environment

- MiniMax Code desktop 3.1.2+ on macOS (Apple Silicon), Node 22, OpenFilm 0.2.5.
- Desktop page renders with chat column and real conversation history; project switching works.
- `chat:load` returns real sessions; agent roster lists 11 agents; Codex ACP probe starts a session; Claude Code correctly reports not-installed.
- Acceptance script: 37 checks covering boot, tree, desktop IPC, roster, SSE, web fallback, missing-shell error, concurrent boot (one Studio only), dispose with open SSE streams, and the preview path (film page proxied, editor origin rewritten, bridge allowed same-origin, media served).

Run the acceptance yourself:

```sh
node test/accept-miniapp.mjs        # SKIP_PROBE=1 to skip the Codex ACP probe
```

It uses temporary homes and ports 4900–4903 and cleans up after itself; it never touches your running panel or writes your projects. Desktop-mode checks need the OpenFilm clone + shell build (see Requirements). After installing, also open the panel once and check Settings → Agents.

## License

MIT — see [LICENSE](LICENSE).

OpenFilm is by the authors of [openfilm/openfilm](https://github.com/openfilm/openfilm); this package only drives it at runtime and contains no OpenFilm source code. See [NOTICE.md](NOTICE.md) for the full attribution.
