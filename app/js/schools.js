// 學校圖層：校地多邊形與步行生活圈。

import { SCHOOL_BASE, SCHOOL_COLOR, WALKSHED_M } from './config.js';

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
function walkshedFor(feature) {
  const geo = L.geoJSON(feature);
  const c = geo.getBounds().getCenter();
  const color = SCHOOL_COLOR[feature.properties.level] ?? SCHOOL_COLOR['其他'];
  return L.circle(c, {
    radius: WALKSHED_M,
    color,
    weight: 1,
    opacity: 0.5,
    dashArray: '4 4',
    fill: false,
    interactive: false,
  });
}

export async function loadCounty(map, county, { onProgress, levels } = {}) {
  for (const l of [blockLayer, shedLayer]) if (l) map.removeLayer(l);
  blockLayer = shedLayer = null;

  const t0 = performance.now();
  onProgress?.(`載入 ${county} 學校資料…`);

  const res = await fetch(`${SCHOOL_BASE}/${encodeURIComponent(county)}.geojson`);
  if (!res.ok) throw new Error(`${county} 學校資料載入失敗（HTTP ${res.status}）`);
  const fc = await res.json();

  const want = levels ? new Set(levels) : null;
  const feats = want ? fc.features.filter((f) => want.has(f.properties.level)) : fc.features;

  shedLayer = L.layerGroup(feats.map(walkshedFor)).addTo(map);
  blockLayer = L.geoJSON({ type: 'FeatureCollection', features: feats }, {
    style: styleFor,
  }).addTo(map);

  return {
    county,
    count: feats.length,
    total: fc.features.length,
    ms: Math.round(performance.now() - t0),
  };
}

export function getLayers() {
  return { blockLayer, shedLayer };
}
