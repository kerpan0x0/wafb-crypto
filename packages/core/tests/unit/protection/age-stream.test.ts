/**
 * Streaming age encryption: correctness, bounded buffering, fault detection
 * and interoperability with the reference implementation (`age`, Go).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { generateX25519Identity, identityToRecipient } from 'age-encryption';
import { validateRecipient } from '../../../src/protection/recipient';
import {
  AgeStreamEncryptor,
  AgeStreamDecryptor,
  AGE_STREAM_CHUNK,
  agePayloadSize,
} from '../../../src/protection/age-stream';
import { hasTool, makeTempDir } from '../../helpers/independent-tools';

const HAVE_AGE = hasTool('age');

function pattern(n: number, seed = 5): Uint8Array {
  const b = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; }
  return b;
}
function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } });
}
async function collect(s: ReadableStream<Uint8Array>, onChunk?: (n: number) => void): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const r = s.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    onChunk?.(value.length);
    parts.push(value);
  }
  return Buffer.concat(parts);
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

let identity: string;
let enc: AgeStreamEncryptor;
let dec: AgeStreamDecryptor;
let tmp: { dir: string; cleanup: () => Promise<void> };

beforeAll(async () => {
  identity = await generateX25519Identity();
  const recipient = await validateRecipient(await identityToRecipient(identity));
  enc = new AgeStreamEncryptor(recipient);
  dec = new AgeStreamDecryptor(identity);
  tmp = await makeTempDir('wafb-age-');
});
afterAll(async () => { await tmp.cleanup(); });

const SIZES = [0, 1, AGE_STREAM_CHUNK - 1, AGE_STREAM_CHUNK, AGE_STREAM_CHUNK + 1, 3 * AGE_STREAM_CHUNK, 1_000_003];

describe('AgeStreamEncryptor round-trip', () => {
  for (const n of SIZES) {
    it(`decrypts to the same bytes (n=${n}), ciphertext size as specified`, async () => {
      const data = pattern(n, n + 1);
      const chunks = n === 0 ? [] : [data.subarray(0, Math.floor(n / 3)), data.subarray(Math.floor(n / 3))];
      const e = await enc.encryptStream(streamOf(chunks.filter(c => c.length)));
      const ct = await collect(e.ciphertext);
      await expect(e.finalized).resolves.toBeUndefined();
      expect(e.bytesOut()).toBe(ct.length);
      const headerLen = ct.indexOf(0x0a, ct.indexOf(Buffer.from('---'))) + 1 + 16; // header + nonce
      expect(ct.length - headerLen).toBe(agePayloadSize(n));
      const pt = await collect(await dec.decryptStream(streamOf([ct])));
      expect(sha(pt)).toBe(sha(data));
    });
  }

  it('produces a different ciphertext for the same input (fresh file key and nonce)', async () => {
    const data = pattern(1000);
    const a = await collect((await enc.encryptStream(streamOf([data]))).ciphertext);
    const b = await collect((await enc.encryptStream(streamOf([data]))).ciphertext);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).not.toBe(0);
  });

  // NB: this checks the size of each emitted element only. It does NOT prove
  // that the internal queue stays bounded (Typage alone also emits 64 KiB
  // elements, but all at once for a large input chunk); that property is
  // measured by the memory benchmark (bench/), with and without rechunk.
  it('delivers ciphertext in elements of at most one STREAM chunk for an 8 MiB input chunk', async () => {
    const big = pattern(8 * 1024 * 1024);
    const sizes: number[] = [];
    const e = await enc.encryptStream(streamOf([big]));
    await collect(e.ciphertext, n => sizes.push(n));
    // Header + nonce chunks are tiny; payload chunks are 64 KiB + 16 tag.
    expect(Math.max(...sizes)).toBeLessThanOrEqual(AGE_STREAM_CHUNK + 16);
  });

  it('propagates backpressure: a stalled consumer stops pulling plaintext', async () => {
    let pulled = 0;
    const src = new ReadableStream<Uint8Array>(
      { pull(c) { pulled++; c.enqueue(new Uint8Array(AGE_STREAM_CHUNK)); } },
      { highWaterMark: 1 }
    );
    const e = await enc.encryptStream(src);
    const r = e.ciphertext.getReader();
    await r.read(); await r.read();
    await new Promise(res => setTimeout(res, 50));
    expect(pulled).toBeLessThan(12);
    await r.cancel();
  });

  it('rejects `finalized` when the plaintext source errors', async () => {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const src = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
    const e = await enc.encryptStream(src);
    const p = collect(e.ciphertext);
    ctrl.enqueue(pattern(70_000));
    ctrl.error(new Error('USB disconnected'));
    await expect(p).rejects.toThrow('USB disconnected');
    await expect(e.finalized).rejects.toThrow('USB disconnected');
  });

  it('rejects `finalized` when the consumer cancels', async () => {
    const e = await enc.encryptStream(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(10)); } }));
    await e.ciphertext.cancel(new Error('sink failed'));
    await expect(e.finalized).rejects.toThrow('sink failed');
  });
});

describe('Decryption rejects tampering and truncation', () => {
  let ct: Uint8Array;
  beforeAll(async () => {
    ct = await collect((await enc.encryptStream(streamOf([pattern(200_000)]))).ciphertext);
  });

  it('truncation at a chunk boundary is detected', async () => {
    const headerLen = ct.length - agePayloadSize(200_000);
    const cut = ct.subarray(0, headerLen + (AGE_STREAM_CHUNK + 16));
    await expect(collect(await dec.decryptStream(streamOf([cut])))).rejects.toThrow();
  });

  it('a flipped payload byte is detected', async () => {
    const bad = Uint8Array.from(ct);
    bad[bad.length - 100] ^= 0x01;
    await expect(collect(await dec.decryptStream(streamOf([bad])))).rejects.toThrow();
  });

  it('a wrong identity fails at header processing', async () => {
    const other = new AgeStreamDecryptor(await generateX25519Identity());
    await expect(other.decryptStream(streamOf([ct]))).rejects.toThrow();
  });
});

describe.skipIf(!HAVE_AGE)('Interoperability with the reference age CLI', () => {
  const version = () => spawnSync('age', ['--version']).stdout.toString().trim();

  it('WAFB-encrypted files decrypt with `age -d` (empty, small, multi-chunk)', async () => {
    const keyFile = path.join(tmp.dir, 'key.txt');
    writeFileSync(keyFile, identity + '\n', { mode: 0o600 });
    for (const n of [0, 5, AGE_STREAM_CHUNK, AGE_STREAM_CHUNK + 1, 2_500_000]) {
      const data = pattern(n, 99 + n);
      const ct = await collect((await enc.encryptStream(streamOf(n ? [data] : []))).ciphertext);
      const f = path.join(tmp.dir, `a${n}.age`);
      writeFileSync(f, ct);
      const pt = execFileSync('age', ['-d', '-i', keyFile, f], { maxBuffer: 64 * 1024 * 1024 });
      expect(sha(pt), `age ${version()} n=${n}`).toBe(sha(data));
    }
  });

  it('`age -r` encrypted files decrypt with WAFB', async () => {
    const recipient = await identityToRecipient(identity);
    for (const n of [0, 1, AGE_STREAM_CHUNK + 7, 1_000_000]) {
      const data = pattern(n, 7 + n);
      const f = path.join(tmp.dir, `in${n}.bin`);
      writeFileSync(f, data);
      const ct = execFileSync('age', ['-r', recipient, f], { maxBuffer: 64 * 1024 * 1024 });
      const pt = await collect(await dec.decryptStream(streamOf([new Uint8Array(ct)])));
      expect(sha(pt)).toBe(sha(data));
    }
  });

  it('`age -d` refuses a truncated WAFB file', async () => {
    const keyFile = path.join(tmp.dir, 'key2.txt');
    writeFileSync(keyFile, identity + '\n', { mode: 0o600 });
    const ct = await collect((await enc.encryptStream(streamOf([pattern(300_000)]))).ciphertext);
    const f = path.join(tmp.dir, 'trunc.age');
    writeFileSync(f, ct.subarray(0, ct.length - 40_000));
    const r = spawnSync('age', ['-d', '-i', keyFile, f]);
    expect(r.status).not.toBe(0);
    expect(readFileSync(f).length).toBe(ct.length - 40_000);
  });
});
