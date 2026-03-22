import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProcessAcquirer } from '../../../../src/forensics/acquisition/process';
import {
  createMockDeviceForAcquirer,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  makeShellResult,
} from '../../../helpers/test-helpers';
import type { MockDevice } from '../../../helpers/test-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_PS_OUTPUT = [
  'LABEL                          USER     PID   PPID     VSZ    RSS WCHAN            ADDR S NAME',
  'u:r:init:s0                    root       1      0   17936   2048 0                   0 S init',
  'u:r:system_server:s0           system  1234      1 3456789  98765 0                   0 S system_server',
  'u:r:zygote:s0                  root    2000      1  234567  12345 0                   0 S zygote64',
  'u:r:surfaceflinger:s0          system  2345      1  123456   5678 0                   0 S surfaceflinger',
  'u:r:untrusted_app:s0           u0_a123 5678   2000  456789  23456 0                   0 S com.example.app',
].join('\n');

async function parseBlob(blob: Blob) {
  return JSON.parse(await blob.text());
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProcessAcquirer', () => {
  let device: MockDevice;
  let acquirer: ProcessAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    device = createMockDeviceForAcquirer();
    // PsCommand uses device.shell — return mock PS output for ps commands
    device.shell.mockImplementation(async (cmd: string) => {
      if (cmd.includes('ps')) return makeShellResult(MOCK_PS_OUTPUT);
      return makeShellResult('');
    });
    domMocks = setupAcquirerDOMMocks();
    acquirer = new ProcessAcquirer(device as any);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('Basic Acquisition', () => {
    it('should successfully acquire process list', async () => {
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect(result.type).toBe('process');
      expect(result.files[0].fileName).toBe('processes.json');
    });

    it('should parse all processes correctly', async () => {
      const result = await acquirer.acquire();
      expect((result.data as any).totalProcesses).toBe(5);
    });

    it('should identify system processes', async () => {
      expect((await acquirer.acquire()).data.systemProcesses).toBeGreaterThan(0);
    });

    it('should identify user processes', async () => {
      expect((await acquirer.acquire()).data.userProcesses).toBeGreaterThan(0);
    });

    it('should include device information', async () => {
      const result = await acquirer.acquire();
      expect((result.data as any).deviceInfo).toBeDefined();
      expect(device.getProperties).toHaveBeenCalled();
    });

    it('should return blob on successful acquisition', async () => {
      const result = await acquirer.acquire();
      expect(result.files[0].blob).toBeInstanceOf(Blob);
      expect(result.files[0].fileName).toBe('processes.json');
    });
  });

  describe('Process Parsing', () => {
    it('should parse PID correctly', async () => {
      const result = await acquirer.acquire();
      const data = await parseBlob(result.files[0].blob!);
      expect(data.processes[0].pid).toBe(1);
      expect(data.processes[1].pid).toBe(1234);
    });

    it('should parse PPID correctly', async () => {
      const result = await acquirer.acquire();
      const data = await parseBlob(result.files[0].blob!);
      expect(data.processes[0].ppid).toBe(0);
      expect(data.processes[1].ppid).toBe(1);
    });

    it('should parse user correctly', async () => {
      const result = await acquirer.acquire();
      const data = await parseBlob(result.files[0].blob!);
      expect(data.processes[0].user).toBe('root');
      expect(data.processes[1].user).toBe('system');
    });

    it('should parse process name correctly', async () => {
      const result = await acquirer.acquire();
      const data = await parseBlob(result.files[0].blob!);
      expect(data.processes[0].name).toBe('init');
      expect(data.processes[1].name).toBe('system_server');
    });

    it('should parse memory info correctly', async () => {
      const result = await acquirer.acquire();
      const data = await parseBlob(result.files[0].blob!);
      expect(data.processes[0].vsz).toBeGreaterThan(0);
      expect(data.processes[0].rss).toBeGreaterThan(0);
    });

    it('should parse SELinux context when enabled', async () => {
      acquirer = new ProcessAcquirer(device as any, { includeSELinuxContext: true });
      const result = await acquirer.acquire();
      const data = await parseBlob(result.files[0].blob!);
      expect(data.processes.some((p: any) => p.selinuxContext)).toBe(true);
    });

    it('should handle process names with spaces', async () => {
      device.shell.mockImplementation(async (cmd: string) => {
        if (cmd.includes('ps'))
          return makeShellResult(MOCK_PS_OUTPUT + '\nu:r:app:s0 u0_a456 9999 2000 123456 7890 0 0 S my app name');
        return makeShellResult('');
      });
      acquirer = new ProcessAcquirer(device as any);

      const result = await acquirer.acquire();
      const data = await parseBlob(result.files[0].blob!);
      expect(data.processes.find((p: any) => p.pid === 9999).name).toBe('my app name');
    });

    it('should skip malformed lines gracefully', async () => {
      const malformed = [
        'LABEL USER PID PPID VSZ RSS WCHAN ADDR S NAME',
        'u:r:init:s0 root 1 0 17936 2048 0 0 S init',
        'malformed line',
        'u:r:system_server:s0 system 1234 1 3456789 98765 0 0 S system_server',
      ].join('\n');

      device.shell.mockImplementation(async (cmd: string) =>
        cmd.includes('ps') ? makeShellResult(malformed) : makeShellResult('')
      );
      acquirer = new ProcessAcquirer(device as any);

      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect((result.data as any).totalProcesses).toBe(2);
    });

    it('should handle empty process list', async () => {
      device.shell.mockImplementation(async (cmd: string) =>
        cmd.includes('ps') ? makeShellResult('LABEL USER PID PPID VSZ RSS WCHAN ADDR S NAME') : makeShellResult('')
      );
      acquirer = new ProcessAcquirer(device as any);

      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect((result.data as any).totalProcesses).toBe(0);
    });
  });

  describe('User ID Mapping', () => {
    it('should map root user to UID 0', async () => {
      const result = await acquirer.acquire();
      const data = await parseBlob(result.files[0].blob!);
      expect(data.processes.find((p: any) => p.user === 'root').uid).toBe(0);
    });

    it('should map system user to UID 1000', async () => {
      const result = await acquirer.acquire();
      const data = await parseBlob(result.files[0].blob!);
      expect(data.processes.find((p: any) => p.user === 'system').uid).toBe(1000);
    });

    it('should parse app user format (u0_aXXX)', async () => {
      const result = await acquirer.acquire();
      const data = await parseBlob(result.files[0].blob!);
      expect(data.processes.find((p: any) => p.user === 'u0_a123').uid).toBe(10123);
    });

    it('should handle unknown users', async () => {
      device.shell.mockImplementation(async (cmd: string) => {
        if (cmd.includes('ps')) return makeShellResult(
          'LABEL USER PID PPID VSZ RSS WCHAN ADDR S NAME\nu:r:app:s0 custom_user 9999 1 12345 678 0 0 S custom_app'
        );
        return makeShellResult('');
      });
      const result = await new ProcessAcquirer(device as any).acquire();
      const data = await parseBlob(result.files[0].blob!);
      expect(data.processes[0].uid).toBe(-1);
    });

    it('should handle multi-user format (u1_aXXX)', async () => {
      device.shell.mockImplementation(async (cmd: string) => {
        if (cmd.includes('ps')) return makeShellResult(
          'LABEL USER PID PPID VSZ RSS WCHAN ADDR S NAME\nu:r:app:s0 u1_a456 9999 1 12345 678 0 0 S secondary_user_app'
        );
        return makeShellResult('');
      });
      const result = await new ProcessAcquirer(device as any).acquire();
      const data = await parseBlob(result.files[0].blob!);
      // u1_a456 = 1*100000 + 10000 + 456 = 110456
      expect(data.processes[0].uid).toBe(110456);
    });
  });

  describe('Process Classification', () => {
    it('should classify system_server as system process', async () => {
      const result = await acquirer.acquire();
      const data = await parseBlob(result.files[0].blob!);
      expect(data.processes.find((p: any) => p.name === 'system_server').uid).toBe(1000);
      expect(data.systemProcesses).toBeGreaterThan(0);
    });

    it('should classify zygote processes as system', async () => {
      const result = await acquirer.acquire();
      const data = await parseBlob(result.files[0].blob!);
      expect(data.processes.find((p: any) => p.name.includes('zygote'))).toBeDefined();
    });

    it('should calculate correct system/user counts', async () => {
      const result = await acquirer.acquire();
      const data = await parseBlob(result.files[0].blob!);
      expect(data.systemProcesses + data.userProcesses).toBe(data.totalProcesses);
    });
  });

  describe('Configuration Options', () => {
    it('should include SELinux context when enabled', async () => {
      acquirer = new ProcessAcquirer(device as any, { includeSELinuxContext: true });
      await acquirer.acquire();
      expect(device.shell).toHaveBeenCalledWith(expect.stringContaining('ps -A -Z'), expect.anything());
    });

    it('should exclude SELinux context when disabled', async () => {
      acquirer = new ProcessAcquirer(device as any, { includeSELinuxContext: false });
      await acquirer.acquire();
      expect(device.shell).toHaveBeenCalled();
    });

    it('should include threads when enabled', async () => {
      acquirer = new ProcessAcquirer(device as any, { includeThreads: true });
      await acquirer.acquire();
      expect(device.shell).toHaveBeenCalledWith(expect.stringContaining('-T'), expect.anything());
    });

    it('should compute hash when configured', async () => {
      const result = await new ProcessAcquirer(device as any, { computeHash: true }).acquire();
      expect(result.success).toBe(true);
      expect(typeof result.files[0].hash).toBe('string');
    });

    it('should respect timeout configuration', async () => {
      const result = await new ProcessAcquirer(device as any, { timeout: 5000 }).acquire();
      expect(result.success).toBe(true);
    });
  });

  describe('Progress Reporting', () => {
    it('should report progress during acquisition', async () => {
      const { callback, getLastProgress } = createMockProgressCallback();
      await acquirer.acquire(callback);

      expect(callback).toHaveBeenCalled();
      expect(getLastProgress().progress).toBe(100);
      expect(getLastProgress().status).toBe('completed');
    });

    it('should report all progress stages', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const values = getProgressHistory().map((p: any) => p.progress);
      expect(values).toContain(10);
      expect(values).toContain(40);
      expect(values).toContain(70);
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

      const p20 = getProgressHistory().find((p: any) => p.progress === 20);
      expect(p20?.deviceInfo).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle ps command failure', async () => {
      device.shell.mockRejectedValue(new Error('ps command failed'));
      const result = await acquirer.acquire();
      expect(result.success).toBe(false);
      expect(result.error).toContain('ps command failed');
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

    it('should include error in result on failure', async () => {
      device.getProperties.mockRejectedValue(new Error('Device error'));
      const result = await acquirer.acquire();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Device error');
    });

    it('should handle unknown errors gracefully', async () => {
      device.getProperties.mockRejectedValue('Unknown error type');
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
      expect(result.duration).toBe(result.endTime.getTime() - result.startTime.getTime());
    });

    it('should include file size', async () => {
      expect((await acquirer.acquire()).files[0].fileSize).toBeGreaterThan(0);
    });

    it('should set correct acquisition type', async () => {
      expect((await acquirer.acquire()).type).toBe('process');
    });

    it('should include process counts in data', async () => {
      const data = (await acquirer.acquire()).data as any;
      expect(typeof data.totalProcesses).toBe('number');
      expect(typeof data.systemProcesses).toBe('number');
      expect(typeof data.userProcesses).toBe('number');
    });
  });

  describe('Output Format', () => {
    it('should create valid JSON', async () => {
      const result = await acquirer.acquire();
      const text = await result.files[0].blob!.text();
      expect(() => JSON.parse(text)).not.toThrow();
    });

    it('should include all required fields', async () => {
      const result = await acquirer.acquire();
      const data = await parseBlob(result.files[0].blob!);
      expect(data).toHaveProperty('totalProcesses');
      expect(data).toHaveProperty('systemProcesses');
      expect(data).toHaveProperty('userProcesses');
      expect(data).toHaveProperty('processes');
      expect(data).toHaveProperty('deviceInfo');
      expect(data).toHaveProperty('acquisitionTime');
      expect(data).toHaveProperty('timestamp');
    });

    it('should format process entries correctly', async () => {
      const result = await acquirer.acquire();
      const data = await parseBlob(result.files[0].blob!);
      const p = data.processes[0];
      expect(p).toHaveProperty('pid');
      expect(p).toHaveProperty('ppid');
      expect(p).toHaveProperty('uid');
      expect(p).toHaveProperty('user');
      expect(p).toHaveProperty('name');
      expect(p).toHaveProperty('state');
      expect(p).toHaveProperty('vsz');
      expect(p).toHaveProperty('rss');
    });

    it('should have correct blob type', async () => {
      const result = await acquirer.acquire();
      expect(result.files[0].blob!.type).toBe('application/json');
    });

    it('should generate correct filename', async () => {
      expect((await acquirer.acquire()).files[0].fileName).toBe('processes.json');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle real-world process snapshot', async () => {
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect((result.data as any).totalProcesses).toBeGreaterThan(0);
      expect(result.files[0].blob).toBeInstanceOf(Blob);
    });

    it('should work with different device models', async () => {
      device.getProperties.mockResolvedValue({
        model: 'Pixel 8', manufacturer: 'Google', androidVersion: '14',
        sdkVersion: 34, serialNumber: 'XYZ789', buildId: 'BUILD123', brand: 'Google',
      });
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect(result.files[0].fileName).toBe('processes.json');
    });

    it('should capture acquisition timestamp', async () => {
      const before = Date.now();
      const result = await acquirer.acquire();
      const after = Date.now();
      const data = await parseBlob(result.files[0].blob!);
      expect(data.timestamp).toBeGreaterThanOrEqual(before);
      expect(data.timestamp).toBeLessThanOrEqual(after);
    });
  });
});