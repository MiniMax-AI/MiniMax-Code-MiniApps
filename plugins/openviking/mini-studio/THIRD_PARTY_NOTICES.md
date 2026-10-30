# Third-party notices

## Atlas (atlas-fs)

- Source: <https://github.com/ZaynJarvis/atlas-fs>, revision `8be0cf1`.
- Author: Zayn Jarvis (also the author of this package). The upstream repository has no LICENSE
  file; the copies here are distributed under this package's license by the author.
- Vendored: `fs-api.js`, `openviking-adapter.js`, `styles.css`, `views.css`, `renderers.css`,
  `search-overlay.css` (in `miniapp/client/`) and `views.jsx`, `ui-helpers.jsx`, `renderers.jsx`,
  `search-overlay.jsx` (in `src/`, compiled to `miniapp/client/build/`). `src/app.jsx` is derived
  from the app script in `Atlas.html`.
- Changes: removed the Google Fonts `@import` from `styles.css` (system font fallbacks are used);
  exported `TreeResizer` from `ui-helpers.jsx` so the precompiled scripts can share it; replaced the
  mock backend, Tweaks panel, service worker, and in-page API key field with a connection form backed
  by the Node runtime; added the "+ URI" / "+ Content" chat actions.

## React 18.3.1

- `miniapp/client/vendor/react.production.min.js`, `react-dom.production.min.js` (UMD builds from
  the npm packages `react@18.3.1` and `react-dom@18.3.1`).
- MIT License, Copyright (c) Meta Platforms, Inc. and affiliates. Full text in
  `miniapp/client/vendor/LICENSE-react.txt`.

## Build-time only (not shipped)

- esbuild 0.28.2 (MIT), used by `scripts/build.mjs`.
