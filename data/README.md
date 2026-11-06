# Data files needed for the DISCOVER Gaze Insights app

`gaze_summary.json` can't drive the app because it has no real timestamps, durations, sessions or lanes. Please send these 9 files, generated from `eye_gaze_tracking_050505092026.csv`.

## General rules

- **Location:** put the 8 JSON files in `app/public/data/`. The app needs all 8 and shows an error if any are missing.
- **Encoding:** UTF-8 with no `NaN` values.
- **Clock times (`start` and `end` in sessions and runs):** ISO text with no timezone, as logged, for example `2026-05-06T13:04:08`.
- **Epoch times (`start` and `end` in visits and idle):** seconds, treating the logged clock as UTC, so `2026-05-06 13:04:22` becomes `1778072662`.
- **Timing of each row:** the log writes a row when the gaze leaves an object, so `end = epoch(time_stamp) + 0.5` and `start = end - gaze_time`.

## File list

| # | File | What it contains |
|---|---|---|
| 1 | `data/lane_map.csv` | Maps each of the 159 objects to a lane |
| 2 | `meta.json` | Lanes, thresholds and object lookup |
| 3 | `funnel.json` | Rows and seconds left after each cleaning step |
| 4 | `sessions.json` | One record per learner session |
| 5 | `runs.json` | Sessions grouped into team runs |
| 6 | `visits.json` | Merged looks at each lane |
| 7 | `object_visits.json` | Merged looks at each object |
| 8 | `idle.json` | Idle headset periods |
| 9 | `raw_sample.json` | First 25 raw rows of the main run (2026-05-06, about 13:04–13:55) |

## Formats

The example values below only illustrate the format, apart from the lane names, lane colors, thresholds and raw log totals, which should be used as written.

### 1. `data/lane_map.csv`

Goes in `data/`, not `app/public/data/`.

```csv
object_id,lane,include,confidence,events,dwell_s_excl_idle,learners
MonitorBar,Vital sign monitor,True,high,1200,310.5,4
```

Set `confidence` to `verify` when a mapping is uncertain.

Use these exact lane names:

- **`include=True`:** `Reference`, `Patient assessment`, `Vital sign monitor`, `Equipment & interventions`, `Communication`
- **`include=False`:** `Self`, `Bed`, `System`, `Environment`

### 2. `meta.json`

```json
{
  "generatedAt": "2026-11-06T10:00:00",
  "source": "eye_gaze_tracking_050505092026.csv",
  "params": {
    "IDLE_MAX_S": 30,
    "SESSION_GAP_S": 300,
    "MIN_SESSION_MIN": 5,
    "MERGE_GAP_S": 1,
    "EXPORT_MIN_VISIT_S": 0.1,
    "DEFAULT_MIN_VISIT_S": 0.5,
    "TEAM_OVERLAP_FRAC": 0.5,
    "COVERAGE_WINDOW_S": 30
  },
  "lanes": [
    {
      "id": "Reference",
      "label": "Reference",
      "order": 0,
      "include": true,
      "color": "#3B8EDB",
      "band": "#D6E8F8"
    }
  ],
  "objects": {
    "MonitorBar": { "lane": "Vital sign monitor", "verify": false }
  }
}
```

`objects` must list all 159 objects, including background ones, because the app shows that count. Set `verify` to `true` for objects marked `verify` in the lane map.

`lanes` must include all 9 lanes, in this order:

| `order` | `id` and `label` | `include` | `color` | `band` |
|---|---|---|---|---|
| 0 | Reference | `true` | `#3B8EDB` | `#D6E8F8` |
| 1 | Patient assessment | `true` | `#D6336C` | `#F7D4E1` |
| 2 | Vital sign monitor | `true` | `#7CB342` | `#E3F0D3` |
| 3 | Equipment & interventions | `true` | `#E0A800` | `#FBF0C9` |
| 4 | Communication | `true` | `#5AA9D6` | `#E6F3FA` |
| 5 | Self | `false` | `#9AA0A6` | `#9AA0A6` |
| 6 | Bed | `false` | `#9AA0A6` | `#9AA0A6` |
| 7 | System | `false` | `#9AA0A6` | `#9AA0A6` |
| 8 | Environment | `false` | `#9AA0A6` | `#9AA0A6` |

The `include=false` lanes aren't drawn, so their `band` value isn't used.

### 3. `funnel.json`

One entry per cleaning step. The first entry must be the untouched raw log.

```json
[
  {
    "step": "Raw log",
    "rows": 106803,
    "seconds": 64836.6,
    "note": "Every row in the file."
  }
]
```

### 4. `sessions.json`

```json
[
  {
    "id": "u1-s1",
    "userId": 1,
    "runId": "run-2026-05-06-1304",
    "start": "2026-05-06T13:04:08",
    "end": "2026-05-06T13:51:35",
    "durationMin": 47.45,
    "rawRows": 3984,
    "idleSeconds": 161.9,
    "activeSeconds": 2685.1,
    "inferredHints": ["CodeSheet8kg seen"]
  }
]
```

### 5. `runs.json`

```json
[
  {
    "id": "run-2026-05-06-1304",
    "date": "2026-05-06",
    "start": "2026-05-06T13:04:00",
    "end": "2026-05-06T13:54:02",
    "sessionIds": ["u1-s1", "u2-s1", "u3-s1", "u4-s1"],
    "userIds": [1, 2, 3, 4]
  }
]
```

### 6. `visits.json`

`dwell` is the sum of `gaze_time`. `objects` gives seconds per object.

```json
[
  {
    "sessionId": "u1-s1",
    "userId": 1,
    "runId": "run-2026-05-06-1304",
    "lane": "Communication",
    "start": 1778072662.893,
    "end": 1778072664.226,
    "dwell": 1.333,
    "objects": { "HeadFollower": 1.333 }
  }
]
```

### 7. `object_visits.json`

```json
[
  {
    "sessionId": "u1-s1",
    "userId": 1,
    "runId": "run-2026-05-06-1304",
    "objectId": "HeadFollower",
    "lane": "Communication",
    "start": 1778072662.893,
    "end": 1778072664.226,
    "dwell": 1.333
  }
]
```

### 8. `idle.json`

```json
[
  {
    "sessionId": "u1-s1",
    "userId": 1,
    "start": 1778074310.775,
    "end": 1778074472.715
  }
]
```

### 9. `raw_sample.json`

Same columns as the CSV.

```json
[
  {
    "user_id": 1,
    "session_id": 0,
    "object_id": "MonitorBar",
    "gaze_time": 0.205,
    "time_stamp": "2026-05-06 13:04:00"
  }
]
```

## Processing steps

1. Drop `user_id == 0`, and sort by user, timestamp and original row order using a stable sort.
2. Mark rows with `gaze_time > 30` as idle. Leave them out of visits and write them to `idle.json`.
3. Start a new session when a user has a gap of more than 300 s between rows, then drop sessions under 5 minutes. Session IDs look like `u{user}-s{n}`.
4. Sort sessions by start time. A session joins the current run if at least 50% of it overlaps the run's time window, which then extends to include it. Otherwise it starts a new run. Run IDs look like `run-{date}-{HHMM}`.
5. Remove `include=False` rows **before** merging, so a glance at a wall doesn't split a visit.
6. Within a session, merge consecutive rows with the same lane if the gap is 1 s or less, then do the same by object for `object_visits.json`. Export only visits with `dwell >= 0.1`.
7. Keep `HeadFollower`, since it feeds the Communication lane.

## Check your output

| Check | Expected (±2%) |
|---|---|
| Raw rows / distinct objects | 106,803 / 159 |
| Rows after dropping user 0 | 106,795 |
| Idle rows | 174 rows, about 41,457 s, about 63.9% of logged seconds |
| Sessions before / after the 5-minute filter | 40 / 23 |
| Non-idle rows in included lanes, kept sessions | about 9,135 rows, about 2,293 s |
| Lane visits ≥ 0.5 s | about 559: Communication 309, Equipment 95, Monitor 94, Patient 55, Reference 6 |
| Main run lane visits ≥ 0.5 s | user 1 about 49, user 2 about 45, user 3 about 27, user 4 about 21 |
