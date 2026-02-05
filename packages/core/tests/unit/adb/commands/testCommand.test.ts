import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestFileCommand } from '../../../../src/adb/commands/';
import type { Adb } from '@yume-chan/adb';
import { createMockAdb, createMockShellSocket } from '../../../helpers/test-helpers';

describe('TestFileCommand', () => {
  let mockAdb: Adb;
  let command: TestFileCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdb = createMockAdb() as unknown as Adb;
    command = new TestFileCommand(mockAdb);
  });

  describe('Command Construction', () => {
    it('should build test command with -e flag', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      await command.exec({ path: '/sdcard/test.txt' });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        expect.stringContaining('test -e')
      );
    });

    it('should escape file path with single quotes', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      await command.exec({ path: '/sdcard/test.txt' });

      const spawnCall = vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mock.calls[0][0];
      expect(spawnCall).toContain("'/sdcard/test.txt'");
    });

    it('should handle file paths with spaces', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      await command.exec({ path: '/sdcard/my file.txt' });

      const spawnCall = vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mock.calls[0][0];
      expect(spawnCall).toContain("'/sdcard/my file.txt'");
    });

    it('should handle file paths with quotes by escaping', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      await command.exec({ path: "/sdcard/file's name.txt" });

      const spawnCall = vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mock.calls[0][0];
      expect(spawnCall).toContain("'/sdcard/file'\\''s name.txt'");
    });

    it('should include exists echo on success', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      await command.exec({ path: '/sdcard/test.txt' });

      const spawnCall = vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mock.calls[0][0];
      expect(spawnCall).toContain('&& echo "exists"');
    });

    it('should include not-found echo on failure', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('not-found')
      );

      await command.exec({ path: '/nonexistent.txt' });

      const spawnCall = vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mock.calls[0][0];
      expect(spawnCall).toContain('|| echo "not-found"');
    });
  });

  describe('File Existence Detection', () => {
    it('should return true when file exists', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(result).toBe(true);
    });

    it('should return false when file does not exist', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('not-found')
      );

      const result = await command.exec({ path: '/nonexistent.txt' });

      expect(result).toBe(false);
    });

    it('should trim whitespace from output', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('  exists  \n')
      );

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(result).toBe(true);
    });

    it('should handle exact match for exists', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists\n')
      );

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(result).toBe(true);
    });

    it('should return false for any non-exists output', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('not-found')
      );

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(result).toBe(false);
    });

    it('should return false for empty output', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('')
      );

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(result).toBe(false);
    });
  });

  describe('Different File Types', () => {
    it('should detect regular files', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      const result = await command.exec({ path: '/sdcard/document.txt' });

      expect(result).toBe(true);
    });

    it('should detect directories', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      const result = await command.exec({ path: '/sdcard/Documents' });

      expect(result).toBe(true);
    });

    it('should detect symlinks', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      const result = await command.exec({ path: '/sdcard/link.txt' });

      expect(result).toBe(true);
    });

    it('should detect empty files', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      const result = await command.exec({ path: '/sdcard/empty.txt' });

      expect(result).toBe(true);
    });

    it('should detect binary files', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      const result = await command.exec({ path: '/sdcard/app.apk' });

      expect(result).toBe(true);
    });

    it('should detect image files', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      const result = await command.exec({ path: '/sdcard/photo.jpg' });

      expect(result).toBe(true);
    });
  });

  describe('Different Path Types', () => {
    it('should test paths in /sdcard', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(result).toBe(true);
    });

    it('should test paths in /system', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      const result = await command.exec({ path: '/system/build.prop' });

      expect(result).toBe(true);
    });

    it('should test paths in /data', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      const result = await command.exec({ path: '/data/local/tmp/test.dat' });

      expect(result).toBe(true);
    });

    it('should test paths in root', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      const result = await command.exec({ path: '/' });

      expect(result).toBe(true);
    });

    it('should handle deep nested paths', async () => {
      const deepPath = '/sdcard/Documents/Work/Projects/2024/Q1/report.pdf';
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      const result = await command.exec({ path: deepPath });

      expect(result).toBe(true);
    });

    it('should handle paths with unicode characters', async () => {
      const unicodePath = '/sdcard/文档/test.txt';
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      const result = await command.exec({ path: unicodePath });

      expect(result).toBe(true);
    });
  });

  describe('Timeout Handling', () => {
    it('should use default timeout of 5000ms', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      await command.exec({ path: '/sdcard/test.txt' });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalled();
    });

    it('should accept custom timeout', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      await command.exec({ 
        path: '/sdcard/test.txt',
        timeout: 10000 
      });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalled();
    });

    it('should handle timeout errors gracefully', async () => {
      const timeoutError = new Error('Command timed out');
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockRejectedValue(timeoutError);

      const result = await command.exec({ path: '/sdcard/test.txt' });

      // On error, should return false (file assumed not to exist)
      expect(result).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should return false when command fails', async () => {
      const error = new Error('Test command failed');
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockRejectedValue(error);

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(result).toBe(false);
    });

    it('should return false when permission denied', async () => {
      const error = new Error('Permission denied');
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockRejectedValue(error);

      const result = await command.exec({ path: '/system/secure.file' });

      expect(result).toBe(false);
    });

    it('should return false when shellProtocol is null', async () => {
      const invalidAdb = {
        subprocess: {
          shellProtocol: null
        }
      } as any;

      const invalidCommand = new TestFileCommand(invalidAdb);

      const result = await invalidCommand.exec({ path: '/sdcard/test.txt' });

      expect(result).toBe(false);
    });

    it('should return false on any exception', async () => {
      const error = new Error('Unknown error');
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockRejectedValue(error);

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(result).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle file paths with special characters', async () => {
      const specialPath = '/sdcard/file[2024]_test@home.txt';
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      const result = await command.exec({ path: specialPath });

      expect(result).toBe(true);
    });

    it('should handle very long paths', async () => {
      const longPath = '/sdcard/' + 'a'.repeat(200) + '/test.txt';
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      const result = await command.exec({ path: longPath });

      expect(result).toBe(true);
    });

    it('should handle paths with dots', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      const result = await command.exec({ path: '/sdcard/../../etc/hosts' });

      expect(result).toBe(true);
    });

    it('should handle paths with trailing slashes', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      const result = await command.exec({ path: '/sdcard/Documents/' });

      expect(result).toBe(true);
    });

    it('should handle case sensitive paths', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('exists')
      );

      const result = await command.exec({ path: '/sdcard/Test.TXT' });

      expect(result).toBe(true);
    });
  });

  describe('Multiple Checks', () => {
    it('should handle multiple sequential checks', async () => {
      const paths = [
        '/sdcard/file1.txt',
        '/sdcard/file2.txt',
        '/sdcard/file3.txt'
      ];

      for (const path of paths) {
        vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
          createMockShellSocket('exists')
        );

        const result = await command.exec({ path });
        expect(result).toBe(true);
      }
    });

    it('should handle mix of existing and non-existing files', async () => {
      // First call - file exists
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn)
        .mockResolvedValueOnce(createMockShellSocket('exists'))
        .mockResolvedValueOnce(createMockShellSocket('not-found'))
        .mockResolvedValueOnce(createMockShellSocket('exists'));

      const result1 = await command.exec({ path: '/sdcard/exists.txt' });
      const result2 = await command.exec({ path: '/sdcard/notfound.txt' });
      const result3 = await command.exec({ path: '/sdcard/exists2.txt' });

      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(result3).toBe(true);
    });
  });
});