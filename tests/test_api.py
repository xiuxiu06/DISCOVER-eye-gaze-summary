"""HTTP-level tests with real Python processing and mocked Claude (no paid API calls)."""
import copy
import json
import threading
import time
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

import api
from pipeline import config
from pipeline.export import build_outputs
from pipeline.load import load_rows
from summarize_gaze import read_gaze_file, summarize_gaze_rows

client = TestClient(api.app)


def csv_file(users=(1, 2), object_id="RR"):
    lines = ["user_id,session_id,object_id,gaze_time,time_stamp"]
    for user in users:
        for clock in ("10:00:00", "10:03:00", "10:06:00"):
            lines.append(f"{user},0,{object_id},1,2026-06-01 {clock}")
    return "\n".join(lines).encode()


@pytest.fixture(autouse=True)
def isolate(monkeypatch):
    with api.lock:
        api.records.clear()
        api.jobs.clear()
    monkeypatch.setattr(api.report_card, "resolve_api_key", lambda **kwargs: "test-key-never-send-to-browser")


def analyze(ideal=True):
    files = {"gaze": ("learner.csv", csv_file(), "text/csv")}
    if ideal:
        files["ideal"] = ("ideal.csv", csv_file((10, 20, 30, 40)), "text/csv")
    response = client.post("/api/analyze", files=files)
    assert response.status_code == 200, response.text
    return response.json()


def wait_job(job_id):
    for _ in range(200):
        job = client.get(f"/api/report-jobs/{job_id}").json()
        if job["status"] != "pending":
            return job
        time.sleep(0.01)
    raise AssertionError("mock job did not finish")


def sample_report():
    data = json.loads((Path(__file__).parent / "fixtures" / "claude-report.json").read_text(encoding="utf-8"))
    data["reports"] = {key: value for key, value in data["reports"].items() if key in {"user1", "user2"}}
    data["unmatched_learners"] = []
    return data


def test_analyze_uses_python_and_explicit_matching():
    result = analyze()
    assert result["learners"] == [{"key": "user1", "userId": 1}, {"key": "user2", "userId": 2}]
    assert len(result["ideals"]) == 4
    assert result["dataset"]["origin"] == "uploaded"
    assert result["dataset"]["summary"]["users"][0]["userId"] == 1
    stored = api.records[result["recordingId"]]["summary"]
    assert stored["ideal_matches"] == {"user1": None, "user2": None}
    assert "idealUser0" in stored
    assert "test-key" not in json.dumps(result)


@pytest.mark.skipif(not config.RAW_LOG.exists(), reason="needs real CSV")
def test_api_matches_existing_pipeline_and_both_summaries():
    response = client.post("/api/analyze", files={"gaze": (config.RAW_LOG.name, config.RAW_LOG.read_bytes(), "text/csv")})
    assert response.status_code == 200, response.text
    dataset = response.json()["dataset"]
    expected = build_outputs(load_rows(config.RAW_LOG), pd.read_csv(config.LANE_MAP), config.RAW_LOG.name)
    for browser, python in [("visits", "visits"), ("objectVisits", "object_visits"), ("runs", "runs"), ("sessions", "sessions"), ("idle", "idle"), ("funnel", "funnel")]:
        assert dataset[browser] == expected[python]
    rows = [row for row in read_gaze_file(config.RAW_LOG) if int(row.user_id) != 0]
    for field, condensed in [("summary", True), ("advancedSummary", False)]:
        assert dataset[field] == api.summary_for_browser(summarize_gaze_rows(rows, condense_similar=condensed))


def test_invalid_files_and_lane_map():
    assert client.post("/api/analyze", files={"gaze": ("a.csv", b"wrong,columns\n1,2")}).status_code == 422
    assert client.post("/api/analyze", files={"gaze": ("a.exe", csv_file())}).status_code == 422
    assert client.post("/api/analyze", files={"gaze": ("a.csv", csv_file((0,)))}).status_code == 422
    assert client.post("/api/analyze", files={"gaze": ("a.csv", csv_file()), "laneMap": ("map.csv", b"object_id,lane,include\nRR,Unknown,True")}).status_code == 422


def test_file_size_limit(monkeypatch):
    monkeypatch.setattr(api, "MAX_FILE_BYTES", 64)
    assert client.post("/api/analyze", files={"gaze": ("a.csv", csv_file())}).status_code == 413


def test_no_ideal_no_matching_duplicate_matching_and_expired_record():
    result = analyze(False)
    assert client.post("/api/report-jobs", json={"recordingId": result["recordingId"], "matching": {"user1": "idealUser0"}}).status_code == 422
    result = analyze()
    for matching in [{}, {"user1": "idealUser0", "user2": "idealUser0"}, {"user0": "idealUser0"}]:
        assert client.post("/api/report-jobs", json={"recordingId": result["recordingId"], "matching": matching}).status_code == 422
    assert client.post("/api/report-jobs", json={"recordingId": "missing", "matching": {}}).status_code == 404
    assert client.get("/api/report-jobs/missing").status_code == 404


def test_mocked_claude_report_preserves_json_and_does_not_regenerate_on_poll(monkeypatch):
    result = analyze()
    calls = []
    report = sample_report()
    def mock(digest, key):
        calls.append(digest)
        assert key == "test-key-never-send-to-browser"
        assert set(digest["evaluated_learners"]) == {"user1", "user2"}
        return report, "mock"
    monkeypatch.setattr(api.report_card, "call_claude_for_report_card", mock)
    job_id = client.post("/api/report-jobs", json={"recordingId": result["recordingId"], "matching": {"user1": "idealUser1", "user2": "idealUser2"}}).json()["jobId"]
    job = wait_job(job_id)
    assert job["status"] == "completed", job
    assert job["report"]["reports"] == report["reports"]
    assert job["report"]["cohort_summary"] == report["cohort_summary"]
    assert "test-key" not in json.dumps(job)
    assert client.get(f"/api/report-jobs/{job_id}").json() == job
    assert len(calls) == 1


def test_pending_job_reused_and_unmatched_learners_retained(monkeypatch):
    result = analyze()
    release = threading.Event()
    def mock(*args):
        assert release.wait(5)
        report = sample_report()
        report["reports"] = {"user1": report["reports"]["user1"]}
        return report, "mock"
    monkeypatch.setattr(api.report_card, "call_claude_for_report_card", mock)
    body = {"recordingId": result["recordingId"], "matching": {"user1": "idealUser1"}}
    try:
        first = client.post("/api/report-jobs", json=body).json()["jobId"]
        assert client.get(f"/api/report-jobs/{first}").json()["status"] == "pending"
        assert client.post("/api/report-jobs", json=body).json()["jobId"] == first
    finally:
        release.set()
    assert wait_job(first)["report"]["unmatched_learners"] == ["user2"]


@pytest.mark.parametrize("failure", ["invalid", "network", "fallback", "wrong_user"])
def test_report_errors_and_fallback(monkeypatch, failure):
    result = analyze()
    def mock(*args):
        if failure == "network":
            raise RuntimeError("secret-upstream-token")
        if failure == "fallback":
            return {"raw_markdown_report": "Plain report text", "reports": {}}, "mock"
        report = sample_report()
        if failure == "invalid": report["reports"]["user1"]["numeric_score"] = 101
        else: report["reports"]["user0"] = copy.deepcopy(report["reports"]["user1"])
        return report, "mock"
    monkeypatch.setattr(api.report_card, "call_claude_for_report_card", mock)
    job_id = client.post("/api/report-jobs", json={"recordingId": result["recordingId"], "matching": {"user1": "idealUser1", "user2": "idealUser2"}}).json()["jobId"]
    job = wait_job(job_id)
    assert job["status"] == ("completed" if failure == "fallback" else "failed"), job
    assert "secret-upstream-token" not in json.dumps(job)


def test_no_claude_call_during_analysis(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("analysis must not call Claude")
    monkeypatch.setattr(api.report_card, "call_claude_for_report_card", forbidden)
    analyze()


def test_missing_key_returns_actionable_error(monkeypatch):
    result = analyze()
    def missing(**kwargs):
        raise ValueError("Set ANTHROPIC_API_KEY in the server .env file.")
    monkeypatch.setattr(api.report_card, "resolve_api_key", missing)
    response = client.post("/api/report-jobs", json={"recordingId": result["recordingId"], "matching": {"user1": "idealUser1"}})
    assert response.status_code == 422
    assert "ANTHROPIC_API_KEY" in response.json()["detail"]
