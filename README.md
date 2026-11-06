# DISCOVER-eye-gaze-summary

Python pipeline for the Cincinnati Children's **DISCOVER** Digital Health Hackathon project that:
1. Compresses large, high-frequency VR eye-gaze Excel exports into a compact, per-second JSON summary of relevant clinical objects per learner (`user1`, `user2`, …) and optional expert benchmarks (`idealUser0`, `idealUser1`, …) matched strictly **1-to-1**.
2. Uploads the summarized JSON to the **Anthropic Claude API** (`report_card.py`) to generate clinical **Learner Report Cards** with letter grades, rubric breakdowns, timestamped workflow observations, Socratic debriefing follow-up questions, and next-scenario practice recommendations.

## Setup

Requires Python 3.10+ and `openpyxl`:

```powershell
python -m pip install -r requirements.txt
```

### Setting Your Claude API Key (for Report Cards)

Create a local `.env` file in this folder (already git-ignored via `.gitignore`—copy `.env.example` to `.env`):

```ini
ANTHROPIC_API_KEY=sk-ant-...
```

Or simply run `python report_card.py gaze_summary.json` directly—if no `.env` or `ANTHROPIC_API_KEY` environment variable is set, the terminal will prompt you to paste your key and offer to save it to `.env` for future runs.

---

## Step 1: Summarize Eye-Gaze Excel Data (`summarize_gaze.py`)

### Command Line

Pass any DISCOVER eye-gaze `.xlsx` (or `.csv` / `.tsv`) file:

```powershell
python summarize_gaze.py "C:\Users\lukew\Downloads\DISCOVER_eye_gaze_focus_per_second.xlsx" -o gaze_summary.json
```

When run interactively in the terminal, it will ask:
1. Whether you want to upload an **ideal user** Excel/CSV file (`[y/N, or paste file path]`).
2. If provided, which **ideal user** (`idealUser0`, `idealUser1`, …) matches each **original user** (`user1`, `user2`, …), enforced strictly **1-to-1**.
3. Whether you want to **condense** similar object variants (`[y/N]`).

You can also pass everything directly via CLI flags without interactive prompts (and optionally add `--report-card` to run Step 2 automatically right after):

```powershell
python summarize_gaze.py "C:\path\to\learners.xlsx" --ideal "C:\path\to\ideal_users.xlsx" --ideal-match user1=idealUser0 user2=idealUser1 --condense -o gaze_summary.json
```

#### Optional Flags (`summarize_gaze.py`)

- `--ideal <FilePath>` / `--no-ideal` — Include an ideal user Excel/CSV dataset (`idealUser0`, `idealUser1`, …), or skip prompting.
- `--ideal-match user1=idealUser0 user2=idealUser1 ...` — Specify strict 1-to-1 user matches without interactive prompts (also accepts indices like `user1=0`).
- `--ideal-sheet <SheetName>` — Read a specific worksheet from the ideal user workbook.
- `--condense` / `--no-condense` — Enable or disable dynamic condensing of similar object variants without prompting.
- `--report-card` — Immediately upload the generated JSON to Claude to write the learner report card.
- `--sheet <SheetName>` — Read only a specific Excel worksheet from the main workbook.
- `--ignore <Object1> <Object2> ...` — Exclude additional `object_id` names on top of the built-in irrelevant collider list.
- `--include-timestamps` — Include the wall-clock `"timestamp"` string in each per-second entry alongside `"second"` and `"object"`.

---

## Step 2: Generate Claude Learner Report Card (`report_card.py`)

Upload a summarized JSON file (containing original users + matched ideal users) to the Anthropic Claude API:

```powershell
python report_card.py gaze_summary.json
```

This prints the formatted report card in the terminal and saves two files ready for both instructors and frontend UI integration:
- `gaze_summary_report_card.md` — Clean Markdown report card
- `gaze_summary_report_card.json` — Structured JSON containing `letter_grade`, `numeric_score`, `executive_summary`, `criteria_breakdown`, `specific_observations`, `strengths`, `missed_or_delayed_checks`, `follow_up_questions`, and `recommended_next_focus` per learner

#### Optional Flags (`report_card.py`)

- `-o <Path>` / `--output-md <Path>` — Custom output path for the Markdown report card.
- `--output-json <Path>` — Custom output path for the structured JSON report card.
- `--api-key <Key>` — Pass the Anthropic API key inline (prefer `.env` or `ANTHROPIC_API_KEY`).
- `--model <ModelID>` — Override the Claude model ID (by default, auto-detects the newest Claude Sonnet model available on your API key).

### Clinical Grading Rubric Given to Claude

1. **Situational Awareness & Early Assessment (25%)** — Early baseline vital/monitor checks (`ekg`, `SPO2`, `RR`, `T3_monitor_screen`, `HFNC_Screen`) and periodic re-scanning vs. tunnel vision.
2. **Completeness of Clinical Exam & Critical Checks (25%)** — Coverage of diagnostic/exam/safety targets viewed by the ideal user (`CodeSheet`, `ChestSounds`/`Stethoscope`, `Pulse`/`GroinHaptics`, `Caprefill`, `Thermometer`, `Eye`/`PenLight`, `Liver`, `iStat`).
3. **Workflow Sequencing & Clinical Prioritization (20%)** — Chronological alignment with the expert benchmark (assessing patient/vitals before airway/oxygen interventions or checking `CodeSheet` prior to IV/medication actions).
4. **Visual Focus Allocation & Task Efficiency (15%)** — Active clinical focus vs. unfocused `null` time or excessive fixation on mechanical objects (e.g., bed rails/levers).
5. **Closed-Loop Re-Evaluation After Interventions (15%)** — Returning gaze to monitors or the patient after therapeutic interventions (`Nasal_Canula`, `Bipap`, `Rebreather`, `IV`, `eCPR`) to verify treatment effect.

---

## Python / Frontend Integration API

```python
from summarize_gaze import get_dataset_users, summarize_excel_to_json
from report_card import generate_report_card_from_json

# 1. Inspect Excel files to populate frontend 1-to-1 matching dropdowns
orig_users = get_dataset_users("eye_gaze_data.xlsx", is_ideal=False)
ideal_users = get_dataset_users("ideal_users.xlsx", is_ideal=True)

# 2. Summarize learner + ideal timelines into JSON
summary = summarize_excel_to_json(
    "eye_gaze_data.xlsx",
    "gaze_summary.json",
    ideal_input_path="ideal_users.xlsx",
    ideal_matches={"user1": "idealUser0", "user2": "idealUser1"},  # Strict 1-to-1
    condense_similar=True,
)

# 3. Generate Claude report card (reads ANTHROPIC_API_KEY from .env / env or api_key param)
report = generate_report_card_from_json("gaze_summary.json")
print(report["reports"]["user1"]["letter_grade"])
```

## Running Tests

```powershell
python -m unittest discover -v
```
