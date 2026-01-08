// Re-export types from core per comodità
export type {
  AcquisitionType,
  AcquisitionStatus,
  AcquisitionProgress,
  AcquisitionResult,
  AcquisitionMetadata,
  AcquisitionSession,
  DeviceProperties
} from '@wafb/core';

// Types UI-specific (se necessari in futuro)
export interface UITheme {
  mode: 'light' | 'dark';
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}