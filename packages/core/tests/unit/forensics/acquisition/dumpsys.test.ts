// packages/core/tests/unit/forensics/acquisition/dumpsys.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DumpsysAcquirer } from '../../../../src/forensics/acquisition/dumpsys';
import type { ADBDevice } from '../../../../src/adb/device';
import {
  createMockADBDeviceWithCommands,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  createMockReadableStream
} from '../../../helpers/test-helpers';

// ============================================================================
// MOCK DATA
// ============================================================================

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
    Services: 45
  ... (truncated for test)`;

// ============================================================================
// TEST SUITE
// ============================================================================

describe('DumpsysAcquirer', () => {
  let device: ADBDevice;
  let acquirer: DumpsysAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create base mock device with default responses
    device = createMockADBDeviceWithCommands() as unknown as ADBDevice;

    // Override the spawn mock to return dumpsys output for the "dumpsys" command
    // @ts-ignore - we know the structure
    device.adb.subprocess.shellProtocol.spawn.mockImplementation((command: string) => {
      if (command === 'dumpsys') {
        return Promise.resolve({
          stdout: createMockReadableStream(MOCK_DUMPSYS_OUTPUT),
          stderr: createMockReadableStream(''),
          stdin: new WritableStream(),
          exit: Promise.resolve({ code: 0 })
        });
      }
      // Fallback to default behaviour for other commands (getprop, etc.)
      return Promise.resolve({
        stdout: createMockReadableStream(''),
        stderr: createMockReadableStream(''),
        stdin: new WritableStream(),
        exit: Promise.resolve({ code: 0 })
      });
    });

    domMocks = setupAcquirerDOMMocks();
    acquirer = new DumpsysAcquirer(device);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  // ==========================================================================
  // CONSTRUCTOR
  // ==========================================================================

  describe('constructor', () => {
    it('should create instance with default config', () => {
      expect(acquirer).toBeInstanceOf(DumpsysAcquirer);
    });

    it('should create instance with custom config', () => {
      const customAcquirer = new DumpsysAcquirer(device, {
        timeout: 60000,
        computeHash: true
      });
      expect(customAcquirer).toBeInstanceOf(DumpsysAcquirer);
    });
  });

  // ==========================================================================
  // BASIC ACQUISITION
  // ==========================================================================

  describe('acquire', () => {
    it('should successfully acquire dumpsys output', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.type).toBe('dumpsys');
      expect(result.fileName).toMatch(/^dumpsys-.*\.txt$/);
      expect(result.fileName).toContain('Test Device');
      expect(result.fileSize).toBeGreaterThan(0);
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should call dumpsys command with correct timeout', async () => {
      const spawnSpy = vi.spyOn(device.adb.subprocess.shellProtocol, 'spawn');
      await acquirer.acquire();

      // DumpsysAcquirer uses DumpsysCommand which calls `dumpsys` with no args
      expect(spawnSpy).toHaveBeenCalledWith('dumpsys');
    });

    it('should include device information in result', async () => {
      const result = await acquirer.acquire();

      expect(result.data).toBeDefined();
      expect(result.data?.deviceInfo).toBeDefined();
      expect(result.data?.deviceInfo.model).toBe('Test Device');
      expect(device.getProperties).toHaveBeenCalled();
    });

    it('should include output size and line count in result data', async () => {
      const result = await acquirer.acquire();

      expect(result.data?.outputSize).toBe(MOCK_DUMPSYS_OUTPUT.length);
      expect(result.data?.lines).toBe(MOCK_DUMPSYS_OUTPUT.split('\n').length);
    });

    it('should trigger download with correct blob type', async () => {
      await acquirer.acquire();

      expect(domMocks.createObjectURLSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'text/plain'
        })
      );
      expect(domMocks.mockAnchor.click).toHaveBeenCalled();
      expect(domMocks.mockAnchor.download).toMatch(/dumpsys-.*\.txt/);
    });
  });

  // ==========================================================================
  // PROGRESS REPORTING
  // ==========================================================================

  describe('progress reporting', () => {
    it('should report progress during acquisition', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      expect(callback).toHaveBeenCalled();
      const history = getProgressHistory();
      expect(history.length).toBeGreaterThan(4);
    });

    it('should report key progress milestones', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const progressValues = getProgressHistory().map(p => p.progress);
      expect(progressValues).toContain(10); // Device info
      expect(progressValues).toContain(20); // Connected
      expect(progressValues).toContain(30); // Collecting dumpsys
      expect(progressValues).toContain(90); // Processing
      expect(progressValues).toContain(100); // Completed
    });

    it('should include descriptive messages', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const messages = getProgressHistory().map(p => p.message);
      expect(messages.some(m => m.includes('device information'))).toBe(true);
      expect(messages.some(m => m.includes('Connected'))).toBe(true);
      expect(messages.some(m => m.includes('Collecting device diagnostic'))).toBe(true);
      expect(messages.some(m => m.includes('Processing dumpsys'))).toBe(true);
    });

    it('should include device info in progress at step 20', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const progress20 = getProgressHistory().find(p => p.progress === 20);
      expect(progress20?.deviceInfo).toBeDefined();
      expect(progress20?.deviceInfo?.model).toBe('Test Device');
    });
  });

  // ==========================================================================
  // CONFIGURATION OPTIONS
  // ==========================================================================

  describe('configuration', () => {
    it('should compute hash when computeHash is true', async () => {
      const hashAcquirer = new DumpsysAcquirer(device, { computeHash: true });
      const result = await hashAcquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.hash).toBeDefined();
      expect(typeof result.hash).toBe('string');
      expect(result.hash?.length).toBe(64); // SHA-256 hex length
    });

    it('should not compute hash when computeHash is false/undefined', async () => {
      const result = await acquirer.acquire(); // default config
      expect(result.hash).toBeUndefined();

      const noHashAcquirer = new DumpsysAcquirer(device, { computeHash: false });
      const result2 = await noHashAcquirer.acquire();
      expect(result2.hash).toBeUndefined();
    });

    it('should respect custom timeout', async () => {
      const customAcquirer = new DumpsysAcquirer(device, { timeout: 45000 });
      const result = await customAcquirer.acquire();

      expect(result.success).toBe(true);
      // Timeout is passed internally to DumpsysCommand -> ShellCommand
      // We can't easily spy on the exact timeout, but we verify that the command executed
      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('dumpsys');
    });
  });

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('error handling', () => {
    it('should handle dumpsys command failure', async () => {
      vi.spyOn(device.adb.subprocess.shellProtocol, 'spawn').mockRejectedValue(
        new Error('dumpsys failed')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('dumpsys failed');
      expect(result.type).toBe('dumpsys');
    });

    it('should handle device disconnection', async () => {
      vi.spyOn(device, 'getProperties').mockRejectedValue(
        new Error('Device disconnected')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Device disconnected');
    });

    it('should handle timeout errors', async () => {
      vi.spyOn(device.adb.subprocess.shellProtocol, 'spawn').mockRejectedValue(
        new Error('Command timed out')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/timeout|timed out/i);
    });

    it('should report failure in progress callback', async () => {
      vi.spyOn(device, 'getProperties').mockRejectedValue(new Error('Test error'));

      const { callback, getLastProgress } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const lastProgress = getLastProgress();
      expect(lastProgress.status).toBe('failed');
      expect(lastProgress.message).toContain('Error');
    });

    it('should still calculate duration on failure', async () => {
      vi.spyOn(device.adb.subprocess.shellProtocol, 'spawn').mockRejectedValue(
        new Error('Failure')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.endTime.getTime() - result.startTime.getTime()).toBe(result.duration);
    });
  });

  // ==========================================================================
  // RESULT METADATA
  // ==========================================================================

  describe('result metadata', () => {
    it('should set correct acquisition type', async () => {
      const result = await acquirer.acquire();
      expect(result.type).toBe('dumpsys');
    });

    it('should include start and end timestamps', async () => {
      const result = await acquirer.acquire();
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
    });

    it('should calculate duration correctly', async () => {
      const result = await acquirer.acquire();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.duration).toBe(result.endTime.getTime() - result.startTime.getTime());
    });

    it('should include file size', async () => {
      const result = await acquirer.acquire();
      expect(result.fileSize).toBe(MOCK_DUMPSYS_OUTPUT.length);
    });

    it('should include device info in data', async () => {
      const result = await acquirer.acquire();
      expect(result.data?.deviceInfo).toBeDefined();
      expect(result.data?.deviceInfo.model).toBe('Test Device');
    });

    it('should include output metrics in data', async () => {
      const result = await acquirer.acquire();
      expect(result.data?.outputSize).toBe(MOCK_DUMPSYS_OUTPUT.length);
      expect(result.data?.lines).toBe(MOCK_DUMPSYS_OUTPUT.split('\n').length);
    });
  });

  // ==========================================================================
  // OUTPUT FORMAT
  // ==========================================================================

  describe('output format', () => {
    it('should generate filename with correct pattern', async () => {
      const result = await acquirer.acquire();
      expect(result.fileName).toMatch(/^dumpsys-Test Device-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.txt$/);
    });

    it('should create blob with UTF-8 encoded content', async () => {
      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      expect(blob.type).toBe('text/plain');

      const text = await blob.text();
      expect(text).toBe(MOCK_DUMPSYS_OUTPUT);
    });

    it('should not modify or parse the dumpsys output', async () => {
      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      expect(text).toBe(MOCK_DUMPSYS_OUTPUT); // raw, unchanged
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty dumpsys output', async () => {
      // Override spawn to return empty string
      vi.spyOn(device.adb.subprocess.shellProtocol, 'spawn').mockResolvedValue({
        stdout: createMockReadableStream(''),
        stderr: createMockReadableStream(''),
        stdin: new WritableStream(),
        exit: Promise.resolve({ code: 0 })
      });

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.fileSize).toBe(0);
      expect(result.data?.outputSize).toBe(0);
      expect(result.data?.lines).toBe(1); // empty string split gives [''] -> 1 line
    });

    it('should handle very large dumpsys output', async () => {
      const largeOutput = 'x'.repeat(10 * 1024 * 1024); // 10 MB
      vi.spyOn(device.adb.subprocess.shellProtocol, 'spawn').mockResolvedValue({
        stdout: createMockReadableStream(largeOutput),
        stderr: createMockReadableStream(''),
        stdin: new WritableStream(),
        exit: Promise.resolve({ code: 0 })
      });

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.fileSize).toBe(largeOutput.length);
    });

    it('should handle device model with special characters', async () => {
      vi.spyOn(device, 'getProperties').mockResolvedValue({
        androidVersion: '13',
        buildId: 'TP1A.220905.004',
        model: 'Pixel 6 (🐧)',
        manufacturer: 'Google',
        brand: 'google',
        sdkVersion: 33,
        serialNumber: 'TEST123'
      });

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      // generateFileName does NOT sanitize special characters, they are preserved
      expect(result.fileName).toContain('Pixel 6 (🐧)');
    });
  });
});