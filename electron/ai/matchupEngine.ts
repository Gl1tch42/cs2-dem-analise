import { DemoRecord } from '../storage/types';
import { SlotManager } from '../storage/slotManager';
import { PatternStat, PatternKey, ConsolidatedSlotStats, consolidateSlot } from './localHeuristics';

export type MatchupConfidence = 'low' | 'medium' | 'high';

// Mesmos limiares de SCORE_CONFIDENCE_THRESHOLDS em scoreEngine.ts — reaproveitado
// pra manter o mesmo critério de "amostra fraca/média/forte" em todo o app, mesmo
// contando ocorrências de padrão em vez de demos.
const MATCHUP_CONFIDENCE_THRESHOLDS = { medium: 3, high: 8 };

export function computeMatchupConfidence(minOccurrences: number): MatchupConfidence {
  if (minOccurrences >= MATCHUP_CONFIDENCE_THRESHOLDS.high) return 'high';
  if (minOccurrences >= MATCHUP_CONFIDENCE_THRESHOLDS.medium) return 'medium';
  return 'low';
}

// Mesmo piso de MIN_PATTERN_SAMPLE em analysisRunner.ts (lá é 2, aqui exigimos um
// pouco mais porque isso vira recomendação tática, não só uma linha de tabela) —
// abaixo disso o insight nem aparece, é ruído demais pra ser útil.
const DEFAULT_MIN_SAMPLES = 3;

export interface MatchupInsight {
  key: PatternKey;
  executorOccurrences: number;
  executorWinRate: number;
  // Win rate de quem historicamente ENFRENTOU esse padrão exato (map/side/buyType/
  // tempo/stance/site). Em exploitableWeaknesses isso somos nós; em ownAdvantages
  // isso é o adversário. Baixo = quem defende sofre com esse padrão.
  responseWinRate: number;
  responseSampleSize: number;
  confidence: MatchupConfidence;
  severity: MatchupConfidence;
}

export interface MatchupReport {
  ownSlotId: string;
  opponentSlotId: string;
  map: string;
  generatedAt: string;
  exploitableWeaknesses: MatchupInsight[];
  ownAdvantages: MatchupInsight[];
  demosPendingRoster: { own: string[]; opponent: string[] };
  disclaimer: 'inferred-not-head-to-head';
}

// Evita ruído de ponto flutuante tipo 1 - 0.7 = 0.30000000000000004 empurrar um
// insight pro bucket de severidade errado.
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function patternKeyString(k: PatternKey): string {
  return `${k.map}|${k.side}|${k.buyType}|${k.tempo}|${k.stance}|${k.site ?? 'unknown'}`;
}

// severidade puramente heurística a partir da distância de 50% — mesmo espírito
// de "sinal visual, não estatística validada" dos outros limiares do app.
function severityFromResponseWinRate(responseWinRate: number): MatchupConfidence {
  if (responseWinRate <= 0.3) return 'high';
  if (responseWinRate <= 0.45) return 'medium';
  return 'low';
}

function crossReference(
  executorPatterns: PatternStat[],
  responderPatterns: PatternStat[],
  map: string,
  minSamples: number
): MatchupInsight[] {
  const responderByKey = new Map(responderPatterns.map((p) => [patternKeyString(p.key), p]));
  const insights: MatchupInsight[] = [];

  for (const executor of executorPatterns) {
    if (executor.key.map !== map) continue;
    const responder = responderByKey.get(patternKeyString(executor.key));
    if (!responder) continue;
    if (Math.min(executor.count, responder.count) < minSamples) continue;

    const responseWinRate = round4(1 - responder.winRate);
    insights.push({
      key: executor.key,
      executorOccurrences: executor.count,
      executorWinRate: executor.winRate,
      responseWinRate,
      responseSampleSize: responder.count,
      confidence: computeMatchupConfidence(Math.min(executor.count, responder.count)),
      severity: severityFromResponseWinRate(responseWinRate),
    });
  }

  return insights;
}

const SEVERITY_ORDER: Record<MatchupConfidence, number> = { high: 2, medium: 1, low: 0 };

export function buildMatchup(
  ownSlotId: string,
  opponentSlotId: string,
  ownStats: ConsolidatedSlotStats,
  oppStats: ConsolidatedSlotStats,
  map: string,
  minSamples: number = DEFAULT_MIN_SAMPLES
): MatchupReport {
  const exploitableWeaknesses = crossReference(oppStats.myTeam.detailedPatterns, ownStats.opponent.detailedPatterns, map, minSamples)
    .filter((i) => i.responseWinRate < 0.5)
    .sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);

  const ownAdvantages = crossReference(ownStats.myTeam.detailedPatterns, oppStats.opponent.detailedPatterns, map, minSamples)
    .filter((i) => i.responseWinRate < 0.5)
    .sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);

  return {
    ownSlotId,
    opponentSlotId,
    map,
    generatedAt: new Date().toISOString(),
    exploitableWeaknesses,
    ownAdvantages,
    demosPendingRoster: { own: ownStats.demosPendingRoster, opponent: oppStats.demosPendingRoster },
    disclaimer: 'inferred-not-head-to-head',
  };
}

export function commonMaps(ownDemos: DemoRecord[], oppDemos: DemoRecord[]): string[] {
  const oppMaps = new Set(oppDemos.map((d) => d.map));
  const own = new Set(ownDemos.filter((d) => oppMaps.has(d.map)).map((d) => d.map));
  return Array.from(own).sort();
}

export function generateMatchup(
  slots: SlotManager,
  ownSlotId: string,
  opponentSlotId: string,
  map: string
): MatchupReport {
  const ownSlot = slots.getSlot(ownSlotId);
  const oppSlot = slots.getSlot(opponentSlotId);
  const ownStats = consolidateSlot(slots.slotFolderPath(ownSlotId), ownSlot.demos);
  const oppStats = consolidateSlot(slots.slotFolderPath(opponentSlotId), oppSlot.demos);
  return buildMatchup(ownSlotId, opponentSlotId, ownStats, oppStats, map);
}
