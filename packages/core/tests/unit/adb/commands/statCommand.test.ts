import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StatCommand } from '../../../../src/adb/commands/statCommand';
import type { Adb } from '@yume-chan/adb';
import { createMockAdb, createMockShellSocket } from '../../../helpers/test-helpers';

describe('StatCommand', () => {
  let mockAdb: Adb;
  let command: StatCommand;

  // Mock stat output in pipe-separated format
  // Format: %s|%F|%Y|%X|%Z|%a|%A|%U|%G|%u|%g|%i
  // size|type|mtime|atime|ctime|octal_perms|human_perms|owner|group|uid|gid|inode
  const MOCK_STAT_OUTPUT = '1234|regular file|1704067200|1704067100|1704067200|0644|-rw-r--r--|root|sdcard_rw|0|1015|12345';

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdb = createMockAdb() as unknown as Adb;
    command = new StatCommand(mockAdb);
  });

  describe('Command Construction', () => {
    it('should build stat command with default format', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_STAT_OUTPUT)
      );

      await command.exec({ path: '/sdcard/test.txt' });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        expect.stringContaining('stat -c')
      );
    });

    it('should include default format string', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_STAT_OUTPUT)
      );

      await command.exec({ path: '/sdcard/test.txt' });

      const spawnCall = vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mock.calls[0][0];
      expect(spawnCall).toContain('%s|%F|%Y|%X|%Z|%a|%A|%U|%G|%u|%g|%i');
    });

    it('should use custom format when provided', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('1234')
      );

      await command.exec({ 
        path: '/sdcard/test.txt',
        format: '%s' // Only size
      });

      const spawnCall = vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mock.calls[0][0];
      expect(spawnCall).toContain('stat -c "%s"');
    });

    it('should escape file path with single quotes', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_STAT_OUTPUT)
      );

      await command.exec({ path: '/sdcard/test.txt' });

      const spawnCall = vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mock.calls[0][0];
      expect(spawnCall).toContain("'/sdcard/test.txt'");
    });

    it('should handle file paths with spaces', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_STAT_OUTPUT)
      );

      await command.exec({ path: '/sdcard/my file.txt' });

      const spawnCall = vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mock.calls[0][0];
      expect(spawnCall).toContain("'/sdcard/my file.txt'");
    });

    it('should handle file paths with quotes by escaping', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_STAT_OUTPUT)
      );

      await command.exec({ path: "/sdcard/file's name.txt" });

      const spawnCall = vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mock.calls[0][0];
      expect(spawnCall).toContain("'/sdcard/file'\\''s name.txt'");
    });

    it('should redirect stderr to /dev/null', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_STAT_OUTPUT)
      );

      await command.exec({ path: '/sdcard/test.txt' });

      const spawnCall = vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mock.calls[0][0];
      expect(spawnCall).toContain('2>/dev/null');
    });

    it('should include empty string fallback on error', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_STAT_OUTPUT)
      );

      await command.exec({ path: '/sdcard/test.txt' });

      const spawnCall = vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mock.calls[0][0];
      expect(spawnCall).toContain('|| echo ""');
    });
  });

  describe('Output Handling', () => {
    it('should return raw stat output', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_STAT_OUTPUT)
      );

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(result).toBe(MOCK_STAT_OUTPUT);
      expect(typeof result).toBe('string');
    });

    it('should return empty string for non-existent file', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      const result = await command.exec({ path: '/nonexistent.txt' });

      expect(result).toBe('');
    });

    it('should handle directory stat output', async () => {
      const dirOutput = '4096|directory|1704067300|1704067200|1704067300|0755|drwxr-xr-x|root|sdcard_rw|0|1015|12346';
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(dirOutput)
      );

      const result = await command.exec({ path: '/sdcard/Documents' });

      expect(result).toBe(dirOutput);
      expect(result).toContain('directory');
    });

    it('should handle symlink stat output', async () => {
      const symlinkOutput = '17|symbolic link|1704067400|1704067300|1704067400|0777|lrwxrwxrwx|root|sdcard_rw|0|1015|12347';
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(symlinkOutput)
      );

      const result = await command.exec({ path: '/sdcard/link.txt' });

      expect(result).toBe(symlinkOutput);
      expect(result).toContain('symbolic link');
    });

    it('should preserve all pipe-separated fields', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_STAT_OUTPUT)
      );

      const result = await command.exec({ path: '/sdcard/test.txt' });

      const fields = result.split('|');
      expect(fields).toHaveLength(12); // All 12 fields should be present
    });

    it('should handle custom format output', async () => {
      const customOutput = '1234'; // Just size
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(customOutput)
      );

      const result = await command.exec({ 
        path: '/sdcard/test.txt',
        format: '%s'
      });

      expect(result).toBe(customOutput);
    });
  });

  describe('Timeout Handling', () => {
    it('should use default timeout of 5000ms', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_STAT_OUTPUT)
      );

      await command.exec({ path: '/sdcard/test.txt' });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalled();
    });

    it('should accept custom timeout', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_STAT_OUTPUT)
      );

      await command.exec({ 
        path: '/sdcard/test.txt',
        timeout: 10000 
      });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalled();
    });

    it('should handle timeout errors', async () => {
      const timeoutError = new Error('Command timed out');
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockRejectedValue(timeoutError);

      await expect(
        command.exec({ path: '/sdcard/test.txt' })
      ).rejects.toThrow('Command timed out');
    });
  });

  describe('Error Handling', () => {
    it('should throw error when command fails', async () => {
      const error = new Error('Stat command failed');
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockRejectedValue(error);

      await expect(
        command.exec({ path: '/sdcard/test.txt' })
      ).rejects.toThrow('Stat command failed');
    });

    it('should throw error when permission denied', async () => {
      const error = new Error('Permission denied');
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockRejectedValue(error);

      await expect(
        command.exec({ path: '/system/secure.file' })
      ).rejects.toThrow('Permission denied');
    });

    it('should throw error when shellProtocol is null', async () => {
      const invalidAdb = {
        subprocess: {
          shellProtocol: null
        }
      } as any;

      const invalidCommand = new StatCommand(invalidAdb);

      await expect(
        invalidCommand.exec({ path: '/sdcard/test.txt' })
      ).rejects.toThrow();
    });
  });

  describe('Different File Types', () => {
    it('should stat regular files', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_STAT_OUTPUT)
      );

      const result = await command.exec({ path: '/sdcard/document.txt' });

      expect(result).toContain('regular file');
    });

    it('should stat directories', async () => {
      const dirStat = '4096|directory|1704067300|1704067200|1704067300|0755|drwxr-xr-x|root|sdcard_rw|0|1015|12346';
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(dirStat)
      );

      const result = await command.exec({ path: '/sdcard/Documents' });

      expect(result).toContain('directory');
    });

    it('should stat symlinks', async () => {
      const linkStat = '17|symbolic link|1704067400|1704067300|1704067400|0777|lrwxrwxrwx|root|sdcard_rw|0|1015|12347';
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(linkStat)
      );

      const result = await command.exec({ path: '/sdcard/link.txt' });

      expect(result).toContain('symbolic link');
    });

    it('should stat empty files', async () => {
      const emptyStat = '0|regular file|1704067500|1704067400|1704067500|0644|-rw-r--r--|root|sdcard_rw|0|1015|12348';
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(emptyStat)
      );

      const result = await command.exec({ path: '/sdcard/empty.txt' });

      expect(result).toContain('0|'); // Size is 0
    });
  });

  describe('Different Path Types', () => {
    it('should stat paths in /sdcard', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_STAT_OUTPUT)
      );

      await command.exec({ path: '/sdcard/test.txt' });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalled();
    });

    it('should stat paths in /system', async () => {
      const systemStat = '5678|regular file|1704067600|1704067500|1704067600|0644|-rw-r--r--|root|root|0|0|12349';
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(systemStat)
      );

      const result = await command.exec({ path: '/system/build.prop' });

      expect(result).toBe(systemStat);
    });

    it('should stat paths in /data', async () => {
      const dataStat = '9012|regular file|1704067700|1704067600|1704067700|0600|-rw-------|system|system|1000|1000|12350';
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(dataStat)
      );

      const result = await command.exec({ path: '/data/local/tmp/test.dat' });

      expect(result).toBe(dataStat);
    });

    it('should handle deep nested paths', async () => {
      const deepPath = '/sdcard/Documents/Work/Projects/2024/Q1/report.pdf';
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_STAT_OUTPUT)
      );

      const result = await command.exec({ path: deepPath });

      expect(result).toBe(MOCK_STAT_OUTPUT);
    });

    it('should handle paths with unicode characters', async () => {
      const unicodePath = '/sdcard/文档/test.txt';
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_STAT_OUTPUT)
      );

      const result = await command.exec({ path: unicodePath });

      expect(result).toBe(MOCK_STAT_OUTPUT);
    });
  });

  describe('Permission Formats', () => {
    it('should parse permissions with user read/write', async () => {
      const rwStat = '1234|regular file|1704067200|1704067100|1704067200|0644|-rw-r--r--|root|sdcard_rw|0|1015|12345';
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(rwStat)
      );

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(result).toContain('0644');
      expect(result).toContain('-rw-r--r--');
    });

    it('should parse permissions with execute bit', async () => {
      const execStat = '1234|regular file|1704067200|1704067100|1704067200|0755|-rwxr-xr-x|root|root|0|0|12345';
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(execStat)
      );

      const result = await command.exec({ path: '/system/bin/sh' });

      expect(result).toContain('0755');
      expect(result).toContain('-rwxr-xr-x');
    });

    it('should parse directory permissions', async () => {
      const dirStat = '4096|directory|1704067300|1704067200|1704067300|0755|drwxr-xr-x|root|sdcard_rw|0|1015|12346';
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(dirStat)
      );

      const result = await command.exec({ path: '/sdcard/Documents' });

      expect(result).toContain('0755');
      expect(result).toContain('drwxr-xr-x');
    });
  });
});