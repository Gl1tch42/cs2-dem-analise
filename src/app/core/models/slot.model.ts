export type SlotKind = 'own' | 'opponent';
export type BuyType = 'eco' | 'force' | 'semi' | 'full' | 'unknown';
export type RoundTempo = 'rush' | 'slow' | 'default' | 'split' | 'unknown';
export type RoundStance = 'aggressive' | 'passive' | 'passive-aggressive' | 'unknown';

export interface SlotMeta {
  id: string;
  kind: SlotKind;
  name: string;
  colorTag?: string;
  createdAt: string;
  updatedAt: string;
  demoCount: number;
}

export interface DemoRecord {
  id: string;
  fileName: string;
  map: string;
  addedAt: string;
  summaryPath: string;
  rawPath?: string;
  score?: { team: number; opponent: number };
  roundsParsed?: number;
  notes?: string;
  myTeamSteamIds?: string[];
}

export interface NotebookEntry {
  updatedAt: string;
  content: string;
}

export interface NotebookHistoryEntry {
  timestamp: string;
}

export interface SlotImportResult {
  demosImported: number;
  demosSkippedDuplicate: number;
  demosSkippedLimit: number;
  notebookSavedAsHistory: boolean;
}

export interface SlotDetail extends SlotMeta {
  demos: DemoRecord[];
  notebook: NotebookEntry;
}

export interface RoundSideSummary {
  buyType: BuyType;
  tempo: RoundTempo;
  stance: RoundStance;
  utilityUsed: { flashes: number; smokes: number; molotovs: number; he: number };
}

export interface KeyPosition {
  player: string;
  side: 'ct' | 't';
  x: number;
  y: number;
  t: number;
  yaw?: number;
  health?: number;
}

export interface RoundDeath {
  player: string;
  side: 'ct' | 't';
  x: number;
  y: number;
  t: number;
  by?: string;
  assist?: string;
  weapon?: string;
  headshot?: boolean;
}

export interface RoundShot {
  player: string;
  side: 'ct' | 't';
  t: number;
}

export interface RoundLoadout {
  player: string;
  side: 'ct' | 't';
  weapon: string | null;
  equipValue: number;
  health?: number;
  armor?: number;
  hasHelmet?: boolean;
  kills?: number;
  deaths?: number;
  assists?: number;
}

export interface GrenadePathPoint {
  x: number;
  y: number;
  t: number;
}

export interface RoundSmoke {
  x: number;
  y: number;
  startT: number;
  endT: number;
  player?: string;
  path?: GrenadePathPoint[];
}

export interface RoundFire {
  x: number;
  y: number;
  startT: number;
  endT: number;
  player?: string;
  path?: GrenadePathPoint[];
}

export interface RoundDecoy {
  x: number;
  y: number;
  startT: number;
  endT: number;
  player?: string;
  path?: GrenadePathPoint[];
}

export interface RoundFlash {
  x: number;
  y: number;
  t: number;
  player?: string;
  path?: GrenadePathPoint[];
}

export interface RoundHe {
  x: number;
  y: number;
  t: number;
  player?: string;
  path?: GrenadePathPoint[];
}

export interface RoundBlind {
  player: string;
  side: 'ct' | 't';
  t: number;
  duration: number;
}

export interface RoundBombPlant {
  x: number;
  y: number;
  t: number;
  site: 'A' | 'B' | 'mid' | 'unknown';
  player?: string;
}

export interface RoundBombEvent {
  t: number;
  player?: string;
}

export interface RoundSummary {
  roundNumber: number;
  winner: 'ct' | 't';
  ct: RoundSideSummary;
  t: RoundSideSummary;
  entryFragBy?: string;
  entryFragOn?: string;
  siteHit?: 'A' | 'B' | 'mid' | 'unknown';
  keyPositions: KeyPosition[];
  deaths?: RoundDeath[];
  shots?: RoundShot[];
  loadout?: RoundLoadout[];
  smokes?: RoundSmoke[];
  fires?: RoundFire[];
  decoys?: RoundDecoy[];
  flashes?: RoundFlash[];
  he?: RoundHe[];
  blinds?: RoundBlind[];
  bombPlant?: RoundBombPlant;
  bombDefuse?: RoundBombEvent;
  bombExplode?: RoundBombEvent;
  outcomeNote?: string;
}

export interface PlayerAimStats {
  shotsFired: number;
  shotsHit: number;
  accuracy: number;
  headHits: number;
  headAccuracy: number;
  hsKills: number;
  hsKillPct: number;
  firstBulletShots: number;
  firstBulletAccuracy: number;
  sprayShots: number;
  sprayAccuracy: number;
  counterStrafePct: number;
  avgCrosshairPlacementDeg: number | null;
  spottedAccuracy: number;
  avgTimeToDamageMs: number | null;
  avgTimeToKillMs: number | null;
}

export interface PlayerUtilityStats {
  flashesThrown: number;
  smokesThrown: number;
  molotovsThrown: number;
  heThrown: number;
  flashAssists: number;
  enemiesFlashed: number;
  enemiesFlashedPct: number;
  friendsFlashed: number;
  avgBlindTimeSec: number;
  avgHeDamage: number;
  avgHeTeamDamage: number;
  effectiveEnemyFlashes: number;
  effectiveFlashPct: number;
  avgFriendlyBlindTimeSec: number;
  avgMolotovDamage: number;
  avgMolotovTeamDamage: number;
  smokesWasted: number;
  unusedUtilityValue: number;
  unusedUtilityRounds: number;
}

export interface PlayerPositioningStats {
  openingDuelWinPct: number;
  openingDuelParticipationPct: number;
  tradeKills: number;
  tradeKillPct: number;
  tradedDeathPct: number;
  isolatedDeathPct: number;
  avgTradeDelayMs: number | null;
  overexposedDeathPct: number;
  avgNearestTeammateDist: number | null;
}

export interface PlayerImpactStats {
  kills: number;
  deaths: number;
  assists: number;
  adr: number;
  kpr: number;
  clutchesWon: number;
  clutchesLost: number;
  clutchWinPct: number;
  roundsOpened: number;
  roundsOpenedWon: number;
  sacrificeOpenPct: number;
}

export interface PlayerAggregate {
  steamId: string;
  name: string;
  side: 'ct' | 't';
  teamClanName?: string;
  kills: number;
  deaths: number;
  assists: number;
  adr: number;
  entryAttempts: number;
  entrySuccess: number;
  clutchesWon: number;
  clutchesLost: number;
  favoriteAreas: { area: string; count: number }[];
  aim: PlayerAimStats;
  utility: PlayerUtilityStats;
  positioning: PlayerPositioningStats;
}

export interface DemoCalibration {
  tempoStanceSampleSize: number;
  tempoStanceThresholdSource: 'demo' | 'default';
  lowDisplacementThreshold: number;
  highDisplacementThreshold: number;
}

export interface DemoSummary {
  demoId: string;
  map: string;
  finalScore: { team: number; opponent: number };
  rounds: RoundSummary[];
  playerAggregates: PlayerAggregate[];
  calibration?: DemoCalibration;
}

export type AiProviderId = 'anthropic' | 'openai' | 'custom' | 'mock';

export interface AiProviderConfig {
  id: AiProviderId;
  label: string;
  endpoint?: string;
  model?: string;
  hasKey: boolean;
}

export interface AiSettings {
  defaultProviderId: AiProviderId | null;
  providers: AiProviderConfig[];
}

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
  playerMovementProfile: PlayerMovementProfile[];
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

export interface AnalysisResult {
  stats: ConsolidatedSlotStats;
  analysis: string;
}

export interface PlayerScoreHistoryEntry {
  demoId: string;
  demoLabel: string;
  map: string;
  addedAt: string;
  aimScore: number;
  utilityScore: number;
  positioningScore: number;
  impactScore: number;
  overallScore: number;
  aim: PlayerAimStats;
  utility: PlayerUtilityStats;
  positioning: PlayerPositioningStats;
  impact: PlayerImpactStats;
}

// Confiança do score consolidado, baseada só no n de demos usadas pra
// calcular a média do jogador — não é uma medida estatística real
// (desvio-padrão, intervalo de confiança), só um sinal visual pra não
// tratar 2 demos e 40 demos com o mesmo peso. Ver computeScoreConfidence
// em electron/ai/scoreEngine.ts.
export type ScoreConfidence = 'low' | 'medium' | 'high';

export interface PlayerScoreAggregate {
  steamId: string;
  name: string;
  demosCount: number;
  confidence: ScoreConfidence;
  avgAimScore: number;
  avgUtilityScore: number;
  avgPositioningScore: number;
  avgImpactScore: number;
  avgOverallScore: number;
  aim: PlayerAimStats;
  utility: PlayerUtilityStats;
  positioning: PlayerPositioningStats;
  impact: PlayerImpactStats;
  history: PlayerScoreHistoryEntry[];
}

export interface MapStat {
  map: string;
  demoCount: number;
  wins: number;
  losses: number;
}

export const MAX_DEMOS_PER_SLOT = 100;
export const MAX_OPPONENT_SLOTS = 20;
