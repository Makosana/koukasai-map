from flask import Flask, jsonify, render_template
from waitress import serve

from storage import GUIDE_LOCK, load_guide


app = Flask(__name__)


@app.after_request
def disable_cache(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/guide")
def guide():
    with GUIDE_LOCK:
        return jsonify(load_guide())


@app.get("/health")
def health():
    return {"status": "ok", "program": "viewer"}


if __name__ == "__main__":
    print("紅華祭案内画面を起動しました。")
    print("このPC: http://127.0.0.1:5000/")
    print("別のPC: http://サーバーPCのIPv4アドレス:5000/")
    print("終了する場合は Ctrl+C を押してください。")
    serve(app, host="0.0.0.0", port=5000, threads=8)
