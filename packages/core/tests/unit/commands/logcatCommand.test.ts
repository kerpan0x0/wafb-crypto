import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GetLogcatCommand } from '../../../src/commands/logcatCommand';
import { createMockDevice, makeShellResult, MOCK_LOGCAT_OUTPUT, type MockDevice } from '../../helpers/test-helpers';


describe('GetLogcatCommand', () => {
  let device: MockDevice;
  let command: GetLogcatCommand;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('exec', () => {
    it('should get logcat output with default options', async () => {
      device = createMockDevice();
      device.shell.mockResolvedValue(makeShellResult(MOCK_LOGCAT_OUTPUT));
      command = new GetLogcatCommand(device as any);

      const result = await command.exec();

      expect(result).toBe(MOCK_LOGCAT_OUTPUT);
      expect(device.shell).toHaveBeenCalledWith('logcat -d', expect.any(Object));
    });

    it('should apply buffer option', async () => {
      device = createMockDevice();
      device.shell.mockResolvedValue(makeShellResult('system logs'));
      command = new GetLogcatCommand(device as any);

      await command.exec({ buffer: 'system' });

      expect(device.shell).toHaveBeenCalledWith('logcat -d -b system', expect.any(Object));
    });

    it('should apply maxLines option', async () => {
      device = createMockDevice();
      device.shell.mockResolvedValue(makeShellResult('last 100 lines'));
      command = new GetLogcatCommand(device as any);

      await command.exec({ maxLines: 100 });

      expect(device.shell).toHaveBeenCalledWith('logcat -d -t 100', expect.any(Object));
    });

    it('should apply filter option', async () => {
      device = createMockDevice();
      device.shell.mockResolvedValue(makeShellResult('filtered logs'));
      command = new GetLogcatCommand(device as any);

      await command.exec({ filter: 'ActivityManager:I *:S' });

      expect(device.shell).toHaveBeenCalledWith(
        'logcat -d ActivityManager:I *:S', expect.any(Object)
      );
    });

    it('should apply multiple options together', async () => {
      device = createMockDevice();
      device.shell.mockResolvedValue(makeShellResult('filtered system logs'));
      command = new GetLogcatCommand(device as any);

      await command.exec({
        buffer: 'system',
        maxLines: 50,
        filter: 'ActivityManager:V'
      });

      expect(device.shell).toHaveBeenCalledWith(
        'logcat -d -b system -t 50 ActivityManager:V', expect.any(Object)
      );
    });

    it('should use different buffer types', async () => {
      const bufferTypes: Array<'main' | 'system' | 'radio' | 'events' | 'crash' | 'default' | 'all'> = [
        'main',
        'system',
        'radio',
        'events',
        'crash',
        'default',
        'all'
      ];

      for (const buffer of bufferTypes) {
        device = createMockDevice();
        device.shell.mockResolvedValue(makeShellResult(`${buffer} buffer logs`));
        command = new GetLogcatCommand(device as any);

        await command.exec({ buffer });

        expect(device.shell).toHaveBeenCalledWith(`logcat -d -b ${buffer}`, expect.any(Object));
      }
    });

    it('should handle dump option as false to stream logs', async () => {
      device = createMockDevice();
      device.shell.mockResolvedValue(makeShellResult('streaming logs'));
      command = new GetLogcatCommand(device as any);

      await command.exec({ dump: false });

      // When dump is false, -d should not be included (command may have trailing space)
      const callArg = (device.shell as any).mock.calls[0][0];
      expect(callArg.trim()).toBe('logcat');
    });

    it('should handle empty logcat output', async () => {
      device = createMockDevice();
      device.shell.mockResolvedValue(makeShellResult(''));
      command = new GetLogcatCommand(device as any);

      const result = await command.exec();

      expect(result).toBe('');
    });

    it('should parse multiline logcat output', async () => {
      const multilineOutput = `
01-15 10:30:45.123  1234  5678 I TAG1: Message 1
01-15 10:30:46.123  1234  5678 D TAG2: Message 2
01-15 10:30:47.123  1234  5678 W TAG3: Message 3
01-15 10:30:48.123  1234  5678 E TAG4: Message 4
      `.trim();

      device = createMockDevice();
      device.shell.mockResolvedValue(makeShellResult(multilineOutput));
      command = new GetLogcatCommand(device as any);

      const result = await command.exec();

      expect(result).toBe(multilineOutput);
      expect(result.split('\n').length).toBe(4);
    });

    it('should apply complex filters', async () => {
      device = createMockDevice();
      device.shell.mockResolvedValue(makeShellResult('complex filtered logs'));
      command = new GetLogcatCommand(device as any);

      await command.exec({
        filter: 'ActivityManager:I MyApp:D *:S'
      });

      expect(device.shell).toHaveBeenCalledWith(
        'logcat -d ActivityManager:I MyApp:D *:S', expect.any(Object)
      );
    });

    it('should handle timeout option', async () => {
      device = createMockDevice();
      device.shell.mockResolvedValue(makeShellResult('logs with timeout'));
      command = new GetLogcatCommand(device as any);

      await command.exec({ timeout: 10000 });

      expect(device.shell).toHaveBeenCalledWith('logcat -d', expect.any(Object));
    });

    it('should handle various maxLines values', async () => {
      const maxLinesValues = [10, 50, 100, 500, 1000];

      for (const maxLines of maxLinesValues) {
        device = createMockDevice();
        device.shell.mockResolvedValue(makeShellResult(`${maxLines} lines`));
        command = new GetLogcatCommand(device as any);

        await command.exec({ maxLines });

        expect(device.shell).toHaveBeenCalledWith(`logcat -d -t ${maxLines}`, expect.any(Object));
      }
    });

    it('should handle logcat with priority levels', async () => {
      const filters = [
        'TAG:V', // Verbose
        'TAG:D', // Debug
        'TAG:I', // Info
        'TAG:W', // Warning
        'TAG:E', // Error
        'TAG:F', // Fatal
        'TAG:S'  // Silent
      ];

      for (const filter of filters) {
        device = createMockDevice();
        device.shell.mockResolvedValue(makeShellResult(`logs with ${filter}`));
        command = new GetLogcatCommand(device as any);

        await command.exec({ filter });

        expect(device.shell).toHaveBeenCalledWith(`logcat -d ${filter}`, expect.any(Object));
      }
    });

    it('should combine all buffer options', async () => {
      device = createMockDevice();
      device.shell.mockResolvedValue(makeShellResult('all buffer logs'));
      command = new GetLogcatCommand(device as any);

      await command.exec({ buffer: 'all' });

      expect(device.shell).toHaveBeenCalledWith('logcat -d -b all', expect.any(Object));
    });

    it('should handle crash buffer for crash logs', async () => {
      device = createMockDevice();
      device.shell.mockResolvedValue(makeShellResult('crash logs'));
      command = new GetLogcatCommand(device as any);

      await command.exec({ buffer: 'crash' });

      expect(device.shell).toHaveBeenCalledWith('logcat -d -b crash', expect.any(Object));
    });

    it('should build command with all options in correct order', async () => {
      device = createMockDevice();
      device.shell.mockResolvedValue(makeShellResult('full options'));
      command = new GetLogcatCommand(device as any);

      await command.exec({
        dump: true,
        buffer: 'events',
        maxLines: 200,
        filter: 'MyApp:D *:W',
        timeout: 5000
      });

      // Expected format: logcat -d -b buffer -t maxLines filter
      expect(device.shell).toHaveBeenCalledWith(
        'logcat -d -b events -t 200 MyApp:D *:W', expect.any(Object)
      );
    });
  });
});