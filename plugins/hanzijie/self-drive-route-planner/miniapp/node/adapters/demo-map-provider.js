import { randomUUID } from "node:crypto";

const EARTH_RADIUS_METERS = 6_371_000;

const DEMO_PLACES = Object.freeze([
  ["demo-tiananmen", "北京·天安门", "北京市", "东城区东长安街", 116.397477, 39.908692],
  ["demo-yungang", "云冈石窟", "大同市", "云冈区云冈镇", 113.134025, 40.109209],
  ["demo-pingyao", "平遥古城", "晋中市", "平遥县康宁路", 112.18135, 37.204965],
  ["demo-dayanta", "西安·大雁塔", "西安市", "雁塔区雁塔南路", 108.964165, 34.218984],
  ["demo-kuanzhai", "成都·宽窄巷子", "成都市", "青羊区长顺上街", 104.05984, 30.66302],
  ["demo-westlake", "杭州西湖", "杭州市", "西湖区龙井路", 120.148523, 30.24229],
  ["demo-bund", "上海外滩", "上海市", "黄浦区中山东一路", 121.490317, 31.241701],
  ["demo-zhuozheng", "苏州拙政园", "苏州市", "姑苏区东北街", 120.62931, 31.32609],
  ["demo-sunyatsen", "南京中山陵", "南京市", "玄武区石象路", 118.848973, 32.057366],
  ["demo-yellowcrane", "武汉黄鹤楼", "武汉市", "武昌区蛇山西山坡", 114.306165, 30.544028],
  ["demo-mogao", "敦煌莫高窟", "酒泉市", "敦煌市东南鸣沙山东麓", 94.809104, 40.042508],
  ["demo-danxia", "张掖七彩丹霞", "张掖市", "临泽县倪家营镇", 100.06538, 38.917939]
].map(([id, name, city, address, longitude, latitude]) => ({
  id,
  poi_id: id,
  name,
  city,
  address,
  location: { longitude, latitude },
  provider: "demo",
  is_demo: true
})));

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function distanceBetween(a, b) {
  const latitudeDelta = toRadians(b.latitude - a.latitude);
  const longitudeDelta = toRadians(b.longitude - a.longitude);
  const latitudeA = toRadians(a.latitude);
  const latitudeB = toRadians(b.latitude);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(value));
}

function buildSegmentGeometry(start, end, bend) {
  const longitudeDelta = end.longitude - start.longitude;
  const latitudeDelta = end.latitude - start.latitude;
  const length = Math.hypot(longitudeDelta, latitudeDelta) || 1;
  const perpendicularLongitude = (-latitudeDelta / length) * bend;
  const perpendicularLatitude = (longitudeDelta / length) * bend;
  return [
    { ...start },
    {
      longitude: start.longitude + longitudeDelta * 0.28 + perpendicularLongitude,
      latitude: start.latitude + latitudeDelta * 0.28 + perpendicularLatitude
    },
    {
      longitude: start.longitude + longitudeDelta * 0.68 - perpendicularLongitude * 0.45,
      latitude: start.latitude + latitudeDelta * 0.68 - perpendicularLatitude * 0.45
    },
    { ...end }
  ];
}

const ROUTE_VARIANTS = [
  { label: "智能推荐", factor: 1.12, speed: 78, tollRate: 0.19, bend: 0.12 },
  { label: "少收费备选", factor: 1.18, speed: 70, tollRate: 0.09, bend: -0.19 },
  { label: "高速优先备选", factor: 1.15, speed: 86, tollRate: 0.24, bend: 0.24 }
];

export class DemoMapProvider {
  mode = "demo";

  async searchPlaces({ query, city }) {
    const normalizedQuery = String(query).trim().toLocaleLowerCase("zh-CN");
    const normalizedCity = String(city ?? "").trim().toLocaleLowerCase("zh-CN");
    return DEMO_PLACES.filter((place) => {
      const text = `${place.name} ${place.city} ${place.address}`.toLocaleLowerCase("zh-CN");
      return (
        text.includes(normalizedQuery) &&
        (!normalizedCity || text.includes(normalizedCity.replace(/市$/, "")))
      );
    }).map((place) => structuredClone(place));
  }

  async planRoute(trip) {
    const stops = [trip.origin, ...trip.waypoints, trip.destination];

    return ROUTE_VARIANTS.map((variant, variantIndex) => {
      const legs = [];
      const geometry = [];
      let totalDistance = 0;
      let totalDuration = 0;

      for (let index = 0; index < stops.length - 1; index += 1) {
        const start = stops[index];
        const end = stops[index + 1];
        const directDistance = distanceBetween(start.location, end.location);
        const distanceMeters = Math.round(directDistance * variant.factor);
        const durationSeconds = Math.round(
          (distanceMeters / 1000 / variant.speed) * 3600 + 12 * 60
        );
        const segmentGeometry = buildSegmentGeometry(
          start.location,
          end.location,
          variant.bend * (1 + index * 0.2)
        );
        geometry.push(...(index === 0 ? segmentGeometry : segmentGeometry.slice(1)));
        totalDistance += distanceMeters;
        totalDuration += durationSeconds;
        legs.push({
          from_stop_id: start.id,
          to_stop_id: end.id,
          from_name: start.name,
          to_name: end.name,
          distance_meters: distanceMeters,
          duration_seconds: durationSeconds
        });
      }

      return {
        id: randomUUID(),
        trip_revision: trip.revision,
        label: variant.label,
        strategy: trip.preferences.strategy,
        provider: "demo",
        is_demo: true,
        distance_meters: totalDistance,
        duration_seconds: totalDuration,
        tolls_yuan: Math.round((totalDistance / 1000) * variant.tollRate),
        traffic_lights: 18 + variantIndex * 7 + stops.length * 3,
        restriction: "unknown",
        geometry,
        legs,
        generated_at: new Date().toISOString()
      };
    });
  }
}
