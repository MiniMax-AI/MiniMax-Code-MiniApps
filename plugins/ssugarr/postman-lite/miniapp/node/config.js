import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录 */
export const ROOT_DIR = path.resolve(here, '..');

/**
 * 运行时数据目录。
 * 默认取仓库下的 data/，也可以用 PM_DATA_DIR 覆盖；
 * Mini App 场景下由 Node 入口用 setDataDir() 注入 Host 分配的数据目录，
 * 这样同一套存储代码能同时服务「独立运行」和「Mini App」两种宿主。
 */
let dataDir = process.env.PM_DATA_DIR
  ? path.resolve(process.env.PM_DATA_DIR)
  : path.join(ROOT_DIR, 'data');

export function getDataDir() {
  return dataDir;
}

export function setDataDir(dir) {
  dataDir = path.resolve(dir);
}

/** 集合数据文件名 */
export const STATE_FILE = 'state.json';

/** 前端构建产物目录 */
export const DIST_DIR = path.join(ROOT_DIR, 'dist');

/** 生产模式监听端口 */
export const PORT = Number(process.env.PORT || 8787);

/** 生产模式监听地址，默认只绑定本机 */
export const HOST = process.env.HOST || '127.0.0.1';

