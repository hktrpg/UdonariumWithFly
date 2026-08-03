# Udonarium 烏冬 @ HKTRPG

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

---

[Udonarium（ユドナリウム）](https://github.com/TK11235/udonarium) 是在 Web 瀏覽器中運作的桌遊／TRPG 線上團務支援工具。

本專案是以 [Udonarium with Fly](https://github.com/NanasuNANA/UdonariumWithFly) 為基底的 [HKTRPG](https://www.hktrpg.com/) 改造版：介面為繁體中文，並保留 With Fly 的高度、立繪（Stand）、Cut-in、聊天文字顏色等擴充。

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/TK11235/udonarium/blob/master/LICENSE)

## 立即試用

- **本站（烏冬 @ HKTRPG）**：https://z01.hktrpg.com/
- 本家試用：https://udonarium.app/
- With Fly 試用：https://nanasunana.github.io/

推薦瀏覽器：桌面版 Google Chrome（需 HTTPS）。

## 功能

- **線上團務**
  - 房間、多桌面管理
  - 桌面遮罩、立體地形
  - 棋子、卡片、共用備忘
  - 聊天與指令板（Chat Palette）
  - 骰子機器人（[BCDice](https://github.com/bcdice/bcdice-js)）
  - 圖片共用、BGM、ZIP 存檔

- **瀏覽器間通訊**
  - 以 WebRTC（[SkyWay](https://skyway.ntt.com/)）連接；連線後處理盡量在瀏覽器完成

- **輕量即時**
  - 操作即時同步給其他參加者

## 本專案追加（相對於 With Fly／本家）

| 功能 | 說明 |
|------|------|
| 繁體中文介面 | 主要 UI／說明已本地化為 zh-Hant |
| 訪客模式 | 開房可「允許訪客」；訪客 UI 受限（無法存檔等）；有密碼的房間仍需密碼 |
| 精簡模式（ClarifyMode） | 聊天視窗可切換精簡顯示 |
| 筆記倉庫 | 依桌面／共用／私人／墳場整理備忘 |
| 快速擲骰 | 角色卡欄位可一鍵送到聊天給 BCDice 結算 |
| SkyWay 2023 | 使用最新 `@skyway-sdk` 與自架 backend |

繼承自 With Fly：高度、聊天文字顏色、立繪（Stand）、Cut-in、骰子機器人表等。

功能驗收清單：[`docs/hktrpg-feature-inventory.md`](docs/hktrpg-feature-inventory.md)

## 本機開發

需要 Node.js、npm，以及自架的 [udonarium-backend](https://github.com/TK11235/udonarium-backend)（SkyWay Auth Token）。  
**請勿**把本機／HKTRPG 站點指向 WithFly 公開 Workers（僅允許 `nanasunana.github.io` Origin）。

詳見：

- [`docs/hktrpg-backend.md`](docs/hktrpg-backend.md) — 本機 backend、CORS、proxy
- [`docs/hktrpg-deploy.md`](docs/hktrpg-deploy.md) — 正式環境 Workers＋前端
- [`docs/hktrpg-sync.md`](docs/hktrpg-sync.md) — 同步 upstream WithFly

```bash
npm i
# 編輯 src/assets/config.yaml（gitignored），設定 backend.url
# 建議：Angular proxy → 本機 :8787，見 proxy.conf.js
npx ng serve --ssl --host 127.0.0.1 --port 4200 --proxy-config proxy.conf.js
```

正式建置：

```bash
ng build
```

產物在 `dist/`。部署前請將 `backend.url` 設為你的 Workers URL，並讓 `ACCESS_CONTROL_ALLOW_ORIGIN` 等於站點 Origin（例如 `https://z01.hktrpg.com`）。

### BCDice-API（可選）

在 `config.yaml` 設定 `dice.url` 後可改走 BCDice-API；預設 API 版本為 2（成功／失敗著色需要 v2）。

```yaml
backend:
  mode: skyway2023
  url: https://{your-backend-hostname}/
dice:
  url: # BCDice-API 端點
  api: 2
```

## 上游專案

1. [TK11235/udonarium](https://github.com/TK11235/udonarium) — Udonarium 本家  
2. [NanasuNANA/UdonariumWithFly](https://github.com/NanasuNANA/UdonariumWithFly) — With Fly（高度、立繪、Cut-in 等）

本家開發與貢獻說明請見上游 README。Issue／PR 請開到對應上游或本 fork（HKTRPG 相關）。

聊天平台擲骰、角色卡等 HKTRPG Bot 功能請見：[HKTRPG 使用教學](https://bothelp.hktrpg.com/guide)。

## License

[MIT License](https://github.com/TK11235/udonarium/blob/master/LICENSE)

Udonarium、Udonarium with Fly 與第三方素材（圖片／音效）之授權與署名，請一併遵守各原始專案與 `src/assets/**/copyright.txt`、`license.txt`。
