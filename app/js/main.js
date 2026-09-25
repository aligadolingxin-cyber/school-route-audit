// 學區道路健檢 — 進入點與篩選控制

import { SCHOOL_LEVELS, WALKSHED_PROFILES, DEFAULT_PROFILE, WIDTH_BANDS } from './config.js';
import { loadCounties } from './counties.js';
import { panelHtml, nearbyCrashes } from './detail.js';
import * as sidewalk from './sidewalk.js';
import * as roads from './roads.js';
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
  detail: document.getElementById('detail'),
};

// 選取狀態。選取樣式直接套在被點的圖層上，解除時以 resetStyle 還原。
const SELECTED_STYLE = { color: '#111', weight: 3, opacity: 1 };
let selected = null;   // { kind, layer, feature }

const state = {
  county: DEFAULT_COUNTY,
  levels: new Set(['國小', '國中']),
  profile: DEFAULT_PROFILE,
  show: { sidewalk: true, roads: true, schools: true, crashes: true },
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

  const layerLabels = { sidewalk: '人行道', roads: '查無紀錄道路', schools: '學校', crashes: 'A1 事故' };
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

function renderSummary(sw, rd, sc, cr) {
  const total = sw.count || 1;
  const pct = (n) => `${Math.round((100 * n) / total)}%`;
  // 缺整個資料集時顯示「未提供」，不顯示為 0（road-segments spec）
  const bandCells = WIDTH_BANDS.map((b) => `
    <span class="stat${sw.missing ? ' pending' : ''}"><i style="--c:${b.color}"></i>
      <b>${sw.missing ? '未提供' : sw.bands[b.id].toLocaleString()}</b>
      ${sw.missing ? '' : `<span class="unit">段 ${pct(sw.bands[b.id])}</span>`}
      <span class="lbl">${b.label}</span></span>`).join('');

  // 查無紀錄的分母是「道路段數」，與上一列人行道段數不同，
  // 故另起一列並各自標明分母，不把兩種單位並排成同一個百分比。
  const roadRow = rd.stats
    ? `<div class="stat-row">
        <span class="stat"><i class="line" style="--c:#8A8A8A"></i>
          <b>${rd.stats.roads_no_record.toLocaleString()}</b>
          <span class="unit">段 ${Math.round(100 * rd.stats.roads_no_record / rd.stats.roads_total)}%
            · ${rd.stats.km_no_record} km</span>
          <span class="lbl">查無人行道紀錄</span></span>
        <span class="stat-note">道路共 ${rd.stats.roads_total.toLocaleString()} 段／${rd.stats.km_total} km
          ・以鄰近 ${rd.stats.buffer_m} m 判定</span>
      </div>`
    : `<div class="stat-row">
        <span class="stat pending"><i class="line" style="--c:#8A8A8A"></i>
          <b>未計</b><span class="lbl">查無人行道紀錄</span></span>
        <span class="stat-note">此縣市尚未產生道路圖層</span>
      </div>`;

  const levelText = SCHOOL_LEVELS
    .filter((s) => state.levels.has(s.id))
    .map((s) => `${s.id} ${sc.levels[s.id] ?? 0}`).join('、') || '未選取';

  const crashText = cr.missing
    ? '該縣市無 A1 事故資料'
    : `${cr.count} 場／死亡 ${cr.deaths} 人，其中行人 ${cr.pedestrian} 場`;

  el.summary.innerHTML = `
    <div class="stat-row">${bandCells}
      <span class="stat-note">有人行道紀錄者共 ${sw.count.toLocaleString()} 段</span>
    </div>
    ${roadRow}
    <div class="stat-line">
      <span>學校 <b>${sc.count}</b> 處（${levelText}）</span>
      <span>A1 事故 <b>${crashText}</b>${cr.years?.length ? `，${cr.years.join('、')}` : ''}</span>
      <span>人行道資料 ${sw.dataYm ?? '未提供'}</span>
    </div>`;
}

// ---- 選取與詳細面板 ------------------------------------------------------

function clearSelection() {
  if (selected) {
    const mod = selected.kind === 'sidewalk' ? sidewalk : roads;
    mod.resetStyle(selected.layer);
  }
  selected = null;
  el.detail.hidden = true;
  el.detail.innerHTML = '';
}

async function select(kind, feature, layer) {
  clearSelection();
  selected = { kind, feature, layer };
  layer.setStyle(SELECTED_STYLE);
  layer.bringToFront();

  const rec = state.counties.find((c) => c.name === state.county);
  const crashFC = rec?.files.crashes ? await crashes.fetchCounty(rec.files.crashes) : null;
  const near = nearbyCrashes(feature.geometry, crashFC);

  el.detail.innerHTML = panelHtml(kind, feature.properties, near);
  el.detail.hidden = false;
  el.detail.scrollTop = 0;
  document.getElementById('detail-close')?.addEventListener('click', clearSelection);
  document.getElementById('detail-compare')?.addEventListener('click', (e) => {
    // 比較面板為 task 12；此處先確認入口存在且可回饋
    e.target.disabled = true;
    e.target.textContent = '比較面板尚未實作';
  });
}

// ---- 繪製 ----------------------------------------------------------------

async function refresh({ fit = false } = {}) {
  if (state.busy) return;
  state.busy = true;
  const radius = profileOf(state.profile).radius;

  // 三份政府資料的縣市用字不一致（人行道寫「台北市」，學校與事故
  // 寫「臺北市」）。介面一律用正規化後的名稱，載入時才換回各資料集
  // 自己的檔名。
  const rec = state.counties.find((c) => c.name === state.county);
  const file = rec?.files ?? {};

  try {
    if (!state.show.sidewalk) sidewalk.clear(map);
    if (!state.show.roads) roads.clear(map);
    if (!state.show.schools) schools.clear(map);
    if (!state.show.crashes) crashes.clear(map);

    clearSelection();

    const rdStats = await roads.statsFor(state.county);
    const rd = { stats: rdStats };
    await roads.render(map, state.county, { visible: state.show.roads, onSelect: select });

    const sw = file.sidewalk
      ? await sidewalk.render(map, file.sidewalk, {
          onProgress: setStatus, visible: state.show.sidewalk, onSelect: select })
      : { county: state.county, count: 0, bands: { lt15: 0, b1525: 0, gte25: 0 },
          dataYm: null, missing: true };
    const sc = file.schools
      ? await schools.render(map, file.schools, {
          levels: [...state.levels], radius, visible: state.show.schools })
      : { county: state.county, count: 0, total: 0, levels: {}, missing: true };
    const cr = file.crashes
      ? await crashes.render(map, file.crashes, { visible: state.show.crashes })
      : { county: state.county, count: 0, deaths: 0, pedestrian: 0, years: [], missing: true };

    if (fit) {
      const src = schools.getLayers().blockLayer ?? sidewalk.getLayer?.();
      if (src?.getBounds && src.getBounds().isValid()) map.fitBounds(src.getBounds());
    }

    renderSummary(sw, rd, sc, cr);
    setStatus('');
    console.info('[圖層]', { sidewalk: sw, roads: rd, schools: sc, crashes: cr });
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
