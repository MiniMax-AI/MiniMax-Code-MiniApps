# FactScribe Paper Workbench (`factscribe`)

A local workbench for writing papers inside MiniMax Code. It opens your manuscript projects,
shows the check report, the fact ledger and the knowledge base side by side, and gives the
assistant seventeen read-mostly tools. Every edit the assistant suggests arrives as a **proposal**
that you approve in the page before a single byte is written to your manuscript.

**Human in the loop.** The assistant has no interface that writes to your text. Writing happens
only when you click *Adopt* on a diff card. Numbers and citations stay pinned to the ledger:
a value that is not in the ledger cannot be introduced by the assistant.

## What it solves

The three things that quietly break a paper are numbers that do not match the ledger, citations
that do not match the source, and two language versions that no longer say the same thing.
FactScribe turns them into readings you can check:

- every number and citation in the text is bound to a ledger entry with a source and a location;
- a fingerprint gate refuses to overwrite a file that changed after the diff you are looking at;
- bilingual drafts are compared entry by entry against the ledger and the bibliography.

## Capabilities

**Page** (route `/workbench`)

- Project and disk list (a project may hold several language disks, such as `paper` / `paper-zh`).
- Section rendering with protected chips for `\fact{}`, `\cite{}` and bound numbers.
- Check report (summary plus findings), style-gate readings, bilingual drift, evidence lock,
  writing brief, venue layout.
- Fact ledger queries and knowledge-base search.
- Assistant panel that runs on the Host's own model, with a Chinese / English interface switch.

**Assistant tools** (17, over MCP)

Read-only (12): `fs_status`, `fs_get_outline`, `fs_read_section`, `fs_get_report`,
`fs_get_style`, `fs_mirror_check`, `fs_get_evidence_status`, `fs_get_brief`, `fs_get_venue`,
`fs_query_facts`, `fs_search_kb`, `fs_list_proposals`.

Proposals only (5): `fs_propose_edit`, `fs_propose_evidence_freeze`,
`fs_propose_evidence_unfreeze`, `fs_propose_add_fact`, `fs_propose_export_bundle`.

## Install

Copy this directory, including the hidden `.minimax-plugin/`, into the MiniMax Code plugins
directory as `factscribe/` (`~/.minimax/plugins/factscribe/` by default), then restart MiniMax
Code and ask the Agent to "Open the FactScribe paper workbench".

MiniMax Code 3.1.11 and later can also import the package straight from a Git repository: paste the
repository URL, pick the package directory, and confirm the preview.

On first use the page asks for your paper root directory: any directory that contains a
`factscribe.toml` is treated as a paper project. It can be changed later from the settings page.

## Tested environment

- MiniMax Code 3.1.16 on macOS 26.6.2 (arm64). Installed from this directory, opened through the
  Agent, page rendered, and all 17 MCP tools called end to end over the Host's MCP runtime.
- Node 26.7 and Python 3.14 on the same machine. The Python engine is vendored inside the
  package, so nothing has to be installed.
- Minimum client version: 3.1.2. The package declares `agentAccess: ["session.run"]`, which
  needs 3.1.2; no `engines` bound is declared, so clients from 3.1.2 on still install it and
  only lose the assistant model picker when their client does not expose the model catalogue.
- Not verified: Windows and Linux hosts. The package ships no platform-specific binary and the
  Node entry uses only Node built-ins, but no run on those platforms has been done.

## Data & access

- **Files read**: the paper root directory you configure (and up to three levels below it) to
  discover projects, render sections, compute the check report and list knowledge-base files; the
  package's own payload directory, read-only at runtime.
- **Files written**: the plugin's private `dataDir` — `config.json` (your paper root),
  `proposals/` (proposal records) and `custom-models.json` (an API key you typed yourself, mode
  0600). Inside your paper directory, only where you click: `sections/*.tex` (atomic write plus a
  `.bak` copy, refused when the file changed underneath) and `facts/draft/` for imported drafts.
  Opening a disk also records `last_opened` in that disk's `factscribe.toml`.
- **Network hosts**: none by default. The Node service and the Python engine listen on loopback
  only (`127.0.0.1`). If you add a custom model in the panel, the Node shell sends the prompt to
  the OpenAI-compatible endpoint you typed; the host Agent turn is run by the Host on your
  MiniMax Code account and plan.
- **Processes spawned**: `python3 -B -m factscribe workbench --root <your root> --port 0 --json
  --no-browser` (the engine; killed when the Mini App stops), `factscribe audit` (read-only
  re-run of the check report), `tectonic` (only for the optional PDF render button) and macOS
  `open` (only for the "open folder" button).
- **Agent turns**: the panel runs Host Agent turns through `agentAccess: ["session.run"]`. The
  model is the one MiniMax Code is configured with, on the Host's account and plan; the plugin
  never reads your API keys or the Host configuration.
- **Conversations read**: none. The package declares no `session.read`, so it cannot list, read
  or observe your conversations; each turn runs in the session the Mini App itself started.
- **Tools called**: none. The package declares no `toolAccess`, so it never calls Host MCP tools
  or Connectors; a tool call requested by the model in the panel is refused and the model is told
  to answer from the material instead.
- **Microphone, camera, notifications**: not used.
- **Host navigation read**: not used.
- **State**: the Host-owned plugin data directory, `~/.minimax/v2/plugin-data/liveboards/factscribe/`
  on this machine. Treat that location as opaque; the plugin reads its own `config.json`,
  `proposals/` and `custom-models.json` from there and writes nothing else outside it and your
  own paper directory.

## MCP tools and the placeholder address

The package declares one MCP server, `factscribe`, in `servers.mcp.json`, and points
`miniapp/miniapp.json` at it with `mcpEndpoints`. The URL in `servers.mcp.json`
(`http://127.0.0.1:9/mcp/factscribe`) is the fail-closed placeholder MiniMax Code documents for
a Mini App that serves its own MCP server: port 9 never answers, and the Host rewrites the address
to the running instance when it adopts the Mini App. The two declarations belong together — the
Host checks that every `mcpEndpoints.server` is declared in `plugin.json.mcpServers`. No remote
third-party MCP server is declared.

## Files

```text
.minimax-plugin/plugin.json   Plugin manifest
package.json                  Mini App declaration
servers.mcp.json              MCP server served by the Mini App
icon.png                      Plugin icon
miniapp/miniapp.json          Payload roots, Node entry, page route, MCP endpoint
miniapp/client/               The page: index.html, app.js, app.css
miniapp/node/server.mjs       Node entry: start(context) -> { dispose }
miniapp/node/engine/          The vendored FactScribe engine (Python)
```

## License

[MIT](./LICENSE)
