/**
 * BackupAcquirer under the protected-acquisition contract:
 * stream availability ≠ completion; outcome and abort signal are propagated.
 */
import { describe, it, expect, vi } from 'vitest';
import { BackupAcquirer } from '../../../../src/forensics/acquisition/backup';
import { createMockDeviceForAcquirer, makeShellResult, createMockProgressCallback } from '../../../helpers/test-helpers';
import type { SourceOutcome } from '../../../../src/utils/source-monitor';

function setup(outcome: SourceOutcome) {
  const device = createMockDeviceForAcquirer();
  device.shell.mockImplementation(async (cmd: string) =>
    cmd.startsWith('which') ? makeShellResult('/system/bin/bu') : makeShellResult('')
  );
  device.spawn.mockResolvedValue({
    stdout: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(10)); c.close(); } }),
    exited: Promise.resolve(outcome.exitCode ?? 0),
    outcome: Promise.resolve(outcome),
  });
  return device;
}

describe('BackupAcquirer contract', () => {
  it('returns the stream with a deferred outcome and an explicitly unknown size', async () => {
    const device = setup({ cause: 'eof', bytes: 10, exitCode: 0 });
    const r = await new BackupAcquirer(device as any).acquire();
    const f = r.files![0];
    expect(f.sizeUnknown).toBe(true);
    expect(await f.outcome).toEqual({ cause: 'eof', bytes: 10, exitCode: 0 });
  });

  it('never reports completed while only the stream is ready', async () => {
    const device = setup({ cause: 'eof', bytes: 10, exitCode: 0 });
    const { callback, getProgressHistory } = createMockProgressCallback();
    await new BackupAcquirer(device as any).acquire(callback);
    expect(getProgressHistory().some(p => p.status === 'completed')).toBe(false);
  });

  it('passes the session abort signal to the device transport', async () => {
    const device = setup({ cause: 'eof', bytes: 10, exitCode: 0 });
    const ac = new AbortController();
    await new BackupAcquirer(device as any, { type: 'full', signal: ac.signal }).acquire();
    expect(device.spawn).toHaveBeenCalledWith(expect.stringContaining('backup'), 300000, ac.signal);
  });

  it('with computeHash, a source error rejects the digest instead of being only logged', async () => {
    const device = createMockDeviceForAcquirer();
    device.shell.mockImplementation(async (cmd: string) =>
      cmd.startsWith('which') ? makeShellResult('/system/bin/bu') : makeShellResult('')
    );
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    device.spawn.mockResolvedValue({
      stdout: new ReadableStream({ start(c) { ctrl = c; } }),
      exited: new Promise(() => {}),
    });
    const r = await new BackupAcquirer(device as any, { type: 'full', computeHash: true }).acquire();
    const f = r.files![0];
    const reader = f.stream.getReader();
    ctrl.enqueue(new Uint8Array(5));
    await reader.read();
    ctrl.error(new Error('USB disconnected'));
    await expect(reader.read()).rejects.toThrow('USB disconnected');
    await expect(f.hashPromise).rejects.toThrow('USB disconnected');
    vi.restoreAllMocks();
  });
});
