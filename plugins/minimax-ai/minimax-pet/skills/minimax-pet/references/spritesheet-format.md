# MiniMax Pet atlas specification

This specification follows the plugin's player, import service and import UI. Choose a version before making frames, then deliver one static image and `pet.json`.

## Deliverable

```text
my-mint-pet/
  pet.json
  spritesheet.png
```

Recommended v2 metadata:

```json
{
  "id": "my-mint-pet",
  "displayName": "My Mint Pet",
  "description": "An original mint-colored companion.",
  "spritesheetPath": "spritesheet.png",
  "spriteVersionNumber": 2
}
```

This is pet metadata, not a plugin manifest. Do not add `agentAccess`, change the plugin ID, or start Agent turns.

- `id`: 1-80 characters matching `^[a-z0-9][a-z0-9._-]{0,79}$`. Choose a new custom ID; `minimax-original` is reserved. Whether an imported ID already exists is checked by the actual import UI, not this tool.
- `displayName`: nonblank, without leading/trailing spaces, at most **80 UTF-16 code units** (JavaScript `.length`; an emoji can occupy two). This fits both client and server limits.
- `description`: optional string, at most **300 UTF-16 code units**; do not use `null`.
- `spritesheetPath`: a plain same-directory filename. Prefer `spritesheet.png`; no directories, URL, or data URL. The runtime pattern is `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.(webp|png)$`. The extension is lowercase and must match the actual encoding.
- `spriteVersionNumber`: number 1 or 2; omission means 1. v2 must explicitly declare 2, not the string `"2"`.
- Arbitrary extra author/license/animation fields are not a persistent import protocol. Keep attribution separately if needed; select only the JSON and its atlas when importing.

## Canvas and cells

| Version | Exact image dimensions | Grid | Content |
| --- | --- | --- | --- |
| v1 | **1536 x 1872 px** | 8 columns x 9 rows | Nine animation tracks |
| v2, preferred | **1536 x 2288 px** | 8 columns x 11 rows | Nine tracks plus sixteen look poses |

Each cell is **192 x 208 px**. Rows/columns are zero-based; a cell starts at `(column * 192, row * 208)`. There are no gutters, outer margins, labels, grid lines or borders. Leave unused trailing cells transparent. Do not add pixels to accommodate a title or change the cell size and merely relabel the JSON.

The generation profile is **static 8-bit RGBA, non-interlaced PNG**, with real alpha transparency. Do not bake white, a checkerboard, a pedestal or explanatory text into the background. GIF, video, animated PNG/WebP, JPEG, SVG and a single portrait are not this deliverable. The runtime can import more PNG encodings and static WebP; the bundled validator fully checks only this PNG subset.

## First nine rows: animations

| Row | State | Valid columns / frame count | Intended pose |
| --- | --- | --- | --- |
| 0 | `idle` | 0-5 / 6 | Calm breathing or blinking |
| 1 | `running-right` | 0-7 / 8 | Run toward the right |
| 2 | `running-left` | 0-7 / 8 | Run toward the left |
| 3 | `waving` | 0-3 / 4 | Greeting |
| 4 | `jumping` | 0-4 / 5 | Takeoff, apex, return to baseline |
| 5 | `failed` | 0-7 / 8 | Failure/disappointment reaction |
| 6 | `waiting` | 0-5 / 6 | Waiting for the user's answer |
| 7 | `running` | 0-5 / 6 | Working; not another right-running row |
| 8 | `review` | 0-5 / 6 | Draw attention to a result |

There are **57 valid animation cells**. Keep identity, palette, scale and foot baseline consistent, allowing intentional jump/run movement. Keep all limbs/antennae inside their cell; neighboring frames must not bleed in. Make motions connect across the cycle. Explain deliberately static tracks rather than claiming identical cells demonstrate verified animation.

Timing belongs to the player, not JSON FPS fields. Idle's six frames total 6600 ms. Normal non-idle actions play three cycles then return to slow idle; previews can explicitly loop. Do not add frames or GIF delays to alter playback timing.

## Last two v2 rows: look directions

Each cell is a static gaze direction, not an extra animation. **Zero degrees points UP, increasing clockwise in 22.5-degree steps.** It does not start facing right. Keep the body baseline stable while changing the head or gaze.

| Row | Column 0 | Column 1 | Column 2 | Column 3 | Column 4 | Column 5 | Column 6 | Column 7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 9 | 0 up | 22.5 up/right | 45 up-right | 67.5 right/up | 90 right | 112.5 right/down | 135 down-right | 157.5 down/right |
| 10 | 180 down | 202.5 down/left | 225 down-left | 247.5 left/down | 270 left | 292.5 left/up | 315 up-left | 337.5 up/left |

Index `i` maps to row `9 + floor(i / 8)`, column `i % 8`. v2 has **73 valid cells** overall. Sixteen different hashes do not prove correct direction: inspect up/right/down/left at minimum. If these poses are unavailable, deliver the nine-row v1 image and version 1; two blank rows do not make a v2 pet.

## Image-generation and assembly workflow

1. Establish an original character reference and lock identity, palette, camera angle and scale.
2. Generate/draw the required frames against that reference. Enable actual transparent output when supported; a painted checkerboard is not transparency.
3. If processing is needed, fit each frame proportionally inside its cell, pad transparently to 192 x 208 and assemble the exact grid. A directly generated atlas is acceptable only after its actual layout, content and dimensions pass checks; ignore size claims printed by the model.
4. Export static RGBA PNG and matching JSON. Keep the atlas **at or below 8 MiB** for this generation profile.
5. Run the bundled [validator](../scripts/validate-art.mjs), then visually inspect motion, edges, consistency and gaze direction. Resolve or explain warnings; a successful script is not proof of artistic quality or action meaning.
6. Import only `pet.json` and its named atlas through the app, review the decoded preview and confirm. Preserve an honest unverified/failed status when any check or import was not observed.

## Size and validation boundaries

The HTTP limit is **12 MiB (12,582,912 bytes) for the entire UTF-8 JSON request**, not a 12 MiB image. Base64 expands an image by roughly 4/3. The UI budget is `ceil(imageBytes / 3) * 4 + 4096 <= 12 * 1024 * 1024`. The generator's 8 MiB image cap leaves room for metadata; the script also estimates the actual encoded request. Let the normal import UI encode the files, rather than constructing private Host requests or writing its data directory.

The tool validates metadata, full PNG decoding, dimensions/version, nonempty valid cells and transparent backgrounds. Edge contact, motionless tracks and repeated gaze cells produce warnings. It reads no Host state and changes no import state, cannot detect existing user-imported IDs, and cannot understand the depicted character/action. The generation alpha/cell requirements are stricter than current runtime header checks. Convert WebP or palette PNG to this profile with real tools, or use a real decoded preview; do not claim this script fully verified a format it does not support.
