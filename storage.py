from __future__ import annotations

from copy import deepcopy
from datetime import datetime
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile
from threading import Lock
from typing import Any
from uuid import uuid4

from PIL import Image, ImageDraw, ImageOps, UnidentifiedImageError
from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
GUIDE_DATA = DATA_DIR / "guide.json"
BACKUP_DIR = DATA_DIR / "backups"
ORIGINAL_IMAGE_DIR = DATA_DIR / "image_originals"
STATIC_IMAGE_DIR = BASE_DIR / "static" / "images"
LIBRARY_IMAGE_DIR = STATIC_IMAGE_DIR / "library"
UPLOAD_IMAGE_DIR = STATIC_IMAGE_DIR / "uploads"
THUMB_IMAGE_DIR = STATIC_IMAGE_DIR / "thumbs"

GUIDE_LOCK = Lock()
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
HEX_COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")
ALLOWED_AREAS = {"top", "bottom-left", "bottom-right", "facility"}
ALLOWED_ITEM_TYPES = {"experience", "stall", "facility"}
ALLOWED_MARKER_USAGES = {"decoration", "experience", "stall", "facility"}
ALLOWED_MARKER_KINDS = {"pin", "image"}
ALLOWED_WAIT_STATES = {"none", "minutes", "preparing", "closed", "soldout"}
ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
DEPARTMENTS = {"専門機械", "専門電気", "専門電子", "応用機械", "応用電気", "応用電子", "その他"}
BUILDINGS = {str(number) for number in range(1, 10)} | {"本館", "体育館", "屋外"}
FLOORS = {"1", "2", "3", "4", "無し"}
DETAIL_FIELDS = ("title", "image", "organizer", "description", "department", "grade", "organization", "building", "floor")
STANDARD_CATEGORIES = {
    "experience": ("ポリテクフェスタ", "#e50062", "top"),
    "festival": ("紅華祭", "#f39800", "bottom-left"),
    "food": ("模擬店", "#168650", "bottom-right"),
    "facility": ("施設案内", "#3274b6", "facility"),
}
FLOOR_PLAN_DEFINITIONS = (
    ("building1_floor1", "1号棟1階", "1", "1", "floors/1号棟1階.png"),
    ("building1_floor2", "1号棟2階", "1", "2", "floors/1号棟2階.png"),
    ("building1_floor3", "1号棟3階", "1", "3", "floors/1号棟3階.png"),
    ("building1_floor4", "1号棟4階", "1", "4", "floors/1号棟4階.png"),
    ("building2_floor1", "2号棟1階", "2", "1", "floors/2号棟1階.png"),
    ("building2_floor2", "2号棟2階", "2", "2", "floors/2号棟2階.png"),
    ("building3_floor1", "3号棟1階", "3", "1", "floors/3号棟1階.png"),
    ("building3_floor2", "3号棟2階", "3", "2", "floors/3号棟2階.png"),
    ("building5_floor1", "5号棟1階", "5", "1", "floors/5号棟1階.png"),
    ("building5_floor2", "5号棟2階", "5", "2", "floors/5号棟2階.png"),
    ("main_floor1", "本館1階", "本館", "1", "floors/本館1階.png"),
    ("main_floor2", "本館2階", "本館", "2", "floors/本館2階.png"),
    ("main_floor3", "本館3階", "本館", "3", "floors/本館3階.png"),
)
ALLOWED_FLOOR_MARKER_KINDS = {"item", "facility", "image", "text"}
DEFAULT_FLOOR_OVERLAY = {"x": 2.0, "y": 50.0, "width": 42.0}


class RevisionConflict(ValueError):
    pass


def load_guide() -> dict[str, Any]:
    with GUIDE_DATA.open("r", encoding="utf-8") as file:
        return upgrade_guide(json.load(file))


def upgrade_guide(source: dict[str, Any]) -> dict[str, Any]:
    """Read older data without overwriting it; persist the latest form on an explicit save."""
    guide = deepcopy(source)
    settings = guide.setdefault("settings", {})
    raw_overlay = settings.get("floorOverlay")
    if not isinstance(raw_overlay, dict):
        raw_overlay = {}
    overlay = {}
    for key, default in DEFAULT_FLOOR_OVERLAY.items():
        value = raw_overlay.get(key, default)
        overlay[key] = float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else default
    settings["floorOverlay"] = overlay
    categories = {category["id"]: category for category in guide["categories"]}
    for category_id, (label, color, area) in STANDARD_CATEGORIES.items():
        if category_id not in categories:
            category = {"id": category_id, "label": label, "color": color, "area": area, "description": ""}
            guide["categories"].append(category)
            categories[category_id] = category
        else:
            categories[category_id].update(label=label, color=color, area=area)
    for item in guide["items"]:
        for field in ("department", "grade", "organization", "building", "floor"):
            item.setdefault(field, "")
        item.setdefault("detailsVersion", 1)
    used_labels = {marker.get("label") for marker in guide["markers"] if marker.get("kind") == "pin"}
    for marker in guide["markers"]:
        marker.setdefault("itemIds", [marker["itemId"]] if marker.get("itemId") else [])
        marker.setdefault("locked", False)
        marker["itemId"] = marker["itemIds"][0] if marker["itemIds"] else None
        # Old event images become the first icon belonging to a pin at the same location.
        if source.get("schemaVersion", 1) < 2 and marker.get("usage") in {"experience", "stall"}:
            marker["kind"] = "pin"
            marker["image"] = None
            if not marker.get("label"):
                number = 1
                while str(number) in used_labels:
                    number += 1
                marker["label"] = str(number)
                used_labels.add(str(number))
        category = categories.get(marker.get("categoryId"))
        if marker.get("kind") == "pin" and category:
            marker["color"] = category["color"]
    floor_plans = {plan.get("id"): plan for plan in guide.get("floorPlans", []) if isinstance(plan, dict)}
    guide["floorPlans"] = []
    for plan_id, label, building, floor, image in FLOOR_PLAN_DEFINITIONS:
        plan = floor_plans.get(plan_id, {})
        guide["floorPlans"].append({
            "id": plan_id,
            "label": label,
            "building": building,
            "floor": floor,
            "image": image,
            "markers": plan.get("markers", []),
        })
    guide["schemaVersion"] = 4
    return guide


def _event_details(raw: dict[str, Any], previous: dict[str, Any] | None) -> dict[str, Any]:
    details = {field: _text(raw.get(field, ""), field, 80, allow_empty=True)
               for field in ("department", "grade", "organization", "building", "floor")}
    # Existing incomplete records may be moved/saved unchanged. Editing one requires
    # completing the new fields; a client cannot mark a new item as legacy.
    unchanged_legacy = previous is not None and previous.get("detailsVersion", 1) < 2 and all(
        raw.get(field, "") == previous.get(field, "") for field in DETAIL_FIELDS
    )
    if unchanged_legacy:
        return {**details, "detailsVersion": 1}
    department = details["department"]
    if department not in DEPARTMENTS:
        raise ValueError("学科を選択してください。")
    if department == "その他":
        if not details["organization"]:
            raise ValueError("その他団体を入力してください。")
        if details["grade"]:
            raise ValueError("その他を選択した場合、学年は指定できません。")
        organizer = details["organization"]
    else:
        if details["grade"] not in {"1", "2"}:
            raise ValueError("学年を選択してください。")
        if details["organization"]:
            raise ValueError("学科を選択した場合、その他団体は指定できません。")
        organizer = f"{department} {details['grade']}年"
    if details["building"] not in BUILDINGS:
        raise ValueError("場所（号棟）を選択してください。")
    if details["building"] in ({str(number) for number in range(1, 10)} | {"本館"}):
        if details["floor"] not in {"1", "2", "3", "4"}:
            raise ValueError("1〜9号棟を選択した場合は階を選択してください。")
    elif details["floor"]:
        raise ValueError("体育館・屋外を選択した場合、階は指定できません。")
    _text(raw.get("description", ""), "説明文", 1200)
    _asset_path(raw.get("image"), required=True)
    return {**details, "organizer": organizer, "detailsVersion": 2}


def _facility_details(raw: dict[str, Any], previous: dict[str, Any] | None) -> dict[str, Any]:
    details = {field: _text(raw.get(field, ""), field, 80, allow_empty=True)
               for field in ("building", "floor")}
    unchanged_legacy = previous is not None and previous.get("detailsVersion", 1) < 3 and all(
        raw.get(field, "") == previous.get(field, "") for field in ("title", "image", "building", "floor")
    )
    if unchanged_legacy:
        return {**details, "detailsVersion": previous.get("detailsVersion", 1)}
    if details["building"] not in BUILDINGS:
        raise ValueError("施設案内の場所を選択してください。")
    if details["building"] in ({str(number) for number in range(1, 10)} | {"本館"}):
        if details["floor"] not in {"1", "2", "3", "4"}:
            raise ValueError("施設案内の階を選択してください。")
    elif details["floor"]:
        raise ValueError("体育館・屋外を選択した場合、階は指定できません。")
    return {**details, "detailsVersion": 3}


def _text(value: Any, name: str, maximum: int, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{name}の形式が正しくありません。")
    value = value.strip()
    if not allow_empty and not value:
        raise ValueError(f"{name}を入力してください。")
    if len(value) > maximum:
        raise ValueError(f"{name}は{maximum}文字以内で入力してください。")
    return value


def _number(value: Any, name: str, minimum: float, maximum: float, digits: int = 2) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name}は数値で指定してください。")
    numeric = float(value)
    if not math.isfinite(numeric) or not minimum <= numeric <= maximum:
        raise ValueError(f"{name}は{minimum}〜{maximum}の範囲で指定してください。")
    return round(numeric, digits)


def _id(value: Any, name: str) -> str:
    if not isinstance(value, str) or not ID_PATTERN.fullmatch(value):
        raise ValueError(f"{name}のIDが正しくありません。")
    return value


def _color(value: Any, name: str) -> str:
    if not isinstance(value, str) or not HEX_COLOR_PATTERN.fullmatch(value):
        raise ValueError(f"{name}の色が正しくありません。")
    return value.lower()


def _asset_path(value: Any, *, required: bool = False) -> str | None:
    if value in (None, ""):
        if required:
            raise ValueError("画像を選択してください。")
        return None
    if not isinstance(value, str):
        raise ValueError("画像パスの形式が正しくありません。")

    pure = PurePosixPath(value)
    if pure.is_absolute() or ".." in pure.parts or not pure.parts:
        raise ValueError("画像パスが正しくありません。")
    if pure.parts[0] not in {"library", "uploads", "maps", "ui", "system", "floors"}:
        raise ValueError("使用できない画像フォルダーです。")
    candidate = (STATIC_IMAGE_DIR / Path(*pure.parts)).resolve()
    try:
        candidate.relative_to(STATIC_IMAGE_DIR.resolve())
    except ValueError as error:
        raise ValueError("画像パスが正しくありません。") from error
    if not candidate.is_file():
        raise ValueError(f"画像ファイルが見つかりません: {value}")
    return pure.as_posix()


def validate_guide(payload: Any, current: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("保存データの形式が正しくありません。")

    expected_revision = payload.get("expectedRevision")
    if not isinstance(expected_revision, int):
        raise ValueError("編集データの版番号がありません。再読み込みしてください。")
    if expected_revision != current.get("revision", 0):
        raise RevisionConflict("別の編集内容が先に保存されています。画面を再読み込みしてください。")

    raw_guide = payload.get("guide")
    if not isinstance(raw_guide, dict):
        raise ValueError("guideの形式が正しくありません。")

    raw_settings = raw_guide.get("settings")
    if not isinstance(raw_settings, dict):
        raise ValueError("画面設定の形式が正しくありません。")
    current_settings = current.get("settings", {})
    if not isinstance(current_settings, dict):
        current_settings = {}
    settings = {
        "title": _text(raw_settings.get("title", current_settings.get("title", "紅華祭")), "タイトル", 40),
        "subtitle": _text(raw_settings.get("subtitle", current_settings.get("subtitle", "POLYTECH FESTA")), "英字タイトル", 60),
        "school": _text(raw_settings.get("school", current_settings.get("school", "中国職業能力開発大学校")), "学校名", 80),
        "instruction": _text(raw_settings.get("instruction", current_settings.get("instruction", "画面をタッチしてください")), "案内文", 100),
        "mapImage": _asset_path(current_settings.get("mapImage"), required=True),
        "backgroundImage": _asset_path(current_settings.get("backgroundImage"), required=True),
        "schoolQr": _asset_path(current_settings.get("schoolQr"), required=True),
        "instagramQr": _asset_path(current_settings.get("instagramQr"), required=True),
    }
    raw_overlay = raw_settings.get("floorOverlay", current_settings.get("floorOverlay", DEFAULT_FLOOR_OVERLAY))
    if not isinstance(raw_overlay, dict):
        raise ValueError("フロア案内枠の設定が正しくありません。")
    overlay_width = _number(raw_overlay.get("width"), "フロア案内枠の大きさ", 20, 75, 2)
    overlay_x = _number(raw_overlay.get("x"), "フロア案内枠の横位置", 0, 80, 2)
    overlay_y = _number(raw_overlay.get("y"), "フロア案内枠の縦位置", 0, 90, 2)
    if overlay_x + overlay_width > 100:
        raise ValueError("フロア案内枠がマップの右端からはみ出しています。")
    if overlay_y + overlay_width / 2 > 100:
        raise ValueError("フロア案内枠がマップの下端からはみ出しています。")
    settings["floorOverlay"] = {"x": overlay_x, "y": overlay_y, "width": overlay_width}

    raw_categories = raw_guide.get("categories")
    if not isinstance(raw_categories, list) or not 1 <= len(raw_categories) <= 20:
        raise ValueError("カテゴリーは1〜20件で登録してください。")
    categories: list[dict[str, Any]] = []
    category_ids: set[str] = set()
    category_area_by_id: dict[str, str] = {}
    for raw in raw_categories:
        if not isinstance(raw, dict):
            raise ValueError("カテゴリーの形式が正しくありません。")
        category_id = _id(raw.get("id"), "カテゴリー")
        if category_id == "all" or category_id in category_ids:
            raise ValueError("カテゴリーIDが重複しています。")
        category_ids.add(category_id)
        area = raw.get("area")
        if area not in ALLOWED_AREAS:
            raise ValueError("カテゴリーの表示場所が正しくありません。")
        category_area_by_id[category_id] = area
        categories.append({
            "id": category_id,
            "label": _text(raw.get("label"), "カテゴリー名", 20),
            "color": _color(raw.get("color"), "カテゴリー"),
            "area": area,
            "description": _text(raw.get("description", ""), "カテゴリー説明", 300, allow_empty=True),
        })

    raw_items = raw_guide.get("items")
    if not isinstance(raw_items, list) or len(raw_items) > 500:
        raise ValueError("企画情報は500件以内で登録してください。")
    items: list[dict[str, Any]] = []
    item_ids: set[str] = set()
    item_by_id: dict[str, dict[str, Any]] = {}
    previous_items = {item["id"]: item for item in current.get("items", [])}
    for raw in raw_items:
        if not isinstance(raw, dict):
            raise ValueError("企画情報の形式が正しくありません。")
        item_id = _id(raw.get("id"), "企画")
        if item_id in item_ids:
            raise ValueError("企画IDが重複しています。")
        item_ids.add(item_id)
        item_type = raw.get("type")
        category_id = raw.get("categoryId")
        wait_state = raw.get("waitState", "none")
        if item_type not in ALLOWED_ITEM_TYPES:
            raise ValueError("企画の種類が正しくありません。")
        if category_id not in category_ids:
            raise ValueError("企画のカテゴリーが正しくありません。")
        category_is_facility = category_area_by_id[category_id] == "facility"
        if (item_type == "facility") != category_is_facility:
            raise ValueError("設備案内は設備欄のカテゴリー、それ以外はマップ上下のカテゴリーを選んでください。")
        if wait_state not in ALLOWED_WAIT_STATES:
            raise ValueError("待ち時間の状態が正しくありません。")
        wait_minutes = raw.get("waitMinutes")
        if wait_state == "minutes":
            wait_minutes = int(_number(wait_minutes, "待ち時間", 0, 999, 0))
        else:
            wait_minutes = None
        item = {
            "id": item_id,
            "type": item_type,
            "categoryId": category_id,
            "title": _text(raw.get("title"), "店舗・企画名", 80),
            "organizer": _text(raw.get("organizer", ""), "学年・科", 80, allow_empty=True),
            "description": _text(raw.get("description", ""), "説明文", 1200, allow_empty=True),
            "waitState": wait_state,
            "waitMinutes": wait_minutes,
            "image": _asset_path(raw.get("image")),
        }
        if item_type != "facility":
            item.update(_event_details(raw, previous_items.get(item_id)))
        else:
            item.update({field: "" for field in ("department", "grade", "organization")})
            item.update(_facility_details(raw, previous_items.get(item_id)))
        items.append(item)
        item_by_id[item_id] = item

    raw_markers = raw_guide.get("markers")
    if not isinstance(raw_markers, list) or len(raw_markers) > 800:
        raise ValueError("マップ上のアイコンは800件以内で登録してください。")
    markers: list[dict[str, Any]] = []
    marker_ids: set[str] = set()
    marker_item_ids: set[str] = set()
    pin_labels_by_category: dict[str, set[str]] = {}
    for raw in raw_markers:
        if not isinstance(raw, dict):
            raise ValueError("マップアイコンの形式が正しくありません。")
        marker_id = _id(raw.get("id"), "マップアイコン")
        if marker_id in marker_ids:
            raise ValueError("マップアイコンIDが重複しています。")
        marker_ids.add(marker_id)
        usage = raw.get("usage")
        kind = raw.get("kind")
        if usage not in ALLOWED_MARKER_USAGES:
            raise ValueError("アイコンの用途が正しくありません。")
        if kind not in ALLOWED_MARKER_KINDS:
            raise ValueError("アイコンの種類が正しくありません。")

        linked_ids = raw.get("itemIds", [raw["itemId"]] if raw.get("itemId") else [])
        if not isinstance(linked_ids, list) or len(linked_ids) > 500:
            raise ValueError("ピンに登録した企画の形式が正しくありません。")
        if any(not isinstance(value, str) for value in linked_ids) or len(set(linked_ids)) != len(linked_ids):
            raise ValueError("ピンに同じ企画が重複しています。")
        category_id = raw.get("categoryId")
        if usage == "decoration":
            if linked_ids:
                raise ValueError("装飾画像に企画は登録できません。")
            if category_id not in category_ids:
                category_id = None
        else:
            if category_id not in category_ids:
                raise ValueError("ピンのカテゴリーを選択してください。")
            if (usage == "facility") != (category_area_by_id[category_id] == "facility"):
                raise ValueError("施設画像とピンのカテゴリーが一致していません。")
            if usage == "facility" and len(linked_ids) > 1:
                raise ValueError("施設画像には複数の企画を登録できません。")
        for item_id in linked_ids:
            if item_id not in item_by_id:
                raise ValueError("アイコンに対応する企画が見つかりません。")
            if item_id in marker_item_ids:
                raise ValueError("同じ企画が複数のピンに登録されています。")
            marker_item_ids.add(item_id)
            if category_id != item_by_id[item_id]["categoryId"] or usage != item_by_id[item_id]["type"]:
                raise ValueError("ピンと企画のカテゴリー・種類が一致していません。")

        image = _asset_path(raw.get("image"), required=kind == "image")
        label = _text(raw.get("label", "1"), "ピンの数字", 8) if kind == "pin" else ""
        if kind == "pin":
            if not label.isdigit() or int(label) < 1:
                raise ValueError("ピン番号は1以上の数字で指定してください。")
            labels = pin_labels_by_category.setdefault(category_id, set())
            if label in labels:
                raise ValueError("同じカテゴリー内でピン番号が重複しています。")
            labels.add(label)
        locked = raw.get("locked", False)
        if not isinstance(locked, bool):
            raise ValueError("位置固定の設定が正しくありません。")
        marker = {
            "id": marker_id,
            "itemId": linked_ids[0] if linked_ids else None,
            "itemIds": linked_ids,
            "usage": usage,
            "kind": kind,
            "categoryId": category_id,
            "label": label,
            "color": next((category["color"] for category in categories if category["id"] == category_id),
                          _color(raw.get("color", "#e4473f"), "ピン")),
            "image": image,
            "x": _number(raw.get("x"), "横位置", 0, 100, 3),
            "y": _number(raw.get("y"), "縦位置", 0, 100, 3),
            "size": _number(raw.get("size"), "大きさ", 28, 260, 1),
            "rotation": _number(raw.get("rotation", 0), "回転角度", -180, 180, 1),
            "layer": int(_number(raw.get("layer", 1), "重なり順", 0, 100, 0)),
            "locked": locked,
        }
        markers.append(marker)

    if item_ids != marker_item_ids:
        raise ValueError("ピンまたは施設画像に登録されていない企画があります。")

    raw_floor_plans = raw_guide.get("floorPlans")
    if not isinstance(raw_floor_plans, list):
        raise ValueError("フロア図の形式が正しくありません。")
    raw_floor_by_id = {plan.get("id"): plan for plan in raw_floor_plans if isinstance(plan, dict)}
    if len(raw_floor_by_id) != len(raw_floor_plans):
        raise ValueError("フロア図IDが重複しているか、形式が正しくありません。")
    known_floor_ids = {definition[0] for definition in FLOOR_PLAN_DEFINITIONS}
    if set(raw_floor_by_id) != known_floor_ids:
        raise ValueError("フロア図の一覧が正しくありません。")

    floor_plans: list[dict[str, Any]] = []
    floor_marker_ids: set[str] = set()
    floor_item_ids: set[str] = set()
    for plan_id, label, building, floor, image_path in FLOOR_PLAN_DEFINITIONS:
        raw_plan = raw_floor_by_id[plan_id]
        raw_floor_markers = raw_plan.get("markers", [])
        if not isinstance(raw_floor_markers, list) or len(raw_floor_markers) > 300:
            raise ValueError(f"{label}の配置要素は300件以内にしてください。")
        floor_markers: list[dict[str, Any]] = []
        for raw_marker in raw_floor_markers:
            if not isinstance(raw_marker, dict):
                raise ValueError("フロア図の配置要素の形式が正しくありません。")
            marker_id = _id(raw_marker.get("id"), "フロア図要素")
            if marker_id in floor_marker_ids:
                raise ValueError("フロア図要素IDが重複しています。")
            floor_marker_ids.add(marker_id)
            kind = raw_marker.get("kind")
            if kind not in ALLOWED_FLOOR_MARKER_KINDS:
                raise ValueError("フロア図要素の種類が正しくありません。")
            item_id = raw_marker.get("itemId")
            marker_image = raw_marker.get("image")
            marker_text = raw_marker.get("text", "")
            if kind == "item":
                if item_id not in item_by_id or item_by_id[item_id]["type"] == "facility":
                    raise ValueError("フロア図に配置する企画が見つかりません。")
                if item_id in floor_item_ids:
                    raise ValueError("同じ企画が複数のフロア図に配置されています。")
                if (item_by_id[item_id]["building"], item_by_id[item_id]["floor"]) != (building, floor):
                    raise ValueError("企画の場所と配置先のフロア図が一致していません。")
                floor_item_ids.add(item_id)
                marker_image = None
                marker_text = ""
            elif kind == "facility":
                if item_id not in item_by_id or item_by_id[item_id]["type"] != "facility":
                    raise ValueError("フロア図に配置する設備案内が見つかりません。")
                marker_image = None
                marker_text = ""
            elif kind == "image":
                item_id = None
                marker_image = _asset_path(marker_image, required=True)
                marker_text = ""
            else:
                item_id = None
                marker_image = None
                marker_text = _text(marker_text, "フロア図の文字", 80)
            locked = raw_marker.get("locked", False)
            if not isinstance(locked, bool):
                raise ValueError("フロア図要素の位置固定設定が正しくありません。")
            floor_markers.append({
                "id": marker_id,
                "kind": kind,
                "itemId": item_id,
                "image": marker_image,
                "text": marker_text,
                "color": _color(raw_marker.get("color", "#3274b6"), "フロア図要素"),
                "x": _number(raw_marker.get("x"), "フロア図の横位置", 0, 100, 3),
                "y": _number(raw_marker.get("y"), "フロア図の縦位置", 0, 100, 3),
                "size": _number(raw_marker.get("size"), "フロア図要素の大きさ", 24, 400, 1),
                "rotation": _number(raw_marker.get("rotation", 0), "フロア図要素の回転角度", -180, 180, 1),
                "layer": int(_number(raw_marker.get("layer", 1), "フロア図要素の重なり順", 0, 500, 0)),
                "locked": locked,
            })
        floor_plans.append({
            "id": plan_id,
            "label": label,
            "building": building,
            "floor": floor,
            "image": _asset_path(image_path, required=True),
            "markers": floor_markers,
        })

    return {
        "schemaVersion": 4,
        "revision": current.get("revision", 0) + 1,
        "settings": settings,
        "categories": categories,
        "items": items,
        "markers": markers,
        "floorPlans": floor_plans,
    }


def save_guide_atomically(guide: dict[str, Any]) -> str:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    backup_path = BACKUP_DIR / f"guide_{timestamp}.json"
    shutil.copy2(GUIDE_DATA, backup_path)

    descriptor, temporary_name = tempfile.mkstemp(dir=DATA_DIR, prefix="guide_", suffix=".tmp")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as file:
            json.dump(guide, file, ensure_ascii=False, indent=2)
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary_name, GUIDE_DATA)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise
    return backup_path.name


def save_editor_guide(payload: Any) -> tuple[dict[str, Any], str]:
    with GUIDE_LOCK:
        current = load_guide()
        guide = validate_guide(payload, current)
        backup_name = save_guide_atomically(guide)
        return guide, backup_name


def _thumbnail_for(path: Path) -> str:
    relative = path.relative_to(STATIC_IMAGE_DIR).as_posix()
    digest = hashlib.sha1(relative.encode("utf-8")).hexdigest()
    THUMB_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    thumbnail = THUMB_IMAGE_DIR / f"{digest}.png"
    if not thumbnail.exists() or thumbnail.stat().st_mtime < path.stat().st_mtime:
        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source).convert("RGBA")
            image.thumbnail((240, 180), Image.Resampling.LANCZOS)
            canvas = Image.new("RGBA", (240, 180), (255, 255, 255, 0))
            canvas.alpha_composite(image, ((240 - image.width) // 2, (180 - image.height) // 2))
            canvas.save(thumbnail, "PNG", optimize=True)
    return thumbnail.relative_to(STATIC_IMAGE_DIR).as_posix()


def list_assets() -> list[dict[str, Any]]:
    assets: list[dict[str, Any]] = []
    for group, directory in (("library", LIBRARY_IMAGE_DIR), ("uploads", UPLOAD_IMAGE_DIR)):
        directory.mkdir(parents=True, exist_ok=True)
        for path in sorted(directory.iterdir(), key=lambda item: item.name.casefold()):
            if not path.is_file() or path.suffix.lower() not in ALLOWED_IMAGE_EXTENSIONS:
                continue
            try:
                with Image.open(path) as image:
                    width, height = image.size
                    transparent = "A" in image.getbands() and image.getchannel("A").getextrema()[0] < 255
                assets.append({
                    "path": path.relative_to(STATIC_IMAGE_DIR).as_posix(),
                    "thumbnail": _thumbnail_for(path),
                    "name": path.stem,
                    "group": group,
                    "width": width,
                    "height": height,
                    "transparent": transparent,
                })
            except (OSError, UnidentifiedImageError):
                continue
    return assets


def _remove_border_background(image: Image.Image, tolerance: int) -> Image.Image:
    result = image.convert("RGBA")
    corners = [
        (0, 0),
        (result.width - 1, 0),
        (0, result.height - 1),
        (result.width - 1, result.height - 1),
    ]
    for point in corners:
        if result.getpixel(point)[3] == 0:
            continue
        ImageDraw.floodfill(result, point, (255, 255, 255, 0), thresh=tolerance)
    return result


def save_uploaded_image(file: FileStorage, remove_background: bool, tolerance: int) -> dict[str, Any]:
    if not file or not file.filename:
        raise ValueError("追加する画像を選択してください。")
    extension = Path(file.filename).suffix.lower()
    if extension not in ALLOWED_IMAGE_EXTENSIONS:
        raise ValueError("PNG、JPEG、WebP画像を選択してください。")

    ORIGINAL_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = secure_filename(Path(file.filename).stem)[:60] or "image"
    unique = uuid4().hex[:12]
    original_path = ORIGINAL_IMAGE_DIR / f"{unique}_{safe_name}{extension}"
    output_path = UPLOAD_IMAGE_DIR / f"{unique}_{safe_name}.png"
    file.save(original_path)

    try:
        with Image.open(original_path) as source:
            source.verify()
        with Image.open(original_path) as source:
            image = ImageOps.exif_transpose(source).convert("RGBA")
            if image.width > 8000 or image.height > 8000:
                raise ValueError("画像サイズは縦横8000px以内にしてください。")
            if remove_background:
                image = _remove_border_background(image, max(0, min(100, int(tolerance))))
            image.save(output_path, "PNG", optimize=True)
    except ValueError:
        original_path.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)
        raise
    except (OSError, UnidentifiedImageError) as error:
        original_path.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)
        raise ValueError("画像ファイルを読み込めませんでした。") from error

    relative = output_path.relative_to(STATIC_IMAGE_DIR).as_posix()
    thumbnail = _thumbnail_for(output_path)
    return {
        "path": relative,
        "thumbnail": thumbnail,
        "name": Path(file.filename).stem,
        "group": "uploads",
        "width": image.width,
        "height": image.height,
        "transparent": "A" in image.getbands() and image.getchannel("A").getextrema()[0] < 255,
    }
