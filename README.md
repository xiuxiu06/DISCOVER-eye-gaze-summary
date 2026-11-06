# DISCOVER-eye-gaze-summary

Python tool for the Cincinnati Children's **DISCOVER** Digital Health Hackathon project that compresses large, high-frequency VR eye-gaze Excel exports into a compact, per-second JSON summary of relevant clinical objects per user (plus optional multi-user `idealUser0`, `idealUser1`, … benchmark matching).

## Setup

Requires Python 3.10+ and `openpyxl`:

```powershell
python -m pip install -r requirements.txt
```

## Usage

### Command Line

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

## Running Tests

```powershell
python -m unittest discover -v
```
