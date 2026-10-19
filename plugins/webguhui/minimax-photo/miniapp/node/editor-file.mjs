import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, extname, isAbsolute } from 'node:path';

export async function readEditorFile(filePath) {
  if (typeof filePath !== 'string' || !isAbsolute(filePath) || filePath.length > 4096)
    throw Error('请提供用户指定文件或工具导出文件的本机绝对路径');
  const extension = extname(filePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp', '.psd', '.pcraft'].includes(extension))
    throw Error('支持 PNG、JPEG、WebP、PSD 和 pcraft 工程');
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NONBLOCK || 0));
  let data;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 12 || info.size > 32 * 1024 * 1024)
      throw Error('需要 32 MB 以内的普通图片或工程文件');
    data = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== info.size) throw Error('读取期间文件大小变化，请确认保存完成后重试');
    data = data.subarray(0, offset);
  } finally { await handle.close(); }
  const valid = extension === '.png' ? data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : ['.jpg', '.jpeg'].includes(extension) ? data[0] === 255 && data[1] === 216 && data[2] === 255
    : extension === '.webp' ? data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'
    : extension === '.psd' ? data.toString('ascii', 0, 4) === '8BPS' && data.readUInt16BE(4) === 1
    : data.subarray(0, 4).equals(Buffer.from([80,75,3,4]));
  if (!valid) throw Error('文件内容与扩展名不符');
  return { name: basename(filePath), data: data.toString('base64') };
}
