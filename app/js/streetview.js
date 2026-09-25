// Google 街景整合。
//
// 我們的地圖是 Leaflet 配國土測繪中心圖磚，不是 google.maps.Map，
// 所以範例裡的 map.setStreetView(panorama) 用不上——那個方法假設
// 地圖也是 Google 的。位置與視角要自己雙向同步。
//
// 金鑰在前端必然可見，重點不是藏起來而是限制網域。金鑰由部署流程
// 自 GitHub Actions secret 注入 index.html，未設定時本模組整個停用，
// 地圖與其餘面板不受影響（street-view spec）。

const KEY = (window.__GMAPS_KEY__ ?? '').trim();
const PLACEHOLDER = '__GOOGLE_MAPS_KEY__';

export const hasKey = () => KEY !== '' && KEY !== PLACEHOLDER;

let apiPromise = null;
let authFailed = false;

/** 動態載入 Maps JS API。金鑰無效時 Google 不會讓載入失敗，而是事後呼叫 gm_authFailure。 */
function loadApi() {
  if (!hasKey()) return Promise.reject(new Error('尚未設定 Google Maps 金鑰'));
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    const cb = `__gmapsReady_${Date.now()}`;
    window[cb] = () => {
      delete window[cb];
      resolve(window.google.maps);
    };
    // 金鑰被拒（網域不符、額度用盡、API 未啟用）時由此回報
    window.gm_authFailure = () => {
      authFailed = true;
      reject(new Error('Google 拒絕了這把金鑰。請確認 HTTP referrer 限制是否包含本網域，'
                     + '以及 Maps JavaScript API 是否已啟用。'));
    };
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}`
          + `&v=weekly&language=zh-TW&region=TW&callback=${cb}`;
    s.onerror = () => reject(new Error('Google 街景服務無法載入'));
    document.head.appendChild(s);
  });
  return apiPromise;
}

let panorama = null;
let service = null;

/**
 * 查詢某位置是否有街景，回傳其實際全景位置與影像日期。
 * 找不到時回傳 null——spec 要求告知此處無街景，而非顯示別處的影像。
 */
export async function probe(lat, lng, radius = 50) {
  const maps = await loadApi();
  service ??= new maps.StreetViewService();
  try {
    const { data } = await service.getPanorama({
      location: { lat, lng }, radius, source: maps.StreetViewSource.OUTDOOR,
    });
    return {
      panoId: data.location.pano,
      lat: data.location.latLng.lat(),
      lng: data.location.latLng.lng(),
      description: data.location.shortDescription ?? data.location.description ?? null,
      imageDate: data.imageDate ?? null,   // YYYY-MM
    };
  } catch {
    return null;
  }
}

/**
 * 於指定容器開啟街景。
 * onMove 於位置或視角變動時呼叫，供地圖上的小人圖示同步。
 */
export async function open(container, { lat, lng, heading = 0, onMove } = {}) {
  const maps = await loadApi();
  if (!panorama) {
    panorama = new maps.StreetViewPanorama(container, {
      position: { lat, lng },
      pov: { heading, pitch: 0 },
      addressControl: false,
      fullscreenControl: false,
      motionTracking: false,
      motionTrackingControl: false,
    });
    const emit = () => {
      const p = panorama.getPosition();
      if (!p || !onMove) return;
      onMove({ lat: p.lat(), lng: p.lng(), heading: panorama.getPov().heading });
    };
    panorama.addListener('position_changed', emit);
    panorama.addListener('pov_changed', emit);
  } else {
    panorama.setPano ? panorama.setPosition({ lat, lng }) : null;
    panorama.setPov({ heading, pitch: 0 });
    panorama.setVisible(true);
  }
  return panorama;
}

export function close() {
  if (panorama) panorama.setVisible(false);
}

export function unavailableReason() {
  if (!hasKey()) {
    return '尚未設定 Google Maps 金鑰。金鑰由部署流程自 GitHub Actions secret '
         + '（GOOGLE_MAPS_API_KEY）注入，設定後街景即可使用。';
  }
  if (authFailed) {
    return 'Google 拒絕了這把金鑰。請確認其 HTTP referrer 限制包含本網域，'
         + '且已啟用 Maps JavaScript API。';
  }
  return '街景服務暫時無法使用。';
}
