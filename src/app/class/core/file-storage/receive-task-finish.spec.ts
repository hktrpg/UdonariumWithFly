import { receiveFinishLazySyncMs, RECEIVE_CANCEL_LAZY_MS, RECEIVE_FAIL_LAZY_MS, RECEIVE_OK_LAZY_MS } from './receive-task-finish';

describe('receiveFinishLazySyncMs', () => {
  it('uses short delay on cancel even when not successful', () => {
    expect(receiveFinishLazySyncMs({
      didCompleteSuccessfully: false,
      didCancel: true,
    })).toBe(RECEIVE_CANCEL_LAZY_MS);
  });

  it('uses failure backoff when unfinished and not canceled', () => {
    expect(receiveFinishLazySyncMs({
      didCompleteSuccessfully: false,
      didCancel: false,
    })).toBe(RECEIVE_FAIL_LAZY_MS);
  });

  it('uses default success delay when complete', () => {
    expect(receiveFinishLazySyncMs({
      didCompleteSuccessfully: true,
      didCancel: false,
    })).toBe(RECEIVE_OK_LAZY_MS);
  });

  it('allows a custom success remesh delay (image)', () => {
    expect(receiveFinishLazySyncMs({
      didCompleteSuccessfully: true,
      didCancel: false,
    }, 1000)).toBe(1000);
  });
});
