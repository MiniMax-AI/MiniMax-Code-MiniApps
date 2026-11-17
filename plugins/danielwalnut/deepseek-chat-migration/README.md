# DeepSeek Chat Migration

English | [简体中文](README_ZH.md)

DeepSeek Chat Migration turns the official DeepSeek web-app export into a durable local archive
and compact handoff documents for continuing work in MiniMax Code. It previews titles, dates, turn
counts and approximate size; restores regenerated branches; and keeps reasoning, sources and
attachments separate from answers.

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
3. Open **DeepSeek Chat Migration**, then choose the ZIP downloaded from DeepSeek.
4. Review the restored conversations and select only those you want to keep.
5. Choose **Create handoffs** to produce fixed-format handoff documents, or
   **Export DeepSeek archive** to download one Markdown file per conversation, an index, an
   offline full-text search page, and available attachments for the selected conversations.
6. From a handoff, choose **Add to current chat draft**, review the inserted text, and press Send.

Conversation order and titles come from `chat_session_index.json` when present. Messages are
restored from `parent_id` and `current_message_id`; regenerated answers remain visible as alternate
branches. `THINK` fragments render as collapsible reasoning, and search fragments render as
collapsible sources. Already imported conversations are matched by source ID plus a stable content
hash and skipped when the same export is opened again.

## Handoff format

Long threads are split at paragraph boundaries. MiniMax Code's available model extracts each
chunk, then reduces those summaries until one document remains:

- 聊过什么
- 已确定的要求
- 排除过的方案
- 未完成事项
- 关键事实与偏好

The original normalized DeepSeek transcript remains in this Mini App's private state and in any
archive the user downloads. The handoff is a stable, compact prefix; it does not replace the
original archive.

## Tested environment

- MiniMax Code 3.1.11 on Windows 11
- Node.js 22 parser and unit tests on Linux

The Mini App requires MiniMax Code 3.1.2 or later because it declares Agent session access and a
pop-out window.

## Data & access

- **Files read:** only the official DeepSeek ZIP or a compatible DeepSeek JSON the user explicitly
  picks in the page. Parsing happens locally. The app does not inspect browser sessions, scrape
  `chat.deepseek.com`, upload the export, or read any other Host file.
- **Files written:** normalized selected transcripts and handoff documents are written atomically
  to `state.json` inside the Host-owned private `context.dataDir`. The location is opaque. The
  generated archive ZIP, including available selected attachments, is downloaded only after the
  user clicks Export.
- **Model access:** only text from conversations the user selects is sent through MiniMax Code's
  Agent API for distillation. Long threads use multiple Agent turns. A disabled `session.run`
  permission is handled without stopping the app.
- **Conversations:** it does not read existing MiniMax Code conversations. Adding a handoff uses
  the page API, shows the Host confirmation, and only appends to the unsent draft of the current
  conversation.
- **Network:** no direct network requests and no external hosts.
- **Processes and tools:** no child processes, MCP tools, Connector tools, microphone, camera,
  notifications, or Host navigation access.

## Current capability limits

The current Mini App APIs cannot create a normal user-visible conversation pre-seeded with text,
and cannot directly write a project's memory or rules file. DeepSeek Chat Migration therefore
offers a confirmed append-to-draft action and Markdown handoff/archive files. Open the destination
project and conversation, append the handoff, review it, and send it. If a preference should
become a project rule, ask the Agent in that conversation to save the relevant handoff items.

## Prototype limits

- The official DeepSeek version-3 ZIP layout is the primary supported format. Two older DeepSeek
  JSON shapes remain accepted for compatibility.
- ZIP input supports STORE and DEFLATE entries, including entries that use data descriptors.
- Attachment metadata is preserved. Binaries present under `chat_sessions/<id>_files/` are included
  when the selected conversation is exported; missing binaries remain references.
- Imports larger than the 32 MiB normalized request limit should be split into smaller selections.
