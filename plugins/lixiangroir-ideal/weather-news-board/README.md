# 天气 · 新闻看板

A standalone Mini App that shows live weather, A-share and international commodity quotes, and six
switchable news columns in one dashboard page.

- **实时天气** — current temperature, weather condition, apparent temperature, humidity and wind
  speed, plus a three-day forecast with precipitation probability. The city can be typed in Chinese
  (for example `南京`); **切换** cycles through the places that share that name.
- **自选股** — a personal watchlist of A-share codes and international symbols (gold, silver, crude
  oil, Bitcoin futures, SGE gold 9999). Prices refresh on their own interval, separately from the
  weather and news interval.
- **新闻** — six tabs: 要闻, 时政, 科技, 财经, 热榜 (Toutiao hot board) and 知乎日报.

Precious metals are always shown in **CNY per gram**. The raw USD-per-ounce quote and the FX rate
used for the conversion are kept in the row's tooltip, so the displayed number and the source
figure can be compared.

## Install and open

1. Install the plugin in MiniMax Code.
2. Open the **天气 · 新闻看板** Mini App from the plugin entry, or ask the Agent to open it.

The app needs no configuration, no account, and no build step. Everything it shows is fetched
live from public sources at runtime.

In the watchlist, add a six-digit A-share code (`600519`), a prefixed code (`sh600519`, `sz000001`,
`bj430047`), or the name of a supported symbol (`黄金`, `伦敦金`, `黄金9999`, `白银`, `原油`,
`比特币`). Codes are validated against a fixed allow list on the server; anything else is
rejected.

## Tested environment

- MiniMax Code **3.1.19** on **Windows 11** (Windows 10.0.26200, x64), Node.js 24.16.0.
- Client acceptance exercised: published and opened the Mini App; confirmed the page is not blank
  and that landmarks, headings, tabs, and controls are reachable; measured the 640 px layout
  (two columns, weather card and watchlist card bottoms aligned at the same y); checked the
  >= 900 px three-column layout and the dark theme; added and removed watchlist entries;
  switched every news tab; confirmed that one auto-refresh cycle advances the quote timestamp and
  the price; reloaded the page and confirmed the watchlist, the selected tab, and the theme
  persisted. Console showed 0 errors and 0 warnings; the network showed no failed requests.
- Not verified: the Baidu hot-board fallback and the Sina/Tencent quote fallbacks were exercised
  only against their endpoints directly, because the primary sources kept succeeding and the
  fallback branches never ran in the live app.
- The package declares no `agentAccess`, `toolAccess`, `deviceAccess`, `hostAccess`, or
  `surface.window`, so no minimum client version beyond the base Mini App runtime is required.

## Data & access

- **Files read** — `miniapp/client/index.html` from the installed package, served on the assigned
  loopback port.
- **Files written** — `watchlist.json` in the Host-provided `context.dataDir`, written atomically
  (temporary file plus rename). The directory location is opaque and chosen by the Host.
- **Browser storage** — `localStorage` holds view preferences only: the selected news tab, the two
  refresh intervals, the current city, and the light/dark theme. No market or article data is
  stored there.
- **Network hosts** (all read-only, outbound HTTPS from the Node service):
  `wttr.in`, `geocoding-api.open-meteo.com`, `www.chinanews.com.cn`, `www.ithome.com`,
  `sspai.com`, `www.yicai.com`, `www.toutiao.com`, `top.baidu.com`, `news-at.zhihu.com`,
  `push2.eastmoney.com`, `hq.sinajs.cn`, `qt.gtimg.cn`.
- **Spawned processes** — none. All upstream calls are made with the Node runtime's own `fetch`.
- **Agent turns** — none. The app never starts an Agent run.
- **Conversations read** — none.
- **Tools called** — none.
- **Microphone, camera, notifications** — not used.
- **Host navigation read** — not used.
- **Declared access** — none beyond the standard Mini App runtime. The manifest declares no
  `hostConnectorAccess` provider, no `agentAccess`, no `toolAccess`, no `deviceAccess`, and no
  `hostAccess`.

[简体中文](README.zh-CN.md)
