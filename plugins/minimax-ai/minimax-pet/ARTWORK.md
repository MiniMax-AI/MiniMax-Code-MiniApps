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

Tests run the packaged Skill validator on the shipped atlas (decoded PNG, exact size, all 73 cells non-empty with transparent backgrounds, no warnings), and the HTTP smoke test checks that all three bundled pets are listed and served. Character consistency, motion and gaze direction were reviewed visually; the validator cannot judge them. Its id sorts after `minimax-original`, so the mint robot stays the default pet for a fresh profile.

## Plugin icon

The icon shows a purple octopus emerging through a mint desktop window, resting its tentacles over the front sill and waving. This ties the character to the desktop-companion concept. It was generated with OpenAI imagegen on 2026-10-26, using a user-provided octopus character image as a visual reference, then exported as a 512 × 512 transparent PNG for small plugin-icon surfaces. It is a separate asset, not a frame from the default robot atlas. The reference image is not included in the package, and the geometric atlas generator does not reproduce or overwrite this icon.

The icon was reviewed on light and dark backgrounds and at small display sizes. Tests decode the actual PNG and check its square canvas, visible content and transparency; they do not claim deterministic model reproduction. The source/distribution package check compares every shipped file byte.

## Maiyatang (麦芽糖)

The optional bundled `octopus-girl-v2` pet is a coral-pink, full-body chibi octopus girl named Maiyatang. It is a MiniMax-inspired fan character contributed by [Fectivnfy112357](https://github.com/Fectivnfy112357), not an official MiniMax character or an additional plugin. Copyright (c) 2026 Fectivnfy112357; distributed under the [MIT License](LICENSE).

The artwork was created on 2026-11-08 through the MiniMax Octopus Studio character-design workflow, using OpenAI imagegen and a user-supplied character reference. Individual action and gaze sheets were generated, then their frames were cropped, fitted proportionally, padded with transparency and assembled with Pillow. Deterministic color calibration with Pillow and NumPy matches the pink and lavender palette across animation and look rows to the lighter look-pose palette, preserving the atlas alpha channel byte for byte. The image generator is not deterministic. The final atlas is committed directly; the geometric robot generator does not reproduce or overwrite it. No third-party pet spritesheet was copied, and the reference images are not shipped.

The static, non-interlaced 8-bit RGBA PNG is 1536 × 2288 pixels, with 57 animation cells and 16 look poses. It follows the existing v2 layout and player timing, including the six-frame, 6600 ms idle cycle; it does not add FPS fields, change the player or claim 30 fps playback. Light/dark composites, full-body silhouettes and the four cardinal gaze poses were visually inspected. The packaged artwork validator decodes the actual PNG and checks every valid cell and the transparent unused cells; this does not prove artistic quality or smooth motion. The exact atlas was imported and selected through the local plugin UI on Linux; this is not acceptance of a bundled installation on macOS, Windows or the desktop window.

## MMX octopus girl (`mmx-octopus`)

The optional bundled `mmx-octopus` pet is the original chibi octopus girl of 绿川椒餐饮 (the MMX brand): orange hair, a white vest, a brown plaid skirt and eight tentacles. It is a fan character contributed by [antianqi](https://github.com/antianqi), not an official MiniMax character or an additional plugin. Copyright (c) 2026 绿川椒餐饮; distributed under the [MIT License](LICENSE).

The character sheets and the action clips were produced in 2026-11 with a locally hosted open-weight image and video diffusion model driven from ComfyUI. A local pipeline cut the subject out of every rendered frame with a local segmentation model, and a per-row frame selection then chose the window that actually performs the requested action. All frames share one standing height; the foot baseline of a row is the lowest foot among that row's selected frames, so grounded frames sit on one baseline while airborne frames keep their relative lift.

The nine rows map to the player states as follows.

| Row | State | Source clip | Frames | Pose |
| --- | --- | --- | --- | --- |
| 0 | `idle` | `idle-01` | 6 | Standing, breathing and blinking |
| 1 | `running-right` | `move-03` | 8 | Right-facing profile run cycle |
| 2 | `running-left` | `move-03` | 8 | Left-facing profile run cycle |
| 3 | `waving` | `click-01` | 4 | Greeting with both hands raised |
| 4 | `jumping` | `drag-01` | 5 | Arms up, takeoff, apex, landing |
| 5 | `failed` | `click-03` | 8 | Head down, arms crossed, sulking |
| 6 | `waiting` | `think-01` | 6 | Standing, hand at the chin, attentive |
| 7 | `running` | `work-01` | 6 | Bent over, working |
| 8 | `review` | `cele-01` | 6 | Hands clasped, pleased with the result |

Both running rows come from one continuous 360-degree run clip: the right-facing and the left-facing profile halves of that turn. The waiting and review rows are near-still poses, like the bundled default pet's rows, which carry the meaning in the pose rather than in large movement. The `failed` row is a sulking reaction; the source footage contains no literal failure gesture. The frame counts follow the official layout (6/8/8/4/5/8/6/6/6) and the unused trailing cells of the shorter rows stay fully transparent.

This pet ships the v1 layout, so it has the nine animation rows and no look directions; the player treats it accordingly, and the mouse-follow feature stays unavailable for it. The static, non-interlaced 8-bit RGBA PNG is 1536 × 1872 pixels with 57 valid cells. The packaged artwork validator decodes the actual PNG and checks every valid cell, the transparent background and the cell edges; this does not prove artistic quality or smooth motion. Model generation is not deterministic, so this atlas has no regeneration command; the PNG itself is the source. No third-party pet spritesheet was copied, and the source videos are not shipped.

No externally sourced pet spritesheet is included. User-imported artwork is not part of this distribution and keeps its own license.
