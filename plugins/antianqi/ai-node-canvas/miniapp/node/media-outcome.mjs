// What a media run that produced no file means.
//
// A run that ends without a file is not a success. The canvas would show an
// empty node and say "完成", and the user would have paid for a picture that
// is nowhere to be seen. So the judgment lives here, once: the direct
// connector call and the Agent turn ask the same question and get the same
// answer.

// What a mode is called when its run comes back empty.
const MODE_NOUN = {
  image: '图片',
  video: '视频',
  audio: '音频',
  music: '音乐',
};

// The modes whose run is supposed to leave a file behind. A text run leaves
// none, so it is never asked this question.
const FILE_MODES = new Set(Object.keys(MODE_NOUN));

/**
 * What a finished media run means.
 *
 * @param {object} input
 * @param {string} [input.mode] the mode the run was made in
 * @param {Array} [input.media] the files the run left behind
 * @param {string[]} [input.warnings] what the run lost, in words
 * @param {string} [input.subject] which road ran it, in words
 * @returns {{ok: true}|{ok: false, code: string, message: string}}
 */
export function mediaOutcome({ mode = 'image', media = [], warnings = [], subject = '直连通道' } = {}) {
  if (!FILE_MODES.has(mode)) return { ok: true };
  if ((media ?? []).length) return { ok: true };
  const noun = MODE_NOUN[mode] ?? '文件';
  const lost = (warnings ?? []).map((item) => String(item ?? '').trim()).filter(Boolean);
  const message = lost.length
    ? `没有取回${noun}：${lost.join('；')}`
    : `${subject}跑完了，但一个${noun}都没有取回来，请再试一次。`;
  return { ok: false, code: 'MEDIA_MISSING', message };
}
