# Text Editor

[简体中文](README.zh-CN.md) | English

A Sublime-style local text editor that you and the MiniMax Code Agent work in together. Both of you edit
the same live buffers: the Agent reads, edits, creates, and saves files through MCP tools while you see
every change as it happens, and during a code review it can highlight code and attach notes that never
touch the file.

Author: [TrentChou](https://github.com/TrentChou) · Version: `1.3.1`

![Text Editor with Agent review highlights (synthetic code)](docs/preview.jpg)

## Install & use

1. Copy this directory, including the hidden `.minimax-plugin/`, to `<dataDir>/plugins/text-editor/`
   (`~/.minimax/plugins/text-editor/` by default), then restart MiniMax Code.
2. Open it from the right panel's "+" menu, `@文本编辑器` in a conversation, or ask the Agent to
   "打开文本编辑器，加载当前项目".
3. Add folders to the sidebar, or let the Agent add the conversation's workspace. The Agent sees the
   editor's MCP tools from the next conversation turn after installation.

The interface is in Chinese.

## Features

- Tabs, sidebar file tree, quick open (`⌘P`), go to line (`⌃G`), command palette (`⇧⌘P`), find and
  replace, multiple cursors (`⌘D`, `⇧⌘L`), folding, minimap, indentation guides.
- Syntax highlighting for about 40 languages and formats, including JSON, YAML, TOML, Markdown,
  JavaScript/TypeScript, Python, Go, Rust, Java, C/C++, SQL, and shell.
- Hot exit: unsaved edits survive closing the page and restarting MiniMax Code.
- Disk awareness: files changed by other programs reload automatically, or show a conflict banner when
  you have unsaved edits; deleted files can be re-created by saving.
- Follows your conversations: when the editor opens, the workspace of the conversation you most recently
  used moves to the top of the sidebar.

## Agent tools (MCP)

| Tool | What it does |
| --- | --- |
| `get_editor_state` | Sidebar folders, open tabs (unsaved/conflict flags, highlight counts), active file, the user's selection, highlight settings |
| `list_directory` | List a folder inside the sidebar folders |
| `read_file` | Read a file; returns the live buffer, including unsaved edits, when it is open |
| `create_file` | Create a file and open it in a tab |
| `write_file` / `edit_file` | Replace content, or an exact snippet, in the buffer the user sees; stays unsaved unless `save: true` |
| `save_file` | Save a buffer; refuses to overwrite changes made on disk by other programs unless told to |
| `open_in_editor` | Open a file at a line, or add a folder to the sidebar |
| `highlight_code` | Highlight lines, a character range, or an exact snippet, with an optional note and kind (`info`, `warning`, `error`, `success`) |
| `list_highlights` / `clear_highlights` | See which highlights remain (users can dismiss them) and remove them |

The tools only reach files inside the sidebar folders, and they refuse credential-like files such as
`.env`, `.secrets/`, `.ssh/`, and private keys. You can still open those yourself.

## Review highlights

Highlights are overlays: they never change the buffer or the file on disk. Each one follows the code as
it is edited, and a note appears as a card under the highlighted code. Press `F8` / `⇧F8` to jump between
highlights; the status bar shows the count and opens a menu.

You control their lifetime, from the status bar menu or Settings:

- **Keep highlights until cleared** (off by default). When off, a highlight disappears as soon as its
  code is edited (by you, the Agent, or a reload from disk; edits right at its edges count too) or its
  file is closed. When on, highlights stay, also across restarts, until you or the Agent
  clear them; if the file changed while it was closed, a highlight is re-anchored to its unchanged code,
  or dropped with a notice if that code was rewritten.
- **Show Agent highlights** hides or shows them without deleting anything.

Dismiss a single note with its ×, or clear the current file or everything from the status bar menu.

## Data & access

- **Files read:** files you open and files inside the folders you add to the sidebar. Open files are
  checked with `stat` every 1.5 seconds to detect changes made by other programs.
- **Files written:** only when you or the Agent save (`⌘S`, `save_file`, or `save: true`) or create a
  file or folder. Saving writes a temporary file (`.<name>.<pid>.<n>.tmp`) in the same directory as the
  target, copies the original permission bits, then renames it over the target. Symbolic links are
  followed, so the link stays a link and its target is updated. Hard links to the old file keep the old
  content, and extended attributes are not copied. If the directory is not writable but the file is,
  the file is written in place instead. New files are created exclusively and never overwrite an
  existing file. Highlights never write anything to your files.
- **State** (under the Mini App data directory): `state.json` (sidebar folders, tabs, settings), `hot/`
  (unsaved buffers for hot exit), `drafts/` (the default 草稿 folder), and `highlights.json` (only while
  "keep highlights" is on; removed when it is turned off).
- **Hooks:** on `SessionStart` and `UserPromptSubmit`, `hooks/record-workspace.sh` (or
  `record-workspace.ps1` on Windows) writes the conversation's workspace path to
  `<PLUGIN_DATA>/active-workspace`. It reads nothing else and prints nothing. The editor reads that file
  from the hook data directory next to its own data directory.
- **Processes:** `git -C <sidebar folder> ls-files -co --exclude-standard -z` (arguments passed as an
  array, 5-second timeout) to build the quick-open list; without Git it walks the folder instead,
  skipping `node_modules`, build outputs, and similar directories. The hooks run `sh` or `powershell`.
- **Network:** none. The page and the MCP endpoint are served only on the Host-assigned
  `127.0.0.1` port; cross-site requests and MCP calls from other web origins are rejected.

## Tested environment

- MiniMax Code 3.1.1 on macOS 26.5 (Apple silicon): installed, opened, and used through the page and
  through the Agent's MCP tools in a real conversation, in light and dark themes.
- An isolated runtime test covers the highlight tools, edit mapping, both lifetimes, restart recovery,
  external changes while a file is closed, and atomic saves (permission bits, symlinks, no leftover
  temporary files, read-only directories).
- Windows and Linux are untested; the Windows hook script has not been run.

## Building the vendored code

`miniapp/client/vendor/codemirror.js` and `miniapp/node/vendor/cm-state.mjs` are prebuilt bundles of
CodeMirror 6. To rebuild them: `cd vendor-src && npm ci && node build.mjs ../miniapp`. Versions are
pinned in `vendor-src/package-lock.json`.

## License

[MIT](./LICENSE). Bundled third-party code keeps its own licenses: CodeMirror 6, Lezer, and the minimap
and indentation-marker extensions (MIT, see `miniapp/client/vendor/THIRD_PARTY_LICENSES.txt` and
`miniapp/node/vendor/THIRD_PARTY_LICENSES.txt`), and JetBrains Mono (SIL Open Font License 1.1, see
`miniapp/client/fonts/OFL.txt`).
