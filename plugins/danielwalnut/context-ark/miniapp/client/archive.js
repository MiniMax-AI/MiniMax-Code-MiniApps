import { parseExport } from './adapters.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function u16(view, offset) { return view.getUint16(offset, true); }
function u32(view, offset) { return view.getUint32(offset, true); }

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readInput(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.name.toLowerCase().endsWith('.json')) return parseExport(JSON.parse(decoder.decode(bytes)));
  if (!file.name.toLowerCase().endsWith('.zip')) throw new Error('Choose a .zip or .json export.');
  const entries = await readZip(bytes);
  const sessionEntries = entries.filter(([name]) => /^chat_sessions\/[^/]+\.json$/.test(name));
  if (sessionEntries.length) {
    const parsed = [];
    for (const [, content] of sessionEntries) parsed.push(...parseExport(JSON.parse(decoder.decode(content))));
    return parsed;
  }
  const legacy = entries.find(([name]) => name === 'conversations.json');
  if (!legacy) throw new Error('No supported conversation JSON was found in this ZIP.');
  return parseExport(JSON.parse(decoder.decode(legacy[1])));
}

export async function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Locate the end-of-central-directory record; sizes there are reliable even when
  // local headers defer them to data descriptors (flag 0x08), as real exports do.
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 0xffff); offset -= 1) {
    if (u32(view, offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('This file is not a valid ZIP archive.');
  const count = u16(view, eocd + 10);
  let cursor = u32(view, eocd + 16);
  const files = [];
  for (let index = 0; index < count; index += 1) {
    if (u32(view, cursor) !== 0x02014b50) throw new Error('Corrupt ZIP central directory.');
    const method = u16(view, cursor + 10);
    const compressedSize = u32(view, cursor + 20);
    const nameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    const localOffset = u32(view, cursor + 42);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (u32(view, localOffset) !== 0x04034b50) throw new Error(`Corrupt ZIP entry ${name}.`);
    const dataStart = localOffset + 30 + u16(view, localOffset + 26) + u16(view, localOffset + 28);
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    const content = method === 0 ? compressed : method === 8 ? await inflate(compressed) : null;
    if (!content) throw new Error(`Unsupported ZIP compression method ${method}.`);
    files.push([name.normalize('NFC'), content]);
  }
  return files;
}

export function markdownFor(conversation, handoff = '') {
  const lines = [
    `# ${conversation.title}`, '',
    `- Imported: ${conversation.updatedAt || conversation.createdAt || 'unknown'}`,
    `- Source ID: ${conversation.sourceId}`, '',
  ];
  if (handoff) lines.push('## Handoff', '', handoff, '');
  lines.push('## Transcript', '');
  const activeIds = new Set(activePath(conversation));
  for (const message of conversation.messages) {
    const branch = activeIds.has(message.id) ? '' : ' · alternate branch';
    lines.push(`### ${message.role === 'user' ? 'User' : 'Assistant'}${branch}`, '');
    for (const block of message.blocks) {
      if (block.type === 'text') lines.push(block.text, '');
      if (block.type === 'reasoning') lines.push('<details><summary>Reasoning</summary>', '', block.text, '', '</details>', '');
      if (block.type === 'search') {
        lines.push('<details><summary>Web search</summary>', '');
        for (const result of block.results || []) lines.push(`- [${result.title || result.url}](${result.url || '#'}) — ${result.snippet || ''}`);
        lines.push('', '</details>', '');
      }
      if (block.type === 'attachment') {
        lines.push('<details><summary>Attachment references</summary>', '');
        for (const file of block.files || []) lines.push(`- ${file.name || file.id} (${file.size || 0} bytes; binary ${file.available ? 'included in source export' : 'not available'})`);
        lines.push('', '</details>', '');
      }
      if (block.type === 'notice') lines.push(`> ${block.label}: ${block.text}`, '');
    }
  }
  return lines.join('\n');
}

function activePath(conversation) {
  const byId = new Map(conversation.messages.map((message) => [message.id, message]));
  let current = byId.get(conversation.currentMessageId) || conversation.messages.at(-1);
  const ids = [];
  while (current) {
    ids.push(current.id);
    current = current.parentId == null ? null : byId.get(current.parentId);
  }
  return ids;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function safeName(value) {
  const clean = value.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim();
  return (clean || 'conversation').slice(0, 80);
}

export function buildArchive(conversations, handoffs = {}) {
  const files = conversations.map((conversation, index) => ({
    name: `conversations/${String(index + 1).padStart(3, '0')}-${safeName(conversation.title)}-${conversation.sourceId.slice(0, 8)}.md`,
    data: encoder.encode(markdownFor(conversation, handoffs[conversation.stableId] || '')),
  }));
  const index = [
    '# Conversation archive', '',
    'Open `search.html` for local full-text search.', '',
    ...files.map((file, index) => `- [${conversations[index].title}](${file.name})`),
  ].join('\n');
  const searchData = conversations.map((conversation, index) => ({
    title: conversation.title, file: files[index].name,
    text: markdownFor(conversation, handoffs[conversation.stableId] || ''),
  }));
  files.unshift({ name: 'index.md', data: encoder.encode(index) });
  files.push({ name: 'search.html', data: encoder.encode(searchPage(searchData)) });
  return zipStore(files);
}

function searchPage(data) {
  const safe = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html><meta charset="utf-8"><title>Archive search</title><style>body{font:16px system-ui;max-width:900px;margin:40px auto;padding:0 20px;background:#faf8f2;color:#24231f}input{width:100%;padding:14px;font:inherit;border:1px solid #aaa;border-radius:10px}article{padding:18px 0;border-bottom:1px solid #ddd}a{color:#1e6758}</style><h1>Archive search</h1><input id="q" autofocus placeholder="Search every conversation"><main id="r"></main><script>const data=${safe};const q=document.querySelector('#q'),r=document.querySelector('#r');function draw(){const s=q.value.toLowerCase().trim();r.innerHTML=data.filter(x=>!s||x.text.toLowerCase().includes(s)).slice(0,100).map(x=>'<article><a href="'+x.file+'"><b>'+x.title.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</b></a></article>').join('')}q.oninput=draw;draw()</script>`;
}

function zipStore(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
    view.setUint32(14, crc, true); view.setUint32(18, file.data.length, true); view.setUint32(22, file.data.length, true);
    view.setUint16(26, name.length, true); local.set(name, 30);
    chunks.push(local, file.data);
    const dir = new Uint8Array(46 + name.length);
    const d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x0800, true);
    d.setUint32(16, crc, true); d.setUint32(20, file.data.length, true); d.setUint32(24, file.data.length, true);
    d.setUint16(28, name.length, true); d.setUint32(42, offset, true); dir.set(name, 46);
    central.push(dir);
    offset += local.length + file.data.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end], { type: 'application/zip' });
}
