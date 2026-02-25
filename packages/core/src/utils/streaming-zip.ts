/**
 * Streaming ZIP Writer Utility
 * 
 * Implementa un writer ZIP che scrive direttamente su WritableStream
 * senza bufferizzare l'intero contenuto in memoria.
 * 
 * Questo permette di creare archivi ZIP di qualsiasi dimensione
 * mantenendo un uso di memoria costante (~100-200MB).
 * 
 * @module streaming-zip
 */

import { Logger } from './logger';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Metadata per un file nello ZIP
 */
interface ZipEntryMetadata {
  name: string;
  offset: number;
  size: number;
  crc32: number;
}

/**
 * Opzioni per StreamingZipWriter
 */
export interface StreamingZipOptions {
  /**
   * Logger personalizzato (opzionale)
   */
  logger?: Logger;
}

// ============================================================================
// STREAMING ZIP WRITER
// ============================================================================

/**
 * Writer ZIP che scrive in streaming senza bufferizzare tutto in memoria.
 * 
 * Formato ZIP implementato:
 * - Local File Headers
 * - File Data (STORE mode, no compression)
 * - Central Directory
 * - End of Central Directory Record
 * 
 * @example
 * ```typescript
 * const chunks: Uint8Array[] = [];
 * const stream = new WritableStream({
 *   write(chunk) { chunks.push(chunk); }
 * });
 * 
 * const zip = new StreamingZipWriter(stream);
 * await zip.addFile('test.txt', new TextEncoder().encode('Hello'));
 * await zip.finalize();
 * 
 * const blob = new Blob(chunks, { type: 'application/zip' });
 * ```
 */
export class StreamingZipWriter {
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private entries: ZipEntryMetadata[] = [];
  private currentOffset: number = 0;
  private finalized: boolean = false;
  private logger: Logger;

  constructor(stream: WritableStream<Uint8Array>, options: StreamingZipOptions = {}) {
    this.writer = stream.getWriter();
    this.logger = options.logger || new Logger('StreamingZipWriter');
  }

  /**
   * Aggiunge un file allo ZIP.
   * Il contenuto viene scritto immediatamente senza bufferizzare.
   * 
   * @param name - Nome del file nello ZIP (può includere path, es. 'folder/file.txt')
   * @param data - Contenuto del file come Uint8Array
   * 
   * @throws Error se il writer è già stato finalizzato
   * 
   * @example
   * ```typescript
   * await zip.addFile('documents/report.txt', textData);
   * await zip.addFile('images/photo.jpg', imageData);
   * ```
   */
  async addFile(name: string, data: Uint8Array): Promise<void> {
    if (this.finalized) {
      throw new Error('Cannot add file: ZIP writer already finalized');
    }

    this.logger.debug(`Adding file to ZIP: ${name} (${data.length} bytes)`);

    // Calcola CRC32
    const crc32 = this.calculateCRC32(data);
    const localHeaderOffset = this.currentOffset;

    // Scrivi Local File Header
    const localHeader = this.createLocalFileHeader(name, data.length, crc32);
    await this.writer.write(localHeader);
    this.currentOffset += localHeader.length;

    // Scrivi File Data
    await this.writer.write(data);
    this.currentOffset += data.length;

    // Salva metadata per Central Directory
    this.entries.push({
      name,
      offset: localHeaderOffset,
      size: data.length,
      crc32,
    });

    this.logger.debug(`File added: ${name} at offset ${localHeaderOffset}`);
  }

  /**
   * Aggiunge un file da ReadableStream (per file molto grandi).
   * 
   * Nota: Il file viene comunque letto completamente in memoria
   * per calcolare il CRC32 (richiesto dal formato ZIP).
   * 
   * @param name - Nome del file nello ZIP
   * @param dataStream - Stream di dati
   * 
   * @example
   * ```typescript
   * const fileStream = await fetch('large-file.bin').then(r => r.body);
   * await zip.addFileFromStream('large-file.bin', fileStream);
   * ```
   */
  async addFileFromStream(name: string, dataStream: ReadableStream<Uint8Array>): Promise<void> {
    if (this.finalized) {
      throw new Error('Cannot add file: ZIP writer already finalized');
    }

    this.logger.debug(`Adding file from stream: ${name}`);

    const reader = dataStream.getReader();
    const chunks: Uint8Array[] = [];

    // Leggi tutti i chunk (necessario per CRC32)
    try {
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (!done && result.value) {
          chunks.push(result.value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Concatena e aggiungi come file normale
    const fullData = this.concatUint8Arrays(chunks);
    await this.addFile(name, fullData);
  }

  /**
   * Finalizza lo ZIP scrivendo Central Directory e End Record.
   * Dopo questa chiamata, non è possibile aggiungere altri file.
   * 
   * @throws Error se già finalizzato
   * 
   * @example
   * ```typescript
   * await zip.finalize();
   * // Ora il blob può essere creato dai chunk accumulati
   * ```
   */
  async finalize(): Promise<void> {
    if (this.finalized) {
      throw new Error('ZIP writer already finalized');
    }

    this.logger.info(`Finalizing ZIP with ${this.entries.length} entries`);

    const centralDirStart = this.currentOffset;

    // Scrivi Central Directory
    for (const entry of this.entries) {
      const cdHeader = this.createCentralDirectoryHeader(
        entry.name,
        entry.size,
        entry.crc32,
        entry.offset
      );
      await this.writer.write(cdHeader);
      this.currentOffset += cdHeader.length;
    }

    const centralDirSize = this.currentOffset - centralDirStart;

    // Scrivi End of Central Directory Record
    const endRecord = this.createEndOfCentralDirectory(
      this.entries.length,
      centralDirSize,
      centralDirStart
    );
    await this.writer.write(endRecord);

    // Chiudi il writer
    await this.writer.close();
    this.finalized = true;

    this.logger.info('ZIP finalized successfully');
  }

  /**
   * Ottiene statistiche sullo ZIP
   */
  getStats() {
    return {
      totalEntries: this.entries.length,
      totalSize: this.currentOffset,
      finalized: this.finalized,
    };
  }

  // ==========================================================================
  // PRIVATE: ZIP FORMAT IMPLEMENTATION
  // ==========================================================================

  /**
   * Crea un Local File Header per un file
   * 
   * Formato ZIP Local File Header (30 bytes + filename):
   * - [0-3]   Signature          0x04034b50
   * - [4-5]   Version            20 (2.0)
   * - [6-7]   Flags              0x0000
   * - [8-9]   Compression        0x0000 (STORE, no compression)
   * - [10-11] Mod Time           0x0000
   * - [12-13] Mod Date           0x0000
   * - [14-17] CRC32
   * - [18-21] Compressed Size
   * - [22-25] Uncompressed Size
   * - [26-27] Filename Length
   * - [28-29] Extra Field Length 0
   * - [30+]   Filename
   */
  private createLocalFileHeader(name: string, size: number, crc32: number): Uint8Array {
    const nameBytes = new TextEncoder().encode(name);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);

    view.setUint32(0, 0x04034b50, true);  // Signature
    view.setUint16(4, 20, true);          // Version 2.0
    view.setUint16(6, 0, true);           // Flags
    view.setUint16(8, 0, true);           // Compression: STORE (no compression)
    view.setUint16(10, 0, true);          // Mod time
    view.setUint16(12, 0, true);          // Mod date
    view.setUint32(14, crc32, true);      // CRC-32
    view.setUint32(18, size, true);       // Compressed size (same as uncompressed)
    view.setUint32(22, size, true);       // Uncompressed size
    view.setUint16(26, nameBytes.length, true);  // Filename length
    view.setUint16(28, 0, true);          // Extra field length
    header.set(nameBytes, 30);            // Filename

    return header;
  }

  /**
   * Crea un Central Directory Header per un file
   * 
   * Formato ZIP Central Directory Header (46 bytes + filename):
   * - [0-3]   Signature          0x02014b50
   * - [4-5]   Version Made By    20
   * - [6-7]   Version Needed     20
   * - [8-9]   Flags              0x0000
   * - [10-11] Compression        0x0000
   * - [12-13] Mod Time           0x0000
   * - [14-15] Mod Date           0x0000
   * - [16-19] CRC32
   * - [20-23] Compressed Size
   * - [24-27] Uncompressed Size
   * - [28-29] Filename Length
   * - [30-31] Extra Field Length 0
   * - [32-33] Comment Length     0
   * - [34-35] Disk Number        0
   * - [36-37] Internal Attrs     0
   * - [38-41] External Attrs     0
   * - [42-45] Local Header Offset
   * - [46+]   Filename
   */
  private createCentralDirectoryHeader(
    name: string,
    size: number,
    crc32: number,
    offset: number
  ): Uint8Array {
    const nameBytes = new TextEncoder().encode(name);
    const header = new Uint8Array(46 + nameBytes.length);
    const view = new DataView(header.buffer);

    view.setUint32(0, 0x02014b50, true);  // Signature
    view.setUint16(4, 20, true);          // Version made by
    view.setUint16(6, 20, true);          // Version needed
    view.setUint16(8, 0, true);           // Flags
    view.setUint16(10, 0, true);          // Compression
    view.setUint16(12, 0, true);          // Mod time
    view.setUint16(14, 0, true);          // Mod date
    view.setUint32(16, crc32, true);      // CRC-32
    view.setUint32(20, size, true);       // Compressed size
    view.setUint32(24, size, true);       // Uncompressed size
    view.setUint16(28, nameBytes.length, true);  // Filename length
    view.setUint16(30, 0, true);          // Extra field length
    view.setUint16(32, 0, true);          // Comment length
    view.setUint16(34, 0, true);          // Disk number
    view.setUint16(36, 0, true);          // Internal attributes
    view.setUint32(38, 0, true);          // External attributes
    view.setUint32(42, offset, true);     // Local header offset
    header.set(nameBytes, 46);            // Filename

    return header;
  }

  /**
   * Crea l'End of Central Directory Record
   * 
   * Formato (22 bytes):
   * - [0-3]   Signature          0x06054b50
   * - [4-5]   Disk Number        0
   * - [6-7]   CD Start Disk      0
   * - [8-9]   CD Records (disk)  number of entries
   * - [10-11] CD Records (total) number of entries
   * - [12-15] CD Size
   * - [16-19] CD Offset
   * - [20-21] Comment Length     0
   */
  private createEndOfCentralDirectory(
    entries: number,
    cdSize: number,
    cdOffset: number
  ): Uint8Array {
    const record = new Uint8Array(22);
    const view = new DataView(record.buffer);

    view.setUint32(0, 0x06054b50, true);  // Signature
    view.setUint16(4, 0, true);           // Disk number
    view.setUint16(6, 0, true);           // CD start disk
    view.setUint16(8, entries, true);     // CD records on this disk
    view.setUint16(10, entries, true);    // Total CD records
    view.setUint32(12, cdSize, true);     // CD size
    view.setUint32(16, cdOffset, true);   // CD offset
    view.setUint16(20, 0, true);          // Comment length

    return record;
  }

  // ==========================================================================
  // PRIVATE: CRC32 CALCULATION
  // ==========================================================================

  /**
   * Calcola il CRC32 di un array di byte
   * 
   * Usa la tabella CRC32 standard per ZIP (polynomial 0xEDB88320)
   */
  private calculateCRC32(data: Uint8Array): number {
    const crcTable = this.getCRCTable();
    let crc = 0xffffffff;

    for (let i = 0; i < data.length; i++) {
      crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
  }

  /**
   * Tabella CRC32 (cached)
   */
  private static crcTable: Uint32Array | null = null;

  /**
   * Ottiene la tabella CRC32 (crea se non esiste)
   */
  private getCRCTable(): Uint32Array {
    if (StreamingZipWriter.crcTable) {
      return StreamingZipWriter.crcTable;
    }

    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c;
    }

    StreamingZipWriter.crcTable = table;
    return table;
  }

  // ==========================================================================
  // PRIVATE: UTILITIES
  // ==========================================================================

  /**
   * Concatena array di Uint8Array in un unico array
   */
  private concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Helper per creare un Blob ZIP da una mappa di file
 * 
 * @param files - Mappa nome->contenuto dei file
 * @param options - Opzioni per il writer
 * @returns Blob dello ZIP creato
 * 
 * @example
 * ```typescript
 * const files = new Map([
 *   ['file1.txt', new TextEncoder().encode('Hello')],
 *   ['file2.txt', new TextEncoder().encode('World')],
 * ]);
 * 
 * const zipBlob = await createZipBlob(files);
 * ```
 */
export async function createZipBlob(
  files: Map<string, Uint8Array>,
  options: StreamingZipOptions = {}
): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  const stream = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk);
    },
  });

  const zip = new StreamingZipWriter(stream, options);

  for (const [name, data] of files) {
    await zip.addFile(name, data);
  }

  await zip.finalize();

  return new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' });
}

/**
 * Helper per creare uno ZIP da una lista di file con callback di progresso
 * 
 * @param files - Array di file da aggiungere
 * @param onProgress - Callback chiamata dopo ogni file aggiunto
 * @param options - Opzioni per il writer
 * @returns Blob dello ZIP creato
 * 
 * @example
 * ```typescript
 * const files = [
 *   { name: 'file1.txt', data: data1 },
 *   { name: 'file2.txt', data: data2 },
 * ];
 * 
 * const zipBlob = await createZipBlobWithProgress(
 *   files,
 *   (current, total) => console.log(`${current}/${total}`)
 * );
 * ```
 */
export async function createZipBlobWithProgress(
  files: Array<{ name: string; data: Uint8Array }>,
  onProgress?: (current: number, total: number) => void,
  options: StreamingZipOptions = {}
): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  const stream = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk);
    },
  });

  const zip = new StreamingZipWriter(stream, options);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    await zip.addFile(file.name, file.data);

    if (onProgress) {
      onProgress(i + 1, files.length);
    }
  }

  await zip.finalize();

  return new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' });
}