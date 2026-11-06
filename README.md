# DISCOVER Gaze Insights

A one-day hackathon prototype for the CCHMC DISCOVER VR simulation platform, which is used for pediatric emergency training.

It answers one question:

> Where does each clinician's attention actually go during a VR simulation, and can we show it automatically from raw gaze logs instead of a person watching and taking notes?

**Status: in progress.** The three MVP tabs run on real data from the pipeline, using a draft lane map that still needs review. See [Current status](#current-status).

## Why this exists

The DISCOVER platform logs what every participant's gaze ray hits, but nobody uses this data. It is too granular to read directly, and the team has never had the people to consolidate it. Today, an educator watches each session and takes notes by hand.

The log we have shows the problem:

- It has 106,803 rows and 159 distinct objects, down to individual finger bones.
- 174 idle headset periods make up 64% of all logged time.
- Most of the remaining time lands on walls, invisible room colliders and the player's own hands. Clinically relevant objects get only a few percent.

We turn this log into a clear picture of attention over time.

**Who it's for:**
- **Simulation educators**, who want to see how learners and teams behaved during a session.
- **Industry partners** testing new in-room displays with experienced clinicians, who want to know: "Do they actually look at it, and does it change how they work?"

## What we're building

Two parts, with no backend, login or VR headset needed:

```
raw gaze CSV + lane map  ->  Python pipeline  ->  static JSON  ->  React + D3 app
```

The pipeline cleans the log and groups it into sessions, team runs and lane visits. The app reads the resulting JSON and computes its metrics in the browser, so the "Min touchpoint" slider updates every screen live.

The MVP has three tabs:

| Tab | Question it answers |
|---|---|
| 1. Upload & clean | How do we turn the raw firehose into a clean signal? |
| 2. Team swim lanes (the centerpiece) | How did each person's attention move over time, and was anyone on the team watching the patient or monitor? |
| 3. Report card | What did one learner look at, how soon and how often, as a starting point for their debrief? |

Attention profiles, Display under test and Expected vs actual are parked until after the MVP.

## Rules everyone must follow

1. **It's head gaze, not eye tracking.** The platform casts a ray from the center of the headset. Label it "head gaze (headset-forward ray)" in the UI, and never say "eye tracking" or "fixations". The source filename says `eye_gaze`, but that doesn't change what it measures.
2. **Screens 1–4 use real data only.** Don't add invented clinical events, scores or scenario labels. Anything simulated must carry a visible "SIMULATED" badge.
3. **We don't know which scenario was running.** The log has no scenario ID, so label any guess "inferred" (for example, "8 kg code sheet seen, inferred").
4. **Raw data is read-only.** Never modify `data/raw/`.
5. **Keep thresholds in one place.** They all live in `pipeline/config.py`.
6. **Flag uncertain mappings.** Objects marked `verify` in the lane map get a "?" in tooltips.
7. **Describe, don't judge.** Write "looked at the monitor 12 times", not "bad".

## Key terms

| Term | Meaning |
|---|---|
| Head gaze | Where the center of the headset points. It doesn't show where the eyes are looking |
| Lane | A group of related objects. There are five: Reference, Patient assessment, Vital sign monitor, Equipment & interventions, Communication |
| Background | Objects excluded from attention metrics, such as walls, the bed, UI screens and the learner's own hands. They still count toward active time |
| Idle | A row with `gaze_time` over 30 s, treated as a headset left sitting rather than a real look |
| Session | One learner's continuous stretch of data. A gap of more than 5 minutes starts a new one, and sessions under 5 minutes are dropped |
| Team run | A group of sessions that overlap in time, meaning learners were in the room together |
| Visit | Consecutive looks at the same lane (or the same object, on Screen 4) merged into one |
| Touchpoint | A visit at least as long as the slider value (0.5 s by default). These are the dots on the swim lanes |
| Coverage | A lane is covered if any team member visited it in the last 30 s |

## The data

**Gaze log:** `data/raw/eye_gaze_tracking_050505092026.csv`. A row is written when the gaze ray leaves an object, so the timestamp marks the end of the look.

| Column | Meaning |
|---|---|
| `user_id` | Learner 1–4. User 0 is 8 test rows, which we drop |
| `session_id` | Always 0, so sessions are derived from time gaps instead |
| `object_id` | The 3D object the ray hit |
| `gaze_time` | Seconds the ray stayed on that object |
| `time_stamp` | End of the look, to the nearest second |

The log covers 2026-05-05 (user 1 only, about 9 minutes), then 2026-05-06 and 2026-05-08 (all four learners together).

**Default view:** the team run on 2026-05-06, about 13:04–13:55, with all four learners in sessions of about 46–50 minutes.

**Lane map:** `data/lane_map.csv` assigns each object to a lane. It's a draft, so [`data/README.md`](data/README.md) explains how to review it.

## Current status

| Item | State |
|---|---|
| Build spec | Done, kept outside this repo |
| Gaze log | Included in `data/raw/` |
| Lane map (`data/lane_map.csv`) | **Draft: needs review, so numbers per lane are provisional** |
| Pipeline and tests | Built. Two visit-count tests are expected failures until the merge rule is confirmed |
| App | The three MVP tabs are built and run on pipeline output |

### Milestones

Commit after each one. If time runs short, cut from the bottom of this list, but never cut M2.

| Milestone | Scope | Done when |
|---|---|---|
| M1 | Pipeline and tests | `pytest` passes, expected numbers are within tolerance, JSON is written |
| M2 | App shell and Team swim lanes | The default run renders, and the slider changes the dots live |
| M3 | Upload & clean | The funnel shows real numbers from `funnel.json` |
| M4 | Report card | All metrics are computed from visits, with no hard-coded numbers |
| M5 | Demo polish | Tabs and arrow keys work, the footnote is present, it loads in under 2 s |
| Stretch | Screen 5, overlay mode, PNG export of a swim panel | |

## Getting started

You'll need Node to run the app, and Python 3.11+ for the pipeline.

```bash
# App: works today
cd app
npm install
npm run dev

# Pipeline and tests: run these first to see real data
python -m pip install -r requirements.txt
python -m pipeline.run   # writes app/public/data/*.json and prints the funnel numbers
pytest -q
```

### Uploading a log

The **Upload & clean** tab takes a gaze log by drag and drop or file picker, and runs the same pipeline steps in the browser. It uses `data/lane_map.csv` as it was when the app was built, unless you also upload a lane map. Files aren't sent anywhere. Uploaded logs and lane maps are saved in this browser using IndexedDB and restored on reload. Removing the uploaded log returns to the built-in data. Objects missing from the lane map count as background, and the app says how many there were. Debrief notes stay in that browser's local storage.

The steps live in both `pipeline/` and `app/src/processLog.ts`. If you change one, change the other, then run `npm run check:upload` in `app/` to compare their results.

### Swim lane views

Tab 2 offers three views. **Simplified** keeps the five clinical lanes and team coverage. **Standard** and **Advanced** share the same summary chart, learner picker, object search and summary download. Standard condenses similar object variants; Advanced preserves each filtered original object name. Uploading a gaze log automatically generates both summaries.

**Standard** automatically generates a condensed gaze summary from the raw gaze log uploaded in tab 1. No separate JSON upload is required. The browser implementation mirrors the filtering, dynamic object condensing, per-second dominant-object selection, minute-resolution fallback and session gap handling in `summarize_gaze.py`. `npm run check:summary` compares the complete output with the Python-generated reference. The summary is regenerated when a saved upload is restored; Download summary JSON exports it in the script's format. The built-in recording uses its pre-generated summary.

Summary files cover the full recording with session pauses omitted, so Standard and Advanced use summary elapsed time and do not follow the Team run picker. Simplified uses the selected run and its clock times. Adjacent seconds with the same object form a chart segment; null seconds and gaps break segments. User 0 is excluded from the display and download. The threshold filters summary segment duration in both summary views, rather than raw measured dwell.

### Mock data

Until the pipeline has run, the app loads synthetic data from `app/public/data-mock/` and shows a red "MOCK DATA" banner. Once `app/public/data/meta.json` exists, the app uses real data and the banner disappears. If any other real file is missing, the app shows an error instead of falling back to mock data.

Mock data is for development only, so never use it in the demo. To regenerate it, run `npm run mock` in `app/`.

### For whoever builds the pipeline

The app expects the formats in [`app/src/types.ts`](app/src/types.ts), including these details:

- **`meta.json`** has an `objects` lookup of `object_id` to `{ lane, verify }`, which drives the "?" in tooltips.
- **`raw_sample.json`** uses the same columns as the CSV.
- **Times** treat the log's clock as UTC: epoch seconds use that, and ISO strings have no offset or end in `Z`. This shows times as logged in any browser timezone.
- **`meta.params`** uses the names from `pipeline/config.py`, such as `DEFAULT_MIN_VISIT_S`.

### Layout

The JSON in `app/public/data/` isn't committed, so run the pipeline to create it. It needs the gaze log in `data/raw/`.

```
data/
  raw/                  # gaze log, read-only
  lane_map.csv          # object -> lane
  sim_events.json       # stretch goal only
pipeline/               # Python: config, load, clean, sessions, visits, export, run
tests/                  # unit tests and expected-number checks
app/
  public/data/*.json    # written by the pipeline
  public/data-mock/     # synthetic data for development
  scripts/              # mock data generator
  src/
    App.tsx             # header, tabs, arrow keys
    data.ts  types.ts   # loading and JSON formats
    metrics.ts  time.ts # calculations and time formatting
    processLog.ts       # the pipeline's steps, for uploads in the browser
    screens/            # one file per tab
    components/ui/      # shadcn/ui components (add more with: npx shadcn@latest add <name>)
summarize_gaze.py       # separate per-second summary tool, with its tests in test_summarize_gaze.py
```

## Gaze summary tool

`summarize_gaze.py` compresses a DISCOVER gaze export (`.xlsx`, `.csv` or `.tsv`) into a per-second JSON summary of relevant objects for each user. The app doesn't read its output, because each second holds one object and the app needs merged visits with start times and dwell. The pipeline does reuse its code: `read_gaze_file` loads the log, and its object filter is the starting point for the draft lane map.

It needs Python 3.10+ and `openpyxl`:

```powershell
python -m pip install -r requirements.txt
python summarize_gaze.py "path\to\export.xlsx" -o gaze_summary.json
python -m unittest discover -v
```

Run interactively, it asks whether to condense similar object names. The optional flags are:

- `--condense` / `--no-condense`: turn condensing on or off without the prompt, for example `Stryker_bed_*` -> `Stryker_bed`.
- `--sheet <SheetName>`: read one worksheet. By default it reads every sheet with `user_id`, `object_id`, `gaze_time` and `time_stamp` columns.
- `--ignore <Object1> <Object2> ...`: exclude more objects on top of the built-in list.
- `--include-timestamps`: add the wall-clock `"timestamp"` to each per-second entry.

Pass any DISCOVER eye-gaze `.xlsx` (or `.csv` / `.tsv`) file:

```powershell
python summarize_gaze.py "C:\Users\lukew\Downloads\DISCOVER_eye_gaze_focus_per_second.xlsx" -o gaze_summary.json
```

When run interactively in the terminal, it will ask:
1. Whether you want to upload an **ideal user** Excel/CSV file (`[y/N, or paste file path]`).
2. If provided, which **ideal user** (`idealUser0`, `idealUser1`, …) matches each **original user** (`user1`, `user2`, …), enforced strictly **1-to-1**.
3. Whether you want to **condense** similar object variants (`[y/N]`).

You can also pass everything directly via CLI flags without interactive prompts:

```powershell
python summarize_gaze.py "C:\path\to\learners.xlsx" --ideal "C:\path\to\ideal_users.xlsx" --ideal-match user1=idealUser0 user2=idealUser1 --condense -o gaze_summary.json
```

#### Optional Flags

- `--ideal <FilePath>` / `--no-ideal` — Include an ideal user Excel/CSV dataset (`idealUser0`, `idealUser1`, …), or skip prompting.
- `--ideal-match user1=idealUser0 user2=idealUser1 ...` — Specify strict 1-to-1 user matches without interactive prompts (also accepts indices like `user1=0`).
- `--ideal-sheet <SheetName>` — Read a specific worksheet from the ideal user workbook.
- `--condense` / `--no-condense` — Enable or disable dynamic condensing of similar object variants without prompting.
- `--sheet <SheetName>` — Read only a specific Excel worksheet from the main workbook.
- `--ignore <Object1> <Object2> ...` — Exclude additional `object_id` names on top of the built-in irrelevant collider list.
- `--include-timestamps` — Include the wall-clock `"timestamp"` string in each per-second entry alongside `"second"` and `"object"`.

### Python / Frontend Integration API

```python
from summarize_gaze import get_dataset_users, summarize_excel_to_json

# Optional helper to list original & ideal users for frontend dropdowns:
orig_users = get_dataset_users("eye_gaze_data.xlsx", is_ideal=False)
ideal_users = get_dataset_users("ideal_users.xlsx", is_ideal=True)

summary = summarize_excel_to_json(
    "eye_gaze_data.xlsx",
    "gaze_summary.json",

    ideal_input_path="ideal_users.xlsx",
    ideal_matches={"user1": "idealUser0", "user2": "idealUser1"},  # Strict 1-to-1
    condense_similar=True,
)
```

The built-in filter (`DEFAULT_IRRELEVANT_OBJECTS` and `DEFAULT_IRRELEVANT_PATTERNS`) removes these objects:

- **Player hands and finger bones:** `AutoHandPlayer`, `HeadFollower`, `RobotHandL`, `RobotHandR`, `Thumb*`, `Index*`, `Middle*`, `Ring*`, `Pinky*`
- **Room walls, doors, lighting and fixtures:** `Floor`, `Bckground`, `LoadingScreen`, `RoomCollider*`, `Room_cube_wall`, `Room_frame`, `PassthroughDoor`, `Hinge`, `Knob`, `PushPull`, `glass_panel`, `curved_counter`, `Sink`, `Light`, `LightBulb*`, `boomLight`
- **Unity primitives, UI and avatar rigging:** `Collider`, `ColliderCube*`, `Cube*`, `SpatialPanelManipulator`, `chestRubBlocker`, `FakeTube`, `*IK`, `*Grab*`, `TriggerChestL`, `TriggerChestR`

The draft lane map overrides this filter for `HeadFollower`, which feeds the Communication lane, and for the rig objects on the patient's body. See [`data/README.md`](data/README.md).

## Open questions for the DISCOVER dev team

- Is `HeadFollower` another participant's head? Is `RobotHand*` the learner's own hand or another player's?
- What is `ThermometerSnap2`? It's the most-looked-at equipment object (about 74 s), and two idle looks (about 10 minutes together) also landed on it.
- Can `session_id` and a scenario ID be logged per run?
- Does the headset support true eye tracking, or only the head-forward ray?
- Can gaze timestamps be logged with milliseconds and a look start time?

## Output JSON Format

```json
{
  "relevant_objects": [
    "CodeSheet",
    "PenLight",
    "SPO2",
    "Stryker_bed"
  ],
  "ideal_matches": {
    "user1": "idealUser1",
    "user2": "idealUser0",
    "user3": null
  },
  "user1": [
    { "second": 0, "object": "SPO2" },
    { "second": 1, "object": null }
  ],
  "user2": [
    { "second": 0, "object": "Stryker_bed" }
  ],
  "user3": [
    { "second": 0, "object": "SPO2" }
  ],
  "idealUser0": [
    { "second": 0, "object": "PenLight" }
  ],
  "idealUser1": [
    { "second": 0, "object": "CodeSheet" }
  ]
}
```

## More detail

The full build spec covers pipeline steps, JSON output formats, expected numbers for testing, per-screen requirements and the demo script. It isn't in this repo, so ask Tam Le if you need it.
