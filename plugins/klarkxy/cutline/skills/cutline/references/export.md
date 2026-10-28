# Exporting

Adapted from the FableCut project by ronak-create (MIT License, Copyright (c) 2026 ronak-create).
Keep that notice with any copy of this text.

The delivery presets, the encoding fields and the argument list live in the runtime manual,
[CLAUDE.md](../../../miniapp/node/vendor/fablecut/CLAUDE.md), and in the tool schema. Read them
with `fablecut_docs` before you build a call. This guide covers the two render paths and what each
one needs.

## Two ways to render

`fablecut_export` renders in the editor tab the user has open, so the Mini App has to be open and
the user watches the progress bar. It can also produce several files from one render.

`cutline_export` prepares a job - a snapshot of the project, copies of its media, a copy of the
editor and a copy of a standalone runner - and hands you the path of that runner. You start the
runner yourself in the foreground of one of your background shell tasks.

Pick the editor path when the user is watching the panel or wants several files at once. Pick the
standalone path when the export should run without the panel, run for a long time, or be
reproducible from a snapshot.

## Rendering in the editor

Open the Mini App first, so the user has the editor tab. This installation serves the editor on the
Host's guarded origin, so a render has to happen in that tab and the `where` argument has no
headless option here. A call that fails for want of a tab wants the Mini App open.

An export holds the editor's single job slot, so nothing else renders at the same time. For a long
export, ask for the job id and poll it instead of holding the call open, and cancel it when the
user changes their mind.

Ranges follow the project's in and out points when they are set, and the whole timeline otherwise.
Ask for the entire timeline when the user wants the markers kept for later splits and trims.

## The standalone runner

1. Prepare the job. The reply names the job folder, the runner and the exact command.
2. Run that command in the foreground of one of your background tasks, where the task owns it and
   its output shows what happened. Keep it attached: a detached start hands the render to a process
   you can no longer watch.
3. Poll the job's status while it runs. It carries the progress, the attempt id, the runner's pid
   and its last heartbeat.
4. When the status says it succeeded, the file is in the job folder's exports directory and the
   status gives its absolute path. Copy it out where the user wants it.
5. Clean up the job folder yourself once the file is copied out - it holds the snapshot, the media
   copies and the video, so it costs disk space.

The runner lives and dies with the background task that started it, so report it that way. It
renders the snapshot it was given, so an edit made after the job was prepared stays out of the
file. One job runs at a time; prepare a new job for a second render. A file that fails its checks
stays in the job folder's provisional directory, where it can still be looked at.

The runner needs ffmpeg, ffprobe and a Chrome or Edge install, and it has no network access, so a
font that exists only online, a clip that needs a downloaded model and an unknown preset id are all
refused up front. Built-in and saved presets are both accepted.

## Check the finished file

Every finished file is checked against what was asked - size, fps, frames, codecs, length,
loudness, true peak, file size - and the reply lists the checks. Read it and report any warning to
the user. A file that was produced but failed a check is a near miss rather than a match, so report
it as such.
