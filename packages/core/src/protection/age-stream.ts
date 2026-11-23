/**
 * Streaming age encryption / decryption (RF4, RF8).
 *
 * Each artefact becomes an independent age v1 message (own file key, own
 * header) for the single session recipient. The wrapper adds two things on
 * top of Typage:
 *
 *  1. **Bounded element size.** Typage's STREAM encrypter works in 64 KiB
 *     plaintext chunks, but when it receives one very large input chunk it
 *     enqueues all the corresponding ciphertext in a single transform call,
 *     bypassing backpressure. Input is therefore re-chunked to 64 KiB first,
 *     so every element in the pipeline stays bounded regardless of how the
 *     transport segments the data.
 *  2. **Observable completion (E_i).** `finalized` resolves only when the
 *     final STREAM chunk has been emitted, and rejects if the stream errors
 *     or is cancelled before that point.
 *
 * Decryption accepts a message only when the whole stream has been read and
 * the final chunk authenticated; partial output produced before an error must
 * be treated as unverified.
 */

import { Decrypter, Encrypter } from 'age-encryption';
import { rechunk } from '../utils/stream-helpers';
import type { ValidatedRecipient } from './recipient';

/** age v1 STREAM plaintext chunk size. */
export const AGE_STREAM_CHUNK = 64 * 1024;
const POLY1305_TAG = 16;

/** Ciphertext *payload* size for a given plaintext size (header excluded). */
export function agePayloadSize(plaintextSize: number): number {
  const chunks = Math.max(1, Math.ceil(plaintextSize / AGE_STREAM_CHUNK));
  return plaintextSize + POLY1305_TAG * chunks;
}

export interface EncryptedStream {
  /** age-formatted ciphertext (header + nonce + STREAM payload). */
  ciphertext: ReadableStream<Uint8Array>;
  /** Resolves when the final STREAM chunk was emitted; rejects otherwise. */
  finalized: Promise<void>;
  /** Ciphertext bytes emitted so far. */
  bytesOut: () => number;
}

/**
 * Session-scoped encryptor bound to one validated recipient. The recipient
 * cannot be changed after construction; a different recipient requires a new
 * session (and a new instance).
 */
export class AgeStreamEncryptor {
  readonly recipient: ValidatedRecipient;
  private readonly encrypter: Encrypter;

  constructor(recipient: ValidatedRecipient) {
    this.recipient = recipient;
    this.encrypter = new Encrypter();
    this.encrypter.addRecipient(recipient.canonical);
  }

  /** Encrypts a plaintext stream into a fresh, independent age message. */
  async encryptStream(plaintext: ReadableStream<Uint8Array>): Promise<EncryptedStream> {
    const bounded = plaintext.pipeThrough(rechunk(AGE_STREAM_CHUNK));
    const ct = await this.encrypter.encrypt(bounded);
    return tapCompletion(ct as ReadableStream<Uint8Array>);
  }

  /** Encrypts an in-memory buffer (manifest). Same format, same recipient. */
  async encryptBytes(plaintext: Uint8Array): Promise<Uint8Array> {
    return this.encrypter.encrypt(plaintext);
  }
}

function tapCompletion(source: ReadableStream<Uint8Array>): EncryptedStream {
  let out = 0;
  let settled = false;
  let resolveDone!: () => void;
  let rejectDone!: (e: unknown) => void;
  const finalized = new Promise<void>((res, rej) => {
    resolveDone = () => { if (!settled) { settled = true; res(); } };
    rejectDone = e => { if (!settled) { settled = true; rej(e); } };
  });
  finalized.catch(() => {});

  const reader = source.getReader();
  const ciphertext = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        let r: ReadableStreamReadResult<Uint8Array>;
        try {
          r = await reader.read();
        } catch (err) {
          rejectDone(err);
          controller.error(err);
          return;
        }
        if (r.done) {
          resolveDone();
          controller.close();
          return;
        }
        out += r.value.byteLength;
        controller.enqueue(r.value);
      },
      async cancel(reason) {
        rejectDone(reason ?? new Error('Encrypted stream cancelled before completion'));
        try { await reader.cancel(reason); } catch { /* ignore */ }
      },
    },
    { highWaterMark: 0 }
  );
  return { ciphertext, finalized, bytesOut: () => out };
}

// ============================================================================
// Decryption (analyst side)
// ============================================================================

export class AgeStreamDecryptor {
  private readonly decrypter = new Decrypter();

  /**
   * @param identity age X25519 identity (`AGE-SECRET-KEY-1…`). Held only in
   * memory for the lifetime of this object; never logged.
   */
  constructor(identity: string) {
    this.decrypter.addIdentity(identity.trim());
  }

  /**
   * Returns the plaintext stream. The header (and the file-key unwrap) is
   * processed before the promise resolves, so a wrong identity fails here.
   * Payload authentication failures, truncation included, surface as a
   * stream error; output is complete only if the stream ends without error.
   */
  async decryptStream(ciphertext: ReadableStream<Uint8Array>): Promise<ReadableStream<Uint8Array>> {
    return (await this.decrypter.decrypt(ciphertext)) as ReadableStream<Uint8Array>;
  }

  async decryptBytes(ciphertext: Uint8Array): Promise<Uint8Array> {
    return this.decrypter.decrypt(ciphertext);
  }
}
