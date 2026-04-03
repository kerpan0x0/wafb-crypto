import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MountAcquirer } from '../../../../src/forensics/acquisition/mount';
import {
  createMockDeviceForAcquirer,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  makeShellResult,
  readStream,
} from '../../../helpers/test-helpers';
import type { MockDevice } from '../../../helpers/test-helpers';

async function drainAndHash(result: any, fileIndex = 0): Promise<string | undefined> {
  const file = result.files?.[fileIndex] ?? result.files![fileIndex];
  if (!file?.hashPromise) return undefined;
  // Drain the stream so TransformStream.flush() fires and hashPromise resolves
  if (file.stream) {
    const reader = (file.stream as ReadableStream<Uint8Array>).getReader();
    while (!(await reader.read()).done) {}
  }
  return file.hashPromise;
}


describe('MountAcquirer', () => {
  let device: MockDevice;
  let acquirer: MountAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  const mockMountOutput = `rootfs / rootfs ro,relatime 0 0
tmpfs /dev tmpfs rw,nosuid,relatime,mode=755 0 0
devpts /dev/pts devpts rw,relatime,mode=600 0 0
proc /proc proc rw,relatime 0 0
sysfs /sys sysfs rw,relatime 0 0
/dev/block/dm-0 /system ext4 ro,relatime 0 0
/dev/block/dm-1 /vendor ext4 ro,relatime 0 0
/dev/block/sda1 /data ext4 rw,nosuid,nodev,noatime 0 0`;

  const mockProcMountOutput = `rootfs / rootfs ro,relatime 0 0
tmpfs /dev tmpfs rw,nosuid,relatime,mode=755 0 0
proc /proc proc rw,relatime 0 0
sysfs /sys sysfs rw,relatime 0 0
/dev/block/dm-0 /system ext4 ro,relatime 0 0
/dev/block/dm-1 /vendor ext4 ro,relatime 0 0
/dev/block/sda1 /data ext4 rw,nosuid,nodev,noatime 0 0
/dev/block/sda2 /sdcard vfat rw,relatime 0 0`;

  beforeEach(() => {
    vi.clearAllMocks();

    device = createMockDeviceForAcquirer();

    // Dispatch different outputs per command
    device.shell.mockImplementation(async (command: string) => {
      if (command === 'mount') return makeShellResult(mockMountOutput);
      if (command === 'cat /proc/mounts') return makeShellResult(mockProcMountOutput);
      return makeShellResult('');
    });

    domMocks = setupAcquirerDOMMocks();
    acquirer = new MountAcquirer(device as any);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('constructor', () => {
    it('should create acquirer with default config', () => {
      expect(acquirer).toBeDefined();
      expect(acquirer).toBeInstanceOf(MountAcquirer);
    });

    it('should create acquirer with custom config', () => {
      const customAcquirer = new MountAcquirer(device as any, { computeHash: true, timeout: 30000 });
      expect(customAcquirer).toBeDefined();
    });
  });

  describe('acquire', () => {
    it('should successfully acquire mount information', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.type).toBe('mount');
      expect(result.files[0].fileName).toContain('mounts');
      expect(result.files[0].fileName).toContain('.json');
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should call both mount and cat /proc/mounts commands', async () => {
      await acquirer.acquire();

      expect(device.shell).toHaveBeenCalledWith('mount');
      expect(device.shell).toHaveBeenCalledWith('cat /proc/mounts');
    });

    it('should combine mount and proc mount data', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data).toHaveProperty('totalMounts');
      expect((result.data as any).totalMounts).toBeGreaterThan(0);
    });

    it('should report progress during acquisition', async () => {
      const { callback, getLastProgress } = createMockProgressCallback();
      await acquirer.acquire(callback);

      expect(callback).toHaveBeenCalled();
      const last = getLastProgress();
      expect(last.progress).toBe(100);
      expect(last.status).toBe('completed');
    });

    it('should report all progress stages', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const progressValues = getProgressHistory().map((p: any) => p.progress);
      expect(progressValues).toContain(10);
      expect(progressValues).toContain(30);
      expect(progressValues).toContain(50);
      expect(progressValues).toContain(70);
      expect(progressValues).toContain(90);
      expect(progressValues).toContain(100);
    });

    it('should include device info in progress', async () => {
      const { callback } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const withDeviceInfo = callback.mock.calls.filter((c: any) => c[0].deviceInfo !== undefined);
      expect(withDeviceInfo.length).toBeGreaterThan(0);
    });

    it('should compute hash when configured', async () => {
      acquirer = new MountAcquirer(device as any, { computeHash: true });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      const hash = await drainAndHash(result, 0);
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });

    it('should download file with correct blob type', async () => {
      const result = await acquirer.acquire();
      expect(result.files[0].stream).toBeInstanceOf(ReadableStream);
      expect(result.files[0].mimeType).toBe('application/json');
    });

    it('should generate simple filename', async () => {
      const result = await acquirer.acquire();
      expect(result.files[0].fileName).toBe('mounts.json');
    });

    it('should include device information in result', async () => {
      await acquirer.acquire();
      expect(device.getProperties).toHaveBeenCalled();
    });

    it('should handle empty mount output', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('totalMounts', 0);
    });

    it('should handle mount output with duplicate entries', async () => {
      // Both mount and /proc/mounts return the same output
      device.shell.mockResolvedValue(makeShellResult(mockMountOutput));

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      const lines = mockMountOutput.split('\n').filter(l => l.trim());
      expect((result.data as any).totalMounts).toBe(lines.length);
    });

    it('should handle mount command failure gracefully', async () => {
      device.shell.mockRejectedValue(new Error('Command failed'));
      acquirer = new MountAcquirer(device as any);

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Command failed');
    });

    it('should report failure in progress callback on error', async () => {
      device.shell.mockRejectedValue(new Error('Mount acquisition failed'));
      acquirer = new MountAcquirer(device as any);

      const { callback, getLastProgress } = createMockProgressCallback();
      const result = await acquirer.acquire(callback);

      expect(result.success).toBe(false);
      const last = getLastProgress();
      expect(last.status).toBe('failed');
      expect(last.message).toContain('failed');
    });

    it('should calculate duration correctly', async () => {
      const result = await acquirer.acquire();

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.endTime.getTime() - result.startTime.getTime()).toBe(result.duration);
    });

    it('should return blob on successful acquisition', async () => {
      const result = await acquirer.acquire();
      expect(result.files[0].stream).toBeInstanceOf(ReadableStream);
    });

    it('should create JSON output with proper formatting', async () => {
      const result = await acquirer.acquire();

      expect(result.files[0].mimeType).toBe('application/json');
      const parsed = JSON.parse(await readStream(result.files[0].stream!));
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('should handle whitespace and empty lines in mount output', async () => {
      const messyOutput = `\n      ${mockMountOutput}\n      \n      \n      `;
      device.shell.mockResolvedValue(makeShellResult(messyOutput));

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).totalMounts).toBeGreaterThan(0);
    });

    it('should set acquisition type correctly', async () => {
      expect((await acquirer.acquire()).type).toBe('mount');
    });

    it('should maintain consistent result structure on success', async () => {
      const result = await acquirer.acquire();

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('files');
      expect(result).toHaveProperty('startTime');
      expect(result).toHaveProperty('endTime');
      expect(result).toHaveProperty('duration');
      expect(result).toHaveProperty('data');
      expect(result).not.toHaveProperty('error');
    });

    it('should maintain consistent result structure on failure', async () => {
      device.shell.mockRejectedValue(new Error('Test error'));
      acquirer = new MountAcquirer(device as any);

      const result = await acquirer.acquire();

      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('type', 'mount');
      expect(result).toHaveProperty('error');
    });
  });
});