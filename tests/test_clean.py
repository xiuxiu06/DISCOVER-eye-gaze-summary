import pandas as pd

from pipeline.clean import add_timing, drop_test_user, join_lanes
from pipeline.lane_map import classify
from pipeline.sessions import assign_team_runs, keep_long_sessions, split_sessions
from tests.helpers import rows


def test_drops_only_the_test_user():
    log = rows((0, "Middle", 0.1, 0), (1, "RR", 0.1, 0))
    assert drop_test_user(log).user_id.tolist() == [1]


def test_timestamp_marks_the_end_of_the_look():
    timed = add_timing(rows((1, "RR", 2.0, 10)))
    assert timed.end_s.iloc[0] - timed.epoch.iloc[0] == 0.5
    assert timed.end_s.iloc[0] - timed.start_s.iloc[0] == 2.0


def test_idle_is_strictly_over_the_threshold():
    timed = add_timing(rows((1, "RR", 30.0, 0), (1, "RR", 30.1, 100)))
    assert timed.idle.tolist() == [False, True]


def test_sorting_keeps_file_order_within_a_second():
    timed = add_timing(rows((1, "B", 0.1, 5), (1, "C", 0.1, 5), (1, "A", 0.1, 1)))
    assert timed.object_id.tolist() == ["A", "B", "C"]


def test_session_splits_only_when_the_gap_is_over_the_limit():
    timed = add_timing(rows((1, "A", 1, 0), (1, "A", 1, 300), (1, "A", 1, 601), (2, "A", 1, 602)))
    split = split_sessions(timed)
    assert split.raw_session.tolist() == [1, 1, 2, 1]


def test_short_sessions_are_dropped_and_the_rest_named():
    timed = add_timing(rows((1, "A", 1, 0), (1, "A", 1, 100), (1, "A", 1, 1000), (1, "A", 1, 1250), (1, "A", 1, 1300)))
    named, kept = keep_long_sessions(split_sessions(timed))
    assert kept.session_id.tolist() == ["u1-s1"]
    assert len(named) == 3


def test_team_run_needs_enough_overlap():
    spans = pd.DataFrame(
        {
            "session_id": ["a", "b", "c"],
            "first": [0.0, 100.0, 900.0],
            "last": [1000.0, 1200.0, 2000.0],
            "duration_s": [1000.0, 1100.0, 1100.0],
        }
    )
    runs = assign_team_runs(spans)
    assert runs.run_id.iloc[0] == runs.run_id.iloc[1]
    assert runs.run_id.iloc[2] != runs.run_id.iloc[0]


def test_unknown_objects_become_unmapped_and_excluded(capsys):
    lane_map = pd.DataFrame({"object_id": ["RR"], "lane": ["Vital sign monitor"], "include": [True]})
    joined = join_lanes(add_timing(rows((1, "RR", 1, 0), (1, "Mystery", 1, 5))), lane_map)
    assert joined.lane.tolist() == ["Vital sign monitor", "Unmapped"]
    assert joined.include.tolist() == [True, False]
    assert "Mystery" in capsys.readouterr().out


def test_lane_map_keeps_objects_the_summary_tool_filters_out():
    assert classify("HeadFollower") == ("Communication", "verify")
    assert classify("TeenLeftHandIK") == ("Patient assessment", "verify")
    assert classify("RoomCollider2")[0] == "Environment"
    assert classify("RobotHandL")[0] == "Self"
