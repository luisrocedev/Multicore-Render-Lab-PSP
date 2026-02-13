from __future__ import annotations

import os
import sqlite3
import threading
import time
import uuid
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from random import Random
from typing import Any

from flask import Flask, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "jobs.sqlite3"
CPU_CORES = os.cpu_count() or 4

app = Flask(__name__)

jobs_lock = threading.Lock()
jobs: dict[str, dict[str, Any]] = {}


def db_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = db_conn()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS render_jobs (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            mode TEXT NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            max_iter INTEGER NOT NULL,
            samples INTEGER NOT NULL,
            workers INTEGER NOT NULL,
            chunk_size INTEGER NOT NULL,
            status TEXT NOT NULL,
            progress REAL NOT NULL,
            duration_ms REAL,
            pixels_per_second REAL
        )
        """
    )
    conn.commit()
    conn.close()


def insert_job_row(job: dict[str, Any]) -> None:
    conn = db_conn()
    conn.execute(
        """
        INSERT INTO render_jobs (
            id, created_at, mode, width, height, max_iter, samples,
            workers, chunk_size, status, progress, duration_ms, pixels_per_second
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            job["id"],
            job["created_at"],
            job["mode"],
            job["width"],
            job["height"],
            job["max_iter"],
            job["samples"],
            job["workers"],
            job["chunk_size"],
            job["status"],
            job["progress"],
            job.get("duration_ms"),
            job.get("pixels_per_second"),
        ),
    )
    conn.commit()
    conn.close()


def update_job_row(job: dict[str, Any]) -> None:
    conn = db_conn()
    conn.execute(
        """
        UPDATE render_jobs
        SET status = ?, progress = ?, duration_ms = ?, pixels_per_second = ?
        WHERE id = ?
        """,
        (
            job["status"],
            job["progress"],
            job.get("duration_ms"),
            job.get("pixels_per_second"),
            job["id"],
        ),
    )
    conn.commit()
    conn.close()


def mandelbrot_escape(cx: float, cy: float, max_iter: int) -> int:
    zx = 0.0
    zy = 0.0
    for i in range(max_iter):
        zx2 = zx * zx - zy * zy + cx
        zy2 = 2.0 * zx * zy + cy
        zx = zx2
        zy = zy2
        if zx * zx + zy * zy > 4.0:
            return i
    return max_iter


def render_chunk(params: dict[str, int], y0: int, y1: int, seed: int) -> tuple[int, int, list[int]]:
    width = params["width"]
    height = params["height"]
    max_iter = params["max_iter"]
    samples = params["samples"]

    rng = Random(seed)
    out: list[int] = []

    for y in range(y0, y1):
        for x in range(width):
            total = 0.0
            for _ in range(samples):
                jx = rng.random() - 0.5
                jy = rng.random() - 0.5
                nx = (x + 0.5 + jx) / width
                ny = (y + 0.5 + jy) / height
                cx = nx * 3.5 - 2.5
                cy = ny * 2.0 - 1.0
                total += mandelbrot_escape(cx, cy, max_iter)
            out.append(int(total / samples))

    return y0, y1, out


def run_render_job(job_id: str) -> None:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return

    width = int(job["width"])
    height = int(job["height"])
    max_iter = int(job["max_iter"])
    samples = int(job["samples"])
    chunk_size = int(job["chunk_size"])
    workers = int(job["workers"])

    params = {
        "width": width,
        "height": height,
        "max_iter": max_iter,
        "samples": samples,
    }

    chunks = []
    for y in range(0, height, chunk_size):
        chunks.append((y, min(y + chunk_size, height)))

    started = time.perf_counter()
    buffer = [0] * (width * height)
    completed_chunks = 0

    try:
        with ProcessPoolExecutor(max_workers=workers) as ex:
            futures = [
                ex.submit(render_chunk, params, y0, y1, (y0 + 1) * 9973)
                for y0, y1 in chunks
            ]

            for fut in as_completed(futures):
                y0, y1, out = fut.result()
                row_count = y1 - y0
                for r in range(row_count):
                    src_start = r * width
                    src_end = src_start + width
                    dst_start = (y0 + r) * width
                    dst_end = dst_start + width
                    buffer[dst_start:dst_end] = out[src_start:src_end]

                completed_chunks += 1
                progress = completed_chunks / len(chunks)

                with jobs_lock:
                    if job_id in jobs:
                        jobs[job_id]["progress"] = progress
                        jobs[job_id]["updated_at"] = time.time()

        elapsed = (time.perf_counter() - started)
        duration_ms = round(elapsed * 1000, 2)
        pixels = width * height
        pps = round(pixels / elapsed, 2) if elapsed > 0 else 0.0

        with jobs_lock:
            if job_id in jobs:
                jobs[job_id]["status"] = "done"
                jobs[job_id]["progress"] = 1.0
                jobs[job_id]["result"] = buffer
                jobs[job_id]["duration_ms"] = duration_ms
                jobs[job_id]["pixels_per_second"] = pps

                update_job_row(jobs[job_id])

    except Exception:
        with jobs_lock:
            if job_id in jobs:
                jobs[job_id]["status"] = "failed"
                jobs[job_id]["progress"] = 1.0
                update_job_row(jobs[job_id])


@app.get("/")
def index() -> str:
    return render_template("index.html", cores=CPU_CORES)


@app.post("/api/jobs")
def create_job():
    payload = request.get_json(silent=True) or {}

    width = int(payload.get("width", 640))
    height = int(payload.get("height", 360))
    max_iter = int(payload.get("max_iter", 500))
    samples = int(payload.get("samples", 2))
    chunk_size = int(payload.get("chunk_size", 16))
    mode = str(payload.get("mode", "multicore"))

    width = max(160, min(width, 1600))
    height = max(100, min(height, 1000))
    max_iter = max(50, min(max_iter, 2000))
    samples = max(1, min(samples, 12))
    chunk_size = max(4, min(chunk_size, 128))

    workers = 1 if mode == "single" else CPU_CORES

    job_id = uuid.uuid4().hex[:12]
    created_at = time.strftime("%Y-%m-%d %H:%M:%S")

    job = {
        "id": job_id,
        "created_at": created_at,
        "mode": mode,
        "width": width,
        "height": height,
        "max_iter": max_iter,
        "samples": samples,
        "workers": workers,
        "chunk_size": chunk_size,
        "status": "running",
        "progress": 0.0,
        "duration_ms": None,
        "pixels_per_second": None,
        "result": None,
        "updated_at": time.time(),
    }

    with jobs_lock:
        jobs[job_id] = job

    insert_job_row(job)

    th = threading.Thread(target=run_render_job, args=(job_id,), daemon=True)
    th.start()

    return jsonify({"ok": True, "job_id": job_id, "workers": workers})


@app.get("/api/jobs/<job_id>")
def get_job(job_id: str):
    include_result = request.args.get("include_result", "0") == "1"

    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({"ok": False, "error": "job_not_found"}), 404

        data = {
            "ok": True,
            "id": job["id"],
            "status": job["status"],
            "progress": job["progress"],
            "created_at": job["created_at"],
            "mode": job["mode"],
            "width": job["width"],
            "height": job["height"],
            "max_iter": job["max_iter"],
            "samples": job["samples"],
            "workers": job["workers"],
            "chunk_size": job["chunk_size"],
            "duration_ms": job.get("duration_ms"),
            "pixels_per_second": job.get("pixels_per_second"),
        }

        if include_result and job["status"] == "done":
            data["result"] = job.get("result")

    return jsonify(data)


@app.get("/api/history")
def history():
    conn = db_conn()
    rows = conn.execute(
        """
        SELECT id, created_at, mode, width, height, max_iter, samples,
               workers, chunk_size, status, progress, duration_ms, pixels_per_second
        FROM render_jobs
        ORDER BY created_at DESC
        LIMIT 30
        """
    ).fetchall()
    conn.close()

    return jsonify(
        {
            "ok": True,
            "items": [dict(r) for r in rows],
        }
    )


if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5055, debug=True)
