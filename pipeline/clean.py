"""Row-level steps: drop the test user, work out timing, mark idle rows, join lanes."""

import pandas as pd

from . import config


def drop_test_user(rows: pd.DataFrame) -> pd.DataFrame:
    return rows[rows.user_id != 0]


def add_timing(rows: pd.DataFrame, idle_max_s: float = config.IDLE_MAX_S) -> pd.DataFrame:
    """A row is written when the ray leaves an object, so its timestamp is the end of the look."""
    timed = rows.sort_values(["user_id", "epoch", "row"], kind="stable").copy()
    timed["end_s"] = timed.epoch + 0.5
    timed["start_s"] = timed.end_s - timed.gaze_time
    timed["idle"] = timed.gaze_time > idle_max_s
    return timed


def join_lanes(rows: pd.DataFrame, lane_map: pd.DataFrame) -> pd.DataFrame:
    """Adds lane and include. Objects missing from the map become Unmapped and are excluded."""
    lookup = lane_map.set_index("object_id")
    joined = rows.copy()
    joined["lane"] = joined.object_id.map(lookup.lane).fillna(config.UNMAPPED_LANE)
    joined["include"] = joined.object_id.map(lookup.include).fillna(False).astype(bool)
    unknown = sorted(set(rows.object_id) - set(lookup.index))
    if unknown:
        print(f"WARNING: {len(unknown)} objects are not in the lane map: {', '.join(unknown)}")
    return joined
