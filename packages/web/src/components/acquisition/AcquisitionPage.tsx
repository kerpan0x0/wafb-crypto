/**
 * Advanced acquisition page.
 *
 * Same SessionCoordinator, same state machine and same definition of
 * "complete" as the wizard (RF10). It adds: free module selection (changes
 * against an invitation are recorded), manual entry of a recipient, and an
 * explicit, acknowledged legacy (unencrypted) mode. It cannot bypass the
 * recipient verification of the protected mode, and legacy mode is never an
 * automatic fallback.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ACQUISITION_TYPES,
  ADBConnection,
  Logger,
  generateCaseRef,
  recipientStateFromInput,
} from '@wafb/core';
import type {
  AcquisitionType,
  Device,
  DeviceProperties,
  ParsedInvite,
  RecipientVerificationState,
  SessionConfig,
} from '@wafb/core';
import { useAcquisitionStore, initializeAcquisitionTypes } from '../../stores/acquisitionStore';
import { useSessionStore, type SaveTarget } from '../../stores/sessionStore';
import { APP_VERSION } from '../../lib/constants';
import { isModuleSupported } from '../../lib/moduleTasks';
import { runPreflight, suggestedArchiveName } from '../../lib/platform';
import { InvitePanel } from '../protection/InvitePanel';
import { RecipientVerificationPanel } from '../protection/RecipientVerificationPanel';
import { DestinationPicker, PreflightPanel, SessionProgress, SessionSummary } from '../protection/SessionPanels';

type Mode = 'protected' | 'legacy';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-lg shadow p-6 mb-6 space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function AcquisitionPage() {
  const { t } = useTranslation();
  const session = useSessionStore();
  const { acquisitions, initializeAcquisitions, toggleAcquisition, selectAll, deselectAll, setSelection, getSelectedAcquisitions } =
    useAcquisitionStore();

  const [mode, setMode] = useState<Mode>('protected');
  const [legacyAck, setLegacyAck] = useState(false);
  const [invite, setInvite] = useState<ParsedInvite | null>(null);
  const [manualKey, setManualKey] = useState('');
  const [caseRef, setCaseRef] = useState(generateCaseRef);
  const [recipientState, setRecipientState] = useState<RecipientVerificationState>({ status: 'absent' });
  const [device, setDevice] = useState<Device | null>(null);
  const [props, setProps] = useState<DeviceProperties | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<SaveTarget | null>(null);
  const [preflight] = useState(runPreflight);

  useEffect(() => {
    Logger.setLogLevel('info');
    initializeAcquisitionTypes(ACQUISITION_TYPES);
  }, []);

  const active = session.isActive();
  const finished = session.result !== null;
  const recipientConfirmed = recipientState.status === 'confirmed';
  const selected = getSelectedAcquisitions();

  function onInvite(inv: ParsedInvite | null) {
    setInvite(inv);
    setRecipientState(inv ? { status: 'unverified', recipient: inv.recipient } : { status: 'absent' });
    if (inv) {
      setCaseRef(inv.payload.caseRef);
      if (device) setSelection(inv.payload.profile);
    }
  }

  async function useManualKey() {
    setInvite(null);
    setRecipientState(await recipientStateFromInput(manualKey));
  }

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const dev = await new ADBConnection().connect({ retryAttempts: 3, retryDelay: 1000 });
      const p = await dev.getProperties();
      initializeAcquisitions(p, await dev.isRooted());
      if (invite) setSelection(invite.payload.profile);
      setProps(p);
      setDevice(dev);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    if (device && !active) {
      await device.disconnect();
      setDevice(null);
      setProps(null);
    }
  }

  const canStart =
    !!device && !!target && selected.length > 0 && preflight.ok &&
    (mode === 'protected' ? recipientConfirmed && /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(caseRef) : legacyAck);

  async function start() {
    if (!canStart || !device || !target) return;
    const requested = selected;
    const base = {
      requested,
      tool: { version: APP_VERSION, userAgent: navigator.userAgent },
      device: props,
    };
    let config: SessionConfig;
    if (mode === 'protected') {
      if (recipientState.status !== 'confirmed') return;
      const profile = invite?.payload.profile ?? [];
      const added = invite ? requested.filter(m => !profile.includes(m)) : [];
      const removed = invite ? profile.filter(m => !requested.includes(m)) : [];
      config = {
        ...base,
        mode: 'protected',
        profileSource: invite ? 'invite' : 'operator',
        ...(added.length || removed.length ? { profileChange: { added, removed } } : {}),
        recipient: recipientState.recipient,
        recipientConfirmation: recipientState.confirmation,
        caseRef,
      };
    } else {
      config = {
        ...base,
        mode: 'legacy',
        profileSource: 'operator',
        folder: target.fileName.replace(/\.zip$/i, '') || 'wafb-acquisition',
      };
    }
    await session.start(config, device, target);
  }

  function newSession() {
    session.reset();
    setTarget(null);
  }

  // ── during / after a session ─────────────────────────────────────────────
  if (active) {
    return (
      <div className="bg-gray-50 p-8 h-full"><div className="max-w-4xl mx-auto">
        <Section title={t('acquisition.progressTitle')}><SessionProgress /></Section>
      </div></div>
    );
  }
  if (finished && session.result) {
    return (
      <div className="bg-gray-50 p-8 h-full"><div className="max-w-4xl mx-auto">
        <Section title={t('summary.title')}><SessionSummary result={session.result} onNew={newSession} /></Section>
      </div></div>
    );
  }

  // ── configuration ────────────────────────────────────────────────────────
  return (
    <div className="bg-gray-50 p-8 h-full">
      <div className="max-w-4xl mx-auto">
        <Section title={t('preflight.title')}>
          <PreflightPanel />
        </Section>

        <Section title={t('advanced.mode')}>
          <div className="flex flex-col sm:flex-row gap-3">
            {(['protected', 'legacy'] as const).map(m => (
              <label key={m} className={`flex-1 border-2 rounded p-3 cursor-pointer text-sm ${mode === m ? (m === 'legacy' ? 'border-red-500 bg-red-50' : 'border-blue-500 bg-blue-50') : 'border-gray-200'}`}>
                <input type="radio" name="mode" className="mr-2" checked={mode === m} disabled={!!target} onChange={() => { setMode(m); setLegacyAck(false); }} />
                {t(`advanced.${m}`)}
              </label>
            ))}
          </div>
          {mode === 'legacy' && (
            <div className="border border-red-300 bg-red-50 rounded p-3 space-y-2">
              <p className="text-sm text-red-900">{t('advanced.legacyWarning')}</p>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={legacyAck} onChange={e => setLegacyAck(e.target.checked)} />
                {t('advanced.legacyAck')}
              </label>
            </div>
          )}
        </Section>

        {mode === 'protected' && (
          <Section title={t('invite.title')}>
            {!recipientConfirmed && <InvitePanel invite={invite} onInvite={onInvite} />}
            {!invite && !recipientConfirmed && (
              <div className="border-t pt-3 space-y-2">
                <p className="text-sm font-medium">{t('advanced.manualRecipient')}</p>
                <label className="block text-xs text-gray-500" htmlFor="manual-key">{t('advanced.recipientLabel')}</label>
                <input id="manual-key" value={manualKey} onChange={e => setManualKey(e.target.value)} spellCheck={false} autoComplete="off" className="w-full font-mono text-sm border border-gray-300 rounded p-2" />
                <label className="block text-xs text-gray-500" htmlFor="case-ref">{t('advanced.caseRefLabel')}</label>
                <div className="flex gap-2">
                  <input id="case-ref" value={caseRef} onChange={e => setCaseRef(e.target.value)} spellCheck={false} className="flex-1 font-mono text-sm border border-gray-300 rounded p-2" />
                  <button onClick={() => setCaseRef(generateCaseRef())} className="px-3 text-sm border rounded">{t('advanced.generate')}</button>
                </div>
                <button onClick={useManualKey} disabled={!manualKey.trim()} className="px-4 py-2 bg-blue-600 disabled:bg-gray-300 text-white text-sm font-semibold rounded">
                  {t('advanced.use')}
                </button>
                {recipientState.status === 'invalid' && (
                  <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{t(`recipientErrors.${recipientState.code}`)}</p>
                )}
              </div>
            )}
            {(recipientState.status === 'unverified' || recipientState.status === 'confirmed') && (
              <div className="border-t pt-3">
                <h3 className="font-semibold mb-2">{t('verify.title')}</h3>
                <RecipientVerificationPanel recipient={recipientState.recipient} state={recipientState} onState={setRecipientState} />
              </div>
            )}
          </Section>
        )}

        <Section title={t('device.title')}>
          {props ? (
            <div className="flex items-center justify-between">
              <p className="text-sm">📱 {props.manufacturer} {props.model} · Android {props.androidVersion} · SDK {props.sdkVersion}</p>
              <button onClick={disconnect} className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded">{t('device.disconnect')}</button>
            </div>
          ) : (
            <button onClick={connect} disabled={connecting || (mode === 'protected' && !recipientConfirmed)} className="px-6 py-2 bg-blue-600 disabled:bg-gray-300 text-white font-semibold rounded">
              {connecting ? t('connect.buttonConnecting') : t('connect.buttonConnect')}
            </button>
          )}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <p className="text-xs text-gray-500">{t('verify.notAdb')}</p>
        </Section>

        {device && (
          <Section title={t('acquisition.title')}>
            <div className="flex gap-2 justify-end">
              <button onClick={selectAll} className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded">{t('acquisition.selectAll')}</button>
              <button onClick={deselectAll} className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-50 rounded">{t('acquisition.deselectAll')}</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Array.from(acquisitions.values()).map(acq => (
                <label key={acq.type} className={`border-2 rounded p-3 cursor-pointer text-sm ${acq.enabled ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                  <div className="flex items-start justify-between">
                    <span className="font-semibold">{acq.metadata.icon} {acq.metadata.name}</span>
                    <input type="checkbox" checked={acq.enabled} onChange={() => toggleAcquisition(acq.type)} />
                  </div>
                  <p className="text-xs text-gray-600 mt-1">{acq.metadata.description}</p>
                  {!isModuleSupported(acq.type) && <p className="text-xs text-amber-700">{t('scope.unsupported')}</p>}
                  {invite && !invite.payload.profile.includes(acq.type as AcquisitionType) && acq.enabled && (
                    <p className="text-xs text-amber-700">+ {t('scope.added')}</p>
                  )}
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-600">{t('scope.personalData')}</p>
          </Section>
        )}

        {device && (
          <Section title={t('destination.title')}>
            <DestinationPicker
              suggestedName={suggestedArchiveName(mode === 'protected' ? 'wafb-protected' : 'wafb-legacy', mode === 'protected' ? caseRef : null)}
              target={target}
              onTarget={setTarget}
              disabled={mode === 'protected' ? !recipientConfirmed : !legacyAck}
            />
          </Section>
        )}

        <button onClick={start} disabled={!canStart} className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-semibold py-4 rounded-lg text-lg">
          {t('advanced.start')} ({selected.length})
        </button>
      </div>
    </div>
  );
}
