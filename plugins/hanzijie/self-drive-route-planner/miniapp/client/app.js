import { downloadTripPdf } from "/pdf-export.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  trip: null,
  config: null,
  eventSource: null,
  searchTimers: new Map(),
  searchResults: new Map(),
  audit: [],
  auditTimer: null,
  demoView: { zoom: 1, centerX: 500, centerY: 360 },
  draggedWaypointIndex: null,
  toastTimer: null
};

const SAMPLE_TRIP = {
  name: "京晋陕 · 古城与石窟之路",
  origin: {
    name: "北京·天安门",
    address: "北京市东城区东长安街",
    poi_id: "demo-tiananmen",
    location: { longitude: 116.397477, latitude: 39.908692 }
  },
  waypoints: [
    {
      name: "云冈石窟",
      address: "大同市云冈区云冈镇",
      poi_id: "demo-yungang",
      location: { longitude: 113.134025, latitude: 40.109209 }
    },
    {
      name: "平遥古城",
      address: "晋中市平遥县康宁路",
      poi_id: "demo-pingyao",
      location: { longitude: 112.18135, latitude: 37.204965 }
    }
  ],
  destination: {
    name: "西安·大雁塔",
    address: "西安市雁塔区雁塔南路",
    poi_id: "demo-dayanta",
    location: { longitude: 108.964165, latitude: 34.218984 }
  }
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const requestOptions = { ...options, headers: { ...(options.headers ?? {}) } };
  if (options.body && typeof options.body !== "string") {
    requestOptions.headers["content-type"] = "application/json";
    requestOptions.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, requestOptions);
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: { code: "INVALID_RESPONSE", message: text } };
    }
  }
  if (!response.ok) {
    const error = new Error(body.error?.message ?? "请求失败");
    Object.assign(error, body.error ?? {}, { status: response.status });
    throw error;
  }
  return body;
}

function showToast(message, type = "info") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast show${type === "error" ? " error" : ""}`;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    toast.className = "toast";
  }, 3200);
}

const XHS_SKILL_PROMPT =
  "调用 xhs-route-cards Skill，把当前自驾行程生成小红书旅行规划图片（3:4 竖版路线卡片）。";

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Electron / loopback contexts may reject Clipboard API; use the local fallback below.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("当前环境不允许访问剪贴板，请手动复制文本。");
}

function formatDistance(meters) {
  if (meters === null || meters === undefined || !Number.isFinite(Number(meters))) return "—";
  const kilometers = Number(meters) / 1000;
  return `${kilometers >= 100 ? Math.round(kilometers) : kilometers.toFixed(1)} km`;
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return "—";
  const totalMinutes = Math.round(Number(seconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`;
}

function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function describeRouteStatus(trip) {
  const descriptions = {
    empty: ["等待设置站点", "选择起点和终点后即可规划"],
    dirty: ["路线待更新", trip.auto_recalculate ? "即将自动重新规划" : "点击下方按钮开始规划"],
    stale: ["显示上一次路线", "站点已变化，旧路线仅供参考"],
    planning: ["正在规划路线", "保留旧路线，等待最新结果"],
    ready: ["路线已同步", `${trip.route_options.length} 条候选方案 · 修订 R${trip.revision}`],
    failed: ["本次规划失败", trip.route_error?.message ?? "请检查配置后重试"]
  };
  return descriptions[trip.route_status] ?? ["路线状态未知", "请刷新后重试"];
}

function selectedRoute() {
  return state.trip?.route_options?.find(
    (route) => route.id === state.trip.selected_route_id
  ) ?? state.trip?.route_options?.[0] ?? null;
}

function isTripSnapshotAtLeastCurrent(candidate) {
  if (!candidate || !state.trip) return Boolean(candidate);
  if (candidate.revision !== state.trip.revision) {
    return candidate.revision > state.trip.revision;
  }
  return String(candidate.updated_at ?? "") >= String(state.trip.updated_at ?? "");
}

function renderConfig() {
  if (!state.config) return;
  const mapStatus = $("#map-provider-status");
  const mapMode = state.config.map.mode;
  const isDemo = mapMode === "demo";
  const isAmap = mapMode === "amap";
  mapStatus.className = `status-pill ${isAmap ? "online" : "warning"}`;
  mapStatus.innerHTML = `<i></i>${isAmap ? "高德已连接" : isDemo ? "演示模式" : "高德未连接"}`;
  $("#map-mode-note").textContent = isAmap
    ? "高德已连接 · 真实搜索与算路 / 本地矢量图面"
    : isDemo
      ? "演示模式 · 本地矢量地图 / 估算路线"
      : "高德未连接 · 地点搜索和真实算路已停用";
}

function formatStayLabel(stayMinutes) {
  const minutes = Math.round(Number(stayMinutes));
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts = [];
  if (days) parts.push(`${days} 天`);
  if (hours) parts.push(`${hours} 小时`);
  if (mins && !days) parts.push(`${mins} 分`);
  return `停留 ${parts.join(" ")}`;
}

function isoToLocalInput(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 时间线推算：唯一的输入是各点的 depart_at（从该点出发的时间）。
// 到达时间 = 上一点出发时间 + 该段行车耗时；停留 = 本点出发 − 本点到达；
// 终点只有推算出的到达时间。途经点未设出发时间时，默认到达即出发
// （若 MCP 写过 stay_minutes 则顺延该时长）。
function computeTimeline() {
  const timeline = new Map();
  const trip = state.trip;
  if (!trip) return timeline;
  const stops = [trip.origin, ...(trip.waypoints ?? []), trip.destination].filter(Boolean);
  if (stops.length === 0) return timeline;
  const legs = selectedRoute()?.legs ?? [];
  const legByTo = new Map(legs.map((leg) => [leg.to_stop_id, leg]));
  let cursor = null;
  stops.forEach((stop, index) => {
    let arrive = null;
    if (index > 0 && cursor) {
      const leg = legByTo.get(stop.id) ?? legs[index - 1] ?? null;
      const duration = Number(leg?.duration_seconds);
      if (Number.isFinite(duration)) {
        arrive = new Date(cursor.getTime() + duration * 1000);
      }
    }
    let depart = null;
    let stayMinutes = null;
    let conflict = false;
    if (stop.role !== "destination") {
      if (stop.depart_at) {
        const parsed = new Date(stop.depart_at);
        if (!Number.isNaN(parsed.getTime())) depart = parsed;
      }
      if (!depart && arrive) {
        depart = new Date(arrive.getTime() + (Number(stop.stay_minutes) || 0) * 60000);
      }
      if (depart && arrive) {
        stayMinutes = Math.round((depart.getTime() - arrive.getTime()) / 60000);
        conflict = stayMinutes < 0;
      }
    }
    timeline.set(stop.id, { arrive, depart, stayMinutes, conflict });
    cursor = depart;
  });
  return timeline;
}

// 车程放在两张卡片之间的连接位：描述"从上一站到本站"的里程与耗时。
function legConnectorHtml(toStop, legIndex) {
  const legs = selectedRoute()?.legs ?? [];
  const leg =
    (toStop ? legs.find((candidate) => candidate.to_stop_id === toStop.id) : null) ??
    legs[legIndex] ??
    null;
  const distance = formatDistance(leg?.distance_meters);
  const duration = formatDuration(leg?.duration_seconds);
  if (!leg || (distance === "—" && duration === "—")) {
    return `<div class="leg-connector empty" aria-hidden="true"><i></i></div>`;
  }
  const outdated = ["stale", "failed"].includes(state.trip.route_status);
  return `<div class="leg-connector${outdated ? " outdated" : ""}" title="${escapeHtml(leg.from_name)} → ${escapeHtml(leg.to_name)}">
      <i aria-hidden="true"></i>
      <span>${distance} · ${duration}${outdated ? " · 旧路线" : ""}</span>
    </div>`;
}

function noteEditorHtml(role, index, note) {
  return `<label class="note-label" for="note-${role}-${index}">本站安排 / 备注</label>
      <textarea
        id="note-${role}-${index}"
        class="note-input"
        data-note-role="${role}"
        data-note-index="${index}"
        rows="2"
        maxlength="500"
        placeholder="集合、住宿、换乘…"
      >${escapeHtml(note)}</textarea>`;
}

function noteBlockHtml(role, index, stop) {
  if (!stop) return "";
  const note = stop.note ?? "";
  const inner = note
    ? noteEditorHtml(role, index, note)
    : `<button class="note-add" data-note-role="${role}" data-note-index="${index}" type="button">＋ 添加备注</button>`;
  return `<div class="note-block">${inner}</div>`;
}

function stopCard(role, stop, index = 0, timeline = null) {
  const isWaypoint = role === "waypoint";
  const labels = {
    origin: "起点 · START",
    destination: "终点 · FINISH",
    waypoint: `途经点 ${index + 1} · STOP ${index + 1}`
  };
  const marker = role === "origin" ? "始" : role === "destination" ? "终" : String(index + 1);
  const key = `${role}:${index}`;
  const sideControls = isWaypoint
    ? `<div class="stop-side">
        <span class="drag-handle" draggable="true" data-drag-index="${index}" title="拖拽调整顺序" aria-label="拖拽途经点 ${index + 1} 调整顺序">⋮⋮</span>
        <div class="stop-actions">
          <button class="icon-button" data-action="move-up" data-index="${index}" type="button" aria-label="上移途经点">↑</button>
          <button class="icon-button" data-action="move-down" data-index="${index}" type="button" aria-label="下移途经点">↓</button>
          <button class="icon-button" data-action="remove" data-index="${index}" type="button" aria-label="删除途经点">×</button>
        </div>
      </div>`
    : "";
  const entry = stop ? timeline?.get(stop.id) ?? null : null;
  // 时间行：按「到达 → 停留 → 离开」排列。到达是弱化的推算值；
  // 离开时间（起点为"出发"）是可调整项，停留随两者自动变化。
  const timeItems = [];
  if (role !== "origin" && entry?.arrive) {
    timeItems.push(
      `<span class="arrive-note${role === "destination" ? " strong" : ""}">${formatTime(entry.arrive)} 到达</span>`
    );
  }
  if (isWaypoint) {
    if (entry?.conflict) {
      timeItems.push(`<span class="stay-chip conflict">离开早于预计到达</span>`);
    } else if (entry?.stayMinutes > 0) {
      timeItems.push(`<span class="stay-chip">${escapeHtml(formatStayLabel(entry.stayMinutes))}</span>`);
    } else if (!entry?.arrive) {
      const fallbackStay = formatStayLabel(stop?.stay_minutes);
      if (fallbackStay) timeItems.push(`<span class="stay-chip">${escapeHtml(fallbackStay)}</span>`);
    }
  }
  if (stop && role !== "destination") {
    const departLabel = role === "origin" ? "出发" : "离开本站";
    timeItems.push(`<label class="depart-editor">${departLabel}
        <input
          type="datetime-local"
          class="depart-input"
          ${role === "origin" ? 'data-depart-role="origin"' : `data-depart-index="${index}"`}
          value="${isoToLocalInput(stop.depart_at)}"
          aria-label="${role === "origin" ? "起点出发" : `途经点 ${index + 1} 离开`}时间"
        />
      </label>`);
  }
  const timeRow = timeItems.length
    ? `<div class="stop-extra stop-time-row">${timeItems.join("")}</div>`
    : "";
  return `
    <div class="stop-card ${role}" data-role="${role}" data-index="${index}">
      <span class="stop-marker">${marker}</span>
      <div class="stop-copy">
        <label for="stop-${role}-${index}">${labels[role]}</label>
        <input
          id="stop-${role}-${index}"
          class="stop-search-input"
          data-search-key="${key}"
          type="search"
          autocomplete="off"
          value="${escapeHtml(stop?.name ?? "")}"
          placeholder="搜索并选择地点"
        />
        <span class="stop-address">${escapeHtml(stop?.address || "尚未选择明确地点")}</span>
        ${noteBlockHtml(role, index, stop)}
      </div>
      ${sideControls}
      ${timeRow}
      <div class="search-results hidden" data-results-key="${key}"></div>
    </div>`;
}

function renderStops() {
  if (!state.trip) return;
  const timeline = computeTimeline();
  const html = [stopCard("origin", state.trip.origin, 0, timeline)];
  state.trip.waypoints.forEach((stop, index) => {
    html.push(legConnectorHtml(stop, index));
    html.push(stopCard("waypoint", stop, index, timeline));
  });
  html.push(legConnectorHtml(state.trip.destination, state.trip.waypoints.length));
  html.push(stopCard("destination", state.trip.destination, 0, timeline));
  $("#stop-list").innerHTML = html.join("");
}

function renderPreferences() {
  if (!state.trip) return;
  $$("#preference-buttons button").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.strategy === state.trip.preferences.strategy
    );
  });
  $("#auto-recalculate").checked = state.trip.auto_recalculate;
}

function renderRouteOptions() {
  const container = $("#route-options");
  const routes = state.trip?.route_options ?? [];
  $("#route-count").textContent = String(routes.length);
  if (routes.length === 0) {
    container.innerHTML = `
      <div class="empty-card">
        选择起点、终点与途经点后，候选路线会在这里出现。<br />地图在重算时仍会保留上一次结果。
      </div>`;
    return;
  }
  container.innerHTML = routes
    .map((route, index) => {
      const isSelected = route.id === state.trip.selected_route_id;
      const isOutdated = ["stale", "failed"].includes(state.trip.route_status);
      return `
        <button class="route-card ${isSelected ? "selected" : ""}" data-route-id="${escapeHtml(route.id)}" type="button">
          <div class="route-card-head">
            <strong>${escapeHtml(route.label || `候选路线 ${index + 1}`)}</strong>
            <span class="route-tag">${isOutdated ? "过期路线" : route.is_demo ? "演示估算" : isSelected ? "当前选择" : "可选"}</span>
          </div>
          <div class="route-card-metrics">
            <span><strong>${formatDuration(route.duration_seconds)}</strong><small>预计时间</small></span>
            <span><strong>${formatDistance(route.distance_meters)}</strong><small>总里程</small></span>
            <span><strong>¥${Math.round(route.tolls_yuan || 0)}</strong><small>预计收费</small></span>
          </div>
          <div class="route-card-foot">
            <span>${route.traffic_lights || 0} 个红绿灯 · ${route.legs?.length || 0} 段</span>
            <span>${isSelected ? "已显示" : "点击切换 →"}</span>
          </div>
          ${
            isSelected && route.legs?.length
              ? `<div class="route-leg-list" aria-label="分段里程与时间">
                  ${route.legs
                    .map(
                      (leg, legIndex) => `<div>
                        <span>${legIndex + 1}. ${escapeHtml(leg.from_name)} → ${escapeHtml(leg.to_name)}</span>
                        <strong>${formatDistance(leg.distance_meters)} · ${formatDuration(leg.duration_seconds)}</strong>
                      </div>`
                    )
                    .join("")}
                </div>`
              : ""
          }
        </button>`;
    })
    .join("");
}

function renderSelectedRoute() {
  const route = selectedRoute();
  if (!route) {
    $("#selected-route-name").textContent = "等待路线";
    $("#selected-distance").textContent = "—";
    $("#selected-duration").textContent = "—";
    $("#selected-tolls").textContent = "—";
    $("#route-generated-at").textContent = "尚未规划";
    return;
  }
  $("#selected-route-name").textContent = route.label;
  $("#selected-distance").textContent = formatDistance(route.distance_meters);
  $("#selected-duration").textContent = formatDuration(route.duration_seconds);
  $("#selected-tolls").textContent = `¥${Math.round(route.tolls_yuan || 0)}`;
  $("#route-generated-at").textContent = `${route.is_demo ? "演示估算" : "生成于"} ${formatTime(route.generated_at)}`;
}

function renderTripHeader() {
  if (!state.trip) return;
  $("#trip-name").value = state.trip.name;
  $("#trip-meta").textContent = `活动行程 ${state.trip.id.slice(0, 8)} · 更新于 ${formatTime(state.trip.updated_at)}`;
  $("#revision-badge").textContent = `R${state.trip.revision}`;
  const [title, detail] = describeRouteStatus(state.trip);
  $("#route-state-title").textContent = title;
  $("#route-state-detail").textContent = detail;
  $("#route-state-dot").className = `pulse-dot ${state.trip.route_status}`;
  $("#map-stage").classList.toggle(
    "route-outdated",
    ["stale", "failed"].includes(state.trip.route_status)
  );
  $("#recalculate-button").disabled =
    !state.trip.origin || !state.trip.destination || state.trip.route_status === "planning";
}

function renderTrip() {
  if (!state.trip) return;
  renderTripHeader();
  renderStops();
  renderPreferences();
  renderRouteOptions();
  renderSelectedRoute();
  renderMap();
  scheduleAuditRefresh();
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function tripPoints() {
  const routePoints = (state.trip?.route_options ?? []).flatMap(
    (route) => route.geometry ?? []
  );
  const stopPoints = [
    state.trip?.origin,
    ...(state.trip?.waypoints ?? []),
    state.trip?.destination
  ]
    .filter(Boolean)
    .map((stop) => stop.location);
  return routePoints.length ? [...routePoints, ...stopPoints] : stopPoints;
}

function createProjection(points) {
  const longitudes = points.map((point) => point.longitude);
  const latitudes = points.map((point) => point.latitude);
  let minLongitude = Math.min(...longitudes);
  let maxLongitude = Math.max(...longitudes);
  let minLatitude = Math.min(...latitudes);
  let maxLatitude = Math.max(...latitudes);
  if (maxLongitude - minLongitude < 0.5) {
    minLongitude -= 0.25;
    maxLongitude += 0.25;
  }
  if (maxLatitude - minLatitude < 0.5) {
    minLatitude -= 0.25;
    maxLatitude += 0.25;
  }
  const longitudePadding = (maxLongitude - minLongitude) * 0.12;
  const latitudePadding = (maxLatitude - minLatitude) * 0.15;
  minLongitude -= longitudePadding;
  maxLongitude += longitudePadding;
  minLatitude -= latitudePadding;
  maxLatitude += latitudePadding;
  return (point) => ({
    x: 70 + ((point.longitude - minLongitude) / (maxLongitude - minLongitude)) * 860,
    y: 65 + ((maxLatitude - point.latitude) / (maxLatitude - minLatitude)) * 590
  });
}

function renderDemoMap() {
  const routeLayer = $("#route-layer");
  const markerLayer = $("#marker-layer");
  routeLayer.replaceChildren();
  markerLayer.replaceChildren();
  const points = tripPoints();
  if (!state.trip || points.length === 0) return;
  const project = createProjection(points);
  const routes = [...(state.trip.route_options ?? [])].sort((a, b) =>
    a.id === state.trip.selected_route_id ? 1 : b.id === state.trip.selected_route_id ? -1 : 0
  );
  for (const route of routes) {
    if (!route.geometry?.length) continue;
    const pathData = route.geometry
      .map((point, index) => {
        const projected = project(point);
        return `${index === 0 ? "M" : "L"}${projected.x.toFixed(1)},${projected.y.toFixed(1)}`;
      })
      .join(" ");
    const selected = route.id === state.trip.selected_route_id;
    if (selected) {
      routeLayer.append(
        svgElement("path", { d: pathData, class: "route-path-halo" })
      );
    }
    routeLayer.append(
      svgElement("path", {
        d: pathData,
        class: `route-path ${selected ? "selected" : "alternate"}`
      })
    );
  }
  const stops = [state.trip.origin, ...state.trip.waypoints, state.trip.destination].filter(Boolean);
  stops.forEach((stop, index) => {
    const point = project(stop.location);
    const group = svgElement("g", {
      class: "map-marker",
      transform: `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`
    });
    const isOrigin = index === 0;
    const isDestination = index === stops.length - 1;
    const fill = isOrigin ? "#1fc16b" : isDestination ? "#ff5a5f" : "#ff7a1a";
    group.append(svgElement("circle", { r: 15, fill }));
    const number = svgElement("text", { class: "number", x: 0, y: 1 });
    number.textContent = isOrigin ? "始" : isDestination ? "终" : String(index);
    group.append(number);
    const label = svgElement("text", { class: "label", x: 22, y: -18 });
    label.textContent = stop.name;
    group.append(label);
    markerLayer.append(group);
  });
}

function renderMap() {
  // The public package keeps credentials in Node and renders route geometry locally.
  renderDemoMap();
}

function renderSearchResults(container, key, results) {
  state.searchResults.set(key, results);
  container.classList.remove("hidden");
  if (results.length === 0) {
    container.innerHTML = `<div class="empty-result">没有匹配地点。演示模式可搜索天安门、云冈、平遥、大雁塔、西湖、外滩等。</div>`;
    return;
  }
  container.innerHTML = results
    .map(
      (place, index) => `
        <button type="button" data-place-key="${escapeHtml(key)}" data-place-index="${index}">
          <strong>${escapeHtml(place.name)}</strong>
          <small>${escapeHtml([place.city, place.district, place.address].filter(Boolean).join(" · "))}</small>
        </button>`
    )
    .join("");
}

function schedulePlaceSearch({ key, query, container }) {
  clearTimeout(state.searchTimers.get(key));
  if (query.trim().length < 2) {
    container.classList.add("hidden");
    return;
  }
  const timer = setTimeout(async () => {
    try {
      const body = await api(`/api/places/search?q=${encodeURIComponent(query.trim())}`);
      renderSearchResults(container, key, body.results);
    } catch (error) {
      renderSearchResults(container, key, []);
      showToast(error.message, "error");
    }
  }, 260);
  state.searchTimers.set(key, timer);
}

async function patchTrip(patch, successMessage) {
  if (!state.trip) return;
  try {
    const body = await api(`/api/trips/${state.trip.id}`, {
      method: "PATCH",
      body: { expected_revision: state.trip.revision, ...patch }
    });
    state.trip = body.trip;
    renderTrip();
    if (successMessage) showToast(successMessage);
  } catch (error) {
    if (error.code === "REVISION_CONFLICT") {
      const latest = await api(`/api/trips/${state.trip.id}`);
      state.trip = latest.trip;
      renderTrip();
      showToast("行程已被 AI 更新，已载入最新版本，请重试。", "error");
      return;
    }
    showToast(error.message, "error");
  }
}

async function choosePlace(key, place) {
  if (key === "add-waypoint") {
    const waypoints = [...state.trip.waypoints, place];
    $("#add-waypoint-search").value = "";
    $("#add-waypoint-results").classList.add("hidden");
    await patchTrip({ waypoints }, `已加入途经点“${place.name}”`);
    return;
  }
  const [role, rawIndex] = key.split(":");
  if (role === "origin" || role === "destination") {
    await patchTrip({ [role]: place }, `已设置${role === "origin" ? "起点" : "终点"}“${place.name}”`);
    return;
  }
  const index = Number(rawIndex);
  const waypoints = state.trip.waypoints.map((stop, stopIndex) =>
    stopIndex === index ? place : stop
  );
  await patchTrip({ waypoints }, `已替换第 ${index + 1} 个途经点`);
}

async function recalculate() {
  if (!state.trip?.origin || !state.trip?.destination) {
    showToast("请先选择起点和终点。", "error");
    return;
  }
  $("#recalculate-button").disabled = true;
  try {
    const body = await api(`/api/trips/${state.trip.id}/route:recalculate`, {
      method: "POST",
      body: { expected_revision: state.trip.revision }
    });
    state.trip = body.trip;
    renderTrip();
    showToast(`已生成 ${state.trip.route_options.length} 条候选路线`);
  } catch (error) {
    const latest = await api(`/api/trips/${state.trip.id}`).catch(() => null);
    if (latest?.trip) state.trip = latest.trip;
    renderTrip();
    showToast(error.message, "error");
  }
}

async function selectRoute(routeId) {
  if (routeId === state.trip.selected_route_id) return;
  try {
    const body = await api(`/api/trips/${state.trip.id}/route:select`, {
      method: "POST",
      body: { expected_revision: state.trip.revision, route_id: routeId }
    });
    state.trip = body.trip;
    renderTrip();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function subscribeToTrip(tripId) {
  state.eventSource?.close();
  const source = new EventSource(`/api/events?trip_id=${encodeURIComponent(tripId)}`);
  state.eventSource = source;
  const applyTripEvent = (event) => {
    const data = JSON.parse(event.data);
    if (isTripSnapshotAtLeastCurrent(data.payload?.trip)) {
      state.trip = data.payload.trip;
      renderTrip();
    }
    $("#sync-indicator").innerHTML = "<i></i>实时";
  };
  ["trip.updated", "route.planning", "route.updated", "route.failed", "route.selected"].forEach(
    (type) => source.addEventListener(type, applyTripEvent)
  );
  source.addEventListener("audit.updated", scheduleAuditRefresh);
  source.addEventListener("ui.focus.requested", (event) => {
    const data = JSON.parse(event.data);
    showToast(`AI 请求地图聚焦${data.payload.target.type === "trip" ? "整条行程" : "目标位置"}`);
    fitMap();
  });
  source.onopen = async () => {
    $("#sync-indicator").innerHTML = "<i></i>实时";
    const tripAtRequestStart = state.trip;
    try {
      const latest = await api(`/api/trips/${tripId}`);
      if (
        state.eventSource !== source ||
        state.trip?.id !== tripId ||
        state.trip !== tripAtRequestStart
      ) {
        return;
      }
      if (isTripSnapshotAtLeastCurrent(latest.trip)) {
        state.trip = latest.trip;
        renderTrip();
      }
    } catch {
      // EventSource will keep retrying; the visible status already reflects connectivity.
    }
  };
  source.onerror = () => {
    $("#sync-indicator").textContent = "重新连接中";
  };
}

async function loadAudit() {
  if (!state.trip) return;
  try {
    const body = await api(`/api/trips/${state.trip.id}/audit`);
    state.audit = body.audit;
  } catch {
    state.audit = [];
  }
  const container = $("#audit-list");
  if (state.audit.length === 0) {
    container.innerHTML = `<div class="empty-card">操作记录会在这里实时出现。</div>`;
    return;
  }
  container.innerHTML = state.audit
    .slice(0, 12)
    .map(
      (item) => `
        <div class="audit-item ${item.source === "mcp" ? "mcp" : ""}">
          <strong>${escapeHtml(item.summary)}</strong>
          <span>${item.source === "mcp" ? "AI / MCP" : item.source === "system" ? "自动规划" : "页面操作"} · ${formatTime(item.created_at)} · R${item.after_revision ?? "—"}</span>
        </div>`
    )
    .join("");
}

function scheduleAuditRefresh() {
  clearTimeout(state.auditTimer);
  state.auditTimer = setTimeout(loadAudit, 120);
}

function fitMap() {
  state.demoView = { zoom: 1, centerX: 500, centerY: 360 };
  applyDemoViewBox();
  renderDemoMap();
  showToast("已显示完整行程范围");
}

async function createStarterTrip() {
  const created = await api("/api/trips", {
    method: "POST",
    body: { name: SAMPLE_TRIP.name }
  });
  const updated = await api(`/api/trips/${created.trip.id}`, {
    method: "PATCH",
    body: {
      expected_revision: created.trip.revision,
      origin: SAMPLE_TRIP.origin,
      waypoints: SAMPLE_TRIP.waypoints,
      destination: SAMPLE_TRIP.destination,
      preferences: { strategy: "recommended" },
      auto_recalculate: true
    }
  });
  return updated.trip;
}

async function switchToTrip(trip) {
  state.trip = trip;
  subscribeToTrip(trip.id);
  renderTrip();
}

async function bootstrap() {
  try {
    state.config = await api("/api/config/status");
    renderConfig();
    let active;
    try {
      active = (await api("/api/trips/active")).trip;
    } catch (error) {
      if (error.code !== "NO_ACTIVE_TRIP") throw error;
      active = await createStarterTrip();
    }
    await switchToTrip(active);
  } catch (error) {
    $("#map-provider-status").className = "status-pill warning";
    $("#map-provider-status").innerHTML = "<i></i>连接失败";
    showToast(error.message, "error");
  }
}

$("#stop-list").addEventListener("input", (event) => {
  const input = event.target.closest(".stop-search-input");
  if (!input) return;
  const container = input.closest(".stop-card").querySelector(".search-results");
  schedulePlaceSearch({ key: input.dataset.searchKey, query: input.value, container });
});

async function commitWaypointDetail(index, patchFields, successMessage) {
  if (!state.trip?.waypoints?.[index]) return;
  const waypoints = state.trip.waypoints.map((stop, stopIndex) =>
    stopIndex === index ? { ...stop, ...patchFields } : stop
  );
  await patchTrip({ waypoints }, successMessage);
}

$("#stop-list").addEventListener("change", async (event) => {
  if (!state.trip) return;
  const departInput = event.target.closest(".depart-input");
  if (departInput) {
    const iso = departInput.value ? new Date(departInput.value).toISOString() : null;
    if (departInput.dataset.departRole === "origin") {
      if (!state.trip.origin || (state.trip.origin.depart_at ?? null) === iso) return;
      await patchTrip(
        { origin: { ...state.trip.origin, depart_at: iso } },
        iso ? "已设置出发时间" : "已清除出发时间"
      );
      return;
    }
    const index = Number(departInput.dataset.departIndex);
    if ((state.trip.waypoints[index]?.depart_at ?? null) === iso) return;
    await commitWaypointDetail(
      index,
      { depart_at: iso },
      iso ? "已设置该点出发时间" : "已清除该点出发时间"
    );
    return;
  }
  const noteInput = event.target.closest(".note-input");
  if (noteInput) {
    const role = noteInput.dataset.noteRole;
    const note = noteInput.value.trim();
    if (role === "waypoint") {
      const index = Number(noteInput.dataset.noteIndex);
      if ((state.trip.waypoints[index]?.note ?? "") === note) {
        if (!note) renderStops();
        return;
      }
      await commitWaypointDetail(index, { note }, note ? "已更新备注" : "已清除备注");
      return;
    }
    const stop = state.trip[role];
    if (!stop) return;
    if ((stop.note ?? "") === note) {
      if (!note) renderStops();
      return;
    }
    await patchTrip(
      { [role]: { ...stop, note } },
      note ? "已更新备注" : "已清除备注"
    );
  }
});

// 点“＋ 添加备注”后展开的空编辑框：没写内容就离开时，缩回按钮态。
// （change 只在值变化时触发，这里补一个 focusout 兜底。）
$("#stop-list").addEventListener("focusout", (event) => {
  const noteInput = event.target.closest?.(".note-input");
  if (!noteInput || noteInput.value.trim() || !state.trip) return;
  const role = noteInput.dataset.noteRole;
  const existing =
    role === "waypoint"
      ? state.trip.waypoints[Number(noteInput.dataset.noteIndex)]?.note
      : state.trip[role]?.note;
  if (!existing) renderStops();
});

$("#stop-list").addEventListener("click", async (event) => {
  const noteAdd = event.target.closest(".note-add");
  if (noteAdd) {
    const block = noteAdd.closest(".note-block");
    block.innerHTML = noteEditorHtml(
      noteAdd.dataset.noteRole,
      Number(noteAdd.dataset.noteIndex),
      ""
    );
    block.querySelector(".note-input").focus();
    return;
  }
  const placeButton = event.target.closest("[data-place-key]");
  if (placeButton) {
    const results = state.searchResults.get(placeButton.dataset.placeKey) ?? [];
    const place = results[Number(placeButton.dataset.placeIndex)];
    if (place) await choosePlace(placeButton.dataset.placeKey, place);
    return;
  }
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton || !state.trip) return;
  const index = Number(actionButton.dataset.index);
  const waypoints = [...state.trip.waypoints];
  if (actionButton.dataset.action === "remove") {
    const [removed] = waypoints.splice(index, 1);
    await patchTrip({ waypoints }, `已删除“${removed.name}”`);
  }
  if (actionButton.dataset.action === "move-up" && index > 0) {
    [waypoints[index - 1], waypoints[index]] = [waypoints[index], waypoints[index - 1]];
    await patchTrip({ waypoints }, "已调整途经顺序");
  }
  if (actionButton.dataset.action === "move-down" && index < waypoints.length - 1) {
    [waypoints[index + 1], waypoints[index]] = [waypoints[index], waypoints[index + 1]];
    await patchTrip({ waypoints }, "已调整途经顺序");
  }
});

$("#stop-list").addEventListener("dragstart", (event) => {
  const handle = event.target.closest("[data-drag-index]");
  if (!handle || !state.trip) {
    event.preventDefault();
    return;
  }
  state.draggedWaypointIndex = Number(handle.dataset.dragIndex);
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(state.draggedWaypointIndex));
  handle.closest(".stop-card")?.classList.add("dragging");
});

$("#stop-list").addEventListener("dragover", (event) => {
  const target = event.target.closest('.stop-card[data-role="waypoint"]');
  if (!target || state.draggedWaypointIndex === null) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  $$(".stop-card.drag-target", $("#stop-list")).forEach((card) =>
    card.classList.remove("drag-target")
  );
  target.classList.add("drag-target");
});

$("#stop-list").addEventListener("drop", async (event) => {
  const target = event.target.closest('.stop-card[data-role="waypoint"]');
  if (!target || state.draggedWaypointIndex === null || !state.trip) return;
  event.preventDefault();
  const fromIndex = state.draggedWaypointIndex;
  const toIndex = Number(target.dataset.index);
  state.draggedWaypointIndex = null;
  if (fromIndex === toIndex) {
    renderStops();
    return;
  }
  const waypoints = [...state.trip.waypoints];
  const [moved] = waypoints.splice(fromIndex, 1);
  waypoints.splice(toIndex, 0, moved);
  await patchTrip({ waypoints }, "已拖拽调整途经顺序");
});

$("#stop-list").addEventListener("dragend", () => {
  state.draggedWaypointIndex = null;
  $$(".stop-card.dragging, .stop-card.drag-target", $("#stop-list")).forEach((card) =>
    card.classList.remove("dragging", "drag-target")
  );
});

$("#add-waypoint-search").addEventListener("input", (event) => {
  schedulePlaceSearch({
    key: "add-waypoint",
    query: event.target.value,
    container: $("#add-waypoint-results")
  });
});

$("#add-waypoint-results").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-place-key]");
  if (!button) return;
  const results = state.searchResults.get("add-waypoint") ?? [];
  const place = results[Number(button.dataset.placeIndex)];
  if (place) await choosePlace("add-waypoint", place);
});

$("#preference-buttons").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-strategy]");
  if (!button || button.dataset.strategy === state.trip?.preferences.strategy) return;
  await patchTrip(
    { preferences: { strategy: button.dataset.strategy } },
    `路线偏好已切换为“${button.textContent.trim()}”`
  );
});

$("#auto-recalculate").addEventListener("change", async (event) => {
  await patchTrip(
    { auto_recalculate: event.target.checked },
    event.target.checked ? "已开启自动重新规划" : "已关闭自动重新规划"
  );
});

$("#recalculate-button").addEventListener("click", recalculate);
$("#fit-map-button").addEventListener("click", fitMap);

$("#zoom-in-button").addEventListener("click", () => zoomDemoMap(1.4));
$("#zoom-out-button").addEventListener("click", () => zoomDemoMap(1 / 1.4));
$("#traffic-button").addEventListener("click", () => {
  showToast("当前公开包使用本地矢量图面，不提供实时路况图层。", "error");
});
$("#satellite-button").addEventListener("click", () => {
  showToast("当前公开包使用本地矢量图面，不提供卫星图层。", "error");
});

$("#route-options").addEventListener("click", (event) => {
  const card = event.target.closest("[data-route-id]");
  if (card) selectRoute(card.dataset.routeId);
});

$("#trip-name").addEventListener("change", (event) => {
  const name = event.target.value.trim();
  if (name && name !== state.trip?.name) patchTrip({ name }, "行程名称已保存");
});

$("#new-trip-button").addEventListener("click", async () => {
  try {
    const body = await api("/api/trips", {
      method: "POST",
      body: { name: "新的自驾计划" }
    });
    await switchToTrip(body.trip);
    showToast("已创建空白行程");
  } catch (error) {
    showToast(error.message, "error");
  }
});

$("#export-button").addEventListener("click", async () => {
  if (!state.trip) return;
  const exportButton = $("#export-button");
  if (exportButton.disabled) return;
  const defaultLabel = exportButton.textContent;
  exportButton.disabled = true;
  exportButton.textContent = "生成 PDF…";
  try {
    const body = await api(`/api/trips/${state.trip.id}/export`);
    const result = await downloadTripPdf(body.export);
    showToast(`行程手册已导出（${result.pages} 页 PDF）`);
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    exportButton.disabled = false;
    exportButton.textContent = defaultLabel;
  }
});

const xhsCardsDialog = $("#xhs-cards-dialog");
const xhsCopyStatus = $("#xhs-copy-status");
const copyXhsPromptButton = $("#copy-xhs-prompt-button");

function openXhsCardsDialog() {
  if (!state.trip) {
    showToast("行程还在加载，请稍后再试。", "error");
    return;
  }
  $("#xhs-skill-prompt").value = XHS_SKILL_PROMPT;
  xhsCopyStatus.textContent = "";
  xhsCopyStatus.className = "xhs-copy-status";
  xhsCardsDialog.showModal();
  copyXhsPromptButton.focus();
}

async function copyXhsPrompt() {
  copyXhsPromptButton.disabled = true;
  const defaultLabel = copyXhsPromptButton.textContent;
  copyXhsPromptButton.textContent = "复制中…";
  try {
    await copyToClipboard($("#xhs-skill-prompt").value);
    xhsCopyStatus.textContent = "已复制。回到当前对话发送这句话即可。";
    xhsCopyStatus.className = "xhs-copy-status success";
    copyXhsPromptButton.textContent = "已复制";
    showToast("调用语句已复制，请回到当前对话发送。", "info");
  } catch (error) {
    xhsCopyStatus.textContent = error.message;
    xhsCopyStatus.className = "xhs-copy-status error";
    showToast(error.message, "error");
  } finally {
    copyXhsPromptButton.disabled = false;
    setTimeout(() => {
      copyXhsPromptButton.textContent = defaultLabel;
    }, 1600);
  }
}

$("#xhs-cards-button").addEventListener("click", openXhsCardsDialog);
$("#close-xhs-cards-dialog").addEventListener("click", () => xhsCardsDialog.close());
$("#close-xhs-cards-dialog-secondary").addEventListener("click", () => xhsCardsDialog.close());
copyXhsPromptButton.addEventListener("click", copyXhsPrompt);

const settingsDialog = $("#settings-dialog");

function populateSettings() {
  const map = state.config?.map;
  const mode = map?.configured_mode ?? "real";
  $$('#settings-dialog input[name="map-mode"]').forEach((radio) => {
    radio.checked = radio.value === mode;
  });
  $("#amap-key-input").value = "";
  $("#settings-key-status").textContent = map?.key_configured
    ? "Key 已保存（用于搜索与算路；路线图面在本地渲染）。出于安全不回显，留空保存则保持不变。"
    : "Key 未配置：真实搜索和算路不可用，可使用本地演示模式。";
  $("#clear-key-button").classList.toggle("hidden", !map?.key_configured);
}

async function saveSettings({ clearKey = false } = {}) {
  const mode =
    $('#settings-dialog input[name="map-mode"]:checked')?.value ?? "real";
  const keyValue = $("#amap-key-input").value.trim();
  const payload = { map_mode: mode };
  if (clearKey) {
    payload.key = null;
  } else if (keyValue) {
    payload.key = keyValue;
  }
  const saveButton = $("#save-settings-button");
  saveButton.disabled = true;
  try {
    const body = await api("/api/config/amap", { method: "PUT", body: payload });
    state.config = body;
    renderConfig();
    populateSettings();
    if (body.verify && !body.verify.ok) {
      showToast(`Key 已保存，但高德验证失败：${body.verify.message}`, "error");
    } else if (body.verify?.ok) {
      showToast("高德 Key 验证通过，真实搜索与算路已启用");
      settingsDialog.close();
    } else {
      showToast("设置已保存");
      settingsDialog.close();
    }
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    saveButton.disabled = false;
  }
}

$("#settings-button").addEventListener("click", () => {
  populateSettings();
  settingsDialog.showModal();
});
$("#close-settings-dialog").addEventListener("click", () => settingsDialog.close());
$("#save-settings-button").addEventListener("click", () => saveSettings());
$("#clear-key-button").addEventListener("click", () => saveSettings({ clearKey: true }));

window.addEventListener("beforeunload", () => state.eventSource?.close());
bootstrap();
