import { SlotManager } from '../storage/slotManager';
import { SettingsManager } from '../storage/settingsManager';
import { AiProviderId, BuyType, PlayerScoreAggregate, RoundStance, RoundTempo } from '../storage/types';
import { ConsolidatedSlotStats, TeamTendencyStats, consolidateSlot } from './localHeuristics';
import { computePlayerScores } from './scoreEngine';
import { callAiProvider } from './providers';

const BUY_TYPE_LABEL: Record<BuyType, string> = {
  eco: 'Eco',
  force: 'Force buy',
  semi: 'Semi buy',
  full: 'Full buy',
  unknown: 'Desconhecido',
};
const TEMPO_LABEL: Record<RoundTempo, string> = {
  rush: 'Rush',
  slow: 'Slow',
  default: 'Default',
  split: 'Split',
  unknown: 'Desconhecido',
};
const STANCE_LABEL: Record<RoundStance, string> = {
  aggressive: 'Agressivo',
  passive: 'Passivo',
  'passive-aggressive': 'Passivo-agressivo',
  unknown: 'Desconhecido',
};

const MIN_PATTERN_SAMPLE = 2;

const pct = (n: number) => `${Math.round(n * 100)}%`;

function tendencyTable<K extends string>(
  data: Record<K, { count: number; winRate: number }>,
  labels: Record<K, string>
): string {
  const rows = (Object.keys(data) as K[])
    .filter((k) => data[k].count > 0)
    .sort((a, b) => data[b].count - data[a].count)
    .map((k) => `| ${labels[k]} | ${data[k].count} | ${pct(data[k].winRate)} |`);
  if (rows.length === 0) return '(sem dados)';
  return ['| Categoria | Rounds | Win rate |', '|---|---|---|', ...rows].join('\n');
}

function patternsTable(patterns: TeamTendencyStats['topRecurringPatterns'], order: 'best' | 'worst'): string {
  const filtered = patterns.filter(
    (p) => p.count >= MIN_PATTERN_SAMPLE && (order === 'best' ? p.winRate >= 0.5 : p.winRate < 0.5)
  );
  if (filtered.length === 0) return '(sem padrão com amostra suficiente)';
  const sorted = [...filtered].sort((a, b) => (order === 'best' ? b.winRate - a.winRate : a.winRate - b.winRate));
  const rows = sorted.map((p) => `| ${p.pattern} | ${p.count} | ${pct(p.winRate)} |`);
  return ['| Padrão (compra/ritmo/postura/site) | Ocorrências | Win rate |', '|---|---|---|', ...rows].join('\n');
}

function playersTable(players: TeamTendencyStats['playerMovementProfile'], focusIds?: Set<string>): string {
  if (players.length === 0) return '(sem dados)';
  const rows = players.map((p) => {
    const areas = p.topAreas.map((a) => `${a.area} (${a.count}x)`).join(', ') || '—';
    const isFocus = focusIds && focusIds.has(p.steamId);
    const name = isFocus ? `**${p.name} 🎯**` : p.name;
    return `| ${name} | ${p.avgAdr} | ${pct(p.entryRate)} | ${pct(p.clutchRate)} | ${p.kills} | ${p.deaths} | ${areas} |`;
  });
  return [
    '| Jogador | ADR médio | Entry rate | Clutch rate | Kills | Deaths | Áreas mais visitadas |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function aimUtilityTable(players: PlayerScoreAggregate[], focusIds?: Set<string>): string {
  if (players.length === 0) {
    return '(sem dados de mira/utility ainda — precisa de pelo menos 1 demo com o time do slot marcado)';
  }
  const rows = players.map((p) => {
    const isFocus = focusIds && focusIds.has(p.steamId);
    const name = isFocus ? `**${p.name} 🎯**` : p.name;
    const a = p.aim;
    const u = p.utility;
    const cross = a.avgCrosshairPlacementDeg !== null ? `${a.avgCrosshairPlacementDeg}°` : '—';
    const ttd = a.avgTimeToDamageMs !== null ? `${a.avgTimeToDamageMs}ms` : '—';
    const ttk = a.avgTimeToKillMs !== null ? `${a.avgTimeToKillMs}ms` : '—';
    return (
      `| ${name} | ${p.avgOverallScore} | ${p.avgAimScore} | ${p.avgUtilityScore} | ${a.accuracy}% | ` +
      `${a.headAccuracy}% | ${a.hsKillPct}% | ${a.counterStrafePct}% | ${cross} | ${a.spottedAccuracy}% | ` +
      `${ttd} | ${ttk} | ${u.flashesThrown} | ${u.enemiesFlashedPct}% | ${u.flashAssists} | ${u.avgHeDamage} | ${u.avgHeTeamDamage} |`
    );
  });
  return [
    '| Jogador | Nota Geral | Nota Mira | Nota Utility | Accuracy | Head Acc. | HS Kill% | ' +
      'Counter-Strafe | Crosshair | Spotted Acc. | TTD | TTK | Flashes | Enemies Flashed | Flash Assists | Avg HE Dmg | Avg HE Team Dmg |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

// Tendência por demo, em ordem cronológica — compacto (uma linha por jogador)
// pra não estourar o prompt mesmo com muitas demos no slot; dá pro modelo
// enxergar "melhorou/piorou ao longo do tempo" sem precisar de uma tabela
// gigante por jogador.
function aimUtilityHistoryLines(players: PlayerScoreAggregate[]): string {
  const withHistory = players.filter((p) => p.history.length > 0);
  if (withHistory.length === 0) return '(sem histórico por demo ainda)';
  const lines = withHistory.map((p) => {
    const trend = p.history
      .map((h) => `${h.demoLabel} (${new Date(h.addedAt).toLocaleDateString('pt-BR')}): nota ${h.overallScore}`)
      .join(' → ');
    return `- **${p.name}**: ${trend}`;
  });
  return lines.join('\n');
}

function siteTable(dist: Record<string, number>): string {
  const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return '(sem dados)';
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  const rows = entries.map(([site, n]) => `| ${site} | ${n} | ${pct(n / total)} |`);
  return ['| Site | Rounds | % do total |', '|---|---|---|', ...rows].join('\n');
}

function teamSection(heading: string, playerNames: string, team: TeamTendencyStats, focusIds?: Set<string>): string {
  return [
    `## ${heading}`,
    playerNames ? `Jogadores: ${playerNames}` : '(sem jogadores identificados)',
    '',
    '### Tendências por tipo de compra',
    tendencyTable(team.tendencyByBuyType, BUY_TYPE_LABEL),
    '',
    '### Tendências por ritmo',
    tendencyTable(team.tendencyByTempo, TEMPO_LABEL),
    '',
    '### Tendências por postura',
    tendencyTable(team.tendencyByStance, STANCE_LABEL),
    '',
    '### O que funcionou (padrões com win rate ≥ 50%)',
    patternsTable(team.topRecurringPatterns, 'best'),
    '',
    '### O que não funcionou (padrões com win rate < 50%)',
    patternsTable(team.topRecurringPatterns, 'worst'),
    '',
    '### Perfil de movimentação e desempenho por jogador',
    ...(focusIds && focusIds.size > 0
      ? ['(🎯 = jogador em foco pedido pra esta análise — priorize-o(s) na resposta)']
      : []),
    playersTable(team.playerMovementProfile, focusIds),
  ].join('\n');
}

const SYSTEM_PROMPT_OWN = `Você é um head coach de CS (Counter-Strike) de nível internacional — o perfil de treinador
que a mídia da cena cita como referência: leitura de tática e timing como um IGL de elite, olho
pra crosshair placement, posicionamento e movimentação como os melhores especialistas de
aim/movement, e faro pra transformar dado frio em plano de treino que um jogador consegue executar
amanhã. Você já revisou centenas de demos de times competitivos e sabe separar sinal de ruído em
amostra pequena. Quem vai ler sua resposta é o técnico e os próprios jogadores — seja direto,
honesto e específico, sem enrolação corporativa e sem elogio vazio.

Você recebe SOMENTE dados já resumidos (não posições cruas nem a demo inteira) e as anotações
manuais do analista humano. Os dados vêm em DUAS seções bem separadas — "Seu Time" (o time do
slot) e "Adversário" (quem jogou contra nesses confrontos) — cada round foi atribuído ao lado
ct/t certo (o time troca de lado no intervalo, então isso já foi corrigido pra você). NUNCA troque
as seções: um padrão listado em "Adversário" é coisa que o ADVERSÁRIO faz, não o time do slot — se
o adversário vence fazendo rush, isso não quer dizer que o time do slot vence fazendo rush.

FOCO DA ANÁLISE (leia a linha "Foco solicitado" no início do prompt do usuário):
- Se o foco pedir um ou poucos jogadores específicos (marcados com 🎯 nas tabelas), a MAIOR PARTE
  do relatório deve girar em torno deles: decisões, timing de entrada, taxa de clutch, áreas do
  mapa onde mais atuam, e o que cada um precisa treinar pra melhorar. Cite outros jogadores do time
  só quando forem relevantes pro contexto de quem está em foco (ex: quem cobre a entrada dele, com
  quem ele costuma trocar). Não gaste espaço detalhando quem está fora do foco.
- Se o foco for o time inteiro, distribua a profundidade igualmente entre todos os jogadores com
  dados suficientes (não force um parágrafo pra quem tem amostra baixa demais — diga que a amostra
  é pequena em vez de inventar leitura).
- Isso vale mesmo com muitas demos consolidadas: os dados já vêm agregados de todas as partidas do
  slot, então trate os números como a tendência do jogador/time ao longo de todo esse histórico,
  não de uma partida isolada.

Seu trabalho:
1. Achar padrões de jogada que se repetem em CADA time (o que cada um costuma fazer).
2. Dizer com evidência (contagens/winRate) o que funciona e o que não funciona pra CADA time,
   sem misturar as duas seções.
3. Cruzar as duas seções quando fizer sentido: ex. se o adversário costuma rush B e o time do
   slot tem win rate baixo defendendo contra tempo rush, isso é um alerta tático concreto.
4. Avaliar qualidades e lacunas individuais dos jogadores em foco com base nas métricas agregadas
   (ADR, entry rate, clutch rate, kills/deaths, áreas mais visitadas) — sempre ligando o número a
   uma recomendação prática, não só descrevendo o número.
5. Usar a tabela "Mira e utility consolidados" pra avaliar mecânica individual: accuracy, head
   accuracy, HS kill%, counter-strafing, crosshair placement (grau — menor é melhor), spotted
   accuracy, time to damage/kill (ms — menor é melhor), e a qualidade/quantidade de utility
   (flashes jogadas, % de inimigos cegados, flash assists, dano de HE em inimigo vs. em aliado).
   Um valor "—" significa que não há amostra suficiente pra essa métrica nessa demo/jogador — não
   invente uma leitura pra ela, diga que falta amostra.
6. Usar "Evolução da nota geral por demo" pra dizer se cada jogador está melhorando, piorando ou
   estável ao longo das partidas — isso é tão relevante quanto o valor consolidado atual pro plano
   de treino.
7. Quando uma jogada deu errado, não generalizar — apontar que ela falhou "porque falhou" nesse
   contexto específico, sem inventar causas que não estão nos dados.
8. Levar em conta as anotações do analista humano como contexto qualitativo, não como fato bruto.
9. Nunca inventar estatística, tendência de movimentação, mira/utility ou uso de utilitário que não
   esteja literalmente nas tabelas fornecidas — se a informação não existe nos dados, diga que não
   dá pra afirmar isso com os dados disponíveis, em vez de supor.

FORMATO DE SAÍDA — escreva como um relatório pronto pra ser entregue ao time (o tipo de documento
que viraria um PDF de scouting/report interno), em Markdown, com exatamente estas seções:
1. **Resumo executivo** — 3 a 5 bullets com o diagnóstico mais importante desta análise.
2. **Diagnóstico coletivo** — padrões de compra/ritmo/postura que funcionam e que não funcionam,
   pra cada time, com a evidência (contagem/winRate) entre parênteses.
3. **Diagnóstico individual** — uma subseção por jogador em foco (ou por todos os jogadores do
   time do slot, se o foco pedido for o time inteiro), cada uma com: pontos fortes, pontos a
   melhorar, leitura de posicionamento/movimentação com base nas áreas mais visitadas, leitura de
   mira/mecânica (accuracy, crosshair placement, counter-strafing, time to damage/kill) e de
   utility (qualidade e quantidade), e se a tendência ao longo das demos é de melhora ou piora.
4. **Plano de treino recomendado** — uma ação concreta e específica por ponto fraco identificado
   (tipo de treino de aim/movement, cenário de retake/execução pra praticar, o que revisar na
   próxima demo). Nada genérico tipo "jogue mais" — cada recomendação tem que estar amarrada ao
   dado que a gerou.
5. **Alertas táticos pro próximo confronto** — cruzamentos entre o que o adversário costuma fazer
   e como o time do slot historicamente responde a isso.
Responda em português, em tópicos curtos e objetivos, deixando claro de qual time/jogador cada
ponto fala. Não invente números que não estão nos dados.`;

const SYSTEM_PROMPT_OPPONENT = `Você é um analista de scouting / opposition coach de CS (Counter-Strike) de nível
internacional — o tipo de analista que a mídia da cena credita quando um time chega pro confronto
com um game plan certeiro contra um rival específico. Você pensa como um IGL de elite quando lê
tendência de tempo/postura, como os melhores especialistas de aim/movement quando lê posicionamento,
e como um scout que vive estudando VOD de adversário pra achar a brecha que vira round. Quem vai ler
sua resposta é o técnico e o IGL do time, que vão usar isso pra montar o plano de jogo do próximo
confronto contra esse adversário — seja direto, específico e acionável, sem enrolação corporativa.

Você recebe SOMENTE dados já resumidos (não posições cruas nem a demo inteira) e as anotações
manuais do analista humano. Os dados vêm em DUAS seções bem separadas — "Time-alvo" (o adversário
que este relatório de scouting analisa) e quem enfrentou esse adversário nessas demos — cada round
foi atribuído ao lado ct/t certo (o time troca de lado no intervalo, então isso já foi corrigido pra
você). NUNCA troque as seções: um padrão listado na seção do time-alvo é coisa que ELE faz, não o
que quem jogou contra ele faz.

FOCO DA ANÁLISE (leia a linha "Foco solicitado" no início do prompt do usuário):
- Se o foco pedir um ou poucos jogadores específicos do time-alvo (marcados com 🎯 nas tabelas), a
  MAIOR PARTE do relatório deve girar em torno de como neutralizar ou explorar esse(s) jogador(es):
  timing de entrada, taxa de clutch, áreas do mapa onde mais atua, e como isolar ou punir esse
  padrão. Cite outros jogadores do time-alvo só quando forem relevantes pro contexto de quem está
  em foco. Não gaste espaço detalhando quem está fora do foco.
- Se o foco for o time-alvo inteiro, distribua a profundidade igualmente entre todos os jogadores
  com dados suficientes (não force leitura em quem tem amostra baixa demais — diga que a amostra é
  pequena em vez de inventar).
- Isso vale mesmo com muitas demos consolidadas: os dados já vêm agregados de todas as partidas
  desse adversário no slot, então trate os números como a tendência dele ao longo desse histórico
  inteiro, não de uma partida isolada.

Seu trabalho:
1. Achar os padrões de jogada que o time-alvo repete (compra, ritmo, postura, site) — o que ele
   costuma fazer e com que frequência.
2. Dizer com evidência (contagens/winRate) quais desses padrões são pontos fortes (a respeitar) e
   quais são vulnerabilidades reais (com amostra suficiente pra confiar, não ruído de amostra
   pequena).
3. Cruzar as duas seções quando fizer sentido: ex. se o time-alvo tem win rate baixo defendendo
   contra rush, isso vira uma recomendação concreta de ataque pro próximo confronto.
4. Avaliar jogadores em foco do time-alvo com base nas métricas agregadas (ADR, entry rate, clutch
   rate, kills/deaths, áreas mais visitadas) e traduzir isso em como jogar contra eles especificamente
   (ex: quem isolar 1x1, quem não deixar entrar sozinho, onde ele costuma clutchar).
5. Usar a tabela "Mira e utility consolidados" pra identificar a mecânica de cada jogador do
   time-alvo: accuracy, head accuracy, HS kill%, counter-strafing, crosshair placement (grau — menor
   é melhor), spotted accuracy, time to damage/kill (ms — menor é melhor), e como ele usa utility
   (quantidade, % de inimigos cegados, flash assists, dano de HE) — isso vira recomendação de quem
   duelar, quem evitar de frente, e onde a utility dele costuma pegar. Um valor "—" significa amostra
   insuficiente pra essa métrica — não invente leitura pra ela.
6. Usar "Evolução da nota geral por demo" pra apontar se algum jogador do time-alvo está em alta ou
   em baixa recentemente — isso muda a prioridade de quem explorar no próximo confronto.
7. Quando um padrão do time-alvo falhou, não generalizar — aponte que falhou "nesse contexto
   específico", sem inventar causa que não está nos dados.
8. Levar em conta as anotações do analista humano como contexto qualitativo, não como fato bruto.
9. Nunca inventar estatística, tendência de movimentação, mira/utility ou uso de utilitário que não
   esteja literalmente nas tabelas fornecidas — se a informação não existe nos dados, diga que não dá
   pra afirmar isso com os dados disponíveis, em vez de supor.

FORMATO DE SAÍDA — escreva como um relatório de scouting pronto pra ser entregue ao time antes do
confronto (o tipo de documento que viraria um PDF de prep de jogo), em Markdown, com exatamente
estas seções:
1. **Resumo executivo** — 3 a 5 bullets com o que mais importa saber sobre esse adversário.
2. **Pontos fortes do time-alvo** — o que ele faz bem e que o nosso time precisa respeitar/se
   preparar pra enfrentar, com a evidência (contagem/winRate) entre parênteses.
3. **Vulnerabilidades identificadas** — padrões com win rate baixo e amostra suficiente, cada um
   com a leitura tática de como explorar.
4. **Alvos individuais** — uma subseção por jogador em foco (ou pelos jogadores do time-alvo com
   dados suficientes, se o foco pedido for o time inteiro), com como neutralizar/isolar cada um,
   incluindo leitura de mira/mecânica (accuracy, crosshair placement, counter-strafing, time to
   damage/kill) e de utility (qualidade e quantidade), e se a tendência ao longo das demos é de
   melhora ou piora.
5. **Plano de jogo sugerido** — ações concretas pro próximo confronto (que site atacar em cada
   situação de compra, que postura assumir na defesa, quem isolar), cada uma amarrada ao dado que
   a gerou. Nada genérico tipo "jogue agressivo" — diga contra o quê e por quê.
6. **O que revisar antes do confronto** — quais padrões encontrados valem a pena confirmar revendo
   o replay/VOD específico antes do confronto.
Responda em português, em tópicos curtos e objetivos, deixando claro de qual jogador/padrão cada
ponto fala. Não invente números que não estão nos dados.`;

export function getSlotStats(slots: SlotManager, slotId: string): ConsolidatedSlotStats {
  const slot = slots.getSlot(slotId);
  return consolidateSlot(slots.slotFolderPath(slotId), slot.demos);
}

export function getPlayerScores(slots: SlotManager, slotId: string): PlayerScoreAggregate[] {
  const slot = slots.getSlot(slotId);
  return computePlayerScores(slots.slotFolderPath(slotId), slot.demos);
}

export async function runSlotAnalysis(
  slots: SlotManager,
  settingsManager: SettingsManager,
  slotId: string,
  requestedProviderId?: AiProviderId,
  focusSteamIds?: string[]
) {
  const slot = slots.getSlot(slotId);
  if (slot.demos.length === 0) {
    throw new Error('Este slot ainda não tem demos analisadas.');
  }

  const stats = consolidateSlot(slots.slotFolderPath(slotId), slot.demos);
  const playerScores = computePlayerScores(slots.slotFolderPath(slotId), slot.demos);
  const isOpponentProfile = slot.kind === 'opponent';
  const focusIds = focusSteamIds && focusSteamIds.length > 0 ? new Set(focusSteamIds) : undefined;
  const focusPlayers = focusIds
    ? stats.myTeam.playerMovementProfile.filter((p) => focusIds.has(p.steamId))
    : [];
  const aimUtilityHistoryScope = focusIds && focusIds.size > 0 ? playerScores.filter((p) => focusIds.has(p.steamId)) : playerScores;

  const settings = settingsManager.getSettings();
  const providerId = requestedProviderId ?? settings.defaultProviderId;
  if (!providerId) throw new Error('Nenhum provedor de IA configurado como padrão.');
  const provider = settings.providers.find((p) => p.id === providerId);
  if (!provider) throw new Error(`Provedor "${providerId}" não encontrado.`);
  const apiKey = providerId === 'mock' ? '' : settingsManager.getDecryptedKey(providerId);
  if (providerId !== 'mock' && !apiKey) throw new Error(`Nenhuma chave de API salva para "${provider.label}".`);

  const rosterWarning =
    stats.demosPendingRoster.length > 0
      ? `⚠️ ${stats.demosPendingRoster.length} demo(s) excluída(s) das tendências abaixo porque ninguém marcou ` +
        `"meu time" nelas ainda (${stats.demosPendingRoster.join(', ')}). Todas as estatísticas abaixo são só das demos com time marcado.`
      : null;

  const calibrationWarning =
    stats.demosLowCalibrationSample.length > 0
      ? `⚠️ ${stats.demosLowCalibrationSample.length} demo(s) tiveram poucos rounds pra calibrar ritmo/postura ` +
        `dentro da própria demo (${stats.demosLowCalibrationSample.join(', ')}) — os campos "tempo" e "postura" ` +
        `dessas demos usaram um limiar padrão genérico em vez de um calculado a partir dos dados reais dela, então ` +
        `trate conclusões de ritmo/postura vindas dessas demos com mais cautela do que as demais.`
      : null;

  const myNames = stats.myTeam.playerMovementProfile.map((p) => p.name).join(', ');
  const oppNames = stats.opponent.playerMovementProfile.map((p) => p.name).join(', ');

  const featuredHeading = isOpponentProfile ? `Time-alvo (${slot.name})` : `Seu Time (${slot.name})`;
  const contextHeading = isOpponentProfile
    ? `Quem enfrentou ${slot.name} nessas demos`
    : 'Adversário';
  const featuredLabel = isOpponentProfile ? `time-alvo (${slot.name})` : `time do slot`;

  const focusLine =
    focusPlayers.length > 0
      ? `Foco solicitado: análise aprofundada em ${
          focusPlayers.length === 1 ? '1 jogador específico' : `${focusPlayers.length} jogadores específicos`
        } do ${featuredLabel} — ${focusPlayers.map((p) => p.name).join(', ')} (marcados com 🎯 nas tabelas abaixo). ` +
        `Use os dados completos como contexto tático, mas dedique a maior parte da resposta a esse(s) jogador(es).`
      : `Foco solicitado: ${isOpponentProfile ? `time-alvo inteiro (${slot.name})` : `time completo (${slot.name})`} — distribua a profundidade da análise entre todos os jogadores com dados suficientes.`;

  const userPrompt = [
    `# Confronto: ${slot.name}`,
    `Demos analisadas: ${stats.demosAnalyzed} | Rounds computados nas tendências abaixo: ${stats.roundsAnalyzed}`,
    focusLine,
    ...(rosterWarning ? ['', rosterWarning] : []),
    ...(calibrationWarning ? ['', calibrationWarning] : []),
    '',
    '### Site atacado/defendido com mais frequência (geral, os dois times)',
    siteTable(stats.siteHitDistribution),
    '',
    teamSection(featuredHeading, myNames, stats.myTeam, focusIds),
    '',
    `### Mira e utility consolidados do ${featuredLabel} (todas as demos com time marcado, nota 0-100)`,
    ...(focusIds && focusIds.size > 0
      ? ['(🎯 = jogador em foco — priorize a leitura de mira/utility dele(s))']
      : []),
    aimUtilityTable(playerScores, focusIds),
    '',
    `### Evolução da nota geral por demo do ${featuredLabel} (ordem cronológica — use pra dizer se está melhorando ou piorando)`,
    aimUtilityHistoryLines(aimUtilityHistoryScope),
    '',
    teamSection(contextHeading, oppNames, stats.opponent),
    '',
    `## Anotações do analista humano sobre ${isOpponentProfile ? 'o time-alvo' : 'o time do slot'}`,
    slot.notebook.content || '(sem anotações ainda)',
  ].join('\n');

  const responseText = await callAiProvider({
    provider,
    apiKey: apiKey ?? '',
    systemPrompt: isOpponentProfile ? SYSTEM_PROMPT_OPPONENT : SYSTEM_PROMPT_OWN,
    userPrompt,
  });

  return { stats, analysis: responseText };
}
