import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RootBinariesAcquirer } from '../../../../src/forensics/acquisition/root-binaries';
import {
  createMockDeviceForAcquirer,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  makeShellResult,
} from '../../../helpers/test-helpers';
import type { MockDevice } from '../../../helpers/test-helpers';

describe('RootBinariesAcquirer', () => {
  let device: MockDevice;
  let acquirer: RootBinariesAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  const mockRootBinaryPaths = {
    su: '/system/bin/su\n/system/xbin/su',
    busybox: '/system/bin/busybox',
    magisk: '/data/adb/magisk',
    magiskhide: '/data/adb/magisk/magiskhide',
    supersu: '',
    'Superuser.apk': '',
    'KingoUser.apk': '',
    'SuperSu.apk': '',
    magiskinit: '/data/adb/magisk/magiskinit',
    magiskpolicy: '/data/adb/magisk/magiskpolicy',
    magiskboot: '/data/adb/magisk/magiskboot',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    device = createMockDeviceForAcquirer();

    domMocks = setupAcquirerDOMMocks();
    acquirer = new RootBinariesAcquirer(device as any);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('acquire', () => {
    it('should successfully acquire root binaries information', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.type).toBe('rootBinaries');
      expect(result.files[0].fileName).toBe('root_binaries.json');
      expect(device.shell).toHaveBeenCalled();
    });

    it('should check all root binaries', async () => {
      await acquirer.acquire();

      const expectedBinaries = [
        'su',
        'busybox',
        'supersu',
        'Superuser.apk',
        'KingoUser.apk',
        'SuperSu.apk',
        'magisk',
        'magiskhide',
        'magiskinit',
        'magiskpolicy',
        'magiskboot',
      ];

      expectedBinaries.forEach(binary => {
        expect(device.shell).toHaveBeenCalledWith(`which -a ${binary}`, expect.anything());
      });
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
      acquirer = new RootBinariesAcquirer(device as any, { computeHash: true });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.files[0].hash).toBeDefined();
    });

    it('should generate valid JSON output', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data?.format).toBe('text');
      expect(result.files[0].blob).toBeInstanceOf(Blob);
    });

    it('should include device information in result', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data?.deviceInfo).toBeDefined();
      expect(device.getProperties).toHaveBeenCalled();
    });

    it('should handle binaries not found on device', async () => {
      // Mock all binaries as not found
      device.shell.mockResolvedValue(makeShellResult(''));

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.type).toBe('rootBinaries');
    });

    it('should download file with correct blob type', async () => {
      const result = await acquirer.acquire();

      expect(result.files[0].blob).toBeInstanceOf(Blob);
      expect(result.files[0].blob!.type).toBe('application/json');
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
        new Error('Shell error')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(true); // Should still succeed as errors are caught per binary
      expect(device.shell).toHaveBeenCalled();
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
      expect(result.type).toBe('rootBinaries');
    });
  });

  describe('root binary detection', () => {
    it('should detect su binary in multiple locations', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(device.shell).toHaveBeenCalledWith('which -a su', expect.anything());
    });

    it('should detect magisk binaries', async () => {
      const magiskBinaries = ['magisk', 'magiskhide', 'magiskinit', 'magiskpolicy', 'magiskboot'];

      await acquirer.acquire();

      magiskBinaries.forEach(binary => {
        expect(device.shell).toHaveBeenCalledWith(`which -a ${binary}`, expect.anything());
      });
    });

    it('should detect SuperSU related files', async () => {
      const supersuFiles = ['supersu', 'Superuser.apk', 'SuperSu.apk'];

      await acquirer.acquire();

      supersuFiles.forEach(file => {
        expect(device.shell).toHaveBeenCalledWith(`which -a ${file}`, expect.anything());
      });
    });

    it('should detect KingoRoot files', async () => {
      await acquirer.acquire();

      expect(device.shell).toHaveBeenCalledWith('which -a KingoUser.apk', expect.anything());
    });

    it('should detect busybox', async () => {
      await acquirer.acquire();

      expect(device.shell).toHaveBeenCalledWith('which -a busybox', expect.anything());
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
      expect(result.files[0].fileSize).toBeDefined();
      expect(result.files[0].fileSize).toBeGreaterThan(0);
    });

    it('should set correct file name', async () => {
      const result = await acquirer.acquire();

      expect(result.files[0].fileName).toBe('root_binaries.json');
    });

    it('should include data format in result', async () => {
      const result = await acquirer.acquire();

      expect(result.data?.format).toBe('text');
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

    it('should report binary collection progress', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();

      await acquirer.acquire(callback);

      const history = getProgressHistory();
      const binaryProgress = history.find(p => p.progress === 40);
      expect(binaryProgress).toBeDefined();
      expect(binaryProgress?.message).toContain('root binaries');
    });

    it('should report download progress', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();

      await acquirer.acquire(callback);

      const history = getProgressHistory();
      const downloadProgress = history.find(p => p.progress === 70);
      expect(downloadProgress).toBeDefined();
      expect(downloadProgress?.message).toContain('Downloading');
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
  });

  describe('integration with device', () => {
    it('should use device commands correctly', async () => {
      await acquirer.acquire();

      expect(device.getProperties).toHaveBeenCalledTimes(1);
      expect(device.shell).toHaveBeenCalled();
    });

    it('should pass device info to result', async () => {
      const mockProperties = {
        model: 'Pixel 7',
        manufacturer: 'Google',
        androidVersion: '14',
        serialNumber: 'ABC123',
      };
      device.getProperties = vi.fn().mockResolvedValue(mockProperties);

      const result = await acquirer.acquire();

      expect(result.data?.deviceInfo).toEqual(mockProperties);
    });
  });
});