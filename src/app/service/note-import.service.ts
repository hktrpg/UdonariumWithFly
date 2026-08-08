import { Injectable } from '@angular/core';

import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { PdfStorage } from '@udonarium/core/file-storage/pdf-storage';
import { VideoStorage } from '@udonarium/core/file-storage/video-storage';
import { TextNote } from '@udonarium/text-note';

@Injectable({ providedIn: 'root' })
export class NoteImportService {
  async importFiles(files: FileList | File[], options?: { addToTable?: boolean }): Promise<TextNote[]> {
    const list = Array.from(files || []);
    const created: TextNote[] = [];
    for (const file of list) {
      const note = await this.importOne(file);
      if (!note) continue;
      if (options?.addToTable !== false) note.addToTable();
      else note.setLocation('common');
      created.push(note);
    }
    return created;
  }

  private async importOne(file: File): Promise<TextNote | null> {
    if (!file) return null;
    const name = (file.name || '').replace(/\.[^.]+$/, '') || 'Note';
    const type = (file.type || '').toLowerCase();
    const lower = (file.name || '').toLowerCase();

    if (type === 'application/pdf' || lower.endsWith('.pdf')) {
      const pdf = await PdfStorage.instance.addAsync(file);
      const note = TextNote.create(name, '', 14, 4, 5);
      note.setPdf(pdf.identifier);
      return note;
    }

    if (type.indexOf('video/') === 0 || /\.(mp4|webm|mov|m4v|ogv)$/i.test(lower)) {
      const video = await VideoStorage.instance.addAsync(file);
      const note = TextNote.create(name, '', 14, 5, 4);
      note.setVideo(video.identifier);
      return note;
    }

    if (type.indexOf('image/') === 0 || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(lower)) {
      const image = await ImageStorage.instance.addAsync(file);
      const note = TextNote.create(name, '', 14, 3, 3);
      note.setFrontImage(image.identifier);
      note.contentMode = 'image';
      return note;
    }

    if (type.indexOf('text/') === 0 || /\.(txt|md|csv)$/i.test(lower)) {
      const text = await file.text();
      return TextNote.create(name, text.slice(0, 20000), 14, 3, 3);
    }

    return null;
  }
}
