import { Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { APP_NAME } from '../../lib/constants';
import { useAcquisitionStore } from '../../stores/acquisitionStore';

const LANGUAGES = [
  { code: 'en', label: 'EN', flag: '🇬🇧' },
  { code: 'it', label: 'IT', flag: '🇮🇹' },
];

export function Header() {
  const { t, i18n } = useTranslation();
  const session = useAcquisitionStore((s: { session: { status: string } | null }) => s.session);
  const sessionActive = session !== null && session.status === 'running';

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (sessionActive) return;
    const lang = e.target.value;
    i18n.changeLanguage(lang);
    localStorage.setItem('wafb-lang', lang);
  }

  return (
    <header className="border-b border-gray-200 bg-white/80 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500 text-white">
              <Smartphone className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{APP_NAME}</h1>
              <p className="text-xs text-gray-500">{t('app.fullName')}</p>
            </div>
          </div>

          <select
            value={i18n.language}
            onChange={handleChange}
            disabled={sessionActive}
            title={sessionActive ? t('acquisition.langDisabledDuringAcquisition') : undefined}
            className={`rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${
              sessionActive ? 'opacity-40 cursor-not-allowed' : ''
            }`}
          >
            {LANGUAGES.map(({ code, label, flag }) => (
              <option key={code} value={code}>
                {flag} {label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </header>
  );
}
