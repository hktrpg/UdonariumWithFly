# HKTRPG Feature Inventory (port source: `withfly220820`)

Behavior checklist for porting onto `hktrpg-main` (latest WithFly). Source of truth for acceptance.

| Feature | User-visible behavior | Primary sources on `withfly220820` | Acceptance |
|---------|----------------------|--------------------------------------|------------|
| Quick roll on sheet | Send button on character sheet fields posts `value name` (or `current/value name`) to chat so BCDice can resolve | `src/app/component/game-data-element/game-data-element.component.{ts,html}` | Click send → message appears on active chat tab |
| Note inventory | Panel「筆記倉庫」lists notes by table / common / private / graveyard | `src/app/component/note-inventory/*`, wiring in `app.module.ts`, `app.component.{ts,html}` | Open panel; create/move notes; sync to other peers |
| ClarifyMode | Toggle simplified chat presentation | `chat-window.component.*`, `chat-input.component.*` | Toggle changes chat UI as in old build |
| Guest mode | Room option「允許訪客」; guests join with restricted UI (no save, limited menus) | `guest-session.ts`, lobby/room-setting, `Network.GuestMode()`, menu/movable/rotable/tabletop-action gates | Host enables allow-guest; lobby shows 訪客; guest UI restricted; password rooms still need password (skyway2023) |
| HKTRPG / CHT | HKTRPG favicon/OG/title; landing page; high-traffic UI Traditional Chinese | root `index.html` (landing), `src/index.html`, selected UI strings | First paint + main flows show HKTRPG + zh-Hant |
| Keyboard token controls | Click to select; WASD move; Shift+WASD face; Delete; C/X/V (paste at cursor); [ ] layer; Alt(+Shift)/Ctrl+Shift+wheel rotate (±3° / ±45°); Shift on drop skips snap; Esc/empty clears; Ctrl+Shift+D toggles DEBUG pose | `tabletop-keyboard.service.ts`, `table-mouse-gesture.ts`, `movable.directive.ts`, rotable synchronizer, `game-table.component.*` | Select → keys/wheel; DEBUG shows view/selection pose; text selection still copies text; paste follows pointer |
| Hover overview pin | Hover token shows overview; pin keeps it open; unpin / leave fades out (~0.5s); closes when object leaves table | `tooltip.directive.ts`, `overview-panel.component.*` | Pin survives leave; delete/graveyard closes that panel |
| Undo / redo | Ctrl+Z undo; Ctrl+Y / Ctrl+Shift+Z redo. Covers move/rotate/delete/cut-paste/layer/path-move and scene create/delete/nudge. Local per-peer stack; guests blocked; ignored in INPUT/TEXTAREA | `undo.service.ts`, `tabletop-keyboard.service.ts`, movable/rotable synchronizers, `scene-tool.service.ts`, `token-path-move.service.ts` | Move token → Ctrl+Z restores; Ctrl+Y redoes; chat input Ctrl+Z still edits text |
| Guided tour | First-run overlay: rooms & save, menus (incl. preset scenes / scenario text), table gestures, shortcuts; welcome language picker; skip/replay from Settings | `guided-tour.service.ts`, `guided-tour-steps.ts`, `guided-tour.component.*`, i18n `*-tip.ts` | Fresh profile shows welcome → complete/skip; Settings replay includes new menu steps |
| Hover teaching tips | Hover menu/chat controls for tip boxes; Settings toggle; suppressed during tour | `teaching-tip.service.ts`, `teaching-tip.directive.ts`, `teaching-tip.component.*` | Hover Connection shows tip; disable in Settings stops tips |
| Path move | One token: Ctrl+left waypoints → left-click destination or Space to go; right-click undoes last; Esc cancels; recorded in undo | `token-path-move.service.ts`, `tabletop-keyboard.service.ts`, game-table HUD | Draft waypoints → Space moves; Esc clears; Ctrl+Z undoes path move |
| ZIP includes audio | Room ZIP packs uploaded BGM / audio blobs (not only images) | `save-data.service.ts` | Upload music → Download ZIP → reload ZIP restores audio |
| Multi-track BGM | Up to 4 concurrent room tracks + local ambience; audition is local-only | `Jukebox.ts`, `jukebox.component.*` | Play multiple tracks; mute audition does not broadcast |
| Preset scenes | Save / apply tabletop poses, atmosphere, multi-track BGM (+ optional switch text); included in guided tour | `scene-preset*.ts`, `scene-preset.component.*`, `guided-tour-steps.ts` | Save scene → move tokens → Apply restores poses; tour step opens panel |
| Scenario text | Draft narration; send full / selection to active chat tab; included in guided tour | `scenario-text*.ts`, `scenario-text.component.*` | Create item → Send / Send selection appears in chat |
| Multiple chat windows | Opening Chat from the menu does not close existing chat panels | `app.component.ts` `open()` | Open Chat twice → two panels |
| Room XML `syncId` | Persist sync identifiers across ZIP／folder reload so piece↔table bindings survive UUID regen | `object-serializer.ts`, `room.ts`, `tabletop-object.ts` | Save room → reload → tokens stay on correct table; presets rebind |

## Port decisions

- **Guest**: do **not** encode `isAllowGuest` / `isGuest` into peerId. Use sync room state + local guest flag.
- **CHT**: title/favicon/landing + high-frequency UI first; not full i18n of every WithFly string.
- **Quick roll**: old `sendLogMessage` passed broken `value.gameType` etc.; reimplement against current `ChatMessageService.sendMessage` using active chat tab + current speaker.

## Sync after port

See `docs/hktrpg-sync.md` (added in final step).
