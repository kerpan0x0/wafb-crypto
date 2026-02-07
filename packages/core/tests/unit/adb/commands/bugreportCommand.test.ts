/**
 * @fileoverview Test suite for BugreportCommand and BugreportzCommand
 * Tests both legacy bugreport and modern bugreportz formats
 * 
 * @module commands/__tests__/bugreportCommand.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BugreportCommand, BugreportzCommand } from '../../../../src/adb/commands';
import { createMockAdb, createMockShellSocket } from '../../../helpers/test-helpers';
import type { Adb } from '@yume-chan/adb';

// ============================================================================
// MOCK DATA
// ============================================================================

const MOCK_ZIPPED_BUGREPORT = `OK:/data/user_de/0/com.android.shell/files/bugreports/bugreport-pixel7-2025-01-15-10-30-45.zip`;

const MOCK_ZIPPED_BUGREPORT_ALT = `BEGIN:/data/user_de/0/com.android.shell/files/bugreports/bugreport-pixel7-2025-01-15-10-30-45.zip
PROGRESS:10/100
PROGRESS:25/100
PROGRESS:50/100
PROGRESS:75/100
PROGRESS:100/100
OK:/data/user_de/0/com.android.shell/files/bugreports/bugreport-pixel7-2025-01-15-10-30-45.zip`;

const MOCK_BUGREPORTZ_ERROR = `FAIL:Error generating bugreport: No space left on device`;

// ============================================================================
// TEST SUITE: BugreportCommand (Legacy)
// ============================================================================

describe('BugreportCommand', () => {
  let mockAdb: Adb;
  let command: BugreportCommand;

  beforeEach(() => {
    const mockSocket = createMockShellSocket('/sdcard/bugreport.txt');
    mockAdb = createMockAdb(mockSocket);
    command = new BugreportCommand(mockAdb);
  });

  describe('Legacy Bugreport Execution', () => {
    it('should execute bugreport command with output path', async () => {
      const result = await command.exec({ outputPath: '/sdcard/bugreport-test.txt' });

      expect(result).toBe('/sdcard/bugreport-test.txt');
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'bugreport > /sdcard/bugreport-test.txt'
      );
    });

    it('should support custom output paths', async () => {
      const paths = [
        '/sdcard/report.txt',
        '/data/local/tmp/bug.txt',
        '/sdcard/Download/debug.txt'
      ];

      for (const path of paths) {
        const result = await command.exec({ outputPath: path });
        expect(result).toBe(path);
      }
    });

    it('should support timeout option', async () => {
      const spawnSpy = vi.spyOn(mockAdb.subprocess.shellProtocol, 'spawn');

      await command.exec({ 
        outputPath: '/sdcard/report.txt',
        timeout: 180000 
      });

      expect(spawnSpy).toHaveBeenCalled();
    });

    it('should handle command execution errors', async () => {
      vi.spyOn(mockAdb.subprocess.shellProtocol, 'spawn').mockRejectedValue(
        new Error('Device disconnected')
      );

      await expect(command.exec({ outputPath: '/sdcard/report.txt' }))
        .rejects.toThrow('Device disconnected');
    });

    it('should handle permission denied errors', async () => {
      vi.spyOn(mockAdb.subprocess.shellProtocol, 'spawn').mockRejectedValue(
        new Error('Permission denied')
      );

      await expect(command.exec({ outputPath: '/sdcard/report.txt' }))
        .rejects.toThrow('Permission denied');
    });

    it('should handle filesystem full errors', async () => {
      vi.spyOn(mockAdb.subprocess.shellProtocol, 'spawn').mockRejectedValue(
        new Error('No space left on device')
      );

      await expect(command.exec({ outputPath: '/sdcard/report.txt' }))
        .rejects.toThrow('No space left on device');
    });

    it('should handle paths with special characters', async () => {
      const specialPath = '/sdcard/bug-report_2025-01-15_10:30.txt';
      const result = await command.exec({ outputPath: specialPath });

      expect(result).toBe(specialPath);
    });

    it('should handle very long paths', async () => {
      const longPath = '/sdcard/very/deep/nested/folder/structure/for/testing/bugreport-output.txt';
      const result = await command.exec({ outputPath: longPath });

      expect(result).toBe(longPath);
    });
  });

  describe('Timeout Handling', () => {
    it('should respect timeout configuration', async () => {
      const result = await command.exec({ 
        outputPath: '/sdcard/report.txt',
        timeout: 5000 
      });

      expect(result).toBe('/sdcard/report.txt');
    });

    it('should handle timeout expiration', async () => {
      vi.spyOn(mockAdb.subprocess.shellProtocol, 'spawn').mockRejectedValue(
        new Error('Command timeout')
      );

      await expect(command.exec({ 
        outputPath: '/sdcard/report.txt',
        timeout: 100 
      })).rejects.toThrow('Command timeout');
    });
  });
});

// ============================================================================
// TEST SUITE: BugreportzCommand (Modern/Zipped)
// ============================================================================

describe('BugreportzCommand', () => {
  let mockAdb: Adb;
  let command: BugreportzCommand;

  beforeEach(() => {
    const mockSocket = createMockShellSocket(MOCK_ZIPPED_BUGREPORT);
    mockAdb = createMockAdb(mockSocket);
    command = new BugreportzCommand(mockAdb);
  });

  // ==========================================================================
  // SUCCESSFUL EXECUTION
  // ==========================================================================

  describe('Successful Execution', () => {
    it('should execute bugreportz command', async () => {
      const result = await command.exec({});

      expect(result).toContain('OK:/data/user_de/0/com.android.shell/files/bugreports/');
      expect(result).toContain('.zip');
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'bugreportz'
      );
    });

    it('should extract path from zipped bugreport output', async () => {
      const result = await command.exec({});

      expect(result).toMatch(/OK:\/data\/user_de\/\d+\/com\.android\.shell\/files\/bugreports\/bugreport-.*\.zip/);
    });

    it('should handle progress updates in zipped format', async () => {
      const mockSocket = createMockShellSocket(MOCK_ZIPPED_BUGREPORT_ALT);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

      expect(result).toContain('OK:/data/user_de/');
      expect(result).toContain('.zip');
    });

    it('should support timeout option', async () => {
      const result = await command.exec({ timeout: 180000 });

      expect(result).toContain('OK:');
    });
  });

  // ==========================================================================
  // OUTPUT PARSING
  // ==========================================================================

  describe('Output Parsing', () => {
    it('should handle different device names in zip filename', async () => {
      const outputs = [
        'OK:/data/user_de/0/com.android.shell/files/bugreports/bugreport-pixel7-2025-01-15-10-30-45.zip',
        'OK:/data/user_de/0/com.android.shell/files/bugreports/bugreport-samsung-2025-01-15-10-30-45.zip',
        'OK:/data/user_de/0/com.android.shell/files/bugreports/bugreport-xiaomi-2025-01-15-10-30-45.zip'
      ];

      for (const output of outputs) {
        const mockSocket = createMockShellSocket(output);
        mockAdb = createMockAdb(mockSocket);
        command = new BugreportzCommand(mockAdb);

        const result = await command.exec({});

        expect(result).toBe(output);
      }
    });

    it('should handle different user IDs in path', async () => {
      const userIds = [0, 10, 999];

      for (const userId of userIds) {
        const output = `OK:/data/user_de/${userId}/com.android.shell/files/bugreports/bugreport-device-2025-01-15-10-30-45.zip`;
        const mockSocket = createMockShellSocket(output);
        mockAdb = createMockAdb(mockSocket);
        command = new BugreportzCommand(mockAdb);

        const result = await command.exec({});

        expect(result).toContain(`/data/user_de/${userId}/`);
      }
    });

    it('should extract complete path from OK: response', async () => {
      const result = await command.exec({});

      expect(result).toContain('OK:/data/user_de/');
      expect(result).toContain('/com.android.shell/files/bugreports/');
      expect(result).toMatch(/bugreport-.*-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.zip/);
    });

    it('should handle output with extra whitespace', async () => {
      const mockSocket = createMockShellSocket(`  ${MOCK_ZIPPED_BUGREPORT}  \n\n`);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

      // Result should be trimmed
      expect(result.trim()).toBe(MOCK_ZIPPED_BUGREPORT.trim());
    });

    it('should handle bugreportz with BEGIN marker', async () => {
      const output = 'BEGIN:/data/user_de/0/com.android.shell/files/bugreports/bugreport.zip\nOK:/data/user_de/0/com.android.shell/files/bugreports/bugreport.zip';
      const mockSocket = createMockShellSocket(output);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

      expect(result).toContain('BEGIN:');
      expect(result).toContain('OK:');
    });

    it('should preserve PROGRESS markers in output', async () => {
      const mockSocket = createMockShellSocket(MOCK_ZIPPED_BUGREPORT_ALT);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

      // Full output should be preserved including progress
      expect(result).toContain('PROGRESS:');
    });
  });

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    it('should handle bugreportz failure', async () => {
      const mockSocket = createMockShellSocket(MOCK_BUGREPORTZ_ERROR);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

      expect(result).toContain('FAIL:');
      expect(result).toContain('No space left on device');
    });

    it('should handle command execution errors', async () => {
      vi.spyOn(mockAdb.subprocess.shellProtocol, 'spawn').mockRejectedValue(
        new Error('Device disconnected')
      );

      await expect(command.exec({})).rejects.toThrow('Device disconnected');
    });

    it('should handle empty output', async () => {
      const mockSocket = createMockShellSocket('');
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

      expect(result).toBe('');
    });

    it('should handle malformed zipped output', async () => {
      const mockSocket = createMockShellSocket('Invalid output format');
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

      expect(result).toBe('Invalid output format');
    });

    it('should handle timeout during bugreport generation', async () => {
      vi.spyOn(mockAdb.subprocess.shellProtocol, 'spawn').mockRejectedValue(
        new Error('Command timeout')
      );

      await expect(command.exec({})).rejects.toThrow('Command timeout');
    });

    it('should handle device offline errors', async () => {
      vi.spyOn(mockAdb.subprocess.shellProtocol, 'spawn').mockRejectedValue(
        new Error('Device offline')
      );

      await expect(command.exec({})).rejects.toThrow('Device offline');
    });

    it('should handle permission errors', async () => {
      vi.spyOn(mockAdb.subprocess.shellProtocol, 'spawn').mockRejectedValue(
        new Error('Permission denied')
      );

      await expect(command.exec({})).rejects.toThrow('Permission denied');
    });
  });

  // ==========================================================================
  // REAL-WORLD SCENARIOS
  // ==========================================================================

  describe('Real-World Device Scenarios', () => {
    it('should handle bugreport from Pixel device', async () => {
      const pixelBugreport = 'OK:/data/user_de/0/com.android.shell/files/bugreports/bugreport-pixel7pro-TP1A.220905.004-2025-01-15-10-30-45.zip';
      const mockSocket = createMockShellSocket(pixelBugreport);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

      expect(result).toContain('pixel7pro');
      expect(result).toContain('TP1A.220905.004');
    });

    it('should handle bugreport from Samsung device', async () => {
      const samsungBugreport = 'OK:/data/user_de/0/com.android.shell/files/bugreports/bugreport-SM-G998B-2025-01-15-10-30-45.zip';
      const mockSocket = createMockShellSocket(samsungBugreport);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

      expect(result).toContain('SM-G998B');
    });

    it('should handle bugreport from Xiaomi device', async () => {
      const xiaomiBugreport = 'OK:/data/user_de/0/com.android.shell/files/bugreports/bugreport-M2102K1G-2025-01-15-10-30-45.zip';
      const mockSocket = createMockShellSocket(xiaomiBugreport);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

      expect(result).toContain('M2102K1G');
    });

    it('should handle bugreport with build ID in filename', async () => {
      const buildIdBugreport = 'OK:/data/user_de/0/com.android.shell/files/bugreports/bugreport-device-RQ3A.211001.001-2025-01-15-10-30-45.zip';
      const mockSocket = createMockShellSocket(buildIdBugreport);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

      expect(result).toContain('RQ3A.211001.001');
    });

    it('should handle long device model names', async () => {
      const longModelBugreport = 'OK:/data/user_de/0/com.android.shell/files/bugreports/bugreport-very-long-device-model-name-v12-2025-01-15-10-30-45.zip';
      const mockSocket = createMockShellSocket(longModelBugreport);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

      expect(result).toContain('very-long-device-model-name-v12');
    });
  });

  // ==========================================================================
  // PROGRESS REPORTING
  // ==========================================================================

  describe('Progress Reporting', () => {
    it('should include all progress markers when present', async () => {
      const progressOutput = `BEGIN:/data/bugreport.zip
PROGRESS:25/100
PROGRESS:50/100
PROGRESS:75/100
PROGRESS:100/100
OK:/data/bugreport.zip`;

      const mockSocket = createMockShellSocket(progressOutput);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

      expect(result).toContain('PROGRESS:25/100');
      expect(result).toContain('PROGRESS:50/100');
      expect(result).toContain('PROGRESS:75/100');
      expect(result).toContain('PROGRESS:100/100');
    });

    it('should work without progress markers (older Android)', async () => {
      const simpleOutput = 'OK:/data/user_de/0/com.android.shell/files/bugreports/bugreport.zip';
      const mockSocket = createMockShellSocket(simpleOutput);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

      expect(result).toBe(simpleOutput);
      expect(result).not.toContain('PROGRESS:');
    });

    it('should handle incomplete progress sequences', async () => {
      const incompleteProgress = `BEGIN:/data/bugreport.zip
PROGRESS:10/100
PROGRESS:30/100
OK:/data/bugreport.zip`;

      const mockSocket = createMockShellSocket(incompleteProgress);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

      expect(result).toContain('OK:');
      expect(result).toContain('PROGRESS:10/100');
    });
  });

  // ==========================================================================
  // TIMESTAMP VARIATIONS
  // ==========================================================================

  describe('Timestamp Variations', () => {
    it('should handle different timestamp formats', async () => {
      const timestamps = [
        'bugreport-device-2025-01-15-10-30-45.zip',
        'bugreport-device-2025-12-31-23-59-59.zip',
        'bugreport-device-2025-02-29-00-00-00.zip'
      ];

      for (const filename of timestamps) {
        const output = `OK:/data/user_de/0/com.android.shell/files/bugreports/${filename}`;
        const mockSocket = createMockShellSocket(output);
        mockAdb = createMockAdb(mockSocket);
        command = new BugreportzCommand(mockAdb);

        const result = await command.exec({});

        expect(result).toContain(filename);
      }
    });

    it('should handle legacy timestamp format (if exists)', async () => {
      const legacyFormat = 'OK:/data/user_de/0/com.android.shell/files/bugreports/bugreport-device-20250115-103045.zip';
      const mockSocket = createMockShellSocket(legacyFormat);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

      expect(result).toBe(legacyFormat);
    });
  });

  // ==========================================================================
  // MULTIUSER SCENARIOS
  // ==========================================================================

  describe('Multi-User Scenarios', () => {
    it('should handle user ID 0 (primary user)', async () => {
      const output = 'OK:/data/user_de/0/com.android.shell/files/bugreports/bugreport.zip';
      const mockSocket = createMockShellSocket(output);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

      expect(result).toContain('/data/user_de/0/');
    });

    it('should handle user ID 10 (secondary user)', async () => {
      const output = 'OK:/data/user_de/10/com.android.shell/files/bugreports/bugreport.zip';
      const mockSocket = createMockShellSocket(output);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

      expect(result).toContain('/data/user_de/10/');
    });

    it('should handle work profile user IDs', async () => {
      const workProfileOutput = 'OK:/data/user_de/11/com.android.shell/files/bugreports/bugreport.zip';
      const mockSocket = createMockShellSocket(workProfileOutput);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

      expect(result).toContain('/data/user_de/11/');
    });
  });
});