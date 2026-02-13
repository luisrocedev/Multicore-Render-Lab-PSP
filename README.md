# Multicore Render Lab (PSP · DAM2)

Proyecto final de **programación multinúcleo** basado en el enfoque Monte Carlo trabajado en clase, evolucionado a una aplicación completa cliente-servidor.

## Mejoras funcionales de calado

- Planificador de trabajos con cola en backend.
- Ejecución paralela real con `ProcessPoolExecutor` usando todos los núcleos disponibles.
- Modo comparativo `single` vs `multicore` para medir speedup.
- Render de fractal Monte Carlo por chunks para repartir carga entre procesos.
- Persistencia en **SQLite** de los trabajos ejecutados (histórico, métricas y estado).
- API REST para crear trabajos, consultar progreso y recuperar resultados.

## Mejoras visuales

- Interfaz moderna tipo panel profesional con KPIs, barra de progreso y tabla histórica.
- Lienzo de render integrado con paleta de color fractal.
- Flujo de benchmark guiado desde UI.

## Estructura

- `app.py` → backend Flask + multiprocessing + SQLite
- `templates/index.html` → interfaz principal
- `static/app.js` → lógica cliente (polling, benchmark, render)
- `static/styles.css` → diseño visual
- `requirements.txt` → dependencias

## Ejecución

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Después abre: `http://127.0.0.1:5055`
