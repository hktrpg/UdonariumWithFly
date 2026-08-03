/** Shared image-effect helpers for character tokens / previews / chat icons. */

export interface ImageEffectSource {
  isInverse?: boolean;
  isHollow?: boolean;
  isBlackPaint?: boolean;
  isGrayscale?: boolean;
  isSepia?: boolean;
  isWhitePaint?: boolean;
  isMatrix?: boolean;
  isFlipVertical?: boolean;
  isContrast?: boolean;
  /** Token-only: FX status dead also forces grayscale. */
  isDead?: boolean;
}

const FX_TAGS = [
  'grayscale',
  'sepia',
  'white-paint',
  'matrix',
  'flip-vertical',
  'contrast',
] as const;

export type ImageFxTag = typeof FX_TAGS[number];

export function imageEffectFilter(s: ImageEffectSource): string | null {
  const f: string[] = [];
  if (s.isMatrix) {
    f.push('grayscale(1)', 'contrast(1.4)', 'brightness(0.72)', 'sepia(1)', 'hue-rotate(85deg)', 'saturate(5.5)');
  } else {
    if (s.isGrayscale || s.isDead) f.push('grayscale(1)');
    if (s.isSepia) f.push('sepia(1)');
  }
  if (s.isContrast) f.push('contrast(1.7)', 'brightness(1.15)');
  // Silhouette last so it wins over tint effects.
  if (s.isWhitePaint) f.push('brightness(0)', 'invert(1)');
  else if (s.isBlackPaint) f.push('brightness(0)');
  if (s.isHollow) f.push('blur(1px)');
  return f.length ? f.join(' ') : null;
}

export function imageEffectTransform(s: ImageEffectSource): string | null {
  const sx = s.isInverse ? -1 : 1;
  const sy = s.isFlipVertical ? -1 : 1;
  if (sx === 1 && sy === 1) return null;
  return `scale(${sx}, ${sy})`;
}

export function imageEffectOpacity(s: ImageEffectSource): number | null {
  return s.isHollow ? 0.6 : null;
}

export function anyImageEffect(s: ImageEffectSource): boolean {
  return !!(
    s.isInverse || s.isHollow || s.isBlackPaint ||
    s.isGrayscale || s.isSepia || s.isWhitePaint ||
    s.isMatrix || s.isFlipVertical || s.isContrast
  );
}

export function clearImageEffects(target: {
  isInverse: boolean;
  isHollow: boolean;
  isBlackPaint: boolean;
  isGrayscale: boolean;
  isSepia: boolean;
  isWhitePaint: boolean;
  isMatrix: boolean;
  isFlipVertical: boolean;
  isContrast: boolean;
}): void {
  target.isInverse = false;
  target.isHollow = false;
  target.isBlackPaint = false;
  target.isGrayscale = false;
  target.isSepia = false;
  target.isWhitePaint = false;
  target.isMatrix = false;
  target.isFlipVertical = false;
  target.isContrast = false;
}

export function packImageFx(s: ImageEffectSource): string {
  const tags: string[] = [];
  if (s.isGrayscale) tags.push('grayscale');
  if (s.isSepia) tags.push('sepia');
  if (s.isWhitePaint) tags.push('white-paint');
  if (s.isMatrix) tags.push('matrix');
  if (s.isFlipVertical) tags.push('flip-vertical');
  if (s.isContrast) tags.push('contrast');
  return tags.join(' ');
}

export function unpackImageFx(fx: string): ImageEffectSource {
  const set = new Set((fx || '').split(/\s+/).filter(Boolean));
  return {
    isGrayscale: set.has('grayscale'),
    isSepia: set.has('sepia'),
    isWhitePaint: set.has('white-paint'),
    isMatrix: set.has('matrix'),
    isFlipVertical: set.has('flip-vertical'),
    isContrast: set.has('contrast'),
  };
}

/** CSS class names for legacy class-based surfaces (chat icons, etc.). */
export function imageEffectCssClasses(s: ImageEffectSource): string[] {
  const c: string[] = [];
  if (s.isInverse) c.push('inverse');
  if (s.isFlipVertical) c.push('flip-vertical');
  if (s.isHollow) c.push('hollow');
  if (s.isBlackPaint) c.push('black-paint');
  if (s.isWhitePaint) c.push('white-paint');
  if (s.isGrayscale) c.push('grayscale');
  if (s.isSepia) c.push('sepia');
  if (s.isMatrix) c.push('matrix');
  if (s.isContrast) c.push('contrast-fx');
  return c;
}

/** One vertical stream of glyphs for the Matrix digital-rain overlay. */
export interface MatrixRainColumn {
  text: string;
  duration: string;
  delay: string;
  fontSize: string;
  up: boolean;
  opacity: number;
}

const MATRIX_GLYPHS =
  'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ#$%&*+<>';

function matrixSeedHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function matrixRand(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Matrix rain columns (stable across change-detection). */
export function buildMatrixRainColumns(
  seed: string,
  columnCount: number,
  charsPerColumn = 16,
): MatrixRainColumn[] {
  const rand = matrixRand(matrixSeedHash(seed || 'matrix'));
  const n = Math.max(3, Math.min(20, columnCount | 0));
  const cols: MatrixRainColumn[] = [];
  for (let i = 0; i < n; i++) {
    const len = charsPerColumn + Math.floor(rand() * 12);
    let text = '';
    for (let j = 0; j < len; j++) {
      text += MATRIX_GLYPHS[Math.floor(rand() * MATRIX_GLYPHS.length)];
    }
    cols.push({
      text,
      duration: `${2.0 + rand() * 4.0}s`,
      delay: `${-rand() * 5}s`,
      fontSize: `${6 + Math.floor(rand() * 6)}px`,
      up: rand() < 0.38,
      opacity: 0.4 + rand() * 0.6,
    });
  }
  return cols;
}
