import { describe, it, expect, afterEach, vi } from 'vitest';
import { BackupAcquirer } from '../../../../src/forensics/acquisition/backup';
import {
  createMockADBDeviceWithCommands,
  createMockDeviceProperties,
} from '../../../helpers/test-helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SpawnImpl = (cmd: string) => Promise<any>;

function makeMockDevice(spawnImpl: SpawnImpl) {
  const device = createMockADBDeviceWithCommands();
  vi.spyOn(device.adb.subprocess.shellProtocol, 'spawn').mockImplementation(spawnImpl);
  device.getProperties = vi.fn().mockResolvedValue(createMockDeviceProperties());
  return device;
}

function encode(s: string) {
  return new TextEncoder().encode(s);
}

function makeStream(content: string | Uint8Array) {
  const data = typeof content === 'string' ? encode(content) : content;
  let read = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (read++ === 0 && data.length > 0) return { done: false, value: data };
        return { done: true, value: undefined };
      },
      releaseLock: vi.fn(),
    }),
  };
}

function makeBackupSocket(content: string | Uint8Array = '') {
  return {
    stdout: makeStream(content),
    stderr: makeStream(''),
    exited: Promise.resolve(0),
  };
}

function makeSuccessfulDevice(backupContent: Uint8Array = new Uint8Array(1024).fill(0xab)) {
  return makeMockDevice((cmd: string) => {
    if (cmd.startsWith('which') && cmd.includes('bu')) {
      return Promise.resolve(makeBackupSocket('/system/bin/bu'));
    }
    if (cmd.includes('bu') && cmd.includes('backup')) {
      return Promise.resolve(makeBackupSocket(backupContent));
    }
    return Promise.resolve(makeBackupSocket(''));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BackupAcquirer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('bu binary detection', () => {
    it('should succeed when bu is found at /system/bin/bu', async () => {
      const device = makeSuccessfulDevice();

      const acquirer = new BackupAcquirer(device as any);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).buPath).toBe('/system/bin/bu');
    });

    it('should fail with a clear error when bu is not found', async () => {
      const device = makeMockDevice((cmd: string) => {
        if (cmd.startsWith('which')) return Promise.resolve(makeBackupSocket(''));
        return Promise.resolve(makeBackupSocket(''));
      });

      const acquirer = new BackupAcquirer(device as any);
      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/bu.*not found/i);
    });

    it('should try fallback paths when /system/bin/bu is missing', async () => {
      const device = makeMockDevice((cmd: string) => {
        if (cmd.includes('/system/bin/bu')) return Promise.resolve(makeBackupSocket(''));
        if (cmd.includes('/system/xbin/bu')) return Promise.resolve(makeBackupSocket(''));
        if (cmd === 'which bu') return Promise.resolve(makeBackupSocket('/usr/bin/bu'));
        if (cmd.includes('backup')) return Promise.resolve(makeBackupSocket(new Uint8Array(512)));
        return Promise.resolve(makeBackupSocket(''));
      });

      const acquirer = new BackupAcquirer(device as any);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });
  });

  // ── streaming architecture ───────────────────────────────────────────────
  // BackupAcquirer streams `bu backup` stdout directly.
  // No file is written to the device, no stat, no ReadFileCommand.

  describe('empty backup file detection', () => {
    it('should succeed and return a stream even when backup stdout is empty', async () => {
      // Empty stdout = user did not confirm the dialog on device.
      // The acquirer cannot detect this until the stream is consumed;
      // it returns success=true with fileSize=0.
      const device = makeMockDevice((cmd: string) => {
        if (cmd.startsWith('which') && cmd.includes('bu')) {
          return Promise.resolve(makeBackupSocket('/system/bin/bu'));
        }
        if (cmd.includes('backup')) return Promise.resolve(makeBackupSocket(''));
        return Promise.resolve(makeBackupSocket(''));
      });

      const acquirer = new BackupAcquirer(device as any);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.files![0].stream).toBeDefined();
      expect(result.files![0].fileSize).toBe(0);
    });

    it('should return a stream regardless of backup content', async () => {
      const device = makeSuccessfulDevice(new Uint8Array(0));

      const acquirer = new BackupAcquirer(device as any);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.files![0].stream).toBeDefined();
    });
  });

  describe('backup command building', () => {
    it('should use -all -nosystem for full backup type', async () => {
      const spawnCalls: string[] = [];
      const device = makeMockDevice((cmd: string) => {
        spawnCalls.push(cmd);
        if (cmd.startsWith('which')) return Promise.resolve(makeBackupSocket('/system/bin/bu'));
        if (cmd.includes('backup')) return Promise.resolve(makeBackupSocket(new Uint8Array(2048)));
        return Promise.resolve(makeBackupSocket(''));
      });

      const acquirer = new BackupAcquirer(device as any, { type: 'full' });
      await acquirer.acquire();

      const backupCmd = spawnCalls.find(c => c.includes('bu') && c.includes('backup'));
      expect(backupCmd).toBeDefined();
      expect(backupCmd).toMatch(/-all/);
      expect(backupCmd).toMatch(/-nosystem/);
    });

    it('should use package name for sms-only backup type', async () => {
      const spawnCalls: string[] = [];
      const device = makeMockDevice((cmd: string) => {
        spawnCalls.push(cmd);
        if (cmd.startsWith('which')) return Promise.resolve(makeBackupSocket('/system/bin/bu'));
        if (cmd.includes('backup')) return Promise.resolve(makeBackupSocket(new Uint8Array(512)));
        return Promise.resolve(makeBackupSocket(''));
      });

      const acquirer = new BackupAcquirer(device as any, { type: 'sms-only' });
      await acquirer.acquire();

      const backupCmd = spawnCalls.find(c => c.includes('bu') && c.includes('backup'));
      expect(backupCmd).toBeDefined();
      expect(backupCmd).toMatch(/com\.android\.providers\.telephony/);
      expect(backupCmd).not.toMatch(/-all/);
    });

    it('should stream stdout — no -f flag, no shell redirect', async () => {
      const spawnCalls: string[] = [];
      const device = makeMockDevice((cmd: string) => {
        spawnCalls.push(cmd);
        if (cmd.startsWith('which')) return Promise.resolve(makeBackupSocket('/system/bin/bu'));
        if (cmd.includes('backup')) return Promise.resolve(makeBackupSocket(new Uint8Array(1024)));
        return Promise.resolve(makeBackupSocket(''));
      });

      const acquirer = new BackupAcquirer(device as any, { type: 'full' });
      await acquirer.acquire();

      const backupCmd = spawnCalls.find(c => c.includes('backup'));
      expect(backupCmd).not.toMatch(/-f /);
      expect(backupCmd).not.toMatch(/>/);
    });
  });

  describe('blob creation', () => {
    it('should return a stream with fileSize 0 (not a blob)', async () => {
      const device = makeSuccessfulDevice(new Uint8Array(512).fill(0xab));

      const acquirer = new BackupAcquirer(device as any);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(1);
      // Streaming: fileSize is 0 until the stream is consumed by the ZIP writer
      expect(result.files![0].fileSize).toBe(0);
      expect(result.files![0].stream).toBeDefined();
      expect(result.files![0].mimeType).toBe('application/vnd.android.backup');
    });

    it('should correctly handle Uint8Array views (partial buffer)', async () => {
      const bigBuffer = new ArrayBuffer(1024);
      const partialView = new Uint8Array(bigBuffer, 256, 512);
      const device = makeSuccessfulDevice(partialView);

      const acquirer = new BackupAcquirer(device as any);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.files![0].stream).toBeDefined();
    });
  });

  describe("type: 'none'", () => {
    it("should return success without any files when type is 'none'", async () => {
      const device = makeMockDevice((cmd: string) => {
        if (cmd.startsWith('which')) return Promise.resolve(makeBackupSocket('/system/bin/bu'));
        return Promise.resolve(makeBackupSocket(''));
      });

      const acquirer = new BackupAcquirer(device as any, { type: 'none' });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.files).toBeUndefined();
    });
  });

  describe('progress reporting', () => {
    it('should call onProgress at various stages', async () => {
      const device = makeSuccessfulDevice();
      const progressCalls: number[] = [];

      const acquirer = new BackupAcquirer(device as any);
      await acquirer.acquire(({ progress }) => progressCalls.push(progress));

      expect(progressCalls.length).toBeGreaterThan(2);
      expect(progressCalls[0]).toBeLessThan(progressCalls[progressCalls.length - 1]);
      expect(progressCalls[progressCalls.length - 1]).toBeGreaterThan(0);
    });

    it('should report status failed and progress 0 on error', async () => {
      const device = makeMockDevice((cmd: string) => {
        if (cmd.startsWith('which')) return Promise.resolve(makeBackupSocket(''));
        return Promise.resolve(makeBackupSocket(''));
      });
      const statuses: string[] = [];

      const acquirer = new BackupAcquirer(device as any);
      await acquirer.acquire(({ status }) => statuses.push(status));

      expect(statuses).toContain('failed');
    });
  });
});
