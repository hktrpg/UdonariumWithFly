/**
 * Post-build checks for ngsw.json under Cloudflare-friendly PWA setup:
 * - index.html must NOT be in hashTable (CDN may inject into HTML responses)
 * - remaining hashed files on disk must match their table entries
 *
 * Usage: node scripts/verify-ngsw-hashes.mjs dist/udonarium
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, process.argv[2] || 'dist/udonarium');
const ngswPath = join(distDir, 'ngsw.json');

if (!existsSync(ngswPath)) {
  console.error(`[verify-ngsw-hashes] missing ${ngswPath}`);
  process.exit(1);
}

const ngsw = JSON.parse(readFileSync(ngswPath, 'utf8'));
const hashTable = ngsw.hashTable || {};
const indexKeys = Object.keys(hashTable).filter(
  k => k === 'index.html' || k === '/index.html' || k.endsWith('/index.html'),
);

if (indexKeys.length > 0) {
  console.error('[verify-ngsw-hashes] index.html must not be hashed (Cloudflare may rewrite HTML):');
  for (const k of indexKeys) console.error(`  ${k}`);
  console.error('Remove /index.html from src/ngsw-config.json assetGroups files, then rebuild.');
  process.exit(1);
}

const baseHref = typeof ngsw.index === 'string'
  ? ngsw.index.replace(/\/index\.html$/, '/')
  : '/';

let checked = 0;
for (const [urlPath, expected] of Object.entries(hashTable)) {
  const rel = urlPath.startsWith(baseHref)
    ? urlPath.slice(baseHref.length)
    : urlPath.replace(/^\//, '');
  const filePath = join(distDir, rel);
  if (!existsSync(filePath)) {
    console.error(`[verify-ngsw-hashes] missing file for ${urlPath} -> ${filePath}`);
    process.exit(1);
  }
  const actual = createHash('sha1').update(readFileSync(filePath)).digest('hex');
  if (actual !== expected) {
    console.error(`[verify-ngsw-hashes] HASH MISMATCH for ${urlPath}`);
    console.error(`  ngsw.json: ${expected}`);
    console.error(`  file:      ${actual}`);
    process.exit(1);
  }
  checked++;
}

console.log(`[verify-ngsw-hashes] OK: no index.html hash; ${checked} asset(s) match (Cloudflare HTML-safe)`);
