from types import SimpleNamespace

import pandas as pd
import pytest

import parse_demo
from parse_demo import (
    ROUND_TIME_LIMIT_SECONDS,
    TICK_RATE,
    SPOTTED_WINDOW_SECONDS,
    area_from_place_name,
    build_dense_spot_window_ticks,
    build_grenade_flight_paths,
    build_round_windows,
    classify_buy_type,
    coerce_side,
    compute_death_round_state,
    event_xy,
    find_grenade_path,
    normalize_grenade_category,
    pair_grenade_lifespan,
    safe_parse_event,
    safe_parse_ticks,
)


# --- coerce_side ---

@pytest.mark.parametrize(
    "value,expected",
    [
        (2, "t"),
        (3, "ct"),
        ("2", "t"),
        ("3", "ct"),
        (2.0, "t"),
        ("CT", "ct"),
        ("ct", "ct"),
        ("Counter-Terrorist", "ct"),
        ("counterterrorist", "ct"),
        ("T", "t"),
        ("Terrorist", "t"),
    ],
)
def test_coerce_side_valid(value, expected):
    assert coerce_side(value) == expected


@pytest.mark.parametrize("value", [None, "", "  ", "nan", "NaN", "unknown_side", 0, 1, 99])
def test_coerce_side_invalid(value):
    assert coerce_side(value) is None


# --- classify_buy_type ---

@pytest.mark.parametrize(
    "value,expected",
    [
        (0, "unknown"),
        (-500, "unknown"),
        (1, "eco"),
        (1999, "eco"),
        (2000, "force"),
        (2999, "force"),
        (3000, "semi"),
        (3999, "semi"),
        (4000, "full"),
        (10000, "full"),
    ],
)
def test_classify_buy_type(value, expected):
    assert classify_buy_type(value) == expected


# --- area_from_place_name ---

@pytest.mark.parametrize(
    "place,expected",
    [
        ("BombsiteA", "A"),
        ("bombsitea", "A"),
        ("A", "A"),
        ("Site_A", "A"),
        ("BombsiteB", "B"),
        ("b", "B"),
        ("Site_B", "B"),
        ("TSpawnMid", "mid"),
        ("MidDoors", "mid"),
        ("Catwalk", "unknown"),
        (None, "unknown"),
        ("", "unknown"),
        (123, "unknown"),
    ],
)
def test_area_from_place_name(place, expected):
    assert area_from_place_name(place) == expected


# --- normalize_grenade_category ---

@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Decoy", "decoy"),
        ("Flashbang", "flashbang"),
        ("SmokeGrenade", "smokegrenade"),
        ("Molotov", "molotov"),
        ("IncendiaryGrenade", "molotov"),
        ("inferno", "molotov"),
        ("HEGrenade", "he"),
        (None, None),
        ("nan", None),
        ("", None),
    ],
)
def test_normalize_grenade_category(raw, expected):
    assert normalize_grenade_category(raw) == expected


# --- event_xy ---

def test_event_xy_lowercase_attrs():
    assert event_xy(SimpleNamespace(x=1, y=2)) == (1, 2)


def test_event_xy_uppercase_fallback():
    assert event_xy(SimpleNamespace(X=3, Y=4)) == (3, 4)


def test_event_xy_prefers_lowercase_when_both_present():
    assert event_xy(SimpleNamespace(x=1, X=99, y=2, Y=99)) == (1, 2)


def test_event_xy_missing():
    assert event_xy(SimpleNamespace()) == (None, None)


# --- build_dense_spot_window_ticks ---

def test_build_dense_spot_window_ticks_none_df():
    assert build_dense_spot_window_ticks(None, 0, 1000) == set()


def test_build_dense_spot_window_ticks_no_tick_column():
    df = pd.DataFrame({"other": [1, 2]})
    assert build_dense_spot_window_ticks(df, 0, 1000) == set()


def test_build_dense_spot_window_ticks_empty_ticks():
    df = pd.DataFrame({"tick": []})
    assert build_dense_spot_window_ticks(df, 0, 1000) == set()


def test_build_dense_spot_window_ticks_basic_window():
    df = pd.DataFrame({"tick": [1000]})
    result = build_dense_spot_window_ticks(df, demo_start_tick=0, demo_end_tick=2000)
    window_ticks = int(SPOTTED_WINDOW_SECONDS * TICK_RATE)
    assert 1000 in result
    assert min(result) == 1000 - window_ticks
    assert max(result) == 1000
    # default step is 2 ticks
    assert 998 in result
    assert 999 not in result


def test_build_dense_spot_window_ticks_clamped_to_demo_start():
    df = pd.DataFrame({"tick": [50]})
    result = build_dense_spot_window_ticks(df, demo_start_tick=40, demo_end_tick=1000)
    assert min(result) == 40


def test_build_dense_spot_window_ticks_step_increases_when_too_dense(monkeypatch):
    monkeypatch.setattr(parse_demo, "SPOTTED_SAMPLE_MAX_EXTRA_TICKS", 5)
    df = pd.DataFrame({"tick": [1000, 2000, 3000]})
    result = build_dense_spot_window_ticks(df, demo_start_tick=0, demo_end_tick=5000)
    # with the cap forced low, the step must have grown past the default of 2
    assert 999 not in result
    assert 1000 in result and 2000 in result and 3000 in result


# --- build_grenade_flight_paths ---

def test_build_grenade_flight_paths_groups_and_splits_by_gap():
    df = pd.DataFrame(
        {
            "tick": [100, 101, 102, 200, 201],
            "steamid": [1, 1, 1, 1, 1],
            "grenade_type": ["Smoke Grenade"] * 5,
            "X": [0, 10, 20, 50, 60],
            "Y": [0, 10, 20, 50, 60],
        }
    )
    paths = build_grenade_flight_paths(df)
    assert (1, "smokegrenade") in paths
    flights = paths[(1, "smokegrenade")]
    assert len(flights) == 2
    assert flights[0] == [(100, 0.0, 0.0), (101, 10.0, 10.0), (102, 20.0, 20.0)]
    assert flights[1] == [(200, 50.0, 50.0), (201, 60.0, 60.0)]


def test_build_grenade_flight_paths_drops_single_point_flights():
    df = pd.DataFrame(
        {"tick": [100], "steamid": [1], "grenade_type": ["HE Grenade"], "X": [0], "Y": [0]}
    )
    assert build_grenade_flight_paths(df) == {}


def test_build_grenade_flight_paths_missing_required_columns():
    df = pd.DataFrame({"tick": [1, 2]})
    assert build_grenade_flight_paths(df) == {}


@pytest.mark.parametrize("df", [None, pd.DataFrame()])
def test_build_grenade_flight_paths_empty_input(df):
    assert build_grenade_flight_paths(df) == {}


def test_build_grenade_flight_paths_uses_steamid_alias_column():
    df = pd.DataFrame(
        {
            "tick": [10, 11],
            "steamid": [7, 7],
            "grenade_type": ["decoy", "decoy"],
            "x": [1, 2],
            "y": [1, 2],
        }
    )
    paths = build_grenade_flight_paths(df)
    assert (7, "decoy") in paths


# --- find_grenade_path ---

def test_find_grenade_path_picks_closest_flight_end():
    paths = {
        (1, "smokegrenade"): [
            [(100, 0.0, 0.0), (110, 5.0, 5.0)],
            [(500, 50.0, 50.0), (510, 55.0, 55.0)],
        ]
    }
    result = find_grenade_path(paths, 1, "smokegrenade", detonate_tick=511, freeze_tick=490)
    assert result == [
        {"x": 50.0, "y": 50.0, "t": round((500 - 490) / TICK_RATE, 1)},
        {"x": 55.0, "y": 55.0, "t": round((510 - 490) / TICK_RATE, 1)},
    ]


def test_find_grenade_path_returns_none_outside_tolerance():
    paths = {(1, "he"): [[(100, 0, 0), (110, 1, 1)]]}
    assert find_grenade_path(paths, 1, "he", detonate_tick=10000, freeze_tick=0) is None


@pytest.mark.parametrize(
    "paths,thrower_id,category",
    [
        ({}, 1, "he"),
        (None, 1, "he"),
        ({(1, "he"): [[(1, 0, 0), (2, 1, 1)]]}, None, "he"),
        ({(1, "he"): [[(1, 0, 0), (2, 1, 1)]]}, 1, None),
        ({(1, "he"): [[(1, 0, 0), (2, 1, 1)]]}, 2, "he"),
    ],
)
def test_find_grenade_path_missing_or_unmatched(paths, thrower_id, category):
    assert find_grenade_path(paths, thrower_id, category, 100, 0) is None


# --- pair_grenade_lifespan ---

def test_pair_grenade_lifespan_defaults_when_no_end_event():
    start_df = pd.DataFrame(
        {"tick": [100], "entityid": [5], "X": [10.0], "Y": [20.0], "user_steamid": [111]}
    )
    default_ticks = int(18 * TICK_RATE)
    result = pair_grenade_lifespan(start_df, None, freeze_tick=90, end_tick=100000, default_duration_ticks=default_ticks)
    assert len(result) == 1
    entry = result[0]
    assert entry["x"] == 10.0
    assert entry["y"] == 20.0
    assert entry["startT"] == round((100 - 90) / TICK_RATE, 1)
    assert entry["endT"] == round((100 + default_ticks - 90) / TICK_RATE, 1)
    assert "player" not in entry


def test_pair_grenade_lifespan_uses_matching_end_event():
    start_df = pd.DataFrame(
        {"tick": [100], "entityid": [5], "X": [1.0], "Y": [2.0], "user_steamid": [111]}
    )
    end_df = pd.DataFrame({"tick": [150], "entityid": [5]})
    result = pair_grenade_lifespan(start_df, end_df, freeze_tick=90, end_tick=100000, default_duration_ticks=64 * 18)
    assert result[0]["endT"] == round((150 - 90) / TICK_RATE, 1)


def test_pair_grenade_lifespan_end_time_capped_by_round_end():
    start_df = pd.DataFrame(
        {"tick": [990], "entityid": [5], "X": [1.0], "Y": [2.0], "user_steamid": [111]}
    )
    result = pair_grenade_lifespan(start_df, None, freeze_tick=90, end_tick=1000, default_duration_ticks=64 * 18)
    assert result[0]["endT"] == round((1000 - 90) / TICK_RATE, 1)


def test_pair_grenade_lifespan_attaches_player_name():
    start_df = pd.DataFrame(
        {"tick": [100], "entityid": [5], "X": [1.0], "Y": [2.0], "user_steamid": [111]}
    )
    result = pair_grenade_lifespan(
        start_df, None, freeze_tick=90, end_tick=100000, default_duration_ticks=64 * 18,
        player_names={111: "Player1"},
    )
    assert result[0]["player"] == "Player1"


def test_pair_grenade_lifespan_filters_events_outside_round_window():
    start_df = pd.DataFrame(
        {
            "tick": [50, 2000],
            "entityid": [5, 6],
            "X": [1.0, 2.0],
            "Y": [2.0, 3.0],
            "user_steamid": [111, 112],
        }
    )
    result = pair_grenade_lifespan(start_df, None, freeze_tick=90, end_tick=1000, default_duration_ticks=64 * 18)
    assert result == []


def test_pair_grenade_lifespan_attaches_grenade_path_when_matched():
    start_df = pd.DataFrame(
        {"tick": [100], "entityid": [5], "X": [1.0], "Y": [2.0], "user_steamid": [111]}
    )
    grenade_paths = {(111, "smokegrenade"): [[(90, 0.0, 0.0), (100, 1.0, 2.0)]]}
    result = pair_grenade_lifespan(
        start_df, None, freeze_tick=90, end_tick=100000, default_duration_ticks=64 * 18,
        grenade_paths=grenade_paths, category="smokegrenade",
    )
    assert "path" in result[0]
    assert result[0]["path"][-1] == {"x": 1.0, "y": 2.0, "t": round((100 - 90) / TICK_RATE, 1)}


def test_pair_grenade_lifespan_no_start_df():
    assert pair_grenade_lifespan(None, None, 0, 100, 64) == []


# --- compute_death_round_state (A05) ---

def test_compute_death_round_state_ct_advantage():
    state = compute_death_round_state(alive_ct=4, alive_t=3, plant_tick=None, death_tick=1000, death_t=20.0)
    assert state["aliveCT"] == 4
    assert state["aliveT"] == 3
    assert state["manAdvantage"] == 1


def test_compute_death_round_state_t_advantage_is_negative():
    state = compute_death_round_state(alive_ct=2, alive_t=4, plant_tick=None, death_tick=1000, death_t=20.0)
    assert state["manAdvantage"] == -2


def test_compute_death_round_state_even_is_zero():
    state = compute_death_round_state(alive_ct=3, alive_t=3, plant_tick=None, death_tick=1000, death_t=20.0)
    assert state["manAdvantage"] == 0


def test_compute_death_round_state_bomb_not_planted_when_no_plant_tick():
    state = compute_death_round_state(alive_ct=4, alive_t=4, plant_tick=None, death_tick=5000, death_t=50.0)
    assert state["bombPlanted"] is False


def test_compute_death_round_state_bomb_planted_only_after_plant_tick():
    before_plant = compute_death_round_state(alive_ct=4, alive_t=4, plant_tick=2000, death_tick=1500, death_t=20.0)
    at_plant = compute_death_round_state(alive_ct=4, alive_t=4, plant_tick=2000, death_tick=2000, death_t=20.0)
    after_plant = compute_death_round_state(alive_ct=4, alive_t=4, plant_tick=2000, death_tick=2500, death_t=25.0)
    assert before_plant["bombPlanted"] is False
    assert at_plant["bombPlanted"] is False  # estritamente > plant_tick, não >=
    assert after_plant["bombPlanted"] is True


def test_compute_death_round_state_time_remaining_counts_down_from_round_limit():
    state = compute_death_round_state(alive_ct=4, alive_t=4, plant_tick=None, death_tick=1000, death_t=30.0)
    assert state["timeRemainingSec"] == ROUND_TIME_LIMIT_SECONDS - 30.0


def test_compute_death_round_state_time_remaining_clamped_at_zero():
    # morte tardia (pós-plant, retake demorado) não deve gerar tempo negativo
    state = compute_death_round_state(alive_ct=1, alive_t=1, plant_tick=1000, death_tick=99999, death_t=500.0)
    assert state["timeRemainingSec"] == 0.0


# --- build_round_windows ---

class FakeParser:
    def __init__(self, events):
        self._events = events

    def parse_event(self, name, other=None):
        return self._events.get(name)


def test_build_round_windows_basic():
    freeze_df = pd.DataFrame({"tick": [100, 500]})
    end_df = pd.DataFrame({"tick": [300, 700], "winner": [3, 2], "reason": ["x", "y"]})
    parser = FakeParser({"round_freeze_end": freeze_df, "round_end": end_df})
    windows = build_round_windows(parser)
    assert windows == [
        {"roundNumber": 1, "freezeTick": 100, "endTick": 300, "winner": "ct"},
        {"roundNumber": 2, "freezeTick": 500, "endTick": 700, "winner": "t"},
    ]


@pytest.mark.parametrize(
    "events",
    [
        {"round_freeze_end": None, "round_end": None},
        {"round_freeze_end": pd.DataFrame({"tick": []}), "round_end": pd.DataFrame({"tick": [1], "winner": [2]})},
    ],
)
def test_build_round_windows_empty_inputs(events):
    assert build_round_windows(FakeParser(events)) == []


def test_build_round_windows_skips_round_with_unrecognized_winner():
    freeze_df = pd.DataFrame({"tick": [100]})
    end_df = pd.DataFrame({"tick": [300], "winner": [99], "reason": ["x"]})
    parser = FakeParser({"round_freeze_end": freeze_df, "round_end": end_df})
    assert build_round_windows(parser) == []


def test_build_round_windows_skips_when_no_freeze_precedes_end():
    freeze_df = pd.DataFrame({"tick": [400]})
    end_df = pd.DataFrame({"tick": [300], "winner": [2], "reason": ["x"]})
    parser = FakeParser({"round_freeze_end": freeze_df, "round_end": end_df})
    assert build_round_windows(parser) == []


def test_build_round_windows_uses_latest_freeze_before_end():
    freeze_df = pd.DataFrame({"tick": [100, 150, 600]})
    end_df = pd.DataFrame({"tick": [300], "winner": [3], "reason": ["x"]})
    parser = FakeParser({"round_freeze_end": freeze_df, "round_end": end_df})
    windows = build_round_windows(parser)
    assert windows == [{"roundNumber": 1, "freezeTick": 150, "endTick": 300, "winner": "ct"}]


# --- safe_parse_event ---

def test_safe_parse_event_returns_dataframe_on_success():
    df = pd.DataFrame({"tick": [1]})

    class P:
        def parse_event(self, name, other=None):
            return df

    assert safe_parse_event(P(), "some_event") is df


def test_safe_parse_event_normalizes_list_result_to_none():
    class P:
        def parse_event(self, name, **kw):
            return []

    assert safe_parse_event(P(), "some_event") is None


def test_safe_parse_event_drops_optional_other_on_failure():
    calls = []

    class P:
        def parse_event(self, name, other=None):
            calls.append(list(other) if other else [])
            if other and "bad_optional" in other:
                raise RuntimeError("boom")
            return pd.DataFrame({"tick": [1]})

    result = safe_parse_event(P(), "evt", optional_other=["bad_optional"])
    assert result is not None
    assert calls == [["bad_optional"], []]


def test_safe_parse_event_falls_back_to_no_other_when_required_other_fails():
    calls = []

    class P:
        def parse_event(self, name, other=None):
            calls.append(list(other) if other else [])
            if other:
                raise RuntimeError("boom")
            return pd.DataFrame({"tick": [1]})

    result = safe_parse_event(P(), "evt", other=["weapon"])
    assert result is not None
    assert calls == [["weapon"], []]


def test_safe_parse_event_gives_up_when_nothing_works():
    class P:
        def parse_event(self, name, other=None):
            raise RuntimeError("boom")

    assert safe_parse_event(P(), "evt", other=["weapon"], optional_other=["hitgroup"]) is None


# --- safe_parse_ticks ---

def test_safe_parse_ticks_returns_dataframe_on_success():
    df = pd.DataFrame({"tick": [1]})

    class P:
        def parse_ticks(self, props, ticks):
            return df

    assert safe_parse_ticks(P(), ["X", "Y"], [1, 2]) is df


def test_safe_parse_ticks_drops_optional_props_on_failure():
    calls = []

    class P:
        def parse_ticks(self, props, ticks):
            calls.append(list(props))
            if "yaw" in props:
                raise RuntimeError("boom")
            return pd.DataFrame({"tick": [1]})

    result = safe_parse_ticks(P(), ["X", "Y", "yaw"], [1])
    assert result is not None
    assert "yaw" not in calls[-1]


def test_safe_parse_ticks_gives_up_when_nothing_works():
    class P:
        def parse_ticks(self, props, ticks):
            raise RuntimeError("boom")

    assert safe_parse_ticks(P(), ["X"], [1]) is None
