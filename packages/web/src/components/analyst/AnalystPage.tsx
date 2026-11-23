/**
 * Analyst page (RF8, RF9): key preparation, self-test, invitation, archive
 * verification and controlled extraction.
 *
 * The identity (private key) lives only in this component's memory. It is not
 * put in the URL, in localStorage or in logs; exporting it to a file is an
 * explicit action. The public recipient and the private identity are shown in
 * visually distinct boxes so one cannot be mistaken for the other.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ACQUISITION_TYPES,
  AgeStreamDecryptor,
  AgeStreamEncryptor,
  createInvite,
  extractVerifiedArtifact,
  formatKeyId,
  generateCaseRef,
  generateX25519Identity,
  identityToRecipient,
  inviteUrl,
  safeFileName,
  validateRecipient,
  verifyArchive,
} from '@wafb/core';
import type { AcquisitionType, ValidatedRecipient, VerificationReport } from '@wafb/core';
import { formatBytes, pickSaveTarget } from '../../lib/platform';

function Box({ title, children, tone = 'white' }: { title: string; children: React.ReactNode; tone?: 'white' | 'secret' | 'public' }) {
  const toneCls = tone === 'secret' ? 'border-red-300 bg-red-50' : tone === 'public' ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white';
  return (
    <section className={`border rounded-lg shadow-sm p-5 mb-5 space-y-3 ${toneCls}`}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const CHECK_TONE: Record<string, string> = { pass: 'text-green-700', fail: 'text-red-700', warn: 'text-amber-700', 'not-checked': 'text-gray-500' };

function extractIdentity(text: string): string | null {
  const line = text.split(/\r?\n/).map(l => l.trim()).find(l => l.startsWith('AGE-SECRET-KEY-1'));
  return line ?? null;
}

export function AnalystPage() {
  const { t } = useTranslation();
  const [identity, setIdentity] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<ValidatedRecipient | null>(null);
  const [loadText, setLoadText] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [selfTest, setSelfTest] = useState<'none' | 'ok' | 'fail'>('none');

  const [caseRef, setCaseRef] = useState(generateCaseRef);
  const [label, setLabel] = useState('');
  const [expires, setExpires] = useState('');
  const [profile, setProfile] = useState<AcquisitionType[]>(
    (Object.values(ACQUISITION_TYPES).filter(m => m.defaultEnabled).map(m => m.id))
  );
  const [link, setLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [archive, setArchive] = useState<File | null>(null);
  const [expectedCase, setExpectedCase] = useState('');
  const [expectedRef, setExpectedRef] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [exports, setExports] = useState<Record<string, string>>({});

  async function adopt(id: string) {
    const rcp = await validateRecipient(await identityToRecipient(id));
    setIdentity(id);
    setRecipient(rcp);
    setSelfTest('none');
    setLink(null);
    setReport(null);
  }

  async function generate() {
    await adopt(await generateX25519Identity());
  }

  async function loadFromText(text: string) {
    setLoadError(false);
    const id = extractIdentity(text);
    try {
      if (!id) throw new Error();
      await adopt(id);
      setLoadText('');
    } catch {
      setLoadError(true);
    }
  }

  function forget() {
    setIdentity(null);
    setRecipient(null);
    setSelfTest('none');
    setReport(null);
  }

  function savePrivate() {
    if (!identity || !recipient) return;
    const text = `# created: ${new Date().toISOString()}\n# public key: ${recipient.canonical}\n# wafb key ID: ${recipient.keyId}\n${identity}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `wafb-analyst-${recipient.keyId.slice(0, 8)}.agekey`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function runSelfTest() {
    if (!identity || !recipient) return;
    try {
      const probe = crypto.getRandomValues(new Uint8Array(4096));
      const ct = await new AgeStreamEncryptor(recipient).encryptBytes(probe);
      const pt = await new AgeStreamDecryptor(identity).decryptBytes(ct);
      setSelfTest(pt.length === probe.length && pt.every((b, i) => b === probe[i]) ? 'ok' : 'fail');
    } catch {
      setSelfTest('fail');
    }
  }

  async function makeInvite() {
    if (!recipient) return;
    setInviteError(null);
    try {
      const inv = await createInvite({
        recipient: recipient.canonical,
        caseRef,
        profile,
        ...(label.trim() ? { analystLabel: label.trim() } : {}),
        ...(expires ? { expiresAt: new Date(expires).toISOString() } : {}),
      });
      setLink(inviteUrl(window.location.origin + window.location.pathname, inv.fragment));
      setExpectedCase(caseRef);
    } catch (err) {
      setInviteError((err as Error).message);
    }
  }

  async function runVerify() {
    if (!identity || !archive) return;
    setVerifying(true);
    setReport(null);
    setExports({});
    try {
      const rep = await verifyArchive(archive, {
        identity,
        expectedCaseRef: expectedCase.trim() || undefined,
        expectedDeliveryRef: expectedRef.trim() || undefined,
        computeArchiveDigest: true,
        onProgress: p => setProgress(`${p.phase === 'artifact' ? p.artifactId : 'archive'}: ${formatBytes(p.bytes)}`),
      });
      setReport(rep);
    } finally {
      setVerifying(false);
      setProgress('');
    }
  }

  async function exportArtifact(id: string) {
    if (!report || !archive || !identity) return;
    const a = report.artifacts.find(x => x.id === id);
    if (!a || !a.usable || !a.computedDigest) return;
    const pick = await pickSaveTarget(safeFileName(a.logicalName, a.id));
    if (pick.status !== 'picked') return;
    try {
      await extractVerifiedArtifact(archive, a.entry, identity, a.computedDigest, pick.writable);
      setExports(e => ({ ...e, [id]: t('analyst.exported') }));
    } catch {
      setExports(e => ({ ...e, [id]: t('analyst.exportFailed') }));
    }
  }

  return (
    <div className="bg-gray-50 p-8 h-full">
      <div className="max-w-4xl mx-auto">
        <p className="text-sm text-gray-600 mb-5">{t('analyst.intro')}</p>

        {/* 1. Keys */}
        <Box title={t('analyst.keys')}>
          {!identity ? (
            <div className="space-y-3">
              <button onClick={generate} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded">
                {t('analyst.generate')}
              </button>
              <div className="border-t pt-3 space-y-2">
                <p className="text-sm font-medium">{t('analyst.load')}</p>
                <label className="block text-xs text-gray-500" htmlFor="id-paste">{t('analyst.loadPaste')}</label>
                <textarea id="id-paste" rows={2} value={loadText} onChange={e => setLoadText(e.target.value)} spellCheck={false} autoComplete="off" className="w-full font-mono text-xs border border-gray-300 rounded p-2" />
                <div className="flex gap-2 items-center">
                  <button onClick={() => loadFromText(loadText)} disabled={!loadText.trim()} className="px-3 py-1.5 bg-gray-700 disabled:bg-gray-300 text-white text-sm rounded">
                    {t('analyst.loadButton')}
                  </button>
                  <label className="text-sm text-blue-700 underline cursor-pointer">
                    {t('analyst.loadFile')}
                    <input type="file" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) await loadFromText(await f.text()); e.target.value = ''; }} />
                  </label>
                </div>
                {loadError && <p role="alert" className="text-sm text-red-700">{t('analyst.loadError')}</p>}
              </div>
            </div>
          ) : recipient && (
            <div className="space-y-3">
              <div className="border border-green-300 bg-green-50 rounded p-3">
                <p className="text-xs font-semibold text-green-900">{t('analyst.publicKey')}</p>
                <code className="block font-mono text-xs break-all select-all">{recipient.canonical}</code>
                <p className="text-xs font-semibold text-green-900 mt-2">{t('analyst.keyId')}</p>
                <code className="block font-mono text-sm break-all select-all">{formatKeyId(recipient.keyId)}</code>
              </div>
              <div className="border border-red-300 bg-red-50 rounded p-3 space-y-2">
                <p className="text-xs font-semibold text-red-900">🔐 {t('analyst.privateKey')}</p>
                <p className="text-xs text-red-900">{t('analyst.privateKeyHidden')}</p>
                <div className="flex gap-2">
                  <button onClick={savePrivate} className="px-3 py-1.5 bg-red-700 text-white text-sm rounded">{t('analyst.savePrivate')}</button>
                  <button onClick={forget} className="px-3 py-1.5 border border-red-300 text-red-800 text-sm rounded">{t('analyst.forget')}</button>
                </div>
                <p className="text-xs text-red-900">{t('analyst.savedWarn')}</p>
              </div>
            </div>
          )}
        </Box>

        {/* 2. Self-test */}
        {identity && (
          <Box title={t('analyst.selfTest')}>
            <p className="text-sm text-gray-600">{t('analyst.selfTestIntro')}</p>
            <button onClick={runSelfTest} className="px-4 py-2 bg-gray-700 text-white text-sm font-semibold rounded">{t('analyst.selfTestRun')}</button>
            {selfTest === 'ok' && <p role="status" className="text-sm text-green-800">✓ {t('analyst.selfTestOk')}</p>}
            {selfTest === 'fail' && <p role="alert" className="text-sm text-red-800 font-semibold">✗ {t('analyst.selfTestFail')}</p>}
          </Box>
        )}

        {/* 3. Invitation */}
        {identity && (
          <Box title={t('analyst.invite')}>
            {selfTest !== 'ok' ? (
              <p className="text-sm text-gray-500">{t('analyst.inviteNeedsTest')}</p>
            ) : (
              <div className="space-y-3">
                <label className="block text-sm" htmlFor="a-case">{t('analyst.caseRef')}</label>
                <div className="flex gap-2">
                  <input id="a-case" value={caseRef} onChange={e => setCaseRef(e.target.value)} className="flex-1 font-mono text-sm border border-gray-300 rounded p-2" />
                  <button onClick={() => setCaseRef(generateCaseRef())} className="px-3 text-sm border rounded">↻</button>
                </div>
                <p className="text-xs text-gray-500">{t('analyst.caseRefHelp')}</p>
                <label className="block text-sm" htmlFor="a-label">{t('analyst.label')}</label>
                <input id="a-label" value={label} onChange={e => setLabel(e.target.value)} maxLength={80} className="w-full text-sm border border-gray-300 rounded p-2" />
                <label className="block text-sm" htmlFor="a-exp">{t('analyst.expires')}</label>
                <input id="a-exp" type="datetime-local" value={expires} onChange={e => setExpires(e.target.value)} className="text-sm border border-gray-300 rounded p-2" />
                <p className="text-xs text-gray-500">{t('analyst.expiresHelp')}</p>
                <fieldset>
                  <legend className="text-sm mb-1">{t('analyst.profile')}</legend>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
                    {Object.values(ACQUISITION_TYPES).map(m => (
                      <label key={m.id} className="flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={profile.includes(m.id)} onChange={e => setProfile(p => (e.target.checked ? [...p, m.id] : p.filter(x => x !== m.id)))} />
                        {m.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <button onClick={makeInvite} disabled={profile.length === 0} className="px-4 py-2 bg-purple-600 disabled:bg-gray-300 text-white text-sm font-semibold rounded">{t('analyst.create')}</button>
                {inviteError && <p role="alert" className="text-sm text-red-700">{inviteError}</p>}
                {link && recipient && (
                  <div className="border border-purple-200 bg-purple-50 rounded p-3 space-y-2">
                    <p className="text-xs font-semibold">{t('analyst.link')}</p>
                    <code className="block font-mono text-xs break-all select-all">{link}</code>
                    <p className="text-xs font-semibold">{t('analyst.keyId')}</p>
                    <code className="block font-mono text-sm break-all select-all">{formatKeyId(recipient.keyId)}</code>
                    <p className="text-xs text-gray-700">{t('analyst.linkHelp')}</p>
                  </div>
                )}
              </div>
            )}
          </Box>
        )}

        {/* 4. Verification */}
        <Box title={t('analyst.verify')}>
          {!identity ? (
            <p className="text-sm text-gray-500">{t('analyst.verifyNeedsKey')}</p>
          ) : (
            <div className="space-y-3">
              <label className="block text-sm" htmlFor="a-zip">{t('analyst.archive')}</label>
              <input id="a-zip" type="file" accept=".zip,application/zip" onChange={e => { setArchive(e.target.files?.[0] ?? null); setReport(null); }} className="text-sm" />
              <label className="block text-sm" htmlFor="a-expcase">{t('analyst.expectedCase')}</label>
              <input id="a-expcase" value={expectedCase} onChange={e => setExpectedCase(e.target.value)} className="w-full font-mono text-sm border border-gray-300 rounded p-2" />
              <label className="block text-sm" htmlFor="a-expref">{t('analyst.expectedRef')}</label>
              <input id="a-expref" value={expectedRef} onChange={e => setExpectedRef(e.target.value)} spellCheck={false} className="w-full font-mono text-xs border border-gray-300 rounded p-2" />
              <p className="text-xs text-gray-500">{t('analyst.expectedRefHelp')}</p>
              <button onClick={runVerify} disabled={!archive || verifying} className="px-4 py-2 bg-purple-600 disabled:bg-gray-300 text-white text-sm font-semibold rounded">
                {verifying ? t('analyst.running') : t('analyst.run')}
              </button>
              {verifying && progress && <p className="text-xs text-gray-500 font-mono">{progress}</p>}

              {report && (
                <div className="space-y-4">
                  <div role="status" className={`border rounded p-3 font-semibold ${report.verdict === 'verified-complete' ? 'border-green-300 bg-green-50 text-green-900' : report.verdict === 'verified-partial' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-red-300 bg-red-50 text-red-900'}`}>
                    {t(`analyst.verdict.${report.verdict}`)}
                  </div>

                  <div>
                    <p className="text-sm font-semibold mb-1">{t('analyst.checks')}</p>
                    <ul className="text-sm divide-y divide-gray-100 border border-gray-100 rounded">
                      {report.checks.map(c => (
                        <li key={c.id} className="px-3 py-1.5 flex justify-between gap-4">
                          <span>{t(`analyst.checkName.${c.id}`)}<span className="block text-xs text-gray-500">{c.detail}</span></span>
                          <span className={`font-medium whitespace-nowrap ${CHECK_TONE[c.status]}`}>{t(`analyst.checkStatus.${c.status}`)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {report.archiveSha256 && (
                    <p className="text-xs">{t('analyst.deliveryComputed')}: <code className="font-mono break-all">{formatKeyId(report.archiveSha256)}</code></p>
                  )}

                  {report.artifacts.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold mb-1">{t('analyst.artifacts')}</p>
                      <table className="w-full text-xs border border-gray-100">
                        <thead className="bg-gray-50"><tr>
                          <th className="text-left p-1">{t('analyst.colId')}</th><th className="text-left p-1">{t('analyst.colName')}</th>
                          <th className="text-left p-1">{t('analyst.colStatus')}</th><th className="text-left p-1">{t('analyst.colCheck')}</th>
                          <th className="text-right p-1">{t('analyst.colSize')}</th><th />
                        </tr></thead>
                        <tbody>
                          {report.artifacts.map(a => (
                            <tr key={a.id} className="border-t border-gray-100">
                              <td className="p-1 font-mono">{a.id}</td>
                              <td className="p-1 font-mono">{a.logicalName}</td>
                              <td className="p-1">{t(`artifactStatus.${a.declaredStatus}`)}</td>
                              <td className={`p-1 ${a.usable ? 'text-green-700' : 'text-red-700'}`}>
                                {a.usable ? t('analyst.usable') : t('analyst.notUsable')} ({a.decrypt}{a.digestMatch === false ? ', hash ≠' : ''})
                              </td>
                              <td className="p-1 text-right">{formatBytes(a.bytes)}</td>
                              <td className="p-1 text-right">
                                {exports[a.id] ?? (
                                  <button onClick={() => exportArtifact(a.id)} disabled={!a.usable || report.verdict === 'rejected'} className="px-2 py-0.5 border rounded disabled:opacity-40">
                                    {t('analyst.export')}
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-xs text-gray-500 mt-1">{t('analyst.exportOnlyVerified')}</p>
                    </div>
                  )}

                  <div>
                    <p className="text-sm font-semibold">{t('analyst.limits')}</p>
                    <ul className="text-xs text-gray-700 list-disc list-inside">
                      {report.limits.map((l, i) => <li key={i}>{l}</li>)}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}
        </Box>
      </div>
    </div>
  );
}
