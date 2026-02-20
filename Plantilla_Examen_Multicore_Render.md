# Multicore-Render-Lab — Plantilla de Examen

**Alumno:** Luis Rodríguez Cedeño · **DNI:** 53945291X  
**Módulo:** Programación de Servicios y Procesos · **Curso:** DAM2 2025/26

---

## 1. Introducción

- **Qué es:** Renderizador de fractales Mandelbrot con multiproceso (`ProcessPoolExecutor`), job tracking en SQLite
- **Contexto:** Módulo de PSP — multiproceso (procesos vs hilos), paralelismo CPU-bound, Ley de Amdahl
- **Objetivos principales:**
  - Algoritmo Mandelbrot (escape-time) con muestreo Monte Carlo (anti-aliasing)
  - Renderizado paralelo con `ProcessPoolExecutor` (N workers = N cores)
  - División del trabajo en chunks (filas del fractal)
  - Job tracking en SQLite (status: running → done/failed, duración, pixels/s)
  - Comparación single-core vs multi-core (speedup medible)
- **Tecnologías clave:**
  - Python 3.11, `concurrent.futures.ProcessPoolExecutor`, `as_completed()`
  - `threading` (lanzar render en background), SQLite, Flask (API REST)
  - Algoritmo Mandelbrot, Monte Carlo sampling
- **Arquitectura:** `app.py` (~370 líneas: Mandelbrot + ProcessPool + Flask API) → `templates/index.html` (dashboard) → `static/app.js` (polling + render canvas)

---

## 2. Desarrollo de las partes

### 2.1 Algoritmo Mandelbrot — Escape time

- Itera $z_{n+1} = z_n^2 + c$ hasta que $|z| > 2$ o se alcanza `max_iter`
- Devuelve número de iteraciones hasta escape (determina el color)
- Coordenadas mapeadas: pixel → plano complejo $[-2.5, 1.0] \times [-1.0, 1.0]$

```python
def mandelbrot_escape(cx: float, cy: float, max_iter: int) -> int:
    """Calcular iteraciones de escape para un punto del plano complejo."""
    zx = 0.0
    zy = 0.0
    for i in range(max_iter):
        zx2 = zx * zx - zy * zy + cx    # Parte real: Re(z²) + cx
        zy2 = 2.0 * zx * zy + cy        # Parte imaginaria: 2·Re·Im + cy
        zx = zx2
        zy = zy2
        if zx * zx + zy * zy > 4.0:     # |z|² > 4 → escapó
            return i
    return max_iter  # No escapó → pertenece al conjunto
```

> **Explicación:** Implementación de $z = z^2 + c$ con aritmética de punto flotante. Se descompone en parte real ($zx$) e imaginaria ($zy$). Si $|z|^2 > 4$ (equivale a $|z| > 2$), el punto escapa. El número de iteraciones determina el color en la paleta.

### 2.2 Render chunk — Monte Carlo sampling

- Cada chunk procesa un rango de filas [y0, y1) del fractal
- Monte Carlo: N muestras por pixel con jitter aleatorio → media → anti-aliasing
- `Random(seed)` → reproducible (cada chunk tiene seed distinto)

```python
from random import Random

def render_chunk(params: dict, y0: int, y1: int, seed: int) -> tuple:
    """Renderizar un bloque de filas del fractal (ejecuta en proceso hijo)."""
    width = params["width"]
    height = params["height"]
    max_iter = params["max_iter"]
    samples = params["samples"]

    rng = Random(seed)
    out = []

    for y in range(y0, y1):
        for x in range(width):
            total = 0.0
            for _ in range(samples):
                # Jitter aleatorio para anti-aliasing Monte Carlo
                jx = rng.random() - 0.5
                jy = rng.random() - 0.5
                nx = (x + 0.5 + jx) / width
                ny = (y + 0.5 + jy) / height
                cx = nx * 3.5 - 2.5   # Mapeo a [-2.5, 1.0]
                cy = ny * 2.0 - 1.0   # Mapeo a [-1.0, 1.0]
                total += mandelbrot_escape(cx, cy, max_iter)
            out.append(int(total / samples))

    return y0, y1, out
```

> **Explicación:** Cada pixel se muestrea N veces con posiciones ligeramente aleatorias (jitter). Se promedian las iteraciones de escape para suavizar bordes (anti-aliasing Monte Carlo). `Random(seed)` garantiza resultados reproducibles por chunk.

### 2.3 ProcessPoolExecutor — Paralelismo multi-core

- División en chunks de `chunk_size` filas → N tareas independientes
- `ProcessPoolExecutor(max_workers=CPU_CORES)` → un proceso por core
- `as_completed()` → procesa resultados a medida que terminan (no secuencial)

```python
from concurrent.futures import ProcessPoolExecutor, as_completed

def run_render_job(job_id: str):
    """Ejecutar render Mandelbrot en paralelo."""
    # Dividir en chunks de filas
    chunks = []
    for y in range(0, height, chunk_size):
        chunks.append((y, min(y + chunk_size, height)))

    buffer = [0] * (width * height)
    completed_chunks = 0

    with ProcessPoolExecutor(max_workers=workers) as ex:
        # Lanzar todas las tareas
        futures = [
            ex.submit(render_chunk, params, y0, y1, (y0 + 1) * 9973)
            for y0, y1 in chunks
        ]

        # Recoger resultados según terminan
        for fut in as_completed(futures):
            y0, y1, out = fut.result()
            # Copiar resultado al buffer
            for r in range(y1 - y0):
                dst_start = (y0 + r) * width
                buffer[dst_start:dst_start + width] = out[r * width:(r + 1) * width]

            completed_chunks += 1
            jobs[job_id]["progress"] = completed_chunks / len(chunks)
```

> **Explicación:** `ex.submit()` envía cada chunk a un proceso del pool. `as_completed()` itera sobre futuros según terminan (no en orden de envío), permitiendo actualizar progreso en tiempo real. Cada proceso hijo ejecuta `render_chunk` de forma independiente.

### 2.4 Job tracking — SQLite + progreso

- Cada render es un "job" con: id, modo (single/multi), dimensiones, status, progress
- Status: `running` → `done` | `failed`
- Métricas: `duration_ms`, `pixels_per_second`

```python
def update_job_row(job: dict) -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        UPDATE render_jobs
        SET status = ?, progress = ?, duration_ms = ?, pixels_per_second = ?
        WHERE id = ?
    """, (job["status"], job["progress"],
          job.get("duration_ms"), job.get("pixels_per_second"), job["id"]))
    conn.commit()
    conn.close()

# Al finalizar:
elapsed = time.perf_counter() - started
duration_ms = round(elapsed * 1000, 2)
pps = round(width * height / elapsed, 2)  # pixels por segundo

jobs[job_id]["status"] = "done"
jobs[job_id]["duration_ms"] = duration_ms
jobs[job_id]["pixels_per_second"] = pps
update_job_row(jobs[job_id])
```

> **Explicación:** `time.perf_counter()` mide el reloj de alta resolución. Se calcula la duración en ms y los pixels/segundo como KPI de rendimiento. Comparar single (1 worker) vs multi (N workers) mide el speedup real del paralelismo.

### 2.5 API REST — Crear y consultar jobs

- `POST /api/jobs` → lanza render en hilo daemon (que a su vez crea procesos)
- `GET /api/jobs/<id>` → status + progress (polling desde frontend)
- `GET /api/stats` → KPIs agregados (total, done, failed, avg duration, avg pps)

```python
@app.post("/api/jobs")
def create_job():
    payload = request.get_json(silent=True) or {}
    mode = str(payload.get("mode", "multicore"))  # 'single' o 'multicore'
    workers = 1 if mode == "single" else CPU_CORES

    job = {
        "id": uuid.uuid4().hex[:12],
        "mode": mode,
        "workers": workers,
        "status": "running",
        "progress": 0.0,
        # ... width, height, max_iter, samples, chunk_size
    }

    jobs[job["id"]] = job
    insert_job_row(job)

    # Lanzar en hilo daemon (que creará procesos internamente)
    th = threading.Thread(target=run_render_job, args=(job["id"],), daemon=True)
    th.start()

    return jsonify({"ok": True, "job_id": job["id"], "workers": workers})
```

> **Explicación:** El endpoint crea el job, lo guarda en SQLite y lo lanza en un hilo daemon. Dentro de ese hilo, `ProcessPoolExecutor` crea los procesos reales. El frontend poll-ea `/api/jobs/<id>` para ver el progreso hasta `status == "done"`.

---

## 3. Presentación del proyecto

- **Flujo:** POST /api/jobs → hilo → ProcessPoolExecutor → chunks → merge → done → GET resultado
- **Demo:** `python app.py` → dashboard → render single-core → render multi-core → comparar tiempos
- **Concurrencia real:** Procesos (`os.fork`) vs Hilos — ProcessPoolExecutor evita el GIL de Python
- **Speedup observable:** Multi-core debería ser ~N veces más rápido (N = cores)

---

## 4. Conclusión

- **Competencias:** `ProcessPoolExecutor`, `as_completed()`, chunk-based parallelism, Mandelbrot, Monte Carlo
- **Procesos vs Hilos:** Python GIL bloquea hilos para CPU-bound → procesos son la solución
- **Ley de Amdahl:** Speedup teórico limitado por la parte secuencial (merge del buffer es secuencial)
- **KPIs de rendimiento:** pixels/segundo y duración permiten medir speedup empírico
- **Valoración:** Proyecto que demuestra paralelismo real con multiproceso, rendering computacional y benchmarking
