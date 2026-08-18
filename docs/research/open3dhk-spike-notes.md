# P0 Spike — Open3Dhk Individualised models vs in-app bake

Date: 2026-08-18.

## What we could verify in this environment

- Official viewer: `https://3d.map.gov.hk/` (Open3Dhk).
- Individualised products are published as **GLTF / FBX / etc.** on CSDI / data.gov.hk, typically by **1:1000 map sheet**, not by street name.
- Streaming APIs (Cesium 3D Tiles) require a LandsD key (`3dmap@landsd.gov.hk`). **Out of scope for the tabletop.**
- Browser fetch of data.gov.hk / 3d.map.gov.hk download pages **timed out or is CORS-blocked** from this agent. Exact Download API query string was **not** confirmed end-to-end.

## Implications for bake

| Question | Finding |
|---|---|
| Can a few buildings enter the existing drop bake? | **Yes, if they are unpacked glTF/FBX/STL.** Sample ASCII STL boxes in `src/assets/streetscape/sample-nathan/` are the in-repo stand-in. |
| Units | Import still treats mesh units as **mm**. Pack `metersPerUnit` converts via `mmPerGrid = metersPerGrid / metersPerUnit`. |
| Draco / KTX2 | Loaders still have **no** Draco/meshopt/KTX2. Official compressed GLB must be **re-exported into the Pack** offline. |
| Parcelize | A whole sheet ZIP is **not** one drop. Split to one primary per feature **before** the browser. |
| Typical size | Unknown for official textured GLTF (likely tens–hundreds of MB per sheet). Caps keep ≤8 features. |

## Offline pack toolchain (P0 fallback)

If a raw sheet ZIP cannot load:

1. Download Individualised GLTF for one sheet from CSDI / Open3Dhk.  
2. Split / export **one building per .glb** (no Draco, or transcode).  
3. Write `manifest.json` (Pack v1) + `floor.png`.  
4. Zip or host as a folder; the client only eats Packs.

## Pass / fail

- **Pass for architecture:** sample pack + existing bake path is enough to implement P1–P5 against the Pack contract.  
- **Fail for live official sheets:** no verified Download API + no in-browser parcelize. P5 therefore **matches catalog first**, then same-origin proxy; unofficial sheet ZIPs return `STREETSCAPE_NOT_A_PACK`.
