import struct

from geometry.visibility import Triangle
from geometry.vector import Vector3
from parse_demo import load_visibility_checker


def _write_tri_file(path, triangles) -> None:
    with open(path, "wb") as f:
        for tri in triangles:
            for point in (tri.p1, tri.p2, tri.p3):
                f.write(struct.pack("f", point.x))
                f.write(struct.pack("f", point.y))
                f.write(struct.pack("f", point.z))


def test_returns_none_when_no_geometry_dir():
    assert load_visibility_checker(None, "de_mirage") is None
    assert load_visibility_checker("", "de_mirage") is None


def test_returns_none_when_directory_has_nothing_for_map(tmp_path):
    assert load_visibility_checker(str(tmp_path), "de_mirage") is None


def test_loads_directly_from_existing_tri_file(tmp_path):
    triangle = Triangle(Vector3(-50, 50, -50), Vector3(50, 50, -50), Vector3(0, 50, 50))
    _write_tri_file(tmp_path / "de_mirage.tri", [triangle])

    checker = load_visibility_checker(str(tmp_path), "de_mirage")

    assert checker is not None
    assert checker.is_visible((0, 0, 0), (0, 100, 0)) is False


def test_converts_vphys_to_tri_on_first_use_and_caches_it(tmp_path, monkeypatch):
    # VphysParser.__init__ parses eagerly and to_tri() writes real triangles —
    # instead of feeding it a real KV3 file (out of scope to hand-author one),
    # monkeypatch VphysParser to a stub that writes one known triangle, and
    # confirm load_visibility_checker wires path resolution + caching
    # correctly around whatever the parser produces.
    vphys_path = tmp_path / "de_mirage.vphys"
    vphys_path.write_text("stub vphys content", encoding="utf-8")
    tri_path = tmp_path / "de_mirage.tri"
    wall = Triangle(Vector3(-50, 50, -50), Vector3(50, 50, -50), Vector3(0, 50, 50))

    class StubVphysParser:
        def __init__(self, path):
            self.vphys_file = path

        def to_tri(self, out_path):
            _write_tri_file(out_path, [wall])

    import geometry.visibility as visibility_module

    monkeypatch.setattr(visibility_module, "VphysParser", StubVphysParser)

    assert not tri_path.exists()
    checker = load_visibility_checker(str(tmp_path), "de_mirage")
    assert checker is not None
    assert tri_path.exists()  # cached for next time
    assert checker.is_visible((0, 0, 0), (0, 100, 0)) is False


def test_returns_none_and_does_not_raise_on_malformed_vphys(tmp_path):
    (tmp_path / "de_mirage.vphys").write_text("not valid KV3 data at all", encoding="utf-8")
    assert load_visibility_checker(str(tmp_path), "de_mirage") is None
