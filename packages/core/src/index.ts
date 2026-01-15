// ============================================================================
// ADB Core - Connection and Device Management
// ============================================================================

export { ADBConnection } from './adb/connection';
export { ADBDevice } from './adb/device';

// Export all ADB types from single source
export type {
  // Connection types
  DeviceInfo,
  ConnectionOptions,

  DeviceProperties,
} from './adb';



// ============================================================================
// Forensics - Acquisition, Analysis, Export
// ============================================================================

// Acquisition Base Types & Acquirer
export type {
  AcquisitionType,
  AcquisitionStatus,
  AcquisitionConfig,
  AcquisitionProgress,
  AcquisitionResult,
  AcquisitionMetadata,
  AcquisitionSession
} from './forensics/acquisition';

export { 
  ACQUISITION_TYPES,
  Acquirer
} from './forensics/acquisition';

export { EnvAcquirer } from './forensics/acquisition/env';
export type { EnvConfig } from './forensics/acquisition/env';

// Acquisition Modules
export { BugreportAcquirer } from './forensics/acquisition/bugreport';
export type { BugreportConfig } from './forensics/acquisition/bugreport';

export { PackagesAcquirer } from './forensics/acquisition/packages';
export type {
  PackagesConfig,
  PackageInfo,
  PackagesData
} from './forensics/acquisition/packages';

export { LogcatAcquirer } from './forensics/acquisition/logcat';
export type {
  LogcatConfig,
  LogcatStats,
  LogcatData
} from './forensics/acquisition/logcat';

export { SystemInfoAcquirer } from './forensics/acquisition/system';
export type {
  SystemInfoConfig,
  SystemInfoData
} from './forensics/acquisition/system';

export { RootBinariesAcquirer } from './forensics/acquisition/root-binaries';
export type { RootBinariesConfig } from './forensics/acquisition/root-binaries';

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