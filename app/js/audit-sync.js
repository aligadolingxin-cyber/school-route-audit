// 與 Google 試算表同步。
//
// localStorage 仍是主要儲存，這裡只是同步目標——網路斷掉不會掉資料。
// 設定（端點、token、署名）存在各人自己的瀏覽器，不進版本庫。
//
// 這不是權限控制：端點部署為「任何人都可存取」，token 只是路障。
// 實際得到的是署名與分工彙總，不是登入。

const KEY = 'audit-sync-config-v1';

let config = { endpoint: '', token: '', evaluator: '' };

export function loadConfig() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) config = { ...config, ...JSON.parse(raw) };
  } catch { /* 無痕視窗等情形，維持空設定 */ }
  return { ...config };
}

export function saveConfig(next) {
  config = { ...config, ...next };
  try { localStorage.setItem(KEY, JSON.stringify(config)); } catch { /* 同上 */ }
  return { ...config };
}

export const isConfigured = () =>
  Boolean(config.endpoint && config.token && config.evaluator);

export const evaluator = () => config.evaluator;

/**
 * 送出目前評估者的結果。
 *
 * 以 text/plain 送出是為了避免 CORS 預檢——Apps Script 的網頁應用
 * 程式不處理 OPTIONS 預檢請求，帶 application/json 會直接失敗。
 * 伺服器端仍以 JSON.parse 解析內容。
 */
export async function push(payload) {
  if (!isConfigured()) throw new Error('尚未設定同步端點');
  const body = JSON.stringify({
    token: config.token,
    evaluator: config.evaluator,
    instrument: payload.instrument,
    units: payload.units,
  });
  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body,
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`同步失敗（HTTP ${res.status}）`);
  const out = await res.json();
  if (!out.ok) throw new Error(out.error || '同步失敗');
  return out;
}

/** 讀回全體的結果與分派表。 */
export async function pull() {
  if (!isConfigured()) throw new Error('尚未設定同步端點');
  const url = `${config.endpoint}?token=${encodeURIComponent(config.token)}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`讀取失敗（HTTP ${res.status}）`);
  const out = await res.json();
  if (!out.ok) throw new Error(out.error || '讀取失敗');
  return out;
}

/**
 * 彙總各評估者的結果。
 *
 * 本工具的設定是分工，故同一段出現多人時標示為衝突而**不自行平均**
 * ——取哪一份是需要人決定的事，程式替它決定等於把判斷藏起來。
 */
export function aggregate(records) {
  const byUnit = new Map();
  for (const r of records) {
    if (!byUnit.has(r.unitId)) byUnit.set(r.unitId, []);
    byUnit.get(r.unitId).push(r);
  }

  const byEvaluator = new Map();
  for (const r of records) {
    const e = byEvaluator.get(r.evaluator) ?? { evaluator: r.evaluator, done: 0, inProgress: 0, seconds: 0 };
    if (r.status === 'done') e.done += 1;
    else if (r.status === 'in_progress') e.inProgress += 1;
    e.seconds += r.seconds || 0;
    byEvaluator.set(r.evaluator, e);
  }

  const conflicts = [...byUnit.entries()]
    .filter(([, rs]) => new Set(rs.filter((r) => r.status !== 'unstarted')
      .map((r) => r.evaluator)).size > 1)
    .map(([unitId, rs]) => ({ unitId, evaluators: [...new Set(rs.map((r) => r.evaluator))] }));

  return {
    units: byUnit,
    evaluators: [...byEvaluator.values()].sort((a, b) => b.done - a.done),
    conflicts,
    totalDone: [...byUnit.values()].filter((rs) => rs.some((r) => r.status === 'done')).length,
  };
}

/** 某評估者被分派到的單位識別碼；分派表為空時回傳 null（代表不限）。 */
export function assignedTo(assignments, who) {
  if (!assignments?.length) return null;
  const mine = assignments.filter((a) => a.evaluator === who).map((a) => a.unitId);
  return mine.length ? new Set(mine) : null;
}
