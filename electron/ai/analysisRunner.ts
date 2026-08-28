import { SlotManager } from '../storage/slotManager';
import { SettingsManager } from '../storage/settingsManager';
import { AiProviderId, BuyType, RoundStance, RoundTempo } from '../storage/types';
import { ConsolidatedSlotStats, consolidateSlot } from './localHeuristics';
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

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Só entram na tabela categorias com pelo menos 1 round — evita poluir o prompt com zeros. */
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

function patternsTable(patterns: ConsolidatedSlotStats['topRecurringPatterns']): string {
  if (patterns.length === 0) return '(sem dados)';
  const rows = patterns.map((p) => `| ${p.pattern} | ${p.count} | ${pct(p.winRate)} |`);
  return ['| Padrão (compra/ritmo/postura/site) | Ocorrências | Win rate |', '|---|---|---|', ...rows].join('\n');
}

function playersTable(players: ConsolidatedSlotStats['playerMovementProfile']): string {
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

const SYSTEM_PROMPT = `Você é um analista tático de CS (Counter-Strike) ajudando o técnico de um time.
Você recebe SOMENTE dados já resumidos (não posições cruas nem a demo inteira) e as anotações
manuais do analista humano sobre esse time. Os dados abaixo já foram filtrados pra representar
SÓ o time do slot (o lado ct/t certo foi identificado round a round, já que o time troca de lado
no intervalo) — não misture com "o adversário fez X", os números já são só deste time. Seu trabalho:
1. Achar padrões de jogada que se repetem (o que o time costuma fazer).
2. Dizer com evidência (contagens/winRate) o que funciona e o que não funciona.
3. Comentar qualidades individuais de jogadores com base nas métricas agregadas.
4. Quando uma jogada deu errado, não generalizar — apontar que ela falhou "porque falhou" nesse
   contexto específico, sem inventar causas que não estão nos dados.
5. Levar em conta as anotações do analista humano como contexto qualitativo, não como fato bruto.
Responda em português, em tópicos curtos e objetivos. Não invente números que não estão nos dados.`;

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
  // 'mock' não chama API nenhuma — não precisa de chave salva.
  const apiKey = providerId === 'mock' ? '' : settingsManager.getDecryptedKey(providerId);
  if (providerId !== 'mock' && !apiKey) throw new Error(`Nenhuma chave de API salva para "${provider.label}".`);

  const rosterWarning =
    stats.demosPendingRoster.length > 0
      ? `⚠️ ${stats.demosPendingRoster.length} demo(s) excluída(s) das tendências abaixo porque ninguém marcou ` +
        `"meu time" nelas ainda (${stats.demosPendingRoster.join(', ')}). Todas as estatísticas abaixo são só das demos com time marcado.`
      : null;

  const userPrompt = [
    `## Time: ${slot.name}`,
    `Demos analisadas: ${stats.demosAnalyzed} | Rounds computados nas tendências abaixo: ${stats.roundsAnalyzed}`,
    ...(rosterWarning ? ['', rosterWarning] : []),
    '',
    '### Tendências por tipo de compra',
    tendencyTable(stats.tendencyByBuyType, BUY_TYPE_LABEL),
    '',
    '### Tendências por ritmo',
    tendencyTable(stats.tendencyByTempo, TEMPO_LABEL),
    '',
    '### Tendências por postura',
    tendencyTable(stats.tendencyByStance, STANCE_LABEL),
    '',
    '### Site atacado/defendido com mais frequência',
    siteTable(stats.siteHitDistribution),
    '',
    '### Jogadas padrão mais recorrentes',
    patternsTable(stats.topRecurringPatterns),
    '',
    '### Perfil de movimentação e desempenho por jogador',
    playersTable(stats.playerMovementProfile),
    '',
    '### Anotações do analista humano sobre este time',
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
