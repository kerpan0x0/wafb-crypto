import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProcessAcquirer } from '../../../../src/forensics/acquisition/process';
import { 
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  createMockReadableStream
} from '../../../helpers/test-helpers';
import type { ADBDevice } from '../../../../src/adb/device';

describe('ProcessAcquirer', () => {
  let device: ADBDevice;
  let acquirer: ProcessAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  const MOCK_PS_OUTPUT = `LABEL                          USER     PID   PPID     VSZ    RSS WCHAN            ADDR S NAME
u:r:init:s0                    root       1      0   17936   2048 0                   0 S init
u:r:system_server:s0           system  1234      1 3456789  98765 0                   0 S system_server
u:r:zygote:s0                  root    2000      1  234567  12345 0                   0 S zygote64
u:r:surfaceflinger:s0          system  2345      1  123456   5678 0                   0 S surfaceflinger
u:r:untrusted_app:s0           u0_a123 5678   2000  456789  23456 0                   0 S com.example.app`;

  beforeEach(() => {
    vi.clearAllMocks();
    
    device = createMockADBDeviceWithProcesses({
      psOutput: MOCK_PS_OUTPUT
    }) as unknown as ADBDevice;
    
    domMocks = setupAcquirerDOMMocks();
    acquirer = new ProcessAcquirer(device);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('Basic Acquisition', () => {
    it('should successfully acquire process list', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.type).toBe('process');
      expect(result.fileName).toMatch(/processes-.*\.json/);
    });

    it('should parse all processes correctly', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).totalProcesses).toBe(5);
    });

    it('should identify system processes', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).systemProcesses).toBeGreaterThan(0);
    });

    it('should identify user processes', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).userProcesses).toBeGreaterThan(0);
    });

    it('should include device information', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).deviceInfo).toBeDefined();
      expect(device.getProperties).toHaveBeenCalled();
    });

    it('should trigger download on successful acquisition', async () => {
      await acquirer.acquire();

      expect(domMocks.mockAnchor.click).toHaveBeenCalled();
      expect(domMocks.mockAnchor.download).toMatch(/processes-.*\.json/);
    });
  });

  describe('Process Parsing', () => {
    it('should parse PID correctly', async () => {
      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      const data = JSON.parse(text);

      expect(data.processes[0].pid).toBe(1);
      expect(data.processes[1].pid).toBe(1234);
    });

    it('should parse PPID correctly', async () => {
      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      const data = JSON.parse(text);

      expect(data.processes[0].ppid).toBe(0);
      expect(data.processes[1].ppid).toBe(1);
    });

    it('should parse user correctly', async () => {
      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      const data = JSON.parse(text);

      expect(data.processes[0].user).toBe('root');
      expect(data.processes[1].user).toBe('system');
    });

    it('should parse process name correctly', async () => {
      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      const data = JSON.parse(text);

      expect(data.processes[0].name).toBe('init');
      expect(data.processes[1].name).toBe('system_server');
    });

    it('should parse memory info correctly', async () => {
      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      const data = JSON.parse(text);

      expect(data.processes[0].vsz).toBeGreaterThan(0);
      expect(data.processes[0].rss).toBeGreaterThan(0);
    });

    it('should parse SELinux context when enabled', async () => {
      acquirer = new ProcessAcquirer(device, { includeSELinuxContext: true });
      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      const data = JSON.parse(text);

      expect(data.processes.some((p: any) => p.selinuxContext)).toBe(true);
    });

    it('should handle process names with spaces', async () => {
      const psWithSpaces = MOCK_PS_OUTPUT + '\n' +
        'u:r:app:s0 u0_a456 9999 2000 123456 7890 0 0 S my app name';

      device = createMockADBDeviceWithProcesses({
        psOutput: psWithSpaces
      }) as unknown as ADBDevice;
      acquirer = new ProcessAcquirer(device);

      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      const data = JSON.parse(text);

      const processWithSpaces = data.processes.find((p: any) => p.pid === 9999);
      expect(processWithSpaces.name).toBe('my app name');
    });

    it('should skip malformed lines gracefully', async () => {
      const malformedPs = `LABEL USER PID PPID VSZ RSS WCHAN ADDR S NAME
u:r:init:s0 root 1 0 17936 2048 0 0 S init
malformed line
u:r:system_server:s0 system 1234 1 3456789 98765 0 0 S system_server`;

      device = createMockADBDeviceWithProcesses({
        psOutput: malformedPs
      }) as unknown as ADBDevice;
      acquirer = new ProcessAcquirer(device);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).totalProcesses).toBe(2);
    });

    it('should handle empty process list', async () => {
      device = createMockADBDeviceWithProcesses({
        psOutput: 'LABEL USER PID PPID VSZ RSS WCHAN ADDR S NAME'
      }) as unknown as ADBDevice;
      acquirer = new ProcessAcquirer(device);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).totalProcesses).toBe(0);
    });
  });

  describe('User ID Mapping', () => {
    it('should map root user to UID 0', async () => {
      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      const data = JSON.parse(text);

      const rootProcess = data.processes.find((p: any) => p.user === 'root');
      expect(rootProcess.uid).toBe(0);
    });

    it('should map system user to UID 1000', async () => {
      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      const data = JSON.parse(text);

      const systemProcess = data.processes.find((p: any) => p.user === 'system');
      expect(systemProcess.uid).toBe(1000);
    });

    it('should parse app user format (u0_aXXX)', async () => {
      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      const data = JSON.parse(text);

      const appProcess = data.processes.find((p: any) => p.user === 'u0_a123');
      expect(appProcess.uid).toBe(10123);
    });

    it('should handle unknown users', async () => {
      const customPs = `LABEL USER PID PPID VSZ RSS WCHAN ADDR S NAME
u:r:app:s0 custom_user 9999 1 12345 678 0 0 S custom_app`;

      device = createMockADBDeviceWithProcesses({
        psOutput: customPs
      }) as unknown as ADBDevice;
      acquirer = new ProcessAcquirer(device);

      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      const data = JSON.parse(text);

      expect(data.processes[0].uid).toBe(-1);
    });

    it('should handle multi-user format (u1_aXXX)', async () => {
      const multiUserPs = `LABEL USER PID PPID VSZ RSS WCHAN ADDR S NAME
u:r:app:s0 u1_a456 9999 1 12345 678 0 0 S secondary_user_app`;

      device = createMockADBDeviceWithProcesses({
        psOutput: multiUserPs
      }) as unknown as ADBDevice;
      acquirer = new ProcessAcquirer(device);

      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      const data = JSON.parse(text);

      // u1_a456 = 1*100000 + 10000 + 456 = 110456
      expect(data.processes[0].uid).toBe(110456);
    });
  });

  describe('Process Classification', () => {
    it('should identify init as system process', async () => {
      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      const data = JSON.parse(text);

      expect(data.systemProcesses).toBeGreaterThan(0);
    });

    it('should identify user apps correctly', async () => {
      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      const data = JSON.parse(text);

      expect(data.userProcesses).toBeGreaterThan(0);
    });

    it('should classify system_server as system process', async () => {
      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      const data = JSON.parse(text);

      const systemServer = data.processes.find((p: any) => p.name === 'system_server');
      expect(systemServer.uid).toBe(1000);
      expect(data.systemProcesses).toBeGreaterThan(0);
    });

    it('should classify zygote processes as system', async () => {
      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      const data = JSON.parse(text);

      const zygote = data.processes.find((p: any) => p.name.includes('zygote'));
      expect(zygote).toBeDefined();
    });

    it('should calculate correct system/user counts', async () => {
      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      const data = JSON.parse(text);

      expect(data.systemProcesses + data.userProcesses).toBe(data.totalProcesses);
    });
  });

  describe('Configuration Options', () => {
    it('should include SELinux context when enabled', async () => {
      acquirer = new ProcessAcquirer(device, { includeSELinuxContext: true });
      await acquirer.acquire();

      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        expect.stringContaining('ps -A -Z')
      );
    });

    it('should exclude SELinux context when disabled', async () => {
      device = createMockADBDeviceWithProcesses({
        psOutput: MOCK_PS_OUTPUT.replace(/u:r:\w+:s0\s+/g, '')
      }) as unknown as ADBDevice;
      acquirer = new ProcessAcquirer(device, { includeSELinuxContext: false });

      await acquirer.acquire();

      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalled();
    });

    it('should include threads when enabled', async () => {
      acquirer = new ProcessAcquirer(device, { includeThreads: true });
      await acquirer.acquire();

      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        expect.stringContaining('-T')
      );
    });

    it('should compute hash when configured', async () => {
      acquirer = new ProcessAcquirer(device, { computeHash: true });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.hash).toBeDefined();
      expect(typeof result.hash).toBe('string');
    });

    it('should respect timeout configuration', async () => {
      acquirer = new ProcessAcquirer(device, { timeout: 5000 });
      await acquirer.acquire();

      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalled();
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
      expect(progressValues).toContain(10);
      expect(progressValues).toContain(40);
      expect(progressValues).toContain(70);
      expect(progressValues).toContain(90);
      expect(progressValues).toContain(100);
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
    it('should handle ps command failure', async () => {
      vi.mocked(device.adb.subprocess.shellProtocol.spawn).mockRejectedValue(
        new Error('ps command failed')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('ps command failed');
    });

    it('should handle device disconnection', async () => {
      device.getProperties = vi.fn().mockRejectedValue(
        new Error('Device disconnected')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Device disconnected');
    });

    it('should report error in progress callback', async () => {
      const { callback, getLastProgress } = createMockProgressCallback();
      device.getProperties = vi.fn().mockRejectedValue(new Error('Test error'));

      await acquirer.acquire(callback);

      const lastProgress = getLastProgress();
      expect(lastProgress.status).toBe('failed');
      expect(lastProgress.message).toContain('Error');
    });

    it('should include error in result on failure', async () => {
      device.getProperties = vi.fn().mockRejectedValue(new Error('Device error'));

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Device error');
      expect(result.type).toBe('process');
    });

    it('should handle unknown errors gracefully', async () => {
      device.getProperties = vi.fn().mockRejectedValue('Unknown error type');

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
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
      expect(result.duration).toBe(
        result.endTime.getTime() - result.startTime.getTime()
      );
    });

    it('should include file size', async () => {
      const result = await acquirer.acquire();

      expect(result.fileSize).toBeDefined();
      expect(result.fileSize).toBeGreaterThan(0);
    });

    it('should set correct acquisition type', async () => {
      const result = await acquirer.acquire();

      expect(result.type).toBe('process');
    });

    it('should include process counts in data', async () => {
      const result = await acquirer.acquire();

      expect((result.data as any).totalProcesses).toBeDefined();
      expect((result.data as any).systemProcesses).toBeDefined();
      expect((result.data as any).userProcesses).toBeDefined();
    });
  });

  describe('Output Format', () => {
    it('should create valid JSON', async () => {
      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();

      expect(() => JSON.parse(text)).not.toThrow();
    });

    it('should include all required fields', async () => {
      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      const data = JSON.parse(text);

      expect(data).toHaveProperty('totalProcesses');
      expect(data).toHaveProperty('systemProcesses');
      expect(data).toHaveProperty('userProcesses');
      expect(data).toHaveProperty('processes');
      expect(data).toHaveProperty('deviceInfo');
      expect(data).toHaveProperty('acquisitionTime');
      expect(data).toHaveProperty('timestamp');
    });

    it('should format process entries correctly', async () => {
      await acquirer.acquire();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      const data = JSON.parse(text);

      const process = data.processes[0];
      expect(process).toHaveProperty('pid');
      expect(process).toHaveProperty('ppid');
      expect(process).toHaveProperty('uid');
      expect(process).toHaveProperty('user');
      expect(process).toHaveProperty('name');
      expect(process).toHaveProperty('state');
      expect(process).toHaveProperty('vsz');
      expect(process).toHaveProperty('rss');
    });

    it('should download file with correct blob type', async () => {
      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL');

      await acquirer.acquire();

      expect(createObjectURLSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'application/json'
        })
      );
    });

    it('should generate filename with device model', async () => {
      const result = await acquirer.acquire();

      expect(result.fileName).toBeDefined();
      expect(result.fileName).toMatch(/processes-Test.*\.json/);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle real-world process snapshot', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).totalProcesses).toBeGreaterThan(0);
      expect(domMocks.mockAnchor.click).toHaveBeenCalled();
    });

    it('should work with different device models', async () => {
      const mockProperties = {
        model: 'Pixel 8',
        manufacturer: 'Google',
        androidVersion: '14',
        sdkVersion: 34,
        serialNumber: 'XYZ789',
        buildId: 'BUILD123',
        brand: 'Google'
      };
      device.getProperties = vi.fn().mockResolvedValue(mockProperties);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.fileName).toContain('Pixel 8');
    });

    it('should capture acquisition timestamp', async () => {
      const beforeAcquisition = Date.now();
      await acquirer.acquire();
      const afterAcquisition = Date.now();

      const blob = domMocks.createObjectURLSpy.mock.calls[0][0] as Blob;
      const text = await blob.text();
      const data = JSON.parse(text);

      const timestamp = data.timestamp;
      expect(timestamp).toBeGreaterThanOrEqual(beforeAcquisition);
      expect(timestamp).toBeLessThanOrEqual(afterAcquisition);
    });
  });
});

// Helper function to create mock device with process data
function createMockADBDeviceWithProcesses(options: {
  psOutput?: string;
} = {}) {
  const { psOutput = '' } = options;

  const mockShellSpawn = vi.fn().mockImplementation((command: string) => {
    if (command.includes('ps')) {
      return Promise.resolve({
        stdout: createMockReadableStream(psOutput),
        stderr: createMockReadableStream(''),
        stdin: new WritableStream(),
        exit: Promise.resolve({ code: 0 })
      });
    }

    if (command === 'getprop') {
      return Promise.resolve({
        stdout: createMockReadableStream(
          `[ro.build.version.release]: [13]
[ro.build.id]: [TP1A.220905.004]
[ro.product.model]: [Test Device]
[ro.product.manufacturer]: [Test Manufacturer]
[ro.product.brand]: [Test]
[ro.build.version.sdk]: [33]`
        ),
        stderr: createMockReadableStream(''),
        stdin: new WritableStream(),
        exit: Promise.resolve({ code: 0 })
      });
    }

    return Promise.resolve({
      stdout: createMockReadableStream(''),
      stderr: createMockReadableStream(''),
      stdin: new WritableStream(),
      exit: Promise.resolve({ code: 0 })
    });
  });

  return {
    adb: {
      subprocess: {
        shellProtocol: {
          spawn: mockShellSpawn
        }
      },
      sync: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined)
    } as any,
    getProperties: vi.fn().mockResolvedValue({
      androidVersion: '13',
      buildId: 'TP1A.220905.004',
      model: 'Test Device',
      manufacturer: 'Test Manufacturer',
      brand: 'Test',
      sdkVersion: 33,
      serialNumber: 'TEST123'
    }),
    info: {
      productName: 'Test Device',
      manufacturerName: 'Test Manufacturer',
      serialNumber: 'TEST123',
      vendorId: 0x18D1,
      productId: 0x4EE7
    },
    isConnected: vi.fn().mockReturnValue(true),
    disconnect: vi.fn().mockResolvedValue(undefined)
  };
}