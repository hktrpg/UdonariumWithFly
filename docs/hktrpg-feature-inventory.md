# HKTRPG Feature Inventory (port source: `withfly220820`)

Behavior checklist for porting onto `hktrpg-main` (latest WithFly). Source of truth for acceptance.

| Feature | User-visible behavior | Primary sources on `withfly220820` | Acceptance |
|---------|----------------------|--------------------------------------|------------|
| Quick roll on sheet | Send button on character sheet fields posts `value name` (or `current/value name`) to chat so BCDice can resolve | `src/app/component/game-data-element/game-data-element.component.{ts,html}` | Click send → message appears on active chat tab |
| Note inventory | Panel「筆記倉庫」lists notes by table / common / private / graveyard | `src/app/component/note-inventory/*`, wiring in `app.module.ts`, `app.component.{ts,html}` | Open panel; create/move notes; sync to other peers |
| ClarifyMode | Toggle simplified chat presentation | `chat-window.component.*`, `chat-input.component.*` | Toggle changes chat UI as in old build |
| Guest mode | Room option「允許訪客」; guests join with restricted UI (no save, limited menus) | `guest-session.ts`, lobby/room-setting, `Network.GuestMode()`, menu/movable/rotable/tabletop-action gates | Host enables allow-guest; lobby shows 訪客; guest UI restricted; password rooms still need password (skyway2023) |
| HKTRPG / CHT | HKTRPG favicon/OG/title; landing page; high-traffic UI Traditional Chinese | root `index.html` (landing), `src/index.html`, selected UI strings | First paint + main flows show HKTRPG + zh-Hant |
| Keyboard token controls | Click to select; WASD move; Shift+WASD face; Delete; C/X/V (paste at cursor); [ ] layer; Ctrl(+Shift)+wheel rotate; Shift on drop skips snap; Esc/empty clears | `tabletop-keyboard.service.ts`, `movable.directive.ts`, rotable synchronizer | Select → keys/wheel; text selection still copies text; paste follows pointer |
| Undo / redo | Ctrl+Z undo; Ctrl+Y / Ctrl+Shift+Z redo. Covers move/rotate/delete/cut-paste/layer and scene create/delete/nudge. Local per-peer stack; guests blocked; ignored in INPUT/TEXTAREA | `undo.service.ts`, `tabletop-keyboard.service.ts`, movable/rotable synchronizers, `scene-tool.service.ts` | Move token → Ctrl+Z restores; Ctrl+Y redoes; chat input Ctrl+Z still edits text |

## Port decisions

- **Guest**: do **not** encode `isAllowGuest` / `isGuest` into peerId. Use sync room state + local guest flag.
- **CHT**: title/favicon/landing + high-frequency UI first; not full i18n of every WithFly string.
- **Quick roll**: old `sendLogMessage` passed broken `value.gameType` etc.; reimplement against current `ChatMessageService.sendMessage` using active chat tab + current speaker.

## Sync after port

See `docs/hktrpg-sync.md` (added in final step).
