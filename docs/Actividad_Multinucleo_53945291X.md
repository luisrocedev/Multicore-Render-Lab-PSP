# Actividad final PSP · Multinúcleo

**Alumno:** 53945291X  
**Curso:** DAM2 · Programación de servicios y procesos  
**Unidad:** 301-Actividades final de unidad - Segundo trimestre  
**Proyecto:** 001-Multinucleo

## Descripción

Se desarrolla un prototipo avanzado a partir del trabajo de clase de render Monte Carlo, ampliándolo a una arquitectura de proyecto completa con backend de servicios, ejecución paralela multinúcleo, persistencia en base de datos y panel visual de control.

## Cambios funcionales relevantes

1. Migración de script aislado a aplicación cliente-servidor.
2. API REST de control de trabajos (`/api/jobs`, `/api/history`).
3. Procesamiento paralelo con `ProcessPoolExecutor` y reparto por chunks.
4. Modo comparativo single-core y multicore para medir rendimiento real.
5. Persistencia de ejecuciones en SQLite con métricas de rendimiento.
6. Render Monte Carlo parametrizable (resolución, iteraciones, samples, chunk size).

## Cambios visuales relevantes

1. Rediseño completo de la interfaz tipo dashboard técnico.
2. Barra de progreso en vivo.
3. KPIs de ejecución (duración, workers, pixels/segundo, modo).
4. Tabla histórica de trabajos persistidos.

## Justificación de cumplimiento

- Se demuestra uso de procesamiento multinúcleo en una carga computacional real.
- Se implementan cambios profundos de arquitectura y no solo estéticos.
- El sistema permite evaluar rendimiento paralelo de forma objetiva mediante benchmark.
- Se integra persistencia de datos para trazabilidad de ejecuciones.
