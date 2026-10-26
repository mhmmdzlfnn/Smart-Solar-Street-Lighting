'use strict';
const Dummy = {
  online: true,
  mode: 'auto',            // 'auto' | 'manual'
  manualOn: false,
  manualLevel: 30,
  ldrRaw: 780,
  motion: false,
  motionUntil: 0,
  lastMotion: null,
  brightness: CONFIG.DIM_LEVEL,
  batt: 12.42,
  lowFlagged: false,
  hist: [],
  events: [],
  energy: { offSec: 0, dimSec: 0, brightSec: 0, pctSec: 0 },

  pushEvent(msg, type = 'info') {
    this.events.unshift({ t: Date.now(), msg, type });
    if (this.events.length > 120) this.events.length = 120;
  },

  /* Membangun riwayat 35 menit terakhir: senja 27 menit lalu, lalu malam dengan beberapa ledakan gerakan. */
  seed() {
    const now = Date.now();
    const winMs = CONFIG.CHART_WINDOW_MIN * 60000;
    const t0 = now - winMs;
    const duskT = now - 27 * 60000;          // LDR melintasi ambang gelap
    const duskStart = duskT - 3 * 60000;     // cahaya mulai menurun

    const bursts = [
      { start: -23 * 60000 - 40000, dur: 14000 },
      { start: -17 * 60000 - 15000, dur:  9000 },
      { start: -11 * 60000 - 30000, dur: 18000 },
      { start:  -4 * 60000 - 10000, dur: 12000 }
    ].map(b => ({ s: now + b.start, e: now + b.start + b.dur }));

    for (let t = t0; t <= now; t += 1000) {
      let ldr;
      if (t < duskStart) {
        ldr = 3300 + Math.sin(t / 60000) * 120 + (Math.random() - 0.5) * 90;
      } else if (t < duskT) {
        const k = (t - duskStart) / (duskT - duskStart);
        ldr = 3300 - k * (3300 - 780) + (Math.random() - 0.5) * 120;
      } else {
        ldr = 780 + (Math.random() - 0.5) * 130;
      }
      ldr = Math.round(Math.max(60, Math.min(4060, ldr)));

      const night = t >= duskT;
      const motion = night && bursts.some(b => t >= b.s && t <= b.e);
      const brightness = !night ? 0 : (motion ? CONFIG.BRIGHT_LEVEL : CONFIG.DIM_LEVEL);

      if (night) {
        if (brightness >= 100) this.energy.brightSec++;
        else if (brightness > 0) this.energy.dimSec++;
        else this.energy.offSec++;
        this.energy.pctSec += brightness;
      }
      this.hist.push({ t, ldr, brightness, motion: motion ? 1 : 0 });
    }

    const last = bursts[bursts.length - 1];
    this.lastMotion = last.s;
    this.motionUntil = last.e;   // sudah lewat -> PIR sepi saat ini
    this.ldrRaw = this.hist[this.hist.length - 1].ldr;
    this.brightness = CONFIG.DIM_LEVEL;

    const todayAt = (h, m, s) => {
      const d = new Date(); d.setHours(h, m, s, 0);
      if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1);
      return d.getTime();
    };

    this.events = [
      { t: todayAt(5, 52, 3),   msg: 'Tegangan baterai rendah: 11,74 V — perlu perhatian', type: 'danger' },
      { t: todayAt(6, 14, 40),  msg: 'Baterai mulai mengisi (panel surya aktif): 12,05 V', type: 'ok' },
      { t: todayAt(6, 15, 2),   msg: 'Kondisi cahaya: terang — sistem masuk mode siang, lampu mati', type: 'info' },
      { t: todayAt(17, 58, 21), msg: 'Kondisi cahaya: gelap — sistem masuk mode malam', type: 'info' },
      { t: duskT + 1200,        msg: 'Lampu beralih ke redup (30%)', type: 'info' }
    ];
    for (const b of bursts) {
      this.events.push(
        { t: b.s, msg: 'Gerakan terdeteksi — lampu terang (100%)', type: 'warn' },
        { t: b.e + CONFIG.MOTION_TIMEOUT_S * 1000, msg: 'Tidak ada gerakan selama 15 detik — lampu kembali redup (30%)', type: 'info' }
      );
    }
    this.events.sort((a, b) => b.t - a.t);
  },

  /* Dipanggil fetchData() setiap detik: majukkan simulasi satu langkah lalu kembalikan snapshot status. */
  tick() {
    const now = Date.now();

    // LDR: malam berlangsung, nilai bergerak pelan (noise)
    this.ldrRaw = Math.round(Math.max(560, Math.min(980, this.ldrRaw + (Math.random() - 0.5) * 90)));

    // PIR: gerakan berlangsung sampai motionUntil, lalu sesekali muncul gerakan baru
    if (now < this.motionUntil) {
      this.motion = true;
      this.lastMotion = now;
    } else {
      this.motion = false;
      if (Math.random() < 0.010) {
        this.motionUntil = now + 7000 + Math.random() * 9000;
      }
    }

    // Logika otomatis (sama seperti di ESP32)
    const night = this.ldrRaw < CONFIG.LDR_DARK_THRESHOLD;
    const brightCond = this.motion ||
    (this.lastMotion !== null && (now - this.lastMotion) < CONFIG.MOTION_TIMEOUT_S * 1000);

    let target;
    if (this.mode === 'auto') {
      target = !night ? 0 : (brightCond ? CONFIG.BRIGHT_LEVEL : CONFIG.DIM_LEVEL);
    } else {
      target = this.manualOn ? this.manualLevel : 0;
    }

    // Catat peralihan pada mode otomatis (mode manual dicatat di applyControl)
    if (target !== this.brightness && this.mode === 'auto') {
      if (target === CONFIG.BRIGHT_LEVEL) {
        this.pushEvent('Gerakan terdeteksi — lampu terang (100%)', 'warn');
      } else if (target === CONFIG.DIM_LEVEL && this.brightness === CONFIG.BRIGHT_LEVEL) {
        this.pushEvent('Tidak ada gerakan selama 15 detik — lampu kembali redup (30%)', 'info');
      } else if (target === CONFIG.DIM_LEVEL) {
        this.pushEvent('Lampu beralih ke redup (30%)', 'info');
      } else if (target === 0) {
        this.pushEvent('Lampu mati', 'info');
      }
    }
    this.brightness = target;

    // Baterai: turun pelan saat malam, naik saat siang
    this.batt = Math.max(11.4, Math.min(13.6,
      this.batt + (night ? -0.0002 : 0.0006) + (Math.random() - 0.5) * 0.004));
    if (this.batt < CONFIG.BATT_LOW_V && !this.lowFlagged) {
      this.lowFlagged = true;
      this.pushEvent('Tegangan baterai rendah: ' + fmtDec2(this.batt) + ' V', 'danger');
    } else if (this.batt >= CONFIG.BATT_LOW_V) {
      this.lowFlagged = false;
    }

    // Akumulasi energi (per detik, hanya saat malam)
    if (night) {
      if (this.brightness >= 100) this.energy.brightSec++;
      else if (this.brightness > 0) this.energy.dimSec++;
      else this.energy.offSec++;
      this.energy.pctSec += this.brightness;
    }

    // Riwayat untuk grafik
    this.hist.push({ t: now, ldr: this.ldrRaw, brightness: this.brightness, motion: this.motion ? 1 : 0 });
    const cut = now - (CONFIG.CHART_WINDOW_MIN + 2) * 60000;
    while (this.hist.length && this.hist[0].t < cut) this.hist.shift();

    return this.snapshot();
  },

  /* Dipanggil sendControl() pada mode preview. */
  applyControl(cmd) {
    if (cmd.action === 'setMode') {
      if (cmd.mode === 'manual') {
        // Peralihan tanpa lompatan: pertahankan kondisi lampu saat ini
        this.manualOn = this.brightness > 0;
        this.manualLevel = this.brightness > 0 ? this.brightness : CONFIG.DIM_LEVEL;
        this.mode = 'manual';
        this.pushEvent('Mode MANUAL diaktifkan dari panel kontrol', 'warn');
      } else {
        this.mode = 'auto';
        this.manualOn = false;
        this.pushEvent('Mode OTOMATIS diaktifkan — logika LDR/PIR kembali berjalan', 'ok');
      }
    } else if (cmd.action === 'setLamp') {
      this.manualOn = !!cmd.on;
      this.pushEvent(this.manualOn ? 'Lampu dinyalakan (manual)' : 'Lampu dimatikan (manual)', this.manualOn ? 'warn' : 'info');
    } else if (cmd.action === 'setBrightness') {
      const v = Math.max(0, Math.min(100, Math.round(cmd.value)));
      if (v !== this.manualLevel) {
        this.manualLevel = v;
        this.pushEvent('Kecerahan diatur manual ke ' + v + '%', v === 0 ? 'info' : 'warn');
      }
    }
    return this.snapshot();
  },

  snapshot() {
    return {
      online: true,
      mode: this.mode,
      control: { manualOn: this.manualOn, manualLevel: this.manualLevel },
      lamp: { brightness: this.brightness },
      ldr: { raw: this.ldrRaw },
      pir: { motion: this.motion, lastMotion: this.lastMotion },
      battery: { voltage: Math.round(this.batt * 100) / 100 },
      history: this.hist,
      events: this.events,
      energy: Object.assign({}, this.energy)
    };
  }
};
