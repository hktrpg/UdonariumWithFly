import { AudioFile, AudioState } from './audio-file';
import { FileReaderUtil } from './file-reader-util';

export enum VolumeType {
  MASTER,
  AUDITION,
  SOUND_EFFECT,
  NOTICE,
  AMBIENT
}

declare global {
  interface Window {
    AudioContext: typeof AudioContext;
    webkitAudioContext: typeof AudioContext;
  }
}

type AudioCache = { url: string, blob: Blob };

export class AudioPlayer {

  static readonly AUDITION_VOLUME_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-audition-volume-local-storage';
  static readonly MAIN_VOLUME_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-main-volume-local-storage';
  static readonly SOUND_EFFECT_VOLUME_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-sound-effect-volume-local-storage';
  static readonly NOTICE_VOLUME_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-notice-volume-local-storage';
  static readonly AMBIENT_VOLUME_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-ambient-volume-local-storage';

  static readonly AUDITION_IS_MUTE_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-audition-is-mute-local-storage';
  static readonly MAIN_IS_MUTE_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-main-is-mute-local-storage';
  static readonly SOUND_EFFECT_IS_MUTE_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-sound-effect-is-mute-local-storage';
  static readonly NOTICE_IS_MUTE_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-notice-is-mute-local-storage';
  static readonly AMBIENT_IS_MUTE_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-ambient-is-mute-local-storage';

  private static _audioContext: AudioContext;
  static get audioContext(): AudioContext {
    if (!AudioPlayer._audioContext) AudioPlayer._audioContext = new (window.AudioContext || window.webkitAudioContext)();
    return AudioPlayer._audioContext;
  }

  private static _isMute: boolean = false;
  static get isMute(): boolean { return AudioPlayer._isMute; }
  static set isMute(isMute: boolean) {
    AudioPlayer._isMute = isMute;
    AudioPlayer.volume = AudioPlayer._volume;
  }

  /** Players using element-direct playback (cross-origin URL without CORS). */
  private static elementDirectPlayers = new Set<AudioPlayer>();

  private static refreshElementDirectVolumes() {
    for (const player of AudioPlayer.elementDirectPlayers) {
      player.applyElementVolume();
    }
  }

  private static _volume: number = 0.5;
  static get volume(): number { return AudioPlayer._volume; }
  static set volume(volume: number) {
    AudioPlayer._volume = volume;
    if (AudioPlayer._masterGainNode) {
      AudioPlayer._masterGainNode.gain.setTargetAtTime(AudioPlayer.isMute ? 0 : AudioPlayer._volume, AudioPlayer.audioContext.currentTime, 0.01);
    }
    AudioPlayer.refreshElementDirectVolumes();
  }

  private static _isAuditionMute: boolean = false;
  static get isAuditionMute(): boolean { return AudioPlayer._isAuditionMute; }
  static set isAuditionMute(isAuditionMute: boolean) {
    AudioPlayer._isAuditionMute = isAuditionMute;
    AudioPlayer.auditionVolume = AudioPlayer._auditionVolume;
  }

  private static _auditionVolume: number = 0.5;
  static get auditionVolume(): number { return AudioPlayer._auditionVolume; }
  static set auditionVolume(auditionVolume: number) {
    AudioPlayer._auditionVolume = auditionVolume;
    if (AudioPlayer._auditionGainNode) {
      AudioPlayer._auditionGainNode.gain.setTargetAtTime(AudioPlayer.isAuditionMute ? 0 : AudioPlayer._auditionVolume, AudioPlayer.audioContext.currentTime, 0.01);
    }
    AudioPlayer.refreshElementDirectVolumes();
  }

  private static _isSoundEffectMute: boolean = false;
  static get isSoundEffectMute(): boolean { return AudioPlayer._isSoundEffectMute; }
  static set isSoundEffectMute(isSoundEffectMute: boolean) { 
    AudioPlayer._isSoundEffectMute = isSoundEffectMute; 
    AudioPlayer.soundEffectVolume = AudioPlayer._soundEffectVolume;
  }

  private static _soundEffectVolume: number = 0.5;
  static get soundEffectVolume(): number { return AudioPlayer._soundEffectVolume; }
  static set soundEffectVolume(soundEffectVolume: number) {
    AudioPlayer._soundEffectVolume = soundEffectVolume;
    if (AudioPlayer._soundEffectGainNode) {
      AudioPlayer._soundEffectGainNode.gain.setTargetAtTime(AudioPlayer.isSoundEffectMute ? 0 : AudioPlayer._soundEffectVolume, AudioPlayer.audioContext.currentTime, 0.01);
    }
    AudioPlayer.refreshElementDirectVolumes();
  }

  private static _isNoticeMute: boolean = false;
  static get isNoticeMute(): boolean { return AudioPlayer._isNoticeMute; }
  static set isNoticeMute(isNoticeMute: boolean) { 
    AudioPlayer._isNoticeMute = isNoticeMute;
    AudioPlayer.noticeVolume = AudioPlayer._noticeVolume;
  }

  private static _noticeVolume: number = 0.5;
  static get noticeVolume(): number { return AudioPlayer._noticeVolume; }
  static set noticeVolume(noticeVolume: number) {
    AudioPlayer._noticeVolume = noticeVolume;
    if (AudioPlayer._noticeGainNode) {
      AudioPlayer._noticeGainNode.gain.setTargetAtTime(AudioPlayer.isNoticeMute ? 0 : AudioPlayer._noticeVolume, AudioPlayer.audioContext.currentTime, 0.01);
    }
    AudioPlayer.refreshElementDirectVolumes();
  }

  private static _isAmbientMute: boolean = false;
  static get isAmbientMute(): boolean { return AudioPlayer._isAmbientMute; }
  static set isAmbientMute(isAmbientMute: boolean) {
    AudioPlayer._isAmbientMute = isAmbientMute;
    AudioPlayer.ambientVolume = AudioPlayer._ambientVolume;
  }

  private static _ambientVolume: number = 0.5;
  static get ambientVolume(): number { return AudioPlayer._ambientVolume; }
  static set ambientVolume(ambientVolume: number) {
    AudioPlayer._ambientVolume = ambientVolume;
    if (AudioPlayer._ambientGainNode) {
      AudioPlayer._ambientGainNode.gain.setTargetAtTime(AudioPlayer.isAmbientMute ? 0 : AudioPlayer._ambientVolume, AudioPlayer.audioContext.currentTime, 0.01);
    }
    AudioPlayer.refreshElementDirectVolumes();
  }

  private static _masterGainNode: GainNode
  private static get masterGainNode(): GainNode {
    if (!AudioPlayer._masterGainNode) {
      let masterGain = AudioPlayer.audioContext.createGain();
      masterGain.gain.setValueAtTime(AudioPlayer._volume, AudioPlayer.audioContext.currentTime);
      masterGain.connect(AudioPlayer.audioContext.destination);
      AudioPlayer._masterGainNode = masterGain;
    }
    return AudioPlayer._masterGainNode;
  }

  private static _auditionGainNode: GainNode
  private static get auditionGainNode(): GainNode {
    if (!AudioPlayer._auditionGainNode) {
      let auditionGain = AudioPlayer.audioContext.createGain();
      auditionGain.gain.setValueAtTime(AudioPlayer._auditionVolume, AudioPlayer.audioContext.currentTime);
      auditionGain.connect(AudioPlayer.audioContext.destination);
      AudioPlayer._auditionGainNode = auditionGain;
    }
    return AudioPlayer._auditionGainNode;
  }

  private static _soundEffectGainNode: GainNode
  private static get soundEffectGainNode(): GainNode {
    if (!AudioPlayer._soundEffectGainNode) {
      let soundEffectGain = AudioPlayer.audioContext.createGain();
      soundEffectGain.gain.setValueAtTime(AudioPlayer._soundEffectVolume, AudioPlayer.audioContext.currentTime);
      soundEffectGain.connect(AudioPlayer.audioContext.destination);
      AudioPlayer._soundEffectGainNode = soundEffectGain;
    }
    return AudioPlayer._soundEffectGainNode;
  }

  private static _noticeGainNode: GainNode
  private static get noticeGainNode(): GainNode {
    if (!AudioPlayer._noticeGainNode) {
      let noticeGain = AudioPlayer.audioContext.createGain();
      noticeGain.gain.setValueAtTime(AudioPlayer._noticeVolume, AudioPlayer.audioContext.currentTime);
      noticeGain.connect(AudioPlayer.audioContext.destination);
      AudioPlayer._noticeGainNode = noticeGain;
    }
    return AudioPlayer._noticeGainNode;
  }

  private static _ambientGainNode: GainNode
  private static get ambientGainNode(): GainNode {
    if (!AudioPlayer._ambientGainNode) {
      let ambientGain = AudioPlayer.audioContext.createGain();
      ambientGain.gain.setValueAtTime(AudioPlayer._ambientVolume, AudioPlayer.audioContext.currentTime);
      ambientGain.connect(AudioPlayer.audioContext.destination);
      AudioPlayer._ambientGainNode = ambientGain;
    }
    return AudioPlayer._ambientGainNode;
  }

  static get rootNode(): AudioNode { return AudioPlayer.masterGainNode; }
  static get auditionNode(): AudioNode { return AudioPlayer.auditionGainNode; }
  static get soundEffectNode(): AudioNode { return AudioPlayer.soundEffectGainNode; }
  static get noticeNode(): AudioNode { return AudioPlayer.noticeGainNode; }
  static get ambientNode(): AudioNode { return AudioPlayer.ambientGainNode; }

  private _audioElm: HTMLAudioElement;
  private get audioElm(): HTMLAudioElement {
    if (!this._audioElm) {
      this._audioElm = new Audio();
      this._audioElm.onplay = () => { }
      this._audioElm.onpause = () => { this.mediaElementSource.disconnect(); }
      this._audioElm.onended = () => { this.mediaElementSource.disconnect(); }
    }
    return this._audioElm;
  }

  /** Separate element that never attaches MediaElementSource (required for non-CORS remote URLs). */
  private _directAudioElm: HTMLAudioElement;
  private get directAudioElm(): HTMLAudioElement {
    if (!this._directAudioElm) {
      this._directAudioElm = new Audio();
    }
    return this._directAudioElm;
  }

  private _mediaElementSource: MediaElementAudioSourceNode;
  private get mediaElementSource(): MediaElementAudioSourceNode {
    if (!this._mediaElementSource) this._mediaElementSource = AudioPlayer.audioContext.createMediaElementSource(this.audioElm);
    return this._mediaElementSource;
  }

  /** When true, play remote URL via HTMLAudioElement (speakers), not Web Audio. */
  private elementDirect = false;
  private roomGain = 1;
  private loopFlag = false;
  private readonly onEndedBound = () => {
    if (this.endedAction) this.endedAction();
  };

  // Make this an event?
  public endedAction: Function;

  audio: AudioFile;
  volumeType: VolumeType = VolumeType.MASTER;

  get volume(): number { return this.roomGain; }
  set volume(volume) {
    this.roomGain = volume;
    this.applyElementVolume();
  }
  get loop(): boolean { return this.loopFlag; }
  set loop(loop) {
    this.loopFlag = !!loop;
    if (this._audioElm) this._audioElm.loop = this.loopFlag;
    if (this._directAudioElm) this._directAudioElm.loop = this.loopFlag;
  }
  get paused(): boolean {
    if (this.elementDirect) return !this._directAudioElm || this._directAudioElm.paused;
    return !this._audioElm || this._audioElm.paused;
  }

  private static cacheMap: Map<string, AudioCache> = new Map();

  constructor(audio?: AudioFile) {
    this.audio = audio;
  }

  static play(audio: AudioFile, volume: number = 1.0) {
    this.playBufferAsync(audio, volume);
  }

  static playSoundEffect(audio: AudioFile, volume: number = 1.0) {
    this.playBufferAsyncBase(AudioPlayer.soundEffectNode, audio, volume);
  }

  private static isCrossOriginHttpUrl(url: string): boolean {
    if (!url || url.startsWith('blob:') || url.startsWith('data:')) return false;
    try {
      const absolute = new URL(url, window.location.href);
      if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return false;
      return absolute.origin !== window.location.origin;
    } catch {
      return false;
    }
  }

  private getChannelLinearVolume(): number {
    switch (this.volumeType) {
      case VolumeType.AUDITION:
        return AudioPlayer.isAuditionMute ? 0 : AudioPlayer.auditionVolume;
      case VolumeType.SOUND_EFFECT:
        return AudioPlayer.isSoundEffectMute ? 0 : AudioPlayer.soundEffectVolume;
      case VolumeType.NOTICE:
        return AudioPlayer.isNoticeMute ? 0 : AudioPlayer.noticeVolume;
      case VolumeType.AMBIENT:
        return AudioPlayer.isAmbientMute ? 0 : AudioPlayer.ambientVolume;
      default:
        return AudioPlayer.isMute ? 0 : AudioPlayer.volume;
    }
  }

  private applyElementVolume() {
    const gain = Math.max(0, Math.min(1, this.roomGain));
    if (this.elementDirect && this._directAudioElm) {
      this._directAudioElm.volume = Math.max(0, Math.min(1, gain * this.getChannelLinearVolume()));
    } else if (this._audioElm) {
      this._audioElm.volume = gain;
    }
  }

  play(audio: AudioFile = this.audio) {
    this.stop();
    this.audio = audio;
    if (!this.audio) return;
    AudioPlayer.ensureContextRunning();

    let url = this.audio.url;
    const remoteCrossOrigin = audio.state === AudioState.URL && AudioPlayer.isCrossOriginHttpUrl(url);
    const hasBlobCache = audio.state === AudioState.URL && AudioPlayer.cacheMap.has(audio.identifier);

    if (hasBlobCache) {
      url = AudioPlayer.cacheMap.get(audio.identifier).url;
    } else if (audio.state === AudioState.URL && !remoteCrossOrigin) {
      // Same-origin / relative assets: optional prefetch into blob cache.
      AudioPlayer.createCacheAsync(audio);
    }
    // Remote cross-origin: do not fetch() — CORS usually blocks and only spams console.

    // MediaElementSource requires CORS for remote media; without it output is silent.
    // Use a dedicated HTMLAudioElement that never joins the Web Audio graph.
    this.elementDirect = remoteCrossOrigin && !hasBlobCache;

    if (this.elementDirect) {
      AudioPlayer.elementDirectPlayers.add(this);
      const elm = this.directAudioElm;
      elm.loop = this.loopFlag;
      elm.removeAttribute('crossorigin');
      elm.src = url;
      this.applyElementVolume();
      elm.addEventListener('ended', this.onEndedBound, { once: true });
      elm.load();
      elm.play().catch(reason => { console.warn(reason); });
      return;
    }

    AudioPlayer.elementDirectPlayers.delete(this);
    this.mediaElementSource.connect(this.getConnectingAudioNode());
    this.audioElm.loop = this.loopFlag;
    this.audioElm.crossOrigin = null;
    this.audioElm.src = url;
    this.applyElementVolume();
    this.audioElm.addEventListener('ended', this.onEndedBound, { once: true });
    this.audioElm.load();
    this.audioElm.play().catch(reason => { console.warn(reason); });
  }

  pause() {
    if (this.elementDirect) {
      this._directAudioElm?.pause();
      return;
    }
    this.audioElm.pause();
  }

  stop() {
    AudioPlayer.elementDirectPlayers.delete(this);
    this.elementDirect = false;

    if (this._directAudioElm) {
      this._directAudioElm.removeEventListener('ended', this.onEndedBound);
      this._directAudioElm.pause();
      this._directAudioElm.currentTime = 0;
      this._directAudioElm.removeAttribute('src');
      this._directAudioElm.load();
    }

    if (!this._audioElm) return;
    this._audioElm.removeEventListener('ended', this.onEndedBound);
    this._audioElm.pause();
    this._audioElm.currentTime = 0;
    this._audioElm.src = '';
    this._audioElm.load();
    if (this._mediaElementSource) this._mediaElementSource.disconnect();
  }

  private getConnectingAudioNode() {
    switch (this.volumeType) {
      case VolumeType.AUDITION:
        return AudioPlayer.auditionNode;
      case VolumeType.SOUND_EFFECT:
        return AudioPlayer.soundEffectNode;
      case VolumeType.NOTICE:
        return AudioPlayer.noticeNode;
      case VolumeType.AMBIENT:
        return AudioPlayer.ambientNode;
      default:
        return AudioPlayer.rootNode;
    }
  }

  private static async playBufferAsync(audio: AudioFile, volume: number = 1.0) {
    AudioPlayer.playBufferAsyncBase(AudioPlayer.rootNode, audio, volume);
    /*
    let source = await AudioPlayer.createBufferSourceAsync(audio);
    if (!source) return;

    let gain = AudioPlayer.audioContext.createGain();
    gain.gain.setValueAtTime(volume, AudioPlayer.audioContext.currentTime);

    gain.connect(AudioPlayer.rootNode);
    source.connect(gain);

    source.onended = () => {
      source.stop();
      source.disconnect();
      gain.disconnect();
      source.buffer = null;
    };

    source.start();
    */
  }

  private static async playBufferAsyncBase(audioNode: AudioNode, audio: AudioFile, volume: number = 1.0) {
    AudioPlayer.ensureContextRunning();
    let source = await AudioPlayer.createBufferSourceAsync(audio);
    if (!source) return;

    let gain = AudioPlayer.audioContext.createGain();
    gain.gain.setValueAtTime(volume, AudioPlayer.audioContext.currentTime);

    gain.connect(audioNode);
    source.connect(gain);

    source.onended = () => {
      source.stop();
      source.disconnect();
      gain.disconnect();
      source.buffer = null;
    };

    source.start();
  }

  private static async createBufferSourceAsync(audio: AudioFile): Promise<AudioBufferSourceNode> {
    if (!audio) return null;
    try {
      let blob = audio.blob;
      if (audio.state === AudioState.URL) {
        if (AudioPlayer.cacheMap.has(audio.identifier)) {
          blob = AudioPlayer.cacheMap.get(audio.identifier).blob;
        } else {
          let cache = await AudioPlayer.createCacheAsync(audio);
          blob = cache && cache.blob ? cache.blob : null;
        }
      }
      if (!blob) return null;
      let decodedData = await this.decodeAudioDataAsync(blob);
      let source = AudioPlayer.audioContext.createBufferSource();
      source.buffer = decodedData;
      return source;
    } catch (reason) {
      console.warn(reason);
      return null;
    }
  }

  private static decodeAudioDataAsync(blob: Blob): Promise<AudioBuffer> {
    return new Promise(async (resolve, reject) => {
      AudioPlayer.audioContext.decodeAudioData(
        await FileReaderUtil.readAsArrayBufferAsync(blob),
        decodedData => resolve(decodedData),
        error => reject(error));
    });
  }

  private static async getBlobAsync(audio: AudioFile): Promise<Blob> {
    if (audio.blob) return audio.blob;
    if (audio.url.length < 1) throw new Error('Invalid audio URL');

    try {
      let response = await fetch(audio.url);
      if (!response.ok) throw new Error('Network response was not ok.');
      let blob = await response.blob();
      return blob;
    } catch (error) {
      console.warn('There has been a problem with your fetch operation: ', error.message);
      throw error;
    }
  }

  private static async createCacheAsync(audio: AudioFile): Promise<AudioCache> {
    let cache = { url: audio.url, blob: null };
    try {
      cache.blob = await AudioPlayer.getBlobAsync(audio);
    } catch (e) {
      // Expected for many remote hosts (no CORS). Playback may still work via element-direct.
      console.warn('Audio cache skipped (CORS or network):', audio.url);
      return cache;
    }

    if (AudioPlayer.cacheMap.has(audio.identifier)) {
      return AudioPlayer.cacheMap.get(audio.identifier);
    }

    cache.url = URL.createObjectURL(cache.blob);
    AudioPlayer.cacheMap.set(audio.identifier, cache);
    return cache;
  }

  /**
   * Browsers block AudioContext until a user gesture. Do not create/resume here —
   * only unlock on the first pointer/key interaction.
   */
  static resumeAudioContext() {
    if (AudioPlayer._unlockBound) return;
    AudioPlayer._unlockBound = true;
    const unlock = () => {
      AudioPlayer.ensureContextRunning();
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('touchstart', unlock, true);
      document.removeEventListener('keydown', unlock, true);
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('touchstart', unlock, true);
    document.addEventListener('keydown', unlock, true);
  }

  /** Create context if needed and resume when suspended (call from user gestures / play). */
  static ensureContextRunning() {
    try {
      const ctx = AudioPlayer.audioContext;
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    } catch { /* ignore */ }
  }

  private static _unlockBound = false;
}
