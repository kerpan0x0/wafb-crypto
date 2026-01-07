// packages/web/src/types/index.ts

import type { DeviceProperties } from '@wafb/core';

export type BugreportStatus = 
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'generating'
  | 'downloading'
  | 'success'
  | 'error';

export interface BugreportProgress {
  status: BugreportStatus;
  progress: number;
  message: string;
  deviceInfo?: DeviceProperties;
}

export interface BugreportResult {
  success: boolean;
  fileName?: string;
  fileSize?: number;
  error?: string;
}

// Re-export
export type { DeviceProperties } from '@wafb/core';