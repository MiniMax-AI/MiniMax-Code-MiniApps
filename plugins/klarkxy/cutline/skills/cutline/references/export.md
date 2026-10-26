# Exporting

Adapted from the FableCut project by ronak-create (MIT License, Copyright (c) 2026 ronak-create).
Keep that notice with any copy of this text.

There are **two** ways to render, and they are not the same thing.

| | `fablecut_export` | `cutline_export` |
| --- | --- | --- |
| What renders | the open editor tab in the Mini App panel | a standalone runner you start yourself |
| Who starts it | the tool, on the editor's own job slot | you, in one of your background shell tasks |
| Where it runs | inside the Mini App process | a plain Node process outside the Mini App |
| Needs the Mini App open | yes | no |
| Batch outputs | yes (`outputs`) | no - one file per render |
| Job id | `x_…` | `job_…` |

`fablecut_export` renders the timeline to a video file. It is the editor's own Fast export - the
same compositor, audio mix and encoding profile as the Export button - so the file matches what the
user sees. It needs ffmpeg on PATH.

The user can also export from the editor's Export dialog. The tool is a convenience, not a gate:
whatever produces the file, the file belongs to the user.

## Where it runs

The export job renders in a browser tab on the editor. `where` decides which, and in this Mini App
there is only one that works:

| `where` | Behaviour in this Mini App |
| --- | --- |
| `auto` (default) | uses an open editor tab. With no tab open the call fails - there is no headless fallback here |
| `tab` | only an open tab; fails when none is open |
| `headless` | not available here |

The reason is the Host's port guard. The editor answers on the Host's authenticated loopback port,
and a browser spawned outside that origin gets a 401 and never loads the page, so an external
browser cannot be the compositor. `where:"headless"` is refused with that explanation, and `auto`
without an open tab fails the same way.

Never follow upstream advice that assumes a headless browser. Upstream's documentation talks
about starting one, about headless timings and about headless timeouts; none of that applies
here, and passing a timeout argument will not make a headless render happen. When a call fails
for want of a tab, reopen or check the editor tab, then retry with `where:"tab"` or
`where:"auto"`.

Open the Mini App first so the user has the editor tab, then export. `where:"auto"` then uses that
tab, and the user sees the progress bar.

The editor has one job slot. An export, a scope reading, a tracking job and a composed-frame
render all take it, so while one runs the others are refused. Wait for it, or stop it with
`{cancel:"x_..."}`. The same tab requirement applies to `fablecut_scopes`, `fablecut_track` and
the timeline mode of `fablecut_frame`.

## The call

```text
fablecut_export {preset:"youtube", delivery:{fps:60}, wait:true}
```

| Argument | Meaning |
| --- | --- |
| `preset` | a delivery preset id, or a saved preset's id |
| `delivery` | settings layered over the preset (see below) |
| `profile` | a raw encoding profile id instead of a preset |
| `outputs` | `true` for the project's saved batch list, or a list of preset ids and specs |
| `range` | `"entire"` or `"in-out"`; defaults to in-out when either inPoint or outPoint is set |
| `where` | `"auto"`, `"tab"` or `"headless"` - `"headless"` is refused in this Mini App, so use `"auto"` or `"tab"` |
| `wait` | block until the file is written (default true) |
| `timeout` | seconds to wait before returning the job's status instead (default 900); the export keeps running |
| `job` | report on an export started earlier |
| `cancel` | cancel an export job |

With neither `preset` nor `profile`, the export uses `project.delivery` when set, else
`project.encodeProfile`, else the server's default profile.

Long edits: pass `wait:false` to get a job id at once, then poll with `{job:"x_..."}`. Stop one with
`{cancel:"x_..."}`.

## Range

Without an explicit `range`, the export covers the project's inPoint to outPoint when either is
set, and the whole timeline otherwise. The rules are:

1. Entire timeline, or no markers - the whole timeline.
2. IN-OUT with only IN - from the inPoint to the end.
3. IN-OUT with only OUT - from the start to the outPoint.
4. IN-OUT with both - the range between them.

The effective bounds are clamped to the project duration, so an inPoint past the last clip cannot
produce a one-frame black file. Pick `"entire"` to keep the markers for later splits and trims.

## Delivery presets

| Preset | Output |
| --- | --- |
| `youtube` | 1920x1080, H.264 CRF 18, keyframe every 0.5 s, AAC 384k 48 kHz |
| `youtube-shorts` | 1080x1920, as YouTube |
| `instagram-reels` | 1080x1920, H.264 CRF 19 capped at 25 Mb/s, AAC 256k, at most 60 fps |
| `tiktok` | 1080x1920, H.264 CRF 19 capped at 20 Mb/s, AAC 256k |
| `x` | 1920x1080, H.264 CRF 20 capped at 25 Mb/s, AAC 192k |
| `linkedin` | 1920x1080, H.264 CRF 20 capped at 20 Mb/s, AAC 192k |
| `master` (default) | the picture's own size, H.264 CRF 16, AAC 320k |
| `broadcast` | 1920x1080 ProRes 422 HQ MOV, PCM 24-bit 48 kHz, Rec. 709, normalised to -23 LUFS / -1 dBTP |
| `web` | 1280x720 H.264 CRF 23, AAC 128k, fast start |
| `archive` | the picture's own size, lossless FFV1 4:2:2 10-bit MKV, PCM 24-bit |
| `custom` | your own settings |

`fablecut_encode_profiles` lists the presets and the saved ones, and returns one preset's full spec
with `{preset:"youtube"}`. It also lists the raw encoding profiles from `encoding-profiles.json` -
complete ffmpeg argument lists - with `{profile:"hq"}`, and `detail:true` includes every args
array. The encoders your ffmpeg can actually use are listed; hardware ones only when they work on
this machine. Both are dry-run against ffmpeg when an export starts, so a bad setting is refused
before anything renders.

## The delivery spec

Every key is optional; whatever you leave out comes from the preset.

```jsonc
{
  "preset": "youtube",
  "width": 1920, "height": 1080,   // null = the picture's own size (export frame, else canvas)
  "fps": null,                     // null = the project's; 23.976 / 29.97 / 59.94 are exact NTSC rates
  "reframe": "fill",               // fill crops the middle (or the export frame), fit pads, stretch
  "container": "mp4",              // mp4 | mov | mkv | webm | mxf
  "video": {
    "codec": "h264",               // h264 | hevc | av1 | vp9 | prores | dnxhr | mpeg2 | ffv1
    "encoder": "libx264",          // or h264_nvenc / h264_qsv / h264_amf, listed only when they work here
    "rate": "crf",                 // crf | vbr | cbr
    "crf": 18, "bitrate": 12000, "maxrate": null,   // kb/s
    "keyint": 2,                   // seconds between keyframes, 0 = the encoder's default
    "speed": "balanced",           // fast | balanced | best
    "pixFmt": "yuv420p",           // 4:2:0 / 4:2:2 / 4:4:4, 8 or 10 bit, as the codec allows
    "profile": null                // ProRes: proxy lt standard hq 4444 4444xq; DNxHR: lb sq hq hqx 444
  },
  "audio": {
    "codec": "aac", "bitrate": 320, "sampleRate": 48000, "channels": 2,
    "loudness": null, "truePeak": -1
  },                                // codec: aac | opus | mp3 | pcm16 | pcm24 | flac | none
                                    // loudness: a LUFS target (-14 streaming, -16 podcast,
                                    // -23 EBU R128, -24 ATSC) or null for the mix as it is
  "color": "bt709",                // bt709 | bt709-full | bt601-625 | bt601-525
  "filename": "{project}_{preset}_{res}",
  // filename tokens: {project} {preset} {res} {w} {h} {fps} {codec} {date} {time} {range} {n}
  "metadata": { "title": "", "artist": "", "description": "", "copyright": "", "date": "", "keywords": "" }
}
```

- Impossible combinations are corrected and the reply says how: ProRes moves to MOV, WebM takes
  Opus, and Quick Sync gets 4:2:0.
- Reframing happens in ffmpeg, which receives the whole canvas and crops the export frame - or the
  middle - for another shape. A 16:9 timeline exported to a vertical preset is cropped from the
  middle unless the project has an export frame. Say so, or set one.
- `audio.loudness` normalises the mix in the export. It does not change the clips; use
  `fablecut_normalize_audio` when you want the project itself at a target level.

## Several files at once

`outputs` takes `true` for the project's saved batch list, or a list of preset ids and specs:

```text
fablecut_export {outputs:[
  {preset:"master"},
  {preset:"youtube"},
  {preset:"custom", width:1080, height:1080, filename:"{project}_square_{res}"},
  {preset:"web", filename:"{project}_preview_{res}"}
]}
```

The list may hold up to 16 entries, and 16 is also how many a project may save with
`setProject {outputs:[...]}`. But a single render carries at most **8** outputs. The list is split
into renders by frame rate, so the cap is per frame rate: nine outputs that all share one fps do
not fit in one render and are refused with `at most 8 outputs per render`. Spread them over
different frame rates, or export in more than one call.

Within one render the browser renders each frame once and every output is encoded from those
frames by its own ffmpeg pass. Sharing a render saves the rendering, not the encoding - each
output still costs a full encode.

## Check the reply

Every finished file is checked against what was asked - size, fps, frames, codecs, length,
loudness, true peak, file size - and the reply lists the checks. Read it and report any warning
line to the user. A file that was produced but failed a check is not the same as a file that
matches the request.

---

# The standalone export: `cutline_export`

`cutline_export` is this package's own tool. It does not render. It **prepares** a job - a
snapshot of the saved project, copies of the media and library files that snapshot names, a copy of
the editor and a copy of a standalone runner - and hands you the exact path of that runner. You then
start the runner yourself, with your own background shell tool, and watch the job with `status`.

The render it produces is the editor's own Fast export: the same compositor, the same audio mix and
the same ffmpeg encoding, driven by a headless Chrome or Edge on a loopback port of its own.

## The three actions

| Action | What it does |
| --- | --- |
| `prepare` | builds a job and returns the exact command that starts it |
| `status` | reads the job's progress, its result and its error |
| `cancel` | asks a running job to stop |

There is no `start` action. Starting the render is your job, in a process you own.

## The call sequence

```text
cutline_export {action:"prepare", range:"entire", preset:"web"}
```

The reply names the job folder, the runner and the exact command:

```text
Export job job_1a2b3c4d5e6f7081 is prepared and has not started.

Start it with your own background shell tool, in the foreground of that task:

  node "C:/…/export-jobs/job_1a2b3c4d5e6f7081/runner/runner.mjs" --job "C:/…/export-jobs/job_1a2b3c4d5e6f7081"
```

Then:

1. Run that command in the foreground of one of your background tasks. Do not start it detached, do
   not background it with `&`, and do not use `nohup` or a service manager: the task you started it
   from is what owns it, and the task's output is how you see what happened.
2. Poll `cutline_export {action:"status", job:"job_…"}` while it runs. The status carries the
   progress, the attempt id, the runner's pid and the time of its last heartbeat.
3. When the status says `succeeded`, the file is in the job folder's `exports` directory; the status
   gives its absolute path. Copy it out where the user wants it.
4. To stop it: `cutline_export {action:"cancel", job:"job_…"}`, or stop your own task.

**The job folder is not cleaned up for you.** It holds the project snapshot, the copies of the media
and library files, the renderer and the video, so it costs disk space of its own. Once the file has
been copied out, the job folder can be deleted. A file that was made but failed its checks stays in
the job folder's `provisional` directory, so it can still be looked at; nothing removes it.

**Use the paths the tool gives you.** They are absolute and they are the authority. Never guess an
installed path, never build a path from the project's name, and never look for the runner somewhere
else on disk.

## What the runner needs

- `node` on PATH - it is the same Node the Mini App runs on.
- `ffmpeg` and `ffprobe` on PATH.
- A Chrome or Edge install. The runner finds the usual install paths; `FABLECUT_CHROME` points it
  at another one. If none is found the job fails with that message - it does not download a browser.

## What it refuses, and why

The renderer has no network access, so anything that would be fetched from the internet is refused
rather than quietly left out:

- **A font that is not on the machine** fails the job with the name of the font. Use a font from the
  library, a system font, or `fablecut_export` in the editor.
- **A clip with background removal** is refused when the job is prepared, because the model it
  needs would have to be downloaded.
- **A media or library file that is missing, points outside the project's own folders, or has an
  unsupported non-media type**, is refused when the job is prepared. `/media/` accepts only video,
  audio, image and SVG files; fonts belong under `/library/`, not in the media folder.
- **An unknown delivery preset id** is refused before a job folder is created, whether it is passed
  as `preset` or `delivery.preset`; there is no silent fallback to Custom. Built-in and saved
  delivery presets are both accepted.

## The exit code

The runner ends with `0` when the file was made, `4` when the job failed, `130` when it was
cancelled or interrupted, and `3` when it refused to start (the job was already held by another
attempt, or it had already finished). Read the state with `status` for the details.

## What the runner does not do

- It does not read the live project. It renders the snapshot it was given, so an edit made after
  `prepare` is not in the file.
- It does not talk to the Host. It opens its own loopback port with its own secret and answers
  nothing else.
- It does not write outside its own job folder. The finished file lands in that folder's `exports`
  directory.
- It does not run Agent turns and it does not need the Mini App to stay open. It is a plain Node
  process, started by you.

## The boundaries, stated plainly

- The runner is **not** a child of the Mini App. Stopping the Mini App does not stop a render that
  has already been accepted.
- The runner is **not** a detached daemon. It lives and dies with the background task that started
  it. If that task is stopped, or the client exits, the render is gone with it. Do not promise the
  user that a render survives the app closing.
- One job runs at a time. A second attempt on the same job is refused; the state and the output of
  the first attempt are left alone. Render again by preparing a new job.
- A job that was interrupted - the machine was rebooted, the task was killed - stays interrupted.
  It is not restarted for you, and nothing is killed by a recorded pid: a recycled pid is not
  evidence of anything. Prepare a new job.
- The file is written as provisional and is only marked finished after `ffprobe` has read it and
  `ffmpeg` has decoded it all the way through. A file that does not survive that is reported as a
  failure, not as a finished export - and it is kept in the job folder's `provisional` directory
  rather than deleted, so it can still be looked at.
- Heartbeat failures, cancellation and render failure share one idempotent cleanup path. Browser
  close has a short bound before the process is killed, and a separate 15-second teardown deadline
  bounds cleanup even when the overall render timeout started that cleanup.

## Limits

- **One file per render.** `cutline_export` has no `outputs` argument: batch outputs are a
  `fablecut_export` feature. For several files, run several jobs, or use `fablecut_export` with the
  editor open.
- `range`, `preset`, `delivery` and `profile` are honoured the same way `fablecut_export` honours
  them, because it is the same renderer. Settings that the renderer has to correct are corrected the
  same way and said so in the reply. Unknown preset ids are the exception: standalone preparation
  refuses them instead of allowing the renderer's Custom fallback.
- The renderer is the editor's compositor in a headless browser. Long or high-resolution timelines
  are slower than a short one, and a browser's memory limits still apply. A successful short render
  does not certify long-form rendering.

## Which one to use

- The user is watching the editor, or wants several files at once, or wants the progress bar in the
  panel: use `fablecut_export` with the editor open.
- The user wants the export to run without the panel, or to run for a long time, or to be
  reproducible from a snapshot: use `cutline_export`.
