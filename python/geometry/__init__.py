"""Real map-geometry line-of-sight checking (A04).

See THIRD_PARTY_NOTICE.md — the collision-parsing and raycasting logic in
visibility.py is adapted from awpy (MIT licensed).
"""

from .visibility import VisibilityChecker, VphysParser

__all__ = ["VisibilityChecker", "VphysParser"]
