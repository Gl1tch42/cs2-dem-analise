import struct

import pytest

from geometry.vector import Vector3
from geometry.visibility import AABB, KV3Parser, Triangle, VisibilityChecker


def _write_tri_file(path, triangles: list[Triangle]) -> None:
    with open(path, "wb") as f:
        for tri in triangles:
            for point in (tri.p1, tri.p2, tri.p3):
                f.write(struct.pack("f", point.x))
                f.write(struct.pack("f", point.y))
                f.write(struct.pack("f", point.z))


def _wall_blocking_y_axis() -> Triangle:
    # A triangle spanning the XZ plane at y=50, directly between (0,0,0) and (0,100,0).
    return Triangle(
        Vector3(-50, 50, -50),
        Vector3(50, 50, -50),
        Vector3(0, 50, 50),
    )


class TestVector3:
    def test_dot_and_cross_and_normalize(self):
        a = Vector3(1, 0, 0)
        b = Vector3(0, 1, 0)
        assert a.dot(b) == 0
        cross = a.cross(b)
        assert (cross.x, cross.y, cross.z) == (0, 0, 1)
        assert a.normalize().length() == pytest.approx(1.0)

    def test_from_input_accepts_tuple_list_and_vector3(self):
        assert Vector3.from_input((1, 2, 3)) == Vector3(1, 2, 3)
        assert Vector3.from_input([1, 2, 3]) == Vector3(1, 2, 3)
        v = Vector3(4, 5, 6)
        assert Vector3.from_input(v) is v

    def test_from_input_rejects_wrong_length(self):
        with pytest.raises(ValueError):
            Vector3.from_input((1, 2))


class TestAABB:
    def test_ray_hits_box(self):
        box = AABB(Vector3(-1, -1, -1), Vector3(1, 1, 1))
        assert box.intersects_ray(Vector3(-5, 0, 0), Vector3(1, 0, 0)) is True

    def test_ray_misses_box(self):
        box = AABB(Vector3(-1, -1, -1), Vector3(1, 1, 1))
        assert box.intersects_ray(Vector3(-5, 10, 0), Vector3(1, 0, 0)) is False


class TestVisibilityChecker:
    def test_is_visible_true_with_no_obstruction(self):
        triangle = Triangle(Vector3(1000, 1000, 1000), Vector3(1001, 1000, 1000), Vector3(1000, 1001, 1000))
        checker = VisibilityChecker(triangles=[triangle])
        assert checker.is_visible((0, 0, 0), (100, 0, 0)) is True

    def test_is_visible_false_when_wall_blocks_segment(self):
        checker = VisibilityChecker(triangles=[_wall_blocking_y_axis()])
        assert checker.is_visible((0, 0, 0), (0, 100, 0)) is False

    def test_is_visible_true_when_endpoint_short_of_wall(self):
        checker = VisibilityChecker(triangles=[_wall_blocking_y_axis()])
        # target stops well before reaching the wall at y=50
        assert checker.is_visible((0, 0, 0), (0, 10, 0)) is True

    def test_is_visible_true_for_coincident_points(self):
        checker = VisibilityChecker(triangles=[_wall_blocking_y_axis()])
        assert checker.is_visible((5, 5, 5), (5, 5, 5)) is True

    def test_bvh_handles_multiple_triangles(self):
        far_triangles = [
            Triangle(
                Vector3(1000 + i, 1000, 1000),
                Vector3(1001 + i, 1000, 1000),
                Vector3(1000 + i, 1001, 1000),
            )
            for i in range(5)
        ]
        checker = VisibilityChecker(triangles=[*far_triangles, _wall_blocking_y_axis()])
        assert checker.n_triangles == 6
        assert checker.is_visible((0, 0, 0), (0, 100, 0)) is False
        assert checker.is_visible((0, 0, 0), (0, 10, 0)) is True


class TestKV3ParserMalformedInput:
    def test_content_with_no_bracket_and_no_newline_terminates_instead_of_hanging(self):
        # Regression test for an infinite loop in upstream awpy: content with
        # no "{" and no further "\n" made find("\n", ...) return -1 forever,
        # wrapping self.index back to 0 on every iteration. See the comment
        # on _skip_until_first_bracket and THIRD_PARTY_NOTICE.md.
        parser = KV3Parser()
        parser.parse("not valid KV3 data at all")
        assert parser.get_value("anything") == ""

    def test_empty_object_yields_no_values(self):
        parser = KV3Parser()
        parser.parse("{}")
        assert parser.get_value("anything") == ""


class TestTriFileRoundTrip:
    def test_read_tri_file_round_trips_triangles(self, tmp_path):
        triangles = [
            Triangle(Vector3(0, 0, 0), Vector3(1, 0, 0), Vector3(0, 1, 0)),
            Triangle(Vector3(2, 2, 2), Vector3(3, 2, 2), Vector3(2, 3, 2)),
        ]
        tri_path = tmp_path / "test.tri"
        _write_tri_file(tri_path, triangles)

        loaded = VisibilityChecker.read_tri_file(tri_path)

        assert len(loaded) == 2
        assert loaded[0].p1 == Vector3(0, 0, 0)
        assert loaded[1].p3 == Vector3(2, 3, 2)

    def test_visibility_checker_loads_from_tri_file(self, tmp_path):
        tri_path = tmp_path / "wall.tri"
        _write_tri_file(tri_path, [_wall_blocking_y_axis()])

        checker = VisibilityChecker(path=tri_path)
        assert checker.is_visible((0, 0, 0), (0, 100, 0)) is False
