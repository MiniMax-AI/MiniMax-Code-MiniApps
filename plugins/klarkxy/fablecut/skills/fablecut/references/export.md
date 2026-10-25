# Exporting

Adapted from the FableCut project by ronak-create (MIT License, Copyright (c) 2026 ronak-create).
Keep that notice with any copy of this text.

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
