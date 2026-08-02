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
   */
  readonly speed: number;
  /**
   * Optional description of the connection.
   */
  readonly description: string;
}

export interface MutablePeerSessionState extends PeerSessionState {
  grade: PeerSessionGrade;
  ping: number;
  health: number;
  speed: number;
  description: string;
}
