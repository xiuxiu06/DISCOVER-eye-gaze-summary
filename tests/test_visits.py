import pandas as pd
import pytest

from pipeline.visits import at_least, merge_visits
from tests.helpers import timed_session

MONITOR = "Vital sign monitor"
PATIENT = "Patient assessment"


def test_merges_when_the_gap_is_within_the_limit():
    # First look ends at 10.5. The second starts at 11.5, so the gap is exactly 1 s.
    looks = timed_session((MONITOR, "RR", 1.0, 10), (MONITOR, "SPO2", 1.0, 12))
    visits = merge_visits(looks, "lane", gap_s=1.0)
    assert len(visits) == 1
    assert visits[0]["start"] == 9.5 + looks.epoch.iloc[0] - 10
    assert visits[0]["dwell"] == 2.0
    assert visits[0]["objects"] == {"RR": 1.0, "SPO2": 1.0}


def test_splits_when_the_gap_is_over_the_limit():
    looks = timed_session((MONITOR, "RR", 1.0, 10), (MONITOR, "RR", 1.0, 13))
    assert len(merge_visits(looks, "lane", gap_s=1.0)) == 2


def test_a_background_row_removed_first_does_not_split_a_visit():
    looks = timed_session(
        (MONITOR, "RR", 1.0, 10),
        ("Environment", "RoomCollider2", 0.1, 11),
        (MONITOR, "RR", 1.0, 12),
    )
    assert len(merge_visits(looks, "lane", gap_s=1.0)) == 3
    assert len(merge_visits(looks[looks.lane == MONITOR], "lane", gap_s=1.0)) == 1


def test_a_different_lane_splits_a_visit():
    looks = timed_session(
        (MONITOR, "RR", 1.0, 10), (PATIENT, "Liver", 1.0, 11), (MONITOR, "RR", 1.0, 12)
    )
    assert [visit["key"] for visit in merge_visits(looks, "lane")] == [MONITOR, PATIENT, MONITOR]


def test_object_visits_split_on_a_different_object_in_the_same_lane():
    looks = timed_session((MONITOR, "RR", 1.0, 10), (MONITOR, "SPO2", 1.0, 11))
    assert len(merge_visits(looks, "lane")) == 1
    assert [visit["key"] for visit in merge_visits(looks, "object_id")] == ["RR", "SPO2"]


def test_sessions_are_never_merged_together():
    first = timed_session((MONITOR, "RR", 1.0, 10))
    second = timed_session((MONITOR, "RR", 1.0, 11))
    second["session_id"] = "u1-s2"
    assert len(merge_visits(pd.concat([first, second]), "lane")) == 2


@pytest.mark.parametrize("minimum, expected", [(0.5, 2), (0.51, 1)])
def test_threshold_is_inclusive(minimum, expected):
    assert len(at_least([{"dwell": 0.5}, {"dwell": 1.0}], minimum)) == expected
