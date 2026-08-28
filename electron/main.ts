import { app, BrowserWindow, Menu } from 'electron';
import * as path from 'path';
import { SlotManager } from './storage/slotManager';
import { SettingsManager } from './storage/settingsManager';
import { registerIpcHandlers } from './ipc/handlers';

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#14181d',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const slots = new SlotManager();
  const settings = new SettingsManager();
  registerIpcHandlers(win, slots, settings);

  if (isDev) {
    win.loadURL('http://localhost:4200');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'cs-demo-analyst', 'browser', 'index.html'));
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
