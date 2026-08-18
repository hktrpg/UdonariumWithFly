# Open3Dhk → 2.5D 街景（研究筆記）

Date gathered: 2026-08-18 · Revised: 2026-08-18（review 修正）.  
Scope: **研究／設計 only**（本輪不實作）。  
產品目標（遠景）：GM 選街道 → 載入周邊 → 製成 2.5D 街景。  
硬約束：只用現成 `GameTable` + `Terrain` bake；嚴格 CSS 2.5D；不引入常駐城市引擎。

相關：[微縮城市搭景](../hktrpg-tutorial.zh-TW.md#miniature-city)、[devlog](../devlog.md)。

---

## Executive summary

原料走 **Open3Dhk Individualised GLTF／FBX** → 現有 `photoGltfFaces`／`importModelAsTerrain` → Terrain 盒；底圖寫入 `GameTable.imageIdentifier`。**禁用** Cesium 3D Tiles 當桌面內容。

**MVP 不是真・即時 1B。** 先驗證「街景包 → bake → 可玩地圖」；選街／Download API 是同一契約上的後續 Provider。

| 層 | MVP | 遠景 1B |
|---|---|---|
| 資料 | 預製 **Streetscape Pack**（versioned manifest） | `Open3Dhk`／圖幅 Download Provider |
| 選取 | 靜態街段清單（或拖入 pack） | 街道名／點選／半徑 |
| 核心 | 同一個極薄 **Orchestrator** | 不變 |

**硬閘門：** Phase 0 Spike 未過，不開 orchestrator／UI。

---

## 1. 硬約束

| 約束 | 含義 |
|---|---|
| 只用現成地型 | 只產出 `GameTable` + `Terrain`（可斜坡／霓虹／分面）。禁止常駐 glTF／Cesium／Three scene。 |
| 嚴格 2.5D | CSS `perspective`；Three 僅短暫 bake。 |
| P2P 容量 | 圖片進 `ImageStorage`；必須有棟數／解析度／預估 MB 上限。 |
| 最小表面積 | 新碼只加「資料適配 + 編排」；不複製 bake／不新渲染器。 |

---

## 2. 既有 3D 匯入（必須重用，不叉開）

### 2.1 管線

```mermaid
flowchart LR
  drop[Drop_or_fetch_File] --> expand[expandModelDropFiles]
  expand --> import[importModelAsTerrain]
  import --> photo[photoGltfFaces]
  photo --> imgs[ImageStorage_addAsync]
  imgs --> terr[Terrain_plus_bakeCropJson]
  terr --> place[placeTerrainAt]
```

- 拖放：`tabletop-file-drop.service.ts` → `terrainBake`
- 多檔原型：`dev-3dmodel-seed.ts`（迴圈 import；街景編排應長得像它，不是像城市引擎）
- 核心：`importModelAsTerrain`（已有 `mmPerGrid`；**仍會**走 `fitModelGridSize` 2–40）

### 2.2 街景必須補的缺口

| 缺口 | 影響 | 最小修法 |
|---|---|---|
| 一次一場景 | 圖幅 ZIP 不會拆棟 | Pack／Provider 保證 **一棟一 primary** |
| auto-fit 2–40 | 相對距離錯亂 | 街景路徑 **關閉 fit**，世界座標線性放置 |
| 單位當 mm | 米制模型縮放錯 | Pack 宣告 `metersPerUnit`；編排換算 `mmPerGrid` |
| 無 Draco／KTX2 | 部分官方包載不入 | Spike 判定；必要時 **離線轉檔進 Pack**（不塞進瀏覽器 loader） |
| 同步體積 | 16 棟×6×2 MiB 不可接受 | MVP 預設 **≤8 棟、bake ≤512、可略 underside** |
| Footprint≤3 盒 | ≠ 拆樓 | 不拿 footprint-split 當拆棟；拆棟在 Pack 建置時完成 |

---

## 3. 資料策略（鎖定）

### 3.1 用什麼／不用什麼

| 資料 | 決策 |
|---|---|
| Individualised GLTF／FBX | **採用**（經 Pack 或後續 Provider） |
| 3D Tiles／tile mesh | **不用**（桌面內容） |
| Streetscape 360 | 非幾何；可選 Cut-in，非 MVP |
| Infrastructure（天橋等） | **Pack schema 預留 `kind`**；MVP 可 0 筆，不另開管線 |

### 3.2 底圖（鎖定 MVP）

不做真·政府正射對位（授權／對齊成本高）。

**MVP floor：** 由編排器合成簡易俯視——路面色塊 + 各棟 footprint／頂視縮圖貼上。來源是 bake 過程的頂視（或 pack 內可選 `floor.jpg`）。遠景可換成正射 Provider，**Orchestrator 只吃 `Blob`／image id**。

### 3.3 「選街」真實單位

官方下載多是 **1:1000 圖幅**，沒有「街道 → glTF」端點。選街 = UX；真正契約是 **Pack 或 bbox→圖幅→拆棟**。Live Download／CORS／ToS **未端到端驗證**——屬 Phase 5，不擋 MVP。

---

## 4. 架構：最小核心 + 可替換邊界

原則：**一個編排器、一個放置模型、一個 Pack 契約；資料來源可插拔。** 不預建 `sheet-index`／`fetch-pack`／`parcelize` 六個空模組。

```mermaid
flowchart TB
  ui[UI_thin] --> orch[StreetscapeOrchestrator]
  orch --> src[StreetscapeSource]
  src --> packA[PackSource_MVP]
  src --> packB[Open3DhkSource_later]
  orch --> place[WorldPlacement]
  orch --> bake[importModelAsTerrain_reuse]
  orch --> floor[FloorComposer]
  bake --> table[GameTable_plus_Terrains]
  floor --> table
```

### 4.1 模組（未來實作時只這四塊）

| 模組 | 職責 | 不做 |
|---|---|---|
| **`StreetscapeSource`** | `resolve(query) → StreetscapePack`（async） | bake、DOM、SyncObject |
| **`WorldPlacement`** | 公尺／pack 座標 → 桌面 px／grid；**禁用 auto-fit** | 載檔 |
| **`FloorComposer`** | `Pack + 可選頂視 → floor Blob` | 3D |
| **`StreetscapeOrchestrator`** | 建表 → 取 pack → 迴圈 bake → 掛子物件 → local View | 自家 WebGL |

可選極薄 UI：建圖旁「從街景包…」／之後「選街段…」。掛在 `game-table-setting`；先 View 再 Activate。

### 4.2 Pack 契約（擴充點＝JSON，不是新框架）

```ts
/** Streetscape Pack v1 — 唯一跨 Phase 穩定介面 */
type StreetscapePackV1 = {
  version: 1;
  id: string;
  title: string;
  attribution: string;           // LandsD / Open3Dhk
  /** Pack 座標：公尺，Y-up 或宣告 axis */
  metersPerUnit: number;         // glTF 單位 → 公尺
  origin: { x: number; z: number }; // pack 平面原點
  extentMeters: { width: number; depth: number };
  floor?: { path: string };      // 可選；無則 FloorComposer 合成
  features: StreetscapeFeatureV1[];
  limits?: { maxFeatures?: number };
};

type StreetscapeFeatureV1 = {
  id: string;
  kind: 'building' | 'infrastructure' | 'prop';
  path: string;                  // 相對 pack 的 glb/gltf/fbx/zip
  /** 特徵原點在 pack 平面上的公尺位移 */
  positionMeters: { x: number; z: number };
  yawDeg?: number;
  /** 可選；無則 bake 後量 AABB */
  sizeMeters?: { w: number; d: number; h: number };
};
```

- **MVP Source：** 讀 zip／資料夾 + `manifest.json` → `StreetscapePackV1`。  
- **遠景 Source：** 選街 → 下載圖幅 → **建置期或服務端**拆棟 → **仍輸出同一 Pack**（瀏覽器不解析圖幅百科全書）。  
- 擴充：加 `kind`、加 Source 實作；**不改 Orchestrator 主流程**。

### 4.3 對現有 API 的最小侵襲

| 變更 | 理由 |
|---|---|
| `ImportModelAsTerrainOptions` 加 `fitGrid?: boolean`（預設 `true` 保舊行為） | 街景關 fit；單棟拖放不變 |
| 或街景只呼叫內部 bake＋自管 `placeTerrainAt` | 若不想動 fit，Orchestrator 自算 width／height 後繞過 fit——擇一，**禁止兩套都做** |
| **不**加 DracoLoader 到主路徑，除非 Spike 證明官方 GLB 全靠 Draco | 轉檔進 Pack 更可控 |

放置：`positionMeters` × 比例尺 → table px；與 `dev-3dmodel-seed` 的「排版游標」不同——街景用 **地理相對位置**，不是一字形擺放。

### 4.4 容量護欄（MVP 預設）

| 項 | 預設 |
|---|---|
| 特徵數 | ≤ **8**（超出按距中心裁切） |
| Bake 長邊 | **512**（可降 256） |
| 面 | 可略 `underside` |
| 桌面 | ≤ 100×100 grid；floor ≤ 2048px／2 MiB |
| 併發 | 一房間一次生成 |
| UI | 開始前顯示 **預估同步 MB** |

---

## 5. UX（遠景與 MVP）

**MVP：**「匯入街景包」或「選預製街段」→ 新 `GameTable`（不 Activate）→ 進度 → `viewTableLocal`。

**遠景 1B：** 同一入口升級為選街道／半徑；Source 換成即時／半即時，**UX 殼可共用**。

掛點優先：`game-table-setting`「建立新地圖」旁 → `scene-nav` 次之。勿掛 scene preset。

---

## 6. Phase（硬順序）

```mermaid
flowchart LR
  p0[P0_Spike] --> p1[P1_Placement]
  p1 --> p2[P2_Pack_MVP]
  p2 --> p3[P3_Guards_UX]
  p3 --> p4[P4_Static_street_picker]
  p4 --> p5[P5_Live_Open3Dhk]
```

| Phase | 產出 | 通過條件 | 不做 |
|---|---|---|---|
| **0 Spike** | 真實圖幅樣品 + 筆記 | 3～5 棟可進現有拖放 bake；單位／壓縮／單棟 MB 已知；拆棟步驟可手做記錄 | 任何正式模組 |
| **1 Placement** | `fitGrid: false`（或等價）+ 公尺→px | 兩棟相對距離大致正確 | UI／下載 |
| **2 Pack MVP** | Pack v1 + Orchestrator + FloorComposer | 拖入／載入一包 → 可玩 2.5D 地圖 | 選街、官方 API |
| **3 Guards／UX** | 上限、進度、失敗跳過、預估 MB、署名 | 壞檔不整表炸掉 | Live |
| **4 靜態選街** | 少數預製街段目錄（仍是 Pack） | GM「選街」體感，資料仍本地／CDN Pack | Download API |
| **5 Live 1B** | `Open3DhkSource` + proxy／ToS | CORS、圖幅、拆棟服務驗證後 | 改核心編排 |

P0 失敗（例如全數 Draco、單位混亂）：改為 **離線建置 Pack 的工具鏈**，瀏覽器只吃 P2——架構仍成立。

---

## 7. 結論

| 問題 | 答案 |
|---|---|
| 能烘成底圖／背景／建築地型？ | 能：floor Blob + 可選 background 圖 + Terrain bake。 |
| 嚴格 2.5D？ | 能：不掛 3D Tiles。 |
| 真・選街即時？ | 遠景；**MVP＝Pack + 可選靜態街段**。 |
| 現有匯入夠？ | 單棟夠；街景要 Pack 契約 + 關 fit 放置 + 薄 Orchestrator。 |
| 架構怎麼擴？ | **Source 可換、Pack schema 版本化**；核心四模組不膨脹。 |

---

## 8. 程式索引

| 主題 | 路徑 |
|---|---|
| 匯入 | `src/app/class/terrain-model/model-terrain-import.ts` |
| Photo bake | `src/app/class/terrain-model/photo-gltf-faces.ts` |
| 常數／fit | `src/app/class/terrain-model/mesh-ir.ts` |
| 多檔原型 | `src/app/service/default-room/dev-3dmodel-seed.ts` |
| 拖放 | `src/app/service/tabletop-file-drop.service.ts` |
| Terrain／地圖 | `src/app/class/terrain.ts`, `game-table.ts`, `table-selecter.ts` |
| 建圖 UI | `src/app/component/game-table-setting/` |

## 9. 外部參考

- https://3d.map.gov.hk/  
- https://www.landsd.gov.hk/en/survey-mapping/mapping/3d-mapping.html  
- data.gov.hk Individualised models／Download API（圖幅＋格式；**待 Spike／P5 實測**）  
- CSDI 3D Tiles API（需 key）— **非桌面路徑**  
- `3dmap@landsd.gov.hk`

## 10. 決策記錄

| 項 | 選擇 |
|---|---|
| 遠景 | 1B 選街自動製景 |
| 本輪 | 研究文件 only |
| 渲染 | 2.5D + 現成 Terrain |
| 主資料 | Individualised → Pack；不用 3D Tiles |
| MVP | Pack v1 + Orchestrator；非 Live API |
| 底圖 | 合成俯視／pack 內 floor；非正射 MVP |
| 擴充 | `StreetscapeSource` + versioned Pack；四模組上限 |
| 閘門 | P0 Spike 不過不往下做 |
