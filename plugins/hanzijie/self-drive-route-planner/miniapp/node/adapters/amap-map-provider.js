import { randomUUID } from "node:crypto";

const STRATEGY_CODES = Object.freeze({
  recommended: "32",
  avoid_congestion: "33",
  prefer_highways: "34",
  avoid_highways: "35",
  low_tolls: "36"
});

const STRATEGY_LABELS = Object.freeze({
  recommended: "高德推荐",
  avoid_congestion: "躲避拥堵",
  prefer_highways: "高速优先",
  avoid_highways: "不走高速",
  low_tolls: "少收费"
});

function parseLocation(value) {
  const [longitude, latitude] = String(value ?? "").split(",").map(Number);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { longitude, latitude };
}

function parsePolyline(value) {
  return String(value ?? "")
    .split(";")
    .map(parseLocation)
    .filter(Boolean);
}

function makeUpstreamError(code, message, recovery, status = 502, retryable = false) {
  return Object.assign(new Error(message), { code, recovery, status, retryable });
}

function mapAmapError(payload) {
  if (payload?.infocode === "10001" || payload?.infocode === "10002") {
    return makeUpstreamError(
      "AMAP_AUTH_FAILED",
      "高德 Web 服务 Key 无效或无权访问此接口。",
      "请在页面“设置”中检查高德 Web 服务 Key 的类型、权限与安全配置。"
    );
  }
  if (["10003", "10004", "10044"].includes(payload?.infocode)) {
    return makeUpstreamError(
      "AMAP_QUOTA_EXCEEDED",
      "高德接口调用额度或并发额度已用尽。",
      "请稍后重试，或在高德控制台检查配额。",
      429
    );
  }
  return makeUpstreamError(
    "AMAP_UPSTREAM_ERROR",
    "高德地图服务暂时无法完成请求。",
    "请检查地点信息、网络与高德控制台状态后重试。"
  );
}

export class AmapMapProvider {
  mode = "amap";
  #fetch;
  #key;
  #maxRetries;
  #retryDelayMs;
  #timeoutMs;

  constructor({
    key,
    fetchImplementation = fetch,
    timeoutMs = 8_000,
    maxRetries = 1,
    retryDelayMs = 120
  }) {
    if (!key) throw new Error("AmapMapProvider requires a Web service key");
    this.#key = key;
    this.#fetch = fetchImplementation;
    this.#timeoutMs = timeoutMs;
    this.#maxRetries = Math.max(0, Math.min(2, Number(maxRetries) || 0));
    this.#retryDelayMs = Math.max(0, Number(retryDelayMs) || 0);
  }

  async #request(url) {
    let lastError;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      try {
        return await this.#requestOnce(url);
      } catch (error) {
        lastError = error;
        if (!error.retryable || attempt === this.#maxRetries) throw error;
        if (this.#retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.#retryDelayMs));
        }
      }
    }
    throw lastError;
  }

  async #requestOnce(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    timeout.unref?.();
    try {
      const response = await this.#fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json" }
      });
      if (!response.ok) {
        const retryable =
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500;
        throw makeUpstreamError(
          "AMAP_HTTP_ERROR",
          "高德地图服务返回了异常状态。",
          "请稍后重试。",
          response.status === 429 ? 429 : 502,
          retryable
        );
      }
      const payload = await response.json();
      if (payload?.status !== "1") throw mapAmapError(payload);
      return payload;
    } catch (error) {
      if (error.name === "AbortError") {
        throw makeUpstreamError(
          "UPSTREAM_TIMEOUT",
          "高德地图服务响应超时。",
          "请检查网络后重试。",
          504,
          true
        );
      }
      if (!error.code) {
        throw makeUpstreamError(
          "AMAP_NETWORK_ERROR",
          "暂时无法连接高德地图服务。",
          "请检查网络后重试。",
          502,
          true
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async searchPlaces({ query, city }) {
    const url = new URL("https://restapi.amap.com/v5/place/text");
    url.searchParams.set("key", this.#key);
    url.searchParams.set("keywords", query);
    url.searchParams.set("page_size", "10");
    if (city) url.searchParams.set("region", city);
    const payload = await this.#request(url);
    return (payload.pois ?? []).map((poi) => ({
      id: poi.id,
      poi_id: poi.id,
      name: poi.name,
      city: poi.cityname || poi.pname || "",
      district: poi.adname || "",
      address: poi.address || "",
      location: parseLocation(poi.location),
      provider: "amap",
      is_demo: false
    })).filter((place) => place.location);
  }

  async planRoute(trip) {
    const url = new URL("https://restapi.amap.com/v5/direction/driving");
    url.searchParams.set("key", this.#key);
    url.searchParams.set(
      "origin",
      `${trip.origin.location.longitude},${trip.origin.location.latitude}`
    );
    url.searchParams.set(
      "destination",
      `${trip.destination.location.longitude},${trip.destination.location.latitude}`
    );
    url.searchParams.set(
      "strategy",
      STRATEGY_CODES[trip.preferences.strategy] ?? STRATEGY_CODES.recommended
    );
    url.searchParams.set("show_fields", "cost,navi,polyline");
    const isRealPoiId = (value) => Boolean(value) && !String(value).startsWith("demo-");
    if (isRealPoiId(trip.origin.poi_id)) {
      url.searchParams.set("origin_id", trip.origin.poi_id);
    }
    if (isRealPoiId(trip.destination.poi_id)) {
      url.searchParams.set("destination_id", trip.destination.poi_id);
    }
    if (trip.waypoints.length > 0) {
      url.searchParams.set(
        "waypoints",
        trip.waypoints
          .map((stop) => `${stop.location.longitude},${stop.location.latitude}`)
          .join(";")
      );
    }

    const payload = await this.#request(url);
    const paths = payload.route?.paths ?? [];
    const stops = [trip.origin, ...trip.waypoints, trip.destination];
    return paths.map((path, index) => {
      const geometry = [];
      for (const step of path.steps ?? []) {
        const points = parsePolyline(step.polyline);
        geometry.push(...(geometry.length > 0 ? points.slice(1) : points));
      }
      const totalDistance = Number(path.distance) || 0;
      const totalDuration = Number(path.cost?.duration) || 0;
      return {
        id: randomUUID(),
        trip_revision: trip.revision,
        label:
          index === 0
            ? STRATEGY_LABELS[trip.preferences.strategy] ?? "高德推荐"
            : `备选路线 ${index + 1}`,
        strategy: trip.preferences.strategy,
        provider: "amap",
        is_demo: false,
        distance_meters: totalDistance,
        duration_seconds: totalDuration,
        tolls_yuan: Number(path.cost?.tolls) || 0,
        traffic_lights: Number(path.cost?.traffic_lights) || 0,
        restriction: path.restriction === "1" ? "restricted" : "clear",
        geometry,
        legs: buildLegsFromAmapSteps(path, stops),
        generated_at: new Date().toISOString()
      };
    });
  }
}

function squaredCoordinateDistance(left, right) {
  const longitude = left.longitude - right.longitude;
  const latitude = left.latitude - right.latitude;
  return longitude * longitude + latitude * latitude;
}

function finiteMetric(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sumStepMetric(steps, getter) {
  const values = steps.map(getter);
  if (values.some((value) => value === null)) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function findStepBoundaries(steps, waypoints) {
  const boundaries = [0];
  let minimumBoundary = 0;
  for (let waypointIndex = 0; waypointIndex < waypoints.length; waypointIndex += 1) {
    const maximumBoundary = steps.length - (waypoints.length - waypointIndex);
    let best = { boundary: minimumBoundary, distance: Number.POSITIVE_INFINITY };
    for (let stepIndex = minimumBoundary; stepIndex < steps.length; stepIndex += 1) {
      const points = parsePolyline(steps[stepIndex].polyline);
      points.forEach((point, pointIndex) => {
        const boundary = pointIndex === 0 ? stepIndex : stepIndex + 1;
        if (boundary <= minimumBoundary || boundary > maximumBoundary) return;
        const distance = squaredCoordinateDistance(point, waypoints[waypointIndex].location);
        if (distance < best.distance) best = { boundary, distance };
      });
    }
    if (!Number.isFinite(best.distance)) return null;
    boundaries.push(best.boundary);
    minimumBoundary = best.boundary;
  }
  boundaries.push(steps.length);
  return boundaries;
}

function buildLegsFromAmapSteps(path, stops) {
  if (stops.length === 2) {
    return [
      {
        from_stop_id: stops[0].id,
        to_stop_id: stops[1].id,
        from_name: stops[0].name,
        to_name: stops[1].name,
        distance_meters: finiteMetric(path.distance),
        duration_seconds: finiteMetric(path.cost?.duration)
      }
    ];
  }
  const steps = Array.isArray(path.steps) ? path.steps : [];
  const boundaries = findStepBoundaries(steps, stops.slice(1, -1));
  return stops.slice(0, -1).map((stop, legIndex) => {
    const legSteps = boundaries
      ? steps.slice(boundaries[legIndex], boundaries[legIndex + 1])
      : [];
    return {
      from_stop_id: stop.id,
      to_stop_id: stops[legIndex + 1].id,
      from_name: stop.name,
      to_name: stops[legIndex + 1].name,
      distance_meters:
        legSteps.length > 0
          ? sumStepMetric(legSteps, (step) => finiteMetric(step.step_distance))
          : null,
      duration_seconds:
        legSteps.length > 0
          ? sumStepMetric(legSteps, (step) => finiteMetric(step.cost?.duration))
          : null
    };
  });
}
