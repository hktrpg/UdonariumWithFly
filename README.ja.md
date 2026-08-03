# Udonarium（烏冬）@ HKTRPG

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

---

[ユドナリウム（Udonarium）](https://github.com/TK11235/udonarium) は、Web ブラウザで動作するボードゲーム／TRPG オンラインセッション支援ツールです。

本プロジェクトは [Udonarium with Fly](https://github.com/NanasuNANA/UdonariumWithFly) をベースにした [HKTRPG](https://www.hktrpg.com/) 改造版です。UI は繁体字中国語で、With Fly の高度・立ち絵（スタンド）・Cut-in・チャット文字色などの拡張を引き継いでいます。

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
| 繁体字中国語 UI | 主要 UI／説明を zh-Hant にローカライズ |
| ゲストモード | 部屋作成時に「ゲスト許可」可；ゲスト UI は制限（保存不可など）；パスワード部屋はパスワード必須 |
| 簡易モード（ClarifyMode） | チャットを簡易表示に切替可能 |
| ノート倉庫 | 卓／共有／プライベート／ゴミ箱でメモを整理 |
| クイックロール | キャラクターシート欄をワンクリックでチャットへ送り BCDice で解決 |
| SkyWay 2023 | 最新 `@skyway-sdk` と自前 backend |

With Fly から継承：高度、チャット文字色、立ち絵（スタンド）、Cut-in、ダイスボット表など。

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
