import { EventSystem } from '../system';
import {
  addPackedByContentHash,
  buildCompleteBlobCatalog,
  deleteMediaFromHash,
  getOrHydrateUrlBacked,
  insertOrUpdateMediaFile,
  LazyCatalogSynchronizer,
  MediaCatalogItem,
} from './media-storage-helpers';
import { PdfFile, PdfFileContext, PdfState } from './pdf-file';

export type PdfCatalogItem = MediaCatalogItem;

export class PdfStorage {
  private static _instance: PdfStorage;
  static get instance(): PdfStorage {
    if (!PdfStorage._instance) PdfStorage._instance = new PdfStorage();
    return PdfStorage._instance;
  }

  private readonly catalogSync = new LazyCatalogSynchronizer(peer => {
    EventSystem.call('SYNCHRONIZE_PDF_LIST', this.getCatalog(), peer);
  });
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
    return addPackedByContentHash({
      file,
      completeState: PdfState.COMPLETE,
      get: id => this.get(id),
      addAsync: f => this.addAsync(f),
      createPacked: (f, hash) => PdfFile.createPackedAsync(f, hash),
      store: pdf => this._add(pdf),
    });
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
    return insertOrUpdateMediaFile({
      hash: this.hash,
      file: pdf,
      completeState: PdfState.COMPLETE,
      lazySynchronize: ms => this.lazySynchronize(ms),
      tryUpdate: file => this.update(file),
    });
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
    return deleteMediaFromHash(this.hash, identifier);
  }

  get(identifier: string): PdfFile {
    return getOrHydrateUrlBacked({
      hash: this.hash,
      identifier,
      createUrlBacked: id => PdfFile.create(id),
      store: file => this._add(file),
    });
  }

  synchronize(peer?: string) {
    this.catalogSync.synchronize(peer);
  }

  lazySynchronize(ms: number, peer?: string) {
    this.catalogSync.lazySynchronize(ms, peer);
  }

  getCatalog(): PdfCatalogItem[] {
    return buildCompleteBlobCatalog(this.pdfs, PdfState.COMPLETE);
  }
}
