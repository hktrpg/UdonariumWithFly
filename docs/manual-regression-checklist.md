# Manual regression checklist (maps / red string / save)

Use after risky changes to multi-map, ClueLink, or room save/load.

1. **Dual-map poses** — Place a token on 戰場地圖（3D）, note coords; switch to 線索版（2D）; switch back; token still at the same place on 3D.
2. **3D vs 2D red strings** — Strings on battle map stay on battle; clue-board strings stay on clue; each set hidden on the other map.
3. **Save ZIP → reload** — Save room ZIP, reload page, load ZIP; dual placements + both clue link sets intact.
4. **Save immediately after load** — Load ZIP, save again without edits, reload; strings/pieces still present (DELETE self-echo guard).
5. **Default room seed** — New empty room: `gameTable` + `gameTable_clue2d`, monster C on both, 2 battle links + 5 clue links.
6. **Join room** — Entering a mesh room must not push lobby sample tables over the host house (clearLocal + claim authority).
7. **GM preview map** — View another scene locally without changing room active for peers.
8. **Scene preset keep-tokens** — Apply with keep-tokens: visible characters re-stamp; extras prune.
9. **Table timers** — Two browsers: create timer, start/pause sync, drag on canvas, cycle display mode, count-up at target, on-zero sound/chat; guest cannot create; non-creator cannot delete.
10. **Hand rail** — HUD hidden until you have cards; quick-drag shows a dashed bottom drop band only when collapsed or hand empty; drop into expanded hand rail / return to stack / table; hold ~0.55s to move whole stack; horizontal scroll cabinet (wheel or drag empty space); GM peek read-only; KeyR shuffle when all selected are card stacks.

Unit coverage: `npm run test:ci` (Karma). Optional E2E: `npm run e2e:smoke` (also in CI `playwright-smoke` job).
