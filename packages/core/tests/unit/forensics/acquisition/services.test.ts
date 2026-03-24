import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ServicesAcquirer } from '../../../../src/forensics/acquisition/services';
import type { ServicesConfig } from '../../../../src/forensics/acquisition/services';
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

async function parseBlob(stream: ReadableStream<Uint8Array>) {
  return JSON.parse(await readStream(stream));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ServicesAcquirer', () => {
  let device: MockDevice;
  let acquirer: ServicesAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    device = createMockDeviceForAcquirer();
    // DumpsysCommand uses device.shell — dispatch by command string
    device.shell.mockImplementation(async (cmd: string) => {
      if (cmd.includes('dumpsys -l')) return makeShellResult(MOCK_DUMPSYS_LIST);
      if (cmd.includes('dumpsys activity services')) return makeShellResult(MOCK_ACTIVITY_SERVICES);
      return makeShellResult('');
    });
    domMocks = setupAcquirerDOMMocks();
    acquirer = new ServicesAcquirer(device as any);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('Basic Acquisition', () => {
    it('should successfully acquire services list', async () => {
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect(result.type).toBe('services');
      expect(result.files[0].fileName).toBe('services.json');
      expect(result.files[0].fileSize).toBeGreaterThan(0);
    });

    it('should parse all services correctly', async () => {
      expect((await acquirer.acquire()).data.totalServices).toBeGreaterThan(0);
    });

    it('should identify system services', async () => {
      expect((await acquirer.acquire()).data.systemServices).toBeGreaterThan(0);
    });

    it('should identify user services', async () => {
      expect((await acquirer.acquire()).data.userServices).toBeGreaterThan(0);
    });

    it('should include device information', async () => {
      const result = await acquirer.acquire();
      expect((result.data as any).deviceInfo).toBeDefined();
      expect(device.getProperties).toHaveBeenCalled();
    });

    it('should return blob on successful acquisition', async () => {
      expect((await acquirer.acquire()).files[0].stream).toBeInstanceOf(ReadableStream);
    });
  });

  describe('Service Parsing', () => {
    it('should parse service names from dumpsys -l', async () => {
      const data = await parseBlob((await acquirer.acquire()).files[0].stream!);
      expect(data.services.some((s: any) => s.name === 'activity')).toBe(true);
      expect(data.services.some((s: any) => s.name === 'package')).toBe(true);
    });

    it('should skip header line from dumpsys -l', async () => {
      const data = await parseBlob((await acquirer.acquire()).files[0].stream!);
      expect(data.services.some((s: any) => s.name.includes('Currently running'))).toBe(false);
    });

    it('should identify running services', async () => {
      const result = await new ServicesAcquirer(device as any, { includeServiceDetails: true }).acquire();
      const data = await parseBlob(result.files[0].stream!);
      expect(data.runningServices).toBeGreaterThan(0);
    });

    it('should identify stopped services', async () => {
      const result = await new ServicesAcquirer(device as any, { includeServiceDetails: true }).acquire();
      const data = await parseBlob(result.files[0].stream!);
      expect(data.stoppedServices).toBeGreaterThanOrEqual(0);
    });

    it('should parse process details when available', async () => {
      const result = await new ServicesAcquirer(device as any, { includeServiceDetails: true }).acquire();
      const data = await parseBlob(result.files[0].stream!);
      expect(data.services.filter((s: any) => s.pid !== undefined).length).toBeGreaterThan(0);
    });
  });

  describe('Service Classification', () => {
    it('should classify android.* as system services', async () => {
      const data = await parseBlob((await acquirer.acquire()).files[0].stream!);
      expect(data.systemServices).toBeGreaterThan(0);
    });

    it('should classify com.android.* as system services', async () => {
      device.shell.mockImplementation(async (cmd: string) => {
        if (cmd.includes('dumpsys -l')) return makeShellResult('com.android.systemui\ncom.example.app');
        return makeShellResult('');
      });
      const data = await parseBlob((await new ServicesAcquirer(device as any).acquire()).files[0].stream!);
      expect(data.systemServices).toBe(1);
      expect(data.userServices).toBe(1);
    });

    it('should calculate correct counts', async () => {
      const data = await parseBlob((await acquirer.acquire()).files[0].stream!);
      expect(data.systemServices + data.userServices).toBe(data.totalServices);
    });
  });

  describe('Configuration Options', () => {
    it('should include service details when enabled', async () => {
      await new ServicesAcquirer(device as any, { includeServiceDetails: true }).acquire();
      expect(device.shell).toHaveBeenCalledWith(
        expect.stringContaining('dumpsys activity services'), expect.anything()
      );
    });

    it('should skip service details when disabled', async () => {
      await new ServicesAcquirer(device as any, { includeServiceDetails: false }).acquire();
      const hasActivityCall = device.shell.mock.calls.some(
        (c: any[]) => c[0].includes('dumpsys activity services')
      );
      expect(hasActivityCall).toBe(false);
    });

    it('should filter system services when configured', async () => {
      const data = await parseBlob((await new ServicesAcquirer(device as any, { includeSystemServices: false }).acquire()).files[0].stream!);
      expect(data.services.some((s: any) => s.name.startsWith('android.') || s.name.startsWith('com.android.'))).toBe(false);
    });

    it('should filter user services when configured', async () => {
      const data = await parseBlob((await new ServicesAcquirer(device as any, { includeUserServices: false }).acquire()).files[0].stream!);
      expect(data.services.some((s: any) => s.name.includes('com.example'))).toBe(false);
    });

    it('should compute hash when configured', async () => {
      const result = await new ServicesAcquirer(device as any, { computeHash: true }).acquire();
      expect(result.success).toBe(true);
      expect(typeof await drainAndHash(result, 0)).toBe('string');
    });

    it('should respect timeout configuration', async () => {
      const result = await new ServicesAcquirer(device as any, { timeout: 5000 }).acquire();
      expect(result.success).toBe(true);
    });
  });

  describe('Progress Reporting', () => {
    it('should report progress during acquisition', async () => {
      const { callback, getLastProgress } = createMockProgressCallback();
      await acquirer.acquire(callback);
      expect(getLastProgress().progress).toBe(100);
      expect(getLastProgress().status).toBe('completed');
    });

    it('should report all progress stages', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);
      const values = getProgressHistory().map((p: any) => p.progress);
      expect(values).toContain(10);
      expect(values).toContain(40);
      expect(values).toContain(90);
      expect(values).toContain(100);
    });

    it('should have monotonically increasing progress', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);
      const values = getProgressHistory().map((p: any) => p.progress);
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
      }
    });

    it('should include device info in progress at 20%', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);
      expect(getProgressHistory().find((p: any) => p.progress === 20)?.deviceInfo).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should fail when dumpsys -l command fails', async () => {
      device.shell.mockRejectedValue(new Error('dumpsys failed'));
      const result = await acquirer.acquire();
      expect(result.success).toBe(false);
      expect(result.error).toContain('dumpsys failed');
    });

    it('should handle device disconnection', async () => {
      device.getProperties.mockRejectedValue(new Error('Device disconnected'));
      const result = await acquirer.acquire();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Device disconnected');
    });

    it('should report error in progress callback', async () => {
      device.getProperties.mockRejectedValue(new Error('Test error'));
      const { callback, getLastProgress } = createMockProgressCallback();
      await acquirer.acquire(callback);
      expect(getLastProgress().status).toBe('failed');
    });

    it('should continue when activity services command fails', async () => {
      device.shell.mockImplementation(async (cmd: string) => {
        if (cmd.includes('dumpsys -l')) return makeShellResult(MOCK_DUMPSYS_LIST);
        throw new Error('Activity services failed');
      });
      const result = await new ServicesAcquirer(device as any, { includeServiceDetails: true }).acquire();
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
      expect(result.duration).toBe(result.endTime.getTime() - result.startTime.getTime());
    });

    it('should include file size', async () => {
      expect((await acquirer.acquire()).files[0].fileSize).toBeGreaterThan(0);
    });

    it('should set correct acquisition type', async () => {
      expect((await acquirer.acquire()).type).toBe('services');
    });

    it('should include service counts in data', async () => {
      const data = (await acquirer.acquire()).data as any;
      expect(typeof data.totalServices).toBe('number');
      expect(typeof data.runningServices).toBe('number');
      expect(typeof data.stoppedServices).toBe('number');
      expect(typeof data.systemServices).toBe('number');
      expect(typeof data.userServices).toBe('number');
    });
  });

  describe('Output Format', () => {
    it('should create valid JSON', async () => {
      const text = await readStream((await acquirer.acquire()).files[0].stream!);
      expect(() => JSON.parse(text)).not.toThrow();
    });

    it('should include all required fields', async () => {
      const data = await parseBlob((await acquirer.acquire()).files[0].stream!);
      ['totalServices', 'runningServices', 'stoppedServices', 'systemServices',
       'userServices', 'services', 'deviceInfo', 'acquisitionTime', 'timestamp'].forEach(f => {
        expect(data).toHaveProperty(f);
      });
    });

    it('should format service entries correctly', async () => {
      const data = await parseBlob((await acquirer.acquire()).files[0].stream!);
      expect(data.services[0]).toHaveProperty('name');
      expect(data.services[0]).toHaveProperty('state');
    });

    it('should return blob with correct type', async () => {
      expect((await acquirer.acquire()).files[0].mimeType).toBe('application/json');
    });

    it('should generate correct filename', async () => {
      expect((await acquirer.acquire()).files[0].fileName).toBe('services.json');
    });
  });
});