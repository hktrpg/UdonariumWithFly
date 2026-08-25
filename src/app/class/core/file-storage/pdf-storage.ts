import { EventSystem } from '../system';
import { ResettableTimeout } from '../system/util/resettable-timeout';
import { catalogByteSize } from './file-transfer-scheduler';
import { PdfFile, PdfFileContext, PdfState } from './pdf-file';
import { isContentHashIdentifier, mediaHashFromName } from 'service/folder-backup-layout';

export type PdfCatalogItem = {
  readonly identifier: string;
  readonly state: number;
  readonly byteSize?: number;
};

export class PdfStorage {
  private static _instance: PdfStorage;
  static get instance(): PdfStorage {
    if (!PdfStorage._instance) PdfStorage._instance = new PdfStorage();
    return PdfStorage._instance;
  }

  private lazyTimer: ResettableTimeout;
  private hash: { [identifier: string]: PdfFile } = {};

  get pdfs(): PdfFile[] {
    return Object.keys(this.hash).map(id => this.hash[id]);
  }

  private constructor() {
  }

  async addAsync(file: File, displayName?: string): Promise<PdfFile>
  async addAsync(blob: Blob, displayName?: string): Promise<PdfFile>
  async addAsync(arg: any, displayName?: string): Promise<PdfFile> {
    const pdf = await PdfFile.createAsync(arg, displayName);
    return this._add(pdf);
  }

  async addPackedAsync(file: File): Promise<PdfFile> {
    const hash = mediaHashFromName(file.name);
    if (!isContentHashIdentifier(hash)) return this.addAsync(file);
    const existing = this.get(hash);
    if (existing && existing.state >= PdfState.COMPLETE) return existing;
    return this._add(await PdfFile.createPackedAsync(file, hash));
  }

  add(url: string): PdfFile
  add(pdf: PdfFile): PdfFile
  add(context: PdfFileContext): PdfFile
  add(arg: any): PdfFile {
    let pdf: PdfFile;
    if (typeof arg === 'string') {
      pdf = PdfFile.create(arg);
    } else if (arg instanceof PdfFile) {
      pdf = arg;
    } else {
      if (this.update(arg)) return this.hash[arg.identifier];
      pdf = PdfFile.create(arg);
    }
    return this._add(pdf);
  }

  private _add(pdf: PdfFile): PdfFile {
    if (pdf.state === PdfState.COMPLETE) this.lazySynchronize(100);
    if (this.update(pdf)) return this.hash[pdf.identifier];
    this.hash[pdf.identifier] = pdf;
    return pdf;
  }

  private update(pdf: PdfFile): boolean
  private update(pdf: PdfFileContext): boolean
  private update(pdf: any): boolean {
    const updatePdf = this.hash[pdf.identifier];
    if (updatePdf) {
      updatePdf.apply(pdf instanceof PdfFile ? pdf.toContext() : pdf);
      return true;
    }
    return false;
  }

  delete(identifier: string): boolean {
    const pdf = this.hash[identifier];
    if (!pdf) return false;
    pdf.destroy();
    delete this.hash[identifier];
    return true;
  }

  get(identifier: string): PdfFile {
    return this.hash[identifier] || null;
  }

  synchronize(peer?: string) {
    if (this.lazyTimer) this.lazyTimer.stop();
    EventSystem.call('SYNCHRONIZE_PDF_LIST', this.getCatalog(), peer);
  }

  lazySynchronize(ms: number, peer?: string) {
    const delay = Math.max(ms, 1500);
    if (this.lazyTimer == null) this.lazyTimer = new ResettableTimeout(() => this.synchronize(peer), delay);
    this.lazyTimer.reset(delay);
  }

  getCatalog(): PdfCatalogItem[] {
    const catalog: PdfCatalogItem[] = [];
    for (const pdf of this.pdfs) {
      if (pdf.state === PdfState.COMPLETE) {
        catalog.push({
          identifier: pdf.identifier,
          state: pdf.state,
          byteSize: catalogByteSize(pdf.blob),
        });
      }
    }
    return catalog;
  }
}
