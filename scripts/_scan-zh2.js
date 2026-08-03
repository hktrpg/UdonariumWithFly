const fs = require('fs');
const path = require('path');

function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'scripts', 'i18n'].includes(e.name)) continue;
      walk(p, acc);
    } else if (/\.(ts|html)$/.test(e.name) && !e.name.endsWith('.spec.ts')) acc.push(p);
  }
  return acc;
}

const re = /[\u4e00-\u9fff]/;
const hits = [];
for (const f of walk('src/app')) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!re.test(line)) return;
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('<!--')) return;
    if (t.includes('TODO:') || t.includes('console.')) return;
    if (t.includes('i18n.t(') || t.includes('| i18n')) return;
    if (/\/\/\s*.*[\u4e00-\u9fff]/.test(line) && !/['"`].*[\u4e00-\u9fff].*['"`]/.test(line)) return;
    hits.push({ f: f.replace(/\\/g, '/'), n: i + 1, t: t.slice(0, 160) });
  });
}

const by = {};
for (const h of hits) {
  const m = h.f.match(/component\/([^/]+)/) || h.f.match(/service\/([^/]+)/) || h.f.match(/class\/([^/]+)/);
  const k = m ? m[1] : h.f.split('/').slice(-2).join('/');
  by[k] = (by[k] || 0) + 1;
}
console.log('total', hits.length);
Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log(v + '\t' + k));
const focus = ['jukebox', 'dice-roll-table', 'file-storage', 'file-selecter', 'chat-input', 'chat-message', 'chat-window', 'chat-tab', 'note-inventory', 'cut-in', 'context-menu', 'skyway', 'overview', 'combat'];
for (const w of focus) {
  const xs = hits.filter((h) => h.f.includes(w));
  if (!xs.length) continue;
  console.log('\n====' + w + ' (' + xs.length + ')====');
  xs.slice(0, 35).forEach((h) => console.log(h.f + ':' + h.n + ' ' + h.t));
}
