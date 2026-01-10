import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LogcatAcquirer } from '../../../../src/forensics/acquisition/logcat';
import type { ADBDevice } from '../../../../src/adb/device';

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockDevice(overrides: any = {}): ADBDevice {
  const defaultDevice = {
    info: {
      productName: 'Test Device',
      manufacturerName: 'Test Manufacturer',
      serialNumber: 'TEST123',
      vendorId: 0x18D1,
      productId: 0x4EE7
    },
    commands: {
      shell: vi.fn(),
      getprop: vi.fn().mockResolvedValue({
        'ro.build.version.release': '13',
        'ro.build.id': 'TEST_BUILD',
        'ro.product.model': 'Test Device',
        'ro.product.manufacturer': 'Test Manufacturer',
        'ro.product.brand': 'Test',
        'ro.build.version.sdk': '33'
      })
    },
    getProperties: vi.fn().mockResolvedValue({
      androidVersion: '13',
      buildId: 'TEST_BUILD',
      model: 'Test Device',
      manufacturer: 'Test Manufacturer',
      brand: 'Test',
      sdkVersion: 33,
      serialNumber: 'TEST123'
    }),
    isConnected: vi.fn().mockReturnValue(true),
    disconnect: vi.fn()
  };

  return {
    ...defaultDevice,
    ...overrides,
    commands: {
      ...defaultDevice.commands,
      ...(overrides.commands || {})
    }
  } as any;
}

function mockDocumentForDownload() {
  const clickSpy = vi.fn();
  const createElement = vi.fn((tag: string) => {
    if (tag === 'a') {
      return {
        href: '',
        download: '',
        click: clickSpy,
        style: {}
      };
    }
    return {};
  });

  const appendChild = vi.fn();
  const removeChild = vi.fn();

  global.document = {
    createElement,
    body: {
      appendChild,
      removeChild
    }
  } as any;

  global.URL = {
    createObjectURL: vi.fn().mockReturnValue('blob:mock-url'),
    revokeObjectURL: vi.fn()
  } as any;

  global.Blob = vi.fn().mockImplementation((parts, options) => ({
    parts,
    options,
    size: parts[0]?.byteLength || parts[0]?.length || 0
  })) as any;

  return { clickSpy, createElement, appendChild, removeChild };
}

// Sample logcat output
const sampleLogcat = `01-10 10:30:15.123  1234  5678 I ActivityManager: Start proc com.example.app
01-10 10:30:15.456  1234  5678 D SystemUI: Notification posted
01-10 10:30:15.789  1234  5678 W PackageManager: Package not found
01-10 10:30:16.012  1234  5678 E AndroidRuntime: FATAL EXCEPTION
01-10 10:30:16.345  1234  5678 V VerboseTag: Verbose message`;

// ============================================================================
// Tests
// ============================================================================

describe('LogcatAcquirer', () => {
  let mockDevice: ADBDevice;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDevice = createMockDevice();
    mockDocumentForDownload();
  });

  // ==========================================================================
  // Basic Acquisition Tests
  // ==========================================================================

  describe('acquire', () => {
    it('should successfully acquire logcat', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const acquirer = new LogcatAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.type).toBe('logcat');
      expect(result.fileName).toMatch(/^logcat-.*\.txt$/);
      expect((result.data as any).totalLines).toBeGreaterThan(0);
    });

    it('should use dump mode by default', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const acquirer = new LogcatAcquirer(mockDevice);
      await acquirer.acquire();

      const shellCall = (mockDevice.commands.shell as any).mock.calls[0];
      expect(shellCall[0]).toContain('logcat -d');
    });

    it('should report progress during acquisition', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const progressCallback = vi.fn();
      const acquirer = new LogcatAcquirer(mockDevice);

      await acquirer.acquire(progressCallback);

      expect(progressCallback).toHaveBeenCalled();

      const calls = progressCallback.mock.calls.map(call => call[0]);

      // Should start with low progress
      expect(calls[0].progress).toBeLessThan(50);
      expect(calls[0].status).toBe('running');

      // Should end with 100%
      const lastCall = calls[calls.length - 1];
      expect(lastCall.progress).toBe(100);
      expect(lastCall.status).toBe('completed');
    });

    it('should compute hash when configured', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const acquirer = new LogcatAcquirer(mockDevice, {
        computeHash: true
      });

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.hash).toBeDefined();
      expect(result.hash).toHaveLength(64); // SHA-256
    });

    it('should handle empty logcat', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue('');

      const acquirer = new LogcatAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).totalLines).toBe(0);
    });
  });

  // ==========================================================================
  // Configuration Tests
  // ==========================================================================

  describe('configuration', () => {
    it('should respect buffer configuration', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const acquirer = new LogcatAcquirer(mockDevice, {
        buffer: 'system'
      });

      await acquirer.acquire();

      const shellCall = (mockDevice.commands.shell as any).mock.calls[0];
      expect(shellCall[0]).toContain('-b system');
    });

    it('should respect format configuration', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const acquirer = new LogcatAcquirer(mockDevice, {
        format: 'time'
      });

      await acquirer.acquire();

      const shellCall = (mockDevice.commands.shell as any).mock.calls[0];
      expect(shellCall[0]).toContain('-v time');
    });

    it('should respect maxLines configuration', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const acquirer = new LogcatAcquirer(mockDevice, {
        maxLines: 1000
      });

      await acquirer.acquire();

      const shellCall = (mockDevice.commands.shell as any).mock.calls[0];
      expect(shellCall[0]).toContain('-t 1000');
    });

    it('should respect filter configuration', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const acquirer = new LogcatAcquirer(mockDevice, {
        filter: 'ActivityManager:I *:S'
      });

      await acquirer.acquire();

      const shellCall = (mockDevice.commands.shell as any).mock.calls[0];
      expect(shellCall[0]).toContain('ActivityManager:I *:S');
    });

    it('should disable dump mode when configured', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const acquirer = new LogcatAcquirer(mockDevice, {
        dumpMode: false
      });

      await acquirer.acquire();

      const shellCall = (mockDevice.commands.shell as any).mock.calls[0];
      expect(shellCall[0]).not.toContain('-d');
    });

    it('should combine multiple options', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const acquirer = new LogcatAcquirer(mockDevice, {
        buffer: 'main',
        format: 'threadtime',
        maxLines: 500,
        filter: '*:W'
      });

      await acquirer.acquire();

      const shellCall = (mockDevice.commands.shell as any).mock.calls[0];
      const command = shellCall[0];

      expect(command).toContain('logcat');
      expect(command).toContain('-d');
      expect(command).toContain('-b main');
      expect(command).toContain('-v threadtime');
      expect(command).toContain('-t 500');
      expect(command).toContain('*:W');
    });
  });

  // ==========================================================================
  // Log Analysis Tests
  // ==========================================================================

  describe('log analysis', () => {
    it('should count log lines correctly', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const acquirer = new LogcatAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect((result.data as any).totalLines).toBe(5);
    });

    it('should count errors correctly', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const acquirer = new LogcatAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect((result.data as any).errorCount).toBe(1);
    });

    it('should count warnings correctly', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const acquirer = new LogcatAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect((result.data as any).warningCount).toBe(1);
    });

    it('should identify different log levels', async () => {
      const multiLevelLog = `01-10 10:00:00.000  1234  5678 V Tag: Verbose
01-10 10:00:01.000  1234  5678 D Tag: Debug
01-10 10:00:02.000  1234  5678 I Tag: Info
01-10 10:00:03.000  1234  5678 W Tag: Warning
01-10 10:00:04.000  1234  5678 E Tag: Error`;

      (mockDevice.commands.shell as any).mockResolvedValue(multiLevelLog);

      const acquirer = new LogcatAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).totalLines).toBe(5);
    });

    it('should handle logs without priority markers', async () => {
      const plainLog = `Some plain log line
Another plain log line
Third plain log line`;

      (mockDevice.commands.shell as any).mockResolvedValue(plainLog);

      const acquirer = new LogcatAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).totalLines).toBe(3);
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('error handling', () => {
    it('should handle logcat command failure', async () => {
      (mockDevice.commands.shell as any).mockRejectedValue(
        new Error('logcat command failed')
      );

      const acquirer = new LogcatAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('logcat command failed');
    });

    it('should handle device disconnection', async () => {
      (mockDevice.commands.shell as any).mockRejectedValue(
        new Error('Device disconnected')
      );

      const acquirer = new LogcatAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Device disconnected');
    });

    it('should handle timeout', async () => {
      (mockDevice.commands.shell as any).mockRejectedValue(
        new Error('Command timed out')
      );

      const acquirer = new LogcatAcquirer(mockDevice, {
        timeout: 5000
      });
      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });
  });

  // ==========================================================================
  // Result Metadata Tests
  // ==========================================================================

  describe('result metadata', () => {
    it('should include timestamps', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const beforeStart = new Date();
      const acquirer = new LogcatAcquirer(mockDevice);
      const result = await acquirer.acquire();
      const afterEnd = new Date();

      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
      expect(result.startTime.getTime()).toBeGreaterThanOrEqual(beforeStart.getTime());
      expect(result.endTime.getTime()).toBeLessThanOrEqual(afterEnd.getTime());
    });

    it('should include duration', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const acquirer = new LogcatAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.endTime.getTime() - result.startTime.getTime()).toBeGreaterThanOrEqual(result.duration);
    });

    it('should include file size', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const acquirer = new LogcatAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.fileSize).toBeGreaterThan(0);
    });

    it('should include buffer in data', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const acquirer = new LogcatAcquirer(mockDevice, {
        buffer: 'system'
      });
      const result = await acquirer.acquire();

      expect((result.data as any).buffer).toBe('system');
    });

    it('should default to all buffer', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const acquirer = new LogcatAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect((result.data as any).buffer).toBe('all');
    });
  });

  // ==========================================================================
  // Output Format Tests
  // ==========================================================================

  describe('output format', () => {
    it('should include metadata header in output', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const acquirer = new LogcatAcquirer(mockDevice);
      await acquirer.acquire();

      // Verify Blob was created with correct content structure
      const blobCall = (global.Blob as any).mock.calls[0];
      const content = new TextDecoder().decode(blobCall[0][0]);

      expect(content).toContain('# Logcat Acquisition Metadata');
      expect(content).toContain('# Device:');
      expect(content).toContain('# METADATA (JSON)');
      expect(content).toContain('# LOGCAT OUTPUT');
    });

    it('should include JSON metadata', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const acquirer = new LogcatAcquirer(mockDevice);
      await acquirer.acquire();

      const blobCall = (global.Blob as any).mock.calls[0];
      const content = new TextDecoder().decode(blobCall[0][0]);

      expect(content).toContain('"stats"');
      expect(content).toContain('"totalLines"');
      expect(content).toContain('"deviceInfo"');
    });

    it('should include original logcat output', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue(sampleLogcat);

      const acquirer = new LogcatAcquirer(mockDevice);
      await acquirer.acquire();

      const blobCall = (global.Blob as any).mock.calls[0];
      const content = new TextDecoder().decode(blobCall[0][0]);

      expect(content).toContain('ActivityManager');
      expect(content).toContain('FATAL EXCEPTION');
    });
  });
});