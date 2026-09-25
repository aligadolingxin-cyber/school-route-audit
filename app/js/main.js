// 學區道路健檢 — 進入點與篩選控制

import { SCHOOL_LEVELS, WALKSHED_PROFILES, DEFAULT_PROFILE, WIDTH_BANDS } from './config.js';
import { loadCounties } from './counties.js';
import * as sidewalk from './sidewalk.js';
import * as schools from './schools.js';
import * as crashes from './crashes.js';

const TAIWAN = { center: [23.7, 121.0], zoom: 8 };
const DEFAULT_COUNTY = '臺北市';

const el = {
  status: document.getElementById('status'),
  county: document.getElementById('county'),
  levels: document.getElementById('levels'),
  profile: document.getElementById('profile'),
  layers: document.getElementById('layers'),
  summary: document.getElementById('summary'),
};

const state = {
  county: DEFAULT_COUNTY,
  levels: new Set(['國小', '國中']),
  profile: DEFAULT_PROFILE,
  show: { sidewalk: true, schools: true, crashes: true },
  counties: [],
  busy: false,
};

let map;

function setStatus(text, kind = 'info') {
  el.status.textContent = text;
  el.status.dataset.state = kind;
}

function profileOf(id) {
  return WALKSHED_PROFILES.find((p) => p.id === id) ?? WALKSHED_PROFILES[0];
}

function initMap() {
  map = L.map('map', {
    center: TAIWAN.center,
    zoom: TAIWAN.zoom,
    // 一個縣市有上萬個多邊形，SVG 會產生同等數量的 DOM 節點而癱瘓。
    preferCanvas: true,
    // 出處標示常駐於頁面下方（design D8），故關閉 Leaflet 自帶的角落標示
    attributionControl: false,
  });
  L.tileLayer('https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}', {
    maxZoom: 20,
  }).addTo(map);
  window.map = map;
}

// ---- 介面 ----------------------------------------------------------------

function buildControls() {
  el.county.innerHTML = state.counties
    .map((c) => `<option value="${c.name}">${c.name}</option>`).join('');
  el.county.value = state.county;
  el.county.addEventListener('change', () => {
    state.county = el.county.value;
    refresh({ fit: true });
  });

  el.levels.innerHTML = SCHOOL_LEVELS.map((s) => `
    <label class="chip" style="--c:${s.color}">
      <input type="checkbox" value="${s.id}"${state.levels.has(s.id) ? ' checked' : ''}>
      <span>${s.id}</span>
    </label>`).join('');
  el.levels.addEventListener('change', (e) => {
    const cb = e.target;
    if (cb.checked) state.levels.add(cb.value); else state.levels.delete(cb.value);
    refresh();
  });

  el.profile.innerHTML = WALKSHED_PROFILES.map((p) => `
    <label class="chip">
      <input type="radio" name="profile" value="${p.id}"${p.id === state.profile ? ' checked' : ''}>
      <span>${p.label}</span>
    </label>`).join('');
  el.profile.addEventListener('change', (e) => {
    state.profile = e.target.value;
    refresh();
  });

  const layerLabels = { sidewalk: '人行道', schools: '學校', crashes: 'A1 事故' };
  el.layers.innerHTML = Object.entries(layerLabels).map(([k, label]) => `
    <label class="chip">
      <input type="checkbox" value="${k}"${state.show[k] ? ' checked' : ''}>
      <span>${label}</span>
    </label>`).join('');
  el.layers.addEventListener('change', (e) => {
    state.show[e.target.value] = e.target.checked;
    refresh();
  });
}

function renderSummary(sw, sc, cr) {
  const total = sw.count || 1;
  const pct = (n) => `${Math.round((100 * n) / total)}%`;
  const bandCells = WIDTH_BANDS.map((b) => `
    <span class="stat"><i style="--c:${b.color}"></i>
      <b>${sw.bands[b.id].toLocaleString()}</b>
      <span class="unit">段 ${pct(sw.bands[b.id])}</span>
      <span class="lbl">${b.label}</span></span>`).join('');

  // 「查無人行道紀錄」需道路中心線圖層才能計算（task 3b），尚未實作。
  // 在那之前明確標示為未計，不以空白或 0 帶過。
  const pending = `
    <span class="stat pending"><i style="--c:#8A8A8A"></i>
      <b>—</b><span class="unit">未計</span>
      <span class="lbl">查無人行道紀錄</span></span>`;

  const levelText = SCHOOL_LEVELS
    .filter((s) => state.levels.has(s.id))
    .map((s) => `${s.id} ${sc.levels[s.id] ?? 0}`).join('、') || '未選取';

  const crashText = cr.missing
    ? '該縣市無 A1 事故資料'
    : `${cr.count} 場／死亡 ${cr.deaths} 人，其中行人 ${cr.pedestrian} 場`;

  el.summary.innerHTML = `
    <div class="stat-row">${bandCells}${pending}</div>
    <div class="stat-line">
      <span>學校 <b>${sc.count}</b> 處（${levelText}）</span>
      <span>A1 事故 <b>${crashText}</b>${cr.years?.length ? `，${cr.years.join('、')}` : ''}</span>
      <span>人行道資料 ${sw.dataYm ?? '未提供'}</span>
    </div>`;
}

// ---- 繪製 ----------------------------------------------------------------

async function refresh({ fit = false } = {}) {
  if (state.busy) return;
  state.busy = true;
  const county = state.county;
  const radius = profileOf(state.profile).radius;

  try {
    if (!state.show.sidewalk) sidewalk.clear(map);
    if (!state.show.schools) schools.clear(map);
    if (!state.show.crashes) crashes.clear(map);

    const sw = await sidewalk.render(map, county, {
      onProgress: setStatus, visible: state.show.sidewalk,
    });
    const sc = await schools.render(map, county, {
      levels: [...state.levels], radius, visible: state.show.schools,
    });
    const cr = await crashes.render(map, county, { visible: state.show.crashes });

    if (fit) {
      const src = schools.getLayers().blockLayer ?? sidewalk.getLayer?.();
      if (src?.getBounds && src.getBounds().isValid()) map.fitBounds(src.getBounds());
    }

    renderSummary(sw, sc, cr);
    setStatus('');
    console.info('[圖層]', { sidewalk: sw, schools: sc, crashes: cr });
  } catch (err) {
    setStatus(err.message, 'error');
    el.summary.innerHTML = '';
    console.error(err);
  } finally {
    state.busy = false;
  }
}

async function start() {
  initMap();
  try {
    setStatus('載入縣市清單…');
    state.counties = await loadCounties();
    if (!state.counties.some((c) => c.name === state.county)) {
      state.county = state.counties[0]?.name ?? '';
    }
    buildControls();
    await refresh({ fit: true });
  } catch (err) {
    setStatus(err.message, 'error');
    console.error(err);
  }
}

start();
