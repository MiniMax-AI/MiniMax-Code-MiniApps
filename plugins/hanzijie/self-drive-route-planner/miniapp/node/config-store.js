import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const MAP_MODES = new Set(["real", "demo"]);

function normalizeStoredKey(value) {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

// 高德 Key 只保存在 Mini App 数据目录的 config.json 中（0600 权限），
// 不进入插件包、客户端 JavaScript 或 MCP 返回值。Key 只供 Node 进程调用高德 Web 服务，
// 页面路线图面使用本地矢量渲染。
export class ConfigStore {
  #path;
  #data = {
    amap_key: null,
    map_mode: "real"
  };

  constructor(path) {
    this.#path = path;
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.#path, "utf8"));
      // 兼容旧结构：曾把 Key 拆成 amap_key / amap_js_key 两个字段，
      // 也单独存过 JS API 安全密钥（amap_js_security_code）；实测一个 Key 通吃，均已废弃。
      const key =
        normalizeStoredKey(parsed.amap_key) ?? normalizeStoredKey(parsed.amap_js_key);
      this.#data = {
        amap_key: key,
        map_mode: MAP_MODES.has(parsed.map_mode) ? parsed.map_mode : "real"
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  snapshot() {
    return {
      amapKey: this.#data.amap_key,
      mapMode: this.#data.map_mode
    };
  }

  get keyConfigured() {
    return Boolean(this.#data.amap_key);
  }

  get mapMode() {
    return this.#data.map_mode;
  }

  async update({ key, mapMode } = {}) {
    if (key !== undefined) {
      this.#data.amap_key = key === null ? null : String(key).trim() || null;
    }
    if (mapMode !== undefined) {
      if (!MAP_MODES.has(mapMode)) {
        throw Object.assign(new Error("map_mode 只支持 real 或 demo。"), {
          code: "INVALID_MAP_MODE",
          status: 400
        });
      }
      this.#data.map_mode = mapMode;
    }
    await mkdir(dirname(this.#path), { recursive: true });
    await writeFile(this.#path, `${JSON.stringify(this.#data, null, 2)}\n`, "utf8");
    await chmod(this.#path, 0o600);
    return this.snapshot();
  }
}
