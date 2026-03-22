import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BackupAcquirer } from '../../../../src/forensics/acquisition/backup';
import {
  createMockDeviceForAcquirer,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  makeShellResult,
  makeSpawnResult,
} from '../../../helpers/test-helpers';
import type { MockDevice } from '../../../helpers/test-helpers';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BU_PATH = '/system/bin/bu';
const BACKUP_CONTENT = new Uint8Array(1024).fill(0xab);

/**
 * Sets up shell and spawn mocks for the happy path:
 * - `which bu` → BU_PATH
 * - `bu backup ...` (spawn) → stream with backupContent
 */
function setupSuccessfulBackup(device: MockDevice, backupContent: Uint8Array = BACKUP_CONTENT) {
  // WhichCommand uses device.shell
  device.shell.mockImplementation(async (cmd: string) => {
    if (cmd.startsWith('which')) return makeShellResult(BU_PATH);
    return makeShellResult('');
  });

  // BackupCommand uses device.spawn
  device.spawn.mockResolvedValue(makeSpawnResult(backupContent));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BackupAcquirer', () => {
  let device: MockDevice;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    device = createMockDeviceForAcquirer();
    setupSuccessfulBackup(device);
    domMocks = setupAcquirerDOMMocks();
  });

  afterEach(() => {
    domMocks.cleanup();
    vi.restoreAllMocks();
  });

  describe('bu binary detection', () => {
    it('should succeed when bu is found at /system/bin/bu', async () => {
      const result = await new BackupAcquirer(device as any).acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).buPath).toBe(BU_PATH);
    });

    it('should fail with a clear error when bu is not found anywhere', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      const result = await new BackupAcquirer(device as any).acquire();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/bu.*not found/i);
    });

    it('should try fallback paths when /system/bin/bu is missing', async () => {
      device.shell.mockImplementation(async (cmd: string) => {
        // Only 'which bu' (bare name) returns a path
        if (cmd === 'which bu') return makeShellResult('/usr/bin/bu');
        return makeShellResult('');
      });

      const result = await new BackupAcquirer(device as any).acquire();

      expect(result.success).toBe(true);
    });
  });

  describe('empty backup file detection', () => {
    it('should succeed and return a stream even when backup stdout is empty', async () => {
      device.spawn.mockResolvedValue(makeSpawnResult(''));

      const result = await new BackupAcquirer(device as any).acquire();

      expect(result.success).toBe(true);
      expect(result.files![0].stream).toBeDefined();
      expect(result.files![0].fileSize).toBe(0);
    });

    it('should return a stream regardless of backup content', async () => {
      device.spawn.mockResolvedValue(makeSpawnResult(new Uint8Array(0)));

      const result = await new BackupAcquirer(device as any).acquire();

      expect(result.success).toBe(true);
      expect(result.files![0].stream).toBeDefined();
    });
  });

  describe('backup command building', () => {
    it('should use -all -nosystem for full backup type', async () => {
      const spawnCalls: string[] = [];
      device.spawn.mockImplementation(async (cmd: string) => {
        spawnCalls.push(cmd);
        return makeSpawnResult(BACKUP_CONTENT);
      });

      await new BackupAcquirer(device as any, { type: 'full' }).acquire();

      const backupCmd = spawnCalls.find(c => c.includes('backup'));
      expect(backupCmd).toBeDefined();
      expect(backupCmd).toMatch(/-all/);
      expect(backupCmd).toMatch(/-nosystem/);
    });

    it('should use package name for sms-only backup type', async () => {
      const spawnCalls: string[] = [];
      device.spawn.mockImplementation(async (cmd: string) => {
        spawnCalls.push(cmd);
        return makeSpawnResult(new Uint8Array(512));
      });

      await new BackupAcquirer(device as any, { type: 'sms-only' }).acquire();

      const backupCmd = spawnCalls.find(c => c.includes('backup'));
      expect(backupCmd).toBeDefined();
      expect(backupCmd).toMatch(/com\.android\.providers\.telephony/);
      expect(backupCmd).not.toMatch(/-all/);
    });

    it('should stream stdout — no -f flag, no shell redirect', async () => {
      const spawnCalls: string[] = [];
      device.spawn.mockImplementation(async (cmd: string) => {
        spawnCalls.push(cmd);
        return makeSpawnResult(new Uint8Array(1024));
      });

      await new BackupAcquirer(device as any, { type: 'full' }).acquire();

      const backupCmd = spawnCalls.find(c => c.includes('backup'));
      expect(backupCmd).not.toMatch(/-f /);
      expect(backupCmd).not.toMatch(/>/);
    });
  });

  describe('blob creation', () => {
    it('should return a stream with fileSize 0 (not a blob)', async () => {
      const result = await new BackupAcquirer(device as any).acquire();

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(1);
      expect(result.files![0].fileSize).toBe(0);
      expect(result.files![0].stream).toBeDefined();
      expect(result.files![0].mimeType).toBe('application/vnd.android.backup');
    });

    it('should correctly handle Uint8Array views (partial buffer)', async () => {
      const bigBuffer = new ArrayBuffer(1024);
      device.spawn.mockResolvedValue(makeSpawnResult(new Uint8Array(bigBuffer, 256, 512)));

      const result = await new BackupAcquirer(device as any).acquire();

      expect(result.success).toBe(true);
      expect(result.files![0].stream).toBeDefined();
    });
  });

  describe("type: 'none'", () => {
    it("should return success without any files when type is 'none'", async () => {
      const result = await new BackupAcquirer(device as any, { type: 'none' }).acquire();

      expect(result.success).toBe(true);
      expect(result.files).toBeUndefined();
    });
  });

  describe('progress reporting', () => {
    it('should call onProgress at various stages', async () => {
      const progressValues: number[] = [];
      await new BackupAcquirer(device as any).acquire(({ progress }) => progressValues.push(progress));

      expect(progressValues.length).toBeGreaterThan(2);
      expect(progressValues[0]).toBeLessThan(progressValues[progressValues.length - 1]);
    });

    it('should report status failed on error', async () => {
      device.shell.mockResolvedValue(makeShellResult('')); // bu not found

      const statuses: string[] = [];
      await new BackupAcquirer(device as any).acquire(({ status }) => statuses.push(status));

      expect(statuses).toContain('failed');
    });
  });
});