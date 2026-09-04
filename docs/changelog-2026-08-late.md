# Udonarium @ HKTRPG — 2026/08/22–23 更新

## 連線・mesh・PWA

- 弱網／LTE 上減少 mesh 重連風暴；局中斷線會持續 remesh 重試。
- 大廳入房失敗時保持房間在線，可重試；Connecting／Offline 狀態較準確。
- 致命斷線後排程自動重開房；SkyWay 訊號雜訊降噪、publication 競態後重新發布。
- 房間密碼重設不會重複 SkyWay 成員；relay／subscribe 在弱網較易存活。
- PWA：ngsw 雜湊與 HKTRPG 建置對齊；SW 安裝失敗也顯示更新圖示；連線面板捲動不再跳位。

## 檔案同步・筆記倉庫

- 連線面板 **FILES** 進度：入房至檔案齊全前保持 0→100%，不再 idle 閃爍。
- 檔案傳輸排程：多類型並行；**圖片優先**，其次**正在播放的 BGM**，同層再按大小。
- 綁定資料夾備份時，入房先從 `media/` hydrate，不阻塞 peer 下載；逾時 slot 自動釋放。
- 筆記倉庫對齊角色倉庫：五分頁（桌面／共用／個人／其他地圖／墳場）、拖放到地圖／分頁。
- 再點已選筆記可收合；刪除進墳場；PDF 等可拖到分頁。
- 紅繩（線索連結）拖曳連線物件時即時更新；預設劇本文字不再重複載入。

站內聊天「更新日誌」卡片、[`hktrpg-tutorial.zh-TW.md`](hktrpg-tutorial.zh-TW.md#recent-updates)、[`changelog-2026-08-late.html`](changelog-2026-08-late.html) 同步收錄。
