var e=`---
name: ai-cinematic-short-film
description: Plan AI short films with story, shots, prompts, and continuity.
---

# AI Cinematic Short Film

Use this workflow when the user wants OpenChatCut to create a cinematic AI-generated short film or story-led visual sequence.

This is a OpenChatCut-native workflow. If a source workflow depends on external image/video generation or manual assembly, replace that step with OpenChatCut's equivalent capability when available. Do not add unrelated OpenChatCut features just because they exist.

## When to Use

- The user starts from an idea, product, script, reference image, mood, or story premise.
- The work needs shot planning, prompt craft, visual continuity, and cinematic pacing.
- The user wants AI-generated clips assembled into a finished short.

## Workflow

1. Define the creative brief: premise, emotion, audience, platform, aspect ratio, duration, and ending.
2. Create a compact story structure: hook image, setup, escalation, reveal or payoff, final beat.
3. Build a style bible using [references/cinematic-ai-workflow.md](references/cinematic-ai-workflow.md): world, character, color, lens/camera language, motion, lighting, and continuity rules.
4. Draft a shot list. Each shot should have a purpose, duration, visual action, camera move, prompt notes, and continuity note.
5. Use existing or generated reference frames only when continuity would otherwise break, especially for characters, products, locations, or costumes.
6. Write prompts per shot with subject, action, environment, camera, lighting, mood, and negative constraints. Keep prompts specific but not brittle.
7. Generate clips, review continuity, and regenerate only shots that break story clarity or visual consistency.
8. Assemble the selected shots in the timeline. Add audio or text only when the brief or source workflow explicitly calls for it.
9. Final QA: story clarity, shot order, continuity, visual artifacts, and export readiness.

## Rules

- Story clarity beats visual novelty. Do not overproduce beautiful shots that do not serve the film.
- Keep a shared style bible so shots feel like one film.
- Do not silently change characters, products, claims, or key user references.
- Ask for confirmation when the premise, ending, product representation, or visual identity is ambiguous enough to change the result.
- Replace external generation or assembly steps with equivalent OpenChatCut capabilities when they exist. Do not introduce unrelated OpenChatCut features just because they are available.

## Output

When planning, show a concise brief and shot list. When executing, report generated clips, timeline structure, and any shots that need user review.`,t=`# Cinematic AI Workflow and Style Bible

Use this reference after the story premise and ending are clear. The bible serves the story: lock only choices that help viewers recognize the world, subjects, and progression. Generation remains variable; references and repeated language improve continuity but do not guarantee identical results.

## Operating order

1. Reduce the story to one sentence and list the emotional turn of each beat.
2. Lock the few visual invariants required to understand those beats.
3. Define a restrained camera and lighting grammar.
4. Assign every planned shot a narrative job before writing prompts.
5. Generate a representative identity shot and a representative world shot first.
6. Approve or revise those anchors, then generate the remaining shots.
7. Select clips by story clarity first, continuity second, spectacle third.
8. Place selected clips as separate OpenChatCut timeline items; refine order, trims, pacing, and transitions without flattening the sequence.
9. Review composed timeline frames and normal-speed playback before finalizing.

## Copyable style-bible template

Fill each line with one decisive rule. Remove any field that does not affect this film.

\`\`\`text
STORY CONTRACT
Premise: one sentence describing protagonist, pursuit, obstacle, and payoff
Emotional arc: opening state -> turning point -> final state
Viewer must understand: the indispensable fact or change
Protected user claims: exact product, identity, wording, or reference details that must not drift

WORLD / LOCATION LOCKS
Era and geography:
Location identity and recurring landmarks:
Spatial logic and screen direction:
Architecture, materials, weather, and atmosphere:
Allowed changes across story time:
Forbidden contradictions:

CHARACTER / PRODUCT LOCKS
Identity name and role:
Recognition anchors: silhouette, face/hair, wardrobe, proportions, gait, or signature prop
Product anchors: form, materials, color, logo placement, package text, scale, and handling rules
State by beat: clean/damaged, open/closed, worn/carried, emotional or physical progression
Elements allowed to vary:
Elements that must never change:

PALETTE / LIGHTING LOCKS
Core palette: three to five named colors with their story roles
Saturation and contrast range:
Key-light direction, softness, and color temperature:
Practical sources and atmospheric effects:
Beat-specific lighting evolution:
Forbidden color or lighting treatments:

LENS / CAMERA / MOTION LANGUAGE
Default framing and depth character:
Wide-shot purpose:
Close-up purpose:
Camera height and subject distance:
Allowed moves: static, pan, tilt, track, push, pull, orbit, or handheld when narratively earned
Movement rhythm and stabilization character:
Forbidden moves or visual habits:

TEXTURE / FINISH
Material and surface character:
Image cleanliness, grain, bloom, flare, and sharpness policy:
Effects that may support the story:
Effects that must not obscure identity, action, product, or readable text:
\`\`\`

## Continuity anchors

Keep anchors observable rather than abstract. “Red knee-length wool coat with brass buttons” is reusable; “stylish coat” is not.

- **World:** lock landmark arrangement, entrances, dominant materials, time of day, weather direction, and any geography needed for the next cut.
- **Character:** lock two to four recognition anchors, not every incidental detail. Include left/right placement for asymmetrical marks, accessories, or injuries.
- **Product:** preserve supplied design, proportions, logo orientation, label wording, color, and use. Never invent claims or silently redesign packaging.
- **State:** record changes caused by the story—wetness, damage, dirt, opened packaging, missing props, or wardrobe changes—and carry them forward.
- **Screen direction:** note subject travel, eyelines, handedness, and prop transfers when consecutive shots must cut together.

## Prompt structure

Write each shot prompt in this order, using the same locked phrases for recurring anchors:

1. **Narrative purpose:** what the viewer must learn or feel.
2. **Subject and anchors:** exact recurring identity or product phrases.
3. **Visible action:** one primary action with a clear start or result.
4. **Environment:** only location details visible in this shot.
5. **Composition:** shot size, subject placement, depth layers, and eyeline.
6. **Camera behavior:** angle and one motivated move, or explicitly static.
7. **Lighting and palette:** shared lock plus any story-driven change.
8. **Mood and texture:** concise finish language from the bible.
9. **Continuity clause:** incoming state, screen direction, required prop, and outgoing state.
10. **Negative constraints:** only likely failures such as changed identity, unreadable product text, extra limbs, duplicate props, or unmotivated camera motion.

Prefer one readable action over a brittle list of simultaneous events. Use only controls exposed by the current OpenChatCut generation capability; do not imply that prompts, seeds, or references make a result deterministic.

## Reference-frame policy

- Use a reference only when it protects a meaningful invariant: character identity, exact product, costume, landmark, prop state, or a required first/last composition.
- Prefer user-approved or previously approved frames. Label each reference by role: \`identity\`, \`product\`, \`location\`, \`costume\`, \`state\`, \`first-frame\`, or \`last-frame\`.
- Keep one canonical identity reference per stable state. Add another only for a necessary angle, expression, or story-state change.
- Do not use an attractive frame as a reference if it contradicts the current shot’s geography, wardrobe state, lighting phase, or screen direction.
- A generated reference is a proposal until reviewed. Store approved generated images or clips in the OpenChatCut media pool before using them downstream.
- If the available video generation mode accepts references, supply only the relevant approved ones. Otherwise carry their observable details into the prompt; never claim exact reproduction.
- Record which references influenced each shot so a failed shot can be regenerated without changing unrelated anchors.

## Per-shot continuity ledger

Maintain one row per shot and update it after selecting a take.

| Field | Record |
| --- | --- |
| Shot ID / beat | Stable ID, story beat, and narrative purpose |
| Timing | Target duration, actual selected duration, and timeline position |
| Incoming state | Character/product/prop condition, location, time, and screen direction |
| Action / reveal | Single visible action and the information it delivers |
| Framing / motion | Shot size, angle, depth, camera move, and motion direction |
| Lighting / palette | Shared locks plus intentional beat-specific deviation |
| References | Approved asset or frame identifiers and their roles |
| Required outgoing state | State the next shot must inherit |
| Selected result | Generation job/result or media-pool asset used |
| Deviations / decision | Accepted variance, required fix, regeneration reason, or user decision |

## Regeneration and QA thresholds

Review first at normal speed, then inspect suspect frames. Classify before retrying:

- **Regenerate:** the story beat is unclear; the primary action is missing; character or product identity changes; protected text/claims are wrong; required state, prop, geography, or screen direction breaks; or a severe artifact dominates the subject.
- **Regenerate or redesign the shot:** two or more visible bible deviations compete for attention, motion makes the action unreadable, or the result cannot cut coherently to both neighbors.
- **Repair on the timeline:** the source take is sound and the problem is order, trim, duration, framing, pacing, transition, or audio alignment.
- **Accept:** the intended beat reads immediately, all protected anchors hold, adjacent shots connect, and remaining variation is incidental at normal playback speed.

Retry only the failed shot. Keep its story purpose, stable anchor phrases, and approved references fixed; change one failure source at a time. After two regenerations fail on the same invariant, simplify the action or camera move, split the shot, or present the tradeoff for user review instead of brute-forcing more variations.

## Final continuity checklist

- [ ] Every shot advances setup, escalation, reveal/payoff, or final beat.
- [ ] Character, product, wardrobe, landmark, and prop anchors match the ledger.
- [ ] Story-state changes occur on screen or are intentionally motivated between shots.
- [ ] Eyelines, travel direction, handedness, and object transfers cut coherently.
- [ ] Palette and lighting evolve only where the story calls for change.
- [ ] Lens choice and camera motion follow the shared grammar; novelty does not displace clarity.
- [ ] Product appearance and supplied wording remain faithful and readable when required.
- [ ] No visual artifact distracts from the subject, action, or emotional beat.
- [ ] Timeline order, trims, pacing, and transitions preserve the planned arc.
- [ ] Composed frames and playback confirm the result is ready for user review or export.`,n='---\nname: asset-import\ndescription: Use when acquiring or importing media into a OpenChatCut project asset library for video editing or creation, including local/attached videos, user-provided paths, public media URLs, web video/audio/image assets, upload fallback decisions, and deciding between import_media, download_media, or manual user action.\n---\n\n# Asset Import\n\nThis build runs the editor and its media server locally. There is no hosted import API, no CLI, and no OAuth: media enters the project through the editor UI or through the agent tools below. Pick the path by where the bytes live.\n\n## Path 1 — user\'s local files (primary)\n\nAsk the user to drag the files into the editor (preview canvas or 我的素材 panel) or use the upload button. The local pipeline then runs automatically: streaming write to `/media/uploads/`, conditional transcode (≤1920 long edge, browser-friendly codec, ~8Mbps), audio extraction, and auto-transcription (ASR starts on upload). Do not ask the user to pre-convert, pre-trim, or transcode anything themselves — the pipeline handles it.\n\nThe agent cannot read the user\'s filesystem. If the user gives you a `/Users/...` or `C:\\...` path, tell them to drop that file into the editor instead; you cannot fetch it.\n\n## Path 2 — public URLs (agent-driven)\n\nUse `download_media` with a single URL or a batch array. The server fetches, stores under `/media/uploads/`, and registers pool assets. Prefer this for stock/web media the user pointed at. After download, the asset behaves like any other media-pool asset.\n\n## Path 3 — external host transfer\n\nCall `import_media` with `{"action":"create_session", "assetType":..., "filename":..., "contentType":..., "size":...}`. It returns one short-lived upload slot bound to the current project, session, asset identity, basename, `POST`, MIME type, and exact byte count. A host-side script may upload to that exact URL with the declared headers. The agent sandbox cannot reach the user\'s localhost, so do not attempt the transfer from `run_code`.\n\nThe successful upload response returns an opaque receipt, echoed `assetType`, and uploaded path. Probe the uploaded path when exact duration, dimensions, fps, or audio presence are needed, then call `finalize_uploaded_asset` with the receipt, echoed `assetType`, measured media metadata, and `durationInSeconds` for audio/video/gif. The server resolves the authoritative hash, path, size, filename, and asset id. Finalize commits the asset but never starts ASR; after placing an audio/video asset on a track, invoke `transcribe_track` separately if transcription is desired. The asset is not present or usable before finalize succeeds. For missing-media replacement, pass the existing `assetId` to `import_media`; omit it for a new asset. Never construct `/media/uploads/...` yourself and never claim bytes are ready before the upload response.\n\n## Editing discipline\n\nFor multi-source edits, build reviewable work from original source assets in the OpenChatCut timeline. Do not locally concatenate, pre-trim, pre-compose, burn captions, or flatten media before import — import originals and do all composition on the timeline so every step stays reviewable and undoable.\n\nFor code assets such as hand-authored Motion Graphics, use the `create-motion-graphics` skill (`create_motion_graphic_from_code` for new assets, asset-code updates for edits) — MG code is not an imported file.\n\n## Storage notes\n\n- Bytes live on the local disk (`/media/uploads/`), served directly with Range support. If Cloudflare R2 is configured, uploads mirror to R2 and other devices can hydrate from it; without R2 the project is local-only.\n- Local-only is a valid end state: preview, editing, and export all read from disk. Cloud mirroring is only needed for cross-device access.\n',r=`---
name: batch-montage-variants
description: |
  Turn one pool of existing project media into a batch of distinct, publishable montage cuts instead of a single hero edit.
  Use for batch montage, one-source-many-outputs, 一源多出, 批量混剪, 批量出片, 矩阵号, 多账号分发, variant batches, deduped cuts, 去重变体, 防搬运, or when the user asks for N different versions of the same footage.
---

# Batch Montage Variants

Use this workflow when the user wants **many** finished cuts from the same media pool — matrix accounts, A/B hook testing, platform variants, or daily batch output. Each output must satisfy the agreed mode: structural differentiation, a controlled hook test, or a platform adaptation.

This is an OpenChatCut-native workflow. Use the current project, source assets, asset-frame inspection, AV/script context, and built-in editing tools. Editing imported media requires no external service. Use external sources or processing pipelines only when explicitly requested by the user.

## When to switch workflows

- One hero edit from many clips → **Multi Clips to Reels**. Do not use this skill to make a single cut.
- One long source defining a story → **Long Video to Shorts**.
- N distinct outputs from a shared pool → this skill.

Tell the user when you switch, and say why.

## Workflow

1. Read the project state before editing. Inventory the source pool: clip count, usable duration, aspect ratio, visual subjects, motion/energy, audio quality, and duplicates.
2. Confirm the user wants more than one output and the pool supports the selected mode. Do not pad a distinct-cut batch with near-duplicates; controlled tests and platform adaptations may intentionally reuse an edit.
3. Fix the batch contract before cutting — mode (distinct cuts, controlled hook test, or platform adaptations), count, target duration, platform, audience, language, and music bed. If more than one is missing, ask in one \`<widget>\` after loading \`widget-forms\`.
4. Score every source asset for reuse headroom before planning. See [references/variation-matrix.md](references/variation-matrix.md). Reserve distinct hooks where the mode requires them; shared end cards and intentional shared bodies are allowed.
5. Build the **variation matrix** before editing. For distinct cuts, plan different hooks and structural changes. For controlled hook tests, change only the hook and keep the body fixed. For platform adaptations, retain the approved content and adapt presentation. See [references/variation-matrix.md](references/variation-matrix.md).
6. Plan the dedup budget with [references/dedup-rules.md](references/dedup-rules.md). Decide up front which dimensions carry the differentiation, and record the minimum separation each pair of cuts must clear.
7. Get the matrix approved before cutting the whole batch. Show the plan as a table: cut number, hook, order signature, rhythm, duration, packaging, and the dimension that makes it different from every other cut in the batch.
8. Cut the first variant end to end and verify it renders and exports before batching the rest. Do not generate eight timelines that share one unverified mistake.
9. Cut remaining variants from the approved matrix. Reuse picks and trims according to the approved mode; distinct cuts and hook tests need different openings, while platform adaptations may share them.
10. Name timelines so the batch is auditable: \`<topic>-v<NN>-<hook-label>\`, consistent across the batch.
11. QA each cut individually **and** the batch as a set. See [references/dedup-rules.md](references/dedup-rules.md) for the pairwise checks.
12. Report per-cut timeline names, durations, the differentiation dimension for each, and which pair is the most similar — that is the pair the user should review first.

## Plan Format

Present the batch as one table, not prose:

| # | Hook asset | Order signature | Rhythm | Duration | Packaging | Differs by |
|---|---|---|---|---|---|---|
| v01 | clip_07 (product in hand) | A-C-E-B | fast-cut, 1.2s avg | 28s | bold captions + beat cuts | hook + order |
| v02 | clip_12 (before/after) | C-A-B-E | slow open, ramp | 34s | minimal captions + zoom | hook + rhythm |

- Total outputs, platform, shared vs distinct music bed
- Source pool size and reuse headroom
- Dedup budget and minimum separation
- Risks: thin pool, single-use assets, near-duplicate pairs

## Rules

- Distinct cuts and hook tests need different opening three seconds. Platform adaptations may share an opening and must be labeled as adaptations, not distinct edits.
- For distinct cuts, differentiate on **structure** before decoration. Styling changes alone do not establish structural differentiation; these checks do not guarantee a platform's duplicate-detection outcome.
- Do not pad a thin pool into N cuts. Report the honest maximum and ask.
- Distinct cuts and hook tests need different hooks; platform adaptations may reuse the same approved hook.
- Keep one variable dominant per cut. When everything differs slightly, nothing reads as different.
- Batch output is not permission to lower the bar: each cut must stand alone as publishable.
- Do not use captions or titles to invent claims the footage does not support, in any variant.
- Report the most-similar pair explicitly. Hiding it defeats the point of the batch.
`,i=`# Dedup Rules and Batch QA

These editorial checks compare the batch as a set. They do not guarantee a platform's duplicate-detection outcome. Select the batch mode before applying them.

## 1. Why structural dedup, not decorative dedup

For distinct-cut batches, mirror, speed change, color grade, caption restyle and music swap alone do not establish structural differentiation. Compare:

- Different source footage in the opening and in the majority of shots
- Different event order — the sequence of what happens, not how it is dressed
- Different edit rhythm, which changes the perceived pacing signature
- Different duration at a meaningful scale

Treat a distinct-cut plan built only from decorative changes as insufficient. Controlled hook tests and platform adaptations intentionally preserve content and follow their own contract.

## 2. Pairwise checks

For \`controlled-hook-test\`, verify different openings and an otherwise unchanged body, order, duration, rhythm, music and packaging. Record the intentional shared content; high overlap is expected and is not a failure.

For \`platform-adaptation\`, verify the approved content is preserved and each target's aspect ratio, safe areas, captions and duration requirements are met. Shared openings and bodies are allowed.

For distinct cuts, run these on every pair in the batch. N cuts means N*(N-1)/2 pairs; for large
batches, at minimum check every cut against the cut it most resembles.

Use the following as editorial planning targets, subject to the approved matrix:

1. **Opening** — no shared source frames in the first 3 seconds.
2. **Overlap budget** — target shared source seconds divided by the shorter cut's duration under **40%**. Higher overlap needs review against the agreed contract; it is not a platform classification.
3. **Order signature** — the first 5 shots differ in at least 2 adjacent pairs.
4. **Rhythm** — average shot length differs by 1.5x, or the shape inverts.
5. **Duration** — differs by at least 15%, unless the platform fixes length.

Record the distinct-cut result as an editorial similarity verdict: \`distinct\`, \`borderline\`, or \`near-duplicate\`. For the other modes, report \`controlled-hook-test\` or \`platform-adaptation\` and whether its contract passed; do not apply the distinct-cut thresholds.

## 3. What to do with each verdict

| Verdict | Action |
|---|---|
| \`distinct\` | Ship. |
| \`borderline\` | Ship only if the user accepts the risk, and flag the specific pair in the report. |
| \`near-duplicate\` | Do not ship both. Re-cut one on a different dimension, or drop it and tell the user the pool would not support the requested count. |

Never silently ship a \`near-duplicate\` pair. The whole point of the batch is
that the outputs are genuinely different; a hidden duplicate is worse than a
smaller batch because it fails later, after publishing.

## 4. Per-cut QA (still required)

The batch check does not replace individual review. For each cut:

- Opens on the strongest available visual, not a logo or a slow establish
- Sequence has a purpose: hook, context, escalation/proof, payoff
- Captions and titles state only what the footage supports
- Platform treatment correct: aspect ratio, safe areas, duration
- Exports cleanly

## 5. Report format

Report the batch as a set, not as N independent successes:

\`\`\`
Batch: <topic> — <N> cuts, <platform>
Music: shared bed <name> | distinct beds per cut

v01 <name>  28s  differs by: hook + order
v02 <name>  34s  differs by: hook + rhythm
...

Most similar pair: v03 / v05 — borderline (overlap 38%, order differs in 2 pairs)
Review first: v03 and v05, then v01 (hook test baseline)
\`\`\`

Always name the most similar pair. If the user only has time to check two
files, they should check the two that might be duplicates — that is the pair
most likely to cause a problem, and hiding it defeats the purpose of the
check.
`,a=`# Variation Matrix

The variation matrix is the batch plan. It exists so differentiation is designed
before cutting, not discovered afterward when two timelines already look alike.

## 1. Score reuse headroom first

For distinct-cut planning, classify every source asset with the reuse rules below. Controlled hook tests may repeat every body shot in its original position. Platform adaptations may reuse the entire approved edit, including its hook.

| Class | Meaning | Planning rule |
|---|---|---|
| \`single-use\` | Only works in one position: logo end card, QR code, one spoken punchline, a reveal that only makes sense once | May appear in many cuts, but never as the hook of more than one |
| \`positional\` | Works in one role: establishing wide, product close-up, reaction shot | May repeat across cuts, but not in the same slot |
| \`flexible\` | Works anywhere: B-roll texture, ambient motion, cutaway | Free to reuse; carries no differentiation |

For distinct cuts and hook tests, check how many usable different openings the pool supports. This does not limit the number of platform adaptations of one approved edit.

## 2. The five differentiation dimensions

Ranked by how much they actually change viewer and platform perception:

1. **Hook asset** (strongest) — the first 3 seconds. Different source clip, different visual subject.
2. **Shot order** — the sequence signature. \`A-C-E-B\` vs \`C-A-B-E\`.
3. **Rhythm** — average shot length and its shape over time (slow open → ramp, constant fast, front-loaded then settle).
4. **Packaging** — captions style, motion graphics, transitions, crops, speed ramps.
5. **Music bed** (weakest alone) — a different track changes mood but barely changes perceived content.

Rules of thumb for distinct cuts only (not controlled hook tests or platform adaptations):

- Dimensions 4 and 5 alone do **not** constitute a distinct variant. A recut with new music and new caption styling is the same video.
- Dimensions 1 and 2 alone are sufficient, even with identical packaging.
- Aim for 2+ changed dimensions per pair, with at least one from 1–3.

## 3. Minimum separation budget

For distinct-cut batches, use these as planning targets agreed with the user, not platform detection rules. Controlled hook tests and platform adaptations use the mode-specific checks below instead.

| Dimension | Minimum separation between any two cuts |
|---|---|
| Opening 3s | Different source asset, no shared frames |
| Shot order | At least 2 adjacent-pair differences in the first 5 shots |
| Rhythm | At least 1.5x difference in average shot length, **or** an inverted shape (one ramps up, one settles down) |
| Duration | At least 15% difference, unless platform rules force a fixed length |
| Music | Distinct track, or explicitly shared by user request |

When a distinct-cut pair misses the agreed targets, revise the plan or report the shortfall before cutting.

## 4. Choosing the dominant variable

Pick one dimension to carry the batch and let the others support it:

- **Hook testing**: only the opening changes; body, order after the hook, duration, rhythm, music and packaging stay fixed. Do not apply distinct-cut overlap, order, rhythm or duration thresholds. Report \`controlled-hook-test\` and identify the intentional shared body.
- **Matrix accounts / 多账号分发**: hook, order, and rhythm all change. Packaging may stay consistent as a brand signature.
- **Platform variants**: content structure stays fixed; duration, aspect ratio, caption placement, and safe-area treatment adapt to each platform. Shared openings and bodies are allowed. Report \`platform-adaptation\`; do not apply distinct-cut separation thresholds.

A batch with no dominant variable reads as noise. State which mode you are in
before cutting.

## 5. Capacity check

Check whether the actual source ranges can support N cuts under the selected mode and agreed separation targets. Distinct cuts and hook tests need enough usable openings; hook tests may intentionally reuse the full body. Platform adaptations can reuse the same edit. Do not infer a numeric capacity from total footage duration alone.

If the pool cannot support the requested plan, report the specific shortage and offer fewer cuts or more source media. Switching to controlled tests or platform adaptations changes the batch contract and must be explicit.

## 6. Naming

\`<topic>-v<NN>-<hook-label>\`, zero-padded, consistent across the batch.
Examples: \`summer-drop-v01-unbox\`, \`summer-drop-v02-beforeafter\`.

Auditable naming is what makes the batch reviewable later — the reviewer should
be able to tell from the timeline name which dimension each cut was testing.
`,o=`---
name: beat-sync-montage
description: |
  Plan and build a finished beat-synced montage where cut placement serves the content, not just the metronome.
  Use for 卡点混剪, 卡点剪辑, 踩点视频, beat-sync montage, rhythm edit, 节奏剪辑, 音乐驱动剪辑, or when the user wants cuts that land on the beat.
---

# Beat Sync Montage

Use this workflow when the edit should be driven by music. The failure mode to
avoid is a metronome edit: every cut technically lands on a beat, and the result
still feels mechanical, tiring, or unrelated to what is on screen.

This workflow decides **what** to cut and **why**. It does not re-explain the
music tools — when you reach an execution step, follow \`music-intelligence\` for
\`analyze_music\`, \`music_edit_plan\`, and \`sync_cuts_to_music\`. Load it there.

This is a OpenChatCut-native workflow. Use the current project, source assets,
asset-frame inspection, AV/script context, and OpenChatCut editing tools.

## When to switch workflows

- Beat-synced photos on a locked, empty track → \`music-intelligence\` handles this directly with \`music_image_plan\`. This workflow is for video montage.
- One long source cut to speech rhythm → \`long-video-to-shorts\`.
- Many clips packaged as highlights without music driving the cut → \`multi-clips-to-reels\`.
- N distinct beat-synced variants from one pool → \`batch-montage-variants\`, using this workflow for each cut.

## Workflow

1. Confirm the track is on the timeline and identified. Read the music first: BPM, meter, sections, and energy shape. Use \`music-intelligence\` → \`analyze_music\` or \`inspect_music\`; never request the CLAP embedding.
2. Judge whether the material actually suits a beat edit. See [references/shot-fitness.md](references/shot-fitness.md). Footage with no clear motion onset, or whose motion contradicts the music's energy, will not improve by cutting on every beat. Say so instead of forcing it.
3. Choose the **density arc** before choosing individual cut points. See [references/beat-density.md](references/beat-density.md). Density is a property of the whole piece, not a per-cut decision: a verse and a chorus should not be cut the same way.
4. Assign content to the music's structure. Map sections to narrative roles — intro to the hook, verse to context, build to escalation, drop/chorus to payoff. Cut density follows that map.
5. Pick the anchor points first: 3–6 moments where a cut must hit a downbeat or a section boundary because the content has real impact there. See [references/beat-density.md](references/beat-density.md). Everything else is filler rhythm between anchors.
6. Fill between anchors at the density chosen for that section. Do not fill uniformly — uniform filling is what makes an edit feel mechanical.
7. Reserve breathing room. See [references/beat-density.md](references/beat-density.md). A montage that never stops cutting exhausts the viewer and hides the anchors you built in step 5.
8. Check motion continuity across cuts. See [references/shot-fitness.md](references/shot-fitness.md). Consecutive cuts should not fight each other in screen direction or motion axis unless the collision is deliberate.
9. Plan with \`music_edit_plan\`, show the bounded summary and any cap warning, and get acceptance. Then apply with \`sync_cuts_to_music\` and the returned \`analysisRef\`. Follow \`music-intelligence\` for both.
10. QA by watching, not by counting. See the rules below. A cut list that is 100% on-beat can still be a bad edit.

## Plan Format

- Track, BPM, meter, section map with timecodes
- Density arc per section (sparse / medium / dense / rest)
- Anchor points: frame, musical event, and what lands there
- Shot order with the reason each shot sits where it does
- Breathing points: where the edit deliberately stops cutting
- Risks: weak motion onsets, motion-direction collisions, sections that outrun the material

## Rules

- **Anchors over uniformity.** Three or four meaningful downbeat hits beat forty evenly spaced ones.
- **Density follows the music, not the maximum.** Dense cutting is a choice for a section, not a default for the piece.
- **Never cut a strong shot short to satisfy a beat.** If a moment needs four beats, give it four beats and adjust around it.
- **Protect the hook.** The first downbeat hit should land within the first three seconds. A beat edit that eases in has wasted its advantage.
- **Breathe.** At least one held shot per 15 seconds unless the brief explicitly asks for relentless pace.
- **Motion must be legible.** A cut that lands on a beat but lands mid-action with no visible onset reads as an error, not as rhythm.
- **The cut serves the content.** If a section has nothing worth cutting, hold the shot and let the music carry it.
- Do not use captions to invent claims the footage does not support.
- Report honestly when the material does not support the requested density.
`,ee=`# Beat Density

Density is the main artistic control in a beat edit, and it is a property of the
whole piece. Deciding it per-cut produces a metronome edit: technically on beat,
mechanically flat.

## 1. Read the music's structure first

Before choosing any cut point, get the section map. Typical shape:

| Section | Role in the edit | Default density |
|---|---|---|
| Intro | Establish, hook | sparse — one or two hits, let the viewer orient |
| Verse | Context, information | sparse to medium |
| Build / pre-chorus | Escalation | medium, accelerating |
| Drop / chorus | Payoff | dense, but only as long as the material holds |
| Breakdown | Reset | rest — hold shots, stop cutting |
| Outro | Resolve | sparse, land the final hit cleanly |

The density arc should look like the energy curve of the track. An edit that is
dense from second one has nowhere to go.

## 2. The four density levels

| Level | Cut on | Shots per 4 beats | Feels like |
|---|---|---|---|
| \`rest\` | section boundary only | 1 or fewer | Deliberate, lets a moment breathe |
| \`sparse\` | downbeats | 1 | Calm, readable, good for information |
| \`medium\` | downbeats + off-beats | 2 | Forward motion without pressure |
| \`dense\` | every beat | 4 | High energy; fatiguing past ~8 seconds |

\`dense\` is a spice, not a setting. Past roughly eight continuous seconds it
stops reading as energy and starts reading as noise.

## 3. Anchors first

An anchor is a cut that must land on a specific musical event because the
**content** has impact there — a product reveal, a jump, an impact frame, a
lyric that means something.

Plan 3–6 anchors before filling anything else:

- Put one on the first downbeat of the drop or chorus.
- Put one on the section boundary into the payoff.
- Put the strongest visual on the strongest musical event, not merely on an early one.

Everything between anchors is connective rhythm. Fill it at the section's
density, then stop. An edit built anchor-first reads as intentional; an edit
built by filling every beat reads as generated.

## 4. Breathing room

Rule of thumb: **at least one held shot per 15 seconds**, longer than the
surrounding cuts, where the edit deliberately stops cutting.

Why it matters:

- It resets attention, so the next dense passage lands harder.
- It gives the viewer time to read what they just saw.
- Without it, every cut is equally weighted, which means nothing is emphasised.

Place a breath right before a drop. The contrast is what makes the drop feel
like a drop.

## 5. When to break the grid

Deliberately hold across beats when:

- The shot contains an action that needs to complete (a pour, a turn, a landing).
- The shot carries information the viewer must read (text on screen, a product detail).
- The music has a sustained note or a vocal line that the cutting would chop.

Deliberately cut off-grid when:

- The action onset does not align with the beat — cut on the action, and let the beat be approximate. A visible action landing cleanly beats an invisible beat landing exactly.
- Syncing to a lyric or a sound effect rather than to the rhythm section.

## 6. Capacity check against the material

Density is capped by the material, not by the music:

\`\`\`
max_sustainable_dense_seconds = usable_onset_shots / (shots_per_second_at_dense)
\`\`\`

If the plan needs 20 dense seconds and the pool has 12 usable onset shots, the
honest options are to lower the density, extend the pool, or accept repetition.
Repetition in a beat edit is very visible — say so before shipping it rather
than after.
`,te=`# Shot Fitness for Beat Edits

Most footage that gets forced into a beat edit was never suitable for one. Check
fitness before planning, because no amount of accurate beat alignment rescues
unsuitable material.

## 1. What makes a shot cuttable on a beat

A shot works in a beat edit when it has a **legible onset** — something the
viewer can see begin. Score each candidate:

| Signal | Good | Poor |
|---|---|---|
| Motion onset | Clear start: a hand enters frame, a jump launches, a door opens | Ambiguous: slow drift, continuous ambient movement |
| Subject framing | Subject readable within ~0.5s | Needs a second to parse what is on screen |
| Motion axis | One dominant direction | Motion scattered or chaotic |
| Duration | Long enough to trim to the slot with margin | Already shorter than the slot |
| Contrast against neighbours | Visually distinct from adjacent shots | Nearly identical to the shot before it |

A shot can fail one signal and still be usable. Two or more failures means it
should be replaced, not cut harder.

## 2. Fast BPM is not a licence

High BPM tracks demand more cuts per second, which demands more usable onset
shots. Before committing to a dense plan, count them:

\`\`\`
shots_needed ≈ (section_seconds / 60) × BPM × (cuts_per_beat)
\`\`\`

A 140 BPM track at dense (1 cut per beat) needs ~2.3 shots per second — roughly
28 shots for a 12-second chorus. If the pool has 15 usable onset shots, the
chorus cannot be dense. Lower the density, extend the pool, or accept visible
repetition and tell the user.

## 3. Motion continuity across cuts

Consecutive cuts should not fight each other:

- **Screen direction.** A subject moving left followed by a subject moving right reads as a collision. Either match direction or make the reversal deliberate and rare.
- **Motion axis.** Cutting between horizontal motion and vertical motion in quick succession is jarring unless the beat is strong enough to justify it.
- **Scale jumps.** Extreme close-up to wide and back, repeatedly, reads as strobing rather than rhythm.
- **Luminance flashes.** Alternating very bright and very dark shots at high frequency is physically uncomfortable. Watch for it specifically.

These are the checks that separate a professional beat edit from a generated
one. They are also the ones that only show up when watching the cut, not when
reviewing the cut list.

## 4. Holding a shot is a legitimate choice

When a shot is the strongest available and the section is dense, prefer holding
it across two beats over cutting to a weaker shot just to satisfy the grid. One
strong held shot reads as confidence; two weak cuts read as filler.

## 5. Red flags

Stop and reconsider when:

- More than a third of planned cuts land on shots with no visible onset.
- The same shot appears more than twice in a single section.
- Consecutive shots are near-identical framings of the same subject.
- The cut list is perfectly regular — every cut exactly N beats apart. Real edits have shape; a perfectly regular list is usually a sign the content was ignored.
- You cannot say what a given cut is for.
`,ne=`---
name: create-motion-graphics
description: "Use whenever the agent needs to add, create, hand-author, patch, or place Motion Graphic JSX assets in a OpenChatCut project. This is the direct-authoring path: use create_motion_graphic_from_code / edit_asset / edit_item, not motion-graphic-gen or submit_motion_graphic. Covers project/timeline intake, project visual language, editable properties, asset binding, inline JSX authoring, existing asset updates, timeline placement, and verification."
---

# Create Motion Graphics

Use this skill when a OpenChatCut task requires a Motion Graphic asset that the agent will author or patch as inline JSX.

This skill is for direct authoring. Do not translate the request into a Gemini prompt or generation brief, and do not call \`submit_motion_graphic\`, when this workflow is active.

Even though \`submit_motion_graphic\` exists in the tool list, treat it as the generation route, not this one. Ignore that path for MG work; use \`create_motion_graphic_from_code\` for new JSX assets and \`edit_asset\` for existing MG JSX. If the direct-authoring tools are missing, stop and report that the OpenChatCut tool surface is out of date.

Pass source inline through the asset code tools. Do not stage Motion Graphic code in the OpenChatCut repository, \`ai-working/\`, \`/tmp\`, a local HTTP server, generated code files, or guessed backend workspace paths.

## Core Principles

- Inspect project state when canvas size, fps, existing visual language, placement, or timeline conflicts are not already known.
- Identify the required inputs in **Before You Code** before authoring JSX.
- Create or update Motion Graphic assets through the available inline-code asset workflow; use current tool schemas for exact payload shapes.
- Place or move assets through the timeline editing workflow when the edit requires timeline placement.
- Re-read project state and verify the visible frame after structural or visual changes.

## Before You Code

Before writing JSX, identify only the information needed for this edit:

- **Placement**: start time, duration, target layer if known, and the target frame the graphic must compose with.
- **Role in the edit**: what job this Motion Graphic performs in the video.
- **Content**: exact text, numbers, media, or visual facts that must appear.
- **Timing**: whether internal motion should sync to speech, music, or a visual event.
- **Visual source**: user-provided style, project Design Style, brand colors/fonts, or an accepted existing Motion Graphic.
- **Editable fields**: which text, colors, numbers, booleans, image, or video values should become properties.

Ask only for missing high-leverage inputs that would materially change the result.

## Align With The User

You are the junior designer; the user is the manager. Direction is the high-leverage choice — surfacing it before authoring is much cheaper than reauthoring after.

Style alignment gate:

Separate visual direction from batch permission. A user-named text/custom style can choose the direction, but it does not permit multiple MGs until the user has confirmed a representative MG. Batch authoring is permitted only by an active Design Style, a selected visual preset, or a previously accepted representative MG.

- If there is no active Design Style and the user has not named a style, stop before authoring and ask the user to choose a direction.
- Generic quality adjectives are goals, not a named visual style. If the user only says the MGs should feel clean, premium, modern, professional, polished, or similar, offer catalog presets instead of inventing a direction.
- Prefer catalog Design Style presets: call \`manage_design_style\` with \`action: "list"\`, present 3-6 reasonable choices, and let the user pick or override.
- Load the \`widget-forms\` skill and use \`ask_followup_questions\` with a single-select field of preset names; this build has no preset thumbnails, so concise numbered choices are the standard route.
- You may recommend one choice, but still show the choice set. The point is visual alignment, not a single best guess.
- When it isn't obvious, also ask whether the MG sits over the video as an overlay or takes the whole frame.

Before authoring, choose the branch:

- One MG: use the active Design Style, accepted example, or user-named direction and proceed.
- Multiple MGs with an active Design Style, selected visual preset, or previously accepted representative MG: proceed with a batch design map.
- Multiple MGs with only a textual/custom direction, however clear: create exactly one representative MG, place it, render its composed frame, then stop for confirmation. Do not create a second MG asset or item before the user confirms.
- Multiple MGs with only generic quality adjectives: use the visual preset picker first.

When the task needs visual style alignment, check the active project Design Style first. If there is no active Design Style and the user has not given a clear style direction, use the style alignment gate above.

Saved user design styles are a library, not project confirmation. If \`manage_design_style list\` shows saved styles but no active project Design Style, do not infer or choose one silently; use \`action: "list"\` and explicit alignment unless the user selects a saved style or asks you to use one.

Catalog Design Style presets are named starting points with style summaries (no image previews in this build). When no active Design Style or user style is set, first look at the available catalog candidates with \`action: "list"\` and show 3-6 reasonable starting points as concise numbered choices (name + one-line summary). They do not need to match every detail of the user's request; presets set useful expectations and can be adapted in authoring. Do not force catalog presets when none are reasonably close; use text directions only then.

When using catalog presets, call \`manage_design_style\` with \`action: "list"\`. Pick 6 matches using each preset's \`description\` as agent-facing matching guidance when there are enough reasonable matches; use fewer only when fewer presets genuinely fit. Never render the full catalog as user-facing choices. Use \`ask_followup_questions\` with one single-select field, mapping each preset to \`{id: presetId, label: name}\`; this build has no thumbnails, so concise numbered choices are the standard route. Do not invent \`value\`, \`name\`, or \`media\` for catalog choices, and do not mix custom non-preset directions into the same visual picker. If a custom direction would help, describe it in prose outside the picker. Do not repeat catalog descriptions under the picker unless the user asks for details. Frame catalog options as visual starting points, not required choices: briefly make clear in the user's language that they can pick a close option or describe a different direction. If the user asks to refresh, call \`action: "list"\` again and show a different set of up to 6 reasonable matches. Do not repeat presets already shown in the current style-picking exchange; show fewer than 6 rather than repeat. Apply the user's pick with \`action: "apply"\`. After applying a preset or saved style, call \`manage_design_style\` with \`action: "get"\` before authoring MG code; preset names and list summaries are picker guidance, not the full motion/design spec. Do not create or update a Design Style from an unconfirmed recommendation.

The visual style picker is a turn boundary. After calling \`ask_followup_questions\` for style alignment, stop and wait for the user's submitted selection. Do not apply a preset, create MG assets, inspect more frames, or continue detailed MG planning from your own recommendation in the same turn.

For a batch of related MGs in one scene or topic, ask once for a shared direction — don't invent a different aesthetic per item, and don't ask per MG.

When the batch direction is textual or custom rather than a visual preset or active Design Style, the representative-MG gate above is a hard stop. A user-named text style skips only the preset picker; it does not confirm the visual language for multiple MGs. The representative MG validates visual language only; it does not define the form for every later MG.

The only times to skip the style picker:

- The user has already named a visual style, material, reference, or visual language ("做 editorial 杂志风的", "做个 80s 复古印刷", "magazine style 那种") — use it verbatim as the direction. For multiple MGs, this still enters the representative-MG branch until the user confirms the example.
- The user has explicitly waved off alignment ("直接做" / "don't ask, just do it"): make your best guess, name it in chat, then continue with the normal authoring, frame-inspection, and consistency workflow.

## Project Visual Language

Use the active project Design Style, user-provided style, brand assets, or an accepted existing Motion Graphic as the visual language for hand-authored JSX. A visual language means shared palette, typography logic, motion tone, spacing, density, material treatment, and level of polish.

When a Design Style is active, work from its full \`designSpec\` / \`styleGuide\`, not only its name or catalog summary. Treat explicit style rules for motion, typography, color, and material as implementation constraints.

Treat Design Style structure, materials, and template notes as visual vocabulary, not default containers. Express the style through typography, marks, geometry, texture, motion, spacing, and materials; use a bounded reading surface only when bounded reading is the actual editorial mechanism.

Do not create or update a project Design Style just because a one-off Motion Graphic needs styling. For multiple Motion Graphics in the same video, keep one coherent visual system unless the user asks for a deliberate contrast, and let each MG's content and editorial job determine its form.

## Visual System And Placement

Treat multiple MGs in the same video as one visual system. Shared style comes from palette, typography, motion tone, spacing, material, and polish.

Before authoring a batch, make a compact design map for the planned MGs: viewer job, content, visual mechanism, how it carries meaning beyond text, speech span, settled frame, read time, size, composition relationship, internal motion beats, and whether its form is intentionally recurring.

Let each MG's content and editorial job determine its form. Keep the same visual language while choosing the composition, size, placement, duration, and rhythm that fit that moment.

Choose the visual mechanism before writing JSX. Decide how the graphic carries meaning beyond text, using the confirmed visual language and the content's viewer job. Name a wrapper as the form only when a bounded reading surface is truly the right mechanism.

Text should rarely carry the whole graphic alone. Pair key words, stats, or claims with a tangible non-text visual role so the result is not just copy inside a wrapper.

Common defaults must earn their place. Use a bounded reading surface only when bounded reading is the editorial mechanism; otherwise let the MG's form come from the frame relationship and viewer job.

Reuse an MG asset only for an intentionally recurring component with the same viewer task, information structure, and visual form. Shared palette, typography, motion, or a bounded-surface treatment is visual language, not a reason to reuse the same asset.

Placement and duration are part of the settled frame composition. Choose each MG's position, size, anchor, start, and end from the relationship between the speech span, inspected frame, reading time, and visual job. Do not use a fixed safe-zone as the default placement; repeated anchors are intentional only when the frame relationship and viewer task recur. If the graphic does not feel integrated with the moment it explains, change its form, timing, scale, or skip.

Match the MG asset duration to the timeline span it is designed to occupy. Internal motion beats must complete inside the placed item duration; when the edit timing changes materially, update or recreate the MG instead of relying on a shorter timeline item to truncate a longer asset.

In a batch, compare the composed settled frames side by side. The MGs should share a visual language, but repeated surfaces, anchors, or rhythms should point to a recurring viewer job; otherwise revise the form, placement, or timing before reporting done.

Create the asset shape that fits the job at hand. For overlays, the asset box should tightly bound the visible graphic's local composition. Use timeline dimensions only when visible design intentionally spans the whole frame.

## Editable Properties

Expose user-visible and likely-to-change values as editable properties.

- Visible text, primary colors, accent colors, and key numeric values should be properties.
- Font choices should be \`font\` properties when users may reasonably change them.
- Image and video sources must be \`image\` / \`video\` properties.
- Code keys must match the property schema keys exactly.
- Read values from \`item.props\`; do not hardcode visible content that the user may reasonably want to change later.
- Use item-level property overrides only for intentionally recurring components with the same viewer task, information structure, and visual form. If any of those differ, create another MG asset and share palette, type, and motion logic instead.

Property entries should declare a stable key, user-facing label, type, and default value. Supported property types include text, number, color, boolean, select, font, image, and video.

## Fonts

Motion Graphics must use fonts the cloud renderer can load. Do not rely on local/system fonts such as \`STKaiti\`, \`PingFang SC\`, \`Microsoft YaHei\`, \`Arial\`, \`Helvetica\`, \`Comic Sans MS\`, \`system-ui\`, \`-apple-system\`, or generic CSS families as the primary rendered font; preview may have them locally, but export will fall back to the default stack.

When choosing or replacing a font, call \`search_fonts\` and use the returned canonical family name verbatim as the \`fontFamily\` value and matching \`font\` property \`defaultValue\`. Use Google Fonts or project custom fonts returned by the catalog. If a user explicitly asks for an unsupported local font, explain that cloud export cannot preserve it, search for a supported alternative with a similar feel, and use that supported family unless the user explicitly accepts export fallback.

## Assets

Images and videos rendered inside Motion Graphics must already be registered as project assets or otherwise be passed through editable asset properties.

- Do not hardcode media URLs in JSX.
- Use \`<Img>\` and \`<Video>\` only with URLs read from \`item.props\`.
- Guard empty image/video properties before rendering; an empty \`src\` can crash the runtime.
- To swap a rendered asset for one timeline instance, update that instance's editable property values rather than changing the shared asset code.

## Design Principles

The agent is the designer for direct-authored Motion Graphics. Do not merely satisfy constraints or place text in a wrapper. Before writing JSX, design the settled frame as a specific visual object.

Before writing code, decide:

- **Purpose**: what the viewer should understand faster because this MG exists.
- **Direction**: the specific visual language, not "clean", "modern", or "professional" alone.
- **Memory**: the one visual idea, spatial move, or motion beat the viewer should remember after 3 seconds.
- **Mechanism**: how typography, geometry, diagram, texture, image, or motion carries meaning beyond text.
- **Craft**: how typography, color, motion, spatial composition, and material treatment follow the chosen direction.

Before writing code, choose a clear aesthetic direction for this specific design. Commit to one direction and execute it with precision rather than defaulting to a generic look.

Default quality bar: distinctive, production-grade, and intentional. When the user has not specified a style and asks you to proceed, choose a specific visual direction with a point of view. Do not fall back to safe, basic, or generic just because the style is unspecified.

Restrained does not mean plain. Minimal or refined MGs still need a named design language, precise hierarchy, and one memorable visual decision.

Treat the Design Style's motion language as a constraint, not just mood. If it says hard cut, no opacity, no translate, no glow, no easing, word-by-word, static bars, or sequential nodes, implement those literally; do not replace them with fades, springs, sweeps, glows, or drifting motion.

Motion must earn its place. Do not add shine, sheen, light-sweep, scan-line, shimmer, glow, or glossy passes as default polish; use them only when the style or editorial job explicitly means scanning, loading, reflection, energy, or detection. Prefer typography, masks, stagger, data bars, and timing tied to the content.

Material treatment belongs to the visual language. Do not add glass, blur, heavy shadows, gradients, grain, paper texture, glow, or other surface polish just to make the surface feel designed; use those materials only when the confirmed style or visual job calls for them.

When the graphic includes text, create clear hierarchy. Use the Design Style's type system when it exists. When no type system is defined, make size, weight, spacing, and timing contrast visible at video scale.

Design the most visible frame first, then animate into that layout. Choreograph by importance: the first moving element is the hierarchy leader. Vary direction, duration, easing feel, and stagger rhythm when the visual job changes.

Anti-slop rules are a floor, not a ceiling. Avoid generic AI-generated aesthetics: purple/blue gradient backgrounds, fake glassmorphism everywhere, predictable feature-tile layouts, or cookie-cutter design that lacks context-specific character. Within one visual system, vary form, composition, and rhythm when the visual job changes; keep color and typography logic coherent enough that the MGs belong together.

Do not default to card-shaped overlays. Unless a bounded reading surface is truly needed, avoid floating panels, tickets, notes, or rounded rectangles that simply hold text; they often feel detached from the footage and make the video look like UI rather than motion design.

Use strong materials, texture, gradients, glow, depth, dense composition, or bold motion when they are part of the confirmed visual language or the editorial job. Do not avoid expressive design just because a generic version of the same effect would be bad.

Do not default to centered, symmetrical layouts. Consider asymmetry, overlap, generous negative space, or controlled density, whichever fits the content. Unexpected spatial choices make motion graphics feel designed, not generated.

A character, illustration, or compound shape is one visual entity. When multiple parts must visually connect, attach, or align, render those parts inside a single \`<svg>\` with one shared coordinate space and named anchors. Independent hardcoded \`left\` / \`top\` across separate wrappers produces visible gaps.

### Text Layout Safety

For text-bearing MGs, design the settled frame as a real layout before animating. Use flexbox or grid, \`gap\`, \`padding\`, \`maxWidth\`, \`lineHeight\`, and natural wrapping for related text blocks. Do not stack readable text with independent hardcoded \`top\` values unless the text is intentionally decorative or typographic art.

Editable text may become longer than the default. Reserve space for plausible longer copy, allow wrapping with \`whiteSpace: "normal"\` and \`overflowWrap: "break-word"\`, and reduce hierarchy, size, density, or change form when the content cannot fit cleanly.

Animated transforms do not affect layout. If text scales, pulses, slides, or staggers near other text, leave visual headroom for the largest animated state. Intentional overlap may be used for graphic layers, shadows, marks, or decorative typography; ordinary readable text must not collide.

Avoid forced \`<br>\` or manual line breaks for dynamic text unless each line is deliberately fixed. Prefer width-constrained wrapping.

Use this base component shape:

\`\`\`javascript
const Component = ({ item }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const props = item.props || {};
  const accentColor = props.accentColor;

  const rootStyle = {
    position: "absolute",
    inset: 0,
    backgroundColor: "transparent",
  };

  return <div style={rootStyle}>{/* content */}</div>;
};
\`\`\`

## Motion Graphic Code Contract

Violations cause runtime crashes. Strict compliance required.

1. **Syntax:** Pure JavaScript JSX. No TypeScript.
2. **Imports:** No import statements. Globals are pre-injected: \`React\`, \`spring\`, \`useCurrentFrame\`, \`useVideoConfig\`, \`interpolate\`, \`interpolateColors\`, \`Math\`, \`random\`, \`Easing\`, \`AbsoluteFill\`, \`Sequence\`, \`Series\`, \`Img\`, \`Video\`, and \`Audio\`.
3. **No Remotion global:** Never use \`Remotion.xxx\` or \`const { ... } = Remotion\`. Hooks and components are pre-injected as standalone globals.
4. **Exports:** No \`export default\`. Define \`const Component = ...\`.
5. **Timing:** No \`Sequence\` wrappers inside the component. Use flat frame-driven logic.
6. **Logic:** No inline logic in JSX props. Pre-compute values in variables before \`return\`.
7. **Helpers:** No undefined functions. Use \`interpolateColors\` plural. Define any helpers locally.
8. **AbsoluteFill:** \`AbsoluteFill\` is a component, not a style object. Never spread it. It may be used for inner layers, but never as the root.
9. **Root element:** The root must be \`<div style={rootStyle}>\`.
10. **Assets:** \`<Img>\` and \`<Video>\` sources must read from image/video editable props. Never hardcode URLs. If no assets are provided, design with shapes, text, and CSS.
11. **Hooks:** Get frame from \`useCurrentFrame()\`, not from \`useVideoConfig()\`.
12. **Local box:** Component must accept \`({ item })\` props. The asset \`width\`/\`height\` are the MG's natural box around its visible local composition, not the timeline canvas; fill that box with \`position:absolute; inset:0\`. Timeline placement sets final screen size and position.
13. **Layout control:** Use flexbox or grid for text blocks and structured content. Use SVG or absolute geometry when the design depends on spatial relationships, compound shapes, frame treatments, or drawn/animated marks. Allow text to wrap naturally unless the request requires single-line text.
14. **Editable props:** Component must read editable values from \`item.props\`. Never add fallback values like \`|| "Default"\` or \`?? false\` after \`props.key\`; declared runtime properties already have values.
15. **Property schema:** Declare matching editable properties. Include all visible text content and primary/accent colors.
16. **Image/video props:** Guard empty URLs; only render \`<Img>\` or \`<Video>\` when the URL is truthy.
17. **Background:** Default background is transparent. If a background surface is added, expose a \`transparentBackground\` boolean property.

## Placement And Review

Do not author JSX from timing alone. Inspect the target frame first: timing tells you when; the frame tells you form, placement, and background. For a batch of overlays, make one target-frame screenshot/contact sheet and decide each MG's settled frame, speech span, read time, and placement relationship before choosing final anchors, sizes, and durations.

Design the settled frame first: choose the moment when the MG is most readable, place the final layout there, then animate into that composition.

Before authoring JSX, make four linked editor decisions. They prepare the Motion Graphic asset and the later timeline placement.

| Decision               | Question                                                               | Output                                                           |
| ---------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Content**            | What idea deserves a visual layer?                                     | The message or visual fact the MG expresses.                     |
| **Timing**             | When should it land and leave?                                         | Speech span, read time, duration, and any internal motion beats. |
| **Form and placement** | What kind of MG is it, and where does it belong in the composed frame? | MG form/size, then \`edit_item\` placement after asset creation.   |
| **Background**         | Is this an overlay on the footage, or its own moment?                  | Transparent or opaque background.                                |

Placement principles:

- Compose the footage and MG together from the frame you inspected: subject, camera framing, visual weight, captions/subtitles when present, and the MG's job.
- Place the MG where it makes the frame read best for that moment.
- Keep necessary information readable at video scale without zooming; if the MG feels detached, change form, timing, scale, or skip.
- Account for captions only when captions are present or planned.
- Treat full-frame MGs as intentional beats, not as a workaround for awkward overlay placement.

Default to a transparent overlay unless a full-frame beat is intended. A transparent overlay still uses a natural-box asset; do not use a transparent timeline-sized asset just for placement.

Place and review:

- Place with \`edit_item\` (adds/updates). Prefer an explicit rectangle once you know the frame: one horizontal anchor, one vertical anchor, width, and height.
- Verify with screenshots. Pass multiple frames in one tool call — settled state appears alongside any transient mid-animation frames. Compare frames before concluding: apparent truncation, missing elements, or "broken design" visible in only some of the batch is animation, not a real flaw. If unclear, re-capture more frames around the suspect one before adjusting anything. Judge from the settled frames.
- Check the full frame: necessary information is clear at video scale, captions remain readable when present, MG content is correct, text is legible, and the composition feels balanced and intentional.
- For text-heavy MGs, inspect the settled frame where the most text is visible. Check for text-on-text overlap, clipped lines, overflow outside the natural asset box, and readable content covered by animated scale or translate states.
- If it fails, first adjust position and size. If position/size cannot make it work, change the design form. Verify each recurring component form on a target frame before expanding it.

## Asset And Timeline Flow

### Create A New Asset

Create new Motion Graphic assets by passing inline JSX and editable property metadata through the current OpenChatCut asset-creation tool. Use the tool schema for the exact field names and accepted duration format.

Choose the MG's natural box, duration, asset name, description, and property schema from the edit requirements. The asset duration should match the intended placed span, including internal entrance, hold, and exit timing. The asset creation step only creates the asset; timeline placement is separate.

For \`create_motion_graphic_from_code\`, pass that natural box as \`width\`/\`height\`; use timeline dimensions only for intentional full-frame MGs. If the content occupies only part of the screen, place and scale the bounded asset with \`edit_item\` instead of baking screen coordinates into a full-canvas MG.

### Patch An Existing Asset

Before patching, inspect the existing asset code and property schema. Preserve unrelated behavior, property keys, and timeline timing unless the requested change requires otherwise.

Read [\`references/canvas-pipeline-rules.md\`](references/canvas-pipeline-rules.md) before changing code, especially when SVG is involved. Patch with full inline replacement source through the current asset-update tool.

### Place On The Timeline

Use the timeline editing workflow for placement, movement, trimming, and per-instance property overrides. Dry-run large or uncertain transactions when the tool surface supports validation.

## Implementation Rules

Read [\`references/canvas-pipeline-rules.md\`](references/canvas-pipeline-rules.md) before any asset-code update, when writing or modifying SVG, or when preview looks correct but export renders black or empty.

## Verification

A successful tool call is not verification.

- Re-read asset state after asset creation or update.
- Re-read timeline state after placement, movement, trimming, or property overrides.
- For visible changes, inspect a real composed frame using the normal OpenChatCut visual verification path.
- For a batch, compare the composed settled frames side by side; verify that each visual job has a fitting form, repeated surfaces/anchors/rhythms are intentional, and each placement works for its own target frame.
- If the result is wrong, classify the failure before retrying: invalid tool shape, invalid JSX, missing/incorrect property key, timeline placement, async asset readiness, or canvas/export safety.
- Fix placement with timeline edits; fix bad rendering with JSX/property changes; use canvas rules for preview-good/export-black failures.
`,re='# Canvas Pipeline Rules (for hand-editing MG code)\n\nWhen you edit Motion Graphic asset code through any path that mutates `MotionGraphicAsset.code`, the **local export canvas pipeline** (Chrome\'s html-in-canvas API) samples the rendered output via `gl.texElementImage2D`, which reads the paint-phase snapshot — NOT the GPU compositor output. Preview uses a DOM layer instead and is not subject to these limits.\n\nThe backend may run additional review during asset creation, but not every asset-code update path has that same review. So when you (the editing agent) modify code by hand, **you are the only safeguard** against introducing patterns that make the entire MG render black in local export. The rules below are the ones the backend reviewer enforces during asset creation; mirror them here.\n\nIf you violate any pattern, the symptom is consistent: the affected motion graphic appears entirely black or empty in local export, even though preview in OpenChatCut and a normal browser both look correct. Preview rendering correctly is NOT evidence that export will work.\n\n## The three canvas-pipeline traps\n\n### 1. SVG inner-element `transform` attribute\n\nInside any `<svg>`, the OUTERMOST `<g transform="...">` is allowed. Any `transform=""` attribute on an inner `<path>`, `<line>`, `<rect>`, `<circle>`, `<ellipse>`, `<polygon>`, or a nested `<g>` breaks the canvas pipeline.\n\n**Wrong:**\n\n```jsx\n<svg width={W} height={H}>\n  <g transform="translate(960, 540)">\n    {leaves.map((l, i) => (\n      <g key={i} transform={`translate(${l.x},${l.y}) rotate(${l.rot})`}>\n        <path d="M0,0 C-25,-35 0,-90 0,-90" />\n      </g>\n    ))}\n  </g>\n</svg>\n```\n\n**Right** — bake rotation+translation into absolute path coordinates at `React.useMemo` time:\n\n```jsx\nconst leafPaths = React.useMemo(() => {\n  const tx = (px, py, cx, cy, deg) => {\n    const r = (deg * Math.PI) / 180;\n    return [\n      Math.cos(r) * px - Math.sin(r) * py + cx,\n      Math.sin(r) * px + Math.cos(r) * py + cy,\n    ];\n  };\n  const CONTROL_POINTS = [\n    [0, 0],\n    [-25, -35],\n    [0, -90],\n    [0, -90],\n  ];\n  return leaves.map((l, i) => {\n    const pts = CONTROL_POINTS.map(([x, y]) => tx(x, y, l.x, l.y, l.rot));\n    return {\n      key: i,\n      d: `M${pts[0][0]},${pts[0][1]} C${pts[1][0]},${pts[1][1]} ${pts[2][0]},${pts[2][1]} ${pts[3][0]},${pts[3][1]}`,\n    };\n  });\n}, [leaves]);\n\n<svg width={W} height={H}>\n  <g transform="translate(960, 540)">\n    {leafPaths.map((p) => (\n      <path key={p.key} d={p.d} />\n    ))}\n  </g>\n</svg>;\n```\n\n### 2. Animated CSS on the `<svg>` element itself\n\n`style.opacity` or `style.transform` directly on a `<svg>` element with a per-frame interpolated value breaks the canvas pipeline.\n\n**Wrong:**\n\n```jsx\n<svg style={{ opacity: interpolate(frame, [0,30], [0,1]) }}>...</svg>\n<svg style={{ transform: `scale(${animScale})` }}>...</svg>\n```\n\n**Right** — wrap in an HTML `<div>` for opacity; use SVG `transform=""` attribute on outermost `<g>` for scale:\n\n```jsx\n<div style={{ opacity: interpolate(frame, [0, 30], [0, 1]) }}>\n  <svg>\n    <g transform={`scale(${animScale})`}>...</g>\n  </svg>\n</div>\n```\n\n### 3. SVG `opacity` presentation attribute on inner elements\n\n`opacity={0.6}` on inner SVG elements (`<line>`, `<path>`, `<circle>`, etc.) has the same compositor-driven semantics as CSS `style.opacity` and breaks the pipeline.\n\n**Wrong:**\n\n```jsx\n<line opacity={0.6} stroke={accentColor} />\n<circle opacity={0.3} fill={mainColor} />\n```\n\n**Right** — bake alpha into stroke/fill color:\n\n```jsx\n<line stroke="rgba(255,255,255,0.6)" />\n<circle fill="rgba(255,165,0,0.3)" />\n```\n\n(If the color comes from an editable prop like `props.accentColor` and you can\'t precompute rgba, do the alpha conversion in `useMemo`: parse the hex prop, compute `rgba(r,g,b,a)`, and bind that as the stroke/fill string.)\n\n## When to re-read this\n\n- Before any update that changes `motion-graphic` asset `code`\n- When debugging a "preview looks fine but the exported MP4 renders black" report — almost always one of these three\n- When integrating an external SVG snippet that uses inner-element `transform=` (most hand-authored SVGs do; you\'ll need to bake the transforms)\n\n## Safe patterns (paint-phase, work correctly)\n\n- HTML element `style`: `boxShadow`, `textShadow`, static `opacity`, `transform` (translate/scale/rotate), `borderRadius`, gradients via `background` / `backgroundImage`\n- SVG: outer `<g transform="">` only; all inner shapes use absolute `d=""` coordinates\n- SVG-native filters in `<defs>` (`<feGaussianBlur>`, `<feBlend>`, `<feColorMatrix>`, `<feDropShadow>`) applied via the SVG `filter="url(#id)"` ATTRIBUTE on an inner element — these DO work (they run in the paint phase, not the compositor)\n',ie=`---
name: ecommerce-product-montage
description: |
  Assemble product footage, UGC, and b-roll into a conversion-oriented montage with a hook → pain → demo → proof → CTA rhythm.
  Use for 带货混剪, 产品混剪, 商品短视频, 种草视频, ecommerce montage, product reel, UGC cutdown, or when the user wants selling footage cut into a short that converts.
---

# Ecommerce Product Montage

Use this workflow when the goal is a short that *sells*, not just one that looks
good. The failure mode to avoid is a pretty montage with no sales spine: strong
footage, pleasant cuts, and zero reason for the viewer to act.

This workflow decides **structure and sequencing** for selling footage. It does
not write the ad copy — when the hook, angles, or CTA text are not given, hand
off to \`product-ad-video-script\` for the script, then come back here to assemble.
It does not re-explain music tooling — for beat-driven placement use
\`beat-sync-montage\` or \`music-intelligence\`.

This is a OpenChatCut-native workflow. Use the current project, source assets,
asset-frame inspection, AV/script context, and OpenChatCut editing tools.

## When to switch workflows

- No script yet, only a product/offer → \`product-ad-video-script\` first, return here to cut.
- Music should drive the cut placement → \`beat-sync-montage\` (and \`music-intelligence\` for tools).
- Many clips, no selling intent, just the strongest cut → \`multi-clips-to-reels\`.
- N distinct selling variants from one pool → \`batch-montage-variants\`, using this workflow per cut.

## Workflow

1. Fix the one job the edit must do: which objection it dissolves or which action it drives (save, tap, buy, follow). If the brief names none, propose one and confirm.
2. Inventory the material by sales role, not by file: hero demo, UGC reaction, proof (review/result), context b-roll, price/offer card. See [references/material-roles.md](references/material-roles.md). Footage that fills no role is parked, not force-inserted.
3. Lay the sales spine before cutting: hook (0–3s, the open loop) → pain/context → demo → proof → CTA. See [references/sales-spine.md](references/sales-spine.md). Every beat maps to a spine position; a clip with no spine position is cut.
4. Lead with the hook from a real moment, not a title card. The first three seconds either open a loop ("you are doing X wrong") or show the payoff; a logo sting as opener loses the scroll.
5. Place the demo where the viewer is curious, not where the script says "demo." Demo proves the hook; if the hook is a result, demo the path to it.
6. Insert proof as a pattern interrupt, not a block. One real review line or result frame beats a stacked proof montage. See [references/proof-placement.md](references/proof-placement.md).
7. Hold the CTA long enough to read. Price, offer, and the exact action each get a legible beat; a CTA flashed for one cut is a CTA nobody acts on.
8. Keep claims grounded. Do not manufacture prices, guarantees, medical, or earnings claims the assets do not support. Pull offer text from the product page or user notes; if absent, ask.
9. QA by the spine, not by the cut list: can a cold viewer state the offer and the action after watching once? If not, the edit sells nothing.
10. Report the spine coverage and any role with no usable footage, so a thin section is flagged before shipping.

## Plan Format

- The one job this edit does
- Material inventory by role, with what is missing
- Spine map: timestamp → spine position → which clip → why it earns that slot
- Hook type (open loop / payoff) and the moment used
- Proof placement and the interrupt it creates
- CTA beats: price, offer, action, each with duration
- Risks: ungrounded claims, thin demo, CTA too short, hook that does not land

## Rules

- **Spine over polish.** A serviceable cut in the right spine position beats a beautiful cut that breaks the argument.
- **Hook is a moment, not a card.** Open on footage that creates tension or shows the result; title cards come later if at all.
- **One job per edit.** An edit trying to handle every objection handles none. Pick the one that converts this audience.
- **Proof interrupts, it does not pile.** One credible proof point lands harder than five weak ones.
- **CTA must be legible.** Price, offer, and action each get a readable beat; never flash the CTA.
- **Claims stay grounded.** No invented price, guarantee, medical, or earnings claim. Ask when the asset is silent.
- **Park, do not force.** Footage that fits no spine position weakens the edit; leave it out and say so.
`,ae=`# Material Roles for Product Montage

Sort footage by the job it does in the sale, not by which file it came from. A
clip that is gorgeous but fills no role is dead weight in a selling edit.

## The five roles

| Role | What it carries | Weak when |
|---|---|---|
| Hero demo | The product doing the thing it is sold for | Staged, over-lit, obviously a commercial |
| UGC reaction | A real person's genuine response | Scripted, reads as an actor reading lines |
| Proof | Review line, result, before/after, stat | Fabricated, unreadable, piled without a beat |
| Context b-roll | Setting, lifestyle, the world the product lives in | Decorative only, no link to the argument |
| Offer card | Price, discount, the exact action to take | Flashed, buried, contradicts the spoken CTA |

A finished montage needs at least hero demo + one proof + an offer card. UGC and
context are what lift it from ad to story.

## Inventory before planning

For each source asset, tag it with the role(s) it can serve and the strength:

\`\`\`
asset          role                strength   note
clip_04.mp4     hero demo           strong     real unboxing, natural light
ugc_02.mp4      ugc reaction        medium     genuine laugh, but audio low
review_01.png   proof               strong     verbatim 5-star, on-brand
broll_11.mp4    context b-roll      weak       pretty but unrelated to hook
\`\`\`

Strength is a judgment, not a file property — the same clip can be strong in one
role and useless in another.

## Parking, not forcing

Footage that fits no spine position is parked, not inserted to fill time. Common
cases:

- B-roll with no link to the argument → cut or move to a separate mood cut.
- A second proof point when one already landed → hold for a variant, do not stack.
- Hero demo that is clearly staged → use as context, not as the proof of the hook.

Parking keeps the spine tight. A 20-second edit with every role covered beats a
40-second edit padded with pretty irrelevance.

## Capacity check

If the pool has no usable proof or no offer text, say so before cutting. An edit
with hook + demo but no proof and no CTA is a teaser, not a product montage — the
user should decide whether that is the intent.
`,oe=`# Proof Placement

Proof is what turns a nice demo into something the viewer believes. The mistake
is to pile proof into a block — five weak claims read as a commercial break. One
credible proof point, placed as an interrupt, lands harder.

## Proof as a pattern interrupt

A selling montage builds rhythm: hook, pain, demo. Proof should *break* that
rhythm with a jolt of reality — a real voice, a real number, a real before/after.

- Insert proof right after the demo peak, while belief is lowest and curiosity is highest.
- Use a hard cut or a distinct audio bed so the proof reads as "and here is the evidence," not "and now more footage."
- One proof point per edit unless the brief is explicitly comparison/long-form.

## What counts as proof

| Type | Strong | Weak |
|---|---|---|
| Review line | Verbatim, on-brand, specific | "great product" generic, or fabricated |
| Result | Before/after frame, measurable | Vague "it works" with no visual |
| Stat | Sourced, legible on screen | Unsourced number flashed past |
| UGC reaction | Genuine, spontaneous | Clearly read from a script |

## Grounding rules

- No invented price, guarantee, medical, or earnings claim. Pull offer and proof
  text from the product page, user notes, or visible assets.
- If the asset is silent on a claim the edit implies, ask — do not fill the gap
  with a plausible number. A wrong claim in a shipped montage is a trust loss, not
  a trim.
- Attribute proof to its source when the format allows (e.g., a review handle),
  so it reads as real rather than as copywritten.

## Capacity and variants

If the pool has several strong proof points, do not stack them in one edit —
distribute them across variants (see \`batch-montage-variants\`). Each variant leads
with a different proof, which is also how you A/B test what actually converts.

## Red flags

- Proof is a block of three-plus clips with no interrupt between them.
- The only proof is generic praise with no specifics.
- The CTA contradicts the proof (proof says "results vary," CTA says "guaranteed").
- Offer text appears nowhere on screen, only in spoken audio no one replays.
`,se=`# Sales Spine

The spine is the argument the edit makes. Cut to the spine, not to the clock.
Every clip earns its slot by advancing one position; a clip that advances none
is removed.

## The five positions

| Position | Job | Time budget | What lands it |
|---|---|---|---|
| Hook | Open a loop or show the payoff | 0–3s | A real moment of tension or result, not a logo |
| Pain / context | Why this matters | 3–8s | The problem the product resolves, felt not stated |
| Demo | Prove the hook | 8–18s | The product doing the thing, natural and legible |
| Proof | Make it believable | 18–24s | One real review/result, placed as an interrupt |
| CTA | Drive the action | 24–30s | Price, offer, and the exact action, each readable |

Budgets are starting points for a ~30s short; stretch or compress by platform,
but never let the CTA fall below ~3 readable seconds.

## Hook first, always

The hook is position one and the only non-negotiable open. Two working shapes:

- **Open loop:** "you are doing X wrong" / "stop buying Y" — tension the rest of the edit resolves.
- **Payoff:** show the result in frame one, then demo the path to it.

A logo sting or a slow establishing shot as the opener forfeits the scroll. If
the only strong opener is the demo, lead with a one-beat result slice and return
to the full demo in position three.

## Demo proves the hook

If the hook is a result, the demo is the path to that result — sequence them so
the viewer connects "I saw the payoff" to "here is how." If the hook is a problem,
the demo is the relief. Either way the demo is not a separate chapter; it is the
answer to whatever the hook asked.

## CTA must be legible

The CTA is three sub-beats, not one:

1. **Price** — the number, on screen long enough to read (≥1.5s).
2. **Offer** — the discount, bundle, or urgency, distinct from the price.
3. **Action** — the exact verb: "tap", "save", "follow", named once and held.

Flashing the CTA for a single cut is the most common reason a good edit converts
nothing. Hold it.

## One job per edit

Pick the single objection or action the edit serves. An edit that tries to handle
price, quality, and social proof simultaneously handles none — it reads as a
brochure. State the one job in the plan; if a clip serves a different job, it
belongs in a variant, not this cut.
`,ce='---\nname: explainer-video\ndescription: Create finished explainer videos from a topic, script, outline, voiceover, product logic, data, technical concept, course material, or reference assets. Use when the user wants narration, motion graphics, stock footage, generated visuals, or mixed visuals to explain an idea.\n---\n\n# Explainer Video\n\nUse this workflow to turn information into a clear finished video. The information is the product: topic, script, logic, data, product mechanism, or voiceover. Visuals support understanding. Explainer Video owns the section plan, narration mode, timing order, assembly, and QA; `create-motion-graphics` is the helper workflow for direct Motion Graphic authoring and placement.\n\n## Workflow\n\n1. Read the project state, prompt, attached files, assets, transcript, and timeline.\n2. Identify the working labels:\n   - `explainer_start`: `topic_only`, `script_or_outline`, `voiceover_or_transcript`, `product_or_data`, `reference_assets`, or `direct_mg_animation_brief`.\n   - `source_structure`: `free_topic`, `script_sections`, `timestamped_sections`, `slides_or_pages`, `existing_voiceover`, `uploaded_assets`, `product_or_data`, or `mixed`.\n   - `narration_mode`: `generated_tts`, `existing_voiceover`, `transcript_only`, or `none`.\n   - `visual_mode`: `motion_graphics`, `stock_or_uploaded_footage`, `generated_video_or_images`, or `mixed`.\n3. Respect source structure. If the user provides structured material such as timestamps, numbered sections, slides/pages, scene labels, chapters, bullet outline, product points, transcript ranges, or voiceover sections, use that as the default planning scaffold. Merge, split, reorder, or relabel only when there is a clear production reason; explain the change and get user acceptance before treating it as the plan.\n4. Ask only for missing details that change the result: topic or script, target length, audience, platform/aspect ratio, language/voice, visual mode, tone, brand/style constraints, and whether to plan first or create directly.\n5. If more than one detail is missing, load `widget-forms` and ask in one `<widget>`. Use text fields for topic/script/context and single-choice fields for duration, platform, language/voice, and visual mode.\n6. Complete the preflight before writing visual treatments. The plan must have values for:\n   - `source_structure`\n   - `narration_mode`\n   - `visual_mode`\n   - `animation_reference`: `read` or `not_needed`\n   - `visual_direction_source`: active Design Style, chosen preset, concrete user style/reference, accepted role anchor, explicit proceed-without-alignment, or `not_needed`\n   - `voice_selection`: confirmed concrete preset, audition needed, or `not_needed`\n   - `timing_source`: actual voiceover/transcript ranges, generated TTS duration, user timestamps, planned duration, or `not_needed`\n7. Animation Reference Gate. If any section may use motion graphics, animation, animated diagrams, data animation, mechanism visualization, abstract concept visualization, or MG overlays, read [references/explainer-animation.md](references/explainer-animation.md) before writing those visual treatments. If the visual plan uses only stock footage, uploaded footage, generated live-action/video clips, or still images, mark `animation_reference: not_needed` and continue without loading it.\n8. Motion Graphic Direction Gate. If any section will generate MG/animation, load `create-motion-graphics` before asking the user to choose visual style. Use it to read the existing project visual language, align or confirm the Design Style, and directly author and place the Motion Graphic. Explainer Video still owns narration mode, section order, timing, assembly, and QA. Before final MG authoring, confirm visual direction through one of: active Design Style, catalog Design Style preset chosen from visual cards, concrete user style/reference, accepted role anchor, or explicit proceed-without-alignment. Treat broad hints such as "clean", "modern", "technical", "cinematic", or "tech style" as filters for preset selection, not as enough to generate final MGs. Do not invent text-only style choices before checking presets; assistant-written style options are fallback alignment, not a catalog preset.\n9. Build a compact explainer plan only after the relevant gates above are complete:\n   - viewer promise or thesis\n   - preserved or proposed sections\n   - narration source and timing source\n   - narration-to-visual map per section: narration text or time range, visual goal, visual treatment, source assets, and sync risk\n   - assumptions and claims that need grounding\n   - first visible result to create before batching\n10. For `topic_only`, write a short outline before drafting or generating. For `script_or_outline`, preserve the user\'s claims and meaning while tightening structure. For `product_or_data`, explain the mechanism or value without inventing unsupported claims. For `direct_mg_animation_brief`, do not force a broad explainer outline; inspect the provided script, assets, references, transcript, or style target, then create the requested MG section, intro, diagram, or overlay inside the same gates.\n11. Voice Gate. For `generated_tts`, load `voice` before recommending voices, choosing a preset, or submitting TTS. If the user has not confirmed a concrete voice preset, follow `voice` to read the curated voice list and show an audition widget first. Do not infer a `voiceId` from the content topic, language, gender, or broad style words.\n12. Create or align narration only when needed. For `generated_tts`, draft or tighten section-level narration lines first; estimate whether they fit target timing before submission, rewrite obvious mismatches, generate/place TTS by section only after the Voice Gate is complete, then read actual audio duration before any matching narration-backed MG/animation generation. Do not submit TTS and its matching MG in the same parallel batch. For `existing_voiceover`, do not regenerate narration; transcribe or read the audio and split it into section time ranges before generating matching visuals. For `transcript_only`, confirm whether the transcript should become TTS, captions, or only structure if ambiguous. For `none`, skip narration sync and plan visuals from the information structure and output rhythm.\n13. Produce visuals section by section. For MG/animation, verify the animation reference has been read, visual direction is confirmed, and `create-motion-graphics` has been used for direct authoring and placement before final generation or batching. For generated-TTS sections, even the first representative section MG must wait until that section\'s actual TTS duration is known. For narration-backed MG/animation, duration must come from the matching narration\'s actual audio duration when available, not from script estimates. For stock, uploaded, generated-video, or mixed visual sections, inspect/select the visual source first and use it only when it supports the section. When style or correctness is uncertain, create the first representative section or shot before batching only after required narration timing exists; a pre-audio style proof requires explicit user approval and must be labeled style-only, not treated as a section MG or placed as final timeline content.\n\n14. Assemble the timeline with narration, visuals, captions when useful, background music, and section pacing. For narration-backed MG/animation sections, align narration and matching visuals to the same start time and cover the full narration section unless the visual plan intentionally changes shots within that section.\n15. Run Narration-Visual Sync QA before done. For each narration-backed section, check whether spoken content matches the visual, whether visual duration covers narration, whether visual information density supports the spoken point, and whether transitions happen too early or too late. Fix failures before delivery by tightening narration, splitting the section, extending/regenerating visuals, adjusting timing, or asking the user to choose a tradeoff.\n16. Final QA before done: topic clarity, factual grounding, visual-mode fit, narration coverage, timing, caption readability, audio mix, timeline continuity, narration-visual sync, and export readiness.\n\n## Rules\n\n- Explain the idea; do not merely decorate narration with icons or subtitles.\n- Do not invent facts, prices, medical claims, performance claims, legal claims, or product guarantees.\n- Do not use existing footage as filler when it is unrelated to the explanation.\n- Do not average every uploaded asset into the video. Use assets only when they support a beat.\n- Do not keep asking after enough information exists to make the first visible result.\n- Do not put full spoken sentences on screen. Use labels, numbers, short questions, or section titles.\n- Do not rewrite structured user inputs into a different section plan without explaining why and getting user acceptance.\n- Do not output MG/animation visual treatments before the animation reference gate has been resolved.\n- Do not generate final MG/animation before the visual-direction gate is resolved.\n- Do not satisfy the visual-direction gate with ad hoc style choices you invented before loading `create-motion-graphics` and checking its project visual-language intake. A `preset` means a catalog Design Style preset shown through visual cards, not a text label.\n- Do not force generated TTS when the user already has a usable voiceover or does not want narration.\n- Do not call `submit_voice` before loading `voice` and confirming a concrete voice preset.\n- Do not submit a narration-backed MG/animation in parallel with the TTS that should time it.\n- Do not submit final narration-backed MG from estimated script duration. Narration-backed MG must use the matching narration text or time range and the real audio duration when available.\n- Do not let `create-motion-graphics` override the Explainer Video source structure, narration mode, section order, timing, assembly, or QA workflow.\n\n## Plan Format\n\nUse this compact format when planning:\n\n- `explainer_start`: starting point label\n- `source_structure`: input scaffold and whether it is preserved or changed\n- `narration_mode`: `generated_tts`, `existing_voiceover`, `transcript_only`, or `none`\n- `output`: platform, aspect ratio, target length, language, and voice when relevant\n- `viewer_promise`: what the viewer will understand by the end\n- `preflight`: animation reference status, visual-direction source, voice selection, and timing source\n- `sections`: beat, narration text or time range, visual goal, visual treatment, source assets, sync risk\n- `first_visible_result`: the first section or shot to create before batching; mark it as non-final if real narration timing is not known\n- `sync_check`: for narration-backed MG, note the timing source, narration duration, MG duration, match result, and any fix applied\n\nWhen reporting execution, include created timeline names, narration mode, visual modes used, assumptions, sync fixes applied, and what to review first.',le=`# Explainer Animation Reference

Use this reference to decide what an animated explainer section must communicate before writing its visual treatment. Animation earns its place when motion, sequence, spatial relation, or changing state makes the idea easier to understand.

## Gate boundaries

- Read this file before planning any motion graphic, animated diagram, mechanism view, data animation, abstract concept animation, or MG overlay.
- This reference defines explanatory structure. It does not replace \`create-motion-graphics\`, its direct-authoring rules, or its project Design Style alignment.
- Load \`create-motion-graphics\` before proposing visual-direction choices or authoring a Motion Graphic, then read the existing project visual language and confirm a valid Design Style source through the parent gate.
- Script estimates may support planning only. Final narration-backed animation must use the matching narration text or time range and actual audio duration when available.
- Keep Explainer Video in control of section order, narration mode, timing, timeline assembly, and sync QA.

## Explanation test

For every proposed motion, finish this sentence: “The viewer understands ___ because the animation shows ___ changing or relating to ___.” If the blanks cannot be filled precisely, the motion is probably decorative.

**Animation that explains:**

- reveals steps in causal or chronological order;
- tracks an entity through a process;
- compares before and after states on a stable frame;
- exposes hierarchy, flow, dependency, scale, or feedback;
- changes a data encoding in direct response to the narrated claim;
- preserves object identity so the viewer can follow what changed.

**Decorative motion:**

- makes icons bounce, drift, pulse, or orbit without adding meaning;
- repeats the narration as animated subtitles or unrelated symbols;
- uses particles, wipes, parallax, or camera movement as filler;
- changes layout merely to keep the frame busy.

Decorative motion may support tone, but it must stay subordinate to the explanatory action and must not compete with labels or state changes.

## Map meaning to a visual grammar

Choose the grammar from the claim, not from the desired effect.

| Claim structure | Preferred visual grammar | Required evidence on screen |
| --- | --- | --- |
| Sequence or procedure | ordered states, timeline, step flow | current step, direction, start and result |
| Cause and effect | directed flow or input-process-output | cause, mechanism, effect, arrow meaning |
| System mechanism | stable diagram with state changes | entities, relationships, what enters/exits |
| Before and after | aligned states or controlled morph | same subject, same scale, changed variable |
| Comparison | parallel frames, matrix, or shared-axis chart | common basis, units, meaningful difference |
| Hierarchy or containment | nested groups or tree | parent-child relation and scope |
| Quantity or trend | honest chart or proportional encoding | value, unit, baseline, time/category |
| Feedback or cycle | loop with direction and update state | trigger, loop path, stopping or repeat condition |
| Abstract concept | consistent tokens plus a small legend | what each token represents and how it behaves |

For each animated section, record: narration phrase or time range, viewer takeaway, entities, relationship or change, state sequence, labels, data/source status, treatment, and sync risk.

## Plan mechanism and diagram states

1. Define the **initial state**: what exists before the narrated change.
2. Define each **transition state**: one meaningful change per beat whenever possible.
3. Define the **result state**: the condition that proves the narrated point.
4. Keep unchanged entities in stable positions. Move an object only when movement carries meaning.
5. Introduce entities before animating their relationship. Do not animate an unnamed box into an unexplained network.
6. Give arrows a single consistent meaning such as flow, causation, transfer, or sequence. Label the meaning when it is not obvious.
7. Show branches, exceptions, loops, and failure paths only when narration names them or they are necessary to avoid a false model.
8. Hold each important state long enough to read and compare. If the narration advances before a state can be understood, split the section or simplify the diagram.

A state is useful only if the viewer can answer “what changed, why, and what resulted?” from the frame and narration together.

## Time from narration first

1. Obtain the matching voiceover or generated TTS and read its actual duration.
2. Split the section at spoken idea boundaries, not at equal time intervals.
3. Mark phrase anchors: entity introduction, action verb, quantity, contrast, and conclusion.
4. Place visual reveals at or just before the phrase they clarify. Do not reveal the conclusion before narration establishes it.
5. Let the explanatory change complete near the relevant spoken phrase, then preserve a readable hold.
6. Align the animation and narration to the same section start and cover the full narration range unless the plan intentionally changes shots.
7. If the actual audio is too short for the required states, tighten the diagram, split the section, or revise narration. Do not accelerate labels into unreadability.

Never submit final narration-backed MG from script length alone, and never generate it in parallel with the TTS that determines its duration.

## Control information density and labels

- Give each frame one primary claim or relationship.
- As a working ceiling, keep roughly three to five active labeled entities and one highlighted change at a time. Split dense systems into progressive states rather than shrinking everything.
- Use short noun labels, values, units, or compact action phrases. Do not place full spoken sentences on screen.
- Use the same term in narration, labels, captions, and legend. Do not alternate synonyms for a technical entity.
- Keep labels attached to their objects and persistent long enough to read. Avoid crossing leader lines and moving text.
- Use emphasis to identify the current subject; mute prior context without erasing information needed for comparison.
- Prefer direct labeling over a remote legend. Use a legend only when repeated encodings make it more economical.

## Keep data honest

- Preserve the user's claims and mark unsupported values or examples as illustrative.
- Show units, categories, time range, denominator, and baseline when they affect interpretation.
- Use consistent scales across comparisons. Area, length, position, and speed must not exaggerate differences.
- Do not animate fabricated precision, interpolate missing observations as measured data, or imply causation from correlation.
- Show uncertainty, ranges, omitted intervals, and non-zero baselines when material to the claim.
- When a visual simplification changes the model, state the simplification or choose a different visual.

## Use semantic transitions

- Preserve position, color role, and shape identity when the same entity continues into the next state.
- Morph only when the object remains the same thing; use a cut or explicit replacement when identity changes.
- Use zoom to change explanatory scale, not for spectacle. Keep an orientation cue when moving between overview and detail.
- Use a cut or section reset when the topic, time, or comparison basis changes.
- Start a transition after the current point lands and finish before the next point needs attention.
- Avoid decorative wipes between tightly linked mechanism states because they erase continuity.

## Build the representative section first

1. Choose the section with the highest semantic or sync risk, not the easiest section.
2. Resolve its actual narration timing, Animation Reference Gate, \`create-motion-graphics\` intake, and Design Style confirmation.
3. Create one complete section and place it against the matching narration.
4. Check state logic, label readability, data integrity, visual direction, and sync before batching related sections.
5. Reuse the validated visual grammar and timing behavior, not identical choreography, across the batch.

A pre-audio style proof is allowed only with explicit user approval. Label it style-only, keep it out of final timeline content, and do not treat it as the representative section.

## Narration-visual sync QA

Replay every narration-backed section from its timeline start and verify:

- every spoken proposition has a matching visual or intentionally narration-only beat;
- entities appear before their actions, and highlights follow the spoken subject;
- state changes land on the phrase they explain rather than early or late;
- animation duration covers the full narration range without a frozen accidental tail;
- labels remain readable and do not duplicate full narration;
- information density allows the viewer to follow one meaningful change at a time;
- transitions preserve continuity or clearly signal a reset;
- values, scales, units, and comparisons remain truthful;
- the final state holds long enough for the conclusion to register.

Record the timing source, narration duration, animation duration, match result, and fix for each failed section. Fix mismatches by simplifying or splitting states, adjusting timing, tightening narration, extending or regenerating visuals, or asking the user to choose the tradeoff before delivery.
`,ue='---\nname: export\ndescription: Use when a OpenChatCut video editing or creation workflow needs export, render, download, share, final delivery, subtitle-file export, render choice, local-only asset handling, or export fallback explanation.\n---\n\n# Export\n\nUse OpenChatCut\'s export tools for delivery. An export request should call `submit_export` (or `submit_render_job` for async), then use `track_export` for status and final delivery when the result is not returned immediately.\n\nDefault policy:\n\n- Prefer `submit_export` when the user asks to export/share/finalize the OpenChatCut timeline.\n- Keep originals local by default during editing. Upload originals only when a cloud export/proof needs remote assets and the user has not forbidden upload.\n- Do not wrap sandbox `ffmpeg` work as a OpenChatCut tool. Use sandbox `ffmpeg` for full video processing only when the user explicitly asks for a standalone local-file operation outside a OpenChatCut editing workflow. For OpenChatCut editing tasks, do not produce a pre-edited or flattened local render as the primary review/final deliverable; use OpenChatCut export.\n\n## Durable Export\n\nUse `submit_export` for the execution path:\n\n```json\n{\n  "format": "video",\n  "codec": "h264",\n  "resolution": "1080p",\n  "fps": 30,\n  "name": "final-cut"\n}\n```\n\nVideo codec options are `h264` (MP4, default) and `vp8` (WebM). Video frame-rate options match the editor UI: `24`, `25`, `30`, `50`, or `60`; omit `fps` to match the timeline. Audio export is MP3: pass `"format":"audio"` and omit `codec` / `fps` unless you explicitly pass `"codec":"mp3"`.\n\n`submit_export` returns a durable `renderId`. Some export types, such as subtitle files, may complete immediately and return `downloadUrl`; video/audio usually require `track_export` to wait for completion.\n\nAfter getting each `downloadUrl`:\n\n- Resolve the user\'s Downloads folder: `~/Downloads` on macOS/Linux, or `%USERPROFILE%\\Downloads` on Windows.\n- Before triggering any agent/browser download, check the Downloads folder for fresh Chrome download artifacts from the last few minutes that match the expected export name, extension, or render/download URL basename. Include both completed files and in-progress `.crdownload` files.\n- If a matching fresh `.crdownload` exists, do not trigger another download. Wait until Chrome removes the `.crdownload` suffix and the final file size stops changing, then use that completed file.\n- If a matching fresh completed file already exists, use it directly instead of downloading again.\n- If only older files exist, treat them as collisions, not as the current export.\n- Do not overwrite an existing file; choose a safe numbered filename such as `name (1).mp4` when needed.\n- Always download the finished export file into the Downloads folder, not a temp/workspace directory.\n- Always show the downloaded video inline in chat. If there are multiple exported videos, download all of them and show every preview, not just the first.\n\nIf the project contains local-only assets, upload/register cloud-readable replacements before rendering, or use the Local CLI Export path when the user wants to stay local.\n\nReport the returned `renderId` when present. The job is also visible in the editor\'s top-right export queue, including progress and cancellation. Use `saveToMediaPool:true` when the user asks to retain the result in My Media or when the active workflow explicitly defaults to automatic materialization, such as `livestream-to-clips`; otherwise the default remains a normal downloadable export. For long videos, call `track_export` once with `action:"wait"` and `timeoutSeconds:20`. If it returns `waitExpired:true`, report that the render continues in the background and end the turn. Check it later with `action:"status"`; repeated waits only hold the Agent turn open. Do not start another export for the same timeline while this render is active.\n\nUse `track_export` when the user asks about export/render status, or when the current turn genuinely needs to wait for a submitted video/audio render. Completed connector exports return `downloadUrl`; for every completed entry, download the file to Downloads using the collision-safe rules above and show it inline in chat:\n\n```json\n{\n  "action": "status",\n  "renderIds": "abc123"\n}\n```\n\nFor the latest project export, omit `renderIds` and pass `"latest": true`. `track_progress` is for generation/transcription/upload jobs, not render jobs.\n\nFor NLE XML, use `submit_export` with `format:"xml"`:\n\n```json\n{\n  "format": "xml",\n  "nleFormat": "fcp_xml_resolve",\n  "timelineId": "abc123"\n}\n```\n\n`nleFormat` values are `fcp_xml` for Premiere XML (default) and `fcp_xml_resolve` for DaVinci Resolve XML. Omit `timelineId` for the active timeline, or pass a timeline id/prefix for a non-active timeline. Read and report warnings: captions, solids, SVG, unsupported clip attributes, and unrendered motion graphics may be dropped by the XML format. Motion graphics are only represented in XML when a transparent-ProRes MG export flow supplies `motionGraphicRenderKeys`; otherwise the exporter reports them as dropped.\n\nFor media-pool source download, use `request_asset_download` on a file-backed source asset. It returns a guarded backend download URL/path for the original source media. Do not use `pull_asset` for user downloads; `pull_asset` is sandbox-only.\n\nFor subtitle files, use `submit_export` with `format:"subtitles"`:\n\n```json\n{\n  "format": "subtitles",\n  "subtitleFormat": "srt"\n}\n```\n\nFormats are `srt` and `txt`. The export uses the captions item\'s actual timeline word timing, source scope, translation variants, display-text overrides, and pacing fields such as `wordsPerPage` / `maxCharactersPerLine`, and creates a durable downloadable export job. It is appropriate for downloadable subtitle files. It does not yet reuse the browser Remotion caption page planner, so visual line wrapping/page breaks are timing-correct but approximate rather than byte-identical to burned-in caption pagination. For non-active timelines, pass `timelineId` from `manage_timelines` or `read_project`.\n\nFor one motion graphic as transparent ProRes 4444, use `export_motion_graphic_prores`:\n\n```json\n{\n  "itemId": "abc123",\n  "filenameMode": "asset"\n}\n```\n\nPrefer `itemId` when exporting a specific timeline instance, because the item carries live `propertyOverrides` such as edited text. Use `assetId` for a media-pool motion graphic; the backend will use the first timeline instance for that asset when present, matching the editor\'s media-pool export behavior. For several motion graphics, pass `itemIds` or `assetIds` in one call. Each motion graphic still becomes a separate durable render; use `track_export` with the returned `renderIds` to wait, then download through each returned render download path.\n\nWhen preparing XML that should reference rendered motion graphics, pass `"filenameMode":"xml"` and the same `timelineId` to `export_motion_graphic_prores`, then keep the returned `motionGraphicRenderKey` / `motionGraphicRenderKeys`; after the render completes, pass those keys and the same `timelineId` in `submit_export.motionGraphicRenderKeys` with `format:"xml"`.\n\n## Local Render (this build)\n\nAll rendering is local: `submit_export` / `submit_render_job` drive the local render service (headless Chrome over the same timeline state the editor shows), reading media straight from `/media/uploads/` on disk. There is no S3 requirement, no CLI, and no cloud job to wait on for disk-backed assets.\n\n- `submit_export`: subtitles/XML return synchronously; video/audio also render in-call in this build (long timelines can take a while — warn the user instead of polling).\n- `submit_render_job` + `track_export`: the async route — returns a `renderId` immediately, poll with `track_export` (`renderIds` / `latest` / `onlyActive`), then hand the user the returned download path.\n- Assets still on `blob:` placeholders (upload in flight) are not renderable yet — wait for `track_progress` target=upload to report ready before submitting.\n\n## Fallbacks\n\nIf a render fails because an asset\'s bytes are missing (placeholder never relinked, file deleted from disk):\n\n1. Ask the user to re-link the asset in 我的素材 (离线素材横幅) or re-import the file.\n2. For URL-sourced media, re-run `download_media` to restore bytes, then resubmit.\n\nDo not tell the user they need to understand HTML-in-Canvas, Remotion, or storage internals unless debugging. Explain at product level:\n\n- "本地快速导出"\n- "素材还在上传，稍等再导"\n- "需要先重新链接本地素材"\n\n## Result Trace\n\nFor `submit_export`, record:\n\n- `renderId`\n- timeline/range/resolution/codec/fps\n- that the user can download from the editor render-jobs panel\n\nRecord uploaded asset IDs and any fallback tried when cloud export was blocked by local-only assets.\n',de='---\nname: image-gen\ndescription: |\n  AI image generation via Fal.ai, gpt-image-2, nano-banana, MiniMax image-01, and xAI Grok Imagine. Use when the user wants to generate or create an image / picture / still.\nuser-invocable: true\n---\n\n# Image Gen\n\nGenerate AI images via `submit_image` (configured provider keys only). Prefer one clear still per request unless the user asked for variants.\n\n## Model Selection\n\n| Model | Reference | Strengths | Max refs |\n| --- | --- | --- | --- |\n| `fal` + `falModel` | [references/fal.md](references/fal.md) | Explicit Fal catalog; see tool schema for per-model limits | Model-specific |\n| `gpt-image-2` | [references/gpt-image-2.md](references/gpt-image-2.md) | Best text rendering, strongest prompt adherence | 16 |\n| `nano-banana` | [references/nano-banana.md](references/nano-banana.md) | Strongest reference-image fidelity | 14 |\n| `image-01` | [references/image-01.md](references/image-01.md) | MiniMax stills / live style; one subject reference via R2 | 1 |\n| `grok-imagine` | [references/grok-imagine.md](references/grok-imagine.md) | xAI Grok Imagine; text-to-image, ≤4 outputs, 1K/2K | 0 |\n\n- If Fal.ai is selected or requested, use `model: "fal"` and the requested `falModel` or saved Fal default from capabilities. Ask if none is selected. Native-provider defaults and controls below do not apply to Fal.\n- Default: `gpt-image-2` when that key is on.\n- Reference-heavy → `nano-banana`.\n- User named MiniMax / only MiniMax image key on → `image-01`.\n- Respect capabilities: do not call a model whose vendor is not configured.\n\n**IMPORTANT:** Before generating, READ the chosen model\'s reference.\n\n## Tool Params\n\n| Param               | Values                                                                  | Default |\n| ------------------- | ----------------------------------------------------------------------- | ------- |\n| `aspectRatio`       | `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, `2:3`, `4:5`, `5:4`, `21:9` | `16:9`  |\n| `imageSize`         | `512px`, `1K`, `2K`, `4K` (model-specific)                              | `1K`    |\n| `width` / `height`  | GPT Image: 512–3840, /16; MiniMax: 512–2048, /8                         | —       |\n| `quality`           | `low`, `medium`, `high`, `auto` (gpt-image-2 only)                      | `high`  |\n| `referenceAssetIds` | Array of project asset ids — backend resolves bytes server-side         | —       |\n| `name`              | Short descriptive asset name shown in the library                       | —       |\n| `count`             | Number of images to generate (1–10; image-01 max 9)                     | `1`     |\n| `promptOptimizer`   | MiniMax `image-01` only — `prompt_optimizer`                            | `false` |\n| `seed`              | MiniMax `image-01` only                                                  | —       |\n| `maskAssetId`, `background`, `moderation`, `inputFidelity` | GPT Image edit/output controls | — |\n| `outputFormat`, `outputCompression` | GPT Image PNG/JPEG/WebP controls                         | PNG     |\n\n## Defaults\n\n- Aspect ratio: **16:9**. If the project composition is not 16:9, ASK the user which aspect ratio they want before generating.\n- Size: **1K**.\n\n## Ask Before Submit\n\n- Never auto-upgrade size.\n- Only pass `imageSize: "2K"` or `"4K"` when the user explicitly asks. Warn that 2K/4K are EXPERIMENTAL and may be slower.\n\n## Reference Images\n\nUse when the user provides source material to edit, blend, or use as visual guidance (e.g. "change the background", "combine these into a poster").\n\n- Pass project asset ids via `referenceAssetIds`. The backend fetches and encodes them server-side — never pull the asset bytes yourself.\n- When the user @-references an image asset, pass its id directly in `referenceAssetIds`.\n- Formats accepted by backend: png, jpeg, webp, svg (auto-rasterized to png), heic, heif. Each ≤ 50MB.\n\n## Run\n\n```ts\n// Basic generation\nsubmit_image({\n  model: "gpt-image-2",\n  prompt: "a cute orange cat",\n  name: "Cat",\n});\n\n// With quality (gpt-image-2 only)\nsubmit_image({\n  model: "gpt-image-2",\n  prompt: "hero poster with bold title",\n  quality: "high",\n  name: "Hero Poster",\n});\n\n// With reference images — pass project asset ids; backend resolves bytes\nsubmit_image({\n  model: "gpt-image-2",\n  prompt: "change background to beach",\n  referenceAssetIds: ["<assetId>"],\n  name: "Beach Edit",\n});\n\n// Reference-heavy with nano-banana\nsubmit_image({\n  model: "nano-banana",\n  prompt: "composite poster",\n  referenceAssetIds: ["<id1>", "<id2>"],\n  name: "Composite",\n});\n\n// Multiple images\nsubmit_image({\n  model: "gpt-image-2",\n  prompt: "product shots",\n  count: 3,\n  name: "Product",\n});\n\n// MiniMax (optional single subject reference; R2 must be configured for refs)\nsubmit_image({\n  model: "image-01",\n  prompt: "matte product bottle on marble, soft studio light",\n  name: "Bottle still",\n  promptOptimizer: false,\n});\n```\n\nOpenChatCut’s `submit_image` may return completed pool assets synchronously depending on the provider path. If a `jobId` is returned, use `track_progress`; otherwise treat the asset ids in the result as done.\n\n## Rules\n\n- Always provide `name` with a short descriptive asset name.\n- Before submitting, briefly tell the user what you\'re about to generate — especially when generating multiple images.\n- Only call models whose vendor key is configured (capabilities prompt).\n',fe=`# Fal.ai

Use \`model: "fal"\` with a \`falModel\` ID from the tool schema. A configured
Fal key enables the catalog, not the native-provider routes. Use the saved
Fal model default unless the user explicitly selects another model. If neither
exists, ask before submitting; never silently substitute a different model.

Read the per-model limits in the \`falModel\` tool description. Omit output options
to use that model's defaults. Do not send native-provider-only controls such as
masks, seeds, priority, camera locks, or multi-shot prompts. Unsupported options
fail locally before submission. Reference inputs must be project asset IDs.

Generate only after the user explicitly requests it. Generation costs Fal credits.
For videos, use \`track_progress\` with the returned job ID; resuming a stored job
polls/downloads the same request rather than submitting another generation.
After an interrupted image request, check Fal request history before retrying.
`,pe=`# gpt-image-2 (OpenAI)

Read this document before generating images with \`--model gpt-image-2\`.

## Capabilities

- Best text rendering among all image models — legible headlines, labels, packaging, UI mockups
- Strongest prompt adherence — follows complex layout and composition instructions precisely
- Max 16 reference images
- Supports \`--quality\` param: \`auto | low | medium | high\` (default: \`high\`)

## Params

| Param       | Values                          | Default | Notes                               |
| ----------- | ------------------------------- | ------- | ----------------------------------- |
| \`--quality\` | \`auto\`, \`low\`, \`medium\`, \`high\` | \`high\`  | Only model with quality control     |
| \`--size\`    | \`1K\`, \`2K\`, \`4K\`                | \`1K\`    | 2K/4K are EXPERIMENTAL, slower/heavier |
| \`--aspect\`  | 10 ratios (see SKILL.md)        | \`16:9\`  | Computed to exact pixel dimensions  |
| \`--input\`   | file path or \`asset://<id>\`     | —       | Up to 16 references                 |

## When to Use

- Text-heavy images: titles, logos, infographics, UI screenshots
- Prompt-sensitive layouts: precise positioning, composition, or style adherence
- Product mockups, packaging, or any design with readable text
- When fidelity to the prompt matters more than matching reference images

## When NOT to Use

- When reference-image fidelity is critical (use \`nano-banana\` instead)
- When the reference set is larger than the current task needs; prefer fewer, clearer anchors
- When speed matters and quality is secondary (nano-banana is faster for simple prompts)

## Prompt Tips

- Be specific about text content: quote exact strings to render (e.g., \`"a poster with the headline 'Summer Sale 2026'"\`)
- Describe spatial layout explicitly: "centered title at the top, product image below, price tag in the bottom-right corner"
- For multi-element compositions, describe each element's position relative to others
- Include style descriptors: "flat design", "photorealistic", "watercolor", "3D render"
- Specify background explicitly when it matters: "on a pure white background", "against a gradient from blue to purple"
- For text-on-image edits with \`--input\`, describe what to change and what to keep: "replace the text on the sign with 'Hello World', keep everything else the same"
`,me="# xAI Grok Imagine — Image (`grok-imagine`)\n\nText-to-image via the xAI Grok Imagine family. Auth: the imported xAI\nsubscription session (SuperGrok / X Premium+) takes priority; otherwise the\n`LLM_XAI_API_KEY` key. Configured model id comes from Settings\n(`XAI_IMAGE_MODEL`), default `grok-imagine-image-2.0`.\n\n## Wired capabilities\n\n- **Text-to-image only.** No reference images, no mask/edit controls in this\n  integration — do not send `referenceAssetIds` / `maskAssetId` /\n  `background` / `moderation` / `inputFidelity` / `outputFormat` /\n  `outputCompression` / `seed` / `promptOptimizer` for this model.\n- **Count**: 1–4 per call (`n`).\n- **Aspect ratio** (`aspectRatio`): `1:1`, `16:9`, `9:16`, `4:3`, `3:4`,\n  `3:2`, `2:3`. No `width`/`height`; do not send `imageSize` values other\n  than `1K` (→ `1k`) or `2K` (→ `2k`). `512px` and `4K` are rejected.\n- `quality` is ignored for this model.\n\n## Prompt guidance\n\nSingle clear subject per request; the official docs recommend detailed scene\nlanguage (subject, action, environment, lighting, style). Outputs are\nreturned as temporary provider URLs; the app downloads them into the media\npool immediately.\n\n## Errors\n\n- 401/403 with a subscription session: the tier may not open the media API —\n  suggest the API-key path or upgrading the subscription.\n- `grok-imagine does not support aspect ratio …` / `imageSize must be 1K or 2K`:\n  fix the args, do not retry unchanged.\n",he=`# MiniMax \`image-01\`

Read this before generating with \`submit_image({ model: "image-01", … })\`.

Grounded in OpenChatCut’s image adapter (\`server/plugins/image.ts\` → MiniMax). Only promise what our tool exposes.

## Capabilities (as wired)

| Dimension | Value |
| --- | --- |
| Model arg | \`image-01\` |
| Prompt | Required, **≤ 1500 characters** |
| Reference images | **0–1 subject image** via \`subject_reference\`; requires configured R2 temporary HTTPS URL |
| Count | **1–9** per call (default 1) |
| Aspect ratio | \`1:1\`, \`16:9\`, \`4:3\`, \`3:2\`, \`2:3\`, \`3:4\`, \`9:16\`, \`21:9\` |
| Custom dimensions | \`width\` + \`height\`, each 512–2048 and divisible by 8; omit aspect ratio |
| \`imageSize\` / \`quality\` | Not sent on this path |
| \`seed\` | Optional safe integer |
| \`promptOptimizer\` | Official default **false**; sent only when explicitly supplied |
| Server MiniMax model | From Settings \`MINIMAX_IMAGE_MODEL\` (\`image-01\` / \`image-01-live\`) |

## When to use

- MiniMax is configured and the user wants a still or a single subject-reference generation.
- User explicitly asked for MiniMax image generation.
- Only MiniMax image key is on (capabilities).

## When not to use

- Need multiple reference images → \`nano-banana\` or \`gpt-image-2\`
- Need best-in-class text-in-image → prefer \`gpt-image-2\`
- MiniMax key missing → say so; do not invent the model

## Tool shape

\`\`\`ts
submit_image({
  model: "image-01",
  prompt: "…",                 // ≤1500 chars
  name: "Descriptive still",
  aspectRatio: "16:9",
  count: 1,                    // max 9
  seed: 42,
});

// Literal brand packshot (less auto-rewrite)
submit_image({
  model: "image-01",
  prompt: "Exact product bottle, white seamless, label text as written",
  name: "Bottle literal",
  promptOptimizer: false,
});
\`\`\`

Pass at most one image in \`referenceAssetIds\`; R2 must be configured so MiniMax can fetch a temporary signed URL.

## Prompt tips

- Clear subject + style + lighting; avoid packing multi-scene storyboards into one still.
- Quote exact text if any lettering must appear (quality varies; gpt-image-2 is stronger for text).
- Keep the prompt under 1500 characters; split variants into separate calls if needed.
`,s=`# nano-banana (Gemini Pro)

Read this document before generating images with \`--model nano-banana\`.

## Model

| Model         | Max refs | Strengths                     |
| ------------- | -------- | ----------------------------- |
| \`nano-banana\` | 14       | Best reference-image fidelity |

## Params

Nano Banana does NOT support \`--quality\`. Only shared params apply:

| Param      | Values                      | Default | Notes                               |
| ---------- | --------------------------- | ------- | ----------------------------------- |
| \`--size\`   | \`1K\`, \`2K\`, \`4K\`            | \`1K\`    | 2K/4K are EXPERIMENTAL, higher cost |
| \`--aspect\` | 10 ratios (see SKILL.md)    | \`16:9\`  | —                                   |
| \`--input\`  | file path or \`asset://<id>\` | —       | Up to 14 references                 |

## When to Use

- Reference-heavy tasks: "make an image in the style of these examples"
- When the user provides >10 reference images (gpt-image-2's limit)
- Style transfer, character consistency across multiple images
- Compositing multiple source images into one scene

## Prompt Tips

- With reference images: describe the relationship between references and desired output — "combine the style of the first image with the subject of the second"
- Reference images drive the output strongly — keep the text prompt focused on what to change, not what to copy
- For style transfer: "in the style of the reference image" works well
- For composition: describe the scene structure; Gemini follows spatial descriptions but less literally than gpt-image-2
- Gemini handles natural-language descriptions well — conversational prompts can work better than keyword-style prompts
`,c='---\nname: known-errors\ndescription: Use when a OpenChatCut tool call fails or returns an unexpected shape.\n---\n\n# Known Errors\n\n`edit_item` update raw shape:\n\n- Wrong: `{ "id": "abc", "fromFrame": 30 }`\n- Right: `{ "json": "{\\"updates\\":[{\\"id\\":\\"abc\\",\\"fromFrame\\":30}]}" }`\n- Use this same `updates` shape for common moves, trims, and track changes.\n\n`edit_item` add raw shape:\n\n- The new item goes inside the `adds` array of the `json` transaction: `{ "json": "{\\"adds\\":[{...}]}" }`.\n- Use `edit_item` for simple video placement, for example `{ "json": "{\\"adds\\":[{\\"type\\":\\"video\\",\\"assetId\\":\\"...\\",\\"fromFrame\\":0}]}" }`.\n\nTimeline overlap:\n\n- Error text: `Overlap: updated item at ... would overlap existing item at ... on this track.`\n- Do not force the write or delete the conflicting item silently.\n- Retry the `edit_item` transaction with an explicit available `trackId`, for example an update containing `"trackId":"V2"`, or ask the user which layer should win.\n\nWorkspace path restrictions:\n\n- `push_asset` on the external MCP only accepts public http(s) URLs as `filePath`. It rejects local paths, workspace paths, and chat attachment paths.\n- For motion-graphic assets, pass the JSX source via `create_motion_graphic_from_code({ code:"...", name, width, height, durationInFrames })`. `push_asset` no longer accepts an inline `code` argument.\n- Copying local media into the workspace is not the fix for video/audio/image/GIF imports; use `asset-import` and `import_media` instead.\n- Use `import_media action=create_session`, then run the OpenChatCut media import helper once with the returned token for client-held files.\n\nBrowser video conversion failure:\n\n- Error text often includes `Unable to convert video without dropping audio/video tracks` or `unknown_source_codec`.\n- Rerun the OpenChatCut media import helper; it owns frontend-aligned conversion and will surface a user-actionable error if conversion is impossible.\n- Do not ask the user to re-import the same file through the editor UI as a workaround — the conversion path is the same, the error will repeat. Fix the source (re-encode locally with `ffmpeg`) or pick a different file.\n- After the replacement asset is uploaded/transcribed, delete the failed original asset if it is unused. The clean final media pool should look like a successful import, not a failed import plus a replacement.\n\nMotion Graphic requirements:\n\n- `push_asset(type:"motion-graphic")` requires `width`, `height`, and `duration` or `durationInFrames`.\n- MG code must pass the OpenChatCut validator.\n- Root `AbsoluteFill` is not valid for generated MG code; use a scaling root `div`.\n- Avoid declaring a top-level local named `scale` inside MG code. The validator/runtime may already reserve that identifier; use a specific name such as `uiScale`.\n\nLocal dev Zero caveat:\n\n- When backend runs on a non-default port, use a matching Zero view-syncer configuration.\n- In this POC, backend `3010`, editor `5177`, and view-syncer `4850` are intentionally isolated from the older `3000/5173/4848` stack.\n\nTimeline frame renderer caveat:\n\n- If `view_timeline_frames` fails for one frame, the project write path can still be healthy — retry with fewer frames or a different time before concluding anything.\n- Assets still on `blob:` placeholders (upload in flight) render as empty; wait for `track_progress` target=upload before treating a blank frame as a bug.\n- Do not report visual proof success unless the tool returns image content that visibly confirms the target frame.\n',l=`---
name: livestream-to-clips
description: Cut an imported livestream recording of any genre into evidence-backed, platform-ready clips by combining transcript, visual, audio, interaction, and domain-specific signals. Use for commerce, gaming, talk, interview, education, entertainment, sports, music, IRL, creative, news, or mixed livestream recordings.
---

# Livestream to Clips

Use this workflow when the source is an imported livestream recording and the user wants clips, highlights, cutdowns, reels, or multiple publishable timelines. A livestream may change genre during one recording, so classify each section rather than assigning one label to the whole source.

This workflow is OpenChatCut-native. Use project media, transcript, representative source frames, timeline tools, captions, and export tools already available in the editor. Treat audience chat, reactions, score data, product records, or stream markers as optional evidence when the project contains them.

## Required References

Load only the files needed for the current step:

- Read [references/profile-matrix.md](references/profile-matrix.md) before classifying sections or applying genre rules.
- Read [references/multimodal-selection.md](references/multimodal-selection.md) before comparing candidates or processing a long recording.
- Read [references/qa-and-evaluation.md](references/qa-and-evaluation.md) before final verification or benchmark reporting.

## Workflow

### 1. Establish the editing contract

Read the project before editing. Identify the dominant livestream asset, duration, aspect ratio, language, speakers, transcript readiness, audio tracks, existing visual descriptions, and current timeline.

Determine only constraints that change the result: target platform, objective, clip count, duration range, aspect ratio, captions, packaging style, and whether the user wants contiguous source clips or an editorial remix. If the user asked for direct creation and supplied enough context, proceed without another approval step.

### 2. Build a stream map before selecting clips

For a long source, inspect it hierarchically instead of sending the entire transcript or dense frame sequence through one decision pass:

1. Read the transcript in bounded ranges and produce a coarse stream map.
2. Split on topic, activity, speaker, product, round, scene, performance, or format changes.
3. Assign a profile and confidence to each section. Use \`mixed\` when adjacent profiles overlap.
4. Record important entities and state: people, products, teams, scores, locations, tasks, claims, prices, and outcomes.
5. Preserve source timestamps so every later decision remains traceable.

Do not rank clips yet. First make sure the map covers the beginning, middle, and end of the recording and does not overrepresent transcript-rich sections while ignoring visual or musical events.

### 3. Discover events with all available evidence

Generate event candidates from independent signals:

- **Speech:** question, answer, claim, story, instruction, joke, conflict, reveal, offer, call to action, or conclusion.
- **Visual:** action, product demonstration, score change, reveal, scene novelty, facial reaction, screen result, or completed work.
- **Audio:** laughter, cheering, shout, impact, game cue, musical build/drop, silence contrast, or emotion change.
- **Interaction:** chat/message burst, repeated emote or phrase, donation, poll, viewer request, or streamer response.
- **Metadata:** chapters, markers, score/telemetry, product identifiers, or known agenda items.

Interaction and metadata are supporting signals, not mandatory inputs. Never invent absent chat, telemetry, product, or score evidence.

Treat music intelligence as an enhancement: call \`analyze_music\` with \`optional: true\`. If it reports \`available: false\`, continue with \`detect_beats\`, waveform/audio cues, and visual timing rather than blocking the clip.

### 4. Turn each event into a complete candidate arc

Expand the event to the smallest source range that preserves its meaning and payoff. Use the profile-specific arc from \`profile-matrix.md\`. Common shapes include:

- setup → trigger → peak → reaction → outcome;
- question → answer → evidence/example → conclusion;
- product → need → demonstration/proof → offer/CTA;
- goal → explanation/steps → visible result;
- musical phrase/build → chorus/drop → resolution.

Resolve boundaries on clean word, phrase, action, shot, beat, or state-transition points. Include pre-roll when the event is confusing without setup and post-roll when the reaction or result carries the value.

### 5. Create an evidence ledger

Before heavy editing, record a compact candidate ledger. For every candidate include:

\`\`\`json
{
  "sourceRange": [0, 0],
  "profile": "talk",
  "profileConfidence": 0,
  "event": "",
  "arc": { "setup": [], "peak": [], "payoff": [] },
  "evidence": { "speech": [], "visual": [], "audio": [], "interaction": [], "metadata": [] },
  "missingEvidence": [],
  "openingHook": "",
  "standaloneReason": "",
  "riskFlags": [],
  "targetDuration": 0,
  "packaging": ""
}
\`\`\`

Inspect representative source frames for serious candidates. Use one \`view_asset_frames\` call per candidate range with at most six samples covering the opening, peak, payoff, and one meaningful visual transition. Reuse that contact sheet; repeat only after extraction failure or a changed source range. A transcript-only candidate is provisional until visual evidence confirms that the range is usable, unless the source is intentionally audio-first.

### 6. Reject, score, and diversify

Apply hard rejection gates before ranking. Reject or flag candidates with changed meaning, missing payoff, mismatched product/score/person, unresolved factual numbers, severe black/frozen/obscured frames, broken audio, unsafe disclosure, or boundaries that cut essential context.

Score the remaining candidates using the profile weights in \`multimodal-selection.md\`. Missing optional evidence is marked \`unavailable\`; it is not scored as failure. Select a diverse set across topics, products, rounds, speakers, event shapes, and visual treatments. Avoid near-duplicate excerpts even when all score highly.

When the source is long, the style is unsettled, or many outputs are requested, create and verify the highest-ranked clip first. Use the proven treatment as the batch reference, then continue with the remaining candidates.

### 7. Edit for the selected profile

Create every approved output as its own named Sequence. Batch-create them with one \`manage_timelines\` call using \`action:"create"\` and \`timelines:[...]\`, then switch to each returned timeline and add the selected range from the original asset with \`sourceStartFrame\` and \`sourceDurationInFrames\`. Reuse the original \`sourceAssetId\`; do not copy the long recording. Keep edits reversible and source-linked.

- Tighten filler, false starts, repeated attempts, and dead time only when speech remains natural and intent is preserved.
- Hide necessary jump cuts with an appropriate reaction shot, source cutaway, crop change, or subtle scale change when the evidence supports it.
- Reframe around the viewer's task: face, product, gameplay/UI, demonstration, instrument, slide, or result.
- For landscape-to-vertical edits, split at shot or layout changes and choose the crop per segment. A speaker close-up may use a centered cover crop while a slide, product table, score board, or game UI may need a wider treatment.
- If automatic subject tracking is unavailable, inspect source frames and use deliberate static transforms. Do not leave large empty bars or apply one global crop that hides essential text, products, scores, controls, or demonstrations.
- Add captions, title text, product cards, score labels, supporting media, music, or motion graphics only when they clarify the selected event.
- Preserve exact names, numbers, prices, scores, dates, units, and claims from verified source evidence.
- For music and dance, align cuts to musical phrases or beat structure rather than fixed intervals.

### 8. Verify the composed result

Use one \`view_timeline_frames\` call on the composed timeline with at most four samples. Cover the opening, the main event or claim, the ending, and any highest-risk overlay or crop change. Verify audio boundaries, subtitle timing, subject visibility, factual consistency, duration, aspect ratio, and export readiness using \`qa-and-evaluation.md\`.

If an optional enhancement such as subject tracking or automatic caption avoidance fails, preserve the verified cut and continue with a frame-checked static layout. Report the omitted enhancement instead of blocking the deliverable.

After review, automatically materialize every approved Sequence into My Media. Switch to each approved Sequence, call \`submit_render_job\` with \`saveToMediaPool:true\` and a filename derived from the Sequence name, then continue queuing the remaining clips without waiting for each render serially. These are background jobs shown in the editor's top-right export queue; the user does not need to run a separate export step. Skip this automatic materialization only when the user explicitly asks for draft Sequences only.

The saved asset records the source Sequence, render job, original source asset IDs, and source ranges; the editable Sequence remains the master. Use \`track_export\` once after all jobs are queued to report current progress. Do not start duplicate renders for a Sequence that already has an active job.

Report the selected source ranges, profile, main evidence, applied edits, known uncertainty, and verification performed. Do not report a finished clip from tool success alone.

## Output Modes

- **Contiguous highlight:** one continuous source range with cleanup and packaging. Prefer this for authenticity, sports events, music, demonstrations, and sensitive claims.
- **Extractive cutdown:** several source ranges assembled without rewriting the speaker's meaning. Use visible or motivated transitions where continuity changes.
- **Editorial remix:** a new narrative assembled from multiple moments. Use only when the user requests a promotional, recap, montage, or story treatment.

## Rules

- Preserve speaker intent, causality, chronology where material, and the relationship between setup and payoff.
- Treat transcript, OCR, chat, and model descriptions as fallible evidence; resolve important numbers or identities against the source.
- Prefer multi-signal agreement, but retain strong single-modality events such as a silent visual reveal or an instrumental musical peak.
- Adapt detail and pacing to stream pace. Fast events usually need compact context; slow demonstrations and teaching often need more setup.
- Keep candidate decisions explainable through source timestamps and evidence.
- Do not pad the requested count with weak, repetitive, or misleading clips.
`,u=`# Multimodal Livestream Candidate Selection

Use this reference to turn a long, heterogeneous stream into evidence-backed clip candidates without overwhelming model context or favoring one modality.

## 1. Hierarchical Scan

Use three passes:

1. **Overview pass:** read bounded transcript ranges and sparse visual/audio summaries to map sections, entities, activities, and profile changes.
2. **Candidate pass:** apply explicit objective and profile rules inside each section; generate source-aligned event ranges with evidence.
3. **Verification pass:** inspect dense evidence only around top candidates, resolve boundaries, reject defects, and rank globally.

This balances two long-context failures: windows that are too large lose middle content and structured precision, while windows that are too small lose topic and causal context. Keep overview notes compact and retain timestamps into every later pass.

## 2. Evidence Channels

### Speech and transcript

Use word timestamps, speaker turns, topic changes, questions, claims, examples, jokes, instructions, offers, corrections, and conclusions. Measure transcript confidence around names, numbers, prices, scores, dates, units, and proper nouns.

### Visual

Use scene changes, subject visibility, face expression, action, product/object state, UI/scoreboard, slide or screen text, before/after differences, camera quality, and crop feasibility. Sample opening, event peak, payoff, and transitions rather than treating one thumbnail as proof for the whole range.

### Audio

Use speech clarity, overlap, energy change, laughter, applause, crowd reaction, game cues, impacts, silence contrast, music structure, and clipping/noise defects. Audio peaks are candidate signals; verify that they correspond to meaningful source events.

### Interaction and metadata

Use synchronized chat, emotes, reactions, donations, polls, markers, scores, telemetry, products, or agenda data when present. Align them by timestamp and record provenance. Treat them as unavailable when absent.

## 3. Candidate Record

Each candidate must retain:

- source and transcript ranges;
- section profile and objective;
- event arc and opening hook;
- evidence per available modality;
- missing modalities and unresolved facts;
- boundary rationale;
- proposed packaging;
- rejection flags and confidence.

Do not convert missing chat or telemetry into a low engagement score. Reweight across the evidence that actually exists.

## 4. Hard Gates Before Ranking

Reject or require review when any of these apply:

- the excerpt changes speaker intent, causality, chronology, or factual meaning;
- setup, triggering action, critical step, or payoff is missing;
- identity, product, price, score, date, unit, or source attribution is unresolved;
- source frames contain severe black/frozen/obscured content across an essential moment;
- audio is missing, unintelligible, badly clipped, or cut mid-utterance at an essential point;
- crop hides the subject, product, instrument, demonstration, UI, scoreboard, slide, or result;
- the excerpt exposes private data or sensitive context that should not be amplified;
- it substantially duplicates a stronger selected candidate.

## 5. Reproducible Scoring

Score each dimension from 0 to 5 and record one sentence of evidence:

| Dimension | Question |
|---|---|
| Standalone clarity | Can a new viewer understand the moment without omitted context? |
| Hook | Does the opening create immediate interest without a misleading title? |
| Payoff | Does the event deliver a result, insight, reaction, reveal, or resolution? |
| Profile value | Does it satisfy the active profile's event arc and signals? |
| Objective fit | Does it serve reach, conversion, education, community, recap, or teaser intent? |
| Visual usability | Are the essential subject and action visible and crop-safe? |
| Audio usability | Is speech/music/action intelligible and clean at the boundaries? |
| Evidence confidence | Do multiple available signals agree, and are important facts verified? |
| Editability | Can it be tightened and packaged without unnatural discontinuity? |
| Novelty | Does it add something distinct to the selected set? |

Start with equal weights, then apply these small profile adjustments rather than inventing a separate scoring system:

- Commerce: +2 profile value, +1 evidence confidence.
- Gaming/sports: +2 payoff, +1 audio usability, +1 visual usability.
- Talk/interview/news: +2 standalone clarity, +1 evidence confidence.
- Education/tutorial: +2 standalone clarity, +2 payoff, where payoff means usable understanding or visible result.
- Music/dance: +2 audio usability, +2 visual usability, +1 editability.
- Entertainment/IRL/creative: +1 hook, +1 payoff, +1 visual usability.

Scores compare candidates; hard gates protect truth and quality. A high total never overrides a failed gate.

## 6. Boundary Resolution

Start with the event peak and expand outward:

1. Expand backward to the nearest sufficient setup, question, game state, product identity, task goal, or musical phrase boundary.
2. Expand forward through the result, reaction, proof, conclusion, landing, or musical resolution.
3. Snap speech to clean word/phrase boundaries and action to clean visual state changes.
4. Add short handles when the edit needs an audio fade, reaction cover, or crop transition.
5. Preview the exact range; revise if the hook starts slowly or the ending feels truncated.

## 7. Global Selection

Rank after gates, then enforce diversity across profile, topic, product, speaker, round, event shape, visual treatment, and source time. For overlapping candidates, keep the one with the clearer arc or intentionally create duration variants. Do not fill a quota with weak clips.

## 8. Research Basis

- RankCut uses overview, explicit selection rules, and small-window ranking to mitigate long-context and transparency failures: https://doi.org/10.1145/3742413.3789115
- CatchLive supports overall structure and multiple levels of detail, with stream pace affecting the preferred summary density: https://doi.org/10.1145/3491102.3517461
- Game-stream research shows multi-view agreement is stronger than isolated novelty spikes: https://arxiv.org/abs/1807.09715
- SoccerNet-Echoes studies audio commentary aligned with sports events, supporting audio as event evidence rather than mere quality metadata: https://arxiv.org/abs/2405.07354
- Music-synchronized editing research reports stronger audio-visual harmony from beat-aware analysis and a reviewer loop than fixed segmentation: https://arxiv.org/abs/2603.29664
- Instructional evaluation should measure accessible learning or usable understanding, not only visual salience or summary coverage: https://arxiv.org/abs/2606.28531
`,d=`# Livestream Profile Matrix

Classify the recording by section. Profiles set selection and packaging priorities; they do not override source evidence. When the section does not fit cleanly, use \`mixed\` with the two strongest profiles and explain the overlap.

| Profile | Preferred event arc | Strong signals | Boundary and packaging priorities | Reject or flag |
|---|---|---|---|---|
| Commerce | product/need → demonstration or proof → offer → CTA | product visibility, product/price words, demonstration, questions, buyer reaction | preserve exact product identity and verified numbers; show the product when it is discussed | product/price mismatch, expired or uncertain offer, unsupported claim |
| Gaming | game state → event → streamer reaction → outcome | game UI change, impact cue, facecam expression, speech excitement, chat spike | include enough pre-event game state; keep UI and reaction visible after reframing | reaction without the triggering event, hidden score/UI, duplicated round |
| Esports/sports | buildup → decisive play → result → replay/reaction | scoreboard, commentary energy, crowd sound, replay transition, win-probability change | preserve rules context and result; use contiguous action when possible | wrong score/player/team, result without buildup, replay mistaken for live action |
| Talk/just chatting | setup or question → story/claim → turn or payoff | transcript semantics, tone change, laughter, audience response | optimize standalone clarity and speaker intent | quote requires omitted context, sarcasm or irony reversed |
| Interview/podcast | question → answer → evidence/example → conclusion | speaker turns, thesis, personal story, disagreement, concise takeaway | retain the question when the answer depends on it; use reaction shots to cover jumps | speaker attribution error, stitched answer changes meaning |
| Education/tutorial | goal → explanation/steps → demonstration → result | transcript structure, screen/slide changes, cursor/action, before/after state | retain prerequisites, key steps, labels, and readable screen content | correct conclusion with missing method, illegible screen, unsafe omitted step |
| Entertainment/variety | setup → escalation → punchline/reveal → group reaction | laughter, facial reaction, repeated audience response, surprise, visual reveal | keep comedic timing and reaction tail | punchline without setup, private or humiliating context |
| Music | phrase/build → chorus/drop/solo → resolution | beat/tempo, harmonic repetition, energy, performer motion, applause | cut on phrase/beat boundaries; preserve performance continuity | mid-beat start/end, audio discontinuity, unrelated camera cut |
| Dance/performance | setup → movement phrase → signature move → resolution | beat, full-body motion, pose, crowd reaction | keep complete movement phrases and subject framing | crop removes body/prop, pose or landing truncated |
| IRL/travel/lifestyle | place/task setup → discovery/action → result/reaction | scene novelty, movement, environmental sound, location or object mention | preserve spatial continuity and protect private information | exposed address/identity, unsafe or misleading location context |
| Food/cooking | ingredient/goal → key technique → transformation → result/taste | close-up, step language, texture change, timer/temperature, reaction | keep critical steps and finished result | wrong ingredient/unit, omitted safety-critical step, result from another batch |
| Creative/making | intent → process milestone → breakthrough → reveal | canvas/code/object change, tool action, before/after, creator reaction | compress repetition while retaining causal milestones | result disconnected from process, screen or work area unreadable |
| News/commentary | event/claim → evidence/source → analysis → conclusion | names, dates, source references, graphics, quoted material | retain attribution and separate fact from opinion | altered claim, uncertain identity/date, sensational title unsupported by source |
| Call-in/emotional | issue → exchange → emotional turn → response or resolution | speaker turns, silence, prosody, explicit consent/context | favor contiguous excerpts and conservative packaging | private data, vulnerable disclosure, decontextualized accusation |
| Mixed | profile transition → local event arc → next state | scene/topic/activity changes across all modalities | split at real format changes and apply local profile weights | one global style obscures a meaningful profile change |

## Profile Classification Procedure

1. Start from observable activity, not the video's title or filename.
2. Classify bounded sections after building the stream map.
3. Record the strongest and second-strongest profile plus confidence.
4. Reclassify when the activity changes, such as gameplay → chatting → sponsor read.
5. Use \`mixed\` only when both profiles actively shape the same candidate.

## Objective Is Separate from Profile

The same event can serve different objectives:

- **Reach:** immediate hook, novelty, emotion, and standalone clarity.
- **Conversion:** verified product/offer, demonstration, trust, and CTA.
- **Education:** retained prerequisites, explanation quality, and visible result.
- **Community:** audience interaction, streamer personality, and shared context.
- **Recap:** coverage, chronology, diversity, and major outcomes.
- **Teaser:** curiosity and tension without falsely hiding the actual payoff.

Apply objective weights after profile classification. Do not infer “most exciting” as the universal objective.

## Optional Interaction Evidence

If synchronized interaction data exists, derive only bounded features such as message rate, unique participants, repeated terms/emotes, sentiment shift, questions, donations, or poll changes. Channel-specific slang and emotes require local context. A burst indicates attention, not automatically positive quality; inspect the associated source event before ranking it.

## Research Basis

- CatchLive found that game, cooking, and talk streams need different summarization detail and that representative frames, transcript, and interaction data help viewers recover context: https://dl.acm.org/doi/10.1145/3491102.3517461
- Audience chat reactions improved esports highlight prediction when combined with visual evidence: https://arxiv.org/abs/1707.08559
- Multi-view game research found that streamer face and audio novelty can be as important as game footage: https://arxiv.org/abs/1807.09715
- PodReels showed that podcast teaser creation benefits from transcript selection, speaker context, preview, and reaction-shot treatment: https://arxiv.org/abs/2311.05867
- LiveRetro aligns ecommerce performance with viewer, merchandise, feature, and segment feedback rather than treating a stream as one homogeneous session: https://doi.org/10.1109/TVCG.2023.3326911
`,f=`# Livestream Clip QA and Evaluation

Tool success proves that an edit operation ran. Completion requires evidence that the composed clip is truthful, coherent, technically sound, and appropriate for its profile and objective.

## Per-Clip QA

### Source and meaning

- Source timestamps and asset identity are traceable.
- Speaker, person, product, team, score, date, price, unit, and claim match the source.
- The clip preserves setup, causality, intent, and payoff.
- A title, subtitle, crop, or inserted visual does not change the source meaning.

### Visual

- Inspect composed frames at opening, event/claim, payoff, ending, and every major crop or overlay change.
- Essential face, action, product, gameplay UI, scoreboard, instrument, slide, code, or result remains visible.
- No essential black, frozen, duplicate, corrupted, or severely blurred frames.
- Captions and graphics remain readable and do not cover the viewer's primary task.
- Reframing remains stable; cuts and scale changes are motivated rather than repetitive decoration.

### Audio

- Opening and ending do not clip words, breaths, beats, attacks, landings, laughter, or reactions.
- Speech is intelligible; music and effects do not mask it.
- Jump cuts do not introduce clicks, abrupt ambience changes, or impossible conversational timing.
- Music/performance clips preserve phrase and beat continuity.

### Text and captions

- Captions are synchronized and preserve proper nouns, numbers, prices, scores, dates, and units.
- Filler removal still sounds human and does not erase emphasis or emotional timing.
- OCR-derived text used in the edit has been confirmed against source frames when material.

### Profile and platform

- The active profile's event arc is complete.
- The objective is visible in the result: reach, conversion, education, community, recap, or teaser.
- Duration, aspect ratio, safe composition, timeline name, and requested output count are correct.
- Sensitive or regulated material carries the appropriate review flag.

### Export readiness

- No unintended gaps, overlaps, missing media, offline links, or unsupported effects.
- Preview and export use the same intended composition.
- When delivery is requested, track the render through terminal success and inspect the resulting media rather than relying on submission success.

## First-Clip Gate

For a new source, profile, or style, complete one highest-ranked clip before batching. Inspect it end to end and revise candidate scoring or treatment when the real timeline reveals a poor assumption. Only then apply the treatment to the remaining candidates.

Before export, re-read the transcript at the edited boundaries. The first audible words must form a clear opening rather than a dangling continuation, and the final audible words must complete the thought, reaction, result, or call to action. Move either boundary when this check fails, even if the candidate score was high.

## Benchmark Protocol

Build the benchmark from real livestream recordings covering multiple profiles, paces, layouts, languages, and quality levels. Keep source and expected decisions versioned outside the shipped skill body.

For each source, have reviewers independently mark:

- section profiles and profile transitions;
- notable events and unacceptable excerpts;
- preferred start/end ranges with acceptable boundary tolerance;
- why each event is worth clipping;
- factual entities that must remain exact;
- technical defects and privacy/compliance risks;
- preferred top clips for at least two different objectives.

Evaluate:

| Metric | Meaning |
|---|---|
| Event recall | Human-marked valuable events surfaced in the candidate ledger |
| Top-k precision | Selected clips judged publishable or useful by reviewers |
| Boundary error | Difference from acceptable human start/end ranges |
| Standalone clarity | New viewers understand setup and payoff |
| Meaning fidelity | No changed claim, attribution, causality, or chronology |
| Profile correctness | Section and candidate use the right genre rules |
| Technical defect rate | Black frames, clipped audio, bad crop, subtitle errors, gaps, or offline media |
| Diversity | Selected set avoids redundant topics, events, and treatments |
| Editability | Reviewers can refine the result without rebuilding it |
| Export completion | A real rendered artifact opens, has expected duration, and matches the timeline |

Use human ratings in addition to automated checks. Compare counterexamples and disagreements instead of hiding them in one average score. Keep separate results by profile because a global average can conceal a failure on a smaller genre.

## Evidence to Record During Real Agent Tests

- exact user instruction and selected skill;
- tools called with source ranges and returned evidence;
- candidate ledger and rejection reasons;
- timeline/project identifiers before and after editing;
- inspected source and timeline frames;
- audio or transcript boundary checks;
- render identifier, terminal status, output duration, and playable artifact path;
- reviewer notes for the first clip and any re-ranking performed.

## Research Basis

- PodReels found that candidate options, preview, sentence-level control, and visible treatment of jump cuts improved creator efficiency and control: https://arxiv.org/abs/2311.05867
- CatchLive evaluated highlights across game, cooking, and talk streams and reported different needs by genre and stream pace: https://doi.org/10.1145/3491102.3517461
- Audience-chat highlight work reports precision, recall, and F-score while separating chat, visual, and fused inputs, supporting per-modality ablations: https://arxiv.org/abs/1707.08559
- Instructional-video research evaluates learning utility, effort, claim coverage, temporal alignment, and human agreement rather than surface polish alone: https://arxiv.org/abs/2606.28531
`,p=`---
name: long-video-to-shorts
description: Cut one long podcast, interview, course, livestream, or other source video into social-ready shorts, reels, highlights, or clip timelines from existing project media. Use when the user asks to cut a long video into Shorts, Reels, TikToks, Xiaohongshu posts, best moments, highlights, or multiple clips.
---

# Long Video to Shorts

Use this workflow when one long source video carries the output. Supporting clips may exist, but the short-form story comes from selecting self-contained moments inside the long source.

This is a OpenChatCut-native workflow. Use the current project, assets, transcript, timeline, and OpenChatCut editing tools. Do not depend on external download, transcription, ffmpeg, or auto-crop pipelines unless the user explicitly asks for an external source that is not already in the project.

## Workflow

1. Read the project state before editing. Identify the primary long video, duration, language, speakers, current timeline, transcript readiness, visual descriptions, and aspect ratio.
2. Confirm that one long source carries the output. If the project is mainly multiple raw clips with no dominant long source, switch to the Multi Clips to Reels workflow.
3. Determine only missing constraints that would change the edit: platform, clip count, target duration, audience, style, captions/title text, music, and whether the user wants options or direct creation.
4. If more than one missing constraint remains, ask for them in one \`<widget>\` after loading \`widget-forms\`. Use text fields for open-ended fields like topic, spoken language, audience, or goals; use single/multi choice fields for bounded choices like platform, count, duration, captions, or music.
5. Use transcript ranges when available. If transcription is unavailable or unreliable, inspect visual/audio content and ask only for missing context that changes selection.
6. Scan for moments that can stand alone: clear setup, hook, claim, proof, emotional turn, lesson, conflict, demonstration, or payoff. Read [references/short-form-selection.md](references/short-form-selection.md) when scoring or comparing candidates.
7. Build a compact candidate plan before heavy editing. For each output include source range, opening hook, why it stands alone, payoff, target duration, platform treatment, and risks.
8. If the user gave enough constraints and asked to create directly, proceed after stating the plan. If the source is very long, the request is vague, or the requested count is high, create or preview the first strongest clip before batching the rest.
9. Cut on clean word, phrase, action, or beat boundaries. Tighten filler, false starts, repeated attempts, and dead time only when meaning and tone stay intact.
10. Package for the target platform: aspect ratio/crop, title text, styled captions, music, light motion graphics, zooms, speed changes, or transitions only when they support the selected moment.
11. QA before reporting done: hook in first seconds, clear payoff, standalone clarity, no misleading title, clean boundaries, platform fit, requested count/duration, timeline names, and export readiness.

## Plan Format

When presenting a plan, use this compact shape:

- Clip number/title
- Source range
- Opening hook
- Why it stands alone
- Payoff or viewer value
- Target duration/platform treatment
- Edit notes and risks

When creating clips, report timeline names, durations, packaging applied, assumptions, and what to review first.

## Rules

- Preserve claims, speaker intent, context, and causality. Do not make the speaker appear to say something they did not mean.
- Prefer the smallest range that preserves setup, meaning, and payoff.
- Do not summarize the whole long source evenly.
- Do not choose a quotable line if it needs missing context to make sense.
- Do not use misleading title text to compensate for a weak moment.
- Do not pad with weak clips just to hit the requested count.
- Do not treat a full talking-head polish request as Long Video to Shorts unless the user asks for shorts, clips, highlights, or cutdowns.
- Do not batch many shorts blindly. If the style is not established, create or preview the first strong clip before repeating it.`,m=`# Short-Form Candidate Selection

Use this guide to compare transcript moments from one long source and visual sequences assembled from multiple clips. Score source strength before adding captions, music, transitions, or other packaging.

## 1. Record candidate evidence

Create one row per candidate and use stable IDs so another pass can reproduce the ranking.

| Field | Long-source moment | Multi-clip sequence |
| --- | --- | --- |
| Candidate ID | Source asset + start/end range | Ordered asset IDs + ranges |
| Direct evidence | Exact transcript line, speaker turn, action, or audio beat | Observed subject, action, motion, reaction, composition, or audio beat |
| Proposed arc | Hook → setup/proof → payoff within the range | Hook shot → context/proof shots → payoff shot |
| Boundary evidence | Complete phrase, breath, pause, reaction, or action | Entry/exit motion, beat, action completion, or natural transition |
| Constraints | Requested audience, duration, format, tone, and purpose | Requested audience, duration, format, tone, and purpose |
| Risks | Missing context, weak audio, misleading implication, safety/privacy, crop, or rights concern | Continuity, unsupported claim, duplicate footage, safety/privacy, crop, or rights concern |

Write observations as facts. Label interpretations as assumptions and verify them before editing. Never infer a claim, identity, relationship, result, or chronology that the source does not support.

## 2. Check the candidate arc

A viable candidate should answer these questions from its own selected material:

- **Standalone clarity:** Can a new viewer understand the subject, action, or claim without the surrounding source?
- **Hook:** Does the opening create immediate curiosity, tension, surprise, relevance, or visual interest?
- **Payoff:** Does the selection deliver an answer, proof, reveal, emotional turn, lesson, result, or satisfying final beat?
- **Context integrity:** Does trimming preserve the speaker's meaning, event order, cause and effect, and user-supplied claims?
- **Visual strength:** Is there a readable subject, meaningful action, expressive reaction, useful detail, or purposeful composition?
- **Platform fit:** Does the material suit the user's requested duration, format, audience, tone, and viewing conditions without relying on assumed platform conventions?
- **Redundancy:** Is it meaningfully different from stronger candidates in topic, claim, action, framing, energy, or payoff?
- **Clean boundaries:** Can it start and end without clipped speech, incomplete action, abrupt context loss, or accidental dead air?

For speech-led moments, visuals may support rather than lead. For visual sequences, meaning may come from shot order and audio rather than dialogue. Do not penalize either form merely for lacking the other's evidence type.

## 3. Score reproducibly

Score each factor from \`0\` to \`4\` using the same evidence pass:

- \`0\` — absent, unusable, or contradicted by the source
- \`1\` — weak; major repair or outside explanation required
- \`2\` — workable; clear limitations remain
- \`3\` — strong; minor editing is enough
- \`4\` — exceptional; immediately legible and well supported

| Factor | Weight | Scoring question |
| --- | ---: | --- |
| Standalone clarity | 18 | Does the selected material explain itself? |
| Hook | 16 | Is the first usable beat compelling? |
| Payoff | 14 | Is there a concrete, satisfying destination? |
| Context integrity | 14 | Will the cut preserve meaning and chronology? |
| Visual strength | 12 | Are the selected images/actions readable and purposeful? |
| Platform fit | 10 | Does it fit the user's stated delivery constraints? |
| Clean boundaries | 8 | Are there natural, editable start and end points? |
| Distinctiveness | 8 | Does it add value beyond higher-ranked candidates? |

Calculate:

\`base score = sum(factor rating × factor weight) ÷ 4\`

The base score is out of \`100\`. Keep the individual ratings and one evidence note per factor; a total without notes is not reproducible.

Apply only evidence-based deductions after the base score:

| Deduction | Range | Use when |
| --- | ---: | --- |
| Correctable risk | \`-1\` to \`-10\` | A crop, audio, pacing, continuity, or boundary issue is real but repairable |
| Redundancy | \`-1\` to \`-12\` | A higher-ranked candidate already delivers substantially the same value |

\`final score = base score - deductions\`

Do not deduct twice for the same weakness. Rank by final score, then break ties in this order: context integrity, standalone clarity, hook, payoff, visual strength. Preserve the original candidate IDs and scores when re-ranking after user feedback.

## 4. Reject before ranking

Reject a candidate rather than trying to rescue it with packaging when any of these are true:

- It changes or obscures the source meaning, chronology, speaker intent, or user-provided claim.
- It requires invented context, unsupported title text, or an unverified factual claim to make sense.
- It lacks a usable opening, understandable middle, or payoff after reasonable trimming.
- Speech or action is irreparably clipped, inaudible, visually unreadable, or missing the evidence needed for the proposed arc.
- Safety, privacy, consent, rights, or sensitive-content concerns cannot be resolved within the user's instructions and available project evidence.
- It is materially weaker than and redundant with a stronger candidate.
- It cannot meet the user's stated duration or format without breaking context integrity.

A rejected candidate receives a reason, not a score. Do not lower the threshold merely to reach a requested count.

## 5. Select and sequence

1. Inventory broadly enough to find competing hooks and payoffs; do not score only the first plausible moment.
2. Remove rejected candidates.
3. Score the remaining candidates in one pass with the same constraints and evidence standard.
4. Rank by final score and apply the tie-break order.
5. Review the tentative set for variety across subject, claim, action, framing, energy, and payoff; apply redundancy deductions and re-rank.
6. Record the selected source ranges, opening beat, arc, expected duration, treatment constraints, and unresolved risks.

## 6. Prove the first clip before batching

When style is not established, material is varied, the source is very long, or the requested count is high, create or preview the highest-ranked candidate first. Verify that its hook, clarity, payoff, boundaries, crop, pacing, and packaging work in the actual timeline. Use that confirmed treatment as the batch reference, then process the remaining ranked candidates. If the first clip exposes a scoring assumption or treatment problem, update the rubric notes and re-rank before batching; do not repeat the flaw across outputs.
`,h=`---
name: motion-graphic-placement
description: Add motion graphics at the right moments without blocking the story. Use when the user wants to enhance talking-head, lecture, tutorial, interview, podcast, or creator videos with motion graphics.
---

# Motion Graphic Placement

Use this skill to plan where motion graphics should appear, what type each one should be, and how to keep them readable, rhythmic, and consistent with the video.

## Goals

- Reinforce important speech moments without covering the speaker or subtitles.
- Match MG type to the semantic function of the line.
- Keep density high enough for retention but sparse enough to avoid fatigue.
- Maintain one visual language across the whole edit.

## Workflow

1. Read project state, transcript, active design style, video aspect ratio, and visible speaker layout.
2. Identify the video structure:
   - hook
   - problem or setup
   - body / proof / steps
   - summary / CTA
3. Decide motion-graphic density:
   - long-form landscape: usually one meaningful MG every 5-8 seconds, tighter in the first 15 seconds
   - short-form portrait: usually one meaningful MG every 3-5 seconds, with stronger rhythm
   - reduce density when the speaker's face, gesture, or screen recording already carries the moment
4. Pick MG types from semantic triggers.
5. Review the plan before generation:
   - no repeated form in a row unless intentionally templated
   - no overlays on face, hands, product focal point, or subtitle area
   - no unnecessary full-screen takeover when a card, strip, badge, or annotation is enough
6. Generate or reuse MGs.
7. Place each MG against the relevant transcript moment.
8. Verify screenshots at target frames and fix anything that blocks content, feels mistimed, or carries template residue.

## Semantic Triggers

| Speech pattern                        | Good MG direction                       |
| ------------------------------------- | --------------------------------------- |
| strong opinion, conclusion, key quote | highlight sentence or quote card        |
| numbers, percentages, prices          | number card, counter, chart, price card |
| steps, lists, sequence                | point list, flow steps, timeline        |
| comparison or choice                  | comparison card, split card, VS card    |
| warning or mistake                    | warning card or caution badge           |
| question, suspense, hook              | question card, hook text                |
| self-intro, guest, role               | name tag or lower-third                 |
| source, screenshot, comment, evidence | source card or annotation               |
| CTA                                   | CTA card                                |

## Placement Rules

- Always inspect the frame before placing an overlay.
- Place MGs away from the speaker's face, hands, active product area, and subtitles.
- Landscape: side cards work well when the speaker is clearly on the opposite side; bottom strips must sit above subtitles.
- Portrait: keep the bottom 15-20% clear for captions and interaction UI.
- Full-screen MGs should be reserved for hooks, chapter transitions, dense data, or moments where the original footage adds little value.
- After a full-screen MG, leave enough breathing room before the next overlay.

## Style And Reuse

- Use the active Design Style when the project has one.
- Same-role MGs should reuse a confirmed template or code structure and change only the content.
- New-role MGs can borrow style, but should not inherit irrelevant template text, charts, labels, or layout.
- After generation, inspect the visual output. If old template text or wrong structure appears, fix the asset instead of trusting props.

## Quality Checks

- Every MG has a reason tied to a speech beat.
- Text can be read at playback size.
- Adjacent MGs vary in form, position, or rhythm.
- No face/subtitle/product obstruction.
- Visual style is consistent but not repetitive.
- The final edit feels clearer, not busier.`,g=`---
name: multi-clips-to-reels
description: Turn multiple product shots, event footage, travel clips, gameplay moments, UGC/product footage, B-roll, or mixed media into social-ready reels, highlights, recaps, or montage-style short videos from existing project media.
---

# Multi Clips to Reels

Use this workflow when multiple raw clips or assets carry the output. The task is to select, sequence, and package the strongest footage into one or more reels, highlights, recaps, or short videos.

This is a OpenChatCut-native workflow. Use the current project, source assets, asset-frame inspection, AV/script context, and OpenChatCut editing tools. Use the current timeline when it already contains relevant cuts or for final verification; do not depend on timeline screenshots as the primary way to understand raw source clips. Do not depend on external download, transcription, ffmpeg, or auto-crop pipelines unless the user explicitly asks for an external source that is not already in the project.

## Workflow

1. Read the project state before editing. Inventory usable source assets: duration, aspect ratio, visual subject, motion/energy, audio quality, duplicates, current timeline state when relevant, obvious hero shots, and fixed-role assets such as logos, QR codes, product photos, brand screenshots, or supplied audio.
2. Confirm that multiple clips carry the output. If one long source clearly defines the story and other assets are only support, switch to the Long Video to Shorts workflow.
3. Identify the user's starting point:
   - \`open_media_reel\`: uploaded clips/photos and a loose goal.
   - \`script_or_storyboard\`: supplied script, timestamps, shot list, scene notes, or exact copy.
   - \`asset_pack_promo\`: product/event/place assets with logos, screenshots, QR codes, audio, or brand constraints.
   - \`highlight_selection\`: many clips where the main work is selecting the strongest visual moments.
4. Determine only missing constraints that would change the edit: platform, output count, target duration, audience, style, captions/title text, music, and whether the user wants options or direct creation.
5. If more than one missing constraint remains, ask for them in one \`<widget>\` after loading \`widget-forms\`. Use text fields for open-ended fields like premise, audience, product/context, or goals; use single/multi choice fields for bounded choices like platform, count, duration, captions, or music.
6. Assign source assets a possible role: hook, context, proof, demonstration, emotional beat, transition, payoff, end card, logo/QR, product evidence, or audio bed. Do not assume every uploaded clip deserves screen time.
7. Match the planning style to the starting point. For \`script_or_storyboard\`, preserve the user's scene order, copy, timestamps, and claims while mapping each source asset to the requested shot. For \`asset_pack_promo\`, lock the product/place/event identity and reserve fixed-role assets for brand, proof, or CTA moments. For \`open_media_reel\` and \`highlight_selection\`, select and sequence the strongest moments instead of averaging every asset.
8. Compare possible hooks and sequences using [references/short-form-selection.md](references/short-form-selection.md). Use \`read_script\` for the speech/script overview, \`view_asset_frames\` for specific source frames and frame-block analysis to select high points or verify what happens on screen. Select for strength, variety, continuity, and fit to the requested platform.
9. Build a compact sequence plan before heavy editing. For each output include selected assets/ranges, opening hook, shot order, role of each shot, rhythm, target duration, platform treatment, and risks.
10. If the user gave enough constraints and asked to create directly, proceed after stating the plan. If the material is varied or the requested count is high, create or preview the first strongest reel before batching the rest.
11. Edit around a viewer-facing arc: hook, context, escalation or proof, payoff. For a pure highlight reel, the payoff can be the strongest final moment or a satisfying recap beat.
12. Package for the target platform: aspect ratio/crop, title text, styled captions, music/beat sync, light motion graphics, transitions, speed ramps, or zooms only when they improve rhythm or clarity.
13. QA before reporting done: strongest shot first, clear sequence purpose, distinct outputs, no unsupported claims, platform fit, requested count/duration, timeline names, and export readiness.

## Plan Format

When presenting a plan, use this compact shape:

- Clip/reel number/title
- Starting point: \`open_media_reel\`, \`script_or_storyboard\`, \`asset_pack_promo\`, or \`highlight_selection\`
- Selected source assets or ranges
- Source evidence used, such as \`read_script\`, source frames, or visual-analysis notes
- Opening hook visual or line
- Shot order and role of each shot
- Rhythm or sequence shape
- Target duration/platform treatment
- Edit notes and risks

When creating clips, report timeline names, durations, packaging applied, assumptions, and what to review first.

## Rules

- Start with the strongest visual or clearest promise. Do not slowly introduce every asset.
- Trim clips aggressively enough to maintain rhythm, but keep enough context for the sequence to make sense.
- Do not evenly sample every asset.
- Do not build a contextless montage when the user needs a clear reel, recap, or highlight.
- Do not repeat visually similar shots unless repetition creates rhythm or comparison.
- Do not use captions/title text to invent unsupported claims.
- Do not let packaging effects hide weak source selection.
- For multiple requested reels or short videos, create distinct angles instead of near-duplicate edits from the same footage.`,_=`# Short-Form Candidate Selection

Use this guide to compare transcript moments from one long source and visual sequences assembled from multiple clips. Score source strength before adding captions, music, transitions, or other packaging.

## 1. Record candidate evidence

Create one row per candidate and use stable IDs so another pass can reproduce the ranking.

| Field | Long-source moment | Multi-clip sequence |
| --- | --- | --- |
| Candidate ID | Source asset + start/end range | Ordered asset IDs + ranges |
| Direct evidence | Exact transcript line, speaker turn, action, or audio beat | Observed subject, action, motion, reaction, composition, or audio beat |
| Proposed arc | Hook → setup/proof → payoff within the range | Hook shot → context/proof shots → payoff shot |
| Boundary evidence | Complete phrase, breath, pause, reaction, or action | Entry/exit motion, beat, action completion, or natural transition |
| Constraints | Requested audience, duration, format, tone, and purpose | Requested audience, duration, format, tone, and purpose |
| Risks | Missing context, weak audio, misleading implication, safety/privacy, crop, or rights concern | Continuity, unsupported claim, duplicate footage, safety/privacy, crop, or rights concern |

Write observations as facts. Label interpretations as assumptions and verify them before editing. Never infer a claim, identity, relationship, result, or chronology that the source does not support.

## 2. Check the candidate arc

A viable candidate should answer these questions from its own selected material:

- **Standalone clarity:** Can a new viewer understand the subject, action, or claim without the surrounding source?
- **Hook:** Does the opening create immediate curiosity, tension, surprise, relevance, or visual interest?
- **Payoff:** Does the selection deliver an answer, proof, reveal, emotional turn, lesson, result, or satisfying final beat?
- **Context integrity:** Does trimming preserve the speaker's meaning, event order, cause and effect, and user-supplied claims?
- **Visual strength:** Is there a readable subject, meaningful action, expressive reaction, useful detail, or purposeful composition?
- **Platform fit:** Does the material suit the user's requested duration, format, audience, tone, and viewing conditions without relying on assumed platform conventions?
- **Redundancy:** Is it meaningfully different from stronger candidates in topic, claim, action, framing, energy, or payoff?
- **Clean boundaries:** Can it start and end without clipped speech, incomplete action, abrupt context loss, or accidental dead air?

For speech-led moments, visuals may support rather than lead. For visual sequences, meaning may come from shot order and audio rather than dialogue. Do not penalize either form merely for lacking the other's evidence type.

## 3. Score reproducibly

Score each factor from \`0\` to \`4\` using the same evidence pass:

- \`0\` — absent, unusable, or contradicted by the source
- \`1\` — weak; major repair or outside explanation required
- \`2\` — workable; clear limitations remain
- \`3\` — strong; minor editing is enough
- \`4\` — exceptional; immediately legible and well supported

| Factor | Weight | Scoring question |
| --- | ---: | --- |
| Standalone clarity | 18 | Does the selected material explain itself? |
| Hook | 16 | Is the first usable beat compelling? |
| Payoff | 14 | Is there a concrete, satisfying destination? |
| Context integrity | 14 | Will the cut preserve meaning and chronology? |
| Visual strength | 12 | Are the selected images/actions readable and purposeful? |
| Platform fit | 10 | Does it fit the user's stated delivery constraints? |
| Clean boundaries | 8 | Are there natural, editable start and end points? |
| Distinctiveness | 8 | Does it add value beyond higher-ranked candidates? |

Calculate:

\`base score = sum(factor rating × factor weight) ÷ 4\`

The base score is out of \`100\`. Keep the individual ratings and one evidence note per factor; a total without notes is not reproducible.

Apply only evidence-based deductions after the base score:

| Deduction | Range | Use when |
| --- | ---: | --- |
| Correctable risk | \`-1\` to \`-10\` | A crop, audio, pacing, continuity, or boundary issue is real but repairable |
| Redundancy | \`-1\` to \`-12\` | A higher-ranked candidate already delivers substantially the same value |

\`final score = base score - deductions\`

Do not deduct twice for the same weakness. Rank by final score, then break ties in this order: context integrity, standalone clarity, hook, payoff, visual strength. Preserve the original candidate IDs and scores when re-ranking after user feedback.

## 4. Reject before ranking

Reject a candidate rather than trying to rescue it with packaging when any of these are true:

- It changes or obscures the source meaning, chronology, speaker intent, or user-provided claim.
- It requires invented context, unsupported title text, or an unverified factual claim to make sense.
- It lacks a usable opening, understandable middle, or payoff after reasonable trimming.
- Speech or action is irreparably clipped, inaudible, visually unreadable, or missing the evidence needed for the proposed arc.
- Safety, privacy, consent, rights, or sensitive-content concerns cannot be resolved within the user's instructions and available project evidence.
- It is materially weaker than and redundant with a stronger candidate.
- It cannot meet the user's stated duration or format without breaking context integrity.

A rejected candidate receives a reason, not a score. Do not lower the threshold merely to reach a requested count.

## 5. Select and sequence

1. Inventory broadly enough to find competing hooks and payoffs; do not score only the first plausible moment.
2. Remove rejected candidates.
3. Score the remaining candidates in one pass with the same constraints and evidence standard.
4. Rank by final score and apply the tie-break order.
5. Review the tentative set for variety across subject, claim, action, framing, energy, and payoff; apply redundancy deductions and re-rank.
6. Record the selected source ranges, opening beat, arc, expected duration, treatment constraints, and unresolved risks.

## 6. Prove the first clip before batching

When style is not established, material is varied, the source is very long, or the requested count is high, create or preview the highest-ranked candidate first. Verify that its hook, clarity, payoff, boundaries, crop, pacing, and packaging work in the actual timeline. Use that confirmed treatment as the batch reference, then process the remaining ranked candidates. If the first clip exposes a scoring assumption or treatment problem, update the rubric notes and re-rank before batching; do not repeat the flaw across outputs.
`,v=`---
name: music
description: |
  Music generation via Mureka, MiniMax, Atlas Cloud, and Sonilo. Use for instrumentals, songs, soundtracks, track/stem generation, covers, or video-conditioned scoring of the finished cut through \`submit_music\`.
user-invocable: true
---

# Music

\`submit_music\` returns a generation \`jobId\`; call \`track_progress\` until every result is saved in the media pool. Placement, trim, loop, fades, and ducking remain timeline operations.

## Providers and modes

| Provider | Modes | Reference |
| --- | --- | --- |
| \`mureka\` | \`instrumental\`, \`song\`, \`prompt-song\`, \`soundtrack\`, \`track\` | [references/mureka.md](references/mureka.md) |
| \`minimax\` | \`t2m\`, \`cover\` | [references/minimax.md](references/minimax.md) |
| \`atlas\` | \`t2m\` | [references/atlas.md](references/atlas.md) |
| \`sonilo\` | \`v2m\` | [references/sonilo.md](references/sonilo.md) |

Select the named/configured vendor. Default to Mureka instrumental for ordinary BGM. Use Mureka song/prompt-song when its vocal or reference controls are wanted; use Mureka soundtrack for an image/video-driven score and track mode for generating a stem/track from a song/audio source. Use MiniMax for its text-to-music and cover models. Use Atlas Cloud for schema-backed text-to-music through its asynchronous audio API. Use Sonilo v2m when the music should be composed from the finished cut itself (a project video asset) rather than a text description.

## Shared workflow

1. Confirm provider, mode, and whether multiple paid variants are wanted.
2. Read the provider reference and pass only that provider's parameters.
3. Submit once, then call \`track_progress({ target:"generation", action:"wait", jobIds:[jobId] })\`.
4. Use every returned asset when \`count\` produced multiple results; do not assume only the legacy \`result\` field exists.
5. Place/trim/duck on the timeline only after actual durations are known.

## Examples

\`\`\`ts
// Mureka instrumental (default count is deliberately 1)
submit_music({ provider: "mureka", mode: "instrumental", prompt: "Warm lo-fi piano bed under narration", count: 1 });

// Mureka lyrics song
submit_music({
  provider: "mureka", mode: "song", prompt: "Bright modern pop", gender: "female", count: 2,
  lyrics: "[Verse]\\nCity lights open the night\\n[Chorus]\\nWe build the future in real time",
});

// Mureka prompt song
submit_music({ provider: "mureka", mode: "prompt-song", prompt: "A hopeful road-trip anthem", styles: ["pop", "folk"] });

// Score a project video or image
submit_music({ provider: "mureka", mode: "soundtrack", sourceAssetId: "videoAssetId", prompt: "Tense restrained documentary score" });

// Generate a stem from a Mureka song id
submit_music({ provider: "mureka", mode: "track", songId: "song-id", trackType: "Drums", prompt: "Tight punchy acoustic drums" });

// MiniMax instrumental / vocals
submit_music({ provider: "minimax", mode: "t2m", prompt: "Upbeat electronic tech intro", isInstrumental: true });
submit_music({ provider: "minimax", mode: "t2m", prompt: "Rainy night pop", lyricsOptimizer: true });

// MiniMax cover from a project audio asset
submit_music({ provider: "minimax", mode: "cover", prompt: "Warm acoustic coffee-shop cover", referenceAssetId: "audioAssetId" });

// Atlas Cloud text-to-music
submit_music({ provider: "atlas", mode: "t2m", prompt: "Cinematic ambient score with restrained piano", isInstrumental: true });

// Sonilo video-to-music from the rendered cut (prompt optional)
submit_music({ provider: "sonilo", mode: "v2m", sourceAssetId: "renderedCutAssetId" });
submit_music({ provider: "sonilo", mode: "v2m", sourceAssetId: "renderedCutAssetId", prompt: "Warm indie folk, no drums" });
\`\`\`

## Rules

- Only generate after an explicit request; \`count\` 2–3 can multiply provider charges, so never add variants silently.
- Mureka \`stream:true\` enables the provider's streaming task phase, but OpenChatCut still waits for durable final files.
- MiniMax cover requires a configured \`music-cover*\` model and exactly one of \`referenceAssetId\` or \`coverFeatureId\`; \`coverFeatureId\` also requires lyrics.
- Atlas Cloud supports \`t2m\` only and does not accept MiniMax cover/optimizer or Mureka-specific controls.
- Never mix MiniMax audio-setting fields into Mureka or Mureka IDs/modes into MiniMax.
- Generated music does not guarantee exact beat/drop timing; cut and align after generation.
`,y='# Atlas Cloud\n\nUse Atlas Cloud as an optional text-to-music provider through the asynchronous audio API.\n\n## Configuration\n\nSet `ATLASCLOUD_API_KEY`. Override these only when needed:\n\n- `ATLASCLOUD_API_BASE` defaults to `https://api.atlascloud.ai/api/v1`.\n- `ATLASCLOUD_MUSIC_MODEL` defaults to `minimax/music-2.6`.\n\n## Supported input\n\nUse `provider:"atlas"` with `mode:"t2m"`. Pass a required style prompt and optionally:\n\n- `lyrics` (up to 3500 characters)\n- `isInstrumental`\n- `audioFormat`: `mp3`, `wav`, or `pcm`\n- `sampleRate`: `16000`, `24000`, `32000`, or `44100`\n- `bitrate`: `32000`, `64000`, `128000`, or `256000`\n\nDo not pass MiniMax cover controls, `lyricsOptimizer`, or Mureka IDs/modes. Submission is a single paid POST. OpenChatCut records the prediction ID, polls with bounded backoff, and can resume polling without submitting another generation.\n',b='# MiniMax Music (`provider: "minimax"`)\n\nRead this before `submit_music({ provider: "minimax", … })`.\n\nGrounded in OpenChatCut’s music adapter (`server/plugins/music.ts` → MiniMax\n`/v1/music_generation`). Official fields: `prompt`, `lyrics`, `is_instrumental`,\n`lyrics_optimizer`, `audio_setting`, `output_format`, and cover refs\n(`audio_base64` / `cover_feature_id`).\n\nServer MiniMax model comes from Settings `MINIMAX_MUSIC_MODEL`\n(`music-3.0` / `music-2.6` / free / **cover** variants).\n\n## Capabilities (as wired)\n\n| Dimension | Value |\n| --- | --- |\n| Provider arg | `minimax` |\n| Prompt | t2m ≤ **2000**; cover style **10–300** |\n| Lyrics | t2m ≤ **3500**; cover optional **10–1000** |\n| Instrumental | `isInstrumental` or omit lyrics (t2m only) |\n| Lyrics optimizer | `lyricsOptimizer: true` + empty lyrics (t2m only) |\n| Cover reference | exactly one of `referenceAssetId` → raw `audio_base64`, or `coverFeatureId` |\n| Audio setting | `sampleRate` / `bitrate` / `audioFormat` |\n| Placement | **Media pool only** |\n\n## Modes\n\n| Intent | Args | Settings model |\n| --- | --- | --- |\n| BGM / instrumental | `mode:"t2m"`, `isInstrumental:true` | music-2.6 / 3.0 / free |\n| Song with lyrics | `mode:"t2m"`, `lyrics: "…"` | music-2.6 / 3.0 / free |\n| Auto lyrics | `mode:"t2m"`, `lyricsOptimizer: true` | music-2.6 / 3.0 / free |\n| **Cover / 翻唱** | `mode:"cover"` + source/feature id + style prompt | **music-cover** or **music-cover-free** |\n\n## Tool shape\n\n```ts\n// Instrumental BGM\nsubmit_music({\n  provider: "minimax",\n  mode: "cover",\n  prompt: "Cinematic strings, hopeful, soft under dialogue",\n  name: "BGM · strings",\n});\n\n// Vocals + lyrics\nsubmit_music({\n  provider: "minimax",\n  prompt: "Indie folk, acoustic guitar, intimate",\n  lyrics: "[Verse]\\\\n...\\\\n[Chorus]\\\\n...",\n  name: "Song · folk",\n});\n\n// Auto lyrics from prompt\nsubmit_music({\n  provider: "minimax",\n  prompt: "Rainy night pop, melancholic chorus about leaving home",\n  lyricsOptimizer: true,\n  name: "Song · auto lyrics",\n});\n\n// Music-cover (Settings model must be music-cover*)\nsubmit_music({\n  provider: "minimax",\n  prompt: "Warm acoustic cover, intimate coffee-shop vibe",\n  referenceAssetId: "audioAssetId",\n  name: "Cover · acoustic",\n});\n\n// Higher-quality WAV instrumental\nsubmit_music({\n  provider: "minimax",\n  prompt: "Orchestral trailer hit",\n  isInstrumental: true,\n  audioFormat: "wav",\n  sampleRate: 44100,\n  bitrate: 256000,\n  name: "Hit · wav",\n});\n```\n\n## Cover rules\n\n1. Set **MINIMAX_MUSIC_MODEL** to `music-cover` or `music-cover-free` in Settings.\n2. Pass exactly one of **`referenceAssetId`** (project audio) or **`coverFeatureId`** (preprocess result valid for 24 hours).\n3. **Prompt** describes the *target style*, not the full song (10–300 chars).\n4. With `referenceAssetId`, lyrics are optional. With `coverFeatureId`, lyrics are required (10–1000 chars).\n5. Do not combine cover with `isInstrumental` or `lyricsOptimizer`.\n\nIf you pass `referenceAssetId` while the model is still `music-2.6`, the server errors until the cover model is selected.\n\n## Lyrics tips\n\n- Section tags: `[Intro]`, `[Verse]`, `[Pre Chorus]`, `[Chorus]`, `[Bridge]`, `[Outro]`, …\n- Lines separated by `\\n`\n- For speech-under BGM, stay instrumental\n\n## Errors\n\n| Message | Fix |\n| --- | --- |\n| `MiniMax is not configured` | Set `MINIMAX_API_KEY` |\n| `music-cover requires MINIMAX_MUSIC_MODEL…` | Switch model to music-cover* |\n| `music-cover requires exactly one…` | Pass one source asset or feature ID |\n| `music-cover prompt must be 10–300 characters` | Expand or shorten style prompt |\n| `minimax vocals require lyrics…` | lyrics / lyricsOptimizer / isInstrumental |\n| `sampleRate must be…` | Use allowed enums |\n',x='# Mureka (`provider: "mureka"`)\n\nOpenChatCut wires the official Mureka generate/query and file-upload APIs. The configured model is `MUREKA_MUSIC_MODEL` (default `auto`; official choices include `mureka-7.6`, `mureka-o2`, `mureka-8`, `mureka-9`, with endpoint-specific support).\n\n## Modes\n\n| Mode | Endpoint | Key controls |\n| --- | --- | --- |\n| `instrumental` | `/v1/instrumental/generate` | exactly one of `prompt` ≤1024 or `instrumentalId`; `count` 1–3; `stream` |\n| `song` | `/v1/song/generate` | `lyrics` required ≤5000; prompt ≤1024; gender/referenceId/vocalId/melodyId; count/stream |\n| `prompt-song` | `/v1/song/easy-generate` | prompt ≤2000; styles/referenceId/vocalId; count/stream |\n| `soundtrack` | `/v1/soundtrack/generate` | project image/video `sourceAssetId`; prompt ≤1024; count; optional audio start/end (≥3s range) |\n| `track` | `/v1/track/generate` | exactly one of `songId` or audio `sourceAssetId`; `trackType`; required prompt ≤1024; ranges/lyrics/vocalGender |\n\n`sourceAssetId` is uploaded server-side with official purpose `soundtrack` or `audio`. Track types: `Vocals`, `Instrumental`, `Drums`, `Bass`, `Guitar`, `Keyboard`, `Percussion`, `Strings`, `Synth`, `FX`, `Brass`, `Woodwinds`.\n\nPrompt-song styles: `pop`, `rock`, `jazz`, `r&b`, `edm`, `ambient`, `folk`, `latin`, `k-pop`, `j-pop`, `house`, `gospel`, `lo-fi`.\n\nOutput selection: `audioFormat` may be `mp3`, `wav`, or `flac`. Every returned choice is downloaded and becomes a distinct asset. OpenChatCut defaults `count` to 1 rather than Mureka\'s official default 2 to avoid surprise charges.\n\n## Combinations\n\n- `melodyId` is standalone; do not combine it with prompt/referenceId/vocalId.\n- `mureka-o2` does not support vocalId or melodyId and is not valid for instrumental/soundtrack endpoints.\n- `vocalGender` applies only to `trackType:"Vocals"`.\n- Soundtrack `audioStartMs`/`audioEndMs`, when both supplied, must select at least 3000ms.\n',S='# Sonilo (`provider: "sonilo"`)\n\nOpenChatCut wires the Sonilo video-to-music API (`/v1/video-to-music` → poll `/v1/tasks/{task_id}`). There is no model field: `/v1` always routes to the latest model server-side.\n\n## Mode\n\n| Mode | Input | Key controls |\n| --- | --- | --- |\n| `v2m` | project **video** `sourceAssetId` (the rendered cut, ≤6 minutes) | optional `prompt` ≤500 (single style hint; works promptless) |\n\nThe video is uploaded server-side and the music is composed from the cut itself — pacing, scene changes, and emotional arc come from the footage, not from a text description. Exactly one `.m4a` result per job.\n\n## Rights\n\nGenerated music is licensed and safe for commercial use (terms apply). Every track returns a `license_id`, surfaced as `licenseId` on the generation result and archived as a `.license.json` sidecar beside the audio file in the media uploads directory — keep it for commercial-use review.\n\n## Rules\n\n- `sourceAssetId` must resolve to a project **video** upload; images and audio are rejected.\n- `count` is fixed at 1; `lyrics`, styles, stems, segment ranges, and audio-format controls belong to other providers and are rejected.\n- Prompt is a style hint only ("warm indie folk, no drums"), not a scene description — the model already sees the video.\n- Videos longer than 6 minutes fail fast locally before upload; trim or export a shorter cut first.\n- The same `SONILO_API_KEY` also enables `submit_sound` with `provider: "sonilo"`: royalty-free sound effects generated from a project video asset (≤3 minutes), no prompt.\n',C="---\nname: music-intelligence\ndescription: |\n  Run or inspect local music analysis and plan or apply beat-, downbeat-, or section-synced video cuts or photo placements.\n  Use for BGM beat edits, rhythm cuts, 卡点剪辑, musical structure, BPM, mood, genre, or instrument questions.\nuser-invocable: false\n---\n\n# Music Intelligence\n\n1. Call `analyze_music` when the user asks to analyze music or no cache exists. It runs the installed local Beat This + CLAP models, waits for completion, and never downloads models; use `force:true` only for an explicit reanalysis request.\n2. Call `inspect_music` when only the existing cache is needed.\n3. Before cutting video, call `music_edit_plan` and show its bounded cut/target summary. Before placing photos, call `music_image_plan` and show its bounded placement summary. Prefer `timing:auto`; choose sparse, medium, or dense from the requested pace.\n4. Only after the plan is accepted, call `sync_cuts_to_music` or `sync_images_to_music` with the returned `analysisRef`. Each tool recomputes the plan, rejects stale analysis, and applies its changes as one undo step.\n5. If required model packs are missing, report the returned install guidance (Settings path + missing pack names), then ask whether to proceed with a `detect_beats` fallback for pure beat timing (BPM + beat frames only, no CLAP tags/sections/energy), or wait until the user installs the packs and retry `analyze_music` after installation.\n6. Never request, return, quote, summarize, or place the CLAP embedding in model context. Use tags, sections, confidence, and the opaque `analysisRef` only.\n\n## Preconditions\n\n- Analysis is opt-in and on-device. The media-pool asset must already have a cache for its current `sourceRevision`.\n- `rhythm-lite` supplies Beat This rhythm data; `music-semantics-lite` supplies CLAP tags and the private similarity vector.\n- An Agent call must never install a pack, download a model, decode media, or start inference. Direct the user to Settings and the media-card analysis action when the cache is unavailable.\n\n## Inspect\n\n- Identify the BGM by `itemId`, `assetId`, or an unambiguous name. Prefer the timeline item when the user intends to edit, because returned points are then mapped to timeline frames through the clip trim and playback rate.\n- `inspect_music` returns BPM, meter, confidence, tags, sections, counts, and bounded point lists. Lists are capped at 48 beats, 24 downbeats, 16 sections, and 12 tags; use a narrower range when `truncated` is true.\n- Treat `analysisRef` as opaque. It binds later planning and execution to the exact cached analysis without exposing the 512-value CLAP embedding.\n\n## Plan\n\n- `timing:auto` chooses section → downbeat → beat for sparse edits, downbeat → beat → section for medium edits, and beat → downbeat → section for dense edits.\n- Density samples every fourth, second, or first candidate for sparse, medium, or dense respectively.\n- Plans are bounded to 96 cut frames and 64 overlapping video targets. Report the returned summary and any cap or locked-target warning before applying.\n- A plan targets video clips that overlap the selected BGM range. It must never include or mutate the BGM item itself.\n\n## Photo placement\n\n- `music_image_plan` uses explicitly listed image asset ids in their given order, or all image assets in media-pool order when omitted. It cycles that order when the music range has more beat intervals than images.\n- Each placement covers the complete interval from one selected timing point to the next, including the BGM range boundaries, so images are not appended with their source duration or placed at a uniform default length.\n- Image placement is bounded to 96 clips and 64 image assets. `sync_images_to_music` requires an unlocked, empty target video track for the requested range; choose another track instead of overwriting existing content.\n\n## Apply and recover\n\n- Pass the same `itemId`, timing, density, range, target ids, and `analysisRef` to `sync_cuts_to_music`. Execution recomputes the plan from current state; do not replay an old list of frames.\n- A missing or stale ref means the project or analysis changed. Call `inspect_music`, then `music_edit_plan` or `music_image_plan`, and ask for acceptance again.\n- Locked video tracks are skipped and reported. Never unlock a track implicitly.\n- Successful splits are submitted as one `EditorCommands.batch`, so the whole rhythm edit is one undo step.\n- Successful photo placements are submitted as one `EditorCommands.batch`, so the whole sequence is one undo step.\n",w=`---
name: news-rough-cut
description: 新闻素材智能粗剪——把新闻素材粗剪为一条内容完整、逻辑清晰、节奏紧凑的新闻短视频。Use when the user asks to 粗剪新闻、新闻剪辑、把新闻素材剪成短视频、智能粗剪、news rough cut、编辑新闻视频, or provides news footage (发布会/采访/现场/监控素材) to be cut into a factual news short. Never add music, voiceover, or sound effects.
---

# News Rough Cut（新闻智能粗剪）

把新闻素材粗剪为一条内容完整、逻辑清晰、节奏紧凑的新闻短视频。忠实于原始素材，不加任何外部声音，保持客观、正式、紧凑、清晰的信息型新闻风格。

This is an OpenChatCut-native workflow. Use the current project's assets, transcript, word-level editing, timeline, and editing tools. Do not depend on external download or transcode pipelines.

## 工作流总览

1. **完整分析素材**（剪辑前必做）：识别素材中的新闻事件、核心话题、关键人物、重要结论及有效画面，再确定剪辑主线和成片时长。使用 \`read_project\`、\`transcribe_track\`、\`view_timeline_frames\` 逐段核对素材内容。
2. **话题分析与时长确定**：判断素材包含多少个话题，区分核心话题与次要内容。
3. **内容组织**：开头直接呈现最重要的新闻结果/核心结论/最新进展/关键现场画面，不铺垫。
4. **剪辑执行**：按保留/删除规则筛选，讲话按语义完整切割。
5. **音频只保留目标新闻素材原声**：开始编辑前只把用户明确指定/选中的新闻素材及其原始现场声列入允许来源；未明确指定时只采用活动时间线上已存在的新闻画面与现场声。媒体池里的 BGM、音效、配音、旁白和其他未选素材即使早已存在，也不得进入允许来源。
6. **终检**：逐段回放核对事实忠实、讲话语义完整、剪切点衔接自然。

## 话题分析与时长确定

- 原则上一条成片只围绕**一条核心新闻主线**展开。
- 若素材中存在多个相互独立的话题，优先选择**新闻价值最高、信息最完整、画面最充分**的话题进行剪辑；**不要将无关话题强行拼接**在同一条视频中。
- 成片时长不做固定限制，根据以下因素自动确定：
  - 核心新闻的信息量；
  - 有效人物讲话的长度；
  - 事件发展阶段和最新进展；
  - 关键现场画面的数量；
  - 保证新闻语义完整所需要的时长。
- 信息较少时应**缩短成片**，避免为了延长时长加入无关内容；信息较多时可以适当延长，**不能为了压缩时长而剪断人物讲话、遗漏关键事实或破坏新闻逻辑**。

## 内容组织逻辑

成片开头直接呈现最重要的新闻结果、核心结论、最新进展或关键现场画面，不使用冗长铺垫。整体按照以下逻辑组织：

1. 发生了什么；
2. 目前有哪些最新进展；
3. 最终结果、后续影响或相关回应。

若新闻事件尚未结束，应以**当前已经确认的最新进展收尾**，不得自行推测结果。

## 内容保留规则

优先保留以下内容：

- 新闻事件的核心事实；
- 时间、地点、人物和事件结果；
- 最新进展及权威回应；
- 重要人物具有实际信息量的讲话；
- 新闻现场、采访、发布会、监控画面及相关有效素材；
- 能够直接说明事件经过、结果或影响的关键画面。

所有保留内容必须服务于核心新闻主线。

## 内容删除规则

删除以下内容：

- 广告和商业推广；
- 节目宣传、频道包装及片头片尾；
- 主持人寒暄和无信息量的串场；
- 重复表述和重复画面；
- 无效停顿、口头语及明显空白；
- 与核心事件无关的冗长背景；
- 不影响新闻理解的次要内容；
- 无法验证、表意模糊或容易造成误解的片段。

## 人物讲话剪辑规则

- 人物讲话必须保持**语义完整**。
- 优先在以下位置切割：
  - 一个完整句子结束后；
  - 人物自然停顿处；
  - 讲话内容发生明显转折处；
  - 镜头自然转场处。
- **不得**从一句话中间强行切断，**不得**只保留部分表述导致原意改变，**不得**将不同时间、不同语境下的讲话错误拼接。
- 若一段讲话较长，可删除其中重复、空泛或无关的句子，但保留下来的内容必须能够**独立表达完整意思**。
- 使用词级编辑工具（文字稿）按词删改，保证落点落在完整句子边界。

## 事实与逻辑要求

剪辑必须忠于原始新闻素材，不得：

- 改变人物讲话原意；
- 夸大或弱化事实；
- 将不同事件错误关联；
- 通过镜头拼接制造虚假因果关系；
- 将推测性内容表达为确定事实；
- 使用与新闻事件不对应的画面误导观众；
- 为追求节奏而删除必要的前因后果。

## 音频要求

- **不得新增**任何背景音乐、配音、旁白、音效、转场音效或其他外部声音。
- 只保留原始素材中与新闻内容直接相关的人声和必要的现场声音。
- 删除广告音乐、节目包装音乐以及与核心新闻无关的声音。
- 处理剪切点时应保证原始人声衔接自然，避免突然截断、重叠、爆音或明显音量跳变（用 \`edit_item\` 的 fadeInSeconds/fadeOutSeconds 微调剪切点即可，不用加音乐）。

## 整体风格

- 客观、正式、紧凑、清晰的信息型新闻风格。
- 剪辑节奏由新闻内容决定，不刻意追求固定时长或高频切镜。
- 保证每一个保留片段都有明确的信息价值，在内容完整的前提下提高信息密度。
- 不添加花字/滤镜/转场特效；可用基础叠化避免硬切，但以新闻克制为原则。

## OpenChatCut 工具对应

- \`read_project\` / \`read_timeline\`：先读工程与时间线状态，按上述范围记录允许来源的 \`sourceAssetId\` 与 \`src\`；禁止把媒体池全部资产自动列入。
- \`transcribe_track\` + 文字稿词级编辑：讲话语义完整切割、删口头语/重复。
- \`view_timeline_frames\`：核对画面内容与关键现场。
- \`edit_item\`（trim / ripple delete / fade）与 \`split_item\`（split）：按保留/删除规则剪辑并处理剪切点衔接。
- \`edit_track\`：需要多轨整理时创建、调整或收紧人声轨与现场声轨。
- 输出前再次 \`read_project\`，确认所有最终 \`video\` / \`audio\` 项均来自允许来源，且没有 BGM、音效、配音或旁白，再用预览/导出预检核对时长与内容完整性。

## 参考文件

- 执行成片时遵循固定的确定性流程与强制性验收清单，见 [references/deterministic-execution-and-acceptance.md](references/deterministic-execution-and-acceptance.md)：环境检查 → 素材解析 → 生成单条编辑方案 → 一次性执行 → 逐项终检验收（至少 1 个视频轨片段、成片后无新增外部音频、讲话语义完整、剪切点衔接自然）。

`,T=`# News Rough Cut — 确定性执行模板与验收清单

> OpenChatCut-native 参考。借鉴了行业确定性剪辑工作流的通用做法（环境检查 → 素材解析 → 生成单条确定性编辑方案 → 一次性执行 → 强制验收）。
> 符合本技能 SKILL.md 的规则：忠实原素材、不加任何外部声音、讲话按语义完整切割、新闻客观克制的风格。

## 一、执行顺序（固定序列，不要跳步）

1. **环境与素材检查（前置，必做）**
   - 用 \`read_project\` / \`read_timeline\` 确认当前工程与时间线存在、存在目标素材片段。
   - 建立允许来源清单：只记录用户明确指定/选中的新闻素材及其原始现场声的 \`sourceAssetId\` 与 \`src\`；未明确指定时，只纳入活动时间线上已存在的新闻画面与现场声。媒体池里的 BGM、SFX、配音、旁白和其他未选素材一律不纳入。
   - 用 \`transcribe_track\` 拿词级文字稿；若某轨不可转写，先解决素材可达性，再继续。
   - 用 \`view_timeline_frames\` 核对关键画面与素材内容。
   - 前置不通过 → 停下并报告缺什么，不要假装完成。

2. **素材解析与主题判定**
   - 识别：新闻事件 / 核心话题 / 关键人物 / 重要结论 / 有效画面。
   - 判定话题数量：一条成片只围绕一条核心新闻主线；多话题时选新闻价值最高、信息最完整、画面最充分者。
   - 确定成片时长上限（由信息量与有效讲话长度决定，不设死板固定值）。

3. **生成编辑方案（先规划，后动手）**
   - 按「保留 / 删除」规则产出**一个明确的编辑计划**：要保的片段（含句边界）、要删的口头语/重复/广告、要微调的剪切点。
   - 原则：开头直给结论/最新进展/关键画面；讲话只在完整句结束/自然停顿/明显转折/镜头转场处切割。
   - 这一步产出"确定性方案"，不是让用户在每一步都拍板——方案一次成型。

4. **一次性执行**
   - 用 \`edit_item\` 的批量更新/删除落成 trim、ripple delete 与 fade；需要切开片段时调用 \`split_item\`。
   - 讲话切割必须落在完整句子边界（用词级文字稿保证）。
   - **不新增**任何 BGM / 旁白 / 音效 / 转场音效；不得从媒体池添加允许来源清单之外的 \`video\` / \`audio\`，即使该资产在编辑前已存在。

5. **终检验收（强制性，见下）**
   - 再次 \`read_project\`，逐项比对所有最终 \`video\` / \`audio\` 的 \`sourceAssetId\` / \`src\` 与允许来源清单；同一允许来源的 trim、split、move 合法，任何未选来源（包括新增视频中携带的声音）均不合法。
   - 逐段回放核对：事实忠实、讲话语义完整、剪切点衔接自然、无爆音/突兀截断。

## 二、强制验收清单（成片必经，逐项过）

| 验收项 | 判定 | 不通过时 |
|---|---|---|
| 工程存在且可读取 | \`read_project\` 成功返回当前活动工程 | 停止，报告工程读取失败原因 |
| 至少 1 个视频轨片段 | 时间线上有被保留的画面片段 | 说明无有效画面，未成片 |
| 成片长度与信息量匹配 | 没有为凑时长硬加无关内容；也没有为压缩剪断讲话/关键事实 | 重新平衡时长与内容 |
| 开头直给核心 | 首段是结论/最新进展/关键画面，无冗长铺垫 | 调整开头 |
| 讲话语义完整 | 每段保留讲话都能独立表达完整意思，无"一句话中间切断" | 修正切割点 |
| 无外部声音 | 所有最终 \`video\` / \`audio\` 均属于用户选定的新闻素材/原始现场声允许来源；媒体池中原有但未选的 BGM、SFX、配音、旁白也不得使用 | 移除未选来源片段并重新验收 |
| 剪切点衔接 | 无突兀截断、重叠、明显音量跳变；可用 fadeInSeconds/fadeOutSeconds 微调 | 加 1-2 帧淡入淡出 |
| 事实与逻辑 | 不改变原意、不夸大弱化、不错误关联、不把推测当事实、不用错配画面 | 回退到原素材重剪 |

## 三、与 SKILL.md 工具对应

- \`read_project\` / \`read_timeline\`、\`transcribe_track\`、\`view_timeline_frames\`、\`edit_item\`（trim / ripple delete / fade）、\`split_item\`、\`edit_track\`。
- 验收里的"无新增音频"必须以首次建立的选定素材允许来源与最终 \`read_project\` 做比对，不能把整个媒体池当作基线，也不能按 audio 轨片段数量判断。

## 四、失败恢复

- 任一验收项不通过 → 回退到「生成编辑方案」步骤重新规划（并非从头，而是定位到违反规则的环节）。
- 若时间线被改坏，允许引用项目的撤销/历史回到执行前状态再重跑。
- 全部验收通过后，才报告"成片完成"并给出成片时长、保留片段数、剪切点数量等可复核结果。
`,E=`---
name: openchatcut-plugin-basics
description: "Use for video editing or video creation work that should be editable in OpenChatCut, even when the user does not explicitly mention OpenChatCut. Covers local/attached video editing, captions/subtitles, transcription, trimming, talking-head cleanup, highlights, B-roll, overlays, generation, export, project/editor opening, importing, targeting, verifying, watching, and identifying the active OpenChatCut project/editor URL."
---

# OpenChatCut Plugin Basics

## Purpose

Use this as the base operating context whenever the agent works on a OpenChatCut project.

This skill provides the common OpenChatCut project model, editing operating context, project onboarding flow, editor handoff rules, and agent boundaries. It does not provide detailed tool parameters, full task playbooks, or generation prompt recipes; load the matching OpenChatCut skill and use tool schemas for task-specific workflows.

### Tool surface

Tools are called directly by name in this build (no MCP server, no \`mcp__\` prefix, no OAuth). The tool schemas in context are the runtime contract.

Do not bootstrap, install, or register MCP surfaces from this skill; there are none in this build.

In no-source validation, do not inspect OpenChatCut source code to learn parameters or hidden behavior. Use the tool schemas, these skills, and project/editor state.

## Role

When working in OpenChatCut projects, act as a professional video editing assistant. The user thinks in clips, cuts, stories, and visible outcomes, not data structures. Use video-editing judgment to clarify needs, recommend a concrete strategy, and execute the requested edit.

Align on needs and concrete strategy before creative or strategic work that shapes the output: video use case, content form, output format, source-material strategy, creative direction, or editing approach. Mechanical operations such as renames, small property changes, obvious undo, and user-specified item edits can execute directly.

## Your Environment

OpenChatCut is a browser-based multi-track non-linear video editor. A project holds one or more timelines, each with its own canvas (fps, width, height), video tracks, audio tracks, timeline items, and a shared asset library.

This build is local and single-user. Project tools can list/create/target projects directly; project-scoped tools should use the project id from those tool results or from the editor URL.

Tool calls write through the editor's state and persistence layer (project store + local media store), so editor changes should be real and visible. Do not infer hidden IDs; read them from \`read_project\` or adapter tool results. A project-specific lookup failure almost always means a wrong id — re-read it from the editor URL or \`list_projects\`.

The preview surface is the live OpenChatCut editor. The user can have the project open while the agent works. Project changes should become visible in the editor; the visible editor is part of the user experience, not just a proof surface.

The agent works from project data, tool results, transcripts, assets, and composed timeline proof. Do not assume the browser view, project state, or timeline layout is still the same after time has passed; the user may have edited the project manually.

Visual understanding has two distinct surfaces:

- To inspect raw imported or attached source media, use \`view_asset_frames\` on the asset id. Do not create a temporary timeline just to inspect source assets.
- To inspect media as it currently appears on the OpenChatCut timeline or editor, use \`view_timeline_frames\`. This includes placed clips, trims, crops, captions, overlays, effects, and final framing.

For export, use the \`export\` skill: \`submit_export\` (or \`submit_render_job\` for async), then \`track_export\` when needed, and hand the user the returned download path.

## Data Model

### Project

A project is the top-level container. It owns a shared asset library and one or more timelines. Each timeline defines its own canvas and contains tracks, items, and timeline-local structure.

Unless the user says otherwise, edits should target the intended active or targeted project and timeline. If the target is ambiguous, establish the project before doing nontrivial work.

### Assets

Assets are source media in the project library. One asset can be referenced by many timeline items.

Agent-facing asset types include video, audio, image, gif, motion-graphic, and svg. Content-level properties such as source media, filename, remote readiness, and Motion Graphic code/properties belong to the asset.

If the user asks to use, edit, place, replace, caption, trim, inspect, or otherwise work with an asset but does not attach or explicitly provide the source, do not immediately treat it as missing. Users can upload media directly in the OpenChatCut editor, so first inspect the targeted project's asset library with \`read_project\` \`view: "assets"\` and match by filename, type, visible content, transcript state, or other available metadata. Ask the user to upload or provide the asset only when it is not present, not ready, inaccessible, or ambiguous after checking project assets.

### Tracks

Tracks are lanes on the timeline.

Video tracks stack. Higher video tracks render above lower tracks; an item on an upper track covers lower video during its duration, and lower video shows through where the upper track is empty. If audio continues while no video item is visible, the rendered canvas can show black.

Audio tracks mix in parallel. Audio tracks do not cover each other; multiple audio tracks playing at the same moment are audible together.

Items on the same track must not overlap. Locked tracks should not be edited until the user unlocks them.

Sequential clips belong on the same track in increasing time order. Layered visuals such as overlays, B-roll, and Motion Graphics belong on higher video tracks above the content they cover.

### Items

Items are timeline instances of assets. Each item references an asset and owns placement and timing.

Change an item to change when or where something appears: timeline start, duration, track, position, size, opacity, fades, source offset, or playback speed. Change an asset to change reusable source content, Motion Graphic code, or Motion Graphic property defaults.

Timeline placement and duration are frame-native. User-facing summaries may use seconds, but timeline edits should preserve exact frame state from project data when available.

Motion Graphics follow the same split: visual code and editable properties belong to the asset; timing, position, size, and per-instance property overrides belong to the item.

### Editing operations - defaults and ripple

Timeline edits leave gaps by default.

Deleting an item removes it without automatically moving later items unless ripple behavior is explicitly used. Shortening an item leaves a gap; later items must be moved intentionally if the gap should close. Adding into an occupied same-track range is rejected unless the edit makes room.

Ripple affects only the same track. After ripple or other structural edits, related tracks such as captions, Motion Graphics, B-roll, and music may no longer align with the edited speech or video and should be checked.

On overlap conflicts, first decide whether the content is sequential or layered. Sequential content belongs in time order on the same track. Layered content belongs on a higher video track.

## Alignment & Execution

### How to Align Before Acting

Understanding the user's intended outcome is the foundation of creative editing. Clarify before committing to creative or strategic choices.

Alignment calibrates to how much the user has already given:

- "Make a 1-minute YouTube cut of this interview" gives platform and length, but may still need confirmation on what to keep.
- "Cut this podcast into highlights" is vague; align on target platform, length, and what counts as a highlight.
- "Make a promo for our app" with a product URL but no brand assets may need alignment on logo/assets, platform, aspect ratio, duration, production approach, and tone.
- "Add English subtitles" is clear and narrow; execute.
- "Make it shorter" or "keep going" after prior alignment usually does not need a new alignment round.
- "Make a promo video for my product" without product type is ambiguous; clarify product type, target platform, and use case before choosing a scenario.

### When to align

Align when the request involves a new project, vague creative intent, time-consuming generation with missing creative details, multi-shot or multi-asset consistency, or a major fork such as voiceover versus music-only, cinematic versus casual, what to keep, or which features to highlight.

For dependent major steps, confirm the foundation before building downstream work when practical. Motion Graphics, music, and captions depend on the speech/structure edit; image and video generation depend on the approved script or direction.

### When to skip

Proceed without a new alignment round when the user already gave a clear brief with target, style, and constraints; the task is mechanical and reversible; the user said to continue; the user gave a follow-up correction; or the user explicitly asked to run end-to-end.

### How to align well

Ask only for load-bearing information. Do not run a fixed checklist. Do not ask for information the agent can determine from project state, assets, transcript, or visual proof. The user should answer only preferences, requirements, or missing materials that are actually theirs to decide.

When structured input would reduce friction, load the \`widget-forms\` skill and call \`ask_followup_questions\` instead of sending a long multi-question paragraph. Do not include media upload as a form question; ask for missing source media separately through the editor upload panel or \`download_media\` (see \`asset-import\`). Do not emit raw internal OpenChatCut chat tags directly to the user.

Establish a sample before batching related creative outputs when style consistency matters.

## Verify Before Modifying

Before changing timeline items, tracks, or assets, read the current project state when it may be stale or unknown. The user may have changed the project manually in the browser since the last turn.

Do not rely on stale item ids, track layout, asset readiness, transcript state, or previous timeline placement when making project-scoped edits.

\`read_project\` with \`view: "timeline"\` inspects tracks, item IDs, fps, source ranges, and current placement. \`read_project\` with \`view: "assets"\` inspects asset IDs, local-only/cloud readiness, media metadata, and transcript state.

## Do Only What Was Asked

Execute the user's request, then stop. Do not silently add unrequested music, captions, transitions, B-roll, color grading, or other enhancements. Suggest additions when useful, but do not perform them without user intent.

At editing checkpoints, prioritize the live OpenChatCut project as the review surface. Do not turn a checkpoint into an export just because the timeline changed. Export only after the user asks for export/render/download/final delivery, after all planned editing stages are approved and the current step is final delivery, or when the user requested a standalone deliverable and no further review checkpoint is pending.

Do not infer export intent from broad editing requests such as "edit this video", "cut this down", "clean this up", "make a version", or similar phrasing. By default, a OpenChatCut editing request delivers an editable timeline for review, not a downloadable MP4. Agent verification is not user approval; after verification, keep the live project available and let the user decide whether to continue editing or export.

When reporting a reviewable edit, pair the concise result summary with a natural next step based on the visible surface. If the editor is open or available, it is appropriate to mention that the user can click Play in the editor to watch the result; phrase it conversationally and contextually, not as a fixed approval script.

For a OpenChatCut review checkpoint, "project", "version", "cut", "montage", or "put it in OpenChatCut" means an editable OpenChatCut timeline unless the user explicitly asks for a standalone finished file. Do not satisfy a OpenChatCut editing request by locally rendering one flattened MP4 and placing only that finished MP4 on the timeline. For multi-source work such as B-roll, highlight reels, or travel montages, build from original sources in OpenChatCut timeline items with trims, source offsets, ordering, layers, captions, audio, and effects. Use judgment on sequencing and scope; do not make local source screening a mandatory step before import when obvious or likely-needed originals can be uploaded while inspection continues. A flattened clip may be an extra reference only after the editable timeline exists, not the primary deliverable.

## How You Think About Editing

Start from the project context: what assets exist, where they are on the timeline, what is said, and what the viewer sees and hears. Go deeper only when needed.

Editing has a natural order: get the structure right first, then refine timing, then add finishing touches. Doing this out of order creates rework because captions, Motion Graphics, B-roll, and music depend on the final structure.

Think in terms of what the viewer sees and hears, not just individual tracks.

Before reporting done, verify the actual result. For timeline edits, check that the intended items changed and that no unintended gaps, overlaps, or misplaced layers remain. After significant structural edits, check dependent elements such as captions, Motion Graphics, B-roll, and music. For generated or visual work, inspect an actual composed result before claiming it looks correct.

## Design Style Consistency

A Design Style is the project's visual identity: colors, fonts, style guidance, and real logos or reference images. It mainly shapes Motion Graphics and can also influence other on-screen text such as captions.

When work spans several related visual outputs, align on or follow one coherent design style before batch production so the project reads as one family. Do not lock in a design style from an unconfirmed guess.

Skip design-style work for one-off quick fixes unless the user asks for it. A single lower-third or small overlay is not automatically a project-wide design-style decision.

## Project Onboarding And Editor Handoff

### Establish the target project

Before nontrivial OpenChatCut work, ensure the agent is operating on the intended project.

"Switch project" means create or target a different OpenChatCut project, not a new timeline, unless the user explicitly says timeline or version.

First action for a new OpenChatCut task: use \`list_projects\`, \`create_project\`, \`target_project\`, or \`get_editor_url\`. Do not start by debugging the repo or opening external browsers.

1. If the user asks for a new project, call \`create_project\` and surface the live project card/link immediately so the user can open it and watch progress.
2. If the user asks to use OpenChatCut for attached media, imported files, filler removal, captions, export, or motion graphics and no project is targeted, create or target the project before long analysis, generation, transcription waiting, or clarification that is not required to choose the project.
3. For a generic new job ("my videos", attached files, imported files, "use OpenChatCut for this") create a fresh project shell unless the user names an existing project, the prompt clearly says to continue/switch to an existing project, or an existing editor URL/context clearly identifies the active project. Do not pick a plausible-looking existing project from \`list_projects\` just because its name matches the task category.
4. If the user refers to an existing project and no project is targeted, call \`list_projects\`, choose the intended accessible project, then call \`target_project\`.
5. If the user asks to duplicate/copy a whole project (safety copy before risky edits, a language or variant version), call \`duplicate_project\`. It defaults to the currently targeted project. To edit the copy afterwards, pass the returned \`newProjectId\` as \`projectId\` explicitly on subsequent tool calls — an explicit per-call \`projectId\` always wins over session targeting. Pass \`activate: false\` to keep the source targeted. Owner-only; markers and chat history are not copied. For a variant of one cut inside the same project, use \`manage_timelines\` \`action: "duplicate"\` instead.
6. If the user asks to delete a project, call \`delete_project\` with an explicit full projectId — it never defaults to the targeted project. This is the dashboard's soft delete: data is retained and \`restore_project\` undoes it; \`list_projects\` with \`includeDeleted: true\` shows restorable projects.

### Use the current editor project

If a OpenChatCut project is already available from an editor URL, read the \`projectId\` from the \`/editor/<projectId>\` URL and pass it directly to project-scoped tools.

There is no authentication in this build; a project-access failure means the id is wrong — re-read it from the editor URL.

### Open the visible editor

Opening or surfacing the editor early is part of the user experience: the user can watch the NLE, media pool, transcription, generation, and timeline placement while work continues. Prefer showing a visible OpenChatCut surface over leaving it closed.

\`list_projects\` is discovery, so it should not pick or retarget to one listed project unless the user chose it or the active context clearly identifies it. Once a specific project is created, targeted, or chosen for visible work, surface the editor link (\`#/editor/<projectId>\`, from \`get_editor_url\`) so the user can open it and watch progress. The editor and the agent chat live in the same browser app; there is no browser-handoff or boot-token machinery in this build.

### Keep the visible editor aligned

The visible editor is a live workbench, not a one-time proof. Before long-running visible work such as import, transcription waiting, generation, timeline assembly, export preparation, or final visual verification, it should still match the latest project id. If the visible surface is unavailable or on a different project, open or surface the current editor URL once before falling back to the card/link.

### External provider docs

If a third-party provider docs URL is needed (API key setup, model limits), present it as a normal external link.

## Agent Boundaries

Project-scoped operations should use project ids from tool results, editor URLs, or current project state. Do not guess hidden ids.

The agent cannot read the user's local filesystem, and cannot make the editor UI pick, relink, upload, export, or capture local files on its behalf. Media enters the project through:

- The editor upload panel (drag & drop / upload button) for the user's local files.
- \`import_media\` for placeholder-first registration and direct-upload sessions.
- \`download_media\` for public URLs.

If the user references a local file the agent cannot reach, ask them to drop it into the editor — do not attempt workarounds.

For raw source-frame inspection, use \`view_asset_frames\` with the project asset id. Reserve \`view_timeline_frames\` for composed timeline proof.

Do not flatten media outside the editor: user-visible edits must remain editable OpenChatCut project state — source assets plus timeline items, trims, captions, audio items, overlays, effects — with OpenChatCut export when a rendered file is needed. \`run_code\` sandbox ffmpeg is for read-only probing and diagnostics of fetched media, not for producing a pre-composited deliverable.

If an edit changes spoken words, pauses, retakes, or transcript selection, use the Script-based speech editing workflow through the relevant OpenChatCut skill rather than physical timeline deletion as the main edit method.

For agent-authored Motion Graphics, use the OpenChatCut Motion Graphic code workflow (\`create_motion_graphic_from_code\` / asset code updates). Do not stage Motion Graphic JSX anywhere outside those tools.

Use the relevant OpenChatCut task skill for detailed workflows such as media import, transcription, talking-head editing, Motion Graphics, verification, export, generation, product help, and error recovery.
`,D=`---
name: product-ad-video-script
description: Turn a product into ad angles, hooks, scenes, and CTA.
---

# Product Ad Video Script

Use this workflow when the user wants to turn a product, landing page, offer, screenshot, or rough idea into a short ad video plan and script.

Use this workflow to plan the ad first, then execute only the assets and edits the chosen script actually needs.

## When to Use

- The user provides a product, product page, app, feature, screenshot, or offer.
- The user asks for ad copy, hooks, UGC script, promo video, product reel, launch video, or short-form marketing video.
- The task needs angles, scene structure, captions, CTA, and visual treatment.

## Workflow

1. Read the product context: what it is, who it is for, core benefit, proof, offer, limitations, and required claims.
2. Extract or infer the customer problem, desired outcome, objections, and strongest differentiator.
3. Pick or propose 2-4 ad angles using [references/ad-script-framework.md](references/ad-script-framework.md).
4. For the chosen angle, write a concise video structure: hook, problem, demo or proof, benefit, objection handling, CTA.
5. Map each beat to required visuals using product/page assets or user-provided media. Generate new visuals only when the script needs them.
6. Create the timeline or present the script first depending on the user's intent.
7. QA claims, readability, pacing, CTA clarity, brand fit, and whether the first seconds explain why the viewer should care.

## Rules

- Ground claims in the product page, user notes, or visible assets. Do not invent prices, guarantees, medical claims, revenue claims, or endorsements.
- Prefer clear benefits over feature lists.
- Keep hooks concrete and viewer-facing.
- If required information is missing and affects truthfulness or positioning, ask or label the assumption.
- Match the visual plan to what OpenChatCut can make now; do not prescribe external-only steps unless the user asks.
- Do not add transitions, effects, music, or voiceover unless the selected script calls for them.

## Output

For planning, show angle, target viewer, hook, script beats, visual plan, captions, CTA, and assumptions. For execution, also report what was added to the timeline.`,O=`# Evidence-Grounded Short-Video Ad Framework

Use this reference to turn verified product information into distinct ad angles, select the most defensible one, and map it to assets and an OpenChatCut timeline.

## 1. Build the product fact sheet

Record each fact with its source before writing hooks.

| Field | What to capture | Acceptable evidence |
|---|---|---|
| Product | Name, category, and what it does | User brief, product page, visible UI or packaging |
| Audience | Who it is explicitly for | User brief, page copy, documented customer segment |
| Problem | Friction the product addresses | Stated use case or directly observed workflow |
| Outcome | Concrete change the user can expect | Supported benefit, not an invented guarantee |
| Mechanism | Feature or process that creates the outcome | Visible interface, documented behavior, product media |
| Differentiator | Why this option is meaningfully different | Verifiable comparison or unique product behavior |
| Proof | Demo, measurement, testimonial, specification, or artifact | Supplied or visible evidence with usable rights |
| Offer | Price, trial, bundle, deadline, or availability | Current user-provided or product-page terms |
| Limits | Eligibility, conditions, exclusions, and uncertainty | Fine print, user notes, absent evidence |

Label every working statement:

- **Verified:** directly supported by a cited source or visible asset.
- **Observed:** visible in supplied media, but not necessarily a general product promise.
- **User-claimed:** provided by the user and attributed accordingly.
- **Assumption:** useful for planning but unverified; never present it as fact in the ad.
- **Unknown:** required information is missing; omit the claim or ask for clarification.

## 2. Define audience, problem, and outcome

Write one sentence for each:

- **Audience:** the narrowest viewer who will recognize the situation immediately.
- **Problem:** one costly, annoying, slow, risky, or confusing moment they already experience.
- **Outcome:** one visible or understandable improvement the verified mechanism can support.

A strong positioning line follows: **For this audience, the product changes this problem into this outcome through this verified mechanism.** If any element is an assumption, keep it out of final copy until confirmed.

## 3. Generate 2–4 distinct angle families

Choose genuinely different reasons to care, not minor rewrites of one hook.

| Angle family | Core question | Best evidence |
|---|---|---|
| Problem–solution | “Tired of this recurring friction?” | Before/after workflow, pain demonstration |
| Product demonstration | “Can it actually do the key job?” | Screen recording, product handling, result reveal |
| Outcome-led | “What changes after using it?” | Supported result, time/process comparison, finished artifact |
| Differentiator or objection | “Why this instead of the obvious alternative?” | Side-by-side behavior, specification, transparent limitation |

Do not force all families. Discard any angle that depends on unavailable proof, an unsupported comparison, or a claim too qualified to communicate clearly.

## 4. Score and select the angle

Score each candidate from 1 (weak) to 5 (strong).

| Criterion | Selection test |
|---|---|
| Evidence strength | Can every important claim be traced to a source or visible proof? |
| Audience relevance | Will the intended viewer recognize the problem or desire quickly? |
| Hook clarity | Is the value understandable without setup or jargon? |
| Visual demonstrability | Can available assets show rather than merely assert the claim? |
| Distinctiveness | Is this meaningfully different from the other candidates? |
| CTA fit | Does the promised next step naturally follow from the angle? |
| Safety | Can it run without prohibited, misleading, or overbroad claims? |

Prefer the highest defensible total, not the most sensational hook. Break ties with evidence strength, then visual demonstrability. Record why the winner beat the alternatives and which assumptions remain.

## 5. Hook rules

- Lead with the viewer’s situation, a visible result, a credible surprise, or the product in action.
- Communicate one idea in the first beat; avoid stacked benefits.
- Make the hook understandable with sound off using a concise caption or visual action.
- Match the hook to what the next beat proves; no bait-and-switch.
- Use specifics only when verified. Avoid fake urgency, absolute superiority, guaranteed outcomes, and invented social proof.
- Keep qualification close to the claim when it changes the claim’s meaning.

Useful structures include: **recognizable problem → consequence**, **result → how**, **product action → payoff**, and **common objection → evidence-backed answer**.

## 6. Build the beat map

Use 4–7 beats; duration follows comprehension and available evidence rather than a rigid formula.

| Beat | Job | Typical visual evidence |
|---|---|---|
| Hook | Earn attention and state why the viewer should care | Result first, problem moment, decisive product action |
| Context | Identify the viewer and situation | Relevant environment, interface state, concise caption |
| Mechanism | Show what the product does | Screen recording, product shot, annotated action |
| Proof | Support the promised value | Live demo, artifact, measured comparison, attributed quote |
| Benefit | Translate the mechanism into the supported outcome | Before/after sequence, reduced steps, completed result |
| Objection | Resolve the most likely credible hesitation | Condition, limitation, workflow detail, differentiator |
| CTA | Ask for one proportionate next action | Product view, URL or handle supplied by user, offer terms |

Each beat should advance the argument. Remove repeated claims, decorative scenes without a job, and any beat the available assets cannot support.

## 7. Choose proof and demo options

Use the strongest evidence available:

1. **Direct demonstration:** show the action and result in one continuous or clearly sequenced flow.
2. **Interface walkthrough:** show the relevant control, state change, and output; crop only for clarity.
3. **Artifact proof:** reveal the actual output, package contents, report, or completed work.
4. **Measured comparison:** show units, method, conditions, and source; avoid implying universal results.
5. **Attributed testimony:** use only supplied, authorized wording; do not upgrade an opinion into a fact.
6. **Specification proof:** display the verified feature or material and explain why it matters.

Editing can clarify evidence but must not fabricate causality, conceal a material condition, or turn separate events into a false continuous demonstration.

## 8. Handle one objection

Select the objection most likely to block the CTA: trust, effort, fit, price, learning curve, compatibility, or limitation. Answer it with evidence or a transparent condition. If no supported answer exists, omit the rebuttal or state the limitation plainly; do not invent reassurance.

## 9. Write a proportionate CTA

Ask for one action that matches the viewer’s evidence level: learn more, view the product, compare details, try an available feature, or use a verified offer. Include deadlines, prices, eligibility, and availability only when current and sourced. Never manufacture scarcity.

## 10. Map evidence to OpenChatCut

For every spoken or on-screen claim, identify:

- source and label: verified, observed, user-claimed, assumption, or unknown;
- supporting asset: supplied video, image, screen recording, product/page capture, text, or audio;
- timeline treatment: trim, crop, caption, callout, side-by-side, freeze, speed change, or simple transition;
- readability need: caption length, contrast, safe placement, and enough hold time;
- integrity check: the edit preserves order, scale, conditions, attribution, and limitations.

Use existing assets first. Request or create only media required by the chosen script. Do not add unsupported logos, endorsements, results, interface states, or synthetic “proof.”

## Claim safety gate

Before approval, verify that every material claim is sourced, appropriately qualified, and visually honest. Reject or rewrite claims involving guaranteed results, health or financial outcomes, superiority, endorsements, pricing, scarcity, or quantified performance unless the evidence explicitly supports the exact wording and context. Preserve user-provided legal or brand constraints.

## Output template

- **Fact sheet:** product; audience; problem; outcome; mechanism; differentiator; proof; offer; limits; source and label for each.
- **Angle candidates:** 2–4 family names, viewer insight, hook, required proof, key assumption, and scorecard totals.
- **Selected angle:** choice, evidence-based rationale, rejected alternatives, and unresolved assumptions.
- **Script:** beat number; purpose; voiceover or dialogue; on-screen text; evidence source; estimated duration.
- **Visual plan:** asset; in/out range or still; timeline treatment; claim supported; integrity note.
- **Objection and CTA:** objection, supported response, single next action, and verified offer conditions.
- **Final QA:** first-beat clarity; sound-off comprehension; claim traceability; proof visibility; pacing; CTA clarity; brand and safety constraints.
`,k=`---
name: product-help
description: |
  OpenChatCut product knowledge — UI layout, editor features, and how generation providers are configured.
  Use when the user asks about the product interface, how to use a feature, where to find something, or needs GUI guidance for something the agent cannot do directly.
  Also use as fallback when a task fails and the user needs to complete it manually in the UI.
  NOT for live project-state queries ("where are my folders?", "what's on my timeline?", "where is clip X?") — those are answered by \`read_project\`, not by this skill.
user-invocable: false
---

# OpenChatCut Product Help

Product knowledge base for answering user questions and guiding GUI operations.

## When to Use

- User asks about the product, a feature, or how something works
- User asks how to configure AI providers / API keys
- User needs to perform a GUI action that the agent cannot do directly
- A task fails and you need to guide the user through manual steps as a fallback

## Reference Files

Read the relevant file on demand — do NOT read all files at once.

| Question about | File |
| --- | --- |
| Product UI, layout, panels, buttons, features | \`references/ui-and-features.md\` |
| API keys, providers, which features need a key | \`references/providers-and-keys.md\` |
| What generation models/tools are wired | \`references/generation-capabilities.md\` |
| Official generation API documentation | \`references/generation-official-docs.md\` |

## Guidelines

1. **Try to do it first.** If the task is something you can handle (adding captions, changing aspect ratio, etc.), do it. Only guide GUI operations as a fallback.
2. **Use visible UI names.** When guiding manual operations, give clear numbered steps with labels and panel locations that are confirmed in the references. If the user says they cannot find an entry, re-anchor from major visible regions such as the AI panel, top bar, asset/library panels, and timeline.
3. **Missing keys.** If a provider is not configured, say which key is missing and how to set it in Settings.
4. **Generation confirmations.** Some generation tools may show an in-app confirmation (skill guard / proposal) before running.
5. **Provider costs.** If the user asks about cloud cost, point them at their provider dashboard; do not invent rates.
`,A="# Generation capabilities (as wired)\n\nShort map of cloud generation tools → providers. Use this when guiding setup or choosing a model. Exact availability is always the live **capabilities** block in the agent prompt.\n\n## Video · `submit_video`\n\n| Model | Provider | Wired highlights |\n| --- | --- | --- |\n| `seedance2` | Volcengine Seedance | T2V / I2V / first+last / multi-ref; 2–15s; **480p–4k**; audio/seed/camera/watermark/last-frame/expiry/priority |\n| `kling` | Kling Omni | T2V / I2V / first+last; images ≤7 (≤4 with video); **1× refVideo** `feature`\\|`base`; multi-shot customize/intelligence; 3–15s; std/pro |\n| `hailuo` | MiniMax | T2V / I2V / first+last; **6\\|10s**; 512P (Hailuo-02), 720p→768P, 1080P→6s; optimizer controls; **S2V-01** subject |\n| `grok-imagine-video` | xAI Grok Imagine | T2V only; **1–15s**; 480p/720p/1080p; audio track included; no refs/frames/edit |\n\n**Not wired:** Kling element library / voice bind; provider callback URLs; arbitrary third-party generation endpoints.\n\n## Image · `submit_image`\n\n| Model | Notes |\n| --- | --- |\n| `gpt-image-2` | Text + refs (≤16); custom dimensions, mask, background, moderation, fidelity, PNG/JPEG/WebP/compression |\n| `nano-banana` | Gemini; best multi-ref (≤14) |\n| `image-01` | MiniMax; one subject ref via R2; custom dimensions, count ≤9, prompt ≤1500, seed, optimizer default false |\n| `grok-imagine` | xAI Grok Imagine; text-to-image; ≤4 outputs; aspect set 1:1/16:9/9:16/4:3/3:4/3:2/2:3; 1k/2k |\n\n## Voice · `submit_voice`\n\n| Provider | Notes |\n| --- | --- |\n| `doubao` | CN curated voices; speedRatio, emotion, emotionScale, pitch (ffmpeg), dialect, performancePrompt |\n| `elevenlabs` | Curated multilingual voices; complete voice settings, continuity/dictionaries, seed, normalization, logging/latency and official output formats |\n| `minimax` | Curated system voices; voice/audio settings, language/normalization, pronunciation, timbre mix, voice modify/effects, subtitles |\n| `inworld`, `fishaudio`, `speechify` | Account/provider voice ID plus optional model ID only; no bundled OpenChatCut samples |\n| `openai` | AI SDK speech; configured model defaults to `gpt-4o-mini-tts`; model/speed/output/instructions |\n| `gemini` | AI SDK speech; configured model defaults to `gemini-2.5-flash-preview-tts`; model/output/instructions |\n| `mistral` | AI SDK speech; configured model defaults to `voxtral-mini-tts-2603`; model/output |\n| `cartesia` | AI SDK speech; configured model defaults to `sonic-3`; model/speed/language/output |\n\nEvery provider is opt-in and requires a concrete provider-specific `voiceId`.\nOnly Doubao, ElevenLabs, and MiniMax have curated choices in the voice skill;\nnever invent samples for the other providers. `submit_voice` creates a media-pool\nasset only and does not place it on the timeline.\n\n## Transcription · `transcribe_track`\n\n`transcribe_track` uses the provider selected in Settings by default; AssemblyAI\nremains the default. Pass `provider` only when the user explicitly requests a\nconfigured override. Results are normalized before they are attached to clips,\nwith word/speaker detail preserved when the provider supplies it.\n\n| Provider | Configuration/default |\n| --- | --- |\n| `assemblyai` | `ASSEMBLYAI_API_KEY`; existing upload/job resume path |\n| `local` | On-device model selected in Settings; no cloud key |\n| `openai` | `OPENAI_API_KEY`; `OPENAI_TRANSCRIPTION_MODEL` defaults to `gpt-4o-mini-transcribe` |\n| `mistral` | `LLM_MISTRAL_API_KEY`; optional `LLM_MISTRAL_BASE_URL`; `MISTRAL_TRANSCRIPTION_MODEL` defaults to `voxtral-mini-latest` |\n| `deepgram` | `DEEPGRAM_API_KEY`; `DEEPGRAM_TRANSCRIPTION_MODEL` defaults to `nova-3` |\n| `groq` | `GROQ_API_KEY`; optional `GROQ_BASE_URL`; `GROQ_TRANSCRIPTION_MODEL` defaults to `whisper-large-v3-turbo` |\n| `elevenlabs` | `ELEVENLABS_API_KEY`; `ELEVENLABS_TRANSCRIPTION_MODEL` defaults to `scribe_v2` |\n| `cartesia` | `CARTESIA_API_KEY`; `CARTESIA_TRANSCRIPTION_MODEL` defaults to batch-capable `ink-whisper` |\n\n## Music · `submit_music`\n\n| Provider | Notes |\n| --- | --- |\n| `mureka` | Instrumental, lyrics-song, prompt-song, soundtrack from image/video, track/stem; count 1–3 and all official controls |\n| `minimax` | t2m plus cover via project audio or `coverFeatureId`; official audio settings |\n| `atlas` | Async t2m through Atlas Cloud; prompt/lyrics, instrumental mode, and schema-backed audio settings |\n\n## Sound · `submit_sound`\n\nElevenLabs sound-generation: optional duration 0.5–30, influence 0–1, loop (v2), and all official MP3/PCM/μ-law/A-law/Opus formats. Prefer library SFX first.\n\n## Keys\n\nSee [providers-and-keys.md](providers-and-keys.md). Configure in Settings or `.env.local`.\n\n## Checks\n\n`npm test` covers generation jobs plus video, image, music, voice, and sound validators.\n",j=`# Official generation API documentation

Use these primary sources when a provider changes. The server boundary must keep provider-only fields isolated rather than forwarding a shared superset.

## Image

- OpenAI Images generate: https://developers.openai.com/api/reference/resources/images/methods/generate/
- OpenAI Images edit: https://developers.openai.com/api/reference/resources/images/methods/edit/
- OpenAI GPT Image 2 model: https://developers.openai.com/api/docs/models/gpt-image-2
- Google Gemini image generation: https://ai.google.dev/gemini-api/docs/image-generation
- MiniMax text-to-image: https://platform.minimax.io/docs/api-reference/image-generation-t2i
- MiniMax image-to-image: https://platform.minimax.io/docs/api-reference/image-generation-i2i

## Video

- BytePlus ModelArk Seedance generate video: https://docs.byteplus.com/en/docs/modelark/1520757
- Kling developer quick start: https://app.klingai.com/global/dev/document-api/quickStart/userManual
- MiniMax text-to-video: https://platform.minimax.io/docs/api-reference/video-generation-t2v
- MiniMax image-to-video: https://platform.minimax.io/docs/api-reference/video-generation-i2v
- MiniMax first/last-frame video: https://platform.minimax.io/docs/api-reference/video-generation-fl2v
- MiniMax subject-reference video: https://platform.minimax.io/docs/api-reference/video-generation-s2v

## Music, speech, and sound

- Mureka API documentation: https://platform.mureka.ai/docs/
- MiniMax music generation: https://platform.minimax.io/docs/api-reference/music-generation
- MiniMax T2A HTTP: https://platform.minimax.io/docs/api-reference/speech-t2a-http
- ElevenLabs text-to-speech: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
- ElevenLabs sound effects: https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert

## Intentional transport choices

- OpenChatCut polls generation jobs, so provider callback URLs are not exposed to the agent.
- Provider streaming may be used only when the adapter can still persist a complete local asset. Mureka streaming phase is accepted but final files are polled. MiniMax TTS streaming is consumed server-side and persisted; MiniMax music uses non-streaming URL output.
- Seedance reference videos and MiniMax image subject references require provider-fetchable HTTPS URLs. OpenChatCut creates temporary signed R2 URLs and never exposes storage credentials.
`,M="# Providers & API Keys\n\nAI features that call the cloud need API keys, configured in:\n\n1. **Settings panel** (in-app), or  \n2. **`.env.local`** (server-side)\n\nIf a capability is off, say so and offer alternatives (upload, library, another configured vendor).\n\n## Capability → typical keys\n\n| Capability | Tools (examples) | Keys (any configured vendor is enough) |\n| --- | --- | --- |\n| Image gen | `submit_image` | `IMAGE_API_KEY` / OpenAI, `GEMINI_API_KEY`, `MINIMAX_API_KEY` |\n| Video gen | `submit_video` | `SEEDANCE_API_KEY`, `KLING_API_KEY`, `MINIMAX_API_KEY` (Hailuo), `LLM_OFOX_API_KEY` (OFox) |\n| TTS / voice | `submit_voice` | Provider-specific server key(s): Doubao, ElevenLabs, MiniMax, Inworld, Fish Audio, Speechify, OpenAI, Gemini, Mistral, or Cartesia |\n| Music | `submit_music` | `MUREKA_API_KEY`, `MINIMAX_API_KEY`, `ATLASCLOUD_API_KEY` |\n| Sound FX gen | `submit_sound` | `ELEVENLABS_API_KEY` |\n| Stock search | `search_stock_media` | `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `UNSPLASH_ACCESS_KEY`, `FREESOUND_API_KEY` |\n| Transcription | `transcribe_track` | The provider selected in Settings (or an explicit configured override): AssemblyAI (default), local, OpenAI, Mistral, Deepgram, Groq, ElevenLabs, or Cartesia |\n| Web | `web_browser` | `FIRECRAWL_API_KEY` |\n| Sandbox / ffmpeg helpers | `run_code` | `E2B_API_KEY` (if used) |\n| Social publishing | `publish_to_social`, `track_social_publish` | `UPLOAD_POST_API_KEY` + `UPLOAD_POST_PROFILE` (Upload-Post profile with the social accounts connected) |\n| LLM agent | chat | Configure one or more independent provider triplets: `LLM_<PROVIDER>_BASE_URL`, `LLM_<PROVIDER>_API_KEY`, and `LLM_<PROVIDER>_MODEL`. Supported provider tokens are `ANTHROPIC`, `OPENAI`, `GEMINI`, `KIMI`, `QWEN`, `GLM`, `DEEPSEEK`, `MINIMAX`, and `MISTRAL`. `LLM_PROVIDER` controls the initially selected chat provider. |\n\n## Speech provider configuration\n\nTTS provider keys:\n\n- Doubao: `DOUBAO_TTS_APP_ID` + `DOUBAO_TTS_ACCESS_KEY`\n- ElevenLabs: `ELEVENLABS_API_KEY`\n- MiniMax: `MINIMAX_API_KEY`\n- Inworld: `INWORLD_TTS_API_KEY`\n- Fish Audio: `FISHAUDIO_TTS_API_KEY`\n- Speechify: `SPEECHIFY_TTS_API_KEY`\n- OpenAI: existing `OPENAI_API_KEY` / optional `IMAGE_BASE_URL`;\n  `OPENAI_TTS_MODEL` defaults to `gpt-4o-mini-tts`\n- Gemini: existing `GEMINI_API_KEY` / optional `GEMINI_BASE_URL`;\n  `GEMINI_TTS_MODEL` defaults to `gemini-2.5-flash-preview-tts`\n- Mistral: existing `LLM_MISTRAL_API_KEY` / optional\n  `LLM_MISTRAL_BASE_URL`; `MISTRAL_TTS_MODEL` defaults to\n  `voxtral-mini-tts-2603`\n- Cartesia: `CARTESIA_API_KEY`; `CARTESIA_TTS_MODEL` defaults to `sonic-3`\n\nTranscription follows the provider selected in Settings unless the user\nexplicitly requests a configured `provider` override. AssemblyAI remains the\ndefault, and local transcription needs no cloud key. Cloud choices use:\n\n- AssemblyAI: `ASSEMBLYAI_API_KEY`\n- OpenAI: `OPENAI_API_KEY` / optional `IMAGE_BASE_URL`;\n  `OPENAI_TRANSCRIPTION_MODEL` defaults to `gpt-4o-mini-transcribe`\n- Mistral: `LLM_MISTRAL_API_KEY` / optional `LLM_MISTRAL_BASE_URL`;\n  `MISTRAL_TRANSCRIPTION_MODEL` defaults to `voxtral-mini-latest`\n- Deepgram: `DEEPGRAM_API_KEY`; `DEEPGRAM_TRANSCRIPTION_MODEL` defaults to\n  `nova-3`\n- Groq: `GROQ_API_KEY` / optional `GROQ_BASE_URL`;\n  `GROQ_TRANSCRIPTION_MODEL` defaults to `whisper-large-v3-turbo`\n- ElevenLabs: `ELEVENLABS_API_KEY`; `ELEVENLABS_TRANSCRIPTION_MODEL` defaults\n  to `scribe_v2`\n- Cartesia: `CARTESIA_API_KEY`; `CARTESIA_TRANSCRIPTION_MODEL` defaults to\n  `ink-whisper` (batch transcription; `ink-2` is streaming-only)\n\n`TRANSCRIPTION_LANGUAGE` defaults to `zh`, and\n`TRANSCRIPTION_DIARIZATION` defaults to `1`. Credentials stay server-side;\nagent tool inputs never contain API keys.\n\nThe Settings panel can test each LLM endpoint, read its model catalog, and save a\nselected model. AI Chat only offers providers with a configured key; switching\nthe chat model does not overwrite another provider's URL, key, or model.\n\nExact availability is reflected in the live **capabilities** block injected into the agent system prompt (which vendors are on).\n\n## What works without cloud keys\n\n- Timeline editing, propose→apply, captions, transitions, FX, zoom, library MG templates  \n- Export (when the export path is available)  \n- Project / media pool / version history  \n\n## If the user asks about cloud cost\n\n- Point them at their provider console (MiniMax, Volcengine, OpenAI, etc.).  \n- Do not invent rates.\n",N=`# OpenChatCut UI & Features

## Project Entry & Dashboard

The app opens on a project dashboard. If there are no projects, a sample project may be created on first run.

- **New project** — Create an empty project and open the editor.
- **Scenario chips/cards** — In a new or empty AI conversation, users can pick workflow starters (inserts a starter prompt into the composer):
  - **Seedance / AI video** — Generate AI video clips from a text description (needs a configured video provider key).
  - **App Promo** — Create a polished promotional video for an app or website.
  - **URL to Ad Video** — Paste a product link to generate a short ad-style video (needs web + video providers as configured).
  - **Motion Graphics** — Generate animated visual elements from text or image references.
  - **Talking Head Editing** — Upload talking head footage; the agent picks the best takes, cuts filler words, tightens pacing, and adds motion graphics.
  - **Explainer Video** — Provide a topic (and optionally your own media); the agent creates a complete explainer video with AI narration, visuals, and background music.

## Editor Layout

The editor has five main areas:

### AI Panel

The conversation with the AI assistant. Users can reference timeline items and assets using @ mentions in the input box to tell the AI exactly what to modify. Files can be attached as context for the AI.

At the bottom of the panel:

- **Mode switcher** — Two modes:
  - **Agent** — Full AI editing assistant. The AI reads your message, understands context, and performs editing tasks.
  - **Q&A** — Q&A only; does not edit the timeline.
- **Agent Settings** — Open from the controls next to the mode selector. Settings include:
  - **Thinking Mode** — Turn the agent's extra reasoning on or off.
  - **Ask / YOLO mode** — How timeline proposals are applied. Tools execute directly in both modes. **Ask Mode** leaves timeline proposals for you to apply and may ask about critical choices. **YOLO Mode** (default) applies proposals automatically and asks only when critical information is missing.
  - **Motion Graphics Quality** — Choose Speed, Balance, or Quality for motion graphics generation.
- **Proposal card** — In Ask Mode, structural timeline edits may show an apply / reject card before they land. Tool side effects are not held behind this card.
- **+ button** — Upload reference files (images, videos, etc.) to include in your message.
- **Skills / 技能 (book icon)** — Open the Skills picker below the chat input. Users can choose a preset Skill or one of their saved Skills to guide the AI with a reusable workflow for the current message. Saved Skills are user-owned and can be reused across projects. The picker also includes **Save this editing process as a Skill**, which inserts a prompt asking the AI to help capture the current workflow.
- **Selection button** — Toggle selection mode. When active, the user can reference content by:
  - Clicking items on the timeline or in My Assets to reference specific clips/assets.
  - Dragging a box on the preview canvas to reference a screen region.
  - Clicking a point on the timeline ruler to reference a specific time.
  - Selecting text in the Transcript panel to reference a portion of speech.
    Selected references are added as @ mentions in the input box so the AI knows exactly what the user is referring to.
- **Send / Stop button** — Send a message or stop an in-progress task.

### Center — Preview

The video preview canvas. Shows a live preview of the timeline at the current playhead position. Supports playback controls below.

### My Assets, Library & Transcript Panels

Tabs that share one panel group (separate from the AI panel):

- **My Assets** (ZH: "素材库") — The user's media pool. Shows uploaded, recorded, imported, and generated media. Users can drag assets from here onto the timeline. The **Upload** button opens local file / folder import.
  - **Generation progress:** When AI generation tasks (video, image, music, etc.) are in progress, they appear in My Assets with a progress indicator. This is where users can check if a generation is still running or has completed.
  - **Generation failures:** If a generation fails, My Assets shows a failure status on the asset card. The user can ask the AI to regenerate.
  - **Bins:** Users can create bins/folders to organize assets.
- **Library** — Built-in presets/effects/assets that can be browsed separately from the user's own assets.
- **Templates** — Template browser when enabled.
- **Transcript** (ZH: "文字稿" / ES: "Transcripción") — A text-based editing panel for talking head / interview footage. Users edit the video by editing text:
  - Select and delete unwanted words/sentences to remove them from the timeline.
  - Drag text segments to reorder the video sequence.
  - While the agent edits, the result previews here live — deletions show struck through — and the user can fine-tune in this panel.
  - Transcript follows the active captions/source track. If no specific source track is set, it uses the first track with video or audio.

### Top Bar

From left to right:

- **Home icon** — Opens the project library/dashboard.
- **Project name** — Double-click (or edit control) to rename.
- **Undo / Redo** — Undo or redo editing actions.
- **Design style** — Brand colors/fonts for MG and captions.
- **Skin** — UI theme picker.
- **Versions** — Save and restore project snapshots.
- **Export history** — Recent exports.
- **Layout** — Toggle panel layout.
- **Export button** — Export timeline (video/audio/subtitles/XML depending on build). Motion graphics can also be baked / exported from clip menus when available.

### Playback Controls (above the timeline)

- **Split tool** (shortcut: C) — Split the clip at the playhead position.
- **Snapping toggle** (shortcut: Shift+M) — Enable/disable snap-to-grid when dragging items on the timeline.
- **Play / Pause** (shortcut: Space)
- **Time display** — Current position / total duration.
- **Zoom controls** — Zoom in/out on the timeline, plus "Zoom to Fit" to show the full timeline.
- **Aspect ratio** — Change the canvas dimensions. Presets: 16:9, 9:16, 1:1, 4:3, 3:4.
- **Captions** — Enable auto-captions and choose a caption style (e.g., Netflix, Minimal, TikTok, YouTube).
- **Fullscreen** (shortcut: \`) — Enter fullscreen preview mode.

### Timeline (bottom)

A project can hold multiple timelines (sequences) — for example a long cut and a short promo. The active timeline is selected from a dropdown above the timeline ruler; switching the dropdown swaps the visible tracks and clips while the asset library stays shared.

The timeline shows all tracks and clips for the active timeline. Caption tracks (C1, C2, ...) are above video tracks (V1, V2, ...), and audio tracks (A1, A2, ...) are below. Caption cues are shown as timed blocks on their owning caption track, and each caption track has independent content, visibility, style, and language settings. Users can:

- Use the **+** menu to create a video, audio/music, or caption track. New sequences remain available from the sequence tabs.
- Drag clips to reposition them.
- Drag edges to trim clips.
- Use the playhead (yellow marker) to scrub through the video.
- **Mark In/Out zone** — Press **I** to mark the in point, **O** to mark the out point, **X** to clear the zone. The selected zone can be used when exporting to only export that portion of the video (choose "Zone" as the export range in the Export panel).

Each track has controls: visibility toggle (eye icon), audio toggle (speaker icon), and delete (trash icon).
`,P='---\nname: shader-gen\ndescription: |\n  AI shader generator for WebGL video effects, transitions, masks, and color grading (LUT / 调色 / 电影感 / film look). Use when the user wants a video effect (滤镜 / 特效), a transition (转场 / crossfade / wipe / cube / 3d), a mask (蒙版 / 遮罩 / reveal), a zoom / push-in (推近 / 推镜头), or a color grade — try the built-in effects (zoom, builtin LUTs) before generating a new shader.\nuser-invocable: true\n---\n\n# Shader Generator\n\nSubmit-only: creates a backend generation job, returns `jobId`. Use the `track_progress` tool for job lifecycle after submission.\n\n**Always use `generate.ts` for new shaders.** Manual authoring is only for editing existing asset code — never as a fallback when generation fails.\n\n## Catalog-first rule — try existing assets before generation\n\nBefore generating a shader, call `browse_library` unless the user names an exact asset id that is already visible in `read_project`.\n\n`browse_library` is the source of truth for built-in effects, built-in transitions, and project effect/transition assets. Built-ins are stable global asset ids, not per-project DB assets, so they may not appear in `read_project` asset lists.\n\nApply catalog entries with `edit_item`, do **not** call `submit_shader`.\n\nGood catalog searches:\n\n```text\nbrowse_library(query: "zoom")\nbrowse_library(category: "transitions", query: "dissolve")\nbrowse_library(category: "audio-fx")\n```\n\nGenerate only when no catalog entry matches the user\'s intent closely enough.\n\n### `builtin:zoom` is track-bound only — DO NOT use item-bound\n\nThe default effect mode is `"item-bound"` (attach to a single item via `targetItemId`). **`builtin:zoom` does NOT render in item-bound mode** — the renderer reads zoom data exclusively from track-bound effect items. An item-bound zoom inserts into the DB silently but shows nothing in preview.\n\nUse `mode: "track-bound"` with `trackId` + `trackBoundFrom` + `trackBoundDurationInFrames`. These three fields are required.\n\n```text\n# Zoom on the entire video clip\nedit_item(json: \'{"adds":[{"type":"effect","assetId":"builtin:zoom","mode":"track-bound","trackId":"<clip-trackId>","trackBoundFrom":<clip-fromFrame>,"trackBoundDurationInFrames":<clip-durationInFrames>,"propertyOverrides":{"magnification":1.5,"shape":"hold"}}]}\')\n\n# Zoom on a sub-range of the clip (e.g. frames 90–150 only, a punch zoom on a beat)\nedit_item(json: \'{"adds":[{"type":"effect","assetId":"builtin:zoom","mode":"track-bound","trackId":"<trackId>","trackBoundFrom":90,"trackBoundDurationInFrames":60,"propertyOverrides":{"magnification":2,"shape":"punch"}}]}\')\n```\n\nGet `trackId` / `fromFrame` / `durationInFrames` from `read_project` (each video/image item lists its trackId and timeline-frame range).\n\n| Key             | Type   | Range / values                             | Default | Notes                                          |\n| --------------- | ------ | ------------------------------------------ | ------- | ---------------------------------------------- |\n| `magnification` | number | 1–4                                        | `1.5`   | Zoom factor; 1 = no zoom, 2 = 2× in            |\n| `focalPointX`   | number | 0–1                                        | `0.5`   | Horizontal focal point (0 = left, 1 = right)   |\n| `focalPointY`   | number | 0–1                                        | `0.5`   | Vertical focal point (0 = top, 1 = bottom)     |\n| `shape`         | select | `punch` / `hold` / `slow-push` / `instant` | `hold`  | Animation curve                                |\n| `focalMode`     | select | `auto` / `manual`                          | `auto`  | `auto` picks subject; `manual` uses focalPoint |\n| `easeInFrames`  | number | 0–60                                       | `8`     | Frames to ramp in                              |\n| `easeOutFrames` | number | 0–60                                       | `8`     | Frames to ramp out                             |\n\nOmit `propertyOverrides` entirely for default zoom. Send only the keys you want to change — patch semantics.\n\n### Track-bound vs item-bound — the broader rule\n\nEffect items in the schema have two modes:\n\n- **`item-bound`** (default): `targetItemId` only. Effect covers the whole target item\'s playback. Works for shader effects, LUTs, color grades, blurs.\n- **`track-bound`**: `trackId` + `trackBoundFrom` + `trackBoundDurationInFrames`. Effect covers a timeline range on a track, independent of any item. Required for `builtin:zoom`; also valid for any shader effect when you want it to cover a specific timeline range (e.g. a transition-like color shift across the boundary of two clips).\n\nDefault to item-bound for shader effects. Use track-bound when (a) the asset requires it (zoom), or (b) the effect should cover a timeline range that doesn\'t match a single item.\n\n### Built-in LUT properties\n\n```text\nedit_item(json: \'{"adds":[{"type":"effect","targetItemId":"<clip-id>","assetId":"builtin:slog3-s709","propertyOverrides":{"intensity":1}}]}\')\n```\n\n| Key         | Type   | Range | Default | Notes                          |\n| ----------- | ------ | ----- | ------- | ------------------------------ |\n| `intensity` | number | 0–1   | `1`     | LUT strength; 1 = full applied |\n\nTo swap: delete the effect and re-add with a different `assetId`. To remove: delete the effect item.\n\nThese are separate from user-uploaded `.cube` LUT assets (see "Applying an Existing LUT Asset" below) — those use a different code path with `assetId:"lut"`.\n\n## Beta Status Gate\n\nNew shader generation is beta. Before generating, warn the user and wait for explicit confirmation.\n\nUse the user\'s language. Chinese: "新的特效/转场生成目前还是 beta 阶段，可能会有不稳定的问题。如果你坚持要做，我可以帮你实现。" Skip if user already acknowledged in the same request.\n\n## Supported Targets\n\nEffects and transitions apply to `video`, `image`, and `gif` items.\n\n## Type Routing\n\nBefore generating anything, check two non-generation paths first:\n\n1. **Catalog entry** — use `browse_library` for built-in and project effects/transitions.\n2. **User-uploaded `.cube` LUT asset** that already exists in the project library — separate code path, see "Applying an Existing LUT Asset" below. The asset shows up in `read_project` with `type: lut`.\n\n| User wants                                                           | `--type`     |\n| -------------------------------------------------------------------- | ------------ |\n| Video appearance (color, blur, glow, grain, distortion)              | `effect`     |\n| Color grade / look (teal-orange, cinematic, vintage, LUT-style)      | `effect`     |\n| Visibility control (mask, reveal, wipe, shape cutout, gradient fade) | `effect`     |\n| Blend between clips (crossfade, dissolve, slide, 3D cube/page flip)  | `transition` |\n\n"LUT-style" in the table means **generating a fresh GLSL color grade that resembles a LUT** — only when the user wants something new. If they want to apply a `.cube` file already in the library, don\'t generate; bind the existing asset instead.\n\nNo separate LUT or mask generator for the generation path — those are all `effect`.\n\n## Applying an Existing LUT Asset\n\n`.cube` files uploaded by the user become `lut` assets. Applying one to a clip is **not** generation — it\'s a single `edit_item` call that attaches an effect item whose `assetId` is the literal string `"lut"` and whose `propertyOverrides.lut` binds the real LUT asset id. (Legacy contract; the unified LUT API binds the LUT effect asset id directly — see `edit_item` description.)\n\n```text\nedit_item(json: \'{"adds":[{"type":"effect","targetItemId":"<clip-id>","assetId":"lut","propertyOverrides":{"intensity":1,"lut":{"assetId":"<lut-asset-id>","assetType":"lut","type":"asset"}}}]}\')\n```\n\nKey points:\n\n- `assetId` is the literal string `"lut"`, not the LUT asset\'s id. The real LUT asset id goes inside `propertyOverrides.lut.assetId`.\n- `intensity` is 0–1; default 1 (full strength).\n- `targetItemType` defaults to `video`; also supports `image`, `gif`.\n- To swap a LUT on an existing effect: update `propertyOverrides.lut.assetId` to the new LUT asset id.\n- To remove: delete the effect item.\n\nDo not call `generate.ts` for this path. Do not pass a real LUT asset id as `assetId` — the editor checks `assetId === "lut"` to route into the LUT renderer; passing a UUID silently renders nothing.\n\n## Usage\n\nBefore calling `submit_shader`, restate the user\'s intent in one concrete sentence, then proceed immediately. After `track_progress` returns, state what was produced in one line — do NOT ask "要保留还是重新生成".\n\n```ts\nsubmit_shader({\n  type: "effect",\n  prompt: "Chromatic aberration with RGB split",\n  name: "Chromatic Aberration",\n});\n\nsubmit_shader({\n  type: "transition",\n  prompt: "Smooth crossfade with soft edge",\n  name: "Crossfade",\n});\n\nsubmit_shader({\n  type: "effect",\n  prompt: "Cinematic teal-orange color grade",\n});\n\nsubmit_shader({\n  type: "effect",\n  prompt: "Stronger version",\n  referenceAssetIds: ["effect_asset_id"],\n});\n```\n\n## Strategy\n\n- Submit, then stop. Tell user the job was created.\n- Use the `track_progress` tool for status/wait after submission.\n- Generation always produces a library asset — never refuse because the timeline isn\'t ready.\n- **Apply is separate and optional.** Only apply when user explicitly asks ("加到视频", "apply", "用到第一段"). When ambiguous, default to library-only.\n\n## Editing Existing Properties\n\nAny time you\'re about to edit shader `asset.properties`, applied effect/transition `item.propertyOverrides`, or promote a hardcoded shader value, read [`references/property-changes.md`](references/property-changes.md) first.\n\nIt reinforces that shader `properties` is an array, but the allowed shader property types are only `number`, `boolean`, `color`, `select`, and `vec2`. Motion Graphic properties are also arrays, but use a different type set.\n\n## Parameters\n\n| Param               | Description                                                                                                                                                    | Default |\n| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |\n| `type`              | `"effect"` or `"transition"` (req\'d)                                                                                                                           | —       |\n| `prompt`            | Description of the shader (req\'d)                                                                                                                              | —       |\n| `name`              | Asset name shown in library                                                                                                                                    | —       |\n| `referenceAssetIds` | Asset ids. Image id → model LOOKS AT it for visual inspiration. Effect/transition id → reuse its code as style anchor (≤1 per submit, kind must match `type`). | —       |\n\n## Output\n\nReturns `{ success, job: { jobId, status }, manage: { status, wait, watch } }`.\n\n## Applying to Timeline\n\nOnly when user explicitly requests. Call `read_project` first for fresh timeline state.\n\n### Effect\n\n```text\nedit_item(json: \'{"adds":[{"type":"effect","targetItemId":"<id>","assetId":"<id>","enabled":true,"propertyOverrides":{}}]}\')\n```\n\n### Transition\n\nRequires two adjacent same-track endpoints. `edit_item` validates live seam feasibility and refuses durations that would require freeze frames or overlapping neighboring transitions. If the add fails, retry with the suggested `durationInFrames`, trim the clips to expose handles, delete/shorten neighboring transitions, or keep a hard cut.\n\n```text\nedit_item(json: \'{"adds":[{"type":"transition","assetId":"<id>","outgoingItemId":"<id1>","incomingItemId":"<id2>","durationInFrames":30}]}\')\n```\n\n## Validation & Verification\n\n### Backend Validation\n\nWhen generating via `generate.ts`, the backend handles validation automatically (transpile, AST security, class structure, retry on failure).\n\n### Manual Code Verification\n\n**NEVER write shader code from scratch.** Always use `generate.ts` for new shaders. This section is ONLY for modifying existing shader code that was already generated.\n\nWhen writing shader code manually, read `${CLAUDE_SKILL_DIR}/references/design-principles.md` first. If the change touches editable properties, also read `${CLAUDE_SKILL_DIR}/references/property-changes.md`.\n\nTypical workflow:\n\n1. `read_project` with the shader `assetId` and `code: true` — read the current source.\n2. Edit the source in your own context.\n3. `edit_asset` with `action=update`, the same `assetId`, and the full replacement source inline in `json.code`. Validation runs automatically on update — if code is invalid, the update is rejected with error details.\n',F=`---
tags: 3d, cube, rotate, box, spin
description: 3D cube rotation — outgoing on front face, incoming on right face, rotates 90° around Y axis.
complexity: high
---

# Cube Rotate Transition

Uses BoxGeometry with per-face materials. Only two faces carry textures (front=outgoing, right=incoming), the rest are black.

Key decisions:

- \`BoxGeometry(1.5 * aspect, 1.5, 1.5 * aspect)\` — depth matches width so the cube face is square in the X/Z plane, preserving correct rotation geometry regardless of video aspect ratio.
- \`camera.position.z = 2.5\` — positions the camera so the cube face fills most of the viewport at FOV 45.
- Rotation is around Y axis with cubic easing — starts slow, accelerates mid-turn, decelerates at the end.

\`\`\`typescript
class CubeTransition extends TransitionProcessor {
  private scene!: Scene;
  private camera!: PerspectiveCamera;
  private cube!: Mesh;
  private outMat!: MeshBasicMaterial;
  private inMat!: MeshBasicMaterial;

  async initialize(ctx: TransitionInitContext): Promise<void> {
    const aspect = ctx.width / ctx.height;
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(45, aspect, 0.1, 1000);
    this.camera.position.z = 2.5;

    const geometry = new BoxGeometry(1.5 * aspect, 1.5, 1.5 * aspect);
    this.outMat = new MeshBasicMaterial();
    this.inMat = new MeshBasicMaterial();

    // Front face (index 4) and Right face (index 0)
    const materials = [
      this.inMat,
      new MeshBasicMaterial({ color: 0x000000 }),
      new MeshBasicMaterial({ color: 0x000000 }),
      new MeshBasicMaterial({ color: 0x000000 }),
      this.outMat,
      new MeshBasicMaterial({ color: 0x000000 }),
    ];
    this.cube = new Mesh(geometry, materials);
    this.scene.add(this.cube);
  }

  protected render(ctx: TransitionRenderContext): WebGLTexture {
    this.outMat.map = ctx.three.wrapTexture(ctx.outgoingTexture);
    this.inMat.map = ctx.three.wrapTexture(ctx.incomingTexture);

    // Cubic easing
    const p = ctx.progress;
    const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    this.cube.rotation.y = -eased * (Math.PI / 2);

    return ctx.threePass(this.scene, this.camera);
  }
}
\`\`\`
`,I=`---
tags: 3d, door, open, split, swing, hinge
description: Door open transition — outgoing splits into two halves that swing open like doors, revealing incoming behind.
complexity: high
---

# Door Open Transition

Three layers: incoming backdrop behind, left door and right door in front. Each door shows the correct half of the outgoing texture and swings outward on its outer edge hinge.

Key decisions:

- **Camera distance from FOV**: \`dist = 1 / Math.tan(fovRad / 2)\` ensures height=2 plane fills viewport. No hardcoded camera z.
- **UV remapping for split texture**: Left door UVs remapped to u:[0, 0.5], right door to u:[0.5, 1]. Each half-panel shows only its corresponding half of the outgoing frame — not the full frame squeezed.
- **Object3D pivot pattern**: Each door's geometry is offset so the hinge edge sits at local origin. The Object3D parent is positioned at the screen edge. Rotating the Object3D swings the door around the correct hinge. Left hinge at x=-W/2, right hinge at x=+W/2.
- **Doors swing into screen**: Left door rotates -Y (swings away-left), right door rotates +Y (swings away-right). Both swing toward negative z, creating a natural "opening toward the viewer" perspective effect.

\`\`\`typescript
class DoorOpenTransition extends TransitionProcessor {
  private scene!: Scene;
  private camera!: PerspectiveCamera;
  private leftPivot!: Object3D;
  private rightPivot!: Object3D;
  private leftMat!: MeshBasicMaterial;
  private rightMat!: MeshBasicMaterial;
  private backMat!: MeshBasicMaterial;

  async initialize(ctx: TransitionInitContext): Promise<void> {
    const aspect = ctx.width / ctx.height;
    const fov = 50;
    const dist = 1 / Math.tan((fov * Math.PI) / 180 / 2);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(fov, aspect, 0.01, 100);
    this.camera.position.z = dist;

    const W = 2 * aspect;
    const H = 2;

    // Backdrop: incoming clip, full width
    this.backMat = new MeshBasicMaterial({ side: 2 });
    const back = new Mesh(new PlaneGeometry(W, H), this.backMat);
    back.position.z = -0.05;
    this.scene.add(back);

    // Left door: shows LEFT half of outgoing (UV u: 0→0.5)
    // Hinge at LEFT edge (x = -W/2)
    const leftGeo = new PlaneGeometry(W / 2, H, 1, 1);
    const leftUV = leftGeo.attributes.uv;
    for (let i = 0; i < leftUV.count; i++) {
      leftUV.setX(i, leftUV.getX(i) * 0.5);
    }
    leftUV.needsUpdate = true;
    this.leftMat = new MeshBasicMaterial({ side: 2 });
    const leftDoor = new Mesh(leftGeo, this.leftMat);
    // Shift geometry so LEFT edge is at local origin (pivot)
    leftDoor.geometry.translate(W / 4, 0, 0);
    this.leftPivot = new Object3D();
    this.leftPivot.position.x = -W / 2;
    this.leftPivot.add(leftDoor);
    this.scene.add(this.leftPivot);

    // Right door: shows RIGHT half of outgoing (UV u: 0.5→1)
    // Hinge at RIGHT edge (x = +W/2)
    const rightGeo = new PlaneGeometry(W / 2, H, 1, 1);
    const rightUV = rightGeo.attributes.uv;
    for (let i = 0; i < rightUV.count; i++) {
      rightUV.setX(i, 0.5 + rightUV.getX(i) * 0.5);
    }
    rightUV.needsUpdate = true;
    this.rightMat = new MeshBasicMaterial({ side: 2 });
    const rightDoor = new Mesh(rightGeo, this.rightMat);
    // Shift geometry so RIGHT edge is at local origin (pivot)
    rightDoor.geometry.translate(-W / 4, 0, 0);
    this.rightPivot = new Object3D();
    this.rightPivot.position.x = W / 2;
    this.rightPivot.add(rightDoor);
    this.scene.add(this.rightPivot);
  }

  protected render(ctx: TransitionRenderContext): WebGLTexture {
    const p = ctx.progress;
    const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

    this.backMat.map = ctx.three.wrapTexture(ctx.incomingTexture);
    this.leftMat.map = ctx.three.wrapTexture(ctx.outgoingTexture);
    this.rightMat.map = ctx.three.wrapTexture(ctx.outgoingTexture);

    // Left door: hinge on left, swings into screen (negative Y rotation)
    this.leftPivot.rotation.y = -eased * (Math.PI / 2);
    // Right door: hinge on right, swings into screen (positive Y rotation)
    this.rightPivot.rotation.y = eased * (Math.PI / 2);

    return ctx.threePass(this.scene, this.camera);
  }
}
\`\`\`
`,L=`---
tags: 3d, page, curl, flip, turn, book, peel
description: Page curl transition — outgoing page curls away from left to right, revealing incoming underneath.
complexity: high
---

# Page Curl Transition

Two-layer approach: incoming page sits flat behind (z=-0.001), outgoing page is a high-res subdivided plane (80x80) whose vertices are deformed each frame to simulate a cylindrical curl.

Key decisions:

- **Camera distance from FOV**: \`dist = 1 / Math.tan(fovRad / 2)\` ensures the plane (height=2) exactly fills the viewport vertically. No hardcoded camera z.
- **Radius proportional to page width**: \`radius = W * 0.08\` scales with aspect ratio, preventing the curl from being too tight on wide videos or too loose on tall ones.
- **Fold sweeps left→right**: \`foldX = -W/2 + eased * (W + radius * PI)\`. At progress=0 fold is at left edge (nothing curled), at progress=1 it's past the right edge (fully curled away).
- **UV-based position reconstruction**: Original positions are derived from UVs each frame (\`ox = uv.getX(i) * W - W/2\`), since the position buffer gets overwritten. UVs are immutable.
- **Three curl zones**: (1) \`ox <= foldX\` → flat, not yet reached. (2) \`ox > foldX, angle <= PI\` → wrapping around cylinder. (3) \`angle > PI\` → past 180°, extends flat at z=2\\*radius back toward -x (folded-back page visible on top).
- **\`side: 2\` (DoubleSide)**: Back of the curling page is visible during the curl.
- **Texture swap**: \`incomingMat\` gets \`outgoingTexture\`, \`curlMat\` gets \`incomingTexture\` — the curling-away page shows incoming, the flat base shows outgoing. This creates the effect of a new page being revealed as the old one peels off.

\`\`\`typescript
export class PageCurlTransition extends TransitionProcessor {
  private scene!: Scene;
  private camera!: PerspectiveCamera;
  private curlMesh!: Mesh;
  private incomingMesh!: Mesh;
  private curlMat!: MeshBasicMaterial;
  private incomingMat!: MeshBasicMaterial;
  private aspect!: number;
  private W!: number;

  async initialize(ctx: TransitionInitContext): Promise<void> {
    this.aspect = ctx.width / ctx.height;
    this.scene = new Scene();

    const fov = 45;
    const fovRad = (fov * Math.PI) / 180;
    const dist = 1 / Math.tan(fovRad / 2);

    this.camera = new PerspectiveCamera(fov, this.aspect, 0.01, 100);
    this.camera.position.z = dist;

    this.W = 2 * this.aspect;
    const H = 2;

    this.incomingMat = new MeshBasicMaterial({ side: 2 });
    this.incomingMesh = new Mesh(
      new PlaneGeometry(this.W, H),
      this.incomingMat,
    );
    this.incomingMesh.position.z = -0.001;
    this.scene.add(this.incomingMesh);

    this.curlMat = new MeshBasicMaterial({ side: 2 });
    this.curlMesh = new Mesh(
      new PlaneGeometry(this.W, H, 80, 80),
      this.curlMat,
    );
    this.scene.add(this.curlMesh);
  }

  protected render(ctx: TransitionRenderContext): WebGLTexture {
    const p = ctx.progress;
    const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

    this.incomingMat.map = ctx.three.wrapTexture(ctx.outgoingTexture);
    this.curlMat.map = ctx.three.wrapTexture(ctx.incomingTexture);

    const W = this.W;
    const radius = W * 0.08;
    const foldX = -W / 2 + eased * (W + radius * Math.PI);

    const pos = this.curlMesh.geometry.attributes.position;
    const uv = this.curlMesh.geometry.attributes.uv;
    const count = pos.count;

    for (let i = 0; i < count; i++) {
      const ox = uv.getX(i) * W - W / 2;
      const oy = uv.getY(i) * 2 - 1;

      let nx: number, nz: number;

      if (ox <= foldX) {
        nx = ox;
        nz = 0;
      } else {
        const delta = ox - foldX;
        const angle = delta / radius;
        if (angle <= Math.PI) {
          nx = foldX + radius * Math.sin(angle);
          nz = radius * (1 - Math.cos(angle));
        } else {
          const extra = delta - radius * Math.PI;
          nx = foldX - extra;
          nz = radius * 2;
        }
      }

      pos.setXYZ(i, nx, oy, nz);
    }

    pos.needsUpdate = true;
    this.curlMesh.geometry.computeVertexNormals();

    return ctx.threePass(this.scene, this.camera);
  }
}
\`\`\`
`,R=`# Shader Effect & Transition Design Principles

This document contains the system prompt and design guidelines used by Gemini when generating shader code. Follow these same rules when writing shader code manually.

<role>
You are an expert WebGL shader programmer writing GPU-accelerated video effects and transitions for a professional video editor.
You write TypeScript classes that extend EffectProcessor (effects) or TransitionProcessor (transitions).
</role>

## Constraints

**Violations cause runtime crashes. Strict compliance required.**

1. **TypeScript only.** Class MUST extend \`EffectProcessor\` (effect) or \`TransitionProcessor\` (transition).
2. **No import statements.** \`EffectProcessor\` / \`TransitionProcessor\` are pre-injected in scope.
3. **Use \`export\` before class declaration** (it will be stripped automatically).
4. **Fragment shaders MUST use \`#version 300 es\`, \`precision highp float\`.**
5. **Available in scope:** EffectProcessor, TransitionProcessor, Array, Object, Math, Float32Array, Int32Array, Uint8Array, console.
6. **BLOCKED (will fail validation):** window, document, fetch, eval, Function, import, require, setTimeout, setInterval, process, globalThis, crypto, WebSocket, XMLHttpRequest, navigator, localStorage, sessionStorage, Worker, ServiceWorker, and all other browser/Node globals.
7. **Max code length:** 50,000 characters.
8. **Multi-pass effects:** Always call \`ctx.releaseTexture()\` on intermediate textures to avoid GPU memory leaks.
9. **Do NOT implement \`getMetadata()\`.** Properties are declared in the JSON response, not in code.
10. **Shader compilation:** All shaders MUST be compiled in \`initialize(ctx)\` via \`ctx.compileShader({ id, fragmentShader, vertexShader? })\`. The \`id\` must match the \`id\` used in \`renderPass()\`.
11. **Custom vertex shader:** Pass a custom vertex shader in \`compileShader({ id, fragmentShader, vertexShader })\`. If omitted, the default vertex shader is used.

## Effect API

The default vertex shader provides \`v_texCoord\` (vec2, 0-1 UV coordinates). Use \`uniform sampler2D u_input\` for the input video texture.

\`\`\`typescript
interface EffectRenderContext {
  readonly gl: WebGL2RenderingContext;
  readonly width: number;
  readonly height: number;
  readonly frame: number;
  readonly time: number;
  readonly fps: number;
  readonly progress: number; // 0-1 progress within clip
  readonly inputTexture: WebGLTexture;
  readonly properties: Record<string, unknown> | undefined;
  renderPass(options: RenderPassOptions): WebGLTexture;
  acquireTexture(): WebGLTexture;
  releaseTexture(texture: WebGLTexture): void;
}

interface EffectInitContext {
  compileShader(options: {
    id: string;
    fragmentShader: string;
    vertexShader?: string;
  }): void;
  readonly width: number;
  readonly height: number;
}
\`\`\`

### Effect Example

\`\`\`typescript
export class GrayscaleEffect extends EffectProcessor {
  async initialize(ctx: EffectInitContext): Promise<void> {
    ctx.compileShader({
      id: "grayscale",
      fragmentShader: \`#version 300 es
      precision highp float;
      uniform sampler2D u_input;
      uniform float u_intensity;
      in vec2 v_texCoord;
      out vec4 fragColor;
      void main() {
        vec4 color = texture(u_input, v_texCoord);
        float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        fragColor = vec4(mix(color.rgb, vec3(gray), u_intensity), color.a);
      }\`,
    });
  }

  protected render(ctx: EffectRenderContext): WebGLTexture {
    const props = ctx.properties as { intensity?: number } | undefined;
    return ctx.renderPass({
      id: "grayscale",
      textures: { u_input: ctx.inputTexture },
      uniforms: { u_intensity: props?.intensity ?? 1.0 },
    });
  }
}
\`\`\`

## Transition API

A transition blends TWO video frames: the outgoing clip (fading out) and the incoming clip (fading in).
The shader receives both textures and a \`progress\` value (0→1). At progress=0, show only the outgoing clip. At progress=1, show only the incoming clip.

Use \`uniform sampler2D u_outgoing\` and \`uniform sampler2D u_incoming\` for the two video textures. Use \`uniform float u_progress\` for the blend progress.

\`\`\`typescript
interface TransitionRenderContext {
  readonly gl: WebGL2RenderingContext;
  readonly width: number;
  readonly height: number;
  readonly frame: number;
  readonly time: number;
  readonly fps: number;
  readonly progress: number; // 0→1 (0=outgoing, 1=incoming)
  readonly outgoingTexture: WebGLTexture;
  readonly incomingTexture: WebGLTexture;
  readonly properties: Record<string, unknown> | undefined;
  renderPass(options: RenderPassOptions): WebGLTexture;
  acquireTexture(): WebGLTexture;
  releaseTexture(texture: WebGLTexture): void;
}

interface TransitionInitContext {
  compileShader(options: {
    id: string;
    fragmentShader: string;
    vertexShader?: string;
  }): void;
  readonly width: number;
  readonly height: number;
}
\`\`\`

### Transition Examples

**Crossfade:**

\`\`\`typescript
export class CrossfadeTransition extends TransitionProcessor {
  async initialize(ctx: TransitionInitContext): Promise<void> {
    ctx.compileShader({
      id: "crossfade",
      fragmentShader: \`#version 300 es
      precision highp float;
      uniform sampler2D u_outgoing;
      uniform sampler2D u_incoming;
      uniform float u_progress;
      in vec2 v_texCoord;
      out vec4 fragColor;
      void main() {
        vec4 outColor = texture(u_outgoing, v_texCoord);
        vec4 inColor = texture(u_incoming, v_texCoord);
        fragColor = mix(outColor, inColor, u_progress);
      }\`,
    });
  }

  protected render(ctx: TransitionRenderContext): WebGLTexture {
    return ctx.renderPass({
      id: "crossfade",
      textures: {
        u_outgoing: ctx.outgoingTexture,
        u_incoming: ctx.incomingTexture,
      },
      uniforms: { u_progress: ctx.progress },
    });
  }
}
\`\`\`

**Directional Wipe:**

\`\`\`typescript
export class DirectionalWipe extends TransitionProcessor {
  async initialize(ctx: TransitionInitContext): Promise<void> {
    ctx.compileShader({
      id: "wipe",
      fragmentShader: \`#version 300 es
      precision highp float;
      uniform sampler2D u_outgoing;
      uniform sampler2D u_incoming;
      uniform float u_progress;
      uniform float u_softness;
      uniform int u_direction;
      in vec2 v_texCoord;
      out vec4 fragColor;
      void main() {
        float coord = u_direction == 0 ? v_texCoord.x :
                      u_direction == 1 ? 1.0 - v_texCoord.x :
                      u_direction == 2 ? v_texCoord.y : 1.0 - v_texCoord.y;
        float edge = smoothstep(u_progress - u_softness, u_progress + u_softness, coord);
        vec4 outColor = texture(u_outgoing, v_texCoord);
        vec4 inColor = texture(u_incoming, v_texCoord);
        fragColor = mix(inColor, outColor, edge);
      }\`,
    });
  }

  protected render(ctx: TransitionRenderContext): WebGLTexture {
    const props = ctx.properties as
      | { softness?: number; direction?: string }
      | undefined;
    const dirMap: Record<string, number> = {
      left: 0,
      right: 1,
      top: 2,
      bottom: 3,
    };
    return ctx.renderPass({
      id: "wipe",
      textures: {
        u_outgoing: ctx.outgoingTexture,
        u_incoming: ctx.incomingTexture,
      },
      uniforms: {
        u_progress: ctx.progress,
        u_softness: props?.softness ?? 0.1,
        u_direction: dirMap[props?.direction ?? "left"] ?? 0,
      },
    });
  }
}
\`\`\`

## Properties

Properties define UI controls exposed to the user. Declare them in the JSON output, NOT in \`getMetadata()\`.

Shader \`properties\` is always an array. Each entry: \`{ key, label, type, defaultValue, [min, max, step] }\`.

Shader property types are: \`number\`, \`boolean\`, \`color\`, \`select\`, \`vec2\`. Motion Graphic properties are also arrays, but use a different type set — do not use Motion Graphic-only types such as \`text\`, \`font\`, \`image\`, or \`video\` for shaders.

| Type      | Use case                    | defaultValue example |
| --------- | --------------------------- | -------------------- |
| \`number\`  | Intensity, radius, softness | \`"0.5"\`              |
| \`boolean\` | Toggle on/off               | \`"true"\`             |
| \`color\`   | Tint color                  | \`"#ffffff"\`          |
| \`select\`  | Direction, mode choice      | \`"left"\`             |
| \`vec2\`    | Center point, offset        | \`"0.5,0.5"\`          |

Number properties render as sliders when \`min\` and \`max\` are present; \`step\` is optional.

## Design Principles

**1. Subtle Over Heavy**
Effects should enhance, not overpower. Default property values should produce a tasteful result out of the box — users should be impressed on first apply, not scrambling to dial it down.

**1a. Broadcast-Quality Aesthetics (Effects)**
Design for a professional video editor, not a toy filter app.

- Think film color grading (Davinci Resolve), not Instagram sticker filters. Subtle warmth shift > heavy neon overlay.
- When manipulating color, preserve skin tones and natural contrast. Crushing blacks or blowing highlights screams amateur.
- Animated effects should use smooth easing (sine, exponential decay), not linear ramps. Match frequency to the real-world phenomenon (grain flickers fast, lens flares drift slow).
- Overlay elements (particles, bokeh, light leaks) must use \`additive\` or \`screen\` blending — never paste opaque shapes.
- Multi-pass blur/glow needs enough taps for smooth gradients (5+ or two-pass separable Gaussian).
- Avoid: solid color overlays as "tint", single-pixel blur as "cinematic", uniform noise as "film grain", constant-offset chromatic aberration (real CA is radial).

**2. Performance Matters**

- Minimize texture samples and passes. One pass is ideal; two is acceptable; three+ needs justification.
- Avoid branching in fragment shaders when possible (use \`mix\`, \`step\`, \`smoothstep\`).
- Use \`mediump\` for values that don't need full precision (e.g. UV coordinates in simple effects).

**3. Smooth Transitions**
Transitions must be visually seamless: at \`progress=0\` the output must be pixel-identical to the outgoing clip, at \`progress=1\` pixel-identical to the incoming clip. No sudden jumps, no artifacts at the boundary frames.

**3a. Cinematic Motion (Transitions)**
Design for a professional video editor, not PowerPoint.

- NEVER use linear progress. Always apply easing — cubic (\`p*p*p\`), exponential (\`pow(p, 2.5)\`), ease-in-out (\`smoothstep\`), or spring-like curves.
- Add secondary motion: if geometry moves, add rotation or scale. If a wipe reveals, add a soft glow or blur at the edge.
- Stagger timing across elements — simultaneous motion looks robotic.
- Add depth cues: shadows, parallax, perspective distortion, blur on receding elements.
- Both clips should participate in the transition. A static incoming frame behind a moving outgoing frame is lazy.
- For 3D: ramp lighting intensity with progress so the first frame matches the source video exactly. Only apply strong specular/phong shading after motion begins.
- Avoid flat 2D slides with hard edges, uniform-speed grid dissolves, and unlit 3D rotations.

**4. Expose the Right Controls**

- Every effect should expose an \`intensity\` or \`amount\` property (0-1) so the user can dial it back.
- Transitions should expose \`softness\` / \`feather\` where applicable.
- Keep property count low (2-5). Too many controls overwhelm the user.

**5. GPU Memory Hygiene**
Multi-pass effects must release intermediate textures via \`ctx.releaseTexture()\`. Leaking textures causes GPU memory exhaustion during long playback.

**6. Aspect Ratio in 3D Transitions**
3D transitions using \`threePass()\` must account for the video aspect ratio. In \`initialize(ctx)\`, use \`const aspect = ctx.width / ctx.height\` to create correctly-sized geometry: \`PlaneGeometry(2 * aspect, 2)\` — never \`PlaneGeometry(2, 2)\`. Derive face positions and camera distance from \`aspect\` and the camera's FOV so the outgoing frame fills the viewport exactly at \`progress=0\`. Hard-coded geometry positions (e.g. \`z = 1\`) produce distorted or letterboxed output on non-square videos.

## Output Format

Respond with valid JSON:

\`\`\`json
{
  "typescript_code": "export class ... extends EffectProcessor { ... }",
  "name": "Short effect name",
  "description": "Brief description of what the effect does",
  "properties": [
    {
      "key": "intensity",
      "label": "Intensity",
      "type": "number",
      "defaultValue": "1.0",
      "min": 0,
      "max": 1,
      "step": 0.01
    }
  ]
}
\`\`\`
`,ge='# Shader Property Changes\n\nRead this whenever a task touches editable shader properties: adding, renaming, or removing a property key; changing a default; promoting a hardcoded shader constant; or updating one applied effect/transition override.\n\n## Data Model\n\nThree layers, in strict order:\n\n1. `asset.properties` - editable property **schema** on the effect or transition asset. Declares every key (type, label, default, and `min`/`max`/`step` or `options`). Source of truth.\n2. `item.propertyOverrides` - per-applied-item overrides. Sparse: only values that differ for that specific effect/transition item need to be stored.\n3. `ctx.properties` - runtime object passed into the shader processor. Built by merging schema defaults with the applied item\'s overrides.\n\nShader property types are: `number`, `boolean`, `color`, `select`, `vec2`. Motion Graphic properties are also arrays, but use a different type set - do not use Motion Graphic-only types such as `text`, `font`, `image`, or `video` for shaders.\n\n**Prerequisite rule:** a key must exist in `asset.properties` before shader code should read `ctx.properties.key`, and before an applied item override can show a control for that key.\n\nFor shader assets, `asset.properties` is always an array. Each object inside the array is one editable property entry.\n\n## Decision Table\n\nUse `edit_asset` when:\n\n- shader code starts reading a new `ctx.properties.key`\n- a property key is added, renamed, or removed\n- a property type, label, options, or default changes\n\nUse an applied item update with `propertyOverrides` when:\n\n- the key already exists on the effect/transition asset\n- one applied effect/transition item should use a different value than the asset default\n\nDo not use `propertyOverrides` to add schema. Do not use `edit_asset` for one-off instance values.\n\n## Promoting Hardcoded Values to Properties\n\nWhen the user asks to adjust a hardcoded shader value (intensity, radius, color, softness, direction, center point, or anything tweakable), in the same turn both make the shader change AND promote the value to a property. That way they can self-serve next time from the editor\'s property controls.\n\nSkip promotion when:\n\n- user explicitly frames it as one-off ("just this once", "only for this item")\n- the value is structural: texture binding names, pass IDs, GLSL constants required for loop unrolling, or math tied to shader correctness\n- the asset is a locked template the user doesn\'t own\n\nWorkflow (one turn):\n\n1. Fetch the current shader asset code and properties\n2. Locate the hardcoded literal\n3. Replace it with `ctx.properties.<key>` plus a fallback to the current value so existing items render identically\n4. Add a matching entry inside the `properties` array with sensible `min`/`max`/`step` or `options`\n5. `edit_asset` with both the updated `code` and `properties` in one call\n6. If the user also asked for a specific new value, apply it either as the new `defaultValue` (baseline) or as a `propertyOverride` on the specific applied item\n\nExample - promoting an intensity constant:\n\n```ts\nconst props = ctx.properties as { intensity?: number } | undefined;\nconst intensity = props?.intensity ?? 0.6;\n```\n\n```json\n"properties": [\n  {\n    "key": "intensity",\n    "label": "Intensity",\n    "type": "number",\n    "defaultValue": 0.6,\n    "min": 0,\n    "max": 1,\n    "step": 0.01\n  }\n]\n```\n\nExample - promoting a center point:\n\n```json\n"properties": [\n  {\n    "key": "center",\n    "label": "Center",\n    "type": "vec2",\n    "defaultValue": [0.5, 0.5]\n  }\n]\n```\n\n## Asset-Level Changes\n\nWhen the schema changes, update the shader asset\'s `code` and `properties` in the same `edit_asset` call. Validation runs on update and rejects unsupported property shapes or shader-only/Motion-Graphic-only type mixups.\n\n1. Fetch the current asset with code and properties\n2. Update code to read the target key from `ctx.properties`\n3. `edit_asset` with both the new `properties` array and the new `code`\n4. If a key was renamed, migrate affected applied item overrides to the new key\n\nKeep keys stable when possible - renames create migration work.\n\n## Item-Level Changes\n\nPrerequisite: the key must already exist on `asset.properties`. If it doesn\'t, do not update `propertyOverrides` - go to "Promoting Hardcoded Values" or "Asset-Level Changes" first.\n\nUpdate only the applied effect/transition item whose value should differ from the asset default.\n\n```json\n{ "propertyOverrides": { "intensity": 0.8 } }\n```\n\n```json\n{ "propertyOverrides": { "center": [0.45, 0.55] } }\n```\n',_e=`---
name: skill-creator
description: Create or improve OpenChatCut custom skills. Use whenever the user asks to create a skill, capture a workflow as a skill, write a SKILL.md, add a reusable workflow, 创建技能, 把流程做成技能, 写一个技能, or improve an existing custom skill. Pushy: treat any workflow the user repeats as a skill candidate, even if they do not say "skill".
---

# Skill Creator

Create or improve custom skills for OpenChatCut. A skill is a SKILL.md file
(plus optional \`references/\` support docs) that teaches the agent a reusable
workflow. Custom skills live at \`~/.openchatcut/skills/<slug>/SKILL.md\` and
are managed with the \`manage_skill\` tool.

## Workflow

1. **Capture intent.** If the current conversation already contains the
   workflow (tools used, steps, corrections), extract it from the history
   first. Confirm with the user before writing.
2. **Interview.** Pin down:
   - What should this skill enable the agent to do?
   - When should it trigger? Which user phrases or contexts?
   - Expected output format?
   - Verification: does it have objectively verifiable output (data
     extraction, fixed steps, generation pipelines) or subjective output
     (writing style)? Suggest test prompts for the former.
3. **Write the SKILL.md** (rules below).
4. **Create it** with \`manage_skill action=create\`. The tool reports the
   install path (\`~/.openchatcut/skills/<slug>/SKILL.md\`).
5. **Test.** Run 2–3 realistic prompts in the current session and confirm
   results with the user. Iterate with \`manage_skill action=update\`.

## SKILL.md anatomy

\`\`\`
<slug>/
├── SKILL.md (required — frontmatter + instructions)
└── references/ (optional — docs loaded on demand with load_skill file=)
\`\`\`

- **name**: kebab-case slug matching the directory (lowercase letters,
  digits, hyphens only). It becomes the load_skill name.
- **description**: THE triggering mechanism — include what the skill does
  AND specific trigger contexts. Skills undertrigger easily, so be
  explicit: list concrete user phrases. "When to use" goes here, not in
  the body.
- **body**: imperative instructions. Keep under ~200 lines; if it grows,
  split detail into \`references/\` files and point to them with clear
  "read this when" guidance. For references over 300 lines, add a TOC.

## Writing rules

- Frontmatter uses the shape \`---\\nname: …\\ndescription: …\\n---\`. The
  parser accepts plain single-line, double-quoted, and \`|\` block scalars;
  plain single-line is preferred.
- Keep the body lean. Prefer imperative form. Explain *why* over
  MUST-laden lists. Use examples with concrete Input/Output pairs.
- Reference existing OpenChatCut tools by their exact tool names
  (\`manage_skill\`, \`load_skill\`, \`edit_item\`, …). Do not invent tools.
- Skills must not contain malicious content, prompt-injection payloads, or
  anything that surprises the user. Do not create skills that facilitate
  unauthorized access or data exfiltration.
- Do not overfit to one example: aim for a workflow usable a thousand
  times. If a fix feels fiddly, generalize the instruction instead of
  piling on constraints.

## Progressive disclosure in OpenChatCut

- The system prompt carries only name + description (the skills index).
- The body loads on demand via \`load_skill\` when a task matches.
- Support files load via \`load_skill file=references/<name>\`.
- A custom skill selected in Creative Mode behaves identically to a
  bundled skill after activation.

## Environment constraints

- **Slug whitelist**: \`[A-Za-z0-9_-]{1,120}\`. Anything else is rejected
  (path traversal defense — the file is written under
  \`~/.openchatcut/skills/\`).
- **Body size**: keep under 512 KB (server limit); 200 lines is the target.
- **Untrusted input**: the body is user/LLM-authored text. validate and
  normalize before trusting anything parsed out of it.
- **Bundled skills are read-only** — \`manage_skill\` cannot edit them.
- The skill shows up in the Creative Mode picker and the \`/\` command menu
  only when the user selects it; agents also discover it via the index.
- Verification: after creating a skill, run
  \`npx tsx server/skills-files.verify.ts\` locally if the environment has
  the repo, or rely on the in-session test prompts.

## Test prompts

Offer the user 2–3 realistic prompts (the kind of thing they would actually
type) and ask: "Do these look right, or do you want to add more?" Then run
them in the session with the skill activated, review the outputs together,
and update the skill from the feedback.
`,ve=`---
name: storyboard-shot-breakdown
description: Break down each shot and turn the analysis into a storyboard reference. Use when the user wants shot-by-shot film analysis, director logic, cinematography breakdown, or a storyboard-style reference from a video.
---

# Storyboard Shot Breakdown

Use this skill to analyze a video shot by shot and produce a storyboard-style reference that explains the director's visual decisions.

## Core Philosophy

Do not merely describe what is visible. Deduce why each visual choice was made.

Analyze each shot across five director-decision dimensions:

| Dimension          | Core question                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| Composition        | What is the viewer forced to look at? What pressure does space, symmetry, depth, or framing create?          |
| Focal length       | What psychological distance does the lens create? Does it compress, expand, isolate, or invade?              |
| Movement           | Why does the camera move or stay still at this exact moment? What changes before and after?                  |
| Cut                | Why cut here instead of earlier or later? Is the driver emotion, story, rhythm, eye trace, action, or sound? |
| Narrative function | What new information does this shot deliver: setup, turning point, emphasis, concealment, revelation?        |

## Workflow

1. Read project state and source media.
2. Read transcript or audio context when available so narrative interpretation is grounded.
3. Detect or mark shot boundaries with available OpenChatCut/media tooling.
4. Extract representative frames for each shot in batch when possible.
5. Inspect frames before writing analysis. Do not invent details that are not visible.
6. For high shot counts, tell the user the count and offer output scope choices before spending effort.
7. Analyze each selected shot using the five dimensions.
8. Summarize the overall visual rule of the scene in 1-2 concise sentences.
9. Generate a storyboard reference image or structured analysis artifact if the user wants a visual output.

## Internal Reasoning

Use a counterfactual test: if the conventional alternative were used, what emotion or information would be lost? The answer is usually the director's motive.

Use this reasoning to improve the analysis, but do not output the counterfactual test as a separate section unless the user asks.

## Output Format

Per shot:

\`\`\`text
S{N} - {scale} · {lens/mood} · {movement} · {timecode} · {duration} · {narrative function}

Composition: [what attention is forced onto and what pressure the frame creates]
Focal Length: [psychological distance and dramatic effect]
Movement: [why it moves or stays still, and what changes]
Cut: [why the cut lands here, including rhythm/eye trace/sound when relevant]
Narrative: [what story information this shot adds]
\`\`\`

Overall:

\`\`\`text
Director's Logic: [3-5 sentences summarizing the visual strategy]
Visual Rule: [1-2 sentences the user can reuse as a shooting/editing reference]
\`\`\`

## Rules

- Write from visible evidence and available transcript/audio context.
- Do not borrow details from adjacent shots unless clearly stated as sequence-level analysis.
- Keep shot numbering stable.
- User owns scope trade-offs: if output must be reduced, propose choices.
- Prefer current OpenChatCut/media tools over hardcoded local commands. Use external scripts only when they are available and clearly help.`,z=`---
name: talking-head-guide
description: |
  Guide for editing videos where the primary content is people talking — talking-head / 口播, interview / 访谈, lecture, tutorial, podcast, course content, and similar talking-driven formats. Use when the user wants speech editing on a talking video (剪口播 / 口播剪辑 / 去口癖 / clean up fillers / smooth speech), motion graphics layered onto talking video (口播加 MG / 加动画), or B-roll on a talking video (加 B-roll / add B-roll). For motion graphics specifically, use this together with the active Motion Graphics skill/workflow available in the current OpenChatCut environment — this skill adds talking-specific guidance (speech-rhythm timing, frame-aware placement, subject/caption protection, placement verification).
user-invocable: true
---

# Talking Head Video Editing

## What this skill covers

**Required input**: an existing talking-head / 口播 video uploaded to the project. If the user wants to start without one (e.g., generate a fresh talking-head from scratch), this skill doesn't apply.

**When the user enters this workflow without a source video uploaded yet, ask via a widget surface — bundle the file upload with the treatment selection in one flow**, not two separate turns or a markdown "drag your file in" instruction. Load \`widget-forms\` for the host-specific route. Never tell the user to "拖进编辑器" / "点击素材库的上传按钮"; that's friction with no upside.

When the task creates or targets a OpenChatCut project for the user, surface the editor link early so they can watch progress, and re-confirm the visible editor matches the project before final delivery.

Independent treatments that can be applied to talking-head videos. Pick the ones that match what the user wants — not all are needed every time.

- **A-roll editing** (中文称 **语音剪辑** / 含 **去口癖、停顿、重复**) — transcript-based speech editing. Common operations include cleanup, highlight extraction, restructure, opening hook, and others as needed for the aligned outcome.
- **Motion graphics overlay** (英文展示给用户时写全称 **Motion Graphics**，不要缩成 "MG"；中文产品术语固定为 **MG 动画**——不要叫"动效""字幕条""动态字幕"等其它说法) — reinforce key information, structured content, and topic transitions with on-screen motion graphics
- **B-roll** (industry term — keep as "B-roll" in any language, do not translate) — cover jump cuts or visualize what's being said
- **Background music** (中文 **背景音乐**) — set mood and smooth micro-gaps
- **Captions** (中文 **字幕**) — on-screen text for accessibility
- **AI Voice Isolation** (中文 **AI 人声隔离**) — clean or isolate spoken human voice with DeepFilterNet3, picture untouched. See the \`voice-isolation\` skill.

> 用户语言为中文时，在 widget options / choices options / 对话文案里**严格使用上面括号里的产品术语**——别自己再翻译一遍，会跟产品其它地方对不上。

## What shapes the edit

Beyond picking treatments, a talking-head edit is shaped by several orthogonal variables. When the user's ask is vague, these are what's worth clarifying first:

- **Target** — platform (YouTube / TikTok / Shorts / ...), desired length, aspect ratio
- **Which treatments to apply** — the treatments above are optional; don't assume all of them apply
- **Pacing / tone** — tight / energetic / formal / casual; brand or voice preferences if stated. (For MG visual style, follow the active Motion Graphics skill/workflow.)

When more than one of these variables is missing, ask with one form after loading \`widget-forms\`. Do not ask markdown numbered questions and then append \`<choices/>\` for only one part of the same intake.

## Order of execution

When multiple treatments have been aligned with the user, they depend on each other and must be finalized in dependency order. This section is **only relevant after alignment** — it doesn't tell you what to start with on a fresh request.

The speech timing (set by A-roll editing) anchors everything downstream — MG placement, B-roll cut-covers, music duration, and caption sync all reference the final speech timeline.

So: finalize A-roll editing before committing any visual, audio, or text layer. Don't write captions against pre-edit speech, don't cut music to pre-edit length, don't place MG against timing that will shift.

**You must confirm the result with the user after each major step before starting the next**, unless the user has explicitly asked to run end-to-end without stopping. Key checkpoints when multiple treatments apply: after A-roll editing finalizes the speech timing; before MG generation (confirm style and direction, and, when it isn't obvious, whether it sits over the video as an overlay or takes the whole frame); after MG generation; same pattern for B-roll, music, and captions. **Don't bundle multiple checkpoints into one response — confirm each step separately.** An upstream mistake forces redoing everything downstream (e.g., MG placed against pre-cleanup timing must be regenerated when the timeline shifts).

---

## A-roll editing

### Scenario

In a talking-head workflow, the first step is usually A-roll editing: editing the original spoken footage.

A-roll edits are ultimately applied to the timeline and change what the viewer actually hears and sees. However, the editing decisions should usually start from the transcript, because the core question is: what spoken content should the viewer hear, and what should be removed, compressed, or reordered?

### Common A-roll tasks

A-roll editing is not only cleanup. First decide what spoken-content task the user is asking for, then choose the editing strategy and tools.

Common tasks:

- **Cleanup** — remove mistakes, repeated attempts, verbal habits, filler words, and meaningless pauses so the speech becomes clearer and more natural.
- **Highlight extraction** — pull the most valuable, opinionated, emotional, or topic-relevant moments from longer footage.
- **Restructure** — reorder spoken content, such as moving the conclusion earlier, grouping by topic, or combining scattered parts into a clearer structure.
- **Hook / short version** — use a strong claim, result, conflict, or question from the source as the opening, or compress long content into a shorter version.
- **Target-script / script alignment** — match, keep, and reorder spoken content according to a user-provided target script, target paragraph, or desired content.

Cleanup is the most common task and the one most likely to fail from bad boundary decisions. It is described in detail below. Other tasks get shorter rules, but still follow the shared A-roll principles: complete meaning, clear boundaries, and natural listening flow.

### Shared A-roll principles

These principles apply to all A-roll tasks, not only cleanup.

- **Decide the task before choosing the tool.** Do not let tool availability change the editing strategy.
- **Edit by complete semantic units.** Whenever possible, move/delete/keep complete sentences, complete ideas, complete answers, or complete steps. Do not cut out a half-sentence just because a few words match.
- **When the task names what to keep, trim to that boundary.** The inverse of the rule above, for any task that specifies which content to keep — restoring a specific sentence, matching a target script, pulling a named highlight, building a version: keep exactly the requested span. Trim the kept range to start and end at the requested words and drop the off-script head/tail of the source \`[sN]\` segment it sits in; keeping a whole segment for one requested sentence is over-keeping that drags in unrequested speech. This applies only when the task names what to keep — never to open-ended cleanup, where you keep complete units (above).
- **Do not stitch unfinished fragments across retakes.** Do not combine incomplete pieces from different attempts into one artificial sentence. This does not make the earlier attempt disposable: keep a complete useful lead-in, setup, contrast, category, evaluation, or context if it is not repeated later and can naturally connect to the later complete retake.
- **Preserve connective tissue.** List labels, contrast words, subjects, verbs, and adjacent source words are not filler when removing them makes a kept idea ungrammatical, abrupt, or misleading. Trim the smallest span that keeps the line speakable.
- **Keep listening flow natural.** The result should still have natural phrasing and breathing room. Do not make sentences feel glued together just to make them "clean."
- **Be conservative when boundaries are uncertain.** If unsure whether a cut harms meaning, logic, or listening flow, keep it or make a smaller cut.
- **Confirm complex changes first.** For complex restructuring, aggressive shortening, structural changes, or generated hooks, confirm target length, structure direction, and what to preserve with the user before editing.
- **Explain content, never indices.** You MUST NOT explain edits to the user with internal addresses such as \`[sN]\`, \`[cN]\`, \`[gap]\`, word indices, clip ids, or segment ids. The user cannot see those addresses and will not understand what they mean. Use the actual spoken content, a short quote, or a plain-language description of the edit.
- **Never name a screen position for a panel.** When you invite the user to review or fine-tune the result, call it "the Transcript panel" (中文「文字稿面板」) — never a direction (left / right / side / 左侧 / 右侧). The layout is rearrangeable and the panel does not sit in a fixed corner.

### Cleanup goals and decisions

#### What good cleanup means

Good cleanup does not mean making the video as short as possible, and it does not mean rewriting the speaker into a different script.

Good cleanup means:

- The logic stays coherent
- The expression becomes clearer
- The audio feels natural
- Obvious mistakes, repeated attempts, meaningless stalls, and filler are removed
- The speaker's intent, tone, and natural rhythm are preserved

Bad cleanup usually falls into two failure modes:

- Under-cleaning: obvious mistakes, repetition, long pauses, or filler remain.
- Over-cleaning: sentences are cut off, meaning is missing, rhythm becomes too hard, or the result sounds stitched together.

Default principle: remove defects without changing meaning; make speech smoother, not harder; prefer small local cuts over whole-sentence or whole-segment deletion; when unsure whether a cut harms meaning, keep it.

#### How to judge common cleanup cases

Below are the common cleanup categories and how to make editing decisions for each.

##### Meaningless filler words

Fillers fall into two categories.

The first category is clearly meaningless hesitation sounds. These are usually safe to remove:

- \`um\`
- \`uh\`
- \`er\`
- \`ah\`
- \`呃\`
- \`额\`

When they do not carry special meaning, use \`clean_script\` first for bulk cleanup.

The second category depends on context and must not be removed by word list alone:

- \`so\`
- \`like\`
- \`然后\`
- \`就是\`
- \`嗯\`
- \`啊\`
- \`那个\`
- \`那\`
- \`对\`
- \`所以\`
- \`但是\`

How to decide:

- If the word is only hesitation or padding, remove it.
- If it carries sequence, continuation, contrast, cause, reference, response, emphasis, or natural tone, keep it.
- If removing it makes the surrounding words sound hard-spliced, keep it or only compress the pause.
- If unsure, keep it.

Examples:

- \`um, I think this solves the main problem\` -> remove \`um\`.
- \`It works like a checklist\` -> keep \`like\`; it is a comparison.
- \`The upload failed, so we retried it\` -> keep \`so\`; it carries cause/result.
- \`right after the call, send the recap\` -> keep \`right\`; it modifies timing.
- \`然后我们再看第二点\` -> keep \`然后\`; it marks sequence.

##### Retakes and repeated attempts

A retake is when the speaker retries the same intended idea because they misspoke, got stuck, forgot words, or restarted. Retake cleanup is not "delete repeated text." The goal is to keep one complete, natural, logically coherent version of the intended idea.

Use this decision path:

1. Decide whether it is really a retake.
   Treat it as a retake only when multiple attempts are trying to say the same intended idea. Do not treat it as a normal retake when the repetition is intentional emphasis, a rhetorical beat, a structural marker, or a second pass that adds new information or tone.
2. Define the complete version to keep.
   A complete version may include more than the main content sentence. It may need a lead-in, connector, section marker, topic setup, contrast, qualifier, subject, object, or conclusion. These are not filler when the kept content depends on them.
3. Cut only the failed or covered part.
   Remove only words that are wrong, dangling, abandoned, or fully covered by the kept version. The cut boundary starts at the repeated or failed idea, not automatically at the earlier transition, setup, or continuous speech. If earlier speech contains useful context that the kept version does not repeat, keep it.
4. Choose the best complete attempt.
   If several attempts are complete, usually prefer the later one because it is often closer to the speaker's intended take. But do not choose the last attempt mechanically. If the later attempt is missing needed context, structure, subject, object, or conclusion, keep the more complete version or preserve the missing lead-in from the earlier attempt.

A repeated lead-in is redundant only when another equivalent lead-in remains naturally connected to the kept content. If removing every copy makes the result lose structure or sound abrupt, keep one natural copy and remove only the extra restarts. Do not stitch unfinished fragments from different attempts into one artificial sentence.

Examples are patterns, not a closed list:

- Local false start inside a kept sentence:
  \`There, there's no After Effects, no Premiere, no DaVinci Resolve learning.\`
  Keep the complete sentence, but remove the abandoned restart:
  \`There's no After Effects, no Premiere, no DaVinci Resolve learning.\`
  Do not keep the stray first word just because the full sentence is otherwise useful.
- Repeated structural lead-in:
  \`And secondly, ... and secondly, we're introducing a brand new UI.\`
  Remove the extra restart, but keep one natural lead-in attached to the kept content:
  \`And secondly, we're introducing a brand new UI.\`
  Do not delete every structural marker and leave only:
  \`We're introducing a brand new UI.\`
- Useful setup before a failed ending:
  \`Then the next one is different from comedy. It is popular on Disney Plus. It is called...\`
  Later retake:
  \`It is a popular Disney Plus show called Love Story.\`
  Keep useful setup that the later retake does not repeat, and cut from the failure point:
  \`Then the next one is different from comedy. It is a popular Disney Plus show called Love Story.\`

##### False starts and unfinished fragments

Use \`false starts / unfinished fragments\` for this category. \`False start\` is the more natural editing/transcription term for a speaker beginning a phrase and then restarting or abandoning it; \`unfinished fragment\` makes the dangling half-sentence case explicit.

Only remove a fragment when it clearly does not form useful information.

Safe to remove:

- The speaker abandons the thought and a complete version appears later.
- The segment is only a dangling phrase, such as "this is actually..." with no completion.
- It is clearly the leftover beginning of a failed attempt.

Do not remove:

- A sentence that is imperfect but contains useful information.
- A lead-in that provides the subject, object, or context needed later.
- Content that provides setup, contrast, conclusion, emotion, or tone.

If only part of a sentence or segment is wrong, do not delete the useful content around it. Remove only the bad word, phrase, or pause; if a local cut cannot sound natural, keep the segment.

##### Pauses and breaths

Pause cleanup should default to compression, not zeroing out. Spoken video needs natural breathing room.

Default rules:

- Obvious long pauses over 0.8-1s: usually compress to about 0.3s.
- Between sentences: keep about 0.3-0.5s so listeners can hear natural phrasing.
- Around topic shifts, contrast, or emphasis: keep slightly longer pauses when needed; do not make the delivery too rushed.
- Short breaths inside one sentence: if they are normal breathing, do not remove them.
- Clear long pauses inside one sentence: compress them, but not so tightly that adjacent words sound glued together.
- Long pauses before a retake: if the failed attempts around it are removed, remove the pause with them.
- If the user provides explicit thresholds, follow them. For example, if the user says "only process pauses over 0.8s and keep at least 0.3s", do not process natural pauses under 0.8s.

How to operate on pauses:

- For batch pause cleanup across the timeline or track, use \`clean_script\`. This is the default path for compressing many long pauses.
- Translate common user wording into \`clean_script\` pause rules:
  - "Tighter breaths" / "compress pauses" / "compress anything over 0.3s to 0.3s" → \`silence: "compress:300"\` (or the requested cap).
  - "Restore some breathing room" / "do not make it too rushed" / "keep at least 0.5s" → \`silence: "restore:500"\` (or the requested minimum).
  - "Make all pauses around 0.5s" → \`silence: "normalize:500"\`.
  - "Keep pauses between 0.3s and 0.8s" → \`silence: "range:300-800"\`.
    Any rule that makes a pause longer — \`restore\`, \`normalize\`, or the lower bound in \`range\` — never invents new silence. It only recovers pause time that already existed at that exact spot in the original recording. If the original pause was shorter than the requested value, it stops at the original pause length.
- You do not need to call \`read_script({ showSilence: true })\` before batch pause cleanup. By default, \`timeline.md\` hides silence markers, but \`clean_script\` can still detect and rewrite silences internally.
- Use \`read_script({ showSilence: true })\` only when you need to inspect or manually adjust a specific pause. Then edit the visible marker: \`~~[silence=0.8s]~~\` to fully cut it, \`[silence=0.8s→0.2s]\` to compress it, or leave it untouched to keep it.
- After semantic edits, review the final clean \`timeline.md\`. If the final pacing still has many long pauses, run \`clean_script only="silence"\`; if only one or two pauses feel wrong, use \`showSilence: true\` and adjust those manually.

Script gap primitive note:

- Do not create an accidental \`[gap]\` on the primary video track as a pacing pause. A Script \`[gap]\` means no source is playing; on the only visible video track it renders as black. If pacing needs breathing room, preserve or restore source silence with \`clean_script\` / \`[silence=...]\`, cover the moment with B-roll/MG/a full-frame visual beat, or intentionally declare the black beat in the plan.

### Other A-roll task guidance

#### Highlight extraction

Highlight extraction is not about making the content as short as possible. It is about selecting the most valuable spoken content according to the user's criteria.

Rules:

- First identify the highlight standard: opinion, conclusion, story, emotion, conflict, tutorial step, data point, or a specific topic.
- Each highlight should be understandable on its own. Do not remove the subject, setup, question, or conclusion needed to understand it.
- Do not keep only a short punchy sentence if the surrounding context is required for it to make sense.
- If the user asks for a specific topic, remove other topics. If the user asks for the "best" or "most exciting" moments, prioritize information density and expression strength.
- After extracting highlights, usually clean up the kept segments so the final result is polished.

#### Restructure

Restructure means changing the order of spoken content. It does not mean freely breaking sentences apart.

Rules:

- First confirm the target structure: chronological, by topic, by question, conclusion-first, tutorial steps, or short-form pacing.
- Move complete semantic units: complete sentences, ideas, answers, or steps.
- Do not split one sentence so the first half appears in one place and the second half elsewhere.
- After moving content, check whether connectors still work, such as "so," "but," "next," or "this."
- If the user asks for major restructuring without specifying the target structure, confirm before editing.

#### Hook / short version

Hook / short version work aims to make the opening more compelling or compress long content into a shorter but still complete version.

Rules:

- Prefer pulling the hook from the original footage: a strong claim, result, conflict, question, counterintuitive statement, or emotionally strong moment.
- If a new hook or new narration must be generated, confirm the direction with the user first.
- For short versions, do not cut only by duration. First identify the main line to preserve: problem, core point, key reasons, and conclusion.
- Short versions can remove examples, repetition, and setup, but must keep the logic needed for the point to hold.
- If the user gives a target duration, try to match it. If duration and semantic completeness conflict, explain the tradeoff.

#### Target-script / script alignment

Target-script / script alignment means cutting the final spoken content according to a user-provided script, target paragraph, or desired content.

Rules:

- The target script is the main constraint: prioritize content that matches the target meaning.
- Natural spoken paraphrases are acceptable, but do not include surrounding content that the target does not ask for.
- If the source has multiple similar versions, choose the most complete, natural, and target-aligned version.
- If target order differs from source order, reorder as needed, but move complete semantic units.
- If the target script omits source context, follow the target. Do not add long surrounding context unless the result would be incomprehensible without it.

#### Building versions, highlights, and excerpts — stay on Script

Highlight, short version, excerpt, hook, restructure, and making several versions are all transcript-content tasks: drive them through Script (\`read_script\` → edit \`timeline.md\` → \`apply_script\`), never by looking up timestamps and placing source clips manually.

- Pick the starting point by where the content comes from. Versions on the current timeline: trim or reorder \`timeline.md\` and \`apply_script\`. A version on its own timeline (the user asked for separate timelines, or wants each version independently editable/exportable): \`manage_timelines\` action=duplicate — the copy carries the content and its script, so you immediately \`read_script\` → trim → \`apply_script\` on it. Building fresh from library assets: \`manage_timelines\` action=create, add the source asset, then drive it through Script.
- To bring in source content the current cut no longer shows (a hook line, a segment needed for another version), read \`library/<filename>.md\`, copy the needed \`[sN]\` line(s) into \`timeline.md\` where they belong, and \`apply_script\`. This is how you pull source content onto the timeline — through Script.
- For multiple versions on one track: list every version's \`[sN]\` segments in \`timeline.md\` in version order, one version after another, then \`apply_script\` once. Reuse is just repetition — the same \`[sN]\` segment may appear in more than one version, and repeating the line replays that source range again.
- Never look up timestamps with \`find_transcript\` and place spoken content with \`edit_item\` / \`split_item\`. If you are converting transcript segments into source frame or second ranges, you are off the editing surface — return to Script. \`edit_item\` / \`find_transcript\` are only for non-transcript placement such as MG overlays and B-roll visual timing.

**Check each version against its request.** After assembling a version, highlight, or excerpt, re-read the result end to end and confirm every requested sentence is present, in the requested order, with no extra source carried in. Fix any dropped, duplicated, or out-of-order content before finishing.

### A-roll / transcript-based editing workflow

Use this flow for any A-roll task driven by transcript meaning.

1. Start with orientation. Call \`read_script\`, then read \`timeline.md\` once to understand the user's goal, the content structure, and whether fixed fillers or long pauses are present. If you will run \`clean_script\`, do not build the full semantic edit from this pre-clean read.
2. For cleanup tasks, run the mechanical cleanup pass before semantic editing when fixed fillers or long pauses are present. Use \`clean_script\` for fixed hesitation sounds (\`um\`, \`uh\`, \`er\`, \`ah\`, \`呃\`, \`额\`) and batch pause compression. If both are present, use the default \`clean_script\` pass so both are handled together. Do not use this step for context-dependent fillers, retakes, repeated sentences, or anything that needs meaning.
3. After \`clean_script\`, always read the refreshed clean \`timeline.md\` before semantic editing. Use this refreshed file as the source of truth; \`clean_script\` changes the canonical timeline and rematerializes the script, so previously read text may be stale. Do not edit from memory based on the pre-clean script. Then edit \`timeline.md\` with semantic judgment: choose the best retake, clean false starts, remove repeated or failed attempts, preserve useful setup and context, reorder content when needed, and keep the speech natural. For long transcripts, work one clear section at a time if that improves judgment accuracy.
4. Apply the edit with \`apply_script\`. If apply fails, fix the markdown error or stale state, re-read the current \`timeline.md\` if needed, and apply again.
5. Review the edited result. After a real \`apply_script\`, read the regenerated clean \`timeline.md\` and check what the viewer will actually hear: broken logic, missing context, over-deletion, missed cleanup, wrong order, or pauses that feel too tight or too long. Fix clear problems only. If the final result still needs batch pause adjustment, use \`clean_script only="silence"\`. Use \`read_script({ showSilence: true })\` only for manual adjustment of specific pauses.

### What transcript editing actually changes

Editing \`timeline.md\` is not just changing displayed text. It describes which source media ranges should play on the timeline.

\`[sN]\` rows are ASR segments, not semantic units. A complete sentence, idea, retake, or transition may span several \`[sN]\` rows, and one \`[sN]\` row may contain only part of a sentence. Before deciding what to delete or keep, mentally reconstruct the complete spoken sentence or idea across adjacent rows.

- Each spoken-text line maps to a playable source range.
- Inline \`~~...~~\` removes the corresponding audible audio range.
- Deleting a whole line removes that whole spoken segment.
- Moving/reordering lines changes playback order.
- \`apply_script\` applies the result back to the timeline.
- Start/end trims may remain as one trimmed clip.
- Deleting words or pauses in the middle of a sentence splits the original clip into multiple new clips: one kept range before the deletion and one kept range after it.
- Moving spoken content also creates a new clip at the destination.
- More clips after middle deletions or moves are expected and usually correct. Do not describe that as a "fragmentation problem" or as proof that word deletion is unsupported.

### Tool boundaries

Choose the editing goal and content boundaries first, then choose the tool. Do not let tool availability change the editing strategy.

- \`clean_script\`: use for mechanical first-pass cleanup: bulk removal of fixed meaningless fillers and batch silence compression/adjustment. It can process silence even when \`timeline.md\` is currently rendered without silence markers. Do not use it for context-dependent fillers, retakes, repeated sentences, or semantic decisions.
- \`read_script\` + \`apply_script\`: the main transcript-based editing surface. Use it for real semantic editing: deleting words, sentences, pauses, reordering, or pulling library content onto the timeline.
- \`manage_transcript\` action \`fix\`: only fixes ASR mistakes or speaker attribution. It does not cut audio and does not change what the viewer hears.
- Caption SEGMENTATION (分句 / where pages break) is INDEPENDENT of the transcript and controlled by two per-word primitives only: to SPLIT one card into two, set \`display_text\` \`forcePageBreak:true\` on the word that should START the new card; to MERGE a card up into the previous one, set \`display_text\` \`keepWithPrevious:true\` on that card's FIRST word (works for any break — no box resizing, no wordsPerPage fiddling). To drop a repeated/false-start word, use \`display_text\` \`hidden:true\`. Box width / fontSize / \`wordsPerPage\` are style & density knobs, NOT per-boundary segmentation levers — do not widen the box or raise wordsPerPage to merge or split a specific card. NEVER edit the transcript to fix a caption line break — \`manage_transcript fix\` is only for an ASR-misheard WORD (content), not layout. \`read_captions\` shows each page's \`break=\` reason and per-word keys for these edits.
- \`find_transcript\`: only locates when a phrase is spoken. It does not edit. If the next step is cutting spoken content, return to Script.
- \`Edit\` / \`Write\`: use these to modify \`timeline.md\`. The edit only reaches the timeline after \`apply_script\`.

Script details to preserve:

- \`read_script\` materializes \`timeline.md\` (current cut) and \`library/<filename>.md\` (full read-only source transcripts) in the workspace.
- Single-word audible deletion is supported with inline strike syntax, such as \`[s1] 过去~~呢~~一个月\`.
- Silence markers are hidden by default. Use \`clean_script\` for batch pause cleanup. Use \`read_script({ showSilence: true })\` only to expose \`[silence=Ns]\` markers for precise manual edits such as \`~~[silence=0.8s]~~\` or \`[silence=0.8s→0.2s]\`.
- \`find_transcript\` can locate a phrase for visual timing; it is not the editing surface. Do not use \`find_transcript\` + \`split_item\` / \`edit_item\` to cut, place, or assemble transcript-based clips — this includes highlights, hooks, excerpts, and multi-version cuts. All spoken-content selection, placement, and reuse happens in Script (\`read_script\` → edit \`timeline.md\` → \`apply_script\`).

---

## MG Overlay

### Goal

Motion graphics layered into A-roll reinforce what the speaker is conveying — deepening the audience's impression of the key points and helping them grasp content that's hard to land through speech alone. Complete A-roll editing first; MG timing is based on the post-edit timeline.

This section only adds talking-head timing, frame-composition, subject/caption protection, and review constraints. For visual style alignment, MG creation or authoring, implementation constraints, editable properties, asset sizing, and verification, use the active Motion Graphics skill/workflow available in the current OpenChatCut environment.

### MG workflow

For talking-head MG work, treat the video as one edited piece, not as isolated graphics.

1. **Understand the video** — read the transcript and representative frames to learn topic, audience / platform, visual tone, and speaker layout.
2. **Set the visual language** — use the active Design Style, the user's style / reference, a clarified direction, or visual presets from the active MG workflow.
3. **Choose useful MG moments** — add MG only where a visual layer improves comprehension, emphasis, orientation, or pacing.
4. **Prepare each moment** — decide the viewer job, content, visual mechanism, speech span, settled frame, read time, form, background, and composition relationship before creating the MG.
5. **Create through the active MG workflow** — pass the talking-head context into the current environment's MG creation/authoring path. Different viewer jobs, information structures, or visual forms should usually become distinct MGs; reuse only intentionally recurring components.
6. **Place, review, confirm, then extend** — check face, captions, readability, size, and composition. After the first real MG is placed in frame, confirm the effect with the user before expanding, unless they explicitly asked you to finish end-to-end.

### Visual identity

Design Style is the video's confirmed visual language. It gives MGs a shared tone, color logic, typography logic, visual density, and motion language. It keeps different MGs in one family without forcing them into the same shape. It does not decide which MGs are useful, when they appear, where they sit, or whether they are transparent / opaque; those remain per-MG editing decisions.

Resolve the visual language before planning MG moments. Use the active MG workflow for the actual style-alignment interaction and implementation details:

- **Active Design Style** — use it unless the user asks to change the overall style. If Project Context names an active Design Style but does not show details, inspect it once with \`manage_design_style action="get"\` before planning MG moments.
- **Specific user style / reference** — follow it. If it is custom and not yet confirmed for a batch, use a real planned MG as the sample when the user needs to approve the look.
- **Generic or vague direction** — quality words such as clean, premium, modern, professional, polished, or YouTube-style emphasis are goals, not a visual language. Follow the active MG workflow's style-alignment gate: prefer visual preset options, or use one representative MG for confirmation when the direction is textual / custom.
- **No visual direction** — use the active MG workflow to show relevant visual preset options. Talking-head can be used as a catalog filter when available.
- **"Directly do" / "don't ask"** — choose a concrete temporary direction from the transcript and footage, then continue without user style confirmation. Do not create or update a Design Style from this unconfirmed guess.

Picker is a visual Design Style selector. It shows preset thumbnails so the user can choose a visual direction by sight, instead of describing style in words.

1. Call \`manage_design_style\` with \`action: "list"\`. The catalog returns \`presetId\`, \`name\`, and a style summary (no scenario filter or thumbnails in this build); shortlist reasonable options by name/summary and the actual video context.
2. Render the shortlisted presets as concise numbered options via the form/widget route (name + one-line summary; this build has no preset thumbnails).
3. The picker is a turn boundary: after showing it, stop and wait for the user's submitted selection.
4. When the user picks an option, call \`manage_design_style\` with \`action: "apply"\` and the selected \`presetId\`, then inspect the applied Design Style with \`action: "get"\` before authoring.
5. If the user responds with text instead of picking, treat it as user direction and continue with the custom direction path.

Persist only confirmed visual language:

- **Picked preset** — the user confirmed it by choosing the visual option. Call \`manage_design_style action="apply"\`.
- **Custom direction** — after the user accepts the sample, treat it as the confirmed direction for the current MG work. If the current environment supports saving project Design Styles and the user accepts it as the shared project style, save/apply it with the agreed style facts.
- **Unconfirmed guess** — do not create or update a Design Style, including when the user said "directly do it".

After applying a preset or confirming a custom direction as the project style, tell the user in one or two natural sentences that this is now the video's visual style, future MGs in this video will follow it by default, and it can be changed or adjusted later.

### Where MG is useful

MG meaningfully helps comprehension or orientation when the content has:

- **Identity / context labels** — speaker name, role, product name, date, source, or a small persistent section label.
- **Key information / quotes** — a core concept, definition, statistic, conclusion, or key sentence worth emphasizing.
- **Structured information** — multiple points, steps, comparisons, rankings, lists, or processes.
- **Chapter / topic markers** — opening titles, section titles, topic transitions, or visual dividers between sections.
- **Abstract concepts** — cause-effect relationships, cycles, systems, frameworks, or other ideas that are hard to follow verbally.

### Repeated Components

One video should usually have one visual language, but not one universal MG shape.

Reuse a Motion Graphic asset only for intentionally recurring instances of the same component: same viewer task, same information structure, same visual form, and content changed through properties. Repeated chapter markers, recurring section labels, or a repeated status badge can share one asset. Different jobs such as an opening title, chapter marker, quote, list, diagram, and CTA should usually be separate assets that share palette, typography, motion tone, spacing, and material treatment.

An accepted first MG proves the visual language works in frame. It is not automatically a template for unrelated MGs.

### Per-MG decisions

For talking-head videos, do not start MG creation from transcript timing alone. Inspect the target frame first: transcript tells you what and when; the frame tells you form, placement, and background.

Before creating the MG, make four linked editor decisions. They prepare the active MG workflow and the later timeline placement.

| Decision               | Question                                                        | Output                                                          |
| ---------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| **Content**            | What idea deserves a visual layer?                              | Message or visual fact expressed by the MG.                     |
| **Timing**             | When should it land with the speech?                            | Timeline start, duration, read time, and internal motion beats. |
| **Form and placement** | What kind of MG is it, and where can it live safely?            | MG form / size, then timeline placement after asset creation.   |
| **Background**         | Is this an overlay on the talking-head shot, or its own moment? | Transparent overlay or opaque / full-screen beat.               |

#### Only for generator workflows that require a brief

Use this subsection only when the active Motion Graphics workflow explicitly asks you to write a generation brief or request for another model or generator, such as Gemini / motion-graphic-gen.

Skip this subsection for direct-authoring workflows. If you are creating or editing JSX yourself with \`create_motion_graphic_from_code\` / \`edit_asset\`, do not use \`referenceAssetIds\`, \`:template\`, \`:style\`, role anchors, or Gemini brief language.

For generator workflows, carry the visual language into the tool call. For now, templates are generation references, not direct-apply targets. Template refs from a Design Style are no different from any other template ID. For new MG assets, pass one code reference source: same-role role anchor with \`referenceAssetIds: ["<roleAnchorAssetId>:template"]\` only when the visual job, structure, and canvas role are the same; otherwise use the matched template ID directly, for example \`referenceAssetIds: ["<templateId>:style"]\`. If no template matches, write the confirmed Direction in the brief and use any accepted role anchor only for the same role. Template slot counts are not user constraints: if the user asks for more/fewer bars, rows, items, or data points than the template shows, generate a new structure instead of asking them to fit the slots.

When a template or role anchor is passed, keep the Gemini brief focused on content, role / broad form, background, and frame constraints. Let the reference carry detailed style and motion language.

Map the four shared decisions into a generator brief like this:

- **Content** -> \`Content\` in the brief.
- **Timing** -> timeline start, plus internal \`Timing\` only when the MG has its own beats. Internal \`Timing\` values say _when_ each element appears, not _how_ it moves; leave the motion style to Gemini.
- **Form and placement** -> \`Size & shape\` in the brief, not final canvas placement. Do not write final \`left\`, \`top\`, \`right\`, \`bottom\`, coordinates, or placement anchors such as "lower-left" / "top-right" into the Gemini brief.
- **Background** -> \`Background: transparent\` or \`Background: opaque\`.

#### 1. Content

Choose what the MG expresses, not just what text it repeats. The content may be a speaker identity, distilled quote, key term, statistic, list, comparison, relationship diagram, chapter marker, or another visual representation of the point.

#### 2. Timing

Choose the timeline anchor first. The MG should land with the relevant speech beat or section boundary, not trail after the speaker has already made the point. Use \`find_transcript\`; pass \`includeWordTimestamps: true\` when the MG has internal rhythm such as list items appearing one by one or multi-step reveals.

Write internal timing values relative to the MG's own start time. The timeline item start is the absolute video position; internal timing is the MG-internal rhythm after that start. Exit when the point is fully made.

#### 3. Form and placement

Choose the MG form and likely placement region before creating the asset. The active MG workflow creates the graphic; place the finished asset on the video canvas afterward.

Placement principles:

- **Protect the subject and safe zones.** Avoid the speaker's face, head, hair, glasses, mouth, chin, important products or objects, relevant hand gestures, captions/subtitles, and existing on-screen elements.
- **Keep the caption/subtitle area clear.** If captions may appear, bottom overlays must sit above the caption band, not compete with or cover subtitles.
- **Separate overlays from full-screen MGs.** Subject/safe-zone protection applies to overlays on top of A-roll. A full-screen MG is an intentional visual beat that replaces the A-roll for its duration, so it may cover the speaker and background.
- **Keep the composition intentional.** The MG should support the speaker and message. It should not look like a random sticker, compete with the face, or make the frame feel unbalanced.

Common forms and areas:

| Content type                 | Common form                                               | Common area                                                                                                                     |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Identity / context**       | Name tag or small context label                           | Lower-third first; lower-left or lower-right depending on the shot.                                                             |
| **Key information / quotes** | Typographic quote, pull quote, or emphasis treatment      | Lower-center / lower-third; side area if the bottom is crowded; full-screen for a major punchline, conclusion, or pause.        |
| **Structured information**   | List, step stack, comparison layout, or compact diagram   | Left/right side areas or bottom horizontal area; full-screen if the information is too dense for an overlay.                    |
| **Chapter / topic markers**  | Full-frame title, title overlay, or side title panel      | Full-screen for a strong intro or section break; lower-third for a light cue; side panel when one side has obvious open space.  |
| **Abstract concepts**        | Concept visual, relationship map, cycle, framework, chart | Lower-third if light and readable above captions; side area or full-screen if denser.                                           |
| **Tiny auxiliary labels**    | Badge, status label, logo-like mark, section marker       | Top corners can work here only. Do not use top-left/top-right as the default home for primary opening titles or chapter titles. |

Use the MG's intrinsic form constraints, not final canvas placement, when deciding asset shape. Good examples: "lower-third-style name tag", "compact side treatment", "bottom horizontal strip", "full-screen title beat". Do not bake final canvas coordinates into the asset unless the MG is intentionally full-frame.

For familiar forms like speaker name tags, give the form and content without forcing dimensions early. For constrained overlays, describe the intended rough form or usable area. For full-screen MGs, make the form explicit in **Size & shape** and choose \`Background: opaque\`.

From the target screenshot, include canvas tone only when it affects legibility: for example, \`Other context: dark interior scene — keep the design bright/light enough to read clearly.\`

#### 4. Background

Choose background from the form:

- Use \`Background: transparent\` for talking-head overlays: lower-thirds, side treatments, quote treatments, compact diagrams, and other graphics that sit over A-roll. A transparent root may still contain internal semi-transparent or solid panels.
- Use \`Background: opaque\` when the MG is its own visual surface: full-screen opening titles, strong chapter beats, full-screen information layouts, and full-screen emphasis moments.
- For full-screen opaque MGs, do not add a separate \`solid\` item underneath as a color matte. The MG owns the frame; change its \`bgColor\` / \`transparentBackground\` properties instead. Do not create temporary solid fallbacks; if you encounter an old transparent-MG-plus-solid fallback while replacing it with an opaque generated MG, delete both fallback pieces, not only the old MG.

Default to a transparent overlay unless a full-screen beat is intended — guessing full-screen/opaque silently is what covers the speaker's face or blanks the frame.

#### Place and review

- Place with \`edit_item\` (adds/updates). Prefer an explicit rectangle once you know the frame: \`left/top/width/height\` for direct placement, or \`right/bottom/width/height\` when right/bottom margins are clearer.
  - **\`left\`** — explicit x position. **\`right\`** — margin from the canvas right edge. Do not pass both.
  - **\`top\`** — explicit y position. **\`bottom\`** — margin from the canvas bottom edge, symmetric with \`right\`, e.g. \`{ right: 80, bottom: 150, width: 500, height: 350 }\` for a bottom-right overlay. Caption-safe defaults: \`bottom: 162\` (landscape 1080p) or \`bottom: 576\` (portrait 1080×1920). Do not pass both \`top\` and \`bottom\`.
- Use a natural-box asset for overlays: the MG asset \`width\` / \`height\` should tightly bound the local visible composition, not the project canvas. Place and scale that local asset on the timeline. Use timeline-sized assets only when the visible design intentionally spans the whole frame.
- Asset dimensions from \`track_progress\` / project state are practical aids for resizing and placement, not the final judge.
- Verify with screenshots. Pass multiple frames in one tool call — settled state appears alongside any transient mid-animation frames. **Compare frames before concluding**: apparent truncation, missing elements, or "broken design" visible in only some of the batch is animation, not a real flaw. If unclear, re-capture more frames around the suspect one before adjusting anything. Judge from the settled frames. For multiple placed MGs, batch their settled frames into a single call.
- Check the full frame: face/head is clear, important objects and gestures are clear, caption zone is clear when relevant, MG is fully visible, MG content is correct, text is legible, no readable text overlaps, and the composition feels balanced and intentional.
- If it fails, first adjust position and size. If position/size cannot make it work, edit the asset or change the design form. Verify each intentionally recurring component on a target frame before expanding it.

---

## B-roll

### Goal

Enrich visual layers and cover jump cuts left by A-roll editing.

### Where B-roll is useful

- **Cover jump cuts** — when A-roll editing leaves visible jump cuts the user wants to hide
- **Visualize specific references** — when the speaker mentions objects or scenes that benefit from showing

B-roll depends on having suitable footage and adds production effort — treat it as an optional enhancement, not a default. Apply only when the user opts in or there's a clear visual problem to solve.

### Sources

Footage can come from three places: clips already in the project library, stock via \`search_stock_media\` then \`push_asset\` with the returned import args, or AI generation via the \`video-gen\` skill (Seedance / Kling / Hailuo when configured). Pick based on the user's need; if unclear, align with the user upfront.

### How to place

Don't cut away in the first or last 3 seconds. For dense jump cuts (<3s apart), use one long cutaway covering multiple. Don't overlap with MG by default.

First decide the B-roll mode:

- **Full-screen cutaway** replaces the talking head for that moment. Use it when the user asks to show the B-roll full screen, cover jump cuts, or the B-roll needs the full frame to be readable.
- **PiP / small-window overlay** keeps the talking head visible. Use it when the user asks for overlay/PiP, the existing edit style clearly uses small-window B-roll, the user says the talking head can remain visible, or the B-roll is a quick supporting visual.

If the user only says "add B-roll" and the mode is not implied by the existing edit, ask once: "Should these be full-screen cutaways or small rounded-corner PiP overlays?"

For **PiP / small-window overlay**:

1. Inspect the target timeline frame first. Compare candidate destination rectangles in the actual shot. Exclude areas that would cover the A-roll's face/head, mouth, important gestures, captions/subtitles, existing overlays, products/logos, or other visible subjects. Among safe candidates, choose a rectangle that can show the B-roll at a useful readable size, preferring the largest blank or low-information area while keeping the composition balanced.
2. Inspect the B-roll source frame(s). Identify the primary subject/action, protected information, and safe-to-lose areas. Any readable text/UI, name/title, logo, brand strip, product edge, card, poster, or document boundary is protected by default unless the user explicitly approves losing that exact information.
3. Place the overlay at a useful size inside the chosen destination rectangle. Keep the B-roll's protected information visible/readable and the A-roll's protected content unobstructed. Do not default to a fixed corner or lower-third position when another candidate has more usable empty area.
4. Set the media item's native \`borderRadius\` to 24-36 by default unless the requested style is square/sharp. Do not add a mask/effect solely for ordinary rounded PiP corners; use effects only for special shapes or item types that cannot use native \`borderRadius\`.
5. Screenshot the affected frame before reporting success. If the only non-obstructive PiP would be too small to understand, switch to full-screen cutaway, choose a different source moment/asset, or ask the user to choose the trade-off.

For **full-screen cutaway**:

1. Compare the source aspect ratio with the canvas aspect ratio before choosing fit; do not default to cover without this check. For close aspect ratios, such as portrait source into portrait canvas or landscape into landscape with less than about 30% difference, use a full-canvas \`fit:"cover"\` first-pass so the B-roll owns the visual beat.
2. For substantially different aspect ratios, such as landscape media in a vertical canvas or vertical media in a landscape canvas, do not place directly with cover. Inspect the source with \`view_asset_frames\` before choosing fit if you have not already viewed it. Use \`read_script\` to choose representative video moments and sample more frames with \`view_asset_frames\` when the protected region is not obvious.
3. Identify whether protected information would be distributed across the area that cover would crop. Any readable text/UI, name/title, logo, brand strip, product edge, card, poster, document boundary, or subject on both sides of the frame is protected by default.
4. After inspection, cover or safe crop is acceptable only if protected information would survive the crop, such as a single centered subject with low-information edges. Low-information contextual media, such as scenery, crowd shots, or other mood/context footage with no specific text or subject that must be preserved, can use cover even with a substantial aspect-ratio difference.
5. If protected information would be lost, such as text/logos near edges, subjects on both sides, or a wide information layout like a fixture table or match poster, use \`fit:"contain"\` for the foreground and add a deliberate full-screen background such as an opaque MG background/matte that matches the edit or a blurred/enlarged duplicate/background layer. If a cover attempt only trims a compact subject/action that can be recovered without hiding other protected information, try a safer reframe/crop that moves the source protection frame fully into the canvas and closer to the intended center of attention.
6. Apply the fit strategy per source asset, not as a batch default. Even when the user asks for cutaways, do not batch-place multiple images or clips with \`fit:"cover"\` without checking each source's aspect ratio and protected content first.
7. Screenshot the final frame and compare it with the inspected source frame(s). Verify that the foreground still preserves the source's protected information, not just that the final canvas looks filled.

After editing, read back the exact item ids you changed. An asset appearing in the library is not proof it is on the timeline; \`read_project\` must show the new/updated B-roll items. If the result involved crop, fit, scale, overlay placement, or a full-screen composition trade-off, verify the affected frame with a screenshot or visual analysis before reporting success, then fix failed source/destination protection or state the unavoidable trade-off. Do not report success if the target items are unchanged.

---

## Multicam (multiple camera angles of the same take)

When the user has **two or more cameras recording the same moment** — cues like "both angles", "the same interview", "multi angles", "alternate angle", "cut to the other angle", "angle switch", 换角度, 两个机位 — switching to another angle means the picture changes but the **audio and lip-sync must stay matched** to the take.

**Do not hand-compute source offsets with \`edit_item\` to line angles up.** Manual offsets drift wherever the underlying reference angle was cut, and the drift only shows up later as out-of-sync lips. Use the **\`multicam_sync\`** tool instead: it runs the editor's audio-based alignment engine and repositions each angle clip so its picture matches the reference angle's audio. Pass the angle clips' \`itemIds\` (the reference plus the follower angle(s)); optionally name the \`referenceItemId\`.

Key constraint: a **single cutaway clip that spans a cut in the reference angle** can't be aligned as one piece — split it at that cut with \`split_item\` first, then pass both pieces to \`multicam_sync\` so each maps to the reference segment beneath it.

\`multicam_sync\` runs in the user's editor (no backend path): if it reports the editor isn't open, ask the user to open the project, then retry. After it applies, read the project back to confirm the alignment.

---

## Track roles (turn on auto-ducking)

A track's \`role\` is the single declaration that drives the audio mix. Set it with \`edit_track\` and the engine derives a seamless duck — followers dip under speech, then rise back in the gaps — without you hand-adjusting any volume. There are only two roles, plus off:

- The talking / interview / lecture track (and any voiceover / narration) is the **anchor**: set its \`role\` to \`anchor\`. This is the track everything else ducks under — set it, or nothing ducks.
- Background music, ambient beds, and b-roll audio beds that should sit under speech → the **follower**: set \`role: follower\` (auto-ducks under every anchor).
- Short sound effects (SFX), stingers, hits, whooshes, clicks, and other editorial accents usually stay out of ducking → leave their track role unset unless the user explicitly wants those accents tucked under speech.
- Anything that should stay out of ducking → leave its \`role\` unset (none).

A track with no role behaves exactly as today — roles are additive and safe, so you only set them where the content makes the job obvious.

**Read the existing layout first.** Before creating tracks or placing new clips, read the current track names and roles — if a track is already tagged for this content (a \`follower\` named "Music", an \`anchor\` named "VO"), put the new clip there and match its role; only make a new track when nothing fits. **Organize before you assign — roles are per-track, so aim for one role per track.** If the same kind of content is scattered across several tracks (e.g. the voice on A1 _and_ A3), consolidate it onto one track _first_: move the clips with \`edit_item\` (\`updates[].trackId\`), then delete the emptied track by id with \`edit_track\`. Then assign the role once. While you're laying tracks out, stack them the way a mixer reads a session — **voice/VO on A1, the top audio lane; music below it** — and give each a short name like "VO" or "Music" so the spoken word stays easy to find. A sensible default, not a rule; follow the user's intent when the layout should differ. Keep deliberate separation, though — two _different_ speakers, clips that overlap in time, or intentional layering each stay on their own track (and each still gets its role). After assigning, read the project back to confirm every track that should anchor/duck does, and that you left the music's base volume alone.

---

## Background Music

### Goal

Set the mood and smooth over micro-gaps in speech.

### Principles

- Set the music track's \`role\` to \`follower\` with \`edit_track\` (and the talking track's \`role\` to \`anchor\`). That single pair turns on auto-ducking — the engine dips the music under speech and lifts it back in the gaps.
- Let \`edit_track\` initialize \`audioRouting.duckDepthDb\` from the current timeline loudness when it can. Pass \`audioRouting.duckDepthDb\` yourself only when the user explicitly wants the music louder or softer under speech.
- Keep the BGM clip's base \`decibelAdjustment\` natural by default. Do not pre-duck music with a large negative clip gain, then also set manual \`duckDepthDb\`; only do both when the user explicitly asks for a lower overall bed and a stronger / weaker speech duck.
- Do not put short sound effects (SFX) or stingers on follower tracks by default. Place them at their editorial moment and adjust item volume only if they are clearly too loud or too quiet.
- No prominent lyrics
- Fade BGM in/out with \`audioFadeIn\` / \`audioFadeOut\` in seconds, usually 1-2 seconds. Do not pass frame counts to these fields.
- Tone matches content

### Fit to duration

Fit BGM to the final video extent after A-roll timing is finalized. The target duration runs from the BGM start to the real content end (video / visual / speech items), excluding the BGM itself so music never extends the render.

- Unless the user specifies a different BGM start, start BGM at frame 0.
- If generated BGM is longer than the target, place one \`audio\` item at the BGM start, set its duration to the target duration, and add a fade out. Do not let the full music asset run past the last visual item.
- If generated BGM is shorter than the target, do not stretch one audio item past the asset length; it will end in silence. Instead, tile multiple \`audio\` items until the target is covered.
- Before placing tiled BGM, calculate how many segments are needed to cover the full target duration, accounting for the planned 1-2 second overlaps. Place all segments in one pass so the whole timeline is covered, then trim the final segment to the target end.
- For tiled BGM, use alternating audio tracks (for example A2/A3) so adjacent repeats can overlap by 1-2 seconds. Fade out the earlier segment and fade in the next segment over the overlap.

### How the engine ducks music

Ducking is automatic once the music track's \`role\` is \`follower\`: the engine dips the track under audible \`anchor\` tracks (the speech / voice), and lifts it back to full level in pauses and the outro. This needs both halves — the music track has \`role: follower\` **and** the talking track has \`role: anchor\` (see Track roles above). If nothing is set to \`anchor\`, nothing ducks and the music stays at full level.

Set music to a normal, audible base level where there is no speech. To tune the dip under speech, update the follower track's \`audioRouting.duckDepthDb\`; otherwise leave it unset and let \`edit_track\` auto-initialize from timeline loudness when available. Do not solve speech clarity by heavily lowering the clip and also manually deepening the duck. To keep a track out of ducking entirely (for example a stinger that should punch through), leave its \`role\` unset (none).

---

## Captions

### Goal

Improve accessibility and engagement with on-screen text.

**Captions are transcribed from the source audio — they always match the speaker's language. Translation between languages is not supported.** Don't ask the user what language they want captions in; pick the preset by source audio language + target aspect ratio.

### Presets

Use only built-in \`edit_captions\` preset names. There is no \`youtube\` or \`vox\` caption preset; platform names describe the target video, not a preset name.

| Source audio language | Aspect Ratio   | Recommended Preset |
| --------------------- | -------------- | ------------------ |
| English               | Portrait 9:16  | tiktok or submagic |
| English               | Landscape 16:9 | studio or submagic |
| Chinese               | Any            | netflix            |
`,ye='---\nname: transcription\ndescription: Use when a video/audio task needs OpenChatCut transcription, captions, subtitles, subtitle styling, transcript search, transcript readiness checks, or enabling captions, including local or attached videos where the user asks to add captions/subtitles, transcribe, create bilingual subtitles, clean talking-head speech, remove filler words, or trim pauses.\n---\n\n# Transcription\n\nFor newly imported local/client-held media, use `import_media` to start transcription, then wait with `track_progress`.\n\nTypical flow:\n\n1. `read_project` with `view: "assets"` to get the video/audio asset ID and transcript status.\n2. If this is a fresh client-held import, make sure it went through `import_media action=create_session` plus the OpenChatCut media import helper.\n3. Call `track_progress` with `action:"wait"`, `target:"transcription"`, and `assetIds` set to the asset ID or prefix.\n4. Use `find_transcript` to search transcript text and confirm word timestamps.\n5. Use `edit_captions` action `enable` or `read_captions` as needed once transcription is ready.\n\nExample:\n\n```json\n{\n  "action": "wait",\n  "target": "transcription",\n  "assetIds": "13c1aa02cd"\n}\n```\n\nUploaded assets start ASR automatically on ingest, but nothing waits for it. Always use `track_progress` for readiness.\n\nFor local-only video assets with `local-only; original upload deferred` in `read_project`, transcription cannot run until the bytes are reachable by the backend. Import the source again via the `asset-import` skill (which uploads to S3) or `download_media` from a public URL; do not ask the user to relink it manually in the editor.\n\n## Stuck Transcription And Retry\n\nDo not declare transcription stuck from one non-terminal status. Base the decision on both asset length and the time the agent has actually waited in this task.\n\n1. Read the asset with `read_project` `view: "assets"` and note its duration when available.\n2. Start counting elapsed wait time from the first `track_progress` `action:"wait"` or from the earliest reliable in-task timestamp where the agent observed transcription as pending/running.\n3. If transcription reports an explicit failed, errored, or timed-out terminal state, retry immediately after confirming the asset is remote-ready and is video/audio.\n4. If transcription remains pending/running with no failure, treat it as stuck only after elapsed wait time exceeds `max(5 minutes, min(60 minutes, 2 × asset duration))`. For example, wait at least 5 minutes for a 30-second clip, about 20 minutes for a 10-minute asset, and about 60 minutes for a 1-hour or longer asset.\n5. If duration is unknown, wait at least 10 minutes across more than one `track_progress` call before treating it as stuck, unless the tool reports an explicit failure.\n\nWhen stuck, use `manage_transcript` with `action: "retry_transcription"` and the asset id/prefix. This force-retries ASR for audio/video assets and starts a new transcription run; it does not wait for completion. After retrying, call `track_progress` with `target:"transcription"`, `action:"wait"`, and the returned or same asset id before reading transcripts or captions.\n\nExample retry:\n\n```json\n{\n  "action": "retry_transcription",\n  "asset": "13c1aa02cd"\n}\n```\n\nIf captions read back as empty, check the source-time range of the timeline clip. A transcript can be ready while the current visible clip starts before the first spoken word; add or trim a clip so the transcribed source words fall inside the timeline range, then extend/update the captions item duration if needed.\n\nUse the raw tools when you need finer control:\n\n- `track_progress` with `target: "transcription"` for status/wait.\n- `find_transcript` for query-based transcript lookup.\n- `read_captions` and `edit_captions` for caption display edits.\n- `manage_transcript` action `fix` for source transcript repair.\n- `manage_transcript` action `retry_transcription` to force-retry ASR after a transcription is stuck, timed out, or failed.\n- `clean_script` for mechanical timeline playback cleanup of fixed fillers and batch pauses after transcript-ready media is on the timeline.\n\nWhen a transcript-ready request becomes an editorial talking-head edit, follow the public-safe talking-head workflow in shared `talking-head-guide`. In short: use `clean_script` only for mechanical cleanup, then use Script (`read_script` -> edit `timeline.md` -> `apply_script`) for semantic repeated-take, silence, filler, or coherence edits, and verify the resulting script rather than trusting tool success alone.\n',be=`---
name: verification
description: Use when checking whether agent edits are reflected in the OpenChatCut project and editor.
---

# Verification

Use the lowest verification level that proves the requested result:

| Level | Required evidence |
|---|---|
| L0 | Static checks such as the focused verification script, \`npx tsc --noEmit\`, tests, and build. |
| L1 | A real Agent run against the editor at \`localhost:5199\`, followed by structural and rendered evidence. |
| L2 | The packaged desktop app completing the user scenario, including human visual review where automation is insufficient. |

Runtime behavior changes require L0 + L1. Release and desktop-only changes also
require L2 when the packaged app is the behavior under test.

Prefer two signals:

1. \`read_project\` for structure: assets, tracks, items, frame placement, timeline duration.
2. A visual capture path for rendered evidence at exact frames.

Use \`view_timeline_frames\` for composed timeline proof. This verifies the edited OpenChatCut timeline: trims, layers, captions, effects,
markers, placeholders, crops, transitions, and layout.

For raw source-asset frame inspection, choose the cheapest path based on where
the bytes live:

- The agent in this build has no local filesystem access; all source bytes live
  in the project media store (\`/media/uploads/\`). Use \`view_asset_frames\` with
  the project asset id — the server takes an ffmpeg contact-sheet fast path
  automatically, so it is already the cheapest source-frame route.
- \`view_timeline_frames\` renders the composed timeline (the editor-truth check);
  \`view_asset_frames\` samples raw source frames. Pick by what you are verifying.
- There is no separate \`get_contact_sheet\` tool in this build — the contact
  sheet is what \`view_asset_frames\` / \`view_timeline_frames\` already return.

Use local/remote source-frame artifacts only for source understanding, moment
selection, and rough trim decisions, not as edited output or timeline proof.

For local-only or upload-in-progress media, composed timeline proof may be
blocked until the asset has bytes available to the renderer. Source-frame
inspection via \`view_asset_frames\` still works as long as the asset's bytes are
on disk (\`/media/uploads/\`).

If both visual proof paths are blocked, ask the user to inspect the OpenChatCut
editor directly and note the blocker explicitly.

Useful checks:

- After import: \`read_project({ "view": "assets", "assetId": "<prefix>" })\`
- After move/trim: \`read_project({ "view": "timeline" })\`
- After visual overlay or MG on any timeline media: \`view_timeline_frames({ "frames": [30, 45, 75] })\`, then look at the returned frames.
- For user-requested source selection or visual moment picking: sample stills with \`view_asset_frames\` and inspect them. Use that only to choose source files, moments, and rough trims. Build the visible edit as OpenChatCut timeline items. Do not treat raw source inspection as timeline verification or as permission to produce the edited video elsewhere.
- For source-frame inspection: call \`view_asset_frames({"assetId":"...","sourceTimesMs":[...]})\` after \`read_project({"view":"assets"})\` confirms the asset id/type. Prefer this over asking the user to reattach the file.
- For local-only visual verification: upload/register cloud-readable media before relying on connector visual proof.
- For no-source validation: confirm the tool manifest exposed the parameters you used, then record the visible proof in the trace log.

When talking about seconds, verify the fps from \`read_project\` or use adapter tools that resolve fps internally.

When reporting a timeline item location, use only the latest \`read_project\` structure for track alias, item id, start, duration, and asset id. Do not report planned/default tracks or tool-call intent as verified placement.

Do not treat a command-line JSON response alone as sufficient when the user asks whether the editor reflects the result. Use the editor URL or visual proof when practical.

## Real Agent transcript check

After every L1 Agent run, inspect the complete chat record before reporting
success:

1. Read the final assistant response and every tool row created by the run.
2. Expand failed or warning rows and record the exact error.
3. Check for aborted turns, repeated retries, stale proposals, incomplete jobs,
   and tool results that the final response incorrectly describes as successful.
4. Compare the latest \`read_project\` result with the visible timeline.
5. For visual edits, inspect returned timeline frames rather than trusting the
   assistant summary.

A run with a correct-looking timeline but an unreported tool error is not a
clean pass. Fix the cause or report the remaining error explicitly.

If verification fails, classify the gap before changing tools:

- tool description or schema was insufficient
- skill instructions were missing a step
- \`read_project\` did not expose enough state
- editor authorization did not complete
- media/transcription pipeline failed
- cloud render/editor observation was blocked
`,xe=`---
name: video-gen
description: |
  AI video generation via Fal.ai, Seedance 2.0, Kling, MiniMax Hailuo, xAI Grok Imagine, and OFox. Use when the user wants to generate a video clip — text-to-video, image-to-video, first/last-frame transitions, reference-guided generation, multi-shot, or generatively editing / extending an existing clip.
user-invocable: true
---

# Video Gen

Submits one video generation job per call and returns a \`jobId\`. Job management (wait / status) belongs to \`track_progress\`; this skill does **not** place videos on the timeline automatically.

## When to Use

Any time the user wants to generate a video clip — text-to-video, image-to-video, first-last-frame transition, reference-based generation, multi-shot storyboard, or generatively editing / extending an existing video (producing new generated footage based on a source clip; not timeline trimming).

## Models

| Model | Reference | Strengths |
| --- | --- | --- |
| \`fal\` + \`falModel\` | [references/fal.md](references/fal.md) | Explicit Fal catalog; see tool schema for per-model limits |
| \`seedance2\` | [references/seedance2.md](references/seedance2.md) | Default when configured. Multimodal refs, first/last, edit/extend/bridge, 2–15s, 480p/720p/1080p/4k, audio/seed/camera/watermark/last-frame/task controls. |
| \`kling\` | [references/kling.md](references/kling.md) | Technical camera/performance; Omni multi-shot; images ≤7 (≤4 with one feature \`refVideos\`); std/pro; 3–15s. |
| \`hailuo\` | [references/hailuo.md](references/hailuo.md) | MiniMax 海螺. T2V / I2V / first+last; **6s or 10s**; 512P (Hailuo-02), 720p→768P, 1080P (6s); no multi-ref / multi-shot. |
| \`grok-imagine-video\` | [references/grok-imagine-video.md](references/grok-imagine-video.md) | xAI Grok Imagine. Text-to-video only; 1–15s; 480p/720p/1080p; audio track included. |
| \`ofox\` | [references/ofox.md](references/ofox.md) | OFox multi-model gateway (Seedance/Wan and more behind one key). Text/image-to-video, first+last frame, up to 9 image refs; 2–30s with per-model API limits; 480p/720p/1080p per model. |

**IMPORTANT:** Before generating, READ the chosen model's reference for capabilities, input channels, modes, prompt structure, and model-specific behavior. Never invent params the reference forbids.

## Model Selection

Respect **configured vendors** from the capabilities prompt (only call a model whose key is on).

1. **User named a vendor** ("用海螺", "MiniMax", "Kling", "Seedance") → that \`model\`, if configured.
2. If Fal.ai is selected or requested, use \`model: "fal"\` and the requested \`falModel\` or saved Fal default from capabilities. Ask if no Fal model is selected. Read the Fal catalog constraints in the tool schema; the native-provider limits below do not apply.
3. Else **default \`seedance2\`** when Seedance is configured.
4. Else if only Kling is on → \`kling\`. Else if only MiniMax is on → \`hailuo\`. Else if only xAI is on → \`grok-imagine-video\`. Else if only OFox is on → \`ofox\`.
5. Switch away from default when:
   - Need **multi-shot customize / intelligence** → \`kling\` (confirm if not user-named).
   - Need **rich multi-modal refs** (video/audio refs, edit/extend) → \`seedance2\`.
   - Need a **short single beat** and only MiniMax is available, or user wants Hailuo → \`hailuo\` with duration 6 or 10.

If the required model is **not configured**, say so and offer: another configured video vendor, upload, or Motion Graphic — do not pretend the API exists.

Briefly tell the user what you will generate before submitting.

## Tool Params

| Param | Values | Default |
| --- | --- | --- |
| \`model\` | \`seedance2\`, \`kling\`, \`hailuo\`, \`grok-imagine-video\`, \`ofox\`, \`fal\` | seedance2 when available |
| \`durationSeconds\` | model-specific | seedance/kling ~5; **hailuo 6 or 10** (1080p → 6 only); **grok 1–15**; **ofox 2–30 (per-model API limits)** |
| \`ratio\` | see model docs | 16:9 (seedance/kling/grok/ofox); **ignored on hailuo** |
| \`resolution\` | \`480p\`, \`512p\`, \`720p\`, \`1080p\`, \`4k\` | provider-specific; hailuo adds 512p for Hailuo-02; grok: 480p/720p/1080p |
| \`refVideoMode\` | \`feature\`, \`base\` | kling only, with \`refVideos\` |
| \`promptOptimizer\` / \`fastPretreatment\` | boolean | hailuo only |
| \`generateAudio\`, \`seed\`, \`cameraFixed\`, \`watermark\` | controls | seedance only |
| \`returnLastFrame\`, \`executionExpiresAfter\`, \`priority\` | controls | seedance only; requested last frame becomes another image asset |
| \`name\` | descriptive asset name | required for good pool UX |
| \`firstFrame\` | project image asset ref | optional |
| \`lastFrame\` | project image asset ref | seedance / kling / hailuo (requires firstFrame; not with multi-ref on seedance) |
| \`refImages\` / \`refVideos\` / \`refAudios\` | asset refs | seedance full; kling: images + **1** feature video (no audio); hailuo: none (frames / S2V subject) |
| \`mode\` / \`shotType\` / \`multiPrompts\` | Kling multi-shot | kling only |

Model-specific params — see the model's reference.

## Input Resolution

\`firstFrame\` / \`lastFrame\` / \`refImages\` / \`refVideos\` / \`refAudios\` all take a project asset reference. Prefer a full UUID or short prefix from \`read_project\`; \`asset://<id>\` and same-project asset URLs returned by \`read_project\` are also accepted. Per-slot type: frame slots and \`refImages\` → image; \`refVideos\` → video; \`refAudios\` → audio.

External URLs and base64 are not accepted. If the source is a public URL, download it into the project first (\`download_media\` for video/audio, \`submit_image\` for images) and pass the resulting asset id.

## Workflow

Four-step loop. For each new generation, restart from Step 1 if the user's intent has shifted.

### Step 1 — Align scope with the user

Before writing any prompt, align on three dimensions:

1. **Duration & segments** — total length, how many shots, and whether they live in one clip or several.

   If the user has already stated a direction ("做一段", "in one video", "分别生成", "split into N shots", etc.), follow it — don't second-guess.

   Otherwise, surface the two paths and let the user pick:
   - **Multi-shot within one clip** (see model ref) — single inference, subject / lighting / style physically consistent across sub-shots; fits a coherent narrative within the per-clip duration cap.
   - **Multiple clips** — each clip is independently controllable and re-rollable, but identity and style continuity have to be carried by anchors; fits durations beyond the cap or hard scene breaks.

   Offer the trade-off; do not pick for the user.

2. **Content** — what each clip depicts. Summarize back what you understood, segment by segment. When content is vague (e.g. "generate a video of a girl dancing"), the user typically hasn't specified one or more of:
   - **Subject**: who / what is the main subject (appearance, outfit, defining features)?
   - **Action**: what are they doing? (For talking / emotional shots, what micro-expression?)
   - **Scene**: where — setting, time of day, environmental details?
   - **Lighting / color mood**: what atmosphere?
   - **Camera**: any shot-size / angle / movement preference?
   - **Style**: visual style or reference (cinematic / anime / documentary / ...).

   Focus on the items that matter for this specific request and can't be safely inferred — don't turn this into a blank-filling exercise. Summarize the understood parts back to the user before proceeding.

3. **Consistency anchors** — only when multiple shots reuse a character, object, or scene: identify which anchor (reference image or video) to pin across shots. For sourcing rules, see §Visual consistency across shots below.

For each dimension, check the user's words:

- **Clear** — proceed.
- **Ambiguous or missing** — ASK the user. Do not guess, do not default to your own interpretation. A round-trip confirmation is cheaper than a wasted generation.

#### What NOT to do

- **Do not "tell then submit"** — announcing "I'll make this as 2 clips" and immediately submitting is not alignment, it's a unilateral decision with announcement.
- **Do not default to splitting a single-video request into multiple clips.** A single clip can carry multiple sub-shots (see model ref), with subject / lighting / style physically consistent across them. Surface the trade-off, then let the user choose.
- **Do not skip the ask** because you think the answer is obvious.

#### Hard overrides (user's explicit word wins)

- "one clip / single clip / 一条 / 一个镜头 / in 1 clip" → never split, even if the description is objectively long.
- "N shots / N 段 / N 个镜头" → generate exactly N.
- "use this image / 用这张图" → use as reference, don't substitute.

### Step 2 — Write the prompt

See the chosen model's reference for prompt structure and param combinations (e.g., Seedance's 8-element structure and modes; Kling's prompt tips). Before submitting, check:

- \`name\` is a **descriptive** asset name — descriptive enough for the user (and you in later turns) to recognize this asset in the project library. Avoid vague names like "Untitled" or "clip 1".
- Param combination matches the user's intent — see the **Modes** section in the model's reference.
- Generated video audio is not a tool parameter (provider-side). Hailuo has no ratio/multi-ref; do not invent those params.
- On validation failure, read the error and fix the inputs — **do not blindly retry the same invalid arguments**.

### Step 3 — Submit one, wait, confirm

**Submit one generation job at a time.** Unless the user explicitly asked for multiple clips in parallel, do not submit the next clip until the current one completes and the user has reviewed it. Parallel submission hides problems: if the first shot has drift or wrong framing, the user would rather redo it once than have several misaligned shots to discard.

- \`submit_video.ratio\` controls the generated asset only; it does not change the project timeline canvas. If the user requested a final output aspect ratio (for example "9:16 vertical" or "16:9 landscape"), set the timeline canvas to the same ratio with \`manage_timelines\` action=update (e.g. ratio:"9:16") before placing the completed asset. If the user asked for no black bars / full-bleed, pass \`fit:"cover"\` when setting the canvas or updating/adding the visual item.
- Do not use this skill for job management — use the \`track_progress\` tool for status/wait.
- After submitting, end your turn (tell the user the job was created) unless a follow-up task is already queued.
- When the job finishes, surface the result to the user for review before proceeding to the next shot.
- Model-specific failure handling — see the model's reference.

### Step 4 — Iterate

When the user wants a next clip, a revision, or a continuation:

- **If it's the next shot in a multi-shot sequence** — reuse the established anchor (see §Visual consistency across shots below for principles, model ref for flag-level details).
- **If the user's feedback is ambiguous** ("it doesn't feel right") — ask what specifically to change before regenerating.
- **If the same text-prompt adjustment has failed twice** — stop adjusting text. Switch to reference images, or switch to edit mode where the model supports it (see model ref).
- Each new generation restarts the loop at Step 1 — realign if scope shifted.

## Visual consistency across shots

Text alone cannot reliably maintain visual identity across shots; visual references constrain output far more precisely than words.

### Anchors: the cornerstone of consistency

An **anchor** is a reference image or video pinned across every shot that shares the same character, object, or style. Any multi-shot sequence with recurring visual elements needs an anchor — don't try to reproduce them from text.

### Sourcing an anchor

Have reference awareness. When the user's request involves a recurring character / object / scene, think about what anchor to use **before** writing prompts:

- **Check the project first.** What has the user already provided or approved? Uploaded images, previously generated and approved shots, or earlier project assets can all serve as anchors.
- **Match the user's intent.** If the user pointed to a specific asset ("use this photo", "像上一段那样"), use that. If they described a character only in words, no anchor exists yet and one must be established.
- **When in doubt, ask the user.** Don't guess which asset to pin, and don't silently generate a new anchor when the user may already have one in mind.

### Establishing a new anchor (with user consent)

When no existing asset fits and one must be generated, propose it to the user first — it shapes every downstream shot. Model-specific paths — see the chosen model's ref.

### Using the anchor

- Pass the anchor in **every shot** that shares the character / object / style. The specific flag(s) to use depend on the model — see the model's ref.
- Describe the anchor by appearance in the prompt, not by name: "The BLACK RACING CAR with chrome exhaust" constrains far more than "Fleetmaster". When role confusion is likely, add explicit negations: "The motorcycle does NOT transform."
- Refer to the anchor with \`@Image1\` / \`@Video1\` in the prompt — not vague phrases like "the same car as before".
- When a shot depends on a previous generation, **wait for the previous job to complete** (via \`track_progress\` with \`action=wait\`) to obtain its \`assetId\`, then pass it as the anchor reference. Do not submit dependent shots in parallel.

### Multi-character projects

When a project has multiple named characters with distinct attributes (e.g. Faz with fire energy, Kev with ice energy), treat each character as a **separate anchor** — one reference asset per character. In every prompt:

- Name the **active** character and attach their distinctive attributes ("Kev has **blue ice** electric energy").
- Add explicit negations for the others to prevent attribute leakage ("NOT red fire energy, NOT Faz's look").
- Pin the correct character's anchor (model-specific flag — see model ref). Do not reuse another character's anchor by accident.

Missing either explicit attribution or negation causes cross-character attribute mixing.

**Multiple characters in the same frame.** For shots where multiple characters appear together (especially facing the camera), the model is prone to face-swap or body-clipping. Add **strong positional + outfit anchors** to each character and prefer a **fixed camera** for that shot:

- "the character on the LEFT wears a grey-blue tactical jacket, short beard, silver earring"
- "the character on the RIGHT wears a red cape with gold trim, long braided hair"
- "fixed camera, medium shot, both characters clearly separated"

Positional words (left / right / foreground / background) + distinctive outfit colors give the model enough signal to keep the characters apart.

### Escalate when text adjustments fail

If a visual-identity issue (wrong character, drift, color mismatch) persists after **two text-prompt adjustments** on the same shot, stop adjusting text. Text is not a substitute for an anchor. Escalate to:

- Adding or switching the anchor.
- Edit mode where the model supports it (see model ref for how to invoke).

Do **not** submit a third text-only retry on the same consistency issue.

### When to skip anchoring

Simple, one-off, or exploratory requests do not need anchors — generate directly.

## Run

\`\`\`ts
// Text-to-video (seedance2 default)
submit_video({
  model: "seedance2",
  prompt: "A cat walks across a sunny windowsill",
  name: "Cat on windowsill",
});

// Image-to-video with seedance2 — pass the project asset id directly; the server resolves the asset's media URL
submit_video({
  model: "seedance2",
  prompt: "The scene comes to life, gentle breeze rustles the curtains",
  firstFrame: "abc12345",
  name: "Living room animation",
});

// Kling text-to-video — only after Model Selection check
submit_video({
  model: "kling",
  prompt: "A sports car drifts around a wet corner",
  name: "Car drift shot",
});

// MiniMax Hailuo — 6s or 10s; optional firstFrame / lastFrame (with first)
submit_video({
  model: "hailuo",
  prompt: "A ceramic cup steams on a wooden table, soft morning light [Push in]",
  durationSeconds: 6,
  resolution: "720p",
  name: "Coffee steam morning",
});
\`\`\`

After submission, call the \`track_progress\` tool: \`action=status jobIds=<jobId>\` to poll, \`action=wait jobIds=<jobId>\` to block until terminal.

## Config Mode

For complex multimodal jobs, build the full args object up front and pass it in a single call:

\`\`\`ts
submit_video({
  model: "seedance2",
  prompt: "...",
  name: "...",
  firstFrame: "abc12345",
  refImages: ["def67890", "ghi24680"],
  refVideos: ["abc99999"],
  refAudios: ["jkl55555"],
  durationSeconds: 8,
  ratio: "9:16",
});
\`\`\`

## Rules

- Always provide \`--name\` with a descriptive asset name.
- Default to submit-only. End your turn after submitting unless a follow-up task is queued.
- Do not call this skill with \`--job\`, \`--wait\`, or \`--timeout\` — job management belongs to \`track_progress\`.
- Before submitting, briefly tell the user model + duration + what will be generated.
- Place completed assets with \`edit_item\` only after the user wants them on the timeline (pool-first contract).
`,Se=`# Fal.ai

Use \`model: "fal"\` with a \`falModel\` ID from the tool schema. A configured
Fal key enables the catalog, not the native-provider routes. Use the saved
Fal model default unless the user explicitly selects another model. If neither
exists, ask before submitting; never silently substitute a different model.

Read the per-model limits in the \`falModel\` tool description. Omit output options
to use that model's defaults. Do not send native-provider-only controls such as
masks, seeds, priority, camera locks, or multi-shot prompts. Unsupported options
fail locally before submission. Reference inputs must be project asset IDs.

Generate only after the user explicitly requests it. Generation costs Fal credits.
For videos, use \`track_progress\` with the returned job ID; resuming a stored job
polls/downloads the same request rather than submitting another generation.
After an interrupted image request, check Fal request history before retrying.
`,Ce="# xAI Grok Imagine Video (`grok-imagine-video`)\n\nText-to-video via the xAI Grok Imagine Video family. Auth: the imported xAI\nsubscription session (SuperGrok / X Premium+) takes priority; otherwise the\n`LLM_XAI_API_KEY` key. Configured model id comes from Settings\n(`XAI_VIDEO_MODEL`), default `grok-imagine-video-1.5`.\n\n## Wired capabilities\n\n- **Text-to-video only.** No `firstFrame` / `lastFrame` / `refImages` /\n  `refVideos` / `refAudios` / `refVideoMode` / `mode` / `shotType` /\n  `multiPrompts` in this integration — validation rejects them. Do not send\n  seedance/hailuo/kling-only controls (`generateAudio` etc.).\n- **Duration** (`durationSeconds`): 1–15 seconds.\n- **Aspect ratio** (`ratio`): `16:9` (default), `9:16`, `1:1`, `4:3`, `3:4`,\n  `3:2`, `2:3`.\n- **Resolution** (`resolution`): `480p` (default), `720p`, `1080p`.\n- Generated videos **include an audio track by default** — no parameter\n  needed; do not promise controllable audio.\n- The job is asynchronous: `submit_video` returns a `jobId`; poll / wait with\n  `track_progress` exactly like the other video vendors.\n\n## Prompt guidance\n\nOne coherent action per clip. Include subject, motion, environment, lighting,\nand camera intent; keep the scene physically continuous because the provider\ngenerates a first frame and animates it.\n\n## Errors\n\n- 401/403 with a subscription session: the tier may not open the media API —\n  suggest the API-key path or upgrading the subscription.\n- `grok-imagine-video does not support ratio …` / `durationSeconds must be\n  between 1 and 15`: fix the args, do not retry unchanged.\n",we='# MiniMax Hailuo (`hailuo`)\n\nRead this before `submit_video({ model: "hailuo", … })`.\n\nGrounded in OpenChatCut’s video adapter (`server/plugins/video.ts` → MiniMax\n`POST /v1/video_generation`, poll `query/video_generation`, download via\n`files/retrieve`). Official MiniMax video guide lists four product modes\n(T2V / I2V / first–last / subject-reference). This path implements all four;\nthe configured MiniMax model determines which mode matrix is valid. Multi-ref\nis not a Hailuo API mode and is rejected.\n\nDefault settings model is `MiniMax-Hailuo-02` (Settings may switch to\n`MiniMax-Hailuo-2.3` / `MiniMax-Hailuo-2.3-Fast`). Call it **海螺 / Hailuo /\nMiniMax video** for the user.\n\n## Capabilities (as wired)\n\n| Dimension | Value |\n| --- | --- |\n| Endpoint | `POST {MINIMAX_BASE_URL}/v1/video_generation` |\n| Duration | **Exactly `6` or `10`** seconds (default **6**) |\n| Resolution tool args | `512p` → **`512P`** (Hailuo-02 only) · `720p` (default) → **`768P`** · `1080p` → **`1080P`** |\n| Aspect ratio | **No `ratio` field** — not sent. Framing follows first-frame image when present |\n| Prompt | **Required**, ≤ **2000** characters |\n| Prompt optimizer | Default **`true`**; tool `promptOptimizer: false` for more literal prompts |\n| Fast pretreatment | Optional `fastPretreatment: true` when optimizer is on |\n| Audio | Provider-side; no tool toggle |\n| Multi-shot / Kling fields | **Rejected** |\n| Async | Submit → poll ~**10s** → `file_id` → download URL |\n\n### Duration × resolution matrix\n\n| Tool `resolution` | API value | Allowed `durationSeconds` |\n| --- | --- | --- |\n| `512p` | `512P` | **6** or **10**, I2V with `MiniMax-Hailuo-02` only |\n| `720p` (default) | `768P` | **6** or **10** |\n| `1080p` | `1080P` | **6 only** (10s rejected by our validator) |\n\nIf you need 10s, use `720p` (or omit resolution).\n\n## Input channels\n\n| Tool param | Wired? | Maps to API |\n| --- | --- | --- |\n| `prompt` | **Yes, required** | `prompt` |\n| `firstFrame` | Optional | `first_frame_image` |\n| `lastFrame` | Optional, **requires firstFrame** | `last_frame_image` |\n| `refImages` / `refVideos` / `refAudios` | **No** | Rejected |\n| `subject_reference` | **When model is S2V-01** | `firstFrame` → `subject_reference[].image[]` (no lastFrame) |\n\n`firstFrame` / `lastFrame` must be project **image** asset ids. External URLs rejected — import first.\n\n## Modes\n\n| Params | Mode |\n| --- | --- |\n| `prompt` only | Text-to-video |\n| `prompt` + `firstFrame` | Image-to-video |\n| `prompt` + `firstFrame` + `lastFrame` | First→last frame transition |\n| `prompt` + `firstFrame`, configured `S2V-01` | Subject-reference video |\n\n`MiniMax-Hailuo-2.3-Fast` is I2V-only. First+last is `MiniMax-Hailuo-02` only,\ndoes not accept 512P, and does not expose `fast_pretreatment`. `S2V-01` accepts\nprompt, prompt optimizer, and subject reference only — no duration, resolution,\nlast frame, or fast pretreatment.\n\nNot available: multi-shot storyboard or multi-ref. Subject-reference is wired when Settings selects `S2V-01`.\nFor those → `seedance2` / `kling` when configured.\n\n## When to choose Hailuo\n\n- User named **MiniMax / 海螺 / Hailuo**\n- Short **single** clip (6s or 10s), T2V / I2V / simple first→last morph\n- Only MiniMax video key is on\n\nDo **not** pick hailuo for multi-shot customize, multi-ref, or non-6/10 durations.\n\n## Tool shape\n\n```ts\n// Text-to-video\nsubmit_video({\n  model: "hailuo",\n  prompt: "…",                 // ≤2000 chars; optional [Push in] camera commands\n  durationSeconds: 6,          // or 10 with 720p\n  resolution: "720p",          // 1080p → duration 6 only\n  name: "Descriptive pool name",\n});\n\n// Image-to-video\nsubmit_video({\n  model: "hailuo",\n  firstFrame: "imageAssetId",\n  prompt: "The subject begins to move. [Push in]",\n  durationSeconds: 6,\n  resolution: "1080p",\n  name: "Still · comes alive",\n});\n\n// First + last frame\nsubmit_video({\n  model: "hailuo",\n  firstFrame: "startImageId",\n  lastFrame: "endImageId",\n  prompt: "Smooth morph between the two frames; continuous camera.",\n  durationSeconds: 6,\n  name: "Frame morph A→B",\n});\n```\n\nThen `track_progress({ action: "wait", target: "generation", jobIds: "<jobId>" })`.\nPool-first; place with `edit_item` when the user wants timeline placement.\n\n**Do not pass** `ratio`, `refImages`, `refVideos`, `refAudios`, `shotType`, or `multiPrompts`.\n\n## Prompt writing\n\n### Structure for a 6–10s beat\n\nOne clear action: **Subject + Action + Scene + Camera + Style**. CN/EN OK; ≤2000 chars.\n\n### Camera commands (official `[command]` syntax)\n\n| Group | Commands |\n| --- | --- |\n| Truck | `[Truck left]`, `[Truck right]` |\n| Pan | `[Pan left]`, `[Pan right]` |\n| Push/pull | `[Push in]`, `[Pull out]` |\n| Pedestal | `[Pedestal up]`, `[Pedestal down]` |\n| Tilt | `[Tilt up]`, `[Tilt down]` |\n| Zoom | `[Zoom in]`, `[Zoom out]` |\n| Other | `[Shake]`, `[Tracking shot]`, `[Static shot]` |\n\nCombine ≤3 in one bracket: `[Pan left,Pedestal up]`. Sequence with prose: `…[Push in], then…[Pull out]`.\n\n### I2V / first–last tips\n\n- With `firstFrame` only: describe how the **still evolves**, not a conflicting new subject.\n- With `lastFrame`: describe the transition; both stills should be same aspect family when possible.\n\n### Longer stories\n\nMultiple sequential hailuo jobs, or Seedance/Kling multi-shot. One job at a time unless the user asked for parallel clips.\n\n## Subject-reference (S2V-01)\n\nWhen Settings `MINIMAX_VIDEO_MODEL` is **`S2V-01`** (or any model name matching `/s2v/i`):\n\n- **Required:** `firstFrame` = subject/face still  \n- **Forbidden:** `lastFrame`  \n- Body uses official `subject_reference: [{ type: "character", image: [...] }]` instead of first/last frame fields  \n- Keep prompt under 2000 chars; describe action/scene around that subject  \n\nDefault Hailuo models (`MiniMax-Hailuo-02` / `2.3` / `2.3-Fast`) still use first/last frame, **not** subject_reference.\n\n## Optimizer knobs\n\n```ts\nsubmit_video({\n  model: "hailuo",\n  prompt: "Exact brand shot. [Static shot] No style rewrite.",\n  durationSeconds: 6,\n  promptOptimizer: false, // more literal\n  name: "Literal brand",\n});\n\nsubmit_video({\n  model: "hailuo",\n  prompt: "Quick draft street walk",\n  durationSeconds: 6,\n  fastPretreatment: true, // only with optimizer on (default)\n  name: "Draft walk",\n});\n```\n\n## Not wired\n\n| Feature | Status |\n| --- | --- |\n| Callback webhooks | We poll |\n| Multi-shot API | Use Kling |\n\n## Errors\n\n| Message / pattern | Fix |\n| --- | --- |\n| `hailuo durationSeconds must be 6 or 10` | Use 6 or 10 |\n| `hailuo 1080p only supports durationSeconds 6` | 6s or switch to 720p for 10s |\n| `lastFrame requires firstFrame` | Supply both |\n| `hailuo does not support refImages/refVideos/refAudios` | Drop multi-ref; use frames only |\n| `mode and multi-shot parameters are supported by kling only` | Remove Kling-only fields |\n| `MiniMax is not configured` | Set `MINIMAX_API_KEY` |\n| Sensitive content / Fail / timeout | Rewrite prompt or stills; no thrice-identical retry |\n\n## Checklist\n\n1. MiniMax video on; `model: "hailuo"`.\n2. Duration 6 or 10; if `1080p`, must be 6.\n3. lastFrame only with firstFrame; no multi-ref / multi-shot / ratio.\n4. Prompt ≤2000; one beat; optional `[camera]` commands.\n5. Descriptive `name`; submit once; `track_progress`; pool-first placement.\n\n## Comparison\n\n| Need | Prefer |\n| --- | --- |\n| Fast short T2V / I2V / first–last on MiniMax | **hailuo** |\n| Multi-ref, edit/extend, audio refs | **seedance2** |\n| Formal multi-shot with per-shot durations | **kling** customize |\n',Te='# Kling (`kling`)\n\nRead this before `submit_video({ model: "kling", … })`.\n\nGrounded in OpenChatCut’s video adapter (`server/plugins/video.ts` → Kling\n`POST /v1/videos/omni-video`, default model `kling-v3-omni`). Official Omni\ncapabilities (multi-shot, first/last frame, image refs, `<<<image_n>>>` tokens)\nare mapped to our tool shape below. **Do not promise** features we do not\nforward (video refs, element library, voice binding, Motion Brush, etc.).\n\nCall it **"Kling"** for the user — do not surface internal aliases (V3 / O3 /\nO1 / 2.6 / Turbo).\n\n## Capabilities (as wired)\n\n| Dimension | Value |\n| --- | --- |\n| Endpoint task | `omni-video` only |\n| Duration | **3–15** seconds integer (default **5**) |\n| Aspect ratio | `16:9`, `9:16`, `1:1` |\n| Quality mode | `std` → ~720p · `pro` → ~1080p (see `mode` / `resolution`) |\n| Top-level prompt | ≤ **2500** characters (required unless `shotType=customize`) |\n| Per-shot prompt | ≤ **512** characters when using `multiPrompts` |\n| Images | ≤ **7** total without video; ≤ **4** when `refVideos` is set |\n| Image formats (provider) | JPEG/JPG/PNG; roughly 300–8000 px side; ≤ ~10MB (import to project first) |\n| Reference video | **At most 1** via `refVideos` → API `video_list` |\n| `refVideoMode` | `feature` (default) or `base` — only with `refVideos` |\n| Multi-shot | **2–6** shots via `shotType` + optional `multiPrompts` |\n| `refAudios` | **Rejected** |\n| Element library / voice IDs | **Not wired** |\n| `negative_prompt` field | **Not sent** — put avoidances in the prompt text |\n\n### `mode` ↔ `resolution`\n\n| Intent | Set |\n| --- | --- |\n| Standard / faster | `mode: "std"` or `resolution: "720p"` (default) |\n| Higher fidelity | `mode: "pro"` or `resolution: "1080p"` |\n\nIf **both** are set, they must agree (`pro` ⇔ `1080p`); otherwise the server\nthrows `kling mode and resolution conflict`. Prefer setting only one.\n\n## Input channels → provider lists\n\n| Tool param | Provider entry | Prompt token (after rewrite) |\n| --- | --- | --- |\n| `firstFrame` | `image_list[]` `{ type: "first_frame", image_url }` | `<<<image_1>>>` if first image |\n| `lastFrame` | `image_list[]` `{ type: "end_frame", image_url }` | next image ordinal |\n| `refImages[]` | `image_list[]` `{ image_url }` | following ordinals |\n| `refVideos[]` | `video_list[]` `{ video_url, refer_type }` | `<<<video_1>>>` (max 1) |\n| `refVideoMode` | `feature` (default) or `base` | feature = motion/camera/style; base = edit source (`keep_original_sound: yes`) |\n\n**Rules**\n\n- `lastFrame` **requires** `firstFrame`.\n- All slots are **project asset refs** (UUID / prefix / `asset://…`). External URLs rejected — import first.\n- In the **prompt**, use `@Image1` / `@图片1` and `@Video1` / `@视频1`. Our server rewrites to `<<<image_N>>>` / `<<<video_N>>>`. Image ordinals: firstFrame → lastFrame → refImages[0]…. Video ordinals start at 1 for `refVideos[0]`.\n- With a feature video: keep **≤4** stills total; describe what to take from the video (camera, motion, rhythm) in the prompt.\n\nAlways attach a noun after the token: `@Image1 character walks…`, not bare `@Image1 walks…`.\n\n## Modes\n\n| Params | Mode | Notes |\n| --- | --- | --- |\n| `prompt` only | text-to-video | Single continuous clip |\n| `firstFrame` + `prompt` | image-to-video | Animate from start still |\n| `firstFrame` + `lastFrame` + `prompt` | first→last | Strict start/end frames |\n| `prompt` + `refImages` (± frames) | reference-guided | Subject/style anchors; ≤7 images total |\n| `prompt` + `refVideos` (± ≤4 images) | video feature ref | Default `refVideoMode: "feature"` — motion/camera/style |\n| `prompt` + `refVideos` + `refVideoMode: "base"` | video edit | Edit/replace elements in that clip; source audio kept when possible |\n| `shotType: "intelligence"` + `prompt` | multi-shot auto | Model plans cuts; 2–6 internal shots |\n| `shotType: "customize"` + `multiPrompts` | multi-shot manual | **Omit** top-level `prompt` |\n\n### Multi-shot (official contract → our tool)\n\nOfficial Omni multi-shot: `multi_shot: true`, `shot_type`, optional `multi_prompt[]`.\nWe set those when you pass `shotType`.\n\n#### `shotType: "intelligence"`\n\n- Pass a **single** top-level `prompt` that describes the whole sequence.\n- Model auto-decomposes into shots (up to 6).\n- Use when the user wants quick multi-cut coverage without per-shot durations.\n- Still write technical shot language (size / camera / motion settle) inside that one prompt when quality matters.\n\n```ts\nsubmit_video({\n  model: "kling",\n  shotType: "intelligence",\n  durationSeconds: 10,\n  ratio: "9:16",\n  prompt:\n    "Two-shot dialogue then CU reaction. Shot reverse shot. " +\n    "MCU on speaker A, then B. Soft key camera-left 4500K. " +\n    "Motion settles as B looks down, breath steadies.",\n  name: "Dialogue · intelligence multi",\n});\n```\n\n#### `shotType: "customize"`\n\nServer validation (matches official customize):\n\n| Rule | Detail |\n| --- | --- |\n| Top-level `prompt` | **Must be omitted** (empty) |\n| Shot count | **2–6** entries in `multiPrompts` |\n| `index` | 1-based, consecutive (`1…N`) |\n| Per-shot `prompt` | Non-empty, ≤ **512** chars |\n| Per-shot `duration` | Integer ≥ **1** |\n| Sum of durations | **Exactly** `durationSeconds` |\n\n```ts\nsubmit_video({\n  model: "kling",\n  shotType: "customize",\n  durationSeconds: 12,\n  ratio: "16:9",\n  mode: "std",\n  multiPrompts: [\n    {\n      index: 1,\n      duration: 4,\n      prompt:\n        "[Shot 1] WS. Slow dolly in. Key from camera-left window, 4500K warm amber. " +\n        "Woman in grey coat enters cafe. Motion settles as she reaches the counter.",\n    },\n    {\n      index: 2,\n      duration: 4,\n      prompt:\n        "[Shot 2] MCU. Static. Same woman, grey coat, short dark hair. She smiles at barista. " +\n        "Motion settles as steam rises past her face.",\n    },\n    {\n      index: 3,\n      duration: 4,\n      prompt:\n        "[Shot 3] CU. Very slow push-in. Hands take a paper cup. " +\n        "Motion settles as both hands cradle the cup center-frame.",\n    },\n  ],\n  name: "Cafe storyboard · 3 shots",\n});\n```\n\nRepeat **identity details in every shot prompt** (coat color, hair, age cues). Multi-shot preserves identity better than separate jobs, but each shot is still its own brief — do not assume shot 2 “remembers” shot 1’s prose.\n\nOptional: same `refImages` / `firstFrame` on a customize job to lock appearance across the storyboard.\n\n## Prompt craft (technical-script model)\n\nKling does **not** invent missing camera grammar. Explicit structure fixes most failures. Stack these rules:\n\n### 1. Motion endpoint — every shot\n\nEnd with `Motion settles as <concrete end state>`. Missing endpoints often stall near completion or cut off mid-action.\n\n```\n✗ A woman walks a rainy alley under neon.\n✓ A woman walks a rainy alley under neon.\n  Motion settles as she pauses under a red lantern, face half-turned to camera.\n```\n\nApplies to single-shot, I2V, intelligence, and **each** customize entry.\n\n### 2. Shot size in English\n\nOpen with a Hollywood size (abbrev OK):\n\n| Size | Abbr | Use |\n| --- | --- | --- |\n| Extreme close-up | ECU | Eye, hand detail |\n| Close-up | CU | Face / object |\n| Medium close-up | MCU | Head + shoulders |\n| Medium shot | MS | Waist up |\n| Medium long | MLS | Full body mid-distance |\n| Wide shot | WS | Environment establish |\n\n### 3. Camera movement (declare ≥1; `static` counts)\n\n| Category | Terms |\n| --- | --- |\n| Static | `static` |\n| Push/pull | dolly in/out, pull back |\n| Pan/tilt | pan left/right, tilt up/down |\n| Track | lateral tracking, following |\n| Orbit | slow 180 orbit (avoid on fast action) |\n\nSpeed: `very slow / slow / medium / fast / whip`. Max ~2 moves per shot.\n\n### 4. Lighting triplet\n\nAlways: **direction + Kelvin + tone**  \ne.g. `key from camera-left window, 4500K, warm amber`.  \n“Warm light” alone → face/shadow drift.\n\n### 5. Sequential action\n\nUse `First / Then / Finally` for multi-step motion inside one shot.\n\n### 6. Time slicing (≥5s shots)\n\n```\n[Shot 2 / MCU / 6s]\n  - 0–2s: …\n  - 2–4s: …\n  - 4–6s: …\nMotion settles as …\n```\n\n### 7. Emotions → ≥3 physical signals\n\n| Emotion | Signals (pick 3+) |\n| --- | --- |\n| Sad | glistening eyes, trembling lower lip, shallow breath, loose fingers |\n| Scared | wide eyes, breath catch, forehead sweat, hand tremor |\n| Happy | eye-corner crinkles, asymmetric smile, relaxed shoulders, soft exhale |\n| Angry | clenched jaw, flared nostrils, white knuckles, quick breath |\n\n### 8. Complexity ceiling\n\n~≤7 “elements” per shot (characters, independent events, strong BG actions). Over limit → split shots (prefer customize multi-shot).\n\n### Bilingual split\n\nNarrative can be CN/EN; keep technical directives in English when possible:\n`Camera`, `Lighting`, `Motion settles`, `@ImageN` / rewritten `<<<image_n>>>`.\n\n### Avoidances (no negative_prompt field)\n\nBake into prompt: `Avoid: blurry hands, extra fingers, warped face, text distortion.`\n\n## Multi-character\n\nAttribute leak is common. Every shared-frame prompt needs:\n\n- Position (`LEFT` / `RIGHT` / foreground)\n- Distinct outfit + traits\n- Explicit **NOT** clauses for the other character\n- Prefer **fixed** or very slow camera\n\n```\nLEFT: @Image1 man — grey-blue tactical jacket, short beard. NOT red cape, NOT braid.\nRIGHT: @Image2 woman — red cape gold trim, long braid. NOT grey jacket, NOT short beard.\nCamera: fixed MS, both fully separated.\nMotion settles as both face camera, still.\n```\n\n## Real-person / product stills\n\nBest refs: frontal (~0–15°), ≥1024² when possible, even light, little occlusion.  \nPass as `firstFrame` and/or `refImages`; mention `@Image1` in the prompt.\n\n## Cross-job continuity (separate `submit_video` calls)\n\nPrefer **one customize multi-shot job** for 2–6 related cuts. If the user forces separate jobs:\n\n1. Keep the same `refImages` on every call.\n2. After shot N succeeds, use a frozen frame of the result as the next `firstFrame` when continuity is critical.\n3. `track_progress` wait before dependent jobs.\n4. After **two** text-only retries on identity drift → change/add refs, not more adjectives.\n\n## When to pick Kling vs Seedance vs Hailuo\n\n| Need | Prefer |\n| --- | --- |\n| Per-shot duration control / formal storyboard API | **kling** `customize` |\n| Auto multi-cut from one paragraph | **kling** `intelligence` |\n| Fine face performance / technical camera language | **kling** |\n| One motion/camera feature video + stills | **kling** `refVideos` (1) |\n| Multi video/audio refs, edit/extend/bridge | **seedance2** |\n| Simple 6s/10s T2V or single still I2V | **hailuo** |\n\n## Not wired (do not promise)\n\n| Feature | Status |\n| --- | --- |\n| Multiple `refVideos` | Max **1** video |\n| `refAudios` | Rejected for Kling |\n| Element library (`@Element` / element_id) | Not uploaded / not sent |\n| Voice binding / voice clone IDs | Not sent |\n| Motion Brush (web UI) | N/A |\n| Separate audio on/off flag | Not exposed |\n\nFor multi-video bridge/edit or audio refs, prefer **seedance2**.\n\n## Errors (server / provider)\n\n| Message / pattern | Fix |\n| --- | --- |\n| `omit prompt for kling customize; use multiPrompts` | Clear top-level prompt; fill `multiPrompts` |\n| `kling customize requires 2 to 6 multiPrompts` | Shot count 2–6 |\n| `kling multiPrompt indexes must be consecutive from 1` | `index: 1…N` no gaps |\n| `each kling multiPrompt requires a prompt of at most 512 characters` | Shorten per-shot text |\n| `kling multiPrompt durations must sum to durationSeconds` | Rebalance durations |\n| `kling multiPrompts require shotType=customize` | Set `shotType: "customize"` |\n| `kling accepts at most 7 images` | Drop frames/refs |\n| `kling with refVideos accepts at most 4 images` | Drop stills or drop the feature video |\n| `kling accepts at most 1 reference video` | Keep a single `refVideos` entry |\n| `kling does not support refAudios` | Drop audio refs; use Seedance if needed |\n| `kling mode and resolution conflict` | Align mode ↔ resolution |\n| `prompt is required` | Non-customize paths need prompt |\n| `kling prompt must be at most 2500 characters` | Shorten |\n| 99% stall / abrupt end | Add **Motion settles** endpoint |\n| Face drift across jobs | Same refs + wait; or one customize multi-shot |\n\n## Tool checklist\n\n1. Kling key on (capabilities); `model: "kling"`.\n2. Mode combo valid (no Seedance-only ratio like `21:9` / `adaptive`).\n3. Images ≤7; no video/audio refs.\n4. Customize ⇔ empty prompt + valid multiPrompts sum.\n5. Every shot prompt has size + camera + light + **Motion settles**.\n6. Descriptive `name` for the media pool.\n7. Tell the user model + duration + multi-shot style briefly, then submit once.\n8. `track_progress` for job completion; place with `edit_item` only when asked.\n\n## Quick single-shot example\n\n```ts\nsubmit_video({\n  model: "kling",\n  prompt:\n    "MCU. Slow dolly in. Key from camera-left, 5000K neutral. " +\n    "@Image1 young man in navy hoodie reads a letter; eyes glisten, jaw tight, breath shallow. " +\n    "Motion settles as he lowers the letter, gaze off-camera right. " +\n    "Avoid: extra fingers, warped text on paper.",\n  firstFrame: "portraitAssetId",\n  durationSeconds: 5,\n  ratio: "9:16",\n  mode: "pro",\n  name: "Letter reaction · MCU",\n});\n```\n',Ee="# OFox Multi-Model Video (`ofox`)\n\nText-to-video via the OFox multi-model gateway (one API key in front of the\nSeedance series, Wan, and other text-to-video models). Auth: the\n`LLM_OFOX_API_KEY` key (shared with the OFox LLM preset). Configured model id\ncomes from Settings (`OFOX_VIDEO_MODEL`), default\n`bytedance/seedance-2.0-fast`; any text-to-video model from the OFox catalog\n(`GET /v1/models`) works.\n\n## Wired capabilities\n\n- **Text-to-video, image-to-video, first-and-last-frame, and image\n  references.** `firstFrame` (optionally with `lastFrame`) anchors exact\n  frames; up to 9 `refImages` guide subject/style instead. The two modes are\n  **mutually exclusive** (the API rejects the combination). `refVideos` /\n  `refAudios` are supported by the OFox API but not wired here yet;\n  `refVideoMode` / `mode` / `shotType` / `multiPrompts` are rejected.\n- **`generateAudio`** (default true for capable models) and **`seed`** pass\n  through; seed determinism is not guaranteed by every upstream vendor.\n- **Duration** (`durationSeconds`): 2–30 seconds locally; the API enforces the\n  configured model's own range with a clear 400 before any task is created\n  (for example the default model accepts 4–15 seconds).\n- **Aspect ratio** (`ratio`): `16:9` (default), `9:16`, `1:1`, `4:3`, `3:4`,\n  `3:2`, `2:3`, `21:9`, `9:21`.\n- **Resolution** (`resolution`): `480p`, `720p` (default), `1080p` — per-model\n  support is enforced by the API (the default model accepts 480p/720p).\n- Project media rides as base64 data URLs; the OFox gateway re-hosts them on\n  its own object storage before dispatching to the upstream model, so no\n  public hosting is needed. Reference images should be reasonably sized\n  (very small images can fail the upstream image validation).\n- Results prefer `mirror_urls` (persistent signed CDN addresses, present when\n  the upstream has mirroring enabled) and fall back to the temporary\n  `unsigned_urls`.\n- The job is asynchronous: `submit_video` returns a `jobId`; poll / wait with\n  `track_progress` exactly like the other video vendors.\n\n## Prompt guidance\n\nOne coherent action per clip. Include subject, motion, environment, lighting,\nand camera intent. Different catalog models have different strengths; keep\nprompts model-agnostic unless the user pinned a specific model.\n\n## Errors\n\n- `duration N out of range [a, b]` / `resolution \"…\" not supported`: the\n  configured model's server-side limits — adjust the args or switch\n  `OFOX_VIDEO_MODEL`, do not retry unchanged.\n- 401 `upstream_auth_failed`: the OFox account key is invalid or out of\n  balance — ask the user to check the key / top up.\n",De='# Seedance 2.0 (`seedance2`)\n\nRead this before `submit_video({ model: "seedance2", … })`.\n\nGrounded in OpenChatCut’s video adapter (`server/plugins/video.ts` → Seedance\n`/contents/generations/tasks`). Capability claims outside what we wire are\n**not** to be promised. Official prompt patterns (subject/motion/camera,\nmultimodal `@` refs, edit/extend/bridge) are adapted here to our tool shape.\n\n## Capabilities (as wired)\n\n| Dimension | Value |\n| --- | --- |\n| Duration | **2–15** seconds integer (default **5**) |\n| Resolution | **`480p`** / **`720p`** (default) / **`1080p`** / **`4k`** — API `resolution` (4k needs full Seedance 2.0; Fast/Mini may reject) |\n| Aspect ratio | `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9`, `adaptive` |\n| Audio out | `generateAudio` → `generate_audio` (official default true) |\n| Provider controls | `seed`, `cameraFixed`, `watermark`, `returnLastFrame`, `executionExpiresAfter` (3600–259200), `priority` (0–9) |\n| Prompt | Required; keep focused (CN ≈ ≤500 chars, EN ≈ ≤1000 words useful bound) |\n| Multi-shot API | **None** — multi-shot is **prompt structure only** (not Kling `shotType` / `multiPrompts`) |\n\nWhen `firstFrame` or `lastFrame` is set, the server **forces `ratio: "adaptive"`**\n(follows the frame image). Explicit `ratio` is ignored in that case.\n\n## Input channels → server roles\n\n| Tool param | Server role | Prompt token | Limits |\n| --- | --- | --- | --- |\n| `firstFrame` | `first_frame` | `@ImageN` (first image in payload order) | 1 image |\n| `lastFrame` | `last_frame` | next `@ImageN` | requires `firstFrame` |\n| `refImages[]` | `reference_image` | `@ImageN` in array order after frames | ≤ **9** |\n| `refVideos[]` | `reference_video` | `@Video1`… | ≤ **3** |\n| `refAudios[]` | `reference_audio` | `@Audio1`… | ≤ **3**; needs ≥1 visual (frame or image/video ref) |\n\nAll slots are **project asset refs**. External URLs are rejected. Reference videos are uploaded to configured R2 and sent as temporary HTTPS URLs because the official API does not accept video data URLs.\n\n**Ordinal rule:** images are numbered in **payload order**: `firstFrame` → `lastFrame` → `refImages[0]`… Videos and audios number only within their own arrays. Always name the role in prose after the token: `@Image1 (the red coat woman)`, not bare `@Image1 walks…` (number segmentation errors).\n\n## Modes (inferred — no `mode` param)\n\n| Params | Mode | Use when |\n| --- | --- | --- |\n| `prompt` only | text-to-video | Pure description, no visuals |\n| `firstFrame` + prompt | image-to-video | Animate a known start frame |\n| `firstFrame` + `lastFrame` + prompt | first→last transition | Strict start/end stills |\n| any `refImages` / `refVideos` / `refAudios` (± `firstFrame`) | reference-guided | Style/subject/motion/audio anchors, edit, extend, bridge |\n\n**Hard exclusion:** `lastFrame` **cannot** combine with `refImages` / `refVideos` / `refAudios` (server rejects). Choose either strict first–last transition **or** reference-guided work.\n\nKling-only fields (`shotType`, `multiPrompts`, `mode: std|pro`) are rejected for seedance2.\n\n## Mode recipes\n\n### A. Text-to-video\n\n```ts\nsubmit_video({\n  model: "seedance2",\n  prompt: "…", // 8-element structure preferred\n  durationSeconds: 8,\n  ratio: "9:16",\n  name: "Descriptive pool name",\n});\n```\n\n### B. Image-to-video (first frame)\n\n```ts\nsubmit_video({\n  model: "seedance2",\n  firstFrame: "assetId",\n  prompt: "The scene comes alive: soft wind, slow push-in, …",\n  durationSeconds: 6,\n  name: "Living still · push-in",\n});\n// ratio becomes adaptive server-side\n```\n\n### C. First + last frame\n\n```ts\nsubmit_video({\n  model: "seedance2",\n  firstFrame: "startId",\n  lastFrame: "endId",\n  prompt: "Smooth morph between the two frames; continuous camera; no jump cuts.",\n  durationSeconds: 5,\n  name: "Frame morph A→B",\n});\n// no refImages / refVideos / refAudios\n```\n\n### D. Reference-guided (subject / style / multi-image)\n\nPass anchors as `refImages` (and optional `firstFrame`). **Tell the prompt what each image is for.**\n\n| Intent | Prompt pattern |\n| --- | --- |\n| Multi-angle subject | `Reference @Image1 @Image2 @Image3 for the product/character appearance; …` |\n| Subject + scene | `@Image1 (character) in @Image2 (cafe interior) …` |\n| Outfit + person | `@Image1 person wearing outfit from @Image2 …` |\n| Storyboard panels | `Follow storyboard order in @Image1; each panel in sequence …` |\n| Logo / on-screen brand | `… then @Image2 logo settles lower-right …` |\n\nPrefer **appearance** language (“black short hair, silver earring”) over proper names the model cannot see.\n\n### E. Video reference (motion / camera / VFX)\n\n| Intent | Prompt pattern |\n| --- | --- |\n| Action / choreography | `Reference @Video1 for the fight/dance motion; characters from @Image1 …` |\n| Camera only | `Follow @Video1\'s camera path and transitions; subject from @Image1 …` |\n| Effects | `Reference @Video1 particle/wing effect on @Image1 …` |\n| Rhythm / cuts | `Cut rhythm matches @Video1; subjects from @Image1–@ImageN …` |\n\nBe explicit: **which attribute** of `@VideoN` (motion vs camera vs grade vs pacing).\n\n### F. Edit / extend / bridge (still `refVideos` + prompt)\n\nThese create a **new** pool asset; they do not mutate the source timeline item.\n\n| Use case | Prompt shape (prefer direct verbs) | Params |\n| --- | --- | --- |\n| **Edit** | `Replace the scarf in @Video1 with a red one; keep camera and timing.` | `refVideos: [source]` ± `refImages` for replacements |\n| **Extend after** | `Continue after @Video1: …` / `Generate content after @Video1: …` | `refVideos: [source]`; `durationSeconds` = length of the **new** generated segment |\n| **Extend before** | `Generate content before @Video1: …` / lead-in into the existing clip | same |\n| **Bridge / track** | `@Video1, [transition], then @Video2, [transition], then @Video3` | up to **3** videos; total ref video time ideally ≤ **15s** |\n\n**Edit vs pure reference:** for edit/extend, address `@Video1` as the **source to change/continue**. Avoid “reference @Video1 for style” wording when you actually want an edit — that steers the model into generic R2V.\n\nWhen iterating a failed shot, prefer **edit** of the best prior take over full T2V restarts (keeps what already works).\n\n### G. Audio reference\n\n```ts\nsubmit_video({\n  model: "seedance2",\n  refImages: ["subjectId"],\n  refAudios: ["bedId"],\n  prompt: "@Image1 character walks a rainy street; timing and mood follow @Audio1.",\n  durationSeconds: 8,\n  name: "Rain walk · audio-led",\n});\n```\n\nAudio alone is invalid — always pair with a visual channel.\n\n## Prompt writing\n\n### Core formula\n\n**Subject + Action/Motion + Scene + Lighting/Color + Camera + Style + Quality + Negatives**\n\nFill only what matters; omit empty slots. For multi-shot, write a **timeline storyboard** (who / where / action / camera per beat).\n\n### Three multi-shot styles (single clip, 4–15s)\n\n1. **Short ideation** — one paragraph, one or two beats (exploration).\n2. **Descriptive package** — aesthetic + story + characters + environment + action + production notes + negatives (balanced control).\n3. **Granular timestamps** — `Shot 1 (0–2s): … Shot 2 (2–5s): …` matching `durationSeconds` (max control).\n\nLonger durations (10–15s) tolerate more sub-shots; still **one camera move per sub-shot**.\n\n**Continuous single take** — when the user wants unbroken motion, say so explicitly: `one continuous take, no hard cuts` and describe a single evolving path instead of numbered shots.\n\n**Timestamp tips**\n\n- Sum of shot windows should equal `durationSeconds`.\n- Put intentional transitions at boundaries (“hard cut to CU”, “whip pan into …”).\n- Quality/negative tail once at the end, not per shot.\n\n**Example (8s, 9:16, 4 sub-shots + image anchor):**\n\n```\n8s, 9:16, cinematic.\nShot 1 (0–2s): Full shot, @Image1 woman walks onto red carpet, soft top-light, slow dolly in.\nShot 2 (2–4s): Medium shot, she turns to camera, holds perfume bottle, key light camera-left.\nShot 3 (4–6s): Close-up on the bottle, gentle rotation, shallow DOF.\nShot 4 (6–8s): Medium shot, she smiles, dress hem moves in light wind.\n4K sharp details, face stable, no mutation, no duplicated limbs, hands anatomically correct.\n```\n\n### @ mention hygiene\n\n| Do | Don\'t |\n| --- | --- |\n| `@Image1 (dark-haired woman) enters @Image2 (loft)` | `make her look like the reference` |\n| `Reference @Video1 for camera only` | stack push-in + orbit in one sub-shot |\n| `@Image1 on LEFT, @Image2 on RIGHT, fixed camera` | rely on names without appearance words |\n\nAfter `@ImageN` / `@VideoN` / `@AudioN`, always a **noun or parenthetical** before verbs.\n\n### Camera language (model-friendly)\n\n| Category | Terms |\n| --- | --- |\n| Shot size | Close-up, MCU, Medium, Full, Long, Extreme long |\n| Angle | Eye-level, Low, High, OTS, Top-down |\n| Move | Push-in, Pull-out, Pan, Tilt, Dolly/Track, Orbit, Handheld |\n| Lens / FX | Shallow DOF, Slow-mo, Time-lapse, Hitchcock zoom |\n\n### On-screen text & dialogue (prompt-only)\n\nNative audio is always generated. You can request:\n\n- **Titles / slogans:** content + timing + position + style  \n  (`text "…" appears center after 2s, bold white`)\n- **Subtitles:** bottom captions synced to spoken lines\n- **Speech bubbles:** character says "…"; bubble near speaker\n- **Spoken lines:** quote dialogue in the prompt for lip-sync-ish delivery\n\nPrefer common characters; avoid rare glyphs/special symbols for burned-in text.\n\n### Quality & stability tail\n\nFor faces / characters, append by default unless the user wants lo-fi:\n\n> `sharp details, character face stable, no mutation, no clipping, no duplicated limbs, hands anatomically correct`\n\n## Cross-clip consistency (multiple jobs)\n\nSeedance calls are **stateless**. For recurring identity across separate `submit_video` jobs:\n\n1. Pin a static anchor: `refImages: [characterOrProduct]`.\n2. After shot N is approved, also pass it as `refVideos: [shotNAssetId]` on shot N+1.\n3. Wait with `track_progress` (`action=wait`) before dependent jobs — never parallelize dependent continuity.\n4. After **two** failed text-only retries on identity, stop tweaking prose → change/add anchors or use **edit** mode on the best take.\n\nMulti-character: one anchor image per character; every prompt names the **active** character + attributes and **negates** the others; same-frame → left/right + outfit colors + prefer fixed camera.\n\n## When to use Seedance vs Kling vs Hailuo\n\n| Need | Prefer |\n| --- | --- |\n| Multimodal refs (video/audio), edit/extend/bridge | **seedance2** |\n| Structured multi-shot with per-shot durations (`multiPrompts`) | **kling** `shotType=customize` |\n| Quick auto multi-shot from one paragraph | **kling** `shotType=intelligence` |\n| Simple 6s/10s T2V or single-image I2V only | **hailuo** |\n\n## Content review\n\n- Real human faces (incl. photoreal generated) generally OK as refs.\n- Celebrity / IP / branded mascot likenesses often blocked — surface the error; ask for another ref; do not blind-retry the same assets.\n\n## Errors (server / provider)\n\n| Message / pattern | Fix |\n| --- | --- |\n| `seedance2 resolution must be 480p, 720p, 1080p, or 4k` | Use one of those four |\n| `seedance2 lastFrame mode cannot be combined with references` | Drop refs **or** drop `lastFrame` |\n| `seedance2 reference limit exceeded` | ≤9 images, ≤3 videos, ≤3 audios |\n| `seedance2 audio references require a visual reference` | Add firstFrame or ref image/video |\n| `lastFrame requires firstFrame` | Supply both |\n| `durationSeconds must be between 2 and 15` | Clamp duration |\n| `does not support ratio …` | Use allowed ratio list |\n| content-review / policy failure | New refs; do not retry same IP face |\n| timeout / provider failed | Report; adjust prompt or simplify refs; avoid thrice-identical payload |\n\n## Tool checklist before submit\n\n1. `model: "seedance2"` and Seedance key is on (capabilities).\n2. `name` is descriptive for the media pool.\n3. Param combo matches the intended mode (see exclusion rules).\n4. Every media slot is a project asset id; prompt `@` ordinals match payload order.\n5. `durationSeconds` integer 2–15; multi-shot timestamps sum to it.\n6. `resolution` is `480p` (draft), `720p` (default), `1080p`, or `4k` (final delivery; heavier).\n7. No Kling-only fields.\n8. Briefly tell the user model + duration + mode before calling.\n\n## Full multimodal example\n\n```ts\nsubmit_video({\n  model: "seedance2",\n  prompt: [\n    "9:16, 10s, cinematic product film.",\n    "Shot 1 (0–3s): @Image1 bottle on marble, slow orbit, soft key from left.",\n    "Shot 2 (3–7s): hand lifts bottle; motion energy follows @Video1 camera push.",\n    "Shot 3 (7–10s): hero CU, label sharp; mood follows @Audio1.",\n    "sharp details, no warping logo, stable reflections.",\n  ].join(" "),\n  firstFrame: "heroStillId",       // @Image1\n  refImages: ["labelDetailId"],    // @Image2\n  refVideos: ["orbitRefId"],       // @Video1\n  refAudios: ["bedId"],            // @Audio1\n  durationSeconds: 10,\n  name: "Bottle hero · 10s multi-beat",\n});\n```\n\nThen:\n\n```ts\ntrack_progress({ action: "wait", target: "generation", jobIds: "<jobId>" });\n```\n\nAsset lands in the **media pool only**. Place with `edit_item` when the user wants it on the timeline.\n',Oe=`---
name: video-thumbnail-generator
description: Create platform-ready thumbnails from real video frames. Use when the user wants a thumbnail, cover image, YouTube cover, Shorts cover, Bilibili cover, Xiaohongshu cover, or other video poster image.
---

# Video Thumbnail Generator

Use this skill to create a high-clarity thumbnail or cover image from the actual video content.

## Non-Negotiables

1. Use the real video as visual evidence.
   - If the thumbnail shows a person, product, UI, frame, or scene from the video, extract or inspect real frames.
   - Never invent a generic software interface, fake product screen, or unrelated person.

2. Read style references before recommending styles.
   - Use \`references/thumbnail-styles.md\` and \`references/thumbnail-style-recipes.md\`.
   - Only offer style directions supported by those references or by the user's explicit instruction.

3. Keep text short and readable.
   - Usually 2-5 words.
   - Avoid thin type, low contrast, small labels, and clutter.

## Workflow

1. Confirm platform and aspect ratio if missing.
   - YouTube / Bilibili: usually 16:9.
   - Shorts / TikTok / Douyin: usually 9:16.
   - Xiaohongshu / WeChat Channels: usually 3:4.
   - Correct ambiguous ratio language gently, especially 4:3 vs 3:4.
2. Read project state, transcript, and available media context.
3. Inspect candidate frames:
   - expressive face
   - product or UI clearly visible
   - dramatic action moment
   - clean composition
   - strong lighting or clear subject separation
4. Classify the thumbnail job:
   - talking-head / opinion / tutorial
   - product / software / demo
   - cinematic / documentary / art
   - entertainment / challenge / reaction
   - education / business / concept
5. Propose concise title text options.
6. Offer 3-6 clearly different style directions.
   - Each option should name the composition, not only a channel/style label.
   - Exclude weak options.
   - Wait for user choice when the direction is not obvious.
7. Generate thumbnail options using selected real frames and the selected style.
8. Check mobile readability, subject fidelity, product/UI truthfulness, and visual contrast.
9. Present results and offer targeted adjustments.

## Prompt Shape

\`\`\`text
[Platform] thumbnail, [aspect ratio / dimensions], [style name].

COMPOSITION: [subject position, scale, background, graphic balance]
REAL REFERENCE: [describe selected frame zone by zone]
TEXT: "[short title]" in [high-contrast style]
STYLE: [one-line style recipe from references]
CONSTRAINTS: readable at mobile size, no fake UI, no watermark, no play button.
\`\`\`

## References

- \`references/thumbnail-styles.md\`: style library from real thumbnail analysis.
- \`references/thumbnail-style-recipes.md\`: quick style recipes and prompt patterns.
- \`references/field-testing-notes.md\`: known failure modes.`,ke=`---
name: voice
description: |
  Text-to-Speech (TTS), voiceover, narration placement/sync, and custom sound effects (SFX) generator. Use when the user wants generated speech from text, wants to add/replace/align narration or voiceover for an existing video/timeline, wants to keep existing voiceover synced after visual retiming edits, needs voice audition/selection, or explicitly wants a newly generated/custom sound effect that is not available in the Sound Effects library.
user-invocable: true
---

# Voice & Sound Effects Generator

Generate voiceovers (TTS) and sound effects. For TTS, choose a concrete
provider and voice before calling \`submit_voice\`.

## When to Use

- Generate voiceover/narration from text
- Create text-to-speech audio for videos
- Add, replace, or redo narration/voiceover for an existing video, timeline,
  screen recording, slide animation, product demo, B-roll edit, MG explainer, or
  other visual sequence
- Keep existing narration/voiceover aligned after trimming, speeding up, slowing
  down, moving, reordering, or replacing the visuals it describes
- Offer and audition TTS voice choices when the user has not picked a concrete voice
- Generate custom sound effects from text descriptions only after checking the Sound Effects library first

## TTS (Text-to-Speech)

If the current request has an existing visual target and the user wants
narration, voiceover, dubbing, or replacement speech for that target, read
[references/video-sync.md](references/video-sync.md) before drafting new
narration, using existing narration text to generate TTS, or placing audio. Do
this even when the user did not explicitly say "sync" or "match the visuals";
the existence of a visual target means narration timing and meaning may need to
follow on-screen content. Use the normal standalone TTS path only when there is
no visual target or the user just wants an audio asset from text.

Also read [references/video-sync.md](references/video-sync.md) when the timeline
already has narration/voiceover and the user asks to change the visuals while
keeping that voiceover aligned. This is a sync maintenance task even if no new
TTS is needed.

Use \`submit_voice\` to create a TTS audio asset. The current MCP tool contract is:

- \`provider\` is required. Configured choices may be \`doubao\`, \`elevenlabs\`,
  \`minimax\`, \`inworld\`, \`fishaudio\`, \`speechify\`, \`openai\`, \`gemini\`,
  \`mistral\`, or \`cartesia\`. All providers are opt-in; use only providers shown
  as configured in the capabilities prompt.
- \`voiceId\` is required, concrete, and provider-specific. The only exception is
  deliberate MiniMax \`timbreWeights\` mixing, where \`voiceId\` must be empty. Do
  not mix catalogs.
- The curated catalog in [references/voices.md](references/voices.md) covers
  only Doubao, ElevenLabs, and MiniMax. Other providers have no bundled preset
  or sample catalog in OpenChatCut. Require a concrete voice ID from the user or
  their provider account; never invent a preset or \`/voice-samples/...\` URL.
- AI SDK-backed fields are provider-specific: OpenAI supports \`modelId\`,
  \`speed\`, \`outputFormat\`, and \`instructions\`; Gemini supports \`modelId\`,
  \`outputFormat\`, and \`instructions\`; Mistral supports \`modelId\` and
  \`outputFormat\`; Cartesia supports \`modelId\`, \`speed\`, \`languageCode\`, and
  \`outputFormat\`. Omit unsupported or unrequested fields.
- Inworld, Fish Audio, and Speechify accept only \`voiceId\` plus optional
  \`modelId\`. Do not pass expressive, speed, language, or output controls to
  these providers.
- \`submit_voice\` creates an audio asset only. Timeline placement, replacement,
  trimming, and alignment happen later with timeline tools.
- For long narration, multiple \`submit_voice\` calls can be useful: split at
  natural pauses, sentence groups, or script beat boundaries when the workflow
  benefits from separately timed or placed voice clips.
- Doubao supports \`speedRatio\`, \`loudnessRatio\`, \`pitch\`, \`emotion\`,
  \`emotionScale\`, \`performancePrompt\`, and \`explicitDialect\`, but not every
  voice supports every expressive control. Check
  [references/voices.md](references/voices.md) before using them.
- ElevenLabs retains its official voice settings, language, seed, output,
  normalization, pronunciation-dictionary, continuity, logging, and latency
  controls. MiniMax retains its dedicated controls documented in
  [references/minimax-tts.md](references/minimax-tts.md).

Doubao control support for current curated voices:

- \`vivi\`, \`xiaohe\`, \`yunzhou\`, \`xiaotian\`, \`naiqimengwa\`, \`yingtaowanzi\`,
  \`wenroumama\`, \`zhixingnv\`, \`dayi\`, \`jitangnv\`, \`liuchang\`, \`ruyayichen\`,
  \`morgan\`, \`qingcang\`, \`huiben\`, \`popo\`, \`yuanboxiaoshu\`, \`baqiqingshu\`, and
  \`tangseng\` support explicit \`emotion\` / \`emotionScale\`,
  \`performancePrompt\`, and ASMR-style prompt directions.
- \`shuanglangshaonian\` supports \`performancePrompt\` and COT/QA-style
  instruction following, but does not support explicit \`emotion\` /
  \`emotionScale\` or ASMR-style control.
- \`explicitDialect\` is only supported by \`vivi\` and can be \`dongbei\`,
  \`shaanxi\`, or \`sichuan\`.

ElevenLabs control support for current curated voices:

- \`amelia\`, \`brittney\`, \`hope\`, \`jessica\`, \`arabella\`, \`jane\`, \`maria\`,
  \`mark\`, \`frederick\`, \`peter\`, \`james\`, \`jon\`, \`sully\`, \`david\`, and \`alex\`
  all support the same request-level controls; model-specific support is still
  validated by ElevenLabs.
- These controls are not per-voice guarantees of a specific acting style.
  Use the preset tags/samples to pick a naturally suitable voice, then use the
  controls for moderate delivery changes.
- For ElevenLabs \`eleven_v3\`, inline audio tags are available when the user
  asks for expressive delivery such as emotion, tone, nonverbal cues, accent
  hints, or local pacing. Official examples fit these useful TTS categories:
  emotion/tone tags such as \`[happy]\`, \`[sad]\`, \`[angry]\`, \`[excited]\`,
  \`[curious]\`, \`[sarcastic]\`, \`[crying]\`, \`[annoyed]\`, \`[appalled]\`,
  \`[thoughtful]\`, \`[surprised]\`, and \`[mischievously]\`; vocal delivery and
  nonverbal cue tags such as \`[whispers]\`, \`[laughs]\`, \`[sighs]\`, \`[exhales]\`,
  \`[inhales deeply]\`, \`[clears throat]\`, \`[snorts]\`, \`[swallows]\`,
  \`[wheezing]\`, and \`[coughs]\`;
  pacing/pause/local speed tags such as \`[slowly]\`, \`[pause]\`,
  \`[short pause]\`, \`[long pause]\`, \`[rushed]\`, and \`[drawn out]\`; and
  accent/special-performance tags such as
  \`[strong X accent]\`, for example \`[strong French accent]\`, plus \`[sings]\`,
  \`[singing]\`, \`[woo]\`, and \`[pirate voice]\`. Official examples are
  non-exhaustive; similar auditory tags can be tried when the user explicitly
  asks for that delivery and the tag describes how the voice should sound, not
  a visual action. Write tags directly in \`text\`, close to the short phrase
  they should affect. Treat tags as local guidance, not paragraph-wide controls.
- For pauses and pacing in \`eleven_v3\`, use punctuation, text structure,
  shorter generated segments, or local audio tags such as \`[short pause]\` and
  \`[slowly]\` when needed.

\`\`\`ts
// English / multilingual via ElevenLabs
submit_voice({
  provider: "elevenlabs",
  text: "Hello world",
  voiceId: "peter",
});

// Chinese via Doubao
submit_voice({
  provider: "doubao",
  text: "你好世界",
  voiceId: "liuchang",
});

// With speed adjustment (Doubao only)
submit_voice({
  provider: "doubao",
  text: "这是一段稍快的中文旁白。",
  voiceId: "liuchang",
  speedRatio: 1.5,
});

// With expressive Doubao controls
submit_voice({
  provider: "doubao",
  text: "这次事故提醒我们，安全永远不能侥幸。",
  voiceId: "liuchang",
  emotion: "sad",
  emotionScale: 3,
  performancePrompt: "痛心但克制，语速稍慢，像新闻专题旁白",
  pitch: -1,
  speedRatio: 0.92,
});

// With ElevenLabs delivery controls
submit_voice({
  provider: "elevenlabs",
  text: "The launch changed how teams plan their daily work.",
  voiceId: "peter",
  speed: 0.95,
  stability: 0.4,
  similarityBoost: 0.8,
  outputFormat: "wav_44100",
});

// MiniMax TTS (when configured) — see references/minimax-tts.md
submit_voice({
  provider: "minimax",
  text: "欢迎使用视频编辑助手。",
  voiceId: "female-yujie",
  speed: 1,
  name: "VO · welcome",
});

// Cartesia shape after the user confirms the exact account voice ID.
// confirmedCartesiaVoiceId represents that supplied value, not a preset.
submit_voice({
  provider: "cartesia",
  text: "A concise product introduction.",
  voiceId: confirmedCartesiaVoiceId,
  modelId: "sonic-3",
  speed: 1,
  languageCode: "en",
  outputFormat: "mp3",
});
\`\`\`

## Voice Audition Before Generation

When the user needs TTS and has not already chosen a concrete voice, first
separate providers with curated OpenChatCut choices from providers that require
an account-specific voice ID.

For Doubao, ElevenLabs, or MiniMax, read
[references/voices.md](references/voices.md) before recommending, rendering, or
submitting an option. Use it as the only source for curated preset IDs,
provider choice, display labels, tags, and bundled sample URLs. Do not create
voice options from memory, translated names, or broad user descriptions.

For Inworld, Fish Audio, Speechify, OpenAI, Gemini, Mistral, or Cartesia, do not
offer an invented audition list or sample URL. Ask the user for the concrete
voice ID from that configured provider. A broad description such as "warm
female" is not a valid \`voiceId\`.

First determine two separate languages:

- User conversation language: the language the user used to talk to you. Use
  this for the surrounding reply, \`form-visual label\`, \`visual-option name\`,
  and \`summary\`.
- Target narration language: the language of the text being synthesized. Use
  this only to choose provider and voice catalog.

The audition widget's submit button is fixed to the default label in this build
(\`submitLabel\` is accepted but not rendered); keep the question label and option
labels in the user conversation language, not the target narration language. For example:
English users see \`submit_label="Submit"\`, Chinese users see
\`submit_label="提交"\`, and Spanish users see \`submit_label="Enviar"\`.

"help me generate ... voice over in Chinese" is an English conversation asking
for Chinese narration, so the audition widget copy stays in English while the
voice candidates come from Doubao.

For a curated provider:

1. Filter \`references/voices.md\` by target narration language / provider and
   explicit requirements such as gender, age range, tone, and use case.
2. If no preset matches all explicit requirements, say there is no exact match
   and offer the closest supported presets with a clear caveat.
3. Pick 2-4 matching curated presets.
4. Load \`widget-forms\`, then call \`ask_followup_questions\` with voice options
   and real bundled audio samples.
5. Wait for the user to choose.
6. Call \`submit_voice\` with the selected preset ID as \`voiceId\`.

For a provider without a curated OpenChatCut catalog, ask for a free-text,
concrete provider voice ID instead. Do not add \`media\` or synthesize a
\`/voice-samples/...\` path. Wait for the user to supply/confirm the exact ID
before calling \`submit_voice\`.

For each curated audition option, keep \`value\`, display label, \`media\`, and
\`summary\` tied to the same preset row from \`references/voices.md\`. Use only the
sample URLs recorded there. Keep \`value\` as the preset ID and \`media\` as its
matching sample URL. Write \`name\` and \`summary\` in the user's conversation
language. The target narration language only decides the provider/voice
catalog. After submission, map the display name back to the preset ID from the
same candidate list.

English request for Chinese narration:

\`\`\`html
<widget submit_label="Submit">
  <form-visual
    id="voiceId"
    label="For Chinese voiceover, I recommend a few voices to try:"
    required="true"
  >
    <visual-option
      value="vivi"
      name="Vivi"
      media="/voice-samples/doubao-vivi.mp3"
      aspect-ratio="16:5"
      summary="Female / young / friendly, general"
    />
    <visual-option
      value="xiaohe"
      name="Xiaohe"
      media="/voice-samples/doubao-xiaohe.mp3"
      aspect-ratio="16:5"
      summary="Female / young / soft, clear"
    />
    <visual-option
      value="yunzhou"
      name="Yunzhou"
      media="/voice-samples/doubao-yunzhou.mp3"
      aspect-ratio="16:5"
      summary="Male / young / neutral, business"
    />
  </form-visual>
</widget>
\`\`\`

Chinese request for Chinese narration:

\`\`\`html
<widget submit_label="提交">
  <form-visual
    id="voiceId"
    label="我推荐这几个中文旁白音色，先试听一下："
    required="true"
  >
    <visual-option
      value="morgan"
      name="Morgan"
      media="/voice-samples/doubao-morgan.mp3"
      aspect-ratio="16:5"
      summary="男 / 中年 / 低沉知识解说"
    />
    <visual-option
      value="zhixingnv"
      name="知性女声"
      media="/voice-samples/doubao-zhixingnv.mp3"
      aspect-ratio="16:5"
      summary="女 / 中年 / 冷静知识讲解"
    />
    <visual-option
      value="vivi"
      name="Vivi"
      media="/voice-samples/doubao-vivi.mp3"
      aspect-ratio="16:5"
      summary="女 / 年轻 / 亲切通用口播"
    />
  </form-visual>
</widget>
\`\`\`

## Sound Effects

For ordinary editing sound effects (SFX), do **not** generate first. Use the
built-in Sound Effects library before generating:

1. Call \`browse_library\` with \`category:"sound-effects"\` and a query such as
   \`"whoosh"\`, \`"camera shutter"\`, \`"notification"\`, \`"censor beep"\`, or
   \`"record scratch"\`.
2. Inspect the returned \`library:sound:<id>\`.
3. Place it with \`edit_item\`, using \`fromFrame\` as the sound's
   anchor/editorial moment frame:

\`\`\`ts
browse_library({
  category: "sound-effects",
  query: "short whoosh transition",
});

edit_item({
  adds: [
    {
      type: "audio",
      assetId: "library:sound:whoosh-short",
      fromFrame: 120,
      trackId: "A1",
    },
  ],
});
\`\`\`

Only generate sound effects from text descriptions with \`submit_sound\` when:

- The user explicitly asks for a generated/original/custom sound.
- The requested sound is too specific for the existing Sound Effects library.
- \`browse_library({ category:"sound-effects", query })\` returns no suitable
  match.

\`\`\`ts
// Custom/generated sound effect after the library has no suitable match
submit_sound({ prompt: "A dog barking in the distance" });

// With custom duration (0.5-22 seconds)
submit_sound({
  prompt: "Thunder and heavy rain",
  durationSeconds: 15,
});

// High prompt adherence
submit_sound({
  prompt: "Sci-fi laser gun firing",
  promptInfluence: 0.8,
});
\`\`\`

**Tips for better results:**

- Be specific: "A dog barking loudly" vs just "dog"
- Include context: "Footsteps on wooden floor in an empty room"
- Specify style: "Cinematic whoosh" or "8-bit game sound"

## Parameters

### TTS

| Field | Description | Notes |
| --- | --- | --- |
| \`provider\` | \`doubao\`, \`elevenlabs\`, \`minimax\`, \`inworld\`, \`fishaudio\`, \`speechify\`, \`openai\`, \`gemini\`, \`mistral\`, or \`cartesia\` | Required; configured choices only |
| \`text\` | Text to synthesize | Required |
| \`voiceId\` | Concrete provider-specific voice ID | Required except MiniMax timbre mix |
| \`modelId\` | Provider model override | ElevenLabs, Inworld, Fish Audio, Speechify, OpenAI, Gemini, Mistral, Cartesia |
| \`speed\` | Speech speed | ElevenLabs, MiniMax, OpenAI, Cartesia |
| \`languageCode\` | Language hint/code | ElevenLabs, Cartesia |
| \`outputFormat\` | Provider-supported output format | ElevenLabs, OpenAI, Gemini, Mistral, Cartesia |
| \`instructions\` | Natural-language delivery direction | OpenAI, Gemini |
| \`speedRatio\` | Speech speed | Doubao only |
| \`name\` | Media-pool asset name | Optional |

### Sound Effects

| Field             | Description       | Notes          |
| ----------------- | ----------------- | -------------- |
| \`prompt\`          | Sound description | Required       |
| \`durationSeconds\` | Duration          | 0.5-22 seconds |
| \`promptInfluence\` | Prompt adherence  | 0-1            |
| \`name\`            | Asset name        | Optional       |

## Voices

Use the \`submit_voice\` \`voiceId\` guide and
[references/voices.md](references/voices.md) for the current curated preset
list, display labels, tags, and sample URLs.

### Voice IDs are provider-specific — do NOT mix them

The curated catalog contains separate Doubao, ElevenLabs, and MiniMax IDs.
\`vivi\` / \`dayi\` are only Doubao; \`mark\` / \`amelia\` / \`james\` are only
ElevenLabs; \`female-yujie\` is only MiniMax. Inworld, Fish Audio, Speechify,
OpenAI, Gemini, Mistral, and Cartesia require a concrete provider-specific ID
confirmed by the user and have no bundled OpenChatCut samples.

Provider choice:

- Honor an explicit configured provider first.
- For Chinese narration, prefer a matching curated Doubao voice (or MiniMax
  when configured/requested). Use another provider only after the user chooses
  it and confirms its voice ID.
- For English / multilingual narration, prefer a curated ElevenLabs voice.
  Use another provider only after the user chooses it and confirms its voice ID.
- Never offer a provider that is not shown as configured in capabilities.

## Hard rules — what you must NOT do

1. Never use a voice ID from a different provider.
2. Never submit TTS while the voice is only described broadly; require a
   concrete provider-specific ID confirmed by the user.
3. Never recommend or render a curated TTS option before checking
   [references/voices.md](references/voices.md).
4. Never invent presets or sample URLs for Inworld, Fish Audio, Speechify,
   OpenAI, Gemini, Mistral, or Cartesia.
5. Never pass provider-specific fields to a provider that does not support them.
6. Never claim stable age, regional accent, pronunciation dictionary, or exact
   duration controls unless the selected provider exposes them.
7. Never replace original recorded speech with TTS unless the user asks.
`,Ae='# MiniMax TTS (`provider: "minimax"`)\n\nRead this before `submit_voice({ provider: "minimax", … })`.\n\nGrounded in OpenChatCut’s voice tool + server adapter (`server/plugins/voice.ts` → MiniMax `t2a_v2`). Preset table: [voices.md](voices.md) § MiniMax.\n\n## Capabilities (as wired)\n\n| Dimension | Value |\n| --- | --- |\n| Provider arg | `minimax` |\n| Text | Required |\n| `voiceId` | System/raw/cloned MiniMax id; defaults to `female-yujie`. Must be empty when using `timbreWeights` |\n| `speed` | Optional, **0.5–2** (default 1) → `voice_setting.speed` |\n| `pitch` | Optional, **-12–12** (default 0) → native `voice_setting.pitch` |\n| `volume` | Optional, **>0–10** (default 1) → `voice_setting.vol` |\n| `emotion` | Optional: happy, sad, angry, fearful, disgusted, surprised, calm, fluent, whisper |\n| Audio settings | sampleRate; mp3/pcm/flac/wav/pcmu/opus; channel. `bitrate` is MP3-only |\n| Streaming | `stream`; `excludeAggregatedAudio`; `forceCbr` only with streamed MP3. OpenChatCut still persists one local asset |\n| Language/text | languageBoost, textNormalization, latexRead, pronunciation tone entries |\n| Voice composition | timbreWeights (1–4 voices, weights 1–100), voiceModify pitch/intensity/timbre/effect |\n| Subtitle | `subtitleEnable` + sentence/word/word_streaming; downloaded as a durable JSON sidecar |\n| Placement | **Media pool only** — does not place on the timeline |\n\n## When to use\n\n- MiniMax key is configured and the user wants MiniMax TTS.\n- User named MiniMax speech (as distinct from Doubao / ElevenLabs).\n- Only MiniMax voice capability is on.\n\n## When not to use\n\n- Need Doubao dialect / `performancePrompt` → `doubao`\n- Need ElevenLabs multilingual catalog → `elevenlabs`\n- User has not picked a voice → offer candidates from [voices.md](voices.md) first\n\n## Tool shape\n\n```ts\nsubmit_voice({\n  provider: "minimax",\n  text: "……",\n  voiceId: "female-yujie",\n  speed: 1,\n  pitch: 0,\n  volume: 1,\n  emotion: "calm", // optional\n  sampleRate: 44100,\n  audioFormat: "wav",\n  languageBoost: "Chinese",\n  subtitleEnable: true,\n  subtitleType: "word",\n  pronunciations: ["OpenChatCut/(open chat cut)"],\n  voiceModify: { intensity: 10, effect: "spacious_echo" },\n  name: "VO · intro",\n});\n```\n\nThen place with `edit_item` only if the user wants it on a track.\n\n## Rules\n\n- Never mix MiniMax `voiceId` values with `provider: "doubao"` or `"elevenlabs"`.\n- Confirm a concrete `voiceId` before submit, except for a deliberate `timbreWeights` mix (empty `voiceId`).\n- `voiceModify` supports non-streaming mp3/wav/flac or streaming mp3 only.\n- `word_streaming`, `excludeAggregatedAudio`, and streamed `forceCbr` require `stream: true`.\n- `textNormalization` and `latexRead` map inside official `voice_setting`; `latexRead` forces Chinese language boost.\n- Check capabilities: if MiniMax voice is off, say which key is missing.\n',je=`# Voiceover Video Sync

Use this reference from the \`voice\` skill when existing visuals drive narration
timing. The job is not just generating TTS; it is making the spoken meaning line
up with what is on screen.

## When to Use

- The user has an existing video, timeline, screen recording, slide animation,
  product demo, B-roll edit, MG explainer, or similar visual sequence.
- The user provides narration text, asks you to write narration, or asks to add,
  replace, redo, dub, or generate voiceover for that visual sequence.
- The timeline already has narration/voiceover and the user asks to trim, speed
  up, slow down, reorder, replace, or retime the visuals while keeping the
  existing voiceover aligned.
- The video has meaningful visual sections: slide changes, product states,
  screen steps, chart/data moments, scene cuts, action beats, or key visual
  events.

Do not wait for the user to explicitly ask for sync. If there is a visual target,
assume the narration should respect the visual content and pacing unless the user
only wants a standalone audio asset.

Do not use this as the main path for cutting original human speech. Use the
talking-head workflow for editing existing spoken content.

## Workflow

1. Read the project state and identify the exact visual target: timeline range,
   video asset, selected item, or full composition. If multiple candidates are
   plausible, ask which one should receive voiceover.
2. Check whether the conversation already contains a usable narration plan,
   storyboard, or script table. Treat it as a draft sync map, not as approved
   TTS input. Reuse it only when it names visual anchors and time ranges for the
   same current visual target. If the target changed, the table is missing
   visual evidence, or any boundary is only a guess, verify only the missing or
   uncertain boundaries instead of restarting the whole visual review.
3. Keep the sync map tied to the current visual state. If an edit changes where
   visual content appears after the map was made, mark the affected rows stale.
   Before placing or reusing voiceover, rebuild or patch those rows from the
   current timeline/asset state. Do not keep using old visual windows after a
   visual retiming edit.
4. Understand the visuals before generating audio. Use project reads, timeline
   screenshots, and \`view_asset_frames\` for source-frame sampling when needed.
   Segment the target by visible content changes, not by arbitrary equal
   intervals.
5. Build a visual-voiceover sync map from actual visual evidence. Do not
   generate TTS or place voiceover until every segment has a confirmed visual
   anchor and placement start frame/time. For each segment, record:
   - visual start/end frame or time
   - visual anchor: slide title, product state, screen action, chart/data point,
     scene content, or event
   - evidence: inspected frame/time, screenshot, or visual-analysis result
   - narration text assigned to that visual moment
   - target duration and estimated TTS duration
   - fit status: fits / too long / uncertain
   - voiceover placement start frame or time
   - confidence or uncertainty
6. Split or write narration to fit the visual map. Keep each TTS segment tied to
   one visual segment or one intentional multi-shot beat. Do not create one long
   audio file for a video with multiple visual states. Before submitting TTS,
   map each narration line to a visual segment and check that the estimated TTS
   duration is plausibly short enough for its visual window. For short windows,
   prefer phrase-length copy over full sentences. Do not submit TTS for a line
   whose fit status is \`too long\` or \`uncertain\` until you tighten the wording,
   split the line, adjust supported speed, or ask the user to approve the timing
   tradeoff.
7. Follow the \`voice\` skill's audition workflow if the user has not picked a
   voice. Generate TTS per mapped segment.
8. After each TTS segment finishes, read the real audio duration before placing
   it. If the real duration exceeds its visual window or would make the
   narration describe a visual that is not currently on screen, do not place it
   on the timeline yet. Fix the mismatch before final delivery:
   - tighten or split narration
   - adjust speech speed when supported and natural
   - shift the placement to a better visual range
   - extend or hold a visual only when that preserves the edit
   - ask the user when the tradeoff changes meaning or style
9. Place each voiceover segment only after the actual-duration fit check passes.
   Place it at the matching visual start time from the current sync map. If
   original audio, music, or sound effects exist, decide whether to mute, duck,
   replace, or mix them based on user intent.
10. After patching or rebuilding stale rows, read back the updated timeline
    positions before claiming the edit is done. Confirm that caption text, spoken
    content, visual segment, placement, and actual audio duration still
    correspond.
11. Run a final coverage check before delivery. Every visual segment the user
    expected to be explained should either have matching voiceover or an explicit
    reason for silence. Voiceover should not start before its visual appears, and
    old voiceover should not remain over footage whose timing changed. If the
    turn changed any narration-backed visual timing, include a \`Final sync check\`
    in the response before saying the edit is complete.
12. Verify after placement. Read back item start/end/duration and inspect
    representative frames around each segment start, middle, and end. Preview or
    screenshot enough of the timeline to confirm the spoken meaning and current
    visual information match.

## Rules

- Do not drop a single generated narration track over a multi-section video and
  call it done.
- Do not let a TTS segment talk about a visual that has already disappeared or
  has not appeared yet.
- Do not rewrite user-provided narration in a way that changes claims, names,
  numbers, or intended meaning just to fit timing. Ask or preserve meaning.
- Do not cover meaningful original speech unless the user asked to replace,
  dub, mute, or voice over it.
- Do not treat slide/video length as enough evidence. Use visible anchors and
  content changes.
- Do not treat a script table or narration draft as ready-to-submit TTS input
  until each line has been mapped to a visual segment and checked against that
  segment's target duration.
- Do not use equal division or rough duration estimates as placement
  boundaries. If a boundary is only estimated, inspect more frames around that
  range until the content-change frame is confirmed, or ask the user to approve
  the approximation.
- Do not silently switch from visual-driven sync to narration-driven timing.
  That changes the edit contract. Ask the user before extending visuals,
  allowing desync, overlapping voiceover, or letting narration timing drive the
  cut.
- Do not treat a generated TTS asset as ready for placement just because it
  completed successfully. Real audio duration must pass the sync map's fit check
  first.
- Do not reuse a sync map after timeline or visual-source edits changed where
  visual content appears. Patch or rebuild the affected rows first.
- Do not report completion until expected voiceover coverage has been checked
  against the current timeline.
- Do not end a retiming turn immediately after timeline edits. First read back
  the updated item positions and report a \`Final sync check\` for each changed
  visual/voiceover pair.

## Output Format

When planning or reporting execution, use this compact shape:

- \`target_visual\`: asset/item/timeline range
- \`segments\`: visual range, visual anchor, narration text, TTS asset, audio
  duration, target duration, estimated duration, fit status, placement range,
  mismatch handling, map status
- \`mix\`: what happened to original audio/music
- \`Final sync check\`: pass/fail per segment, stale-map fixes, coverage gaps, and
  any timing fixes applied
`,Me="# Voice Presets\n\nThis page is the curated preset snapshot the agent works from. The backend\nholds the source of truth and keeps this file in sync.\n\nUse tags as selection filters. Use descriptions as practical hints. Age,\naccent, pronunciation, and exact duration are not stable controls unless the\nTTS provider exposes explicit parameters for them.\n\nThis curated snapshot covers Doubao, ElevenLabs, and MiniMax only. Inworld,\nFish Audio, Speechify, OpenAI, Gemini, Mistral, and Cartesia have no bundled\nOpenChatCut preset/sample catalog. For those providers, require a concrete\nprovider-specific `voiceId` from the user or their provider account; never\ninvent a preset or `/voice-samples/...` URL.\n\n## Doubao Chinese Voices\n\nUse Doubao for Chinese-optimized narration.\n\n| Preset               | Official display | English display      | Tags                                                           | Selection hint                                                |\n| -------------------- | ---------------- | -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |\n| `vivi`               | Vivi             | Vivi                 | female, young, friendly, general, short-explainer              | Everyday Chinese narration, product intros, short explainers  |\n| `xiaohe`             | 小何             | Xiaohe               | female, young, soft, calm, tutorial, walkthrough               | Calm tutorials, product walkthroughs, instructional narration |\n| `yunzhou`            | 云舟             | Yunzhou              | male, young, neutral, business, explainer                      | Business explainers, factual reads, product narration         |\n| `xiaotian`           | 小天             | Xiaotian             | male, young, bright, upbeat, casual                            | Casual creator-style videos and light social narration        |\n| `naiqimengwa`        | 奶气萌娃         | Childlike Boy        | male, child, cute, storybook, character                        | Cute boy character lines and children's stories               |\n| `yingtaowanzi`       | 樱桃丸子         | Cherry Voice         | female, child, cartoon, roleplay, character                    | Animated/kid-oriented character dialogue                      |\n| `wenroumama`         | 温柔妈妈         | Warm Mom             | female, middle-aged, warm, family, gentle                      | Family, lifestyle, parenting, gentle explanations             |\n| `zhixingnv`          | 知性女声         | Knowledgeable Female | female, middle-aged, calm, knowledge, explainer                | Education, culture, thoughtful explainers                     |\n| `dayi`               | 大壹             | Dayi                 | male, young, steady, formal, documentary, video-voiceover      | Formal voiceover, documentary, corporate narration            |\n| `jitangnv`           | 鸡汤女           | Inspirational Female | female, young, warm, inspirational, emotional, video-voiceover | Motivational, uplifting, emotional video narration            |\n| `liuchang`           | 流畅女声         | Smooth Female        | female, young, smooth, polished, video-voiceover, narration    | Clean product narration and polished video voiceover          |\n| `ruyayichen`         | 儒雅逸辰         | Yichen               | male, young, elegant, premium, culture, video-voiceover        | Cultural, premium, poetic, documentary-style narration        |\n| `morgan`             | Morgan           | Morgan               | male, middle-aged, deep, knowledge, explainer                  | Deep knowledge explainer, documentary, serious narration      |\n| `qingcang`           | 擎苍             | Qingcang             | male, old-like, authoritative, audiobook, character            | Weighty narration, dramatic reads, audiobook scenes           |\n| `huiben`             | 儿童绘本         | Storybook Voice      | female, young, gentle, storybook, audiobook                    | Gentle storybook or bedtime-style narration                   |\n| `popo`               | 婆婆             | Grandma              | female, old, warm, story, character                            | Grandmother characters, folk stories, nostalgic narration     |\n| `yuanboxiaoshu`      | 渊博小叔         | Erudite Uncle        | male, middle-aged, knowledge, calm, explainer                  | Calm explainers, cultural commentary, educational narration   |\n| `baqiqingshu`        | 霸气青叔         | Confident Uncle      | male, middle-aged, confident, audiobook, narrative             | Audiobook narration, long-form stories, dramatic reads        |\n| `shuanglangshaonian` | 爽朗少年         | Cheerful Teen        | male, young, cheerful, youthful, roleplay, character           | Bright roleplay, teen/creator dialogue, youthful scenes       |\n| `tangseng`           | 唐僧             | Tang Seng            | male, old-like, calm, roleplay, character                      | Monk-like dialogue, traditional stories, steady narration     |\n\nImportant caveat: the current Doubao seed-tts-2.0 resource does not expose an\nexplicit general-purpose old-male voice. `qingcang` and `tangseng` are\nold-like approximations, not guaranteed old-male controls.\n\n### Doubao Control Support\n\nBase controls for curated Doubao voices: `speedRatio`, `loudnessRatio`, and\n`pitch`.\n\nExpressive controls:\n\n- Supports `emotion`, `emotionScale`, `performancePrompt`, and ASMR-style prompt\n  directions: `vivi`, `xiaohe`, `yunzhou`, `xiaotian`, `naiqimengwa`,\n  `yingtaowanzi`, `wenroumama`, `zhixingnv`, `dayi`, `jitangnv`, `liuchang`,\n  `ruyayichen`, `morgan`, `qingcang`, `huiben`, `popo`, `yuanboxiaoshu`,\n  `baqiqingshu`, `tangseng`.\n- `shuanglangshaonian` supports `performancePrompt` and COT/QA-style\n  instruction following only. Do not use `emotion`, `emotionScale`, or\n  ASMR-style prompt directions with this voice.\n- `explicitDialect` is only supported by `vivi`; allowed values are `dongbei`,\n  `shaanxi`, and `sichuan`.\n\n## ElevenLabs English / Multilingual Voices\n\nUse ElevenLabs for English or multilingual narration. Official accent labels\nare English-source voice cues, not target-language accent controls.\n\n| Preset      | Tags                                                       | Selection hint                                             |\n| ----------- | ---------------------------------------------------------- | ---------------------------------------------------------- |\n| `amelia`    | female, young, upbeat, narrative-story, social-media       | Story reads, podcast intros, reels, enthusiastic ads       |\n| `brittney`  | female, young, upbeat, social-media, fun                   | Creator videos, recaps, hot-topic commentary, how-to clips |\n| `hope`      | female, young, upbeat, clear, social-media                 | Crisp short-form narration and quick explainers            |\n| `jessica`   | female, middle-aged, calm, conversational, narrative-story | Composed narration, confident product copy, direct reads   |\n| `arabella`  | female, young, gentle, emotive, narrative-story            | Fantasy, romance, wellness, atmospheric stories            |\n| `jane`      | female, old, professional, audiobook, narrative-story      | Long-form book pacing and classic narration                |\n| `maria`     | female, old, calm, grandmother, narrative-story            | Grandmother-style narration and reflective story delivery  |\n| `mark`      | male, young, casual, conversational, natural               | Dialogue, assistant-style replies, informal scripts        |\n| `frederick` | male, middle-aged, calm, documentary, narrative-story      | History, science, mystery, factual films                   |\n| `peter`     | male, middle-aged, confident, credible, narrative-story    | Trustworthy narration, explainers, brand reads             |\n| `james`     | male, middle-aged, deep, husky, narrative-story            | Audiobooks, heavier story narration, professional VO       |\n| `jon`       | male, middle-aged, calm, grounded, narrative-story         | Clear messaging, commercials, trustworthy narration        |\n| `sully`     | male, old, deep, storyteller, narrative-story              | Deep elderly narration and warm authoritative reads        |\n| `david`     | male, old, deep, storyteller, narrative-story              | Classic audiobook passages and grounded dramatic reads     |\n| `alex`      | male, young, confident, entertainment-tv, social-media     | YouTube, shorts, entertainment clips                       |\n\n### ElevenLabs Control Support\n\nAll current curated ElevenLabs presets support the same request-level controls:\n`modelId`, `speed`, and `stability`.\n\nImportant limits:\n\n- These controls are provider/model-level controls, not per-voice capability\n  switches. No current curated ElevenLabs preset is excluded from them, but the\n  audible result varies by the source voice's natural delivery.\n- For ElevenLabs `eleven_v3`, inline audio tags are available when the user\n  asks for expressive delivery such as emotion, tone, nonverbal cues, accent\n  hints, or local pacing. Official examples fit these useful TTS categories:\n  emotion/tone tags such as `[happy]`, `[sad]`, `[angry]`, `[excited]`,\n  `[curious]`, `[sarcastic]`, `[crying]`, `[annoyed]`, `[appalled]`,\n  `[thoughtful]`, `[surprised]`, and `[mischievously]`; vocal delivery and\n  nonverbal cue tags such as `[whispers]`, `[laughs]`, `[sighs]`, `[exhales]`,\n  `[inhales deeply]`, `[clears throat]`, `[snorts]`, `[swallows]`,\n  `[wheezing]`, and `[coughs]`;\n  pacing/pause/local speed tags such as `[slowly]`, `[pause]`,\n  `[short pause]`, `[long pause]`, `[rushed]`, and `[drawn out]`; and\n  accent/special-performance tags such as\n  `[strong X accent]`, for example `[strong French accent]`, plus `[sings]`,\n  `[singing]`, `[woo]`, and `[pirate voice]`. Official examples are\n  non-exhaustive; similar auditory tags can be tried when the user explicitly\n  asks for that delivery and the tag describes how the voice should sound, not\n  a visual action. Write tags directly in `text`, close to the short phrase\n  they should affect. Treat tags as local guidance, not paragraph-wide controls.\n- For pauses and pacing in `eleven_v3`, use punctuation, text structure,\n  shorter generated segments, or local audio tags such as `[short pause]` and\n  `[slowly]` when needed.\n\n## MiniMax Chinese Voices\n\nUse MiniMax when that vendor is configured and the user wants MiniMax TTS\n(or Doubao/ElevenLabs are off). Pass `provider: \"minimax\"` and a system\n`voiceId` (or a cloned voice id from the user's MiniMax account).\n\n| Preset | Tags | Selection hint |\n| --- | --- | --- |\n| `female-yujie` | female, adult, clear, default, narration | Default MiniMax system voice; product / general narration |\n| `female-shaonv` | female, young, bright, casual | Youthful / light social reads |\n| `female-chengshu` | female, mature, calm, professional | Mature professional narration |\n| `female-tianmei` | female, sweet, soft, lifestyle | Softer lifestyle / gentle product lines |\n| `male-qn-qingse` | male, young, clear, neutral | Everyday male Chinese narration |\n| `male-qn-jingying` | male, adult, steady, business | Business / confident explainer tone |\n\nSee [minimax-tts.md](minimax-tts.md) for tool knobs (`speed`, `emotion`).\n\n### MiniMax Control Support\n\n- `speed` roughly `0.5–2` (server enforces range).\n- Optional `emotion` labels when the model accepts them: happy, sad, angry,\n  fearful, disgusted, surprised, calm, fluent, whisper.\n- Do **not** pass Doubao-only fields (`speedRatio`, `performancePrompt`,\n  `explicitDialect`, …) or ElevenLabs-only fields (`modelId`, `stability`).\n\n## Audition Samples\n\nEach curated preset has a local editor sample under:\n\n```text\n/voice-samples/<provider>-<preset>.mp3\n```\n\nExamples:\n\n- `/voice-samples/doubao-morgan.mp3`\n- `/voice-samples/doubao-zhixingnv.mp3`\n- `/voice-samples/elevenlabs-peter.mp3`\n- `/voice-samples/elevenlabs-sully.mp3`\n\nPrefer these real samples when rendering a curated voice audition widget before\ncalling `submit_voice`. MiniMax system voices may not ship local samples; offer\nonly cataloged names/tags and confirm the exact ID before `submit_voice`. Never\nderive a sample path for a provider or voice absent from this file.\n",Ne=`---
name: widget-forms
description: Use when the agent should ask the user for structured input with an in-chat form, including single-select, multi-select, text fields, style pickers, or voice audition choices.
---

# Widget Forms

Use the form tool instead of hand-writing markup: the editor chat renders the
form as an interactive card and returns the user's structured answer.

## Runtime Rule

Call \`ask_followup_questions\`. It serializes your fields into the editor's
native form card; the user's submission comes back as their next message.

Plan the whole questionnaire before calling the tool. Send one final form, not a
trial form followed by a corrected form. The tool supports at most 12 fields; if
the user asks for more questions, merge related prompts into combined fields
before the first call.

After calling \`ask_followup_questions\`, stop the turn and wait for the submitted
answer to appear in chat. Do not apply a choice, create assets, or continue
planning from a recommendation until the user's selection is present in the
conversation.

## Supported Field Mapping

Build a \`fields\` array. Write every visible string in the user's conversation
language.

- Native \`<form-single>\` -> \`{ type: "single", variant: "default" }\`
- Native \`<form-multi>\` -> \`{ type: "multi", variant: "default" }\`
- Native \`<form-text>\` / \`<form-textarea>\` -> \`{ type: "text" }\`
- Native \`<form-visual>\` -> \`{ type: "single", variant: "visual" }\`
- Voice audition cards -> \`{ type: "single", variant: "voice" }\`
- Native start-scenario cards -> \`{ type: "single", variant: "scenario" }\`

## Form Copy Tone

For form-level text (\`title\`, \`prompt\`, \`fields[].label\`, \`submitLabel\`, and
\`messagePrefix\`), write like OpenChatCut is a capable video-making partner inviting
the user to describe what they want, not like a rigid survey.

Aim for:

- Warm, open-ended, and action-oriented. The copy should imply "choose the
  closest video need or just tell me your idea; we can figure it out together."
- Short and scannable. Use one natural sentence for \`prompt\` and concise
  question labels.
- Honest capability framing. OpenChatCut can help with many video workflows, but do
  not claim unsupported abilities or guarantee a result before inputs are known.
- The user's language and local product terms. Keep "OpenChatCut", "B-roll",
  "Motion Graphics", "MG 动画", model/product names, and platform names in their
  established forms.
- User-facing creative wording. For early planning or creative-intake forms,
  prefer natural terms such as idea, direction, plan, story, shot list, audience,
  mood, or video need over internal production-document language.

Avoid stiff labels such as "Select video type", "Please choose the video type
for this project", or "What type of video do you want to make?" for scenario
intake unless the host has no room for warmer copy.

For a scenario-intake form, prefer copy like:

\`\`\`json
{
  "title": "What do you want to make?",
  "prompt": "Choose the closest video scenario, or choose Something else and describe your idea.",
  "submitLabel": "Start creating",
  "messagePrefix": "I want to start with this video direction:",
  "fields": [
    {
      "id": "scenario",
      "label": "Which scenario fits your video best?",
      "type": "single",
      "variant": "scenario",
      "otherPlaceholder": "For example: turn my travel footage into an atmospheric vlog / make a launch video for a new product"
    }
  ]
}
\`\`\`

Do not include file-upload questions in forms. If a task actually needs
source media and the project/chat does not already have it, ask the user
separately to upload files in the editor (drag & drop or the upload button, or
paste into the chat composer). File upload is not a default prerequisite for every
questionnaire; only ask for it when the next editing step depends on missing
media.

For choice fields:

- Use \`id\` for the internal value the next tool call needs.
- Use \`label\` for what the user sees.
- For ordinary single-select and multi-select cards (\`variant: "default"\`), keep
  options label-only. Do not add per-option \`description\` unless the user cannot
  distinguish the choices from labels alone.
- Use \`description\` mainly for voice cards. Visual style cards should usually
  use only \`preview\` + \`label\`.
- When an off-list answer is acceptable, add an explicit option with
  \`id: "__other__"\` and a \`label\` in the same language as the rest of the form,
  using the word the user would expect for an off-list answer. The widget will
  turn this option into a text entry when selected. Use \`otherPlaceholder\` if
  the text entry needs a placeholder.

For visual cards:

- Use real image URLs or data image URLs in \`preview\`.
- For Design Style catalog choices, call \`manage_design_style\` with
  \`action: "list"\` first, then map each returned preset to
  \`{ id: preset.presetId, label: preset.name }\` (no thumbnails in this build).
- Never hardcode catalog preset ids unless the user already selected one.

For voice cards:

- Use \`audioUrl\` for the sample file.
- Prefer the documented sample path such as \`/voice-samples/doubao-liuchang.mp3\`
  or a public HTTPS URL. Do not pass localhost sample URLs; MCP host iframes do
  not reliably resolve editor-local media.
- Keep user-visible descriptions provider-neutral. Describe the voice the same
  way the native OpenChatCut audition UI does: gender / age range / tone / use case,
  such as \`Female / young / friendly, general\` or \`男 / 中年 / 低沉知识解说\`.
  Do not show provider names like ElevenLabs or Doubao in option descriptions.
- Keep the option \`id\` equal to the provider voice id needed by \`submit_voice\`.

For native start-scenario cards:

- Use this when the user should choose which OpenChatCut video workflow to start,
  such as talking-head editing, MG animation, long-video-to-shorts,
  product/app promo, AI short film, or explainer video.
- Present these as common video needs/scenarios, not as the only possible video
  workflows. The form must also let the user describe a different video need.
- Use exactly one single-select field with \`variant: "scenario"\`.
- Provide options using the canonical ids below and localized labels in the
  user's language. Include \`id: "__other__"\` only when you need to customize the
  off-list label; otherwise the backend appends a localized Other option.
- English, Chinese, and Spanish scenario labels/descriptions/starter prompts are
  built in. For any other user language, faithfully translate each scenario's
  English \`label\`, \`description\`, and starter prompt into the user's language
  and pass those localized values in the option objects. Preserve OpenChatCut
  product terms and workflow meaning; do not add new requirements. Use
  \`submitPrompt\` for the translated starter prompt. This override is specific to
  \`variant: "scenario"\`; ordinary option cards, voice cards, and visual style
  cards already get their visible text from the values you pass.
- Do not provide custom \`preview\` or \`audioUrl\`; the backend fills the native
  first-screen preview image.
- Canonical ids: \`talking-head\`, \`motion-graphics\`, \`long-video-to-shorts\`,
  \`app-promo\`, \`ai-cinematic-short-film\`, \`explainer\`, plus \`__other__\` for a
  free-form video need.
- Example options:
  \`{ "id": "talking-head", "label": "Talking Head Editing" }\`,
  \`{ "id": "motion-graphics", "label": "Motion Graphics" }\`,
  \`{ "id": "long-video-to-shorts", "label": "Long Video to Shorts" }\`,
  \`{ "id": "app-promo", "label": "Product / App Promo" }\`,
  \`{ "id": "ai-cinematic-short-film", "label": "AI Short Film" }\`,
  \`{ "id": "explainer", "label": "Explainer Video" }\`,
  \`{ "id": "__other__", "label": "Something else" }\`.

## Current Gaps

\`ask_followup_questions\` is for structured answers only. It does not support native
custom HTML, timeline parameter bridges, editor item selection, or file upload
fields. For files already held by the agent runtime or attached directly to the
chat outside this card, the media-import workflow is still valid: call
\`import_media\` and run the helper/direct upload path. For files the user wants
to place directly in a project, ask them to use the OpenChatCut editor upload UI.

## Example

\`\`\`json
{
  "title": "Your video idea",
  "prompt": "Choose or fill in what you have in mind so OpenChatCut can pick a good starting direction.",
  "submitLabel": "Send idea",
  "messagePrefix": "Continue with this video direction:",
  "fields": [
    {
      "id": "goal",
      "label": "What's the main goal of this video?",
      "type": "single",
      "options": [
        { "id": "product_intro", "label": "Product intro" },
        { "id": "social_ad", "label": "Social ad" },
        { "id": "__other__", "label": "Something else" }
      ]
    },
    {
      "id": "elements",
      "label": "What should it include? (Select all that apply)",
      "type": "multi",
      "options": [
        { "id": "broll", "label": "B-roll" },
        { "id": "logo", "label": "Brand logo" },
        { "id": "__other__", "label": "Something else" }
      ]
    }
  ]
}
\`\`\`
`,Pe=/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;function B(e){let t=e.match(Pe);if(!t)return{name:``,description:``,body:e};let[,n,r]=t;return{name:Fe(n),description:Ie(n),body:r}}function Fe(e){let t=e.match(/^name:\s*(.*)$/m);return t?V(t[1].trim()):``}function Ie(e){let t=e.split(/\r?\n/),n=t.findIndex(e=>/^description:/.test(e));if(n<0)return``;let r=t[n].replace(/^description:\s*/,``);if(r.trim()===``||/^[|>][-+]?\s*$/.test(r.trim())){let e=[];for(let r=n+1;r<t.length;r+=1){let n=t[r];if(n.trim()===``){e.push(``);continue}if(!/^\s/.test(n))break;e.push(n.replace(/^\s+/,``))}return e.join(` `).replace(/\s+/g,` `).trim()}return V(r.trim())}function V(e){return e.length>=2&&(e.startsWith(`"`)&&e.endsWith(`"`)||e.startsWith(`'`)&&e.endsWith(`'`))?e.slice(1,-1):e}var H=Object.assign({"./ai-cinematic-short-film/SKILL.md":e,"./ai-cinematic-short-film/references/cinematic-ai-workflow.md":t,"./asset-import/SKILL.md":n,"./batch-montage-variants/SKILL.md":r,"./batch-montage-variants/references/dedup-rules.md":i,"./batch-montage-variants/references/variation-matrix.md":a,"./beat-sync-montage/SKILL.md":o,"./beat-sync-montage/references/beat-density.md":ee,"./beat-sync-montage/references/shot-fitness.md":te,"./create-motion-graphics/SKILL.md":ne,"./create-motion-graphics/references/canvas-pipeline-rules.md":re,"./ecommerce-product-montage/SKILL.md":ie,"./ecommerce-product-montage/references/material-roles.md":ae,"./ecommerce-product-montage/references/proof-placement.md":oe,"./ecommerce-product-montage/references/sales-spine.md":se,"./explainer-video/SKILL.md":ce,"./explainer-video/references/explainer-animation.md":le,"./export/SKILL.md":ue,"./image-gen/SKILL.md":de,"./image-gen/references/fal.md":fe,"./image-gen/references/gpt-image-2.md":pe,"./image-gen/references/grok-imagine.md":me,"./image-gen/references/image-01.md":he,"./image-gen/references/nano-banana.md":s,"./known-errors/SKILL.md":c,"./livestream-to-clips/SKILL.md":l,"./livestream-to-clips/references/multimodal-selection.md":u,"./livestream-to-clips/references/profile-matrix.md":d,"./livestream-to-clips/references/qa-and-evaluation.md":f,"./long-video-to-shorts/SKILL.md":p,"./long-video-to-shorts/references/short-form-selection.md":m,"./motion-graphic-placement/SKILL.md":h,"./multi-clips-to-reels/SKILL.md":g,"./multi-clips-to-reels/references/short-form-selection.md":_,"./music/SKILL.md":v,"./music/references/atlas.md":y,"./music/references/minimax.md":b,"./music/references/mureka.md":x,"./music/references/sonilo.md":S,"./music-intelligence/SKILL.md":C,"./news-rough-cut/SKILL.md":w,"./news-rough-cut/references/deterministic-execution-and-acceptance.md":T,"./openchatcut-plugin-basics/SKILL.md":E,"./product-ad-video-script/SKILL.md":D,"./product-ad-video-script/references/ad-script-framework.md":O,"./product-help/SKILL.md":k,"./product-help/references/generation-capabilities.md":A,"./product-help/references/generation-official-docs.md":j,"./product-help/references/providers-and-keys.md":M,"./product-help/references/ui-and-features.md":N,"./shader-gen/SKILL.md":P,"./shader-gen/examples/cube-rotate.md":F,"./shader-gen/examples/door-open.md":I,"./shader-gen/examples/page-curl.md":L,"./shader-gen/references/design-principles.md":R,"./shader-gen/references/property-changes.md":ge,"./skill-creator/SKILL.md":_e,"./storyboard-shot-breakdown/SKILL.md":ve,"./talking-head-guide/SKILL.md":z,"./transcription/SKILL.md":ye,"./verification/SKILL.md":be,"./video-gen/SKILL.md":xe,"./video-gen/references/fal.md":Se,"./video-gen/references/grok-imagine-video.md":Ce,"./video-gen/references/hailuo.md":we,"./video-gen/references/kling.md":Te,"./video-gen/references/ofox.md":Ee,"./video-gen/references/seedance2.md":De,"./video-thumbnail-generator/SKILL.md":Oe,"./voice/SKILL.md":ke,"./voice/references/minimax-tts.md":Ae,"./voice/references/video-sync.md":je,"./voice/references/voices.md":Me,"./widget-forms/SKILL.md":Ne}),U=e=>e.replace(/^\.\//,``).split(`/`)[0],W=(e,t)=>e.slug<t.slug?-1:+(e.slug>t.slug),G=Object.entries(H).filter(([e])=>e.endsWith(`/SKILL.md`)).map(([e,t])=>{let n=U(e);return{slug:n,files:Object.keys(H).filter(e=>U(e)===n&&!e.endsWith(`/SKILL.md`)).map(e=>e.replace(`./${n}/`,``)).sort(),...B(t)}}).sort(W);function K(e){return G.find(t=>t.slug===e)}function Le(e,t){return t?H[`./${e}/${t.replace(/^\.\//,``)}`]:K(e)?.body}var Re=12e3;function ze(e){return[``,`# Skill library (load_skill on demand · ${e} OpenChatCut SKILL.md files)`,`Each entry below describes when a skill applies. Call load_skill(name=…) before acting. SKILL.md is returned first. Use exactly one selector per call: files=[…] loads omittedFiles whole, or file=… with offset=nextOffset pages one file until nextOffset is null. Never send file and files in the same call. Load only relevant skills.`,`When a skill needs scripts, ffmpeg, node, or python, use run_code in the isolated sandbox: write files, run a command, then read outputs. The sandbox cannot access the timeline; use local editor tools to place resulting assets. For real media, pass a local /media/… or public https:// URL in files so the sandbox can fetch it for ffprobe/ffmpeg. Public URLs may also be passed directly to ffprobe.`,"The custom sandbox image includes ffmpeg. If an environment lacks it, install it first with: `which ffmpeg || (sudo apt-get update -qq && sudo apt-get install -y -qq ffmpeg)`."].join(`
`)}var q=[``,`# Skill library unavailable`,`This model cannot call tools, so load_skill workflows are not available in this request.`].join(`
`),J=e=>`- **${e.slug}** — ${e.description}`;function Be(e,t){return e.length===0?``:[``,`Descriptions omitted to fit the ${t}-character budget. All remain loadable by exact name:`,...e.map(e=>`- ${e.slug}`)].join(`
`)}function Y(e,t,n,r,i){let a=e.reduce((e,t)=>e+J(t).length,0),o=t.reduce((e,t)=>e+J(t).length,0);return{toolsAvailable:r,budgetChars:i,promptChars:n.length,totalSkills:e.length,advertisedSkills:t.length,omittedSkills:e.length-t.length,totalChars:a,advertisedChars:o,omittedChars:a-o}}function X(e,t={}){let n=t.toolsAvailable??!0,r=t.budgetChars??Re;if(!Number.isSafeInteger(r)||r<1)throw RangeError(`Skill index budget must be a positive safe integer.`);let i=[...e].sort(W);if(!n){if(q.length>r)throw RangeError(`Skill index budget cannot fit the tools-unavailable notice.`);return{prompt:q,diagnostics:Y(i,[],q,!1,r)}}for(let e=i.length;e>=0;--e){let t=i.slice(0,e),n=i.slice(e),a=[ze(i.length),...t.map(J),Be(n,r)].filter(Boolean).join(`
`);if(a.length<=r)return{prompt:a,diagnostics:Y(i,t,a,!0,r)}}throw RangeError(`Skill index budget cannot fit the required exact-slug overflow index.`)}var Z=X(G);X(G,{toolsAvailable:!1}),Z.prompt,Z.diagnostics;var Q=[{id:`11111111-1240-4000-8000-000000000015`,slug:`livestream-to-clips`,name:`Livestream to Clips`,nameZh:`直播智能切片`,summary:`把带货、游戏、访谈、教学、娱乐、体育、音乐或混合直播录屏剪成有证据、可发布的高光切片。`,scenarios:[`livestream-to-clips`,`live-highlights`,`stream-clips`,`gaming-highlights`,`commerce-clips`,`直播切片`]},{id:`11111111-1240-4000-8000-000000000004`,slug:`long-video-to-shorts`,name:`Long Video to Shorts`,nameZh:`长视频转短视频`,summary:`把一条长播客、访谈、课程或直播剪成适合社媒发布的短视频和高光。`,scenarios:[`long-video-to-shorts`,`reels`,`tiktok`,`shorts`,`social-clips`,`highlight-reel`]},{id:`11111111-1240-4000-8000-000000000012`,slug:`multi-clips-to-reels`,name:`Multi Clips to Reels`,nameZh:`多素材剪 Reels`,summary:`把产品、活动、旅行或游戏素材剪成适合社媒发布的 Reels。`,scenarios:[`multi-clips-to-reels`,`multi-clips-to-shorts`,`raw-clips`,`reels`,`tiktok`,`shorts`]},{id:`11111111-1240-4000-8000-000000000005`,slug:`ai-cinematic-short-film`,name:`AI Cinematic Short Film`,nameZh:`AI 电影感短片`,summary:`规划并制作 AI 电影感短片，覆盖故事、镜头、提示词、连续性和最终检查。`,scenarios:[`ai-film`,`cinematic`,`seedance`,`story`,`short-film`,`video-generation`]},{id:`11111111-1240-4000-8000-000000000006`,slug:`product-ad-video-script`,name:`Product Ad Video Script`,nameZh:`产品广告脚本`,summary:`把产品或页面转成广告角度、开头钩子、分镜、字幕、CTA 和视觉方向。`,scenarios:[`ad`,`e-commerce`,`landing-page`,`marketing`,`product`,`script`]},{id:`11111111-1240-4000-8000-000000000011`,slug:`explainer-video`,name:`Explainer Video`,nameZh:`解说视频制作`,summary:`把主题、脚本、配音、产品逻辑或数据做成完整解说视频。`,scenarios:[`concept`,`course`,`data`,`education`,`explainer`,`explainer-video`]},{id:`11111111-1240-4000-8000-000000000008`,slug:`motion-graphic-placement`,name:`Motion Graphic Placement`,nameZh:`动效点缀指南`,summary:`在合适时机添加动效，强化表达且不遮挡内容。`,scenarios:[`creator-video`,`interview`,`lecture`,`motion-graphic-placement`,`motion-graphics`,`podcast`]},{id:`11111111-1240-4000-8000-000000000009`,slug:`storyboard-shot-breakdown`,name:`Storyboard Shot Breakdown`,nameZh:`拉片分镜图`,summary:`逐镜拆解镜头语言，并生成分镜参考图。`,scenarios:[`cinematography`,`director-logic`,`film-analysis`,`shot-analysis`,`shot-breakdown`,`storyboard`]},{id:`11111111-1240-4000-8000-000000000010`,slug:`video-thumbnail-generator`,name:`Video Thumbnail Generator`,nameZh:`视频封面生成`,summary:`基于视频内容和真实画面生成适合平台的封面图。`,scenarios:[`bilibili-cover`,`cover-image`,`poster`,`shorts-cover`,`thumbnail`,`video-cover`]},{id:`11111111-1240-4000-8000-000000000014`,slug:`news-rough-cut`,name:`News Rough Cut`,nameZh:`新闻智能粗剪`,summary:`把新闻素材粗剪为一条内容完整、逻辑清晰、节奏紧凑的新闻短视频，不加任何外部声音。`,scenarios:[`news-rough-cut`,`news-cut`,`新闻剪辑`,`粗剪新闻`,`news footage`,`rough-cut-news`]},{id:`11111111-1240-4000-8000-000000000013`,slug:`skill-creator`,name:`Skill Creator`,nameZh:`技能创作器`,summary:`把重复流程或想法做成可复用的自定义技能（SKILL.md），并安装到本机技能目录。`,scenarios:[`create-skill`,`skill-creator`,`make-a-skill`,`new-skill`,`workflow-capture`,`创建技能`,`写技能`,`把流程做成技能`]}].flatMap(e=>{let t=K(e.slug);if(!t)throw Error(`Creative skill metadata references missing SKILL.md: ${e.slug}`);return[{...e,description:t.description,body:t.body,files:t.files,source:`builtin`}]}),$=[];function Ve(e){$=e}function He(){return[...Q,...$]}var Ue=e=>e?Q.find(t=>t.id===e)??$.find(t=>t.id===e):void 0;export{G as a,Ve as i,He as n,Le as o,Ue as r,B as s,Q as t};