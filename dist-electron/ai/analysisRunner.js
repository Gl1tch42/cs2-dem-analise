"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSlotAnalysis = exports.getPlayerScores = exports.getSlotStats = void 0;
const localHeuristics_1 = require("./localHeuristics");
const scoreEngine_1 = require("./scoreEngine");
const providers_1 = require("./providers");
const BUY_TYPE_LABEL = {
    eco: 'Eco',
    force: 'Force buy',
    semi: 'Semi buy',
    full: 'Full buy',
    unknown: 'Desconhecido',
};
const TEMPO_LABEL = {
    rush: 'Rush',
    slow: 'Slow',
    default: 'Default',
    split: 'Split',
    unknown: 'Desconhecido',
};
const STANCE_LABEL = {
    aggressive: 'Agressivo',
    passive: 'Passivo',
    'passive-aggressive': 'Passivo-agressivo',
    unknown: 'Desconhecido',
};
const MIN_PATTERN_SAMPLE = 2;
const pct = (n) => `${Math.round(n * 100)}%`;
function tendencyTable(data, labels) {
    const rows = Object.keys(data)
        .filter((k) => data[k].count > 0)
        .sort((a, b) => data[b].count - data[a].count)
        .map((k) => `| ${labels[k]} | ${data[k].count} | ${pct(data[k].winRate)} |`);
    if (rows.length === 0)
        return '(sem dados)';
    return ['| Categoria | Rounds | Win rate |', '|---|---|---|', ...rows].join('\n');
}
function patternsTable(patterns, order) {
    const filtered = patterns.filter((p) => p.count >= MIN_PATTERN_SAMPLE && (order === 'best' ? p.winRate >= 0.5 : p.winRate < 0.5));
    if (filtered.length === 0)
        return '(sem padrão com amostra suficiente)';
    const sorted = [...filtered].sort((a, b) => (order === 'best' ? b.winRate - a.winRate : a.winRate - b.winRate));
    const rows = sorted.map((p) => `| ${p.pattern} | ${p.count} | ${pct(p.winRate)} |`);
    return ['| Padrão (compra/ritmo/postura/site) | Ocorrências | Win rate |', '|---|---|---|', ...rows].join('\n');
}
function playersTable(players, focusIds) {
    if (players.length === 0)
        return '(sem dados)';
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
function aimTable(players, focusIds) {
    if (players.length === 0) {
        return '(sem dados de mira ainda — precisa de pelo menos 1 demo com o time do slot marcado)';
    }
    const rows = players.map((p) => {
        const isFocus = focusIds && focusIds.has(p.steamId);
        const name = isFocus ? `**${p.name} 🎯**` : p.name;
        const a = p.aim;
        const cross = a.avgCrosshairPlacementDeg !== null ? `${a.avgCrosshairPlacementDeg}°` : '—';
        const ttd = a.avgTimeToDamageMs !== null ? `${a.avgTimeToDamageMs}ms` : '—';
        const ttk = a.avgTimeToKillMs !== null ? `${a.avgTimeToKillMs}ms` : '—';
        return (`| ${name} | ${p.avgOverallScore} | ${p.avgAimScore} | ${a.accuracy}% | ${a.headAccuracy}% | ` +
            `${a.hsKillPct}% | ${a.firstBulletAccuracy}% | ${a.sprayAccuracy}% | ${a.counterStrafePct}% | ${cross} | ` +
            `${a.spottedAccuracy}% | ${ttd} | ${ttk} |`);
    });
    return [
        '| Jogador | Nota Geral | Nota Mira | Accuracy | Head Acc. | HS Kill% | First Bullet | Spray | ' +
            'Counter-Strafe | Crosshair | Spotted Acc. | TTD | TTK |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
        ...rows,
    ].join('\n');
}
// Tabela separada de utility (granadas) — daria uma tabela absurdamente larga
// se juntasse tudo numa só com a de mira. "Quality" = eficácia (flash
// efetiva, dano líquido descontado overkill, dano em aliado); "Waste" =
// desperdício (smoke no pé, dinheiro morto com granada não jogada ao morrer).
function utilityTable(players, focusIds) {
    if (players.length === 0) {
        return '(sem dados de utility ainda — precisa de pelo menos 1 demo com o time do slot marcado)';
    }
    const rows = players.map((p) => {
        const isFocus = focusIds && focusIds.has(p.steamId);
        const name = isFocus ? `**${p.name} 🎯**` : p.name;
        const u = p.utility;
        return (`| ${name} | ${p.avgUtilityScore} | ${u.flashesThrown} | ${u.effectiveFlashPct}% | ${u.enemiesFlashedPct}% | ` +
            `${u.flashAssists} | ${u.friendsFlashed} | ${u.avgFriendlyBlindTimeSec}s | ${u.heThrown} | ${u.avgHeDamage} | ` +
            `${u.avgHeTeamDamage} | ${u.molotovsThrown} | ${u.avgMolotovDamage} | ${u.avgMolotovTeamDamage} | ` +
            `${u.smokesThrown} | ${u.smokesWasted} | ${u.unusedUtilityValue}$ (${u.unusedUtilityRounds}x) |`);
    });
    return [
        '| Jogador | Nota Utility | Flashes | Flashbang Efficiency | Enemies Flashed | Flash Assists | ' +
            'Friends Flashed | Avg Friendly Blind | HEs | Avg HE Dmg | Avg HE Team Dmg | Molotovs | Avg Molotov Dmg | ' +
            'Avg Molotov Team Dmg | Smokes | Smokes no pé | $ não usado (rounds morrendo com granada) |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
        ...rows,
    ].join('\n');
}
// Trade Kill % / Traded Death % / Isolamento / Overexposure / Opening Duel —
// sem raycasting real (sem geometria do mapa disponível), Overexposure e
// distância a aliado são aproximação geométrica (distância + cone de visão),
// documentada como tal pro modelo não tratar como precisão absoluta.
function positioningTable(players, focusIds) {
    if (players.length === 0) {
        return '(sem dados de posicionamento ainda — precisa de pelo menos 1 demo com o time do slot marcado)';
    }
    const rows = players.map((p) => {
        const isFocus = focusIds && focusIds.has(p.steamId);
        const name = isFocus ? `**${p.name} 🎯**` : p.name;
        const pos = p.positioning;
        const delay = pos.avgTradeDelayMs !== null ? `${pos.avgTradeDelayMs}ms` : '—';
        const dist = pos.avgNearestTeammateDist !== null ? `${pos.avgNearestTeammateDist}u` : '—';
        return (`| ${name} | ${p.avgPositioningScore} | ${pos.openingDuelWinPct}% | ${pos.openingDuelParticipationPct}% | ` +
            `${pos.tradedDeathPct}% | ${pos.isolatedDeathPct}% | ${pos.tradeKills} | ${pos.tradeKillPct}% | ${delay} | ` +
            `${pos.overexposedDeathPct}% | ${dist} |`);
    });
    return [
        '| Jogador | Nota Posicionamento | Opening Duel Win% | Opening Duel Participation% | Traded Death% | ' +
            'Isolated Death% | Trade Kills | Trade Kill% | Avg Trade Delay | Overexposed Death% | Avg Dist. Aliado |',
        '|---|---|---|---|---|---|---|---|---|---|---|',
        ...rows,
    ].join('\n');
}
// Tendência por demo, em ordem cronológica — compacto (uma linha por jogador)
// pra não estourar o prompt mesmo com muitas demos no slot; dá pro modelo
// enxergar "melhorou/piorou ao longo do tempo" sem precisar de uma tabela
// gigante por jogador.
function aimUtilityHistoryLines(players) {
    const withHistory = players.filter((p) => p.history.length > 0);
    if (withHistory.length === 0)
        return '(sem histórico por demo ainda)';
    const lines = withHistory.map((p) => {
        const trend = p.history
            .map((h) => `${h.demoLabel} (${new Date(h.addedAt).toLocaleDateString('pt-BR')}): nota ${h.overallScore}`)
            .join(' → ');
        return `- **${p.name}**: ${trend}`;
    });
    return lines.join('\n');
}
function siteTable(dist) {
    const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0)
        return '(sem dados)';
    const total = entries.reduce((sum, [, n]) => sum + n, 0);
    const rows = entries.map(([site, n]) => `| ${site} | ${n} | ${pct(n / total)} |`);
    return ['| Site | Rounds | % do total |', '|---|---|---|', ...rows].join('\n');
}
function teamSection(heading, playerNames, team, focusIds) {
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
5. Usar a tabela "Mira consolidada" pra avaliar mecânica individual: accuracy, head accuracy, HS
   kill%, first bullet, spray, counter-strafing, crosshair placement (grau — menor é melhor),
   spotted accuracy, time to damage/kill (ms — menor é melhor). Um valor "—" significa que não há
   amostra suficiente pra essa métrica nessa demo/jogador — não invente uma leitura pra ela, diga
   que falta amostra.
6. Usar a tabela "Utility consolidada" pra avaliar granadas com estas leituras específicas:
   - Flashbang Efficiency (só conta cegueira efetiva ≥1.5s em inimigo) é o número que importa mais
     que "Enemies Flashed" bruto — um jogador pode cegar muitos inimigos por pouco tempo (flash
     fraca) sem gerar valor real; aponte a diferença entre os dois números quando ela existir.
   - Se "Friends Flashed"/"Avg Friendly Blind" forem altos, isso é falha grave (team flash) — trate
     como prioridade de correção, não como detalhe.
   - Dano de HE/Molotov já vem líquido (sem overkill nem dano em aliado contado a favor) — "Avg
     [Arma] Team Dmg" alto é dano no próprio time e deve ser tratado como ponto negativo.
   - "Smokes no pé" é smoke desperdiçada (caiu perto de onde o próprio jogador estava).
   - "$ não usado (rounds morrendo com granada)" mostra quanto dinheiro do time morreu com o
     jogador porque ele não jogou a granada que comprou — isso é economia jogada fora, não só uma
     estatística de utility.
   - Diga explicitamente se o jogador está acumulando "dano passivo" (joga granada mas raramente
     gera flash efetiva, kill ou dano líquido relevante) ou jogando flashes sem apoiar a jogada do
     time (flash jogada sem um aliado entrando logo em seguida — inferir isso da tabela de mortes/
     entry por round quando disponível, sem inventar o que não está nos dados).
7. Usar a tabela "Posicionamento consolidado" com estas leituras específicas:
   - "Isolated Death%" alto é o sinal mais grave: o jogador morre sem nenhum aliado vivo por perto
     pra vingar, ou seja, é uma morte "de graça" pro time independente de reação — trate como
     prioridade máxima de correção de posicionamento, diferente de "Traded Death%" baixo por outro
     motivo (time lento, não isolamento).
   - "Overexposed Death%" alto indica o jogador expondo o corpo pra 2+ ângulos ao mesmo tempo sem
     suporte de utilitária — cite isso como falha de entrada/rotação, não como azar.
   - "Opening Duel Win%" abaixo da faixa saudável é duelo perdido demais; "Opening Duel
     Participation%" muito baixo pode indicar passividade excessiva (baiting) — muito alto sem
     Win% correspondente também é ruim (duelo forçado demais). Comente os dois números juntos, não
     isoladamente.
   - "Trade Kill%"/"Avg Trade Delay" mostram se o jogador captura bem as oportunidades de vingar um
     aliado e com que velocidade (janela de 3s) — delay alto sugere estar posicionado longe demais
     pra reagir a tempo mesmo quando o trade acontece.
   - "Avg Dist. Aliado" é aproximação (distância euclidiana ao aliado vivo mais próximo, sem
     considerar função de Lurker — não há dado de função de jogador disponível): trate um valor alto
     com cautela e considere que pode ser um jogador de flanco/isca deliberado, não
     necessariamente erro de posicionamento, principalmente se "Isolated Death%" não for alto junto.
8. Usar "Evolução da nota geral por demo" pra dizer se cada jogador está melhorando, piorando ou
   estável ao longo das partidas — isso é tão relevante quanto o valor consolidado atual pro plano
   de treino.
9. Quando uma jogada deu errado, não generalizar — apontar que ela falhou "porque falhou" nesse
   contexto específico, sem inventar causas que não estão nos dados.
10. Levar em conta as anotações do analista humano como contexto qualitativo, não como fato bruto.
11. Nunca inventar estatística, tendência de movimentação, mira/utility/posicionamento ou uso de
   utilitário que não esteja literalmente nas tabelas fornecidas — se a informação não existe nos
   dados, diga que não dá pra afirmar isso com os dados disponíveis, em vez de supor.

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
5. Usar a tabela "Mira consolidada" pra identificar a mecânica de cada jogador do time-alvo:
   accuracy, head accuracy, HS kill%, first bullet, spray, counter-strafing, crosshair placement
   (grau — menor é melhor), spotted accuracy, time to damage/kill (ms — menor é melhor) — isso vira
   recomendação de quem duelar e quem evitar de frente. Um valor "—" significa amostra insuficiente
   pra essa métrica — não invente leitura pra ela.
6. Usar a tabela "Utility consolidada" pra identificar como o time-alvo joga granada, e traduzir
   isso em plano de jogo:
   - Flashbang Efficiency (só cegueira efetiva ≥1.5s em inimigo) diz quem realmente flasha bem —
     compare com "Enemies Flashed" bruto: se o bruto for bem maior que a efficiency, esse jogador
     joga flash fraca, o que é uma janela de reação maior pro nosso time.
   - "Friends Flashed"/"Avg Friendly Blind" altos indicam time flash frequente do time-alvo — pode
     virar uma vulnerabilidade a explorar (ex: forçar eles a jogar flash apressada).
   - Dano de HE/Molotov já vem líquido, sem overkill — "Avg [Arma] Team Dmg" alto do time-alvo é
     sinal de granada mal calculada nesse time, relevante pra saber que eles tomam dano próprio.
   - "Smokes no pé" identifica jogador que desperdiça smoke perto de si mesmo.
   - "$ não usado (rounds morrendo com granada)" mostra qual jogador do time-alvo costuma morrer
     segurando utility — isso é economia que eles perdem e pode ser relevante pro nosso plano de
     eco/force-buy no round seguinte.
7. Usar a tabela "Posicionamento consolidado" do time-alvo pra montar plano de ataque:
   - "Isolated Death%" alto num jogador do time-alvo é quem isolar — morre sem suporte,
     independente de quão rápido o time dele reagiria.
   - "Overexposed Death%" alto indica jogador que costuma se expor a 2+ ângulos sem cobertura —
     um alvo prioritário pra forçar a se expor de novo.
   - "Opening Duel Win%"/"Participation%" baixos indicam jogador que perde duelo de abertura ou
     evita entrar (baiting) — vira recomendação de quem entrar contra com confiança.
   - "Trade Kill%"/"Avg Trade Delay" altos no time-alvo indicam time que vinga rápido — nesse caso
     evitar isolar demais nosso próprio entry contra eles; se forem baixos, é uma vulnerabilidade
     de trade a explorar entrando mais agressivo.
   - "Avg Dist. Aliado" alto pode ser jogador de flanco/lurker do time-alvo (sem dado de função
     disponível pra confirmar) — trate com essa ressalva antes de recomendar isolá-lo como erro.
8. Usar "Evolução da nota geral por demo" pra apontar se algum jogador do time-alvo está em alta ou
   em baixa recentemente — isso muda a prioridade de quem explorar no próximo confronto.
9. Quando um padrão do time-alvo falhou, não generalizar — aponte que falhou "nesse contexto
   específico", sem inventar causa que não está nos dados.
10. Levar em conta as anotações do analista humano como contexto qualitativo, não como fato bruto.
11. Nunca inventar estatística, tendência de movimentação, mira/utility/posicionamento ou uso de
   utilitário que não esteja literalmente nas tabelas fornecidas — se a informação não existe nos
   dados, diga que não dá pra afirmar isso com os dados disponíveis, em vez de supor.

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
function getSlotStats(slots, slotId) {
    const slot = slots.getSlot(slotId);
    return (0, localHeuristics_1.consolidateSlot)(slots.slotFolderPath(slotId), slot.demos);
}
exports.getSlotStats = getSlotStats;
function getPlayerScores(slots, slotId) {
    const slot = slots.getSlot(slotId);
    return (0, scoreEngine_1.computePlayerScores)(slots.slotFolderPath(slotId), slot.demos);
}
exports.getPlayerScores = getPlayerScores;
async function runSlotAnalysis(slots, settingsManager, slotId, requestedProviderId, focusSteamIds) {
    const slot = slots.getSlot(slotId);
    if (slot.demos.length === 0) {
        throw new Error('Este slot ainda não tem demos analisadas.');
    }
    const stats = (0, localHeuristics_1.consolidateSlot)(slots.slotFolderPath(slotId), slot.demos);
    const playerScores = (0, scoreEngine_1.computePlayerScores)(slots.slotFolderPath(slotId), slot.demos);
    const isOpponentProfile = slot.kind === 'opponent';
    const focusIds = focusSteamIds && focusSteamIds.length > 0 ? new Set(focusSteamIds) : undefined;
    const focusPlayers = focusIds
        ? stats.myTeam.playerMovementProfile.filter((p) => focusIds.has(p.steamId))
        : [];
    const aimUtilityHistoryScope = focusIds && focusIds.size > 0 ? playerScores.filter((p) => focusIds.has(p.steamId)) : playerScores;
    const settings = settingsManager.getSettings();
    const providerId = requestedProviderId ?? settings.defaultProviderId;
    if (!providerId)
        throw new Error('Nenhum provedor de IA configurado como padrão.');
    const provider = settings.providers.find((p) => p.id === providerId);
    if (!provider)
        throw new Error(`Provedor "${providerId}" não encontrado.`);
    const apiKey = providerId === 'mock' ? '' : settingsManager.getDecryptedKey(providerId);
    if (providerId !== 'mock' && !apiKey)
        throw new Error(`Nenhuma chave de API salva para "${provider.label}".`);
    const rosterWarning = stats.demosPendingRoster.length > 0
        ? `⚠️ ${stats.demosPendingRoster.length} demo(s) excluída(s) das tendências abaixo porque ninguém marcou ` +
            `"meu time" nelas ainda (${stats.demosPendingRoster.join(', ')}). Todas as estatísticas abaixo são só das demos com time marcado.`
        : null;
    const calibrationWarning = stats.demosLowCalibrationSample.length > 0
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
    const focusLine = focusPlayers.length > 0
        ? `Foco solicitado: análise aprofundada em ${focusPlayers.length === 1 ? '1 jogador específico' : `${focusPlayers.length} jogadores específicos`} do ${featuredLabel} — ${focusPlayers.map((p) => p.name).join(', ')} (marcados com 🎯 nas tabelas abaixo). ` +
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
        `### Mira consolidada do ${featuredLabel} (todas as demos com time marcado, nota 0-100)`,
        ...(focusIds && focusIds.size > 0
            ? ['(🎯 = jogador em foco — priorize a leitura de mira/utility dele(s))']
            : []),
        aimTable(playerScores, focusIds),
        '',
        `### Utility (granadas) consolidada do ${featuredLabel} — "Flashbang Efficiency" só conta cegueira >=1.5s em inimigo; ` +
            `dano de HE/Molotov já desconta overkill; "$ não usado" é dinheiro perdido morrendo com granada comprada e não jogada`,
        utilityTable(playerScores, focusIds),
        '',
        `### Posicionamento consolidado do ${featuredLabel} — Overexposure e "Avg Dist. Aliado" são aproximação ` +
            `geométrica (distância + ângulo, sem raycasting real); "Isolated Death%" é morte sem aliado vivo por perto ` +
            `(intradeável mesmo que o time reagisse rápido); "Traded Death%" é morte que o time efetivamente vingou em <=3s`,
        positioningTable(playerScores, focusIds),
        '',
        `### Evolução da nota geral por demo do ${featuredLabel} (ordem cronológica — use pra dizer se está melhorando ou piorando)`,
        aimUtilityHistoryLines(aimUtilityHistoryScope),
        '',
        teamSection(contextHeading, oppNames, stats.opponent),
        '',
        `## Anotações do analista humano sobre ${isOpponentProfile ? 'o time-alvo' : 'o time do slot'}`,
        slot.notebook.content || '(sem anotações ainda)',
    ].join('\n');
    const responseText = await (0, providers_1.callAiProvider)({
        provider,
        apiKey: apiKey ?? '',
        systemPrompt: isOpponentProfile ? SYSTEM_PROMPT_OPPONENT : SYSTEM_PROMPT_OWN,
        userPrompt,
    });
    return { stats, analysis: responseText };
}
exports.runSlotAnalysis = runSlotAnalysis;
//# sourceMappingURL=analysisRunner.js.map