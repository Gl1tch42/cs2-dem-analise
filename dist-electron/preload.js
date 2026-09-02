"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const api = {
    slots: {
        list: () => electron_1.ipcRenderer.invoke('slots:list'),
        get: (id) => electron_1.ipcRenderer.invoke('slots:get', id),
        mapStats: () => electron_1.ipcRenderer.invoke('slots:mapStats'),
        rename: (id, name) => electron_1.ipcRenderer.invoke('slots:rename', id, name),
        setColorTag: (id, colorTag) => electron_1.ipcRenderer.invoke('slots:setColorTag', id, colorTag),
        saveNotebook: (id, content) => electron_1.ipcRenderer.invoke('slots:saveNotebook', id, content),
        listNotebookHistory: (id) => electron_1.ipcRenderer.invoke('slots:listNotebookHistory', id),
        getNotebookHistoryContent: (id, timestamp) => electron_1.ipcRenderer.invoke('slots:getNotebookHistoryContent', id, timestamp),
        restoreNotebookHistory: (id, timestamp) => electron_1.ipcRenderer.invoke('slots:restoreNotebookHistory', id, timestamp),
        removeDemo: (id, demoId) => electron_1.ipcRenderer.invoke('slots:removeDemo', id, demoId),
        setDemoRoster: (id, demoId, steamIds) => electron_1.ipcRenderer.invoke('slots:setDemoRoster', id, demoId, steamIds),
        exportSlot: (id) => electron_1.ipcRenderer.invoke('slots:exportSlot', id),
        importSlot: (id) => electron_1.ipcRenderer.invoke('slots:importSlot', id),
    },
    demos: {
        importDemo: (slotId) => electron_1.ipcRenderer.invoke('demos:import', slotId),
        getSummary: (slotId, demoId) => electron_1.ipcRenderer.invoke('demos:getSummary', slotId, demoId),
    },
    assets: {
        getRadarImage: (map) => electron_1.ipcRenderer.invoke('assets:getRadarImage', map),
        extractRadars: () => electron_1.ipcRenderer.invoke('assets:extractRadars'),
        extractMapGeometry: () => electron_1.ipcRenderer.invoke('assets:extractMapGeometry'),
    },
    ai: {
        getSettings: () => electron_1.ipcRenderer.invoke('ai:getSettings'),
        setDefaultProvider: (providerId) => electron_1.ipcRenderer.invoke('ai:setDefaultProvider', providerId),
        updateProviderConfig: (providerId, patch) => electron_1.ipcRenderer.invoke('ai:updateProviderConfig', providerId, patch),
        saveApiKey: (providerId, apiKey) => electron_1.ipcRenderer.invoke('ai:saveApiKey', providerId, apiKey),
        clearApiKey: (providerId) => electron_1.ipcRenderer.invoke('ai:clearApiKey', providerId),
        analyzeSlot: (slotId, providerId, focusSteamIds) => electron_1.ipcRenderer.invoke('ai:analyzeSlot', slotId, providerId, focusSteamIds),
        getSlotStats: (slotId) => electron_1.ipcRenderer.invoke('ai:getSlotStats', slotId),
        getPlayerScores: (slotId) => electron_1.ipcRenderer.invoke('ai:getPlayerScores', slotId),
        matchupMaps: (ownSlotId, opponentSlotId) => electron_1.ipcRenderer.invoke('ai:matchupMaps', ownSlotId, opponentSlotId),
        generateMatchup: (ownSlotId, opponentSlotId, map) => electron_1.ipcRenderer.invoke('ai:generateMatchup', ownSlotId, opponentSlotId, map),
    },
    app: {
        getVersion: () => electron_1.ipcRenderer.invoke('app:getVersion'),
    },
    window: {
        minimize: () => electron_1.ipcRenderer.invoke('window:minimize'),
        toggleMaximize: () => electron_1.ipcRenderer.invoke('window:toggleMaximize'),
        close: () => electron_1.ipcRenderer.invoke('window:close'),
        isMaximized: () => electron_1.ipcRenderer.invoke('window:isMaximized'),
        onMaximizedChange: (cb) => {
            const listener = (_e, value) => cb(value);
            electron_1.ipcRenderer.on('window:maximizedChanged', listener);
            return () => electron_1.ipcRenderer.removeListener('window:maximizedChanged', listener);
        },
    },
};
electron_1.contextBridge.exposeInMainWorld('electronAPI', api);
//# sourceMappingURL=preload.js.map