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

## Maiyatang (麦芽糖)

The optional bundled `octopus-girl-v2` pet is a coral-pink, full-body chibi octopus girl named Maiyatang. It is a MiniMax-inspired fan character contributed by [Fectivnfy112357](https://github.com/Fectivnfy112357), not an official MiniMax character or an additional plugin. Copyright (c) 2026 Fectivnfy112357; distributed under the [MIT License](LICENSE).

The artwork was created on 2026-11-08 through the MiniMax Octopus Studio character-design workflow, using OpenAI imagegen and a user-supplied character reference. Individual action and gaze sheets were generated, then their frames were cropped, fitted proportionally, padded with transparency and assembled with Pillow. Deterministic color calibration with Pillow and NumPy matches the pink and lavender palette across animation and look rows to the lighter look-pose palette, preserving the atlas alpha channel byte for byte. The image generator is not deterministic. The final atlas is committed directly; the geometric robot generator does not reproduce or overwrite it. No third-party pet spritesheet was copied, and the reference images are not shipped.

The static, non-interlaced 8-bit RGBA PNG is 1536 × 2288 pixels, with 57 animation cells and 16 look poses. It follows the existing v2 layout and player timing, including the six-frame, 6600 ms idle cycle; it does not add FPS fields, change the player or claim 30 fps playback. Light/dark composites, full-body silhouettes and the four cardinal gaze poses were visually inspected. The packaged artwork validator decodes the actual PNG and checks every valid cell and the transparent unused cells; this does not prove artistic quality or smooth motion. The exact atlas was imported and selected through the local plugin UI on Linux; this is not acceptance of a bundled installation on macOS, Windows or the desktop window.

No externally sourced pet spritesheet is included. User-imported artwork is not part of this distribution and keeps its own license.
