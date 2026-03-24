import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SystemInfoAcquirer } from '../../../../src/forensics/acquisition/system';
import {
  createMockDeviceForAcquirer,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  makeShellResult,
  readStream,
} from '../../../helpers/test-helpers';
import type { MockDevice } from '../../../helpers/test-helpers';

async function drainAndHash(result: any, fileIndex = 0): Promise<string | undefined> {
  const file = result.files?.[fileIndex] ?? result.files![fileIndex];
  if (!file?.hashPromise) return undefined;
  // Drain the stream so TransformStream.flush() fires and hashPromise resolves
  if (file.stream) {
    const reader = (file.stream as ReadableStream<Uint8Array>).getReader();
    while (!(await reader.read()).done) {}
  }
  return file.hashPromise;
}


// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_BATTERY = `Current Battery Service state:
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

const MOCK_MEMINFO = `Applications Memory Usage (in Kilobytes):
Total RAM: 8,192,000K
Free RAM: 4,096,000K
Low Memory: false
Threshold: 512,000K`;

const MOCK_SENSORS = `Sensor List:
0x00000001) BMI160_Accelerometer | Bosch | ver: 1 | type: 1
   name=BMI160_Accelerometer
   vendor=Bosch
   version=1
   type=1`;

const MOCK_NETWORK = `wifi_on=1
mobile_data=0
airplane_mode_on=0`;

const MOCK_STORAGE = `Filesystem     1K-blocks    Used Available Use% Mounted on
/dev/block/dm-0 67108864 48234567 18874297  72% /data
tmpfs           4096000       0  4096000   0% /dev`;

function setupShell(device: MockDevice) {
  device.shell.mockImplementation(async (cmd: string) => {
    if (cmd.includes('dumpsys battery')) return makeShellResult(MOCK_BATTERY);
    if (cmd.includes('dumpsys meminfo')) return makeShellResult(MOCK_MEMINFO);
    if (cmd.includes('dumpsys sensorservice')) return makeShellResult(MOCK_SENSORS);
    // GetNetworkInfoCommand and GetStorageInfoCommand also use device.shell internally
    if (cmd.includes('settings list') || cmd.includes('wifi') || cmd.includes('mobile_data'))
      return makeShellResult(MOCK_NETWORK);
    if (cmd.includes('df ') || cmd.includes('cat /proc/mounts'))
      return makeShellResult(MOCK_STORAGE);
    return makeShellResult('');
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SystemInfoAcquirer', () => {
  let device: MockDevice;
  let acquirer: SystemInfoAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    device = createMockDeviceForAcquirer();
    setupShell(device);
    domMocks = setupAcquirerDOMMocks();
    acquirer = new SystemInfoAcquirer(device as any);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('acquire', () => {
    it('should successfully acquire system information', async () => {
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect(result.type).toBe('system_info');
      expect(result.files[0].stream).toBeInstanceOf(ReadableStream);
      expect(result.files[0].fileSize).toBeGreaterThan(0);
    });

    it('should include all component flags in data', async () => {
      const result = await acquirer.acquire();
      const components = result.data?.componentsCollected;
      expect(components).toBeDefined();
      expect(typeof components?.battery).toBe('boolean');
      expect(typeof components?.network).toBe('boolean');
      expect(typeof components?.storage).toBe('boolean');
      expect(typeof components?.memory).toBe('boolean');
      expect(typeof components?.sensors).toBe('boolean');
    });

    it('should create valid JSON blob', async () => {
      const result = await acquirer.acquire();
      const text = await readStream(result.files[0].stream!);
      expect(() => JSON.parse(text)).not.toThrow();
    });

    it('should include all required JSON fields', async () => {
      const result = await acquirer.acquire();
      const data = JSON.parse(await readStream(result.files[0].stream!));
      expect(data).toHaveProperty('device');
      expect(data).toHaveProperty('systemProperties');
      expect(data).toHaveProperty('acquisitionTime');
    });

    it('should include device model info in JSON', async () => {
      const result = await acquirer.acquire();
      const data = JSON.parse(await readStream(result.files[0].stream!));
      expect(data.device.model).toBe('Test Device');
      expect(data.device.manufacturer).toBe('Test Manufacturer');
    });

    it('should compute hash when configured', async () => {
      acquirer = new SystemInfoAcquirer(device as any, { computeHash: true });
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      const hash = await drainAndHash(result, 0);
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });

    it('should generate correct filename', async () => {
      const result = await acquirer.acquire();
      expect(result.files[0].fileName).toBe('system-info.json');
    });
  });

  describe('component configuration', () => {
    it('should include battery info by default', async () => {
      const result = await acquirer.acquire();
      const data = JSON.parse(await readStream(result.files[0].stream!));
      expect(data.battery).toBeDefined();
    });

    it('should skip battery when disabled', async () => {
      acquirer = new SystemInfoAcquirer(device as any, { includeBattery: false });
      const result = await acquirer.acquire();
      const data = JSON.parse(await readStream(result.files[0].stream!));
      expect(data.battery).toBeUndefined();
      expect(result.data?.componentsCollected?.battery).toBe(false);
    });

    it('should include network info by default', async () => {
      const result = await acquirer.acquire();
      const data = JSON.parse(await readStream(result.files[0].stream!));
      expect(data.network).toBeDefined();
    });

    it('should skip network when disabled', async () => {
      acquirer = new SystemInfoAcquirer(device as any, { includeNetwork: false });
      const result = await acquirer.acquire();
      expect(result.data?.componentsCollected?.network).toBe(false);
    });

    it('should include storage info by default', async () => {
      const result = await acquirer.acquire();
      const data = JSON.parse(await readStream(result.files[0].stream!));
      expect(data.storage).toBeDefined();
    });

    it('should skip storage when disabled', async () => {
      acquirer = new SystemInfoAcquirer(device as any, { includeStorage: false });
      const result = await acquirer.acquire();
      expect(result.data?.componentsCollected?.storage).toBe(false);
    });

    it('should include memory info by default', async () => {
      const result = await acquirer.acquire();
      const data = JSON.parse(await readStream(result.files[0].stream!));
      expect(data.memory).toBeDefined();
    });

    it('should skip memory when disabled', async () => {
      acquirer = new SystemInfoAcquirer(device as any, { includeMemory: false });
      const result = await acquirer.acquire();
      expect(result.data?.componentsCollected?.memory).toBe(false);
    });

    it('should include sensors by default', async () => {
      const result = await acquirer.acquire();
      const data = JSON.parse(await readStream(result.files[0].stream!));
      expect(data.sensors).toBeDefined();
    });

    it('should skip sensors when disabled', async () => {
      acquirer = new SystemInfoAcquirer(device as any, { includeSensors: false });
      const result = await acquirer.acquire();
      expect(result.data?.componentsCollected?.sensors).toBe(false);
    });

    it('should collect no components when all disabled', async () => {
      acquirer = new SystemInfoAcquirer(device as any, {
        includeBattery: false,
        includeNetwork: false,
        includeStorage: false,
        includeMemory: false,
        includeSensors: false,
      });
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      const c = result.data?.componentsCollected;
      expect(Object.values(c as any).every((v: any) => v === false)).toBe(true);
    });
  });

  describe('battery info parsing', () => {
    it('should parse battery level', async () => {
      const result = await acquirer.acquire();
      const data = JSON.parse(await readStream(result.files[0].stream!));
      expect(data.battery?.level).toBe(85);
    });

    it('should parse battery temperature', async () => {
      const result = await acquirer.acquire();
      const data = JSON.parse(await readStream(result.files[0].stream!));
      expect(data.battery?.temperature).toBe(28); // 280/10
    });

    it('should parse battery voltage', async () => {
      const result = await acquirer.acquire();
      const data = JSON.parse(await readStream(result.files[0].stream!));
      expect(data.battery?.voltage).toBe(4200);
    });

    it('should handle missing battery output gracefully', async () => {
      device.shell.mockImplementation(async (cmd: string) => makeShellResult(''));
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
    });
  });

  describe('memory info parsing', () => {
    it('should parse total RAM', async () => {
      const result = await acquirer.acquire();
      const data = JSON.parse(await readStream(result.files[0].stream!));
      expect(data.memory?.totalRam).toBeDefined();
      expect(data.memory?.totalRam).toContain('8,192,000K');
    });

    it('should parse available RAM', async () => {
      const result = await acquirer.acquire();
      const data = JSON.parse(await readStream(result.files[0].stream!));
      expect(data.memory?.availableRam).toBeDefined();
    });
  });

  describe('network info parsing', () => {
    it('should detect wifi enabled', async () => {
      const result = await acquirer.acquire();
      const data = JSON.parse(await readStream(result.files[0].stream!));
      expect(data.network?.wifiEnabled).toBe(true);
    });

    it('should detect mobile data disabled', async () => {
      const result = await acquirer.acquire();
      const data = JSON.parse(await readStream(result.files[0].stream!));
      expect(data.network?.mobileDataEnabled).toBe(false);
    });

    it('should detect airplane mode off', async () => {
      const result = await acquirer.acquire();
      const data = JSON.parse(await readStream(result.files[0].stream!));
      expect(data.network?.airplaneModeOn).toBe(false);
    });
  });

  describe('progress reporting', () => {
    it('should report progress during acquisition', async () => {
      const { callback, getLastProgress } = createMockProgressCallback();
      await acquirer.acquire(callback);
      expect(callback).toHaveBeenCalled();
      expect(getLastProgress().progress).toBe(100);
      expect(getLastProgress().status).toBe('completed');
    });

    it('should report monotonically increasing progress', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);
      const values = getProgressHistory().map((p: any) => p.progress);
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
      }
    });

    it('should include device info in progress', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);
      expect(getProgressHistory().some((p: any) => p.deviceInfo !== undefined)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should fail on device disconnection', async () => {
      device.getProperties.mockRejectedValue(new Error('Device disconnected'));
      const result = await acquirer.acquire();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Device disconnected');
    });

    it('should succeed even if battery command fails', async () => {
      device.shell.mockImplementation(async (cmd: string) => {
        if (cmd.includes('dumpsys battery')) throw new Error('battery failed');
        return makeShellResult('');
      });
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
    });

    it('should succeed even if network command fails', async () => {
      device.shell.mockImplementation(async (cmd: string) => {
        if (cmd.includes('dumpsys battery')) return makeShellResult(MOCK_BATTERY);
        throw new Error('network failed');
      });
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
    });

    it('should report failure in progress callback on critical error', async () => {
      device.getProperties.mockRejectedValue(new Error('Fatal error'));
      const { callback, getLastProgress } = createMockProgressCallback();
      await acquirer.acquire(callback);
      expect(getLastProgress().status).toBe('failed');
    });
  });

  describe('result metadata', () => {
    it('should include timestamps', async () => {
      const result = await acquirer.acquire();
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
    });

    it('should calculate duration correctly', async () => {
      const result = await acquirer.acquire();
      expect(result.duration).toBe(result.endTime.getTime() - result.startTime.getTime());
    });

    it('should include file size', async () => {
      expect((await acquirer.acquire()).files[0].fileSize).toBeGreaterThan(0);
    });

    it('should set correct acquisition type', async () => {
      expect((await acquirer.acquire()).type).toBe('system_info');
    });
  });
});