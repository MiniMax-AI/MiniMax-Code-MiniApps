# Editing a Cutline project

Adapted from the FableCut project by ronak-create (MIT License, Copyright (c) 2026 ronak-create).
Keep that notice with any copy of this text.

The document model - the schema, the patch ops, the properties, the media bin - lives in the
runtime manual, [CLAUDE.md](../../../miniapp/node/vendor/fablecut/CLAUDE.md), which `fablecut_docs`
serves section by section. Read the section you need before you build a call. This guide covers
how to work.

## Read, plan, patch

- Read with `fablecut_get_project` and `compact:true`: one line per clip with ids, tracks, timings
  and the props that differ from their defaults. It is roughly ten times smaller than the full
  document and enough to plan most edits. Fetch the full document when you need exact keyframe
  values.
- A media entry marked `OFFLINE` means the file has left the media folder. An entry can also arrive
  without its probed duration or resolution until the editor fills them in, so check the field is
  there before you rely on it.
- Plan the change, then send it as ops in one `fablecut_patch_project` call. The patch re-reads the
  latest document, applies the ops in order and saves atomically, so only the fields your ops name
  get written. One invalid op aborts the whole patch, so a good patch is a small one.
- Reach for `fablecut_set_project` when the change is structural - a new canvas, a new sequence, a
  rebuilt timeline. Everywhere else a patch is cheaper and touches fewer fields.

## Media

- Import a file the user named with `fablecut_import_media`; it copies the file into the project's
  media bin and leaves the original where it is. A whole project folder comes in with
  `fablecut_import_project`.
- Heavy footage can get light playback copies with `fablecut_proxy`. Export, frames and scopes read
  the original, so a proxy smooths the working experience and leaves the result alone. Proxies cost
  time and disk, so make them when the user asks.
- A reference video can be analysed into a blueprint with `fablecut_analyze_reference`. A blueprint
  captures structure - timing, pacing, where the energy sits - and leaves look, subject and
  performance to you. Say so when you report a rebuild.

## Text and titles

A title is a text clip. The editor ships title styles that bundle a font, a placement and an
animation; reproduce one by writing the same props yourself, and vary the typeface from title to
title so the cut does not read as machine-made.

## Grade

`fablecut_scopes` measures the graded picture at one moment with the compositor the export uses.
Use it to check a grade you are unsure about, and again after a look change. The user's playhead
stays where it is while you measure.

## Versions

`fablecut_versions` keeps copies of a project. Save one before a large or risky change, and one when
the user is happy with a cut, so they have a named point to go back to. Restoring changes what the
user sees, so restore when they ask.

## Traps that cost real work

- A crossfade is same-track overlap plus a fade on the later clip, rather than a separate object.
- Cut, ripple, trim and insert with the timeline ops instead of recomputing timings by hand: the
  ops keep linked audio stems in sync and respect the user's locks.
- `props` merge key by key, while keyframe lists are replaced wholesale. Send the whole keyframe
  list when you mean to replace it.
- A clip or track the user has locked refuses ordinary ops; `force` is for the change the user
  asked for.
- A project can hold several sequences that share its media and comps. Every op works on the open
  one, and `inSequence` reaches another while the user keeps seeing the open one.