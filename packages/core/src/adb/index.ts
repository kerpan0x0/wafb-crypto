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
export interface DeviceInfo {
  productName: string;
  manufacturerName: string;
  serialNumber: string;
  vendorId: number;
  productId: number;
}

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




// ============================================================================
// COMMAND RESULTS
// ============================================================================