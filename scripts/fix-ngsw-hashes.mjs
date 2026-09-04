/**
 * After ng build (and any base-href rewrite), regenerate ngsw.json hashes.
 * Then strip index.html from the hash table so installs survive Cloudflare
 * (or other CDN) HTML injection into document responses.
 *
 * Usage (from repo root, after ng build):
 *   node scripts/fix-ngsw-hashes.mjs dist/udonarium [/optional-base-href]
 *
 * Paths passed to Angular's ngsw-config must be relative to cwd (it joins cwd + argv).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distArg = process.argv[2] || 'dist/udonarium';
const baseHref = process.argv[3] || '';
const distDir = resolve(root, distArg);
const configAbs = join(root, 'src', 'ngsw-config.json');
const ngswCli = join(root, 'node_modules', '@angular', 'service-worker', 'ngsw-config.js');
const ngswPath = join(distDir, 'ngsw.json');

function toPosixRel(absPath) {
  return relative(root, absPath).split('\\').join('/');
}

if (!existsSync(distDir)) {
  console.error(`[fix-ngsw-hashes] dist not found: ${distDir}`);
  process.exit(1);
}
if (!existsSync(configAbs)) {
  console.error(`[fix-ngsw-hashes] missing ${configAbs}`);
  process.exit(1);
}

const args = [ngswCli, toPosixRel(distDir), toPosixRel(configAbs)];
if (baseHref) args.push(baseHref);

const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
if (result.status !== 0) {
  console.error('[fix-ngsw-hashes] ngsw-config failed');
  process.exit(result.status || 1);
}

/** CDN may rewrite text/html; never integrity-check the document shell. */
function stripIndexHtmlHashes() {
  if (!existsSync(ngswPath)) return 0;
  const ngsw = JSON.parse(readFileSync(ngswPath, 'utf8'));
  let removed = 0;
  const isIndex = (u) =>
    u === 'index.html' || u === '/index.html' || (typeof u === 'string' && u.endsWith('/index.html'));

  for (const key of Object.keys(ngsw.hashTable || {})) {
    if (!isIndex(key)) continue;
    delete ngsw.hashTable[key];
    removed++;
  }
  for (const group of ngsw.assetGroups || []) {
    if (!Array.isArray(group.urls)) continue;
    const before = group.urls.length;
    group.urls = group.urls.filter(u => !isIndex(u));
    removed += before - group.urls.length;
  }
  if (removed > 0) {
    writeFileSync(ngswPath, JSON.stringify(ngsw, null, 2) + '\n');
  }
  return removed;
}

const stripped = stripIndexHtmlHashes();
console.log(
  `[fix-ngsw-hashes] refreshed hashes in ${distDir}` +
    (stripped ? ` (stripped ${stripped} index.html hash/url entr${stripped === 1 ? 'y' : 'ies'} for CDN HTML compat)` : ''),
);
