// The audio the provider accepts.
//
// The provider reads an audio reference as a file it can decode, and it
// takes wav and mp3 only: an m4a is refused with an error that names the
// two formats it does take. So every audio that leaves this app towards
// the provider is one of them.
//
// The tools that make an audio make an mp3, and an audio that came from
// somewhere else - a file the user brought in, a track this app made
// before this rule existed - is converted on the way out. Both read the
// rule from here, so the two cannot drift apart.

// The audio formats this app reads.
export const AUDIO_EXTS = ['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus'];

// The formats the provider takes, as file extensions.
export const PROVIDER_AUDIO_EXTS = ['.wav', '.mp3'];

// The format an audio is written in when it is made or converted.
export const AUDIO_TARGET_EXT = '.mp3';
export const AUDIO_TARGET_MIME = 'audio/mpeg';

// The ffmpeg arguments that write it. One place, so the tool that makes an
// audio and the code that converts one encode them the same way.
export const AUDIO_ENCODE_ARGS = ['-c:a', 'libmp3lame', '-b:a', '192k'];

/**
 * Whether the provider reads this file as it is.
 *
 * The extension is what the provider looks at, and the name the file has
 * on disk is the name it is uploaded under, so the name is the answer.
 */
export function isProviderAudio(path) {
  const match = /\.[a-z0-9]{2,5}$/i.exec(String(path ?? ''));
  const ext = match ? match[0].toLowerCase() : '';
  return PROVIDER_AUDIO_EXTS.includes(ext);
}

/**
 * Write an audio in the format the provider takes.
 *
 * The file is written as an mp3 and its path is the answer. The caller owns
 * the file afterwards: it is either published as an asset of the canvas or
 * thrown away with the working folder.
 *
 * `args` sits in front of the input, so a tool that cuts a stretch out of a
 * track says where the cut is.
 */
export async function toProviderAudio({ ffmpeg, source, target, args = [] }) {
  await ffmpeg.run([...args, '-i', source, '-vn', ...AUDIO_ENCODE_ARGS, target]);
  return target;
}
