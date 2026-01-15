import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ListPackageCommand } from '../../../../src/adb/commands/listPackageCommand';
import type { Adb } from '@yume-chan/adb';
import { createMockAdb, createMockShellSocket, MOCK_PACKAGE_LIST } from './test-helpers';

describe('ListPackageCommand', () => {
  let mockAdb: Adb;
  let command: ListPackageCommand;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('exec', () => {
    it('should list all packages with default options', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_LIST));
      command = new ListPackageCommand(mockAdb);

      const result = await command.exec();

      expect(result).toContain('com.android.systemui');
      expect(result).toContain('com.example.app1');
      expect(result).toContain('com.example.app2');
      expect(result).toContain('com.google.android.gms');
      expect(result).toHaveLength(4);
    });

    it('should call pm list packages for all packages', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_LIST));
      command = new ListPackageCommand(mockAdb);

      await command.exec();

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('pm list packages');
    });

    it('should list only user packages when includeSystem is false', async () => {
      const userPackagesOutput = `package:com.example.app1
package:com.example.app2`;
      mockAdb = createMockAdb(createMockShellSocket(userPackagesOutput));
      command = new ListPackageCommand(mockAdb);

      const result = await command.exec({ includeSystem: false });

      expect(result).toContain('com.example.app1');
      expect(result).toContain('com.example.app2');
      expect(result).toHaveLength(2);
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('pm list packages -3');
    });

    it('should list all packages when includeSystem is true', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_LIST));
      command = new ListPackageCommand(mockAdb);

      await command.exec({ includeSystem: true });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('pm list packages');
    });

    it('should handle empty package list', async () => {
      mockAdb = createMockAdb(createMockShellSocket(''));
      command = new ListPackageCommand(mockAdb);

      const result = await command.exec();

      expect(result).toEqual([]);
    });

    it('should filter out empty lines', async () => {
      const outputWithEmptyLines = `package:com.example.app1

package:com.example.app2

`;
      mockAdb = createMockAdb(createMockShellSocket(outputWithEmptyLines));
      command = new ListPackageCommand(mockAdb);

      const result = await command.exec();

      expect(result).toEqual(['com.example.app1', 'com.example.app2']);
    });

    it('should remove package: prefix from each line', async () => {
      const output = `package:com.test.app1
package:com.test.app2
package:com.test.app3`;
      mockAdb = createMockAdb(createMockShellSocket(output));
      command = new ListPackageCommand(mockAdb);

      const result = await command.exec();

      expect(result[0]).toBe('com.test.app1');
      expect(result[1]).toBe('com.test.app2');
      expect(result[2]).toBe('com.test.app3');
      result.forEach((pkg) => {
        expect(pkg).not.toContain('package:');
      });
    });

    it('should trim whitespace from package names', async () => {
      const outputWithSpaces = `package:com.example.app1   
package:  com.example.app2
package: com.example.app3 `;
      mockAdb = createMockAdb(createMockShellSocket(outputWithSpaces));
      command = new ListPackageCommand(mockAdb);

      const result = await command.exec();

      expect(result).toContain('com.example.app1');
      expect(result).toContain('com.example.app2');
      expect(result).toContain('com.example.app3');
    });

    it('should use custom timeout', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_LIST));
      command = new ListPackageCommand(mockAdb);

      await command.exec({ timeout: 45000 });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('pm list packages');
    });

    it('should use default timeout of 30000ms', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_LIST));
      command = new ListPackageCommand(mockAdb);

      await command.exec();

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('pm list packages');
    });

    it('should handle large number of packages', async () => {
      const packages = Array.from({ length: 200 }, (_, i) => `package:com.example.app${i}`).join(
        '\n'
      );
      mockAdb = createMockAdb(createMockShellSocket(packages));
      command = new ListPackageCommand(mockAdb);

      const result = await command.exec();

      expect(result).toHaveLength(200);
      expect(result[0]).toBe('com.example.app0');
      expect(result[199]).toBe('com.example.app199');
    });

    it('should filter out lines not starting with package:', async () => {
      const mixedOutput = `package:com.example.app1
Some random text
package:com.example.app2
Error: something happened
package:com.example.app3`;
      mockAdb = createMockAdb(createMockShellSocket(mixedOutput));
      command = new ListPackageCommand(mockAdb);

      const result = await command.exec();

      expect(result).toEqual(['com.example.app1', 'com.example.app2', 'com.example.app3']);
      expect(result).not.toContain('Some random text');
      expect(result).not.toContain('Error: something happened');
    });

    it('should handle system and Google packages', async () => {
      const systemPackages = `package:com.android.systemui
package:com.android.settings
package:com.google.android.gms
package:com.google.android.gsf`;
      mockAdb = createMockAdb(createMockShellSocket(systemPackages));
      command = new ListPackageCommand(mockAdb);

      const result = await command.exec({ includeSystem: true });

      expect(result).toContain('com.android.systemui');
      expect(result).toContain('com.android.settings');
      expect(result).toContain('com.google.android.gms');
      expect(result).toContain('com.google.android.gsf');
    });

    it('should handle user-installed apps only', async () => {
      const userApps = `package:com.whatsapp
package:com.instagram.android
package:com.spotify.music`;
      mockAdb = createMockAdb(createMockShellSocket(userApps));
      command = new ListPackageCommand(mockAdb);

      const result = await command.exec({ includeSystem: false });

      expect(result).toContain('com.whatsapp');
      expect(result).toContain('com.instagram.android');
      expect(result).toContain('com.spotify.music');
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('pm list packages -3');
    });

    it('should return empty array when pm command fails gracefully', async () => {
      mockAdb = createMockAdb(createMockShellSocket('cmd: Failure'));
      command = new ListPackageCommand(mockAdb);

      const result = await command.exec();

      expect(result).toEqual([]);
    });

    it('should handle packages with dots and underscores', async () => {
      const packages = `package:com.example.my_app.test
package:com.test_company.app.v2
package:org.example.app_name`;
      mockAdb = createMockAdb(createMockShellSocket(packages));
      command = new ListPackageCommand(mockAdb);

      const result = await command.exec();

      expect(result).toContain('com.example.my_app.test');
      expect(result).toContain('com.test_company.app.v2');
      expect(result).toContain('org.example.app_name');
    });

    it('should handle different package name formats', async () => {
      const packages = `package:com.example.app
package:io.github.project
package:net.sourceforge.app
package:org.mozilla.firefox`;
      mockAdb = createMockAdb(createMockShellSocket(packages));
      command = new ListPackageCommand(mockAdb);

      const result = await command.exec();

      expect(result).toContain('com.example.app');
      expect(result).toContain('io.github.project');
      expect(result).toContain('net.sourceforge.app');
      expect(result).toContain('org.mozilla.firefox');
    });

    it('should combine includeSystem and timeout options', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_LIST));
      command = new ListPackageCommand(mockAdb);

      await command.exec({ includeSystem: false, timeout: 20000 });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('pm list packages -3');
    });
  });
});
