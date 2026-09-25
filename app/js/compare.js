// 路段比較：最多三條並排對照。

import { widthBand } from './config.js';
import { summarise, nearbyCrashes, CRASH_RADIUS_M } from './detail.js';

export const MAX = 3;

const items = [];          // { key, kind, feature, layer, crashes }
let markers = null;
let onChange = null;

const NA = '<span class="na">未提供</span>';

const keyOf = (kind, p) =>
  `${kind}:${p.id ?? p.osm_id ?? `${p.NAME}|${p.PSTART}|${p.PEND}|${p.SW_DIRECT}`}`;

export const size = () => items.length;
export const has = (kind, p) => items.some((i) => i.key === keyOf(kind, p));

export function init({ map, onChanged }) {
  markers = L.layerGroup().addTo(map);
  onChange = onChanged;
}

export function add(kind, feature, layer, crashes) {
  const key = keyOf(kind, feature.properties);
  if (items.some((i) => i.key === key)) return { ok: false, reason: 'duplicate' };
  if (items.length >= MAX) return { ok: false, reason: 'full' };
  items.push({ key, kind, feature, layer, crashes });
  refreshMarkers();
  onChange?.();
  return { ok: true };
}

export function remove(key) {
  const i = items.findIndex((x) => x.key === key);
  if (i < 0) return;
  items.splice(i, 1);
  refreshMarkers();
  onChange?.();
}

export function clear() {
  items.length = 0;
  refreshMarkers();
  onChange?.();
}

/** 於地圖標示比較中的路段，使面板與地圖對得起來。 */
function refreshMarkers() {
  if (!markers) return;
  markers.clearLayers();
  items.forEach((it, idx) => {
    const b = L.geoJSON(it.feature).getBounds();
    if (!b.isValid()) return;
    L.marker(b.getCenter(), {
      interactive: false,
      zIndexOffset: 900,
      icon: L.divIcon({ className: 'cmp-badge', html: `<span>${idx + 1}</span>`,
                        iconSize: [22, 22], iconAnchor: [11, 11] }),
    }).addTo(markers);
  });
}

// ---- 指標 ----------------------------------------------------------------

/**
 * 每一列是同一個指標。缺值回傳 null，由呈現層顯示為「未提供」——
 * MUST NOT 顯示為 0，亦不得參與排序或優劣判斷（segment-comparison spec）。
 */
const METRICS = [
  { id: 'width', label: '人行道淨寬', unit: 'm',
    get: (it) => (it.kind === 'sidewalk' ? it.feature.properties.SWW_WTH ?? null : null),
    better: 'high' },
  { id: 'total', label: '人行道寬度', unit: 'm',
    get: (it) => (it.kind === 'sidewalk' ? it.feature.properties.SW_WTH ?? null : null),
    better: 'high' },
  { id: 'ramp', label: '路緣斜坡', unit: '處',
    get: (it) => (it.kind === 'sidewalk' ? it.feature.properties.SW_RAMP ?? null : null),
    better: 'high' },
  { id: 'len', label: '路段長度', unit: 'm',
    get: (it) => (it.kind === 'sidewalk' ? it.feature.properties.SW_LENG ?? null : null),
    better: null },
  { id: 'crash', label: `周邊 ${CRASH_RADIUS_M} m 內 A1 事故`, unit: '件',
    get: (it) => it.crashes.length, better: 'low' },
  { id: 'ped', label: '其中行人死亡', unit: '件',
    get: (it) => it.crashes.filter((c) => c.kind === 'pedestrian').length, better: 'low' },
  { id: 'risk', label: '風險分數', unit: '',
    get: () => null, better: null },   // 尚未逐段評估，一律未提供
];

/** 改善優先項目。取自與詳細面板同一組規則，故兩處說法一致。 */
function priorities(it) {
  const rules = summarise(it.kind, it.feature.properties, it.crashes);
  const bad = rules.filter((r) => r.level === 'bad');
  if (!bad.length) {
    const unknown = rules.filter((r) => r.level === 'unknown');
    return unknown.length ? unknown : [{ text: '依現有資料未發現明確問題。', basis: '—' }];
  }
  return bad;
}

// ---- 呈現 ----------------------------------------------------------------

function titleOf(it) {
  const p = it.feature.properties;
  return p.NAME ?? p.name ?? '（無路名）';
}

function subOf(it) {
  const p = it.feature.properties;
  return it.kind === 'sidewalk' ? (p.VILL_NAME ?? '') : '查無人行道紀錄';
}

export function panelHtml() {
  if (!items.length) {
    return `<p class="cmp-empty">尚未加入路段。點地圖上的路段，再按「加入比較」。最多 ${MAX} 條。</p>`;
  }

  const head = items.map((it, i) => `
    <th>
      <span class="cmp-no">${i + 1}</span>
      <span class="cmp-title">${titleOf(it)}</span>
      <span class="cmp-sub">${subOf(it)}</span>
      <button class="cmp-rm" data-key="${it.key}" aria-label="移除">×</button>
    </th>`).join('');

  const rows = METRICS.map((m) => {
    const vals = items.map((it) => m.get(it));
    const known = vals.filter((v) => typeof v === 'number');
    // 未提供者不參與比較，故最佳值只在有值者之間取
    let best = null;
    if (m.better && known.length > 1) {
      best = m.better === 'high' ? Math.max(...known) : Math.min(...known);
    }
    const cells = vals.map((v) => {
      if (typeof v !== 'number') return `<td>${NA}</td>`;
      const mark = best !== null && v === best ? ' class="cmp-best"' : '';
      return `<td${mark}>${v}${m.unit ? ` <span class="cmp-unit">${m.unit}</span>` : ''}</td>`;
    }).join('');
    return `<tr><th scope="row">${m.label}</th>${cells}</tr>`;
  }).join('');

  const prio = items.map((it) => `
    <td><ul>${priorities(it).map((r) => `
      <li>${r.text}<span class="basis">依據：${r.basis}</span></li>`).join('')}</ul></td>`).join('');

  const note = items.length < 2
    ? `<p class="cmp-note">再加入至少一條才能比較。</p>` : '';

  return `
    <header class="cmp-head">
      <h2>路段比較 <span class="muted">${items.length} / ${MAX}</span></h2>
      <div>
        <button id="cmp-clear">全部移除</button>
        <button class="close" id="cmp-close" aria-label="關閉">×</button>
      </div>
    </header>
    ${note}
    <div class="cmp-scroll">
      <table class="cmp-table">
        <thead><tr><th></th>${head}</tr></thead>
        <tbody>
          ${rows}
          <tr class="cmp-prio"><th scope="row">改善優先項目</th>${prio}</tr>
        </tbody>
      </table>
    </div>`;
}

export function bind(root, { onClose } = {}) {
  root.querySelector('#cmp-close')?.addEventListener('click', onClose);
  root.querySelector('#cmp-clear')?.addEventListener('click', clear);
  root.querySelectorAll('.cmp-rm').forEach((b) =>
    b.addEventListener('click', () => remove(b.dataset.key)));
}

export { nearbyCrashes };
