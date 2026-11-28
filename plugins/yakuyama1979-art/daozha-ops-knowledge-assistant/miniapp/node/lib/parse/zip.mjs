// Minimal ZIP reader (deflate + stored) built on node:zlib.
// Enough for OOXML containers (.docx / .xlsx) without any third-party dependency.

import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/**
 * @param {Buffer} buffer
 */
export function readZip(buffer) {
  let eocd = -1;
  const floor = Math.max(0, buffer.length - 66000);
  for (let index = buffer.length - 22; index >= floor; index -= 1) {
    if (buffer.readUInt32LE(index) === EOCD_SIGNATURE) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip_end_of_central_directory_not_found');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (offset === 0xffffffff || entryCount === 0xffff) {
    throw new Error('zip64_container_not_supported');
  }

  const entries = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length) throw new Error('zip_central_directory_truncated');
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error('zip_central_directory_invalid');
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.set(name, { method, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    read(name) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`zip_entry_missing:${name}`);
      const local = entry.localOffset;
      if (local + 30 > buffer.length) throw new Error('zip_local_header_truncated');
      if (buffer.readUInt32LE(local) !== LOCAL_SIGNATURE) throw new Error('zip_local_header_invalid');
      const nameLength = buffer.readUInt16LE(local + 26);
      const extraLength = buffer.readUInt16LE(local + 28);
      const start = local + 30 + nameLength + extraLength;
      const data = buffer.subarray(start, start + entry.compressedSize);
      if (entry.method === 0) return data;
      if (entry.method === 8) {
        try {
          return inflateRawSync(data);
        } catch {
          throw new Error('zip_inflate_failed');
        }
      }
      throw new Error(`zip_compression_method_unsupported:${entry.method}`);
    },
  };
}
