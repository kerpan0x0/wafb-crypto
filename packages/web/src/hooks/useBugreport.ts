// packages/web/src/hooks/useBugreport.ts
// 
// Questo è un wrapper sottile che usa il BugreportAcquirer dal core
// e integra con lo store Zustand per il state management.
// 
// NOTA: Questo hook è opzionale - AcquisitionPage lo chiama direttamente.
//       È qui per compatibilità futura se vuoi usare bugreport standalone.

import { useCallback } from 'react';
import { BugreportAcquirer, type ADBDevice } from '@wafb/core';
import { useAcquisitionStore } from '../stores/acquisitionStore';

export function useBugreport(device: ADBDevice | null) {
  const { updateProgress, completeAcquisition } = useAcquisitionStore();

  const acquire = useCallback(async () => {
    if (!device) {
      throw new Error('Device not connected');
    }

    const acquirer = new BugreportAcquirer(device, {
      computeHash: true,
      cleanupAfter: true
    });

    const result = await acquirer.acquire((progress) => {
      updateProgress('bugreport', progress.progress, progress.message, progress.status);
    });

    completeAcquisition('bugreport', result);
    return result;
  }, [device, updateProgress, completeAcquisition]);

  return { acquire };
}