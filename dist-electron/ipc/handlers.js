"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIpcHandlers = void 0;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const demoParserBridge_1 = require("../ai/demoParserBridge");
const analysisRunner_1 = require("../ai/analysisRunner");
const radarExtractor_1 = require("../ai/radarExtractor");
function registerIpcHandlers(win, slots, settings) {
    electron_1.ipcMain.handle('slots:list', () => slots.listSlots());
    electron_1.ipcMain.handle('slots:get', (_e, id) => slots.getSlot(id));
    electron_1.ipcMain.handle('slots:mapStats', () => slots.getMapStats());
    electron_1.ipcMain.handle('slots:rename', (_e, id, name) => slots.renameSlot(id, name));
    electron_1.ipcMain.handle('slots:setColorTag', (_e, id, colorTag) => slots.setColorTag(id, colorTag));
    electron_1.ipcMain.handle('slots:saveNotebook', (_e, id, content) => slots.saveNotebook(id, content));
    electron_1.ipcMain.handle('slots:removeDemo', (_e, id, demoId) => slots.removeDemo(id, demoId));
    electron_1.ipcMain.handle('slots:setDemoRoster', (_e, id, demoId, steamIds) => slots.setDemoRoster(id, demoId, steamIds));
    electron_1.ipcMain.handle('demos:getSummary', (_e, slotId, demoId) => slots.readDemoSummary(slotId, demoId));
    electron_1.ipcMain.handle('demos:import', async (_e, slotId) => {
        const result = await electron_1.dialog.showOpenDialog(win, {
            title: 'Selecionar demo(s) do CS',
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'CS Demo', extensions: ['dem'] }],
        });
        if (result.canceled || result.filePaths.length === 0)
            return [];
        const added = [];
        for (const filePath of result.filePaths) {
            const parsed = await (0, demoParserBridge_1.parseDemoFile)(filePath);
            const record = slots.addDemo(slotId, {
                fileName: parsed.fileName,
                map: parsed.map,
                summaryPath: 'summary.json',
                score: parsed.finalScore,
                roundsParsed: parsed.rounds.length,
            });
            parsed.writeSummary(slots.demoFolderPath(slotId, record.id));
            added.push(record);
        }
        return added;
    });
    electron_1.ipcMain.handle('ai:getSettings', () => settings.getSettings());
    electron_1.ipcMain.handle('ai:setDefaultProvider', (_e, providerId) => settings.setDefaultProvider(providerId));
    electron_1.ipcMain.handle('ai:updateProviderConfig', (_e, providerId, patch) => settings.updateProviderConfig(providerId, patch));
    electron_1.ipcMain.handle('ai:saveApiKey', (_e, providerId, apiKey) => settings.saveApiKey(providerId, apiKey));
    electron_1.ipcMain.handle('ai:clearApiKey', (_e, providerId) => settings.clearApiKey(providerId));
    electron_1.ipcMain.handle('ai:analyzeSlot', (_e, slotId, providerId) => (0, analysisRunner_1.runSlotAnalysis)(slots, settings, slotId, providerId));
    electron_1.ipcMain.handle('assets:extractRadars', () => (0, radarExtractor_1.extractRadarsFromLocalCs2)());
    electron_1.ipcMain.handle('assets:getRadarImage', (_e, map) => {
        const filePath = (0, radarExtractor_1.getCachedRadarPath)(map);
        if (!filePath)
            return null;
        const buf = fs.readFileSync(filePath);
        return `data:image/png;base64,${buf.toString('base64')}`;
    });
    electron_1.ipcMain.handle('app:getVersion', () => process.env['npm_package_version'] ?? '0.1.0');
    electron_1.ipcMain.handle('window:minimize', () => win.minimize());
    electron_1.ipcMain.handle('window:toggleMaximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
    electron_1.ipcMain.handle('window:close', () => win.close());
    electron_1.ipcMain.handle('window:isMaximized', () => win.isMaximized());
    win.on('maximize', () => win.webContents.send('window:maximizedChanged', true));
    win.on('unmaximize', () => win.webContents.send('window:maximizedChanged', false));
}
exports.registerIpcHandlers = registerIpcHandlers;
//# sourceMappingURL=handlers.js.map