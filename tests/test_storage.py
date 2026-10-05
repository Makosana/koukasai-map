"""Data integrity checks. Run: python -m unittest discover -s tests -v"""
import json
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import storage


class GuideStorageTests(unittest.TestCase):
    def setUp(self):
        self.current = storage.load_guide()
        self.guide = deepcopy(self.current)

    def validate(self):
        return storage.validate_guide({"expectedRevision": self.current["revision"], "guide": self.guide}, self.current)

    def add_event(self, suffix="one", department="応用電子"):
        item = {
            "id": "test_" + suffix, "type": "experience", "categoryId": "experience",
            "title": "電子工作体験 " + suffix, "image": "library/VRたいけん.png",
            "description": "電子工作を体験できます。", "department": department,
            "grade": "2" if department != "その他" else "",
            "organization": "実行委員会" if department == "その他" else "",
            "building": "3", "floor": "2", "organizer": "",
            "waitState": "none", "waitMinutes": None,
        }
        self.guide["items"].append(item)
        return item

    def add_pin(self, items=None, pin_id="test_pin"):
        ids = [item["id"] for item in (items or [])]
        marker = {
            "id": pin_id, "kind": "pin", "usage": "experience", "categoryId": "experience",
            "itemIds": ids, "itemId": ids[0] if ids else None, "label": "99", "image": None,
            "color": "#e50062", "x": 50, "y": 50, "size": 40, "rotation": 0, "layer": 3,
            "locked": False,
        }
        self.guide["markers"].append(marker)
        return marker

    def add_facility(self, building="本館", floor="1"):
        item = {
            "id": "test_facility", "type": "facility", "categoryId": "facility",
            "title": "多目的トイレ", "image": "library/女性用トイレ.png",
            "description": "", "department": "", "grade": "", "organization": "",
            "building": building, "floor": floor, "organizer": "",
            "waitState": "none", "waitMinutes": None, "detailsVersion": 3,
        }
        marker = {
            "id": "facility_pin", "kind": "pin", "usage": "facility", "categoryId": "facility",
            "itemIds": [item["id"]], "itemId": item["id"], "label": "98", "image": None,
            "color": "#3274b6", "x": 45, "y": 48, "size": 40, "rotation": 0,
            "layer": 4, "locked": False,
        }
        self.guide["items"].append(item)
        self.guide["markers"].append(marker)
        return item, marker

    def test_legacy_positions_images_and_items_survive(self):
        original = json.loads(storage.GUIDE_DATA.read_text(encoding="utf-8"))
        result = self.validate()
        self.assertEqual(result["schemaVersion"], 4)
        self.assertEqual(len(result["items"]), len(original["items"]))
        for old in original["markers"]:
            marker = next(m for m in result["markers"] if m["id"] == old["id"])
            self.assertEqual((marker["x"], marker["y"], marker["size"]), (old["x"], old["y"], old["size"]))
        for old in original["items"]:
            item = next(i for i in result["items"] if i["id"] == old["id"])
            self.assertEqual((item["title"], item["description"], item["image"]), (old["title"], old["description"], old["image"]))

    def test_empty_pin_can_be_saved_before_adding_icons(self):
        marker = self.add_pin()
        result = self.validate()
        self.assertEqual(result["markers"][-1]["itemIds"], [])
        self.assertEqual(result["markers"][-1]["id"], marker["id"])

    def test_multiple_events_belong_to_one_pin(self):
        first, second = self.add_event(), self.add_event("two", "その他")
        self.add_pin([first, second])
        result = self.validate()
        self.assertEqual(result["markers"][-1]["itemIds"], [first["id"], second["id"]])
        self.assertEqual(result["items"][-2]["organizer"], "応用電子 2年")
        self.assertEqual(result["items"][-1]["organizer"], "実行委員会")
        self.assertEqual(result["items"][-2]["building"], "3")
        self.assertEqual(result["items"][-2]["floor"], "2")

    def test_all_new_event_details_are_required(self):
        fields = ["title", "image", "department", "grade", "building", "floor", "description"]
        for field in fields:
            with self.subTest(field=field):
                self.guide = deepcopy(self.current)
                item = self.add_event()
                self.add_pin([item])
                item[field] = ""
                with self.assertRaises(ValueError):
                    self.validate()

    def test_other_organization_excludes_grade(self):
        item = self.add_event(department="その他")
        self.add_pin([item])
        item["organization"] = ""
        with self.assertRaises(ValueError):
            self.validate()
        item["organization"] = "実行委員会"
        item["grade"] = "1"
        with self.assertRaises(ValueError):
            self.validate()

    def test_floor_is_only_required_for_numbered_buildings(self):
        item = self.add_event()
        self.add_pin([item])
        item["building"] = "体育館"
        item["floor"] = ""
        result = self.validate()
        self.assertEqual(result["items"][-1]["floor"], "")
        item["floor"] = "1"
        with self.assertRaises(ValueError):
            self.validate()

    def test_pin_numbers_are_unique_per_category_and_lock_is_preserved(self):
        first, second = self.add_event(), self.add_event("two")
        first_pin = self.add_pin([first], "first_pin")
        second_pin = self.add_pin([second], "second_pin")
        first_pin["label"] = second_pin["label"] = "7"
        with self.assertRaises(ValueError):
            self.validate()
        second_pin["categoryId"] = "festival"
        second_pin["usage"] = "experience"
        second["categoryId"] = "festival"
        first_pin["locked"] = True
        result = self.validate()
        self.assertTrue(next(marker for marker in result["markers"] if marker["id"] == "first_pin")["locked"])

    def test_floor_plan_item_marker_and_main_building_are_saved(self):
        item = self.add_event()
        item["building"] = "本館"
        item["floor"] = "2"
        self.add_pin([item])
        plan = next(plan for plan in self.guide["floorPlans"] if plan["id"] == "main_floor2")
        plan["markers"].append({
            "id": "floor_test", "kind": "item", "itemId": item["id"], "image": None,
            "text": "", "color": "#e50062", "x": 45, "y": 52, "size": 150,
            "rotation": 0, "layer": 1, "locked": True,
        })
        result = self.validate()
        saved = next(plan for plan in result["floorPlans"] if plan["id"] == "main_floor2")["markers"][0]
        self.assertEqual(saved["itemId"], item["id"])
        self.assertTrue(saved["locked"])

    def test_floor_plan_rejects_item_on_wrong_floor(self):
        item = self.add_event()
        self.add_pin([item])
        plan = next(plan for plan in self.guide["floorPlans"] if plan["id"] == "building1_floor1")
        plan["markers"].append({
            "id": "wrong_floor", "kind": "item", "itemId": item["id"], "image": None,
            "text": "", "color": "#e50062", "x": 50, "y": 50, "size": 150,
            "rotation": 0, "layer": 1, "locked": False,
        })
        with self.assertRaises(ValueError):
            self.validate()

    def test_floor_overlay_layout_is_saved_and_checked(self):
        self.guide["settings"]["floorOverlay"] = {"x": 8, "y": 42, "width": 46}
        result = self.validate()
        self.assertEqual(result["settings"]["floorOverlay"], {"x": 8.0, "y": 42.0, "width": 46.0})
        self.guide["settings"]["floorOverlay"] = {"x": 70, "y": 42, "width": 46}
        with self.assertRaises(ValueError):
            self.validate()

    def test_new_facility_uses_pin_and_requires_location(self):
        item, marker = self.add_facility()
        result = self.validate()
        saved = next(entry for entry in result["items"] if entry["id"] == item["id"])
        self.assertEqual((saved["building"], saved["floor"]), ("本館", "1"))
        self.assertEqual(next(entry for entry in result["markers"] if entry["id"] == marker["id"])["usage"], "facility")
        item["building"] = ""
        item["floor"] = ""
        with self.assertRaises(ValueError):
            self.validate()

    def test_same_event_cannot_be_attached_to_two_pins(self):
        item = self.add_event()
        self.add_pin([item])
        self.add_pin([item], "second_pin")
        with self.assertRaises(ValueError):
            self.validate()

    def test_missing_or_unattached_event_is_rejected(self):
        marker = self.add_pin()
        marker["itemIds"] = ["missing"]
        with self.assertRaises(ValueError):
            self.validate()
        marker["itemIds"] = []
        self.add_event()
        with self.assertRaises(ValueError):
            self.validate()

    def test_legacy_edit_requires_new_fields(self):
        legacy = next((item for item in self.guide["items"] if item["type"] != "facility" and item.get("detailsVersion", 1) < 2), None)
        if legacy is None:
            self.skipTest("No legacy event in this user's data")
        legacy["title"] += "変更"
        with self.assertRaises(ValueError):
            self.validate()

    def test_stale_revision_is_rejected(self):
        with self.assertRaises(storage.RevisionConflict):
            storage.validate_guide({"expectedRevision": self.current["revision"] - 1, "guide": self.guide}, self.current)

    def test_size_and_category_validation(self):
        item = self.add_event()
        pin = self.add_pin([item])
        pin["size"] = 0
        with self.assertRaises(ValueError):
            self.validate()
        pin["size"] = 40
        pin["categoryId"] = "festival"
        with self.assertRaises(ValueError):
            self.validate()

    def test_save_roundtrip_and_automatic_backup(self):
        self.add_pin([self.add_event(), self.add_event("other", "その他")])
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            original = storage.GUIDE_DATA.read_bytes()
            (path / "guide.json").write_bytes(original)
            with patch.object(storage, "DATA_DIR", path), patch.object(storage, "GUIDE_DATA", path / "guide.json"), patch.object(storage, "BACKUP_DIR", path / "backups"):
                saved, backup = storage.save_editor_guide({"expectedRevision": self.current["revision"], "guide": self.guide})
                self.assertEqual(saved, storage.load_guide())
                self.assertEqual(saved["revision"], self.current["revision"] + 1)
                self.assertEqual((path / "backups" / backup).read_bytes(), original)
                with self.assertRaises(storage.RevisionConflict):
                    storage.save_editor_guide({"expectedRevision": self.current["revision"], "guide": self.guide})


if __name__ == "__main__":
    unittest.main()
