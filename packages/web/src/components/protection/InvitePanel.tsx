import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ACQUISITION_TYPES, InviteError, inviteFromHash, parseInvite } from '@wafb/core';
import type { ParsedInvite } from '@wafb/core';

/**
 * Loads an analyst invitation, either from the URL fragment (`#invite=…`) or
 * from pasted text. After importing from the URL, the fragment is removed from
 * the address bar so it does not linger in the visible URL.
 */
export function InvitePanel({
  invite,
  onInvite,
}: {
  invite: ParsedInvite | null;
  onInvite: (inv: ParsedInvite | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fromLink, setFromLink] = useState(false);

  useEffect(() => {
    if (invite) return;
    const encoded = inviteFromHash(window.location.hash);
    if (!encoded) return;
    history.replaceState(null, '', window.location.pathname + window.location.search);
    parseInvite(encoded).then(
      inv => { setFromLink(true); onInvite(inv); },
      err => setError(describe(err))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function describe(err: unknown): string {
    if (err instanceof InviteError) {
      if (err.code === 'bad-recipient' && err.recipientCode) return t(`recipientErrors.${err.recipientCode}`);
      return t(`invite.errors.${err.code}`);
    }
    return t('invite.errors.not-json');
  }

  async function load() {
    setError(null);
    const raw = text.trim();
    const encoded = raw.includes('#') ? inviteFromHash(raw.slice(raw.indexOf('#'))) : raw.replace(/^invite=/, '');
    try {
      onInvite(await parseInvite(encoded));
      setText('');
    } catch (err) {
      setError(describe(err));
      onInvite(null);
    }
  }

  if (invite) {
    const p = invite.payload;
    return (
      <div className="space-y-3">
        {fromLink && <p className="text-xs text-gray-500">{t('invite.loadedFromLink')}</p>}
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
          <dt className="text-gray-500">{t('invite.caseRef')}</dt>
          <dd className="sm:col-span-2 font-mono">{p.caseRef}</dd>
          {p.analystLabel && (
            <>
              <dt className="text-gray-500">{t('invite.analystLabel')}</dt>
              <dd className="sm:col-span-2">
                {p.analystLabel} <span className="text-xs text-gray-400">({t('invite.analystLabelNote')})</span>
              </dd>
            </>
          )}
          {p.expiresAt && (
            <>
              <dt className="text-gray-500">{t('invite.expires')}</dt>
              <dd className="sm:col-span-2">{new Date(p.expiresAt).toLocaleString(i18n.language)}</dd>
            </>
          )}
          <dt className="text-gray-500">{t('invite.profile')}</dt>
          <dd className="sm:col-span-2">
            <ul className="flex flex-wrap gap-1">
              {p.profile.map(m => (
                <li key={m} className="text-xs bg-gray-100 rounded px-2 py-0.5">{ACQUISITION_TYPES[m]?.name ?? m}</li>
              ))}
            </ul>
          </dd>
        </dl>
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">{t('invite.notSecret')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">{t('invite.intro')}</p>
      <label className="block text-sm font-medium" htmlFor="invite-input">{t('invite.pasteLabel')}</label>
      <textarea
        id="invite-input"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={t('invite.pastePlaceholder')}
        rows={3}
        spellCheck={false}
        autoComplete="off"
        className="w-full font-mono text-xs border border-gray-300 rounded p-2"
      />
      {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</p>}
      <button
        onClick={load}
        disabled={!text.trim()}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm font-semibold rounded"
      >
        {t('invite.load')}
      </button>
    </div>
  );
}
