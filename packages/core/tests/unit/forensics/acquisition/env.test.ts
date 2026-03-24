import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EnvAcquirer } from '../../../../src/forensics/acquisition/env';
import {
  createMockDeviceForAcquirer,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  makeShellResult,
  makeSpawnResult,
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


describe('EnvAcquirer', () => {
  let device: MockDevice;
  let acquirer: EnvAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  const mockEnvOutput = `PATH=/system/bin:/system/xbin
ANDROID_DATA=/data
ANDROID_ROOT=/system
ANDROID_STORAGE=/storage
EXTERNAL_STORAGE=/sdcard
HOME=/data
USER=shell
TMPDIR=/data/local/tmp
BOOTCLASSPATH=/system/framework/core.jar
LD_LIBRARY_PATH=/system/lib`;

  beforeEach(() => {
    vi.clearAllMocks();

    device = createMockDeviceForAcquirer({
      shellOutput: mockEnvOutput,
    });

    domMocks = setupAcquirerDOMMocks();
    acquirer = new EnvAcquirer(device as any);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('acquire', () => {
    it('should successfully acquire environment variables', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.type).toBe('env');
      expect(result.files[0].fileName).toBe('env.txt');
      expect(device.shell).toHaveBeenCalled();
    });

    it('should call env command', async () => {
      await acquirer.acquire();

      expect(device.shell).toHaveBeenCalled();
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
      acquirer = new EnvAcquirer(device as any, { computeHash: true });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.files).toBeDefined();
      expect(result.files).toHaveLength(1);
      expect(await drainAndHash(result, 0)).toBeDefined();
    });

    it('should download file with correct blob type', async () => {
      const result = await acquirer.acquire();

      expect(result.files[0].stream).toBeInstanceOf(ReadableStream);
      expect(result.files[0].mimeType).toBe('application/text');
    });

    it('should include device information in result', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data?.deviceInfo).toBeDefined();
      expect(device.getProperties).toHaveBeenCalled();
    });

    it('should handle empty environment variables', async () => {
      domMocks.cleanup();
      device = createMockDeviceForAcquirer({
        shellOutput: '',
      });
      domMocks = setupAcquirerDOMMocks();
      acquirer = new EnvAcquirer(device as any);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.type).toBe('env');
    });

    it('should set correct file name', async () => {
      const result = await acquirer.acquire();

      expect(result.files[0].fileName).toBe('env.txt');
    });

    it('should return blob on successful acquisition', async () => {
      const result = await acquirer.acquire();

      expect(result.files[0].stream).toBeInstanceOf(ReadableStream);
      expect(result.files[0].fileName).toBe('env.txt');
    });
  });

  describe('error handling', () => {
    it('should handle device connection errors', async () => {
      device.getProperties = vi.fn().mockRejectedValue(new Error('Connection failed'));

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Connection failed');
    });

    it('should handle shell command errors', async () => {
      device.shell.mockRejectedValue(
        new Error('Shell command failed')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Shell command failed');
    });

    it('should report progress on error', async () => {
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
      expect(result.type).toBe('env');
    });

    it('should handle unknown errors gracefully', async () => {
      device.getProperties = vi.fn().mockRejectedValue('Unknown error type');

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  describe('environment variable parsing', () => {
    it('should handle PATH variable', async () => {
      domMocks.cleanup();
      device = createMockDeviceForAcquirer({
        shellOutput: 'PATH=/system/bin:/system/xbin',
      });
      domMocks = setupAcquirerDOMMocks();
      acquirer = new EnvAcquirer(device as any);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(device.shell).toHaveBeenCalled();
    });

    it('should handle ANDROID_DATA variable', async () => {
      domMocks.cleanup();
      device = createMockDeviceForAcquirer({
        shellOutput: 'ANDROID_DATA=/data',
      });
      domMocks = setupAcquirerDOMMocks();
      acquirer = new EnvAcquirer(device as any);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });

    it('should handle multiple environment variables', async () => {
      const multiLineEnv = `VAR1=value1
VAR2=value2
VAR3=value3`;
      domMocks.cleanup();
      device = createMockDeviceForAcquirer({
        shellOutput: multiLineEnv,
      });
      domMocks = setupAcquirerDOMMocks();
      acquirer = new EnvAcquirer(device as any);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });

    it('should handle environment variables with special characters', async () => {
      domMocks.cleanup();
      device = createMockDeviceForAcquirer({
        shellOutput: 'PATH=/system/bin:/system/xbin:$HOME',
      });
      domMocks = setupAcquirerDOMMocks();
      acquirer = new EnvAcquirer(device as any);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });

    it('should handle environment variables with spaces', async () => {
      domMocks.cleanup();
      device = createMockDeviceForAcquirer({
        shellOutput: 'DESCRIPTION=Android System Variables',
      });
      domMocks = setupAcquirerDOMMocks();
      acquirer = new EnvAcquirer(device as any);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });
  });

  describe('result metadata', () => {
    it('should include start and end times', async () => {
      const result = await acquirer.acquire();

      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
      expect(result.endTime.getTime()).toBeGreaterThanOrEqual(result.startTime.getTime());
    });

    it('should calculate duration correctly', async () => {
      const result = await acquirer.acquire();

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.duration).toBe(result.endTime.getTime() - result.startTime.getTime());
    });

    it('should include file size in result', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.files).toBeDefined();
      expect(result.files).toHaveLength(1);
      expect(result.files[0].fileSize).toBeDefined();
      expect(result.files[0].fileSize).toBeGreaterThanOrEqual(0);
    });

    it('should include data format in result', async () => {
      const result = await acquirer.acquire();

      expect(result.data?.format).toBe('text');
    });

    it('should set correct acquisition type', async () => {
      const result = await acquirer.acquire();

      expect(result.type).toBe('env');
    });
  });

  describe('progress reporting', () => {
    it('should report initial progress', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();

      await acquirer.acquire(callback);

      const history = getProgressHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].progress).toBe(10);
      expect(history[0].message).toContain('device information');
    });

    it('should report device connection progress', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();

      await acquirer.acquire(callback);

      const history = getProgressHistory();
      const deviceProgress = history.find(p => p.progress === 20);
      expect(deviceProgress).toBeDefined();
      expect(deviceProgress?.message).toContain('Connected to');
    });

    it('should report environment variable collection progress', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();

      await acquirer.acquire(callback);

      const history = getProgressHistory();
      const envProgress = history.find(p => p.progress === 40);
      expect(envProgress).toBeDefined();
      expect(envProgress?.message).toContain('environment variables');
    });

    it('should report download progress', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();

      await acquirer.acquire(callback);

      const history = getProgressHistory();
      const downloadProgress = history.find(p => p.progress === 70);
      expect(downloadProgress).toBeDefined();
      expect(downloadProgress?.message).toContain('Downloading');
    });

    it('should report preparation progress', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();

      await acquirer.acquire(callback);

      const history = getProgressHistory();
      const prepProgress = history.find(p => p.progress === 90);
      expect(prepProgress).toBeDefined();
      expect(prepProgress?.message).toContain('Preparing download');
    });

    it('should report completion', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();

      await acquirer.acquire(callback);

      const history = getProgressHistory();
      const finalProgress = history[history.length - 1];
      expect(finalProgress.progress).toBe(100);
      expect(finalProgress.status).toBe('completed');
      expect(finalProgress.message).toContain('success');
    });

    it('should include device info in progress', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      const mockProperties = {
        model: 'Pixel 8',
        manufacturer: 'Google',
      };
      device.getProperties = vi.fn().mockResolvedValue(mockProperties);

      await acquirer.acquire(callback);

      const history = getProgressHistory();
      const deviceProgress = history.find(p => p.progress === 20);
      expect(deviceProgress?.deviceInfo).toEqual(mockProperties);
    });
  });

  describe('integration with device', () => {
    it('should use device commands correctly', async () => {
      await acquirer.acquire();

      expect(device.getProperties).toHaveBeenCalledTimes(1);
      expect(device.shell).toHaveBeenCalled();
    });

    it('should pass device info to result', async () => {
      const mockProperties = {
        model: 'Galaxy S23',
        manufacturer: 'Samsung',
        androidVersion: '14',
        serialNumber: 'XYZ789',
      };
      device.getProperties = vi.fn().mockResolvedValue(mockProperties);

      const result = await acquirer.acquire();

      expect(result.data?.deviceInfo).toEqual(mockProperties);
    });

    it('should work with different device models', async () => {
      const mockProperties = {
        model: 'OnePlus 12',
        manufacturer: 'OnePlus',
        androidVersion: '14',
      };
      device.getProperties = vi.fn().mockResolvedValue(mockProperties);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data?.deviceInfo.model).toBe('OnePlus 12');
    });
  });

  describe('common environment variables', () => {
    it('should handle standard Android environment variables', async () => {
      const standardEnv = `ANDROID_DATA=/data
ANDROID_ROOT=/system
ANDROID_STORAGE=/storage
EXTERNAL_STORAGE=/sdcard
BOOTCLASSPATH=/system/framework/core.jar`;

      domMocks.cleanup();
      device = createMockDeviceForAcquirer({
        shellOutput: standardEnv,
      });
      domMocks = setupAcquirerDOMMocks();
      acquirer = new EnvAcquirer(device as any);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(device.shell).toHaveBeenCalled();
    });

    it('should handle shell user environment', async () => {
      const shellEnv = `USER=shell
HOME=/data
TMPDIR=/data/local/tmp
SHELL=/system/bin/sh`;

      domMocks.cleanup();
      device = createMockDeviceForAcquirer({
        shellOutput: shellEnv,
      });
      domMocks = setupAcquirerDOMMocks();
      acquirer = new EnvAcquirer(device as any);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });

    it('should handle library paths', async () => {
      const libEnv = `LD_LIBRARY_PATH=/system/lib:/vendor/lib
LD_PRELOAD=/system/lib/libpreload.so`;

      domMocks.cleanup();
      device = createMockDeviceForAcquirer({
        shellOutput: libEnv,
      });
      domMocks = setupAcquirerDOMMocks();
      acquirer = new EnvAcquirer(device as any);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });
  });

  describe('configuration options', () => {
    it('should respect computeHash configuration', async () => {
      acquirer = new EnvAcquirer(device as any, { computeHash: false });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.files).toBeDefined();
      expect(result.files).toHaveLength(1);
      expect(await result.files[0].hashPromise).toBeUndefined();
    });

    it('should work with empty configuration', async () => {
      acquirer = new EnvAcquirer(device as any, {});
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });

    it('should work with default configuration', async () => {
      acquirer = new EnvAcquirer(device as any);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });
  });
});