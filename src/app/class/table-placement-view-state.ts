/**
 * Per-map view state stored inside tablePlacements poses.
 * Character sheet / inventory identity stay global; desktop pose & cosmetics go here.
 */
import { ObjectStore } from './core/synchronize-object/object-store';
import { DataElement } from './data-element';

/** Keys mirrored into tablePlacements (optional on each pose). */
export const PLACEMENT_VIEW_STATE_KEYS = [
  // Footprint (DataElements)
  'size',
  'height',
  'heightCurrentValue',
  'altitude',
  'width',
  'depth',
  'length',
  // Orientation / stack
  'rotate',
  'roll',
  'zindex',
  // Image face / FX
  'currntImageIndex',
  'currntIconIndex',
  'isUseIconToOverviewImage',
  'isInverse',
  'isHollow',
  'isBlackPaint',
  'isGrayscale',
  'isSepia',
  'isWhitePaint',
  'isMatrix',
  'isFlipVertical',
  'isContrast',
  'aura',
  'isAltitudeIndicate',
  // Character desktop cosmetics
  'isDropShadow',
  'isShowName',
  'isShowChatBubble',
  'tokenFrame',
  'tokenFrameCaption',
  'floorRing',
  'floorRingColor',
  'floorRingSpeed',
  'pushPin',
  'pushPinAngle',
  'pushPinColor',
  'pushPinStyle',
  'pushPinLeft',
  'pushPinTop',
  // Light / vision radius (per-map)
  'visionRange',
  'brightLight',
  'dimLight',
  // Note paper look
  'isUpright',
  'isFlipped',
  'isWhiteOut',
  'isShowTitle',
  'titleBgColor',
  'textAlign',
  'paperStyle',
  // Card / dice / lock (lock is per-map)
  'cardState',
  'diceFace',
  'isLocked',
  'isLock',
  // Terrain desktop look / collision
  'terrainMode',
  'isSurfaceShading',
  'isInteract',
  'affectsLight',
  'isSlope',
  'slopeDirection',
  // Mask desktop look
  'blendType',
  'borderType',
  'textPosition',
] as const;

export type PlacementViewStateKey = (typeof PLACEMENT_VIEW_STATE_KEYS)[number];

export type PlacementViewState = Partial<Record<PlacementViewStateKey, string | number | boolean>>;

function hasProp(obj: object, key: string): boolean {
  return key in obj;
}

function readNum(obj: any, key: string): number {
  const n = +obj[key];
  return Number.isNaN(n) ? 0 : n;
}

function elNum(el: DataElement | null | undefined, fallback = 0): number {
  if (!el) return fallback;
  const n = +el.value;
  return Number.isNaN(n) ? fallback : n;
}

function commonEl(obj: any, name: string): DataElement | null {
  const root = obj?.commonDataElement as DataElement | null | undefined;
  if (!root || typeof root.getFirstElementByName !== 'function') return null;
  return root.getFirstElementByName(name) || null;
}

export function isViewTable2D(): boolean {
  try {
    const selecter = ObjectStore.instance.get<any>('TableSelecter');
    const id = selecter?.viewedTableIdentifier || selecter?.viewTableIdentifier || '';
    if (!id) return false;
    const table = ObjectStore.instance.get<any>(id);
    return !!(table && table.is2DMode);
  } catch {
    return false;
  }
}

/** Neutral defaults for SyncVar view-state keys the object supports. */
export function defaultPlacementViewState(obj: any): PlacementViewState {
  const out: PlacementViewState = {};
  if (!obj) return out;
  if (hasProp(obj, 'rotate')) out.rotate = 0;
  if (hasProp(obj, 'roll')) out.roll = 0;
  if (hasProp(obj, 'zindex')) out.zindex = 0;
  if (hasProp(obj, 'currntImageIndex')) out.currntImageIndex = 0;
  if (hasProp(obj, 'currntIconIndex')) out.currntIconIndex = 0;
  if (hasProp(obj, 'isUseIconToOverviewImage')) out.isUseIconToOverviewImage = false;
  for (const k of [
    'isInverse', 'isHollow', 'isBlackPaint', 'isGrayscale', 'isSepia',
    'isWhitePaint', 'isMatrix', 'isFlipVertical', 'isContrast', 'isAltitudeIndicate',
    'isDropShadow', 'isShowName', 'isShowChatBubble', 'pushPin',
    'isUpright', 'isFlipped', 'isWhiteOut', 'isShowTitle', 'isLocked', 'isLock',
  ] as const) {
    if (hasProp(obj, k)) {
      // Sensible product defaults (match class field initializers where known).
      if (k === 'isDropShadow' || k === 'isShowName' || k === 'isShowChatBubble' || k === 'isUpright' || k === 'isShowTitle') {
        out[k] = true;
      } else {
        out[k] = false;
      }
    }
  }
  if (hasProp(obj, 'aura')) out.aura = -1;
  if (hasProp(obj, 'tokenFrame')) out.tokenFrame = 'none';
  if (hasProp(obj, 'tokenFrameCaption')) out.tokenFrameCaption = '';
  if (hasProp(obj, 'floorRing')) out.floorRing = 'none';
  if (hasProp(obj, 'floorRingColor')) out.floorRingColor = '';
  if (hasProp(obj, 'floorRingSpeed')) out.floorRingSpeed = 1;
  if (hasProp(obj, 'pushPinColor')) out.pushPinColor = 'red';
  if (hasProp(obj, 'pushPinAngle')) out.pushPinAngle = 0;
  if (hasProp(obj, 'pushPinStyle')) out.pushPinStyle = 0;
  if (hasProp(obj, 'pushPinLeft')) out.pushPinLeft = -4;
  if (hasProp(obj, 'pushPinTop')) out.pushPinTop = -20;
  if (hasProp(obj, 'titleBgColor')) out.titleBgColor = '#1e1e1e';
  if (hasProp(obj, 'textAlign')) out.textAlign = 'left';
  if (hasProp(obj, 'paperStyle')) out.paperStyle = 'none';
  if (hasProp(obj, 'visionRange')) out.visionRange = 6;
  if (hasProp(obj, 'brightLight')) out.brightLight = 0;
  if (hasProp(obj, 'dimLight')) out.dimLight = 0;
  if (hasProp(obj, 'state')) out.cardState = 0;
  if (hasProp(obj, 'face') && typeof obj.face === 'string') out.diceFace = String(obj.face ?? '0');
  if (hasProp(obj, 'mode') && typeof obj.mode === 'number') out.terrainMode = 3; // TerrainViewState.ALL
  if (hasProp(obj, 'isSurfaceShading')) out.isSurfaceShading = true;
  if (hasProp(obj, 'isInteract')) out.isInteract = true;
  if (hasProp(obj, 'affectsLight')) out.affectsLight = false;
  if (hasProp(obj, 'isSlope')) out.isSlope = false;
  if (hasProp(obj, 'slopeDirection')) out.slopeDirection = 0;
  if (hasProp(obj, 'blendType')) out.blendType = 0;
  if (hasProp(obj, 'borderType')) out.borderType = 1;
  if (hasProp(obj, 'textPosition')) out.textPosition = 'middle-center';
  return out;
}

/** Snapshot live SyncVars / DataElements that should be independent per map. */
export function capturePlacementViewState(obj: any): PlacementViewState {
  const out: PlacementViewState = {};
  if (!obj) return out;

  const sizeEl = commonEl(obj, 'size');
  if (sizeEl) out.size = elNum(sizeEl, 1);

  const heightEl = commonEl(obj, 'height');
  if (heightEl) {
    out.height = elNum(heightEl, 0);
    out.heightCurrentValue = heightEl.currentValue == null ? '' : heightEl.currentValue;
  }

  const altitudeEl = commonEl(obj, 'altitude');
  if (altitudeEl) out.altitude = elNum(altitudeEl, 0);

  const widthEl = commonEl(obj, 'width');
  if (widthEl) out.width = elNum(widthEl, 1);
  const depthEl = commonEl(obj, 'depth');
  if (depthEl) out.depth = elNum(depthEl, 1);
  const lengthEl = commonEl(obj, 'length');
  if (lengthEl) out.length = elNum(lengthEl, 1);

  if (hasProp(obj, 'rotate')) out.rotate = readNum(obj, 'rotate');
  // Store SyncVar roll as-is. 2D display forces 0 via component getter — never wipe tip here.
  if (hasProp(obj, 'roll')) out.roll = readNum(obj, 'roll');
  if (hasProp(obj, 'zindex')) out.zindex = readNum(obj, 'zindex');

  if (hasProp(obj, 'currntImageIndex')) out.currntImageIndex = readNum(obj, 'currntImageIndex');
  if (hasProp(obj, 'currntIconIndex')) out.currntIconIndex = readNum(obj, 'currntIconIndex');
  if (hasProp(obj, 'isUseIconToOverviewImage')) out.isUseIconToOverviewImage = !!obj.isUseIconToOverviewImage;

  for (const k of [
    'isInverse', 'isHollow', 'isBlackPaint', 'isGrayscale', 'isSepia',
    'isWhitePaint', 'isMatrix', 'isFlipVertical', 'isContrast', 'isAltitudeIndicate',
  ] as const) {
    if (hasProp(obj, k)) out[k] = !!obj[k];
  }
  if (hasProp(obj, 'aura')) out.aura = readNum(obj, 'aura');

  for (const k of ['isDropShadow', 'isShowName', 'isShowChatBubble', 'pushPin', 'isUpright', 'isFlipped', 'isWhiteOut', 'isShowTitle'] as const) {
    if (hasProp(obj, k)) out[k] = !!obj[k];
  }
  for (const k of ['tokenFrame', 'tokenFrameCaption', 'floorRing', 'floorRingColor', 'pushPinColor', 'titleBgColor', 'textAlign', 'paperStyle'] as const) {
    if (hasProp(obj, k)) out[k] = obj[k] == null ? '' : String(obj[k]);
  }
  for (const k of ['floorRingSpeed', 'pushPinAngle', 'pushPinStyle', 'pushPinLeft', 'pushPinTop', 'visionRange', 'brightLight', 'dimLight'] as const) {
    if (hasProp(obj, k)) out[k] = readNum(obj, k);
  }

  if (hasProp(obj, 'state')) out.cardState = readNum(obj, 'state');
  if (hasProp(obj, 'face') && typeof obj.face === 'string') out.diceFace = String(obj.face ?? '');
  if (hasProp(obj, 'isLocked')) out.isLocked = !!obj.isLocked;
  if (hasProp(obj, 'isLock')) out.isLock = !!obj.isLock;

  if (hasProp(obj, 'mode') && typeof obj.mode === 'number') out.terrainMode = readNum(obj, 'mode');
  for (const k of ['isSurfaceShading', 'isInteract', 'affectsLight', 'isSlope'] as const) {
    if (hasProp(obj, k)) out[k] = !!obj[k];
  }
  if (hasProp(obj, 'slopeDirection')) out.slopeDirection = readNum(obj, 'slopeDirection');
  if (hasProp(obj, 'blendType')) out.blendType = readNum(obj, 'blendType');
  if (hasProp(obj, 'borderType')) out.borderType = readNum(obj, 'borderType');
  if (hasProp(obj, 'textPosition')) out.textPosition = obj.textPosition == null ? '' : String(obj.textPosition);

  return out;
}

/** Apply per-map view state onto live SyncVars / DataElements. */
export function applyPlacementViewState(obj: any, pose: PlacementViewState | null | undefined) {
  if (!obj || !pose) return;

  // SyncVar cosmetics: fill missing pose keys with defaults so map switch
  // does not keep the previous map's live values.
  const defaults = defaultPlacementViewState(obj);
  const effective: PlacementViewState = { ...defaults, ...pickPlacementViewState(pose) };

  const setEl = (name: string, value: any, currentValue?: any) => {
    const el = commonEl(obj, name);
    if (!el) return;
    el.value = value;
    if (currentValue !== undefined) el.currentValue = currentValue;
  };

  // DataElements: only when explicitly stored on the pose (avoid inventing sizes).
  if (pose.size !== undefined) setEl('size', pose.size);
  if (pose.height !== undefined) setEl('height', pose.height, pose.heightCurrentValue);
  if (pose.altitude !== undefined) setEl('altitude', pose.altitude);
  if (pose.width !== undefined) setEl('width', pose.width);
  if (pose.depth !== undefined) setEl('depth', pose.depth);
  if (pose.length !== undefined) setEl('length', pose.length);

  if (effective.rotate !== undefined && hasProp(obj, 'rotate')) obj.rotate = effective.rotate;
  if (effective.roll !== undefined && hasProp(obj, 'roll')) obj.roll = effective.roll;
  if (effective.zindex !== undefined && hasProp(obj, 'zindex')) obj.zindex = effective.zindex;

  if (effective.currntImageIndex !== undefined && hasProp(obj, 'currntImageIndex')) {
    obj.currntImageIndex = effective.currntImageIndex;
  }
  if (effective.currntIconIndex !== undefined && hasProp(obj, 'currntIconIndex')) {
    obj.currntIconIndex = effective.currntIconIndex;
  }
  if (effective.isUseIconToOverviewImage !== undefined && hasProp(obj, 'isUseIconToOverviewImage')) {
    obj.isUseIconToOverviewImage = effective.isUseIconToOverviewImage;
  }
  for (const k of [
    'isInverse', 'isHollow', 'isBlackPaint', 'isGrayscale', 'isSepia',
    'isWhitePaint', 'isMatrix', 'isFlipVertical', 'isContrast', 'isAltitudeIndicate',
    'isDropShadow', 'isShowName', 'isShowChatBubble', 'pushPin',
    'isUpright', 'isFlipped', 'isWhiteOut', 'isShowTitle', 'isLocked', 'isLock',
  ] as const) {
    if (effective[k] !== undefined && hasProp(obj, k)) obj[k] = effective[k];
  }
  if (effective.aura !== undefined && hasProp(obj, 'aura')) obj.aura = effective.aura;

  for (const k of ['tokenFrame', 'tokenFrameCaption', 'floorRing', 'floorRingColor', 'pushPinColor', 'titleBgColor', 'textAlign', 'paperStyle'] as const) {
    if (effective[k] !== undefined && hasProp(obj, k)) obj[k] = effective[k];
  }
  for (const k of ['floorRingSpeed', 'pushPinAngle', 'pushPinStyle', 'pushPinLeft', 'pushPinTop', 'visionRange', 'brightLight', 'dimLight'] as const) {
    if (effective[k] !== undefined && hasProp(obj, k)) obj[k] = effective[k];
  }

  if (effective.cardState !== undefined && hasProp(obj, 'state')) obj.state = effective.cardState;
  if (effective.diceFace !== undefined && hasProp(obj, 'face')) obj.face = effective.diceFace;

  if (effective.terrainMode !== undefined && hasProp(obj, 'mode') && typeof obj.mode === 'number') {
    obj.mode = effective.terrainMode;
  }
  for (const k of ['isSurfaceShading', 'isInteract', 'affectsLight', 'isSlope'] as const) {
    if (effective[k] !== undefined && hasProp(obj, k)) obj[k] = effective[k];
  }
  if (effective.slopeDirection !== undefined && hasProp(obj, 'slopeDirection')) {
    obj.slopeDirection = effective.slopeDirection;
  }
  if (effective.blendType !== undefined && hasProp(obj, 'blendType')) obj.blendType = effective.blendType;
  if (effective.borderType !== undefined && hasProp(obj, 'borderType')) obj.borderType = effective.borderType;
  if (effective.textPosition !== undefined && hasProp(obj, 'textPosition')) {
    obj.textPosition = effective.textPosition;
  }
}

export function placementHasViewState(pose: any): boolean {
  if (!pose) return false;
  return PLACEMENT_VIEW_STATE_KEYS.some(k => pose[k] !== undefined);
}

export function pickPlacementViewState(pose: any): PlacementViewState {
  const out: PlacementViewState = {};
  if (!pose) return out;
  for (const k of PLACEMENT_VIEW_STATE_KEYS) {
    if (pose[k] !== undefined) (out as any)[k] = pose[k];
  }
  return out;
}

export function viewStatesEqual(a: any, b: any): boolean {
  for (const k of PLACEMENT_VIEW_STATE_KEYS) {
    const av = a?.[k];
    const bv = b?.[k];
    if (av === bv) continue;
    if (String(av ?? '') !== String(bv ?? '')) return false;
  }
  return true;
}
