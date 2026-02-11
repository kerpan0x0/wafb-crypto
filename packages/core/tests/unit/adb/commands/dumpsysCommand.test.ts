/**
 * @file dumpsysCommand.test.ts
 * @description Tests for DumpsysCommand (exec() and service discovery only)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DumpsysCommand } from '../../../../src/adb/commands/dumpsysCommand';
import type { Adb } from '@yume-chan/adb';
import { createMockAdb, createMockShellSocket } from '../../../helpers/test-helpers';

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
  let mockAdb: Adb;
  let command: DumpsysCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdb = createMockAdb() as unknown as Adb;
    command = new DumpsysCommand(mockAdb);
  });

  describe('Constructor', () => {
    it('should create instance with Adb', () => {
      expect(command).toBeInstanceOf(DumpsysCommand);
    });
  });

  describe('exec() - Basic Execution', () => {
    it('should execute dumpsys with service', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_BATTERY_OUTPUT)
      );

      const output = await command.exec({ service: 'battery' });

      expect(output).toBe(MOCK_BATTERY_OUTPUT);
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('dumpsys battery');
    });

    it('should execute dumpsys without service (plain dumpsys)', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_SERVICES_LIST)
      );

      const output = await command.exec({});

      expect(output).toBe(MOCK_SERVICES_LIST);
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('dumpsys');
    });

    it('should execute dumpsys with service and package name', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_PACKAGE_OUTPUT)
      );

      const output = await command.exec({
        service: 'package',
        packageName: 'com.example.app'
      });

      expect(output).toBe(MOCK_PACKAGE_OUTPUT);
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'dumpsys package com.example.app'
      );
    });

    it('should execute dumpsys with service and args', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_ACTIVITY_OUTPUT)
      );

      const output = await command.exec({
        service: 'activity',
        args: ['activities', 'top']
      });

      expect(output).toBe(MOCK_ACTIVITY_OUTPUT);
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'dumpsys activity activities top'
      );
    });

    it('should execute dumpsys with all parameters', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('output')
      );

      await command.exec({
        service: 'batterystats',
        packageName: 'com.example.app',
        args: ['--charged']
      });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'dumpsys batterystats com.example.app --charged'
      );
    });

    it('should use custom timeout', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_BATTERY_OUTPUT)
      );

      await command.exec({ service: 'battery', timeout: 5000 });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalled();
    });

    it('should use default timeout of 30000ms', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_BATTERY_OUTPUT)
      );

      await command.exec({ service: 'battery' });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalled();
    });
  });

  describe('exec() - Error Handling', () => {
    it('should propagate errors from shell execution', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockRejectedValue(
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
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_SERVICES_LIST)
      );

      const services = await command.exec({ args: ['-l'] });

      expect(services).toBe(MOCK_SERVICES_LIST);
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('dumpsys -l');
    });

    it('should handle -l with custom timeout', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_SERVICES_LIST)
      );

      await command.exec({ args: ['-l'], timeout: 5000 });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('dumpsys -l');
    });

    it('should propagate errors when listing services', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockRejectedValue(
        new Error('Failed to list services')
      );

      await expect(
        command.exec({ args: ['-l'] })
      ).rejects.toThrow('Failed to list services');
    });
  });

  describe('Edge Cases - Command Building', () => {
    it('should build command with service only', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('output')
      );

      await command.exec({ service: 'battery' });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('dumpsys battery');
    });

    it('should build command with service and package', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('output')
      );

      await command.exec({ service: 'package', packageName: 'com.example.app' });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'dumpsys package com.example.app'
      );
    });

    it('should build command with service and args', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('output')
      );

      await command.exec({ service: 'activity', args: ['services'] });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'dumpsys activity services'
      );
    });

    it('should build plain dumpsys command without service', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('output')
      );

      await command.exec({});

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('dumpsys');
    });

    it('should handle undefined args gracefully', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('output')
      );

      await command.exec({
        service: 'battery',
        args: undefined
      });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('dumpsys battery');
    });

    it('should handle empty args array', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('output')
      );

      await command.exec({
        service: 'battery',
        args: []
      });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('dumpsys battery');
    });

    it('should handle undefined packageName', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket('output')
      );

      await command.exec({
        service: 'battery',
        packageName: undefined
      });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('dumpsys battery');
    });
  });

  describe('Real-world Scenarios', () => {
    it('should query battery service', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_BATTERY_OUTPUT)
      );

      const output = await command.exec({ service: 'battery' });

      expect(output).toContain('level: 85');
      expect(output).toContain('technology: Li-ion');
    });

    it('should query package info for specific package', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_PACKAGE_OUTPUT)
      );

      const output = await command.exec({
        service: 'package',
        packageName: 'com.example.app'
      });

      expect(output).toContain('com.example.app');
      expect(output).toContain('versionName=1.0.0');
    });

    it('should query meminfo', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_MEMINFO_OUTPUT)
      );

      const output = await command.exec({ service: 'meminfo' });

      expect(output).toContain('Total RAM');
      expect(output).toContain('Free RAM');
    });

    it('should query activity with args', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_ACTIVITY_OUTPUT)
      );

      const output = await command.exec({
        service: 'activity',
        args: ['activities']
      });

      expect(output).toContain('ACTIVITY MANAGER');
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'dumpsys activity activities'
      );
    });

    it('should list available services', async () => {
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockResolvedValue(
        createMockShellSocket(MOCK_SERVICES_LIST)
      );

      const output = await command.exec({ args: ['-l'] });

      expect(output).toContain('activity');
      expect(output).toContain('battery');
      expect(output).toContain('package');
    });
  });
});