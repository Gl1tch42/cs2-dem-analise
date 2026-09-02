import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  PlayerAimStats,
  PlayerScoreAggregate,
  PlayerScoreHistoryEntry,
  PlayerUtilityStats,
  PlayerPositioningStats,
  PlayerImpactStats,
} from '../../core/models/slot.model';
import { TranslationService } from '../../core/services/translation.service';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

interface KpiDef<T> {
  label: string;
  key: keyof T;
  unit: string;
}

@Component({
  selector: 'app-consolidated-score',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './consolidated-score.component.html',
  styleUrl: './consolidated-score.component.scss',
})
export class ConsolidatedScoreComponent {
  @Input({ required: true }) players!: PlayerScoreAggregate[];

  constructor(private translation: TranslationService) {}

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

  // Contagem bruta / totais — sem color-coding (não são taxa normalizada por
  // round, então comparar cor entre jogadores com números de demos diferentes
  // enganaria).
  readonly utilityCounts: KpiDef<PlayerUtilityStats>[] = [
    { label: 'Flashes', key: 'flashesThrown', unit: '' },
    { label: 'Smokes', key: 'smokesThrown', unit: '' },
    { label: 'Molotovs', key: 'molotovsThrown', unit: '' },
    { label: 'HEs', key: 'heThrown', unit: '' },
    { label: 'Flash Assists', key: 'flashAssists', unit: '' },
    { label: 'Friends Flashed', key: 'friendsFlashed', unit: '' },
    { label: 'Smokes no pé', key: 'smokesWasted', unit: '' },
    { label: 'Rounds c/ utility não usada', key: 'unusedUtilityRounds', unit: '' },
    { label: 'Valor não usado', key: 'unusedUtilityValue', unit: '$' },
  ];

  // Métricas de impacto da utility — essas sim recebem color-coding tático.
  readonly utilityImpact: KpiDef<PlayerUtilityStats>[] = [
    { label: 'Enemies Flashed', key: 'enemiesFlashedPct', unit: '%' },
    { label: 'Flashbang Efficiency', key: 'effectiveFlashPct', unit: '%' },
    { label: 'Avg Blind', key: 'avgBlindTimeSec', unit: 's' },
    { label: 'Avg Friendly Blind', key: 'avgFriendlyBlindTimeSec', unit: 's' },
    { label: 'Avg HE Dmg', key: 'avgHeDamage', unit: '' },
    { label: 'Avg HE Team Dmg', key: 'avgHeTeamDamage', unit: '' },
    { label: 'Avg Molotov Dmg', key: 'avgMolotovDamage', unit: '' },
    { label: 'Avg Molotov Team Dmg', key: 'avgMolotovTeamDamage', unit: '' },
  ];

  // Cartões de posicionamento — trade/isolamento/overexposure/opening duel.
  readonly positioningKpis: KpiDef<PlayerPositioningStats>[] = [
    { label: 'Opening Duel Win%', key: 'openingDuelWinPct', unit: '%' },
    { label: 'Opening Duel Participation', key: 'openingDuelParticipationPct', unit: '%' },
    { label: 'Traded Death %', key: 'tradedDeathPct', unit: '%' },
    { label: 'Isolated Death %', key: 'isolatedDeathPct', unit: '%' },
    { label: 'Trade Kill %', key: 'tradeKillPct', unit: '%' },
    { label: 'Avg Trade Delay', key: 'avgTradeDelayMs', unit: 'ms' },
    { label: 'Overexposed Death %', key: 'overexposedDeathPct', unit: '%' },
    { label: 'Avg Dist. Aliado', key: 'avgNearestTeammateDist', unit: 'u' },
  ];

  // Contagem bruta — sem color-coding.
  readonly positioningCounts: KpiDef<PlayerPositioningStats>[] = [
    { label: 'Trade Kills', key: 'tradeKills', unit: '' },
  ];

  // Cartões de Rating/Impacto — produção crua (kills/ADR/KPR) e o valor real de
  // vencer o round (clutch, sacrifício de abrir o round). Recebem color-coding.
  readonly impactKpis: KpiDef<PlayerImpactStats>[] = [
    { label: 'KPR', key: 'kpr', unit: '' },
    { label: 'ADR', key: 'adr', unit: '' },
    { label: 'Clutch Win %', key: 'clutchWinPct', unit: '%' },
    { label: 'Sacrifício de Abertura', key: 'sacrificeOpenPct', unit: '%' },
  ];

  // Contagem bruta — sem color-coding.
  readonly impactCounts: KpiDef<PlayerImpactStats>[] = [
    { label: 'Kills', key: 'kills', unit: '' },
    { label: 'Deaths', key: 'deaths', unit: '' },
    { label: 'Assists', key: 'assists', unit: '' },
    { label: 'Clutches Ganhos', key: 'clutchesWon', unit: '' },
    { label: 'Clutches Perdidos', key: 'clutchesLost', unit: '' },
    { label: 'Rounds Abertos', key: 'roundsOpened', unit: '' },
    { label: 'Rounds Abertos e Vencidos', key: 'roundsOpenedWon', unit: '' },
  ];

  // Mesmas faixas-alvo usadas em electron/ai/scoreEngine.ts (AIM_SUBMETRIC_WEIGHTS /
  // UTILITY_QUALITY_WEIGHTS / POSITIONING_WEIGHTS) — reproduzidas aqui só pra
  // colorir os cards da grade. Não influenciam a nota real; se as faixas do
  // scoreEngine mudarem, atualizar aqui também.
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
    effectiveFlashPct: { min: 15, max: 55 },
    avgBlindTimeSec: { min: 0.5, max: 3.0 },
    avgFriendlyBlindTimeSec: { min: 3, max: 0 },
    avgHeDamage: { min: 5, max: 25 },
    avgHeTeamDamage: { min: 5, max: 0 },
    avgMolotovDamage: { min: 5, max: 22 },
    avgMolotovTeamDamage: { min: 5, max: 0 },
    openingDuelWinPct: { min: 35, max: 65 },
    openingDuelParticipationPct: { min: 10, max: 40 },
    tradedDeathPct: { min: 20, max: 55 },
    isolatedDeathPct: { min: 40, max: 10 },
    tradeKillPct: { min: 5, max: 25 },
    avgTradeDelayMs: { min: 2500, max: 1200 },
    overexposedDeathPct: { min: 35, max: 5 },
    avgNearestTeammateDist: { min: 1200, max: 400 },
    kpr: { min: 0.5, max: 1.0 },
    adr: { min: 60, max: 95 },
    clutchWinPct: { min: 15, max: 50 },
    sacrificeOpenPct: { min: 30, max: 60 },
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

  positioningValue(p: PlayerScoreAggregate, key: keyof PlayerPositioningStats): number | null {
    return this.displayPositioning(p)[key];
  }

  impactValue(p: PlayerScoreAggregate, key: keyof PlayerImpactStats): number {
    return this.displayImpact(p)[key];
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

  displayPositioning(p: PlayerScoreAggregate): PlayerPositioningStats {
    return this.getSelectedHistory(p)?.positioning ?? p.positioning;
  }

  displayImpact(p: PlayerScoreAggregate): PlayerImpactStats {
    return this.getSelectedHistory(p)?.impact ?? p.impact;
  }

  displayAimScore(p: PlayerScoreAggregate): number {
    return this.getSelectedHistory(p)?.aimScore ?? p.avgAimScore;
  }

  displayUtilityScore(p: PlayerScoreAggregate): number {
    return this.getSelectedHistory(p)?.utilityScore ?? p.avgUtilityScore;
  }

  displayPositioningScore(p: PlayerScoreAggregate): number {
    return this.getSelectedHistory(p)?.positioningScore ?? p.avgPositioningScore;
  }

  displayImpactScore(p: PlayerScoreAggregate): number {
    return this.getSelectedHistory(p)?.impactScore ?? p.avgImpactScore;
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
      'Nota Posicionamento',
      'Nota Rating',
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
      'Flashbang Efficiency %',
      'Friends Flashed',
      'Avg Blind Time (s)',
      'Avg Friendly Blind Time (s)',
      'Avg HE Damage',
      'Avg HE Team Damage',
      'Avg Molotov Damage',
      'Avg Molotov Team Damage',
      'Smokes no pé',
      'Rounds c/ utility não usada',
      'Valor não usado ($)',
      'Opening Duel Win %',
      'Opening Duel Participation %',
      'Traded Death %',
      'Isolated Death %',
      'Trade Kills',
      'Trade Kill %',
      'Avg Trade Delay (ms)',
      'Overexposed Death %',
      'Avg Dist. Aliado Mais Próximo',
      'Kills',
      'Deaths',
      'Assists',
      'KPR',
      'ADR',
      'Clutches Ganhos',
      'Clutches Perdidos',
      'Clutch Win %',
      'Rounds Abertos',
      'Rounds Abertos e Vencidos',
      'Sacrifício de Abertura %',
    ].map((h) => this.translation.t(h));
    const rows = this.players.map((p) => [
      p.name,
      p.demosCount,
      p.avgOverallScore,
      p.avgAimScore,
      p.avgUtilityScore,
      p.avgPositioningScore,
      p.avgImpactScore,
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
      p.utility.effectiveFlashPct,
      p.utility.friendsFlashed,
      p.utility.avgBlindTimeSec,
      p.utility.avgFriendlyBlindTimeSec,
      p.utility.avgHeDamage,
      p.utility.avgHeTeamDamage,
      p.utility.avgMolotovDamage,
      p.utility.avgMolotovTeamDamage,
      p.utility.smokesWasted,
      p.utility.unusedUtilityRounds,
      p.utility.unusedUtilityValue,
      p.positioning.openingDuelWinPct,
      p.positioning.openingDuelParticipationPct,
      p.positioning.tradedDeathPct,
      p.positioning.isolatedDeathPct,
      p.positioning.tradeKills,
      p.positioning.tradeKillPct,
      p.positioning.avgTradeDelayMs ?? '',
      p.positioning.overexposedDeathPct,
      p.positioning.avgNearestTeammateDist ?? '',
      p.impact.kills,
      p.impact.deaths,
      p.impact.assists,
      p.impact.kpr,
      p.impact.adr,
      p.impact.clutchesWon,
      p.impact.clutchesLost,
      p.impact.clutchWinPct,
      p.impact.roundsOpened,
      p.impact.roundsOpenedWon,
      p.impact.sacrificeOpenPct,
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
