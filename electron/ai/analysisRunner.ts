import { SlotManager } from '../storage/slotManager';
import { SettingsManager } from '../storage/settingsManager';
import { AiProviderId, BuyType, RoundStance, RoundTempo } from '../storage/types';
import { TeamTendencyStats, consolidateSlot } from './localHeuristics';
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

function playersTable(players: TeamTendencyStats['playerMovementProfile']): string {
  if (players.length === 0) return '(sem dados)';
  const rows = players.map((p) => {
    const areas = p.topAreas.map((a) => `${a.area} (${a.count}x)`).join(', ') || '—';
    return `| ${p.name} | ${p.avgAdr} | ${pct(p.entryRate)} | ${pct(p.clutchRate)} | ${p.kills} | ${p.deaths} | ${areas} |`;
  });
  return [
    '| Jogador | ADR médio | Entry rate | Clutch rate | Kills | Deaths | Áreas mais visitadas |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function siteTable(dist: Record<string, number>): string {
  const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return '(sem dados)';
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  const rows = entries.map(([site, n]) => `| ${site} | ${n} | ${pct(n / total)} |`);
  return ['| Site | Rounds | % do total |', '|---|---|---|', ...rows].join('\n');
}

function teamSection(heading: string, playerNames: string, team: TeamTendencyStats): string {
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
    playersTable(team.playerMovementProfile),
  ].join('\n');
}

const SYSTEM_PROMPT = `Você é um analista tático de CS (Counter-Strike) ajudando o técnico de um time.
Você recebe SOMENTE dados já resumidos (não posições cruas nem a demo inteira) e as anotações
manuais do analista humano. Os dados vêm em DUAS seções bem separadas — "Seu Time" (o time do
slot) e "Adversário" (quem jogou contra nesses confrontos) — cada round foi atribuído ao lado
ct/t certo (o time troca de lado no intervalo, então isso já foi corrigido pra você). NUNCA troque
as seções: um padrão listado em "Adversário" é coisa que o ADVERSÁRIO faz, não o time do slot — se
o adversário vence fazendo rush, isso não quer dizer que o time do slot vence fazendo rush. Seu trabalho:
1. Achar padrões de jogada que se repetem em CADA time (o que cada um costuma fazer).
2. Dizer com evidência (contagens/winRate) o que funciona e o que não funciona pra CADA time,
   sem misturar as duas seções.
3. Cruzar as duas seções quando fizer sentido: ex. se o adversário costuma rush B e o time do
   slot tem win rate baixo defendendo contra tempo rush, isso é um alerta tático concreto.
4. Comentar qualidades individuais de jogadores do time do slot com base nas métricas agregadas.
5. Quando uma jogada deu errado, não generalizar — apontar que ela falhou "porque falhou" nesse
   contexto específico, sem inventar causas que não estão nos dados.
6. Levar em conta as anotações do analista humano como contexto qualitativo, não como fato bruto.
Responda em português, em tópicos curtos e objetivos, deixando claro de qual time cada ponto fala.
Não invente números que não estão nos dados.`;

export async function runSlotAnalysis(
  slots: SlotManager,
  settingsManager: SettingsManager,
  slotId: string,
  requestedProviderId?: AiProviderId
) {
  const slot = slots.getSlot(slotId);
  if (slot.demos.length === 0) {
    throw new Error('Este slot ainda não tem demos analisadas.');
  }

  const stats = consolidateSlot(slots.slotFolderPath(slotId), slot.demos);

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

  const myNames = stats.myTeam.playerMovementProfile.map((p) => p.name).join(', ');
  const oppNames = stats.opponent.playerMovementProfile.map((p) => p.name).join(', ');

  const userPrompt = [
    `# Confronto: ${slot.name}`,
    `Demos analisadas: ${stats.demosAnalyzed} | Rounds computados nas tendências abaixo: ${stats.roundsAnalyzed}`,
    ...(rosterWarning ? ['', rosterWarning] : []),
    '',
    '### Site atacado/defendido com mais frequência (geral, os dois times)',
    siteTable(stats.siteHitDistribution),
    '',
    teamSection(`Seu Time (${slot.name})`, myNames, stats.myTeam),
    '',
    teamSection('Adversário', oppNames, stats.opponent),
    '',
    '## Anotações do analista humano sobre o time do slot',
    slot.notebook.content || '(sem anotações ainda)',
  ].join('\n');

  const responseText = await callAiProvider({
    provider,
    apiKey: apiKey ?? '',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
  });

  return { stats, analysis: responseText };
}
