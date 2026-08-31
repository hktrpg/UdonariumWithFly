import { TextNote } from '@udonarium/text-note';

export type NoteHandoutPayload = {
  name?: string;
  imageUrl?: string;
  pdfIdentifier?: string;
  pdfPage?: number;
  pdfPageCount?: number;
  videoIdentifier?: string;
  videoUrl?: string;
  text?: string;
  noteIdentifier?: string;
  /** Local Ctrl+hover preview; stays open until Ctrl release. A/D turns PDF pages while open. */
  preview?: boolean;
};

export function buildNoteHandoutPayload(note: TextNote, nameFallback: string): NoteHandoutPayload {
  if (!note) return {};
  // Match tabletop: flipped + back art replaces PDF/video/text with the back image.
  if (note.isFlipped && note.hasBackImage) {
    return {
      name: note.title || nameFallback,
      imageUrl: note.backImage?.url || '',
      noteIdentifier: note.identifier,
    };
  }
  const kind = note.contentKind;
  return {
    name: note.title || nameFallback,
    imageUrl: (kind === 'image' || kind === 'text') ? TextNote.resolveHandoutImageUrl(note) : '',
    pdfIdentifier: kind === 'pdf' ? note.pdfIdentifier : '',
    pdfPage: note.pdfPage || 1,
    pdfPageCount: note.pdfPageCount || 0,
    videoIdentifier: kind === 'video' ? note.videoIdentifier : '',
    videoUrl: kind === 'video' ? note.resolvedVideoUrl : '',
    text: kind === 'text' ? (note.text || '') : '',
    noteIdentifier: note.identifier,
  };
}
