import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TmpAcquirer } from '../../../../src/forensics/acquisition/tmp';
import {
  createMockDeviceForAcquirer,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  createMockDeviceProperties,
  createMockSync,
  makeShellResult,
} from '../../../helpers/test-helpers';
import type { MockDevice } from '../../../helpers/test-helpers';

describe('TmpAcquirer', () => {
  let device: MockDevice;
  let acquirer: TmpAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  const ENV_WITH_TMPDIR    = 'PATH=/system/bin\nTMPDIR=/data/local/tmp\nHOME=/data';
  const ENV_WITHOUT_TMPDIR = 'PATH=/system/bin\nHOME=/data';
  const LS_OUTPUT = [
    '-rw-r--r-- 1 root root 1024 2024-01-01 12:00 testfile1.txt',
    '-rw-r--r-- 1 root root 2048 2024-01-01 12:01 testfile2.log',
    'drwxr-xr-x 2 root root 4096 2024-01-01 12:02 subdir',
  ].join('\n');

  function setupShell(envOutput: string, lsOutput: string) {
    device.shell.mockImplementation(async (cmd: string) => {
      if (cmd === 'env') return makeShellResult(envOutput);
      if (cmd.includes('ls -R')) return makeShellResult(lsOutput);
      return makeShellResult('');
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    device = createMockDeviceForAcquirer();
    setupShell(ENV_WITH_TMPDIR, LS_OUTPUT);
    domMocks = setupAcquirerDOMMocks();
    acquirer = new TmpAcquirer(device as any);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      expect(acquirer).toBeInstanceOf(TmpAcquirer);
    });

    it('should create instance with custom config', () => {
      expect(new TmpAcquirer(device as any, {})).toBeInstanceOf(TmpAcquirer);
    });
  });

  describe('acquire', () => {
    it('should successfully complete acquisition with files in tmp directory', async () => {
      const fileContent = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
      device.sync.mockResolvedValue(createMockSync(fileContent));

      const progressMock = createMockProgressCallback();
      const result = await acquirer.acquire(progressMock.callback);

      expect(result.success).toBe(true);
      expect(result.type).toBe('tmp');
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.error).toBeUndefined();

      expect(progressMock.callback).toHaveBeenCalled();
      const calls = progressMock.callback.mock.calls;
      expect(calls[0][0].message).toBe('Starting tmp acquisition...');
      expect(calls[calls.length - 1][0].message).toBe('Tmp acquisition completed.');
      expect(calls[calls.length - 1][0].status).toBe('completed');
    });

    it('should handle empty tmp directory', async () => {
      setupShell(ENV_WITH_TMPDIR, '');

      const progressMock = createMockProgressCallback();
      const result = await acquirer.acquire(progressMock.callback);

      expect(result.success).toBe(true);
      expect(result.type).toBe('tmp');
      expect(progressMock.callback).toHaveBeenCalled();
    });

    it('should use default tmp directory when TMPDIR not found in environment', async () => {
      setupShell(ENV_WITHOUT_TMPDIR, '-rw-r--r-- 1 root root 1024 2024-01-01 12:00 defaultfile.txt');
      device.sync.mockResolvedValue(createMockSync(new Uint8Array([0x74, 0x65, 0x73, 0x74])));

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });

    it('should handle errors during acquisition', async () => {
      device.getProperties = vi.fn().mockRejectedValue(new Error('Device connection failed'));

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.type).toBe('tmp');
      expect(result.error).toBe('Device connection failed');
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
    });

    it('should handle errors when getting environment variables', async () => {
      device.getProperties.mockResolvedValue(createMockDeviceProperties());
      device.shell.mockImplementation(async (cmd: string) => {
        if (cmd === 'env') throw new Error('Environment command failed');
        return makeShellResult('');
      });

      const result = await acquirer.acquire();

      expect(result.success).toBe(true); // falls back to default tmp dir
    });

    it('should call progress callback with correct parameters', async () => {
      const fileContent = new Uint8Array([0x41, 0x42, 0x43]); // "ABC"
      device.sync.mockResolvedValue(createMockSync(fileContent));

      const progressMock = createMockProgressCallback();
      await acquirer.acquire(progressMock.callback);

      expect(progressMock.callback).toHaveBeenCalled();
      const calls = progressMock.callback.mock.calls;

      expect(calls[0][0]).toMatchObject({
        progress: 0,
        message: 'Starting tmp acquisition...',
        status: 'running',
      });
      expect(calls[calls.length - 1][0]).toMatchObject({
        progress: 100,
        message: 'Tmp acquisition completed.',
        status: 'completed',
      });
    });

    it('should properly parse files from ls output', async () => {
      const complexLsOutput = [
        '-rw-r--r-- 1 root root 1024 Jan  1 12:00 file1.txt',
        'drwxr-xr-x 2 root root 4096 Jan  1 12:01 subdir',
        '-rw-r--r-- 1 root root 2048 Jan  1 12:02 file2.log',
        '-rwxr-xr-x 1 root root  512 Jan  1 12:03 executable',
        'lrwxrwxrwx 1 root root   10 Jan  1 12:04 symlink -> target',
      ].join('\n');

      setupShell(ENV_WITH_TMPDIR, complexLsOutput);
      const mockSync = createMockSync(new Uint8Array([0x44, 0x61, 0x74, 0x61]));
      device.sync.mockResolvedValue(mockSync);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      // Only regular files (not directories or symlinks) should be read
      expect(mockSync.read).toHaveBeenCalledTimes(3); // file1.txt, file2.log, executable
    });
  });
});