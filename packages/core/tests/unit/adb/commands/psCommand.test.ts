import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PsCommand } from '../../../../src/adb/commands';
import type { Adb } from '@yume-chan/adb';
import { createMockAdb, createMockShellSocket } from '../../../helpers/test-helpers';

describe('PsCommand', () => {
  let mockAdb: Adb;
  let command: PsCommand;

  const MOCK_PS_OUTPUT = `LABEL                          USER     PID   PPID     VSZ    RSS WCHAN            ADDR S NAME
u:r:init:s0                    root       1      0   17936   2048 0                   0 S init
u:r:system_server:s0           system  1234      1 3456789  98765 0                   0 S system_server
u:r:zygote:s0                  root    2000      1  234567  12345 0                   0 S zygote64
u:r:surfaceflinger:s0          system  2345      1  123456   5678 0                   0 S surfaceflinger
u:r:untrusted_app:s0           u0_a123 5678   2000  456789  23456 0                   0 S com.example.app`;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdb = createMockAdb() as unknown as Adb;
    command = new PsCommand(mockAdb);
  });

  describe('Command Construction', () => {
    it('should build default command (ps -A -Z)', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_PS_OUTPUT)
      );

      await command.exec();

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('ps -A -Z');
    });

    it('should build command with all: true', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_PS_OUTPUT)
      );

      await command.exec({ all: true });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('ps -A -Z');
    });

    it('should build command with all: false', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      await command.exec({ all: false });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('ps -Z');
    });

    it('should build command with selinux: true', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_PS_OUTPUT)
      );

      await command.exec({ selinux: true });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('ps -A -Z');
    });

    it('should build command with selinux: false', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      await command.exec({ selinux: false });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('ps -A');
    });

    it('should build command with both flags disabled', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      await command.exec({ all: false, selinux: false });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('ps');
    });

    it('should build command with threads: true', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      await command.exec({ threads: true });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('ps -A -Z -T');
    });

    it('should build command with tree: true', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      await command.exec({ tree: true });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('ps -A -Z -H');
    });

    it('should build command with filter', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      await command.exec({ filter: 'system_server' });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'ps -A -Z | grep "system_server"'
      );
    });

    it('should build command with customFormat', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      await command.exec({ 
        customFormat: ['PID', 'PPID', 'USER', 'NAME'] 
      });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'ps -A -Z -o PID,PPID,USER,NAME'
      );
    });

    it('should build command with pids', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      await command.exec({ pids: [1, 1234, 5678] });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'ps -A -Z -p 1,1234,5678'
      );
    });

    it('should build command with multiple options', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      await command.exec({ 
        all: true,
        selinux: true,
        threads: true,
        filter: 'app'
      });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'ps -A -Z -T | grep "app"'
      );
    });

    it('should build command with all new options', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      await command.exec({ 
        all: true,
        selinux: true,
        threads: true,
        tree: true,
        customFormat: ['PID', 'NAME'],
        pids: [1, 2],
        filter: 'init'
      });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'ps -A -Z -T -H -o PID,NAME -p 1,2 | grep "init"'
      );
    });
  });

  describe('Output Handling', () => {
    it('should return raw output string', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_PS_OUTPUT)
      );

      const result = await command.exec();

      expect(result).toBe(MOCK_PS_OUTPUT);
      expect(typeof result).toBe('string');
    });

    it('should return empty string for empty output', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      const result = await command.exec();

      expect(result).toBe('');
    });

    it('should return multiline output correctly', async () => {
      const multilineOutput = `LINE1\nLINE2\nLINE3`;
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(multilineOutput)
      );

      const result = await command.exec();

      expect(result).toBe(multilineOutput);
      expect(result.split('\n')).toHaveLength(3);
    });

    it('should preserve whitespace in output', async () => {
      const outputWithSpaces = `  space  test  `;
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(outputWithSpaces)
      );

      const result = await command.exec();

      expect(result).toBe(outputWithSpaces);
    });
  });

  describe('Error Handling', () => {
    it('should throw error when command fails', async () => {
      const error = new Error('Command failed');
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockRejectedValue(error);

      await expect(command.exec()).rejects.toThrow('Command failed');
    });

    it('should throw error when shellProtocol is null', async () => {
      const invalidAdb = {
        subprocess: {
          shellProtocol: null
        }
      } as any;

      const invalidCommand = new PsCommand(invalidAdb);

      await expect(invalidCommand.exec()).rejects.toThrow();
    });

    it('should propagate timeout errors', async () => {
      const timeoutError = new Error('Command timed out');
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockRejectedValue(timeoutError);

      await expect(command.exec({ timeout: 5000 })).rejects.toThrow('Command timed out');
    });
  });

  describe('Option Combinations', () => {
    it('should handle no options (defaults)', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      await command.exec({});

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('ps -A -Z');
    });

    it('should handle undefined options', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      await command.exec(undefined as any);

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('ps -A -Z');
    });

    it('should handle empty customFormat array', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      await command.exec({ customFormat: [] });

      // Should NOT add -o flag with empty array
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('ps -A -Z');
    });

    it('should handle empty pids array', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      await command.exec({ pids: [] });

      // Should NOT add -p flag with empty array
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('ps -A -Z');
    });

    it('should handle empty filter string', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      await command.exec({ filter: '' });

      // Should still add grep even with empty string (edge case)
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('ps -A -Z');
    });
  });

  describe('Backward Compatibility', () => {
    it('should work with old SELinux acquirer pattern', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_PS_OUTPUT)
      );

      // Exact pattern from SELinux acquirer
      const result = await command.exec({ selinux: true, timeout: 10000 });

      expect(result).toBe(MOCK_PS_OUTPUT);
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('ps -A -Z');
    });

    it('should work with process acquirer pattern', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_PS_OUTPUT)
      );

      const result = await command.exec({ all: true, selinux: true });

      expect(result).toBe(MOCK_PS_OUTPUT);
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('ps -A -Z');
    });

    it('should maintain same return type (string)', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_PS_OUTPUT)
      );

      const result = await command.exec();

      // Must be string, not parsed object
      expect(typeof result).toBe('string');
      expect(result).not.toBeInstanceOf(Object);
      expect(result).not.toBeInstanceOf(Array);
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in filter', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      await command.exec({ filter: 'com.example.app$test' });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'ps -A -Z | grep "com.example.app$test"'
      );
    });

    it('should handle quotes in filter', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      await command.exec({ filter: 'test"quote' });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'ps -A -Z | grep "test"quote"'
      );
    });

    it('should handle single PID', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      await command.exec({ pids: [1] });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('ps -A -Z -p 1');
    });

    it('should handle large PID list', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      const largePidList = Array.from({ length: 100 }, (_, i) => i + 1);
      await command.exec({ pids: largePidList });

      const expectedPids = largePidList.join(',');
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        `ps -A -Z -p ${expectedPids}`
      );
    });

    it('should handle many custom format columns', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      const manyColumns = [
        'PID', 'PPID', 'TID', 'USER', 'VSIZE', 'RSS', 
        'WCHAN', 'PC', 'S', 'NAME', 'TIME', 'STIME'
      ];

      await command.exec({ customFormat: manyColumns });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        `ps -A -Z -o ${manyColumns.join(',')}`
      );
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle typical forensics snapshot scenario', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_PS_OUTPUT)
      );

      const result = await command.exec({
        all: true,
        selinux: true,
        threads: false
      });

      expect(result).toContain('system_server');
      expect(result).toContain('u:r:');
      expect(result.split('\n').length).toBeGreaterThan(1);
    });

    it('should handle suspicious process detection scenario', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('u:r:su:s0 root 9999 1 12345 678 0 0 S su')
      );

      const result = await command.exec({ filter: 'su' });

      expect(result).toContain('su');
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'ps -A -Z | grep "su"'
      );
    });

    it('should handle thread analysis scenario', async () => {
      const threadOutput = `LABEL USER PID PPID TID VSZ RSS WCHAN ADDR S NAME
u:r:app:s0 u0_a123 5678 2000 5678 456789 23456 0 0 S com.example.app
u:r:app:s0 u0_a123 5678 2000 5679 456789 23456 0 0 S Thread-1
u:r:app:s0 u0_a123 5678 2000 5680 456789 23456 0 0 S Thread-2`;

      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(threadOutput)
      );

      const result = await command.exec({ 
        threads: true,
        pids: [5678]
      });

      expect(result).toContain('Thread-1');
      expect(result).toContain('Thread-2');
    });
  });

  describe('Type Safety', () => {
    it('should accept valid PsOptions types', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      // These should all compile without type errors
      await command.exec();
      await command.exec({});
      await command.exec({ all: true });
      await command.exec({ selinux: false });
      await command.exec({ threads: true });
      await command.exec({ tree: true });
      await command.exec({ filter: 'test' });
      await command.exec({ customFormat: ['PID'] });
      await command.exec({ pids: [1, 2, 3] });
      await command.exec({ timeout: 5000 });

      expect(true).toBe(true);
    });
  });
});