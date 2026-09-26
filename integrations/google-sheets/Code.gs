/**
 * 學區道路健檢 — 評估結果同步端點
 *
 * 部署為「網頁應用程式」後，評估工作台會把各評估者的結果寫入本
 * 試算表，並可讀回全體的彙總。
 *
 * 安全性說明：本端點部署為「任何人都可存取」，TOKEN 只是路障，
 * 擋掉隨機掃描而非有心人。真正的保護是網址不公開。若日後需要
 * 權限控制，應改用具認證的後端。
 *
 * 部署步驟見同目錄的 README.md。
 */

// 與前端設定一致的共用字串。部署前請改成你自己的隨機字串。
const TOKEN = 'CHANGE-ME-到一段夠長的隨機字串';

const SHEET_RECORDS = '評估結果';
const SHEET_ASSIGN = '分派';

const HEADERS = [
  '更新時間', '評估者', '單位識別碼', '型別', '狀態',
  '得分', '滿分', '百分比', '無法判定項數', '未作答項數',
  '耗時秒', '開啟次數', '判準版本', '作答JSON', '原因JSON',
];

function sheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers) sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 讀回全體評估結果與分派表。 */
function doGet(e) {
  if ((e.parameter.token || '') !== TOKEN) {
    return json_({ ok: false, error: 'token 不符' });
  }
  const sh = sheet_(SHEET_RECORDS, HEADERS);
  const rows = sh.getDataRange().getValues();
  const head = rows.shift() || [];
  const records = rows.map((r) => {
    const o = {};
    head.forEach((h, i) => { o[h] = r[i]; });
    return {
      evaluator: String(o['評估者'] || ''),
      unitId: String(o['單位識別碼'] || ''),
      kind: String(o['型別'] || ''),
      status: String(o['狀態'] || ''),
      score: Number(o['得分'] || 0),
      possible: Number(o['滿分'] || 0),
      pct: o['百分比'] === '' ? null : Number(o['百分比']),
      cannot: Number(o['無法判定項數'] || 0),
      unanswered: Number(o['未作答項數'] || 0),
      seconds: Number(o['耗時秒'] || 0),
      updatedAt: String(o['更新時間'] || ''),
    };
  });

  const ash = sheet_(SHEET_ASSIGN, ['評估者', '單位識別碼']);
  const arows = ash.getDataRange().getValues();
  arows.shift();
  const assignments = arows
    .filter((r) => r[0] && r[1])
    .map((r) => ({ evaluator: String(r[0]), unitId: String(r[1]) }));

  return json_({ ok: true, records: records, assignments: assignments });
}

/**
 * 寫入或更新某評估者的結果。
 *
 * 以「評估者＋單位識別碼」為鍵覆寫，故重複送出同一筆不會產生
 * 重複列。不同評估者評同一段會各自成列——本工具的設定是分工，
 * 若出現同段多人，彙總時會標示為衝突而非自行平均。
 */
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: '無法解析內容' });
  }
  if ((body.token || '') !== TOKEN) {
    return json_({ ok: false, error: 'token 不符' });
  }
  const evaluator = String(body.evaluator || '').trim();
  if (!evaluator) return json_({ ok: false, error: '缺少評估者署名' });

  const sh = sheet_(SHEET_RECORDS, HEADERS);
  const values = sh.getDataRange().getValues();
  const index = {};
  for (let i = 1; i < values.length; i++) {
    index[values[i][1] + '\u001f' + values[i][2]] = i + 1;   // 列號
  }

  const now = new Date().toISOString();
  let written = 0;
  const units = body.units || {};
  Object.keys(units).forEach(function (unitId) {
    const u = units[unitId];
    const row = [
      now, evaluator, unitId, u.kind || '', u.status || '',
      u.score == null ? '' : u.score,
      u.possible == null ? '' : u.possible,
      u.pct == null ? '' : u.pct,
      u.cannot_determine || 0, u.unanswered || 0,
      u.seconds || 0, u.opens || 0,
      (body.instrument && body.instrument.version) || '',
      JSON.stringify(u.answers || {}),
      JSON.stringify(u.reasons || {}),
    ];
    const at = index[evaluator + '\u001f' + unitId];
    if (at) sh.getRange(at, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
    written++;
  });

  return json_({ ok: true, written: written, evaluator: evaluator });
}
