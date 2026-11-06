"""Builds small gaze logs by hand for the unit tests."""

import pandas as pd

from pipeline.clean import add_timing


def rows(*looks: tuple) -> pd.DataFrame:
    """Each look is (user_id, object_id, gaze_time, seconds after 2026-05-06 13:00:00)."""
    base = pd.Timestamp("2026-05-06 13:00:00")
    frame = pd.DataFrame(
        [
            {
                "user_id": user,
                "log_session": 0,
                "object_id": name,
                "gaze_time": gaze,
                "time_stamp": base + pd.Timedelta(seconds=offset),
                "row": index,
            }
            for index, (user, name, gaze, offset) in enumerate(looks)
        ]
    )
    frame["epoch"] = (frame.time_stamp - pd.Timestamp("1970-01-01")).dt.total_seconds()
    return frame


def timed_session(*looks: tuple) -> pd.DataFrame:
    """Timed rows in one session. Each look is (lane, object_id, gaze_time, seconds)."""
    frame = add_timing(rows(*[(1, name, gaze, offset) for _, name, gaze, offset in looks]))
    frame["lane"] = [look[0] for look in looks]
    frame["session_id"] = "u1-s1"
    return frame
