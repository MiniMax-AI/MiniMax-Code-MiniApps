const IMAGE_WIDTH = 900;
const IMAGE_HEIGHT = 1200;
const MAX_CHARS = 100;
const FONT_FAMILY =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif';

const COLORS = Object.freeze({
  ink: "#1f2433",
  muted: "#687086",
  subtle: "#a5adbd",
  line: "#e8ebf2",
  blue: "#4d7cfe",
  purple: "#8b5cf6",
  pink: "#ff5da2",
  orange: "#ff7a1a",
  yellow: "#ffc53d",
  green: "#1fc16b",
  red: "#ff5a5f"
});

const ACCENTS = [COLORS.pink, COLORS.purple, COLORS.orange, COLORS.green, COLORS.blue];

function setFont(context, size, weight = 400) {
  context.font = `${weight} ${size}px ${FONT_FAMILY}`;
}

function textLength(value) {
  return Array.from(String(value ?? "")).length;
}

function clipText(value, maxLength) {
  const text = String(value ?? "");
  if (textLength(text) <= maxLength) return text;
  if (maxLength <= 1) return "…";
  return `${Array.from(text).slice(0, maxLength - 1).join("")}…`;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function formatDistance(meters) {
  const value = finiteNumber(meters);
  if (value === null) return "未知里程";
  const kilometers = value / 1000;
  return `${kilometers >= 100 ? Math.round(kilometers) : kilometers.toFixed(1)} km`;
}

function formatDuration(seconds) {
  const value = finiteNumber(seconds);
  if (value === null) return "未知车程";
  const minutes = Math.max(0, Math.round(value / 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}小时${rest ? `${rest}分` : ""}` : `${rest}分钟`;
}

function formatClock(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatDayKey(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDayLabel(dayKey, dayNumber) {
  if (!dayKey) return `D${dayNumber} · 行程概览`;
  const [, month, day] = dayKey.split("-");
  return `D${dayNumber} · ${Number(month)}月${Number(day)}日`;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
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

function computeTimeline(trip, route) {
  const stops = stopsOf(trip);
  const legs = route?.legs ?? [];
  const legByTo = new Map(legs.map((leg) => [leg.to_stop_id, leg]));
  const entries = [];
  let cursor = null;

  stops.forEach((stop, index) => {
    let arrive = null;
    const leg = index > 0 ? legByTo.get(stop.id) ?? legs[index - 1] ?? null : null;
    const duration = finiteNumber(leg?.duration_seconds);
    if (index > 0 && cursor && duration !== null) {
      arrive = new Date(cursor.getTime() + duration * 1000);
    }

    let depart = null;
    if (stop.role !== "destination") {
      if (stop.depart_at) {
        const parsed = new Date(stop.depart_at);
        if (!Number.isNaN(parsed.getTime())) depart = parsed;
      }
      if (!depart && arrive) {
        depart = new Date(arrive.getTime() + (Number(stop.stay_minutes) || 0) * 60000);
      }
    }

    entries.push({ stop, index, arrive, depart, leg });
    cursor = depart;
  });
  return entries;
}

function buildDailyPages(trip, route) {
  const groups = new Map();
  const entries = computeTimeline(trip, route);

  entries.forEach((entry) => {
    const dayKey = formatDayKey(entry.depart ?? entry.arrive);
    if (!groups.has(dayKey)) groups.set(dayKey, []);
    const arrival = formatClock(entry.arrive);
    const departure = formatClock(entry.depart);
    const time =
      arrival && departure && arrival !== departure
        ? `${arrival}-${departure}`
        : departure
          ? `${departure}出发`
          : arrival
            ? `${arrival}到达`
            : "时间待定";
    const driving = entry.leg
      ? `驾车${formatDistance(entry.leg.distance_meters)}·${formatDuration(entry.leg.duration_seconds)}`
      : "起点安排";
    groups.get(dayKey).push({
      itinerary: `${time} ${entry.stop.name}（${driving}）`,
      note: entry.stop.note?.trim() || "未填写活动安排"
    });
  });

  if (groups.size === 0) {
    groups.set(null, []);
  }

  const pages = [];
  let dayNumber = 1;
  for (const [dayKey, entriesForDay] of groups) {
    const title = formatDayLabel(dayKey, dayNumber);
    const chunks = [];
    let chunk = [];
    for (const entry of entriesForDay) {
      const candidate = composeDailyPage(title, [...chunk, entry]);
      if (chunk.length > 0 && textLength(candidate.markdown) > MAX_CHARS) {
        chunks.push(chunk);
        chunk = [entry];
      } else {
        chunk.push(entry);
      }
    }
    if (chunk.length > 0 || chunks.length === 0) chunks.push(chunk);

    chunks.forEach((chunkEntries, chunkIndex) => {
      const pageTitle = chunks.length > 1 ? `${title}（${chunkIndex + 1}）` : title;
      pages.push(composeDailyPage(pageTitle, chunkEntries));
    });
    dayNumber += 1;
  }
  return pages;
}

function composeDailyPage(title, entries) {
  let itinerary = entries.map((entry) => entry.itinerary).join("；");
  let note = entries.map((entry) => entry.note).join("；") || "未填写活动安排";
  const prefix = `# ${title}\n行程：\n备注：`;
  const bodyBudget = Math.max(0, MAX_CHARS - textLength(prefix));

  if (textLength(itinerary) + textLength(note) > bodyBudget) {
    const noteBudget = Math.max(10, Math.floor(bodyBudget * 0.46));
    note = clipText(note, Math.min(noteBudget, bodyBudget));
    itinerary = clipText(itinerary, Math.max(0, bodyBudget - textLength(note)));
  }

  let markdown = `${prefix}${itinerary}\n${note}`;
  while (textLength(markdown) > MAX_CHARS && (note || itinerary)) {
    if (textLength(note) >= textLength(itinerary) && note) note = clipText(note, textLength(note) - 1);
    else if (itinerary) itinerary = clipText(itinerary, textLength(itinerary) - 1);
    markdown = `${prefix}${itinerary}\n${note}`;
  }

  return { title, itinerary, note, markdown };
}

function wrapText(context, value, maxWidth, maxLines = Number.POSITIVE_INFINITY) {
  const lines = [];
  for (const paragraph of String(value ?? "").split("\n")) {
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
    lines.push(current);
  }
  if (lines.length <= maxLines) return lines;
  const clipped = lines.slice(0, maxLines);
  clipped[maxLines - 1] = clipText(clipped[maxLines - 1], Math.max(1, clipped[maxLines - 1].length - 1));
  return clipped;
}

function drawLines(context, lines, x, y, lineHeight, { color = COLORS.ink, align = "left" } = {}) {
  context.fillStyle = color;
  context.textAlign = align;
  context.textBaseline = "top";
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  context.textAlign = "left";
  return lines.length * lineHeight;
}

function fillRoundedRect(context, x, y, width, height, radius, fill) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
}

function createCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = IMAGE_WIDTH;
  canvas.height = IMAGE_HEIGHT;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("浏览器无法创建小红书图片画布。");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
  return { canvas, context };
}

function drawDopamineDecor(context, accent, secondary) {
  context.fillStyle = accent;
  context.fillRect(0, 0, IMAGE_WIDTH, 24);
  context.globalAlpha = 0.16;
  context.beginPath();
  context.arc(812, 122, 170, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = secondary;
  context.beginPath();
  context.arc(72, 1110, 112, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;
}

function drawDailyPage(page, index) {
  const { canvas, context } = createCanvas();
  const accent = ACCENTS[index % ACCENTS.length];
  const secondary = ACCENTS[(index + 2) % ACCENTS.length];
  drawDopamineDecor(context, accent, secondary);

  setFont(context, 18, 700);
  context.fillStyle = accent;
  context.textBaseline = "top";
  context.fillText("自驾规划 · 小红书行程图", 64, 70);

  setFont(context, 46, 800);
  const titleLines = wrapText(context, page.title, 720, 2);
  drawLines(context, titleLines, 64, 126, 60, { color: COLORS.ink });
  let cursor = 126 + titleLines.length * 60 + 46;

  setFont(context, 20, 800);
  context.fillStyle = accent;
  context.fillText("行程", 64, cursor);
  cursor += 44;
  setFont(context, 29, 650);
  const itineraryLines = wrapText(context, page.itinerary || "暂无明确行程", 770, 6);
  cursor += drawLines(context, itineraryLines, 64, cursor, 43, { color: COLORS.ink });

  cursor += 54;
  setFont(context, 20, 800);
  context.fillStyle = secondary;
  context.fillText("备注", 64, cursor);
  cursor += 44;
  setFont(context, 27, 450);
  const noteLines = wrapText(context, page.note || "未填写活动安排", 770, 7);
  drawLines(context, noteLines, 64, cursor, 41, { color: COLORS.muted });

  fillRoundedRect(context, 64, 1056, 772, 72, 20, "#f7f8fc");
  setFont(context, 17, 600);
  context.fillStyle = COLORS.subtle;
  context.textBaseline = "middle";
  context.fillText("Markdown 排版 · 单页不超过 100 字", 88, 1092);
  context.textBaseline = "alphabetic";
  return { canvas, markdown: page.markdown };
}

function projectPoint(point, bounds, rect) {
  const normalized = normalizePoint(point);
  if (!normalized) return null;
  return {
    x:
      rect.x +
      ((normalized.longitude - bounds.minLongitude) / (bounds.maxLongitude - bounds.minLongitude)) * rect.width,
    y:
      rect.y +
      ((bounds.maxLatitude - normalized.latitude) / (bounds.maxLatitude - bounds.minLatitude)) * rect.height
  };
}

function getMapBounds(points) {
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
  const longitudePadding = (maxLongitude - minLongitude) * 0.12;
  const latitudePadding = (maxLatitude - minLatitude) * 0.12;
  return {
    minLongitude: minLongitude - longitudePadding,
    maxLongitude: maxLongitude + longitudePadding,
    minLatitude: minLatitude - latitudePadding,
    maxLatitude: maxLatitude + latitudePadding
  };
}

function traceGeometry(context, geometry, bounds, rect) {
  const points = (geometry ?? []).map(normalizePoint).filter(Boolean);
  if (points.length < 2) return false;
  context.beginPath();
  points.forEach((point, index) => {
    const projected = projectPoint(point, bounds, rect);
    if (index === 0) context.moveTo(projected.x, projected.y);
    else context.lineTo(projected.x, projected.y);
  });
  return true;
}

function drawRouteMapPage(exportPayload) {
  const { canvas, context } = createCanvas();
  const trip = exportPayload.trip ?? {};
  const route = selectedRoute(trip);
  const stops = stopsOf(trip);
  const routePoints = (route?.geometry ?? []).map(normalizePoint).filter(Boolean);
  const stopPoints = stops.map((stop) => stop.location).map(normalizePoint).filter(Boolean);
  const points = [...routePoints, ...stopPoints];
  const bounds = getMapBounds(points);
  const accent = COLORS.blue;
  drawDopamineDecor(context, accent, COLORS.pink);

  setFont(context, 18, 700);
  context.fillStyle = accent;
  context.textBaseline = "top";
  context.fillText("自驾规划 · 小红书行程图", 64, 70);
  setFont(context, 50, 800);
  drawLines(context, ["路线图"], 64, 126, 60, { color: COLORS.ink });
  setFont(context, 23, 500);
  drawLines(context, [clipText(trip.name || "自驾行程", 28)], 64, 198, 32, { color: COLORS.muted });

  const rect = { x: 54, y: 270, width: 792, height: 620 };
  fillRoundedRect(context, rect.x, rect.y, rect.width, rect.height, 28, "#f8faff");
  context.save();
  context.beginPath();
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.clip();
  context.strokeStyle = "#dce4f5";
  context.globalAlpha = 0.72;
  context.lineWidth = 1;
  for (let x = rect.x + 24; x < rect.x + rect.width; x += 48) {
    context.beginPath();
    context.moveTo(x, rect.y);
    context.lineTo(x, rect.y + rect.height);
    context.stroke();
  }
  for (let y = rect.y + 24; y < rect.y + rect.height; y += 48) {
    context.beginPath();
    context.moveTo(rect.x, y);
    context.lineTo(rect.x + rect.width, y);
    context.stroke();
  }
  context.globalAlpha = 1;

  if (bounds) {
    const alternateRoutes = (trip.route_options ?? []).filter((candidate) => candidate.id !== route?.id);
    alternateRoutes.forEach((candidate) => {
      if (!traceGeometry(context, candidate.geometry, bounds, rect)) return;
      context.strokeStyle = "#bfc9dd";
      context.globalAlpha = 0.36;
      context.lineWidth = 8;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.stroke();
    });
    context.globalAlpha = 1;
    if (traceGeometry(context, route?.geometry?.length ? route.geometry : stopPoints, bounds, rect)) {
      context.strokeStyle = "#ffffff";
      context.lineWidth = 22;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.stroke();
      traceGeometry(context, route?.geometry?.length ? route.geometry : stopPoints, bounds, rect);
      context.strokeStyle = accent;
      context.lineWidth = 12;
      context.stroke();
    }

    stops.forEach((stop, index) => {
      const point = projectPoint(stop.location, bounds, rect);
      if (!point) return;
      const color = index === 0 ? COLORS.green : index === stops.length - 1 ? COLORS.red : COLORS.orange;
      context.beginPath();
      context.arc(point.x, point.y, 20, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();
      context.beginPath();
      context.arc(point.x, point.y, 12, 0, Math.PI * 2);
      context.strokeStyle = "#ffffff";
      context.lineWidth = 3;
      context.stroke();
      setFont(context, 16, 800);
      context.fillStyle = "#ffffff";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(index === 0 ? "始" : index === stops.length - 1 ? "终" : String(index), point.x, point.y);
      context.textAlign = "left";

      setFont(context, 18, 650);
      const label = clipText(stop.name, 12);
      const labelWidth = context.measureText(label).width + 24;
      const labelX = Math.min(Math.max(point.x + 26, rect.x + 12), rect.x + rect.width - labelWidth - 12);
      const labelY = point.y < rect.y + 80 ? point.y + 26 : point.y - 42;
      fillRoundedRect(context, labelX, labelY, labelWidth, 32, 12, "rgba(255,255,255,0.94)");
      context.fillStyle = COLORS.ink;
      context.textBaseline = "middle";
      context.fillText(label, labelX + 12, labelY + 16);
    });
  } else {
    setFont(context, 28, 600);
    drawLines(context, ["设置起点和终点后生成路线图"], 450, 560, 40, { color: COLORS.muted, align: "center" });
  }
  context.restore();

  const routeSummary = route
    ? `${formatDistance(route.distance_meters)} · ${formatDuration(route.duration_seconds)} · ${stops.length}站`
    : "路线尚未规划";
  const markdown = `# 路线图\n行程：${clipText(`${trip.origin?.name || "起点"} → ${trip.destination?.name || "终点"}`, 36)}\n备注：${clipText(routeSummary, 36)}`;
  fillRoundedRect(context, 54, 944, 792, 142, 24, "#ffffff");
  context.strokeStyle = COLORS.line;
  context.lineWidth = 2;
  context.stroke();
  setFont(context, 20, 800);
  context.fillStyle = accent;
  context.textBaseline = "top";
  context.fillText("行程", 82, 974);
  setFont(context, 24, 600);
  context.fillStyle = COLORS.ink;
  context.fillText(clipText(`${trip.origin?.name || "起点"} → ${trip.destination?.name || "终点"}`, 36), 82, 1012);
  setFont(context, 18, 500);
  context.fillStyle = COLORS.muted;
  context.fillText(clipText(routeSummary, 48), 82, 1050);
  setFont(context, 16, 600);
  context.fillStyle = COLORS.subtle;
  context.textAlign = "right";
  context.fillText(`生成于 ${formatDateTime(exportPayload.exported_at) || "刚刚"}`, 818, 1110);
  context.textAlign = "left";
  return { canvas, markdown };
}

function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("小红书图片渲染失败。"))),
      "image/png"
    );
  });
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
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function downloadTripXhsImages(exportPayload) {
  if (!exportPayload?.trip) throw new Error("没有可导出的小红书行程数据。");
  await document.fonts?.ready?.catch?.(() => undefined);
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));

  const pages = [drawRouteMapPage(exportPayload), ...buildDailyPages(exportPayload.trip, selectedRoute(exportPayload.trip)).map(drawDailyPage)];
  const baseName = sanitizeFilename(exportPayload.trip.name);
  const files = [];
  for (const [index, page] of pages.entries()) {
    const blob = await canvasToPng(page.canvas);
    const filename = `${baseName}-${String(index + 1).padStart(2, "0")}-${index === 0 ? "路线图" : "行程"}.png`;
    triggerDownload(blob, filename);
    files.push({ filename, bytes: blob.size, markdown: page.markdown });
    page.canvas.width = 1;
    page.canvas.height = 1;
    if (index < pages.length - 1) await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return { pages: files.length, width: IMAGE_WIDTH, height: IMAGE_HEIGHT, files };
}
