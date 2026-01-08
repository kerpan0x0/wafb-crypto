import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ADBCommands } from '../../../src/adb/commands';
import { ADBCommandError } from '../../../src/utils/errors';
import type { Adb } from '@yume-chan/adb';

// Crea un mock completo per l'oggetto Adb con shellProtocol
const createMockAdb = () => {
  const mockShellSocket = {
    stdout: {
      getReader: () => {
        let readCount = 0;
        return {
          read: async () => {
            if (readCount === 0) {
              readCount++;
              return { done: false, value: new TextEncoder().encode('test output') };
            }
            return { done: true, value: undefined };
          },
          releaseLock: vi.fn()
        };
      }
    },
    stderr: new ReadableStream(),
    stdin: new WritableStream(),
    exit: Promise.resolve({ code: 0 })
  };

  return {
    subprocess: {
      shellProtocol: {
        spawn: vi.fn().mockResolvedValue(mockShellSocket)
      },
      spawn: vi.fn()
    },
    sync: vi.fn()
  } as unknown as Adb;
};

describe('ADBCommands', () => {
  let commands: ADBCommands;
  let mockAdb: Adb;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdb = createMockAdb();
    commands = new ADBCommands(mockAdb);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('shell', () => {
    it('should execute shell command and return output', async () => {
      const mockShellSocket = {
        stdout: {
          getReader: () => {
            let readCount = 0;
            return {
              read: async () => {
                if (readCount === 0) {
                  readCount++;
                  return { done: false, value: new TextEncoder().encode('test output') };
                }
                return { done: true, value: undefined };
              },
              releaseLock: vi.fn()
            };
          }
        },
        stderr: new ReadableStream(),
        stdin: new WritableStream(),
        exit: Promise.resolve({ code: 0 })
      };

      (mockAdb.subprocess.shellProtocol as any).spawn.mockResolvedValue(mockShellSocket);

      const result = await commands.shell('echo test');
      expect(result).toBe('test output');
      expect((mockAdb.subprocess.shellProtocol as any).spawn).toHaveBeenCalledWith('echo test');
    });

    it('should throw error on command failure', async () => {
      (mockAdb.subprocess.shellProtocol as any).spawn.mockRejectedValue(
        new Error('Command failed')
      );

      await expect(commands.shell('invalid command')).rejects.toThrow(ADBCommandError);
      await expect(commands.shell('invalid command')).rejects.toThrow(
        /Failed to execute command "invalid command"/
      );
    });

    it('should handle timeout', async () => {
      vi.useFakeTimers();

      const neverResolvingSocket = {
        stdout: {
          getReader: () => ({
            read: () => new Promise(() => { }),
            releaseLock: vi.fn()
          })
        },
        stderr: new ReadableStream(),
        stdin: new WritableStream(),
        exit: new Promise(() => { })
      };

      (mockAdb.subprocess.shellProtocol as any).spawn.mockResolvedValue(neverResolvingSocket);

      const shellPromise = commands.shell('long command', { timeout: 1000 });

      const rejectionExpectation = expect(shellPromise).rejects.toThrow(/timed out/);

      // Questo triggera il reject() all'interno di shell()
      await vi.advanceTimersByTimeAsync(1500);

      await rejectionExpectation;

      vi.useRealTimers();
    });
  });

  describe('getLogcat', () => {
    it('should get logcat output', async () => {
      const mockShellSocket = {
        stdout: {
          getReader: () => {
            let readCount = 0;
            return {
              read: async () => {
                if (readCount === 0) {
                  readCount++;
                  return {
                    done: false,
                    value: new TextEncoder().encode('log line 1\nlog line 2')
                  };
                }
                return { done: true, value: undefined };
              },
              releaseLock: vi.fn()
            };
          }
        },
        stderr: new ReadableStream(),
        stdin: new WritableStream(),
        exit: Promise.resolve({ code: 0 })
      };

      (mockAdb.subprocess.shellProtocol as any).spawn.mockResolvedValue(mockShellSocket);

      const logs = await commands.getLogcat();
      expect(logs).toContain('log line 1');
      expect((mockAdb.subprocess.shellProtocol as any).spawn).toHaveBeenCalledWith('logcat -d');
    });

    it('should apply filters and options', async () => {
      const mockShellSocket = {
        stdout: {
          getReader: () => ({
            read: async () => ({ done: true, value: undefined }),
            releaseLock: vi.fn()
          })
        },
        stderr: new ReadableStream(),
        stdin: new WritableStream(),
        exit: Promise.resolve({ code: 0 })
      };

      (mockAdb.subprocess.shellProtocol as any).spawn.mockResolvedValue(mockShellSocket);

      await commands.getLogcat({
        buffer: 'system',
        filter: 'ActivityManager:I',
        maxLines: 100
      });

      expect((mockAdb.subprocess.shellProtocol as any).spawn).toHaveBeenCalledWith(
        'logcat -d -b system -t 100 ActivityManager:I'
      );
    });
  });

  describe('readFile and writeFile', () => {
    it('should read file content', async () => {
      const mockContent = new TextEncoder().encode('file content');
      const mockSync = {
        read: vi.fn().mockReturnValue({
          getReader: () => {
            let readCount = 0;
            return {
              read: async () => {
                if (readCount === 0) {
                  readCount++;
                  return { done: false, value: mockContent };
                }
                return { done: true, value: undefined };
              },
              releaseLock: vi.fn()
            };
          }
        }),
        dispose: vi.fn().mockResolvedValue(undefined)
      };

      (mockAdb.sync as any).mockResolvedValue(mockSync);

      const content = await commands.readFile('/sdcard/test.txt');
      expect(new TextDecoder().decode(content)).toBe('file content');
      expect(mockSync.read).toHaveBeenCalledWith('/sdcard/test.txt');
      expect(mockSync.dispose).toHaveBeenCalled();
    });

    it('should write file content', async () => {
      const mockSync = {
        write: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn().mockResolvedValue(undefined)
      };

      (mockAdb.sync as any).mockResolvedValue(mockSync);

      const content = new TextEncoder().encode('test content');
      await commands.writeFile('/sdcard/test.txt', content);

      expect(mockSync.write).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: '/sdcard/test.txt'
        })
      );
      expect(mockSync.dispose).toHaveBeenCalled();
    });

    it('should throw error on file read failure', async () => {
      const mockSync = {
        read: vi.fn().mockImplementation(() => {
          throw new Error('File not found');
        }),
        dispose: vi.fn().mockResolvedValue(undefined)
      };

      (mockAdb.sync as any).mockResolvedValue(mockSync);
      await expect(commands.readFile('/invalid/path')).rejects.toThrow(ADBCommandError);
    });
  });
});