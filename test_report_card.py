import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from report_card import (
    REPORT_CARD_SYSTEM_PROMPT,
    _extract_json_from_claude_text,
    _load_dotenv_key,
    build_comparison_digest,
    compress_timeline_runs,
    generate_report_card_from_json,
    main,
    render_report_card_markdown,
)


class _FakeHTTPResponse:
    def __init__(self, payload: dict) -> None:
        self._bytes = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._bytes

    def __enter__(self) -> "_FakeHTTPResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class _FakeSSEResponse:
    def __init__(self, lines: list[str]) -> None:
        self._buf = io.BytesIO("".join(lines).encode("utf-8"))

    def readline(self) -> bytes:
        return self._buf.readline()

    def __enter__(self) -> "_FakeSSEResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class TestReportCard(unittest.TestCase):
    def _sample_gaze_summary(self) -> dict:
        return {
            "relevant_objects": [
                "CodeSheet",
                "Nasal_Canula",
                "PenLight",
                "SPO2",
                "Stryker_bed",
                "T3_monitor_screen",
            ],
            "ideal_matches": {
                "user1": "idealUser0",
                "user2": None,
            },
            "user1": [
                {"second": 0, "object": None},
                {"second": 1, "object": "Stryker_bed"},
                {"second": 2, "object": "Stryker_bed"},
                {"second": 3, "object": "SPO2"},
                {"second": 4, "object": "Nasal_Canula"},
                {"second": 5, "object": "Nasal_Canula"},
            ],
            "user2": [
                {"second": 0, "object": "SPO2"},
            ],
            "idealUser0": [
                {"second": 0, "object": "SPO2"},
                {"second": 1, "object": "T3_monitor_screen"},
                {"second": 2, "object": "CodeSheet"},
                {"second": 3, "object": "PenLight"},
                {"second": 4, "object": "Nasal_Canula"},
                {"second": 5, "object": "SPO2"},
            ],
        }

    def test_compress_runs_and_comparison_digest(self) -> None:
        gaze_data = self._sample_gaze_summary()
        runs = compress_timeline_runs(gaze_data["user1"])
        self.assertEqual(
            runs,
            [
                {"start_s": 0, "end_s": 0, "dur_s": 1, "object": None},
                {"start_s": 1, "end_s": 2, "dur_s": 2, "object": "Stryker_bed"},
                {"start_s": 3, "end_s": 3, "dur_s": 1, "object": "SPO2"},
                {"start_s": 4, "end_s": 5, "dur_s": 2, "object": "Nasal_Canula"},
            ],
        )

        digest = build_comparison_digest(gaze_data)
        self.assertEqual(list(digest["evaluated_learners"].keys()), ["user1"])
        self.assertEqual(digest["unmatched_learners"], ["user2"])

        u1 = digest["evaluated_learners"]["user1"]
        self.assertEqual(u1["matched_ideal_user"], "idealUser0")
        self.assertEqual(u1["overview_metrics"]["learner_total_seconds"], 6)
        self.assertEqual(u1["overview_metrics"]["learner_active_clinical_seconds"], 5)
        self.assertEqual(u1["overview_metrics"]["ideal_active_clinical_seconds"], 6)
        self.assertEqual(
            set(u1["objects_viewed_by_ideal_but_missed_by_learner"]),
            {"CodeSheet", "PenLight", "T3_monitor_screen"},
        )
        self.assertEqual(u1["objects_viewed_only_by_learner"], ["Stryker_bed"])

        by_obj = {entry["object"]: entry for entry in u1["per_object_comparison"]}
        self.assertEqual(by_obj["SPO2"]["ideal_first_seen_s"], 0)
        self.assertEqual(by_obj["SPO2"]["learner_first_seen_s"], 3)
        self.assertEqual(by_obj["SPO2"]["ideal_look_count"], 2)
        self.assertEqual(by_obj["SPO2"]["learner_look_count"], 1)

    def test_unmatched_only_raises_clear_error(self) -> None:
        with self.assertRaises(ValueError):
            build_comparison_digest(
                {
                    "relevant_objects": ["SPO2"],
                    "ideal_matches": {"user1": None},
                    "user1": [{"second": 0, "object": "SPO2"}],
                }
            )

    def test_extract_json_handles_raw_and_markdown_fenced(self) -> None:
        raw = '{"cohort_summary": "Good", "reports": {}}'
        self.assertEqual(_extract_json_from_claude_text(raw)["cohort_summary"], "Good")

        fenced = 'Here is the report:\n```json\n{"cohort_summary": "Fenced", "reports": {}}\n```'
        self.assertEqual(_extract_json_from_claude_text(fenced)["cohort_summary"], "Fenced")

    def test_dotenv_key_loading(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            env_file = tmp / ".env"
            env_file.write_text(
                "# Comment\nANTHROPIC_API_KEY=sk-ant-your-key-here\n",
                encoding="utf-8",
            )
            prev_cwd = Path.cwd()
            try:
                os.chdir(tmp)
                # Placeholder should be ignored unless another .env exists in script dir
                env_file.write_text('ANTHROPIC_API_KEY="sk-ant-test-12345"\n', encoding="utf-8")
                self.assertEqual(_load_dotenv_key("ANTHROPIC_API_KEY"), "sk-ant-test-12345")
            finally:
                os.chdir(prev_cwd)

    def test_end_to_end_cli_and_claude_api_mock(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            summary_path = tmp / "gaze_summary.json"
            summary_path.write_text(
                json.dumps(self._sample_gaze_summary(), indent=2),
                encoding="utf-8",
            )

            fake_claude_report = {
                "cohort_summary": "Learner checked SPO2 late and missed CodeSheet compared to idealUser0.",
                "reports": {
                    "user1": {
                        "matched_ideal_user": "idealUser0",
                        "letter_grade": "B-",
                        "numeric_score": 81,
                        "executive_summary": "Solid oxygen intervention timing, but delayed initial monitor check and missed CodeSheet.",
                        "criteria_breakdown": [
                            {
                                "criterion": "Situational Awareness & Early Assessment",
                                "grade": "B-",
                                "rationale": "Checked SPO2 at t = 3s vs t = 0s for idealUser0.",
                            },
                            {
                                "criterion": "Completeness of Clinical Exam & Critical Checks",
                                "grade": "C+",
                                "rationale": "Missed CodeSheet and PenLight.",
                            },
                        ],
                        "specific_observations": [
                            "Spent 2s on Stryker_bed (t = 1-2s) before first checking SPO2 at t = 3s.",
                            "Did not re-check SPO2 after Nasal_Canula at t = 4-5s, whereas idealUser0 re-checked SPO2 at t = 5s.",
                        ],
                        "strengths": [
                            "Initiated Nasal_Canula at t = 4s matching idealUser0's exact timing.",
                        ],
                        "missed_or_delayed_checks": [
                            "CodeSheet (viewed at t = 2s by idealUser0, missed by user1)",
                        ],
                        "follow_up_questions": [
                            "What prompted you to adjust the Stryker_bed at t = 1-2s prior to checking SPO2 or T3_monitor_screen?",
                            "After applying Nasal_Canula at t = 4-5s, what vital sign trend would confirm your intervention worked?",
                        ],
                        "recommended_next_focus": "Practice rapid primary survey (monitor + CodeSheet) and closed-loop SPO2 re-evaluation post-oxygen therapy.",
                    }
                },
            }

            captured_requests: list[tuple[str, dict]] = []

            def fake_urlopen(req, timeout=15):
                url = req.full_url
                if url.endswith("/v1/models"):
                    return _FakeHTTPResponse(
                        {
                            "data": [
                                {"id": "claude-haiku-4-5", "created_at": "2026-01-01T00:00:00Z"},
                                {"id": "claude-sonnet-4-6", "created_at": "2026-05-01T00:00:00Z"},
                            ]
                        }
                    )
                body = json.loads(req.data.decode("utf-8"))
                captured_requests.append((url, body))
                return _FakeHTTPResponse(
                    {
                        "model": body["model"],
                        "content": [{"type": "text", "text": json.dumps(fake_claude_report)}],
                    }
                )

            with patch("urllib.request.urlopen", side_effect=fake_urlopen):
                buf = io.StringIO()
                with patch("sys.stdout", buf):
                    rc = main([str(summary_path), "--api-key", "sk-ant-mock-key"])
                self.assertEqual(rc, 0)

            self.assertEqual(len(captured_requests), 1)
            sent_url, sent_body = captured_requests[0]
            self.assertTrue(sent_url.endswith("/v1/messages"))
            self.assertEqual(sent_body["model"], "claude-sonnet-4-6")
            self.assertEqual(sent_body["system"], REPORT_CARD_SYSTEM_PROMPT)
            self.assertNotIn("temperature", sent_body)
            self.assertTrue(sent_body["stream"])
            self.assertEqual(sent_body["max_tokens"], 64000)

            out_json = tmp / "gaze_summary_report_card.json"
            out_md = tmp / "gaze_summary_report_card.md"
            self.assertTrue(out_json.is_file())
            self.assertTrue(out_md.is_file())

            saved_json = json.loads(out_json.read_text(encoding="utf-8"))
            self.assertEqual(saved_json["reports"]["user1"]["letter_grade"], "B-")
            self.assertEqual(saved_json["unmatched_learners"], ["user2"])

            md_text = out_md.read_text(encoding="utf-8")
            self.assertIn("Overall Grade: **B-** (81/100)", md_text)
            self.assertIn("Debriefing Follow-Up Questions", md_text)
            self.assertIn("Specific Gaze & Workflow Observations", md_text)
            self.assertIn("Recommended Next Practice Focus", md_text)
            self.assertIn("Unmatched learners skipped (no ideal benchmark assigned): user2", md_text)

            # Also verify programmatic helper directly
            with patch("urllib.request.urlopen", side_effect=fake_urlopen):
                direct = generate_report_card_from_json(
                    summary_path,
                    api_key="sk-ant-mock-key",
                    model="claude-sonnet-4-6",
                )
            self.assertIn("B-", render_report_card_markdown(direct))

    def test_sse_streaming_and_max_tokens_cutoff_guard(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            summary_path = tmp / "gaze_summary.json"
            summary_path.write_text(
                json.dumps(self._sample_gaze_summary(), indent=2),
                encoding="utf-8",
            )

            report_json = json.dumps(
                {
                    "cohort_summary": "Streamed cohort summary.",
                    "reports": {
                        "user1": {
                            "matched_ideal_user": "idealUser0",
                            "letter_grade": "A-",
                            "numeric_score": 91,
                            "executive_summary": "Great performance.",
                            "criteria_breakdown": [],
                            "specific_observations": ["Fast SPO2 check."],
                            "strengths": ["Good scan."],
                            "missed_or_delayed_checks": [],
                            "follow_up_questions": ["What next?"],
                            "recommended_next_focus": "Keep practicing.",
                        }
                    },
                }
            )
            half = len(report_json) // 2

            def fake_sse_ok(req, timeout=300):
                return _FakeSSEResponse(
                    [
                        'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-5-5"}}\n\n',
                        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Analyzing 4 learners..."}}\n\n',
                        f'event: content_block_delta\ndata: {json.dumps({"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": report_json[:half]}})}\n\n',
                        f'event: content_block_delta\ndata: {json.dumps({"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": report_json[half:]}})}\n\n',
                        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
                        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
                    ]
                )

            with patch("urllib.request.urlopen", side_effect=fake_sse_ok):
                res = generate_report_card_from_json(
                    summary_path,
                    api_key="sk-ant-mock-key",
                    model="claude-sonnet-5-5",
                )
            self.assertEqual(res["model_used"], "claude-sonnet-5-5")
            self.assertEqual(res["reports"]["user1"]["letter_grade"], "A-")

            # Verify stop_reason == "max_tokens" raises a clear error instead of writing truncated JSON
            def fake_sse_truncated(req, timeout=300):
                return _FakeSSEResponse(
                    [
                        'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-5-5"}}\n\n',
                        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"{\\"cohort_summary\\": \\"cut off"}}\n\n',
                        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n',
                    ]
                )

            with patch("urllib.request.urlopen", side_effect=fake_sse_truncated):
                with self.assertRaisesRegex(RuntimeError, "hit max_tokens"):
                    generate_report_card_from_json(
                        summary_path,
                        api_key="sk-ant-mock-key",
                        model="claude-sonnet-5-5",
                    )


if __name__ == "__main__":
    unittest.main()
