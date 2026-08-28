import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ElectronService } from '../../core/services/electron.service';
import { NotebookComponent } from '../notebook/notebook.component';
import { Map2dComponent } from '../map2d/map2d.component';
import { SlotDetail, AnalysisResult } from '../../core/models/slot.model';

type TabId = 'overview' | 'map' | 'demos' | 'notebook' | 'ai';

@Component({
  selector: 'app-slot-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, NotebookComponent, Map2dComponent],
  templateUrl: './slot-detail.component.html',
  styleUrl: './slot-detail.component.scss',
})
export class SlotDetailComponent implements OnInit {
  slot?: SlotDetail;
  loading = true;
  activeTab: TabId = 'overview';
  editingName = false;
  nameDraft = '';

  importing = false;
  importError = '';

  analyzing = false;
  analysisError = '';
  analysisResult?: AnalysisResult;

  constructor(private route: ActivatedRoute, private electron: ElectronService) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) this.loadSlot(id);
    });
  }

  async loadSlot(id: string) {
    this.loading = true;
    this.analysisResult = undefined;
    this.activeTab = 'overview';
    this.slot = await this.electron.api.slots.get(id);
    this.loading = false;
  }

  setTab(tab: TabId) {
    this.activeTab = tab;
  }

  startRename() {
    if (!this.slot) return;
    this.nameDraft = this.slot.name;
    this.editingName = true;
  }

  async confirmRename() {
    if (!this.slot || !this.nameDraft.trim()) {
      this.editingName = false;
      return;
    }
    await this.electron.api.slots.rename(this.slot.id, this.nameDraft.trim());
    this.slot.name = this.nameDraft.trim();
    this.editingName = false;
  }

  async importDemo() {
    if (!this.slot) return;
    this.importing = true;
    this.importError = '';
    try {
      await this.electron.api.demos.importDemo(this.slot.id);
      await this.loadSlot(this.slot.id);
    } catch (err) {
      this.importError = (err as Error).message ?? 'Falha ao importar demo.';
    } finally {
      this.importing = false;
    }
  }

  async removeDemo(demoId: string) {
    if (!this.slot) return;
    await this.electron.api.slots.removeDemo(this.slot.id, demoId);
    await this.loadSlot(this.slot.id);
  }

  async runAnalysis() {
    if (!this.slot) return;
    this.analyzing = true;
    this.analysisError = '';
    try {
      this.analysisResult = await this.electron.api.ai.analyzeSlot(this.slot.id);
    } catch (err) {
      this.analysisError = (err as Error).message ?? 'Falha ao rodar análise de IA.';
    } finally {
      this.analyzing = false;
    }
  }

  winRatePct(rate: number): string {
    return `${Math.round(rate * 100)}%`;
  }

  /** Exposto para o template poder iterar Records (ex: tendencyByBuyType) com *ngFor. */
  entries<T>(obj: Record<string, T> | undefined): [string, T][] {
    return obj ? Object.entries(obj) : [];
  }
}
