# Mini App package contract

Verified against MiniMax Code 3.1.6.

A Mini App is a MiniMax Plugin whose `package.json` declares a Mini App payload. MiniMax Code
enforces the manifest, payload, and path rules below when the package is installed. `npm run check`
enforces the same rules here, plus this repository's own requirements: `README.md` and `LICENSE`,
a real image file behind `icon`, `lifecycle` limited to `on-demand`, no hard links, no committed
`node_modules`, routes outside the Host-reserved `/__mavis/` prefix, the Node entry conventions in
`docs/runtime.md`, a stated minimum client version for newer features (see
[Minimum client version](#minimum-client-version)), and code that only calls what the manifest
declares (see [Declared access must match the code](#declared-access-must-match-the-code)).

## Layout

```text
<plugin-id>/
  .minimax-plugin/plugin.json   Plugin manifest: identity, icon, category, declared capabilities
  package.json                  Mini App declaration (see below)
  icon.png                      Plugin icon (PNG, JPEG, or WebP)
  miniapp/
    miniapp.json                Payload roots, Node entry, page route
    client/                     Runtime payload: files served to the page
    node/                       Runtime payload: the Node entry and what it imports
  README.md                     Required by this repository
  LICENSE                       Required by this repository
  README.zh-CN.md               Optional
  tests/                        Optional; keep outside miniapp/
  skills/<name>/SKILL.md        Optional plugin capability
  agents/<name>.md              Optional plugin capability (MiniMax Code 3.1.2 or later)
  *.mcp.json                    Optional plugin capability
  bindings/<name>.binding.json  Optional plugin capability
```

The directory name, `plugin.json.name`, and the installed plugin ID are the same string. It must be
unique across this repository because the author directory is dropped at install time.

Git does not keep empty directories. Every path listed under `artifacts` must contain at least one
committed file.

## `.minimax-plugin/plugin.json`

| Field | Rule |
| --- | --- |
| `$schema` | Optional string. |
| `schemaVersion` | The number `1`. |
| `name` | At most 80 characters, matches `^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$`, equals the directory name. |
| `displayName` | Optional non-empty string. |
| `version` | SemVer 2.0, at most 128 characters. |
| `description`, `author` | Non-empty strings. |
| `icon` | Relative path with a lowercase `.png`, `.jpg`, `.jpeg`, or `.webp` extension; the file must exist and be a real image. |
| `darkIcon` | Optional; same rules as `icon`. |
| `category` | One of `Office`, `Studio`, `Design & Sites`, `Code`, `Business`, `Sales`, `Productivity`, `Science & Healthcare`, `Education`, `Other`. |
| `exampleQueries` | Array of non-empty strings. Provide at least one; the Agent uses them to open the Mini App by name. |
| `apps` | Array of `*.app.json` paths. Locally installed packages ignore this field; use `[]`. |
| `mcpServers` | Array of `*.mcp.json` paths; each file must exist. These are MCP servers the plugin offers to the Agent, distinct from `mcpEndpoints` in `miniapp.json`. |
| `skills` | Array of `skills/<name>/SKILL.md` paths; each file must exist. |
| `hooks` | Optional array of `*.json` paths; each file must exist. Contents are validated by MiniMax Code at install time. |
| `hostBindings` | Optional array of `bindings/<name>.binding.json` paths; each file must exist. Contents are validated at install time. |
| `agents` | Optional array of `agents/<name>.md` paths (`<name>` matches `^[a-z][a-z0-9_-]*$`); each file must exist. Subagents the plugin adds; contents are validated at install time. Requires MiniMax Code 3.1.2 or later. |
| `hostCapabilities` | Rejected. Host capabilities come only from Host Bindings. |
| Any other field | Rejected. MiniMax Code 3.1.2 and later ignore unknown fields, but earlier clients reject the whole package. |

Use `[]` for `apps`, `mcpServers`, and `skills` when the package has none.

## `package.json`

The `mcode` field must be exactly:

```json
{
  "mcode": {
    "schemaVersion": 2,
    "miniApp": "./miniapp/miniapp.json"
  }
}
```

No other keys are allowed inside `mcode`. Other top-level keys (`name`, `type`, `scripts`) are fine.

## `miniapp/miniapp.json`

```json
{
  "schemaVersion": 1,
  "artifacts": {
    "client": ["./miniapp/client"],
    "node": ["./miniapp/node"]
  },
  "runtime": {
    "kind": "process",
    "entry": "./miniapp/node/server.mjs",
    "lifecycle": "on-demand"
  },
  "surface": { "path": "/dashboard" },
  "mcpEndpoints": []
}
```

- `schemaVersion` is `1`. Unknown top-level fields are rejected: MiniMax Code 3.1.5 and later report
  `MINIAPP_MANIFEST_FIELD_UNSUPPORTED` naming the field, which on an installed client means the
  client is older than the package; earlier clients report `MINIAPP_MANIFEST_INVALID`.
- `artifacts.client` and `artifacts.node` are non-empty arrays of unique paths under `miniapp/`.
  Each path must exist. These are the runtime payload roots: exactly what MiniMax Code hashes and
  installs. Any `node_modules` directory is excluded from payloads.
- `runtime.kind` is `process`. `runtime.entry` ends in `.js`, `.mjs`, or `.cjs`, exists, and lies
  inside one of `artifacts.node`. Use `.mjs`: this repository checks the entry for an ESM `start`
  export (see `docs/runtime.md`). `runtime.lifecycle` is `on-demand` or omitted.
- `surface.path` is the route the Node entry serves the page on. It is relative to the Host and
  must not contain an origin, query, fragment, or backslash. A missing leading `/` is added.
- `surface.window` is optional; see [`surface.window`](#surfacewindow).
- `mcpEndpoints` is an array of `{ "server": string, "path": string }`. `server` matches
  `^[a-zA-Z0-9_-]{1,128}$` and must name a server declared through `plugin.json.mcpServers`; MiniMax
  Code checks that reference at install time. `server` and `path` are each unique. Use `[]` when
  there are none.
- No route (`surface.path` or an MCP endpoint `path`) may be `/__mavis` or start with `/__mavis/`.
  The Host owns that prefix and answers some of it itself.
- `hostConnectorAccess` is optional: `{ "providers": string[] }`, each matching
  `^[a-z0-9_-]{1,64}$` and unique. Declared providers are granted by the Host at install time; this
  repository does not document their use.
- `agentAccess` is optional: an array of `"session.run"` (run Agent turns) and `"session.read"`
  (list, read, and observe the user's own conversations). Neither implies the other; declare both
  when the Mini App needs both. Absent or `[]` means no Agent access. See `docs/agent.md` before
  declaring it. Requires MiniMax Code 3.1.2 or later; `"session.read"` requires 3.1.5 or later.
- `agentConcurrency` is optional: an integer from 1 to 32, default 4. It caps how many Agent turns
  of this Mini App run at once; it has no effect without `agentAccess`. Requires MiniMax Code 3.1.2
  or later.
- `toolAccess` is optional. The only allowed value is `["call"]`, which gives the Node entry
  `context.tool` to call the MCP and Connector tools installed on the user's MiniMax Code, each call
  judged by the user's permission rules. See `docs/tool.md`. Requires MiniMax Code 3.1.5 or later.
- `deviceAccess` is optional. The only allowed value is `["microphone"]`, which lets the page call
  `getUserMedia({ audio })` and `window.mcode.miniapp.speech.transcribe` (see `docs/client.md`).
  Requires MiniMax Code 3.1.5 or later.
- `engines` is optional: `{ "mcode": ">=MAJOR.MINOR.PATCH" }`, nothing else. A client at 3.1.5 or
  later but older than the bound keeps the plugin with its Skills and MCP servers, and withholds
  the Mini App. Clients before 3.1.5 do not know the field and reject the whole package, so the
  bound only matters above 3.1.5. Write it only when the package needs a specific newer client; it
  is not required for the features in the table below. Requires MiniMax Code 3.1.5 or later.

### Permission switches

From MiniMax Code 3.1.5 the user can switch off, item by item in the plugin details, what the
manifest declares: each `hostConnectorAccess` provider, each `agentAccess` value, `toolAccess`
`"call"`, and `deviceAccess` `"microphone"`. Everything starts on, with no first-use prompt. A switch
applies at once and does not restart the Mini App: `context.agent` and `context.tool` stay present,
and their calls fail until the user switches the item back on:

| Switched off | What fails |
| --- | --- |
| `session.run` | Running turns end as `aborted`; `run`, `reply`, `answer`, `cancel`, `open`, `models`, `agents`, `create` fail with `NOT_PERMITTED` (`not_permitted` on the page). |
| `session.read` | Observers end; `sessions()`, `observe({ all: true })`, and reading or observing the user's sessions fail the same way. |
| `tool:call` | `context.tool.call` fails with `TOOL_NOT_PERMITTED`; `list()` reports every tool as `deny`. |
| `microphone` | The next `getUserMedia` fails with `NotAllowedError` and `speech.transcribe` with `not_permitted`; a recording already open keeps its stream until the page stops it. |

Handle these errors where the call is made and explain in the page what the user can turn back on.
`surface.window` flags are not switches.

### `surface.window`

Optional. It declares the window MiniMax Code opens when the user pops the page out of the side
panel into its own window. Requires MiniMax Code 3.1.2 or later.

```json
{
  "surface": {
    "path": "/dashboard",
    "window": {
      "width": 960,
      "height": 700,
      "minWidth": 480,
      "minHeight": 360,
      "resizable": true,
      "frame": true,
      "transparent": false,
      "alwaysOnTop": false,
      "skipTaskbar": false,
      "clickThrough": false
    }
  }
}
```

| Field | Rule | Default when omitted |
| --- | --- | --- |
| `width`, `height` | Integer from 200 to 10000. | The page's last size in the side panel. |
| `minWidth`, `minHeight` | Integer from 200 to 10000; not larger than `width` / `height` when both are given. | `480` / `360` |
| `resizable` | Boolean. | `true` |
| `frame` | Boolean. | `true` |
| `transparent` | Boolean. `true` requires `frame: false`. | `false` |
| `alwaysOnTop` | Boolean. Also the ceiling for turning it on from the page at runtime. | `false` |
| `skipTaskbar` | Boolean. | `false` |
| `clickThrough` | Boolean. Mouse events pass through to whatever is underneath; the page still receives mouse moves. Also the ceiling for turning it on from the page at runtime. | `false` |
| Any other field | Rejected. Title, position, parent window, and close behaviour are always set by the Host. | |

The window never opens at launch: it opens when the user pops the page out, or when the page
switches to it from a user gesture through `window.mcode.miniapp.window` (see `docs/client.md`).
Closing it, or Cmd/Ctrl+W, returns the page to the side panel.

## Minimum client version

Clients older than the version below reject the whole package when it declares the feature, so
the package cannot be installed there at all.

| Feature | Declared in | Minimum MiniMax Code |
| --- | --- | --- |
| `agents` | `plugin.json` | 3.1.2 |
| `agentAccess` | `miniapp/miniapp.json` | 3.1.2 |
| `agentAccess` with `"session.read"` | `miniapp/miniapp.json` | 3.1.5 |
| `agentConcurrency` | `miniapp/miniapp.json` | 3.1.2 |
| `deviceAccess` | `miniapp/miniapp.json` | 3.1.5 |
| `engines` | `miniapp/miniapp.json` | 3.1.5, or its own bound when higher |
| `surface.window` | `miniapp/miniapp.json` | 3.1.2 |
| `toolAccess` | `miniapp/miniapp.json` | 3.1.5 |

A 3.1.4 preview build accepted `"session.read"`, but the released 3.1.4 rejects it.

The package's minimum is the highest entry it declares. When it has one, name a MiniMax Code
version at or above it under `## Tested environment` in its README, for example
`- MiniMax Code 3.1.5 on macOS 15`. `npm run check` warns until it finds one there.

To use a newer page or Node API only where it exists, without raising the minimum, feature-detect
it: `capabilities?.has('agent.observe')` (MiniMax Code 3.1.5 and later), or test that the method
exists. A manifest field cannot be feature-detected: declaring it is what raises the minimum.

## Declared access must match the code

`npm run check` scans the files that run in the page or in Node (`.js`, `.mjs`, `.cjs`, `.html`
under `artifacts.client` and `artifacts.node`, outside `node_modules`) for calls that need a grant
the manifest does not make, and reports them as `ACCESS_UNDECLARED`.

| Call | Needs | Level |
| --- | --- | --- |
| `context.agent.*` or page `agent.*` | `agentAccess` | error |
| `agent.sessions()`, `agent.observe({ all: true })`, page `agent.session()` without an id | `agentAccess` `"session.read"` | error |
| `context.tool.*`, page `tool.request()` | `toolAccess: ["call"]` | error |
| `speech.transcribe()` | `deviceAccess: ["microphone"]` | error |
| `getUserMedia()` | `deviceAccess: ["microphone"]` | error when the package's minimum is 3.1.5 or later; warning otherwise |

The first four never work without the grant, on any client. `getUserMedia` worked without a grant
before MiniMax Code 3.1.5, and 3.1.5 and later deny it with `NotAllowedError`. A package whose
minimum is below 3.1.5 still installs on those earlier clients, so the check only warns; declaring
`deviceAccess` fixes the call and raises the minimum to 3.1.5. Camera, geolocation, notifications,
and every other permission a browser would prompt for are denied to Mini App pages on 3.1.5 and
later and cannot be declared yet.

The scan matches source text, so it misses calls through a renamed variable and can flag dormant
code, such as an engine's audio input that the app never turns on. Explain a warning in the pull
request instead of declaring a permission the app does not use.

## Portable paths

Every path inside the package, and every path written in a manifest, must be portable:

- ASCII only; each segment matches `[A-Za-z0-9._-]+` and does not end with `.`.
- No `.` or `..` segments, no backslashes, no leading or trailing `/`, no control characters.
- Each segment at most 128 bytes; the whole path at most 512 bytes and at most 16 segments.
- A segment's part before its first `.` must not be a Windows reserved name (`con`, `prn`, `aux`,
  `nul`, `com1`–`com9`, `lpt1`–`lpt9`).
- No symbolic links or hard links anywhere in the package, and the package directory itself is not
  a symbolic link.

## Package limits

At most 1024 files, 16 MiB per file, and 64 MiB in total.

## Runtime payload

Only `artifacts.client` and `artifacts.node` become the runtime payload. Keep tests, docs, and
source-only files outside `miniapp/`. Vendor any third-party runtime code inside a payload root;
`node_modules` is never committed to this repository.
