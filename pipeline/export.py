"""Builds the JSON files the app reads. The formats are in app/src/types.ts."""

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from . import config
from .clean import add_timing, drop_test_user, join_lanes
from .sessions import assign_team_runs, keep_long_sessions, session_spans, split_sessions
from .visits import at_least, merge_visits


def _iso(epoch: float) -> str:
    return pd.to_datetime(epoch, unit="s").strftime("%Y-%m-%dT%H:%M:%S")


def _epoch(iso: str) -> float:
    return (pd.Timestamp(iso) - pd.Timestamp("1970-01-01")).total_seconds()


def _step(step: str, rows: int, seconds: float, note: str) -> dict:
    return {"step": step, "rows": int(rows), "seconds": round(float(seconds), 1), "note": note}


def _meta(lane_map: pd.DataFrame, source: str, unmapped: list[str]) -> dict:
    lanes = [
        {"id": lane, "label": lane, "order": order, "include": include, "color": color, "band": band}
        for order, (lane, include, color, band) in enumerate(config.LANES)
    ]
    objects = {
        row.object_id: {"lane": row.lane, "verify": row.confidence == "verify"}
        for row in lane_map.itertuples()
    }
    if unmapped:
        lanes.append(
            {
                "id": config.UNMAPPED_LANE,
                "label": config.UNMAPPED_LANE,
                "order": len(lanes),
                "include": False,
                "color": config.BACKGROUND_COLOR,
                "band": config.BACKGROUND_COLOR,
            }
        )
        objects.update({name: {"lane": config.UNMAPPED_LANE, "verify": True} for name in unmapped})
    return {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": source,
        "params": config.params(),
        "lanes": lanes,
        "objects": objects,
    }


def _session_records(kept: pd.DataFrame, rows: pd.DataFrame) -> list[dict]:
    records = []
    for span in kept.itertuples():
        own = rows[rows.session_id == span.session_id]
        active = own[~own.idle]
        # The window covers real looks, but not an idle row's long reach backwards.
        start = math.floor(min(span.first, active.start_s.min()))
        end = math.ceil(max(span.last, active.end_s.max()))
        sheets = sorted(set(active.object_id[active.object_id.str.startswith("CodeSheet")]))
        records.append(
            {
                "id": span.session_id,
                "userId": int(span.user_id),
                "runId": span.run_id,
                "start": _iso(start),
                "end": _iso(end),
                "durationMin": round((end - start) / 60, 2),
                "rawRows": len(own),
                "idleSeconds": round(float(own[own.idle].gaze_time.sum()), 1),
                "activeSeconds": round(float(active.gaze_time.sum()), 1),
                "inferredHints": [f"{sheet} seen" for sheet in sheets],
            }
        )
    return records


def _run_records(sessions: list[dict]) -> list[dict]:
    runs: dict[str, list[dict]] = {}
    for session in sessions:
        runs.setdefault(session["runId"], []).append(session)
    records = []
    for run_id, members in runs.items():
        start = min(member["start"] for member in members)
        records.append(
            {
                "id": run_id,
                "date": start[:10],
                "start": start,
                "end": max(member["end"] for member in members),
                "sessionIds": [member["id"] for member in members],
                "userIds": sorted({member["userId"] for member in members}),
            }
        )
    return sorted(records, key=lambda run: run["start"])


def default_run(runs: list[dict]) -> dict:
    """The earliest full-length run with the most learners, as the app picks it."""
    full = [
        run for run in runs if _epoch(run["end"]) - _epoch(run["start"]) >= config.MIN_DEFAULT_RUN_S
    ]
    return sorted(full or runs, key=lambda run: (-len(run["userIds"]), run["start"]))[0]


def _idle_records(rows: pd.DataFrame, sessions: list[dict]) -> list[dict]:
    """Clipped to the session, because an idle row's start can reach far before it."""
    windows = {s["id"]: (_epoch(s["start"]), _epoch(s["end"]), s["userId"]) for s in sessions}
    records = []
    for row in rows[rows.idle].itertuples():
        first, last, user = windows[row.session_id]
        start, end = max(row.start_s, first), min(row.end_s, last)
        if end - start > 1:
            records.append(
                {
                    "sessionId": row.session_id,
                    "userId": user,
                    "start": round(start, 3),
                    "end": round(end, 3),
                }
            )
    return records


def build_outputs(raw: pd.DataFrame, lane_map: pd.DataFrame, source: str) -> dict:
    """Runs every pipeline step and returns {file name: JSON-ready content}."""
    logged = float(raw.gaze_time.sum())
    no_test = drop_test_user(raw)
    timed = add_timing(no_test)
    idle_rows = timed[timed.idle]
    idle_seconds = float(idle_rows.gaze_time.sum())

    split = split_sessions(timed)
    session_count = len(session_spans(split))
    named, kept = keep_long_sessions(split)
    kept = assign_team_runs(kept)
    named = join_lanes(named.sort_values(["user_id", "epoch", "row"], kind="stable"), lane_map)
    unmapped = sorted(set(named.object_id[named.lane == config.UNMAPPED_LANE]))

    active = named[~named.idle]
    included = active[active.include]

    lane_visits = at_least(merge_visits(included, "lane"), config.EXPORT_MIN_VISIT_S)
    object_visits = at_least(merge_visits(included, "object_id"), config.EXPORT_MIN_VISIT_S)
    lane_of = dict(zip(included.object_id, included.lane))
    session_info = kept.set_index("session_id")

    sessions = _session_records(kept, named)
    runs = _run_records(sessions)
    main_run = default_run(runs)
    main_rows = named[named.session_id.isin(main_run["sessionIds"])].sort_values("row")

    def identity(visit: dict) -> dict:
        info = session_info.loc[visit["session_id"]]
        return {"sessionId": visit["session_id"], "userId": int(info.user_id), "runId": info.run_id}

    funnel = [
        _step(
            "Raw log", len(raw), logged,
            f"Every row in the file, across {raw.object_id.nunique()} objects.",
        ),
        _step(
            "Test user removed", len(no_test), no_test.gaze_time.sum(),
            f"Removed {len(raw) - len(no_test)} rows from user 0, a test account.",
        ),
        _step(
            "Idle periods removed", len(timed) - len(idle_rows),
            no_test.gaze_time.sum() - idle_seconds,
            f"Removed {len(idle_rows)} idle rows, which were {idle_seconds / logged:.0%} of all logged time.",
        ),
        _step(
            "Short sessions dropped", len(active), active.gaze_time.sum(),
            f"Kept {len(kept)} of {session_count} sessions that ran at least {config.MIN_SESSION_MIN} minutes.",
        ),
        _step(
            "Lanes of interest", len(included), included.gaze_time.sum(),
            "Dropped walls, room colliders, the bed and the learner's own hands.",
        ),
        _step(
            "Merged into lane visits", len(lane_visits), sum(v["dwell"] for v in lane_visits),
            "Joined consecutive looks at the same lane into one visit.",
        ),
    ]

    return {
        "meta": _meta(lane_map, source, unmapped),
        "funnel": funnel,
        "sessions": sessions,
        "runs": runs,
        "visits": [
            {
                **identity(v),
                "lane": v["key"],
                "start": round(v["start"], 3),
                "end": round(v["end"], 3),
                "dwell": round(v["dwell"], 3),
                "objects": {name: round(seconds, 3) for name, seconds in v["objects"].items()},
            }
            for v in lane_visits
        ],
        "object_visits": [
            {
                **identity(v),
                "objectId": v["key"],
                "lane": lane_of[v["key"]],
                "start": round(v["start"], 3),
                "end": round(v["end"], 3),
                "dwell": round(v["dwell"], 3),
            }
            for v in object_visits
        ],
        "idle": _idle_records(named, sessions),
        "raw_sample": [
            {
                "user_id": int(row.user_id),
                "session_id": int(row.log_session),
                "object_id": row.object_id,
                "gaze_time": row.gaze_time,
                "time_stamp": row.time_stamp.strftime("%Y-%m-%d %H:%M:%S"),
            }
            for row in main_rows.head(config.RAW_SAMPLE_ROWS).itertuples()
        ],
    }


def write_outputs(outputs: dict, folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for name, content in outputs.items():
        (folder / f"{name}.json").write_text(json.dumps(content), encoding="utf-8")
