import { useState, useEffect, useRef } from 'react';
import { ADBConnection, Device, ACQUISITION_TYPES, Logger, StreamingZipWriter } from '@wafb/core';
import { useTranslation } from 'react-i18next';
import {
  MountAcquirer,
  EnvAcquirer,
  BugreportAcquirer,
  LogcatAcquirer,
  PackagesAcquirer,
  RootBinariesAcquirer,
  SELinuxAcquirer,
  SettingsAcquirer,
  ProcessAcquirer,
  FileAcquirer,
  SystemInfoAcquirer,
  ServicesAcquirer,
  LogAcquirer,
  TmpAcquirer,
  DumpsysAcquirer,
  BackupAcquirer,
} from '@wafb/core';
import { useAcquisitionStore, initializeAcquisitionTypes } from '../../stores/acquisitionStore';
import type {
  AcquisitionProgress,
  AcquisitionType,
  AcquisitionResult,
  AcquisitionFile,
  AcquisitionConfig,
  BugreportConfig,
  LogcatConfig,
  PackagesConfig,
  SystemInfoConfig,
  SELinuxConfig,
  SettingsConfig,
  ProcessConfig,
  ServicesConfig,
  LogConfig,
  FileAcquisitionConfig,
  DumpsysConfig,
  BackupConfig,
} from '@wafb/core';

// ============================================================================
// TYPE DECLARATIONS FOR FILE SYSTEM ACCESS API
// ============================================================================

declare global {
  interface Window {
    showSaveFilePicker?(options?: {
      suggestedName?: string;
      types?: Array<{
        description: string;
        accept: Record<string, string[]>;
      }>;
    }): Promise<FileSystemFileHandle>;
  }

  interface FileSystemFileHandle {
    createWritable(): Promise<FileSystemWritableFileStream>;
  }

  interface FileSystemWritableFileStream extends WritableStream {
    write(data: BufferSource): Promise<void>;
    close(): Promise<void>;
  }
}

export function AcquisitionPage() {
  const [device, setDevice] = useState<Device | null>(null);
  const { t } = useTranslation();
  const [_connection, setConnection] = useState<ADBConnection | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const {
    acquisitions,
    session,
    deviceInfo,
    initializeAcquisitions,
    toggleAcquisition,
    selectAll,
    deselectAll,
    startSession,
    updateProgress,
    completeAcquisition,
    endSession,
    cancelSession,
    getSelectedAcquisitions,
    getTotalProgress,
    canStartSession,
    isSessionActive,
  } = useAcquisitionStore();

  // Initialize acquisition types on mount
  useEffect(() => {
    Logger.setLogLevel('info');
    initializeAcquisitionTypes(ACQUISITION_TYPES);
  }, []);

  // Connect to device
  const handleConnect = async () => {
    setIsConnecting(true);
    setError(null);

    try {
      const conn = new ADBConnection();
      const dev = await conn.connect({ retryAttempts: 3, retryDelay: 1000 });

      const props = await dev.getProperties();
      const isRooted = await dev.isRooted();

      setConnection(conn);
      setDevice(dev);

      initializeAcquisitions(props, isRooted);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setIsConnecting(false);
    }
  };

  // Disconnect device
  const handleDisconnect = async () => {
    if (device) {
      await device.disconnect();
      setDevice(null);
      setConnection(null);
    }
  };

  // Stop an in-progress acquisition session
  const handleStopAcquisition = () => {
    abortControllerRef.current?.abort();
    cancelSession();
  };

  // Start acquisition session
  const handleStartAcquisition = async () => {
    if (!device) return;

    // showSaveFilePicker must be called before any await — Chrome invalidates
    // the user gesture context as soon as the call stack yields.
    const now = new Date();
    const folderName = `wafb-acquisition-${now.toISOString().slice(0, 19).replace(/:/g, '-')}`;
    let fileHandle: FileSystemFileHandle;
    try {
      fileHandle = await (window as any).showSaveFilePicker({
        suggestedName: `${folderName}.zip`,
        types: [{ description: 'ZIP Archive', accept: { 'application/zip': ['.zip'] } }],
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      throw error;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    startSession();
    const selected = getSelectedAcquisitions();
    const results: AcquisitionResult[] = [];

    // Open the ZIP writer BEFORE running acquisitions so that streams from
    // long-running acquirers (e.g. backup) are piped to disk immediately
    // while still live — not deferred until after all acquisitions finish.
    const writable = await fileHandle.createWritable();
    const zip = new StreamingZipWriter(writable);

    for (const type of selected) {
      if (controller.signal.aborted) break;

      try {
        const result = await executeAcquisition(type, device);
        results.push(result);

        if (controller.signal.aborted) break;

        // Write this acquisition's files into the ZIP immediately.
        // For stream-based files (backup) this consumes the live ADB stream
        // before it is closed; for blob-based files it just buffers once.
        if (result.success && result.files) {
          for (const file of result.files) {
            const hashPromise = file.hashPromise;
            const originalName = file.fileName;
            const filePath = `${folderName}/${file.fileName}`;
            updateProgress(type, 50, `Saving ${file.fileName} to disk...`, 'running');

            // Wrap stream with progress tracking before handing to ZIP writer.
            // addAcquisitionFile handles stream consumption and awaits hashPromise
            // (if present) to store the resolved hash on file.hash before we write
            // the manifest.
            await zip.addAcquisitionFile({
              ...file,
              fileName: filePath,
              stream: trackStreamProgress(file.stream, bytes => {
                // Pulse progress while streaming — we don't know total size upfront
                const mb = (bytes / (1024 * 1024)).toFixed(1);
                updateProgress(type, 70, `Saving ${file.fileName}: ${mb} MB written...`, 'running');
              }),
            });

            if (hashPromise) {
              file.hash = await hashPromise;
            }

            file.fileName = originalName;
            updateProgress(type, 100, `${file.fileName} saved.`, 'completed');
          }
        }
      } catch (err) {
        console.error(`Failed to execute ${type}:`, err);
      }
    }

    // Write manifest last (needs all results)
    const manifest = createManifest(results);
    await zip.addFile(
      `${folderName}/manifest.json`,
      new TextEncoder().encode(JSON.stringify(manifest, null, 2))
    );

    // finalize() writes central directory and closes the writable stream
    await zip.finalize();
    console.log(`✅ ZIP saved to disk: ${folderName}.zip`);

    abortControllerRef.current = null;
    endSession();
  };

  /**
   * Wraps a ReadableStream with a byte-counting passthrough so the caller
   * can track how much data has been written without buffering anything.
   */
  function trackStreamProgress(
    source: ReadableStream<Uint8Array>,
    onBytes: (totalBytes: number) => void
  ): ReadableStream<Uint8Array> {
    let total = 0;
    return source.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          total += chunk.byteLength;
          onBytes(total);
          controller.enqueue(chunk);
        },
      })
    );
  }

  // Execute single acquisition
  const executeAcquisition = async (
    type: AcquisitionType,
    device: Device
  ): Promise<AcquisitionResult> => {
    const acquirerConfig = {
      bugreport: {
        Class: BugreportAcquirer,
        options: {
          computeHash: true,
          cleanupAfter: true,
        } satisfies BugreportConfig,
      },
      logcat: {
        Class: LogcatAcquirer,
        options: {
          buffer: 'all',
          format: 'threadtime',
          computeHash: true,
        } satisfies LogcatConfig,
      },
      packages: {
        Class: PackagesAcquirer,
        options: {
          includeSystem: true,
          includeDetails: true,
          downloadApks: true,
          computeHash: true,
        } satisfies PackagesConfig,
      },
      system_info: {
        Class: SystemInfoAcquirer,
        options: {
          includeBattery: true,
          includeNetwork: false,
          includeStorage: true,
          includeMemory: true,
          includeSensors: true,
          computeHash: true,
        } satisfies SystemInfoConfig,
      },
      rootBinaries: {
        Class: RootBinariesAcquirer,
        options: {},
      },
      env: {
        Class: EnvAcquirer,
        options: {},
      },
      selinux: {
        Class: SELinuxAcquirer,
        options: {
          includeContexts: true,
          includeFileContexts: true,
          includeDenials: true,
          maxDenialLines: 100,
        } satisfies SELinuxConfig,
      },
      mount: {
        Class: MountAcquirer,
        options: {},
      },
      settings: {
        Class: SettingsAcquirer,
        options: {
          computeHash: true,
        } satisfies SettingsConfig,
      },
      process: {
        Class: ProcessAcquirer,
        options: {
          includeThreads: true,
          includeSELinuxContext: true,
        } satisfies ProcessConfig,
      },
      services: {
        Class: ServicesAcquirer,
        options: {
          includeSystemServices: true,
          includeUserServices: true,
          includeServiceDetails: true,
        } satisfies ServicesConfig,
      },
      logs: {
        Class: LogAcquirer,
        options: {
          includeSystemLogs: true,
          computeHash: true,
        } satisfies LogConfig,
      },
      files: {
        Class: FileAcquirer,
        options: {
          downloadFiles: false,
          maxStatBatchSize: 30,
          maxHashBatchSize: 15,
          parallelScans: 3,
          computeFileHashes: true,
          hashAlgorithms: ['sha256'],
          maxHashFileSize: 10 * 1024 * 1024,
          excludeHashPaths: ['/system', '/vendor', '/product', '/apex', '/proc'],
          hashMethod: 'auto',
          timeout: 600000,
        } satisfies FileAcquisitionConfig,
      },
      tmp: {
        Class: TmpAcquirer,
        options: {},
      },
      dumpsys: {
        Class: DumpsysAcquirer,
        options: {
          computeHash: true,
        } satisfies DumpsysConfig,
      },
      backup: {
        Class: BackupAcquirer,
        options: {
          type: 'full',
          computeHash: true,
        } satisfies BackupConfig,
      },
    };

    const config = acquirerConfig[type as keyof typeof acquirerConfig];

    if (config) {
      // Istanziamo l'acquirer dinamicamente
      const acquirer = new config.Class(device, config.options as AcquisitionConfig);

      const result = await acquirer.acquire((progress: AcquisitionProgress) => {
        updateProgress(type, progress.progress, progress.message, progress.status);
      });

      completeAcquisition(type, result);
      return result;
    } else {
      // Gestione tipi non ancora implementati
      updateProgress(type, 0, 'Not implemented yet', 'skipped');
      const result: AcquisitionResult = {
        success: false,
        type,
        startTime: new Date(),
        endTime: new Date(),
        duration: 0,
        error: `Acquirer for ${type} not implemented`,
      };
      completeAcquisition(type, result);
      return result;
    }
  };

  // ============================================================================
  // ZIP CREATION: STREAMING DIRECTLY TO DISK
  // ============================================================================

  /**
   * Create manifest with metadata (no blobs)
   */
  function createManifest(results: AcquisitionResult[]) {
    return {
      acquisitionDate: new Date().toISOString(),
      deviceInfo: deviceInfo,
      acquisitions: results.map(r => ({
        type: r.type,
        success: r.success,
        files: r.files?.map((f: AcquisitionFile) => ({
          fileName: f.fileName,
          fileSize: f.fileSize,
          description: f.description,
          mimeType: f.mimeType,
          hash: f.hash,
        })),
        duration: r.duration,
        error: r.error,
        data: r.data,
      })),
      summary: {
        totalAcquisitions: results.length,
        successfulAcquisitions: results.filter(r => r.success).length,
        failedAcquisitions: results.filter(r => !r.success).length,
        totalFiles: results.reduce((sum, r) => sum + (r.files?.length || 0), 0),
        totalSize: results.reduce(
          (sum, r) =>
            sum + (r.files?.reduce((s: number, f: AcquisitionFile) => s + f.fileSize, 0) || 0),
          0
        ),
      },
    };
  }

  // ============================================================================
  // UI COMPONENT
  // ============================================================================

  return (
    <div className="bg-gray-50 p-8 h-full">
      <div className="max-w-6xl mx-auto">
        {/* Device Connection */}
        {!device ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="mb-6">
              <div className="text-6xl mb-4">📱</div>
              <h2 className="text-2xl font-semibold mb-2">{t('connect.title')}</h2>
              <p className="text-gray-600 mb-6">{t('connect.subtitle')}</p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-red-800">
                {error}
              </div>
            )}

            <button
              onClick={handleConnect}
              disabled={isConnecting}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold px-8 py-3 rounded-lg transition-colors"
            >
              {isConnecting ? t('connect.buttonConnecting') : t('connect.buttonConnect')}
            </button>

            <div className="mt-8 text-left bg-gray-50 rounded-lg p-6">
              <h3 className="font-semibold mb-3">{t('connect.requirements')}</h3>
              <ul className="space-y-2 text-sm text-gray-700">
                <li>✓ {t('connect.req1')}</li>
                <li>✓ {t('connect.req2')}</li>
                <li>✓ {t('connect.req3')}</li>
                <li>✓ {t('connect.req4')}</li>
              </ul>
            </div>

            <div className="mt-4 text-left bg-gray-50 rounded-lg p-6">
              <h3 className="font-semibold mb-3">{t('connect.usbGuideTitle')}</h3>
              <ol className="space-y-1 text-sm text-gray-700 list-decimal list-inside">
                <li>
                  Open <strong>Settings</strong> on your Android device
                </li>
                <li>
                  Go to <strong>About phone</strong> and tap <strong>Build number</strong> 7 times
                </li>
                <li>
                  Go back to <strong>Settings → Developer options</strong>
                </li>
                <li>
                  Enable <strong>USB debugging</strong>
                </li>
              </ol>
              <a
                href="https://developer.android.com/studio/debug/dev-options"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-3 text-xs text-blue-600 underline hover:text-blue-800"
              >
                {t('connect.usbGuideLink')}
              </a>
            </div>
          </div>
        ) : (
          <>
            {/* Device Info */}
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold mb-1">{t('device.title')}</h2>
                  <div className="text-gray-600">
                    <p>
                      {deviceInfo?.manufacturer} {deviceInfo?.model}
                    </p>
                    <p className="text-sm">
                      Android {deviceInfo?.androidVersion} • SDK {deviceInfo?.sdkVersion}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleDisconnect}
                  disabled={isSessionActive()}
                  className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                >
                  {t('device.disconnect')}
                </button>
              </div>
            </div>

            {/* Acquisition Selection */}
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">{t('acquisition.title')}</h2>
                <div className="space-x-2">
                  <button
                    onClick={selectAll}
                    disabled={isSessionActive()}
                    className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded disabled:opacity-50"
                  >
                    {t('acquisition.selectAll')}
                  </button>
                  <button
                    onClick={deselectAll}
                    disabled={isSessionActive()}
                    className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-50 rounded disabled:opacity-50"
                  >
                    {t('acquisition.deselectAll')}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Array.from(acquisitions.values()).map(acq => (
                  <div
                    key={acq.type}
                    onClick={() => !isSessionActive() && toggleAcquisition(acq.type)}
                    className={`
                      border-2 rounded-lg p-4 cursor-pointer transition-all
                      ${acq.enabled ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}
                      ${isSessionActive() ? 'opacity-60 cursor-not-allowed' : ''}
                    `}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <span className="text-2xl">{acq.metadata.icon}</span>
                        <div>
                          <h3 className="font-semibold">{acq.metadata.name}</h3>
                          <p className="text-xs text-gray-500">{acq.metadata.category}</p>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={acq.enabled}
                        onChange={() => { }}
                        className="w-5 h-5"
                        disabled={isSessionActive()}
                      />
                    </div>

                    <p className="text-sm text-gray-600 mb-2">{acq.metadata.description}</p>

                    {acq.metadata.requiresRoot && (
                      <span className="inline-block text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                        {t('acquisition.requiresRoot')}
                      </span>
                    )}

                    {/* Progress during acquisition */}
                    {acq.status !== 'pending' && (
                      <div className="mt-3">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-600">{acq.message}</span>
                          <span className="font-semibold">{acq.progress}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full transition-all ${acq.status === 'completed'
                                ? 'bg-green-500'
                                : acq.status === 'failed'
                                  ? 'bg-red-500'
                                  : acq.status === 'running'
                                    ? 'bg-blue-500'
                                    : 'bg-gray-400'
                              }`}
                            style={{ width: `${acq.progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Start Button */}
            {!session && (
              <button
                onClick={handleStartAcquisition}
                disabled={!canStartSession()}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-semibold py-4 rounded-lg transition-colors text-lg"
              >
                {t('acquisition.startButton', { count: getSelectedAcquisitions().length })}
              </button>
            )}

            {/* Session Progress */}
            {session && (
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold">{t('acquisition.progressTitle')}</h2>
                  {session.status === 'running' && (
                    <button
                      onClick={handleStopAcquisition}
                      className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors"
                    >
                      ⏹ {t('acquisition.stopButton')}
                    </button>
                  )}
                </div>

                <div className="mb-4">
                  <div className="flex justify-between text-sm mb-2">
                    <span>{t('acquisition.totalProgress')}</span>
                    <span className="font-semibold">{getTotalProgress()}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className="bg-blue-600 h-3 rounded-full transition-all"
                      style={{ width: `${getTotalProgress()}%` }}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  {session.acquisitions.map(
                    (acq: { type: AcquisitionType; status: string; progress: number }) => (
                      <div key={acq.type} className="flex items-center justify-between text-sm">
                        <span>{ACQUISITION_TYPES[acq.type].name}</span>
                        <span
                          className={`font-semibold ${acq.status === 'completed'
                              ? 'text-green-600'
                              : acq.status === 'failed'
                                ? 'text-red-600'
                                : acq.status === 'running'
                                  ? 'text-blue-600'
                                  : 'text-gray-500'
                            }`}
                        >
                          {acq.status === 'completed'
                            ? t('acquisition.statusDone')
                            : acq.status === 'failed'
                              ? t('acquisition.statusFailed')
                              : acq.status === 'running'
                                ? `${acq.progress}%`
                                : t('acquisition.statusPending')}
                        </span>
                      </div>
                    )
                  )}
                </div>

                {session.status !== 'running' && (
                  <div className="mt-6 text-center">
                    <p className="text-lg font-semibold mb-2">
                      {session.status === 'completed'
                        ? t('acquisition.completed')
                        : session.status === 'failed'
                          ? t('acquisition.completedWithErrors')
                          : t('acquisition.cancelled')}
                    </p>
                    <button
                      onClick={() => window.location.reload()}
                      className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      {t('acquisition.startNew')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
