# MiniMax Pet

English | [简体中文](README.zh-CN.md)

A lightweight desktop companion for MiniMax Code, by **MiniMax**. It shows visible conversation activity, answer-needed reminders and recent results without creating another chat. The interface is currently in Chinese.

## Features

- **Appearance:** preview and select pets, import compatible pet JSON and spritesheets, and remove imported pets.
- **Tasks:** recent reminders, visible user conversations, and a scrollable latest reply. Desktop cards preview up to five lines. Clicking a card keeps the pet visible; observed `ask_user` calls show “需要你回答” (needs your answer).
- **Open the conversation:** on MiniMax Code 3.1.11 or later, a task's detail, in the panel and on the desktop, has a **打开对话** (open conversation) button, labelled **去回答** (go answer) while the task needs an answer. It brings the MiniMax Code main window forward on that conversation. Older clients do not show the button.
- **Settings:** pet size, page-local reminder dismissal and mute, connection status, and reconnect.
- **Desktop window:** a draggable transparent pet with compact notification cards. Return it to the main panel to use the three tabs.
- **Theme:** on MiniMax Code 3.1.11 or later the panel and desktop cards follow the client's light or dark theme; older clients follow the system setting.

The pet does not run Agent turns, create independent chats, write to chat inputs, comment on every session, stop tasks, or answer questionnaires. Selecting a task only reads its details; the main window switches only when you click **打开对话** or **去回答**.

Version **0.6.0** removes the **打招呼** (wave) and **跳一下** (jump) actions from the menu and the appearance page, and removes the original-chat draft with its voice input; the package no longer requests the microphone. It adds **打开对话** / **去回答** and the client theme. The supported baseline stays MiniMax Code 3.1.6: both additions are feature-detected and need no new access.

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
- **打开对话** / **去回答** uses `host.navigation.open` and the theme uses `host.ui.subscribe`, both added in MiniMax Code **3.1.11**; on 2026-11-10 the macOS and Windows installers of 3.1.11 answered on both production CDNs. Both calls were checked against the MiniMax Code source: opening a conversation the Mini App already holds needs no `hostAccess` and no extra grant, must start inside a click, and brings the main window forward.
- An earlier UI version was exercised on macOS in a MiniMax Code development build: three tabs, wide/narrow layouts, task reading, real session/ask activity, import/delete, and desktop round trips. Version 0.6.0 has Node/DOM tests (including the open and theme paths against a simulated Host), an isolated HTTP smoke test, and a browser check of the panel layout outside the Host.
- The default atlas is checked by actual PNG decoding, frame coverage and deterministic rebuild tests. The separate octopus icon is checked by PNG decoding and visual review. On 2026-10-26, the packaged Skill was exercised with a real Agent in the macOS development build to create, validate, preview and import a custom v2 pet; all nine animation previews and the four cardinal mouse-look directions were checked. This does not replace released-client acceptance.
- Not verified for 0.6.0: opening a conversation or following the theme inside a real MiniMax Code 3.1.11+ window (panel or desktop pet), any Windows GUI, and released-client installation or GUI acceptance on 3.1.6. Automated tests use synthetic data and do not prove those paths.

## Data & access

- **Conversation data:** requests only `session.read`. Reads visible user-conversation metadata, status and a selected conversation's latest reply through the public Host API. It does not read the Host database, logs, configuration, credentials or private files. Conversation state and reminders stay in page memory.
- **Observations:** one global observer aggregates visible task lifecycle events. Up to three detailed observers follow active tasks and detect new ask tool events. A completed/removed task releases its detailed slot; another task enters only after the previous subscription settles. The initial snapshot contains up to 50 recent visible conversations; observed tasks remain while the Host confirms visibility.
- **Coverage limits:** observers are tail-only. They cannot reconstruct questionnaires opened before subscribing or during a disconnect. More than three active tasks means only three receive detailed ask coverage. No observed ask does not prove no pending question. Historical idle tasks are not presented as newly completed.
- **Local files:** the Node service serves packaged assets and stores preferences and user-imported JSON/WebP/PNG spritesheets under opaque `context.dataDir`. Imports, replacement recovery and deletion are limited to that plugin data. Browser storage is used only to migrate old view preferences.
- **Host navigation:** only when you click **打开对话** or **去回答**, the page calls `host.navigation.open({ id: 'session', sessionId, source: 'local' })` for a conversation it already lists through `session.read`. It does not declare `hostAccess` and never reads which page of MiniMax Code you are on. It writes nothing to chat inputs and sends no message.
- **Display preferences:** `host.ui.subscribe` reports the client theme, which the page applies; the reported language is ignored. No grant is involved.
- **Network:** the plugin has no hard-coded external runtime endpoint; its own HTTP requests use its assigned loopback origin.
- **Microphone, camera and notifications:** not used and not declared.
- **Processes and Agent turns:** the Host starts one Node process. The plugin spawns no additional runtime process, launches no shell command, offers no MCP server, and never calls `agent.run`.

## Agent Skill

The `minimax-pet` Skill opens the app and guides the current Agent through creating custom pet artwork. It includes exact v1/v2 dimensions, animation and look layouts, alpha and metadata requirements, and a self-contained Node PNG validation tool. Files stay in the user workspace until import is confirmed; this does not add automatic Agent runs to the MiniApp.

## Bundled artwork

Four pets are bundled. The default is the MiniMax Pet mint robot, whose atlas can be regenerated with Node.js from the source directory. The second is “MiniMax Code 章鱼娘” (`minimax-tako`), a pink-haired octopus girl generated with MiniMax image generation and assembled into the v2 atlas, and the third is 麦芽糖 (`octopus-girl-v2`). The fourth is “MMX 章鱼娘” (`mmx-octopus`), a contributed character that ships the v1 atlas: all nine animation rows and no look directions. The purple octopus plugin icon is a separate imagegen asset and is preserved when regenerating the atlas. See [ARTWORK.md](ARTWORK.md).

Version **0.5.10** also includes **Maiyatang (麦芽糖)**, an optional coral-pink chibi octopus girl. Select her in **外观 → 选择宠物**; the mint robot remains the default. She has all nine animation states and sixteen look poses in the existing v2 format. Her Chinese self-introduction appears under the preview. She uses the existing player timing, including the slow six-frame idle cycle, without new permissions or runtime behavior. The atlas was validated and imported through the local plugin UI on Linux; this does not establish bundled-install or desktop-window acceptance on released clients. See [ARTWORK.md](ARTWORK.md) for the AI-generation workflow and contributor license.

## Development

The complete editable source is at `sources/minimax-ai/minimax-pet/`. The installable package is self-contained at `plugins/minimax-ai/minimax-pet/`. See [PROVENANCE.md](PROVENANCE.md) for build and byte-comparison steps; developer notes and tests stay outside the distributed runtime payload.

## License

Original code, documentation, the robot, minimax-tako pet and icon: [MIT](LICENSE), Copyright 2026 MiniMax. Maiyatang artwork: MIT, Copyright 2026 Fectivnfy112357. The minimax-tako atlas was generated with MiniMax image generation. The default atlas is generated from editable geometric drawing code; the octopus icon and Maiyatang were generated with imagegen from supplied visual references. See [ARTWORK.md](ARTWORK.md). No externally sourced pet spritesheet is bundled. User-imported artwork keeps its own license.
