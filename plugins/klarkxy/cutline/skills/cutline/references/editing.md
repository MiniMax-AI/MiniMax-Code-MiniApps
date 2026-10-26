# Editing a Cutline project

Adapted from the FableCut project by ronak-create (MIT License, Copyright (c) 2026 ronak-create).
Keep that notice with any copy of this text.

## The document

One JSON document holds everything:

| Part | What it holds |
| --- | --- |
| `project` | canvas (`width`, `height`, `fps`), `background`, `markers`, `inPoint` / `outPoint`, `disabledTracks`, `lockedTracks`, `untargetedTracks`, `encodeProfile`, `delivery`, `outputs`, `master` |
| `tracks` | lanes: `V1`-`V3` video, `A1`-`A4` audio, plus buses |
| `clips` | every clip on every track, each with `id`, `kind`, `track`, `start`, `duration`, `props`, and optionally `keyframes`, `transitionIn`, `transitionOut` |
| `media` | the media bin: every imported file with its probed duration, resolution, frame rate, codecs, audio channels and size |
| `comps` | nested timelines, placed by `kind:"comp"` clips |
| `sequences` | several timelines in one project; the open one is the top level of the document |
| `revision` | an integer that bumps on every save; the editor compares it to detect external changes |

## Reading

- `fablecut_get_project {compact:true}` gives one line per clip: ids, tracks, timings and the props
  that differ from their defaults, plus the MEDIA and SEQUENCES lists. Plan from that.
- `fablecut_get_project` without `compact` gives the full JSON. Use it when you need exact
  keyframe values.
- A media entry marked `OFFLINE` is missing from the media folder. A media entry can also be
  missing its probed duration or resolution until the editor fills them in, so check the field is
  there before relying on it.

## Patching

`fablecut_patch_project {ops:[...]}` is the way to change anything. It re-reads the latest
document, applies the ops in order, bumps the revision once and saves atomically. An invalid op
aborts the whole patch and saves nothing.

Ops, by group:

**Clips** - `addClip` (`clip:{...}`, id auto-generated when omitted), `updateClip` (`id`, `set`),
`removeClip` (`id`).

**Media bin** - `addMedia` (`media:{...}`), `removeMedia` (`id`), `updateMedia` (`id` or `ids`,
`set:{name,favorite,tags,folderId}`, `addTags`, `removeTags`; fps, codec, audio channels and size
are probed from the file and read-only), `setCollection` (`id`, `name`, `media` replaces, `add`,
`remove`; a new id or name creates the collection), `removeCollection` (`id`), `relinkMedia` (`id`,
`src`) to point an offline entry at the same file found elsewhere while its clips keep their in
points, `replaceMedia` (`id`, `src`, `name`) to put a different file behind the entry so every
clip using it switches and keeps its timing.

**Project** - `setProject` (`set:{name,width,height,fps,background,markers,disabledTracks,lockedTracks,untargetedTracks,encodeProfile,delivery,outputs,master}`). `markers` is the full list, `[{t,label?,color?}]`, with colour one of gold, red, orange, green, cyan, blue, purple, pink. `master` is `{gain}` in dB. `delivery` is a delivery preset id or spec that exports use by default. `outputs` is the batch list, up to 16 entries, exported together by `fablecut_export {outputs:true}`. `setProject` also takes `inPoint` and `outPoint`.

**Tracks and buses** - `setTrack` (`id:'A1'`, `set:{gain,pan,out}`; gain is -60..+12 dB, pan -1..1,
`out` is a bus id or `'master'`, null or 0 resets), `setBus` (`id:'B1'`,
`set:{name,gain,pan,mute}`; created if missing), `removeBus` (`id`).

**Audio effects** - `setFx` (`target:'clip'|'track'|'bus'|'master'`, `id`, `preset` or `fx`, and
`append:true`). Presets: `clean-voice`, `podcast`, `radio`, `deep-voice`, `telephone`, `cinematic`,
`wide`, `muffled`. `fx:null` clears. On a clip it applies to that clip's linked stems too.
`setFxKeys` (`target`, `id`, `index` or `type`, `param`, `keys:[{t,v,ease?}]`) automates one
parameter; `t` is clip-local for a clip's effects and timeline seconds otherwise.

**Grade** - `setGrade` (`id` or `ids`, `grade:{...}`, `replace:true`). Keys: `exposure`, `temp`,
`tint`, `lift`, `gamma`, `gain`, `offset`, `contrast`, `pivot`, `blacks`, `shadows`, `midtones`,
`highlights`, `whites`, `lowSoft`, `highSoft`, `saturation`, `curves` (`{y,r,g,b}` point lists on
0..1 that merge per channel), `hueHue`, `hueSat`, `hueLuma`, `satLuma`, `layers`, `on`. The wheels
are `[r,g,b,master]`. A null value resets that key; `grade:null` clears the grade; `replace:true`
starts from neutral. `setGradeLayer` (`id` or `ids`, `layer` as an index or a name, `set:{...}`,
`remove:true`) adds a secondary grade applied only where a qualifier and a mask select -
`qualifier:{hue:[centre,width,soft], sat:[lo,hi,soft], luma:[lo,hi,soft], invert}` and
`mask:{shape:'ellipse'|'rect'|'poly', x,y,w,h,rotation,feather,invert,points,keys}`.

**Masks and mattes** - `setMask` (`id` or `ids`, `mask` as an index or a name, `set:{...}`,
`remove:true`) with `shape:'rect'|'ellipse'|'bezier'|'freehand'`,
`mode:'add'|'subtract'|'intersect'|'difference'`, `invert`, `opacity`, `feather` (px), `expand`
(px, negative shrinks), `x`, `y` (centre, 0..1 of the clip's picture), `w`, `h`, `scale`,
`rotation`, `points`, `stroke`, `keys`, `name`, `on`. Omitting the mask, or giving an unknown name
or an index equal to the current length, adds one; a new mask needs a `shape`. `removeMask` (`id`,
`mask`), `setMaskKeys` (`id`, `mask`, `keys`), `setMatte` (`id` or `ids`,
`matte:'alpha'|'alpha-inverted'|'luma'|'luma-inverted'`, `track`) makes the picture on the track
directly above cut the clip, and that track stops drawing while it is a matte.

**Motion graphics** - see [motion-graphics.md](motion-graphics.md).

**Sequences** - `addSequence` (`name`, `from:'empty'|'open'|<id>`, `width`, `height`, `fps`,
`open`), `openSequence` (`id`), `updateSequence` (`id`, `set:{name,index}`), `removeSequence`
(`id`), `inSequence` (`sequence`, `ops:[...]`) to run any clip, timeline, track or `setProject` op
on a sequence without opening it.

**Compositions** - `addComp` (`comp:{id,name,duration,width,height,background,clips}`),
`updateComp` (`id`, `set:{...}`), `removeComp` (`id`, refused while a clip still uses it),
`precompose` (`ids`, `name`, `id`) to turn existing clips into a comp, `inComp` (`comp`,
`ops:[...]`) to edit inside one.

**Presets and templates** - see [motion-graphics.md](motion-graphics.md).

**Motion tracking** - `removeTrack` (`id`, `track`) removes a track stored by `fablecut_track`.

**Timeline edits** - these use the editor's own split, ripple and trim code, so linked stems,
track targeting and locks behave exactly as they do in the UI. Times are in seconds:

| Op | Effect |
| --- | --- |
| `split` (`at`, `ids?`) | split at a time; without `ids` every targeted track |
| `rippleDelete` (`ids`) | remove clips and close the hole |
| `closeGap` (`at`) | close the gap at a time |
| `lift` / `extract` (`from?`, `to?`) | remove a range; `extract` closes it. Defaults to the project's inPoint / outPoint, which then clear |
| `insert` / `overwrite` (`mediaId`, `at`, `in?`, `duration?`) | three-point edit: `insert` pushes later clips right, `overwrite` replaces what is there; a video brings one audio stem per channel |
| `rippleTrim` / `roll` (`id`, `side:'in'|'out'`, `delta`) | trim one side |
| `slip` / `slide` (`id`, `delta`) | slide the source inside the clip, or move the clip in time; clamped to the media, and the reply says what was applied |
| `crossfade` (`ids?` or `at`, `duration?`) | constant-power audio crossfade, borrowing handles from both sides |

Any of them takes `tracks:[...]` to target lanes for that op only.

### Merge rules that catch people

- `updateClip` replaces top-level keys wholesale - `keyframes`, `transitionIn` and `transitionOut`
  are replaced, not merged. `props` merges key by key, and setting any key to `null` deletes it.
- Any op may carry `force:true` to override a lock the user set. Use it only when the user asked
  for that specific change. `updateClip {set:{locked:null}}` is always allowed.
- The user can lock clips and tracks. `updateClip` or `removeClip` on a locked clip, and `addClip`
  onto a locked track, are refused.

### Replacing the whole document

`fablecut_set_project {project, baseRevision}` writes the whole document at once. Use it only for
structural changes; a patch is cheaper and touches fewer fields.

- `baseRevision` is **required**: the revision the document was read at. If the project moved on
  since then, the save is refused with CONFLICT and nothing is written.
- Do not bump the revision inside the document. The server owns it and stores the document at the
  current revision + 1.
- `force: true` overwrites a conflict - only when the user asked for it.

## Media

- `fablecut_import_media {path}` copies a local file into the project (including `.svg`) or
  downloads an `https://` URL into the media folder. The URL is never kept as the playback source,
  because a remote source would break the export. The reply returns the new media entry; use its
  id in clips. Only media files are taken - video, audio, images and SVG; anything else is refused.
- `fablecut_proxy` makes light H.264 copies (540p by default, 720p or 1080p, never larger than
  the source) of heavy footage so playback and scrubbing stay smooth. Export, frames and scopes
  always read the original, so a proxy never changes the result. Make proxies when the user asks;
  they cost time and disk.
- `fablecut_analyze_reference {path}` analyses a reference video into a blueprint: `cuts`,
  `shots[]` with a per-shot `energy` 0-100, `beats[]`, `bpm`, a loudness `energy` curve, `drop`
  (the biggest musical rise), and `avgShotLen`. By default it also extracts the reference's music
  into the media bin, registered and ready to place on `A1`. Lower `threshold` when obvious cuts
  are missed, raise it when camera motion is being read as cuts.
- A blueprint captures structure - timing, pacing, where the energy sits. It does not capture
  look, subject or performance. Say so when you report a rebuild: it matches the rhythm of the
  reference, and the grade, footage and titles remain separate choices.

## Importing a project

`fablecut_import_project {folder, project?}` brings a whole project in from another Cutline data
folder - the folder that holds `project.json` and `media/`, or `projects/<id>/project.json`.
`project` picks which one when the folder holds several; by default it takes the open one, or the
only one, and asks you to choose when it cannot tell.

What it does:

- Every media file the project uses is **copied** into this installation's media folder. The
  **originals are left untouched**, and a copy never overwrites a file that is already here - it
  gets a free name instead. A file in a subfolder of the source `media/` is fine; the copy lands
  directly in `media/`.
- The media entries are repointed at the copies and re-probed, so their duration and size are the
  copies' own.
- A `/library/...` entry names a library asset, and every installation has its own copy of those.
  The reference is kept when this installation has the same asset; when it has none, the source
  folder's copy is brought over so the reference resolves. A *different* file under that name is
  never used - the source folder's copy goes into `media/` and the entry points at that.
- Everything is checked before a single file is written. A media file that is not in the source
  folder **stops the import**: nothing is imported and nothing is changed, rather than leaving an
  entry that quietly points at whatever happens to have that name here.
- Only media files travel: video, audio, images and SVG. A file that is not one - an HTML page,
  a script, a font - stops the import as well, because the media folder is served from the editor's
  own origin and a file a browser would run there would run there. A font is not media: fonts
  belong to the asset library, and a differing library font is brought over into the library
  rather than into the media folder.

Only what is inside the folder you name is read: the project id has to be a plain name, and a
media path that climbs out of the source `media/` - or a link that points out of it - is refused.

**It replaces the project that is open.** The imported document is written as the open project at
the current revision, so the editor and the tools agree on what is open. It does not create a
new project on the side - the project you were editing is replaced in place. The project as it was
is saved as a version *before* the import replaces it, so the previous state is recoverable with
`fablecut_versions`.

If the open project changed while the import was copying and probing its files, the import is
refused as well, so a newer edit is never overwritten: read the project again and retry.

A bare `project.json` cannot be imported this way: its `/media/` paths belong to the folder it
came from, so the files have to travel with it. For single files, use `fablecut_import_media`
plus `fablecut_set_project` instead.

## Text and titles

Text is a clip with `kind:"text"`. Useful props: `text` (`\n` for a line break), `font`,
`fontSize`, `align`, `x`, `y`, `box`, `boxFit`, `vAlign`, `direction` (`auto` detects per line, so
right-to-left scripts shape correctly), `letterSpacing`, `lineHeight`, `textShadow`, `glow` and
`glowColor`, `strokeWidth` and `strokeColor`, `bgColor` and `bgOpacity`, `textAnim`, `wordRate`,
`textPath`, `pathOffset`, `pathAlign`, `fontCutSet`.

`textAnim` values: `none`, `typewriter`, `word-pop`, `word-slide`, `karaoke`, `letter-pop`,
`wave`, `bounce`, `shake`, `clip-reveal`, `zoom-in`, `font-cut`, `rise-mask`.

The editor's title styles each bundle a font, a placement and an animation: `impact` (Anton,
uppercase lower third, `word-pop`), `elegant` (Playfair Display, white-to-gold gradient, centred,
`clip-reveal`), `kinetic` (Bebas Neue, gold, `font-cut` cycling Anton, Bebas, Archivo Black,
Oswald), `neon` (Bebas Neue, cyan glow, `wave`), `handwritten` (Caveat, rotated, lower left,
`word-slide`), `serifDrop` (Abril Fatface, centred, `zoom-in`), `subtitle` (Roboto, small, bottom,
pill background, `karaoke`), `boldRise` (Archivo Black, uppercase lower third, `rise-mask`),
`luxury` (Cinzel, cream-to-gold gradient, wide letter spacing, `clip-reveal`).

Reproduce a style by writing the same props from the Agent side. Vary the font from title to
title; one typeface across a whole edit is the clearest tell of an automated cut.

## Grade and measurement

`fablecut_scopes` measures the graded picture at one moment with the same compositor the export
uses: luma levels (min, 1st percentile, median, mean, 99th percentile, max on 0-1), the share of
pixels crushed to black or clipped to white, mean R/G/B, average saturation, and the colour cast
of the midtones (hue name and strength; neutral below 0.01). `matte:{clip,layer}` measures what a
grade layer selects; `mask:{clip}` measures how much of a clip the masks keep.

Useful reference points when a grade looks wrong: a cast strength above roughly 0.03 on footage
that should be neutral, a white-clip share above roughly 1 percent, or a median luma far from
roughly 0.4 on a normally exposed shot. The user's playhead does not move when you measure.

## Traps

- Video and audio clips must satisfy `in + duration x speed <= media.duration`.
- A crossfade is same-track overlap plus `transitionIn:{type:"fade"}` on the later clip - not a
  separate object.
- Cut, ripple, trim and insert with the timeline ops rather than recomputing `start` and `in` by
  hand; the ops keep linked audio stems in sync and respect the user's locks.
- `props` values merge key by key, but `keyframes` are replaced wholesale. Send the whole keyframe
  list when you mean to replace it.
- Shape and null clips have no media entry. Do not register media for them.
- A project can hold several sequences that share its media and comps. Every op works on the open
  one; use `inSequence` to work on another without changing what the user sees.

## Versions

`fablecut_versions` keeps saved copies of a project.

| Action | Arguments | Effect |
| --- | --- | --- |
| `list` | `project?` | list the saved versions (default action) |
| `save` | `name?`, `note?`, `final?` | keep the project as it is now |
| `diff` | `version`, `to?` | what changed from that version to now, or to another version |
| `restore` | `version` | put that version back; the current state is saved first, so a restore can be undone |
| `update` | `version`, `name?`, `note?`, `final?` | rename, annotate, or mark the final cut |
| `delete` | `version` | remove a version |

Versions are also made on their own: every ten minutes while the project changes, and before an
agent's first edit of a session or a whole-document rewrite. Save one before a large or risky
change so the user has a named point to go back to, and one when they are happy with a cut.
Restoring changes what the user sees, so restore only when they asked.
