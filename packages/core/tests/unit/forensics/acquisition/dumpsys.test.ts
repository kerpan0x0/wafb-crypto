import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DumpsysAcquirer } from '../../../../src/forensics/acquisition/dumpsys';
import {
  createMockDeviceForAcquirer,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  makeShellResult,
  makeSpawnResult,
  readStream,
} from '../../../helpers/test-helpers';
import type { MockDevice } from '../../../helpers/test-helpers';

async function drainAndHash(result: any, fileIndex = 0): Promise<string | undefined> {
  const file = result.files?.[fileIndex] ?? result.files![fileIndex];
  if (!file?.hashPromise) return undefined;
  // Drain the stream so TransformStream.flush() fires and hashPromise resolves
  if (file.stream) {
    const reader = (file.stream as ReadableStream<Uint8Array>).getReader();
    while (!(await reader.read()).done) { }
  }
  return file.hashPromise;
}


// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_DUMPSYS_OUTPUT = `SYSTEM SERVICES:
  Battery Service:
    AC powered: true
    USB powered: true
    level: 72
    temperature: 280
  Memory Info:
    Total RAM: 5,743,616K
    Free RAM: 1,234,567K
  Package Manager:
    Packages: 287
  Activity Manager:
    Activities: 3
    Services: 45`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DumpsysAcquirer', () => {
  let device: MockDevice;
  let acquirer: DumpsysAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    device = createMockDeviceForAcquirer();

    // Default path (no computeHash) → DumpsysStreamCommand → device.spawn
    device.spawn.mockResolvedValue(makeSpawnResult(MOCK_DUMPSYS_OUTPUT));

    // computeHash path → DumpsysCommand → device.shell
    device.shell.mockResolvedValue(makeShellResult(MOCK_DUMPSYS_OUTPUT));

    domMocks = setupAcquirerDOMMocks();
    acquirer = new DumpsysAcquirer(device as any);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      expect(acquirer).toBeInstanceOf(DumpsysAcquirer);
    });

    it('should create instance with custom config', () => {
      expect(new DumpsysAcquirer(device as any, { timeout: 60000, computeHash: true }))
        .toBeInstanceOf(DumpsysAcquirer);
    });
  });

  describe('acquire', () => {
    it('should successfully acquire dumpsys output (streaming)', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.type).toBe('dumpsys');
      expect(result.files[0].fileName).toBe('dumpsys.txt');
      expect(result.files[0].fileSize).toBe(0);
      expect(result.files[0].stream).toBeDefined();
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should call device.spawn with dumpsys command (default streaming)', async () => {
      await acquirer.acquire();
      expect(device.spawn).toHaveBeenCalledWith('dumpsys');
    });

    it('should include device information in result', async () => {
      const result = await acquirer.acquire();
      expect(result.data?.deviceInfo).toBeDefined();
      expect(result.data?.deviceInfo.model).toBe('Test Device');
    });

    it('should return stream (not blob) in default mode', async () => {
      const result = await acquirer.acquire();
      expect(result.files[0].stream).toBeDefined();
      expect(result.files[0].mimeType).toBe('text/plain');
    });
  });

  describe('progress reporting', () => {
    it('should report progress during acquisition', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);
      expect(callback).toHaveBeenCalled();
      expect(getProgressHistory().length).toBeGreaterThan(2);
    });

    it('should report key progress milestones', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);
      const progressValues = getProgressHistory().map(p => p.progress);
      expect(progressValues).toContain(10);
      expect(progressValues).toContain(20);
      expect(progressValues).toContain(30);
      expect(progressValues).toContain(100);
    });

    it('should include descriptive messages', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);
      const messages = getProgressHistory().map(p => p.message);
      expect(messages.some(m => m.includes('device information'))).toBe(true);
      expect(messages.some(m => m.includes('Connected'))).toBe(true);
      expect(messages.some(m => m.includes('Collecting device diagnostic'))).toBe(true);
      expect(messages.some(m => m.includes('Streaming dumpsys'))).toBe(true);
    });
  });

  describe('configuration', () => {
    it('should use buffered mode when computeHash is true', async () => {
      const result = await new DumpsysAcquirer(device as any, { computeHash: true }).acquire();

      expect(result.success).toBe(true);
      const hash = await drainAndHash(result, 0);
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash!.length).toBeGreaterThan(0);
      // In hash mode, we still return a stream (with hash computed on the fly)
      expect(result.files[0].stream).toBeInstanceOf(ReadableStream);
      expect(result.files[0].hashPromise).toBeDefined();
    });

    it('should not compute hash when computeHash is false/undefined', async () => {
      const result = await acquirer.acquire();
      expect(await result.files[0].hashPromise).toBeUndefined();
    });

    it('should respect custom timeout', async () => {
      const result = await new DumpsysAcquirer(device as any, { timeout: 45000 }).acquire();
      expect(result.success).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle dumpsys command failure', async () => {
      device.spawn.mockRejectedValue(new Error('dumpsys failed'));
      const result = await acquirer.acquire();
      expect(result.success).toBe(false);
      expect(result.error).toContain('dumpsys failed');
    });

    it('should handle device disconnection', async () => {
      device.getProperties.mockRejectedValue(new Error('Device disconnected'));
      const result = await acquirer.acquire();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Device disconnected');
    });

    it('should handle timeout errors', async () => {
      device.spawn.mockRejectedValue(new Error('Command timed out'));
      const result = await acquirer.acquire();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/timeout|timed out/i);
    });

    it('should report failure in progress callback', async () => {
      device.getProperties.mockRejectedValue(new Error('Test error'));
      const { callback, getLastProgress } = createMockProgressCallback();
      await acquirer.acquire(callback);
      expect(getLastProgress().status).toBe('failed');
    });

    it('should still calculate duration on failure', async () => {
      device.spawn.mockRejectedValue(new Error('Failure'));
      const result = await acquirer.acquire();
      expect(result.success).toBe(false);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('result metadata', () => {
    it('should set correct acquisition type', async () => {
      expect((await acquirer.acquire()).type).toBe('dumpsys');
    });

    it('should include start and end timestamps', async () => {
      const result = await acquirer.acquire();
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
    });

    it('should calculate duration correctly', async () => {
      const result = await acquirer.acquire();
      expect(result.duration).toBe(result.endTime.getTime() - result.startTime.getTime());
    });

    it('should include file size of 0 in streaming mode', async () => {
      expect((await acquirer.acquire()).files[0].fileSize).toBe(0);
    });

    it('should include device info in data', async () => {
      const result = await acquirer.acquire();
      expect(result.data?.deviceInfo.model).toBe('Test Device');
    });
  });

  describe('output format', () => {
    it('should generate filename with correct pattern', async () => {
      expect((await acquirer.acquire()).files[0].fileName).toBe('dumpsys.txt');
    });

    it('should return a readable stream in default mode', async () => {
      const result = await acquirer.acquire();
      expect(result.files[0].stream).toBeDefined();
      expect(result.files[0].mimeType).toBe('text/plain');
    });
  });

  describe('edge cases', () => {
    it('should handle empty dumpsys output', async () => {
      device.spawn.mockResolvedValue(makeSpawnResult(''));
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect(result.files[0].fileSize).toBe(0);
      expect(result.files[0].stream).toBeDefined();
    });

    it('should handle very large dumpsys output', async () => {
      device.spawn.mockResolvedValue(makeSpawnResult('x'.repeat(1024 * 1024)));
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect(result.files[0].stream).toBeDefined();
    });

    it('should handle device model with special characters', async () => {
      device.getProperties.mockResolvedValue({
        androidVersion: '13',
        buildId: 'TP1A.220905.004',
        model: 'Pixel 6 (🐧)',
        manufacturer: 'Google',
        brand: 'google',
        sdkVersion: 33,
        serialNumber: 'TEST123',
      });
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect(result.files[0].fileName).toBe('dumpsys.txt');
    });
  });
});