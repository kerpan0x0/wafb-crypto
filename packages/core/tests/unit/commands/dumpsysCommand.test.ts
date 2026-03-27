/**
 * @file dumpsysCommand.test.ts
 * @description Tests for DumpsysCommand (exec() and service discovery only)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DumpsysCommand } from '../../../src/commands/dumpsysCommand';
import { createMockDevice, makeShellResult, type MockDevice } from '../../helpers/test-helpers';

// Mock data constants
const MOCK_BATTERY_OUTPUT = `Current Battery Service state:
  AC powered: false
  USB powered: true
  level: 85
  scale: 100
  temperature: 350
  technology: Li-ion`;

const MOCK_PACKAGE_OUTPUT = `Packages:
  Package [com.example.app] (12345678):
    userId=10123
    versionCode=100 minSdk=21 targetSdk=33
    versionName=1.0.0`;

const MOCK_MEMINFO_OUTPUT = `Total RAM: 8192 MB
Free RAM: 4096 MB`;

const MOCK_SERVICES_LIST = `activity
alarm
battery
package
wifi
sensorservice`;

const MOCK_ACTIVITY_OUTPUT = `ACTIVITY MANAGER ACTIVITIES
  Stack #1:
    Running activities:
      TaskRecord{abc123 #1 A=com.example.app}`;

describe('DumpsysCommand', () => {
  let device: MockDevice;
  let command: DumpsysCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    device = createMockDevice();
    command = new DumpsysCommand(device as any);
  });

  describe('Constructor', () => {
    it('should create instance with Adb', () => {
      expect(command).toBeInstanceOf(DumpsysCommand);
    });
  });

  describe('exec() - Basic Execution', () => {
    it('should execute dumpsys with service', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_BATTERY_OUTPUT));

      const output = await command.exec({ service: 'battery' });

      expect(output).toBe(MOCK_BATTERY_OUTPUT);
      expect(device.shell).toHaveBeenCalledWith('dumpsys battery', expect.any(Object));
    });

    it('should execute dumpsys without service (plain dumpsys)', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_SERVICES_LIST));

      const output = await command.exec({});

      expect(output).toBe(MOCK_SERVICES_LIST);
      expect(device.shell).toHaveBeenCalledWith('dumpsys', expect.any(Object));
    });

    it('should execute dumpsys with service and package name', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_PACKAGE_OUTPUT));

      const output = await command.exec({
        service: 'package',
        packageName: 'com.example.app'
      });

      expect(output).toBe(MOCK_PACKAGE_OUTPUT);
      expect(device.shell).toHaveBeenCalledWith('dumpsys package com.example.app', expect.any(Object));
    });

    it('should execute dumpsys with service and args', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_ACTIVITY_OUTPUT));

      const output = await command.exec({
        service: 'activity',
        args: ['activities', 'top']
      });

      expect(output).toBe(MOCK_ACTIVITY_OUTPUT);
      expect(device.shell).toHaveBeenCalledWith('dumpsys activity activities top', expect.any(Object));
    });

    it('should execute dumpsys with all parameters', async () => {
      device.shell.mockResolvedValue(makeShellResult('output'));

      await command.exec({
        service: 'batterystats',
        packageName: 'com.example.app',
        args: ['--charged']
      });

      expect(device.shell).toHaveBeenCalledWith('dumpsys batterystats com.example.app --charged', expect.any(Object));
    });

    it('should use custom timeout', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_BATTERY_OUTPUT));

      await command.exec({ service: 'battery', timeout: 5000 });

      expect(device.shell).toHaveBeenCalled();
    });

    it('should use default timeout of 30000ms', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_BATTERY_OUTPUT));

      await command.exec({ service: 'battery' });

      expect(device.shell).toHaveBeenCalled();
    });
  });

  describe('exec() - Error Handling', () => {
    it('should propagate errors from shell execution', async () => {
      device.shell.mockRejectedValue(
        new Error('Command execution failed')
      );

      await expect(
        command.exec({ service: 'battery' })
      ).rejects.toThrow('Command execution failed');
    });

    // Note: ShellCommand currently does not check exit codes, only stdout
    // Exit code checking would need to be implemented in ShellCommand.exec()
  });

  describe('Service Listing with args', () => {
    it('should list services with -l arg', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_SERVICES_LIST));

      const services = await command.exec({ args: ['-l'] });

      expect(services).toBe(MOCK_SERVICES_LIST);
      expect(device.shell).toHaveBeenCalledWith('dumpsys -l', expect.any(Object));
    });

    it('should handle -l with custom timeout', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_SERVICES_LIST));

      await command.exec({ args: ['-l'], timeout: 5000 });

      expect(device.shell).toHaveBeenCalledWith('dumpsys -l', expect.any(Object));
    });

    it('should propagate errors when listing services', async () => {
      device.shell.mockRejectedValue(
        new Error('Failed to list services')
      );

      await expect(
        command.exec({ args: ['-l'] })
      ).rejects.toThrow('Failed to list services');
    });
  });

  describe('Edge Cases - Command Building', () => {
    it('should build command with service only', async () => {
      device.shell.mockResolvedValue(makeShellResult('output'));

      await command.exec({ service: 'battery' });

      expect(device.shell).toHaveBeenCalledWith('dumpsys battery', expect.any(Object));
    });

    it('should build command with service and package', async () => {
      device.shell.mockResolvedValue(makeShellResult('output'));

      await command.exec({ service: 'package', packageName: 'com.example.app' });

      expect(device.shell).toHaveBeenCalledWith('dumpsys package com.example.app', expect.any(Object));
    });

    it('should build command with service and args', async () => {
      device.shell.mockResolvedValue(makeShellResult('output'));

      await command.exec({ service: 'activity', args: ['services'] });

      expect(device.shell).toHaveBeenCalledWith('dumpsys activity services', expect.any(Object));
    });

    it('should build plain dumpsys command without service', async () => {
      device.shell.mockResolvedValue(makeShellResult('output'));

      await command.exec({});

      expect(device.shell).toHaveBeenCalledWith('dumpsys', expect.any(Object));
    });

    it('should handle undefined args gracefully', async () => {
      device.shell.mockResolvedValue(makeShellResult('output'));

      await command.exec({
        service: 'battery',
        args: undefined
      });

      expect(device.shell).toHaveBeenCalledWith('dumpsys battery', expect.any(Object));
    });

    it('should handle empty args array', async () => {
      device.shell.mockResolvedValue(makeShellResult('output'));

      await command.exec({
        service: 'battery',
        args: []
      });

      expect(device.shell).toHaveBeenCalledWith('dumpsys battery', expect.any(Object));
    });

    it('should handle undefined packageName', async () => {
      device.shell.mockResolvedValue(makeShellResult('output'));

      await command.exec({
        service: 'battery',
        packageName: undefined
      });

      expect(device.shell).toHaveBeenCalledWith('dumpsys battery', expect.any(Object));
    });
  });

  describe('Real-world Scenarios', () => {
    it('should query battery service', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_BATTERY_OUTPUT));

      const output = await command.exec({ service: 'battery' });

      expect(output).toContain('level: 85');
      expect(output).toContain('technology: Li-ion');
    });

    it('should query package info for specific package', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_PACKAGE_OUTPUT));

      const output = await command.exec({
        service: 'package',
        packageName: 'com.example.app'
      });

      expect(output).toContain('com.example.app');
      expect(output).toContain('versionName=1.0.0');
    });

    it('should query meminfo', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_MEMINFO_OUTPUT));

      const output = await command.exec({ service: 'meminfo' });

      expect(output).toContain('Total RAM');
      expect(output).toContain('Free RAM');
    });

    it('should query activity with args', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_ACTIVITY_OUTPUT));

      const output = await command.exec({
        service: 'activity',
        args: ['activities']
      });

      expect(output).toContain('ACTIVITY MANAGER');
      expect(device.shell).toHaveBeenCalledWith('dumpsys activity activities', expect.any(Object));
    });

    it('should list available services', async () => {
      device.shell.mockResolvedValue(makeShellResult(MOCK_SERVICES_LIST));

      const output = await command.exec({ args: ['-l'] });

      expect(output).toContain('activity');
      expect(output).toContain('battery');
      expect(output).toContain('package');
    });
  });
});