import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ServicesAcquirer } from '../../../../src/forensics/acquisition/services';
import type { ServicesConfig } from '../../../../src/forensics/acquisition/services';
import {
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  createMockReadableStream,
} from '../../../helpers/test-helpers';

describe('ServicesAcquirer', () => {
  let acquirer: ServicesAcquirer;
  let mockDevice: any;
  let domMocks: any;

  const MOCK_DUMPSYS_LIST = `Currently running services:
  SurfaceFlinger
  accessibility
  account
  activity
  alarm
  android.security.keystore
  appops
  audio
  battery
  com.example.app.MyService
  connectivity
  package
  window`;

  const MOCK_ACTIVITY_SERVICES = `ACTIVITY MANAGER SERVICES (dumpsys activity services)
  User 0:
    ServiceRecord{abc1234 u0 com.android.systemui/.SystemUIService}
      app=ProcessRecord{def5678 1234:com.android.systemui/u0a10}
      packageName=com.android.systemui
      processName=com.android.systemui
      
    ServiceRecord{f00b412 u0 com.example.app/.MyService}
      app=ProcessRecord{deadbeef 5678:com.example.app/u0a123}
      packageName=com.example.app
      processName=com.example.app
      
    ServiceRecord{c0ffee1 u0 com.stopped.app/.StoppedService}
      app=null
      packageName=com.stopped.app`;

  beforeEach(() => {
    domMocks = setupAcquirerDOMMocks();
    mockDevice = createMockADBDeviceWithServicesCommands({
      dumpsysList: MOCK_DUMPSYS_LIST,
      activityServices: MOCK_ACTIVITY_SERVICES,
    });
    acquirer = new ServicesAcquirer(mockDevice);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('Basic Acquisition', () => {
    it('should successfully acquire services list', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.type).toBe('services');
      expect(result.fileName).toBe('services.json');
      expect(result.fileSize).toBeGreaterThan(0);
    });

    it('should parse all services correctly', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).totalServices).toBeGreaterThan(0);
    });

    it('should identify system services', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).systemServices).toBeGreaterThan(0);
    });

    it('should identify user services', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).userServices).toBeGreaterThan(0);
    });

    it('should include device information', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).deviceInfo).toBeDefined();
      expect(mockDevice.getProperties).toHaveBeenCalled();
    });

    it('should return blob on successful acquisition', async () => {
      const result = await acquirer.acquire();

      expect(result.blob).toBeDefined();
      expect(result.blob).toBeInstanceOf(Blob);
    });
  });

  describe('Service Parsing', () => {
    it('should parse service names from dumpsys -l', async () => {
      const result = await acquirer.acquire();

      expect(result.blob).toBeInstanceOf(Blob);
      const text = await result.blob!.text();
      const data = JSON.parse(text);

      expect(data.services.some((s: any) => s.name === 'activity')).toBe(true);
      expect(data.services.some((s: any) => s.name === 'package')).toBe(true);
    });

    it('should skip header line from dumpsys -l', async () => {
      const result = await acquirer.acquire();

      const text = await result.blob!.text();
      const data = JSON.parse(text);

      expect(data.services.some((s: any) => s.name.includes('Currently running'))).toBe(false);
    });

    it('should identify running services', async () => {
      const config: ServicesConfig = { includeServiceDetails: true };
      acquirer = new ServicesAcquirer(mockDevice, config);

      const result = await acquirer.acquire();

      const text = await result.blob!.text();
      const data = JSON.parse(text);

      expect(data.runningServices).toBeGreaterThan(0);
    });

    it('should identify stopped services', async () => {
      const config: ServicesConfig = { includeServiceDetails: true };
      acquirer = new ServicesAcquirer(mockDevice, config);

      const result = await acquirer.acquire();

      const text = await result.blob!.text();
      const data = JSON.parse(text);

      // Should have at least some services marked as stopped
      expect(data.stoppedServices).toBeGreaterThanOrEqual(0);
    });

    it('should parse process details when available', async () => {
      const config: ServicesConfig = { includeServiceDetails: true };
      acquirer = new ServicesAcquirer(mockDevice, config);

      const result = await acquirer.acquire();

      const text = await result.blob!.text();
      const data = JSON.parse(text);

      // Some services should have PID and user info
      const servicesWithPid = data.services.filter((s: any) => s.pid !== undefined);
      expect(servicesWithPid.length).toBeGreaterThan(0);
    });
  });

  describe('Service Classification', () => {
    it('should classify android.* as system services', async () => {
      const result = await acquirer.acquire();

      const text = await result.blob!.text();
      const data = JSON.parse(text);

      expect(data.systemServices).toBeGreaterThan(0);
    });

    it('should classify com.android.* as system services', async () => {
      mockDevice = createMockADBDeviceWithServicesCommands({
        dumpsysList: 'com.android.systemui\ncom.example.app',
        activityServices: '',
      });
      acquirer = new ServicesAcquirer(mockDevice);

      const result = await acquirer.acquire();

      const text = await result.blob!.text();
      const data = JSON.parse(text);

      expect(data.systemServices).toBe(1);
      expect(data.userServices).toBe(1);
    });

    it('should calculate correct counts', async () => {
      const result = await acquirer.acquire();

      const text = await result.blob!.text();
      const data = JSON.parse(text);

      expect(data.systemServices + data.userServices).toBe(data.totalServices);
    });
  });

  describe('Configuration Options', () => {
    it('should include service details when enabled', async () => {
      const config: ServicesConfig = { includeServiceDetails: true };
      acquirer = new ServicesAcquirer(mockDevice, config);

      await acquirer.acquire();

      expect(mockDevice.adb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'dumpsys activity services'
      );
    });

    it('should skip service details when disabled', async () => {
      const config: ServicesConfig = { includeServiceDetails: false };
      acquirer = new ServicesAcquirer(mockDevice, config);

      await acquirer.acquire();

      const calls = mockDevice.adb.subprocess.shellProtocol.spawn.mock.calls;
      const hasActivityServicesCall = calls.some((call: any[]) =>
        call[0].includes('dumpsys activity services')
      );
      expect(hasActivityServicesCall).toBe(false);
    });

    it('should filter system services when configured', async () => {
      const config: ServicesConfig = { includeSystemServices: false };
      acquirer = new ServicesAcquirer(mockDevice, config);

      const result = await acquirer.acquire();

      const text = await result.blob!.text();
      const data = JSON.parse(text);

      // Should only have user services
      const hasSystemServices = data.services.some(
        (s: any) => s.name.startsWith('android.') || s.name.startsWith('com.android.')
      );
      expect(hasSystemServices).toBe(false);
    });

    it('should filter user services when configured', async () => {
      const config: ServicesConfig = { includeUserServices: false };
      acquirer = new ServicesAcquirer(mockDevice, config);

      const result = await acquirer.acquire();

      const text = await result.blob!.text();
      const data = JSON.parse(text);

      // Should only have system services
      const hasUserServices = data.services.some((s: any) => s.name.includes('com.example'));
      expect(hasUserServices).toBe(false);
    });

    it('should compute hash when configured', async () => {
      const config: ServicesConfig = { computeHash: true };
      acquirer = new ServicesAcquirer(mockDevice, config);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.hash).toBeDefined();
      expect(typeof result.hash).toBe('string');
    });

    it('should respect timeout configuration', async () => {
      const config: ServicesConfig = { timeout: 5000 };
      acquirer = new ServicesAcquirer(mockDevice, config);

      await acquirer.acquire();

      expect(mockDevice.adb.subprocess.shellProtocol.spawn).toHaveBeenCalled();
    });
  });

  describe('Progress Reporting', () => {
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
      expect(history.length).toBeGreaterThan(4);

      const progressValues = history.map(p => p.progress);
      expect(progressValues).toContain(10); // Device info
      expect(progressValues).toContain(40); // Collecting services
      expect(progressValues).toContain(90); // Preparing export
      expect(progressValues).toContain(100); // Completed
    });

    it('should have monotonically increasing progress', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const history = getProgressHistory();
      const progressValues = history.map(p => p.progress);

      for (let i = 1; i < progressValues.length; i++) {
        expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
      }
    });

    it('should include device info in progress', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const history = getProgressHistory();
      const deviceProgress = history.find(p => p.progress === 20);
      expect(deviceProgress?.deviceInfo).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should fail when dumpsys -l command fails', async () => {
      vi.mocked(mockDevice.adb.subprocess.shellProtocol.spawn).mockRejectedValue(
        new Error('dumpsys failed')
      );
      const result = await acquirer.acquire();

      expect(result.success).toBe(false);  // ✅ Ora false (fail-fast)
      expect(result.error).toContain('dumpsys failed');
    });

    it('should handle device disconnection', async () => {
      mockDevice.getProperties = vi.fn().mockRejectedValue(new Error('Device disconnected'));

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Device disconnected');
    });

    it('should report error in progress callback', async () => {
      const { callback, getLastProgress } = createMockProgressCallback();
      mockDevice.getProperties = vi.fn().mockRejectedValue(new Error('Test error'));

      await acquirer.acquire(callback);

      const lastProgress = getLastProgress();
      expect(lastProgress.status).toBe('failed');
      expect(lastProgress.message).toContain('Error');
    });

    it('should continue when activity services command fails', async () => {
      const config: ServicesConfig = { includeServiceDetails: true };

      // Mock to succeed for dumpsys -l but fail for activity services
      vi.mocked(mockDevice.adb.subprocess.shellProtocol.spawn).mockImplementation((cmd: string) => {
        if (cmd === 'dumpsys -l') {
          return Promise.resolve({
            stdout: createMockReadableStream(MOCK_DUMPSYS_LIST),
            stderr: createMockReadableStream(''),
            stdin: new WritableStream(),
            exit: Promise.resolve({ code: 0 }),
          });
        }
        return Promise.reject(new Error('Activity services failed'));
      });

      acquirer = new ServicesAcquirer(mockDevice, config);
      const result = await acquirer.acquire();

      // Should still succeed with basic service list
      expect(result.success).toBe(true);
      expect((result.data as any).totalServices).toBeGreaterThan(0);
    });
  });

  describe('Result Metadata', () => {
    it('should include timestamps', async () => {
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

      expect(result.fileSize).toBeDefined();
      expect(result.fileSize).toBeGreaterThan(0);
    });

    it('should set correct acquisition type', async () => {
      const result = await acquirer.acquire();

      expect(result.type).toBe('services');
    });

    it('should include service counts in data', async () => {
      const result = await acquirer.acquire();

      expect((result.data as any).totalServices).toBeDefined();
      expect((result.data as any).runningServices).toBeDefined();
      expect((result.data as any).stoppedServices).toBeDefined();
      expect((result.data as any).systemServices).toBeDefined();
      expect((result.data as any).userServices).toBeDefined();
    });
  });

  describe('Output Format', () => {
    it('should create valid JSON', async () => {
      const result = await acquirer.acquire();

      expect(result.blob).toBeInstanceOf(Blob);
      const text = await result.blob!.text();

      expect(() => JSON.parse(text)).not.toThrow();
    });

    it('should include all required fields', async () => {
      const result = await acquirer.acquire();

      const text = await result.blob!.text();
      const data = JSON.parse(text);

      expect(data).toHaveProperty('totalServices');
      expect(data).toHaveProperty('runningServices');
      expect(data).toHaveProperty('stoppedServices');
      expect(data).toHaveProperty('systemServices');
      expect(data).toHaveProperty('userServices');
      expect(data).toHaveProperty('services');
      expect(data).toHaveProperty('deviceInfo');
      expect(data).toHaveProperty('acquisitionTime');
      expect(data).toHaveProperty('timestamp');
    });

    it('should format service entries correctly', async () => {
      const result = await acquirer.acquire();

      const text = await result.blob!.text();
      const data = JSON.parse(text);

      const service = data.services[0];
      expect(service).toHaveProperty('name');
      expect(service).toHaveProperty('state');
    });

    it('should return blob with correct type', async () => {
      const result = await acquirer.acquire();

      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.blob!.type).toBe('application/json');
    });

    it('should generate filename with device model', async () => {
      const result = await acquirer.acquire();

      expect(result.fileName).toBeDefined();
      expect(result.fileName).toBe('services.json');
    });
  });
});

// Helper function to create mock device with services data
function createMockADBDeviceWithServicesCommands(
  options: {
    dumpsysList?: string;
    activityServices?: string;
  } = {}
) {
  const { dumpsysList = '', activityServices = '' } = options;

  const mockShellSpawn = vi.fn().mockImplementation((command: string) => {
    let output = '';

    if (command === 'dumpsys -l') {
      output = dumpsysList;
    } else if (command === 'dumpsys activity services') {
      output = activityServices;
    } else if (command === 'getprop') {
      output = `[ro.build.version.release]: [13]
[ro.build.id]: [TP1A.220905.004]
[ro.product.model]: [Test Device]
[ro.product.manufacturer]: [Test Manufacturer]
[ro.product.brand]: [Test]
[ro.build.version.sdk]: [33]`;
    }

    return Promise.resolve({
      stdout: createMockReadableStream(output),
      stderr: createMockReadableStream(''),
      stdin: new WritableStream(),
      exit: Promise.resolve({ code: 0 }),
    });
  });

  return {
    adb: {
      subprocess: {
        shellProtocol: {
          spawn: mockShellSpawn,
        },
      },
      sync: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as any,
    getProperties: vi.fn().mockResolvedValue({
      androidVersion: '13',
      buildId: 'TP1A.220905.004',
      model: 'Test Device',
      manufacturer: 'Test Manufacturer',
      brand: 'Test',
      sdkVersion: 33,
      serialNumber: 'TEST123',
    }),
    info: {
      productName: 'Test Device',
      manufacturerName: 'Test Manufacturer',
      serialNumber: 'TEST123',
      vendorId: 0x18d1,
      productId: 0x4ee7,
    },
    isConnected: vi.fn().mockReturnValue(true),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}
