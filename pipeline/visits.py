"""Merges consecutive looks at the same lane or object into visits."""

from collections import Counter

import pandas as pd

from . import config


def merge_visits(rows: pd.DataFrame, key: str, gap_s: float = config.MERGE_GAP_S) -> list[dict]:
    """Merges rows within each session by `key`. Pass included, non-idle rows only.

    Background rows must already be gone, so a glance at a wall between two
    monitor looks doesn't split the visit. Expects rows sorted by time.
    """
    visits: list[dict] = []
    for session_id, group in rows.groupby("session_id", sort=False):
        current: dict | None = None
        for value, start, end, gaze, object_id in zip(
            group[key], group.start_s, group.end_s, group.gaze_time, group.object_id
        ):
            if current and current["key"] == value and start - current["end"] <= gap_s:
                current["start"] = min(current["start"], start)
                current["end"] = max(current["end"], end)
                current["dwell"] += gaze
                current["objects"][object_id] += gaze
            else:
                current = {
                    "session_id": session_id,
                    "key": value,
                    "start": start,
                    "end": end,
                    "dwell": gaze,
                    "objects": Counter({object_id: gaze}),
                }
                visits.append(current)
    return visits


def at_least(visits: list[dict], min_s: float) -> list[dict]:
    return [visit for visit in visits if visit["dwell"] >= min_s]
