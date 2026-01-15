import { vi } from 'vitest';
import type { Adb } from '@yume-chan/adb';

/**
 * Creates a mock shell socket with customizable stdout output
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

/**
 * Creates a mock sync service for file operations
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
 * Creates a readable stream from binary data
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

/**
 * Creates a complete mock Adb instance
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
