# 天气 · 新闻看板

A standalone Mini App that shows live weather, A-share and international commodity quotes, and six
switchable news columns in one dashboard page.

- **实时天气** — current temperature, weather condition, apparent temperature, humidity and wind
  speed, plus a three-day forecast with precipitation probability. The city can be typed in Chinese
  (for example `南京`); **切换** cycles through the places that share that name.
- **自选股** — a personal watchlist of A-share codes and international symbols (gold, silver, crude
  oil, Bitcoin futures, SGE gold 9999). Prices refresh on their own interval, separately from the
  weather and news interval, and the card ends with a count of the rising, falling and unchanged
  entries.
- **新闻** — six tabs: 要闻, 时政, 科技, 财经, 热榜 (Toutiao hot board) and 知乎日报. The refresh
  button in the top bar re-fetches the selected column right away, skipping the 60-second server
  cache.

The whole page reacts to the width of its container rather than to the window size, so it looks the
same whether it is opened in a narrow side panel or on a wide screen. The watchlist is laid out as a
grid that reflows to the available width, so every entry stays on screen instead of pushing the rest
below the fold.

Each card carries its own resize handle in its bottom-right corner. Drag it to set that one card's
width and height: the weather card can be made narrow and short while the watchlist card stays wide,
and every size is remembered separately. The current size is shown while dragging, the content
scrolls inside a card whose height was set by hand, clicking a handle restores that single card to
the automatic size, and a **reset** button in the top bar puts every card back. When the weather
card and the watchlist card sit side by side and neither was sized by hand, they keep the same
height and the space that frees up is filled row by row with the hourly forecast. The three-column
layout applies the same rule explicitly, and there the two cards end up exactly as tall as the
taller of the two. Sizes restored from the browser storage are clamped to the current container, so
a size saved on a wide screen can never squash a card on a narrow one. The cards that share a row are kept inside the container as well: when two of them were sized by hand and their widths no longer fit, the wider one is pulled in, and while a card is being dragged its neighbour gives way instead of letting the board run past the edge.

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
  and that landmarks, headings, tabs, and controls are reachable; drove the layout through CSS
  container queries at 420 px, 640 px, 1100 px, and 1440 px container widths and confirmed the
  dashboard reflows from one column to two to three, that every watchlist entry stays inside its
  card, that no width produces horizontal overflow, and that the watchlist packs into as many
  columns as the available width allows; measured a height difference of 0 px between the weather
  card and the watchlist card in the two-column layout, with the hourly forecast growing and
  shrinking to the space that is actually free; confirmed the same 0 px difference in the
  three-column layout at 1100 px, where all six hourly steps stay visible; loaded a page with an
  out-of-range saved size and confirmed the card was clamped back into the container (5000 x 8 came
  back as 495 x 220) instead of rendering as an extremely wide, flat card; loaded a board whose two
  cards had been sized by hand so that they no longer fitted (260 px + 495 px inside a 734 px
  column) and confirmed the wider card was pulled back to 458 px and that the board's scroll width
  matched its client width, so nothing was cut off on the right; repeated that check with all three
  cards set to 900 px at 640 px and 1100 px container widths; dragged a handle past the right edge
  and confirmed the neighbour card shrank to its minimum width instead of the board overflowing;
  dragged the resize handle of each of the three cards
  in turn and confirmed that the card took exactly the dragged width and height, that the other two
  cards kept their own sizes, that a card with a hand-set height scrolls its content inside, and
  that the sizes were stored per card; clicked one handle to reset that single card and used the
  top-bar reset button to clear all three; reloaded the page and confirmed the per-card sizes came
  back; checked the dark theme; added and removed watchlist
  entries; switched every news tab; confirmed that one auto-refresh cycle advances the quote
  timestamp and the price; confirmed that two news requests without the refresh flag return the
  same timestamp while the same request with it returns a new one; read back all six news columns
  and the quote list and confirmed every returned link starts with https; reloaded the page and
  confirmed the watchlist, the selected tab, and the theme persisted. Console showed 0 errors and 0
  warnings; the network showed no failed requests.
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
  refresh intervals, the current city, the light/dark theme, and the per-card width and height that
  were dragged. No market or article data is stored there.
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
