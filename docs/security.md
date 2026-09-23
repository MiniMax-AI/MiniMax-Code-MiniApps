# Mini App security rules

Verified against MiniMax Code 3.0.73.

## Process boundary

- Bind only `context.listen.host` and `context.listen.port`. Serve `surface.path` and your own
  routes; do not proxy arbitrary URLs or arbitrary files.
- Validate every request parameter. Treat the page as untrusted input to the Node process.
- Secrets stay in the Node process. Never place credentials in HTML, Client JavaScript, log
  messages, or error responses.

## State

- Store durable state under `context.dataDir`.
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
