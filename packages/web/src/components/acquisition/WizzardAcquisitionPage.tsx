import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ADBConnection,
  Device,
  ACQUISITION_TYPES,
  Logger,
  BackupAcquirer,
  StreamingZipWriter,
} from '@wafb/core';
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
  // FileAcquirer,
  // SystemInfoAcquirer,
  ServicesAcquirer,
  LogAcquirer,
  TmpAcquirer,
  DumpsysAcquirer,
} from '@wafb/core';
import { useAcquisitionStore, initializeAcquisitionTypes } from '../../stores/acquisitionStore';
import type {
  AcquisitionProgress,
  AcquisitionType,
  AcquisitionResult,
  AcquisitionFile,
} from '@wafb/core';

type WizardStep = 'connect' | 'acquiring' | 'done';

const STEP_ORDER: WizardStep[] = ['connect', 'acquiring', 'done'];

function StepIndicator({
  current,
  labels,
}: {
  current: WizardStep;
  labels: Record<WizardStep, string>;
}) {
  return (
    <div className="flex items-center justify-center mb-8">
      {STEP_ORDER.map((step, index) => {
        const currentIndex = STEP_ORDER.indexOf(current);
        const isDone = index < currentIndex;
        const isActive = index === currentIndex;

        return (
          <div key={step} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm transition-colors
                  ${isDone ? 'bg-green-500 text-white' : isActive ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}
              >
                {isDone ? '✓' : index + 1}
              </div>
              <span
                className={`mt-1 text-xs font-medium ${isActive ? 'text-blue-600' : isDone ? 'text-green-600' : 'text-gray-400'}`}
              >
                {labels[step]}
              </span>
            </div>
            {index < STEP_ORDER.length - 1 && (
              <div
                className={`h-0.5 w-20 mx-2 mb-4 transition-colors ${index < STEP_ORDER.indexOf(current) ? 'bg-green-400' : 'bg-gray-200'}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function WizzardAcquisitionPage() {
  const { t } = useTranslation();
  const [step, setStep] = useState<WizardStep>('connect');
  const [_device, setDevice] = useState<Device | null>(null);
  const [_connection, setConnection] = useState<ADBConnection | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AcquisitionResult[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const {
    acquisitions,
    deviceInfo,
    initializeAcquisitions,
    startSession,
    updateProgress,
    completeAcquisition,
    endSession,
    cancelSession,
    getSelectedAcquisitions,
    getTotalProgress,
    reset,
  } = useAcquisitionStore();

  // Connect and immediately start default acquisition
  const handleConnect = async () => {
    setIsConnecting(true);
    setError(null);

    try {
      Logger.setLogLevel('info');
      initializeAcquisitionTypes(ACQUISITION_TYPES);

      const conn = new ADBConnection();
      const dev = await conn.connect({ retryAttempts: 3, retryDelay: 1000 });

      const props = await dev.getProperties();
      const isRooted = await dev.isRooted();

      setConnection(conn);
      setDevice(dev);

      initializeAcquisitions(props, isRooted);

      // Move to acquiring step and run immediately
      setStep('acquiring');
      await runDefaultAcquisition(dev);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleStopAcquisition = () => {
    abortControllerRef.current?.abort();
    cancelSession();
    setStep('done');
  };

  const runDefaultAcquisition = async (dev: Device) => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    startSession();
    const selected = getSelectedAcquisitions();
    const collectedResults: AcquisitionResult[] = [];

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
      if ((error as Error).name === 'AbortError') {
        cancelSession();
        setStep('connect');
        return;
      }
      throw error;
    }

    // Open the ZIP writer BEFORE running acquisitions so that streams from
    // long-running acquirers (e.g. backup) are piped to disk immediately
    // while still live — not deferred until after all acquisitions finish.
    const writable = await fileHandle.createWritable();
    const zip = new StreamingZipWriter(writable);

    for (const type of selected) {
      if (controller.signal.aborted) break;

      try {
        const result = await executeAcquisition(type, dev);
        collectedResults.push(result);

        if (controller.signal.aborted) break;

        // Write this acquisition's files into the ZIP immediately.
        if (result.success && result.files) {
          for (const file of result.files) {
            const originalName = file.fileName;
            const filePath = `${folderName}/${file.fileName}`;
            updateProgress(type, 50, `Saving ${file.fileName} to disk...`, 'running');

            await zip.addAcquisitionFile({
              ...file,
              fileName: filePath,
              stream: trackStreamProgress(file.stream, bytes => {
                const mb = (bytes / (1024 * 1024)).toFixed(1);
                updateProgress(type, 70, `Saving ${file.fileName}: ${mb} MB written...`, 'running');
              }),
            });

            file.fileName = originalName;
            updateProgress(type, 100, `${file.fileName} saved.`, 'completed');
          }
        }
      } catch (err) {
        console.error(`Failed to execute ${type}:`, err);
      }
    }

    // Write manifest last (needs all results)
    const manifest = createManifest(collectedResults);
    await zip.addFile(
      `${folderName}/manifest.json`,
      new TextEncoder().encode(JSON.stringify(manifest, null, 2))
    );

    // finalize() writes central directory and closes the writable stream
    await zip.finalize();
    console.log(`✅ ZIP saved to disk: ${folderName}.zip`);

    setResults(collectedResults);
    abortControllerRef.current = null;
    endSession();
    setStep('done');
  };

  // Execute a single acquisition — all hash computation disabled
  const executeAcquisition = async (
    type: AcquisitionType,
    dev: Device
  ): Promise<AcquisitionResult> => {
    const acquirerConfig = {
      bugreport: {
        Class: BugreportAcquirer,
        options: { computeHash: false, cleanupAfter: true },
      },
      backup: {
        Class: BackupAcquirer, // BackupAcquirer not implemented yet
        options: { computeHash: false },
      },
      logcat: {
        Class: LogcatAcquirer,
        options: { buffer: 'all' as const, format: 'threadtime' as const, computeHash: false },
      },
      packages: {
        Class: PackagesAcquirer,
        options: {
          includeSystem: true,
          includeDetails: true,
          includePermissions: true,
          computeHash: false,
        },
      },
      // system_info: {
      //   Class: SystemInfoAcquirer,
      //   options: {
      //     includeBattery: true,
      //     includeNetwork: true,
      //     includeStorage: true,
      //     includeMemory: true,
      //     includeSensors: true,
      //     computeHash: false,
      //   },
      // },
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
        },
      },
      mount: {
        Class: MountAcquirer,
        options: {},
      },
      settings: {
        Class: SettingsAcquirer,
        options: {
          computeHash: false,
        },
      },
      process: {
        Class: ProcessAcquirer,
        options: { includeThreads: true, includeSELinuxContext: true, includeMemoryInfo: true },
      },
      services: {
        Class: ServicesAcquirer,
        options: {
          includeSystemServices: true,
          includeUserServices: true,
          includeServiceDetails: true,
        },
      },
      logs: {
        Class: LogAcquirer,
        options: { includeSystemLogs: true, computeHash: false },
      },
      // files: {
      //   Class: FileAcquirer,
      //   options: {
      //     downloadFiles: false,
      //     maxStatBatchSize: 30,
      //     maxHashBatchSize: 15,
      //     parallelScans: 3,
      //     computeFileHashes: false,
      //     excludeHashPaths: ['/system', '/vendor', '/product', '/apex', '/proc'],
      //     timeout: 600000,
      //   },
      // },
      tmp: {
        Class: TmpAcquirer,
        options: {},
      },
      dumpsys: {
        Class: DumpsysAcquirer,
        options: { computeHash: false },
      },
    };

    const config = acquirerConfig[type as keyof typeof acquirerConfig];

    if (config) {
      const acquirer = new config.Class(dev, config.options);
      const result = await acquirer.acquire((progress: AcquisitionProgress) => {
        updateProgress(type, progress.progress, progress.message, progress.status);
      });
      completeAcquisition(type, result);
      return result;
    } else {
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

  const handleReset = () => {
    reset();
    setDevice(null);
    setConnection(null);
    setResults([]);
    setError(null);
    setStep('connect');
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="bg-gray-50 p-8 h-full">
      <div className="max-w-3xl mx-auto">
        <StepIndicator
          current={step}
          labels={{
            connect: t('steps.connect'),
            acquiring: t('steps.acquiring'),
            done: t('steps.done'),
          }}
        />

        {/* ── Step: Connect ── */}
        {step === 'connect' && (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="mb-6">
              <div className="text-6xl mb-4">📱</div>
              <h2 className="text-2xl font-semibold mb-2">{t('connect.title')}</h2>
              <p className="text-gray-600 mb-2">{t('connect.subtitle')}</p>
              <p className="text-gray-500 text-sm">{t('connect.subtitleWizard')}</p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-red-800 text-sm">
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
        )}

        {/* ── Step: Acquiring ── */}
        {step === 'acquiring' && (
          <div className="bg-white rounded-lg shadow p-6">
            {/* Device info banner */}
            <div className="flex items-center space-x-3 mb-6 p-4 bg-blue-50 rounded-lg">
              <span className="text-3xl">📱</span>
              <div>
                <p className="font-semibold">
                  {deviceInfo?.manufacturer} {deviceInfo?.model}
                </p>
                <p className="text-sm text-gray-500">
                  Android {deviceInfo?.androidVersion} • SDK {deviceInfo?.sdkVersion}
                </p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-sm text-gray-500">{t('acquisition.totalProgress')}</p>
                <p className="text-2xl font-bold text-blue-600">{getTotalProgress()}%</p>
              </div>
            </div>

            {/* Overall progress bar */}
            <div className="w-full bg-gray-200 rounded-full h-3 mb-6">
              <div
                className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                style={{ width: `${getTotalProgress()}%` }}
              />
            </div>

            {/* Per-acquisition progress */}
            <div className="space-y-3">
              {Array.from(acquisitions.values()).map(acq => (
                <div key={acq.type} className="border border-gray-100 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-xl">{acq.metadata.icon}</span>
                      <span className="font-medium text-sm">{acq.metadata.name}</span>
                    </div>
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full
                        ${
                          acq.status === 'completed'
                            ? 'bg-green-100 text-green-700'
                            : acq.status === 'failed'
                              ? 'bg-red-100 text-red-700'
                              : acq.status === 'running'
                                ? 'bg-blue-100 text-blue-700'
                                : acq.status === 'skipped'
                                  ? 'bg-gray-100 text-gray-500'
                                  : 'bg-gray-100 text-gray-400'
                        }`}
                    >
                      {acq.status === 'completed'
                        ? t('acquisition.statusDone')
                        : acq.status === 'failed'
                          ? t('acquisition.statusFailed')
                          : acq.status === 'running'
                            ? `${acq.progress}%`
                            : acq.status === 'skipped'
                              ? t('acquisition.statusSkipped')
                              : t('acquisition.statusPending')}
                    </span>
                  </div>

                  {acq.status !== 'pending' && (
                    <>
                      <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
                        <div
                          className={`h-1.5 rounded-full transition-all duration-300
                            ${
                              acq.status === 'completed'
                                ? 'bg-green-500'
                                : acq.status === 'failed'
                                  ? 'bg-red-500'
                                  : acq.status === 'running'
                                    ? 'bg-blue-500'
                                    : 'bg-gray-300'
                            }`}
                          style={{ width: `${acq.progress}%` }}
                        />
                      </div>
                      {acq.message && (
                        <p className="text-xs text-gray-400 mt-1 truncate">{acq.message}</p>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>

            <p className="mt-6 text-center text-sm text-gray-400 animate-pulse">
              {t('acquisition.keepConnected')}
            </p>

            <div className="mt-4 text-center">
              <button
                onClick={handleStopAcquisition}
                className="flex items-center gap-2 mx-auto px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                ⏹ {t('acquisition.stopButton')}
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Done ── */}
        {step === 'done' && (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-center mb-6">
              <div className="text-5xl mb-3">{results.some(r => !r.success) ? '⚠️' : '✅'}</div>
              <h2 className="text-2xl font-semibold mb-1">
                {results.some(r => !r.success)
                  ? t('acquisition.completedWithErrors')
                  : t('acquisition.completed')}
              </h2>
              <p className="text-gray-500 text-sm">{t('acquisition.zipDownloaded')}</p>
            </div>

            {/* Device info banner */}
            {deviceInfo && (
              <div className="flex items-center space-x-3 mb-4 p-3 bg-gray-50 rounded-lg text-sm">
                <span className="text-2xl">📱</span>
                <div>
                  <span className="font-medium">
                    {deviceInfo.manufacturer} {deviceInfo.model}
                  </span>
                  <span className="text-gray-500 ml-2">
                    Android {deviceInfo.androidVersion} • SDK {deviceInfo.sdkVersion}
                  </span>
                </div>
              </div>
            )}

            {/* Results table */}
            <div className="overflow-hidden rounded-lg border border-gray-200 mb-6">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold text-gray-600">
                      {t('acquisition.colAcquisition')}
                    </th>
                    <th className="text-center px-4 py-2 font-semibold text-gray-600">
                      {t('acquisition.colStatus')}
                    </th>
                    <th className="text-right px-4 py-2 font-semibold text-gray-600">
                      {t('acquisition.colSize')}
                    </th>
                    <th className="text-right px-4 py-2 font-semibold text-gray-600">
                      {t('acquisition.colDuration')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => {
                    const meta = ACQUISITION_TYPES[r.type];
                    return (
                      <tr key={r.type} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-4 py-2 flex items-center space-x-2">
                          <span>{meta?.icon ?? '📦'}</span>
                          <span>{meta?.name ?? r.type}</span>
                        </td>
                        <td className="px-4 py-2 text-center">
                          {r.success ? (
                            <span className="inline-block bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">
                              {t('acquisition.statusSuccess')}
                            </span>
                          ) : (
                            <span className="inline-block bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded-full">
                              {t('acquisition.statusFailed')}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-500">
                          {(() => {
                            const totalSize =
                              r.files?.reduce((sum, f) => sum + f.fileSize, 0) ?? null;
                            if (totalSize == null || totalSize === 0) return '—';
                            return totalSize > 1024 * 1024
                              ? `${(totalSize / 1024 / 1024).toFixed(1)} MB`
                              : `${(totalSize / 1024).toFixed(1)} KB`;
                          })()}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-500">
                          {r.duration > 0
                            ? r.duration >= 1000
                              ? `${(r.duration / 1000).toFixed(1)}s`
                              : `${r.duration}ms`
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="text-center">
              <button
                onClick={handleReset}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                {t('acquisition.startNew')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
