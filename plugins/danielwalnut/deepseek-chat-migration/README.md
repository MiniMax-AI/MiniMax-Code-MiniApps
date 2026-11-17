# DeepSeek Chat Migration

English | [简体中文](README_ZH.md)

DeepSeek Chat Migration previews the official DeepSeek web-app export, restores regenerated
branches, reasoning, sources and attachments, then imports selected conversations as native
MiniMax Code sessions with its own bundled importer. No other plugin is needed.

## Export from DeepSeek

1. Open `chat.deepseek.com`.
2. Go to **Settings → Data → Export** and download the official ZIP.
3. Keep the ZIP unchanged. A current export contains `manifest.json` with
   `export_format_version: 3`, `user.json`, `chat_session_index.json`,
   `chat_sessions/<id>.json`, and optional files under `chat_sessions/<id>_files/`.

The app never logs in to DeepSeek, reads browser sessions or scrapes the website.

## Install and open

1. Download this `deepseek-chat-migration` directory. Python 3.9 or later must be available
   as `python3` (`python` on Windows); the importer uses only the standard library.
2. In MiniMax Code, ask the Agent to install this Mini App directory.
3. Open **DeepSeek Chat Migration**, then choose the ZIP downloaded from DeepSeek.
4. Review the restored conversations and select those to migrate. The **全选** checkbox in
   the toolbar selects or clears every conversation not yet imported.
5. Sessions are always imported into `~/.minimax` for the `mavis` agent and grouped under a
   `DeepSeek` project (`~/DeepSeek`, created empty if missing); there is nothing to configure.
6. Choose **Import as MCode sessions**. While the plan is generated the button shows
   「生成预览中…」. Review the plan, then choose **Confirm import**.
7. While importing, the dialog and the footer show a progress bar and 「导入中 12/50」; each row
   flips to imported as soon as its batch is written. The result lists every selected session as
   imported, already imported (skipped) or failed.
8. Choose **打开 DeepSeek 项目** to go straight to what you imported. On MiniMax Code 3.1.11 or
   later the Host opens an imported conversation, which sits in the `DeepSeek` project of the
   sidebar. On older clients, or if the Host cannot open it, the Mini App opens the `~/DeepSeek`
   folder in Finder, Explorer or the Linux file manager instead.

### What an imported session contains

- The title becomes `[From DeepSeek] <title>`; creation, update and message times are kept.
- Only the branch DeepSeek last showed (root to `current_message_id`) is displayed and becomes the
  model's continuation history. Regenerated or edited-away branches are kept in a per-session
  source archive next to the history, not in the conversation.
- `THINK` reasoning is shown in the transcript but never sent back to the model.
- Web searches become read-only historical tool records with queries and results.
- Uploaded files are kept as references (name, size, path in the export); bytes are not copied.
- Replies that timed out or were cut off carry a short historical error note.

Before its first write, every import run takes one verified online backup of
`runtime-state.sqlite`; sessions are then written in batches of 10, each in one transaction, with
a read-back check after every commit. A session that cannot be imported is reported on its own and
never blocks the others. Target sessions are
keyed by a hash of the DeepSeek account id plus the session id, so importing the same export
again (even after re-downloading it) skips what is already there.

Conversation order and titles come from `chat_session_index.json` when present. Messages are
restored from `parent_id` and `current_message_id`; regenerated answers remain visible as alternate
branches. `THINK` fragments render as collapsible reasoning, and search fragments render as
collapsible sources. Already imported conversations are matched by source ID plus a stable content
hash and skipped when the same export is opened again.

The Markdown archive button remains available as a secondary backup. Native-session import is the
primary workflow.

## Tested environment

- MiniMax Code 3.1.11 on Windows 11
- Node.js 22 parser and unit tests on Linux

The Mini App requires MiniMax Code 3.1.2 or later because it declares a pop-out window. Opening
the imported conversation from the Mini App needs MiniMax Code 3.1.11 or later; older clients get
the `~/DeepSeek` folder in the file manager instead.

## Data & access

- **Files read:** only the official DeepSeek ZIP or a compatible DeepSeek JSON the user explicitly
  picks in the page. Parsing happens locally. The app does not inspect browser sessions, scrape
  `chat.deepseek.com`, upload the export, or read any other Host file.
- **Files written:** the selected ZIP is streamed to a temporary directory under the Host-owned,
  opaque `context.dataDir`; it is replaced on the next upload and removed when the runtime stops.
  Successful import hashes are written atomically
  to `context.dataDir/state.json`. The migration process writes native sessions under the target
  MCode data directory only after the user confirms the plan.
- **Process spawned:** `python3 miniapp/python/import_deepseek.py` (bundled with this Mini App),
  first with `plan` and then, after confirmation, with `apply` on the same report. Arguments are
  passed as an array without a shell: `--source <temporary ZIP>`, one `--session <id>` per
  selection, `--report <temporary report>`, `--data-dir ~/.minimax`, `--agent mavis`,
  `--workspace ~/DeepSeek` and `--restore-projects` (re-shows the DeepSeek project if it was
  removed from the sidebar), plus `--batch-size 10` for apply. Its progress lines on stderr drive
  the progress bar. One backup per import run and the batch reports go to
  `~/.minimax/zcode-migration/`.
- **Folder opener (fallback only):** when the Host cannot open the imported conversation, choosing
  **打开 DeepSeek 项目** runs `open ~/DeepSeek` on macOS, `explorer.exe ~/DeepSeek` on Windows or
  `xdg-open ~/DeepSeek` on Linux, with an argument array and no shell, and only if the folder
  exists.
- **Agent and conversations:** the Mini App runs no Agent turns, reads no MiniMax Code
  conversations, and does not use `message.append`. The bundled importer creates native sessions.
- **Network:** no direct network requests and no external hosts.
- **Host navigation:** **打开 DeepSeek 项目** calls `window.mcode.miniapp.host.navigation.open`
  with `{ id: 'session', sessionId, source: 'local' }` for a session this Mini App just imported,
  only from that click. It does not declare `hostAccess` and never reads which page you are on.
- **Other capabilities:** apart from the disclosed processes, it calls no MCP or Connector tools
  and uses no microphone, camera or notifications.

## Prototype limits

- The official DeepSeek version-3 ZIP layout is the primary supported format. Two older DeepSeek
  JSON shapes remain accepted for compatibility.
- ZIP input supports STORE and DEFLATE entries, including entries that use data descriptors.
- Attachment metadata is preserved. Binaries present under `chat_sessions/<id>_files/` are included
  when the selected conversation is exported; missing binaries remain references.
- Attachment bytes are not copied into MiniMax Code; imported sessions keep file references.
- The target is fixed to the `~/.minimax` data directory and the `mavis` agent.

## Credits

The importer in `miniapp/python/` is adapted from the MiniMax Code team's
`agent-session-migration` plugin (author: Insider): its storage core (lock, backup, transaction,
read-back, history initialization) and checkpointed job, reduced to the DeepSeek source. Target
identities and marker files match that plugin's DeepSeek source, so sessions imported by either
tool are recognized by the other.
