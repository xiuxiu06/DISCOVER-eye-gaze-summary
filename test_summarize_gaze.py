import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

import openpyxl

from summarize_gaze import (
    DEFAULT_IRRELEVANT_OBJECTS,
    build_condense_mapping,
    is_irrelevant_object,
    main,
    summarize_excel_to_json,
)


class TestSummarizeGaze(unittest.TestCase):
    def _create_excel(self, path: Path, rows: list[list], sheet_title: str = "Sheet1") -> None:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = sheet_title
        ws.append(["user_id", "session_id", "object_id", "gaze_time", "time_stamp"])
        for r in rows:
            ws.append(r)
        wb.save(path)
        wb.close()

    def test_excel_filtering_dominant_object_and_null_seconds(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            xlsx_path = tmp / "sample.xlsx"
            json_path = tmp / "output.json"

            rows = [
                # User 1, Second 0 (1:34:47 PM): flickers between VR fingers/walls, Liver (0.04s), and ChestSoundsLung1 (3x 0.05s = 0.15s)
                [1, 0, "Middle", 0.45, "5/5/2026  1:34:47 PM"],
                [1, 0, "RobotHandL", 0.30, "5/5/2026  1:34:47 PM"],
                [1, 0, "Liver", 0.04, "5/5/2026  1:34:47 PM"],
                [1, 0, "ChestSoundsLung1", 0.05, "5/5/2026  1:34:47 PM"],
                [1, 0, "Cube100", 0.20, "5/5/2026  1:34:47 PM"],
                [1, 0, "ChestSoundsLung1", 0.05, "5/5/2026  1:34:47 PM"],
                [1, 0, "Sink", 0.20, "5/5/2026  1:34:47 PM"],
                [1, 0, "ChestSoundsLung1", 0.05, "5/5/2026  1:34:47 PM"],
                # User 1, Second 1 (1:34:48 PM): ONLY irrelevant objects -> should output null
                [1, 0, "Floor", 0.40, "5/5/2026  1:34:48 PM"],
                [1, 0, "Thumb1", 0.35, "5/5/2026  1:34:48 PM"],
                [1, 0, "TeenLeftHandIK", 0.25, "5/5/2026  1:34:48 PM"],
                # User 1, Seconds 2..4 (1:34:49 PM .. 1:34:51 PM): continuous 2.6s gaze on heart monitor ending at 1:34:51 PM
                [1, 0, "T3_monitor_screen_S1PennyScreen", 2.60, "5/5/2026  1:34:51 PM"],
                # User 2, Second 0 & Second 1 (native datetime objects in Excel)
                [2, 0, "RoomCollider5", 0.80, datetime(2026, 5, 5, 14, 0, 0)],
                [2, 0, "iStat", 0.20, datetime(2026, 5, 5, 14, 0, 0)],
                [2, 0, "LightBulb4", 0.95, datetime(2026, 5, 5, 14, 0, 1)],  # Caught dynamically by pattern
            ]

            self._create_excel(xlsx_path, rows)
            summary = summarize_excel_to_json(xlsx_path, json_path, condense_similar=False)

            raw_json = json.loads(json_path.read_text(encoding="utf-8"))
            self.assertEqual(list(raw_json.keys()), ["relevant_objects", "user1", "user2"])

            for irr in DEFAULT_IRRELEVANT_OBJECTS:
                self.assertNotIn(irr, summary["relevant_objects"])
            self.assertNotIn("LightBulb4", summary["relevant_objects"])

            self.assertEqual(
                set(summary["relevant_objects"]),
                {"ChestSoundsLung1", "Liver", "T3_monitor_screen_S1PennyScreen", "iStat"},
            )

            u1 = summary["user1"]
            self.assertEqual(len(u1), 5)
            self.assertEqual(u1[0], {"second": 0, "object": "ChestSoundsLung1"})
            self.assertEqual(u1[1], {"second": 1, "object": None})
            self.assertEqual(u1[2], {"second": 2, "object": "T3_monitor_screen_S1PennyScreen"})
            self.assertEqual(u1[3], {"second": 3, "object": "T3_monitor_screen_S1PennyScreen"})
            self.assertEqual(u1[4], {"second": 4, "object": "T3_monitor_screen_S1PennyScreen"})

            u2 = summary["user2"]
            self.assertEqual(
                u2,
                [
                    {"second": 0, "object": "iStat"},
                    {"second": 1, "object": None},
                ],
            )

    def test_multi_session_and_user_numeric_sorting(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            xlsx_path = tmp / "multi_user.xlsx"
            json_path = tmp / "multi_user.json"

            t0 = datetime(2026, 5, 5, 10, 0, 0)
            t_next_day = datetime(2026, 5, 6, 15, 0, 0)

            rows = [
                [10, 0, "ekg", 0.5, t0],
                [2, 0, "Liver", 0.5, t0],
                [1, 0, "MedLineSnap", 0.4, t0],
                [1, 0, "AutoHandPlayer", 0.9, t0 + timedelta(seconds=1)],
                [1, 1, "iStat", 0.6, t_next_day],
            ]

            self._create_excel(xlsx_path, rows)
            exit_code = main([str(xlsx_path), "-o", str(json_path), "--no-condense"])
            self.assertEqual(exit_code, 0)

            data = json.loads(json_path.read_text(encoding="utf-8"))
            self.assertEqual(list(data.keys()), ["relevant_objects", "user1", "user2", "user10"])
            self.assertEqual(
                data["user1"],
                [
                    {"second": 0, "object": "MedLineSnap"},
                    {"second": 1, "object": None},
                    {"second": 2, "object": "iStat"},
                ],
            )

    def test_dynamic_condensing_scalable_and_optional(self) -> None:
        # Verify dynamic prefix/token clustering works on both current DISCOVER names and unseen future names
        sample_names = [
            "Stryker_bed_brake_lever",
            "Stryker_bed_handle_hook_parent",
            "Styker_bed_lever_pedelLeft",  # Typo variant
            "CodeSheet37kg",
            "CodeSheet5kg",
            "Nasal_Canula_Neonate",
            "NasalCanula_Snap",
            "Defibrillator_Pad_Left",  # Brand-new unseen object family
            "Defibrillator_Pad_Right",
            "DefibrillatorSnap1",
            "SPO2",
            "iStat",
        ]
        mapping = build_condense_mapping(sample_names)
        self.assertEqual(mapping["Stryker_bed_brake_lever"], "Stryker_bed")
        self.assertEqual(mapping["Stryker_bed_handle_hook_parent"], "Stryker_bed")
        self.assertEqual(mapping["Styker_bed_lever_pedelLeft"], "Stryker_bed")
        self.assertEqual(mapping["CodeSheet37kg"], "CodeSheet")
        self.assertEqual(mapping["CodeSheet5kg"], "CodeSheet")
        self.assertEqual(mapping["Nasal_Canula_Neonate"], mapping["NasalCanula_Snap"])
        self.assertIn(mapping["Nasal_Canula_Neonate"], {"Nasal_Canula", "NasalCanula"})
        self.assertEqual(mapping["Defibrillator_Pad_Left"], "Defibrillator")
        self.assertEqual(mapping["DefibrillatorSnap1"], "Defibrillator")
        self.assertEqual(mapping["SPO2"], "SPO2")
        self.assertEqual(mapping["iStat"], "iStat")

        # Verify condensing sums durations of grouped parts inside the same second
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            xlsx_path = tmp / "condense.xlsx"
            out_raw = tmp / "raw.json"
            out_cond = tmp / "cond.json"

            t0 = datetime(2026, 5, 5, 12, 0, 0)
            rows = [
                [1, 0, "Stryker_bed_brake_lever", 0.12, t0],
                [1, 0, "Stryker_bed_handle_hook_parent", 0.12, t0],
                [1, 0, "Liver", 0.15, t0],
            ]
            self._create_excel(xlsx_path, rows)

            raw_res = summarize_excel_to_json(xlsx_path, out_raw, condense_similar=False)
            cond_res = summarize_excel_to_json(xlsx_path, out_cond, condense_similar=True)

            # Without condensing, Liver (0.15s) beats each individual Stryker_bed part (0.12s)
            self.assertEqual(raw_res["user1"][0]["object"], "Liver")
            self.assertEqual(len(raw_res["relevant_objects"]), 3)

            # With condensing, Stryker_bed (0.12 + 0.12 = 0.24s) beats Liver (0.15s)
            self.assertEqual(cond_res["user1"][0]["object"], "Stryker_bed")
            self.assertEqual(cond_res["relevant_objects"], ["Liver", "Stryker_bed"])

    def test_irrelevant_patterns_catch_numbered_variants(self) -> None:
        irrelevant_lower = {x.lower() for x in DEFAULT_IRRELEVANT_OBJECTS}
        self.assertTrue(is_irrelevant_object("RoomCollider9", irrelevant_lower))
        self.assertTrue(is_irrelevant_object("LightBulb5", irrelevant_lower))
        self.assertTrue(is_irrelevant_object("Cube999", irrelevant_lower))
        self.assertTrue(is_irrelevant_object("InfantRightArmIK", irrelevant_lower))
        self.assertFalse(is_irrelevant_object("PenLight", irrelevant_lower))
        self.assertFalse(is_irrelevant_object("SPO2", irrelevant_lower))


if __name__ == "__main__":
    unittest.main()
