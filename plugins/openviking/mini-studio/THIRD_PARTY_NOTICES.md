# Third-party notices

Everything below is compiled by `npm run build` (Vite) into `miniapp/client/static/assets/`.

## OpenViking Studio (volcengine/OpenViking `web-studio`)

- Source: <https://github.com/volcengine/OpenViking/tree/main/web-studio>, revision `df4a0a042`.
- License: GNU AGPL-3.0 (the OpenViking main project license), the same license as this package.
- Copied: `src/components/ui/{button,badge,dialog,input,scroll-area,separator,switch,tabs,tooltip}.tsx`,
  `src/lib/utils.ts`, the design tokens and base layer in `src/styles.css`, and the OpenViking
  wordmark `src/assets/brand-lockup-{light,dark}.svg` (from `docs/images/`). The tree / column
  styling follows `web-studio/src/routes/resources/-components/item-column.tsx`.
- Changes: removed the i18n dependency from `dialog.tsx` (fixed English label); dropped Studio's
  streamdown, highlight.js and typography imports from `styles.css`; Noto Sans limited to the Latin
  subset. The OpenViking name and logo are trademarks of their owners and identify the service this
  package connects to.
- Studio's `components/ui` are themselves based on shadcn/ui (MIT, Copyright (c) 2023 shadcn).

## Atlas (atlas-fs)

- Source: <https://github.com/ZaynJarvis/atlas-fs>, branch `feat/studio-components`.
- Author: Zayn Jarvis (also the author of this package). The upstream repository has no LICENSE
  file; the copies here are distributed under this package's license by the author.
- Copied: `src/legacy/fs-api.js`, `openviking-adapter.js`, `renderers.jsx`, `renderers.css`;
  `src/App.jsx` is the Studio-components rewrite of the Atlas shell.
- Changes: `renderers.jsx` exports its functions instead of writing to `window`; `renderers.css`
  variables are renamed (`--a-*`) and mapped onto Studio tokens.

## npm packages bundled into the Client

- React 19 and React DOM (MIT, Meta Platforms, Inc. and affiliates)
- @base-ui/react (MIT, MUI SAS / Base UI contributors)
- lucide-react (ISC, Lucide contributors)
- class-variance-authority (Apache-2.0, Joe Bell)
- clsx (MIT, Luke Edwards); tailwind-merge (MIT, Dany Castillo)
- Tailwind CSS (MIT, Tailwind Labs) and tw-animate-css (MIT, Luca Bockmann): generated CSS only
- @fontsource-variable/noto-sans: Noto Sans font files under the SIL Open Font License 1.1

## Build-time only (not shipped)

- Vite, @vitejs/plugin-react, @tailwindcss/vite, shadcn (CSS variants only); all MIT.
