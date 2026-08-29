import { BufferSharingTask } from './buffer-sharing-task';
import { FileReceiveScheduler, FileResourceKind } from './file-transfer-scheduler';

/** Remesh soon after cancel/DISCONNECT so the next peer can re-enqueue. */
export const RECEIVE_CANCEL_LAZY_MS = 800;
/** Back off after a real transfer failure (timeout / incomplete). */
export const RECEIVE_FAIL_LAZY_MS = 20_000;
/** Default remesh delay after a successful receive. */
export const RECEIVE_OK_LAZY_MS = 800;

/**
 * Cancel is not a transfer failure: short remesh. Real fail keeps a long backoff.
 * successMs lets image keep its slightly longer post-success remesh (1000).
 */
export function receiveFinishLazySyncMs(
  task: Pick<BufferSharingTask<unknown>, 'didCompleteSuccessfully' | 'didCancel'>,
  successMs: number = RECEIVE_OK_LAZY_MS,
): number {
  if (task.didCancel) return RECEIVE_CANCEL_LAZY_MS;
  if (!task.didCompleteSuccessfully) return RECEIVE_FAIL_LAZY_MS;
  return successMs;
}

/**
 * Shared receive onfinish: clear scheduler retry gate on cancel, stop the task,
 * apply success payload, then lazySynchronize with cancel-aware delay.
 */
export function finishMediaReceiveTask<T>(
  kind: FileResourceKind,
  task: BufferSharingTask<T>,
  data: T | null | undefined,
  options: {
    stopReceiveTask: (identifier: string) => void;
    onSuccess: (data: T) => void;
    lazySynchronize: (ms: number) => void;
    successLazyMs?: number;
  },
): void {
  const ok = task.didCompleteSuccessfully;
  FileReceiveScheduler.noteReceiveEnded(kind, task.identifier, ok || task.didCancel);
  options.stopReceiveTask(task.identifier);
  if (ok && data) options.onSuccess(data);
  options.lazySynchronize(
    receiveFinishLazySyncMs(task, options.successLazyMs ?? RECEIVE_OK_LAZY_MS),
  );
}
