"""Annotation format for golden-demo validation.

See README.md in this directory for the full workflow. This module defines
the expected shape of an annotation JSON file (plain dicts, no runtime
dependency beyond the stdlib) and a light structural validator run before
comparators see the data.

Important: round-level identifiers (`entryFragBy`/`entryFragOn` in the
parser's output) are player *names*, not steamIds — parse_demo.py resolves
names for anything round/death-scoped. Player-aggregate identifiers
(`PlayerAggregate.steamId`) are steamIds. The annotation format mirrors this
asymmetry on purpose: round entries use names, playerAggregates entries use
steamIds.
"""
from __future__ import annotations

SCHEMA_VERSION = 1

ROUND_METRICS = {"openingDuel"}

# Keep in sync with comparators.AGGREGATE_FIELDS
PLAYER_METRICS = {
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

REQUIRED_TOP_LEVEL = ("schemaVersion", "demoKey", "demoFileName", "demoSha256", "map")


def validate_annotation(data: dict) -> list[str]:
    """Return a list of human-readable validation errors (empty list = valid)."""
    errors: list[str] = []

    for field_name in REQUIRED_TOP_LEVEL:
        if field_name not in data:
            errors.append(f"campo obrigatório ausente: {field_name}")

    if "schemaVersion" in data and data.get("schemaVersion") != SCHEMA_VERSION:
        errors.append(
            f"schemaVersion não suportado: {data.get('schemaVersion')!r} (esperado {SCHEMA_VERSION})"
        )

    for i, round_ann in enumerate(data.get("rounds", [])):
        if "round" not in round_ann:
            errors.append(f"rounds[{i}]: falta o campo 'round'")
        annotated = round_ann.get("annotatedMetrics", [])
        unknown = set(annotated) - ROUND_METRICS
        if unknown:
            errors.append(f"rounds[{i}]: annotatedMetrics desconhecidas: {sorted(unknown)}")
        if "openingDuel" in annotated:
            opening = round_ann.get("openingDuel") or {}
            if not opening.get("winnerName") or not opening.get("loserName"):
                errors.append(
                    f"rounds[{i}]: 'openingDuel' marcado em annotatedMetrics mas "
                    "faltam 'winnerName'/'loserName'"
                )

    for i, player_ann in enumerate(data.get("playerAggregates", [])):
        if "steamId" not in player_ann:
            errors.append(f"playerAggregates[{i}]: falta o campo 'steamId'")
        annotated = player_ann.get("annotatedMetrics", [])
        unknown = set(annotated) - PLAYER_METRICS
        if unknown:
            errors.append(f"playerAggregates[{i}]: annotatedMetrics desconhecidas: {sorted(unknown)}")
        for metric in annotated:
            if player_ann.get(metric) is None:
                errors.append(
                    f"playerAggregates[{i}]: '{metric}' marcado em annotatedMetrics mas está ausente/nulo"
                )

    return errors
