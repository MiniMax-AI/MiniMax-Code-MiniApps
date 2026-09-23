const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const PAGE_MARGIN = 80;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const PAGE_BOTTOM = 1628;
const PDF_PAGE_WIDTH = 595.28;
const PDF_PAGE_HEIGHT = 841.89;

const FONT_FAMILY =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif';

const COLORS = Object.freeze({
  ink: "#172033",
  inkSoft: "#536079",
  inkMuted: "#8993A8",
  line: "#DFE4EF",
  lineStrong: "#CBD3E2",
  paper: "#F7F8FC",
  card: "#FFFFFF",
  navy: "#152238",
  navySoft: "#203556",
  blue: "#3C6FF3",
  blueSoft: "#EAF0FF",
  cyan: "#38BFD1",
  cyanSoft: "#E7F9FB",
  green: "#18A866",
  greenSoft: "#E6F8EF",
  orange: "#F47A32",
  orangeSoft: "#FFF0E7",
  red: "#E24D59",
  redSoft: "#FDECEF",
  yellow: "#D89A12",
  yellowSoft: "#FFF7DF"
});

const STRATEGY_LABELS = Object.freeze({
  recommended: "智能推荐",
  avoid_congestion: "躲避拥堵",
  avoid_highways: "不走高速",
  low_tolls: "少收费",
  prefer_highways: "高速优先"
});

function setFont(context, size, weight = 400) {
  context.font = `${weight} ${size}px ${FONT_FAMILY}`;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatDistance(meters) {
  const value = finiteNumber(meters);
  if (value === null) return "—";
  const kilometers = value / 1000;
  return `${kilometers >= 100 ? Math.round(kilometers) : kilometers.toFixed(1)} km`;
}

function formatDuration(seconds) {
  const value = finiteNumber(seconds);
  if (value === null) return "—";
  const totalMinutes = Math.max(0, Math.round(value / 60));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days} 天`);
  if (hours) parts.push(`${hours} 小时`);
  if (minutes || parts.length === 0) parts.push(`${minutes} 分`);
  return parts.join(" ");
}

function formatDateTime(value, { includeYear = true } = {}) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    ...(includeYear ? { year: "numeric" } : {}),
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatStay(minutes) {
  const value = finiteNumber(minutes);
  if (value === null || value <= 0) return "";
  const rounded = Math.round(value);
  const days = Math.floor(rounded / 1440);
  const hours = Math.floor((rounded % 1440) / 60);
  const mins = rounded % 60;
  const parts = [];
  if (days) parts.push(`${days} 天`);
  if (hours) parts.push(`${hours} 小时`);
  if (mins && !days) parts.push(`${mins} 分`);
  return parts.join(" ");
}

function sanitizeFilename(value) {
  const safe = String(value || "自驾行程")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return safe || "自驾行程";
}

function selectedRoute(trip) {
  return (
    trip?.route_options?.find((route) => route.id === trip.selected_route_id) ??
    trip?.route_options?.[0] ??
    null
  );
}

function stopsOf(trip) {
  return [trip?.origin, ...(trip?.waypoints ?? []), trip?.destination].filter(Boolean);
}

function statusLabel(trip) {
  const labels = {
    empty: "待设置站点",
    dirty: "路线待更新",
    stale: "路线已过期",
    planning: "路线规划中",
    ready: "路线已就绪",
    failed: "路线规划失败"
  };
  return labels[trip?.route_status] ?? "行程快照";
}

function routeSourceLabel(route) {
  if (!route) return "尚未生成路线";
  return route.is_demo ? "演示估算路线" : "地图服务规划路线";
}

function normalizePoint(point) {
  if (Array.isArray(point) && point.length >= 2) {
    const longitude = finiteNumber(point[0]);
    const latitude = finiteNumber(point[1]);
    return longitude === null || latitude === null ? null : { longitude, latitude };
  }
  const longitude = finiteNumber(point?.longitude);
  const latitude = finiteNumber(point?.latitude);
  return longitude === null || latitude === null ? null : { longitude, latitude };
}

function roundedRectPath(context, x, y, width, height, radius) {
  const r = Math.min(Math.max(0, radius), width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function fillRoundedRect(context, x, y, width, height, radius, fill) {
  roundedRectPath(context, x, y, width, height, radius);
  context.fillStyle = fill;
  context.fill();
}

function strokeRoundedRect(context, x, y, width, height, radius, stroke, lineWidth = 1) {
  roundedRectPath(context, x, y, width, height, radius);
  context.strokeStyle = stroke;
  context.lineWidth = lineWidth;
  context.stroke();
}

function wrapText(context, value, maxWidth, maxLines = Number.POSITIVE_INFINITY) {
  const paragraphs = String(value ?? "").replace(/\r/g, "").split("\n");
  const lines = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const character of Array.from(paragraph)) {
      const candidate = `${current}${character}`;
      if (current && context.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = character;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  if (lines.length <= maxLines) return lines;
  const clipped = lines.slice(0, maxLines);
  let last = clipped.at(-1) ?? "";
  while (last && context.measureText(`${last}…`).width > maxWidth) {
    last = last.slice(0, -1);
  }
  clipped[clipped.length - 1] = `${last}…`;
  return clipped;
}

function drawTextLines(
  context,
  lines,
  x,
  y,
  lineHeight,
  { fill = COLORS.ink, align = "left" } = {}
) {
  context.fillStyle = fill;
  context.textAlign = align;
  context.textBaseline = "top";
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  context.textAlign = "left";
  return lines.length * lineHeight;
}

function drawPill(context, x, y, text, { fill, color, minWidth = 0 } = {}) {
  setFont(context, 22, 600);
  const width = Math.max(minWidth, Math.ceil(context.measureText(text).width) + 34);
  fillRoundedRect(context, x, y, width, 42, 21, fill ?? COLORS.blueSoft);
  context.fillStyle = color ?? COLORS.blue;
  context.textBaseline = "middle";
  context.fillText(text, x + 17, y + 22);
  return width;
}

function createPage(kind = "detail") {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("浏览器无法创建 PDF 画布。");
  context.fillStyle = kind === "cover" ? COLORS.paper : "#FFFFFF";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  return { canvas, context, kind };
}

function samplePoints(points, maxPoints = 1800) {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const sampled = points.filter((_, index) => index % step === 0);
  const last = points.at(-1);
  if (last && sampled.at(-1) !== last) sampled.push(last);
  return sampled;
}

function createProjection(points, rect) {
  const normalized = points.map(normalizePoint).filter(Boolean);
  if (normalized.length === 0) return null;
  let minLongitude = Math.min(...normalized.map((point) => point.longitude));
  let maxLongitude = Math.max(...normalized.map((point) => point.longitude));
  let minLatitude = Math.min(...normalized.map((point) => point.latitude));
  let maxLatitude = Math.max(...normalized.map((point) => point.latitude));
  if (maxLongitude - minLongitude < 0.08) {
    minLongitude -= 0.04;
    maxLongitude += 0.04;
  }
  if (maxLatitude - minLatitude < 0.08) {
    minLatitude -= 0.04;
    maxLatitude += 0.04;
  }
  const insetX = 66;
  const insetY = 74;
  const availableWidth = Math.max(1, rect.width - insetX * 2);
  const availableHeight = Math.max(1, rect.height - insetY * 2);
  return (rawPoint) => {
    const point = normalizePoint(rawPoint);
    if (!point) return null;
    return {
      x:
        rect.x +
        insetX +
        ((point.longitude - minLongitude) / (maxLongitude - minLongitude)) * availableWidth,
      y:
        rect.y +
        insetY +
        ((maxLatitude - point.latitude) / (maxLatitude - minLatitude)) * availableHeight
    };
  };
}

function traceRoute(context, geometry, project) {
  const points = samplePoints((geometry ?? []).map(normalizePoint).filter(Boolean));
  if (points.length < 2) return false;
  context.beginPath();
  points.forEach((point, index) => {
    const projected = project(point);
    if (!projected) return;
    if (index === 0) context.moveTo(projected.x, projected.y);
    else context.lineTo(projected.x, projected.y);
  });
  return true;
}

function drawMap(context, rect, trip, route) {
  fillRoundedRect(context, rect.x, rect.y, rect.width, rect.height, 28, COLORS.card);
  strokeRoundedRect(context, rect.x, rect.y, rect.width, rect.height, 28, COLORS.line, 2);

  context.save();
  roundedRectPath(context, rect.x + 2, rect.y + 2, rect.width - 4, rect.height - 4, 26);
  context.clip();

  const mapGradient = context.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
  mapGradient.addColorStop(0, "#F8FAFF");
  mapGradient.addColorStop(1, "#EDF3FC");
  context.fillStyle = mapGradient;
  context.fillRect(rect.x, rect.y, rect.width, rect.height);

  context.strokeStyle = "#CBD7EC";
  context.globalAlpha = 0.34;
  context.lineWidth = 1;
  for (let x = rect.x + 40; x < rect.x + rect.width; x += 52) {
    context.beginPath();
    context.moveTo(x, rect.y);
    context.lineTo(x, rect.y + rect.height);
    context.stroke();
  }
  for (let y = rect.y + 36; y < rect.y + rect.height; y += 52) {
    context.beginPath();
    context.moveTo(rect.x, y);
    context.lineTo(rect.x + rect.width, y);
    context.stroke();
  }
  context.globalAlpha = 1;

  context.strokeStyle = "#C8D2E3";
  context.lineWidth = 6;
  context.globalAlpha = 0.28;
  [0.22, 0.48, 0.72].forEach((ratio, index) => {
    const y = rect.y + rect.height * ratio;
    context.beginPath();
    context.moveTo(rect.x - 30, y + index * 8);
    context.bezierCurveTo(
      rect.x + rect.width * 0.28,
      y - 82,
      rect.x + rect.width * 0.62,
      y + 78,
      rect.x + rect.width + 30,
      y - 24
    );
    context.stroke();
  });
  context.globalAlpha = 1;

  const stops = stopsOf(trip);
  const routes = trip?.route_options ?? [];
  const routePoints = routes.flatMap((candidate) => candidate.geometry ?? []);
  const stopPoints = stops.map((stop) => stop.location);
  const project = createProjection([...routePoints, ...stopPoints], rect);

  if (!project) {
    setFont(context, 30, 600);
    context.fillStyle = COLORS.inkSoft;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("设置站点后，这里会生成路线概览", rect.x + rect.width / 2, rect.y + rect.height / 2);
    context.restore();
    return;
  }

  const alternateRoutes = routes.filter((candidate) => candidate.id !== route?.id);
  for (const candidate of alternateRoutes) {
    if (!traceRoute(context, candidate.geometry, project)) continue;
    context.strokeStyle = "#AAB7CF";
    context.lineWidth = 7;
    context.globalAlpha = 0.42;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.stroke();
  }
  context.globalAlpha = 1;

  const selectedGeometry = route?.geometry?.length ? route.geometry : stopPoints;
  if (traceRoute(context, selectedGeometry, project)) {
    context.strokeStyle = "rgba(255,255,255,0.95)";
    context.lineWidth = 18;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.stroke();
    traceRoute(context, selectedGeometry, project);
    context.strokeStyle = COLORS.blue;
    context.lineWidth = 10;
    context.stroke();
  }

  stops.forEach((stop, index) => {
    const point = project(stop.location);
    if (!point) return;
    const isOrigin = index === 0;
    const isDestination = index === stops.length - 1;
    const fill = isOrigin ? COLORS.green : isDestination ? COLORS.red : COLORS.orange;
    context.save();
    context.shadowColor = "rgba(23,32,51,0.20)";
    context.shadowBlur = 12;
    context.shadowOffsetY = 4;
    context.beginPath();
    context.arc(point.x, point.y, 22, 0, Math.PI * 2);
    context.fillStyle = fill;
    context.fill();
    context.restore();
    context.beginPath();
    context.arc(point.x, point.y, 15, 0, Math.PI * 2);
    context.strokeStyle = "rgba(255,255,255,0.92)";
    context.lineWidth = 3;
    context.stroke();
    setFont(context, 18, 700);
    context.fillStyle = "#FFFFFF";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(isOrigin ? "始" : isDestination ? "终" : String(index), point.x, point.y + 1);

    setFont(context, 20, 600);
    const labelLines = wrapText(context, stop.name, 190, 2);
    const labelWidth = Math.max(...labelLines.map((line) => context.measureText(line).width), 72) + 28;
    const labelHeight = labelLines.length * 26 + 18;
    let labelX = point.x + 28;
    if (labelX + labelWidth > rect.x + rect.width - 18) labelX = point.x - labelWidth - 28;
    let labelY = point.y - labelHeight - 18;
    if (labelY < rect.y + 18) labelY = point.y + 24;
    fillRoundedRect(context, labelX, labelY, labelWidth, labelHeight, 12, "rgba(255,255,255,0.94)");
    strokeRoundedRect(context, labelX, labelY, labelWidth, labelHeight, 12, "rgba(203,211,226,0.9)", 1);
    drawTextLines(context, labelLines, labelX + 14, labelY + 9, 26, { fill: COLORS.ink });
  });

  context.restore();

  fillRoundedRect(context, rect.x + 22, rect.y + 22, 222, 72, 18, "rgba(21,34,56,0.92)");
  setFont(context, 18, 600);
  context.fillStyle = "rgba(255,255,255,0.7)";
  context.textBaseline = "top";
  context.fillText("ROUTE OVERVIEW", rect.x + 40, rect.y + 36);
  setFont(context, 24, 700);
  context.fillStyle = "#FFFFFF";
  context.fillText(route?.label || "行程路线总览", rect.x + 40, rect.y + 60);

  const legendX = rect.x + rect.width - 310;
  fillRoundedRect(context, legendX, rect.y + rect.height - 66, 286, 44, 22, "rgba(255,255,255,0.94)");
  setFont(context, 18, 600);
  const legendItems = [
    [COLORS.green, "起点"],
    [COLORS.orange, "途经"],
    [COLORS.red, "终点"]
  ];
  let cursor = legendX + 20;
  for (const [fill, label] of legendItems) {
    context.beginPath();
    context.arc(cursor, rect.y + rect.height - 44, 6, 0, Math.PI * 2);
    context.fillStyle = fill;
    context.fill();
    context.fillStyle = COLORS.inkSoft;
    context.textBaseline = "middle";
    context.fillText(label, cursor + 12, rect.y + rect.height - 43);
    cursor += 86;
  }
}

function drawMetricCard(context, x, y, width, label, value, accent, detail = "") {
  fillRoundedRect(context, x, y, width, 166, 22, COLORS.card);
  strokeRoundedRect(context, x, y, width, 166, 22, COLORS.line, 2);
  fillRoundedRect(context, x + 22, y + 22, 44, 8, 4, accent);
  setFont(context, 21, 600);
  context.fillStyle = COLORS.inkMuted;
  context.textBaseline = "top";
  context.fillText(label, x + 22, y + 48);
  setFont(context, 38, 700);
  context.fillStyle = COLORS.ink;
  context.fillText(value, x + 22, y + 80);
  if (detail) {
    setFont(context, 18, 500);
    context.fillStyle = COLORS.inkSoft;
    context.fillText(detail, x + 22, y + 132);
  }
}

function renderCover(exportPayload) {
  const trip = exportPayload.trip ?? {};
  const route = selectedRoute(trip);
  const page = createPage("cover");
  const { context } = page;

  const headerGradient = context.createLinearGradient(0, 0, PAGE_WIDTH, 340);
  headerGradient.addColorStop(0, COLORS.navy);
  headerGradient.addColorStop(1, COLORS.navySoft);
  context.fillStyle = headerGradient;
  context.fillRect(0, 0, PAGE_WIDTH, 350);

  context.fillStyle = "rgba(56,191,209,0.18)";
  context.beginPath();
  context.arc(1110, 50, 250, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(60,111,243,0.22)";
  context.beginPath();
  context.arc(1010, 300, 190, 0, Math.PI * 2);
  context.fill();

  setFont(context, 24, 700);
  context.fillStyle = "#FFFFFF";
  context.textBaseline = "top";
  context.fillText("自驾规划", PAGE_MARGIN, 62);
  setFont(context, 17, 600);
  context.fillStyle = "rgba(255,255,255,0.58)";
  context.fillText("ROUTE BRIEF · 自驾行程手册", PAGE_MARGIN + 124, 67);

  const statusText = statusLabel(trip);
  setFont(context, 19, 600);
  const statusWidth = context.measureText(statusText).width + 34;
  fillRoundedRect(context, PAGE_WIDTH - PAGE_MARGIN - statusWidth, 56, statusWidth, 42, 21, "rgba(255,255,255,0.12)");
  context.fillStyle = "rgba(255,255,255,0.88)";
  context.textBaseline = "middle";
  context.fillText(statusText, PAGE_WIDTH - PAGE_MARGIN - statusWidth + 17, 78);

  setFont(context, 54, 700);
  const titleLines = wrapText(context, trip.name || "未命名自驾行程", 810, 2);
  drawTextLines(context, titleLines, PAGE_MARGIN, 128, 66, { fill: "#FFFFFF" });

  const originName = trip.origin?.name || "未设置起点";
  const destinationName = trip.destination?.name || "未设置终点";
  setFont(context, 23, 500);
  context.fillStyle = "rgba(255,255,255,0.76)";
  context.textBaseline = "top";
  context.fillText(`${originName}  →  ${destinationName}`, PAGE_MARGIN, 278);
  setFont(context, 18, 500);
  context.fillStyle = "rgba(255,255,255,0.5)";
  context.fillText(`导出于 ${formatDateTime(exportPayload.exported_at || new Date().toISOString())} · 修订 R${trip.revision ?? "—"}`, PAGE_MARGIN, 317);

  drawMap(context, { x: PAGE_MARGIN, y: 402, width: CONTENT_WIDTH, height: 650 }, trip, route);

  const metricGap = 24;
  const metricWidth = (CONTENT_WIDTH - metricGap * 2) / 3;
  drawMetricCard(
    context,
    PAGE_MARGIN,
    1092,
    metricWidth,
    "总里程",
    formatDistance(route?.distance_meters),
    COLORS.blue,
    `${route?.legs?.length ?? 0} 段路线`
  );
  drawMetricCard(
    context,
    PAGE_MARGIN + metricWidth + metricGap,
    1092,
    metricWidth,
    "预计驾驶",
    formatDuration(route?.duration_seconds),
    COLORS.cyan,
    `${stopsOf(trip).length} 个站点`
  );
  drawMetricCard(
    context,
    PAGE_MARGIN + (metricWidth + metricGap) * 2,
    1092,
    metricWidth,
    "预计收费",
    route ? `¥${Math.round(finiteNumber(route.tolls_yuan) ?? 0)}` : "—",
    COLORS.orange,
    `${route?.traffic_lights ?? 0} 个红绿灯`
  );

  fillRoundedRect(context, PAGE_MARGIN, 1294, CONTENT_WIDTH, 300, 24, COLORS.card);
  strokeRoundedRect(context, PAGE_MARGIN, 1294, CONTENT_WIDTH, 300, 24, COLORS.line, 2);
  setFont(context, 18, 700);
  context.fillStyle = COLORS.blue;
  context.textBaseline = "top";
  context.fillText("TRIP SNAPSHOT", PAGE_MARGIN + 28, 1322);
  setFont(context, 30, 700);
  context.fillStyle = COLORS.ink;
  context.fillText(route?.label || "行程概览", PAGE_MARGIN + 28, 1354);

  const strategy = STRATEGY_LABELS[trip.preferences?.strategy] ?? "未设置偏好";
  let pillX = PAGE_MARGIN + 28;
  pillX += drawPill(context, pillX, 1410, strategy, { fill: COLORS.blueSoft, color: COLORS.blue }) + 12;
  pillX += drawPill(context, pillX, 1410, routeSourceLabel(route), { fill: COLORS.cyanSoft, color: "#168494" }) + 12;
  if (["stale", "failed"].includes(trip.route_status)) {
    drawPill(context, pillX, 1410, "路线数据可能已过期", { fill: COLORS.yellowSoft, color: COLORS.yellow });
  }

  setFont(context, 20, 500);
  const summary = route
    ? `当前选择 ${route.label || "路线"}，共 ${route.legs?.length ?? 0} 段。详细站点、时间安排与各段车程见后续页面。`
    : "当前行程尚未生成可用路线。PDF 已保留站点与备注，完成规划后再次导出即可获得完整里程与时间。";
  const summaryLines = wrapText(context, summary, CONTENT_WIDTH - 56, 3);
  drawTextLines(context, summaryLines, PAGE_MARGIN + 28, 1474, 30, { fill: COLORS.inkSoft });

  return page;
}

function computeTimeline(trip, route) {
  const stops = stopsOf(trip);
  const legs = route?.legs ?? [];
  const legByTo = new Map(legs.map((leg) => [leg.to_stop_id, leg]));
  let cursor = null;
  return stops.map((stop, index) => {
    let arrive = null;
    if (index > 0 && cursor) {
      const leg = legByTo.get(stop.id) ?? legs[index - 1] ?? null;
      const duration = finiteNumber(leg?.duration_seconds);
      if (duration !== null) arrive = new Date(cursor.getTime() + duration * 1000);
    }
    let depart = null;
    if (stop.role !== "destination") {
      const parsed = stop.depart_at ? new Date(stop.depart_at) : null;
      if (parsed && !Number.isNaN(parsed.getTime())) depart = parsed;
      if (!depart && arrive) {
        depart = new Date(arrive.getTime() + (finiteNumber(stop.stay_minutes) ?? 0) * 60000);
      }
    }
    const stayMinutes = arrive && depart ? Math.round((depart.getTime() - arrive.getTime()) / 60000) : null;
    cursor = depart;
    return { stop, arrive, depart, stayMinutes, conflict: stayMinutes !== null && stayMinutes < 0 };
  });
}

function stopRoleLabel(index, total) {
  if (index === 0) return "起点";
  if (index === total - 1) return "终点";
  return `途经 ${index}`;
}

function timeSummary(entry, index, total) {
  const parts = [];
  if (entry.arrive) parts.push(`${formatDateTime(entry.arrive, { includeYear: false })} 到达`);
  if (entry.conflict) parts.push("离开时间早于预计到达");
  else if (entry.stayMinutes > 0) parts.push(`停留 ${formatStay(entry.stayMinutes)}`);
  if (entry.depart && index < total - 1) {
    parts.push(`${formatDateTime(entry.depart, { includeYear: false })} ${index === 0 ? "出发" : "离开"}`);
  }
  return parts.join("  ·  ");
}

// 详情页排版：纯文字、完整换行、不截断。左列为角色标签，右列为内容。
const DETAIL_LABEL_WIDTH = 104;

function measureStopBlock(context, entry, index, total) {
  const width = CONTENT_WIDTH - DETAIL_LABEL_WIDTH;
  setFont(context, 27, 600);
  const nameLines = wrapText(context, entry.stop.name || "未命名站点", width);
  setFont(context, 20, 400);
  const addressLines = wrapText(context, `地址：${entry.stop.address || "未填写"}`, width);
  const timing = timeSummary(entry, index, total);
  const timingLines = timing ? wrapText(context, `时间：${timing}`, width) : [];
  const noteLines = entry.stop.note ? wrapText(context, `备注：${entry.stop.note}`, width) : [];
  const bodyLines = addressLines.length + timingLines.length + noteLines.length;
  const height = nameLines.length * 36 + 10 + bodyLines * 30 + 34;
  return { nameLines, addressLines, timingLines, noteLines, height };
}

function drawDetailHeader(context, tripName, subtitle) {
  setFont(context, 18, 600);
  let headerText = `自驾规划 · ${tripName}`;
  if (context.measureText(headerText).width > 660) headerText = "自驾规划 · 行程手册";
  context.fillStyle = COLORS.inkMuted;
  context.textBaseline = "top";
  context.fillText(headerText, PAGE_MARGIN, 54);
  setFont(context, 17, 400);
  context.textAlign = "right";
  context.fillText(subtitle, PAGE_WIDTH - PAGE_MARGIN, 56);
  context.textAlign = "left";
  context.strokeStyle = COLORS.line;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(PAGE_MARGIN, 92);
  context.lineTo(PAGE_WIDTH - PAGE_MARGIN, 92);
  context.stroke();
}

function drawSimpleSectionTitle(context, y, title, description = "") {
  setFont(context, 32, 700);
  context.fillStyle = COLORS.ink;
  context.textBaseline = "top";
  context.fillText(title, PAGE_MARGIN, y);
  let used = 48;
  if (description) {
    setFont(context, 19, 400);
    const lines = wrapText(context, description, CONTENT_WIDTH);
    used += drawTextLines(context, lines, PAGE_MARGIN, y + 48, 28, { fill: COLORS.inkMuted }) + 6;
  }
  return y + used + 18;
}

function drawLegLine(context, y, leg, outdated) {
  const text = leg
    ? `↓ 车程 ${formatDistance(leg.distance_meters)} · ${formatDuration(leg.duration_seconds)}${outdated ? "（旧路线，仅供参考）" : ""}`
    : "↓ 车程数据尚未生成";
  setFont(context, 19, 400);
  context.fillStyle = COLORS.inkMuted;
  context.textBaseline = "top";
  context.fillText(text, PAGE_MARGIN + DETAIL_LABEL_WIDTH, y + 12);
  return 50;
}

function drawStopBlock(context, y, entry, index, total, measured) {
  setFont(context, 19, 700);
  context.fillStyle = COLORS.inkMuted;
  context.textBaseline = "top";
  context.fillText(stopRoleLabel(index, total), PAGE_MARGIN, y + 7);

  const textX = PAGE_MARGIN + DETAIL_LABEL_WIDTH;
  let cursor = y;
  setFont(context, 27, 600);
  cursor += drawTextLines(context, measured.nameLines, textX, cursor, 36, { fill: COLORS.ink });
  cursor += 10;
  setFont(context, 20, 400);
  cursor += drawTextLines(context, measured.addressLines, textX, cursor, 30, {
    fill: COLORS.inkSoft
  });
  if (measured.timingLines.length) {
    setFont(context, 20, 400);
    cursor += drawTextLines(context, measured.timingLines, textX, cursor, 30, {
      fill: entry.conflict ? COLORS.red : COLORS.ink
    });
  }
  if (measured.noteLines.length) {
    setFont(context, 20, 400);
    cursor += drawTextLines(context, measured.noteLines, textX, cursor, 30, {
      fill: COLORS.inkSoft
    });
  }
  context.strokeStyle = COLORS.line;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(PAGE_MARGIN, y + measured.height - 14);
  context.lineTo(PAGE_WIDTH - PAGE_MARGIN, y + measured.height - 14);
  context.stroke();
}

function measureRouteRow(context, route, selected, index) {
  const name = `${route.label || `路线 ${index + 1}`}${selected ? "（当前选择）" : ""}`;
  setFont(context, 23, 600);
  const nameLines = wrapText(context, name, CONTENT_WIDTH);
  const metricsText = `预计时间 ${formatDuration(route.duration_seconds)} · 总里程 ${formatDistance(route.distance_meters)} · 预计收费 ¥${Math.round(finiteNumber(route.tolls_yuan) ?? 0)} · 红绿灯 ${route.traffic_lights ?? 0} 个 · 共 ${route.legs?.length ?? 0} 段`;
  setFont(context, 19, 400);
  const metricsLines = wrapText(context, metricsText, CONTENT_WIDTH);
  return {
    nameLines,
    metricsLines,
    selected,
    height: nameLines.length * 32 + 6 + metricsLines.length * 28 + 30
  };
}

function drawRouteRow(context, y, measured) {
  let cursor = y;
  setFont(context, 23, 600);
  cursor += drawTextLines(context, measured.nameLines, PAGE_MARGIN, cursor, 32, {
    fill: measured.selected ? COLORS.blue : COLORS.ink
  });
  cursor += 6;
  setFont(context, 19, 400);
  drawTextLines(context, measured.metricsLines, PAGE_MARGIN, cursor, 28, {
    fill: COLORS.inkSoft
  });
  context.strokeStyle = COLORS.line;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(PAGE_MARGIN, y + measured.height - 12);
  context.lineTo(PAGE_WIDTH - PAGE_MARGIN, y + measured.height - 12);
  context.stroke();
}

function renderDetailPages(exportPayload) {
  const trip = exportPayload.trip ?? {};
  const route = selectedRoute(trip);
  const timeline = computeTimeline(trip, route);
  const legs = route?.legs ?? [];
  const legByTo = new Map(legs.map((leg) => [leg.to_stop_id, leg]));
  const outdated = ["stale", "failed"].includes(trip.route_status);
  const pages = [];
  let page;
  let context;
  let cursor;

  const startPage = () => {
    page = createPage("detail");
    context = page.context;
    drawDetailHeader(
      context,
      trip.name || "自驾行程",
      `修订 R${trip.revision ?? "—"} · ${routeSourceLabel(route)}`
    );
    cursor = 132;
    pages.push(page);
  };

  startPage();
  cursor = drawSimpleSectionTitle(
    context,
    cursor,
    "逐站行程",
    `${timeline.length} 个站点 · 总里程 ${formatDistance(route?.distance_meters)} · 预计驾驶 ${formatDuration(route?.duration_seconds)}`
  );

  if (timeline.length === 0) {
    setFont(context, 20, 400);
    context.fillStyle = COLORS.inkSoft;
    context.textBaseline = "top";
    context.fillText(
      "还没有站点。回到自驾规划页面设置起点与终点后，再次导出即可生成完整行程。",
      PAGE_MARGIN,
      cursor + 8
    );
    cursor += 60;
  }

  timeline.forEach((entry, index) => {
    const leg =
      index > 0 ? legByTo.get(entry.stop.id) ?? legs[index - 1] ?? null : null;
    const measured = measureStopBlock(context, entry, index, timeline.length);
    const required = measured.height + (index > 0 ? 50 : 0);
    if (cursor + required > PAGE_BOTTOM) {
      startPage();
      cursor = drawSimpleSectionTitle(context, cursor, "逐站行程（续）");
    }
    if (index > 0) cursor += drawLegLine(context, cursor, leg, outdated);
    drawStopBlock(context, cursor, entry, index, timeline.length, measured);
    cursor += measured.height;
  });

  const routes = trip.route_options ?? [];
  if (routes.length) {
    if (cursor + 220 > PAGE_BOTTOM) startPage();
    else cursor += 26;
    cursor = drawSimpleSectionTitle(
      context,
      cursor,
      "候选路线",
      `共 ${routes.length} 条方案，标注“当前选择”的为地图上显示的路线`
    );
    routes.forEach((candidate, index) => {
      const measured = measureRouteRow(context, candidate, candidate.id === route?.id, index);
      if (cursor + measured.height > PAGE_BOTTOM) {
        startPage();
        cursor = drawSimpleSectionTitle(context, cursor, "候选路线（续）");
      }
      drawRouteRow(context, cursor, measured);
      cursor += measured.height;
    });
  }

  return pages;
}

function drawFooter(page, pageNumber, totalPages, exportPayload) {
  const { context } = page;
  context.strokeStyle = COLORS.line;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(PAGE_MARGIN, 1664);
  context.lineTo(PAGE_WIDTH - PAGE_MARGIN, 1664);
  context.stroke();
  setFont(context, 16, 500);
  context.fillStyle = COLORS.inkMuted;
  context.textBaseline = "top";
  context.fillText("自驾规划 · 行程手册", PAGE_MARGIN, 1683);
  context.textAlign = "center";
  context.fillText(
    `数据快照 ${formatDateTime(exportPayload.exported_at || new Date().toISOString())}`,
    PAGE_WIDTH / 2,
    1683
  );
  context.textAlign = "right";
  context.fillText(`${pageNumber} / ${totalPages}`, PAGE_WIDTH - PAGE_MARGIN, 1683);
  context.textAlign = "left";
}

function renderPages(exportPayload) {
  const pages = [renderCover(exportPayload), ...renderDetailPages(exportPayload)];
  pages.forEach((page, index) => drawFooter(page, index + 1, pages.length, exportPayload));
  return pages;
}

function canvasToJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error("PDF 页面渲染失败。"));
          return;
        }
        resolve(new Uint8Array(await blob.arrayBuffer()));
      },
      "image/jpeg",
      0.92
    );
  });
}

function encodeText(value) {
  return new TextEncoder().encode(value);
}

function concatBytes(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function buildPdf(images) {
  const objectCount = 2 + images.length * 3;
  const objects = new Map();
  const pageObjectNumbers = [];

  images.forEach((image, index) => {
    const imageObject = 3 + index * 3;
    const contentObject = imageObject + 1;
    const pageObject = imageObject + 2;
    const imageName = `Im${index + 1}`;
    pageObjectNumbers.push(pageObject);

    objects.set(
      imageObject,
      concatBytes([
        encodeText(
          `<< /Type /XObject /Subtype /Image /Width ${PAGE_WIDTH} /Height ${PAGE_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`
        ),
        image,
        encodeText("\nendstream")
      ])
    );

    const content = `q\n${PDF_PAGE_WIDTH} 0 0 ${PDF_PAGE_HEIGHT} 0 0 cm\n/${imageName} Do\nQ`;
    objects.set(
      contentObject,
      encodeText(`<< /Length ${encodeText(content).length} >>\nstream\n${content}\nendstream`)
    );
    objects.set(
      pageObject,
      encodeText(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /XObject << /${imageName} ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`
      )
    );
  });

  objects.set(1, encodeText("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.set(
    2,
    encodeText(
      `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${images.length} >>`
    )
  );

  const header = new Uint8Array([
    0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xff, 0xff, 0xff, 0xff, 0x0a
  ]);
  const chunks = [header];
  const offsets = new Array(objectCount + 1).fill(0);
  let byteOffset = header.length;

  for (let objectNumber = 1; objectNumber <= objectCount; objectNumber += 1) {
    const body = objects.get(objectNumber);
    if (!body) throw new Error(`PDF 对象 ${objectNumber} 缺失。`);
    offsets[objectNumber] = byteOffset;
    const prefix = encodeText(`${objectNumber} 0 obj\n`);
    const suffix = encodeText("\nendobj\n");
    chunks.push(prefix, body, suffix);
    byteOffset += prefix.length + body.length + suffix.length;
  }

  const xrefOffset = byteOffset;
  const xrefRows = [
    `xref\n0 ${objectCount + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  ];
  chunks.push(encodeText(xrefRows.join("")));
  return new Blob(chunks, { type: "application/pdf" });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function downloadTripPdf(exportPayload) {
  if (!exportPayload?.trip) throw new Error("没有可导出的行程数据。");
  await document.fonts?.ready?.catch?.(() => undefined);
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));

  const pages = renderPages(exportPayload);
  const images = [];
  for (const page of pages) images.push(await canvasToJpeg(page.canvas));
  const pdf = buildPdf(images);
  const filename = `${sanitizeFilename(exportPayload.trip.name)}.pdf`;
  triggerDownload(pdf, filename);

  pages.forEach((page) => {
    page.canvas.width = 1;
    page.canvas.height = 1;
  });
  return { filename, pages: pages.length, bytes: pdf.size };
}
