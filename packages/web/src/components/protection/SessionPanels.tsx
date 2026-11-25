import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ACQUISITION_TYPES, formatKeyId } from '@wafb/core';
import type { AcquisitionType, ArtifactRecord, SessionResult } from '@wafb/core';
import { formatBytes, formatDuration, pickSaveTarget, runPreflight, type PreflightResult } from '../../lib/platform';
import { useSessionStore, type SaveTarget } from '../../stores/sessionStore';

// ── Preflight ───────────────────────────────────────────────────────────────

export function PreflightPanel({ onResult }: { onResult?: (r: PreflightResult) => void }) {
  const { t } = useTranslation();
  const [r] = useState(runPreflight);
  useEffect(() => { onResult?.(r); }, [r, onResult]);
  const row = (ok: boolean, label: string) => (
    <li className="flex items-center gap-2 text-sm">
      <span aria-hidden className={ok ? 'text-green-600' : 'text-red-600'}>{ok ? '✓' : '✗'}</span>
      <span>{label}</span>
      <span className="sr-only">{ok ? 'OK' : 'missing'}</span>
    </li>
  );
  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {row(r.secureContext, t('preflight.secureContext'))}
        {row(r.webUsb, t('preflight.webUsb'))}
        {row(r.fileSystemAccess, t('preflight.fsAccess'))}
      </ul>
      <p className={`text-sm rounded p-2 ${r.ok ? 'text-green-800 bg-green-50' : 'text-red-800 bg-red-50 border border-red-200'}`}>
        {r.ok ? t('preflight.ok') : t('preflight.blocked')}
      </p>
    </div>
  );
}

// ── Destination ─────────────────────────────────────────────────────────────

/**
 * The button opens the save dialog directly from the click: the handler's
 * first await IS the picker, so the browser still sees a user gesture.
 */
export function DestinationPicker({
  suggestedName,
  target,
  onTarget,
  disabled,
}: {
  suggestedName: string;
  target: SaveTarget | null;
  onTarget: (t: SaveTarget) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  async function choose() {
    const r = await pickSaveTarget(suggestedName);
    if (r.status === 'picked') { setNote(null); onTarget({ writable: r.writable, fileName: r.fileName }); }
    else if (r.status === 'dismissed') setNote({ kind: 'info', text: t('destination.dismissed') });
    else setNote({ kind: 'error', text: t('destination.failed') });
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-600">{t('destination.intro')}</p>
      {target ? (
        <p className="text-sm bg-gray-50 border border-gray-200 rounded p-2">
          {t('destination.chosen')}: <span className="font-mono">{target.fileName}</span>
        </p>
      ) : (
        <button
          onClick={choose}
          disabled={disabled}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm font-semibold rounded"
        >
          {t('destination.choose')}
        </button>
      )}
      {note && (
        <p role={note.kind === 'error' ? 'alert' : undefined} className={`text-sm ${note.kind === 'error' ? 'text-red-700' : 'text-gray-600'}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}

// ── Progress ────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  pending: 'text-gray-500', running: 'text-blue-700', completed: 'text-green-700', failed: 'text-red-700',
  skipped: 'text-gray-500', unsupported: 'text-amber-700', cancelled: 'text-gray-600',
};

export function SessionProgress() {
  const { t } = useTranslation();
  const { state, modules, current, startedAt, config, logs, cancel } = useSessionStore();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const running = Object.values(modules).find(m => m.status === 'running');
  const protectedMode = config?.mode === 'protected';

  function stop() {
    if (window.confirm(t('session.stopConfirm'))) cancel();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold" role="status">{t(`states.${state}`)}</p>
        <button onClick={stop} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded">
          ⏹ {t('session.stop')}
        </button>
      </div>

      {protectedMode && (
        <p className="text-xs text-gray-600" title={t('session.lockMeaning')}>
          🔒 {t('session.encryptionActive')} — <span className="text-gray-500">{t('session.lockMeaning')}</span>
        </p>
      )}

      <dl className="grid grid-cols-2 gap-2 text-sm bg-gray-50 rounded p-3">
        <dt className="text-gray-500">{t('session.currentModule')}</dt>
        <dd>{running ? ACQUISITION_TYPES[running.module]?.name ?? running.module : '—'}</dd>
        <dt className="text-gray-500">{t('session.bytesAcquired')}</dt>
        <dd>{formatBytes(current?.bytesAcquired)} <span className="text-xs text-gray-400">({t('session.unknownTotal')})</span></dd>
        <dt className="text-gray-500">{t('session.archiveBytes')}</dt>
        <dd>{formatBytes(current?.archiveBytesWritten)}</dd>
        <dt className="text-gray-500">{t('session.elapsed')}</dt>
        <dd>{startedAt ? formatDuration(now - startedAt) : '—'}</dd>
      </dl>

      <ul className="divide-y divide-gray-100 border border-gray-100 rounded">
        {Object.values(modules).map(m => (
          <li key={m.module} className="flex items-center justify-between px-3 py-2 text-sm">
            <span>{ACQUISITION_TYPES[m.module as AcquisitionType]?.icon} {ACQUISITION_TYPES[m.module as AcquisitionType]?.name ?? m.module}</span>
            <span className={`font-medium ${STATUS_STYLE[m.status] ?? ''}`}>
              {t(`moduleStatus.${m.status}`)}
              {m.status === 'running' && m.message ? <span className="block text-xs text-gray-400 font-normal truncate max-w-xs">{m.message}</span> : null}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-sm text-gray-500">{t('session.keepConnected')}</p>

      <details className="text-xs">
        <summary className="cursor-pointer text-gray-500">{t('session.log')} ({logs.length})</summary>
        <ol className="mt-2 max-h-48 overflow-auto font-mono bg-gray-50 rounded p-2 space-y-0.5">
          {logs.map((l, i) => (
            <li key={i} className={l.level === 'error' ? 'text-red-700' : l.level === 'warn' ? 'text-amber-700' : ''}>
              {l.at.slice(11, 19)} {l.message}{l.code ? ` [${l.code}]` : ''}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

// ── Summary ─────────────────────────────────────────────────────────────────

export function SessionSummary({ result, onNew }: { result: SessionResult; onNew: () => void }) {
  const { t } = useTranslation();
  const { config, fileName, modules, artifacts } = useSessionStore();
  const [copied, setCopied] = useState(false);
  const saved = result.saveConfirmed;
  const incomplete: ArtifactRecord[] = artifacts.filter(a => a.status !== 'verified');
  const tone =
    result.state === 'completed' ? 'border-green-300 bg-green-50' :
    result.state === 'partial' ? 'border-amber-300 bg-amber-50' : 'border-red-300 bg-red-50';

  async function copyRef() {
    if (!result.archive?.sha256) return;
    await navigator.clipboard.writeText(result.archive.sha256);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      <div className={`border rounded p-4 ${tone}`} role="status">
        <p className="text-lg font-semibold">{t(`states.${result.state}`)}</p>
        {result.error && (
          <p className="text-sm mt-1">{t('summary.error')}: <span className="font-mono">{result.error.code}</span> — {result.error.message}</p>
        )}
        {!saved && (
          <>
            <p className="text-sm font-semibold mt-2">{t('summary.notSaved')}</p>
            <p className="text-xs mt-1">{t('summary.partialFileUnknown')}</p>
          </>
        )}
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
        {config?.caseRef && (<><dt className="text-gray-500">{t('summary.case')}</dt><dd className="sm:col-span-2 font-mono">{config.caseRef}</dd></>)}
        {config?.mode === 'protected' && (
          <><dt className="text-gray-500">{t('summary.recipient')}</dt><dd className="sm:col-span-2 font-mono text-xs break-all">{formatKeyId(config.recipient.keyId)}</dd></>
        )}
        {fileName && (<><dt className="text-gray-500">{t('summary.file')}</dt><dd className="sm:col-span-2 font-mono">{fileName}</dd></>)}
      </dl>

      {saved && result.archive?.sha256 && (
        <div className="border border-blue-200 bg-blue-50 rounded p-3 space-y-1">
          <p className="text-sm font-semibold">{t('summary.deliveryRef')}</p>
          <div className="flex items-start gap-2">
            <code className="font-mono text-xs break-all flex-1 select-all">{formatKeyId(result.archive.sha256)}</code>
            <button onClick={copyRef} className="text-xs px-2 py-1 border border-blue-300 rounded bg-white">
              {copied ? t('summary.copied') : t('summary.copy')}
            </button>
          </div>
          <p className="text-xs text-gray-700">{t('summary.deliveryRefHelp')}</p>
        </div>
      )}

      <div>
        <p className="text-sm font-semibold mb-1">{t('summary.modules')}</p>
        <ul className="divide-y divide-gray-100 border border-gray-100 rounded">
          {Object.values(modules).map(m => (
            <li key={m.module} className="flex items-center justify-between px-3 py-1.5 text-sm">
              <span>{ACQUISITION_TYPES[m.module as AcquisitionType]?.name ?? m.module}</span>
              <span className={`font-medium ${STATUS_STYLE[m.status] ?? ''}`}>{t(`moduleStatus.${m.status}`)}</span>
            </li>
          ))}
        </ul>
      </div>

      {incomplete.length > 0 && (
        <div>
          <p className="text-sm font-semibold mb-1">{t('summary.incompleteArtifacts')}</p>
          <ul className="text-xs space-y-1">
            {incomplete.map(a => (
              <li key={a.id} className="font-mono bg-amber-50 rounded p-1">
                {a.id} · {a.logicalName} · {formatBytes(a.bytesAcquired)} · {a.error?.code ?? a.source.cause}
              </li>
            ))}
          </ul>
        </div>
      )}

      {saved && <p className="text-sm">{t('summary.whatToSend')}</p>}
      <p className="text-xs text-gray-600">{t('summary.notClean')}</p>
      <p className="text-xs text-gray-600">{t('summary.afterwards')}</p>

      <button onClick={onNew} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded">
        {t('summary.newSession')}
      </button>
    </div>
  );
}
