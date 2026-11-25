/**
 * ZIP64 tests for StreamingZipWriter, verified with independent readers.
 *
 * The three overflow conditions from the design (chapter 2) are covered:
 *   (a) a single entry larger than 4 GiB;
 *   (b) several entries < 4 GiB that push the central directory beyond 4 GiB;
 *   (c) more than 65 535 entries.
 * (a) and (b) write > 4 GiB to disk and run only with WAFB_LARGE_TESTS=1.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { crc32 as zlibCrc32 } from 'node:zlib';
import path from 'node:path';
import { StreamingZipWriter, crc32Of } from '../../../src/utils/streaming-zip';
import {
  fileSink,
  hasTool,
  infoZipTest,
  makeTempDir,
  pythonZipInspect,
} from '../../helpers/independent-tools';

const HAVE_PY = hasTool('python3');
const HAVE_UNZIP = hasTool('unzip');
const LARGE = process.env.WAFB_LARGE_TESTS === '1';

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

function pattern(n: number, seed = 1): Uint8Array {
  const b = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) { x = (x * 1664525 + 1013904223) >>> 0; b[i] = x >>> 24; }
  return b;
}

/** A stream of `total` bytes made by repeating `block`; sha256 computed on the fly. */
function repeatingStream(total: number, block: Uint8Array) {
  const h = createHash('sha256');
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= total) { c.close(); return; }
      const n = Math.min(block.length, total - sent);
      const chunk = n === block.length ? block : block.subarray(0, n);
      h.update(chunk);
      sent += n;
      c.enqueue(chunk);
    },
  });
  return { stream, digest: () => h.digest('hex') };
}

let tmp: { dir: string; cleanup: () => Promise<void> };
beforeAll(async () => { tmp = await makeTempDir('wafb-zip64-'); });
afterAll(async () => { await tmp.cleanup(); });

describe('CRC32', () => {
  it('slice-by-8 implementation matches zlib on irregular lengths', () => {
    for (const n of [0, 1, 7, 8, 9, 63, 64, 65, 1000, 65537]) {
      const d = pattern(n, n + 3);
      expect(crc32Of(d)).toBe(zlibCrc32(d) >>> 0);
    }
  });
});

describe.skipIf(!HAVE_PY || !HAVE_UNZIP)('StreamingZipWriter — independent readers', () => {
  it('writes ZIP64-ready streamed entries that Python and Info-ZIP accept', async () => {
    const file = path.join(tmp.dir, 'mixed.zip');
    const zip = new StreamingZipWriter(await fileSink(file));
    const small = new TextEncoder().encode('{"hello":"world"}');
    await zip.addFile('descriptor.json', small);
    const big = repeatingStream(3 * MiB + 17, pattern(64 * 1024));
    await zip.addFileFromStream('a000001.age', big.stream);
    const empty = repeatingStream(0, new Uint8Array(1));
    await zip.addFileFromStream('a000002.age', empty.stream);
    await zip.addFile('dir/città-ü.txt', new TextEncoder().encode('utf-8 name'));
    const res = await zip.finalize();
    expect(res.zip64).toBe(true);

    const py = pythonZipInspect(file);
    expect(py.testzip).toBeNull();
    const byName = Object.fromEntries(py.entries.map(e => [e.name, e]));
    expect(byName['a000001.age'].size).toBe(3 * MiB + 17);
    expect(byName['a000001.age'].sha256).toBe(big.digest());
    expect(byName['a000001.age'].extract_version).toBe(45);
    expect(byName['a000001.age'].flag_bits & 0x0808).toBe(0x0808); // descriptor + UTF-8
    expect(byName['a000002.age'].size).toBe(0);
    expect(byName['descriptor.json'].sha256).toBe(createHash('sha256').update(small).digest('hex'));
    expect(byName['dir/città-ü.txt']).toBeDefined();

    const iz = infoZipTest(file);
    expect(iz.status, iz.summary).toBe(0);
  });

  it('(c) more than 65 535 entries → ZIP64 end-of-central-directory', async () => {
    const file = path.join(tmp.dir, 'many.zip');
    const zip = new StreamingZipWriter(await fileSink(file));
    const N = 65_540;
    const one = new Uint8Array([42]);
    for (let i = 0; i < N; i++) {
      await zip.addFile(`e${String(i).padStart(6, '0')}`, one);
    }
    const res = await zip.finalize();
    expect(res.entries).toBe(N);

    const py = pythonZipInspect(file, { hash: false });
    expect(py.zip64_eocd).toBe(true);
    expect(py.entries.length).toBe(N);
    expect(py.testzip).toBeNull();
    expect(infoZipTest(file).status).toBe(0);
  }, 120_000);
});

describe('StreamingZipWriter — failure semantics', () => {
  it('poisons the writer when the source errors mid-entry; no central directory is written', async () => {
    const written: Uint8Array[] = [];
    let aborted = false;
    const sink = new WritableStream<Uint8Array>({
      write(c) { written.push(c); },
      abort() { aborted = true; },
    });
    const zip = new StreamingZipWriter(sink);
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const src = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
    const p = zip.addFileFromStream('a000001.age', src);
    ctrl.enqueue(new Uint8Array(100));
    await new Promise(r => setTimeout(r, 0));
    ctrl.error(new Error('USB disconnected'));
    await expect(p).rejects.toThrow('USB disconnected');
    expect(zip.getState()).toBe('failed');
    expect(aborted).toBe(true);
    await expect(zip.addFile('x', new Uint8Array(1))).rejects.toThrow(/failed/);
    await expect(zip.finalize()).rejects.toThrow(/failed/);
  });

  it('propagates a sink rejection (e.g. disk full) and cancels the source', async () => {
    let cancelled: unknown = null;
    const src = new ReadableStream<Uint8Array>({
      pull(c) { c.enqueue(new Uint8Array(1024)); },
      cancel(r) { cancelled = r; },
    });
    let n = 0;
    const sink = new WritableStream<Uint8Array>({
      write() { if (++n > 3) throw new Error('QuotaExceededError'); },
    });
    const zip = new StreamingZipWriter(sink);
    await expect(zip.addFileFromStream('a', src)).rejects.toThrow('QuotaExceededError');
    expect(cancelled).toBeTruthy();
  });

  it('finalize() resolves only after the sink confirms close', async () => {
    let closeConfirmed = false;
    const sink = new WritableStream<Uint8Array>({
      async close() { await new Promise(r => setTimeout(r, 20)); closeConfirmed = true; },
    });
    const zip = new StreamingZipWriter(sink);
    await zip.addFile('m', new Uint8Array(1));
    await zip.finalize();
    expect(closeConfirmed).toBe(true);
  });

  it('a failing close is not reported as a saved archive', async () => {
    const sink = new WritableStream<Uint8Array>({ close() { throw new Error('close failed'); } });
    const zip = new StreamingZipWriter(sink);
    await zip.addFile('m', new Uint8Array(1));
    await expect(zip.finalize()).rejects.toThrow('close failed');
    expect(zip.getState()).toBe('failed');
  });

  it('rejects duplicate names and path traversal', async () => {
    const zip = new StreamingZipWriter(new WritableStream());
    await zip.addFile('a', new Uint8Array(1));
    await expect(zip.addFile('a', new Uint8Array(1))).rejects.toThrow(/Duplicate/);
    await expect(zip.addFile('../evil', new Uint8Array(1))).rejects.toThrow(/Invalid/);
    await expect(zip.addFile('/abs', new Uint8Array(1))).rejects.toThrow(/Invalid/);
  });
});

describe.skipIf(!LARGE || !HAVE_PY || !HAVE_UNZIP)('ZIP64 large archives (WAFB_LARGE_TESTS=1)', () => {
  it('(a) single streamed entry larger than 4 GiB', async () => {
    const file = path.join(tmp.dir, 'single-4g.zip');
    const zip = new StreamingZipWriter(await fileSink(file));
    const total = 4 * GiB + 3 * MiB + 5;
    const src = repeatingStream(total, pattern(4 * MiB, 9));
    await zip.addFileFromStream('a000001.age', src.stream);
    await zip.finalize();

    const py = pythonZipInspect(file);
    expect(py.testzip).toBeNull();
    expect(py.entries[0].size).toBe(total);
    expect(py.entries[0].sha256).toBe(src.digest());
    expect(infoZipTest(file).status).toBe(0);
  }, 30 * 60_000);

  it('(b) entries < 4 GiB each, central directory beyond 4 GiB', async () => {
    const file = path.join(tmp.dir, 'two-2g.zip');
    const zip = new StreamingZipWriter(await fileSink(file));
    const each = 2 * GiB + 7 * MiB;
    const s1 = repeatingStream(each, pattern(4 * MiB, 11));
    const s2 = repeatingStream(each, pattern(4 * MiB, 12));
    await zip.addFileFromStream('a000001.age', s1.stream);
    await zip.addFileFromStream('a000002.age', s2.stream);
    await zip.addFile('manifest.age', new Uint8Array(100));
    await zip.finalize();
    expect(zip.getEntries()[2].offset).toBeGreaterThan(4 * GiB);

    const py = pythonZipInspect(file);
    expect(py.testzip).toBeNull();
    expect(py.zip64_eocd).toBe(true);
    expect(py.entries.map(e => e.sha256).slice(0, 2)).toEqual([s1.digest(), s2.digest()]);
    expect(infoZipTest(file).status).toBe(0);
  }, 30 * 60_000);
});
