#!/usr/bin/env python3
"""
DISCOVER Eye-Gaze Summary Tool

Reads raw VR eye-gaze Excel (.xlsx/.xlsm) or CSV/TSV exports from the Cincinnati
Children's DISCOVER simulation platform, filters out irrelevant background/body/rig
colliders, optionally condenses similar object variants dynamically, and outputs a
clean JSON file summarizing:
  1. All unique relevant objects present in the dataset (`relevant_objects`)
  2. Each user's second-by-second dominant relevant gaze target (`user1`, `user2`, ...)
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, replace
from datetime import date, datetime, time as dt_time, timedelta
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable, Iterator

import openpyxl
from openpyxl.utils.datetime import from_excel as datetime_from_excel

# Irrelevant VR environment, room fixtures, avatar rigging, and player hand/finger colliders.
DEFAULT_IRRELEVANT_OBJECTS: frozenset[str] = frozenset(
    {
        # Player VR body & hands (AutoHand)
        "AutoHandPlayer",
        "HeadFollower",
        "RobotHandR",
        "RobotHandL",
        "Thumb",
        "Thumb1",
        "Thumb2",
        "Index",
        "Index1",
        "Index2",
        "Middle",
        "Middle1",
        "Middle2",
        "Ring",
        "Ring1",
        "Ring2",
        "Pinky",
        "Pinky1",
        "Pinky2",
        # Room boundaries, walls, doors, windows, lighting, and non-clinical fixtures
        "Floor",
        "Bckground",
        "LoadingScreen",
        "RoomCollider",
        "RoomCollider1",
        "RoomCollider2",
        "RoomCollider3",
        "RoomCollider4",
        "RoomCollider5",
        "RoomCollider6",
        "Room_cube_wall",
        "Room_frame",
        "PassthroughDoor",
        "Hinge",
        "Knob",
        "PushPull",
        "glass_panel",
        "curved_counter",
        "Sink",
        "Light",
        "LightBulb1",
        "LightBulb2",
        "LightBulb3",
        "LightBulb6",
        "LightBulb7",
        "boomLight",
        # Generic Unity primitives & XR UI chrome
        "Collider",
        "ColliderCube1",
        "ColliderCube2",
        "Cube100",
        "Cube_2",
        "SpatialPanelManipulator",
        # Internal Unity avatar IK targets, grab helpers, and physics blockers
        "chestRubBlocker",
        "FakeTube",
        "LeftArmIK",
        "RightArmIK",
        "LeftLegIK",
        "RightLegIK",
        "TeenLeftFootIK",
        "TeenLeftHandIK",
        "TeenRightFootIK",
        "TeenRIghtHandIK",
        "LeftArmGrabWrist",
        "LeftLegGrabAnkle",
        "RightArmGrab",
        "RightArmGrabWrist",
        "RightLegGrabAnkle",
        "TriggerChestL",
        "TriggerChestR",
    }
)

# Scalable regex patterns so numbered variants in future scenarios (e.g., LightBulb4, RoomCollider7, Cube101)
# are also automatically filtered out without needing manual updates.
DEFAULT_IRRELEVANT_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^RoomCollider\d*$", re.IGNORECASE),
    re.compile(r"^ColliderCube\d*$", re.IGNORECASE),
    re.compile(r"^Cube_?\d+$", re.IGNORECASE),
    re.compile(r"^LightBulb\d*$", re.IGNORECASE),
    re.compile(r"^RobotHand[LR]?$", re.IGNORECASE),
    re.compile(r"^(Thumb|Index|Middle|Ring|Pinky)\d*$", re.IGNORECASE),
    re.compile(r".+IK$"),  # Unity Inverse Kinematics rig targets (e.g., TeenLeftHandIK, LeftArmIK)
)

# Directional & generic modifier tokens used by the dynamic object condenser.
_DIRECTIONAL_PREFIXES: frozenset[str] = frozenset(
    {"left", "right", "upper", "lower", "inner", "outer"}
)
_GENERIC_MODIFIER_PREFIXES: frozenset[str] = frozenset(
    {"new", "old", "small", "large", "big", "top", "bottom", "front", "back"}
)

# Supported timestamp string formats when cells are stored as text rather than native Excel datetimes.
_TIMESTAMP_FORMATS: tuple[str, ...] = (
    "%m/%d/%Y %I:%M:%S %p",
    "%m/%d/%Y %I:%M:%S.%f %p",
    "%m/%d/%Y %H:%M:%S",
    "%m/%d/%Y %H:%M:%S.%f",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M:%S.%f",
    "%Y-%m-%d %I:%M:%S %p",
    "%m/%d/%Y %I:%M %p",
    "%m/%d/%Y %H:%M",
    "%Y-%m-%d %H:%M",
    "%m/%d/%y %I:%M:%S %p",
    "%m/%d/%y %H:%M:%S",
    "%m/%d/%y %H:%M",
)

# Header aliases normalized (lowercased, underscores/spaces removed) -> canonical column name.
_HEADER_ALIASES: dict[str, str] = {
    "userid": "user_id",
    "user": "user_id",
    "sessionid": "session_id",
    "session": "session_id",
    "objectid": "object_id",
    "object": "object_id",
    "gazetime": "gaze_time",
    "duration": "gaze_time",
    "timestamp": "time_stamp",
    "time": "time_stamp",
}

REQUIRED_COLUMNS: frozenset[str] = frozenset({"user_id", "object_id", "gaze_time", "time_stamp"})


@dataclass(slots=True)
class GazeRow:
    """Single raw eye-gaze event row."""

    user_id: str
    session_id: str
    object_id: str
    gaze_time: float
    timestamp: datetime
    row_order: int


def is_irrelevant_object(
    object_id: str,
    irrelevant_lower: set[str],
    use_default_patterns: bool = True,
) -> bool:
    """Return True if `object_id` should be ignored as non-clinical VR/environment noise."""
    cleaned = object_id.strip()
    if not cleaned or cleaned.lower() in irrelevant_lower:
        return True
    if use_default_patterns:
        for pattern in DEFAULT_IRRELEVANT_PATTERNS:
            if pattern.match(cleaned):
                return True
    return False


def _tokenize_with_segments(name: str) -> tuple[list[str], set[int]]:
    """
    Split an identifier on underscores/hyphens and CamelCase/PascalCase boundaries,
    dropping trailing numeric/unit suffixes (e.g., `1`, `2`, `100`, `37kg`) once at least
    one word token has been parsed. Also returns the token indices corresponding to
    explicit underscore/hyphen segment boundaries.
    """
    parts = [p for p in re.split(r"[_\-\s]+", name.strip()) if p]
    tokens: list[str] = []
    boundaries: set[int] = set()

    for part in parts:
        # Keep short uppercase+digit clinical codes intact (e.g., T3, SPO2, S1, O2)
        if re.fullmatch(r"[A-Z]{1,4}\d+", part):
            tokens.append(part)
        # Keep camel-prefixed acronyms intact while stripping trailing instance digits (e.g., eCPR1 -> eCPR)
        elif re.fullmatch(r"[a-z][A-Z]{2,}\d*", part):
            tokens.append(re.sub(r"\d+$", "", part))
        else:
            sub = re.findall(
                r"[A-Z]{1,4}\d+(?=[A-Z][a-z]|$)|[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+[a-zA-Z]*",
                part,
            )
            for s in sub:
                if tokens and re.fullmatch(r"\d+(?:kg|mg|ml|cm|mm|g|l)?", s, flags=re.IGNORECASE):
                    continue
                tokens.append(s)
        if tokens:
            boundaries.add(len(tokens))

    if not tokens:
        return [name.strip()], {1}
    return tokens, boundaries


def _normalize_stem_token(token: str) -> str:
    low = token.lower()
    if len(low) > 4 and low.endswith("s") and not low.endswith("ss"):
        return low[:-1]
    return low


def build_condense_mapping(object_names: Iterable[str]) -> dict[str, str]:
    """
    Dynamically group similar object identifiers into clean canonical category names
    without hardcoding domain-specific prefixes.

    Examples discovered automatically from token structure:
      - `Stryker_bed_*` (+ typo `Styker_bed_*`) -> `Stryker_bed`
      - `T3_monitor_screen_S1PennyScreen`, `...S2HarrietScreen` -> `T3_monitor_screen`
      - `Nasal_Canula_*`, `NasalCanula_Snap` -> `Nasal_Canula`
      - `CodeSheet37kg`, `CodeSheet46kg`, `CodeSheet5kg` -> `CodeSheet`
      - `LeftEye`, `RightEye` -> `Eye`
      - `ThermometerSnap*`, `thermometer_body`, `thermometer_needle` -> `Thermometer`
    """
    unique_names = sorted({n.strip() for n in object_names if n and n.strip()})
    if not unique_names:
        return {}

    parsed = {name: _tokenize_with_segments(name) for name in unique_names}
    tokenized = {name: p[0] for name, p in parsed.items()}
    boundaries = {name: p[1] for name, p in parsed.items()}
    normed = {name: [_normalize_stem_token(t) for t in toks] for name, toks in tokenized.items()}

    # Strip leading anatomical laterality prefixes (e.g., LeftEye / RightEye -> Eye) when paired
    effective_tokens: dict[str, list[str]] = {}
    effective_normed: dict[str, list[str]] = {}
    stripped_directional: set[str] = set()
    for name in unique_names:
        nt = normed[name]
        toks = tokenized[name]
        if nt[0] in _DIRECTIONAL_PREFIXES and len(nt) >= 2:
            effective_tokens[name] = toks[1:]
            effective_normed[name] = nt[1:]
            stripped_directional.add(name)
        else:
            effective_tokens[name] = toks
            effective_normed[name] = nt

    groups: dict[tuple[str, ...], list[str]] = defaultdict(list)
    for name in unique_names:
        ent = effective_normed[name]
        if ent[0] in _GENERIC_MODIFIER_PREFIXES and len(ent) >= 2:
            key: tuple[str, ...] = (ent[0], ent[1])
        else:
            key = (ent[0],)
        groups[key].append(name)

    multi_keys = [k for k, members in groups.items() if len(members) >= 2]
    fuzzy_merged: set[str] = set()

    # 1. Catch minor spelling typos on leading tokens when the second token matches (e.g. Styker_bed_* -> Stryker_bed_*)
    for key in list(groups.keys()):
        members = groups[key]
        if len(members) != 1 or len(key) != 1 or len(key[0]) < 5:
            continue
        solo = members[0]
        solo_nt = effective_normed[solo]
        if len(solo_nt) < 2:
            continue
        for mk in multi_keys:
            if len(mk) != 1 or len(mk[0]) < 5:
                continue
            rep_nt = effective_normed[groups[mk][0]]
            if len(rep_nt) >= 2 and solo_nt[1] == rep_nt[1]:
                if SequenceMatcher(None, solo_nt[0], mk[0]).ratio() >= 0.84:
                    groups[mk].extend(members)
                    fuzzy_merged.add(solo)
                    del groups[key]
                    break

    # 2. Merge compound shape/qualifier variants whose trailing >=2 tokens match a multi-item group member
    #    (e.g., CapsulePulseHaptics -> ["pulse", "haptic"] merges into PulseHaptics group)
    member_norm_lookup: dict[tuple[str, ...], tuple[str, ...]] = {}
    for mk in multi_keys:
        for m in groups.get(mk, []):
            nt_tuple = tuple(effective_normed[m])
            if len(nt_tuple) >= 2:
                member_norm_lookup[nt_tuple] = mk

    for key in list(groups.keys()):
        members = groups[key]
        if len(members) != 1:
            continue
        solo = members[0]
        solo_nt = effective_normed[solo]
        if len(solo_nt) >= 3:
            suffix = tuple(solo_nt[1:])
            if suffix in member_norm_lookup:
                target_mk = member_norm_lookup[suffix]
                groups[target_mk].append(solo)
                fuzzy_merged.add(solo)
                del groups[key]

    mapping: dict[str, str] = {}
    for key, members in sorted(groups.items()):
        if len(members) == 1:
            # Singletons stay untouched (preserving exact original name)
            mapping[members[0]] = members[0]
            continue

        core_members = [m for m in members if m not in fuzzy_merged] or members
        member_norm = [effective_normed[m] for m in core_members]
        max_possible = min(len(nt) for nt in member_norm)

        # Compute Longest Common Token Prefix across the group (up to 3 tokens)
        lcp_len = 1
        for i in range(1, min(3, max_possible)):
            if len({nt[i] for nt in member_norm}) == 1:
                lcp_len = i + 1
            else:
                break

        # Avoid cutting halfway through a CamelCase underscore-segment (e.g., keep `linetBed` rather than `linetBed_gray`)
        non_dir_core = [m for m in core_members if m not in stripped_directional]
        if lcp_len > 1 and non_dir_core and any("_" in m for m in non_dir_core):
            while lcp_len > 1 and not all(
                (lcp_len in boundaries[m] or "_" not in m) for m in non_dir_core
            ):
                lcp_len -= 1

        prefix_candidates: Counter[str] = Counter()
        for m in core_members:
            toks = effective_tokens[m][:lcp_len]
            if m not in stripped_directional and "_" in m and lcp_len > 1 and 1 in boundaries[m]:
                cand = "_".join(toks)
            elif lcp_len == 1:
                cand = toks[0]
            else:
                cand = toks[0] + "".join(t[0].upper() + t[1:] for t in toks[1:])
            prefix_candidates[cand] += 1

        label = sorted(
            prefix_candidates.items(),
            key=lambda kv: (-kv[1], not kv[0][0].isupper(), kv[0]),
        )[0][0]

        for m in members:
            mapping[m] = label

    return mapping


def _normalize_header_name(raw: Any) -> str:
    if raw is None:
        return ""
    cleaned = re.sub(r"[\s_\-]+", "", str(raw).strip().lower())
    return _HEADER_ALIASES.get(cleaned, cleaned)


def parse_timestamp(value: Any) -> datetime | None:
    """Convert an Excel cell value or string into a Python datetime."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, dt_time.min)
    if isinstance(value, (int, float)):
        if math.isnan(value) or math.isinf(value):
            return None
        try:
            converted = datetime_from_excel(value)
            if isinstance(converted, datetime):
                return converted
            if isinstance(converted, date):
                return datetime.combine(converted, dt_time.min)
        except (ValueError, OverflowError, TypeError):
            return None

    text = " ".join(str(value).strip().split())
    if not text:
        return None

    try:
        return datetime.fromisoformat(text)
    except ValueError:
        pass

    for fmt in _TIMESTAMP_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue

    return None


def format_user_key(raw_user_id: Any) -> tuple[tuple[int, int | str], str]:
    """
    Return `(sort_key, formatted_user_key)` so numeric IDs format as `user1`, `user2`, ...
    and sort numerically (`user1`, `user2`, ..., `user10`).
    """
    text = str(raw_user_id).strip()

    try:
        num = float(text)
        if num.is_integer():
            uid_int = int(num)
            return ((0, uid_int), f"user{uid_int}")
    except ValueError:
        pass

    match = re.fullmatch(r"user[\s_\-]*(\d+)", text, flags=re.IGNORECASE)
    if match:
        uid_int = int(match.group(1))
        return ((0, uid_int), f"user{uid_int}")

    if text.lower().startswith("user"):
        return ((1, text.lower()), text)
    return ((1, text.lower()), f"user_{text}")


def _map_header_indices(header_row: Iterable[Any]) -> dict[str, int] | None:
    col_map: dict[str, int] = {}
    for idx, cell in enumerate(header_row):
        canonical = _normalize_header_name(cell)
        if canonical and canonical not in col_map:
            col_map[canonical] = idx
    if REQUIRED_COLUMNS.issubset(col_map.keys()):
        return col_map
    return None


def _parse_raw_sequence(
    rows_iter: Iterator[tuple[Any, ...]],
    start_order: int = 0,
) -> tuple[list[GazeRow], int]:
    """Parse rows from a single sheet/table that begins with a header row."""
    col_map: dict[str, int] | None = None
    for candidate_row in rows_iter:
        if not candidate_row or all(c is None or str(c).strip() == "" for c in candidate_row):
            continue
        col_map = _map_header_indices(candidate_row)
        if col_map is not None:
            break

    if col_map is None:
        return [], start_order

    idx_user = col_map["user_id"]
    idx_session = col_map.get("session_id")
    idx_obj = col_map["object_id"]
    idx_gaze = col_map["gaze_time"]
    idx_ts = col_map["time_stamp"]
    max_needed_idx = max(
        idx for idx in (idx_user, idx_session, idx_obj, idx_gaze, idx_ts) if idx is not None
    )

    parsed: list[GazeRow] = []
    order = start_order

    for row in rows_iter:
        if not row or len(row) <= max_needed_idx:
            if not row:
                continue
            row = tuple(row) + (None,) * (max_needed_idx + 1 - len(row))

        raw_user = row[idx_user]
        raw_obj = row[idx_obj]
        raw_gaze = row[idx_gaze]
        raw_ts = row[idx_ts]

        if raw_user is None or raw_obj is None or raw_gaze is None or raw_ts is None:
            continue

        obj_str = str(raw_obj).strip()
        if not obj_str or obj_str.lower() in {"null", "none", "nan"}:
            continue

        # Skip repeated header rows embedded in concatenated files
        if _normalize_header_name(raw_user) == "user_id" and _normalize_header_name(obj_str) == "object_id":
            continue

        try:
            gaze_val = float(raw_gaze)
        except (ValueError, TypeError):
            continue
        if math.isnan(gaze_val) or math.isinf(gaze_val) or gaze_val < 0:
            continue

        ts_val = parse_timestamp(raw_ts)
        if ts_val is None:
            continue

        raw_session = row[idx_session] if idx_session is not None else 0
        session_str = "0" if raw_session is None or str(raw_session).strip() == "" else str(raw_session).strip()
        try:
            s_float = float(session_str)
            if s_float.is_integer():
                session_str = str(int(s_float))
        except ValueError:
            pass

        user_str = str(raw_user).strip()
        if not user_str:
            continue

        parsed.append(
            GazeRow(
                user_id=user_str,
                session_id=session_str,
                object_id=obj_str,
                gaze_time=gaze_val,
                timestamp=ts_val,
                row_order=order,
            )
        )
        order += 1

    return parsed, order


def read_gaze_file(input_path: str | Path, sheet_name: str | None = None) -> list[GazeRow]:
    """
    Stream eye-gaze rows from an Excel workbook (.xlsx/.xlsm/.xltx/.xltm) or delimited text file (.csv/.tsv/.txt).
    """
    path = Path(input_path)
    if not path.exists():
        raise FileNotFoundError(f"Input file not found: {path}")

    suffix = path.suffix.lower()
    if suffix in {".xlsx", ".xlsm", ".xltx", ".xltm"}:
        try:
            wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        except PermissionError as exc:
            raise PermissionError(
                f"Cannot read '{path}' because it is locked by another program "
                "(most likely open in Microsoft Excel). Please close the file in Excel and try again."
            ) from exc

        all_rows: list[GazeRow] = []
        order = 0
        try:
            target_sheets = [sheet_name] if sheet_name else wb.sheetnames
            for name in target_sheets:
                if name not in wb.sheetnames:
                    raise ValueError(
                        f"Sheet '{name}' not found in '{path.name}'. Available sheets: {wb.sheetnames}"
                    )
                ws = wb[name]
                rows_iter = ws.iter_rows(values_only=True)
                sheet_rows, order = _parse_raw_sequence(rows_iter, start_order=order)
                all_rows.extend(sheet_rows)
        finally:
            wb.close()

        return all_rows

    if suffix in {".csv", ".tsv", ".txt"}:
        with path.open("r", encoding="utf-8-sig", newline="") as f:
            sample = f.read(4096)
            f.seek(0)
            delimiter = "\t" if "\t" in sample.splitlines()[0] else ","
            try:
                dialect = csv.Sniffer().sniff(sample, delimiters=",\t;|")
                delimiter = dialect.delimiter
            except csv.Error:
                pass
            reader = (tuple(r) for r in csv.reader(f, delimiter=delimiter))
            rows, _ = _parse_raw_sequence(reader)
            return rows

    raise ValueError(
        f"Unsupported file extension '{suffix}'. Please provide an Excel (.xlsx/.xlsm) or CSV/TSV file."
    )


def _is_minute_only_resolution(rows: list[GazeRow]) -> bool:
    """
    Detect if timestamps lost their `:SS` component (e.g., copy-pasted `"5/5/2026 13:33"`
    where every timestamp has `.second == 0` despite spanning many seconds of gaze_time).
    """
    if not rows:
        return False
    if any(r.timestamp.second != 0 or r.timestamp.microsecond != 0 for r in rows):
        return False
    total_gaze = sum(r.gaze_time for r in rows)
    return total_gaze > 5.0 and len(rows) > 10


def _summarize_segment_by_cumulative_duration(
    rows: list[GazeRow],
    irrelevant_lower: set[str],
    use_default_patterns: bool,
    start_second_index: int,
    include_timestamps: bool,
) -> list[dict[str, Any]]:
    """
    Fallback timeline builder when input timestamps only have minute resolution:
    reconstructs 1-second buckets by accumulating exact `gaze_time` durations.
    """
    if not rows:
        return []

    sec_totals: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    cursor = 0.0
    base_ts = rows[0].timestamp.replace(second=0, microsecond=0)

    for r in rows:
        dur = r.gaze_time
        if dur <= 0:
            continue
        end_cursor = cursor + dur
        if not is_irrelevant_object(r.object_id, irrelevant_lower, use_default_patterns):
            first_sec = int(math.floor(cursor))
            last_sec = int(math.floor(max(cursor, end_cursor - 1e-9)))
            for s in range(first_sec, last_sec + 1):
                overlap_start = max(cursor, float(s))
                overlap_end = min(end_cursor, float(s + 1))
                overlap = overlap_end - overlap_start
                if overlap > 0:
                    sec_totals[s][r.object_id] += overlap
        cursor = end_cursor

    total_seconds = max(1, int(math.ceil(cursor - 1e-6)))
    timeline: list[dict[str, Any]] = []
    for s in range(total_seconds):
        candidates = sec_totals.get(s)
        best_obj = max(candidates.items(), key=lambda kv: kv[1])[0] if candidates else None
        entry: dict[str, Any] = {"second": start_second_index + s}
        if include_timestamps:
            entry["timestamp"] = (base_ts + timedelta(seconds=s)).strftime("%Y-%m-%d %H:%M:%S")
        entry["object"] = best_obj
        timeline.append(entry)

    return timeline


def _summarize_segment_by_timestamps(
    rows: list[GazeRow],
    irrelevant_lower: set[str],
    use_default_patterns: bool,
    start_second_index: int,
    include_timestamps: bool,
) -> list[dict[str, Any]]:
    """
    Build a continuous 1-second timeline from second-precision timestamps, properly
    distributing multi-second gaze events (`gaze_time > 1.0`) across the seconds they span.
    """
    if not rows:
        return []

    anchor = rows[0].timestamp.replace(microsecond=0)
    sec_totals: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    used_in_sec: dict[int, float] = defaultdict(float)

    prev_sec: int | None = None
    min_sec = 0
    max_sec = 0

    for r in rows:
        sec = int(round((r.timestamp.replace(microsecond=0) - anchor).total_seconds()))
        min_sec = min(min_sec, sec)
        max_sec = max(max_sec, sec)
        dur = r.gaze_time
        is_relevant = not is_irrelevant_object(r.object_id, irrelevant_lower, use_default_patterns)

        if dur <= 0:
            prev_sec = sec
            continue

        if prev_sec is not None and sec > prev_sec and (sec - prev_sec >= 2 or dur > 1.0):
            interior_count = max(0, sec - prev_sec - 1)
            for s in range(prev_sec + 1, sec):
                used_in_sec[s] += 1.0
                if is_relevant:
                    sec_totals[s][r.object_id] += 1.0

            rem = max(0.0, dur - float(interior_count))
            if prev_sec == min_sec:
                in_prev = min(1.0, rem * 0.5)
                in_curr = min(1.0, rem - in_prev)
            else:
                avail_prev = max(0.0, 1.0 - min(1.0, used_in_sec[prev_sec]))
                in_prev = min(avail_prev, rem)
                in_curr = rem - in_prev
                if in_curr > 1.0:
                    in_prev = min(1.0, in_prev + (in_curr - 1.0))
                    in_curr = 1.0

            if in_prev > 0:
                used_in_sec[prev_sec] += in_prev
                if is_relevant:
                    sec_totals[prev_sec][r.object_id] += in_prev
            if in_curr > 0:
                used_in_sec[sec] += in_curr
                if is_relevant:
                    sec_totals[sec][r.object_id] += in_curr
        else:
            used_in_sec[sec] += dur
            if is_relevant:
                sec_totals[sec][r.object_id] += dur

        prev_sec = sec

    timeline: list[dict[str, Any]] = []
    out_idx = start_second_index
    for s in range(min_sec, max_sec + 1):
        candidates = sec_totals.get(s)
        best_obj = max(candidates.items(), key=lambda kv: kv[1])[0] if candidates else None
        entry: dict[str, Any] = {"second": out_idx}
        if include_timestamps:
            entry["timestamp"] = (anchor + timedelta(seconds=s)).strftime("%Y-%m-%d %H:%M:%S")
        entry["object"] = best_obj
        timeline.append(entry)
        out_idx += 1

    return timeline


def build_user_timeline(
    user_rows: list[GazeRow],
    irrelevant_lower: set[str],
    use_default_patterns: bool = True,
    max_gap_seconds: float = 300.0,
    include_timestamps: bool = False,
) -> list[dict[str, Any]]:
    """
    Build a single flat second-by-second timeline for one user.
    Splits across distinct `session_id`s or large multi-minute recording pauses so
    multi-day gaps between sessions do not insert thousands of artificial `null` seconds.
    """
    if not user_rows:
        return []

    by_session: dict[str, list[GazeRow]] = defaultdict(list)
    for r in user_rows:
        by_session[r.session_id].append(r)

    ordered_sessions = sorted(
        by_session.values(),
        key=lambda s_rows: (s_rows[0].timestamp, s_rows[0].row_order),
    )

    full_timeline: list[dict[str, Any]] = []
    for session_rows in ordered_sessions:
        session_rows.sort(key=lambda r: (r.timestamp, r.row_order))

        if _is_minute_only_resolution(session_rows):
            seg_timeline = _summarize_segment_by_cumulative_duration(
                session_rows,
                irrelevant_lower=irrelevant_lower,
                use_default_patterns=use_default_patterns,
                start_second_index=len(full_timeline),
                include_timestamps=include_timestamps,
            )
            full_timeline.extend(seg_timeline)
            continue

        segments: list[list[GazeRow]] = []
        current_seg: list[GazeRow] = []
        for r in session_rows:
            if current_seg:
                wall_gap = (r.timestamp - current_seg[-1].timestamp).total_seconds()
                allowed_gap = max(r.gaze_time + 15.0, max_gap_seconds)
                if wall_gap > allowed_gap:
                    segments.append(current_seg)
                    current_seg = []
            current_seg.append(r)
        if current_seg:
            segments.append(current_seg)

        for seg in segments:
            seg_timeline = _summarize_segment_by_timestamps(
                seg,
                irrelevant_lower=irrelevant_lower,
                use_default_patterns=use_default_patterns,
                start_second_index=len(full_timeline),
                include_timestamps=include_timestamps,
            )
            full_timeline.extend(seg_timeline)

    return full_timeline


def _group_original_users(
    rows: Iterable[GazeRow],
) -> list[tuple[str, str, list[GazeRow]]]:
    """
    Group rows by formatted original user key (`user1`, `user2`, ...) in numeric order.
    Returns list of `(user_key, raw_user_id_example, user_rows)`.
    """
    users_rows: dict[str, list[GazeRow]] = defaultdict(list)
    user_sort_keys: dict[str, tuple[int, int | str]] = {}
    raw_labels: dict[str, str] = {}

    for r in rows:
        sort_key, user_key = format_user_key(r.user_id)
        user_sort_keys[user_key] = sort_key
        if user_key not in raw_labels:
            raw_labels[user_key] = r.user_id
        users_rows[user_key].append(r)

    ordered_keys = sorted(users_rows.keys(), key=lambda k: user_sort_keys[k])
    return [(uk, raw_labels[uk], users_rows[uk]) for uk in ordered_keys]


def _group_ideal_users(
    ideal_rows: Iterable[GazeRow],
) -> list[tuple[str, str, list[GazeRow]]]:
    """
    Group ideal dataset rows by distinct user into sequential keys `idealUser0`, `idealUser1`, ...
    Returns list of `(ideal_key, raw_user_id_example, ideal_user_rows)`.
    """
    grouped = _group_original_users(ideal_rows)
    return [
        (f"idealUser{idx}", raw_label, u_rows)
        for idx, (_orig_style_key, raw_label, u_rows) in enumerate(grouped)
    ]


def validate_and_normalize_ideal_matches(
    ideal_matches: dict[str, str | int | None] | None,
    orig_user_keys: list[str],
    ideal_user_keys: list[str],
) -> dict[str, str | None]:
    """
    Validate and normalize a mapping from original user keys (`user1`, ...) to ideal user keys
    (`idealUser0`, ...), enforcing strict 1-to-1 matching (each ideal user may match at most
    one original user). If `ideal_matches` is None, defaults to sequential 1-to-1 pairing.
    """
    orig_set = set(orig_user_keys)
    ideal_set = set(ideal_user_keys)

    if ideal_matches is None:
        normalized: dict[str, str | None] = {uk: None for uk in orig_user_keys}
        for uk, ik in zip(orig_user_keys, ideal_user_keys):
            normalized[uk] = ik
        return normalized

    normalized = {uk: None for uk in orig_user_keys}
    assigned_ideal_to_orig: dict[str, str] = {}

    for raw_orig, raw_target in ideal_matches.items():
        orig_key = str(raw_orig).strip()
        if orig_key not in orig_set:
            _, candidate_orig = format_user_key(orig_key)
            if candidate_orig in orig_set:
                orig_key = candidate_orig
            else:
                raise ValueError(
                    f"Unknown original user '{raw_orig}' in ideal_matches. Available users: {orig_user_keys}"
                )

        if raw_target is None or str(raw_target).strip().lower() in {"", "none", "null", "skip"}:
            normalized[orig_key] = None
            continue

        target_str = str(raw_target).strip()
        if target_str.isdigit():
            target_key = f"idealUser{int(target_str)}"
        else:
            # Case-insensitive normalization for `idealuser0` -> `idealUser0`
            match = re.fullmatch(r"idealuser[\s_\-]*(\d+)", target_str, flags=re.IGNORECASE)
            target_key = f"idealUser{int(match.group(1))}" if match else target_str

        if target_key not in ideal_set:
            raise ValueError(
                f"Unknown ideal user '{raw_target}' (normalized to '{target_key}'). "
                f"Available ideal users: {ideal_user_keys}"
            )

        if target_key in assigned_ideal_to_orig:
            prev_orig = assigned_ideal_to_orig[target_key]
            if prev_orig != orig_key:
                raise ValueError(
                    f"Strict 1-to-1 matching violated: '{target_key}' cannot be matched to both "
                    f"'{prev_orig}' and '{orig_key}'."
                )

        assigned_ideal_to_orig[target_key] = orig_key
        normalized[orig_key] = target_key

    return normalized


def summarize_gaze_rows(
    rows: Iterable[GazeRow],
    irrelevant_objects: Iterable[str] = DEFAULT_IRRELEVANT_OBJECTS,
    use_default_patterns: bool = True,
    condense_similar: bool = False,
    max_gap_seconds: float = 300.0,
    include_timestamps: bool = False,
    ideal_rows: Iterable[GazeRow] | None = None,
    ideal_matches: dict[str, str | int | None] | None = None,
) -> dict[str, Any]:
    """
    Produce the final JSON-serializable summary dictionary:
      {
        "relevant_objects": [...],
        "ideal_matches": {"user1": "idealUser0", ...},  # Included when `ideal_rows` is provided
        "user1": [{"second": 0, "object": "..."}, {"second": 1, "object": null}, ...],
        "user2": [...],
        "idealUser0": [...],
        "idealUser1": [...]
      }
    """
    row_list = list(rows)
    ideal_row_list = list(ideal_rows) if ideal_rows is not None else None
    irrelevant_lower = {obj.strip().lower() for obj in irrelevant_objects if obj.strip()}

    # Collect unique raw relevant object names across BOTH main and ideal datasets
    raw_relevant_map: dict[str, str] = {}
    all_source_rows = row_list + (ideal_row_list if ideal_row_list is not None else [])
    for r in all_source_rows:
        if not is_irrelevant_object(r.object_id, irrelevant_lower, use_default_patterns):
            obj_lower = r.object_id.lower()
            if obj_lower not in raw_relevant_map:
                raw_relevant_map[obj_lower] = r.object_id

    # Optionally build a unified dynamic condensing map across both datasets
    if condense_similar and raw_relevant_map:
        canonical_by_raw = build_condense_mapping(raw_relevant_map.values())
        canonical_by_lower = {
            low: canonical_by_raw[orig] for low, orig in raw_relevant_map.items()
        }

        def _remap_rows(src: list[GazeRow]) -> list[GazeRow]:
            out: list[GazeRow] = []
            for r in src:
                mapped = canonical_by_lower.get(r.object_id.lower())
                if mapped is not None and mapped != r.object_id:
                    out.append(replace(r, object_id=mapped))
                else:
                    out.append(r)
            return out

        processed_rows = _remap_rows(row_list)
        processed_ideal_rows = _remap_rows(ideal_row_list) if ideal_row_list is not None else None
        unique_relevant = set(canonical_by_raw.values())
    else:
        processed_rows = row_list
        processed_ideal_rows = ideal_row_list
        unique_relevant = set(raw_relevant_map.values())

    relevant_objects_list = sorted(unique_relevant, key=lambda s: s.lower())

    orig_groups = _group_original_users(processed_rows)
    orig_user_keys = [uk for uk, _, _ in orig_groups]

    ideal_groups = (
        _group_ideal_users(processed_ideal_rows) if processed_ideal_rows is not None else None
    )

    result: dict[str, Any] = {
        "relevant_objects": relevant_objects_list,
    }

    if ideal_groups is not None:
        ideal_user_keys = [ik for ik, _, _ in ideal_groups]
        result["ideal_matches"] = validate_and_normalize_ideal_matches(
            ideal_matches,
            orig_user_keys=orig_user_keys,
            ideal_user_keys=ideal_user_keys,
        )

    for user_key, _raw_label, u_rows in orig_groups:
        result[user_key] = build_user_timeline(
            u_rows,
            irrelevant_lower=irrelevant_lower,
            use_default_patterns=use_default_patterns,
            max_gap_seconds=max_gap_seconds,
            include_timestamps=include_timestamps,
        )

    if ideal_groups is not None:
        for ideal_key, _raw_label, i_rows in ideal_groups:
            result[ideal_key] = build_user_timeline(
                i_rows,
                irrelevant_lower=irrelevant_lower,
                use_default_patterns=use_default_patterns,
                max_gap_seconds=max_gap_seconds,
                include_timestamps=include_timestamps,
            )

    return result


def get_dataset_users(
    input_path: str | Path,
    is_ideal: bool = False,
    sheet_name: str | None = None,
) -> list[dict[str, Any]]:
    """
    Helper for frontend/UI integration: inspect an Excel/CSV file and return its ordered user list:
      `[{"key": "user1", "raw_user_id": "1", "row_count": 649}, ...]`
    (or `"idealUser0"`, `"idealUser1"`, ... when `is_ideal=True`).
    """
    rows = read_gaze_file(input_path, sheet_name=sheet_name)
    groups = _group_ideal_users(rows) if is_ideal else _group_original_users(rows)
    return [
        {"key": key, "raw_user_id": raw_label, "row_count": len(u_rows)}
        for key, raw_label, u_rows in groups
    ]


def summarize_excel_to_json(
    input_path: str | Path,
    output_path: str | Path,
    ideal_input_path: str | Path | None = None,
    ideal_matches: dict[str, str | int | None] | None = None,
    irrelevant_objects: Iterable[str] = DEFAULT_IRRELEVANT_OBJECTS,
    use_default_patterns: bool = True,
    condense_similar: bool = False,
    sheet_name: str | None = None,
    ideal_sheet_name: str | None = None,
    max_gap_seconds: float = 300.0,
    include_timestamps: bool = False,
    indent: int = 2,
) -> dict[str, Any]:
    """Read main (and optional ideal user) Excel/CSV eye-gaze files, summarize per-second gaze, and write JSON."""
    rows = read_gaze_file(input_path, sheet_name=sheet_name)
    ideal_rows = (
        read_gaze_file(ideal_input_path, sheet_name=ideal_sheet_name)
        if ideal_input_path is not None
        else None
    )
    summary = summarize_gaze_rows(
        rows,
        irrelevant_objects=irrelevant_objects,
        use_default_patterns=use_default_patterns,
        condense_similar=condense_similar,
        max_gap_seconds=max_gap_seconds,
        include_timestamps=include_timestamps,
        ideal_rows=ideal_rows,
        ideal_matches=ideal_matches,
    )
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as f:
        json.dump(summary, f, indent=indent)
        f.write("\n")
    return summary


def _discover_default_input_file(directory: Path) -> Path | None:
    """If no input file was passed on CLI, auto-detect a single .xlsx file in `directory`."""
    candidates = [
        p
        for p in directory.iterdir()
        if p.is_file()
        and p.suffix.lower() in {".xlsx", ".xlsm"}
        and not p.name.startswith("~$")
    ]
    if len(candidates) == 1:
        return candidates[0]
    return None


def _clean_user_path_input(raw: str) -> str:
    """Strip surrounding quotes and PowerShell `& ` prefixes from dragged/pasted terminal paths."""
    cleaned = re.sub(r"^&\s*", "", raw.strip())
    return cleaned.strip().strip("\"'").strip()


def _prompt_ideal_file_path() -> Path | None:
    """Prompt the user in an interactive terminal for an optional ideal user Excel/CSV file."""
    if not sys.stdin or not sys.stdin.isatty():
        return None

    while True:
        try:
            ans = input(
                'Upload/include an "ideal user" dataset? [y/N, or paste file path]: '
            ).strip()
        except EOFError:
            return None

        low = ans.lower()
        if low in {"", "n", "no", "0", "false"}:
            return None

        if low in {"y", "yes", "1", "true"}:
            while True:
                try:
                    raw_path = input(
                        "Enter path to ideal user Excel/CSV file (or press Enter to skip): "
                    )
                except EOFError:
                    return None
                cleaned = _clean_user_path_input(raw_path)
                if not cleaned:
                    return None
                candidate = Path(cleaned).expanduser()
                if candidate.is_file():
                    return candidate
                print(f"File not found: '{candidate}'. Please check the path or press Enter to skip.")
        else:
            # User pasted or dragged a file path directly into the first prompt
            cleaned = _clean_user_path_input(ans)
            candidate = Path(cleaned).expanduser()
            if candidate.is_file():
                return candidate
            print(
                f"File not found: '{candidate}'. Enter 'y' to specify a path, 'n' to skip, or paste a valid path."
            )


def _prompt_ideal_user_matches(
    orig_groups: list[tuple[str, str, list[GazeRow]]],
    ideal_groups: list[tuple[str, str, list[GazeRow]]],
) -> dict[str, str | None] | None:
    """
    Interactively prompt the user to match each original user (`user1`, ...) to an
    ideal user (`idealUser0`, ...) with strict 1-to-1 enforcement.
    """
    if not sys.stdin or not sys.stdin.isatty():
        return None
    if not orig_groups or not ideal_groups:
        return {uk: None for uk, _, _ in orig_groups}

    print(f"\nFound {len(orig_groups)} original user(s) and {len(ideal_groups)} ideal user(s):")
    for idx, (ik, raw_id, i_rows) in enumerate(ideal_groups):
        print(f"  [{idx}] {ik} (from Excel user_id={raw_id}, {len(i_rows):,} rows)")
    print("Match each original user to an ideal user (strictly 1-to-1; press Enter to skip):")

    ideal_by_index = {idx: ik for idx, (ik, _, _) in enumerate(ideal_groups)}
    ideal_raw_label = {ik: raw_id for ik, raw_id, _ in ideal_groups}
    ideal_lower_to_key = {ik.lower(): ik for ik, _, _ in ideal_groups}

    taken_by: dict[str, str] = {}
    matches: dict[str, str | None] = {uk: None for uk, _, _ in orig_groups}

    for orig_key, orig_raw_id, _ in orig_groups:
        available = [
            f"[{idx}] {ik} (id={ideal_raw_label[ik]})"
            for idx, ik in ideal_by_index.items()
            if ik not in taken_by
        ]
        if not available:
            print(f"  All ideal users have been matched; leaving {orig_key} unmatched.")
            break

        print(f"  Available ideal users: {', '.join(available)}")
        while True:
            try:
                ans = input(
                    f"  Match '{orig_key}' (Excel user_id={orig_raw_id}) to [index / idealUser# / Enter=none]: "
                ).strip()
            except EOFError:
                return matches

            low = ans.lower()
            if low in {"", "n", "no", "none", "null", "skip"}:
                matches[orig_key] = None
                break

            chosen_key: str | None = None
            if ans.isdigit():
                idx_val = int(ans)
                if idx_val in ideal_by_index:
                    chosen_key = ideal_by_index[idx_val]
            else:
                m = re.fullmatch(r"idealuser[\s_\-]*(\d+)", low)
                if m and int(m.group(1)) in ideal_by_index:
                    chosen_key = ideal_by_index[int(m.group(1))]
                elif low in ideal_lower_to_key:
                    chosen_key = ideal_lower_to_key[low]

            if chosen_key is None:
                print("    Invalid selection. Enter an available [index], e.g. 0, 'idealUser0', or press Enter to skip.")
                continue

            if chosen_key in taken_by:
                print(
                    f"    '{chosen_key}' is already matched to '{taken_by[chosen_key]}' (strict 1-to-1). "
                    "Please pick another available ideal user or press Enter to skip."
                )
                continue

            taken_by[chosen_key] = orig_key
            matches[orig_key] = chosen_key
            break

    print()
    return matches


def _parse_cli_ideal_matches(pairs: list[str]) -> dict[str, str | None]:
    """Parse CLI `--ideal-match user1=idealUser0 user2=1` pairs into a raw mapping dict."""
    parsed: dict[str, str | None] = {}
    for item in pairs:
        if "=" not in item:
            raise ValueError(
                f"Invalid --ideal-match entry '{item}'. Expected format: user1=idealUser0 (or user1=0)."
            )
        left, right = item.split("=", 1)
        left_clean = left.strip()
        right_clean = right.strip()
        if not left_clean:
            raise ValueError(f"Invalid --ideal-match entry '{item}': missing original user key.")
        parsed[left_clean] = None if right_clean.lower() in {"", "none", "null", "skip"} else right_clean
    return parsed


def _prompt_condense_choice() -> bool:
    """Prompt the user in an interactive terminal whether to condense similar object names."""
    if not sys.stdin or not sys.stdin.isatty():
        return False
    while True:
        try:
            ans = input(
                "Condense similar objects into combined groups (e.g., Stryker_bed_* -> Stryker_bed)? [y/N]: "
            ).strip().lower()
        except EOFError:
            return False
        if ans in {"", "n", "no", "0", "false"}:
            return False
        if ans in {"y", "yes", "1", "true"}:
            return True
        print("Please enter 'y' for yes or 'n' for no.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Summarize DISCOVER VR eye-gaze Excel data into a per-second JSON file "
            "filtering out irrelevant environment/hand colliders."
        )
    )
    parser.add_argument(
        "input_file",
        nargs="?",
        help="Path to the input Excel (.xlsx) or CSV/TSV file. Auto-detects if a single .xlsx is in the current folder.",
    )
    parser.add_argument(
        "-o",
        "--output",
        default=None,
        help="Path to the output JSON file (default: <input_stem>_summary.json).",
    )
    parser.add_argument(
        "--sheet",
        default=None,
        help="Specific Excel worksheet name to read for the main dataset (default: all matching sheets).",
    )

    ideal_group = parser.add_mutually_exclusive_group()
    ideal_group.add_argument(
        "--ideal",
        default=None,
        metavar="IDEAL_FILE",
        help="Path to an optional 'ideal user' Excel (.xlsx) or CSV/TSV dataset (outputs idealUser0, idealUser1, ...).",
    )
    ideal_group.add_argument(
        "--no-ideal",
        action="store_true",
        help="Skip prompting for an ideal user dataset.",
    )
    parser.add_argument(
        "--ideal-sheet",
        default=None,
        help="Specific Excel worksheet name to read for the ideal user dataset.",
    )
    parser.add_argument(
        "--ideal-match",
        nargs="*",
        default=None,
        metavar="USER=IDEAL",
        help="Explicit 1-to-1 matches without prompting, e.g. --ideal-match user1=idealUser0 user2=idealUser1",
    )

    parser.add_argument(
        "--ignore",
        nargs="*",
        default=[],
        metavar="OBJECT_ID",
        help="Additional object_id names to treat as irrelevant on top of the built-in list.",
    )

    condense_group = parser.add_mutually_exclusive_group()
    condense_group.add_argument(
        "--condense",
        dest="condense",
        action="store_true",
        default=None,
        help="Enable dynamic condensing of similar object variants without prompting.",
    )
    condense_group.add_argument(
        "--no-condense",
        dest="condense",
        action="store_false",
        default=None,
        help="Disable dynamic condensing without prompting.",
    )

    parser.add_argument(
        "--include-timestamps",
        action="store_true",
        help="Include wall-clock 'timestamp' alongside 'second' and 'object' in each timeline entry.",
    )
    parser.add_argument(
        "--max-gap",
        type=float,
        default=300.0,
        help="Max wall-clock gap in seconds within a session before splitting segments (default: 300).",
    )

    args = parser.parse_args(argv)

    input_path: Path | None
    if args.input_file:
        input_path = Path(args.input_file)
    else:
        input_path = _discover_default_input_file(Path.cwd())
        if input_path is None:
            parser.print_usage(sys.stderr)
            print(
                "\nError: Please specify an input Excel file, e.g.:\n"
                "  python summarize_gaze.py path/to/gaze_data.xlsx -o gaze_summary.json",
                file=sys.stderr,
            )
            return 1
        print(f"Auto-detected Excel file: {input_path.name}")

    if not input_path.exists():
        print(f"Error: Input file not found: '{input_path}'", file=sys.stderr)
        return 1

    try:
        rows = read_gaze_file(input_path, sheet_name=args.sheet)
    except Exception as exc:
        print(f"Error reading '{input_path}': {exc}", file=sys.stderr)
        return 1

    if not rows:
        print(
            f"Warning: No valid gaze rows found in '{input_path}'. "
            "Check that columns (user_id, object_id, gaze_time, time_stamp) exist.",
            file=sys.stderr,
        )

    ideal_path: Path | None
    if args.ideal is not None:
        ideal_path = Path(args.ideal)
        if not ideal_path.exists():
            print(f"Error: Ideal user file not found: '{ideal_path}'", file=sys.stderr)
            return 1
    elif args.no_ideal:
        ideal_path = None
    else:
        ideal_path = _prompt_ideal_file_path()

    ideal_rows: list[GazeRow] | None = None
    ideal_matches: dict[str, str | int | None] | None = None
    if ideal_path is not None:
        try:
            ideal_rows = read_gaze_file(ideal_path, sheet_name=args.ideal_sheet)
        except Exception as exc:
            print(f"Error reading ideal user file '{ideal_path}': {exc}", file=sys.stderr)
            return 1
        if not ideal_rows:
            print(
                f"Warning: No valid gaze rows found in ideal user file '{ideal_path}'.",
                file=sys.stderr,
            )

        if args.ideal_match is not None:
            try:
                ideal_matches = _parse_cli_ideal_matches(args.ideal_match)
            except ValueError as exc:
                print(f"Error: {exc}", file=sys.stderr)
                return 1
        else:
            orig_groups_preview = _group_original_users(rows)
            ideal_groups_preview = _group_ideal_users(ideal_rows)
            ideal_matches = _prompt_ideal_user_matches(orig_groups_preview, ideal_groups_preview)

    condense_similar = args.condense if args.condense is not None else _prompt_condense_choice()

    output_path = (
        Path(args.output)
        if args.output
        else input_path.with_name(f"{input_path.stem}_summary.json")
    )

    irrelevant = set(DEFAULT_IRRELEVANT_OBJECTS)
    irrelevant.update(args.ignore)

    t0 = time.perf_counter()
    try:
        summary = summarize_gaze_rows(
            rows,
            irrelevant_objects=irrelevant,
            condense_similar=condense_similar,
            max_gap_seconds=args.max_gap,
            include_timestamps=args.include_timestamps,
            ideal_rows=ideal_rows,
            ideal_matches=ideal_matches,
        )
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
        f.write("\n")

    elapsed = time.perf_counter() - t0
    timeline_keys = [k for k in summary.keys() if k not in {"relevant_objects", "ideal_matches"}]
    mode_label = "enabled" if condense_similar else "disabled"
    total_raw_rows = len(rows) + (len(ideal_rows) if ideal_rows is not None else 0)
    print(f"Processed {total_raw_rows:,} raw gaze rows in {elapsed:.2f}s (condensing {mode_label})")
    print(f"Relevant unique objects in output: {len(summary['relevant_objects'])}")
    if "ideal_matches" in summary:
        print("Ideal user 1-to-1 matches:")
        for orig_u, matched_ideal in summary["ideal_matches"].items():
            print(f"  - {orig_u} -> {matched_ideal}")
    print(f"Timelines summarized ({len(timeline_keys)}):")
    for uk in timeline_keys:
        timeline = summary[uk]
        active_secs = sum(1 for item in timeline if item["object"] is not None)
        print(f"  - {uk}: {len(timeline):,}s total ({active_secs:,}s looking at relevant objects)")
    print(f"Saved JSON summary to: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
