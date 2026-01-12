/**
 * ADB Types - Single source of truth for all ADB-related types
 * 
 * USAGE:
 * - Import directly: import type { BatteryInfo } from '@wafb/core/adb/types'
 * - Or via index: import type { BatteryInfo } from '@wafb/core'
 * 
 */

// ============================================================================
// CONNECTION TYPES
// ============================================================================

/**
 * USB device information (hardware level)
 */
export interface DeviceInfo {
  productName: string;
  manufacturerName: string;
  serialNumber: string;
  vendorId: number;
  productId: number;
}

/**
 * Options for establishing ADB connection
 */
export interface ConnectionOptions {
  retryAttempts?: number;
  retryDelay?: number;
  timeout?: number;
}

// ============================================================================
// DEVICE PROPERTIES (Android OS level)
// ============================================================================

/**
 * Android device system properties
 */
export interface DeviceProperties {
  androidVersion: string;
  buildId: string;
  model: string;
  manufacturer: string;
  brand: string;
  sdkVersion: number;
  serialNumber: string;
}

/**
 * Battery status information
 */
export interface BatteryInfo {
  level: number;
  temperature: number;
  voltage: number;
  status: string;
  health?: string;
  technology?: string;
  present?: boolean;
}

/**
 * Network configuration
 */
export interface NetworkInfo {
  wifiEnabled: boolean;
  mobileDataEnabled: boolean;
  airplaneModeOn: boolean;
  activeNetworkType?: string;
  ipAddress?: string;
  macAddress?: string;
}

/**
 * Storage information
 */
export interface StorageInfo {
  totalInternal: string;
  availableInternal: string;
  totalExternal?: string;
  availableExternal?: string;
}

/**
 * Memory information
 */
export interface MemoryInfo {
  totalRam: string;
  availableRam: string;
  lowMemory: boolean;
  threshold: string;
}

/**
 * Device sensor information
 */
export interface SensorInfo {
  name: string;
  type: string;
  vendor?: string;
  version?: string;
  power?: string;
  maxRange?: string;
}

// ============================================================================
// COMMAND OPTIONS
// ============================================================================

/**
 * Options for shell command execution
 */
export interface ShellOptions {
  timeout?: number;
}

/**
 * Options for logcat acquisition
 */
export interface LogcatOptions {
  buffer?: 'main' | 'system' | 'radio' | 'events' | 'crash' | 'default' | 'all';
  filter?: string;
  maxLines?: number;
  dump?: boolean;
}

/**
 * Options for listing packages
 */
export interface PackageListOptions {
  includeSystem?: boolean;
  timeout?: number;
}

/**
 * Options for getting package info
 */
export interface PackageInfoOptions {
  includePermissions?: boolean;
  timeout?: number;
}

/**
 * Package information result
 */
export interface PackageInfoResult {
  packageName: string;
  versionName: string;
  versionCode: string;
  installLocation: string;
  firstInstallTime: string;
  lastUpdateTime: string;
  targetSdk?: number;
  minSdk?: number;
  permissions?: string[];
}