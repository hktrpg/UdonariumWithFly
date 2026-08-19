# Open3Dhk / CSDI Download API — Individualised models

Date gathered: 2026-08-19. Audience: Streetscape Pack live-download (same-origin proxy).  
Related: [open3dhk-spike-notes.md](./open3dhk-spike-notes.md), [open3dhk-streetscape-2_5d.md](./open3dhk-streetscape-2_5d.md).

Primary sources used (fetched this date unless noted):

- [data.gov.hk dataset](https://data.gov.hk/en-data/dataset/hk-landsd-openmap-3d-visualisation-map-individualised-models) and [CKAN `package_show`](https://data.gov.hk/en-data/api/3/action/package_show?id=hk-landsd-openmap-3d-visualisation-map-individualised-models)
- [Open3Dhk Download API UI](https://3d.map.gov.hk/mapviewer/app/download-api?l=en-US) (SPA; webpack chunk `631.0dbc0f23.js` = `DownloadAPIComponent`)
- [LandsD 3D Mapping](https://www.landsd.gov.hk/en/survey-mapping/mapping/3d-mapping.html)
- [CSDI dataset page](https://portal.csdi.gov.hk/csdi-webpage/dataset/landsd_rcd_1671676915450_88604), [CSDI What’s New](https://portal.csdi.gov.hk/csdi-webpage/info/WhatsNew)
- [CSDI 3D Visualisation Map API](https://portal.csdi.gov.hk/csdi-webpage/apidoc/3d-visualisation-map-api) — **tile-based streaming, not this Download API**
- Live ZIP + index: `https://download.map.gov.hk/api/3d-zip/…`, `https://data11.map.gov.hk/api/3d-zip/…`, [sheet index GeoJSON](https://3d.map.gov.hk/mapviewer/app/grid/GRID_WGS84_B1K_INDEX_INDIVIDUAL_WHOLEHK.geojson), [size CSV](https://3d.map.gov.hk/mapviewer/app/grid/INDIVIDUAL_MODELS_DATA_SIZE.csv)

## Executive summary

The Download API is a **GET of one ZIP per 1:1000 sheet**, not a JSON body API. Working shape:

```text
https://download.map.gov.hk/api/3d-zip/{format}/{tile_sheet_num}.zip
https://data11.map.gov.hk/api/3d-zip/{format}/{tile_sheet_num}.zip?key={key}
```

For **GLTF** sheet `11-SE-2C` (the catalog DEMO id): live `Content-Length` **716 907 142 bytes** (`application/zip`). Internally it is **already individualised** — 158 `BUILDING/<id>/<id>.gltf` (+ `.bin` + JPEG/PNG), plus infrastructure / terrain / vegetation. **Not Draco / KTX2** on this sheet (FME 2024 glTF 2.0, external `.bin`, JPEG/PNG).

**`11-SE-2C` is not Nathan Road / TST.** Index centroid ≈ 114.206°E, 22.293°N (Causeway Bay / Tin Hau side of HK Island). Nathan × Salisbury (TST) is sheet **`11-SW-4B`** (~1.80 GiB textured GLTF ZIP; ~58 MiB `GLTF0`).

CORS on the ZIP host **reflects `Origin`** (browser fetch can work). A same-origin proxy is still the safer production path. No captcha / session cookie was required in curl. Documented `401` + `key=` were **not enforced** on 2026-08-19.

In-browser conversion to Pack v1 is **structurally feasible** (one glTF per building) but **not a drop-in ZIP**: must unzip, subset ≤8 features, synthesise `floor.png`, write `manifest.json`. Textured whole-sheet ZIPs (0.7–1.8 GiB) are not a realistic GM-click path. **`GLTF0` (~35–60 MiB)** is the only size class that might survive a browser unzip.

---

## 1. Base URL(s)

| Role | URL | Source |
|---|---|---|
| Docs / builder UI | `https://3d.map.gov.hk/mapviewer/app/download-api?l=en-US` | [data.gov.hk GLTF resource](https://data.gov.hk/en-data/dataset/hk-landsd-openmap-3d-visualisation-map-individualised-models/resource/c2008101-157b-4c1a-b9a2-551348ce7d3c); CKAN `resources[].url` |
| Same SPA, no locale | `https://3d.map.gov.hk/mapviewer/app/download-api` | same HTML shell |
| Short path | `https://3d.map.gov.hk/download-api` | same SPA (`<base href=/mapviewer/app/>`) |
| **ZIP template (documented)** | `https://download.map.gov.hk/api/3d-zip/[format]/[tile_sheet_num].zip?key=[key]` | Open3Dhk `DownloadAPIComponent.getURL` (chunk `631.0dbc0f23.js`) |
| **ZIP host actually used by UI** | `https://data11.map.gov.hk/api/3d-zip/…` | `appendKey` in chunk-common `68929`: `download.` → `data11.` then `key=` |
| Index of every sheet + ready-made URLs | `https://3d.map.gov.hk/mapviewer/app/grid/GRID_WGS84_B1K_INDEX_INDIVIDUAL_WHOLEHK.geojson` | metadata chunk `708` `gridUrl` |
| Advertised sizes (see §3 — **disagrees with live `Content-Length`**) | `https://3d.map.gov.hk/mapviewer/app/grid/INDIVIDUAL_MODELS_DATA_SIZE.csv` | same chunk `zipSizeUrl` |
| CSDI dataset / geoportal | `https://portal.csdi.gov.hk/geoportal/?datasetId=landsd_rcd_1671676915450_88604` | CKAN resource “CSDI Portal” |
| **Not this API** | `https://data.map.gov.hk/api/3d-data/3dtiles/f2/tileset.json?key=` | [CSDI 3D Visualisation Map API](https://portal.csdi.gov.hk/csdi-webpage/apidoc/3d-visualisation-map-api) (Cesium 3D Tiles) |

`https://data.map.gov.hk/api/3d-zip/GLTF/11-SE-2C.zip` returned **404 JSON** (that host is the tiles/streaming stack, not ZIP).

CKAN (2026-08-19): 4 resources, all `is_api: Y` — MAX, FBX, GLTF each point at the Download API HTML; description: *“automated by specifying the data format and 1:1000 topographic map sheet number”*.

---

## 2. Request shape (one 1:1000 sheet)

**Method:** GET. **No JSON body.** Path encodes format + sheet; optional query `key`.

Reconstructed from first-party JS (`getURL` in `631.0dbc0f23.js`):

```js
let base = "https://download.map.gov.hk/api/3d-zip/";
// template when building the docs string:
base + "[format]/[tile_sheet_num].zip?key=[key]"
// live example URL: base + format + "/" + tilenum + ".zip"  then appendKey()
```

`appendKey` (chunk-common module `68929`):

1. Strip any existing `key=`
2. Add `?` or `&`
3. If host starts with `https://download.` → replace with `https://data11.` and append `key=` + `Global.apiKeysProd["2022Q4"]`

Default widgets on the docs page: format **FBX**, sheet **`11-NW-10B`**.

### `format` values (dropdown in the same component)

| `format` | UI group | Meaning (FAQ + dropdown) |
|---|---|---|
| `GLTF` | Textured | Individualised glTF (verified ZIP layout below) |
| `FBX` | Textured | Individualised FBX |
| `MAX` | Textured | 3ds Max |
| `CESIUM`, `OBJ`, `OSGB` | Textured | Tile-based products (FAQ: OBJ / OSGB / Cesium 3D Tiles) — **ZIP internals not unzipped here** |
| `GLTF0`, `FBX0`, `MAX0` | Non-textured | Individualised without photoreal textures. `GLTF0` ZIP also starts with `BUILDING/` (first local header) |

Parameters text on the page: `format` = file format; `tile_sheet_num` = LandsD **1:1000 topographic map sheet number**.

### Concrete URLs that returned 200 + `application/zip` (2026-08-19)

```text
# Textured Individualised GLTF — 11-SE-2C (Causeway Bay, not TST)
https://download.map.gov.hk/api/3d-zip/GLTF/11-SE-2C.zip
https://download.map.gov.hk/api/3d-zip/GLTF/11-SE-2C.zip?key=ad5940a63bd344c48b0351ef1c7a905e
https://data11.map.gov.hk/api/3d-zip/GLTF/11-SE-2C.zip?key=ad5940a63bd344c48b0351ef1c7a905e
https://data11.map.gov.hk/api/3d-zip/GLTF/11-SE-2C.zip          # no key — still 200

# Same sheet, FBX / non-textured
https://data11.map.gov.hk/api/3d-zip/FBX/11-SE-2C.zip?key=ad5940a63bd344c48b0351ef1c7a905e
https://data11.map.gov.hk/api/3d-zip/GLTF0/11-SE-2C.zip?key=ad5940a63bd344c48b0351ef1c7a905e

# Official UI example sheet
https://data11.map.gov.hk/api/3d-zip/GLTF/11-NW-10B.zip?key=ad5940a63bd344c48b0351ef1c7a905e

# Actual Nathan Rd × Salisbury (TST)
https://download.map.gov.hk/api/3d-zip/GLTF/11-SW-4B.zip?key=ad5940a63bd344c48b0351ef1c7a905e
https://download.map.gov.hk/api/3d-zip/GLTF0/11-SW-4B.zip?key=ad5940a63bd344c48b0351ef1c7a905e
```

`key=invalidkey` on `11-SE-2C` GLTF also returned **200** with the same `Content-Length`. Bad sheet `NOT-A-SHEET` → **404**.

Index GeoJSON property `GLTF_URL` is already the `download.map.gov.hk` form with the same prod key on every feature (3 456 sheets).

Sheet ID punctuation: use `11-SE-2C` (hyphens), matching `TILE_NAME` and the UI `tilenum` field.

---

## 3. Response (ZIP, size, layout, Draco/KTX2)

Status table on the Download API page: **200 OK**, **401 Access Denied**, **404 File Not Found**. Response copy: data returned as CESIUM, FBX, GLTF, MAX, OBJ or OSGB.

Live headers (Range GET / HEAD, `data11` / `download.map.gov.hk`):

- `Content-Type: application/zip`
- `Accept-Ranges: bytes` (partial GET works)
- `Access-Control-Allow-Origin: <request Origin>`
- `Access-Control-Allow-Credentials: true`
- `Access-Control-Allow-Methods: GET`

### Sizes — live `Content-Length` vs official CSV

FAQ (Open3Dhk i18n in `app.cbdbc1a6.js`): individualised tiles *“typically range from approximately 30 MB to 20 GB”*; tile-based *“30 MB to 12 GB”*.

| Sheet | Product | Live bytes (2026-08-19) | Index CSV `GLTF_SIZE_MB` |
|---|---|---|---|
| `11-SE-2C` | `GLTF` | **716 907 142** (~684 MiB) | 1845.4 |
| `11-SE-2C` | `FBX` | 723 505 928 | 1693.8 (`FBX_SIZE_MB`) |
| `11-SE-2C` | `GLTF0` | **35 322 282** (~33.7 MiB) | (CSV has no GLTF0 column) |
| `11-NW-10B` | `GLTF` | 861 053 392 | 5723.7 |
| `11-SW-4B` (TST) | `GLTF` | **1 803 407 895** (~1.68 GiB) | 3326.6 |
| `11-SW-4B` | `GLTF0` | **60 492 486** (~57.7 MiB) | — |

**Do not trust the CSV/GeoJSON MB fields for UX or caps.** They are consistently larger than live ZIP bytes (and the CSV is dated 10 Jul 2026 vs ZIP `Last-Modified` 28 Jul 2026 for `11-SE-2C` GLTF). Prefer `HEAD` `Content-Length`.

### `11-SE-2C` GLTF ZIP layout (central directory, 863 entries)

Verified by Range-GET of the ZIP CD (not a full download):

```text
BUILDING/<id>/<id>.gltf
BUILDING/<id>/<id>.bin
BUILDING/<id>/<id>_001.jpg     # photoreal albedo, often 1–9 MiB uncompressed
BUILDING/<id>/<id>_002.png     # tiny; glTF alphaMode BLEND
INFRASTRUCTURE/…
INFRASTRUCTURE(TB)/…
GENERIC/…
TERRAIN(TB)/…                  # one terrain glTF + ~27 MiB JPEG
VEGETATION(TB)/…
```

Counts: **158** building glTFs, **165** glTFs total, 265 JPEG, 97 PNG. This is **many individualised buildings**, not one fused mesh.

First building `B390021690102063A0.gltf` (inflated from local header in the first 16 KiB):

- `asset.generator`: **FME 2024.0.0.0**, `asset.version`: **2.0**
- External `.bin` + JPEG/PNG URIs (not GLB, not KTX2)
- Two mesh primitives (opaque + blend). No `extensions` / `KHR_draco_mesh_compression` / meshopt
- Root node `matrix` translation ≈ `(839003.94, 7.15, -816901.44)` — HK1980-metre easting / height / **−northing**, with a Y-up axis swap in the 3×3

`GLTF0` for the same sheet: ZIP magic `PK` and first name `BUILDING/` — same top-level scheme; **full CD not listed** (only 256-byte peek).

**FBX folder layout: not unzipped.** Size only.

**SITE** feature: CSDI [What’s New](https://portal.csdi.gov.hk/csdi-webpage/info/WhatsNew) — DAE, KML, and Site removed from the portal on **2026-01-02**. No `SITE/` folder in this ZIP. **WATERBODY** also absent from this sheet (may be empty, not a global rule).

---

## 4. CORS — browser vs proxy

| Probe (Origin `http://localhost:4200`) | Result |
|---|---|
| OPTIONS / GET / HEAD `data11.map.gov.hk/api/3d-zip/…` | `Access-Control-Allow-Origin: http://localhost:4200` |
| GET `download.map.gov.hk/api/3d-zip/…` | same ZIP, CORS reflect |
| GET sheet index GeoJSON on `3d.map.gov.hk` | also reflects Origin |
| Previous spike note | fetch of gov.hk pages timed out / assumed blocked |

**A browser `fetch(..., { credentials: 'omit' })` can read the ZIP today.** `Allow-Credentials: true` + reflected origin is a valid CORS pair.

Still use a same-origin proxy in production:

- CORS policy can change without notice
- avoid depending on a reflected-Origin + credentials combo
- repo already has `proxy.conf.js` → `https://download.map.gov.hk` with rewrite `/streetscape-open3dhk` → `/api/3d-zip`

Proxy is **not** required to *see* the bytes in Chrome today; it **is** required if we want to subset/transcode without shipping 0.7–1.8 GiB to the tab.

---

## 5. ToS / key / captcha / cookies

### Terms (must cite if we redistribute)

Download API page (i18n `downloadAPI.disclaimer`, shown before the URL builder):

- Do **not** invoke the API with a large number of requests in a short period
- Map APIs subject to LandsD Map API terms + IP notice
- Applications must include the **Lands Department logo** on the map face and a copyright notice
- Copyright bullets: Map / Aerial Photograph from LandsD; Earth Image NASA; Satellite USGS/NASA Landsat
- Standard “as is” disclaimer

Open3Dhk `aboutPopup.useOfData` (same SPA; also on CSDI API terms pages):

- Browse, download, distribute, reproduce, hyperlink, print — **commercial and non-commercial, free**
- Must comply with Terms of Use
- Must **clearly identify the Government and this website as the source** and acknowledge IP ownership
- Indemnify Government against third-party claims

UI checkbox `isAgreed` only **unhides** the URL builder in the SPA. It is **not** sent to the ZIP host (curl without cookies succeeded).

FAQ (same `app.js`): Download API fair-use **1 GB/s bandwidth and 1 000 concurrent users**. (The *streaming* 3D Visualisation Map API docs say 5 GB/s and 100 concurrent — different product.)

### Key

- Documented as `?key=[key]`; 401 = Access Denied
- UI / GeoJSON use prod key `ad5940a63bd344c48b0351ef1c7a905e` (`Global.apiKeysProd["2022Q4"]`, also `window.mapSetting.map.ta.key` in [setting.js](https://3d.map.gov.hk/mapviewer/files/setting.js))
- [CSDI tiles API](https://portal.csdi.gov.hk/csdi-webpage/apidoc/3d-visualisation-map-api) example key is a **different** public sample (`3967f8f365694e0798af3e7678509421`); those docs say email **3dmap@landsd.gov.hk** for a free key
- **2026-08-19:** ZIP GET succeeded with **no key** and with **`invalidkey`**. Treat keyless access as **unstable / possibly IP- or time-dependent**. Prefer the documented `key=` query (or let the official UI’s `appendKey` behaviour stand)

### Captcha / session

- No `recaptcha` / `hcaptcha` / `captcha` string in `app.js` or the Download API chunk
- Firebase in the SPA is analytics (`clickMetaDataDownloadTile`, etc.), not an auth gate
- No `Set-Cookie` required on `data11` / `download.map.gov.hk` for the ZIP

CKAN maintainer: Senior Land Surveyor/Data Intelligence1, `smocmut@landsd.gov.hk`.

---

## 6. Sheet geography (Nathan / TST vs `11-SE-2C`)

Point-in-polygon on the official WGS84 index GeoJSON (2026-08-19):

| Place (approx WGS84) | `TILE_NAME` |
|---|---|
| Nathan Rd × Salisbury (TST) 114.1722, 22.2976 | **`11-SW-4B`** |
| Jordan / Nathan | `11-NW-24D` |
| Yau Ma Tei / Nathan | `11-NW-19D` |
| Mong Kok / Nathan | `11-NW-19B` |
| Prince Edward / Nathan | `11-NW-14D` |
| `11-SE-2C` centroid 114.206, 22.293 | HK Island (Causeway Bay / Tin Hau belt) |

LandsD sample-map form [SMF-0178](https://www.landsd.gov.hk/doc/en/mapping/digital-map/common/doc/smf-0178.pdf) also lists `11-SE-2C` under **HK** (Hong Kong Island), not KLN.

Repo catalog `src/assets/streetscape/catalog.json` currently titles `11-SE-2C` as 彌敦道／尖沙咀 — **that label is wrong** relative to the official index.

---

## 7. Pack v1 conversion — in-browser vs minimum server step

Pack v1 needs: `manifest.json` + `floor.png` + **one primary file per feature** (`pack-schema.ts`). Caps: `maxFeatures = 8`, `maxEstimatedSyncMiB = 48`.

| Pack need | Official sheet ZIP | Feasible in-browser? |
|---|---|---|
| One mesh file per building | **Yes** — already `BUILDING/<id>/<id>.gltf` + `.bin` (+ JPEG/PNG if `GLTF`) | Yes, after unzip |
| Draco / KTX2 | **Not present** on `11-SE-2C` GLTF (FME 2.0 + JPEG/PNG). Our `GLTFLoader` has no DracoLoader | n/a for this sheet |
| `manifest.json` | **Absent** | Must synthesise (parse node `matrix` for HK1980 metres, localise translation) |
| `floor.png` | **Absent** as a 2D plan. `TERRAIN(TB)` is a 3D mesh + huge JPEG | Must synthesise (FloorComposer) or bake offline |
| Feature count | 158 buildings on `11-SE-2C` | Must **subset ≤ 8** |
| Download size | 684 MiB `GLTF` / 34 MiB `GLTF0` (`11-SE-2C`); 1.68 GiB / 58 MiB (`11-SW-4B`) | **`GLTF` whole sheet: no.** **`GLTF0`: maybe** (RAM ≈ compressed + inflated) |
| Units / axis | Metres, Y-up via matrix; world translation is HK1980 | Must zero translation before bake (AABB would be huge) |

**Verdict:** converting an *official Individualised ZIP* into Pack v1 **entirely in-browser** is only plausible for **`GLTF0`**, and still means: download 35–60 MiB, unzip all members, parse every building glTF, pick 8, rewrite matrices, compose a fake floor. That is what `open3dhk-sheet-pack.ts` aims at — it is **not** “the ZIP is already a Pack”.

**Minimum server-side step** (if we want textured TST, or to stay under caps without unzipping 158 buildings on the client):

1. GET the official ZIP (or stream it)
2. Select ≤8 `BUILDING/*` (and skip terrain/vegetation unless wanted)
3. Localise glTF matrices; optionally downscale JPEG
4. Write `manifest.json` + `floor.png` (ortho of terrain or a 2D basemap screenshot)
5. Return a Pack ZIP / folder on the same origin

Proxy-only (byte-for-byte ZIP) does **not** produce a Pack. `open3dhkSource` today fetches `GLTF0` then parcelizes in the tab.

---

## 8. What could not be verified

- **Information Sheet PDF** for Individualised models (CSDI What’s New points at it; no public URL found; LandsD [3d_mf_eng.pdf](https://www.landsd.gov.hk/doc/en/mapping/digital-map/common/feature/3d_mf_eng.pdf) is **3D-BIT00**, a different product)
- **FBX / MAX / CESIUM / OBJ / OSGB** ZIP internals (sizes only for FBX/`11-SE-2C`)
- Full **`GLTF0` file list** (only `BUILDING/` prefix confirmed)
- Whether **`key` / 401** is enforced for some clients, regions, or future policy
- Draco/KTX2 on **other sheets** (only `11-SE-2C` GLTF sampled)
- `geodata.gov.hk` terms HTML (DNS failed from this environment); Open3Dhk embeds a link to `https://geodata.gov.hk/gs/?p=terms_and_conditions`
- Exact HK1980 EPSG tag inside the glTF (coordinates match HK1980 Grid metres; no `asset.extras` CRS in the sample)

---

## 9. Catalog DEMO — working URL vs blockers

**(a) Working request (verified 200 ZIP):**

```text
https://download.map.gov.hk/api/3d-zip/GLTF0/11-SE-2C.zip
https://download.map.gov.hk/api/3d-zip/GLTF/11-SE-2C.zip
```

Same-origin: `/streetscape-open3dhk/GLTF0/11-SE-2C.zip` → `https://download.map.gov.hk/api/3d-zip/GLTF0/11-SE-2C.zip` ([`proxy.conf.js`](../../proxy.conf.js)).

**(b) Blockers for “catalog DEMO immediately live-downloads official sheet” as a playable Pack:**

1. **`11-SE-2C` ≠ Nathan Road / TST** — official index puts TST at **`11-SW-4B`** (~1.68 GiB textured, ~58 MiB `GLTF0`).
2. Official ZIP is **not** Pack v1 (`manifest.json` / `floor.png` missing). Runtime must parcelize; textured 684 MiB+ unzip is a tab-killer.
3. **158 buildings vs cap 8** — DEMO will never show the whole sheet.
4. **ToS:** attribution + LandsD logo on the map face; do not hammer the endpoint.
5. Index **`GLTF_SIZE_MB` is not the ZIP size** — a progress UI that trusts the CSV will lie.
6. CORS currently allows direct browser GET; **do not treat that as a contract**. Proxy is already the fallback.
