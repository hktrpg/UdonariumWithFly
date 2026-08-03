# 烏冬桌 @ HKTRPG

線上 TRPG 桌面工具。以 [Udonarium with Fly](https://github.com/NanasuNANA/UdonariumWithFly) 為基底，對齊 [HKTRPG](https://www.hktrpg.com/) 品牌與常用流程。

玩家之間以瀏覽器即時同步地圖、棋子與聊天；**伺服器不長期保管桌面資料**。離開前請「下載 ZIP」，下次「讀取 ZIP」。

| | |
|---|---|
| 線上桌面 | https://z01.hktrpg.com/ |
| 使用教學 | https://bothelp.hktrpg.com/guide |
| HKTRPG 主站 | https://www.hktrpg.com/ |
| 推薦環境 | 桌面版 Chrome（需 HTTPS） |

介面支援繁中／簡中／英／日。進房後聊天頻道會顯示系統教學與升級說明。

---

## 能做什麼

繼承 With Fly（高度、立繪、Cut-in、聊天色、BCDice 等），並加上 HKTRPG 向功能：

| 分類 | 內容 |
|------|------|
| 房間 | 訪客模式（開房可允許訪客；功能受限、無法存檔；有密碼仍要密碼） |
| 聊天 | 精簡模式、工具列（音樂／效果音／提示音／靠左／列表）、**浮動式對話框**（「」內文顯示於 Token 上方） |
| 角色 | 快速擲骰、狀態圖示（含死亡，與戰鬥「倒下」雙向同步）、圖片效果（灰階／復古／剪影／翻轉／高對比／**Matrix 數位雨**）、底盤套圈 |
| 桌面操作 | 選取高亮、框選、WASD 移動、路徑移動、雙擊開詳情、快捷鍵調整層級與旋轉 |
| 場景 | Ping、黑暗／亮度／天氣、視野與擋光、場景工具（GM）、戰鬥輪 |
| 資料 | 筆記倉庫、ZIP 存檔／讀取、多語系 UI |

功能驗收清單：[`docs/hktrpg-feature-inventory.md`](docs/hktrpg-feature-inventory.md)

### 與 HKTRPG Bot 的關係

本專案是 **地圖／棋子／立繪** 用的線上桌面。聊天平台擲骰、角色卡、暗骰等請搭配 [HKTRPG Bot／網頁版](https://bothelp.hktrpg.com/guide)。  
指令速查、邀請 Bot、多平台差異等見官方文件；完整索引：[llms.txt](https://bothelp.hktrpg.com/guide/llms.txt)。

---

## 簡易操作（進房後系統教學有完整版）

- **視角**：Shift＋左鍵拖曳平移；右鍵拖曳旋轉；滾輪縮放  
- **物件**：左鍵移動；右鍵選單；雙擊開詳情  
- **選取**：點選／Ctrl 加減選／空白拖曳框選；Esc 取消  
- **浮動式對話框**：以角色發言時輸入預帶「」；「」內文立即出現在 Token 上方（右鍵可關）  
- **存檔**：離開前下載 ZIP；下次讀取 ZIP  

---

## 升級紀錄

### 2026 — 重大更新（hktrpg-main）

- 改以最新 With Fly 為基底（Angular 20、SkyWay 2023）
- 介面多語系（繁／簡／英／日）；品牌與說明對齊 HKTRPG
- 訪客模式、聊天精簡、筆記倉庫、角色卡快速擲骰、BCDice 4.9.0

### 2026/08/03 — 操作・場景・戰鬥・視野

- 選取高亮、框選；Shift＋左鍵平移地圖；雙擊開詳情
- 鍵盤 WASD／面向／複製貼上／前後層／滾輪旋轉；路徑移動
- Ping；地圖黑暗／亮度／天氣；視野與擋光；場景工具（GM）
- 戰鬥輪（先攻、回合宣告）；狀態圖示與底盤套圈

### 2026/08/03 — 角色效果・浮動式對話框

- 浮動式對話框：右鍵／倉庫可開關；「」內文顯示於 Token 上方；角色發言預帶「」
- 圖片效果：灰階／復古／高對比／剪影／翻轉；Matrix 數位雨（數字・字母上下流動）
- 狀態「死亡」與戰鬥「倒下」雙向同步；狀態 tip 改為名稱＋等級
- 角色右鍵選單重整、位置微調；雙擊 Token 立繪開詳情
- 戰鬥「加入桌面全部」訪客以外皆可用；Token 恆擋光（遮罩／地形仍可關「與燈光互動」）

進房後聊天「連結」訊息會顯示與上述對應的完整升級 LOG。

---

## 本機開發

需要 Node.js、npm，以及自架 [udonarium-backend](https://github.com/TK11235/udonarium-backend)（SkyWay Auth Token）。  
**請勿**將本機／HKTRPG 站點指向 WithFly 公開 Workers（僅允許 `nanasunana.github.io` Origin）。

| 文件 | 說明 |
|------|------|
| [`docs/hktrpg-backend.md`](docs/hktrpg-backend.md) | 本機 backend、CORS、proxy |
| [`docs/hktrpg-deploy.md`](docs/hktrpg-deploy.md) | 正式環境 Workers＋前端 |
| [`docs/hktrpg-sync.md`](docs/hktrpg-sync.md) | 同步 upstream WithFly |

```bash
npm i
# 編輯 src/assets/config.yaml（gitignored），設定 backend.url
# 建議：Angular proxy → 本機 :8787，見 proxy.conf.js
npx ng serve --ssl --host 127.0.0.1 --port 4200 --proxy-config proxy.conf.js
```

```bash
ng build   # 產物在 dist/
```

部署前將 `backend.url` 設為你的 Workers URL，並讓 `ACCESS_CONTROL_ALLOW_ORIGIN` 等於站點 Origin（例如 `https://z01.hktrpg.com`）。

### BCDice-API（可選）

```yaml
backend:
  mode: skyway2023
  url: https://{your-backend-hostname}/
dice:
  url: # BCDice-API 端點
  api: 2   # 成功／失敗著色需要 v2
```

---

## 上游專案

1. [TK11235/udonarium](https://github.com/TK11235/udonarium) — 本家（試用：https://udonarium.app/）  
2. [NanasuNANA/UdonariumWithFly](https://github.com/NanasuNANA/UdonariumWithFly) — With Fly（試用：https://nanasunana.github.io/）  

本家重點：房間與多桌面、遮罩／地形／棋子／卡片、聊天與 BCDice、圖片與 BGM、ZIP 存檔；連線後以 WebRTC（SkyWay）在瀏覽器間同步。

HKTRPG 相關 Issue／PR 請開本 fork；上游問題請開對應專案。

---

## License

[MIT License](https://github.com/TK11235/udonarium/blob/master/LICENSE)

Udonarium、Udonarium with Fly 與第三方素材之授權與署名，請遵守各原始專案及 `src/assets/**/copyright.txt`、`license.txt`。
