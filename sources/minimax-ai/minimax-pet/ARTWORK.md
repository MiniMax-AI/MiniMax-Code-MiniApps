# MiniMax Pet artwork

The bundled `minimax-original` pet and `icon.png` are distributed under the plugin's [MIT License](LICENSE). Copyright (c) 2026 MiniMax.

## Default pet atlas

The default mint robot is original geometric artwork. Its editable source is `scripts/generate-pet-art.mjs` in `sources/minimax-ai/minimax-pet`. It draws the character and encodes the atlas using Node built-ins, without loading external images, fonts, or models. To regenerate the atlas:

```sh
npm run generate:art
```

The generated atlas is 1536 × 2288 pixels: eight 192 × 208 cells per row, nine animation rows and two rows of look directions. It is compatible with the existing player, including idle, running, waving, jumping, failure, waiting, work and review poses. Tests compare decoded atlas pixels with a fresh deterministic generation, so PNG compression differences between Node releases do not change the atlas contract. This command preserves the separately authored `icon.png`.

## Plugin icon

The icon shows a purple octopus emerging through a mint desktop window, resting its tentacles over the front sill and waving. This ties the character to the desktop-companion concept. It was generated with OpenAI imagegen on 2026-10-26, using a user-provided octopus character image as a visual reference, then exported as a 512 × 512 transparent PNG for small plugin-icon surfaces. It is a separate asset, not a frame from the default robot atlas. The reference image is not included in the package, and the geometric atlas generator does not reproduce or overwrite this icon.

The icon was reviewed on light and dark backgrounds and at small display sizes. Tests decode the actual PNG and check its square canvas, visible content and transparency; they do not claim deterministic model reproduction. The source/distribution package check compares every shipped file byte.

No externally sourced pet spritesheet is included. User-imported artwork is not part of this distribution and keeps its own license.
