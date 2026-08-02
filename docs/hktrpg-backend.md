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

## Minimal fix for local develop

1. Create a SkyWay app: https://skyway.ntt.com/
2. Clone and deploy backend (Cloudflare Workers is the usual path):

```text
git clone https://github.com/TK11235/udonarium-backend.git
cd udonarium-backend
```

3. Set Worker env (or `wrangler.toml` / `.dev.vars` — **never commit secrets**):

| Variable | Value |
|----------|--------|
| `SKYWAY_APP_ID` | your app id |
| `SKYWAY_SECRET` | your secret |
| `SKYWAY_UDONARIUM_LOBBY_SIZE` | `4` |
| `ACCESS_CONTROL_ALLOW_ORIGIN` | `https://localhost:4200` for local; production site Origin for deploy |

For multiple Origins, deploy separate Workers or check backend docs; Cosr is typically one Origin per Worker config.

4. Put the Worker URL into **gitignored** `src/assets/config.yaml`:

```yaml
backend:
  mode: skyway2023
  url: https://YOUR-WORKER.workers.dev/
```

5. Restart `ng serve --ssl` and reload the page.

## Production (HKTRPG)

Set `ACCESS_CONTROL_ALLOW_ORIGIN` to your real HTTPS site Origin (e.g. `https://z01.hktrpg.com`) and the same URL in the deployed `assets/config.yaml`.
