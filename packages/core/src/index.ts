// Errori e Utility
export {
  ADBError,
  ADBConnectionError,
  ADBDeviceNotFoundError,
  ADBCommandError
} from './utils/errors';

export { Logger } from './utils/logger';
export type { LogLevel, LogEntry } from './utils/logger';

// Logica Core ADB
export { ADBConnection } from './adb/connection';
export type { ConnectionOptions, DeviceInfo } from './adb/connection';

export { ADBDevice } from './adb/device';
export type { DeviceProperties } from './adb/device';

export { ADBCommands } from './adb/commands';
export type { ShellOptions } from './adb/commands';

// Re-export types from @yume-chan/adb per convenienza
// Questo permette ai consumer di usare i tipi originali senza 
// dover aggiungere @yume-chan/adb come dipendenza diretta.
export type { Adb } from '@yume-chan/adb';