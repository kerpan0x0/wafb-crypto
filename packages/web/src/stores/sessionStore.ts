/**
 * UI state of the current acquisition session.
 *
 * The store only mirrors what the SessionCoordinator reports; it never decides
 * on completion itself. Both the wizard and the advanced page use it, so the
 * two paths share one state machine and one definition of "complete" (RF10).
 */
import { create } from 'zustand';
import { SessionCoordinator, TERMINAL_STATES } from '@wafb/core';
import type {
  ArtifactProgress,
  ArtifactRecord,
  Device,
  ModuleUpdate,
  SessionConfig,
  SessionLogEntry,
  SessionResult,
  SessionState,
} from '@wafb/core';
import { buildModuleTasks } from '../lib/moduleTasks';

export interface SaveTarget {
  writable: WritableStream<Uint8Array>;
  fileName: string;
}

interface SessionStore {
  state: SessionState | 'idle';
  config: Readonly<SessionConfig> | null;
  modules: Record<string, ModuleUpdate>;
  artifacts: ArtifactRecord[];
  current: ArtifactProgress | null;
  logs: SessionLogEntry[];
  startedAt: number | null;
  endedAt: number | null;
  result: SessionResult | null;
  fileName: string | null;

  start: (config: SessionConfig, device: Device, target: SaveTarget) => Promise<SessionResult>;
  cancel: () => void;
  reset: () => void;
  isActive: () => boolean;
}

let coordinator: SessionCoordinator | null = null;
const MAX_LOGS = 500;

export const useSessionStore = create<SessionStore>((set, get) => ({
  state: 'idle',
  config: null,
  modules: {},
  artifacts: [],
  current: null,
  logs: [],
  startedAt: null,
  endedAt: null,
  result: null,
  fileName: null,

  start: async (config, device, target) => {
    if (get().isActive()) throw new Error('A session is already running');
    const c = new SessionCoordinator(config, {
      sink: target.writable,
      events: {
        onStateChange: state => set({ state }),
        onModuleUpdate: u =>
          set(s => ({ modules: { ...s.modules, [u.module]: { ...s.modules[u.module], ...u } } })),
        onArtifactProgress: p => set({ current: p }),
        onArtifactRecorded: r => set(s => ({ artifacts: [...s.artifacts, r] })),
        onLog: e => set(s => ({ logs: [...s.logs, e].slice(-MAX_LOGS) })),
      },
    });
    coordinator = c;
    set({
      state: c.state,
      config: c.config,
      modules: Object.fromEntries(config.requested.map(m => [m, { module: m, status: 'pending' as const }])),
      artifacts: [],
      current: null,
      logs: [],
      startedAt: Date.now(),
      endedAt: null,
      result: null,
      fileName: target.fileName,
    });
    const result = await c.run(buildModuleTasks(device, config.requested));
    set({ result, state: result.state, endedAt: Date.now(), current: null });
    coordinator = null;
    return result;
  },

  cancel: () => coordinator?.cancel(),

  reset: () => {
    if (get().isActive()) return;
    set({
      state: 'idle',
      config: null,
      modules: {},
      artifacts: [],
      current: null,
      logs: [],
      startedAt: null,
      endedAt: null,
      result: null,
      fileName: null,
    });
  },

  isActive: () => {
    const s = get().state;
    return s !== 'idle' && !TERMINAL_STATES.includes(s);
  },
}));
