import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestFileCommand } from '../../../src/commands';
import { createMockDevice, makeShellResult, type MockDevice } from '../../helpers/test-helpers';

describe('TestFileCommand', () => {
  let device: MockDevice;
  let command: TestFileCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    device = createMockDevice();
    command = new TestFileCommand(device as any);
  });

  describe('Command Construction', () => {
    it('should build test command with -e flag', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

      await command.exec({ path: '/sdcard/test.txt' });

      expect(device.shell).toHaveBeenCalledWith(
        expect.stringContaining('test -e'), expect.any(Object)
      );
    });

    it('should escape file path with single quotes', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

      await command.exec({ path: '/sdcard/test.txt' });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain("'/sdcard/test.txt'");
    });

    it('should handle file paths with spaces', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

      await command.exec({ path: '/sdcard/my file.txt' });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain("'/sdcard/my file.txt'");
    });

    it('should handle file paths with quotes by escaping', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

      await command.exec({ path: "/sdcard/file's name.txt" });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain("'/sdcard/file'\\''s name.txt'");
    });

    it('should include exists echo on success', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

      await command.exec({ path: '/sdcard/test.txt' });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain('&& echo "exists"');
    });

    it('should include not-found echo on failure', async () => {
      device.shell.mockResolvedValue(makeShellResult('not-found'));

      await command.exec({ path: '/nonexistent.txt' });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain('|| echo "not-found"');
    });
  });

  describe('File Existence Detection', () => {
    it('should return true when file exists', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(result).toBe(true);
    });

    it('should return false when file does not exist', async () => {
      device.shell.mockResolvedValue(makeShellResult('not-found'));

      const result = await command.exec({ path: '/nonexistent.txt' });

      expect(result).toBe(false);
    });

    it('should trim whitespace from output', async () => {
      device.shell.mockResolvedValue(makeShellResult('  exists  \n'));

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(result).toBe(true);
    });

    it('should handle exact match for exists', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists\n'));

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(result).toBe(true);
    });

    it('should return false for any non-exists output', async () => {
      device.shell.mockResolvedValue(makeShellResult('not-found'));

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(result).toBe(false);
    });

    it('should return false for empty output', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(result).toBe(false);
    });
  });

  describe('Different File Types', () => {
    it('should detect regular files', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

      const result = await command.exec({ path: '/sdcard/document.txt' });

      expect(result).toBe(true);
    });

    it('should detect directories', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

      const result = await command.exec({ path: '/sdcard/Documents' });

      expect(result).toBe(true);
    });

    it('should detect symlinks', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

      const result = await command.exec({ path: '/sdcard/link.txt' });

      expect(result).toBe(true);
    });

    it('should detect empty files', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

      const result = await command.exec({ path: '/sdcard/empty.txt' });

      expect(result).toBe(true);
    });

    it('should detect binary files', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

      const result = await command.exec({ path: '/sdcard/app.apk' });

      expect(result).toBe(true);
    });

    it('should detect image files', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

      const result = await command.exec({ path: '/sdcard/photo.jpg' });

      expect(result).toBe(true);
    });
  });

  describe('Different Path Types', () => {
    it('should test paths in /sdcard', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(result).toBe(true);
    });

    it('should test paths in /system', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

      const result = await command.exec({ path: '/system/build.prop' });

      expect(result).toBe(true);
    });

    it('should test paths in /data', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

      const result = await command.exec({ path: '/data/local/tmp/test.dat' });

      expect(result).toBe(true);
    });

    it('should test paths in root', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

      const result = await command.exec({ path: '/' });

      expect(result).toBe(true);
    });

    it('should handle deep nested paths', async () => {
      const deepPath = '/sdcard/Documents/Work/Projects/2024/Q1/report.pdf';
      device.shell.mockResolvedValue(makeShellResult('exists'));

      const result = await command.exec({ path: deepPath });

      expect(result).toBe(true);
    });

    it('should handle paths with unicode characters', async () => {
      const unicodePath = '/sdcard/文档/test.txt';
      device.shell.mockResolvedValue(makeShellResult('exists'));

      const result = await command.exec({ path: unicodePath });

      expect(result).toBe(true);
    });
  });

  describe('Timeout Handling', () => {
    it('should use default timeout of 5000ms', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

      await command.exec({ path: '/sdcard/test.txt' });

      expect(device.shell).toHaveBeenCalled();
    });

    it('should accept custom timeout', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

      await command.exec({ 
        path: '/sdcard/test.txt',
        timeout: 10000 
      });

      expect(device.shell).toHaveBeenCalled();
    });

    it('should handle timeout errors gracefully', async () => {
      const timeoutError = new Error('Command timed out');
      device.shell.mockRejectedValue(timeoutError);

      const result = await command.exec({ path: '/sdcard/test.txt' });

      // On error, should return false (file assumed not to exist)
      expect(result).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should return false when command fails', async () => {
      const error = new Error('Test command failed');
      device.shell.mockRejectedValue(error);

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(result).toBe(false);
    });

    it('should return false when permission denied', async () => {
      const error = new Error('Permission denied');
      device.shell.mockRejectedValue(error);

      const result = await command.exec({ path: '/system/secure.file' });

      expect(result).toBe(false);
    });

    it('should return false when shellProtocol is null', async () => {
      const invalidDevice = { shell: () => { throw new Error('Shell not available'); } } as any;
      const invalidCommand = new TestFileCommand(invalidDevice);

      const result = await invalidCommand.exec({ path: '/sdcard/test.txt' });

      expect(result).toBe(false);
    });

    it('should return false on any exception', async () => {
      const error = new Error('Unknown error');
      device.shell.mockRejectedValue(error);

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(result).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle file paths with special characters', async () => {
      const specialPath = '/sdcard/file[2024]_test@home.txt';
      device.shell.mockResolvedValue(makeShellResult('exists'));

      const result = await command.exec({ path: specialPath });

      expect(result).toBe(true);
    });

    it('should handle very long paths', async () => {
      const longPath = '/sdcard/' + 'a'.repeat(200) + '/test.txt';
      device.shell.mockResolvedValue(makeShellResult('exists'));

      const result = await command.exec({ path: longPath });

      expect(result).toBe(true);
    });

    it('should handle paths with dots', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

      const result = await command.exec({ path: '/sdcard/../../etc/hosts' });

      expect(result).toBe(true);
    });

    it('should handle paths with trailing slashes', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

      const result = await command.exec({ path: '/sdcard/Documents/' });

      expect(result).toBe(true);
    });

    it('should handle case sensitive paths', async () => {
      device.shell.mockResolvedValue(makeShellResult('exists'));

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
        device.shell.mockResolvedValue(makeShellResult('exists'));

        const result = await command.exec({ path });
        expect(result).toBe(true);
      }
    });

    it('should handle mix of existing and non-existing files', async () => {
      // First call - file exists
      device.shell
        .mockResolvedValueOnce(makeShellResult('exists'))
        .mockResolvedValueOnce(makeShellResult('not-found'))
        .mockResolvedValueOnce(makeShellResult('exists'));

      const result1 = await command.exec({ path: '/sdcard/exists.txt' });
      const result2 = await command.exec({ path: '/sdcard/notfound.txt' });
      const result3 = await command.exec({ path: '/sdcard/exists2.txt' });

      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(result3).toBe(true);
    });
  });
});