// 學校圖層：校地多邊形與步行生活圈。

import { SCHOOL_BASE, SCHOOL_COLOR } from './config.js';

let blockLayer = null;
let shedLayer = null;

function styleFor(feature) {
  const color = SCHOOL_COLOR[feature.properties.level] ?? SCHOOL_COLOR['其他'];
  return { color, weight: 1.5, opacity: 0.95, fillColor: color, fillOpacity: 0.25 };
}

/**
 * 以校地多邊形的中心繪製生活圈。
 *
 * 這是直線距離的近似，不是路網可達範圍——實際能不能走到，
 * 正是本工具其餘圖層要回答的問題。
 */
function walkshedFor(feature, radius) {
  const geo = L.geoJSON(feature);
  const c = geo.getBounds().getCenter();
  const color = SCHOOL_COLOR[feature.properties.level] ?? SCHOOL_COLOR['其他'];
  return L.circle(c, {
    radius,
    color,
    weight: 1,
    opacity: 0.5,
    dashArray: '4 4',
    fill: false,
    interactive: false,
  });
}

const cache = new Map();

/** 取得該縣市的學校資料，同一縣市只抓一次。 */
export async function fetchCounty(county) {
  if (cache.has(county)) return cache.get(county);
  const res = await fetch(`${SCHOOL_BASE}/${encodeURIComponent(county)}.geojson`);
  if (!res.ok) throw new Error(`${county} 學校資料載入失敗（HTTP ${res.status}）`);
  const fc = await res.json();
  cache.set(county, fc);
  return fc;
}

/** 依目前的類型篩選與生活圈半徑重繪。資料已快取時不重抓。 */
export async function render(map, county, { levels, radius, visible = true } = {}) {
  for (const l of [blockLayer, shedLayer]) if (l) map.removeLayer(l);
  blockLayer = shedLayer = null;

  const fc = await fetchCounty(county);
  if (!visible) return { county, count: 0, total: fc.features.length, levels: {} };

  const want = levels ? new Set(levels) : null;
  const feats = want ? fc.features.filter((f) => want.has(f.properties.level)) : fc.features;

  shedLayer = L.layerGroup(feats.map((f) => walkshedFor(f, radius))).addTo(map);
  blockLayer = L.geoJSON({ type: 'FeatureCollection', features: feats }, { style: styleFor })
    .addTo(map);

  const byLevel = {};
  for (const f of feats) byLevel[f.properties.level] = (byLevel[f.properties.level] ?? 0) + 1;
  return { county, count: feats.length, total: fc.features.length, levels: byLevel };
}

export function clear(map) {
  for (const l of [blockLayer, shedLayer]) if (l) map.removeLayer(l);
  blockLayer = shedLayer = null;
}

export function getLayers() {
  return { blockLayer, shedLayer };
}
