import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FindCommand } from '../../../src/commands/findCommand';
import { createMockDevice, makeShellResult, type MockDevice } from '../../helpers/test-helpers';

describe('FindCommand', () => {
  let device: MockDevice;
  let command: FindCommand;

  // Mock find output (file list)
  const SAMPLE_FIND_OUTPUT = `/sdcard/Documents/test1.txt
/sdcard/Documents/test2.txt
/sdcard/Pictures/photo.jpg`;

  beforeEach(() => {
    vi.clearAllMocks();
    device = createMockDevice();
    command = new FindCommand(device as any);
  });

  describe('Command Construction', () => {
    it('should build basic find command with default type (files)', async () => {
      device.shell.mockResolvedValue(makeShellResult(SAMPLE_FIND_OUTPUT));

      await command.exec({ path: '/sdcard' });

      expect(device.shell).toHaveBeenCalledWith(expect.stringContaining('find'), expect.any(Object));
    });

    it('should include path in command', async () => {
      device.shell.mockResolvedValue(makeShellResult(SAMPLE_FIND_OUTPUT));

      await command.exec({ path: '/sdcard/Documents' });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain('/sdcard/Documents');
    });

    it('should escape path with single quotes', async () => {
      device.shell.mockResolvedValue(makeShellResult(SAMPLE_FIND_OUTPUT));

      await command.exec({ path: '/sdcard/test' });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain("'/sdcard/test'");
    });

    it('should handle paths with spaces', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ path: '/sdcard/my folder' });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain("'/sdcard/my folder'");
    });

    it('should handle paths with quotes by escaping', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ path: "/sdcard/folder's name" });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain("'/sdcard/folder'\\''s name'");
    });

    it('should include type flag for files', async () => {
      device.shell.mockResolvedValue(makeShellResult(SAMPLE_FIND_OUTPUT));

      await command.exec({ path: '/sdcard', type: 'f' });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain('-type f');
    });

    it('should include type flag for directories', async () => {
      device.shell.mockResolvedValue(makeShellResult('/sdcard/Documents\n/sdcard/Pictures'));

      await command.exec({ path: '/sdcard', type: 'd' });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain('-type d');
    });

    it('should include type flag for symlinks', async () => {
      device.shell.mockResolvedValue(makeShellResult('/sdcard/link'));

      await command.exec({ path: '/sdcard', type: 'l' });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain('-type l');
    });

    it('should include name filter when provided', async () => {
      device.shell.mockResolvedValue(makeShellResult('/sdcard/test.txt'));

      await command.exec({ path: '/sdcard', name: '*.txt' });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain('-name');
      expect(spawnCall).toContain('*.txt');
    });

    it('should escape name filter', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ path: '/sdcard', name: "test's file.txt" });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain("'test'\\''s file.txt'");
    });

    it('should include maxDepth when provided', async () => {
      device.shell.mockResolvedValue(makeShellResult(SAMPLE_FIND_OUTPUT));

      await command.exec({ path: '/sdcard', maxDepth: 2 });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain('-maxdepth 2');
    });

    it('should include maxDepth of 1 for shallow search', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ path: '/sdcard', maxDepth: 1 });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain('-maxdepth 1');
    });

    it('should include exclude paths', async () => {
      device.shell.mockResolvedValue(makeShellResult(SAMPLE_FIND_OUTPUT));

      await command.exec({
        path: '/sdcard',
        excludePaths: ['/proc', '/sys']
      });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain("! -path '/proc/*'");
      expect(spawnCall).toContain("! -path '/sys/*'");
    });

    it('should include single exclude path', async () => {
      device.shell.mockResolvedValue(makeShellResult(SAMPLE_FIND_OUTPUT));

      await command.exec({
        path: '/sdcard',
        excludePaths: ['/proc']
      });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain("! -path '/proc/*'");
    });

    it('should redirect stderr to /dev/null', async () => {
      device.shell.mockResolvedValue(makeShellResult(SAMPLE_FIND_OUTPUT));

      await command.exec({ path: '/sdcard' });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain('2>/dev/null');
    });

    it('should include empty string fallback', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({ path: '/sdcard' });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain('|| echo ""');
    });

    it('should build command with all options combined', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      await command.exec({
        path: '/sdcard',
        type: 'f',
        name: '*.txt',
        maxDepth: 3,
        excludePaths: ['/proc', '/sys']
      });

      const spawnCall = (device.shell as any).mock.calls[0][0];
      expect(spawnCall).toContain('find');
      expect(spawnCall).toContain('/sdcard');
      expect(spawnCall).toContain("! -path '/proc/*'");
      expect(spawnCall).toContain("! -path '/sys/*'");
      expect(spawnCall).toContain('-maxdepth 3');
      expect(spawnCall).toContain('-type f');
      expect(spawnCall).toContain('-name');
      expect(spawnCall).toContain('*.txt');
    });
  });

  describe('Output Handling', () => {
    it('should return list of files', async () => {
      device.shell.mockResolvedValue(makeShellResult(SAMPLE_FIND_OUTPUT));

      const result = await command.exec({ path: '/sdcard' });

      expect(result).toBe(SAMPLE_FIND_OUTPUT);
      expect(typeof result).toBe('string');
    });

    it('should return empty string when no files found', async () => {
      device.shell.mockResolvedValue(makeShellResult(''));

      const result = await command.exec({ path: '/nonexistent' });

      expect(result).toBe('');
    });

    it('should preserve newlines in output', async () => {
      const multilineOutput = `/sdcard/file1.txt
/sdcard/file2.txt
/sdcard/file3.txt`;
      device.shell.mockResolvedValue(makeShellResult(multilineOutput));

      const result = await command.exec({ path: '/sdcard' });

      expect(result).toBe(multilineOutput);
      expect(result.split('\n')).toHaveLength(3);
    });

    it('should handle single file result', async () => {
      const singleFile = '/sdcard/test.txt';
      device.shell.mockResolvedValue(makeShellResult(singleFile));

      const result = await command.exec({ path: '/sdcard', name: 'test.txt' });

      expect(result).toBe(singleFile);
    });

    it('should handle large result sets', async () => {
      const largeOutput = Array(1000).fill(0).map((_, i) => `/sdcard/file${i}.txt`).join('\n');
      device.shell.mockResolvedValue(makeShellResult(largeOutput));

      const result = await command.exec({ path: '/sdcard' });

      expect(result).toBe(largeOutput);
      expect(result.split('\n')).toHaveLength(1000);
    });

    it('should preserve file paths with spaces', async () => {
      const outputWithSpaces = `/sdcard/my file.txt
/sdcard/another file.doc`;
      device.shell.mockResolvedValue(makeShellResult(outputWithSpaces));

      const result = await command.exec({ path: '/sdcard' });

      expect(result).toContain('my file.txt');
      expect(result).toContain('another file.doc');
    });

    it('should preserve file paths with unicode characters', async () => {
      const outputWithUnicode = `/sdcard/文档/test.txt
/sdcard/фото/image.jpg`;
      device.shell.mockResolvedValue(makeShellResult(outputWithUnicode));

      const result = await command.exec({ path: '/sdcard' });

      expect(result).toContain('文档');
      expect(result).toContain('фото');
    });
  });

  describe('Search Types', () => {
    it('should find only files when type is f', async () => {
      const filesOnly = `/sdcard/file1.txt
/sdcard/file2.jpg`;
      device.shell.mockResolvedValue(makeShellResult(filesOnly));

      const result = await command.exec({ path: '/sdcard', type: 'f' });

      expect(result).toBe(filesOnly);
    });

    it('should find only directories when type is d', async () => {
      const dirsOnly = `/sdcard/Documents
/sdcard/Pictures
/sdcard/Downloads`;
      device.shell.mockResolvedValue(makeShellResult(dirsOnly));

      const result = await command.exec({ path: '/sdcard', type: 'd' });

      expect(result).toBe(dirsOnly);
    });

    it('should find only symlinks when type is l', async () => {
      const linksOnly = `/sdcard/link1
/sdcard/link2`;
      device.shell.mockResolvedValue(makeShellResult(linksOnly));

      const result = await command.exec({ path: '/sdcard', type: 'l' });

      expect(result).toBe(linksOnly);
    });
  });

  describe('Name Filtering', () => {
    it('should filter by exact filename', async () => {
      device.shell.mockResolvedValue(makeShellResult('/sdcard/test.txt'));

      const result = await command.exec({ path: '/sdcard', name: 'test.txt' });

      expect(result).toContain('test.txt');
    });

    it('should filter by wildcard pattern', async () => {
      const txtFiles = `/sdcard/file1.txt
/sdcard/file2.txt
/sdcard/file3.txt`;
      device.shell.mockResolvedValue(makeShellResult(txtFiles));

      const result = await command.exec({ path: '/sdcard', name: '*.txt' });

      expect(result).toBe(txtFiles);
    });

    it('should filter by prefix pattern', async () => {
      const prefixFiles = `/sdcard/IMG_001.jpg
/sdcard/IMG_002.jpg`;
      device.shell.mockResolvedValue(makeShellResult(prefixFiles));

      const result = await command.exec({ path: '/sdcard', name: 'IMG_*' });

      expect(result).toBe(prefixFiles);
    });
  });

  describe('Depth Limiting', () => {
    it('should limit search to maxDepth 1 (current directory only)', async () => {
      const shallowResults = `/sdcard/file1.txt
/sdcard/file2.txt`;
      device.shell.mockResolvedValue(makeShellResult(shallowResults));

      const result = await command.exec({ path: '/sdcard', maxDepth: 1 });

      expect(result).toBe(shallowResults);
    });

    it('should limit search to maxDepth 2 (one level deep)', async () => {
      const mediumDepth = `/sdcard/file.txt
/sdcard/Documents/doc.txt`;
      device.shell.mockResolvedValue(makeShellResult(mediumDepth));

      const result = await command.exec({ path: '/sdcard', maxDepth: 2 });

      expect(result).toBe(mediumDepth);
    });

    it('should search deeply when maxDepth not specified', async () => {
      const deepResults = `/sdcard/a/b/c/d/file.txt
/sdcard/x/y/z/file2.txt`;
      device.shell.mockResolvedValue(makeShellResult(deepResults));

      const result = await command.exec({ path: '/sdcard' });

      expect(result).toBe(deepResults);
    });
  });

  describe('Path Exclusion', () => {
    it('should exclude single path', async () => {
      const filteredResults = `/sdcard/file1.txt
/sdcard/file2.txt`;
      device.shell.mockResolvedValue(makeShellResult(filteredResults));

      const result = await command.exec({
        path: '/sdcard',
        excludePaths: ['/sdcard/.trash']
      });

      expect(result).not.toContain('.trash');
    });

    it('should exclude multiple paths', async () => {
      const filteredResults = `/sdcard/file.txt`;
      device.shell.mockResolvedValue(makeShellResult(filteredResults));

      const result = await command.exec({
        path: '/sdcard',
        excludePaths: ['/proc', '/sys', '/dev']
      });

      expect(result).toBe(filteredResults);
    });

    it('should work without excludePaths', async () => {
      device.shell.mockResolvedValue(makeShellResult(SAMPLE_FIND_OUTPUT));

      const result = await command.exec({ path: '/sdcard' });

      expect(result).toBe(SAMPLE_FIND_OUTPUT);
    });

    it('should work with empty excludePaths array', async () => {
      device.shell.mockResolvedValue(makeShellResult(SAMPLE_FIND_OUTPUT));

      const result = await command.exec({
        path: '/sdcard',
        excludePaths: []
      });

      expect(result).toBe(SAMPLE_FIND_OUTPUT);
    });
  });

  describe('Timeout Handling', () => {
    it('should use default timeout of 120000ms', async () => {
      device.shell.mockResolvedValue(makeShellResult(SAMPLE_FIND_OUTPUT));

      await command.exec({ path: '/sdcard' });

      expect(device.shell).toHaveBeenCalled();
    });

    it('should accept custom timeout', async () => {
      device.shell.mockResolvedValue(makeShellResult(SAMPLE_FIND_OUTPUT));

      await command.exec({
        path: '/sdcard',
        timeout: 60000
      });

      expect(device.shell).toHaveBeenCalled();
    });

    it('should handle timeout errors', async () => {
      const timeoutError = new Error('Command timed out');
      device.shell.mockRejectedValue(timeoutError);

      await expect(
        command.exec({ path: '/sdcard' })
      ).rejects.toThrow('Command timed out');
    });
  });

  describe('Error Handling', () => {
    it('should throw error when command fails', async () => {
      const error = new Error('Find command failed');
      device.shell.mockRejectedValue(error);

      await expect(
        command.exec({ path: '/sdcard' })
      ).rejects.toThrow('Find command failed');
    });

    it('should throw error when permission denied', async () => {
      const error = new Error('Permission denied');
      device.shell.mockRejectedValue(error);

      await expect(
        command.exec({ path: '/system/secure' })
      ).rejects.toThrow('Permission denied');
    });

    it('should throw error when path does not exist', async () => {
      const error = new Error('No such file or directory');
      device.shell.mockRejectedValue(error);

      await expect(
        command.exec({ path: '/nonexistent/path' })
      ).rejects.toThrow('No such file or directory');
    });

    it('should throw error when shellProtocol is null', async () => {
      const invalidDevice = { shell: () => { throw new Error('Shell not available'); } } as any;
      const invalidCommand = new FindCommand(invalidDevice);

      await expect(
        invalidCommand.exec({ path: '/sdcard' })
      ).rejects.toThrow();
    });
  });

  describe('Different Path Types', () => {
    it('should search in /sdcard', async () => {
      device.shell.mockResolvedValue(makeShellResult(SAMPLE_FIND_OUTPUT));

      const result = await command.exec({ path: '/sdcard' });

      expect(result).toBe(SAMPLE_FIND_OUTPUT);
    });

    it('should search in /system', async () => {
      const systemFiles = `/system/app/Calculator.apk
/system/app/Settings.apk`;
      device.shell.mockResolvedValue(makeShellResult(systemFiles));

      const result = await command.exec({ path: '/system/app' });

      expect(result).toBe(systemFiles);
    });

    it('should search in /data', async () => {
      const dataFiles = `/data/local/tmp/test.txt
/data/local/tmp/script.sh`;
      device.shell.mockResolvedValue(makeShellResult(dataFiles));

      const result = await command.exec({ path: '/data/local/tmp' });

      expect(result).toBe(dataFiles);
    });

    it('should search in root directory', async () => {
      const rootDirs = `/sdcard
/system
/data`;
      device.shell.mockResolvedValue(makeShellResult(rootDirs));

      const result = await command.exec({ path: '/', type: 'd', maxDepth: 1 });

      expect(result).toBe(rootDirs);
    });

    it('should handle deep nested paths', async () => {
      const deepPath = '/sdcard/Documents/Work/Projects/2024/Q1';
      const deepFiles = `${deepPath}/report.pdf
${deepPath}/data.xlsx`;
      device.shell.mockResolvedValue(makeShellResult(deepFiles));

      const result = await command.exec({ path: deepPath });

      expect(result).toBe(deepFiles);
    });
  });

  describe('Real World Scenarios', () => {
    it('should find all images in DCIM', async () => {
      const images = `/sdcard/DCIM/Camera/IMG_001.jpg
/sdcard/DCIM/Camera/IMG_002.jpg
/sdcard/DCIM/Camera/IMG_003.jpg`;
      device.shell.mockResolvedValue(makeShellResult(images));

      const result = await command.exec({
        path: '/sdcard/DCIM',
        name: '*.jpg',
        type: 'f'
      });

      expect(result).toBe(images);
    });

    it('should find APK files excluding system paths', async () => {
      const userApks = `/sdcard/Download/app.apk`;
      device.shell.mockResolvedValue(makeShellResult(userApks));

      const result = await command.exec({
        path: '/sdcard',
        name: '*.apk',
        type: 'f',
        excludePaths: ['/system', '/vendor']
      });

      expect(result).toBe(userApks);
    });

    it('should find all directories at top level', async () => {
      const topDirs = `/sdcard/Documents
/sdcard/Pictures
/sdcard/Downloads
/sdcard/DCIM`;
      device.shell.mockResolvedValue(makeShellResult(topDirs));

      const result = await command.exec({
        path: '/sdcard',
        type: 'd',
        maxDepth: 1
      });

      expect(result).toBe(topDirs);
    });

    it('should find log files excluding certain directories', async () => {
      const logs = `/data/log/system.log
/data/log/kernel.log`;
      device.shell.mockResolvedValue(makeShellResult(logs));

      const result = await command.exec({
        path: '/data',
        name: '*.log',
        type: 'f',
        excludePaths: ['/proc', '/sys']
      });

      expect(result).toBe(logs);
    });
  });
});