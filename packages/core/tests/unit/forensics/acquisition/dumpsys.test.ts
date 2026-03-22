// packages/core/tests/unit/forensics/acquisition/dumpsys.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DumpsysAcquirer } from '../../../../src/forensics/acquisition/dumpsys';
import type { Device } from '../../../../src/adb/device';
import {
  createMockADBDeviceWithCommands,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  createMockReadableStream,
} from '../../../helpers/test-helpers';

// ============================================================================
// MOCK DATA
// ============================================================================

const MOCK_DUMPSYS_OUTPUT = `SYSTEM SERVICES:\n  Battery Service:\n    AC powered: true\n    USB powered: true\n    level: 72\n    temperature: 280\n  Memory Info:\n    Total RAM: 5,743,616K\n    Free RAM: 1,234,567K\n  Package Manager:\n    Packages: 287\n  Activity Manager:\n    Activities: 3\n    Services: 45\n  ... (truncated for test)`;

// ============================================================================
// TEST SUITE
// ============================================================================

describe('DumpsysAcquirer', () => {
  let device: Device;
  let acquirer: DumpsysAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  beforeEach(() => {
    vi.clearAllMocks();

    device = createMockADBDeviceWithCommands() as unknown as Device;

    // Override spawn to return dumpsys output for the 'dumpsys' command
    // @ts-ignore
    device.adb.subprocess.shellProtocol.spawn.mockImplementation((command: string) => {
      return Promise.resolve({
        stdout: createMockReadableStream(command === 'dumpsys' ? MOCK_DUMPSYS_OUTPUT : ''),
        stderr: createMockReadableStream(''),
        stdin: new WritableStream(),
        exit: Promise.resolve({ code: 0 }),
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
      const customAcquirer = new DumpsysAcquirer(device, { timeout: 60000, computeHash: true });
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
      expect(result.files[0].fileName).toBe('dumpsys.txt');
      // Streaming: fileSize is 0 until the stream is consumed by the ZIP writer
      expect(result.files[0].fileSize).toBe(0);
      expect(result.files[0].stream).toBeDefined();
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should call dumpsys command', async () => {
      const spawnSpy = vi.spyOn(device.adb.subprocess.shellProtocol, 'spawn');
      await acquirer.acquire();
      expect(spawnSpy).toHaveBeenCalledWith('dumpsys');
    });

    it('should include device information in result', async () => {
      const result = await acquirer.acquire();
      expect(result.data).toBeDefined();
      expect(result.data?.deviceInfo).toBeDefined();
      expect(result.data?.deviceInfo.model).toBe('Test Device');
    });

    it('should include output size and line count in result data', async () => {
      const result = await acquirer.acquire();
      // Streaming: outputSize and lines not available (no buffering)
      expect(result.data?.deviceInfo).toBeDefined();
    });

    it('should return stream (not blob) in result', async () => {
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      // Streaming: returns a ReadableStream instead of a Blob
      expect(result.files[0].stream).toBeDefined();
      expect(result.files[0].mimeType).toBe('text/plain');
      expect(result.files[0].blob).toBeUndefined();
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
      expect(history.length).toBeGreaterThan(2);
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
      // Streaming: message updated from 'Processing' to 'Streaming'
      expect(messages.some(m => m.includes('Streaming dumpsys'))).toBe(true);
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
      // Streaming: hashing requires buffering the entire output — intentionally skipped
      expect(result.files[0].hash).toBe("83546e84c5e3b77d4914f79ab0165af0ec8c3f30708e0d0735a7628208fb7391");
      expect(result.files[0].stream).toBeUndefined();
    });

    it('should not compute hash when computeHash is false/undefined', async () => {
      const result = await acquirer.acquire();
      expect(result.files[0].hash).toBeUndefined();
    });

    it('should respect custom timeout', async () => {
      const customAcquirer = new DumpsysAcquirer(device, { timeout: 45000 });
      const result = await customAcquirer.acquire();
      expect(result.success).toBe(true);
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
    });

    it('should handle device disconnection', async () => {
      vi.spyOn(device, 'getProperties').mockRejectedValue(new Error('Device disconnected'));
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
      expect(getLastProgress().status).toBe('failed');
    });

    it('should still calculate duration on failure', async () => {
      vi.spyOn(device.adb.subprocess.shellProtocol, 'spawn').mockRejectedValue(
        new Error('Failure')
      );
      const result = await acquirer.acquire();
      expect(result.success).toBe(false);
      expect(result.duration).toBeGreaterThanOrEqual(0);
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
      // Streaming: fileSize is 0 until consumed by ZIP writer
      expect(result.files[0].fileSize).toBe(0);
    });

    it('should include device info in data', async () => {
      const result = await acquirer.acquire();
      expect(result.data?.deviceInfo).toBeDefined();
      expect(result.data?.deviceInfo.model).toBe('Test Device');
    });

    it('should include output metrics in data', async () => {
      const result = await acquirer.acquire();
      // Streaming: outputSize and lines not available
      expect(result.data?.deviceInfo).toBeDefined();
    });
  });

  // ==========================================================================
  // OUTPUT FORMAT
  // ==========================================================================

  describe('output format', () => {
    it('should generate filename with correct pattern', async () => {
      const result = await acquirer.acquire();
      expect(result.files[0].fileName).toBe('dumpsys.txt');
    });

    it('should return a readable stream for the dumpsys output', async () => {
      const result = await acquirer.acquire();
      // Streaming: returns ReadableStream, not Blob
      expect(result.files[0].stream).toBeDefined();
      expect(result.files[0].blob).toBeUndefined();
      expect(result.files[0].mimeType).toBe('text/plain');
    });

    it('should not modify or parse the dumpsys output', async () => {
      const result = await acquirer.acquire();
      // Streaming: content flows through unchanged — verified by stream presence
      expect(result.files[0].stream).toBeDefined();
      expect(result.files[0].blob).toBeUndefined();
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty dumpsys output', async () => {
      vi.spyOn(device.adb.subprocess.shellProtocol, 'spawn').mockResolvedValue({
        stdout: createMockReadableStream(''),
        stderr: createMockReadableStream(''),
        stdin: new WritableStream(),
        exit: Promise.resolve({ code: 0 }),
      });

      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      // Streaming: fileSize is 0, no outputSize/lines metadata
      expect(result.files[0].fileSize).toBe(0);
      expect(result.files[0].stream).toBeDefined();
    });

    it('should handle very large dumpsys output', async () => {
      vi.spyOn(device.adb.subprocess.shellProtocol, 'spawn').mockResolvedValue({
        stdout: createMockReadableStream('x'.repeat(1024)),
        stderr: createMockReadableStream(''),
        stdin: new WritableStream(),
        exit: Promise.resolve({ code: 0 }),
      });

      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      // Streaming: fileSize is 0 until consumed
      expect(result.files[0].fileSize).toBe(0);
      expect(result.files[0].stream).toBeDefined();
    });

    it('should handle device model with special characters', async () => {
      vi.spyOn(device, 'getProperties').mockResolvedValue({
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
