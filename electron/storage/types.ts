// Tipos compartilhados entre o processo principal (Electron/Node) e o Angular.
// Mantidos aqui e re-exportados no lado do renderer (src/app/core/models) para
// não duplicar a definição.

export type SlotKind = 'own' | 'opponent';

export type BuyType = 'eco' | 'force' | 'semi' | 'full' | 'unknown';
export type RoundTempo = 'rush' | 'slow' | 'default' | 'split' | 'unknown';
export type RoundStance = 'aggressive' | 'passive' | 'passive-aggressive' | 'unknown';

/** Metadados de uma demo já processada e guardada dentro de um slot. */
export interface DemoRecord {
  id: string;
  fileName: string;
  map: string;
  addedAt: string; // ISO date
  /** Caminho relativo (dentro da pasta do slot) para o resumo estruturado gerado pelo parser Python. */
  summaryPath: string;
  /** Caminho relativo para a demo .dem original, se o usuário optou por manter uma cópia. */
  rawPath?: string;
  score?: { team: number; opponent: number };
  roundsParsed?: number;
  notes?: string;
  /**
   * SteamIds dos 5 jogadores que são "o time deste slot" nesta demo. Toda demo tem dois
   * lados (ct/t) e o time troca de lado no intervalo — sem isso não dá pra saber qual dos
   * dois lados de cada round é o time do slot e qual é o adversário, e as tendências táticas
   * acabam misturando os dois (ver consolidateSlot). Undefined = ainda não escolhido pelo usuário.
   */
  myTeamSteamIds?: string[];
}

/**
 * Toda demo tem dois lados (CT e T) — ainda não existe no app um jeito de dizer
 * "esses são os jogadores do time X" entre demos diferentes (fica pra uma próxima
 * etapa). Por isso os campos táticos de rodada vêm SEPARADOS por lado, sem tentar
 * adivinhar qual dos dois é "o time do slot".
 */
export interface RoundSideSummary {
  buyType: BuyType;
  tempo: RoundTempo;
  stance: RoundStance;
  utilityUsed: { flashes: number; smokes: number; molotovs: number; he: number };
}

/** Uma amostra esparsa de posição (não tick-a-tick) de um jogador dentro do round. */
export interface KeyPosition {
  player: string;
  side: 'ct' | 't';
  x: number;
  y: number;
  t: number; // segundos desde o freeze_end do round
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
  outcomeNote?: string; // preenchido depois pelo algoritmo (ex: "clutch 1v2 perdido no retake B")
}

/** Resumo estruturado de uma demo inteira — é isso (não posições cruas) que vai para a IA. */
export interface DemoSummary {
  demoId: string;
  map: string;
  finalScore: { team: number; opponent: number };
  rounds: RoundSummary[];
  playerAggregates: PlayerAggregate[];
}

/** Agregação de um jogador dentro de uma única demo (depois consolidado entre demos no slot). */
export interface PlayerAggregate {
  steamId: string;
  name: string;
  /** Lado predominante nesta demo — times trocam de lado no intervalo, então isto é uma maioria, não uma constante. */
  side: 'ct' | 't';
  /** Nome do clã/roster quando o demo expõe essa informação — identidade estável entre os dois lados. */
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

/** Anotações do analista para um slot (equipe). Guardado como markdown puro em disco. */
export interface NotebookEntry {
  updatedAt: string;
  content: string; // markdown
}

export type AiProviderId = 'anthropic' | 'openai' | 'custom' | 'mock';

export interface AiProviderConfig {
  id: AiProviderId;
  label: string;
  endpoint?: string; // usado só por 'custom'
  model?: string;
  /** A chave nunca é devolvida em claro para o renderer depois de salva — ver settingsManager. */
  hasKey: boolean;
}

export interface AiSettings {
  defaultProviderId: AiProviderId | null;
  providers: AiProviderConfig[];
}

export interface SlotMeta {
  id: string; // 'own' ou 'opp-01' .. 'opp-20'
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
