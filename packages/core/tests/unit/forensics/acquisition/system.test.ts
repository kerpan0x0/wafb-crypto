import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SystemInfoAcquirer } from '../../../../src/forensics/acquisition/system';
import { 
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  createMockDeviceInfo,
  createMockDeviceProperties,
  createMockConnection
} from '../../../helpers/test-helpers';
import type { ADBDevice } from '../../../../src/adb/device';
import type { 
  BatteryInfo, 
  NetworkInfo, 
  StorageInfo, 
  MemoryInfo, 
  SensorInfo 
} from '../../../../src/adb/base';

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
    
    // Create a complete mock ADBDevice
    device = {
      info: createMockDeviceInfo(),
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
      expect(device.commands.getprop).toHaveBeenCalled();
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
      expect(device.getBatteryInfo).toHaveBeenCalled();
    });

    it('should skip battery info when disabled', async () => {
      acquirer = new SystemInfoAcquirer(device, { includeBattery: false });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.battery).toBe(false);
      expect(device.getBatteryInfo).not.toHaveBeenCalled();
    });

    it('should handle battery info errors gracefully', async () => {
      vi.mocked(device.getBatteryInfo).mockRejectedValue(
        new Error('Battery service unavailable')
      );

      const result = await acquirer.acquire();

      // Should still succeed because errors are caught in device.getBatteryInfo
      // which returns default values
      expect(result.success).toBe(true);
    });
  });

  describe('network information', () => {
    it('should collect network info when enabled', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.network).toBe(true);
      expect(device.getNetworkInfo).toHaveBeenCalled();
    });

    it('should skip network info when disabled', async () => {
      acquirer = new SystemInfoAcquirer(device, { includeNetwork: false });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.network).toBe(false);
      expect(device.getNetworkInfo).not.toHaveBeenCalled();
    });

    it('should handle network info errors gracefully', async () => {
      vi.mocked(device.getNetworkInfo).mockRejectedValue(
        new Error('Settings unavailable')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });
  });

  describe('storage information', () => {
    it('should collect storage info when enabled', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.storage).toBe(true);
      expect(device.getStorageInfo).toHaveBeenCalled();
    });

    it('should skip storage info when disabled', async () => {
      acquirer = new SystemInfoAcquirer(device, { includeStorage: false });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.storage).toBe(false);
      expect(device.getStorageInfo).not.toHaveBeenCalled();
    });

    it('should handle storage info errors gracefully', async () => {
      vi.mocked(device.getStorageInfo).mockRejectedValue(
        new Error('df command failed')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });
  });

  describe('memory information', () => {
    it('should collect memory info when enabled', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.memory).toBe(true);
      expect(device.getMemoryInfo).toHaveBeenCalled();
    });

    it('should skip memory info when disabled', async () => {
      acquirer = new SystemInfoAcquirer(device, { includeMemory: false });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.memory).toBe(false);
      expect(device.getMemoryInfo).not.toHaveBeenCalled();
    });

    it('should handle memory info errors gracefully', async () => {
      vi.mocked(device.getMemoryInfo).mockRejectedValue(
        new Error('meminfo unavailable')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });
  });

  describe('sensors information', () => {
    it('should collect sensors info when enabled', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.sensors).toBe(true);
      expect(device.getSensors).toHaveBeenCalled();
    });

    it('should skip sensors info when disabled', async () => {
      acquirer = new SystemInfoAcquirer(device, { includeSensors: false });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.sensors).toBe(false);
      expect(device.getSensors).not.toHaveBeenCalled();
    });

    it('should handle sensors info errors gracefully', async () => {
      vi.mocked(device.getSensors).mockRejectedValue(
        new Error('sensorservice unavailable')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
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

    it('should handle getprop failure', async () => {
      vi.mocked(device.commands.getprop).mockRejectedValue(
        new Error('getprop failed')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('getprop failed');
    });

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