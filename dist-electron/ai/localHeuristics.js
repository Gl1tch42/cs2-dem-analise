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
exports.consolidateSlot = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function emptyTendencyMap(keys) {
    const out = {};
    for (const k of keys)
        out[k] = { count: 0, winRate: 0 };
    return out;
}
/**
 * Descobre de qual lado (ct/t) o time do slot jogou NESTE round específico, cruzando
 * os steamIds marcados como "meu time" com os nomes que aparecem no loadout do round
 * (round-level só tem nome, não steamId — por isso o mapa nameToSteamId).
 */
function resolveMySideForRound(round, myNames) {
    const rows = round.loadout && round.loadout.length > 0 ? round.loadout : round.keyPositions;
    const votes = { ct: 0, t: 0 };
    for (const row of rows ?? []) {
        if (myNames.has(row.player))
            votes[row.side]++;
    }
    if (votes.ct === 0 && votes.t === 0)
        return null;
    return votes.ct >= votes.t ? 'ct' : 't';
}
function consolidateSlot(slotFolder, demos) {
    const buyTypes = ['eco', 'force', 'semi', 'full', 'unknown'];
    const tempos = ['rush', 'slow', 'default', 'split', 'unknown'];
    const stances = ['aggressive', 'passive', 'passive-aggressive', 'unknown'];
    const buyWins = { eco: 0, force: 0, semi: 0, full: 0, unknown: 0 };
    const tempoWins = { rush: 0, slow: 0, default: 0, split: 0, unknown: 0 };
    const stanceWins = { aggressive: 0, passive: 0, 'passive-aggressive': 0, unknown: 0 };
    const tendencyByBuyType = emptyTendencyMap(buyTypes);
    const tendencyByTempo = emptyTendencyMap(tempos);
    const tendencyByStance = emptyTendencyMap(stances);
    const siteHitDistribution = {};
    const patternCounts = new Map();
    const demosPendingRoster = [];
    const playerMap = new Map();
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
        const myIdSet = new Set(myTeamSteamIds);
        const myNames = new Set(summary.playerAggregates.filter((p) => myIdSet.has(p.steamId)).map((p) => p.name));
        for (const round of summary.rounds) {
            const mySide = resolveMySideForRound(round, myNames);
            if (!mySide)
                continue; // não deu pra identificar o time do slot neste round específico
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
            if (won)
                entry.wins++;
            patternCounts.set(patternKey, entry);
        }
        for (const player of summary.playerAggregates) {
            if (!myIdSet.has(player.steamId))
                continue; // só o time do slot entra no perfil de jogadores
            const p = playerMap.get(player.steamId) ?? {
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
exports.consolidateSlot = consolidateSlot;
//# sourceMappingURL=localHeuristics.js.map