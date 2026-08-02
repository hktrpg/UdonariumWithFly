# Udonarium 烏冬 @ HKTRPG

以 [Udonarium with Fly](https://github.com/NanasuNANA/UdonariumWithFly) 為基底的 [HKTRPG](https://www.hktrpg.com/) 改造版：線上桌面團務工具，介面為繁體中文，並整合 HKTRPG 生態常用功能。

- **線上桌面**：https://z01.hktrpg.com/
- **HKTRPG 官方使用教學**：https://bothelp.hktrpg.com/guide
- **HKTRPG 主站**：https://www.hktrpg.com/

推薦瀏覽器：桌面版 Google Chrome（需 HTTPS）。

---

## 關於 HKTRPG

[HKTRPG](https://bothelp.hktrpg.com/guide) 是用於 TRPG 的網上工具，可在網站、Discord、Line、Telegram、Plurk、WhatsApp 等平台以統一指令擲骰，也可用於日常娛樂與群組管理。原生正體中文，最初為 CoC 開發，現已獨立支援十數種 TRPG 系統。

本專案是 HKTRPG 生態中的 **線上桌面（烏冬）**，適合需要地圖、棋子、立繪、共用備忘的視覺團務；聊天平台擲骰與角色卡等仍請搭配 HKTRPG Bot／網頁版使用。

### 5 分鐘上手（HKTRPG Bot）

詳見官方教學：[歡迎來到 HKTRPG](https://bothelp.hktrpg.com/guide)

1. [邀請 HKTRPG](https://bothelp.hktrpg.com/guide/kai-shi-shi-yong/yao-qing-hktrpg) 到你的平台
2. （可選）語言：`.lang zh-tw`／`.lang zh-hans`／`.lang en` — [語言設定](https://bothelp.hktrpg.com/guide/kai-shi-shi-yong/yu-yan-she-ding-duo-yu-xi)
3. 輸入 `1d100` 試試基本擲骰
4. 輸入 `bothelp` 查看指令分類，或看 [指令速查表](https://bothelp.hktrpg.com/guide/kai-shi-shi-yong/zhi-ling-su-cha-biao)
5. 建立 [角色卡](https://bothelp.hktrpg.com/guide/trpg-gong-neng/kai-shi-jin-hang-trpg/jiao-se-ka)：`.char add …`／`.char use 名字`
6. 需要隱藏結果時用 [暗骰](https://bothelp.hktrpg.com/guide/trpg-gong-neng/kai-shi-jin-hang-trpg/an-tou)：`dr`／`ddr`／`dddr`

### 依 bothelp 四大區塊

| bothelp | 說明 | 文件 |
|---------|------|------|
| `bothelp Base` | 基本擲骰、暗骰、角色卡等 | [開始進行 TRPG](https://bothelp.hktrpg.com/guide/trpg-gong-neng/kai-shi-jin-hang-trpg) |
| `bothelp Dice` | 各 TRPG 系統骰組 | [指定 TRPG 系統](https://bothelp.hktrpg.com/guide/trpg-gong-neng/zhi-ding-trpg-xi-tong) |
| `bothelp Tool`／`admin` | 系統工具與管理 | [功能開關](https://bothelp.hktrpg.com/guide/xi-tong-gong-ju/gong-neng-kai-guan) |
| `bothelp funny` | 娛樂與日常功能 | [趣味擲骰](https://bothelp.hktrpg.com/guide/yu-le-gong-neng/qu-wei-zhi-tou) |

其他常用連結：

- [網頁版聊天室](https://bothelp.hktrpg.com/guide/kai-shi-shi-yong/yao-qing-hktrpg/wang-ye-ban)
- [平台差異表](https://bothelp.hktrpg.com/guide/qi-ta-qing-bao/ping-tai-cha-yi-biao)
- [開發支援／Patreon](https://www.patreon.com/HKTRPG)
- [私人／公開角色卡](https://www.hktrpg.com:20721/card/)

完整索引：[llms.txt](https://bothelp.hktrpg.com/guide/llms.txt)

---

## 本專案特色（烏冬 @ HKTRPG）

繼承 With Fly 功能（高度、聊天文字顏色、立繪、Cut-in、骰子機器人表等），並加上：

| 功能 | 說明 |
|------|------|
| 繁體中文介面 | 主要 UI／說明已本地化為 zh-Hant |
| 訪客模式 | 開房可「允許訪客」；訪客 UI 受限（無法存檔等）；有密碼的房間仍需密碼 |
| 精簡模式（ClarifyMode） | 聊天視窗可切換精簡顯示 |
| 筆記倉庫 | 依桌面／共用／私人／墳場整理備忘 |
| 快速擲骰 | 角色卡欄位可一鍵送到聊天給 BCDice 結算 |
| SkyWay 2023 | 使用最新 `@skyway-sdk` 與自架 backend |

功能驗收清單：[`docs/hktrpg-feature-inventory.md`](docs/hktrpg-feature-inventory.md)

---

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

---

## 上游專案

本專案基於：

1. [TK11235/udonarium](https://github.com/TK11235/udonarium) — Udonarium 本家  
2. [NanasuNANA/UdonariumWithFly](https://github.com/NanasuNANA/UdonariumWithFly) — With Fly 改造（高度、立繪、Cut-in 等）

本家試用：https://udonarium.app/  
With Fly 試用：https://nanasunana.github.io/

### Udonarium 本家功能摘要

- **線上團務**：房間、多桌面、遮罩／地形、棋子／卡片／備忘、聊天與指令板、BCDice、圖片共用、BGM、ZIP 存檔  
- **瀏覽器間通訊**：WebRTC（SkyWay）；連線後處理盡量在瀏覽器完成  
- **輕量即時**：操作即時同步給其他參加者  

本家開發與貢獻說明請見上游 README；Issue／PR 請開到對應上游或本 fork（HKTRPG 相關）。

---

## License

[MIT License](https://github.com/TK11235/udonarium/blob/master/LICENSE)

Udonarium、Udonarium with Fly 與第三方素材（圖片／音效）之授權與署名，請一併遵守各原始專案與 `src/assets/**/copyright.txt`、`license.txt`。
