import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PmCommand } from '../../../../src/adb/commands/pmCommand';
import type { Adb } from '@yume-chan/adb';
import { createMockAdb, createMockShellSocket, MOCK_PACKAGE_LIST } from '../../../helpers/test-helpers';


describe('PmCommand', () => {
  let mockAdb: Adb;
  let command: PmCommand;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('exec', () => {
    it('should return raw package list output', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_LIST));
      command = new PmCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe(MOCK_PACKAGE_LIST);
      expect(result).toContain('com.android.systemui');
      expect(result).toContain('com.example.app1');
    });

    it('should call pm list packages for all packages', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_LIST));
      command = new PmCommand(mockAdb);

      await command.exec();

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('pm list packages');
    });

    it('should list only user packages when includeSystem is false', async () => {
      const userPackagesOutput = `package:com.example.app1\npackage:com.example.app2`;
      mockAdb = createMockAdb(createMockShellSocket(userPackagesOutput));
      command = new PmCommand(mockAdb);

      const result = await command.exec({ includeSystem: false });

      expect(result).toBe(userPackagesOutput);
      expect(result).toContain('com.example.app1');
      expect(result).toContain('com.example.app2');
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('pm list packages -3');
    });

    it('should list all packages when includeSystem is true', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_LIST));
      command = new PmCommand(mockAdb);

      await command.exec({ includeSystem: true });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('pm list packages');
    });

    it('should handle empty package list', async () => {
      mockAdb = createMockAdb(createMockShellSocket(''));
      command = new PmCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe('');
    });

    it('should return raw output with empty lines', async () => {
      const outputWithEmptyLines = `package:com.example.app1\n\npackage:com.example.app2\n\n`;
      mockAdb = createMockAdb(createMockShellSocket(outputWithEmptyLines));
      command = new PmCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe(outputWithEmptyLines);
      expect(result).toContain('com.example.app1');
      expect(result).toContain('com.example.app2');
    });

    it('should return raw output with package: prefix', async () => {
      const output = `package:com.test.app1\npackage:com.test.app2\npackage:com.test.app3`;
      mockAdb = createMockAdb(createMockShellSocket(output));
      command = new PmCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe(output);
      expect(result).toContain('package:com.test.app1');
      expect(result).toContain('package:com.test.app2');
      expect(result).toContain('package:com.test.app3');
    });

    it('should return raw output with whitespace', async () => {
      const outputWithSpaces = `package:com.example.app1   \npackage:  com.example.app2\npackage: com.example.app3 `;
      mockAdb = createMockAdb(createMockShellSocket(outputWithSpaces));
      command = new PmCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe(outputWithSpaces);
      expect(result).toContain('com.example.app1');
      expect(result).toContain('com.example.app2');
      expect(result).toContain('com.example.app3');
    });

    it('should use custom timeout', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_LIST));
      command = new PmCommand(mockAdb);

      await command.exec({ timeout: 45000 });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('pm list packages');
    });

    it('should use default timeout of 30000ms', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_LIST));
      command = new PmCommand(mockAdb);

      await command.exec();

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('pm list packages');
    });

    it('should handle large number of packages', async () => {
      const packages = Array.from({ length: 200 }, (_, i) => `package:com.example.app${i}`).join(
        '\\n'
      );
      mockAdb = createMockAdb(createMockShellSocket(packages));
      command = new PmCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe(packages);
      expect(result).toContain('com.example.app0');
      expect(result).toContain('com.example.app199');
    });

    it('should return raw mixed output including non-package lines', async () => {
      const mixedOutput = `package:com.example.app1\\nSome random text\\npackage:com.example.app2\\nError: something happened\\npackage:com.example.app3`;
      mockAdb = createMockAdb(createMockShellSocket(mixedOutput));
      command = new PmCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe(mixedOutput);
      expect(result).toContain('com.example.app1');
      expect(result).toContain('com.example.app2');
      expect(result).toContain('Some random text');
    });

    it('should handle system and Google packages', async () => {
      const systemPackages = `package:com.android.systemui\\npackage:com.android.settings\\npackage:com.google.android.gms\\npackage:com.google.android.gsf`;
      mockAdb = createMockAdb(createMockShellSocket(systemPackages));
      command = new PmCommand(mockAdb);

      const result = await command.exec({ includeSystem: true });

      expect(result).toBe(systemPackages);
      expect(result).toContain('com.android.systemui');
      expect(result).toContain('com.android.settings');
      expect(result).toContain('com.google.android.gms');
      expect(result).toContain('com.google.android.gsf');
    });

    it('should handle user-installed apps only', async () => {
      const userApps = `package:com.whatsapp\npackage:com.instagram.android\npackage:com.spotify.music`;
      mockAdb = createMockAdb(createMockShellSocket(userApps));
      command = new PmCommand(mockAdb);

      const result = await command.exec({ includeSystem: false });

      expect(result).toBe(userApps);
      expect(result).toContain('com.whatsapp');
      expect(result).toContain('com.instagram.android');
      expect(result).toContain('com.spotify.music');
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('pm list packages -3');
    });

    it('should return raw output when pm command fails', async () => {
      const failureOutput = 'cmd: Failure';
      mockAdb = createMockAdb(createMockShellSocket(failureOutput));
      command = new PmCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe(failureOutput);
    });

    it('should handle packages with dots and underscores', async () => {
      const packages = `package:com.example.my_app.test\npackage:com.test_company.app.v2\npackage:org.example.app_name`;
      mockAdb = createMockAdb(createMockShellSocket(packages));
      command = new PmCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe(packages);
      expect(result).toContain('com.example.my_app.test');
      expect(result).toContain('com.test_company.app.v2');
      expect(result).toContain('org.example.app_name');
    });

    it('should handle different package name formats', async () => {
      const packages = `package:com.example.app\npackage:io.github.project\npackage:net.sourceforge.app\npackage:org.mozilla.firefox`;
      mockAdb = createMockAdb(createMockShellSocket(packages));
      command = new PmCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe(packages);
      expect(result).toContain('com.example.app');
      expect(result).toContain('io.github.project');
      expect(result).toContain('net.sourceforge.app');
      expect(result).toContain('org.mozilla.firefox');
    });

    it('should combine includeSystem and timeout options', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_LIST));
      command = new PmCommand(mockAdb);

      await command.exec({ includeSystem: false, timeout: 20000 });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('pm list packages -3');
    });
  });
});
