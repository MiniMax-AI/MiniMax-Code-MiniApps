# MiniMax Bot Bridge

English | [简体中文](README.zh-CN.md)

Pair your phone with the **MiniMax Bot** team on your desktop. The bridge is the Mini App that
runs on the desktop: it shows a pairing code, keeps the list of paired phones, and carries your
team's conversations and tool activity over a relay you control to the mobile client.

This is an independent project, not an official MiniMax application. It does not modify or
reproduce the official MiniMax Bot plugin — it calls the team tools the Host already exposes and
leaves the desktop in charge.

## What it does

- **Pairing surface.** Request a single-use six-digit code, read it on the desktop, and list or
  revoke the phones paired with this desktop.
- **Relay configuration.** Set the relay address, the account id, the bridge id, the bridge
  credential and the display name. The bridge reconnects when the configuration changes, and it
  refuses a relay it may not talk to.
- **Team access.** Read the team's profiles, group membership and conversation history through the
  `minimax-bot` tools the Host exposes, and send messages as a Bot.
- **Hosted turns.** A Bot turn can run in a session the bridge owns instead of the team's own
  conversation, with streaming output and the desktop's permission prompts.

The phone is a separate app: [MiniMax Bot Mobile](https://github.com/nattiini45/minimax-bot-mobile),
an Expo / React Native client for Android, iOS and the web. The bridge is useless without it,
and it is useful without nothing else: the relay is the only third piece.

## Requirements

- MiniMax Code 3.1.5 or later — see [Tested environment](#tested-environment).
- The official **MiniMax Bot** plugin on the same desktop. The bridge calls that plugin's tools
  through the Host's tool API. Without it the bridge still starts, pairs and reports its
  diagnostics, but it cannot show or drive your team.
- A relay you operate, and a bridge credential minted for it. See
  [Pairing and credentials](docs/PAIRING.md) for the wire flow, and the mobile app's repository
  for the relay Worker and the minting command.

## Install

Copy the entire plugin directory, including the hidden `.minimax-plugin` directory, into the
client's `plugins` directory:

```text
Repository: plugins/nattiini45/minimax-bot-bridge/
Install to: <dataDir>/plugins/minimax-bot-bridge/
Manifest:   <dataDir>/plugins/minimax-bot-bridge/.minimax-plugin/plugin.json
```

`dataDir` is the `.minimax` directory in your home folder (`~/.minimax`) by default. The author
directory (`nattiini45/`) only groups the contribution in the registry; the installed plugin is
`minimax-bot-bridge`. Restart MiniMax Code, confirm the plugin is recognised and enabled, and ask
the Agent to open "MiniMax Bot Bridge".

To update, close the app and exit MiniMax Code, then replace the complete plugin directory. Keep
a backup outside `plugins/`. The bridge's own state lives in the Host's data directory, not in the
plugin directory, so replacing the directory does not lose it.

## Configure and pair

1. Open the bridge surface.
2. Enter the relay address (`wss://…` or `https://…`), the account id, the bridge id and the
   bridge token minted with the relay secret.
3. Request a pairing code and read the six digits aloud.
4. Enter the same relay address, the same account id and those six digits in the phone app.

The code is single-use and expires after five minutes. The phone can be revoked from the bridge
surface at any time.

## Tested environment

- MiniMax Code 3.1.10 on Windows 11 (x64), with the official MiniMax Bot plugin installed.
- Node.js 24.22.1 and npm 11.19.1.
- The bridge's own suite passes on that machine: `npm test` inside the plugin directory. It needs
  no dependencies and no network.

## Data & access

| | |
| --- | --- |
| **Files written** | Only inside the Host's private data directory (`context.dataDir`): `bridge-config.json` (relay address, account id, bridge id, display name, per-Bot turn mode), `bridge-token` (the relay credential, written for its owner only) and `ledger.json` (turn, tool and permission records — counters and identifiers, not message text). One `rooms/<hash>/ledger.json` is added per room. |
| **Files read** | Those same files, on start. Nothing else: no Host files, no other plugins' files, no user documents. |
| **Network** | The relay address you configure, over HTTPS or WSS only. A cleartext `http://` or `ws://` address is accepted only for a loopback relay. `wss://` and `https://` name the same relay, and the credential never crosses between them. |
| **Spawned processes** | None. The bridge is one Node process with no child processes. |
| **Agent turns** | Yes — `agentAccess: ["session.run"]`. The bridge runs a Bot turn through the Host Agent in a session it owns and asks it for a model. It never reads your other conversations: `session.read` is not declared, and the team conversation history it shows comes from the team tools. |
| **Tools called** | Yes — `toolAccess: ["call"]`. The bridge calls the `minimax-bot` team tools the Host exposes (`mcp__minimax-bot__…`) to read the team, its groups and its conversation history, and to send messages. Each call is judged by your permission rules. |
| **Microphone** | Not used. The bridge records no audio and transcribes nothing. |
| **State** | The Host's private data directory, whose location is opaque and owned by the Host. Nothing is written outside it. The relay keeps its own state on the relay operator's account. |

### Security notes

- **The desktop is a trust boundary.** The bridge binds loopback and checks the caller's own
  headers and a per-process secret before it answers a request that could change its
  configuration. That defends the local web surface; it does not sandbox other native processes
  on the same machine.
- **A paired phone is desktop access.** A paired device can exercise the bridge's available
  functionality. Share pairing codes only with the people you mean to, and revoke devices you no
  longer control.
- **Trust your relay.** TLS protects each connection, but the JSON the relay forwards is not
  end-to-end encrypted. The relay operator can read conversations and operation payloads.
- **Capabilities are granted, not reproduced.** The bridge works through the capabilities the
  Host and the team tools offer on that desktop. It holds no MiniMax account credential of its
  own; the desktop's existing account and grants are what it uses.

## Development

```sh
npm test
```

The suite runs on Node's built-in test runner and needs no dependencies and no network. The
runtime payload is self-contained: it uses Node's standard library only, and the shared protocol
is vendored into `miniapp/node/protocol/`.

## License

The bridge is MIT licensed — see [LICENSE](LICENSE). The icon uses MiniMax's mascot artwork,
which MiniMax licenses under the MIT terms in [LICENSE-MINIMAX.txt](LICENSE-MINIMAX.txt).

MiniMax names and marks identify the products this project connects to. The project license does
not grant trademark rights and does not imply MiniMax's endorsement.
