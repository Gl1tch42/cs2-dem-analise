import argparse
import bisect
import json
import math
import os
import sys
from typing import Optional

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

from demoparser2 import DemoParser

TICK_RATE = 64.0

# Bump whenever detection logic for any metric changes (opening duel, trade,
# flash assist, crosshair placement, TTD/TTK, overexposure, utility
# efficiency). Consumers (golden-demo validation, historical analyses) use
# this to know which analytics results are comparable/reproducible.
# Independent from electron/ai/scoreEngine.ts's SCORING_MODEL_VERSION, which
# versions the separate 0-100 scoring layer.
FEATURE_MODEL_VERSION = "v1-heuristic"

TEAM_NUM_TO_SIDE = {2: "t", 3: "ct"}

def coerce_side(value) -> Optional[str]:
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

BUY_ECO_MAX = 2000
BUY_FORCE_MAX = 3000
BUY_SEMI_MAX = 4000

EARLY_CONTACT_SECONDS = 15.0
HIGH_DISPLACEMENT = 900.0
LOW_DISPLACEMENT = 250.0

POSITION_SAMPLE_SECONDS = 3.0

SMOKE_DEFAULT_DURATION_SECONDS = 18.0
FIRE_DEFAULT_DURATION_SECONDS = 7.0
DECOY_DEFAULT_DURATION_SECONDS = 18.0
C4_FUSE_SECONDS = 40.0

# Janela de amostragem densa de "spotted" (T_spot) usada pra Spotted Accuracy,
# Time to Damage, Time to Kill e Crosshair Placement — só é aplicada nos
# segundos que antecedem cada `weapon_fire`, não na rodada inteira (rodada
# inteira em resolução fina explodiria o volume de dados). Se o total de ticks
# extras estourar o teto, o passo aumenta (amostragem mais grossa) em vez de
# falhar.
SPOTTED_WINDOW_SECONDS = 6.0
SPOTTED_SAMPLE_STEP_TICKS = 2
SPOTTED_SAMPLE_MAX_EXTRA_TICKS = 150000

def build_dense_spot_window_ticks(fire_df, demo_start_tick: int, demo_end_tick: int) -> set:
    if fire_df is None or "tick" not in fire_df.columns:
        return set()
    shot_ticks = sorted({int(t) for t in fire_df["tick"].tolist() if str(t) != "nan"})
    if not shot_ticks:
        return set()

    window_ticks = int(SPOTTED_WINDOW_SECONDS * TICK_RATE)

    def build(step: int) -> set:
        out = set()
        for shot_tick in shot_ticks:
            start = max(demo_start_tick, shot_tick - window_ticks)
            t = start
            while t <= shot_tick:
                out.add(t)
                t += step
            out.add(shot_tick)
        return out

    step = SPOTTED_SAMPLE_STEP_TICKS
    dense = build(step)
    while len(dense) > SPOTTED_SAMPLE_MAX_EXTRA_TICKS and step < window_ticks:
        step *= 2
        dense = build(step)
        eprint(f"[parse_demo] aviso: janela densa de spotted grande demais, aumentando passo pra {step} ticks")
    return dense

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

def safe_parse_event(parser: DemoParser, name: str, optional_other: list = None, **kwargs):
    # `optional_other` são campos de "other=" que a gente quer se existirem, mas
    # cujo nome exato/disponibilidade não é garantida em toda versão de demo —
    # ao contrário dos campos em kwargs["other"], que são considerados obrigatórios
    # (se faltarem, o evento inteiro é descartado, igual ao comportamento antigo).
    optional_other = list(optional_other) if optional_other else []
    base_other = list(kwargs.pop("other", []))
    attempt_other = base_other + optional_other
    while True:
        call_kwargs = dict(kwargs)
        if attempt_other:
            call_kwargs["other"] = attempt_other
        try:
            df = parser.parse_event(name, **call_kwargs)
            # demoparser2 retorna uma lista (geralmente vazia) em vez de DataFrame
            # quando o evento nunca ocorre na demo inteira — normaliza pra None.
            if not hasattr(df, "columns"):
                return None
            return df
        except Exception as exc:
            eprint(f"[parse_demo] aviso: evento '{name}' com other={attempt_other} falhou ({exc})")
            dropped = False
            for optional in optional_other:
                if optional in attempt_other:
                    attempt_other = [o for o in attempt_other if o != optional]
                    dropped = True
                    break
            if not dropped:
                if attempt_other:
                    # ainda sobrou algo de base_other que falhou — tenta sem nada
                    # de "other" antes de desistir de vez.
                    attempt_other = []
                    continue
                eprint(f"[parse_demo] aviso: evento '{name}' indisponível nesta demo")
                return None

OPTIONAL_TICK_PROPS = [
    "last_place_name",
    "weapon_name",
    "yaw",
    "pitch",
    "Z",
    "velocity_X",
    "velocity_Y",
    "armor_value",
    "has_helmet",
    "kills_total",
    "deaths_total",
    "assists_total",
    "spotted",
    "flash_duration",
    "ducking",
]

def safe_parse_ticks(parser: DemoParser, props: list, ticks: list):
    attempt = list(props)
    while True:
        try:
            return parser.parse_ticks(attempt, ticks=ticks)
        except Exception as exc:
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
    x = getattr(row, "x", None)
    if x is None:
        x = getattr(row, "X", None)
    y = getattr(row, "y", None)
    if y is None:
        y = getattr(row, "Y", None)
    return x, y

GRENADE_PATH_SEGMENT_GAP_TICKS = 16  # ~0.25s a 64 tick/s: quebra o df em voos distintos
GRENADE_PATH_MATCH_TOLERANCE_TICKS = 64  # ~1s: janela p/ casar o fim do voo com o evento de detonação

def normalize_grenade_category(raw) -> Optional[str]:
    """demoparser2 não documenta de forma confiável o texto exato de
    `grenade_type` (varia por versão/capitalização — ver README, item 1).
    Casa por substring em vez de comparar contra um enum fixo."""
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if not s or s == "nan":
        return None
    if "decoy" in s:
        return "decoy"
    if "flash" in s:
        return "flashbang"
    if "smoke" in s:
        return "smokegrenade"
    if "molotov" in s or "incendiary" in s or "inferno" in s:
        return "molotov"
    if "he" in s:
        return "he"
    return None

def build_grenade_flight_paths(grenades_df) -> dict:
    """`parser.parse_grenades()` traz 1 linha por TICK da posição real do
    projétil (inclui quiques em parede — a demo não interpola em linha reta
    do lançador até a detonação). Agrupa essas linhas em voos individuais
    por (steamid do lançador, categoria da granada), retornando
    {(steamid, categoria): [voo1, voo2, ...]} onde cada voo é uma lista
    ordenada de (tick, x, y)."""
    paths: dict = {}
    if grenades_df is None or len(grenades_df) == 0:
        return paths
    cols = set(grenades_df.columns)
    if "tick" not in cols:
        return paths
    # Nomes de coluna variam entre versões do demoparser2 (ver README, item 1
    # — "thrower_steamid" nem sempre existe, o real costuma ser "steamid").
    thrower_col = next((c for c in ("thrower_steamid", "steamid") if c in cols), None)
    type_col = "grenade_type" if "grenade_type" in cols else None
    x_col = next((c for c in ("X", "x") if c in cols), None)
    y_col = next((c for c in ("Y", "y") if c in cols), None)
    if thrower_col is None or type_col is None or x_col is None or y_col is None:
        return paths

    raw_points: dict = {}
    for row in grenades_df.itertuples():
        thrower = getattr(row, thrower_col, None)
        if thrower is None or str(thrower) == "nan":
            continue
        category = normalize_grenade_category(getattr(row, type_col, None))
        if category is None:
            continue
        x = getattr(row, x_col, None)
        y = getattr(row, y_col, None)
        if x is None or y is None or str(x) == "nan" or str(y) == "nan":
            continue
        try:
            # NÃO usar int(float(thrower)): SteamID64 (~7.6e16) excede 2^53, o maior
            # inteiro que um float64 representa exatamente — o roundtrip por float
            # corrompe o id (ex.: 76561198009653545 vira 76561198009653552), fazendo a
            # chave nunca bater com o steamid usado no resto do código (que não passa
            # por float). Resultado prático: quase nenhum voo de granada real (com
            # quique) era encontrado, e o desenho caía sempre na aproximação em linha reta.
            key = (int(thrower), category)
        except (ValueError, TypeError):
            continue
        raw_points.setdefault(key, []).append((int(row.tick), float(x), float(y)))

    for key, points in raw_points.items():
        points.sort(key=lambda p: p[0])
        flights = []
        current: list = []
        last_tick = None
        for tick, x, y in points:
            if last_tick is not None and tick - last_tick > GRENADE_PATH_SEGMENT_GAP_TICKS:
                if len(current) >= 2:
                    flights.append(current)
                current = []
            if not current or tick != current[-1][0]:
                current.append((tick, x, y))
            last_tick = tick
        if len(current) >= 2:
            flights.append(current)
        if flights:
            paths[key] = flights
    return paths

def find_grenade_path(grenade_paths: dict, thrower_id, category: str, detonate_tick: int, freeze_tick: int):
    """Acha o voo (com o quique real, se houve) cujo tick mais próximo bate com
    o tick de detonação/ignição desse evento específico, e converte pra
    segundos relativos ao freeze do round.

    Casa pelo ponto do voo mais próximo de `detonate_tick` — NÃO pelo último
    ponto do voo. HE/smoke/decoy continuam aparecendo em parse_grenades() por
    vários segundos depois de pousar (prop de granada ainda "vivo" na engine),
    então o fim bruto do voo fica bem depois da detonação real; flashbang e
    molotov não têm essa cauda (o entity some no próprio impacto), por isso só
    apareciam quando o casamento usava o último ponto. Corta o voo devolvido
    nesse ponto casado, senão a trajetória desenhada incluiria a granada
    "parada" no chão depois de já ter detonado."""
    if not grenade_paths or thrower_id is None or category is None:
        return None
    flights = grenade_paths.get((thrower_id, category))
    if not flights:
        return None
    best = None
    best_diff = None
    best_idx = None
    for flight in flights:
        idx = min(range(len(flight)), key=lambda i: abs(flight[i][0] - detonate_tick))
        diff = abs(flight[idx][0] - detonate_tick)
        if best_diff is None or diff < best_diff:
            best_diff = diff
            best = flight
            best_idx = idx
    if best is None or best_diff > GRENADE_PATH_MATCH_TOLERANCE_TICKS:
        return None
    return [
        {"x": round(x, 1), "y": round(y, 1), "t": round((tick - freeze_tick) / TICK_RATE, 1)}
        for tick, x, y in best[: best_idx + 1]
    ]

def pair_grenade_lifespan(
    start_df, end_df, freeze_tick: int, end_tick: int, default_duration_ticks: int, player_names: dict = None,
    grenade_paths: dict = None, category: str = None,
):
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
        entry = {
            "x": round(float(x), 1),
            "y": round(float(y), 1),
            "startT": round((start_tick - freeze_tick) / TICK_RATE, 1),
            "endT": round((candidate_end - freeze_tick) / TICK_RATE, 1),
        }
        thrower_id = getattr(row, "user_steamid", None)
        has_thrower = thrower_id is not None and str(thrower_id) != "nan"
        if player_names is not None and has_thrower:
            entry["player"] = player_names.get(int(thrower_id), str(int(thrower_id)))
        if grenade_paths and category and has_thrower:
            path = find_grenade_path(grenade_paths, int(thrower_id), category, start_tick, freeze_tick)
            if path:
                entry["path"] = path
        results.append(entry)
    return results

def build_round_windows(parser: DemoParser):
    freeze_df = safe_parse_event(parser, "round_freeze_end")
    end_df = safe_parse_event(parser, "round_end", other=["winner", "reason"])
    if freeze_df is None or end_df is None or len(freeze_df) == 0 or len(end_df) == 0:
        return []

    freeze_ticks = sorted(freeze_df["tick"].tolist())
    end_df = end_df.sort_values("tick")

    windows = []
    for i, row in enumerate(end_df.itertuples()):
        end_tick = int(row.tick)
        prev_end_tick = int(windows[-1]["endTick"]) if windows else -1
        candidates = [t for t in freeze_ticks if prev_end_tick < t < end_tick]
        if not candidates:
            continue
        freeze_tick = candidates[-1]

        winner_raw = getattr(row, "winner", None)
        side = coerce_side(winner_raw)
        if side is None:
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
    except Exception as exc:
        eprint(f"[parse_demo] aviso: falha ao ler header ({exc})")
    map_name = header.get("map_name") or header.get("map") or "unknown"

    windows = build_round_windows(parser)
    if not windows:
        raise RuntimeError(
            "Não foi possível identificar nenhuma rodada completa nesta demo "
            "(eventos round_freeze_end/round_end ausentes ou vazios)."
        )

    death_df = safe_parse_event(parser, "player_death", other=["weapon", "headshot"])
    hurt_df = safe_parse_event(
        parser, "player_hurt", other=["dmg_health"], optional_other=["hitgroup", "weapon"]
    )
    plant_df = safe_parse_event(parser, "bomb_planted")
    defuse_df = safe_parse_event(parser, "bomb_defused")
    explode_df = safe_parse_event(parser, "bomb_exploded")
    fire_df = safe_parse_event(parser, "weapon_fire", optional_other=["weapon"])
    smoke_start_df = safe_parse_event(parser, "smokegrenade_detonate")
    smoke_end_df = safe_parse_event(parser, "smokegrenade_expired")
    fire_start_df = safe_parse_event(parser, "inferno_startburn")
    fire_end_df = safe_parse_event(parser, "inferno_expire")
    flash_df = safe_parse_event(parser, "flashbang_detonate")
    he_df = safe_parse_event(parser, "hegrenade_detonate")
    blind_df = safe_parse_event(
        parser, "player_blind", other=["blind_duration"], optional_other=["attacker_steamid"]
    )
    decoy_start_df = safe_parse_event(parser, "decoy_started")
    decoy_end_df = safe_parse_event(parser, "decoy_detonate")

    grenades_df = None
    try:
        grenades_df = parser.parse_grenades()
    except Exception as exc:
        eprint(f"[parse_demo] aviso: parse_grenades falhou ({exc})")
    grenade_paths = build_grenade_flight_paths(grenades_df)
    # item_purchase alimenta "Utility Waste" (dinheiro morto com granada não jogada
    # na mão) — o nome do campo do item comprado varia entre versões/wrappers do
    # demoparser2 ("weapon" ou "item"), então tentamos os dois e usamos o que vier.
    purchase_df = safe_parse_event(parser, "item_purchase", optional_other=["weapon", "item"])

    has_hitgroup = hurt_df is not None and "hitgroup" in hurt_df.columns
    has_hurt_weapon = hurt_df is not None and "weapon" in hurt_df.columns
    has_fire_weapon = fire_df is not None and "weapon" in fire_df.columns
    has_blind_attacker = blind_df is not None and "attacker_steamid" in blind_df.columns
    has_purchase_weapon = purchase_df is not None and "weapon" in purchase_df.columns
    has_purchase_item = purchase_df is not None and "item" in purchase_df.columns

    GRENADE_PRICES = {
        "flashbang": 200,
        "smokegrenade": 300,
        "hegrenade": 300,
        "molotov": 400,
        "incgrenade": 600,
        "decoy": 50,
    }

    NON_GUN_WEAPONS = {
        "hegrenade", "flashbang", "smokegrenade", "molotov", "incgrenade",
        "decoy", "knife", "knife_t", "bayonet", "taser", "c4", "world",
    }

    def is_gun_weapon(name) -> bool:
        if name is None or str(name) == "nan":
            return False
        low = str(name).lower()
        if low in NON_GUN_WEAPONS:
            return False
        if "knife" in low or "bayonet" in low:
            return False
        return True

    def is_head_hitgroup(value) -> bool:
        if value is None or str(value) == "nan":
            return False
        try:
            return int(float(value)) == 1
        except (ValueError, TypeError):
            return str(value).lower() == "head"

    # Categorias de arma usadas pelas exceções pedidas (isolar sniper/shotgun de
    # head accuracy/HS%, restringir spray a rifle/SMG, tolerância de counter-strafe
    # quase zero pra sniper). Valores de velocidade são a velocidade máxima
    # aproximada (unidades/s) de cada arma no CS2 — aproximação de referência,
    # não authoritative; ajustar aqui se precisar calibrar.
    SNIPER_WEAPONS = {"awp", "ssg08", "g3sg1", "scar20"}
    SHOTGUN_WEAPONS = {"nova", "xm1014", "sawedoff", "mag7"}
    PISTOL_WEAPONS = {
        "glock", "usp_silencer", "hkp2000", "p250", "fiveseven", "tec9",
        "deagle", "revolver", "elite", "cz75a",
    }
    WEAPON_MAX_SPEED = {
        "knife": 250.0, "knife_t": 250.0, "bayonet": 250.0,
        "glock": 240.0, "usp_silencer": 240.0, "hkp2000": 240.0, "elite": 240.0,
        "tec9": 240.0, "fiveseven": 240.0, "cz75a": 240.0, "p250": 240.0,
        "deagle": 230.0, "revolver": 220.0,
        "mac10": 240.0, "mp9": 240.0, "bizon": 240.0, "mp7": 220.0, "ump45": 230.0, "p90": 230.0,
        "famas": 240.0, "galilar": 215.0, "ak47": 215.0, "m4a1": 225.0, "m4a1_silencer": 225.0,
        "aug": 220.0, "sg556": 210.0,
        "nova": 220.0, "xm1014": 215.0, "sawedoff": 210.0, "mag7": 225.0,
        "awp": 200.0, "ssg08": 230.0, "g3sg1": 215.0, "scar20": 215.0,
        "negev": 150.0, "m249": 160.0,
        "taser": 220.0,
    }
    DEFAULT_MAX_SPEED = 230.0
    COUNTER_STRAFE_RELATIVE_THRESHOLD = 0.34
    SNIPER_STATIONARY_THRESHOLD = 5.0

    def is_sniper_weapon(name) -> bool:
        return name is not None and str(name).lower() in SNIPER_WEAPONS

    def is_shotgun_weapon(name) -> bool:
        return name is not None and str(name).lower() in SHOTGUN_WEAPONS

    def is_rifle_or_smg_weapon(name) -> bool:
        if not is_gun_weapon(name):
            return False
        low = str(name).lower()
        return low not in SNIPER_WEAPONS and low not in SHOTGUN_WEAPONS and low not in PISTOL_WEAPONS

    def max_speed_for_weapon(name) -> float:
        if name is None or str(name) == "nan":
            return DEFAULT_MAX_SPEED
        return WEAPON_MAX_SPEED.get(str(name).lower(), DEFAULT_MAX_SPEED)

    sample_ticks_set = set()
    for w in windows:
        sample_ticks_set.add(w["freezeTick"])
        t = w["freezeTick"]
        while t < w["endTick"]:
            sample_ticks_set.add(int(t))
            t += POSITION_SAMPLE_SECONDS * TICK_RATE
        sample_ticks_set.add(w["endTick"])
    for df in (death_df, hurt_df, plant_df, defuse_df, explode_df, fire_df, he_df):
        if df is not None and "tick" in df.columns:
            sample_ticks_set.update(int(t) for t in df["tick"].tolist())

    demo_start_tick = windows[0]["freezeTick"]
    demo_end_tick = windows[-1]["endTick"]
    dense_spot_ticks = build_dense_spot_window_ticks(fire_df, demo_start_tick, demo_end_tick)
    sample_ticks_set.update(dense_spot_ticks)

    ticks_df = safe_parse_ticks(
        parser,
        [
            "X",
            "Y",
            "Z",
            "team_num",
            "current_equip_value",
            "last_place_name",
            "health",
            "yaw",
            "pitch",
            "velocity_X",
            "velocity_Y",
            "weapon_name",
            "armor_value",
            "has_helmet",
            "kills_total",
            "deaths_total",
            "assists_total",
            "spotted",
            "flash_duration",
            "ducking",
        ],
        sorted(sample_ticks_set),
    )
    if ticks_df is None or len(ticks_df) == 0:
        raise RuntimeError("Não foi possível ler posições/props por tick desta demo (parse_ticks vazio).")

    has_place_name = "last_place_name" in ticks_df.columns
    has_yaw = "yaw" in ticks_df.columns
    has_pitch = "pitch" in ticks_df.columns
    has_z = "Z" in ticks_df.columns
    has_velocity = "velocity_X" in ticks_df.columns and "velocity_Y" in ticks_df.columns
    has_weapon_name = "weapon_name" in ticks_df.columns
    has_spotted = "spotted" in ticks_df.columns
    has_flash_duration = "flash_duration" in ticks_df.columns
    has_ducking = "ducking" in ticks_df.columns
    has_armor = "armor_value" in ticks_df.columns
    has_helmet_col = "has_helmet" in ticks_df.columns
    has_kda = all(c in ticks_df.columns for c in ("kills_total", "deaths_total", "assists_total"))
    ticks_by_tick = {tick: grp for tick, grp in ticks_df.groupby("tick")}

    def rows_at(tick: int):
        grp = ticks_by_tick.get(tick)
        return grp if grp is not None else ticks_df.iloc[0:0]

    def nearest_rows_at_or_before(tick: int):
        available = [t for t in ticks_by_tick.keys() if t <= tick]
        if not available:
            return ticks_df.iloc[0:0]
        return ticks_by_tick[max(available)]

    # --- T_spot: quando cada jogador ficou visível pra algum inimigo ---
    # `spotted` no demoparser2 é por-entidade ("visível pra ALGUM inimigo"), não
    # por-par ("visível especificamente pro atirador X") — o CS2 tem um bitmask
    # por-par (`m_bSpottedByMask`) mas decodificar isso exigiria mapear steamid
    # pra índice de bit sem forma confiável de validar sem uma demo real, então
    # usamos o proxy booleano. Em duelos 1x1 (o caso mais comum pra TTD/TTK/
    # crosshair placement) isso equivale a "visível pro atirador"; em cenários
    # com mais de um inimigo vivo por perto pode atribuir o spot a outro
    # inimigo que viu primeiro — limitação conhecida, documentada no plano.
    MAX_SPOT_GAP_TICKS = SPOTTED_SAMPLE_STEP_TICKS * 8
    SPOTTED_LOOKBACK_TICKS = int(SPOTTED_WINDOW_SECONDS * TICK_RATE)

    spotted_by_player: dict = {}
    if has_spotted:
        for row in ticks_df.itertuples():
            spotted_val = getattr(row, "spotted", None)
            if spotted_val is None or str(spotted_val) == "nan":
                continue
            steamid = int(row.steamid)
            spotted_by_player.setdefault(steamid, []).append((int(row.tick), bool(spotted_val)))
        for steamid in spotted_by_player:
            spotted_by_player[steamid].sort(key=lambda pair: pair[0])

    def find_spot_start_tick(target_steamid: int, at_or_before_tick: int):
        if not has_spotted:
            return None
        samples = spotted_by_player.get(target_steamid)
        if not samples:
            return None
        ticks_only = [s[0] for s in samples]
        idx = bisect.bisect_right(ticks_only, at_or_before_tick) - 1
        if idx < 0:
            return None
        tick, spotted = samples[idx]
        if not spotted:
            return None
        earliest_allowed = at_or_before_tick - SPOTTED_LOOKBACK_TICKS
        spot_start = tick
        prev_tick = tick
        i = idx - 1
        while i >= 0:
            t, sp = samples[i]
            if t < earliest_allowed or not sp or (prev_tick - t) > MAX_SPOT_GAP_TICKS:
                break
            spot_start = t
            prev_tick = t
            i -= 1
        return spot_start

    def is_blinded_at(steamid: int, tick: int, threshold_seconds: float = 1.0) -> bool:
        if not has_flash_duration:
            return False
        rows = rows_at(tick)
        rows = rows[rows["steamid"] == steamid]
        if len(rows) == 0:
            return False
        val = rows.iloc[0].get("flash_duration")
        if val is None or str(val) == "nan":
            return False
        return float(val) >= threshold_seconds

    first_round_rows = rows_at(windows[0]["freezeTick"])
    if len(first_round_rows) == 0:
        first_round_rows = nearest_rows_at_or_before(windows[0]["freezeTick"])
    roster_by_side_r1 = {"ct": set(), "t": set()}
    for r in first_round_rows.itertuples():
        side = coerce_side(getattr(r, "team_num", None))
        if side:
            roster_by_side_r1[side].add(int(r.steamid))

    player_side_counts: dict = {}
    player_names: dict = {}
    player_area_counts: dict = {}
    player_kills: dict = {}
    player_hs_kills: dict = {}
    player_deaths: dict = {}
    player_assists: dict = {}
    player_dmg: dict = {}
    player_entry_attempts: dict = {}
    player_entry_success: dict = {}
    player_clutches_won: dict = {}
    player_clutches_lost: dict = {}

    # --- Aim ---
    player_shots_fired: dict = {}
    player_shots_hit: dict = {}
    player_head_hits: dict = {}
    # Head Accuracy e HS Kill% isolam sniper/shotgun (contadores separados,
    # não entram no numerador nem no denominador desses dois).
    player_combat_hits_excl: dict = {}
    player_head_hits_excl: dict = {}
    player_kills_excl: dict = {}
    player_hs_kills_excl: dict = {}
    player_first_bullet_shots: dict = {}
    player_first_bullet_hits: dict = {}
    player_spray_shots: dict = {}
    player_spray_hits: dict = {}
    player_counter_strafe_shots: dict = {}
    player_counter_strafe_total: dict = {}
    player_crosshair_deg_sum: dict = {}
    player_crosshair_deg_count: dict = {}
    player_spotted_shots_hit: dict = {}
    player_spotted_shots_total: dict = {}
    player_ttd_sum_ms: dict = {}
    player_ttd_count: dict = {}
    player_ttk_sum_ms: dict = {}
    player_ttk_count: dict = {}

    # --- Utility ---
    player_flashes_thrown: dict = {}
    player_smokes_thrown: dict = {}
    player_molotovs_thrown: dict = {}
    player_he_thrown: dict = {}
    player_flash_assists: dict = {}
    player_enemies_flashed: dict = {}
    player_friends_flashed: dict = {}
    player_blinds_caused: dict = {}
    player_blind_duration_sum: dict = {}
    player_friendly_blind_duration_sum: dict = {}
    player_effective_enemy_flashes: dict = {}
    player_he_damage_enemy: dict = {}
    player_he_damage_team: dict = {}
    player_molotov_damage_enemy: dict = {}
    player_molotov_damage_team: dict = {}
    player_smokes_wasted: dict = {}
    player_unused_utility_value: dict = {}
    player_unused_utility_rounds: dict = {}

    # --- Posicionamento ---
    player_trade_kills: dict = {}
    player_traded_deaths: dict = {}
    player_isolated_deaths: dict = {}
    player_trade_delay_sum_ms: dict = {}
    player_trade_delay_count: dict = {}
    player_overexposed_deaths: dict = {}
    player_nearest_teammate_dist_sum: dict = {}
    player_nearest_teammate_dist_count: dict = {}

    def bump(d: dict, key, amount=1):
        d[key] = d.get(key, 0) + amount

    def avg(vals):
        return sum(vals) / len(vals) if vals else 0.0

    FIRST_BULLET_GAP_TICKS = int(0.4 * TICK_RATE)
    SPRAY_MIN_SHOT_INDEX = 3  # 1º tiro = first bullet, 2º não conta em nenhum dos dois, 3º+ = spray
    FLASH_ASSIST_WINDOW_SECONDS = 5.0
    HIT_CORRELATION_WINDOW_TICKS = int(0.25 * TICK_RATE)
    EYE_HEIGHT_OFFSET = 64.0
    MIN_HP_FOR_TTK = 80.0
    SHOOTER_BLIND_THRESHOLD_SECONDS = 1.0
    FLASH_IGNORE_DURATION_SECONDS = 1.0  # cegueira mais curta que isso é desconsiderada por completo
    FLASH_EFFECTIVE_DURATION_SECONDS = 1.5  # cegueira em inimigo a partir daqui conta como "efetiva"

    # --- Posicionamento ---
    TRADE_WINDOW_SECONDS = 3.0
    TRADE_DISTANCE_THRESHOLD = 1500.0  # descarta "trade" do outro lado do mapa
    ISOLATION_DISTANCE_THRESHOLD = 1200.0  # sem aliado vivo mais perto que isso = morte isolada
    OVEREXPOSURE_SIGHT_DISTANCE = 1600.0
    OVEREXPOSURE_FOV_DEG = 50.0  # cone de visão do inimigo pra contar como "provável visão"

    def angle_to_target_deg(shooter_row, target_row) -> Optional[float]:
        if not (has_pitch and has_yaw and has_z):
            return None
        pitch = getattr(shooter_row, "pitch", None)
        yaw = getattr(shooter_row, "yaw", None)
        sx, sy, sz = getattr(shooter_row, "X", None), getattr(shooter_row, "Y", None), getattr(shooter_row, "Z", None)
        tx, ty, tz = getattr(target_row, "X", None), getattr(target_row, "Y", None), getattr(target_row, "Z", None)
        vals = [pitch, yaw, sx, sy, sz, tx, ty, tz]
        if any(v is None or str(v) == "nan" for v in vals):
            return None
        pitch_rad = math.radians(float(pitch))
        yaw_rad = math.radians(float(yaw))
        aim_x = math.cos(pitch_rad) * math.cos(yaw_rad)
        aim_y = math.cos(pitch_rad) * math.sin(yaw_rad)
        aim_z = -math.sin(pitch_rad)
        eye_z = float(sz) + EYE_HEIGHT_OFFSET
        target_eye_z = float(tz) + EYE_HEIGHT_OFFSET
        dx = float(tx) - float(sx)
        dy = float(ty) - float(sy)
        dz = target_eye_z - eye_z
        dist = math.sqrt(dx * dx + dy * dy + dz * dz)
        if dist <= 0:
            return None
        dot = (aim_x * dx + aim_y * dy + aim_z * dz) / dist
        dot = max(-1.0, min(1.0, dot))
        return math.degrees(math.acos(dot))

    def percentile(sorted_vals: list, pct: float) -> float:
        if not sorted_vals:
            return 0.0
        idx = min(len(sorted_vals) - 1, max(0, int(len(sorted_vals) * pct / 100)))
        return sorted_vals[idx]

    # Passo 1: pra cada round, calcula deslocamento (freeze -> +15s) e área
    # alcançada por lado. Isso alimenta os thresholds de tempo/postura no
    # passo 2 — em vez de constantes fixas em "unidades do mapa" (que citamos
    # nunca terem sido validadas contra unidade real: de_dust2 tem
    # sightlines de milhares de unidades e o pessoal se desloca >900 unidades
    # em 15s andando normal, então HIGH_DISPLACEMENT=900 fixo classificava
    # praticamente todo round como "rush"/"aggressive"), os limites de
    # rush/slow e aggressive/passive são os percentis 33/67 da distribuição
    # observada NESTA própria demo. Isso se adapta a qualquer mapa (Nuke é
    # compacto, Dust2 tem corredores longos) sem precisar de uma tabela de
    # constantes por mapa. Com poucos rounds a estimativa é ruidosa — ver
    # `tempoStanceSampleSize` no summary, que o app usa pra avisar o analista.
    round_pre = []
    all_displacements: list = []
    for w in windows:
        freeze_tick, end_tick = w["freezeTick"], w["endTick"]
        side_rows = rows_at(freeze_tick)
        if len(side_rows) == 0:
            side_rows = nearest_rows_at_or_before(freeze_tick)

        side_map = {}
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

        mid_tick = int(freeze_tick + EARLY_CONTACT_SECONDS * TICK_RATE)
        mid_rows = rows_at(mid_tick)
        if len(mid_rows) == 0:
            mid_rows = nearest_rows_at_or_before(min(mid_tick, end_tick))
        start_pos = {int(r.steamid): (r.X, r.Y) for r in side_rows.itertuples() if str(getattr(r, "X", "nan")) != "nan"}
        mid_pos = {int(r.steamid): (r.X, r.Y) for r in mid_rows.itertuples() if str(getattr(r, "X", "nan")) != "nan"}

        displacement_by_side = {"ct": [], "t": []}
        areas_reached_by_side = {"ct": set(), "t": set()}
        for steamid, side in side_map.items():
            if steamid in start_pos and steamid in mid_pos:
                dx = mid_pos[steamid][0] - start_pos[steamid][0]
                dy = mid_pos[steamid][1] - start_pos[steamid][1]
                d = (dx * dx + dy * dy) ** 0.5
                displacement_by_side[side].append(d)
                all_displacements.append(d)
            if has_place_name:
                row = mid_rows[mid_rows["steamid"] == steamid]
                if len(row) > 0:
                    place = row.iloc[0].get("last_place_name")
                    area = area_from_place_name(place)
                    if area != "unknown":
                        areas_reached_by_side[side].add(area)

        round_pre.append(
            {
                "side_rows": side_rows,
                "side_map": side_map,
                "equip_by_side": equip_by_side,
                "displacement_by_side": displacement_by_side,
                "areas_reached_by_side": areas_reached_by_side,
            }
        )

    MIN_SAMPLES_FOR_DYNAMIC_THRESHOLDS = 6
    tempo_stance_sample_size = len(all_displacements)
    if tempo_stance_sample_size >= MIN_SAMPLES_FOR_DYNAMIC_THRESHOLDS:
        sorted_disp = sorted(all_displacements)
        low_displacement_threshold = percentile(sorted_disp, 33)
        high_displacement_threshold = percentile(sorted_disp, 67)
        if low_displacement_threshold >= high_displacement_threshold:
            low_displacement_threshold = high_displacement_threshold = percentile(sorted_disp, 50)
    else:
        # amostra pequena demais pra confiar em percentis desta própria demo
        low_displacement_threshold = LOW_DISPLACEMENT
        high_displacement_threshold = HIGH_DISPLACEMENT

    rounds_out = []
    roster_wins = {"ct": 0, "t": 0}

    for w, pre in zip(windows, round_pre):
        freeze_tick, end_tick, winner = w["freezeTick"], w["endTick"], w["winner"]
        side_rows = pre["side_rows"]
        side_map = pre["side_map"]
        equip_by_side = pre["equip_by_side"]
        displacement_by_side = pre["displacement_by_side"]
        areas_reached_by_side = pre["areas_reached_by_side"]

        for roster_side, ids in roster_by_side_r1.items():
            occupying_side = None
            sample_id = next(iter(ids), None)
            if sample_id is not None and sample_id in side_map:
                occupying_side = side_map[sample_id]
            if occupying_side == winner:
                roster_wins[roster_side] = roster_wins.get(roster_side, 0) + 1

        buy_type = {
            side: classify_buy_type(sum(vals) / len(vals) if vals else 0.0) for side, vals in equip_by_side.items()
        }

        tempo_by_side = {}
        stance_by_side = {}
        for side in ("ct", "t"):
            disp = displacement_by_side[side]
            avg_disp = avg(disp)
            spread = len(areas_reached_by_side[side])
            if avg_disp >= high_displacement_threshold and spread <= 1:
                tempo_by_side[side] = "rush"
            elif spread >= 2:
                tempo_by_side[side] = "split"
            elif avg_disp <= low_displacement_threshold:
                tempo_by_side[side] = "slow"
            else:
                tempo_by_side[side] = "default"

            if not disp:
                stance_by_side[side] = "unknown"
            else:
                high = sum(1 for d in disp if d >= high_displacement_threshold)
                low = sum(1 for d in disp if d <= low_displacement_threshold)
                if high >= len(disp) * 0.6:
                    stance_by_side[side] = "aggressive"
                elif low >= len(disp) * 0.6:
                    stance_by_side[side] = "passive"
                else:
                    stance_by_side[side] = "passive-aggressive"

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
                    attacker_id_i = int(attacker_id)
                    is_hs = bool(getattr(d, "headshot", False))
                    bump(player_kills, attacker_id_i)
                    if is_hs:
                        bump(player_hs_kills, attacker_id_i)
                    death_weapon = getattr(d, "weapon", None)
                    if not is_sniper_weapon(death_weapon) and not is_shotgun_weapon(death_weapon):
                        bump(player_kills_excl, attacker_id_i)
                        if is_hs:
                            bump(player_hs_kills_excl, attacker_id_i)
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

        # --- Aim: precisão, first bullet / spray, counter-strafe, crosshair placement,
        # spotted accuracy ---
        # Correlaciona cada `weapon_fire` (só armas de fogo) com o `player_hurt` não
        # usado mais próximo (mesmo atacador, poucos ticks depois) pra saber se aquele
        # tiro específico acertou — aproximação razoável já que hit-scan registra dano
        # quase no mesmo tick do disparo, e cada `player_hurt` já vem agregado por
        # disparo (mesmo pra shotgun com múltiplos pellets).
        if round_shots is not None and len(round_shots) > 0:
            shots_by_player: dict = {}
            for s in round_shots.itertuples():
                shooter_id = getattr(s, "user_steamid", None)
                if shooter_id is None or str(shooter_id) == "nan":
                    continue
                shooter_id = int(shooter_id)
                if shooter_id not in side_map:
                    continue
                shot_tick = int(s.tick)
                weapon = getattr(s, "weapon", None) if has_fire_weapon else None
                if weapon is None or str(weapon) == "nan":
                    if has_weapon_name:
                        srow = rows_at(shot_tick)
                        srow = srow[srow["steamid"] == shooter_id]
                        if len(srow) > 0:
                            weapon = srow.iloc[0].get("weapon_name")
                if not is_gun_weapon(weapon):
                    continue
                shots_by_player.setdefault(shooter_id, []).append((shot_tick, weapon))

            hits_by_attacker: dict = {}
            if round_hurts is not None:
                for h in round_hurts.itertuples():
                    attacker_id = getattr(h, "attacker_steamid", None)
                    if attacker_id is None or str(attacker_id) == "nan":
                        continue
                    attacker_id = int(attacker_id)
                    weapon = getattr(h, "weapon", None) if has_hurt_weapon else None
                    if has_hurt_weapon and not is_gun_weapon(weapon):
                        continue
                    hits_by_attacker.setdefault(attacker_id, []).append(
                        {
                            "tick": int(h.tick),
                            "hitgroup": getattr(h, "hitgroup", None) if has_hitgroup else None,
                            "weapon": weapon,
                            "used": False,
                        }
                    )

            for shooter_id, shot_entries in shots_by_player.items():
                shot_entries.sort(key=lambda e: e[0])
                shooter_side = side_map.get(shooter_id)
                available_hits = sorted(hits_by_attacker.get(shooter_id, []), key=lambda hh: hh["tick"])
                prev_tick = None
                burst_index = 0
                bump(player_shots_fired, shooter_id, len(shot_entries))
                for shot_tick, shot_weapon in shot_entries:
                    if prev_tick is None or (shot_tick - prev_tick) > FIRST_BULLET_GAP_TICKS:
                        burst_index = 1
                    else:
                        burst_index += 1
                    prev_tick = shot_tick
                    is_first_bullet = burst_index == 1
                    is_spray = burst_index >= SPRAY_MIN_SHOT_INDEX and is_rifle_or_smg_weapon(shot_weapon)

                    matched_hit = None
                    for hit in available_hits:
                        if hit["used"]:
                            continue
                        if 0 <= hit["tick"] - shot_tick <= HIT_CORRELATION_WINDOW_TICKS:
                            matched_hit = hit
                            break
                    hit_landed = matched_hit is not None
                    if matched_hit is not None:
                        matched_hit["used"] = True
                        bump(player_shots_hit, shooter_id)
                        is_head = has_hitgroup and is_head_hitgroup(matched_hit["hitgroup"])
                        if is_head:
                            bump(player_head_hits, shooter_id)
                        if not is_sniper_weapon(shot_weapon) and not is_shotgun_weapon(shot_weapon):
                            bump(player_combat_hits_excl, shooter_id)
                            if is_head:
                                bump(player_head_hits_excl, shooter_id)

                    if is_first_bullet:
                        bump(player_first_bullet_shots, shooter_id)
                        if hit_landed:
                            bump(player_first_bullet_hits, shooter_id)
                    elif is_spray:
                        bump(player_spray_shots, shooter_id)
                        if hit_landed:
                            bump(player_spray_hits, shooter_id)

                    # Counter-strafing: velocidade relativa à velocidade máxima da arma
                    # (tolerância quase zero pra sniper); agachado conta como parada válida.
                    if has_velocity:
                        srow = rows_at(shot_tick)
                        srow = srow[srow["steamid"] == shooter_id]
                        if len(srow) > 0:
                            vx = srow.iloc[0].get("velocity_X")
                            vy = srow.iloc[0].get("velocity_Y")
                            is_ducking = False
                            if has_ducking:
                                duck_val = srow.iloc[0].get("ducking")
                                is_ducking = bool(duck_val) if duck_val is not None and str(duck_val) != "nan" else False
                            if vx is not None and vy is not None and str(vx) != "nan" and str(vy) != "nan":
                                speed = (float(vx) ** 2 + float(vy) ** 2) ** 0.5
                                bump(player_counter_strafe_total, shooter_id)
                                if is_ducking:
                                    bump(player_counter_strafe_shots, shooter_id)
                                elif is_sniper_weapon(shot_weapon):
                                    if speed <= SNIPER_STATIONARY_THRESHOLD:
                                        bump(player_counter_strafe_shots, shooter_id)
                                elif speed <= COUNTER_STRAFE_RELATIVE_THRESHOLD * max_speed_for_weapon(shot_weapon):
                                    bump(player_counter_strafe_shots, shooter_id)

                    # Alvo considerado no engajamento: inimigo vivo com menor ângulo até
                    # o crosshair do atirador no tick do disparo (heurística de "quem
                    # está sendo engajado", reaproveitada pra crosshair placement e
                    # spotted accuracy).
                    target_id = None
                    if shooter_side is not None:
                        tick_rows = rows_at(shot_tick)
                        shooter_rows = tick_rows[tick_rows["steamid"] == shooter_id]
                        if len(shooter_rows) > 0 and has_pitch and has_yaw and has_z:
                            shooter_row = shooter_rows.iloc[0]
                            enemy_side = "t" if shooter_side == "ct" else "ct"
                            best_deg = None
                            for er in tick_rows.itertuples():
                                enemy_id = int(er.steamid)
                                if side_map.get(enemy_id) != enemy_side:
                                    continue
                                health_val = getattr(er, "health", None)
                                if health_val is None or str(health_val) == "nan" or float(health_val) <= 0:
                                    continue
                                deg = angle_to_target_deg(shooter_row, er)
                                if deg is not None and (best_deg is None or deg < best_deg):
                                    best_deg = deg
                                    target_id = enemy_id

                    shooter_blind_at_shot = is_blinded_at(shooter_id, shot_tick, SHOOTER_BLIND_THRESHOLD_SECONDS)

                    # T_spot do alvo (quando ele apareceu, buscando pra trás a partir do
                    # tick do disparo) alimenta Spotted Accuracy e Crosshair Placement —
                    # calculado uma vez e reaproveitado. Suspenso se o atirador estava
                    # cego (excluindo tanto shots "sem visão prévia" quanto reação a flash).
                    spot_tick = None
                    if target_id is not None and not shooter_blind_at_shot:
                        spot_tick = find_spot_start_tick(target_id, shot_tick)

                    # Spotted Accuracy: só entra no denominador se o alvo já estava
                    # "spotted" (T_spot <= tick do disparo) — exclui wallbangs sem visão
                    # prévia e pré-fires (quando T_spot não é encontrado).
                    if spot_tick is not None:
                        bump(player_spotted_shots_total, shooter_id)
                        if hit_landed:
                            bump(player_spotted_shots_hit, shooter_id)

                        # Crosshair Placement medido em T_spot, não no tick do disparo.
                        spot_rows = rows_at(spot_tick)
                        shooter_spot_rows = spot_rows[spot_rows["steamid"] == shooter_id]
                        target_spot_rows = spot_rows[spot_rows["steamid"] == target_id]
                        if len(shooter_spot_rows) > 0 and len(target_spot_rows) > 0:
                            deg = angle_to_target_deg(shooter_spot_rows.iloc[0], next(target_spot_rows.itertuples()))
                            if deg is not None:
                                player_crosshair_deg_sum[shooter_id] = (
                                    player_crosshair_deg_sum.get(shooter_id, 0.0) + deg
                                )
                                bump(player_crosshair_deg_count, shooter_id)

        # --- Time to Damage / Time to Kill: primeiro engajamento (atacante->vítima)
        # de cada par por round, ancorado no T_spot da vítima buscado pra trás a
        # partir do primeiro `player_hurt` do par. ---
        if round_hurts is not None and has_spotted:
            first_hurt_by_pair: dict = {}
            for h in round_hurts.itertuples():
                attacker_id = getattr(h, "attacker_steamid", None)
                user_id = getattr(h, "user_steamid", None)
                if attacker_id is None or str(attacker_id) == "nan":
                    continue
                if user_id is None or str(user_id) == "nan":
                    continue
                weapon = getattr(h, "weapon", None) if has_hurt_weapon else None
                if has_hurt_weapon and not is_gun_weapon(weapon):
                    continue
                pair = (int(attacker_id), int(user_id))
                tick = int(h.tick)
                existing = first_hurt_by_pair.get(pair)
                if existing is None or tick < existing[0]:
                    first_hurt_by_pair[pair] = (tick, weapon)

            first_death_by_pair: dict = {}
            if round_deaths is not None:
                for d in round_deaths.itertuples():
                    attacker_id = getattr(d, "attacker_steamid", None)
                    user_id = getattr(d, "user_steamid", None)
                    if attacker_id is None or str(attacker_id) == "nan":
                        continue
                    if user_id is None or str(user_id) == "nan":
                        continue
                    pair = (int(attacker_id), int(user_id))
                    tick = int(d.tick)
                    if pair not in first_death_by_pair:
                        first_death_by_pair[pair] = tick

            for (attacker_id, victim_id), (hurt_tick, eng_weapon) in first_hurt_by_pair.items():
                if attacker_id not in side_map or victim_id not in side_map:
                    continue
                if side_map[attacker_id] == side_map[victim_id]:
                    continue  # fogo amigo não é um "duelo"
                spot_tick = find_spot_start_tick(victim_id, hurt_tick)
                if spot_tick is None:
                    continue  # pré-fire / sem visão prévia confirmada dentro da janela

                spot_rows = rows_at(spot_tick)
                victim_spot_rows = spot_rows[spot_rows["steamid"] == victim_id]
                attacker_spot_rows = spot_rows[spot_rows["steamid"] == attacker_id]
                is_sniper_engagement = is_sniper_weapon(eng_weapon)

                # TTD: isola sniper, descarta se a vítima estava de costas (sem
                # combate direto) no momento em que apareceu.
                if not is_sniper_engagement and len(victim_spot_rows) > 0 and len(attacker_spot_rows) > 0:
                    back_turned = False
                    if has_yaw:
                        victim_row = victim_spot_rows.iloc[0]
                        victim_yaw = victim_row.get("yaw")
                        vx, vy = victim_row.get("X"), victim_row.get("Y")
                        ax, ay = attacker_spot_rows.iloc[0].get("X"), attacker_spot_rows.iloc[0].get("Y")
                        if all(v is not None and str(v) != "nan" for v in (victim_yaw, vx, vy, ax, ay)):
                            to_attacker_deg = math.degrees(math.atan2(float(ay) - float(vy), float(ax) - float(vx)))
                            diff = abs(((to_attacker_deg - float(victim_yaw)) + 180) % 360 - 180)
                            back_turned = diff > 90
                    if not back_turned:
                        ttd_ms = (hurt_tick - spot_tick) / TICK_RATE * 1000.0
                        if ttd_ms >= 0:
                            player_ttd_sum_ms[attacker_id] = player_ttd_sum_ms.get(attacker_id, 0.0) + ttd_ms
                            bump(player_ttd_count, attacker_id)

                # TTK: descarta se a vítima já estava com HP < 80 no T_spot ("kill roubada").
                death_tick = first_death_by_pair.get((attacker_id, victim_id))
                if death_tick is not None and len(victim_spot_rows) > 0:
                    hp_val = victim_spot_rows.iloc[0].get("health")
                    hp_ok = hp_val is not None and str(hp_val) != "nan" and float(hp_val) >= MIN_HP_FOR_TTK
                    if hp_ok:
                        ttk_ms = (death_tick - spot_tick) / TICK_RATE * 1000.0
                        if ttk_ms >= 0:
                            player_ttk_sum_ms[attacker_id] = player_ttk_sum_ms.get(attacker_id, 0.0) + ttk_ms
                            bump(player_ttk_count, attacker_id)

        # --- Utility: dano de HE/molotov separado entre inimigo/aliado, com "overkill"
        # descontado (dano creditado não passa da vida que a vítima tinha antes do
        # hit — senão um golpe de misericórdia de 40 de dano numa vítima com 10 de
        # vida infla o dano "real" retirado). Vida "antes do hit" é aproximada pelo
        # sample de tick disponível mais próximo ANTES do tick do hurt (nem sempre
        # é o tick imediatamente anterior, já que a amostragem de posição é esparsa
        # fora das janelas densas de T_spot — mas é o melhor proxy sem amostrar
        # 'health' em todo tick da partida só pra isso).
        if round_hurts is not None and has_hurt_weapon:
            for h in round_hurts.itertuples():
                weapon = getattr(h, "weapon", None)
                weapon_low = str(weapon).lower() if weapon is not None else ""
                is_he = weapon_low == "hegrenade"
                is_molotov = weapon_low in ("molotov", "incgrenade")
                if not is_he and not is_molotov:
                    continue
                attacker_id = getattr(h, "attacker_steamid", None)
                user_id = getattr(h, "user_steamid", None)
                if attacker_id is None or str(attacker_id) == "nan":
                    continue
                if user_id is None or str(user_id) == "nan":
                    continue
                attacker_id = int(attacker_id)
                user_id_i = int(user_id)
                attacker_side = side_map.get(attacker_id)
                victim_side = side_map.get(user_id_i)
                if attacker_side is None or victim_side is None:
                    continue
                dmg = float(getattr(h, "dmg_health", 0) or 0)

                hurt_tick_i = int(h.tick)
                pre_hit_rows = nearest_rows_at_or_before(hurt_tick_i - 1)
                pre_hit_rows = pre_hit_rows[pre_hit_rows["steamid"] == user_id_i]
                if len(pre_hit_rows) > 0:
                    hp_before = pre_hit_rows.iloc[0].get("health")
                    if hp_before is not None and str(hp_before) != "nan":
                        dmg = min(dmg, max(0.0, float(hp_before)))

                enemy_dict = player_he_damage_enemy if is_he else player_molotov_damage_enemy
                team_dict = player_he_damage_team if is_he else player_molotov_damage_team
                if victim_side == attacker_side:
                    bump(team_dict, attacker_id, dmg)
                else:
                    bump(enemy_dict, attacker_id, dmg)

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
                    bump(player_clutches_lost, clutch_candidate)
                    clutch_candidate = None
                    clutch_side = None

            if clutch_candidate is not None and clutch_side == winner:
                bump(player_clutches_won, clutch_candidate)

        def count_utility_by_side(df) -> dict:
            counts = {"ct": 0, "t": 0}
            if df is not None and "tick" in df.columns:
                round_df = df[(df["tick"] > freeze_tick) & (df["tick"] <= end_tick)]
                for row in round_df.itertuples():
                    thrower_id = getattr(row, "user_steamid", None)
                    if thrower_id is None or str(thrower_id) == "nan":
                        continue
                    side = side_map.get(int(thrower_id))
                    if side:
                        counts[side] += 1
            return counts

        # Cada tipo de granada detona uma vez (evento pontual), então contamos
        # ocorrências desses eventos em vez de linhas de parse_grenades() — esse
        # df traz uma linha POR TICK da trajetória de cada granada (centenas por
        # unidade), o que infla a contagem em ordens de magnitude.
        flash_counts = count_utility_by_side(flash_df)
        smoke_counts = count_utility_by_side(smoke_start_df)
        molotov_counts = count_utility_by_side(fire_start_df)
        he_counts = count_utility_by_side(he_df)
        utility_by_side = {
            "ct": {
                "flashes": flash_counts["ct"],
                "smokes": smoke_counts["ct"],
                "molotovs": molotov_counts["ct"],
                "he": he_counts["ct"],
            },
            "t": {
                "flashes": flash_counts["t"],
                "smokes": smoke_counts["t"],
                "molotovs": molotov_counts["t"],
                "he": he_counts["t"],
            },
        }

        def count_utility_by_player(df) -> dict:
            counts: dict = {}
            if df is not None and "tick" in df.columns:
                round_df = df[(df["tick"] > freeze_tick) & (df["tick"] <= end_tick)]
                for row in round_df.itertuples():
                    thrower_id = getattr(row, "user_steamid", None)
                    if thrower_id is None or str(thrower_id) == "nan":
                        continue
                    thrower_id = int(thrower_id)
                    if thrower_id not in side_map:
                        continue
                    counts[thrower_id] = counts.get(thrower_id, 0) + 1
            return counts

        for thrower_id, n in count_utility_by_player(flash_df).items():
            bump(player_flashes_thrown, thrower_id, n)
        for thrower_id, n in count_utility_by_player(smoke_start_df).items():
            bump(player_smokes_thrown, thrower_id, n)
        for thrower_id, n in count_utility_by_player(fire_start_df).items():
            bump(player_molotovs_thrown, thrower_id, n)
        for thrower_id, n in count_utility_by_player(he_df).items():
            bump(player_he_thrown, thrower_id, n)

        # Smoke "no próprio pé" — landing muito perto de onde o jogador estava na
        # detonação. Não avalia se a smoke cobriu um ângulo estratégico relevante
        # (isso precisaria de uma base de lineups por mapa que não temos) — só
        # descarta o caso mais óbvio de desperdício.
        SMOKE_OWN_FEET_RADIUS = 150.0
        if smoke_start_df is not None and "tick" in smoke_start_df.columns:
            round_smokes = smoke_start_df[(smoke_start_df["tick"] > freeze_tick) & (smoke_start_df["tick"] <= end_tick)]
            for sm in round_smokes.itertuples():
                thrower_id = getattr(sm, "user_steamid", None)
                if thrower_id is None or str(thrower_id) == "nan":
                    continue
                thrower_id = int(thrower_id)
                if thrower_id not in side_map:
                    continue
                sx, sy = event_xy(sm)
                if sx is None or str(sx) == "nan":
                    continue
                trow = rows_at(int(sm.tick))
                trow = trow[trow["steamid"] == thrower_id]
                if len(trow) == 0:
                    continue
                px, py = trow.iloc[0].get("X"), trow.iloc[0].get("Y")
                if px is None or str(px) == "nan":
                    continue
                dist = ((float(sx) - float(px)) ** 2 + (float(sy) - float(py)) ** 2) ** 0.5
                if dist <= SMOKE_OWN_FEET_RADIUS:
                    bump(player_smokes_wasted, thrower_id)

        # Utility Waste: granada comprada e não jogada quando o jogador morre na
        # rodada. Usa item_purchase (preço real de cada item) contra o que foi de
        # fato jogado (já contado acima) — molotov/incendiária compartilham a
        # mesma contagem "jogada" (inferno_startburn não diferencia o lado que
        # iniciou o fogo), então usa o preço médio do que foi comprado daquele
        # grupo na rodada como aproximação.
        TYPE_MERGE = {
            "flashbang": "flashbang", "smokegrenade": "smokegrenade", "hegrenade": "hegrenade",
            "molotov": "fire", "incgrenade": "fire", "decoy": "decoy",
        }
        purchase_count_by_player_type: dict = {}
        purchase_value_by_player_type: dict = {}
        if purchase_df is not None and "tick" in purchase_df.columns:
            round_purchases = purchase_df[(purchase_df["tick"] > freeze_tick) & (purchase_df["tick"] <= end_tick)]
            item_col = "weapon" if has_purchase_weapon else ("item" if has_purchase_item else None)
            if item_col is not None:
                for row in round_purchases.itertuples():
                    buyer_id = getattr(row, "user_steamid", None)
                    item_name = getattr(row, item_col, None)
                    if buyer_id is None or str(buyer_id) == "nan" or item_name is None or str(item_name) == "nan":
                        continue
                    item_low = str(item_name).lower()
                    merged = TYPE_MERGE.get(item_low)
                    if merged is None:
                        continue
                    buyer_id = int(buyer_id)
                    if buyer_id not in side_map:
                        continue
                    cper = purchase_count_by_player_type.setdefault(buyer_id, {})
                    vper = purchase_value_by_player_type.setdefault(buyer_id, {})
                    cper[merged] = cper.get(merged, 0) + 1
                    vper[merged] = vper.get(merged, 0.0) + GRENADE_PRICES[item_low]

        if purchase_count_by_player_type:
            thrown_by_player_type: dict = {}
            for type_name, df in (
                ("flashbang", flash_df),
                ("smokegrenade", smoke_start_df),
                ("hegrenade", he_df),
                ("fire", fire_start_df),
                ("decoy", decoy_start_df),
            ):
                for thrower_id, n in count_utility_by_player(df).items():
                    per_type = thrown_by_player_type.setdefault(thrower_id, {})
                    per_type[type_name] = per_type.get(type_name, 0) + n

            died_this_round = set()
            if round_deaths is not None:
                for d in round_deaths.itertuples():
                    uid = getattr(d, "user_steamid", None)
                    if uid is not None and str(uid) != "nan":
                        died_this_round.add(int(uid))

            for buyer_id, purchased in purchase_count_by_player_type.items():
                if buyer_id not in died_this_round:
                    continue
                thrown = thrown_by_player_type.get(buyer_id, {})
                values = purchase_value_by_player_type.get(buyer_id, {})
                round_wasted = 0.0
                for gtype, bought_n in purchased.items():
                    leftover = bought_n - thrown.get(gtype, 0)
                    if leftover > 0 and bought_n > 0:
                        avg_price = values.get(gtype, 0.0) / bought_n
                        round_wasted += leftover * avg_price
                if round_wasted > 0:
                    bump(player_unused_utility_value, buyer_id, round_wasted)
                    bump(player_unused_utility_rounds, buyer_id)

        # Flash assists / cegadas em aliado vs inimigo — só dá pra calcular se o
        # evento player_blind desta demo expôs quem jogou a flash (attacker_steamid);
        # quando não expõe, essas métricas ficam zeradas (ver has_blind_attacker).
        # Cegueira <1s (tipicamente virada de rosto rápida) é ignorada por completo;
        # >=1.5s em inimigo conta como "efetiva" (Flashbang Efficiency).
        if blind_df is not None and has_blind_attacker and "tick" in blind_df.columns:
            round_blinds_all = blind_df[(blind_df["tick"] > freeze_tick) & (blind_df["tick"] <= end_tick)]
            for b in round_blinds_all.itertuples():
                victim_id = getattr(b, "user_steamid", None)
                thrower_id = getattr(b, "attacker_steamid", None)
                duration = getattr(b, "blind_duration", None)
                if victim_id is None or thrower_id is None:
                    continue
                if str(victim_id) == "nan" or str(thrower_id) == "nan":
                    continue
                victim_id = int(victim_id)
                thrower_id = int(thrower_id)
                if thrower_id not in side_map:
                    continue
                has_duration = duration is not None and str(duration) != "nan"
                duration_val = float(duration) if has_duration else None
                if has_duration and duration_val < FLASH_IGNORE_DURATION_SECONDS:
                    continue
                if victim_id == thrower_id:
                    continue
                victim_side = side_map.get(victim_id)
                thrower_side = side_map.get(thrower_id)
                if victim_side is None or thrower_side is None:
                    continue
                if victim_side != thrower_side:
                    bump(player_enemies_flashed, thrower_id)
                    if has_duration:
                        bump(player_blind_duration_sum, thrower_id, duration_val)
                        bump(player_blinds_caused, thrower_id)
                        if duration_val >= FLASH_EFFECTIVE_DURATION_SECONDS:
                            bump(player_effective_enemy_flashes, thrower_id)
                    blind_tick = int(b.tick)
                    window_seconds = min(duration_val, FLASH_ASSIST_WINDOW_SECONDS) if has_duration else FLASH_ASSIST_WINDOW_SECONDS
                    window_ticks = int(window_seconds * TICK_RATE)
                    if round_deaths is not None and "user_steamid" in round_deaths.columns:
                        death_match = round_deaths[
                            (round_deaths["user_steamid"] == victim_id)
                            & (round_deaths["tick"] >= blind_tick)
                            & (round_deaths["tick"] <= blind_tick + window_ticks)
                        ]
                        if len(death_match) > 0:
                            killer_id = death_match.iloc[0].get("attacker_steamid")
                            if killer_id is not None and str(killer_id) != "nan":
                                if side_map.get(int(killer_id)) == thrower_side:
                                    bump(player_flash_assists, thrower_id)
                else:
                    # Team flash — penalizado com peso severo na nota (ver scoreEngine).
                    bump(player_friends_flashed, thrower_id)
                    if has_duration:
                        bump(player_friendly_blind_duration_sum, thrower_id, duration_val)

        site_hit = "unknown"
        bomb_plant_out = None
        plant_tick = None
        planter_id = None
        if plant_df is not None and "tick" in plant_df.columns:
            round_plants = plant_df[(plant_df["tick"] > freeze_tick) & (plant_df["tick"] <= end_tick)]
            if len(round_plants) > 0:
                plant_tick = int(round_plants.iloc[0]["tick"])
                planter_id = round_plants.iloc[0].get("user_steamid")
                plant_rows = rows_at(plant_tick)
                prow = None
                if planter_id is not None and str(planter_id) != "nan" and len(plant_rows) > 0:
                    match = plant_rows[plant_rows["steamid"] == int(planter_id)]
                    if len(match) > 0:
                        prow = match.iloc[0]
                if prow is not None:
                    if has_place_name:
                        site_hit = area_from_place_name(prow.get("last_place_name"))
                    px = prow.get("X")
                    py = prow.get("Y")
                    if px is not None and str(px) != "nan":
                        bomb_plant_out = {
                            "x": round(float(px), 1),
                            "y": round(float(py), 1),
                            "t": round((plant_tick - freeze_tick) / TICK_RATE, 1),
                        }
                        if planter_id is not None and str(planter_id) != "nan":
                            bomb_plant_out["player"] = player_names.get(int(planter_id), str(int(planter_id)))
        if site_hit == "unknown" and has_place_name and round_deaths is not None and len(round_deaths) > 0:
            first_tick = int(round_deaths.iloc[0]["tick"])
            rows = rows_at(first_tick)
            if len(rows) > 0:
                site_hit = area_from_place_name(rows.iloc[0].get("last_place_name"))
        if bomb_plant_out is not None:
            bomb_plant_out["site"] = site_hit

        bomb_defuse_out = None
        if defuse_df is not None and "tick" in defuse_df.columns and plant_tick is not None:
            round_defuses = defuse_df[(defuse_df["tick"] > plant_tick) & (defuse_df["tick"] <= end_tick)]
            if len(round_defuses) > 0:
                defuse_tick = int(round_defuses.iloc[0]["tick"])
                bomb_defuse_out = {"t": round((defuse_tick - freeze_tick) / TICK_RATE, 1)}
                defuser_id = round_defuses.iloc[0].get("user_steamid")
                if defuser_id is not None and str(defuser_id) != "nan":
                    bomb_defuse_out["player"] = player_names.get(int(defuser_id), str(int(defuser_id)))

        bomb_explode_out = None
        if explode_df is not None and "tick" in explode_df.columns and plant_tick is not None:
            round_explodes = explode_df[(explode_df["tick"] > plant_tick) & (explode_df["tick"] <= end_tick)]
            if len(round_explodes) > 0:
                explode_tick = int(round_explodes.iloc[0]["tick"])
                bomb_explode_out = {"t": round((explode_tick - freeze_tick) / TICK_RATE, 1)}

        # --- Posicionamento: Trade Kill / Isolamento / Overexposure ---
        # Reusa round_deaths (já ordenado por tick): pra cada morte, procura uma
        # morte de vingança do time da vítima contra o atacante dela dentro da
        # janela/raio de trade, checa se havia aliado vivo por perto (senão a
        # morte era "não-tradeável" independente de velocidade do time), e conta
        # quantos inimigos tinham chance geométrica de ver a vítima ao mesmo
        # tempo — sem raycasting real (não há geometria do mapa disponível), é
        # aproximação por distância + cone de visão do inimigo.
        def pos_xyz_at(steamid: int, tick: int):
            rows = rows_at(tick)
            rows = rows[rows["steamid"] == steamid]
            if len(rows) == 0:
                rows = nearest_rows_at_or_before(tick)
                rows = rows[rows["steamid"] == steamid]
            if len(rows) == 0:
                return None
            row = rows.iloc[0]
            x, y = row.get("X"), row.get("Y")
            if x is None or str(x) == "nan":
                return None
            return float(x), float(y)

        if round_deaths is not None and len(round_deaths) > 0:
            deaths_list = list(round_deaths.itertuples())
            for i, d in enumerate(deaths_list):
                victim_id = getattr(d, "user_steamid", None)
                attacker_id = getattr(d, "attacker_steamid", None)
                if victim_id is None or str(victim_id) == "nan":
                    continue
                victim_id = int(victim_id)
                victim_side = side_map.get(victim_id)
                if victim_side is None:
                    continue
                death_tick = int(d.tick)
                victim_pos = pos_xyz_at(victim_id, death_tick)
                if victim_pos is None:
                    continue

                death_rows = rows_at(death_tick)
                if len(death_rows) == 0:
                    death_rows = nearest_rows_at_or_before(death_tick)

                # Isolamento: nenhum aliado vivo por perto no momento da morte.
                nearest_ally_dist = None
                for r in death_rows.itertuples():
                    ally_id = int(r.steamid)
                    if ally_id == victim_id or side_map.get(ally_id) != victim_side:
                        continue
                    hp = getattr(r, "health", None)
                    if hp is None or str(hp) == "nan" or float(hp) <= 0:
                        continue
                    ax, ay = getattr(r, "X", None), getattr(r, "Y", None)
                    if ax is None or str(ax) == "nan":
                        continue
                    dist = ((float(ax) - victim_pos[0]) ** 2 + (float(ay) - victim_pos[1]) ** 2) ** 0.5
                    if nearest_ally_dist is None or dist < nearest_ally_dist:
                        nearest_ally_dist = dist
                if nearest_ally_dist is None or nearest_ally_dist > ISOLATION_DISTANCE_THRESHOLD:
                    bump(player_isolated_deaths, victim_id)

                # Trade: aliado da vítima mata o atacante dentro da janela/raio.
                if attacker_id is not None and str(attacker_id) != "nan":
                    attacker_id_i = int(attacker_id)
                    window_end = death_tick + int(TRADE_WINDOW_SECONDS * TICK_RATE)
                    for d2 in deaths_list[i + 1 :]:
                        d2_tick = int(d2.tick)
                        if d2_tick > window_end:
                            break
                        d2_victim = getattr(d2, "user_steamid", None)
                        d2_attacker = getattr(d2, "attacker_steamid", None)
                        if d2_victim is None or str(d2_victim) == "nan" or int(d2_victim) != attacker_id_i:
                            continue
                        if d2_attacker is None or str(d2_attacker) == "nan":
                            continue
                        d2_attacker_i = int(d2_attacker)
                        if side_map.get(d2_attacker_i) != victim_side:
                            continue
                        avenger_pos = pos_xyz_at(d2_attacker_i, d2_tick)
                        if avenger_pos is None:
                            continue
                        dist = ((avenger_pos[0] - victim_pos[0]) ** 2 + (avenger_pos[1] - victim_pos[1]) ** 2) ** 0.5
                        if dist > TRADE_DISTANCE_THRESHOLD:
                            continue
                        bump(player_trade_kills, d2_attacker_i)
                        bump(player_traded_deaths, victim_id)
                        delay_ms = (d2_tick - death_tick) / TICK_RATE * 1000.0
                        player_trade_delay_sum_ms[d2_attacker_i] = (
                            player_trade_delay_sum_ms.get(d2_attacker_i, 0.0) + delay_ms
                        )
                        bump(player_trade_delay_count, d2_attacker_i)
                        break

                # Overexposure: >=2 inimigos com distância+ângulo plausíveis de ver a
                # vítima ao mesmo tempo. Mitigado por retake com bomba plantada, a
                # vítima estar cega, ou smoke ativa perto dela.
                if has_pitch and has_yaw and has_z:
                    victim_rows = death_rows[death_rows["steamid"] == victim_id]
                    if len(victim_rows) > 0:
                        victim_row = next(victim_rows.itertuples())
                        enemy_side = "t" if victim_side == "ct" else "ct"
                        watchers = 0
                        for r in death_rows.itertuples():
                            enemy_id = int(r.steamid)
                            if side_map.get(enemy_id) != enemy_side:
                                continue
                            hp = getattr(r, "health", None)
                            if hp is None or str(hp) == "nan" or float(hp) <= 0:
                                continue
                            ex, ey = getattr(r, "X", None), getattr(r, "Y", None)
                            if ex is None or str(ex) == "nan":
                                continue
                            dist = ((float(ex) - victim_pos[0]) ** 2 + (float(ey) - victim_pos[1]) ** 2) ** 0.5
                            if dist > OVEREXPOSURE_SIGHT_DISTANCE:
                                continue
                            deg = angle_to_target_deg(r, victim_row)
                            if deg is not None and deg <= OVEREXPOSURE_FOV_DEG:
                                watchers += 1
                        if watchers >= 2:
                            mitigated = plant_tick is not None and death_tick > plant_tick
                            if not mitigated:
                                mitigated = is_blinded_at(victim_id, death_tick, 0.5)
                            if not mitigated and smoke_start_df is not None and "tick" in smoke_start_df.columns:
                                round_smokes_all = smoke_start_df[
                                    (smoke_start_df["tick"] > freeze_tick) & (smoke_start_df["tick"] <= end_tick)
                                ]
                                smoke_window_ticks = int(SMOKE_DEFAULT_DURATION_SECONDS * TICK_RATE)
                                for sm in round_smokes_all.itertuples():
                                    sm_tick = int(sm.tick)
                                    if sm_tick > death_tick or death_tick > sm_tick + smoke_window_ticks:
                                        continue
                                    sx, sy = event_xy(sm)
                                    if sx is None or str(sx) == "nan":
                                        continue
                                    sdist = ((float(sx) - victim_pos[0]) ** 2 + (float(sy) - victim_pos[1]) ** 2) ** 0.5
                                    if sdist <= 500.0:
                                        mitigated = True
                                        break
                            if not mitigated:
                                bump(player_overexposed_deaths, victim_id)

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
                health_val = getattr(r, "health", None)
                if health_val is not None and str(health_val) != "nan":
                    position_entry["health"] = int(float(health_val))
                key_positions.append(position_entry)
                if has_place_name:
                    place = getattr(r, "last_place_name", None)
                    area = area_from_place_name(place) if place and area_from_place_name(place) != "unknown" else place
                    if place:
                        counts = player_area_counts.setdefault(steamid, {})
                        counts[str(place)] = counts.get(str(place), 0) + 1

            # Distância ao aliado vivo mais próximo — reaproveita os mesmos ticks
            # amostrados acima (não abre uma amostragem nova só pra isso).
            for r in rows.itertuples():
                steamid = int(r.steamid)
                side = side_map.get(steamid)
                x = getattr(r, "X", None)
                if side is None or x is None or str(x) == "nan":
                    continue
                hp = getattr(r, "health", None)
                if hp is None or str(hp) == "nan" or float(hp) <= 0:
                    continue
                nearest = None
                for r2 in rows.itertuples():
                    mate_id = int(r2.steamid)
                    if mate_id == steamid or side_map.get(mate_id) != side:
                        continue
                    hp2 = getattr(r2, "health", None)
                    if hp2 is None or str(hp2) == "nan" or float(hp2) <= 0:
                        continue
                    mx, my = getattr(r2, "X", None), getattr(r2, "Y", None)
                    if mx is None or str(mx) == "nan":
                        continue
                    d = ((float(mx) - float(x)) ** 2 + (float(my) - float(getattr(r, "Y"))) ** 2) ** 0.5
                    if nearest is None or d < nearest:
                        nearest = d
                if nearest is not None:
                    player_nearest_teammate_dist_sum[steamid] = (
                        player_nearest_teammate_dist_sum.get(steamid, 0.0) + nearest
                    )
                    bump(player_nearest_teammate_dist_count, steamid)

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

        smokes_out = pair_grenade_lifespan(
            smoke_start_df,
            smoke_end_df,
            freeze_tick,
            end_tick,
            int(SMOKE_DEFAULT_DURATION_SECONDS * TICK_RATE),
            player_names,
            grenade_paths,
            "smokegrenade",
        )
        fires_out = pair_grenade_lifespan(
            fire_start_df,
            fire_end_df,
            freeze_tick,
            end_tick,
            int(FIRE_DEFAULT_DURATION_SECONDS * TICK_RATE),
            player_names,
            grenade_paths,
            "molotov",
        )
        decoys_out = pair_grenade_lifespan(
            decoy_start_df,
            decoy_end_df,
            freeze_tick,
            end_tick,
            int(DECOY_DEFAULT_DURATION_SECONDS * TICK_RATE),
            player_names,
            grenade_paths,
            "decoy",
        )

        def build_point_events(df, category=None):
            out = []
            if df is not None and "tick" in df.columns:
                round_rows = df[(df["tick"] > freeze_tick) & (df["tick"] <= end_tick)]
                for row in round_rows.itertuples():
                    x, y = event_xy(row)
                    if x is None or str(x) == "nan":
                        continue
                    tick = int(row.tick)
                    entry = {
                        "x": round(float(x), 1),
                        "y": round(float(y), 1),
                        "t": round((tick - freeze_tick) / TICK_RATE, 1),
                    }
                    thrower_id = getattr(row, "user_steamid", None)
                    has_thrower = thrower_id is not None and str(thrower_id) != "nan"
                    if has_thrower:
                        entry["player"] = player_names.get(int(thrower_id), str(int(thrower_id)))
                    if grenade_paths and category and has_thrower:
                        path = find_grenade_path(grenade_paths, int(thrower_id), category, tick, freeze_tick)
                        if path:
                            entry["path"] = path
                    out.append(entry)
            return out

        flashes_out = build_point_events(flash_df, "flashbang")
        he_out = build_point_events(he_df, "he")

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
                "he": he_out,
                "blinds": blinds_out,
                "bombPlant": bomb_plant_out,
                "bombDefuse": bomb_defuse_out,
                "bombExplode": bomb_explode_out,
            }
        )

    def pct(numer: float, denom: float) -> float:
        return round(100.0 * numer / denom, 1) if denom else 0.0

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

        shots_fired = player_shots_fired.get(steamid, 0)
        shots_hit = player_shots_hit.get(steamid, 0)
        head_hits = player_head_hits.get(steamid, 0)
        combat_hits_excl = player_combat_hits_excl.get(steamid, 0)
        head_hits_excl = player_head_hits_excl.get(steamid, 0)
        kills_excl = player_kills_excl.get(steamid, 0)
        first_bullet_shots = player_first_bullet_shots.get(steamid, 0)
        spray_shots = player_spray_shots.get(steamid, 0)
        counter_strafe_total = player_counter_strafe_total.get(steamid, 0)
        crosshair_count = player_crosshair_deg_count.get(steamid, 0)
        spotted_shots_total = player_spotted_shots_total.get(steamid, 0)
        ttd_count = player_ttd_count.get(steamid, 0)
        ttk_count = player_ttk_count.get(steamid, 0)
        aim = {
            "shotsFired": shots_fired,
            "shotsHit": shots_hit,
            "accuracy": pct(shots_hit, shots_fired),
            "headHits": head_hits,
            # Head Accuracy e HS Kill% isolam sniper/shotgun (contadores próprios).
            "headAccuracy": pct(head_hits_excl, combat_hits_excl),
            "hsKills": player_hs_kills.get(steamid, 0),
            "hsKillPct": pct(player_hs_kills_excl.get(steamid, 0), kills_excl),
            "firstBulletShots": first_bullet_shots,
            "firstBulletAccuracy": pct(player_first_bullet_hits.get(steamid, 0), first_bullet_shots),
            "sprayShots": spray_shots,
            "sprayAccuracy": pct(player_spray_hits.get(steamid, 0), spray_shots),
            "counterStrafePct": pct(player_counter_strafe_shots.get(steamid, 0), counter_strafe_total),
            "avgCrosshairPlacementDeg": (
                round(player_crosshair_deg_sum.get(steamid, 0.0) / crosshair_count, 2) if crosshair_count else None
            ),
            "spottedAccuracy": pct(player_spotted_shots_hit.get(steamid, 0), spotted_shots_total),
            "avgTimeToDamageMs": (
                round(player_ttd_sum_ms.get(steamid, 0.0) / ttd_count, 0) if ttd_count else None
            ),
            "avgTimeToKillMs": (
                round(player_ttk_sum_ms.get(steamid, 0.0) / ttk_count, 0) if ttk_count else None
            ),
        }

        flashes_thrown = player_flashes_thrown.get(steamid, 0)
        he_thrown = player_he_thrown.get(steamid, 0)
        molotovs_thrown = player_molotovs_thrown.get(steamid, 0)
        blinds_caused = player_blinds_caused.get(steamid, 0)
        friendly_blinds = player_friends_flashed.get(steamid, 0)
        utility = {
            "flashesThrown": flashes_thrown,
            "smokesThrown": player_smokes_thrown.get(steamid, 0),
            "molotovsThrown": molotovs_thrown,
            "heThrown": he_thrown,
            "flashAssists": player_flash_assists.get(steamid, 0),
            "enemiesFlashed": player_enemies_flashed.get(steamid, 0),
            "enemiesFlashedPct": pct(player_enemies_flashed.get(steamid, 0), flashes_thrown),
            "friendsFlashed": friendly_blinds,
            "avgBlindTimeSec": (
                round(player_blind_duration_sum.get(steamid, 0.0) / blinds_caused, 1) if blinds_caused else 0.0
            ),
            "avgHeDamage": round(player_he_damage_enemy.get(steamid, 0.0) / he_thrown, 1) if he_thrown else 0.0,
            "avgHeTeamDamage": round(player_he_damage_team.get(steamid, 0.0) / he_thrown, 1) if he_thrown else 0.0,
            # Flashbang Efficiency: só cegueiras >=1.5s em inimigo contam como "efetivas".
            "effectiveEnemyFlashes": player_effective_enemy_flashes.get(steamid, 0),
            "effectiveFlashPct": pct(player_effective_enemy_flashes.get(steamid, 0), flashes_thrown),
            "avgFriendlyBlindTimeSec": (
                round(player_friendly_blind_duration_sum.get(steamid, 0.0) / friendly_blinds, 1)
                if friendly_blinds
                else 0.0
            ),
            "avgMolotovDamage": (
                round(player_molotov_damage_enemy.get(steamid, 0.0) / molotovs_thrown, 1) if molotovs_thrown else 0.0
            ),
            "avgMolotovTeamDamage": (
                round(player_molotov_damage_team.get(steamid, 0.0) / molotovs_thrown, 1) if molotovs_thrown else 0.0
            ),
            "smokesWasted": player_smokes_wasted.get(steamid, 0),
            "unusedUtilityValue": round(player_unused_utility_value.get(steamid, 0.0), 0),
            "unusedUtilityRounds": player_unused_utility_rounds.get(steamid, 0),
        }

        entry_attempts = player_entry_attempts.get(steamid, 0)
        entry_success = player_entry_success.get(steamid, 0)
        trade_delay_count = player_trade_delay_count.get(steamid, 0)
        nearest_teammate_count = player_nearest_teammate_dist_count.get(steamid, 0)
        positioning = {
            "openingDuelWinPct": pct(entry_success, entry_attempts),
            "openingDuelParticipationPct": pct(entry_attempts, rounds_played),
            "tradeKills": player_trade_kills.get(steamid, 0),
            "tradeKillPct": pct(player_trade_kills.get(steamid, 0), kills),
            "tradedDeathPct": pct(player_traded_deaths.get(steamid, 0), deaths),
            "isolatedDeathPct": pct(player_isolated_deaths.get(steamid, 0), deaths),
            "avgTradeDelayMs": (
                round(player_trade_delay_sum_ms.get(steamid, 0.0) / trade_delay_count, 0)
                if trade_delay_count
                else None
            ),
            "overexposedDeathPct": pct(player_overexposed_deaths.get(steamid, 0), deaths),
            "avgNearestTeammateDist": (
                round(player_nearest_teammate_dist_sum.get(steamid, 0.0) / nearest_teammate_count, 1)
                if nearest_teammate_count
                else None
            ),
        }

        players_out.append(
            {
                "steamId": str(steamid),
                "name": player_names.get(steamid, str(steamid)),
                "side": side,
                "kills": kills,
                "deaths": deaths,
                "assists": assists,
                "adr": adr,
                "entryAttempts": entry_attempts,
                "entrySuccess": entry_success,
                "clutchesWon": player_clutches_won.get(steamid, 0),
                "clutchesLost": player_clutches_lost.get(steamid, 0),
                "favoriteAreas": favorite_areas,
                "aim": aim,
                "utility": utility,
                "positioning": positioning,
            }
        )

    final_score = {"team": roster_wins.get("ct", 0), "opponent": roster_wins.get("t", 0)}

    summary = {
        "demoId": "placeholder",
        "map": map_name,
        "finalScore": final_score,
        "rounds": rounds_out,
        "playerAggregates": players_out,
        "fileName": os.path.basename(args.input),
        "featureModelVersion": FEATURE_MODEL_VERSION,
        "calibration": {
            "tempoStanceSampleSize": tempo_stance_sample_size,
            "tempoStanceThresholdSource": "demo" if tempo_stance_sample_size >= MIN_SAMPLES_FOR_DYNAMIC_THRESHOLDS else "default",
            "lowDisplacementThreshold": round(low_displacement_threshold, 1),
            "highDisplacementThreshold": round(high_displacement_threshold, 1),
        },
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
