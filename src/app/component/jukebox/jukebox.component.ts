import { Component, NgZone, OnDestroy, OnInit } from '@angular/core';

import { AudioLibrary, AudioLibraryFolder, JUKEBOX_AUDIO_DRAG_MIME } from '@udonarium/audio-library';
import { AudioFile, AudioState } from '@udonarium/core/file-storage/audio-file';
import { AudioPlayer, VolumeType } from '@udonarium/core/file-storage/audio-player';
import { AudioStorage } from '@udonarium/core/file-storage/audio-storage';
import { FileArchiver } from '@udonarium/core/file-storage/file-archiver';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { Jukebox, JUKEBOX_TRACK_COUNT, JukeboxTrackState } from '@udonarium/Jukebox';
import { PresetSound } from '@udonarium/sound-effect';
import { ContextMenuAction, ContextMenuSeparator, ContextMenuService } from 'service/context-menu.service';

import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';
import { I18nService } from 'service/i18n.service';

import * as localForage from 'localforage';

@Component({
    selector: 'app-jukebox',
    templateUrl: './jukebox.component.html',
    styleUrls: ['../shared/settings-ui.css', './jukebox.component.css'],
    standalone: false
})
export class JukeboxComponent implements OnInit, OnDestroy {

  readonly trackCount = JUKEBOX_TRACK_COUNT;
  playTargetTrack = 0;
  /** Formal play mode: true = LOOP, false = once */
  playLoop = true;
  showHelp = false;
  showMixer = true;
  onlineUrl = '';
  onlineName = '';
  linkError = '';
  expandedFolders: { [folderId: string]: boolean } = { '': true };
  /** HTML5 DnD visual state */
  draggingAudioId: string = '';
  dropFolderId: string | null = null;
  dropTrackIndex: number | null = null;
  dropBeforeAudioId: string | null = null;
  dropOnLibraryFiles = false;

  readonly audioDragMime = JUKEBOX_AUDIO_DRAG_MIME;

  get isMute() { return AudioPlayer.isMute; }
  set isMute(isMute: boolean) {
    AudioPlayer.isMute = isMute;
    EventSystem.trigger('CHANGE_JUKEBOX_VOLUME', null);
    if (!isMute) {
      localForage.removeItem(AudioPlayer.MAIN_IS_MUTE_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(AudioPlayer.MAIN_IS_MUTE_LOCAL_STORAGE_KEY, isMute).catch(e => console.log(e));
    }
  }
  get volume(): number { return AudioPlayer.volume; }
  set volume(volume: number) {
    this.isMute = (volume == 0);
    AudioPlayer.volume = volume;
    EventSystem.trigger('CHANGE_JUKEBOX_VOLUME', null);
    if (AudioPlayer.volume == 0.5) {
      localForage.removeItem(AudioPlayer.MAIN_VOLUME_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(AudioPlayer.MAIN_VOLUME_LOCAL_STORAGE_KEY, volume).catch(e => console.log(e));
    }
  }

  get isAmbientMute() { return AudioPlayer.isAmbientMute; }
  set isAmbientMute(isAmbientMute: boolean) {
    AudioPlayer.isAmbientMute = isAmbientMute;
    EventSystem.trigger('CHANGE_JUKEBOX_VOLUME', null);
    if (!isAmbientMute) {
      localForage.removeItem(AudioPlayer.AMBIENT_IS_MUTE_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(AudioPlayer.AMBIENT_IS_MUTE_LOCAL_STORAGE_KEY, isAmbientMute).catch(e => console.log(e));
    }
  }
  get ambientVolume(): number { return AudioPlayer.ambientVolume; }
  set ambientVolume(ambientVolume: number) {
    this.isAmbientMute = (ambientVolume == 0);
    AudioPlayer.ambientVolume = ambientVolume;
    EventSystem.trigger('CHANGE_JUKEBOX_VOLUME', null);
    if (AudioPlayer.ambientVolume == 0.5) {
      localForage.removeItem(AudioPlayer.AMBIENT_VOLUME_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(AudioPlayer.AMBIENT_VOLUME_LOCAL_STORAGE_KEY, ambientVolume).catch(e => console.log(e));
    }
  }

  get isAuditionMute() { return AudioPlayer.isAuditionMute; }
  set isAuditionMute(isAuditionMute: boolean) {
    AudioPlayer.isAuditionMute = isAuditionMute;
    EventSystem.trigger('CHANGE_JUKEBOX_VOLUME', null);
    if (!isAuditionMute) {
      localForage.removeItem(AudioPlayer.AUDITION_IS_MUTE_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(AudioPlayer.AUDITION_IS_MUTE_LOCAL_STORAGE_KEY, isAuditionMute).catch(e => console.log(e));
    }
  }
  get auditionVolume(): number { return AudioPlayer.auditionVolume; }
  set auditionVolume(auditionVolume: number) {
    this.isAuditionMute = (auditionVolume == 0);
    AudioPlayer.auditionVolume = auditionVolume;
    EventSystem.trigger('CHANGE_JUKEBOX_VOLUME', null);
    if (AudioPlayer.auditionVolume == 0.5) {
      localForage.removeItem(AudioPlayer.AUDITION_VOLUME_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(AudioPlayer.AUDITION_VOLUME_LOCAL_STORAGE_KEY, auditionVolume).catch(e => console.log(e));
    }
  }

  get isSoundEffectMute() { return AudioPlayer.isSoundEffectMute; }
  set isSoundEffectMute(isSoundEffectMute: boolean) {
    AudioPlayer.isSoundEffectMute = isSoundEffectMute;
    if (!isSoundEffectMute) {
      localForage.removeItem(AudioPlayer.SOUND_EFFECT_IS_MUTE_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(AudioPlayer.SOUND_EFFECT_IS_MUTE_LOCAL_STORAGE_KEY, isSoundEffectMute).catch(e => console.log(e));
    }
  }
  get soundEffectVolume(): number { return AudioPlayer.soundEffectVolume; }
  set soundEffectVolume(soundEffectVolume: number) {
    this.isSoundEffectMute = (soundEffectVolume == 0);
    AudioPlayer.soundEffectVolume = soundEffectVolume;
    if (AudioPlayer.soundEffectVolume == 0.5) {
      localForage.removeItem(AudioPlayer.SOUND_EFFECT_VOLUME_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(AudioPlayer.SOUND_EFFECT_VOLUME_LOCAL_STORAGE_KEY, soundEffectVolume).catch(e => console.log(e));
    }
  }

  get isNoticeMute() { return AudioPlayer.isNoticeMute; }
  set isNoticeMute(isNoticeMute: boolean) {
    AudioPlayer.isNoticeMute = isNoticeMute;
    if (!isNoticeMute) {
      localForage.removeItem(AudioPlayer.NOTICE_IS_MUTE_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(AudioPlayer.NOTICE_IS_MUTE_LOCAL_STORAGE_KEY, isNoticeMute).catch(e => console.log(e));
    }
  }
  get noticeVolume(): number { return AudioPlayer.noticeVolume; }
  set noticeVolume(noticeVolume: number) {
    this.isNoticeMute = (noticeVolume == 0);
    AudioPlayer.noticeVolume = noticeVolume;
    if (AudioPlayer.noticeVolume == 0.5) {
      localForage.removeItem(AudioPlayer.NOTICE_VOLUME_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(AudioPlayer.NOTICE_VOLUME_LOCAL_STORAGE_KEY, noticeVolume).catch(e => console.log(e));
    }
  }

  get audios(): AudioFile[] { return AudioStorage.instance.audios.filter(audio => !audio.isHidden); }
  get library(): AudioLibrary { return AudioLibrary.instance; }
  get folders(): AudioLibraryFolder[] { return this.library.folders; }
  get jukebox(): Jukebox { return ObjectStore.instance.get<Jukebox>('Jukebox'); }
  get tracks(): JukeboxTrackState[] { return this.jukebox?.tracks || []; }

  get trackIndexes(): number[] {
    return Array.from({ length: JUKEBOX_TRACK_COUNT }, (_, i) => i);
  }

  get percentVolume(): number { return Math.floor(this.volume * 100); }
  set percentVolume(percentVolume: number) { this.volume = percentVolume / 100; }
  get percentAmbientVolume(): number { return Math.floor(this.ambientVolume * 100); }
  set percentAmbientVolume(percentAmbientVolume: number) { this.ambientVolume = percentAmbientVolume / 100; }
  get percentAuditionVolume(): number { return Math.floor(this.auditionVolume * 100); }
  set percentAuditionVolume(percentAuditionVolume: number) { this.auditionVolume = percentAuditionVolume / 100; }
  get percentSoundEffectVolume(): number { return Math.floor(this.soundEffectVolume * 100); }
  set percentSoundEffectVolume(percentSoundEffectVolume: number) { this.soundEffectVolume = percentSoundEffectVolume / 100; }
  get percentNoticeVolume(): number { return Math.floor(this.noticeVolume * 100); }
  set percentNoticeVolume(percentNoticeVolume: number) { this.noticeVolume = percentNoticeVolume / 100; }

  readonly auditionPlayer: AudioPlayer = new AudioPlayer();
  private lazyUpdateTimer: NodeJS.Timeout = null;
  private readonly soundTestPlayer: AudioPlayer = new AudioPlayer();
  private readonly noticeTestPlayer: AudioPlayer = new AudioPlayer();

  constructor(
    private modalService: ModalService,
    private panelService: PanelService,
    private ngZone: NgZone,
    private contextMenuService: ContextMenuService,
    private i18n: I18nService
  ) {
    this.soundTestPlayer.volumeType = VolumeType.SOUND_EFFECT;
    this.noticeTestPlayer.volumeType = VolumeType.NOTICE;
  }

  GuestMode() {
    return Network.GuestMode();
  }

  trackName(index: number): string {
    if (index === 0) return this.i18n.t('jukebox.trackBgm');
    if (index === 1) return this.i18n.t('jukebox.trackAmbient');
    return this.i18n.t('jukebox.trackN', { n: index + 1 });
  }

  trackAudio(index: number): AudioFile {
    return this.jukebox?.audioAt(index);
  }

  displayName(audio: AudioFile): string {
    return this.library.displayName(audio);
  }

  audiosIn(folderId: string): AudioFile[] {
    return this.library.audiosInFolder(folderId || '', this.audios);
  }

  isFolderExpanded(folderId: string): boolean {
    return this.expandedFolders[folderId || ''] !== false;
  }

  toggleFolder(folderId: string) {
    const key = folderId || '';
    this.expandedFolders[key] = !this.isFolderExpanded(key);
  }

  trackRoomGainPercent(index: number): number {
    return Math.floor((this.tracks[index]?.roomGain ?? 1) * 100);
  }

  setTrackRoomGainPercent(index: number, percent: number) {
    if (this.GuestMode()) return;
    this.jukebox?.setTrackRoomGain(index, percent / 100);
  }

  ngOnInit() {
    Promise.resolve().then(() => this.refreshPanelTitle());
    this.auditionPlayer.volumeType = VolumeType.AUDITION;
    EventSystem.register(this)
      .on('*', event => {
        if (event.eventName.startsWith('FILE_') || event.eventName.startsWith('UPDATE_GAME_OBJECT')) this.lazyNgZoneUpdate();
      })
      .on('LOCALE_CHANGED', () => this.refreshPanelTitle());
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    this.stop();
  }

  play(audio: AudioFile) {
    if (this.GuestMode()) return;
    this.auditionPlayer.play(audio);
  }

  stop() {
    if (this.GuestMode()) return;
    this.auditionPlayer.stop();
  }

  isAuditionPlaying(audio: AudioFile): boolean {
    return !!audio && this.auditionPlayer?.audio === audio && !this.auditionPlayer?.paused;
  }

  toggleAudition(audio: AudioFile, event?: Event) {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.GuestMode() || !audio) return;
    if (this.isAuditionPlaying(audio)) this.stop();
    else this.play(audio);
  }

  /** Effective track for UI: audio override > folder default. */
  trackTypeOf(audio: AudioFile, folderId?: string): number {
    if (!audio) return 0;
    return this.library.effectiveTrackType(audio.identifier, folderId) % this.trackCount;
  }

  hasOwnTrackType(audio: AudioFile): boolean {
    return !!audio && this.library.hasTrackType(audio.identifier);
  }

  isPlayingOnTrack(audio: AudioFile): boolean {
    return !!audio && !!this.jukebox?.isAnyTrackPlayingAudio(audio);
  }

  isPlayLoop(audio: AudioFile, folderId?: string): boolean {
    if (!audio) return true;
    return this.library.effectivePlayLoop(audio.identifier, folderId);
  }

  hasOwnPlayLoop(audio: AudioFile): boolean {
    return !!audio && this.library.hasPlayLoop(audio.identifier);
  }

  folderTrackType(folderId: string): number {
    return this.library.folderTrackType(folderId || '') % this.trackCount;
  }

  folderPlayLoop(folderId: string): boolean {
    return this.library.folderPlayLoop(folderId || '');
  }

  trackShortName(index: number): string {
    if (index === 0) return 'BGM';
    if (index === 1) return 'Amb';
    return String(index + 1);
  }

  /** Cycle this audio's track override only (does not put it on a track). */
  cycleTrackType(audio: AudioFile, folderId: string, event?: Event) {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.GuestMode() || !audio) return;
    const next = (this.trackTypeOf(audio, folderId) + 1) % this.trackCount;
    this.library.setTrackType(audio.identifier, next);
  }

  cycleFolderTrackType(folderId: string, event?: Event) {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.GuestMode()) return;
    const next = (this.folderTrackType(folderId) + 1) % this.trackCount;
    this.library.setFolderTrackType(folderId || '', next);
    this.ngZone.run(() => { });
  }

  togglePlayMode(audio: AudioFile, folderId: string, event?: Event) {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.GuestMode() || !audio) return;
    this.library.setPlayLoop(audio.identifier, !this.isPlayLoop(audio, folderId));
  }

  toggleFolderPlayMode(folderId: string, event?: Event) {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.GuestMode()) return;
    this.library.setFolderPlayLoop(folderId || '', !this.folderPlayLoop(folderId));
    this.ngZone.run(() => { });
  }

  /** Put this audio on its effective track and play (or stop if already playing). */
  toggleLibraryPlay(audio: AudioFile, folderId: string, event?: Event) {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.GuestMode() || !audio || !this.jukebox) return;
    if (this.isPlayingOnTrack(audio)) {
      this.stopBGM(audio);
      return;
    }
    const track = this.trackTypeOf(audio, folderId);
    const loop = this.isPlayLoop(audio, folderId);
    this.jukebox.playTrack(track, audio.identifier, loop);
  }

  playFormal(audio: AudioFile, folderId?: string) {
    if (this.GuestMode() || !audio || !this.jukebox) return;
    const fid = folderId != null ? folderId : this.library.folderOf(audio.identifier);
    this.jukebox.playTrack(this.trackTypeOf(audio, fid), audio.identifier, this.isPlayLoop(audio, fid));
  }

  assignToTrack(audio: AudioFile, trackIndex?: number, event?: Event) {
    event?.stopPropagation();
    if (this.GuestMode() || !audio || !this.jukebox) return;
    const index = trackIndex != null ? trackIndex : this.trackTypeOf(audio);
    this.library.setTrackType(audio.identifier, index);
    this.jukebox.setTrackAudio(index, audio.identifier);
  }

  assignAndPlay(audio: AudioFile, trackIndex?: number) {
    if (this.GuestMode() || !audio || !this.jukebox) return;
    const index = trackIndex != null ? trackIndex : this.trackTypeOf(audio);
    this.library.setTrackType(audio.identifier, index);
    this.jukebox.playTrack(index, audio.identifier, this.isPlayLoop(audio));
  }

  toggleTrackSlot(index: number, audio: AudioFile) {
    if (this.GuestMode() || !this.jukebox) return;
    if (this.tracks[index]?.isPlaying) this.stopTrack(index);
    else if (audio) this.assignAndPlay(audio, index);
  }

  stopBGM(audio: AudioFile) {
    if (this.GuestMode()) return;
    const tracks = this.tracks;
    for (let i = 0; i < tracks.length; i++) {
      if (tracks[i].isPlaying && tracks[i].audioIdentifier === audio.identifier) {
        this.jukebox.stopTrack(i);
      }
    }
  }

  stopTrack(index: number) {
    if (this.GuestMode()) return;
    this.jukebox?.stopTrack(index);
  }

  stopAllTracks() {
    if (this.GuestMode()) return;
    this.jukebox?.stopAll();
  }

  createFolder() {
    if (this.GuestMode()) return;
    const name = window.prompt(this.i18n.t('jukebox.folderNamePrompt'), this.i18n.t('jukebox.folderDefaultName'));
    if (name == null) return;
    const folder = this.library.createFolder(name);
    this.expandedFolders[folder.id] = true;
  }

  playFolderShuffleLoop(folderId: string, event?: Event) {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.GuestMode() || !this.jukebox) return;
    const ids = this.audiosIn(folderId).filter(a => a.isReady).map(a => a.identifier);
    if (ids.length < 1) return;
    this.jukebox.playQueue(this.folderTrackType(folderId), ids, 'shuffle-loop');
  }

  playFolderOneShot(folderId: string, event?: Event) {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.GuestMode() || !this.jukebox) return;
    const ready = this.audiosIn(folderId).filter(a => a.isReady);
    if (ready.length < 1) return;
    const pick = ready[Math.floor(Math.random() * ready.length)];
    const track = this.library.effectiveTrackType(pick.identifier, folderId) % this.trackCount;
    const loop = this.library.effectivePlayLoop(pick.identifier, folderId);
    this.jukebox.playTrack(track, pick.identifier, loop);
  }

  handleFileSelect(event: Event) {
    if (this.GuestMode()) return;
    let input = <HTMLInputElement>event.target;
    let files = input.files;
    if (files.length) FileArchiver.instance.load(files);
    input.value = '';
  }

  // —— Drag & drop ————————————————————————————————————————————————

  onAudioDragStart(event: DragEvent, audio: AudioFile) {
    if (this.GuestMode() || !audio || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    this.draggingAudioId = audio.identifier;
    event.dataTransfer.setData(JUKEBOX_AUDIO_DRAG_MIME, audio.identifier);
    event.dataTransfer.setData('text/plain', audio.identifier);
    event.dataTransfer.effectAllowed = 'copyMove';
    try {
      const ghost = document.createElement('div');
      ghost.className = 'jb-drag-ghost';
      ghost.textContent = this.displayName(audio);
      ghost.style.cssText = 'position:absolute;top:-1000px;left:-1000px;padding:4px 8px;background:#3a2f24;color:#fff;border-radius:4px;font-size:12px;';
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, 12, 12);
      setTimeout(() => ghost.remove(), 0);
    } catch { /* ignore */ }
  }

  onAudioDragEnd() {
    this.clearDropState();
  }

  onFolderDragOver(event: DragEvent, folderId: string) {
    if (!this.isAudioDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dropFolderId = folderId || '';
    this.dropTrackIndex = null;
    this.dropBeforeAudioId = null;
  }

  onFolderDrop(event: DragEvent, folderId: string) {
    if (!this.isAudioDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const id = this.readAudioDragId(event);
    this.clearDropState();
    if (!id || this.GuestMode()) return;
    this.library.moveToFolder(id, folderId || '');
    this.expandedFolders[folderId || ''] = true;
  }

  onLibRowDragOver(event: DragEvent, folderId: string, beforeAudio: AudioFile) {
    if (!this.isAudioDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const id = this.peekDraggingId(event);
    if (id && beforeAudio && id === beforeAudio.identifier) {
      this.dropBeforeAudioId = null;
      return;
    }
    this.dropFolderId = folderId || '';
    this.dropBeforeAudioId = beforeAudio?.identifier || null;
    this.dropTrackIndex = null;
  }

  onLibRowDrop(event: DragEvent, folderId: string, beforeAudio: AudioFile) {
    if (!this.isAudioDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const id = this.readAudioDragId(event);
    const beforeId = beforeAudio?.identifier || null;
    this.clearDropState();
    if (!id || this.GuestMode()) return;
    if (beforeId && id === beforeId) return;
    this.library.reorder(id, folderId || '', beforeId);
    this.expandedFolders[folderId || ''] = true;
  }

  onTrackDragOver(event: DragEvent, trackIndex: number) {
    if (!this.isAudioDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = event.altKey ? 'copy' : 'link';
    }
    this.dropTrackIndex = trackIndex;
    this.dropFolderId = null;
    this.dropBeforeAudioId = null;
  }

  onTrackDragLeave(trackIndex: number) {
    if (this.dropTrackIndex === trackIndex) this.dropTrackIndex = null;
  }

  onTrackDrop(event: DragEvent, trackIndex: number) {
    if (!this.isAudioDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const id = this.readAudioDragId(event);
    const playNow = event.altKey;
    this.clearDropState();
    if (!id || this.GuestMode() || !this.jukebox) return;
    const audio = AudioStorage.instance.get(id);
    if (!audio?.isReady) return;
    this.library.setTrackType(id, trackIndex);
    if (playNow) this.jukebox.playTrack(trackIndex, id, this.library.playLoopOf(id));
    else this.jukebox.setTrackAudio(trackIndex, id);
  }

  onLibraryFilesDragOver(event: DragEvent) {
    if (this.GuestMode()) return;
    const files = event.dataTransfer?.types;
    if (!files) return;
    const list = Array.from(files);
    if (!list.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.dropOnLibraryFiles = true;
  }

  onLibraryFilesDragLeave(event: DragEvent) {
    const related = event.relatedTarget as Node | null;
    const current = event.currentTarget as HTMLElement | null;
    if (current && related && current.contains(related)) return;
    this.dropOnLibraryFiles = false;
  }

  onLibraryFilesDrop(event: DragEvent) {
    this.dropOnLibraryFiles = false;
    if (this.GuestMode()) return;
    event.preventDefault();
    event.stopPropagation();
    const files = event.dataTransfer?.files;
    if (files?.length) FileArchiver.instance.load(files);
  }

  isDropFolder(folderId: string): boolean {
    return this.dropFolderId !== null && this.dropFolderId === (folderId || '') && this.dropBeforeAudioId == null;
  }

  isDropBefore(audioId: string): boolean {
    return !!this.dropBeforeAudioId && this.dropBeforeAudioId === audioId;
  }

  private isAudioDrag(event: DragEvent): boolean {
    if (this.GuestMode()) return false;
    const types = Array.from(event.dataTransfer?.types || []);
    return types.includes(JUKEBOX_AUDIO_DRAG_MIME) || (!!this.draggingAudioId && types.includes('text/plain'));
  }

  private peekDraggingId(event: DragEvent): string {
    return this.draggingAudioId || '';
  }

  private readAudioDragId(event: DragEvent): string {
    const typed = event.dataTransfer?.getData(JUKEBOX_AUDIO_DRAG_MIME)
      || event.dataTransfer?.getData('text/plain')
      || this.draggingAudioId
      || '';
    return typed.trim();
  }

  private clearDropState() {
    this.draggingAudioId = '';
    this.dropFolderId = null;
    this.dropTrackIndex = null;
    this.dropBeforeAudioId = null;
    this.dropOnLibraryFiles = false;
  }

  isUrlAudio(audio: AudioFile): boolean {
    return !!audio && audio.state === AudioState.URL;
  }

  addOnlineLink() {
    if (this.GuestMode()) return;
    const url = (this.onlineUrl || '').trim();
    this.linkError = '';
    if (!StringUtil.validUrl(url)) {
      this.linkError = this.i18n.t('jukebox.linkInvalid');
      return;
    }
    const name = (this.onlineName || '').trim() || this.displayNameFromUrl(url);
    AudioStorage.instance.add({
      identifier: url,
      name,
      type: '',
      blob: null,
      url
    });
    this.library.ensureListed(url);
    this.onlineUrl = '';
    this.onlineName = '';
  }

  onAudioContextMenu(event: MouseEvent, audio: AudioFile) {
    event.preventDefault();
    event.stopPropagation();
    if (this.GuestMode() || !audio) return;
    const t = (key: string, params?: any) => this.i18n.t(key, params);
    const position = { x: event.pageX, y: event.pageY };
    const folderMoves: ContextMenuAction[] = [
      { name: t('jukebox.moveToRoot'), action: () => this.library.moveToFolder(audio.identifier, '') }
    ];
    for (const folder of this.folders) {
      folderMoves.push({
        name: folder.name,
        action: () => this.library.moveToFolder(audio.identifier, folder.id)
      });
    }
    const assignTracks: ContextMenuAction[] = this.trackIndexes.map(i => ({
      name: this.trackName(i),
      action: () => this.assignToTrack(audio, i)
    }));
    const playTracks: ContextMenuAction[] = this.trackIndexes.map(i => ({
      name: this.trackName(i),
      action: () => this.assignAndPlay(audio, i)
    }));
    const menu: ContextMenuAction[] = [
      { name: t('jukebox.audition'), action: () => this.play(audio), selfOnly: true },
      { name: t('jukebox.playOnce'), action: () => { this.library.setPlayLoop(audio.identifier, false); this.playFormal(audio); } },
      { name: t('jukebox.playLoop'), action: () => { this.library.setPlayLoop(audio.identifier, true); this.playFormal(audio); } },
      ContextMenuSeparator,
      { name: t('jukebox.assignTrack'), subActions: assignTracks },
      { name: t('jukebox.playToTrack'), subActions: playTracks },
      ContextMenuSeparator,
      { name: t('jukebox.rename'), action: () => this.renameAudio(audio) },
      { name: t('jukebox.moveToFolder'), subActions: folderMoves },
      ContextMenuSeparator,
      { name: t('jukebox.removeFromLibrary'), action: () => this.removeAudio(audio) },
    ];
    this.contextMenuService.open(position, menu, this.displayName(audio));
  }

  onFolderContextMenu(event: MouseEvent, folder: AudioLibraryFolder) {
    event.preventDefault();
    event.stopPropagation();
    if (this.GuestMode() || !folder) return;
    const t = (key: string) => this.i18n.t(key);
    const position = { x: event.pageX, y: event.pageY };
    const menu: ContextMenuAction[] = [
      { name: t('jukebox.folderShuffleLoop'), action: () => this.playFolderShuffleLoop(folder.id) },
      { name: t('jukebox.folderOneShot'), action: () => this.playFolderOneShot(folder.id) },
      ContextMenuSeparator,
      { name: t('jukebox.rename'), action: () => this.renameFolder(folder) },
      { name: t('jukebox.deleteFolder'), action: () => this.deleteFolder(folder) },
    ];
    this.contextMenuService.open(position, menu, folder.name);
  }

  private renameAudio(audio: AudioFile) {
    const current = this.displayName(audio);
    const name = window.prompt(this.i18n.t('jukebox.renamePrompt'), current);
    if (name == null || !name.trim()) return;
    this.library.renameAudio(audio.identifier, name.trim());
  }

  private renameFolder(folder: AudioLibraryFolder) {
    const name = window.prompt(this.i18n.t('jukebox.folderNamePrompt'), folder.name);
    if (name == null) return;
    this.library.renameFolder(folder.id, name);
  }

  private deleteFolder(folder: AudioLibraryFolder) {
    if (!window.confirm(this.i18n.t('jukebox.deleteFolderConfirm', { name: folder.name }))) return;
    this.library.deleteFolder(folder.id);
  }

  private removeAudio(audio: AudioFile) {
    if (!window.confirm(this.i18n.t('jukebox.removeConfirm', { name: this.displayName(audio) }))) return;
    this.stopBGM(audio);
    if (this.auditionPlayer.audio === audio) this.stop();
    this.library.removeAudioMeta(audio.identifier);
    AudioStorage.instance.delete(audio.identifier);
    AudioStorage.instance.lazySynchronize(100);
  }

  private displayNameFromUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const last = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
      return last || parsed.hostname || url;
    } catch {
      return url;
    }
  }

  noticeTest(audioIdentifier = PresetSound.puyon) {
    const audio = AudioStorage.instance.get(audioIdentifier);
    if (audio && audio.isReady) this.noticeTestPlayer.play(audio);
  }

  soundTest(event: Event) {
    const button = ((event.currentTarget || event.target) as HTMLElement)?.closest?.('button') as HTMLElement
      || (event.currentTarget as HTMLElement);
    const clientRect = button.getBoundingClientRect();
    const position = {
      x: window.pageXOffset + clientRect.left + button.clientWidth,
      y: window.pageYOffset + clientRect.top
    };
    const t = (key: string) => this.i18n.t(key);
    const menu: ContextMenuAction[] = [
      { name: t('jukebox.se.charMoveStart'), action: () => { this.playSETest(PresetSound.piecePick); }},
      { name: t('jukebox.se.charPut'), action: () => { this.playSETest(PresetSound.piecePut); }},
      { name: t('jukebox.se.terrainMove'), action: () => { this.playSETest(PresetSound.blockPick); }},
      ContextMenuSeparator,
      { name: t('jukebox.se.dicePick'), action: () => { this.playSETest(PresetSound.dicePick); }},
      { name: t('jukebox.se.dicePut'), action: () => { this.playSETest(PresetSound.dicePut); }},
      { name: t('jukebox.se.diceRoll1'), action: () => { this.playSETest(PresetSound.diceRoll1); }},
      { name: t('jukebox.se.diceRoll2'), action: () => { this.playSETest(PresetSound.diceRoll2); }},
      { name: t('jukebox.se.coinToss'), action: () => { this.playSETest(PresetSound.coinToss); }},
      ContextMenuSeparator,
      { name: t('jukebox.se.cardDraw'), action: () => { this.playSETest(PresetSound.cardDraw); }},
      { name: t('jukebox.se.cardPick'), action: () => { this.playSETest(PresetSound.cardPick); }},
      { name: t('jukebox.se.cardPut'), action: () => { this.playSETest(PresetSound.cardPut); }},
      { name: t('jukebox.se.shuffle'), action: () => { this.playSETest(PresetSound.cardShuffle); }},
      ContextMenuSeparator,
      { name: t('jukebox.se.lock'), action: () => { this.playSETest(PresetSound.lock); }},
      { name: t('jukebox.se.sweep'), action: () => { this.playSETest(PresetSound.sweep); }},
      { name: t('jukebox.se.select'), action: () => { this.playSETest(PresetSound.selectionStart); }},
      { name: t('jukebox.se.surprise'), action: () => { this.playSETest(PresetSound.surprise); }}
    ];
    this.contextMenuService.open(position, menu, t('jukebox.seTestTitle'));
  }

  private playSETest(audioIdentifier) {
    const audio = AudioStorage.instance.get(audioIdentifier);
    if (audio && audio.isReady) {
      EventSystem.unregister(this, 'UPDATE_AUDIO_RESOURE');
      if (!this.isSoundEffectMute) this.soundTestPlayer.play(audio);
    } else {
      EventSystem.register(this)
        .on('UPDATE_AUDIO_RESOURE', -100, event => {
          this.playSETest(audioIdentifier);
        });
    }
  }

  private lazyNgZoneUpdate() {
    if (this.lazyUpdateTimer !== null) return;
    this.lazyUpdateTimer = setTimeout(() => {
      this.lazyUpdateTimer = null;
      this.ngZone.run(() => { });
    }, 100);
  }

  private refreshPanelTitle() {
    this.modalService.title = this.panelService.title = this.i18n.t('jukebox.title');
  }
}
