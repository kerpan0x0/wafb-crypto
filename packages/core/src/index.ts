// ============================================================================
// ADB Core - Connection and Device Management
// ============================================================================

export { ADBConnection } from './adb/connection';
export { ADBDevice } from './adb';

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

export { SettingsAcquirer } from './forensics/acquisition/settings';
export type { SettingsConfig } from './forensics/acquisition/settings';

export { MountAcquirer } from './forensics/acquisition/mount';

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

export { LogAcquirer } from './forensics/acquisition/logs';
export type {
  LogConfig,
  LogData
} from './forensics/acquisition/logs';

export { SystemInfoAcquirer } from './forensics/acquisition/system';
export type {
  SystemInfoConfig,
  SystemInfoData
} from './forensics/acquisition/system';

export { RootBinariesAcquirer } from './forensics/acquisition/root-binaries';
export type { RootBinariesConfig } from './forensics/acquisition/root-binaries';

export { SELinuxAcquirer } from './forensics/acquisition/selinux'
export type { SELinuxConfig } from './forensics/acquisition/selinux'

export { ProcessAcquirer } from './forensics/acquisition/process'
export type { ProcessConfig } from './forensics/acquisition/process'

export { ServicesAcquirer } from './forensics/acquisition/services'
export type { ServicesConfig } from './forensics/acquisition/services'

export { FileAcquirer } from './forensics/acquisition/files'
export type { FileAcquisitionConfig } from './forensics/acquisition/files'

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