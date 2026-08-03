import { I18nDictionary } from './types';

export const en_tutorial: I18nDictionary = {
  'tutorial.name': 'Tutorial',
  'tutorial.linkName': 'Notes:',
  'tutorial.welcome': `Welcome to HKTRPG Udon (based on Udonarium with Fly).
The map is 2.5D. Data is shared peer-to-peer; the server does not keep your tokens or images long-term.
★ Before leaving, Download ZIP; next time Load ZIP. Without saving, everything vanishes.
Desktop Chrome recommended. This tutorial hides after your first chat message.
Full guide: https://bothelp.hktrpg.com/guide`,
  'tutorial.view': `<View> Ctrl+left-drag = pan  Right-drag = rotate  Wheel = zoom
　　　　Shift+wheel = pan left/right  Ctrl+wheel = pan up/down
<Objects> Left-drag to move  Drag the rotate handle  Right-click = menu
　　　　Double-click = details (character / card / deck / dice / terrain / note / mask / range…)
　　　　“Next image” for characters is in the right-click menu
　　　　Flip cards, draw from decks, roll dice: use the right-click menu
<Path move> Select a token, Ctrl+left-click to add waypoints (release Ctrl — path stays)
　　　　Then left-click a new position = final stop and go  Right-click = undo last waypoint
<Select> Left-click = select (highlight)  Shift+click = add/remove
　　　　Left-drag empty = box select  Shift+drag = additive box  Click empty / Esc = clear
Drag images or music into the browser to import.`,
  'tutorial.keyboard': `<Keyboard (with selection)> WASD / arrows = move (diagonals OK)
　　　　Shift+WASD = face direction  Delete = delete (characters go to trash)
　　　　Ctrl+C/X/V = copy / cut / paste (paste at cursor; text selection still copies text)
　　　　Ctrl+Z = undo  Ctrl+Y / Ctrl+Shift+Z = redo
　　　　　(move / rotate / delete / cut-paste / layer; scene create / delete / nudge)
　　　　[ = send back  ] = bring front
　　　　Alt+wheel = rotate 15°  Ctrl+Shift+wheel = rotate 45°
　　　　Hold Shift on drop = temporary no grid snap  Esc = clear selection
　　　　Guest mode cannot use edit shortcuts; in text fields Ctrl+Z stays with the browser.`,
  'tutorial.chat': `<Chat> Switch channels above; toolbar (local, ON/OFF):
　　　　Music / SFX / notice / align left / list (bubbles) / compact toolbar
　　　　Compact = hide tabs & toolbar, keep input; restore with the bottom-right button
<Floating dialog> Speaking as a character pre-fills 「」; text inside appears above the token
　　　　Toggle via right-click / inventory “Show floating dialog”
<Dice> Pick a system in the input, then type BCDice commands
　　　　Quick roll beside character sheet numbers goes to the current chat channel
<Guest> Rooms can “allow guests”; guests are limited. Passwords still apply
<Notes> Menu → Note inventory for table / shared / private / trash notes
<Whispers> Not saved in ZIP; after a new connection ID, old whispers are gone.`,
  'tutorial.scene': `<Ping> Long-press empty map = marker; Shift+long-press = warning
<Map settings> Darkness / global brightness / weather (rain・thunderstorm・snow・fog・wind・sakura・maple・sandstorm・rainbow・aurora・burning) / enable vision
　　　　Grid: off / square / hex (vertical・horizontal); optional coordinates; local grid snap
　　　　Toolbox can switch weather and day/night quickly
<Vision> When on, players only see around their vision character (GM unrestricted)
　　　　Picking a speaker in chat = temporary vision; closing that chat clears it
　　　　For persistent vision, right-click “My vision character”; set vision / bright / dim
　　　　Character tokens always block light; masks・terrain block by default — right-click can disable light interaction
　　　　Status icons stay on the nameplate (incl. Dead); Dead syncs both ways with combat Defeated
　　　　Image effects: right-click grayscale / sepia / Matrix rain / silhouette / flip / contrast…
　　　　Base rings via right-click “Ring”
<Scene tools> GM only (menu); select / light / wall / rect / ellipse / polygon / freehand / text
　　　　After select: WASD/arrows move, Delete removes, Ctrl+Z/Y undo/redo; wall・polygon: Enter/double-click finish; Esc cancel
<Combat> Open from menu; add selection / all on table, roll initiative, rounds
　　　　Character right-click “Join combat”; turn announce appears when started`,
  'changelog.v1132': `Re-localized from https://nanasunana.github.io/ private build with extra features.
Upgraded to 1.13.2`,
  'changelog.v1133b': `Upgraded to 1.13.3b
2021/05/11 Improved HTML & TXT export; added COIN
2021/05/13 Updated TOKEN bottom frame size
2021/05/27 Cut-in (YouTube); shadow changes with height`,
  'changelog.vF': `2021/08/17 Updated to F build / dependencies. Fixed character-sheet dice roll bug (thanks Toast Rabbit).`,
  'changelog.2026base': `2026 major update (hktrpg-main)
・Based on latest Udonarium with Fly (Angular 20, SkyWay 2023)
・Full UI localization (zh-TW / zh-CN / en / ja); branding aligned with HKTRPG
・Guest mode, compact chat, note inventory, quick sheet rolls
・Chat toolbar: music / SFX / notice / align left / list / compact
・BCDice 4.9.0`,
  'changelog.2026ops': `2026/08/03 Controls update
・Selection highlight; left-drag empty box select; Shift+click/drag multi-select; Ctrl+left pan map
・Double-click opens details (flip / draw / roll via right-click)
・Keyboard: WASD move, Shift+WASD face, Delete, Ctrl+C/X/V (paste at cursor), Ctrl+Z/Y undo/redo
・[ / ] layer order; Alt+wheel 15° / Ctrl+Shift+wheel 45° rotate
・Shift+wheel pan horizontal; Ctrl+wheel pan vertical
・Path move: select token → Ctrl+left waypoints (Ctrl can be released) → left-click destination to go; right-click undoes last waypoint
・“Next image” moved to right-click; shadow scales with size/height`,
  'changelog.2026scene': `2026/08/03 Scene・combat・vision
・Ping: long-press empty map; Shift+long-press warning
・Map: darkness / brightness / weather; optional vision (walls, point lights)
・Scene tools (GM): wall / light / draw; Enter finishes walls & polygons
・Chat speaker = temporary vision; only manual “My vision character” persists
・Combat: initiative, turn announce; status icons & base rings
・Map settings can download map; status icons wrap on nameplate`,
  'changelog.2026fx': `2026/08/03 Character FX・floating dialog
・Floating dialog: toggle in right-click / inventory; 「」 text shows above the token; character chat pre-fills 「」
・Image effects: grayscale / sepia / contrast / silhouette / flip; Matrix digital rain (digits & letters)
・New Dead status; syncs both ways with combat Defeated; status tip = name + level only
・Character context menu regrouped; menu offset so it does not cover the token
・Double-click token art opens details; combat “Add all on table” for everyone except guests
・Removed character “Interact with light” (tokens always occlude); masks / terrain still toggleable`,
  'changelog.links': `Site: https://z01.hktrpg.com
Guide: https://bothelp.hktrpg.com/guide
Discord: https://support.hktrpg.com
Facebook: https://www.facebook.com/groups/HKTRPG
Wiki: https://www.hktrpg.com/
Original Udonarium: https://udonarium.app/
with Fly: https://nanasunana.github.io/
Support: https://www.patreon.com/HKTRPG`,
  'tutorial.systemFrom': 'System',
};
