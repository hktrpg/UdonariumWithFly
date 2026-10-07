import { Network } from './network';
import { formatMeshDiagStatsLines } from './mesh-diag-stats';
import {
  getMeshLogMode,
  MESH_DIAG_EXPORT_EVENTS_MAX,
  meshDiagRingEvents,
  meshDiagRingWarnings,
} from './net-mesh-log';

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

export * from './net-mesh-log';

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

  lines.push(...formatMeshDiagStatsLines());

  const warns = meshDiagRingWarnings();
  if (warns.length) {
    lines.push('warnings (deduped):');
    for (const w of warns.slice(-12)) {
      lines.push(`  [${w.count}x] ${w.last}`);
    }
  }

  const events = meshDiagRingEvents();
  lines.push(`recent (${Math.min(MESH_DIAG_EXPORT_EVENTS_MAX, events.length)} lines):`);
  for (const e of events.slice(-MESH_DIAG_EXPORT_EVENTS_MAX)) {
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

function shortId(id: string): string {
  if (!id || typeof id !== 'string') return '?';
  return id.length > 10 ? id.slice(0, 10) : id;
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
