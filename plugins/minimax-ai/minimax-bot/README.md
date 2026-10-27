# MiniMax Bot

Turn MiniMax Code into an always-on team of Bots. Create your own Bots, chat with them one-on-one, and pull them into groups to work together.

## Install and open

Requires MiniMax Code 3.1.2 or later. If MiniMax Bot is already installed from the MiniMax Code plugin marketplace, keep using that copy; do not install both.

Copy this directory, including the hidden `.minimax-plugin/` directory, into the MiniMax Code plugins directory as `minimax-bot/` (`~/.minimax/plugins/minimax-bot/` by default; see the root README of this repository for details). The `tests/` directory is not needed at runtime and can be left out. Restart MiniMax Code and ask the Agent to "Open MiniMax Bot". On first launch, Chief Bot greets you and helps set up your team.

## Features

- **Long-lived Bots**: every Bot has a name, a role, instructions and its own Agent session. When its setup, the team roster or its memory changes, the next turn automatically carries the latest context.
- **Chief Bot**: created on first launch to help you build your team. Chief can create, edit and delete Bots and groups; other Bots are refused when they try to do so.
- **Group chats**: the group admin answers by default. `@Name` calls on a specific member, and a Bot that `@`-mentions another member in its reply hands the turn over. Members with nothing to add reply `[PASS]` and are skipped. Each member keeps a separate session per group, and groups cannot see private chats. There is no fixed reply cap by default; a group can set one in the group settings. A group can also keep a short note of what it said, which survives clearing the chat. Discussions finish naturally, or wait for more instructions after repeated handoffs without tool progress.
- **Hand-offs between Bots**: `message_bot` hands work to another Bot and immediately returns an admission receipt; the completed result returns to the source chat. `post_group` is **private chat only**: it posts to a group and returns immediately while the discussion continues according to the group's reply mode. From a private chat, Chief can post to any group without joining it; other Bots can only post to groups they belong to. During a group turn, `post_group` is disabled for everyone, including Chief and admins, for both same-group and cross-group posts. Use `@Name` in a reply to hand off within the group; start cross-group work from a private chat.
- **Background work**: when an isolated execution context is useful, a Bot calls `start_helper` to run it in the background in a fresh, separate session; the Bot's turn ends at once and you can keep chatting. The Bot simply says something like "let me look into it" without internal jargon or IDs. When the job finishes, its report comes back to the Bot as a new turn, and the Bot reviews it and passes it on in its own words (in groups too, where it can keep handing off with `@`). At most 2 background jobs run at once (one slot is always kept free for chat) and the rest queue; each Bot can have at most 4 queued or running. Running jobs are shown above the chat input and can be stopped at any time; the strip orders them by how far along they are, the ones already working first, then the ones waiting for another job, then the queued ones; when more than three jobs are listed, it keeps the first three in the open and folds the rest into one line that says how many are left, and one button below the rows opens the whole queue; tool approvals from a background job appear in its chat; jobs still running when the Mini App restarts are marked interrupted. Bots can also manage jobs with `list_helpers` / `stop_helper`. "Allow background helpers automatically" is on by default in Bot settings; when off, a Bot only does so when you explicitly ask.
- **Per-Bot model and reasoning effort**: pick a model and reasoning effort in Bot settings (only the levels the model supports are listed, and thinking can be turned off where supported; Bots that follow the default model can still set their own effort). Chief can also set them with the `model` (a model ID, `provider/model` or display name; `default` follows the default) and `effort` (`low`, `high`, `off`, ...) parameters of `create_bot` / `update_bot`. Requires a MiniMax Code version with `agent.models()` / `run({ model })`; older versions prompt you to upgrade.
- **Images and files**: `<media src="…" />` and `![](absolute path)` in a Bot reply render as images, audio/video players or file cards. Local HTML/HTM cards open an isolated preview inside the Mini App; MD/Markdown cards show a formatted reading view (plain text above 2 MiB). The owning Mini App fetches the file so a regular browser tab does not lose Host authentication and show a blank 401 page. Failed loads show an error and Retry; files above 16 MiB can be saved with the preview toolbar’s Download action. Other files still download. Local files are served through `/api/media`, limited to paths the Bot referenced in that conversation. HTML previews allow page scripts and HTTP(S) styles and display resources in an isolated sandbox, without access to Bot storage, fetch API requests or form submissions. Other local files referenced by HTML are not exposed; embed those resources in the document. Remote links follow the destination server response.
- **Attachments**: attach files to your message; the Bot receives their local paths.
- **Memory**: one memory per Bot plus one shared by the team, holding only your explicit long-term needs, preferences and confirmed decisions. Research notes, prices, candidate lists and tentative recommendations stay in the conversation or in documents. Each scope stores up to 100,000 characters and 1,000 entries (1,200 characters per entry). Each turn, Bot and team entries share a 6,000-character context budget, chosen by pinned status, relevance to the current input and recency; entries not selected stay on disk. Suspected keys, passwords and ID numbers are refused, and every change is recorded in a journal. `remember` updates a topic by a stable `key` or `replace_id` with revision checks, so a stale write never overwrites newer memory; `recall` searches with pagination.
- **Scheduled tasks**: daily at a set time, at an interval, or once in N minutes, posted to the chosen Bot's private chat (only while the Mini App service is running). Create them in settings, or ask a Bot to schedule them: tasks created through `create_schedule` / `list_schedules` / `delete_schedule` show up in settings and in Bot details, and do not go into MiniMax Code's global scheduled tasks.
- **Usage**: per-Bot turns, reply length, tool calls and time spent over 24 hours / 7 / 30 / 90 days.
- **Looks**: 11 rendered looks (blue plush, bubble, pink glass, gold, jade, plush, waffle, pixel, smiley, toys, moon rock), stored in `miniapp/client/skins/`. A Bot's name and `@` mentions take the color of its look. The first Chief uses blue plush (matching the plugin icon); new Bots get the least-used look. Click "+" to import multiple pictures into a reusable local avatar library (each center-cropped to a 256 px square), or have Chief set `skin` / `avatar` with `update_bot`. Duplicate images are deduplicated, and a failed import does not stop the remaining files. Imported avatars stay available after refreshes, restarts, switching back to a built-in look or deleting a Bot.
- **Tasks**: the tasks button at the bottom of the icon bar lists running, awaiting-approval, finished and unfinished background jobs, keeping the latest 30 finished records. From there you can stop a job, open its session to handle approvals, jump to its result, or manage scheduled tasks.
- **Settings**: your avatar at the bottom of the icon bar shows the first letter of your name and opens settings (usage lives there too). Your name defaults to the system account's full name and can be changed under Settings → General → Your name.
- **Chat filters**: the icon bar switches between all chats, unread, groups and direct chats, with unread counts; your choice is remembered.
- **Language**: English and Chinese. By default it follows the operating system's preferred language (the first English or Chinese entry in `navigator.languages`; other languages fall back to English), or you can fix it under Settings → General → Language. The interface, errors, system notices, Chief's default setup, the context Bots receive and the MCP tool descriptions all switch; replies the Bots wrote and text you entered stay as they are.
- **Reactions**: react to finished Bot replies in private and group chats. The quick bar offers 👍 ❤️ 🙌 😂 😭 😮, and more emoji can be browsed by category or searched in English or Chinese. Each message holds one reaction: picking a new one replaces it, and picking the same one again removes it. Reactions are saved locally, survive refreshes and restarts, and sync to other open windows. They do not trigger a Bot reply and are not sent to the model.
- **Reply actions**: the reaction, copy, quote-reply and open-session buttons sit at the bottom-left of a reply, under its last line. A long reply therefore keeps its actions within reach at the end of the text instead of pushing them off the top of the message. The reaction indicator sits directly above that row and is painted with the app's own tag colours, so it follows the light and dark themes.
- **Working messages of one reply**: the Host records a text part for every turn a Bot takes between two tool calls, so a reply that worked for a while arrives with many parts, and the page draws one bubble per part. The bubbles keep the official shape and order, and a small gap between them tells them apart instead of letting them read as one block of text.

## 0.7.10 Optional group notes

- A group can keep a note of what it said. After every round the group records the closing lines of the replies, and every Bot of the group gets that record in its standing brief.
- The note is kept with the group settings, not with the messages. It is still there after the chat was cleared (**Start new chat**), and a Bot that joins the group later reads it too, so a group that was reset does not start from nothing.
- It is prompt text: the note is written from the replies the round already produced, so it costs no extra Agent turn, no extra tool call and no memory write.
- The note is a record, not an agreement. It says what the Bots said at the end of earlier rounds, and every Bot of the group is told exactly that in the prompt.
- The note is off unless you switch it on in the group settings, and a group without a note gets exactly the prompt it got before. Only you can set it: a Bot cannot switch it on, and the record itself is written by the plugin — a Bot cannot write into it.
- The note holds the most recent rounds and stays within a small size limit. The group settings show what was recorded, and you can clear it there. Switching the note off stops the recording and stops handing the record to the Bots, but what was already recorded stays until you clear it.

## 0.7.12 The group note, again, and background jobs that count

- A recorded line keeps its Chinese text. Cutting a line to its closing part used to trim up to the first space, and Chinese has no spaces, so a Chinese entry could lose almost all of itself. The trim now only drops a half Latin word, and never more than 20 characters.
- The protocol marks are matched in any spelling: a tag with spaces, with an attribute, in another case, or with a dash that looks like a hyphen is removed as well. The text around it is left alone, and Chinese punctuation is not rewritten.
- The group settings state the limits the plugin actually uses. The panel reads them from the server instead of writing down numbers of its own.
- A background job is an Agent turn like any other, so the usage panel counts it. Before, the panel showed fewer turns than the model actually ran: the job's own turn never reached the ledger, only the turn that relayed its report back.
- The job's row carries the time it took, the tools it called and the reply it produced, and it says how the job ended: a job that failed is an error, one that was stopped or cut off is aborted.

## 0.7.11 The group note, cleaned up

- Switching the note off no longer hides what was recorded. The group settings keep showing the record and its **Clear** button while the record exists, and say that the switch is off. The record itself is kept until you clear it, so switching the note back on hands the same record to the Bots again.
- The panel shows the same list the Bots read: the cleaned and bounded entries, not whatever the state file happens to hold.
- The protocol marks are now matched case-insensitively, and the marks of the standing-context block join the list of marks a reply may not forge. A reply that ends with such a tag can no longer close the context block early.
- A recorded line is cut on a word boundary, so it no longer starts in the middle of a word.

## 0.7.9 Optional relay guardrails for groups

- A group can set a hop limit in the group settings: how many Bots may speak in one relay chain. `0` (the default) means no limit, exactly as before; the largest limit is 20.
- When the limit is reached the chain stops there. The group gets a notice saying so, and the Bot that just spoke is asked to summarise instead of calling the next one. The blocked hand-off does not run, but the wrap-up is a turn of its own: a round that reaches the limit runs `limit + 1` Agent turns, the last one being the wrap-up.
- The limit counts every Bot that speaks in the round. In a group where every member replies (`reply_mode: all`), the first replies of the members already in the queue count towards it.
- A group can also hand the previous conclusion over to the next Bot: the next prompt carries the conclusion of the previous reply, so the next Bot does not have to dig the same ground out of the tools again. The previous reply is listed in the new messages anyway — the hand-over repeats its conclusion on purpose. It is prompt text — no extra turn, no extra tool call, no memory write.
- Both settings belong to the group and only you can set them. A Bot cannot change them: the MCP catalogue does not offer them, and a call that smuggles them in is ignored.

## 0.7.8 Safer automatic retries

- A failed turn is still retried automatically at most twice, after 8 s and 20 s.
- A failure marked `retryable: false` is never retried automatically, whether it was thrown or returned, and whatever its message says.
- A turn whose outcome is unknown (`AGENT_OUTCOME_UNKNOWN`) is never resent automatically: it may already have run, and resending it could repeat a reply or an action.

## 0.7.0 Reliable delegation and result delivery

Chat with your Bot as usual. It can ask other Bots for help while you keep chatting; completed results return here, and you can stop the work at any time.

- `message_bot` and `dispatch_tasks` both return durable admission receipts immediately. They use the same asynchronous execution path, without requiring a short/long-task classification. `start_helper` provides an isolated execution context when needed, without a tool-count rule.
- Reuse a stable `request_id` on retry: identical requests from the same caller return the original task; changed content conflicts. Batch dispatch requires the ID. Legacy `message_bot` and `post_group` calls may omit it, but then retries cannot be deduplicated. Task and deduplication records persist in `state.json`.
- Results return to the source chat for verification by the caller Bot. Only task outputs are forwarded, never full private-chat history. There are no custom result destinations, summarizers, user time budgets or separate resume controls. External host chats have no callback and must query `get_tasks`.
- A task that delegates to a helper or child task releases its execution slot and waits for the output. Verification and follow-up work retain the original task ID; an admission acknowledgment is not completion. Cancelling the parent also cancels linked work and verification turns. Existing side effects are not rolled back.
- Different Bots may run concurrently, while each private chat stays serial. Background dispatch uses at most two scheduler slots; chats, tasks and helpers share three Host slots. Queued work can be cancelled, and Host limits still apply.
- Group discussions have no fixed speaking-turn cap. Exact repeated handoffs without tool progress pause the discussion. Continue by sending an ordinary group message or asking the originating Bot to send more instructions; no task ID or resume action is required. `post_group` remains private-chat-only and retains membership checks.
- The task page is an auxiliary view for progress, opening the relevant chat/result, and stopping work. Safe group interruptions preserve the task and its result route. Waiting for local persistence also respects Stop. Pending members are persisted before a questionnaire or verification turn can report completion.
- After a restart, work that never started stays queued. Interrupted executions become `unknown` and are not replayed automatically. Persisted dependency results can be verified, but missing execution outcomes remain unknown. Stable result-message IDs prevent duplicate delivery; unconfirmed verification and summary turns are not automatically repeated.
- MCP SSE sends headers immediately and a keepalive every 15 seconds. Disconnecting does not cancel admitted work; `cancel_tasks` explicitly stops it. `get_tasks` can wait up to 20,000 ms for a state change and paginate full task results. `create_group` uses `name`, not `group`.

## 0.6.4 Custom avatars and batch import

- Custom avatars fit their containers in the chat list, chat header, details and settings.
- Import several images at once, reuse them across Bots, and scroll through a large saved library.
- Creating a Bot preserves its selected custom avatar when the preview is rendered.

Avatars are stored in the Mini App's `dataDir/avatars/`. `GET /api/avatars` lists reusable file names; `POST /api/avatars` accepts one resized image data URL and saves it atomically. Batch import sends one request per file. A Bot's `avatar` accepts a library file name, a data URL or a local image path; `null` / `default` clears its selection without deleting the library file.

## Follow-ups adjust the current reply

- While a Bot is replying, just send a follow-up and it adjusts the current task; no extra button is needed. Follow-ups sent while the old reply is winding down are merged in order into the next turn (up to 20 messages and 60,000 characters per batch; larger amounts are split in order). Attachments and original messages are kept individually. Group chats run user turns in order with the same mention rules.
- The follow-up is saved first; then the current reply is cancelled, and once the host confirms that turn has ended, the follow-up is handled in the same session. A request already submitted to the host is never sent again; if cancellation wins before the original request was submitted, its content is included in the next turn.
- This is "interrupt and continue", not a native steer that injects input into a running turn. Actions already taken are not rolled back, and background jobs keep running.
- If cancellation or the outcome cannot be confirmed, the follow-up is held with "Not yet confirmed safe to continue" and is not resent automatically. After checking the full session and answering any pending questionnaire, click "Continue with follow-ups"; this submits only the unprocessed follow-ups and never replays a request whose outcome is unknown.
- Delivery states are saved with each message and synced across windows. After an unexpected restart, a message that was processing with a reply placeholder is marked as uncertain, and a follow-up that was being adjusted is kept for confirmation.

## Reliability

- Full history is kept locally. The page loads the latest 200 messages first and can page back through older ones; Copy as Markdown covers the whole history.
- Messages carry stable increasing sequence numbers. A group member only advances past the snapshot that was actually submitted to the host, so messages arriving during its reply are not skipped.
- Sending is de-duplicated per chat, and retries of the same content and attachments reuse the same submission ID. After a crash, only requests that clearly never started are recovered; when a reply placeholder exists but the host outcome is unknown, the request is reported as `delivery_uncertain` and the draft is kept, so tasks with side effects are not run twice.
- Failed turns are retried automatically (after 8 s and 20 s), and a retry button is shown afterwards; if a message never reached the Bot, retry resends it.
- Memory writes use a recoverable transaction covering the entry and its journal; an interrupted write returns `memory_pending` and is completed by a read, retry or restart without double counting. Before the first change to an existing scope, the original file is backed up to `dataDir/memory/backups/`.

## 0.6.5 Execution records and outcome notices

- Open **Execution records** from the chat header to inspect tool calls and turn errors in the details drawer. Calls are grouped by reply and tool name, with each failed, successful or unconfirmed attempt retained. Older records can be loaded, group replies identify their Bot, and the full-session link opens that reply's own session.
- Individual tool errors no longer interrupt the conversation or produce toasts. A failed turn keeps one short outcome notice and its safe retry action. Settled replies with unconfirmed memory saves keep one notice, details and memory management. Approvals, questionnaires and message delivery actions remain available where needed.
- Only a receipt for the same scope and memory topic clears its notice. Another successful call with the same tool name does not prove recovery. Historical failures remain in records; the subtle header indicator only reflects each participant's latest reply.
- Bot reply guidance asks for the final delivery impact and any action needed from the user, without narrating recovered intermediate failures. Missing evidence stays unconfirmed, and the UI does not automatically replay side-effecting operations. This guidance is not real-model acceptance evidence.
- Streaming updates retain expanded records, keyboard focus, scroll position, media and input drafts. Narrow windows reuse the existing full-width drawer; close it with its controls or Escape.

## How it runs

- The Node service (`miniapp/node/server.mjs`) uses only Node built-in modules, runs Bot turns through `context.agent`, and stores data in the host-assigned `dataDir`.
- The page (`miniapp/client/`) is build-free native ES modules and loads no remote resources.
- The same Node process serves Streamable HTTP MCP at `/mcp/minimax-bot`, exposing `list_team`, `message_bot`, `dispatch_tasks`, `get_tasks`, `cancel_tasks`, `post_group`, `start_helper`, `list_helpers`, `stop_helper`, `remember`, `forget`, `recall`, `create_bot`, `update_bot`, `delete_bot`, `create_group`, `update_group`, `delete_group`, `create_schedule`, `list_schedules` and `delete_schedule` to Bots.
- `miniapp.json` declares `agentAccess: ["session.run"]`. Tool approvals and questionnaires from Bots are rendered in the page, and the full session can be opened in the MiniMax Code sidebar.

## Tested environment

- MiniMax Code 3.1.2 on macOS and Windows, and MiniMax Code 3.1.4 on Linux. Earlier versions cannot install this package, because it declares `agentAccess` and `surface.window`.

## Data & access

- **Agent turns**: every Bot reply, scheduled task and background job is an Agent turn run through `context.agent`, with the Agent's full capabilities (files, shell, Skills and MCP, including this plugin's own MCP tools). A tool call that needs approval is shown in the page or in the session's sidebar tab; it runs only after you choose **Allow once**. Nothing is approved automatically. A group with a relay limit spends one more Agent turn on the round that reaches the limit: the wrap-up, which replaces the blocked hand-off. A group note spends no turn at all: it is written from the replies the round already produced. Every turn is counted once in the usage panel, background jobs included.
- **Files written**: only inside the Mini App's `dataDir`: `state.json`, `messages/`, `usage.jsonl` (one row per Agent turn), `memory/` (including its journal, archive and backups), `uploads/` (your attachments) and `avatars/`. A group's note is part of that group's record in `state.json`, so it is removed with the group.
- **Files read outside `dataDir`**:
  - `/api/media` serves a local file (up to 1 GiB) only when its absolute path appears in a Bot message of that same chat.
  - An avatar given as a local image path (by you or by Chief through `update_bot`) is read once and copied into `avatars/`.
- **Processes**: on macOS, runs `id -F` once (1.5 s timeout) to read your account's full name as the default display name. No other processes are started by the plugin itself.
- **Network**: the Node service makes no outbound requests, and the page loads no remote resources. HTML previews may load the HTTP(S) styles and resources that the previewed document references, inside an isolated sandbox.
- **Environment**: reads `LC_ALL`, `LC_MESSAGES` and `LANG` to choose the default language.

## Tests

The `tests/` directory holds unit and integration tests that use a mock Agent, isolated temporary data, jsdom and local HTTP/SSE. Run them from this plugin's directory with Node.js 22 or later:

```bash
npm ci --prefix tests --ignore-scripts --no-audit --no-fund
node --test tests/*.test.mjs
```

They do not replace testing in the MiniMax Code desktop app with a real model.

## Known limitations

- The host Agent API cannot filter the MCP catalog per conversation. Group context omits the `post_group` usage prompt and explicitly disables it, while the server continues to reject group-origin calls. The tool may still appear in the shared catalog, where its description marks it as private chat only. Existing group sessions receive the updated context on their next `agent.run`.

- The host does not provide token counts to Mini Apps, so usage is measured in turns and characters.
- `caller_bot_id` in MCP calls is self-reported by the Bot; permission checks are behavioral constraints, not a security boundary.
- The plugin manifest (name, description, example queries) does not support multiple languages, so the marketplace shows English only.

## Acknowledgements

The interaction and product design draw on the team, group chat, Chief Bot and memory design of the community project [DeepSeek Bot](https://github.com/FeiZhuLulu/DeepSeek-Bot) (Apache-2.0). This plugin is an independent implementation and contains none of its code.

## License

[MIT](./LICENSE)
