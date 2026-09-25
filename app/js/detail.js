// 路段詳細面板：欄位、周邊事故、規則式問題摘要。

import { widthBand, CRASH_COLOR } from './config.js';
import { distanceTo, boundsOf, metersToDegrees } from './geo.js';

// 陳述事故時必須標明距離，且措辭為「周邊」——事故座標未必精確落在
// 該路段上，不得宣稱事故發生於此（design Risks）。
export const CRASH_RADIUS_M = 30;

// 《市區道路及附屬工程設計標準》規定人行道淨寬不得小於 1.5 公尺。
const LEGAL_MIN_WIDTH = 1.5;

const NA = '<span class="na">未提供</span>';

const fmt = (v, unit = '') =>
  (v === null || v === undefined || v === '' ? NA : `${v}${unit}`);

/** 找出該幾何周邊指定距離內的事故。先以外接矩形篩選再實算。 */
export function nearbyCrashes(geometry, crashFC, radius = CRASH_RADIUS_M) {
  if (!crashFC?.features?.length) return [];
  const [minX, minY, maxX, maxY] = boundsOf(geometry);
  const { dLat, dLon } = metersToDegrees(radius, (minY + maxY) / 2);
  const out = [];
  for (const c of crashFC.features) {
    const [x, y] = c.geometry.coordinates;
    if (x < minX - dLon || x > maxX + dLon || y < minY - dLat || y > maxY + dLat) continue;
    const d = distanceTo(geometry, x, y);
    if (d <= radius) out.push({ ...c.properties, distance: Math.round(d) });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

/**
 * 規則式問題摘要。
 *
 * 每條規則對應一個固定句型與它所引用的欄位（design D5）。不使用
 * 語言模型——spec 要求每句陳述可追溯至欄位且不得虛構，規則式在
 * 構造上即滿足，沒有虛構的可能。
 */
export function summarise(kind, p, crashes) {
  const out = [];
  const ped = crashes.filter((c) => c.kind === 'pedestrian');

  if (kind === 'sidewalk') {
    const w = p.SWW_WTH;
    const total = p.SW_WTH;

    if (typeof w === 'number') {
      if (w < LEGAL_MIN_WIDTH) {
        out.push({
          text: `人行道淨寬 ${w} 公尺，未達《市區道路及附屬工程設計標準》規定的 ${LEGAL_MIN_WIDTH} 公尺下限。`,
          basis: 'SWW_WTH（內政部國土管理署）',
          level: 'bad',
        });
      } else {
        out.push({
          text: `人行道淨寬 ${w} 公尺，達法規下限。`,
          basis: 'SWW_WTH（內政部國土管理署）',
          level: 'ok',
        });
      }
    } else {
      out.push({ text: '無淨寬資料，無法判斷是否達法規下限。', basis: '—', level: 'unknown' });
    }

    if (typeof w === 'number' && typeof total === 'number' && total > w) {
      out.push({
        text: `總寬 ${total} 公尺中有 ${(total - w).toFixed(2)} 公尺不可通行，為固定設施所佔。`,
        basis: 'SW_WTH 與 SWW_WTH 之差',
        level: 'bad',
      });
    }

    if (p.SW_RAMP === 0) {
      out.push({
        text: '此路段的路緣斜坡數為 0。',
        basis: 'SW_RAMP',
        level: 'bad',
      });
    } else if (typeof p.SW_RAMP === 'number') {
      out.push({ text: `路緣斜坡 ${p.SW_RAMP} 處。`, basis: 'SW_RAMP', level: 'ok' });
    }
  }

  if (kind === 'road') {
    // 本工具最容易被過度解讀的一句話，措辭需保守
    out.push({
      text: '此道路在人行道資料中查無紀錄。該資料集僅收錄有人行道之處，'
          + '故此處可能沒有人行道，也可能是未被收錄——本工具無法區分兩者。',
      basis: '人行道資料集的涵蓋範圍',
      level: 'unknown',
    });
    if (p.highway) {
      out.push({ text: `OSM 道路等級為 ${p.highway}。`, basis: 'OpenStreetMap highway', level: 'info' });
    }
  }

  if (ped.length) {
    out.push({
      text: `該路段周邊 ${CRASH_RADIUS_M} 公尺內有 ${ped.length} 件行人死亡事故。`,
      basis: '內政部警政署 A1 交通事故資料',
      level: 'bad',
    });
  } else if (crashes.length) {
    out.push({
      text: `該路段周邊 ${CRASH_RADIUS_M} 公尺內有 ${crashes.length} 件致命事故，無行人死亡。`,
      basis: '內政部警政署 A1 交通事故資料',
      level: 'info',
    });
  }

  if (!out.some((r) => r.level === 'bad' || r.level === 'ok')) {
    out.push({ text: '可用資料不足以判斷此路段的問題。', basis: '—', level: 'unknown' });
  }
  return out;
}

/** 缺少哪些欄位，供「資料不足」時具體列出。 */
export function missingFields(kind, p) {
  const want = kind === 'sidewalk'
    ? [['SWW_WTH', '人行道淨寬'], ['SW_WTH', '人行道寬度'], ['SW_RAMP', '路緣斜坡數']]
    : [['name', '路名']];
  return want.filter(([k]) => p[k] === null || p[k] === undefined || p[k] === '').map(([, l]) => l);
}

function crashRows(crashes) {
  if (!crashes.length) {
    return `<p class="muted">該路段周邊 ${CRASH_RADIUS_M} 公尺內無 A1 事故紀錄。</p>`;
  }
  return `<ul class="crash-list">${crashes.map((c) => {
    const d = c.date;
    return `<li><i style="--c:${CRASH_COLOR[c.kind]}"></i>
      <span>${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}</span>
      <span>死亡 ${c.deaths} 人</span>
      <span class="muted">${c.distance} m</span></li>`;
  }).join('')}</ul>`;
}

export function panelHtml(kind, p, crashes, { inCompare = false } = {}) {
  const title = p.NAME ?? p.name ?? '（無路名）';
  const sub = kind === 'sidewalk'
    ? `${fmt(p.VILL_NAME)}・${fmt(p.PSTART)} → ${fmt(p.PEND)}`
    : '查無人行道紀錄的道路';

  const band = kind === 'sidewalk' ? widthBand(p.SWW_WTH) : null;
  const facts = kind === 'sidewalk' ? [
    ['人行道淨寬', p.SWW_WTH === null || p.SWW_WTH === undefined ? NA : `${p.SWW_WTH} m`],
    ['人行道寬度', p.SW_WTH === null || p.SW_WTH === undefined ? NA : `${p.SW_WTH} m`],
    ['路段長度', p.SW_LENG === null || p.SW_LENG === undefined ? NA : `${p.SW_LENG} m`],
    ['路緣斜坡', p.SW_RAMP === null || p.SW_RAMP === undefined ? NA : `${p.SW_RAMP} 處`],
    ['方向', { 1: '東／南側', 2: '西／北側', 3: '徒步區' }[p.SW_DIRECT] ?? NA],
  ] : [
    ['OSM 道路等級', fmt(p.highway)],
    ['OSM id', fmt(p.osm_id)],
    ['人行道淨寬', NA],
    ['路緣斜坡', NA],
  ];

  const rules = summarise(kind, p, crashes);
  const lacking = missingFields(kind, p);

  return `
    <header class="detail-head">
      <div>
        <h2>${title}</h2>
        <p class="muted">${sub}</p>
      </div>
      <button class="close" id="detail-close" aria-label="關閉">×</button>
    </header>

    ${band ? `<div class="band-tag" style="--c:${band.color}">${band.label}</div>` : ''}

    <dl class="facts">
      ${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
    </dl>

    <section>
      <h3>風險分數</h3>
      <p class="muted">未提供——此路段尚未經逐段評估。開放資料只能呈現有無人行道與其寬度，
        騎樓佔用、行穿線品質、路口視距等項目沒有任何資料集收錄，須由人逐段判讀。</p>
    </section>

    <section>
      <h3>問題摘要</h3>
      <ul class="rules">
        ${rules.map((r) => `<li class="lv-${r.level}">
          <span>${r.text}</span>
          <span class="basis">依據：${r.basis}</span>
        </li>`).join('')}
      </ul>
      ${lacking.length ? `<p class="muted">缺少的欄位：${lacking.join('、')}。</p>` : ''}
    </section>

    <section>
      <h3>周邊事故</h3>
      ${crashRows(crashes)}
    </section>

    <div class="detail-actions">
      <button id="detail-pano">開啟街景</button>
      <button id="detail-compare"${inCompare ? ' disabled' : ''}>
        ${inCompare ? '已加入比較' : '加入比較'}
      </button>
    </div>`;
}
