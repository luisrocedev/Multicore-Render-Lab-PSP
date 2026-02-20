/* ═══════ DOM CACHE ═══════ */
const $ = (id) => document.getElementById(id);
const el = {
  width:        $('width'),
  height:       $('height'),
  maxIter:      $('maxIter'),
  samples:      $('samples'),
  chunkSize:    $('chunkSize'),
  mode:         $('mode'),
  runBtn:       $('runBtn'),
  benchBtn:     $('benchBtn'),
  status:       $('status'),
  progressBar:  $('progressBar'),
  renderStats:  $('renderStats'),
  kpiGrid:      $('kpiGrid'),
  canvas:       $('canvas'),
  historyBody:  $('historyBody'),
  historyBadge: $('historyBadge'),
  searchHistory:$('searchHistory'),
  btnExport:    $('btnExport'),
  btnImport:    $('btnImport'),
  fileImport:   $('fileImport'),
  btnDark:      $('btnDark'),
  btnClearHistory: $('btnClearHistory'),
  statusDot:    $('statusDot'),
  confirmOverlay: $('confirmOverlay'),
  confirmTitle: $('confirmTitle'),
  confirmMsg:   $('confirmMsg'),
  confirmYes:   $('confirmYes'),
  confirmNo:    $('confirmNo'),
  toastContainer: $('toastContainer'),
};

const ctx = el.canvas.getContext('2d');
let polling = null;
let historyCache = [];

/* ═══════ DARK MODE ═══════ */
(function initDark() {
  if (localStorage.getItem('multicore-dark') === '1') {
    document.documentElement.setAttribute('data-theme', 'dark');
    el.btnDark.textContent = '☀️';
  }
})();

el.btnDark.addEventListener('click', () => {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  localStorage.setItem('multicore-dark', isDark ? '0' : '1');
  el.btnDark.textContent = isDark ? '🌙' : '☀️';
});

/* ═══════ TABS ═══════ */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.getAttribute('data-tab');
    const panel = document.getElementById('tab-' + target);
    if (panel) panel.classList.add('active');
  });
});

/* ═══════ TOASTS ═══════ */
function toast(msg, tone = 'info') {
  const div = document.createElement('div');
  div.className = `toast toast-${tone}`;
  div.textContent = msg;
  el.toastContainer.appendChild(div);
  setTimeout(() => { div.classList.add('fade-out'); }, 3000);
  setTimeout(() => { div.remove(); }, 3400);
}

/* ═══════ CONFIRM ═══════ */
function nousConfirm(title, msg) {
  return new Promise(resolve => {
    el.confirmTitle.textContent = title;
    el.confirmMsg.textContent = msg;
    el.confirmOverlay.classList.add('open');
    const yes = () => { cleanup(); resolve(true); };
    const no  = () => { cleanup(); resolve(false); };
    function cleanup() {
      el.confirmOverlay.classList.remove('open');
      el.confirmYes.removeEventListener('click', yes);
      el.confirmNo.removeEventListener('click', no);
    }
    el.confirmYes.addEventListener('click', yes);
    el.confirmNo.addEventListener('click', no);
  });
}

/* ═══════ STATUS DOT ═══════ */
async function checkStatus() {
  try {
    const res = await fetch('/api/stats');
    if (res.ok) { el.statusDot.classList.add('online'); return; }
  } catch { /* offline */ }
  el.statusDot.classList.remove('online');
}
checkStatus();
setInterval(checkStatus, 5000);

/* ═══════ HELPERS ═══════ */
function fmt(n)   { return n != null ? Number(n).toLocaleString('es-ES') : '—'; }
function fmtMs(ms){ return ms != null ? `${Number(ms).toLocaleString('es-ES')} ms` : '—'; }
function setStatus(text) { el.status.textContent = text; }
function setProgress(val) {
  el.progressBar.style.width = `${Math.max(0, Math.min(100, val * 100)).toFixed(1)}%`;
}

function modeBadge(mode) {
  const cls = mode === 'multicore' ? 'badge-multicore' : 'badge-single';
  const label = mode === 'multicore' ? 'MULTICORE' : 'SINGLE';
  return `<span class="badge ${cls}">${label}</span>`;
}

function statusBadge(st) {
  const map = { done: 'badge-done', running: 'badge-running', failed: 'badge-failed' };
  return `<span class="badge ${map[st] || 'badge-running'}">${(st || '').toUpperCase()}</span>`;
}

/* ═══════ PALETTE ═══════ */
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
    px[p] = r; px[p + 1] = g; px[p + 2] = b; px[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/* ═══════ RENDER STATS (inline) ═══════ */
function renderJobStats(data) {
  el.renderStats.innerHTML = `
    <div class="rs-box"><strong>${data.mode || '—'}</strong><span>Modo</span></div>
    <div class="rs-box"><strong>${data.workers || '—'}</strong><span>Workers</span></div>
    <div class="rs-box"><strong>${fmtMs(data.duration_ms)}</strong><span>Duración</span></div>
    <div class="rs-box"><strong>${fmt(Math.round(data.pixels_per_second || 0))}</strong><span>Px/segundo</span></div>
  `;
}

/* ═══════ KPIs (global stats) ═══════ */
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const s = await res.json();
    const kpis = el.kpiGrid.querySelectorAll('.kpi');
    kpis[0].querySelector('strong').textContent = fmt(s.total_jobs);
    kpis[1].querySelector('strong').textContent = fmt(s.done);
    kpis[2].querySelector('strong').textContent = fmt(s.failed);
    kpis[3].querySelector('strong').textContent = fmtMs(s.avg_duration_ms);
    kpis[4].querySelector('strong').textContent = fmt(Math.round(s.avg_pixels_per_second));
    kpis[5].querySelector('strong').textContent = fmt(s.total_pixels);
  } catch { /* silenciar */ }
}

/* ═══════ HISTORY ═══════ */
async function loadHistory() {
  try {
    const res = await fetch('/api/history');
    if (!res.ok) return;
    const data = await res.json();
    historyCache = data.items || [];
    el.historyBadge.textContent = historyCache.length;
    renderHistory(historyCache);
  } catch { /* silenciar */ }
}

function renderHistory(items) {
  if (!items.length) {
    el.historyBody.innerHTML =
      '<tr><td colspan="10" class="empty-state">Sin trabajos en el historial</td></tr>';
    return;
  }
  el.historyBody.innerHTML = items.map(it => `<tr>
    <td title="${it.id}">${it.id.substring(0, 8)}</td>
    <td>${it.created_at}</td>
    <td>${modeBadge(it.mode)}</td>
    <td>${it.width}×${it.height}</td>
    <td>${fmt(it.max_iter)}</td>
    <td>${it.samples}</td>
    <td>${it.workers}</td>
    <td>${fmtMs(it.duration_ms)}</td>
    <td>${fmt(Math.round(it.pixels_per_second || 0))}</td>
    <td>${statusBadge(it.status)}</td>
  </tr>`).join('');
}

/* ═══════ LIVE SEARCH ═══════ */
el.searchHistory.addEventListener('input', () => {
  const q = el.searchHistory.value.toLowerCase();
  if (!q) { renderHistory(historyCache); return; }
  const filtered = historyCache.filter(it => {
    const hay = `${it.id} ${it.mode} ${it.width}x${it.height} ${it.created_at} ${it.status}`.toLowerCase();
    return hay.includes(q);
  });
  renderHistory(filtered);
});

/* ═══════ API CALLS ═══════ */
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

/* ═══════ RENDER FLOW ═══════ */
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

async function runRender(modeOverride = null) {
  clearInterval(polling);
  setProgress(0);
  el.renderStats.innerHTML = '';

  const payload = getPayload(modeOverride);
  setStatus(`Lanzando render ${payload.mode}…`);

  const created = await createJob(payload);
  const jobId = created.job_id;
  toast(`Render iniciado (${payload.mode})`, 'info');

  return new Promise((resolve, reject) => {
    polling = setInterval(async () => {
      try {
        const data = await getJob(jobId, false);
        setProgress(data.progress || 0);
        setStatus(`${data.status} · ${(data.progress * 100).toFixed(1)}%`);
        renderJobStats(data);

        if (data.status === 'done') {
          clearInterval(polling);
          const done = await getJob(jobId, true);
          drawResult(done.width, done.height, done.max_iter, done.result || []);
          setStatus(`Completado en ${fmtMs(done.duration_ms)}`);
          renderJobStats(done);
          toast(`Render completado · ${fmtMs(done.duration_ms)}`, 'success');
          await loadHistory();
          await loadStats();
          resolve(done);
        }

        if (data.status === 'failed') {
          clearInterval(polling);
          setStatus('Trabajo fallido');
          toast('El render ha fallado', 'error');
          await loadHistory();
          await loadStats();
          reject(new Error('Job failed'));
        }
      } catch (err) {
        clearInterval(polling);
        reject(err);
      }
    }, 300);
  });
}

/* ═══════ BENCHMARK ═══════ */
async function runBenchmark() {
  el.runBtn.disabled  = true;
  el.benchBtn.disabled = true;
  try {
    toast('Benchmark: ejecutando single core…', 'info');
    setStatus('Benchmark: single core…');
    const single = await runRender('single');

    toast('Benchmark: ejecutando multicore…', 'info');
    setStatus('Benchmark: multicore…');
    const multi = await runRender('multicore');

    if (single.duration_ms && multi.duration_ms) {
      const speedup = (single.duration_ms / multi.duration_ms).toFixed(2);
      setStatus(`Benchmark · Speedup ×${speedup}`);
      toast(`Benchmark completado · Speedup ×${speedup}`, 'success');
    }
  } catch {
    toast('Error en el benchmark', 'error');
  } finally {
    el.runBtn.disabled  = false;
    el.benchBtn.disabled = false;
  }
}

/* ═══════ EXPORT / IMPORT ═══════ */
el.btnExport.addEventListener('click', () => {
  if (!historyCache.length) { toast('Sin datos para exportar', 'warning'); return; }
  const blob = new Blob([JSON.stringify(historyCache, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date().toISOString().slice(0, 10);
  a.download = `multicore_history_${d}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Historial exportado', 'success');
});

el.btnImport.addEventListener('click', () => el.fileImport.click());
el.fileImport.addEventListener('change', async () => {
  const file = el.fileImport.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error('Formato inválido');
    const ok = await nousConfirm('Importar historial', `¿Cargar ${data.length} registros del archivo?`);
    if (!ok) return;
    historyCache = data;
    el.historyBadge.textContent = historyCache.length;
    renderHistory(historyCache);
    toast(`Importados ${data.length} registros`, 'success');
  } catch {
    toast('Archivo JSON inválido', 'error');
  }
  el.fileImport.value = '';
});

/* ═══════ CLEAR HISTORY ═══════ */
el.btnClearHistory.addEventListener('click', async () => {
  if (!historyCache.length) { toast('El historial ya está vacío', 'warning'); return; }
  const ok = await nousConfirm('Limpiar historial', '¿Vaciar la vista del historial local?');
  if (!ok) return;
  historyCache = [];
  el.historyBadge.textContent = '0';
  renderHistory([]);
  toast('Historial limpiado', 'info');
});

/* ═══════ EVENT LISTENERS ═══════ */
el.runBtn.addEventListener('click', async () => {
  el.runBtn.disabled  = true;
  el.benchBtn.disabled = true;
  try { await runRender(); }
  catch { /* already handled */ }
  finally { el.runBtn.disabled = false; el.benchBtn.disabled = false; }
});

el.benchBtn.addEventListener('click', runBenchmark);

/* ═══════ AUTO-REFRESH ═══════ */
setInterval(() => { loadHistory(); loadStats(); }, 8000);

/* ═══════ INIT ═══════ */
loadHistory();
loadStats();
setStatus('Listo para renderizar');
