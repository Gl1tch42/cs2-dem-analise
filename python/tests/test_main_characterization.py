"""Characterization test for parse_demo.py's main() — the safety net for the
A06 refactor (splitting the ~1800-line main() into parser/analytics/models
modules). main() has no other end-to-end test today; everything else in
test_parse_demo.py only exercises isolated pure helpers.

This test feeds main() a fully synthetic demo (via FakeDemoParser) and
compares the resulting summary.json against a checked-in snapshot. It does
NOT assert the numbers are *correct* — it locks in today's actual behavior,
bugs and all, so a refactor that silently changes a metric gets caught.

To regenerate the snapshot after an INTENTIONAL analytics change: run this
file with UPDATE_CHARACTERIZATION_SNAPSHOT=1 in the environment, review the
resulting diff in fixtures/characterization_snapshot.json carefully before
committing it (a diff here should be explainable by a specific code change,
never a surprise).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import parse_demo
from fake_demo_parser import FakeDemoParser, Scenario

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "characterization_snapshot.json"

TICK_RATE = 64
STEAM_ALLY1 = 100
STEAM_ALLY2 = 101
STEAM_ENEMY1 = 200
STEAM_ENEMY2 = 201


def build_scenario() -> Scenario:
    s = Scenario()
    s.add_player(STEAM_ALLY1, "Ally1", "ct")
    s.add_player(STEAM_ALLY2, "Ally2", "ct")
    s.add_player(STEAM_ENEMY1, "Enemy1", "t")
    s.add_player(STEAM_ENEMY2, "Enemy2", "t")

    # ---- Round 1: freeze=1000, end=2000, CT wins by elimination ----------
    s.add_event("round_freeze_end", tick=1000)
    s.add_event("round_end", tick=2000, winner=3, reason="elimination")

    # Posições (keyframes esparsos — FakeDemoParser mantém a última posição
    # conhecida entre eles, como uma demo real teria por tick).
    s.add_position(STEAM_ALLY1, 1000, x=0, y=0, z=0, last_place_name="TSpawn", yaw=90, pitch=0)
    s.add_position(STEAM_ALLY1, 1150, x=250, y=100, z=0, last_place_name="Mid", yaw=90, pitch=0)
    s.add_position(STEAM_ALLY2, 1000, x=50, y=0, z=0, last_place_name="TSpawn", yaw=90, pitch=0)
    s.add_position(STEAM_ALLY2, 1150, x=300, y=120, z=0, last_place_name="Mid", yaw=90, pitch=0)
    s.add_position(STEAM_ENEMY1, 1000, x=400, y=200, z=0, last_place_name="BombsiteA", yaw=270, pitch=0)
    s.add_position(STEAM_ENEMY1, 1150, x=350, y=180, z=0, last_place_name="Mid", yaw=270, pitch=0)
    s.add_position(STEAM_ENEMY2, 1000, x=450, y=220, z=0, last_place_name="BombsiteA", yaw=270, pitch=0)
    s.add_position(STEAM_ENEMY2, 1300, x=380, y=200, z=0, last_place_name="BombsiteA", yaw=270, pitch=0)

    # Compra: Ally1 compra HE e nunca joga -> exercita unused-utility-value.
    s.add_event("item_purchase", tick=1010, user_steamid=STEAM_ALLY1, item="hegrenade")

    # Flash: Ally1 cega Enemy1 (efetiva, >=1.5s).
    s.add_event("flashbang_detonate", tick=1050, user_steamid=STEAM_ALLY1, x=300, y=150)
    s.add_event(
        "player_blind",
        tick=1055,
        user_steamid=STEAM_ENEMY1,
        blind_duration=1.5,
        attacker_steamid=STEAM_ALLY1,
    )

    # Smoke: detonate/expire com mesmo entityid -> pair_grenade_lifespan casa por entidade.
    s.add_event("smokegrenade_detonate", tick=1060, user_steamid=STEAM_ALLY2, x=200, y=200, entityid=5001)
    s.add_event("smokegrenade_expired", tick=1300, entityid=5001)

    # Tiro + dano correlacionados (dentro da janela de 16 ticks).
    s.add_event("weapon_fire", tick=1150, user_steamid=STEAM_ALLY1, weapon="ak47")
    s.add_event(
        "player_hurt",
        tick=1155,
        attacker_steamid=STEAM_ALLY1,
        user_steamid=STEAM_ENEMY1,
        dmg_health=30,
        hitgroup=2,
        weapon="ak47",
    )

    # Abertura: Ally1 mata Enemy1 (assist de Ally2).
    s.add_event(
        "player_death",
        tick=1200,
        attacker_steamid=STEAM_ALLY1,
        user_steamid=STEAM_ENEMY1,
        assister_steamid=STEAM_ALLY2,
        attacker_name="Ally1",
        user_name="Enemy1",
        assister_name="Ally2",
        weapon="ak47",
        headshot=False,
    )
    # Trade: Enemy2 vinga Enemy1 matando Ally1, dentro da janela de trade (3s = 192 ticks).
    s.add_event(
        "player_death",
        tick=1220,
        attacker_steamid=STEAM_ENEMY2,
        user_steamid=STEAM_ALLY1,
        attacker_name="Enemy2",
        user_name="Ally1",
        weapon="ak47",
        headshot=False,
    )
    # Plant (T ainda com Enemy2 vivo).
    s.add_event("bomb_planted", tick=1300, user_steamid=STEAM_ENEMY2)
    # Round decidido: Ally2 mata Enemy2 -> CT vence por eliminação.
    s.add_event(
        "player_death",
        tick=1400,
        attacker_steamid=STEAM_ALLY2,
        user_steamid=STEAM_ENEMY2,
        attacker_name="Ally2",
        user_name="Enemy2",
        weapon="ak47",
        headshot=True,
    )

    # ---- Round 2: freeze=2100, end=3000, T wins by elimination ------------
    s.add_event("round_freeze_end", tick=2100)
    s.add_event("round_end", tick=3000, winner=2, reason="elimination")

    s.add_position(STEAM_ALLY1, 2100, x=0, y=0, z=0, last_place_name="TSpawn", yaw=90, pitch=0)
    s.add_position(STEAM_ALLY1, 2500, x=100, y=50, z=0, last_place_name="Mid", yaw=90, pitch=0)
    s.add_position(STEAM_ALLY2, 2100, x=50, y=0, z=0, last_place_name="TSpawn", yaw=90, pitch=0)
    s.add_position(STEAM_ALLY2, 2400, x=120, y=60, z=0, last_place_name="Mid", yaw=90, pitch=0)
    s.add_position(STEAM_ENEMY1, 2100, x=400, y=200, z=0, last_place_name="BombsiteA", yaw=270, pitch=0)
    s.add_position(STEAM_ENEMY1, 2500, x=200, y=100, z=0, last_place_name="Mid", yaw=270, pitch=0)
    s.add_position(STEAM_ENEMY2, 2100, x=450, y=220, z=0, last_place_name="BombsiteA", yaw=270, pitch=0)
    s.add_position(STEAM_ENEMY2, 2400, x=250, y=120, z=0, last_place_name="Mid", yaw=270, pitch=0)

    s.add_event("item_purchase", tick=2110, user_steamid=STEAM_ENEMY1, item="smokegrenade")

    # T elimina os dois CT: um headshot de sniper, um kill de rifle.
    s.add_event(
        "player_death",
        tick=2500,
        attacker_steamid=STEAM_ENEMY2,
        user_steamid=STEAM_ALLY2,
        attacker_name="Enemy2",
        user_name="Ally2",
        weapon="awp",
        headshot=True,
    )
    s.add_event(
        "player_death",
        tick=2600,
        attacker_steamid=STEAM_ENEMY1,
        user_steamid=STEAM_ALLY1,
        attacker_name="Enemy1",
        user_name="Ally1",
        weapon="m4a1",
        headshot=False,
    )

    return s


def _run_main(tmp_path) -> dict:
    scenario = build_scenario()
    fake_parser = FakeDemoParser(scenario)

    class FakeDemoParserFactory:
        def __new__(cls, _input_path):
            return fake_parser

    output_path = tmp_path / "summary.json"
    old_argv = sys.argv
    sys.argv = [
        "parse_demo.py",
        "--input",
        "fake.dem",
        "--output",
        str(output_path),
    ]
    old_demo_parser = parse_demo.DemoParser
    parse_demo.DemoParser = FakeDemoParserFactory
    try:
        parse_demo.main()
    finally:
        sys.argv = old_argv
        parse_demo.DemoParser = old_demo_parser

    return json.loads(output_path.read_text(encoding="utf-8"))


def test_main_matches_characterization_snapshot(tmp_path):
    result = _run_main(tmp_path)

    if os.environ.get("UPDATE_CHARACTERIZATION_SNAPSHOT") == "1":
        FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE_PATH.write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")

    expected = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    assert result == expected


def _minimal_scenario_with_blind(*, include_attacker_column: bool, attacker_values_null: bool = False) -> Scenario:
    # Cenário mínimo (1 round, 1 duelo, 1 flash) só pra isolar o comportamento
    # de has_blind_attacker sem o resto do cenário rico — ver investigação do
    # bug real relatado pelo usuário: enemiesFlashed/flashbang efficiency/blind
    # time zerados em demos onde player_blind não traz attacker_steamid
    # utilizável (coluna ausente OU presente mas nula).
    s = Scenario()
    s.add_player(STEAM_ALLY1, "Ally1", "ct")
    s.add_player(STEAM_ENEMY1, "Enemy1", "t")
    s.add_event("round_freeze_end", tick=1000)
    s.add_event("round_end", tick=2000, winner=3, reason="elimination")
    s.add_position(STEAM_ALLY1, 1000, x=0, y=0, z=0)
    s.add_position(STEAM_ENEMY1, 1000, x=100, y=0, z=0)
    s.add_event(
        "player_death",
        tick=1500,
        attacker_steamid=STEAM_ALLY1,
        user_steamid=STEAM_ENEMY1,
        attacker_name="Ally1",
        user_name="Enemy1",
        weapon="ak47",
        headshot=False,
    )
    s.add_event("flashbang_detonate", tick=1050, user_steamid=STEAM_ALLY1, x=50, y=0)
    if include_attacker_column:
        blind_attacker = None if attacker_values_null else STEAM_ALLY1
        s.add_event("player_blind", tick=1055, user_steamid=STEAM_ENEMY1, blind_duration=1.5, attacker_steamid=blind_attacker)
    else:
        s.add_event("player_blind", tick=1055, user_steamid=STEAM_ENEMY1, blind_duration=1.5)
    return s


def _run_main_with_scenario(scenario: Scenario, tmp_path) -> dict:
    fake_parser = FakeDemoParser(scenario)

    class FakeDemoParserFactory:
        def __new__(cls, _input_path):
            return fake_parser

    output_path = tmp_path / "summary.json"
    old_argv = sys.argv
    sys.argv = ["parse_demo.py", "--input", "fake.dem", "--output", str(output_path)]
    old_demo_parser = parse_demo.DemoParser
    parse_demo.DemoParser = FakeDemoParserFactory
    try:
        parse_demo.main()
    finally:
        sys.argv = old_argv
        parse_demo.DemoParser = old_demo_parser

    return json.loads(output_path.read_text(encoding="utf-8"))


def test_flash_attacker_data_available_when_column_present_with_values(tmp_path):
    result = _run_main_with_scenario(_minimal_scenario_with_blind(include_attacker_column=True), tmp_path)
    assert result["calibration"]["flashAttackerDataAvailable"] is True
    thrower = next(p for p in result["playerAggregates"] if p["steamId"] == str(STEAM_ALLY1))
    assert thrower["utility"]["enemiesFlashed"] == 1
    # Dado disponível -> números reais, não None (regressão pro caso normal/POV).
    assert thrower["utility"]["enemiesFlashedPct"] == 100.0
    assert thrower["utility"]["avgBlindTimeSec"] == 1.5


def test_flash_attacker_data_unavailable_when_column_missing(tmp_path, capsys):
    result = _run_main_with_scenario(_minimal_scenario_with_blind(include_attacker_column=False), tmp_path)
    assert result["calibration"]["flashAttackerDataAvailable"] is False
    thrower = next(p for p in result["playerAggregates"] if p["steamId"] == str(STEAM_ALLY1))
    assert thrower["utility"]["enemiesFlashed"] == 0
    # None, não 0 — "não dá pra medir", não "mediu e não flashou ninguém" (bug
    # real reportado pelo usuário: demos GOTV/SourceTV da Vitality mostravam
    # 0% em vez de indicar falta de dado).
    assert thrower["utility"]["enemiesFlashedPct"] is None
    assert thrower["utility"]["effectiveFlashPct"] is None
    assert thrower["utility"]["avgBlindTimeSec"] is None
    assert thrower["utility"]["avgFriendlyBlindTimeSec"] is None
    assert "não expõe attacker_steamid" in capsys.readouterr().err


def test_flash_attacker_data_unavailable_when_column_present_but_all_null(tmp_path, capsys):
    result = _run_main_with_scenario(
        _minimal_scenario_with_blind(include_attacker_column=True, attacker_values_null=True), tmp_path
    )
    assert result["calibration"]["flashAttackerDataAvailable"] is False
    thrower = next(p for p in result["playerAggregates"] if p["steamId"] == str(STEAM_ALLY1))
    assert thrower["utility"]["enemiesFlashed"] == 0
    assert thrower["utility"]["enemiesFlashedPct"] is None
    assert "todos os valores" in capsys.readouterr().err


def test_purchase_item_data_unavailable_nulls_unused_utility_fields(tmp_path):
    s = Scenario()
    s.add_player(STEAM_ALLY1, "Ally1", "ct")
    s.add_player(STEAM_ENEMY1, "Enemy1", "t")
    s.add_event("round_freeze_end", tick=1000)
    s.add_event("round_end", tick=2000, winner=2, reason="elimination")
    s.add_position(STEAM_ALLY1, 1000, x=0, y=0, z=0)
    s.add_position(STEAM_ENEMY1, 1000, x=100, y=0, z=0)
    # item_purchase sem weapon nem item -> purchase_data_available False.
    s.add_event("item_purchase", tick=1010, user_steamid=STEAM_ALLY1)
    s.add_event(
        "player_death",
        tick=1500,
        attacker_steamid=STEAM_ENEMY1,
        user_steamid=STEAM_ALLY1,
        attacker_name="Enemy1",
        user_name="Ally1",
        weapon="ak47",
        headshot=False,
    )

    result = _run_main_with_scenario(s, tmp_path)

    assert result["calibration"]["purchaseItemDataAvailable"] is False
    thrower = next(p for p in result["playerAggregates"] if p["steamId"] == str(STEAM_ALLY1))
    assert thrower["utility"]["unusedUtilityValue"] is None
    assert thrower["utility"]["unusedUtilityRounds"] is None


def test_main_scenario_actually_exercises_the_intended_code_paths(tmp_path):
    # Guarda contra o snapshot "passar" trivialmente com uma demo degenerada
    # (tudo None/zero) — confirma que o cenário sintético realmente produz
    # sinal real nos metrics centrais antes de confiar nele como rede de
    # segurança pro refactor.
    result = _run_main(tmp_path)

    assert len(result["rounds"]) == 2
    assert result["rounds"][0]["winner"] == "ct"
    assert result["rounds"][1]["winner"] == "t"
    assert len(result["rounds"][0]["deaths"]) == 3

    players_by_id = {p["steamId"]: p for p in result["playerAggregates"]}
    assert players_by_id[str(STEAM_ALLY1)]["kills"] >= 1
    assert players_by_id[str(STEAM_ALLY2)]["positioning"]["tradeKills"] == 0 or True  # sanity: field exists
    # opening duel e trade devem ter sido detectados pra alguém
    assert any(p["entryAttempts"] > 0 for p in result["playerAggregates"])
    assert any(p["positioning"]["tradeKills"] > 0 for p in result["playerAggregates"])
