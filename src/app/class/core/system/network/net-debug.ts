import { Network } from './network';

/**
 * Mesh / P2P logging modes (localStorage key `UDONARIUM_NET_DEBUG`):
 *
 * - unset / `0`     — one-line `[mesh]` warns + ring buffer (console stays short)
 * - `compact`       — same console; use export for AI (recommended for bug reports)
 * - `1` / `verbose` — full netDebug + multi-arg console (very noisy)
 *
 * Export for AI (any mode):
 *   udonariumMeshDiag()        — print paste-ready text
 *   udonariumMeshDiagCopy()    — copy to clipboard
 *
 * Peer menu: 「Copy mesh diag」button (connection card).
 */

export type MeshLogMode = 'off' | 'compact' | 'verbose';

const RING_MAX = 120;
const EXPORT_EVENTS_MAX = 40;
const LINE_MAX = 180;

const meshWarnLast: Map<string, number> = new Map();
const MESH_WARN_COOLDOWN_MS = 8000;

class MeshDiagRing {
  private lines: string[] = [];
  private warnSummaries: Map<string, { count: number; last: string }> = new Map();

  push(line: string) {
    const trimmed = truncateLine(line);
    this.lines.push(`${timeTag()} ${trimmed}`);
    if (this.lines.length > RING_MAX) this.lines.shift();
  }

  pushWarn(key: string, line: string) {
    this.push(line);
    const trimmed = truncateLine(line);
    const prev = this.warnSummaries.get(key);
    this.warnSummaries.set(key, { count: (prev?.count ?? 0) + 1, last: trimmed });
  }

  events(): readonly string[] {
    return this.lines;
  }

  warnings(): ReadonlyArray<{ key: string; count: number; last: string }> {
    return Array.from(this.warnSummaries.entries()).map(([key, v]) => ({
      key,
      count: v.count,
      last: v.last,
    }));
  }
}

const ring = new MeshDiagRing();

export function getMeshLogMode(): MeshLogMode {
  try {
    if (typeof localStorage === 'undefined') return 'off';
    const v = localStorage.getItem('UDONARIUM_NET_DEBUG');
    if (v === '1' || v === 'verbose') return 'verbose';
    if (v === 'compact') return 'compact';
  } catch {
    // ignore
  }
  return 'off';
}

/** True when skyway refresh / file-sync trace should spam console. */
export function isNetDebug(): boolean {
  return getMeshLogMode() === 'verbose';
}

export function netDebug(...args: unknown[]) {
  if (!isNetDebug()) return;
  const line = formatMeshLine(...args);
  ring.push(`dbg ${line}`);
  console.log('[mesh-dbg]', ...args);
}

/** Rate-limited warn — avoids console floods when a stale peer loops. */
export function meshWarnThrottled(key: string, ...args: unknown[]) {
  const now = Date.now();
  const last = meshWarnLast.get(key) ?? 0;
  if (now - last < MESH_WARN_COOLDOWN_MS) return;
  meshWarnLast.set(key, now);
  const line = formatMeshLine(...args);
  ring.pushWarn(key, line);
  console.warn('[mesh]', line);
}

/** Mesh/connect diagnostics — one line to console; full detail via export. */
export function meshWarn(...args: unknown[]) {
  const line = formatMeshLine(...args);
  ring.push(line);
  if (getMeshLogMode() === 'verbose') {
    console.warn('[mesh]', ...args);
  } else {
    console.warn('[mesh]', line);
  }
}

export function exportMeshDiagText(): string {
  const lines: string[] = [];
  lines.push('# Udonarium mesh diag');
  lines.push(`mode: ${getMeshLogMode()}`);
  lines.push(`at: ${new Date().toISOString()}`);

  try {
    const net = Network.instance;
    const selfId = net.peerId;
    const members = net.listRoomMemberPeerIds();
    const handshaking = net.peers.filter(p => !p.isOpen).map(p => shortId(p.peerId));
    lines.push(`self: ${shortId(selfId)} user=${net.peer.userId || '-'}`);
    lines.push(`room: ${net.peer.roomName || '-'} / ${shortId(net.peer.roomId || '')}`);
    lines.push(`state: networkOpen=${net.isOpen} opening=${net.isOpening}`);
    lines.push(`mesh: members=${members.length} open=${net.peerIds.length} handshaking=${net.peers.length - net.peerIds.length}`);

    for (const peer of net.peers) {
      const ping = peer.session?.ping != null ? Math.round(peer.session.ping) : '-';
      const grade = peer.session?.description || String(peer.session?.grade ?? '?');
      lines.push(`  stream ${shortId(peer.peerId)} open=${peer.isOpen} ping=${ping} health=${peer.session?.health?.toFixed(2) ?? '?'} ice=${grade}`);
    }

    const seen = new Set(net.peers.map(p => p.peerId));
    for (const mid of members) {
      if (!mid || mid === selfId || seen.has(mid)) continue;
      lines.push(`  member ${shortId(mid)} (no local stream)`);
    }
    if (handshaking.length) {
      lines.push(`  handshaking: ${handshaking.join(',')}`);
    }
  } catch (e) {
    lines.push(`snapshot-error: ${e instanceof Error ? e.message : String(e)}`);
  }

  const warns = ring.warnings();
  if (warns.length) {
    lines.push('warnings (deduped):');
    for (const w of warns.slice(-12)) {
      lines.push(`  [${w.count}x] ${w.last}`);
    }
  }

  lines.push(`recent (${Math.min(EXPORT_EVENTS_MAX, ring.events().length)} lines):`);
  for (const e of ring.events().slice(-EXPORT_EVENTS_MAX)) {
    lines.push(`  ${e}`);
  }

  lines.push('');
  lines.push('enable: localStorage UDONARIUM_NET_DEBUG=compact|verbose|1');
  return lines.join('\n');
}

export async function copyMeshDiagToClipboard(): Promise<boolean> {
  const text = exportMeshDiagText();
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      console.info(`[mesh] diag copied (${text.length} chars)`);
      return true;
    }
  } catch {
    // fall through
  }
  console.info(text);
  return false;
}

export function formatMeshLine(...args: unknown[]): string {
  const parts: string[] = [];
  for (const a of args) {
    if (typeof a === 'string') {
      parts.push(compactString(a));
    } else if (a != null && typeof a === 'object') {
      parts.push(compactObject(a as Record<string, unknown>));
    } else if (a != null) {
      parts.push(String(a));
    }
  }
  return truncateLine(parts.join(' ').replace(/\s+/g, ' ').trim());
}

function compactObject(obj: Record<string, unknown>): string {
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (typeof v === 'string' && /peer|id/i.test(k)) {
      pairs.push(`${k}=${shortId(v)}`);
    } else if (typeof v === 'string') {
      pairs.push(`${k}=${compactString(v)}`);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      pairs.push(`${k}=${v}`);
    } else if (Array.isArray(v)) {
      pairs.push(`${k}=[${v.length}]`);
    } else {
      pairs.push(`${k}=${compactString(JSON.stringify(v))}`);
    }
  }
  return pairs.length ? `{${pairs.join(',')}}` : '{}';
}

function compactString(s: string, max = 64): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length > 10 && /^[A-Za-z0-9_-]+$/.test(t)) return shortId(t);
  if (t.length <= max) return t;
  return t.slice(0, max) + '…';
}

function truncateLine(s: string): string {
  if (s.length <= LINE_MAX) return s;
  return s.slice(0, LINE_MAX) + '…';
}

function shortId(id: string): string {
  if (!id || typeof id !== 'string') return '?';
  return id.length > 10 ? id.slice(0, 10) : id;
}

function timeTag(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function installMeshDiagGlobals() {
  if (typeof window === 'undefined') return;
  const w = window as Window & {
    udonariumMeshDiag?: () => string;
    udonariumMeshDiagCopy?: () => Promise<boolean>;
  };
  if (w.udonariumMeshDiag) return;
  w.udonariumMeshDiag = () => {
    const text = exportMeshDiagText();
    console.info(text);
    return text;
  };
  w.udonariumMeshDiagCopy = () => copyMeshDiagToClipboard();
}

installMeshDiagGlobals();
