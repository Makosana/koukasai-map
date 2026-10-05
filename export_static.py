"""案内画面を GitHub Pages 用の静的ファイルとして docs/ に書き出します。"""

import json
import re
import shutil

from storage import BASE_DIR, GUIDE_LOCK, STATIC_IMAGE_DIR, load_guide


OUTPUT_DIR = BASE_DIR / "docs"
TEMPLATE = BASE_DIR / "templates" / "index.html"
STATIC_DIR = BASE_DIR / "static"
IMAGE_FOLDERS = ("maps", "floors", "ui", "system", "uploads", "library")
STATIC_CONFIG = '<script>window.KOUKA_STATIC_BASE="static/images/";window.KOUKA_GUIDE_URL="guide.json";</script>'


def render_index() -> str:
    html = TEMPLATE.read_text(encoding="utf-8")
    html = re.sub(
        r"\{\{\s*url_for\('static',\s*filename='([^']+)'\)\s*\}\}",
        lambda match: f"static/{match.group(1)}",
        html,
    )
    if "{{" in html or "{%" in html:
        raise RuntimeError("templates/index.html に書き出せないテンプレート構文があります。")
    return html.replace("</head>", f"    {STATIC_CONFIG}\n</head>", 1)


def export() -> None:
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    (OUTPUT_DIR / "static" / "css").mkdir(parents=True)
    (OUTPUT_DIR / "static" / "js").mkdir(parents=True)

    (OUTPUT_DIR / "index.html").write_text(render_index(), encoding="utf-8")
    with GUIDE_LOCK:
        guide = load_guide()
    (OUTPUT_DIR / "guide.json").write_text(json.dumps(guide, ensure_ascii=False, indent=2), encoding="utf-8")

    shutil.copy2(STATIC_DIR / "css" / "viewer.css", OUTPUT_DIR / "static" / "css" / "viewer.css")
    shutil.copy2(STATIC_DIR / "js" / "viewer.js", OUTPUT_DIR / "static" / "js" / "viewer.js")
    for folder in IMAGE_FOLDERS:
        source = STATIC_IMAGE_DIR / folder
        if source.exists():
            shutil.copytree(source, OUTPUT_DIR / "static" / "images" / folder)

    (OUTPUT_DIR / ".nojekyll").write_text("", encoding="utf-8")


if __name__ == "__main__":
    export()
    print(f"案内画面を書き出しました: {OUTPUT_DIR}")
