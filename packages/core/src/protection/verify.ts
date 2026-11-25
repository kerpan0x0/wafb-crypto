/**
 * Analyst-side verification of a protected archive (RF8).
 *
 * Order (chapter 2): read the public descriptor → decrypt the private manifest
 * → check recipient, format consistency and case reference → decrypt every
 * artefact, recompute SHA-256 and compare → optionally compare the archive
 * digest with the delivery reference received over an authenticated channel.
 *
 * Decrypted plaintext stays in "logical quarantine": verification only hashes
 * it. Writing an artefact out is a separate step (`extractVerifiedArtifact`),
 * allowed only for artefacts whose digest matched, and it re-checks the digest
 * while writing.
 *
 * What a successful verification does NOT prove is stated in the report:
 * without the external delivery reference, a coherent replacement package
 * produced by anyone who knows the public recipient would also pass.
 */

import { identityToRecipient } from 'age-encryption';
import { AgeStreamDecryptor } from './age-stream';
import { computeKeyId } from './recipient';
import {
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  DESCRIPTOR_ENTRY,
  MANIFEST_SCHEMA,
  MANIFEST_SCHEMA_VERSION,
  formatBlocksEqual,
  type ArchiveDescriptor,
  type ManifestV1,
} from './manifest';
import { entryBytes, entryStream, readZipDirectory, ZipFormatError, type ZipReaderEntry } from '../utils/zip-reader';
import { errorMessage } from '../utils/errors';

export type CheckId =
  | 'container'
  | 'descriptor'
  | 'manifest-decrypt'
  | 'manifest-schema'
  | 'format-consistency'
  | 'recipient'
  | 'case-ref'
  | 'entries'
  | 'artifacts'
  | 'declared-outcome'
  | 'delivery-ref';

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'not-checked';

export interface CheckResult {
  id: CheckId;
  status: CheckStatus;
  detail: string;
}

export interface ArtifactVerification {
  id: string;
  module: string;
  logicalName: string;
  entry: string;
  declaredStatus: 'verified' | 'incomplete';
  decrypt: 'ok' | 'header-failed' | 'auth-failed' | 'missing-entry';
  /** Digest the manifest declares (full digest, or partial for incomplete artefacts). */
  declaredDigest: string | null;
  computedDigest: string | null;
  digestMatch: boolean | null;
  bytes: number;
  sizeMatch: boolean | null;
  /** True only for complete, matching artefacts — the ones that may be exported. */
  usable: boolean;
}

export type Verdict = 'verified-complete' | 'verified-partial' | 'rejected';

export interface VerificationReport {
  verdict: Verdict;
  checks: CheckResult[];
  manifest: ManifestV1 | null;
  artifacts: ArtifactVerification[];
  extraEntries: string[];
  archiveSha256: string | null;
  limits: string[];
}

export interface VerifyOptions {
  /** age X25519 identity of the analyst. Kept in memory only. */
  identity: string;
  /** Case reference from the analyst's own records. */
  expectedCaseRef?: string;
  /** Archive SHA-256 received from the acquirer over an authenticated channel. */
  expectedDeliveryRef?: string;
  /** Compute the archive SHA-256 even without an expected value (shown to the analyst). */
  computeArchiveDigest?: boolean;
  maxManifestBytes?: number;
  onProgress?: (p: { phase: 'archive-digest' | 'artifact'; artifactId?: string; bytes: number }) => void;
  signal?: AbortSignal;
}

const OPAQUE_ENTRY = /^a\d{6}\.age$/;

export async function verifyArchive(archive: Blob, opts: VerifyOptions): Promise<VerificationReport> {
  const checks: CheckResult[] = [];
  const add = (id: CheckId, status: CheckStatus, detail: string) => checks.push({ id, status, detail });
  const report = (manifest: ManifestV1 | null, artifacts: ArtifactVerification[] = [], extra: string[] = [], digest: string | null = null): VerificationReport => {
    const anyFail = checks.some(c => c.status === 'fail');
    const complete =
      !anyFail &&
      manifest?.session.outcome === 'completed' &&
      artifacts.every(a => a.declaredStatus === 'verified' && a.usable);
    return {
      verdict: anyFail ? 'rejected' : complete ? 'verified-complete' : 'verified-partial',
      checks,
      manifest,
      artifacts,
      extraEntries: extra,
      archiveSha256: digest,
      limits: [
        'Encryption to a public recipient does not authenticate the sender.',
        opts.expectedDeliveryRef
          ? 'The archive was bound to the acquisition session through the external delivery reference.'
          : 'No external delivery reference was checked: a coherent replacement package would also pass.',
        'Digests identify bytes received by the browser; they do not prove the data originates from the device.',
      ],
    };
  };

  // ── container ──
  let entries: ZipReaderEntry[];
  try {
    entries = await readZipDirectory(archive);
    add('container', 'pass', `${entries.length} entries`);
  } catch (err) {
    add('container', 'fail', err instanceof ZipFormatError ? `${err.code}: ${err.message}` : errorMessage(err));
    return report(null);
  }
  const byName = new Map(entries.map(e => [e.name, e]));

  // ── descriptor ──
  let descriptor: ArchiveDescriptor;
  try {
    const d = byName.get(DESCRIPTOR_ENTRY);
    if (!d) throw new Error('descriptor entry missing');
    descriptor = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await entryBytes(archive, d, 64 * 1024)));
    if (descriptor.format !== ARCHIVE_FORMAT || descriptor.formatVersion !== ARCHIVE_FORMAT_VERSION) {
      throw new Error(`unsupported format ${String(descriptor.format)} v${String(descriptor.formatVersion)}`);
    }
    if (typeof descriptor.manifestEntry !== 'string' || !byName.has(descriptor.manifestEntry)) {
      throw new Error('manifest entry referenced by the descriptor is missing');
    }
    add('descriptor', 'pass', `${descriptor.format} v${descriptor.formatVersion}`);
  } catch (err) {
    add('descriptor', 'fail', errorMessage(err));
    return report(null);
  }

  // ── manifest ──
  const decryptor = new AgeStreamDecryptor(opts.identity);
  let manifest: ManifestV1;
  try {
    const ct = await entryBytes(archive, byName.get(descriptor.manifestEntry)!, opts.maxManifestBytes ?? 64 * 1024 * 1024);
    const pt = await decryptor.decryptBytes(ct);
    manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(pt));
    add('manifest-decrypt', 'pass', 'manifest decrypted and authenticated');
  } catch (err) {
    add('manifest-decrypt', 'fail', `cannot decrypt manifest with this identity (${errorMessage(err)})`);
    return report(null);
  }

  if (
    manifest?.schema !== MANIFEST_SCHEMA ||
    manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length > 100_000
  ) {
    add('manifest-schema', 'fail', 'unknown manifest schema or version');
    return report(null);
  }
  add('manifest-schema', 'pass', `${manifest.schema} v${manifest.schemaVersion}`);

  add(
    'format-consistency',
    formatBlocksEqual(descriptor, manifest.format) ? 'pass' : 'fail',
    formatBlocksEqual(descriptor, manifest.format)
      ? 'descriptor format block equals the manifest one'
      : 'descriptor and manifest disagree on the format: descriptor may have been altered'
  );

  // ── recipient ──
  try {
    const ownKeyId = await computeKeyId(await identityToRecipient(opts.identity.trim()));
    const p = manifest.protection;
    if (p.mode !== 'protected') add('recipient', 'fail', 'manifest declares an unprotected archive');
    else if (p.keyId !== ownKeyId) add('recipient', 'fail', 'manifest key ID differs from the key ID of this identity');
    else add('recipient', 'pass', `key ID ${ownKeyId.slice(0, 16)}… matches`);
  } catch (err) {
    add('recipient', 'fail', errorMessage(err));
  }

  // ── case reference ──
  if (opts.expectedCaseRef) {
    const ok = manifest.session.caseRef === opts.expectedCaseRef.trim();
    add('case-ref', ok ? 'pass' : 'fail', ok ? 'case reference matches your record' : 'case reference differs from your record');
  } else {
    add('case-ref', 'not-checked', 'no expected case reference provided');
  }

  // ── entries ↔ records ──
  const recorded = new Set<string>();
  let entryProblem: string | null = null;
  for (const a of manifest.artifacts) {
    if (typeof a.entry !== 'string' || !OPAQUE_ENTRY.test(a.entry)) entryProblem ??= `artefact ${String(a.id)} has a non-opaque entry name`;
    else if (recorded.has(a.entry)) entryProblem ??= `entry ${a.entry} referenced twice`;
    else if (!byName.has(a.entry)) entryProblem ??= `entry ${a.entry} missing from the archive`;
    recorded.add(a.entry);
  }
  const expected = new Set([...recorded, DESCRIPTOR_ENTRY, descriptor.manifestEntry]);
  const extra = entries.map(e => e.name).filter(n => !expected.has(n));
  if (extra.length) entryProblem ??= `${extra.length} entries not described by the manifest`;
  add('entries', entryProblem ? 'fail' : 'pass', entryProblem ?? 'one-to-one mapping between manifest and entries');

  // ── artefacts ──
  const { createSHA256 } = await import('hash-wasm');
  const results: ArtifactVerification[] = [];
  for (const a of manifest.artifacts) {
    if (opts.signal?.aborted) throw opts.signal.reason ?? new Error('aborted');
    const declaredDigest = a.digest?.value ?? a.partialDigest?.value ?? null;
    const base = {
      id: a.id, module: a.module, logicalName: a.logicalName, entry: a.entry,
      declaredStatus: a.status, declaredDigest,
    };
    const e = byName.get(a.entry);
    if (!e) {
      results.push({ ...base, decrypt: 'missing-entry', computedDigest: null, digestMatch: null, bytes: 0, sizeMatch: null, usable: false });
      continue;
    }
    const h = await createSHA256();
    let bytes = 0;
    let decrypt: ArtifactVerification['decrypt'] = 'ok';
    let pt: ReadableStream<Uint8Array>;
    try {
      pt = await decryptor.decryptStream(entryStream(archive, e));
    } catch {
      results.push({ ...base, decrypt: 'header-failed', computedDigest: null, digestMatch: null, bytes: 0, sizeMatch: null, usable: false });
      continue;
    }
    try {
      const r = pt.getReader();
      for (;;) {
        const { done, value } = await r.read();
        if (done) break;
        h.update(value);
        bytes += value.byteLength;
        opts.onProgress?.({ phase: 'artifact', artifactId: a.id, bytes });
      }
    } catch {
      decrypt = 'auth-failed';
    }
    const computed = decrypt === 'ok' ? h.digest('hex') : null;
    const digestMatch = computed !== null && declaredDigest !== null ? computed === declaredDigest : null;
    const sizeMatch = decrypt === 'ok' ? bytes === a.bytesAcquired : null;
    results.push({
      ...base,
      decrypt,
      computedDigest: computed,
      digestMatch,
      bytes,
      sizeMatch,
      usable: decrypt === 'ok' && digestMatch === true && sizeMatch === true && a.status === 'verified' && !!a.digest,
    });
  }
  const bad = results.filter(r => r.decrypt !== 'ok' || r.digestMatch === false || r.sizeMatch === false || (r.declaredDigest !== null && r.digestMatch !== true));
  add(
    'artifacts',
    bad.length ? 'fail' : 'pass',
    bad.length
      ? `${bad.length} artefact(s) failed decryption, digest or size check`
      : `${results.length} artefact(s) decrypted; digests and sizes match the manifest`
  );

  const incomplete = manifest.artifacts.filter(a => a.status !== 'verified').length;
  add(
    'declared-outcome',
    manifest.session.outcome === 'completed' && incomplete === 0 ? 'pass' : 'warn',
    manifest.session.outcome === 'completed'
      ? 'all requested modules completed'
      : `partial collection: failed ${manifest.modules.failed.join(', ') || '—'}; unsupported ${manifest.modules.unsupported.join(', ') || '—'}; incomplete artefacts ${incomplete}`
  );

  // ── delivery reference ──
  let archiveSha256: string | null = null;
  if (opts.expectedDeliveryRef || opts.computeArchiveDigest) {
    const ah = await createSHA256();
    const r = (archive.stream() as ReadableStream<Uint8Array>).getReader();
    let n = 0;
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      ah.update(value);
      n += value.byteLength;
      opts.onProgress?.({ phase: 'archive-digest', bytes: n });
    }
    archiveSha256 = ah.digest('hex');
  }
  if (opts.expectedDeliveryRef) {
    const exp = opts.expectedDeliveryRef.toLowerCase().replace(/[\s:-]/g, '');
    add('delivery-ref', exp === archiveSha256 ? 'pass' : 'fail', exp === archiveSha256 ? 'archive matches the delivery reference' : 'archive does NOT match the delivery reference');
  } else {
    add('delivery-ref', 'warn', 'no delivery reference provided: origin of the package not bound to the session');
  }

  return report(manifest, results, extra, archiveSha256);
}

/** Basename of a logical name, restricted to safe characters, for saving. */
export function safeFileName(logicalName: string, fallback: string): string {
  const base = logicalName.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.length > 0 && cleaned.length <= 200 ? cleaned : fallback;
}

/**
 * Decrypts one artefact into `sink` while re-hashing it. The sink is closed
 * only if the digest equals `expectedDigest`; otherwise it is aborted and an
 * error is thrown, so a mismatching plaintext is never committed.
 */
export async function extractVerifiedArtifact(
  archive: Blob,
  entryName: string,
  identity: string,
  expectedDigest: string,
  sink: WritableStream<Uint8Array>
): Promise<{ bytes: number }> {
  const entries = await readZipDirectory(archive);
  const e = entries.find(x => x.name === entryName);
  if (!e) throw new Error(`entry ${entryName} not found`);
  const { createSHA256 } = await import('hash-wasm');
  const h = await createSHA256();
  const pt = await new AgeStreamDecryptor(identity).decryptStream(entryStream(archive, e));
  const w = sink.getWriter();
  let bytes = 0;
  try {
    const r = pt.getReader();
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      h.update(value);
      bytes += value.byteLength;
      await w.write(value);
    }
    if (h.digest('hex') !== expectedDigest) throw new Error('digest mismatch while extracting; output discarded');
    await w.close();
    return { bytes };
  } catch (err) {
    await w.abort(err).catch(() => {});
    throw err;
  }
}
