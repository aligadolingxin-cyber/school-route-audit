// A1 致命事故點圖層。

import { CRASH_BASE, CRASH_COLOR } from './config.js';

let layer = null;

/** 點徑依死亡人數。白色外圈確保疊在任何底色上都看得見。 */
function markerFor(feature, latlng) {
  const p = feature.properties;
  return L.circleMarker(latlng, {
    radius: 3.5 + Math.min(p.deaths, 4) * 1.4,
    color: '#ffffff',
    weight: 1.4,
    opacity: 0.95,
    fillColor: CRASH_COLOR[p.kind] ?? CRASH_COLOR.vehicle,
    fillOpacity: 0.92,
  });
}

function tooltipFor(p) {
  const d = p.date;
  const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  const time = `${p.time.slice(0, 2)}:${p.time.slice(2, 4)}`;
  const parties = p.parties.length ? p.parties.join('、') : '未提供';
  return `<b>${date} ${time}</b><br>${p.place}<br>死亡 ${p.deaths} 人<br>當事者：${parties}`;
}

export async function loadCounty(map, county, { onProgress } = {}) {
  if (layer) {
    map.removeLayer(layer);
    layer = null;
  }

  const t0 = performance.now();
  onProgress?.(`載入 ${county} 事故資料…`);

  const res = await fetch(`${CRASH_BASE}/${encodeURIComponent(county)}.geojson`);
  if (!res.ok) throw new Error(`${county} 事故資料載入失敗（HTTP ${res.status}）`);
  const fc = await res.json();

  layer = L.geoJSON(fc, {
    pointToLayer: markerFor,
    onEachFeature: (f, l) => l.bindTooltip(tooltipFor(f.properties), { sticky: true }),
  }).addTo(map);

  const deaths = fc.features.reduce((s, f) => s + f.properties.deaths, 0);
  const ped = fc.features.filter((f) => f.properties.kind === 'pedestrian').length;
  return {
    county, years: fc.years, count: fc.features.length, deaths, pedestrian: ped,
    ms: Math.round(performance.now() - t0),
  };
}

export function getLayer() {
  return layer;
}
