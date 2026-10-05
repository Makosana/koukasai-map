import json

from flask import Flask, jsonify, render_template, request
from waitress import serve

from storage import (
    GUIDE_LOCK,
    RevisionConflict,
    list_assets,
    load_guide,
    save_editor_guide,
    save_uploaded_image,
)


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024


@app.after_request
def disable_cache(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response


@app.get("/")
def editor_page():
    return render_template("editor.html")


@app.get("/preview")
def preview_page():
    return render_template("index.html")


@app.get("/floors")
def floor_editor_page():
    return render_template("floor_editor.html")


@app.get("/api/guide")
@app.get("/api/editor/guide")
def get_guide():
    with GUIDE_LOCK:
        return jsonify(load_guide())


@app.get("/api/editor/assets")
def get_assets():
    return jsonify({"ok": True, "assets": list_assets()})


@app.post("/api/editor/save")
def save_guide():
    try:
        guide, backup = save_editor_guide(request.get_json(silent=True))
    except RevisionConflict as error:
        return jsonify({"ok": False, "message": str(error)}), 409
    except ValueError as error:
        return jsonify({"ok": False, "message": str(error)}), 400
    except (OSError, json.JSONDecodeError):
        app.logger.exception("編集データの保存に失敗しました。")
        return jsonify({"ok": False, "message": "データを保存できませんでした。"}), 500
    return jsonify({"ok": True, "guide": guide, "backup": backup})


@app.post("/api/editor/upload")
def upload_image():
    try:
        remove_background = request.form.get("removeBackground") == "true"
        tolerance = int(request.form.get("tolerance", "35"))
        asset = save_uploaded_image(request.files.get("image"), remove_background, tolerance)
    except (TypeError, ValueError) as error:
        return jsonify({"ok": False, "message": str(error)}), 400
    except OSError:
        app.logger.exception("画像の保存に失敗しました。")
        return jsonify({"ok": False, "message": "画像を保存できませんでした。"}), 500
    return jsonify({"ok": True, "asset": asset})


@app.get("/health")
def health():
    return {"status": "ok", "program": "editor"}


@app.errorhandler(413)
def file_too_large(_error):
    return jsonify({"ok": False, "message": "画像は25MB以下にしてください。"}), 413


if __name__ == "__main__":
    print("紅華祭UI作成プログラムを起動しました。")
    print("ブラウザーで http://127.0.0.1:5001/ を開いてください。")
    print("プレビュー: http://127.0.0.1:5001/preview")
    print("終了する場合は Ctrl+C を押してください。")
    serve(app, host="127.0.0.1", port=5001, threads=6)
