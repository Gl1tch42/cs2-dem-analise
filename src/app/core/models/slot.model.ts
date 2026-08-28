// Espelha electron/storage/types.ts. Mantidos separados de propósito: o Angular
// (contexto browser) não deve importar código do processo principal (contexto Node).
// Se o projeto crescer, mover ambos para um pacote `shared/` com seu próprio
// tsconfig resolve a duplicação — por ora, MVP simples.

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
  /** SteamIds dos 5 jogadores que são "o time deste slot" nesta demo — ver electron/storage/types.ts. */
  myTeamSteamIds?: string[];
}

export interface NotebookEntry {
  updatedAt: string;
  content: string;
}

export interface SlotDetail extends SlotMeta {
  demos: DemoRecord[];
  notebook: NotebookEntry;
}

/**
 * Toda demo tem dois lados (CT e T) — os campos táticos de rodada vêm
 * separados por lado, sem tentar adivinhar qual dos dois é "o time do slot".
 */
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
  t: number; // segundos desde o início (freeze end) da rodada
  /** Direção de visão (graus), quando a demo expõe o prop — usada pro triângulo do Mapa 2D. */
  yaw?: number;
}

/** Morte com posição — usada pro "X" do jogador morto no Mapa 2D. */
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

/** Um disparo — usado pro flash amarelo do indicador de mira no Mapa 2D. */
export interface RoundShot {
  player: string;
  side: 'ct' | 't';
  t: number;
}

/** Loadout pós-compra (freeze_end) de um jogador — usado no placar de economia do Mapa 2D. */
export interface RoundLoadout {
  player: string;
  side: 'ct' | 't';
  weapon: string | null;
  equipValue: number;
  /** Campos abaixo dependem de props que nem toda demo expõe — sempre opcionais. */
  health?: number;
  armor?: number;
  hasHelmet?: boolean;
  /** Contagens cumulativas (o jogo já mantém isso por controller) até o início deste round. */
  kills?: number;
  deaths?: number;
  assists?: number;
}

/** Área coberta por uma granada de fumaça, do início ao fim (segundos desde freeze_end). */
export interface RoundSmoke {
  x: number;
  y: number;
  startT: number;
  endT: number;
}

/** Área em chamas de uma molotov/incendiária. */
export interface RoundFire {
  x: number;
  y: number;
  startT: number;
  endT: number;
}

/** Janela ativa de uma decoy (tiros falsos). */
export interface RoundDecoy {
  x: number;
  y: number;
  startT: number;
  endT: number;
}

/** Estouro de uma flashbang (instante — o efeito visual é um flash breve). */
export interface RoundFlash {
  x: number;
  y: number;
  t: number;
}

/** Um jogador cegado por uma flash, com duração da cegueira em segundos. */
export interface RoundBlind {
  player: string;
  side: 'ct' | 't';
  t: number;
  duration: number;
}

/** Resumo leve e estruturado de UMA rodada, gerado pela camada algorítmica local. */
export interface RoundSummary {
  roundNumber: number;
  winner: 'ct' | 't';
  ct: RoundSideSummary;
  t: RoundSideSummary;
  entryFragBy?: string;
  entryFragOn?: string;
  siteHit?: 'A' | 'B' | 'mid' | 'unknown';
  keyPositions: KeyPosition[]; // amostragem esparsa, não tick-a-tick
  /** Ausentes em summary.json gerados antes desses campos existirem — sempre trate como opcionais. */
  deaths?: RoundDeath[];
  shots?: RoundShot[];
  loadout?: RoundLoadout[];
  smokes?: RoundSmoke[];
  fires?: RoundFire[];
  decoys?: RoundDecoy[];
  flashes?: RoundFlash[];
  blinds?: RoundBlind[];
  outcomeNote?: string;
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
}

/** Resumo estruturado de uma demo inteira, lido do summary.json gerado pelo parser Python. */
export interface DemoSummary {
  demoId: string;
  map: string;
  finalScore: { team: number; opponent: number };
  rounds: RoundSummary[];
  playerAggregates: PlayerAggregate[];
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
  playerMovementProfile: PlayerMovementProfile[];
  topRecurringPatterns: { pattern: string; count: number; winRate: number }[];
}

export interface AnalysisResult {
  stats: ConsolidatedSlotStats;
  analysis: string;
}

export const MAX_DEMOS_PER_SLOT = 100;
export const MAX_OPPONENT_SLOTS = 20;
