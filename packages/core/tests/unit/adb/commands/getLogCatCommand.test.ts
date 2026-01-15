import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GetLogCatCommand } from '../../../../src/adb/commands/logCatCommand';
import type { Adb } from '@yume-chan/adb';
import { createMockAdb, createMockShellSocket, MOCK_LOGCAT_OUTPUT } from './test-helpers';

describe('GetLogCatCommand', () => {
  let mockAdb: Adb;
  let command: GetLogCatCommand;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('exec', () => {
    it('should get logcat output with default options', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_LOGCAT_OUTPUT));
      command = new GetLogCatCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe(MOCK_LOGCAT_OUTPUT);
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('logcat -d');
    });

    it('should apply buffer option', async () => {
      mockAdb = createMockAdb(createMockShellSocket('system logs'));
      command = new GetLogCatCommand(mockAdb);

      await command.exec({ buffer: 'system' });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('logcat -d -b system');
    });

    it('should apply maxLines option', async () => {
      mockAdb = createMockAdb(createMockShellSocket('last 100 lines'));
      command = new GetLogCatCommand(mockAdb);

      await command.exec({ maxLines: 100 });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('logcat -d -t 100');
    });

    it('should apply filter option', async () => {
      mockAdb = createMockAdb(createMockShellSocket('filtered logs'));
      command = new GetLogCatCommand(mockAdb);

      await command.exec({ filter: 'ActivityManager:I *:S' });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'logcat -d ActivityManager:I *:S'
      );
    });

    it('should apply multiple options together', async () => {
      mockAdb = createMockAdb(createMockShellSocket('filtered system logs'));
      command = new GetLogCatCommand(mockAdb);

      await command.exec({
        buffer: 'system',
        maxLines: 50,
        filter: 'ActivityManager:V'
      });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'logcat -d -b system -t 50 ActivityManager:V'
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
        mockAdb = createMockAdb(createMockShellSocket(`${buffer} buffer logs`));
        command = new GetLogCatCommand(mockAdb);

        await command.exec({ buffer });

        expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
          `logcat -d -b ${buffer}`
        );
      }
    });

    it('should handle dump option as false to stream logs', async () => {
      mockAdb = createMockAdb(createMockShellSocket('streaming logs'));
      command = new GetLogCatCommand(mockAdb);

      await command.exec({ dump: false });

      // When dump is false, -d should not be included (command may have trailing space)
      const callArg = (mockAdb.subprocess.shellProtocol.spawn as any).mock.calls[0][0];
      expect(callArg.trim()).toBe('logcat');
    });

    it('should handle empty logcat output', async () => {
      mockAdb = createMockAdb(createMockShellSocket(''));
      command = new GetLogCatCommand(mockAdb);

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

      mockAdb = createMockAdb(createMockShellSocket(multilineOutput));
      command = new GetLogCatCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe(multilineOutput);
      expect(result.split('\n').length).toBe(4);
    });

    it('should apply complex filters', async () => {
      mockAdb = createMockAdb(createMockShellSocket('complex filtered logs'));
      command = new GetLogCatCommand(mockAdb);

      await command.exec({
        filter: 'ActivityManager:I MyApp:D *:S'
      });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'logcat -d ActivityManager:I MyApp:D *:S'
      );
    });

    it('should handle timeout option', async () => {
      mockAdb = createMockAdb(createMockShellSocket('logs with timeout'));
      command = new GetLogCatCommand(mockAdb);

      await command.exec({ timeout: 10000 });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('logcat -d');
    });

    it('should handle various maxLines values', async () => {
      const maxLinesValues = [10, 50, 100, 500, 1000];

      for (const maxLines of maxLinesValues) {
        mockAdb = createMockAdb(createMockShellSocket(`${maxLines} lines`));
        command = new GetLogCatCommand(mockAdb);

        await command.exec({ maxLines });

        expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
          `logcat -d -t ${maxLines}`
        );
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
        mockAdb = createMockAdb(createMockShellSocket(`logs with ${filter}`));
        command = new GetLogCatCommand(mockAdb);

        await command.exec({ filter });

        expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
          `logcat -d ${filter}`
        );
      }
    });

    it('should combine all buffer options', async () => {
      mockAdb = createMockAdb(createMockShellSocket('all buffer logs'));
      command = new GetLogCatCommand(mockAdb);

      await command.exec({ buffer: 'all' });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('logcat -d -b all');
    });

    it('should handle crash buffer for crash logs', async () => {
      mockAdb = createMockAdb(createMockShellSocket('crash logs'));
      command = new GetLogCatCommand(mockAdb);

      await command.exec({ buffer: 'crash' });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('logcat -d -b crash');
    });

    it('should build command with all options in correct order', async () => {
      mockAdb = createMockAdb(createMockShellSocket('full options'));
      command = new GetLogCatCommand(mockAdb);

      await command.exec({
        dump: true,
        buffer: 'events',
        maxLines: 200,
        filter: 'MyApp:D *:W',
        timeout: 5000
      });

      // Expected format: logcat -d -b buffer -t maxLines filter
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'logcat -d -b events -t 200 MyApp:D *:W'
      );
    });
  });
});
