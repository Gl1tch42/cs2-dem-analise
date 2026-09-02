#!/usr/bin/env node
/**
 * Recalibra as faixas-alvo (targetMin/targetMax) do scoreEngine a partir de
 * percentis reais, em vez do ponto único (1 stat-line FACEIT Lvl 10) usado
 * hoje. NÃO edita electron/ai/scoreEngine.ts automaticamente — imprime um
 * relatório com os valores sugeridos pra colar manualmente, porque cada
 * bloco de pesos em scoreEngine.ts carrega comentários de proveniência
 * (de onde veio cada número) que um script não deveria sobrescrever sem
 * revisão humana.
 *
 * Uso:
 *   node scripts/calibrate-scores.js <pasta-com-demos> [--low=15] [--high=85] [--min-samples=15]
 *
 * <pasta-com-demos> é qualquer diretório que contenha, em qualquer
 * profundidade, arquivos summary.json (o formato salvo em
 * slots/<slot-id>/demos/<demo-id>/summary.json). Pode apontar direto pra
 * pasta `slots` inteira do userData do app — o script varre tudo.
 *
 * Usa os 10 jogadores de cada demo (não só o roster marcado como "seu
 * time"), porque pra calibração o que importa é ter uma distribuição ampla
 * de níveis, não filtrar por time.
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { root: null, low: 15, high: 85, minSamples: 15 };
  for (const arg of argv) {
    if (arg.startsWith('--low=')) args.low = Number(arg.slice(6));
    else if (arg.startsWith('--high=')) args.high = Number(arg.slice(7));
    else if (arg.startsWith('--min-samples=')) args.minSamples = Number(arg.slice(14));
    else if (!arg.startsWith('--')) args.root = arg;
  }
  return args;
}

function findSummaryFiles(root) {
  const results = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name === 'summary.json') results.push(full);
    }
  }
  return results;
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return null;
  if (sortedArr.length === 1) return sortedArr[0];
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

// Réplica local de computeSacrificeOpens (electron/ai/scoreEngine.ts) — casamento
// por nome, mesma limitação do original (RoundDeath só carrega nome, não steamId).
function computeSacrificeOpens(rounds, playerName) {
  let opened = 0;
  let openedWon = 0;
  for (const round of rounds || []) {
    const firstDeath = round.deaths && round.deaths.length > 0 ? round.deaths[0] : undefined;
    if (!firstDeath || firstDeath.player !== playerName) continue;
    opened++;
    if (firstDeath.side === round.winner) openedWon++;
  }
  return { opened, openedWon };
}

// Mesmas faixas-alvo hoje vigentes em electron/ai/scoreEngine.ts (só a parte
// targetMin/targetMax — os pesos "weight" não mudam aqui, então nem entram).
// Se scoreEngine.ts mudar essas faixas, atualizar aqui também pra o relatório
// mostrar o "antes" certo.
const METRICS = [
  { cat: 'aim', key: 'accuracy', higherIsBetter: true, current: [8, 21.4], get: (p) => p.aim.accuracy },
  { cat: 'aim', key: 'headAccuracy', higherIsBetter: true, current: [10, 25.9], get: (p) => p.aim.headAccuracy },
  { cat: 'aim', key: 'hsKillPct', higherIsBetter: true, current: [20, 60], get: (p) => p.aim.hsKillPct },
  { cat: 'aim', key: 'firstBulletAccuracy', higherIsBetter: true, current: [15, 45], get: (p) => p.aim.firstBulletAccuracy },
  { cat: 'aim', key: 'sprayAccuracy', higherIsBetter: true, current: [17, 41.4], get: (p) => p.aim.sprayAccuracy },
  { cat: 'aim', key: 'counterStrafePct', higherIsBetter: true, current: [36, 89.7], get: (p) => p.aim.counterStrafePct },
  { cat: 'aim', key: 'crosshairPlacement', higherIsBetter: false, current: [18.4, 6.2], get: (p) => p.aim.avgCrosshairPlacementDeg },
  { cat: 'aim', key: 'spottedAccuracy', higherIsBetter: true, current: [16, 39.2], get: (p) => p.aim.spottedAccuracy },
  { cat: 'aim', key: 'timeToDamage', higherIsBetter: false, current: [1180, 393], get: (p) => p.aim.avgTimeToDamageMs },
  { cat: 'aim', key: 'timeToKill', higherIsBetter: false, current: [2000, 600], get: (p) => p.aim.avgTimeToKillMs },

  { cat: 'utility', key: 'effectiveFlashPct', higherIsBetter: true, current: [29.7, 90.2], get: (p) => p.utility.effectiveFlashPct },
  {
    cat: 'utility',
    key: 'friendlyFlashPenalty',
    higherIsBetter: false,
    current: [1.25, 0],
    get: (p) => (p.utility.flashesThrown ? p.utility.friendsFlashed / p.utility.flashesThrown : null),
  },
  { cat: 'utility', key: 'avgHeDamage', higherIsBetter: true, current: [3.8, 11.7], get: (p) => p.utility.avgHeDamage },
  { cat: 'utility', key: 'avgMolotovDamage', higherIsBetter: true, current: [5, 22], get: (p) => p.utility.avgMolotovDamage },
  {
    cat: 'utility',
    key: 'teamDamagePenalty',
    higherIsBetter: false,
    current: [0.75, 0],
    get: (p) => p.utility.avgHeTeamDamage + p.utility.avgMolotovTeamDamage,
  },
  {
    cat: 'utility',
    key: 'smokeWastedPenalty',
    higherIsBetter: false,
    current: [0.3, 0],
    get: (p, roundsInDemo) => (roundsInDemo ? p.utility.smokesWasted / roundsInDemo : null),
  },
  {
    cat: 'utility',
    key: 'flashKillPct',
    higherIsBetter: true,
    current: [4.1, 12.3],
    get: (p) => (p.utility.flashesThrown ? (100 * p.utility.flashAssists) / p.utility.flashesThrown : null),
  },
  {
    cat: 'utility',
    key: 'unusedUtilityPenalty',
    higherIsBetter: false,
    current: [657.5, 0],
    get: (p) => (p.utility.unusedUtilityRounds ? p.utility.unusedUtilityValue / p.utility.unusedUtilityRounds : null),
  },

  { cat: 'positioning', key: 'tradedDeathPct', higherIsBetter: true, current: [20, 55], get: (p) => p.positioning.tradedDeathPct },
  { cat: 'positioning', key: 'isolatedDeathPenalty', higherIsBetter: false, current: [40, 10], get: (p) => p.positioning.isolatedDeathPct },
  { cat: 'positioning', key: 'tradeKillPct', higherIsBetter: true, current: [5, 25], get: (p) => p.positioning.tradeKillPct },
  { cat: 'positioning', key: 'tradeDelay', higherIsBetter: false, current: [2500, 1200], get: (p) => p.positioning.avgTradeDelayMs },
  { cat: 'positioning', key: 'openingDuelWinPct', higherIsBetter: true, current: [35, 65], get: (p) => p.positioning.openingDuelWinPct },
  { cat: 'positioning', key: 'overexposurePenalty', higherIsBetter: false, current: [35, 5], get: (p) => p.positioning.overexposedDeathPct },
  { cat: 'positioning', key: 'nearestTeammateDist', higherIsBetter: false, current: [1200, 400], get: (p) => p.positioning.avgNearestTeammateDist },

  { cat: 'impact', key: 'kpr', higherIsBetter: true, current: [0.5, 1.0], get: (p, roundsInDemo) => (roundsInDemo ? p.kills / roundsInDemo : null) },
  { cat: 'impact', key: 'adr', higherIsBetter: true, current: [60, 95], get: (p) => p.adr },
  {
    cat: 'impact',
    key: 'clutchWinPct',
    higherIsBetter: true,
    current: [15, 50],
    get: (p) => (p.clutchesWon + p.clutchesLost ? (100 * p.clutchesWon) / (p.clutchesWon + p.clutchesLost) : null),
  },
  {
    cat: 'impact',
    key: 'sacrificeOpenPct',
    higherIsBetter: true,
    current: [30, 60],
    get: (p, _rounds, sacrifice) => (sacrifice.opened ? (100 * sacrifice.openedWon) / sacrifice.opened : null),
  },
];

function round2(v) {
  return Math.round(v * 100) / 100;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.root) {
    console.error('Uso: node scripts/calibrate-scores.js <pasta-com-demos> [--low=15] [--high=85] [--min-samples=15]');
    process.exit(1);
  }
  const root = path.resolve(args.root);
  if (!fs.existsSync(root)) {
    console.error(`Pasta não encontrada: ${root}`);
    process.exit(1);
  }

  const summaryFiles = findSummaryFiles(root);
  if (summaryFiles.length === 0) {
    console.error(`Nenhum summary.json encontrado sob ${root}.`);
    process.exit(1);
  }

  const samples = new Map(); // "cat.key" -> number[]
  let playersSeen = 0;

  for (const file of summaryFiles) {
    let summary;
    try {
      summary = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (err) {
      console.error(`Falha lendo ${file}: ${err.message}`);
      continue;
    }
    const roundsInDemo = (summary.rounds || []).length;
    for (const player of summary.playerAggregates || []) {
      if (!player.aim || !player.utility || !player.positioning) continue;
      playersSeen++;
      const sacrifice = computeSacrificeOpens(summary.rounds, player.name);
      for (const metric of METRICS) {
        const value = metric.get(player, roundsInDemo, sacrifice);
        if (value === null || value === undefined || Number.isNaN(value)) continue;
        const id = `${metric.cat}.${metric.key}`;
        if (!samples.has(id)) samples.set(id, []);
        samples.get(id).push(value);
      }
    }
  }

  console.log(`Demos encontradas: ${summaryFiles.length}`);
  console.log(`Amostras jogador-por-demo (ambos os times, todas as demos): ${playersSeen}`);
  console.log(`Percentis usados: p${args.low} (pior) / p${args.high} (melhor)\n`);

  const header = ['categoria.métrica', 'n', 'p50 atual→sugerido', 'targetMin (atual→sugerido)', 'targetMax (atual→sugerido)', ''];
  console.log(header.join(' | '));

  let anyLowSample = false;
  for (const metric of METRICS) {
    const id = `${metric.cat}.${metric.key}`;
    const arr = (samples.get(id) || []).slice().sort((a, b) => a - b);
    const n = arr.length;
    const lowSample = n < args.minSamples;
    if (lowSample) anyLowSample = true;

    const pLow = percentile(arr, args.low);
    const pHigh = percentile(arr, args.high);
    const pMid = percentile(arr, 50);

    const suggestedMin = metric.higherIsBetter ? pLow : pHigh;
    const suggestedMax = metric.higherIsBetter ? pHigh : pLow;
    const [curMin, curMax] = metric.current;

    const fmt = (v) => (v === null ? '—' : round2(v));
    const flag = lowSample ? ' ⚠ amostra baixa' : '';

    console.log(
      `${id} | n=${n} | p50=${fmt(pMid)} | ${curMin} → ${fmt(suggestedMin)} | ${curMax} → ${fmt(suggestedMax)}${flag}`
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  console.log(`\nSugestão de versão pro modelo recalibrado: v2-percentile-N${playersSeen}-${today}`);
  console.log(
    'Isso é só um relatório — copie os valores de targetMin/targetMax pra dentro dos blocos ' +
      'AIM_SUBMETRIC_WEIGHTS / UTILITY_QUALITY_WEIGHTS / POSITIONING_WEIGHTS / IMPACT_WEIGHTS em ' +
      'electron/ai/scoreEngine.ts manualmente (mantendo os `weight` como estão), e atualize ' +
      'SCORING_MODEL_VERSION no mesmo arquivo.'
  );
  if (anyLowSample) {
    console.log(
      '\n⚠ Pelo menos uma métrica tem menos amostras que --min-samples ' +
        `(${args.minSamples}). Sugestões com amostra baixa são pouco confiáveis — ` +
        'considere juntar mais demos (principalmente de níveis variados, não só do seu time) antes de aplicar.'
    );
  }
}

main();
