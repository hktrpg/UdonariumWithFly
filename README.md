# Udonarium (Udon) @ HKTRPG

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

---

[Udonarium](https://github.com/TK11235/udonarium) is a browser-based tool that supports online board-game / TRPG sessions.

This project is an [HKTRPG](https://www.hktrpg.com/) fork of [Udonarium with Fly](https://github.com/NanasuNANA/UdonariumWithFly): Traditional Chinese UI, keeping With Fly extensions such as altitude, standees (Stand), Cut-in, and chat text colors.

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/TK11235/udonarium/blob/master/LICENSE)

## Try it now

- **This site (Udon @ HKTRPG)**: https://z01.hktrpg.com/
- Original demo: https://udonarium.app/
- With Fly demo: https://nanasunana.github.io/

Recommended browser: desktop Google Chrome (HTTPS required).

## Features

- **Online sessions**
  - Rooms and multiple tabletops
  - Table masks and 3D terrain
  - Tokens, cards, shared notes
  - Chat and Chat Palette
  - Dice bot ([BCDice](https://github.com/bcdice/bcdice-js))
  - Shared images, BGM, ZIP save data

- **Browser-to-browser networking**
  - WebRTC via [SkyWay](https://skyway.ntt.com/); work after connect stays mostly in the browser

- **Lightweight realtime**
  - Actions sync live to other participants

## Additions in this fork (vs With Fly / original)

| Feature | Description |
|---------|-------------|
| Traditional Chinese UI | Main UI / help localized to zh-Hant |
| Guest mode | Rooms can “allow guests”; guest UI is restricted (no save, etc.); password rooms still require a password |
| Clarify mode | Compact chat display toggle |
| Note storage | Organize notes by tabletop / shared / private / trash |
| Quick roll | Send character-sheet fields to chat for BCDice in one click |
| SkyWay 2023 | Latest `@skyway-sdk` with a self-hosted backend |

Inherited from With Fly: altitude, chat text color, standees (Stand), Cut-in, dice-bot tables, etc.

Feature checklist: [`docs/hktrpg-feature-inventory.md`](docs/hktrpg-feature-inventory.md)

## Local development

Requires Node.js, npm, and a self-hosted [udonarium-backend](https://github.com/TK11235/udonarium-backend) (SkyWay Auth Token).  
**Do not** point local / HKTRPG sites at the public WithFly Workers (only `nanasunana.github.io` Origin is allowed).

See:

- [`docs/hktrpg-backend.md`](docs/hktrpg-backend.md) — local backend, CORS, proxy
- [`docs/hktrpg-deploy.md`](docs/hktrpg-deploy.md) — production Workers + frontend
- [`docs/hktrpg-sync.md`](docs/hktrpg-sync.md) — sync upstream WithFly

```bash
npm i
# Edit src/assets/config.yaml (gitignored); set backend.url
# Recommended: Angular proxy → local :8787; see proxy.conf.js
npx ng serve --ssl --host 127.0.0.1 --port 4200 --proxy-config proxy.conf.js
```

Production build:

```bash
ng build
```

Output is in `dist/`. Before deploy, set `backend.url` to your Workers URL and `ACCESS_CONTROL_ALLOW_ORIGIN` to your site Origin (e.g. `https://z01.hktrpg.com`).

### BCDice-API (optional)

Set `dice.url` in `config.yaml` to use BCDice-API; default API version is 2 (success/failure coloring needs v2).

```yaml
backend:
  mode: skyway2023
  url: https://{your-backend-hostname}/
dice:
  url: # BCDice-API endpoint
  api: 2
```

## Upstream

1. [TK11235/udonarium](https://github.com/TK11235/udonarium) — original Udonarium  
2. [NanasuNANA/UdonariumWithFly](https://github.com/NanasuNANA/UdonariumWithFly) — With Fly (altitude, standees, Cut-in, etc.)

See upstream READMEs for original development / contribution notes. Open Issues / PRs on the matching upstream or this fork (HKTRPG-related).

For HKTRPG Bot (chat-platform dice, character sheets, etc.): [HKTRPG guide](https://bothelp.hktrpg.com/guide).

## License

[MIT License](https://github.com/TK11235/udonarium/blob/master/LICENSE)

Respect the licenses and attribution of Udonarium, Udonarium with Fly, and third-party assets (images / audio), including each original project and `src/assets/**/copyright.txt`, `license.txt`.
