/* Verbatim copy of hashingPassthrough from WAFB 0.3.1 (baseline commit 8124026), renamed. Benchmark reference only. */
type HashAlgorithm = 'sha-1' | 'sha-256' | 'sha-512';
 
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
interface HashingPassthroughResult {
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
export async function hashingPassthrough031(
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
 
  let resolveHash!: (hex: string) => void;
  let rejectHash!: (err: unknown) => void;
  const hashPromise = new Promise<string>((resolve, reject) => {
    resolveHash = resolve;
    rejectHash = reject;
  });
 
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // O(1) memory: update the hasher in-place, forward the chunk as-is.
      hasher.update(chunk);
      controller.enqueue(chunk);
    },
    flush() {
      // Called when the writable side closes normally.
      resolveHash(hasher.digest('hex'));
    },
  });
 
  // If the writable side is aborted, reject the hash promise.
  (transform.writable as any).closed?.catch((err: unknown) => rejectHash(err));
   
  return {
    writable: transform.writable,
    readable: transform.readable,
    hashPromise,
  };
}

// ============================================================================
