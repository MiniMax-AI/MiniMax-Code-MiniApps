---
name: openfilm
description: OpenFilm inside MiniMax Code. The panel is the OpenFilm desktop interface (Studio editor, chat column, local agents), not a separate review board. Use when the user asks to open OpenFilm, switch project, see how long a film is, look at a cut, or work on an OpenFilm project (edit the timeline, render, discuss the cut with an agent). This Skill only explains how to use the panel and its OpenFilm; it does not make editing decisions and does not change OpenFilm's own code.
---

# OpenFilm panel (Mini App)

The official OpenFilm release (`openfilm@0.2.5`) is installed as a Mini App. The panel is OpenFilm itself.

## What the panel is

- **The whole panel is OpenFilm** (no extra chrome of ours). By default it is the **desktop interface**: Studio's editor plus the chat column on the right (conversation history, composer, agent menu, local agent turns).
- On launch it opens your most recent project. Switch projects inside OpenFilm (its own "Open project"); the panel does not duplicate a project list.
- It reads your **release** OpenFilm home (`~/.openfilm`, library `~/Movies/OpenFilm/Projects`).

## How desktop mode works (for troubleshooting)

A MiniApp can only be a page + a Node process, so the Electron window cannot be embedded. The panel serves the desktop app's own page and replaces the Electron native bridge (`window.openfilmNative`) with an HTTP one (`miniapp/client/bridge-web.js`):

- The page calls `POST /ipc/<channel>`; the Node side dispatches to the desktop app's own main-process handlers (`apps/desktop/src/chat-ipc.mjs`, `local-agents-ipc.mjs`, `skills-ipc.mjs`, `agent-roster.mjs`, `agents.mjs`, `agent-usage.mjs`, `app-report.mjs` — all plain Node).
- Agent events go over SSE (`GET /ipc/events`); a fake `webContents.send()` forwards them.
- Studio's `/api/*` and its WebSocket event stream are proxied same-origin, with the key attached on the server side only. The API proxy allows only the route prefixes the editor uses (no `quit`/`update`/`open`/`keys`), and forwards only `accept`, `content-type` and `range`. WebSocket upgrades are limited to the two event streams.
- Film pages and media are proxied under `/p/*`: the embedded editor origin and Studio's `folder` URLs are rewritten to the panel's origin, and the film bridge's same-origin early return is disabled in the proxied copy. Without this the preview stays on "drawing the first frame".
- Settings → Agents and the chat's agent menu use the **roster** (`agent-roster.mjs` + `agents.mjs`), not the `localAgents` list; both are wired.
- **Security**: loopback authentication is done by the Host (MiniMax Code 3.1.2+). No secrets are injected into pages, client JS, logs, or error responses. IPC channels are an explicit allowlist with payload validation; installer, sign-in and `automatic` flows are not offered. `open-desktop` launches only fixed OpenFilm app locations, and OpenFilm is always started as `npx -y openfilm@0.2.5` with a minimal environment. State lives in `context.dataDir` (`openfilm-studio/`); the legacy `studioHome` override is documented in `## Data & access`.
- **Cleanup**: `dispose` closes local agent sessions, ends SSE streams, and quits only the Studio this instance spawned.

Desktop handlers are not published to npm (`@openfilm/desktop`), so desktop mode needs the clone (`openfilmRepo`) and one build:

```sh
cd ~/Developer/openfilm && pnpm --filter @openfilm/desktop build:shell
```

Set `desktopMode: false` in `miniapp.config.json` for the plain web Studio. If desktop mode cannot start, the panel falls back to it automatically. Machine-specific overrides go in `miniapp.config.local.json` (do not commit it).

## Using it

| Task | How |
|---|---|
| Watch/edit a project | The panel opens the most recent one; switch inside OpenFilm ("Open project") |
| Talk to an agent about the cut | The chat column on the right: history at the top, composer at the bottom, agent menu below |
| Film length / clip count | `openfilm look` in the project folder: contact sheet, waveform, LUFS report in `<project>/.film/cache/look/` |
| Render | `openfilm render` in the project folder: `<project>/<name>.mp4` |
| Change OpenFilm's own code | Not from this panel — that is the upstream repository's workflow |

The panel's OpenFilm and the CLI are the same thing: the panel starts `openfilm open`, and `openfilm look` / `render` read the same project folder (`.film/` and `film.html`).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "正在起 OpenFilm…" forever | First boot is slow (Node + browser rendering). Check `/miniapp/health`: `studio.error` and `bootLog` were trimmed, so use `studio.error` and the process log |
| Blank panel | The iframe did not load. Check `/miniapp/health`'s `studio.origin` and open that address yourself |
| No chat column | Desktop mode failed. See `/miniapp/studio`'s `desktop.error` (missing clone, or `build:shell` not run) |
| Preview stuck on "正在绘制第一帧" | The film bridge did not handshake. This was the film-origin/EDITOR mismatch; it is fixed by the `/p/*` proxy and EDITOR rewrite. Hard-refresh the panel |
| Wrong project on launch | The panel only reads the list once, for the most recent project; switch inside OpenFilm. For the dev library, set `"flavor": "dev"` in `miniapp.config.json` |
| An extra OpenFilm process | The panel's own Studio (separate from your desktop app's). Closing the panel (`miniapp stop`) shuts down only what it started; your desktop app's Studio is left alone |

## Rules

- **Do not edit films on the user's behalf from the panel.** It is a UI for people; agents change films the OpenFilm way (editing `film.html` in the project folder), not by clicking around.
- **The panel is not all of OpenFilm.** There is also the CLI (`openfilm`) and the desktop app; the panel just puts it within reach.
- **No MCP endpoints are declared.** The `/miniapp/*` routes are for the panel's own page, not a public tool surface.
