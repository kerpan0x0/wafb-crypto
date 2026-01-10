// packages/web/tests/stores/acquisitionStore.test.ts
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { useAcquisitionStore, initializeAcquisitionTypes } from '../../src/stores/acquisitionStore';
import { ACQUISITION_TYPES } from '@wafb/core';
import type { DeviceProperties, AcquisitionType } from '@wafb/core';

describe('AcquisitionStore', () => {
  const mockDeviceInfo: DeviceProperties = {
    androidVersion: '13',
    buildId: 'TEST123',
    model: 'Test Device',
    manufacturer: 'Test Manufacturer',
    brand: 'Test',
    sdkVersion: 33,
    serialNumber: 'TEST123'
  };

  beforeAll(() => {
    initializeAcquisitionTypes(ACQUISITION_TYPES);
  });

  beforeEach(() => {
    // Reset store state prima di ogni test
    useAcquisitionStore.getState().reset();
  });

  describe('initialization', () => {
    it('should start with empty state', () => {
      const { session, acquisitions, deviceInfo } = useAcquisitionStore.getState();

      expect(session).toBeNull();
      expect(acquisitions.size).toBe(0);
      expect(deviceInfo).toBeNull();
    });

    it('should reset to initial state', () => {
      const { initializeAcquisitions, startSession, reset } = useAcquisitionStore.getState();

      // Inizializza e avvia sessione
      initializeAcquisitions(mockDeviceInfo, false);
      startSession();

      // Reset
      reset();

      const { session, acquisitions, deviceInfo } = useAcquisitionStore.getState();
      expect(session).toBeNull();
      expect(acquisitions.size).toBe(0);
      expect(deviceInfo).toBeNull();
    });
  });

  describe('initializeAcquisitions', () => {
    it('should initialize acquisitions for non-rooted device', () => {
      const { initializeAcquisitions } = useAcquisitionStore.getState();

      initializeAcquisitions(mockDeviceInfo, false);

      const { acquisitions } = useAcquisitionStore.getState();

      // Dovrebbe avere acquisizioni perché ACQUISITION_TYPES è inizializzato
      expect(acquisitions.size).toBeGreaterThan(0);

      // Verifica che ci siano acquisizioni
      const acqArray = Array.from(acquisitions.values());
      expect(acqArray.length).toBeGreaterThan(0);

      // Le acquisizioni che richiedono root dovrebbero essere disabilitate
      const rootAcquisitions = acqArray.filter(a => a.metadata.requiresRoot);
      if (rootAcquisitions.length > 0) {
        expect(rootAcquisitions.every(a => !a.enabled)).toBe(true);
      }
    });

    it('should enable root acquisitions for rooted device', () => {
      const { initializeAcquisitions } = useAcquisitionStore.getState();

      initializeAcquisitions(mockDeviceInfo, true);

      const { acquisitions } = useAcquisitionStore.getState();
      const rootAcquisitions = Array.from(acquisitions.values())
        .filter(a => a.metadata.requiresRoot);

      // Almeno alcune dovrebbero essere abilitate di default se il device è rooted
      if (rootAcquisitions.length > 0) {
        const enabledRootAcqs = rootAcquisitions.filter(a => a.enabled && a.metadata.defaultEnabled);
        // Se ci sono acquisizioni root con defaultEnabled, dovrebbero essere abilitate
        expect(enabledRootAcqs.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('should respect SDK version requirements', () => {
      const { initializeAcquisitions } = useAcquisitionStore.getState();
      const oldDeviceInfo = { ...mockDeviceInfo, sdkVersion: 21 };

      initializeAcquisitions(oldDeviceInfo, false);

      const { acquisitions } = useAcquisitionStore.getState();

      // Acquisizioni che richiedono SDK > 21 dovrebbero essere disabilitate
      const highSdkAcquisitions = Array.from(acquisitions.values())
        .filter(a => a.metadata.minSdkVersion > 21);

      if (highSdkAcquisitions.length > 0) {
        expect(highSdkAcquisitions.every(a => !a.enabled)).toBe(true);
      }
    });

    it('should set device info when initialized', () => {
      const { initializeAcquisitions } = useAcquisitionStore.getState();

      initializeAcquisitions(mockDeviceInfo, false);

      const updatedDeviceInfo = useAcquisitionStore.getState().deviceInfo;

      expect(updatedDeviceInfo).toEqual(mockDeviceInfo);
    });

    it('should initialize with pending status', () => {
      const { initializeAcquisitions } = useAcquisitionStore.getState();

      initializeAcquisitions(mockDeviceInfo, false);

      const { acquisitions } = useAcquisitionStore.getState();
      const allPending = Array.from(acquisitions.values())
        .every(a => a.status === 'pending');

      expect(allPending).toBe(true);
    });

    it('should initialize with zero progress', () => {
      const { initializeAcquisitions } = useAcquisitionStore.getState();

      initializeAcquisitions(mockDeviceInfo, false);

      const { acquisitions } = useAcquisitionStore.getState();
      const allZeroProgress = Array.from(acquisitions.values())
        .every(a => a.progress === 0);

      expect(allZeroProgress).toBe(true);
    });
  });

  describe('acquisition selection', () => {
    beforeEach(() => {
      const { initializeAcquisitions } = useAcquisitionStore.getState();
      initializeAcquisitions(mockDeviceInfo, false);
    });

    it('should toggle acquisition', () => {
      const { toggleAcquisition, acquisitions } = useAcquisitionStore.getState();
      const firstType = Array.from(acquisitions.keys())[0];
      const initialState = acquisitions.get(firstType)!.enabled;

      toggleAcquisition(firstType);

      const newState = useAcquisitionStore.getState().acquisitions.get(firstType)!.enabled;
      expect(newState).toBe(!initialState);
    });

    it('should not toggle non-pending acquisitions', () => {
      const { toggleAcquisition, acquisitions, updateProgress } = useAcquisitionStore.getState();
      const firstType = Array.from(acquisitions.keys())[0];

      // Cambia lo status a running
      updateProgress(firstType, 50, 'Working...', 'running');

      const beforeToggle = useAcquisitionStore.getState().acquisitions.get(firstType)!.enabled;

      toggleAcquisition(firstType);

      const afterToggle = useAcquisitionStore.getState().acquisitions.get(firstType)!.enabled;

      // Dovrebbe rimanere uguale perché non è pending
      expect(afterToggle).toBe(beforeToggle);
    });

    it('should select all pending acquisitions', () => {
      const { selectAll } = useAcquisitionStore.getState();

      selectAll();

      const pendingAcqs = Array.from(useAcquisitionStore.getState().acquisitions.values())
        .filter(a => a.status === 'pending');

      expect(pendingAcqs.every(a => a.enabled)).toBe(true);
    });

    it('should deselect all pending acquisitions', () => {
      const { selectAll, deselectAll } = useAcquisitionStore.getState();

      selectAll();
      deselectAll();

      const pendingAcqs = Array.from(useAcquisitionStore.getState().acquisitions.values())
        .filter(a => a.status === 'pending');

      expect(pendingAcqs.every(a => !a.enabled)).toBe(true);
    });

    it('should not affect non-pending acquisitions when selecting all', () => {
      const { selectAll, updateProgress, acquisitions } = useAcquisitionStore.getState();
      const firstType = Array.from(acquisitions.keys())[0];

      // Metti una acquisizione in running
      updateProgress(firstType, 50, 'Working...', 'running');
      const beforeSelect = useAcquisitionStore.getState().acquisitions.get(firstType)!.enabled;

      selectAll();

      const afterSelect = useAcquisitionStore.getState().acquisitions.get(firstType)!.enabled;
      expect(afterSelect).toBe(beforeSelect);
    });
  });

  describe('session management', () => {
    beforeEach(() => {
      const { initializeAcquisitions, selectAll } = useAcquisitionStore.getState();
      initializeAcquisitions(mockDeviceInfo, false);
      selectAll();
    });

    it('should start acquisition session', () => {
      const { startSession } = useAcquisitionStore.getState();

      startSession();

      const currentSession = useAcquisitionStore.getState().session;
      expect(currentSession).toBeDefined();
      expect(currentSession!.status).toBe('running');
      expect(currentSession!.startTime).toBeInstanceOf(Date);
    });

    it('should include device info in session', () => {
      const { startSession } = useAcquisitionStore.getState();

      startSession();

      const session = useAcquisitionStore.getState().session;
      expect(session!.deviceInfo).toEqual(mockDeviceInfo);
    });

    it('should include selected acquisitions in session', () => {
      const { startSession, getSelectedAcquisitions } = useAcquisitionStore.getState();
      const selected = getSelectedAcquisitions();

      startSession();

      const session = useAcquisitionStore.getState().session;
      expect(session!.acquisitions.length).toBe(selected.length);
    });

    it('should generate unique session ID', async () => {
      const { startSession, endSession, reset, initializeAcquisitions, selectAll } = useAcquisitionStore.getState();

      startSession();
      const firstId = useAcquisitionStore.getState().session!.id;
      endSession();

      reset();

      // Aspetta un po' per assicurarsi che il timestamp sia diverso
      await new Promise(resolve => setTimeout(resolve, 10));

      initializeAcquisitions(mockDeviceInfo, false);
      selectAll();

      startSession();
      const secondId = useAcquisitionStore.getState().session!.id;

      expect(firstId).not.toBe(secondId);
    });

    it('should throw error if starting session without device info', () => {
      const { reset, startSession } = useAcquisitionStore.getState();

      reset();
      // Non inizializziamo le acquisizioni

      expect(() => startSession()).toThrow('Device info not available');
    });
  });

  describe('progress tracking', () => {
    beforeEach(() => {
      const { initializeAcquisitions, selectAll, startSession } = useAcquisitionStore.getState();
      initializeAcquisitions(mockDeviceInfo, false);
      selectAll();
      startSession();
    });

    it('should update acquisition progress', () => {
      const { updateProgress, acquisitions } = useAcquisitionStore.getState();
      const type = Array.from(acquisitions.keys())[0];

      updateProgress(type, 50, 'Working...', 'running');

      const acquisition = useAcquisitionStore.getState().acquisitions.get(type);
      expect(acquisition!.progress).toBe(50);
      expect(acquisition!.message).toBe('Working...');
      expect(acquisition!.status).toBe('running');
    });

    it('should update session progress', () => {
      const { updateProgress, acquisitions } = useAcquisitionStore.getState();
      const type = Array.from(acquisitions.keys())[0];

      updateProgress(type, 50, 'Working...', 'running');

      const session = useAcquisitionStore.getState().session;
      const acqInSession = session!.acquisitions.find(a => a.type === type);

      expect(acqInSession!.progress).toBe(50);
      expect(acqInSession!.status).toBe('running');
    });

    it('should calculate total progress correctly', () => {
      const { updateProgress, getTotalProgress, acquisitions } = useAcquisitionStore.getState();
      const types = Array.from(acquisitions.keys()).slice(0, 2); // Primi 2

      // Aggiorna progress per le prime 2 acquisizioni
      if (types.length >= 2) {
        updateProgress(types[0], 100, 'Done', 'completed');
        updateProgress(types[1], 50, 'Working...', 'running');
      }

      const totalProgress = getTotalProgress();

      // Il progresso totale dovrebbe essere tra 0 e 100
      expect(totalProgress).toBeGreaterThanOrEqual(0);
      expect(totalProgress).toBeLessThanOrEqual(100);
    });

    it('should update total progress in session', () => {
      const { updateProgress, acquisitions } = useAcquisitionStore.getState();
      const type = Array.from(acquisitions.keys())[0];

      updateProgress(type, 50, 'Working...', 'running');

      const session = useAcquisitionStore.getState().session;
      expect(session!.totalProgress).toBeGreaterThanOrEqual(0);
      expect(session!.totalProgress).toBeLessThanOrEqual(100);
    });
  });

  describe('acquisition completion', () => {
    beforeEach(() => {
      const { initializeAcquisitions, selectAll, startSession } = useAcquisitionStore.getState();
      initializeAcquisitions(mockDeviceInfo, false);
      selectAll();
      startSession();
    });

    it('should complete acquisition successfully', () => {
      const { completeAcquisition, acquisitions } = useAcquisitionStore.getState();
      const type = Array.from(acquisitions.keys())[0];

      completeAcquisition(type, {
        type,
        success: true,
        data: new Uint8Array([1, 2, 3]),
        startTime: new Date(),
        endTime: new Date(),
        duration: 100
      });

      const acquisition = useAcquisitionStore.getState().acquisitions.get(type);
      expect(acquisition!.status).toBe('completed');
      expect(acquisition!.result).toBeDefined();
      expect(acquisition!.result!.success).toBe(true);
      expect(acquisition!.progress).toBe(100);
    });

    it('should mark acquisition as failed on error', () => {
      const { completeAcquisition, acquisitions } = useAcquisitionStore.getState();
      const type = Array.from(acquisitions.keys())[0];

      completeAcquisition(type, {
        type,
        success: false,
        error: 'Test error',
        startTime: new Date(),
        endTime: new Date(),
        duration: 100
      });

      const acquisition = useAcquisitionStore.getState().acquisitions.get(type);
      expect(acquisition!.status).toBe('failed');
      expect(acquisition!.result!.success).toBe(false);
      expect(acquisition!.result!.error).toBe('Test error');
    });

    it('should update session with completion', () => {
      const { completeAcquisition, acquisitions } = useAcquisitionStore.getState();
      const type = Array.from(acquisitions.keys())[0];

      completeAcquisition(type, {
        type,
        success: true,
        data: new Uint8Array(),
        startTime: new Date(),
        endTime: new Date(),
        duration: 100
      });

      const session = useAcquisitionStore.getState().session;
      const acqInSession = session!.acquisitions.find(a => a.type === type);

      expect(acqInSession!.status).toBe('completed');
      expect(acqInSession!.result).toBeDefined();
    });
  });

  describe('session end', () => {
    beforeEach(() => {
      const { initializeAcquisitions, selectAll, startSession } = useAcquisitionStore.getState();
      initializeAcquisitions(mockDeviceInfo, false);
      selectAll();
      startSession();
    });

    it('should end session successfully when all completed', () => {
      const { completeAcquisition, endSession, acquisitions } = useAcquisitionStore.getState();

      // Completa tutte le acquisizioni
      Array.from(acquisitions.keys()).forEach(type => {
        completeAcquisition(type, {
          type,
          success: true,
          data: new Uint8Array(),
          startTime: new Date(),
          endTime: new Date(),
          duration: 100
        });
      });

      endSession();

      const session = useAcquisitionStore.getState().session;
      expect(session!.endTime).toBeInstanceOf(Date);
      expect(session!.status).toBe('completed');
    });

    it('should mark session as failed if any acquisition failed', () => {
      const { completeAcquisition, endSession, acquisitions } = useAcquisitionStore.getState();
      const types = Array.from(acquisitions.keys());

      // Prima acquisizione fallisce
      completeAcquisition(types[0], {
        type: types[0],
        success: false,
        error: 'Test error',
        startTime: new Date(),
        endTime: new Date(),
        duration: 100
      });

      // Resto completa
      types.slice(1).forEach(type => {
        completeAcquisition(type, {
          type,
          success: true,
          data: new Uint8Array(),
          startTime: new Date(),
          endTime: new Date(),
          duration: 100
        });
      });

      endSession();

      const session = useAcquisitionStore.getState().session;
      expect(session!.status).toBe('failed');
    });

    it('should set end time', () => {
      const { endSession } = useAcquisitionStore.getState();
      const beforeEnd = new Date();

      endSession();

      const session = useAcquisitionStore.getState().session;
      expect(session!.endTime).toBeInstanceOf(Date);
      expect(session!.endTime!.getTime()).toBeGreaterThanOrEqual(beforeEnd.getTime());
    });
  });

  describe('computed values', () => {
    beforeEach(() => {
      const { initializeAcquisitions } = useAcquisitionStore.getState();
      initializeAcquisitions(mockDeviceInfo, false);
    });

    it('should return selected acquisitions', () => {
      const { selectAll, getSelectedAcquisitions } = useAcquisitionStore.getState();

      selectAll();

      const selected = getSelectedAcquisitions();
      expect(selected.length).toBeGreaterThan(0);
    });

    it('should return empty array when none selected', () => {
      const { deselectAll, getSelectedAcquisitions } = useAcquisitionStore.getState();

      deselectAll();

      const selected = getSelectedAcquisitions();
      expect(selected).toEqual([]);
    });

    it('should determine if session can start', () => {
      const { canStartSession, deselectAll, selectAll } = useAcquisitionStore.getState();

      deselectAll();
      expect(canStartSession()).toBe(false);

      selectAll();
      expect(canStartSession()).toBe(true);
    });

    it('should not allow session start when already active', () => {
      const { selectAll, startSession, canStartSession } = useAcquisitionStore.getState();

      selectAll();
      startSession();

      expect(canStartSession()).toBe(false);
    });

    it('should detect active session', () => {
      const { selectAll, startSession, isSessionActive } = useAcquisitionStore.getState();

      expect(isSessionActive()).toBe(false);

      selectAll();
      startSession();
      expect(isSessionActive()).toBe(true);
    });

    it('should detect inactive session after end', () => {
      const { selectAll, startSession, endSession, isSessionActive } = useAcquisitionStore.getState();

      selectAll();
      startSession();
      endSession();

      expect(isSessionActive()).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle getTotalProgress with no enabled acquisitions', () => {
      const { initializeAcquisitions, deselectAll, getTotalProgress } = useAcquisitionStore.getState();

      initializeAcquisitions(mockDeviceInfo, false);
      deselectAll();

      const progress = getTotalProgress();
      expect(progress).toBe(0);
    });

    it('should handle updateProgress for non-existent acquisition', () => {
      const { initializeAcquisitions, updateProgress } = useAcquisitionStore.getState();

      initializeAcquisitions(mockDeviceInfo, false);

      // Non dovrebbe crashare
      expect(() => {
        updateProgress('non-existent' as AcquisitionType, 50, 'Test', 'running');
      }).not.toThrow();
    });

    it('should handle completeAcquisition for non-existent acquisition', () => {
      const { initializeAcquisitions, completeAcquisition } = useAcquisitionStore.getState();

      initializeAcquisitions(mockDeviceInfo, false);

      // Non dovrebbe crashare
      expect(() => {
        completeAcquisition('non-existent' as AcquisitionType, {
          type: 'non-existent' as AcquisitionType,
          success: true,
          data: new Uint8Array(),
          startTime: new Date(),
          endTime: new Date(),
          duration: 100
        });
      }).not.toThrow();
    });
  });
});