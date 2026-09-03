import { Jukebox } from '@udonarium/Jukebox';

import { ObjectStore } from '../synchronize-object/object-store';

import { ImageState } from './image-file';
import { ImageStorage } from './image-storage';

type FileResourceKind = 'image' | 'audio' | 'pdf' | 'video';

/** Stable ObjectStore id for the room jukebox singleton (`new Jukebox('Jukebox')`). */
export const JUKEBOX_OBJECT_ID = 'Jukebox';

/** Placeholder SyncVar value on GameTable — not a real image id. */
const PLACEHOLDER_IMAGE_ID = 'imageIdentifier';

/** Duck-typed table surface so this module stays free of GameTable import cycles. */
interface TableImageSource {
  imageIdentifier?: string;
  backgroundImageIdentifier?: string;
  backgroundImageIdentifier2?: string;
}

/**
 * Lower tier runs first. Within a tier, sort by estimated bytes ascending
 * (active-table map images sort before other maps of the same tier).
 *
 * Join order: map thumbs → other thumbs → playing BGM → map full → other full
 * → (audio + pdf + video by size).
 */
export enum FileSyncPriorityTier {
  IMAGE_MAP_THUMB = 0,
  IMAGE_THUMB = 1,
  PLAYING_AUDIO = 2,
  IMAGE_MAP_FULL = 3,
  IMAGE_FULL = 4,
  /** Idle audio, pdf, video — same tier, size order. */
  DEFAULT = 5,
}

export function fileSyncPriorityTier(kind: FileResourceKind, identifier: string): FileSyncPriorityTier {
  if (kind === 'image') {
    const image = ImageStorage.instance.get(identifier);
    const state = image?.state ?? ImageState.NULL;
    const isMap = isMapImageIdentifier(identifier);
    // Still need thumbnail blob before full image.
    if (state < ImageState.THUMBNAIL) {
      return isMap ? FileSyncPriorityTier.IMAGE_MAP_THUMB : FileSyncPriorityTier.IMAGE_THUMB;
    }
    return isMap ? FileSyncPriorityTier.IMAGE_MAP_FULL : FileSyncPriorityTier.IMAGE_FULL;
  }
  if (kind === 'audio' && isPlayingMusicIdentifier(identifier)) {
    return FileSyncPriorityTier.PLAYING_AUDIO;
  }
  return FileSyncPriorityTier.DEFAULT;
}

export function compareFileSyncPriority(
  kindA: FileResourceKind,
  identifierA: string,
  bytesA: number,
  kindB: FileResourceKind,
  identifierB: string,
  bytesB: number,
): number {
  const tierA = fileSyncPriorityTier(kindA, identifierA);
  const tierB = fileSyncPriorityTier(kindB, identifierB);
  if (tierA !== tierB) return tierA - tierB;
  const mapRankA = mapImageSortRank(kindA, identifierA);
  const mapRankB = mapImageSortRank(kindB, identifierB);
  if (mapRankA !== mapRankB) return mapRankA - mapRankB;
  return bytesA - bytesB;
}

/** Jukebox tracks that are actively playing (including paused transport). */
export function collectPlayingMusicIdentifiers(): Set<string> {
  const ids = new Set<string>();
  const jukebox = ObjectStore.instance.get<Jukebox>(JUKEBOX_OBJECT_ID);
  if (!jukebox) return ids;
  for (const track of jukebox.tracks) {
    if (!track.isPlaying || !track.audioIdentifier) continue;
    ids.add(track.audioIdentifier);
    if (track.queue?.length) ids.add(track.queue[0]);
  }
  return ids;
}

/** Surface / background image ids used by any game-table in the room. */
export function collectMapImageIdentifiers(): Set<string> {
  const ids = new Set<string>();
  // Resolve by alias string — avoid importing GameTable (circular with room connect).
  const tables = ObjectStore.instance.getObjects('game-table') as TableImageSource[];
  for (const table of tables) {
    addTableImageIds(ids, table);
  }
  return ids;
}

/** Prefer the currently viewed / active table's map images within the same tier. */
export function collectActiveMapImageIdentifiers(): Set<string> {
  const ids = new Set<string>();
  const selecter = ObjectStore.instance.get('TableSelecter') as {
    viewTable?: TableImageSource | null;
    viewTableIdentifier?: string;
  } | null;
  if (!selecter) return ids;
  const table = selecter.viewTable
    || (selecter.viewTableIdentifier
      ? ObjectStore.instance.get(selecter.viewTableIdentifier) as TableImageSource | null
      : null);
  if (table) addTableImageIds(ids, table);
  return ids;
}

function addTableImageIds(ids: Set<string>, table: TableImageSource): void {
  for (const id of [
    table.imageIdentifier,
    table.backgroundImageIdentifier,
    table.backgroundImageIdentifier2,
  ]) {
    if (id && id !== PLACEHOLDER_IMAGE_ID) ids.add(id);
  }
}

let playingMusicCache: Set<string> | null = null;
let mapImageCache: Set<string> | null = null;
let activeMapImageCache: Set<string> | null = null;

/** Avoid re-parsing jukebox / table state on every sort comparison. */
export function primePlayingMusicCache(): void {
  playingMusicCache = collectPlayingMusicIdentifiers();
  mapImageCache = collectMapImageIdentifiers();
  activeMapImageCache = collectActiveMapImageIdentifiers();
}

export function clearPlayingMusicCache(): void {
  playingMusicCache = null;
  mapImageCache = null;
  activeMapImageCache = null;
}

function isPlayingMusicIdentifier(identifier: string): boolean {
  if (!identifier) return false;
  const ids = playingMusicCache ?? collectPlayingMusicIdentifiers();
  return ids.has(identifier);
}

function isMapImageIdentifier(identifier: string): boolean {
  if (!identifier) return false;
  const ids = mapImageCache ?? collectMapImageIdentifiers();
  return ids.has(identifier);
}

/** 0 = active/view table map, 1 = other map, 2 = not a map image. */
function mapImageSortRank(kind: FileResourceKind, identifier: string): number {
  if (kind !== 'image' || !identifier) return 2;
  const active = activeMapImageCache ?? collectActiveMapImageIdentifiers();
  if (active.has(identifier)) return 0;
  const maps = mapImageCache ?? collectMapImageIdentifiers();
  if (maps.has(identifier)) return 1;
  return 2;
}
