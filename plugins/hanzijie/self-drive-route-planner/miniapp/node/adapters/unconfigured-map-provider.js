function notConfigured() {
  throw Object.assign(new Error("高德未连接，当前不能搜索地点或规划真实路线。"), {
    code: "MAP_NOT_CONFIGURED",
    status: 503,
    recovery:
      "拿到高德 Key 后调用 set_amap_key 即可启用。用户还没有 Key 时，请提醒 ta：可以用「高德申请 API Key」（amap-apikey）skill 自动去高德控制台申请一个；也可在页面“设置”中切换到演示模式先体验。"
  });
}

export class UnconfiguredMapProvider {
  mode = "unconfigured";

  async searchPlaces() {
    return notConfigured();
  }

  async planRoute() {
    return notConfigured();
  }
}
