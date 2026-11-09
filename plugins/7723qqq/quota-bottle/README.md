# Quota Bottle (`quota-bottle`)

An octopus-shaped glass bottle that holds your remaining MiniMax Token Plan quota. The liquid level
and its opacity both follow the remaining share, so a full quota is a saturated octopus and an
exhausted quota is a transparent glass outline. The same page can float as a small transparent
desktop window.

The page is SVG and has no framework, CDN, build step or runtime dependency. It shows the remaining
and total numbers, the percentage, the reset time, per-model rows, the weekly chip, and light/dark
themes. The interface follows the client's language — Chinese or English — and the 中 / EN buttons
in the header switch it for good.

## Install

Copy this directory, including the hidden `.minimax-plugin/`, into the MiniMax Code plugins
directory as `quota-bottle/` (`~/.minimax/plugins/quota-bottle/` by default). Restart MiniMax Code
and ask the Agent to "Open Quota Bottle".

## Floating window

**Pin to desktop** under the bottle moves the page to a 220 × 300 frameless, transparent,
always-on-top window; the panel keeps running. This requires MiniMax Code 3.1.2 or later.

The window is 220 × 300. MiniMax Code remembers a popped-out window's bounds per plugin and lets that
memory outrank the manifest, so a window reopens at the size it last had. The package ships it
non-resizable, because a transparent frameless window that can be resized loses its transparency on
Windows; a client that reports a resizable window is offered a size repair instead, and that patch
carries a visible position because the Host refuses a geometry change that would leave the screen.
The page paints no backdrop — neither on the root element nor on the body. On a client that renders
Mini Apps with the `webview` backend the window surface itself is opaque: the page still paints
nothing, but the desktop cannot show through. That is a client-side limitation, tracked upstream in
[MiniMax-AI/minimax-code#597](https://github.com/MiniMax-AI/minimax-code/issues/597).

MiniMax Code opens a window only from a user action: a window never opens at launch, and a mode
change outside a click is refused with `not_permitted`. The first pin is therefore one click, and
the offer sits on the opening screen instead of behind a menu. After that the window stays up while
the client runs; closing it returns the page to the panel, and the next pin is a click again.

- The window has no native title bar, so dragging it takes two paths. The page marks its content as
  a drag handle (`-webkit-app-region: drag`, with the × kept `no-drag`), which the operating system
  honours where the renderer supports it; and, because the client may render Mini Apps in a WebView2
  guest that ignores that property, the page can also move the window itself, in screen coordinates
  so the window's own movement cannot cancel the drag. Only one path is ever live: where the drag
  region exists it swallows the pointer events first.
- The × in the top-right corner returns it to the panel. Closing it like any other window does the
  same; the panel keeps running.
- A pinned window polls every 5 seconds, the panel every 10, and a hidden page every 60; pinning
  reads once immediately instead of waiting for the first poll. Node caches the live quota for 3
  seconds, so a pinned window stays close to live without adding load, and the local usage snapshot
  for 15; **Refresh** starts a new cache generation, so it cannot reuse an in-flight request
  started before a login or a month change.
- The compact meter shows the percentage and token amount, then the reset countdown, the weekly
  quota and the video model's used share when the response carries them.
- The floating meter shows a short status when a login, a manual total, or a live-quota problem
  needs attention in the panel.

## How the quota is calculated

The page asks the Node entry for `/api/state`. Node tries the live Token Plan quota first, then the
manual-total fallback.

The live quota has one source: a credential you configure yourself.

1. **The plugin's own login.** The panel's device-code login stores an OAuth token in
   `<context.dataDir>/credentials.json` and refreshes it there. The token is used for
   `GET <baseUrl>/v1/token_plan/remains` with `Authorization: Bearer <token>`.
2. **A credential already in the CLI config.** `~/.mmx/config.json` (or
   `$MMX_CONFIG_DIR/config.json`) is read, never written: an API key, or an OAuth access token
   that is still valid. A CLI-owned token is not refreshed or rotated; when it expires the panel
   offers its own login. This keeps a session created with `mmx auth login` exactly as the CLI
   left it.

The bottle does not borrow MiniMax Code's signed-in session. It does not read the desktop's auth
lease, its capability file, or any other Host credential.

### 1. Token Plan quota

The Node entry reads the credential snapshot in this order: the plugin store first, then the CLI
config's OAuth access token while it is still valid, then the CLI config's API key. It calls
`GET <baseUrl>/v1/token_plan/remains` with `Authorization: Bearer <token>`.

The host follows the region: `https://api.minimaxi.com` for `cn` and `https://api.minimax.io` for
`global`. A configured `base_url` or OAuth `resource_url` is accepted only when it is an HTTPS
MiniMax API host, and the other region's host stays a fallback, so a stale region setting cannot
hide a working credential: every candidate host is tried in turn and the first one that answers with
a quota wins. A transport failure stops the walk, because it says nothing about the host. A loopback
HTTP host is accepted only through `MINIMAX_BASE_URL`, which replaces every candidate host for local
stub testing.

Credentialed requests never follow redirects. `MINIMAX_BASE_URL`, `MINIMAX_REGION`,
`MMX_CONFIG_DIR`, `MINIMAX_DATA_DIR` and `MAVIS_HOME` may change which host or local file is used.
All are read from the Node process environment.

#### Log in once

If no credential can read the quota — none, expired, rejected, or unreadable — the panel shows
**Token Plan login**:

- **Log in** starts the device-code OAuth flow. The Node process requests a code from the fixed
  `account.minimaxi.com` or `account.minimax.io` host, validates the returned URL and code, opens
  the verification page, and shows the URL and code in the page. The verification page itself
  lives on the region's platform host (`platform.minimaxi.com` or `platform.minimax.io`); the
  account host stays allowed because older responses point there. Each region accepts only its
  own two origins.
- The panel starts the login against the region the stored credential or CLI config asks for.
- The page polls `GET /api/login`; Node polls the account token endpoint and writes a successful
  credential into `<context.dataDir>/credentials.json`. The token never reaches the page, a log,
  or an error response.
- The CLI config is never written by the login or by token refresh. Its `api_key`, `base_url`,
  region and other fields stay exactly as the user left them.
- Quitting or replacing a pending flow does not let a late response write credentials for a
  different region. `dispose()` aborts in-flight account and quota requests.
- The credential write is atomic, serialized, uses a per-process temporary name, and is 0600 by
  default.

`sk-api-` keys are account-balance keys, not Token Plan keys. They are rejected before a request is
made and the page falls back to the manual total.

A credential the service refuses is named instead of being lumped together: `2049 invalid api key`
becomes `invalid_credential`, `1004` (no secret key in the request) becomes `missing_credential`, and
an HTTP 401 or 403 becomes `unauthorized`. Every one of them clears with a fresh login, so the panel
offers **Token Plan login** rather than leaving the user without a way forward. When several hosts
fail differently, the failure the user can act on is the one that gets reported.

Response normalization:

- The current interval (`current_interval_*`) is the bottle's number. Weekly figures are shown as a
  second chip.
- `current_interval_usage_count` has meant "remaining" in older responses and "consumed" in newer
  ones. When `current_interval_remaining_percent` is present, the reading within one percentage
  point of it wins; a row that agrees with neither, or has an invalid percentage, is ignored.
  Without the percentage, the historical "remaining" reading is kept.
- A row with `current_interval_status === 3` (unlimited) or a zero total is skipped. Remaining
  values are clamped to `[0, total]`.
- `ratio = remaining / total`; the liquid opacity equals `ratio`. The body fills across the first 80%
  of the height, and the last 20% fills the neck and the two ears, so 100% reaches the mouth.
- Weekly percentages are shown only when every displayed model has a usable weekly row; the
  weekly chip does not apply a plan boost multiplier.

### 2. Total you enter

When no live quota is available, the page asks for a total quota in tokens and stores it in the
plugin's `dataDir` as `quota.json`.

- Used: **off by default.** The panel has a "Read local usage from MiniMax Code" switch. Only
  after it is on does the bottle read the current local calendar month from
  `<data root>/v2/sqlite/runtime-state.sqlite`, table `local_runtime_token_usage`, summing
  `input_tokens + output_tokens + cache_read_tokens + cache_write_tokens` where
  `startMs <= ts < endMs`. Reasoning tokens are not added separately. It opens the database
  read-only and copies it with `VACUUM INTO` into a temporary snapshot under `context.dataDir`,
  then removes the snapshot; the Host database is never written.
- The data root comes only from `MINIMAX_DATA_DIR`, then `MAVIS_HOME`, then `~/.minimax`. The
  bottle does not infer it from `context.dataDir` or walk the Host directory tree. That path and
  schema are unpublished Host layout details; if your install keeps its data elsewhere, set
  `MINIMAX_DATA_DIR`.
- With the switch off, the database is not opened, copied or read at all: the manual state reports
  `usage_scan_off`, and the page says local usage is off.
- `remaining = max(0, total - used)`, `ratio = remaining / total`.
- Usage above the saved total is reported as its own state (`overBudget`, `overBy`) instead of being
  clamped into a believable-looking empty bottle. The page says how far the usage is above the saved
  total and keeps pointing at the real quota.
- This is a raw token count, not a Token Plan count. Do not compare the two sources' numbers.

## Tested environment

- MiniMax Code 3.1.12.216 on Windows 11: the package was installed, opened from the Agent, and the
  floating octopus window rendered.
- MiniMax Code 3.1.2 or later is required by `surface.window`.
- Node.js 24.9.0 on Windows 11: `node --test "tests/*.test.mjs"` passes all 85 plugin tests;
  `node scripts/validate.mjs plugins/7723qqq/quota-bottle` reports OK.
- The synthetic HTTP integration test serves the page, rejects foreign Host and Origin, writes a
  manual total, bounds JSON bodies, validates the usage-scan switch, and verifies that `dispose()`
  frees the listener.
- The credential tests put an `api_key`, a `base_url` and an unrelated field in a CLI config, run
  the panel login, and assert the CLI file is byte-for-byte unchanged. Refresh tests assert a
  CLI-owned token is never refreshed or written, while a plugin-owned token is refreshed into
  `dataDir/credentials.json`.
- The state tests assert the Host SQLite database is not opened until the "Read local usage"
  switch is on, and that turning it on reads the current month. A stubbed quota endpoint covers the
  region host choice, the fallback to the other host, the named credential failures, and the
  balance-key refusal. The page tests cover the window drag math and the verification origins, and
  keep every error code and every login-fixable code in sync with the Node catalog.
- Synthetic quota API responses cover ambiguous counts, conflict rejection, percentage-only rows,
  unlimited rows, and weekly aggregation. A synthetic SQLite database covers the local month
  window and missing-schema cases.
- A full device authorization and macOS/Linux were not re-run in this revision.

## Data & access

- Files read:
  - `<context.dataDir>/credentials.json`: the OAuth token written by the panel login.
  - `~/.mmx/config.json` or `$MMX_CONFIG_DIR/config.json`: read-only. An API key, or an OAuth
    access token that is still valid. This relies on the current `mmx` layout and is not a
    documented Mini App API.
  - `<data root>/v2/sqlite/runtime-state.sqlite`, read-only, only when "Read local usage" is on.
    `VACUUM INTO` creates a temporary snapshot under `context.dataDir`; the snapshot is removed
    after the query. That Host schema and path are unsupported layout details.
  - `miniapp/client/index.html`, and `quota.json`/`settings.json` in `context.dataDir`.
- Files written:
  - `<context.dataDir>/credentials.json`: the panel login and OAuth token rotation. No CLI or Host
    file is written by this package.
  - `<context.dataDir>/quota.json`, the manual total, and `<context.dataDir>/settings.json`, the
    usage-scan switch. Both use an atomic temporary file, then rename.
  - Temporary SQLite snapshots under `<context.dataDir>/.usage-*`, only when the switch is on,
    removed after each read.
- Network:
  - `https://account.minimaxi.com` or `https://account.minimax.io`: device-code start and poll.
  - `https://api.minimaxi.com` or `https://api.minimax.io`: Token Plan quota read through the
    plugin login or a CLI credential, or an approved HTTPS MiniMax API override. No redirect is
    followed.
  - A loopback HTTP stub is used only in tests through `MINIMAX_BASE_URL`.
  - If credentials exist, each state request still tries the live source first, even when a manual
    total is saved. Manual mode alone makes no network request.
- Processes: the system browser opener (`explorer.exe` on Windows, `open` on macOS, `xdg-open` on
  Linux) for the validated verification page. Quota and OAuth requests run in-process; there is no
  `mmx` executable and no shell.
- Agent turns: none; no `agentAccess`.
- Conversations read: none; no `session.read`.
- Tools called: none; no `toolAccess`.
- Microphone: not used; no `deviceAccess`.
- Secrets: tokens stay in the Node process and `dataDir/credentials.json` (or the CLI config when
  that fallback is used). They are never sent to the page, logged, or included in error responses.
  Responses expose a fixed error-code catalog only.
- Source and artwork: the implementation and icon are original to this package. See `NOTICE.md`.
- State: `credentials.json`, `quota.json` and `settings.json` in `dataDir`; the theme and language
  preferences are view state in `localStorage`.

## Files

```text
.minimax-plugin/plugin.json   Plugin manifest
package.json                  Mini App declaration
miniapp/miniapp.json          Payload roots, Node entry, page route
miniapp/client/index.html     The page served at /bottle
miniapp/node/server.mjs       Node entry: start(context) → { dispose }
miniapp/node/quota.mjs        Response normalization, manual-total state, quota entry point
miniapp/node/cache.mjs        Generation-aware TTL cache
miniapp/node/urls.mjs         Host, URL and timing validation
miniapp/node/net.mjs          No-redirect credentialed fetch
miniapp/node/errors.mjs       Fixed error-code catalog and login-fixable classification
miniapp/node/auth/*.mjs       CLI config reader, plugin credential store and device flow
miniapp/node/usage.mjs        Opt-in read-only local usage with a SQLite snapshot
miniapp/node/settings.mjs     Usage-scan switch, default off
miniapp/node/store.mjs        Manual total, stored atomically in dataDir
miniapp/node/miniapp-api.ts   Type declarations for the runtime context
tests/*.test.mjs              Plugin regression tests
NOTICE.md                     Source and artwork attribution
icon.png                      Original plugin icon
```

## License

[MIT](./LICENSE). See [NOTICE.md](./NOTICE.md) for the license scope.
