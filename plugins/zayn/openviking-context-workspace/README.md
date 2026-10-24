# OpenViking Context Workspace (`openviking-context-workspace`)

OpenViking Studio, context tools, and automatic session memory inside MiniMax Code.

The Mini App serves the official OpenViking Studio UI at `/workspace`. Its Node runtime resolves
the same `OPENVIKING_*`, `~/.openviking/ovcli.conf`, and `~/.openviking/ov.conf` connection
chain used by the OpenViking CLI, then proxies only the fixed Studio REST routes and
`/mcp/openviking`. Credentials stay in the Node process.

## What is included

- The official OpenViking Studio build for browsing resources, sessions, memories, and skills.
- The OpenViking Streamable HTTP MCP endpoint, available to the MiniMax Code Agent while the Mini
  App is installed.
- OpenViking Skills for memory, skill discovery, experience capture, and troubleshooting.
- MiniMax Code hooks: `Stop` appends new user/assistant messages, while `PreCompact` and
  `SessionEnd` commit the durable OpenViking session.
- A **Send to MiniMax Code** button that calls `window.mcode.miniapp.message.append` from a user
  gesture. MiniMax Code asks for confirmation before adding the handoff to the chat draft.

## Install

Copy the complete directory, including `.minimax-plugin/`, to the MiniMax Code plugin directory as
`openviking-context-workspace/`, then restart MiniMax Code. Configure OpenViking with the normal
`ov config` flow or the `OPENVIKING_*` environment variables.

For a standalone browser preview:

```sh
npm run dev
```

Open `http://127.0.0.1:4317/workspace`. The preview server binds to `0.0.0.0`; set `PORT` to
choose another port. In browser preview, the handoff button copies text to the clipboard because the
MiniMax Code Host bridge is not present.

## Tested environment

- MiniMax Code 3.1.2 package contract.
- Node.js 22 on Linux.
- OpenViking Studio built from OpenViking commit `b3c3f643b28d04c11c60fde0189c49bac8987c4f`.

## Data & access

- Files: reads bundled Studio assets and OpenViking configuration from the documented credential
  chain. Hook state is stored in the operating system's temporary directory by the upstream hook
  runtime.
- Network: proxies only `/api/*`, `/bot/*`, `/health`, `/ready`, `/openapi.json`, and the
  declared MCP endpoint to the configured OpenViking server. It does not forward browser cookies,
  Host authorization headers, or arbitrary URLs.
- Processes: the Mini App starts one Host-managed Node HTTP server. Hook handlers start short-lived
  Node processes for capture and commit.
- Agent: MCP tools can read and write OpenViking resources and sessions according to the configured
  OpenViking identity. The page can only ask the Host to append text to the current unsent draft.
- Credentials: resolved server-side and never returned to Studio or stored in client assets.

## Source layout

```text
.minimax-plugin/plugin.json     Mini App, MCP, Skill, and Hook declarations
servers.mcp.json                OpenViking MCP capability
hooks/openviking-hooks.json     MiniMax Code lifecycle subscriptions
hooks/dispatch.mjs              Claude/Codex payload adapter
hooks/claude/                   Upstream Claude transcript capture runtime
hooks/codex/                    Upstream Codex transcript capture runtime
skills/                         OpenViking Agent Skills
miniapp/miniapp.json            Runtime, surface, and MCP endpoint
miniapp/client/                 Official Studio build plus Host bridge
miniapp/node/server.mjs         Static server and credential-safe fixed proxy
```

## License

[GNU Affero General Public License v3.0](./LICENSE). See
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for the bundled OpenViking source revision.
