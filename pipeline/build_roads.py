# /// script
# requires-python = ">=3.11"
# dependencies = ["shapely>=2.0", "pyproj>=3.6"]
# ///
"""
道路中心線前處理：OSM -> 「查無人行道紀錄」的道路

人行道資料集只收錄「有人行道之處」。若地圖只畫人行道，沒有人行道的
巷弄會完全消失，使人誤以為那裡無路可走——而那正是學童步行之處。
本管線補上那些道路（design D12）。

**只輸出查無紀錄者。** 有人行道的道路已由人行道多邊形圖層呈現，
再畫一次只是增加檔案大小。比例等統計數字寫入 index.json。

比對方式為空間鄰近，不是路名字串（design D13）。勘查階段以路名
比對得到大安區 55.9%，但路名格式不一，字串比對會把格式差異誤判
為沒有人行道。

用法：
    uv run pipeline/build_roads.py --county 臺北市
    uv run pipeline/build_roads.py --county 臺北市 --buffer 20
"""

from __future__ import annotations

import argparse
import collections
import gzip
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import LineString, shape
from shapely.ops import transform as shp_transform, unary_union
from shapely.strtree import STRtree

sys.path.insert(0, str(Path(__file__).parent))
from twcounty import load_index, fetch_counties, fix  # noqa: E402

# 學童步行會用到的道路。排除國道與快速道路——小孩不會走那裡，
# 而它們會在地圖上造成大量與通學無關的灰線。
CLASSES = ('primary|secondary|tertiary|unclassified|residential|'
           'living_street|service|pedestrian|road')

# service 底下的車道與停車場通道不是通學路徑
SERVICE_SKIP = {'parking_aisle', 'driveway', 'drive-through', 'drive_through'}

OVERPASS = 'https://overpass-api.de/api/interpreter'


def fetch_roads(county: str, bounds, cache: Path) -> dict:
    """依縣市外接矩形取 OSM 道路並快取。查詢慢（台北市約 4 分鐘），故必快取。"""
    if cache.exists():
        return json.loads(cache.read_text(encoding='utf-8'))
    minx, miny, maxx, maxy = bounds
    q = (f'[out:json][timeout:300];\n'
         f'way["highway"~"^({CLASSES})(_link)?$"]'
         f'({miny:.4f},{minx:.4f},{maxy:.4f},{maxx:.4f});\nout geom;')
    print(f'  向 Overpass 取 {county} 道路…')
    t = time.time()
    req = urllib.request.Request(
        OVERPASS, data=urllib.parse.urlencode({'data': q}).encode(),
        headers={'User-Agent': 'school-route-audit/0.1 (research project)'})
    raw = urllib.request.urlopen(req, timeout=300).read()
    print(f'  取得 {len(raw)/1048576:.1f} MB，耗時 {time.time()-t:.0f} 秒')
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(raw)
    return json.loads(raw)


def keep(tags: dict) -> bool:
    if tags.get('highway') == 'service' and tags.get('service') in SERVICE_SKIP:
        return False
    if tags.get('area') == 'yes':
        return False
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description='道路中心線前處理')
    ap.add_argument('--county', required=True)
    ap.add_argument('--raw', type=Path, default=Path('data/raw'))
    ap.add_argument('--sidewalk', type=Path, default=Path('app/data/sidewalk'))
    ap.add_argument('--out', type=Path, default=Path('app/data/roads'))
    ap.add_argument('--buffer', type=float, default=20.0,
                    help='判定有無人行道的鄰近距離（公尺）')
    ap.add_argument('--sensitivity', action='store_true',
                    help='另以數種距離試算，觀察比例的敏感度')
    ap.add_argument('--precision', type=int, default=6)
    ap.add_argument('--tolerance', type=float, default=0.0000027)
    args = ap.parse_args()

    county = fix(args.county)
    idx = load_index(fetch_counties(args.raw / 'tw_counties.json'))
    if idx is None:
        print('無法載入縣市界', file=sys.stderr)
        return 1
    _, polys, names = idx
    if county not in names:
        print(f'未知縣市：{county}', file=sys.stderr)
        return 1
    boundary = polys[names.index(county)]

    # 人行道檔名用「台」，縣市界用「臺」
    sw_path = next((p for p in args.sidewalk.glob('*.geojson')
                    if fix(p.stem) == county), None)
    if sw_path is None:
        print(f'找不到 {county} 的人行道檔案，請先跑 build_sidewalk.py', file=sys.stderr)
        return 1

    print(f'{county}')
    data = fetch_roads(county, boundary.bounds, args.raw / f'roads_{county}.json')
    els = [e for e in data.get('elements', [])
           if e.get('type') == 'way' and len(e.get('geometry', [])) > 1 and keep(e.get('tags', {}))]
    print(f'  OSM way {len(data.get("elements", []))} 條，過濾後 {len(els)} 條')

    to_m = Transformer.from_crs('EPSG:4326', 'EPSG:3826', always_xy=True).transform

    sw = json.loads(sw_path.read_text(encoding='utf-8'))
    sw_m = [shp_transform(to_m, shape(f['geometry'])) for f in sw['features']]
    tree = STRtree(sw_m)
    print(f'  人行道 {len(sw_m)} 段')

    roads = []
    for e in els:
        line = LineString([(p['lon'], p['lat']) for p in e['geometry']])
        if not line.intersects(boundary):
            continue
        clipped = line.intersection(boundary)
        if clipped.is_empty:
            continue
        parts = ([clipped] if clipped.geom_type == 'LineString'
                 else list(getattr(clipped, 'geoms', [])))
        for part in parts:
            if part.geom_type != 'LineString' or part.length == 0:
                continue
            roads.append((e, part, shp_transform(to_m, part)))
    print(f'  裁入縣市界後 {len(roads)} 段')

    def unmatched(dist: float):
        out = []
        for e, part, part_m in roads:
            buf = part_m.buffer(dist)
            if not any(sw_m[i].intersects(buf) for i in tree.query(buf)):
                out.append((e, part, part_m))
        return out

    if args.sensitivity:
        print('  鄰近距離敏感度：')
        for d in (10, 15, 20, 25, 30):
            n = len(unmatched(d))
            print(f'     {d:>3} m -> 查無人行道紀錄 {n:5d} / {len(roads)}  ({100*n/len(roads):.1f}%)')

    miss = unmatched(args.buffer)
    total_len = sum(r[2].length for r in roads)
    miss_len = sum(r[2].length for r in miss)
    print(f'  以 {args.buffer:.0f} m 判定：查無人行道紀錄 {len(miss)} / {len(roads)} 段'
          f'（{100*len(miss)/len(roads):.1f}%）、'
          f'{miss_len/1000:.0f} / {total_len/1000:.0f} km（{100*miss_len/total_len:.1f}%）')

    def round_coords(o, nd):
        if isinstance(o, (list, tuple)):
            if o and isinstance(o[0], (int, float)):
                return [round(float(v), nd) for v in o]
            return [round_coords(i, nd) for i in o]
        return o

    feats = []
    for e, part, _ in miss:
        t = e.get('tags', {})
        simple = part.simplify(args.tolerance, preserve_topology=False)
        if simple.is_empty or simple.geom_type != 'LineString':
            simple = part
        feats.append({
            'type': 'Feature',
            'properties': {
                'osm_id': e['id'],
                'name': t.get('name'),
                'highway': t.get('highway'),
            },
            'geometry': {'type': 'LineString',
                         'coordinates': round_coords(list(simple.coords), args.precision)},
        })

    by_class = collections.Counter(f['properties']['highway'] for f in feats)
    args.out.mkdir(parents=True, exist_ok=True)
    blob = json.dumps({'type': 'FeatureCollection', 'county': county,
                       'buffer_m': args.buffer, 'features': feats},
                      ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    (args.out / f'{county}.geojson').write_bytes(blob)
    print(f'  輸出 {len(blob)/1048576:.2f} MB / gzip {len(gzip.compress(blob,9))/1048576:.2f} MB')
    print('  查無紀錄者的道路等級:', dict(by_class.most_common(6)))

    ix = args.out / 'index.json'
    index = json.loads(ix.read_text(encoding='utf-8')) if ix.exists() else {
        'source': 'OpenStreetMap', 'licence': 'ODbL 1.0',
        'note': '僅含查無人行道紀錄的道路；有人行道者由人行道圖層呈現。',
        'counties': []}
    index['counties'] = [c for c in index['counties'] if c['county'] != county]
    index['counties'].append({
        'county': county, 'file': f'{county}.geojson', 'buffer_m': args.buffer,
        'roads_total': len(roads), 'roads_no_record': len(miss),
        'km_total': round(total_len / 1000, 1), 'km_no_record': round(miss_len / 1000, 1),
    })
    index['counties'].sort(key=lambda c: c['county'])
    ix.write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
