/**
 * Manifest (private) and archive descriptor (public) — schema v1 (RF5, RF6).
 *
 * Protected archive layout:
 *
 *   wafb-archive.json   public descriptor: format + name of the encrypted manifest
 *   a000001.age         one age message per artefact, opaque names
 *   a000002.age
 *   …
 *   manifest.age        private manifest (age-encrypted JSON)
 *
 * The descriptor is not authenticated and can be altered without touching the
 * manifest: after decryption, the analyst checks that the `format` block of the
 * descriptor equals the one inside the manifest, and associates the archive to
 * the case by comparing manifest fields (case reference, key ID) with records
 * kept separately. Neither check proves who produced the archive: anyone who
 * knows the public recipient can create a coherent archive. Binding the
 * received archive to the observed session requires the external delivery
 * reference (archive digest) sent over an authenticated channel.
 *
 * Sizes that are unknown are `null`, never 0. Timestamps come from the client
 * clock and are not qualified time-stamps.
 */

import type { AcquisitionType, AcquisitionStatus } from '../forensics/acquisition';
import type { DeviceProperties } from '../adb';
import type { SourceEndCause } from '../utils/source-monitor';
import type { RecipientConfirmation } from './recipient';

export const MANIFEST_SCHEMA = 'wafb-manifest' as const;
export const MANIFEST_SCHEMA_VERSION = 1 as const;
export const ARCHIVE_FORMAT = 'wafb-protected-archive' as const;
export const LEGACY_ARCHIVE_FORMAT = 'wafb-legacy-archive' as const;
export const ARCHIVE_FORMAT_VERSION = 1 as const;
export const DESCRIPTOR_ENTRY = 'wafb-archive.json' as const;
export const PROTECTED_MANIFEST_ENTRY = 'manifest.age' as const;
export const LEGACY_MANIFEST_ENTRY = 'manifest.json' as const;
export const RULES_VERSION = 'wafb-protected-rules-v1' as const;

export type ProtectionMode = 'protected' | 'legacy';

export interface FormatBlock {
  format: typeof ARCHIVE_FORMAT | typeof LEGACY_ARCHIVE_FORMAT;
  formatVersion: typeof ARCHIVE_FORMAT_VERSION;
  manifestEntry: string;
  manifestEncryption: 'age-v1' | 'none';
  artifactEncryption: 'age-v1-per-artifact' | 'none';
  container: 'zip-store-zip64';
}

/** The only cleartext metadata of a protected archive. */
export interface ArchiveDescriptor extends FormatBlock {
  note: string;
}

export type SessionOutcome = 'completed' | 'partial';

export type ArtifactStatus =
  /** V_i = S ∧ H ∧ E ∧ W holds. */
  | 'verified'
  /** Written and (if protected) encrypted, but the source did not end acceptably. */
  | 'incomplete';

export interface ArtifactVerdict {
  /** S_i: acceptable conclusion of the source. */
  source: boolean;
  /** H_i: full-artefact digest available. */
  digest: boolean;
  /** E_i: encryption finalised (true in legacy mode, where it does not apply). */
  encryption: boolean | 'not-applicable';
  /** W_i: ZIP entry completed. */
  write: boolean;
}

export interface ArtifactRecord {
  /** Opaque identifier, also the entry stem in protected mode (e.g. a000001). */
  id: string;
  module: AcquisitionType;
  /** Name the acquirer gave to the artefact (e.g. backup.ab). */
  logicalName: string;
  /** ZIP entry holding the artefact. */
  entry: string;
  description?: string;
  mimeType?: string;
  status: ArtifactStatus;
  verdict: ArtifactVerdict;
  /** Bytes received from the source (plaintext). */
  bytesAcquired: number;
  /** Bytes stored in the ZIP entry (ciphertext in protected mode). */
  bytesStored: number;
  /** Size announced by the acquirer before streaming; null when unknown. */
  sizeAnnounced: number | null;
  /** Digest of the complete artefact; null if the artefact is incomplete. */
  digest: {
    algorithm: 'sha-256';
    value: string;
    scope: 'bytes-received-by-browser';
    computedBy: 'acquirer-passthrough' | 'coordinator';
  } | null;
  /** Digest of the bytes received before a source failure, explicitly partial. */
  partialDigest?: { algorithm: 'sha-256'; value: string; coversBytes: number };
  source: {
    cause: SourceEndCause | 'not-exposed';
    exitCode: number | null;
    limitation?: 'exit-code-not-observed' | 'source-outcome-not-exposed';
  };
  startedAt: string;
  endedAt: string;
  error?: ErrorRecord;
}

export interface ErrorRecord {
  code: string;
  phase: 'preflight' | 'module' | 'source' | 'hash' | 'encrypt' | 'write' | 'finalize' | 'cancel';
  message: string;
  bytesBeforeError?: number;
}

export type ModuleStatus = AcquisitionStatus | 'unsupported' | 'cancelled';

export interface ModuleRecord {
  module: AcquisitionType;
  status: ModuleStatus;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  artifactIds: string[];
  error?: ErrorRecord;
  /** Acquirer metadata (`AcquisitionResult.data`), size-capped. */
  data?: unknown;
  dataTruncated?: boolean;
}

export interface ManifestV1 {
  schema: typeof MANIFEST_SCHEMA;
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  format: FormatBlock;
  session: {
    id: string;
    caseRef: string | null;
    startedAt: string;
    endedAt: string;
    outcome: SessionOutcome;
    clock: 'client';
  };
  tool: {
    name: 'wafb';
    version: string;
    build?: string;
    rulesVersion: typeof RULES_VERSION;
    userAgent?: string;
  };
  device: DeviceProperties | null;
  protection:
    | {
        mode: 'protected';
        artifactFormat: 'age-v1';
        recipientType: 'age-x25519';
        recipient: string;
        keyId: string;
        keyIdScheme: 'wafb-recipient-v1';
        /** Declared by the operator; not a cryptographic authentication. */
        verification: RecipientConfirmation & { declaredBy: 'operator' };
      }
    | { mode: 'legacy' };
  modules: {
    requested: AcquisitionType[];
    profileSource: 'invite' | 'operator';
    /** Present when the operator changed the invite profile. */
    profileChange?: { added: AcquisitionType[]; removed: AcquisitionType[] };
    notSelected: AcquisitionType[];
    completed: AcquisitionType[];
    failed: AcquisitionType[];
    unsupported: AcquisitionType[];
    skipped: AcquisitionType[];
    details: ModuleRecord[];
  };
  artifacts: ArtifactRecord[];
  summary: {
    artifacts: number;
    verified: number;
    incomplete: number;
    bytesAcquired: number;
    bytesStored: number;
  };
  /** Reminder of what this manifest does and does not prove. */
  scopeNote: string;
}

export const MANIFEST_SCOPE_NOTE =
  'Digests identify the bytes received by the browser during collection; they are not a ' +
  'snapshot of the device and do not prove the origin of the data. Encryption to a public ' +
  'recipient does not authenticate the sender. Absence of an artefact is not absence of ' +
  'evidence on the device.';

export function formatBlock(mode: ProtectionMode, legacyManifestEntry: string = LEGACY_MANIFEST_ENTRY): FormatBlock {
  return mode === 'protected'
    ? {
        format: ARCHIVE_FORMAT,
        formatVersion: ARCHIVE_FORMAT_VERSION,
        manifestEntry: PROTECTED_MANIFEST_ENTRY,
        manifestEncryption: 'age-v1',
        artifactEncryption: 'age-v1-per-artifact',
        container: 'zip-store-zip64',
      }
    : {
        format: LEGACY_ARCHIVE_FORMAT,
        formatVersion: ARCHIVE_FORMAT_VERSION,
        manifestEntry: legacyManifestEntry,
        manifestEncryption: 'none',
        artifactEncryption: 'none',
        container: 'zip-store-zip64',
      };
}

export function buildDescriptor(mode: ProtectionMode, legacyManifestEntry?: string): ArchiveDescriptor {
  return {
    ...formatBlock(mode, legacyManifestEntry),
    note:
      mode === 'protected'
        ? 'Artefacts and manifest are age-encrypted for the analyst. This descriptor is not ' +
          'authenticated; verify it against the format block inside the decrypted manifest.'
        : 'LEGACY MODE: artefacts and manifest are NOT encrypted.',
  };
}

/** Equality of the format blocks of descriptor and manifest (analyst check). */
export function formatBlocksEqual(a: FormatBlock, b: FormatBlock): boolean {
  const keys: (keyof FormatBlock)[] = [
    'format',
    'formatVersion',
    'manifestEntry',
    'manifestEncryption',
    'artifactEncryption',
    'container',
  ];
  return keys.every(k => a[k] === b[k]);
}

/** Opaque, order-preserving artefact identifier: a000001, a000002, … */
export function artifactId(n: number): string {
  return `a${String(n).padStart(6, '0')}`;
}

/** Caps acquirer metadata so the manifest stays bounded. */
export function capData(data: unknown, maxBytes = 256 * 1024): { data?: unknown; truncated?: boolean } {
  if (data === undefined) return {};
  try {
    const s = JSON.stringify(data);
    if (s === undefined) return {};
    if (s.length <= maxBytes) return { data: JSON.parse(s) };
    return { truncated: true };
  } catch {
    return { truncated: true };
  }
}
