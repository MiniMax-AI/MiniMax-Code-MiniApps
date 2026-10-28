# Audio and subtitles

Adapted from the FableCut project by ronak-create (MIT License, Copyright (c) 2026 ronak-create).
Keep that notice with any copy of this text.

The tool schemas and the runtime manual, [CLAUDE.md](../../../miniapp/node/vendor/fablecut/CLAUDE.md),
are the authority for arguments and levels. This guide covers which tool to reach for.

## Loudness, ducking, silence, noise

- `fablecut_normalize_audio` brings clips to a loudness target. It measures the source after
  channel routing and writes a gain, so the clip's own volume rides on top of it. Use it when the
  mix feels uneven, and pick a target the delivery expects.
- `fablecut_auto_duck` dips music under dialogue by writing duck keyframes on the music, so the
  music follows the voice instead of fighting it. Give it the music clips and the tracks that hold
  the voice.
- `fablecut_silence` reports the silences in speech, and cuts them when you ask it to. Report
  first and look at the spans before removing anything, and lock the music bed first when it
  should keep running.
- `fablecut_denoise` cleans hiss, hum and room tone. It renders a cleaned copy of the clip's
  source audio and switches the clip to it, so the picture and the timing stay as they were.

Each of them reads and writes the media file, so ffmpeg has to be on PATH, and each of them skips
a clip the user has locked unless you pass `force` for a change the user asked for.

## Mixing

- Keep speech and music on their own audio tracks, separate from the video clip. That is what lets
  the faders, the buses and the ducking work on them independently.
- Faders, pans, buses and effects are patch ops on tracks, buses and clips. Reach for them when the
  mix needs shaping rather than one clip fixed in isolation.
- A voiceover is a file the user has: import it, give it its own track, and align it to the picture
  by trimming its in point and its length. A music bed is a file too, and ducking is how the two
  share the timeline.
- Sound effects are files as well. The editor's Sound FX tab shows what the user has put in the
  library.

## Captions

A caption is a text clip, and Cutline has no transcription tool, so the words come from the user: a
script, a subtitle file, or a transcript they hand over.

1. Import the media and know which clip carries the speech.
2. Take the timings the user supplied or the subtitle file carries. With neither, derive cue
   boundaries from the words and the clip, and tell the user the timings are approximate.
3. Place one text clip per cue, with the cue's line as its text, starting at the cue boundary and
   lasting as long as the line should stay up.
4. Reproduce the editor's `subtitle` style by writing its props, or pick a different animation
   when the caption should feel like part of the design.
5. Look at the composed timeline and check that each caption is on screen while the speech runs
   and gone when it ends.

A caption is a visual clip, so it takes a track: put them on a video track above the footage and
lower the opacity when they cover the picture.

## Reporting

Say what you measured and what you changed: the loudness target, the amount of ducking, the
silences you cut, the number of cues you placed, and how their timings were derived. Say so when a
timing is approximate.
