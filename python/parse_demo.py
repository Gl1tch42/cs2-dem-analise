#!/usr/bin/env python3
"""
Parser real de demos de CS2, usando `demoparser2` (bindings Rust, rápido).

Lê a demo em --input, extrai por rodada (buyType, tempo, postura, site,
utilitário, posições esparsas) e por jogador (kills/deaths/ADR, entry
duels, clutches, áreas mais visitadas), e escreve tudo no formato
DemoSummary (ver electron/storage/types.ts) como JSON em --output.

Toda demo tem DOIS lados (CT e T) e o app ainda não tem um jeito de saber
qual dos dois é "o time do slot" entre demos diferentes — por isso os
campos táticos de rodada saem separados por lado (round.ct / round.t) em
vez de tentar adivinhar uma perspectiva única, e playerAggregates traz os
10 jogadores da partida, cada um marcado com o lado predominante que jogou.

Classificações como buyType/tempo/postura são HEURÍSTICAS (limiares
simples e documentados abaixo), no mesmo espírito do "algoritmo leve" de
electron/ai/localHeuristics.ts — não é machine learning, e os limiares são
ajustáveis conforme a gente for testando contra demos reais.
"""
import argparse
import json
import os
import sys
from typing import Optional

# Em algumas instalações do Windows, stdout/stderr do Python vêm no codepage
# local (ex: cp1252) em vez de UTF-8 — como o Electron lê a saída como UTF-8
# (ver demoParserBridge.ts), mensagens de erro com acento saem corrompidas
# se não forçarmos a codificação aqui.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

from demoparser2 import DemoParser

# CS2 roda a simulação de round a 64 ticks/segundo (fixo, diferente do
# CS:GO que tinha servidores 64 ou 128 tick) — demoparser2 só lê demos CS2.
TICK_RATE = 64.0

# team_num do engine Source 2: 1 = não atribuído/espectador, 2 = Terrorist,
# 3 = Counter-Terrorist. Estável desde o CS:GO — usado pelo prop `team_num`
# (via parse_ticks). Já os campos "other" de game events (ex: `winner` de
# round_end) o demoparser2 devolve como string decodificada ('CT'/'TERRORIST'),
# não o int cru — por isso `coerce_side` abaixo aceita os dois formatos.
TEAM_NUM_TO_SIDE = {2: "t", 3: "ct"}


def coerce_side(value) -> Optional[str]:
    """Normaliza um valor de lado vindo do demoparser2 pra 'ct'/'t', aceitando
    tanto o team_num numérico (2/3) quanto strings decodificadas ('CT',
    'TERRORIST', 'T', 'COUNTER-TERRORIST', case-insensitive)."""
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() == "nan":
        return None
    try:
        return TEAM_NUM_TO_SIDE.get(int(float(s)))
    except (ValueError, TypeError):
        pass
    low = s.lower()
    if low in ("ct", "counter-terrorist", "counterterrorist"):
        return "ct"
    if low in ("t", "terrorist"):
        return "t"
    return None

# Limiares de classificação de compra (valor médio de equipamento por
# jogador do lado, medido logo após o fim do tempo de compra). Ajustáveis.
BUY_ECO_MAX = 2000
BUY_FORCE_MAX = 3000
BUY_SEMI_MAX = 4000

# Janela (em segundos de round) considerada "contato antecipado" pra
# classificar tempo como rush.
EARLY_CONTACT_SECONDS = 15.0
# Deslocamento médio (unidades de mapa) acima do qual um lado é considerado
# tendo avançado bastante nos primeiros ~15s do round.
HIGH_DISPLACEMENT = 900.0
LOW_DISPLACEMENT = 250.0

# Intervalo de amostragem de posições dentro do round, pra keyPositions.
POSITION_SAMPLE_SECONDS = 3.0

# Durações padrão (fallback, quando o evento de "fim" não é encontrado) das
# granadas de área, em segundos — usadas só se a demo não expuser o evento de
# expiração correspondente.
SMOKE_DEFAULT_DURATION_SECONDS = 18.0
FIRE_DEFAULT_DURATION_SECONDS = 7.0
DECOY_DEFAULT_DURATION_SECONDS = 18.0


def eprint(*args):
    print(*args, file=sys.stderr)


def classify_buy_type(avg_equip_value: float) -> str:
    if avg_equip_value <= 0:
        return "unknown"
    if avg_equip_value < BUY_ECO_MAX:
        return "eco"
    if avg_equip_value < BUY_FORCE_MAX:
        return "force"
    if avg_equip_value < BUY_SEMI_MAX:
        return "semi"
    return "full"


def area_from_place_name(place: Optional[str]) -> str:
    """Mapeia o `last_place_name` (nome de área do nav mesh do próprio jogo)
    pra um dos buckets 'A'/'B'/'mid'/'unknown' usados em siteHit."""
    if not place or not isinstance(place, str):
        return "unknown"
    low = place.lower()
    if "bombsitea" in low or low == "a" or "site_a" in low:
        return "A"
    if "bombsiteb" in low or low == "b" or "site_b" in low:
        return "B"
    if "mid" in low:
        return "mid"
    return "unknown"


def safe_parse_event(parser: DemoParser, name: str, **kwargs):
    try:
        df = parser.parse_event(name, **kwargs)
        return df
    except Exception as exc:  # noqa: BLE001 - queremos degradar, não quebrar o parse inteiro
        eprint(f"[parse_demo] aviso: evento '{name}' indisponível nesta demo ({exc})")
        return None


# Props "exóticos" — nem toda demo/versão do jogo expõe todos. Se parse_ticks
# falhar com o conjunto completo, vamos removendo um de cada vez (nesta ordem)
# até conseguir, em vez de perder a rodada inteira por causa de um prop só.
OPTIONAL_TICK_PROPS = [
    "last_place_name",
    "weapon_name",
    "yaw",
    "armor_value",
    "has_helmet",
    "kills_total",
    "deaths_total",
    "assists_total",
]


def safe_parse_ticks(parser: DemoParser, props: list, ticks: list):
    attempt = list(props)
    while True:
        try:
            return parser.parse_ticks(attempt, ticks=ticks)
        except Exception as exc:  # noqa: BLE001
            eprint(f"[parse_demo] aviso: parse_ticks falhou com props {attempt} ({exc})")
            dropped = False
            for optional in OPTIONAL_TICK_PROPS:
                if optional in attempt:
                    attempt = [p for p in attempt if p != optional]
                    dropped = True
                    break
            if not dropped:
                eprint("[parse_demo] aviso: parse_ticks falhou mesmo sem os props opcionais")
                return None


def event_xy(row):
    """Eventos de granada expõem x/y em minúsculo — mas tenta os dois formatos
    por segurança, já que não temos como testar contra uma demo real aqui."""
    x = getattr(row, "x", None)
    if x is None:
        x = getattr(row, "X", None)
    y = getattr(row, "y", None)
    if y is None:
        y = getattr(row, "Y", None)
    return x, y


def pair_grenade_lifespan(start_df, end_df, freeze_tick: int, end_tick: int, default_duration_ticks: int):
    """Casa o evento de início de uma granada com posição (smoke/fogo/decoy)
    com o evento de fim correspondente pelo mesmo entityid. Se não achar um fim
    (ainda ativo quando o round acaba, ou a demo não expõe o evento), assume
    default_duration_ticks a partir do início, sem passar do fim do round."""
    results = []
    if start_df is None or "tick" not in start_df.columns:
        return results
    round_starts = start_df[(start_df["tick"] > freeze_tick) & (start_df["tick"] <= end_tick)]

    end_ticks_by_entity: dict = {}
    if end_df is not None and "tick" in end_df.columns and "entityid" in end_df.columns:
        for row in end_df.itertuples():
            eid = getattr(row, "entityid", None)
            if eid is None or str(eid) == "nan":
                continue
            end_ticks_by_entity.setdefault(int(eid), []).append(int(row.tick))

    for row in round_starts.itertuples():
        x, y = event_xy(row)
        if x is None or str(x) == "nan":
            continue
        start_tick = int(row.tick)
        candidate_end = start_tick + default_duration_ticks
        eid = getattr(row, "entityid", None)
        if eid is not None and str(eid) != "nan":
            later = [t for t in end_ticks_by_entity.get(int(eid), []) if t >= start_tick]
            if later:
                candidate_end = min(later)
        candidate_end = min(candidate_end, end_tick)
        results.append(
            {
                "x": round(float(x), 1),
                "y": round(float(y), 1),
                "startT": round((start_tick - freeze_tick) / TICK_RATE, 1),
                "endT": round((candidate_end - freeze_tick) / TICK_RATE, 1),
            }
        )
    return results


def build_round_windows(parser: DemoParser):
    """Casa round_freeze_end (início do round "ao vivo", pós-compra) com o
    próximo round_end (fim), na ordem em que aconteceram. Descarta rounds
    sem um dos dois eventos (ex: round incompleto no fim da demo)."""
    freeze_df = safe_parse_event(parser, "round_freeze_end")
    end_df = safe_parse_event(parser, "round_end", other=["winner", "reason"])
    if freeze_df is None or end_df is None or len(freeze_df) == 0 or len(end_df) == 0:
        return []

    freeze_ticks = sorted(freeze_df["tick"].tolist())
    end_df = end_df.sort_values("tick")

    windows = []
    for i, row in enumerate(end_df.itertuples()):
        end_tick = int(row.tick)
        # a freeze_end deste round é a última que aconteceu antes do fim dele
        # e depois do fim do round anterior.
        prev_end_tick = int(windows[-1]["endTick"]) if windows else -1
        candidates = [t for t in freeze_ticks if prev_end_tick < t < end_tick]
        if not candidates:
            continue
        freeze_tick = candidates[-1]

        winner_raw = getattr(row, "winner", None)
        side = coerce_side(winner_raw)
        if side is None:
            # sem vencedor reconhecível (ex: round de warmup/edge case) — pula,
            # o schema exige 'ct'|'t' e não vale a pena chutar.
            continue

        windows.append(
            {
                "roundNumber": len(windows) + 1,
                "freezeTick": freeze_tick,
                "endTick": end_tick,
                "winner": side,
            }
        )
    return windows


def main():
    arg_parser = argparse.ArgumentParser()
    arg_parser.add_argument("--input", required=True)
    arg_parser.add_argument("--output", required=True)
    args = arg_parser.parse_args()

    parser = DemoParser(args.input)

    header = {}
    try:
        header = parser.parse_header() or {}
    except Exception as exc:  # noqa: BLE001
        eprint(f"[parse_demo] aviso: falha ao ler header ({exc})")
    map_name = header.get("map_name") or header.get("map") or "unknown"

    windows = build_round_windows(parser)
    if not windows:
        raise RuntimeError(
            "Não foi possível identificar nenhuma rodada completa nesta demo "
            "(eventos round_freeze_end/round_end ausentes ou vazios)."
        )

    death_df = safe_parse_event(parser, "player_death", other=["weapon", "headshot"])
    hurt_df = safe_parse_event(parser, "player_hurt", other=["dmg_health"])
    plant_df = safe_parse_event(parser, "bomb_planted")
    fire_df = safe_parse_event(parser, "weapon_fire")
    smoke_start_df = safe_parse_event(parser, "smokegrenade_detonate")
    smoke_end_df = safe_parse_event(parser, "smokegrenade_expired")
    fire_start_df = safe_parse_event(parser, "inferno_startburn")
    fire_end_df = safe_parse_event(parser, "inferno_expire")
    flash_df = safe_parse_event(parser, "flashbang_detonate")
    blind_df = safe_parse_event(parser, "player_blind", other=["blind_duration"])
    decoy_start_df = safe_parse_event(parser, "decoy_started")
    decoy_end_df = safe_parse_event(parser, "decoy_detonate")
    try:
        grenades_df = parser.parse_grenades()
    except Exception as exc:  # noqa: BLE001
        eprint(f"[parse_demo] aviso: parse_grenades falhou ({exc})")
        grenades_df = None

    # --- Uma única chamada a parse_ticks pra tudo que precisa de posição/prop
    #     por tick: lado (team_num), economia (current_equip_value), área
    #     (last_place_name) e as amostras esparsas de keyPositions. ---
    sample_ticks_set = set()
    for w in windows:
        sample_ticks_set.add(w["freezeTick"])
        t = w["freezeTick"]
        while t < w["endTick"]:
            sample_ticks_set.add(int(t))
            t += POSITION_SAMPLE_SECONDS * TICK_RATE
        sample_ticks_set.add(w["endTick"])
    # contatos (mortes/dano/plant/tiro) também viram amostras de posição, pra
    # capturar o momento exato de engajamento, não só a grade fixa de 3 em 3s.
    for df in (death_df, hurt_df, plant_df, fire_df):
        if df is not None and "tick" in df.columns:
            sample_ticks_set.update(int(t) for t in df["tick"].tolist())

    ticks_df = safe_parse_ticks(
        parser,
        [
            "X",
            "Y",
            "team_num",
            "current_equip_value",
            "last_place_name",
            "health",
            "yaw",
            "weapon_name",
            "armor_value",
            "has_helmet",
            "kills_total",
            "deaths_total",
            "assists_total",
        ],
        sorted(sample_ticks_set),
    )
    if ticks_df is None or len(ticks_df) == 0:
        raise RuntimeError("Não foi possível ler posições/props por tick desta demo (parse_ticks vazio).")

    has_place_name = "last_place_name" in ticks_df.columns
    has_yaw = "yaw" in ticks_df.columns
    has_weapon_name = "weapon_name" in ticks_df.columns
    has_armor = "armor_value" in ticks_df.columns
    has_helmet_col = "has_helmet" in ticks_df.columns
    has_kda = all(c in ticks_df.columns for c in ("kills_total", "deaths_total", "assists_total"))
    ticks_by_tick = {tick: grp for tick, grp in ticks_df.groupby("tick")}

    def rows_at(tick: int):
        grp = ticks_by_tick.get(tick)
        return grp if grp is not None else ticks_df.iloc[0:0]

    def nearest_rows_at_or_before(tick: int):
        """Pega a última amostra <= tick pra um round específico — usado quando
        o tick exato pedido não bateu em `ticks_by_tick` (acontece se o demo
        pular alguns ticks intermediários)."""
        available = [t for t in ticks_by_tick.keys() if t <= tick]
        if not available:
            return ticks_df.iloc[0:0]
        return ticks_by_tick[max(available)]

    # --- Round 1 define quem é cada "roster" (grupo de 5 steamids) — o lado
    #     (ct/t) troca no intervalo, mas a composição do time não. Usado só
    #     pra dar um placar final estável entre os dois lados. ---
    first_round_rows = rows_at(windows[0]["freezeTick"])
    if len(first_round_rows) == 0:
        first_round_rows = nearest_rows_at_or_before(windows[0]["freezeTick"])
    roster_by_side_r1 = {"ct": set(), "t": set()}
    for r in first_round_rows.itertuples():
        side = coerce_side(getattr(r, "team_num", None))
        if side:
            roster_by_side_r1[side].add(int(r.steamid))

    player_side_counts: dict = {}  # steamid -> {"ct": n, "t": n}
    player_names: dict = {}  # steamid -> name (última vista)
    player_area_counts: dict = {}  # steamid -> {area: count}
    player_kills: dict = {}
    player_deaths: dict = {}
    player_assists: dict = {}
    player_dmg: dict = {}
    player_entry_attempts: dict = {}
    player_entry_success: dict = {}
    player_clutches_won: dict = {}
    player_clutches_lost: dict = {}

    def bump(d: dict, key, amount=1):
        d[key] = d.get(key, 0) + amount

    rounds_out = []
    roster_wins = {"ct": 0, "t": 0}  # na verdade acumula por roster via round["winner"] abaixo

    for w in windows:
        freeze_tick, end_tick, winner = w["freezeTick"], w["endTick"], w["winner"]

        side_rows = rows_at(freeze_tick)
        if len(side_rows) == 0:
            side_rows = nearest_rows_at_or_before(freeze_tick)

        side_map = {}  # steamid -> 'ct'/'t' nesta rodada
        equip_by_side = {"ct": [], "t": []}
        for r in side_rows.itertuples():
            steamid = int(r.steamid)
            side = coerce_side(getattr(r, "team_num", None))
            if not side:
                continue
            side_map[steamid] = side
            name = getattr(r, "name", None)
            if name:
                player_names[steamid] = name
            equip = getattr(r, "current_equip_value", None)
            if equip is not None and str(equip) != "nan":
                equip_by_side[side].append(float(equip))

            counts = player_side_counts.setdefault(steamid, {"ct": 0, "t": 0})
            counts[side] += 1

        # roster do round 1 ganha o crédito da vitória, independente do lado atual
        for roster_side, ids in roster_by_side_r1.items():
            occupying_side = None
            # quem desse roster está jogando qual lado agora?
            sample_id = next(iter(ids), None)
            if sample_id is not None and sample_id in side_map:
                occupying_side = side_map[sample_id]
            if occupying_side == winner:
                roster_wins[roster_side] = roster_wins.get(roster_side, 0) + 1

        buy_type = {
            side: classify_buy_type(sum(vals) / len(vals) if vals else 0.0) for side, vals in equip_by_side.items()
        }

        # --- deslocamento inicial por lado (pra tempo/postura) ---
        mid_tick = int(freeze_tick + EARLY_CONTACT_SECONDS * TICK_RATE)
        start_rows = side_rows
        mid_rows = rows_at(mid_tick)
        if len(mid_rows) == 0:
            mid_rows = nearest_rows_at_or_before(min(mid_tick, end_tick))
        start_pos = {int(r.steamid): (r.X, r.Y) for r in start_rows.itertuples() if str(getattr(r, "X", "nan")) != "nan"}
        mid_pos = {int(r.steamid): (r.X, r.Y) for r in mid_rows.itertuples() if str(getattr(r, "X", "nan")) != "nan"}

        displacement_by_side = {"ct": [], "t": []}
        areas_reached_by_side = {"ct": set(), "t": set()}
        for steamid, side in side_map.items():
            if steamid in start_pos and steamid in mid_pos:
                dx = mid_pos[steamid][0] - start_pos[steamid][0]
                dy = mid_pos[steamid][1] - start_pos[steamid][1]
                displacement_by_side[side].append((dx * dx + dy * dy) ** 0.5)
            if has_place_name:
                row = mid_rows[mid_rows["steamid"] == steamid]
                if len(row) > 0:
                    place = row.iloc[0].get("last_place_name")
                    area = area_from_place_name(place)
                    if area != "unknown":
                        areas_reached_by_side[side].add(area)

        def avg(vals):
            return sum(vals) / len(vals) if vals else 0.0

        tempo_by_side = {}
        stance_by_side = {}
        for side in ("ct", "t"):
            disp = displacement_by_side[side]
            avg_disp = avg(disp)
            spread = len(areas_reached_by_side[side])
            if avg_disp >= HIGH_DISPLACEMENT and spread <= 1:
                tempo_by_side[side] = "rush"
            elif spread >= 2:
                tempo_by_side[side] = "split"
            elif avg_disp <= LOW_DISPLACEMENT:
                tempo_by_side[side] = "slow"
            else:
                tempo_by_side[side] = "default"

            if not disp:
                stance_by_side[side] = "unknown"
            else:
                high = sum(1 for d in disp if d >= HIGH_DISPLACEMENT)
                low = sum(1 for d in disp if d <= LOW_DISPLACEMENT)
                if high >= len(disp) * 0.6:
                    stance_by_side[side] = "aggressive"
                elif low >= len(disp) * 0.6:
                    stance_by_side[side] = "passive"
                else:
                    stance_by_side[side] = "passive-aggressive"

        # --- mortes/dano da rodada ---
        round_deaths = None
        if death_df is not None:
            round_deaths = death_df[(death_df["tick"] > freeze_tick) & (death_df["tick"] <= end_tick)].sort_values("tick")
        round_hurts = None
        if hurt_df is not None:
            round_hurts = hurt_df[(hurt_df["tick"] > freeze_tick) & (hurt_df["tick"] <= end_tick)]
        round_shots = None
        if fire_df is not None:
            round_shots = fire_df[(fire_df["tick"] > freeze_tick) & (fire_df["tick"] <= end_tick)]

        entry_by = None
        entry_on = None
        if round_deaths is not None and len(round_deaths) > 0:
            first = round_deaths.iloc[0]
            attacker_id = first.get("attacker_steamid")
            user_id = first.get("user_steamid")
            entry_by = first.get("attacker_name")
            entry_on = first.get("user_name")
            if attacker_id is not None and str(attacker_id) != "nan":
                bump(player_entry_attempts, int(attacker_id))
                bump(player_entry_success, int(attacker_id))
            if user_id is not None and str(user_id) != "nan":
                bump(player_entry_attempts, int(user_id))

        if round_deaths is not None:
            for d in round_deaths.itertuples():
                attacker_id = getattr(d, "attacker_steamid", None)
                user_id = getattr(d, "user_steamid", None)
                assister_id = getattr(d, "assister_steamid", None)
                if attacker_id is not None and str(attacker_id) != "nan":
                    bump(player_kills, int(attacker_id))
                if user_id is not None and str(user_id) != "nan":
                    bump(player_deaths, int(user_id))
                if assister_id is not None and str(assister_id) != "nan":
                    bump(player_assists, int(assister_id))

        if round_hurts is not None:
            for h in round_hurts.itertuples():
                attacker_id = getattr(h, "attacker_steamid", None)
                dmg = getattr(h, "dmg_health", 0) or 0
                if attacker_id is not None and str(attacker_id) != "nan":
                    bump(player_dmg, int(attacker_id), float(dmg))

        # --- clutch: simula contagem de vivos por lado a partir de 5v5 ---
        if round_deaths is not None and len(round_deaths) > 0:
            alive = {"ct": set(), "t": set()}
            for steamid, side in side_map.items():
                alive[side].add(steamid)
            clutch_candidate = None
            clutch_side = None
            for d in round_deaths.itertuples():
                user_id = getattr(d, "user_steamid", None)
                if user_id is None or str(user_id) == "nan":
                    continue
                user_id = int(user_id)
                died_side = side_map.get(user_id)
                if died_side:
                    alive[died_side].discard(user_id)

                if clutch_candidate is None:
                    for side in ("ct", "t"):
                        other = "t" if side == "ct" else "ct"
                        if len(alive[side]) == 1 and len(alive[other]) >= 1:
                            clutch_candidate = next(iter(alive[side]))
                            clutch_side = side
                elif clutch_candidate == user_id:
                    # o próprio clutcher morreu antes do fim do round
                    bump(player_clutches_lost, clutch_candidate)
                    clutch_candidate = None
                    clutch_side = None

            if clutch_candidate is not None and clutch_side == winner:
                bump(player_clutches_won, clutch_candidate)

        # --- utilitário por lado ---
        utility_by_side = {
            "ct": {"flashes": 0, "smokes": 0, "molotovs": 0, "he": 0},
            "t": {"flashes": 0, "smokes": 0, "molotovs": 0, "he": 0},
        }
        if grenades_df is not None and "tick" in grenades_df.columns:
            round_nades = grenades_df[(grenades_df["tick"] > freeze_tick) & (grenades_df["tick"] <= end_tick)]
            name_col = "name" if "name" in round_nades.columns else None
            thrower_col = "thrower_steamid" if "thrower_steamid" in round_nades.columns else None
            for n in round_nades.itertuples():
                gname = str(getattr(n, name_col, "") or "").lower() if name_col else ""
                thrower_id = getattr(n, thrower_col, None) if thrower_col else None
                side = side_map.get(int(thrower_id)) if thrower_id is not None and str(thrower_id) != "nan" else None
                if not side:
                    continue
                if "flash" in gname:
                    utility_by_side[side]["flashes"] += 1
                elif "smoke" in gname:
                    utility_by_side[side]["smokes"] += 1
                elif "molotov" in gname or "incendiary" in gname or "inferno" in gname:
                    utility_by_side[side]["molotovs"] += 1
                elif "hegrenade" in gname or gname == "he":
                    utility_by_side[side]["he"] += 1

        # --- site: onde o bomb foi plantado (ou, sem plant, onde a entry frag aconteceu) ---
        site_hit = "unknown"
        if plant_df is not None and "tick" in plant_df.columns:
            round_plants = plant_df[(plant_df["tick"] > freeze_tick) & (plant_df["tick"] <= end_tick)]
            if len(round_plants) > 0 and has_place_name:
                plant_tick = int(round_plants.iloc[0]["tick"])
                planter_id = round_plants.iloc[0].get("user_steamid")
                plant_rows = rows_at(plant_tick)
                if planter_id is not None and str(planter_id) != "nan" and len(plant_rows) > 0:
                    prow = plant_rows[plant_rows["steamid"] == int(planter_id)]
                    if len(prow) > 0:
                        site_hit = area_from_place_name(prow.iloc[0].get("last_place_name"))
        if site_hit == "unknown" and has_place_name and round_deaths is not None and len(round_deaths) > 0:
            first_tick = int(round_deaths.iloc[0]["tick"])
            rows = rows_at(first_tick)
            if len(rows) > 0:
                site_hit = area_from_place_name(rows.iloc[0].get("last_place_name"))

        # --- posições esparsas (keyPositions) ---
        # grade fixa de 3 em 3s + o tick exato de qualquer morte/dano/plant/tiro
        # nesta rodada, pra capturar o momento de engajamento com precisão (não
        # só interpolado entre dois pontos da grade).
        key_positions = []
        t = freeze_tick
        sample_ticks_local = set()
        while t < end_tick:
            sample_ticks_local.add(int(t))
            t += POSITION_SAMPLE_SECONDS * TICK_RATE
        sample_ticks_local.add(end_tick)
        for df in (round_deaths, round_hurts, round_shots):
            if df is not None and "tick" in df.columns:
                sample_ticks_local.update(int(v) for v in df["tick"].tolist())
        sample_ticks = sorted(sample_ticks_local)
        for st in sample_ticks:
            rows = rows_at(st)
            for r in rows.itertuples():
                steamid = int(r.steamid)
                side = side_map.get(steamid)
                x = getattr(r, "X", None)
                y = getattr(r, "Y", None)
                if side is None or x is None or str(x) == "nan":
                    continue
                position_entry = {
                    "player": player_names.get(steamid, str(steamid)),
                    "side": side,
                    "x": round(float(x), 1),
                    "y": round(float(y), 1),
                    "t": round((st - freeze_tick) / TICK_RATE, 1),
                }
                if has_yaw:
                    yaw_val = getattr(r, "yaw", None)
                    if yaw_val is not None and str(yaw_val) != "nan":
                        position_entry["yaw"] = round(float(yaw_val), 1)
                key_positions.append(position_entry)
                if has_place_name:
                    place = getattr(r, "last_place_name", None)
                    area = area_from_place_name(place) if place and area_from_place_name(place) != "unknown" else place
                    if place:
                        counts = player_area_counts.setdefault(steamid, {})
                        counts[str(place)] = counts.get(str(place), 0) + 1

        # --- mortes com posição (pro "X" no mapa 2D) ---
        deaths_out = []
        if round_deaths is not None:
            for d in round_deaths.itertuples():
                user_id = getattr(d, "user_steamid", None)
                if user_id is None or str(user_id) == "nan":
                    continue
                user_id = int(user_id)
                side = side_map.get(user_id)
                if side is None:
                    continue
                death_tick = int(d.tick)
                drow = rows_at(death_tick)
                drow = drow[drow["steamid"] == user_id]
                if len(drow) == 0:
                    drow = nearest_rows_at_or_before(death_tick)
                    drow = drow[drow["steamid"] == user_id]
                if len(drow) == 0 or str(drow.iloc[0].get("X")) == "nan":
                    continue
                death_entry = {
                    "player": player_names.get(user_id, str(user_id)),
                    "side": side,
                    "x": round(float(drow.iloc[0]["X"]), 1),
                    "y": round(float(drow.iloc[0]["Y"]), 1),
                    "t": round((death_tick - freeze_tick) / TICK_RATE, 1),
                }
                attacker_name = getattr(d, "attacker_name", None)
                if attacker_name and str(attacker_name) != "nan":
                    death_entry["by"] = attacker_name
                assister_name = getattr(d, "assister_name", None)
                if assister_name and str(assister_name) != "nan":
                    death_entry["assist"] = assister_name
                weapon_used = getattr(d, "weapon", None)
                if weapon_used and str(weapon_used) != "nan":
                    death_entry["weapon"] = str(weapon_used)
                if bool(getattr(d, "headshot", False)):
                    death_entry["headshot"] = True
                deaths_out.append(death_entry)

        # --- tiros (pro indicador "atirando" no mapa 2D) ---
        shots_out = []
        if round_shots is not None:
            for s in round_shots.itertuples():
                shooter_id = getattr(s, "user_steamid", None)
                if shooter_id is None or str(shooter_id) == "nan":
                    continue
                shooter_id = int(shooter_id)
                side = side_map.get(shooter_id)
                if side is None:
                    continue
                shots_out.append(
                    {
                        "player": player_names.get(shooter_id, str(shooter_id)),
                        "side": side,
                        "t": round((int(s.tick) - freeze_tick) / TICK_RATE, 1),
                    }
                )

        # --- loadout pós-compra (pro placar de economia no mapa 2D) ---
        loadout_out = []
        for r in side_rows.itertuples():
            steamid = int(r.steamid)
            side = side_map.get(steamid)
            if side is None:
                continue
            equip = getattr(r, "current_equip_value", None)
            loadout_entry = {
                "player": player_names.get(steamid, str(steamid)),
                "side": side,
                "weapon": None,
                "equipValue": int(float(equip)) if equip is not None and str(equip) != "nan" else 0,
            }
            if has_weapon_name:
                weapon_name = getattr(r, "weapon_name", None)
                if weapon_name and str(weapon_name) != "nan":
                    loadout_entry["weapon"] = str(weapon_name)
            health = getattr(r, "health", None)
            if health is not None and str(health) != "nan":
                loadout_entry["health"] = int(float(health))
            if has_armor:
                armor = getattr(r, "armor_value", None)
                if armor is not None and str(armor) != "nan":
                    loadout_entry["armor"] = int(float(armor))
            if has_helmet_col:
                has_helmet = getattr(r, "has_helmet", None)
                if has_helmet is not None and str(has_helmet) != "nan":
                    loadout_entry["hasHelmet"] = bool(has_helmet)
            if has_kda:
                kills = getattr(r, "kills_total", None)
                deaths = getattr(r, "deaths_total", None)
                assists = getattr(r, "assists_total", None)
                if kills is not None and str(kills) != "nan":
                    loadout_entry["kills"] = int(float(kills))
                if deaths is not None and str(deaths) != "nan":
                    loadout_entry["deaths"] = int(float(deaths))
                if assists is not None and str(assists) != "nan":
                    loadout_entry["assists"] = int(float(assists))
            loadout_out.append(loadout_entry)

        # --- granadas de área (fumaça/fogo/decoy) + flashes/cegueira ---
        smokes_out = pair_grenade_lifespan(
            smoke_start_df, smoke_end_df, freeze_tick, end_tick, int(SMOKE_DEFAULT_DURATION_SECONDS * TICK_RATE)
        )
        fires_out = pair_grenade_lifespan(
            fire_start_df, fire_end_df, freeze_tick, end_tick, int(FIRE_DEFAULT_DURATION_SECONDS * TICK_RATE)
        )
        decoys_out = pair_grenade_lifespan(
            decoy_start_df, decoy_end_df, freeze_tick, end_tick, int(DECOY_DEFAULT_DURATION_SECONDS * TICK_RATE)
        )

        flashes_out = []
        if flash_df is not None and "tick" in flash_df.columns:
            round_flashes = flash_df[(flash_df["tick"] > freeze_tick) & (flash_df["tick"] <= end_tick)]
            for f in round_flashes.itertuples():
                x, y = event_xy(f)
                if x is None or str(x) == "nan":
                    continue
                flashes_out.append(
                    {
                        "x": round(float(x), 1),
                        "y": round(float(y), 1),
                        "t": round((int(f.tick) - freeze_tick) / TICK_RATE, 1),
                    }
                )

        blinds_out = []
        if blind_df is not None and "tick" in blind_df.columns:
            round_blinds = blind_df[(blind_df["tick"] > freeze_tick) & (blind_df["tick"] <= end_tick)]
            for b in round_blinds.itertuples():
                user_id = getattr(b, "user_steamid", None)
                if user_id is None or str(user_id) == "nan":
                    continue
                user_id = int(user_id)
                side = side_map.get(user_id)
                if side is None:
                    continue
                duration = getattr(b, "blind_duration", None)
                if duration is None or str(duration) == "nan":
                    continue
                blinds_out.append(
                    {
                        "player": player_names.get(user_id, str(user_id)),
                        "side": side,
                        "t": round((int(b.tick) - freeze_tick) / TICK_RATE, 1),
                        "duration": round(float(duration), 1),
                    }
                )

        rounds_out.append(
            {
                "roundNumber": w["roundNumber"],
                "winner": winner,
                "ct": {
                    "buyType": buy_type["ct"],
                    "tempo": tempo_by_side["ct"],
                    "stance": stance_by_side["ct"],
                    "utilityUsed": utility_by_side["ct"],
                },
                "t": {
                    "buyType": buy_type["t"],
                    "tempo": tempo_by_side["t"],
                    "stance": stance_by_side["t"],
                    "utilityUsed": utility_by_side["t"],
                },
                "entryFragBy": entry_by,
                "entryFragOn": entry_on,
                "siteHit": site_hit,
                "keyPositions": key_positions,
                "deaths": deaths_out,
                "shots": shots_out,
                "loadout": loadout_out,
                "smokes": smokes_out,
                "fires": fires_out,
                "decoys": decoys_out,
                "flashes": flashes_out,
                "blinds": blinds_out,
            }
        )

    rounds_played = len(rounds_out)
    players_out = []
    all_ids = set(player_side_counts.keys()) | set(player_names.keys())
    for steamid in all_ids:
        counts = player_side_counts.get(steamid, {"ct": 0, "t": 0})
        side = "ct" if counts.get("ct", 0) >= counts.get("t", 0) else "t"
        kills = player_kills.get(steamid, 0)
        deaths = player_deaths.get(steamid, 0)
        assists = player_assists.get(steamid, 0)
        dmg = player_dmg.get(steamid, 0.0)
        adr = round(dmg / rounds_played, 1) if rounds_played else 0.0
        areas = player_area_counts.get(steamid, {})
        favorite_areas = sorted(
            [{"area": a, "count": c} for a, c in areas.items()], key=lambda e: e["count"], reverse=True
        )
        players_out.append(
            {
                "steamId": str(steamid),
                "name": player_names.get(steamid, str(steamid)),
                "side": side,
                "kills": kills,
                "deaths": deaths,
                "assists": assists,
                "adr": adr,
                "entryAttempts": player_entry_attempts.get(steamid, 0),
                "entrySuccess": player_entry_success.get(steamid, 0),
                "clutchesWon": player_clutches_won.get(steamid, 0),
                "clutchesLost": player_clutches_lost.get(steamid, 0),
                "favoriteAreas": favorite_areas,
            }
        )

    final_score = {"team": roster_wins.get("ct", 0), "opponent": roster_wins.get("t", 0)}

    summary = {
        "demoId": "placeholder",  # sobrescrito pelo Electron ao gravar (record.id vira o demoId real)
        "map": map_name,
        "finalScore": final_score,
        "rounds": rounds_out,
        "playerAggregates": players_out,
        "fileName": os.path.basename(args.input),
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
