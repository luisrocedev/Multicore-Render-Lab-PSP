# Actividad PSP-001 · Procesamiento Multinúcleo

**Alumno:** Luis Rodríguez Cedeño  
**DNI:** 53945291X  
**Curso:** DAM2 — Programación de Servicios y Procesos  
**Lección:** 301-Actividades final de unidad · Segundo trimestre / 001-Multinúcleo  
**Proyecto:** Multicore Render Lab

---

## 1. Introducción breve y contextualización

### 1.1 Contexto de la actividad

La presente actividad se enmarca dentro del módulo de **Programación de Servicios y Procesos** (PSP) del segundo curso de Desarrollo de Aplicaciones Multiplataforma (DAM2). Su objetivo es demostrar el dominio del procesamiento paralelo multinúcleo, la división de trabajo en subtareas independientes y la coordinación de múltiples procesos para resolver una carga computacional intensiva.

El ejercicio parte de una base propuesta en clase (render Monte Carlo con script aislado) y se extiende hacia un escenario profesional de **renderizado de fractales Mandelbrot** con arquitectura cliente-servidor, cola de trabajos, persistencia de métricas y un dashboard interactivo para controlar y visualizar los resultados.

### 1.2 Objetivo del proyecto

**Multicore Render Lab** es una plataforma completa de renderizado paralelo que:

- **Divide la imagen** en chunks (franjas horizontales) de N filas.
- **Distribuye la carga** entre múltiples procesos worker mediante `ProcessPoolExecutor`.
- **Renderiza fractales Mandelbrot** con muestreo Monte Carlo (jittered sampling).
- **Compara rendimiento** entre modo single-core y multicore, calculando speedup real.
- **Persiste resultados** en SQLite para análisis histórico y trazabilidad.
- **Visualiza en tiempo real** el progreso y el fractal generado en un Canvas HTML5.

### 1.3 Justificación técnica

La elección de Python se justifica por su módulo `concurrent.futures`, que ofrece una API de alto nivel para paralelismo basado en procesos (no hilos), evitando el GIL y aprovechando todos los núcleos del procesador. El algoritmo de Mandelbrot es ideal para demostrar paralelización porque:

- Cada píxel se calcula de forma **completamente independiente**.
- La carga computacional es **variable** (los píxeles del borde del conjunto requieren más iteraciones).
- El muestreo Monte Carlo multiplica la carga, haciendo evidente el beneficio del paralelismo.

| Concepto PSP              | Implementación                                            |
|---------------------------|-----------------------------------------------------------|
| Programación multiproceso | `ProcessPoolExecutor` con N workers                       |
| División de trabajo       | Chunking por franjas horizontales de la imagen            |
| Sincronización            | `as_completed()` + `futures` para recolección de resultados |
| Comunicación IPC          | Serialización pickle automática entre procesos            |
| Persistencia              | SQLite con tabla `render_jobs`                            |

### 1.4 Tecnologías utilizadas

| Capa      | Stack                                                           |
|-----------|-----------------------------------------------------------------|
| Backend   | Python 3.12 · Flask 3.x · SQLite 3                              |
| Paralelo  | `concurrent.futures.ProcessPoolExecutor`                         |
| Algoritmo | Mandelbrot escape-time + jittered Monte Carlo sampling           |
| Frontend  | HTML5 · CSS3 (custom properties, dark mode) · JavaScript ES2022 |
| Canvas    | Canvas API 2D · `ImageData` + `putImageData`                    |

### 1.5 Arquitectura del sistema

```
┌─────────────────┐
│  Web Browser     │
│  (Dashboard)     │
└────────┬─────────┘
         │ HTTP + JSON
         ▼
┌─────────────────┐
│  Flask Server    │
│  (:5055)         │
└────────┬─────────┘
         │ ProcessPoolExecutor
    ┌────┴─────┬──────┬──────┐
    ▼          ▼      ▼      ▼
┌────────┐┌────────┐┌────────┐┌────────┐
│Worker 1││Worker 2││Worker 3││Worker N│
│(Chunk) ││(Chunk) ││(Chunk) ││(Chunk) │
└────────┘└────────┘└────────┘└────────┘
         │
         ▼
    ┌────────┐
    │ SQLite │
    └────────┘
```

---

## 2. Desarrollo detallado y preciso

### 2.1 Modelo de datos (SQLite)

El sistema utiliza una tabla para almacenar el histórico de trabajos de renderizado:

```sql
CREATE TABLE IF NOT EXISTS render_jobs (
    id                TEXT PRIMARY KEY,
    created_at        TEXT NOT NULL,
    mode              TEXT NOT NULL,          -- multicore | single
    width             INTEGER NOT NULL,
    height            INTEGER NOT NULL,
    max_iter          INTEGER NOT NULL,
    samples           INTEGER NOT NULL,
    workers           INTEGER NOT NULL,
    chunk_size        INTEGER NOT NULL,
    status            TEXT NOT NULL,          -- running | done | failed
    progress          REAL NOT NULL,          -- 0.0 a 1.0
    duration_ms       REAL,
    pixels_per_second REAL
);
```

Cada trabajo se persiste desde su creación (estado `running`) y se actualiza al completarse (`done`) o fallar (`failed`), registrando la duración real y los píxeles procesados por segundo.

### 2.2 Algoritmo de escape de Mandelbrot

El corazón del motor de renderizado es la función `mandelbrot_escape()`, que implementa el algoritmo clásico de escape-time del conjunto de Mandelbrot:

```python
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
```

Para cada punto $c = c_x + c_y i$ del plano complejo, se itera la recurrencia $z_{n+1} = z_n^2 + c$ partiendo de $z_0 = 0$. Si $|z_n| > 2$ antes de alcanzar `max_iter`, el punto escapa y se retorna el número de iteraciones como valor de color. Los puntos del interior del conjunto alcanzan `max_iter` y se colorean en negro.

La ventana de visualización mapea las coordenadas de pantalla al rectángulo $[-2.5, 1.0] \times [-1.0, 1.0]$ del plano complejo, que contiene la región más interesante del conjunto de Mandelbrot.

### 2.3 Muestreo Monte Carlo (jittered sampling)

Para suavizar los bordes (antialiasing), se aplica muestreo Monte Carlo con N samples por píxel:

```python
def render_chunk(params, y0, y1, seed):
    rng = Random(seed)
    out = []

    for y in range(y0, y1):
        for x in range(width):
            total = 0.0
            for _ in range(samples):
                # Offset aleatorio dentro del píxel (jitter)
                jx = rng.random() - 0.5
                jy = rng.random() - 0.5
                nx = (x + 0.5 + jx) / width
                ny = (y + 0.5 + jy) / height
                # Mapeo a plano complejo
                cx = nx * 3.5 - 2.5
                cy = ny * 2.0 - 1.0
                total += mandelbrot_escape(cx, cy, max_iter)
            out.append(int(total / samples))

    return y0, y1, out
```

Cada sample desplaza aleatoriamente la posición dentro del píxel, generando un rayo ligeramente diferente. El promedio de todos los samples produce un valor suavizado que elimina el aliasing visible en los bordes del fractal. Esto es equivalente a un anti-aliasing estocástico, técnica usada ampliamente en renderizado profesional (Monte Carlo path tracing).

Cada chunk recibe un `seed` determinista (`(y0 + 1) * 9973`) para garantizar reproducibilidad entre ejecuciones con los mismos parámetros.

### 2.4 Procesamiento paralelo con ProcessPoolExecutor

La paralelización se realiza dividiendo la imagen en franjas horizontales (chunks) y distribuyéndolas entre múltiples procesos:

```python
def run_render_job(job_id):
    # 1. Dividir la imagen en chunks de N filas
    chunks = []
    for y in range(0, height, chunk_size):
        chunks.append((y, min(y + chunk_size, height)))

    # 2. Buffer para el resultado final
    buffer = [0] * (width * height)
    completed_chunks = 0

    # 3. Ejecutar en paralelo
    with ProcessPoolExecutor(max_workers=workers) as ex:
        futures = [
            ex.submit(render_chunk, params, y0, y1, (y0 + 1) * 9973)
            for y0, y1 in chunks
        ]

        # 4. Recoger resultados conforme se completan
        for fut in as_completed(futures):
            y0, y1, out = fut.result()
            # 5. Ensamblar en el buffer
            for r in range(y1 - y0):
                src_start = r * width
                dst_start = (y0 + r) * width
                buffer[dst_start:dst_start + width] = out[src_start:src_start + width]

            # 6. Actualizar progreso
            completed_chunks += 1
            progress = completed_chunks / len(chunks)
            jobs[job_id]["progress"] = progress
```

**Aspectos clave de la paralelización:**

| Aspecto               | Implementación                                                   |
|------------------------|------------------------------------------------------------------|
| Tipo de pool           | `ProcessPoolExecutor` (procesos reales, no hilos)                |
| Workers                | `os.cpu_count()` en modo multicore, 1 en modo single            |
| División de trabajo    | Franjas horizontales de `chunk_size` filas                       |
| Recolección            | `as_completed()` para progreso no-bloqueante                     |
| Serialización          | Pickle automático (parámetros → worker → resultado)              |
| Protección de estado   | `threading.Lock` para acceso concurrente al dict `jobs`          |
| Hilo de ejecución      | `threading.Thread(daemon=True)` para no bloquear Flask           |

### 2.5 API REST (Flask)

El backend expone 5 endpoints:

| Endpoint                          | Método | Descripción                                        |
|-----------------------------------|--------|----------------------------------------------------|
| `/api/jobs`                       | POST   | Crear trabajo con parámetros validados              |
| `/api/jobs/<id>`                  | GET    | Estado, progreso y métricas de un trabajo           |
| `/api/jobs/<id>?include_result=1` | GET    | Igual + array completo de píxeles renderizados      |
| `/api/history`                    | GET    | Últimos 30 trabajos desde SQLite                    |
| `/api/stats`                      | GET    | KPIs agregados (total, medias, completados, fallos) |

La validación de parámetros incluye rangos fijos para prevenir abusos:

```python
width    = max(160, min(width, 1600))
height   = max(100, min(height, 1000))
max_iter = max(50,  min(max_iter, 2000))
samples  = max(1,   min(samples, 12))
chunk_size = max(4, min(chunk_size, 128))
```

### 2.6 Gestión del ciclo de vida de un trabajo

El flujo completo de un render job es:

1. **POST /api/jobs** → Se crea el job con UUID, se persiste en SQLite (`running`), se lanza `threading.Thread(daemon=True)`.
2. **run_render_job()** → Se dividen chunks, se ejecuta `ProcessPoolExecutor`, se actualiza `progress` en cada chunk completado.
3. **GET /api/jobs/<id>** (polling) → El frontend consulta cada 300ms el estado y progreso.
4. **Completado** → Se actualiza a `done`, se guardan `duration_ms` y `pixels_per_second` en SQLite.
5. **GET /api/jobs/<id>?include_result=1** → El frontend descarga el array de píxeles y lo pinta en Canvas.

### 2.7 Frontend v2: dashboard interactivo

El frontend se organiza en **2 pestañas**:

| Pestaña        | Contenido                                                          |
|----------------|--------------------------------------------------------------------|
| **Renderizar** | Formulario de parámetros, botones, progreso, KPIs, stats y canvas  |
| **Historial**  | Búsqueda en vivo, tabla histórica con badges, export/import/limpiar |

**6 KPIs globales** (consultados vía `/api/stats`):

| KPI              | Color   | Descripción                              |
|------------------|---------|------------------------------------------|
| Total trabajos   | Violeta | Número total de render jobs              |
| Completados      | Verde   | Jobs con estado `done`                   |
| Fallidos         | Rojo    | Jobs con estado `failed`                 |
| Media duración   | Ámbar   | Promedio de `duration_ms`                |
| Media px/s       | Cyan    | Promedio de `pixels_per_second`          |
| Total píxeles    | Azul    | Suma de píxeles renderizados             |

**4 stats inline** (por render):

| Stat      | Descripción                  |
|-----------|------------------------------|
| Modo      | multicore / single           |
| Workers   | Número de procesos usados    |
| Duración  | Tiempo real en ms            |
| Px/s      | Velocidad de renderizado     |

**14 mejoras v2:**

| #  | Mejora                 | Implementación                                     |
|----|------------------------|----------------------------------------------------|
| 1  | Dark mode              | Toggle + `data-theme` + `localStorage`             |
| 2  | Pestañas               | `data-tab` con toggle de clases                    |
| 3  | Toasts                 | 4 tonos con animación slideUp + fadeOut             |
| 4  | Confirm overlay        | Promise-based con `backdrop-filter: blur(4px)`     |
| 5  | 6 KPIs semánticos      | Bordes laterales coloreados + fetch `/api/stats`   |
| 6  | Status dot             | Heartbeat cada 5s con clase `online`/`offline`     |
| 7  | Badges modo/estado     | Pills coloreadas multicore/single + done/failed    |
| 8  | Export JSON            | Blob + `URL.createObjectURL` + descarga automática |
| 9  | Import JSON            | FileReader + confirm + carga en tabla              |
| 10 | Búsqueda en vivo       | `Array.filter` sobre caché de historial            |
| 11 | Limpiar historial      | nousConfirm + reset de caché local                 |
| 12 | Responsive             | 3 breakpoints: 1100px (tablet), 700px (móvil)     |
| 13 | Empty states           | Mensajes centrados cuando las tablas están vacías  |
| 14 | Auto-refresh           | `setInterval(loadAll, 8000)`                       |

### 2.8 Paleta de color fractal

La conversión de iteraciones de escape a color RGB se realiza mediante una paleta polinómica:

```javascript
function palette(iter, maxIter) {
  if (iter >= maxIter) return [0, 0, 0];   // Interior → negro
  const t = iter / maxIter;
  const r = Math.floor(9 * (1 - t) * t * t * t * 255);
  const g = Math.floor(15 * (1 - t) * (1 - t) * t * t * 255);
  const b = Math.floor(8.5 * (1 - t) * (1 - t) * (1 - t) * t * 255);
  return [r, g, b];
}
```

Esta fórmula genera una paleta que transiciona suavemente de azules oscuros (escape rápido) a amarillos y blancos (escape lento), con el interior del conjunto en negro puro. Los coeficientes 9, 15 y 8.5 están calibrados para producir una distribución cromática visualmente atractiva.

---

## 3. Aplicación práctica

### 3.1 Escenario de uso: benchmark de rendimiento

El caso de uso principal es la comparación de rendimiento entre procesamiento secuencial y paralelo para la misma imagen.

#### Paso 1: Arranque del sistema

```bash
python app.py
```

Se inicia el servidor Flask en `http://127.0.0.1:5055` y se crea la base de datos SQLite si no existe.

#### Paso 2: Renderizado simple

Desde la pestaña "Renderizar", el usuario configura:

- **Ancho:** 900 px · **Alto:** 540 px
- **Iteraciones máx:** 700
- **Samples:** 3 (Monte Carlo)
- **Chunk size:** 16 filas
- **Modo:** Multicore

Al pulsar "🚀 Renderizar":

1. Se envía `POST /api/jobs` con los parámetros.
2. El servidor crea el job, lo persiste en SQLite y lanza un hilo daemon.
3. `ProcessPoolExecutor` divide la imagen en ~34 chunks de 16 filas.
4. Los workers procesan en paralelo, actualizando el progreso.
5. El frontend consulta el progreso cada 300ms y actualiza la barra.
6. Al completar, se descarga el array de píxeles y se pinta en el Canvas.
7. Los KPIs y las stats inline se actualizan.

#### Paso 3: Benchmark automático

Al pulsar "⚡ Benchmark":

1. Se ejecuta primero un render en modo **single** (1 worker).
2. Al completar, se ejecuta el mismo render en modo **multicore** (N workers).
3. Se calcula el **speedup** = duración_single / duración_multicore.
4. Se muestra el resultado en la barra de estado y como toast.

Ejemplo de resultado en un procesador de 10 cores:

```
Benchmark · Speedup ×4.87
```

#### Paso 4: Análisis del historial

En la pestaña "Historial", el usuario puede:

- **Buscar** por ID, modo, resolución o estado.
- **Exportar** todo el historial como JSON para análisis externo.
- **Importar** un historial previamente exportado.
- **Comparar** duraciones entre modos single y multicore.

Cada fila muestra **badges semánticos**: violeta para multicore, ámbar para single, verde para completado, rojo para fallido.

### 3.2 Diagrama de flujo del renderizado

```
  Usuario configura parámetros
              │
              ▼
     POST /api/jobs (JSON)
              │
              ▼
    Flask crea job + SQLite INSERT
              │
              ▼
    threading.Thread(daemon=True)
              │
              ▼
    Dividir imagen en chunks
              │
              ▼
   ┌──────────────────────────┐
   │ ProcessPoolExecutor      │
   │                          │
   │  ┌─────┐ ┌─────┐ ┌─────┐│
   │  │ W1  │ │ W2  │ │ Wn  ││
   │  │chunk│ │chunk│ │chunk││
   │  └──┬──┘ └──┬──┘ └──┬──┘│
   │     │       │       │   │
   │     ▼       ▼       ▼   │
   │   as_completed(futures)  │
   └──────────┬───────────────┘
              │
              ▼
    Ensamblar buffer + SQLite UPDATE
              │
              ▼
    GET /api/jobs/<id>?include_result=1
              │
              ▼
    Canvas.putImageData(pixels)
```

### 3.3 Parámetros y su impacto

| Parámetro    | Rango       | Impacto en rendimiento                                |
|--------------|-------------|-------------------------------------------------------|
| `width`      | 160–1600    | Lineal: duplicar ancho ≈ duplicar tiempo              |
| `height`     | 100–1000    | Lineal: duplicar alto ≈ duplicar tiempo               |
| `max_iter`   | 50–2000     | Afecta solo a píxeles del borde (carga variable)      |
| `samples`    | 1–12        | Lineal: cada sample multiplica el cálculo por píxel   |
| `chunk_size` | 4–128       | Menor = más chunks = mejor balance, pero más overhead |
| `mode`       | multi/single| Speedup proporcional al número de cores               |

La carga total en operaciones es aproximadamente:

$$\text{Ops} \approx W \times H \times S \times \overline{I}$$

Donde $W$ es ancho, $H$ alto, $S$ samples y $\overline{I}$ la media de iteraciones de escape (dependiente de `max_iter` y la región visible).

### 3.4 Exportación y backup

El botón 📦 genera un archivo JSON con todo el historial:

```json
[
  {
    "id": "a1b2c3d4e5f6",
    "created_at": "2026-02-17 10:30:00",
    "mode": "multicore",
    "width": 900,
    "height": 540,
    "max_iter": 700,
    "samples": 3,
    "workers": 10,
    "chunk_size": 16,
    "status": "done",
    "duration_ms": 2345.67,
    "pixels_per_second": 207123.45
  }
]
```

---

## 4. Conclusión breve

### 4.1 Objetivos alcanzados

El proyecto **Multicore Render Lab** cumple integralmente con los requisitos de la actividad:

1. **Procesamiento multinúcleo**: Se implementa `ProcessPoolExecutor` con N workers reales (procesos, no hilos), demostrando paralelización efectiva que esquiva el GIL de Python.
2. **División de trabajo**: La estrategia de chunking por franjas horizontales reparte la carga equitativamente entre procesos.
3. **Comparación de rendimiento**: El modo benchmark ejecuta secuencialmente single vs multicore y calcula el speedup real.
4. **Persistencia**: SQLite almacena todos los trabajos con métricas de rendimiento para análisis histórico.
5. **Interfaz web**: El dashboard con 14 mejoras v2 proporciona control completo, visualización en tiempo real y herramientas de análisis.

### 4.2 Competencias demostradas

| Competencia               | Evidencia                                                    |
|---------------------------|--------------------------------------------------------------|
| Programación multiproceso | `ProcessPoolExecutor` con N workers en procesos reales       |
| División de trabajo       | Chunking por franjas + ensamblado ordenado de resultados     |
| Sincronización            | `threading.Lock` + `as_completed()` + `futures`              |
| Comunicación IPC          | Serialización pickle automática entre procesos               |
| Persistencia de datos     | SQLite con tabla `render_jobs`, métricas y trazabilidad      |
| Desarrollo web full-stack | Flask REST API + SPA con JS vanilla + Canvas API             |
| Diseño UI/UX              | Dark mode, responsive, toasts, confirm, badges, KPIs         |

### 4.3 Ley de Amdahl

La **Ley de Amdahl** establece el límite teórico de mejora con paralelización:

$$\text{Speedup} = \frac{1}{(1 - P) + \frac{P}{N}}$$

Donde:

- **P** = Fracción paralelizable del código (Mandelbrot ≈ 0.95)
- **N** = Número de procesadores

Con **P = 0.95** y **N = 10**:

$$\text{Speedup}_{\text{máximo}} = \frac{1}{0.05 + \frac{0.95}{10}} = \frac{1}{0.05 + 0.095} = \frac{1}{0.145} = 6.90\text{x}$$

En la práctica, el overhead de creación de procesos, serialización pickle, comunicación IPC y ensamblado de resultados reduce el speedup real. Un resultado de **×4.87** en 10 cores representa un **70.6% de eficiencia** respecto al máximo teórico, lo cual es un resultado excelente para Python.

### 4.4 Aplicaciones en el mundo real

El procesamiento paralelo demostrado aquí es fundamental en:

- **Renderizado 3D**: Pixar, ILM usan clusters de miles de cores para Monte Carlo path tracing.
- **Simulación científica**: Dinámica de fluidos, física de partículas, modelos climáticos.
- **Machine Learning**: Entrenamiento distribuido de redes neuronales.
- **Procesamiento de imagen/video**: Codificación H.265, filtros en tiempo real.
- **Análisis financiero**: Monte Carlo para pricing de opciones y evaluación de riesgo.
- **Bioinformática**: Análisis genómico paralelo con miles de secuencias simultáneas.

### 4.5 Posibles extensiones futuras

- **GPU acceleration**: Migrar el cálculo a CUDA/OpenCL para órdenes de magnitud de mejora.
- **Distribución en red**: Cluster con Celery/RabbitMQ para renderizado distribuido.
- **Renderizado progresivo**: Preview de baja calidad que mejora gradualmente.
- **Zoom interactivo**: Click en el canvas para navegar el conjunto de Mandelbrot.
- **Julia sets**: Extensión del motor para visualizar conjuntos de Julia asociados.
- **Adaptive sampling**: Más samples en bordes complejos, menos en regiones uniformes.
- **Historial con imágenes**: Almacenar miniaturas PNG en SQLite para pre-visualización.

### 4.6 Valoración personal

Este proyecto ha sido especialmente enriquecedor por la necesidad de coordinar procesos reales (no hilos) dentro de un servidor web. La convivencia de Flask con `ProcessPoolExecutor` lanzado desde un `threading.Thread` daemon, junto con la comunicación bidireccional mediante futures y la necesidad de locks para proteger el estado compartido, refleja patrones que se encuentran en sistemas de procesamiento en producción reales. La implementación del benchmark como flujo guiado desde la UI permite cuantificar de forma tangible el beneficio del paralelismo, conectando la teoría (Ley de Amdahl) con mediciones reales de speedup.

---

## Anexo: Tabla resumen de mejoras v2

| #  | Mejora                 | Archivo                 | Técnica                                |
|----|------------------------|-------------------------|----------------------------------------|
| 1  | Dark mode              | styles.css + app.js     | `[data-theme="dark"]` + `localStorage` |
| 2  | Pestañas               | index.html + app.js     | `data-tab` con toggle de clases        |
| 3  | Toasts                 | styles.css + app.js     | Animaciones CSS + DOM dinámico         |
| 4  | Confirm overlay        | index.html + app.js     | Promise + `backdrop-filter`            |
| 5  | 6 KPIs semánticos      | index.html + styles.css | `border-left-color` por categoría      |
| 6  | Status dot             | styles.css + app.js     | `fetch('/api/stats')` + clase toggle   |
| 7  | Badges modo/estado     | styles.css + app.js     | `.badge-multicore` + `.badge-done`     |
| 8  | Export JSON            | app.js                  | `Blob` + `URL.createObjectURL`         |
| 9  | Import JSON            | app.js                  | `FileReader` + `nousConfirm`           |
| 10 | Búsqueda en vivo       | app.js                  | `Array.filter` sobre caché             |
| 11 | Limpiar historial      | app.js                  | `nousConfirm` + reset caché            |
| 12 | Responsive             | styles.css              | `@media` 1100px + 700px                |
| 13 | Empty states           | app.js + styles.css     | `.empty-state` centrado                |
| 14 | Auto-refresh           | app.js                  | `setInterval(loadAll, 8000)`           |
