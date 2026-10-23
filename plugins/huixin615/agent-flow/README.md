# Agent Flow (`agent-flow`)

A read-only Mini App for inspecting **native `task` sub-agents** in local MiniMax Code conversations. Open it while working normally: it shows when a parent Agent delegated work, the child session and its tool activity, the child's final reply, and whether a matching result appeared in the parent conversation. It does not launch or control Agents.

The timeline uses persisted task times and reports whether tasks delegated in one turn actually overlapped, plus whether each result can be matched in the current parent history. Two tool calls in one parent message are not assumed to have run in parallel. A task marked “delivered” is not treated as a verified parent-history match; compaction or an unreadable history can leave that match unverified. A match does not prove the parent understood or used the result.

## Install and use

Requires MiniMax Code 3.1.4 or later.

Copy this whole directory, including `.minimax-plugin/`, to `~/.minimax/plugins/agent-flow/`. Restart MiniMax Code, then ask it to “Open Agent Flow” or “打开 Agent 协作透视”. The Mini App tab belongs to the conversation where it was opened; the page can still inspect earlier conversations through its picker. It follows the most recently updated local conversation as an **inference**, including conversations with zero tasks, because the Host does not expose the current chat ID to this Mini App. Use the picker to hold a specific conversation, or choose “Follow latest” to resume automatic selection. It refreshes task data every three seconds and the conversation list every fifteen seconds while open; it stops when closed.

The detail panel shows the `task` instruction, the child Agent's final reply, and tool names. These are recorded statements and actions, not proof that an advertised code change is correct. Previous messages removed from the active history by compaction may no longer be available in the detail panel; the persisted task and parent-child relation remain visible. The session picker starts with 40 entries and offers “Load more” when needed.

This version covers native `task` sub-agents only. MiniMax Bot groups, MoMo-managed tasks, cloud sessions, and arbitrary plugin-owned Agent sessions are outside its scope.

## Tested environment

- MiniMax Code 3.1.4 on macOS: read-only reconstruction verified against one real parent conversation with two foreground `explore` children and matching parent tool results. The plugin appears in the installed plugin list, and the user confirmed that the Mini App page displays both tasks.
- Node.js 24.21.0: synthetic tests cover old sessions, mismatched paths, missing parent results, and nested failed background tasks; the repository `npm run check` passes.
- Windows paths are implemented with Node's cross-platform path utilities but have not been tested on Windows.

## Data & access

- Reads `~/.minimax/v2/sqlite/runtime-state.sqlite` with `node:sqlite` in read-only mode, plus selected session `messages.jsonl` files under `~/.minimax/v2/sessions`. It checks that a history directory encodes the selected session ID, rejects symlinked history paths, and caches unchanged files while open. If `MAVIS_HOME` is set, that directory replaces `~/.minimax`.
- The Mini App Host does not provide a supported API to observe other conversations. These paths and schemas are **internal, undocumented layouts** observed in MiniMax Code 3.1.4; a client update may break them. A missing or incompatible store produces an error, not guessed relationships.
- Does not write Host files, plugin data, or browser storage. No outbound network requests, spawned processes, Agent turns, MCP endpoints, or background monitoring after the page closes.
- The browser receives only selected conversation and task details from the local Node process. Nothing is uploaded. The page renders stored text as text, never as HTML.

## Development

Run `node --test plugins/huixin615/agent-flow/tests/*.test.mjs` and `npm run check` from the repository root. Synthetic tests create temporary stores and contain no real conversation content.

## License

[MIT](./LICENSE)
