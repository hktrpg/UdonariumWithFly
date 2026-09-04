export enum CandidateType {
  UNKNOWN = 'unknown',
  RELAY = 'relay',
  PRFLX = 'prflx',
  SRFLX = 'srflx',
  HOST = 'host',
}

/** Peak is kept for the life of the peer link (no idle expiry). */
export const BITRATE_PEAK_HOLD_MS = Number.POSITIVE_INFINITY;
/** Instant rates below this do not enter the stable window (noise / keepalive). */
export const BITRATE_PEAK_NOISE_FLOOR_BPS = 1024;
/**
 * Consecutive meaningful samples required before raising the peak.
 * Stats poll ~2–8s, so 3 samples ≈ sustained multi-second throughput (not a one-shot spike).
 */
export const BITRATE_STABLE_WINDOW = 3;

/** Bytes/sec from two samples of cumulative byte counters. */
export function computeBitrateBps(
  prevTotalBytes: number,
  prevAtMs: number,
  totalBytes: number,
  nowMs: number,
): number {
  if (!(prevAtMs > 0) || !(nowMs > prevAtMs) || totalBytes < prevTotalBytes) return 0;
  const deltaSec = (nowMs - prevAtMs) / 1000;
  if (deltaSec <= 0) return 0;
  return (totalBytes - prevTotalBytes) / deltaSec;
}

/**
 * Session “stable max” for UI: peak of the sustained floor over the last N meaningful
 * samples (min of the window). Idle resets the window but never lowers an established peak.
 */
export function updateStablePeakBitrate(
  peakBps: number,
  peakAtMs: number,
  recentInstants: readonly number[],
  instantBps: number,
  nowMs: number,
  windowSize = BITRATE_STABLE_WINDOW,
  noiseFloorBps = BITRATE_PEAK_NOISE_FLOOR_BPS,
): { peakBps: number; peakAtMs: number; recentInstants: number[] } {
  const instant = Number.isFinite(instantBps) && instantBps > 0 ? instantBps : 0;
  if (instant < noiseFloorBps) {
    return { peakBps, peakAtMs, recentInstants: [] };
  }

  const next = recentInstants.length > 0 ? recentInstants.slice() : [];
  next.push(instant);
  while (next.length > windowSize) next.shift();

  if (next.length >= windowSize) {
    const stable = Math.min(...next);
    if (stable >= noiseFloorBps && stable > peakBps) {
      return { peakBps: stable, peakAtMs: nowMs, recentInstants: next };
    }
  }
  return { peakBps, peakAtMs, recentInstants: next };
}

/** Prefer transport totals; else the busiest succeeded/nominated candidate-pair. */
export function totalBytesFromRtcStats(
  stats: { forEach(callbackfn: (value: any) => void): void } | readonly any[],
): number {
  let transportBytes = 0;
  let sawTransport = false;
  let bestPairBytes = 0;

  const visit = (stat: any) => {
    const type = String(stat?.type ?? '');
    if (type === 'transport' || type.indexOf('transport') >= 0) {
      const sent = Number(stat.bytesSent) || 0;
      const recv = Number(stat.bytesReceived) || 0;
      transportBytes += sent + recv;
      sawTransport = true;
      return;
    }
    if (type.indexOf('candidate-pair') < 0) return;
    const state = String(stat.state ?? '');
    if (state !== 'succeeded' && !stat.nominated && !stat.selected) return;
    const sent = Number(stat.bytesSent) || 0;
    const recv = Number(stat.bytesReceived) || 0;
    const total = sent + recv;
    if (total > bestPairBytes) bestPairBytes = total;
  };

  if (Array.isArray(stats)) {
    for (const stat of stats) visit(stat);
  } else {
    stats.forEach(visit);
  }

  return sawTransport ? transportBytes : bestPairBytes;
}

export class WebRTCStats {
  candidateType: CandidateType = CandidateType.UNKNOWN;
  /** Instantaneous throughput (bytes/sec, in+out). */
  instantBitrateBps = 0;
  /**
   * Stable session-max throughput for UI (bytes/sec, in+out).
   * Sustained over several samples — not a one-shot spike; not cleared by idle.
   */
  bitrateBps = 0;

  private prevTotalBytes = 0;
  private prevSampleAtMs = 0;
  private peakBps = 0;
  private peakAtMs = 0;
  private recentInstants: number[] = [];

  constructor(private peerConnection: RTCPeerConnection) { }

  async updateAsync() {
    let stats: RTCStatsReport = null;
    try {
      stats = await this.peerConnection.getStats();
    } catch (error) {
      console.warn(error);
    }

    if (stats == null) {
      this.candidateType = CandidateType.UNKNOWN;
      return;
    }

    let candidatePairs = [];
    let localCandidates = [];
    let remoteCandidates = [];

    let succeededLocalCandidateIds = [];
    let succeededRemoteCandidateIds = [];
    let usedLocalCandidates = [];
    let usedRemoteCandidates = [];

    stats.forEach(stat => {
      if (0 <= stat.type.indexOf('candidate-pair')) {
        candidatePairs.push(stat);
      }
      if (0 <= stat.type.indexOf('local-candidate')) {
        localCandidates.push(stat);
      }
      if (0 <= stat.type.indexOf('remote-candidate')) {
        remoteCandidates.push(stat);
      }
    });

    candidatePairs.forEach(candidatePair => {
      if (candidatePair.state === 'succeeded') {
        succeededLocalCandidateIds.push(candidatePair.localCandidateId);
        succeededRemoteCandidateIds.push(candidatePair.remoteCandidateId);
      }
    });

    localCandidates.forEach(candidate => {
      if (succeededLocalCandidateIds.includes(candidate.id)) {
        usedLocalCandidates.push(candidate);
      }
    });

    remoteCandidates.forEach(candidate => {
      if (succeededRemoteCandidateIds.includes(candidate.id)) {
        usedRemoteCandidates.push(candidate);
      }
    });

    let candidateType = CandidateType.UNKNOWN;
    let types: CandidateType[] = Object.values(CandidateType);
    usedLocalCandidates.concat(usedRemoteCandidates).forEach(candidate => {
      let index = types.indexOf(candidate.candidateType);
      if (types.indexOf(candidateType) < index) candidateType = types[index];
    });
    this.candidateType = candidateType;

    const nowMs = performance.now();
    const totalBytes = totalBytesFromRtcStats(stats);
    const instantBps = computeBitrateBps(this.prevTotalBytes, this.prevSampleAtMs, totalBytes, nowMs);
    this.prevTotalBytes = totalBytes;
    this.prevSampleAtMs = nowMs;

    const peak = updateStablePeakBitrate(
      this.peakBps,
      this.peakAtMs,
      this.recentInstants,
      instantBps,
      nowMs,
    );
    this.peakBps = peak.peakBps;
    this.peakAtMs = peak.peakAtMs;
    this.recentInstants = peak.recentInstants;
    this.instantBitrateBps = instantBps;
    this.bitrateBps = peak.peakBps;
  }
}
