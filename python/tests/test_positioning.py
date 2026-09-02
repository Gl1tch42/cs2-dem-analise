from types import SimpleNamespace

import pandas as pd

from analytics.positioning import compute_isolation, find_trade_kill


def _death_rows(rows: list) -> pd.DataFrame:
    return pd.DataFrame(rows)


# --- compute_isolation ---

def test_isolation_true_when_no_ally_alive_nearby():
    rows = _death_rows(
        [
            {"steamid": 1, "health": 0, "X": 0.0, "Y": 0.0},  # vítima (morta, ignorada por ser o próprio id)
            {"steamid": 2, "health": 100, "X": 5000.0, "Y": 5000.0},  # aliado, mas longe
            {"steamid": 3, "health": 100, "X": 10.0, "Y": 10.0},  # inimigo perto — não conta
        ]
    )
    side_map = {1: "ct", 2: "ct", 3: "t"}
    assert compute_isolation(1, "ct", (0.0, 0.0), rows, side_map, isolation_distance_threshold=1200.0) is True


def test_isolation_false_when_ally_alive_nearby():
    rows = _death_rows(
        [
            {"steamid": 1, "health": 0, "X": 0.0, "Y": 0.0},
            {"steamid": 2, "health": 100, "X": 100.0, "Y": 0.0},  # aliado perto
        ]
    )
    side_map = {1: "ct", 2: "ct"}
    assert compute_isolation(1, "ct", (0.0, 0.0), rows, side_map, isolation_distance_threshold=1200.0) is False


def test_isolation_ignores_dead_allies():
    rows = _death_rows(
        [
            {"steamid": 1, "health": 0, "X": 0.0, "Y": 0.0},
            {"steamid": 2, "health": 0, "X": 10.0, "Y": 0.0},  # aliado perto, mas morto -> não conta
        ]
    )
    side_map = {1: "ct", 2: "ct"}
    assert compute_isolation(1, "ct", (0.0, 0.0), rows, side_map, isolation_distance_threshold=1200.0) is True


def test_isolation_ignores_enemies_even_when_close():
    rows = _death_rows(
        [
            {"steamid": 1, "health": 0, "X": 0.0, "Y": 0.0},
            {"steamid": 2, "health": 100, "X": 5.0, "Y": 0.0},  # inimigo bem perto
        ]
    )
    side_map = {1: "ct", 2: "t"}
    assert compute_isolation(1, "ct", (0.0, 0.0), rows, side_map, isolation_distance_threshold=1200.0) is True


# --- find_trade_kill ---

def _death(tick, user_steamid, attacker_steamid):
    return SimpleNamespace(tick=tick, user_steamid=user_steamid, attacker_steamid=attacker_steamid)


def test_trade_kill_found_within_window_and_distance():
    # vítima (1, ct) morta por atacante 3 (t) no tick 1000; aliado 2 (ct) vinga
    # matando o atacante 3 no tick 1100, perto da vítima.
    deaths_list = [
        _death(1000, user_steamid=1, attacker_steamid=3),
        _death(1100, user_steamid=3, attacker_steamid=2),
    ]
    side_map = {1: "ct", 2: "ct", 3: "t"}
    pos_xyz_at = lambda steamid, tick: (50.0, 0.0)  # avenger perto da vítima (0,0)

    result = find_trade_kill(
        attacker_id=3, victim_side="ct", death_tick=1000, deaths_list=deaths_list, death_index=0,
        victim_pos=(0.0, 0.0), side_map=side_map, pos_xyz_at=pos_xyz_at,
        tick_rate=64.0, trade_window_seconds=3.0, trade_distance_threshold=1500.0,
    )

    assert result == {"avengerId": 2, "delayMs": (1100 - 1000) / 64.0 * 1000.0}


def test_trade_kill_none_when_avenger_is_not_on_victims_side():
    deaths_list = [
        _death(1000, user_steamid=1, attacker_steamid=3),
        _death(1100, user_steamid=3, attacker_steamid=4),  # 4 não é aliado da vítima
    ]
    side_map = {1: "ct", 3: "t", 4: "t"}
    result = find_trade_kill(
        attacker_id=3, victim_side="ct", death_tick=1000, deaths_list=deaths_list, death_index=0,
        victim_pos=(0.0, 0.0), side_map=side_map, pos_xyz_at=lambda s, t: (0.0, 0.0),
        tick_rate=64.0, trade_window_seconds=3.0, trade_distance_threshold=1500.0,
    )
    assert result is None


def test_trade_kill_none_when_outside_time_window():
    deaths_list = [
        _death(1000, user_steamid=1, attacker_steamid=3),
        _death(1000 + 4 * 64, user_steamid=3, attacker_steamid=2),  # 4s depois, janela é 3s
    ]
    side_map = {1: "ct", 2: "ct", 3: "t"}
    result = find_trade_kill(
        attacker_id=3, victim_side="ct", death_tick=1000, deaths_list=deaths_list, death_index=0,
        victim_pos=(0.0, 0.0), side_map=side_map, pos_xyz_at=lambda s, t: (0.0, 0.0),
        tick_rate=64.0, trade_window_seconds=3.0, trade_distance_threshold=1500.0,
    )
    assert result is None


def test_trade_kill_none_when_avenger_too_far():
    deaths_list = [
        _death(1000, user_steamid=1, attacker_steamid=3),
        _death(1100, user_steamid=3, attacker_steamid=2),
    ]
    side_map = {1: "ct", 2: "ct", 3: "t"}
    result = find_trade_kill(
        attacker_id=3, victim_side="ct", death_tick=1000, deaths_list=deaths_list, death_index=0,
        victim_pos=(0.0, 0.0), side_map=side_map, pos_xyz_at=lambda s, t: (5000.0, 5000.0),
        tick_rate=64.0, trade_window_seconds=3.0, trade_distance_threshold=1500.0,
    )
    assert result is None


def test_trade_kill_none_when_no_attacker_on_original_death():
    result = find_trade_kill(
        attacker_id=None, victim_side="ct", death_tick=1000, deaths_list=[], death_index=0,
        victim_pos=(0.0, 0.0), side_map={}, pos_xyz_at=lambda s, t: (0.0, 0.0),
        tick_rate=64.0, trade_window_seconds=3.0, trade_distance_threshold=1500.0,
    )
    assert result is None


def test_trade_kill_picks_first_qualifying_avenger_within_window():
    deaths_list = [
        _death(1000, user_steamid=1, attacker_steamid=3),
        _death(1050, user_steamid=3, attacker_steamid=2),  # primeiro a qualificar
        _death(1080, user_steamid=3, attacker_steamid=5),  # não deveria ser considerado
    ]
    side_map = {1: "ct", 2: "ct", 3: "t", 5: "ct"}
    result = find_trade_kill(
        attacker_id=3, victim_side="ct", death_tick=1000, deaths_list=deaths_list, death_index=0,
        victim_pos=(0.0, 0.0), side_map=side_map, pos_xyz_at=lambda s, t: (0.0, 0.0),
        tick_rate=64.0, trade_window_seconds=3.0, trade_distance_threshold=1500.0,
    )
    assert result["avengerId"] == 2
