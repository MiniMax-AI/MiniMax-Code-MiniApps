import { randomUUID } from "node:crypto";

import { DomainError } from "../domain/trip-application.js";

const SERVER_INFO = { name: "self-drive-route-planner", version: "0.8.0" };

const LOCATION_SCHEMA = {
  type: "object",
  properties: {
    longitude: { type: "number", minimum: -180, maximum: 180 },
    latitude: { type: "number", minimum: -90, maximum: 90 }
  },
  required: ["longitude", "latitude"],
  additionalProperties: false
};

const PLACE_PROPERTIES = {
  id: { type: "string" },
  poi_id: { type: ["string", "null"] },
  name: { type: "string", minLength: 1 },
  address: { type: "string" },
  location: LOCATION_SCHEMA,
  note: { type: "string" },
  depart_at: { type: ["string", "null"] },
  stay_minutes: { type: ["integer", "null"], minimum: 0 }
};

const PLACE_SCHEMA = {
  type: "object",
  properties: PLACE_PROPERTIES,
  required: ["name", "location"],
  additionalProperties: false
};

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
};
const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

function tool(name, title, description, inputSchema, annotations) {
  return { name, title, description, inputSchema, annotations };
}

const TOOLS = [
  tool(
    "trip_create",
    "创建自驾行程",
    "创建一个新的活动行程并返回初始修订号。",
    {
      type: "object",
      properties: { name: { type: "string", minLength: 1, maxLength: 120 } },
      required: ["name"],
      additionalProperties: false
    },
    WRITE_ANNOTATIONS
  ),
  tool(
    "trip_get",
    "读取行程",
    "读取指定行程；省略 trip_id 时读取当前活动行程。",
    {
      type: "object",
      properties: { trip_id: { type: "string", format: "uuid" } },
      additionalProperties: false
    },
    READ_ANNOTATIONS
  ),
  tool(
    "place_search",
    "搜索明确地点",
    "按关键词与可选城市搜索高德 POI 候选；写入站点前应先调用。",
    {
      type: "object",
      properties: {
        query: { type: "string", minLength: 2, maxLength: 80 },
        city: { type: "string", maxLength: 40 }
      },
      required: ["query"],
      additionalProperties: false
    },
    READ_ANNOTATIONS
  ),
  tool(
    "trip_set_endpoint",
    "设置起点或终点",
    "设置或替换行程的起点/终点，需要最新修订号。起点的 place 可带 depart_at（ISO 8601 出发时间），作为整条时间线的起点。",
    {
      type: "object",
      properties: {
        trip_id: { type: "string", format: "uuid" },
        endpoint: { type: "string", enum: ["origin", "destination"] },
        place: PLACE_SCHEMA,
        expected_revision: { type: "integer", minimum: 1 }
      },
      required: ["trip_id", "endpoint", "place", "expected_revision"],
      additionalProperties: false
    },
    WRITE_ANNOTATIONS
  ),
  tool(
    "trip_add_waypoint",
    "添加途经点",
    "把明确地点加入途经点列表，可指定从 0 开始的位置。",
    {
      type: "object",
      properties: {
        trip_id: { type: "string", format: "uuid" },
        place: PLACE_SCHEMA,
        position: { type: "integer", minimum: 0, maximum: 16 },
        expected_revision: { type: "integer", minimum: 1 }
      },
      required: ["trip_id", "place", "expected_revision"],
      additionalProperties: false
    },
    WRITE_ANNOTATIONS
  ),
  tool(
    "trip_update_waypoint",
    "修改途经点",
    "按途经点 ID 修改地点、备注或从该点出发的时间（depart_at，ISO 8601）。到达时间与停留时长由页面按路线耗时自动推算。",
    {
      type: "object",
      properties: {
        trip_id: { type: "string", format: "uuid" },
        waypoint_id: { type: "string" },
        patch: {
          type: "object",
          properties: PLACE_PROPERTIES,
          minProperties: 1,
          additionalProperties: false
        },
        expected_revision: { type: "integer", minimum: 1 }
      },
      required: ["trip_id", "waypoint_id", "patch", "expected_revision"],
      additionalProperties: false
    },
    WRITE_ANNOTATIONS
  ),
  tool(
    "trip_remove_waypoint",
    "删除途经点",
    "按途经点 ID 删除一个途经点。",
    {
      type: "object",
      properties: {
        trip_id: { type: "string", format: "uuid" },
        waypoint_id: { type: "string" },
        expected_revision: { type: "integer", minimum: 1 }
      },
      required: ["trip_id", "waypoint_id", "expected_revision"],
      additionalProperties: false
    },
    { ...WRITE_ANNOTATIONS, destructiveHint: true }
  ),
  tool(
    "trip_reorder_waypoints",
    "重排途经点",
    "用完整的途经点 ID 列表重新排序。",
    {
      type: "object",
      properties: {
        trip_id: { type: "string", format: "uuid" },
        waypoint_ids: {
          type: "array",
          items: { type: "string" },
          maxItems: 16
        },
        expected_revision: { type: "integer", minimum: 1 }
      },
      required: ["trip_id", "waypoint_ids", "expected_revision"],
      additionalProperties: false
    },
    WRITE_ANNOTATIONS
  ),
  tool(
    "trip_set_preferences",
    "设置路线偏好",
    "设置人类可读的驾车路线偏好。",
    {
      type: "object",
      properties: {
        trip_id: { type: "string", format: "uuid" },
        strategy: {
          type: "string",
          enum: [
            "recommended",
            "avoid_congestion",
            "avoid_highways",
            "low_tolls",
            "prefer_highways"
          ]
        },
        expected_revision: { type: "integer", minimum: 1 }
      },
      required: ["trip_id", "strategy", "expected_revision"],
      additionalProperties: false
    },
    WRITE_ANNOTATIONS
  ),
  tool(
    "route_recalculate",
    "重新规划路线",
    "对指定行程修订显式重新算路，并返回候选方案。",
    {
      type: "object",
      properties: {
        trip_id: { type: "string", format: "uuid" },
        expected_revision: { type: "integer", minimum: 1 }
      },
      required: ["trip_id", "expected_revision"],
      additionalProperties: false
    },
    { ...WRITE_ANNOTATIONS, idempotentHint: true }
  ),
  tool(
    "route_select",
    "选择候选路线",
    "选择当前修订的一条候选路线并同步到地图。",
    {
      type: "object",
      properties: {
        trip_id: { type: "string", format: "uuid" },
        route_id: { type: "string" },
        expected_revision: { type: "integer", minimum: 1 }
      },
      required: ["trip_id", "route_id", "expected_revision"],
      additionalProperties: false
    },
    WRITE_ANNOTATIONS
  ),
  tool(
    "map_focus",
    "聚焦地图",
    "请求已打开页面聚焦站点、候选路线或整条行程。",
    {
      type: "object",
      properties: {
        trip_id: { type: "string", format: "uuid" },
        target: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["trip", "stop", "route"] },
            id: { type: "string" }
          },
          required: ["type"],
          additionalProperties: false
        }
      },
      required: ["trip_id", "target"],
      additionalProperties: false
    },
    { ...WRITE_ANNOTATIONS, idempotentHint: true }
  ),
  tool(
    "map_open",
    "打开实时路线地图",
    "说明如何打开自驾规划地图页面。页面由 MiniMax Code 的 Mini App 面板托管。",
    { type: "object", properties: {}, additionalProperties: false },
    { ...WRITE_ANNOTATIONS, idempotentHint: true }
  ),
  tool(
    "trip_export",
    "导出行程",
    "以结构化 JSON 导出行程与审计记录。",
    {
      type: "object",
      properties: { trip_id: { type: "string", format: "uuid" } },
      required: ["trip_id"],
      additionalProperties: false
    },
    READ_ANNOTATIONS
  ),
  tool(
    "set_amap_key",
    "设置高德 Key",
    "保存高德 Key 并自动切换到真实数据模式：同一个 Key 用于地点搜索、驾车算路与页面地图图面，保存后立即在线验证。Key 只保存在本机数据目录，不会出现在返回值中。",
    {
      type: "object",
      properties: { key: { type: "string", minLength: 8, maxLength: 128 } },
      required: ["key"],
      additionalProperties: false
    },
    { ...WRITE_ANNOTATIONS, idempotentHint: true }
  )
];

const TOOLS_BY_NAME = new Map(TOOLS.map((definition) => [definition.name, definition]));

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function acceptsType(expected, value) {
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "object") {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  if (expected === "array") return Array.isArray(value);
  if (expected === "null") return value === null;
  return typeof value === expected;
}

function validateSchema(schema, value, path = "arguments", issues = []) {
  const expectedTypes = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : [];
  if (
    expectedTypes.length > 0 &&
    !expectedTypes.some((expected) => acceptsType(expected, value))
  ) {
    issues.push(
      `${path} 必须是 ${expectedTypes.join(" 或 ")}，当前是 ${valueType(value)}`
    );
    return issues;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    issues.push(`${path} 必须是以下值之一：${schema.enum.join("、")}`);
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      issues.push(`${path} 至少需要 ${schema.minLength} 个字符`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      issues.push(`${path} 最多允许 ${schema.maxLength} 个字符`);
    }
    if (
      schema.format === "uuid" &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value
      )
    ) {
      issues.push(`${path} 必须是有效的 UUID`);
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) {
      issues.push(`${path} 不能小于 ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      issues.push(`${path} 不能大于 ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      issues.push(`${path} 至少需要 ${schema.minItems} 项`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      issues.push(`${path} 最多允许 ${schema.maxItems} 项`);
    }
    if (schema.items) {
      value.forEach((item, index) =>
        validateSchema(schema.items, item, `${path}[${index}]`, issues)
      );
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    for (const requiredName of schema.required ?? []) {
      if (!Object.hasOwn(value, requiredName)) {
        issues.push(`${path}.${requiredName} 是必填字段`);
      }
    }
    if (
      schema.minProperties !== undefined &&
      Object.keys(value).length < schema.minProperties
    ) {
      issues.push(`${path} 至少需要 ${schema.minProperties} 个字段`);
    }
    for (const [key, childValue] of Object.entries(value)) {
      if (properties[key]) {
        validateSchema(properties[key], childValue, `${path}.${key}`, issues);
      } else if (schema.additionalProperties === false) {
        issues.push(`${path}.${key} 不是允许的字段`);
      }
    }
  }
  return issues;
}

function validateToolArguments(name, args) {
  const definition = TOOLS_BY_NAME.get(name);
  if (!definition) {
    throw new DomainError("TOOL_NOT_FOUND", `未知工具：${name || "（空）"}`, {
      recovery: "请先调用 tools/list，并使用返回的工具名称。"
    });
  }
  const issues = validateSchema(definition.inputSchema, args);
  if (issues.length > 0) {
    throw new DomainError(
      "INVALID_TOOL_ARGUMENTS",
      `工具“${name}”参数不正确：${issues[0]}`,
      {
        recovery: "请按 tools/list 返回的 inputSchema 补全或修正参数后重试。",
        details: { issues }
      }
    );
  }
}

function success(summary, data = {}) {
  const structuredContent = { ok: true, summary, ...data };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent
  };
}

function writeResult(trip, summary, changedFields = []) {
  return success(summary, {
    trip_id: trip.id,
    revision: trip.revision,
    changed_fields: changedFields,
    route_status: trip.route_status,
    trip
  });
}

function failure(error) {
  const structuredContent = {
    ok: false,
    summary: error.message ?? "操作失败。",
    error: {
      code: error.code ?? "INTERNAL_ERROR",
      message: error.message ?? "操作失败。",
      recovery: error.recovery ?? "请读取最新状态后重试。",
      ...(error.details ? { details: error.details } : {})
    }
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent
  };
}

function requireWaypoint(trip, waypointId) {
  const index = trip.waypoints.findIndex((waypoint) => waypoint.id === waypointId);
  if (index < 0) {
    throw new DomainError("WAYPOINT_NOT_FOUND", "没有找到指定途经点。", {
      recovery: "请读取最新行程并使用途经点的 id。"
    });
  }
  return index;
}

function readResource(trips, uri) {
  let trip;
  let value;
  if (uri === "trip://active") {
    trip = trips.getActiveTrip();
    value = trip;
    trips.recordAudit({
      tripId: trip.id,
      source: "mcp",
      action: "resource_read_active_trip",
      summary: `AI 读取活动行程资源“${trip.name}”`
    });
  } else {
    const routeMatch = uri.match(/^trip:\/\/([^/]+)\/route$/);
    const tripMatch = uri.match(/^trip:\/\/([^/]+)$/);
    const tripId = decodeURIComponent(routeMatch?.[1] ?? tripMatch?.[1] ?? "");
    if (!tripId) {
      throw new DomainError("RESOURCE_NOT_FOUND", "没有找到这个 MCP 资源。", {
        recovery: "请使用 resources/list 或 resources/templates/list 返回的 URI。"
      });
    }
    trip = trips.getTrip(tripId);
    if (routeMatch) {
      value = {
        trip_id: trip.id,
        revision: trip.revision,
        route_status: trip.route_status,
        selected_route_id: trip.selected_route_id,
        route_options: trip.route_options
      };
      trips.recordAudit({
        tripId: trip.id,
        source: "mcp",
        action: "resource_read_route",
        summary: `AI 读取行程“${trip.name}”的候选路线`
      });
    } else {
      value = trip;
      trips.recordAudit({
        tripId: trip.id,
        source: "mcp",
        action: "resource_read_trip",
        summary: `AI 读取行程资源“${trip.name}”`
      });
    }
  }
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

async function callTool({ trips, settings }, name, args) {
  switch (name) {
    case "set_amap_key": {
      const status = await settings.setAmapKey(args.key);
      const verified = status.verify?.ok === true;
      const summary = verified
        ? `高德 Key 已保存并通过在线验证（示例搜索返回 ${status.verify.sample_count} 条），真实搜索与算路已启用`
        : status.verify
          ? `高德 Key 已保存，但在线验证未通过：${status.verify.message}`
          : "高德 Key 已保存";
      return success(summary, {
        map: status.map,
        verify: status.verify,
        hint: "已打开的自驾规划页面刷新后会加载真实地图图面。"
      });
    }
    case "map_open": {
      return success("自驾规划地图作为 MiniMax Code Mini App 运行", {
        opened: false,
        hint: "请在 MiniMax Code 会话的 Mini App 面板中打开“自驾规划”，页面会实时同步行程。"
      });
    }
    case "trip_create": {
      const trip = trips.createTrip({ name: args.name, source: "mcp" });
      return success(`已创建行程“${trip.name}”`, {
        trip_id: trip.id,
        revision: trip.revision,
        trip
      });
    }
    case "trip_get": {
      const trip = args.trip_id ? trips.getTrip(args.trip_id) : trips.getActiveTrip();
      trips.recordAudit({
        tripId: trip.id,
        source: "mcp",
        action: "trip_get",
        summary: `AI 读取行程“${trip.name}”`
      });
      return success(`已读取行程“${trip.name}”`, {
        trip_id: trip.id,
        revision: trip.revision,
        trip
      });
    }
    case "place_search": {
      const result = await trips.searchPlaces({ query: args.query, city: args.city });
      return success(`找到 ${result.results.length} 个地点候选`, result);
    }
    case "trip_set_endpoint": {
      const trip = trips.patchTrip({
        tripId: args.trip_id,
        expectedRevision: args.expected_revision,
        patch: { [args.endpoint]: args.place },
        source: "mcp",
        action: "trip_set_endpoint"
      });
      return writeResult(
        trip,
        `已设置${args.endpoint === "origin" ? "起点" : "终点"}“${args.place.name}”`,
        [args.endpoint]
      );
    }
    case "trip_add_waypoint": {
      const current = trips.getTrip(args.trip_id);
      const insertionIndex = args.position ?? current.waypoints.length;
      if (insertionIndex > current.waypoints.length) {
        throw new DomainError("INVALID_WAYPOINT_POSITION", "途经点插入位置超出范围。", {
          details: { waypoint_count: current.waypoints.length }
        });
      }
      const waypoints = [...current.waypoints];
      waypoints.splice(insertionIndex, 0, { ...args.place, id: randomUUID() });
      const trip = trips.patchTrip({
        tripId: args.trip_id,
        expectedRevision: args.expected_revision,
        patch: { waypoints },
        source: "mcp",
        action: "trip_add_waypoint"
      });
      return writeResult(
        trip,
        `已在第 ${insertionIndex + 1} 站加入“${args.place.name}”`,
        ["waypoints"]
      );
    }
    case "trip_update_waypoint": {
      const current = trips.getTrip(args.trip_id);
      const index = requireWaypoint(current, args.waypoint_id);
      const waypoints = current.waypoints.map((waypoint, waypointIndex) =>
        waypointIndex === index ? { ...waypoint, ...args.patch } : waypoint
      );
      const trip = trips.patchTrip({
        tripId: args.trip_id,
        expectedRevision: args.expected_revision,
        patch: { waypoints },
        source: "mcp",
        action: "trip_update_waypoint"
      });
      return writeResult(trip, `已更新途经点“${trip.waypoints[index].name}”`, [
        "waypoints"
      ]);
    }
    case "trip_remove_waypoint": {
      const current = trips.getTrip(args.trip_id);
      const index = requireWaypoint(current, args.waypoint_id);
      const [removed] = current.waypoints.splice(index, 1);
      const trip = trips.patchTrip({
        tripId: args.trip_id,
        expectedRevision: args.expected_revision,
        patch: { waypoints: current.waypoints },
        source: "mcp",
        action: "trip_remove_waypoint"
      });
      return writeResult(trip, `已删除途经点“${removed.name}”`, ["waypoints"]);
    }
    case "trip_reorder_waypoints": {
      const current = trips.getTrip(args.trip_id);
      const currentIds = new Set(current.waypoints.map((waypoint) => waypoint.id));
      const waypointIds = args.waypoint_ids;
      if (
        waypointIds.length !== current.waypoints.length ||
        new Set(waypointIds).size !== waypointIds.length ||
        waypointIds.some((id) => !currentIds.has(id))
      ) {
        throw new DomainError(
          "INVALID_WAYPOINT_ORDER",
          "重排列表必须且只能包含当前所有途经点 ID。",
          { recovery: "请读取最新行程后重新生成完整 ID 列表。" }
        );
      }
      const byId = new Map(
        current.waypoints.map((waypoint) => [waypoint.id, waypoint])
      );
      const trip = trips.patchTrip({
        tripId: args.trip_id,
        expectedRevision: args.expected_revision,
        patch: { waypoints: waypointIds.map((id) => byId.get(id)) },
        source: "mcp",
        action: "trip_reorder_waypoints"
      });
      return writeResult(trip, "已重排途经点", ["waypoints"]);
    }
    case "trip_set_preferences": {
      const trip = trips.patchTrip({
        tripId: args.trip_id,
        expectedRevision: args.expected_revision,
        patch: { preferences: { strategy: args.strategy } },
        source: "mcp",
        action: "trip_set_preferences"
      });
      return writeResult(trip, `已设置路线偏好为 ${args.strategy}`, ["preferences"]);
    }
    case "route_recalculate": {
      const trip = await trips.recalculateRoute({
        tripId: args.trip_id,
        expectedRevision: args.expected_revision,
        source: "mcp"
      });
      return writeResult(trip, `已生成 ${trip.route_options.length} 条候选路线`, [
        "route_options"
      ]);
    }
    case "route_select": {
      const trip = trips.selectRoute({
        tripId: args.trip_id,
        expectedRevision: args.expected_revision,
        routeId: args.route_id,
        source: "mcp"
      });
      return writeResult(trip, "已选择候选路线", ["selected_route_id"]);
    }
    case "map_focus": {
      const trip = trips.requestMapFocus({
        tripId: args.trip_id,
        target: args.target,
        source: "mcp"
      });
      return success("已向打开的地图发送聚焦请求", {
        trip_id: trip.id,
        revision: trip.revision,
        target: args.target
      });
    }
    case "trip_export": {
      const exported = trips.exportTrip(args.trip_id);
      trips.recordAudit({
        tripId: args.trip_id,
        source: "mcp",
        action: "trip_export",
        summary: `AI 导出行程“${exported.trip.name}”`
      });
      return success("已导出行程 JSON", {
        trip_id: args.trip_id,
        revision: exported.trip.revision,
        export: exported
      });
    }
    default:
      throw new DomainError("TOOL_NOT_FOUND", `未知工具：${name}`);
  }
}

async function handleMessage(services, message) {
  const { trips } = services;
  if (!message || typeof message !== "object" || message.id === undefined) {
    return null; // Notification 或响应：Streamable HTTP 下直接 202。
  }
  if (message.method === "initialize") {
    // 连接时就让 AI 感知高德状态，未连接直接给出申请与配置路径。
    const mapMode = services.settings?.mapMode?.();
    const amapNote =
      mapMode === "amap"
        ? "高德已连接，真实搜索与算路可用。"
        : mapMode === "demo"
          ? "当前为演示模式：搜索与算路返回明确标注的本地演示数据。"
          : "注意：高德未连接，place_search、route_recalculate 等真实数据工具会返回 MAP_NOT_CONFIGURED。请提醒用户配置高德 Key——用户还没有 Key 时，可用「高德申请 API Key」（amap-apikey）skill 自动去高德控制台申请，拿到后调用 set_amap_key 配置。";
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2025-11-25",
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false }
        },
        serverInfo: SERVER_INFO,
        instructions: `先读取行程及 revision，再执行写操作。所有写操作携带 expected_revision；地点必须先通过 place_search 明确选择。地图页面由 MiniMax Code 的 Mini App 面板托管，修改会实时同步。${amapNote}`
      }
    };
  }
  if (message.method === "ping") {
    return { jsonrpc: "2.0", id: message.id, result: {} };
  }
  if (message.method === "tools/list") {
    return { jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } };
  }
  if (message.method === "resources/list") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        resources: [
          {
            uri: "trip://active",
            name: "active-trip",
            title: "当前活动行程",
            description: "当前活动行程的只读快照",
            mimeType: "application/json"
          }
        ]
      }
    };
  }
  if (message.method === "resources/templates/list") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        resourceTemplates: [
          {
            uriTemplate: "trip://{trip_id}",
            name: "trip-by-id",
            title: "指定行程",
            description: "按 ID 读取行程快照",
            mimeType: "application/json"
          },
          {
            uriTemplate: "trip://{trip_id}/route",
            name: "trip-route",
            title: "行程候选路线",
            description: "当前候选路线与已选方案",
            mimeType: "application/json"
          }
        ]
      }
    };
  }
  if (message.method === "resources/read") {
    try {
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: readResource(trips, String(message.params?.uri ?? ""))
      };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32602,
          message: error.message ?? "无法读取 MCP 资源。",
          data: {
            code: error.code ?? "RESOURCE_READ_FAILED",
            ...(error.recovery ? { recovery: error.recovery } : {})
          }
        }
      };
    }
  }
  if (message.method === "tools/call") {
    let result;
    try {
      const args = message.params?.arguments ?? {};
      validateToolArguments(message.params?.name, args);
      result = await callTool(services, message.params?.name, args);
    } catch (error) {
      result = failure(error);
    }
    return { jsonrpc: "2.0", id: message.id, result };
  }
  return {
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: `Method not found: ${message.method}` }
  };
}

// Streamable HTTP：POST 单条或批量 JSON-RPC；纯通知返回 202。
export async function handleMcpRequest({ response, body, trips, settings }) {
  const messages = Array.isArray(body) ? body : [body];
  const replies = [];
  for (const message of messages) {
    const reply = await handleMessage({ trips, settings }, message);
    if (reply) replies.push(reply);
  }
  if (replies.length === 0) {
    response.writeHead(202, { "content-type": "application/json; charset=utf-8" });
    response.end();
    return;
  }
  const payload = Array.isArray(body) ? replies : replies[0];
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}
