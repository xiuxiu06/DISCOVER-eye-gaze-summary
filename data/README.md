# Data

| File | What it is |
|---|---|
| `raw/eye_gaze_tracking_050505092026.csv` | The gaze log. Read-only, and not committed |
| `lane_map.csv` | Maps each of the 159 objects to a lane. **Draft: needs review** |

To rebuild the app's data after changing either file, run `python -m pipeline.run` from the repo root. The output goes to `app/public/data/`, in the formats defined in `app/src/types.ts`.

## Reviewing the lane map

`python -m pipeline.lane_map` created the first draft from object names, starting from the filter in `summarize_gaze.py`. Nobody clinical has reviewed it, so numbers per lane are provisional. Edit `lane_map.csv` by hand, then rerun the pipeline. The script won't overwrite your edits unless you pass `--force`.

| Column | Meaning |
|---|---|
| `object_id` | Object name from the log |
| `lane` | `Reference`, `Patient assessment`, `Vital sign monitor`, `Equipment & interventions`, `Communication`, `Self`, `Bed`, `System` or `Environment` |
| `include` | `True` for the first five lanes, which are drawn and measured. `False` for background |
| `confidence` | `draft` for a guess from the name, `verify` for an uncertain one, which shows "?" in the app. Change it to anything else once reviewed |
| `events`, `dwell_s_excl_idle`, `learners` | Rows, seconds and learners for the object, leaving out idle rows |

## Questions for review

1. **Merge rule:** the spec's reference run has about 559 lane visits of at least 0.5 s, but its stated 1 s merge gap gives 836. A gap near 30 s comes much closer. Which rule produced the reference numbers? The setting is `MERGE_GAP_S` in `pipeline/config.py`, and two tests are marked as expected failures until this is settled.
2. **`HeadFollower`:** the draft uses it for the Communication lane, as the spec does, but `summarize_gaze.py` filters it out as part of the player's body. Is it another participant's head?
3. **Patient rig objects:** `*IK`, `*Grab*`, `TriggerChest*` and `chestRubBlocker` are filtered out by `summarize_gaze.py`. The draft puts them in Patient assessment with `verify`, which brings the included time to the spec's reference number (2,292 s against about 2,293 s). Is that correct?
4. **Bed parts:** `Stryker_bed*` and `linetBed*` count as relevant in `summarize_gaze.py`, but they're background in the spec and the draft. Which do we want?
5. **`ThermometerSnap2`:** what is it? The draft puts it in Equipment & interventions with `verify`.
