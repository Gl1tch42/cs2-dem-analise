export type SlotKind = 'own' | 'opponent';

export type BuyType = 'eco' | 'force' | 'semi' | 'full' | 'unknown';
export type RoundTempo = 'rush' | 'slow' | 'default' | 'split' | 'unknown';
export type RoundStance = 'aggressive' | 'passive' | 'passive-aggressive' | 'unknown';

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

export interface RoundSideSummary {
  buyType: BuyType;
  tempo: RoundTempo;
  stance: RoundStance;
  utilityUsed: { flashes: number; smokes: number; molotovs: number; he: number };
}

export interface KeyPosition {
  player: string;
  // A06: identificador confiável — nome pode colidir entre jogadores/times ou
  // faltar em demos anonimizadas. Opcional porque demos parseadas antes desse
  // campo existir não vão tê-lo (nesse caso, casar por nome como antes).
  steamId?: string;
  side: 'ct' | 't';
  x: number;
  y: number;
  t: number;
  yaw?: number;
  health?: number;
  // Área/callout do mapa nesta amostra (A05) — mesmo helper que já calcula
  // siteHit, só que reaproveitado em vez de descartado. Ausente quando o
  // demo não expõe last_place_name.
  zone?: string;
}

export interface RoundDeath {
  player: string;
  // A06: steamId da vítima — ver comentário em KeyPosition.steamId.
  steamId?: string;
  side: 'ct' | 't';
  x: number;
  y: number;
  t: number;
  by?: string;
  // A06: steamId de quem matou — ver comentário em KeyPosition.steamId.
  bySteamId?: string;
  assist?: string;
  // A06: steamId de quem assistiu — ver comentário em KeyPosition.steamId.
  assistSteamId?: string;
  weapon?: string;
  headshot?: boolean;
  // Estado do round no momento desta morte (A05) — ver
  // compute_death_round_state em parse_demo.py. Todos opcionais porque
  // demos parseadas antes desse campo existir não vão tê-los.
  aliveCT?: number;
  aliveT?: number;
  // CT-signed: positivo = CT em vantagem numérica, negativo = T em vantagem.
  manAdvantage?: number;
  bombPlanted?: boolean;
  zone?: string;
  // Aproximado (assume timer padrão competitivo de 115s) — ver
  // ROUND_TIME_LIMIT_SECONDS em parse_demo.py; não detecta mp_roundtime
  // customizado.
  timeRemainingSec?: number;
}

export interface RoundShot {
  player: string;
  side: 'ct' | 't';
  t: number;
}

export interface RoundLoadout {
  player: string;
  // A06: steamId — ver comentário em KeyPosition.steamId.
  steamId?: string;
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
  // A06: steamId — ver comentário em KeyPosition.steamId.
  entryFragBySteamId?: string;
  entryFragOnSteamId?: string;
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

export interface DemoCalibration {
  tempoStanceSampleSize: number;
  tempoStanceThresholdSource: 'demo' | 'default';
  lowDisplacementThreshold: number;
  highDisplacementThreshold: number;
  // Se Overexposure usou raycasting real contra geometria do mapa
  // (python/geometry/) ou caiu de volta pra heurística distância+ângulo —
  // ver load_visibility_checker em parse_demo.py (A04). Opcional porque
  // demos parseadas antes desse campo existir não vão tê-lo.
  losSource?: 'geometry' | 'heuristic';
  // False quando o evento player_blind desta demo não trouxe attacker_steamid
  // utilizável (coluna ausente OU presente mas só com valores nulos — bug já
  // visto no demoparser2 pro CS2, https://github.com/LaihoE/demoparser/issues/90).
  // Quando False, os zeros em flash assists/enemies flashed/blindTime/friendly
  // blind time são FALTA DE DADO, não uma medição real — a UI deve distinguir
  // os dois casos em vez de mostrar "0%" como se fosse medido.
  flashAttackerDataAvailable?: boolean;
  // Idem, mas pro evento item_purchase não trazer nem "weapon" nem "item" —
  // zera unused utility value/rounds por falta de dado, não por medição real.
  purchaseItemDataAvailable?: boolean;
}

export interface DemoSummary {
  demoId: string;
  map: string;
  finalScore: { team: number; opponent: number };
  rounds: RoundSummary[];
  playerAggregates: PlayerAggregate[];
  // Version of parse_demo.py's FEATURE_MODEL_VERSION that produced this
  // summary. Optional because summaries persisted before this field existed
  // won't have it. Independent from PlayerScoreAggregate.scoringModelVersion,
  // which versions the separate 0-100 scoring layer.
  featureModelVersion?: string;
  calibration?: DemoCalibration;
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
  // null quando a demo não tem player_blind com atribuição de autor utilizável
  // (típico de demos GOTV/SourceTV — o padrão de toda demo profissional; o
  // servidor CS2 não transmite esse evento pro stream de observador). Ver
  // DemoCalibration.flashAttackerDataAvailable e o comentário em parse_demo.py
  // onde esses campos são montados. null != 0: não é "mediu e deu zero", é
  // "não dá pra medir nesta demo".
  enemiesFlashedPct: number | null;
  friendsFlashed: number;
  avgBlindTimeSec: number | null;
  avgHeDamage: number;
  avgHeTeamDamage: number;
  effectiveEnemyFlashes: number;
  effectiveFlashPct: number | null;
  avgFriendlyBlindTimeSec: number | null;
  avgMolotovDamage: number;
  avgMolotovTeamDamage: number;
  smokesWasted: number;
  // null quando a demo não tem item_purchase com weapon/item utilizável (mesma
  // limitação de demos GOTV/SourceTV que afeta player_blind acima). Ver
  // DemoCalibration.purchaseItemDataAvailable.
  unusedUtilityValue: number | null;
  unusedUtilityRounds: number | null;
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

// "Rating"/impacto real em vencer rounds: kills/ADR (produção crua, sem
// filtro de qualidade de tiro — isso já é papel da nota de Mira), clutches
// e o sacrifício de abrir round (morrer primeiro no round mas o time vencer
// mesmo assim — sinal de que a morte comprou informação/espaço útil, distinto
// de "ganhar o duelo de abertura", que já é coberto em PlayerPositioningStats).
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

// Confiança do score consolidado — combina n de demos, rounds observados,
// cobertura de submétricas e qualidade de calibração das demos usadas pra
// calcular a média do jogador. Não é uma medida estatística real
// (desvio-padrão, intervalo de confiança), só um sinal visual pra não
// tratar dados escassos/pouco calibrados com o mesmo peso de uma amostra
// grande e completa. Ver computeScoreConfidence em electron/ai/scoreEngine.ts.
export type ScoreConfidence = 'low' | 'medium' | 'high';

export interface PlayerScoreAggregate {
  steamId: string;
  name: string;
  demosCount: number;
  confidence: ScoreConfidence;
  // Composto 0-1 por trás do balde low/medium/high acima — combina demosCount,
  // rounds observados, cobertura de submétricas e qualidade de calibração. Ver
  // computeScoreConfidence em electron/ai/scoreEngine.ts.
  confidenceScore: number;
  // Ver SCORING_MODEL_VERSION em electron/ai/scoreEngine.ts — muda quando as
  // faixas targetMin/targetMax são recalibradas, pra UI poder sinalizar que
  // a régua mudou em vez de só mostrar um score diferente sem contexto.
  scoringModelVersion: string;
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

export interface NotebookEntry {
  updatedAt: string;
  content: string;
}

export interface NotebookHistoryEntry {
  timestamp: string;
}

// Formato do arquivo `.csda-slot` gerado por `slots:exportSlot` — JSON
// gzipado com tudo que dá pra levar de um slot pra outra máquina (demos já
// parseadas + roster marcado + notebook) sem precisar de servidor. Ver
// item "Sync entre analistas" no README.
export interface SlotExportBundle {
  formatVersion: 1;
  exportedAt: string;
  slotName: string;
  slotKind: SlotKind;
  notebookContent: string;
  demos: { record: DemoRecord; summary: DemoSummary }[];
}

export interface SlotImportResult {
  demosImported: number;
  demosSkippedDuplicate: number;
  demosSkippedLimit: number;
  notebookSavedAsHistory: boolean;
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

export interface SlotMeta {
  id: string;
  kind: SlotKind;
  name: string;
  colorTag?: string;
  createdAt: string;
  updatedAt: string;
  demoCount: number;
}

export interface SlotDetail extends SlotMeta {
  demos: DemoRecord[];
  notebook: NotebookEntry;
}

export interface MapStat {
  map: string;
  demoCount: number;
  wins: number;
  losses: number;
}

export const MAX_DEMOS_PER_SLOT = 100;
export const MAX_OPPONENT_SLOTS = 20;
