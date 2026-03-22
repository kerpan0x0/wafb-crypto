import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MountAcquirer } from '../../../../src/forensics/acquisition/mount';
import {
  createMockADBDeviceWithCommands,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
} from '../../../helpers/test-helpers';
import type { Device } from '../../../../src/adb/device';

describe('MountAcquirer', () => {
  let device: Device;
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

    device = createMockADBDeviceWithCommands({
      shellOutput: mockMountOutput,
    }) as unknown as Device;

    // Mock shell spawn to return different outputs for different commands
    const mockShellSpawn = vi.fn().mockImplementation((command: string) => {
      let output = '';

      if (command === 'mount') {
        output = mockMountOutput;
      } else if (command === 'cat /proc/mounts') {
        output = mockProcMountOutput;
      } else {
        output = mockMountOutput;
      }

      return Promise.resolve({
        stdout: {
          getReader: () => {
            let readCount = 0;
            const data = new TextEncoder().encode(output);
            return {
              read: async () => {
                if (readCount === 0) {
                  readCount++;
                  return { done: false, value: data };
                }
                return { done: true, value: undefined };
              },
              releaseLock: vi.fn(),
            };
          },
        },
        stderr: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }), releaseLock: vi.fn() }) },
        stdin: new WritableStream(),
        exit: Promise.resolve({ code: 0 }),
      });
    });

    device.adb.subprocess.shellProtocol.spawn = mockShellSpawn;

    domMocks = setupAcquirerDOMMocks();
    acquirer = new MountAcquirer(device);
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
      const customAcquirer = new MountAcquirer(device, {
        computeHash: true,
        timeout: 30000,
      });
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

      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('mount');
      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('cat /proc/mounts');
      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalledTimes(2);
    });

    it('should combine mount and proc mount data', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data).toHaveProperty('totalMounts');
      // The combined set should contain unique entries from both outputs
      expect((result.data as any).totalMounts).toBeGreaterThan(0);
    });

    it('should report progress during acquisition', async () => {
      const { callback, getLastProgress } = createMockProgressCallback();
      await acquirer.acquire(callback);

      expect(callback).toHaveBeenCalled();
      const lastProgress = getLastProgress();
      expect(lastProgress.progress).toBe(100);
      expect(lastProgress.status).toBe('completed');
    });

    it('should report all progress stages', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const history = getProgressHistory();
      expect(history.length).toBeGreaterThan(0);

      // Check for specific progress stages
      const progressValues = history.map((p: any) => p.progress);
      expect(progressValues).toContain(10); // Reading device info
      expect(progressValues).toContain(30); // Run mount
      expect(progressValues).toContain(50); // Run proc mount
      expect(progressValues).toContain(70); // Processing
      expect(progressValues).toContain(90); // Preparing download
      expect(progressValues).toContain(100); // Completed
    });

    it('should include device info in progress', async () => {
      const { callback } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const callsWithDeviceInfo = callback.mock.calls.filter(
        (call: any) => call[0].deviceInfo !== undefined
      );
      expect(callsWithDeviceInfo.length).toBeGreaterThan(0);
    });

    it('should compute hash when configured', async () => {
      acquirer = new MountAcquirer(device, { computeHash: true });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.files[0].hash).toBeDefined();
      expect(typeof result.files[0].hash).toBe('string');
    });

    it('should download file with correct blob type', async () => {
      const result = await acquirer.acquire();

      expect(result.files[0].blob).toBeInstanceOf(Blob);
      expect(result.files[0].blob!.type).toBe('application/json');
    });

    it('should generate simple filename', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.files[0].fileName).toBe('mounts.json');
    });

    it('should include device information in result', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(device.getProperties).toHaveBeenCalled();
    });

    it('should handle empty mount output', async () => {
      const emptyDevice = createMockADBDeviceWithCommands({
        shellOutput: '',
      }) as unknown as Device;

      const mockShellSpawn = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          stdout: {
            getReader: () => {
              let readCount = 0;
              const data = new TextEncoder().encode('');
              return {
                read: async () => {
                  if (readCount === 0) {
                    readCount++;
                    return { done: false, value: data };
                  }
                  return { done: true, value: undefined };
                },
                releaseLock: vi.fn(),
              };
            },
          },
          stderr: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }), releaseLock: vi.fn() }) },
          stdin: new WritableStream(),
          exit: Promise.resolve({ code: 0 }),
        });
      });

      emptyDevice.adb.subprocess.shellProtocol.spawn = mockShellSpawn;
      acquirer = new MountAcquirer(emptyDevice);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('totalMounts', 0);
    });

    it('should handle mount output with duplicate entries', async () => {
      const duplicateDevice = createMockADBDeviceWithCommands({
        shellOutput: mockMountOutput,
      }) as unknown as Device;

      // Mock both mount and proc mount to return the same output
      const mockShellSpawn = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          stdout: {
            getReader: () => {
              let readCount = 0;
              const data = new TextEncoder().encode(mockMountOutput);
              return {
                read: async () => {
                  if (readCount === 0) {
                    readCount++;
                    return { done: false, value: data };
                  }
                  return { done: true, value: undefined };
                },
                releaseLock: vi.fn(),
              };
            },
          },
          stderr: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }), releaseLock: vi.fn() }) },
          stdin: new WritableStream(),
          exit: Promise.resolve({ code: 0 }),
        });
      });

      duplicateDevice.adb.subprocess.shellProtocol.spawn = mockShellSpawn;
      acquirer = new MountAcquirer(duplicateDevice);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      // Should deduplicate entries
      const lines = mockMountOutput.split('\n').filter(line => line.trim());
      expect(result.data).toHaveProperty('totalMounts', lines.length);
    });

    it('should handle mount command failure gracefully', async () => {
      const failingDevice = createMockADBDeviceWithCommands({}) as unknown as Device;

      const mockShellSpawn = vi.fn().mockRejectedValue(new Error('Command failed'));
      failingDevice.adb.subprocess.shellProtocol.spawn = mockShellSpawn;

      acquirer = new MountAcquirer(failingDevice);

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Command failed');
    });

    it('should report failure in progress callback on error', async () => {
      const failingDevice = createMockADBDeviceWithCommands({}) as unknown as Device;

      const mockShellSpawn = vi.fn().mockRejectedValue(new Error('Mount acquisition failed'));
      failingDevice.adb.subprocess.shellProtocol.spawn = mockShellSpawn;

      acquirer = new MountAcquirer(failingDevice);

      const { callback, getLastProgress } = createMockProgressCallback();
      const result = await acquirer.acquire(callback);

      expect(result.success).toBe(false);
      const lastProgress = getLastProgress();
      expect(lastProgress.status).toBe('failed');
      expect(lastProgress.message).toContain('failed');
    });

    it('should calculate duration correctly', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.endTime.getTime() - result.startTime.getTime()).toBe(result.duration);
    });

    it('should return blob on successful acquisition', async () => {
      const result = await acquirer.acquire();

      expect(result.files[0].blob).toBeInstanceOf(Blob);
    });

    it('should create JSON output with proper formatting', async () => {
      const result = await acquirer.acquire();

      expect(result.files[0].blob).toBeInstanceOf(Blob);
      expect(result.files[0].blob!.type).toBe('application/json');

      // Verify JSON is valid
      const text = await result.files[0].blob!.text();
      const parsed = JSON.parse(text);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('should handle whitespace and empty lines in mount output', async () => {
      const messyOutput = `
      ${mockMountOutput}
      
      
      `;

      const messyDevice = createMockADBDeviceWithCommands({}) as unknown as Device;

      const mockShellSpawn = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          stdout: {
            getReader: () => {
              let readCount = 0;
              const data = new TextEncoder().encode(messyOutput);
              return {
                read: async () => {
                  if (readCount === 0) {
                    readCount++;
                    return { done: false, value: data };
                  }
                  return { done: true, value: undefined };
                },
                releaseLock: vi.fn(),
              };
            },
          },
          stderr: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }), releaseLock: vi.fn() }) },
          stdin: new WritableStream(),
          exit: Promise.resolve({ code: 0 }),
        });
      });

      messyDevice.adb.subprocess.shellProtocol.spawn = mockShellSpawn;
      acquirer = new MountAcquirer(messyDevice);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      // Should filter out empty lines
      expect(result.data).toHaveProperty('totalMounts');
      expect((result.data as any).totalMounts).toBeGreaterThan(0);
    });

    it('should set acquisition type correctly', async () => {
      const result = await acquirer.acquire();

      expect(result.type).toBe('mount');
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
      const failingDevice = createMockADBDeviceWithCommands({}) as unknown as Device;
      const mockShellSpawn = vi.fn().mockRejectedValue(new Error('Test error'));
      failingDevice.adb.subprocess.shellProtocol.spawn = mockShellSpawn;

      acquirer = new MountAcquirer(failingDevice);
      const result = await acquirer.acquire();

      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('type', 'mount');
      expect(result).toHaveProperty('startTime');
      expect(result).toHaveProperty('endTime');
      expect(result).toHaveProperty('duration');
      expect(result).toHaveProperty('error');
      expect(result).not.toHaveProperty('fileName');
    });
  });
});
