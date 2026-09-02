import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatchupReport, MatchupInsight } from '../../core/models/slot.model';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

const CONFIDENCE_LABELS: Record<string, string> = {
  low: 'Baixa confiança',
  medium: 'Confiança média',
  high: 'Alta confiança',
};

const SEVERITY_LABELS: Record<string, string> = {
  low: 'Severidade baixa',
  medium: 'Severidade média',
  high: 'Severidade alta',
};

const STRENGTH_LABELS: Record<string, string> = {
  low: 'Vantagem leve',
  medium: 'Vantagem média',
  high: 'Vantagem forte',
};

@Component({
  selector: 'app-matchup',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './matchup.component.html',
})
export class MatchupComponent {
  @Input({ required: true }) report!: MatchupReport;

  pct(rate: number): string {
    return `${Math.round(rate * 100)}%`;
  }

  patternLabel(insight: MatchupInsight): string {
    const k = insight.key;
    return `${k.side.toUpperCase()} · ${k.buyType}/${k.tempo}/${k.stance}/${k.site ?? 'unknown'}`;
  }

  confidenceLabel(c: string): string {
    return CONFIDENCE_LABELS[c] ?? c;
  }

  confidenceClass(c: string): string {
    return c === 'high' ? 'is-success' : c === 'medium' ? 'is-warning' : 'is-danger';
  }

  severityLabel(s: string): string {
    return SEVERITY_LABELS[s] ?? s;
  }

  strengthLabel(s: string): string {
    return STRENGTH_LABELS[s] ?? s;
  }

  severityClass(s: string): string {
    return s === 'high' ? 'is-danger' : s === 'medium' ? 'is-warning' : 'is-light';
  }
}
