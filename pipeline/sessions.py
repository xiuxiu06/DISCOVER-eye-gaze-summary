"""Splits each learner's rows into sessions, then groups sessions into team runs."""

import pandas as pd

from . import config


def split_sessions(rows: pd.DataFrame, gap_s: float = config.SESSION_GAP_S) -> pd.DataFrame:
    """Adds raw_session, a per-user counter. Expects rows sorted by user and time."""
    split = rows.copy()
    gaps = split.groupby("user_id").epoch.diff()
    split["raw_session"] = (gaps.isna() | (gaps > gap_s)).groupby(split.user_id).cumsum()
    return split


def session_spans(rows: pd.DataFrame) -> pd.DataFrame:
    """One row per session with first and last timestamp and duration in seconds."""
    spans = rows.groupby(["user_id", "raw_session"]).epoch.agg(first="min", last="max").reset_index()
    spans["duration_s"] = spans["last"] - spans["first"]
    return spans


def keep_long_sessions(
    rows: pd.DataFrame, min_minutes: float = config.MIN_SESSION_MIN
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Drops short sessions and names the rest u{user}-s{n}. Returns (rows, sessions)."""
    spans = session_spans(rows)
    kept = spans[spans.duration_s >= min_minutes * 60].copy()
    kept["session_id"] = [
        f"u{user}-s{n + 1}"
        for user, group in kept.groupby("user_id", sort=False)
        for n in range(len(group))
    ]
    named = rows.merge(
        kept[["user_id", "raw_session", "session_id"]], on=["user_id", "raw_session"]
    )
    return named, kept


def assign_team_runs(
    spans: pd.DataFrame, overlap_frac: float = config.TEAM_OVERLAP_FRAC
) -> pd.DataFrame:
    """A session joins the current run if enough of it overlaps the run's window."""
    current: dict | None = None
    run_of: dict[str, str] = {}
    for session in spans.sort_values("first", kind="stable").itertuples():
        if current is not None and session.duration_s > 0:
            overlap = min(session.last, current["end"]) - max(session.first, current["start"])
            if max(0, overlap) / session.duration_s >= overlap_frac:
                current["end"] = max(current["end"], session.last)
                run_of[session.session_id] = current["id"]
                continue
        when = pd.to_datetime(session.first, unit="s")
        current = {
            "id": f"run-{when:%Y-%m-%d}-{when:%H%M}",
            "start": session.first,
            "end": session.last,
        }
        run_of[session.session_id] = current["id"]
    with_runs = spans.copy()
    with_runs["run_id"] = with_runs.session_id.map(run_of)
    return with_runs
