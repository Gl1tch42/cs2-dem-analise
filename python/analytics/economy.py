"""Classificação de economia/tempo/stance por rodada.

Primeira fatia extraída do parse_demo.py monolítico (A06 "Parser modular") —
estabelece o padrão pras próximas extrações (aim, utility, positioning,
trades): funções puras, sem estado, recebendo só os dados já resolvidos
pelo parser (equipamento por lado, deslocamento por lado, áreas alcançadas),
nunca o DataFrame bruto do demoparser2 nem o DemoParser em si.
"""
from __future__ import annotations

BUY_ECO_MAX = 2000
BUY_FORCE_MAX = 3000
BUY_SEMI_MAX = 4000


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


def classify_round_tempo_stance(
    displacements: list,
    areas_reached_count: int,
    low_threshold: float,
    high_threshold: float,
) -> tuple:
    """Classifica tempo ("rush"/"split"/"slow"/"default") e stance
    ("aggressive"/"passive"/"passive-aggressive"/"unknown") de UM lado numa
    rodada, a partir dos deslocamentos individuais dos jogadores (freeze até
    +15s, ver EARLY_CONTACT_SECONDS em parse_demo.py) e de quantas áreas
    distintas do mapa esse lado alcançou nesse intervalo.
    """
    avg_disp = sum(displacements) / len(displacements) if displacements else 0.0
    if avg_disp >= high_threshold and areas_reached_count <= 1:
        tempo = "rush"
    elif areas_reached_count >= 2:
        tempo = "split"
    elif avg_disp <= low_threshold:
        tempo = "slow"
    else:
        tempo = "default"

    if not displacements:
        stance = "unknown"
    else:
        high = sum(1 for d in displacements if d >= high_threshold)
        low = sum(1 for d in displacements if d <= low_threshold)
        if high >= len(displacements) * 0.6:
            stance = "aggressive"
        elif low >= len(displacements) * 0.6:
            stance = "passive"
        else:
            stance = "passive-aggressive"

    return tempo, stance


def classify_round_economy(
    equip_by_side: dict,
    displacement_by_side: dict,
    areas_reached_by_side: dict,
    low_threshold: float,
    high_threshold: float,
) -> dict:
    """Classificação completa de uma rodada (buyType/tempo/stance por lado),
    no formato que main() monta pra RoundSideSummary. Orquestra
    classify_buy_type + classify_round_tempo_stance pra cada lado.
    """
    buy_type = {
        side: classify_buy_type(sum(vals) / len(vals) if vals else 0.0)
        for side, vals in equip_by_side.items()
    }

    tempo_by_side: dict = {}
    stance_by_side: dict = {}
    for side in ("ct", "t"):
        tempo, stance = classify_round_tempo_stance(
            displacement_by_side[side],
            len(areas_reached_by_side[side]),
            low_threshold,
            high_threshold,
        )
        tempo_by_side[side] = tempo
        stance_by_side[side] = stance

    return {"buyType": buy_type, "tempo": tempo_by_side, "stance": stance_by_side}
