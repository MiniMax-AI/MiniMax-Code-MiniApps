# Audio and subtitles

Adapted from the FableCut project by ronak-create (MIT License, Copyright (c) 2026 ronak-create).
Keep that notice with any copy of this text.

## The four audio tools

All four need ffmpeg and ffprobe on PATH, and all four refuse to touch a clip the user has locked
unless you pass `force:true` - which you should only do when the user asked for that specific
change.

### `fablecut_normalize_audio`

`{clipIds, mode?, target?, force?}` - `mode` is `lufs` (default) or `peak`; `target` is LUFS for
`lufs` (default -14) and dBFS for `peak` (default -1).

Measures each clip's source audio after its channel routing and writes `props.gain` so it lands on
the target. It is the same measurement the editor's Normalize button uses. Linked stems - the
per-channel audio clips of one video - are measured together and given one shared gain, so a
stereo pair stays balanced; passing a video clip normalizes its stems. Volume keyframes and fades
are untouched and ride on top of the new gain.

Useful targets: -14 LUFS for streaming and social, -16 LUFS for podcast and dialogue, -23 LUFS for
broadcast, or `mode:"peak"` at -1 dBFS.

### `fablecut_auto_duck`

`{clipIds, under?, amount?, threshold?, attack?, release?, force?}` - `clipIds` are the music or bed
clips to duck; `under` are the audio tracks holding the voice (default: every audio track the
music is not on).

Finds where the voice tracks have sound and writes `duck` keyframes on the music: a dip of
`amount` dB ramping down `attack` seconds before speech and back up `release` seconds after.
`amount` runs from -40 to 0 dB (default -12; 0 removes the ducking), `threshold` is the voice
detection level in dBFS (default -40, raise it when room noise triggers ducks), `attack` defaults
to 0.3 s and `release` to 0.6 s. Short gaps are bridged so the music does not pump between words.

The duck multiplies the clip's volume, so the clip's own level, its volume keyframes and its fades
are unaffected, and re-running replaces the previous dips. Linked stems of a music clip get the
same keys.

### `fablecut_silence`

`{clipIds, threshold?, minSilence?, padding?, cut?, tracks?, force?}` - `threshold` is the level
below which sound counts as silence, -80 to -10 dBFS (default -40; raise it toward -30 for a
noisy room); `minSilence` is the shortest stretch to report or cut, 0.1 to 10 s (default 0.5);
`padding` is the quiet kept beside each phrase, 0 to 2 s (default 0.15), so words are not clipped.

Without `cut` it only reports the spans, so check them - and look at them with `fablecut_frame` -
before removing anything. With `cut:true` each silence is removed with an `extract` on the
targeted tracks, last first, in one revision: later material moves up, linked stems stay in sync,
and locked tracks and clips stay put. Lock the music bed first if it should keep running. A
version is saved before the cut.

### `fablecut_denoise`

`{clipIds, amount?, force?}` - `amount` is `light`, `medium` (default), `strong` or `off`.

ffmpeg's FFT denoiser renders a cleaned FLAC of each clip's whole source file into the media
folder, and the clip - with its linked stems - switches to it. The picture keeps its own file, so
links and timing stay intact. `off` switches back to the original audio. Re-running reuses a file
that was already rendered.

## Mixing

- `setTrack {id:'A1', set:{gain,pan,out}}` - the track fader in dB (-60 to +12), pan -1 to 1, and
  `out` a submix bus id or `'master'`. Null or 0 resets.
- `setBus {id:'B1', set:{name,gain,pan,mute}}` - a submix bus, created if it does not exist. Route
  tracks into it with `setTrack {out:'B1'}`.
- `setFx {target:'clip'|'track'|'bus'|'master', id?, preset? | fx?, append?}` - presets
  `clean-voice`, `podcast`, `radio`, `deep-voice`, `telephone`, `cinematic`, `wide`, `muffled`.
  `fx:null` clears. On a clip it applies to the clip's linked stems too.
- `setFxKeys {target, id?, index?|type?, param, keys:[{t,v,ease?}]}` - automate one effect
  parameter. `t` is clip-local for a clip's effects and timeline seconds otherwise.

## Voice, music and sound you bring

Cutline does not synthesise audio, and this plugin has no generation step: the sound in a cut
is the sound the user supplies.

- A voiceover is an audio file the user has. Import it with `fablecut_import_media`, place it on
  its own audio track, and align it to the picture by trimming its In point and its duration.
- A music bed is an audio file the user has. Import it, place it on an audio track, and use
  `fablecut_auto_duck` when dialogue has to sit over it.
- Keep speech and music on their own audio tracks, not mixed into a video clip. That is what lets
  the ducking and the track faders work on them independently.
- Sound effects are files too. The package ships none; the editor's Sound FX tab shows what the
  user has put in the library's `sfx/` folder.

## Subtitles

Cutline has no caption or transcription tool. A caption is a text clip.

The workable sequence:

1. Import the media and know which clip carries the speech.
2. Get the words. They come from the user: a script, a subtitle file, or a transcript the user
   pasted or handed over. This plugin does not transcribe - it does not turn speech into text.
3. Get the timing. Use the timings the user supplied, or the ones the subtitle file carries. If
   there are none, derive cue boundaries from the words and the clip, and tell the user the cue
   timings are approximate.
4. Place one text clip per cue, with the cue's line as `props.text`, `start` at the cue boundary
   and `duration` matching how long the line should stay up.
5. Look at the result. `fablecut_frame` with no `path` renders the composed timeline, so you can
   confirm a caption is on screen at the moment the speech starts and is gone when it ends.

Styling: the editor's `subtitle` title style is a small Roboto line at the bottom, over a rounded
pill, with the `karaoke` animation. Reproduce it by writing the same props - `font:"Roboto"`,
`align` centred or left, `y` near the bottom of the canvas, `bgColor` with a non-zero `bgOpacity`,
`textAnim:"karaoke"`, and a `wordRate` that sets how fast the karaoke highlight runs. `clip-reveal`
or `word-pop` work well when the caption should feel like part of the design rather than a
transcript.

A caption is a visual clip, so it takes a track. Put them on a video track above the footage, and
lower the track's opacity or the clips' own opacity when they cover the picture.

## Reporting

Say what was measured and what was changed: the loudness target you hit, the dB of ducking you
applied, the silences you cut, the number of cues you placed and how their timings were derived.
When a timing is approximate, say so.
