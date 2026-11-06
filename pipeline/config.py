"""Every threshold and path the pipeline uses."""

from pathlib import Path

IDLE_MAX_S = 30.0          # rows with gaze_time > this are idle headset periods
SESSION_GAP_S = 300        # gap between consecutive rows (same user) that starts a new session
MIN_SESSION_MIN = 5        # drop sessions shorter than this
MERGE_GAP_S = 1.0          # merge consecutive same-lane rows if the gap between them is <= this
EXPORT_MIN_VISIT_S = 0.1   # visits below this are not exported (UI slider filters further)
DEFAULT_MIN_VISIT_S = 0.5  # UI default threshold for a "touchpoint"
TEAM_OVERLAP_FRAC = 0.5    # session joins a team run if >= this fraction of it overlaps the run window
COVERAGE_WINDOW_S = 30     # a lane is "covered" at time t if any member visited it in [t-30s, t]

MIN_DEFAULT_RUN_S = 45 * 60  # same rule as pickDefaultRun in app/src/metrics.ts
RAW_SAMPLE_ROWS = 25

ROOT = Path(__file__).resolve().parent.parent
RAW_LOG = ROOT / "data" / "raw" / "eye_gaze_tracking_050505092026.csv"
LANE_MAP = ROOT / "data" / "lane_map.csv"
LANE_MAP_NOTE = "The lane map is a draft that hasn't had clinical review, so numbers per lane are provisional."
OUTPUT_DIR = ROOT / "app" / "public" / "data"

BACKGROUND_COLOR = "#9AA0A6"

# In display order: (id, include, label block color, band fill).
LANES = [
    ("Reference", True, "#3B8EDB", "#D6E8F8"),
    ("Patient assessment", True, "#D6336C", "#F7D4E1"),
    ("Vital sign monitor", True, "#7CB342", "#E3F0D3"),
    ("Equipment & interventions", True, "#E0A800", "#FBF0C9"),
    ("Communication", True, "#5AA9D6", "#E6F3FA"),
    ("Self", False, BACKGROUND_COLOR, BACKGROUND_COLOR),
    ("Bed", False, BACKGROUND_COLOR, BACKGROUND_COLOR),
    ("System", False, BACKGROUND_COLOR, BACKGROUND_COLOR),
    ("Environment", False, BACKGROUND_COLOR, BACKGROUND_COLOR),
]
UNMAPPED_LANE = "Unmapped"


def params() -> dict[str, float]:
    return {
        "IDLE_MAX_S": IDLE_MAX_S,
        "SESSION_GAP_S": SESSION_GAP_S,
        "MIN_SESSION_MIN": MIN_SESSION_MIN,
        "MERGE_GAP_S": MERGE_GAP_S,
        "EXPORT_MIN_VISIT_S": EXPORT_MIN_VISIT_S,
        "DEFAULT_MIN_VISIT_S": DEFAULT_MIN_VISIT_S,
        "TEAM_OVERLAP_FRAC": TEAM_OVERLAP_FRAC,
        "COVERAGE_WINDOW_S": COVERAGE_WINDOW_S,
    }
