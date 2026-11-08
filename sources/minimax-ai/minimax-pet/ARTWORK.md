# MiniMax Pet artwork

The bundled `minimax-original` and `minimax-tako` pets and `icon.png` are distributed under the plugin's [MIT License](LICENSE). Copyright (c) 2026 MiniMax.

## Default pet atlas

The default mint robot is original geometric artwork. Its editable source is `scripts/generate-pet-art.mjs` in `sources/minimax-ai/minimax-pet`. It draws the character and encodes the atlas using Node built-ins, without loading external images, fonts, or models. To regenerate the atlas:

```sh
npm run generate:art
```

The generated atlas is 1536 × 2288 pixels: eight 192 × 208 cells per row, nine animation rows and two rows of look directions. It is compatible with the existing player, including idle, running, waving, jumping, failure, waiting, work and review poses. Tests compare decoded atlas pixels with a fresh deterministic generation, so PNG compression differences between Node releases do not change the atlas contract. This command preserves the separately authored `icon.png`.

## MiniMax Code octopus girl (`minimax-tako`)

The second bundled pet, shown as “MiniMax Code 章鱼娘”, is an original chibi octopus girl: pink hair, round glasses, a red sound-wave hair clip, a white blouse with a wine-red bow, and wine-red tentacles with pink suckers. It was made on 2026-11-08 with MiniMax image generation, using user-provided character images as visual references for proportions and colors. The reference images are not included in the package.

The model generated a character sheet, frame grids for each animation and nine gaze poses on a flat chroma-key background. A local script removed the background, sliced the frames, scaled them to a shared standing height and foot baseline, and assembled the exact 1536 × 2288 v2 atlas. The left-running row and the left half of the look directions are mirrored from their right-side counterparts. A small head offset strengthens each look direction. Model generation is not deterministic, so this atlas has no regeneration command; the PNG itself is the source.

Tests run the packaged Skill validator on the shipped atlas (decoded PNG, exact size, all 73 cells non-empty with transparent backgrounds, no warnings), and the HTTP smoke test checks that both bundled pets are listed and served. Character consistency, motion and gaze direction were reviewed visually; the validator cannot judge them. Its id sorts after `minimax-original`, so the mint robot stays the default pet for a fresh profile.

## Plugin icon

The icon shows a purple octopus emerging through a mint desktop window, resting its tentacles over the front sill and waving. This ties the character to the desktop-companion concept. It was generated with OpenAI imagegen on 2026-10-26, using a user-provided octopus character image as a visual reference, then exported as a 512 × 512 transparent PNG for small plugin-icon surfaces. It is a separate asset, not a frame from the default robot atlas. The reference image is not included in the package, and the geometric atlas generator does not reproduce or overwrite this icon.

The icon was reviewed on light and dark backgrounds and at small display sizes. Tests decode the actual PNG and check its square canvas, visible content and transparency; they do not claim deterministic model reproduction. The source/distribution package check compares every shipped file byte.

No externally sourced pet spritesheet is included; both bundled atlases are original MiniMax artwork. User-imported artwork is not part of this distribution and keeps its own license.
