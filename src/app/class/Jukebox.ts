import { AudioFile } from './core/file-storage/audio-file';
import { AudioPlayer, VolumeType } from './core/file-storage/audio-player';
import { AudioStorage } from './core/file-storage/audio-storage';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { GameObject, ObjectContext } from './core/synchronize-object/game-object';
import { InnerXml } from './core/synchronize-object/object-serializer';
import { ObjectStore } from './core/synchronize-object/object-store';
import { EventSystem } from './core/system';

export const JUKEBOX_TRACK_COUNT = 5;
/** Local-only weather SE slot (index 4 / track 5). Does not sync tracksJson. */
export const JUKEBOX_WEATHER_TRACK = 4;
/** Highest index that supports room-synced pause/scrub/fade (tracks 0–3). */
export const JUKEBOX_TRANSPORT_MAX = 3;
export const MUSIC_HUD_SLOT_COUNT = 3;
export const SOUNDBOARD_SLOT_COUNT = 8;
export const JUKEBOX_DUCK_FACTOR = 0.25;

export type JukeboxQueueMode =
  | 'single'
  | 'shuffle-loop'
  | 'shuffle-once'
  | 'queue-loop'
  | 'queue-once';

export interface JukeboxTrackState {
  audioIdentifier: string;
  isPlaying: boolean;
  isPaused: boolean;
  currentTime: number;
  isLoop: boolean;
  roomGain: number;
  label: string;
  queue: string[];
  queueMode: JukeboxQueueMode;
}

export interface SoundboardSlot {
  audioIdentifier: string;
  label: string;
}

function emptyTrack(): JukeboxTrackState {
  return {
    audioIdentifier: '',
    isPlaying: false,
    isPaused: false,
    currentTime: 0,
    isLoop: true,
    roomGain: 1,
    label: '',
    queue: [],
    queueMode: 'single',
  };
}

function emptyPad(): SoundboardSlot {
  return { audioIdentifier: '', label: '' };
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
    const isPlaying = !!t.isPlaying;
    list.push({
      audioIdentifier: typeof t.audioIdentifier === 'string' ? t.audioIdentifier : '',
      isPlaying,
      isPaused: isPlaying && !!t.isPaused && i <= JUKEBOX_TRANSPORT_MAX,
      currentTime: typeof t.currentTime === 'number' && isFinite(t.currentTime)
        ? Math.max(0, t.currentTime)
        : 0,
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

function normalizeSoundboard(raw: any): SoundboardSlot[] {
  const src = Array.isArray(raw) ? raw : [];
  const list: SoundboardSlot[] = [];
  for (let i = 0; i < SOUNDBOARD_SLOT_COUNT; i++) {
    const s = src[i] || {};
    list.push({
      audioIdentifier: typeof s.audioIdentifier === 'string' ? s.audioIdentifier : '',
      label: typeof s.label === 'string' ? s.label : '',
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

function clampTrackFadeSec(sec: number): number {
  if (!isFinite(sec)) return 2.5;
  return Math.max(0, Math.min(15, Math.round(sec * 10) / 10));
}

@SyncObject('jukebox')
export class Jukebox extends GameObject implements InnerXml {
  /** @deprecated Legacy single-track fields; migrated into tracksJson track0. */
  @SyncVar() audioIdentifier: string = '';
  @SyncVar() startTime: number = 0;
  @SyncVar() isLoop: boolean = false;
  @SyncVar() isPlaying: boolean = false;

  @SyncVar() tracksJson: string = '';

  /**
   * Room-synced weather SE loop crossfade (seconds).
   * Applies to every client's local WeatherLoopPlayer.
   */
  @SyncVar() weatherLoopOverlapSec: number = 6;

  /** Room-synced fade / crossfade seconds for tracks 0–3 (0 = hard cut). */
  @SyncVar() trackFadeSec: number = 2.5;

  /** Room-synced soundboard pads (8 slots). */
  @SyncVar() soundboardJson: string = '';

  private audioPlayers: AudioPlayer[] = [];
  /** Outgoing player during crossfade (per track). */
  private crossfadePlayers: (AudioPlayer | null)[] = [];
  private waitingFileUpdate: boolean[] = [];
  private migrated = false;
  private duckRefCount = 0;

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

  get soundboard(): SoundboardSlot[] {
    try {
      return normalizeSoundboard(this.soundboardJson ? JSON.parse(this.soundboardJson) : []);
    } catch {
      return normalizeSoundboard([]);
    }
  }

  set soundboard(value: SoundboardSlot[]) {
    this.soundboardJson = JSON.stringify(normalizeSoundboard(value));
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
      this._stopTrack(index, false, true);
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
    this._stopTrack(index, true, true);
  }

  /** True when the local player for a track is currently audible (not paused). */
  isLocalPlaying(index: number): boolean {
    if (index < 0 || index >= this.audioPlayers.length) return false;
    const player = this.audioPlayers[index];
    return !!(player && !player.paused);
  }

  /** Local playback clock for UI progress (0 if idle). */
  localCurrentTime(index: number): number {
    if (index < 0 || index >= this.audioPlayers.length) return 0;
    return this.audioPlayers[index]?.currentTime ?? 0;
  }

  localDuration(index: number): number {
    if (index < 0 || index >= this.audioPlayers.length) return 0;
    return this.audioPlayers[index]?.duration ?? 0;
  }

  /** Clamp and publish weather SE crossfade seconds (room-synced). */
  setWeatherLoopOverlapSec(sec: number) {
    const n = typeof sec === 'number' ? sec : Number(sec);
    if (!isFinite(n)) return;
    const clamped = Math.max(0, Math.min(30, Math.round(n * 10) / 10));
    if (this.weatherLoopOverlapSec === clamped) return;
    this.weatherLoopOverlapSec = clamped;
  }

  setTrackFadeSec(sec: number) {
    const clamped = clampTrackFadeSec(typeof sec === 'number' ? sec : Number(sec));
    if (this.trackFadeSec === clamped) return;
    this.trackFadeSec = clamped;
  }

  get effectiveTrackFadeSec(): number {
    return clampTrackFadeSec(this.trackFadeSec);
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
    const prev = this.tracks[index];
    const switching = !!(prev?.isPlaying && prev.audioIdentifier && prev.audioIdentifier !== identifier);
    const next = this.tracks;
    next[index] = {
      ...next[index],
      audioIdentifier: identifier,
      isPlaying: true,
      isPaused: false,
      currentTime: 0,
      isLoop: !!isLoop,
      queue: [],
      queueMode: 'single',
    };
    this.tracks = next;
    this.syncLegacyFields();
    this._playTrack(index, { crossfade: switching && index <= JUKEBOX_TRANSPORT_MAX });
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
        isPaused: false,
        currentTime: 0,
        isLoop: false,
        queue,
        queueMode: mode,
      };
      this.tracks = next;
      this.syncLegacyFields();
      this._playTrack(index, { crossfade: index <= JUKEBOX_TRANSPORT_MAX && !!this.audioPlayers[index] && !this.audioPlayers[index].paused });
      return;
    } else {
      next[index] = {
        ...next[index],
        audioIdentifier: ids[0],
        isPlaying: true,
        isPaused: false,
        currentTime: 0,
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
      isPaused: false,
      currentTime: 0,
      queue: [],
      queueMode: 'single',
    };
    this.tracks = next;
    this.syncLegacyFields();
    this._stopTrack(index, true, false);
  }

  /** Pause a transport track (0–3); room-synced. */
  pauseTrack(index: number) {
    if (index < 0 || index > JUKEBOX_TRANSPORT_MAX) return;
    this.ensureMigrated();
    const track = this.tracks[index];
    if (!track?.isPlaying || track.isPaused) return;
    this.ensurePlayer(index);
    const t = this.audioPlayers[index]?.currentTime ?? track.currentTime ?? 0;
    this.audioPlayers[index]?.pause();
    const next = this.tracks;
    next[index] = { ...next[index], isPaused: true, currentTime: t };
    this.tracks = next;
    this.syncLegacyFields();
  }

  /** Resume a paused transport track; room-synced. */
  resumeTrack(index: number) {
    if (index < 0 || index > JUKEBOX_TRANSPORT_MAX) return;
    this.ensureMigrated();
    const track = this.tracks[index];
    if (!track?.isPlaying || !track.isPaused) return;
    const next = this.tracks;
    next[index] = { ...next[index], isPaused: false };
    this.tracks = next;
    this.syncLegacyFields();
    this.ensurePlayer(index);
    const player = this.audioPlayers[index];
    if (player && !player.paused) return;
    if (player && player.audio?.identifier === track.audioIdentifier) {
      player.currentTime = track.currentTime || 0;
      player.resume();
      return;
    }
    this._playTrack(index, { startAt: track.currentTime || 0, fadeIn: false });
  }

  /** Seek a transport track; room-synced. */
  seekTrack(index: number, time: number) {
    if (index < 0 || index > JUKEBOX_TRANSPORT_MAX) return;
    this.ensureMigrated();
    const track = this.tracks[index];
    if (!track?.audioIdentifier) return;
    const t = Math.max(0, isFinite(time) ? time : 0);
    this.ensurePlayer(index);
    if (this.audioPlayers[index]) this.audioPlayers[index].currentTime = t;
    const next = this.tracks;
    next[index] = { ...next[index], currentTime: t };
    this.tracks = next;
  }

  /** Stop and clear assigned audio. */
  clearTrack(index: number) {
    if (index < 0 || index >= JUKEBOX_TRACK_COUNT) return;
    this.ensureMigrated();
    const next = this.tracks;
    next[index] = { ...emptyTrack(), roomGain: next[index].roomGain, label: next[index].label };
    this.tracks = next;
    this.syncLegacyFields();
    this._stopTrack(index, true, true);
  }

  stopAll() {
    this.ensureMigrated();
    this.tracks = normalizeTracks([]).map((t, i) => ({
      ...t,
      isPlaying: false,
      isPaused: false,
      currentTime: 0,
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

  setSoundboardSlot(index: number, audioIdentifier: string, label = '') {
    if (index < 0 || index >= SOUNDBOARD_SLOT_COUNT) return;
    const next = this.soundboard;
    next[index] = {
      audioIdentifier: audioIdentifier || '',
      label: label || '',
    };
    this.soundboard = next;
  }

  clearSoundboardSlot(index: number) {
    this.setSoundboardSlot(index, '', '');
  }

  /** Toggle play/stop for a track that already has an assigned audio (HUD). */
  toggleTrackPlayback(index: number) {
    if (index < 0 || index >= JUKEBOX_TRACK_COUNT) return;
    const track = this.tracks[index];
    if (!track?.audioIdentifier) return;
    if (track.isPlaying && !track.isPaused) {
      if (index <= JUKEBOX_TRANSPORT_MAX) this.pauseTrack(index);
      else this.stopTrack(index);
      return;
    }
    if (track.isPlaying && track.isPaused) {
      this.resumeTrack(index);
      return;
    }
    this.playTrack(index, track.audioIdentifier, track.isLoop !== false);
  }

  beginDuck() {
    this.duckRefCount++;
    if (this.duckRefCount === 1) this.applyDuckFactors();
  }

  endDuck() {
    if (this.duckRefCount < 1) return;
    this.duckRefCount--;
    if (this.duckRefCount === 0) this.applyDuckFactors();
  }

  get isDucked(): boolean {
    return this.duckRefCount > 0;
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
        const switching = was.isPlaying && was.audioIdentifier !== now.audioIdentifier;
        this._playTrack(i, {
          crossfade: switching && i <= JUKEBOX_TRANSPORT_MAX,
          startAt: now.currentTime || 0,
          paused: now.isPaused,
        });
      } else if (was.isPlaying && !now.isPlaying) {
        this._stopTrack(i, true, false);
      } else if (now.isPlaying && was.roomGain !== now.roomGain) {
        this.applyRoomGain(i);
      } else if (now.isPlaying) {
        this.syncTransportLocal(i, was, now);
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
          const switching = was.isPlaying && was.audioIdentifier !== now.audioIdentifier;
          this._playTrack(i, {
            crossfade: switching && i <= JUKEBOX_TRANSPORT_MAX,
            startAt: now.currentTime || 0,
            paused: now.isPaused,
            fadeIn: !was.isPlaying,
          });
        } else if (was.isPlaying && !now.isPlaying) {
          this._stopTrack(i, true, false);
        } else if (now.isPlaying && was.roomGain !== now.roomGain) {
          this.applyRoomGain(i);
        } else if (now.isPlaying && was.isLoop !== now.isLoop) {
          this.ensurePlayer(i);
          this.audioPlayers[i].loop = now.isLoop;
        } else if (now.isPlaying) {
          this.syncTransportLocal(i, was, now);
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
      player.setDuckFactor(this.duckRefCount > 0 && i <= JUKEBOX_TRANSPORT_MAX ? JUKEBOX_DUCK_FACTOR : 1);
      this.audioPlayers.push(player);
    }
    while (this.crossfadePlayers.length <= index) this.crossfadePlayers.push(null);
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

  private syncTransportLocal(index: number, was: JukeboxTrackState, now: JukeboxTrackState) {
    if (index > JUKEBOX_TRANSPORT_MAX) return;
    this.ensurePlayer(index);
    const player = this.audioPlayers[index];
    if (!player) return;

    if (was.isPaused !== now.isPaused) {
      if (now.isPaused) {
        player.pause();
      } else {
        player.currentTime = now.currentTime || 0;
        player.resume();
      }
    } else if (Math.abs((was.currentTime || 0) - (now.currentTime || 0)) > 0.35) {
      player.currentTime = now.currentTime || 0;
    }
  }

  private _playTrack(
    index: number,
    opts: { crossfade?: boolean; startAt?: number; paused?: boolean; fadeIn?: boolean } = {},
  ) {
    this.ensurePlayer(index);
    const track = this.tracks[index];
    const audio = track.audioIdentifier ? AudioStorage.instance.get(track.audioIdentifier) : null;
    if (!audio || !audio.isReady) {
      this.playAfterFileUpdate(index);
      return;
    }

    const fadeSec = index <= JUKEBOX_TRANSPORT_MAX ? this.effectiveTrackFadeSec : 0;
    const useCrossfade = !!(opts.crossfade && fadeSec > 0 && this.audioPlayers[index] && !this.audioPlayers[index].paused);
    const fadeIn = opts.fadeIn !== false && index <= JUKEBOX_TRANSPORT_MAX && fadeSec > 0 && !opts.paused;

    if (useCrossfade) {
      this.beginCrossfade(index, audio, track, opts.startAt || 0);
      return;
    }

    this.disposeCrossfade(index);
    const player = this.audioPlayers[index];
    player.endedAction = null;
    player.loop = track.isLoop;
    player.volume = track.roomGain;
    player.setDuckFactor(this.duckRefCount > 0 && index <= JUKEBOX_TRANSPORT_MAX ? JUKEBOX_DUCK_FACTOR : 1);
    player.endedAction = () => this.onTrackEnded(index);

    if (fadeIn) {
      player.playWithFadeIn(audio, fadeSec, opts.startAt || 0);
    } else {
      player.play(audio);
      if (opts.startAt) player.currentTime = opts.startAt;
    }

    if (opts.paused) {
      // Allow element to load then pause.
      window.setTimeout(() => {
        if (!this.tracks[index]?.isPaused) return;
        player.currentTime = opts.startAt || this.tracks[index].currentTime || 0;
        player.pause();
      }, 80);
    }
  }

  private beginCrossfade(index: number, audio: AudioFile, track: JukeboxTrackState, startAt: number) {
    const fadeSec = this.effectiveTrackFadeSec;
    const outgoing = this.audioPlayers[index];
    outgoing.endedAction = null;

    const incoming = new AudioPlayer();
    incoming.volumeType = index === 0 ? VolumeType.MASTER : VolumeType.AMBIENT;
    incoming.loop = track.isLoop;
    incoming.volume = track.roomGain;
    incoming.setDuckFactor(this.duckRefCount > 0 ? JUKEBOX_DUCK_FACTOR : 1);
    incoming.endedAction = () => this.onTrackEnded(index);

    this.disposeCrossfade(index);
    this.crossfadePlayers[index] = outgoing;
    this.audioPlayers[index] = incoming;

    incoming.playWithFadeIn(audio, fadeSec, startAt);
    void outgoing.stopWithFadeOut(fadeSec).then(() => {
      if (this.crossfadePlayers[index] === outgoing) this.crossfadePlayers[index] = null;
    });
  }

  private disposeCrossfade(index: number) {
    const xf = this.crossfadePlayers[index];
    if (!xf) return;
    xf.endedAction = null;
    xf.stop();
    this.crossfadePlayers[index] = null;
  }

  private onTrackEnded(index: number) {
    const track = this.tracks[index];
    if (!track || !track.isPlaying || track.isPaused) return;

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
        isPaused: false,
        currentTime: 0,
        isLoop: false,
        queueMode: track.queueMode,
      };
      this.tracks = next;
      this.syncLegacyFields();
      this._playTrack(index, { crossfade: index <= JUKEBOX_TRANSPORT_MAX });
      return;
    }

    // single once
    if (!track.isLoop) {
      const assigned = track.audioIdentifier;
      this.stopTrack(index);
      if (assigned) this.setTrackAudio(index, assigned);
    }
  }

  private _stopTrack(index: number, unregister = true, hard = false) {
    if (unregister) this.unregisterFileWait(index);
    this.disposeCrossfade(index);
    if (!this.audioPlayers[index]) return;
    const player = this.audioPlayers[index];
    player.endedAction = null;
    const fadeSec = !hard && index <= JUKEBOX_TRANSPORT_MAX ? this.effectiveTrackFadeSec : 0;
    if (fadeSec > 0 && !player.paused) {
      void player.stopWithFadeOut(fadeSec);
    } else {
      player.stop();
    }
  }

  private stopAllLocal() {
    for (let i = 0; i < JUKEBOX_TRACK_COUNT; i++) this._stopTrack(i, true, true);
  }

  private applyRoomGain(index: number) {
    this.ensurePlayer(index);
    const track = this.tracks[index];
    if (this.audioPlayers[index]) {
      this.audioPlayers[index].volume = track.roomGain;
    }
    if (this.crossfadePlayers[index]) {
      this.crossfadePlayers[index].volume = track.roomGain;
    }
  }

  private applyDuckFactors() {
    const factor = this.duckRefCount > 0 ? JUKEBOX_DUCK_FACTOR : 1;
    const fadeSec = this.effectiveTrackFadeSec;
    for (let i = 0; i <= JUKEBOX_TRANSPORT_MAX; i++) {
      if (!this.audioPlayers[i]) continue;
      // Snap duck factor; perceptual ramp via playbackFactor would fight track fades.
      this.audioPlayers[i].setDuckFactor(factor);
      if (this.crossfadePlayers[i]) this.crossfadePlayers[i].setDuckFactor(factor);
      if (fadeSec > 0) {
        // Mild soften when engaging/releasing duck by nudging playbackFactor briefly.
        void this.audioPlayers[i].fadePlaybackFactorTo(1, Math.min(fadeSec, 1.5));
      }
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
          const t = this.tracks[index];
          this._playTrack(index, { startAt: t.currentTime || 0, paused: t.isPaused });
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
        const t = this.tracks[i];
        this._playTrack(i, { startAt: t.currentTime || 0, paused: t.isPaused, fadeIn: false });
      }
      // Weather SE is local-only (not tracksJson.isPlaying); ask service to retry.
      EventSystem.trigger('JUKEBOX_AUDIO_UNLOCKED', null);
    };
    document.body.addEventListener('touchstart', callback, true);
    document.body.addEventListener('mousedown', callback, true);
  }
}
