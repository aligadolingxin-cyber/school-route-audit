// 工作台的定位小地圖。
//
// 看街景時容易搞不清楚自己正在評哪一段。這張圖只回答一個問題：
// 「紅色的就是你現在評的那段。」其餘單位以淡色作為周邊脈絡。

import { centroidOf } from './audit-data.js';

// 目前單位。工作台沒有淨寬著色，紅色在此不與地圖的語意衝突。
const CURRENT_STYLE = {
  color: '#D1495B', weight: 3, opacity: 1,
  fillColor: '#D1495B', fillOpacity: 0.45,
};

// 其餘待評單位，僅作脈絡
const OTHER_STYLE = {
  color: '#8A8A8A', weight: 1.5, opacity: 0.55,
  fillColor: '#8A8A8A', fillOpacity: 0.12,
};

let map = null;
let currentLayer = null;
let othersLayer = null;
let panoMarker = null;

export function init(containerId, units) {
  map = L.map(containerId, {
    zoomControl: true,
    attributionControl: false,
    preferCanvas: true,
  });
  L.tileLayer('https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}', {
    maxZoom: 20,
  }).addTo(map);

  othersLayer = L.geoJSON(
    { type: 'FeatureCollection', features: units.map((u) => u.feature) },
    { style: OTHER_STYLE, interactive: false },
  ).addTo(map);

  return map;
}

/** 以紅色半透明覆蓋目前評估中的路段，並將視野帶到它。 */
export function focus(unit) {
  if (!map) return;
  if (currentLayer) map.removeLayer(currentLayer);
  currentLayer = L.geoJSON(unit.feature, { style: CURRENT_STYLE, interactive: false }).addTo(map);
  currentLayer.bringToFront();

  const b = currentLayer.getBounds();
  if (b.isValid()) map.fitBounds(b, { padding: [28, 28], maxZoom: 18 });
  else {
    const c = centroidOf(unit.feature.geometry);
    map.setView([c.lat, c.lng], 18);
  }
  clearPano();
}

/** 街景位置與朝向。與主地圖同一套作法——Leaflet 拿不到 Google 的自動連動。 */
export function showPano(lat, lng, heading) {
  if (!map) return;
  const icon = L.divIcon({
    className: 'pano-marker',
    html: `<span class="cone" style="--h:${heading ?? 0}deg"></span><span class="dot"></span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
  if (panoMarker) panoMarker.setLatLng([lat, lng]).setIcon(icon);
  else panoMarker = L.marker([lat, lng], { icon, interactive: false, zIndexOffset: 900 }).addTo(map);
}

export function clearPano() {
  if (panoMarker) {
    map.removeLayer(panoMarker);
    panoMarker = null;
  }
}

export function invalidate() {
  map?.invalidateSize();
}
