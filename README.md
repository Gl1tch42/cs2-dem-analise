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

1. ~~**Parser real** (`python/parse_demo.py`)~~ — feito: extração real com
   `demoparser2` (buy type, tempo, postura, site, posições esparsas por
   round, agregados por jogador). Como toda demo tem dois lados e o app
   ainda não sabe dizer "esses são os jogadores do time X" entre demos
   diferentes, os campos táticos de round saem separados por lado
   (`round.ct` / `round.t`) e `playerAggregates` traz os 10 jogadores da
   partida — ver comentário em `electron/storage/types.ts`. Ainda **não
   testado contra uma demo real** (sem amostra disponível neste ambiente);
   validar importando uma `.dem` de verdade pela UI e ajustar nomes de
   campo/heurísticas conforme o que aparecer.
2. **Escolher o lado do slot**: hoje `localHeuristics.ts` combina os dois
   lados de cada round nas mesmas tendências (`electron/ai/localHeuristics.ts`,
   comentário no loop de `consolidateSlot`). Precisa de um jeito de o
   usuário dizer qual lado/roster corresponde ao time do slot (por clã ou
   por seleção manual ao importar) pra filtrar certo.
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
