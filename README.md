<div align="center">

# 🔥 Multicore Render Lab

**Renderizado Monte Carlo multinúcleo con dashboard en tiempo real**

![Python](https://img.shields.io/badge/Python-3.12+-blue?logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-3.x-black?logo=flask)
![SQLite](https://img.shields.io/badge/SQLite-3-07405E?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/Licencia-MIT-green)

[Características](#-características) · [Arquitectura](#-arquitectura) · [Inicio rápido](#-inicio-rápido) · [API](#-api-rest)

</div>

---

## 📋 Descripción

**Multicore Render Lab** es una plataforma de renderizado de fractales Mandelbrot con muestreo Monte Carlo que demuestra el procesamiento paralelo multinúcleo. Incluye backend Flask con `ProcessPoolExecutor`, persistencia en SQLite, benchmark single vs multicore y un dashboard web interactivo con 14 mejoras v2.

---

## ✨ Características

| #  | Funcionalidad                        | Detalle                                           |
|----|--------------------------------------|---------------------------------------------------|
| 1  | Renderizado Mandelbrot Monte Carlo   | Muestreo jittered con N samples por píxel         |
| 2  | ProcessPoolExecutor                  | Distribución de chunks en N workers               |
| 3  | Modo benchmark                       | Single-core vs multicore con cálculo de speedup   |
| 4  | Cola de trabajos                     | Ejecución asíncrona con polling de progreso        |
| 5  | Persistencia SQLite                  | Histórico completo de render jobs con métricas     |
| 6  | API REST completa                    | Crear, consultar, historial, estadísticas          |
| 7  | Canvas HTML5                         | Visualización de fractales con paleta cromática     |
| 8  | Dark mode                            | Toggle con persistencia en localStorage            |
| 9  | Sistema de toasts                    | Notificaciones con 4 tonos semánticos              |
| 10 | Exportar / Importar JSON             | Backup del historial de trabajos                   |
| 11 | KPIs en tiempo real                  | 6 indicadores con bordes semánticos                |
| 12 | Búsqueda en vivo                     | Filtro instantáneo sobre el historial              |
| 13 | Badges semánticos                    | Estado (done/running/failed) + modo (multi/single) |
| 14 | Responsive                           | 3 breakpoints: desktop, tablet, móvil              |

---

## 🏗 Arquitectura

```
┌─────────────────┐
│  Web Browser     │
│  (Dashboard)     │
└────────┬─────────┘
         │ HTTP + Canvas
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

## 🚀 Inicio rápido

```bash
# Clonar e instalar
git clone https://github.com/luisrocedev/Multicore-Render-Lab.git
cd Multicore-Render-Lab
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Ejecutar
python app.py
```

Abrir **http://127.0.0.1:5055** en el navegador.

---

## 📡 API REST

| Endpoint                            | Método | Descripción                              |
|-------------------------------------|--------|------------------------------------------|
| `/api/jobs`                         | POST   | Crear trabajo de renderizado              |
| `/api/jobs/<id>`                    | GET    | Estado y progreso de un trabajo           |
| `/api/jobs/<id>?include_result=1`   | GET    | Estado + datos de píxeles del resultado   |
| `/api/history`                      | GET    | Últimos 30 trabajos desde SQLite          |
| `/api/stats`                        | GET    | KPIs agregados (total, medias, fallos)    |

### Ejemplo: crear trabajo

```bash
curl -X POST http://127.0.0.1:5055/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"width":800,"height":600,"max_iter":500,"samples":4,"chunk_size":16,"mode":"multicore"}'
```

---

## 📂 Estructura del proyecto

```
Multicore-Render-Lab/
├── app.py                  ← Backend Flask + ProcessPoolExecutor + SQLite
├── demo_simple.py          ← Lanzador rápido
├── requirements.txt        ← Dependencias
├── docs/
│   └── Actividad_Multinucleo_53945291X.md
├── static/
│   ├── app.js              ← Lógica frontend v2
│   └── styles.css          ← Diseño con design tokens + dark mode
└── templates/
    └── index.html          ← Dashboard SPA con tabs
```

---

## 🧪 Mejoras v2 (14 ítems)

| #  | Mejora                 | Archivo(s)           | Técnica                               |
|----|------------------------|----------------------|---------------------------------------|
| 1  | Dark mode              | CSS + JS             | `[data-theme="dark"]` + localStorage  |
| 2  | Pestañas               | HTML + JS            | `data-tab` con toggle de clases       |
| 3  | Toasts                 | CSS + JS             | 4 tonos + slideUp + fadeOut           |
| 4  | Confirm overlay        | HTML + JS            | Promise + backdrop-filter             |
| 5  | 6 KPIs semánticos      | HTML + CSS           | border-left coloreados                |
| 6  | Status dot             | CSS + JS             | Heartbeat /api/stats + pulse          |
| 7  | Badges modo/estado     | CSS + JS             | .badge-multicore, .badge-done         |
| 8  | Export JSON            | JS                   | Blob + URL.createObjectURL            |
| 9  | Import JSON            | JS                   | FileReader + nousConfirm              |
| 10 | Búsqueda en vivo       | JS                   | Array.filter sobre caché              |
| 11 | Limpiar historial      | JS                   | nousConfirm + reset caché             |
| 12 | Responsive             | CSS                  | @media 1100px + 700px                 |
| 13 | Empty states           | CSS + JS             | .empty-state centrado                 |
| 14 | Auto-refresh           | JS                   | setInterval 8s                        |

---

## 🛠 Stack tecnológico

| Capa     | Tecnología                                                |
|----------|-----------------------------------------------------------|
| Backend  | Python 3.12 · Flask 3.x                                   |
| Paralelo | `concurrent.futures.ProcessPoolExecutor`                   |
| BD       | SQLite 3 (tabla `render_jobs`)                             |
| Frontend | HTML5 · CSS3 (custom properties) · JavaScript ES2022      |
| Canvas   | Canvas API 2D con `putImageData`                           |

---

## 👤 Autor

**Luis Rodríguez Cedeño** — DAM2 · Programación de Servicios y Procesos · 2026
