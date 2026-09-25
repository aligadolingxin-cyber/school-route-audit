// 風險圖層：讀取評估工作台匯出的結果。
//
// 檔案不存在時整層安靜停用，路段的風險分數維持「未提供」——那是
// 誠實的狀態，不是錯誤。開放資料本來就說不出騎樓被佔用或行穿線
// 品質，沒評估過就是沒評估過。

const RISK_URL = 'data/risk/latest.json';

let loaded = null;
let promise = null;

/** 載入評估結果。檔案不存在時回傳 null，呼叫端據此顯示未提供。 */
export function load() {
  promise ??= (async () => {
    try {
      const res = await fetch(RISK_URL);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data?.units) return null;
      loaded = data;
      return data;
    } catch {
      return null;
    }
  })();
  return promise;
}

/** 某路段的評估結果，未評估者回傳 null。 */
export function forSegment(id) {
  const r = loaded?.units?.[String(id)];
  if (!r) return null;
  // 只有真正作答過的才算評估過。狀態為未開始者視同未評估。
  if (r.status === 'unstarted' || r.score === undefined) return null;
  return r;
}

export function meta() {
  if (!loaded) return null;
  const done = Object.values(loaded.units)
    .filter((u) => u.status !== 'unstarted').length;
  return {
    instrument: loaded.instrument,
    exportedAt: loaded.exportedAt,
    evaluated: done,
    total: Object.keys(loaded.units).length,
  };
}

/** 分數級距。愈高愈好，與淨寬的紅黃綠同向。 */
export const RISK_BANDS = [
  { id: 'r_low', max: 40, color: '#D1495B', label: '未達 40%' },
  { id: 'r_mid', max: 70, color: '#E8A33D', label: '40–70%' },
  { id: 'r_high', max: Infinity, color: '#4C9A63', label: '70% 以上' },
];

export function bandFor(pct) {
  if (typeof pct !== 'number') return null;
  return RISK_BANDS.find((b) => pct < b.max) ?? RISK_BANDS[RISK_BANDS.length - 1];
}
