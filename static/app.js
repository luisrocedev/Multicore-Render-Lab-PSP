const el = {
  width: document.getElementById('width'),
  height: document.getElementById('height'),
  maxIter: document.getElementById('maxIter'),
  samples: document.getElementById('samples'),
  chunkSize: document.getElementById('chunkSize'),
  mode: document.getElementById('mode'),
  runBtn: document.getElementById('runBtn'),
  benchBtn: document.getElementById('benchBtn'),
  status: document.getElementById('status'),
  progressBar: document.getElementById('progressBar'),
  stats: document.getElementById('stats'),
  canvas: document.getElementById('canvas'),
  historyBody: document.getElementById('historyBody'),
};

const ctx = el.canvas.getContext('2d');
let polling = null;

function getPayload(modeOverride = null) {
  return {
    width: Number(el.width.value),
    height: Number(el.height.value),
    max_iter: Number(el.maxIter.value),
    samples: Number(el.samples.value),
    chunk_size: Number(el.chunkSize.value),
    mode: modeOverride || el.mode.value,
  };
}

function setStatus(text) {
  el.status.textContent = text;
}

function setProgress(value) {
  el.progressBar.style.width = `${Math.max(0, Math.min(100, value * 100)).toFixed(1)}%`;
}

function renderStats(data) {
  const ms = data.duration_ms ? `${data.duration_ms} ms` : '—';
  const pps = data.pixels_per_second ? `${Math.round(data.pixels_per_second).toLocaleString('es-ES')}` : '—';
  el.stats.innerHTML = `
    <article class="kpi"><strong>${data.mode}</strong><span>Modo</span></article>
    <article class="kpi"><strong>${data.workers}</strong><span>Workers</span></article>
    <article class="kpi"><strong>${ms}</strong><span>Duración</span></article>
    <article class="kpi"><strong>${pps}</strong><span>Pixels/segundo</span></article>
  `;
}

function palette(iter, maxIter) {
  if (iter >= maxIter) return [0, 0, 0];
  const t = iter / maxIter;
  const r = Math.floor(9 * (1 - t) * t * t * t * 255);
  const g = Math.floor(15 * (1 - t) * (1 - t) * t * t * 255);
  const b = Math.floor(8.5 * (1 - t) * (1 - t) * (1 - t) * t * 255);
  return [r, g, b];
}

function drawResult(width, height, maxIter, result) {
  el.canvas.width = width;
  el.canvas.height = height;
  const img = ctx.createImageData(width, height);
  const px = img.data;

  for (let i = 0; i < result.length; i++) {
    const [r, g, b] = palette(result[i], maxIter);
    const p = i * 4;
    px[p] = r;
    px[p + 1] = g;
    px[p + 2] = b;
    px[p + 3] = 255;
  }

  ctx.putImageData(img, 0, 0);
}

async function createJob(payload) {
  const res = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('No se pudo crear el trabajo');
  return res.json();
}

async function getJob(jobId, includeResult = false) {
  const res = await fetch(`/api/jobs/${jobId}?include_result=${includeResult ? '1' : '0'}`);
  if (!res.ok) throw new Error('No se pudo leer el trabajo');
  return res.json();
}

async function loadHistory() {
  const res = await fetch('/api/history');
  if (!res.ok) return;
  const data = await res.json();
  const items = data.items || [];

  el.historyBody.innerHTML = items.map((it) => `
    <tr>
      <td>${it.id}</td>
      <td>${it.created_at}</td>
      <td>${it.mode}</td>
      <td>${it.width}×${it.height}</td>
      <td>${it.max_iter}</td>
      <td>${it.samples}</td>
      <td>${it.workers}</td>
      <td>${it.duration_ms ? `${it.duration_ms} ms` : '—'}</td>
      <td>${it.pixels_per_second ? Math.round(it.pixels_per_second).toLocaleString('es-ES') : '—'}</td>
      <td>${it.status}</td>
    </tr>
  `).join('');
}

async function runRender(modeOverride = null) {
  clearInterval(polling);
  setProgress(0);

  const payload = getPayload(modeOverride);
  setStatus(`Lanzando render ${payload.mode}...`);

  const created = await createJob(payload);
  const jobId = created.job_id;

  return new Promise((resolve, reject) => {
    polling = setInterval(async () => {
      try {
        const data = await getJob(jobId, false);
        setProgress(data.progress || 0);
        setStatus(`Estado: ${data.status} · ${(data.progress * 100).toFixed(1)}%`);
        renderStats(data);

        if (data.status === 'done') {
          clearInterval(polling);
          const done = await getJob(jobId, true);
          drawResult(done.width, done.height, done.max_iter, done.result || []);
          setStatus(`Completado en ${done.duration_ms} ms`);
          await loadHistory();
          resolve(done);
        }

        if (data.status === 'failed') {
          clearInterval(polling);
          setStatus('El trabajo ha fallado');
          reject(new Error('Job failed'));
        }
      } catch (err) {
        clearInterval(polling);
        reject(err);
      }
    }, 250);
  });
}

async function runBenchmark() {
  el.runBtn.disabled = true;
  el.benchBtn.disabled = true;

  try {
    setStatus('Benchmark: ejecutando single core...');
    const single = await runRender('single');

    setStatus('Benchmark: ejecutando multicore...');
    const multi = await runRender('multicore');

    if (single.duration_ms && multi.duration_ms) {
      const speedup = (single.duration_ms / multi.duration_ms).toFixed(2);
      setStatus(`Benchmark completado · Speedup x${speedup}`);
    }
  } finally {
    el.runBtn.disabled = false;
    el.benchBtn.disabled = false;
  }
}

el.runBtn.addEventListener('click', async () => {
  el.runBtn.disabled = true;
  el.benchBtn.disabled = true;
  try {
    await runRender();
  } finally {
    el.runBtn.disabled = false;
    el.benchBtn.disabled = false;
  }
});

el.benchBtn.addEventListener('click', runBenchmark);

loadHistory();
setStatus('Configurado. Pulsa Renderizar para comenzar.');
