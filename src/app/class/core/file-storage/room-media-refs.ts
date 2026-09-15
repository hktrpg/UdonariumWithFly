import { AudioStorage } from './audio-storage';
import { ImageStorage } from './image-storage';
import { PdfStorage } from './pdf-storage';
import { VideoStorage } from './video-storage';
import { AudioLibrary } from '@udonarium/audio-library';
import { CutIn } from '@udonarium/cut-in';
import { Jukebox } from '@udonarium/Jukebox';
import { Card } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
import { ChatMessage } from '@udonarium/chat-message';
import { DiceSymbol } from '@udonarium/dice-symbol';
import { GameCharacter } from '@udonarium/game-character';
import { GameTable } from '@udonarium/game-table';
import { GameTableMask } from '@udonarium/game-table-mask';
import { ImageTag } from '@udonarium/image-tag';
import { PeerCursor } from '@udonarium/peer-cursor';
import { ScenePreset } from '@udonarium/scene-preset';
import { Terrain } from '@udonarium/terrain';
import { TextNote } from '@udonarium/text-note';
import { CombatTracker } from '@udonarium/table-fx/combat-tracker';
import { TableTimerList } from '@udonarium/table-fx/table-timer';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { isContentHashIdentifier } from 'service/folder-backup-layout';

export type RoomMediaRefs = {
  image: string[];
  pdf: string[];
  video: string[];
  audio: string[];
};

/** Collect every content-hash media id referenced by the current room. */
export function collectRoomMediaRefs(): RoomMediaRefs {
  const image = new Set<string>();
  const pdf = new Set<string>();
  const video = new Set<string>();
  const audio = new Set<string>();

  const addImage = (id: string) => {
    if (isContentHashIdentifier(id)) image.add(id.toLowerCase());
  };
  const addPdf = (id: string) => {
    if (isContentHashIdentifier(id)) pdf.add(id.toLowerCase());
  };
  const addVideo = (id: string) => {
    if (isContentHashIdentifier(id)) video.add(id.toLowerCase());
  };
  const addAudio = (id: string) => {
    if (isContentHashIdentifier(id)) audio.add(id.toLowerCase());
  };

  const addImageIdsFromObject = (obj: { imageDataElement?: { children?: { value?: unknown }[] } }) => {
    const children = obj?.imageDataElement?.children;
    if (!children) return;
    for (const el of children) {
      addImage(String(el?.value ?? ''));
    }
  };
  const absorbHashes = (text: string, add: (id: string) => void) => {
    if (!text) return;
    const re = /[a-f0-9]{64}/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) add(m[0]);
  };

  for (const tag of ObjectStore.instance.getObjects(ImageTag)) {
    addImage(tag.imageIdentifier);
  }
  for (const table of ObjectStore.instance.getObjects(GameTable)) {
    addImage(table.imageIdentifier);
    addImage(table.backgroundImageIdentifier);
    addImage(table.backgroundImageIdentifier2);
  }
  for (const note of ObjectStore.instance.getObjects(TextNote)) {
    addPdf(note.pdfIdentifier);
    addVideo(note.videoIdentifier);
    addImageIdsFromObject(note);
  }
  for (const card of ObjectStore.instance.getObjects(Card)) {
    addImageIdsFromObject(card);
  }
  for (const stack of ObjectStore.instance.getObjects(CardStack)) {
    addImageIdsFromObject(stack);
  }
  for (const ch of ObjectStore.instance.getObjects(GameCharacter)) {
    addImageIdsFromObject(ch);
    addImage(ch.chatDialogFaceIconIdentifier);
  }
  for (const terrain of ObjectStore.instance.getObjects(Terrain)) {
    addImageIdsFromObject(terrain);
    absorbHashes(terrain.bakeCropJson, addImage);
  }
  for (const dice of ObjectStore.instance.getObjects(DiceSymbol)) {
    addImageIdsFromObject(dice);
  }
  for (const mask of ObjectStore.instance.getObjects(GameTableMask)) {
    addImageIdsFromObject(mask);
  }
  for (const msg of ObjectStore.instance.getObjects(ChatMessage)) {
    addImage(msg.imageIdentifier);
    addImage(msg.toImageIdentifier);
    for (const id of (msg.attachedImageIdentifiers || '').trim().split(/\s+/)) addImage(id);
  }
  for (const cursor of ObjectStore.instance.getObjects(PeerCursor)) {
    addImage(cursor.imageIdentifier);
  }
  for (const img of ImageStorage.instance.images) {
    if (img?.identifier) addImage(img.identifier);
  }
  for (const p of PdfStorage.instance.pdfs) {
    if (p?.identifier) addPdf(p.identifier);
  }
  for (const v of VideoStorage.instance.videos) {
    if (v?.identifier) addVideo(v.identifier);
  }
  for (const a of AudioStorage.instance.audios) {
    if (a?.identifier) addAudio(a.identifier);
  }
  const library = AudioLibrary.instance?.data;
  if (library) {
    for (const id of Object.keys(library.membership || {})) addAudio(id);
    for (const list of Object.values(library.orders || {})) {
      if (!Array.isArray(list)) continue;
      for (const id of list) addAudio(id);
    }
  }
  const jukebox = Jukebox.instance;
  if (jukebox) {
    addAudio(jukebox.audioIdentifier);
    for (const track of jukebox.tracks || []) {
      addAudio(track.audioIdentifier);
      for (const id of track.queue || []) addAudio(id);
    }
    for (const pad of jukebox.soundboard || []) addAudio(pad.audioIdentifier);
  }
  for (const cutIn of ObjectStore.instance.getObjects(CutIn)) {
    addAudio(cutIn.audioIdentifier);
    addImage(cutIn.imageIdentifier);
  }
  absorbHashes(CombatTracker.instance?.encountersJson, addImage);
  for (const preset of ObjectStore.instance.getObjects(ScenePreset)) {
    absorbHashes(preset.tabletopJson, addImage);
    absorbHashes(preset.tracksJson, addAudio);
  }
  for (const timer of TableTimerList.instance?.timers || []) {
    absorbHashes(timer.onZeroActionsJson, addAudio);
  }

  return {
    image: Array.from(image),
    pdf: Array.from(pdf),
    video: Array.from(video),
    audio: Array.from(audio),
  };
}
