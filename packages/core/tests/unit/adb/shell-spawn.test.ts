import { describe, it, expect, vi } from 'vitest';
import type { Adb } from '@yume-chan/adb';
import { Shell } from '../../../src/adb/shell';
import { SourceIdleTimeoutError } from '../../../src/utils/errors';

function socket(opts: {
  stdout: ReadableStream<Uint8Array>;
  stderr?: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}) {
  return {
    stdout: opts.stdout,
    stderr: opts.stderr ?? new ReadableStream({ start(c) { c.close(); } }),
    stdin: new WritableStream(),
    exited: opts.exited,
    kill: vi.fn(),
  };
}

function adbWith(sock: ReturnType<typeof socket>): Adb {
  return {
    subprocess: { shellProtocol: { spawn: vi.fn().mockResolvedValue(sock) } },
  } as unknown as Adb;
}

async function drain(s: ReadableStream<Uint8Array>) {
  const r = s.getReader();
  let n = 0;
  for (;;) { const { done, value } = await r.read(); if (done) return n; n += value.length; }
}

describe('Shell.spawn (monitored)', () => {
  it('exposes a settled outcome with exit code on a regular end', async () => {
    const sock = socket({
      stdout: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(42)); c.close(); } }),
      exited: Promise.resolve(0),
    });
    const res = await new Shell(adbWith(sock), 'bu backup -all').spawn(1000);
    expect(await drain(res.stdout)).toBe(42);
    expect(await res.outcome).toEqual({ cause: 'eof', bytes: 42, exitCode: 0 });
  });

  it('reports idle timeout as an error and kills the remote process', async () => {
    const sock = socket({
      stdout: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(8)); } }),
      exited: new Promise<number>(() => {}),
    });
    const res = await new Shell(adbWith(sock), 'bu backup -all').spawn(25);
    await expect(drain(res.stdout)).rejects.toBeInstanceOf(SourceIdleTimeoutError);
    expect((await res.outcome)!.cause).toBe('idle-timeout');
    expect(sock.kill).toHaveBeenCalled();
  });

  it('kills the remote process when the session aborts', async () => {
    const ac = new AbortController();
    const sock = socket({ stdout: new ReadableStream({ start() {} }), exited: new Promise(() => {}) });
    const res = await new Shell(adbWith(sock), 'bu backup -all').spawn(0, ac.signal);
    const p = drain(res.stdout);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise(r => setTimeout(r, 0));
    expect(sock.kill).toHaveBeenCalled();
  });

  it('drains stderr concurrently and keeps only a bounded tail', async () => {
    const big = new TextEncoder().encode('x'.repeat(5000) + 'TAIL');
    const sock = socket({
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({ start(c) { c.enqueue(big); c.close(); } }),
      exited: Promise.resolve(1),
    });
    const res = await new Shell(adbWith(sock), 'false').spawn(1000);
    await drain(res.stdout);
    const tail = await res.stderrTail!;
    expect(tail.length).toBeLessThanOrEqual(2048);
    expect(tail.endsWith('TAIL')).toBe(true);
    expect((await res.outcome)!.exitCode).toBe(1);
  });
});
