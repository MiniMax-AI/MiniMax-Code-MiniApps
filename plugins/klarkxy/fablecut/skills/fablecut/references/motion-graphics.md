# Motion graphics with FableCut

Adapted from the FableCut project by ronak-create (MIT License, Copyright (c) 2026 ronak-create).
Keep that notice with any copy of this text.

Motion graphics in FableCut are ordinary clips on the timeline, so everything you know about clips
still applies - tracks, keyframes, transitions, masks, blend. Three pieces do the work:

- **Shape layer** - a clip with `kind:"shape"` that draws vector items from `props.shapes`. It
  stays sharp at any scale and needs no media.
- **Null** - a clip with `kind:"null"` that never renders. It exists to be a parent.
- **Parent** - `parent:"<clip id>"` makes a clip move, turn and scale with another one. Every
  visual clip also has an **anchor point** (`anchorX`, `anchorY`) that it turns and scales around.

## Coordinates

Get these right first:

- A clip's `x` / `y` are px from the **canvas centre**. With a parent they are px from the
  **parent's centre**, in the parent's turned and scaled space.
- A shape item's `x` / `y` are px from the **layer's origin** (the layer clip's `x` / `y`). Path
  and line `points` are px around the item's own `x` / `y`.
- `rotation` is in degrees, clockwise, and y points down.
- An item's `keys[].t` and a clip's `keyframes[].t` are seconds from the **clip's start**, not from
  the timeline.

## Building one

1. `fablecut_get_project {compact:true}` to see the tracks and what is free. Shapes usually go on
   `V2` or `V3`, above the footage.
2. Add the layer with its items in one `addClip`, or add an empty layer and set items into it with
   `setShape`. Name every item you will touch again (`name:"Bar"`), so later edits say
   `shape:"Bar"` and not an index.
3. Animate the items with `keys`, and the whole layer with the clip's `keyframes` (`x`, `y`,
   `scale`, `rotation`, `opacity`, `trimEnd`, and so on).
4. Group what moves as one: put shapes in a `group` item inside a layer, or parent whole clips -
   titles, images, other layers - to a null with `setParent`.
5. Check it: the compact view shows each layer as `[3 shapes: rect #ffd166 2 keys, ...]` and each
   child as `parent:c_...`.

```text
fablecut_patch_project {ops:[
  {op:"addClip", clip:{id:"c_lt", kind:"shape", track:"V2", start:1, duration:5,
    props:{x:-330, y:230, shapes:[
      {type:"rect", name:"Bar", x:0, w:560, h:96, radius:10, fill:"#111827e6",
        keys:[{t:0, w:0}, {t:0.5, w:560, ease:"ease-out"}]},
      {type:"rect", name:"Accent", x:-276, w:8, h:96, fill:"#ffd166"},
      {type:"line", name:"Rule", y:64, points:[[-280,0],[280,0]], stroke:"#ffd166", strokeWidth:4,
        keys:[{t:0.3, trimEnd:0}, {t:1, trimEnd:100, ease:"ease-out"}]}]},
    transitionOut:{type:"fade", duration:0.4}}},
  {op:"addClip", clip:{id:"c_name", kind:"text", track:"V3", start:1.2, duration:4.8,
    props:{text:"Your Name", font:"Archivo Black", fontSize:44, align:"left", x:-560, y:-8, textAnim:"rise-mask"}}},
  {op:"setParent", id:"c_name", parent:"c_lt"}
]}
```

`setParent` keeps the title where it is on screen and rewrites its `x` / `y` into the layer's
space. After that, keyframing the layer's `x` slides both of them out together.

## The shape op

`setShape {id | ids, shape?, set:{...}, replace?, remove?}` - `shape` is an index, a name, or a
path into a group such as `"2.0"` for item 0 of group 2. Leaving it out, or giving an unknown name
or an index equal to the current length, adds an item; a new item needs a `type`.

Set keys: `type` (`rect`, `ellipse`, `polygon`, `star`, `line`, `path`, `group`), `name`, `on`,
`x`, `y`, `rotation`, `scale`, `opacity`, `w`, `h`, `radius` (rect corners), `sides`, `inner`
(star, 0.05 to 1), `points` (`[[x,y,inX?,inY?,outX?,outY?], ...]`; a line has exactly 2 points, a
path 2 to 128, around the item's `x` / `y`), `closed` (path), `fill`, `stroke` (`#rrggbb`,
`#rrggbbaa` or `none`), `strokeWidth`, `lineCap`, `lineJoin`, `dash`, `trimStart`, `trimEnd`
(0 to 100, a draw-on), `trimOffset`, `items` (group), and `keys` (`[{t, ease?, ...}]` over x, y,
rotation, scale, opacity, w, h, radius, inner, strokeWidth, trimStart, trimEnd, trimOffset, fill,
stroke, points).

`removeShape {id, shape}` removes one.

## Timing that looks designed

- Entrances take 0.3 to 0.6 s with `ease:"ease-out"` on the arriving key. Exits are faster, 0.2 to
  0.4 s, with `ease-in`. Use `linear` only for things that keep turning or running - a spinner, a
  ticker, a `trimOffset` loop.
- Stagger related items by 0.08 to 0.15 s so they settle one after another instead of all at once.
- Overshoot comes from three keys, not from an ease: `scale` 0, then 1.12, then 1, over about
  0.35 s.
- Hold a finished graphic for at least two seconds before it leaves.
- Use two or three colours: one strong accent, one neutral (`#111827`, `#ffffff`), and a
  translucent backing (`#rrggbbaa`, such as `#000000a0`).

## Recipes

- **Draw-on logo or icon** - `path` items with `stroke` and `fill:"none"`, each with
  `keys:[{t:a, trimEnd:0}, {t:a+0.8, trimEnd:100}]`, staggered. Then fade the fill in with
  `keys:[{t:1.2, fill:"#ffffff00"}, {t:1.6, fill:"#ffffff"}]`. The `fill` must be keyed in the
  same item as the draw-on.
- **Whole-layer draw-on** - key the clip's own `trimEnd` from 0 to 100 in its `keyframes`. It trims
  every path in the layer at once.
- **Loading ring** - an `ellipse` with `w` and `h`, `fill:"none"`, a `stroke`, `strokeWidth`, and
  `trimEnd:25`, with `keys:[{t:0, trimOffset:0}, {t:1, trimOffset:100, ease:"linear"}]`. For more
  turns, add more keys - `trimOffset` 200 at t 2, and so on.
- **Progress bar** - a backing `rect` and a fill `rect` with
  `keys:[{t:0, w:0, x:-200}, {t:3, w:400, x:0, ease:"linear"}]`. Key `x` together with `w` so the
  bar grows from its left edge.
- **Orbit** - a null at the centre with `rotation` keyed from 0 to 360 (`linear`), and a shape or
  image parented to it at `x:300`. A second null parented to the first gives a moon.
- **Swing or hinge** - put the anchor on the edge it should hang from (`anchorY: -h/2` for the top
  edge), then key `rotation` between -8 and 8.
- **Pop-in sticker** - a `star` or `ellipse` with
  `keys:[{t:0, scale:0}, {t:0.25, scale:1.15}, {t:0.4, scale:1}]` and `rotation` from -15 to 0.
- **Callout** - an open `path` (`closed:false`) from the subject to a label, drawn on with
  `trimEnd`, plus a small `ellipse` at its start.
- **Burst** - a `group` of six `line` items with `rotation` 0, 60, 120 and so on, and
  `points:[[40,0],[90,0]]`. Key the group's `scale` from 0.4 to 1.2 and its `opacity` from 1 to 0
  over half a second.

## Curves, blur and text on a path

- **Curved moves** - key `x` and `y` together at two or more times, then call
  `{op:"setMotionPath", id, path:"smooth"}`. For a precise arc, write the handles yourself: `pout`
  on the leaving key and `pin` on the arriving key, on both the x and y keys, in px from the key's
  position. A fly-in that arches up: x `{t:0, v:-500, pout:200}` then `{t:1, v:0, pin:-200}`, y
  `{t:0, v:200, pout:-250}` then `{t:1, v:0, pin:0}`.
- **Auto-orient** - `autoOrient:true`, or `setMotionPath` with `autoOrient:true`, makes arrows,
  planes and cars point where they go. Draw them pointing right, 0 degrees, the direction of
  travel.
- **Motion blur** - `motionBlur` is a shutter angle from 0 to 720 (180 is a film look) and
  `motionBlurSamples` runs from 2 to 32. Use it on anything that moves fast - whips, fly-ins,
  spinning logos. Leave it off on slow drifts, where it only costs render time.
- **Text on a path** - `{op:"setTextPath", id, path:"circle"}`, or `"arc"`, `"wave"`, `"line"`, or a
  shape item's geometry. Key `pathOffset` from 0 to 100 with `ease:"linear"` to send text around a
  ring. Add a trailing separator so the ends do not touch, and size the path to the text: a
  circle's circumference should be a little longer than the text. `pathAlign:"center"` with
  `pathOffset:50` centres a title on an arc. Later lines follow on parallel curves one line-height
  below. Every `textAnim` works on a path.

## Compositions

A **comp** is a timeline of its own; a `kind:"comp"` clip places it, drawn like one picture of the
comp's size. Use one when the same graphic appears more than once, or when several clips should
move, fade, mask or grade as a unit.

```text
fablecut_patch_project {ops:[
  {op:"addComp", comp:{id:"sting", name:"Logo sting", duration:2.5, clips:[
    {id:"ring", kind:"shape", track:"V1", start:0, duration:2.5, props:{shapes:[
      {type:"ellipse", w:220, h:220, fill:"none", stroke:"#ffd166", strokeWidth:10,
       keys:[{t:0, trimEnd:0}, {t:0.8, trimEnd:100, ease:"ease-out"}]}]}},
    {id:"word", kind:"text", track:"V2", start:0.5, duration:2, props:{text:"FC", font:"Anton", fontSize:96, textAnim:"zoom-in"}}]}},
  {op:"addClip", clip:{kind:"comp", compId:"sting", track:"V3", start:0, duration:2.5}},
  {op:"addClip", clip:{kind:"comp", compId:"sting", track:"V3", start:58, duration:2.5, props:{scale:0.6, x:480, y:260}}}
]}
```

- Edit what is inside with `{op:"inComp", comp:"sting", ops:[...]}` - the same clip ops, with the
  comp's own times. Every placement updates.
- `{op:"precompose", ids:[...]}` turns clips you already built into a comp and leaves one comp clip
  in their place; then animate, mask or fade that clip as a whole. This is the fix for "parenting
  does not pass opacity".
- A comp clip's `in` is where in the comp it starts. A comp clip shows nothing past the comp's
  `duration`, so lengthen the comp with `updateComp` before stretching the clip.
- The comp's frame is its `width` times `height`, transparent unless it has a `background`. Give a
  graphic's comp the canvas size so `x` / `y` inside it read the same as on the timeline.
- Sound inside a comp plays through the main timeline's track of the same name, so a whoosh in a
  sting follows the fader it is on.

## Presets and templates

Reach for these before keying by hand.

```text
fablecut_patch_project {ops:[
  {op:"addTemplate", template:"lower-third-bar", id:"c_lt_1", track:"V3", start:4,
    fields:{name:"A Name", title:"A Role", accent:"#22d3ee"}},
  {op:"addTemplate", template:"logo-ring", track:"V3", start:0, fields:{logo:"m_logo", brand:"BRAND"}},
  {op:"applyPreset", ids:["c_title1", "c_title2"], preset:"rise-blur"},
  {op:"applyPreset", ids:["c_title1", "c_title2"], preset:"fade-out"},
  {op:"applyPreset", id:"c_badge", preset:"pulse", at:12.5}
]}
```

**Templates** - `addTemplate {template, start?, track?, duration?, fields?, id?, compId?, name?}`:

- lower thirds: `lower-third-bar`, `lower-third-underline`, `lower-third-boxes` - fields `name`,
  `title`, `accent`.
- logos: `logo-ring`, `logo-slam`, `logo-lines` - field `logo` takes a media id, so import the
  logo first; fields `brand`, `tagline`, `accent`.
- social: `social-story` (1080x1920), `social-quote` (1080x1080), `social-end-card` - text fields,
  `accent`, `background`.

Each placement is its own comp, so one per speaker is right. Change it later with
`{op:"setTemplate", id, fields:{...}, duration:7}`; a longer template holds longer and keeps its
exit. For a vertical template, set the canvas to its size first with
`setProject {width:1080, height:1920}`, or it sits letterboxed in a 16:9 frame.

**Presets** - `applyPreset {id | ids, preset, length?, at?}` keys a named animation onto visual
clips, relative to where they sit:

- in: `fade-in`, `pop-in`, `slide-up-in`, `slide-down-in`, `slide-left-in`, `slide-right-in`,
  `drop-in`, `zoom-in`, `spin-in`, `whip-in`, `rise-blur`, `draw-on`
- out: `fade-out`, `pop-out`, `slide-up-out`, `slide-down-out`, `slide-left-out`,
  `slide-right-out`, `zoom-out`, `spin-out`, `whip-out`, `sink-blur`, `draw-off`
- at, an emphasis at a moment: `pulse`, `shake`, `wobble`, `bounce`, `flash`
- loop, the whole clip: `float`, `breathe`, `sway`, `spin`, `wiggle`

`length` stretches one. An inline preset is `{anchor:'in'|'out'|'at'|'whole', length, keys:{channel:[{t,v,ease?}]}}`,
where `scale` and `opacity` multiply and the rest add.

Put the clip where it should rest first, then apply the preset. Use one family of entrances
across an edit rather than a different preset on every clip. Save what the user likes with
`savePreset {id, name, anchor?}` from a clip they animated, and `saveTemplate {comp, name?,
fields?}` from a comp they built; both go to the library and work in every project.

## Traps

- Shape and null clips have no media entry. Do not register media for them.
- `keys` in `setShape` replaces that item's whole key list, so send all of them. `points` keys must
  have the same number of points as the path.
- A stroke with `strokeWidth:0` is invisible. Setting `stroke` without a width gives 6 px, and 8 px
  on lines and open paths.
- A trimmed closed shape fills only the part that is drawn. For a clean outline draw-on, use
  `fill:"none"` and fade the fill in afterwards.
- Parenting carries only the transform. Opacity, transitions, shake and effects do not pass to the
  children, so fade each child with its own `transitionOut`, or put everything in one shape layer's
  groups.
- Rotate or scale around a corner by moving the anchor, not by adjusting `x` / `y` keys in every
  frame.
- Parent loops are refused, and so are parents that are audio or adjustment clips.
- A comp cannot contain itself, directly or through another comp, and `removeComp` is refused while
  a clip still uses it. Comps nest four deep.
- `props.blend` accepts `normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`,
  `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`, `hue`,
  `saturation`, `color`, `luminosity` and `lighter`.
