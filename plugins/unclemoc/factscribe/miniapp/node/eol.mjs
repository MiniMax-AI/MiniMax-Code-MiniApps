// 正文行尾保真：把引擎写盘时弄丢的行尾，按原文件的风格找回来。
//
// 为什么需要这一层（为什么行尾会丢）：
//
//   1. 引擎的读路径（factscribe/workbench/write.py 的 read_text）用 Python 文本
//      模式读文件，做通用换行翻译：CRLF 在到达页面前就已经变成 LF 了——
//      页面这一层拿不到磁盘上的真行尾。
//   2. 引擎的写路径（write.py 的 atomic_write）用二进制模式写：它把读到的
//      LF 形态原样写回磁盘。于是**任何一次保存都会把整篇的行尾改成 LF**——
//      一份 CRLF 的稿子存一次就没了（macOS / Linux 上同样发生，与 Windows 无关）。
//
// 所以行尾的「真相」只在磁盘上的原文件里。这一模块只做两件事：
//
//   * 读出原文件用哪种行尾（crlf / lf / mixed）；
//   * 把引擎写完的文件按那种风格摆回去。
//
// 只碰行尾，不碰内容：段落文字、全角字符、emoji、\fact{}/\cite{} 标记、
// 段内换行——一个字符都不动。

/** 换行只有两种：\r\n 与 \n。落单的 \r 当作正文里的普通字符，不当行尾。 */
export const CRLF = '\r\n';
export const LF = '\n';

/**
 * 把文本切成 [{content, ending}]：行尾单独摘出来，行内容原样保留。
 *
 * 刻意不用 String.prototype.split('\n')：那样会把 '\r' 留在行内容里，
 * 重建时 \r\n 就会变成 '\r' + 换行，行尾就拼错了。
 */
export function splitKeepEnds(text) {
  const source = String(text ?? '');
  const out = [];
  let index = 0;
  while (index <= source.length) {
    const nl = source.indexOf('\n', index);
    if (nl === -1) {
      if (index < source.length) out.push({ content: source.slice(index), ending: '' });
      break;
    }
    // '\r\n' 是一个行尾；落单的 '\r' 留在行内容里（当正文看）。
    const hasCr = nl > index && source[nl - 1] === '\r';
    const contentEnd = hasCr ? nl - 1 : nl;
    out.push({
      content: source.slice(index, contentEnd),
      ending: source.slice(contentEnd, nl + 1),
    });
    index = nl + 1;
  }
  return out;
}

/** 数一数文本里的行尾种类。 */
export function detectEol(text) {
  let crlf = 0;
  let lf = 0;
  for (const line of splitKeepEnds(text)) {
    if (line.ending === CRLF) crlf += 1;
    else if (line.ending === LF) lf += 1;
  }
  let style = 'none';
  if (crlf && lf) style = 'mixed';
  else if (crlf) style = 'crlf';
  else if (lf) style = 'lf';
  return { style, crlf, lf };
}

/**
 * 原文件的主导行尾：CRLF 多就用 CRLF，LF 多就用 LF。
 *
 * 计数相同时取 CRLF——与引擎侧 factscribe/textio.py::dominant_newline 同一口径。
 * 原文件一行都没有行尾时用 fallback（LF）。
 */
export function dominantEnding(text, fallback = LF) {
  const { crlf, lf } = detectEol(text);
  if (crlf === 0 && lf === 0) return fallback;
  return crlf >= lf ? CRLF : LF;
}

/**
 * 把正文里所有行尾换成 ending；行内容一个字不动。
 *
 * 「末行有没有行尾」这个结构也原样保留：原文本末尾没有换行，换完还是没有。
 */
export function applyEnding(text, ending) {
  if (!ending) return String(text ?? '');
  return splitKeepEnds(text)
    .map((line) => line.content + (line.ending ? ending : ''))
    .join('');
}

/**
 * 传给引擎的形态：一律 LF，不带 '\r'。
 *
 * '\r' 绝不进引擎那一层：引擎写盘是二进制写，带 '\r' 会原样写进文件，
 * 在已经是 CRLF 的稿子上就会写出 '\r\r\n' 这种坏掉的行尾。
 * 行尾由本模块在引擎写完之后按原风格校正。
 */
export function toLfOnly(text) {
  return String(text ?? '').replace(/\r\n/g, '\n');
}

/** 只要行内容（不要行尾）：用来判断「内容有没有被别人改过」。 */
export function lineContents(text) {
  return splitKeepEnds(text).map((line) => line.content);
}

/** 行内容序列一致＝只差行尾；不一致＝有人改过正文，不能覆盖。 */
export function sameContent(a, b) {
  const left = lineContents(a);
  const right = lineContents(b);
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

/**
 * 把引擎写完的正文按**原文件**的行尾风格摆回去。
 *
 * 做法是按行对齐：
 *   - 头尾那些「内容没变」的行，原样留着原文件里的行尾（连混合行尾也留着）；
 *   - 中间被这次保存改过的那一段，用原文件的主导行尾。
 *
 * 只动行尾，不动内容：返回值的行内容序列与 after 一字不差——
 * 末尾再 assert 一次，对不上就返回 null（一个字也不动）。
 *
 * @param {string} before 保存前的文件内容（带磁盘上的真行尾）
 * @param {string} after  引擎写完的文件内容
 * @returns {string|null} 摆回行尾后的内容；对不上返回 null
 */
export function restoreOriginalEndings(before, after) {
  const beforeItems = splitKeepEnds(String(before ?? ''));
  const afterItems = splitKeepEnds(String(after ?? ''));
  const limit = Math.min(beforeItems.length, afterItems.length);

  // 最长的共同前缀：内容相同的行数（头）。
  let head = 0;
  while (head < limit && beforeItems[head].content === afterItems[head].content) head += 1;
  // 最长的共同后缀：内容相同的行数（尾）。不与前缀重叠。
  let tail = 0;
  while (tail < limit - head
    && beforeItems[beforeItems.length - 1 - tail].content === afterItems[afterItems.length - 1 - tail].content) {
    tail += 1;
  }

  const ending = dominantEnding(before);
  const out = [];
  for (let i = 0; i < head; i += 1) {
    out.push(beforeItems[i].content + beforeItems[i].ending);
  }
  const midEnd = afterItems.length - tail;
  for (let i = head; i < midEnd; i += 1) {
    out.push(afterItems[i].content + (afterItems[i].ending ? ending : ''));
  }
  for (let i = beforeItems.length - tail; i < beforeItems.length; i += 1) {
    out.push(beforeItems[i].content + beforeItems[i].ending);
  }
  const restored = out.join('');
  // 安全网：内容必须与引擎写出来的一字不差（只差行尾）。对不上就一个字也不动。
  if (toLfOnly(restored) !== toLfOnly(String(after ?? ''))) return null;
  return restored;
}
