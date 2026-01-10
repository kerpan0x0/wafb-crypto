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