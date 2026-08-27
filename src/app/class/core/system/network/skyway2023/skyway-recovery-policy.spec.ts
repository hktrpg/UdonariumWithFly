import {
  classifyOutageKind,
  duplicateMemberRetryDelayMs,
  isOutageReopenable,
  nextRefreshDelayMs,
  reopenJitterMs,
  reopenOpenNetworkTimeoutMs,
  shouldSuppressConfigErrorModal,
  SkyWayRecoveryGate,
} from './skyway-recovery-policy';

describe('skyway-recovery-policy', () => {
  describe('classifyOutageKind', () => {
    it('maps rtcApi and kebab forms to rtc-api', () => {
      expect(classifyOutageKind('rtcApiFatalError')).toBe('rtc-api');
      expect(classifyOutageKind('rtc-api-fatal-error')).toBe('rtc-api');
    });

    it('maps server-error and token-expired', () => {
      expect(classifyOutageKind('server-error')).toBe('server-error');
      expect(classifyOutageKind('authentication')).toBe('server-error');
      expect(classifyOutageKind('token-expired')).toBe('token-expired');
      expect(classifyOutageKind('disconnected')).toBe('disconnected');
    });

    it('maps alreadySameNameMemberExist to duplicate-member', () => {
      expect(classifyOutageKind('alreadySameNameMemberExist')).toBe('duplicate-member');
      expect(classifyOutageKind('already-same-name-member-exist')).toBe('duplicate-member');
    });
  });

  it('duplicateMemberRetryDelayMs grows toward a 12s cap', () => {
    expect(duplicateMemberRetryDelayMs(0)).toBe(2000);
    expect(duplicateMemberRetryDelayMs(1)).toBe(4000);
    expect(duplicateMemberRetryDelayMs(2)).toBe(6000);
    expect(duplicateMemberRetryDelayMs(10)).toBe(12000);
  });

  it('reopenOpenNetworkTimeoutMs covers join duplicate-member retry budget', () => {
    expect(reopenOpenNetworkTimeoutMs('already-same-name-member-exist')).toBe(75000);
    expect(reopenOpenNetworkTimeoutMs('alreadySameNameMemberExist')).toBe(75000);
    // Mesh-death path is disconnected but join may still hit ghosts.
    expect(reopenOpenNetworkTimeoutMs('disconnected')).toBe(60000);
    expect(reopenOpenNetworkTimeoutMs()).toBe(60000);
    expect(reopenOpenNetworkTimeoutMs('disconnected'))
      .toBeGreaterThanOrEqual(
        duplicateMemberRetryDelayMs(0)
        + duplicateMemberRetryDelayMs(1)
        + duplicateMemberRetryDelayMs(2)
        + duplicateMemberRetryDelayMs(3)
        + duplicateMemberRetryDelayMs(4),
      );
  });

  it('isOutageReopenable accepts rtc-api fatal types', () => {
    expect(isOutageReopenable('rtc-api-fatal-error')).toBeTrue();
    expect(isOutageReopenable('rtcApiFatalError')).toBeTrue();
    expect(isOutageReopenable('disconnected')).toBeFalse();
  });

  it('nextRefreshDelayMs grows with attempt and stays under max', () => {
    const d0 = nextRefreshDelayMs(0, 2000, 60000, () => 0);
    const d3 = nextRefreshDelayMs(3, 2000, 60000, () => 0);
    expect(d0).toBe(2000);
    expect(d3).toBe(16000);
    expect(nextRefreshDelayMs(20, 2000, 60000, () => 0)).toBe(60000);
  });

  it('reopenJitterMs is stable for the same peerId', () => {
    expect(reopenJitterMs('abc', 3000)).toBe(reopenJitterMs('abc', 3000));
    expect(reopenJitterMs('abc', 3000)).toBeLessThanOrEqual(3000);
  });

  describe('shouldSuppressConfigErrorModal', () => {
    it('suppresses when recovery owns the error', () => {
      expect(shouldSuppressConfigErrorModal('token-expired', { reopenResult: 'started' })).toBeTrue();
      expect(shouldSuppressConfigErrorModal('server-error', { reopenResult: 'busy' })).toBeTrue();
      expect(shouldSuppressConfigErrorModal('authentication', { retryPending: true })).toBeTrue();
      expect(shouldSuppressConfigErrorModal('token-expired', { coolingDown: true })).toBeTrue();
    });

    it('does not suppress when nothing owns recovery', () => {
      expect(shouldSuppressConfigErrorModal('token-expired', {})).toBeFalse();
      expect(shouldSuppressConfigErrorModal('disconnected', { reopenResult: 'busy' })).toBeFalse();
    });
  });

  describe('SkyWayRecoveryGate', () => {
    let gate: SkyWayRecoveryGate;

    beforeEach(() => {
      gate = new SkyWayRecoveryGate();
    });

    it('enters cooldown on rtc-api failure and clears on success', () => {
      const t0 = 1_000_000;
      gate.noteFailure('rtc-api', t0);
      expect(gate.isCoolingDown(t0 + 1000)).toBeTrue();
      expect(gate.isCoolingDown(t0 + 50_000)).toBeFalse();
      gate.noteFailure('rtc-api', t0);
      gate.noteSuccess(t0 + 100);
      expect(gate.isCoolingDown(t0 + 100)).toBeFalse();
    });

    it('uses longer reopen delays for rtc-api than disconnected', () => {
      expect(gate.nextReopenDelayMs(0, 'rtc-api')).toBeGreaterThan(gate.nextReopenDelayMs(0, 'disconnected'));
      expect(gate.nextReopenDelayMs(10, 'rtc-api')).toBe(180000);
      expect(gate.nextReopenDelayMs(10, 'disconnected')).toBe(60000);
    });

    it('uses a long base delay for duplicate-member ghost TTL', () => {
      expect(gate.nextReopenDelayMs(0, 'duplicate-member')).toBe(15000);
      expect(gate.nextReopenDelayMs(1, 'duplicate-member')).toBe(30000);
      expect(gate.nextReopenDelayMs(10, 'duplicate-member')).toBe(90000);
    });

    it('skips heal only when closed during cooldown', () => {
      const t0 = 2_000_000;
      gate.noteFailure('server-error', t0);
      expect(gate.shouldSkipMeshHeal(false, t0 + 1000)).toBeTrue();
      expect(gate.shouldSkipMeshHeal(true, t0 + 1000)).toBeFalse();
    });

    it('throttles open heal during cooldown', () => {
      const t0 = 3_000_000;
      gate.noteFailure('token-api', t0);
      expect(gate.shouldThrottleOpenHeal(true, t0)).toBeFalse();
      gate.markHealAttempt(t0);
      expect(gate.shouldThrottleOpenHeal(true, t0 + 1000)).toBeTrue();
      expect(gate.shouldThrottleOpenHeal(true, t0 + 16_000)).toBeFalse();
      expect(gate.shouldThrottleOpenHeal(false, t0 + 16_000)).toBeFalse();
    });
  });
});
