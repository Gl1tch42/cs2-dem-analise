import { contextBridge, ipcRenderer } from 'electron';

/**
 * Superfície exposta ao Angular. Cada método é um invoke para um handler
 * registrado em electron/ipc/handlers.ts — nunca expomos ipcRenderer cru,
 * nem nodeIntegration, para manter o renderer isolado do sistema de arquivos.
 */
const api = {
  slots: {
    list: () => ipcRenderer.invoke('slots:list'),
    get: (id: string) => ipcRenderer.invoke('slots:get', id),
    rename: (id: string, name: string) => ipcRenderer.invoke('slots:rename', id, name),
    setColorTag: (id: string, colorTag: string) => ipcRenderer.invoke('slots:setColorTag', id, colorTag),
    saveNotebook: (id: string, content: string) => ipcRenderer.invoke('slots:saveNotebook', id, content),
    removeDemo: (id: string, demoId: string) => ipcRenderer.invoke('slots:removeDemo', id, demoId),
    /** Marca quais 5 steamIds são "o time deste slot" numa demo — essencial pra separar tendências táticas do adversário. */
    setDemoRoster: (id: string, demoId: string, steamIds: string[]) =>
      ipcRenderer.invoke('slots:setDemoRoster', id, demoId, steamIds),
  },
  demos: {
    /** Abre o seletor de arquivos nativo, copia + envia a demo pro parser Python, e registra no slot. */
    importDemo: (slotId: string) => ipcRenderer.invoke('demos:import', slotId),
    /** Lê o summary.json completo (rounds + keyPositions) de uma demo já importada — usado pelo Mapa 2D. */
    getSummary: (slotId: string, demoId: string) => ipcRenderer.invoke('demos:getSummary', slotId, demoId),
  },
  assets: {
    /** Imagem de radar em cache (data URL) pro mapa, se já foi extraída antes. null se não tiver. */
    getRadarImage: (map: string) => ipcRenderer.invoke('assets:getRadarImage', map),
    /** Extrai as imagens de radar do CS2 instalado localmente (Source2Viewer-CLI) e cacheia no userData. */
    extractRadars: () => ipcRenderer.invoke('assets:extractRadars'),
  },
  ai: {
    getSettings: () => ipcRenderer.invoke('ai:getSettings'),
    setDefaultProvider: (providerId: string) => ipcRenderer.invoke('ai:setDefaultProvider', providerId),
    updateProviderConfig: (providerId: string, patch: unknown) =>
      ipcRenderer.invoke('ai:updateProviderConfig', providerId, patch),
    saveApiKey: (providerId: string, apiKey: string) => ipcRenderer.invoke('ai:saveApiKey', providerId, apiKey),
    clearApiKey: (providerId: string) => ipcRenderer.invoke('ai:clearApiKey', providerId),
    /** Roda a análise (algoritmo local + chamada à IA) para um slot inteiro. */
    analyzeSlot: (slotId: string, providerId?: string) => ipcRenderer.invoke('ai:analyzeSlot', slotId, providerId),
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    /** Retorna uma função pra cancelar a inscrição. */
    onMaximizedChange: (cb: (isMaximized: boolean) => void) => {
      const listener = (_e: unknown, value: boolean) => cb(value);
      ipcRenderer.on('window:maximizedChanged', listener);
      return () => ipcRenderer.removeListener('window:maximizedChanged', listener);
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
