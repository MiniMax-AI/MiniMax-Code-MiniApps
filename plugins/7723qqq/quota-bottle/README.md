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
  seconds — the desktop reads the same endpoint on a 5 second cache — and the local usage snapshot
  for 15; **Refresh** starts a new cache generation, so it cannot reuse an in-flight request
  started before a login or a month change.
- The floating meter shows a short status when a login, a manual total, or a live-quota problem
  needs attention in the panel.

## How the quota is calculated

The page asks the Node entry for `/api/state`. Node tries the live Token Plan quota first, then the
manual-total fallback.

Two live sources are tried, in this order:

1. **The desktop's own session.** MiniMax Code keeps its account session in its own process and
   lends it to other local processes over an **auth lease**: a named pipe
   (`\\.\pipe\mcode-auth-lease-<hash>` on Windows, a unix socket elsewhere) authenticated by a
   capability file at `<data root>/run/mcode-auth-lease-v1.cap`. The bottle takes a short-lived
   lease (the token stays in memory, is never written to disk, and is never logged) and then makes
   the request the desktop's own usage panel makes: `GET /v1/api/openplatform/coding_plan/remains`
   with the leased token as a bearer credential.
   - The request carries the token and nothing else: no query string, no client signature, no
     group id. That is the desktop's own request shape; `X-Group-Id` is sent only when the group is
     already known, which makes it optional.
   - **The region is discovered, not guessed.** The account's region belongs to the installed
     client, and the Host does not pass it to a Mini App process. The bottle offers the leased
     token to `www.minimaxi.com` and `platform.minimax.io` in turn and keeps the one that answers.
     A token issued by the client is accepted only by its own region, so the bottle cannot end up
     outside the client's region. The region that answered is tried first on the next read, and it
     replaces the configured region in the panel.
   - The result is the same number the desktop's usage panel shows, because it is the same call:
     the quota arrives as a percentage (`current_interval_remaining_percent`), and only media
     quotas carry counts.
   - A signed-out desktop reports that the desktop is signed out; a desktop that is not running
     reports that its session is unavailable. Neither case invents a number.
   - **While you are signed in to MiniMax Code, the bottle shows the quota on its own — there is
     no second login.**
2. **The CLI's credential.** `~/.mmx/config.json` holds an OAuth token or an API key, which the
   bottle refreshes and sends to the Token Plan endpoint. This is the source described below, and
   it is the fallback when the desktop cannot answer.

### 1. Token Plan quota through the CLI credential

The Node entry loads `~/.mmx/config.json` (or `$MMX_CONFIG_DIR/config.json`), resolves the OAuth
credential, refreshes a token within five minutes of expiry, and calls
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
- The panel starts the login against the region the CLI config asks for.
- The page polls `GET /api/login`; Node polls the account token endpoint and writes a successful
  credential into the CLI's own config file. The token never reaches the page, a log, or an error
  response.
- Quitting or replacing a pending flow does not let a late response write credentials for a
  different region. `dispose()` aborts in-flight account and quota requests.
- The config update preserves unrelated fields, refuses corrupt JSON, uses a per-process temporary
  name, serializes writes, and preserves the existing file mode (0600 by default).

`sk-api-` keys are account-balance keys, not Token Plan keys. They are rejected before a request is
made and the page falls back to source 2.

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
- `ratio = remaining / total`; the liquid height and opacity both equal `ratio`.
- Weekly percentages are shown only when every displayed model has a usable weekly row; the
  weekly chip does not apply a plan boost multiplier.

### 2. Total you enter

When no live quota is available, the page asks for a total quota in tokens and stores it in the
plugin's `dataDir` as `quota.json`.

- Used: the current local calendar month, from a read-only SQLite snapshot of
  `<data root>/v2/sqlite/runtime-state.sqlite`, table `local_runtime_token_usage`, summing
  `input_tokens + output_tokens + cache_read_tokens + cache_write_tokens` where
  `startMs <= ts < endMs`. Reasoning tokens are not added separately.
- The active data root is resolved from `context.dataDir` first, then `MINIMAX_DATA_DIR`, then
  `MAVIS_HOME`, then `~/.minimax`. These Host layout details are not a supported Mini App API.
- `remaining = max(0, total - used)`, `ratio = remaining / total`.
- Usage above the saved total is reported as its own state (`overBudget`, `overBy`) instead of being
  clamped into a believable-looking empty bottle. The page says how far the usage is above the saved
  total and keeps pointing at the real quota.
- This is a raw token count, not a Token Plan count. Do not compare the two sources' numbers.

## Tested environment

- MiniMax Code 3.1.12.216 on Windows 11: the package was installed, opened from the Agent, and the
  floating octopus window rendered.
- MiniMax Code 3.1.2 or later is required by `surface.window`.
- Node.js 24.9.0 on Windows 11: `node --test "tests/*.test.mjs"` passes all 84 plugin tests;
  `node scripts/validate.mjs plugins/7723qqq/quota-bottle` reports OK.
- The synthetic HTTP integration test serves the page, rejects foreign Host and Origin, writes a
  manual total, bounds JSON bodies, and verifies that `dispose()` frees the listener.
- The lease tests run the real framed protocol against a named-pipe server, so the desktop source
  (the primary path) is covered end to end: the handshake, a granted lease, a refused lease, and
  the two quota calls made with a leased token.
- A stubbed quota endpoint covers the region host choice, the fallback to the other host, the named
  credential failures, and the balance-key refusal. The state tests cover the login prompt and the
  over-budget state, the page tests cover the window drag math and the verification origins, and
  the page test keeps every error code and every login-fixable code in sync with the Node catalog.
- Synthetic quota API responses cover ambiguous counts, conflict rejection, percentage-only rows,
  unlimited rows, and weekly aggregation. A synthetic SQLite database covers the local month
  window and missing-schema cases.
- A live desktop session on the CN region, with MiniMax Code running and signed in: the desktop
  source returned a live quota (two model rows) without a second login, without a client signature
  and without a group lookup. A full device authorization for the CLI fallback and macOS/Linux were
  not tested in this revision.

## Data & access

- Files read:
  - `~/.mmx/config.json` or `$MMX_CONFIG_DIR/config.json`: OAuth token or API key. This relies on
    the current `mmx` layout and is not a documented Mini App API.
  - `<data root>/v2/sqlite/runtime-state.sqlite`, read-only, only during the manual fallback.
    `VACUUM INTO` creates a temporary snapshot under `context.dataDir`; the snapshot is removed
    after the query. That Host schema and path are unsupported layout details.
  - `miniapp/client/index.html` and the plugin's `quota.json` in `context.dataDir`.
- Files written:
  - `~/.mmx/config.json`, by the login and by OAuth token rotation. Unknown fields are preserved.
  - `<context.dataDir>/quota.json`, the manual total (atomic temporary file, then rename).
  - Temporary SQLite snapshots under `<context.dataDir>/.usage-*`, removed after each read.
- Network:
  - `https://account.minimaxi.com` or `https://account.minimax.io`: device-code start and poll.
  - `https://www.minimaxi.com` or `https://platform.minimax.io`: the Token Plan quota read through
    the desktop's leased session. No redirect is followed.
  - `https://api.minimaxi.com` or `https://api.minimax.io`: Token Plan quota read through the CLI
    credential, or an approved HTTPS MiniMax API override. No redirect is followed.
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
- Secrets: tokens stay in the Node process and the CLI config file. They are never sent to the page,
  logged, or included in error responses. Responses expose a fixed error-code catalog only.
- Source and artwork: the implementation and icon are original to this package. See `NOTICE.md`.
- State: `quota.json` in `dataDir`; the theme preference is view state in `localStorage`.

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
miniapp/node/auth/*.mjs       Config, credential and device-flow implementation
miniapp/node/usage.mjs        Read-only local token usage with a SQLite snapshot
miniapp/node/store.mjs        Manual total, stored atomically in dataDir
miniapp/node/miniapp-api.ts   Type declarations for the runtime context
tests/*.test.mjs              Plugin regression tests
NOTICE.md                     Source and artwork attribution
icon.png                      Original plugin icon
```

## License

[MIT](./LICENSE). See [NOTICE.md](./NOTICE.md) for the license scope.
