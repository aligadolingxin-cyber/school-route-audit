# /// script
# requires-python = ">=3.11"
# dependencies = ["shapely>=2.0"]
# ///
"""
A1 致命交通事故前處理：警政署 CSV -> 分縣市點位 GeoJSON

來源：內政部警政署「傷亡道路交通事故資料」，data.gov.tw
      A1 = 當場或 24 小時內死亡。僅取 A1；A2 傷害事故量體大上兩個
      數量級（單年 580 MB）且與本工具的用途無關。

資料結構要注意：**一列是一個當事者，不是一場事故。** 114 年的
4,137 列實際上只有 1,607 場事故。同一場事故的當事者列共用發生
時間與地點，需先合併再輸出，否則點位會重疊計數。

用法：
    uv run pipeline/build_crashes.py --src data/raw/A1_114.csv
    uv run pipeline/build_crashes.py --src <zip>   （自動取出其中的 A1 檔）
"""

from __future__ import annotations

import argparse
import collections
import csv
import gzip
import io
import json
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from twcounty import fetch_counties, load_index, county_of_point  # noqa: E402

# 受害者運具的脆弱度排序。一場事故有多個當事者時取最脆弱者著色，
# 因為本工具關心的是行人與兩輪族群的處境。
VULNERABILITY = ['人', '慢車', '機車', '小客車(含客、貨兩用)', '小貨車',
                 '大客車', '大貨車', '曳引車', '半聯結車', '全聯結車', '其他車']

# 併為前端使用的四類，與圖例一致
KIND = {'人': 'pedestrian', '慢車': 'cyclist', '機車': 'motorcycle'}


def kind_of(parties: list[str]) -> str:
    for v in VULNERABILITY:
        if v in parties:
            return KIND.get(v, 'vehicle')
    return 'vehicle'


def deaths_of(text: str) -> int:
    m = re.search(r'死亡(\d+)', text or '')
    return int(m.group(1)) if m else 0


def read_rows(src: Path):
    """自 CSV 或含 A1 檔的 zip 讀取。"""
    if src.suffix.lower() == '.zip':
        with zipfile.ZipFile(src) as z:
            name = next((n for n in z.namelist() if 'A1' in n and n.endswith('.csv')), None)
            if not name:
                raise SystemExit(f'{src} 內找不到 A1 的 CSV')
            print(f'自壓縮檔取出 {name}')
            raw = z.read(name)
    else:
        raw = src.read_bytes()
    return list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))))


def main() -> int:
    ap = argparse.ArgumentParser(description='A1 事故前處理')
    ap.add_argument('--src', required=True, type=Path)
    ap.add_argument('--raw', type=Path, default=Path('data/raw'))
    ap.add_argument('--out', type=Path, default=Path('app/data/crashes'))
    ap.add_argument('--precision', type=int, default=6)
    args = ap.parse_args()

    if not args.src.exists():
        print(f'找不到來源：{args.src}', file=sys.stderr)
        return 1

    idx = load_index(fetch_counties(args.raw / 'tw_counties.json'))
    if idx is None:
        print('無法載入縣市界', file=sys.stderr)
        return 1
    print(f'縣市界 {len(idx[2])} 個（OpenStreetMap，ODbL 1.0）')

    rows = read_rows(args.src)
    print(f'當事者列 {len(rows)}')

    # 合併同一場事故的當事者列
    groups = collections.defaultdict(list)
    for r in rows:
        groups[(r['發生日期'], r['發生時間'], r['發生地點'])].append(r)
    print(f'相異事故 {len(groups)}')

    per_county = collections.defaultdict(list)
    no_xy = no_county = 0
    years = set()
    kinds = collections.Counter()

    for (date, time, place), party in groups.items():
        xy = None
        for r in party:
            try:
                x, y = float(r['經度']), float(r['緯度'])
            except (TypeError, ValueError):
                continue
            if abs(x) > 0.01 and abs(y) > 0.01:
                xy = (x, y)
                break
        if xy is None:
            no_xy += 1
            continue

        cty = county_of_point(idx, *xy)
        if cty is None:
            no_county += 1
            continue

        parties = [p['當事者區分-類別-大類別名稱-車種'] for p in party]
        dead = max(deaths_of(p['死亡受傷人數']) for p in party)
        k = kind_of(parties)
        kinds[k] += 1
        years.add(date[:4])

        per_county[cty].append({
            'type': 'Feature',
            'properties': {
                'date': date,
                'time': time[:4],
                'place': place,
                'deaths': dead,
                'kind': k,
                'parties': sorted({p for p in parties if p}),
            },
            'geometry': {'type': 'Point',
                         'coordinates': [round(xy[0], args.precision),
                                         round(xy[1], args.precision)]},
        })

    args.out.mkdir(parents=True, exist_ok=True)
    index = []
    print()
    print(f"{'縣市':<8}{'事故':>6}{'死亡':>6}{'KB':>8}   受害者運具")
    print('-' * 66)
    for cty in sorted(per_county):
        feats = per_county[cty]
        blob = json.dumps({'type': 'FeatureCollection', 'county': cty,
                           'years': sorted(years), 'features': feats},
                          ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        (args.out / f'{cty}.geojson').write_bytes(blob)
        kc = collections.Counter(f['properties']['kind'] for f in feats)
        dead = sum(f['properties']['deaths'] for f in feats)
        print(f"{cty:<8}{len(feats):>6}{dead:>6}{len(blob)/1024:>8.0f}   "
              + ' '.join(f'{k}{v}' for k, v in sorted(kc.items())))
        index.append({'county': cty, 'count': len(feats), 'deaths': dead,
                      'file': f'{cty}.geojson'})

    (args.out / 'index.json').write_text(json.dumps(
        {'source': '內政部警政署「傷亡道路交通事故資料」A1',
         'licence': '政府資料開放授權條款第 1 版',
         'note': 'A1 為當場或 24 小時內死亡。一列原為一個當事者，此處已合併為事故。',
         'years': sorted(years), 'counties': index},
        ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    print()
    print(f'涵蓋年份 {sorted(years)}')
    print(f'無座標而排除 {no_xy} 場；有座標但不落在任何縣市界內 {no_county} 場')
    print('受害者運具分布:', dict(kinds))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
