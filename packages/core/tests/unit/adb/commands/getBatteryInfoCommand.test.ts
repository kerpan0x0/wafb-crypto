import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GetBatteryInfoCommand } from '../../../../src/adb/commands/';
import type { Adb } from '@yume-chan/adb';
import { createMockAdb, createMockShellSocket, MOCK_BATTERY_OUTPUT } from './test-helpers';

describe('GetBatteryInfoCommand', () => {
  let mockAdb: Adb;
  let command: GetBatteryInfoCommand;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('exec', () => {
    it('should parse battery information correctly', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_BATTERY_OUTPUT));
      command = new GetBatteryInfoCommand(mockAdb);

      const result = await command.exec();

      expect(result).toEqual({
        level: 85,
        temperature: 35.0,
        voltage: 5000000,
        status: '2',
        health: '2',
        technology: 'Li-ion',
        present: true
      });
    });

    it('should handle missing optional fields', async () => {
      const minimalOutput = `
        level: 50
        temperature: 250
        voltage: 3800
        status: Charging
      `;
      mockAdb = createMockAdb(createMockShellSocket(minimalOutput));
      command = new GetBatteryInfoCommand(mockAdb);

      const result = await command.exec();

      expect(result.level).toBe(50);
      expect(result.temperature).toBe(25.0);
      expect(result.voltage).toBe(3800);
      expect(result.status).toBe('Charging');
      expect(result.health).toBe('');
      expect(result.technology).toBe('');
    });

    it('should convert temperature correctly (divide by 10)', async () => {
      const output = `
        level: 100
        temperature: 320
        voltage: 4000
        status: Full
      `;
      mockAdb = createMockAdb(createMockShellSocket(output));
      command = new GetBatteryInfoCommand(mockAdb);

      const result = await command.exec();

      expect(result.temperature).toBe(32.0);
    });

    it('should parse present field as boolean', async () => {
      const outputPresent = `
        level: 80
        temperature: 300
        voltage: 4100
        status: Charging
        present: true
      `;
      mockAdb = createMockAdb(createMockShellSocket(outputPresent));
      command = new GetBatteryInfoCommand(mockAdb);

      const result = await command.exec();
      expect(result.present).toBe(true);
    });

    it('should handle present field as false', async () => {
      const outputNotPresent = `
        level: 0
        temperature: 0
        voltage: 0
        status: Unknown
        present: false
      `;
      mockAdb = createMockAdb(createMockShellSocket(outputNotPresent));
      command = new GetBatteryInfoCommand(mockAdb);

      const result = await command.exec();
      expect(result.present).toBe(false);
    });

    it('should return default values on error', async () => {
      mockAdb = createMockAdb();
      (mockAdb.subprocess.shellProtocol.spawn as any).mockRejectedValue(
        new Error('Device disconnected')
      );
      command = new GetBatteryInfoCommand(mockAdb);

      const result = await command.exec();

      expect(result).toEqual({
        level: 0,
        temperature: 0,
        voltage: 0,
        status: 'Unknown'
      });
    });

    it('should handle malformed output gracefully', async () => {
      const malformedOutput = `
        this is not valid battery output
        random text
        no structured data
      `;
      mockAdb = createMockAdb(createMockShellSocket(malformedOutput));
      command = new GetBatteryInfoCommand(mockAdb);

      const result = await command.exec();

      expect(result.level).toBe(0);
      expect(result.temperature).toBe(0);
      expect(result.voltage).toBe(0);
      expect(result.status).toBe('Unknown');
    });

    it('should handle various status strings', async () => {
      const statusValues = ['Charging', 'Not charging', 'Full', 'Discharging', '2', '3'];

      for (const status of statusValues) {
        const output = `
          level: 75
          temperature: 280
          voltage: 4000
          status: ${status}
        `;
        mockAdb = createMockAdb(createMockShellSocket(output));
        command = new GetBatteryInfoCommand(mockAdb);

        const result = await command.exec();
        expect(result.status).toBe(status);
      }
    });

    it('should extract numeric values with colons', async () => {
      const output = `
        level:90
        temperature:310
        voltage:4150
        status:Charging
      `;
      mockAdb = createMockAdb(createMockShellSocket(output));
      command = new GetBatteryInfoCommand(mockAdb);

      const result = await command.exec();

      expect(result.level).toBe(90);
      expect(result.temperature).toBe(31.0);
      expect(result.voltage).toBe(4150);
    });

    it('should extract numeric values with spaces', async () => {
      const output = `
        level    95
        temperature    305
        voltage    4180
        status    Full
      `;
      mockAdb = createMockAdb(createMockShellSocket(output));
      command = new GetBatteryInfoCommand(mockAdb);

      const result = await command.exec();

      expect(result.level).toBe(95);
      expect(result.temperature).toBe(30.5);
      expect(result.voltage).toBe(4180);
    });

    it('should call dumpsys battery command', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_BATTERY_OUTPUT));
      command = new GetBatteryInfoCommand(mockAdb);

      await command.exec();

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('dumpsys battery');
    });
  });
});
