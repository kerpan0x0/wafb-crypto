import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SystemInfoAcquirer } from '../../../../src/forensics/acquisition/system';
import { 
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  createMockDeviceInfo,
  createMockDeviceProperties,
  createMockReadableStream
} from '../../../helpers/test-helpers';
import type { ADBDevice } from '../../../../src/adb/device';
import { 
  BatteryInfo, 
  MemoryInfo, 
  NetworkInfo, 
  SensorInfo, 
  StorageInfo,
  GetBatteryInfoCommand,
  GetNetworkInfoCommand,
  GetStorageInfoCommand,
  GetMemoryInfoCommand,
  GetSensorsCommand,
  GetPropCommand
} from '../../../../src/adb/commands';

// Mock the command classes
vi.mock('../../../../src/adb/commands', async () => {
  const actual = await vi.importActual('../../../../src/adb/commands');
  return {
    ...actual,
    GetBatteryInfoCommand: vi.fn(),
    GetNetworkInfoCommand: vi.fn(),
    GetStorageInfoCommand: vi.fn(),
    GetMemoryInfoCommand: vi.fn(),
    GetSensorsCommand: vi.fn(),
    GetPropCommand: vi.fn()
  };
});

describe('SystemInfoAcquirer', () => {
  let device: ADBDevice;
  let acquirer: SystemInfoAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  // Mock data returned by device methods
  const mockBatteryInfo: BatteryInfo = {
    level: 85,
    temperature: 28,
    voltage: 4200,
    status: 'Charging',
    health: 'Good',
    technology: 'Li-ion',
    present: true
  };

  const mockNetworkInfo: NetworkInfo = {
    wifiEnabled: true,
    mobileDataEnabled: false,
    airplaneModeOn: false,
    activeNetworkType: 'WiFi'
  };

  const mockStorageInfo: StorageInfo = {
    totalInternal: '64G',
    availableInternal: '19G'
  };

  const mockMemoryInfo: MemoryInfo = {
    totalRam: '8,192,000K',
    availableRam: '4,096,000K',
    lowMemory: false,
    threshold: '512,000K'
  };

  const mockSensors: SensorInfo[] = [
    {
      name: 'BMI160 Accelerometer',
      type: '1',
      vendor: 'Bosch',
      version: '1'
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup command mocks
    vi.mocked(GetPropCommand).mockImplementation(() => ({
      exec: vi.fn().mockResolvedValue({
        'ro.bootloader': 'bootloader-v1',
        'ro.hardware': 'qcom',
        'ro.build.fingerprint': 'test/fingerprint'
      })
    } as any));

    vi.mocked(GetBatteryInfoCommand).mockImplementation(() => ({
      exec: vi.fn().mockResolvedValue(mockBatteryInfo)
    } as any));

    vi.mocked(GetNetworkInfoCommand).mockImplementation(() => ({
      exec: vi.fn().mockResolvedValue(mockNetworkInfo)
    } as any));

    vi.mocked(GetStorageInfoCommand).mockImplementation(() => ({
      exec: vi.fn().mockResolvedValue(mockStorageInfo)
    } as any));

    vi.mocked(GetMemoryInfoCommand).mockImplementation(() => ({
      exec: vi.fn().mockResolvedValue(mockMemoryInfo)
    } as any));

    vi.mocked(GetSensorsCommand).mockImplementation(() => ({
      exec: vi.fn().mockResolvedValue(mockSensors)
    } as any));

    // Create a complete mock ADBDevice
    device = {
      info: createMockDeviceInfo(),
      adb: {
        subprocess: {
          shellProtocol: {
            spawn: vi.fn().mockResolvedValue({
              stdout: createMockReadableStream(''),
              stderr: createMockReadableStream(''),
              exit: Promise.resolve({ code: 0 })
            })
          }
        }
      },
      commands: {
        getprop: vi.fn().mockResolvedValue({
          'ro.bootloader': 'bootloader-v1',
          'ro.hardware': 'qcom',
          'ro.build.fingerprint': 'test/fingerprint'
        }),
        shell: vi.fn().mockResolvedValue('')
      },
      getProperties: vi.fn().mockResolvedValue(createMockDeviceProperties()),
      getBatteryInfo: vi.fn().mockResolvedValue(mockBatteryInfo),
      getNetworkInfo: vi.fn().mockResolvedValue(mockNetworkInfo),
      getStorageInfo: vi.fn().mockResolvedValue(mockStorageInfo),
      getMemoryInfo: vi.fn().mockResolvedValue(mockMemoryInfo),
      getSensors: vi.fn().mockResolvedValue(mockSensors),
      isRooted: vi.fn().mockResolvedValue(false),
      isConnected: vi.fn().mockReturnValue(true),
      disconnect: vi.fn().mockResolvedValue(undefined)
    } as unknown as ADBDevice;
    
    domMocks = setupAcquirerDOMMocks();
    acquirer = new SystemInfoAcquirer(device);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('acquire', () => {
    it('should successfully acquire system information', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.type).toBe('system_info');
      expect(result.fileName).toMatch(/system-info-.*\.json/);
      expect(device.getProperties).toHaveBeenCalled();
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
      acquirer = new SystemInfoAcquirer(device, { computeHash: true });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.hash).toBeDefined();
      expect(typeof result.hash).toBe('string');
    });

    it('should include device information', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).deviceInfo).toBeDefined();
      expect((result.data as any).deviceInfo.model).toBe('Test Device');
    });

    it('should collect all components by default', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      const components = (result.data as any).componentsCollected;
      expect(components.battery).toBe(true);
      expect(components.network).toBe(true);
      expect(components.storage).toBe(true);
      expect(components.memory).toBe(true);
      expect(components.sensors).toBe(true);
    });
  });

  describe('battery information', () => {
    it('should collect battery info when enabled', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.battery).toBe(true);
      expect(GetBatteryInfoCommand).toHaveBeenCalled();
    });

    it('should skip battery info when disabled', async () => {
      acquirer = new SystemInfoAcquirer(device, { includeBattery: false });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.battery).toBe(false);
    });

    it('should handle battery info errors gracefully', async () => {
      vi.mocked(GetBatteryInfoCommand).mockImplementation(() => ({
        exec: vi.fn().mockRejectedValue(new Error('Battery service unavailable'))
      } as any));
      acquirer = new SystemInfoAcquirer(device);

      const result = await acquirer.acquire();

      // Should still succeed because errors are caught and default values are returned
      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.battery).toBe(true);
    });
  });

  describe('network information', () => {
    it('should collect network info when enabled', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.network).toBe(true);
      expect(GetNetworkInfoCommand).toHaveBeenCalled();
    });

    it('should skip network info when disabled', async () => {
      acquirer = new SystemInfoAcquirer(device, { includeNetwork: false });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.network).toBe(false);
    });

    it('should handle network info errors gracefully', async () => {
      vi.mocked(GetNetworkInfoCommand).mockImplementation(() => ({
        exec: vi.fn().mockRejectedValue(new Error('Settings unavailable'))
      } as any));
      acquirer = new SystemInfoAcquirer(device);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.network).toBe(true);
    });
  });

  describe('storage information', () => {
    it('should collect storage info when enabled', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.storage).toBe(true);
      expect(GetStorageInfoCommand).toHaveBeenCalled();
    });

    it('should skip storage info when disabled', async () => {
      acquirer = new SystemInfoAcquirer(device, { includeStorage: false });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.storage).toBe(false);
    });

    it('should handle storage info errors gracefully', async () => {
      vi.mocked(GetStorageInfoCommand).mockImplementation(() => ({
        exec: vi.fn().mockRejectedValue(new Error('df command failed'))
      } as any));
      acquirer = new SystemInfoAcquirer(device);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.storage).toBe(true);
    });
  });

  describe('memory information', () => {
    it('should collect memory info when enabled', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.memory).toBe(true);
      expect(GetMemoryInfoCommand).toHaveBeenCalled();
    });

    it('should skip memory info when disabled', async () => {
      acquirer = new SystemInfoAcquirer(device, { includeMemory: false });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.memory).toBe(false);
    });

    it('should handle memory info errors gracefully', async () => {
      vi.mocked(GetMemoryInfoCommand).mockImplementation(() => ({
        exec: vi.fn().mockRejectedValue(new Error('meminfo unavailable'))
      } as any));
      acquirer = new SystemInfoAcquirer(device);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.memory).toBe(true);
    });
  });

  describe('sensors information', () => {
    it('should collect sensors info when enabled', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.sensors).toBe(true);
      expect(GetSensorsCommand).toHaveBeenCalled();
    });

    it('should skip sensors info when disabled', async () => {
      acquirer = new SystemInfoAcquirer(device, { includeSensors: false });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.sensors).toBe(false);
    });

    it('should handle sensors info errors gracefully', async () => {
      vi.mocked(GetSensorsCommand).mockImplementation(() => ({
        exec: vi.fn().mockRejectedValue(new Error('sensorservice unavailable'))
      } as any));
      acquirer = new SystemInfoAcquirer(device);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.sensors).toBe(true);
    });
  });

  describe('configuration', () => {
    it('should respect multiple component configurations', async () => {
      acquirer = new SystemInfoAcquirer(device, {
        includeBattery: true,
        includeNetwork: false,
        includeStorage: true,
        includeMemory: false,
        includeSensors: true
      });

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      const components = (result.data as any).componentsCollected;
      expect(components.battery).toBe(true);
      expect(components.network).toBe(false);
      expect(components.storage).toBe(true);
      expect(components.memory).toBe(false);
      expect(components.sensors).toBe(true);
    });

    it('should respect computeHash configuration', async () => {
      acquirer = new SystemInfoAcquirer(device, { computeHash: true });
      const result = await acquirer.acquire();

      expect(result.hash).toBeDefined();
    });

    it('should work with all components disabled', async () => {
      acquirer = new SystemInfoAcquirer(device, {
        includeBattery: false,
        includeNetwork: false,
        includeStorage: false,
        includeMemory: false,
        includeSensors: false
      });

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      const components = (result.data as any).componentsCollected;
      expect(Object.values(components).every(v => v === false)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle getProperties failure', async () => {
      vi.mocked(device.getProperties).mockRejectedValue(
        new Error('Failed to get device properties')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to get device properties');
    });

    // GetPropCommand is now called internally by device.getProperties()
    // so this test is redundant - getProperties failure covers it
    it('should handle device disconnection', async () => {
      vi.mocked(device.getProperties).mockRejectedValue(
        new Error('Device disconnected')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Device disconnected');
    });
  });

  describe('progress reporting', () => {
    it('should report initial progress', async () => {
      const { callback } = createMockProgressCallback();
      await acquirer.acquire(callback);

      expect(callback.mock.calls[0][0].progress).toBe(10);
      expect(callback.mock.calls[0][0].message).toContain('device properties');
    });

    it('should report completion progress', async () => {
      const { callback, getLastProgress } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const lastProgress = getLastProgress();
      expect(lastProgress.progress).toBe(100);
      expect(lastProgress.status).toBe('completed');
    });

    it('should report progress for each component', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const progressValues = getProgressHistory().map(p => p.progress);
      
      // Should have multiple progress updates
      expect(progressValues.length).toBeGreaterThan(5);
      
      // Progress should increase
      for (let i = 1; i < progressValues.length; i++) {
        expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
      }
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

      expect(result.fileSize).toBeDefined();
      expect(typeof result.fileSize).toBe('number');
      expect(result.fileSize).toBeGreaterThan(0);
    });

    it('should include component collection status', async () => {
      const result = await acquirer.acquire();

      expect((result.data as any).componentsCollected).toBeDefined();
      expect(typeof (result.data as any).componentsCollected).toBe('object');
    });
  });

  describe('output format', () => {
    it('should create JSON output', async () => {
      await acquirer.acquire();

      expect(domMocks.mockAnchor.click).toHaveBeenCalled();
      expect(domMocks.mockAnchor.download).toMatch(/system-info-.*\.json/);
    });

    it('should trigger download', async () => {
      await acquirer.acquire();

      expect(domMocks.createObjectURLSpy).toHaveBeenCalled();
      expect(domMocks.mockAnchor.click).toHaveBeenCalled();
      expect(domMocks.revokeObjectURLSpy).toHaveBeenCalled();
    });
  });
});