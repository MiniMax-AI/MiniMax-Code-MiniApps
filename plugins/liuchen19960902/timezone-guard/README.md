# A/时差保安 (Timezone Guard)

[English](README.md) | [简体中文](README.zh-CN.md)

One clock, one verdict: is it a reasonable time to message someone in another time zone? The verdict
follows the **other** city's local time, because what matters is whether *they* are awake.

> **The interface is Chinese only.** The plugin name, the verdict, the city names, the time periods
> and the date format are all in Chinese. This README and `README.zh-CN.md` are the two languages it
> ships in; the page itself has no language switch.

Author: [FineCat](https://github.com/LiuChen19960902) · Version: `1.0.2`

![A/时差保安 showing the verdict, with the target city clock above the local one](docs/preview.png)

*The page itself is in Chinese. This screenshot is the light theme, taken while Los Angeles was at
20:23 (the evening band); the dark theme is below.*

![A/时差保安 in the dark theme](docs/preview-dark.png)

## What it answers

**Whether to speak up right now.**

The verdict reads the **target city's local time**, not yours — it is their convenience that
matters. Your own city is shown for reference only. The thresholds are the same for every city,
regardless of hemisphere or local habits.

| Target local time | Band | Verdict |
| --- | --- | --- |
| 09:00–18:00 | Day (green) | Now is fine |
| 18:00–22:00 | Evening (yellow) | Keep it short |
| 06:00–09:00 | Early morning (yellow) | Don't go deep |
| 22:00–06:00 | Night (red) | Go to sleep, don't send |

## What is on the page

- **One verdict** — a 24 px status-coloured headline, the single subject of the page. Colour is
  never the only carrier of meaning; text and shape carry it too.
- **Two clocks** — the target city on top, your own below, each with its date and short time zone
  name (PDT, GMT+8, and so on). 12-hour and 24-hour formats are both available.
- **A 24-cell strip** — one cell per hour of the target city's day, drawn as a sun, a half sun on
  the horizon, or a moon. The current hour is filled with the verdict colour, and the four
  thresholds land exactly on cell boundaries.
- **A one-line tip** — under the verdict, one line reads "their band + time range + one sentence
  of advice", and below it an optional time-difference note appears when your own side is the
  later one. No message templates, no copy button, and nothing is pushed into a chat box.
- **Every time zone** — all 418 time zones the runtime knows about are covered, and in the tables
  shipped with this package each one has a Chinese name (the count follows the runtime's own time
  zone database; a zone the runtime adds later and the shipped tables do not know yet falls back
  to its English name). Country-level entries such as "China (default)" are there too. Either
  city can be changed on its own, and the ⇄ in the title swaps the two in one click.

Times and offsets are computed locally with the browser's `Intl` and the runtime's own time zone
database, so daylight saving time is handled for you. **No network, no account, no push, not a
calendar.**

## Install

Copy the whole directory, **including the hidden `.minimax-plugin` directory**, into the MiniMax
Code plugins directory:

| System | Target path |
| --- | --- |
| Windows | `C:\Users\<you>\.minimax\plugins\timezone-guard` |
| macOS | `/Users/<you>/.minimax/plugins/timezone-guard` |
| Linux | `/home/<you>/.minimax/plugins/timezone-guard` |

`.minimax` is a hidden directory: on Windows enable "Hidden items" in File Explorer, on macOS press
`Cmd + Shift + .`. If your client uses a custom data directory, put the package in that
directory's `plugins/` folder instead.

Then restart MiniMax Code, confirm the plugin is recognised and enabled, and ask the Agent to open
"A/时差保安" — or say "打开A/时差保安，看看洛杉矶现在该不该开口".

To update, close the app and exit MiniMax Code first, then replace the whole plugin directory.

## Tested environment

MiniMax Code desktop **3.1.4** on Windows 11 Home (10.0.26300, x64). This package was developed
and tested against 3.1.4.

Requires MiniMax Code **3.1.2** or later: the package declares `surface.window` (the size of the
popped-out window), so older clients cannot install it at all.

Checked inside the client: install and open; the verdict switches correctly across its four time
bands (day, early morning, evening, night); either city can be changed on its own, and the ⇄ in
the title swaps the pair with one click (checked with a mouse click and with Enter / Space — both
clocks, the time difference, the hour strip, the verdict and the two city inputs all follow the
swap and persist); the city list
covers every time zone the runtime knows about (418 on the tested runtime), each with a Chinese
name and no dead entry; the 12/24-hour toggle persists; both the light and the dark theme render
correctly; the page renders at the panel's default width.

Layout was additionally measured against this package's own client files in Chromium 155 at 400 /
460 / 560 / 680 / 1100 / 1440 CSS pixels wide: no horizontal overflow, no double scrollbar, no
stray whitespace under the card.

**Not verified:** macOS and Linux; popping the page out into its own window (`surface.window`) was
never exercised — the page is a single responsive column either way.

## Data & access

- **Files read** — only the five static files inside its own package directory:
  `miniapp/client/index.html`, `styles.css`, `cities.js`, `time.js`, `app.js`. Nothing outside the
  package is read, and the disk is never scanned.
- **Files written** — none. `context.dataDir` is not used and nothing is written anywhere.
- **Browser storage** — interface preferences only, under the key `timezone-guard.prefs.v1`: the
  selected pair of cities, the theme, and the 12/24-hour format. No session and no content data.
- **Network** — none. The page loads its assets from the plugin's own loopback server; there is no
  telemetry, and no remote font, icon, or script.
- **Processes** — none spawned.
- **Agent turns** — none. The package declares no `agentAccess` and starts no Agent turn.
- **Credentials** — no API key, no account, no configuration of any kind.

## Files

```text
.minimax-plugin/plugin.json   Plugin manifest
package.json                  Mini App declaration
miniapp/miniapp.json          Payload roots, Node entry, page route
miniapp/client/index.html     The page served at /dashboard, including the SVG sprite
miniapp/client/styles.css     Visual layer
miniapp/client/time.js        Pure time calculations — shared by the browser and the tests
miniapp/client/app.js         Verdict, city picker, 24-hour strip
miniapp/client/cities.js      City list and Chinese names for every time zone
miniapp/node/server.mjs       Node entry: start(context) → { dispose }
miniapp/node/miniapp-api.ts   Type declarations for the runtime context
test/time.test.mjs            Unit tests for the time calculations
docs/preview.png              Screenshot of the page, light theme
docs/preview-dark.png         Screenshot of the page, dark theme
icon.png                      Plugin icon
```

The page is plain HTML, CSS, and JavaScript — no framework, no CDN, no build step, fully offline.
The Node entry only serves `/dashboard` and those five files on the port the Host assigns. There
are **no third-party runtime dependencies**: the Node side uses built-in modules only, and the
browser side uses native APIs only.

## Running the tests

`miniapp/client/time.js` holds the time calculations, and the browser and Node run **the same
file** — there is no second copy to keep in sync. The unit tests ship with the package:

```sh
npm test
```

Run it from the package directory. The suite covers the band thresholds landing exactly on the
hour (06:00 / 09:00 / 18:00 / 22:00), offset parsing including non-integral zones such as
`GMT+05:45`, the time-difference wording, and the calendar-day difference used for "still
yesterday".

## License

[MIT](./LICENSE).

<!-- plugin-tests workflow trial, do not merge -->
