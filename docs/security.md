# Mini App security rules

Verified against MiniMax Code 3.1.11.

## Process boundary

- Bind only `context.listen.host` and `context.listen.port`, with a `node:http` server. Serve
  `surface.path` and your own routes; do not proxy arbitrary URLs or arbitrary files.
- The Host authenticates every request to that port (see "Loopback authentication" in
  `docs/runtime.md`). Do not add another scheme that expects or forwards the Host's credential, and
  do not log request headers.
- Keep routes out of the Host-reserved `/__mavis/` prefix.
- Validate every request parameter. Treat the page as untrusted input to the Node process.
- Secrets stay in the Node process. Never place credentials in HTML, Client JavaScript, log
  messages, or error responses.

## State

- Store durable state under `context.dataDir`, and write it as it changes: while the Mini App is
  not visible the Host may stop its process or reload its page without notice (see "Lifecycle" in
  `docs/runtime.md`).
- Browser storage may hold view preferences (filters, sort order, expanded rows), not domain data.

## Writing outside `dataDir`

A Mini App that edits Host or user files must document, in its README, which files it writes and
how. Write atomically (temp file in the same directory, then rename), preserve the original file
mode, serialize concurrent writes, and make Undo refuse when the file changed underneath it. Back up
before bulk edits and say where the backups go.

## Spawning processes

Disclose every command in the README. Pass arguments as an array, never through a shell, and never
place user input in a command line.

## Network

Disclose every outbound host in the README. The default is none.

## Agent turns

An Agent run by a Mini App (`agentAccess`, see `docs/agent.md`) can read and write files, run
shell commands, and call MCP tools.

- Declare `agentAccess` only when the Mini App needs it, and state in the README `## Data & access`
  that it runs Agent turns and what it asks them to do.
- Leave approvals to the user. Show every `permission.requested` to the user and send `allowOnce`
  only after they choose it, or `open` the session so they can decide in the chat side panel. Never
  answer `allowOnce` automatically.
- Text from the page, files, or the network is untrusted. Build prompts from your own instructions
  plus that text clearly marked as data, and validate anything the Agent returns before acting on it.

## Reading the user's conversations

`"session.read"` lets the Mini App read the title, project directory, and final reply of every turn
in every user conversation.

- Declare it only when following the user's conversations is the Mini App's purpose, and say so in
  the plugin `description` and the README `## Data & access`.
- Keep what you read on the user's machine. Do not log it, send it to a network host, or store more
  of it than the Mini App shows, unless the user asked for that.

## Calling tools

`toolAccess` lets the Node entry call the MCP and Connector tools the user has installed (see
`docs/tool.md`).

- List in the README `## Data & access` which tools the Mini App calls and what for.
- Every call goes through the user's permission rules. Do not try to work around a `deny` or an
  unanswered prompt, and ask for "always allow" with `request()` only from a user action, for the
  tools the Mini App needs.
- Treat tool results as untrusted input, like any network response.

## Microphone and camera

`deviceAccess` `"microphone"` and `"camera"` let the page record the user. The Host shows no
indicator for either.

- Say in the README `## Data & access` when the Mini App records audio or video, and where it goes:
  the Host's speech recognition, a network host, or a file.
- Record only after a user action, show that recording is on, and stop the tracks as soon as the
  page is done with them.

## System notifications

`deviceAccess: ["notifications"]` lets the page show notifications as MiniMax Code. They can stay in
the system notification center after the Mini App closes and can appear on the lock screen.

- Say in the README `## Data & access` what the Mini App notifies about.
- Notify only about what the user asked to hear about. Keep secrets, and the content of the user's
  files and conversations, out of the notification text.

## Host navigation

`hostAccess: ["navigation.read"]` tells the page which part of MiniMax Code the user is on (home, a
conversation, plugins, schedule, or settings), never which conversation.

- Declare it only when the Mini App reacts to where the user is, and say what for in the README
  `## Data & access`.
- Keep what you read on the user's machine, like conversations read with `"session.read"`.
