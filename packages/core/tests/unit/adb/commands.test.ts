import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ADBCommands } from '../../../src/adb/commands';
import { ADBCommandError } from '../../../src/utils/errors';
import type { Adb } from '@yume-chan/adb';

const mockAdb = {
  subprocess: {
    spawn: vi.fn()
  },
  sync: vi.fn()
} as unknown as Adb;

describe('ADBCommands', () => {
  let commands: ADBCommands;

  beforeEach(() => {
    vi.clearAllMocks();
    commands = new ADBCommands(mockAdb);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('shell', () => {
    it('should execute shell command and return output', async () => {
      const mockProcess = {
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
        exit: Promise.resolve(0)
      };

      (mockAdb.subprocess as any).spawn.mockResolvedValue(mockProcess);

      const result = await commands.shell('echo test');
      expect(result).toBe('test output');
    });

    it('should throw error on command failure', async () => {
      (mockAdb.subprocess as any).spawn.mockRejectedValue(new Error('Command failed'));
      await expect(commands.shell('invalid command')).rejects.toThrow(ADBCommandError);
    });

    it('should handle timeout', async () => {
      vi.useFakeTimers();
      const mockProcess = {
        stdout: {
          getReader: () => ({
            read: () => new Promise(() => {}), // Never resolves
            releaseLock: vi.fn()
          })
        },
        exit: new Promise(() => {}) 
      };

      (mockAdb.subprocess as any).spawn.mockResolvedValue(mockProcess);

      const shellPromise = commands.shell('long command', { timeout: 1000 });
      
      // Fast forward time
      vi.advanceTimersByTime(1500);

      await expect(shellPromise).rejects.toThrow(/timed out/i);
    });
  });

  describe('getLogcat', () => {
    it('should get logcat output', async () => {
      const mockProcess = {
        stdout: {
          getReader: () => {
            let readCount = 0;
            return {
              read: async () => {
                if (readCount === 0) {
                  readCount++;
                  return { done: false, value: new TextEncoder().encode('log line 1\nlog line 2') };
                }
                return { done: true, value: undefined };
              },
              releaseLock: vi.fn()
            };
          }
        },
        exit: Promise.resolve(0)
      };

      (mockAdb.subprocess as any).spawn.mockResolvedValue(mockProcess);

      const logs = await commands.getLogcat();
      expect(logs).toContain('log line 1');
    });

    it('should apply filters and options', async () => {
      const mockProcess = {
        stdout: {
          getReader: () => ({
            read: async () => ({ done: true, value: undefined }),
            releaseLock: vi.fn()
          })
        },
        exit: Promise.resolve(0)
      };

      (mockAdb.subprocess as any).spawn.mockResolvedValue(mockProcess);

      await commands.getLogcat({
        buffer: 'system',
        filter: 'ActivityManager:I',
        maxLines: 100
      });

      expect((mockAdb.subprocess as any).spawn).toHaveBeenCalledWith(expect.stringContaining('-b system'));
      expect((mockAdb.subprocess as any).spawn).toHaveBeenCalledWith(expect.stringContaining('ActivityManager:I'));
      expect((mockAdb.subprocess as any).spawn).toHaveBeenCalledWith(expect.stringContaining('-t 100'));
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
        close: vi.fn().mockResolvedValue(undefined)
      };

      (mockAdb.sync as any).mockResolvedValue(mockSync);

      const content = await commands.readFile('/sdcard/test.txt');
      expect(new TextDecoder().decode(content)).toBe('file content');
      expect(mockSync.read).toHaveBeenCalledWith('/sdcard/test.txt');
      expect(mockSync.close).toHaveBeenCalled();
    });

    it('should write file content', async () => {
      const mockSync = {
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined)
      };

      (mockAdb.sync as any).mockResolvedValue(mockSync);

      const content = new TextEncoder().encode('test content');
      await commands.writeFile('/sdcard/test.txt', content);

      expect(mockSync.write).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: '/sdcard/test.txt'
        })
      );
      expect(mockSync.close).toHaveBeenCalled();
    });

    it('should throw error on file read failure', async () => {
      const mockSync = {
        read: vi.fn().mockImplementation(() => { throw new Error('File not found'); }),
        close: vi.fn().mockResolvedValue(undefined)
      };

      (mockAdb.sync as any).mockResolvedValue(mockSync);
      await expect(commands.readFile('/invalid/path')).rejects.toThrow(ADBCommandError);
    });
  });
});