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
exports.SlotManager = void 0;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const types_1 = require("./types");
class SlotManager {
    rootDir;
    constructor() {
        this.rootDir = path.join(electron_1.app.getPath('userData'), 'cs-demo-analyst', 'slots');
        this.ensureSlotsExist();
    }
    ensureSlotsExist() {
        fs.mkdirSync(this.rootDir, { recursive: true });
        if (!fs.existsSync(this.slotDir('own'))) {
            this.createSlotFolder('own', 'own', 'Seu Time');
        }
        for (let i = 1; i <= types_1.MAX_OPPONENT_SLOTS; i++) {
            const id = `opp-${String(i).padStart(2, '0')}`;
            if (!fs.existsSync(this.slotDir(id))) {
                this.createSlotFolder(id, 'opponent', `Adversário ${i}`);
            }
        }
    }
    slotDir(id) {
        return path.join(this.rootDir, id);
    }
    metaPath(id) {
        return path.join(this.slotDir(id), 'meta.json');
    }
    notebookPath(id) {
        return path.join(this.slotDir(id), 'notebook.md');
    }
    demosDir(id) {
        return path.join(this.slotDir(id), 'demos');
    }
    createSlotFolder(id, kind, defaultName) {
        fs.mkdirSync(this.demosDir(id), { recursive: true });
        const now = new Date().toISOString();
        const meta = {
            id,
            kind,
            name: defaultName,
            createdAt: now,
            updatedAt: now,
            demoCount: 0,
        };
        fs.writeFileSync(this.metaPath(id), JSON.stringify(meta, null, 2));
        fs.writeFileSync(this.notebookPath(id), '');
    }
    readMeta(id) {
        const raw = fs.readFileSync(this.metaPath(id), 'utf-8');
        return JSON.parse(raw);
    }
    writeMeta(meta) {
        meta.updatedAt = new Date().toISOString();
        fs.writeFileSync(this.metaPath(meta.id), JSON.stringify(meta, null, 2));
    }
    readDemoRecords(id) {
        const dir = this.demosDir(id);
        if (!fs.existsSync(dir))
            return [];
        const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
        const records = [];
        for (const entry of entries) {
            const recordPath = path.join(dir, entry.name, 'record.json');
            if (fs.existsSync(recordPath)) {
                records.push(JSON.parse(fs.readFileSync(recordPath, 'utf-8')));
            }
        }
        return records.sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));
    }
    listSlots() {
        const ids = ['own', ...Array.from({ length: types_1.MAX_OPPONENT_SLOTS }, (_, i) => `opp-${String(i + 1).padStart(2, '0')}`)];
        return ids.map((id) => {
            const meta = this.readMeta(id);
            meta.demoCount = this.readDemoRecords(id).length;
            return meta;
        });
    }
    getSlot(id) {
        const meta = this.readMeta(id);
        const demos = this.readDemoRecords(id);
        const notebookContent = fs.existsSync(this.notebookPath(id))
            ? fs.readFileSync(this.notebookPath(id), 'utf-8')
            : '';
        const stat = fs.existsSync(this.notebookPath(id)) ? fs.statSync(this.notebookPath(id)) : null;
        const notebook = {
            content: notebookContent,
            updatedAt: stat ? stat.mtime.toISOString() : meta.updatedAt,
        };
        return { ...meta, demoCount: demos.length, demos, notebook };
    }
    renameSlot(id, name) {
        const meta = this.readMeta(id);
        meta.name = name;
        this.writeMeta(meta);
        return meta;
    }
    setColorTag(id, colorTag) {
        const meta = this.readMeta(id);
        meta.colorTag = colorTag;
        this.writeMeta(meta);
        return meta;
    }
    saveNotebook(id, content) {
        fs.writeFileSync(this.notebookPath(id), content);
        const meta = this.readMeta(id);
        this.writeMeta(meta);
        return { content, updatedAt: new Date().toISOString() };
    }
    addDemo(id, record) {
        const existing = this.readDemoRecords(id);
        if (existing.length >= types_1.MAX_DEMOS_PER_SLOT) {
            throw new Error(`O slot "${id}" já tem ${types_1.MAX_DEMOS_PER_SLOT} demos (limite máximo). Remova alguma antes de adicionar outra.`);
        }
        const demoId = (0, crypto_1.randomUUID)();
        const full = { ...record, id: demoId, addedAt: new Date().toISOString() };
        const demoFolder = path.join(this.demosDir(id), demoId);
        fs.mkdirSync(demoFolder, { recursive: true });
        fs.writeFileSync(path.join(demoFolder, 'record.json'), JSON.stringify(full, null, 2));
        const meta = this.readMeta(id);
        meta.demoCount = existing.length + 1;
        this.writeMeta(meta);
        return full;
    }
    setDemoRoster(id, demoId, steamIds) {
        const records = this.readDemoRecords(id);
        const record = records.find((r) => r.id === demoId);
        if (!record) {
            throw new Error(`Demo "${demoId}" não encontrada no slot "${id}".`);
        }
        record.myTeamSteamIds = steamIds;
        const recordPath = path.join(this.demoFolderPath(id, demoId), 'record.json');
        fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
        return record;
    }
    removeDemo(id, demoId) {
        const demoFolder = path.join(this.demosDir(id), demoId);
        if (fs.existsSync(demoFolder)) {
            fs.rmSync(demoFolder, { recursive: true, force: true });
        }
        const meta = this.readMeta(id);
        meta.demoCount = this.readDemoRecords(id).length;
        this.writeMeta(meta);
    }
    demoFolderPath(slotId, demoId) {
        return path.join(this.demosDir(slotId), demoId);
    }
    readDemoSummary(slotId, demoId) {
        const records = this.readDemoRecords(slotId);
        const record = records.find((r) => r.id === demoId);
        if (!record) {
            throw new Error(`Demo "${demoId}" não encontrada no slot "${slotId}".`);
        }
        const summaryFile = path.join(this.demoFolderPath(slotId, demoId), record.summaryPath);
        return JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
    }
    slotFolderPath(slotId) {
        return this.slotDir(slotId);
    }
}
exports.SlotManager = SlotManager;
//# sourceMappingURL=slotManager.js.map