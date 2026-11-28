# Token Usage Widget / Token 用量悬浮窗

A floating dial that shows how much of your MiniMax account's Token quota you have used, how fast
you are spending it, and how much you used over the last 7 days. Pop it out of the side panel into
its own always-on-top window, hover the dial to open the detail panel, and configure which metrics
it shows from the settings page.

[简体中文](README.zh-CN.md)

## What it shows

The dial carries three readings at once, and you choose each one:

- **Centre readout** — one metric as a number, for example today's Token total.
- **Water level** — how full the current 5-hour or 7-day cycle is, drawn as water inside the glass.
- **Outer ring** — a third metric as a progress ring: a cycle's usage, a reset countdown, or the
  share of the current 5-hour cycle that your present speed would burn.

Hovering the dial opens a detail panel that lists every metric you enabled, the last 7 days as a
sparkline, and one line each naming the metric behind the centre, the water and the ring — so a
rate-driven ring never leaves you guessing which reading it stands for.

Every metric comes from your MiniMax account. The trend curve on the dial is the difference of the
account's live Token counter, and its window is yours to pick: 10 minutes, 30 minutes, 60 minutes
or 2 hours.

The settings page covers:

- **Displayed metrics** — check, uncheck and reorder the metrics in the detail panel.
- **Refresh rate** — from 3 seconds to 1 minute.
- **Widget window** — size across 5 steps, position reset, and the window the trend curve covers.
- **Dial display** — which metric fills the centre, the water and the ring.
- **Appearance** — theme (follow system, light or dark) and **language** (follow system, 简体中文 or
  English).
- **Data sources** — whether the account feed is reachable.

The window remembers its size and position between runs, and the page follows the system language
unless you pick one explicitly.

## Install and open

1. Download or copy this plugin directory, then install it as a local plugin in MiniMax Code
   (see the MiniMax Code plugin documentation for the local-plugin folder).
2. Open **Plugins** in MiniMax Code and enable *Token Usage Widget*.
3. Open it from the plugin list, or ask the Agent to "open the Token Usage Widget".
4. Press **Popup mode** on the page to pop the widget into its own always-on-top window.

The widget needs a signed-in MiniMax Code account: the 5-hour and 7-day cycle progress, today's
total and the last 7 days come from the MiniMax account API, and the rate and the trend come from
the difference of that account's live Token counter. When the account feed cannot be reached, the
widget says so under **Data sources** instead of showing a number it cannot stand behind.

## Tested environment

- MiniMax Code 3.1.19 on macOS 26.6.2.
- Minimum client version: **MiniMax Code 3.1.2** — the manifest declares `surface.window`, which
  older clients reject.
- Installed locally, published through the Host, then checked in the in-app Browser: the dial
  renders, the water level and the outer ring each follow their own metric, hovering opens the
  detail panel with all three enabled metrics visible and no scrolling, the 7-day sparkline draws,
  and the console stays free of errors and warnings.
- The trend window was exercised at all four settings. The service returns one bucket per minute of
  the chosen window (10, 30, 60 or 120 buckets), the curve is redrawn with that many points, and
  the accessible label names the window.
- Both languages were exercised. With the language set to follow the system the page renders in
  the system language; switching the setting to 简体中文 or English re-renders the dial, the detail
  panel, the settings page, the metric names and the accessible labels in place.
- Not verified: the widget was not exercised on Windows, and the separate desktop window was
  verified through the in-app Browser rather than as a floating window on the macOS desktop.

## Data & access

### Files read

One file that belongs to MiniMax Code itself is read. The Host offers no API for it, so this relies
on an **unspecified internal layout** that may change between client versions.

| File | Why it is read |
| --- | --- |
| `<runtime root>/auth/**/auth.json` | The signed-in MiniMax Code access token. It is used only inside the Node process to call the account API, and never reaches the page, a log message or a response body. |

The runtime root is resolved by trying `$MINIMAX_DATA_DIR`, `$MAVIS_DATA_DIR` and `$MCODE_DATA_DIR`
first, then `~/.minimax`. The layout underneath it is undocumented and may change; the widget
degrades to "this feed is unavailable" instead of failing when a path moves.

### Files written

Only inside the Host-provided `context.dataDir`, which this Mini App treats as opaque:

- `settings.json` — the enabled metrics, refresh rate, theme, language, scale, the trend window, the
  centre / water / ring assignment and the window position. Written atomically: a temporary file in
  the same directory, then renamed over the target.
- `account-rate.json` — the sampling history that turns the account's quota percentage into a
  Token rate: quota samples, the account's daily total samples and the live Token counter samples.
  It holds Token counts and timestamps only — never a credential. Written atomically.

No file outside `context.dataDir` is created, edited or deleted.

### Network hosts

- `https://api.minimax.cn` — the MiniMax account API for the region you are signed in to.
- `https://api.minimax.io` and `https://api.minimaxi.com` — the same account API for the other
  MiniMax regions. The host is chosen from your login region.

Requests go to `/backend/account/token_plan/remains_percent`, `/usage_summary` and
`/usage_overview`. The access token is sent as an `Authorization` header to that account host
only. Nothing else leaves the machine.

### Spawned processes

None. The Mini App starts no child process.

### Everything else

- **Agent turns**: none. The Mini App never runs an Agent turn.
- **Conversations read**: none.
- **Tools called**: none.
- **Microphone, camera, notifications**: none.
- **Host navigation**: not read. The page does read the MiniMax Code **theme** and **language**, so
  it can follow the system; neither needs a permission declaration.
- **State**: the durable state above lives in `context.dataDir`. The widget's size and position,
  and whether the page is showing the widget or the settings view, are kept in `sessionStorage`
  and `localStorage` as view preferences.

## License

MIT — see [LICENSE](LICENSE).
