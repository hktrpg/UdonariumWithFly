# Syncing upstream WithFly into HKTRPG

Base branch: `hktrpg-main` (forked from `NanasuNANA/UdonariumWithFly` `withFly`).

## Remotes

```text
origin    https://github.com/zeteticl/UdonariumWithFly.git
upstream  https://github.com/NanasuNANA/UdonariumWithFly.git
```

## Sync procedure

```text
git fetch upstream
git checkout -b sync/YYYYMMDD hktrpg-main
git merge upstream/withFly
# resolve conflicts → npm i → ng build → smoke test (connect + HKTRPG features)
git checkout hktrpg-main
git merge sync/YYYYMMDD
git push origin hktrpg-main
```

## Rules

- Merge **only** `upstream/withFly`. Do not dual-merge TK11235/udonarium unless there is an emergency hotfix WithFly has not absorbed.
- Prefer keeping HKTRPG code in dedicated files (`guest-session.ts`, `note-inventory/`) to reduce conflict surface.
- Do **not** re-encode guest flags into peerId; use `GuestSession` + room-name marker.
- Keep `src/assets/config.yaml` gitignored; do not commit backend secrets.

## Smoke checklist after sync

- [ ] Two browsers: create room / join / chat sync (skyway2023)
- [ ] Quick roll send button on character sheet
- [ ] Note inventory panel
- [ ] ClarifyMode (精簡) toggle
- [ ] Guest create + guest join + menu restrictions
- [ ] HKTRPG title / favicon
