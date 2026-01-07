import { Smartphone } from 'lucide-react';
import { APP_NAME, APP_FULL_NAME } from '../../lib/constants';

export function Header() {
  return (
    <header className="border-b border-gray-200 bg-white/80 backdrop-blur-sm">
      <div className="mx-auto max-w-4xl px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500 text-white">
            <Smartphone className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{APP_NAME}</h1>
            <p className="text-xs text-gray-500">{APP_FULL_NAME}</p>
          </div>
        </div>
      </div>
    </header>
  );
}