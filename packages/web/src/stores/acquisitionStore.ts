import { create } from 'zustand';
import type {
  AcquisitionType,
  AcquisitionStatus,
  AcquisitionResult,
  AcquisitionSession,
  AcquisitionMetadata,
  ACQUISITION_TYPES
} from '@wafb/core';
import type { DeviceProperties } from '@wafb/core';

/**
 * Stato di una singola acquisizione
 */
interface AcquisitionState {
  type: AcquisitionType;
  enabled: boolean;
  status: AcquisitionStatus;
  progress: number;
  message: string;
  result?: AcquisitionResult;
  metadata: AcquisitionMetadata;
}

/**
 * Store per gestire lo stato delle acquisizioni
 */
interface AcquisitionStore {
  // Sessione corrente
  session: AcquisitionSession | null;

  // Acquisizioni disponibili e loro stato
  acquisitions: Map<AcquisitionType, AcquisitionState>;

  // Device info
  deviceInfo: DeviceProperties | null;

  // Azioni
  initializeAcquisitions: (deviceInfo: DeviceProperties, isRooted: boolean) => void;
  toggleAcquisition: (type: AcquisitionType) => void;
  selectAll: () => void;
  deselectAll: () => void;
  startSession: () => void;
  updateProgress: (type: AcquisitionType, progress: number, message: string, status: AcquisitionStatus) => void;
  completeAcquisition: (type: AcquisitionType, result: AcquisitionResult) => void;
  endSession: () => void;
  reset: () => void;

  // Computed
  getSelectedAcquisitions: () => AcquisitionType[];
  getTotalProgress: () => number;
  canStartSession: () => boolean;
  isSessionActive: () => boolean;
}

export const useAcquisitionStore = create<AcquisitionStore>((set, get) => ({
  session: null,
  acquisitions: new Map(),
  deviceInfo: null,

  initializeAcquisitions: (deviceInfo: DeviceProperties, isRooted: boolean) => {
    // Import ACQUISITION_TYPES dinamicamente per evitare circular deps
    // Usa globalThis invece di window per compatibilità con test environment
    const types = (globalThis as any).__ACQUISITION_TYPES__ || {};

    const acquisitions = new Map<AcquisitionType, AcquisitionState>();

    const metadataList = Object.values(types) as AcquisitionMetadata[];
    metadataList.forEach((metadata) => {
      // Disabilita acquisizioni che richiedono root se device non è rooted
      const canEnable = !metadata.requiresRoot || isRooted;

      // Disabilita acquisizioni che richiedono SDK version più alta
      const sdkCompatible = deviceInfo.sdkVersion >= metadata.minSdkVersion;

      acquisitions.set(metadata.id, {
        type: metadata.id,
        enabled: canEnable && sdkCompatible && metadata.defaultEnabled,
        status: 'pending',
        progress: 0,
        message: '',
        metadata
      });
    });

    set({ acquisitions, deviceInfo });
  },

  toggleAcquisition: (type: AcquisitionType) => {
    const { acquisitions } = get();
    const acquisition = acquisitions.get(type);

    if (acquisition && acquisition.status === 'pending') {
      acquisition.enabled = !acquisition.enabled;
      set({ acquisitions: new Map(acquisitions) });
    }
  },

  selectAll: () => {
    const { acquisitions } = get();
    acquisitions.forEach(acq => {
      if (acq.status === 'pending') {
        acq.enabled = true;
      }
    });
    set({ acquisitions: new Map(acquisitions) });
  },

  deselectAll: () => {
    const { acquisitions } = get();
    acquisitions.forEach(acq => {
      if (acq.status === 'pending') {
        acq.enabled = false;
      }
    });
    set({ acquisitions: new Map(acquisitions) });
  },

  startSession: () => {
    const { acquisitions, deviceInfo } = get();

    if (!deviceInfo) {
      throw new Error('Device info not available');
    }

    const selectedAcquisitions = Array.from(acquisitions.values())
      .filter(acq => acq.enabled)
      .map(acq => ({
        type: acq.type,
        status: 'pending' as AcquisitionStatus,
        progress: 0
      }));

    const session: AcquisitionSession = {
      id: `session-${Date.now()}`,
      startTime: new Date(),
      deviceInfo,
      acquisitions: selectedAcquisitions,
      totalProgress: 0,
      status: 'running'
    };

    set({ session });
  },

  updateProgress: (type: AcquisitionType, progress: number, message: string, status: AcquisitionStatus) => {
    const { acquisitions, session } = get();
    const acquisition = acquisitions.get(type);

    if (acquisition) {
      acquisition.progress = progress;
      acquisition.message = message;
      acquisition.status = status;
      set({ acquisitions: new Map(acquisitions) });
    }

    if (session) {
      const acqInSession = session.acquisitions.find((a: { type: AcquisitionType }) => a.type === type);
      if (acqInSession) {
        acqInSession.status = status;
        acqInSession.progress = progress;
      }

      // Update total progress
      const totalProgress = get().getTotalProgress();
      session.totalProgress = totalProgress;

      set({ session: { ...session } });
    }
  },

  completeAcquisition: (type: AcquisitionType, result: AcquisitionResult) => {
    const { acquisitions, session } = get();
    const acquisition = acquisitions.get(type);

    if (acquisition) {
      acquisition.result = result;
      acquisition.status = result.success ? 'completed' : 'failed';
      acquisition.progress = 100;
      set({ acquisitions: new Map(acquisitions) });
    }

    if (session) {
      const acqInSession = session.acquisitions.find((a: any) => a.type === type);
      if (acqInSession) {
        acqInSession.result = result;
        acqInSession.status = result.success ? 'completed' : 'failed';
        acqInSession.progress = 100;
      }
      set({ session: { ...session } });
    }
  },

  endSession: () => {
    const { session } = get();
    if (session) {
      session.endTime = new Date();

      // Determina status finale
      const allCompleted = session.acquisitions.every(
        (a: any) => a.status === 'completed' || a.status === 'skipped'
      );
      const anyFailed = session.acquisitions.some((a: any) => a.status === 'failed');

      session.status = anyFailed ? 'failed' : allCompleted ? 'completed' : 'cancelled';

      set({ session: { ...session } });
    }
  },

  reset: () => {
    set({
      session: null,
      acquisitions: new Map(),
      deviceInfo: null
    });
  },

  // Computed
  getSelectedAcquisitions: () => {
    const { acquisitions } = get();
    return Array.from(acquisitions.values())
      .filter(acq => acq.enabled)
      .map(acq => acq.type);
  },

  getTotalProgress: () => {
    const { acquisitions } = get();
    const enabled = Array.from(acquisitions.values()).filter(acq => acq.enabled);

    if (enabled.length === 0) return 0;

    const totalProgress = enabled.reduce((sum, acq) => sum + acq.progress, 0);
    return Math.round(totalProgress / enabled.length);
  },

  canStartSession: () => {
    const { acquisitions, session } = get();
    const hasSelected = Array.from(acquisitions.values()).some(acq => acq.enabled);
    return hasSelected && !session;
  },

  isSessionActive: () => {
    const { session } = get();
    return session !== null && session.status === 'running';
  }
}));

// Helper per inizializzare ACQUISITION_TYPES nel globalThis
// Questo evita import circolari
export function initializeAcquisitionTypes(types: typeof ACQUISITION_TYPES) {
  (globalThis as any).__ACQUISITION_TYPES__ = types;
}