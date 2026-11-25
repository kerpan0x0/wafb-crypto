import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AcquisitionPage } from './components/acquisition/AcquisitionPage';
import { WizzardAcquisitionPage } from './components/acquisition/WizzardAcquisitionPage';
import { Layout } from './components/layout/Layout';
import { AnalystPage } from './components/analyst/AnalystPage';
import { useSessionStore } from './stores/sessionStore';

type ActiveTab = 'standard' | 'wizard' | 'analyst';

function initialTab(): ActiveTab {
  // `#analyst` opens the analyst page; an invitation fragment opens the wizard.
  return window.location.hash === '#analyst' ? 'analyst' : 'wizard';
}

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab);
  const { t } = useTranslation();
  const sessionActive = useSessionStore(s => s.state !== 'idle' && !['completed', 'partial', 'failed', 'cancelled'].includes(s.state));

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
          <button
            onClick={() => !sessionActive && setActiveTab('analyst')}
            disabled={sessionActive}
            title={sessionActive ? t('acquisition.tabDisabledDuringAcquisition') : undefined}
            className={`ml-auto px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'analyst'
                ? 'border-purple-600 text-purple-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } ${sessionActive ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            🔑 {t('tabs.analyst')}
          </button>
        </div>
      </div>

      {activeTab === 'wizard' && <WizzardAcquisitionPage />}
      {activeTab === 'standard' && <AcquisitionPage />}
      {activeTab === 'analyst' && <AnalystPage />}
    </Layout>
  );
}

export default App;
