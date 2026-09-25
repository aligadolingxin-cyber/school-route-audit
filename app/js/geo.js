// 幾何輔助：點到 GeoJSON 幾何的最短距離（公尺）。
//
// 詳細面板要陳述「該路段周邊 N 公尺內的事故」，那句話必須是真的。
// 用外接矩形近似會在長路段上高估甚多，故實算點到每條邊的距離。

const R = 6371008.8;   // 地球平均半徑（公尺）
const rad = (d) => (d * Math.PI) / 180;

/**
 * 於本地切平面上把經緯度換成公尺。
 * 台灣的尺度下誤差可忽略，且避免引入投影函式庫。
 */
function toLocalMeters(lon, lat, lon0, lat0) {
  const x = rad(lon - lon0) * R * Math.cos(rad(lat0));
  const y = rad(lat - lat0) * R;
  return [x, y];
}

/** 點到線段的最短距離。 */
function pointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** 走訪幾何中所有的環／線，回傳座標陣列的陣列。 */
function ringsOf(geometry) {
  const g = geometry;
  switch (g.type) {
    case 'LineString': return [g.coordinates];
    case 'MultiLineString': return g.coordinates;
    case 'Polygon': return g.coordinates;
    case 'MultiPolygon': return g.coordinates.flat();
    case 'Point': return [[g.coordinates]];
    default: return [];
  }
}

/**
 * 點到幾何邊界的最短距離（公尺）。
 * 點落在多邊形內時仍回傳到邊界的距離，不回傳 0——本用途只關心鄰近程度。
 */
export function distanceTo(geometry, lon, lat) {
  let best = Infinity;
  for (const ring of ringsOf(geometry)) {
    if (ring.length === 1) {
      const [x, y] = toLocalMeters(ring[0][0], ring[0][1], lon, lat);
      best = Math.min(best, Math.hypot(x, y));
      continue;
    }
    for (let i = 1; i < ring.length; i += 1) {
      const [ax, ay] = toLocalMeters(ring[i - 1][0], ring[i - 1][1], lon, lat);
      const [bx, by] = toLocalMeters(ring[i][0], ring[i][1], lon, lat);
      best = Math.min(best, pointToSegment(0, 0, ax, ay, bx, by));
      if (best === 0) return 0;
    }
  }
  return best;
}

/** 幾何的外接矩形，供先行篩選以免逐一實算。 */
export function boundsOf(geometry) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const ring of ringsOf(geometry)) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

/** 公尺換算成本地的經緯度差，供外接矩形外擴。 */
export function metersToDegrees(m, lat) {
  return { dLat: m / 110540, dLon: m / (111320 * Math.cos(rad(lat)) || 1) };
}
