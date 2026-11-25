/**
 * Streaming ZIP Writer (STORE only) with ZIP64 support.
 *
 * Two kinds of entries:
 * - Buffered entries (`addFile`): CRC32 and size known upfront. Written with a
 *   classic header; ZIP64 fields are added only if the entry or its offset
 *   overflow 32 bits.
 * - Streamed entries (`addFileFromStream`, `addAcquisitionFile`): size unknown
 *   when the header is written. Bit 3 (data descriptor) is set and the entry is
 *   **always** prepared as ZIP64: the local header carries 0xFFFFFFFF sizes and
 *   a ZIP64 extra field, and the data descriptor stores 64-bit sizes. A backup
 *   can therefore be written chunk by chunk and exceed 4 GiB without the header
 *   having to be rewritten (APPNOTE 6.3.10, §4.3.9 and §4.5.3).
 *
 * The central directory uses ZIP64 extra fields for every value that does not
 * fit 32 bits, and the archive gets a ZIP64 end-of-central-directory record and
 * locator when the entry count exceeds 65 535 or the directory size / offset
 * exceed 32 bits.
 *
 * Changes from WAFB 0.3.1 (which used 32-bit fields only):
 *   - ZIP64 as described above;
 *   - general-purpose bit 11 (UTF-8 names);
 *   - a failed or aborted entry poisons the writer: no further entry and no
 *     central directory can be written on top of a half-written entry, and
 *     `finalize()` resolves only after the sink has confirmed `close()`.
 *
 * The writer is deliberately ignorant of what the bytes mean: in the protected
 * pipeline it receives age ciphertext, and its CRC32 covers that ciphertext.
 * CRC32 is a container checksum, not an integrity guarantee for the evidence.
 */

import { Logger } from './logger';
import type { AcquisitionFile } from '../forensics/acquisition';

const SIG_LOCAL = 0x04034b50;
const SIG_DATA_DESCRIPTOR = 0x08074b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_EOCD = 0x06054b50;

const ZIP64_EXTRA_ID = 0x0001;
const VERSION_CLASSIC = 20;
const VERSION_ZIP64 = 45;
/** "Version made by": upper byte 3 = UNIX, lower byte = spec version. */
const MADE_BY_UNIX = 3 << 8;

const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_UTF8 = 0x0800;

const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;

export interface ZipEntryInfo {
  name: string;
  /** Offset of the local file header from the start of the archive. */
  offset: number;
  /** Stored (= uncompressed, STORE) size in bytes. */
  size: number;
  crc32: number;
  /** True when the entry was written with ZIP64 local header / descriptor. */
  zip64Local: boolean;
}

export interface StreamingZipOptions {
  logger?: Logger;
  /** Called with the running number of data bytes of the current entry. */
  onEntryProgress?: (name: string, bytes: number) => void;
}

export type ZipWriterState = 'open' | 'finalized' | 'failed';

export class StreamingZipWriter {
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private entries: ZipEntryInfo[] = [];
  private names = new Set<string>();
  private currentOffset = 0;
  private state: ZipWriterState = 'open';
  private failure: unknown = null;
  private logger: Logger;
  private onEntryProgress?: (name: string, bytes: number) => void;

  constructor(stream: WritableStream<Uint8Array>, options: StreamingZipOptions = {}) {
    this.writer = stream.getWriter();
    this.logger = options.logger ?? new Logger('StreamingZipWriter');
    this.onEntryProgress = options.onEntryProgress;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Adds an entry whose bytes are already in memory (e.g. manifest, descriptor). */
  async addFile(name: string, data: Uint8Array): Promise<ZipEntryInfo> {
    this.assertWritable(name);
    this.logger.debug(`Adding file to ZIP: ${name} (${data.length} bytes)`);

    const crc32 = crc32Of(data);
    const offset = this.currentOffset;
    const needsZip64 = data.length >= MAX_U32;

    await this.guard(async () => {
      await this.write(createLocalHeader(name, { crc32, size: data.length, streaming: false, zip64: needsZip64 }));
      await this.write(data);
    });

    const info: ZipEntryInfo = { name, offset, size: data.length, crc32, zip64Local: needsZip64 };
    this.entries.push(info);
    return info;
  }

  /**
   * Adds an entry from a stream, consuming it chunk by chunk.
   *
   * 1. ZIP64-ready local header (sizes deferred, bit 3 set).
   * 2. Each chunk is CRC'd and awaited on the sink — backpressure reaches the source.
   * 3. ZIP64 data descriptor (CRC32 + 64-bit sizes).
   *
   * If the source errors, the sink rejects or the entry is cancelled, the
   * writer moves to the `failed` state and the error is rethrown.
   */
  async addFileFromStream(name: string, stream: ReadableStream<Uint8Array>): Promise<ZipEntryInfo> {
    this.assertWritable(name);
    this.logger.debug(`Adding file from stream: ${name}`);

    const offset = this.currentOffset;
    let crc = 0xffffffff;
    let size = 0;

    const reader = stream.getReader();
    await this.guard(
      async () => {
        await this.write(createLocalHeader(name, { crc32: 0, size: 0, streaming: true, zip64: true }));
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || value.byteLength === 0) continue;
          crc = updateCRC32(crc, value);
          size += value.byteLength;
          await this.write(value);
          this.onEntryProgress?.(name, size);
        }
        const crc32 = (crc ^ 0xffffffff) >>> 0;
        await this.write(createZip64DataDescriptor(crc32, size));
      },
      async err => {
        // Stop the producer: an entry left half-written cannot be continued.
        try { await reader.cancel(err); } catch { /* already errored */ }
      }
    );
    try { reader.releaseLock(); } catch { /* ignore */ }

    const info: ZipEntryInfo = { name, offset, size, crc32: (crc ^ 0xffffffff) >>> 0, zip64Local: true };
    this.entries.push(info);
    this.logger.debug(`Stream added: ${name} (${size} bytes)`);
    return info;
  }

  /**
   * Unified entry point for AcquisitionFile (legacy, unencrypted path).
   *
   * Unlike 0.3.1, a failing digest is not swallowed into a warning: the
   * rejection propagates to the caller, which decides how to record it.
   */
  async addAcquisitionFile(file: AcquisitionFile): Promise<ZipEntryInfo> {
    if (!file.stream) {
      throw new Error(`AcquisitionFile "${file.fileName}" has no stream`);
    }
    const info = await this.addFileFromStream(file.fileName, file.stream);
    if (file.hashPromise) {
      file.hash = await file.hashPromise;
      this.logger.debug(`Hash for ${file.fileName}: ${file.hash}`);
    }
    return info;
  }

  /**
   * Writes the central directory and end records, then closes the sink.
   * Resolves only when the sink has confirmed the close: that confirmation —
   * not the presence of a file in the target folder — is the criterion for
   * "archive saved".
   */
  async finalize(): Promise<{ entries: number; bytes: number; zip64: boolean }> {
    if (this.state === 'finalized') throw new Error('ZIP writer already finalized');
    if (this.state === 'failed') throw new Error('ZIP writer failed; cannot finalize', { cause: this.failure });
    this.logger.info(`Finalizing ZIP with ${this.entries.length} entries`);

    let usedZip64Eocd = false;
    await this.guard(async () => {
      const cdStart = this.currentOffset;
      for (const e of this.entries) {
        await this.write(createCentralHeader(e));
      }
      const cdSize = this.currentOffset - cdStart;
      const count = this.entries.length;

      usedZip64Eocd = count >= MAX_U16 || cdSize >= MAX_U32 || cdStart >= MAX_U32;
      if (usedZip64Eocd) {
        const zip64EocdOffset = this.currentOffset;
        await this.write(createZip64Eocd(count, cdSize, cdStart));
        await this.write(createZip64Locator(zip64EocdOffset));
      }
      await this.write(createEocd(count, cdSize, cdStart));
      await this.writer.close();
    });

    this.state = 'finalized';
    this.logger.info('ZIP finalized successfully');
    return {
      entries: this.entries.length,
      bytes: this.currentOffset,
      zip64: usedZip64Eocd || this.entries.some(e => e.zip64Local),
    };
  }

  /**
   * Aborts the sink. For a FileSystemWritableFileStream this asks the browser
   * to discard the pending write; whether a partial file remains visible is
   * platform-dependent and must not be assumed.
   */
  async abort(reason?: unknown): Promise<void> {
    if (this.state === 'finalized') return;
    this.state = 'failed';
    this.failure = reason ?? new Error('ZIP writer aborted');
    try { await this.writer.abort(reason); } catch { /* sink may already be errored */ }
  }

  getState(): ZipWriterState {
    return this.state;
  }

  getEntries(): readonly ZipEntryInfo[] {
    return this.entries;
  }

  getStats() {
    return {
      totalEntries: this.entries.length,
      totalSize: this.currentOffset,
      finalized: this.state === 'finalized',
      failed: this.state === 'failed',
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private assertWritable(name: string): void {
    if (this.state === 'finalized') throw new Error('Cannot add file: ZIP writer already finalized');
    if (this.state === 'failed') {
      throw new Error('Cannot add file: ZIP writer failed on a previous entry', { cause: this.failure });
    }
    if (this.names.has(name)) throw new Error(`Duplicate ZIP entry name: ${name}`);
    if (name.length === 0 || name.startsWith('/') || name.split('/').includes('..')) {
      throw new Error(`Invalid ZIP entry name: ${name}`);
    }
    this.names.add(name);
  }

  private async guard(fn: () => Promise<void>, onError?: (err: unknown) => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.state = 'failed';
      this.failure = err;
      if (onError) await onError(err);
      try { await this.writer.abort(err); } catch { /* ignore */ }
      throw err;
    }
  }

  private async write(data: Uint8Array): Promise<void> {
    await this.writer.ready;
    await this.writer.write(data);
    this.currentOffset += data.length;
  }
}

// ============================================================================
// Record builders
// ============================================================================

const utf8 = new TextEncoder();

function setU64(v: DataView, at: number, n: number): void {
  v.setBigUint64(at, BigInt(n), true);
}

function createLocalHeader(
  name: string,
  o: { crc32: number; size: number; streaming: boolean; zip64: boolean }
): Uint8Array {
  const nameBytes = utf8.encode(name);
  // Local ZIP64 extra: original size (8) + compressed size (8).
  const extraLen = o.zip64 ? 4 + 16 : 0;
  const h = new Uint8Array(30 + nameBytes.length + extraLen);
  const v = new DataView(h.buffer);
  v.setUint32(0, SIG_LOCAL, true);
  v.setUint16(4, o.zip64 ? VERSION_ZIP64 : VERSION_CLASSIC, true);
  v.setUint16(6, FLAG_UTF8 | (o.streaming ? FLAG_DATA_DESCRIPTOR : 0), true);
  v.setUint16(8, 0, true); // STORE
  v.setUint16(10, 0, true); // mod time
  v.setUint16(12, 0x21, true); // mod date 1980-01-01 (DOS epoch, deterministic)
  v.setUint32(14, o.streaming ? 0 : o.crc32, true);
  v.setUint32(18, o.zip64 ? MAX_U32 : o.streaming ? 0 : o.size, true);
  v.setUint32(22, o.zip64 ? MAX_U32 : o.streaming ? 0 : o.size, true);
  v.setUint16(26, nameBytes.length, true);
  v.setUint16(28, extraLen, true);
  h.set(nameBytes, 30);
  if (o.zip64) {
    const x = 30 + nameBytes.length;
    v.setUint16(x, ZIP64_EXTRA_ID, true);
    v.setUint16(x + 2, 16, true);
    // For streamed entries the real sizes go in the data descriptor.
    setU64(v, x + 4, o.streaming ? 0 : o.size);
    setU64(v, x + 12, o.streaming ? 0 : o.size);
  }
  return h;
}

/** ZIP64 data descriptor: signature, CRC32, 8-byte compressed and uncompressed sizes. */
function createZip64DataDescriptor(crc32: number, size: number): Uint8Array {
  const dd = new Uint8Array(24);
  const v = new DataView(dd.buffer);
  v.setUint32(0, SIG_DATA_DESCRIPTOR, true);
  v.setUint32(4, crc32, true);
  setU64(v, 8, size);
  setU64(v, 16, size);
  return dd;
}

function createCentralHeader(e: ZipEntryInfo): Uint8Array {
  const nameBytes = utf8.encode(e.name);
  // Sizes are forced to ZIP64 for entries whose local header was ZIP64, so
  // that readers interpret the 24-byte data descriptor consistently.
  const sizes64 = e.zip64Local || e.size >= MAX_U32;
  const offset64 = e.offset >= MAX_U32;
  const extraData = (sizes64 ? 16 : 0) + (offset64 ? 8 : 0);
  const extraLen = extraData > 0 ? 4 + extraData : 0;
  const zip64 = extraLen > 0;

  const h = new Uint8Array(46 + nameBytes.length + extraLen);
  const v = new DataView(h.buffer);
  v.setUint32(0, SIG_CENTRAL, true);
  v.setUint16(4, MADE_BY_UNIX | (zip64 ? VERSION_ZIP64 : VERSION_CLASSIC), true);
  v.setUint16(6, zip64 ? VERSION_ZIP64 : VERSION_CLASSIC, true);
  v.setUint16(8, FLAG_UTF8 | (e.zip64Local ? FLAG_DATA_DESCRIPTOR : 0), true);
  v.setUint16(10, 0, true); // STORE
  v.setUint16(12, 0, true);
  v.setUint16(14, 0x21, true);
  v.setUint32(16, e.crc32, true);
  v.setUint32(20, sizes64 ? MAX_U32 : e.size, true);
  v.setUint32(24, sizes64 ? MAX_U32 : e.size, true);
  v.setUint16(28, nameBytes.length, true);
  v.setUint16(30, extraLen, true);
  v.setUint16(32, 0, true); // comment
  v.setUint16(34, 0, true); // disk start
  v.setUint16(36, 0, true); // internal attrs
  v.setUint32(38, (0o100644 << 16) >>> 0, true); // external attrs: regular file 0644
  v.setUint32(42, offset64 ? MAX_U32 : e.offset, true);
  h.set(nameBytes, 46);

  if (zip64) {
    // Field order is fixed by the spec: uncompressed, compressed, offset, disk.
    let x = 46 + nameBytes.length;
    v.setUint16(x, ZIP64_EXTRA_ID, true);
    v.setUint16(x + 2, extraData, true);
    x += 4;
    if (sizes64) {
      setU64(v, x, e.size); x += 8;
      setU64(v, x, e.size); x += 8;
    }
    if (offset64) {
      setU64(v, x, e.offset);
    }
  }
  return h;
}

function createZip64Eocd(entries: number, cdSize: number, cdOffset: number): Uint8Array {
  const r = new Uint8Array(56);
  const v = new DataView(r.buffer);
  v.setUint32(0, SIG_ZIP64_EOCD, true);
  setU64(v, 4, 56 - 12); // size of the remaining record
  v.setUint16(12, MADE_BY_UNIX | VERSION_ZIP64, true);
  v.setUint16(14, VERSION_ZIP64, true);
  v.setUint32(16, 0, true); // this disk
  v.setUint32(20, 0, true); // disk with CD
  setU64(v, 24, entries);
  setU64(v, 32, entries);
  setU64(v, 40, cdSize);
  setU64(v, 48, cdOffset);
  return r;
}

function createZip64Locator(zip64EocdOffset: number): Uint8Array {
  const r = new Uint8Array(20);
  const v = new DataView(r.buffer);
  v.setUint32(0, SIG_ZIP64_LOCATOR, true);
  v.setUint32(4, 0, true);
  setU64(v, 8, zip64EocdOffset);
  v.setUint32(16, 1, true); // total disks
  return r;
}

function createEocd(entries: number, cdSize: number, cdOffset: number): Uint8Array {
  const r = new Uint8Array(22);
  const v = new DataView(r.buffer);
  v.setUint32(0, SIG_EOCD, true);
  v.setUint16(4, 0, true);
  v.setUint16(6, 0, true);
  v.setUint16(8, Math.min(entries, MAX_U16), true);
  v.setUint16(10, Math.min(entries, MAX_U16), true);
  v.setUint32(12, Math.min(cdSize, MAX_U32), true);
  v.setUint32(16, Math.min(cdOffset, MAX_U32), true);
  v.setUint16(20, 0, true);
  return r;
}

// ============================================================================
// CRC32 (slice-by-8 for throughput on large streams)
// ============================================================================

const CRC_TABLES: Uint32Array[] = (() => {
  const t0 = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t0[i] = c >>> 0;
  }
  const tables = [t0];
  for (let k = 1; k < 8; k++) {
    const prev = tables[k - 1];
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) t[i] = (prev[i] >>> 8) ^ t0[prev[i] & 0xff];
    tables.push(t);
  }
  return tables;
})();

/** Updates a running (pre-inverted) CRC32 with `data`. */
export function updateCRC32(crc: number, data: Uint8Array): number {
  const [t0, t1, t2, t3, t4, t5, t6, t7] = CRC_TABLES;
  let c = crc >>> 0;
  let i = 0;
  const n = data.length;
  const end8 = n - (n % 8);
  for (; i < end8; i += 8) {
    const a = c ^ (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24));
    c =
      t7[a & 0xff] ^
      t6[(a >>> 8) & 0xff] ^
      t5[(a >>> 16) & 0xff] ^
      t4[a >>> 24] ^
      t3[data[i + 4]] ^
      t2[data[i + 5]] ^
      t1[data[i + 6]] ^
      t0[data[i + 7]];
  }
  for (; i < n; i++) c = t0[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

export function crc32Of(data: Uint8Array): number {
  return (updateCRC32(0xffffffff, data) ^ 0xffffffff) >>> 0;
}

// ============================================================================
// Helpers (buffered, small archives only — kept for API compatibility)
// ============================================================================

export async function createZipBlob(files: Map<string, Uint8Array>, options: StreamingZipOptions = {}): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  const zip = new StreamingZipWriter(new WritableStream({ write(c) { chunks.push(c); } }), options);
  for (const [name, data] of files) await zip.addFile(name, data);
  await zip.finalize();
  return new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' });
}

export async function createZipBlobWithProgress(
  files: Array<{ name: string; data: Uint8Array }>,
  onProgress?: (current: number, total: number) => void,
  options: StreamingZipOptions = {}
): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  const zip = new StreamingZipWriter(new WritableStream({ write(c) { chunks.push(c); } }), options);
  for (let i = 0; i < files.length; i++) {
    await zip.addFile(files[i].name, files[i].data);
    onProgress?.(i + 1, files.length);
  }
  await zip.finalize();
  return new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' });
}
