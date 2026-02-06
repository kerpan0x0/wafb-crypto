import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TmpAcquirer } from '../../../../src/forensics/acquisition/tmpAcquirer';
import { 
  createMockADBDeviceWithCommands,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  createMockDeviceProperties
} from '../../../helpers/test-helpers';
import type { ADBDevice } from '../../../../src/adb/device';

describe('TmpAcquirer', () => {
  let device: ADBDevice;
  let acquirer: TmpAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    domMocks = setupAcquirerDOMMocks();
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      device = createMockADBDeviceWithCommands() as unknown as ADBDevice;
      acquirer = new TmpAcquirer(device);
      expect(acquirer).toBeInstanceOf(TmpAcquirer);
    });

    it('should create instance with custom config', () => {
      device = createMockADBDeviceWithCommands() as unknown as ADBDevice;
      const customConfig = {};
      const customAcquirer = new TmpAcquirer(device, customConfig);
      expect(customAcquirer).toBeInstanceOf(TmpAcquirer);
    });
  });

  describe('acquire', () => {
    it('should successfully complete acquisition with files in tmp directory', async () => {
      // Mock environment variable response with custom TMPDIR
      const envOutput = 'PATH=/system/bin\nTMPDIR=/data/local/tmp\nHOME=/data';
      
      // Mock ls output with some files
      const lsOutput = `-rw-r--r-- 1 root root 1024 2024-01-01 12:00 testfile1.txt
-rw-r--r-- 1 root root 2048 2024-01-01 12:01 testfile2.log
drwxr-xr-x 2 root root 4096 2024-01-01 12:02 subdir`;

      // Mock file content
      const fileContent = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello" in bytes

      device = createMockADBDeviceWithCommands({
        shellOutput: envOutput,
        readFile: fileContent
      }) as unknown as ADBDevice;

      // Override the shell spawn to handle different commands
      const mockShellSpawn = vi.fn().mockImplementation((command: string) => {
        if (command === 'env') {
          return {
            stdout: {
              getReader: () => ({
                read: vi.fn()
                  .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(envOutput) })
                  .mockResolvedValueOnce({ done: true, value: undefined }),
                releaseLock: vi.fn()
              })
            }
          };
        } else if (command.includes('ls -R /data/local/tmp')) {
          return {
            stdout: {
              getReader: () => ({
                read: vi.fn()
                  .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(lsOutput) })
                  .mockResolvedValueOnce({ done: true, value: undefined }),
                releaseLock: vi.fn()
              })
            }
          };
        }
        return {
          stdout: {
            getReader: () => ({
              read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
              releaseLock: vi.fn()
            })
          }
        };
      });

      device.adb.subprocess.shellProtocol.spawn = mockShellSpawn;

      // Mock sync service for file reading
      const mockSync = {
        read: vi.fn().mockReturnValue({
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: fileContent })
              .mockResolvedValueOnce({ done: true, value: undefined }),
            releaseLock: vi.fn()
          })
        }),
        dispose: vi.fn()
      };
      device.adb.sync = vi.fn().mockResolvedValue(mockSync);

      acquirer = new TmpAcquirer(device);

      const progressMock = createMockProgressCallback();
      const result = await acquirer.acquire(progressMock.callback);

      expect(result.success).toBe(true);
      expect(result.type).toBe('tmp');
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.error).toBeUndefined();

      // Verify progress callbacks were called
      expect(progressMock.callback).toHaveBeenCalled();
      const progressCalls = progressMock.callback.mock.calls;
      expect(progressCalls[0][0].message).toBe('Starting tmp acquisition...');
      expect(progressCalls[progressCalls.length - 1][0].message).toBe('Tmp acquisition completed.');
      expect(progressCalls[progressCalls.length - 1][0].status).toBe('completed');
    });

    it('should handle empty tmp directory', async () => {
      const envOutput = 'PATH=/system/bin\nTMPDIR=/data/local/tmp\nHOME=/data';
      const emptyLsOutput = ''; // No files

      device = createMockADBDeviceWithCommands({
        shellOutput: envOutput
      }) as unknown as ADBDevice;

      const mockShellSpawn = vi.fn().mockImplementation((command: string) => {
        if (command === 'env') {
          return {
            stdout: {
              getReader: () => ({
                read: vi.fn()
                  .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(envOutput) })
                  .mockResolvedValueOnce({ done: true, value: undefined }),
                releaseLock: vi.fn()
              })
            }
          };
        } else if (command.includes('ls -R /data/local/tmp')) {
          return {
            stdout: {
              getReader: () => ({
                read: vi.fn()
                  .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(emptyLsOutput) })
                  .mockResolvedValueOnce({ done: true, value: undefined }),
                releaseLock: vi.fn()
              })
            }
          };
        }
        return {
          stdout: {
            getReader: () => ({
              read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
              releaseLock: vi.fn()
            })
          }
        };
      });

      device.adb.subprocess.shellProtocol.spawn = mockShellSpawn;

      acquirer = new TmpAcquirer(device);

      const progressMock = createMockProgressCallback();
      const result = await acquirer.acquire(progressMock.callback);

      expect(result.success).toBe(true);
      expect(result.type).toBe('tmp');
      expect(progressMock.callback).toHaveBeenCalled();
    });

    it('should use default tmp directory when TMPDIR not found in environment', async () => {
      const envOutputWithoutTmpdir = 'PATH=/system/bin\nHOME=/data'; // No TMPDIR
      const lsOutput = '-rw-r--r-- 1 root root 1024 2024-01-01 12:00 defaultfile.txt';

      device = createMockADBDeviceWithCommands({
        shellOutput: envOutputWithoutTmpdir,
        readFile: new Uint8Array([0x74, 0x65, 0x73, 0x74]) // "test"
      }) as unknown as ADBDevice;

      const mockShellSpawn = vi.fn().mockImplementation((command: string) => {
        if (command === 'env') {
          return {
            stdout: {
              getReader: () => ({
                read: vi.fn()
                  .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(envOutputWithoutTmpdir) })
                  .mockResolvedValueOnce({ done: true, value: undefined }),
                releaseLock: vi.fn()
              })
            }
          };
        } else if (command.includes('ls -R /data/local/tmp')) {
          return {
            stdout: {
              getReader: () => ({
                read: vi.fn()
                  .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(lsOutput) })
                  .mockResolvedValueOnce({ done: true, value: undefined }),
                releaseLock: vi.fn()
              })
            }
          };
        }
        return {
          stdout: {
            getReader: () => ({
              read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
              releaseLock: vi.fn()
            })
          }
        };
      });

      device.adb.subprocess.shellProtocol.spawn = mockShellSpawn;

      const mockSync = {
        read: vi.fn().mockReturnValue({
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: new Uint8Array([0x74, 0x65, 0x73, 0x74]) })
              .mockResolvedValueOnce({ done: true, value: undefined }),
            releaseLock: vi.fn()
          })
        }),
        dispose: vi.fn()
      };
      device.adb.sync = vi.fn().mockResolvedValue(mockSync);

      acquirer = new TmpAcquirer(device);

      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
    });

    it('should handle errors during acquisition', async () => {
      device = createMockADBDeviceWithCommands() as unknown as ADBDevice;

      // Mock device.getProperties to throw an error
      device.getProperties = vi.fn().mockRejectedValue(new Error('Device connection failed'));

      acquirer = new TmpAcquirer(device);

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.type).toBe('tmp');
      expect(result.error).toBe('Device connection failed');
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
    });

    it('should handle errors when getting environment variables', async () => {
      device = createMockADBDeviceWithCommands() as unknown as ADBDevice;

      // Mock successful device properties
      device.getProperties = vi.fn().mockResolvedValue(createMockDeviceProperties());

      // Mock env command to fail
      const mockShellSpawn = vi.fn().mockImplementation((command: string) => {
        if (command === 'env') {
          throw new Error('Environment command failed');
        }
        return {
          stdout: {
            getReader: () => ({
              read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
              releaseLock: vi.fn()
            })
          }
        };
      });

      device.adb.subprocess.shellProtocol.spawn = mockShellSpawn;

      acquirer = new TmpAcquirer(device);

      const result = await acquirer.acquire();
      expect(result.success).toBe(true); // Should still succeed using default tmp dir
    });

    it('should call progress callback with correct parameters', async () => {
      const envOutput = 'TMPDIR=/data/local/tmp';
      const lsOutput = '-rw-r--r-- 1 root root 1024 2024-01-01 12:00 testfile.txt';
      const fileContent = new Uint8Array([0x41, 0x42, 0x43]); // "ABC"

      device = createMockADBDeviceWithCommands({
        shellOutput: envOutput,
        readFile: fileContent
      }) as unknown as ADBDevice;

      const mockShellSpawn = vi.fn().mockImplementation((command: string) => {
        if (command === 'env') {
          return {
            stdout: {
              getReader: () => ({
                read: vi.fn()
                  .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(envOutput) })
                  .mockResolvedValueOnce({ done: true, value: undefined }),
                releaseLock: vi.fn()
              })
            }
          };
        } else if (command.includes('ls -R /data/local/tmp')) {
          return {
            stdout: {
              getReader: () => ({
                read: vi.fn()
                  .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(lsOutput) })
                  .mockResolvedValueOnce({ done: true, value: undefined }),
                releaseLock: vi.fn()
              })
            }
          };
        }
        return {
          stdout: {
            getReader: () => ({
              read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
              releaseLock: vi.fn()
            })
          }
        };
      });

      device.adb.subprocess.shellProtocol.spawn = mockShellSpawn;

      const mockSync = {
        read: vi.fn().mockReturnValue({
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: fileContent })
              .mockResolvedValueOnce({ done: true, value: undefined }),
            releaseLock: vi.fn()
          })
        }),
        dispose: vi.fn()
      };
      device.adb.sync = vi.fn().mockResolvedValue(mockSync);

      acquirer = new TmpAcquirer(device);

      const progressMock = createMockProgressCallback();
      await acquirer.acquire(progressMock.callback);

      // Verify progress callback was called with expected messages
      expect(progressMock.callback).toHaveBeenCalled();
      const calls = progressMock.callback.mock.calls;
      
      expect(calls[0][0]).toMatchObject({
        progress: 0,
        message: 'Starting tmp acquisition...',
        status: 'running'
      });

      expect(calls[calls.length - 1][0]).toMatchObject({
        progress: 100,
        message: 'Tmp acquisition completed.',
        status: 'completed'
      });
    });

    it('should properly parse files from ls output', async () => {
      const envOutput = 'TMPDIR=/data/local/tmp';
      const complexLsOutput = `-rw-r--r-- 1 root root 1024 Jan  1 12:00 file1.txt
drwxr-xr-x 2 root root 4096 Jan  1 12:01 subdir
-rw-r--r-- 1 root root 2048 Jan  1 12:02 file2.log
-rwxr-xr-x 1 root root  512 Jan  1 12:03 executable
lrwxrwxrwx 1 root root   10 Jan  1 12:04 symlink -> target`;

      device = createMockADBDeviceWithCommands({
        shellOutput: envOutput,
        readFile: new Uint8Array([0x44, 0x61, 0x74, 0x61]) // "Data"
      }) as unknown as ADBDevice;

      const mockShellSpawn = vi.fn().mockImplementation((command: string) => {
        if (command === 'env') {
          return {
            stdout: {
              getReader: () => ({
                read: vi.fn()
                  .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(envOutput) })
                  .mockResolvedValueOnce({ done: true, value: undefined }),
                releaseLock: vi.fn()
              })
            }
          };
        } else if (command.includes('ls -R /data/local/tmp')) {
          return {
            stdout: {
              getReader: () => ({
                read: vi.fn()
                  .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(complexLsOutput) })
                  .mockResolvedValueOnce({ done: true, value: undefined }),
                releaseLock: vi.fn()
              })
            }
          };
        }
        return {
          stdout: {
            getReader: () => ({
              read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
              releaseLock: vi.fn()
            })
          }
        };
      });

      device.adb.subprocess.shellProtocol.spawn = mockShellSpawn;

      const mockSync = {
        read: vi.fn().mockReturnValue({
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: new Uint8Array([0x44, 0x61, 0x74, 0x61]) })
              .mockResolvedValueOnce({ done: true, value: undefined }),
            releaseLock: vi.fn()
          })
        }),
        dispose: vi.fn()
      };
      device.adb.sync = vi.fn().mockResolvedValue(mockSync);

      acquirer = new TmpAcquirer(device);

      const result = await acquirer.acquire();
      expect(result.success).toBe(true);

      // Verify that only regular files (not directories or symlinks) are processed
      expect(mockSync.read).toHaveBeenCalledTimes(3); // file1.txt, file2.log, executable
    });
  });
});