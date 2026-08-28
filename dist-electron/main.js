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
const electron_1 = require("electron");
const path = __importStar(require("path"));
const slotManager_1 = require("./storage/slotManager");
const settingsManager_1 = require("./storage/settingsManager");
const handlers_1 = require("./ipc/handlers");
const isDev = !electron_1.app.isPackaged;
function createWindow() {
    const win = new electron_1.BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        backgroundColor: '#14181d', // evita "flash branco" — combina com o tema escuro/analítico
        // Sem moldura/menu nativos — a barra de título é desenhada pelo Angular
        // (app-titlebar) pra ficar parecida com o Discord: sem separação visual
        // do resto da janela, só os botões de minimizar/maximizar/fechar.
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    const slots = new slotManager_1.SlotManager();
    const settings = new settingsManager_1.SettingsManager();
    (0, handlers_1.registerIpcHandlers)(win, slots, settings);
    if (isDev) {
        win.loadURL('http://localhost:4200');
        win.webContents.openDevTools({ mode: 'detach' });
    }
    else {
        win.loadFile(path.join(__dirname, '..', 'dist', 'cs-demo-analyst', 'browser', 'index.html'));
    }
}
electron_1.app.whenReady().then(() => {
    // Remove o menu padrão (File/Edit/View/Window/Help) — com frame:false ele já
    // some no Windows, mas isso evita ele reaparecer via Alt e cobre outras plataformas.
    electron_1.Menu.setApplicationMenu(null);
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
//# sourceMappingURL=main.js.map