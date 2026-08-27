/** Single source of truth for main navigation (desktop rail + mobile nav). */

export type MainMenuKind = 'open' | 'toggle' | 'contextMenu' | 'logout';
export type MainMenuContextMenu = 'toolbox' | 'settings';
export type MainMenuMobileSlot = 'play' | 'edit' | 'both' | 'more';

export interface MainMenuItemDef {
  tourId: string;
  icon: string;
  labelKey: string;
  tipKey?: string;
  kind: MainMenuKind;
  component?: string;
  contextMenu?: MainMenuContextMenu;
  gated?: boolean;
  badge?: 'chat' | 'update';
  showOnMobile?: MainMenuMobileSlot;
  selfOnlyHint?: boolean;
}

export const MAIN_MENU_ITEMS: MainMenuItemDef[] = [
  { tourId: 'menu.connection', icon: 'people', labelKey: 'menu.connection', tipKey: 'tip.menu.connection', kind: 'toggle', component: 'PeerMenuComponent', badge: 'update', showOnMobile: 'play' },
  { tourId: 'menu.chat', icon: 'speaker_notes', labelKey: 'menu.chat', tipKey: 'tip.menu.chat', kind: 'open', component: 'ChatWindowComponent', badge: 'chat', showOnMobile: 'play' },
  { tourId: 'menu.table', icon: 'layers', labelKey: 'menu.table', tipKey: 'tip.menu.table', kind: 'toggle', component: 'GameTableSettingComponent', gated: true, showOnMobile: 'edit' },
  { tourId: 'menu.images', icon: 'photo_library', labelKey: 'menu.images', tipKey: 'tip.menu.images', kind: 'toggle', component: 'FileStorageComponent', gated: true, showOnMobile: 'edit' },
  { tourId: 'menu.music', icon: 'queue_music', labelKey: 'menu.music', tipKey: 'tip.menu.music', kind: 'toggle', component: 'JukeboxComponent', gated: true, showOnMobile: 'edit' },
  { tourId: 'menu.toolbox', icon: 'build', labelKey: 'menu.toolbox', tipKey: 'tip.menu.toolbox', kind: 'contextMenu', contextMenu: 'toolbox', gated: true },
  { tourId: 'menu.combat', icon: 'sports_mma', labelKey: 'menu.combat', tipKey: 'tip.menu.combat', kind: 'toggle', component: 'CombatTrackerComponent', showOnMobile: 'play' },
  { tourId: 'menu.timer', icon: 'timer', labelKey: 'menu.timer', tipKey: 'tip.menu.timer', kind: 'toggle', component: 'TableTimerPanelComponent' },
  { tourId: 'menu.sceneTools', icon: 'architecture', labelKey: 'menu.sceneTools', tipKey: 'tip.menu.sceneTools', kind: 'toggle', component: 'SceneToolsComponent', gated: true },
  { tourId: 'menu.scenePreset', icon: 'theaters', labelKey: 'menu.scenePreset', tipKey: 'tip.menu.scenePreset', kind: 'toggle', component: 'ScenePresetComponent', gated: true },
  { tourId: 'menu.scenarioText', icon: 'menu_book', labelKey: 'menu.scenarioText', tipKey: 'tip.menu.scenarioText', kind: 'toggle', component: 'ScenarioTextComponent', gated: true },
  { tourId: 'menu.inventory', icon: 'folder_shared', labelKey: 'menu.inventory', tipKey: 'tip.menu.inventory', kind: 'toggle', component: 'GameObjectInventoryComponent', gated: true, showOnMobile: 'play' },
  { tourId: 'menu.notes', icon: 'note', labelKey: 'menu.notes', tipKey: 'tip.menu.notes', kind: 'toggle', component: 'NoteInventoryComponent', gated: true, showOnMobile: 'both' },
  { tourId: 'menu.settings', icon: 'how_to_reg', labelKey: 'menu.settings', tipKey: 'tip.menu.settings', kind: 'contextMenu', contextMenu: 'settings', selfOnlyHint: true },
  { tourId: 'menu.disconnect', icon: 'logout', labelKey: 'menu.disconnect', tipKey: 'tip.menu.disconnect', kind: 'logout' },
  { tourId: 'menu.more', icon: 'more_horiz', labelKey: 'menu.more', tipKey: 'tip.menu.more', kind: 'contextMenu', showOnMobile: 'both' },
];

const COMPONENT_TOUR_MAP: Record<string, string> = {};
for (const item of MAIN_MENU_ITEMS) {
  if (item.component) COMPONENT_TOUR_MAP[item.component] = item.tourId;
}

export function tourIdForMenuComponent(componentName: string): string | null {
  return COMPONENT_TOUR_MAP[componentName] ?? null;
}
