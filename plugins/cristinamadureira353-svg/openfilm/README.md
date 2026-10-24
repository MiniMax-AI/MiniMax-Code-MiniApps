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
| `openfilmBin` / `openfilmArgs` | `npx -y openfilm@0.2.5` (pinned) | Which OpenFilm to start (first run downloads it from npm). |
| `flavor` | `release` | Which project list to show: `release` (`~/.openfilm`, `~/Movies/OpenFilm/Projects`) or `dev` (`~/.openfilm-dev`). |
| `desktopMode` | `true` | Desktop interface + chat + local agents. `false` = plain web Studio. |
| `openfilmRepo` | `~/Developer/openfilm` | Where the OpenFilm clone is (also `OPENFILM_REPO` env). Needed for desktop mode. |
| `shellDist` | `<repo>/apps/desktop/shell/dist` | The built desktop page. |
| `desktopApp` | auto-detected (fixed) | The app the `POST /miniapp/open-desktop` endpoint launches: repo dev runtimes first, then `/Applications/OpenFilm.app`. Not configurable. |
| `studioHome` / `studioPort` | `context.dataDir/openfilm-studio` / `4823` | The panel's own Studio home/port. `studioHome` may be overridden for an existing state directory (documented exception); `studioPort` for isolated tests. |

## Data & access

**Processes started by this package**

- `npx -y openfilm@0.2.5 open` — starts the Studio (`openfilmBin`/`openfilmArgs` are pinned to this; the first run downloads OpenFilm from `registry.npmjs.org`).
- `open -n <app>` / `open -a <app>` (macOS) — only for the fixed app locations in `desktopCandidates()` (dev runtimes under `<openfilmRepo>/apps/desktop/.dev/runtime`, then `/Applications/OpenFilm.app` and `~/Applications/OpenFilm.app`; the dev candidates depend on `openfilmRepo` / `OPENFILM_REPO`).
- `open -R <path>` — reveals a project path in Finder (restricted to project folders).
- `ps -ax -o command=` — to check whether that app is already running.
- `pbcopy` — only for the chat's "copy diagnostic report".

**Network**

- `registry.npmjs.org` (first `npx` run).
- Loopback only for the panel itself and Studio (`127.0.0.1`/`localhost`). Agents you invoke use their own accounts/network as usual.

**Files read**

- `~/.openfilm/studio.json` (or `~/.openfilm-dev/studio.json` when `flavor` is `dev`): which projects exist (read-only).
- Each listed project's `.film/id` (read-only), to address the project.
- `<openfilmRepo>/apps/desktop/src/*.mjs` — the desktop handlers, imported and run (the documented desktop-mode requirement).
- `<openfilmRepo>/apps/desktop/.dev/runtime/*` — to find a dev app to launch.
- `<openfilmRepo>/apps/desktop/shell/dist/*` — the desktop page served.
- Agents' own config/session records, via the desktop handlers in `<openfilmRepo>/apps/desktop/src`:
  - **MCP configuration** (`agent-skills.mjs` `ownMcpServers`): `~/.claude.json` (a file in the home directory; only its `mcpServers` entries), the project's `.mcp.json`, `~/.codex/config.toml` (only `[mcp_servers.*]` `command`/`url`), `~/.config/opencode/opencode.json(c)`, `~/.qwen/settings.json`, `~/.copilot/mcp-config.json`.
  - **Skill directories** (`ownSkills`): `~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills`, `~/.copilot/skills`, plus project-level `.claude/skills`, `.agents/skills`, `.codex/skills`, `.github/skills` and `.opencode/skill(s)`.
  - **Session records** (`agent-records.mjs`): `~/.claude/projects/**/<session>.jsonl` (including `subagents/`), `~/.codex/sessions/**`, `~/.codex/archived_sessions`, `~/.kimi-code/session_index.jsonl` and its session folders, `~/.copilot/session-state/<id>/events.jsonl`. `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `COPILOT_HOME` are honored when set.
  - `environment.mjs` `loginShellVariables` runs the user's login shell (`$SHELL -l -i -c 'env -0'`) to collect the environment variables passed to local agents.

**What is actually read from those files:** only MCP server names and their `command`/`url` from the config files, and only session transcripts from the record folders. No credentials are read: not `~/.claude/.credentials.json`, not `~/.codex/auth.json`, not the OS keychain, and not MiniMax Code's own login data. The exact set of paths follows the upstream version in `openfilmRepo`, so it depends on the user's checkout.


**Files written**

- Only under `context.dataDir` (`openfilm-studio/`): Studio home, preferences, caches, logs, the BYOK master key and sealed BYOK keys.
- Project data is written through OpenFilm's own API/handlers (chat records under `.film/`, agent sessions in project folders), exactly as the desktop app does — not by the panel itself.
- A legacy `studioHome` override (`miniapp.config.local.json`) may point the Studio home elsewhere (this machine's original `~/.minimax/openfilm-studio`). It is an explicit, documented exception for an existing state directory, not a general writable path.


## Security

- **Loopback authentication is done by the Host** (MiniMax Code 3.1.2+): every `node:http` server in the MiniApp process requires the per-run credential, including direct local connections and WebSocket upgrades. This package implements no token logic of its own.
- **No secrets in pages, client JavaScript, logs, or error responses.** `/miniapp/studio` no longer returns the Studio key, and no iframe URL contains `/open?key=`; both web and desktop editors are served same-origin with the key attached only on the server side.
- **Bounded proxies.** `/api/*` allows only the route prefixes the editor uses (`/api/health`, `/api/projects`, `/api/files`, `/api/doctor`, `/api/library`, `/api/saved`, `/api/skills`, `/api/prefs`, `/api/examples`, `/api/fonts`, `/api/page-links`, `/api/exports`, `/api/look`) and forwards only `accept`, `content-type`, `range`. `/p/*` is read-only GET/HEAD. WebSocket upgrades are limited to `/api/events` and `/api/projects/<id>/events`, with only the handshake headers plus the Studio key.
- **IPC allowlist with payload validation** (`IPC_RULES` in `server.mjs`): installer, sign-in and `automatic` flows are not registered at all (they return 403), and every other channel has a parameter check. `desktop:reveal` is limited to project folders. As in the desktop app, the page can also answer a local agent's permission prompts on your behalf (`desktop:local-agents:permission`) — that is how the chat's permission cards work, and it is your own UI.
- **Fixed process launches.** `open-desktop` only opens the auto-detected OpenFilm app bundles; `openfilmBin`/`openfilmArgs` are pinned to `npx -y openfilm@0.2.5` with a minimal environment (`PATH`, `HOME`, `LANG`, `TMPDIR`, `OPENFILM_*`).
- **State lives in `context.dataDir`** (`openfilm-studio/`). Nothing durable is written into the plugin directory.
- BYOK keys saved through the panel are sealed with AES-256-GCM using a local `0600` master key in that state directory (the desktop app uses the OS keychain instead; the two do not share key storage). This is obfuscation for at-rest files, not keychain-grade protection — the master key sits in the same directory, and a legacy `raw:` (plaintext) value is also accepted for compatibility.


## Limitations

- The Electron window itself cannot be embedded in a MiniApp; this runs the desktop *interface* with an HTTP native bridge.
- Agent **installer, sign-in and `automatic` flows are not offered in the panel** (use the desktop app for those).
- Native file/folder pickers and screen capture return `null` (no native dialogs in a browser).
- Desktop mode needs the OpenFilm clone + shell build (see Requirements).
- The API proxy intentionally excludes admin routes (`/api/quit`, `/api/update`, `/api/open`, `/api/keys`); actions that need them are unavailable in the panel.
- Tested on macOS only. Windows/Linux are untested (some code paths use `open`, `pbcopy`, `ps`).


## Tested environment

- MiniMax Code desktop 3.1.2+ on macOS (Apple Silicon), Node 22, OpenFilm 0.2.5.
- Desktop page renders with chat column and real conversation history; project switching works.
- `chat:load` returns real sessions; agent roster lists 11 agents; Codex ACP probe starts a session; Claude Code correctly reports not-installed.
- Acceptance script: 44 checks covering boot, tree, desktop IPC, roster, SSE, web fallback, missing-shell error, concurrent boot (one Studio only), dispose with open SSE streams, the review hardening assertions (no key to the page, route/IPC allowlists, payload validation, reveal restriction), and the preview path (film page proxied, editor origin rewritten, bridge allowed same-origin, media served).

Run the acceptance yourself:

```sh
node test/accept-miniapp.mjs        # SKIP_PROBE=1 to skip the Codex ACP probe
```

It uses temporary homes and ports 4900–4903 and cleans up after itself; it never touches your running panel or writes your projects. Desktop-mode checks need the OpenFilm clone + shell build (see Requirements). After installing, also open the panel once and check Settings → Agents.

## License

MIT — see [LICENSE](LICENSE).

OpenFilm is by the authors of [openfilm/openfilm](https://github.com/openfilm/openfilm); this package only drives it at runtime and contains no OpenFilm source code. See [NOTICE.md](NOTICE.md) for the full attribution.
