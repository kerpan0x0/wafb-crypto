import { vi } from 'vitest';

/**
 * Crea un mock ReadableStream che restituisce il contenuto specificato
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
 * Crea un mock shell socket per ADB commands
 */
export function createMockShellSocket(output: string) {
  return {
    stdout: createMockReadableStream(output),
    stderr: new ReadableStream(),
    stdin: new WritableStream(),
    exit: Promise.resolve({ code: 0 })
  };
}

/**
 * Crea un mock Adb object completo
 */
export function createMockAdb() {
  return {
    subprocess: {
      shellProtocol: {
        spawn: vi.fn()
      },
      spawn: vi.fn()
    },
    sync: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined)
  };
}

/**
 * Crea un mock sync service per file operations
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

/**
 * Helper per attendere tick asincroni nei test
 */
export function waitForAsync() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

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

/**
 * Crea un mock completo di ADBDevice con ADBCommands mockati
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