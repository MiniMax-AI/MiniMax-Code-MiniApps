// The shape of a picture-to-video request.
//
// A picture becomes a video in three different ways, and each one is a
// different request: the first frame, the first and the last frame, and the
// last frame alone. The mode says which one is asked for, but the frames
// decide what the request really is — a request that names an ending frame it
// does not have is one the provider refuses, so the runtime asks for the
// request it can send.
//
// One rule, two readers: the connector builds the body from it, and the
// prompt writes the alignment line that belongs to it. If the two read the
// rule separately, the line in the prompt and the body in the request drift
// apart, and the model is told one thing while the request says another.

// The paths that carry a frame rather than a reference set.
export const FRAME_PATHS = new Set(['keyframe', 'firstLast', 'lastFrame']);

/**
 * The requests that carry a reference set.
 *
 * The provider takes ONE set: pictures, videos and audios may sit in it
 * together, twelve items in all. The second name is the one the collection
 * used to have when the audio was a mode of its own — an old page may still
 * ask for it, and it is the same request.
 */
export const COLLECTION_PATHS = new Set(['collection', 'collectionAudio']);

/**
 * Whether a reference set is one the provider takes.
 *
 * The provider takes ONE set: pictures, videos and audios may sit in it
 * together. The collection — the one request that is made of references — is
 * never empty, and an audio reference never comes alone: it needs a picture
 * or a video beside it.
 *
 * The rule is judged on the material the request really carries, not on what
 * the request is called, so it cannot be stepped around by naming the
 * request something else.
 *
 * The answer is empty when the set is one the provider takes, and says what
 * is wrong when it is not.
 */
export function referenceSetError(counts = {}, { collection = false } = {}) {
  const pictures = Number(counts.images) || 0;
  const clips = Number(counts.videos) || 0;
  const sounds = Number(counts.audios) || 0;
  if (collection && pictures + clips + sounds === 0) {
    return '参考生视频至少要一样参考素材：一张图、一条视频或一段音频。';
  }
  if (sounds > 0 && pictures + clips === 0) {
    return '音频参考要配一张图或一条视频：provider 只收成组的参考，音频不能单独来。';
  }
  return '';
}

/**
 * The picture on a port.
 *
 * The first frame and the last frame are the two lines on the card, and each
 * one says which port it fills.
 */
export function pickFrame(frames, role) {
  const frame = (frames ?? []).find((item) => item?.role === role && item?.url);
  return frame ? { id: frame.id, url: frame.url } : null;
}

/**
 * What the request really is.
 *
 * `kind` is one of: none, keyframe, firstLast, lastFrame. The frames decide
 * it: a request that has both ends is the first-and-last one, a request that
 * has one end is that end alone.
 */
export function frameRequestShape(path, frames) {
  // A request that is not a frame request carries no frame, whatever is
  // plugged into the card.
  if (!FRAME_PATHS.has(path)) return { kind: 'none', first: null, last: null };
  const first = pickFrame(frames, 'first');
  const last = pickFrame(frames, 'last');
  // The mode says which end it wants, so the other end is not taken.
  const useFirst = first && path !== 'lastFrame' ? first : null;
  const useLast = last && path !== 'keyframe' ? last : null;
  if (useFirst && useLast) return { kind: 'firstLast', first: useFirst, last: useLast };
  if (useFirst) return { kind: 'keyframe', first: useFirst, last: null };
  if (useLast) return { kind: 'lastFrame', first: null, last: useLast };
  return { kind: 'none', first: null, last: null };
}

/**
 * The alignment line that goes with a frame request.
 *
 * MiniMax's own H3 guide says the line is the first line of the final prompt:
 * it tells the model which picture is the first frame and which is the last
 * one. The line names the pictures the way the prompt names them, so the
 * model reads one numbering, not two.
 *
 * `S.SS` is the length of the clip with two decimals, and `N` is the index of
 * the last shot in the prompt.
 */
export function alignmentLine(shape, { labels = {}, lastShot = 1, duration = 0 } = {}) {
  if (!shape || shape.kind === 'none') return '';
  const seconds = Number(duration) > 0 ? Number(duration).toFixed(2) : '0.00';
  const shot = Math.max(1, Number(lastShot) || 1);
  const first = labels[shape.first?.id] ?? '';
  const last = labels[shape.last?.id] ?? '';
  if (shape.kind === 'keyframe') {
    return `For the target video, at 0.00 seconds into the target video, ${first} (from [Shot 1]) is fully referenced.`;
  }
  if (shape.kind === 'firstLast') {
    return 'How the reference pictures align with the target video — '
      + `${first} (from Shot 1) aligns with the 0.00-second mark of the target video; `
      + `${last} (from Shot ${shot}) aligns with the ${seconds}-second mark of the target video.`;
  }
  return `How the reference pictures align with the target video — ${last} (from [Shot ${shot}]) aligns with the ${seconds}-second mark of the target video.`;
}

/**
 * The index of the last shot in a prompt.
 *
 * The guide says the ending picture belongs to the last shot, so the line
 * has to name the shot the clip really ends on. A prompt without shots has
 * one shot.
 */
export function lastShotIndex(text) {
  const source = String(text ?? '');
  let last = 0;
  const shotPattern = /\[Shot\s+(\d+)/g;
  let hit = shotPattern.exec(source);
  while (hit) {
    const index = Number(hit[1]);
    if (Number.isFinite(index) && index > last) last = index;
    hit = shotPattern.exec(source);
  }
  return last || 1;
}
