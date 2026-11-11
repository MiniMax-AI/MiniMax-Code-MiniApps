/**
 * The strip: the material itself, drawn as a band.
 *
 * A clip is chosen on the thing that is about to be cut, so the strip is the
 * material: a video is a row of frames taken from the file, an audio is its
 * waveform. The range that is kept is picked out of it from above.
 */

/**
 * Where the frames of a filmstrip are taken from.
 *
 * The frames spread over the whole material, the first one at the head and
 * the last one at the tail, so the strip shows the material in order.
 */
export function frameStops(count = 8, durationSec = 0) {
  const frames = Math.max(1, Math.floor(Number(count) || 0));
  const total = Math.max(0, Number(durationSec) || 0);
  if (frames <= 1 || total <= 0) return [0];
  return Array.from({ length: frames }, (_, index) => (total * index) / (frames - 1));
}

/**
 * The peaks of a waveform: the loudest sample of every slice of the sound.
 *
 * The sound is far longer than the strip is wide, so it is cut into slices
 * and each slice keeps its loudest moment. That is what the eye reads.
 */
export function waveformPeaks(samples, buckets = 120) {
  const data = samples ?? [];
  const count = Math.max(1, Math.floor(Number(buckets) || 0));
  const total = data.length;
  if (!total) return new Array(count).fill(0);
  const size = total / count;
  const peaks = [];
  for (let index = 0; index < count; index += 1) {
    const from = Math.floor(index * size);
    const to = Math.min(total, Math.max(from + 1, Math.floor((index + 1) * size)));
    let peak = 0;
    for (let at = from; at < to; at += 1) {
      const value = Math.abs(Number(data[at]) || 0);
      if (value > peak) peak = value;
    }
    peaks.push(peak);
  }
  return peaks;
}

const waitFor = (target, event) => new Promise((resolve, reject) => {
  const done = () => {
    target.removeEventListener(event, done);
    target.removeEventListener('error', failed);
    resolve();
  };
  const failed = () => {
    target.removeEventListener(event, done);
    target.removeEventListener('error', failed);
    reject(new Error('media'));
  };
  target.addEventListener(event, done);
  target.addEventListener('error', failed);
});

const tone = (node, name, fallback) => {
  const value = getComputedStyle(node).getPropertyValue(name).trim();
  return value || fallback;
};

/**
 * Draw the frames of a video into the strip.
 *
 * Every frame fills its cell the way a thumbnail does: cropped, not
 * squashed, so the strip has the shape of the material.
 */
export async function paintFilmstrip(canvas, url, stops) {
  // The strip remembers how to draw itself, so the theme can ask for it
  // again with the colours it has now.
  remember(canvas, () => paintFilmstrip(canvas, url, stops));
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await waitFor(video, 'loadedmetadata');
  } catch {
    return false;
  }
  const width = canvas.clientWidth || 520;
  const height = canvas.clientHeight || 56;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.scale(scale, scale);
  ctx.fillStyle = tone(canvas, '--mcode-bg-secondary', '#111');
  ctx.fillRect(0, 0, width, height);
  const cell = width / Math.max(1, stops.length);
  const source = {
    w: video.videoWidth || video.width || 1,
    h: video.videoHeight || video.height || 1,
  };
  const last = Math.max(0, (video.duration || 0) - 0.05);
  for (let index = 0; index < stops.length; index += 1) {
    try {
      video.currentTime = Math.min(stops[index], last);
      await waitFor(video, 'seeked');
    } catch {
      continue;
    }
    // The frame fills its cell: it is cropped the way a thumbnail is.
    const wanted = cell / height;
    const have = source.w / source.h;
    let sw = source.w;
    let sh = source.h;
    let sx = 0;
    let sy = 0;
    if (have > wanted) {
      sw = source.h * wanted;
      sx = (source.w - sw) / 2;
    } else {
      sh = source.w / wanted;
      sy = (source.h - sh) / 2;
    }
    ctx.drawImage(video, sx, sy, sw, sh, index * cell, 0, cell, height);
  }
  return true;
}

/**
 * The peaks of a sound, kept per file.
 *
 * A card is drawn again whenever the canvas changes, and a file is decoded
 * only once: the peaks are kept, so the second drawing of the same sound is
 * a redraw and not a decode. A file that could not be read is not kept, so
 * it is tried again when it is back.
 */
const peakCache = new Map();

/**
 * The strips that have been drawn, and how to draw them again.
 *
 * A canvas keeps the pixels it was given: the colours are read from the
 * stylesheet once, when the strip is drawn, so a strip drawn in the dark
 * stays dark after the page turns light. The strips therefore remember how
 * they were drawn, and the theme asks for them to be drawn again.
 *
 * A strip that is no longer on the page is forgotten: the list is cleaned
 * when the theme asks for a redraw, so a card that was deleted does not
 * keep its strip alive.
 */
const redraws = new Set();

const remember = (canvas, draw) => {
  const entry = { canvas, draw };
  redraws.add(entry);
  return entry;
};

/**
 * Draw every strip again, in the colours the theme has now.
 *
 * The theme calls this after it changes the palette. A strip that is gone
 * is dropped here, so the list only ever holds the strips on the page.
 */
export function redrawStrips() {
  for (const entry of [...redraws]) {
    const { canvas } = entry;
    if (!canvas.isConnected) {
      redraws.delete(entry);
      continue;
    }
    void entry.draw();
  }
}

/**
 * The peaks of a sound, decoded once and kept.
 */
export async function waveformFor(url, buckets = 120) {
  const key = String(url ?? '') + '|' + buckets;
  const kept = peakCache.get(key);
  if (kept) return kept;
  let peaks = [];
  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return [];
    const context = new Audio();
    const audio = await context.decodeAudioData(buffer);
    peaks = waveformPeaks(audio.getChannelData(0), buckets);
    context.close?.();
  } catch {
    return [];
  }
  if (peaks.length) peakCache.set(key, peaks);
  return peaks;
}

/**
 * Draw the waveform of an audio into the strip.
 *
 * The colour and the weight of the wave are the stylesheet's business: the
 * strip and the card want the same sound drawn differently, and the theme
 * decides how bright it is.
 */
export async function paintWaveform(canvas, url, buckets = 120, options = {}) {
  const oversample = Math.max(1, Number(options.oversample) || 1);
  // The strip remembers how to draw itself, so the theme can ask for it
  // again with the colours it has now.
  remember(canvas, () => paintWaveform(canvas, url, buckets, options));
  const peaks = await waveformFor(url, buckets);
  if (!peaks.length) return false;
  const width = canvas.clientWidth || 520;
  const height = canvas.clientHeight || 56;
  const scale = (window.devicePixelRatio || 1) * oversample;
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.scale(scale, scale);
  ctx.fillStyle = tone(canvas, '--mcode-bg-secondary', '#111');
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = tone(canvas, '--nxc-wave-color', 'rgba(200,210,225,0.9)');
  const alpha = Number(tone(canvas, '--nxc-wave-alpha', '1'));
  ctx.globalAlpha = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
  const step = width / Math.max(1, peaks.length);
  for (let index = 0; index < peaks.length; index += 1) {
    const bar = Math.max(1, peaks[index] * height * 0.92);
    ctx.fillRect(index * step, (height - bar) / 2, Math.max(1, step * 0.62), bar);
  }
  ctx.globalAlpha = 1;
  return true;
}
