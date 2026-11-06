"""Local Python API. Start: python -m uvicorn api:app --host 127.0.0.1 --port 8000"""
from __future__ import annotations

import csv
import hashlib
import io
import math
import os
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, Field, ValidationError, model_validator

import report_card
from pipeline import config
from pipeline.export import build_outputs
from pipeline.load import rows_to_frame
from summarize_gaze import read_gaze_file, summarize_gaze_rows, validate_and_normalize_ideal_matches

app = FastAPI(title="DISCOVER local API")
MAX_FILE_BYTES = 50 * 1024 * 1024
RETENTION_S = 6 * 60 * 60
records: dict[str, dict] = {}
jobs: dict[str, dict] = {}
lock = threading.Lock()
executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="report")


class Criterion(BaseModel):
    criterion: str = Field(min_length=1)
    grade: str = Field(pattern=r"^[ABCDF][+-]?$")
    rationale: str = Field(min_length=1)


class LearnerReport(BaseModel):
    matched_ideal_user: str = Field(pattern=r"^idealUser\d+$")
    letter_grade: str = Field(pattern=r"^[ABCDF][+-]?$")
    numeric_score: float = Field(ge=0, le=100, allow_inf_nan=False, strict=True)
    executive_summary: str = Field(min_length=1)
    criteria_breakdown: list[Criterion] = Field(min_length=1)
    specific_observations: list[str] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    missed_or_delayed_checks: list[str] = Field(default_factory=list)
    follow_up_questions: list[str] = Field(default_factory=list)
    recommended_next_focus: str = Field(min_length=1)


class Report(BaseModel):
    cohort_summary: str = ""
    reports: dict[str, LearnerReport] = Field(default_factory=dict)
    model_used: str = ""
    unmatched_learners: list[str] = Field(default_factory=list)
    raw_markdown_report: str | None = None

    @model_validator(mode="after")
    def has_content(self):
        if not self.reports and not self.raw_markdown_report:
            raise ValueError("Claude returned no report content")
        if any(not key.startswith("user") or not key[4:].isdigit() for key in self.reports):
            raise ValueError("Invalid learner report key")
        return self


class ReportRequest(BaseModel):
    recordingId: str
    matching: dict[str, str | None]


def prune() -> None:
    now = time.time()
    for collection in (records, jobs):
        for key in list(collection):
            if now - collection[key]["created"] > RETENTION_S and collection[key].get("status") != "pending":
                del collection[key]


def read_upload(upload: UploadFile) -> bytes:
    if Path(upload.filename or "").suffix.lower() not in {".csv", ".tsv"}:
        raise ValueError("Please upload a CSV or TSV file.")
    content = upload.file.read(MAX_FILE_BYTES + 1)
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(413, "Each file must be at most 50 MB.")
    if not content:
        raise ValueError("The uploaded file is empty.")
    return content


def read_rows(content: bytes, suffix: str):
    # The original reader requires a path. Temporary files are isolated and always removed.
    with tempfile.TemporaryDirectory(prefix="discover-") as directory:
        path = Path(directory) / ("gaze" + suffix)
        path.write_bytes(content)
        rows = read_gaze_file(path)
    if not rows:
        raise ValueError("No readable gaze rows found. Check the CSV columns and timestamps.")
    for row in rows:
        if not math.isfinite(row.gaze_time) or row.gaze_time < 0:
            raise ValueError("Gaze durations must be finite and nonnegative.")
        if not str(row.user_id).lstrip("-").isdigit():
            raise ValueError("Learner user IDs must be integers.")
    return rows


def summary_for_browser(summary: dict) -> dict:
    return {
        "relevant_objects": summary["relevant_objects"],
        "users": [{"userId": int(key[4:]), "entries": value} for key, value in summary.items()
                  if key.startswith("user") and key[4:].isdigit() and key != "user0"],
    }


@app.get("/api/health")
def health():
    return {"status": "ok", "processor": "python"}


@app.post("/api/analyze")
def analyze(gaze: UploadFile = File(...), ideal: UploadFile | None = File(None), laneMap: UploadFile | None = File(None)):
    try:
        gaze_bytes = read_upload(gaze)
        ideal_bytes = read_upload(ideal) if ideal else b""
        map_bytes = read_upload(laneMap) if laneMap else config.LANE_MAP.read_bytes()
        lane_map = pd.read_csv(io.BytesIO(map_bytes))
        required = {"object_id", "lane", "include"}
        if not required.issubset(lane_map.columns) or lane_map.object_id.duplicated().any():
            raise ValueError("Lane map needs unique object_id values and object_id, lane, include columns.")
        booleans = lane_map.include.astype(str).str.lower()
        if not booleans.isin(["true", "false"]).all():
            raise ValueError("Lane map include values must be True or False.")
        lane_map["include"] = booleans == "true"
        known = {lane[0] for lane in config.LANES}
        if not lane_map.lane.isin(known).all():
            raise ValueError("Lane map contains an unknown clinical lane.")
        if "confidence" not in lane_map:
            lane_map["confidence"] = "draft"
        gaze_rows = read_rows(gaze_bytes, Path(gaze.filename or "gaze.csv").suffix.lower())
        learner_rows = [row for row in gaze_rows if int(row.user_id) != 0]
        if not learner_rows:
            raise ValueError("The log contains only test user 0; no learners remain.")
        ideal_rows = read_rows(ideal_bytes, Path(ideal.filename or "ideal.csv").suffix.lower()) if ideal else None
        output = build_outputs(rows_to_frame(gaze_rows), lane_map, f"{Path(gaze.filename or 'gaze.csv').name}. {config.LANE_MAP_NOTE}")
        if not output["runs"]:
            raise ValueError("No sessions meet the minimum duration. Upload a recording with a session of at least 5 minutes.")
        # Explicit all-unmatched prevents the script's sequential automatic pairing.
        learners = [f"user{user}" for user in sorted({int(row.user_id) for row in learner_rows})]
        matching = {key: None for key in learners}
        combined = summarize_gaze_rows(learner_rows, ideal_rows=ideal_rows, ideal_matches=matching, condense_similar=False)
        condensed = summarize_gaze_rows(learner_rows, ideal_rows=ideal_rows, ideal_matches=matching, condense_similar=True)
        fingerprint = hashlib.sha256()
        for content in (gaze_bytes, ideal_bytes, map_bytes):
            fingerprint.update(len(content).to_bytes(8, "big")); fingerprint.update(content)
        recording_id = fingerprint.hexdigest()
        user_catalog = [{"key": key, "userId": int(key[4:])} for key in learners]
        ideal_catalog = [{"key": key} for key in combined if key.startswith("idealUser")]
        dataset = {
            "origin": "uploaded", "meta": output["meta"], "funnel": output["funnel"],
            "sessions": output["sessions"], "runs": output["runs"], "visits": output["visits"],
            "objectVisits": output["object_visits"], "idle": output["idle"],
            "rawSample": [{"user_id": int(row.user_id), "session_id": int(row.session_id),
                           "object_id": row.object_id, "gaze_time": row.gaze_time,
                           "time_stamp": row.timestamp.strftime("%Y-%m-%d %H:%M:%S")} for row in gaze_rows[:25]],
            "summary": summary_for_browser(condensed), "advancedSummary": summary_for_browser(combined),
        }
        with lock:
            prune()
            if len(records) >= 32 and recording_id not in records:
                raise HTTPException(503, "Analysis capacity reached. Restart the local backend to clear old recordings.")
            records[recording_id] = {"created": time.time(), "summary": combined, "learners": learners, "ideals": [item["key"] for item in ideal_catalog]}
        delimiter = "\t" if Path(gaze.filename or "").suffix.lower() == ".tsv" else ","
        raw_count = max(0, sum(bool(any(cell.strip() for cell in row)) for row in csv.reader(io.StringIO(gaze_bytes.decode("utf-8-sig")), delimiter=delimiter)) - 1)
        unmapped = sorted({row.object_id for row in gaze_rows} - set(lane_map.object_id))
        report_version = hashlib.sha256((report_card.REPORT_CARD_SYSTEM_PROMPT + os.environ.get("ANTHROPIC_MODEL", "auto")).encode()).hexdigest()
        return {"recordingId": recording_id, "reportVersion": report_version, "dataset": dataset, "learners": user_catalog, "ideals": ideal_catalog,
                "skippedRows": max(0, raw_count - len(gaze_rows)), "unmappedObjects": unmapped}
    except HTTPException:
        raise
    except (ValueError, KeyError, IndexError, TypeError, UnicodeError) as exc:
        raise HTTPException(422, str(exc) or "The uploaded data could not be processed.") from exc


def run_report(job_id: str, summary: dict, matching: dict, api_key: str) -> None:
    try:
        payload = dict(summary, ideal_matches=matching)
        digest = report_card.build_comparison_digest(payload)
        result, _ = report_card.call_claude_for_report_card(digest, api_key)
        report = Report.model_validate(result).model_dump(exclude_none=True)
        for user, item in report["reports"].items():
            if user not in matching or matching[user] != item["matched_ideal_user"]:
                raise ValueError("Claude returned a report for an unexpected learner/ideal pair")
        report["unmatched_learners"] = [user for user, ideal in matching.items() if ideal is None]
        with lock:
            jobs[job_id].update(status="completed", report=report)
    except (ValidationError, ValueError):
        with lock:
            jobs[job_id].update(status="failed", error="Claude returned an invalid report or unexpected learner matching. Please retry.")
    except Exception:
        # Do not send credentials, upstream error bodies or stack traces to the browser.
        with lock:
            jobs[job_id].update(status="failed", error="Claude request failed. Check the server API key, model access and network, then retry.")


@app.post("/api/report-jobs", status_code=202)
def create_report(request: ReportRequest):
    with lock:
        prune()
        record = records.get(request.recordingId)
    if record is None:
        raise HTTPException(404, "Recording expired or backend restarted. Reprocess the files in tab 1.")
    try:
        matching = validate_and_normalize_ideal_matches(request.matching, record["learners"], record["ideals"])
        if not any(matching.values()):
            raise ValueError("Select at least one learner/ideal pair in tab 1.")
        api_key = report_card.resolve_api_key(allow_prompt=False)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    with lock:
        for job_id, job in jobs.items():
            if job["recordingId"] == request.recordingId and job["matching"] == matching and job["status"] == "pending":
                return {"jobId": job_id}
        if len(jobs) >= 128:
            raise HTTPException(503, "Report capacity reached. Restart the local backend to clear old jobs.")
        job_id = uuid.uuid4().hex
        jobs[job_id] = {"created": time.time(), "recordingId": request.recordingId, "matching": matching, "status": "pending"}
    executor.submit(run_report, job_id, record["summary"], matching, api_key)
    return {"jobId": job_id}


@app.get("/api/report-jobs/{job_id}")
def get_report(job_id: str):
    with lock:
        prune()
        job = jobs.get(job_id)
        if job is None:
            raise HTTPException(404, "Report job not found. Please retry generation.")
        return {key: value for key, value in job.items() if key in {"status", "report", "error"}}
