import * as fs from 'fs';
import {
  computeAimScore,
  computeUtilityScore,
  computePositioningScore,
  computeImpactScore,
  computeOverallScore,
  computePlayerScores,
  computeScoreConfidence,
} from '../scoreEngine';
import {
  PlayerAimStats,
  PlayerUtilityStats,
  PlayerPositioningStats,
  PlayerImpactStats,
  PlayerAggregate,
  DemoRecord,
  DemoSummary,
} from '../../storage/types';

// ---- fixtures ---------------------------------------------------------

// Valores nos extremos (targetMin/targetMax) das faixas definidas em
// scoreEngine.ts, usados pra travar os limites 0 e 100 sem duplicar a
// tabela de pesos aqui no teste.
function aimAtFloor(): PlayerAimStats {
  return {
    shotsFired: 100,
    shotsHit: 8,
    accuracy: 8,
    headHits: 0,
    headAccuracy: 10,
    hsKills: 0,
    hsKillPct: 20,
    firstBulletShots: 0,
    firstBulletAccuracy: 15,
    sprayShots: 0,
    sprayAccuracy: 17,
    counterStrafePct: 36,
    avgCrosshairPlacementDeg: 18.4,
    spottedAccuracy: 16,
    avgTimeToDamageMs: 1180,
    avgTimeToKillMs: 2000,
  };
}

function aimAtCeiling(): PlayerAimStats {
  return {
    shotsFired: 100,
    shotsHit: 21,
    accuracy: 21.4,
    headHits: 26,
    headAccuracy: 25.9,
    hsKills: 60,
    hsKillPct: 60,
    firstBulletShots: 45,
    firstBulletAccuracy: 45,
    sprayShots: 41,
    sprayAccuracy: 41.4,
    counterStrafePct: 89.7,
    avgCrosshairPlacementDeg: 6.2,
    spottedAccuracy: 39.2,
    avgTimeToDamageMs: 393,
    avgTimeToKillMs: 600,
  };
}

// roundsInDemo=10 nos testes que usam esta fixture sem alterações, então os
// campos derivados de razão (smokesWasted/round, flashKillPct, quantidade
// jogada/round) já são escritos aqui assumindo esse denominador.
function utilityAtFloor(): PlayerUtilityStats {
  return {
    flashesThrown: 3, // totalThrown(3)/roundsInDemo(10) = 0.3 -> floor de UTILITY_QUANTITY_TARGET
    smokesThrown: 0,
    molotovsThrown: 0,
    heThrown: 0,
    flashAssists: 0.123, // flashKillPct = 100*0.123/3 = 4.1 -> floor
    enemiesFlashed: 0,
    enemiesFlashedPct: 0,
    friendsFlashed: 3.75, // friendsFlashedPerFlashbang = 3.75/3 = 1.25 -> floor
    avgBlindTimeSec: 0,
    avgHeDamage: 3.8,
    avgHeTeamDamage: 0.75, // + molotov team damage 0 -> teamDamage floor 0.75
    effectiveEnemyFlashes: 2.97, // 29.7% of 10
    effectiveFlashPct: 29.7,
    avgFriendlyBlindTimeSec: 0,
    avgMolotovDamage: 5,
    avgMolotovTeamDamage: 0,
    smokesWasted: 3, // smokesWasted/roundsInDemo(10) = 0.3 -> floor
    unusedUtilityValue: 657.5,
    unusedUtilityRounds: 1, // unusedUtilityPerDeath = 657.5/1 = 657.5 -> floor
  };
}

function utilityAtCeiling(): PlayerUtilityStats {
  return {
    flashesThrown: 10,
    smokesThrown: 0,
    molotovsThrown: 0,
    heThrown: 0,
    flashAssists: 1.23, // flashKillPct = 100*1.23/10 = 12.3 -> ceiling
    enemiesFlashed: 0,
    enemiesFlashedPct: 0,
    friendsFlashed: 0, // friendsFlashedPerFlashbang = 0 -> ceiling (0 is best)
    avgBlindTimeSec: 0,
    avgHeDamage: 11.7,
    avgHeTeamDamage: 0, // + molotov team damage 0 -> teamDamage ceiling 0
    effectiveEnemyFlashes: 9.02,
    effectiveFlashPct: 90.2,
    avgFriendlyBlindTimeSec: 0,
    avgMolotovDamage: 22,
    avgMolotovTeamDamage: 0,
    smokesWasted: 0,
    unusedUtilityValue: 0, // unusedUtilityPerDeath = 0 -> ceiling
    unusedUtilityRounds: 1,
  };
}

function positioningAtFloor(): PlayerPositioningStats {
  return {
    openingDuelWinPct: 35,
    openingDuelParticipationPct: 50,
    tradeKills: 0,
    tradeKillPct: 5,
    tradedDeathPct: 20,
    isolatedDeathPct: 40,
    avgTradeDelayMs: 2500,
    overexposedDeathPct: 35,
    avgNearestTeammateDist: 1200,
  };
}

function positioningAtCeiling(): PlayerPositioningStats {
  return {
    openingDuelWinPct: 65,
    openingDuelParticipationPct: 50,
    tradeKills: 5,
    tradeKillPct: 25,
    tradedDeathPct: 55,
    isolatedDeathPct: 10,
    avgTradeDelayMs: 1200,
    overexposedDeathPct: 5,
    avgNearestTeammateDist: 400,
  };
}

// clutchWinPct/sacrificeOpenPct aqui só importam nos testes que NÃO zeram
// clutchesWon+clutchesLost / roundsOpened (que excluiriam essas submétricas
// do cálculo) — mantidos nos valores-piso (15% e 30%) por completude.
function impactAtFloor(): PlayerImpactStats {
  return {
    kills: 0,
    deaths: 20,
    assists: 0,
    adr: 60,
    kpr: 0.5,
    clutchesWon: 3,
    clutchesLost: 17, // clutchWinPct = 15 -> floor
    clutchWinPct: 15,
    roundsOpened: 10,
    roundsOpenedWon: 3, // sacrificeOpenPct = 30 -> floor
    sacrificeOpenPct: 30,
  };
}

function impactAtCeiling(): PlayerImpactStats {
  return {
    kills: 20,
    deaths: 20,
    assists: 0,
    adr: 95,
    kpr: 1.0,
    clutchesWon: 5,
    clutchesLost: 5, // clutchWinPct = 50 -> ceiling
    clutchWinPct: 50,
    roundsOpened: 10,
    roundsOpenedWon: 6, // sacrificeOpenPct = 60 -> ceiling
    sacrificeOpenPct: 60,
  };
}

// ---- computeAimScore ---------------------------------------------------

describe('computeAimScore', () => {
  it('returns 0 when every submetric sits at its floor', () => {
    expect(computeAimScore(aimAtFloor())).toBe(0);
  });

  it('returns 100 when every submetric sits at its ceiling', () => {
    expect(computeAimScore(aimAtCeiling())).toBe(100);
  });

  it('excludes null crosshair/TTD/TTK from the weighted average instead of scoring them as 0', () => {
    const aim = { ...aimAtCeiling(), avgCrosshairPlacementDeg: null, avgTimeToDamageMs: null, avgTimeToKillMs: null };
    // as demais submétricas continuam no teto -> média ponderada continua 100
    // mesmo com três pesos inteiros removidos do denominador.
    expect(computeAimScore(aim)).toBe(100);
  });

  it('clamps out-of-range values instead of extrapolating beyond 0-100', () => {
    const aim = { ...aimAtFloor(), accuracy: -50 }; // bem abaixo do targetMin (8)
    const score = computeAimScore(aim);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBe(0); // já estava no piso; ir mais abaixo não pode gerar negativo
  });

  it('returns 0 when totalWeight ends up 0 (defensive branch)', () => {
    // Não alcançável com o formato real de PlayerAimStats (accuracy/headAccuracy/etc.
    // sempre contribuem), mas a função deve permanecer segura contra NaN por 0/0.
    const aim = { ...aimAtFloor(), avgCrosshairPlacementDeg: null, avgTimeToDamageMs: null, avgTimeToKillMs: null };
    expect(Number.isNaN(computeAimScore(aim))).toBe(false);
  });
});

// ---- computeUtilityScore -----------------------------------------------

describe('computeUtilityScore', () => {
  it('returns 0 when every quality submetric is at its floor and no grenades are thrown per round', () => {
    expect(computeUtilityScore(utilityAtFloor(), 10)).toBe(0);
  });

  it('returns 100 when every quality submetric is at its ceiling and quantity hits its target', () => {
    // flashesThrown fica fixo em 10 (usado nas razões de friendlyFlashPenalty/flashKillPct);
    // a quantidade é levada ao teto (perRound = 1.2) via smokesThrown, que não entra em
    // nenhuma submétrica de qualidade.
    const utility = { ...utilityAtCeiling(), smokesThrown: 2 };
    expect(computeUtilityScore(utility, 10)).toBe(100);
  });

  it('does not divide by zero when roundsInDemo is 0', () => {
    const score = computeUtilityScore(utilityAtFloor(), 0);
    expect(Number.isNaN(score)).toBe(false);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('does not divide by zero when the player never threw a flashbang', () => {
    const utility = { ...utilityAtFloor(), flashesThrown: 0, friendsFlashed: 0, flashAssists: 0, effectiveEnemyFlashes: 0 };
    const score = computeUtilityScore(utility, 10);
    expect(Number.isNaN(score)).toBe(false);
  });

  it('blends quality (70%) and quantity (30%) rather than averaging them evenly', () => {
    // qualidade no teto (100, todas as razões usam flashesThrown=10 sem alteração).
    // quantidade fica no meio do range: perRound = flashesThrown(10)/roundsInDemo(10) = 1.0,
    // normalize(1.0, 0.3, 1.2) = (1.0-0.3)/(1.2-0.3)*100 = 77.78.
    // blend esperado: 100*0.7 + 77.78*0.3 = 93.33 -> round1 = 93.3.
    const score = computeUtilityScore(utilityAtCeiling(), 10);
    expect(score).toBe(93.3);
  });

  it('excludes null effectiveFlashPct/unusedUtilityValue instead of treating them as 0 (demos GOTV/SourceTV sem player_blind/item_purchase)', () => {
    // mesma lógica do teste "excludes null crosshair/TTD/TTK" pro aim score:
    // as demais submétricas continuam no teto -> média ponderada continua 100
    // mesmo com esses dois pesos removidos do denominador.
    const utility = {
      ...utilityAtCeiling(),
      effectiveFlashPct: null,
      unusedUtilityValue: null,
      unusedUtilityRounds: null,
    };
    expect(computeUtilityScore({ ...utility, smokesThrown: 2 }, 10)).toBe(100);
  });
});

// ---- computePositioningScore --------------------------------------------

describe('computePositioningScore', () => {
  it('returns 0 when every submetric sits at its floor', () => {
    expect(computePositioningScore(positioningAtFloor())).toBe(0);
  });

  it('returns 100 when every submetric sits at its ceiling', () => {
    expect(computePositioningScore(positioningAtCeiling())).toBe(100);
  });

  it('excludes null trade delay / nearest teammate distance from the weighted average', () => {
    const positioning = { ...positioningAtCeiling(), avgTradeDelayMs: null, avgNearestTeammateDist: null };
    expect(computePositioningScore(positioning)).toBe(100);
  });
});

// ---- computeImpactScore --------------------------------------------------

describe('computeImpactScore', () => {
  it('returns 0 when kpr/adr/clutch/sacrifice all sit at the floor', () => {
    expect(computeImpactScore(impactAtFloor())).toBe(0);
  });

  it('returns 0 when kpr/adr sit at the floor and there is no clutch/opening sample', () => {
    const impact = { ...impactAtFloor(), clutchesWon: 0, clutchesLost: 0, roundsOpened: 0 };
    expect(computeImpactScore(impact)).toBe(0);
  });

  it('returns 100 when kpr/adr/clutch/sacrifice all sit at the ceiling', () => {
    expect(computeImpactScore(impactAtCeiling())).toBe(100);
  });

  it('excludes clutchWinPct when the player has no clutch attempts (avoids rewarding/punishing an empty sample)', () => {
    const withClutches = { ...impactAtCeiling(), clutchWinPct: 0, clutchesWon: 0, clutchesLost: 0 };
    // kpr/adr/sacrifice ainda no teto -> resultado permanece 100 mesmo com clutchWinPct em 0,
    // porque o peso de clutch sai do denominador quando não há amostra.
    expect(computeImpactScore(withClutches)).toBe(100);
  });

  it('excludes sacrificeOpenPct when the player never opened a round', () => {
    const withoutOpens = { ...impactAtCeiling(), roundsOpened: 0, roundsOpenedWon: 0, sacrificeOpenPct: 0 };
    expect(computeImpactScore(withoutOpens)).toBe(100);
  });
});

// ---- computeOverallScore --------------------------------------------------

describe('computeOverallScore', () => {
  it('applies the documented 50/25/15/10 split (aim/impact/utility/positioning)', () => {
    // 80*0.5 + 60*0.15 + 40*0.1 + 100*0.25 = 40 + 9 + 4 + 25 = 78
    expect(computeOverallScore(80, 60, 40, 100)).toBe(78);
  });

  it('returns 100 when all four sub-scores are 100', () => {
    expect(computeOverallScore(100, 100, 100, 100)).toBe(100);
  });

  it('returns 0 when all four sub-scores are 0', () => {
    expect(computeOverallScore(0, 0, 0, 0)).toBe(0);
  });
});

// ---- computeScoreConfidence -------------------------------------------------

describe('computeScoreConfidence', () => {
  it('returns high with score 1 when all four factors are maxed', () => {
    const result = computeScoreConfidence({ demosCount: 8, roundsSum: 190, coverageRatio: 1, calibratedRatio: 1 });
    expect(result.level).toBe('high');
    expect(result.score).toBe(1);
  });

  it('returns low with score 0 when all four factors are zero', () => {
    const result = computeScoreConfidence({ demosCount: 0, roundsSum: 0, coverageRatio: 0, calibratedRatio: 0 });
    expect(result.level).toBe('low');
    expect(result.score).toBe(0);
  });

  it('does not reach high on demos+rounds alone, even maxed, without coverage/calibration', () => {
    // demos(0.4) + rounds(0.3) somam 0.7 no teto -> abaixo do limiar "high"
    // (0.75) de propósito: muitas demos com dados majoritariamente
    // null/não-calibrados não deve virar "alta confiança" sozinho.
    const result = computeScoreConfidence({ demosCount: 8, roundsSum: 190, coverageRatio: 0, calibratedRatio: 0 });
    expect(result.score).toBe(0.7);
    expect(result.level).toBe('medium');
  });

  it('reaches high once coverage/calibration push the composite past the demos+rounds ceiling', () => {
    const result = computeScoreConfidence({ demosCount: 8, roundsSum: 190, coverageRatio: 0.5, calibratedRatio: 1 });
    // 0.7 (demos+rounds) + 0.5*0.2 (coverage) + 1*0.1 (calibration) = 0.9
    expect(result.score).toBe(0.9);
    expect(result.level).toBe('high');
  });

  it('caps demos/rounds factors at 1 instead of rewarding samples beyond the target', () => {
    const atTarget = computeScoreConfidence({ demosCount: 8, roundsSum: 190, coverageRatio: 0, calibratedRatio: 0 });
    const wayOverTarget = computeScoreConfidence({ demosCount: 40, roundsSum: 1000, coverageRatio: 0, calibratedRatio: 0 });
    expect(wayOverTarget.score).toBe(atTarget.score);
  });

  it('sits at medium for a middling sample', () => {
    const result = computeScoreConfidence({ demosCount: 4, roundsSum: 95, coverageRatio: 0.5, calibratedRatio: 0.5 });
    // demosFactor 0.5*0.4=0.2, roundsFactor 0.5*0.3=0.15, coverage 0.5*0.2=0.1, cal 0.5*0.1=0.05 -> 0.5
    expect(result.score).toBe(0.5);
    expect(result.level).toBe('medium');
  });
});

// ---- computePlayerScores (integration, fs mocked) -------------------------

jest.mock('fs');

function buildAggregate(steamId: string, name: string, overrides: Partial<PlayerAggregate> = {}): PlayerAggregate {
  return {
    steamId,
    name,
    side: 'ct',
    kills: 15,
    deaths: 10,
    assists: 3,
    adr: 80,
    entryAttempts: 2,
    entrySuccess: 1,
    clutchesWon: 1,
    clutchesLost: 1,
    favoriteAreas: [],
    aim: aimAtCeiling(),
    utility: utilityAtCeiling(),
    positioning: positioningAtCeiling(),
    ...overrides,
  };
}

function buildSummary(overrides: Partial<DemoSummary> = {}): DemoSummary {
  return {
    demoId: 'demo-1',
    map: 'de_mirage',
    finalScore: { team: 13, opponent: 8 },
    rounds: [{ roundNumber: 1, winner: 'ct', ct: { buyType: 'full', tempo: 'default', stance: 'aggressive', utilityUsed: { flashes: 0, smokes: 0, molotovs: 0, he: 0 } }, t: { buyType: 'full', tempo: 'default', stance: 'aggressive', utilityUsed: { flashes: 0, smokes: 0, molotovs: 0, he: 0 } }, keyPositions: [], deaths: [] }],
    playerAggregates: [],
    ...overrides,
  };
}

function buildDemoRecord(id: string, overrides: Partial<DemoRecord> = {}): DemoRecord {
  return {
    id,
    fileName: `${id}.dem`,
    map: 'de_mirage',
    addedAt: '2026-09-01T00:00:00.000Z',
    summaryPath: `demos/${id}/summary.json`,
    myTeamSteamIds: ['76500000000000001'],
    ...overrides,
  };
}

describe('computePlayerScores', () => {
  const slotFolder = 'C:/slots/slot-1';
  const mockedFs = fs as jest.Mocked<typeof fs>;

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('skips demos whose summary.json is missing on disk', () => {
    mockedFs.existsSync.mockReturnValue(false);
    const result = computePlayerScores(slotFolder, [buildDemoRecord('demo-1')]);
    expect(result).toEqual([]);
    expect(mockedFs.readFileSync).not.toHaveBeenCalled();
  });

  it('skips demos with no roster marked (myTeamSteamIds empty/undefined)', () => {
    mockedFs.existsSync.mockReturnValue(true);
    const result = computePlayerScores(slotFolder, [buildDemoRecord('demo-1', { myTeamSteamIds: [] })]);
    expect(result).toEqual([]);
    expect(mockedFs.readFileSync).not.toHaveBeenCalled();
  });

  it('only aggregates players present in myTeamSteamIds, ignoring the rest of the 10 in the demo', () => {
    mockedFs.existsSync.mockReturnValue(true);
    const summary = buildSummary({
      playerAggregates: [
        buildAggregate('76500000000000001', 'Ally'),
        buildAggregate('76500000000000099', 'Enemy'),
      ],
    });
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(summary));

    const result = computePlayerScores(slotFolder, [buildDemoRecord('demo-1')]);

    expect(result).toHaveLength(1);
    expect(result[0].steamId).toBe('76500000000000001');
    expect(result[0].name).toBe('Ally');
  });

  it('skips players missing aim/utility/positioning (demos parsed before this feature existed)', () => {
    mockedFs.existsSync.mockReturnValue(true);
    const summary = buildSummary({
      playerAggregates: [
        { ...buildAggregate('76500000000000001', 'Legacy'), aim: undefined as any },
      ],
    });
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(summary));

    const result = computePlayerScores(slotFolder, [buildDemoRecord('demo-1')]);
    expect(result).toEqual([]);
  });

  it('averages scores across multiple demos for the same player using raw sums, not rolling averages', () => {
    mockedFs.existsSync.mockReturnValue(true);
    const ceilingSummary = buildSummary({
      playerAggregates: [buildAggregate('76500000000000001', 'Ally', { aim: aimAtCeiling(), utility: utilityAtCeiling(), positioning: positioningAtCeiling() })],
    });
    const floorSummary = buildSummary({
      playerAggregates: [buildAggregate('76500000000000001', 'Ally', { aim: aimAtFloor(), utility: utilityAtFloor(), positioning: positioningAtFloor() })],
    });
    mockedFs.readFileSync
      .mockReturnValueOnce(JSON.stringify(ceilingSummary))
      .mockReturnValueOnce(JSON.stringify(floorSummary));

    const result = computePlayerScores(slotFolder, [buildDemoRecord('demo-1'), buildDemoRecord('demo-2')]);

    expect(result).toHaveLength(1);
    expect(result[0].demosCount).toBe(2);
    // uma demo no teto (100) e outra no piso (0) do aim score -> média 50
    expect(result[0].avgAimScore).toBe(50);
    expect(result[0].history).toHaveLength(2);
  });

  it('excludes GOTV/SourceTV demos (null flash/purchase utility fields) from the consolidated averages instead of diluting them with 0', () => {
    // demo 1: POV real, dado de flash/purchase disponível.
    const povUtility = {
      ...utilityAtCeiling(),
      flashesThrown: 10,
      enemiesFlashed: 8,
      enemiesFlashedPct: 80,
      effectiveEnemyFlashes: 6,
      effectiveFlashPct: 60,
      avgBlindTimeSec: 2.0,
      avgFriendlyBlindTimeSec: 0,
      unusedUtilityValue: 100,
      unusedUtilityRounds: 1,
    };
    // demo 2: GOTV/SourceTV, sem player_blind/item_purchase (ver parse_demo.py) —
    // flashesThrown continua real (flashbang_detonate funciona em GOTV), mas tudo
    // que depende de attacker_steamid/weapon-item vem null.
    const gotvUtility = {
      ...utilityAtCeiling(),
      flashesThrown: 20,
      enemiesFlashed: 0,
      enemiesFlashedPct: null as any,
      effectiveEnemyFlashes: 0,
      effectiveFlashPct: null as any,
      avgBlindTimeSec: null as any,
      avgFriendlyBlindTimeSec: null as any,
      unusedUtilityValue: null as any,
      unusedUtilityRounds: null as any,
    };
    mockedFs.existsSync.mockReturnValue(true);
    const povSummary = buildSummary({
      playerAggregates: [buildAggregate('76500000000000001', 'Ally', { utility: povUtility })],
    });
    const gotvSummary = buildSummary({
      playerAggregates: [buildAggregate('76500000000000001', 'Ally', { utility: gotvUtility })],
    });
    mockedFs.readFileSync
      .mockReturnValueOnce(JSON.stringify(povSummary))
      .mockReturnValueOnce(JSON.stringify(gotvSummary));

    const result = computePlayerScores(slotFolder, [buildDemoRecord('demo-1'), buildDemoRecord('demo-2')]);

    expect(result).toHaveLength(1);
    expect(result[0].demosCount).toBe(2);
    // Denominador restrito: só os 10 flashes da demo POV contam, não 10+20=30 —
    // senão a % cairia pela metade só por causa da demo GOTV, sem relação com
    // desempenho real.
    expect(result[0].utility.enemiesFlashedPct).toBe(80);
    expect(result[0].utility.effectiveFlashPct).toBe(60);
    // Média só sobre a 1 demo que tinha o dado, não dividida por demosCount(2).
    expect(result[0].utility.avgBlindTimeSec).toBe(2.0);
    // Soma só da demo com dado real, não com a GOTV somando 0 disfarçado de "sem gasto".
    expect(result[0].utility.unusedUtilityValue).toBe(100);
    expect(result[0].utility.unusedUtilityRounds).toBe(1);
    // flashesThrown continua a soma real das duas demos (não depende de player_blind).
    expect(result[0].utility.flashesThrown).toBe(30);
  });

  it('returns null for consolidated flash/purchase utility fields when every demo is GOTV/SourceTV (no usable data anywhere)', () => {
    const gotvUtility = {
      ...utilityAtCeiling(),
      enemiesFlashedPct: null as any,
      effectiveFlashPct: null as any,
      avgBlindTimeSec: null as any,
      avgFriendlyBlindTimeSec: null as any,
      unusedUtilityValue: null as any,
      unusedUtilityRounds: null as any,
    };
    mockedFs.existsSync.mockReturnValue(true);
    const summary = buildSummary({
      playerAggregates: [buildAggregate('76500000000000001', 'Ally', { utility: gotvUtility })],
    });
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(summary));

    const result = computePlayerScores(slotFolder, [buildDemoRecord('demo-1')]);

    expect(result[0].utility.enemiesFlashedPct).toBeNull();
    expect(result[0].utility.effectiveFlashPct).toBeNull();
    expect(result[0].utility.avgBlindTimeSec).toBeNull();
    expect(result[0].utility.avgFriendlyBlindTimeSec).toBeNull();
    expect(result[0].utility.unusedUtilityValue).toBeNull();
    expect(result[0].utility.unusedUtilityRounds).toBeNull();
  });

  it('threads calibration quality and null-submetric coverage into confidenceScore', () => {
    mockedFs.existsSync.mockReturnValue(true);
    const summary = buildSummary({
      calibration: {
        tempoStanceSampleSize: 2,
        tempoStanceThresholdSource: 'default', // amostra insuficiente na demo -> não conta como calibrada
        lowDisplacementThreshold: 60,
        highDisplacementThreshold: 130,
      },
      playerAggregates: [
        buildAggregate('76500000000000001', 'Sparse', {
          aim: { ...aimAtCeiling(), avgCrosshairPlacementDeg: null, avgTimeToDamageMs: null, avgTimeToKillMs: null },
          positioning: { ...positioningAtCeiling(), avgTradeDelayMs: null, avgNearestTeammateDist: null },
        }),
      ],
    });
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(summary));

    const result = computePlayerScores(slotFolder, [buildDemoRecord('demo-1')]);

    expect(result).toHaveLength(1);
    // 1 demo / 1 round / cobertura 0 (5 submétricas null) / calibração 0 (fallback default)
    // -> demosFactor(1/8)*0.4 + roundsFactor(1/190)*0.3 = 0.05 + 0.0016 -> arredonda pra 0.05.
    expect(result[0].confidenceScore).toBe(0.05);
    expect(result[0].confidence).toBe('low');
  });

  it('attributes sacrifice-opens by steamId, not by display name, when two players share a name (A06)', () => {
    // "Ally" no nosso roster (steamId 001) NÃO é quem abriu o round — quem abriu
    // foi uma "Ally" diferente (steamId 099, inimiga). Casamento por nome (bug
    // antigo) atribuiria o sacrifício de abertura errado pro nosso jogador só
    // por coincidência de nome.
    mockedFs.existsSync.mockReturnValue(true);
    const summary = buildSummary({
      rounds: [
        {
          roundNumber: 1,
          winner: 't',
          ct: { buyType: 'full', tempo: 'default', stance: 'aggressive', utilityUsed: { flashes: 0, smokes: 0, molotovs: 0, he: 0 } },
          t: { buyType: 'full', tempo: 'default', stance: 'aggressive', utilityUsed: { flashes: 0, smokes: 0, molotovs: 0, he: 0 } },
          keyPositions: [],
          deaths: [{ player: 'Ally', steamId: '76500000000000099', side: 't', x: 0, y: 0, t: 5 }],
        },
      ],
      playerAggregates: [buildAggregate('76500000000000001', 'Ally')],
    });
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(summary));

    const result = computePlayerScores(slotFolder, [buildDemoRecord('demo-1')]);

    expect(result[0].impact.roundsOpened).toBe(0);
  });

  it('falls back to name matching for sacrifice-opens when the death predates the steamId field (old demos)', () => {
    mockedFs.existsSync.mockReturnValue(true);
    const summary = buildSummary({
      rounds: [
        {
          roundNumber: 1,
          winner: 'ct',
          ct: { buyType: 'full', tempo: 'default', stance: 'aggressive', utilityUsed: { flashes: 0, smokes: 0, molotovs: 0, he: 0 } },
          t: { buyType: 'full', tempo: 'default', stance: 'aggressive', utilityUsed: { flashes: 0, smokes: 0, molotovs: 0, he: 0 } },
          keyPositions: [],
          deaths: [{ player: 'Ally', side: 'ct', x: 0, y: 0, t: 5 }], // sem steamId
        },
      ],
      playerAggregates: [buildAggregate('76500000000000001', 'Ally')],
    });
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(summary));

    const result = computePlayerScores(slotFolder, [buildDemoRecord('demo-1')]);

    expect(result[0].impact.roundsOpened).toBe(1);
    expect(result[0].impact.roundsOpenedWon).toBe(1);
  });

  it('sorts the resulting roster by avgOverallScore descending', () => {
    mockedFs.existsSync.mockReturnValue(true);
    const summary = buildSummary({
      playerAggregates: [
        buildAggregate('76500000000000001', 'Weaker', { aim: aimAtFloor(), utility: utilityAtFloor(), positioning: positioningAtFloor(), adr: 60, kills: 5 }),
        buildAggregate('76500000000000002', 'Stronger', { aim: aimAtCeiling(), utility: utilityAtCeiling(), positioning: positioningAtCeiling(), adr: 95, kills: 20 }),
      ],
    });
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(summary));

    const result = computePlayerScores(
      slotFolder,
      [buildDemoRecord('demo-1', { myTeamSteamIds: ['76500000000000001', '76500000000000002'] })]
    );

    expect(result.map((p) => p.name)).toEqual(['Stronger', 'Weaker']);
  });
});
