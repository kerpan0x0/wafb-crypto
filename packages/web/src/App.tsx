import React from 'react';
import { Download, AlertCircle, CheckCircle, Smartphone } from 'lucide-react';
import { useBugreport } from './hooks/useBugreport';
import { ProgressBar } from './components/ProgressBar';
import { DeviceInfo } from './components/DeviceInfo';

function App() {
  const { progress, acquireBugreport, reset, isActive } = useBugreport();

  const handleAcquire = async () => {
    const result = await acquireBugreport();
    
    if (result.success) {
      console.log('Bugreport acquired successfully:', result);
    } else {
      console.error('Failed to acquire bugreport:', result.error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500 text-white">
              <Smartphone className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">WAFB</h1>
              <p className="text-xs text-gray-500">WebADB Forensics Bridge</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="space-y-8">
          {/* Title Section */}
          <div className="text-center">
            <h2 className="text-3xl font-bold text-gray-900">
              Android Bugreport Acquisition
            </h2>
            <p className="mt-2 text-gray-600">
              Extract a complete bugreport from your Android device via USB
            </p>
          </div>

          {/* Main Card */}
          <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-lg">
            {/* Status Messages */}
            {progress.status === 'error' && (
              <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
                <div className="flex-1">
                  <h4 className="font-semibold text-red-900">Error</h4>
                  <p className="mt-1 text-sm text-red-700">{progress.message}</p>
                </div>
              </div>
            )}

            {progress.status === 'success' && (
              <div className="mb-6 flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
                <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600" />
                <div className="flex-1">
                  <h4 className="font-semibold text-green-900">Success!</h4>
                  <p className="mt-1 text-sm text-green-700">{progress.message}</p>
                </div>
              </div>
            )}

            {/* Device Info (shown when connected) */}
            {progress.deviceInfo && (
              <div className="mb-6">
                <DeviceInfo device={progress.deviceInfo} />
              </div>
            )}

            {/* Progress Bar (shown when active) */}
            {isActive && (
              <div className="mb-6">
                <ProgressBar
                  progress={progress.progress}
                  status={progress.status}
                  message={progress.message}
                />
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleAcquire}
                disabled={isActive}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary-500 px-6 py-3 font-semibold text-white transition-all hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary-500"
              >
                <Download className="h-5 w-5" />
                {isActive ? 'Acquiring...' : 'Start Acquisition'}
              </button>

              {(progress.status === 'success' || progress.status === 'error') && (
                <button
                  onClick={reset}
                  className="rounded-lg border border-gray-300 bg-white px-6 py-3 font-semibold text-gray-700 transition-all hover:bg-gray-50"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {/* Info Card */}
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-6">
            <h3 className="mb-3 font-semibold text-blue-900">Requirements</h3>
            <ul className="space-y-2 text-sm text-blue-800">
              <li className="flex items-start gap-2">
                <span className="mt-0.5">•</span>
                <span>Chrome or Edge browser (WebUSB required)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5">•</span>
                <span>Android device with USB debugging enabled</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5">•</span>
                <span>USB cable connected to your computer</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5">•</span>
                <span>Desktop ADB server must be stopped (run: adb kill-server)</span>
              </li>
            </ul>
          </div>

          {/* Technical Info */}
          <details className="rounded-lg border border-gray-200 bg-white p-4">
            <summary className="cursor-pointer font-semibold text-gray-700">
              Technical Information
            </summary>
            <div className="mt-4 space-y-2 text-sm text-gray-600">
              <p>
                <strong>What is a bugreport?</strong> A bugreport is a comprehensive 
                diagnostic file that contains system logs, stack traces, and device 
                state information useful for debugging and forensic analysis.
              </p>
              <p>
                <strong>Privacy:</strong> Bugreports may contain sensitive information. 
                Handle them appropriately and do not share publicly.
              </p>
              <p>
                <strong>Duration:</strong> Generation typically takes 1-2 minutes 
                depending on device performance and log size.
              </p>
            </div>
          </details>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-12 border-t border-gray-200 bg-white py-6">
        <div className="mx-auto max-w-4xl px-6 text-center text-sm text-gray-500">
          WAFB v0.1.0 - WebADB Forensics Bridge | GPL-3.0 License
        </div>
      </footer>
    </div>
  );
}

export default App;