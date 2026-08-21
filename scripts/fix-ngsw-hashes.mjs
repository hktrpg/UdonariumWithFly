/**
 * After changing dist/.../index.html (e.g. base href), regenerate ngsw.json hashes
 * so Service Worker installs do not fail with Hash mismatch.
 *
 * Usage (from repo root, after ng build):
 *   node scripts/fix-ngsw-hashes.mjs dist/udonarium [/optional-base-href]
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, process.argv[2] || 'dist/udonarium');
const baseHref = process.argv[3] || '';
const config = join(root, 'src', 'ngsw-config.json');
const ngswCli = join(root, 'node_modules', '@angular', 'service-worker', 'ngsw-config.js');

if (!existsSync(distDir)) {
  console.error(`[fix-ngsw-hashes] dist not found: ${distDir}`);
  process.exit(1);
}
if (!existsSync(config)) {
  console.error(`[fix-ngsw-hashes] missing ${config}`);
  process.exit(1);
}

const args = [ngswCli, distDir, config];
if (baseHref) args.push(baseHref);

const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
if (result.status !== 0) {
  console.error('[fix-ngsw-hashes] ngsw-config failed');
  process.exit(result.status || 1);
}
console.log(`[fix-ngsw-hashes] refreshed hashes in ${distDir}`);
