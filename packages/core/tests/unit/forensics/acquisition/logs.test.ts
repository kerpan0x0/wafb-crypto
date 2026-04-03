import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LogAcquirer } from '../../../../src/forensics/acquisition/logs';
import {
  createMockDeviceForAcquirer,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  makeShellResult,
} from '../../../helpers/test-helpers';
import type { MockDevice } from '../../../helpers/test-helpers';

vi.setConfig({ testTimeout: 10000 });

describe('LogAcquirer', () => {
  let device: MockDevice;
  let acquirer: LogAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  const mockLsOutput = [
    'total 48',
    'drwx------ 2 system system 4096 Jan  1 10:00 .',
    'drwx------ 3 system system 4096 Jan  1 10:00 ..',
    '-rw------- 1 system system  1024 Jan  1 10:00 app_crashes.log',
    '-rw------- 1 system system  2048 Jan  1 10:00 system_server.log',
    '-rw------- 1 system system   512 Jan  1 10:00 boot.log',
  ].join('\n');

  const mockLogFileBytes = new TextEncoder().encode('Mock log file content\nLine 2\nLine 3');

  beforeEach(() => {
    vi.clearAllMocks();
    device = createMockDeviceForAcquirer({
      shellOutput: mockLsOutput,
      readFile: mockLogFileBytes,
    });
    domMocks = setupAcquirerDOMMocks();
    acquirer = new LogAcquirer(device as any);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('constructor', () => {
    it('should create LogAcquirer with default config', () => {
      expect(new LogAcquirer(device as any)).toBeInstanceOf(LogAcquirer);
    });

    it('should create LogAcquirer with custom config', () => {
      expect(new LogAcquirer(device as any, { includeSystemLogs: false })).toBeInstanceOf(LogAcquirer);
    });
  });

  describe('static properties', () => {
    it('should have correct staticLogFiles', () => {
      expect(LogAcquirer.staticLogFiles).toEqual([
        '/data/system/uiderrors.txt',
        '/proc/kmsg',
        '/proc/last_kmsg',
        '/sys/fs/pstore/console-ramoops',
      ]);
    });

    it('should have correct logFolders', () => {
      expect(LogAcquirer.logFolders).toEqual(['/data/anr/', '/data/log/', '/sdcard/log/']);
    });
  });

  describe('acquire', () => {
    it('should successfully acquire logs', async () => {
      const { callback } = createMockProgressCallback();
      const result = await acquirer.acquire(callback);

      expect(result.success).toBe(true);
      expect(result.type).toBe('logs');
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
      expect(result.duration).toBeGreaterThan(0);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ progress: 100, message: 'Log acquisition completed!', status: 'completed' })
      );
    });

    it('should include system logs by default', async () => {
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect((result.data as any).totalFiles).toBeGreaterThan(0);
    });

    it('should respect includeSystemLogs: false', async () => {
      const result = await new LogAcquirer(device as any, { includeSystemLogs: false }).acquire();
      expect(result.success).toBe(true);
    });

    it('should report progress during acquisition', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const history = getProgressHistory();
      expect(history.length).toBeGreaterThan(4);
      expect(history).toContainEqual(
        expect.objectContaining({ progress: 5, message: 'Reading device information...', status: 'running' })
      );
      expect(history).toContainEqual(
        expect.objectContaining({ progress: 100, status: 'completed' })
      );
    });

    it('should handle getProperties failure gracefully', async () => {
      device.getProperties.mockRejectedValue(new Error('Connection failed'));

      const { callback } = createMockProgressCallback();
      const result = await acquirer.acquire(callback);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection failed');
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', message: expect.stringContaining('Connection failed') })
      );
    });

    it('should handle permission denied on static files gracefully', async () => {
      // /proc/kmsg is a static log file — throw permission denied for it
      device = createMockDeviceForAcquirer({
        shellOutput: mockLsOutput,
        readFile: mockLogFileBytes,
        syncPermissionDeniedPaths: ['/proc/kmsg'],
      });
      acquirer = new LogAcquirer(device as any, { includeSystemLogs: true });

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).skippedFiles).toBeGreaterThan(0);
    });

    it('should collect log data with correct structure', async () => {
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        totalFiles: expect.any(Number),
        successfulFiles: expect.any(Number),
        failedFiles: expect.any(Number),
        skippedFiles: expect.any(Number),
        logs: expect.any(Array),
        deviceInfo: expect.any(Object),
        acquisitionTime: expect.any(String),
      });
    });
  });

  describe('parseFilesFromLs', () => {
    it('should parse ls output correctly', () => {
      expect((acquirer as any).parseFilesFromLs(mockLsOutput, '/data/log')).toEqual([
        '/data/log/app_crashes.log',
        '/data/log/system_server.log',
        '/data/log/boot.log',
      ]);
    });

    it('should handle empty ls output', () => {
      expect((acquirer as any).parseFilesFromLs('', '/data/log')).toEqual([]);
    });

    it('should skip directories', () => {
      const dirOnly = 'total 8\ndrwx------ 2 system system 4096 Jan  1 10:00 .\ndrwx------ 3 system system 4096 Jan  1 10:00 ..';
      expect((acquirer as any).parseFilesFromLs(dirOnly, '/data/log')).toEqual([]);
    });

    it('should handle paths with trailing slash', () => {
      expect((acquirer as any).parseFilesFromLs(mockLsOutput, '/data/log/')).toEqual([
        '/data/log/app_crashes.log',
        '/data/log/system_server.log',
        '/data/log/boot.log',
      ]);
    });
  });

  describe('logsFileName', () => {
    it('should collect files from all log folders', async () => {
      device.shell.mockImplementation(async (cmd: string) => {
        if (cmd.includes('/data/anr/')) return makeShellResult('-rw------- 1 system system 1024 Jan 1 10:00 traces.txt');
        if (cmd.includes('/data/log/')) return makeShellResult(mockLsOutput);
        if (cmd.includes('/sdcard/log/')) return makeShellResult('-rw------- 1 system system 512 Jan 1 10:00 app.log');
        return makeShellResult('');
      });

      const logFiles = await (acquirer as any).logsFileName(LogAcquirer.logFolders);
      expect(logFiles.length).toBeGreaterThan(0);
    });

    it('should handle inaccessible folders gracefully', async () => {
      device.shell.mockRejectedValue(new Error('Permission denied'));

      const logFiles = await (acquirer as any).logsFileName(['/inaccessible/']);
      expect(logFiles).toEqual([]);
    }, 5000);
  });

  describe('getFiles', () => {
    it('should read log files successfully', async () => {
      const result = await (acquirer as any).getFiles(
        ['/data/log/test.log'],
        { model: 'Test Device', manufacturer: 'Test' }
      );

      expect(result).toMatchObject({
        totalFiles: 1,
        successfulFiles: 1,
        failedFiles: 0,
        skippedFiles: 0,
        logs: expect.arrayContaining([
          expect.objectContaining({ path: '/data/log/test.log', success: true }),
        ]),
      });
    });

    it('should handle permission denied', async () => {
      device = createMockDeviceForAcquirer({
        syncPermissionDeniedPaths: ['/data/log/restricted.log'],
      });
      acquirer = new LogAcquirer(device as any);

      const result = await (acquirer as any).getFiles(
        ['/data/log/restricted.log'],
        { model: 'Test Device' }
      );

      expect(result.skippedFiles).toBe(1);
      expect(result.successfulFiles).toBe(0);
    }, 5000);

    it('should handle generic read failures', async () => {
      device = createMockDeviceForAcquirer({
        syncError: new Error('File not found'),
      });
      acquirer = new LogAcquirer(device as any);

      const result = await (acquirer as any).getFiles(
        ['/data/log/missing.log'],
        { model: 'Test Device' }
      );

      expect(result.failedFiles).toBe(1);
      expect(result.successfulFiles).toBe(0);
      expect(result.logs[0]).toMatchObject({
        path: '/data/log/missing.log',
        success: false,
        error: expect.stringContaining('File not found'),
      });
    }, 5000);
  });
});