#!/usr/bin/env python3
"""
Build src/assets/streetscape/hk-street-sheets.json

Maps Hong Kong street / place names → LandsD Open3Dhk 1:1000 TILE_NAME.

Sources:
  - Sheet grid: GRID_WGS84_B1K_INDEX_INDIVIDUAL_WHOLEHK.geojson
  - Streets: CSDI LandsD Road Centreline WFS (csdi:RoadCentreLine)
  - Places: OSM Overpass (village/suburb/neighbourhood/…); LandsD Place Name
    WFS was consolidated into Road Centreline and archived endpoints return 499.

Usage:
  python scripts/streetscape/build-hk-street-sheets.py
  python scripts/streetscape/build-hk-street-sheets.py --roads-only
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src" / "assets" / "streetscape" / "hk-street-sheets.json"
OVERRIDES = Path(__file__).resolve().parent / "hk-street-sheets-overrides.json"

GRID_URL = (
    "https://3d.map.gov.hk/mapviewer/app/grid/"
    "GRID_WGS84_B1K_INDEX_INDIVIDUAL_WHOLEHK.geojson"
)
ROAD_WFS = (
    "https://portal.csdi.gov.hk/server/services/common/"
    "landsd_rcd_1637310758814_80061/MapServer/WFSServer"
)
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

UA = {"User-Agent": "UdonariumWithFly-streetscape-build/1.0 (dev; sheet lookup)"}

PAGE = 2000


def http_get(url: str, timeout: int = 180) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def http_post(url: str, body: bytes, timeout: int = 180) -> bytes:
    req = urllib.request.Request(url, data=body, headers={**UA, "Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def load_json(url: str) -> dict:
    return json.loads(http_get(url).decode("utf-8"))


def ring_of(geom: dict) -> list[list[float]] | None:
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if not coords:
        return None
    if gtype == "Polygon":
        return coords[0]
    if gtype == "MultiPolygon":
        return coords[0][0]
    return None


def point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    n = len(ring)
    for i in range(n - 1):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[i + 1][0], ring[i + 1][1]
        if ((y1 > lat) != (y2 > lat)) and (
            lon < (x2 - x1) * (lat - y1) / ((y2 - y1) + 1e-15) + x1
        ):
            inside = not inside
    return inside


def bbox_of(ring: list[list[float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


class SheetIndex:
    def __init__(self, features: list[dict]):
        self.sheets: list[tuple[str, tuple[float, float, float, float], list[list[float]]]] = []
        for f in features:
            props = f.get("properties") or {}
            name = props.get("TILE_NAME") or ""
            ring = ring_of(f.get("geometry") or {})
            if not name or not ring:
                continue
            self.sheets.append((name, bbox_of(ring), ring))

    def lookup(self, lon: float, lat: float) -> str | None:
        for name, (minx, miny, maxx, maxy), ring in self.sheets:
            if not (minx <= lon <= maxx and miny <= lat <= maxy):
                continue
            if point_in_ring(lon, lat, ring):
                return name
        return None


def line_midpoint(geom: dict) -> tuple[float, float] | None:
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if not coords:
        return None
    if gtype == "LineString":
        pts = coords
    elif gtype == "MultiLineString":
        # longest part
        pts = max(coords, key=lambda p: len(p))
    else:
        return None
    if not pts:
        return None
    mid = pts[len(pts) // 2]
    return float(mid[0]), float(mid[1])


def norm_name(s: str | None) -> str:
    if not s:
        return ""
    return " ".join(str(s).strip().split())


def fetch_roads(start: int, count: int) -> dict:
    q = urllib.parse.urlencode(
        {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": "csdi:RoadCentreLine",
            "outputFormat": "GEOJSON",
            "srsName": "EPSG:4326",
            "startIndex": str(start),
            "count": str(count),
        }
    )
    return json.loads(http_get(ROAD_WFS + "?" + q).decode("utf-8"))


def road_hits() -> int:
    q = urllib.parse.urlencode(
        {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": "csdi:RoadCentreLine",
            "resultType": "hits",
        }
    )
    xml = http_get(ROAD_WFS + "?" + q).decode("utf-8", "replace")
    # numberMatched="39859"
    import re

    m = re.search(r'numberMatched="(\d+)"', xml)
    return int(m.group(1)) if m else 0


def collect_roads(index: SheetIndex) -> dict[str, dict]:
    """key = zh|en canonical → {zh, en, sheet, weight}"""
    total = road_hits()
    print(f"RoadCentreLine features: {total}", flush=True)
    # key: (zh_lower or en_lower) → votes per sheet
    votes: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    meta: dict[str, dict[str, str]] = {}

    start = 0
    while start < total or (total == 0 and start == 0):
        try:
            data = fetch_roads(start, PAGE)
        except urllib.error.HTTPError as e:
            print(f"WFS page start={start} failed: {e}; retry…", flush=True)
            time.sleep(2)
            data = fetch_roads(start, PAGE)
        feats = data.get("features") or []
        if not feats:
            break
        for f in feats:
            props = f.get("properties") or {}
            zh = norm_name(props.get("CHINESESTREETNAME"))
            en = norm_name(props.get("ENGLISHSTREETNAME"))
            if not zh and not en:
                continue
            pt = line_midpoint(f.get("geometry") or {})
            if not pt:
                continue
            sheet = index.lookup(pt[0], pt[1])
            if not sheet:
                continue
            length = float(props.get("SHAPE_Length") or 1.0)
            key = (zh or en).casefold()
            votes[key][sheet] += length
            if key not in meta:
                meta[key] = {"zh": zh, "en": en}
            else:
                if zh and not meta[key]["zh"]:
                    meta[key]["zh"] = zh
                if en and not meta[key]["en"]:
                    meta[key]["en"] = en
        start += len(feats)
        print(f"  roads {min(start, total)}/{total}", flush=True)
        if total and start >= total:
            break
        if not total and len(feats) < PAGE:
            break
        time.sleep(0.15)

    out: dict[str, dict] = {}
    for key, sheet_votes in votes.items():
        sheet = max(sheet_votes.items(), key=lambda kv: kv[1])[0]
        m = meta[key]
        out[key] = {
            "zh": m["zh"],
            "en": m["en"],
            "sheet": sheet,
            "kind": "street",
            "weight": max(sheet_votes.values()),
        }
    return out


def collect_osm_places(index: SheetIndex) -> dict[str, dict]:
    query = """
    [out:json][timeout:180];
    (
      node["place"~"^(city|town|suburb|village|neighbourhood|quarter|hamlet)$"](22.15,113.80,22.58,114.45);
      way["place"~"^(city|town|suburb|village|neighbourhood|quarter|hamlet)$"](22.15,113.80,22.58,22.58);
    );
    out center tags;
    """.replace("22.58,22.58", "22.58,114.45")
    # fix the way bbox (typo guard)
    query = """
    [out:json][timeout:180];
    (
      node["place"~"^(city|town|suburb|village|neighbourhood|quarter|hamlet)$"](22.15,113.80,22.58,114.45);
      way["place"~"^(city|town|suburb|village|neighbourhood|quarter|hamlet)$"](22.15,113.80,22.58,114.45);
    );
    out center tags;
    """
    print("Fetching OSM places via Overpass…", flush=True)
    raw = http_post(OVERPASS_URL, urllib.parse.urlencode({"data": query}).encode("utf-8"))
    data = json.loads(raw.decode("utf-8"))
    elements = data.get("elements") or []
    print(f"OSM place elements: {len(elements)}", flush=True)

    votes: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    meta: dict[str, dict[str, str]] = {}

    for el in elements:
        tags = el.get("tags") or {}
        zh = norm_name(tags.get("name:zh") or tags.get("name:zh-Hant") or tags.get("name:zh-Hans"))
        en = norm_name(tags.get("name:en"))
        name = norm_name(tags.get("name"))
        # Prefer Chinese if name looks CJK
        if not zh and name and any("\u4e00" <= c <= "\u9fff" for c in name):
            zh = name
        if not en and name and not zh:
            en = name
        if not zh and not en:
            continue
        if "lat" in el and "lon" in el:
            lon, lat = float(el["lon"]), float(el["lat"])
        else:
            c = el.get("center") or {}
            if "lat" not in c:
                continue
            lon, lat = float(c["lon"]), float(c["lat"])
        sheet = index.lookup(lon, lat)
        if not sheet:
            continue
        key = (zh or en).casefold()
        votes[key][sheet] += 1.0
        if key not in meta:
            meta[key] = {"zh": zh, "en": en}
        else:
            if zh and not meta[key]["zh"]:
                meta[key]["zh"] = zh
            if en and not meta[key]["en"]:
                meta[key]["en"] = en

    out: dict[str, dict] = {}
    for key, sheet_votes in votes.items():
        sheet = max(sheet_votes.items(), key=lambda kv: kv[1])[0]
        m = meta[key]
        out[key] = {
            "zh": m["zh"],
            "en": m["en"],
            "sheet": sheet,
            "kind": "place",
            "weight": max(sheet_votes.values()),
        }
    return out


def merge_entries(roads: dict[str, dict], places: dict[str, dict]) -> list[dict]:
    # Streets win on same key; places fill gaps / add villages.
    merged = dict(places)
    for k, v in roads.items():
        merged[k] = v  # street overrides place of same name
    # Maintainer overrides always win (catalog demos / missing OSM villages).
    if OVERRIDES.is_file():
        raw = json.loads(OVERRIDES.read_text(encoding="utf-8"))
        for e in raw.get("entries") or []:
            zh = norm_name(e.get("zh"))
            en = norm_name(e.get("en"))
            sheet = norm_name(e.get("sheet"))
            if not sheet or (not zh and not en):
                continue
            key = (zh or en).casefold()
            merged[key] = {
                "zh": zh,
                "en": en,
                "sheet": sheet,
                "kind": e.get("kind") if e.get("kind") in ("place", "street") else "place",
                "weight": 1e12,
            }
    entries = []
    for v in merged.values():
        zh = v.get("zh") or ""
        en = v.get("en") or ""
        sheet = v.get("sheet") or ""
        if not sheet or (not zh and not en):
            continue
        e: dict = {"sheet": sheet}
        if zh:
            e["zh"] = zh
        if en:
            e["en"] = en
        if v.get("kind") == "place":
            e["kind"] = "place"
        entries.append(e)
    entries.sort(key=lambda e: ((e.get("zh") or e.get("en") or "").casefold()))
    return entries


def apply_overrides_to_existing() -> int:
    """Fast path: merge overrides into an already-built JSON without re-fetching."""
    if not OUT.is_file():
        print("missing", OUT)
        return 1
    payload = json.loads(OUT.read_text(encoding="utf-8"))
    by_key: dict[str, dict] = {}
    for e in payload.get("entries") or []:
        zh = norm_name(e.get("zh"))
        en = norm_name(e.get("en"))
        key = (zh or en).casefold()
        if key:
            by_key[key] = {
                "zh": zh,
                "en": en,
                "sheet": e.get("sheet"),
                "kind": e.get("kind"),
                "weight": 1,
            }
    empty_roads: dict[str, dict] = {}
    entries = merge_entries(empty_roads, by_key)
    # merge_entries expects places then roads; we passed existing as places and empty roads,
    # then overrides win. Good.
    payload["entries"] = entries
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Updated overrides in {OUT} ({len(entries)} entries)", flush=True)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--roads-only", action="store_true")
    ap.add_argument(
        "--overrides-only",
        action="store_true",
        help="Re-apply overrides JSON onto existing hk-street-sheets.json",
    )
    args = ap.parse_args()

    if args.overrides_only:
        return apply_overrides_to_existing()

    print("Loading B1K sheet grid…", flush=True)
    grid = load_json(GRID_URL)
    index = SheetIndex(grid.get("features") or [])
    print(f"Sheets: {len(index.sheets)}", flush=True)

    # Optional debug limit by monkeypatching total in collect — skip; full build.
    roads = collect_roads(index)
    print(f"Unique streets: {len(roads)}", flush=True)

    places: dict[str, dict] = {}
    if not args.roads_only:
        try:
            places = collect_osm_places(index)
            print(f"Unique places: {len(places)}", flush=True)
        except Exception as e:
            print(f"Place fetch failed (continuing with roads only): {e}", flush=True)

    entries = merge_entries(roads, places)
    payload = {
        "version": 1,
        "attribution": (
            "Street names: Lands Department Road Centreline (CSDI). "
            "Sheet ids: LandsD Open3Dhk B1K index. "
            "Place names (village/suburb/…): OpenStreetMap contributors."
        ),
        "entries": entries,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT} ({len(entries)} entries, {OUT.stat().st_size} bytes)", flush=True)

    # Sanity checks (ASCII-only log for Windows consoles)
    by_zh = {e.get("zh"): e.get("sheet") for e in entries if e.get("zh")}
    for name, sheet in (("Nathan/zh", by_zh.get("彌敦道")), ("ShekKongSanTsuen", by_zh.get("石崗新村"))):
        print(f"check {name}: sheet={sheet}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
