# 風險圖層資料

地圖讀取此目錄下的 `latest.json`。**檔案不存在時整層安靜停用**，各路段的風險分數顯示「未提供」——那是誠實的狀態，不是錯誤。

## 怎麼產生

1. 開啟[評估工作台](../../audit.html)
2. 逐段評估
3. 按「匯出」
4. 將下載的檔案改名為 `latest.json` 放在此目錄
5. 提交並推送，部署後地圖即顯示分數

## 為什麼這裡現在是空的

評估結果是**人看著街景做出的判讀**。騎樓有沒有被佔用、行穿線清不清楚、小孩走過去會不會被迫下到車道——這些沒有任何資料集收錄，也不能由程式推算。

這個專案存在的理由正是「開放資料說不出的事要由人去看」。若在這裡放一份看起來像評估結果的檔案，等於把整個論點反過來做。

所以這裡只有說明，沒有資料。

## 格式

以單位識別碼為鍵，識別碼與 `app/data/sidewalk/` 及 `app/data/roads/` 相同：

```json
{
  "instrument": { "name": "...", "version": "..." },
  "exportedAt": "...",
  "sources": { "<項目 id>": "maps-mini | local" },
  "units": {
    "<路段識別碼>": {
      "kind": "sidewalk | road",
      "status": "unstarted | in_progress | done | no_image",
      "score": 0, "possible": 0, "pct": 0,
      "cannot_determine": 0, "unanswered": 0,
      "seconds": 0, "opens": 0,
      "answers": {}, "reasons": {},
      "updatedAt": "..."
    }
  }
}
```

`status` 為 `unstarted` 者視同未評估，地圖仍顯示「未提供」。
