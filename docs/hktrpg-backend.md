# SkyWay backend setup (required)

skyway2023 needs a token API ([udonarium-backend](https://github.com/TK11235/udonarium-backend)).

## Why the public WithFly URL fails locally

`https://udonarium-with-fly-public.nnanasu7.workers.dev/` sets `ACCESS_CONTROL_ALLOW_ORIGIN` to `https://nanasunana.github.io` only.

| Client Origin | Result |
|---------------|--------|
| `https://nanasunana.github.io` | OK |
| `https://localhost:4200` | **403** |
| `https://z01.hktrpg.com` (etc.) | **403** |

That is expected. Do **not** point local/HKTRPG builds at that URL.

## Local develop (recommended on this machine)

Backend lives beside the frontend: `E:\github\udonarium-backend`  
Secrets go only in `packages/backend/cloudflare-workers/.dev.vars` (**gitignored**).

Terminal A — token API:

```text
cd E:\github\udonarium-backend
npm run cloudflare-workers:dev
# Ready on http://127.0.0.1:8787
```

Terminal B — frontend (HTTPS + proxy `/v1` → 8787):

```text
cd E:\github\UdonariumWithFly
npx ng serve --ssl --host 127.0.0.1 --port 4200 --proxy-config proxy.conf.js
```

`src/assets/config.yaml` (gitignored):

```yaml
backend:
  mode: skyway2023
  url: https://localhost:4200/
```

Open `https://localhost:4200/` (accept the self-signed cert) and hard-reload.

## Cloudflare Workers deploy (production)

1. Create a SkyWay app: https://skyway.ntt.com/
2. Clone backend if needed: `git clone https://github.com/TK11235/udonarium-backend.git`
3. Set Worker env / `.dev.vars` (**never commit secrets**):

| Variable | Value |
|----------|--------|
| `SKYWAY_APP_ID` | your app id |
| `SKYWAY_SECRET` | your secret |
| `SKYWAY_UDONARIUM_LOBBY_SIZE` | `4` |
| `ACCESS_CONTROL_ALLOW_ORIGIN` | production Origin, e.g. `https://z01.hktrpg.com` |

4. `npm run cloudflare-workers:deploy`
5. Put the Worker URL into deployed `assets/config.yaml` `backend.url`

## Production (HKTRPG)

Set `ACCESS_CONTROL_ALLOW_ORIGIN` to your real HTTPS site Origin (e.g. `https://z01.hktrpg.com`) and the same URL in the deployed `assets/config.yaml`.
