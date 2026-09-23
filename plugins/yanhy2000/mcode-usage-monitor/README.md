# Token Usage Board

English | [简体中文](README.zh-CN.md)

Watch Token usage from your local MiniMax Code runtime in near real time: consumption over time, output speed, cache hit rate, per-model comparison, and recent requests. Filter by time range, model, and session.

Author: [yanhy2000](https://github.com/yanhy2000) · Version: `1.1.0`

![Token Usage Board with synthetic data](docs/preview.png)

*The preview uses synthetic sessions and usage data. The app interface is currently in Chinese.*

## Install and use

Copy this entire directory into the `plugins/` directory of your active MiniMax Code data directory. By default, `<dataDir>` is `.minimax` in your home folder (`~/.minimax`), so the default installation path is:

```text
<dataDir>/plugins/mcode-usage-monitor/
```

Include the hidden `.minimax-plugin` directory. Restart a version of MiniMax Code that supports MiniApps and confirm that the plugin is recognized and enabled, then open "Token 用量看板" or ask the Agent to open it.

The page opens on the last 24 hours. You can switch between 1 hour, 24 hours, 7 days, 30 days, and all time, and filter by model and session with multi-select. Filters, time range, refresh interval, and theme are remembered between visits. The page refreshes every 10 seconds by default (5 s / 10 s / 30 s / manual).

This app requires **Python 3.8+** on the local machine to read the local database. It uses only the standard library, so no `pip install` is needed. No API key or other configuration is required.

## Data access and counting

The app reads two local sources:

- `<dataDir>/v2/sqlite/runtime-state.sqlite`, opened through the SQLite backup API as a read-only in-memory snapshot, so it does not lock or disturb a running client.
- `<dataDir>/v2/sessions`, scanned for real session files (`messages.jsonl`) to build the session list.

Counting rules:

- Token usage = input + cache-read + output. Cache hit rate = cache-read / (cache-read + input).
- Rows are de-duplicated by `msg_id` across sessions: when a session is rebuilt, its earlier messages are copied into the new session, and the app counts them once.

This is a local, near-real-time view. The in-product usage page (Settings → Usage) is the authoritative source for billing and quota; its numbers come from server-side statistics, which lag behind the local database (measured to catch up within about a day in our testing) and may use different rules.

The runtime sends nothing to external services and has no telemetry. It writes a single preferences file (`prefs.json`) into the Host-provided plugin data directory. The page shows real session titles, so take care when sharing screenshots or your screen.

## Source and verification

The page is in `miniapp/client/index.html` (ECharts is bundled locally), the Node entry is `miniapp/node/server.mjs`, and the data backend is `miniapp/node/api.py`. No build step is required.

Verified environment: MiniMax Code desktop `3.0.73.166` on Windows (10.0.26200, x64). Verified during development: plugin install and open, aggregation and de-duplication, model/session filtering, preference persistence, auto refresh, theme switching, and chart and table rendering. macOS and Linux are unverified.

Third-party components: [ECharts](https://echarts.apache.org/) (Apache License 2.0), bundled locally for offline use.

## License

[MIT](LICENSE).
