---
name: minimax-pet
description: Open MiniMax Pet or create, validate and import custom desktop-pet spritesheets. Use when making a new pet, turning a character image into a pet, or fixing an incompatible atlas.
---

# MiniMax Pet

Choose the branch matching the user's request. Creating artwork produces files in the user's workspace; it does not create a separate chat or send, stop, or answer user conversations.

## Open the pet or view reminders

Call the Host's currently available `miniapp` tool:

```json
{ "action": "open", "pluginId": "minimax-pet" }
```

Report the app open only when the tool returns `ok: true` and `result.opened: true`. Otherwise report the actual failure. The user can check installation and enablement in plugin management, use the appearance/tasks/settings tabs, and choose the desktop-window action.

## Create or repair pet artwork

1. Read the complete [atlas and metadata specification](references/spritesheet-format.md) before generating images. Reuse character/style/reference details already supplied; clarify only missing choices that materially affect the artwork. Use image-generation, drawing and processing tools actually available in this turn. Create original artwork by default; this package does not bundle third-party character art.
2. Prefer **v2: a static transparent RGBA PNG, exactly 1536 x 2288 pixels**. It has **8 columns x 11 rows**, each cell **192 x 208 pixels**, nine animation tracks and sixteen look directions. A portrait, animation GIF, video or arbitrary contact sheet is not an atlas. If the look directions cannot be made, explicitly deliver v1 at 1536 x 1872 with version 1 instead of claiming v2.
3. Create an output directory with `pet.json` and its named `spritesheet.png`. Use a custom pet ID such as `my-mint-pet`; `minimax-original` is reserved, while `minimax-pet` is the plugin identity and must not be changed. Keep the character, scale and baseline consistent, with real alpha transparency and no clipping across cell edges. When a generation tool cannot produce the exact layout, make consistent frames first, then use available tools to fit them proportionally, pad with transparency and assemble the exact grid. Stretching an arbitrary collage is not sufficient.
4. Run the bundled [PNG validation tool](scripts/validate-art.mjs):

   ```sh
   node "<skill-dir>/scripts/validate-art.mjs" "<output-dir>/pet.json"
   ```

   Resolve `<skill-dir>` from the actual current location of this `SKILL.md`; do not guess an installation/profile path. The script needs Node.js 22+, no dependency installation, writes no files and calls no model. Read its real result: exit 0 and `ok: true` pass this generation profile. Fix errors and rerun. Review or explain warnings, and visually check character consistency, actions and look directions. If execution or visual review is unavailable, state what remains unverified; do not invent a successful check.
5. Deliver the two actual file paths, version, validation result and useful preview. When import is requested, open MiniMax Pet and select those two files through Appearance -> Import, inspect the preview and confirm. Replacing an existing ID needs user confirmation. Claim import only after observing success. Do not write the Host's dataDir, use private import endpoints or edit an installed package to bypass the import workflow.

## Validation scope

Use static 8-bit RGBA, non-interlaced PNG for generated artwork, with a conservative 8 MiB image budget. The importer also accepts other decodable PNG encodings and static WebP; the bundled script does not fully decode WebP, so its limitations are not the importer's complete support matrix. For existing WebP, use actual image tools to convert to this PNG profile before checking, or explicitly use the MiniApp's decoded preview. Renaming an extension is not conversion.

The validator checks data, pixels and layout, plus limited quality signals. It cannot prove character identity, artistic consistency, action meaning or correct gaze semantics. Its transparent-background/nonempty-cell checks are generation delivery requirements, not a claim that the current importer performs the same pixel checks.
