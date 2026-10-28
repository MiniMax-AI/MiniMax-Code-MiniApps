# Motion graphics with Cutline

Adapted from the FableCut project by ronak-create (MIT License, Copyright (c) 2026 ronak-create).
Keep that notice with any copy of this text.

The item properties, the op names, the preset lists and the worked recipes live in the runtime
manual, [CLAUDE.md](../../../miniapp/node/vendor/fablecut/CLAUDE.md), which `fablecut_docs` serves
section by section. Read the section you need before you build a call. This guide covers how to
design and place a graphic.

## The three pieces

- **Shape layer** - a clip that draws vector items, so it stays sharp at any scale and runs without
  media.
- **Null** - a clip that stays invisible on screen. It exists to be a parent.
- **Parent** - a clip can move, turn and scale with another one. Every visual clip also has an
  anchor point that it turns and scales around.

Everything you know about clips still applies to these: tracks, keyframes, transitions, masks and
blend.

## Get the coordinates right first

- A clip's position is measured from the canvas centre; with a parent it is measured from the
  parent's centre, in the parent's turned and scaled space. A shape item's position is measured
  from its layer's origin, and its points from its own position.
- Rotation is in degrees and clockwise, and y points down.
- Keyframe times run from the clip's start, so a layer's animation travels with the layer wherever
  it sits on the timeline.

## Build one

1. Read the compact project and see which tracks are free. Shapes usually belong on `V2` or `V3`,
   above the footage.
2. Add the layer with its items, and name every item you will touch again, so a later edit can
   address it by name.
3. Animate the items with their own keys, and the whole layer with the clip's keyframes.
4. Group what moves as one: shapes in a group item, or whole clips - titles, images, other layers -
   parented to a null.
5. Check the compact project: it shows each layer's items and each child's parent.

The manual's shapes section carries the worked recipes - draw-ons, a loading ring, a progress bar,
an orbit, a swing - with the properties each one needs.

## Timing that looks designed

- Entrances run 0.3 to 0.6 s and ease out; exits are faster and ease in. Reserve linear motion for
  things that keep turning or running.
- Stagger related items so they settle one after another.
- Overshoot comes from three keys - a scale slightly past its target and back - rather than from a
  stronger ease.
- Hold a finished graphic for a couple of seconds before it leaves.
- Two or three colours are enough: one accent, one neutral, one translucent backing.

## Comps, presets and templates

- A **comp** is a timeline of its own, placed as one picture. Use one when the same graphic appears
  more than once, or when several clips should move, fade, mask or grade as a unit. Turning clips
  you already built into a comp lets you animate them as a whole.
- **Templates** place a finished design - a lower third, a logo, a social card - with fields you
  fill in. Each placement is its own comp, so one per speaker is right.
- **Presets** key a named animation onto a clip. Put the clip where it should rest first, then
  apply the preset, and use one family of entrances across an edit rather than a different preset
  on every clip.
- The editor's library holds the templates and presets, and you can save what the user liked so it
  is available in every project.

## Cautions

- Shape and null clips carry no media entry, so leave them out of the media bin.
- Parenting carries the transform only. Opacity, transitions and effects stay with each child, so
  fade every child or put the whole graphic in one layer. Rotate or scale around a corner by moving
  the anchor.
- A stroke needs a width to be visible, and a trimmed closed shape fills only the part that is
  drawn.
- Parent loops are refused, a comp cannot contain itself, and comps nest a few levels deep.
