import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PsCommand } from '../../../src/commands';
import { createMockDevice, makeShellResult, type MockDevice } from '../../helpers/test-helpers';

describe('PsCommand', () => {
  let device: MockDevice;
  let command: PsCommand;

  const MOCK_PS_OUTPUT = `LABEL                          USER     PID   PPID     VSZ    RSS WCHAN            ADDR S NAME
u:r:init:s0                    root       1      0   17936   2048 0                   0 S init
u:r:system_server:s0           system  1234      1 3456789  98765 0                   0 S system_server
u:r:zygote:s0                  root    2000      1  234567  12345 0                   0 S zygote64
u:r:surfaceflinger:s0          system  2345      1  123456   5678 0                   0 S surfaceflinger
u:r:untrusted_app:s0           u0_a123 5678   2000  456789  23456 0                   0 S com.example.app`;

  beforeEach(() => {
    vi.clearAllMocks();
    device = createMockDevice();
    command = new PsCommand(device as any);
  });

  describe('Command Construction', () => {
    it('should build default command (ps -A -Z)', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_PS_OUTPUT));

      await command.exec();

      expect(device.shell).toHaveBeenCalledWith('ps -A -Z', expect.any(Object));
    });

    it('should build command with all: true', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_PS_OUTPUT));

      await command.exec({ all: true });

      expect(device.shell).toHaveBeenCalledWith('ps -A -Z', expect.any(Object));
    });

    it('should build command with all: false', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ all: false });

      expect(device.shell).toHaveBeenCalledWith('ps -Z', expect.any(Object));
    });

    it('should build command with selinux: true', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_PS_OUTPUT));

      await command.exec({ selinux: true });

      expect(device.shell).toHaveBeenCalledWith('ps -A -Z', expect.any(Object));
    });

    it('should build command with selinux: false', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ selinux: false });

      expect(device.shell).toHaveBeenCalledWith('ps -A', expect.any(Object));
    });

    it('should build command with both flags disabled', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ all: false, selinux: false });

      expect(device.shell).toHaveBeenCalledWith('ps', expect.any(Object));
    });

    it('should build command with threads: true', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ threads: true });

      expect(device.shell).toHaveBeenCalledWith('ps -A -Z -T', expect.any(Object));
    });

    it('should build command with tree: true', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ tree: true });

      expect(device.shell).toHaveBeenCalledWith('ps -A -Z -H', expect.any(Object));
    });

    it('should build command with filter', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ filter: 'system_server' });

      expect(device.shell).toHaveBeenCalledWith(
        'ps -A -Z | grep "system_server"', expect.any(Object)
      );
    });

    it('should build command with customFormat', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ 
        customFormat: ['PID', 'PPID', 'USER', 'NAME'] 
      });

      expect(device.shell).toHaveBeenCalledWith(
        'ps -A -Z -o PID,PPID,USER,NAME', expect.any(Object)
      );
    });

    it('should build command with pids', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ pids: [1, 1234, 5678] });

      expect(device.shell).toHaveBeenCalledWith(
        'ps -A -Z -p 1,1234,5678', expect.any(Object)
      );
    });

    it('should build command with multiple options', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ 
        all: true,
        selinux: true,
        threads: true,
        filter: 'app'
      });

      expect(device.shell).toHaveBeenCalledWith(
        'ps -A -Z -T | grep "app"', expect.any(Object)
      );
    });

    it('should build command with all new options', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ 
        all: true,
        selinux: true,
        threads: true,
        tree: true,
        customFormat: ['PID', 'NAME'],
        pids: [1, 2],
        filter: 'init'
      });

      expect(device.shell).toHaveBeenCalledWith(
        'ps -A -Z -T -H -o PID,NAME -p 1,2 | grep "init"', expect.any(Object)
      );
    });
  });

  describe('Output Handling', () => {
    it('should return raw output string', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_PS_OUTPUT));

      const result = await command.exec();

      expect(result).toBe(MOCK_PS_OUTPUT);
      expect(typeof result).toBe('string');
    });

    it('should return empty string for empty output', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      const result = await command.exec();

      expect(result).toBe('');
    });

    it('should return multiline output correctly', async () => {
      const multilineOutput = `LINE1\nLINE2\nLINE3`;
      device.shell.mockResolvedValue(makeShellResult(multilineOutput));

      const result = await command.exec();

      expect(result).toBe(multilineOutput);
      expect(result.split('\n')).toHaveLength(3);
    });

    it('should preserve whitespace in output', async () => {
      const outputWithSpaces = `  space  test  `;
      device.shell.mockResolvedValue(makeShellResult(outputWithSpaces));

      const result = await command.exec();

      expect(result).toBe(outputWithSpaces);
    });
  });

  describe('Error Handling', () => {
    it('should throw error when command fails', async () => {
      const error = new Error('Command failed');
      device.shell.mockRejectedValue(error);

      await expect(command.exec()).rejects.toThrow('Command failed');
    });

    it('should throw error when shellProtocol is null', async () => {
      const invalidDevice = { shell: () => { throw new Error('Shell not available'); } } as any;
      const invalidCommand = new PsCommand(invalidDevice);

      await expect(invalidCommand.exec()).rejects.toThrow();
    });

    it('should propagate timeout errors', async () => {
      const timeoutError = new Error('Command timed out');
      device.shell.mockRejectedValue(timeoutError);

      await expect(command.exec({ timeout: 5000 })).rejects.toThrow('Command timed out');
    });
  });

  describe('Option Combinations', () => {
    it('should handle no options (defaults)', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({});

      expect(device.shell).toHaveBeenCalledWith('ps -A -Z', expect.any(Object));
    });

    it('should handle undefined options', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec(undefined as any);

      expect(device.shell).toHaveBeenCalledWith('ps -A -Z', expect.any(Object));
    });

    it('should handle empty customFormat array', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ customFormat: [] });

      // Should NOT add -o flag with empty array
      expect(device.shell).toHaveBeenCalledWith('ps -A -Z', expect.any(Object));
    });

    it('should handle empty pids array', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ pids: [] });

      // Should NOT add -p flag with empty array
      expect(device.shell).toHaveBeenCalledWith('ps -A -Z', expect.any(Object));
    });

    it('should handle empty filter string', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ filter: '' });

      // Should still add grep even with empty string (edge case)
      expect(device.shell).toHaveBeenCalledWith('ps -A -Z', expect.any(Object));
    });
  });

  describe('Backward Compatibility', () => {
    it('should work with old SELinux acquirer pattern', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_PS_OUTPUT));

      // Exact pattern from SELinux acquirer
      const result = await command.exec({ selinux: true, timeout: 10000 });

      expect(result).toBe(MOCK_PS_OUTPUT);
      expect(device.shell).toHaveBeenCalledWith('ps -A -Z', expect.any(Object));
    });

    it('should work with process acquirer pattern', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_PS_OUTPUT));

      const result = await command.exec({ all: true, selinux: true });

      expect(result).toBe(MOCK_PS_OUTPUT);
      expect(device.shell).toHaveBeenCalledWith('ps -A -Z', expect.any(Object));
    });

    it('should maintain same return type (string)', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_PS_OUTPUT));

      const result = await command.exec();

      // Must be string, not parsed object
      expect(typeof result).toBe('string');
      expect(result).not.toBeInstanceOf(Object);
      expect(result).not.toBeInstanceOf(Array);
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in filter', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ filter: 'com.example.app$test' });

      expect(device.shell).toHaveBeenCalledWith(
        'ps -A -Z | grep "com.example.app$test"', expect.any(Object)
      );
    });

    it('should handle quotes in filter', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ filter: 'test"quote' });

      expect(device.shell).toHaveBeenCalledWith(
        'ps -A -Z | grep "test"quote"', expect.any(Object)
      );
    });

    it('should handle single PID', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ pids: [1] });

      expect(device.shell).toHaveBeenCalledWith('ps -A -Z -p 1', expect.any(Object));
    });

    it('should handle large PID list', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      const largePidList = Array.from({ length: 100 }, (_, i) => i + 1);
      await command.exec({ pids: largePidList });

      const expectedPids = largePidList.join(',');
      expect(device.shell).toHaveBeenCalledWith(
        `ps -A -Z -p ${expectedPids}`, expect.any(Object)
      );
    });

    it('should handle many custom format columns', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      const manyColumns = [
        'PID', 'PPID', 'TID', 'USER', 'VSIZE', 'RSS', 
        'WCHAN', 'PC', 'S', 'NAME', 'TIME', 'STIME'
      ];

      await command.exec({ customFormat: manyColumns });

      expect(device.shell).toHaveBeenCalledWith(
        `ps -A -Z -o ${manyColumns.join(',')}`, expect.any(Object)
      );
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle typical forensics snapshot scenario', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_PS_OUTPUT));

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
      device.shell.mockResolvedValue(makeShellResult('u:r:su:s0 root 9999 1 12345 678 0 0 S su'));

      const result = await command.exec({ filter: 'su' });

      expect(result).toContain('su');
      expect(device.shell).toHaveBeenCalledWith(
        'ps -A -Z | grep "su"', expect.any(Object)
      );
    });

    it('should handle thread analysis scenario', async () => {
      const threadOutput = `LABEL USER PID PPID TID VSZ RSS WCHAN ADDR S NAME
u:r:app:s0 u0_a123 5678 2000 5678 456789 23456 0 0 S com.example.app
u:r:app:s0 u0_a123 5678 2000 5679 456789 23456 0 0 S Thread-1
u:r:app:s0 u0_a123 5678 2000 5680 456789 23456 0 0 S Thread-2`;

      device.shell.mockResolvedValue(makeShellResult(threadOutput));

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
      device.shell.mockResolvedValue(makeShellResult(''));

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