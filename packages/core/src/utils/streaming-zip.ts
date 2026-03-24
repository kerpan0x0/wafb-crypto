/**
 * Streaming ZIP Writer
 *
 * Two modes:
 * - Blob-backed files (`addFile`): CRC32/size known upfront, standard header.
 * - Stream-backed files (`addFileFromStream`, `addAcquisitionFile`): uses the
 *   ZIP Data Descriptor extension (bit 3 of General Purpose Bit Flag). CRC32
 *   and sizes are written *after* the file data — no buffering required.
 */

import { Logger } from './logger';
import type { AcquisitionFile } from '../forensics/acquisition';

interface ZipEntryMetadata {
  name: string;
  offset: number;
  size: number;
  crc32: number;
}

export interface StreamingZipOptions {
  logger?: Logger;
}

export class StreamingZipWriter {
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private entries: ZipEntryMetadata[] = [];
  private currentOffset = 0;
  private finalized = false;
  private logger: Logger;

  constructor(stream: WritableStream<Uint8Array>, options: StreamingZipOptions = {}) {
    this.writer = stream.getWriter();
    this.logger = options.logger ?? new Logger('StreamingZipWriter');
  }

  /**
   * Adds a file from a Uint8Array. CRC32/size known upfront — standard header.
   */
  async addFile(name: string, data: Uint8Array): Promise<void> {
    if (this.finalized) throw new Error('Cannot add file: ZIP writer already finalized');
    this.logger.debug(`Adding file to ZIP: ${name} (${data.length} bytes)`);

    const crc32 = this.calculateCRC32(data);
    const offset = this.currentOffset;

    await this.write(this.createLocalFileHeader(name, data.length, crc32, false));
    await this.write(data);
    this.entries.push({ name, offset, size: data.length, crc32 });
  }

  /**
   * Adds a file from a ReadableStream using the Data Descriptor extension.
   *
   * 1. Local file header with zeros for CRC32/size + bit 3 set.
   * 2. Stream consumed chunk by chunk — O(1) memory.
   * 3. Data Descriptor (CRC32 + sizes) appended after the data.
   */
  async addFileFromStream(name: string, stream: ReadableStream<Uint8Array>): Promise<void> {
    if (this.finalized) throw new Error('Cannot add file: ZIP writer already finalized');
    this.logger.debug(`Adding file from stream: ${name}`);

    const offset = this.currentOffset;
    await this.write(this.createLocalFileHeader(name, 0, 0, true));

    const reader = stream.getReader();
    let crc = 0xffffffff;
    let size = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        crc = this.updateCRC32(crc, value);
        size += value.length;
        await this.write(value);
      }
    } finally {
      reader.releaseLock();
    }

    const crc32 = (crc ^ 0xffffffff) >>> 0;
    await this.write(this.createDataDescriptor(crc32, size));
    this.entries.push({ name, offset, size, crc32 });
    this.logger.debug(`Stream added: ${name} (${size} bytes)`);
  }

  /**
   * Unified entry point for AcquisitionFile.
   * Routes to the correct method based on stream vs blob.
   * After consuming the stream, awaits hashPromise and stores the hash.
   */
  async addAcquisitionFile(file: AcquisitionFile): Promise<void> {
    if (!file.stream) {
      throw new Error(`AcquisitionFile "${file.fileName}" has no stream`);
    }
    await this.addFileFromStream(file.fileName, file.stream);

    // Resolve hash now that the stream has been fully consumed
    const hashPromise = (file as any).hashPromise as Promise<string> | undefined;
    if (hashPromise) {
      try {
        file.hash = await hashPromise;
        this.logger.debug(`Hash for ${file.fileName}: ${file.hash}`);
      } catch (err) {
        this.logger.warn(`Failed to compute hash for ${file.fileName}`, err);
      }
    }
  }

  async finalize(): Promise<void> {
    if (this.finalized) throw new Error('ZIP writer already finalized');
    this.logger.info(`Finalizing ZIP with ${this.entries.length} entries`);

    const cdStart = this.currentOffset;
    for (const e of this.entries) {
      await this.write(this.createCentralDirectoryHeader(e.name, e.size, e.crc32, e.offset));
    }
    const cdSize = this.currentOffset - cdStart;
    await this.write(this.createEndOfCentralDirectory(this.entries.length, cdSize, cdStart));
    await this.writer.close();
    this.finalized = true;
    this.logger.info('ZIP finalized successfully');
  }

  getStats() {
    return { totalEntries: this.entries.length, totalSize: this.currentOffset, finalized: this.finalized };
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async write(data: Uint8Array): Promise<void> {
    await this.writer.write(data);
    this.currentOffset += data.length;
  }

  private createLocalFileHeader(name: string, size: number, crc32: number, streaming: boolean): Uint8Array {
    const nameBytes = new TextEncoder().encode(name);
    const h = new Uint8Array(30 + nameBytes.length);
    const v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, streaming ? 0x0008 : 0, true); // bit 3 = Data Descriptor
    v.setUint16(8, 0, true);                        // STORE
    v.setUint16(10, 0, true); v.setUint16(12, 0, true);
    v.setUint32(14, streaming ? 0 : crc32, true);
    v.setUint32(18, streaming ? 0 : size, true);
    v.setUint32(22, streaming ? 0 : size, true);
    v.setUint16(26, nameBytes.length, true);
    v.setUint16(28, 0, true);
    h.set(nameBytes, 30);
    return h;
  }

  /** Data Descriptor written after streaming data. 16 bytes with optional signature. */
  private createDataDescriptor(crc32: number, size: number): Uint8Array {
    const dd = new Uint8Array(16);
    const v = new DataView(dd.buffer);
    v.setUint32(0, 0x08074b50, true); // signature (optional but improves compat)
    v.setUint32(4, crc32, true);
    v.setUint32(8, size, true);
    v.setUint32(12, size, true);
    return dd;
  }

  private createCentralDirectoryHeader(name: string, size: number, crc32: number, offset: number): Uint8Array {
    const nameBytes = new TextEncoder().encode(name);
    const h = new Uint8Array(46 + nameBytes.length);
    const v = new DataView(h.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(4, 20, true); v.setUint16(6, 20, true);
    v.setUint16(8, 0, true); v.setUint16(10, 0, true);
    v.setUint16(12, 0, true); v.setUint16(14, 0, true);
    v.setUint32(16, crc32, true);
    v.setUint32(20, size, true);
    v.setUint32(24, size, true);
    v.setUint16(28, nameBytes.length, true);
    v.setUint16(30, 0, true); v.setUint16(32, 0, true);
    v.setUint16(34, 0, true); v.setUint16(36, 0, true);
    v.setUint32(38, 0, true);
    v.setUint32(42, offset, true);
    h.set(nameBytes, 46);
    return h;
  }

  private createEndOfCentralDirectory(entries: number, cdSize: number, cdOffset: number): Uint8Array {
    const r = new Uint8Array(22);
    const v = new DataView(r.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(4, 0, true); v.setUint16(6, 0, true);
    v.setUint16(8, entries, true);
    v.setUint16(10, entries, true);
    v.setUint32(12, cdSize, true);
    v.setUint32(16, cdOffset, true);
    v.setUint16(20, 0, true);
    return r;
  }

  private updateCRC32(crc: number, data: Uint8Array): number {
    const t = StreamingZipWriter.getCRCTable();
    for (let i = 0; i < data.length; i++) crc = t[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return crc;
  }

  private calculateCRC32(data: Uint8Array): number {
    return (this.updateCRC32(0xffffffff, data) ^ 0xffffffff) >>> 0;
  }

  private static crcTable: Uint32Array | null = null;
  private static getCRCTable(): Uint32Array {
    if (StreamingZipWriter.crcTable) return StreamingZipWriter.crcTable;
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return (StreamingZipWriter.crcTable = t);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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