// ============================================================================
// ADB Core - Connection and Device Management
// ============================================================================

export { ADBConnection } from './adb/connection';
export { Device } from './adb';

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
  AcquisitionSession,
  AcquisitionFile,
} from './forensics/acquisition';

export { ACQUISITION_TYPES, Acquirer } from './forensics/acquisition';

export { BackupAcquirer } from './forensics/acquisition/backup';
export type { BackupConfig } from './forensics/acquisition/backup';

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
  PackageFile,
  PackageCertificate,
} from './forensics/acquisition/packages';

export { LogcatAcquirer } from './forensics/acquisition/logcat';
export type { LogcatConfig, LogcatStats, LogcatData } from './forensics/acquisition/logcat';

export { LogAcquirer } from './forensics/acquisition/logs';
export type { LogConfig, LogData } from './forensics/acquisition/logs';

export { SystemInfoAcquirer } from './forensics/acquisition/system';
export type { SystemInfoConfig, SystemInfoData } from './forensics/acquisition/system';

export { RootBinariesAcquirer } from './forensics/acquisition/root-binaries';
export type { RootBinariesConfig } from './forensics/acquisition/root-binaries';

export { SELinuxAcquirer } from './forensics/acquisition/selinux';
export type { SELinuxConfig } from './forensics/acquisition/selinux';

export { ProcessAcquirer } from './forensics/acquisition/process';
export type { ProcessConfig } from './forensics/acquisition/process';

export { ServicesAcquirer } from './forensics/acquisition/services';
export type { ServicesConfig } from './forensics/acquisition/services';

export { FileAcquirer } from './forensics/acquisition/files';
export type { FileAcquisitionConfig } from './forensics/acquisition/files';

export { TmpAcquirer } from './forensics/acquisition/tmp';
export type { TmpAcquirerConfig } from './forensics/acquisition/tmp';

export { DumpsysAcquirer } from './forensics/acquisition/dumpsys';
export type { DumpsysConfig } from './forensics/acquisition/dumpsys';

// ============================================================================
// Utilities
// ============================================================================

export { Logger } from './utils/logger';
export type { LogLevel, LogEntry } from './utils/logger';

export {
  ADBError,
  ADBConnectionError,
  ADBDeviceNotFoundError,
  ADBCommandError,
} from './utils/errors';

export {
  readStreamAsText,
  readStreamAsBytes,
  concatUint8Arrays,
  retry,
} from './utils/stream-helpers';

export { StreamingZipWriter } from './utils/streaming-zip'

// ============================================================================
// Re-exports from @yume-chan/adb for convenience
// ============================================================================

export type { Adb } from '@yume-chan/adb';

// ============================================================================
// Protected acquisition (thesis extension)
// ============================================================================

export {
  monitorSource,
  evaluateSourceOutcome,
} from './utils/source-monitor';
export type {
  SourceOutcome,
  SourceEndCause,
  SourceVerdict,
  MonitoredSource,
} from './utils/source-monitor';

export { hashingPassthrough, rechunk, byteCounter, bytesToStream } from './utils/stream-helpers';
export type { ZipEntryInfo, ZipWriterState } from './utils/streaming-zip';

export {
  SourceIdleTimeoutError,
  AcquisitionAbortedError,
  isAbortError,
} from './utils/errors';

export {
  validateRecipient,
  checkRecipientShape,
  canonicaliseRecipient,
  computeKeyId,
  formatKeyId,
  keyIdMatches,
  recipientStateFromInput,
  confirmRecipient,
  RecipientError,
  KeyIdMismatchError,
  KEY_ID_DOMAIN,
  RECIPIENT_TYPE,
} from './protection/recipient';
export type {
  ValidatedRecipient,
  RecipientErrorCode,
  RecipientVerificationState,
  RecipientConfirmation,
  VerificationMethod,
} from './protection/recipient';

export {
  createInvite,
  parseInvite,
  inviteFromHash,
  inviteUrl,
  generateCaseRef,
  InviteError,
  INVITE_VERSION,
} from './protection/invite';
export type { InvitePayload, ParsedInvite, InviteErrorCode } from './protection/invite';

export {
  AgeStreamEncryptor,
  AgeStreamDecryptor,
  agePayloadSize,
  collectBytes,
  AGE_STREAM_CHUNK,
} from './protection/age-stream';
export type { EncryptedStream } from './protection/age-stream';

export {
  SessionCoordinator,
  InvalidTransitionError,
  TERMINAL_STATES,
} from './protection/session';
export type {
  SessionConfig,
  ProtectedSessionConfig,
  LegacySessionConfig,
  SessionState,
  ModuleTask,
  ModuleContext,
  ModuleUpdate,
  ArtifactProgress,
  SessionLogEntry,
  SessionEvents,
  SessionResult,
  SessionDeps,
} from './protection/session';

export {
  buildDescriptor,
  formatBlock,
  formatBlocksEqual,
  artifactId,
  DESCRIPTOR_ENTRY,
  PROTECTED_MANIFEST_ENTRY,
  LEGACY_MANIFEST_ENTRY,
  MANIFEST_SCHEMA,
  MANIFEST_SCHEMA_VERSION,
  ARCHIVE_FORMAT,
  RULES_VERSION,
} from './protection/manifest';
export type {
  ManifestV1,
  ArchiveDescriptor,
  FormatBlock,
  ArtifactRecord,
  ArtifactStatus,
  ArtifactVerdict,
  ModuleRecord,
  ModuleStatus,
  ErrorRecord,
  SessionOutcome,
  ProtectionMode,
} from './protection/manifest';
