import { AudioFile } from './core/file-storage/audio-file';
import { AudioPlayer, VolumeType } from './core/file-storage/audio-player';
import { AudioStorage } from './core/file-storage/audio-storage';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { GameObject, ObjectContext } from './core/synchronize-object/game-object';
import { EventSystem } from './core/system';

export const JUKEBOX_TRACK_COUNT = 4;

export interface JukeboxTrackState {
  audioIdentifier: string;
  isPlaying: boolean;
  isLoop: boolean;
  roomGain: number;
  label: string;
}

function emptyTrack(): JukeboxTrackState {
  return { audioIdentifier: '', isPlaying: false, isLoop: true, roomGain: 1, label: '' };
}

function normalizeTracks(raw: any): JukeboxTrackState[] {
  const list: JukeboxTrackState[] = [];
  const src = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < JUKEBOX_TRACK_COUNT; i++) {
    const t = src[i] || {};
    list.push({
      audioIdentifier: typeof t.audioIdentifier === 'string' ? t.audioIdentifier : '',
      isPlaying: !!t.isPlaying,
      isLoop: t.isLoop !== false,
      roomGain: typeof t.roomGain === 'number' && isFinite(t.roomGain)
        ? Math.max(0, Math.min(1, t.roomGain))
        : 1,
      label: typeof t.label === 'string' ? t.label : '',
    });
  }
  return list;
}

@SyncObject('jukebox')
export class Jukebox extends GameObject {
  /** @deprecated Legacy single-track fields; migrated into tracksJson track0. */
  @SyncVar() audioIdentifier: string = '';
  @SyncVar() startTime: number = 0;
  @SyncVar() isLoop: boolean = false;
  @SyncVar() isPlaying: boolean = false;

  @SyncVar() tracksJson: string = '';

  private audioPlayers: AudioPlayer[] = [];
  private waitingFileUpdate: boolean[] = [];
  private migrated = false;

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
    this.ensurePlayers();
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
    };
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
      audioIdentifier: '',
      isPlaying: false,
    };
    this.tracks = next;
    this.syncLegacyFields();
    this._stopTrack(index);
  }

  stopAll() {
    this.ensureMigrated();
    this.tracks = normalizeTracks([]).map(t => ({ ...t, isPlaying: false, audioIdentifier: '' }));
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
    this.ensurePlayers();
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
          this.audioPlayers[i].loop = now.isLoop;
        }
      }
    }
  }

  private ensurePlayers() {
    if (this.audioPlayers.length === JUKEBOX_TRACK_COUNT) return;
    this.audioPlayers = [];
    this.waitingFileUpdate = [];
    for (let i = 0; i < JUKEBOX_TRACK_COUNT; i++) {
      const player = new AudioPlayer();
      player.volumeType = i === 0 ? VolumeType.MASTER : VolumeType.AMBIENT;
      this.audioPlayers.push(player);
      this.waitingFileUpdate.push(false);
    }
  }

  private ensureMigrated(fromApply = false) {
    if (this.migrated && this.tracksJson) return;
    if (this.tracksJson) {
      try {
        const parsed = JSON.parse(this.tracksJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.migrated = true;
          if (parsed.length !== JUKEBOX_TRACK_COUNT) {
            this.tracksJson = JSON.stringify(normalizeTracks(parsed));
          }
          return;
        }
      } catch { /* fall through */ }
    }
    // Migrate legacy single-track SyncVars into track0.
    const migrated = normalizeTracks([]);
    if (this.audioIdentifier || this.isPlaying) {
      migrated[0] = {
        audioIdentifier: this.audioIdentifier || '',
        isPlaying: !!this.isPlaying,
        isLoop: this.isLoop !== false,
        roomGain: 1,
        label: '',
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
    this.ensurePlayers();
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
    player.play(audio);
  }

  private _stopTrack(index: number, unregister = true) {
    this.ensurePlayers();
    if (unregister) this.unregisterFileWait(index);
    this.audioPlayers[index]?.stop();
  }

  private stopAllLocal() {
    for (let i = 0; i < JUKEBOX_TRACK_COUNT; i++) this._stopTrack(i);
  }

  private applyRoomGain(index: number) {
    this.ensurePlayers();
    const track = this.tracks[index];
    if (this.audioPlayers[index]) {
      this.audioPlayers[index].volume = track.roomGain;
    }
  }

  private playAfterFileUpdate(index: number) {
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
    this.waitingFileUpdate[index] = false;
    EventSystem.unregister(`jukebox-track-${index}`, 'UPDATE_AUDIO_RESOURE');
  }

  private unlockAfterUserInteraction() {
    const callback = () => {
      document.body.removeEventListener('touchstart', callback, true);
      document.body.removeEventListener('mousedown', callback, true);
      this.ensurePlayers();
      for (let i = 0; i < JUKEBOX_TRACK_COUNT; i++) {
        this.audioPlayers[i].stop();
        if (this.tracks[i]?.isPlaying) this._playTrack(i);
      }
    };
    document.body.addEventListener('touchstart', callback, true);
    document.body.addEventListener('mousedown', callback, true);
  }
}
