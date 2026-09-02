"""Comparison functions for golden-demo validation.

Pure functions: no file I/O, no parser invocation. They operate on an
already-loaded annotation dict (see schema.py) and an already-loaded parser
summary dict (the DemoSummary shape parse_demo.py writes — see
electron/storage/types.ts for the authoritative field names).
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class AccuracyResult:
    """Single-label-per-round comparison (e.g. opening duel winner/loser)."""

    metric: str
    correct: int = 0
    total: int = 0
    mismatches: list = field(default_factory=list)

    @property
    def accuracy(self):
        return self.correct / self.total if self.total else None

    def merge(self, other: "AccuracyResult") -> "AccuracyResult":
        return AccuracyResult(
            metric=self.metric,
            correct=self.correct + other.correct,
            total=self.total + other.total,
            mismatches=self.mismatches + other.mismatches,
        )


@dataclass
class MAEResult:
    """Mean absolute error between annotated and predicted numeric values."""

    metric: str
    diffs: list = field(default_factory=list)  # (steamId, annotated, predicted, abs_diff)

    @property
    def n(self):
        return len(self.diffs)

    @property
    def mae(self):
        if not self.diffs:
            return None
        return sum(d[3] for d in self.diffs) / len(self.diffs)

    def merge(self, other: "MAEResult") -> "MAEResult":
        return MAEResult(metric=self.metric, diffs=self.diffs + other.diffs)


# name -> (PlayerAggregate sub-object, field) — every entry here is a direct
# 1:1 field in the parser's output, so no unit conversion happens on our side.
AGGREGATE_FIELDS = {
    "tradeKills": ("positioning", "tradeKills"),
    "tradedDeathPct": ("positioning", "tradedDeathPct"),
    "overexposedDeathPct": ("positioning", "overexposedDeathPct"),
    "flashAssists": ("utility", "flashAssists"),
    "avgCrosshairPlacementDeg": ("aim", "avgCrosshairPlacementDeg"),
    "avgTimeToDamageMs": ("aim", "avgTimeToDamageMs"),
    "avgTimeToKillMs": ("aim", "avgTimeToKillMs"),
    "avgHeDamage": ("utility", "avgHeDamage"),
    "avgMolotovDamage": ("utility", "avgMolotovDamage"),
}


def _index_by_steam_id(summary: dict) -> dict:
    return {p["steamId"]: p for p in summary.get("playerAggregates", [])}


def _index_rounds(summary: dict) -> dict:
    return {r["roundNumber"]: r for r in summary.get("rounds", [])}


def compare_opening_duels(annotation: dict, summary: dict) -> AccuracyResult:
    """Compare annotated opening-duel winner/loser (by player name, matching
    parse_demo.py's entryFragBy/entryFragOn) against the parser's prediction.

    Reported as accuracy, not precision/recall: the parser always predicts
    exactly one winner/loser per round, so there is no independent
    false-positive axis to score.
    """
    result = AccuracyResult(metric="openingDuel")
    rounds_by_num = _index_rounds(summary)
    for ann_round in annotation.get("rounds", []):
        if "openingDuel" not in ann_round.get("annotatedMetrics", []):
            continue
        expected = ann_round.get("openingDuel") or {}
        round_num = ann_round["round"]
        predicted = rounds_by_num.get(round_num, {})
        result.total += 1
        match = predicted.get("entryFragBy") == expected.get("winnerName") and predicted.get(
            "entryFragOn"
        ) == expected.get("loserName")
        if match:
            result.correct += 1
        else:
            result.mismatches.append(
                {
                    "round": round_num,
                    "expected": expected,
                    "predicted": {
                        "winnerName": predicted.get("entryFragBy"),
                        "loserName": predicted.get("entryFragOn"),
                    },
                }
            )
    return result


def _get_nested(d: dict, category: str, key: str):
    return (d.get(category) or {}).get(key)


def compare_aggregate_field(annotation: dict, summary: dict, field_name: str) -> MAEResult:
    """Compare one annotated per-player aggregate field against the parser's
    prediction for every player where the annotator marked that field as
    annotated. `field_name` must be a key of AGGREGATE_FIELDS.
    """
    if field_name not in AGGREGATE_FIELDS:
        raise ValueError(f"unknown aggregate field: {field_name}")
    category, key = AGGREGATE_FIELDS[field_name]
    result = MAEResult(metric=field_name)
    players_by_id = _index_by_steam_id(summary)
    for ann_player in annotation.get("playerAggregates", []):
        if field_name not in ann_player.get("annotatedMetrics", []):
            continue
        annotated_value = ann_player.get(field_name)
        if annotated_value is None:
            continue
        steam_id = ann_player["steamId"]
        predicted_player = players_by_id.get(steam_id)
        if predicted_player is None:
            continue
        predicted_value = _get_nested(predicted_player, category, key)
        if predicted_value is None:
            continue
        diff = abs(float(annotated_value) - float(predicted_value))
        result.diffs.append((steam_id, annotated_value, predicted_value, diff))
    return result


def compare_all_aggregate_fields(annotation: dict, summary: dict) -> dict:
    return {name: compare_aggregate_field(annotation, summary, name) for name in AGGREGATE_FIELDS}


def compare_demo(annotation: dict, summary: dict) -> dict:
    """Run every comparator for a single (annotation, parser summary) pair."""
    results: dict = {"openingDuel": compare_opening_duels(annotation, summary)}
    results.update(compare_all_aggregate_fields(annotation, summary))
    return results


def merge_results(all_results: list) -> dict:
    """Merge a list of per-demo `compare_demo` outputs into one aggregate report."""
    merged: dict = {}
    for demo_results in all_results:
        for metric, result in demo_results.items():
            merged[metric] = result if metric not in merged else merged[metric].merge(result)
    return merged


def summarize_feature_versions(summaries: list) -> dict:
    """Collect the distinct `featureModelVersion` values across a batch of
    parsed summaries. `mixed=True` means the batch was produced by more than
    one version of parse_demo.py's detection logic, so any aggregated
    accuracy/MAE across the batch mixes results that aren't directly
    comparable — callers should warn the user in that case.
    """
    versions = sorted({s.get("featureModelVersion") for s in summaries if s.get("featureModelVersion")})
    return {"versions": versions, "mixed": len(versions) > 1}
