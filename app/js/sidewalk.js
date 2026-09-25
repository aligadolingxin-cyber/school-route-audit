// 人行道圖層：載入分縣市檔案並依淨寬著色。

import { SIDEWALK_BASE as DATA_BASE, widthBand, NO_RECORD } from './config.js';

let layer = null;

/** 單一多邊形的樣式。面用半透明填色加同色外框，與道路的線區隔。 */
function styleFor(feature) {
  const band = widthBand(feature.properties.SWW_WTH);
  const color = band ? band.color : NO_RECORD.color;
  return {
    color,
    weight: 1,
    opacity: 0.9,
    fillColor: color,
    fillOpacity: 0.45,
  };
}

/**
 * 載入某縣市的人行道並加入地圖。
 * 回傳載入與繪製的耗時，供判斷是否需改採向量圖磚（design D2）。
 */
export async function loadCounty(map, county, { onProgress } = {}) {
  if (layer) {
    map.removeLayer(layer);
    layer = null;
  }

  const t0 = performance.now();
  onProgress?.(`載入 ${county} 人行道資料…`);

  const url = `${DATA_BASE}/${encodeURIComponent(county)}.geojson`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${county} 資料載入失敗（HTTP ${res.status}）`);
  }
  const fc = await res.json();
  const tFetched = performance.now();

  onProgress?.(`繪製 ${fc.features.length.toLocaleString()} 段…`);
  // 讓瀏覽器有機會更新狀態列再進入繪製
  await new Promise((r) => setTimeout(r, 0));

  layer = L.geoJSON(fc, { style: styleFor }).addTo(map);
  const tDrawn = performance.now();

  return {
    county,
    dataYm: fc.data_ym,
    count: fc.features.length,
    fetchMs: Math.round(tFetched - t0),
    drawMs: Math.round(tDrawn - tFetched),
    totalMs: Math.round(tDrawn - t0),
  };
}

export function getLayer() {
  return layer;
}
