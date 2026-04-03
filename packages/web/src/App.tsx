import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AcquisitionPage } from './components/acquisition/AcquisitionPage';
import { WizzardAcquisitionPage } from './components/acquisition/WizzardAcquisitionPage';
import { Layout } from './components/layout/Layout';
import { useAcquisitionStore } from './stores/acquisitionStore';

type ActiveTab = 'standard' | 'wizard';

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('wizard');
  const { t } = useTranslation();
  const session = useAcquisitionStore((s: { session: { status: string } | null }) => s.session);
  const sessionActive = session !== null && session.status === 'running';

  return (
    <Layout>
      {/* Tab switcher */}
      <div className="bg-white border-b border-gray-200 px-8">
        <div className="max-w-6xl mx-auto flex space-x-1">
          <button
            onClick={() => !sessionActive && setActiveTab('wizard')}
            disabled={sessionActive}
            title={sessionActive ? t('acquisition.tabDisabledDuringAcquisition') : undefined}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'wizard'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } ${sessionActive ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            🪄 {t('tabs.wizard')}
          </button>
          <button
            onClick={() => !sessionActive && setActiveTab('standard')}
            disabled={sessionActive}
            title={sessionActive ? t('acquisition.tabDisabledDuringAcquisition') : undefined}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'standard'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } ${sessionActive ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            ⚙️ {t('tabs.standard')}
          </button>
        </div>
      </div>

      {activeTab === 'wizard' ? <WizzardAcquisitionPage /> : <AcquisitionPage />}
    </Layout>
  );
}

export default App;
