import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ElectronService } from '../../core/services/electron.service';
import { NotebookComponent } from '../notebook/notebook.component';
import { Map2dComponent } from '../map2d/map2d.component';
import { HeatmapComponent } from '../heatmap/heatmap.component';
import { TeamStatsComponent } from './team-stats.component';
import { SlotDetail, AnalysisResult, DemoRecord, DemoSummary, PlayerMovementProfile } from '../../core/models/slot.model';

type TabId = 'overview' | 'map' | 'heatmap' | 'demos' | 'notebook' | 'ai';

@Component({
  selector: 'app-slot-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, NotebookComponent, Map2dComponent, HeatmapComponent, TeamStatsComponent],
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

  focusMode: 'team' | 'players' = 'team';
  focusRoster: PlayerMovementProfile[] = [];
  focusRosterLoading = false;
  focusSelected = new Set<string>();
  lastFocusLabel = '';

  rosterOpenFor: string | null = null;
  rosterSummary?: DemoSummary;
  rosterLoading = false;
  rosterSaving = false;
  rosterError = '';
  rosterDraft = new Set<string>();

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
    this.focusMode = 'team';
    this.focusRoster = [];
    this.focusSelected = new Set();
    this.slot = await this.electron.api.slots.get(id);
    this.loading = false;
  }

  setTab(tab: TabId) {
    this.activeTab = tab;
    if (tab === 'ai' && this.slot && this.slot.demos.length > 0 && this.focusRoster.length === 0) {
      this.loadFocusRoster();
    }
  }

  async loadFocusRoster() {
    if (!this.slot) return;
    this.focusRosterLoading = true;
    try {
      const stats = await this.electron.api.ai.getSlotStats(this.slot.id);
      this.focusRoster = stats.myTeam.playerMovementProfile;
    } catch {
      this.focusRoster = [];
    } finally {
      this.focusRosterLoading = false;
    }
  }

  setFocusMode(mode: 'team' | 'players') {
    this.focusMode = mode;
    if (mode === 'team') this.focusSelected = new Set();
  }

  toggleFocusPlayer(steamId: string) {
    if (this.focusSelected.has(steamId)) this.focusSelected.delete(steamId);
    else this.focusSelected.add(steamId);
    this.focusSelected = new Set(this.focusSelected);
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

  async toggleRoster(demo: DemoRecord) {
    if (this.rosterOpenFor === demo.id) {
      this.rosterOpenFor = null;
      return;
    }
    this.rosterOpenFor = demo.id;
    this.rosterError = '';
    this.rosterSummary = undefined;
    this.rosterDraft = new Set(demo.myTeamSteamIds ?? []);
    this.rosterLoading = true;
    try {
      this.rosterSummary = await this.electron.api.demos.getSummary(this.slot!.id, demo.id);
    } catch (err) {
      this.rosterError = (err as Error).message ?? 'Falha ao carregar jogadores da demo.';
    } finally {
      this.rosterLoading = false;
    }
  }

  toggleRosterPlayer(steamId: string) {
    if (this.rosterDraft.has(steamId)) this.rosterDraft.delete(steamId);
    else this.rosterDraft.add(steamId);
    this.rosterDraft = new Set(this.rosterDraft);
  }

  selectRosterSide(side: 'ct' | 't') {
    if (!this.rosterSummary) return;
    this.rosterDraft = new Set(
      this.rosterSummary.playerAggregates.filter((p) => p.side === side).map((p) => p.steamId)
    );
  }

  async saveRoster(demo: DemoRecord) {
    if (!this.slot) return;
    this.rosterSaving = true;
    this.rosterError = '';
    try {
      const updated = await this.electron.api.slots.setDemoRoster(this.slot.id, demo.id, Array.from(this.rosterDraft));
      demo.myTeamSteamIds = updated.myTeamSteamIds;
      this.rosterOpenFor = null;
    } catch (err) {
      this.rosterError = (err as Error).message ?? 'Falha ao salvar time.';
    } finally {
      this.rosterSaving = false;
    }
  }

  async runAnalysis() {
    if (!this.slot) return;
    this.analyzing = true;
    this.analysisError = '';
    try {
      const focusSteamIds = this.focusMode === 'players' ? Array.from(this.focusSelected) : undefined;
      this.lastFocusLabel =
        focusSteamIds && focusSteamIds.length > 0
          ? this.focusRoster
              .filter((p) => focusSteamIds.includes(p.steamId))
              .map((p) => p.name)
              .join(', ')
          : 'Time inteiro';
      this.analysisResult = await this.electron.api.ai.analyzeSlot(this.slot.id, undefined, focusSteamIds);
    } catch (err) {
      this.analysisError = (err as Error).message ?? 'Falha ao rodar análise de IA.';
    } finally {
      this.analyzing = false;
    }
  }

}
