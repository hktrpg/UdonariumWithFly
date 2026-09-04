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

## 2. Frontend production build (PWA / Service Worker)

### Cloudflare-compatible PWA

Cloudflare (Bot Fight / JS detections, Rocket Loader, HTML minify, etc.) may **inject or rewrite `index.html`**. Angular’s Service Worker compares SHA-1 hashes; a rewritten document always fails install (`VERSION_INSTALLATION_FAILED`).

This project **does not put `index.html` in the ngsw hash table**. Navigations load the document from the network (CF injection is fine). JS/CSS/images stay integrity-checked as usual.

Still avoid CDN transforms on **hashed assets** (`.js` / `.css`): Auto Minify for JS/CSS can break those hashes.

### Build (z01 `/hktrpg-main/`)

```text
cd E:\github\UdonariumWithFly
# set gitignored src/assets/config.yaml backend.url first
npm run build:hktrpg-main
```

This runs `ng build --base-href /hktrpg-main/`, refreshes ngsw hashes (and strips any `index.html` hash), then verifies the manifest.

Upload **the whole** `dist/udonarium/` folder (do not hand-edit hashed files on the server after upload).

## 3. Local develop (unchanged)

See `docs/hktrpg-backend.md` — wrangler on `:8787` + `ng serve --ssl` with `proxy.conf.js`.

## 4. Guest / password note

Under skyway2023, guests joining a **password room still need the password** (peer digest). Guest mode only restricts UI after join.
