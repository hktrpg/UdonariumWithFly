import { Jukebox } from '@udonarium/Jukebox';

import { ObjectStore } from '../synchronize-object/object-store';

import { ImageState } from './image-file';
import { ImageStorage } from './image-storage';

type FileResourceKind = 'image' | 'audio' | 'pdf' | 'video';

/** Stable ObjectStore id for the room jukebox singleton (`new Jukebox('Jukebox')`). */
export const JUKEBOX_OBJECT_ID = 'Jukebox';

/**
 * Lower tier runs first. Within a tier, sort by estimated bytes ascending.
 *
 * Join order: thumbnails → playing BGM → full images → (audio + pdf + video by size).
 */
export enum FileSyncPriorityTier {
  IMAGE_THUMB = 0,
  PLAYING_AUDIO = 1,
  IMAGE_FULL = 2,
  /** Idle audio, pdf, video — same tier, size order. */
  DEFAULT = 3,
}

export function fileSyncPriorityTier(kind: FileResourceKind, identifier: string): FileSyncPriorityTier {
  if (kind === 'image') {
    const image = ImageStorage.instance.get(identifier);
    const state = image?.state ?? ImageState.NULL;
    // Still need thumbnail blob before full image.
    if (state < ImageState.THUMBNAIL) return FileSyncPriorityTier.IMAGE_THUMB;
    return FileSyncPriorityTier.IMAGE_FULL;
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

let playingMusicCache: Set<string> | null = null;

/** Avoid re-parsing jukebox state on every sort comparison. */
export function primePlayingMusicCache(): void {
  playingMusicCache = collectPlayingMusicIdentifiers();
}

export function clearPlayingMusicCache(): void {
  playingMusicCache = null;
}

function isPlayingMusicIdentifier(identifier: string): boolean {
  if (!identifier) return false;
  const ids = playingMusicCache ?? collectPlayingMusicIdentifiers();
  return ids.has(identifier);
}
