// The material the provider reads, and the shape it has to be in.
//
// The provider reads a video by looking at its frames. A phone clip carries
// sixty frames a second, and the Host gives a connector call thirty seconds
// before it stops it — so a big clip runs out of time and the run fails with
// nothing to show. The clip that is asked about is therefore made smaller
// first: fewer frames, fewer pixels, a smaller file. It is the same clip, only
// smaller, and the answer is about the same picture.
//
// The rules here are plain functions, so they can be tested without a video,
// and the ffmpeg command is an argument array, so nothing in a path can be
// read as shell syntax.

/**
 * What the provider can be asked about in one call.
 *
 * The Host stops a connector call after thirty seconds, and the provider
 * reads a clip frame by frame: the work it does grows with the pixels and the
 * number of frames. These are the limits under which that work fits.
 */
export const UNDERSTANDING_LIMITS = {
  /** A file above this size takes the provider a long time to fetch. */
  maxBytes: 2 * 1024 * 1024,
  /** Longer than this, and the provider is asked about more than it can read. */
  maxSeconds: 12,
  /** The long side of the frame. 1280 is the width of a 720p picture. */
  maxSide: 1280,
  /** Frames per second. A clip does not need sixty to say what happens in it. */
  maxFps: 24,
};

/**
 * The sizes a clip is made smaller to, in the order they are tried.
 *
 * The first one keeps the picture as it is seen on a screen; the second one is
 * for a clip that the provider still cannot read in time.
 */
export const UNDERSTANDING_TIERS = [
  { label: '长边 1280、24 帧', maxSide: 1280, fps: 24, crf: 30, audioKbps: 64 },
  { label: '长边 854、15 帧', maxSide: 854, fps: 15, crf: 32, audioKbps: 48 },
];

/**
 * Whether the clip has to be made smaller, and why.
 *
 * The reasons are the words the user is shown, so they say what was wrong
 * with the clip rather than that a limit was reached.
 */
export function understandingPlan(probe = {}) {
  const bytes = Number(probe.bytes ?? 0) || 0;
  const duration = Number(probe.duration ?? 0) || 0;
  const width = Number(probe.width ?? 0) || 0;
  const height = Number(probe.height ?? 0) || 0;
  const fps = Number(probe.fps ?? 0) || 0;
  const side = Math.max(width, height);
  const reasons = [];
  if (bytes > UNDERSTANDING_LIMITS.maxBytes) {
    reasons.push(`文件 ${(bytes / (1024 * 1024)).toFixed(1)}MB`);
  }
  if (duration > UNDERSTANDING_LIMITS.maxSeconds) {
    reasons.push(`时长 ${duration.toFixed(1)}s`);
  }
  if (side > UNDERSTANDING_LIMITS.maxSide) {
    reasons.push(`${width}×${height}`);
  }
  if (fps > UNDERSTANDING_LIMITS.maxFps) {
    reasons.push(`${fps}fps`);
  }
  if (!reasons.length) return { compress: false, reasons: [], tiers: [] };
  return { compress: true, reasons, tiers: UNDERSTANDING_TIERS };
}

/**
 * The ffmpeg command that makes a clip smaller.
 *
 * The frame is scaled into a box and keeps its shape, and it is never made
 * bigger than it was: a small clip is left alone. The sound is kept, because
 * the provider does hear it and the answer says what was said.
 */
export function compressionArgs({
  input,
  output,
  tier,
  width = 0,
  height = 0,
  fps = 0,
  duration = 0,
  hasAudio = false,
} = {}) {
  const filters = [];
  const side = Math.max(Number(width ?? 0), Number(height ?? 0));
  // A file whose shape could not be measured is made smaller anyway: a clip
  // that cannot be measured is a clip that cannot be read in time.
  if (!side || side > tier.maxSide) {
    filters.push(`scale=w=${tier.maxSide}:h=${tier.maxSide}:force_original_aspect_ratio=decrease`);
  }
  if (!fps || fps > tier.fps) filters.push(`fps=${tier.fps}`);
  const args = ['-i', String(input)];
  if (filters.length) args.push('-vf', filters.join(','));
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(tier.crf));
  if (hasAudio) {
    args.push('-c:a', 'aac', '-b:a', `${tier.audioKbps}k`);
  } else {
    args.push('-an');
  }
  if (Number(duration ?? 0) > UNDERSTANDING_LIMITS.maxSeconds) {
    args.push('-t', String(UNDERSTANDING_LIMITS.maxSeconds));
  }
  args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart', String(output));
  return args;
}

/**
 * Whether the call was stopped for time rather than refused.
 *
 * Only those two answers are worth trying again with a smaller clip: the
 * provider refused the clip, or said something about it, and a smaller clip
 * would be refused the same way.
 */
export function isUnderstandTimeout(error) {
  const code = String(error?.code ?? '');
  return code === 'CONNECTOR_OUTCOME_UNKNOWN' || code === 'CONNECTOR_TIMEOUT';
}
