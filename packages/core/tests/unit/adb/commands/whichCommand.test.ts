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

    it('should trim whitespace from output', async () => {
      const mockSocket = createMockShellSocket('  /system/bin/sh  \n');
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
    it('should return null when binary not found', async () => {
      const mockSocket = createMockShellSocket('');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'nonexistent' });

      expect(result).toBe("");
    });

    it('should return empty str when output is whitespace only', async () => {
      const mockSocket = createMockShellSocket('   \n  \t  ');
      mockAdb = createMockAdb(mockSocket);
      command = new WhichCommand(mockAdb);

      const result = await command.exec({ command: 'test' });

      expect(result).toBe("");
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
      { binary: 'pm', expectedPath: '/system/bin/pm' },
      { binary: 'am', expectedPath: '/system/bin/am' },
      { binary: 'logcat', expectedPath: '/system/bin/logcat' },
      { binary: 'su', expectedPath: '/system/xbin/su' }
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

    it('should handle disconnected device', async () => {
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
  });
});