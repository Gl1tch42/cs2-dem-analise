import * as fs from 'fs';
import { resolveDemoOutcome, consolidateSlot, openingManAdvantageBucket } from '../localHeuristics';
import { DemoSummary, DemoRecord, RoundSummary, PlayerAggregate, RoundSideSummary } from '../../storage/types';

function emptySide(overrides: Partial<RoundSideSummary> = {}): RoundSideSummary {
  return { buyType: 'full', tempo: 'default', stance: 'aggressive', utilityUsed: { flashes: 0, smokes: 0, molotovs: 0, he: 0 }, ...overrides };
}

function buildRound(overrides: Partial<RoundSummary> = {}): RoundSummary {
  return {
    roundNumber: 1,
    winner: 'ct',
    ct: emptySide(),
    t: emptySide(),
    keyPositions: [
      { player: 'Ally1', side: 'ct', x: 0, y: 0, t: 0 },
      { player: 'Enemy1', side: 't', x: 0, y: 0, t: 0 },
    ],
    ...overrides,
  };
}

function buildAggregate(steamId: string, name: string, overrides: Partial<PlayerAggregate> = {}): PlayerAggregate {
  return {
    steamId,
    name,
    side: 'ct',
    kills: 10,
    deaths: 8,
    assists: 2,
    adr: 75,
    entryAttempts: 1,
    entrySuccess: 1,
    clutchesWon: 0,
    clutchesLost: 0,
    favoriteAreas: [{ area: 'A Site', count: 3 }],
    aim: {
      shotsFired: 100,
      shotsHit: 20,
      accuracy: 20,
      headHits: 5,
      headAccuracy: 20,
      hsKills: 3,
      hsKillPct: 30,
      firstBulletShots: 10,
      firstBulletAccuracy: 20,
      sprayShots: 5,
      sprayAccuracy: 30,
      counterStrafePct: 60,
      avgCrosshairPlacementDeg: 10,
      spottedAccuracy: 25,
      avgTimeToDamageMs: 700,
      avgTimeToKillMs: 1200,
    },
    utility: {
      flashesThrown: 2,
      smokesThrown: 1,
      molotovsThrown: 0,
      heThrown: 1,
      flashAssists: 0,
      enemiesFlashed: 1,
      enemiesFlashedPct: 50,
      friendsFlashed: 0,
      avgBlindTimeSec: 1,
      avgHeDamage: 10,
      avgHeTeamDamage: 0,
      effectiveEnemyFlashes: 1,
      effectiveFlashPct: 50,
      avgFriendlyBlindTimeSec: 0,
      avgMolotovDamage: 0,
      avgMolotovTeamDamage: 0,
      smokesWasted: 0,
      unusedUtilityValue: 0,
      unusedUtilityRounds: 0,
    },
    positioning: {
      openingDuelWinPct: 50,
      openingDuelParticipationPct: 20,
      tradeKills: 1,
      tradeKillPct: 10,
      tradedDeathPct: 30,
      isolatedDeathPct: 20,
      avgTradeDelayMs: 1500,
      overexposedDeathPct: 15,
      avgNearestTeammateDist: 800,
    },
    ...overrides,
  };
}

// ---- resolveDemoOutcome ---------------------------------------------------

describe('resolveDemoOutcome', () => {
  it('returns null when no roster is marked', () => {
    const summary: DemoSummary = { demoId: 'd1', map: 'de_mirage', finalScore: { team: 13, opponent: 5 }, rounds: [], playerAggregates: [] };
    expect(resolveDemoOutcome(summary, undefined)).toBeNull();
    expect(resolveDemoOutcome(summary, [])).toBeNull();
  });

  it('counts a win per round by tallying which side the marked roster occupied that round, not by finalScore', () => {
    // O roster começa CT (ganha round 1) e depois vira T na metade (perde round 2 como T,
    // ganha round 3 como T) — finalScore.team/opponent não reflete isso, só quem começou CT.
    const summary: DemoSummary = {
      demoId: 'd1',
      map: 'de_mirage',
      finalScore: { team: 1, opponent: 2 },
      rounds: [
        buildRound({ roundNumber: 1, winner: 'ct', keyPositions: [{ player: 'Ally', side: 'ct', x: 0, y: 0, t: 0 }] }),
        buildRound({ roundNumber: 2, winner: 'ct', keyPositions: [{ player: 'Ally', side: 't', x: 0, y: 0, t: 0 }] }),
        buildRound({ roundNumber: 3, winner: 't', keyPositions: [{ player: 'Ally', side: 't', x: 0, y: 0, t: 0 }] }),
      ],
      playerAggregates: [buildAggregate('76500000000000001', 'Ally')],
    };
    // round1: meu lado ct venceu -> win. round2: meu lado t, venceu ct -> loss. round3: meu lado t, venceu t -> win.
    // 2 wins, 1 loss -> 'win'
    expect(resolveDemoOutcome(summary, ['76500000000000001'])).toBe('win');
  });

  it('returns null on a tie between rounds won and lost by the marked roster', () => {
    const summary: DemoSummary = {
      demoId: 'd1',
      map: 'de_mirage',
      finalScore: { team: 1, opponent: 1 },
      rounds: [
        buildRound({ roundNumber: 1, winner: 'ct', keyPositions: [{ player: 'Ally', side: 'ct', x: 0, y: 0, t: 0 }] }),
        buildRound({ roundNumber: 2, winner: 't', keyPositions: [{ player: 'Ally', side: 'ct', x: 0, y: 0, t: 0 }] }),
      ],
      playerAggregates: [buildAggregate('76500000000000001', 'Ally')],
    };
    expect(resolveDemoOutcome(summary, ['76500000000000001'])).toBeNull();
  });

  it('skips rounds where the marked roster cannot be located in loadout/keyPositions', () => {
    const summary: DemoSummary = {
      demoId: 'd1',
      map: 'de_mirage',
      finalScore: { team: 1, opponent: 0 },
      rounds: [buildRound({ keyPositions: [{ player: 'SomeoneElse', side: 'ct', x: 0, y: 0, t: 0 }] })],
      playerAggregates: [buildAggregate('76500000000000001', 'Ally')],
    };
    expect(resolveDemoOutcome(summary, ['76500000000000001'])).toBeNull();
  });

  it('prefers loadout rows over keyPositions when both are present', () => {
    const summary: DemoSummary = {
      demoId: 'd1',
      map: 'de_mirage',
      finalScore: { team: 1, opponent: 0 },
      rounds: [
        buildRound({
          winner: 't',
          loadout: [{ player: 'Ally', side: 't', weapon: 'ak47', equipValue: 2700 }],
          keyPositions: [{ player: 'Ally', side: 'ct', x: 0, y: 0, t: 0 }], // lado divergente, deve ser ignorado
        }),
      ],
      playerAggregates: [buildAggregate('76500000000000001', 'Ally')],
    };
    expect(resolveDemoOutcome(summary, ['76500000000000001'])).toBe('win');
  });
});

// ---- openingManAdvantageBucket ---------------------------------------------

describe('openingManAdvantageBucket', () => {
  it('returns unknown when the round has no deaths at all', () => {
    const round = buildRound({ deaths: [] });
    expect(openingManAdvantageBucket(round, 'ct')).toBe('unknown');
  });

  it('returns unknown when deaths[0] predates manAdvantage (backward compat with old demos)', () => {
    const round = buildRound({
      deaths: [{ player: 'Enemy1', side: 't', x: 0, y: 0, t: 5 }],
    });
    expect(openingManAdvantageBucket(round, 'ct')).toBe('unknown');
  });

  it('returns even when manAdvantage is zero', () => {
    const round = buildRound({
      deaths: [{ player: 'Enemy1', side: 't', x: 0, y: 0, t: 5, manAdvantage: 0 }],
    });
    expect(openingManAdvantageBucket(round, 'ct')).toBe('even');
    expect(openingManAdvantageBucket(round, 't')).toBe('even');
  });

  it('reads manAdvantage from the CT perspective directly', () => {
    const round = buildRound({
      deaths: [{ player: 'Enemy1', side: 't', x: 0, y: 0, t: 5, manAdvantage: 2 }],
    });
    expect(openingManAdvantageBucket(round, 'ct')).toBe('advantage');
    expect(openingManAdvantageBucket(round, 't')).toBe('disadvantage');
  });

  it('flips the sign for the T perspective', () => {
    const round = buildRound({
      deaths: [{ player: 'Ally1', side: 'ct', x: 0, y: 0, t: 5, manAdvantage: -1 }],
    });
    expect(openingManAdvantageBucket(round, 't')).toBe('advantage');
    expect(openingManAdvantageBucket(round, 'ct')).toBe('disadvantage');
  });
});

// ---- consolidateSlot -------------------------------------------------------

jest.mock('fs');

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

describe('consolidateSlot', () => {
  const slotFolder = 'C:/slots/slot-1';
  const mockedFs = fs as jest.Mocked<typeof fs>;

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('lists demos with no marked roster separately instead of silently dropping them', () => {
    mockedFs.existsSync.mockReturnValue(true);
    const summary: DemoSummary = { demoId: 'd1', map: 'de_mirage', finalScore: { team: 13, opponent: 5 }, rounds: [], playerAggregates: [] };
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(summary));

    const result = consolidateSlot(slotFolder, [buildDemoRecord('demo-1', { myTeamSteamIds: [] })]);

    expect(result.demosPendingRoster).toEqual(['demo-1.dem']);
    expect(result.roundsAnalyzed).toBe(0);
  });

  it('flags demos calibrated with default thresholds (small round sample)', () => {
    mockedFs.existsSync.mockReturnValue(true);
    const summary: DemoSummary = {
      demoId: 'd1',
      map: 'de_mirage',
      finalScore: { team: 13, opponent: 5 },
      rounds: [],
      playerAggregates: [],
      calibration: { tempoStanceSampleSize: 3, tempoStanceThresholdSource: 'default', lowDisplacementThreshold: 1, highDisplacementThreshold: 2 },
    };
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(summary));

    const result = consolidateSlot(slotFolder, [buildDemoRecord('demo-1')]);

    expect(result.demosLowCalibrationSample).toEqual(['demo-1.dem']);
  });

  it('splits win-rate tendencies between my team and the opponent using the marked roster side per round', () => {
    mockedFs.existsSync.mockReturnValue(true);
    const summary: DemoSummary = {
      demoId: 'd1',
      map: 'de_mirage',
      finalScore: { team: 1, opponent: 0 },
      rounds: [
        buildRound({
          winner: 'ct',
          siteHit: 'A',
          ct: emptySide({ buyType: 'full', tempo: 'rush', stance: 'aggressive' }),
          t: emptySide({ buyType: 'eco', tempo: 'slow', stance: 'passive' }),
          keyPositions: [{ player: 'Ally', side: 'ct', x: 0, y: 0, t: 0 }],
        }),
      ],
      playerAggregates: [buildAggregate('76500000000000001', 'Ally'), buildAggregate('76500000000000099', 'Enemy')],
    };
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(summary));

    const result = consolidateSlot(slotFolder, [buildDemoRecord('demo-1')]);

    expect(result.roundsAnalyzed).toBe(1);
    expect(result.siteHitDistribution['A']).toBe(1);
    // meu time jogou CT full/rush/aggressive e venceu
    expect(result.myTeam.tendencyByBuyType.full.count).toBe(1);
    expect(result.myTeam.tendencyByBuyType.full.winRate).toBe(1);
    // o oponente jogou T eco/slow/passive e perdeu
    expect(result.opponent.tendencyByBuyType.eco.count).toBe(1);
    expect(result.opponent.tendencyByBuyType.eco.winRate).toBe(0);
  });

  it('buckets tendencyByManAdvantage from the round-opening death, per side perspective', () => {
    mockedFs.existsSync.mockReturnValue(true);
    const summary: DemoSummary = {
      demoId: 'd1',
      map: 'de_mirage',
      finalScore: { team: 1, opponent: 0 },
      rounds: [
        buildRound({
          winner: 'ct',
          deaths: [{ player: 'Enemy1', side: 't', x: 0, y: 0, t: 5, manAdvantage: 1 }], // CT ganhou a abertura
          keyPositions: [{ player: 'Ally', side: 'ct', x: 0, y: 0, t: 0 }],
        }),
      ],
      playerAggregates: [buildAggregate('76500000000000001', 'Ally'), buildAggregate('76500000000000099', 'Enemy')],
    };
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(summary));

    const result = consolidateSlot(slotFolder, [buildDemoRecord('demo-1')]);

    // meu time (CT) abriu em vantagem e venceu a rodada
    expect(result.myTeam.tendencyByManAdvantage.advantage.count).toBe(1);
    expect(result.myTeam.tendencyByManAdvantage.advantage.winRate).toBe(1);
    // o oponente (T) abriu em desvantagem e perdeu a rodada
    expect(result.opponent.tendencyByManAdvantage.disadvantage.count).toBe(1);
    expect(result.opponent.tendencyByManAdvantage.disadvantage.winRate).toBe(0);
  });

  it('falls back to the unknown man-advantage bucket for demos parsed before that field existed', () => {
    mockedFs.existsSync.mockReturnValue(true);
    const summary: DemoSummary = {
      demoId: 'd1',
      map: 'de_mirage',
      finalScore: { team: 1, opponent: 0 },
      rounds: [
        buildRound({
          winner: 'ct',
          deaths: [{ player: 'Enemy1', side: 't', x: 0, y: 0, t: 5 }], // sem manAdvantage — demo antiga
          keyPositions: [{ player: 'Ally', side: 'ct', x: 0, y: 0, t: 0 }],
        }),
      ],
      playerAggregates: [buildAggregate('76500000000000001', 'Ally')],
    };
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(summary));

    const result = consolidateSlot(slotFolder, [buildDemoRecord('demo-1')]);

    expect(result.myTeam.tendencyByManAdvantage.unknown.count).toBe(1);
  });

  it('records detailedPatterns keyed by map + side, separately for my team and the opponent, without a top-N slice', () => {
    mockedFs.existsSync.mockReturnValue(true);
    const summary: DemoSummary = {
      demoId: 'd1',
      map: 'de_inferno',
      finalScore: { team: 1, opponent: 0 },
      rounds: [
        buildRound({
          winner: 'ct',
          siteHit: 'A',
          ct: emptySide({ buyType: 'full', tempo: 'rush', stance: 'aggressive' }),
          t: emptySide({ buyType: 'eco', tempo: 'slow', stance: 'passive' }),
          keyPositions: [{ player: 'Ally', side: 'ct', x: 0, y: 0, t: 0 }],
        }),
      ],
      playerAggregates: [buildAggregate('76500000000000001', 'Ally'), buildAggregate('76500000000000099', 'Enemy')],
    };
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(summary));

    const result = consolidateSlot(slotFolder, [buildDemoRecord('demo-1')]);

    expect(result.myTeam.detailedPatterns).toEqual([
      {
        key: { map: 'de_inferno', side: 'ct', buyType: 'full', tempo: 'rush', stance: 'aggressive', site: 'A' },
        count: 1,
        winRate: 1,
      },
    ]);
    expect(result.opponent.detailedPatterns).toEqual([
      {
        key: { map: 'de_inferno', side: 't', buyType: 'eco', tempo: 'slow', stance: 'passive', site: 'A' },
        count: 1,
        winRate: 0,
      },
    ]);
  });

  it('attributes each player to my team or the opponent movement profile based on the marked roster', () => {
    mockedFs.existsSync.mockReturnValue(true);
    const summary: DemoSummary = {
      demoId: 'd1',
      map: 'de_mirage',
      finalScore: { team: 1, opponent: 0 },
      rounds: [],
      playerAggregates: [buildAggregate('76500000000000001', 'Ally', { adr: 90 }), buildAggregate('76500000000000099', 'Enemy', { adr: 40 })],
    };
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(summary));

    const result = consolidateSlot(slotFolder, [buildDemoRecord('demo-1')]);

    expect(result.myTeam.playerMovementProfile.map((p) => p.name)).toEqual(['Ally']);
    expect(result.myTeam.playerMovementProfile[0].avgAdr).toBe(90);
    expect(result.opponent.playerMovementProfile.map((p) => p.name)).toEqual(['Enemy']);
    expect(result.opponent.playerMovementProfile[0].avgAdr).toBe(40);
  });

  it('skips demos whose summary.json is missing on disk', () => {
    mockedFs.existsSync.mockReturnValue(false);
    const result = consolidateSlot(slotFolder, [buildDemoRecord('demo-1')]);
    expect(result.demosAnalyzed).toBe(1);
    expect(result.roundsAnalyzed).toBe(0);
    expect(result.demosPendingRoster).toEqual([]);
  });
});
