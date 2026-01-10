// packages/core/src/index.ts

// ============================================================================
// ADB Core - Connection and Device Management
// ============================================================================
export { ADBConnection } from './adb/connection';
export type { ConnectionOptions, DeviceInfo } from './adb/connection';

export { ADBDevice } from './adb/device';
export type { DeviceProperties } from './adb/device';

export { ADBCommands } from './adb/commands';
export type { ShellOptions, LogcatOptions } from './adb/commands';

// ============================================================================
// Forensics - Acquisition, Analysis, Export
// ============================================================================

// Acquisition Base Types
export type {
  AcquisitionType,
  AcquisitionStatus,
  AcquisitionConfig,
  AcquisitionProgress,
  AcquisitionResult,
  AcquisitionMetadata,
  AcquisitionSession
} from './forensics/acquisition/types';

export { ACQUISITION_TYPES } from './forensics/acquisition/types';

// Acquisition Modules
export { BugreportAcquirer } from './forensics/acquisition/bugreport';
export type { BugreportConfig } from './forensics/acquisition/bugreport';

// ============================================================================
// Utilities
// ============================================================================
export { Logger } from './utils/logger';
export type { LogLevel, LogEntry } from './utils/logger';

export {
  ADBError,
  ADBConnectionError,
  ADBDeviceNotFoundError,
  ADBCommandError
} from './utils/errors';

export {
  readStreamAsText,
  readStreamAsBytes,
  concatUint8Arrays,
  retry
} from './utils/stream-helpers';

// ============================================================================
// Re-exports from @yume-chan/adb for convenience
// ============================================================================
export type { Adb } from '@yume-chan/adb';