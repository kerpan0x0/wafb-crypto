import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LogAcquirer } from '../../../../src/forensics/acquisition/logs';
import {
  createMockADBDeviceWithCommands,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
} from '../../../helpers/test-helpers';
import type { ADBDevice } from '../../../../src/adb/device';

// Set test timeout to 10 seconds to prevent hanging tests
vi.setConfig({ testTimeout: 10000 });

// Set test timeout to 10 seconds
vi.setConfig({ testTimeout: 10000 });

// Mock JSZip
const mockJSZip = {
  default: vi.fn(() => ({
    file: vi.fn(),
    generateAsync: vi.fn().mockResolvedValue(new Blob(['mock zip content'])),
  })),
};
vi.mock('jszip', () => mockJSZip);

describe('LogAcquirer', () => {
  let device: ADBDevice;
  let acquirer: LogAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  const mockLsOutput = `total 48
drwx------ 2 system system 4096 Jan  1 10:00 .
drwx------ 3 system system 4096 Jan  1 10:00 ..
-rw------- 1 system system  1024 Jan  1 10:00 app_crashes.log
-rw------- 1 system system  2048 Jan  1 10:00 system_server.log
-rw------- 1 system system   512 Jan  1 10:00 boot.log`;

  const mockLogFileContent = 'Mock log file content\nLine 2 of logs\nLine 3 with timestamp';
  const mockLogFileBytes = new TextEncoder().encode(mockLogFileContent);

  beforeEach(() => {
    vi.clearAllMocks();

    // Create device mock with shell command responses for ls and file reading
    device = createMockADBDeviceWithCommands({
      shellOutput: mockLsOutput,
      readFile: mockLogFileBytes,
    }) as unknown as ADBDevice;

    domMocks = setupAcquirerDOMMocks();
    acquirer = new LogAcquirer(device);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('constructor', () => {
    it('should create LogAcquirer with default config', () => {
      const logAcquirer = new LogAcquirer(device);
      expect(logAcquirer).toBeInstanceOf(LogAcquirer);
    });

    it('should create LogAcquirer with custom config', () => {
      const config = { includeSystemLogs: false, timeout: 30000 };
      const logAcquirer = new LogAcquirer(device, config);
      expect(logAcquirer).toBeInstanceOf(LogAcquirer);
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
    it('should successfully acquire logs with default settings', async () => {
      const progressCallback = createMockProgressCallback();

      const result = await acquirer.acquire(progressCallback.callback);

      expect(result.success).toBe(true);
      expect(result.type).toBe('logs');
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.data).toBeDefined();

      // Check that progress was reported
      expect(progressCallback.callback).toHaveBeenCalledWith(
        expect.objectContaining({
          progress: 100,
          message: 'Log acquisition completed!',
          status: 'completed',
        })
      );
    });

    it('should handle system logs inclusion based on config', async () => {
      const config = { includeSystemLogs: false };
      const customAcquirer = new LogAcquirer(device, config);

      const result = await customAcquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should include system logs by default', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      // Static log files should be included in the total count
      const logData = result.data as any;
      expect(logData.totalFiles).toBeGreaterThan(0);
    });

    it('should report progress during acquisition', async () => {
      const progressCallback = createMockProgressCallback();

      await acquirer.acquire(progressCallback.callback);

      const progressHistory = progressCallback.getProgressHistory();

      // Should have multiple progress updates
      expect(progressHistory.length).toBeGreaterThan(4);

      // Check key progress steps
      expect(progressHistory).toContainEqual(
        expect.objectContaining({
          progress: 5,
          message: 'Reading device information...',
          status: 'running',
        })
      );

      expect(progressHistory).toContainEqual(
        expect.objectContaining({
          progress: 100,
          message: 'Log acquisition completed!',
          status: 'completed',
        })
      );
    });

    it('should handle errors gracefully', async () => {
      // Mock device to throw an error
      device.getProperties = vi.fn().mockRejectedValue(new Error('Connection failed'));

      const progressCallback = createMockProgressCallback();
      const result = await acquirer.acquire(progressCallback.callback);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection failed');
      expect(result.type).toBe('logs');
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);

      // Should report failure in progress
      expect(progressCallback.callback).toHaveBeenCalledWith(
        expect.objectContaining({
          progress: 100,
          message: expect.stringContaining('Log acquisition failed'),
          status: 'failed',
        })
      );
    });

    it('should handle permission denied files gracefully', async () => {
      // Create a custom acquirer that will have actual permission denied behavior
      // Mock the static files to include one that would fail
      const config = { includeSystemLogs: true };
      const customAcquirer = new LogAcquirer(device, config);

      // Mock one of the static log files to throw permission denied
      device.adb.sync = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          read: vi.fn().mockImplementation((path: string) => {
            if (path === '/proc/kmsg') {
              return Promise.reject(new Error('Permission denied'));
            }
            return Promise.resolve(mockLogFileBytes);
          }),
          dispose: vi.fn(),
        });
      });

      const result = await customAcquirer.acquire();

      expect(result.success).toBe(true);
      const logData = result.data as any;
      expect(logData.skippedFiles).toBeGreaterThan(0);
    });

    it('should collect log data with correct metadata', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      const logData = result.data as any;

      expect(logData).toMatchObject({
        totalFiles: expect.any(Number),
        successfulFiles: expect.any(Number),
        failedFiles: expect.any(Number),
        skippedFiles: expect.any(Number),
        logs: expect.any(Array),
        deviceInfo: expect.any(Object),
        acquisitionTime: expect.any(String),
      });

      expect(logData.logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: expect.any(String),
            data: expect.any(String),
            size: expect.any(Number),
            success: expect.any(Boolean),
          }),
        ])
      );
    });
  });

  describe('parseFilesFromLs', () => {
    it('should parse ls output correctly', () => {
      // Access private method for testing
      const acquirerAny = acquirer as any;
      const files = acquirerAny.parseFilesFromLs(mockLsOutput, '/data/log');

      expect(files).toEqual([
        '/data/log/app_crashes.log',
        '/data/log/system_server.log',
        '/data/log/boot.log',
      ]);
    });

    it('should handle empty ls output', () => {
      const acquirerAny = acquirer as any;
      const files = acquirerAny.parseFilesFromLs('', '/data/log');

      expect(files).toEqual([]);
    });

    it('should handle ls output with only directories', () => {
      const dirOnlyOutput = `total 8
drwx------ 2 system system 4096 Jan  1 10:00 .
drwx------ 3 system system 4096 Jan  1 10:00 ..`;

      const acquirerAny = acquirer as any;
      const files = acquirerAny.parseFilesFromLs(dirOnlyOutput, '/data/log');

      expect(files).toEqual([]);
    });

    it('should handle paths with trailing slash correctly', () => {
      const acquirerAny = acquirer as any;
      const files = acquirerAny.parseFilesFromLs(mockLsOutput, '/data/log/');

      expect(files).toEqual([
        '/data/log/app_crashes.log',
        '/data/log/system_server.log',
        '/data/log/boot.log',
      ]);
    });
  });

  describe('logsFileName', () => {
    it('should collect files from all log folders', async () => {
      // Mock different outputs for different folders
      device.adb.subprocess.shellProtocol.spawn = vi.fn().mockImplementation((command: string) => {
        let output = '';
        if (command.includes('/data/anr/')) {
          output = '-rw------- 1 system system 1024 Jan 1 10:00 traces.txt';
        } else if (command.includes('/data/log/')) {
          output = mockLsOutput;
        } else if (command.includes('/sdcard/log/')) {
          output = '-rw------- 1 system system 512 Jan 1 10:00 app.log';
        }

        let readCount = 0;
        return Promise.resolve({
          stdout: {
            getReader: () => ({
              read: async () => {
                readCount++;
                if (readCount === 1) {
                  return { done: false, value: new TextEncoder().encode(output) };
                }
                return { done: true, value: undefined };
              },
              releaseLock: vi.fn(),
            }),
          },
          stderr: {
            getReader: () => ({
              read: async () => ({ done: true, value: undefined }),
              releaseLock: vi.fn(),
            }),
          },
          stdin: new WritableStream(),
          exit: Promise.resolve({ code: 0 }),
        });
      });

      const acquirerAny = acquirer as any;
      const logFiles = await acquirerAny.logsFileName(LogAcquirer.logFolders);

      expect(logFiles.length).toBeGreaterThan(0);
    });

    it('should handle inaccessible folders gracefully', async () => {
      device.adb.subprocess.shellProtocol.spawn = vi
        .fn()
        .mockRejectedValue(new Error('Permission denied'));

      const acquirerAny = acquirer as any;
      const logFiles = await acquirerAny.logsFileName(['/inaccessible/folder/']);

      expect(logFiles).toEqual([]);
    }, 5000);
  });

  describe('getFiles', () => {
    it('should read log files successfully', async () => {
      const acquirerAny = acquirer as any;
      const mockDeviceInfo = { model: 'Test Device', manufacturer: 'Test' };

      const result = await acquirerAny.getFiles(['/data/log/test.log'], mockDeviceInfo);

      expect(result).toMatchObject({
        totalFiles: 1,
        successfulFiles: 1,
        failedFiles: 0,
        skippedFiles: 0,
        logs: expect.arrayContaining([
          expect.objectContaining({
            path: '/data/log/test.log',
            data: expect.any(String),
            size: expect.any(Number),
            success: true,
          }),
        ]),
        deviceInfo: mockDeviceInfo,
        acquisitionTime: expect.any(String),
      });
    });

    it('should handle permission denied files', async () => {
      // Mock sync to throw permission denied error
      device.adb.sync = vi.fn().mockResolvedValue({
        read: vi.fn().mockRejectedValue(new Error('Permission denied')),
        dispose: vi.fn(),
      });

      const acquirerAny = acquirer as any;
      const mockDeviceInfo = { model: 'Test Device' };

      const result = await acquirerAny.getFiles(['/data/log/restricted.log'], mockDeviceInfo);

      expect(result.skippedFiles).toBe(1);
      expect(result.successfulFiles).toBe(0);
    }, 5000);

    it('should handle file read failures', async () => {
      // Mock sync to throw generic error
      device.adb.sync = vi.fn().mockResolvedValue({
        read: vi.fn().mockRejectedValue(new Error('File not found')),
        dispose: vi.fn(),
      });

      const acquirerAny = acquirer as any;
      const mockDeviceInfo = { model: 'Test Device' };

      const result = await acquirerAny.getFiles(['/data/log/missing.log'], mockDeviceInfo);

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
