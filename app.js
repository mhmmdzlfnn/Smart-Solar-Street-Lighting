'use strict';
async function fetchData() {
  // ---- MODE PREVIEW: data dummy dari dummy-data.js.
  //      Hapus baris di bawah saat menghubungkan ke perangkat asli. ----
  return Dummy.tick();
}

async function sendControl(cmd) {
  // cmd salah satu dari:
  //   { action: 'setMode',       mode: 'auto' | 'manual' }
  //   { action: 'setLamp',       on: true | false }        (mode manual)
  //   { action: 'setBrightness', value: 0..100 }           (mode manual)

  // ---- MODE PREVIEW: terapkan ke simulator. Hapus saat asli. ----
  Dummy.applyControl(cmd);

  /* ---- CONTOH: kirim ke ESP32 ----
  const res = await fetch('http://192.168.1.50/api/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  */
}

/* ============================================================
  UTILITAS
   ============================================================ */
const $ = id => document.getElementById(id);
const el = {
  topbar: $('topbar'),
  netBadge: $('netBadge'), netText: $('netText'), lastUpdate: $('lastUpdate'),
  lampCard: $('lampCard'), lampState: $('lampState'), lampPct: $('lampPct'),
  lampBar: $('lampBar'), chipControl: $('chipControl'),
  ldrRaw: $('ldrRaw'), chipLdr: $('chipLdr'), sysMode: $('sysMode'),
  pirState: $('pirState'), pirLast: $('pirLast'), pirAgo: $('pirAgo'),
  battCard: $('battCard'), battV: $('battV'), chipBatt: $('chipBatt'),
  chartWrap: $('chartWrap'), tooltip: $('tooltip'), chartNote: $('chartNote'),
  logList: $('logList'),
  eDim: $('eDim'), eBright: $('eBright'), eOff: $('eOff'), eSave: $('eSave'), eNote: $('eNote'),
  controlCard: $('controlCard'), banner: $('banner'),
  btnAuto: $('btnAuto'), btnManual: $('btnManual'),
  btnLamp: $('btnLamp'), slider: $('slider'), sliderVal: $('sliderVal'),
  manualCtl: $('manualCtl')
};
const C = {
  amber: '#f2b23e', cyan: '#4db8e8', green: '#3ecf7a',
  red: '#ef5350', muted: '#8ba0b0', grid: 'rgba(255,255,255,.06)'
};
const MONO = 'ui-monospace, Consolas, "Courier New", monospace';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const toMs = v => typeof v === 'number' ? v : Date.parse(v);
const fmtClock = t => new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtHM = t => new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
const fmtInt = n => Number(n).toLocaleString('id-ID');
const fmtDec2 = v => Number(v).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDur(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return h + ' jam ' + m + ' mnt';
  if (m) return m + ' mnt ' + s + ' dtk';
  return s + ' dtk';
}
function fmtAgo(ms) {
  const d = Date.now() - ms;
  if (d < 10000) return 'baru saja';
  if (d < 60000) return Math.floor(d / 1000) + ' dtk lalu';
  if (d < 3600000) return Math.floor(d / 60000) + ' mnt lalu';
  return Math.floor(d / 3600000) + ' jam lalu';
}

/* ============================================================
  RENDER UI
   ============================================================ */
let lastData = null;      // snapshot terakhir yang sukses diambil
let lastGoodAt = 0;       // waktu fetch terakhir yang berhasil
let lastLogKey = '';

function setBadge(online) {
  el.netBadge.className = 'badge ' + (online ? 'online' : 'offline');
  el.netText.textContent = online ? 'ESP32 Online' : 'ESP32 Offline';
  // garis status di tepi atas halaman + warna jam mengikuti status koneksi
  el.topbar.classList.toggle('offline', !online);
}

function render(data, online) {
  setBadge(online);
  el.lastUpdate.textContent = lastGoodAt ? fmtClock(lastGoodAt) + (online ? '' : ' (data terakhir)') : '—';

  if (!data) return;   // belum pernah ada data sama sekali

  const b = data.lamp.brightness;
  const manual = data.mode === 'manual';

  // --- Kartu lampu ---
  const stateWord = b === 0 ? 'MATI' : (b >= 100 ? 'TERANG' : 'REDUP');
  const stateCls = b === 0 ? 'st-off' : (b >= 100 ? 'st-bright' : 'st-dim');
  el.lampCard.className = 'card lamp-card ' + stateCls;
  el.lampState.textContent = stateWord;
  el.lampPct.textContent = b;
  el.lampBar.style.width = b + '%';
  el.chipControl.textContent = 'Kontrol: ' + (manual ? 'Manual' : 'Otomatis');
  el.chipControl.className = 'chip ' + (manual ? 'warn' : 'ok');

  // --- LDR + mode sistem ---
  const raw = data.ldr.raw;
  const terang = raw >= CONFIG.LDR_DARK_THRESHOLD;
  el.ldrRaw.textContent = fmtInt(raw);
  el.chipLdr.textContent = terang ? 'Terang' : 'Gelap';
  el.chipLdr.className = 'chip ' + (terang ? 'ok' : 'neutral');
  el.sysMode.textContent = terang ? 'Siang' : 'Malam';

  // --- PIR ---
  el.pirState.textContent = data.pir.motion ? 'Ada Gerakan' : 'Sepi';
  el.pirState.className = 'big-value txt ' + (data.pir.motion ? 'warn' : 'ok');
  if (data.pir.lastMotion) {
    const t = toMs(data.pir.lastMotion);
    if (!isNaN(t)) {
      el.pirLast.textContent = fmtClock(t);
      el.pirAgo.textContent = '(' + fmtAgo(t) + ')';
    }
  } else {
    el.pirLast.textContent = '—';
    el.pirAgo.innerHTML = '&nbsp;';
  }

  // --- Baterai ---
  const v = data.battery.voltage;
  const bLabel = v <= CONFIG.BATT_LOW_V ? 'Rendah' : (v >= CONFIG.BATT_CHARGE_V ? 'Mengisi' : 'Normal');
  el.battV.textContent = fmtDec2(v);
  el.chipBatt.textContent = bLabel;
  el.chipBatt.className = 'chip ' + (bLabel === 'Rendah' ? 'danger' : 'ok');
  el.battCard.classList.toggle('alert', bLabel === 'Rendah');

  // --- Panel kontrol: aktif hanya saat mode manual ---
  el.btnAuto.classList.toggle('active', !manual);
  el.btnManual.classList.toggle('active', manual);
  el.btnLamp.disabled = !manual;
  el.slider.disabled = !manual;
  el.manualCtl.classList.toggle('disabled', !manual);
  el.banner.classList.toggle('hidden', !manual);
  el.controlCard.classList.toggle('manual-active', manual);
  el.btnLamp.textContent = (data.control && data.control.manualOn) ? 'Matikan' : 'Nyalakan';
  if (document.activeElement !== el.slider && !sliderPending) {
    const lvl = (manual && data.control) ? data.control.manualLevel : b;
    el.slider.value = lvl;
    el.sliderVal.textContent = lvl + '%';
  }

  // --- Grafik, log, energi ---
  drawChart();
  renderLog(data.events || []);
  renderEnergy(data.energy);
}

function renderLog(events) {
  const key = events.length + ':' + (events.length ? events[0].t : 0);
  if (key === lastLogKey) return;
  lastLogKey = key;
  el.logList.innerHTML = events.length
    ? events.map(e => '<li class="t-' + esc(e.type) + '"><time>' + fmtClock(toMs(e.t)) +
        '</time><span>' + esc(e.msg) + '</span></li>').join('')
    : '<li><span class="muted">Belum ada kejadian tercatat.</span></li>';
}

function renderEnergy(e) {
  if (!e) return;
  const nightSec = (e.offSec || 0) + (e.dimSec || 0) + (e.brightSec || 0);
  el.eDim.textContent = fmtDur(e.dimSec || 0);
  el.eBright.textContent = fmtDur(e.brightSec || 0);
  el.eOff.textContent = fmtDur(e.offSec || 0);
  if (nightSec > 0) {
    const saving = clamp(1 - (e.pctSec || 0) / (nightSec * 100), 0, 1);
    el.eSave.textContent = Math.round(saving * 100) + '%';
    const baseWh = nightSec / 3600 * CONFIG.LAMP_WATTS;
    el.eNote.textContent = 'Estimasi energi malam ini: menyala 100% terus \u2248 ' + fmtDec2(baseWh) +
      ' Wh, pemakaian nyata \u2248 ' + fmtDec2(baseWh * (1 - saving)) +
      ' Wh (asumsi LED ' + CONFIG.LAMP_WATTS + ' W pada 100%).';
  }
}

/* ============================================================
   GRAFIK RIWAYAT (canvas, tanpa library)
   Sumbu kiri: kecerahan 0-100% (amber) • sumbu kanan: LDR 0-4095 (biru)
   Pita hijau: gerakan terdeteksi
   ============================================================ */
let hoverX = null;   // posisi kursor dalam px relatif canvas

function drawChart() {
  const cv = el.chartWrap.querySelector('canvas');
  const ctx = cv.getContext('2d');
  const w = el.chartWrap.clientWidth, h = el.chartWrap.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const padL = 46, padR = 56, padT = 12, padB = 26;
  const pw = w - padL - padR, ph = h - padT - padB;
  if (pw < 40 || ph < 40) return;

  const t1 = Date.now();
  const t0 = t1 - CONFIG.CHART_WINDOW_MIN * 60000;
  const X  = t => padL + (t - t0) / (t1 - t0) * pw;
  const Yb = v => padT + (1 - v / 100) * ph;
  const Yl = v => padT + (1 - v / CONFIG.LDR_ADC_MAX) * ph;

  // grid horizontal + label kedua sumbu
  ctx.font = '10.5px ' + MONO;
  ctx.strokeStyle = C.grid;
  ctx.fillStyle = C.muted;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (i / 4) * ph;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + pw, y); ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(String(100 - i * 25), padL - 8, y + 3.5);
    ctx.textAlign = 'left';
    ctx.fillText(String(Math.round(CONFIG.LDR_ADC_MAX * (1 - i / 4))), w - padR + 8, y + 3.5);
  }

  // grid vertikal + label waktu (jarak label menyesuaikan lebar grafik)
  const maxTicks = Math.max(2, Math.floor(pw / 56));
  const stepMin = [1, 2, 5, 10, 15, 30, 60].find(s => CONFIG.CHART_WINDOW_MIN / s <= maxTicks) || 60;
  const step = stepMin * 60000;
  ctx.textAlign = 'center';
  for (let tt = Math.ceil(t0 / step) * step; tt <= t1; tt += step) {
    const x = X(tt);
    ctx.strokeStyle = C.grid;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ph); ctx.stroke();
    ctx.fillStyle = C.muted;
    ctx.fillText(fmtHM(tt), x, h - 8);
  }

  const hist = (lastData && lastData.history) || [];
  if (!hist.length) {
    ctx.fillStyle = C.muted;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Menunggu data…', padL + pw / 2, padT + ph / 2);
    return;
  }

  // batasi gambar ke area plot
  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT, pw, ph);
  ctx.clip();

  // pita gerakan (hijau transparan)
  ctx.fillStyle = 'rgba(62,207,122,.13)';
  let run = null;
  for (const s of hist) {
    if (s.motion && !run) run = { a: s.t };
    if (!s.motion && run) { ctx.fillRect(X(run.a), padT, X(s.t) - X(run.a), ph); run = null; }
  }
  if (run) ctx.fillRect(X(run.a), padT, X(t1) - X(run.a), ph);

  // garis LDR (sumbu kanan)
  ctx.strokeStyle = C.cyan;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  hist.forEach((s, i) => { const x = X(s.t), y = Yl(s.ldr); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();

  // area + garis kecerahan (sumbu kiri)
  ctx.beginPath();
  hist.forEach((s, i) => { const x = X(s.t), y = Yb(s.brightness); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.lineTo(X(hist[hist.length - 1].t), Yb(0));
  ctx.lineTo(X(hist[0].t), Yb(0));
  ctx.closePath();
  ctx.fillStyle = 'rgba(242,178,62,.12)';
  ctx.fill();
  ctx.beginPath();
  hist.forEach((s, i) => { const x = X(s.t), y = Yb(s.brightness); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = C.amber;
  ctx.lineWidth = 2;
  ctx.stroke();

  // garis silang hover
  if (hoverX !== null) {
    const tHover = t0 + (hoverX - padL) / pw * (t1 - t0);
    let best = hist[0], bd = Infinity;
    for (const s of hist) { const d = Math.abs(s.t - tHover); if (d < bd) { bd = d; best = s; } }
    const x = X(best.t);
    ctx.strokeStyle = 'rgba(255,255,255,.3)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ph); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.amber;
    ctx.beginPath(); ctx.arc(x, Yb(best.brightness), 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.cyan;
    ctx.beginPath(); ctx.arc(x, Yl(best.ldr), 3.5, 0, Math.PI * 2); ctx.fill();

    const terangHover = best.ldr >= CONFIG.LDR_DARK_THRESHOLD;
    el.tooltip.innerHTML =
      '<div class="tt-time">' + fmtClock(best.t) + '</div>' +
      '<div>LDR: <b>' + fmtInt(best.ldr) + '</b> <span class="muted">(' + (terangHover ? 'terang' : 'gelap') + ')</span></div>' +
      '<div>Kecerahan: <b>' + best.brightness + '%</b></div>' +
      '<div>Gerakan: <b>' + (best.motion ? 'Ada' : 'Sepi') + '</b></div>';
    el.tooltip.style.display = 'block';
    const tw = el.tooltip.offsetWidth;
    el.tooltip.style.left = clamp(x + 12, 4, w - tw - 4) + 'px';
    el.tooltip.style.top = '14px';
  } else {
    el.tooltip.style.display = 'none';
  }

  ctx.restore();
}

/* ============================================================
  KONTROL: interaksi tombol & slider
   ============================================================ */
el.btnAuto.addEventListener('click', async () => {
  await sendControl({ action: 'setMode', mode: 'auto' });
  poll();
});
el.btnManual.addEventListener('click', async () => {
  await sendControl({ action: 'setMode', mode: 'manual' });
  poll();
});
el.btnLamp.addEventListener('click', async () => {
  const on = !(lastData && lastData.control && lastData.control.manualOn);
  await sendControl({ action: 'setLamp', on });
  poll();
});
let sliderTimer = null;
let sliderPending = false;   // true selama ada nilai slider yang belum terkirim
el.slider.addEventListener('input', () => {
  const v = +el.slider.value;   // tangkap nilai saat event, bukan saat debounce selesai
  el.sliderVal.textContent = v + '%';
  sliderPending = true;
  clearTimeout(sliderTimer);
  sliderTimer = setTimeout(async () => {
    await sendControl({ action: 'setBrightness', value: v });
    sliderPending = false;
    poll();
  }, 180);
});

/* ============================================================
  LOOP POLLING + penanganan offline
   ============================================================ */
async function poll() {
  try {
    const data = await fetchData();
    lastData = data;
    lastGoodAt = Date.now();
    render(data, true);
  } catch (e) {
    // Perangkat tidak terjangkau: tampilkan data terakhir + badge merah
    render(lastData, false);
  }
}

/* ============================================================
  INISIALISASI
   ============================================================ */
Dummy.seed();
el.chartNote.textContent = CONFIG.CHART_WINDOW_MIN + ' menit terakhir';

const canvasEl = el.chartWrap.querySelector('canvas');
canvasEl.addEventListener('mousemove', e => {
  hoverX = e.clientX - canvasEl.getBoundingClientRect().left;
  drawChart();
});
canvasEl.addEventListener('mouseleave', () => { hoverX = null; drawChart(); });
canvasEl.addEventListener('touchstart', e => {
  hoverX = e.touches[0].clientX - canvasEl.getBoundingClientRect().left;
  drawChart();
}, { passive: true });
canvasEl.addEventListener('touchmove', e => {
  hoverX = e.touches[0].clientX - canvasEl.getBoundingClientRect().left;
  drawChart();
}, { passive: true });
canvasEl.addEventListener('touchend', () => { hoverX = null; drawChart(); });

if (window.ResizeObserver) new ResizeObserver(() => drawChart()).observe(el.chartWrap);
window.addEventListener('resize', drawChart);

poll();
setInterval(poll, CONFIG.POLL_MS);
