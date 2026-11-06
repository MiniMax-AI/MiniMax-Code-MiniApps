# Pairing

The phone pairs with the relay using a device-scoped token. Pairing does not
transfer MiniMax account credentials from the desktop.

## The shape of it

```text
DESKTOP (bridge)                        RELAY                    PHONE
      │                                    │                        │
      │ POST /r/:acct/pair/code             │                        │
      │   Authorization: Bearer <bridge>   │                        │
      ├───────────────────────────────────>│                        │
      │ { code: "418902", expiresAt }      │                        │
      │<───────────────────────────────────┤                        │
      │                                    │                        │
      │        (the user reads the code)   │ POST /r/:acct/pair     │
      │                                    │ { code, deviceId, … }  │
      │                                    │<───────────────────────┤
      │                                    │ { deviceToken, expiresAt }
      │                                    ├───────────────────────>│
```

## Step by step

### 1. The desktop asks for a code

The bridge calls `POST /r/:accountId/pair/code` with its bearer token and
`{ bridgeId, bridgeName, ttlMs? }`. The relay checks the token's role, subject,
account and revocation state, then returns a single-use six-digit code.

The default lifetime is **five minutes**. A requested `ttlMs` is clamped to
**one to fifteen minutes**. The bridge displays the code on its desktop surface;
the relay persists outstanding codes until they are consumed or pruned.

### 2. The phone types the code

Open the pairing screen (`https://github.com/nattiini45/minimax-bot-mobile/blob/main/apps/app/app/pair.tsx`), enter the relay URL and account
id, then type the six digits. The client checks the code's shape locally before
sending it.

### 3. The relay exchanges the code

The phone calls `POST /r/:accountId/pair` with
`{ code, deviceId, deviceName, clientVersion }`.

An expired code returns `PAIRING_CODE_EXPIRED`; an unknown or already-used code
returns `PAIRING_CODE_UNKNOWN`. A successful exchange consumes the code and issues
a device token with a default **30-day** lifetime. Tokens use
`base64url(payload).base64url(signature)`, signed with HMAC-SHA-256.

### 4. The phone connects

The normal connection flow is:

1. `POST /r/:accountId/ws-ticket` with `Authorization: Bearer <device token>`.
2. Open `GET /r/:accountId/ws?role=device&subject=<deviceId>&ticket=…&lastSeq=…`.

The ticket expires after **30 seconds** and is checked for single use by the
running relay session. Authentication happens during the upgrade; `hello.ok`
reports resume metadata (`seq`, `bridgeOnline`, `truncated`), not authentication.
The relay replays available events after `lastSeq`.

Both the phone and bridge can fall back to `token=…` in the WebSocket URL when a
ticket cannot be obtained or the ticket connection fails. This can expose the
longer-lived token to URL logs or proxies. Do not log connection URLs; tickets
reduce this exposure but do not eliminate it.

### 5. Revoking a device

The desktop lists paired devices with `GET /r/:accountId/devices`. Its preferred
owner-revocation interface is `POST /r/:accountId/devices/revoke`, authenticated
with a current bridge bearer credential and a JSON body:

```json
{ "deviceId": "the-exact-registered-id" }
```

The ID is an exact string: do not trim or URI-decode it. A body preserves IDs such
as `.`, `..`, Unicode and literal percent sequences that cannot all be addressed
losslessly in URL path segments. The relay marks the selected device revoked and
closes its socket with code `4003`; the phone returns to pairing. Sibling devices
are unaffected.

`DELETE /r/:accountId/devices/:deviceId` remains a legacy owner interface for IDs
that can be represented in a URL, with path decoding exactly once. A device can
release its own credential using `DELETE /r/:accountId/devices/me` with its device
bearer token. Connection-only WebSocket tickets are not management credentials.

## Credentials

| Credential | Held by | Lifetime | Revocation |
|---|---|---|---|
| Bridge token | Desktop `bridge-token` file, separate from config | 24 hours by default; minting accepts `--hours` | Account-scoped rotate/revoke endpoints |
| Device token | Phone credential store | 30 days by default | Desktop revocation or device self-release |
| Pairing code | Relay; displayed by desktop | 5 min by default, 1–15 on request | Consumed once or expires |
| MiniMax account credentials | Desktop runtime | Managed by MiniMax Code | Managed by MiniMax Code |

Native credentials require Expo SecureStore. If the keystore is unavailable,
locked or fails a read/write, credential handling fails closed rather than
downgrading to plaintext. Credential writes and removal are ordered; session
metadata is invalidated before logout cleanup so a leftover secure token cannot
silently restore a removed session.

Web credentials use **plaintext browser storage** through AsyncStorage. Treat the
browser profile as credential-bearing. Binding checks associate a credential with
its relay origin, account and device; they are not browser-side encryption. See
the [credential store](https://github.com/nattiini45/minimax-bot-mobile/blob/main/apps/app/src/state/credential-store.ts).

Example bridge token payload:

```json
{
  "v": 1,
  "sub": "bridge_example",
  "role": "bridge",
  "exp": 1793181000000,
  "jti": "unique-token-id",
  "iat": 1793094600000,
  "acc": "default"
}
```

Bridge tokens must carry an `acc` claim matching the requested account. Ordinary
device credentials are also checked against that account's registry and stored
token digest; legacy ordinary device credentials may omit `acc`. Connection-only
tickets for either role are account-bound, single-use and accepted only for a
WebSocket upgrade, never as pairing, renewal or management credentials.

Keep `bridgeId` stable when re-minting: an account with an owner refuses a different
bridge id. Bridge credentials without the required account claim must be replaced.

### Bridge token renewal

`POST /r/:accountId/bridge/token` rotates the bridge token and revokes older tokens
using a durable issuance-time cutoff. `DELETE` on the same route is the bridge
credential kill switch: affected active connections are invalidated and pending
older rotations cannot recreate authority afterward. Both operations require a
current, non-ticket bridge bearer credential; proof is rechecked inside the
Durable Object at the mutation boundary. Relay-issued replacements last 24 hours.

The bridge checks for expiry **only at startup**, attempting rotation when six
hours or less remain. There is no periodic renewal timer. Rotate through the
desktop surface before expiry, or restart within that six-hour window. If the
token has already expired, the relay operator must mint a replacement.

Sources: [minting script](https://github.com/nattiini45/minimax-bot-mobile/blob/main/packages/relay/scripts/mint-bridge-token.mjs),
[bridge lifecycle](miniapp/node/bridge.mjs).

## Configuration

The bridge stores `bridge-config.json` in the Mini App's data directory:

```json
{
  "relayUrl": "wss://relay.example.workers.dev",
  "accountId": "default",
  "bridgeId": "bridge_example",
  "bridgeName": "Desktop"
}
```

The credential lives alongside it in `bridge-token`, not in the configuration
JSON. The writer requests mode `0600` on filesystems that support it; this is not
a Windows ACL guarantee. Protect both the data directory and its backups.

Set the relay's Worker secret:

```sh
npx wrangler secret put RELAY_SECRET --config packages/relay/wrangler.toml
```

With the same secret supplied through `RELAY_SECRET` or `--secret-file`, mint a
token from the repository root:

```sh
npm run mint:token -w @minimax-bot/relay -- --bridge-id <bridgeId> --account <accountId> --hours 24
```

Enter the relay settings and token in the bridge surface. The bridge generates
and persists an id on first run. Either mint for that id, or set the editable bridge
id to the one supplied to the minting command before saving the credential.

## Deployed relay

```sh
cd packages/relay
npx wrangler deploy
```

`https://github.com/nattiini45/minimax-bot-mobile/blob/main/packages/relay/wrangler.toml` binds the Durable Object class. The Worker
entrypoint exports `Relay` for that binding.

## Relay trust boundary

The relay authenticates peers, routes JSON and keeps a bounded **plaintext event
replay buffer in memory** (512 entries / 4 MiB by default). It can read messages
and other payloads: there is **no application-level end-to-end encryption**.
HTTPS/WSS protects the transport, not payloads from the relay operator.

The relay also persists pairing codes, device metadata and token hashes, account
ownership, sequence state and bridge-token revocation state. It does not execute
team tools or require MiniMax account credentials. See
[relay session](https://github.com/nattiini45/minimax-bot-mobile/blob/main/packages/relay/src/session.ts).

## Troubleshooting

- **Pairing code expired:** request a new code and use it before its displayed expiry.
- **Code unknown:** it may be mistyped, already used, or for another relay/account.
- **Device not authorized:** its token may be expired, replaced or revoked; pair again.
- **Desktop offline:** check MiniMax Code, the bridge plugin, relay URL and token expiry.
- **Connected but team unavailable:** inspect `evt.team_snapshot.diagnostics` and the
  desktop surface. `teamToolsAvailable: false` means the bridge could not obtain
  the team tool catalogue; `agentAvailable` separately reports agent access.
- **`INVALID_ARGUMENTS`:** inspect `payload.details` for schema-derived field names
  such as `missing`, `required`, `unmapped` and `properties`. It is not the full
  `inputSchema`; an alias mismatch may need a change in
  `miniapp/node/tools.mjs`.

## Loopback access and automation

The bridge binds the Host-assigned loopback address. Its own HTTP handler checks
`Host`, checks `Origin` when present, rejects cross-site fetch metadata, and
requires a per-process `x-bridge-secret` plus JSON content type for mutations.
`GET /api/session` returns that secret after the caller checks.

These are browser-origin, Host-header and per-process-secret checks, **not native
local-process isolation or proof of human interaction**. A native caller can omit
`Origin`, request the secret with matching headers and drive the local API.
Automation can configure the bridge, pair a device peer, read the roster and send
operations through the live flow while MiniMax Code and the bridge are running.

Sources: [caller checks](miniapp/node/caller.mjs),
[HTTP handler](miniapp/node/server.mjs). These describe the
repository implementation, not verification of additional live Host hardening.
