import { contextBridge, ipcRenderer } from 'electron';

const api = {
  slots: {
    list: () => ipcRenderer.invoke('slots:list'),
    get: (id: string) => ipcRenderer.invoke('slots:get', id),
    mapStats: () => ipcRenderer.invoke('slots:mapStats'),
    rename: (id: string, name: string) => ipcRenderer.invoke('slots:rename', id, name),
    setColorTag: (id: string, colorTag: string) => ipcRenderer.invoke('slots:setColorTag', id, colorTag),
    saveNotebook: (id: string, content: string) => ipcRenderer.invoke('slots:saveNotebook', id, content),
    removeDemo: (id: string, demoId: string) => ipcRenderer.invoke('slots:removeDemo', id, demoId),
    setDemoRoster: (id: string, demoId: string, steamIds: string[]) =>
      ipcRenderer.invoke('slots:setDemoRoster', id, demoId, steamIds),
  },
  demos: {
    importDemo: (slotId: string) => ipcRenderer.invoke('demos:import', slotId),
    getSummary: (slotId: string, demoId: string) => ipcRenderer.invoke('demos:getSummary', slotId, demoId),
  },
  assets: {
    getRadarImage: (map: string) => ipcRenderer.invoke('assets:getRadarImage', map),
    extractRadars: () => ipcRenderer.invoke('assets:extractRadars'),
  },
  ai: {
    getSettings: () => ipcRenderer.invoke('ai:getSettings'),
    setDefaultProvider: (providerId: string) => ipcRenderer.invoke('ai:setDefaultProvider', providerId),
    updateProviderConfig: (providerId: string, patch: unknown) =>
      ipcRenderer.invoke('ai:updateProviderConfig', providerId, patch),
    saveApiKey: (providerId: string, apiKey: string) => ipcRenderer.invoke('ai:saveApiKey', providerId, apiKey),
    clearApiKey: (providerId: string) => ipcRenderer.invoke('ai:clearApiKey', providerId),
    analyzeSlot: (slotId: string, providerId?: string, focusSteamIds?: string[]) =>
      ipcRenderer.invoke('ai:analyzeSlot', slotId, providerId, focusSteamIds),
    getSlotStats: (slotId: string) => ipcRenderer.invoke('ai:getSlotStats', slotId),
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizedChange: (cb: (isMaximized: boolean) => void) => {
      const listener = (_e: unknown, value: boolean) => cb(value);
      ipcRenderer.on('window:maximizedChanged', listener);
      return () => ipcRenderer.removeListener('window:maximizedChanged', listener);
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
