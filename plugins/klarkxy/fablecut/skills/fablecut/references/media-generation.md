# Generating media, then importing it

FableCut edits files; it does not invent footage, music or voice. New material is generated on the
Agent side and then imported into the project through the same media boundary as any other file.

The generation surface is the host-managed `mcode-tools` CLI. The Mini App's own code never calls a
generation service.

## The flow

1. **Discover.** Load the `mcode-tools-master` skill before running any `mcode-tools` command.
   Then find the tool and read its current schema:

   ```bash
   mcode-tools connector tools --keyword video
   mcode-tools connector tool connector__matrix__submit_video_generation
   ```

   `connector tools` lists names and descriptions; `connector tool <name>` returns the
   `input_schema` and `output_schema`. Read both before you build arguments - never guess a field
   name. The catalog is fetched live on every command, so a schema you inspected earlier may have
   changed; re-inspect after a validation error instead of inventing an extra argument.

2. **Use the authorization you have.** If the user asked for this generation in this turn, that is
   the authorization - run it. If the provider tool asks for approval of its own, let it ask and
   let the Host handle the prompt. Do not add a second mandatory review step of your own on top of
   that, and do not re-ask about an operation the user already explicitly authorized here. Ask
   again only when the scope is genuinely different: a different asset, a different provider, a
   different cost. Read the current tool description for how a model is billed before you pick one.

3. **Run it.** Pass exactly one JSON object:

   ```bash
   mcode-tools connector call connector__matrix__generate_image --args '{"requests":[{"prompt":"..."}]}'
   ```

   Use `--args-file <path>` instead of `--args` when the arguments are long or the shell quoting
   would be fragile. Give generation commands a 10-minute bash timeout. A successful call writes
   the top-level JSON value described by the inspected `output_schema` to stdout; if the command
   exits non-zero, report its error code and message instead of silently switching tools.

4. **Follow an asynchronous job.** Video generation is two calls: the submit returns a `task_id`,
   and a separate query reports on it.

   ```bash
   mcode-tools connector call connector__matrix__query_video_generation --args '{"task_id":"...","model":"..."}'
   ```

   Pass the same `task_id` and the same `model` back. The status is one of `queued`, `running`,
   `succeeded`, `failed` or `cancelled`. A succeeded result carries `video_url` and `file_id`; a
   failed one carries failure details. Poll until it leaves `queued` and `running` - and read the
   tool description for the current timing guidance rather than assuming a fixed wait.

5. **Get a durable file.** The results are not the same shape across tools, so branch on what you
   actually got - and read the reply rather than assuming a shape the schema did not promise:

   - An image, speech or music result reports a `node_id`. Ask for its short-lived URL and download
     it:

     ```bash
     mcode-tools get_asset_url <node_id>
     ```

     The reply has `node_id` and `download_url`. Download that URL to a local file. Do not try to
     build a CDN URL out of the `node_id` yourself.

   - A succeeded video result reports a `video_url`. Download that URL to a local file directly.

   Download to a path that will still exist when the import runs - a temporary directory is not
   durable enough.

6. **Import it.** Give the local path to FableCut:

   ```text
   fablecut_import_media {path: "<local path>"}
   ```

   The reply returns the new media entry, with the probed duration, resolution, frame rate,
   codecs and audio channels. Use its id in clips. `fablecut_import_media` also accepts an
   `https://` URL, but a local path is the reliable route for a generated asset because the URL
   FableCut downloads from is never kept as the playback source.

## The generation tools

These are the tools the catalog listed when this skill was written. Names are the `tool_name`
values the CLI prints; the descriptions refer to some of them with the shorter `matrix_*` form.

The live schema is the authority. These field names were read from the inspected schemas on
2026-10-23, so they are a starting point, not a contract: run
`mcode-tools connector tool <name>` and build the arguments from what it returns now. A field that
is not in the inspected schema does not exist, and one that is there may have changed.

| Tool | Use it for | Input fields seen at the time |
| --- | --- | --- |
| `connector__matrix__generate_image` | text-to-image, or image-to-image via `input_urls` | `requests[]`, each `{prompt, aspect_ratio?, resolution?, input_urls?, output_file?}` |
| `connector__matrix__submit_video_generation` | one asynchronous video task | `{model, prompt, duration, ratio?, resolution?, input_image?, last_frame_image?, reference_images?, reference_videos?, reference_audios?, reference_type?}` |
| `connector__matrix__query_video_generation` | the status of a submitted video task | `{task_id, model}` |
| `connector__matrix__synthesize_speech` | one spoken-audio asset | `{text, voice_id?, emotion?, pitch?, speed?, volume?, output_file?}` |
| `connector__matrix__batch_text_to_audio` | up to ten spoken-audio assets in one call | `requests[]` with the same fields as above |
| `connector__matrix__batch_text_to_music` | up to five songs or music beds | `requests[]`, each `{prompt, lyrics?, format?, sample_rate?, bitrate?, output_file?}` |
| `connector__matrix__listen_audio` | transcribe one audio file | `audio_info:{url, prompt?, mime_type?}` |
| `connector__matrix__audios_understand` | ask questions about up to ten audio files | `audio_info[]`, each `{url, prompt?, mime_type?}` |

Notes that matter in practice:

- The image and batch tools want their work inside a `requests` array, not as flat arguments.
- `batch_text_to_audio` is the one whose schema promises per-item outcomes: `success_items[]`,
  `failed_items[]` and the three totals. Read them and tell the user which items did not make it.
- Do not assume the other tools report failures the same way. The music, image and video tools
  declare no `output_schema` at all, so there is no promised reply shape and no promised
  `failed_items` array. Inspect the reply you actually got and report what it says. Do not read a
  `failed_items` key that is not there, and do not read a missing list as "nothing failed".
- Some catalogs also expose a voice-list tool. Discover it by keyword when the user wants to pick a
  voice; otherwise omit `voice_id` and let the default stand.
- `listen_audio` and `audios_understand` declare no `output_schema`. Their replies have no
  guaranteed shape and no guaranteed timing. Do not promise word-level timestamps or a
  subtitle-ready alignment. Use the transcript text you actually receive, and if you need cue
  timings, derive them yourself and say they are approximate.
- These tools take HTTPS URLs, not local paths or raw bytes. For a local file, or a URL the
  service cannot fetch, use `mcode-tools upload_temp_url <file_path>` to upload the bytes and
  pass the returned `temp_url` as `url`.

## Audio in generated video

Do not assume a generated video is silent, and do not assume it has sound either. Some video
models render a synchronized native audio track - dialogue, ambience, sound effects - as part of
the video, so no separate speech step is needed; other models produce a silent picture that needs
a voice track laid over it. Read the description of the model you chose before deciding, and check
the imported clip's audio channels in the media bin afterwards, because the media bin reports what
the file actually contains.

When a video does carry its own audio, that is a reason to listen to it before adding a voice
over the top, not a reason to skip listening.

## Another provider later

The import boundary is the contract: whatever produced the file, it ends up as a local file that
goes into `fablecut_import_media`. A different provider that returns a downloadable URL, or a
`node_id` that `get_asset_url` resolves, plugs straight into the same step. No extra SDK, client
library or framework is needed for that, and the FableCut side does not change.

## What not to do

- Do not submit a generation the user did not ask for; and do not make them approve twice an
  operation they already explicitly authorized.
- Do not upload the user's footage to a generation service unless the request covers that file.
  When it does, do not ask again.
- Do not hand a `node_id` to `fablecut_import_media` - it needs a path or an `https://` URL.
- Do not keep the download URL as the media source; download the bytes and import the file.
- Do not build a CDN or OSS URL out of a `node_id`; use `get_asset_url`.
