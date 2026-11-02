# MMX Octopus

*A small octopus girl who lives on your desktop: she shows what your Agent is
doing, and the Agent can tell her what to say.*

English | [简体中文](README.zh-CN.md)

Author: [antianqi](https://github.com/antianqi) · Version: `1.1.0` ·
Plugin ID: `mmx-octopus` · Category: `Productivity`

*The app interface is in Chinese.*

## What it does

- **She mirrors the Agent.** She subscribes to the Host Agent's turn events
  (`turn.started`, `message.committed`, `turn.finished`) and switches her
  expression: `thinking` when a turn starts, `working` while a task runs,
  `celebrate` when a turn finishes with a real answer.
- **She reports the end of a turn.** When a turn finishes she says one short
  line about what came out of it — a summary of the final reply, or a
  fallback line naming the session.
- **She has a chat of her own.** The panel has a chat area. A message to her
  runs **one Agent turn in her own session**, and she answers in her own voice:
  short sentences, split into several bubbles as they arrive.
- **She keeps a diary.** The panel's diary holds her own monologues. It is a
  separate file from the chat history, and she writes it on her own.
- **The Agent can drive her.** This package hosts an MCP server with four
  tools (below), so the Agent can make her speak, change her expression, move
  her, or read her state.
- **She stays out of the way.** The floating window is frameless, transparent,
  always on top and click-through, so it never blocks the desktop. It is
  220 × 460 and can be dragged anywhere on the screen; the Agent can park it in
  one of four fixed spots (three corners and the centre).

## Install

Copy the whole `mmx-octopus` directory, including the hidden `.minimax-plugin`
directory, into your MiniMax Code data directory:

```text
Repository: mmx-octopus/
Install to: <dataDir>/plugins/mmx-octopus/
Manifest:   <dataDir>/plugins/mmx-octopus/.minimax-plugin/plugin.json
```

The default data directory is `~/.minimax`, so the destination is normally
`~/.minimax/plugins/mmx-octopus/`.

Restart MiniMax Code, confirm the plugin is recognised and enabled, and open
**MMX 章鱼娘** from the plugin list. The floating window appears on the
desktop; the panel holds her status, the chat area and the diary.

Nothing else is needed: no API key, no account, no dependency to install.

## Usage

1. Open the plugin from the plugin list. The floating window appears.
2. Drag it to a corner, or let the Agent move it with `mmx_move`.
3. Talk to the Agent as usual and watch her expression follow along.
4. Open the panel and write to her — she answers in her own session.

### The Agent's four tools

The package hosts one Streamable HTTP MCP server (`mmx`), mounted by
`miniapp.json` at `/mcp/mmx`. The Host rewrites its address and authenticates
it like the rest of the port.

| Tool | What it does |
| --- | --- |
| `mmx_say` | Pop a bubble with one or two sentences — the tool asks for no more than 120 characters, and the runtime refuses anything over 300. Good for a "task finished" notice. |
| `mmx_mood` | Switch her expression: `idle`, `thinking`, `working` or `celebrate`. |
| `mmx_move` | Move the floating window to one of four spots: `bottom-right`, `bottom-left`, `top-right` or `center`. |
| `mmx_status` | Read her expression, her current bubble, and whether the Agent is running. |

## How her body works

- **94 short clips with an alpha channel** live in
  `miniapp/client/assets/webm/`, listed by
  `miniapp/client/assets/webm/manifest.json`. They are the main body
  animation, not a fallback.
- A clip is taken from a **pool**, the pool follows a **track**, and two
  `<video>` elements act as **double buffers**: the front one plays while the
  back one loads the next clip, so two clips never leave a gap between them.
- **The fallback is real.** A CSS-transform `pose` track (breathing, nodding, a
  small hop) takes over when the pool has nothing to play, when a clip fails
  to load three times in a row, or when a clip does not arrive in time. It is
  what you see while the clips are still loading.
- **There is no lip-sync.** The clips are still pictures of her, so her mouth
  does not follow the words. That is a deliberate limit, not a bug.

## Tested environment

- MiniMax Code 3.1.7 on Windows 11 (x64).
- The package needs **MiniMax Code 3.1.5 or later**: it declares
  `agentAccess: ["session.read", "session.run"]`, and a client older than
  3.1.5 rejects the whole package rather than installing half of it.
- A desktop client that supports MiniApps and Agent turns.
- The bundled self-check script needs Node 22 or later.

## Data & access

- **What it reads** — this package's own files, read from
  `context.pluginRoot`: `miniapp/node/identity/AGENTS.md` and
  `miniapp/node/identity/STORY.md` (who she is), plus the page assets under
  `miniapp/client/`.
- **And one file of the Host's** — to keep the name in the Host's agent list in sync
  with the name set in the panel, the runtime reads the `agent.md` of the agent that
  runs this Mini App. It locates that file by walking up from the session's workspace
  directory (at most six levels), and as a fallback by looking under the Host's
  `agents` directory for the agent folder that contains a `miniapps/<plugin-id>`
  folder — that fallback is used only when it matches exactly one agent. **This
  relies on the Host's on-disk layout, which is not a documented API.**
- **What it writes** — four JSON files under `context.dataDir`, the private
  directory the Host creates for this plugin: `context.dataDir/state.json` (her
  expression, position, bubble and the Agent's busy state),
  `context.dataDir/chat.json` (your chat with her),
  `context.dataDir/diary.json` (her diary) and `context.dataDir/style.json`
  (how she has learned to write). Every write is atomic — a temporary file in
  the same directory, then a rename — so a crash cannot leave a half-written
  file behind.
- **The two writes outside that folder** —
  - **`AGENTS.md` in the workspace directory of her own Agent session.** She keeps
    her identity there. The Host re-reads that file every turn and puts it into the
    system prompt, which is why her identity survives context compaction. It is
    written atomically (a temporary file in the same directory, then a rename) and
    only when its content differs from the template shipped in this package — so **a
    hand edit to it is lost on the next turn**. It belongs to this Mini App's own
    agent workspace.
  - **The `displayName:` line in the frontmatter of that agent's `agent.md`**, so the
    name in the Host's agent list follows the name set in the panel. Only that one
    line is rewritten — the rest of the file is kept verbatim, and nothing is
    written when the file has no frontmatter. It is written when the name changes;
    the candidate files are tried in order and the runtime stops at the first one it
    can use.
- **Sessions read** — the package declares `session.read`. It reads the title,
  the running state and the final reply of a turn, to tell whether the Agent is
  thinking or has finished, and to summarise the turn. The board in the panel
  lists the running sessions and refreshes every 30 seconds.
- **Agent turns it runs** — it declares `session.run`, and it runs **one Agent
  turn per message you send her in the chat area**, in her own session. The
  turn runs through the Host Agent, so it carries the capabilities the Host
  grants that agent; it reads the Host's agent list once to look for an agent
  dedicated to the Mini App, and falls back to the default agent when there is
  none. It never runs turns on your own sessions.
- **Tools it calls** — only its own four MCP tools, on its own port. It calls no
  connector, no provider and no third-party service.
- **Processes spawned** — none. This package starts no child process and runs no
  external binary.
- **Network** — the loopback address of this Mini App only. The page talks to
  the runtime over the Host's authenticated loopback port, and the runtime
  talks to the Host over the same port. There is no outbound request to any
  other host, and no credential of any kind is read, stored or forwarded.
- **The microphone** — never. This package declares no `deviceAccess` and asks
  for no browser permission.
- **State location** — `context.dataDir`. Treat it as opaque: it may move
  between versions, so do not hard-code it.

## Known limits

- The interface is Chinese only.
- There is no voice: a bubble is text.
- Her body animation only covers the moments the clips cover; between clips the
  `pose` fallback runs.
- She answers in whatever agent the Host resolves for her.

## License

MIT — see [LICENSE](LICENSE).
