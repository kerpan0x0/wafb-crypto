import { vi } from 'vitest';
import type { Adb } from '@yume-chan/adb';

// ============================================================================
// MOCK READABLE STREAMS
// ============================================================================

/**
 * Crea un mock ReadableStream che restituisce il contenuto specificato
 * Può accettare sia stringhe che Uint8Array
 */
export function createMockReadableStream(content: string | Uint8Array) {
  const data = typeof content === 'string' 
    ? new TextEncoder().encode(content) 
    : content;

  return {
    getReader: () => {
      let readCount = 0;
      return {
        read: async () => {
          if (readCount === 0) {
            readCount++;
            return { done: false, value: data };
          }
          return { done: true, value: undefined };
        },
        releaseLock: vi.fn()
      };
    }
  };
}

/**
 * Creates a readable stream from binary data
 * Alias for createMockReadableStream for backward compatibility
 */
export function createReadableStream(data: Uint8Array) {
  let readCount = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (readCount === 0) {
          readCount++;
          return { done: false, value: data };
        }
        return { done: true, value: undefined };
      },
      releaseLock: vi.fn()
    })
  };
}

// ============================================================================
// MOCK SHELL SOCKETS
// ============================================================================

/**
 * Creates a mock shell socket with customizable stdout output
 * Versione estesa che supporta exitCode personalizzato
 */
export function createMockShellSocket(output: string, exitCode: number = 0) {
  const encoder = new TextEncoder();
  let readCount = 0;

  return {
    stdout: {
      getReader: () => ({
        read: async () => {
          if (readCount === 0) {
            readCount++;
            return { done: false, value: encoder.encode(output) };
          }
          return { done: true, value: undefined };
        },
        releaseLock: vi.fn()
      })
    },
    stderr: new ReadableStream(),
    stdin: new WritableStream(),
    exit: Promise.resolve({ code: exitCode })
  };
}

/**
 * Creates a shell socket that never resolves (for timeout tests)
 */
export function createHangingShellSocket() {
  return {
    stdout: {
      getReader: () => ({
        read: () => new Promise(() => {}),
        releaseLock: vi.fn()
      })
    },
    stderr: new ReadableStream(),
    stdin: new WritableStream(),
    exit: new Promise(() => {})
  };
}

// ============================================================================
// MOCK SYNC SERVICES
// ============================================================================

/**
 * Creates a mock sync service for file operations
 * Versione semplice per command tests
 */
export function createMockSync() {
  return {
    read: vi.fn(),
    write: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined)
  };
}

/**
 * Crea un mock sync service per file operations con opzioni
 * Versione estesa per acquirer tests
 */
export function createMockSyncService(options: {
  readContent?: Uint8Array;
  writeSuccess?: boolean;
} = {}) {
  const { readContent, writeSuccess = true } = options;

  return {
    read: vi.fn().mockReturnValue(
      readContent ? createMockReadableStream(readContent) : null
    ),
    write: vi.fn().mockResolvedValue(writeSuccess ? undefined : Promise.reject(new Error('Write failed'))),
    dispose: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined)
  };
}

// ============================================================================
// MOCK ADB INSTANCES
// ============================================================================

/**
 * Creates a complete mock Adb instance
 * Supporta shellSocket opzionale per command tests
 */
export function createMockAdb(shellSocket?: any): Adb {
  const defaultShellSocket = createMockShellSocket('');
  
  return {
    subprocess: {
      shellProtocol: {
        spawn: vi.fn().mockResolvedValue(shellSocket || defaultShellSocket)
      },
      spawn: vi.fn()
    },
    sync: vi.fn().mockResolvedValue(createMockSync())
  } as unknown as Adb;
}

// ============================================================================
// MOCK DEVICE INFO & PROPERTIES
// ============================================================================

/**
 * Crea mock device info
 */
export function createMockDeviceInfo(overrides = {}) {
  return {
    productName: 'Test Device',
    manufacturerName: 'Test Manufacturer',
    serialNumber: 'TEST123',
    vendorId: 0x18D1,
    productId: 0x4EE7,
    ...overrides
  };
}

/**
 * Crea mock device properties
 */
export function createMockDeviceProperties(overrides = {}) {
  return {
    androidVersion: '13',
    buildId: 'TP1A.220905.004',
    model: 'Test Device',
    manufacturer: 'Test Manufacturer',
    brand: 'Test',
    sdkVersion: 33,
    serialNumber: 'TEST123',
    ...overrides
  };
}

// ============================================================================
// MOCK CONNECTION
// ============================================================================

/**
 * Crea mock ADB connection
 */
export function createMockConnection(connected = true) {
  return {
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(connected),
    getConnectionState: vi.fn().mockReturnValue(connected ? 'connected' : 'disconnected')
  };
}

// ============================================================================
// ASYNC UTILITIES
// ============================================================================

/**
 * Helper per attendere tick asincroni nei test
 */
export function waitForAsync() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// ============================================================================
// PROGRESS CALLBACK UTILITIES
// ============================================================================

/**
 * Helper per creare mock progress callback
 */
export function createMockProgressCallback() {
  const callback = vi.fn();
  
  return {
    callback,
    getLastProgress: () => {
      const calls = callback.mock.calls;
      return calls.length > 0 ? calls[calls.length - 1][0] : null;
    },
    getProgressHistory: () => callback.mock.calls.map(call => call[0])
  };
}

// ============================================================================
// MOCK ADB DEVICE WITH COMMANDS (COMPLETO)
// ============================================================================

/**
 * Crea un mock completo di ADBDevice con ADBCommands mockati
 * Questa è la factory principale per creare device mock completi
 */
export function createMockADBDeviceWithCommands(commandOverrides: {
  listPackages?: string[];
  getPackageInfo?: any;
  getLogcat?: string;
  checkCommandExists?: boolean;
  generateBugreportz?: string;
  generateBugreportLegacy?: string;
  readFile?: Uint8Array;
  deleteFile?: any;
  shellOutput?: string;
  getPropOutput?: Record<string, string>;
  rootBinaryPaths?: Record<string, string>;
} = {}) {
  // Create default shell outputs
  const defaultPackageList = commandOverrides.listPackages || [
    'com.android.vending',
    'com.example.app',
    'com.google.android.gms'
  ];

  const defaultRootBinaryPaths = commandOverrides.rootBinaryPaths || {
    'su': '/system/bin/su\n/system/xbin/su',
    'busybox': '/system/bin/busybox',
    'magisk': '/data/adb/magisk',
    'magiskhide': '/data/adb/magisk/magiskhide',
    'supersu': '',
    'Superuser.apk': '',
    'KingoUser.apk': '',
    'SuperSu.apk': '',
    'magiskinit': '/data/adb/magisk/magiskinit',
    'magiskpolicy': '/data/adb/magisk/magiskpolicy',
    'magiskboot': '/data/adb/magisk/magiskboot'
  };

  const packageListOutput = defaultPackageList.map(pkg => `package:${pkg}`).join('\n');

  // Mock shell command to return appropriate output based on command
  const mockShellSpawn = vi.fn().mockImplementation((command: string) => {
    let output = '';

    // Handle different commands
    if (command.includes('pm list packages')) {
      output = packageListOutput;
    } else if (command.includes('dumpsys package')) {
      const pkgName = command.match(/dumpsys package ([\w.]+)/)?.[1];
      if (pkgName && commandOverrides.getPackageInfo) {
        output = `Package [${pkgName}]
versionName=${commandOverrides.getPackageInfo.versionName || '1.0.0'}
versionCode=${commandOverrides.getPackageInfo.versionCode || '100'}`;
      } else if (pkgName) {
        output = `Package [${pkgName}]
versionName=1.0.0
versionCode=100
firstInstallTime=2024-01-01 10:00:00
lastUpdateTime=2024-01-15 14:30:00
targetSdk=33
minSdk=21`;
      }
    } else if (command.includes('logcat')) {
      output = commandOverrides.getLogcat !== undefined 
        ? commandOverrides.getLogcat 
        : '01-01 10:00:00.000  1234  5678 I Tag: Info message\n' +
          '01-01 10:00:01.000  1234  5678 W Tag: Warning message\n' +
        '01-01 10:00:02.000  1234  5678 E Tag: Error message';
    } else if (command.includes('bugreportz')) {
      output = commandOverrides.generateBugreportz || 'OK:/data/bugreport-2024-01-01.zip';
    } else if (command === 'bugreport') {
      output = commandOverrides.generateBugreportLegacy || '/sdcard/bugreport.txt';
    } else if (command.includes('which -a')) {
      const binaryName = command.replace('which -a ', '').trim();
      output = defaultRootBinaryPaths[binaryName as keyof typeof defaultRootBinaryPaths] || '';
    } else if (command.includes('which')) {
      output = commandOverrides.checkCommandExists ? '/system/bin/' + command.split(' ').pop() : '';
    } else if (command === 'getprop') {
      const props = commandOverrides.getPropOutput || {
        'ro.build.version.release': '13',
        'ro.build.id': 'TP1A.220905.004',
        'ro.product.model': 'Test Device',
        'ro.product.manufacturer': 'Test Manufacturer',
        'ro.product.brand': 'Test',
        'ro.build.version.sdk': '33'
      };
      output = Object.entries(props).map(([key, value]) => `[${key}]: [${value}]`).join('\n');
    } else {
      output = commandOverrides.shellOutput || '';
    }

    return Promise.resolve({
      stdout: createMockReadableStream(output),
      stderr: createMockReadableStream(''),
      stdin: new WritableStream(),
      exit: Promise.resolve({ code: 0 })
    });
  });

  // Mock sync service for file operations
  const mockSync = vi.fn().mockResolvedValue({
    read: vi.fn().mockReturnValue(createMockReadableStream(
      commandOverrides.readFile || new TextEncoder().encode('mock file content')
    )),
    write: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined)
  });

  const mockAdb = {
    subprocess: {
      shellProtocol: {
        spawn: mockShellSpawn
      },
      spawn: vi.fn()
    },
    sync: mockSync,
    close: vi.fn().mockResolvedValue(undefined)
  };

  const mockDevice = {
    adb: mockAdb as any,
    getProperties: vi.fn().mockResolvedValue(createMockDeviceProperties()),
    isRooted: vi.fn().mockResolvedValue(false),
    getBatteryInfo: vi.fn().mockResolvedValue({
      level: 85,
      temperature: 28,
      voltage: 4200,
      status: '2'
    }),
    getNetworkInfo: vi.fn().mockResolvedValue({
      wifiEnabled: true,
      mobileDataEnabled: false,
      airplaneModeOn: false
    }),
    getStorageInfo: vi.fn().mockResolvedValue({
      totalInternal: '64GB',
      availableInternal: '32GB'
    }),
    getMemoryInfo: vi.fn().mockResolvedValue({
      totalRam: '8GB',
      availableRam: '4GB',
      lowMemory: false,
      threshold: '1GB'
    }),
    getSensors: vi.fn().mockResolvedValue([
      { name: 'Accelerometer', type: 'android.sensor.accelerometer' },
      { name: 'Gyroscope', type: 'android.sensor.gyroscope' }
    ]),
    info: createMockDeviceInfo(),
    isConnected: vi.fn().mockReturnValue(true),
    disconnect: vi.fn().mockResolvedValue(undefined)
  };

  return mockDevice;
}

// ============================================================================
// SPECIALIZED DEVICE MOCKS
// ============================================================================

/**
 * Crea un mock device specifico per test SELinux
 */
export function createMockADBDeviceForSELinux(selinuxMode: 'Enforcing' | 'Permissive' | 'Disabled' = 'Enforcing') {
  return createMockADBDeviceWithCommands({
    shellOutput: selinuxMode, // For getenforce
    getPropOutput: {
      'ro.build.version.release': '13',
      'ro.build.id': 'TP1A.220905.004',
      'ro.product.model': 'Test Device',
      'ro.product.manufacturer': 'Test Manufacturer',
      'ro.product.brand': 'Test',
      'ro.build.version.sdk': '33',
      'ro.build.selinux': '30'
    }
  });
}

/**
 * Crea un mock device specifico per test FileAcquirer
 * Configura i mock per FindCommand e StatBatchCommand
 */
export function createMockADBDeviceForFileAcquirer(overrides: {
  findOutput?: string;
  statBatchOutput?: string;
  getPropOutput?: Record<string, string>;
} = {}) {
  const findOutput = overrides.findOutput !== undefined ? overrides.findOutput : MOCK_FIND_OUTPUT;
  const statBatchOutput = overrides.statBatchOutput !== undefined ? overrides.statBatchOutput : MOCK_STAT_BATCH_OUTPUT;
  const getPropOutput = overrides.getPropOutput || {
    'ro.build.version.release': '13',
    'ro.build.id': 'TP1A.220905.004',
    'ro.product.model': 'Test Device',
    'ro.product.manufacturer': 'Test Manufacturer',
    'ro.product.brand': 'Test',
    'ro.build.version.sdk': '33'
  };

  const device = createMockADBDeviceWithCommands({
    getPropOutput
  });

  // Override spawn to handle find and stat commands
  vi.spyOn(device.adb.subprocess.shellProtocol, 'spawn').mockImplementation((command: string) => {
    let output = '';
    
    if (command.includes('find')) {
      output = findOutput;
    } else if (command.includes('stat')) {
      output = statBatchOutput;
    } else if (command.includes('getprop')) {
      output = Object.entries(getPropOutput)
        .map(([key, value]) => `[${key}]: [${value}]`)
        .join('\n');
    }

    return Promise.resolve({
      stdout: {
        getReader: () => {
          let readCount = 0;
          const data = new TextEncoder().encode(output);
          return {
            read: async () => {
              if (readCount === 0) {
                readCount++;
                return { done: false, value: data };
              }
              return { done: true, value: undefined };
            },
            releaseLock: vi.fn()
          };
        }
      },
      stderr: new ReadableStream(),
      stdin: new WritableStream(),
      exit: Promise.resolve({ code: 0 })
    } as any);
  });

  return device;
}

// ============================================================================
// DOM MOCKS PER ACQUIRERS
// ============================================================================

/**
 * Mock globali per DOM APIs usate dagli acquirer (download)
 */
export function setupAcquirerDOMMocks() {
  // Mock anchor element per download
  const mockAnchor = {
    href: '',
    download: '',
    click: vi.fn(),
    remove: vi.fn()
  };

  const createElementSpy = vi.spyOn(document, 'createElement')
    .mockReturnValue(mockAnchor as any);
  
  const appendChildSpy = vi.spyOn(document.body, 'appendChild')
    .mockImplementation(() => mockAnchor as any);
  
  const removeChildSpy = vi.spyOn(document.body, 'removeChild')
    .mockImplementation(() => mockAnchor as any);

  // Mock URL APIs
  const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL')
    .mockReturnValue('blob:mock-url');
  
  const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL')
    .mockImplementation(() => {});

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
    }
  };
}

// ============================================================================
// MOCK DATA CONSTANTS (da command tests)
// ============================================================================

/**
 * Sample dumpsys battery output for testing
 */
export const MOCK_BATTERY_OUTPUT = `Current Battery Service state:
  AC powered: false
  USB powered: true
  Wireless powered: false
  Max charging current: 500000
  Max charging voltage: 5000000
  Charge counter: 2500000
  status: 2
  health: 2
  present: true
  level: 85
  scale: 100
  voltage: 4200
  temperature: 350
  technology: Li-ion`;

/**
 * Sample dumpsys package output for testing
 */
export const MOCK_PACKAGE_INFO = `Packages:
  Package [com.example.app] (12345678):
    userId=10123
    pkg=Package{hash12345 com.example.app}
    codePath=/data/app/com.example.app-hash
    resourcePath=/data/app/com.example.app-hash
    legacyNativeLibraryDir=/data/app/com.example.app-hash/lib
    primaryCpuAbi=arm64-v8a
    secondaryCpuAbi=null
    versionCode=100 minSdk=21 targetSdk=33
    versionName=1.0.0
    splits=[base]
    apkSigningVersion=3
    applicationInfo=ApplicationInfo{hash com.example.app}
    flags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ALLOW_BACKUP ]
    privateFlags=[ PRIVATE_FLAG_ACTIVITIES_RESIZE_MODE_RESIZEABLE ]
    dataDir=/data/user/0/com.example.app
    supportsScreens=[small, medium, large, xlarge, resizeable, anyDensity]
    timeStamp=2025-01-15 10:00:00
    firstInstallTime=2025-01-10 08:30:00
    lastUpdateTime=2025-01-15 10:00:00
    signatures=PackageSignatures{hash12345 version:3, signatures:[hash], pastSigningCertificates=[hash]}
    installPermissionsFixed=true
    pkgFlags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ALLOW_BACKUP ]
    requested permissions:
      android.permission.INTERNET: granted=true
      android.permission.ACCESS_NETWORK_STATE: granted=true
      android.permission.CAMERA: granted=true`;

/**
 * Sample pm list packages output
 */
export const MOCK_PACKAGE_LIST = `package:com.android.systemui
package:com.example.app1
package:com.example.app2
package:com.google.android.gms`;

/**
 * Sample logcat output
 */
export const MOCK_LOGCAT_OUTPUT = `01-15 10:30:45.123  1234  5678 I ActivityManager: START u0 {act=android.intent.action.MAIN}
01-15 10:30:45.234  1234  5678 D ActivityManager: Activity resumed
01-15 10:30:45.345  1234  5678 W ActivityManager: Activity paused
01-15 10:30:45.456  1234  5678 E ActivityManager: Activity crashed`;

/**
 * Sample find command output (file list)
 */
export const MOCK_FIND_OUTPUT = `/sdcard/Documents/test1.txt
/sdcard/Pictures/photo.jpg
/sdcard/Download/app.apk
/sdcard/DCIM/Camera/IMG_001.jpg`;

/**
 * Sample stat batch command output (pipe-separated format)
 * Format: size|type|mtime|atime|ctime|octal_perms|human_perms|owner|group|uid|gid|inode
 */
export const MOCK_STAT_BATCH_OUTPUT = `1234|regular file|1704067200|1704067100|1704067200|0644|-rw-r--r--|root|sdcard_rw|0|1015|12345
567890|regular file|1704067300|1704067200|1704067300|0644|-rw-r--r--|root|sdcard_rw|0|1015|12346
2048000|regular file|1704067400|1704067300|1704067400|0644|-rw-r--r--|root|sdcard_rw|0|1015|12347
4096|directory|1704067500|1704067400|1704067500|0755|drwxr-xr-x|root|sdcard_rw|0|1015|12348`;