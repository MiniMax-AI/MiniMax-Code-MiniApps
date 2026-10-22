# Mini App package contract

Verified against MiniMax Code 3.1.2.

A Mini App is a MiniMax Plugin whose `package.json` declares a Mini App payload. MiniMax Code
enforces the manifest, payload, and path rules below when the package is installed. `npm run check`
enforces the same rules here, plus this repository's own requirements: `README.md` and `LICENSE`,
a real image file behind `icon`, `lifecycle` limited to `on-demand`, no hard links, no committed
`node_modules`, routes outside the Host-reserved `/__mavis/` prefix, the Node entry conventions in
`docs/runtime.md`, and a stated minimum client version for newer features (see
[Minimum client version](#minimum-client-version)).

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

- `schemaVersion` is `1`. Unknown top-level fields are rejected.
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
  (read sessions: the page's `agent.session()` returns the chat it is open in, see `docs/agent.md`).
  Absent or `[]` means no Agent access. See `docs/agent.md` before declaring it. Requires MiniMax
  Code 3.1.2 or later; `"session.read"` requires 3.1.4 or later.
- `agentConcurrency` is optional: an integer from 1 to 32, default 4. It caps how many Agent turns
  of this Mini App run at once; it has no effect without `agentAccess`. Requires MiniMax Code 3.1.2
  or later.

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
| `agentAccess` with `"session.read"` | `miniapp/miniapp.json` | 3.1.4 |
| `agentConcurrency` | `miniapp/miniapp.json` | 3.1.2 |
| `surface.window` | `miniapp/miniapp.json` | 3.1.2 |

When a package declares any of these, name a MiniMax Code version at or above the minimum under
`## Tested environment` in its README, for example `- MiniMax Code 3.1.2 on macOS 15`.
`npm run check` warns until it finds one there.

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
