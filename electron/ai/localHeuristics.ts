import * as fs from 'fs';
import * as path from 'path';
import { DemoRecord, DemoSummary, BuyType, RoundTempo, RoundStance, RoundSummary, RoundSideSummary, PlayerAggregate } from '../storage/types';

export interface PlayerMovementProfile {
  steamId: string;
  name: string;
  topAreas: { area: string; count: number }[];
  avgAdr: number;
  entryRate: number;
  clutchRate: number;
  kills: number;
  deaths: number;
}

export interface TeamTendencyStats {
  tendencyByBuyType: Record<BuyType, { count: number; winRate: number }>;
  tendencyByTempo: Record<RoundTempo, { count: number; winRate: number }>;
  tendencyByStance: Record<RoundStance, { count: number; winRate: number }>;
  topRecurringPatterns: { pattern: string; count: number; winRate: number }[];
  // Mesma informação de topRecurringPatterns, mas estruturada (map + side +
  // buyType/tempo/stance/site em vez de uma string formatada) e SEM slice de
  // top-10 — usado pelo matchupEngine.ts pra cruzar dois slots por padrão
  // exato, não só pelos mais frequentes. Ver PatternKey/PatternStat abaixo.
  detailedPatterns: PatternStat[];
  playerMovementProfile: PlayerMovementProfile[];
}

export interface PatternKey {
  map: string;
  side: 'ct' | 't'; // lado de quem EXECUTOU o padrão (buyType/tempo/stance são sempre do executor)
  buyType: BuyType;
  tempo: RoundTempo;
  stance: RoundStance;
  site?: 'A' | 'B' | 'mid' | 'unknown';
}

export interface PatternStat {
  key: PatternKey;
  count: number;
  winRate: number; // win rate de quem executou o padrão
}

export interface ConsolidatedSlotStats {
  demosAnalyzed: number;
  roundsAnalyzed: number;
  demosPendingRoster: string[];
  demosLowCalibrationSample: string[];
  siteHitDistribution: Record<string, number>;
  myTeam: TeamTendencyStats;
  opponent: TeamTendencyStats;
}

const BUY_TYPES: BuyType[] = ['eco', 'force', 'semi', 'full', 'unknown'];
const TEMPOS: RoundTempo[] = ['rush', 'slow', 'default', 'split', 'unknown'];
const STANCES: RoundStance[] = ['aggressive', 'passive', 'passive-aggressive', 'unknown'];

function emptyTendencyMap<K extends string>(keys: K[]): Record<K, { count: number; winRate: number }> {
  const out = {} as Record<K, { count: number; winRate: number }>;
  for (const k of keys) out[k] = { count: 0, winRate: 0 };
  return out;
}

interface TeamAccumulator {
  buyWins: Record<BuyType, number>;
  tempoWins: Record<RoundTempo, number>;
  stanceWins: Record<RoundStance, number>;
  tendencyByBuyType: Record<BuyType, { count: number; winRate: number }>;
  tendencyByTempo: Record<RoundTempo, { count: number; winRate: number }>;
  tendencyByStance: Record<RoundStance, { count: number; winRate: number }>;
  patternCounts: Map<string, { count: number; wins: number }>;
  detailedPatternCounts: Map<string, { key: PatternKey; count: number; wins: number }>;
  playerMap: Map<
    string,
    { name: string; areas: Map<string, number>; adrSum: number; adrN: number; entryA: number; entryS: number; cW: number; cL: number; kills: number; deaths: number }
  >;
}

function createAccumulator(): TeamAccumulator {
  return {
    buyWins: { eco: 0, force: 0, semi: 0, full: 0, unknown: 0 },
    tempoWins: { rush: 0, slow: 0, default: 0, split: 0, unknown: 0 },
    stanceWins: { aggressive: 0, passive: 0, 'passive-aggressive': 0, unknown: 0 },
    tendencyByBuyType: emptyTendencyMap(BUY_TYPES),
    tendencyByTempo: emptyTendencyMap(TEMPOS),
    tendencyByStance: emptyTendencyMap(STANCES),
    patternCounts: new Map(),
    detailedPatternCounts: new Map(),
    playerMap: new Map(),
  };
}

function addRound(
  acc: TeamAccumulator,
  sideData: RoundSideSummary,
  won: boolean,
  site: 'A' | 'B' | 'mid' | 'unknown' | undefined,
  map: string,
  side: 'ct' | 't'
) {
  acc.tendencyByBuyType[sideData.buyType].count++;
  acc.tendencyByTempo[sideData.tempo].count++;
  acc.tendencyByStance[sideData.stance].count++;
  if (won) {
    acc.buyWins[sideData.buyType]++;
    acc.tempoWins[sideData.tempo]++;
    acc.stanceWins[sideData.stance]++;
  }
  const patternKey = `${sideData.buyType}/${sideData.tempo}/${sideData.stance}/${site ?? 'unknown'}`;
  const entry = acc.patternCounts.get(patternKey) ?? { count: 0, wins: 0 };
  entry.count++;
  if (won) entry.wins++;
  acc.patternCounts.set(patternKey, entry);

  const detailedKey: PatternKey = { map, side, buyType: sideData.buyType, tempo: sideData.tempo, stance: sideData.stance, site };
  const detailedMapKey = `${map}|${side}|${sideData.buyType}|${sideData.tempo}|${sideData.stance}|${site ?? 'unknown'}`;
  const detailedEntry = acc.detailedPatternCounts.get(detailedMapKey) ?? { key: detailedKey, count: 0, wins: 0 };
  detailedEntry.count++;
  if (won) detailedEntry.wins++;
  acc.detailedPatternCounts.set(detailedMapKey, detailedEntry);
}

function addPlayer(acc: TeamAccumulator, player: PlayerAggregate) {
  const p = acc.playerMap.get(player.steamId) ?? {
    name: player.name,
    areas: new Map<string, number>(),
    adrSum: 0,
    adrN: 0,
    entryA: 0,
    entryS: 0,
    cW: 0,
    cL: 0,
    kills: 0,
    deaths: 0,
  };
  p.adrSum += player.adr;
  p.adrN++;
  p.entryA += player.entryAttempts;
  p.entryS += player.entrySuccess;
  p.cW += player.clutchesWon;
  p.cL += player.clutchesLost;
  p.kills += player.kills;
  p.deaths += player.deaths;
  for (const area of player.favoriteAreas) {
    p.areas.set(area.area, (p.areas.get(area.area) ?? 0) + area.count);
  }
  acc.playerMap.set(player.steamId, p);
}

function finishAccumulator(acc: TeamAccumulator): TeamTendencyStats {
  for (const buy of BUY_TYPES) {
    acc.tendencyByBuyType[buy].winRate = acc.tendencyByBuyType[buy].count
      ? acc.buyWins[buy] / acc.tendencyByBuyType[buy].count
      : 0;
  }
  for (const t of TEMPOS) {
    acc.tendencyByTempo[t].winRate = acc.tendencyByTempo[t].count ? acc.tempoWins[t] / acc.tendencyByTempo[t].count : 0;
  }
  for (const s of STANCES) {
    acc.tendencyByStance[s].winRate = acc.tendencyByStance[s].count ? acc.stanceWins[s] / acc.tendencyByStance[s].count : 0;
  }

  const topRecurringPatterns = Array.from(acc.patternCounts.entries())
    .map(([pattern, v]) => ({ pattern, count: v.count, winRate: v.count ? v.wins / v.count : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const detailedPatterns: PatternStat[] = Array.from(acc.detailedPatternCounts.values()).map((v) => ({
    key: v.key,
    count: v.count,
    winRate: v.count ? v.wins / v.count : 0,
  }));

  const playerMovementProfile = Array.from(acc.playerMap.entries()).map(([steamId, p]) => ({
    steamId,
    name: p.name,
    topAreas: Array.from(p.areas.entries())
      .map(([area, count]) => ({ area, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    avgAdr: p.adrN ? Math.round(p.adrSum / p.adrN) : 0,
    entryRate: p.entryA ? p.entryS / p.entryA : 0,
    clutchRate: p.cW + p.cL ? p.cW / (p.cW + p.cL) : 0,
    kills: p.kills,
    deaths: p.deaths,
  }));

  return {
    tendencyByBuyType: acc.tendencyByBuyType,
    tendencyByTempo: acc.tendencyByTempo,
    tendencyByStance: acc.tendencyByStance,
    topRecurringPatterns,
    detailedPatterns,
    playerMovementProfile,
  };
}

function resolveMySideForRound(round: RoundSummary, myNames: Set<string>): 'ct' | 't' | null {
  const rows = round.loadout && round.loadout.length > 0 ? round.loadout : round.keyPositions;
  const votes = { ct: 0, t: 0 };
  for (const row of rows ?? []) {
    if (myNames.has(row.player)) votes[row.side]++;
  }
  if (votes.ct === 0 && votes.t === 0) return null;
  return votes.ct >= votes.t ? 'ct' : 't';
}

// Determina vitória/derrota do nosso time numa demo contando, por rodada, de
// que lado nosso roster estava (o lado pode trocar no intervalo) — não dá
// pra usar summary.finalScore direto porque "team"/"opponent" ali reflete
// só quem começou CT/T na rodada 1, sem relação com o roster marcado.
export function resolveDemoOutcome(
  summary: DemoSummary,
  myTeamSteamIds: string[] | undefined
): 'win' | 'loss' | null {
  if (!myTeamSteamIds || myTeamSteamIds.length === 0) return null;
  const myIdSet = new Set(myTeamSteamIds);
  const myNames = new Set(
    summary.playerAggregates.filter((p) => myIdSet.has(p.steamId)).map((p) => p.name)
  );

  let myWins = 0;
  let oppWins = 0;
  for (const round of summary.rounds) {
    const mySide = resolveMySideForRound(round, myNames);
    if (!mySide) continue;
    if (round.winner === mySide) myWins++;
    else oppWins++;
  }
  if (myWins === oppWins) return null;
  return myWins > oppWins ? 'win' : 'loss';
}

export function consolidateSlot(slotFolder: string, demos: DemoRecord[]): ConsolidatedSlotStats {
  const siteHitDistribution: Record<string, number> = {};
  const demosPendingRoster: string[] = [];
  const demosLowCalibrationSample: string[] = [];
  const myAcc = createAccumulator();
  const oppAcc = createAccumulator();

  let roundsAnalyzed = 0;

  for (const demo of demos) {
    const summaryFile = path.join(slotFolder, 'demos', demo.id, 'summary.json');
    if (!fs.existsSync(summaryFile)) continue;
    const summary: DemoSummary = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));

    const myTeamSteamIds = demo.myTeamSteamIds;
    if (!myTeamSteamIds || myTeamSteamIds.length === 0) {
      demosPendingRoster.push(demo.fileName);
      continue;
    }
    if (summary.calibration?.tempoStanceThresholdSource === 'default') {
      demosLowCalibrationSample.push(demo.fileName);
    }
    const myIdSet = new Set(myTeamSteamIds);
    const myNames = new Set(
      summary.playerAggregates.filter((p) => myIdSet.has(p.steamId)).map((p) => p.name)
    );

    for (const round of summary.rounds) {
      const mySide = resolveMySideForRound(round, myNames);
      if (!mySide) continue;
      const oppSide = mySide === 'ct' ? 't' : 'ct';

      roundsAnalyzed++;
      if (round.siteHit) {
        siteHitDistribution[round.siteHit] = (siteHitDistribution[round.siteHit] ?? 0) + 1;
      }

      addRound(myAcc, round[mySide], round.winner === mySide, round.siteHit, summary.map, mySide);
      addRound(oppAcc, round[oppSide], round.winner === oppSide, round.siteHit, summary.map, oppSide);
    }

    for (const player of summary.playerAggregates) {
      addPlayer(myIdSet.has(player.steamId) ? myAcc : oppAcc, player);
    }
  }

  return {
    demosAnalyzed: demos.length,
    roundsAnalyzed,
    demosPendingRoster,
    demosLowCalibrationSample,
    siteHitDistribution,
    myTeam: finishAccumulator(myAcc),
    opponent: finishAccumulator(oppAcc),
  };
}
