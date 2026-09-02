import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TeamTendencyStats } from '../../core/models/slot.model';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-team-stats',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './team-stats.component.html',
})
export class TeamStatsComponent {
  @Input({ required: true }) team!: TeamTendencyStats;

  winRatePct(rate: number): string {
    return `${Math.round(rate * 100)}%`;
  }

  entries<T>(obj: Record<string, T> | undefined): [string, T][] {
    return obj ? Object.entries(obj) : [];
  }
}
