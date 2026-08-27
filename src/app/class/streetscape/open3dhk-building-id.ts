/**
 * Official Individualised folder ids are 18 chars:
 * `B` + 15 digits + product letter + variant digit.
 * Product letter differs by ZIP: GLTF0 uses `C`, textured GLTF uses `A`
 * (`B352541799701063C0` vs `B352541799701063A0`). Variant `0`/`1`/`2` is shared.
 */

const FOLDER_ID_RE = /^([a-z]\d{15})[a-z](\d)$/;

export function open3dhkBuildingVariantKey(id: string): string | null {
  const n = String(id || '').trim().toLowerCase();
  const m = FOLDER_ID_RE.exec(n);
  return m ? `${m[1]}${m[2]}` : null;
}

/** Drop buildings already placed (exact id or GLTF0↔GLTF variant key). */
export function filterOutOpen3dhkBuildingIds<T extends { id: string }>(
  buildings: T[],
  excludeIds: string[] | undefined | null,
): T[] {
  if (!excludeIds?.length) return buildings.slice();
  const exact = new Set<string>();
  const variants = new Set<string>();
  for (const raw of excludeIds) {
    const id = String(raw || '').trim().toLowerCase();
    if (!id) continue;
    exact.add(id);
    const key = open3dhkBuildingVariantKey(id);
    if (key) variants.add(key);
  }
  return buildings.filter(b => {
    const id = String(b.id || '').trim().toLowerCase();
    if (!id) return true;
    if (exact.has(id)) return false;
    const key = open3dhkBuildingVariantKey(id);
    return !(key && variants.has(key));
  });
}

/** Pick ZIP members for previously placed buildings (GLTF0 ids → GLTF folders). */
export function matchOpen3dhkBuildingsByIds<T extends { id: string }>(
  buildings: T[],
  wantIds: string[],
  maxN = buildings.length,
): T[] {
  const cap = Math.max(0, Math.floor(Number(maxN) || 0));
  const byExact = new Map<string, T>();
  const byVariant = new Map<string, T>();
  for (const b of buildings) {
    const id = String(b.id || '').trim().toLowerCase();
    if (!id) continue;
    if (!byExact.has(id)) byExact.set(id, b);
    const key = open3dhkBuildingVariantKey(id);
    if (key && !byVariant.has(key)) byVariant.set(key, b);
  }

  const selected: T[] = [];
  const seen = new Set<string>();
  for (const raw of wantIds) {
    const id = String(raw || '').trim().toLowerCase();
    if (!id) continue;
    const variantKey = open3dhkBuildingVariantKey(id);
    const hit = byExact.get(id) || (variantKey ? byVariant.get(variantKey) : undefined);
    if (!hit) continue;
    const hitId = hit.id.toLowerCase();
    if (seen.has(hitId)) continue;
    seen.add(hitId);
    selected.push(hit);
    if (selected.length >= cap) break;
  }
  return selected;
}
