import { describe, it, expect, beforeEach } from 'vitest';
import { WhichCommand } from '../../../src/commands';
import { createMockDevice, makeShellResult } from '../../helpers/test-helpers';
import type { MockDevice } from '../../helpers/test-helpers';

describe('WhichCommand', () => {
  let device: MockDevice;
  let command: WhichCommand;

  beforeEach(() => {
    device = createMockDevice();
    device.shell.mockResolvedValue(makeShellResult('/system/bin/bugreport'));
    command = new WhichCommand(device as any);
  });

  describe('Successful Execution', () => {
    it('should find binary and return path', async () => {
      const result = await command.exec({ binary: 'bugreport' });

      expect(result).toEqual('/system/bin/bugreport');
      expect(device.shell).toHaveBeenCalledWith('which bugreport', expect.anything());
    });

    it('should handle binary in different locations', async () => {
      device.shell.mockResolvedValue(makeShellResult('/system/xbin/busybox'));
      const result = await command.exec({ binary: 'busybox' });
      expect(result).toEqual('/system/xbin/busybox');
    });

    it('should handle binary in vendor partition', async () => {
      device.shell.mockResolvedValue(makeShellResult('/vendor/bin/hw/android.hardware.health@2.0-service'));
      const result = await command.exec({ binary: 'android.hardware.health@2.0-service' });
      expect(result).toEqual('/vendor/bin/hw/android.hardware.health@2.0-service');
    });

    it('should handle binary in /data partition (custom binaries)', async () => {
      device.shell.mockResolvedValue(makeShellResult('/data/local/tmp/custom_tool'));
      const result = await command.exec({ binary: 'custom_tool' });
      expect(result).toEqual('/data/local/tmp/custom_tool');
    });

    it('should trim whitespace from output', async () => {
      device.shell.mockResolvedValue(makeShellResult('  /system/bin/sh  \n'));
      const result = await command.exec({ binary: 'sh' });
      expect(result).toEqual('/system/bin/sh');
    });

    it('should handle output with CRLF line endings', async () => {
      device.shell.mockResolvedValue(makeShellResult('/system/bin/sh\r\n'));
      const result = await command.exec({ binary: 'sh' });
      expect(result).toEqual('/system/bin/sh');
    });
  });

  describe('Binary Not Found', () => {
    it('should return empty string when binary not found', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));
      const result = await command.exec({ binary: 'nonexistent' });
      expect(result).toBe('');
    });

    it('should return error message when command fails', async () => {
      device.shell.mockResolvedValue(makeShellResult('which: nonexistent: not found'));
      const result = await command.exec({ binary: 'nonexistent' });
      expect(result).toBe('which: nonexistent: not found');
    });

    it('should return empty string when output is whitespace only', async () => {
      device.shell.mockResolvedValue(makeShellResult('   \n  \t  '));
      const result = await command.exec({ binary: 'test' });
      expect(result).toBe('');
    });

    it('should handle null bytes in output', async () => {
      device.shell.mockResolvedValue(makeShellResult('/system/bin/sh\x00'));
      const result = await command.exec({ binary: 'sh' });
      expect(result).toContain('/system/bin/sh');
    });
  });

  describe('Error Handling', () => {
    it('should handle command execution errors gracefully', async () => {
      device.shell.mockRejectedValue(new Error('Connection lost'));
      await expect(command.exec({ binary: 'test' })).rejects.toThrow('Connection lost');
    });

    it('should handle multiple newlines in output', async () => {
      device.shell.mockResolvedValue(makeShellResult('/system/bin/sh\n\n\n'));
      const result = await command.exec({ binary: 'sh' });
      expect(result).toEqual('/system/bin/sh');
    });

    it('should handle output with extra text after path', async () => {
      device.shell.mockResolvedValue(makeShellResult('/system/bin/sh is a shell'));
      const result = await command.exec({ binary: 'sh' });
      expect(result).toContain('/system/bin/sh');
    });

    it('should handle device disconnection during command', async () => {
      device.shell.mockRejectedValue(new Error('Device offline'));
      await expect(command.exec({ binary: 'sh' })).rejects.toThrow('Device offline');
    });

    it('should handle permission denied errors', async () => {
      device.shell.mockRejectedValue(new Error('Permission denied'));
      await expect(command.exec({ binary: 'su' })).rejects.toThrow('Permission denied');
    });

    it('should handle shell timeout errors', async () => {
      device.shell.mockRejectedValue(new Error('Command timeout'));
      await expect(command.exec({ binary: 'test' })).rejects.toThrow('Command timeout');
    });
  });

  describe('Edge Cases', () => {
    it('should handle symbolic link paths', async () => {
      device.shell.mockResolvedValue(makeShellResult('/system/bin/toolbox'));
      const result = await command.exec({ binary: 'ls' });
      expect(result).toEqual('/system/bin/toolbox');
    });

    it('should handle binaries with special characters in name', async () => {
      device.shell.mockResolvedValue(makeShellResult('/system/bin/android.hardware.health@2.0-service'));
      const result = await command.exec({ binary: 'android.hardware.health@2.0-service' });
      expect(result).toEqual('/system/bin/android.hardware.health@2.0-service');
    });

    it('should handle very long paths', async () => {
      const longPath = '/system/bin/very/deep/nested/path/to/some/binary/executable';
      device.shell.mockResolvedValue(makeShellResult(longPath));
      const result = await command.exec({ binary: 'executable' });
      expect(result).toEqual(longPath);
    });

    it('should handle binary names with numbers', async () => {
      device.shell.mockResolvedValue(makeShellResult('/system/bin/toolbox64'));
      const result = await command.exec({ binary: 'toolbox64' });
      expect(result).toEqual('/system/bin/toolbox64');
    });

    it('should handle binary names with underscores', async () => {
      device.shell.mockResolvedValue(makeShellResult('/system/bin/app_process64'));
      const result = await command.exec({ binary: 'app_process64' });
      expect(result).toEqual('/system/bin/app_process64');
    });

    it('should handle binary names with hyphens', async () => {
      device.shell.mockResolvedValue(makeShellResult('/system/bin/run-as'));
      const result = await command.exec({ binary: 'run-as' });
      expect(result).toEqual('/system/bin/run-as');
    });

    it('should handle paths with dots (AOSP binaries)', async () => {
      device.shell.mockResolvedValue(makeShellResult('/system/bin/android.hardware.graphics.allocator@4.0-service'));
      const result = await command.exec({ binary: 'android.hardware.graphics.allocator@4.0-service' });
      expect(result).toEqual('/system/bin/android.hardware.graphics.allocator@4.0-service');
    });
  });

  describe('Common Android Binaries', () => {
    const testCases = [
      { binary: 'sh',           expectedPath: '/system/bin/sh' },
      { binary: 'bugreport',    expectedPath: '/system/bin/bugreport' },
      { binary: 'bugreportz',   expectedPath: '/system/bin/bugreportz' },
      { binary: 'dumpsys',      expectedPath: '/system/bin/dumpsys' },
      { binary: 'getprop',      expectedPath: '/system/bin/getprop' },
      { binary: 'setprop',      expectedPath: '/system/bin/setprop' },
      { binary: 'pm',           expectedPath: '/system/bin/pm' },
      { binary: 'am',           expectedPath: '/system/bin/am' },
      { binary: 'cmd',          expectedPath: '/system/bin/cmd' },
      { binary: 'logcat',       expectedPath: '/system/bin/logcat' },
      { binary: 'su',           expectedPath: '/system/xbin/su' },
      { binary: 'screencap',    expectedPath: '/system/bin/screencap' },
      { binary: 'screenrecord', expectedPath: '/system/bin/screenrecord' },
      { binary: 'input',        expectedPath: '/system/bin/input' },
      { binary: 'settings',     expectedPath: '/system/bin/settings' },
      { binary: 'content',      expectedPath: '/system/bin/content' },
      { binary: 'service',      expectedPath: '/system/bin/service' },
      { binary: 'ps',           expectedPath: '/system/bin/ps' },
      { binary: 'ls',           expectedPath: '/system/bin/ls' },
      { binary: 'cat',          expectedPath: '/system/bin/cat' },
    ];

    testCases.forEach(({ binary, expectedPath }) => {
      it(`should find ${binary} binary`, async () => {
        device.shell.mockResolvedValue(makeShellResult(expectedPath));
        const result = await command.exec({ binary: binary });
        expect(result).toEqual(expectedPath);
      });
    });
  });

  describe('Device Integration', () => {
    it('should call device.shell with correct command', async () => {
      await command.exec({ binary: 'test' });
      expect(device.shell).toHaveBeenCalledTimes(1);
      expect(device.shell).toHaveBeenCalledWith('which test', expect.anything());
    });

    it('should pass through command exactly as provided', async () => {
      await command.exec({ binary: 'android.hardware.health@2.0-service' });
      expect(device.shell).toHaveBeenCalledWith(
        'which android.hardware.health@2.0-service',
        expect.anything()
      );
    });

    it('should handle commands with spaces (edge case)', async () => {
      await command.exec({ binary: 'test command' });
      expect(device.shell).toHaveBeenCalledWith('which test command', expect.anything());
    });
  });

  describe('Android Version Specific Paths', () => {
    it('should handle modern Android paths (/system/bin)', async () => {
      device.shell.mockResolvedValue(makeShellResult('/system/bin/pm'));
      expect(await command.exec({ binary: 'pm' })).toEqual('/system/bin/pm');
    });

    it('should handle legacy Android paths (/system/xbin)', async () => {
      device.shell.mockResolvedValue(makeShellResult('/system/xbin/su'));
      expect(await command.exec({ binary: 'su' })).toEqual('/system/xbin/su');
    });

    it('should handle vendor paths (Treble)', async () => {
      device.shell.mockResolvedValue(makeShellResult('/vendor/bin/hw/android.hardware.health@2.0-service'));
      const result = await command.exec({ binary: 'android.hardware.health@2.0-service' });
      expect(result).toContain('/vendor/bin/hw/');
    });

    it('should handle apex paths (Android 10+)', async () => {
      device.shell.mockResolvedValue(makeShellResult('/apex/com.android.runtime/bin/linker64'));
      const result = await command.exec({ binary: 'linker64' });
      expect(result).toContain('/apex/');
    });
  });

  describe('Timeout and Performance', () => {
    it('should support timeout option', async () => {
      const result = await command.exec({ binary: 'test', timeout: 5000 });
      expect(result).toBeDefined();
    });

    it('should complete quickly for simple which command', async () => {
      const start = Date.now();
      await command.exec({ binary: 'sh' });
      expect(Date.now() - start).toBeLessThan(100);
    });
  });

  describe('Output Format Variations', () => {
    it('should handle output with trailing spaces', async () => {
      device.shell.mockResolvedValue(makeShellResult('/system/bin/sh     '));
      expect(await command.exec({ binary: 'sh' })).toEqual('/system/bin/sh');
    });

    it('should handle output with leading spaces', async () => {
      device.shell.mockResolvedValue(makeShellResult('     /system/bin/sh'));
      expect(await command.exec({ binary: 'sh' })).toEqual('/system/bin/sh');
    });

    it('should handle output with tabs', async () => {
      device.shell.mockResolvedValue(makeShellResult('\t/system/bin/sh\t'));
      expect(await command.exec({ binary: 'sh' })).toEqual('/system/bin/sh');
    });

    it('should handle output with mixed whitespace', async () => {
      device.shell.mockResolvedValue(makeShellResult(' \t /system/bin/sh \n \t '));
      expect(await command.exec({ binary: 'sh' })).toEqual('/system/bin/sh');
    });
  });
});