import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { SlotManager } from '../storage/slotManager';
import { SettingsManager } from '../storage/settingsManager';
import { AiProviderId, SlotExportBundle } from '../storage/types';
import { parseDemoFile } from '../ai/demoParserBridge';
import { getSlotStats, runSlotAnalysis } from '../ai/analysisRunner';
import { extractRadarsFromLocalCs2, getCachedRadarPath } from '../ai/radarExtractor';

export function registerIpcHandlers(win: BrowserWindow, slots: SlotManager, settings: SettingsManager) {
  ipcMain.handle('slots:list', () => slots.listSlots());
  ipcMain.handle('slots:get', (_e, id: string) => slots.getSlot(id));
  ipcMain.handle('slots:mapStats', () => slots.getMapStats());
  ipcMain.handle('slots:rename', (_e, id: string, name: string) => slots.renameSlot(id, name));
  ipcMain.handle('slots:setColorTag', (_e, id: string, colorTag: string) => slots.setColorTag(id, colorTag));
  ipcMain.handle('slots:saveNotebook', (_e, id: string, content: string) => slots.saveNotebook(id, content));
  ipcMain.handle('slots:listNotebookHistory', (_e, id: string) => slots.listNotebookHistory(id));
  ipcMain.handle('slots:getNotebookHistoryContent', (_e, id: string, timestamp: string) =>
    slots.getNotebookHistoryContent(id, timestamp)
  );
  ipcMain.handle('slots:restoreNotebookHistory', (_e, id: string, timestamp: string) =>
    slots.restoreNotebookHistory(id, timestamp)
  );
  ipcMain.handle('slots:removeDemo', (_e, id: string, demoId: string) => slots.removeDemo(id, demoId));
  ipcMain.handle('slots:setDemoRoster', (_e, id: string, demoId: string, steamIds: string[]) =>
    slots.setDemoRoster(id, demoId, steamIds)
  );

  ipcMain.handle('slots:exportSlot', async (_e, id: string) => {
    const slotMeta = slots.getSlot(id);
    const result = await dialog.showSaveDialog(win, {
      title: 'Exportar slot',
      defaultPath: `${slotMeta.name.replace(/[^a-z0-9-_ ]/gi, '_')}.csda-slot`,
      filters: [{ name: 'CS Demo Analyst — Slot', extensions: ['csda-slot'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const bundle = slots.exportSlot(id);
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(bundle), 'utf-8'));
    fs.writeFileSync(result.filePath, gz);
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('slots:importSlot', async (_e, id: string) => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Importar de um export de slot (.csda-slot)',
      properties: ['openFile'],
      filters: [{ name: 'CS Demo Analyst — Slot', extensions: ['csda-slot'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    let bundle: SlotExportBundle;
    try {
      const json = zlib.gunzipSync(fs.readFileSync(result.filePaths[0])).toString('utf-8');
      bundle = JSON.parse(json);
    } catch {
      throw new Error('Arquivo de export inválido ou corrompido.');
    }
    const importResult = slots.importSlot(id, bundle);
    return { canceled: false, ...importResult };
  });

  ipcMain.handle('demos:getSummary', (_e, slotId: string, demoId: string) =>
    slots.readDemoSummary(slotId, demoId)
  );

  ipcMain.handle('demos:import', async (_e, slotId: string) => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Selecionar demo(s) do CS',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'CS Demo', extensions: ['dem'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return [];

    const added = [];
    for (const filePath of result.filePaths) {
      const parsed = await parseDemoFile(filePath);
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

  ipcMain.handle('ai:getSettings', () => settings.getSettings());
  ipcMain.handle('ai:setDefaultProvider', (_e, providerId: AiProviderId) => settings.setDefaultProvider(providerId));
  ipcMain.handle('ai:updateProviderConfig', (_e, providerId: AiProviderId, patch: any) =>
    settings.updateProviderConfig(providerId, patch)
  );
  ipcMain.handle('ai:saveApiKey', (_e, providerId: AiProviderId, apiKey: string) =>
    settings.saveApiKey(providerId, apiKey)
  );
  ipcMain.handle('ai:clearApiKey', (_e, providerId: AiProviderId) => settings.clearApiKey(providerId));

  ipcMain.handle('ai:analyzeSlot', (_e, slotId: string, providerId?: AiProviderId, focusSteamIds?: string[]) =>
    runSlotAnalysis(slots, settings, slotId, providerId, focusSteamIds)
  );
  ipcMain.handle('ai:getSlotStats', (_e, slotId: string) => getSlotStats(slots, slotId));

  ipcMain.handle('assets:extractRadars', () => extractRadarsFromLocalCs2());
  ipcMain.handle('assets:getRadarImage', (_e, map: string) => {
    const filePath = getCachedRadarPath(map);
    if (!filePath) return null;
    const buf = fs.readFileSync(filePath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  });

  ipcMain.handle('app:getVersion', () => process.env['npm_package_version'] ?? '0.1.0');

  ipcMain.handle('window:minimize', () => win.minimize());
  ipcMain.handle('window:toggleMaximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  ipcMain.handle('window:close', () => win.close());
  ipcMain.handle('window:isMaximized', () => win.isMaximized());
  win.on('maximize', () => win.webContents.send('window:maximizedChanged', true));
  win.on('unmaximize', () => win.webContents.send('window:maximizedChanged', false));
}
