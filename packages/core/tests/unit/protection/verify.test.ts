/**
 * Analyst-side verification and the security demonstrations of chapter 2:
 * reading without identity, byte modification, truncation, entry removal,
 * descriptor tampering, recipient substitution, unsafe names and coherent
 * replacement of the whole package (the boundary of the guarantee).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openAsBlob } from 'node:fs';
import { readFileSync, writeFileSync, truncateSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { generateX25519Identity, identityToRecipient } from 'age-encryption';
import { validateRecipient, type ValidatedRecipient } from '../../../src/protection/recipient';
import { SessionCoordinator, type ModuleTask, type ProtectedSessionConfig } from '../../../src/protection/session';
import { verifyArchive, extractVerifiedArtifact, safeFileName } from '../../../src/protection/verify';
import { readZipDirectory, entryBytes } from '../../../src/utils/zip-reader';
import { StreamingZipWriter } from '../../../src/utils/streaming-zip';
import { monitorSource } from '../../../src/utils/source-monitor';
import { bytesToStream } from '../../../src/utils/stream-helpers';
import type { AcquisitionResult, AcquisitionType } from '../../../src/forensics/acquisition';
import { fileSink, hasTool, makeTempDir } from '../../helpers/independent-tools';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function pattern(n: number, seed = 1): Uint8Array {
  const b = new Uint8Array(n); let x = seed;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; }
  return b;
}
function res(type: AcquisitionType, files: AcquisitionResult['files']): AcquisitionResult {
  const d = new Date();
  return { success: true, type, files, startTime: d, endTime: d, duration: 0 };
}

let tmp: { dir: string; cleanup: () => Promise<void> };
let analystId: string;
let analystRecipient: ValidatedRecipient;
let attackerId: string;
let attackerRecipient: ValidatedRecipient;

async function produce(
  file: string,
  recipient: ValidatedRecipient,
  opts: { backup?: Uint8Array; stallAfter?: number; caseRef?: string; settings?: unknown } = {}
) {
  const backup = opts.backup ?? pattern(400_000, 5);
  const cfg: ProtectedSessionConfig = {
    mode: 'protected',
    requested: ['backup', 'settings'],
    profileSource: 'invite',
    tool: { version: 'test' },
    device: null,
    recipient,
    recipientConfirmation: { method: 'full-key-id-entered', confirmedAt: '2026-11-23T12:00:00Z' },
    caseRef: opts.caseRef ?? 'C-CASE00001',
  };
  const tasks: ModuleTask[] = [
    {
      module: 'backup',
      run: async () => {
        let off = 0;
        const stallAfter = opts.stallAfter ?? Infinity;
        let done!: (n: number) => void;
        const exited = new Promise<number>(r => (done = r));
        const raw = new ReadableStream<Uint8Array>({
          pull(c) {
            if (off >= stallAfter) return new Promise(() => {});
            if (off >= backup.length) { c.close(); done(0); return; }
            const n = Math.min(65_000, backup.length - off, stallAfter - off);
            c.enqueue(backup.slice(off, off + n)); off += n;
          },
        });
        const m = monitorSource(raw, { idleTimeoutMs: 50, exited, exitGraceMs: 10 });
        return res('backup', [{ fileName: 'backup.ab', fileSize: 0, sizeUnknown: true, stream: m.stream, outcome: m.outcome }]);
      },
    },
    {
      module: 'settings',
      run: async () => {
        const b = new TextEncoder().encode(JSON.stringify(opts.settings ?? { secure: { adb_enabled: 1 } }));
        return res('settings', [{ fileName: 'settings.json', fileSize: b.length, stream: bytesToStream(b) }]);
      },
    },
  ];
  return new SessionCoordinator(cfg, { sink: await fileSink(file) }).run(tasks);
}

/** Rewrites an archive entry by entry, letting the caller change or drop entries. */
async function rewrite(src: string, dst: string, edit: (name: string, data: Uint8Array) => Uint8Array | null) {
  const blob = await openAsBlob(src);
  const entries = await readZipDirectory(blob);
  const zip = new StreamingZipWriter(await fileSink(dst));
  for (const e of entries) {
    const out = edit(e.name, await entryBytes(blob, e, 1 << 30));
    if (out) await zip.addFile(e.name, out);
  }
  await zip.finalize();
}

beforeAll(async () => {
  tmp = await makeTempDir('wafb-verify-');
  analystId = await generateX25519Identity();
  analystRecipient = await validateRecipient(await identityToRecipient(analystId));
  attackerId = await generateX25519Identity();
  attackerRecipient = await validateRecipient(await identityToRecipient(attackerId));
});
afterAll(async () => { await tmp.cleanup(); });

const statusOf = (r: Awaited<ReturnType<typeof verifyArchive>>, id: string) => r.checks.find(c => c.id === id)?.status;

describe('verifyArchive — legitimate archives', () => {
  it('complete archive + delivery reference → verified-complete', async () => {
    const f = path.join(tmp.dir, 'good.zip');
    const backup = pattern(700_001, 9);
    const r0 = await produce(f, analystRecipient, { backup });
    const rep = await verifyArchive(await openAsBlob(f), {
      identity: analystId,
      expectedCaseRef: 'C-CASE00001',
      expectedDeliveryRef: r0.archive!.sha256!,
    });
    expect(rep.verdict).toBe('verified-complete');
    expect(rep.checks.every(c => c.status === 'pass')).toBe(true);
    expect(rep.archiveSha256).toBe(sha(readFileSync(f)));
    const b = rep.artifacts.find(a => a.module === 'backup')!;
    expect(b).toMatchObject({ decrypt: 'ok', digestMatch: true, sizeMatch: true, usable: true, computedDigest: sha(backup) });
  });

  it('without a delivery reference the report says the origin is NOT bound', async () => {
    const f = path.join(tmp.dir, 'good2.zip');
    await produce(f, analystRecipient);
    const rep = await verifyArchive(await openAsBlob(f), { identity: analystId });
    expect(rep.verdict).toBe('verified-complete');
    expect(statusOf(rep, 'delivery-ref')).toBe('warn');
    expect(rep.limits.join(' ')).toMatch(/coherent replacement package would also pass/);
  });

  it('partial archive (stalled backup) → verified-partial; the incomplete artefact is not usable', async () => {
    const f = path.join(tmp.dir, 'partial.zip');
    await produce(f, analystRecipient, { stallAfter: 130_000 });
    const rep = await verifyArchive(await openAsBlob(f), { identity: analystId });
    expect(rep.verdict).toBe('verified-partial');
    expect(statusOf(rep, 'declared-outcome')).toBe('warn');
    const b = rep.artifacts.find(a => a.module === 'backup')!;
    expect(b.declaredStatus).toBe('incomplete');
    expect(b.digestMatch).toBe(true); // matches the declared PARTIAL digest
    expect(b.usable).toBe(false);
  });
});

describe('verifyArchive — security demonstrations', () => {
  let good: string;
  let goodRef: string;
  beforeAll(async () => {
    good = path.join(tmp.dir, 'base.zip');
    goodRef = (await produce(good, analystRecipient)).archive!.sha256!;
  });

  it.skipIf(!hasTool('python3'))('reading without the identity: artefacts are not plaintext in the archive', async () => {
    const raw = readFileSync(good);
    expect(raw.includes(Buffer.from('adb_enabled'))).toBe(false);
    expect(raw.includes(Buffer.from('C-CASE00001'))).toBe(false);
    const rep = await verifyArchive(await openAsBlob(good), { identity: attackerId });
    expect(rep.verdict).toBe('rejected');
    expect(statusOf(rep, 'manifest-decrypt')).toBe('fail');
  });

  it('a single flipped byte inside an artefact is detected', async () => {
    const f = path.join(tmp.dir, 'flip.zip');
    await rewrite(good, f, (n, d) => {
      if (n !== 'a000001.age') return d;
      const x = Uint8Array.from(d); x[x.length - 500] ^= 0x01; return x;
    });
    const rep = await verifyArchive(await openAsBlob(f), { identity: analystId });
    expect(rep.verdict).toBe('rejected');
    expect(rep.artifacts.find(a => a.entry === 'a000001.age')!.decrypt).toBe('auth-failed');
  });

  it('a truncated archive is rejected at the container level', async () => {
    const f = path.join(tmp.dir, 'trunc.zip');
    writeFileSync(f, readFileSync(good));
    truncateSync(f, Math.floor(readFileSync(good).length * 0.7));
    const rep = await verifyArchive(await openAsBlob(f), { identity: analystId });
    expect(rep.verdict).toBe('rejected');
    expect(statusOf(rep, 'container')).toBe('fail');
  });

  it('removing an entry is detected', async () => {
    const f = path.join(tmp.dir, 'removed.zip');
    await rewrite(good, f, (n, d) => (n === 'a000002.age' ? null : d));
    const rep = await verifyArchive(await openAsBlob(f), { identity: analystId });
    expect(rep.verdict).toBe('rejected');
    expect(statusOf(rep, 'entries')).toBe('fail');
  });

  it('an added unexpected entry is detected', async () => {
    const f = path.join(tmp.dir, 'added.zip');
    const blob = await openAsBlob(good);
    const zip = new StreamingZipWriter(await fileSink(f));
    for (const e of await readZipDirectory(blob)) await zip.addFile(e.name, await entryBytes(blob, e, 1 << 30));
    await zip.addFile('a000099.age', new Uint8Array(10));
    await zip.finalize();
    const rep = await verifyArchive(await openAsBlob(f), { identity: analystId });
    expect(rep.verdict).toBe('rejected');
    expect(rep.extraEntries).toEqual(['a000099.age']);
  });

  it('a tampered public descriptor is detected after decrypting the manifest', async () => {
    const f = path.join(tmp.dir, 'desc.zip');
    await rewrite(good, f, (n, d) => {
      if (n !== 'wafb-archive.json') return d;
      const j = JSON.parse(new TextDecoder().decode(d));
      j.artifactEncryption = 'none';
      return new TextEncoder().encode(JSON.stringify(j));
    });
    const rep = await verifyArchive(await openAsBlob(f), { identity: analystId });
    expect(rep.verdict).toBe('rejected');
    expect(statusOf(rep, 'format-consistency')).toBe('fail');
  });

  it('recipient substitution: an archive made for the attacker cannot be read by the analyst', async () => {
    const f = path.join(tmp.dir, 'attacker.zip');
    await produce(f, attackerRecipient);
    const rep = await verifyArchive(await openAsBlob(f), { identity: analystId });
    expect(rep.verdict).toBe('rejected');
    expect(statusOf(rep, 'manifest-decrypt')).toBe('fail');
  });

  it('BOUNDARY: a coherent replacement package passes unless the delivery reference is checked', async () => {
    // Anyone knowing the public recipient can build a fully coherent archive.
    const fake = path.join(tmp.dir, 'replacement.zip');
    await produce(fake, analystRecipient, { settings: { secure: { adb_enabled: 0 } }, backup: pattern(1000, 77) });

    const without = await verifyArchive(await openAsBlob(fake), { identity: analystId, expectedCaseRef: 'C-CASE00001' });
    expect(without.verdict).toBe('verified-complete'); // ← cryptographically valid, coherent
    expect(statusOf(without, 'delivery-ref')).toBe('warn');

    const withRef = await verifyArchive(await openAsBlob(fake), { identity: analystId, expectedDeliveryRef: goodRef });
    expect(withRef.verdict).toBe('rejected');
    expect(statusOf(withRef, 'delivery-ref')).toBe('fail');
  });

  it('a different case reference is flagged against the analyst record', async () => {
    const rep = await verifyArchive(await openAsBlob(good), { identity: analystId, expectedCaseRef: 'C-OTHERCASE' });
    expect(statusOf(rep, 'case-ref')).toBe('fail');
  });

  it.skipIf(!hasTool('python3'))('unsafe entry names (path traversal) are refused by the reader', async () => {
    const f = path.join(tmp.dir, 'evil.zip');
    execFileSync('python3', ['-I', '-c',
      'import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1],"w")\nz.writestr("../../evil.txt","x")\nz.writestr("wafb-archive.json","{}")\nz.close()', f]);
    const rep = await verifyArchive(await openAsBlob(f), { identity: analystId });
    expect(rep.verdict).toBe('rejected');
    expect(rep.checks[0]).toMatchObject({ id: 'container', status: 'fail' });
    expect(rep.checks[0].detail).toMatch(/unsafe-name/);
  });
});

describe('extractVerifiedArtifact', () => {
  it('writes the plaintext only when the digest matches', async () => {
    const f = path.join(tmp.dir, 'extract.zip');
    const backup = pattern(300_000, 3);
    await produce(f, analystRecipient, { backup });
    const blob = await openAsBlob(f);
    const rep = await verifyArchive(blob, { identity: analystId });
    const b = rep.artifacts.find(a => a.module === 'backup')!;

    const out = path.join(tmp.dir, safeFileName(b.logicalName, b.id));
    await extractVerifiedArtifact(blob, b.entry, analystId, b.computedDigest!, await fileSink(out));
    expect(sha(readFileSync(out))).toBe(sha(backup));

    let closed = false;
    const sink = new WritableStream<Uint8Array>({ close() { closed = true; } });
    await expect(extractVerifiedArtifact(blob, b.entry, analystId, '00'.repeat(32), sink)).rejects.toThrow(/mismatch/);
    expect(closed).toBe(false);
  });

  it('safeFileName keeps only a safe basename', () => {
    expect(safeFileName('../../etc/passwd', 'x')).toBe('passwd');
    expect(safeFileName('dir\\a b.json', 'x')).toBe('a_b.json');
    expect(safeFileName('...', 'fallback')).toBe('fallback');
  });
});
