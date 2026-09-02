"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.consolidateSlot = exports.resolveDemoOutcome = exports.openingManAdvantageBucket = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function openingManAdvantageBucket(round, side) {
    const raw = round.deaths?.[0]?.manAdvantage;
    if (raw === undefined)
        return 'unknown';
    const fromSide = side === 'ct' ? raw : -raw;
    if (fromSide === 0)
        return 'even';
    return fromSide > 0 ? 'advantage' : 'disadvantage';
}
exports.openingManAdvantageBucket = openingManAdvantageBucket;
const MAN_ADVANTAGE_BUCKETS = ['advantage', 'even', 'disadvantage', 'unknown'];
const BUY_TYPES = ['eco', 'force', 'semi', 'full', 'unknown'];
const TEMPOS = ['rush', 'slow', 'default', 'split', 'unknown'];
const STANCES = ['aggressive', 'passive', 'passive-aggressive', 'unknown'];
function emptyTendencyMap(keys) {
    const out = {};
    for (const k of keys)
        out[k] = { count: 0, winRate: 0 };
    return out;
}
function createAccumulator() {
    return {
        buyWins: { eco: 0, force: 0, semi: 0, full: 0, unknown: 0 },
        tempoWins: { rush: 0, slow: 0, default: 0, split: 0, unknown: 0 },
        stanceWins: { aggressive: 0, passive: 0, 'passive-aggressive': 0, unknown: 0 },
        manAdvantageWins: { advantage: 0, even: 0, disadvantage: 0, unknown: 0 },
        tendencyByBuyType: emptyTendencyMap(BUY_TYPES),
        tendencyByTempo: emptyTendencyMap(TEMPOS),
        tendencyByStance: emptyTendencyMap(STANCES),
        tendencyByManAdvantage: emptyTendencyMap(MAN_ADVANTAGE_BUCKETS),
        patternCounts: new Map(),
        detailedPatternCounts: new Map(),
        playerMap: new Map(),
    };
}
function addRound(acc, sideData, won, site, map, side, manAdvantageBucket) {
    acc.tendencyByBuyType[sideData.buyType].count++;
    acc.tendencyByTempo[sideData.tempo].count++;
    acc.tendencyByStance[sideData.stance].count++;
    acc.tendencyByManAdvantage[manAdvantageBucket].count++;
    if (won) {
        acc.buyWins[sideData.buyType]++;
        acc.tempoWins[sideData.tempo]++;
        acc.stanceWins[sideData.stance]++;
        acc.manAdvantageWins[manAdvantageBucket]++;
    }
    const patternKey = `${sideData.buyType}/${sideData.tempo}/${sideData.stance}/${site ?? 'unknown'}`;
    const entry = acc.patternCounts.get(patternKey) ?? { count: 0, wins: 0 };
    entry.count++;
    if (won)
        entry.wins++;
    acc.patternCounts.set(patternKey, entry);
    const detailedKey = { map, side, buyType: sideData.buyType, tempo: sideData.tempo, stance: sideData.stance, site };
    const detailedMapKey = `${map}|${side}|${sideData.buyType}|${sideData.tempo}|${sideData.stance}|${site ?? 'unknown'}`;
    const detailedEntry = acc.detailedPatternCounts.get(detailedMapKey) ?? { key: detailedKey, count: 0, wins: 0 };
    detailedEntry.count++;
    if (won)
        detailedEntry.wins++;
    acc.detailedPatternCounts.set(detailedMapKey, detailedEntry);
}
function addPlayer(acc, player) {
    const p = acc.playerMap.get(player.steamId) ?? {
        name: player.name,
        areas: new Map(),
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
function finishAccumulator(acc) {
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
    for (const m of MAN_ADVANTAGE_BUCKETS) {
        acc.tendencyByManAdvantage[m].winRate = acc.tendencyByManAdvantage[m].count
            ? acc.manAdvantageWins[m] / acc.tendencyByManAdvantage[m].count
            : 0;
    }
    const topRecurringPatterns = Array.from(acc.patternCounts.entries())
        .map(([pattern, v]) => ({ pattern, count: v.count, winRate: v.count ? v.wins / v.count : 0 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    const detailedPatterns = Array.from(acc.detailedPatternCounts.values()).map((v) => ({
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
        tendencyByManAdvantage: acc.tendencyByManAdvantage,
        topRecurringPatterns,
        detailedPatterns,
        playerMovementProfile,
    };
}
// A06: prefere casar por steamId (confiável — não colide entre jogadores/times
// nem quebra em demos anonimizadas) e só cai pra nome quando a linha não tem
// steamId (demo parseada antes desse campo existir).
function resolveMySideForRound(round, myIdSet, myNames) {
    const rows = round.loadout && round.loadout.length > 0 ? round.loadout : round.keyPositions;
    const votes = { ct: 0, t: 0 };
    for (const row of rows ?? []) {
        const matches = row.steamId ? myIdSet.has(row.steamId) : myNames.has(row.player);
        if (matches)
            votes[row.side]++;
    }
    if (votes.ct === 0 && votes.t === 0)
        return null;
    return votes.ct >= votes.t ? 'ct' : 't';
}
// Determina vitória/derrota do nosso time numa demo contando, por rodada, de
// que lado nosso roster estava (o lado pode trocar no intervalo) — não dá
// pra usar summary.finalScore direto porque "team"/"opponent" ali reflete
// só quem começou CT/T na rodada 1, sem relação com o roster marcado.
function resolveDemoOutcome(summary, myTeamSteamIds) {
    if (!myTeamSteamIds || myTeamSteamIds.length === 0)
        return null;
    const myIdSet = new Set(myTeamSteamIds);
    const myNames = new Set(summary.playerAggregates.filter((p) => myIdSet.has(p.steamId)).map((p) => p.name));
    let myWins = 0;
    let oppWins = 0;
    for (const round of summary.rounds) {
        const mySide = resolveMySideForRound(round, myIdSet, myNames);
        if (!mySide)
            continue;
        if (round.winner === mySide)
            myWins++;
        else
            oppWins++;
    }
    if (myWins === oppWins)
        return null;
    return myWins > oppWins ? 'win' : 'loss';
}
exports.resolveDemoOutcome = resolveDemoOutcome;
function consolidateSlot(slotFolder, demos) {
    const siteHitDistribution = {};
    const demosPendingRoster = [];
    const demosLowCalibrationSample = [];
    const myAcc = createAccumulator();
    const oppAcc = createAccumulator();
    let roundsAnalyzed = 0;
    for (const demo of demos) {
        const summaryFile = path.join(slotFolder, 'demos', demo.id, 'summary.json');
        if (!fs.existsSync(summaryFile))
            continue;
        const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
        const myTeamSteamIds = demo.myTeamSteamIds;
        if (!myTeamSteamIds || myTeamSteamIds.length === 0) {
            demosPendingRoster.push(demo.fileName);
            continue;
        }
        if (summary.calibration?.tempoStanceThresholdSource === 'default') {
            demosLowCalibrationSample.push(demo.fileName);
        }
        const myIdSet = new Set(myTeamSteamIds);
        const myNames = new Set(summary.playerAggregates.filter((p) => myIdSet.has(p.steamId)).map((p) => p.name));
        for (const round of summary.rounds) {
            const mySide = resolveMySideForRound(round, myIdSet, myNames);
            if (!mySide)
                continue;
            const oppSide = mySide === 'ct' ? 't' : 'ct';
            roundsAnalyzed++;
            if (round.siteHit) {
                siteHitDistribution[round.siteHit] = (siteHitDistribution[round.siteHit] ?? 0) + 1;
            }
            addRound(myAcc, round[mySide], round.winner === mySide, round.siteHit, summary.map, mySide, openingManAdvantageBucket(round, mySide));
            addRound(oppAcc, round[oppSide], round.winner === oppSide, round.siteHit, summary.map, oppSide, openingManAdvantageBucket(round, oppSide));
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
exports.consolidateSlot = consolidateSlot;
//# sourceMappingURL=localHeuristics.js.map