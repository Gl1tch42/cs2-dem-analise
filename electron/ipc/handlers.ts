import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fs from 'fs';
import { SlotManager } from '../storage/slotManager';
import { SettingsManager } from '../storage/settingsManager';
import { AiProviderId } from '../storage/types';
import { parseDemoFile } from '../ai/demoParserBridge';
import { runSlotAnalysis } from '../ai/analysisRunner';
import { extractRadarsFromLocalCs2, getCachedRadarPath } from '../ai/radarExtractor';

export function registerIpcHandlers(win: BrowserWindow, slots: SlotManager, settings: SettingsManager) {
  // --- Slots -----------------------------------------------------------
  ipcMain.handle('slots:list', () => slots.listSlots());
  ipcMain.handle('slots:get', (_e, id: string) => slots.getSlot(id));
  ipcMain.handle('slots:rename', (_e, id: string, name: string) => slots.renameSlot(id, name));
  ipcMain.handle('slots:setColorTag', (_e, id: string, colorTag: string) => slots.setColorTag(id, colorTag));
  ipcMain.handle('slots:saveNotebook', (_e, id: string, content: string) => slots.saveNotebook(id, content));
  ipcMain.handle('slots:removeDemo', (_e, id: string, demoId: string) => slots.removeDemo(id, demoId));
  ipcMain.handle('slots:setDemoRoster', (_e, id: string, demoId: string, steamIds: string[]) =>
    slots.setDemoRoster(id, demoId, steamIds)
  );

  // --- Demos -------------------------------------------------------------
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
      // 1. Parser Python (empacotado) extrai o resumo estruturado da demo.
      const parsed = await parseDemoFile(filePath);
      // 2. Só o resumo (leve) é gravado no slot — a demo bruta fica só se o usuário
      //    marcar essa opção no futuro; por padrão não duplicamos arquivos grandes.
      const record = slots.addDemo(slotId, {
        fileName: parsed.fileName,
        map: parsed.map,
        summaryPath: 'summary.json',
        score: parsed.finalScore,
        roundsParsed: parsed.rounds.length,
      });
      // grava o summary.json dentro da pasta real criada pelo addDemo
      parsed.writeSummary(slots.demoFolderPath(slotId, record.id));
      added.push(record);
    }
    return added;
  });

  // --- Configurações de IA -----------------------------------------------
  ipcMain.handle('ai:getSettings', () => settings.getSettings());
  ipcMain.handle('ai:setDefaultProvider', (_e, providerId: AiProviderId) => settings.setDefaultProvider(providerId));
  ipcMain.handle('ai:updateProviderConfig', (_e, providerId: AiProviderId, patch: any) =>
    settings.updateProviderConfig(providerId, patch)
  );
  ipcMain.handle('ai:saveApiKey', (_e, providerId: AiProviderId, apiKey: string) =>
    settings.saveApiKey(providerId, apiKey)
  );
  ipcMain.handle('ai:clearApiKey', (_e, providerId: AiProviderId) => settings.clearApiKey(providerId));

  ipcMain.handle('ai:analyzeSlot', (_e, slotId: string, providerId?: AiProviderId) =>
    runSlotAnalysis(slots, settings, slotId, providerId)
  );

  // --- Radares do Mapa 2D (extraídos do CS2 local do usuário) ------------
  ipcMain.handle('assets:extractRadars', () => extractRadarsFromLocalCs2());
  ipcMain.handle('assets:getRadarImage', (_e, map: string) => {
    const filePath = getCachedRadarPath(map);
    if (!filePath) return null;
    const buf = fs.readFileSync(filePath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  });

  // --- App -----------------------------------------------------------------
  ipcMain.handle('app:getVersion', () => process.env['npm_package_version'] ?? '0.1.0');

  // --- Janela (a barra de título nativa some com frame:false — os controles
  //     de minimizar/maximizar/fechar são desenhados pelo Angular e chamam isto) ---
  ipcMain.handle('window:minimize', () => win.minimize());
  ipcMain.handle('window:toggleMaximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  ipcMain.handle('window:close', () => win.close());
  ipcMain.handle('window:isMaximized', () => win.isMaximized());
  win.on('maximize', () => win.webContents.send('window:maximizedChanged', true));
  win.on('unmaximize', () => win.webContents.send('window:maximizedChanged', false));
}
