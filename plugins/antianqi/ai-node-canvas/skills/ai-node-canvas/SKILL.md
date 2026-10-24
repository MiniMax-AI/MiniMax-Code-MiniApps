---
name: ai-node-canvas
description: "Drive the Node Canvas MiniApp — an infinite canvas where every node is one model run and every line is a data path. Use it when the work is a generation chain rather than a single prompt: text to picture to video, a picture worked on again (cut out, sharpen, resize, grid split, ID photo), the same subject from another angle, a clip read back into a prompt, or a set of variants laid out side by side."
---

# Node Canvas

The MiniApp is the canvas, and the Agent reaches it through the `canvas` MCP
server: `canvas_list`, `canvas_read`, `canvas_add_node`, `canvas_connect`,
`canvas_update_node`, `canvas_remove_node`, `canvas_run`.

**What the canvas is.** A node is one model run; a line carries what the
upstream made into the downstream. A run leaves a **result node of its own**
next to the node that ran — never create one by hand, and never wire one that
is not there yet. Results are what the next step works on: cut them out,
sharpen them, split them into a grid, read them back.

## Reach for the prompt node first

A generating node takes the text in its own box, and that text goes to the
model as it is. When the model has a **documented shape** for the task, writing
that shape by hand is where the work is lost.

The **text node in `prompt` mode** (提示词增强) is that shape. It runs one
text turn that rewrites a rough sentence into the shape, and the canvas
offers these:

| Template | Use it for |
| --- | --- |
| 电商主图 | a product hero shot: subject, material, scene and light, framing, quality |
| 短视频分镜 | a shot list: timecode, framing, camera move, action, mood, sound |
| 人物写真 | a portrait: looks, clothing, pose, light, background, lens |
| 产品质感 | a product detail shot: material, structure, use case, light, macro, background |
| 社媒封面 | a social cover: headline, subject, palette, whitespace, platform size |
| **H3 T2VA / I2VA / FL2VA / L2VA / 全参考六段** | **any MiniMax H3 video request** |

The H3 ones are the provider's own prompt-writing guides. They carry the
three-part shape H3 reads best — `integrated_multimodal_description` (the
picture timeline), `overall_soundscape`, `non_diegetic_music` — and the
conventions that go with it: `[Shot N] At MM:SS.mmm` for cuts, camera moves
as "type + amplitude + speed" in a plain sentence, speakers as `(S1)`, speech
as `<d>[language] line</d>`, cross-cuts as `<scenetrans>`. The structure is
English, the dialogue stays in its own language.

**What the prompt node saves.** The alignment line that names the reference
picture and the timestamp is written by the runtime, not by the prompt — but
only if the rest of the prompt is in the shape it expects. Hand-writing an H3
prompt loses the structure, the shot notation and the sound layers; the
result is a clip that reads flat. The prompt node costs one text turn and
returns a prompt the video model understands.

**How to pick one.** `canvas_add_node` and `canvas_update_node` both take a
`templateId`, and the text of that template comes with it: `ecommerce-main`,
`short-video`, `portrait`, `product-texture`, `social-cover`, `h3-t2va`,
`h3-i2va`, `h3-fl2va`, `h3-l2va`, `h3-reference`, `custom`. A `templateText`
of your own replaces the text of the named template. A prompt node that names
none takes the first template, so it is useful before anything is typed.

**One thing the prompt node must not do.** It never writes the alignment
line and never invents the reference numbers. Those belong to the runtime.

## References are numbered by the request

A line into a generating node becomes a reference in the request, and the
runtime numbers them: `@图片1`, `@图片2`, `@视频1`, `@音频1` — the same
numbers it puts in the reference blocks of the prompt. Write `@图片1` in the
prompt to mean the first reference. The number follows the **request**, not
the card title and not the position on the board: a node with two pictures
upstream is `@图片1` and `@图片2`, and which is which is decided by the
request, not by you.

The prompt node in `prompt` mode has a template dropdown and a template box
next to it, so the user can change it by hand. The Agent changes it the same
way, through the same rule.

## Chains that are worth building

- **Text → picture → video.** Text node (or prompt node) → image node →
  video node. The picture is the video's first frame, and the reference
  number it gets is the one the alignment line names.
- **Work a picture on again.** Result node → a tool on that card (cut out,
  sharpen, resize, grid split, ID photo, another angle, another light). The
  tool leaves a result node, so the chain keeps going.
- **The same subject, another angle.** The 多角度 tool asks the model for
  the same subject from another camera position and keeps the material and
  the colours.
- **A grid.** 宫格切分 cuts one picture into N×M pieces, each its own node.
- **A clip read back.** A video into a text node in `video2text` mode: the
  provider reads the clip shot by shot and the text model writes the prompt
  that would produce it.

## Running it

`canvas_run` starts the run and returns as soon as the page has taken it —
the picture is not finished yet. Read the result node later with
`canvas_read`; the node's status is the truth (`success`, `error`, or
still running).

**One slow call at a time.** Pictures, speech, music and video submits queue
behind each other, because the machine can only give one of them the window
they need. Two runs asked for at once will not both be fast, and the second
one says in the log how long it waited. A run that was refused for the
window came back with "结果未知" — the call may have reached the provider
and may have been charged. Do not retry that one by itself.

**The page is the only writer.** When the page holds the canvas, a change is
handed to it and applied there; when nobody is looking, the runtime applies
it. The canvas the Agent reads is the canvas the user sees.

**`canvas_remove_node` cannot be undone.** It takes the lines with it. Do not
use it to "tidy up" a canvas the user is working on.

## What the models allow

Parameters follow the model that is selected: a duration a model does not
offer is not in the menu, and a request that breaks one of the provider's
rules (an audio reference with nothing else, more than nine pictures or
twelve references in all) is refused before it is sent, with the reason.

Video with a sound track needs MiniMax **H3**, and H3 is billed from account
credits — if the account has credit auto-consumption turned off, the
provider refuses the request. Hailuo runs on the Token Plan but is silent.

## Starting

The user opens the canvas by name ("打开节点画布" / "open the node canvas"),
or the Agent opens it for them. Read the board with `canvas_list` and
`canvas_read` before changing anything, and tell the user what the board
already holds instead of building a second copy of it.
