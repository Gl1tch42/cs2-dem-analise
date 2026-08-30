import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ElectronService } from '../../core/services/electron.service';
import { MapStat, SlotMeta, MAX_OPPONENT_SLOTS } from '../../core/models/slot.model';

const COLLAPSED_STORAGE_KEY = 'sidebar-collapsed';
const TEAMS_EXPANDED_KEY = 'sidebar-teams-expanded';
const MAPS_EXPANDED_KEY = 'sidebar-maps-expanded';

const MAP_DESCRIPTIONS: Record<string, string> = {
  de_mirage: 'Dois sites; meio disputado por janela e conector.',
  de_inferno: 'Site B decisivo pela banana; site A com apps e meio longo.',
  de_dust2: 'Mapa clássico; long A e túneis conduzindo ao B.',
  de_nuke: 'Verticalidade entre o site A (superior) e o B (subsolo).',
  de_ancient: 'Vegetação densa; rotações rápidas entre A, meio e B.',
  de_anubis: 'Site A com água central; B ligado por canal.',
  de_train: 'Mapa industrial com containers; rotações curtas entre sites.',
  de_overpass: 'Bathroom no site A; park e monastery levam ao B.',
  de_vertigo: 'Mapa vertical; ramp no B e escritório no A.',
  de_cache: 'Layout aberto; site A com quad, B com vents.',
  de_cbble: 'Mapa clássico com meio longo e sites amplos.',
};

interface MapEntry extends MapStat {
  description: string;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent implements OnInit {
  ownSlot?: SlotMeta;
  usedOpponentSlots: SlotMeta[] = [];
  availableSlotCount = 0;
  maxOpponentSlots = MAX_OPPONENT_SLOTS;
  mapEntries: MapEntry[] = [];
  loading = true;

  collapsed = false;
  hovering = false;
  teamsExpanded = false;
  mapsExpanded = false;

  creatingTeam = false;
  newTeamName = '';
  creatingTeamError = '';

  constructor(private electron: ElectronService) {}

  async ngOnInit() {
    this.collapsed = localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true';
    this.teamsExpanded = localStorage.getItem(TEAMS_EXPANDED_KEY) === 'true';
    this.mapsExpanded = localStorage.getItem(MAPS_EXPANDED_KEY) === 'true';
    await this.reload();
  }

  toggleCollapsed() {
    this.collapsed = !this.collapsed;
    localStorage.setItem(COLLAPSED_STORAGE_KEY, String(this.collapsed));
  }

  toggleTeams() {
    this.teamsExpanded = !this.teamsExpanded;
    localStorage.setItem(TEAMS_EXPANDED_KEY, String(this.teamsExpanded));
    if (!this.teamsExpanded) this.cancelCreateTeam();
  }

  toggleMaps() {
    this.mapsExpanded = !this.mapsExpanded;
    localStorage.setItem(MAPS_EXPANDED_KEY, String(this.mapsExpanded));
  }

  onMouseEnter() {
    this.hovering = true;
  }

  onMouseLeave() {
    this.hovering = false;
  }

  private defaultOpponentName(id: string): string {
    const n = parseInt(id.replace('opp-', ''), 10);
    return `Adversário ${n}`;
  }

  private isUnusedSlot(slot: SlotMeta): boolean {
    return slot.demoCount === 0 && slot.name === this.defaultOpponentName(slot.id);
  }

  async reload() {
    this.loading = true;
    const [slots, mapStats] = await Promise.all([
      this.electron.api.slots.list(),
      this.electron.api.slots.mapStats(),
    ]);
    this.ownSlot = slots.find((s) => s.kind === 'own');
    const opponents = slots.filter((s) => s.kind === 'opponent');
    this.usedOpponentSlots = opponents.filter((s) => !this.isUnusedSlot(s));
    this.availableSlotCount = opponents.length - this.usedOpponentSlots.length;
    this.mapEntries = mapStats.map((m) => ({
      ...m,
      description: MAP_DESCRIPTIONS[m.map] ?? 'Sem descrição cadastrada.',
    }));
    this.loading = false;
  }

  openCreateTeam() {
    if (this.availableSlotCount === 0) return;
    this.teamsExpanded = true;
    localStorage.setItem(TEAMS_EXPANDED_KEY, 'true');
    this.creatingTeam = true;
    this.creatingTeamError = '';
    this.newTeamName = '';
  }

  cancelCreateTeam() {
    this.creatingTeam = false;
    this.newTeamName = '';
    this.creatingTeamError = '';
  }

  async confirmCreateTeam() {
    const name = this.newTeamName.trim();
    if (!name) {
      this.creatingTeamError = 'Digite um nome para o time.';
      return;
    }
    const slots = await this.electron.api.slots.list();
    const nextSlot = slots.find((s) => s.kind === 'opponent' && this.isUnusedSlot(s));
    if (!nextSlot) {
      this.creatingTeamError = `Limite de ${this.maxOpponentSlots} times atingido.`;
      return;
    }
    await this.electron.api.slots.rename(nextSlot.id, name);
    this.cancelCreateTeam();
    await this.reload();
  }
}
