import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GetBatteryInfoCommand } from '../../../../src/adb/commands/';
import type { Adb } from '@yume-chan/adb';
import { createMockAdb, createMockShellSocket, MOCK_BATTERY_OUTPUT } from '../../../helpers/test-helpers';


describe('GetBatteryInfoCommand', () => {
  let mockAdb: Adb;
  let command: GetBatteryInfoCommand;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('exec', () => {
    it('should return raw battery information', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_BATTERY_OUTPUT));
      command = new GetBatteryInfoCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe(MOCK_BATTERY_OUTPUT);
      expect(result).toContain('level: 85');
      expect(result).toContain('temperature: 350');
      expect(result).toContain('voltage: 5000000');
      expect(result).toContain('status: 2');
    });

    it('should return raw output with minimal fields', async () => {
      const minimalOutput = `
        level: 50
        temperature: 250
        voltage: 3800
        status: Charging
      `;
      mockAdb = createMockAdb(createMockShellSocket(minimalOutput));
      command = new GetBatteryInfoCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe(minimalOutput);
      expect(result).toContain('level: 50');
      expect(result).toContain('temperature: 250');
      expect(result).toContain('voltage: 3800');
      expect(result).toContain('status: Charging');
    });

    it('should return raw output with temperature values', async () => {
      const output = `
        level: 100
        temperature: 320
        voltage: 4000
        status: Full
      `;
      mockAdb = createMockAdb(createMockShellSocket(output));
      command = new GetBatteryInfoCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe(output);
      expect(result).toContain('temperature: 320');
    });

    it('should return raw output with present field', async () => {
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

      expect(result).toBe(outputPresent);
      expect(result).toContain('present: true');
    });

    it('should return raw output with present false', async () => {
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

      expect(result).toBe(outputNotPresent);
      expect(result).toContain('present: false');
    });

    it('should return empty string on error', async () => {
      mockAdb = createMockAdb();
      (mockAdb.subprocess.shellProtocol.spawn as any).mockRejectedValue(
        new Error('Device disconnected')
      );
      command = new GetBatteryInfoCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe('');
    });

    it('should return malformed output as-is', async () => {
      const malformedOutput = `
        this is not valid battery output
        random text
        no structured data
      `;
      mockAdb = createMockAdb(createMockShellSocket(malformedOutput));
      command = new GetBatteryInfoCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe(malformedOutput);
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
        expect(result).toBe(output);
        expect(result).toContain(`status: ${status}`);
      }
    });

    it('should return raw output with colons', async () => {
      const output = `
        level:90
        temperature:310
        voltage:4150
        status:Charging
      `;
      mockAdb = createMockAdb(createMockShellSocket(output));
      command = new GetBatteryInfoCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe(output);
      expect(result).toContain('level:90');
    });

    it('should return raw output with spaces', async () => {
      const output = `
        level    95
        temperature    305
        voltage    4180
        status    Full
      `;
      mockAdb = createMockAdb(createMockShellSocket(output));
      command = new GetBatteryInfoCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe(output);
      expect(result).toContain('level    95');
    });

    it('should call dumpsys battery command', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_BATTERY_OUTPUT));
      command = new GetBatteryInfoCommand(mockAdb);

      await command.exec();

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('dumpsys battery');
    });
  });
});
