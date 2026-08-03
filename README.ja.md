# Udonarium（烏冬）@ HKTRPG

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

---

[ユドナリウム（Udonarium）](https://github.com/TK11235/udonarium) は、Web ブラウザで動作するボードゲーム／TRPG オンラインセッション支援ツールです。

本プロジェクトは [Udonarium with Fly](https://github.com/NanasuNANA/UdonariumWithFly) をベースにした [HKTRPG](https://www.hktrpg.com/) 改造版です。多言語 UI（既定は繁体字中国語）に加え、照明・戦闘トラッカー・キーボード操作などの VTT 向け機能を追加。With Fly の高度・立ち絵（スタンド）・Cut-in・チャット文字色なども引き継いでいます。

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/TK11235/udonarium/blob/master/LICENSE)

## いますぐ試す

- **本サイト（烏冬 @ HKTRPG）**：https://z01.hktrpg.com/
- 本家デモ：https://udonarium.app/
- With Fly デモ：https://nanasunana.github.io/

推奨ブラウザ：デスクトップ版 Google Chrome（HTTPS 必須）。

## 機能

- **オンラインセッション**
  - ルーム、複数テーブル管理
  - テーブルマスク、立体地形
  - コマ、カード、共有メモ
  - チャット送受信、チャットパレット
  - ダイスボット（[BCDice](https://github.com/bcdice/bcdice-js)）
  - 画像共有、BGM、ZIP セーブ

- **ブラウザ間通信**
  - WebRTC（[SkyWay](https://skyway.ntt.com/)）で接続；接続後の処理はできるだけブラウザ側で完結

- **軽量＆リアルタイム**
  - 操作を他参加者へリアルタイム同期

## 本プロジェクトの追加（With Fly／本家との差分）

| 機能 | 説明 |
|------|------|
| 多言語 UI | 実行時に 繁中／简中／English／日本語 を切替（メニュー；保存される） |
| HKTRPG ブランディング | タイトル、favicon、OG、ランディング |
| ロール別ルーム | GM／User／Guest ごとに開放／パスワード／無効 |
| ロール招待リンク | 各ロールのディープリンクをコピー；必要ならパスワード入力 |
| ゲストモード | ゲスト UI 制限（保存不可・メニュー制限）；旧「ゲスト許可」も対応 |
| 簡易モード（ClarifyMode） | チャットツールバーの簡易表示切替 |
| ノート倉庫 | 卓／共有／プライベート／ゴミ箱でメモ整理 |
| クイックロール | キャラクターシート欄をワンクリックでチャットへ送り BCDice で解決 |
| キーボードでコマ操作 | 選択後 WASD／矢印移動；Shift+WASD 向き；Delete；Ctrl+C/X/V；`[`/`]` レイヤ；Ctrl(+Shift)+ホイール回転；Shift ドロップで吸着なし |
| パス移動 | Shift+左クリックでウェイポイント → Shift+右クリックで沿って移動 |
| 選択 UX | クリック／範囲選択、ダブルクリック詳細、選択ハイライト |
| Ping | マップ長押しでマーカー；Shift+長押しで警告 |
| 卓の照明と視界 | 暗闇／FoW、ライト、壁、視界距離；視界キャラを申告可能 |
| シーンツール | GM のライト／壁／描画／文字；プレイヤーへのツール権限も設定可 |
| 戦闘トラッカー | イニシアチブ、ラウンド／ターン、告知、ターン終了、撃破スキップ |
| プレイヤートークン申告 | 「自分のキャラ」：既定の発言者・視界、他者は移動不可 |
| 天候 | 雨／雪／桜／紅葉／オーロラなど（テーブル設定） |
| 画像 FX | グレースケール、セピア、コントラスト、反転、シルエット、Matrix…（コマ／スタンド／チャットアイコン／シート） |
| ステータス／オーラ／リング／死亡 | 状態アイコン、オーラ、リング FX；死亡は戦闘の撃破と同期 |
| 再読込時の保存確認 | F5／Ctrl+R で ZIP ダウンロードを提案（ゲストはスキップ） |

With Fly から継承：高度、チャット文字色、立ち絵（スタンド）、Cut-in、ダイスボット表、SkyWay 2023（`@skyway-sdk`）など。本 fork は自前 backend を使用（公開 WithFly Workers には向けないこと）。

機能チェックリスト：[`docs/hktrpg-feature-inventory.md`](docs/hktrpg-feature-inventory.md)

## ローカル開発

Node.js、npm、および自前の [udonarium-backend](https://github.com/TK11235/udonarium-backend)（SkyWay Auth Token）が必要です。  
ローカル／HKTRPG サイトを WithFly 公開 Workers に向けないでください（許可 Origin は `nanasunana.github.io` のみ）。

詳細：

- [`docs/hktrpg-backend.md`](docs/hktrpg-backend.md) — ローカル backend、CORS、proxy
- [`docs/hktrpg-deploy.md`](docs/hktrpg-deploy.md) — 本番 Workers＋フロント
- [`docs/hktrpg-sync.md`](docs/hktrpg-sync.md) — upstream WithFly の同期

```bash
npm i
# src/assets/config.yaml（gitignored）を編集し backend.url を設定
# 推奨：Angular proxy → ローカル :8787、proxy.conf.js 参照
npx ng serve --ssl --host 127.0.0.1 --port 4200 --proxy-config proxy.conf.js
```

本番ビルド：

```bash
ng build
```

成果物は `dist/`。デプロイ前に `backend.url` を Workers URL にし、`ACCESS_CONTROL_ALLOW_ORIGIN` をサイト Origin（例：`https://z01.hktrpg.com`）に合わせてください。

### BCDice-API（任意）

`config.yaml` で `dice.url` を設定すると BCDice-API を利用できます。デフォルト API バージョンは 2（成功／失敗の着色には v2 が必要）。

```yaml
backend:
  mode: skyway2023
  url: https://{your-backend-hostname}/
dice:
  url: # BCDice-API エンドポイント
  api: 2
```

## 上流プロジェクト

1. [TK11235/udonarium](https://github.com/TK11235/udonarium) — Udonarium 本家  
2. [NanasuNANA/UdonariumWithFly](https://github.com/NanasuNANA/UdonariumWithFly) — With Fly（高度・立ち絵・Cut-in など）

本家の開発・貢献は上流 README を参照。Issue／PR は対応する上流、または本 fork（HKTRPG 関連）へ。

HKTRPG Bot（チャット側ダイス・キャラクターシートなど）は [HKTRPG ガイド](https://bothelp.hktrpg.com/guide) を参照。

## License

[MIT License](https://github.com/TK11235/udonarium/blob/master/LICENSE)

Udonarium、Udonarium with Fly、および第三者素材（画像／音声）のライセンスとクレジットは、各オリジナルプロジェクトおよび `src/assets/**/copyright.txt`、`license.txt` に従ってください。
