// 人行道圖層：載入分縣市檔案並依淨寬著色。

import { SIDEWALK_BASE, widthBand, NO_RECORD } from './config.js';

let layer = null;
const cache = new Map();

/** 面用半透明填色加同色外框，與事故的點、道路的線區隔。 */
function styleFor(feature) {
  const band = widthBand(feature.properties.SWW_WTH);
  const color = band ? band.color : NO_RECORD.color;
  return { color, weight: 1, opacity: 0.9, fillColor: color, fillOpacity: 0.45 };
}

/** 取得該縣市的人行道資料，同一縣市只抓一次。 */
export async function fetchCounty(county) {
  if (cache.has(county)) return cache.get(county);
  const res = await fetch(`${SIDEWALK_BASE}/${encodeURIComponent(county)}.geojson`);
  if (!res.ok) throw new Error(`${county} 人行道資料載入失敗（HTTP ${res.status}）`);
  const fc = await res.json();
  cache.set(county, fc);
  return fc;
}

/** 統計各淨寬級距的段數。查無紀錄者不在本資料集中，由道路圖層負責（尚未實作）。 */
export function bandCounts(fc) {
  const out = { lt15: 0, b1525: 0, gte25: 0 };
  for (const f of fc.features) {
    const b = widthBand(f.properties.SWW_WTH);
    if (b) out[b.id] += 1;
  }
  return out;
}

export async function render(map, county, { onProgress, visible = true, onSelect } = {}) {
  if (layer) {
    map.removeLayer(layer);
    layer = null;
  }

  const t0 = performance.now();
  const cached = cache.has(county);
  if (!cached) onProgress?.(`載入 ${county} 人行道資料…`);
  const fc = await fetchCounty(county);
  const tFetched = performance.now();

  if (!visible) {
    return { county, dataYm: fc.data_ym, count: fc.features.length,
             bands: bandCounts(fc), fetchMs: 0, drawMs: 0, totalMs: 0 };
  }

  if (!cached) {
    onProgress?.(`繪製 ${fc.features.length.toLocaleString()} 段…`);
    await new Promise((r) => setTimeout(r, 0));
  }

  layer = L.geoJSON(fc, {
    style: styleFor,
    onEachFeature: onSelect
      ? (f, l) => l.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onSelect('sidewalk', f, l);
        })
      : undefined,
  }).addTo(map);
  const tDrawn = performance.now();

  return {
    county,
    dataYm: fc.data_ym,
    count: fc.features.length,
    bands: bandCounts(fc),
    fetchMs: Math.round(tFetched - t0),
    drawMs: Math.round(tDrawn - tFetched),
    totalMs: Math.round(tDrawn - t0),
  };
}

export function clear(map) {
  if (layer) map.removeLayer(layer);
  layer = null;
}

export function getLayer() {
  return layer;
}

/** 回復某圖層原本的樣式，供解除選取使用。 */
export function resetStyle(l) {
  if (layer && l) layer.resetStyle(l);
}
