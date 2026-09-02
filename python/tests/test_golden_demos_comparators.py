from golden_demos.comparators import (
    compare_aggregate_field,
    compare_all_aggregate_fields,
    compare_demo,
    compare_opening_duels,
    merge_results,
    summarize_feature_versions,
)
from golden_demos.schema import validate_annotation


def _summary_with_round(entry_by, entry_on, round_number=1):
    return {
        "rounds": [{"roundNumber": round_number, "entryFragBy": entry_by, "entryFragOn": entry_on}],
        "playerAggregates": [],
    }


def _annotation_with_round(winner, loser, round_number=1):
    return {
        "rounds": [
            {
                "round": round_number,
                "annotatedMetrics": ["openingDuel"],
                "openingDuel": {"winnerName": winner, "loserName": loser},
            }
        ],
        "playerAggregates": [],
    }


def test_opening_duel_exact_match():
    annotation = _annotation_with_round("alice", "bob")
    summary = _summary_with_round("alice", "bob")
    result = compare_opening_duels(annotation, summary)
    assert result.total == 1
    assert result.correct == 1
    assert result.accuracy == 1.0
    assert result.mismatches == []


def test_opening_duel_mismatch_recorded():
    annotation = _annotation_with_round("alice", "bob")
    summary = _summary_with_round("carol", "bob")
    result = compare_opening_duels(annotation, summary)
    assert result.total == 1
    assert result.correct == 0
    assert result.accuracy == 0.0
    assert result.mismatches[0]["round"] == 1
    assert result.mismatches[0]["predicted"]["winnerName"] == "carol"


def test_opening_duel_skips_unannotated_rounds():
    annotation = {
        "rounds": [{"round": 1, "annotatedMetrics": [], "openingDuel": {"winnerName": "x", "loserName": "y"}}],
        "playerAggregates": [],
    }
    summary = _summary_with_round("someone-else", "another")
    result = compare_opening_duels(annotation, summary)
    assert result.total == 0
    assert result.accuracy is None


def test_opening_duel_missing_round_in_summary_is_a_mismatch():
    annotation = _annotation_with_round("alice", "bob", round_number=5)
    summary = _summary_with_round("alice", "bob", round_number=1)
    result = compare_opening_duels(annotation, summary)
    assert result.total == 1
    assert result.correct == 0


def _summary_with_player(steam_id, **overrides):
    aim = {"avgCrosshairPlacementDeg": 10.0, "avgTimeToDamageMs": 300, "avgTimeToKillMs": 700}
    utility = {"flashAssists": 2, "avgHeDamage": 20.0, "avgMolotovDamage": 15.0}
    positioning = {"tradeKills": 3, "tradedDeathPct": 25.0, "overexposedDeathPct": 5.0}
    aim.update(overrides.get("aim", {}))
    utility.update(overrides.get("utility", {}))
    positioning.update(overrides.get("positioning", {}))
    return {
        "rounds": [],
        "playerAggregates": [
            {"steamId": steam_id, "aim": aim, "utility": utility, "positioning": positioning}
        ],
    }


def test_compare_aggregate_field_computes_mae():
    annotation = {
        "rounds": [],
        "playerAggregates": [
            {"steamId": "s1", "annotatedMetrics": ["tradeKills"], "tradeKills": 5},
        ],
    }
    summary = _summary_with_player("s1")  # predicted tradeKills = 3
    result = compare_aggregate_field(annotation, summary, "tradeKills")
    assert result.n == 1
    assert result.mae == 2.0
    assert result.diffs[0] == ("s1", 5, 3, 2.0)


def test_compare_aggregate_field_skips_unmarked_metric():
    annotation = {
        "rounds": [],
        "playerAggregates": [
            {"steamId": "s1", "annotatedMetrics": [], "tradeKills": 5},
        ],
    }
    summary = _summary_with_player("s1")
    result = compare_aggregate_field(annotation, summary, "tradeKills")
    assert result.n == 0
    assert result.mae is None


def test_compare_aggregate_field_skips_missing_prediction():
    annotation = {
        "rounds": [],
        "playerAggregates": [
            {"steamId": "unknown-player", "annotatedMetrics": ["tradeKills"], "tradeKills": 5},
        ],
    }
    summary = _summary_with_player("s1")
    result = compare_aggregate_field(annotation, summary, "tradeKills")
    assert result.n == 0


def test_compare_aggregate_field_skips_null_predicted_value():
    annotation = {
        "rounds": [],
        "playerAggregates": [
            {"steamId": "s1", "annotatedMetrics": ["avgCrosshairPlacementDeg"], "avgCrosshairPlacementDeg": 10.0},
        ],
    }
    summary = _summary_with_player("s1", aim={"avgCrosshairPlacementDeg": None})
    result = compare_aggregate_field(annotation, summary, "avgCrosshairPlacementDeg")
    assert result.n == 0


def test_compare_all_aggregate_fields_returns_every_known_metric():
    annotation = {"rounds": [], "playerAggregates": []}
    summary = {"rounds": [], "playerAggregates": []}
    results = compare_all_aggregate_fields(annotation, summary)
    assert set(results.keys()) == {
        "tradeKills",
        "tradedDeathPct",
        "overexposedDeathPct",
        "flashAssists",
        "avgCrosshairPlacementDeg",
        "avgTimeToDamageMs",
        "avgTimeToKillMs",
        "avgHeDamage",
        "avgMolotovDamage",
    }


def test_merge_results_accumulates_across_demos():
    demo1 = compare_demo(_annotation_with_round("alice", "bob"), _summary_with_round("alice", "bob"))
    demo2 = compare_demo(_annotation_with_round("carol", "dave"), _summary_with_round("someone", "else"))
    merged = merge_results([demo1, demo2])
    assert merged["openingDuel"].total == 2
    assert merged["openingDuel"].correct == 1


def test_validate_annotation_accepts_minimal_valid_document():
    doc = {
        "schemaVersion": 1,
        "demoKey": "k",
        "demoFileName": "f.dem",
        "demoSha256": "abc",
        "map": "de_mirage",
        "rounds": [],
        "playerAggregates": [],
    }
    assert validate_annotation(doc) == []


def test_validate_annotation_flags_missing_required_fields():
    errors = validate_annotation({})
    assert any("demoKey" in e for e in errors)
    assert any("demoFileName" in e for e in errors)


def test_validate_annotation_flags_unknown_metric_names():
    doc = {
        "schemaVersion": 1,
        "demoKey": "k",
        "demoFileName": "f.dem",
        "demoSha256": "abc",
        "map": "de_mirage",
        "rounds": [{"round": 1, "annotatedMetrics": ["notARealMetric"]}],
        "playerAggregates": [],
    }
    errors = validate_annotation(doc)
    assert any("notARealMetric" in e for e in errors)


def test_summarize_feature_versions_single_version():
    summaries = [{"featureModelVersion": "v1-heuristic"}, {"featureModelVersion": "v1-heuristic"}]
    result = summarize_feature_versions(summaries)
    assert result == {"versions": ["v1-heuristic"], "mixed": False}


def test_summarize_feature_versions_mixed_versions():
    summaries = [{"featureModelVersion": "v1-heuristic"}, {"featureModelVersion": "v2-heuristic"}]
    result = summarize_feature_versions(summaries)
    assert result == {"versions": ["v1-heuristic", "v2-heuristic"], "mixed": True}


def test_summarize_feature_versions_ignores_missing_field():
    summaries = [{}, {"featureModelVersion": "v1-heuristic"}]
    result = summarize_feature_versions(summaries)
    assert result == {"versions": ["v1-heuristic"], "mixed": False}


def test_summarize_feature_versions_empty_input():
    assert summarize_feature_versions([]) == {"versions": [], "mixed": False}


def test_validate_annotation_flags_marked_metric_missing_value():
    doc = {
        "schemaVersion": 1,
        "demoKey": "k",
        "demoFileName": "f.dem",
        "demoSha256": "abc",
        "map": "de_mirage",
        "rounds": [],
        "playerAggregates": [{"steamId": "s1", "annotatedMetrics": ["tradeKills"]}],
    }
    errors = validate_annotation(doc)
    assert any("tradeKills" in e for e in errors)
