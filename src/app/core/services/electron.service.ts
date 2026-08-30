import { Injectable } from '@angular/core';
import {
  SlotMeta,
  SlotDetail,
  DemoRecord,
  DemoSummary,
  AiSettings,
  AiProviderId,
  AnalysisResult,
  ConsolidatedSlotStats,
  MapStat,
  NotebookHistoryEntry,
  SlotImportResult,
  PlayerScoreAggregate,
} from '../models/slot.model';

declare global {
  interface Window {
    electronAPI: {
      slots: {
        list: () => Promise<SlotMeta[]>;
        get: (id: string) => Promise<SlotDetail>;
        mapStats: () => Promise<MapStat[]>;
        rename: (id: string, name: string) => Promise<SlotMeta>;
        setColorTag: (id: string, colorTag: string) => Promise<SlotMeta>;
        saveNotebook: (id: string, content: string) => Promise<{ content: string; updatedAt: string }>;
        listNotebookHistory: (id: string) => Promise<NotebookHistoryEntry[]>;
        getNotebookHistoryContent: (id: string, timestamp: string) => Promise<string>;
        restoreNotebookHistory: (id: string, timestamp: string) => Promise<{ content: string; updatedAt: string }>;
        removeDemo: (id: string, demoId: string) => Promise<void>;
        setDemoRoster: (id: string, demoId: string, steamIds: string[]) => Promise<DemoRecord>;
        exportSlot: (id: string) => Promise<{ canceled: boolean; filePath?: string }>;
        importSlot: (id: string) => Promise<{ canceled: true } | ({ canceled: false } & SlotImportResult)>;
      };
      demos: {
        importDemo: (slotId: string) => Promise<DemoRecord[]>;
        getSummary: (slotId: string, demoId: string) => Promise<DemoSummary>;
      };
      assets: {
        getRadarImage: (map: string) => Promise<string | null>;
        extractRadars: () => Promise<{ cs2Found: boolean; extractedMaps: string[]; error?: string }>;
      };
      ai: {
        getSettings: () => Promise<AiSettings>;
        setDefaultProvider: (providerId: AiProviderId) => Promise<AiSettings>;
        updateProviderConfig: (providerId: AiProviderId, patch: unknown) => Promise<AiSettings>;
        saveApiKey: (providerId: AiProviderId, apiKey: string) => Promise<AiSettings>;
        clearApiKey: (providerId: AiProviderId) => Promise<AiSettings>;
        analyzeSlot: (slotId: string, providerId?: AiProviderId, focusSteamIds?: string[]) => Promise<AnalysisResult>;
        getSlotStats: (slotId: string) => Promise<ConsolidatedSlotStats>;
        getPlayerScores: (slotId: string) => Promise<PlayerScoreAggregate[]>;
      };
      app: {
        getVersion: () => Promise<string>;
      };
      window: {
        minimize: () => Promise<void>;
        toggleMaximize: () => Promise<void>;
        close: () => Promise<void>;
        isMaximized: () => Promise<boolean>;
        onMaximizedChange: (cb: (isMaximized: boolean) => void) => () => void;
      };
    };
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronService {
  get api() {
    return window.electronAPI;
  }

  get isElectron(): boolean {
    return !!window.electronAPI;
  }
}
