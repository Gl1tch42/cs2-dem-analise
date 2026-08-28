"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
/**
 * Superfície exposta ao Angular. Cada método é um invoke para um handler
 * registrado em electron/ipc/handlers.ts — nunca expomos ipcRenderer cru,
 * nem nodeIntegration, para manter o renderer isolado do sistema de arquivos.
 */
const api = {
    slots: {
        list: () => electron_1.ipcRenderer.invoke('slots:list'),
        get: (id) => electron_1.ipcRenderer.invoke('slots:get', id),
        rename: (id, name) => electron_1.ipcRenderer.invoke('slots:rename', id, name),
        setColorTag: (id, colorTag) => electron_1.ipcRenderer.invoke('slots:setColorTag', id, colorTag),
        saveNotebook: (id, content) => electron_1.ipcRenderer.invoke('slots:saveNotebook', id, content),
        removeDemo: (id, demoId) => electron_1.ipcRenderer.invoke('slots:removeDemo', id, demoId),
        /** Marca quais 5 steamIds são "o time deste slot" numa demo — essencial pra separar tendências táticas do adversário. */
        setDemoRoster: (id, demoId, steamIds) => electron_1.ipcRenderer.invoke('slots:setDemoRoster', id, demoId, steamIds),
    },
    demos: {
        /** Abre o seletor de arquivos nativo, copia + envia a demo pro parser Python, e registra no slot. */
        importDemo: (slotId) => electron_1.ipcRenderer.invoke('demos:import', slotId),
        /** Lê o summary.json completo (rounds + keyPositions) de uma demo já importada — usado pelo Mapa 2D. */
        getSummary: (slotId, demoId) => electron_1.ipcRenderer.invoke('demos:getSummary', slotId, demoId),
    },
    assets: {
        /** Imagem de radar em cache (data URL) pro mapa, se já foi extraída antes. null se não tiver. */
        getRadarImage: (map) => electron_1.ipcRenderer.invoke('assets:getRadarImage', map),
        /** Extrai as imagens de radar do CS2 instalado localmente (Source2Viewer-CLI) e cacheia no userData. */
        extractRadars: () => electron_1.ipcRenderer.invoke('assets:extractRadars'),
    },
    ai: {
        getSettings: () => electron_1.ipcRenderer.invoke('ai:getSettings'),
        setDefaultProvider: (providerId) => electron_1.ipcRenderer.invoke('ai:setDefaultProvider', providerId),
        updateProviderConfig: (providerId, patch) => electron_1.ipcRenderer.invoke('ai:updateProviderConfig', providerId, patch),
        saveApiKey: (providerId, apiKey) => electron_1.ipcRenderer.invoke('ai:saveApiKey', providerId, apiKey),
        clearApiKey: (providerId) => electron_1.ipcRenderer.invoke('ai:clearApiKey', providerId),
        /** Roda a análise (algoritmo local + chamada à IA) para um slot inteiro. */
        analyzeSlot: (slotId, providerId) => electron_1.ipcRenderer.invoke('ai:analyzeSlot', slotId, providerId),
    },
    app: {
        getVersion: () => electron_1.ipcRenderer.invoke('app:getVersion'),
    },
    window: {
        minimize: () => electron_1.ipcRenderer.invoke('window:minimize'),
        toggleMaximize: () => electron_1.ipcRenderer.invoke('window:toggleMaximize'),
        close: () => electron_1.ipcRenderer.invoke('window:close'),
        isMaximized: () => electron_1.ipcRenderer.invoke('window:isMaximized'),
        /** Retorna uma função pra cancelar a inscrição. */
        onMaximizedChange: (cb) => {
            const listener = (_e, value) => cb(value);
            electron_1.ipcRenderer.on('window:maximizedChanged', listener);
            return () => electron_1.ipcRenderer.removeListener('window:maximizedChanged', listener);
        },
    },
};
electron_1.contextBridge.exposeInMainWorld('electronAPI', api);
//# sourceMappingURL=preload.js.map