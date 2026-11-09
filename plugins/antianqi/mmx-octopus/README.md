# MMX Octopus

*A small octopus girl who lives on your desktop: she shows what your Agent is
doing, and the Agent can tell her what to say.*

English | [简体中文](README.zh-CN.md)

Author: [antianqi](https://github.com/antianqi) · Version: `1.9.0` ·
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
- **She can answer with an agent of her own — if you make one.** The plugin
  never creates an agent for you and never writes one. If you want her to have
  her own, open the panel (Settings → 「想要更鲜明的性格？」) and press
  **「复制她的设定」** ("copy her settings"): it puts her character sheet on
  your clipboard. Paste it into a new agent named `mmx` in the Host's Agent
  settings, and the plugin finds that agent on its own (read-only) and answers
  with it. Skip the step and she answers with the default agent, her character
  sheet travelling with every message.
- **She stays out of the way.** The floating window is frameless, transparent,
  always on top and click-through, so it never blocks the desktop. It is
  220 × 460 and can be dragged anywhere on the screen; the Agent can park it in
  one of four fixed spots (three corners and the centre).
- **Finding her again.** The floating window is click-through, so it never
  swallows your clicks: move the pointer onto her and click-through switches off
  there — click her for a reaction, press and drag to move her. You can also park
  her in one of the four fixed spots from the panel (Settings → 「停靠位置」); that
  only takes effect once she is floating. The floating window is a separate
  window the Host opened — close it the way you close any Host window; the panel
  keeps running, and you can float her out again at any time.

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
5. Optional: give her an agent of her own — copy her settings from the panel
   and paste them into a new agent named `mmx` (see "What it does").

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
  `miniapp/client/`; and the list of agents the Host exposes, which it only
  reads to decide which agent answers for her.
- **What it writes** — four JSON files under `context.dataDir`, the private
  directory the Host creates for this plugin, and **nothing outside it**:
  `context.dataDir/state.json` (her expression, position, bubble and the Agent's
  busy state), `context.dataDir/chat.json` (your chat with her),
  `context.dataDir/diary.json` (her diary) and `context.dataDir/style.json`
  (how she has learned to write). Every write is atomic — a temporary file in
  the same directory, then a rename — so a crash cannot leave a half-written
  file behind.
- **No file outside `context.dataDir`** — since 1.9.0 the runtime writes
  **nothing else at all**: no agent file, nothing under the Host's agent
  directory, nothing in your project. The only files it touches are the four
  JSON files listed above.
  - **No choice in the panel any more.** The 1.8.0 panel's two-way choice
    ("Which agent should she use" — "create a dedicated agent" vs "use an
    existing agent") is gone, and so is the manual `agentprov-cli.mjs` command
    that came with it. There is nothing left to switch.
  - **Your own `mmx` agent, if you make one.** The panel's **「复制她的设定」**
    button only hands you her character sheet as text — it writes nothing. You
    paste it into a new agent named `mmx` in the Host's Agent settings; the
    plugin then finds that agent through the Host's agent list and answers
    with it, reading it only. Creating, editing and deleting that agent stay
    yours; the plugin only ever reads the agent list.
  - **It still reads the Host's agent list — read-only.** The plugin reads the
    agents the Host exposes and, if you have an agent named `mmx`, that is the
    one she answers with. Your agent is never modified and never written to.
    With no `mmx` agent she falls back to the default agent.
  - **Her character sheet travels with the message.** With no dedicated agent
    to hold it, her identity (who she is, what she looks like, her rules) is
    carried in the prompt of every turn — see "How her identity reaches her"
    below.
- **Leftovers from earlier versions** — versions before 1.7.0 wrote an `AGENTS.md`
  into the workspace of the agent that has this Mini App installed, to carry her
  identity there. That is no longer written and no longer needed. If you are
  upgrading from an earlier version the old file may still be there
  (`agents/<agent>/miniapps/<plugin-id>/AGENTS.md`) and you can delete it — the
  runtime never touches it, because a plugin must not write outside its own
  data directory. What 1.8.0 may have left behind is covered under
  "Upgrading from 1.8.0" below.
- **How her identity reaches her** — **on every turn, in the message**. Her
  character sheet (who she is, what she looks like, her rules) is read from
  this package's own `miniapp/node/identity/AGENTS.md` and passed inside each
  prompt, so it is never missing from a turn. Because that travels in the
  conversation, the Host's context compaction may drop it — that is why it is
  sent again every turn. Since 1.9.0 this is the only channel: the sheet is
  no longer written into any agent file, so the per-turn copy is the one and
  only copy.
- **Sessions read** — the package declares `session.read`. It reads the title,
  the running state and the final reply of a turn, to tell whether the Agent is
  thinking or has finished, and to summarise the turn. The board in the panel
  lists the running sessions and refreshes every 30 seconds.
- **Agent turns it runs** — it declares `session.run`, and it runs **one Agent
  turn per message you send her in the chat area**, in her own session. The
  turn runs through the Host Agent, so it carries the capabilities the Host
  grants that agent; it reads the Host's agent list and, if you have an agent
  named `mmx`, that is the one it answers with (your agent is only read,
  never modified); with no `mmx` agent it falls back to the default agent.
  It never runs turns on your own sessions.
- **Agent turns it starts on its own** — besides your messages, the runtime starts
  a few turns by itself, and **each of them uses your model quota**:
  - **Idle talk** — **off by default**; turn it on in the panel: Settings →
    「她没人的时候自己说话」 ("She talks when you are away"). Once on, after 20
    minutes of quiet she may start a conversation of her own; at most 2 turns an
    hour, and at least 45 minutes apart. The same switch turns those turns off
    again.
  - **A diary entry** — after a chat, if today has no entry yet, she writes one.
  - **Style learning** — after a chat, your recent chat lines are sent to the model
    so she can pick up how you write.
  - **A reply to your diary comment** — one more turn for each comment you leave
    on a diary entry.

  Her static lines (a greeting, "you have been quiet", "you ignored me") are **not**
  model turns and cost nothing — turning idle talk off only stops the model ones.
- **Other sessions' titles** — with 「她知道我在忙什么」 ("She knows what I am
  busy with") **on (the default)**, the titles and running state of your **other**
  sessions are put into her prompt, so she can tell what you are busy with. **Turn
  it off in the panel**: Settings → 「她知道我在忙什么」.
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

### Upgrading from 1.8.0

1.9.0 changes what the plugin does with the Host's agents, not just the
version number. **It no longer creates an agent file anywhere**, and with it
the panel's "create a dedicated agent / use an existing agent" choice and the
manual `agentprov-cli.mjs` command are gone as well.

- **If you used 1.8.0** and let it create its own dedicated agent, the Host
  may still have the leftover directory
  `<Host data dir>/agents/mmx-octopus-agent/`. You can **delete it by hand** —
  nothing in it is needed any more.
- **1.9.0 never creates that directory and never touches it.** The only files
  it writes are the four JSON files under `context.dataDir`.
- **Your own `mmx` agent still wins.** If you have an agent named `mmx`, she
  answers with it — read-only; the plugin never modifies it.
- **1.9.0 also hands you her settings.** The panel's **「复制她的设定」** button
  gives you her character sheet as text, so you can put it into an agent named
  `mmx` that you create yourself. The plugin no longer creates that agent for
  you — it only recognises it.

- **If your saved state still points at the old agent, 1.9.0 ignores it.**
  1.8.0 could have stored `mmx-octopus-agent` in the plugin's state file. 1.9.0
  drops that name when it loads the state, so she answers with your own `mmx`
  agent if you have one, and with the Host's default agent otherwise.

## Known limits

- The interface is Chinese only.
- There is no voice: a bubble is text.
- Her body animation only covers the moments the clips cover; between clips the
  `pose` fallback runs.
- She answers in whatever agent the Host resolves for her.
- Without an agent named `mmx` of your own, her character sheet travels in the
  message instead, and the Host's context compaction may drop it — which is
  why it is sent again every turn.

## License

MIT — see [LICENSE](LICENSE).
