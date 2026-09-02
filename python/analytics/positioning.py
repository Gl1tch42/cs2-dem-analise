"""Detecção de isolamento e trade kill — terceira fatia extraída de
parse_demo.py (A06 "Parser modular").

Diferente de economy.py/weapons.py (tabelas/classificação puras), este
módulo lida com o estado por-morte de uma rodada: por isso as funções
recebem os dados já resolvidos pelo parser (posição da vítima, linhas de
tick no momento da morte, lista de mortes da rodada) e um callable
`pos_xyz_at(steamid, tick)` pra resolver posição de outro jogador em outro
tick, em vez de fechar sobre estado do parser (rows_at/ticks_by_tick) — os
mesmos dados que main() já monta, só passados explicitamente.

Overexposure fica de fora por enquanto — depende também de geometria/LOS
(python/geometry/), ângulo de mira e mitigação por smoke/cegueira, um
conjunto de dependências maior que vale extrair à parte.
"""
from __future__ import annotations


def compute_isolation(
    victim_id: int,
    victim_side: str,
    victim_pos: tuple,
    death_rows,
    side_map: dict,
    isolation_distance_threshold: float,
) -> bool:
    """True se nenhum aliado vivo da vítima estava a <= isolation_distance_threshold
    dela no momento da morte (`death_rows`: linhas de tick de todos os
    jogadores nesse tick, iteráveis via itertuples-like com steamid/health/X/Y).
    """
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
    return nearest_ally_dist is None or nearest_ally_dist > isolation_distance_threshold


def find_trade_kill(
    attacker_id,
    victim_side: str,
    death_tick: int,
    deaths_list: list,
    death_index: int,
    victim_pos: tuple,
    side_map: dict,
    pos_xyz_at,
    tick_rate: float,
    trade_window_seconds: float,
    trade_distance_threshold: float,
) -> dict | None:
    """Procura, entre as mortes seguintes da rodada dentro da janela de trade,
    um aliado do lado da vítima matando o atacante original (`attacker_id`) a
    uma distância plausível dela. `deaths_list` é a lista completa de mortes
    da rodada (itertuples-like, ordenada por tick); `death_index` é a posição
    da morte atual nela. `pos_xyz_at(steamid, tick)` resolve a posição
    (x, y) de um jogador num tick, ou None se não disponível.

    Retorna {"avengerId": int, "delayMs": float} ou None se não houve trade.
    """
    if attacker_id is None or str(attacker_id) == "nan":
        return None
    attacker_id_i = int(attacker_id)
    window_end = death_tick + int(trade_window_seconds * tick_rate)
    for d2 in deaths_list[death_index + 1 :]:
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
        if dist > trade_distance_threshold:
            continue
        delay_ms = (d2_tick - death_tick) / tick_rate * 1000.0
        return {"avengerId": d2_attacker_i, "delayMs": delay_ms}
    return None
