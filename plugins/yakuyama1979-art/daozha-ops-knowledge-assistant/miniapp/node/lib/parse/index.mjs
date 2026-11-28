// Dispatches a document to the right text extractor.

import { parseDocx } from './docx.mjs';
import { parseXlsx } from './xlsx.mjs';
import { parsePdf } from './pdf.mjs';

export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.markdown', '.docx', '.xlsx', '.pdf'];

export function extensionOf(name) {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const index = base.lastIndexOf('.');
  return index < 0 ? '' : base.slice(index).toLowerCase();
}

export function isSupportedFile(name) {
  return SUPPORTED_EXTENSIONS.includes(extensionOf(name));
}

/**
 * @param {string} name
 * @param {Buffer} buffer
 * @returns {{ text:string, kind:string, meta:object }}
 */
export function parseDocument(name, buffer) {
  const extension = extensionOf(name);
  if (extension === '.txt' || extension === '.md' || extension === '.markdown') {
    const text = decodeText(buffer);
    if (!text.trim()) throw new Error('file_has_no_text');
    return { text, kind: 'text', meta: { characters: text.length } };
  }
  if (extension === '.docx') {
    const result = parseDocx(buffer);
    return {
      text: result.text,
      kind: 'docx',
      meta: { paragraphs: result.paragraphs.length, tables: result.tables },
    };
  }
  if (extension === '.xlsx') {
    const result = parseXlsx(buffer);
    return { text: result.text, kind: 'xlsx', meta: { sheets: result.sheets } };
  }
  if (extension === '.pdf') {
    const result = parsePdf(buffer);
    return { text: result.text, kind: 'pdf', meta: { pages: result.pages, title: result.title } };
  }
  throw new Error(`unsupported_file_type:${extension || 'unknown'}`);
}

/** Decodes text with a BOM aware UTF-8 / UTF-16 / GBK fallback chain. */
export function decodeText(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    if (swapped.length >= 2) swapped.swap16();
    return swapped.toString('utf16le');
  }
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if (!utf8.includes('\ufffd')) return utf8;
  try {
    const gbk = new TextDecoder('gbk').decode(buffer);
    if (!gbk.includes('\ufffd')) return gbk;
  } catch {
    /* TextDecoder without GBK support */
  }
  return utf8;
}
