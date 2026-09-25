"""
縣市界與縣市判定。

校名與事故地點字串都不足以可靠判定縣市——「國立仁愛高級農業職業學校」
的「仁愛」是南投縣仁愛鄉，而事故地點欄位的寫法各縣市警局不一。
座標落在哪個縣市界內才是確定的答案。

縣市界取自 OpenStreetMap 的 admin_level=4（ODbL 1.0），以
fetch_counties() 抓取並快取。
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path

from shapely.geometry import LineString, Point
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree

COUNTIES = ['臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市', '基隆市', '新竹市',
            '嘉義市', '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣', '屏東縣',
            '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣']

OVERPASS = 'https://overpass-api.de/api/interpreter'
QUERY = '''[out:json][timeout:180];
relation["boundary"="administrative"]["admin_level"="4"](20.5,118.0,26.5,122.5);
out geom;'''


def fix(s: str | None) -> str:
    return (s or '').replace('台', '臺').replace('　', '').strip()


def fetch_counties(cache: Path) -> Path:
    """抓取縣市界並快取。已存在則不重抓。"""
    if cache.exists():
        return cache
    cache.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(
        OVERPASS,
        data=urllib.parse.urlencode({'data': QUERY}).encode(),
        headers={'User-Agent': 'school-route-audit/0.1 (research project)'})
    cache.write_bytes(urllib.request.urlopen(req, timeout=180).read())
    return cache


def load_index(cache: Path):
    """自 Overpass 的邊界線段組出縣市面，回傳可供 county_of_point 使用的索引。"""
    if not cache.exists():
        return None
    data = json.loads(cache.read_text(encoding='utf-8'))
    polys, names = [], []
    for rel in data.get('elements', []):
        name = fix(rel.get('tags', {}).get('name', ''))
        if name not in COUNTIES:
            continue
        lines = [LineString([(p['lon'], p['lat']) for p in m['geometry']])
                 for m in rel.get('members', [])
                 if m.get('type') == 'way' and len(m.get('geometry', [])) > 1]
        built = list(polygonize(unary_union(lines))) if lines else []
        if not built:
            continue
        polys.append(unary_union(built))
        names.append(name)
    return (STRtree(polys), polys, names) if polys else None


def county_of_point(idx, x: float, y: float) -> str | None:
    """
    取包含該點且面積最小的縣市。

    臺北市完整位於新北市之內，嘉義市亦位於嘉義縣之內。自邊界線段組面時
    內孔會被填實，故一個點可能同時落在兩個縣市內；取面積較小者即取到飛地
    本身。若不這樣做，臺北市的資料會全部被判進新北市。
    """
    if idx is None:
        return None
    tree, polys, names = idx
    pt = Point(x, y)
    hits = [i for i in tree.query(pt) if polys[i].contains(pt)]
    if not hits:
        return None
    return names[min(hits, key=lambda i: polys[i].area)]
