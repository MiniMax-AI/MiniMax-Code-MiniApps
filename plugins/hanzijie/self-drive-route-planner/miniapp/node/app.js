import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { SqliteTripStore } from "./adapters/sqlite-store.js";
import { DomainError, TripApplication } from "./domain/trip-application.js";
import { EventHub } from "./http/event-hub.js";
import { handleMcpRequest } from "./mcp/route-planner-http.js";

const APP_NAME = "self-drive-route-planner";
const APP_VERSION = "0.8.1";

const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/pdf-export.js", ["pdf-export.js", "text/javascript; charset=utf-8"]]
]);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function writeJson(response, status, value) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) {
      throw new DomainError("BODY_TOO_LARGE", "请求内容过大。", { status: 413 });
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DomainError("INVALID_JSON", "请求不是有效的 JSON。", { status: 400 });
  }
}

function writeError(response, error) {
  if (error instanceof DomainError || (error?.code && error?.status)) {
    writeJson(response, error.status ?? 400, {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.recovery ? { recovery: error.recovery } : {}),
        ...(error.details ? { details: error.details } : {})
      }
    });
    return;
  }
  writeJson(response, 500, {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "应用遇到内部错误，请重试。"
    }
  });
}

function requestHostname(request) {
  const rawHost = String(request.headers.host ?? "");
  return rawHost.startsWith("[")
    ? rawHost.slice(1, rawHost.indexOf("]"))
    : rawHost.split(":")[0];
}

function assertLoopback(request) {
  if (!LOOPBACK_HOSTS.has(requestHostname(request))) {
    throw new DomainError("MCP_HOST_REJECTED", "MCP 只接受本机 loopback 请求。", {
      status: 403
    });
  }
  const origin = request.headers.origin;
  if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).hostname;
    } catch {
      throw new DomainError("MCP_ORIGIN_REJECTED", "MCP Origin 无效。", { status: 403 });
    }
    if (!LOOPBACK_HOSTS.has(originHost)) {
      throw new DomainError("MCP_ORIGIN_REJECTED", "MCP 拒绝了非本机 Origin。", {
        status: 403
      });
    }
  }
}

function normalizeKeyInput(value, label = "高德 Web 服务 Key") {
  if (value === null) return null;
  const key = String(value ?? "").trim();
  if (!key) return undefined;
  if (key.length < 8 || key.length > 128 || /\s/.test(key)) {
    throw new DomainError("INVALID_AMAP_KEY", `${label}格式不正确。`, {
      recovery: `请粘贴高德开放平台的${label}（不含空格）。`
    });
  }
  return key;
}

export async function createApplication(options = {}) {
  const clientDirectory = options.clientDirectory;
  const configStore = options.configStore;
  const mapProvider = options.mapProvider;
  const mcpPath = options.mcpPath ?? "/mcp/route-planner";
  const logger = options.logger;

  const store = new SqliteTripStore(options.databasePath ?? ":memory:");
  const events = new EventHub();
  const trips = new TripApplication({
    store,
    mapProvider,
    events,
    clock: options.clock,
    recalculateDebounceMs: options.recalculateDebounceMs
  });

  function configStatus() {
    const mode = mapProvider.mode;
    const warnings = [];
    if (mode === "unconfigured") {
      warnings.push(
        "高德未连接：真实地点搜索和算路已停用。可调用 set_amap_key 配置 Key；用户还没有 Key 时，可用「高德申请 API Key」（amap-apikey）skill 自动申请。"
      );
    }
    if (mode === "demo") {
      warnings.push("演示模式：地点搜索与路线均为明确标注的本地演示数据。");
    }
    return {
      ok: true,
      map: {
        mode,
        connected: mode === "amap",
        key_configured: configStore.keyConfigured,
        configured_mode: configStore.mapMode
      },
      warnings
    };
  }

  // 保存高德配置、切换 Provider，并在真实模式下做一次在线验证。
  // UI 的 PUT /api/config/amap 与 MCP 的 set_amap_key 共用此逻辑。
  async function applyAmapConfig(patch) {
    const snapshot = await configStore.update(patch);
    mapProvider.configure(snapshot);
    logger?.info?.("miniapp.config.updated", {
      map_mode: snapshot.mapMode,
      key_configured: Boolean(snapshot.amapKey)
    });
    let verify = null;
    if (mapProvider.mode === "amap") {
      try {
        const probe = await mapProvider.searchPlaces({ query: "天安门", city: "" });
        verify = { ok: true, sample_count: probe.length };
      } catch (error) {
        verify = {
          ok: false,
          code: error.code ?? "AMAP_VERIFY_FAILED",
          message: error.message ?? "高德接口验证失败。"
        };
      }
    }
    return { ...configStatus(), verify };
  }

  const settings = {
    // 供 MCP 层感知当前连接状态："amap" | "demo" | "unconfigured"。
    mapMode() {
      return mapProvider.mode;
    },
    async setAmapKey(rawKey) {
      const key = normalizeKeyInput(rawKey, "高德 Key");
      if (key === undefined) {
        throw new DomainError("INVALID_AMAP_KEY", "高德 Key 不能为空。", {
          recovery: "请传入高德开放平台的 Key（8-128 个字符，不含空格）。"
        });
      }
      // 设置 Key 即意图使用真实数据，顺带切回 real 模式。
      return applyAmapConfig({ key, mapMode: "real" });
    }
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        writeJson(response, 200, {
          ok: true,
          app: APP_NAME,
          version: APP_VERSION,
          mcp: "streamable-http",
          map_provider: mapProvider.mode
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/config/status") {
        writeJson(response, 200, configStatus());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/config/browser") {
        // 地图图面使用本地矢量渲染；高德 Key 只留在 Node 进程中，永不下发到浏览器。
        writeJson(response, 200, {
          ok: true,
          map_mode: mapProvider.mode
        });
        return;
      }

      if (request.method === "PUT" && url.pathname === "/api/config/amap") {
        const input = await readJson(request);
        const patch = {};
        if (Object.hasOwn(input, "key")) {
          const key = normalizeKeyInput(input.key, "高德 Key");
          if (key !== undefined) patch.key = key;
        }
        if (Object.hasOwn(input, "map_mode")) patch.mapMode = input.map_mode;
        writeJson(response, 200, await applyAmapConfig(patch));
        return;
      }

      if (url.pathname === mcpPath) {
        assertLoopback(request);
        if (request.method === "POST") {
          const body = await readJson(request);
          await handleMcpRequest({ response, body, trips, settings });
          return;
        }
        response.writeHead(405, {
          allow: "POST",
          "content-type": "application/json; charset=utf-8"
        });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Method not allowed." },
            id: null
          })
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/trips") {
        const input = await readJson(request);
        const trip = trips.createTrip({ name: input.name, source: "ui" });
        writeJson(response, 201, { ok: true, trip });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/trips") {
        writeJson(response, 200, { ok: true, trips: trips.listTrips() });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/trips/active") {
        writeJson(response, 200, { ok: true, trip: trips.getActiveTrip() });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/places/search") {
        const result = await trips.searchPlaces({
          query: url.searchParams.get("q"),
          city: url.searchParams.get("city")
        });
        writeJson(response, 200, { ok: true, ...result });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/events") {
        const tripId = url.searchParams.get("trip_id");
        if (!tripId) {
          throw new DomainError("TRIP_ID_REQUIRED", "事件流需要 trip_id。");
        }
        trips.getTrip(tripId);
        response.writeHead(200, {
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "content-type": "text/event-stream; charset=utf-8",
          "x-accel-buffering": "no"
        });
        const unsubscribe = events.subscribe(tripId, response);
        request.once("close", unsubscribe);
        return;
      }

      const recalculateMatch = url.pathname.match(
        /^\/api\/trips\/([^/]+)\/route:recalculate$/
      );
      if (request.method === "POST" && recalculateMatch) {
        const input = await readJson(request);
        const trip = await trips.recalculateRoute({
          tripId: decodeURIComponent(recalculateMatch[1]),
          expectedRevision: input.expected_revision,
          source: "ui"
        });
        writeJson(response, 200, { ok: true, trip });
        return;
      }

      const routeSelectMatch = url.pathname.match(
        /^\/api\/trips\/([^/]+)\/route:select$/
      );
      if (request.method === "POST" && routeSelectMatch) {
        const input = await readJson(request);
        const trip = trips.selectRoute({
          tripId: decodeURIComponent(routeSelectMatch[1]),
          expectedRevision: input.expected_revision,
          routeId: input.route_id,
          source: "ui"
        });
        writeJson(response, 200, { ok: true, trip });
        return;
      }

      const auditMatch = url.pathname.match(/^\/api\/trips\/([^/]+)\/audit$/);
      if (request.method === "GET" && auditMatch) {
        const tripId = decodeURIComponent(auditMatch[1]);
        writeJson(response, 200, {
          ok: true,
          trip_id: tripId,
          audit: trips.getAudit(tripId, 30)
        });
        return;
      }

      const exportMatch = url.pathname.match(/^\/api\/trips\/([^/]+)\/export$/);
      if (request.method === "GET" && exportMatch) {
        const tripId = decodeURIComponent(exportMatch[1]);
        writeJson(response, 200, {
          ok: true,
          trip_id: tripId,
          export: trips.exportTrip(tripId)
        });
        return;
      }

      const tripMatch = url.pathname.match(/^\/api\/trips\/([^/]+)$/);
      if (request.method === "PATCH" && tripMatch) {
        const input = await readJson(request);
        const { expected_revision: expectedRevision, ...patch } = input;
        const trip = trips.patchTrip({
          tripId: decodeURIComponent(tripMatch[1]),
          expectedRevision,
          patch,
          source: "ui"
        });
        writeJson(response, 200, { ok: true, trip });
        return;
      }
      if (request.method === "GET" && tripMatch) {
        writeJson(response, 200, {
          ok: true,
          trip: trips.getTrip(decodeURIComponent(tripMatch[1]))
        });
        return;
      }

      const staticFile = STATIC_FILES.get(url.pathname);
      if (request.method === "GET" && staticFile) {
        const [filename, contentType] = staticFile;
        const content = await readFile(join(clientDirectory, filename));
        response.writeHead(200, {
          "cache-control": "no-cache",
          "content-type": contentType,
          "x-content-type-options": "nosniff"
        });
        response.end(content);
        return;
      }

      writeJson(response, 404, {
        ok: false,
        error: { code: "NOT_FOUND", message: "未找到请求的接口。" }
      });
    } catch (error) {
      writeError(response, error);
    }
  });

  return {
    trips,
    async listen({ port, host }) {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Unable to determine server address");
      }
      return { host: address.address, port: address.port };
    },
    async close() {
      trips.close();
      events.closeAll();
      if (server.listening) {
        await new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
      store.close();
    }
  };
}
