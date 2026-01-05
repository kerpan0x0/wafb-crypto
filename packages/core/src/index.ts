// packages/core/src/index.ts

// Errori e Utility
export {
  ADBError,
  ADBConnectionError,
  ADBDeviceNotFoundError,
  ADBCommandError
} from './utils/errors';

export { Logger } from './utils/logger';
export type { LogLevel, LogEntry } from './utils/logger';

export {
  readStreamAsText,
  readStreamAsBytes,
  concatUint8Arrays,
  retry
} from './utils/stream-helpers';

// Logica Core ADB
export { ADBConnection } from './adb/connection';
export type { ConnectionOptions, DeviceInfo } from './adb/connection';

export { ADBDevice } from './adb/device';
export type { DeviceProperties } from './adb/device';

export { ADBCommands } from './adb/commands';
export type { ShellOptions, LogcatOptions } from './adb/commands';

// Re-export types from @yume-chan/adb per convenienza
export type { Adb } from '@yume-chan/adb';