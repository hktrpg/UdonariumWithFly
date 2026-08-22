import { Jukebox } from '@udonarium/Jukebox';

import { ObjectStore } from '../synchronize-object/object-store';

type FileResourceKind = 'image' | 'audio' | 'pdf' | 'video';

/** Lower tier runs first. Within a tier, sort by estimated bytes ascending. */
export enum FileSyncPriorityTier {
  IMAGE = 0,
  PLAYING_AUDIO = 1,
  DEFAULT = 2,
}

export function fileSyncPriorityTier(kind: FileResourceKind, identifier: string): FileSyncPriorityTier {
  if (kind === 'image') return FileSyncPriorityTier.IMAGE;
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
  const jukebox = ObjectStore.instance.get<Jukebox>('Jukebox');
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
