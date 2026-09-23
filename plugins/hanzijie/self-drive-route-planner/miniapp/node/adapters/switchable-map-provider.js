import { AmapMapProvider } from "./amap-map-provider.js";
import { DemoMapProvider } from "./demo-map-provider.js";
import { UnconfiguredMapProvider } from "./unconfigured-map-provider.js";

// 运行期可切换的地图 Provider：
// - map_mode=demo           -> 本地演示数据（明确标注）
// - map_mode=real 且有 Key  -> 高德 Web 服务（真实搜索与算路）
// - map_mode=real 且无 Key  -> unconfigured（搜索与算路返回明确错误）
export class SwitchableMapProvider {
  #demo = new DemoMapProvider();
  #unconfigured = new UnconfiguredMapProvider();
  #active;

  constructor(config) {
    this.configure(config ?? {});
  }

  configure({ amapKey, mapMode } = {}) {
    if (mapMode === "demo") {
      this.#active = this.#demo;
    } else if (amapKey) {
      this.#active = new AmapMapProvider({ key: amapKey });
    } else {
      this.#active = this.#unconfigured;
    }
  }

  get mode() {
    return this.#active.mode;
  }

  searchPlaces(input) {
    return this.#active.searchPlaces(input);
  }

  planRoute(trip) {
    return this.#active.planRoute(trip);
  }
}
