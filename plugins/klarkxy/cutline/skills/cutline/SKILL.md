---
name: cutline
description: Edit video with the Cutline Mini App - assemble a cut, place titles and captions, grade, add transitions and motion graphics, mix and repair dialogue audio, and export - by patching the timeline document with the fablecut_* tools, or render it with the standalone cutline_export runner. Use when the user asks to cut, trim, caption, subtitle, grade, re-edit, remake a reel from a reference, add lower thirds or animated titles, clean up dialogue audio, or render a finished video.
---

# Cutline

Cutline is a browser video editor whose whole timeline is one JSON document. You edit a project by
patching that document with the `fablecut_*` tools this plugin exposes. The open editor reloads the
document as you work, so the user watches the cut change while you build it.

> Tool names, prop names and the recipes in this skill and its references are adapted from the
> FableCut project by ronak-create, under the MIT License (Copyright (c) 2026 ronak-create). Keep
> that notice with any copy of this text.

> The tool names keep the upstream `fablecut_` prefix. The plugin, the Mini App and this skill are
> branded Cutline, but the tools are the upstream ones under their upstream names, so a later
> upstream update can be applied without renaming the public tool surface. Call them exactly as
> `fablecut_status`, `fablecut_get_project`, and so on.

## Open the editor first

The editor is a Host-managed service, not a process you start.

- Open it with the Host's Mini App open action and `pluginId: "cutline"`.
- Never launch the editor from a shell command and never build an editor URL yourself. The Host
  serves the page on its own guarded origin; there is no fixed address to visit and no server for
  you to bind.
- `fablecut_status` reports whether the editor is up, which project is open, and what is in the
  media bin. It is a status call here, not a launcher.

## The tools

| Tool | Use it for | Arguments worth knowing |
| --- | --- | --- |
| `fablecut_status` | Editor state, the open project, the media bin | none |
| `fablecut_docs` | The project schema manual | `section` (substring match on a heading) |
| `fablecut_get_project` | Read the timeline document | `compact: true` |
| `fablecut_patch_project` | Targeted edits - the default way to change anything | `ops[]`, `baseRevision` |
| `fablecut_set_project` | Replace the whole document | `project`, `force` |
| `fablecut_frame` | Look at footage or at the composed timeline | `path`, `t`, `frames`, `from`, `to`, `time`, `text`, `where` |
| `fablecut_scopes` | Numeric measurement of the graded picture | `time`, `matte`, `mask`, `where` |
| `fablecut_track` | Motion-track a region, then bake it into a mask or another clip | `clip`, `region` or `point`, `at`, `direction`, `apply` |
| `fablecut_import_media` | Bring a local file or an https URL into the project | `path` |
| `fablecut_import_project` | Import a whole project from another Cutline data folder | `folder`, `project` |
| `fablecut_analyze_reference` | Turn a reference video into an edit blueprint | `path`, `threshold`, `registerMusic` |
| `fablecut_proxy` | Light playback copies of heavy footage | `mediaIds`, `create`, `delete`, `height`, `wait` |
| `fablecut_normalize_audio` | Bring clips to a loudness target | `clipIds`, `mode`, `target`, `force` |
| `fablecut_auto_duck` | Dip music under dialogue | `clipIds`, `under`, `amount`, `threshold`, `attack`, `release` |
| `fablecut_silence` | Find, or cut out, silences in speech | `clipIds`, `threshold`, `minSilence`, `padding`, `cut`, `tracks` |
| `fablecut_denoise` | Reduce hiss, hum and room tone | `clipIds`, `amount` |
| `fablecut_projects` | List, open, create, duplicate, archive projects and templates | `action`, `id`, `name`, `template`, `fps`, `width`, `height`, `open` |
| `fablecut_versions` | Save, diff, restore and annotate versions | `action`, `version`, `to`, `name`, `note`, `final` |
| `fablecut_encode_profiles` | Delivery presets and raw encoding profiles | `preset`, `profile`, `detail` |
| `fablecut_export` | Render the timeline to a file, in the open editor tab | `preset`, `delivery`, `outputs`, `profile`, `range`, `where`, `wait`, `job`, `cancel` |
| `cutline_export` | Render the timeline to a file with a standalone runner you start yourself | `action` (`prepare` / `status` / `cancel`), `range`, `preset`, `delivery`, `profile`, `job` |

That is the upstream set of 19, plus `fablecut_import_project` and `cutline_export`, which this
Mini App adds - 21 in all. The Host may serve a different set, so check the tool list you actually
have instead of assuming.

## Two ways to render

`fablecut_export` renders in the open editor tab, so the Mini App has to be open and the user sees
the progress bar. It also supports batch outputs - several files from one render.

`cutline_export` is this package's own tool. It prepares a job - a snapshot of the saved
project, copies of its media and library files, a copy of the editor and a copy of a standalone
runner - and gives you the exact path of that runner. You start it yourself, in the foreground of
one of your background shell tasks, and watch it with `cutline_export {action:"status"}`.

- The runner is a plain Node process outside the Mini App. Stopping the Mini App does not stop a
  render that has already started.
- It is not a detached daemon: it belongs to the background task that started it, and it goes away
  with that task. Do not tell the user it survives the app closing.
- It renders the snapshot, so an edit made after `prepare` is not in the file.
- One file per render - it has no batch outputs.
- It needs ffmpeg, ffprobe and a Chrome or Edge install, and it fails with a clear message when one
  of them is missing.
- The finished file lands in the job folder's `exports` directory, and the status gives its absolute
  path. Copy it out where the user wants it, then the job folder can go: nothing deletes it for you,
  and it holds copies of the media and the video, so it costs disk space. A file that failed its
  checks stays in the job folder's `provisional` directory.

Use the exact paths the tool returns. They are absolute and they are the authority.

See [export.md](references/export.md) for both.

## A reliable order of calls

1. `fablecut_status` - confirm the editor is up and see which project is open.
2. `fablecut_docs {section:"project.json schema"}`, or another section you need - read the prop
   names before sending ops. Skip it when the schema is already in context. If a section name does
   not match, the tool replies with the list of headings it has; use that list rather than guessing.
3. `fablecut_get_project {compact:true}` - one line per clip with ids, tracks, timings and
   non-default props. It is roughly ten times smaller than the full document, and it is enough to
   plan most edits. Fetch the full JSON only when you need exact keyframes.
4. `fablecut_patch_project {ops:[...]}` - send the change. It re-reads the latest document, applies
   the ops in order, bumps the revision once and saves atomically, so only the fields your ops
   name get written. That is targeted, not blanket merge-safe: an op that sets a field the user
   changed in the UI a moment ago overwrites that field as well. Pass `baseRevision` when you
   need that concurrent change detected rather than applied. Batch related changes into one call.
5. Look at the result: `fablecut_frame` for a picture, `fablecut_scopes` for numbers.

`fablecut_set_project` replaces the whole document and only earns its cost for structural
changes. It is conflict-checked: if the project moved on since your last read it refuses rather
than overwriting. On conflict, re-read, re-apply your change on top of the latest document, and
call it again.

## Motion tracking

`fablecut_track` follows a region of a video clip's picture frame by frame and stores it on the
clip as a named track.

- `region {x, y, w, h}` or `point {x, y}` - all **fractions of the clip's picture**, 0 to 1, with y
  pointing down. A `point` matches a square region around it, `size` wide (0.08 by default).
- Leave both out to follow whatever the mask named in `apply` covers.
- `name` names the track. Reuse a name and the existing track is extended or replaced over the
  tracked range, so a second run can carry on from a first one.
- `apply` bakes the result in: `{mask: index | name}` moves that mask, or `{clip: id}` pins another
  clip - a title, a sticker - to the track, with optional `scale` and `rotation`.
- `at` is the timeline second the region is described at (the clip's start by default);
  `direction` is `forward`, `backward` or `both`.
- Read the tool's own schema before a call; it is the authority on the fields.

## The service is shared

The editor service is Host-managed and shared across pages, so the project that is open when you
start is not necessarily the one you will be editing a minute later, and another page may be
editing the same project.

- Before each batch of edits, re-read the compact project and confirm which project and revision
  you are about to change.
- Pass `baseRevision` when you planned against a specific revision. The patch is then refused with
  CONFLICT instead of quietly applying on top of someone else's change.
- On CONFLICT, re-read, re-plan against the new revision and retry. Do not replay the same ops
  unchanged.
- Do not promise that two concurrent edits merge perfectly. Say what you changed and which
  revision you changed it on.
- `fablecut_projects {action:"open"}` changes what every user of the service sees. Switch,
  archive or delete a project only when the user asked for it, and re-read the project afterwards.

## The media you bring

Cutline edits media files; it does not invent footage, music or voice. This plugin offers no
media generation step, so new material reaches the timeline the same way any other material does:
as an imported file.

- `fablecut_import_media {path: "<local path>"}` copies a local file into the project's media bin
  and registers it. The original file is left untouched.
- The same tool takes an `https://` URL and downloads it into the project.
- A whole project folder can be brought in with `fablecut_import_project {folder}`.
- Captions are text clips: the words come from the user (or from a transcript the user supplies),
  and the timing comes from the user, from the reference, or from your own reading of the clip.
  See [audio-and-subtitles.md](references/audio-and-subtitles.md).

The import boundary is the contract: whatever produced the file, it ends up as a local file that
goes into `fablecut_import_media`, and the timeline format does not change.

## References

- [editing.md](references/editing.md) - the document model, the patch ops, the media bin,
  sequences, versions, text and grade.
- [audio-and-subtitles.md](references/audio-and-subtitles.md) - loudness, ducking, silence, denoise,
  and building captions.
- [motion-graphics.md](references/motion-graphics.md) - shape layers, nulls, parenting, draw-ons,
  motion paths, compositions, presets and templates.
- [export.md](references/export.md) - delivery presets, delivery overrides, batch outputs, ranges,
  and the editor-tab requirement.

## Limits worth stating out loud

- `fablecut_frame`, `fablecut_scopes`, `fablecut_track`, `fablecut_export`,
  `fablecut_analyze_reference`, `fablecut_normalize_audio`, `fablecut_auto_duck`,
  `fablecut_silence` and `fablecut_denoise` need ffmpeg (and ffprobe) on PATH. When one of them
  fails on a missing binary, report that instead of retrying it.
- `fablecut_export`, `fablecut_scopes`, `fablecut_track` and the timeline mode of
  `fablecut_frame` render through the editor's own tab, and there is no headless fallback here:
  the editor is served on the Host's authenticated port, so a browser spawned outside it cannot
  load the page. When such a call fails for want of a tab, open the Mini App and call it again.
  `cutline_export` is the way out: its runner serves its own copy of the editor on its own
  port, so it needs no open tab.
- `fablecut_frame` returns an image. If you cannot read images, pass `text:true` and it returns
  measurements instead.
- The editor has one job slot. An export, a scope reading, a tracking job and a composed-frame
  render all take it, so while one runs the others are refused. Wait for it, or stop it with
  `{cancel:"x_..."}`.
- A patch is all-or-nothing: one invalid op aborts the whole patch and nothing is saved.
- The user can also export from the editor UI. `fablecut_export` is a convenience, not a gate.

## Reporting back

Describe the change in terms visible on the timeline - which clip, which property, which revision -
and name any check you ran. If a tool refused or could not run, say so plainly and say why; a
refusal is information about the project, not a detail to smooth over.
