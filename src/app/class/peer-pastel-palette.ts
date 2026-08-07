/** 90 modern pastel / soft tones for first-time player color assignment. */
export const PEER_PASTEL_PALETTE: readonly string[] = buildPastelPalette();

function buildPastelPalette(): string[] {
  // 18 hues × 5 soft variants = 90
  const hues = [
    0, 14, 28, 38, 48, 58,
    78, 100, 128, 148, 165, 178,
    192, 205, 220, 240, 268, 300,
  ];
  const variants: Array<{ s: number; l: number }> = [
    { s: 48, l: 78 },
    { s: 42, l: 72 },
    { s: 55, l: 82 },
    { s: 38, l: 68 },
    { s: 50, l: 86 },
  ];
  const out: string[] = [];
  for (const h of hues) {
    for (const v of variants) {
      out.push(hslToHex(h, v.s, v.l));
    }
  }
  return out;
}

function hslToHex(h: number, s: number, l: number): string {
  const S = s / 100;
  const L = l / 100;
  const C = (1 - Math.abs(2 * L - 1)) * S;
  const X = C * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - C / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) { r = C; g = X; }
  else if (h < 120) { r = X; g = C; }
  else if (h < 180) { g = C; b = X; }
  else if (h < 240) { g = X; b = C; }
  else if (h < 300) { r = X; b = C; }
  else { r = C; b = X; }
  const toByte = (n: number) => Math.round((n + m) * 255);
  const hex = (n: number) => toByte(n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
