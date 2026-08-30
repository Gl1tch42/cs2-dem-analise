import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  PlayerAimStats,
  PlayerScoreAggregate,
  PlayerScoreHistoryEntry,
  PlayerUtilityStats,
} from '../../core/models/slot.model';

interface KpiDef<T> {
  label: string;
  key: keyof T;
  unit: string;
}

@Component({
  selector: 'app-consolidated-score',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './consolidated-score.component.html',
  styleUrl: './consolidated-score.component.scss',
})
export class ConsolidatedScoreComponent {
  @Input({ required: true }) players!: PlayerScoreAggregate[];

  // Cartões da matriz de mira, na ordem de exibição.
  readonly aimKpis: KpiDef<PlayerAimStats>[] = [
    { label: 'Accuracy', key: 'accuracy', unit: '%' },
    { label: 'Head Acc.', key: 'headAccuracy', unit: '%' },
    { label: 'HS Kill %', key: 'hsKillPct', unit: '%' },
    { label: 'First Bullet', key: 'firstBulletAccuracy', unit: '%' },
    { label: 'Spray Acc.', key: 'sprayAccuracy', unit: '%' },
    { label: 'Counter-Strafe', key: 'counterStrafePct', unit: '%' },
    { label: 'Crosshair Placement', key: 'avgCrosshairPlacementDeg', unit: 'º' },
    { label: 'Spotted Accuracy', key: 'spottedAccuracy', unit: '%' },
    { label: 'Time to Damage', key: 'avgTimeToDamageMs', unit: 'ms' },
    { label: 'Time to Kill', key: 'avgTimeToKillMs', unit: 'ms' },
  ];

  // Contagem bruta de granadas — sem color-coding, é só volume.
  readonly utilityCounts: KpiDef<PlayerUtilityStats>[] = [
    { label: 'Flashes', key: 'flashesThrown', unit: '' },
    { label: 'Smokes', key: 'smokesThrown', unit: '' },
    { label: 'Molotovs', key: 'molotovsThrown', unit: '' },
    { label: 'HEs', key: 'heThrown', unit: '' },
    { label: 'Flash Assists', key: 'flashAssists', unit: '' },
    { label: 'Friends Flashed', key: 'friendsFlashed', unit: '' },
  ];

  // Métricas de impacto da utility — essas sim recebem color-coding tático.
  readonly utilityImpact: KpiDef<PlayerUtilityStats>[] = [
    { label: 'Enemies Flashed', key: 'enemiesFlashedPct', unit: '%' },
    { label: 'Avg Blind', key: 'avgBlindTimeSec', unit: 's' },
    { label: 'Avg HE Dmg', key: 'avgHeDamage', unit: '' },
    { label: 'Avg HE Team Dmg', key: 'avgHeTeamDamage', unit: '' },
  ];

  // Mesmas faixas-alvo usadas em electron/ai/scoreEngine.ts (AIM_SUBMETRIC_WEIGHTS /
  // UTILITY_QUALITY_WEIGHTS) — reproduzidas aqui só pra colorir os cards da grade.
  // Não influenciam a nota real; se as faixas do scoreEngine mudarem, atualizar aqui também.
  private readonly metricRanges: Record<string, { min: number; max: number }> = {
    accuracy: { min: 8, max: 21.4 },
    headAccuracy: { min: 10, max: 25.9 },
    hsKillPct: { min: 20, max: 60 },
    firstBulletAccuracy: { min: 15, max: 45 },
    sprayAccuracy: { min: 17, max: 41.4 },
    counterStrafePct: { min: 36, max: 89.7 },
    avgCrosshairPlacementDeg: { min: 18.4, max: 6.2 },
    spottedAccuracy: { min: 16, max: 39.2 },
    avgTimeToDamageMs: { min: 1180, max: 393 },
    avgTimeToKillMs: { min: 2000, max: 600 },
    enemiesFlashedPct: { min: 20, max: 60 },
    avgBlindTimeSec: { min: 0.5, max: 3.0 },
    avgHeDamage: { min: 5, max: 25 },
    avgHeTeamDamage: { min: 5, max: 0 },
  };

  // steamId -> demoId da demo isolada em exibição. Sem entrada (ou null) = mostra o consolidado.
  private selectedDemoId: Record<string, string | null> = {};

  scoreClass(score: number): string {
    if (score >= 65) return 'is-success';
    if (score >= 40) return 'is-warning';
    return 'is-danger';
  }

  scoreTextClass(score: number): string {
    if (score >= 65) return 'has-text-success';
    if (score >= 40) return 'has-text-warning';
    return 'has-text-danger';
  }

  metricClass(value: number | null, key: string): string {
    if (value === null || value === undefined) return 'has-text-grey-light';
    const range = this.metricRanges[key];
    if (!range) return 'has-text-white';
    if (range.max === range.min) return 'has-text-grey-light';
    const t = (value - range.min) / (range.max - range.min);
    const pct = Math.max(0, Math.min(1, t)) * 100;
    if (pct >= 65) return 'has-text-success';
    if (pct >= 40) return 'has-text-warning';
    return 'has-text-danger';
  }

  formatMetric(value: number | null | undefined, unit: string): string {
    if (value === null || value === undefined) return '—';
    return `${value}${unit}`;
  }

  aimValue(p: PlayerScoreAggregate, key: keyof PlayerAimStats): number | null {
    return this.displayAim(p)[key];
  }

  utilityValue(p: PlayerScoreAggregate, key: keyof PlayerUtilityStats): number {
    return this.displayUtility(p)[key];
  }

  // Trunca hashes de arquivo longas (ex.: "1-99dc0f7c-81c9-...-abcde12357d3.dem")
  // pra algo escaneável ("1-99dc0f7c...12357d3.dem"), mantendo o nome completo no title.
  truncateLabel(label: string, headLen = 10, tailLen = 12): string {
    if (!label || label.length <= headLen + tailLen + 3) return label;
    return `${label.slice(0, headLen)}...${label.slice(-tailLen)}`;
  }

  selectDemo(steamId: string, demoId: string): void {
    this.selectedDemoId[steamId] = this.selectedDemoId[steamId] === demoId ? null : demoId;
  }

  isSelectedDemo(steamId: string, demoId: string): boolean {
    return this.selectedDemoId[steamId] === demoId;
  }

  getSelectedHistory(p: PlayerScoreAggregate): PlayerScoreHistoryEntry | null {
    const demoId = this.selectedDemoId[p.steamId];
    if (!demoId) return null;
    return p.history.find((h) => h.demoId === demoId) ?? null;
  }

  displayAim(p: PlayerScoreAggregate): PlayerAimStats {
    return this.getSelectedHistory(p)?.aim ?? p.aim;
  }

  displayUtility(p: PlayerScoreAggregate): PlayerUtilityStats {
    return this.getSelectedHistory(p)?.utility ?? p.utility;
  }

  displayAimScore(p: PlayerScoreAggregate): number {
    return this.getSelectedHistory(p)?.aimScore ?? p.avgAimScore;
  }

  displayUtilityScore(p: PlayerScoreAggregate): number {
    return this.getSelectedHistory(p)?.utilityScore ?? p.avgUtilityScore;
  }

  displayOverallScore(p: PlayerScoreAggregate): number {
    return this.getSelectedHistory(p)?.overallScore ?? p.avgOverallScore;
  }

  exportCsv() {
    if (!this.players || this.players.length === 0) return;
    const headers = [
      'Jogador',
      'Demos',
      'Nota Geral',
      'Nota Mira',
      'Nota Utility',
      'Accuracy %',
      'Head Accuracy %',
      'HS Kill %',
      'First Bullet %',
      'Spray %',
      'Counter-Strafe %',
      'Crosshair Placement (graus)',
      'Spotted Accuracy %',
      'Time to Damage (ms)',
      'Time to Kill (ms)',
      'Flashes',
      'Smokes',
      'Molotovs',
      'HEs',
      'Flash Assists',
      'Enemies Flashed %',
      'Friends Flashed',
      'Avg Blind Time (s)',
      'Avg HE Damage',
      'Avg HE Team Damage',
    ];
    const rows = this.players.map((p) => [
      p.name,
      p.demosCount,
      p.avgOverallScore,
      p.avgAimScore,
      p.avgUtilityScore,
      p.aim.accuracy,
      p.aim.headAccuracy,
      p.aim.hsKillPct,
      p.aim.firstBulletAccuracy,
      p.aim.sprayAccuracy,
      p.aim.counterStrafePct,
      p.aim.avgCrosshairPlacementDeg ?? '',
      p.aim.spottedAccuracy,
      p.aim.avgTimeToDamageMs ?? '',
      p.aim.avgTimeToKillMs ?? '',
      p.utility.flashesThrown,
      p.utility.smokesThrown,
      p.utility.molotovsThrown,
      p.utility.heThrown,
      p.utility.flashAssists,
      p.utility.enemiesFlashedPct,
      p.utility.friendsFlashed,
      p.utility.avgBlindTimeSec,
      p.utility.avgHeDamage,
      p.utility.avgHeTeamDamage,
    ]);
    // ';' como separador (não ',') porque Excel em pt-BR usa vírgula como separador
    // decimal e trataria um CSV separado por vírgula como uma coluna só.
    const csv = [headers, ...rows].map((row) => row.map((cell) => this.escapeCsv(cell)).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `consolidado-notas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private escapeCsv(value: unknown): string {
    const s = value === null || value === undefined ? '' : String(value);
    if (s.includes(';') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }
}
