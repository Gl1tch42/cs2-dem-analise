import * as fs from 'fs';
import * as path from 'path';
import {
  DemoRecord,
  DemoSummary,
  PlayerScoreAggregate,
  PlayerScoreHistoryEntry,
  PlayerAimStats,
  PlayerUtilityStats,
  PlayerPositioningStats,
  PlayerImpactStats,
  PlayerAggregate,
  RoundSummary,
} from '../storage/types';

// Pesos e faixas-alvo da nota de mira/utility — ponto de partida razoável, não
// uma fórmula validada. Cada sub-métrica é normalizada linearmente contra uma
// faixa-alvo (targetMin -> 0, targetMax -> 100, clampado); quando targetMin >
// targetMax a normalização inverte sozinha (usado pra métricas onde "menor é
// melhor", tipo crosshair placement e dano em aliado). Calibrar olhando
// resultados reais dos jogadores do usuário e ajustar só estas constantes.
interface SubmetricWeight {
  weight: number;
  targetMin: number;
  targetMax: number;
}

// Pesos calibrados a partir de uma matriz de pesos "estilo Leetify" fornecida
// pelo usuário (escala 0-5 por métrica), normalizados aqui pra somar 1.0:
// Accuracy(All) 1.0, Head Accuracy 3.5, HS Kill% 2.0, First Bullet 4.0,
// Spray 3.0, Counter-Strafing 4.5, Crosshair Placement 5.0, Spotted Accuracy
// 2.5, Time to Damage 4.5, Time to Kill 4.0 — soma 34.0, cada peso = X/34.
interface AimWeights {
  accuracy: SubmetricWeight;
  headAccuracy: SubmetricWeight;
  hsKillPct: SubmetricWeight;
  firstBulletAccuracy: SubmetricWeight;
  sprayAccuracy: SubmetricWeight;
  counterStrafePct: SubmetricWeight;
  crosshairPlacement: SubmetricWeight;
  spottedAccuracy: SubmetricWeight;
  timeToDamage: SubmetricWeight;
  timeToKill: SubmetricWeight;
}

// Recalibrado com uma média real de referência: FACEIT Level 10 (o usuário
// forneceu Headshot Accuracy 23%, Accuracy Enemy Spotted 35%, Accuracy All
// Shots 19%, Spray Accuracy 37%, Counter-Strafing 80%, Crosshair Placement
// 8.36°, Time to Damage 535ms — e definiu que essa linha de stats deve valer
// nota de mira ≈82). Sem um segundo ponto de referência (ex: jogador fraco)
// pra travar os dois extremos da escala, o piso (targetMin nas métricas
// "maior é melhor") é uma suposição de ~45% do valor de FACEIT 10, e o teto
// (targetMax) é resolvido pra bater ≈82 no valor de FACEIT 10 — o mesmo em
// espelho pras métricas "menor é melhor" (crosshair/TTD), com o piso em
// ~2.2x o valor de FACEIT 10. hsKillPct/firstBulletAccuracy/timeToKill não
// têm referência ainda, mantidos nos valores anteriores (não recalibrados).
const AIM_SUBMETRIC_WEIGHTS: AimWeights = {
  accuracy: { weight: 0.0294, targetMin: 8, targetMax: 21.4 },
  headAccuracy: { weight: 0.1029, targetMin: 10, targetMax: 25.9 },
  hsKillPct: { weight: 0.0588, targetMin: 20, targetMax: 60 },
  firstBulletAccuracy: { weight: 0.1176, targetMin: 15, targetMax: 45 },
  sprayAccuracy: { weight: 0.0882, targetMin: 17, targetMax: 41.4 },
  counterStrafePct: { weight: 0.1324, targetMin: 36, targetMax: 89.7 },
  crosshairPlacement: { weight: 0.1471, targetMin: 18.4, targetMax: 6.2 },
  spottedAccuracy: { weight: 0.0735, targetMin: 16, targetMax: 39.2 },
  // TTD/TTK: menor é melhor (targetMin = pior/mais lento, targetMax = melhor/mais rápido).
  timeToDamage: { weight: 0.1324, targetMin: 1180, targetMax: 393 },
  timeToKill: { weight: 0.1176, targetMin: 2000, targetMax: 600 },
};

// Pesos calibrados a partir do adendo "Leetify Utility Engine" fornecido pelo
// usuário (escala 0-5): Flashbang Efficiency 4.5, HE Damage 4.0, Molotov
// Damage 3.5, Smoke Impact 3.0, Utility Waste "Alto" (~4.0). Penalidades
// (team flash "severa" ~3.5, dano em aliado, smoke desperdiçada) não vieram
// com peso numérico explícito no adendo — atribuídos por proximidade da
// linguagem usada. Soma 27.5, cada peso = X/27.5. Métricas "menor é melhor"
// (penalidades) têm targetMin = pior/mais alto, targetMax = melhor/zero.
//
// Recalibrado (parcialmente) com uma segunda média de referência FACEIT
// Level 10 fornecida pelo usuário: Enemies Flashed per Flashbang 0.66 (usado
// como aproximação de effectiveFlashPct — vira 66% pra bater na escala do
// campo, já que não veio um número específico pra "flash efetiva" vs
// "qualquer flash"), Friends Flashed per Flashbang 0.5 (mantido como razão
// crua, mesma escala do valor fornecido), Flashbangs Leading to Kills 9%
// (esse sim já em %), Damage to Enemies per HE 8.52, Damage
// to Teammates per HE 0.3 (usado como proxy do teamDamagePenalty completo,
// que na verdade soma HE + molotov — sem dado de molotov ainda), Unused
// Utility on Death $263. O usuário definiu que essa linha de stats deve
// valer nota de utility (parte "quality", antes do blend com quantidade) ≈60
// numa escala 0-100. Método: métricas "maior é melhor" usam piso em ~45% do
// valor de referência (mesma heurística usada na mira) e teto resolvido pra
// bater 60 no valor de referência; penalidades "menor é melhor" mantêm o
// teto fixo em 0 (zero ocorrências = ideal) e o piso é resolvido pra bater 60
// no valor de referência (equivale a piso = valor_referência × 2.5). Métricas
// sem dado de referência (avgMolotovDamage, smokeWastedPenalty) mantidas nos
// valores anteriores, não recalibradas.
interface UtilityQualityWeights {
  effectiveFlashPct: SubmetricWeight;
  friendlyFlashPenalty: SubmetricWeight;
  avgHeDamage: SubmetricWeight;
  avgMolotovDamage: SubmetricWeight;
  teamDamagePenalty: SubmetricWeight;
  smokeWastedPenalty: SubmetricWeight;
  flashKillPct: SubmetricWeight;
  unusedUtilityPenalty: SubmetricWeight;
}

const UTILITY_QUALITY_WEIGHTS: UtilityQualityWeights = {
  effectiveFlashPct: { weight: 0.1636, targetMin: 29.7, targetMax: 90.2 },
  friendlyFlashPenalty: { weight: 0.1273, targetMin: 1.25, targetMax: 0 },
  avgHeDamage: { weight: 0.1455, targetMin: 3.8, targetMax: 11.7 },
  avgMolotovDamage: { weight: 0.1273, targetMin: 5, targetMax: 22 },
  teamDamagePenalty: { weight: 0.1091, targetMin: 0.75, targetMax: 0 },
  smokeWastedPenalty: { weight: 0.1091, targetMin: 0.3, targetMax: 0 },
  // % de flashbangs jogadas que resultaram em kill (flashAssists / flashesThrown),
  // não mais por round — bate com a definição "Flashbangs Leading to Kills" do usuário.
  flashKillPct: { weight: 0.0727, targetMin: 4.1, targetMax: 12.3 },
  unusedUtilityPenalty: { weight: 0.1455, targetMin: 657.5, targetMax: 0 },
};

const UTILITY_QUANTITY_TARGET = { min: 0.3, max: 1.2 }; // granadas jogadas por round
const UTILITY_QUALITY_SHARE = 0.7;
const UTILITY_QUANTITY_SHARE = 0.3;

// Pesos calibrados a partir do adendo "Leetify Positioning Engine" (escala
// 0-5): Trade Kill % & Trade Delay 5.0 (o item mais pesado de todos os três
// adendos — dividido aqui em traded-death rate, isolamento, trade-kill rate e
// delay, já que o adendo trata os quatro como uma coisa só), Opening Dueling
// 4.0, Overexposure 4.0, Distance to Teammates 3.0. Soma 16.0, cada peso =
// X/16. Sem dado de referência real — faixas são heurística a calibrar.
interface PositioningWeights {
  tradedDeathPct: SubmetricWeight;
  isolatedDeathPenalty: SubmetricWeight;
  tradeKillPct: SubmetricWeight;
  tradeDelay: SubmetricWeight;
  openingDuelWinPct: SubmetricWeight;
  overexposurePenalty: SubmetricWeight;
  nearestTeammateDist: SubmetricWeight;
}

const POSITIONING_WEIGHTS: PositioningWeights = {
  tradedDeathPct: { weight: 0.09375, targetMin: 20, targetMax: 55 },
  isolatedDeathPenalty: { weight: 0.09375, targetMin: 40, targetMax: 10 },
  tradeKillPct: { weight: 0.0625, targetMin: 5, targetMax: 25 },
  // Delay: menor é melhor (mais rápido vingando o aliado), dentro da janela de 3s.
  tradeDelay: { weight: 0.0625, targetMin: 2500, targetMax: 1200 },
  openingDuelWinPct: { weight: 0.25, targetMin: 35, targetMax: 65 },
  overexposurePenalty: { weight: 0.25, targetMin: 35, targetMax: 5 },
  // Distância: mais perto do aliado mais próximo é melhor (potencial de trade) —
  // não modela a exceção de Lurker (sem dado de função/role disponível).
  nearestTeammateDist: { weight: 0.1875, targetMin: 1200, targetMax: 400 },
};
// Pesos da nota de "Rating"/Impacto — pedido do usuário (02/09/2026) pra que a
// nota geral também considere kills por mapa, tenha mais peso pra mira e pro
// "rating", e reflita o impacto real de vencer rounds, incluindo o sacrifício
// de morrer primeiro (abrindo informação/espaço) mesmo quando o round ainda
// assim é vencido pelo time. Sem matriz de referência externa pra isso ainda
// (ao contrário de mira/utility, que vieram de adendos "estilo Leetify") —
// faixas são heurística de CS competitivo a calibrar com dados reais depois:
// KPR (kills por round) ruim ~0.5, elite ~1.0; ADR ruim ~60, elite ~95;
// clutch win% baixo ~15%, bom ~50%; sacrifício de abertura (round vencido
// mesmo morrendo primeiro) baixo ~30%, bom ~60% (referência solta: perto do
// win rate geral do time é "neutro", acima disso é a morte tendo valido a pena).
interface ImpactWeights {
  kpr: SubmetricWeight;
  adr: SubmetricWeight;
  clutchWinPct: SubmetricWeight;
  sacrificeOpenPct: SubmetricWeight;
}

const IMPACT_WEIGHTS: ImpactWeights = {
  kpr: { weight: 0.35, targetMin: 0.5, targetMax: 1.0 },
  adr: { weight: 0.3, targetMin: 60, targetMax: 95 },
  clutchWinPct: { weight: 0.15, targetMin: 15, targetMax: 50 },
  sacrificeOpenPct: { weight: 0.2, targetMin: 30, targetMax: 60 },
};

// Split geral: mira e rating/impacto sobem (kills, ADR, clutch, sacrifício de
// abertura entram só no rating pra não duplicar contagem com posicionamento,
// que já cobre quem GANHA o duelo de abertura/trade — rating cobre produção
// crua e o valor de morrer primeiro mesmo perdendo o duelo). Utility e
// posicionamento puro (trade/isolamento/overexposure) encolhem, mas continuam
// entrando — split ajustável, ponto de partida.
const OVERALL_SPLIT = { aim: 0.5, impact: 0.25, utility: 0.15, positioning: 0.1 };

function normalize(value: number, targetMin: number, targetMax: number): number {
  if (targetMax === targetMin) return 50;
  const t = (value - targetMin) / (targetMax - targetMin);
  return Math.max(0, Math.min(100, t * 100));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// Identifica a régua de calibração usada pra gerar o score — bump manual toda
// vez que os blocos de targetMin/targetMax abaixo mudarem (ex: depois de
// rodar scripts/calibrate-scores.js), pra a UI conseguir avisar "a régua
// mudou" em vez de só mostrar um número diferente sem explicação.
export const SCORING_MODEL_VERSION = 'v1-heuristic';

// Confiança do score consolidado — puramente heurística (sem desvio-padrão
// nem intervalo de confiança por trás), combinando 4 sinais independentes do
// próprio score de habilidade: quantas demos, quantos rounds observados
// (uma demo de 12 rounds pesa menos que uma de 30), cobertura de features
// (quantas das submétricas com amostra mínima — crosshair/TTD/TTK/trade
// delay/distância do time — realmente vieram preenchidas, vs null por falta
// de eventos) e qualidade da calibração (se o parser teve amostra suficiente
// em cada demo pra calibrar os thresholds de tempo/stance dinamicamente, ou
// caiu no fallback fixo — ver tempoStanceThresholdSource). Um jogador com
// muitas demos mas dados majoritariamente null/não-calibrados não deve ficar
// "alta confiança" só pelo n de demos — por isso os 4 fatores, não só 1.
export interface ScoreConfidenceFactors {
  demosCount: number;
  roundsSum: number;
  coverageRatio: number; // 0-1: média, nas 5 submétricas nullable, de (contagem não-null / demosCount)
  calibratedRatio: number; // 0-1: fração das demos em que o parser calibrou dinamicamente (não caiu no default)
}

const SCORE_CONFIDENCE_WEIGHTS = { demos: 0.4, rounds: 0.3, coverage: 0.2, calibration: 0.1 };
// Mesmo alvo do antigo limiar "high" só-por-demosCount (8); ~190 rounds ~= 8
// demos de ~24 rounds em média.
const SCORE_CONFIDENCE_TARGETS = { demos: 8, rounds: 190 };
// high=0.75 (não 0.7 = demos+rounds no teto) é proposital: demos+rounds
// sozinhos maxam em 0.4+0.3=0.7, então maximizar só esses dois fatores NUNCA
// basta pra virar "high" — cobertura e/ou calibração precisam contribuir
// também, senão fica em "medium". É esse o ponto central do upgrade.
const SCORE_CONFIDENCE_LEVEL_THRESHOLDS = { medium: 0.35, high: 0.75 };

export function computeScoreConfidence(
  factors: ScoreConfidenceFactors
): { level: 'low' | 'medium' | 'high'; score: number } {
  const demosFactor = Math.min(1, factors.demosCount / SCORE_CONFIDENCE_TARGETS.demos);
  const roundsFactor = Math.min(1, factors.roundsSum / SCORE_CONFIDENCE_TARGETS.rounds);
  const composite =
    demosFactor * SCORE_CONFIDENCE_WEIGHTS.demos +
    roundsFactor * SCORE_CONFIDENCE_WEIGHTS.rounds +
    factors.coverageRatio * SCORE_CONFIDENCE_WEIGHTS.coverage +
    factors.calibratedRatio * SCORE_CONFIDENCE_WEIGHTS.calibration;
  const score = Math.round(composite * 100) / 100;
  const level =
    score >= SCORE_CONFIDENCE_LEVEL_THRESHOLDS.high
      ? 'high'
      : score >= SCORE_CONFIDENCE_LEVEL_THRESHOLDS.medium
        ? 'medium'
        : 'low';
  return { level, score };
}

// KPR fica numa escala pequena (~0.5-1.0) — 1 casa decimal (round1) esmagaria
// a diferença entre jogadores; usado só nesse campo.
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// "Sacrifício de abertura": conta, por demo, quantos rounds esse jogador foi
// a PRIMEIRA morte do round (`rounds[].deaths` já vem ordenado por tick do
// Python) e, desses, quantos o time dele mesmo assim venceu — sinal de que a
// morte comprou informação/espaço que valeu o round, distinto de "ganhar o
// duelo de abertura" (isso já é `openingDuelWinPct` em PlayerPositioningStats).
// Casamento por nome (não steamId) porque é o único identificador disponível
// em `RoundDeath` — mesma limitação que outros campos de round já têm no
// resto do código (ex.: `entryFragBy`/`entryFragOn`).
function computeSacrificeOpens(rounds: RoundSummary[], playerName: string): { opened: number; openedWon: number } {
  let opened = 0;
  let openedWon = 0;
  for (const round of rounds) {
    const firstDeath = round.deaths && round.deaths.length > 0 ? round.deaths[0] : undefined;
    if (!firstDeath || firstDeath.player !== playerName) continue;
    opened++;
    if (firstDeath.side === round.winner) openedWon++;
  }
  return { opened, openedWon };
}

export function computeAimScore(aim: PlayerAimStats): number {
  let sum = 0;
  let totalWeight = 0;
  const add = (value: number, cfg: SubmetricWeight) => {
    sum += normalize(value, cfg.targetMin, cfg.targetMax) * cfg.weight;
    totalWeight += cfg.weight;
  };
  add(aim.accuracy, AIM_SUBMETRIC_WEIGHTS.accuracy);
  add(aim.headAccuracy, AIM_SUBMETRIC_WEIGHTS.headAccuracy);
  add(aim.hsKillPct, AIM_SUBMETRIC_WEIGHTS.hsKillPct);
  add(aim.firstBulletAccuracy, AIM_SUBMETRIC_WEIGHTS.firstBulletAccuracy);
  add(aim.sprayAccuracy, AIM_SUBMETRIC_WEIGHTS.sprayAccuracy);
  add(aim.counterStrafePct, AIM_SUBMETRIC_WEIGHTS.counterStrafePct);
  if (aim.avgCrosshairPlacementDeg !== null) {
    add(aim.avgCrosshairPlacementDeg, AIM_SUBMETRIC_WEIGHTS.crosshairPlacement);
  }
  add(aim.spottedAccuracy, AIM_SUBMETRIC_WEIGHTS.spottedAccuracy);
  if (aim.avgTimeToDamageMs !== null) {
    add(aim.avgTimeToDamageMs, AIM_SUBMETRIC_WEIGHTS.timeToDamage);
  }
  if (aim.avgTimeToKillMs !== null) {
    add(aim.avgTimeToKillMs, AIM_SUBMETRIC_WEIGHTS.timeToKill);
  }
  return totalWeight ? round1(sum / totalWeight) : 0;
}

export function computeUtilityScore(utility: PlayerUtilityStats, roundsInDemo: number): number {
  let sum = 0;
  let totalWeight = 0;
  const add = (value: number, cfg: SubmetricWeight) => {
    sum += normalize(value, cfg.targetMin, cfg.targetMax) * cfg.weight;
    totalWeight += cfg.weight;
  };
  add(utility.effectiveFlashPct, UTILITY_QUALITY_WEIGHTS.effectiveFlashPct);
  // Razão por flashbang jogada, não por round — bate com "Friends Flashed per
  // Flashbang" (mantido como razão crua, não %, pra ficar na mesma escala do
  // valor de referência 0.5 fornecido pelo usuário).
  const friendsFlashedPerFlashbang = utility.flashesThrown ? utility.friendsFlashed / utility.flashesThrown : 0;
  add(friendsFlashedPerFlashbang, UTILITY_QUALITY_WEIGHTS.friendlyFlashPenalty);
  add(utility.avgHeDamage, UTILITY_QUALITY_WEIGHTS.avgHeDamage);
  add(utility.avgMolotovDamage, UTILITY_QUALITY_WEIGHTS.avgMolotovDamage);
  const teamDamage = utility.avgHeTeamDamage + utility.avgMolotovTeamDamage;
  add(teamDamage, UTILITY_QUALITY_WEIGHTS.teamDamagePenalty);
  const smokesWastedPerRound = roundsInDemo ? utility.smokesWasted / roundsInDemo : 0;
  add(smokesWastedPerRound, UTILITY_QUALITY_WEIGHTS.smokeWastedPenalty);
  const flashKillPct = utility.flashesThrown ? (100 * utility.flashAssists) / utility.flashesThrown : 0;
  add(flashKillPct, UTILITY_QUALITY_WEIGHTS.flashKillPct);
  // $ de utility não usada por morte-com-utility-sobrando, não diluído por todos os
  // rounds — bate com "Unused Utility on Death".
  const unusedUtilityPerDeath = utility.unusedUtilityRounds ? utility.unusedUtilityValue / utility.unusedUtilityRounds : 0;
  add(unusedUtilityPerDeath, UTILITY_QUALITY_WEIGHTS.unusedUtilityPenalty);
  const qualityScore = totalWeight ? sum / totalWeight : 0;

  const totalThrown = utility.flashesThrown + utility.smokesThrown + utility.molotovsThrown + utility.heThrown;
  const perRound = roundsInDemo ? totalThrown / roundsInDemo : 0;
  const quantityScore = normalize(perRound, UTILITY_QUANTITY_TARGET.min, UTILITY_QUANTITY_TARGET.max);

  return round1(qualityScore * UTILITY_QUALITY_SHARE + quantityScore * UTILITY_QUANTITY_SHARE);
}

export function computePositioningScore(positioning: PlayerPositioningStats): number {
  let sum = 0;
  let totalWeight = 0;
  const add = (value: number, cfg: SubmetricWeight) => {
    sum += normalize(value, cfg.targetMin, cfg.targetMax) * cfg.weight;
    totalWeight += cfg.weight;
  };
  add(positioning.tradedDeathPct, POSITIONING_WEIGHTS.tradedDeathPct);
  add(positioning.isolatedDeathPct, POSITIONING_WEIGHTS.isolatedDeathPenalty);
  add(positioning.tradeKillPct, POSITIONING_WEIGHTS.tradeKillPct);
  if (positioning.avgTradeDelayMs !== null) {
    add(positioning.avgTradeDelayMs, POSITIONING_WEIGHTS.tradeDelay);
  }
  add(positioning.openingDuelWinPct, POSITIONING_WEIGHTS.openingDuelWinPct);
  add(positioning.overexposedDeathPct, POSITIONING_WEIGHTS.overexposurePenalty);
  if (positioning.avgNearestTeammateDist !== null) {
    add(positioning.avgNearestTeammateDist, POSITIONING_WEIGHTS.nearestTeammateDist);
  }
  return totalWeight ? round1(sum / totalWeight) : 0;
}

export function computeImpactScore(impact: PlayerImpactStats): number {
  let sum = 0;
  let totalWeight = 0;
  const add = (value: number, cfg: SubmetricWeight) => {
    sum += normalize(value, cfg.targetMin, cfg.targetMax) * cfg.weight;
    totalWeight += cfg.weight;
  };
  add(impact.kpr, IMPACT_WEIGHTS.kpr);
  add(impact.adr, IMPACT_WEIGHTS.adr);
  if (impact.clutchesWon + impact.clutchesLost > 0) {
    add(impact.clutchWinPct, IMPACT_WEIGHTS.clutchWinPct);
  }
  if (impact.roundsOpened > 0) {
    add(impact.sacrificeOpenPct, IMPACT_WEIGHTS.sacrificeOpenPct);
  }
  return totalWeight ? round1(sum / totalWeight) : 0;
}

export function computeOverallScore(
  aimScore: number,
  utilityScore: number,
  positioningScore: number,
  impactScore: number
): number {
  return round1(
    aimScore * OVERALL_SPLIT.aim +
      utilityScore * OVERALL_SPLIT.utility +
      positioningScore * OVERALL_SPLIT.positioning +
      impactScore * OVERALL_SPLIT.impact
  );
}

// Monta o `PlayerImpactStats` de UMA demo a partir do `PlayerAggregate` bruto
// (kills/deaths/assists/adr/clutches já vêm prontos do Python) mais o
// sacrifício de abertura, calculado aqui a partir de `rounds` (ver
// `computeSacrificeOpens`).
function buildImpactStats(player: PlayerAggregate, roundsInDemo: number, rounds: RoundSummary[]): PlayerImpactStats {
  const { opened, openedWon } = computeSacrificeOpens(rounds, player.name);
  const { clutchesWon, clutchesLost } = player;
  return {
    kills: player.kills,
    deaths: player.deaths,
    assists: player.assists,
    adr: player.adr,
    kpr: roundsInDemo ? round2(player.kills / roundsInDemo) : 0,
    clutchesWon,
    clutchesLost,
    clutchWinPct: clutchesWon + clutchesLost ? round1((100 * clutchesWon) / (clutchesWon + clutchesLost)) : 0,
    roundsOpened: opened,
    roundsOpenedWon: openedWon,
    sacrificeOpenPct: opened ? round1((100 * openedWon) / opened) : 0,
  };
}

// Acumulador guarda somas cruas (nunca médias parciais encadeadas) — as médias
// só são calculadas uma vez, no fechamento, dividindo pela contagem real de
// demos/eventos. Fazer "(mediaAnterior + novoValor) / 2" a cada demo distorceria
// a primeira demo de cada jogador (média com uma base zerada).
interface PlayerScoreAccumulator {
  name: string;
  demosCount: number;

  shotsFired: number;
  shotsHit: number;
  headHits: number;
  hsKills: number;
  firstBulletShots: number;
  sprayShots: number;
  // headAccuracy e hsKillPct já vêm do Python como % por demo excluindo
  // sniper/shotgun (não dá pra reconstruir só de headHits/shotsHit brutos,
  // que ficam aqui só como total informativo) — por isso são somadas como
  // percentuais por demo e promediadas no fechamento, igual as outras.
  headAccuracySum: number;
  hsKillPctSum: number;
  firstBulletAccuracySum: number;
  sprayAccuracySum: number;
  counterStrafePctSum: number;
  crosshairDegSum: number;
  crosshairDegCount: number;
  spottedAccuracySum: number;
  ttdSumMs: number;
  ttdCount: number;
  ttkSumMs: number;
  ttkCount: number;

  flashesThrown: number;
  smokesThrown: number;
  molotovsThrown: number;
  heThrown: number;
  flashAssists: number;
  enemiesFlashed: number;
  friendsFlashed: number;
  avgBlindTimeSecSum: number;
  avgHeDamageSum: number;
  avgHeTeamDamageSum: number;
  effectiveEnemyFlashes: number;
  avgFriendlyBlindTimeSecSum: number;
  avgMolotovDamageSum: number;
  avgMolotovTeamDamageSum: number;
  smokesWasted: number;
  unusedUtilityValue: number;
  unusedUtilityRounds: number;

  openingDuelWinPctSum: number;
  openingDuelParticipationPctSum: number;
  tradeKills: number;
  tradeKillPctSum: number;
  tradedDeathPctSum: number;
  isolatedDeathPctSum: number;
  tradeDelaySumMs: number;
  tradeDelayCount: number;
  overexposedDeathPctSum: number;
  nearestTeammateDistSum: number;
  nearestTeammateDistCount: number;
  calibratedDemosCount: number;

  // Rating/Impacto: kills/assists somados como total; adr e kpr promediados
  // (kpr sobre a soma real de rounds jogados, não a média das médias por
  // demo, pra não distorcer quando as demos têm contagens de round diferentes).
  kills: number;
  deaths: number;
  assists: number;
  adrSum: number;
  roundsSum: number;
  clutchesWon: number;
  clutchesLost: number;
  roundsOpened: number;
  roundsOpenedWon: number;

  aimScoreSum: number;
  utilityScoreSum: number;
  positioningScoreSum: number;
  impactScoreSum: number;
  overallScoreSum: number;
  history: PlayerScoreHistoryEntry[];
}

function newAccumulator(name: string): PlayerScoreAccumulator {
  return {
    name,
    demosCount: 0,
    shotsFired: 0,
    shotsHit: 0,
    headHits: 0,
    hsKills: 0,
    firstBulletShots: 0,
    sprayShots: 0,
    headAccuracySum: 0,
    hsKillPctSum: 0,
    firstBulletAccuracySum: 0,
    sprayAccuracySum: 0,
    counterStrafePctSum: 0,
    crosshairDegSum: 0,
    crosshairDegCount: 0,
    spottedAccuracySum: 0,
    ttdSumMs: 0,
    ttdCount: 0,
    ttkSumMs: 0,
    ttkCount: 0,
    flashesThrown: 0,
    smokesThrown: 0,
    molotovsThrown: 0,
    heThrown: 0,
    flashAssists: 0,
    enemiesFlashed: 0,
    friendsFlashed: 0,
    avgBlindTimeSecSum: 0,
    avgHeDamageSum: 0,
    avgHeTeamDamageSum: 0,
    effectiveEnemyFlashes: 0,
    avgFriendlyBlindTimeSecSum: 0,
    avgMolotovDamageSum: 0,
    avgMolotovTeamDamageSum: 0,
    smokesWasted: 0,
    unusedUtilityValue: 0,
    unusedUtilityRounds: 0,
    openingDuelWinPctSum: 0,
    openingDuelParticipationPctSum: 0,
    tradeKills: 0,
    tradeKillPctSum: 0,
    tradedDeathPctSum: 0,
    isolatedDeathPctSum: 0,
    tradeDelaySumMs: 0,
    tradeDelayCount: 0,
    overexposedDeathPctSum: 0,
    nearestTeammateDistSum: 0,
    nearestTeammateDistCount: 0,
    calibratedDemosCount: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    adrSum: 0,
    roundsSum: 0,
    clutchesWon: 0,
    clutchesLost: 0,
    roundsOpened: 0,
    roundsOpenedWon: 0,
    aimScoreSum: 0,
    utilityScoreSum: 0,
    positioningScoreSum: 0,
    impactScoreSum: 0,
    overallScoreSum: 0,
    history: [],
  };
}

// Segue o mesmo padrão de leitura de `consolidateSlot` (electron/ai/localHeuristics.ts):
// lê summary.json de cada demo direto do disco, filtra por roster marcado
// (demo.myTeamSteamIds) — só assim dá pra saber quem, entre os 10 jogadores de
// CADA demo, é "nosso" de forma consistente entre demos diferentes.
export function computePlayerScores(slotFolder: string, demos: DemoRecord[]): PlayerScoreAggregate[] {
  const accMap = new Map<string, PlayerScoreAccumulator>();

  for (const demo of demos) {
    const summaryFile = path.join(slotFolder, 'demos', demo.id, 'summary.json');
    if (!fs.existsSync(summaryFile)) continue;
    const myTeamSteamIds = demo.myTeamSteamIds;
    if (!myTeamSteamIds || myTeamSteamIds.length === 0) continue;
    const myIdSet = new Set(myTeamSteamIds);

    const summary: DemoSummary = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
    const roundsInDemo = summary.rounds.length;
    const demoCalibrated = summary.calibration?.tempoStanceThresholdSource === 'demo';

    for (const player of summary.playerAggregates) {
      if (!myIdSet.has(player.steamId)) continue;
      if (!player.aim || !player.utility || !player.positioning) continue; // demo parseada antes desta feature

      const aimScore = computeAimScore(player.aim);
      const utilityScore = computeUtilityScore(player.utility, roundsInDemo);
      const positioningScore = computePositioningScore(player.positioning);
      const impact = buildImpactStats(player, roundsInDemo, summary.rounds);
      const impactScore = computeImpactScore(impact);
      const overallScore = computeOverallScore(aimScore, utilityScore, positioningScore, impactScore);

      const acc = accMap.get(player.steamId) ?? newAccumulator(player.name);
      acc.name = player.name;
      acc.demosCount++;

      acc.shotsFired += player.aim.shotsFired;
      acc.shotsHit += player.aim.shotsHit;
      acc.headHits += player.aim.headHits;
      acc.hsKills += player.aim.hsKills;
      acc.firstBulletShots += player.aim.firstBulletShots;
      acc.sprayShots += player.aim.sprayShots;
      acc.headAccuracySum += player.aim.headAccuracy;
      acc.hsKillPctSum += player.aim.hsKillPct;
      acc.firstBulletAccuracySum += player.aim.firstBulletAccuracy;
      acc.sprayAccuracySum += player.aim.sprayAccuracy;
      acc.counterStrafePctSum += player.aim.counterStrafePct;
      if (player.aim.avgCrosshairPlacementDeg !== null) {
        acc.crosshairDegSum += player.aim.avgCrosshairPlacementDeg;
        acc.crosshairDegCount++;
      }
      acc.spottedAccuracySum += player.aim.spottedAccuracy;
      if (player.aim.avgTimeToDamageMs !== null) {
        acc.ttdSumMs += player.aim.avgTimeToDamageMs;
        acc.ttdCount++;
      }
      if (player.aim.avgTimeToKillMs !== null) {
        acc.ttkSumMs += player.aim.avgTimeToKillMs;
        acc.ttkCount++;
      }

      acc.flashesThrown += player.utility.flashesThrown;
      acc.smokesThrown += player.utility.smokesThrown;
      acc.molotovsThrown += player.utility.molotovsThrown;
      acc.heThrown += player.utility.heThrown;
      acc.flashAssists += player.utility.flashAssists;
      acc.enemiesFlashed += player.utility.enemiesFlashed;
      acc.friendsFlashed += player.utility.friendsFlashed;
      acc.avgBlindTimeSecSum += player.utility.avgBlindTimeSec;
      acc.avgHeDamageSum += player.utility.avgHeDamage;
      acc.avgHeTeamDamageSum += player.utility.avgHeTeamDamage;
      acc.effectiveEnemyFlashes += player.utility.effectiveEnemyFlashes;
      acc.avgFriendlyBlindTimeSecSum += player.utility.avgFriendlyBlindTimeSec;
      acc.avgMolotovDamageSum += player.utility.avgMolotovDamage;
      acc.avgMolotovTeamDamageSum += player.utility.avgMolotovTeamDamage;
      acc.smokesWasted += player.utility.smokesWasted;
      acc.unusedUtilityValue += player.utility.unusedUtilityValue;
      acc.unusedUtilityRounds += player.utility.unusedUtilityRounds;

      acc.openingDuelWinPctSum += player.positioning.openingDuelWinPct;
      acc.openingDuelParticipationPctSum += player.positioning.openingDuelParticipationPct;
      acc.tradeKills += player.positioning.tradeKills;
      acc.tradeKillPctSum += player.positioning.tradeKillPct;
      acc.tradedDeathPctSum += player.positioning.tradedDeathPct;
      acc.isolatedDeathPctSum += player.positioning.isolatedDeathPct;
      if (player.positioning.avgTradeDelayMs !== null) {
        acc.tradeDelaySumMs += player.positioning.avgTradeDelayMs;
        acc.tradeDelayCount++;
      }
      acc.overexposedDeathPctSum += player.positioning.overexposedDeathPct;
      if (player.positioning.avgNearestTeammateDist !== null) {
        acc.nearestTeammateDistSum += player.positioning.avgNearestTeammateDist;
        acc.nearestTeammateDistCount++;
      }
      if (demoCalibrated) acc.calibratedDemosCount++;

      acc.kills += impact.kills;
      acc.deaths += impact.deaths;
      acc.assists += impact.assists;
      acc.adrSum += impact.adr;
      acc.roundsSum += roundsInDemo;
      acc.clutchesWon += impact.clutchesWon;
      acc.clutchesLost += impact.clutchesLost;
      acc.roundsOpened += impact.roundsOpened;
      acc.roundsOpenedWon += impact.roundsOpenedWon;

      acc.aimScoreSum += aimScore;
      acc.utilityScoreSum += utilityScore;
      acc.positioningScoreSum += positioningScore;
      acc.impactScoreSum += impactScore;
      acc.overallScoreSum += overallScore;
      acc.history.push({
        demoId: demo.id,
        demoLabel: demo.fileName,
        map: summary.map,
        addedAt: demo.addedAt,
        aimScore,
        utilityScore,
        positioningScore,
        impactScore,
        overallScore,
        aim: player.aim,
        utility: player.utility,
        positioning: player.positioning,
        impact,
      });

      accMap.set(player.steamId, acc);
    }
  }

  return Array.from(accMap.entries())
    .map(([steamId, acc]) => {
      const coverageRatio = acc.demosCount
        ? [acc.crosshairDegCount, acc.ttdCount, acc.ttkCount, acc.tradeDelayCount, acc.nearestTeammateDistCount].reduce(
            (sum, count) => sum + count / acc.demosCount,
            0
          ) / 5
        : 0;
      const calibratedRatio = acc.demosCount ? acc.calibratedDemosCount / acc.demosCount : 0;
      const confidence = computeScoreConfidence({
        demosCount: acc.demosCount,
        roundsSum: acc.roundsSum,
        coverageRatio,
        calibratedRatio,
      });
      return {
        steamId,
        name: acc.name,
        demosCount: acc.demosCount,
        confidence: confidence.level,
        confidenceScore: confidence.score,
        scoringModelVersion: SCORING_MODEL_VERSION,
        avgAimScore: acc.demosCount ? round1(acc.aimScoreSum / acc.demosCount) : 0,
        avgUtilityScore: acc.demosCount ? round1(acc.utilityScoreSum / acc.demosCount) : 0,
        avgPositioningScore: acc.demosCount ? round1(acc.positioningScoreSum / acc.demosCount) : 0,
        avgImpactScore: acc.demosCount ? round1(acc.impactScoreSum / acc.demosCount) : 0,
        avgOverallScore: acc.demosCount ? round1(acc.overallScoreSum / acc.demosCount) : 0,
        aim: {
          shotsFired: acc.shotsFired,
          shotsHit: acc.shotsHit,
          accuracy: acc.shotsFired ? round1((100 * acc.shotsHit) / acc.shotsFired) : 0,
          headHits: acc.headHits,
          headAccuracy: acc.demosCount ? round1(acc.headAccuracySum / acc.demosCount) : 0,
          hsKills: acc.hsKills,
          hsKillPct: acc.demosCount ? round1(acc.hsKillPctSum / acc.demosCount) : 0,
          firstBulletShots: acc.firstBulletShots,
          firstBulletAccuracy: acc.demosCount ? round1(acc.firstBulletAccuracySum / acc.demosCount) : 0,
          sprayShots: acc.sprayShots,
          sprayAccuracy: acc.demosCount ? round1(acc.sprayAccuracySum / acc.demosCount) : 0,
          counterStrafePct: acc.demosCount ? round1(acc.counterStrafePctSum / acc.demosCount) : 0,
          avgCrosshairPlacementDeg: acc.crosshairDegCount ? round1(acc.crosshairDegSum / acc.crosshairDegCount) : null,
          spottedAccuracy: acc.demosCount ? round1(acc.spottedAccuracySum / acc.demosCount) : 0,
          avgTimeToDamageMs: acc.ttdCount ? round1(acc.ttdSumMs / acc.ttdCount) : null,
          avgTimeToKillMs: acc.ttkCount ? round1(acc.ttkSumMs / acc.ttkCount) : null,
        },
        utility: {
          flashesThrown: acc.flashesThrown,
          smokesThrown: acc.smokesThrown,
          molotovsThrown: acc.molotovsThrown,
          heThrown: acc.heThrown,
          flashAssists: acc.flashAssists,
          enemiesFlashed: acc.enemiesFlashed,
          enemiesFlashedPct: acc.flashesThrown ? round1((100 * acc.enemiesFlashed) / acc.flashesThrown) : 0,
          friendsFlashed: acc.friendsFlashed,
          avgBlindTimeSec: acc.demosCount ? round1(acc.avgBlindTimeSecSum / acc.demosCount) : 0,
          avgHeDamage: acc.demosCount ? round1(acc.avgHeDamageSum / acc.demosCount) : 0,
          avgHeTeamDamage: acc.demosCount ? round1(acc.avgHeTeamDamageSum / acc.demosCount) : 0,
          effectiveEnemyFlashes: acc.effectiveEnemyFlashes,
          effectiveFlashPct: acc.flashesThrown ? round1((100 * acc.effectiveEnemyFlashes) / acc.flashesThrown) : 0,
          avgFriendlyBlindTimeSec: acc.demosCount ? round1(acc.avgFriendlyBlindTimeSecSum / acc.demosCount) : 0,
          avgMolotovDamage: acc.demosCount ? round1(acc.avgMolotovDamageSum / acc.demosCount) : 0,
          avgMolotovTeamDamage: acc.demosCount ? round1(acc.avgMolotovTeamDamageSum / acc.demosCount) : 0,
          smokesWasted: acc.smokesWasted,
          unusedUtilityValue: acc.unusedUtilityValue,
          unusedUtilityRounds: acc.unusedUtilityRounds,
        },
        positioning: {
          openingDuelWinPct: acc.demosCount ? round1(acc.openingDuelWinPctSum / acc.demosCount) : 0,
          openingDuelParticipationPct: acc.demosCount
            ? round1(acc.openingDuelParticipationPctSum / acc.demosCount)
            : 0,
          tradeKills: acc.tradeKills,
          tradeKillPct: acc.demosCount ? round1(acc.tradeKillPctSum / acc.demosCount) : 0,
          tradedDeathPct: acc.demosCount ? round1(acc.tradedDeathPctSum / acc.demosCount) : 0,
          isolatedDeathPct: acc.demosCount ? round1(acc.isolatedDeathPctSum / acc.demosCount) : 0,
          avgTradeDelayMs: acc.tradeDelayCount ? round1(acc.tradeDelaySumMs / acc.tradeDelayCount) : null,
          overexposedDeathPct: acc.demosCount ? round1(acc.overexposedDeathPctSum / acc.demosCount) : 0,
          avgNearestTeammateDist: acc.nearestTeammateDistCount
            ? round1(acc.nearestTeammateDistSum / acc.nearestTeammateDistCount)
            : null,
        },
        impact: {
          kills: acc.kills,
          deaths: acc.deaths,
          assists: acc.assists,
          adr: acc.demosCount ? round1(acc.adrSum / acc.demosCount) : 0,
          kpr: acc.roundsSum ? round2(acc.kills / acc.roundsSum) : 0,
          clutchesWon: acc.clutchesWon,
          clutchesLost: acc.clutchesLost,
          clutchWinPct:
            acc.clutchesWon + acc.clutchesLost ? round1((100 * acc.clutchesWon) / (acc.clutchesWon + acc.clutchesLost)) : 0,
          roundsOpened: acc.roundsOpened,
          roundsOpenedWon: acc.roundsOpenedWon,
          sacrificeOpenPct: acc.roundsOpened ? round1((100 * acc.roundsOpenedWon) / acc.roundsOpened) : 0,
        },
        history: acc.history.sort((a, b) => a.addedAt.localeCompare(b.addedAt)),
      };
    })
    .sort((a, b) => b.avgOverallScore - a.avgOverallScore);
}
