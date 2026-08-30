# Udonarium With Fly

Tabletop RPG session app: shared tabletop, combat tracking, and multiplayer chrome.

## Language

### UI chrome

**UI Theme**:
A local-only visual skin for Chrome and Combat Surface (`classic` | `remake` | `expedition`). Does not sync across peers.
_Avoid_: skin pack, room theme, layout mode

**Chrome**:
Overlay frames and rails outside the tabletop world (`ui-panel`, mobile bottom/side rails, map HUDs).
_Avoid_: window chrome (OS), World UI

**Combat Surface**:
Combat-facing overlays: Party Status, Combat Command Rail, and Combat Announce.
_Avoid_: Combat HUD (ambiguous; historically three separate widgets)

**Party Status**:
Bottom-right (or undocked) character resource strip; claimed tokens out of combat, encounter combatants while started.
_Avoid_: resource HUD, character sheet

**Combat Command Rail**:
Bottom-left shortcuts for begin / next turn / end my turn / end combat.
_Avoid_: command menu, ATB menu

**Encounter Panel**:
Full combat-tracker panel (`ui-panel`) with lists and tools; still auto-opens when combat begins.
_Avoid_: Combat Surface (the pinned overlays)

**World UI**:
In-world token nameplates and auras (not overlay Chrome).
_Avoid_: HUD, Chrome
