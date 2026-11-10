# Product Requirements Document (PRD)
## FR-49: Automated Metric Watchdog & Threshold Alerting Engine (Scheduled Anomaly Monitor & Webhook Dispatcher)

| Atribut | Keterangan |
| :--- | :--- |
| ID Fitur | FR-49 |
| Nama Fitur | Automated Metric Watchdog & Threshold Alerting Engine (Scheduled Anomaly Monitor & Webhook Dispatcher) |
| Versi | 1.0 (Proposal Spesifikasi Teknis) |
| Tanggal | 10 November 2026 |
| Status | Disetujui (Roadmap Pengembangan Aktif) |
| Prioritas | P1 (High Impact - Proactive Autonomous Intelligence) |
| Komponen Terdampak | Backend (`src/queue/`, `src/tools/database.py`, `src/agent/manual_loop.py`, `src/api/main.py`), Database (`analytics.watchdog_rules`, `analytics.watchdog_logs`), Frontend (`WatchdogModal.tsx`, `Navbar.tsx`, `NotificationCenter.tsx`) |

---

## 1. Ringkasan Eksekutif & Latar Belakang

### 1.1 Latar Belakang
Hingga saat ini, interaksi analitik di Harmonix bersifat **reaktif**: sistem hanya melakukan kalkulasi ketika pengguna membuka browser dan mengetik pertanyaan bisnis.

Pada operasional bisnis nyata, pemangku kepentingan (C-Level, VP Operasional, Manajer Logistik) tidak memiliki waktu untuk memeriksa metrik setiap jam secara manual. Mereka membutuhkan sistem penjaga otomatis (*autonomous data sentinel*) yang:
1. Memantau kesehatan metrik kritis secara berkala (misal: tingkat keterlambatan pengiriman, rasio pembatalan pesanan, anomali penurunan GMV).
2. Mengeksekusi pengecekan secara mandiri tanpa biaya token LLM tambahan pada siklus normal.
3. Memberikan peringatan proaktif (*proactive alert*) ke saluran komunikasi tim (Slack, Discord, Webhook, atau notifikasi in-app) hanya ketika metrik melanggar ambang batas (*threshold breach*) atau menunjukkan tren anomali.

### 1.2 Solusi yang Ditetapkan
Membangun **Automated Metric Watchdog & Threshold Alerting Engine (FR-49)** yang mentransformasikan Harmonix menjadi agen analitik proaktif:
- Menyediakan mesin penjadwalan query SQL berkala berbasis cron atau interval waktu.
- Pengecekan rutin dijalankan langsung di database PostgreSQL melalui tool `run_sql` yang terlindungi AST Guardrail (100% Zero LLM Token Cost selama kondisi normal).
- Mendukung dua jenis aturan ambang batas: *Ambang Batas Statis* (misal: rasio pembatalan > 5%) dan *Ambang Batas Dinamis/Tren* (misal: GMV hari ini drop > 20% dibanding rata-rata 7 hari terakhir).
- Ketika terjadi pelanggaran ambang batas, agen secara opsional memicu *mini root-cause analysis* (1 turn inferensi) untuk menjelaskan *penyebab* anomali tersebut, lalu mengirimkan payload alert terstruktur ke Webhook eksternal (Slack/Discord/Teams) serta Notification Center di Web UI.

---

## 2. Arsitektur & Alur Kerja Sistem

```
[Pengguna Mendefinisikan Aturan Watchdog di Web UI / API]
                          │
                          ▼
        [Tersimpan di analytics.watchdog_rules]
                          │
                          ▼
       [Background Scheduler / Queue Worker (src/queue)]
       (Jadwal Berulang: Tiap Jam / Harian / Cron)
                          │
                          ▼
[Eksekusi SQL Terverifikasi via run_sql (Zero LLM Token Cost)]
                          │
                          ▼
            [Evaluasi Ambang Batas (Rule Evaluator)]
             ├── Normal (Dalam Batas): Catat Log Sukses -> Selesai
             └── Terlanggar (Breach / Anomali Terdeteksi):
                          │
                          ▼
       [Mini Agent Root-Cause Analysis (Opsional, 1-Turn)]
       "Mengapa rasio pembatalan melonjak menjadi 7.2%?"
                          │
                          ▼
       [Multi-Channel Notification Dispatcher]
       ├─ In-App Notification Center (Bell Badge di UI)
       └─ Webhook JSON Payload (Slack, Discord, MS Teams)
```

---

## 3. Spesifikasi Fungsional

### 3.1 Skema Data Persistensi PostgreSQL
Tabel konfigurasi dan riwayat eksekusi disimpan di skema `analytics`:

```sql
-- Aturan pemantauan metrik
CREATE TABLE IF NOT EXISTS analytics.watchdog_rules (
    rule_id VARCHAR(100) PRIMARY KEY,
    session_id VARCHAR(100),
    rule_name VARCHAR(255) NOT NULL,
    description TEXT,
    sql_query TEXT NOT NULL,
    metric_column VARCHAR(100) NOT NULL,
    operator VARCHAR(20) NOT NULL, -- 'gt', 'lt', 'gte', 'lte', 'pct_drop', 'pct_spike'
    threshold_value NUMERIC NOT NULL,
    schedule_cron VARCHAR(50) NOT NULL DEFAULT '0 8 * * *', -- e.g. every day at 08:00
    is_active BOOLEAN DEFAULT TRUE,
    auto_diagnose BOOLEAN DEFAULT TRUE, -- trigger mini-agent root-cause explanation
    notification_channel VARCHAR(50) DEFAULT 'in_app', -- 'in_app', 'webhook', 'both'
    webhook_url TEXT,
    last_run_at TIMESTAMP WITH TIME ZONE,
    last_status VARCHAR(30) DEFAULT 'IDLE', -- 'IDLE', 'OK', 'BREACH', 'ERROR'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Log audit riwayat evaluasi
CREATE TABLE IF NOT EXISTS analytics.watchdog_logs (
    log_id VARCHAR(100) PRIMARY KEY,
    rule_id VARCHAR(100) REFERENCES analytics.watchdog_rules(rule_id) ON DELETE CASCADE,
    evaluated_value NUMERIC,
    threshold_value NUMERIC,
    status VARCHAR(30) NOT NULL, -- 'OK', 'BREACH', 'ERROR'
    breach_message TEXT,
    diagnostic_summary TEXT,
    webhook_status_code INT,
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### 3.2 Tipe Aturan Evaluasi (Rule Evaluator)
1. **Ambang Batas Statis (Absolute Threshold):**
   - Contoh: Nilai kolom `unfulfilled_orders` > 50.
2. **Ambang Batas Relatif / Rasio (Percentage Rate):**
   - Contoh: Nilai kolom `cancellation_rate_pct` >= 5.0%.
3. **Deteksi Deviasi Tren (Period-over-Period Deviation):**
   - Query membandingkan metrik periode berjalan terhadap *baseline* (misal: 7 hari sebelumnya).
   - Operator `pct_drop`: Jika $(V_{current} - V_{baseline}) / V_{baseline} < -0.15$ (drop lebih dari 15%).

### 3.3 Penjadwalan & Eksekusi Hemat Biaya
- Menggunakan komponen `src/queue/` atau scheduler berbasis interval asinkronus (`asyncio`).
- Pengecekan hanya menjalankan query SQL read-only via `src/tools/database.py` dengan validasi AST `sqlglot`.
- Tidak ada panggilan model bahasa (LLM) yang dilakukan selama metrik berada dalam batas aman $\rightarrow$ **100% Zero API Cost**.

### 3.4 Root-Cause Diagnosis Otomatis (Hanya saat Breach)
- Jika terdeteksi kondisi `BREACH` dan opsi `auto_diagnose = True`:
  - Agen Analis secara otomatis dipanggil dengan 1 prompt terfokus: *"Terjadi anomali pada [rule_name]: nilai aktual adalah [evaluated_value], melebihi batas aman [threshold_value]. Periksa tabel terkait dan simpulkan 2-3 penyebab utamanya dalam 3 kalimat ringkas."*
  - Hasil diagnosis ini dilampirkan langsung ke dalam payload notifikasi.

### 3.5 Dispatcher Notifikasi Webhook
Format pengiriman notifikasi JSON standar (kompatibel dengan Slack Incoming Webhooks & MS Teams):
```json
{
  "event": "watchdog_breach",
  "rule_name": "Lonjakan Tingkat Pembatalan Pesanan",
  "severity": "CRITICAL",
  "timestamp": "2026-11-10T08:00:15Z",
  "metric": {
    "column": "cancellation_rate_pct",
    "threshold": 5.0,
    "actual_value": 7.35
  },
  "summary": "Nilai aktual 7.35% melampaui batas toleransi 5.0%.",
  "diagnostic": "Lonjakan pembatalan terkonsentrasi pada seller kategori perlengkapan kantor di wilayah SP akibat keterlambatan mitra kurir.",
  "dashboard_url": "http://localhost:8000/?session=ses_default&view=dashboard"
}
```

### 3.6 Antarmuka Pengguna (Web UI)
- **Tombol & Modal "Watchdog Monitor" pada Header:**
  - Menampilkan daftar aturan aktif, jadwal eksekusi, nilai terakhir, dan tombol sakelar *Enable/Disable*.
  - Form pembuatan aturan baru: Pengguna dapat menyimpan query dari percakapan chat aktif langsung menjadi aturan Watchdog (*One-Click Watchdog Creation*).
- **Notification Center (Icon Lonceng):**
  - Menampilkan badge merah saat ada anomali yang belum dibaca.
  - Menampilkan kartu ringkasan breach lengkap dengan penjelasan kausalitas dan tombol langsung menuju tabel data terkait.

---

## 4. Kriteria Keberhasilan & Batasan Keamanan
1. **Keandalan Eksekusi:** Pengecekan terjadwal berjalan tepat waktu dengan toleransi deviasi < 5 detik.
2. **Efisiensi Sumber Daya:** Pengecekan reguler tidak membebani CPU database dan tidak mengonsumsi kuota token LLM saat metrik normal.
3. **Keamanan Webhook:** URL Webhook eksternal disanitasi dan hanya menerima skema `https://` yang valid untuk mencegah eksfiltrasi SSRF internal.
