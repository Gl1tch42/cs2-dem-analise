"""Classificação de armas/granadas — segunda fatia extraída de parse_demo.py
(A06 "Parser modular"). Funções puras (nome de arma/hitgroup -> categoria),
sem nenhuma dependência de estado de round — só constantes de referência.
"""
from __future__ import annotations

GRENADE_PRICES = {
    "flashbang": 200,
    "smokegrenade": 300,
    "hegrenade": 300,
    "molotov": 400,
    "incgrenade": 600,
    "decoy": 50,
}

NON_GUN_WEAPONS = {
    "hegrenade", "flashbang", "smokegrenade", "molotov", "incgrenade",
    "decoy", "knife", "knife_t", "bayonet", "taser", "c4", "world",
}

# Categorias de arma usadas pelas exceções pedidas (isolar sniper/shotgun de
# head accuracy/HS%, restringir spray a rifle/SMG, tolerância de counter-strafe
# quase zero pra sniper). Valores de velocidade são a velocidade máxima
# aproximada (unidades/s) de cada arma no CS2 — aproximação de referência,
# não authoritative; ajustar aqui se precisar calibrar.
SNIPER_WEAPONS = {"awp", "ssg08", "g3sg1", "scar20"}
SHOTGUN_WEAPONS = {"nova", "xm1014", "sawedoff", "mag7"}
PISTOL_WEAPONS = {
    "glock", "usp_silencer", "hkp2000", "p250", "fiveseven", "tec9",
    "deagle", "revolver", "elite", "cz75a",
}
WEAPON_MAX_SPEED = {
    "knife": 250.0, "knife_t": 250.0, "bayonet": 250.0,
    "glock": 240.0, "usp_silencer": 240.0, "hkp2000": 240.0, "elite": 240.0,
    "tec9": 240.0, "fiveseven": 240.0, "cz75a": 240.0, "p250": 240.0,
    "deagle": 230.0, "revolver": 220.0,
    "mac10": 240.0, "mp9": 240.0, "bizon": 240.0, "mp7": 220.0, "ump45": 230.0, "p90": 230.0,
    "famas": 240.0, "galilar": 215.0, "ak47": 215.0, "m4a1": 225.0, "m4a1_silencer": 225.0,
    "aug": 220.0, "sg556": 210.0,
    "nova": 220.0, "xm1014": 215.0, "sawedoff": 210.0, "mag7": 225.0,
    "awp": 200.0, "ssg08": 230.0, "g3sg1": 215.0, "scar20": 215.0,
    "negev": 150.0, "m249": 160.0,
    "taser": 220.0,
}
DEFAULT_MAX_SPEED = 230.0
COUNTER_STRAFE_RELATIVE_THRESHOLD = 0.34
SNIPER_STATIONARY_THRESHOLD = 5.0


def is_gun_weapon(name) -> bool:
    if name is None or str(name) == "nan":
        return False
    low = str(name).lower()
    if low in NON_GUN_WEAPONS:
        return False
    if "knife" in low or "bayonet" in low:
        return False
    return True


def is_head_hitgroup(value) -> bool:
    if value is None or str(value) == "nan":
        return False
    try:
        return int(float(value)) == 1
    except (ValueError, TypeError):
        return str(value).lower() == "head"


def is_sniper_weapon(name) -> bool:
    return name is not None and str(name).lower() in SNIPER_WEAPONS


def is_shotgun_weapon(name) -> bool:
    return name is not None and str(name).lower() in SHOTGUN_WEAPONS


def is_rifle_or_smg_weapon(name) -> bool:
    if not is_gun_weapon(name):
        return False
    low = str(name).lower()
    return low not in SNIPER_WEAPONS and low not in SHOTGUN_WEAPONS and low not in PISTOL_WEAPONS


def max_speed_for_weapon(name) -> float:
    if name is None or str(name) == "nan":
        return DEFAULT_MAX_SPEED
    return WEAPON_MAX_SPEED.get(str(name).lower(), DEFAULT_MAX_SPEED)
