# Hello Mini App (`hello-miniapp`)

The smallest package that MiniMax Code accepts as a Mini App: one Node entry that serves one static
page. Copy this directory to `plugins/<your-github-username>/<plugin-id>/` and replace `name`,
`displayName`, `description`, `author`, `exampleQueries`, the page, this README, and the LICENSE
holder.

## Install

Copy this directory, including the hidden `.minimax-plugin/`, into the MiniMax Code plugins
directory as `hello-miniapp/` (`~/.minimax/plugins/hello-miniapp/` by default; the root README's
Install section explains where that directory is). Restart MiniMax Code and ask the Agent to
"Open Hello Mini App".

## Tested environment

- MiniMax Code 3.0.73 on macOS. Installed from this directory, opened through the Agent, page
  rendered.

## Data & access

- Files: reads only its own `miniapp/client/index.html`. Writes nothing.
- Network: none.
- Processes: none.
- State: none stored.

## Files

```text
.minimax-plugin/plugin.json   Plugin manifest
package.json                  Mini App declaration
miniapp/miniapp.json          Payload roots, Node entry, page route
miniapp/client/index.html     The page served at /dashboard
miniapp/node/server.mjs       Node entry: start(context) → { dispose }
miniapp/node/miniapp-api.ts   Type declarations for the runtime context
icon.png                      Plugin icon
```

## License

[MIT](./LICENSE)
