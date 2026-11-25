/**
 * Helpers that run *independent* implementations (Python zipfile, Info-ZIP,
 * the reference `age` CLI) against artefacts produced by WAFB. A test in which
 * the same component writes and reads a format can share the same mistake;
 * these helpers avoid that.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { open, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const FIXTURES = path.resolve(__dirname, '../fixtures');

export function hasTool(cmd: string): boolean {
  return spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
}

export async function makeTempDir(prefix = 'wafb-test-'): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** A WHATWG WritableStream backed by a real file, like a File System Access sink. */
export async function fileSink(file: string): Promise<WritableStream<Uint8Array>> {
  const fh = await open(file, 'w');
  return new WritableStream<Uint8Array>({
    async write(chunk) {
      let off = 0;
      while (off < chunk.byteLength) {
        const { bytesWritten } = await fh.write(chunk, off, chunk.byteLength - off);
        off += bytesWritten;
      }
    },
    async close() { await fh.close(); },
    async abort() { await fh.close(); },
  });
}

export interface PyZipEntry {
  name: string;
  size: number;
  crc: number;
  sha256?: string;
  flag_bits: number;
  extract_version: number;
}

export function pythonZipInspect(archive: string, { hash = true } = {}): {
  entries: PyZipEntry[];
  zip64_eocd: boolean;
  testzip: string | null;
} {
  const args = ['-I', path.join(FIXTURES, 'verify_zip.py'), archive];
  if (!hash) args.push('--no-hash');
  const out = execFileSync('python3', args, { maxBuffer: 256 * 1024 * 1024 });
  return JSON.parse(out.toString());
}

/** Info-ZIP `unzip -t`: returns exit status and the last line of output. */
export function infoZipTest(archive: string): { status: number; summary: string } {
  const r = spawnSync('unzip', ['-tqq', archive], { maxBuffer: 64 * 1024 * 1024 });
  const text = `${r.stdout?.toString() ?? ''}${r.stderr?.toString() ?? ''}`.trim();
  return { status: r.status ?? -1, summary: text.split('\n').slice(-1)[0] ?? '' };
}

/** Extracts one entry with Python's zipfile (independent of the writer). */
export function pythonZipRead(archive: string, entry: string): Buffer {
  return execFileSync(
    'python3',
    ['-I', '-c', 'import sys,zipfile; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))', archive, entry],
    { maxBuffer: 512 * 1024 * 1024 }
  );
}

/** Decrypts with the reference `age` CLI. Returns null if age refuses the file. */
export function ageDecrypt(identityFile: string, ciphertext: Uint8Array): Buffer | null {
  const r = spawnSync('age', ['-d', '-i', identityFile], { input: ciphertext, maxBuffer: 512 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}
