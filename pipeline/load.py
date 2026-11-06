"""Reads the gaze log with the file reader from summarize_gaze.py."""

from pathlib import Path

import pandas as pd

from summarize_gaze import read_gaze_file

# log_session is the log's own session_id, which is always 0. Real sessions come from time gaps.
COLUMNS = ["user_id", "log_session", "object_id", "gaze_time", "time_stamp", "row"]


def load_rows(path: Path) -> pd.DataFrame:
    """One row per log line, in file order. The log's clock is treated as UTC."""
    rows = read_gaze_file(path)
    frame = pd.DataFrame(
        [
            (int(r.user_id), int(r.session_id), r.object_id, r.gaze_time, r.timestamp, r.row_order)
            for r in rows
        ],
        columns=COLUMNS,
    )
    frame["epoch"] = (frame.time_stamp - pd.Timestamp("1970-01-01")).dt.total_seconds()
    return frame
