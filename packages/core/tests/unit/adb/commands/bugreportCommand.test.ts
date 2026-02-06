/**
 * @fileoverview Test suite for BugreportCommand
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

/**
 * Sample legacy bugreport output (abbreviated)
 */
const MOCK_LEGACY_BUGREPORT = `========================================================
== dumpstate: 2025-01-15 10:30:45
========================================================

------ SYSTEM LOG (logcat -v threadtime -d *:v) ------
01-15 10:30:00.123  1234  5678 I SystemServer: Entered the Android system server!

------ DUMPSYS (dumpsys) ------
Currently running services:
  SurfaceFlinger
  accessibility
  account
  activity

------ VM TRACES AT LAST ANR (/data/anr/traces.txt: 2025-01-15 10:25:00) ------
----- pid 1234 at 2025-01-15 10:25:00 -----
Cmd line: system_server

------ KERNEL LOG (dmesg) ------
[    0.000000] Booting Linux on physical CPU 0x0

========================================================
== dumpstate: done (id 123 pid 456)
========================================================`;

/**
 * Sample bugreportz output (zipped format)
 */
const MOCK_ZIPPED_BUGREPORT = `OK:/data/user_de/0/com.android.shell/files/bugreports/bugreport-pixel7-2025-01-15-10-30-45.zip`;

/**
 * Alternative zipped output format (some devices)
 */
const MOCK_ZIPPED_BUGREPORT_ALT = `BEGIN:/data/user_de/0/com.android.shell/files/bugreports/bugreport-pixel7-2025-01-15-10-30-45.zip
PROGRESS:10/100
PROGRESS:25/100
PROGRESS:50/100
PROGRESS:75/100
PROGRESS:100/100
OK:/data/user_de/0/com.android.shell/files/bugreports/bugreport-pixel7-2025-01-15-10-30-45.zip`;

/**
 * Error output from bugreportz
 */
const MOCK_BUGREPORTZ_ERROR = `FAIL:Error generating bugreport: No space left on device`;

// ============================================================================
// TEST SUITE: BugreportCommand
// ============================================================================
/*
describe('BugreportCommand', () => {
  let mockAdb: Adb;
  let command: BugreportCommand;

  beforeEach(() => {
    const mockSocket = createMockShellSocket(MOCK_LEGACY_BUGREPORT);
    mockAdb = createMockAdb(mockSocket);
    command = new BugreportCommand(mockAdb);
  });

  // ==========================================================================
  // LEGACY BUGREPORT (SDK < 24)
  // ==========================================================================

  describe('Legacy Bugreport (SDK < 24)', () => {
    it('should execute legacy bugreport command', async () => {
      const result = await command.exec({});

      expect(result).toContain('dumpstate: 2025-01-15 10:30:45');
      expect(result).toContain('SYSTEM LOG');
      expect(result).toContain('DUMPSYS');
      expect(result).toContain('dumpstate: done');
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'bugreport'
      );
    });

    it('should handle large legacy bugreport output', async () => {
      const largeBugreport = MOCK_LEGACY_BUGREPORT.repeat(100);
      const mockSocket = createMockShellSocket(largeBugreport);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportCommand(mockAdb);

      const result = await command.exec({});

      expect(result.length).toBeGreaterThan(10000);
      expect(result).toContain('dumpstate:');
    });

    it('should preserve all sections in legacy format', async () => {
      const result = await command.exec({});

      const sections = [
        'SYSTEM LOG',
        'DUMPSYS',
        'VM TRACES',
        'KERNEL LOG'
      ];

      sections.forEach(section => {
        expect(result).toContain(section);
      });
    });

    it('should handle legacy bugreport without explicit option', async () => {
      const result = await command.exec({});

      expect(result).toContain('dumpstate:');
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'bugreport'
      );
    });

    it('should handle multiline legacy output', async () => {
      const result = await command.exec({});
      const lines = result.split('\n');

      expect(lines.length).toBeGreaterThan(10);
      expect(lines[0]).toContain('====');
    });

    it('should preserve timestamps in legacy format', async () => {
      const result = await command.exec({});

      expect(result).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    });

    it('should handle bugreport with non-ASCII characters', async () => {
      const bugreportWithUnicode = `${MOCK_LEGACY_BUGREPORT}
------ DEVICE INFO ------
Manufacturer: 小米
Model: Redmi Note 测试`;

      const mockSocket = createMockShellSocket(bugreportWithUnicode);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportCommand(mockAdb);

      const result = await command.exec({});

      expect(result).toContain('小米');
      expect(result).toContain('测试');
    });

    it('should handle very short bugreport', async () => {
      const mockSocket = createMockShellSocket('== dumpstate: error ==');
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportCommand(mockAdb);

      const result = await command.exec({});

      expect(result).toBe('== dumpstate: error ==');
    });

  });
});
*/
// ==========================================================================
// ZIPPED BUGREPORT (SDK >= 24)
// ==========================================================================
describe('BugreportzCommand', () => {
  let mockAdb: Adb;
  let command: BugreportzCommand;
  describe('Zipped Bugreport (SDK >= 24)', () => {
    beforeEach(() => {
      const mockSocket = createMockShellSocket(MOCK_ZIPPED_BUGREPORT);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);
    });

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

      const result = await command.exec({});

      expect(result).toContain('OK:/data/user_de/');
      expect(result).toContain('.zip');
    });

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

    it('should extract complete path from OK: response', async () => {
      const mockSocket = createMockShellSocket(MOCK_ZIPPED_BUGREPORT);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

      expect(result).toContain('OK:/data/user_de/');
      expect(result).toContain('/com.android.shell/files/bugreports/');
      expect(result).toMatch(/bugreport-.*-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.zip/);
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

    it('should handle output with extra whitespace', async () => {
      const mockSocket = createMockShellSocket(`  ${MOCK_ZIPPED_BUGREPORT}  \n\n`);
      mockAdb = createMockAdb(mockSocket);
      command = new BugreportzCommand(mockAdb);

      const result = await command.exec({});

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
  });
});