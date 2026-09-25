// 淨寬分級。門檻與 spec、圖例、前處理腳本三處必須一致。
// 《市區道路及附屬工程設計標準》規定人行道淨寬不得小於 1.5 公尺，
// 故 1.5 這條線不是任意取的，是法規下限。
export const WIDTH_BANDS = [
  { id: 'lt15',   max: 1.5,      color: '#D1495B', label: '< 1.5 m' },
  { id: 'b1525',  max: 2.5,      color: '#E8A33D', label: '1.5 – 2.5 m' },
  { id: 'gte25',  max: Infinity, color: '#4C9A63', label: '≥ 2.5 m' },
];

// 查無人行道紀錄。不是「淨寬 0」，也不是「沒有人行道」——
// 來源資料只收錄有人行道之處，缺席不等於不存在（design D6）。
export const NO_RECORD = { id: 'no_record', color: '#8A8A8A', label: '查無人行道紀錄' };

/** 依淨寬取得分級。null／undefined 回傳 null，呼叫端須自行處理。 */
export function widthBand(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return null;
  return WIDTH_BANDS.find((b) => v < b.max) ?? WIDTH_BANDS[WIDTH_BANDS.length - 1];
}

export const DATA_BASE = 'data/sidewalk';
