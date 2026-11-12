/**
 * The bytes of a file that a request asks for.
 *
 * A browser that plays a file - or that scrubs inside one - asks for the
 * part of the file it wants. A server that answers every request with the
 * whole file tells the browser the file cannot be moved inside, and then
 * the playhead of a trim bar is stuck at the start however hard the user
 * presses the strip.
 *
 * This is the rule for one range header: which bytes the caller asked
 * for. A header that means something else is left alone: the caller is
 * the only judge of what it meant.
 */
export function parseByteRange(header, total) {
  const size = Math.max(0, Number(total) || 0);
  const text = String(header ?? '').trim();
  const match = /^bytes\s*=\s*(.+)$/i.exec(text);
  if (!match) return null;
  const first = String(match[1]).split(',')[0].trim();
  const parts = /^(\d*)-(\d*)$/.exec(first);
  if (!parts) return null;
  const startText = parts[1];
  const endText = parts[2];
  if (startText === '' && endText === '') return null;
  if (startText === '') {
    // The last bytes: bytes=-500 is the final 500 bytes.
    const wanted = Math.max(0, Number(endText) || 0);
    if (wanted === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - wanted), end: size - 1 };
  }
  const start = Number(startText);
  if (!Number.isFinite(start)) return null;
  if (start >= size) return 'unsatisfiable';
  let end = endText === '' ? size - 1 : Number(endText);
  if (!Number.isFinite(end)) return null;
  // An end before the start is a header that means nothing.
  if (end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}
