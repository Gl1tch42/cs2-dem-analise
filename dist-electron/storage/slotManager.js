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
// Snapshot do notebook só é gravado se já se passou esse tempo desde o
// último — o editor salva a cada poucas centenas de ms enquanto o analista
// digita, então sem esse throttle o histórico viraria uma cópia por
// keystroke em vez de checkpoints úteis pra recuperar uma versão anterior.
const NOTEBOOK_HISTORY_MIN_INTERVAL_MS = 5 * 60 * 1000;
const NOTEBOOK_HISTORY_MAX_ENTRIES = 200;
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
    notebookHistoryDir(id) {
        return path.join(this.slotDir(id), 'notebook-history');
    }
    // ISO timestamps (`2026-08-30T18:03:45.123Z`) só têm ':' como caractere
    // inválido em nome de arquivo no Windows; troca por '_' de forma
    // reversível (nada mais no ISO usa '_') pra poder recuperar o timestamp
    // original a partir do nome do arquivo.
    notebookHistoryFilePath(id, timestamp) {
        return path.join(this.notebookHistoryDir(id), `${timestamp.replace(/:/g, '_')}.md`);
    }
    notebookHistoryTimestampFromFileName(fileName) {
        return fileName.slice(0, -'.md'.length).replace(/_/g, ':');
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
    getMapStats() {
        const ids = ['own', ...Array.from({ length: types_1.MAX_OPPONENT_SLOTS }, (_, i) => `opp-${String(i + 1).padStart(2, '0')}`)];
        const counts = new Map();
        for (const id of ids) {
            for (const record of this.readDemoRecords(id)) {
                counts.set(record.map, (counts.get(record.map) ?? 0) + 1);
            }
        }
        return Array.from(counts.entries())
            .map(([map, demoCount]) => ({ map, demoCount }))
            .sort((a, b) => b.demoCount - a.demoCount || a.map.localeCompare(b.map));
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
        const previous = fs.existsSync(this.notebookPath(id)) ? fs.readFileSync(this.notebookPath(id), 'utf-8') : '';
        if (previous && previous !== content) {
            this.maybeSnapshotNotebook(id, previous);
        }
        fs.writeFileSync(this.notebookPath(id), content);
        const meta = this.readMeta(id);
        this.writeMeta(meta);
        return { content, updatedAt: new Date().toISOString() };
    }
    maybeSnapshotNotebook(id, previousContent) {
        const historyDir = this.notebookHistoryDir(id);
        fs.mkdirSync(historyDir, { recursive: true });
        const entries = fs
            .readdirSync(historyDir)
            .filter((f) => f.endsWith('.md'))
            .sort();
        const lastEntry = entries[entries.length - 1];
        if (lastEntry) {
            const lastTimestamp = Date.parse(this.notebookHistoryTimestampFromFileName(lastEntry));
            if (!Number.isNaN(lastTimestamp) && Date.now() - lastTimestamp < NOTEBOOK_HISTORY_MIN_INTERVAL_MS) {
                return;
            }
        }
        this.writeNotebookHistoryEntry(id, previousContent);
    }
    writeNotebookHistoryEntry(id, content) {
        const historyDir = this.notebookHistoryDir(id);
        fs.mkdirSync(historyDir, { recursive: true });
        fs.writeFileSync(this.notebookHistoryFilePath(id, new Date().toISOString()), content);
        const updated = fs
            .readdirSync(historyDir)
            .filter((f) => f.endsWith('.md'))
            .sort();
        while (updated.length > NOTEBOOK_HISTORY_MAX_ENTRIES) {
            const oldest = updated.shift();
            if (oldest)
                fs.rmSync(path.join(historyDir, oldest), { force: true });
        }
    }
    // Evita empilhar checkpoints idênticos toda vez que o mesmo `.csda-slot`
    // é reimportado (ex: analista importa de novo achando que não tinha feito
    // ainda) — sem isso, cada reimport criaria uma cópia nova do mesmo texto.
    notebookHistoryHasContent(id, content) {
        const historyDir = this.notebookHistoryDir(id);
        if (!fs.existsSync(historyDir))
            return false;
        return fs
            .readdirSync(historyDir)
            .filter((f) => f.endsWith('.md'))
            .some((f) => fs.readFileSync(path.join(historyDir, f), 'utf-8') === content);
    }
    listNotebookHistory(id) {
        const historyDir = this.notebookHistoryDir(id);
        if (!fs.existsSync(historyDir))
            return [];
        return fs
            .readdirSync(historyDir)
            .filter((f) => f.endsWith('.md'))
            .map((f) => this.notebookHistoryTimestampFromFileName(f))
            .sort()
            .reverse()
            .map((timestamp) => ({ timestamp }));
    }
    getNotebookHistoryContent(id, timestamp) {
        const filePath = this.notebookHistoryFilePath(id, timestamp);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Versão "${timestamp}" não encontrada no histórico do notebook do slot "${id}".`);
        }
        return fs.readFileSync(filePath, 'utf-8');
    }
    restoreNotebookHistory(id, timestamp) {
        const historicalContent = this.getNotebookHistoryContent(id, timestamp);
        const current = fs.existsSync(this.notebookPath(id)) ? fs.readFileSync(this.notebookPath(id), 'utf-8') : '';
        if (current && current !== historicalContent) {
            this.writeNotebookHistoryEntry(id, current);
        }
        fs.writeFileSync(this.notebookPath(id), historicalContent);
        const meta = this.readMeta(id);
        this.writeMeta(meta);
        return { content: historicalContent, updatedAt: new Date().toISOString() };
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
    exportSlot(id) {
        const meta = this.readMeta(id);
        const notebookContent = fs.existsSync(this.notebookPath(id))
            ? fs.readFileSync(this.notebookPath(id), 'utf-8')
            : '';
        const demos = this.readDemoRecords(id).map((record) => ({
            record,
            summary: this.readDemoSummary(id, record.id),
        }));
        return {
            formatVersion: 1,
            exportedAt: new Date().toISOString(),
            slotName: meta.name,
            slotKind: meta.kind,
            notebookContent,
            demos,
        };
    }
    // Demo importada de outra máquina não carrega o UUID original de volta
    // (cada `addDemo` gera um novo) — identifica duplicata por
    // arquivo+mapa+placar, que é estável entre máquinas pra uma mesma demo.
    importSlot(id, bundle) {
        if (bundle.formatVersion !== 1) {
            throw new Error('Formato de exportação não reconhecido — exporte novamente com a versão atual do app.');
        }
        const demoKey = (r) => `${r.fileName}|${r.map}|${r.score?.team ?? ''}|${r.score?.opponent ?? ''}`;
        const existingKeys = new Set(this.readDemoRecords(id).map(demoKey));
        let demosImported = 0;
        let demosSkippedDuplicate = 0;
        let demosSkippedLimit = 0;
        for (const { record, summary } of bundle.demos) {
            const key = demoKey(record);
            if (existingKeys.has(key)) {
                demosSkippedDuplicate++;
                continue;
            }
            try {
                const added = this.addDemo(id, {
                    fileName: record.fileName,
                    map: record.map,
                    summaryPath: 'summary.json',
                    score: record.score,
                    roundsParsed: record.roundsParsed,
                    notes: record.notes,
                    myTeamSteamIds: record.myTeamSteamIds,
                });
                fs.writeFileSync(path.join(this.demoFolderPath(id, added.id), 'summary.json'), JSON.stringify(summary, null, 2));
                existingKeys.add(key);
                demosImported++;
            }
            catch {
                demosSkippedLimit++;
            }
        }
        // Nunca sobrescreve as anotações do analista local silenciosamente — o
        // notebook que veio no export vira um checkpoint no histórico pra ele
        // revisar/mesclar manualmente (mesmo mecanismo de `restoreNotebookHistory`).
        let notebookSavedAsHistory = false;
        if (bundle.notebookContent && bundle.notebookContent.trim().length > 0) {
            const current = fs.existsSync(this.notebookPath(id)) ? fs.readFileSync(this.notebookPath(id), 'utf-8') : '';
            const alreadyImportedBefore = this.notebookHistoryHasContent(id, bundle.notebookContent);
            if (current !== bundle.notebookContent && !alreadyImportedBefore) {
                this.writeNotebookHistoryEntry(id, bundle.notebookContent);
                notebookSavedAsHistory = true;
            }
        }
        return { demosImported, demosSkippedDuplicate, demosSkippedLimit, notebookSavedAsHistory };
    }
}
exports.SlotManager = SlotManager;
//# sourceMappingURL=slotManager.js.map