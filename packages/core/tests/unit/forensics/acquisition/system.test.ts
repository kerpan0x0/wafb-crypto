/**
 * @file systemInfoAcquirer.test.ts
 * @description Comprehensive tests for SystemInfoAcquirer with updated DumpsysCommand pattern
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SystemInfoAcquirer } from '../../../../src/forensics/acquisition/system';
import type { ADBDevice } from '../../../../src/adb';
import {
  createMockDeviceInfo,
  createMockDeviceProperties,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  createMockAdb,
  createMockShellSocket,
} from '../../../helpers/test-helpers';
import type { Adb } from '@yume-chan/adb';

// Import commands to spy on them
import { GetNetworkInfoCommand, GetStorageInfoCommand } from '../../../../src/adb/commands';

// Mock the command modules (but NOT DumpsysCommand!)
vi.mock('../../../../src/adb/commands', async () => {
  const actual = await vi.importActual('../../../../src/adb/commands');
  return {
    ...actual,
    GetNetworkInfoCommand: vi.fn(),
    GetStorageInfoCommand: vi.fn(),
  };
});

// ============================================================================
// MOCK DATA - Raw outputs that dumpsys commands would return
// ============================================================================

const MOCK_BATTERY_DUMPSYS_OUTPUT = `Current Battery Service state:
  AC powered: false
  USB powered: true
  status: 2
  health: 2
  present: true
  level: 85
  scale: 100
  voltage: 4200
  temperature: 280
  technology: Li-ion`;

const MOCK_MEMINFO_DUMPSYS_OUTPUT = `Applications Memory Usage (in Kilobytes):
Uptime: 12345678 Realtime: 12345678

Total RAM: 8,192,000K
Free RAM: 4,096,000K
Used RAM: 4,096,000K
Lost RAM: 0K
Low Memory: false
Threshold: 512,000K`;

const MOCK_SENSOR_DUMPSYS_OUTPUT = `Sensor List:
0x00000001) BMI160_Accelerometer          | Bosch           | ver: 1 | type: 1
   name=BMI160_Accelerometer
   vendor=Bosch
   version=1
   type=1
   
0x00000002) BMI160_Gyroscope               | Bosch           | ver: 1 | type: 4
   name=BMI160_Gyroscope
   vendor=Bosch
   version=1
   type=4`;

const MOCK_NETWORK_SETTINGS_OUTPUT = `wifi_on=1
mobile_data=0
airplane_mode_on=0`;

const MOCK_STORAGE_DF_OUTPUT = `Filesystem     1K-blocks    Used Available Use% Mounted on
/dev/block/dm-0 67108864 48234567 18874297  72% /data
tmpfs           4096000       0  4096000   0% /dev`;

describe('SystemInfoAcquirer', () => {
  let mockAdb: Adb;
  let device: ADBDevice;
  let acquirer: SystemInfoAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock Adb that will be used by DumpsysCommand
    mockAdb = createMockAdb() as unknown as Adb;

    // Configure network and storage command mocks
    vi.mocked(GetNetworkInfoCommand).mockImplementation(
      () =>
        ({
          exec: vi.fn().mockResolvedValue(MOCK_NETWORK_SETTINGS_OUTPUT),
        }) as any
    );

    vi.mocked(GetStorageInfoCommand).mockImplementation(
      () =>
        ({
          exec: vi.fn().mockResolvedValue(MOCK_STORAGE_DF_OUTPUT),
        }) as any
    );

    // Create complete mock ADBDevice
    device = {
      info: createMockDeviceInfo(),
      adb: mockAdb,
      commands: {
        getprop: vi.fn().mockResolvedValue({
          'ro.bootloader': 'bootloader-v1',
          'ro.hardware': 'qcom',
          'ro.build.fingerprint': 'test/fingerprint',
        }),
        shell: vi.fn().mockResolvedValue(''),
      },
      getProperties: vi.fn().mockResolvedValue(createMockDeviceProperties()),
      isRooted: vi.fn().mockResolvedValue(false),
      isConnected: vi.fn().mockReturnValue(true),
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as ADBDevice;

    domMocks = setupAcquirerDOMMocks();

    // Create acquirer
    acquirer = new SystemInfoAcquirer(device);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('acquire', () => {
    beforeEach(() => {
      // Configure spawn to return appropriate outputs for different dumpsys calls
      const spawnMock = vi.mocked(mockAdb.subprocess.shellProtocol.spawn);

      spawnMock.mockImplementation(async (command: string) => {
        if (command.includes('dumpsys battery')) {
          return createMockShellSocket(MOCK_BATTERY_DUMPSYS_OUTPUT);
        } else if (command.includes('dumpsys meminfo')) {
          return createMockShellSocket(MOCK_MEMINFO_DUMPSYS_OUTPUT);
        } else if (command.includes('dumpsys sensorservice')) {
          return createMockShellSocket(MOCK_SENSOR_DUMPSYS_OUTPUT);
        }
        return createMockShellSocket('');
      });
    });

    it('should successfully acquire system information', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.type).toBe('system_info');
      expect(result.fileName).toBe('system-info.json');
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

    it('should call dumpsys commands correctly', async () => {
      await acquirer.acquire();

      const spawnMock = vi.mocked(mockAdb.subprocess.shellProtocol.spawn);

      // Verify dumpsys battery was called
      expect(spawnMock).toHaveBeenCalledWith('dumpsys battery');

      // Verify dumpsys meminfo was called
      expect(spawnMock).toHaveBeenCalledWith('dumpsys meminfo');

      // Verify dumpsys sensorservice was called
      expect(spawnMock).toHaveBeenCalledWith('dumpsys sensorservice');
    });
  });

  describe('battery information', () => {
    beforeEach(() => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockImplementation(
        async (command: string) => {
          if (command.includes('dumpsys battery')) {
            return createMockShellSocket(MOCK_BATTERY_DUMPSYS_OUTPUT);
          }
          return createMockShellSocket('');
        }
      );
    });

    it('should collect battery info when enabled', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.battery).toBe(true);

      // Verify dumpsys battery was called
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('dumpsys battery');
    });

    it('should skip battery info when disabled', async () => {
      acquirer = new SystemInfoAcquirer(device, { includeBattery: false });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.battery).toBe(false);

      // Verify dumpsys battery was NOT called
      expect(mockAdb.subprocess.shellProtocol.spawn).not.toHaveBeenCalledWith('dumpsys battery');
    });

    it('should parse battery info correctly from dumpsys output', async () => {
      const batteryInfo = await acquirer.getBatteryInfo();

      expect(batteryInfo.level).toBe(85);
      expect(batteryInfo.temperature).toBe(28); // 280 / 10
      expect(batteryInfo.voltage).toBe(4200);
      expect(batteryInfo.technology).toBe('Li-ion');
      expect(batteryInfo.present).toBe(true);
    });

    it('should handle battery info errors gracefully', async () => {
      // Mock spawn to throw error for battery
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockImplementation(
        async (command: string) => {
          if (command.includes('dumpsys battery')) {
            throw new Error('Battery service unavailable');
          }
          return createMockShellSocket('');
        }
      );

      acquirer = new SystemInfoAcquirer(device);
      const result = await acquirer.acquire();

      // Should still succeed because errors are caught
      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.battery).toBe(true);
    });

    it('should return default battery info on empty output', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockImplementation(
        async (command: string) => {
          if (command.includes('dumpsys battery')) {
            return createMockShellSocket('');
          }
          return createMockShellSocket('');
        }
      );

      const batteryInfo = await acquirer.getBatteryInfo();

      expect(batteryInfo.level).toBe(0);
      expect(batteryInfo.temperature).toBe(0);
      expect(batteryInfo.status).toBe('Unknown');
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

    it('should parse network info correctly', async () => {
      const networkInfo = await acquirer.getNetworkInfo();

      expect(networkInfo.wifiEnabled).toBe(true);
      expect(networkInfo.mobileDataEnabled).toBe(false);
      expect(networkInfo.airplaneModeOn).toBe(false);
      expect(networkInfo.activeNetworkType).toBe('WiFi');
    });

    it('should handle network info errors gracefully', async () => {
      vi.mocked(GetNetworkInfoCommand).mockImplementation(
        () =>
          ({
            exec: vi.fn().mockRejectedValue(new Error('Settings unavailable')),
          }) as any
      );

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

    it('should parse storage info correctly', async () => {
      const storageInfo = await acquirer.getStorageInfo();

      expect(storageInfo.totalInternal).toBe('67108864');
      expect(storageInfo.availableInternal).toBe('18874297');
    });

    it('should handle storage info errors gracefully', async () => {
      vi.mocked(GetStorageInfoCommand).mockImplementation(
        () =>
          ({
            exec: vi.fn().mockRejectedValue(new Error('df command failed')),
          }) as any
      );

      acquirer = new SystemInfoAcquirer(device);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.storage).toBe(true);
    });
  });

  describe('memory information', () => {
    beforeEach(() => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockImplementation(
        async (command: string) => {
          if (command.includes('dumpsys meminfo')) {
            return createMockShellSocket(MOCK_MEMINFO_DUMPSYS_OUTPUT);
          }
          return createMockShellSocket('');
        }
      );
    });

    it('should collect memory info when enabled', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.memory).toBe(true);

      // Verify dumpsys meminfo was called
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('dumpsys meminfo');
    });

    it('should skip memory info when disabled', async () => {
      acquirer = new SystemInfoAcquirer(device, { includeMemory: false });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.memory).toBe(false);

      // Verify dumpsys meminfo was NOT called
      expect(mockAdb.subprocess.shellProtocol.spawn).not.toHaveBeenCalledWith('dumpsys meminfo');
    });

    it('should parse memory info correctly from dumpsys output', async () => {
      const memoryInfo = await acquirer.getMemoryInfo();

      expect(memoryInfo.totalRam).toBe('8,192,000K');
      expect(memoryInfo.availableRam).toBe('4,096,000K');
      expect(memoryInfo.lowMemory).toBe(false);
      expect(memoryInfo.threshold).toBe('512,000K');
    });

    it('should handle memory info errors gracefully', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockImplementation(
        async (command: string) => {
          if (command.includes('dumpsys meminfo')) {
            throw new Error('meminfo unavailable');
          }
          return createMockShellSocket('');
        }
      );

      acquirer = new SystemInfoAcquirer(device);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.memory).toBe(true);
    });

    it('should return default memory info on empty output', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockImplementation(
        async (command: string) => {
          if (command.includes('dumpsys meminfo')) {
            return createMockShellSocket('');
          }
          return createMockShellSocket('');
        }
      );

      const memoryInfo = await acquirer.getMemoryInfo();

      expect(memoryInfo.totalRam).toBe('Unknown');
      expect(memoryInfo.availableRam).toBe('Unknown');
      expect(memoryInfo.lowMemory).toBe(false);
    });
  });

  describe('sensors information', () => {
    beforeEach(() => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockImplementation(
        async (command: string) => {
          if (command.includes('dumpsys sensorservice')) {
            return createMockShellSocket(MOCK_SENSOR_DUMPSYS_OUTPUT);
          }
          return createMockShellSocket('');
        }
      );
    });

    it('should collect sensors info when enabled', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.sensors).toBe(true);

      // Verify dumpsys sensorservice was called
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('dumpsys sensorservice');
    });

    it('should skip sensors info when disabled', async () => {
      acquirer = new SystemInfoAcquirer(device, { includeSensors: false });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.sensors).toBe(false);

      // Verify dumpsys sensorservice was NOT called
      expect(mockAdb.subprocess.shellProtocol.spawn).not.toHaveBeenCalledWith(
        'dumpsys sensorservice'
      );
    });

    it('should parse sensors info correctly from dumpsys output', async () => {
      const sensors = await acquirer.getSensors();

      expect(sensors).toHaveLength(2);
      expect(sensors[0].name).toBe('BMI160_Accelerometer');
      expect(sensors[0].vendor).toBe('Bosch');
      expect(sensors[0].version).toBe('1');
      expect(sensors[0].type).toBe('1');

      expect(sensors[1].name).toBe('BMI160_Gyroscope');
      expect(sensors[1].type).toBe('4');
    });

    it('should handle sensors info errors gracefully', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockImplementation(
        async (command: string) => {
          if (command.includes('dumpsys sensorservice')) {
            throw new Error('sensorservice unavailable');
          }
          return createMockShellSocket('');
        }
      );

      acquirer = new SystemInfoAcquirer(device);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).componentsCollected.sensors).toBe(true);
    });

    it('should return empty array on empty sensor output', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockImplementation(
        async (command: string) => {
          if (command.includes('dumpsys sensorservice')) {
            return createMockShellSocket('');
          }
          return createMockShellSocket('');
        }
      );

      const sensors = await acquirer.getSensors();

      expect(sensors).toEqual([]);
    });
  });

  describe('configuration options', () => {
    it('should respect multiple disabled components', async () => {
      acquirer = new SystemInfoAcquirer(device, {
        includeBattery: false,
        includeNetwork: false,
        includeSensors: false,
      });

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      const components = (result.data as any).componentsCollected;
      expect(components.battery).toBe(false);
      expect(components.network).toBe(false);
      expect(components.sensors).toBe(false);
      expect(components.storage).toBe(true); // Still enabled by default
      expect(components.memory).toBe(true); // Still enabled by default
    });

    it('should disable all optional components', async () => {
      acquirer = new SystemInfoAcquirer(device, {
        includeBattery: false,
        includeNetwork: false,
        includeStorage: false,
        includeMemory: false,
        includeSensors: false,
      });

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      const components = (result.data as any).componentsCollected;
      expect(components.battery).toBe(false);
      expect(components.network).toBe(false);
      expect(components.storage).toBe(false);
      expect(components.memory).toBe(false);
      expect(components.sensors).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should continue acquisition even if one component fails', async () => {
      // Make battery fail but others succeed
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockImplementation(
        async (command: string) => {
          if (command.includes('dumpsys battery')) {
            throw new Error('Battery failed');
          } else if (command.includes('dumpsys meminfo')) {
            return createMockShellSocket(MOCK_MEMINFO_DUMPSYS_OUTPUT);
          }
          return createMockShellSocket('');
        }
      );

      const result = await acquirer.acquire();

      // Should still succeed overall
      expect(result.success).toBe(true);
      const components = (result.data as any).componentsCollected;
      expect(components.battery).toBe(true); // Still counted as collected (with default values)
      expect(components.memory).toBe(true);
    });

    it('should handle device disconnection', async () => {
      vi.mocked(device.getProperties).mockRejectedValue(new Error('Device disconnected'));

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

      expect(result.success).toBe(true);
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
    });

    it('should include acquisition duration', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.duration).toBeGreaterThan(0);
      expect(typeof result.duration).toBe('number');
    });

    it('should include file size', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.fileSize).toBeGreaterThan(0);
      expect(typeof result.fileSize).toBe('number');
    });

    it('should include component collection status', async () => {
      const result = await acquirer.acquire();

      expect((result.data as any).componentsCollected).toBeDefined();
      expect(typeof (result.data as any).componentsCollected).toBe('object');
    });
  });

  describe('output format', () => {
    it('should create JSON output', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.fileName).toBe('system-info.json');
    });

    it('should return blob instead of triggering download', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.blob!.size).toBeGreaterThan(0);
    });
  });
});
