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
} = {}) {
  const mockCommands = {
    // Shell commands
    shell: vi.fn().mockResolvedValue(''),
    getprop: vi.fn().mockResolvedValue({}),
    
    // Package management
    listPackages: vi.fn().mockResolvedValue(commandOverrides.listPackages || [
      'com.android.vending',
      'com.example.app',
      'com.google.android.gms'
    ]),
    
    getPackageInfo: vi.fn().mockImplementation((packageName: string) => {
      if (commandOverrides.getPackageInfo !== undefined) {
        return Promise.resolve(commandOverrides.getPackageInfo);
      }
      
      return Promise.resolve({
        packageName,
        versionName: '1.0.0',
        versionCode: '100',
        installLocation: '/data/app/package',
        firstInstallTime: '2024-01-01 10:00:00',
        lastUpdateTime: '2024-01-15 14:30:00',
        targetSdk: 33,
        minSdk: 21
      });
    }),

    // Logcat
    getLogcat: vi.fn().mockResolvedValue(
      commandOverrides.getLogcat !== undefined 
        ? commandOverrides.getLogcat 
        : '01-01 10:00:00.000  1234  5678 I Tag: Info message\n' +
          '01-01 10:00:01.000  1234  5678 W Tag: Warning message\n' +
          '01-01 10:00:02.000  1234  5678 E Tag: Error message'
    ),

    // Bugreport
    checkCommandExists: vi.fn().mockResolvedValue(commandOverrides.checkCommandExists ?? true),
    generateBugreportz: vi.fn().mockResolvedValue(
      commandOverrides.generateBugreportz || 'OK:/data/bugreport-2024-01-01.zip'
    ),
    generateBugreportLegacy: vi.fn().mockResolvedValue(
      commandOverrides.generateBugreportLegacy || '/sdcard/bugreport.txt'
    ),
    
    // File operations
    readFile: vi.fn().mockResolvedValue(
      commandOverrides.readFile || new TextEncoder().encode('mock file content')
    ),
    writeFile: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(commandOverrides.deleteFile)
  };

  const mockDevice = {
    commands: mockCommands,
    getProperties: vi.fn().mockResolvedValue(createMockDeviceProperties()),
    isRooted: vi.fn().mockResolvedValue(false),
    getBatteryInfo: vi.fn().mockResolvedValue({
      level: 85,
      temperature: 28,
      voltage: 4200,
      status: '2'
    }),
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