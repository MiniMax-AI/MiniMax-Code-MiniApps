---
name: cutline
description: Edit video with the Cutline Mini App - assemble a cut, place titles and captions, grade, add transitions and motion graphics, mix and repair dialogue audio, and export - by patching the timeline document with the fablecut_* tools, or render it with the standalone cutline_export runner. Use when the user asks to cut, trim, caption, subtitle, grade, re-edit, remake a reel from a reference, add lower thirds or animated titles, clean up dialogue audio, or render a finished video.
---

# Cutline

Cutline is a browser video editor whose whole timeline is one JSON document. You edit a project by
patching that document with the `fablecut_*` tools this plugin exposes; the open editor reloads as
you work, so the user watches the cut change while you build it.

> Tool names, prop names and the recipes in this skill and its references are adapted from the
> FableCut project by ronak-create, under the MIT License (Copyright (c) 2026 ronak-create). Keep
> that notice with any copy of this text.

## The runtime manual is the authority

`fablecut_docs` returns the editor's master manual: the document schema, every op and property,
and the upstream recipes. Read the section behind your change before you build a call, and read it
again whenever a call is unfamiliar - the tool schemas and the manual are the source of truth, and
these guides only describe how to work. The same manual is on disk as
[CLAUDE.md](../../miniapp/node/vendor/fablecut/CLAUDE.md); its "Scope note - the Cutline Mini App"
section covers how this installation differs from upstream.

Pass `section` to fetch only the part you need - a substring of a heading, such as "props" or
"Recipes". A section name that misses comes back with the list of headings it has.

Tool names keep the upstream `fablecut_` prefix, so call them exactly as the schema names them.
The Host may serve a different set of tools than any list written here, so read the tool list you
actually have.

## Open the editor, then read its state

The editor is a Host-managed service: the Host opens it and serves it on its own guarded origin.
Open the Mini App with the Host's open action and `pluginId: "cutline"`, then call
`fablecut_status` to see whether the editor is up, which project is open and what is in the media
bin. The status call reports; the Host's open action is the way in.

## A reliable order of calls

1. `fablecut_status` - confirm the editor is up and see which project is open.
2. `fablecut_docs` - read the schema section behind the change you plan to make.
3. `fablecut_get_project` with `compact:true` - one line per clip with ids, tracks, timings and
   non-default props. It is enough to plan most edits; fetch the full document when you need exact
   keyframe values.
4. `fablecut_patch_project` - send the change as ops. It re-reads the latest document, applies the
   ops in order and saves atomically, so only the fields your ops name get written. Batch related
   changes into one call.
5. Look at the result: `fablecut_frame` for a picture, `fablecut_scopes` for numbers.

`fablecut_patch_project` is the default way to change anything. `fablecut_set_project` replaces the
whole document and is reserved for structural changes - see [editing.md](references/editing.md).

## The project is shared

The editor service is shared across pages, so the open project can change under you and another
page may be editing the same one.

- Before each batch of edits, re-read the compact project and confirm which project and revision
  you are about to change.
- Pass `baseRevision` when you planned against a specific revision. A write against a revision that
  has moved on is refused with CONFLICT, which keeps it from landing on top of someone else's
  change.
- On CONFLICT, re-read, re-plan against the new revision and retry with the new ops.
- `force` overwrites a conflict; use it only when the user asked for that change.
- Report what you changed and which revision you changed it on. Two concurrent edits can land on
  top of each other, so describe yours rather than claiming a perfect merge.
- Opening, archiving or deleting a project changes what every user of the service sees. Do it when
  the user asked, and re-read the project afterwards.

## Media comes from the user

Cutline edits media files the user supplies; footage, music and voice all reach the timeline as
imported files. Use a path the user named, and leave the original file where it is. Captions are
text clips: the words come from the user, and the timing from the user, the reference or your own
reading of the clip.

## Review before you report

A change that parses can still look wrong. Look at a frame after the edit you made, and look at
the composed timeline when you placed a caption or a title, so you can see that it lands on the
right moment and leaves on the right one. Reach for the scopes reading when the picture looks off.
A refusal or a failed check is information about the project: report it plainly, with the reason.

## Choose the workflow

- [editing.md](references/editing.md) - reading a project, patching it, media, text, grade, versions.
- [audio-and-subtitles.md](references/audio-and-subtitles.md) - loudness, ducking, silence, denoise, mixing, captions.
- [motion-graphics.md](references/motion-graphics.md) - shape layers, nulls, parenting, motion paths, comps, presets, templates.
- [export.md](references/export.md) - the two render paths, ranges, batch outputs, the checks a file goes through.

## Cautions worth stating out loud

- The tools that read or write media need ffmpeg (and ffprobe) on PATH. A failure on a missing
  binary is worth reporting once, with the binary named.
- The tools that render through the editor need the Mini App open, and this installation has no
  headless path for them. The standalone runner in [export.md](references/export.md) is the way out.
- The editor has one job slot. An export, a scope reading, a tracking job and a composed-frame
  render share it, so one job runs at a time.
- A patch is all-or-nothing: one invalid op aborts the whole patch and the document stays as it
  was.
- The user can export from the editor UI as well, so the tool is a convenience rather than a gate.
