import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  SlotMeta,
  SlotDetail,
  SlotKind,
  DemoRecord,
  DemoSummary,
  NotebookEntry,
  MAX_DEMOS_PER_SLOT,
  MAX_OPPONENT_SLOTS,
} from './types';

/**
 * Tudo fica dentro de <userData>/cs-demo-analyst/slots/<slotId>/
 *   meta.json
 *   notebook.md
 *   demos/<demoId>/raw.dem       (opcional, se o usuário mantiver a demo original)
 *   demos/<demoId>/summary.json  (saída do parser Python — o que a IA de fato lê)
 *
 * Não há banco de dados: cada slot é uma pasta autocontida, fácil de copiar/backupar
 * manualmente pelo usuário.
 */
export class SlotManager {
  private readonly rootDir: string;

  constructor() {
    this.rootDir = path.join(app.getPath('userData'), 'cs-demo-analyst', 'slots');
    this.ensureSlotsExist();
  }

  private ensureSlotsExist() {
    fs.mkdirSync(this.rootDir, { recursive: true });

    if (!fs.existsSync(this.slotDir('own'))) {
      this.createSlotFolder('own', 'own', 'Seu Time');
    }
    for (let i = 1; i <= MAX_OPPONENT_SLOTS; i++) {
      const id = `opp-${String(i).padStart(2, '0')}`;
      if (!fs.existsSync(this.slotDir(id))) {
        this.createSlotFolder(id, 'opponent', `Adversário ${i}`);
      }
    }
  }

  private slotDir(id: string) {
    return path.join(this.rootDir, id);
  }

  private metaPath(id: string) {
    return path.join(this.slotDir(id), 'meta.json');
  }

  private notebookPath(id: string) {
    return path.join(this.slotDir(id), 'notebook.md');
  }

  private demosDir(id: string) {
    return path.join(this.slotDir(id), 'demos');
  }

  private createSlotFolder(id: string, kind: SlotKind, defaultName: string) {
    fs.mkdirSync(this.demosDir(id), { recursive: true });
    const now = new Date().toISOString();
    const meta: SlotMeta = {
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

  private readMeta(id: string): SlotMeta {
    const raw = fs.readFileSync(this.metaPath(id), 'utf-8');
    return JSON.parse(raw);
  }

  private writeMeta(meta: SlotMeta) {
    meta.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.metaPath(meta.id), JSON.stringify(meta, null, 2));
  }

  private readDemoRecords(id: string): DemoRecord[] {
    const dir = this.demosDir(id);
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    const records: DemoRecord[] = [];
    for (const entry of entries) {
      const recordPath = path.join(dir, entry.name, 'record.json');
      if (fs.existsSync(recordPath)) {
        records.push(JSON.parse(fs.readFileSync(recordPath, 'utf-8')));
      }
    }
    return records.sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));
  }

  listSlots(): SlotMeta[] {
    const ids = ['own', ...Array.from({ length: MAX_OPPONENT_SLOTS }, (_, i) => `opp-${String(i + 1).padStart(2, '0')}`)];
    return ids.map((id) => {
      const meta = this.readMeta(id);
      meta.demoCount = this.readDemoRecords(id).length;
      return meta;
    });
  }

  getSlot(id: string): SlotDetail {
    const meta = this.readMeta(id);
    const demos = this.readDemoRecords(id);
    const notebookContent = fs.existsSync(this.notebookPath(id))
      ? fs.readFileSync(this.notebookPath(id), 'utf-8')
      : '';
    const stat = fs.existsSync(this.notebookPath(id)) ? fs.statSync(this.notebookPath(id)) : null;
    const notebook: NotebookEntry = {
      content: notebookContent,
      updatedAt: stat ? stat.mtime.toISOString() : meta.updatedAt,
    };
    return { ...meta, demoCount: demos.length, demos, notebook };
  }

  renameSlot(id: string, name: string): SlotMeta {
    const meta = this.readMeta(id);
    meta.name = name;
    this.writeMeta(meta);
    return meta;
  }

  setColorTag(id: string, colorTag: string): SlotMeta {
    const meta = this.readMeta(id);
    meta.colorTag = colorTag;
    this.writeMeta(meta);
    return meta;
  }

  saveNotebook(id: string, content: string): NotebookEntry {
    fs.writeFileSync(this.notebookPath(id), content);
    const meta = this.readMeta(id);
    this.writeMeta(meta); // só para tocar updatedAt do slot
    return { content, updatedAt: new Date().toISOString() };
  }

  /**
   * Registra uma demo já parseada dentro do slot. O parsing em si (chamada ao script
   * Python) acontece antes, em electron/ai ou num handler dedicado — aqui só gravamos
   * o resultado e mantemos o limite de MAX_DEMOS_PER_SLOT.
   */
  addDemo(id: string, record: Omit<DemoRecord, 'id' | 'addedAt'>): DemoRecord {
    const existing = this.readDemoRecords(id);
    if (existing.length >= MAX_DEMOS_PER_SLOT) {
      throw new Error(
        `O slot "${id}" já tem ${MAX_DEMOS_PER_SLOT} demos (limite máximo). Remova alguma antes de adicionar outra.`
      );
    }
    const demoId = randomUUID();
    const full: DemoRecord = { ...record, id: demoId, addedAt: new Date().toISOString() };
    const demoFolder = path.join(this.demosDir(id), demoId);
    fs.mkdirSync(demoFolder, { recursive: true });
    fs.writeFileSync(path.join(demoFolder, 'record.json'), JSON.stringify(full, null, 2));

    const meta = this.readMeta(id);
    meta.demoCount = existing.length + 1;
    this.writeMeta(meta);
    return full;
  }

  /** Marca quais 5 steamIds são "o time deste slot" numa demo — ver comentário em types.ts. */
  setDemoRoster(id: string, demoId: string, steamIds: string[]): DemoRecord {
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

  removeDemo(id: string, demoId: string): void {
    const demoFolder = path.join(this.demosDir(id), demoId);
    if (fs.existsSync(demoFolder)) {
      fs.rmSync(demoFolder, { recursive: true, force: true });
    }
    const meta = this.readMeta(id);
    meta.demoCount = this.readDemoRecords(id).length;
    this.writeMeta(meta);
  }

  /** Caminho absoluto da pasta de uma demo — usado pelos handlers de parsing/IA. */
  demoFolderPath(slotId: string, demoId: string): string {
    return path.join(this.demosDir(slotId), demoId);
  }

  /** Lê o summary.json completo (rounds, keyPositions etc.) de uma demo já importada. */
  readDemoSummary(slotId: string, demoId: string): DemoSummary {
    const records = this.readDemoRecords(slotId);
    const record = records.find((r) => r.id === demoId);
    if (!record) {
      throw new Error(`Demo "${demoId}" não encontrada no slot "${slotId}".`);
    }
    const summaryFile = path.join(this.demoFolderPath(slotId, demoId), record.summaryPath);
    return JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
  }

  slotFolderPath(slotId: string): string {
    return this.slotDir(slotId);
  }
}
