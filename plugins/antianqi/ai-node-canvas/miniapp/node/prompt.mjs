// Prompt compilation for the AI Node Canvas MiniApp.
//
// The canvas keeps a structured prompt: a list of text segments and mention
// segments. A mention segment points at another node's produced asset.
//
// The wire format follows the reference implementation: a mention is encoded as
// `[[cw:kind:nodeId]]` and compiled per provider family into that provider's
// own reference syntax, while the asset URLs are collected into separate
// arrays and handed to the model alongside the text.
//
//   kling       <<<image_1>>>
//   minimax     @图片1 / @视频1 / @音频1
//   wanxiang   @图片1 / @视频1 / @音频1
//   bytedance   @Image1 / @Video1 / @Audio1
//
// A mention whose asset is gone is not silently dropped: it is replaced with
// the provider's "missing" marker so the model can be told the asset is gone.
//
// A mention whose asset exists but is not carried by this request is a
// different thing: the model would never see it. That one is reported, not
// quietly turned into a number that points nowhere.

import { FRAME_PATHS, frameRequestShape } from './video-request.mjs';

const MENTION_TOKEN_RE = /\[\[cw:([a-z]+):([A-Za-z0-9_-]+)\]\]/g;

export function mentionToken(kind, nodeId) {
  return `[[cw:${kind}:${nodeId}]]`;
}

export function providerFamily(model) {
  const text = String(model ?? '').trim().toLowerCase();
  if (text.includes('kling')) return 'kling';
  if (text.includes('minimax') || text.includes('hailuo')) return 'minimax';
  if (text.includes('wan')) return 'wanxiang';
  return 'bytedance';
}

function referenceSyntax(provider, kind, index) {
  if (provider === 'kling') return `<<<${kind}_${index}>>>`;
  if (provider === 'minimax' || provider === 'wanxiang') {
    return { image: `@图片${index}`, video: `@视频${index}`, audio: `@音频${index}` }[kind];
  }
  return { image: `@Image${index}`, video: `@Video${index}`, audio: `@Audio${index}` }[kind];
}

function missingSyntax(provider, kind) {
  if (provider === 'kling') return `<<<${kind}_?>>>`;
  if (provider === 'minimax' || provider === 'wanxiang') {
    return { image: '@图片?', video: '@视频?', audio: '@音频?' }[kind];
  }
  return { image: '@Image?', video: '@Video?', audio: '@Audio?' }[kind];
}

/**
 * The pattern a reference number is written in.
 *
 * The number in the prompt has to mean the same thing as the number in the
 * request, so the pattern is built from the same syntax the label is.
 */
export function referencePattern(provider, kind) {
  const sample = referenceSyntax(provider, kind, 1);
  if (!sample) return null;
  return new RegExp(`${sample.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/1$/, '(\\d+)')}`, 'g');
}

// Turn the structured segments into the tokenised prompt plus an asset index.
export function tokenize(segments) {
  let out = '';
  for (const segment of segments ?? []) {
    if (!segment) continue;
    if (segment.type === 'text') out += segment.text ?? '';
    else if (segment.type === 'mention') out += mentionToken(segment.kind ?? 'image', segment.nodeId);
  }
  return out;
}

// The kind a piece of material is counted as.
function kindOfMaterial(kind) {
  return kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : 'image';
}

/**
 * The materials one request carries, in the order the provider sees them.
 *
 * The number a material gets in the prompt is its place in this list, so the
 * prompt and the request always mean the same picture. A frame request
 * carries the frames and nothing else; a reference request carries what the
 * prompt names, and when the prompt names nothing it carries what is above.
 */
export function referenceSlots({ path = '', frames = [], segments = [], references = [] }) {
  const upstream = { image: [], video: [], audio: [] };
  for (const ref of references ?? []) {
    for (const item of ref.media ?? []) {
      const url = String(item?.url ?? '').trim();
      if (!url) continue;
      const kind = kindOfMaterial(item.kind);
      // One node is one material: a node with two files is not two numbers.
      if (upstream[kind].some((entry) => entry.nodeId === ref.id)) continue;
      upstream[kind].push({ nodeId: ref.id, url });
    }
  }
  // What the prompt names, in the order it names it.
  const named = { image: [], video: [], audio: [] };
  for (const segment of segments ?? []) {
    if (segment?.type !== 'mention') continue;
    const kind = kindOfMaterial(segment.kind);
    const nodeId = segment.nodeId;
    if (!nodeId) continue;
    if (named[kind].some((entry) => entry.nodeId === nodeId)) continue;
    const hit = upstream[kind].find((entry) => entry.nodeId === nodeId);
    if (hit) named[kind].push(hit);
  }
  // A frame request carries the frames, and nothing else.
  if (FRAME_PATHS.has(path)) {
    const shape = frameRequestShape(path, frames);
    const images = [];
    if (shape.first) images.push({ nodeId: shape.first.id, url: shape.first.url });
    if (shape.last) images.push({ nodeId: shape.last.id, url: shape.last.url });
    return { image: images, video: [], audio: [] };
  }
  return {
    image: named.image.length ? named.image : upstream.image,
    video: named.video.length ? named.video : upstream.video,
    audio: named.audio.length ? named.audio : upstream.audio,
  };
}

// Compile the tokenised prompt for a specific provider family.
//
// `mentionMap` maps nodeId -> { kind, url, label }.
// `slots` says what this request carries, in the provider's order: the
// numbering in the prompt is the place a material has in that list.
export function compilePrompt(tokenisedPrompt, mentionMap, mode, family, slots = null) {
  const provider = family ?? providerFamily(family);
  const lists = slots ?? { image: [], video: [], audio: [] };
  const labels = {};
  const unsent = [];
  let hasMentions = false;

  const labelFor = (kind, index) => referenceSyntax(provider, kind, index) ?? '';
  const slotOf = (kind, nodeId) => {
    const list = lists[kind] ?? [];
    return list.findIndex((slot) => slot?.nodeId === nodeId);
  };

  // Every material this request carries gets its number, whether the prompt
  // names it or not: the number is the place the material has in the request.
  for (const kind of ['image', 'video', 'audio']) {
    (lists[kind] ?? []).forEach((slot, index) => {
      if (slot?.nodeId && !labels[slot.nodeId]) labels[slot.nodeId] = labelFor(kind, index + 1);
    });
  }

  const promptForApi = String(tokenisedPrompt ?? '').replace(
    MENTION_TOKEN_RE,
    (match, kind, nodeId) => {
      hasMentions = true;
      const asset = mentionMap?.[nodeId];
      // Text is not a numbered reference: it goes into the prompt as it is.
      if (kind === 'text') {
        return asset?.text || asset?.label || match;
      }
      if (!asset || asset.kind !== kind) {
        return missingSyntax(provider, kind) ?? match;
      }
      if (!asset.url) {
        return missingSyntax(provider, kind) ?? asset.label ?? match;
      }
      const index = slotOf(kindOfMaterial(kind), nodeId);
      if (index < 0) {
        // The material is there, but this request does not carry it. A number
        // here would point at a picture the model never sees, so the caller
        // is told instead.
        if (!unsent.some((item) => item.nodeId === nodeId)) {
          unsent.push({ kind, nodeId, title: asset.label });
        }
        return missingSyntax(provider, kind) ?? match;
      }
      return labelFor(kindOfMaterial(kind), index + 1);
    },
  );

  return {
    promptForApi,
    imageUrls: (lists.image ?? []).map((slot) => slot.url),
    videoUrls: (lists.video ?? []).map((slot) => slot.url),
    audioUrls: (lists.audio ?? []).map((slot) => slot.url),
    hasMentions,
    provider,
    // Which label the prompt gives each material, by the node it came from.
    labels,
    // Materials the prompt names that this request does not carry.
    unsent,
  };
}

// Build the mention map from the upstream references the page sent.
//
// Only material is mentioned: a picture, a video or an audio file gets a
// number in the provider's syntax. Text is prompt material, not a reference,
// so it keeps its kind and its words.
export function buildMentionMap(references) {
  const map = {};
  for (const ref of references ?? []) {
    if (!ref?.id) continue;
    const media = Array.isArray(ref.media) ? ref.media : [];
    const first = media[0];
    const kind = first?.kind ?? (ref.kind === 'text' ? 'text' : ref.kind ?? 'image');
    map[ref.id] = {
      kind: ['image', 'video', 'audio', 'text'].includes(kind) ? kind : 'image',
      url: first?.url ?? '',
      text: String(ref.text ?? '').trim(),
      label: ref.title ?? ref.id,
      nodeId: ref.id,
    };
  }
  return map;
}
