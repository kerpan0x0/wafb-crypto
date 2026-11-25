/**
 * Source monitoring for streaming acquisitions.
 *
 * WAFB 0.3.1 wrapped every spawned stdout with an idle timer that, when it
 * fired, closed the stream *normally*. A consumer therefore could not tell a
 * source that finished from one that stalled, was disconnected or was cut
 * short. This module keeps the stream and the reason it ended apart:
 *
 *   - `stream`  : the bytes, to be consumed by hashing / encryption / ZIP;
 *   - `outcome` : a promise that always settles (never rejects) with a
 *                 {@link SourceOutcome} describing *why* the stream ended.
 *
 * Availability of the stream authorises reading; only the outcome (together
 * with the downstream stages) authorises declaring the artefact complete.
 */

import { AcquisitionAbortedError, SourceIdleTimeoutError, errorMessage } from './errors';

/** Why a monitored source stopped producing data. */
export type SourceEndCause =
  /** The source signalled end-of-stream (or the remote process exited and the stream drained). */
  | 'eof'
  /** No data within the idle window and no exit reported by the remote process. */
  | 'idle-timeout'
  /** The session owner aborted, or the consumer cancelled the stream. */
  | 'cancelled'
  /** The underlying transport raised an error (e.g. USB disconnection). */
  | 'source-error';

export interface SourceOutcome {
  cause: SourceEndCause;
  /** Bytes delivered to the consumer before the end. */
  bytes: number;
  /** Exit code of the remote process; `null` when it was not observed. */
  exitCode: number | null;
  /** Sanitised error message, when `cause` is not `eof`. */
  error?: string;
}

/** Verdict on whether a source outcome may count as a regular conclusion (S_i). */
export interface SourceVerdict {
  acceptable: boolean;
  /** Present when the verdict is acceptable but rests on an unverified assumption. */
  limitation?: 'exit-code-not-observed';
  /** Present when the verdict is not acceptable. */
  reason?: string;
}

/**
 * Decides S_i for an artefact.
 *
 * - EOF with exit code 0                → acceptable.
 * - EOF without an observable exit code → acceptable *with* a recorded limitation;
 *   the absence of an exit code is never silently turned into a success.
 * - EOF with a non-zero exit code       → not acceptable (data kept, flagged).
 * - any other cause                     → not acceptable.
 */
export function evaluateSourceOutcome(outcome: SourceOutcome): SourceVerdict {
  if (outcome.cause !== 'eof') {
    return { acceptable: false, reason: outcome.cause };
  }
  if (outcome.exitCode === null) {
    return { acceptable: true, limitation: 'exit-code-not-observed' };
  }
  if (outcome.exitCode !== 0) {
    return { acceptable: false, reason: `exit-code-${outcome.exitCode}` };
  }
  return { acceptable: true };
}

export interface MonitorSourceOptions {
  /**
   * Maximum silence, in ms, before the source is considered stalled.
   * `0` or `undefined` disables the idle timer.
   */
  idleTimeoutMs?: number;
  /** Exit-code promise of the remote process, if the transport exposes one. */
  exited?: Promise<number>;
  /**
   * How long to wait for `exited` after the stream ended before recording
   * the exit code as not observed. Default 2000 ms.
   */
  exitGraceMs?: number;
  /** Abort signal owned by the session coordinator. */
  signal?: AbortSignal;
  /** Called when the source must be stopped (e.g. kill the remote process). */
  onStop?: () => void | Promise<void>;
}

export interface MonitoredSource {
  stream: ReadableStream<Uint8Array>;
  outcome: Promise<SourceOutcome>;
}

/**
 * Wraps a source stream so that its termination is observable and classified.
 *
 * Behaviour on idle: if the remote process has already exited, the silence is
 * the natural end of a drained stream and the wrapper closes normally (this
 * preserves the 0.3.1 work-around for devices that never send EOF). Otherwise
 * the wrapper *errors* with {@link SourceIdleTimeoutError} and cancels the
 * source — a stalled backup is never presented as a finished one.
 */
export function monitorSource(
  source: ReadableStream<Uint8Array>,
  options: MonitorSourceOptions = {}
): MonitoredSource {
  const { idleTimeoutMs = 0, exited, exitGraceMs = 2000, signal, onStop } = options;
  const reader = source.getReader();

  let bytes = 0;
  let finished = false;
  let exitCode: number | null = null;
  let exitSettled = false;

  if (exited) {
    exited.then(
      code => {
        exitCode = code;
        exitSettled = true;
      },
      () => {
        exitSettled = true;
      }
    );
  }

  let resolveOutcome!: (o: SourceOutcome) => void;
  const outcome = new Promise<SourceOutcome>(r => (resolveOutcome = r));

  const waitForExit = async (): Promise<number | null> => {
    if (!exited) return null;
    if (exitSettled) return exitCode;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const grace = new Promise<null>(r => (timer = setTimeout(() => r(null), exitGraceMs)));
    try {
      return await Promise.race([exited.then(c => c, () => null), grace]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  const finish = (cause: SourceEndCause, error?: unknown) => {
    if (finished) return;
    finished = true;
    signal?.removeEventListener('abort', onAbort);
    void waitForExit().then(code =>
      resolveOutcome({
        cause,
        bytes,
        exitCode: code,
        ...(error !== undefined ? { error: errorMessage(error) } : {}),
      })
    );
  };

  const stopSource = async (reason: unknown) => {
    try {
      await reader.cancel(reason);
    } catch {
      /* the source may already be errored */
    }
    try {
      await onStop?.();
    } catch {
      /* best effort: the transport may already be gone */
    }
  };

  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const onAbort = () => {
    if (finished) return;
    const err = new AcquisitionAbortedError();
    finish('cancelled', err);
    try {
      controllerRef?.error(err);
    } catch {
      /* already closed */
    }
    void stopSource(err);
  };

  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        controllerRef = controller;
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
      },

      async pull(controller) {
        if (finished) return;

        type Race =
          | { kind: 'read'; result: ReadableStreamReadResult<Uint8Array> }
          | { kind: 'idle' };

        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        const contenders: Promise<Race>[] = [
          reader.read().then(result => ({ kind: 'read' as const, result })),
        ];
        if (idleTimeoutMs > 0) {
          contenders.push(
            new Promise<Race>(r => {
              idleTimer = setTimeout(() => r({ kind: 'idle' }), idleTimeoutMs);
            })
          );
        }

        let raced: Race;
        try {
          raced = await Promise.race(contenders);
        } catch (err) {
          if (idleTimer !== undefined) clearTimeout(idleTimer);
          if (finished) return; // abort already handled
          finish('source-error', err);
          controller.error(err);
          return;
        } finally {
          if (idleTimer !== undefined) clearTimeout(idleTimer);
        }

        if (finished) return;

        if (raced.kind === 'idle') {
          if (exitSettled) {
            // The process has exited and nothing else arrived: drained stream.
            finish('eof');
            controller.close();
            void stopSource(undefined);
            return;
          }
          const err = new SourceIdleTimeoutError(idleTimeoutMs, bytes);
          finish('idle-timeout', err);
          controller.error(err);
          void stopSource(err);
          return;
        }

        const { done, value } = raced.result;
        if (done) {
          finish('eof');
          controller.close();
          return;
        }
        if (value && value.byteLength > 0) {
          bytes += value.byteLength;
          controller.enqueue(value);
        }
      },

      cancel(reason) {
        if (!finished) finish('cancelled', reason ?? new AcquisitionAbortedError('Consumer cancelled'));
        return stopSource(reason);
      },
    },
    // No internal queueing beyond one chunk: demand is driven by the consumer.
    { highWaterMark: 0 }
  );

  return { stream, outcome };
}
