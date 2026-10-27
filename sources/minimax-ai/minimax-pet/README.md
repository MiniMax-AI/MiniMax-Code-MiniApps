# MiniMax Pet

English | [简体中文](README.zh-CN.md)

A lightweight desktop companion for MiniMax Code, by **MiniMax**. It shows visible conversation activity, answer-needed reminders and recent results without creating another chat. The interface is currently in Chinese.

## Features

- **Appearance:** preview and select pets, play short interactions, import compatible pet JSON and spritesheets, and remove imported pets.
- **Tasks:** recent reminders, visible user conversations, and a scrollable latest reply. Desktop cards preview up to five lines. Clicking a card keeps the pet visible; observed `ask_user` calls show “需要你回答” (needs your answer).
- **Settings:** pet size, page-local reminder dismissal and mute, connection status, and reconnect.
- **Desktop window:** a draggable transparent pet with compact notification cards. Return it to the main panel to use the three tabs.
- **Original-chat draft:** explicitly open the draft tool, then ask the Host to confirm appending text to the chat that opened the pet. The user still sends it. Voice-to-text is available only when the Host provides it and microphone permission is granted.

The pet does not run Agent turns, create independent chats, comment on every session, stop tasks, or answer questionnaires. Selecting a task only reads its details; it does not navigate the Host to an arbitrary conversation.

## Install and open

1. Copy the entire `plugins/minimax-ai/minimax-pet/` directory, including `.minimax-plugin`, into `<dataDir>/plugins/minimax-pet/`. The default data directory is `~/.minimax`; use your configured directory if different. The `minimax-ai` author directory is not part of the installed path.
2. Restart MiniMax Code and confirm the plugin is enabled.
3. Open “MiniMax Pet” from the MiniApp list, or ask the Agent “打开 MiniMax Pet”.
4. Choose **放到桌面** to show the desktop pet.

To update, close the app and exit the client before replacing the complete package. Keep backups outside the client's plugins directory. Imported pets and preferences are stored separately in the Host-assigned plugin data directory.

Earlier local prototypes use a different plugin ID. The Host gives `minimax-pet` its own data directory; importing the new package does not automatically move an older plugin's pets or preferences. Keep any existing installation/data until you have exported what you need.

## Tested environment

- MiniMax Code **3.1.6 or later** is the supported baseline. On 2026-10-26, the official [mainland China](https://filecdn.minimax.chat/public/minimax-agent-prod/release/latest-mac.yml) and [Global](https://file.cdn.minimax.io/public/minimax-agent-prod/release/latest-mac.yml) production update feeds both listed 3.1.6. The corresponding release implementation was checked for the required APIs. This establishes a released API baseline, not GUI acceptance of this plugin on that release.
- Task monitoring uses `agent.sessions`, `agent.session`, `agent.observe`, and `agent.cancel` with the `session.read` grant. Runtime capability and permission checks remain in place; missing APIs or disabled access are reported as unavailable.
- Voice input additionally requires `deviceAccess: ["microphone"]`, `speech.transcribe`, the plugin's microphone switch, system microphone permission, and access to the Host transcription service; otherwise it remains unavailable. A supported API does not guarantee service availability for every account.
- The preceding UI version was exercised on macOS in a MiniMax Code development build: three tabs, wide/narrow layouts, task reading, real session/ask activity, import/delete, draft confirmation, and desktop round trips. This open-source revision has Node/DOM tests and an isolated HTTP smoke test.
- The default atlas is checked by actual PNG decoding, frame coverage and deterministic rebuild tests. The separate octopus icon is checked by PNG decoding and visual review. On 2026-10-26, the packaged Skill was exercised with a real Agent in the macOS development build to create, validate, preview and import a custom v2 pet; all nine animation previews and the four cardinal mouse-look directions were checked. This does not replace released-client acceptance.
- No Windows GUI, released-client installation or GUI acceptance on 3.1.6, or real microphone recording/transcription has been verified for this revision. Automated tests use synthetic data and do not prove those paths.

## Data & access

- **Conversation data:** requests only `session.read`. Reads visible user-conversation metadata, status and a selected conversation's latest reply through the public Host API. It does not read the Host database, logs, configuration, credentials or private files. Conversation state and reminders stay in page memory.
- **Observations:** one global observer aggregates visible task lifecycle events. Up to three detailed observers follow active tasks and detect new ask tool events. A completed/removed task releases its detailed slot; another task enters only after the previous subscription settles. The initial snapshot contains up to 50 recent visible conversations; observed tasks remain while the Host confirms visibility.
- **Coverage limits:** observers are tail-only. They cannot reconstruct questionnaires opened before subscribing or during a disconnect. More than three active tasks means only three receive detailed ask coverage. No observed ask does not prove no pending question. Historical idle tasks are not presented as newly completed.
- **Local files:** the Node service serves packaged assets and stores preferences and user-imported JSON/WebP/PNG spritesheets under opaque `context.dataDir`. Imports, replacement recovery and deletion are limited to that plugin data. Browser storage is used only to migrate old view preferences.
- **Drafts:** `message.append(text)` goes through Host confirmation and targets the original chat. Monitoring or selecting another task does not change that target or send a message.
- **Microphone and network:** recording is user-initiated in the draft tool. Audio stays in memory and is passed to Host `speech.transcribe`; leaving the tool cancels capture/transcription. The Host transcription service may use its configured network services. The plugin has no hard-coded external runtime endpoint; its own HTTP requests use its assigned loopback origin.
- **Processes and Agent turns:** the Host starts one Node process. The plugin spawns no additional runtime process, launches no shell command, offers no MCP server, and never calls `agent.run`.

## Agent Skill

The `minimax-pet` Skill opens the app and guides the current Agent through creating custom pet artwork. It includes exact v1/v2 dimensions, animation and look layouts, alpha and metadata requirements, and a self-contained Node PNG validation tool. Files stay in the user workspace until import is confirmed; this does not add automatic Agent runs to the MiniApp.

## Bundled artwork

The default is an original MiniMax Pet character, with all nine animation states and sixteen look directions. Its atlas can be regenerated with Node.js from the source directory. The purple octopus plugin icon is a separate imagegen asset and is preserved when regenerating the atlas. See [ARTWORK.md](ARTWORK.md).

## Development

The complete editable source is at `sources/minimax-ai/minimax-pet/`. The installable package is self-contained at `plugins/minimax-ai/minimax-pet/`. See [PROVENANCE.md](PROVENANCE.md) for build and byte-comparison steps; developer notes and tests stay outside the distributed runtime payload.

## License

Original code, documentation, the bundled pet and icon: [MIT](LICENSE), Copyright 2026 MiniMax. The default atlas is generated from editable geometric drawing code; the octopus icon was generated with imagegen from a user-provided visual reference. See [ARTWORK.md](ARTWORK.md). No externally sourced pet spritesheet is bundled. User-imported artwork keeps its own license.
