# Context Ark

English | [简体中文](README_ZH.md)

Context Ark turns an official conversation-history export into a durable archive and a compact
handoff for continuing the work. It previews titles, dates, turn counts and approximate size;
restores edited or regenerated branches; and keeps reasoning, search results and attachment
references separate from answers.

## Install and open

1. Download this `context-ark` directory.
2. In MiniMax Code, ask the Agent to install this Mini App directory.
3. Open **Context Ark**, then choose the ZIP or JSON downloaded from the source service's
   **Settings → Data management** page.
4. Review the restored conversations and select only those you want to keep.
5. Choose **Distill selected** to produce a fixed-format handoff, or **Export Markdown archive**
   to download one Markdown file per conversation, an index, and an offline full-text search page.
6. From a handoff, choose **Add to current chat draft**, review the inserted text, and press Send.

Already imported conversations are matched by source ID plus a stable content hash and are skipped
when the same export is opened again.

## Handoff format

Long threads are split at paragraph boundaries. MiniMax Code's available model extracts each
chunk, then reduces those summaries until one document remains:

- 聊过什么
- 已确定的要求
- 排除过的方案
- 未完成事项
- 关键事实与偏好

The original normalized transcript remains in this Mini App's private state and in any archive the
user downloads. The handoff is a stable, compact prefix; it is not a replacement for the archive.

## Adding an export adapter

Adapters live in `miniapp/client/adapters.js` and implement two functions:

```js
{
  detect(value) { return trueOrFalse },
  parse(value) { return normalizedConversations }
}
```

Add the adapter to the exported `adapters` array. Normalize each message into ordered blocks of
`text`, `reasoning`, `search`, `attachment`, or `notice`, and preserve message `id`, `parentId`,
role and the selected/current leaf. Add a synthetic fixture and parser plus branch tests under
`tests/`. Unknown source fields should be ignored rather than copied into model prompts.

## Tested environment

- MiniMax Code 3.1.11 on Windows 11
- Node.js 22 parser and unit tests on Linux

The Mini App requires MiniMax Code 3.1.2 or later because it declares Agent session access and a
pop-out window.

## Data & access

- **Files read:** only a ZIP or JSON the user explicitly picks in the page. The page parses it
  locally. It does not inspect browser sessions, scrape a website, or read any other Host file.
- **Files written:** normalized selected transcripts and handoff documents are written atomically
  to `state.json` inside the Host-owned private `context.dataDir`. The location is opaque. The
  archive ZIP is downloaded only after the user clicks Export.
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
and cannot directly write a project's memory or rules file. Context Ark therefore offers a
confirmed append-to-draft action and Markdown handoff/archive files. Open the destination project
and conversation, append the handoff, review it, and send it. If a preference should become a
project rule, ask the Agent in that conversation to save the relevant handoff items.

## Prototype limits

- Supports the official version-3 ZIP layout and two older JSON shapes covered by synthetic tests.
- ZIP input supports stored entries and ordinary DEFLATE entries without data descriptors.
- Attachment metadata is preserved; attachment binaries are not copied into the generated archive.
- Imports larger than the 32 MiB normalized request limit should be split into smaller selections.
