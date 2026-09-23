# Model Manager (`openrouter-model-manager`)

English | [简体中文](README.zh-CN.md)

A [MiniMax Code](https://github.com/MiniMax-AI) Mini App for browsing, searching, and enabling/disabling the models in your MiniMax Code `config.yaml` — no more find-and-replace in Notepad.

Author: [ocoomber](https://github.com/ocoomber) · Version: `1.2.4`

> The plugin ID `openrouter-model-manager` is kept for stability, but the app is **not** OpenRouter-specific — it works with any provider (see *What it does*).

## What it does

- **Works with any provider** — OpenRouter, custom providers, and locally hosted endpoints (Ollama, LM Studio). Every model block in your config is picked up automatically — all models appear in one list grouped by family, with no provider switching.
- **Restart reminder** — a banner appears as soon as you change anything, reminding you to restart MiniMax Code (mini apps can't restart the host app for you).
- **Search** across model IDs and display names.
- **Instant save** — every toggle writes to your config immediately; no save button.
- **Filter chips** — All / Enabled only / Disabled only.
- **Bulk actions** — *Enable matching* / *Disable matching* apply only to the current search results, and each model family has its own enable/disable buttons.
- **One-level Undo** — made a mistake with "enable all"? One click restores the previous config. If the file changed outside the app in the meantime, Undo refuses instead of clobbering your edits. A multi-provider bulk action is reverted as one operation — not provider-by-provider.
- **Automatic backups** — before every bulk change, a timestamped copy of your config is written to `backups/` under the Mini App's own data directory (per Mini App runtime guidance), pruned to the newest 20.
- **Collapsible families** — models are grouped by the prefix before the `/` in their ID.
- **OpenRouter links** — every model row can link to its OpenRouter page (shown only for OpenRouter providers). Right-click a link to choose the external browser, the built-in browser, or copy the URL.
- **Context-limit badges** — read straight from your config.

## Tested environment

- **Windows 11** (build 10.0.26200), **MiniMax Code 3.0.73**, plugin `1.2.4` — tested by the author end to end (toggles, bulk actions, undo, restart flow).
- **macOS / Linux** use the same code paths but have **not been tested** by the author — feedback and reports are very welcome.

## Install

Copy (or clone) this folder into your MiniMax Code plugins directory:

```
~/.minimax/plugins/openrouter-model-manager/
```

Then restart MiniMax Code and open the **Model Manager** mini app.

> Note: after toggling models, restart MiniMax Code itself for the change to take effect — the config is read at startup.

## How it works

The Node runtime reads your `config.yaml` line by line (no YAML library) and finds every `models:` block that has `enabled:` flags. Toggling a model rewrites only that model's `enabled:` line. All writes are atomic (a temp file `.config.yaml.mm-tmp` is written next to your config, then renamed; it is removed if anything fails), your file's existing indentation and line endings are preserved, and concurrent edits are serialized so overlapping clicks can't clobber each other.

Capabilities such as vision support are intentionally **not** fetched from external APIs — your config file is the single source of truth.

## Data & access

- The UI never sees your secrets: the server returns only model **id / name / enabled / contextLimit**. API keys in the config are never read into the UI, returned by the API, or displayed.
- The app makes **no outbound network requests** of its own.
- **Process spawning (disclosed):** the only OS-level action is opening an OpenRouter model page in *your own* browser, via `rundll32`/`cmd`/`explorer` on Windows, `open` on macOS, or `xdg-open` on Linux. Only `https://openrouter.ai/...` URLs are accepted; anything else is rejected by the server.
- Config location: the runtime walks ancestors of its injected data directory looking for `config.yaml` (the Host hands each Mini App a plugin-owned subdirectory several levels below the data root, and the MiniMax Code config lives at the data root or one of its ancestors in the current Host layout). If nothing is found along that walk, it falls back to `~/.minimax/config.yaml`. The parent walk matches an implementation detail of the current Host layout, not a guaranteed API, so the default fallback is what protects non-default installs.

## Files

```
.minimax-plugin/plugin.json   Plugin manifest
package.json                  Mini app bootstrap
miniapp/miniapp.json          Mini app surface/runtime config
miniapp/client/index.html     UI (light/dark aware)
miniapp/node/server.mjs       Node runtime + REST API
miniapp/node/miniapp-api.ts   Type declarations for the runtime API
icon.png                      Plugin icon
tests/api-set.test.mjs
tests/parser.test.mjs
tests/resolveConfigPath.test.mjs
```

`tests/` lives outside the Host's runtime payload roots (`miniapp/client`, `miniapp/node`), so the app never loads it — it just rides along if you copy the directory. Run with `node --test` from the plugin root.

## License

[MIT](./LICENSE)
