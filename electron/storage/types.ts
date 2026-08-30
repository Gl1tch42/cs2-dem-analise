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

export interface RoundSmoke {
  x: number;
  y: number;
  startT: number;
  endT: number;
  player?: string;
}

export interface RoundFire {
  x: number;
  y: number;
  startT: number;
  endT: number;
  player?: string;
}

export interface RoundDecoy {
  x: number;
  y: number;
  startT: number;
  endT: number;
  player?: string;
}

export interface RoundFlash {
  x: number;
  y: number;
  t: number;
  player?: string;
}

export interface RoundHe {
  x: number;
  y: number;
  t: number;
  player?: string;
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

export interface DemoSummary {
  demoId: string;
  map: string;
  finalScore: { team: number; opponent: number };
  rounds: RoundSummary[];
  playerAggregates: PlayerAggregate[];
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

export interface NotebookEntry {
  updatedAt: string;
  content: string;
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

export const MAX_DEMOS_PER_SLOT = 100;
export const MAX_OPPONENT_SLOTS = 20;
