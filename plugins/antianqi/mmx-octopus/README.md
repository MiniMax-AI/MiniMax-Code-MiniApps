# MMX Octopus

*A small octopus girl who lives on your desktop: she shows what your Agent is
doing, and the Agent can tell her what to say.*

English | [简体中文](README.zh-CN.md)

Author: [antianqi](https://github.com/antianqi) · Version: `1.8.0` ·
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
- **What it writes** — four JSON files under `context.dataDir`, the private
  directory the Host creates for this plugin:
  `context.dataDir/state.json` (her expression, position, bubble and the Agent's
  busy state), `context.dataDir/chat.json` (your chat with her),
  `context.dataDir/diary.json` (her diary) and `context.dataDir/style.json`
  (how she has learned to write). Every write is atomic — a temporary file in
  the same directory, then a rename — so a crash cannot leave a half-written
  file behind.
- **At most one new agent file outside `context.dataDir`** — since 1.8.0 the
  runtime **can add one agent of its own** to the Host's agent directory, so
  that her character sheet can live in that agent's system prompt instead of
  only in the message. **By default it adds nothing**: the panel has a
  two-way choice ("Which agent should she use"), and the default is "use an
  existing agent" — the plugin then writes **not a single byte** outside its
  own data directory. Only when you pick "create a dedicated agent" does it
  add that agent. Full disclosure:
  - **Which file** — exactly one: `<Host agent directory>/mmx-octopus-agent/agent.md`.
    The directory and the file are **new**; the Host picks it up without a
    restart.
  - **What is in it** — the same character sheet the plugin would otherwise
    send with every message (who she is, what she looks like, her rules), plus
    the frontmatter the Host expects (`name`, `description`, `displayName`).
  - **What is never touched** — **no existing agent is modified and no other
    file is written**: not your agents' `agent.md`, not the `AGENTS.md` of an
    agent workspace, not your project files. If the name `mmx-octopus-agent` is
    already taken by an agent that is not ours, the plugin **writes nothing and
    does not use it** — she keeps working on an existing agent (that other
    agent's file is never treated as ours).
  - **How it is written** — atomically (temporary file, then a rename), one
    write at a time, and only when the file does not exist yet: an existing
    file is never overwritten, so there is nothing to back up.
  - **How to remove it, or how to pick up a new version** — the file is
    **never rewritten in place**, so after you upgrade the package the old
    character sheet stays in it. Delete
    `<Host agent directory>/mmx-octopus-agent/` and the runtime adds it again on
    the next start, this time with the current version's sheet. If you would
    rather not have this agent at all, pick "use an existing agent" in the
    panel (the default) — the plugin then leaves it alone, and as long as you
    do not switch back to "create a dedicated agent" it will not be recreated.
    Nothing else on your machine is affected.
  - **How the directory is found — it is never guessed** — only from the
    workspace of a session the plugin itself created: the Host sets that
    workspace to the Mini App's own agent directory
    (`<Host agent directory>/<agent>/miniapps/<plugin-id>`), and the plugin
    takes its parent. It does **not** walk up the filesystem looking for a
    folder called `agents` (a project of yours could contain one, and the
    file would land in your project), and it does **not** derive the
    directory from `context.dataDir`. If that one path does not identify the
    directory, the plugin writes **nothing** and falls back to sending her
    character sheet with every message, exactly as before.
  - **One session of its own** — to learn that path the plugin may create one
    session through the Host's Agent API. Such sessions belong to the plugin
    and do **not** show up in your chat list; the plugin reuses that session
    as hers instead of creating another one.
- **Leftovers from earlier versions** — versions before 1.7.0 wrote an `AGENTS.md`
  into the workspace of the agent that has this Mini App installed, to carry her
  identity there. That is no longer written and no longer needed. If you are
  upgrading from an earlier version the old file may still be there
  (`agents/<agent>/miniapps/<plugin-id>/AGENTS.md`) and you can delete it — the
  runtime never touches it, because a plugin must not write outside its own
  data directory.
- **How her identity reaches her** — **twice, on purpose**. Her character
  sheet (who she is, what she looks like, her rules) is read from this
  package's own `miniapp/node/identity/AGENTS.md` and passed inside each
  prompt, so it is never missing from a turn. Because that travels in the
  conversation, the Host's context compaction may drop it — that is why it is
  sent again every turn. Since 1.8.0 — and only once you pick "create a
  dedicated agent" in the panel — the same sheet is also written into the
  system prompt of the agent added above (the file disclosed above), which
  survives compaction; if that file cannot be written, the per-turn copy
  remains and nothing changes for you.
- **Sessions read** — the package declares `session.read`. It reads the title,
  the running state and the final reply of a turn, to tell whether the Agent is
  thinking or has finished, and to summarise the turn. The board in the panel
  lists the running sessions and refreshes every 30 seconds.
- **Agent turns it runs** — it declares `session.run`, and it runs **one Agent
  turn per message you send her in the chat area**, in her own session. The
  turn runs through the Host Agent, so it carries the capabilities the Host
  grants that agent; it reads the Host's agent list to look for an agent
  dedicated to the Mini App — in the default mode ("use an existing agent")
  the one of your own named `mmx` is used as it is; if you pick "create a
  dedicated agent" in the panel, the one it adds itself comes first (see
  above) and yours is only used when that one is not there; with neither, it
  falls back to the default agent. It never runs turns on your own sessions.
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

## Known limits

- The interface is Chinese only.
- There is no voice: a bubble is text.
- Her body animation only covers the moments the clips cover; between clips the
  `pose` fallback runs.
- She answers in whatever agent the Host resolves for her.

## License

MIT — see [LICENSE](LICENSE).
