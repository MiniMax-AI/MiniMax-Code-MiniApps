# DeepSeek Chat Migration

English | [简体中文](README_ZH.md)

DeepSeek Chat Migration previews the official DeepSeek web-app export, restores regenerated
branches, reasoning, sources and attachments, and lets you carry the conversations you pick into
the MiniMax Code chat the Mini App is open in. It adds them to that chat's input through the
documented `message.append` API: MiniMax Code asks you to confirm, then you review the text and
press Send yourself. No other plugin is needed.

The Mini App does not create, import or edit MiniMax Code sessions, and it never reads or writes
MiniMax Code's own databases or session files.

## Export from DeepSeek

1. Open `chat.deepseek.com`.
2. Go to **Settings → Data → Export** and download the official ZIP.
3. Keep the ZIP unchanged. A current export contains `manifest.json` with
   `export_format_version: 3`, `user.json`, `chat_session_index.json`,
   `chat_sessions/<id>.json`, and optional files under `chat_sessions/<id>_files/`.

The app never logs in to DeepSeek, reads browser sessions or scrapes the website.

## Install and open

1. Download this `deepseek-chat-migration` directory.
2. In MiniMax Code, ask the Agent to install this Mini App directory.
3. Open **DeepSeek Chat Migration** in the chat where you want to continue, then choose the ZIP
   downloaded from DeepSeek. It is parsed inside the page.
4. Click a conversation to preview it: every branch, with reasoning, sources and attachments as
   collapsible blocks. Tick one or more conversations to carry several at once (**全选** in the
   toolbar ticks or clears all). With nothing ticked, the previewed conversation is used.
5. Optionally tick **包含思考过程 · reasoning** and **包含搜索来源 · sources**. The footer shows
   how long the text will be.
6. Choose **添加到对话输入框 · Add to chat input**. MiniMax Code shows its own confirmation with the
   plugin, the target chat and the text. After you confirm, the text is appended to the unsent
   draft; nothing is sent until you press Send. Each click needs its own confirmation.
7. **复制 · Copy** puts the same text on the clipboard instead, for another chat or an older client.
   **Export DeepSeek archive** downloads `deepseek-chat-archive.zip` (Markdown per conversation,
   attachments included in the export, and an offline search page) as a separate backup.

### What the added text contains

- A one-line note that the following is earlier DeepSeek history, to be treated as background.
- Per conversation: `## <title> (<date>)`, then the branch DeepSeek last showed (root to
  `current_message_id`) as `### User` / `### DeepSeek` turns. Regenerated or edited-away branches
  are left out; they stay visible in the preview and in the archive.
- Reasoning and search sources only when their boxes are ticked. Attachments appear as file names
  (`Attached in DeepSeek: …`); file contents are not added.
- `message.append` takes at most 100,000 characters. When the selection is longer, each
  conversation keeps its first user turn and as many of its latest turns as fit, with a marker
  saying how many messages in between were left out; the footer says so before you add it. For the
  full text, use the archive.

## Tested environment

- Node.js 22 parser, draft and runtime tests on Linux (`node --test tests/*.test.mjs`).
- This revision has not yet been run inside a MiniMax Code host. It needs a client that provides
  `window.mcode.miniapp.message.append`; without it, **Add to chat input** is disabled and **Copy**
  still works. The Mini App requires MiniMax Code 3.1.2 or later because it declares a pop-out
  window.

## Data & access

- **Files read:** only the DeepSeek ZIP or JSON you pick in the page, read in the page itself. The
  app reads no Host files: no MiniMax Code database, session file or project folder.
- **Files written:** none. Nothing is stored in `context.dataDir` or browser storage; the parsed
  export lives in the page until it is closed or reloaded. **Export DeepSeek archive** is a normal
  browser download.
- **Chat input:** **Add to chat input** calls `window.mcode.miniapp.message.append` with the text
  described above, only from that click. MiniMax Code asks you to confirm each call, and you send
  the message yourself. The Mini App cannot send messages, read chat history or change sent
  messages.
- **Clipboard:** **Copy** writes the same text to the clipboard; the app never reads the clipboard.
- **Processes:** the Node entry only serves the page and its assets. It spawns no processes.
- **Agent and conversations:** no `agentAccess`; the Mini App runs no Agent turns and reads no
  MiniMax Code conversations.
- **Network:** no network requests and no external hosts.
- **Other capabilities:** no `hostAccess`, `toolAccess`, MCP or Connector tools, microphone, camera
  or notifications.

## Prototype limits

- The official DeepSeek version-3 ZIP layout is the primary supported format. Two older DeepSeek
  JSON shapes remain accepted for compatibility.
- ZIP input supports STORE and DEFLATE entries, including entries that use data descriptors.
- Conversations continue inside the current chat as context. The Mini App cannot create native
  MiniMax Code sessions with the original messages and timestamps; no Mini App API offers that.
- Very long selections are shortened to fit the 100,000-character chat input limit, as described
  above.
