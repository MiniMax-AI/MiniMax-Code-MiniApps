# Token Usage Board

English | [简体中文](README.zh-CN.md)

Watch Token usage from your local MiniMax Code runtime in near real time: consumption over time, output speed, cache hit rate, per-model comparison, per-project breakdown, tool-call stats, and recent requests. Filter by time range, model, and session.

Author: [yanhy2000](https://github.com/yanhy2000) · Version: `1.2.0`

![Token Usage Board with synthetic data](docs/preview.png)

*The preview uses synthetic sessions and usage data. The app interface is currently in Chinese.*

## Install and use

Copy this whole directory into `.minimax/plugins/` inside your home folder. The target path per system:

| System | Target path |
| --- | --- |
| Windows | `C:\Users\<username>\.minimax\plugins\mcode-usage-monitor` |
| macOS | `/Users/<username>/.minimax/plugins/mcode-usage-monitor` |
| Linux | `/home/<username>/.minimax/plugins/mcode-usage-monitor` |

`<username>` is your system login name. `.minimax` is a hidden folder: on Windows enable "Show hidden items" in File Explorer, and on macOS press `Cmd + Shift + .` in Finder. If you have used MiniMax Code before, the folder usually already exists — just drop this directory into it.

Do not leave out the hidden `.minimax-plugin` directory; the plugin needs it to be recognized. Unzipping an archive or dragging the whole folder both work — the final path just has to match the table above.

Then restart a version of MiniMax Code that supports MiniApps, confirm that the plugin is enabled, and open "Token 用量看板" or ask the Agent to open it. If MiniMax Code uses a custom data directory (`MINIMAX_DATA_DIR`), put it under `plugins/` there instead.

The page opens on the last 24 hours. You can switch between today (since local midnight), 1 hour, 12 hours, 24 hours, 7 days, 30 days, and all time, or enter a custom whole-hour range (1–8760 hours; only the most recent entry is kept). Model and session filtering is multi-select, and the session list only lists sessions with usage inside the selected range. The per-project breakdown groups usage by session workspace directory, and tool-call stats come from the tool calls recorded per request; both follow the current filters. Every card can be collapsed or expanded, and a collapsed card can be dragged to reorder (expanded cards cannot). The "重置布局" button at the top restores all cards to expanded and the default order without touching the filters. Filters, time range, refresh interval, theme, card collapse state, and card order are remembered between visits. The page refreshes every 10 seconds by default (5 s / 10 s / 30 s / manual).

This app requires **Python 3.8+** on the local machine to read the local database. It uses only the standard library, so no `pip install` is needed. No API key or other configuration is required.

## Data access and counting

The app reads two local sources:

- `<dataDir>/v2/sqlite/runtime-state.sqlite`, opened through the SQLite backup API as a read-only in-memory snapshot, so it does not lock or disturb a running client.
- `<dataDir>/v2/sessions`, scanned for real session files (`messages.jsonl`) to build the session list.

Counting rules:

- Token usage = input + cache-read + output. Cache hit rate = cache-read / (cache-read + input).
- Rows are de-duplicated by `msg_id` across sessions: when a session is rebuilt, its earlier messages are copied into the new session, and the app counts them once.

This is a local, near-real-time view. The in-product usage page (Settings → Usage) is the authoritative source for billing and quota; its numbers come from server-side statistics, which lag behind the local database (measured to catch up within about a day in our testing) and may use different rules.

The runtime sends nothing to external services and has no telemetry. It writes a single preferences file (`prefs.json`) into the Host-provided plugin data directory. The page shows real session titles, workspace directory paths (which can include your user name and project names), and tool names, so take care when sharing screenshots or your screen.

## Source and verification

The page is in `miniapp/client/index.html` (ECharts is bundled locally), the Node entry is `miniapp/node/server.mjs`, and the data backend is `miniapp/node/api.py`. No build step is required.

Verified environment: MiniMax Code desktop `3.0.73.166` on Windows (10.0.26200, x64). Verified during development: plugin install and open, aggregation and de-duplication, model/session filtering, preference persistence, auto refresh, theme switching, chart and table rendering, time-range presets and custom-range validation, select-all/invert gating, and card collapse and drag reordering. macOS and Linux are unverified.

Third-party components: [ECharts](https://echarts.apache.org/) (Apache License 2.0), bundled locally for offline use.

## License

[MIT](LICENSE).
