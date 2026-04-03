import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PmCommand } from '../../../src/commands/pmCommand';
import { createMockDevice, makeShellResult, MOCK_PACKAGE_LIST, type MockDevice } from '../../helpers/test-helpers';


describe('PmCommand', () => {
  let device: MockDevice;
  let command: PmCommand;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('exec', () => {
    it('should return raw package list output', async () => {
      device = createMockDevice();
    device.shell.mockResolvedValue(makeShellResult(MOCK_PACKAGE_LIST));
      command = new PmCommand(device as any);

      const result = await command.exec();

      expect(result).toBe(MOCK_PACKAGE_LIST);
      expect(result).toContain('com.android.systemui');
      expect(result).toContain('com.example.app1');
    });

    it('should call pm list packages for all packages', async () => {
      device = createMockDevice();
    device.shell.mockResolvedValue(makeShellResult(MOCK_PACKAGE_LIST));
      command = new PmCommand(device as any);

      await command.exec();

      expect(device.shell).toHaveBeenCalledWith('pm list packages', expect.any(Object));
    });

    it('should list only user packages when includeSystem is false', async () => {
      const userPackagesOutput = `package:com.example.app1\npackage:com.example.app2`;
      device = createMockDevice();
    device.shell.mockResolvedValue(makeShellResult(userPackagesOutput));
      command = new PmCommand(device as any);

      const result = await command.exec({ includeSystem: false });

      expect(result).toBe(userPackagesOutput);
      expect(result).toContain('com.example.app1');
      expect(result).toContain('com.example.app2');
      expect(device.shell).toHaveBeenCalledWith('pm list packages -3', expect.any(Object));
    });

    it('should list all packages when includeSystem is true', async () => {
      device = createMockDevice();
    device.shell.mockResolvedValue(makeShellResult(MOCK_PACKAGE_LIST));
      command = new PmCommand(device as any);

      await command.exec({ includeSystem: true });

      expect(device.shell).toHaveBeenCalledWith('pm list packages', expect.any(Object));
    });

    it('should handle empty package list', async () => {
      device = createMockDevice();
    device.shell.mockResolvedValue(makeShellResult(''));
      command = new PmCommand(device as any);

      const result = await command.exec();

      expect(result).toBe('');
    });

    it('should return raw output with empty lines', async () => {
      const outputWithEmptyLines = `package:com.example.app1\n\npackage:com.example.app2\n\n`;
      device = createMockDevice();
    device.shell.mockResolvedValue(makeShellResult(outputWithEmptyLines));
      command = new PmCommand(device as any);

      const result = await command.exec();

      expect(result).toBe(outputWithEmptyLines);
      expect(result).toContain('com.example.app1');
      expect(result).toContain('com.example.app2');
    });

    it('should return raw output with package: prefix', async () => {
      const output = `package:com.test.app1\npackage:com.test.app2\npackage:com.test.app3`;
      device = createMockDevice();
    device.shell.mockResolvedValue(makeShellResult(output));
      command = new PmCommand(device as any);

      const result = await command.exec();

      expect(result).toBe(output);
      expect(result).toContain('package:com.test.app1');
      expect(result).toContain('package:com.test.app2');
      expect(result).toContain('package:com.test.app3');
    });

    it('should return raw output with whitespace', async () => {
      const outputWithSpaces = `package:com.example.app1   \npackage:  com.example.app2\npackage: com.example.app3 `;
      device = createMockDevice();
    device.shell.mockResolvedValue(makeShellResult(outputWithSpaces));
      command = new PmCommand(device as any);

      const result = await command.exec();

      expect(result).toBe(outputWithSpaces);
      expect(result).toContain('com.example.app1');
      expect(result).toContain('com.example.app2');
      expect(result).toContain('com.example.app3');
    });

    it('should use custom timeout', async () => {
      device = createMockDevice();
    device.shell.mockResolvedValue(makeShellResult(MOCK_PACKAGE_LIST));
      command = new PmCommand(device as any);

      await command.exec({ timeout: 45000 });

      expect(device.shell).toHaveBeenCalledWith('pm list packages', expect.any(Object));
    });

    it('should use default timeout of 30000ms', async () => {
      device = createMockDevice();
    device.shell.mockResolvedValue(makeShellResult(MOCK_PACKAGE_LIST));
      command = new PmCommand(device as any);

      await command.exec();

      expect(device.shell).toHaveBeenCalledWith('pm list packages', expect.any(Object));
    });

    it('should handle large number of packages', async () => {
      const packages = Array.from({ length: 200 }, (_, i) => `package:com.example.app${i}`).join(
        '\\n'
      );
      device = createMockDevice();
    device.shell.mockResolvedValue(makeShellResult(packages));
      command = new PmCommand(device as any);

      const result = await command.exec();

      expect(result).toBe(packages);
      expect(result).toContain('com.example.app0');
      expect(result).toContain('com.example.app199');
    });

    it('should return raw mixed output including non-package lines', async () => {
      const mixedOutput = `package:com.example.app1\\nSome random text\\npackage:com.example.app2\\nError: something happened\\npackage:com.example.app3`;
      device = createMockDevice();
    device.shell.mockResolvedValue(makeShellResult(mixedOutput));
      command = new PmCommand(device as any);

      const result = await command.exec();

      expect(result).toBe(mixedOutput);
      expect(result).toContain('com.example.app1');
      expect(result).toContain('com.example.app2');
      expect(result).toContain('Some random text');
    });

    it('should handle system and Google packages', async () => {
      const systemPackages = `package:com.android.systemui\\npackage:com.android.settings\\npackage:com.google.android.gms\\npackage:com.google.android.gsf`;
      device = createMockDevice();
    device.shell.mockResolvedValue(makeShellResult(systemPackages));
      command = new PmCommand(device as any);

      const result = await command.exec({ includeSystem: true });

      expect(result).toBe(systemPackages);
      expect(result).toContain('com.android.systemui');
      expect(result).toContain('com.android.settings');
      expect(result).toContain('com.google.android.gms');
      expect(result).toContain('com.google.android.gsf');
    });

    it('should handle user-installed apps only', async () => {
      const userApps = `package:com.whatsapp\npackage:com.instagram.android\npackage:com.spotify.music`;
      device = createMockDevice();
    device.shell.mockResolvedValue(makeShellResult(userApps));
      command = new PmCommand(device as any);

      const result = await command.exec({ includeSystem: false });

      expect(result).toBe(userApps);
      expect(result).toContain('com.whatsapp');
      expect(result).toContain('com.instagram.android');
      expect(result).toContain('com.spotify.music');
      expect(device.shell).toHaveBeenCalledWith('pm list packages -3', expect.any(Object));
    });

    it('should return raw output when pm command fails', async () => {
      const failureOutput = 'cmd: Failure';
      device = createMockDevice();
    device.shell.mockResolvedValue(makeShellResult(failureOutput));
      command = new PmCommand(device as any);

      const result = await command.exec();

      expect(result).toBe(failureOutput);
    });

    it('should handle packages with dots and underscores', async () => {
      const packages = `package:com.example.my_app.test\npackage:com.test_company.app.v2\npackage:org.example.app_name`;
      device = createMockDevice();
    device.shell.mockResolvedValue(makeShellResult(packages));
      command = new PmCommand(device as any);

      const result = await command.exec();

      expect(result).toBe(packages);
      expect(result).toContain('com.example.my_app.test');
      expect(result).toContain('com.test_company.app.v2');
      expect(result).toContain('org.example.app_name');
    });

    it('should handle different package name formats', async () => {
      const packages = `package:com.example.app\npackage:io.github.project\npackage:net.sourceforge.app\npackage:org.mozilla.firefox`;
      device = createMockDevice();
    device.shell.mockResolvedValue(makeShellResult(packages));
      command = new PmCommand(device as any);

      const result = await command.exec();

      expect(result).toBe(packages);
      expect(result).toContain('com.example.app');
      expect(result).toContain('io.github.project');
      expect(result).toContain('net.sourceforge.app');
      expect(result).toContain('org.mozilla.firefox');
    });

    it('should combine includeSystem and timeout options', async () => {
      device = createMockDevice();
    device.shell.mockResolvedValue(makeShellResult(MOCK_PACKAGE_LIST));
      command = new PmCommand(device as any);

      await command.exec({ includeSystem: false, timeout: 20000 });

      expect(device.shell).toHaveBeenCalledWith('pm list packages -3', expect.any(Object));
    });
  });
});