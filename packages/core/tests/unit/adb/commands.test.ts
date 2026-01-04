import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ADBCommands } from '../../../src/adb/commands';
import { ADBCommandError } from '../../../src/utils/errors';
import type { Adb } from '@yume-chan/adb';

const mockAdb = {
  subprocess: {
    spawn: vi.fn()
  },
  sync: vi.fn()
} as unknown as Adb;

describe('ADBCommands', () => {
  let commands: ADBCommands;

  beforeEach(() => {
    vi.clearAllMocks();
    commands = new ADBCommands(mockAdb);
  });

  describe('shell', () => {
    it('should execute shell command and return output', async () => {
      const mockProcess = {
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('test output'));
            controller.close();
          }
        }),
        exit: Promise.resolve({ code: 0 })
      };

      (mockAdb.subprocess.spawn as any).mockResolvedValue(mockProcess);

      const result = await commands.shell('echo test');
      expect(result).toBe('test output');
    });

    it('should throw error on command failure', async () => {
      (mockAdb.subprocess.spawn as any).mockRejectedValue(new Error('Command failed'));

      await expect(commands.shell('invalid command')).rejects.toThrow(ADBCommandError);
    });

    it('should handle timeout', async () => {
      const mockProcess = {
        stdout: new ReadableStream({
          start(controller) {
            // Never close the stream to simulate timeout
          }
        }),
        exit: new Promise(() => {}) // Never resolves
      };

      (mockAdb.subprocess.spawn as any).mockResolvedValue(mockProcess);

      await expect(
        commands.shell('long command', { timeout: 100 })
      ).rejects.toThrow('timeout');
    });
  });

  describe('getprop', () => {
    it('should parse getprop output correctly', async () => {
      const mockProcess = {
        stdout: new ReadableStream({
          start(controller) {
            const output = `[ro.build.version.release]: [13]
[ro.product.model]: [Pixel 6]
[ro.product.manufacturer]: [Google]`;
            controller.enqueue(new TextEncoder().encode(output));
            controller.close();
          }
        }),
        exit: Promise.resolve({ code: 0 })
      };

      (mockAdb.subprocess.spawn as any).mockResolvedValue(mockProcess);

      const props = await commands.getprop();

      expect(props['ro.build.version.release']).toBe('13');
      expect(props['ro.product.model']).toBe('Pixel 6');
      expect(props['ro.product.manufacturer']).toBe('Google');
    });

    it('should handle empty values', async () => {
      const mockProcess = {
        stdout: new ReadableStream({
          start(controller) {
            const output = `[ro.empty.prop]: []`;
            controller.enqueue(new TextEncoder().encode(output));
            controller.close();
          }
        }),
        exit: Promise.resolve({ code: 0 })
      };

      (mockAdb.subprocess.spawn as any).mockResolvedValue(mockProcess);

      const props = await commands.getprop();
      expect(props['ro.empty.prop']).toBe('');
    });
  });

  describe('listPackages', () => {
    it('should list all packages', async () => {
      const mockProcess = {
        stdout: new ReadableStream({
          start(controller) {
            const output = `package:com.android.chrome
package:com.whatsapp
package:com.facebook.katana`;
            controller.enqueue(new TextEncoder().encode(output));
            controller.close();
          }
        }),
        exit: Promise.resolve({ code: 0 })
      };

      (mockAdb.subprocess.spawn as any).mockResolvedValue(mockProcess);

      const packages = await commands.listPackages();

      expect(packages).toHaveLength(3);
      expect(packages).toContain('com.android.chrome');
      expect(packages).toContain('com.whatsapp');
    });

    it('should filter third-party apps only', async () => {
      const mockProcess = {
        stdout: new ReadableStream({
          start(controller) {
            const output = `package:com.whatsapp
package:com.facebook.katana`;
            controller.enqueue(new TextEncoder().encode(output));
            controller.close();
          }
        }),
        exit: Promise.resolve({ code: 0 })
      };

      (mockAdb.subprocess.spawn as any).mockResolvedValue(mockProcess);

      const packages = await commands.listPackages({ includeSystem: false });

      expect(packages).toHaveLength(2);
      expect(mockAdb.subprocess.spawn).toHaveBeenCalledWith(
        expect.stringContaining('-3')
      );
    });
  });

  describe('getPackageInfo', () => {
    it('should return package information', async () => {
      const mockProcess = {
        stdout: new ReadableStream({
          start(controller) {
            const output = `versionName=1.0.0
versionCode=100
codePath=/data/app/com.example
firstInstallTime=2024-01-01 12:00:00
lastUpdateTime=2024-01-02 12:00:00`;
            controller.enqueue(new TextEncoder().encode(output));
            controller.close();
          }
        }),
        exit: Promise.resolve({ code: 0 })
      };

      (mockAdb.subprocess.spawn as any).mockResolvedValue(mockProcess);

      const info = await commands.getPackageInfo('com.example');

      expect(info).not.toBeNull();
      expect(info?.versionName).toBe('1.0.0');
      expect(info?.versionCode).toBe('100');
    });

    it('should return null for non-existent package', async () => {
      (mockAdb.subprocess.spawn as any).mockRejectedValue(new Error('Package not found'));

      const info = await commands.getPackageInfo('com.nonexistent');
      expect(info).toBeNull();
    });
  });

  describe('getLogcat', () => {
    it('should get logcat output', async () => {
      const mockProcess = {
        stdout: new ReadableStream({
          start(controller) {
            const output = `01-01 12:00:00.000  1000  1000 I Tag: Log message`;
            controller.enqueue(new TextEncoder().encode(output));
            controller.close();
          }
        }),
        exit: Promise.resolve({ code: 0 })
      };

      (mockAdb.subprocess.spawn as any).mockResolvedValue(mockProcess);

      const logs = await commands.getLogcat();
      expect(logs).toContain('Log message');
    });

    it('should apply filters and options', async () => {
      const mockProcess = {
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('filtered logs'));
            controller.close();
          }
        }),
        exit: Promise.resolve({ code: 0 })
      };

      (mockAdb.subprocess.spawn as any).mockResolvedValue(mockProcess);

      await commands.getLogcat({
        buffer: 'system',
        filter: 'ActivityManager:I',
        maxLines: 100
      });

      expect(mockAdb.subprocess.spawn).toHaveBeenCalledWith(
        expect.stringContaining('-b system')
      );
      expect(mockAdb.subprocess.spawn).toHaveBeenCalledWith(
        expect.stringContaining('ActivityManager:I')
      );
      expect(mockAdb.subprocess.spawn).toHaveBeenCalledWith(
        expect.stringContaining('-t 100')
      );
    });
  });

  describe('readFile and writeFile', () => {
    it('should read file content', async () => {
      const mockContent = new TextEncoder().encode('file content');
      const mockSync = {
        read: vi.fn().mockResolvedValue(mockContent)
      };

      (mockAdb.sync as any).mockResolvedValue(mockSync);

      const content = await commands.readFile('/sdcard/test.txt');

      expect(content).toEqual(mockContent);
      expect(mockSync.read).toHaveBeenCalledWith('/sdcard/test.txt');
    });

    it('should write file content', async () => {
      const mockSync = {
        write: vi.fn().mockResolvedValue(undefined)
      };

      (mockAdb.sync as any).mockResolvedValue(mockSync);

      const content = new TextEncoder().encode('test content');
      await commands.writeFile('/sdcard/test.txt', content);

      expect(mockSync.write).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/sdcard/test.txt',
          file: content
        })
      );
    });

    it('should throw error on file read failure', async () => {
      const mockSync = {
        read: vi.fn().mockRejectedValue(new Error('File not found'))
      };

      (mockAdb.sync as any).mockResolvedValue(mockSync);

      await expect(commands.readFile('/invalid/path')).rejects.toThrow(ADBCommandError);
    });
  });
});