import { useTranslation } from 'react-i18next';
import { APP_NAME, APP_VERSION, APP_LICENSE, GITHUB_URL } from '../../lib/constants';

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="mt-12 border-t border-gray-200 bg-white py-6">
      <div className="mx-auto max-w-6xl px-6 text-center text-sm text-gray-500">
        {APP_NAME} {APP_VERSION} - {t('app.fullName')} |{' '}
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-700"
        >
          {t('footer.sourceCode')}
        </a>{' '}
        | {t('footer.license', { license: APP_LICENSE })}
      </div>
    </footer>
  );
}
