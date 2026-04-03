import { vi } from 'vitest';
import type { ShellResult, SpawnResult, ShellOptions } from '../src/adb';
import type { DeviceProperties } from '../src/adb/device';

// ============================================================================
// PRIMITIVE STREAM HELPERS
// ============================================================================

export function createMockReadableStream(content: string | Uint8Array): ReadableStream<Uint8Array> {
  const data = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return new ReadableStream({
    start(controller) {
      if (data.length > 0) controller.enqueue(data);
      controller.close();
    },
  });
}

export function createReadableStream(data: Uint8Array): ReadableStream<Uint8Array> {
  return createMockReadableStream(data);
}

export function createHangingReadableStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({ start() {} });
}

// ============================================================================
// SHELL / SPAWN RESULT FACTORIES
// ============================================================================

export function makeShellResult(stdout: string, stderr = '', exitCode = 0): ShellResult {
  return { stdout, stderr, exitCode };
}

export function makeSpawnResult(content: string | Uint8Array = '', exitCode = 0): SpawnResult {
  return {
    stdout: createMockReadableStream(content),
    exited: Promise.resolve(exitCode),
  };
}

// ============================================================================
// DEVICE PROPERTIES & INFO
// ============================================================================

export function createMockDeviceProperties(overrides: Partial<DeviceProperties> = {}): DeviceProperties {
  return {
    androidVersion: '13',
    buildId: 'TP1A.220905.004',
    model: 'Test Device',
    manufacturer: 'Test Manufacturer',
    brand: 'Test',
    sdkVersion: 33,
    serialNumber: 'TEST123',
    ...overrides,
  };
}

export function createMockDeviceInfo(overrides = {}) {
  return {
    productName: 'Test Device',
    manufacturerName: 'Test Manufacturer',
    serialNumber: 'TEST123',
    vendorId: 0x18d1,
    productId: 0x4ee7,
    ...overrides,
  };
}

// ============================================================================
// MOCK ADB (shell socket level) — for Shell and Device unit tests
// ============================================================================

/**
 * Creates a mock shell socket with getReader-style streams, as returned by
 * adb.subprocess.shellProtocol.spawn(). Used by Shell.executeInner.
 */
export function createMockShellSocket(stdout = '', exitCode = 0) {
  const enc = new TextEncoder();
  let read = 0;

  return {
    stdout: {
      getReader: () => ({
        read: async () => {
          if (read++ === 0 && stdout.length > 0)
            return { done: false as const, value: enc.encode(stdout) };
          return { done: true as const, value: undefined };
        },
        releaseLock: vi.fn(),
      }),
    },
    stderr: {
      getReader: () => ({
        read: async () => ({ done: true as const, value: undefined }),
        releaseLock: vi.fn(),
      }),
    },
    stdin: new WritableStream(),
    exited: Promise.resolve(exitCode),
  };
}

/**
 * Creates a shell socket whose streams never close — for timeout tests.
 */
export function createHangingShellSocket() {
  return {
    stdout: {
      getReader: () => ({
        read: (): Promise<{ done: boolean; value: undefined }> => new Promise(() => {}),
        releaseLock: vi.fn(),
      }),
    },
    stderr: {
      getReader: () => ({
        read: (): Promise<{ done: boolean; value: undefined }> => new Promise(() => {}),
        releaseLock: vi.fn(),
      }),
    },
    stdin: new WritableStream(),
    exited: new Promise<number>(() => {}),
  };
}

/**
 * Creates a minimal Adb mock whose shellProtocol.spawn returns the given socket.
 */
export function createMockAdb(socket?: ReturnType<typeof createMockShellSocket>) {
  return {
    subprocess: {
      shellProtocol: {
        spawn: vi.fn().mockResolvedValue(socket ?? createMockShellSocket()),
      },
      spawn: vi.fn(),
    },
    sync: vi.fn().mockResolvedValue({ dispose: vi.fn() }),
  };
}

// ============================================================================
// MOCK SYNC SERVICE
// ============================================================================

export function createMockSync(readContent?: Uint8Array) {
  return {
    read: vi.fn().mockReturnValue(
      readContent ? createMockReadableStream(readContent) : null
    ),
    write: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// ============================================================================
// CORE MOCK DEVICE
// ============================================================================

export function createMockDevice() {
  return {
    shell: vi.fn<[string, ShellOptions?], Promise<ShellResult>>()
      .mockResolvedValue(makeShellResult('')),
    spawn: vi.fn<[string, number?], Promise<SpawnResult>>()
      .mockResolvedValue(makeSpawnResult('')),
    sync: vi.fn().mockResolvedValue(createMockSync()),
    getProperties: vi.fn().mockResolvedValue(createMockDeviceProperties()),
    isRooted: vi.fn().mockResolvedValue(false),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    // adb kept for ReadFileCommand / WriteFileCommand which call device.sync() directly
    adb: {
      sync: vi.fn().mockResolvedValue(createMockSync()),
    },
    info: createMockDeviceInfo(),
  };
}

export type MockDevice = ReturnType<typeof createMockDevice>;

// ============================================================================
// FULL DEVICE MOCK FOR ACQUIRER TESTS
// ============================================================================

export interface MockDeviceOverrides {
  /** Raw output for unrecognised commands */
  shellOutput?: string;
  /** Packages returned by pm list packages */
  listPackages?: string[];
  /** Output for `logcat` commands */
  logcatOutput?: string;
  /** When true, which/bugreportz report the binary as found */
  checkCommandExists?: boolean;
  /** Full path returned by bugreportz */
  bugreportzPath?: string;
  /** Raw bytes returned by ReadFileCommand (adb sync) */
  readFile?: Uint8Array;
  /** Paths that should throw "Permission denied" when read via sync */
  syncPermissionDeniedPaths?: string[];
  /** Error thrown for ALL sync reads (e.g. "File not found") */
  syncError?: Error;
  /** getprop key→value map */
  getPropOutput?: Record<string, string>;
  /** which -a paths for root binary detection */
  rootBinaryPaths?: Record<string, string>;
  /** Disabled packages for pm list packages -d */
  disabledPackages?: string[];
  /** Map of package name → installer name (for dumpsys output) */
  installers?: Record<string, string>;
  /** Map of package name → split APK filenames */
  splitApks?: Record<string, string[]>;
}

export function createMockDeviceForAcquirer(overrides: MockDeviceOverrides = {}) {
  const device = createMockDevice();

  // ── shell dispatch ──────────────────────────────────────────────────────
  device.shell.mockImplementation(async (command: string) => {
    return makeShellResult(resolveShellOutput(command, overrides));
  });

  // ── spawn dispatch ──────────────────────────────────────────────────────
  device.spawn.mockImplementation(async (command: string) => {
    return makeSpawnResult(resolveSpawnOutput(command, overrides));
  });

  // ── sync dispatch ───────────────────────────────────────────────────────
  if (overrides.syncError) {
    device.sync.mockRejectedValue(overrides.syncError);
  } else {
    const readFile = overrides.readFile ?? new TextEncoder().encode('mock file content');
    const permDeniedPaths = overrides.syncPermissionDeniedPaths ?? [];

    device.sync.mockResolvedValue({
      read: vi.fn().mockImplementation((path: string) => {
        if (permDeniedPaths.includes(path)) {
          throw new Error('Permission denied');
        }
        return createMockReadableStream(readFile);
      }),
      write: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    });
  }

  // Also mirror on device.adb.sync for commands that use it directly
  device.adb.sync.mockImplementation(device.sync);

  device.getProperties.mockResolvedValue(createMockDeviceProperties());

  return device;
}

// ── Output resolvers ────────────────────────────────────────────────────────

function resolveShellOutput(command: string, ov: MockDeviceOverrides): string {
  const packages = ov.listPackages ?? ['com.android.vending', 'com.example.app', 'com.google.android.gms'];

  if (command.includes('pm list packages') && command.includes('-d'))
    return (ov.disabledPackages ?? []).map(p => `package:${p}`).join('\n');

  if (command.includes('pm list packages') && command.includes('-f'))
    return packages.map(pkg => {
      const path = pkg.startsWith('com.android') || pkg.startsWith('com.google')
        ? `/system/priv-app/${pkg}/${pkg}.apk`
        : `/data/app/~~hash~~/${pkg}-hash==/base.apk`;
      return `package:${path}=${pkg} uid:${10000 + packages.indexOf(pkg)}`;
    }).join('\n');

  if (command.includes('pm list packages'))
    return packages.map(p => `package:${p}`).join('\n');

  if (command.includes('dumpsys package ') && !command.includes('-l')) {
    const pkg = command.match(/dumpsys package ([\w.]+)/)?.[1];
    if (pkg) return buildDumpsysPackageOutput(pkg, ov);
  }

  if (command.startsWith('dumpsys')) return ov.shellOutput ?? '';
  if (command.includes('logcat')) return ov.logcatOutput ?? DEFAULT_LOGCAT;

  if (command === 'bugreportz' || command.startsWith('bugreportz ')) {
    const path = ov.bugreportzPath ?? '/data/user_de/0/com.android.shell/files/bugreports/bugreport.zip';
    return `OK:${path}`;
  }

  if (command.includes('which -a')) {
    const bin = command.replace('which -a ', '').trim();
    return (ov.rootBinaryPaths ?? DEFAULT_ROOT_BINARY_PATHS)[bin] ?? '';
  }

  if (command.startsWith('which ')) {
    const bin = command.split(' ').pop() ?? '';
    return ov.checkCommandExists ? `/system/bin/${bin}` : '';
  }

  if (command === 'getprop') {
    const props = ov.getPropOutput ?? DEFAULT_GETPROP;
    return Object.entries(props).map(([k, v]) => `[${k}]: [${v}]`).join('\n');
  }

  return ov.shellOutput ?? '';
}

function resolveSpawnOutput(command: string, ov: MockDeviceOverrides): string {
  if (command.includes('backup')) return ov.shellOutput ?? '';
  if (command === 'bugreport') return ov.shellOutput ?? 'bugreport output';
  if (command === 'dumpsys') return ov.shellOutput ?? '';
  return ov.shellOutput ?? '';
}

// ── Default constants ───────────────────────────────────────────────────────

const DEFAULT_GETPROP: Record<string, string> = {
  'ro.build.version.release': '13',
  'ro.build.id': 'TP1A.220905.004',
  'ro.product.model': 'Test Device',
  'ro.product.manufacturer': 'Test Manufacturer',
  'ro.product.brand': 'Test',
  'ro.build.version.sdk': '33',
};

const DEFAULT_ROOT_BINARY_PATHS: Record<string, string> = {
  su: '/system/bin/su\n/system/xbin/su',
  busybox: '/system/bin/busybox',
  magisk: '/data/adb/magisk',
  magiskhide: '/data/adb/magisk/magiskhide',
  magiskinit: '/data/adb/magisk/magiskinit',
  magiskpolicy: '/data/adb/magisk/magiskpolicy',
  magiskboot: '/data/adb/magisk/magiskboot',
  supersu: '',
  'Superuser.apk': '',
  'KingoUser.apk': '',
  'SuperSu.apk': '',
};

const DEFAULT_LOGCAT =
  '01-01 10:00:00.000  1234  5678 I Tag: Info message\n' +
  '01-01 10:00:01.000  1234  5678 W Tag: Warning message\n' +
  '01-01 10:00:02.000  1234  5678 E Tag: Error message';

function buildDumpsysPackageOutput(pkg: string, ov: MockDeviceOverrides): string {
  const isSystem = pkg.startsWith('com.android') || pkg.startsWith('com.google');
  const path = isSystem
    ? `/system/priv-app/${pkg}/${pkg}.apk`
    : `/data/app/~~hash~~/${pkg}-hash==/base.apk`;
  const codePath = path.replace(/\/[^/]+\.apk$/, '');
  const installer = ov.installers?.[pkg] ?? 'com.android.vending';
  const splits = ov.splitApks?.[pkg] ?? [];
  const splitsLine = splits.length > 0
    ? `    splits=[base, ${splits.map(s => s.replace('.apk', '')).join(', ')}]`
    : '    splits=[base]';
  const apkLines = [`    ${codePath}/base.apk`, ...splits.map(s => `    ${codePath}/${s}`)];

  return `Packages:
  Package [${pkg}] (12345678):
    userId=10000
    pkg=Package{hash ${pkg}}
    codePath=${codePath}
    resourcePath=${codePath}
    versionCode=100 minSdk=21 targetSdk=33
    versionName=1.0.0
${splitsLine}
    installerPackageName=${installer}
    timeStamp=2025-01-15 10:00:00
    firstInstallTime=2025-01-10 08:30:00
    lastUpdateTime=2025-01-15 10:00:00
${apkLines.join('\n')}`;
}

// ============================================================================
// SPECIALIZED FACTORIES
// ============================================================================

export function createMockDeviceForSELinux(mode: 'Enforcing' | 'Permissive' | 'Disabled' = 'Enforcing') {
  return createMockDeviceForAcquirer({
    shellOutput: mode,
    getPropOutput: { ...DEFAULT_GETPROP, 'ro.build.selinux': '30' },
  });
}

export function createMockDeviceForFileAcquirer(overrides: {
  findOutput?: string;
  statBatchOutput?: string;
} = {}) {
  const device = createMockDeviceForAcquirer();

  device.shell.mockImplementation(async (command: string) => {
    if (command.includes('find')) return makeShellResult(overrides.findOutput ?? MOCK_FIND_OUTPUT);
    if (command.includes('stat')) return makeShellResult(overrides.statBatchOutput ?? MOCK_STAT_BATCH_OUTPUT);
    if (command === 'getprop') return makeShellResult(
      Object.entries(DEFAULT_GETPROP).map(([k, v]) => `[${k}]: [${v}]`).join('\n')
    );
    return makeShellResult('');
  });

  return device;
}

// ============================================================================
// PROGRESS CALLBACK UTILITIES
// ============================================================================

export function createMockProgressCallback() {
  const callback = vi.fn();
  return {
    callback,
    getLastProgress: () => {
      const calls = callback.mock.calls;
      return calls.length > 0 ? calls[calls.length - 1][0] : null;
    },
    getProgressHistory: () => callback.mock.calls.map(call => call[0]),
  };
}

// ============================================================================
// DOM MOCKS
// ============================================================================

export function setupAcquirerDOMMocks() {
  const mockAnchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };

  const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);
  const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockAnchor as any);
  const removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockAnchor as any);
  const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
  const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

  return {
    mockAnchor,
    createObjectURLSpy,
    revokeObjectURLSpy,
    cleanup: () => {
      createElementSpy.mockRestore();
      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
      createObjectURLSpy.mockRestore();
      revokeObjectURLSpy.mockRestore();
    },
  };
}

// ============================================================================
// ASYNC UTILITIES
// ============================================================================

export function waitForAsync() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// ============================================================================
// MOCK DATA CONSTANTS
// ============================================================================

export const MOCK_FIND_OUTPUT =
  `/sdcard/Documents/test1.txt\n` +
  `/sdcard/Pictures/photo.jpg\n` +
  `/sdcard/Download/app.apk\n` +
  `/sdcard/DCIM/Camera/IMG_001.jpg`;

export const MOCK_STAT_BATCH_OUTPUT =
  `1234|regular file|1704067200|1704067100|1704067200|0644|-rw-r--r--|root|sdcard_rw|0|1015|12345|u:object_r:sdcard_external:s0\n` +
  `567890|regular file|1704067300|1704067200|1704067300|0644|-rw-r--r--|root|sdcard_rw|0|1015|12346|u:object_r:sdcard_external:s0\n` +
  `2048000|regular file|1704067400|1704067300|1704067400|0644|-rw-r--r--|root|sdcard_rw|0|1015|12347|u:object_r:sdcard_external:s0\n` +
  `4096|directory|1704067500|1704067400|1704067500|0755|drwxr-xr-x|root|sdcard_rw|0|1015|12348|u:object_r:sdcard_external:s0`;

export const MOCK_BATTERY_OUTPUT = `Current Battery Service state:
  AC powered: false
  USB powered: true
  level: 85
  scale: 100
  voltage: 4200
  temperature: 350
  technology: Li-ion`;

export const MOCK_LOGCAT_OUTPUT =
  `01-15 10:30:45.123  1234  5678 I ActivityManager: START u0\n` +
  `01-15 10:30:45.234  1234  5678 D ActivityManager: Activity resumed\n` +
  `01-15 10:30:45.345  1234  5678 W ActivityManager: Activity paused\n` +
  `01-15 10:30:45.456  1234  5678 E ActivityManager: Activity crashed`;

export const MOCK_PACKAGE_LIST =
  `package:com.android.systemui\n` +
  `package:com.example.app1\n` +
  `package:com.example.app2\n` +
  `package:com.google.android.gms`;

// ============================================================================
// STREAM READING HELPER — for acquirer tests
// ============================================================================

/**
 * Drains a ReadableStream<Uint8Array> and returns the content as a string.
 * Use this in tests instead of blob.text() now that all acquirers return streams.
 */
export async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) { total.set(c, off); off += c.length; }
  return new TextDecoder().decode(total);
}