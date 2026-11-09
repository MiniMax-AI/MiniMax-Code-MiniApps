# MiniMax Bot Team

English | [简体中文](README.zh-CN.md)

Today's bot is one person wearing several masks, taking turns with you. MiniMax
Bot Team gives you a team instead: members with different skills and different
temperaments, each guarding one field, and they can sit down together and argue about the
same question from different angles.

Author: [antianqi](https://github.com/antianqi) - Version: `1.0.0`

## What it does

- **A chief Bot and a team** - `create_bot` builds a Bot, and `main: true` marks the
  one that takes the work and hands it over. A Bot answers in its own chat, so several of
  them can work at the same time without stepping on each other.
- **Every Bot carries its own files** - each Bot owns a folder of `.md` files, and the
  runtime puts them into that Bot's prompt on every turn: `AGENTS.md` (the role, the way
  of working, the delivery standard), `IDENTITY.md` (the name, the duty, the tone) and
  `SOUL.md` (the character, the principles, what it refuses to do). The files decide how
  good the Bot is - a roster without them is a row in a list.
- **Three zones, three owners** - the Bot writes its own files; the common zone
  (`ENV.md`, `USER.md`) and the shared cards (`shared-*.md`) belong to the user, who
  edits them in the settings. A card can name the Bots that read it with
  `<!-- audience: ... -->`, so a fact reaches the people it concerns and nobody else.
- **A group chat with one rule** - inside a group a member may not work with its own
  tools: a read, a script or an image call is cut off and the turn ends with nothing to
  show. The hand-over tools do work there, and the chief Bot @-mentioning someone is the
  hand-over itself: that message lands in the mentioned Bot's private chat as its task.
- **Schedules and background helpers** - a daily or one-off task runs as an Agent turn on
  the Bot's own schedule, and a helper can take a long job in the background and report
  back.
- **A Skill that says what to write** - `skills/bot-team-setup/SKILL.md` walks the setup:
  how many Bots, what each one writes in its three files, what the common and the shared
  files hold, when a group chat is needed and how the first task is handed over. It is
  what turns the tools into a team.

## How to install and open it

1. Download the ZIP of this repository (**Code -> Download ZIP**) and extract it, or clone
   it:

   ```sh
   git clone https://github.com/MiniMax-AI/MiniMax-Code-MiniApps.git
   ```

2. Copy the whole directory `plugins/antianqi/minimax-bot-team/`, **including the hidden
   `.minimax-plugin` directory**, into `<dataDir>/plugins/minimax-bot-team/`. By default
   `<dataDir>` is `~/.minimax`, so the plugin goes to
   `~/.minimax/plugins/minimax-bot-team/`. The author directory only groups the
   contributions in this repository - do not copy it into `plugins/`.

   From MiniMax Code 3.1.11 you can import the package instead of copying it: on the
   Plugins page choose **Create**, then **Import from a Git repository** under Mini App,
   and paste
   `https://github.com/MiniMax-AI/MiniMax-Code-MiniApps/tree/main/plugins/antianqi/minimax-bot-team`.

3. Restart MiniMax Code, confirm that the plugin is recognized and enabled, and open the
   panel. Ask the Agent to open "MiniMax Bot", or use the plugin entry in the plugin list.

Nothing has to be configured: no API key, no account, no service to sign up for. The Bots
run on the models the Host already uses.

## Tested environment

- MiniMax Code 3.1.2 or later on macOS, Windows and Linux. Earlier versions cannot
  install this package, because it declares `agentAccess` and `surface.window`.
- Tested by the author on MiniMax Code 3.1.11 on Windows 11 (x64): the panel opens, a Bot
  is created, its three identity files are written and read back, a group chat is created,
  a task is handed over and the answer comes back into the group. macOS and Linux were not
  tested. The package itself is platform-neutral - the Node service binds the loopback
  interface only, and the page is plain HTML, CSS and JavaScript.

## Data & access

- **Agent turns**: every Bot reply, every scheduled task and every background helper is an
  Agent turn run through `context.agent` (`session.run`), with the Agent's full
  capabilities - files, shell, Skills and MCP, including this package's own MCP tools. A
  tool call that needs approval is shown in the page or in the session's sidebar tab and
  runs only after you choose **Allow once**. Nothing is approved automatically.
- **Files written**: only inside the Mini App's `dataDir`: `state.json`, `messages/`
  (one file per chat), `usage.jsonl` (one row per Agent turn), `memory/` (with its
  journal and archive), `shared/` and `common/` (the cards and the two shared files),
  `agents/<bot-id>/` (each Bot's identity files), `uploads/` (your attachments),
  `avatars/` and `memory-bridge/` (the helper described below). A chat message is masked
  before it is written: a value that looks like a key is stored as `[REDACTED]`, so the
  history on disk holds no secret.
- **Files read outside `dataDir`**: the Host's global memory files under
  `~/.minimax/memories/scopes/global/`, read only, to answer a Bot's
  `host_memory_search` query. There is no supported API for this, so it relies on the
  Host's unspecified layout and may stop working when the Host changes it. Nothing is
  written there.
- **Processes**: on macOS, `id -F` is run once (1.5 s timeout) to read your account's
  full name as the default display name. One helper process is started per Host-memory
  search (`node <dataDir>/memory-bridge/search.mjs`); its stdout carries the result back
  to the plugin and it exits right after.
- **Network**: the Node service makes no outbound requests, and the page loads no remote
  resources. HTML previews may load the HTTP(S) styles and resources that the previewed
  document references, inside an isolated sandbox.
- **Environment**: reads `LC_ALL`, `LC_MESSAGES` and `LANG` to choose the default
  language.
- **Not used**: the microphone, the camera, system notifications and which MiniMax Code
  page you are on are neither read nor requested - the package declares none of them.

## Known limitations

- The Host Agent API cannot filter the MCP catalog per conversation, so a Bot may see a
  tool in the shared catalog that its group does not allow it to use. The server refuses
  the call anyway.
- The Bot's own files are read from its folder only. A subfolder is not read, and a file
  name has to match `[A-Za-z0-9_-]{1,48}.md`.
- The plugin manifest shows one description string, and it is written in Chinese and
  English, so the marketplace shows both.

## Acknowledgements

This package is built on the MiniMax Bot Mini App published by MiniMax (MIT). The
original copyright notice is kept in `LICENSE`; the changes published here are the work
of the author listed above.

## License

[MIT](./LICENSE)
