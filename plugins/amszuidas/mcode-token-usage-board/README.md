# Token Usage Board

English | [简体中文](README.zh-CN.md)

View daily Token usage from your local MiniMax Code sessions. Filter by date, model, or session, and explore summaries grouped by day, model, or session.

Author: [amszuidas](https://github.com/amszuidas) · Version: `1.0.0`

![Token Usage Board with synthetic data](docs/preview.png)

*The preview uses synthetic sessions and usage data. The app interface is currently in Chinese.*

## Install and use

Copy this entire directory into your active MiniMax Code data directory. By default, `<dataDir>` is `.minimax` in your home folder (`~/.minimax`), so the default installation path is `~/.minimax/plugins/mcode-token-usage-board/`. If you have configured a different data directory, use that directory instead:

```text
<dataDir>/plugins/mcode-token-usage-board/
```

Include the hidden `.minimax-plugin` directory. Restart a version of MiniMax Code that supports MiniApps and confirm that the plugin is recognized and enabled. Open “Token 用量看板” (Token Usage Board), or ask the Agent to open it in a conversation.

Choose today, the past 7 days, the past 30 days, or all time, and optionally filter by model or session. Click “刷新” (Refresh) to update the data; the page also refreshes every 60 seconds. No API key or additional dependency installation is required.

## Data access and counting

The service searches upward from the Host-provided `context.dataDir` for `v2/sessions`. If none is found, it falls back to `.minimax/v2/sessions` in your home directory. It reads `manifest.json` and `messages.jsonl` from session directories to extract usage, model names, session IDs, and titles derived from the first meaningful user text.

Usage is grouped by day in your local time zone. The total adds input, output, cache-read, and cache-write Tokens; it is not an official billable Token count or invoice. The app depends on the client's session file format. Missing usage fields or format changes may result in incomplete statistics.

The runtime does not write local files or upload data to external services. It has no telemetry or credential configuration, and its cache stays in process memory. The page displays actual session titles, so take care when sharing screenshots or your screen.

## Source and verification

The page is in `miniapp/client/index.html`, and the Node service is in `miniapp/node/server.mjs`. No build step is required.

Checks performed when adding this app covered usage aggregation, data refresh, error handling, and service shutdown with synthetic sessions, plus a browser preview. Installation in the actual MiniMax Code desktop app has not been verified as part of this contribution. The minimum supported client version and compatibility across operating systems remain unconfirmed.

## License

[MIT](LICENSE).
