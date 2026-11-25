/**
 * Guided protected acquisition.
 *
 * Order of steps follows the design (chapter 2): invitation → out-of-band
 * recipient verification → phone connection → scope → destination →
 * acquisition → summary. No command that produces artefacts runs before the
 * recipient is confirmed, and the save dialog opens only after verification.
 * All acquisition logic lives in the shared SessionCoordinator.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ACQUISITION_TYPES, ADBConnection, Logger } from '@wafb/core';
import type {
  AcquisitionType,
  Device,
  DeviceProperties,
  ParsedInvite,
  ProtectedSessionConfig,
  RecipientVerificationState,
} from '@wafb/core';
import { APP_VERSION } from '../../lib/constants';
import { isModuleSupported } from '../../lib/moduleTasks';
import { suggestedArchiveName } from '../../lib/platform';
import { useSessionStore, type SaveTarget } from '../../stores/sessionStore';
import { InvitePanel } from '../protection/InvitePanel';
import { RecipientVerificationPanel } from '../protection/RecipientVerificationPanel';
import { DestinationPicker, PreflightPanel, SessionProgress, SessionSummary } from '../protection/SessionPanels';

type Step = 'invite' | 'verify' | 'connect' | 'scope' | 'destination' | 'acquiring' | 'summary';
const STEPS: Step[] = ['invite', 'verify', 'connect', 'scope', 'destination', 'acquiring', 'summary'];

function StepIndicator({ current }: { current: Step }) {
  const { t } = useTranslation();
  const ci = STEPS.indexOf(current);
  return (
    <ol className="flex flex-wrap items-center justify-center gap-2 mb-6 text-xs" aria-label="steps">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2" aria-current={i === ci ? 'step' : undefined}>
          <span
            className={`w-6 h-6 rounded-full flex items-center justify-center font-semibold ${
              i < ci ? 'bg-green-500 text-white' : i === ci ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'
            }`}
          >
            {i < ci ? '✓' : i + 1}
          </span>
          <span className={i === ci ? 'text-blue-700 font-medium' : 'text-gray-500'}>{t(`wizard.steps.${s}`)}</span>
          {i < STEPS.length - 1 && <span className="w-4 h-px bg-gray-300" />}
        </li>
      ))}
    </ol>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-lg shadow p-6 space-y-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function WizzardAcquisitionPage() {
  const { t } = useTranslation();
  const session = useSessionStore();

  const [step, setStep] = useState<Step>('invite');
  const [invite, setInvite] = useState<ParsedInvite | null>(null);
  const [preflightOk, setPreflightOk] = useState(false);
  const [recipientState, setRecipientState] = useState<RecipientVerificationState>({ status: 'absent' });
  const [device, setDevice] = useState<Device | null>(null);
  const [props, setProps] = useState<DeviceProperties | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AcquisitionType[]>([]);
  const [target, setTarget] = useState<SaveTarget | null>(null);

  function onInvite(inv: ParsedInvite | null) {
    setInvite(inv);
    setRecipientState(inv ? { status: 'unverified', recipient: inv.recipient } : { status: 'absent' });
    setSelected(inv ? [...inv.payload.profile] : []);
  }

  async function connect() {
    setConnecting(true);
    setConnectError(null);
    try {
      Logger.setLogLevel('info');
      const dev = await new ADBConnection().connect({ retryAttempts: 3, retryDelay: 1000 });
      setProps(await dev.getProperties());
      setDevice(dev);
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  }

  async function start() {
    if (!invite || recipientState.status !== 'confirmed' || !device || !target) return;
    const removed = invite.payload.profile.filter(m => !selected.includes(m));
    const config: ProtectedSessionConfig = {
      mode: 'protected',
      requested: invite.payload.profile.filter(m => selected.includes(m)),
      profileSource: 'invite',
      ...(removed.length ? { profileChange: { added: [], removed } } : {}),
      tool: { version: APP_VERSION, userAgent: navigator.userAgent },
      device: props,
      recipient: recipientState.recipient,
      recipientConfirmation: recipientState.confirmation,
      caseRef: invite.payload.caseRef,
    };
    setStep('acquiring');
    await session.start(config, device, target);
    setStep('summary');
  }

  function newSession() {
    session.reset();
    setTarget(null);
    setStep(device ? 'scope' : 'connect');
  }

  const nav = (back: Step | null, next: Step | null, canNext: boolean) => (
    <div className="flex justify-between pt-2">
      {back ? (
        <button onClick={() => setStep(back)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">
          ← {t('wizard.back')}
        </button>
      ) : <span />}
      {next && (
        <button
          onClick={() => setStep(next)}
          disabled={!canNext}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm font-semibold rounded"
        >
          {t('wizard.next')} →
        </button>
      )}
    </div>
  );

  return (
    <div className="bg-gray-50 p-8 h-full">
      <div className="max-w-3xl mx-auto">
        <StepIndicator current={step} />

        {step === 'invite' && (
          <Card title={t('invite.title')}>
            <InvitePanel invite={invite} onInvite={onInvite} />
            {!invite && <p className="text-sm text-gray-500">{t('wizard.needsInvite')}</p>}
            <h3 className="font-semibold text-sm pt-2">{t('preflight.title')}</h3>
            <PreflightPanel onResult={r => setPreflightOk(r.ok)} />
            {nav(null, 'verify', !!invite && preflightOk)}
          </Card>
        )}

        {step === 'verify' && invite && (
          <Card title={t('verify.title')}>
            <RecipientVerificationPanel recipient={invite.recipient} state={recipientState} onState={setRecipientState} />
            {nav(recipientState.status === 'confirmed' ? null : 'invite', 'connect', recipientState.status === 'confirmed')}
          </Card>
        )}

        {step === 'connect' && (
          <Card title={t('connect.title')}>
            <p className="text-sm text-gray-600">{t('connect.subtitle')}</p>
            {props ? (
              <p className="text-sm bg-blue-50 rounded p-3">
                📱 {props.manufacturer} {props.model} · Android {props.androidVersion} · SDK {props.sdkVersion}
              </p>
            ) : (
              <button
                onClick={connect}
                disabled={connecting}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded"
              >
                {connecting ? t('connect.buttonConnecting') : t('connect.buttonConnect')}
              </button>
            )}
            {connectError && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{connectError}</p>}
            <p className="text-xs text-gray-500 border-l-4 border-gray-300 pl-2">{t('verify.notAdb')}</p>
            <ul className="text-xs text-gray-600 space-y-1">
              <li>• {t('connect.req2')}</li>
              <li>• {t('connect.req3')}</li>
              <li>• {t('connect.req4')}</li>
            </ul>
            {nav(null, 'scope', !!device)}
          </Card>
        )}

        {step === 'scope' && invite && (
          <Card title={t('scope.title')}>
            <p className="text-sm text-gray-600">{t('scope.fromInvite')}</p>
            <ul className="space-y-1">
              {invite.payload.profile.map(m => {
                const supported = isModuleSupported(m);
                return (
                  <li key={m}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.includes(m)}
                        onChange={e =>
                          setSelected(s => (e.target.checked ? [...s, m] : s.filter(x => x !== m)))
                        }
                      />
                      {ACQUISITION_TYPES[m].icon} {ACQUISITION_TYPES[m].name}
                      {!supported && <span className="text-xs text-amber-700">({t('scope.unsupported')})</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
            {invite.payload.profile.some(m => !selected.includes(m)) && (
              <p className="text-xs text-amber-800">
                {t('scope.removed')}: {invite.payload.profile.filter(m => !selected.includes(m)).join(', ')}
              </p>
            )}
            <p className="text-xs text-gray-600">{t('scope.personalData')}</p>
            {nav('connect', 'destination', selected.length > 0)}
          </Card>
        )}

        {step === 'destination' && invite && (
          <Card title={t('destination.title')}>
            <DestinationPicker
              suggestedName={suggestedArchiveName('wafb-protected', invite.payload.caseRef)}
              target={target}
              onTarget={setTarget}
              disabled={recipientState.status !== 'confirmed'}
            />
            <div className="flex justify-between pt-2">
              <button onClick={() => setStep('scope')} disabled={!!target} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded disabled:opacity-40">
                ← {t('wizard.back')}
              </button>
              <button
                onClick={start}
                disabled={!target || recipientState.status !== 'confirmed' || !device}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-semibold rounded"
              >
                {t('advanced.start')}
              </button>
            </div>
          </Card>
        )}

        {step === 'acquiring' && (
          <Card title={t('wizard.steps.acquiring')}>
            <SessionProgress />
          </Card>
        )}

        {step === 'summary' && session.result && (
          <Card title={t('summary.title')}>
            <SessionSummary result={session.result} onNew={newSession} />
          </Card>
        )}
      </div>
    </div>
  );
}
