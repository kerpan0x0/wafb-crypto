/**
 * SessionCoordinator end-to-end tests.
 *
 * Archives are written to real files, read back with Python's zipfile and
 * decrypted with the reference `age` CLI, then compared with the manifest.
 * Fault injection covers: stalled source, non-zero exit, module failure,
 * unsupported module, sink rejection, failed close, cancellation, preflight.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateX25519Identity, identityToRecipient } from 'age-encryption';
import { validateRecipient, type ValidatedRecipient } from '../../../src/protection/recipient';
import {
  SessionCoordinator,
  type ModuleTask,
  type ProtectedSessionConfig,
  type LegacySessionConfig,
  type SessionState,
} from '../../../src/protection/session';
import { formatBlocksEqual, type ManifestV1, type ArchiveDescriptor } from '../../../src/protection/manifest';
import { monitorSource } from '../../../src/utils/source-monitor';
import { bytesToStream, hashingPassthrough } from '../../../src/utils/stream-helpers';
import type { AcquisitionFile, AcquisitionResult, AcquisitionType } from '../../../src/forensics/acquisition';
import {
  ageDecrypt,
  fileSink,
  hasTool,
  makeTempDir,
  pythonZipInspect,
  pythonZipRead,
} from '../../helpers/independent-tools';

const TOOLS = hasTool('python3') && hasTool('age');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function pattern(n: number, seed = 3): Uint8Array {
  const b = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; }
  return b;
}

/** A device-like stream: chunks then (optionally) EOF, plus an exit code. */
function deviceSource(data: Uint8Array, opts: { chunk?: number; stallAfter?: number; exitCode?: number | null; idleMs?: number } = {}) {
  const chunk = opts.chunk ?? 50_000;
  const stallAfter = opts.stallAfter ?? Infinity;
  let off = 0;
  let resolveExit!: (n: number) => void;
  const exited = new Promise<number>(r => (resolveExit = r));
  const kill = vi.fn();
  const raw = new ReadableStream<Uint8Array>({
    pull(c) {
      if (off >= stallAfter) return new Promise(() => {}); // stall forever
      if (off >= data.length) {
        c.close();
        if (opts.exitCode !== null) resolveExit(opts.exitCode ?? 0);
        return;
      }
      const n = Math.min(chunk, data.length - off, stallAfter - off);
      c.enqueue(data.slice(off, off + n));
      off += n;
    },
  });
  const m = monitorSource(raw, { idleTimeoutMs: opts.idleMs ?? 100, exited, exitGraceMs: 20, onStop: kill });
  return { ...m, kill };
}

function result(type: AcquisitionType, files: AcquisitionFile[], ok = true): AcquisitionResult {
  const now = new Date();
  return { success: ok, type, files, startTime: now, endTime: now, duration: 0, data: { note: `${type} data` } };
}

async function generatedJsonFile(name: string, obj: unknown, withHash: boolean): Promise<AcquisitionFile> {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (!withHash) return { fileName: name, fileSize: bytes.length, stream: bytesToStream(bytes), mimeType: 'application/json' };
  const { writable, readable, hashPromise } = await hashingPassthrough('sha-256');
  bytesToStream(bytes).pipeTo(writable).catch(() => {});
  return { fileName: name, fileSize: bytes.length, stream: readable, hashPromise, mimeType: 'application/json' };
}

let identity: string;
let recipient: ValidatedRecipient;
let tmp: { dir: string; cleanup: () => Promise<void> };
let idFile: string;

beforeAll(async () => {
  identity = await generateX25519Identity();
  recipient = await validateRecipient(await identityToRecipient(identity));
  tmp = await makeTempDir('wafb-session-');
  idFile = path.join(tmp.dir, 'identity.txt');
  writeFileSync(idFile, identity + '\n', { mode: 0o600 });
});
afterAll(async () => { await tmp.cleanup(); });

function protectedConfig(requested: AcquisitionType[], over: Partial<ProtectedSessionConfig> = {}): ProtectedSessionConfig {
  return {
    mode: 'protected',
    requested,
    profileSource: 'invite',
    tool: { version: '0.4.0-test', build: 'test' },
    device: { androidVersion: '14', buildId: 'X', model: 'Pixel Test', manufacturer: 'G', brand: 'g', sdkVersion: 34, serialNumber: 'SERIAL-SECRET-123' },
    recipient,
    recipientConfirmation: { method: 'full-key-id-entered', confirmedAt: '2026-11-23T12:00:00Z' },
    caseRef: 'C-TEST0001',
    ...over,
  };
}

/** Reads an archive with independent tools and decrypts every entry with age(1). */
function openProtectedArchive(file: string) {
  const py = pythonZipInspect(file, { hash: false });
  expect(py.testzip).toBeNull();
  const names = py.entries.map(e => e.name);
  const descriptor = JSON.parse(pythonZipRead(file, 'wafb-archive.json').toString()) as ArchiveDescriptor;
  const manifestPt = ageDecrypt(idFile, pythonZipRead(file, descriptor.manifestEntry));
  expect(manifestPt, 'manifest decrypts with age(1)').not.toBeNull();
  const manifest = JSON.parse(manifestPt!.toString()) as ManifestV1;
  const decrypted: Record<string, Buffer | null> = {};
  for (const a of manifest.artifacts) decrypted[a.id] = ageDecrypt(idFile, pythonZipRead(file, a.entry));
  return { names, descriptor, manifest, decrypted };
}

describe.skipIf(!TOOLS)('SessionCoordinator — protected mode', () => {
  it('happy path: opaque entries, encrypted manifest, digests match after decryption with age(1)', async () => {
    const file = path.join(tmp.dir, 'ok.zip');
    const backupData = pattern(1_234_567);
    const states: SessionState[] = [];
    const logs: string[] = [];

    const tasks: ModuleTask[] = [
      { module: 'packages', run: async () => result('packages', [await generatedJsonFile('packages.json', { pkgs: ['a', 'b'] }, true)]) },
      { module: 'settings', run: async () => result('settings', [await generatedJsonFile('settings.json', { s: 1 }, false)]) },
      {
        module: 'backup',
        run: async () => {
          const src = deviceSource(backupData);
          return result('backup', [{ fileName: 'backup.ab', fileSize: 0, sizeUnknown: true, stream: src.stream, outcome: src.outcome }]);
        },
      },
    ];
    const s = new SessionCoordinator(protectedConfig(['packages', 'settings', 'backup']), {
      sink: await fileSink(file),
      events: { onStateChange: st => states.push(st), onLog: e => logs.push(JSON.stringify(e)) },
    });
    const res = await s.run(tasks);

    expect(res.state).toBe('completed');
    expect(res.saveConfirmed).toBe(true);
    expect(states).toEqual(['ready', 'acquiring', 'finalizing', 'completed']);
    expect(res.archive!.sha256).toBe(sha(readFileSync(file)));

    const { names, descriptor, manifest, decrypted } = openProtectedArchive(file);
    // Only opaque names + manifest + descriptor are visible.
    expect(names.sort()).toEqual(['a000001.age', 'a000002.age', 'a000003.age', 'manifest.age', 'wafb-archive.json']);
    // Descriptor carries no case, device or recipient information.
    const dtext = JSON.stringify(descriptor);
    for (const leak of ['C-TEST0001', 'SERIAL-SECRET-123', 'Pixel', recipient.canonical, recipient.keyId, 'backup']) {
      expect(dtext).not.toContain(leak);
    }
    expect(formatBlocksEqual(descriptor, manifest.format)).toBe(true);

    expect(manifest.session.caseRef).toBe('C-TEST0001');
    expect(manifest.protection).toMatchObject({ mode: 'protected', keyId: recipient.keyId, recipient: recipient.canonical });
    expect(manifest.modules.completed).toEqual(['packages', 'settings', 'backup']);
    expect(manifest.modules.notSelected).toContain('logcat');

    for (const a of manifest.artifacts) {
      expect(a.status).toBe('verified');
      expect(decrypted[a.id]).not.toBeNull();
      expect(sha(decrypted[a.id]!)).toBe(a.digest!.value);
      expect(decrypted[a.id]!.length).toBe(a.bytesAcquired);
    }
    const backup = manifest.artifacts.find(a => a.module === 'backup')!;
    expect(backup.sizeAnnounced).toBeNull(); // unknown, not zero
    expect(backup.bytesAcquired).toBe(backupData.length);
    expect(backup.source).toEqual({ cause: 'eof', exitCode: 0 });
    expect(backup.digest!.computedBy).toBe('coordinator');
    expect(manifest.artifacts.find(a => a.module === 'packages')!.digest!.computedBy).toBe('acquirer-passthrough');
    expect(manifest.artifacts.find(a => a.module === 'settings')!.source.limitation).toBe('source-outcome-not-exposed');

    // Logs never contain artefact content or key material.
    const allLogs = logs.join('\n');
    expect(allLogs).not.toContain(identity.slice(16, 40));
    expect(allLogs).not.toContain('SERIAL-SECRET-123');
  });

  it('a stalled backup is sealed as INCOMPLETE (valid age, partial digest); later modules still run → partial', async () => {
    const file = path.join(tmp.dir, 'stall.zip');
    const data = pattern(600_000);
    let src!: ReturnType<typeof deviceSource>;
    const tasks: ModuleTask[] = [
      { module: 'backup', run: async () => { src = deviceSource(data, { stallAfter: 250_000, idleMs: 60 }); return result('backup', [{ fileName: 'backup.ab', fileSize: 0, sizeUnknown: true, stream: src.stream, outcome: src.outcome }]); } },
      { module: 'settings', run: async () => result('settings', [await generatedJsonFile('settings.json', { s: 2 }, false)]) },
    ];
    const res = await new SessionCoordinator(protectedConfig(['backup', 'settings']), { sink: await fileSink(file) }).run(tasks);

    expect(res.state).toBe('partial');
    expect(res.saveConfirmed).toBe(true);
    expect(src.kill).toHaveBeenCalled();

    const { manifest, decrypted } = openProtectedArchive(file);
    const b = manifest.artifacts.find(a => a.module === 'backup')!;
    expect(b.status).toBe('incomplete');
    expect(b.verdict).toEqual({ source: false, digest: false, encryption: true, write: true });
    expect(b.digest).toBeNull();
    expect(b.partialDigest!.coversBytes).toBe(250_000);
    expect(b.error).toMatchObject({ code: 'SOURCE_IDLE_TIMEOUT', phase: 'source', bytesBeforeError: 250_000 });
    expect(b.source.cause).toBe('idle-timeout');
    // The prefix IS a cryptographically valid age file: validity ≠ completeness.
    expect(decrypted[b.id]).not.toBeNull();
    expect(sha(decrypted[b.id]!)).toBe(sha(data.subarray(0, 250_000)));
    expect(manifest.modules.failed).toEqual(['backup']);
    expect(manifest.modules.completed).toEqual(['settings']);
  });

  it('EOF with a non-zero exit code is not accepted as a complete source', async () => {
    const file = path.join(tmp.dir, 'exit.zip');
    const tasks: ModuleTask[] = [
      { module: 'bugreport', run: async () => { const s = deviceSource(pattern(1000), { exitCode: 1 }); return result('bugreport', [{ fileName: 'bugreport.txt', fileSize: 0, stream: s.stream, outcome: s.outcome }]); } },
    ];
    const res = await new SessionCoordinator(protectedConfig(['bugreport']), { sink: await fileSink(file) }).run(tasks);
    expect(res.state).toBe('partial');
    const a = res.manifest!.artifacts[0];
    expect(a.status).toBe('incomplete');
    expect(a.digest).not.toBeNull(); // all received bytes hashed …
    expect(a.verdict.source).toBe(false); // … but the source did not end acceptably
    expect(a.error!.code).toBe('SOURCE_EXIT_CODE_1');
  });

  it('module failure before writing and unsupported modules are recorded; others continue', async () => {
    const file = path.join(tmp.dir, 'modfail.zip');
    const tasks: ModuleTask[] = [
      { module: 'logcat', run: async () => { throw new Error('Permission denied'); } },
      { module: 'tmp' },
      { module: 'env', run: async () => result('env', [], false) },
      { module: 'mount', run: async () => result('mount', [await generatedJsonFile('mount.json', { m: 1 }, false)]) },
    ];
    const res = await new SessionCoordinator(protectedConfig(['logcat', 'tmp', 'env', 'mount']), { sink: await fileSink(file) }).run(tasks);
    expect(res.state).toBe('partial');
    const m = res.manifest!.modules;
    expect(m.failed.sort()).toEqual(['env', 'logcat']);
    expect(m.unsupported).toEqual(['tmp']);
    expect(m.completed).toEqual(['mount']);
    expect(m.details.find(d => d.module === 'logcat')!.error).toMatchObject({ phase: 'module', message: 'Permission denied' });
    expect(openProtectedArchive(file).manifest.artifacts).toHaveLength(1);
  });
});

describe('SessionCoordinator — fatal errors, cancellation, preflight', () => {
  it('sink rejection mid-entry fails the session, stops the source, never reports a save', async () => {
    let n = 0;
    let closed = false;
    const sink = new WritableStream<Uint8Array>({
      write() { if (++n > 5) { const e = new Error('disk full'); e.name = 'QuotaExceededError'; throw e; } },
      close() { closed = true; },
    });
    let src!: ReturnType<typeof deviceSource>;
    const tasks: ModuleTask[] = [
      { module: 'backup', run: async () => { src = deviceSource(pattern(2_000_000)); return result('backup', [{ fileName: 'backup.ab', fileSize: 0, stream: src.stream, outcome: src.outcome }]); } },
      { module: 'settings', run: vi.fn() },
    ];
    const res = await new SessionCoordinator(protectedConfig(['backup', 'settings']), { sink }).run(tasks);
    expect(res.state).toBe('failed');
    expect(res.saveConfirmed).toBe(false);
    expect(res.error).toMatchObject({ code: 'SINK_QUOTA_EXCEEDED', phase: 'write' });
    expect(tasks[1].run).not.toHaveBeenCalled();
    // A failed write errors the stream (Streams standard): the sink must never
    // be closed, which would commit a half-written archive.
    expect(closed).toBe(false);
    await new Promise(r => setTimeout(r, 10));
    expect(src.kill).toHaveBeenCalled();
  });

  it('a failing sink close is reported as not saved', async () => {
    const sink = new WritableStream<Uint8Array>({ close() { throw new Error('close failed'); } });
    const tasks: ModuleTask[] = [{ module: 'env', run: async () => result('env', [await generatedJsonFile('env.json', {}, false)]) }];
    const res = await new SessionCoordinator(protectedConfig(['env']), { sink }).run(tasks);
    expect(res.state).toBe('failed');
    expect(res.saveConfirmed).toBe(false);
    expect(res.error!.phase).toBe('finalize');
  });

  it('cancellation mid-stream stops the source, aborts the sink and settles every promise', async () => {
    let aborted = false;
    const sink = new WritableStream<Uint8Array>({ abort() { aborted = true; } });
    let src!: ReturnType<typeof deviceSource>;
    const states: SessionState[] = [];
    const s = new SessionCoordinator(protectedConfig(['backup', 'env']), {
      sink,
      events: {
        onStateChange: st => states.push(st),
        onArtifactProgress: p => { if (p.bytesAcquired > 200_000) s.cancel(); },
      },
      progressEveryBytes: 50_000,
    });
    const envRun = vi.fn();
    const res = await s.run([
      { module: 'backup', run: async () => { src = deviceSource(pattern(5_000_000), { idleMs: 0 }); return result('backup', [{ fileName: 'backup.ab', fileSize: 0, stream: src.stream, outcome: src.outcome }]); } },
      { module: 'env', run: envRun },
    ]);
    expect(res.state).toBe('cancelled');
    expect(res.saveConfirmed).toBe(false);
    expect(states.at(-1)).toBe('cancelled');
    expect(aborted).toBe(true);
    expect(envRun).not.toHaveBeenCalled();
    await new Promise(r => setTimeout(r, 10));
    expect(src.kill).toHaveBeenCalled();
    expect((await src.outcome).cause).toBe('cancelled');
  });

  it('cancellation while an acquirer is still preparing does not wait for it', async () => {
    const s = new SessionCoordinator(protectedConfig(['packages']), { sink: new WritableStream() });
    const never = new Promise<AcquisitionResult>(() => {});
    setTimeout(() => s.cancel(), 20);
    const res = await s.run([{ module: 'packages', run: () => never }]);
    expect(res.state).toBe('cancelled');
  });

  it('preflight refuses an unconfirmed recipient without running any module', async () => {
    const run = vi.fn();
    const cfg = protectedConfig(['env'], { recipientConfirmation: undefined as never });
    const res = await new SessionCoordinator(cfg, { sink: new WritableStream() }).run([{ module: 'env', run }]);
    expect(res).toMatchObject({ state: 'failed', error: { code: 'RECIPIENT_UNVERIFIED', phase: 'preflight' } });
    expect(run).not.toHaveBeenCalled();
  });

  it('preflight refuses tasks that differ from the configured profile', async () => {
    const res = await new SessionCoordinator(protectedConfig(['env']), { sink: new WritableStream() }).run([{ module: 'logcat' }]);
    expect(res.error!.code).toBe('TASKS_MISMATCH');
  });

  it('configuration is immutable after construction (recipient cannot change mid-session)', async () => {
    const cfg = protectedConfig(['env']);
    const s = new SessionCoordinator(cfg, { sink: new WritableStream() });
    (cfg as { caseRef: string }).caseRef = 'C-CHANGED';
    expect(s.config.caseRef).toBe('C-TEST0001');
    expect(() => { (s.config as ProtectedSessionConfig).recipient = recipient; }).toThrow(TypeError);
    expect(() => { (s.config.requested as AcquisitionType[]).push('backup'); }).toThrow(TypeError);
  });

  it('a session cannot be run twice', async () => {
    const s = new SessionCoordinator(protectedConfig(['env']), { sink: new WritableStream() });
    await s.run([{ module: 'env', run: async () => result('env', []) }]);
    await expect(s.run([{ module: 'env' }])).rejects.toThrow(/only once/);
  });
});

describe.skipIf(!hasTool('python3'))('SessionCoordinator — legacy mode (explicit, unencrypted)', () => {
  it('writes plaintext entries and a legacy manifest; descriptor says LEGACY', async () => {
    const file = path.join(tmp.dir, 'legacy.zip');
    const data = pattern(300_000);
    const cfg: LegacySessionConfig = {
      mode: 'legacy',
      folder: 'wafb-acquisition-2026-11-23T12-00-00',
      requested: ['backup', 'env'],
      profileSource: 'operator',
      tool: { version: '0.4.0-test' },
      device: null,
    };
    const res = await new SessionCoordinator(cfg, { sink: await fileSink(file) }).run([
      { module: 'backup', run: async () => { const s = deviceSource(data); return result('backup', [{ fileName: 'backup.ab', fileSize: 0, stream: s.stream, outcome: s.outcome }]); } },
      { module: 'env', run: async () => result('env', [await generatedJsonFile('env.json', { PATH: '/bin' }, true)]) },
    ]);
    expect(res.state).toBe('completed');
    const py = pythonZipInspect(file);
    const byName = Object.fromEntries(py.entries.map(e => [e.name, e]));
    expect(byName[`${cfg.folder}/backup.ab`].sha256).toBe(sha(data));
    const manifest = JSON.parse(pythonZipRead(file, `${cfg.folder}/manifest.json`).toString()) as ManifestV1;
    expect(manifest.protection).toEqual({ mode: 'legacy' });
    expect(manifest.artifacts[0].verdict.encryption).toBe('not-applicable');
    const descriptor = JSON.parse(pythonZipRead(file, 'wafb-archive.json').toString());
    expect(descriptor.note).toMatch(/NOT encrypted/);
  });
});
