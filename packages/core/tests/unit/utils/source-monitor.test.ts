import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  monitorSource,
  evaluateSourceOutcome,
  type SourceOutcome,
} from '../../../src/utils/source-monitor';
import {
  hashingPassthrough,
  rechunk,
  wrapWithIdleTimeout,
} from '../../../src/utils/stream-helpers';
import { SourceIdleTimeoutError } from '../../../src/utils/errors';

// ── helpers ──────────────────────────────────────────────────────────────────

function streamOf(chunks: Uint8Array[], { close = true } = {}): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      if (close) c.close();
    },
  });
}

async function drain(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const r = s.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    parts.push(value);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function bytes(n: number, seed = 7): Uint8Array {
  const b = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; }
  return b;
}

function split(data: Uint8Array, sizes: number[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  let off = 0, i = 0;
  while (off < data.length) {
    const n = sizes[i++ % sizes.length];
    out.push(data.slice(off, off + n));
    off += n;
  }
  return out;
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

// ── monitorSource ────────────────────────────────────────────────────────────

describe('monitorSource', () => {
  it('reports eof with exit code and byte count on a regular end', async () => {
    const data = bytes(1000);
    const { stream, outcome } = monitorSource(streamOf(split(data, [100])), {
      exited: Promise.resolve(0),
    });
    expect(await drain(stream)).toEqual(data);
    const o = await outcome;
    expect(o).toEqual({ cause: 'eof', bytes: 1000, exitCode: 0 });
    expect(evaluateSourceOutcome(o)).toEqual({ acceptable: true });
  });

  it('turns a stalled source into an idle-timeout ERROR, not an EOF (0.3.1 defect)', async () => {
    const onStop = vi.fn();
    const { stream, outcome } = monitorSource(
      streamOf([new Uint8Array(10)], { close: false }),
      { idleTimeoutMs: 30, exited: new Promise<number>(() => {}), exitGraceMs: 10, onStop }
    );
    await expect(drain(stream)).rejects.toBeInstanceOf(SourceIdleTimeoutError);
    const o = await outcome;
    expect(o.cause).toBe('idle-timeout');
    expect(o.bytes).toBe(10);
    expect(o.exitCode).toBeNull();
    expect(evaluateSourceOutcome(o).acceptable).toBe(false);
    expect(onStop).toHaveBeenCalled();
  });

  it('closes normally on idle when the remote process has already exited', async () => {
    const { stream, outcome } = monitorSource(
      streamOf([new Uint8Array(5)], { close: false }),
      { idleTimeoutMs: 30, exited: Promise.resolve(0) }
    );
    expect((await drain(stream)).length).toBe(5);
    expect(await outcome).toMatchObject({ cause: 'eof', exitCode: 0, bytes: 5 });
  });

  it('classifies a transport error as source-error', async () => {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const src = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
    const { stream, outcome } = monitorSource(src, { exited: new Promise(() => {}), exitGraceMs: 5 });
    const p = drain(stream);
    ctrl.enqueue(new Uint8Array(3));
    await new Promise(r => setTimeout(r, 5));
    ctrl.error(new Error('USB disconnected'));
    await expect(p).rejects.toThrow('USB disconnected');
    expect(await outcome).toMatchObject({ cause: 'source-error', bytes: 3, error: 'USB disconnected' });
  });

  it('propagates abort down to the source and stops the remote process', async () => {
    const ac = new AbortController();
    const onStop = vi.fn();
    const cancelSpy = vi.fn();
    const src = new ReadableStream<Uint8Array>({ start() {}, cancel: cancelSpy });
    const { stream, outcome } = monitorSource(src, { signal: ac.signal, onStop, exitGraceMs: 5 });
    const p = drain(stream);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(await outcome).toMatchObject({ cause: 'cancelled' });
    await new Promise(r => setTimeout(r, 0));
    expect(cancelSpy).toHaveBeenCalled();
    expect(onStop).toHaveBeenCalled();
  });

  it('records a consumer cancellation as cancelled', async () => {
    const { stream, outcome } = monitorSource(streamOf([new Uint8Array(1)], { close: false }), { exitGraceMs: 5 });
    await stream.cancel('user');
    expect((await outcome).cause).toBe('cancelled');
  });

  it('does not presume success when no exit code is observable', () => {
    const o: SourceOutcome = { cause: 'eof', bytes: 1, exitCode: null };
    expect(evaluateSourceOutcome(o)).toEqual({ acceptable: true, limitation: 'exit-code-not-observed' });
  });

  it('rejects an EOF followed by a non-zero exit code', () => {
    expect(evaluateSourceOutcome({ cause: 'eof', bytes: 1, exitCode: 2 })).toEqual({
      acceptable: false,
      reason: 'exit-code-2',
    });
  });

  it('wrapWithIdleTimeout keeps the new error semantics', async () => {
    const s = wrapWithIdleTimeout(streamOf([new Uint8Array(1)], { close: false }), 20);
    await expect(drain(s)).rejects.toBeInstanceOf(SourceIdleTimeoutError);
  });
});

// ── hashingPassthrough ───────────────────────────────────────────────────────

describe('hashingPassthrough (contract fixed for the protected pipeline)', () => {
  const data = bytes(200_003);
  const segmentations: Array<[string, number[]]> = [
    ['single chunk', [data.length]],
    ['1-byte chunks (first 5000 bytes)', [1]],
    ['64 KiB boundary', [65536]],
    ['64 KiB ± 1', [65535, 65537]],
    ['irregular', [7, 4096, 13, 65536, 1]],
  ];

  for (const [label, sizes] of segmentations) {
    it(`digest is independent of segmentation: ${label}`, async () => {
      const input = label.startsWith('1-byte') ? data.slice(0, 5000) : data;
      const { writable, readable, hashPromise } = await hashingPassthrough('sha-256');
      const pipe = streamOf(split(input, sizes)).pipeTo(writable);
      const out = await drain(readable);
      await pipe;
      expect(out).toEqual(input);
      expect(await hashPromise).toBe(sha256(input));
    });
  }

  it('hashes the empty sequence', async () => {
    const { writable, readable, hashPromise } = await hashingPassthrough('sha-256');
    const pipe = streamOf([]).pipeTo(writable);
    await drain(readable);
    await pipe;
    expect(await hashPromise).toBe(sha256(new Uint8Array(0)));
  });

  it('REJECTS the digest when the writable side is aborted (was pending forever in 0.3.1)', async () => {
    const { writable, readable, hashPromise } = await hashingPassthrough('sha-256');
    const reader = readable.getReader();
    const w = writable.getWriter();
    void w.write(new Uint8Array([1, 2, 3]));
    await reader.read();
    await w.abort(new Error('source disconnected'));
    await expect(hashPromise).rejects.toThrow('source disconnected');
  });

  it('rejects the digest when the source errors mid-pipe', async () => {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const src = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
    const { writable, readable, hashPromise } = await hashingPassthrough('sha-256');
    const pipe = src.pipeTo(writable).catch(() => {});
    const consumer = drain(readable).catch(() => {});
    ctrl.enqueue(new Uint8Array(10));
    ctrl.error(new Error('USB disconnected'));
    await pipe; await consumer;
    await expect(hashPromise).rejects.toThrow('USB disconnected');
  });

  it('rejects the digest when the consumer cancels the readable side', async () => {
    const { writable, readable, hashPromise } = await hashingPassthrough('sha-256');
    const src = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(16)); } });
    const pipe = src.pipeTo(writable).catch(() => {});
    const r = readable.getReader();
    await r.read();
    await r.cancel(new Error('sink rejected'));
    await pipe;
    await expect(hashPromise).rejects.toBeDefined();
  });

  it('applies backpressure: an unread readable stops pulling from the source', async () => {
    let pulled = 0;
    const src = new ReadableStream<Uint8Array>(
      { pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); } },
      { highWaterMark: 1 }
    );
    const { writable } = await hashingPassthrough('sha-256');
    void src.pipeTo(writable).catch(() => {});
    await new Promise(r => setTimeout(r, 50));
    // Bounded: a handful of chunks in flight, not an unbounded accumulation.
    expect(pulled).toBeLessThan(10);
  });
});

// ── rechunk ──────────────────────────────────────────────────────────────────

describe('rechunk', () => {
  it('bounds element size without altering bytes or order', async () => {
    const data = bytes(10_000);
    const sizes: number[] = [];
    const out = streamOf([data.slice(0, 9000), data.slice(9000)])
      .pipeThrough(rechunk(1024))
      .pipeThrough(new TransformStream({ transform(c, ctl) { sizes.push(c.length); ctl.enqueue(c); } }));
    expect(await drain(out)).toEqual(data);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(1024);
  });

  it('rejects a non-positive limit', () => {
    expect(() => rechunk(0)).toThrow(RangeError);
  });
});
