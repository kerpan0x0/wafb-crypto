/**
 * Stream stages used by the session coordinator.
 */

import { AcquisitionAbortedError, errorMessage, isAbortError } from '../utils/errors';

export interface SealedSource {
  stream: ReadableStream<Uint8Array>;
  /** The error that ended the source, if any (set before the stream closes). */
  failure: () => unknown | null;
}

/**
 * Contains a source failure at the source boundary.
 *
 * If the upstream source errors (idle timeout, USB disconnection, device-side
 * failure) the returned stream *closes regularly* and the error is kept in
 * `failure()`. Downstream stages (hash, age, ZIP) can then finalise the entry,
 * keeping the container valid and the session able to continue with
 * independent modules. The coordinator is responsible for recording the
 * artefact as INCOMPLETE — a sealed prefix is never reported as complete.
 *
 * Abort errors are NOT sealed: cancellation must stop the whole pipeline.
 */
export function sealOnSourceFailure(source: ReadableStream<Uint8Array>): SealedSource {
  const reader = source.getReader();
  let failure: unknown = null;
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        let r: ReadableStreamReadResult<Uint8Array>;
        try {
          r = await reader.read();
        } catch (err) {
          if (isAbortError(err)) {
            controller.error(err);
            return;
          }
          failure = err ?? new Error('Source failed');
          controller.close();
          return;
        }
        if (r.done) controller.close();
        else controller.enqueue(r.value);
      },
      async cancel(reason) {
        try { await reader.cancel(reason); } catch { /* ignore */ }
      },
    },
    { highWaterMark: 0 }
  );
  return { stream, failure: () => failure };
}

/**
 * Makes a stream abortable by the session signal: on abort the downstream
 * side errors with an AbortError and the upstream source is cancelled (which,
 * for monitored device sources, kills the remote process).
 */
export function abortable(source: ReadableStream<Uint8Array>, signal: AbortSignal): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
  let done = false;
  const onAbort = () => {
    if (done) return;
    done = true;
    const err = signal.reason instanceof Error && isAbortError(signal.reason)
      ? signal.reason
      : new AcquisitionAbortedError();
    try { ctrl?.error(err); } catch { /* ignore */ }
    reader.cancel(err).catch(() => {});
  };
  return new ReadableStream<Uint8Array>(
    {
      start(c) {
        ctrl = c;
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      },
      async pull(controller) {
        if (done) return;
        try {
          const r = await reader.read();
          if (done) return;
          if (r.done) {
            done = true;
            signal.removeEventListener('abort', onAbort);
            controller.close();
          } else controller.enqueue(r.value);
        } catch (err) {
          if (done) return;
          done = true;
          signal.removeEventListener('abort', onAbort);
          controller.error(err);
        }
      },
      async cancel(reason) {
        done = true;
        signal.removeEventListener('abort', onAbort);
        try { await reader.cancel(reason); } catch { /* ignore */ }
      },
    },
    { highWaterMark: 0 }
  );
}

/** Stable error code for a thrown value. */
export function errorCode(err: unknown): string {
  if (isAbortError(err)) return 'CANCELLED';
  const name = (err as { name?: string } | null)?.name;
  switch (name) {
    case 'SourceIdleTimeoutError': return 'SOURCE_IDLE_TIMEOUT';
    case 'QuotaExceededError': return 'SINK_QUOTA_EXCEEDED';
    case 'NotAllowedError': return 'SINK_NOT_ALLOWED';
    case 'ADBCommandError': return 'DEVICE_COMMAND_FAILED';
    case 'ADBConnectionError': return 'DEVICE_CONNECTION_LOST';
    default: return 'UNEXPECTED';
  }
}

export { errorMessage };
