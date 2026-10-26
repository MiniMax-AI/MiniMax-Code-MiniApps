# Agent Flow (`agent-flow`)

Agent Flow shows a timeline of native `task` calls and sub-agent lifecycle events from a file that **this plugin's Hooks create**. The user works in ordinary MiniMax Code chats. The Mini App reads a file only after the user selects it; it does not discover or open Host runtime databases or session history.

The timeline shows observed `PreToolUse` → `PostToolUse` intervals, whether a tool result field was present, and `SubagentStart` → `SubagentStop` intervals. It compares completed task-call intervals for overlap. A tool result does not prove that the parent Agent adopted it. A child is linked only when the structured `task` result names the same child session ID as its lifecycle events, or a Hook explicitly supplies a parent session ID. The selected-session view excludes unrelated and unlinked child events; the import file itself is unchanged.

## Install and use

Requires MiniMax Code 3.1.4 or later and `node` available on the Hook command's `PATH`.

Copy this directory, including `.minimax-plugin/` and `hooks/`, to the local MiniMax Code plugin directory as `agent-flow`, then restart MiniMax Code. Work normally and invoke native `task` sub-agents. Open “Agent 协作透视” and select `agent-flow-events.jsonl` from this plugin's Hook data directory. Select rotated `agent-flow-events-*.jsonl` files together if needed.

On the tested macOS desktop layout, Finder's **Go to Folder** can navigate to `~/.minimax/v2/plugin-data/hooks/agent-flow/`. This is a **manual file-picker hint**, not a path used by the plugin's code or a promised stable Host layout. If the directory is empty, check that the plugin is enabled, a new native task has run since installation, and `node` is available to the desktop application's Hook process.

Choose the file again to see newly appended events. The page keeps imported data only in memory and does not poll the file. Records from before the Hooks were installed cannot be reconstructed. Session identifiers are SHA-256 digests; the picker lists sessions with observed `task` calls, sorted by their latest event with full local dates and times. Choose a session or click “查看最近记录” to select the newest **imported** task session in one step. This selection is an inference and may not be the chat containing the Mini App; the page never binds it automatically to the current chat. Only children explicitly associated with the chosen session appear in its view.

## Tested environment

- MiniMax Code 3.1.4 on macOS: after installation and restart, a new Work chat produced two `task` calls, two tool returns, and two complete sub-agent lifecycles. The user imported the plugin-generated file and confirmed that both calls matched their respective children by exact hashed session ID. The two child running intervals overlapped. Older records created before structured child ID capture remain unlinked.
- Node.js 24.21.0 for the Hook recorder and synthetic tests. Windows has not been tested.

## Data & access

- The `SessionStart`, `PreToolUse(task)`, `PostToolUse(task)`, `SubagentStart`, and `SubagentStop` Hooks receive event JSON from MiniMax Code on stdin. Each Hook invocation runs `node "${PLUGIN_ROOT}/hooks/record.mjs"`. These invocations can occur while the Mini App page is closed.
- The recorder writes `agent-flow-events.jsonl` under the runtime-provided `PLUGIN_DATA` directory, rotating at 8 MiB. It keeps timestamps, SHA-256 digests of opaque IDs (including a structured child session ID when present in a `task` result), agent type, a task description/title/name truncated to 160 characters, and whether the tool response field exists. **That short task title may contain user-supplied text, including a path or sensitive value.** It does not separately collect workspace paths or credentials and does not store the full task prompt, tool result body, or child final reply. The records remain on the user's machine until the user deletes them.
- The Mini App's Node process serves only its own HTML, CSS, and JavaScript. The browser parses only files explicitly selected by the user, in memory, and does not upload or persist the content. No Mini App Agent turns, MCP endpoints, outbound network requests, or Host runtime/session-file access. Hook processes are the only subprocesses; no additional process is started by the Mini App.
- The Mini App declares no Agent access. It cannot identify the chat containing the page and does not list or read Host sessions or run Agent turns. The user chooses a recorded session explicitly; choosing one does not claim it is the currently open chat.
- The UI renders imported strings as text. A mismatched, incomplete, or oversized file is rejected rather than merged into a guessed history.

## Development

Run `node --test plugins/huixin615/agent-flow/tests/*.test.mjs` and `npm run check` at the repository root. Tests use only synthetic events and a temporary plugin data directory.

## License

[MIT](./LICENSE)
