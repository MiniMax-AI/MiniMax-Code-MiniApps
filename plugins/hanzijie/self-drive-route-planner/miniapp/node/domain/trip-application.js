import { randomUUID } from "node:crypto";

const DEFAULT_PREFERENCES = Object.freeze({ strategy: "recommended" });
const ROUTE_STRATEGIES = new Set([
  "recommended",
  "avoid_congestion",
  "avoid_highways",
  "low_tolls",
  "prefer_highways"
]);

function normalizeLocation(location) {
  const longitude = Number(location?.longitude);
  const latitude = Number(location?.latitude);
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw new DomainError(
      "INVALID_LOCATION",
      "地点必须包含有效的经度 longitude 和纬度 latitude。",
      { recovery: "请从地点搜索候选项中选择，或检查经纬度字段是否写反。" }
    );
  }
  return { longitude, latitude };
}

function normalizeDepartAt(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DomainError("INVALID_DEPART_AT", "出发时间格式无效。", {
      recovery: "请使用 ISO 8601 时间，例如 2026-10-01T08:30:00+08:00。"
    });
  }
  return date.toISOString();
}

function normalizeStop(stop, role, existingId) {
  if (!stop || typeof stop !== "object") {
    throw new DomainError("INVALID_STOP", "站点内容无效。");
  }
  const name = String(stop.name ?? "").trim();
  if (!name) {
    throw new DomainError("INVALID_STOP", "站点名称不能为空。");
  }
  return {
    id:
      (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(stop.id ?? "")
      )
        ? stop.id
        : existingId ?? randomUUID()),
    role,
    name,
    address: String(stop.address ?? "").trim(),
    poi_id: stop.poi_id ? String(stop.poi_id) : null,
    location: normalizeLocation(stop.location),
    note: String(stop.note ?? "").trim(),
    // 从该点出发的时间（起点/途经点有意义）；到达时间与停留时长由系统按
    // 「上一点出发时间 + 该段行车耗时」推算，不作为存储字段。
    depart_at: normalizeDepartAt(stop.depart_at),
    stay_minutes:
      stop.stay_minutes === null || stop.stay_minutes === undefined
        ? null
        : Math.max(0, Math.round(Number(stop.stay_minutes)))
  };
}

// 只有会影响算路结果的字段（坐标、POI、顺序）才需要作废已有路线；
// 备注、停留时长、名称、地址等展示性字段的修改保留现有路线。
function stopRouteSignature(stop) {
  if (!stop) return "∅";
  return `${stop.poi_id ?? ""}@${stop.location.longitude},${stop.location.latitude}`;
}

export class DomainError extends Error {
  constructor(code, message, { status = 400, recovery, details } = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
    this.recovery = recovery;
    this.details = details;
  }
}

export class TripApplication {
  #clock;
  #events;
  #mapProvider;
  #recalculateDebounceMs;
  #recalculateTimers = new Map();
  #routeRequests = new Map();
  #store;

  constructor({
    store,
    mapProvider,
    events = { publish() {} },
    clock = () => new Date(),
    recalculateDebounceMs = 400
  }) {
    this.#store = store;
    this.#mapProvider = mapProvider;
    this.#events = events;
    this.#clock = clock;
    this.#recalculateDebounceMs = recalculateDebounceMs;
  }

  createTrip({ name = "未命名自驾行程", source = "ui" } = {}) {
    const now = this.#clock().toISOString();
    const trip = {
      id: randomUUID(),
      name: String(name).trim() || "未命名自驾行程",
      origin: null,
      destination: null,
      waypoints: [],
      preferences: { ...DEFAULT_PREFERENCES },
      auto_recalculate: true,
      route_options: [],
      selected_route_id: null,
      route_status: "empty",
      route_error: null,
      last_successful_route_at: null,
      revision: 1,
      created_at: now,
      updated_at: now
    };

    this.#store.saveTrip(trip);
    this.#store.setActiveTripId(trip.id);
    this.#store.appendAudit({
      id: randomUUID(),
      trip_id: trip.id,
      source,
      action: "trip_create",
      summary: `创建行程“${trip.name}”`,
      before_revision: null,
      after_revision: trip.revision,
      created_at: now
    });
    return structuredClone(trip);
  }

  getTrip(tripId) {
    const trip = this.#store.getTrip(tripId);
    if (!trip) {
      throw new DomainError("TRIP_NOT_FOUND", "没有找到这个行程。", {
        status: 404,
        recovery: "请刷新行程列表并确认行程 ID。"
      });
    }
    return trip;
  }

  getActiveTrip() {
    const tripId = this.#store.getActiveTripId();
    if (!tripId) {
      throw new DomainError("NO_ACTIVE_TRIP", "当前没有活动行程。", {
        status: 404,
        recovery: "请先创建一个行程。"
      });
    }
    return this.getTrip(tripId);
  }

  listTrips() {
    return this.#store.listTrips();
  }

  async searchPlaces({ query, city }) {
    const normalizedQuery = String(query ?? "").trim();
    if (normalizedQuery.length < 2) {
      throw new DomainError("SEARCH_QUERY_TOO_SHORT", "地点关键词至少需要 2 个字符。" );
    }
    const results = await this.#mapProvider.searchPlaces({
      query: normalizedQuery,
      city: String(city ?? "").trim()
    });
    return {
      provider: this.#mapProvider.mode,
      query: normalizedQuery,
      results
    };
  }

  patchTrip({ tripId, expectedRevision, patch, source = "ui", action = "trip_update" }) {
    const current = this.getTrip(tripId);
    if (!Number.isInteger(expectedRevision)) {
      throw new DomainError(
        "EXPECTED_REVISION_REQUIRED",
        "修改行程时必须提供 expected_revision。",
        { recovery: "请先读取最新行程，再携带其 revision 重试。" }
      );
    }
    if (current.revision !== expectedRevision) {
      throw new DomainError("REVISION_CONFLICT", "行程已经被其他操作修改。", {
        status: 409,
        recovery: "请读取最新行程并基于新修订号重新应用修改。",
        details: {
          expected_revision: expectedRevision,
          latest_revision: current.revision,
          latest_updated_at: current.updated_at
        }
      });
    }

    const next = structuredClone(current);
    const changedFields = [];
    let routeInputsChanged = false;

    if (Object.hasOwn(patch, "name")) {
      const name = String(patch.name ?? "").trim();
      if (!name) throw new DomainError("INVALID_NAME", "行程名称不能为空。");
      if (name !== next.name) {
        next.name = name;
        changedFields.push("name");
      }
    }

    for (const role of ["origin", "destination"]) {
      if (!Object.hasOwn(patch, role)) continue;
      const value = patch[role];
      const beforeSignature = stopRouteSignature(current[role]);
      next[role] = value === null ? null : normalizeStop(value, role, current[role]?.id);
      changedFields.push(role);
      if (stopRouteSignature(next[role]) !== beforeSignature) {
        routeInputsChanged = true;
      }
    }

    if (Object.hasOwn(patch, "waypoints")) {
      if (!Array.isArray(patch.waypoints)) {
        throw new DomainError("INVALID_WAYPOINTS", "途经点必须是数组。");
      }
      if (patch.waypoints.length > 16) {
        throw new DomainError("WAYPOINT_LIMIT_EXCEEDED", "最多支持 16 个途经点。", {
          recovery: "请减少途经点，或把长途行程拆成多段。"
        });
      }
      const beforeSignature = current.waypoints.map(stopRouteSignature).join(";");
      next.waypoints = patch.waypoints.map((stop, index) =>
        normalizeStop(stop, "waypoint", current.waypoints[index]?.id)
      );
      changedFields.push("waypoints");
      if (next.waypoints.map(stopRouteSignature).join(";") !== beforeSignature) {
        routeInputsChanged = true;
      }
    }

    if (Object.hasOwn(patch, "preferences")) {
      const strategy = patch.preferences?.strategy;
      if (!ROUTE_STRATEGIES.has(strategy)) {
        throw new DomainError("INVALID_PREFERENCES", "不支持这个路线偏好。", {
          details: { allowed_strategies: [...ROUTE_STRATEGIES] }
        });
      }
      next.preferences = { strategy };
      changedFields.push("preferences");
      routeInputsChanged = true;
    }

    if (Object.hasOwn(patch, "auto_recalculate")) {
      if (typeof patch.auto_recalculate !== "boolean") {
        throw new DomainError("INVALID_AUTO_RECALCULATE", "自动重算开关必须是布尔值。" );
      }
      next.auto_recalculate = patch.auto_recalculate;
      changedFields.push("auto_recalculate");
    }

    if (changedFields.length === 0) return current;

    if (routeInputsChanged) {
      next.route_status = current.route_options.length > 0 ? "stale" : "dirty";
      next.route_error = null;
      next.selected_route_id = null;
    }
    next.revision += 1;
    next.updated_at = this.#clock().toISOString();

    this.#store.saveTrip(next);
    this.#store.setActiveTripId(next.id);
    this.#store.appendAudit({
      id: randomUUID(),
      trip_id: next.id,
      source,
      action,
      summary: `更新了${changedFields.join("、")}`,
      before_revision: current.revision,
      after_revision: next.revision,
      created_at: next.updated_at
    });
    this.#events.publish("trip.updated", next, {
      changed_fields: changedFields,
      trip: structuredClone(next)
    });
    if (routeInputsChanged && next.auto_recalculate && next.origin && next.destination) {
      this.#scheduleRecalculation(next.id, next.revision);
    }
    return next;
  }

  recalculateRoute({ tripId, expectedRevision, source = "ui" }) {
    const current = this.getTrip(tripId);
    if (current.revision !== expectedRevision) {
      throw new DomainError("REVISION_CONFLICT", "行程已经被其他操作修改。", {
        status: 409,
        recovery: "请读取最新行程并使用新的修订号重新规划。",
        details: {
          expected_revision: expectedRevision,
          latest_revision: current.revision
        }
      });
    }
    if (!current.origin || !current.destination) {
      throw new DomainError("ENDPOINTS_REQUIRED", "规划路线前必须设置起点和终点。", {
        recovery: "请先选择明确的起点和终点。"
      });
    }

    const requestKey = `${tripId}:${expectedRevision}`;
    const existingRequest = this.#routeRequests.get(requestKey);
    if (existingRequest) return existingRequest.promise;

    const entry = { promise: null };
    entry.promise = this.#performRouteRecalculation({
      tripId,
      expectedRevision,
      source,
      current
    });
    this.#routeRequests.set(requestKey, entry);
    entry.promise.then(
      () => {
        if (this.#routeRequests.get(requestKey) === entry) {
          this.#routeRequests.delete(requestKey);
        }
      },
      () => {
        if (this.#routeRequests.get(requestKey) === entry) {
          this.#routeRequests.delete(requestKey);
        }
      }
    );
    return entry.promise;
  }

  async #performRouteRecalculation({ tripId, expectedRevision, source, current }) {
    const pendingTimer = this.#recalculateTimers.get(tripId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.#recalculateTimers.delete(tripId);
    }

    const planning = {
      ...structuredClone(current),
      route_status: "planning",
      route_error: null,
      updated_at: this.#clock().toISOString()
    };
    this.#store.saveTrip(planning);
    this.#events.publish("route.planning", planning, {
      trip: structuredClone(planning)
    });

    try {
      const routeOptions = await this.#mapProvider.planRoute(structuredClone(current));
      const latest = this.getTrip(tripId);
      if (latest.revision !== current.revision) {
        throw new DomainError(
          "ROUTE_SUPERSEDED",
          "这次算路对应的行程已经过期，结果未被保存。",
          { status: 409, recovery: "请按最新行程重新规划。" }
        );
      }
      if (!Array.isArray(routeOptions) || routeOptions.length === 0) {
        throw new DomainError("NO_ROUTE", "没有找到可用的驾车路线。", {
          status: 502,
          recovery: "请检查站点坐标，或稍后重试。"
        });
      }

      const ready = {
        ...latest,
        route_options: routeOptions,
        selected_route_id: routeOptions[0].id,
        route_status: "ready",
        route_error: null,
        last_successful_route_at: routeOptions[0].generated_at,
        updated_at: this.#clock().toISOString()
      };
      this.#store.saveTrip(ready);
      this.#store.appendAudit({
        id: randomUUID(),
        trip_id: ready.id,
        source,
        action: "route_recalculate",
        summary: `生成 ${routeOptions.length} 条候选路线`,
        before_revision: ready.revision,
        after_revision: ready.revision,
        created_at: ready.updated_at
      });
      this.#events.publish("route.updated", ready, {
        trip: structuredClone(ready),
        option_count: routeOptions.length
      });
      return ready;
    } catch (error) {
      const domainError =
        error instanceof DomainError
          ? error
          : new DomainError(
              error.code ?? "MAP_PROVIDER_ERROR",
              error.message ?? "地图服务暂时不可用。",
              {
                status: error.status ?? 502,
                recovery: error.recovery ?? "请稍后重试。"
              }
            );
      const latest = this.getTrip(tripId);
      if (
        latest.revision === current.revision &&
        domainError.code !== "ROUTE_SUPERSEDED"
      ) {
        const failed = {
          ...latest,
          route_status: "failed",
          route_error: {
            code: domainError.code,
            message: domainError.message,
            recovery: domainError.recovery
          },
          updated_at: this.#clock().toISOString()
        };
        this.#store.saveTrip(failed);
        this.#events.publish("route.failed", failed, {
          trip: structuredClone(failed),
          error: failed.route_error
        });
      }
      throw domainError;
    }
  }

  selectRoute({ tripId, expectedRevision, routeId, source = "ui" }) {
    const current = this.getTrip(tripId);
    if (current.revision !== expectedRevision) {
      throw new DomainError("REVISION_CONFLICT", "行程已经被其他操作修改。", {
        status: 409,
        recovery: "请读取最新行程并重新选择路线。",
        details: {
          expected_revision: expectedRevision,
          latest_revision: current.revision
        }
      });
    }
    const selected = current.route_options.find((option) => option.id === routeId);
    if (!selected) {
      throw new DomainError("ROUTE_OPTION_NOT_FOUND", "候选路线已不存在或已经过期。", {
        recovery: "请读取最新候选路线，必要时重新规划。"
      });
    }
    const nextRevision = current.revision + 1;
    const next = {
      ...structuredClone(current),
      revision: nextRevision,
      route_options: current.route_options.map((option) => ({
        ...option,
        trip_revision: nextRevision
      })),
      selected_route_id: selected.id,
      updated_at: this.#clock().toISOString()
    };
    this.#store.saveTrip(next);
    this.#store.appendAudit({
      id: randomUUID(),
      trip_id: next.id,
      source,
      action: "route_select",
      summary: `选择路线“${selected.label}”`,
      before_revision: current.revision,
      after_revision: next.revision,
      created_at: next.updated_at
    });
    this.#events.publish("route.selected", next, {
      route_id: selected.id,
      trip: structuredClone(next)
    });
    return next;
  }

  requestMapFocus({ tripId, target, source = "mcp" }) {
    const trip = this.getTrip(tripId);
    this.#events.publish("ui.focus.requested", trip, { target, source });
    this.#store.appendAudit({
      id: randomUUID(),
      trip_id: trip.id,
      source,
      action: "map_focus",
      summary: `请求地图聚焦${target.type}`,
      before_revision: trip.revision,
      after_revision: trip.revision,
      created_at: this.#clock().toISOString()
    });
    return trip;
  }

  recordAudit({ tripId, source = "mcp", action, summary }) {
    const trip = this.getTrip(tripId);
    const entry = {
      id: randomUUID(),
      trip_id: trip.id,
      source,
      action,
      summary,
      before_revision: trip.revision,
      after_revision: trip.revision,
      created_at: this.#clock().toISOString()
    };
    this.#store.appendAudit(entry);
    this.#events.publish("audit.updated", trip, { audit_entry: entry });
    return entry;
  }

  exportTrip(tripId) {
    const trip = this.getTrip(tripId);
    return {
      format: "self-drive-trip/v1",
      exported_at: this.#clock().toISOString(),
      trip,
      audit: this.#store.listAudit(tripId, 100)
    };
  }

  #scheduleRecalculation(tripId, revision) {
    const previousTimer = this.#recalculateTimers.get(tripId);
    if (previousTimer) clearTimeout(previousTimer);
    const timer = setTimeout(async () => {
      this.#recalculateTimers.delete(tripId);
      try {
        await this.recalculateRoute({
          tripId,
          expectedRevision: revision,
          source: "system"
        });
      } catch {
        // The failed or superseded state is already persisted and published.
      }
    }, this.#recalculateDebounceMs);
    timer.unref?.();
    this.#recalculateTimers.set(tripId, timer);
  }

  close() {
    for (const timer of this.#recalculateTimers.values()) clearTimeout(timer);
    this.#recalculateTimers.clear();
    this.#routeRequests.clear();
  }

  getAudit(tripId, limit) {
    this.getTrip(tripId);
    return this.#store.listAudit(tripId, limit);
  }
}
