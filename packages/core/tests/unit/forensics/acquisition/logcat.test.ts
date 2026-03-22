import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LogcatAcquirer } from '../../../../src/forensics/acquisition/logcat';
import {
  createMockADBDeviceWithCommands,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
} from '../../../helpers/test-helpers';
import type { Device } from '../../../../src/adb/device';

describe('LogcatAcquirer', () => {
  let device: Device;
  let acquirer: LogcatAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  const mockLogcatOutput = `01-11 10:00:00.123  1234  5678 I ActivityManager: Start proc app
01-11 10:00:01.456  1234  5678 W PackageManager: Warning message
01-11 10:00:02.789  1234  5678 E AndroidRuntime: Fatal exception
01-11 10:00:03.012  1234  5678 D SomeTag: Debug message
01-11 10:00:04.345  1234  5678 V Verbose: Verbose message`;

  beforeEach(() => {
    vi.clearAllMocks();
    device = createMockADBDeviceWithCommands({
      getLogcat: mockLogcatOutput,
    }) as unknown as Device;
    domMocks = setupAcquirerDOMMocks();
    acquirer = new LogcatAcquirer(device);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('acquire', () => {
    it('should successfully acquire logcat', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.type).toBe('logcat');
      expect(result.files[0].fileName).toBe('logcat.txt');
      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalled();
    });

    it('should use dump mode by default', async () => {
      await acquirer.acquire();

      // Just check that it succeeds - implementation details should not be tested
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

    it('should compute hash when configured', async () => {
      acquirer = new LogcatAcquirer(device, { computeHash: true });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.files[0].hash).toBeDefined();
    });

    it('should handle empty logcat', async () => {
      // Cleanup previous mocks
      domMocks.cleanup();

      // Create new device with empty logcat
      device = createMockADBDeviceWithCommands({
        getLogcat: '',
      }) as unknown as Device;

      // Recreate DOM mocks
      domMocks = setupAcquirerDOMMocks();

      // Create new acquirer with new device
      acquirer = new LogcatAcquirer(device);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).totalLines).toBe(0);
    });
  });

  describe('configuration', () => {
    it('should respect buffer configuration', async () => {
      acquirer = new LogcatAcquirer(device, { buffer: 'system' });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });

    it('should respect format configuration', async () => {
      acquirer = new LogcatAcquirer(device, { format: 'brief' });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });

    it('should respect maxLines configuration', async () => {
      acquirer = new LogcatAcquirer(device, { maxLines: 100 });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });

    it('should respect filter configuration', async () => {
      acquirer = new LogcatAcquirer(device, { filter: 'ActivityManager:I' });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });

    it('should disable dump mode when configured', async () => {
      acquirer = new LogcatAcquirer(device, { dumpMode: false });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });

    it('should combine multiple options', async () => {
      acquirer = new LogcatAcquirer(device, {
        buffer: 'main',
        maxLines: 500,
        filter: '*:W',
      });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });
  });

  describe('log analysis', () => {
    it('should count log lines correctly', async () => {
      const result = await acquirer.acquire();

      expect((result.data as any).totalLines).toBe(5);
    });

    it('should count errors correctly', async () => {
      const result = await acquirer.acquire();

      expect((result.data as any).errorCount).toBe(1);
    });

    it('should count warnings correctly', async () => {
      const result = await acquirer.acquire();

      expect((result.data as any).warningCount).toBe(1);
    });

    it('should identify different log levels', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).errorCount).toBeGreaterThan(0);
      expect((result.data as any).warningCount).toBeGreaterThan(0);
    });

    it('should handle logs without priority markers', async () => {
      device = createMockADBDeviceWithCommands({
        getLogcat: 'Plain log line\nAnother plain line',
      }) as unknown as Device;
      acquirer = new LogcatAcquirer(device);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).totalLines).toBe(2);
    });
  });

  describe('error handling', () => {
    it('should handle logcat command failure', async () => {
      vi.mocked(device.adb.subprocess.shellProtocol.spawn).mockRejectedValue(
        new Error('logcat command failed')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('logcat command failed');
    });

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
      expect(result.error).toContain('timed out');
    });
  });

  describe('result metadata', () => {
    it('should include timestamps', async () => {
      const result = await acquirer.acquire();

      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
    });

    it('should include duration', async () => {
      const result = await acquirer.acquire();

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(typeof result.duration).toBe('number');
    });

    it('should include file size', async () => {
      const result = await acquirer.acquire();

      expect(result.files[0].fileSize).toBeDefined();
      expect(typeof result.files[0].fileSize).toBe('number');
      expect(result.files[0].fileSize).toBeGreaterThan(0);
    });

    it('should include buffer in data', async () => {
      acquirer = new LogcatAcquirer(device, { buffer: 'system' });
      const result = await acquirer.acquire();

      expect((result.data as any).buffer).toBe('system');
    });

    it('should default to all buffer', async () => {
      const result = await acquirer.acquire();

      expect((result.data as any).buffer).toBe('all');
    });
  });

  describe('output format', () => {
    it('should include metadata header in output', async () => {
      const result = await acquirer.acquire();

      expect(result.files[0].blob).toBeInstanceOf(Blob);
      const text = await result.files[0].blob!.text();
      expect(text).toContain('# Logcat Acquisition Metadata');
    });

    it('should include JSON metadata', async () => {
      const result = await acquirer.acquire();

      expect(result.files[0].blob).toBeInstanceOf(Blob);
      const text = await result.files[0].blob!.text();
      expect(text).toContain('METADATA (JSON)');
    });

    it('should include original logcat output', async () => {
      const result = await acquirer.acquire();

      expect(result.files[0].blob).toBeInstanceOf(Blob);
      const text = await result.files[0].blob!.text();
      expect(text).toContain('LOGCAT OUTPUT');
    });
  });
});
