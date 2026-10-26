'use strict';
/* ============================================================
   KONFIGURASI SISTEM — samakan nilainya dengan kode ESP32
   ------------------------------------------------------------
   LDR    -> GPIO34 (ADC 0-4095)
   PIR    -> GPIO27
   LED    -> GPIO25 (PWM)
   Baterai-> GPIO35 (pembagi tegangan)
   ============================================================ */
const CONFIG = {
  LDR_ADC_MAX: 4095,          // ADC ESP32 12-bit
  LDR_DARK_THRESHOLD: 2000,   // ADC di bawah nilai ini = GELAP (malam)
  DIM_LEVEL: 30,              // % kecerahan malam tanpa gerakan
  BRIGHT_LEVEL: 100,          // % kecerahan saat ada gerakan
  MOTION_TIMEOUT_S: 15,       // detik tanpa gerakan sebelum kembali redup
  BATT_LOW_V: 11.8,           // di bawah ini = baterai RENDAH
  BATT_CHARGE_V: 13.0,        // di atas ini = MENGISI (panel surya aktif)
  LAMP_WATTS: 30,             // perkiraan daya LED saat 100% (untuk estimasi Wh)
  POLL_MS: 1000,              // interval pengambilan data
  CHART_WINDOW_MIN: 35        // lebar jendela grafik (menit)
};
