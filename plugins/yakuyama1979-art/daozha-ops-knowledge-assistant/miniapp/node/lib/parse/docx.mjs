// .docx text extraction: reads word/document.xml out of the OOXML container.

import { readZip } from './zip.mjs';

/**
 * @param {Buffer} buffer
 * @returns {{ text: string, paragraphs: string[], tables: number }}
 */
export function parseDocx(buffer) {
  const zip = readZip(buffer);
  if (!zip.has('word/document.xml')) {
    throw new Error('docx_document_part_missing');
  }
  let xml = zip.read('word/document.xml').toString('utf8');
  // Drop tracked deletions so removed text never becomes knowledge.
  xml = xml.replace(/<w:del\b[\s\S]*?<\/w:del>/g, '');

  const paragraphs = [];
  const paragraphPattern = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let matched = paragraphPattern.exec(xml);
  while (matched) {
    const text = extractParagraphText(matched[1]);
    if (text.trim()) paragraphs.push(text.trim());
    matched = paragraphPattern.exec(xml);
  }

  const tables = (xml.match(/<w:tbl\b/g) || []).length;
  const text = paragraphs.join('\n');
  if (!text.trim()) throw new Error('docx_no_text_content');
  return { text, paragraphs, tables };
}

function extractParagraphText(fragment) {
  let out = '';
  const pattern = /<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  let matched = pattern.exec(fragment);
  while (matched) {
    if (matched[0].startsWith('<w:tab')) out += '\t';
    else if (matched[0].startsWith('<w:br')) out += '\n';
    else out += decodeXml(matched[1] || '');
    matched = pattern.exec(fragment);
  }
  return out;
}

export function decodeXml(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}
