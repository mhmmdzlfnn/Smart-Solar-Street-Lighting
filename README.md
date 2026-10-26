# Smart Solar Street Lighting — Panel Monitoring

Dashboard web monitoring untuk sistem lampu jalan pintar bertenaga surya berbasis **ESP32**.
Ini panel kontrol teknisi untuk memantau **satu lampu jalan** di lapangan: status lampu, kondisi cahaya, gerakan, baterai, grafik riwayat, log kejadian, dan kontrol manual — semuanya dalam satu halaman gelap yang ramah dibaca siang maupun malam.

> **Status saat ini:** frontend selesai dan berjalan dengan **data dummy** (simulator ESP32 yang berjalan di browser, logikanya sama persis dengan sistem asli). Untuk data asli, cukup isi `fetchData()` dan `sendControl()` di `app.js` — penjelasannya ada di bawah.

---

## Fitur

- **Status lampu real-time** — MATI / REDUP / TERANG lengkap dengan persen kecerahan (PWM GPIO25)
- **Kondisi cahaya (LDR, GPIO34)** — nilai ADC 0–4095 + label Terang/Gelap + mode sistem Siang/Malam
- **Gerakan (PIR, GPIO27)** — Ada Gerakan / Sepi + waktu gerakan terakhir
- **Tegangan baterai (GPIO35)** — dalam volt + label Normal / Mengisi / Rendah
- **Grafik riwayat 35 menit** — LDR, kecerahan lampu, dan momen gerakan dalam satu sumbu waktu yang sama, supaya hubungan sebab-akibatnya terlihat (ada tooltip saat kursor/disentuh)
- **Log kejadian** — peralihan lampu, gerakan terdeteksi, baterai rendah, perubahan mode kontrol
- **Ringkasan hemat energi** — total durasi lampu redup vs terang + estimasi penghematan dibanding menyala 100% terus-menerus
- **Panel kontrol** — pilih mode Otomatis/Manual; saat manual aktif muncul peringatan dan tersedia tombol nyala/mati + slider kecerahan 0–100%. Saat otomatis, kontrol manual terkunci agar tidak bentrok dengan logika LDR/PIR
- Responsif untuk laptop dan HP, **tanpa library eksternal** — bisa dibuka langsung tanpa internet

## Logika Sistem

| Kondisi | Perilaku lampu |
|---|---|
| Siang hari (LDR terang) | Mati |
| Malam hari tanpa gerakan | Redup 30% |
| Malam hari ada gerakan | Terang 100% |
| 15 detik tanpa gerakan | Kembali redup 30% |

## Perangkat Keras

| Komponen | Pin ESP32 | Keterangan |
|---|---|---|
| LDR / sensor cahaya | GPIO34 | Input ADC 0–4095 |
| PIR / sensor gerak | GPIO27 | Output digital |
| LED lampu jalan (driver) | GPIO25 | Output PWM |
| Pembagi tegangan baterai | GPIO35 | Opsional, input ADC |

## Struktur File

```
├── index.html      # kerangka halaman
├── style.css       # seluruh tampilan (tema gelap panel monitoring)
├── config.js       # konstanta sistem — samakan dengan kode ESP32
├── dummy-data.js   # DATA DUMMY: simulator ESP32 untuk mode preview
└── app.js          # fetchData()/sendControl() (sambung ke ESP32 di sini) + render, grafik, kontrol
```

## Menjalankan Preview (Data Dummy)

Buka `index.html` langsung di browser — selesai. Tidak perlu server, tidak perlu install apa pun.

Data dummy disimulasikan `dummy-data.js` dan mengikuti logika sistem asli: dimulai dari transisi senja 27 menit terakhir, lengkap dengan beberapa kejadian gerakan, supaya grafik dan log terlihat hidup.

## Menyambungkan ke ESP32 (Data Asli)

Buka `app.js`, cari bagian bertanda **`GANTI DI SINI`**, lalu:

1. Hapus baris `return Dummy.tick();` di dalam `fetchData()`.
2. Isi `fetchData()` untuk mengambil status dari perangkat, dan `sendControl()` untuk mengirim perintah kontrol.
3. (Opsional) Hapus `dummy-data.js` beserta tag `<script src="dummy-data.js">` di `index.html`.

### Struktur JSON yang Diharapkan dari Perangkat

```json
{
  "mode": "auto",
  "control": { "manualOn": false, "manualLevel": 30 },
  "lamp": { "brightness": 30 },
  "ldr": { "raw": 812 },
  "pir": { "motion": false, "lastMotion": 1761472820000 },
  "battery": { "voltage": 12.42 },
  "history": [ { "t": 1761472820000, "ldr": 812, "brightness": 30, "motion": 0 } ],
  "events": [ { "t": 1761472820000, "msg": "Lampu beralih ke redup (30%)", "type": "info" } ],
  "energy": { "offSec": 0, "dimSec": 1620, "brightSec": 53, "pctSec": 10160 }
}
```

| Field | Keterangan |
|---|---|
| `mode` | `"auto"` atau `"manual"` |
| `lamp.brightness` | 0–100 (%) kecerahan PWM |
| `ldr.raw` | 0–4095 (ADC GPIO34) |
| `pir.lastMotion` | epoch milidetik gerakan terakhir (`null` jika belum ada) |
| `battery.voltage` | tegangan baterai dalam volt |
| `history` | sampel riwayat untuk grafik (`t` = epoch ms) |
| `events` | log kejadian, `type`: `info` / `ok` / `warn` / `danger` |
| `energy` | akumulasi detik sejak senja: `offSec`, `dimSec`, `brightSec`, `pctSec` (jumlah brightness% per detik) |

Label siang/malam, terang/gelap, dan normal/rendah **tidak perlu dikirim** — dashboard menghitungnya dari nilai mentah + `config.js`, sehingga ambang selalu konsisten.

### Contoh Implementasi

`fetchData()` dengan HTTP REST (dashboard dipoll tiap 1 detik, timeout 3 detik sudah disiapkan di komentar):

```js
async function fetchData() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  const res = await fetch('http://192.168.1.50/api/status',
                          { cache: 'no-store', signal: ctrl.signal });
  clearTimeout(timer);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}
```

`sendControl()` menerima perintah berikut dari panel kontrol:

```js
{ action: 'setMode',       mode: 'auto' | 'manual' }
{ action: 'setLamp',       on: true | false }      // hanya mode manual
{ action: 'setBrightness', value: 0..100 }         // hanya mode manual
```

Contoh alternatif untuk **MQTT over WebSocket** juga sudah tersedia di komentar `app.js`.

### Catatan Deployment

- Browser hanya boleh memanggil API ESP32 jika **CORS diizinkan**, atau
- Lebih mudah: unggah seluruh folder ini ke flash ESP32 (LittleFS/SPIFFS) dan sajikan dari sana — origin-nya sama, CORS tidak jadi masalah, dan dashboard tetap bisa diakses dari HP di jaringan yang sama.
- Jika perangkat tidak terjangkau, dashboard otomatis menampilkan badge **ESP32 Offline** (merah) dan mempertahankan data terakhir yang berhasil diterima.

## Konfigurasi (`config.js`)

| Konstanta | Nilai bawaan | Arti |
|---|---|---|
| `LDR_DARK_THRESHOLD` | 2000 | ADC di bawah nilai ini dianggap gelap (malam) |
| `DIM_LEVEL` | 30 | Kecerahan (%) malam tanpa gerakan |
| `BRIGHT_LEVEL` | 100 | Kecerahan (%) saat ada gerakan |
| `MOTION_TIMEOUT_S` | 15 | Detik tanpa gerakan sebelum kembali redup |
| `BATT_LOW_V` | 11.8 | Di bawah ini baterai dianggap rendah |
| `BATT_CHARGE_V` | 13.0 | Di atas ini dianggap sedang mengisi |
| `LAMP_WATTS` | 30 | Perkiraan daya LED penuh, untuk estimasi penghematan Wh |
| `POLL_MS` | 1000 | Interval pengambilan data (ms) |
| `CHART_WINDOW_MIN` | 35 | Lebar jendela grafik (menit) |

---

## Tangkapan Layar

<!-- Tambahkan screenshot setelah repo dibuat, contoh:
![Panel monitoring](screenshot.png)
-->
