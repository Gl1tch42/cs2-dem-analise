import * as fs from 'fs';
import * as path from 'path';
import { DemoRecord, DemoSummary, BuyType, RoundTempo, RoundStance, RoundSummary } from '../storage/types';

/**
 * Isto é o "algoritmo leve" pedido: roda 100% local, sem IA, e comprime dezenas
 * de demos (potencialmente milhares de rounds) numa única estrutura pequena.
 * É ESSA estrutura — não as demos cruas — que vai no prompt da IA.
 *
 * Toda demo tem dois lados (ct/t) e o time troca de lado no intervalo, então "o lado
 * do time do slot" muda round a round. Por isso as tendências só entram na consolidação
 * quando o usuário marcou `demo.myTeamSteamIds` (ver slotManager.setDemoRoster) — sem
 * isso não tem como saber qual dos dois lados é o time do slot e qual é o adversário, e
 * misturar os dois deixa a análise genérica (e às vezes credita ao time errado).
 */
export interface ConsolidatedSlotStats {
  demosAnalyzed: number;
  roundsAnalyzed: number;
  /** Nomes de arquivo das demos que entraram em demosAnalyzed mas ficaram de fora das
   *  tendências táticas porque ninguém marcou "meu time" nelas ainda. */
  demosPendingRoster: string[];
  tendencyByBuyType: Record<BuyType, { count: number; winRate: number }>;
  tendencyByTempo: Record<RoundTempo, { count: number; winRate: number }>;
  tendencyByStance: Record<RoundStance, { count: number; winRate: number }>;
  siteHitDistribution: Record<string, number>;
  /** Áreas do mapa mais visitadas por jogador do time do slot, cruzando todas as demos. */
  playerMovementProfile: {
    steamId: string;
    name: string;
    topAreas: { area: string; count: number }[];
    avgAdr: number;
    entryRate: number; // entrySuccess / entryAttempts
    clutchRate: number;
    kills: number;
    deaths: number;
  }[];
  /** As combinações (buyType + tempo + stance + site) mais repetidas do time do slot. */
  topRecurringPatterns: { pattern: string; count: number; winRate: number }[];
}

function emptyTendencyMap<K extends string>(keys: K[]): Record<K, { count: number; winRate: number }> {
  const out = {} as Record<K, { count: number; winRate: number }>;
  for (const k of keys) out[k] = { count: 0, winRate: 0 };
  return out;
}

/**
 * Descobre de qual lado (ct/t) o time do slot jogou NESTE round específico, cruzando
 * os steamIds marcados como "meu time" com os nomes que aparecem no loadout do round
 * (round-level só tem nome, não steamId — por isso o mapa nameToSteamId).
 */
function resolveMySideForRound(round: RoundSummary, myNames: Set<string>): 'ct' | 't' | null {
  const rows = round.loadout && round.loadout.length > 0 ? round.loadout : round.keyPositions;
  const votes = { ct: 0, t: 0 };
  for (const row of rows ?? []) {
    if (myNames.has(row.player)) votes[row.side]++;
  }
  if (votes.ct === 0 && votes.t === 0) return null;
  return votes.ct >= votes.t ? 'ct' : 't';
}

export function consolidateSlot(slotFolder: string, demos: DemoRecord[]): ConsolidatedSlotStats {
  const buyTypes: BuyType[] = ['eco', 'force', 'semi', 'full', 'unknown'];
  const tempos: RoundTempo[] = ['rush', 'slow', 'default', 'split', 'unknown'];
  const stances: RoundStance[] = ['aggressive', 'passive', 'passive-aggressive', 'unknown'];

  const buyWins: Record<BuyType, number> = { eco: 0, force: 0, semi: 0, full: 0, unknown: 0 };
  const tempoWins: Record<RoundTempo, number> = { rush: 0, slow: 0, default: 0, split: 0, unknown: 0 };
  const stanceWins: Record<RoundStance, number> = { aggressive: 0, passive: 0, 'passive-aggressive': 0, unknown: 0 };
  const tendencyByBuyType = emptyTendencyMap(buyTypes);
  const tendencyByTempo = emptyTendencyMap(tempos);
  const tendencyByStance = emptyTendencyMap(stances);
  const siteHitDistribution: Record<string, number> = {};
  const patternCounts = new Map<string, { count: number; wins: number }>();
  const demosPendingRoster: string[] = [];

  const playerMap = new Map<
    string,
    { name: string; areas: Map<string, number>; adrSum: number; adrN: number; entryA: number; entryS: number; cW: number; cL: number; kills: number; deaths: number }
  >();

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
    const myIdSet = new Set(myTeamSteamIds);
    const myNames = new Set(
      summary.playerAggregates.filter((p) => myIdSet.has(p.steamId)).map((p) => p.name)
    );

    for (const round of summary.rounds) {
      const mySide = resolveMySideForRound(round, myNames);
      if (!mySide) continue; // não deu pra identificar o time do slot neste round específico

      roundsAnalyzed++;
      const mySideData = round[mySide];
      const won = round.winner === mySide;

      if (round.siteHit) {
        siteHitDistribution[round.siteHit] = (siteHitDistribution[round.siteHit] ?? 0) + 1;
      }

      tendencyByBuyType[mySideData.buyType].count++;
      tendencyByTempo[mySideData.tempo].count++;
      tendencyByStance[mySideData.stance].count++;
      if (won) {
        buyWins[mySideData.buyType]++;
        tempoWins[mySideData.tempo]++;
        stanceWins[mySideData.stance]++;
      }

      const patternKey = `${mySideData.buyType}/${mySideData.tempo}/${mySideData.stance}/${round.siteHit ?? 'unknown'}`;
      const entry = patternCounts.get(patternKey) ?? { count: 0, wins: 0 };
      entry.count++;
      if (won) entry.wins++;
      patternCounts.set(patternKey, entry);
    }

    for (const player of summary.playerAggregates) {
      if (!myIdSet.has(player.steamId)) continue; // só o time do slot entra no perfil de jogadores
      const p = playerMap.get(player.steamId) ?? {
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
      playerMap.set(player.steamId, p);
    }
  }

  for (const buy of buyTypes) {
    tendencyByBuyType[buy].winRate = tendencyByBuyType[buy].count ? buyWins[buy] / tendencyByBuyType[buy].count : 0;
  }
  for (const t of tempos) {
    tendencyByTempo[t].winRate = tendencyByTempo[t].count ? tempoWins[t] / tendencyByTempo[t].count : 0;
  }
  for (const s of stances) {
    tendencyByStance[s].winRate = tendencyByStance[s].count ? stanceWins[s] / tendencyByStance[s].count : 0;
  }

  const topRecurringPatterns = Array.from(patternCounts.entries())
    .map(([pattern, v]) => ({ pattern, count: v.count, winRate: v.count ? v.wins / v.count : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const playerMovementProfile = Array.from(playerMap.entries()).map(([steamId, p]) => ({
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
    demosAnalyzed: demos.length,
    roundsAnalyzed,
    demosPendingRoster,
    tendencyByBuyType,
    tendencyByTempo,
    tendencyByStance,
    siteHitDistribution,
    playerMovementProfile,
    topRecurringPatterns,
  };
}
