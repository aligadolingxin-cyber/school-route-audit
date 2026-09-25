// 評估紀錄的保存、計時與匯出匯入。
//
// 存於 localStorage。這是刻意的取捨（design D3）：無後端即無需管
// 金鑰與維運，但清除瀏覽資料會使未匯出的作答遺失。故匯出、匯入與
// 未匯出提示三者缺一不可——只能匯出的話，換台電腦就得重來。

const KEY = 'audit-records-v1';

const UNSTARTED = 'unstarted';
const PROGRESS = 'in_progress';
const DONE = 'done';
const NO_IMAGE = 'no_image';
export const STATUS = { UNSTARTED, PROGRESS, DONE, NO_IMAGE };

const STATUS_LABEL = {
  [UNSTARTED]: '未開始',
  [PROGRESS]: '進行中',
  [DONE]: '已完成',
  [NO_IMAGE]: '待現地補拍',
};
export const statusLabel = (s) => STATUS_LABEL[s] ?? s;

/** 無法判定。與「尚未作答」是不同的事：前者計入完成度，後者不計。 */
export const CANNOT = 'cannot_determine';

let state = { version: null, exportedAt: null, records: {} };

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = JSON.parse(raw);
  } catch {
    // 無痕視窗或封鎖網站資料時存取會擲錯；以空白狀態繼續
  }
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function init(instrumentVersion) {
  read();
  state.version ??= instrumentVersion;
  state.records ??= {};
  return state.version;
}

/** 某單位的紀錄，不存在時建立。 */
export function recordFor(unitId) {
  state.records[unitId] ??= {
    answers: {}, reasons: {}, status: UNSTARTED,
    seconds: 0, opens: 0, version: state.version, updatedAt: null,
  };
  return state.records[unitId];
}

export function setAnswer(unitId, itemId, value, reason = null) {
  const r = recordFor(unitId);
  if (value === null || value === undefined) {
    delete r.answers[itemId];
    delete r.reasons[itemId];
  } else {
    r.answers[itemId] = value;
    if (value === CANNOT) r.reasons[itemId] = reason ?? '';
    else delete r.reasons[itemId];
  }
  if (r.status === UNSTARTED) r.status = PROGRESS;
  r.updatedAt = new Date().toISOString();
  markDirty();
  write();
}

export function setStatus(unitId, status) {
  const r = recordFor(unitId);
  r.status = status;
  r.updatedAt = new Date().toISOString();
  markDirty();
  write();
}

export function setLastUnit(unitId) {
  state.lastUnit = unitId;
  write();
}

export const lastUnit = () => state.lastUnit ?? null;

// ---- 完成度與計分 --------------------------------------------------------

/** 「無法判定」計為已作答；「尚未作答」不計（audit-instrument spec）。 */
export function answeredCount(unitId, items) {
  const r = recordFor(unitId);
  return items.filter((i) => r.answers[i.id] !== undefined).length;
}

/**
 * 計分：「無法判定」自分子與分母一併扣除（design D5）。
 *
 * 若視為 0 分，看不清楚的路段會被評得比實際差——而那些往往正是
 * 影像品質最差的巷弄，誤差會系統性地偏向同一個方向。
 */
export function score(unitId, items) {
  const r = recordFor(unitId);
  let got = 0; let possible = 0; let cannot = 0; let unanswered = 0;
  for (const it of items) {
    const v = r.answers[it.id];
    if (v === undefined) { unanswered += 1; continue; }
    if (v === CANNOT) { cannot += 1; continue; }
    got += Number(v);
    possible += it.max;
  }
  return {
    got, possible, cannot, unanswered,
    pct: possible ? Math.round((100 * got) / possible) : null,
  };
}

// ---- 計時 ----------------------------------------------------------------
//
// 耗時是本工具推估擴充成本的唯一依據，把發呆與離開的時間算進去，
// 「評完全台要多久」就變成一個沒有意義的數字。
//
// 故超過一分鐘沒有任何操作即停止計時。一分鐘的寬限是留給「盯著
// 街景看但沒動滑鼠」——那是真的在工作。恢復操作時不補算中間的空白。

const IDLE_MS = 60_000;

let timing = null;
let lastActivity = Date.now();

/**
 * 記錄一次使用者操作。滑鼠、鍵盤、捲動與街景視角變動皆算。
 * 自閒置恢復時重設計時起點，使中間的空白不被計入。
 */
export function noteActivity() {
  const now = Date.now();
  if (timing && now - lastActivity > IDLE_MS) timing.at = now;
  lastActivity = now;
}

export const isIdle = () => Date.now() - lastActivity > IDLE_MS;

export function startTimer(unitId) {
  stopTimer();
  const r = recordFor(unitId);
  r.opens += 1;
  lastActivity = Date.now();
  timing = { unitId, at: lastActivity };
  write();
}

/**
 * 將目前累積的秒數落盤並重設計時起點。
 *
 * 只在 stopTimer 落盤是不夠的：頁面被關閉時 beforeunload 未必來得及
 * 寫入，正在進行中那一段的時間就整個消失。實測曾因此掉了 31 秒。
 * 故由呼叫端定期呼叫此函式。
 */
export function flushTimer() {
  if (!timing) return;
  const now = Date.now();
  // 只計到「最後一次操作再加一分鐘」為止。超過的部分是閒置，不計。
  const cutoff = Math.min(now, lastActivity + IDLE_MS);
  const add = Math.round((cutoff - timing.at) / 1000);
  if (add > 0) {
    recordFor(timing.unitId).seconds += add;
    timing.at = cutoff;
    write();
  }
}

export function stopTimer() {
  flushTimer();
  timing = null;
}

/** 含目前這一段尚未結算的時間，同樣扣除閒置。 */
export function secondsFor(unitId) {
  const r = recordFor(unitId);
  if (timing?.unitId !== unitId) return r.seconds;
  const cutoff = Math.min(Date.now(), lastActivity + IDLE_MS);
  return r.seconds + Math.max(0, Math.round((cutoff - timing.at) / 1000));
}

/**
 * 清除某單位的計時，作答不動。
 *
 * 被打斷、中途離開、或想重評一次時需要。舊資料若含閒置時間，
 * 留著會污染速率統計——而那是推估擴充成本的唯一依據。
 */
export function resetTimer(unitId) {
  const r = recordFor(unitId);
  r.seconds = 0;
  r.opens = 0;
  if (timing?.unitId === unitId) timing.at = Date.now();
  lastActivity = Date.now();
  write();
}

export function timingStats(unitIds) {
  const xs = unitIds
    .map((id) => state.records[id])
    .filter((r) => r && r.status === DONE && r.seconds > 0)
    .map((r) => r.seconds)
    .sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return {
    n: xs.length,
    total: xs.reduce((s, x) => s + x, 0),
    median: xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2),
    mean: Math.round(xs.reduce((s, x) => s + x, 0) / xs.length),
  };
}

// ---- 未匯出提示 ----------------------------------------------------------

let dirty = 0;
function markDirty() { dirty += 1; }
export const unexported = () => dirty;

// ---- 匯出與匯入 ----------------------------------------------------------

/** 以單位識別碼為鍵，供地圖直接查表作為風險圖層（design D6）。 */
export function buildExport(units, items, instrument) {
  const out = {};
  for (const u of units) {
    const r = state.records[u.id];
    if (!r) continue;
    const s = score(u.id, items);
    out[u.id] = {
      kind: u.kind,
      status: r.status,
      score: s.got,
      possible: s.possible,
      pct: s.pct,
      cannot_determine: s.cannot,
      unanswered: s.unanswered,
      seconds: r.seconds,
      opens: r.opens,
      answers: r.answers,
      reasons: r.reasons,
      updatedAt: r.updatedAt,
    };
  }
  return {
    instrument: { name: instrument.name, version: instrument.version },
    exportedAt: new Date().toISOString(),
    sources: Object.fromEntries(items.map((i) => [i.id, i.source])),
    units: out,
  };
}

export function download(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  dirty = 0;
  state.exportedAt = data.exportedAt;
  write();
}

/**
 * 匯入。判準版本不符時回傳警告而非靜默重新計分
 * （audit-records spec）。
 */
export function importData(data, currentVersion) {
  if (!data?.units) throw new Error('檔案格式不符：找不到 units');
  const incoming = data.instrument?.version ?? '(未標明)';
  const warning = incoming === currentVersion ? null
    : `匯入檔依據的判準版本為 ${incoming}，目前為 ${currentVersion}。`
      + '分數與作答維持原樣，未以目前判準重新計分。';

  let n = 0;
  for (const [id, r] of Object.entries(data.units)) {
    state.records[id] = {
      answers: r.answers ?? {}, reasons: r.reasons ?? {},
      status: r.status ?? PROGRESS, seconds: r.seconds ?? 0,
      opens: r.opens ?? 0, version: incoming, updatedAt: r.updatedAt ?? null,
    };
    n += 1;
  }
  dirty = 0;
  write();
  return { imported: n, warning };
}
