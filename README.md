# 學區道路健檢

以政府開放資料呈現學校周邊的步行環境，並接入逐段人工評估作為風險圖層。

**狀態：規劃完成，實作中。** 目前進度見 `openspec/changes/*/tasks.md`。

## 這個工具在回答什麼

學童通學路上的步行環境資料散在三個互不相通的政府開放資料集，家長與學校無從得知自家孩子的通學路上人行道有多寬、哪裡窄到不能走、哪裡出過致命事故。本工具將三者疊在同一張地圖上，以路段為單位呈現，並提供街景核對與路段並排比較。

勘查階段的兩個數字說明了問題的規模：

- 台北市有人行道紀錄的 18,304 段中，**58.6% 淨寬未達法規下限 1.5 公尺**。
- 大安區國中小周邊的道路，**55.9% 查無人行道紀錄**——其中九成是巷弄，也就是學童每天走的路。

開放資料能回答的只有「有沒有人行道、多寬、有沒有出過事」。騎樓被佔用、行穿線品質、路口視距、機車停放這些同樣決定安全的因素，沒有任何資料集收錄，只能由人逐段判讀。那部分由本專案的評估工作台產出。

## 線上版

https://aligadolingxin-cyber.github.io/school-route-audit/

推送至 `main` 且異動 `app/` 時自動部署（`.github/workflows/pages.yml`）。部署時會將 `index.html` 的 `__BUILD__` 置換為 commit SHA，使每次部署的 CSS/JS 網址不同——否則瀏覽器會沿用快取的舊版模組，連硬重載都無效。

## 本機預覽

需以 HTTP 提供服務，不能直接開 `file://`（ES module 與 fetch 皆受同源限制）。

```bash
cd app && python -m http.server 8000
```

然後開 http://localhost:8000。本機預覽時 `__BUILD__` 不會被置換，瀏覽器可能快取舊版；開發時請開啟開發者工具並停用快取。

## 結構

```
app/          前端（靜態網站，部署至 GitHub Pages）
app/data/     前處理後的分縣市資料（納入版本庫，即部署產物）
pipeline/     資料前處理腳本
docs/         資料來源、前案界線等文件
openspec/     規格與變更計畫
```

兩個變更計畫：

- `map-explorer-mvp` — 地圖探索工具，用現成開放資料。先做。
- `school-route-audit-mvp` — 逐段評估工作台，以 MAPS-Global／MAPS-SRTS 為判準。其產出接入前者作為風險圖層。

## 資料來源與出處標示

| 資料 | 來源 | 授權 |
|---|---|---|
| 人行道（含淨寬） | 內政部國土管理署 | 政府資料開放授權條款第 1 版 |
| 傷亡道路交通事故 | 內政部警政署 | 政府資料開放授權條款第 1 版 |
| 各級學校範圍圖 | 內政部國土測繪中心 | 政府資料開放授權條款第 1 版 |
| 道路中心線與底圖 | © OpenStreetMap contributors | ODbL 1.0 |

欄位定義、實測結果與各資料集的限制見 [docs/data-sources.md](docs/data-sources.md)。

## 前案

本專案在概念上參考 [Taiwan Mobility Atlas](https://yunching0513.github.io/taiwan-mobility-atlas/sidewalk.html)（原始碼 [yunching0513/schoolzone](https://github.com/yunching0513/schoolzone)，© 2026 Yun-Ching Wu，MIT 授權），該工具已以全國規模實作本專案的多數圖層。

其授權允許直接取用程式碼，但本專案自訂了更嚴的界線：參考其產品決策與技術路線，不取用其原始碼與處理後的資料。理由與細節見 [docs/prior-art.md](docs/prior-art.md)。
