import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';

import { EventSystem, Network } from '@udonarium/core/system';
import { GameTable } from '@udonarium/game-table';
import { PeerCursor } from '@udonarium/peer-cursor';
import { TableSelecter } from '@udonarium/table-selecter';
import { fetchStreetscapeCatalog } from '@udonarium/streetscape/catalog-source';
import { streetscapeErrorI18nKey } from '@udonarium/streetscape/errors';
import {
  downloadStreetscapePack,
  streetscapePackDownloadName,
} from '@udonarium/streetscape/export-pack';
import {
  appendStreetscapeFacadesToTable,
  appendStreetscapeModelsToTable,
  generateStreetscape,
  registerBuiltinStreetscapeSources,
  StreetscapeProgress,
} from '@udonarium/streetscape/orchestrator';
import { StreetscapePackV1 } from '@udonarium/streetscape/pack-schema';
import {
  loadPlateauCities,
  pickPlateauBldgFile,
  searchPlateauCityGml,
  suggestPlateauCities,
} from '@udonarium/streetscape/plateau-catalog';
import { resolveStreetscapeSource } from '@udonarium/streetscape/registry';
import { StreetscapeQuery } from '@udonarium/streetscape/source';
import {
  STREETSCAPE_COUNTRIES,
  StreetscapeCountryId,
  normalizeStreetscapeCountry,
} from '@udonarium/streetscape/streetscape-country';
import {
  loadStreetSheetIndex,
  looksLikeOpen3dhkSheetId,
  resolveStreetToSheet,
  suggestStreetSheets,
  StreetSheetSuggestion,
} from '@udonarium/streetscape/street-sheet-index';
import {
  getStreetscapeUiSession,
  setStreetscapeUiSession,
} from '@udonarium/streetscape/streetscape-ui-session';
import { packagePathOf } from '@udonarium/terrain-model/model-package-files';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';

type StreetscapeSuggestItem = {
  label: string;
  code: string;
  streetValue: string;
};
@Component({
  selector: 'streetscape-import',
  templateUrl: './streetscape-import.component.html',
  styleUrls: ['../shared/settings-ui.css', './streetscape-import.component.css'],
  standalone: false,
})
export class StreetscapeImportComponent implements OnInit, OnDestroy {
  readonly streetscapeCountries = STREETSCAPE_COUNTRIES;
  streetscapeCountry: StreetscapeCountryId = 'hk';
  streetscapeBusy = false;
  streetscapeStatus = '';
  streetscapeStreet = '';
  streetscapeStreetSuggestions: StreetscapeSuggestItem[] = [];
  streetscapeAttribution = '';
  /** Soft UX threshold — above this, show a lag / memory warning (not a hard cap). */
  static readonly MAX_FEATURES_WARN = 10;
  /** Buildings to keep on first create (≥1). */
  streetscapeMaxFeatures = 4;
  /** Buildings to append on each「新增模型」click. */
  streetscapeAddCount = 4;
  /** After create: sheet context for incremental model adds. */
  streetscapeActive: {
    country: StreetscapeCountryId;
    tableId: string;
    sheet: string;
    title?: string;
    street?: string;
    worldExtent: { minX: number; maxX: number; minZ: number; maxZ: number };
    placedBuildingIds: string[];
    plateau?: {
      cityCode: string;
      cityName: string;
      meshCode: string;
      gmlUrl: string;
    };
  } | null = null;

  get streetscapeMaxFeaturesWarn(): boolean {
    const n = Number(this.streetscapeMaxFeatures);
    return Number.isFinite(n) && n > StreetscapeImportComponent.MAX_FEATURES_WARN;
  }

  get streetscapeAddCountWarn(): boolean {
    const n = Number(this.streetscapeAddCount);
    return Number.isFinite(n) && n > StreetscapeImportComponent.MAX_FEATURES_WARN;
  }
  /** After gray create: pending textured facade download for the same building ids. */
  streetscapeDeferred: {
    tableId: string;
    sheet: string;
    title?: string;
    street?: string;
    maxFeatures: number;
    buildingIds: string[];
    estimatedFacadeBytes: number;
    worldExtent: { minX: number; maxX: number; minZ: number; maxZ: number };
  } | null = null;
  /** Last successful Open3Dhk/file pack members — save pack. */
  streetscapeExport: {
    pack: StreetscapePackV1;
    files: File[];
    fileName: string;
  } | null = null;
  private streetscapeProgressPersistAt = 0;

  get viewTable(): GameTable {
    return TableSelecter.instance.viewTable;
  }

  get canActivate(): boolean {
    return !!PeerCursor.myCursor?.isGMMode && !this.GuestMode();
  }

  get streetscapeCanDeferFacades(): boolean {
    const table = this.viewTable;
    return !!this.streetscapeDeferred
      && !!table
      && this.streetscapeDeferred.tableId === table.identifier
      && this.streetscapeDeferred.buildingIds.length > 0;
  }

  get streetscapeCanExportPack(): boolean {
    return !!this.streetscapeExport?.files?.length && !this.streetscapeBusy;
  }

  get streetscapeCanAddModels(): boolean {
    const table = this.viewTable;
    const active = this.streetscapeActive;
    return !!active
      && !!table
      && active.tableId === table.identifier
      && !!active.sheet
      && !!active.worldExtent;
  }

  constructor(
    private changeDetector: ChangeDetectorRef,
    private modalService: ModalService,
    private panelService: PanelService,
    private i18n: I18nService,
  ) {}

  GuestMode() {
    return Network.GuestMode();
  }

  ngOnInit() {
    Promise.resolve().then(() => this.refreshPanelTitle());
    registerBuiltinStreetscapeSources();
    this.restoreStreetscapeUiSession();
    EventSystem.register(this)
      .on('SELECT_GAME_TABLE', () => this.changeDetector.markForCheck())
      .on('CHANGE_GM_MODE', () => this.changeDetector.markForCheck())
      .on('LOCALE_CHANGED', () => this.refreshPanelTitle());
  }

  ngOnDestroy() {
    this.persistStreetscapeUiSession();
    EventSystem.unregister(this);
  }

  /** Panel close destroys this component — keep download info for reopen. */
  get streetscapeIsJapan(): boolean {
    return this.streetscapeCountry === 'jp';
  }

  get streetscapeShowLandsdCredit(): boolean {
    return !this.streetscapeIsJapan;
  }

  onStreetscapeCountryChange() {
    this.streetscapeCountry = normalizeStreetscapeCountry(this.streetscapeCountry);
    this.streetscapeStreetSuggestions = [];
    this.streetscapeActive = null;
    this.streetscapeDeferred = null;
    this.persistStreetscapeUiSession();
    this.changeDetector.markForCheck();
  }

  private persistStreetscapeUiSession() {
    setStreetscapeUiSession({
      status: this.streetscapeStatus,
      attribution: this.streetscapeAttribution,
      street: this.streetscapeStreet,
      country: this.streetscapeCountry,
      maxFeatures: this.streetscapeMaxFeatures,
      addModelCount: this.streetscapeAddCount,
      active: this.streetscapeActive,
      deferred: this.streetscapeDeferred,
      exportPack: this.streetscapeExport,
    });
  }

  private restoreStreetscapeUiSession() {
    const s = getStreetscapeUiSession();
    this.streetscapeStatus = s.status;
    this.streetscapeAttribution = s.attribution;
    this.streetscapeStreet = s.street;
    this.streetscapeCountry = normalizeStreetscapeCountry(s.country);
    this.streetscapeMaxFeatures = s.maxFeatures;
    this.streetscapeAddCount = s.addModelCount;
    this.streetscapeActive = s.active;
    this.streetscapeDeferred = s.deferred;
    this.streetscapeExport = s.exportPack;
  }

  private refreshPanelTitle() {
    this.panelService.title = this.i18n.t('streetscape.title');
  }

  async onStreetscapePack(ev: Event) {
    if (!this.canActivate || this.streetscapeBusy) return;
    const input = ev.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';
    if (!files.length) return;
    await this.runStreetscape({ type: 'file', files });
  }

  async createStreetscapeFromStreet() {
    if (!this.canActivate || this.streetscapeBusy) return;
    const q = this.streetscapeStreet.trim();
    if (!q) return;

    if (this.streetscapeCountry === 'jp') {
      await this.createStreetscapeFromJapan(q);
      return;
    }

    if (looksLikeOpen3dhkSheetId(q)) {
      await this.startOpen3dhk({ sheet: q });
      return;
    }

    let hit: StreetSheetSuggestion | null = null;
    try {
      const index = await loadStreetSheetIndex();
      hit = resolveStreetToSheet(index, q);
    } catch {
      hit = null;
    }
    if (!hit?.sheet) {
      await this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('streetscape.errorTitle'),
        text: this.i18n.t('streetscape.error.noStreetMatch'),
        type: ConfirmationType.OK,
        materialIcon: 'error',
      });
      return;
    }

    const ok = await this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('streetscape.confirmSheetTitle'),
      text: this.i18n.t('streetscape.confirmSheetCode', {
        name: hit.label,
        sheet: hit.sheet,
      }),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'map',
      okLabel: this.i18n.t('streetscape.confirmSheetOk'),
      cancelLabel: this.i18n.t('streetscape.confirmCancel'),
    });
    if (!ok) return;

    this.streetscapeStreetSuggestions = [];
    await this.startOpen3dhk({
      sheet: hit.sheet,
      street: hit.zh || hit.en || q,
      title: hit.label,
    });
  }

  private async createStreetscapeFromJapan(q: string) {
    let hits;
    try {
      hits = await searchPlateauCityGml(q);
    } catch {
      await this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('streetscape.errorTitle'),
        text: this.i18n.t('streetscape.error.noStreetMatchJp'),
        type: ConfirmationType.OK,
        materialIcon: 'error',
      });
      return;
    }
    const hintCode = this.streetscapeStreetSuggestions.find(s => s.streetValue === q)?.code || '';
    const hit = (hintCode && hits.find(h => h.cityCode === hintCode))
      || hits.find(h => h.cityName && (q.includes(h.cityName) || h.cityName.includes(q)))
      || hits[0];
    const file = pickPlateauBldgFile(hit.files);
    const ok = await this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('streetscape.confirmSheetTitle'),
      text: this.i18n.t('streetscape.confirmPlateauMesh', {
        name: hit.cityName || q,
        sheet: file.code,
      }),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'map',
      okLabel: this.i18n.t('streetscape.confirmSheetOk'),
      cancelLabel: this.i18n.t('streetscape.confirmCancel'),
    });
    if (!ok) return;

    this.streetscapeStreetSuggestions = [];
    const max = Math.max(1, Math.floor(Number(this.streetscapeMaxFeatures) || 4));
    this.streetscapeMaxFeatures = max;
    await this.runStreetscape({
      type: 'plateau',
      street: q,
      title: `PLATEAU ${hit.cityName}`,
      cityCode: hit.cityCode,
      cityName: hit.cityName,
      meshCode: file.code,
      gmlUrl: file.url,
      maxFeatures: max,
    }, {
      country: 'jp',
      plateau: {
        cityCode: hit.cityCode,
        cityName: hit.cityName,
        meshCode: file.code,
        gmlUrl: file.url,
      },
    });
  }

  async onStreetscapeStreetInput() {
    const q = this.streetscapeStreet.trim();
    if (!q || q.length < 1) {
      this.streetscapeStreetSuggestions = [];
      this.changeDetector.markForCheck();
      return;
    }
    if (this.streetscapeCountry === 'jp') {
      try {
        const cities = await loadPlateauCities();
        this.streetscapeStreetSuggestions = suggestPlateauCities(cities, q, 10).map(s => ({
          label: s.label,
          code: s.cityCode,
          streetValue: s.city,
        }));
      } catch {
        this.streetscapeStreetSuggestions = [];
      }
      this.changeDetector.markForCheck();
      return;
    }
    if (looksLikeOpen3dhkSheetId(q)) {
      this.streetscapeStreetSuggestions = [];
      this.changeDetector.markForCheck();
      return;
    }
    try {
      const index = await loadStreetSheetIndex();
      this.streetscapeStreetSuggestions = suggestStreetSheets(index, q, 10).map(s => ({
        label: s.label,
        code: s.sheet,
        streetValue: s.zh || s.en || s.sheet,
      }));
    } catch {
      this.streetscapeStreetSuggestions = [];
    }
    this.changeDetector.markForCheck();
  }

  pickStreetscapeSuggestion(s: StreetscapeSuggestItem) {
    this.streetscapeStreet = s.streetValue || s.label;
    this.streetscapeStreetSuggestions = [];
    this.changeDetector.markForCheck();
  }

  async saveStreetscapePack() {
    if (!this.canActivate || !this.streetscapeExport?.files?.length) return;
    const { pack, files, fileName } = this.streetscapeExport;
    this.streetscapeBusy = true;
    this.streetscapeStatus = this.i18n.t('streetscape.savingPack');
    this.changeDetector.markForCheck();
    try {
      await downloadStreetscapePack(pack, files, fileName);
      this.streetscapeStatus = this.i18n.t('streetscape.savedPack');
    } catch (err) {
      await this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('streetscape.errorTitle'),
        text: this.i18n.t(streetscapeErrorI18nKey(err)),
        type: ConfirmationType.OK,
        materialIcon: 'error',
      });
    } finally {
      this.streetscapeBusy = false;
      this.persistStreetscapeUiSession();
      this.changeDetector.markForCheck();
    }
  }

  async downloadDeferredFacades() {
    if (!this.canActivate || this.streetscapeBusy || !this.streetscapeCanDeferFacades) return;
    const deferred = this.streetscapeDeferred!;
    const table = this.viewTable;
    if (!table || table.identifier !== deferred.tableId) return;

    const n = deferred.buildingIds.length || deferred.maxFeatures;
    const ok = await this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('streetscape.confirmTitle'),
      text: this.i18n.t('streetscape.confirmDeferredFacades', {
        buildings: String(n),
      }),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'location_city',
      okLabel: this.i18n.t('streetscape.confirmDownload'),
      cancelLabel: this.i18n.t('streetscape.confirmCancel'),
    });
    if (!ok) return;

    this.streetscapeBusy = true;
    this.streetscapeStatus = this.i18n.t('streetscape.busyTextured');
    this.changeDetector.markForCheck();
    try {
      registerBuiltinStreetscapeSources();
      const query: StreetscapeQuery = {
        type: 'open3dhk',
        sheet: deferred.sheet,
        street: deferred.street,
        format: 'GLTF',
        maxFeatures: deferred.buildingIds.length || deferred.maxFeatures,
        useRange: true,
        rangeMode: 'buildings',
        buildingIds: deferred.buildingIds.slice(),
        reuseWorldExtent: deferred.worldExtent,
      };
      const source = resolveStreetscapeSource(query);
      const load = await source.resolve(query, undefined, (p) => {
        this.applyStreetscapeSourceProgress(p);
      });
      const result = await appendStreetscapeFacadesToTable(table, load, {
        onProgress: (p) => this.applyStreetscapeBakeProgress(p),
      });
      this.streetscapeAttribution = result.attribution;
      this.streetscapeDeferred = null;
      this.rememberStreetscapeExport(result.pack, result.exportFiles);
      const warn = result.warnings.filter(Boolean).slice(0, 4).join('; ');
      this.streetscapeStatus = warn
        ? this.i18n.t('streetscape.warnings', { detail: warn })
        : this.i18n.t('streetscape.doneFacades');
    } catch (err) {
      this.streetscapeStatus = '';
      await this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('streetscape.errorTitle'),
        text: this.i18n.t(streetscapeErrorI18nKey(err)),
        type: ConfirmationType.OK,
        materialIcon: 'error',
      });
    } finally {
      this.streetscapeBusy = false;
      this.persistStreetscapeUiSession();
      this.changeDetector.markForCheck();
    }
  }

  async addStreetscapeModels() {
    if (!this.canActivate || this.streetscapeBusy || !this.streetscapeCanAddModels) return;
    const active = this.streetscapeActive!;
    const table = this.viewTable;
    if (!table || table.identifier !== active.tableId) return;

    const count = Math.max(1, Math.floor(Number(this.streetscapeAddCount) || 4));
    this.streetscapeAddCount = count;

    this.streetscapeBusy = true;
    this.streetscapeStatus = this.i18n.t('streetscape.busyAddModels');
    this.changeDetector.markForCheck();
    try {
      registerBuiltinStreetscapeSources();
      const exclude = this.mergePlacedBuildingIds(active.placedBuildingIds);
      const query: StreetscapeQuery = active.country === 'jp' && active.plateau
        ? {
          type: 'plateau',
          street: active.street,
          title: active.title,
          cityCode: active.plateau.cityCode,
          cityName: active.plateau.cityName,
          meshCode: active.plateau.meshCode,
          gmlUrl: active.plateau.gmlUrl,
          maxFeatures: count,
          excludeBuildingIds: exclude,
        }
        : {
          type: 'open3dhk',
          sheet: active.sheet,
          street: active.street,
          format: 'GLTF0',
          maxFeatures: count,
          useRange: true,
          rangeMode: 'buildings',
          reuseWorldExtent: active.worldExtent,
          excludeBuildingIds: exclude,
        };
      const source = resolveStreetscapeSource(query);
      const load = await source.resolve(query, undefined, (p) => {
        this.applyStreetscapeSourceProgress(p);
      });
      const result = await appendStreetscapeModelsToTable(table, load, {
        onProgress: (p) => this.applyStreetscapeBakeProgress(p),
      });
      const newIds = (result.pack.features || []).map(f => f.id).filter(Boolean);
      const placed = this.mergePlacedBuildingIds([...exclude, ...newIds]);
      this.streetscapeActive = {
        ...active,
        placedBuildingIds: placed,
        worldExtent: result.worldExtent || active.worldExtent,
      };
      this.streetscapeAttribution = result.attribution || this.streetscapeAttribution;
      this.rememberStreetscapeExport(result.pack, result.exportFiles);
      if (newIds.length && active.country === 'hk' && active.sheet) {
        const prev = this.streetscapeDeferred;
        const pendingIds = this.mergePlacedBuildingIds([
          ...(prev?.tableId === table.identifier ? prev.buildingIds : []),
          ...newIds,
        ]);
        this.streetscapeDeferred = {
          tableId: table.identifier,
          sheet: active.sheet,
          title: active.title,
          street: active.street,
          maxFeatures: pendingIds.length,
          buildingIds: pendingIds,
          estimatedFacadeBytes: 0,
          worldExtent: this.streetscapeActive.worldExtent,
        };
      }
      const warn = result.warnings.filter(w => w && !w.includes('already on map')).slice(0, 4).join('; ');
      this.streetscapeStatus = warn
        ? this.i18n.t('streetscape.warnings', { detail: warn })
        : this.i18n.t('streetscape.doneAddModels', { count: String(newIds.length) });
    } catch (err) {
      this.streetscapeStatus = '';
      await this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('streetscape.errorTitle'),
        text: this.i18n.t(streetscapeErrorI18nKey(err)),
        type: ConfirmationType.OK,
        materialIcon: 'error',
      });
    } finally {
      this.streetscapeBusy = false;
      this.persistStreetscapeUiSession();
      this.changeDetector.markForCheck();
    }
  }

  private mergePlacedBuildingIds(ids: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of ids) {
      const id = String(raw || '').trim();
      if (!id) continue;
      const key = id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(id);
    }
    return out;
  }

  private open3dhkQuery(
    base: { sheet?: string; street?: string },
    extra: Partial<Extract<StreetscapeQuery, { type: 'open3dhk' }>> = {},
  ): Extract<StreetscapeQuery, { type: 'open3dhk' }> {
    const max = Math.max(1, Math.floor(Number(this.streetscapeMaxFeatures) || 4));
    this.streetscapeMaxFeatures = max;
    return {
      type: 'open3dhk',
      ...base,
      // Always gray shells + aerial map first; textured facades via deferred download.
      format: 'GLTF0',
      maxFeatures: max,
      useRange: true,
      rangeMode: 'all',
      ...extra,
    };
  }

  private async startOpen3dhk(base: { sheet?: string; street?: string; title?: string }) {
    let query = this.open3dhkQuery({ sheet: base.sheet, street: base.street });

    // Resolve sheet id early when user typed a street name.
    if (!query.sheet && query.street) {
      try {
        if (looksLikeOpen3dhkSheetId(query.street)) {
          query = this.open3dhkQuery({ sheet: query.street.trim(), street: query.street });
          base = { ...base, sheet: query.sheet };
        } else {
          const catalog = await fetchStreetscapeCatalog();
          const want = query.street.toLowerCase();
          const matched = catalog.streets.find(s => {
            const street = (s.street || '').toLowerCase();
            const title = (s.title || '').toLowerCase();
            return street === want || title.includes(want) || street.includes(want);
          });
          if (matched?.sheet) {
            query = this.open3dhkQuery({ sheet: matched.sheet, street: matched.street || query.street });
            base = { ...base, sheet: matched.sheet, title: matched.title || base.title, street: matched.street };
          } else {
            const index = await loadStreetSheetIndex();
            const hit = resolveStreetToSheet(index, query.street);
            if (hit?.sheet) {
              query = this.open3dhkQuery({ sheet: hit.sheet, street: hit.zh || hit.en || query.street });
              base = { ...base, sheet: hit.sheet, title: base.title || hit.label, street: hit.zh || hit.en };
            }
          }
        }
      } catch {
        // fall through; resolve() will retry catalog / index
      }
    }

    await this.runStreetscape(query, {
      country: 'hk',
      deferFacades: {
        sheet: query.sheet || '',
        title: base.title,
        street: query.street,
      },
    });
  }

  private async runStreetscape(
    query: StreetscapeQuery,
    opts: {
      country?: StreetscapeCountryId;
      plateau?: {
        cityCode: string;
        cityName: string;
        meshCode: string;
        gmlUrl: string;
      };
      deferFacades?: {
        sheet: string;
        title?: string;
        street?: string;
      } | null;
    } = {},
  ) {
    this.streetscapeBusy = true;
    this.streetscapeStatus = this.i18n.t(
      opts.country === 'jp' ? 'streetscape.busyJapan' : 'streetscape.busy',
    );
    this.streetscapeAttribution = '';
    this.streetscapeExport = null;
    this.changeDetector.markForCheck();
    try {
      const result = await generateStreetscape({
        query,
        onProgress: (p: StreetscapeProgress) => this.applyStreetscapeBakeProgress(p),
      });
      // generateStreetscape already viewTableLocal's the new table.
      this.streetscapeAttribution = result.attribution;
      this.rememberStreetscapeExport(result.pack, result.exportFiles);
      const buildingIds = (result.pack.features || []).map(f => f.id).filter(Boolean);
      const country: StreetscapeCountryId = opts.country
        || (query.type === 'plateau' ? 'jp' : 'hk');
      const sheet = opts.plateau?.meshCode
        || opts.deferFacades?.sheet
        || (query.type === 'open3dhk' ? (query.sheet || '') : '')
        || (query.type === 'plateau' ? (query.meshCode || '') : '');
      if (result.worldExtent && sheet) {
        this.streetscapeActive = {
          country,
          tableId: result.table.identifier,
          sheet,
          title: opts.plateau?.cityName || opts.deferFacades?.title,
          street: opts.plateau?.cityName || opts.deferFacades?.street,
          worldExtent: result.worldExtent,
          placedBuildingIds: buildingIds.slice(),
          plateau: opts.plateau,
        };
      } else {
        this.streetscapeActive = null;
      }
      if (country === 'hk' && opts.deferFacades?.sheet && result.worldExtent && buildingIds.length) {
        this.streetscapeDeferred = {
          tableId: result.table.identifier,
          sheet: opts.deferFacades.sheet,
          title: opts.deferFacades.title,
          street: opts.deferFacades.street,
          maxFeatures: buildingIds.length,
          buildingIds,
          estimatedFacadeBytes: 0,
          worldExtent: result.worldExtent,
        };
      } else {
        this.streetscapeDeferred = null;
      }
      const warn = result.warnings.filter(Boolean).slice(0, 4).join('; ');
      this.streetscapeStatus = warn
        ? this.i18n.t('streetscape.warnings', { detail: warn })
        : (this.streetscapeDeferred
          ? this.i18n.t('streetscape.doneMapOnly')
          : this.i18n.t('streetscape.done'));
    } catch (err) {
      this.streetscapeStatus = '';
      await this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('streetscape.errorTitle'),
        text: this.i18n.t(streetscapeErrorI18nKey(err)),
        type: ConfirmationType.OK,
        materialIcon: 'error',
      });
    } finally {
      this.streetscapeBusy = false;
      this.persistStreetscapeUiSession();
      this.changeDetector.markForCheck();
    }
  }

  private rememberStreetscapeExport(pack: StreetscapePackV1, exportFiles?: File[]) {
    if (!exportFiles?.length) return;
    const prev = this.streetscapeExport;
    const byPath = new Map<string, File>();
    if (prev?.files?.length) {
      for (const f of prev.files) {
        const p = packagePathOf(f) || f.name;
        if (p) byPath.set(p, f);
      }
    }
    for (const f of exportFiles) {
      const p = packagePathOf(f) || f.name;
      if (!p) continue;
      // Keep a larger floor.png when merging map-only then facades (placeholder is tiny).
      const existing = byPath.get(p);
      if (existing && p === 'floor.png' && existing.size > f.size) continue;
      byPath.set(p, f);
    }
    const files = Array.from(byPath.values());
    const mergedPack: StreetscapePackV1 = {
      ...pack,
      features: pack.features?.length ? pack.features : (prev?.pack.features || []),
      floor: pack.floor || prev?.pack.floor || { path: 'floor.png' },
      title: pack.title || prev?.pack.title || pack.id,
      attribution: pack.attribution || prev?.pack.attribution || '',
    };
    this.streetscapeExport = {
      pack: mergedPack,
      files,
      fileName: streetscapePackDownloadName(mergedPack),
    };
    this.persistStreetscapeUiSession();
  }

  private applyStreetscapeSourceProgress(p: { phase: string; current: number; total: number; message?: string }) {
    if (p.phase !== 'download') {
      if (p.phase === 'unpack') this.streetscapeStatus = this.i18n.t('streetscape.progressUnpack');
      this.persistStreetscapeUiSession();
      this.changeDetector.detectChanges();
      return;
    }
    if (p.message === 'probe') {
      this.streetscapeStatus = this.i18n.t('streetscape.progressProbe', {
        current: String(p.current),
        total: String(p.total),
      });
    } else if (p.message === 'index' || (p.current <= 0 && !(p.total > 0) && p.message !== 'fetch')) {
      this.streetscapeStatus = this.i18n.t('streetscape.progressIndex');
    } else if (p.total > 0) {
      const loaded = (p.current / (1024 * 1024)).toFixed(1);
      const total = (p.total / (1024 * 1024)).toFixed(1);
      const pct = Math.min(100, Math.round((100 * p.current) / p.total));
      this.streetscapeStatus = this.i18n.t('streetscape.progressDownload', {
        percent: String(pct),
        loaded,
        total,
      });
    } else {
      const loaded = (p.current / (1024 * 1024)).toFixed(1);
      this.streetscapeStatus = this.i18n.t('streetscape.progressDownloadUnknown', { loaded });
    }
    // Persist at most ~2×/sec during multi‑MB Range downloads (was every 64 KiB).
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!this.streetscapeProgressPersistAt || nowMs - this.streetscapeProgressPersistAt > 500) {
      this.streetscapeProgressPersistAt = nowMs;
      this.persistStreetscapeUiSession();
    }
    this.changeDetector.detectChanges();
  }

  private applyStreetscapeBakeProgress(p: StreetscapeProgress) {
    if (p.phase === 'download') {
      if (p.message === 'probe') {
        this.streetscapeStatus = this.i18n.t('streetscape.progressProbe', {
          current: String(p.current),
          total: String(p.total),
        });
      } else if (p.message === 'index' || ((p.loadedMb ?? 0) <= 0 && !(p.totalMb > 0) && p.message !== 'fetch')) {
        this.streetscapeStatus = this.i18n.t('streetscape.progressIndex');
      } else if (p.totalMb != null && p.totalMb > 0) {
        const loaded = (p.loadedMb ?? 0).toFixed(1);
        const pct = Math.min(100, Math.round((100 * (p.loadedMb ?? 0)) / p.totalMb));
        this.streetscapeStatus = this.i18n.t('streetscape.progressDownload', {
          percent: String(pct),
          loaded,
          total: p.totalMb.toFixed(1),
        });
      } else {
        this.streetscapeStatus = this.i18n.t('streetscape.progressDownloadUnknown', {
          loaded: (p.loadedMb ?? 0).toFixed(1),
        });
      }
    } else if (p.phase === 'unpack') {
      this.streetscapeStatus = this.i18n.t('streetscape.progressUnpack');
    } else if (p.phase === 'estimate' && p.mb != null) {
      this.streetscapeStatus = this.i18n.t('streetscape.estimate', { mb: p.mb.toFixed(1) });
    } else if (p.phase === 'floor') {
      this.streetscapeStatus = this.i18n.t('streetscape.progressFloor');
    } else if (p.phase === 'feature') {
      this.streetscapeStatus = this.i18n.t('streetscape.progressFeature', {
        current: p.current,
        total: p.total,
      });
    } else {
      this.streetscapeStatus = this.i18n.t('streetscape.busy');
    }
    this.persistStreetscapeUiSession();
    this.changeDetector.markForCheck();
  }
}
