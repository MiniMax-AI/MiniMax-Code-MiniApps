import fs from 'node:fs';
import path from 'node:path';

import { getDataDir, STATE_FILE } from './config.js';

function statePath() {
  return path.join(getDataDir(), STATE_FILE);
}

/** 空文档 */
export function emptyState() {
  return { version: 1, rev: 0, nodes: [] };
}

/** 规整外部传入的文档，剔除非法字段 */
export function normalizeState(raw) {
  const doc = raw && typeof raw === 'object' ? raw : {};
  return {
    version: 1,
    rev: Number.isFinite(doc.rev) ? doc.rev : 0,
    nodes: Array.isArray(doc.nodes) ? doc.nodes : [],
  };
}

/**
 * 读取集合文档。
 * 文件不存在时返回空文档；文件损坏时先备份为 .bak 再返回空文档，绝不静默丢弃用户数据。
 */
export function readState() {
  const file = statePath();
  if (!fs.existsSync(file)) return emptyState();
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return normalizeState(JSON.parse(raw));
  } catch {
    try {
      fs.copyFileSync(file, `${file}.bak`);
    } catch {
      // 备份失败也不能阻止启动
    }
    return emptyState();
  }
}

/**
 * 原子写入集合文档。
 * 先写 .tmp 再 rename，保证任何时刻磁盘上的 state.json 都是完整 JSON。
 * rev 由服务端自增并回传，客户端传来的 rev 不作为权威值。
 */
export function writeState(doc) {
  fs.mkdirSync(getDataDir(), { recursive: true });
  const file = statePath();
  const onDisk = readState();
  const incomingRev = Number.isFinite(doc?.rev) ? doc.rev : 0;

  if (incomingRev < onDisk.rev) {
    // 客户端基于更旧的版本提交（说明另一个页面/标签已经改过集合），
    // 丢弃这次写入，避免陈旧页面把新数据覆盖回旧值。
    return { ...onDisk, stale: true };
  }

  const next = { ...normalizeState(doc), rev: onDisk.rev + 1 };
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return next;
}

