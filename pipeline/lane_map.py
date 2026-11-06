"""Writes a DRAFT data/lane_map.csv from object names. Run: python -m pipeline.lane_map

Starts from the irrelevant-object filter in summarize_gaze.py. Nobody clinical has
reviewed this. Uncertain objects get confidence=verify, which shows "?" in the app.
Edit the CSV by hand after review. This script won't overwrite it without --force.
"""

import argparse
import re

import pandas as pd

from summarize_gaze import DEFAULT_IRRELEVANT_OBJECTS, is_irrelevant_object

from . import config
from .clean import add_timing, drop_test_user
from .load import load_rows

COLUMNS = ["object_id", "lane", "include", "confidence", "events", "dwell_s_excl_idle", "learners"]
INCLUDED = {lane for lane, include, _, _ in config.LANES if include}
IRRELEVANT = {name.lower() for name in DEFAULT_IRRELEVANT_OBJECTS}

MONITOR = re.compile(r"^(MonitorBar|T3_monitor_screen.*|Screen|SPO2|RR|ekg|HFNC_Screen)$")
PATIENT_EXAM = re.compile(
    r"^(CapsulePulseHaptics|PulseHaptics?\d*|pulse|Caprefill.*|ChestSounds.*|chestRub|Liver|Kidney"
    r"|LeftEye|RightEye|GroinHaptics\d*|Stethoscope|PenLight|thermometer_.*|iStat|BloodDraw)$"
)
# summarize_gaze.py filters these as avatar rig helpers, but they sit on the patient's body.
PATIENT_BODY = re.compile(r"^(.*IK|.*Grab.*|TriggerChest[LR]|chestRubBlocker)$")
SELF = re.compile(r"^(AutoHandPlayer|RobotHand[LR]?|(Thumb|Index|Middle|Ring|Pinky)\d*)$")
SYSTEM = re.compile(r"^(LoadingScreen|SpatialPanelManipulator|Bckground)$")
BED = re.compile(r"^(Stryker_|Styker_|linetBed_)")
# Guesses worth a clinician's or developer's second look.
VERIFY = re.compile(r"^(HeadFollower|RobotHand.*|Screen|ThermometerSnap.*)$")


def classify(object_id: str) -> tuple[str, str]:
    """Returns (lane, confidence) for one object name."""
    if object_id.startswith("CodeSheet"):
        lane = "Reference"
    elif object_id == "HeadFollower":
        lane = "Communication"
    elif BED.match(object_id):
        lane = "Bed"
    elif PATIENT_BODY.match(object_id):
        return "Patient assessment", "verify"
    elif SELF.match(object_id):
        lane = "Self"
    elif SYSTEM.match(object_id):
        lane = "System"
    elif is_irrelevant_object(object_id, IRRELEVANT):
        lane = "Environment"
    elif MONITOR.match(object_id):
        lane = "Vital sign monitor"
    elif PATIENT_EXAM.match(object_id):
        lane = "Patient assessment"
    else:
        lane = "Equipment & interventions"
    return lane, "verify" if VERIFY.match(object_id) else "draft"


def build_lane_map(rows: pd.DataFrame) -> pd.DataFrame:
    timed = add_timing(drop_test_user(rows))
    active = timed[~timed.idle].groupby("object_id")
    records = []
    for object_id in sorted(rows.object_id.unique()):
        lane, confidence = classify(object_id)
        looks = active.get_group(object_id) if object_id in active.groups else None
        records.append(
            {
                "object_id": object_id,
                "lane": lane,
                "include": lane in INCLUDED,
                "confidence": confidence,
                "events": 0 if looks is None else len(looks),
                "dwell_s_excl_idle": 0 if looks is None else round(looks.gaze_time.sum(), 3),
                "learners": 0 if looks is None else looks.user_id.nunique(),
            }
        )
    return pd.DataFrame(records, columns=COLUMNS)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="overwrite an existing lane map")
    args = parser.parse_args()
    if config.LANE_MAP.exists() and not args.force:
        raise SystemExit(f"{config.LANE_MAP} already exists. Use --force to overwrite hand edits.")
    lane_map = build_lane_map(load_rows(config.RAW_LOG))
    lane_map.to_csv(config.LANE_MAP, index=False)
    print(f"Wrote {len(lane_map)} objects to {config.LANE_MAP}")
    print(lane_map.lane.value_counts().to_string())


if __name__ == "__main__":
    main()
