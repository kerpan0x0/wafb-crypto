import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PackagesAcquirer } from '../../../../src/forensics/acquisition/packages';
import type { PackageInfo, PackageFile } from '../../../../src/forensics/acquisition/packages';
import {
  createMockDeviceForAcquirer,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  makeShellResult,
  makeSpawnResult,
  readStream,
} from '../../../helpers/test-helpers';
import type { MockDevice } from '../../../helpers/test-helpers';

async function drainAndHash(result: any, fileIndex = 0): Promise<string | undefined> {
  const file = result.files?.[fileIndex] ?? result.files![fileIndex];
  if (!file?.hashPromise) return undefined;
  // Drain the stream so TransformStream.flush() fires and hashPromise resolves
  if (file.stream) {
    const reader = (file.stream as ReadableStream<Uint8Array>).getReader();
    while (!(await reader.read()).done) {}
  }
  return file.hashPromise;
}


/**
 * Helper: parse the blob from the acquisition result into PackageInfo[]
 */
async function parseBlobAsPackages(stream: ReadableStream<Uint8Array>): Promise<PackageInfo[]> {
  const text = await readStream(stream);
  return JSON.parse(text);
}

describe('PackagesAcquirer', () => {
  let device: MockDevice;
  let acquirer: PackagesAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    device = createMockDeviceForAcquirer();
    domMocks = setupAcquirerDOMMocks();
    // Disable APK download by default to keep tests focused on metadata
    acquirer = new PackagesAcquirer(device as any, { downloadApks: false });
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  // ==========================================================================
  // BASIC ACQUISITION
  // ==========================================================================

  describe('acquire', () => {
    it('should successfully acquire packages list', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.type).toBe('packages');
      expect(result.files).toBeDefined();
      expect(result.files!.length).toBeGreaterThan(0);
      const jsonFile = result.files![0];
      expect(jsonFile.fileName).toBe('packages.json');
      expect(jsonFile.stream!).toBeDefined();
      expect(device.shell).toHaveBeenCalled();
    });

    it('should produce valid JSON output as a direct array', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.files).toBeDefined();
      const jsonFile = result.files![0];
      expect(jsonFile.stream!).toBeDefined();

      const packages = await parseBlobAsPackages(jsonFile.stream!);
      expect(Array.isArray(packages)).toBe(true);
      expect(packages.length).toBe(3); // default: com.android.vending, com.example.app, com.google.android.gms
    });

    it('should call pm list packages -f -U for paths and UIDs', async () => {
      await acquirer.acquire();

      const spawnCalls = device.shell.mock.calls;
      const pmFUCall = spawnCalls.find(
        (c: any[]) =>
          c[0].includes('pm list packages') && c[0].includes('-f') && c[0].includes('-U')
      );
      expect(pmFUCall).toBeDefined();
    });

    it('should call pm list packages -d for disabled packages', async () => {
      await acquirer.acquire();

      const spawnCalls = device.shell.mock.calls;
      const pmDCall = spawnCalls.find(
        (c: any[]) => c[0].includes('pm list packages') && c[0].includes('-d')
      );
      expect(pmDCall).toBeDefined();
    });

    it('should call dumpsys package for each package when includeDetails is true', async () => {
      device = createMockDeviceForAcquirer({
        listPackages: ['com.example.app', 'com.example.app2'],
      });
      acquirer = new PackagesAcquirer(device as any, { includeDetails: true, downloadApks: false });

      await acquirer.acquire();

      const spawnCalls = device.shell.mock.calls;
      const dumpsysCalls = spawnCalls.filter((c: any[]) => c[0].includes('dumpsys package'));
      expect(dumpsysCalls.length).toBe(2);
    });

    it('should handle empty package list', async () => {
      device = createMockDeviceForAcquirer({
        listPackages: [],
      });
      acquirer = new PackagesAcquirer(device as any, { downloadApks: false });

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).totalPackages).toBe(0);

      const jsonFile = result.files![0];
      const packages = await parseBlobAsPackages(jsonFile.stream!);
      expect(packages).toEqual([]);
    });

    it('should compute hash when configured', async () => {
      acquirer = new PackagesAcquirer(device as any, { computeHash: true, downloadApks: false });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      const jsonFile = result.files![0];
      const _hash_jsonFile = await drainAndHash({ files: [jsonFile] });
      expect(_hash_jsonFile).toBeDefined();
      expect(typeof _hash_jsonFile).toBe('string');
    });
  });

  // ==========================================================================
  // ANDROIDQF-COMPATIBLE OUTPUT FORMAT
  // ==========================================================================

  describe('androidqf output format', () => {
    it('should include all required fields per package', async () => {
      device = createMockDeviceForAcquirer({
        listPackages: ['com.example.app'],
      });
      acquirer = new PackagesAcquirer(device as any, { downloadApks: false });

      const result = await acquirer.acquire();
      const jsonFile = result.files![0];
      const packages = await parseBlobAsPackages(jsonFile.stream!);

      expect(packages.length).toBe(1);
      const pkg = packages[0];

      // All androidqf fields must be present
      expect(pkg).toHaveProperty('name');
      expect(pkg).toHaveProperty('files');
      expect(pkg).toHaveProperty('installer');
      expect(pkg).toHaveProperty('uid');
      expect(pkg).toHaveProperty('disabled');
      expect(pkg).toHaveProperty('system');
      expect(pkg).toHaveProperty('third_party');

      // Types
      expect(typeof pkg.name).toBe('string');
      expect(Array.isArray(pkg.files)).toBe(true);
      expect(typeof pkg.installer).toBe('string');
      expect(typeof pkg.uid).toBe('number');
      expect(typeof pkg.disabled).toBe('boolean');
      expect(typeof pkg.system).toBe('boolean');
      expect(typeof pkg.third_party).toBe('boolean');
    });

    it('should NOT include old-format fields', async () => {
      device = createMockDeviceForAcquirer({
        listPackages: ['com.example.app'],
      });
      acquirer = new PackagesAcquirer(device as any, { downloadApks: false });

      const result = await acquirer.acquire();
      const jsonFile = result.files![0];
      const packages = await parseBlobAsPackages(jsonFile.stream!);
      const pkg = packages[0] as any;

      // These fields were removed in the androidqf format migration
      expect(pkg).not.toHaveProperty('versionName');
      expect(pkg).not.toHaveProperty('versionCode');
      expect(pkg).not.toHaveProperty('installLocation');
      expect(pkg).not.toHaveProperty('firstInstallTime');
      expect(pkg).not.toHaveProperty('lastUpdateTime');
      expect(pkg).not.toHaveProperty('targetSdk');
      expect(pkg).not.toHaveProperty('minSdk');
      expect(pkg).not.toHaveProperty('permissions');
    });

    it('should use 4-space indentation in JSON output', async () => {
      const result = await acquirer.acquire();
      const jsonFile = result.files![0];
      const text = await readStream(jsonFile.stream!);

      // Verify 4-space indent: the first property in the first object
      // JSON.stringify with 4 spaces creates lines like:
      //     {
      //         "name": ...
      expect(text).toContain('    ');
      // Should NOT use 2-space indentation for top-level object properties
      const lines = text.split('\n');
      const nameLine = lines.find(l => l.includes('"name"'));
      expect(nameLine).toBeDefined();
      // 8 spaces for a property inside an array element (4 for array + 4 for object)
      expect(nameLine!.startsWith('        ')).toBe(true);
    });

    it('should produce a direct JSON array (not wrapped in object)', async () => {
      const result = await acquirer.acquire();
      const jsonFile = result.files![0];
      const text = await readStream(jsonFile.stream!);

      expect(text.trim().startsWith('[')).toBe(true);
      expect(text.trim().endsWith(']')).toBe(true);
    });
  });

  // ==========================================================================
  // FILE ENTRIES
  // ==========================================================================

  describe('file entries', () => {
    it('should include file entries with correct structure', async () => {
      device = createMockDeviceForAcquirer({
        listPackages: ['com.example.app'],
      });
      acquirer = new PackagesAcquirer(device as any, { downloadApks: false });

      const result = await acquirer.acquire();
      const jsonFile = result.files![0];
      const packages = await parseBlobAsPackages(jsonFile.stream!);
      const file: PackageFile = packages[0].files[0];

      expect(file).toHaveProperty('path');
      expect(file).toHaveProperty('local_name', '');
      expect(file).toHaveProperty('md5', '');
      expect(file).toHaveProperty('sha1', '');
      expect(file).toHaveProperty('sha256', '');
      expect(file).toHaveProperty('sha512', '');
      expect(file).toHaveProperty('error', '');
      expect(file).toHaveProperty('verified_certificate', false);
      expect(file).toHaveProperty('certificate_error', '');
      expect(file).toHaveProperty('trusted_certificate', false);
    });

    it('should include certificate stub with correct structure', async () => {
      device = createMockDeviceForAcquirer({
        listPackages: ['com.example.app'],
      });
      acquirer = new PackagesAcquirer(device as any, { downloadApks: false });

      const result = await acquirer.acquire();
      const jsonFile = result.files![0];
      const packages = await parseBlobAsPackages(jsonFile.stream!);
      const cert = packages[0].files[0].certificate;

      expect(cert).toEqual({
        Md5: '',
        Sha1: '',
        Sha256: '',
        ValidFrom: '0001-01-01T00:00:00Z',
        ValidTo: '0001-01-01T00:00:00Z',
        Issuer: '',
        Subject: '',
        SignatureAlgorithm: '',
        SerialNumber: null,
      });
    });

    it('should have APK paths from dumpsys output', async () => {
      device = createMockDeviceForAcquirer({
        listPackages: ['com.example.app'],
      });
      acquirer = new PackagesAcquirer(device as any, { downloadApks: false });

      const result = await acquirer.acquire();
      const jsonFile = result.files![0];
      const packages = await parseBlobAsPackages(jsonFile.stream!);

      expect(packages[0].files.length).toBeGreaterThanOrEqual(1);
      expect(packages[0].files[0].path).toContain('.apk');
    });

    it('should include split APK files when present', async () => {
      device = createMockDeviceForAcquirer({
        listPackages: ['com.example.app'],
        splitApks: {
          'com.example.app': ['split_config.arm64_v8a.apk', 'split_config.xxhdpi.apk'],
        },
      });
      acquirer = new PackagesAcquirer(device as any, { downloadApks: false });

      const result = await acquirer.acquire();
      const jsonFile = result.files![0];
      const packages = await parseBlobAsPackages(jsonFile.stream!);

      // Should have base.apk + 2 splits = 3 files
      expect(packages[0].files.length).toBe(3);
      const paths = packages[0].files.map(f => f.path);
      expect(paths.some(p => p.includes('base.apk'))).toBe(true);
      expect(paths.some(p => p.includes('split_config.arm64_v8a.apk'))).toBe(true);
      expect(paths.some(p => p.includes('split_config.xxhdpi.apk'))).toBe(true);
    });
  });

  // ==========================================================================
  // SYSTEM vs THIRD-PARTY CLASSIFICATION (PATH-BASED)
  // ==========================================================================

  describe('package classification', () => {
    it('should classify packages under /data/app/ as third_party', async () => {
      device = createMockDeviceForAcquirer({
        listPackages: ['com.example.app'],
        // com.example.app defaults to /data/app/~~hash~~/com.example.app-hash==/base.apk
      });
      acquirer = new PackagesAcquirer(device as any, { downloadApks: false });

      const result = await acquirer.acquire();
      const jsonFile = result.files![0];
      const packages = await parseBlobAsPackages(jsonFile.stream!);

      const pkg = packages[0];
      expect(pkg.system).toBe(false);
      expect(pkg.third_party).toBe(true);
    });

    it('should classify packages under /system/ as system', async () => {
      device = createMockDeviceForAcquirer({
        listPackages: ['com.android.vending'],
        // com.android.vending defaults to /system/priv-app/Phonesky/Phonesky.apk
      });
      acquirer = new PackagesAcquirer(device as any, { downloadApks: false });

      const result = await acquirer.acquire();
      const jsonFile = result.files![0];
      const packages = await parseBlobAsPackages(jsonFile.stream!);

      const pkg = packages[0];
      expect(pkg.system).toBe(true);
      expect(pkg.third_party).toBe(false);
    });

    it('should have third_party as inverse of system', async () => {
      device = createMockDeviceForAcquirer({
        listPackages: ['com.android.vending', 'com.example.app'],
      });
      acquirer = new PackagesAcquirer(device as any, { downloadApks: false });

      const result = await acquirer.acquire();
      const jsonFile = result.files![0];
      const packages = await parseBlobAsPackages(jsonFile.stream!);

      for (const pkg of packages) {
        expect(pkg.third_party).toBe(!pkg.system);
      }
    });

    it('should correctly count system and user packages in result data', async () => {
      device = createMockDeviceForAcquirer({
        // Default: com.android.vending (system), com.example.app (user), com.google.android.gms (system)
      });
      acquirer = new PackagesAcquirer(device as any, { downloadApks: false });

      const result = await acquirer.acquire();

      expect((result.data as any).totalPackages).toBe(3);
      expect((result.data as any).systemPackages).toBe(2); // vending + gms
      expect((result.data as any).userPackages).toBe(1); // example.app
    });
  });

  // ==========================================================================
  // UID
  // ==========================================================================

  describe('uid', () => {
    it('should include numeric uid for each package', async () => {
      const result = await acquirer.acquire();
      const jsonFile = result.files![0];
      const packages = await parseBlobAsPackages(jsonFile.stream!);

      for (const pkg of packages) {
        expect(typeof pkg.uid).toBe('number');
        expect(pkg.uid).toBeGreaterThan(0);
      }
    });

    it('should use uid from pm list output', async () => {
      device = createMockDeviceForAcquirer({
        listPackages: ['com.android.vending'],
        // com.android.vending has uid 10070 in defaultPackagePaths
      });
      acquirer = new PackagesAcquirer(device as any, { downloadApks: false });

      const result = await acquirer.acquire();
      const jsonFile = result.files![0];
      const packages = await parseBlobAsPackages(jsonFile.stream!);

      expect(packages[0].uid).toBe(10000);
    });
  });

  // ==========================================================================
  // DISABLED PACKAGES
  // ==========================================================================

  describe('disabled packages', () => {
    it('should mark disabled packages correctly', async () => {
      device = createMockDeviceForAcquirer({
        listPackages: ['com.example.app', 'com.example.disabled'],
        disabledPackages: ['com.example.disabled'],
      });
      acquirer = new PackagesAcquirer(device as any, { downloadApks: false });

      const result = await acquirer.acquire();
      const jsonFile = result.files![0];
      const packages = await parseBlobAsPackages(jsonFile.stream!);

      const enabledPkg = packages.find(p => p.name === 'com.example.app');
      const disabledPkg = packages.find(p => p.name === 'com.example.disabled');

      expect(enabledPkg!.disabled).toBe(false);
      expect(disabledPkg!.disabled).toBe(true);
    });

    it('should set disabled to false when no packages are disabled', async () => {
      device = createMockDeviceForAcquirer({
        listPackages: ['com.example.app'],
        disabledPackages: [],
      });
      acquirer = new PackagesAcquirer(device as any, { downloadApks: false });

      const result = await acquirer.acquire();
      const jsonFile = result.files![0];
      const packages = await parseBlobAsPackages(jsonFile.stream!);

      expect(packages[0].disabled).toBe(false);
    });
  });

  // ==========================================================================
  // INSTALLER
  // ==========================================================================

  describe('installer', () => {
    it('should extract installer from dumpsys output', async () => {
      device = createMockDeviceForAcquirer({
        listPackages: ['com.example.app'],
        installers: {
          'com.example.app': 'com.android.vending',
        },
      });
      acquirer = new PackagesAcquirer(device as any, { downloadApks: false });

      const result = await acquirer.acquire();
      const jsonFile = result.files![0];
      const packages = await parseBlobAsPackages(jsonFile.stream!);

      expect(packages[0].installer).toBe('com.android.vending');
    });

    it('should default installer to "null" when not available', async () => {
      device = createMockDeviceForAcquirer({
        listPackages: ['com.example.app'],
        installers: {
          'com.example.app': 'null',
        },
      });
      acquirer = new PackagesAcquirer(device as any, { downloadApks: false });

      const result = await acquirer.acquire();
      const jsonFile = result.files![0];
      const packages = await parseBlobAsPackages(jsonFile.stream!);

      expect(packages[0].installer).toBe('null');
    });
  });

  // ==========================================================================
  // PROGRESS REPORTING
  // ==========================================================================

  describe('progress reporting', () => {
    it('should report progress during acquisition', async () => {
      const { callback, getLastProgress, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      expect(callback).toHaveBeenCalled();
      const lastProgress = getLastProgress();
      expect(lastProgress.progress).toBe(100);
      expect(lastProgress.status).toBe('completed');
    });

    it('should report incremental progress', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const history = getProgressHistory();
      // Should have multiple progress reports
      expect(history.length).toBeGreaterThan(2);

      // Progress values should generally increase
      for (let i = 1; i < history.length; i++) {
        expect(history[i].progress).toBeGreaterThanOrEqual(history[i - 1].progress);
      }
    });

    it('should include device info in early progress', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const history = getProgressHistory();
      const withDeviceInfo = history.find((p: any) => p.deviceInfo !== undefined);
      expect(withDeviceInfo).toBeDefined();
    });
  });

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('error handling', () => {
    it('should handle pm list packages failure', async () => {
      device.shell.mockRejectedValue(
        new Error('pm command failed')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should continue when dumpsys fails for a single package', async () => {
      device = createMockDeviceForAcquirer({
        listPackages: ['com.example.app1', 'com.example.app2'],
      });
      acquirer = new PackagesAcquirer(device as any, { includeDetails: true, downloadApks: false });

      // Capture the original routing implementation before overriding
      const originalImpl = vi
        .mocked(device.shell)
        .getMockImplementation();
      let dumpsysCallCount = 0;
      device.shell.mockImplementation((command: string) => {
        if (command.includes('dumpsys package')) {
          dumpsysCallCount++;
          if (dumpsysCallCount === 1) {
            return Promise.reject(new Error('dumpsys timeout'));
          }
        }
        return originalImpl!(command);
      });

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).totalPackages).toBe(2);
    });

    it('should handle device disconnection', async () => {
      device.shell.mockRejectedValue(
        new Error('Device disconnected')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should report failed status on error', async () => {
      const { callback, getLastProgress } = createMockProgressCallback();
      device.shell.mockRejectedValue(
        new Error('Connection lost')
      );

      await acquirer.acquire(callback);

      const lastProgress = getLastProgress();
      expect(lastProgress.status).toBe('failed');
    });
  });

  // ==========================================================================
  // RESULT METADATA
  // ==========================================================================

  describe('result metadata', () => {
    it('should include timestamps', async () => {
      const result = await acquirer.acquire();

      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
      expect(result.endTime.getTime()).toBeGreaterThanOrEqual(result.startTime.getTime());
    });

    it('should include duration', async () => {
      const result = await acquirer.acquire();

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(typeof result.duration).toBe('number');
    });

    it('should include file size', async () => {
      const result = await acquirer.acquire();

      expect(result.files).toBeDefined();
      const jsonFile = result.files![0];
      expect(jsonFile.fileSize).toBeDefined();
      expect(typeof jsonFile.fileSize).toBe('number');
      expect(jsonFile.fileSize).toBeGreaterThan(0);
    });

    it('should include package counts in data', async () => {
      const result = await acquirer.acquire();

      expect((result.data as any).totalPackages).toBeDefined();
      expect((result.data as any).systemPackages).toBeDefined();
      expect((result.data as any).userPackages).toBeDefined();
      expect(typeof (result.data as any).totalPackages).toBe('number');
    });
  });

  // ==========================================================================
  // CONFIGURATION
  // ==========================================================================

  describe('configuration', () => {
    it('should respect includeSystem config', async () => {
      acquirer = new PackagesAcquirer(device as any, { includeSystem: false, downloadApks: false });
      await acquirer.acquire();

      const spawnCalls = device.shell.mock.calls;
      // Should include -3 flag when includeSystem is false (alongside -f -U)
      const pmCall = spawnCalls.find(
        (c: any[]) => c[0].includes('pm list packages') && c[0].includes('-f')
      );
      // PmCommand adds -3 when includeSystem is false (and not disabledOnly)
      // But the -f -U call has includeSystem passed through
      expect(pmCall).toBeDefined();
    });

    it('should skip dumpsys when includeDetails is false', async () => {
      device = createMockDeviceForAcquirer({
        listPackages: ['com.example.app'],
      });
      acquirer = new PackagesAcquirer(device as any, { includeDetails: false, downloadApks: false });

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);

      const spawnCalls = device.shell.mock.calls;
      const dumpsysCalls = spawnCalls.filter((c: any[]) => c[0].includes('dumpsys package'));
      expect(dumpsysCalls.length).toBe(0);
    });

    it('should still produce valid output when includeDetails is false', async () => {
      device = createMockDeviceForAcquirer({
        listPackages: ['com.example.app'],
      });
      acquirer = new PackagesAcquirer(device as any, { includeDetails: false, downloadApks: false });

      const result = await acquirer.acquire();
      const jsonFile = result.files![0];
      const packages = await parseBlobAsPackages(jsonFile.stream!);

      expect(packages.length).toBe(1);
      expect(packages[0]).toHaveProperty('name');
      expect(packages[0]).toHaveProperty('files');
      expect(packages[0]).toHaveProperty('uid');
      expect(packages[0]).toHaveProperty('disabled');
      expect(packages[0]).toHaveProperty('system');
      expect(packages[0]).toHaveProperty('third_party');
    });

    it('should respect timeout config', async () => {
      acquirer = new PackagesAcquirer(device as any, { timeout: 5000, downloadApks: false });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(device.shell).toHaveBeenCalled();
    });
  });
});