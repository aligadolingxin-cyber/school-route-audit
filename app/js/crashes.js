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

const cache = new Map();

/** 取得該縣市的事故資料，同一縣市只抓一次。部分縣市無檔案（該年無 A1 事故）。 */
export async function fetchCounty(county) {
  if (cache.has(county)) return cache.get(county);
  const res = await fetch(`${CRASH_BASE}/${encodeURIComponent(county)}.geojson`);
  if (!res.ok) {
    if (res.status === 404) {
      const empty = { type: 'FeatureCollection', years: [], features: [], missing: true };
      cache.set(county, empty);
      return empty;
    }
    throw new Error(`${county} 事故資料載入失敗（HTTP ${res.status}）`);
  }
  const fc = await res.json();
  cache.set(county, fc);
  return fc;
}

export async function render(map, county, { visible = true } = {}) {
  if (layer) {
    map.removeLayer(layer);
    layer = null;
  }

  const fc = await fetchCounty(county);
  const deaths = fc.features.reduce((s, f) => s + f.properties.deaths, 0);
  const ped = fc.features.filter((f) => f.properties.kind === 'pedestrian').length;
  const stat = { county, years: fc.years, count: fc.features.length, deaths,
                 pedestrian: ped, missing: !!fc.missing };

  if (!visible || !fc.features.length) return stat;

  layer = L.geoJSON(fc, {
    pointToLayer: markerFor,
    onEachFeature: (f, l) => l.bindTooltip(tooltipFor(f.properties), { sticky: true }),
  }).addTo(map);
  return stat;
}

export function clear(map) {
  if (layer) map.removeLayer(layer);
  layer = null;
}
