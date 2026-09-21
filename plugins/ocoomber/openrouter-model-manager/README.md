# Model Manager (`openrouter-model-manager`)

English | [简体中文](README.zh-CN.md)

A [MiniMax Code](https://github.com/MiniMax-AI) Mini App for browsing, searching, and enabling/disabling the models in your `~/.minimax/config.yaml` — no more find-and-replace in Notepad.

Author: [ocoomber](https://github.com/ocoomber) · Version: `1.2.1`

## What it does

- **Works with any provider** — OpenRouter, custom providers, and locally hosted endpoints (Ollama, LM Studio). With more than one provider in your config, a dropdown appears to switch between them; with a single provider it stays out of the way.
- **Restart reminder** — a banner appears as soon as you change anything, reminding you to restart MiniMax Code (mini apps can't restart the host app for you).
- **Search** across model IDs and display names.
- **Instant save** — every toggle writes to your config immediately; no save button.
- **Filter chips** — All / Enabled only / Disabled only.
- **Bulk actions** — *Enable matching* / *Disable matching* apply only to the current search results, and each model family has its own enable/disable buttons.
- **One-level Undo** — made a mistake with "enable all"? One click restores the previous config.
- **Automatic backups** — before every bulk change, a timestamped copy of your config is written to the plugin's data folder (`backups/`).
- **Collapsible families** — models are grouped by the prefix before the `/` in their ID.
- **OpenRouter links** — every model row can link to its OpenRouter page (shown only for OpenRouter providers). Right-click a link to choose the external browser, the built-in browser, or copy the URL.
- **Context-limit badges** — read straight from your config.

## Install

Copy (or clone) this folder into your MiniMax Code plugins directory:

```
~/.minimax/plugins/openrouter-model-manager/
```

Then restart MiniMax Code and open the **Model Manager** mini app.

> Note: after toggling models, restart MiniMax Code itself for the change to take effect — the config is read at startup.

## How it works

The Node runtime reads `~/.minimax/config.yaml` line by line (no YAML library) and finds every `models:` block that has `enabled:` flags. Toggling a model rewrites only that model's `enabled:` line. All writes are atomic (temp file + rename), and your file's existing indentation and line endings are preserved.

Capabilities such as vision support are intentionally **not** fetched from external APIs — your config file is the single source of truth.

## Privacy

The app reads and writes only your `~/.minimax/config.yaml` (backups go to the plugin's own data folder). It makes no network requests and never displays API keys — secrets stay hidden in the UI.

## Files

```
.minimax-plugin/plugin.json   Plugin manifest
package.json                  Mini app bootstrap
miniapp/miniapp.json          Mini app surface/runtime config
miniapp/client/index.html     UI (light/dark aware)
miniapp/node/server.mjs       Node runtime + REST API
miniapp/node/miniapp-api.ts   Type declarations for the runtime API
icon.png                      Plugin icon
```

## License

[MIT](./LICENSE)
