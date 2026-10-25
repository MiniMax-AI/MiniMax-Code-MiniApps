# Vendored browser automation library

`puppeteer-core.cjs` is a bundled build of [Puppeteer Core][puppeteer], the
browser automation library the standalone export runner drives the renderer's
headless Chrome or Edge with.

The bundle holds more than Puppeteer. It holds `puppeteer-core` **and the 55
runtime packages that Puppeteer pulls in** - 56 packages and 494 files of code
in all. Every one of them is third-party code, and this package ships it as
such: [`licenses/INVENTORY.md`](licenses/INVENTORY.md) lists every package with
its version, its licence and the text of that licence, and `licenses/` holds
one copy of each licence text. The full table is read back from the build's own
metafile, which ships next to the bundle as
[`bundle-meta.json`](bundle-meta.json) - it is not a list written by hand.

| | |
| --- | --- |
| Package | `puppeteer-core` |
| Version | 24.10.2 |
| Licence | Apache-2.0 |
| Source | <https://registry.npmjs.org/puppeteer-core/-/puppeteer-core-24.10.2.tgz> |
| Upstream | <https://github.com/puppeteer/puppeteer> |

## Why a bundle

The npm package ships 1528 files (sources, type declarations, source maps and
two module formats) and pulls in a dependency tree of 4000 files. A Mini App
package may hold at most 1024 files, so the tree cannot be vendored as it is.
The bundle is the published CommonJS build of `puppeteer-core` compiled into
one file with [esbuild][esbuild] 0.25.9.

## How it was built

The build runs from the repository root, and that matters: esbuild writes the
path of every module it reads into the bundle, so the same command run from
another directory produces different bytes. Run from the root, it produces
these bytes, every time:

```sh
esbuild .fablecut-acceptance/export-dev/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js \
  --bundle --platform=node --target=node20 --format=cjs \
  --drop:console --minify-syntax --minify-whitespace \
  --legal-comments=inline \
  --outfile=plugins/klarkxy/minimax-cut/miniapp/node/vendor/puppeteer/puppeteer-core.cjs \
  --metafile=plugins/klarkxy/minimax-cut/miniapp/node/vendor/puppeteer/bundle-meta.json
```

| | |
| --- | --- |
| esbuild | 0.25.9 - `https://registry.npmjs.org/esbuild/-/esbuild-0.25.9.tgz` |
| puppeteer-core | 24.10.2 - `https://registry.npmjs.org/puppeteer-core/-/puppeteer-core-24.10.2.tgz` |
| Output | `puppeteer-core.cjs`, 2 970 650 bytes |
| SHA-256 | `8a7a45c8f360898ce66dc6457a46997bfcfca3ec207a87c5e2e158fa44483959` |
| Metafile | `bundle-meta.json`, SHA-256 `76a197e7f35bbab4ff1174222b04e4398014c05757d9364b84df3e3dbf162faa` |

The dependency versions come from `.fablecut-acceptance/export-dev/package-lock.json`,
which pins every package in the tree with its integrity hash;
`licenses/INVENTORY.md` lists those hashes beside the licences.

Nothing is patched and no library code is removed. `--legal-comments=inline`
keeps the licence headers of the bundled packages in the file - but only the
headers: most of these packages keep their notice in a separate `LICENSE`
file, which no bundler can see. That is why `licenses/` holds a copy of each
licence text, taken from the package itself, or - for the three packages whose
npm tarball ships none - from the upstream project. `--drop:console` removes
the library's own `console.*` calls: the bundle only ever runs inside the
standalone runner, which has its own logging, and the repository's rules say
that a process the Host owns never writes to stdout. Errors still arrive as
exceptions, which the runner reports. `--minify-syntax --minify-whitespace`
strips the comments and the formatting of the published build; no identifier is
renamed.

## What is inside

56 packages, 494 files of code. The full list, with versions, licences and
integrity hashes, is in [`licenses/INVENTORY.md`](licenses/INVENTORY.md). By
licence:

| Licence | Packages |
| --- | --- |
| MIT | 36 |
| ISC | 7 |
| Apache-2.0 | 6 |
| BSD-2-Clause | 5 |
| BSD-3-Clause | 1 |
| 0BSD | 1 |

`puppeteer-core` and `@puppeteer/browsers` are Apache-2.0 and share the
upstream project's licence file, which names `Copyright 2017 Google Inc.` in
its appendix. `degenerator` is MIT and its notice names
`Copyright (c) 2013 Nathan Rajlich <nathan@tootallnate.net>`.

## What it does not do

The bundle downloads nothing. It has no browser of its own: the runner passes
an `executablePath` for the Chrome or Edge already installed on the machine,
and it never installs a browser or changes the system.

[puppeteer]: https://pptr.dev/
[esbuild]: https://esbuild.github.io/
