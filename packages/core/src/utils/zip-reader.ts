/**
 * Minimal ZIP / ZIP64 reader for the analyst-side verifier.
 *
 * Reads the central directory of an archive exposed as a Blob (a browser File
 * or `fs.openAsBlob` in Node) and returns entries whose data can be streamed
 * without loading the archive into memory. Only what WAFB archives use is
 * supported (STORE, no encryption, single disk); anything else is reported,
 * not guessed.
 *
 * Defensive rules (chapter 2): absolute paths, `..` components, backslashes,
 * NUL bytes and duplicate names are rejected; entry count and directory size
 * are bounded; local headers must agree with the central directory.
 */

export class ZipFormatError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ZipFormatError';
  }
}

export interface ZipReaderEntry {
  name: string;
  /** Stored size (STORE: equal to uncompressed size). */
  size: number;
  crc32: number;
  method: number;
  flags: number;
  localHeaderOffset: number;
  /** Offset of the first data byte, resolved from the local header. */
  dataOffset: number;
}

export interface ZipReaderOptions {
  maxEntries?: number;
  maxCentralDirectoryBytes?: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;

async function readRange(blob: Blob, start: number, end: number): Promise<DataView> {
  if (start < 0 || end > blob.size || start > end) {
    throw new ZipFormatError('out-of-range', 'Archive structure points outside the file.');
  }
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

function u64(v: DataView, at: number): number {
  const n = v.getBigUint64(at, true);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipFormatError('too-large', 'Value exceeds safe integer range.');
  return Number(n);
}

export function isSafeEntryName(name: string): boolean {
  if (name.length === 0 || name.length > 1024) return false;
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  if (name.includes('\\') || name.includes('\0')) return false;
  return !name.split('/').some(p => p === '..' || p === '.');
}

export async function readZipDirectory(blob: Blob, opts: ZipReaderOptions = {}): Promise<ZipReaderEntry[]> {
  const maxEntries = opts.maxEntries ?? 100_000;
  const maxCd = opts.maxCentralDirectoryBytes ?? 64 * 1024 * 1024;
  if (blob.size < 22) throw new ZipFormatError('too-small', 'Not a ZIP archive (too small).');

  // ── locate EOCD (comment ≤ 65 535 bytes) ──
  const tailStart = Math.max(0, blob.size - (22 + 0xffff));
  const tail = await readRange(blob, tailStart, blob.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipFormatError('no-eocd', 'End of central directory not found (archive truncated or not a ZIP).');

  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);
  if (tail.getUint16(eocd + 4, true) !== 0 || tail.getUint16(eocd + 6, true) !== 0) {
    throw new ZipFormatError('multi-disk', 'Multi-disk archives are not supported.');
  }

  // ── ZIP64 ──
  const eocdAbs = tailStart + eocd;
  if (count === MAX_U16 || cdSize === MAX_U32 || cdOffset === MAX_U32) {
    if (eocdAbs < 20) throw new ZipFormatError('no-zip64-locator', 'ZIP64 locator missing.');
    const loc = await readRange(blob, eocdAbs - 20, eocdAbs);
    if (loc.getUint32(0, true) !== SIG_ZIP64_LOCATOR) throw new ZipFormatError('no-zip64-locator', 'ZIP64 locator missing.');
    const z64Off = u64(loc, 8);
    const z = await readRange(blob, z64Off, z64Off + 56);
    if (z.getUint32(0, true) !== SIG_ZIP64_EOCD) throw new ZipFormatError('bad-zip64-eocd', 'ZIP64 end record not found.');
    count = u64(z, 32);
    cdSize = u64(z, 40);
    cdOffset = u64(z, 48);
  }

  if (count > maxEntries) throw new ZipFormatError('too-many-entries', `Archive has ${count} entries (limit ${maxEntries}).`);
  if (cdSize > maxCd) throw new ZipFormatError('cd-too-large', 'Central directory is too large.');

  const cd = await readRange(blob, cdOffset, cdOffset + cdSize);
  const entries: ZipReaderEntry[] = [];
  const names = new Set<string>();
  const dec = new TextDecoder('utf-8', { fatal: true });
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== SIG_CENTRAL) {
      throw new ZipFormatError('bad-cd', 'Central directory is malformed.');
    }
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    const crc32 = cd.getUint32(p + 16, true);
    let csize = cd.getUint32(p + 20, true);
    let usize = cd.getUint32(p + 24, true);
    const nlen = cd.getUint16(p + 28, true);
    const xlen = cd.getUint16(p + 30, true);
    const clen = cd.getUint16(p + 32, true);
    let offset = cd.getUint32(p + 42, true);
    let name: string;
    try {
      name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
    } catch {
      throw new ZipFormatError('bad-name', 'An entry name is not valid UTF-8.');
    }
    // ZIP64 extra
    let x = p + 46 + nlen;
    const xend = x + xlen;
    while (x + 4 <= xend) {
      const id = cd.getUint16(x, true);
      const len = cd.getUint16(x + 2, true);
      if (id === 0x0001) {
        let q = x + 4;
        if (usize === MAX_U32) { usize = u64(cd, q); q += 8; }
        if (csize === MAX_U32) { csize = u64(cd, q); q += 8; }
        if (offset === MAX_U32) { offset = u64(cd, q); }
      }
      x += 4 + len;
    }
    p = xend + clen;

    if (!isSafeEntryName(name)) throw new ZipFormatError('unsafe-name', 'The archive contains an unsafe entry name.');
    if (names.has(name)) throw new ZipFormatError('duplicate-name', 'The archive contains duplicate entry names.');
    names.add(name);
    if (flags & 0x0001) throw new ZipFormatError('zip-encrypted', 'ZIP-level encryption is not supported.');
    if (method !== 0) throw new ZipFormatError('unsupported-method', 'Only STORE entries are supported.');
    if (csize !== usize) throw new ZipFormatError('size-mismatch', 'Stored and original size differ for a STORE entry.');

    entries.push({ name, size: csize, crc32, method, flags, localHeaderOffset: offset, dataOffset: -1 });
  }

  // Resolve data offsets from local headers and check they match.
  for (const e of entries) {
    const lh = await readRange(blob, e.localHeaderOffset, e.localHeaderOffset + 30);
    if (lh.getUint32(0, true) !== SIG_LOCAL) throw new ZipFormatError('bad-local-header', 'A local header is missing.');
    const ln = lh.getUint16(26, true);
    const lx = lh.getUint16(28, true);
    const lname = await blob.slice(e.localHeaderOffset + 30, e.localHeaderOffset + 30 + ln).arrayBuffer();
    if (dec.decode(lname) !== e.name) throw new ZipFormatError('name-mismatch', 'Local header and directory disagree on a name.');
    e.dataOffset = e.localHeaderOffset + 30 + ln + lx;
    if (e.dataOffset + e.size > blob.size) throw new ZipFormatError('out-of-range', 'An entry extends beyond the end of the file.');
  }
  return entries;
}

/** Streams the stored bytes of an entry. */
export function entryStream(blob: Blob, e: ZipReaderEntry): ReadableStream<Uint8Array> {
  return blob.slice(e.dataOffset, e.dataOffset + e.size).stream() as ReadableStream<Uint8Array>;
}

export async function entryBytes(blob: Blob, e: ZipReaderEntry, maxBytes: number): Promise<Uint8Array> {
  if (e.size > maxBytes) throw new ZipFormatError('entry-too-large', `Entry ${e.name} exceeds ${maxBytes} bytes.`);
  return new Uint8Array(await blob.slice(e.dataOffset, e.dataOffset + e.size).arrayBuffer());
}
