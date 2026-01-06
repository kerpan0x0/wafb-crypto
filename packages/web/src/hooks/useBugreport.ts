import { useState, useCallback } from 'react';
import { ADBConnection, Logger, type DeviceProperties } from '@wafb/core';

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

export function useBugreport() {
  const [progress, setProgress] = useState<BugreportProgress>({
    status: 'idle',
    progress: 0,
    message: 'Ready to connect'
  });

  const [connection, setConnection] = useState<ADBConnection | null>(null);

  const updateProgress = useCallback((
    status: BugreportStatus,
    progressValue: number,
    message: string,
    deviceInfo?: DeviceProperties
  ) => {
    setProgress({ status, progress: progressValue, message, deviceInfo });
  }, []);

  const acquireBugreport = useCallback(async (): Promise<BugreportResult> => {
    try {
      Logger.setLogLevel('info');
      
      // Step 1: Create connection
      updateProgress('connecting', 5, 'Requesting device access...');
      const conn = new ADBConnection();
      setConnection(conn);

      // Step 2: Connect to device
      updateProgress('connecting', 10, 'Connecting to device...');
      const device = await conn.connect({
        retryAttempts: 3,
        retryDelay: 1000
      });

      // Step 3: Get device info
      updateProgress('connected', 20, 'Reading device information...');
      const deviceInfo = await device.getProperties();
      
      updateProgress('connected', 25, `Connected to ${deviceInfo.model}`, deviceInfo);

      // Step 4: Check if bugreportz is available
      updateProgress('generating', 30, 'Checking bugreport support...');
      try {
        await device.commands.shell('which bugreportz', { timeout: 5000 });
      } catch {
        // Fallback to regular bugreport if bugreportz not available
        updateProgress('generating', 35, 'Using legacy bugreport method...');
      }

      // Step 5: Generate bugreport
      updateProgress('generating', 40, 'Generating bugreport (this may take 1-2 minutes)...');
      
      let bugreportPath: string;
      let useZip = true;

      try {
        // Try bugreportz first (faster, creates zip)
        const bugreportzOutput = await device.commands.shell('bugreportz', {
          timeout: 180000 // 3 minutes
        });

        const zipMatch = bugreportzOutput.match(/OK:(.+\.zip)/);
        if (zipMatch) {
          bugreportPath = zipMatch[1].trim();
        } else {
          throw new Error('Could not parse bugreportz output');
        }
      } catch (error) {
        // Fallback to regular bugreport
        updateProgress('generating', 45, 'Generating bugreport (legacy method)...');
        useZip = false;
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        bugreportPath = `/sdcard/bugreport-${timestamp}.txt`;
        
        await device.commands.shell(`bugreport > ${bugreportPath}`, {
          timeout: 180000
        });
      }

      updateProgress('downloading', 70, `Reading ${useZip ? 'zip' : 'text'} file from device...`);

      // Step 6: Download file
      const bugreportData = await device.commands.readFile(bugreportPath);
      
      updateProgress('downloading', 90, 'Preparing download...');

      // Step 7: Create and trigger download
      const blob = new Blob(
        [bugreportData],
        { type: useZip ? 'application/zip' : 'text/plain' }
      );
      
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `bugreport-${deviceInfo.model}-${timestamp}.${useZip ? 'zip' : 'txt'}`;
      
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      updateProgress('success', 100, 'Bugreport downloaded successfully!');

      // Step 8: Cleanup (optional - remove file from device)
      try {
        if (!useZip || bugreportPath.startsWith('/sdcard/')) {
          await device.commands.shell(`rm ${bugreportPath}`);
        }
      } catch (err) {
        console.warn('Failed to cleanup bugreport file:', err);
      }

      // Disconnect
      await device.disconnect();
      setConnection(null);

      return {
        success: true,
        fileName,
        fileSize: bugreportData.length
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      updateProgress('error', 0, `Error: ${errorMessage}`);
      
      // Cleanup connection on error
      if (connection) {
        try {
          await connection.disconnect();
        } catch {}
        setConnection(null);
      }

      return {
        success: false,
        error: errorMessage
      };
    }
  }, [connection, updateProgress]);

  const reset = useCallback(() => {
    setProgress({
      status: 'idle',
      progress: 0,
      message: 'Ready to connect'
    });
    setConnection(null);
  }, []);

  return {
    progress,
    acquireBugreport,
    reset,
    isActive: progress.status !== 'idle' && progress.status !== 'success' && progress.status !== 'error'
  };
}