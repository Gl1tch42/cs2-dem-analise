import { buildMatchup, commonMaps, computeMatchupConfidence } from '../matchupEngine';
import { ConsolidatedSlotStats, TeamTendencyStats, PatternStat, PatternKey, ManAdvantageBucket } from '../localHeuristics';
import { DemoRecord, BuyType, RoundTempo, RoundStance } from '../../storage/types';

// ---- fixtures ---------------------------------------------------------

const BUY_TYPES: BuyType[] = ['eco', 'force', 'semi', 'full', 'unknown'];
const TEMPOS: RoundTempo[] = ['rush', 'slow', 'default', 'split', 'unknown'];
const STANCES: RoundStance[] = ['aggressive', 'passive', 'passive-aggressive', 'unknown'];
const MAN_ADVANTAGE_BUCKETS: ManAdvantageBucket[] = ['advantage', 'even', 'disadvantage', 'unknown'];

function emptyCountMap<K extends string>(keys: K[]): Record<K, { count: number; winRate: number }> {
  const out = {} as Record<K, { count: number; winRate: number }>;
  for (const k of keys) out[k] = { count: 0, winRate: 0 };
  return out;
}

function buildTeam(detailedPatterns: PatternStat[] = []): TeamTendencyStats {
  return {
    tendencyByBuyType: emptyCountMap(BUY_TYPES),
    tendencyByTempo: emptyCountMap(TEMPOS),
    tendencyByStance: emptyCountMap(STANCES),
    tendencyByManAdvantage: emptyCountMap(MAN_ADVANTAGE_BUCKETS),
    topRecurringPatterns: [],
    detailedPatterns,
    playerMovementProfile: [],
  };
}

function buildStats(overrides: Partial<ConsolidatedSlotStats> = {}): ConsolidatedSlotStats {
  return {
    demosAnalyzed: 1,
    roundsAnalyzed: 1,
    demosPendingRoster: [],
    demosLowCalibrationSample: [],
    siteHitDistribution: {},
    myTeam: buildTeam(),
    opponent: buildTeam(),
    ...overrides,
  };
}

function pattern(keyOverrides: Partial<PatternKey> = {}, count = 5, winRate = 0.6): PatternStat {
  return {
    key: { map: 'de_mirage', side: 't', buyType: 'full', tempo: 'rush', stance: 'aggressive', site: 'A', ...keyOverrides },
    count,
    winRate,
  };
}

function buildDemoRecord(id: string, map: string): DemoRecord {
  return { id, fileName: `${id}.dem`, map, addedAt: '2026-09-01T00:00:00.000Z', summaryPath: `demos/${id}/summary.json` };
}

// ---- computeMatchupConfidence ------------------------------------------

describe('computeMatchupConfidence', () => {
  it('is low below the medium threshold (2 occurrences)', () => {
    expect(computeMatchupConfidence(2)).toBe('low');
  });

  it('is medium at the medium threshold (3 occurrences)', () => {
    expect(computeMatchupConfidence(3)).toBe('medium');
  });

  it('is still medium just below the high threshold (7 occurrences)', () => {
    expect(computeMatchupConfidence(7)).toBe('medium');
  });

  it('is high at the high threshold (8 occurrences)', () => {
    expect(computeMatchupConfidence(8)).toBe('high');
  });
});

// ---- commonMaps ---------------------------------------------------------

describe('commonMaps', () => {
  it('returns the intersection of maps, not the union', () => {
    const own = [buildDemoRecord('o1', 'de_mirage'), buildDemoRecord('o2', 'de_inferno')];
    const opp = [buildDemoRecord('p1', 'de_inferno'), buildDemoRecord('p2', 'de_dust2')];
    expect(commonMaps(own, opp)).toEqual(['de_inferno']);
  });

  it('returns an empty array when there is no overlap', () => {
    const own = [buildDemoRecord('o1', 'de_mirage')];
    const opp = [buildDemoRecord('p1', 'de_dust2')];
    expect(commonMaps(own, opp)).toEqual([]);
  });
});

// ---- buildMatchup ---------------------------------------------------------

describe('buildMatchup', () => {
  it('pairs the opponent execution (oppStats.myTeam) against our own defense history (ownStats.opponent) for weaknesses, ignoring decoy entries on the wrong accumulators', () => {
    const key: Partial<PatternKey> = { map: 'de_mirage', side: 't', buyType: 'full', tempo: 'rush', stance: 'aggressive', site: 'A' };

    const ownStats = buildStats({
      // decoy: if the code wrongly paired ownStats.myTeam instead of ownStats.opponent, this would leak in
      myTeam: buildTeam([pattern(key, 9, 0.9)]),
      opponent: buildTeam([pattern(key, 10, 0.7)]), // correct responder: we lose 70% of the time facing this
    });
    const oppStats = buildStats({
      myTeam: buildTeam([pattern(key, 10, 0.8)]), // correct executor: opponent's own tendency with this pattern
      // decoy: if the code wrongly paired oppStats.opponent instead of oppStats.myTeam, this would leak in
      opponent: buildTeam([pattern(key, 9, 0.1)]),
    });

    const report = buildMatchup('own-1', 'opp-1', ownStats, oppStats, 'de_mirage');

    expect(report.exploitableWeaknesses).toHaveLength(1);
    expect(report.exploitableWeaknesses[0].responseWinRate).toBeCloseTo(0.3); // 1 - 0.7, not derived from a decoy
    expect(report.exploitableWeaknesses[0].executorOccurrences).toBe(10);
    expect(report.exploitableWeaknesses[0].severity).toBe('high');
  });

  it('pairs our own execution (ownStats.myTeam) against the opponent defense history (oppStats.opponent) for advantages, ignoring decoy entries', () => {
    const key: Partial<PatternKey> = { map: 'de_mirage', side: 'ct', buyType: 'semi', tempo: 'default', stance: 'passive', site: 'B' };

    const ownStats = buildStats({
      myTeam: buildTeam([pattern(key, 6, 0.65)]), // correct executor: our own tendency
      opponent: buildTeam([pattern(key, 9, 0.9)]), // decoy
    });
    const oppStats = buildStats({
      myTeam: buildTeam([pattern(key, 9, 0.05)]), // decoy
      opponent: buildTeam([pattern(key, 6, 0.8)]), // correct responder: rivals win 80% vs. the opponent's defense here
    });

    const report = buildMatchup('own-1', 'opp-1', ownStats, oppStats, 'de_mirage');

    expect(report.ownAdvantages).toHaveLength(1);
    expect(report.ownAdvantages[0].responseWinRate).toBeCloseTo(0.2); // 1 - 0.8, not derived from a decoy
  });

  it('excludes an insight entirely when either side is below minSamples, instead of showing it as low confidence', () => {
    const key: Partial<PatternKey> = { map: 'de_mirage' };
    const ownStats = buildStats({ opponent: buildTeam([pattern(key, 10, 0.7)]) });
    const oppStats = buildStats({ myTeam: buildTeam([pattern(key, 2, 0.8)]) }); // below default minSamples (3)

    const report = buildMatchup('own-1', 'opp-1', ownStats, oppStats, 'de_mirage');

    expect(report.exploitableWeaknesses).toHaveLength(0);
  });

  it('ignores patterns from a different map than the one requested', () => {
    const otherMapKey: Partial<PatternKey> = { map: 'de_dust2' };
    const ownStats = buildStats({ opponent: buildTeam([pattern(otherMapKey, 10, 0.7)]) });
    const oppStats = buildStats({ myTeam: buildTeam([pattern(otherMapKey, 10, 0.8)]) });

    const report = buildMatchup('own-1', 'opp-1', ownStats, oppStats, 'de_mirage');

    expect(report.exploitableWeaknesses).toHaveLength(0);
    expect(report.ownAdvantages).toHaveLength(0);
  });

  it('returns an empty report instead of throwing when there is no overlapping data for the map', () => {
    const ownStats = buildStats({ demosPendingRoster: ['own-pending.dem'] });
    const oppStats = buildStats({ demosPendingRoster: ['opp-pending.dem'] });

    const report = buildMatchup('own-1', 'opp-1', ownStats, oppStats, 'de_overpass');

    expect(report.exploitableWeaknesses).toEqual([]);
    expect(report.ownAdvantages).toEqual([]);
    expect(report.disclaimer).toBe('inferred-not-head-to-head');
    expect(report.demosPendingRoster).toEqual({ own: ['own-pending.dem'], opponent: ['opp-pending.dem'] });
    expect(typeof report.generatedAt).toBe('string');
  });
});
