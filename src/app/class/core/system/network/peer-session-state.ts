export enum PeerSessionGrade {
  UNSPECIFIED,
  LOW,
  MIDDLE,
  HIGH,
}

export interface PeerSessionState {
  /**
   * Connection method grade. Higher than `PeerSessionGrade.LOW` means a more desirable method.
   */
  readonly grade: PeerSessionGrade;
  /**
   * Round-trip time to the destination in ms.
   */
  readonly ping: number;
  /**
   * Connection health in `[0.0, 1.0]`. Below 1.0 may mean the connection is dropping.
   */
  readonly health: number;
  /**
   * Speed score in `[0.0, 1.0]`. Higher is faster.
   * Kept for compatibility; UI prefers bitrate fields.
   */
  readonly speed: number;
  /**
   * Instantaneous link throughput (bytes/sec, in+out) for UI「速度」.
   */
  readonly bitrateInstantBps: number;
  /**
   * Stable session-peak throughput (bytes/sec) for UI「最高」.
   */
  readonly bitrateBps: number;
  /**
   * Optional description of the connection (ICE candidate type).
   */
  readonly description: string;
}

export interface MutablePeerSessionState extends PeerSessionState {
  grade: PeerSessionGrade;
  ping: number;
  health: number;
  speed: number;
  bitrateInstantBps: number;
  bitrateBps: number;
  description: string;
}
