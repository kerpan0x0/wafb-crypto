/**
 * @fileoverview Test suite for WhichCommand
 * Tests the command that checks for binary availability on Android devices
 * 
 * @module commands/__tests__/whichCommand.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WhichCommand } from '../../../../src/adb/commands/';
import { createMockAdb, createMockShellSocket } from '../../../helpers/test-helpers';
import type { Adb } from '@yume-chan/adb';

// ============================================================================
// TEST SUITE: WhichCommand
// ============================================================================

describe('WhichCommand', () => {
  let mockAdb: Adb;
  let command: WhichCommand;

  beforeEach(() => {
    const mockSocket = createMockShellSocket('/system/bin/bugreport');
    mockAdb = createMockAdb(mockSocket);
    command = new WhichCommand(mockAdb);
  });

  // ==========================================================================
  // SUCCESS CASES
  // ==========================================================================

  describe('Successful Execution', () => {
    it('should find binary and return path', async () => {
      const result = await command.exec({ command: 'bugreport' });

      expect(result).toEqual('/system/bin/bugreport');
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'which bugreport'
      );
    });

    it('should handle binary in different locations', async () => {
      const mockSocket = createMockShellSocket('/system/xbin/busybox');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'busybox' });

      expect(result).toEqual('/system/xbin/busybox');
    });

    it('should handle binary in vendor partition', async () => {
      const mockSocket = createMockShellSocket('/vendor/bin/hw/android.hardware.health@2.0-service');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'android.hardware.health@2.0-service' });

      expect(result).toEqual('/vendor/bin/hw/android.hardware.health@2.0-service');
    });

    it('should handle binary in /data partition (custom binaries)', async () => {
      const mockSocket = createMockShellSocket('/data/local/tmp/custom_tool');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'custom_tool' });

      expect(result).toEqual('/data/local/tmp/custom_tool');
    });

    it('should trim whitespace from output', async () => {
      const mockSocket = createMockShellSocket('  /system/bin/sh  \n');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'sh' });

      expect(result).toEqual('/system/bin/sh');
    });

    it('should handle output with CRLF line endings', async () => {
      const mockSocket = createMockShellSocket('/system/bin/sh\r\n');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'sh' });

      expect(result).toEqual('/system/bin/sh');
    });
  });

  // ==========================================================================
  // BINARY NOT FOUND CASES
  // ==========================================================================

  describe('Binary Not Found', () => {
    it('should return empty string when binary not found', async () => {
      const mockSocket = createMockShellSocket('');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'nonexistent' });

      expect(result).toBe('');
    });

    it('should return error message when command fails', async () => {
      const mockSocket = createMockShellSocket('which: nonexistent: not found');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'nonexistent' });

      // which output with error message gets trimmed and returned as-is
      expect(result).toBe('which: nonexistent: not found');
    });

    it('should return empty string when output is whitespace only', async () => {
      const mockSocket = createMockShellSocket('   \n  \t  ');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'test' });

      expect(result).toBe('');
    });

    it('should handle null bytes in output', async () => {
      const mockSocket = createMockShellSocket('/system/bin/sh\x00');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'sh' });

      // Null bytes should be handled gracefully
      expect(result).toContain('/system/bin/sh');
    });
  });

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    it('should handle command execution errors gracefully', async () => {
      vi.spyOn(mockAdb.subprocess.shellProtocol, 'spawn').mockRejectedValue(
        new Error('Connection lost')
      );

      await expect(command.exec({ command: 'test' })).rejects.toThrow('Connection lost');
    });

    it('should handle multiple newlines in output', async () => {
      const mockSocket = createMockShellSocket('/system/bin/sh\n\n\n');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'sh' });

      expect(result).toEqual('/system/bin/sh');
    });

    it('should handle output with extra text after path', async () => {
      const mockSocket = createMockShellSocket('/system/bin/sh is a shell');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'sh' });

      expect(result).toContain('/system/bin/sh');
    });

    it('should handle device disconnection during command', async () => {
      vi.spyOn(mockAdb.subprocess.shellProtocol, 'spawn').mockRejectedValue(
        new Error('Device offline')
      );

      await expect(command.exec({ command: 'sh' })).rejects.toThrow('Device offline');
    });

    it('should handle permission denied errors', async () => {
      vi.spyOn(mockAdb.subprocess.shellProtocol, 'spawn').mockRejectedValue(
        new Error('Permission denied')
      );

      await expect(command.exec({ command: 'su' })).rejects.toThrow('Permission denied');
    });

    it('should handle shell timeout errors', async () => {
      vi.spyOn(mockAdb.subprocess.shellProtocol, 'spawn').mockRejectedValue(
        new Error('Command timeout')
      );

      await expect(command.exec({ command: 'test' })).rejects.toThrow('Command timeout');
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle symbolic link paths', async () => {
      const mockSocket = createMockShellSocket('/system/bin/toolbox');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'ls' });

      expect(result).toEqual('/system/bin/toolbox');
    });

    it('should handle binaries with special characters in name', async () => {
      const mockSocket = createMockShellSocket('/system/bin/android.hardware.health@2.0-service');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'android.hardware.health@2.0-service' });

      expect(result).toEqual('/system/bin/android.hardware.health@2.0-service');
    });

    it('should handle very long paths', async () => {
      const longPath = '/system/bin/very/deep/nested/path/to/some/binary/executable';
      const mockSocket = createMockShellSocket(longPath);
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'executable' });

      expect(result).toEqual(longPath);
    });

    it('should handle binary names with numbers', async () => {
      const mockSocket = createMockShellSocket('/system/bin/toolbox64');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'toolbox64' });

      expect(result).toEqual('/system/bin/toolbox64');
    });

    it('should handle binary names with underscores', async () => {
      const mockSocket = createMockShellSocket('/system/bin/app_process64');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'app_process64' });

      expect(result).toEqual('/system/bin/app_process64');
    });

    it('should handle binary names with hyphens', async () => {
      const mockSocket = createMockShellSocket('/system/bin/run-as');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'run-as' });

      expect(result).toEqual('/system/bin/run-as');
    });

    it('should handle paths with dots (AOSP binaries)', async () => {
      const mockSocket = createMockShellSocket('/system/bin/android.hardware.graphics.allocator@4.0-service');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'android.hardware.graphics.allocator@4.0-service' });

      expect(result).toEqual('/system/bin/android.hardware.graphics.allocator@4.0-service');
    });
  });

  // ==========================================================================
  // COMMON ANDROID BINARIES
  // ==========================================================================

  describe('Common Android Binaries', () => {
    const testCases = [
      { binary: 'sh', expectedPath: '/system/bin/sh' },
      { binary: 'bugreport', expectedPath: '/system/bin/bugreport' },
      { binary: 'bugreportz', expectedPath: '/system/bin/bugreportz' },
      { binary: 'dumpsys', expectedPath: '/system/bin/dumpsys' },
      { binary: 'getprop', expectedPath: '/system/bin/getprop' },
      { binary: 'setprop', expectedPath: '/system/bin/setprop' },
      { binary: 'pm', expectedPath: '/system/bin/pm' },
      { binary: 'am', expectedPath: '/system/bin/am' },
      { binary: 'cmd', expectedPath: '/system/bin/cmd' },
      { binary: 'logcat', expectedPath: '/system/bin/logcat' },
      { binary: 'su', expectedPath: '/system/xbin/su' },
      { binary: 'screencap', expectedPath: '/system/bin/screencap' },
      { binary: 'screenrecord', expectedPath: '/system/bin/screenrecord' },
      { binary: 'input', expectedPath: '/system/bin/input' },
      { binary: 'settings', expectedPath: '/system/bin/settings' },
      { binary: 'content', expectedPath: '/system/bin/content' },
      { binary: 'service', expectedPath: '/system/bin/service' },
      { binary: 'ps', expectedPath: '/system/bin/ps' },
      { binary: 'ls', expectedPath: '/system/bin/ls' },
      { binary: 'cat', expectedPath: '/system/bin/cat' }
    ];

    testCases.forEach(({ binary, expectedPath }) => {
      it(`should find ${binary} binary`, async () => {
        const mockSocket = createMockShellSocket(expectedPath);
        mockAdb = createMockAdb(mockSocket);
        command = new WhichCommand(mockAdb);

        const result = await command.exec({ command: binary });

        expect(result).toEqual(expectedPath);
      });
    });
  });

  // ==========================================================================
  // INTEGRATION WITH DEVICE
  // ==========================================================================

  describe('Device Integration', () => {
    it('should use correct shell protocol', async () => {
      const spawnSpy = vi.spyOn(mockAdb.subprocess.shellProtocol, 'spawn');

      await command.exec({ command: 'test' });

      expect(spawnSpy).toHaveBeenCalledTimes(1);
      expect(spawnSpy).toHaveBeenCalledWith('which test');
    });

    it('should pass through command exactly as provided', async () => {
      const spawnSpy = vi.spyOn(mockAdb.subprocess.shellProtocol, 'spawn');

      await command.exec({ command: 'android.hardware.health@2.0-service' });

      expect(spawnSpy).toHaveBeenCalledWith('which android.hardware.health@2.0-service');
    });

    it('should handle commands with spaces (edge case)', async () => {
      // Even though command names shouldn't have spaces, test robustness
      const spawnSpy = vi.spyOn(mockAdb.subprocess.shellProtocol, 'spawn');

      await command.exec({ command: 'test command' });

      expect(spawnSpy).toHaveBeenCalledWith('which test command');
    });
  });

  // ==========================================================================
  // ANDROID VERSION SPECIFIC PATHS
  // ==========================================================================

  describe('Android Version Specific Paths', () => {
    it('should handle modern Android paths (/system/bin)', async () => {
      const mockSocket = createMockShellSocket('/system/bin/pm');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'pm' });

      expect(result).toEqual('/system/bin/pm');
    });

    it('should handle legacy Android paths (/system/xbin)', async () => {
      const mockSocket = createMockShellSocket('/system/xbin/su');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'su' });

      expect(result).toEqual('/system/xbin/su');
    });

    it('should handle vendor paths (Treble)', async () => {
      const mockSocket = createMockShellSocket('/vendor/bin/hw/android.hardware.health@2.0-service');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'android.hardware.health@2.0-service' });

      expect(result).toContain('/vendor/bin/hw/');
    });

    it('should handle apex paths (Android 10+)', async () => {
      const mockSocket = createMockShellSocket('/apex/com.android.runtime/bin/linker64');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'linker64' });

      expect(result).toContain('/apex/');
    });
  });

  // ==========================================================================
  // TIMEOUT AND PERFORMANCE
  // ==========================================================================

  describe('Timeout and Performance', () => {
    it('should support timeout option', async () => {
      const result = await command.exec({ 
        command: 'test',
        timeout: 5000 
      });

      // Should complete successfully with timeout option
      expect(result).toBeDefined();
    });

    it('should complete quickly for simple which command', async () => {
      const startTime = Date.now();
      await command.exec({ command: 'sh' });
      const duration = Date.now() - startTime;

      // Should be very fast (< 100ms in tests)
      expect(duration).toBeLessThan(100);
    });
  });

  // ==========================================================================
  // OUTPUT FORMAT VARIATIONS
  // ==========================================================================

  describe('Output Format Variations', () => {
    it('should handle output with trailing spaces', async () => {
      const mockSocket = createMockShellSocket('/system/bin/sh     ');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'sh' });

      expect(result).toEqual('/system/bin/sh');
    });

    it('should handle output with leading spaces', async () => {
      const mockSocket = createMockShellSocket('     /system/bin/sh');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'sh' });

      expect(result).toEqual('/system/bin/sh');
    });

    it('should handle output with tabs', async () => {
      const mockSocket = createMockShellSocket('\t/system/bin/sh\t');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'sh' });

      expect(result).toEqual('/system/bin/sh');
    });

    it('should handle output with mixed whitespace', async () => {
      const mockSocket = createMockShellSocket(' \t /system/bin/sh \n \t ');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'sh' });

      expect(result).toEqual('/system/bin/sh');
    });
  });
});