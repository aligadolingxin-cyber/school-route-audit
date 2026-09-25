# /// script
# requires-python = ">=3.11"
# dependencies = ["shapely>=2.0"]
# ///
"""
人行道資料前處理：來源 GeoJSON -> 前端可載入的分縣市檔案

來源：內政部國土管理署「人行道」，data.gov.tw/dataset/58791
      使用其 WGS84 版本，無須轉換座標。

處理內容（見 openspec/changes/map-explorer-mvp/design.md D9、D14）：
  1. 去除來源的完全重複紀錄（幾何與屬性皆相同）
  2. 產生穩定識別碼——來源無 ID 欄位，且語意鍵不唯一
  3. 幾何簡化與座標捨入
  4. 移除前端用不到的屬性
  5. 輸出壓平的 JSON

用法：
    uv run pipeline/build_sidewalk.py --src <SIDEWALK_202606.zip 或解壓目錄>
    uv run pipeline/build_sidewalk.py --src ... --county 台北市
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

from shapely.geometry import shape, mapping
from shapely.ops import unary_union

# 前端需要的屬性。COUNTY_NA 因檔案已分縣市而省略。
KEEP = ["NAME", "PSTART", "PEND", "SW_DIRECT", "SW_LENG", "SW_WTH", "SWW_WTH", "SW_RAMP", "VILL_NAME"]

# 座標小數位數。6 位約 0.11 公尺，遠高於來源 2.5 公尺的平面精度。
# 來源存到 12 位，那是奈米等級，純屬浪費。
PRECISION = 6

# 簡化容差（度）。0.0000027 度約 0.3 公尺。
# 實測 0.5 公尺僅再省 8% 傳輸量，不值得多出的失真。
TOLERANCE = 0.0000027

FNAME = re.compile(r"^SIDEWALK_(?P<county>[^_]+)_(?P<ym>\d{6})_WGS84\.geojson$")


def band(v):
    """淨寬分級。與前端及 spec 的門檻一致。"""
    if v is None:
        return "no_data"
    if v < 1.5:
        return "lt15"
    if v < 2.5:
        return "b1525"
    return "gte25"


def rep_point(geom):
    """代表點，用於識別碼。取重心而非形心，對幾何微調較不敏感。"""
    c = geom.centroid
    return round(c.x, PRECISION), round(c.y, PRECISION)


def make_id(county: str, props: dict, geom) -> str:
    """
    穩定識別碼。

    來源沒有 ID 欄位，而語意鍵（區＋路名＋起訖＋側別）在台北市
    只有 7,417 個相異值對 18,304 筆——忠孝東路七段／向陽路那組
    就重複 26 次。故須加入代表點才能區辨。

    加入代表點後全縣市唯一（去重之後）。識別碼一旦被評估紀錄引用
    即不得變動，故此函式的輸入與捨入位數不可再改。
    """
    x, y = rep_point(geom)
    parts = [county, props["VILL_NAME"], props["NAME"], props["PSTART"], props["PEND"],
             str(props["SW_DIRECT"]), f"{x:.6f}", f"{y:.6f}"]
    h = hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()
    return h[:12]


def round_geom(obj, nd: int):
    """遞迴捨入座標。shapely 沒有內建做法，自行處理。"""
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(float(v), nd) for v in obj]
        return [round_geom(o, nd) for o in obj]
    return obj


def simplify_keep_shape(geom, tol: float):
    """
    簡化幾何，但避免壓垮狹窄多邊形。

    人行道寬度中位數僅 1.35 公尺，0.3 公尺的容差已是其寬度的兩成。
    簡化後若變成空幾何或非面幾何，退回原幾何。
    """
    if tol <= 0:
        return geom
    s = geom.simplify(tol, preserve_topology=True)
    if s.is_empty or s.geom_type not in ("Polygon", "MultiPolygon"):
        return geom
    if not s.is_valid:
        fixed = s.buffer(0)
        if fixed.is_empty or fixed.geom_type not in ("Polygon", "MultiPolygon"):
            return geom
        return fixed
    return s


def iter_sources(src: Path, county: str | None):
    """自 zip 或目錄取出 WGS84 檔案，回傳 (縣市, 資料年月, 內容)。"""
    if src.is_file() and src.suffix.lower() == ".zip":
        with zipfile.ZipFile(src) as z:
            for name in sorted(z.namelist()):
                m = FNAME.match(Path(name).name)
                if not m:
                    continue
                if county and m["county"] != county:
                    continue
                with z.open(name) as fh:
                    yield m["county"], m["ym"], json.load(fh)
    else:
        for p in sorted(src.glob("SIDEWALK_*_WGS84.geojson")):
            m = FNAME.match(p.name)
            if not m:
                continue
            if county and m["county"] != county:
                continue
            yield m["county"], m["ym"], json.loads(p.read_text(encoding="utf-8"))


def process_county(county: str, ym: str, data: dict, tol: float, nd: int):
    src_feats = data["features"]

    # 去重：來源含完全相同的紀錄（台北市 12 組）
    seen, uniq, dupes = set(), [], 0
    for f in src_feats:
        sig = (json.dumps(f["properties"], sort_keys=True, ensure_ascii=False),
               json.dumps(f["geometry"], sort_keys=True))
        if sig in seen:
            dupes += 1
            continue
        seen.add(sig)
        uniq.append(f)

    out, ids, bands = [], set(), {"lt15": 0, "b1525": 0, "gte25": 0, "no_data": 0}
    vtx_before = vtx_after = 0
    collisions = 0

    for f in uniq:
        p = f["properties"]
        geom = shape(f["geometry"])
        vtx_before += len(geom.wkt.split(","))

        fid = make_id(county, p, geom)
        if fid in ids:
            collisions += 1
        ids.add(fid)

        simple = simplify_keep_shape(geom, tol)
        vtx_after += len(simple.wkt.split(","))

        props = {"id": fid}
        props.update({k: p.get(k) for k in KEEP})
        bands[band(p.get("SWW_WTH"))] += 1

        out.append({
            "type": "Feature",
            "properties": props,
            "geometry": {"type": mapping(simple)["type"],
                         "coordinates": round_geom(mapping(simple)["coordinates"], nd)},
        })

    return {
        "county": county, "data_ym": ym,
        "features": out,
        "src_count": len(src_feats), "dupes": dupes, "out_count": len(out),
        "id_collisions": collisions,
        "vtx_before": vtx_before, "vtx_after": vtx_after,
        "bands": bands,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="人行道資料前處理")
    ap.add_argument("--src", required=True, type=Path, help="SIDEWALK_*.zip 或其解壓目錄")
    ap.add_argument("--out", type=Path, default=Path("app/data/sidewalk"), help="輸出目錄")
    ap.add_argument("--county", help="只處理單一縣市，例如 台北市")
    ap.add_argument("--tolerance", type=float, default=TOLERANCE, help="簡化容差（度）")
    ap.add_argument("--precision", type=int, default=PRECISION, help="座標小數位數")
    args = ap.parse_args()

    if not args.src.exists():
        print(f"找不到來源：{args.src}", file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    index, any_found = [], False

    print(f"容差 {args.tolerance} 度（約 {args.tolerance * 111320:.2f} 公尺）｜座標 {args.precision} 位小數")
    print()
    print(f"{'縣市':<8}{'來源':>7}{'重複':>5}{'輸出':>7}{'頂點省':>8}{'MB':>8}{'gzip MB':>9}  淨寬分級")
    print("-" * 82)

    for county, ym, data in iter_sources(args.src, args.county):
        any_found = True
        r = process_county(county, ym, data, args.tolerance, args.precision)

        if r["id_collisions"]:
            print(f"  ！{county} 有 {r['id_collisions']} 筆識別碼碰撞，"
                  f"評估紀錄將無法正確對應", file=sys.stderr)
            return 2

        fc = {"type": "FeatureCollection", "county": county, "data_ym": ym,
              "features": r["features"]}
        blob = json.dumps(fc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        path = args.out / f"{county}.geojson"
        path.write_bytes(blob)

        mb = len(blob) / 1048576
        gz = len(gzip.compress(blob, 9)) / 1048576
        saved = 100 * (1 - r["vtx_after"] / r["vtx_before"]) if r["vtx_before"] else 0
        b = r["bands"]
        print(f"{county:<8}{r['src_count']:>7}{r['dupes']:>5}{r['out_count']:>7}"
              f"{saved:>7.0f}%{mb:>8.2f}{gz:>9.2f}  "
              f"紅{b['lt15']} 黃{b['b1525']} 綠{b['gte25']}")

        index.append({"county": county, "data_ym": ym, "count": r["out_count"],
                      "bytes": len(blob), "file": f"{county}.geojson", "bands": b})

    if not any_found:
        print("來源中沒有符合的 WGS84 檔案", file=sys.stderr)
        return 1

    (args.out / "index.json").write_text(
        json.dumps({"source": "內政部國土管理署「人行道」",
                    "licence": "政府資料開放授權條款第 1 版",
                    "precision": args.precision,
                    "tolerance_deg": args.tolerance,
                    "counties": index}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")

    print()
    print(f"輸出 {len(index)} 個縣市至 {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
