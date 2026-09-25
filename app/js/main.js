// 學區道路健檢 — 進入點
// 目前僅建立底圖。圖層依 tasks 2.x 之後逐步加入。

const TAIPEI = { center: [25.0375, 121.5637], zoom: 12 };

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
    // 出處標示常駐於頁面下方（design D8），故關閉 Leaflet 自帶的角落標示
    attributionControl: false,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    subdomains: 'abcd',
  }).addTo(map);

  return map;
}

try {
  window.map = initMap();
  setStatus('');
} catch (err) {
  setStatus('地圖載入失敗：' + err.message, 'error');
  throw err;
}
