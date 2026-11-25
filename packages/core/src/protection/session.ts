/**
 * SessionCoordinator — the single coordinator shared by the wizard and the
 * advanced page (RF7, RF10).
 *
 * Responsibilities kept here, out of the React pages:
 *   - immutable session configuration (recipient, case, profile, rules);
 *   - the session state machine;
 *   - the per-artefact pipeline
 *         source → seal → abort → count → SHA-256 → age → ZIP → sink
 *     processed sequentially, one artefact at a time;
 *   - the completion decision V_i = S_i ∧ H_i ∧ E_i ∧ W_i;
 *   - error classes (preflight / module / fatal) and cancellation ownership;
 *   - finalisation order: artefacts → results → encrypted manifest →
 *     public descriptor → ZIP central directory → sink close confirmed.
 *
 * The coordinator never decides that the device is "clean" and never treats
 * the archive as a complete forensic image: it records what was requested,
 * what was obtained and what did not reach a verifiable result.
 */

import type { AcquisitionType, AcquisitionResult, AcquisitionFile, AcquisitionProgress } from '../forensics/acquisition';
import { ACQUISITION_TYPES } from '../forensics/acquisition';
import type { DeviceProperties } from '../adb';
import { StreamingZipWriter } from '../utils/streaming-zip';
import { byteCounter, hashingPassthrough } from '../utils/stream-helpers';
import { evaluateSourceOutcome, type SourceOutcome } from '../utils/source-monitor';
import { AcquisitionAbortedError, errorMessage, isAbortError } from '../utils/errors';
import { AgeStreamEncryptor } from './age-stream';
import type { RecipientConfirmation, ValidatedRecipient } from './recipient';
import { abortable, errorCode, sealOnSourceFailure } from './pipeline';
import {
  artifactId,
  buildDescriptor,
  capData,
  formatBlock,
  DESCRIPTOR_ENTRY,
  MANIFEST_SCHEMA,
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_SCOPE_NOTE,
  PROTECTED_MANIFEST_ENTRY,
  RULES_VERSION,
  type ArtifactRecord,
  type ErrorRecord,
  type ManifestV1,
  type ModuleRecord,
  type SessionOutcome,
} from './manifest';

// ============================================================================
// Configuration
// ============================================================================

interface BaseConfig {
  /** Modules the session must attempt. Fixed for the whole session. */
  requested: AcquisitionType[];
  profileSource: 'invite' | 'operator';
  profileChange?: { added: AcquisitionType[]; removed: AcquisitionType[] };
  tool: { version: string; build?: string; userAgent?: string };
  device: DeviceProperties | null;
}

export interface ProtectedSessionConfig extends BaseConfig {
  mode: 'protected';
  recipient: ValidatedRecipient;
  /** Required: protected mode cannot start with an unverified recipient. */
  recipientConfirmation: RecipientConfirmation;
  caseRef: string;
}

export interface LegacySessionConfig extends BaseConfig {
  mode: 'legacy';
  /** Folder prefix inside the ZIP, as in WAFB 0.3.1. */
  folder: string;
  caseRef?: string;
}

export type SessionConfig = ProtectedSessionConfig | LegacySessionConfig;

// ============================================================================
// State machine
// ============================================================================

export type SessionState =
  | 'preparing'
  | 'ready'
  | 'acquiring'
  | 'finalizing'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

export const TERMINAL_STATES: readonly SessionState[] = ['completed', 'partial', 'failed', 'cancelled'];

const TRANSITIONS: Record<SessionState, SessionState[]> = {
  preparing: ['ready', 'failed', 'cancelled'],
  ready: ['acquiring', 'failed', 'cancelled'],
  acquiring: ['finalizing', 'failed', 'cancelled'],
  finalizing: ['completed', 'partial', 'failed', 'cancelled'],
  completed: [],
  partial: [],
  failed: [],
  cancelled: [],
};

export class InvalidTransitionError extends Error {
  constructor(from: SessionState, to: SessionState) {
    super(`Invalid session transition ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

// ============================================================================
// Tasks, events, results
// ============================================================================

export interface ModuleContext {
  signal: AbortSignal;
  onProgress: (p: AcquisitionProgress) => void;
}

export interface ModuleTask {
  module: AcquisitionType;
  /** Undefined when this build has no acquirer for the module. */
  run?: (ctx: ModuleContext) => Promise<AcquisitionResult>;
}

export interface ModuleUpdate {
  module: AcquisitionType;
  status: ModuleRecord['status'];
  message?: string;
  /** Acquirer-reported progress (0–100); not meaningful for unknown-size streams. */
  progress?: number;
}

export interface ArtifactProgress {
  artifactId: string;
  module: AcquisitionType;
  logicalName: string;
  /** Plaintext bytes received from the source. */
  bytesAcquired: number;
  /** Bytes handed to the sink for the whole archive so far. */
  archiveBytesWritten: number;
}

export interface SessionLogEntry {
  at: string;
  level: 'info' | 'warn' | 'error';
  /** Fixed, data-free message. Never contains artefact bytes or key material. */
  message: string;
  code?: string;
}

export interface SessionEvents {
  onStateChange?: (state: SessionState, previous: SessionState) => void;
  onModuleUpdate?: (u: ModuleUpdate) => void;
  onArtifactProgress?: (p: ArtifactProgress) => void;
  onArtifactRecorded?: (r: ArtifactRecord) => void;
  onLog?: (e: SessionLogEntry) => void;
}

export interface SessionResult {
  state: Extract<SessionState, 'completed' | 'partial' | 'failed' | 'cancelled'>;
  /** The manifest as written (decrypted form). Null if not built. */
  manifest: ManifestV1 | null;
  /** True only if the ZIP directory was written AND the sink confirmed close. */
  saveConfirmed: boolean;
  archive: {
    bytes: number;
    entries: number;
    /** SHA-256 of the archive bytes handed to the sink — the external delivery reference. */
    sha256: string | null;
  } | null;
  error?: ErrorRecord;
}

export interface SessionDeps {
  sink: WritableStream<Uint8Array>;
  events?: SessionEvents;
  /** Compute SHA-256 of the whole archive (delivery reference). Default true. */
  computeArchiveDigest?: boolean;
  /** Max wait for a source outcome after the stream ended. Default 15 s. */
  outcomeTimeoutMs?: number;
  /** Throttle for onArtifactProgress, in bytes. Default 1 MiB. */
  progressEveryBytes?: number;
  now?: () => Date;
}

class FatalSessionError extends Error {
  constructor(readonly record: ErrorRecord, readonly original?: unknown) {
    super(record.message);
    this.name = 'FatalSessionError';
  }
}

// ============================================================================
// Coordinator
// ============================================================================

export class SessionCoordinator {
  readonly config: Readonly<SessionConfig>;
  readonly id: string;

  private _state: SessionState = 'preparing';
  private readonly controller = new AbortController();
  private readonly events: SessionEvents;
  private readonly deps: Required<Omit<SessionDeps, 'events' | 'sink'>> & Pick<SessionDeps, 'sink'>;
  private encryptor: AgeStreamEncryptor | null = null;
  private zip: StreamingZipWriter | null = null;
  private archiveCounter = 0;
  private archiveHash: Promise<{ update(d: Uint8Array): void; digest(enc: 'hex'): string }> | null = null;
  private archiveDigest: string | null = null;
  private sinkError: unknown = null;
  private artifactSeq = 0;
  private readonly artifacts: ArtifactRecord[] = [];
  private readonly modules = new Map<AcquisitionType, ModuleRecord>();
  private startedAt: Date | null = null;
  private running = false;

  constructor(config: SessionConfig, deps: SessionDeps) {
    this.config = deepFreeze(structuredCloneConfig(config));
    this.id = crypto.randomUUID();
    this.events = deps.events ?? {};
    this.deps = {
      sink: deps.sink,
      computeArchiveDigest: deps.computeArchiveDigest ?? true,
      outcomeTimeoutMs: deps.outcomeTimeoutMs ?? 15_000,
      progressEveryBytes: deps.progressEveryBytes ?? 1024 * 1024,
      now: deps.now ?? (() => new Date()),
    };
  }

  get state(): SessionState {
    return this._state;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Requests cancellation. The result of `run()` reports `cancelled` once every stage has stopped. */
  cancel(reason = 'Cancelled by the operator'): void {
    if (TERMINAL_STATES.includes(this._state)) return;
    this.log('warn', 'Cancellation requested', 'CANCEL_REQUESTED');
    this.controller.abort(new AcquisitionAbortedError(reason));
    if (!this.running) this.transition('cancelled');
  }

  /**
   * Runs the whole session. Resolves (never rejects) with the final result.
   * `tasks` must cover exactly the requested modules.
   */
  async run(tasks: ModuleTask[]): Promise<SessionResult> {
    if (this.running || this._state !== 'preparing') {
      throw new Error('A session can be run only once; start a new session to retry.');
    }
    this.running = true;
    try {
      return await this.runInner(tasks);
    } finally {
      this.running = false;
    }
  }

  // ── main flow ─────────────────────────────────────────────────────────────

  private async runInner(tasks: ModuleTask[]): Promise<SessionResult> {
    // Preflight (class 1 errors prevent the start).
    const pre = this.preflight(tasks);
    if (pre) {
      this.transition('failed');
      await this.abortSink(pre.message);
      return { state: 'failed', manifest: null, saveConfirmed: false, archive: null, error: pre };
    }
    if (this.signal.aborted) return this.cancelledResult();

    if (this.config.mode === 'protected') {
      this.encryptor = new AgeStreamEncryptor(this.config.recipient);
    }
    if (this.deps.computeArchiveDigest) {
      this.archiveHash = import('hash-wasm').then(m => m.createSHA256());
      await this.archiveHash;
    }
    this.zip = new StreamingZipWriter(this.wrapSink(this.deps.sink));
    this.transition('ready');

    this.startedAt = this.deps.now();
    this.transition('acquiring');
    for (const m of this.config.requested) {
      this.modules.set(m, { module: m, status: 'pending', artifactIds: [] });
    }

    try {
      for (const task of tasks) {
        this.throwIfAborted();
        await this.runModule(task);
      }
      this.throwIfAborted();
      return await this.finalize();
    } catch (err) {
      if (isAbortError(err) || this.signal.aborted) {
        return this.cancelledResult();
      }
      const record =
        err instanceof FatalSessionError
          ? err.record
          : { code: errorCode(err), phase: 'write' as const, message: errorMessage(err) };
      this.log('error', `Session aborted: ${record.code}`, record.code);
      await this.abortSink(record.message);
      this.transition('failed');
      return { state: 'failed', manifest: null, saveConfirmed: false, archive: null, error: record };
    }
  }

  private preflight(tasks: ModuleTask[]): ErrorRecord | null {
    const c = this.config;
    const fail = (code: string, message: string): ErrorRecord => ({ code, phase: 'preflight', message });
    if (c.requested.length === 0) return fail('NO_MODULES', 'No acquisition module was requested.');
    for (const m of c.requested) {
      if (!(m in ACQUISITION_TYPES)) return fail('UNKNOWN_MODULE', `Unknown module: ${m}`);
    }
    const taskModules = tasks.map(t => t.module);
    const same =
      taskModules.length === c.requested.length && taskModules.every((m, i) => m === c.requested[i]);
    if (!same) return fail('TASKS_MISMATCH', 'Tasks do not match the configured modules.');
    if (c.mode === 'protected') {
      if (!c.recipient || c.recipient.type !== 'age-x25519') {
        return fail('RECIPIENT_INVALID', 'No valid recipient in the session configuration.');
      }
      if (!c.recipientConfirmation?.confirmedAt || !c.recipientConfirmation?.method) {
        return fail('RECIPIENT_UNVERIFIED', 'The recipient has not been confirmed by the operator.');
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(c.caseRef)) {
        return fail('CASE_REF_INVALID', 'Invalid case reference.');
      }
    }
    return null;
  }

  // ── modules ───────────────────────────────────────────────────────────────

  private async runModule(task: ModuleTask): Promise<void> {
    const rec = this.modules.get(task.module)!;
    if (!task.run) {
      rec.status = 'unsupported';
      this.emitModule(rec, 'Not supported by this build');
      return;
    }
    const started = this.deps.now();
    rec.startedAt = started.toISOString();
    rec.status = 'running';
    this.emitModule(rec, 'Running');

    let result: AcquisitionResult;
    try {
      result = await raceAbort(
        task.run({
          signal: this.signal,
          onProgress: p => this.events.onModuleUpdate?.({
            module: task.module,
            status: 'running',
            message: p.message,
            progress: p.progress,
          }),
        }),
        this.signal
      );
    } catch (err) {
      if (isAbortError(err) || this.signal.aborted) {
        rec.status = 'cancelled';
        throw err;
      }
      // Class 2: module failed before writing any entry; continue with others.
      this.endModule(rec, started, 'failed', { code: errorCode(err), phase: 'module', message: errorMessage(err) });
      return;
    }

    const cap = capData(result.data);
    if (cap.data !== undefined) rec.data = cap.data;
    if (cap.truncated) rec.dataTruncated = true;

    if (!result.success) {
      // Streams handed back by a failed acquirer must not keep the device busy.
      for (const f of result.files ?? []) f.stream?.cancel().catch(() => {});
      this.endModule(rec, started, 'failed', {
        code: 'MODULE_FAILED',
        phase: 'module',
        message: result.error ?? 'The acquisition module reported a failure.',
      });
      return;
    }

    let allVerified = true;
    const files = result.files ?? [];
    for (let i = 0; i < files.length; i++) {
      if (this.signal.aborted) {
        for (const f of files.slice(i)) f.stream?.cancel().catch(() => {});
        throw new AcquisitionAbortedError();
      }
      const art = await this.processArtifact(task.module, files[i]);
      rec.artifactIds.push(art.id);
      if (art.status !== 'verified') allVerified = false;
    }

    this.endModule(
      rec,
      started,
      allVerified ? 'completed' : 'failed',
      allVerified ? undefined : { code: 'ARTIFACT_INCOMPLETE', phase: 'source', message: 'At least one artefact is incomplete.' }
    );
  }

  private endModule(rec: ModuleRecord, started: Date, status: ModuleRecord['status'], error?: ErrorRecord) {
    const ended = this.deps.now();
    rec.status = status;
    rec.endedAt = ended.toISOString();
    rec.durationMs = ended.getTime() - started.getTime();
    if (error) rec.error = error;
    this.emitModule(rec, status === 'completed' ? 'Completed' : error?.message);
  }

  // ── one artefact ──────────────────────────────────────────────────────────

  private async processArtifact(module: AcquisitionType, file: AcquisitionFile): Promise<ArtifactRecord> {
    const zip = this.zip!;
    const id = artifactId(++this.artifactSeq);
    const protectedMode = this.config.mode === 'protected';
    const entry = protectedMode ? `${id}.age` : this.legacyEntryName(module, file.fileName, id);
    const startedAt = this.deps.now().toISOString();
    this.log('info', `Artefact ${id} (${module}) started`);

    // source → seal → abort → count → SHA-256
    const sealed = sealOnSourceFailure(file.stream);
    let lastReport = 0;
    const counter = byteCounter(total => {
      if (total - lastReport >= this.deps.progressEveryBytes) {
        lastReport = total;
        this.events.onArtifactProgress?.({
          artifactId: id,
          module,
          logicalName: file.fileName,
          bytesAcquired: total,
          archiveBytesWritten: this.archiveCounter,
        });
      }
    });
    let plain = abortable(sealed.stream, this.signal).pipeThrough(counter.transform);

    let digestPromise: Promise<string>;
    let computedBy: 'acquirer-passthrough' | 'coordinator';
    if (file.hashPromise) {
      digestPromise = file.hashPromise;
      computedBy = 'acquirer-passthrough';
    } else {
      const h = await hashingPassthrough('sha-256');
      plain = plain.pipeThrough({ writable: h.writable, readable: h.readable });
      digestPromise = h.hashPromise;
      computedBy = 'coordinator';
    }
    digestPromise.catch(() => {});

    // → age → ZIP → sink
    let stored: number;
    let encryption: boolean | 'not-applicable' = 'not-applicable';
    try {
      if (protectedMode) {
        const enc = await this.encryptor!.encryptStream(plain);
        const info = await zip.addFileFromStream(entry, enc.ciphertext);
        await enc.finalized;
        encryption = true;
        stored = info.size;
      } else {
        stored = (await zip.addFileFromStream(entry, plain)).size;
      }
    } catch (err) {
      if (isAbortError(err) || this.signal.aborted) throw new AcquisitionAbortedError();
      // Class 3: the entry is half-written; the container cannot be trusted.
      const phase = this.sinkError ? 'write' : protectedMode ? 'encrypt' : 'write';
      throw new FatalSessionError(
        { code: errorCode(this.sinkError ?? err), phase, message: errorMessage(this.sinkError ?? err), bytesBeforeError: counter.total() },
        err
      );
    }

    // S_i
    const failure = sealed.failure();
    const outcome = file.outcome ? await withTimeout(file.outcome, this.deps.outcomeTimeoutMs) : undefined;
    let S: boolean;
    let source: ArtifactRecord['source'];
    let error: ErrorRecord | undefined;
    if (failure) {
      S = false;
      source = { cause: outcome?.cause ?? 'source-error', exitCode: outcome?.exitCode ?? null };
      error = { code: errorCode(failure), phase: 'source', message: errorMessage(failure), bytesBeforeError: counter.total() };
    } else if (outcome) {
      const v = evaluateSourceOutcome(outcome);
      S = v.acceptable;
      source = { cause: outcome.cause, exitCode: outcome.exitCode, ...(v.limitation ? { limitation: v.limitation } : {}) };
      if (!S) error = { code: `SOURCE_${(v.reason ?? 'unknown').toUpperCase().replace(/-/g, '_')}`, phase: 'source', message: `Source ended with ${v.reason}` };
    } else if (file.outcome) {
      // An outcome was promised but did not settle in time: do not presume success.
      S = false;
      source = { cause: 'not-exposed', exitCode: null };
      error = { code: 'SOURCE_OUTCOME_TIMEOUT', phase: 'source', message: 'The source did not report how it ended.' };
    } else {
      S = true;
      source = { cause: 'not-exposed', exitCode: null, limitation: 'source-outcome-not-exposed' };
    }

    // H_i
    let digestValue: string | null = null;
    try {
      digestValue = await digestPromise;
    } catch (err) {
      if (!error) error = { code: 'DIGEST_UNAVAILABLE', phase: 'hash', message: errorMessage(err) };
    }
    const fullDigest = digestValue !== null && !failure;
    const H = fullDigest;

    const W = true; // addFileFromStream resolved: entry and data descriptor written.
    const E = encryption;
    const V = S && H && (E === 'not-applicable' || E === true) && W;

    const record: ArtifactRecord = {
      id,
      module,
      logicalName: file.fileName,
      entry,
      ...(file.description ? { description: file.description } : {}),
      ...(file.mimeType ? { mimeType: file.mimeType } : {}),
      status: V ? 'verified' : 'incomplete',
      verdict: { source: S, digest: H, encryption: E, write: W },
      bytesAcquired: counter.total(),
      bytesStored: stored,
      sizeAnnounced: file.sizeUnknown || (file.fileSize === 0 && !!file.outcome) ? null : file.fileSize,
      digest: fullDigest
        ? { algorithm: 'sha-256', value: digestValue!, scope: 'bytes-received-by-browser', computedBy }
        : null,
      ...(failure && digestValue !== null
        ? { partialDigest: { algorithm: 'sha-256' as const, value: digestValue, coversBytes: counter.total() } }
        : {}),
      source,
      startedAt,
      endedAt: this.deps.now().toISOString(),
      ...(error ? { error } : {}),
    };
    if (file.hashPromise && digestValue) file.hash = digestValue; // keep legacy field populated
    this.artifacts.push(record);
    this.events.onArtifactRecorded?.(record);
    this.events.onArtifactProgress?.({
      artifactId: id,
      module,
      logicalName: file.fileName,
      bytesAcquired: record.bytesAcquired,
      archiveBytesWritten: this.archiveCounter,
    });
    this.log(V ? 'info' : 'warn', `Artefact ${id} recorded as ${record.status}`, error?.code);
    return record;
  }

  private legacyEntryName(module: AcquisitionType, fileName: string, id: string): string {
    const folder = (this.config as LegacySessionConfig).folder;
    const safe = fileName.replace(/^\/+/, '').split('/').filter(p => p && p !== '..' && p !== '.').join('/') || id;
    const name = `${folder}/${safe}`;
    const used = this.zip!.getEntries().some(e => e.name === name);
    return used ? `${folder}/${module}-${id}-${safe.split('/').pop()}` : name;
  }

  // ── finalisation ──────────────────────────────────────────────────────────

  private async finalize(): Promise<SessionResult> {
    this.transition('finalizing');
    const zip = this.zip!;
    const manifest = this.buildManifest();
    const json = new TextEncoder().encode(JSON.stringify(manifest, null, 2));

    try {
      if (this.config.mode === 'protected') {
        // 1. encrypted manifest, 2. public descriptor
        await zip.addFile(PROTECTED_MANIFEST_ENTRY, await this.encryptor!.encryptBytes(json));
        await zip.addFile(DESCRIPTOR_ENTRY, utf8Json(buildDescriptor('protected')));
      } else {
        const manifestEntry = `${(this.config as LegacySessionConfig).folder}/manifest.json`;
        await zip.addFile(manifestEntry, json);
        await zip.addFile(DESCRIPTOR_ENTRY, utf8Json(buildDescriptor('legacy', manifestEntry)));
      }
      this.throwIfAborted();
      // 3. central directory, 4. sink close (confirmed by finalize()).
      const fin = await zip.finalize();
      if (this.archiveHash) this.archiveDigest = (await this.archiveHash).digest('hex');

      const state: SessionOutcome = manifest.session.outcome;
      this.transition(state);
      this.log('info', `Archive finalised (${fin.entries} entries)`);
      return {
        state,
        manifest,
        saveConfirmed: true,
        archive: { bytes: fin.bytes, entries: fin.entries, sha256: this.archiveDigest },
      };
    } catch (err) {
      if (isAbortError(err) || this.signal.aborted) return this.cancelledResult();
      const record: ErrorRecord = {
        code: errorCode(this.sinkError ?? err),
        phase: 'finalize',
        message: errorMessage(this.sinkError ?? err),
      };
      await this.abortSink(record.message);
      this.transition('failed');
      return { state: 'failed', manifest, saveConfirmed: false, archive: null, error: record };
    }
  }

  private buildManifest(): ManifestV1 {
    const c = this.config;
    const mods = [...this.modules.values()];
    const byStatus = (s: ModuleRecord['status']) => mods.filter(m => m.status === s).map(m => m.module);
    const completed = byStatus('completed');
    const outcome: SessionOutcome = completed.length === c.requested.length ? 'completed' : 'partial';
    const legacyManifestEntry = c.mode === 'legacy' ? `${c.folder}/manifest.json` : undefined;

    return {
      schema: MANIFEST_SCHEMA,
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      format: formatBlock(c.mode, legacyManifestEntry),
      session: {
        id: this.id,
        caseRef: c.caseRef ?? null,
        startedAt: (this.startedAt ?? this.deps.now()).toISOString(),
        endedAt: this.deps.now().toISOString(),
        outcome,
        clock: 'client',
      },
      tool: {
        name: 'wafb',
        version: c.tool.version,
        ...(c.tool.build ? { build: c.tool.build } : {}),
        rulesVersion: RULES_VERSION,
        ...(c.tool.userAgent ? { userAgent: c.tool.userAgent } : {}),
      },
      device: c.device ?? null,
      protection:
        c.mode === 'protected'
          ? {
              mode: 'protected',
              artifactFormat: 'age-v1',
              recipientType: 'age-x25519',
              recipient: c.recipient.canonical,
              keyId: c.recipient.keyId,
              keyIdScheme: 'wafb-recipient-v1',
              verification: { ...c.recipientConfirmation, declaredBy: 'operator' },
            }
          : { mode: 'legacy' },
      modules: {
        requested: [...c.requested],
        profileSource: c.profileSource,
        ...(c.profileChange ? { profileChange: c.profileChange } : {}),
        notSelected: (Object.keys(ACQUISITION_TYPES) as AcquisitionType[]).filter(t => !c.requested.includes(t)),
        completed,
        failed: byStatus('failed'),
        unsupported: byStatus('unsupported'),
        skipped: byStatus('skipped'),
        details: mods.map(m => ({ ...m, artifactIds: [...m.artifactIds] })),
      },
      artifacts: this.artifacts.map(a => ({ ...a })),
      summary: {
        artifacts: this.artifacts.length,
        verified: this.artifacts.filter(a => a.status === 'verified').length,
        incomplete: this.artifacts.filter(a => a.status !== 'verified').length,
        bytesAcquired: this.artifacts.reduce((n, a) => n + a.bytesAcquired, 0),
        bytesStored: this.artifacts.reduce((n, a) => n + a.bytesStored, 0),
      },
      scopeNote: MANIFEST_SCOPE_NOTE,
    };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /** Counts (and optionally hashes) every byte handed to the sink; records sink errors. */
  private wrapSink(sink: WritableStream<Uint8Array>): WritableStream<Uint8Array> {
    const inner = sink.getWriter();
    return new WritableStream<Uint8Array>({
      write: async chunk => {
        try {
          await inner.ready;
          await inner.write(chunk);
        } catch (err) {
          this.sinkError ??= err;
          throw err;
        }
        this.archiveCounter += chunk.byteLength;
        if (this.archiveHash) (await this.archiveHash).update(chunk);
      },
      close: async () => {
        try {
          await inner.close();
        } catch (err) {
          this.sinkError ??= err;
          throw err;
        }
      },
      abort: async reason => {
        await inner.abort(reason).catch(() => {});
      },
    });
  }

  private async abortSink(reason: string): Promise<void> {
    if (this.zip) {
      await this.zip.abort(new Error(reason));
    } else {
      // Sink was never wrapped: release it so the browser can discard the file.
      try { await this.deps.sink.abort(new Error(reason)); } catch { /* locked or closed */ }
    }
  }

  private async cancelledResult(): Promise<SessionResult> {
    for (const m of this.modules.values()) {
      if (m.status === 'pending' || m.status === 'running') m.status = 'cancelled';
    }
    await this.abortSink('Cancelled');
    if (!TERMINAL_STATES.includes(this._state)) this.transition('cancelled');
    return {
      state: 'cancelled',
      manifest: null,
      saveConfirmed: false,
      archive: null,
      error: { code: 'CANCELLED', phase: 'cancel', message: 'The session was cancelled; the archive was not finalised.' },
    };
  }

  private throwIfAborted(): void {
    if (this.signal.aborted) throw new AcquisitionAbortedError();
  }

  private transition(to: SessionState): void {
    const from = this._state;
    if (from === to) return;
    if (!TRANSITIONS[from].includes(to)) throw new InvalidTransitionError(from, to);
    this._state = to;
    this.events.onStateChange?.(to, from);
  }

  private emitModule(rec: ModuleRecord, message?: string) {
    this.events.onModuleUpdate?.({ module: rec.module, status: rec.status, message });
  }

  private log(level: SessionLogEntry['level'], message: string, code?: string) {
    this.events.onLog?.({ at: this.deps.now().toISOString(), level, message, ...(code ? { code } : {}) });
  }
}

// ============================================================================
// utilities
// ============================================================================

function utf8Json(o: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(o, null, 2));
}

function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new AcquisitionAbortedError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AcquisitionAbortedError());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      v => { signal.removeEventListener('abort', onAbort); resolve(v); },
      e => { signal.removeEventListener('abort', onAbort); reject(e); }
    );
  });
}

async function withTimeout(p: Promise<SourceOutcome>, ms: number): Promise<SourceOutcome | undefined> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<undefined>(r => (t = setTimeout(() => r(undefined), ms)))]);
  } finally {
    if (t !== undefined) clearTimeout(t);
  }
}

/** Copies plain data; ValidatedRecipient and nested objects are re-created then frozen. */
function structuredCloneConfig(c: SessionConfig): SessionConfig {
  return JSON.parse(JSON.stringify(c));
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}
