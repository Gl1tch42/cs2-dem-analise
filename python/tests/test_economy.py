import pytest

from analytics.economy import classify_buy_type, classify_round_economy, classify_round_tempo_stance


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


# --- classify_round_tempo_stance ---

def test_tempo_rush_when_high_displacement_and_single_area():
    tempo, _ = classify_round_tempo_stance([1000, 1000], areas_reached_count=1, low_threshold=100, high_threshold=900)
    assert tempo == "rush"


def test_tempo_split_when_two_or_more_areas_reached_even_if_displacement_is_high():
    # spread >= 2 é checado ANTES do critério de rush, mesmo com deslocamento alto.
    tempo, _ = classify_round_tempo_stance([1000, 1000], areas_reached_count=2, low_threshold=100, high_threshold=900)
    assert tempo == "split"


def test_tempo_slow_when_low_displacement():
    tempo, _ = classify_round_tempo_stance([50, 60], areas_reached_count=1, low_threshold=100, high_threshold=900)
    assert tempo == "slow"


def test_tempo_default_when_between_thresholds():
    tempo, _ = classify_round_tempo_stance([500, 500], areas_reached_count=1, low_threshold=100, high_threshold=900)
    assert tempo == "default"


def test_stance_unknown_when_no_displacements():
    _, stance = classify_round_tempo_stance([], areas_reached_count=0, low_threshold=100, high_threshold=900)
    assert stance == "unknown"


def test_stance_aggressive_when_most_displacements_at_or_above_high_threshold():
    _, stance = classify_round_tempo_stance(
        [900, 950, 1000, 200], areas_reached_count=1, low_threshold=100, high_threshold=900
    )
    assert stance == "aggressive"


def test_stance_passive_when_most_displacements_at_or_below_low_threshold():
    _, stance = classify_round_tempo_stance(
        [50, 80, 100, 900], areas_reached_count=1, low_threshold=100, high_threshold=900
    )
    assert stance == "passive"


def test_stance_passive_aggressive_when_mixed():
    _, stance = classify_round_tempo_stance(
        [500, 500, 500, 500], areas_reached_count=1, low_threshold=100, high_threshold=900
    )
    assert stance == "passive-aggressive"


# --- classify_round_economy ---

def test_classify_round_economy_shape_and_per_side_orchestration():
    result = classify_round_economy(
        equip_by_side={"ct": [4000, 4200], "t": [500, 600]},
        displacement_by_side={"ct": [1000, 1000], "t": [50, 60]},
        areas_reached_by_side={"ct": {"A"}, "t": {"Mid"}},
        low_threshold=100,
        high_threshold=900,
    )
    assert result == {
        "buyType": {"ct": "full", "t": "eco"},
        "tempo": {"ct": "rush", "t": "slow"},
        "stance": {"ct": "aggressive", "t": "passive"},
    }


def test_classify_round_economy_handles_empty_equip_values():
    result = classify_round_economy(
        equip_by_side={"ct": [], "t": []},
        displacement_by_side={"ct": [], "t": []},
        areas_reached_by_side={"ct": set(), "t": set()},
        low_threshold=100,
        high_threshold=900,
    )
    assert result["buyType"] == {"ct": "unknown", "t": "unknown"}
    assert result["stance"] == {"ct": "unknown", "t": "unknown"}
