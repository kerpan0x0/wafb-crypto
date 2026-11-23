import { monitorSource } from './source-monitor';

/**
 * Legge un ReadableStream e ritorna il contenuto come stringa
 * Nota: Usiamo 'any' per il parametro readable per evitare conflitti tra 
 * i tipi ReadableStream del browser e quelli di @yume-chan/stream-extra.
 */
export async function readStreamAsText(readable: any): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = readable.getReader();
  
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      if (value) {
        // Gestisce sia il caso in cui value sia wrapped che unwrapped
        const data = (value).value || value;
        chunks.push(data instanceof Uint8Array ? data : new Uint8Array(data));
      }
    }
  } finally {
    reader.releaseLock();
  }
  
  return new TextDecoder().decode(concatUint8Arrays(chunks));
}

/**
 * Legge un ReadableStream e ritorna il contenuto come Uint8Array
 */
export async function readStreamAsBytes(readable: any): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = readable.getReader();
  
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      if (value) {
        const data = (value).value || value;
        chunks.push(data instanceof Uint8Array ? data : new Uint8Array(data));
      }
    }
  } finally {
    reader.releaseLock();
  }
  
  return concatUint8Arrays(chunks);
}

/**
 * Concatena più Uint8Array in uno solo
 */
export function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.byteLength, 0);
  const result = new Uint8Array(totalLength);
  
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.byteLength;
  }
  
  return result;
}

/**
 * Utility generica per retry di operazioni asincrone
 */
export async function retry<T>(
  operation: () => Promise<T>,
  options: {
    attempts: number;
    delay: number;
    onRetry?: (attempt: number, error: Error) => void;
  }
): Promise<T> {
  const { attempts, delay, onRetry } = options;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      if (onRetry) {
        onRetry(attempt, lastError);
      }
      
      if (attempt < attempts) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Wraps a ReadableStream with an idle timeout.
 *
 * Since the protected-acquisition extension this is a thin adapter over
 * {@link monitorSource}: when no chunk arrives within `ms` milliseconds the
 * returned stream **errors** with `SourceIdleTimeoutError` (unless `exited`
 * has already settled, in which case the silence is a drained stream and the
 * wrapper closes normally). WAFB 0.3.1 closed the stream regularly in both
 * cases, so a stalled source was indistinguishable from a finished one.
 *
 * Prefer `monitorSource` directly when the end cause is needed.
 */
export function wrapWithIdleTimeout(
  source: ReadableStream<Uint8Array>,
  ms: number,
  exited?: Promise<number>
): ReadableStream<Uint8Array> {
  return monitorSource(source, { idleTimeoutMs: ms, exited }).stream;
}

// ============================================================================
// HASHING PASSTHROUGH  (M2)
// ============================================================================
 
export type HashAlgorithm = 'sha-1' | 'sha-256' | 'sha-512';
 
/**
 * hash-wasm factory functions, keyed by algorithm.
 * Imported lazily so the WASM binary is only loaded when hashing is used.
 */
const HASH_WASM_FACTORIES: Record<HashAlgorithm, () => Promise<IHasher>> = {
  'sha-1':   () => import('hash-wasm').then(m => m.createSHA1()),
  'sha-256': () => import('hash-wasm').then(m => m.createSHA256()),
  'sha-512': () => import('hash-wasm').then(m => m.createSHA512()),
};
 
/**
 * Minimal interface for a hash-wasm hasher instance.
 * @internal
 */
interface IHasher {
  update(data: Uint8Array): void;
  digest(encoding: 'hex'): string;
}
 
/**
 * Result returned by `hashingPassthrough`.
 */
export interface HashingPassthroughResult {
  /**
   * The writable end — pipe your source stream into this.
   */
  writable: WritableStream<Uint8Array>;
  /**
   * The readable end — pipe this into your consumer (e.g. ZIP writer).
   * Every chunk written to `writable` is forwarded here unchanged.
   */
  readable: ReadableStream<Uint8Array>;
  /**
   * Resolves with the hex-encoded digest once the writable side is closed.
   * Rejects if the stream is aborted before being closed.
   */
  hashPromise: Promise<string>;
}
 
/**
 * Creates a passthrough TransformStream that computes a cryptographic hash
 * **incrementally** as data flows through it, using hash-wasm.
 *
 * Memory usage is O(1) — each chunk is hashed and immediately forwarded
 * to the consumer without buffering. This makes it safe to use with large
 * streams (dumpsys output, ADB backups, etc.).
 *
 * Usage:
 * ```ts
 * const { writable, readable, hashPromise } = await hashingPassthrough('sha-256');
 * sourceStream.pipeTo(writable);          // drives hashing + forwarding
 * await zipWriter.addFile(readable);      // consumer
 * const hash = await hashPromise;         // available after writable closes
 * ```
 *
 * Supported algorithms: `sha-1`, `sha-256`, `sha-512`.
 *
 * @throws {Error} If the algorithm is unsupported.
 */
export async function hashingPassthrough(
  algorithm: HashAlgorithm
): Promise<HashingPassthroughResult> {
  const factory = HASH_WASM_FACTORIES[algorithm];
  if (!factory) {
    throw new Error(
      `Unsupported hash algorithm: "${algorithm}". ` +
      `Supported: ${Object.keys(HASH_WASM_FACTORIES).join(', ')}`
    );
  }

  // Initialise the hasher once — this loads the WASM binary.
  const hasher = await factory();

  let settled = false;
  let resolveHash!: (hex: string) => void;
  let rejectHash!: (err: unknown) => void;
  const hashPromise = new Promise<string>((resolve, reject) => {
    resolveHash = hex => { if (!settled) { settled = true; resolve(hex); } };
    rejectHash = err => { if (!settled) { settled = true; reject(err); } };
  });
  // A rejected digest must never surface as an unhandled rejection just
  // because nobody awaited it yet; callers still observe the rejection.
  hashPromise.catch(() => {});

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // O(1) memory: update the hasher in-place, forward the chunk as-is.
      hasher.update(chunk);
      controller.enqueue(chunk);
    },
    flush() {
      // Called only when the writable side closes normally.
      resolveHash(hasher.digest('hex'));
    },
  });

  // WAFB 0.3.1 observed `(transform.writable as any).closed`, a property that
  // WritableStream does not have: on abort the digest promise stayed pending
  // forever. The standard contract exposes `closed` on the *writer*, so the
  // writable side is fronted by a forwarding WritableStream that owns the
  // inner writer and settles the digest on every path:
  //   - close           -> flush() resolves it;
  //   - abort(reason)   -> rejected with the reason;
  //   - readable cancel -> inner writer errors -> rejected.
  const inner = transform.writable.getWriter();
  inner.closed.catch(err => rejectHash(err ?? new Error('Hashing stream errored')));

  const writable = new WritableStream<Uint8Array>({
    async write(chunk) {
      try {
        await inner.ready;
        await inner.write(chunk);
      } catch (err) {
        rejectHash(err);
        throw err;
      }
    },
    async close() {
      await inner.close();
    },
    async abort(reason) {
      rejectHash(reason ?? new Error('Hashing stream aborted'));
      await inner.abort(reason).catch(() => {});
    },
  });

  return {
    writable,
    readable: transform.readable,
    hashPromise,
  };
}

// ============================================================================
// RECHUNK (bounded element size)
// ============================================================================

/**
 * Splits chunks larger than `maxBytes` into consecutive views of at most
 * `maxBytes` bytes, preserving order. No bytes are copied, added or removed,
 * so digests and decrypted output are unaffected; the point is to keep the
 * cost of each downstream transformation (and each queued element) bounded
 * even when a transport delivers very large chunks.
 */
export function rechunk(maxBytes: number): TransformStream<Uint8Array, Uint8Array> {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError(`rechunk: maxBytes must be a positive integer, got ${maxBytes}`);
  }
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (chunk.byteLength <= maxBytes) {
        if (chunk.byteLength > 0) controller.enqueue(chunk);
        return;
      }
      for (let off = 0; off < chunk.byteLength; off += maxBytes) {
        controller.enqueue(chunk.subarray(off, Math.min(off + maxBytes, chunk.byteLength)));
      }
    },
  });
}

/**
 * Pass-through that counts bytes and reports them. Used to expose "bytes
 * acquired", "bytes encrypted" and "bytes written" as distinct quantities.
 */
export function byteCounter(onBytes?: (total: number) => void): {
  transform: TransformStream<Uint8Array, Uint8Array>;
  total: () => number;
} {
  let total = 0;
  return {
    transform: new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        onBytes?.(total);
        controller.enqueue(chunk);
      },
    }),
    total: () => total,
  };
}

// ============================================================================
// BYTES → READABLE STREAM
// ============================================================================

/**
 * Wraps a Uint8Array in a ReadableStream.
 *
 * Acquirers use this to return buffered outputs (JSON, text) as streams,
 * so the ZIP writer can handle all AcquisitionFile entries uniformly via
 * `addAcquisitionFile` regardless of whether the data was streamed from
 * the device or computed in memory.
 */
export function bytesToStream(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}