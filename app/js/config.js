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

// 學校類型配色。刻意全用冷色系——紅／黃／綠已被淨寬分級佔用，
// 學校若也用暖色，使用者會分不清「紅色＝這所學校危險」與
// 「紅色＝這段路窄」（design D4）。
export const SCHOOL_LEVELS = [
  { id: '國小',   color: '#4E79A7' },
  { id: '國中',   color: '#76B7B2' },
  { id: '高中職', color: '#B07AA1' },
  { id: '大專',   color: '#3B5BA5' },
  { id: '特殊',   color: '#8C6BB1' },
  { id: '其他',   color: '#9C9C9C' },
];

export const SCHOOL_COLOR = Object.fromEntries(SCHOOL_LEVELS.map((s) => [s.id, s.color]));

// 步行生活圈半徑（公尺）。直線距離，非路網距離——實際走不走得到，
// 正是本工具其餘圖層要回答的問題。
//
// 半徑取「五分鐘步行」乘以各族群的步行速度。速度值為暫定，
// 待查既有文獻後校正（design 待決項）；兒童 300 m 與 spec 一致。
export const WALKSHED_PROFILES = [
  { id: 'child',   label: '兒童（7–12 歲）', speed: 1.0, radius: 300 },
  { id: 'teen',    label: '青少年（13–18 歲）', speed: 1.3, radius: 390 },
  { id: 'elderly', label: '長者', speed: 0.9, radius: 270 },
  { id: 'wheel',   label: '輪椅', speed: 0.8, radius: 240 },
];

export const DEFAULT_PROFILE = 'child';

// A1 事故點的受害者運具配色。
//
// 刻意不用紅色標行人——紅色已是「淨寬 < 1.5 m」，而本圖層最關鍵的
// 判讀正是「行人死亡點是否落在紅色路段上」。若兩者同色，那個點會
// 消失在它要控訴的路段裡。改以深色加白色外圈，確保疊在紅黃綠灰
// 任一種底色上都看得見。
export const CRASH_KINDS = [
  { id: 'pedestrian', color: '#111111', label: '行人' },
  { id: 'motorcycle', color: '#8C4A2F', label: '機車' },
  { id: 'cyclist',    color: '#B8860B', label: '慢車' },
  { id: 'vehicle',    color: '#35618F', label: '汽車、貨車' },
];

export const CRASH_COLOR = Object.fromEntries(CRASH_KINDS.map((k) => [k.id, k.color]));

export const SIDEWALK_BASE = 'data/sidewalk';
export const ROAD_BASE = 'data/roads';
export const SCHOOL_BASE = 'data/schools';
export const CRASH_BASE = 'data/crashes';
