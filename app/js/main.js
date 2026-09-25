// 學區道路健檢 — 進入點

import { loadCounty } from './sidewalk.js';

const TAIPEI = { center: [25.0375, 121.5637], zoom: 13 };

const statusEl = document.getElementById('status');

/** 於狀態列顯示訊息。state 為 'info' 或 'error'。 */
export function setStatus(text, state = 'info') {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

function initMap() {
  const map = L.map('map', {
    center: TAIPEI.center,
    zoom: TAIPEI.zoom,
    zoomControl: true,
    // 一個縣市有上萬個多邊形，SVG 會產生同等數量的 DOM 節點而癱瘓。
    preferCanvas: true,
    // 出處標示常駐於頁面下方（design D8），故關閉 Leaflet 自帶的角落標示
    attributionControl: false,
  });

  // 國土測繪中心「通用版電子地圖」WMTS。免金鑰，中文地名，圖磚含其版本浮水印。
  // 注意路徑順序為 {z}/{y}/{x}，與多數圖磚服務的 {z}/{x}/{y} 相反。
  L.tileLayer('https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}', {
    maxZoom: 20,
  }).addTo(map);

  return map;
}

async function start() {
  const map = initMap();
  window.map = map;

  try {
    const r = await loadCounty(map, '台北市', { onProgress: (m) => setStatus(m) });
    setStatus(
      `${r.county} ${r.count.toLocaleString()} 段 · 資料 ${r.dataYm} · ` +
      `載入 ${r.fetchMs} ms、繪製 ${r.drawMs} ms`
    );
    console.info('[人行道圖層]', r);
  } catch (err) {
    setStatus(err.message, 'error');
    console.error(err);
  }
}

start();
