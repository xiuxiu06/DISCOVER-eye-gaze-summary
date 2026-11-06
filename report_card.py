#!/usr/bin/env python3
"""
DISCOVER Learner Report Card Generator (Powered by Anthropic Claude API)

Takes a summarized eye-gaze JSON file containing original learners (`user1`, `user2`, ...)
and matched benchmark clinicians (`idealUser0`, `idealUser1`, ...), computes exact
quantitative gaze & timing metrics, sends the structured comparison to Claude, and
outputs both:
  1. A structured JSON report card (`<stem>_report_card.json`) ready for frontend UI rendering
  2. A formatted Markdown report card (`<stem>_report_card.md`) and terminal printout
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models"
ANTHROPIC_VERSION = "2023-06-01"
FALLBACK_CLAUDE_MODEL = "claude-sonnet-5-5"
DEFAULT_MAX_TOKENS = 64000

REPORT_CARD_SYSTEM_PROMPT = """\
You are an Attending Pediatric Critical Care Simulation Educator and Human-Factors Specialist \
for the DISCOVER Virtual Reality clinical training platform at Cincinnati Children's Hospital.

You are evaluating trainee clinicians ("original users") based on their second-by-second VR \
eye-gaze timelines compared directly against a matched expert benchmark clinician ("idealUser").

### Grading Criteria & Rubric (Weighting)
Evaluate each learner across these 5 clinical simulation criteria:
1. **Situational Awareness & Early Assessment (25%)**:
   - Did the learner establish baseline situational awareness early in the scenario by checking \
vital signs and monitors (e.g., `ekg`, `SPO2`, `RR`, `T3_monitor_screen`, `HFNC_Screen`, `Screen`) \
at a similar time to the ideal user?
   - Did they periodically re-scan monitors rather than experiencing tunnel vision?
2. **Completeness of Clinical Exam & Critical Checks (25%)**:
   - Did the learner inspect the key diagnostic, physical exam, and safety targets viewed by the \
ideal user (e.g., `CodeSheet`, `ChestSounds` / `Stethoscope`, `Pulse` / `GroinHaptics`, \
`Caprefill`, `Thermometer`, `Eye` / `PenLight`, `Liver`, `iStat`), or were critical checks missed?
3. **Workflow Sequencing & Clinical Prioritization (20%)**:
   - How closely did the chronological order of the learner's visual attention follow the ideal \
clinician's workflow (e.g., assessing patient/vitals before applying airway/oxygen support such \
as `Nasal_Canula`, `Bipap`, `Rebreather`, `AirwayBundle`, or checking `CodeSheet` prior to IV/meds)?
4. **Visual Focus Allocation & Task Efficiency (15%)**:
   - Did the learner maintain appropriate active clinical focus vs. unfocused `null` time, and \
avoid getting overly fixated on mechanical objects (e.g., bed rails/levers) at the expense of \
patient monitoring?
5. **Closed-Loop Re-Evaluation After Interventions (15%)**:
   - After looking at therapeutic equipment (`Nasal_Canula`, `Bipap`, `Rebreather`, `IV`, \
`BloodDraw`, `MedLineSnap`, `eCPR`), did the learner return their gaze to the patient or vital \
sign monitors to verify treatment effect, as modeled by the ideal user?

### Grading Scale
Assign a specific letter grade (`A+`, `A`, `A-`, `B+`, `B`, `B-`, `C+`, `C`, `C-`, `D`, or `F`) \
and a corresponding numeric score (`0`–`100`) grounded strictly in the evidence from the data.

### Output Requirements
- **Cite specific evidence**: Reference exact timestamps (e.g., `t = 4s`, `t = 38s–44s`), dwell \
durations (in seconds), visit/re-check counts, and exact object names from the dataset when \
pointing out what you noticed.
- **Constructive Socratic Follow-Up Questions**: Write 3–5 specific debriefing questions per \
learner that a simulation instructor could ask them about concrete moments in their timeline \
(e.g., missed objects, delayed monitor checks, or prolonged fixation).
- **Return ONLY valid JSON** matching the exact schema below (no markdown code fences or extra prose outside the JSON):

{
  "cohort_summary": "2-4 sentence high-level takeaway across the evaluated learner(s).",
  "reports": {
    "<user_key>": {
      "matched_ideal_user": "<idealUser_key>",
      "letter_grade": "B+",
      "numeric_score": 87,
      "executive_summary": "Concise 2-4 sentence summary of how this learner performed relative to their matched ideal user.",
      "criteria_breakdown": [
        {
          "criterion": "Situational Awareness & Early Assessment",
          "grade": "A-",
          "rationale": "Specific comparison citing timestamps and objects..."
        },
        {
          "criterion": "Completeness of Clinical Exam & Critical Checks",
          "grade": "B",
          "rationale": "..."
        },
        {
          "criterion": "Workflow Sequencing & Clinical Prioritization",
          "grade": "B+",
          "rationale": "..."
        },
        {
          "criterion": "Visual Focus Allocation & Task Efficiency",
          "grade": "A-",
          "rationale": "..."
        },
        {
          "criterion": "Closed-Loop Re-Evaluation After Interventions",
          "grade": "B",
          "rationale": "..."
        }
      ],
      "specific_observations": [
        "Detailed observation #1 citing exact seconds/durations vs. ideal user...",
        "Detailed observation #2...",
        "Detailed observation #3...",
        "Detailed observation #4..."
      ],
      "strengths": [
        "Specific clinical visual behavior done well..."
      ],
      "missed_or_delayed_checks": [
        "Specific object missed or checked significantly later than the ideal user..."
      ],
      "follow_up_questions": [
        "Targeted Socratic debriefing question #1...",
        "Targeted Socratic debriefing question #2...",
        "Targeted Socratic debriefing question #3..."
      ],
      "recommended_next_focus": "1-2 sentence targeted recommendation for what this learner should practice in their next DISCOVER VR simulation scenario."
    }
  }
}
"""


def _load_dotenv_key(var_name: str = "ANTHROPIC_API_KEY") -> str | None:
    """Look for `var_name` in `.env` in the current working directory or script directory."""
    candidate_dirs = [Path.cwd(), Path(__file__).resolve().parent]
    for directory in candidate_dirs:
        env_file = directory / ".env"
        if not env_file.is_file():
            continue
        for raw_line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() == var_name:
                cleaned = v.strip().strip("\"'").strip()
                if cleaned and cleaned != "sk-ant-your-key-here":
                    return cleaned
    return None


def resolve_api_key(explicit_key: str | None = None, allow_prompt: bool = True) -> str:
    """
    Resolve Anthropic API key from:
      1. Explicit CLI/function parameter
      2. `ANTHROPIC_API_KEY` environment variable
      3. Local `.env` file
      4. Interactive terminal prompt (with option to save to git-ignored `.env`)
    """
    if explicit_key and explicit_key.strip():
        return explicit_key.strip()

    env_val = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if env_val:
        return env_val

    dotenv_val = _load_dotenv_key("ANTHROPIC_API_KEY")
    if dotenv_val:
        return dotenv_val

    if allow_prompt and sys.stdin and sys.stdin.isatty():
        print("No ANTHROPIC_API_KEY found in environment or .env file.")
        entered = input("Paste your Anthropic (Claude) API key: ").strip().strip("\"'")
        if entered:
            save_ans = (
                input("Save this key to local .env (git-ignored) for future runs? [Y/n]: ")
                .strip()
                .lower()
            )
            if save_ans in {"", "y", "yes"}:
                env_path = Path.cwd() / ".env"
                with env_path.open("a", encoding="utf-8") as f:
                    f.write(f"\nANTHROPIC_API_KEY={entered}\n")
                print(f"Saved API key to {env_path}")
            return entered

    raise ValueError(
        "Anthropic API key is required. Set ANTHROPIC_API_KEY in a local `.env` file, "
        "export ANTHROPIC_API_KEY in your terminal, or pass `--api-key <key>`."
    )


def resolve_best_claude_model(api_key: str, explicit_model: str | None = None) -> str:
    """
    If `explicit_model` (or `ANTHROPIC_MODEL`) is provided, use it directly.
    Otherwise query `/v1/models` to select the newest available Claude Sonnet model on this key.
    """
    if explicit_model and explicit_model.strip():
        return explicit_model.strip()

    env_model = os.environ.get("ANTHROPIC_MODEL", "").strip()
    if env_model:
        return env_model

    req = urllib.request.Request(
        ANTHROPIC_MODELS_URL,
        headers={
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            models = [
                m for m in payload.get("data", []) if isinstance(m, dict) and "id" in m
            ]
            models.sort(key=lambda m: str(m.get("created_at", "")), reverse=True)
            model_ids = [str(m["id"]) for m in models]
            for mid in model_ids:
                if "sonnet" in mid.lower():
                    return mid
            if model_ids:
                return model_ids[0]
    except Exception:
        pass

    return FALLBACK_CLAUDE_MODEL


def compress_timeline_runs(timeline: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Convert a second-by-second list `[{"second": 0, "object": "SPO2"}, ...]` into
    compact, lossless run-length intervals `[{"start_s": 0, "end_s": 2, "dur_s": 3, "object": "SPO2"}, ...]`.
    """
    if not timeline:
        return []

    runs: list[dict[str, Any]] = []
    cur_obj = timeline[0].get("object")
    start_s = int(timeline[0].get("second", 0))
    prev_s = start_s

    for item in timeline[1:]:
        sec = int(item.get("second", prev_s + 1))
        obj = item.get("object")
        if obj == cur_obj and sec == prev_s + 1:
            prev_s = sec
        else:
            runs.append(
                {
                    "start_s": start_s,
                    "end_s": prev_s,
                    "dur_s": prev_s - start_s + 1,
                    "object": cur_obj,
                }
            )
            cur_obj = obj
            start_s = sec
            prev_s = sec

    runs.append(
        {
            "start_s": start_s,
            "end_s": prev_s,
            "dur_s": prev_s - start_s + 1,
            "object": cur_obj,
        }
    )
    return runs


def summarize_single_timeline_stats(timeline: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute exact duration, active ratio, first-fixation latency, and bout counts for one timeline."""
    total_seconds = len(timeline)
    active_seconds = sum(1 for item in timeline if item.get("object") is not None)
    null_seconds = total_seconds - active_seconds

    runs = compress_timeline_runs(timeline)
    dwell_by_obj: dict[str, int] = defaultdict(int)
    first_seen_by_obj: dict[str, int] = {}
    bouts_by_obj: dict[str, int] = defaultdict(int)

    for run in runs:
        obj = run["object"]
        if obj is None:
            continue
        dwell_by_obj[obj] += run["dur_s"]
        bouts_by_obj[obj] += 1
        if obj not in first_seen_by_obj:
            first_seen_by_obj[obj] = run["start_s"]

    return {
        "total_seconds": total_seconds,
        "active_clinical_seconds": active_seconds,
        "unfocused_null_seconds": null_seconds,
        "active_focus_pct": round((100.0 * active_seconds / total_seconds), 1) if total_seconds else 0.0,
        "dwell_by_obj": dict(dwell_by_obj),
        "first_seen_by_obj": first_seen_by_obj,
        "bouts_by_obj": dict(bouts_by_obj),
        "runs": runs,
    }


def _format_runs_compact(runs: list[dict[str, Any]], max_segments: int = 500) -> list[str]:
    """
    Format clinical run-length intervals concisely like `'0-2s: SPO2 (3s)'`.
    Because each interval carries exact absolute timestamps (and `overview_metrics` provides exact
    total/null seconds), omitting intermediate `null` gaps whenever clinical intervals exist halves
    prompt size and Claude thinking overhead without losing gap timing.
    """
    non_null = [r for r in runs if r["object"] is not None]
    selected = non_null if non_null else runs
    omitted_middle = 0

    if len(selected) > max_segments:
        multi_sec = [r for r in selected if r["dur_s"] >= 2]
        if len(multi_sec) >= max_segments // 2:
            selected = multi_sec[:max_segments]
        else:
            half = max_segments // 2
            omitted_middle = len(selected) - (2 * half)
            selected = selected[:half] + selected[-half:]

    def _fmt(r: dict[str, Any]) -> str:
        label = "null" if r["object"] is None else str(r["object"])
        if r["start_s"] == r["end_s"]:
            return f"{r['start_s']}s: {label} (1s)"
        return f"{r['start_s']}-{r['end_s']}s: {label} ({r['dur_s']}s)"

    if omitted_middle > 0:
        half = max_segments // 2
        head = [_fmt(r) for r in selected[:half]]
        tail = [_fmt(r) for r in selected[half:]]
        return (
            head
            + [f"... ({omitted_middle} brief 1s glances omitted; exact totals in per_object_comparison) ..."]
            + tail
        )

    return [_fmt(r) for r in selected]


def build_comparison_digest(gaze_data: dict[str, Any]) -> dict[str, Any]:
    """
    Extract matched `(original_user, ideal_user)` pairs from `gaze_data` and build an exact
    quantitative + chronological comparison payload for Claude.
    """
    # Support both multi-ideal (`ideal_matches` + `idealUser0`...) and single `idealUser` formats
    ideal_matches: dict[str, str | None] = {}
    if "ideal_matches" in gaze_data and isinstance(gaze_data["ideal_matches"], dict):
        ideal_matches = {k: v for k, v in gaze_data["ideal_matches"].items()}
    elif "idealUser" in gaze_data and isinstance(gaze_data["idealUser"], list):
        for k, v in gaze_data.items():
            if k not in {"relevant_objects", "idealUser", "ideal_matches"} and isinstance(v, list):
                ideal_matches[k] = "idealUser"
    else:
        # Check if idealUser0, idealUser1 exist without explicit ideal_matches
        orig_keys = [
            k
            for k, v in gaze_data.items()
            if k not in {"relevant_objects", "ideal_matches"}
            and not k.startswith("idealUser")
            and isinstance(v, list)
        ]
        ideal_keys = [
            k for k, v in gaze_data.items() if k.startswith("idealUser") and isinstance(v, list)
        ]
        for uk, ik in zip(orig_keys, ideal_keys):
            ideal_matches[uk] = ik

    active_pairs: list[tuple[str, str]] = [
        (uk, ik)
        for uk, ik in ideal_matches.items()
        if ik is not None and uk in gaze_data and ik in gaze_data
    ]
    unmatched_learners: list[str] = [
        uk for uk, ik in ideal_matches.items() if ik is None and uk in gaze_data
    ]

    if not active_pairs:
        raise ValueError(
            "No matched `(user, idealUser)` pairs found in the JSON file. "
            "Make sure you generated the JSON with an ideal user dataset (`--ideal <file.xlsx>`) "
            "and matched at least one original user to an ideal user."
        )

    comparisons: dict[str, Any] = {}
    for user_key, ideal_key in active_pairs:
        u_stats = summarize_single_timeline_stats(gaze_data[user_key])
        i_stats = summarize_single_timeline_stats(gaze_data[ideal_key])

        all_objs = sorted(
            set(u_stats["dwell_by_obj"].keys()) | set(i_stats["dwell_by_obj"].keys()),
            key=lambda o: -(i_stats["dwell_by_obj"].get(o, 0) + u_stats["dwell_by_obj"].get(o, 0)),
        )

        object_comparison: list[dict[str, Any]] = []
        for obj in all_objs:
            u_dwell = u_stats["dwell_by_obj"].get(obj, 0)
            i_dwell = i_stats["dwell_by_obj"].get(obj, 0)
            object_comparison.append(
                {
                    "object": obj,
                    "learner_seconds": u_dwell,
                    "ideal_seconds": i_dwell,
                    "learner_first_seen_s": u_stats["first_seen_by_obj"].get(obj),
                    "ideal_first_seen_s": i_stats["first_seen_by_obj"].get(obj),
                    "learner_look_count": u_stats["bouts_by_obj"].get(obj, 0),
                    "ideal_look_count": i_stats["bouts_by_obj"].get(obj, 0),
                }
            )

        missed_by_learner = [
            obj for obj in all_objs if i_stats["dwell_by_obj"].get(obj, 0) > 0 and u_stats["dwell_by_obj"].get(obj, 0) == 0
        ]
        only_viewed_by_learner = [
            obj for obj in all_objs if u_stats["dwell_by_obj"].get(obj, 0) > 0 and i_stats["dwell_by_obj"].get(obj, 0) == 0
        ]

        comparisons[user_key] = {
            "matched_ideal_user": ideal_key,
            "overview_metrics": {
                "learner_total_seconds": u_stats["total_seconds"],
                "ideal_total_seconds": i_stats["total_seconds"],
                "learner_active_clinical_seconds": u_stats["active_clinical_seconds"],
                "ideal_active_clinical_seconds": i_stats["active_clinical_seconds"],
                "learner_active_focus_pct": u_stats["active_focus_pct"],
                "ideal_active_focus_pct": i_stats["active_focus_pct"],
            },
            "objects_viewed_by_ideal_but_missed_by_learner": missed_by_learner,
            "objects_viewed_only_by_learner": only_viewed_by_learner,
            "per_object_comparison": object_comparison,
            "ideal_chronological_sequence": _format_runs_compact(i_stats["runs"]),
            "learner_chronological_sequence": _format_runs_compact(u_stats["runs"]),
        }

    return {
        "relevant_objects_catalog": gaze_data.get("relevant_objects", []),
        "evaluated_learners": comparisons,
        "unmatched_learners": unmatched_learners,
    }


def _extract_json_from_claude_text(text: str) -> dict[str, Any]:
    """Parse Claude's JSON response cleanly, stripping markdown code fences if present."""
    stripped = text.strip()
    fence_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", stripped, flags=re.DOTALL)
    if fence_match:
        stripped = fence_match.group(1).strip()
    else:
        first_brace = stripped.find("{")
        last_brace = stripped.rfind("}")
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            stripped = stripped[first_brace : last_brace + 1]

    return json.loads(stripped)


def _read_claude_http_response(
    resp: Any,
    default_model: str,
    show_progress: bool = False,
) -> tuple[str, str, str | None]:
    """
    Read either an Anthropic SSE stream (`"stream": true`) or a standard JSON response body.
    Returns `(combined_text, model_used, stop_reason)`.
    """
    def _iter_lines() -> Any:
        if hasattr(resp, "readline"):
            while True:
                chunk = resp.readline()
                if not chunk:
                    break
                yield chunk
        else:
            for chunk in resp.read().splitlines(keepends=True):
                yield chunk

    line_iter = _iter_lines()
    first_nonempty: bytes | None = None
    for raw in line_iter:
        if raw.strip():
            first_nonempty = raw
            break

    if first_nonempty is None:
        return "", default_model, None

    # Non-streamed JSON body fallback (e.g. unit test mocks or non-SSE proxies)
    if first_nonempty.lstrip().startswith(b"{"):
        remaining = b"".join(line_iter)
        raw_resp = json.loads((first_nonempty + remaining).decode("utf-8"))
        content_blocks = raw_resp.get("content", [])
        text_parts = [
            block.get("text", "")
            for block in content_blocks
            if isinstance(block, dict) and block.get("type") == "text"
        ]
        return (
            "\n".join(text_parts).strip(),
            raw_resp.get("model", default_model),
            raw_resp.get("stop_reason"),
        )

    # Server-Sent Events (SSE) stream parser
    model_used = default_model
    stop_reason: str | None = None
    text_chunks: list[str] = []
    saw_thinking = False
    saw_text = False

    def _handle_sse_line(raw_bytes: bytes) -> None:
        nonlocal model_used, stop_reason, saw_thinking, saw_text
        line = raw_bytes.decode("utf-8", errors="replace").strip()
        if not line.startswith("data:"):
            return
        data_str = line[5:].strip()
        if not data_str or data_str == "[DONE]":
            return
        evt = json.loads(data_str)
        etype = evt.get("type")
        if etype == "message_start":
            model_used = evt.get("message", {}).get("model", model_used)
        elif etype == "content_block_delta":
            delta = evt.get("delta", {})
            dtype = delta.get("type")
            if dtype == "thinking_delta":
                if show_progress and not saw_thinking:
                    print("  Claude is analyzing timelines (adaptive thinking)...", flush=True)
                saw_thinking = True
            elif dtype == "text_delta":
                if show_progress and not saw_text:
                    print("  Claude is writing the report card...", flush=True)
                saw_text = True
                text_chunks.append(delta.get("text", ""))
        elif etype == "message_delta":
            stop_reason = evt.get("delta", {}).get("stop_reason") or stop_reason
        elif etype == "error":
            err = evt.get("error", evt)
            raise RuntimeError(f"Claude API stream error (model='{model_used}'): {err}")

    _handle_sse_line(first_nonempty)
    for raw in line_iter:
        _handle_sse_line(raw)

    return "".join(text_chunks).strip(), model_used, stop_reason


def call_claude_for_report_card(
    digest: dict[str, Any],
    api_key: str,
    model: str | None = None,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    timeout_seconds: int = 300,
    show_progress: bool = False,
) -> tuple[dict[str, Any], str]:
    """
    Send the comparison digest to Anthropic's Messages API (streaming SSE) and return
    `(parsed_report_dict, model_used)`.
    """
    chosen_model = resolve_best_claude_model(api_key=api_key, explicit_model=model)
    claude_payload = {
        "relevant_objects_catalog": digest.get("relevant_objects_catalog", []),
        "evaluated_learners": digest.get("evaluated_learners", {}),
    }

    user_message = (
        "Generate a comprehensive DISCOVER VR Simulation Report Card for each learner below by "
        "comparing their eye-gaze data and chronological sequence against their matched ideal user.\n\n"
        "Eye-Gaze Comparison Dataset:\n"
        f"{json.dumps(claude_payload, indent=2)}"
    )

    request_body = json.dumps(
        {
            "model": chosen_model,
            "max_tokens": max_tokens,
            "stream": True,
            "system": REPORT_CARD_SYSTEM_PROMPT,
            "messages": [
                {"role": "user", "content": user_message},
            ],
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        ANTHROPIC_API_URL,
        data=request_body,
        headers={
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
            combined_text, model_used, stop_reason = _read_claude_http_response(
                resp,
                default_model=chosen_model,
                show_progress=show_progress,
            )
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Claude API HTTP {exc.code} error (model='{chosen_model}'): {err_body}"
        ) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error connecting to Claude API: {exc.reason}") from exc

    if stop_reason == "max_tokens":
        raise RuntimeError(
            f"Claude hit max_tokens={max_tokens} before finishing the JSON report "
            f"(model='{model_used}'). Re-run with `--max-tokens 128000`."
        )

    if not combined_text:
        raise RuntimeError(
            f"Claude returned no text output (model='{model_used}', stop_reason='{stop_reason}')."
        )

    try:
        report_dict = _extract_json_from_claude_text(combined_text)
    except json.JSONDecodeError:
        # Resilient fallback if non-JSON prose was returned
        report_dict = {"raw_markdown_report": combined_text, "reports": {}}

    report_dict["model_used"] = model_used
    if digest.get("unmatched_learners"):
        report_dict["unmatched_learners"] = digest["unmatched_learners"]
    return report_dict, model_used


def render_report_card_markdown(report_data: dict[str, Any]) -> str:
    """Format the structured report card dictionary into a clean, readable Markdown report."""
    if "raw_markdown_report" in report_data and not report_data.get("reports"):
        return str(report_data["raw_markdown_report"])

    lines: list[str] = ["# DISCOVER VR Simulation — Learner Report Card", ""]
    if report_data.get("model_used"):
        lines.append(f"*Evaluated with Claude (`{report_data['model_used']}`)*")
        lines.append("")

    unmatched = report_data.get("unmatched_learners") or []
    if unmatched:
        lines.append(f"*Unmatched learners skipped (no ideal benchmark assigned): {', '.join(unmatched)}*")
        lines.append("")

    cohort = report_data.get("cohort_summary")
    if cohort:
        lines.append("## Cohort Overview")
        lines.append(str(cohort))
        lines.append("")

    reports = report_data.get("reports", {})
    for user_key, rpt in reports.items():
        ideal_key = rpt.get("matched_ideal_user", "idealUser")
        grade = rpt.get("letter_grade", "N/A")
        score = rpt.get("numeric_score")
        score_str = f" ({score}/100)" if score is not None else ""

        lines.append("---")
        lines.append(f"## {user_key} — Overall Grade: **{grade}**{score_str}")
        lines.append(f"**Benchmark Comparison:** `{ideal_key}`")
        lines.append("")

        if rpt.get("executive_summary"):
            lines.append(str(rpt["executive_summary"]))
            lines.append("")

        criteria = rpt.get("criteria_breakdown", [])
        if criteria:
            lines.append("### Rubric Breakdown")
            for c in criteria:
                c_name = c.get("criterion", "Criterion")
                c_grade = c.get("grade", "-")
                c_rat = c.get("rationale", "")
                lines.append(f"- **{c_name}** (`{c_grade}`): {c_rat}")
            lines.append("")

        observations = rpt.get("specific_observations", [])
        if observations:
            lines.append("### Specific Gaze & Workflow Observations")
            for obs in observations:
                lines.append(f"- {obs}")
            lines.append("")

        strengths = rpt.get("strengths", [])
        if strengths:
            lines.append("### Key Strengths")
            for s in strengths:
                lines.append(f"- {s}")
            lines.append("")

        missed = rpt.get("missed_or_delayed_checks", [])
        if missed:
            lines.append("### Missed or Delayed Checks")
            for m in missed:
                lines.append(f"- {m}")
            lines.append("")

        questions = rpt.get("follow_up_questions", [])
        if questions:
            lines.append("### Debriefing Follow-Up Questions")
            for idx, q in enumerate(questions, start=1):
                lines.append(f"{idx}. {q}")
            lines.append("")

        next_focus = rpt.get("recommended_next_focus")
        if next_focus:
            lines.append("### Recommended Next Practice Focus")
            lines.append(str(next_focus))
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def generate_report_card_from_json(
    json_input_path: str | Path,
    json_output_path: str | Path | None = None,
    markdown_output_path: str | Path | None = None,
    api_key: str | None = None,
    model: str | None = None,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    allow_key_prompt: bool = True,
    show_progress: bool = False,
) -> dict[str, Any]:
    """
    High-level Python / frontend helper: read `gaze_summary.json`, call Claude API,
    write `<stem>_report_card.json` and `<stem>_report_card.md`, and return the report dict.
    """
    in_path = Path(json_input_path)
    if not in_path.is_file():
        raise FileNotFoundError(f"Summary JSON file not found: {in_path}")

    gaze_data = json.loads(in_path.read_text(encoding="utf-8"))
    digest = build_comparison_digest(gaze_data)
    resolved_key = resolve_api_key(explicit_key=api_key, allow_prompt=allow_key_prompt)

    report_dict, _ = call_claude_for_report_card(
        digest=digest,
        api_key=resolved_key,
        model=model,
        max_tokens=max_tokens,
        show_progress=show_progress,
    )

    out_json = (
        Path(json_output_path)
        if json_output_path is not None
        else in_path.with_name(f"{in_path.stem}_report_card.json")
    )
    out_md = (
        Path(markdown_output_path)
        if markdown_output_path is not None
        else in_path.with_name(f"{in_path.stem}_report_card.md")
    )

    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(report_dict, indent=2) + "\n", encoding="utf-8")

    md_text = render_report_card_markdown(report_dict)
    out_md.parent.mkdir(parents=True, exist_ok=True)
    out_md.write_text(md_text, encoding="utf-8")

    return report_dict


def _clean_user_path_input(raw: str) -> str:
    """Strip surrounding quotes and PowerShell `& ` prefixes from dragged/pasted terminal paths."""
    cleaned = re.sub(r"^&\s*", "", raw.strip())
    return cleaned.strip().strip("\"'").strip()


def _discover_default_summary_json(directory: Path) -> Path | None:
    """Auto-detect a single gaze summary JSON in `directory` if none was passed on CLI."""
    if (directory / "gaze_summary.json").is_file():
        return directory / "gaze_summary.json"
    candidates = [
        p
        for p in directory.iterdir()
        if p.is_file()
        and p.suffix.lower() == ".json"
        and not p.name.endswith("_report_card.json")
    ]
    if len(candidates) == 1:
        return candidates[0]
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Upload a DISCOVER eye-gaze summary JSON (containing original and ideal users) "
            "to the Anthropic Claude API to generate clinical learner report cards."
        )
    )
    parser.add_argument(
        "summary_json",
        nargs="?",
        help="Path to the gaze_summary.json file (auto-detects gaze_summary.json if omitted).",
    )
    parser.add_argument(
        "-o",
        "--output-md",
        default=None,
        help="Output path for Markdown report card (default: <stem>_report_card.md).",
    )
    parser.add_argument(
        "--output-json",
        default=None,
        help="Output path for structured JSON report card (default: <stem>_report_card.json).",
    )
    parser.add_argument(
        "--api-key",
        default=None,
        help="Anthropic API key (or set ANTHROPIC_API_KEY in environment / .env file).",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="Claude model ID override (default: auto-selects newest available Claude Sonnet model).",
    )
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=DEFAULT_MAX_TOKENS,
        help=f"Maximum output + adaptive thinking tokens for Claude (default: {DEFAULT_MAX_TOKENS}).",
    )

    args = parser.parse_args(argv)

    input_path: Path | None
    if args.summary_json:
        input_path = Path(_clean_user_path_input(args.summary_json)).expanduser()
    else:
        input_path = _discover_default_summary_json(Path.cwd())
        if input_path is None and sys.stdin and sys.stdin.isatty():
            try:
                entered = _clean_user_path_input(
                    input("Enter path to gaze summary JSON file (e.g., gaze_summary.json): ")
                )
            except EOFError:
                entered = ""
            if entered:
                input_path = Path(entered).expanduser()
        if input_path is None:
            parser.print_usage(sys.stderr)
            print(
                "\nError: Please specify the gaze summary JSON file, e.g.:\n"
                "  python report_card.py gaze_summary.json",
                file=sys.stderr,
            )
            return 1
        if not args.summary_json:
            print(f"Using summary JSON: {input_path}")

    out_json = (
        Path(args.output_json)
        if args.output_json
        else input_path.with_name(f"{input_path.stem}_report_card.json")
    )
    out_md = (
        Path(args.output_md)
        if args.output_md
        else input_path.with_name(f"{input_path.stem}_report_card.md")
    )

    t0 = time.perf_counter()
    try:
        print(f"Analyzing eye-gaze summary '{input_path.name}' and requesting report card from Claude...")
        report_dict = generate_report_card_from_json(
            json_input_path=input_path,
            json_output_path=out_json,
            markdown_output_path=out_md,
            api_key=args.api_key,
            model=args.model,
            max_tokens=args.max_tokens,
            show_progress=True,
        )
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    elapsed = time.perf_counter() - t0
    md_text = render_report_card_markdown(report_dict)
    print("\n" + md_text)
    print(f"Completed in {elapsed:.1f}s")
    print(f"Saved Markdown report card to: {out_md}")
    print(f"Saved JSON report card to:     {out_json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
