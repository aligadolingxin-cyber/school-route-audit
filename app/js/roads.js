// 道路中心線圖層：查無人行道紀錄的道路。
//
// 檔案只含查無紀錄者——有人行道的道路已由人行道多邊形圖層呈現。

import { ROAD_BASE, NO_RECORD } from './config.js';

let layer = null;
const cache = new Map();
let index = null;

export async function loadIndex() {
  if (index) return index;
  const res = await fetch(`${ROAD_BASE}/index.json`);
  index = res.ok ? await res.json() : { counties: [] };
  return index;
}

/** 該縣市的統計。尚未跑過道路管線的縣市回傳 null，呼叫端須顯示為「未計」。 */
export async function statsFor(county) {
  const ix = await loadIndex();
  return ix.counties.find((c) => c.county === county) ?? null;
}

export async function fetchCounty(county) {
  if (cache.has(county)) return cache.get(county);
  const res = await fetch(`${ROAD_BASE}/${encodeURIComponent(county)}.geojson`);
  if (!res.ok) {
    const empty = { type: 'FeatureCollection', features: [], missing: true };
    cache.set(county, empty);
    return empty;
  }
  const fc = await res.json();
  cache.set(county, fc);
  return fc;
}

export async function render(map, county, { visible = true, onSelect } = {}) {
  if (layer) {
    map.removeLayer(layer);
    layer = null;
  }
  const fc = await fetchCounty(county);
  if (!visible || !fc.features.length) return { count: fc.features.length, missing: !!fc.missing };

  layer = L.geoJSON(fc, {
    style: { color: NO_RECORD.color, weight: 2, opacity: 0.75 },
    onEachFeature: onSelect
      ? (f, l) => l.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onSelect('road', f, l);
        })
      : undefined,
  }).addTo(map);
  // 人行道與學校在上，灰線退居底層
  layer.bringToBack();
  return { count: fc.features.length, missing: false };
}

export function clear(map) {
  if (layer) map.removeLayer(layer);
  layer = null;
}

export function getLayer() {
  return layer;
}

export function resetStyle(l) {
  if (layer && l) layer.resetStyle(l);
}
