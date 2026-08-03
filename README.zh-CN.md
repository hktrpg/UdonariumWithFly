# Udonarium 乌冬 @ HKTRPG

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

---

[Udonarium（ユドナリウム）](https://github.com/TK11235/udonarium) 是在 Web 浏览器中运行的桌游／TRPG 在线跑团支援工具。

本项目是以 [Udonarium with Fly](https://github.com/NanasuNANA/UdonariumWithFly) 为基底的 [HKTRPG](https://www.hktrpg.com/) 改造版：多语言界面（默认繁体中文），并加入光照、战斗追踪、键盘操控等 VTT 向工具；同时保留 With Fly 的高度、立绘（Stand）、Cut-in、聊天文字颜色等扩展。

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/TK11235/udonarium/blob/master/LICENSE)

## 立即试用

- **本站（乌冬 @ HKTRPG）**：https://z01.hktrpg.com/
- 本家试用：https://udonarium.app/
- With Fly 试用：https://nanasunana.github.io/

推荐浏览器：桌面版 Google Chrome（需 HTTPS）。

## 功能

- **在线跑团**
  - 房间、多桌面管理
  - 桌面遮罩、立体地形
  - 棋子、卡片、共用备忘
  - 聊天与指令板（Chat Palette）
  - 骰子机器人（[BCDice](https://github.com/bcdice/bcdice-js)）
  - 图片共用、BGM、ZIP 存档

- **浏览器间通信**
  - 以 WebRTC（[SkyWay](https://skyway.ntt.com/)）连接；连接后处理尽量在浏览器完成

- **轻量实时**
  - 操作实时同步给其他参加者

## 本项目追加（相对于 With Fly／本家）

| 功能 | 说明 |
|------|------|
| 多语言界面 | 运行时切换 繁中／简中／English／日本語（菜单；会记住） |
| HKTRPG 品牌 | 标题、favicon、OG、落地页 |
| 角色权限房间 | GM／User／Guest 各自开放／密码／停用 |
| 角色邀请链接 | 可复制各角色深链接；需要时再输入密码 |
| 访客模式 | 访客 UI 受限（无法存档、菜单受限）；仍支持旧版「允许访客」 |
| 精简模式（ClarifyMode） | 聊天工具栏精简显示切换 |
| 笔记仓库 | 按桌面／共用／私人／坟场整理备忘 |
| 快速掷骰 | 角色卡字段一键送到聊天给 BCDice 结算 |
| 键盘操控棋子 | 选取后 WASD／方向键移动；Shift+WASD 面向；Delete；Ctrl+C/X/V；Ctrl+Z 撤销／Ctrl+Y（或 Ctrl+Shift+Z）重做；`[`/`]` 图层；Ctrl(+Shift)+滚轮旋转；Shift 放下不吸附 |
| 撤销／重做 | 本机堆叠：移动／旋转／删除／剪切粘贴／图层；场景工具创建／删除／微移。访客不可用；输入框内不拦截（由浏览器处理文字撤销） |
| 路径移动 | Ctrl+左键设路点（放开 Ctrl 仍保留）→ 左键点终点开始移动；右键取消最后路点 |
| 选取体验 | 点选／框选；Shift+点／拖曳多选；双击详情；选取高亮 |
| Ping | 长按地图标记；Shift+长按警告 |
| 桌面光照与视野 | 黑暗／FoW、灯光、墙、视野距离；可宣告视野角色 |
| 场景工具 | GM 灯光／墙／绘图／文字；可选开放玩家工具权限 |
| 战斗追踪 | 先攻、回合、宣告、结束回合、击败跳过 |
| 玩家认领角色 | 「作为我的角色」：默认发言、视野、他人不可移动 |
| 天气 | 雨／雪／樱花／枫叶／极光等（桌面设定） |
| 图片特效 | 灰度、怀旧、对比、翻转、剪影、Matrix…（棋子／立绘／聊天图标／角色卡） |
| 状态／光环／环／死亡 | 状态图标、光环、环特效；死亡与战斗击败同步 |
| 重新加载存档提示 | F5／Ctrl+R 可先下载 ZIP（访客跳过） |

继承自 With Fly：高度、聊天文字颜色、立绘（Stand）、Cut-in、骰子机器人表、SkyWay 2023（`@skyway-sdk`）等。本 fork 使用自建 backend（请勿指向 WithFly 公开 Workers）。

功能验收清单：[`docs/hktrpg-feature-inventory.md`](docs/hktrpg-feature-inventory.md)

## 本地开发

需要 Node.js、npm，以及自建的 [udonarium-backend](https://github.com/TK11235/udonarium-backend)（SkyWay Auth Token）。  
**请勿**把本地／HKTRPG 站点指向 WithFly 公开 Workers（仅允许 `nanasunana.github.io` Origin）。

详见：

- [`docs/hktrpg-backend.md`](docs/hktrpg-backend.md) — 本地 backend、CORS、proxy
- [`docs/hktrpg-deploy.md`](docs/hktrpg-deploy.md) — 正式环境 Workers＋前端
- [`docs/hktrpg-sync.md`](docs/hktrpg-sync.md) — 同步 upstream WithFly

```bash
npm i
# 编辑 src/assets/config.yaml（gitignored），设定 backend.url
# 建议：Angular proxy → 本地 :8787，见 proxy.conf.js
npx ng serve --ssl --host 127.0.0.1 --port 4200 --proxy-config proxy.conf.js
```

正式构建：

```bash
ng build
```

产物在 `dist/`。部署前请将 `backend.url` 设为你的 Workers URL，并让 `ACCESS_CONTROL_ALLOW_ORIGIN` 等于站点 Origin（例如 `https://z01.hktrpg.com`）。

### BCDice-API（可选）

在 `config.yaml` 设定 `dice.url` 后可改走 BCDice-API；默认 API 版本为 2（成功／失败着色需要 v2）。

```yaml
backend:
  mode: skyway2023
  url: https://{your-backend-hostname}/
dice:
  url: # BCDice-API 端点
  api: 2
```

## 上游项目

1. [TK11235/udonarium](https://github.com/TK11235/udonarium) — Udonarium 本家  
2. [NanasuNANA/UdonariumWithFly](https://github.com/NanasuNANA/UdonariumWithFly) — With Fly（高度、立绘、Cut-in 等）

本家开发与贡献说明请见上游 README。Issue／PR 请开到对应上游或本 fork（HKTRPG 相关）。

聊天平台掷骰、角色卡等 HKTRPG Bot 功能请见：[HKTRPG 使用教程](https://bothelp.hktrpg.com/guide)。

## License

[MIT License](https://github.com/TK11235/udonarium/blob/master/LICENSE)

Udonarium、Udonarium with Fly 与第三方素材（图片／音效）之授权与署名，请一并遵守各原始项目与 `src/assets/**/copyright.txt`、`license.txt`。
