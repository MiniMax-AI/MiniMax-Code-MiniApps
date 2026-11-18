import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildArchive, readInput, readZip } from '../miniapp/client/archive.js';
import { activeBranch } from '../miniapp/client/deepseek.js';

const fixtureBytes = readFileSync(new URL('./fixtures/official-v3-export.zip', import.meta.url));

test('reads the official v3 layout through data-descriptor ZIP entries', async () => {
  const view = new DataView(fixtureBytes.buffer, fixtureBytes.byteOffset, fixtureBytes.byteLength);
  assert.equal(view.getUint16(6, true) & 0x08, 0x08);
  const bytes = fixtureBytes;
  const file = { name: 'deepseek_data.zip', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  const conversations = await readInput(file);
  assert.equal(conversations.length, 2);
  assert.deepEqual(conversations.map((conversation) => conversation.title), [
    'Indexed sources conversation',
    'Indexed branched conversation',
  ]);
  assert.deepEqual(activeBranch(conversations[1]).map((message) => message.id), ['1', '3', '4']);
  assert.equal(conversations[1].branchCount, 1);
  assert.deepEqual(conversations[0].messages[1].blocks.map((block) => block.type), ['reasoning', 'search', 'text']);
  const attachment = conversations[1].messages[0].blocks.find((block) => block.type === 'attachment').files[0];
  assert.equal(attachment.available, true);
  assert.equal(attachment.archivePath, 'attachments/session-branch/file-brief-brief.txt');
});

test('exports the selected conversation with its available attachment', async () => {
  const bytes = fixtureBytes;
  const file = { name: 'deepseek_data.zip', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  const conversations = await readInput(file);
  const branch = conversations[1];
  const archiveBytes = new Uint8Array(await buildArchive([branch]).arrayBuffer());
  const entries = new Map(await readZip(archiveBytes));
  assert.equal(new TextDecoder().decode(entries.get('attachments/session-branch/file-brief-brief.txt')), 'Synthetic attachment data');
  const markdownName = [...entries.keys()].find((name) => name.startsWith('conversations/'));
  const markdown = new TextDecoder().decode(entries.get(markdownName));
  assert.match(markdown, /\[brief\.txt\]\(\.\.\/attachments\/session-branch\/file-brief-brief\.txt\)/);
  assert.equal([...entries.keys()].some((name) => name.includes('session-sources')), false);
});
