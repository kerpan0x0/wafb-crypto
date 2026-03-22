import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ShellCommand } from '../../../../src/commands/shellCommand';
import { ADBCommandError } from '../../../../src/utils/errors';
import type { Adb } from '@yume-chan/adb';
import {
  createMockAdb,
  createMockShellSocket,
  createHangingShellSocket,
} from '../../../helpers/test-helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a mock shell socket that emits stderr output. */
function createMockShellSocketWithStderr(stdout: string, stderr: string, exitCode = 0) {
  const encoder = new TextEncoder();
  let stdoutRead = 0;
  let stderrRead = 0;

  return {
    stdout: {
      getReader: () => ({
        read: async () => {
          if (stdoutRead === 0) { stdoutRead++; return { done: false, value: encoder.encode(stdout) }; }
          return { done: true, value: undefined };
        },
        releaseLock: vi.fn(),
      }),
    },
    stderr: {
      getReader: () => ({
        read: async () => {
          if (stderrRead === 0) { stderrRead++; return { done: false, value: encoder.encode(stderr) }; }
          return { done: true, value: undefined };
        },
        releaseLock: vi.fn(),
      }),
    },
    stdin: new WritableStream(),
    exited: Promise.resolve(exitCode),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ShellCommand', () => {
  let mockAdb: Adb;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── ShellResult shape ────────────────────────────────────────────────────

  describe('ShellResult', () => {
    it('should return a ShellResult with stdout, stderr and exitCode', async () => {
      mockAdb = createMockAdb(createMockShellSocketWithStderr('hello', '', 0));
      const result = await new ShellCommand(mockAdb, 'echo hello').exec();

      expect(result).toMatchObject({ stdout: 'hello', stderr: '', exitCode: 0 });
    });

    it('should capture stdout correctly', async () => {
      const mockOutput = 'test output from command';
      mockAdb = createMockAdb(createMockShellSocket(mockOutput));
      const result = await new ShellCommand(mockAdb, 'echo test').exec();

      expect(result.stdout).toBe(mockOutput);
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('echo test');
    });

    it('should capture stderr separately from stdout', async () => {
      mockAdb = createMockAdb(createMockShellSocketWithStderr('out', 'err msg', 0));
      const result = await new ShellCommand(mockAdb, 'cmd').exec();

      expect(result.stdout).toBe('out');
      expect(result.stderr).toBe('err msg');
    });

    it('should capture the exit code', async () => {
      mockAdb = createMockAdb(createMockShellSocket('', 42));
      const result = await new ShellCommand(mockAdb, 'exit 42').exec();

      expect(result.exitCode).toBe(42);
    });

    it('should report exitCode 0 for successful commands', async () => {
      mockAdb = createMockAdb(createMockShellSocket('ok', 0));
      const result = await new ShellCommand(mockAdb, 'true').exec();

      expect(result.exitCode).toBe(0);
    });

    it('should handle empty stdout', async () => {
      mockAdb = createMockAdb(createMockShellSocket(''));
      const result = await new ShellCommand(mockAdb, 'echo').exec();

      expect(result.stdout).toBe('');
      expect(result.exitCode).toBe(0);
    });

    it('should handle multiline stdout', async () => {
      const mockOutput = 'line1\nline2\nline3\nline4';
      mockAdb = createMockAdb(createMockShellSocket(mockOutput));
      const result = await new ShellCommand(mockAdb, 'cat file.txt').exec();

      expect(result.stdout).toBe(mockOutput);
      expect(result.stdout.split('\n')).toHaveLength(4);
    });

    it('should handle complex commands with arguments', async () => {
      const mockOutput = 'file1.txt\nfile2.txt\nfile3.txt';
      mockAdb = createMockAdb(createMockShellSocket(mockOutput));
      const result = await new ShellCommand(mockAdb, 'ls -la /sdcard/').exec();

      expect(result.stdout).toBe(mockOutput);
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('ls -la /sdcard/');
    });
  });

  // ── throwOnError ─────────────────────────────────────────────────────────

  describe('throwOnError', () => {
    it('should NOT throw by default when exit code is non-zero', async () => {
      mockAdb = createMockAdb(createMockShellSocketWithStderr('', 'permission denied', 1));
      const result = await new ShellCommand(mockAdb, 'rm /root/file').exec();

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('permission denied');
    });

    it('should throw ADBCommandError when throwOnError=true and exit code is non-zero', async () => {
      mockAdb = createMockAdb(createMockShellSocketWithStderr('', 'permission denied', 1));

      await expect(
        new ShellCommand(mockAdb, 'rm /root/file').exec({ throwOnError: true })
      ).rejects.toThrow(ADBCommandError);
    });

    it('should include exitCode on the thrown error', async () => {
      mockAdb = createMockAdb(createMockShellSocket('', 2));

      await expect(
        new ShellCommand(mockAdb, 'cmd').exec({ throwOnError: true })
      ).rejects.toMatchObject({ exitCode: 2 });
    });

    it('should include stderr on the thrown error', async () => {
      mockAdb = createMockAdb(createMockShellSocketWithStderr('', 'no such file', 1));

      await expect(
        new ShellCommand(mockAdb, 'cat /missing').exec({ throwOnError: true })
      ).rejects.toMatchObject({ stderr: 'no such file' });
    });

    it('should NOT throw when throwOnError=true but exit code is 0', async () => {
      mockAdb = createMockAdb(createMockShellSocket('success', 0));
      const result = await new ShellCommand(mockAdb, 'echo').exec({ throwOnError: true });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('success');
    });

    it('should include the command name and exit code in the error message', async () => {
      mockAdb = createMockAdb(createMockShellSocket('', 127));

      await expect(
        new ShellCommand(mockAdb, 'unknown-cmd').exec({ throwOnError: true })
      ).rejects.toThrow(/unknown-cmd.*127/);
    });
  });

  // ── error handling ────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('should throw ADBCommandError when shell protocol is not available', async () => {
      mockAdb = {
        subprocess: { shellProtocol: null, spawn: vi.fn() },
      } as unknown as Adb;

      await expect(new ShellCommand(mockAdb, 'echo test').exec()).rejects.toThrow(ADBCommandError);
      await expect(new ShellCommand(mockAdb, 'echo test').exec()).rejects.toThrow(
        /Shell protocol not available/
      );
    });

    it('should throw ADBCommandError on command execution failure', async () => {
      mockAdb = createMockAdb();
      (mockAdb.subprocess.shellProtocol.spawn as any).mockRejectedValue(
        new Error('Connection lost')
      );

      await expect(new ShellCommand(mockAdb, 'invalid command').exec()).rejects.toThrow(
        ADBCommandError
      );
      await expect(new ShellCommand(mockAdb, 'invalid command').exec()).rejects.toThrow(
        /Failed to execute command "invalid command"/
      );
      await expect(new ShellCommand(mockAdb, 'invalid command').exec()).rejects.toThrow(
        /Connection lost/
      );
    });
  });

  // ── timeout handling ──────────────────────────────────────────────────────

  describe('timeout handling', () => {
    it('should complete successfully before timeout', async () => {
      vi.useFakeTimers();
      mockAdb = createMockAdb(createMockShellSocket('quick response'));
      const resultPromise = new ShellCommand(mockAdb, 'echo quick').exec({ timeout: 5000 });

      await vi.advanceTimersByTimeAsync(100);
      const result = await resultPromise;

      expect(result.stdout).toBe('quick response');
      vi.useRealTimers();
    });

    it('should timeout when command takes too long', async () => {
      vi.useFakeTimers();
      mockAdb = createMockAdb(createHangingShellSocket());
      const execPromise = new ShellCommand(mockAdb, 'sleep 1000').exec({ timeout: 1000 });

      const expectation = expect(execPromise).rejects.toThrow(ADBCommandError);
      await vi.advanceTimersByTimeAsync(1500);
      await expectation;

      vi.useRealTimers();
    });

    it('should use custom timeout value', async () => {
      vi.useFakeTimers();
      mockAdb = createMockAdb(createHangingShellSocket());
      const execPromise = new ShellCommand(mockAdb, 'long command').exec({ timeout: 3000 });

      const expectation = expect(execPromise).rejects.toThrow(/timed out after 3000ms/);
      await vi.advanceTimersByTimeAsync(3500);
      await expectation;

      vi.useRealTimers();
    });

    it('should execute without timeout when timeout is 0', async () => {
      mockAdb = createMockAdb(createMockShellSocket('no timeout output'));
      const result = await new ShellCommand(mockAdb, 'echo test').exec({ timeout: 0 });

      expect(result.stdout).toBe('no timeout output');
    });

    it('should use default timeout of 5000ms when not specified', async () => {
      vi.useFakeTimers();
      mockAdb = createMockAdb(createHangingShellSocket());
      const execPromise = new ShellCommand(mockAdb, 'hanging command').exec();

      const expectation = expect(execPromise).rejects.toThrow(/timed out after 5000ms/);
      await vi.advanceTimersByTimeAsync(5500);
      await expectation;

      vi.useRealTimers();
    });
  });
});
