# CS Demo Analyst

App desktop (Electron + Angular + Bulma) para ler demos de CS, consolidar padrões
táticos entre partidas e manter um notebook de analista por time — tudo salvo
localmente, sem banco de dados.

## Como rodar em desenvolvimento

```bash
npm install
npm start
```

Isso sobe o `ng serve` (porta 4200) e, quando ele estiver pronto, abre a janela
do Electron apontando pra lá. Hot-reload do Angular funciona normal; se mexer
em algo dentro de `electron/`, pare (Ctrl+C) e rode `npm start` de novo.

## Estrutura

```
electron/            processo principal (Node) — nunca acessível pelo Angular direto
  main.ts            cria a janela, registra os handlers IPC
  preload.ts          ponte segura (contextBridge) exposta como window.electronAPI
  storage/
    types.ts          tipos compartilhados (mesma forma em src/app/core/models)
    slotManager.ts     CRUD dos 21 slots (1 time + 20 adversários), demos, notebook
    settingsManager.ts config de IA (provedor padrão + chaves criptografadas)
  ai/
    demoParserBridge.ts chama o script Python que faz o parsing real da demo
    localHeuristics.ts   ALGORITMO LOCAL: consolida padrões sem gastar token de IA
    providers.ts          chamadas HTTP pros provedores (Anthropic/OpenAI/custom)
    analysisRunner.ts     junta consolidação local + notebook -> 1 chamada de IA

python/
  parse_demo.py        Parser real com `demoparser2` (pip install -r python/requirements.txt).
  requirements.txt     Dependência do parser (demoparser2, pinada).

src/app/
  core/                modelos + ElectronService (wrapper do window.electronAPI)
  features/
    shell/              sidebar com os 21 slots
    slot-detail/        tela de um slot: Visão Geral / Mapa 2D / Demos / Notebook / IA
    notebook/            textarea com autosave (markdown livre do analista)
    ai-settings/         tela global de configuração dos provedores de IA
```

## Onde os dados ficam salvos

Tudo dentro da pasta de dados do usuário do Electron
(`app.getPath('userData')`), sem nenhum servidor ou banco externo:

- Windows: `%APPDATA%/cs-demo-analyst/`
- macOS: `~/Library/Application Support/cs-demo-analyst/`
- Linux: `~/.config/cs-demo-analyst/`

Dentro dela: `slots/<slot-id>/{meta.json, notebook.md, demos/<demo-id>/{record.json, summary.json}}`
e `ai-settings.json` + `keys/*.key` (chaves de API criptografadas com `safeStorage`).

## Setup do parser Python (dev)

```bash
pip install -r python/requirements.txt
```

`demoParserBridge.ts` chama `python`/`python3` do sistema em desenvolvimento
(troca pro binário empacotado via PyInstaller só quando `app.isPackaged`
— ver item 5 abaixo, ainda não feito).

## O que falta implementar (próximos passos, nessa ordem sugerida)

1. ~~**Parser real** (`python/parse_demo.py`)~~ — feito e **validado contra
   demos reais** (2 demos FACEIT, de_dust2 e de_anubis). Esse teste achou e
   corrigiu 3 bugs que só apareciam com dado real (nenhum tinha como ser
   pego sem uma `.dem` de verdade):
   - `bomb_exploded` (e qualquer evento que nunca ocorre na demo inteira)
     vem como lista vazia `[]` em vez de DataFrame — quebrava com
     `AttributeError` na primeira demo sem bomba explodida. `safe_parse_event`
     agora normaliza isso pra `None`.
   - A classificação de utilitário lia a coluna errada de
     `parser.parse_grenades()`: `name` é o nome do JOGADOR (não o tipo da
     granada — isso vem em `grenade_type`), e o steamid de quem jogou vem em
     `steamid`, não em `thrower_steamid` (esse campo nem existe nesse df).
     Resultado prático: flashes/smokes/molotovs/HE usados saíam sempre
     zerados.
   - Pior: `parse_grenades()` retorna uma linha **por tick** da trajetória
     de cada granada (uma smoke ativa por 18s vira ~1150 linhas), não uma
     linha por lançamento — contar linhas inflava o total em ordens de
     grandeza (centenas de milhares de "usos" numa partida de 25 rounds).
     Trocado por contagem dos eventos pontuais que já eram parseados
     (`flashbang_detonate`, `smokegrenade_detonate`, `inferno_startburn`,
     `hegrenade_detonate`), que também tirou ~30% do tempo de parsing.

   Extração real com `demoparser2` (buy type, tempo, postura, site, posições
   esparsas por round, agregados por jogador). Como toda demo tem dois lados,
   os campos táticos de round saem separados por lado (`round.ct` / `round.t`)
   e `playerAggregates` traz os 10 jogadores da partida — ver comentário em
   `electron/storage/types.ts`.
2. ~~**Escolher o lado do slot**~~ — feito: a aba Demos deixa marcar quais
   steamIds são "meu time" por demo (`slotManager.setDemoRoster`), e
   `localHeuristics.ts` usa `resolveMySideForRound` pra decidir ct/t
   round a round (cobre troca de lado no intervalo) antes de separar as
   tendências em `myTeam` / `opponent`. Demos sem roster marcado ficam de
   fora das tendências e aparecem em `demosPendingRoster` (aviso na UI e no
   prompt da IA) até alguém marcar.
3. **Mapa 2D animado** (aba "Mapa 2D", hoje só um placeholder): renderizar o
   radar do mapa + posições de `keyPositions` com um scrub de tempo por round.
   Um `<canvas>` com `requestAnimationFrame` ou uma lib leve tipo Pixi/Konva
   resolve bem, sem precisar de nada pesado.
4. ~~**Rotulagem de áreas do mapa**~~ — resolvido de graça: o próprio CS2
   expõe `last_place_name` por tick (nome de área do nav mesh do jogo, ex:
   `"BombsiteA"`, `"Mid"`), então `parse_demo.py` já usa isso pra
   `siteHit`/`favoriteAreas` em vez de precisar mapear polígono por callout
   manualmente. Callouts mais finos (ex: distinguir "A-site" de "A-Ramp")
   ficam pra depois, se fizer falta.
5. **Empacotamento do Python**: usar PyInstaller pra gerar um binário
   standalone e configurar `extraResources` no `electron-builder` (já
   referenciado em `demoParserBridge.ts`), assim o usuário final não precisa
   ter Python instalado.
6. **Calibração de tempo/postura** (`classify_buy_type`/tempo/postura em
   `parse_demo.py`): os limiares de deslocamento (rush/slow, agressivo/
   passivo) eram constantes fixas em "unidades do mapa" nunca checadas
   contra dado real — testar contra as 2 demos reais mostrou que
   `HIGH_DISPLACEMENT=900` classificava praticamente todo round como
   "rush"/"aggressive", porque de_dust2 tem sightlines de milhares de
   unidades e o deslocamento mediano observado em 15s foi ~1665. Trocado por
   limiares dinâmicos: percentil 33/67 da distribuição de deslocamento
   observada dentro da própria demo (se adapta a qualquer mapa sem tabela de
   constante por mapa). Com poucos rounds (<6) isso é ruidoso, então o
   summary carrega um campo `calibration` (`tempoStanceThresholdSource:
   'demo' | 'default'`) e o app avisa o analista (UI + prompt da IA) quando
   uma demo caiu no limiar padrão por amostra pequena — trate "ritmo" e
   "postura" dessas com mais cautela. Isso é ainda uma heurística de regra
   simples, não um modelo estatístico calibrado com histórico de várias
   partidas/times — o dado real ajudou a corrigir a escala, não a validar a
   classificação em si. Uma dose real de confiança viria de comparar contra
   rótulo humano (analista concorda que o round foi "rush"?) em um conjunto
   maior de demos, o que fica pra quando houver amostra suficiente.
7. ~~**Versionamento do notebook**~~ — feito: `saveNotebook` grava um
   checkpoint do conteúdo anterior em `slots/<id>/notebook-history/` antes
   de sobrescrever, no máximo 1 a cada 5 minutos (autosave dispara a cada
   poucos ms de digitação — sem esse throttle viraria uma cópia por
   keystroke) e mantém só os últimos 200. Botão "Histórico" na aba Notebook
   lista os checkpoints e permite restaurar (a versão atual também vira
   checkpoint antes de ser substituída, então restaurar é reversível).
8. ~~**Sync entre analistas / múltiplas máquinas**~~ — resolvido na medida
   que dá pra resolver sem virar um app com servidor: botões "Exportar slot"
   / "Importar de arquivo .csda-slot" na aba Demos. Exportar empacota
   meta + notebook + todas as demos (record + summary já parseado) de um
   slot num único arquivo `.csda-slot` (JSON gzipado — sem dependência nova),
   pra mandar por Drive/Slack/pendrive pra outro analista. Importar faz merge
   no slot local: demo é considerada duplicata por arquivo+mapa+placar (o
   UUID interno não sobrevive entre máquinas) e pula quem já existe; roster
   marcado (`myTeamSteamIds`) vem junto, então o segundo analista não precisa
   remarcar quem é "meu time" nas demos já processadas por outro; e o
   notebook do export **nunca sobrescreve** o notebook local — vira um
   checkpoint no histórico (item 7) pra revisão/merge manual. Isso não é
   sync automático (precisa alguém rodar export/import manualmente, e não há
   resolução automática de conflito) — se algum dia fizer sentido ter sync de
   verdade entre máquinas em tempo real, isso é uma decisão de arquitetura
   maior (servidor central vs. pasta compartilhada com merge) que muda a
   proposta "tudo local, sem infra" do app.

## Provedores de IA

Configuráveis em Configurações de IA: Anthropic (Claude), OpenAI, ou um
endpoint HTTP customizado (pra outra IA que você preferir). A chave fica
criptografada localmente via `safeStorage` do Electron e nunca é devolvida
ao Angular em texto puro — só usada dentro do processo principal na hora de
chamar a API.

A cada análise, o app manda pra IA **apenas** o resumo consolidado localmente
(`ConsolidatedSlotStats`, gerado por `localHeuristics.ts`) + o texto do
notebook do analista — nunca a demo bruta nem posições tick-a-tick — pra
manter o consumo de tokens baixo mesmo com dezenas de demos por time.
