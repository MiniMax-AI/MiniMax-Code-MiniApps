# Mini App package contract

Verified against MiniMax Code 3.0.73.

A Mini App is a MiniMax Plugin whose `package.json` declares a Mini App payload. MiniMax Code
enforces the manifest, payload, and path rules below when the package is installed. `npm run check`
enforces the same rules here, plus this repository's own requirements: `README.md` and `LICENSE`,
a real image file behind `icon`, `lifecycle` limited to `on-demand`, no hard links, no committed
`node_modules`, and the Node entry conventions in `docs/runtime.md`.

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
| Any other field | Rejected. |

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
- `mcpEndpoints` is an array of `{ "server": string, "path": string }`. `server` matches
  `^[a-zA-Z0-9_-]{1,128}$` and must name a server declared through `plugin.json.mcpServers`; MiniMax
  Code checks that reference at install time. `server` and `path` are each unique. Use `[]` when
  there are none.
- `hostConnectorAccess` is optional: `{ "providers": string[] }`, each matching
  `^[a-z0-9_-]{1,64}$` and unique. Declared providers are granted by the Host at install time; this
  repository does not document their use.

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
