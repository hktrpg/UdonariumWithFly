import { AudioFile } from './core/file-storage/audio-file';
import { AudioPlayer, VolumeType } from './core/file-storage/audio-player';
import { AudioStorage } from './core/file-storage/audio-storage';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { GameObject, ObjectContext } from './core/synchronize-object/game-object';
import { InnerXml } from './core/synchronize-object/object-serializer';
import { ObjectStore } from './core/synchronize-object/object-store';
import { EventSystem } from './core/system';
import { AudioLibrary } from './audio-library';

export const JUKEBOX_TRACK_COUNT = 5;
/** Local-only weather SE slot (index 4 / track 5). Does not sync tracksJson. */
export const JUKEBOX_WEATHER_TRACK = 4;
export const MUSIC_HUD_SLOT_COUNT = 3;

export type JukeboxQueueMode =
  | 'single'
  | 'shuffle-loop'
  | 'shuffle-once'
  | 'queue-loop'
  | 'queue-once';

export interface JukeboxTrackState {
  audioIdentifier: string;
  isPlaying: boolean;
  isLoop: boolean;
  roomGain: number;
  label: string;
  queue: string[];
  queueMode: JukeboxQueueMode;
}

function emptyTrack(): JukeboxTrackState {
  return {
    audioIdentifier: '',
    isPlaying: false,
    isLoop: true,
    roomGain: 1,
    label: '',
    queue: [],
    queueMode: 'single',
  };
}

function normalizeQueueMode(raw: any): JukeboxQueueMode {
  if (
    raw === 'shuffle-loop' || raw === 'shuffle-once'
    || raw === 'queue-loop' || raw === 'queue-once'
    || raw === 'single'
  ) return raw;
  return 'single';
}

function normalizeTracks(raw: any): JukeboxTrackState[] {
  const list: JukeboxTrackState[] = [];
  const src = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < JUKEBOX_TRACK_COUNT; i++) {
    const t = src[i] || {};
    const queue = Array.isArray(t.queue)
      ? t.queue.filter((id: any) => typeof id === 'string' && id)
      : [];
    list.push({
      audioIdentifier: typeof t.audioIdentifier === 'string' ? t.audioIdentifier : '',
      isPlaying: !!t.isPlaying,
      isLoop: t.isLoop !== false,
      roomGain: typeof t.roomGain === 'number' && isFinite(t.roomGain)
        ? Math.max(0, Math.min(1, t.roomGain))
        : 1,
      label: typeof t.label === 'string' ? t.label : '',
      queue,
      queueMode: normalizeQueueMode(t.queueMode),
    });
  }
  return list;
}

function shuffleIds(ids: string[]): string[] {
  const arr = ids.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

@SyncObject('jukebox')
export class Jukebox extends GameObject implements InnerXml {
  /** @deprecated Legacy single-track fields; migrated into tracksJson track0. */
  @SyncVar() audioIdentifier: string = '';
  @SyncVar() startTime: number = 0;
  @SyncVar() isLoop: boolean = false;
  @SyncVar() isPlaying: boolean = false;

  @SyncVar() tracksJson: string = '';

  private audioPlayers: AudioPlayer[] = [];
  private waitingFileUpdate: boolean[] = [];
  private migrated = false;

  /** Singleton used by ZIP save/load (fly_jukebox.xml). */
  static get instance(): Jukebox {
    return ObjectStore.instance.get<Jukebox>('Jukebox') || null;
  }

  innerXml(): string { return ''; }

  /** Merge ZIP/room parse into the live Jukebox and destroy the temp clone. */
  parseInnerXml(_element: Element) {
    const live = Jukebox.instance;
    if (!live || live === this) return;
    const context = live.toContext();
    context.syncData = this.toContext().syncData;
    live.apply(context);
    live.update();
    this.destroy();
  }

  get tracks(): JukeboxTrackState[] {
    this.ensureMigrated();
    try {
      return normalizeTracks(this.tracksJson ? JSON.parse(this.tracksJson) : []);
    } catch {
      return normalizeTracks([]);
    }
  }

  set tracks(value: JukeboxTrackState[]) {
    this.tracksJson = JSON.stringify(normalizeTracks(value));
  }

  /** Compat: currently playing BGM on track 0. */
  get audio(): AudioFile {
    const id = this.tracks[0]?.audioIdentifier;
    return id ? AudioStorage.instance.get(id) : null;
  }

  audioAt(index: number): AudioFile {
    const id = this.tracks[index]?.audioIdentifier;
    return id ? AudioStorage.instance.get(id) : null;
  }

  isTrackPlayingAudio(index: number, audio: AudioFile): boolean {
    const t = this.tracks[index];
    return !!(t && t.isPlaying && audio && t.audioIdentifier === audio.identifier);
  }

  isAnyTrackPlayingAudio(audio: AudioFile): boolean {
    if (!audio) return false;
    return this.tracks.some(t => t.isPlaying && t.audioIdentifier === audio.identifier);
  }

  onStoreAdded() {
    super.onStoreAdded();
    this.ensureMigrated();
    this.unlockAfterUserInteraction();
  }

  onStoreRemoved() {
    super.onStoreRemoved();
    this.stopAllLocal();
  }

  /** Compat: play on track 0. */
  play(identifier: string, isLoop: boolean = false) {
    this.playTrack(0, identifier, isLoop);
  }

  /** Compat: stop track 0. */
  stop() {
    this.stopTrack(0);
  }

  /**
   * Local-only built-in asset loop (weather SE on track 5).
   * Does not write tracksJson. Returns false if play could not start.
   */
  playBuiltInLocal(index: number, url: string, isLoop: boolean = true): boolean {
    if (index < 0 || index >= JUKEBOX_TRACK_COUNT || !url) return false;
    try {
      AudioPlayer.ensureContextRunning();
      this.ensurePlayer(index);
      this._stopTrack(index, false);
      const audio = AudioFile.create(url);
      const player = this.audioPlayers[index];
      player.loop = !!isLoop;
      player.volume = 1;
      player.endedAction = null;
      player.play(audio);
      return true;
    } catch {
      return false;
    }
  }

  /** Stop local built-in playback without clearing synced assignment. */
  stopBuiltInLocal(index: number) {
    if (index < 0 || index >= JUKEBOX_TRACK_COUNT) return;
    this._stopTrack(index);
  }

  /** True when the local player for a track is currently audible (not paused). */
  isLocalPlaying(index: number): boolean {
    if (index < 0 || index >= this.audioPlayers.length) return false;
    const player = this.audioPlayers[index];
    return !!(player && !player.paused);
  }

  /** Assign audio to a track without starting playback. */
  setTrackAudio(index: number, identifier: string) {
    if (index < 0 || index >= JUKEBOX_TRACK_COUNT) return;
    this.ensureMigrated();
    const next = this.tracks;
    next[index] = {
      ...next[index],
      audioIdentifier: identifier || '',
      queue: [],
      queueMode: 'single',
    };
    this.tracks = next;
    this.syncLegacyFields();
  }

  playTrack(index: number, identifier: string, isLoop: boolean = true) {
    if (index < 0 || index >= JUKEBOX_TRACK_COUNT) return;
    const audio = AudioStorage.instance.get(identifier);
    if (!audio || !audio.isReady) return;
    this.ensureMigrated();
    const next = this.tracks;
    next[index] = {
      ...next[index],
      audioIdentifier: identifier,
      isPlaying: true,
      isLoop: !!isLoop,
      queue: [],
      queueMode: 'single',
    };
    this.tracks = next;
    this.syncLegacyFields();
    this._playTrack(index);
  }

  /**
   * Play a list on a track.
   * - shuffle-loop / shuffle-once: shuffled order
   * - queue-loop / queue-once: library order
   * - single: play first id only (use playTrack for normal once/loop)
   */
  playQueue(index: number, identifiers: string[], mode: JukeboxQueueMode, isLoopSingle = false) {
    if (index < 0 || index >= JUKEBOX_TRACK_COUNT) return;
    const ids = (identifiers || []).filter(id => {
      const audio = AudioStorage.instance.get(id);
      return audio && audio.isReady;
    });
    if (ids.length < 1) return;

    this.ensureMigrated();
    const next = this.tracks;
    if (mode === 'shuffle-loop' || mode === 'shuffle-once'
      || mode === 'queue-loop' || mode === 'queue-once') {
      const queue = (mode === 'shuffle-loop' || mode === 'shuffle-once')
        ? shuffleIds(ids)
        : ids.slice();
      next[index] = {
        ...next[index],
        audioIdentifier: queue[0],
        isPlaying: true,
        isLoop: false,
        queue,
        queueMode: mode,
      };
      this.tracks = next;
      this.syncLegacyFields();
      this._playTrack(index);
      return;
    } else {
      next[index] = {
        ...next[index],
        audioIdentifier: ids[0],
        isPlaying: true,
        isLoop: !!isLoopSingle,
        queue: [],
        queueMode: 'single',
      };
    }
    this.tracks = next;
    this.syncLegacyFields();
    this._playTrack(index);
  }

  stopTrack(index: number) {
    if (index < 0 || index >= JUKEBOX_TRACK_COUNT) return;
    this.ensureMigrated();
    const next = this.tracks;
    next[index] = {
      ...next[index],
      audioIdentifier: next[index].audioIdentifier,
      isPlaying: false,
      queue: [],
      queueMode: 'single',
    };
    this.tracks = next;
    this.syncLegacyFields();
    this._stopTrack(index);
  }

  /** Stop and clear assigned audio. */
  clearTrack(index: number) {
    if (index < 0 || index >= JUKEBOX_TRACK_COUNT) return;
    this.ensureMigrated();
    const next = this.tracks;
    next[index] = { ...emptyTrack(), roomGain: next[index].roomGain, label: next[index].label };
    this.tracks = next;
    this.syncLegacyFields();
    this._stopTrack(index);
  }

  stopAll() {
    this.ensureMigrated();
    this.tracks = normalizeTracks([]).map((t, i) => ({
      ...t,
      isPlaying: false,
      audioIdentifier: '',
      queue: [],
      queueMode: 'single' as JukeboxQueueMode,
      roomGain: this.tracks[i]?.roomGain ?? 1,
      label: this.tracks[i]?.label ?? '',
    }));
    this.syncLegacyFields();
    this.stopAllLocal();
  }

  setTrackRoomGain(index: number, roomGain: number) {
    if (index < 0 || index >= JUKEBOX_TRACK_COUNT) return;
    this.ensureMigrated();
    const next = this.tracks;
    next[index] = {
      ...next[index],
      roomGain: Math.max(0, Math.min(1, roomGain)),
    };
    this.tracks = next;
    this.applyRoomGain(index);
  }

  setTrackLabel(index: number, label: string) {
    if (index < 0 || index >= JUKEBOX_TRACK_COUNT) return;
    this.ensureMigrated();
    const next = this.tracks;
    next[index] = { ...next[index], label: label || '' };
    this.tracks = next;
  }

  /** Toggle play/stop for a track that already has an assigned audio (HUD). */
  toggleTrackPlayback(index: number) {
    if (index < 0 || index >= JUKEBOX_TRACK_COUNT) return;
    const track = this.tracks[index];
    if (!track?.audioIdentifier) return;
    if (track.isPlaying) {
      this.stopTrack(index);
      return;
    }
    this.playTrack(index, track.audioIdentifier, track.isLoop !== false);
  }

  snapshotTracksJson(): string {
    this.ensureMigrated();
    return this.tracksJson || JSON.stringify(normalizeTracks([]));
  }

  applyTracksSnapshot(tracksJson: string) {
    this.ensureMigrated();
    const prev = this.tracks;
    const next = normalizeTracks(tracksJson ? JSON.parse(tracksJson) : []);
    this.tracks = next;
    this.syncLegacyFields();
    for (let i = 0; i < JUKEBOX_TRACK_COUNT; i++) {
      const was = prev[i];
      const now = next[i];
      if (now.isPlaying && (was.audioIdentifier !== now.audioIdentifier || !was.isPlaying || was.isLoop !== now.isLoop)) {
        this._playTrack(i);
      } else if (was.isPlaying && !now.isPlaying) {
        this._stopTrack(i);
      } else if (now.isPlaying && was.roomGain !== now.roomGain) {
        this.applyRoomGain(i);
      }
    }
  }

  apply(context: ObjectContext) {
    const prev = this.tracks;
    const prevJson = this.tracksJson;
    const prevLegacyPlaying = this.isPlaying;
    const prevLegacyId = this.audioIdentifier;
    super.apply(context);
    this.ensureMigrated(true);

    if (prevJson !== this.tracksJson || prevLegacyPlaying !== this.isPlaying || prevLegacyId !== this.audioIdentifier) {
      const next = this.tracks;
      for (let i = 0; i < JUKEBOX_TRACK_COUNT; i++) {
        const was = prev[i] || emptyTrack();
        const now = next[i];
        if (now.isPlaying && (was.audioIdentifier !== now.audioIdentifier || !was.isPlaying)) {
          this._playTrack(i);
        } else if (was.isPlaying && !now.isPlaying) {
          this._stopTrack(i);
        } else if (now.isPlaying && was.roomGain !== now.roomGain) {
          this.applyRoomGain(i);
        } else if (now.isPlaying && was.isLoop !== now.isLoop) {
          this.ensurePlayer(i);
          this.audioPlayers[i].loop = now.isLoop;
        }
      }
    }
  }

  /** Create AudioPlayers lazily up to index (classic rooms stay player-free until first play). */
  private ensurePlayer(index: number) {
    if (index < 0 || index >= JUKEBOX_TRACK_COUNT) return;
    while (this.audioPlayers.length <= index) {
      const i = this.audioPlayers.length;
      const player = new AudioPlayer();
      player.volumeType = i === 0 ? VolumeType.MASTER : VolumeType.AMBIENT;
      this.audioPlayers.push(player);
    }
    while (this.waitingFileUpdate.length <= index) {
      this.waitingFileUpdate.push(false);
    }
  }

  private ensureMigrated(fromApply = false) {
    if (this.tracksJson) {
      try {
        const parsed = JSON.parse(this.tracksJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.migrated = true;
          // Normalize length when room track count differs from JUKEBOX_TRACK_COUNT.
          if (parsed.length !== JUKEBOX_TRACK_COUNT) {
            this.tracksJson = JSON.stringify(normalizeTracks(parsed));
          }
          return;
        }
      } catch { /* fall through */ }
    }
    if (this.migrated && this.tracksJson) return;
    const migrated = normalizeTracks([]);
    if (this.audioIdentifier || this.isPlaying) {
      migrated[0] = {
        ...migrated[0],
        audioIdentifier: this.audioIdentifier || '',
        isPlaying: !!this.isPlaying,
        isLoop: this.isLoop !== false,
      };
    }
    this.tracksJson = JSON.stringify(migrated);
    this.migrated = true;
    if (!fromApply && migrated[0].isPlaying) {
      this._playTrack(0);
    }
  }

  private syncLegacyFields() {
    const t0 = this.tracks[0];
    this.audioIdentifier = t0.audioIdentifier;
    this.isPlaying = t0.isPlaying;
    this.isLoop = t0.isLoop;
  }

  private _playTrack(index: number) {
    this.ensurePlayer(index);
    this._stopTrack(index, false);
    const track = this.tracks[index];
    const audio = track.audioIdentifier ? AudioStorage.instance.get(track.audioIdentifier) : null;
    if (!audio || !audio.isReady) {
      this.playAfterFileUpdate(index);
      return;
    }
    const player = this.audioPlayers[index];
    player.loop = track.isLoop;
    player.volume = track.roomGain;
    player.endedAction = () => this.onTrackEnded(index);
    player.play(audio);
  }

  private onTrackEnded(index: number) {
    const track = this.tracks[index];
    if (!track || !track.isPlaying) return;

    if (
      track.queueMode === 'shuffle-loop' || track.queueMode === 'shuffle-once'
      || track.queueMode === 'queue-loop' || track.queueMode === 'queue-once'
    ) {
      const queue = track.queue.slice();
      if (queue.length < 1) {
        this.stopTrack(index);
        return;
      }
      const cur = track.audioIdentifier;
      let nextIdx = queue.indexOf(cur) + 1;
      let nextQueue = queue;
      if (nextIdx >= queue.length) {
        if (track.queueMode === 'shuffle-once' || track.queueMode === 'queue-once') {
          this.stopTrack(index);
          return;
        }
        if (track.queueMode === 'shuffle-loop') nextQueue = shuffleIds(queue);
        nextIdx = 0;
      }
      const nextId = nextQueue[nextIdx];
      const next = this.tracks;
      next[index] = {
        ...next[index],
        queue: nextQueue,
        audioIdentifier: nextId,
        isPlaying: true,
        isLoop: false,
        queueMode: track.queueMode,
      };
      this.tracks = next;
      this.syncLegacyFields();
      this._playTrack(index);
      return;
    }

    // single once
    if (!track.isLoop) {
      const assigned = track.audioIdentifier;
      this.stopTrack(index);
      if (assigned) this.setTrackAudio(index, assigned);
    }
  }

  private _stopTrack(index: number, unregister = true) {
    if (unregister) this.unregisterFileWait(index);
    if (this.audioPlayers[index]) {
      this.audioPlayers[index].endedAction = null;
      this.audioPlayers[index].stop();
    }
  }

  private stopAllLocal() {
    for (let i = 0; i < JUKEBOX_TRACK_COUNT; i++) this._stopTrack(i);
  }

  private applyRoomGain(index: number) {
    this.ensurePlayer(index);
    const track = this.tracks[index];
    if (this.audioPlayers[index]) {
      this.audioPlayers[index].volume = track.roomGain;
    }
  }

  private playAfterFileUpdate(index: number) {
    this.ensurePlayer(index);
    if (this.waitingFileUpdate[index]) return;
    this.waitingFileUpdate[index] = true;
    const key = `jukebox-track-${index}`;
    EventSystem.register(key)
      .on('UPDATE_AUDIO_RESOURE', event => {
        if (!this.tracks[index]?.isPlaying) {
          this.unregisterFileWait(index);
          return;
        }
        const audio = this.audioAt(index);
        if (audio && audio.isReady) {
          this.unregisterFileWait(index);
          this._playTrack(index);
        }
      });
  }

  private unregisterFileWait(index: number) {
    if (index >= 0 && index < this.waitingFileUpdate.length) {
      this.waitingFileUpdate[index] = false;
    }
    EventSystem.unregister(`jukebox-track-${index}`, 'UPDATE_AUDIO_RESOURE');
  }

  private unlockAfterUserInteraction() {
    const callback = () => {
      document.body.removeEventListener('touchstart', callback, true);
      document.body.removeEventListener('mousedown', callback, true);
      for (let i = 0; i < JUKEBOX_TRACK_COUNT; i++) {
        if (!this.tracks[i]?.isPlaying) continue;
        this.ensurePlayer(i);
        this.audioPlayers[i].stop();
        this._playTrack(i);
      }
      // Weather SE is local-only (not tracksJson.isPlaying); ask service to retry.
      EventSystem.trigger('JUKEBOX_AUDIO_UNLOCKED', null);
    };
    document.body.addEventListener('touchstart', callback, true);
    document.body.addEventListener('mousedown', callback, true);
  }
}
