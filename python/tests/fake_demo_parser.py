"""Fake DemoParser + scenario builder for characterization-testing
parse_demo.py's main() end-to-end, without a real .dem file or demoparser2.

This is the safety net for the A06 refactor (see
test_main_characterization.py). main() only ever calls 4 methods on its
DemoParser instance — parse_header(), parse_event(name, other=...),
parse_ticks(props, ticks=...), and parse_grenades() (confirmed by reading
the whole file) — all reproduced here from a plain-Python Scenario
description instead of a real demo.

Extend the Scenario (don't hand-roll a second fake) when a future feature
needs more characterization coverage.
"""
from __future__ import annotations

import pandas as pd

# Colunas sempre presentes em qualquer linha de tick real do demoparser2,
# independente do que foi pedido em `props` — ver pesquisa no plano do A06.
ALWAYS_PRESENT_TICK_PROPS = ("X", "Y", "health", "current_equip_value")


class Scenario:
    """Descrição plana de uma demo falsa: jogadores, posições ao longo do
    tempo (keyframes esparsos, não um valor por tick) e eventos.
    """

    def __init__(self):
        self.players: dict[int, dict] = {}
        self.positions: dict[int, list[tuple[int, dict]]] = {}
        self.events: dict[str, list[dict]] = {}

    def add_player(self, steamid: int, name: str, side: str) -> None:
        self.players[steamid] = {"name": name, "team_num": 3 if side == "ct" else 2}
        self.positions.setdefault(steamid, [])

    def add_position(
        self,
        steamid: int,
        tick: int,
        x: float,
        y: float,
        z: float = 0.0,
        health: int = 100,
        equip_value: float = 3000.0,
        **extra,
    ) -> None:
        row = {"X": x, "Y": y, "Z": z, "health": health, "current_equip_value": equip_value, **extra}
        self.positions.setdefault(steamid, []).append((tick, row))
        self.positions[steamid].sort(key=lambda p: p[0])

    def add_event(self, name: str, **fields) -> None:
        self.events.setdefault(name, []).append(fields)


class FakeDemoParser:
    """Substitui `demoparser2.DemoParser` nos testes — mesma superfície de 4
    métodos que main() realmente usa, respondida a partir de um Scenario.
    """

    def __init__(self, scenario: Scenario, map_name: str = "de_mirage"):
        self.scenario = scenario
        self.map_name = map_name

    def parse_header(self):
        return {"map_name": self.map_name}

    def parse_event(self, name: str, other=None):
        rows = self.scenario.events.get(name)
        if not rows:
            # demoparser2 retorna uma lista (não DataFrame) quando o evento nunca
            # ocorre — safe_parse_event já trata isso (parse_demo.py:194).
            return []
        return pd.DataFrame(rows)

    def parse_grenades(self):
        return None

    def parse_ticks(self, props: list, ticks: list):
        records = []
        for steamid, info in self.scenario.players.items():
            keyframes = self.scenario.positions.get(steamid, [])
            if not keyframes:
                continue
            for tick in ticks:
                # último keyframe conhecido nesse tick ou antes (posição "segura" entre
                # amostras, igual a uma demo real teria por tick) — se nenhum antes, usa
                # o primeiro (jogador ainda não "chegou" na cena descrita).
                candidate = keyframes[0][1]
                for kf_tick, kf in keyframes:
                    if kf_tick > tick:
                        break
                    candidate = kf
                record = {
                    "tick": tick,
                    "steamid": steamid,
                    "name": info["name"],
                    "team_num": info["team_num"],
                }
                for prop in props:
                    if prop in candidate:
                        record[prop] = candidate[prop]
                for prop in ALWAYS_PRESENT_TICK_PROPS:
                    record.setdefault(prop, candidate.get(prop, 0))
                records.append(record)
        return pd.DataFrame(records) if records else pd.DataFrame()
