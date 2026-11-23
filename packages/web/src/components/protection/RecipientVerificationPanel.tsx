import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { confirmRecipient, formatKeyId, KeyIdMismatchError } from '@wafb/core';
import type { RecipientVerificationState, ValidatedRecipient, VerificationMethod } from '@wafb/core';

/**
 * Out-of-band verification of the recipient (RF2).
 *
 * Shows the full key identifier (64 hex chars, grouped) and requires either
 * typing/pasting the fingerprint received from the analyst — which must match
 * in full — or an explicit attestation that the whole fingerprint was compared
 * over another authenticated channel. A mismatch blocks the start and cannot
 * be overridden.
 */
export function RecipientVerificationPanel({
  recipient,
  state,
  onState,
}: {
  recipient: ValidatedRecipient;
  state: RecipientVerificationState;
  onState: (s: RecipientVerificationState) => void;
}) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<VerificationMethod>('full-key-id-entered');
  const [entered, setEntered] = useState('');
  const [attested, setAttested] = useState(false);
  const [mismatch, setMismatch] = useState(false);

  const groups = formatKeyId(recipient.keyId).split(' ');

  function confirm() {
    setMismatch(false);
    try {
      onState(
        confirmRecipient(
          { status: 'unverified', recipient },
          { method, enteredKeyId: method === 'full-key-id-entered' ? entered : undefined }
        )
      );
    } catch (err) {
      if (err instanceof KeyIdMismatchError) setMismatch(true);
      else throw err;
    }
  }

  const confirmed = state.status === 'confirmed';
  const canConfirm = !confirmed && (method === 'full-key-id-entered' ? entered.replace(/[\s:-]/g, '').length >= 64 : attested);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-700">{t('verify.intro')}</p>

      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1">{t('verify.fingerprint')}</p>
        <div
          className="grid grid-cols-4 sm:grid-cols-8 gap-1 font-mono text-base bg-gray-50 border border-gray-200 rounded p-3 select-all"
          aria-label={t('verify.fingerprint')}
        >
          {groups.map((g, i) => (
            <span key={i} className="text-center tracking-wider">{g}</span>
          ))}
        </div>
      </div>

      <p className="text-sm text-gray-600">{t('verify.howTo')}</p>
      <p className="text-xs text-gray-500 border-l-4 border-gray-300 pl-2">{t('verify.notAdb')}</p>

      {confirmed ? (
        <div className="bg-green-50 border border-green-200 rounded p-3 text-sm">
          <p className="font-semibold text-green-800">✓ {t('verify.confirmed')}</p>
          <p className="text-green-900 text-xs mt-1">{t('verify.confirmedNote')}</p>
          <p className="text-gray-500 text-xs mt-1">{t('verify.change')}</p>
        </div>
      ) : (
        <fieldset className="space-y-2">
          {(
            [
              ['full-key-id-entered', 'verify.methodEnter'],
              ['full-key-id-compared-by-voice', 'verify.methodVoice'],
              ['full-key-id-compared-in-person', 'verify.methodPerson'],
              ['other-authenticated-channel', 'verify.methodOther'],
            ] as const
          ).map(([m, label]) => (
            <label key={m} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="verify-method"
                checked={method === m}
                onChange={() => { setMethod(m); setMismatch(false); }}
                className="mt-1"
              />
              {t(label)}
            </label>
          ))}

          {method === 'full-key-id-entered' ? (
            <div>
              <label htmlFor="keyid-input" className="block text-xs text-gray-500 mb-1">{t('verify.enterLabel')}</label>
              <input
                id="keyid-input"
                value={entered}
                onChange={e => { setEntered(e.target.value); setMismatch(false); }}
                spellCheck={false}
                autoComplete="off"
                className="w-full font-mono text-sm border border-gray-300 rounded p-2"
              />
            </div>
          ) : (
            <label className="flex items-start gap-2 text-sm font-medium">
              <input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} className="mt-1" />
              {t('verify.attest')}
            </label>
          )}

          {mismatch && (
            <p role="alert" className="text-sm font-semibold text-red-800 bg-red-50 border border-red-300 rounded p-3">
              ✗ {t('verify.mismatch')}
            </p>
          )}

          <button
            onClick={confirm}
            disabled={!canConfirm}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm font-semibold rounded"
          >
            {t('verify.confirm')}
          </button>
        </fieldset>
      )}
    </div>
  );
}
