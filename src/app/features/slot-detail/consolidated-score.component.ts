import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlayerScoreAggregate } from '../../core/models/slot.model';

@Component({
  selector: 'app-consolidated-score',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './consolidated-score.component.html',
})
export class ConsolidatedScoreComponent {
  @Input({ required: true }) players!: PlayerScoreAggregate[];

  scoreClass(score: number): string {
    if (score >= 65) return 'is-success';
    if (score >= 40) return 'is-warning';
    return 'is-danger';
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
