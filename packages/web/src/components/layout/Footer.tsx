import { APP_NAME, APP_VERSION, APP_FULL_NAME, APP_LICENSE } from '../../lib/constants';

export function Footer() {
  return (
    <footer className="mt-12 border-t border-gray-200 bg-white py-6">
      <div className="mx-auto max-w-6xl px-6 text-center text-sm text-gray-500">
        {APP_NAME} {APP_VERSION} - {APP_FULL_NAME} | {APP_LICENSE} License
      </div>
    </footer>
  );
}