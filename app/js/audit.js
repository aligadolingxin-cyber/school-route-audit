// 評估工作台 — 進入點與控制

import * as data from './audit-data.js';
import * as store from './audit-store.js';
import * as streetview from './streetview.js';

const el = (id) => document.getElementById(id);

const ui = {
  status: el('status'), setName: el('set-name'), progress: el('progress'),
  unexported: el('unexported'),
  panoTitle: el('pano-title'), panoDate: el('pano-date'),
  pano: el('pano'), panoMsg: el('pano-msg'),
  unitTitle: el('unit-title'), unitSub: el('unit-sub'), unitStatus: el('unit-status'),
  refList: el('ref-list'), form: el('form'), timer: el('timer'),
  picker: el('unit-picker'),
};

let instrument = null;
let units = [];
let items = [];
let idx = 0;
let timerTick = null;

const current = () => units[idx];

function setStatus(text, kind = 'info') {
  ui.status.textContent = text;
  ui.status.dataset.state = kind;
}

// ---- 呈現 ----------------------------------------------------------------

function renderProgress() {
  const counts = { done: 0, in_progress: 0, no_image: 0, unstarted: 0 };
  for (const u of units) counts[store.recordFor(u.id).status] += 1;
  const t = store.timingStats(units.map((u) => u.id));
  ui.progress.innerHTML = `
    <span><b>${counts.done}</b> / ${units.length} 已完成</span>
    <span>進行中 ${counts.in_progress}</span>
    <span>待補拍 ${counts.no_image}</span>
    <span>未開始 ${counts.unstarted}</span>
    ${t ? `<span class="muted">已完成者每段中位數 ${fmtSec(t.median)}・共 ${fmtSec(t.total)}</span>` : ''}`;

  const n = store.unexported();
  ui.unexported.hidden = n === 0;
  ui.unexported.textContent = `${n} 筆尚未匯出`;
}

const fmtSec = (s) => (s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`);

function renderPicker() {
  ui.picker.innerHTML = units.map((u, i) => {
    const st = store.recordFor(u.id).status;
    const mark = { done: '✓', in_progress: '…', no_image: '📷', unstarted: '' }[st] ?? '';
    return `<option value="${i}"${i === idx ? ' selected' : ''}>${i + 1}. ${data.titleOf(u)} ${mark}</option>`;
  }).join('');
}

function renderRef(u) {
  ui.refList.innerHTML = data.openDataRef(u)
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function renderForm(u) {
  const rec = store.recordFor(u.id);
  const bySection = new Map(instrument.sections.map((s) => [s.id, []]));
  for (const it of items) bySection.get(it.section)?.push(it);

  ui.form.innerHTML = instrument.sections.map((sec) => {
    const list = bySection.get(sec.id) ?? [];
    const answered = list.filter((i) => rec.answers[i.id] !== undefined).length;
    return `
      <fieldset class="sec">
        <legend>${sec.label}
          <span class="muted">${answered}/${list.length}</span>
          ${sec.id === 'local' ? '<span class="tag tag-draft">自訂・未經信度檢驗</span>' : ''}
        </legend>
        ${list.map((it) => itemHtml(it, rec)).join('')}
      </fieldset>`;
  }).join('');

  ui.form.querySelectorAll('input[type=radio]').forEach((r) =>
    r.addEventListener('change', onAnswer));
  ui.form.querySelectorAll('.reason').forEach((t) =>
    t.addEventListener('input', onReason));
}

function itemHtml(it, rec) {
  const v = rec.answers[it.id];
  const opts = it.options.map((o) => `
    <label class="opt${v === o.v ? ' on' : ''}">
      <input type="radio" name="${it.id}" value="${o.v}"${v === o.v ? ' checked' : ''}>
      <span>${o.label}</span>
    </label>`).join('');
  const cannotOn = v === store.CANNOT;
  return `
    <div class="item${cannotOn ? ' cannot' : ''}" data-item="${it.id}">
      <p class="q">${it.text}
        ${it.low_reliability ? '<span class="tag tag-low">街景信度偏低</span>' : ''}
        ${it.draft ? '<span class="tag tag-draft">草稿</span>' : ''}
      </p>
      ${it.help ? `<p class="help">${it.help}</p>` : ''}
      <div class="opts">
        ${opts}
        <label class="opt opt-cannot${cannotOn ? ' on' : ''}">
          <input type="radio" name="${it.id}" value="${store.CANNOT}"${cannotOn ? ' checked' : ''}>
          <span>無法判定</span>
        </label>
      </div>
      ${cannotOn ? `<input class="reason" data-item="${it.id}" placeholder="為什麼無法判定？（例如影像遮蔽、角度不足）" value="${rec.reasons[it.id] ?? ''}">` : ''}
    </div>`;
}

function renderScore(u) {
  const s = store.score(u.id, items);
  const rec = store.recordFor(u.id);
  ui.unitStatus.textContent = store.statusLabel(rec.status);
  ui.unitStatus.dataset.st = rec.status;
  const scoreText = s.possible
    ? `${s.got} / ${s.possible} 分（${s.pct}%）`
    : '尚無計分';
  const extra = [];
  if (s.cannot) extra.push(`無法判定 ${s.cannot} 項已自分母扣除`);
  if (s.unanswered) extra.push(`尚未作答 ${s.unanswered} 項`);
  ui.timer.innerHTML = `
    <b>${scoreText}</b>
    ${extra.length ? `<span class="muted">${extra.join('・')}</span>` : ''}
    <span class="muted">耗時 ${fmtSec(store.secondsFor(u.id))}</span>`;
}

// ---- 互動 ----------------------------------------------------------------

function onAnswer(e) {
  const itemId = e.target.name;
  const raw = e.target.value;
  const value = raw === store.CANNOT ? store.CANNOT : Number(raw);
  store.setAnswer(current().id, itemId, value);
  renderForm(current());
  renderScore(current());
  renderProgress();
  renderPicker();
}

function onReason(e) {
  const rec = store.recordFor(current().id);
  rec.reasons[e.target.dataset.item] = e.target.value;
  store.setAnswer(current().id, e.target.dataset.item, store.CANNOT, e.target.value);
}

async function show(i) {
  store.stopTimer();
  idx = Math.max(0, Math.min(units.length - 1, i));
  const u = current();
  store.setLastUnit(u.id);
  store.startTimer(u.id);

  ui.unitTitle.textContent = data.titleOf(u);
  ui.unitSub.textContent = data.subtitleOf(u);
  ui.panoTitle.textContent = `${idx + 1} / ${units.length}・${data.titleOf(u)}`;
  renderRef(u);
  renderForm(u);
  renderScore(u);
  renderProgress();
  renderPicker();
  openPano(u);
}

async function openPano(u) {
  const { lat, lng } = data.centroidOf(u.feature.geometry);
  ui.panoDate.textContent = '';
  if (!streetview.hasKey()) {
    ui.pano.style.display = 'none';
    ui.panoMsg.hidden = false;
    ui.panoMsg.textContent = streetview.unavailableReason();
    return;
  }
  ui.pano.style.display = '';
  ui.panoMsg.hidden = true;
  try {
    const found = await streetview.probe(lat, lng);
    if (!found) {
      ui.pano.style.display = 'none';
      ui.panoMsg.hidden = false;
      ui.panoMsg.textContent = '此位置沒有街景影像。可標示為「無影像，待補拍」。';
      return;
    }
    ui.panoDate.textContent = found.imageDate ? `影像 ${found.imageDate}` : '影像日期未提供';
    await streetview.open(ui.pano, { lat: found.lat, lng: found.lng });
  } catch (err) {
    ui.pano.style.display = 'none';
    ui.panoMsg.hidden = false;
    ui.panoMsg.textContent = err.message;
  }
}

function bind() {
  el('btn-prev').addEventListener('click', () => show(idx - 1));
  el('btn-next').addEventListener('click', () => show(idx + 1));
  ui.picker.addEventListener('change', () => show(Number(ui.picker.value)));

  el('btn-done').addEventListener('click', () => {
    const s = store.score(current().id, items);
    if (s.unanswered && !confirm(`尚有 ${s.unanswered} 項未作答，仍標示為完成？`)) return;
    store.stopTimer();
    store.setStatus(current().id, store.STATUS.DONE);
    renderScore(current());
    renderProgress();
    renderPicker();
  });

  el('btn-noimage').addEventListener('click', () => {
    store.stopTimer();
    store.setStatus(current().id, store.STATUS.NO_IMAGE);
    renderScore(current());
    renderProgress();
    renderPicker();
  });

  el('btn-export').addEventListener('click', () => {
    store.stopTimer();
    const payload = store.buildExport(units, items, instrument);
    const stamp = new Date().toISOString().slice(0, 10);
    store.download(payload, `audit-${stamp}.json`);
    renderProgress();
    setStatus('已匯出。將檔案置於 app/data/risk/ 並提交，即可成為地圖的風險圖層。');
    store.startTimer(current().id);
  });

  el('btn-import').addEventListener('click', () => el('file-import').click());
  el('file-import').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const r = store.importData(JSON.parse(await file.text()), instrument.version);
      setStatus(`已匯入 ${r.imported} 筆。${r.warning ?? ''}`, r.warning ? 'error' : 'info');
      show(idx);
    } catch (err) {
      setStatus(`匯入失敗：${err.message}`, 'error');
    }
    e.target.value = '';
  });

  // 未匯出時提醒。清除瀏覽資料會使這些作答消失（design D3 的風險）
  window.addEventListener('beforeunload', (e) => {
    store.stopTimer();
    if (store.unexported() > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

async function start() {
  try {
    setStatus('載入判準與待評清單…');
    instrument = await data.loadInstrument();
    items = instrument.items;
    const set = await data.loadUnits();
    units = set.units;
    ui.setName.textContent = set.name;

    if (set.missing.length) {
      setStatus(`${set.missing.length} 個識別碼在路段資料中找不到：${set.missing.join('、')}`, 'error');
    } else {
      setStatus('');
    }
    if (!units.length) throw new Error('沒有可評估的單位');

    store.init(instrument.version);
    bind();

    const last = store.lastUnit();
    const at = last ? units.findIndex((u) => u.id === last) : 0;
    await show(at >= 0 ? at : 0);

    // 一併定期落盤，不倚賴 beforeunload——它未必來得及寫入
    timerTick = setInterval(() => {
      store.flushTimer();
      renderScore(current());
    }, 5000);
  } catch (err) {
    setStatus(err.message, 'error');
    console.error(err);
  }
}

start();
