/**
 * Benchmark harness (not part of the application bundle).
 *
 * Runs the same synthetic acquisition through different pipelines inside the
 * browser, writing to an OPFS FileSystemWritableFileStream — the same sink
 * type used by the real save dialog. Driven by bench/run_bench.py.
 *
 * Configurations
 *   b031-nohash    WAFB 0.3.1 ZIP writer, no hashing (0.3.1 wizard)
 *   b031-hash      WAFB 0.3.1 ZIP writer + 0.3.1 hashingPassthrough (0.3.1 advanced page)
 *   legacy         new coordinator, legacy mode (SHA-256, no encryption, ZIP64)
 *   protected      new coordinator, protected mode (SHA-256 + age + ZIP64 + archive digest)
 *   protected-nad  protected without the archive digest (isolates the delivery-reference cost)
 *   age-raw        ablation: source → Typage Encrypter → sink (no rechunk)
 *   age-rechunk    ablation: source → rechunk(64 KiB) → Typage Encrypter → sink
 */
import {
  SessionCoordinator,
  generateX25519Identity,
  identityToRecipient,
  validateRecipient,
  verifyArchive,
} from '@wafb/core';
import type { AcquisitionFile, ModuleTask, SessionConfig, SourceOutcome } from '@wafb/core';
import { Encrypter } from 'age-encryption';
import { rechunk } from '@wafb/core';
import { StreamingZipWriter031 } from './baseline031-zip';
import { hashingPassthrough031 } from './baseline031-hash';

type Mode = 'b031-nohash' | 'b031-hash' | 'legacy' | 'protected' | 'protected-nad' | 'age-raw' | 'age-rechunk';

interface BenchParams {
  mode: Mode;
  totalBytes: number;
  chunkBytes: number;
  entries: number;
  verify?: boolean;
}

interface BenchResult {
  mode: Mode;
  totalBytes: number;
  chunkBytes: number;
  entries: number;
  ms: number;
  outputBytes: number;
  heapPeak: number | null;
  heapStart: number | null;
  state?: string;
  verifyMs?: number;
  verdict?: string;
}

let block: Uint8Array | null = null;
function sourceBlock(size: number): Uint8Array {
  if (block && block.length === size) return block;
  const b = new Uint8Array(size);
  for (let o = 0; o < size; o += 65536) crypto.getRandomValues(b.subarray(o, Math.min(o + 65536, size)));
  return (block = b);
}

/** Synthetic device source: `total` bytes in `chunk`-sized chunks, then EOF + exit 0. */
function syntheticSource(total: number, chunk: number): { stream: ReadableStream<Uint8Array>; outcome: Promise<SourceOutcome> } {
  const b = sourceBlock(chunk);
  let sent = 0;
  let resolve!: (o: SourceOutcome) => void;
  const outcome = new Promise<SourceOutcome>(r => (resolve = r));
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        if (sent >= total) {
          c.close();
          resolve({ cause: 'eof', bytes: total, exitCode: 0 });
          return;
        }
        const n = Math.min(chunk, total - sent);
        c.enqueue(n === b.length ? b : b.subarray(0, n));
        sent += n;
      },
    },
    { highWaterMark: 0 }
  );
  return { stream, outcome };
}

function heap(): number | null {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? m.usedJSHeapSize : null;
}

async function opfsSink(name: string) {
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry(name); } catch { /* absent */ }
  const fh = await root.getFileHandle(name, { create: true });
  const writable = (await fh.createWritable()) as unknown as WritableStream<Uint8Array>;
  return { fh, writable, root };
}

let identityCache: { identity: string; recipient: Awaited<ReturnType<typeof validateRecipient>> } | null = null;
async function keys() {
  if (!identityCache) {
    const identity = await generateX25519Identity();
    identityCache = { identity, recipient: await validateRecipient(await identityToRecipient(identity)) };
  }
  return identityCache;
}

async function runBench(p: BenchParams): Promise<BenchResult> {
  const per = Math.floor(p.totalBytes / p.entries);
  const sizes = Array.from({ length: p.entries }, (_, i) => (i === p.entries - 1 ? p.totalBytes - per * (p.entries - 1) : per));
  const name = `bench-${p.mode}.zip`;
  const { fh, writable, root } = await opfsSink(name);
  const k = p.mode.startsWith('protected') || p.mode.startsWith('age-') ? await keys() : null;
  sourceBlock(p.chunkBytes);

  let heapPeak = heap();
  const heapStart = heapPeak;
  const sampler = setInterval(() => { const h = heap(); if (h !== null && (heapPeak === null || h > heapPeak)) heapPeak = h; }, 50);
  const t0 = performance.now();
  let state: string | undefined;

  if (p.mode === 'age-raw' || p.mode === 'age-rechunk') {
    const enc = new Encrypter();
    enc.addRecipient(k!.recipient.canonical);
    let src = syntheticSource(p.totalBytes, p.chunkBytes).stream;
    if (p.mode === 'age-rechunk') src = src.pipeThrough(rechunk(64 * 1024));
    await ((await enc.encrypt(src)) as ReadableStream<Uint8Array>).pipeTo(writable);
    state = 'completed';
  } else if (p.mode === 'b031-nohash' || p.mode === 'b031-hash') {
    const zip = new StreamingZipWriter031(writable);
    for (let i = 0; i < sizes.length; i++) {
      const src = syntheticSource(sizes[i], p.chunkBytes);
      const file: AcquisitionFile = { fileName: `wafb/a${i}.bin`, fileSize: 0, stream: src.stream };
      if (p.mode === 'b031-hash') {
        const h = await hashingPassthrough031('sha-256');
        src.stream.pipeTo(h.writable).catch(() => {});
        file.stream = h.readable;
        file.hashPromise = h.hashPromise;
      }
      await zip.addAcquisitionFile(file);
    }
    await zip.addFile('wafb/manifest.json', new TextEncoder().encode('{}'));
    await zip.finalize();
    state = 'completed';
  } else {
    const files = sizes.map((s, i) => {
      const src = syntheticSource(s, p.chunkBytes);
      return { fileName: `a${i}.bin`, fileSize: 0, sizeUnknown: true, stream: src.stream, outcome: src.outcome } as AcquisitionFile;
    });
    const tasks: ModuleTask[] = [{
      module: 'backup',
      run: async () => ({ success: true, type: 'backup', files, startTime: new Date(), endTime: new Date(), duration: 0 }),
    }];
    const base = { requested: ['backup' as const], profileSource: 'operator' as const, tool: { version: 'bench' }, device: null };
    const config: SessionConfig = p.mode === 'legacy'
      ? { ...base, mode: 'legacy', folder: 'wafb' }
      : { ...base, mode: 'protected', recipient: k!.recipient, recipientConfirmation: { method: 'other-authenticated-channel', confirmedAt: new Date().toISOString() }, caseRef: 'C-BENCH0001' };
    const r = await new SessionCoordinator(config, {
      sink: writable,
      computeArchiveDigest: p.mode !== 'protected-nad',
      progressEveryBytes: 64 * 1024 * 1024,
    }).run(tasks);
    state = r.state;
  }
  const ms = performance.now() - t0;
  clearInterval(sampler);
  const file = await fh.getFile();
  const res: BenchResult = { ...p, ms, outputBytes: file.size, heapPeak, heapStart, state };

  if (p.verify && k) {
    const v0 = performance.now();
    const rep = await verifyArchive(file, { identity: k.identity });
    res.verifyMs = performance.now() - v0;
    res.verdict = rep.verdict;
  }
  await root.removeEntry(name);
  return res;
}

(window as unknown as { runBench: typeof runBench; benchReady: boolean }).runBench = runBench;
(window as unknown as { benchReady: boolean }).benchReady = true;
document.body.dataset.ready = '1';
