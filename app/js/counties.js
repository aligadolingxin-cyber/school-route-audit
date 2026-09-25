// 縣市清單與三份資料的檔名對應。
//
// 三份政府資料的用字不一致：人行道圖資寫「台北市」，學校範圍圖與
// 事故資料寫「臺北市」。此處不強行統一來源檔名，改以正規化後的
// 名稱為準，各資料集各自記住自己的檔名。

import { SIDEWALK_BASE, SCHOOL_BASE, CRASH_BASE } from './config.js';

/** 「台」與「臺」視為同一字。 */
export const canon = (s) => (s ?? '').replace(/台/g, '臺');

const SOURCES = [
  ['sidewalk', SIDEWALK_BASE],
  ['schools', SCHOOL_BASE],
  ['crashes', CRASH_BASE],
];

let counties = null;

/**
 * 讀三份 index.json，組出縣市清單。
 * 回傳 [{ name, files: { sidewalk, schools, crashes } }]，缺的資料集為 null。
 */
export async function loadCounties() {
  if (counties) return counties;

  const indexes = await Promise.all(SOURCES.map(async ([key, base]) => {
    const res = await fetch(`${base}/index.json`);
    if (!res.ok) throw new Error(`${key} 的 index.json 載入失敗（HTTP ${res.status}）`);
    return [key, await res.json()];
  }));

  const byName = new Map();
  for (const [key, idx] of indexes) {
    for (const row of idx.counties) {
      const name = canon(row.county);
      if (!byName.has(name)) byName.set(name, { name, files: {} });
      byName.get(name).files[key] = row.county;   // 保留來源原本的寫法
    }
  }
  for (const c of byName.values()) {
    for (const [key] of SOURCES) c.files[key] ??= null;
  }

  counties = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  return counties;
}
