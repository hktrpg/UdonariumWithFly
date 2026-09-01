import { Card } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
import { CharacterToken } from '@udonarium/character-token';
import { TextNote } from '@udonarium/text-note';
import { buildNoteHandoutPayload } from 'component/note-handout/note-handout-payload';
import { cardEffectRubiedText, canRevealCardCaption } from 'service/card-caption-text';

export type ObjectPreviewPayload = {
  id: string;
  title: string;
  imageUrl?: string;
  pdfIdentifier?: string;
  pdfPage?: number;
  pdfPageCount?: number;
  videoIdentifier?: string;
  videoUrl?: string;
  text?: string;
  /** Optional effect / card text shown beside the preview image. */
  asideHtml?: string;
  zoom: number;
  panX: number;
  panY: number;
  pinned: boolean;
};

/** Structural match for NoteHandoutPayload without importing the component type. */
export type NoteHandoutLike = {
  name?: string;
  imageUrl?: string;
  pdfIdentifier?: string;
  pdfPage?: number;
  pdfPageCount?: number;
  videoIdentifier?: string;
  videoUrl?: string;
  text?: string;
  noteIdentifier?: string;
};

export function buildImagePayload(id: string, title: string, imageUrl: string): ObjectPreviewPayload | null {
  if (!id || !imageUrl) return null;
  return {
    id,
    title: title || '',
    imageUrl,
    zoom: 1,
    panX: 0,
    panY: 0,
    pinned: false,
  };
}

export function buildPayloadFromNoteHandout(
  data: NoteHandoutLike,
  fallbackId = '',
  nameFallback = '',
): ObjectPreviewPayload | null {
  if (!data) return null;
  const id = data.noteIdentifier || fallbackId;
  if (!id) return null;
  let text = data.text || '';
  const imageUrl = data.imageUrl || '';
  const pdfIdentifier = data.pdfIdentifier || '';
  const videoIdentifier = data.videoIdentifier || '';
  const videoUrl = data.videoUrl || '';
  if (!imageUrl && !pdfIdentifier && !videoUrl && !videoIdentifier && !text) {
    text = data.name || nameFallback || '';
  }
  if (!imageUrl && !pdfIdentifier && !videoUrl && !videoIdentifier && !text) return null;
  return {
    id,
    title: data.name || nameFallback || '',
    imageUrl,
    pdfIdentifier,
    pdfPage: Math.max(1, Math.floor(Number(data.pdfPage)) || 1),
    pdfPageCount: Math.max(0, Math.floor(Number(data.pdfPageCount)) || 0),
    videoIdentifier,
    videoUrl,
    text,
    zoom: 1,
    panX: 0,
    panY: 0,
    pinned: false,
  };
}

export function buildPayloadFromNote(note: TextNote, nameFallback = ''): ObjectPreviewPayload | null {
  if (!note) return null;
  const handout = buildNoteHandoutPayload(note, nameFallback);
  return buildPayloadFromNoteHandout(handout, note.identifier, nameFallback);
}

/** Front if isFront || isHand || isGMMode, else back. */
export function resolveCardPreviewImageUrl(card: Card): string {
  if (!card) return '';
  const showFront = card.isFront || card.isHand || card.isGMMode;
  const file = showFront ? card.frontImage : card.backImage;
  return file?.url || '';
}

export function buildCardPreviewPayload(card: Card, titleFallback = ''): ObjectPreviewPayload | null {
  if (!card) return null;
  const imageUrl = resolveCardPreviewImageUrl(card);
  if (!imageUrl) return null;
  const title = card.isFront || card.isHand || card.isGMMode
    ? (card.name || titleFallback)
    : titleFallback;
  const payload = buildImagePayload(card.identifier, title || '', imageUrl);
  if (!payload) return null;
  if (canRevealCardCaption(card)) {
    const asideHtml = cardEffectRubiedText(card);
    if (asideHtml) payload.asideHtml = asideHtml;
  }
  return payload;
}

/** Visible pile face (`coverCard`), same front/back rules as a single card. */
export function buildCardStackPreviewPayload(stack: CardStack, titleFallback = ''): ObjectPreviewPayload | null {
  if (!stack) return null;
  const cover = stack.coverCard;
  if (!cover) return null;
  const cardPayload = buildCardPreviewPayload(cover, stack.name || titleFallback);
  if (!cardPayload) return null;
  const showFront = cover.isFront || cover.isHand || cover.isGMMode;
  return {
    ...cardPayload,
    id: stack.identifier,
    title: showFront
      ? (cover.name || stack.name || titleFallback || '')
      : (stack.name || titleFallback || ''),
  };
}

/** Character token / dice / mask / range — TabletopObject.imageFile when present. */
export function buildTabletopImagePreviewPayload(
  obj: { identifier: string; name?: string; imageFile?: { url?: string } | null } | null,
  titleFallback = '',
): ObjectPreviewPayload | null {
  if (!obj?.identifier) return null;
  return buildImagePayload(obj.identifier, obj.name || titleFallback || '', obj.imageFile?.url || '');
}

/** Alias for character tokens (same imageFile source as overview). */
export function buildCharacterTokenPreviewPayload(token: CharacterToken, titleFallback = ''): ObjectPreviewPayload | null {
  return buildTabletopImagePreviewPayload(token, titleFallback);
}

/** Terrain: prefer wall art, fall back to floor. */
export function buildTerrainPreviewPayload(
  terrain: { identifier: string; name?: string; wallImage?: { url?: string } | null; floorImage?: { url?: string } | null } | null,
  titleFallback = '',
): ObjectPreviewPayload | null {
  if (!terrain?.identifier) return null;
  const imageUrl = terrain.wallImage?.url || terrain.floorImage?.url || '';
  return buildImagePayload(terrain.identifier, terrain.name || titleFallback || '', imageUrl);
}
