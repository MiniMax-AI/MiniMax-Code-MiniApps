// .xlsx text extraction: shared strings plus every worksheet, rendered as tab separated rows.

import { readZip } from './zip.mjs';
import { decodeXml } from './docx.mjs';

/**
 * @param {Buffer} buffer
 * @returns {{ text: string, sheets: Array<{name:string, rows:number}> }}
 */
export function parseXlsx(buffer) {
  const zip = readZip(buffer);
  const shared = readSharedStrings(zip);
  const sheetFiles = zip
    .names()
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((left, right) => sheetNumber(left) - sheetNumber(right));
  if (!sheetFiles.length) throw new Error('xlsx_no_worksheet_found');

  const sheetNames = readSheetNames(zip);
  const blocks = [];
  const sheets = [];
  sheetFiles.forEach((file, index) => {
    const xml = zip.read(file).toString('utf8');
    const rows = readWorksheetRows(xml, shared);
    const name = sheetNames[index] || `Sheet${index + 1}`;
    sheets.push({ name, rows: rows.length });
    const body = rows.map((row) => row.join('\t')).join('\n');
    blocks.push(`## 工作表：${name}\n${body}`);
  });

  const text = blocks.join('\n\n');
  if (!text.trim()) throw new Error('xlsx_no_text_content');
  return { text, sheets };
}

function sheetNumber(file) {
  const matched = /sheet(\d+)\.xml$/.exec(file);
  return matched ? Number(matched[1]) : 0;
}

function readSharedStrings(zip) {
  if (!zip.has('xl/sharedStrings.xml')) return [];
  const xml = zip.read('xl/sharedStrings.xml').toString('utf8');
  const values = [];
  const pattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let matched = pattern.exec(xml);
  while (matched) {
    const parts = [];
    const textPattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let textMatch = textPattern.exec(matched[1]);
    while (textMatch) {
      parts.push(decodeXml(textMatch[1] || ''));
      textMatch = textPattern.exec(matched[1]);
    }
    values.push(parts.join(''));
    matched = pattern.exec(xml);
  }
  return values;
}

function readSheetNames(zip) {
  if (!zip.has('xl/workbook.xml')) return [];
  const xml = zip.read('xl/workbook.xml').toString('utf8');
  const names = [];
  const pattern = /<sheet\b[^>]*\bname="([^"]*)"[^>]*>/g;
  let matched = pattern.exec(xml);
  while (matched) {
    names.push(decodeXml(matched[1]));
    matched = pattern.exec(xml);
  }
  return names;
}

function readWorksheetRows(xml, shared) {
  const rows = [];
  const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch = rowPattern.exec(xml);
  while (rowMatch) {
    const cells = [];
    let maxIndex = -1;
    const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch = cellPattern.exec(rowMatch[1]);
    while (cellMatch) {
      const attributes = cellMatch[1] || '';
      const body = cellMatch[2] || '';
      const reference = /\br="([A-Z]+)\d+"/.exec(attributes);
      const type = /\bt="([^"]+)"/.exec(attributes);
      const columnIndex = reference ? columnFromLetters(reference[1]) : cells.length;
      const value = readCellValue(body, type ? type[1] : '', shared);
      cells[columnIndex] = value;
      if (columnIndex > maxIndex) maxIndex = columnIndex;
      cellMatch = cellPattern.exec(rowMatch[1]);
    }
    const normalized = [];
    for (let index = 0; index <= maxIndex; index += 1) {
      normalized.push(cells[index] === undefined ? '' : String(cells[index]));
    }
    if (normalized.some((cell) => cell !== '')) rows.push(normalized);
    rowMatch = rowPattern.exec(xml);
  }
  return rows;
}

function readCellValue(body, type, shared) {
  if (type === 'inlineStr') {
    const parts = [];
    const pattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let matched = pattern.exec(body);
    while (matched) {
      parts.push(decodeXml(matched[1] || ''));
      matched = pattern.exec(body);
    }
    return parts.join('');
  }
  const valueMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
  const raw = valueMatch ? decodeXml(valueMatch[1] || '') : '';
  if (type === 's') {
    const index = Number(raw);
    return Number.isFinite(index) && shared[index] !== undefined ? shared[index] : '';
  }
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
  return raw;
}

function columnFromLetters(letters) {
  let index = 0;
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}
