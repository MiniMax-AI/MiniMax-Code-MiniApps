# 天气 · 新闻看板

A standalone Mini App that shows live weather, A-share and international commodity quotes, and six
switchable news columns in one dashboard page.

- **实时天气** — current temperature, weather condition, apparent temperature, humidity and wind
  speed, plus a three-day forecast with precipitation probability. The city can be typed in Chinese
  (for example `南京`); **切换** cycles through the places that share that name.
- **自选股** — a personal watchlist of A-share codes, index names (`沪深300`, `科创50`) and
  international symbols (gold, silver, crude oil, Bitcoin futures, SGE gold 9999). Prices refresh
  on their own interval, separately from the weather and news interval, and the card ends with a
  count of the rising, falling and unchanged entries.
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
a size saved on a wide screen can never squash a card on a narrow one. The cards that share a row are kept inside the container as well: when their widths no longer fit, the overflow is taken back proportionally, so equally wide cards shrink evenly instead of one of them always giving way first, and while a card is being dragged its neighbour gives way instead of letting the board run past the edge. The size shown while dragging is the size that is actually applied.

Each card carries a focus button in its header: it hides the other two and gives that card the
whole board, and the same button — or **Exit focus** in the top bar — brings the full board back.

While a card is being resized, every card that shares its row shows the width range it can still
take, so it is visible when a neighbour has already given everything it can. The size badge shows
the same range next to the current size.

The resize handle is a real button: with it focused, the arrow keys change the width and the
height of that card — Shift makes the step larger — and Home puts the card back to its automatic
size.

Precious metals are always shown in **CNY per gram**. The raw USD-per-ounce quote and the FX rate
used for the conversion are kept in the row's tooltip, so the displayed number and the source
figure can be compared.

The board also keeps working while its own service is still coming up. The Host stops the Mini App
process whenever the page is hidden, so a page that is brought back to the front can find the
service gone. A request that cannot reach the service — no response at all, or a response that is
not JSON — is retried with a growing backoff of 0.4 s, 0.8 s, 1.6 s, 3.2 s, 6.4 s and 10 s, and
the title bar shows how long the next attempt will take. A request that does reach the service but
fails because of an upstream source is not retried, so a broken source never looks like a broken
service. Once the retries are used up the title bar says the service is not ready, and the next
automatic refresh picks the board up again. Adding or removing a watchlist entry is retried the
same way, which is safe because both operations are idempotent on the server.

The width arithmetic is kept apart from the DOM: the client carries the pure functions in a
`<script id="wnb-layout">` block, and `tests/layout.test.mjs` takes that block apart and runs it
under Node's built-in test runner. The tests cover the column breakpoints, the per-row width
ceiling, the proportional pull-back and the clamping, so a change to the layout rules can be
checked without opening the app:

```sh
node --test "plugins/lixiangroir-ideal/weather-news-board/tests/*.test.mjs"
```

That block is the code the page itself runs, so the tests and the app cannot drift apart.

## Install and open

1. Install the plugin in MiniMax Code.
2. Open the **天气 · 新闻看板** Mini App from the plugin entry, or ask the Agent to open it.

The app needs no configuration, no account, and no build step. Everything it shows is fetched
live from public sources at runtime.

In the watchlist, add a six-digit A-share code (`600519`), a prefixed code (`sh600519`, `sz000001`,
`bj430047`), the name of an index (`上证指数`, `沪深300`, `创业板指`, `科创50`, `中证500`, `北证50`) or
of one of the common ETFs (`沪深300ETF`, `创业板ETF`, `科创50ETF`), or the name of a supported symbol
(`黄金`, `伦敦金`, `黄金9999`, `白银`, `原油`, `比特币`). Index codes carry their exchange explicitly,
because `000001` is 平安银行 in Shenzhen and 上证指数 in Shanghai. Codes are validated against a fixed
allow list on the server; anything else is rejected.

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
  cards set to 900 px at 640 px and 1100 px container widths; three cards stored at 900 px inside a
  1052 px column settle at 340 px each rather than 260/260/500 px, so the cards that share a row
  shrink evenly; a handle dragged past the right edge made the neighbour card shrink to its minimum
  width instead of letting the board overflow, and the size shown in the drag badge was the one
  actually applied (458 px) rather than the one the pointer had reached (751 px); a vertical
  scrollbar appearing once the content had rendered took 15 px off the available width, and the
  stored sizes were pulled back to match; dragged the resize handle of each of the three cards
  in turn and confirmed that the card took exactly the dragged width and height, that the other two
  cards kept their own sizes, that a card with a hand-set height scrolls its content inside, and
  that the sizes were stored per card; clicked one handle to reset that single card and used the
  top-bar reset button to clear all three; reloaded the page and confirmed the per-card sizes came
  back; checked the dark theme; added and removed watchlist
  entries; switched every news tab; confirmed that one auto-refresh cycle advances the quote
  timestamp and the price; confirmed that two news requests without the refresh flag return the
  same timestamp while the same request with it returns a new one; read back all six news columns
  and the quote list and confirmed every returned link starts with https; reloaded the page and
  confirmed the watchlist, the selected tab, and the theme persisted; made the service unreachable
  and confirmed the board fell back to the backoff retries — the title bar counted down 1 s, 2 s,
  4 s, 7 s and 10 s, then reported the service as not ready once the retries were used up, and the
  board recovered on the next refresh with `/api/board` and `/api/stocks` answering 200 and the
  notice disappearing; repeated that with the service down for 25 s and confirmed the notice never
  settled on a state that did not match reality; added a watchlist entry while the service was down
  for 3 s and confirmed the write was retried and applied once the service came back, then removed
  the entry again; entered focus mode on the weather card and confirmed that the other two cards
  were hidden, that the focused card took the full 734 px board width, that the top bar offered
  **Exit focus**, and that leaving focus mode brought all three cards back; dragged a card handle
  and confirmed that every card in the same row showed the width range it could still take
  (260–458 px) while the card in the row below showed none, and that the size badge carried the
  same range without being cut off at the viewport edge; resized a card from the keyboard and
  confirmed that ArrowRight widened it by 16 px, Shift+ArrowRight by 64 px, ArrowDown grew the
  height by 16 px, Shift+ArrowLeft narrowed it by 64 px, and Home put the card back to its
  automatic size with a confirmation toast; typed 沪深300 into the watchlist and confirmed that the
  row that appeared was 沪深300 on sh000300 with a live quote, and that 科创50ETF resolved to
  sh588000; walked the rest of the index and ETF list through the API one by one and confirmed that
  上证指数 (sh000001), 深证成指 (sz399001), 创业板指 (sz399006), 科创50 (sh000688),
  上证50 (sh000016), 中证500 (sh000905), 中证1000 (sh000852), 创业板50 (sz399673),
  北证50 (bj899050), 沪深300ETF (sh510300), 上证50ETF (sh510050), 创业板ETF (sz159915),
  科创50ETF (sh588000), 证券ETF (sh512880) and 中概互联网ETF (sh513050) each returned a quote;
  confirmed that an unknown name is rejected with the allow-list message and that the watchlist was
  left unchanged afterwards. Console showed 0 errors and 0
  warnings; the network showed no failed requests.
- Not verified: the Baidu hot-board fallback and the Sina/Tencent quote fallbacks were exercised
  only against their endpoints directly, because the primary sources kept succeeding and the
  fallback branches never ran in the live app.
- The package's own self-tests live in `tests/` — `layout.test.mjs` for the layout arithmetic and
  `security-aliases.test.mjs` for the index and ETF names — and run with Node's built-in test
  runner: `node --test "plugins/lixiangroir-ideal/weather-news-board/tests/*.test.mjs"` — 24 cases,
  all passing on Node.js 24.16.0. The repository's `npm run check` only runs the repository's own
  tests, so this command has to be run separately.
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
