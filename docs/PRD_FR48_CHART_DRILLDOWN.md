# Product Requirements Document (PRD)
## FR-48: Interactive Chart-to-Chat Drill-Down Engine (Two-Way Canvas & Deep Exploration)

| Atribut | Keterangan |
| :--- | :--- |
| ID Fitur | FR-48 |
| Nama Fitur | Interactive Chart-to-Chat Drill-Down Engine (Two-Way Canvas & Deep Exploration) |
| Versi | 1.0 (Proposal Spesifikasi Teknis) |
| Tanggal | 10 November 2026 |
| Status | Disetujui (Roadmap Pengembangan Aktif) |
| Prioritas | P1 (High Impact - Core UX Convergence) |
| Komponen Terdampak | Frontend (`EChartsViewer.tsx`, `DashboardCanvas.tsx`, `ChatMessage.tsx`, `useAppStore.ts`), Backend (`src/agent/manual_loop.py`, `src/agent/prompts.py`) |

---

## 1. Ringkasan Eksekutif & Latar Belakang

### 1.1 Latar Belakang
Saat ini, interaksi analitik di Harmonix bersifat satu arah (*one-way flow*):
1. Pengguna mengetik pertanyaan di chat.
2. Agen menghasilkan SQL, tabel, dan grafik Apache ECharts.
3. Pengguna dapat menyematkan grafik ke Live BI Dashboard.

Namun, ketika pengguna melihat anomali menarik pada grafik (misalnya batang penjualan kategori tertentu anjlok, atau lonjakan pembatalan pesanan di bulan tertentu), pengguna terpaksa harus mengetik ulang pertanyaan secara manual di kolom chat: *"Kenapa kategori X di bulan Y turun?"*. Hal ini menciptakan friksi kognitif, memperlambat proses investigasi, dan berisiko kehilangan konteks filter spesifik dari query sebelumnya.

### 1.2 Solusi yang Ditetapkan
Membangun **Interactive Chart-to-Chat Drill-Down Engine (FR-48)** yang mewujudkan konvergensi dua arah (*two-way interaction*) antara kanvas visual dan antarmuka percakapan:
- Pengguna dapat mengklik elemen grafis apapun (batang pada bar chart, irisan pada doughnut/pie chart, titik pada line chart, atau koordinat pada scatter plot) baik di Chat Message maupun di Live BI Dashboard / TV Command Center.
- Muncul popover menu interaktif dengan aksi investigasi instan.
- Sistem mengekstrak dimensi, nilai, dan SQL induk (*parent SQL context*), lalu menyusun query eksplorasi bertingkat (*drill-down*) secara otomatis ke sesi chat aktif.

---

## 2. Alur Interaksi Pengguna (User Flow)

```
[Pengguna Melihat Grafik ECharts di Chat / Dashboard]
                      │
                      ▼
        (Klik Batang / Irisan / Titik Data)
                      │
                      ▼
    [Tampil Popover Contextual Action Menu]
    ├─ 1. "Selidiki Anomali / Penurunan" (Root-cause analysis)
    ├─ 2. "Bedah Berdasarkan Dimensi Lain" (State, Payment, Seller)
    └─ 3. "Lihat Baris Data Mentah" (Instant Raw Data Drawer)
                      │
                      ▼
[Sistem Memindahkan Pengguna ke Chat View (Jika dari Dashboard)]
                      │
                      ▼
[Prompt Otomatis Dieksekusi dengan Menyertakan Parent Query Context]
                      │
                      ▼
   [Agen Menjalankan Sub-Query Presisi & Memberikan Insight Mendalam]
```

---

## 3. Spesifikasi Fungsional

### 3.1 Event Capturing pada ECharts (`EChartsViewer.tsx`)
- Mengintegrasikan handler event `chartInstance.on('click', params)` pada komponen `EChartsViewer`.
- Mengekstrak metadata klik:
  - `dimension_name`: Nama sumbu atau kategori (misal: `"cama_mesa_banho"` atau `"2018-05"`).
  - `metric_value`: Nilai numerik pada titik tersebut (misal: `1250000.00`).
  - `series_name`: Nama deret data (misal: `"Total Penjualan"`).
  - `chart_type`: Tipe visualisasi (`bar`, `line`, `pie`, `scatter`).

### 3.2 Contextual Drill-Down Action Menu (Popover UI)
Saat segmen grafik diklik, muncul popover melayang dengan posisi cerdas (*viewport-aware*) yang menyediakan 3 pilihan aksi:
1. **Investigasi Kausalitas (Root-Cause Prompt):**
   - Template prompt otomatis: *"Analisis mendalam mengapa [series_name] pada [dimension_name] bernilai [metric_value]. Berikan rincian faktor pendorong utama dan anomali pendukung."*
2. **Eksplorasi Dimensi Silang (Cross-Dimension Breakdown):**
   - Menawarkan opsi bedah dimensi yang relevan berdasarkan skema tabel:
     - Berdasarkan Geografi (Kota / Provinsi).
     - Berdasarkan Metode Pembayaran.
     - Berdasarkan Reputasi / Ulasan Penjual (*Seller Rating*).
3. **Inspeksi Baris Data Mentah (Raw Rows Inspector):**
   - Membuka modal/drawer ringkas yang menampilkan 20 baris data pertama dari database yang membentuk titik agregat tersebut tanpa perlu memicu inferensi LLM baru.

### 3.3 Penanganan Konteks Kueri Bertingkat (Query Lineage Preservation)
- Agar LLM tidak menganalisis dari nol, sistem menyuntikkan metadata lineage ke dalam prompt tersembunyi:
  ```json
  {
    "drill_down_context": {
      "parent_query": "SELECT product_category_name, SUM(price) FROM analytics.order_items ...",
      "selected_filter": "product_category_name = 'cama_mesa_banho'",
      "clicked_metric": "total_sales = 1036800.0"
    }
  }
  ```
- Agen Analis secara otomatis memanfaatkan klausa `WHERE` tambahan atau teknik *Common Table Expression* (CTE) untuk mempersempit investigasi ke segmen data yang dipilih.

### 3.4 Transisi Antarmuka yang Mulus
- Jika klik dilakukan dari **Live BI Dashboard**, antarmuka secara halus beralih ke tab `Percakapan`, memasukkan kueri ke dalam antrean chat, dan memulai streaming respons dengan visualisasi baru.
- Jika klik dilakukan pada **Mode TV Command Center**, sistem menampilkan drawer samping (*side-drawer inspection*) semi-transparan tanpa merusak tampilan fullscreen utama.

---

## 4. Kriteria Keberhasilan & Metrik Pengujian
1. **Akurasi Ekstraksi Parameter:** Parameter dimensi dan nilai yang diklik tertangkap dengan akurasi 100% pada semua varian chart (Bar, Line, Pie/Doughnut, Scatter).
2. **Latensi Transisi:** Menu popover muncul dalam waktu < 50ms setelah klik.
3. **Relevansi Kueri Lanjutan:** Agen menghasilkan kueri SQL turunan yang mempertahankan filter induk tanpa halusinasi skema (dievaluasi via test suite).
