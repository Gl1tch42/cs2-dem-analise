import * as fs from 'fs';
import * as path from 'path';
import {
  DemoRecord,
  DemoSummary,
  PlayerScoreAggregate,
  PlayerScoreHistoryEntry,
  PlayerAimStats,
  PlayerUtilityStats,
} from '../storage/types';

// Pesos e faixas-alvo da nota de mira/utility — ponto de partida razoável, não
// uma fórmula validada. Cada sub-métrica é normalizada linearmente contra uma
// faixa-alvo (targetMin -> 0, targetMax -> 100, clampado); quando targetMin >
// targetMax a normalização inverte sozinha (usado pra métricas onde "menor é
// melhor", tipo crosshair placement e dano em aliado). Calibrar olhando
// resultados reais dos jogadores do usuário e ajustar só estas constantes.
interface SubmetricWeight {
  weight: number;
  targetMin: number;
  targetMax: number;
}

const AIM_SUBMETRIC_WEIGHTS: Record<string, SubmetricWeight> = {
  accuracy: { weight: 0.2, targetMin: 10, targetMax: 35 },
  headAccuracy: { weight: 0.2, targetMin: 20, targetMax: 55 },
  hsKillPct: { weight: 0.15, targetMin: 20, targetMax: 60 },
  firstBulletAccuracy: { weight: 0.15, targetMin: 15, targetMax: 45 },
  sprayAccuracy: { weight: 0.1, targetMin: 15, targetMax: 40 },
  counterStrafePct: { weight: 0.1, targetMin: 30, targetMax: 80 },
  crosshairPlacement: { weight: 0.1, targetMin: 25, targetMax: 2 },
};

const UTILITY_QUALITY_WEIGHTS: Record<string, SubmetricWeight> = {
  enemiesFlashedPct: { weight: 0.3, targetMin: 20, targetMax: 60 },
  avgBlindTimeSec: { weight: 0.2, targetMin: 0.5, targetMax: 3.0 },
  avgHeDamage: { weight: 0.2, targetMin: 5, targetMax: 25 },
  flashAssistsPerRound: { weight: 0.2, targetMin: 0, targetMax: 0.15 },
  teamDamagePenalty: { weight: 0.1, targetMin: 5, targetMax: 0 },
};

const UTILITY_QUANTITY_TARGET = { min: 0.3, max: 1.2 }; // granadas jogadas por round
const UTILITY_QUALITY_SHARE = 0.7;
const UTILITY_QUANTITY_SHARE = 0.3;
const OVERALL_SPLIT = { aim: 0.6, utility: 0.4 };

function normalize(value: number, targetMin: number, targetMax: number): number {
  if (targetMax === targetMin) return 50;
  const t = (value - targetMin) / (targetMax - targetMin);
  return Math.max(0, Math.min(100, t * 100));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function computeAimScore(aim: PlayerAimStats): number {
  let sum = 0;
  let totalWeight = 0;
  const add = (value: number, cfg: SubmetricWeight) => {
    sum += normalize(value, cfg.targetMin, cfg.targetMax) * cfg.weight;
    totalWeight += cfg.weight;
  };
  add(aim.accuracy, AIM_SUBMETRIC_WEIGHTS.accuracy);
  add(aim.headAccuracy, AIM_SUBMETRIC_WEIGHTS.headAccuracy);
  add(aim.hsKillPct, AIM_SUBMETRIC_WEIGHTS.hsKillPct);
  add(aim.firstBulletAccuracy, AIM_SUBMETRIC_WEIGHTS.firstBulletAccuracy);
  add(aim.sprayAccuracy, AIM_SUBMETRIC_WEIGHTS.sprayAccuracy);
  add(aim.counterStrafePct, AIM_SUBMETRIC_WEIGHTS.counterStrafePct);
  if (aim.avgCrosshairPlacementDeg !== null) {
    add(aim.avgCrosshairPlacementDeg, AIM_SUBMETRIC_WEIGHTS.crosshairPlacement);
  }
  return totalWeight ? round1(sum / totalWeight) : 0;
}

export function computeUtilityScore(utility: PlayerUtilityStats, roundsInDemo: number): number {
  let sum = 0;
  let totalWeight = 0;
  const add = (value: number, cfg: SubmetricWeight) => {
    sum += normalize(value, cfg.targetMin, cfg.targetMax) * cfg.weight;
    totalWeight += cfg.weight;
  };
  add(utility.enemiesFlashedPct, UTILITY_QUALITY_WEIGHTS.enemiesFlashedPct);
  add(utility.avgBlindTimeSec, UTILITY_QUALITY_WEIGHTS.avgBlindTimeSec);
  add(utility.avgHeDamage, UTILITY_QUALITY_WEIGHTS.avgHeDamage);
  const flashAssistsPerRound = roundsInDemo ? utility.flashAssists / roundsInDemo : 0;
  add(flashAssistsPerRound, UTILITY_QUALITY_WEIGHTS.flashAssistsPerRound);
  add(utility.avgHeTeamDamage, UTILITY_QUALITY_WEIGHTS.teamDamagePenalty);
  const qualityScore = totalWeight ? sum / totalWeight : 0;

  const totalThrown = utility.flashesThrown + utility.smokesThrown + utility.molotovsThrown + utility.heThrown;
  const perRound = roundsInDemo ? totalThrown / roundsInDemo : 0;
  const quantityScore = normalize(perRound, UTILITY_QUANTITY_TARGET.min, UTILITY_QUANTITY_TARGET.max);

  return round1(qualityScore * UTILITY_QUALITY_SHARE + quantityScore * UTILITY_QUANTITY_SHARE);
}

export function computeOverallScore(aimScore: number, utilityScore: number): number {
  return round1(aimScore * OVERALL_SPLIT.aim + utilityScore * OVERALL_SPLIT.utility);
}

// Acumulador guarda somas cruas (nunca médias parciais encadeadas) — as médias
// só são calculadas uma vez, no fechamento, dividindo pela contagem real de
// demos/eventos. Fazer "(mediaAnterior + novoValor) / 2" a cada demo distorceria
// a primeira demo de cada jogador (média com uma base zerada).
interface PlayerScoreAccumulator {
  name: string;
  demosCount: number;

  shotsFired: number;
  shotsHit: number;
  headHits: number;
  hsKills: number;
  firstBulletShots: number;
  sprayShots: number;
  hsKillPctSum: number;
  firstBulletAccuracySum: number;
  sprayAccuracySum: number;
  counterStrafePctSum: number;
  crosshairDegSum: number;
  crosshairDegCount: number;

  flashesThrown: number;
  smokesThrown: number;
  molotovsThrown: number;
  heThrown: number;
  flashAssists: number;
  enemiesFlashed: number;
  friendsFlashed: number;
  avgBlindTimeSecSum: number;
  avgHeDamageSum: number;
  avgHeTeamDamageSum: number;

  aimScoreSum: number;
  utilityScoreSum: number;
  overallScoreSum: number;
  history: PlayerScoreHistoryEntry[];
}

function newAccumulator(name: string): PlayerScoreAccumulator {
  return {
    name,
    demosCount: 0,
    shotsFired: 0,
    shotsHit: 0,
    headHits: 0,
    hsKills: 0,
    firstBulletShots: 0,
    sprayShots: 0,
    hsKillPctSum: 0,
    firstBulletAccuracySum: 0,
    sprayAccuracySum: 0,
    counterStrafePctSum: 0,
    crosshairDegSum: 0,
    crosshairDegCount: 0,
    flashesThrown: 0,
    smokesThrown: 0,
    molotovsThrown: 0,
    heThrown: 0,
    flashAssists: 0,
    enemiesFlashed: 0,
    friendsFlashed: 0,
    avgBlindTimeSecSum: 0,
    avgHeDamageSum: 0,
    avgHeTeamDamageSum: 0,
    aimScoreSum: 0,
    utilityScoreSum: 0,
    overallScoreSum: 0,
    history: [],
  };
}

// Segue o mesmo padrão de leitura de `consolidateSlot` (electron/ai/localHeuristics.ts):
// lê summary.json de cada demo direto do disco, filtra por roster marcado
// (demo.myTeamSteamIds) — só assim dá pra saber quem, entre os 10 jogadores de
// CADA demo, é "nosso" de forma consistente entre demos diferentes.
export function computePlayerScores(slotFolder: string, demos: DemoRecord[]): PlayerScoreAggregate[] {
  const accMap = new Map<string, PlayerScoreAccumulator>();

  for (const demo of demos) {
    const summaryFile = path.join(slotFolder, 'demos', demo.id, 'summary.json');
    if (!fs.existsSync(summaryFile)) continue;
    const myTeamSteamIds = demo.myTeamSteamIds;
    if (!myTeamSteamIds || myTeamSteamIds.length === 0) continue;
    const myIdSet = new Set(myTeamSteamIds);

    const summary: DemoSummary = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
    const roundsInDemo = summary.rounds.length;

    for (const player of summary.playerAggregates) {
      if (!myIdSet.has(player.steamId)) continue;
      if (!player.aim || !player.utility) continue; // demo parseada antes desta feature

      const aimScore = computeAimScore(player.aim);
      const utilityScore = computeUtilityScore(player.utility, roundsInDemo);
      const overallScore = computeOverallScore(aimScore, utilityScore);

      const acc = accMap.get(player.steamId) ?? newAccumulator(player.name);
      acc.name = player.name;
      acc.demosCount++;

      acc.shotsFired += player.aim.shotsFired;
      acc.shotsHit += player.aim.shotsHit;
      acc.headHits += player.aim.headHits;
      acc.hsKills += player.aim.hsKills;
      acc.firstBulletShots += player.aim.firstBulletShots;
      acc.sprayShots += player.aim.sprayShots;
      acc.hsKillPctSum += player.aim.hsKillPct;
      acc.firstBulletAccuracySum += player.aim.firstBulletAccuracy;
      acc.sprayAccuracySum += player.aim.sprayAccuracy;
      acc.counterStrafePctSum += player.aim.counterStrafePct;
      if (player.aim.avgCrosshairPlacementDeg !== null) {
        acc.crosshairDegSum += player.aim.avgCrosshairPlacementDeg;
        acc.crosshairDegCount++;
      }

      acc.flashesThrown += player.utility.flashesThrown;
      acc.smokesThrown += player.utility.smokesThrown;
      acc.molotovsThrown += player.utility.molotovsThrown;
      acc.heThrown += player.utility.heThrown;
      acc.flashAssists += player.utility.flashAssists;
      acc.enemiesFlashed += player.utility.enemiesFlashed;
      acc.friendsFlashed += player.utility.friendsFlashed;
      acc.avgBlindTimeSecSum += player.utility.avgBlindTimeSec;
      acc.avgHeDamageSum += player.utility.avgHeDamage;
      acc.avgHeTeamDamageSum += player.utility.avgHeTeamDamage;

      acc.aimScoreSum += aimScore;
      acc.utilityScoreSum += utilityScore;
      acc.overallScoreSum += overallScore;
      acc.history.push({
        demoId: demo.id,
        demoLabel: demo.fileName,
        addedAt: demo.addedAt,
        aimScore,
        utilityScore,
        overallScore,
      });

      accMap.set(player.steamId, acc);
    }
  }

  return Array.from(accMap.entries())
    .map(([steamId, acc]) => ({
      steamId,
      name: acc.name,
      demosCount: acc.demosCount,
      avgAimScore: acc.demosCount ? round1(acc.aimScoreSum / acc.demosCount) : 0,
      avgUtilityScore: acc.demosCount ? round1(acc.utilityScoreSum / acc.demosCount) : 0,
      avgOverallScore: acc.demosCount ? round1(acc.overallScoreSum / acc.demosCount) : 0,
      aim: {
        shotsFired: acc.shotsFired,
        shotsHit: acc.shotsHit,
        accuracy: acc.shotsFired ? round1((100 * acc.shotsHit) / acc.shotsFired) : 0,
        headHits: acc.headHits,
        headAccuracy: acc.shotsHit ? round1((100 * acc.headHits) / acc.shotsHit) : 0,
        hsKills: acc.hsKills,
        hsKillPct: acc.demosCount ? round1(acc.hsKillPctSum / acc.demosCount) : 0,
        firstBulletShots: acc.firstBulletShots,
        firstBulletAccuracy: acc.demosCount ? round1(acc.firstBulletAccuracySum / acc.demosCount) : 0,
        sprayShots: acc.sprayShots,
        sprayAccuracy: acc.demosCount ? round1(acc.sprayAccuracySum / acc.demosCount) : 0,
        counterStrafePct: acc.demosCount ? round1(acc.counterStrafePctSum / acc.demosCount) : 0,
        avgCrosshairPlacementDeg: acc.crosshairDegCount ? round1(acc.crosshairDegSum / acc.crosshairDegCount) : null,
      },
      utility: {
        flashesThrown: acc.flashesThrown,
        smokesThrown: acc.smokesThrown,
        molotovsThrown: acc.molotovsThrown,
        heThrown: acc.heThrown,
        flashAssists: acc.flashAssists,
        enemiesFlashed: acc.enemiesFlashed,
        enemiesFlashedPct: acc.flashesThrown ? round1((100 * acc.enemiesFlashed) / acc.flashesThrown) : 0,
        friendsFlashed: acc.friendsFlashed,
        avgBlindTimeSec: acc.demosCount ? round1(acc.avgBlindTimeSecSum / acc.demosCount) : 0,
        avgHeDamage: acc.demosCount ? round1(acc.avgHeDamageSum / acc.demosCount) : 0,
        avgHeTeamDamage: acc.demosCount ? round1(acc.avgHeTeamDamageSum / acc.demosCount) : 0,
      },
      history: acc.history.sort((a, b) => a.addedAt.localeCompare(b.addedAt)),
    }))
    .sort((a, b) => b.avgOverallScore - a.avgOverallScore);
}
