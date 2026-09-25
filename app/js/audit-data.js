// 評估工作台的資料層：判準與待評單位。
//
// 單位直接引用地圖工具產出的路段識別碼（design D1）。兩套識別碼
// 若各自獨立，評估結果就接不回地圖——而那正是本工具存在的目的。

const INSTRUMENT_URL = 'data/instrument/maps-mini-tw.json';
const UNITS_URL = 'data/audit/demo-units.json';

/** 判準。載入時驗證，缺漏或重複即拒絕整份，不部分載入。 */
export async function loadInstrument() {
  const res = await fetch(INSTRUMENT_URL);
  if (!res.ok) throw new Error(`判準檔載入失敗（HTTP ${res.status}）`);
  const inst = await res.json();

  const problems = [];
  if (!inst.version) problems.push('缺少 version');
  const seen = new Set();
  for (const [i, item] of (inst.items ?? []).entries()) {
    const where = `第 ${i + 1} 項（${item.id ?? '無識別碼'}）`;
    if (!item.id) problems.push(`${where}：缺少 id`);
    else if (seen.has(item.id)) problems.push(`${where}：識別碼重複`);
    else seen.add(item.id);
    if (!item.section) problems.push(`${where}：缺少 section`);
    if (!['maps-mini', 'local'].includes(item.source)) {
      problems.push(`${where}：未知的來源標記 ${item.source}`);
    }
    if (!Array.isArray(item.options) || !item.options.length) {
      problems.push(`${where}：缺少選項`);
    }
  }
  if (problems.length) {
    throw new Error(`判準檔有誤，已拒絕載入：\n・${problems.join('\n・')}`);
  }
  return inst;
}

/**
 * 待評單位。以識別碼自地圖工具的資料中解析。
 * 對應不到者明確報出而非靜默略過（audit-units spec）。
 */
export async function loadUnits() {
  const res = await fetch(UNITS_URL);
  if (!res.ok) throw new Error(`待評清單載入失敗（HTTP ${res.status}）`);
  const list = await res.json();

  const [sw, rd] = await Promise.all([
    fetchFeatures(`data/sidewalk/${encodeURIComponent(list.sources.sidewalk)}.geojson`),
    fetchFeatures(`data/roads/${encodeURIComponent(list.sources.roads)}.geojson`),
  ]);
  const swById = new Map(sw.map((f) => [String(f.properties.id), f]));
  const rdById = new Map(rd.map((f) => [String(f.properties.osm_id), f]));

  const units = [];
  const missing = [];
  for (const u of list.units) {
    const f = (u.kind === 'sidewalk' ? swById : rdById).get(String(u.id));
    if (!f) {
      missing.push(u.id);
      continue;
    }
    units.push({ ...u, id: String(u.id), feature: f, props: f.properties });
  }
  return { name: list.name, note: list.note, units, missing };
}

async function fetchFeatures(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} 載入失敗（HTTP ${res.status}）`);
  return (await res.json()).features;
}

/** 幾何的概略中心，供街景定位。 */
export function centroidOf(geometry) {
  const pts = [];
  const walk = (c) => {
    if (typeof c[0] === 'number') pts.push(c);
    else c.forEach(walk);
  };
  walk(geometry.coordinates);
  const n = pts.length || 1;
  return {
    lng: pts.reduce((s, p) => s + p[0], 0) / n,
    lat: pts.reduce((s, p) => s + p[1], 0) / n,
  };
}

/**
 * 開放資料中已有的對應欄位，供介面並陳作為對照。
 *
 * **不預填**。預填會錨定判讀，使評估淪為確認既有資料（design D2）。
 */
export function openDataRef(unit) {
  const p = unit.props;
  if (unit.kind === 'road') {
    return [
      ['人行道', '查無紀錄'],
      ['OSM 道路等級', p.highway ?? '未提供'],
    ];
  }
  return [
    ['人行道', '有紀錄'],
    ['淨寬', p.SWW_WTH != null ? `${p.SWW_WTH} m` : '未提供'],
    ['寬度', p.SW_WTH != null ? `${p.SW_WTH} m` : '未提供'],
    ['路緣斜坡', p.SW_RAMP != null ? `${p.SW_RAMP} 處` : '未提供'],
    ['長度', p.SW_LENG != null ? `${p.SW_LENG} m` : '未提供'],
  ];
}

export function titleOf(unit) {
  return unit.props.NAME ?? unit.props.name ?? '（無路名）';
}

export function subtitleOf(unit) {
  const p = unit.props;
  if (unit.kind === 'road') return '查無人行道紀錄的道路';
  const seg = [p.PSTART, p.PEND].filter(Boolean).join(' → ');
  return [p.VILL_NAME, seg].filter(Boolean).join('・');
}
