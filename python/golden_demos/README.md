# Golden demo corpus

Infraestrutura de validação do motor analítico contra ground truth anotado
manualmente — item **A01** do roadmap de melhorias (P0: confiabilidade
analítica é o principal gargalo antes de expandir o catálogo de métricas).

Hoje o parser (`python/parse_demo.py`) calcula opening duel, trade, flash
assist, crosshair placement, TTD/TTK, overexposure e utility efficiency por
heurística, sem nenhuma medição automatizada de erro. Esta pasta dá um jeito
de comparar o output do parser contra o que um analista realmente observou
numa demo, e reporta accuracy/MAE por métrica.

## Limitação conhecida da v1

O parser só expõe **opening duel** no nível de round/evento
(`RoundSummary.entryFragBy/entryFragOn`). Trade, flash assist e overexposure
só existem como **contagens agregadas por jogador** na demo inteira
(`PlayerAggregate.positioning.tradeKills`, `.utility.flashAssists`,
`.positioning.overexposedDeathPct`) — não há uma flag por morte dizendo "esta
morte foi uma trade". Por isso:

- **openingDuel** é validado por round (accuracy real).
- **trade / flash assist / overexposure / crosshair / TTD / TTK / utility**
  são validados como **MAE entre a contagem/média agregada anotada e a
  contagem/média agregada prevista pelo parser para o jogador na demo
  inteira** — mais fraco que precision/recall por evento (erros que se
  compensam entre rounds diferentes não aparecem), mas não exige tocar na
  lógica de detecção do parser.

Para subir de nível (precision/recall real por evento nas três métricas
agregadas) é preciso expor flags por morte no `RoundDeath` do parser
(`isTradeKill`, `wasFlashAssisted`, `isOverexposedDeath`) — mudança pequena e
aditiva (só expor estado que o parser já calcula internamente), não uma
mudança na lógica de detecção. Não incluída nesta primeira fase.

## Formato de anotação

Um arquivo JSON por demo em `annotations/<demo_key>.json`. Ver
`schema.py` para a validação estrutural completa. Exemplo:

```json
{
  "schemaVersion": 1,
  "demoKey": "meutime_vs_rival_mirage_2026-09-01",
  "demoFileName": "meutime_vs_rival_mirage.dem",
  "demoSha256": "<sha256 do arquivo .dem — gere com `sha256sum` ou `certutil -hashfile arquivo.dem SHA256`>",
  "map": "de_mirage",
  "annotatedBy": "seu-nome-ou-email",
  "annotatedAt": "2026-09-02",
  "rounds": [
    {
      "round": 1,
      "annotatedMetrics": ["openingDuel"],
      "openingDuel": { "winnerName": "playerA", "loserName": "playerB" }
    }
  ],
  "playerAggregates": [
    {
      "steamId": "76561198000000000",
      "annotatedMetrics": ["tradeKills", "avgCrosshairPlacementDeg"],
      "tradeKills": 4,
      "tradedDeathPct": 33.3,
      "overexposedDeathPct": 10.0,
      "flashAssists": 1,
      "avgCrosshairPlacementDeg": 12.4,
      "avgTimeToDamageMs": 280,
      "avgTimeToKillMs": 650,
      "avgHeDamage": 18.0,
      "avgMolotovDamage": 12.0
    }
  ]
}
```

Pontos importantes:

- **`annotatedMetrics` é obrigatório e é o que decide o que é validado.**
  Só marque uma métrica se você de fato conferiu aquele valor no replay — o
  comparador ignora qualquer coisa não marcada, então uma demo parcialmente
  anotada nunca vira falso positivo nas métricas que ninguém checou.
- **Rounds usam nome de jogador** (`winnerName`/`loserName`), não steamId —
  isso espelha o próprio output do parser: `entryFragBy`/`entryFragOn` (e
  todo o array `deaths[]`) são resolvidos para nome, não steamId, dentro de
  `parse_demo.py`.
- **`playerAggregates` usa steamId** — é assim que `PlayerAggregate` é
  indexado no output do parser.
- `demoSha256` protege contra comparar a anotação com uma versão errada do
  arquivo (ex: re-gravação, re-parse de outra demo com o mesmo nome).

## Onde ficam os `.dem`

Os arquivos de demo **não vão para o git** (tamanho). Guarde-os numa pasta
local e aponte para ela via variável de ambiente:

```
setx CSDA_GOLDEN_DEMOS_DIR "C:\caminho\para\suas\demos"
```

(ou passe `--demo-dir` na hora de rodar). O `validate.py` resolve
`demoFileName` dentro dessa pasta.

## Como rodar

```
python python/golden_demos/validate.py --demo-dir "C:\caminho\para\suas\demos"
```

Ou, com `CSDA_GOLDEN_DEMOS_DIR` já definida:

```
python python/golden_demos/validate.py
```

Opções:

- `--corpus-dir DIR` — pasta com as anotações (default: `annotations/` aqui do lado)
- `--json-report OUT.json` — salva o relatório agregado em JSON, além do print no terminal

O comando roda o parser real (`parse_demo.main()`, o mesmo caminho que o
Electron usa) em cada demo anotada, compara contra a anotação e imprime
accuracy (opening duel) e MAE (todo o resto) agregados sobre todo o corpus.
Demos sem anotação válida, sem `.dem` correspondente, ou com hash divergente
são puladas com aviso — nunca derrubam o comando inteiro.

O relatório também mostra o `featureModelVersion` (`FEATURE_MODEL_VERSION`
em `parse_demo.py`) que produziu os resultados. Se o corpus tiver demos
parseadas com versões diferentes do motor analítico numa mesma execução, o
comando imprime um aviso — misturar versões no agregado esconde se um número
mudou porque o algoritmo mudou ou porque a demo é diferente.

Hoje o comando sempre sai com código 0 (é uma ferramenta de análise, não um
gate de CI) — falta estabelecer thresholds contra dados reais antes de fazer
sentido travar o pipeline nisso.

## Workflow sugerido para anotar uma demo

1. Abra a demo no app (replay 2D) para identificar rounds e nomes de jogador.
2. Para cada round que você quer validar, confirme quem morreu primeiro e
   quem matou — preencha `openingDuel` e marque em `annotatedMetrics`.
3. Para as métricas agregadas, você não precisa contar todas — comece só
   pelas que você tem confiança alta (ex: contar trades manualmente é rápido
   de conferir olhando o killfeed; TTD/TTK exige cronometrar alguns
   engagements individualmente e tirar a média).
4. Rode `validate.py` e veja os mismatches/MAE.
