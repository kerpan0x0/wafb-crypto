import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ShellCommand } from '../../../../src/adb/commands/shellCommand';
import { ADBCommandError } from '../../../../src/utils/errors';
import type { Adb } from '@yume-chan/adb';
import { createMockAdb, createMockShellSocket, createHangingShellSocket } from './test-helpers';

describe('ShellCommand', () => {
  let mockAdb: Adb;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('exec', () => {
    it('should execute shell command and return output', async () => {
      const mockOutput = 'test output from command';
      mockAdb = createMockAdb(createMockShellSocket(mockOutput));
      const command = new ShellCommand(mockAdb, 'echo test');

      const result = await command.exec();

      expect(result).toBe(mockOutput);
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('echo test');
    });

    it('should execute complex command with arguments', async () => {
      const mockOutput = 'file1.txt\nfile2.txt\nfile3.txt';
      mockAdb = createMockAdb(createMockShellSocket(mockOutput));
      const command = new ShellCommand(mockAdb, 'ls -la /sdcard/');

      const result = await command.exec();

      expect(result).toBe(mockOutput);
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('ls -la /sdcard/');
    });

    it('should handle empty output', async () => {
      mockAdb = createMockAdb(createMockShellSocket(''));
      const command = new ShellCommand(mockAdb, 'echo');

      const result = await command.exec();

      expect(result).toBe('');
    });

    it('should throw ADBCommandError when shell protocol is not available', async () => {
      mockAdb = {
        subprocess: {
          shellProtocol: null,
          spawn: vi.fn()
        }
      } as unknown as Adb;

      const command = new ShellCommand(mockAdb, 'echo test');

      await expect(command.exec()).rejects.toThrow(ADBCommandError);
      await expect(command.exec()).rejects.toThrow(/Shell protocol not available/);
    });

    it('should throw ADBCommandError on command execution failure', async () => {
      mockAdb = createMockAdb();
      (mockAdb.subprocess.shellProtocol.spawn as any).mockRejectedValue(
        new Error('Connection lost')
      );

      const command = new ShellCommand(mockAdb, 'invalid command');

      await expect(command.exec()).rejects.toThrow(ADBCommandError);
      await expect(command.exec()).rejects.toThrow(/Failed to execute command "invalid command"/);
      await expect(command.exec()).rejects.toThrow(/Connection lost/);
    });

    it('should handle multiline output', async () => {
      const mockOutput = 'line1\nline2\nline3\nline4';
      mockAdb = createMockAdb(createMockShellSocket(mockOutput));
      const command = new ShellCommand(mockAdb, 'cat file.txt');

      const result = await command.exec();

      expect(result).toBe(mockOutput);
      expect(result.split('\n')).toHaveLength(4);
    });
  });

  describe('timeout handling', () => {
    it('should complete successfully before timeout', async () => {
      vi.useFakeTimers();
      const mockOutput = 'quick response';
      mockAdb = createMockAdb(createMockShellSocket(mockOutput));
      const command = new ShellCommand(mockAdb, 'echo quick');

      const resultPromise = command.exec({ timeout: 5000 });
      await vi.advanceTimersByTimeAsync(100);
      const result = await resultPromise;

      expect(result).toBe(mockOutput);
      vi.useRealTimers();
    });

    it('should timeout when command takes too long', async () => {
      vi.useFakeTimers();
      mockAdb = createMockAdb(createHangingShellSocket());
      const command = new ShellCommand(mockAdb, 'sleep 1000');

      const execPromise = command.exec({ timeout: 1000 });
      
      const expectation = expect(execPromise).rejects.toThrow(ADBCommandError);
      await vi.advanceTimersByTimeAsync(1500);
      await expectation;
      
      vi.useRealTimers();
    });

    it('should use custom timeout value', async () => {
      vi.useFakeTimers();
      mockAdb = createMockAdb(createHangingShellSocket());
      const command = new ShellCommand(mockAdb, 'long command');

      const execPromise = command.exec({ timeout: 3000 });
      
      const expectation = expect(execPromise).rejects.toThrow(/timed out after 3000ms/);
      await vi.advanceTimersByTimeAsync(3500);
      await expectation;
      
      vi.useRealTimers();
    });

    it('should execute without timeout when timeout is 0', async () => {
      const mockOutput = 'no timeout output';
      mockAdb = createMockAdb(createMockShellSocket(mockOutput));
      const command = new ShellCommand(mockAdb, 'echo test');

      const result = await command.exec({ timeout: 0 });

      expect(result).toBe(mockOutput);
    });

    it('should use default timeout of 5000ms when not specified', async () => {
      vi.useFakeTimers();
      mockAdb = createMockAdb(createHangingShellSocket());
      const command = new ShellCommand(mockAdb, 'hanging command');

      const execPromise = command.exec();
      
      const expectation = expect(execPromise).rejects.toThrow(/timed out after 5000ms/);
      await vi.advanceTimersByTimeAsync(5500);
      await expectation;
      
      vi.useRealTimers();
    });
  });
});
