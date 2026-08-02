# HKTRPG production deploy checklist

## 1. Cloudflare Workers (udonarium-backend)

Requires interactive login once:

```text
cd E:\github\udonarium-backend\packages\backend\cloudflare-workers
npx wrangler login
```

Set production secrets (do not commit):

```text
npx wrangler secret put SKYWAY_APP_ID
npx wrangler secret put SKYWAY_SECRET
```

Or edit deployed Worker env in Cloudflare dashboard:

| Variable | Value |
|----------|--------|
| `SKYWAY_APP_ID` | SkyWay app id |
| `SKYWAY_SECRET` | SkyWay secret (**rotate if exposed**) |
| `SKYWAY_UDONARIUM_LOBBY_SIZE` | `4` |
| `ACCESS_CONTROL_ALLOW_ORIGIN` | exact site Origin, e.g. `https://z01.hktrpg.com` |

Deploy:

```text
cd E:\github\udonarium-backend
npm run cloudflare-workers:deploy
```

Note the Worker URL, e.g. `https://udonarium-backend.<account>.workers.dev/`.

## 2. Frontend production config

Before `ng build`, set gitignored `src/assets/config.yaml`:

```yaml
backend:
  mode: skyway2023
  url: https://YOUR-WORKER.workers.dev/
```

Then:

```text
cd E:\github\UdonariumWithFly
npx ng build --configuration=production
```

Upload `dist/udonarium/` (or project dist folder) to your HTTPS host.

## 3. Local develop (unchanged)

See `docs/hktrpg-backend.md` — wrangler on `:8787` + `ng serve --ssl` with `proxy.conf.js`.

## 4. Guest / password note

Under skyway2023, guests joining a **password room still need the password** (peer digest). Guest mode only restricts UI after join.
