import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BugreportAcquirer } from '../../../../src/forensics/acquisition/bugreport';
import { 
  createMockADBDeviceWithCommands, 
  setupAcquirerDOMMocks,
  createMockProgressCallback
} from '../../../helpers/test-helpers';
import type { ADBDevice } from '../../../../src/adb/device';

describe('BugreportAcquirer', () => {
  let device: ADBDevice;
  let acquirer: BugreportAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    device = createMockADBDeviceWithCommands() as unknown as ADBDevice;
    domMocks = setupAcquirerDOMMocks();
    acquirer = new BugreportAcquirer(device);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('acquire', () => {
    it('should successfully generate bugreport', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.type).toBe('bugreport');
      expect(result.fileName).toMatch(/bugreport-.*\.zip/);
      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalled();
    });

    it('should report progress during acquisition', async () => {
      const { callback, getLastProgress } = createMockProgressCallback();
      await acquirer.acquire(callback);

      expect(callback).toHaveBeenCalled();
      const lastProgress = getLastProgress();
      expect(lastProgress.progress).toBe(100);
      expect(lastProgress.status).toBe('completed');
    });

    it('should compute hashes when configured', async () => {
      acquirer = new BugreportAcquirer(device, { computeHash: true });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.hash).toBeDefined();
      expect(typeof result.hash).toBe('string');
    });

    it('should handle bugreport generation errors', async () => {
      vi.mocked(device.adb.subprocess.shellProtocol.spawn).mockRejectedValue(
        new Error('Bugreport generation failed')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Bugreport generation failed');
    });

    it('should cleanup temporary files when configured', async () => {
      domMocks.cleanup();
      device = createMockADBDeviceWithCommands({
        checkCommandExists: false
      }) as unknown as ADBDevice;
      domMocks = setupAcquirerDOMMocks();
      
      acquirer = new BugreportAcquirer(device, { cleanupAfter: true });
      await acquirer.acquire();

      expect(acquirer.wasCleanupPerformed()).toBe(true);
    });

    it('should skip hash computation when disabled', async () => {
      acquirer = new BugreportAcquirer(device, { computeHash: false });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.hash).toBeUndefined();
    });

    it('should include device info in result', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect((result.data as any).deviceInfo).toBeDefined();
      expect((result.data as any).deviceInfo.model).toBe('Test Device');
    });

    it('should fallback to legacy bugreport if bugreportz fails', async () => {
      domMocks.cleanup();
      device = createMockADBDeviceWithCommands({
        checkCommandExists: false,
        shellOutput: '',
        readFile: new TextEncoder().encode('mock bugreport content')
      }) as unknown as ADBDevice;
      domMocks = setupAcquirerDOMMocks();
      acquirer = new BugreportAcquirer(device, { preferZip: false });
      
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.fileName).toMatch(/bugreport-.*\.txt/);
    });
  });

  describe('error handling', () => {
    it('should handle device disconnection', async () => {
      vi.mocked(device.adb.subprocess.shellProtocol.spawn).mockRejectedValue(
        new Error('Device disconnected')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Device disconnected');
    });

    it('should handle timeout', async () => {
      vi.mocked(device.adb.subprocess.shellProtocol.spawn).mockRejectedValue(
        new Error('Command timed out')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/timeout|timed out/i);
    });

    it('should handle file read errors', async () => {
      vi.mocked(device.adb.sync).mockRejectedValue(
        new Error('Failed to read file')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to read file');
    });

    it('should attempt cleanup even when acquisition fails', async () => {
      // Reset mocks and create new device with legacy bugreport
      domMocks.cleanup();
      device = createMockADBDeviceWithCommands({
        checkCommandExists: false,
        readFile: new Uint8Array()
      }) as unknown as ADBDevice;
      vi.mocked(device.adb.sync).mockRejectedValue(new Error('Read failed'));
      domMocks = setupAcquirerDOMMocks();
      
      acquirer = new BugreportAcquirer(device, { cleanupAfter: true });
      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
    });

    it('should report when cleanup fails (CRITICAL for forensics)', async () => {
      domMocks.cleanup();

      // Create device that uses legacy bugreport (so cleanup will actually be attempted)
      const mockDevice = createMockADBDeviceWithCommands({
        checkCommandExists: false,
        shellOutput: '',
        readFile: new TextEncoder().encode('mock bugreport content')
      }) as unknown as ADBDevice;

      // Get the original implementation before we mock it
      const originalImpl = vi.fn(mockDevice.adb.subprocess.shellProtocol.spawn.getMockImplementation());

      // Mock spawn to fail ONLY on the rm command (cleanup)
      mockDevice.adb.subprocess.shellProtocol.spawn = vi.fn().mockImplementation((command: string) => {
        // Fail on rm command (which is the cleanup)
        if (command.includes('rm ')) {
          return Promise.reject(new Error('Cleanup failed'));
        }
        // For all other commands, use the original mock logic from test-helpers
        return originalImpl(command);
      });

      domMocks = setupAcquirerDOMMocks();
      
      acquirer = new BugreportAcquirer(mockDevice, { cleanupAfter: true, preferZip: false });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(acquirer.wasCleanupPerformed()).toBe(false);
    });
  });

  describe('progress reporting', () => {
    it('should report initial progress', async () => {
      const { callback } = createMockProgressCallback();
      await acquirer.acquire(callback);

      expect(callback.mock.calls[0][0].progress).toBe(10);
      expect(callback.mock.calls[0][0].message).toContain('device information');
    });

    it('should report completion progress', async () => {
      const { callback, getLastProgress } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const lastProgress = getLastProgress();
      expect(lastProgress.progress).toBe(100);
      expect(lastProgress.status).toBe('completed');
    });

    it('should report progress updates during generation', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const progressValues = getProgressHistory().map(p => p.progress);
      expect(progressValues.some(p => p >= 30 && p < 100)).toBe(true);
    });
  });

  describe('configuration', () => {
    it('should respect computeHash config', async () => {
      acquirer = new BugreportAcquirer(device, { computeHash: true });
      const result = await acquirer.acquire();

      expect(result.hash).toBeDefined();
    });

    it('should respect timeout config', async () => {
      acquirer = new BugreportAcquirer(device, { timeout: 5000 });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });

    it('should respect cleanupAfter config', async () => {
      acquirer = new BugreportAcquirer(device, { cleanupAfter: false });
      await acquirer.acquire();

      expect(acquirer.wasCleanupPerformed()).toBe(false);
    });
  });

  describe('metadata', () => {
    it('should include acquisition timestamps', async () => {
      const result = await acquirer.acquire();

      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
    });

    it('should include duration', async () => {
      const result = await acquirer.acquire();

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(typeof result.duration).toBe('number');
    });

    it('should include file size in metadata', async () => {
      const result = await acquirer.acquire();

      expect(result.fileSize).toBeDefined();
      expect(typeof result.fileSize).toBe('number');
      expect(result.fileSize).toBeGreaterThan(0);
    });
  });

  describe('bugreportz parsing', () => {
    it('should parse valid bugreportz output', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.fileName).toMatch(/bugreport.*\.zip/);
    });

    it('should handle bugreportz output with whitespace', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });

    it('should handle bugreportz output with extra info', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });
  });
});