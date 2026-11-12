# Product Requirements Document (PRD)
## FR-51: Dynamic Session Business Context & Column Clarification Engine (In-Session Semantic Grounding & Human-in-the-Loop Clarification)

| Atribut | Keterangan |
| :--- | :--- |
| ID Fitur | FR-51 |
| Nama Fitur | Dynamic Session Business Context & Column Clarification Engine (In-Session Semantic Grounding & Human-in-the-Loop Clarification) |
| Versi | 1.0 (Proposal Spesifikasi Teknis) |
| Tanggal | 12 November 2026 |
| Status | Disetujui (Roadmap Pengembangan Aktif) |
| Prioritas | P1 (High Impact, Data Quality & Business Rule Customization) |
| Komponen Terdampak | Backend (`src/agent/`, `src/tools/database.py`, `src/api/main.py`), Database (`analytics.chat_sessions`), Frontend (`SessionContextDrawer.tsx`, `ChatInterface.tsx`, `ChatMessage.tsx`, `useQueries.ts`) |

---

## 1. Ringkasan Eksekutif & Latar Belakang

### 1.1 Latar Belakang
Pada sistem Text-to-SQL otomatis di dunia nyata, model kecerdasan buatan sering kali gagal atau menghasilkan angka yang meleset bukan karena ketidakmampuan menulis sintaks SQL, melainkan karena kesenjangan konteks semantik (*semantic mismatch*). 
Sebagian besar basis data perusahaan (terutama sistem warisan atau sistem ERP/CRM) memiliki kolom-kolom yang tidak terdokumentasi dengan baik, penuh dengan kode angka misterius, singkatan tidak standar, atau nilai status internal yang hanya dipahami oleh orang-orang tertentu dalam organisasi (*tribal knowledge*).

### 1.2 Masalah Nyata di Lapangan
1. **Kolom Kriptik dan Kode Status Misterius**:
   Misalnya tabel transaksi memiliki kolom `fld_st INT` dengan nilai `9` yang berarti "Pesanan Selesai", `3` berarti "Dibatalkan Pengguna", dan `4` berarti "Pengembalian Dana (Refund)". Tanpa konteks ini, AI akan menghitung semua baris atau menebak sembarangan status yang benar.
2. **Variasi Definisi Bisnis Antar-Departemen**:
   Departemen Keuangan menghitung *Gross Margin* sebagai `(revenue - cogs - operational_rebate)`, sedangkan departemen Penjualan hanya menghitung `(revenue - cogs)`. Pengguna perlu menentukan rumus metrik spesifik untuk sesi analisis yang sedang berjalan.
3. **Keterbatasan Hak Akses DDL (Kamus Data Statis)**:
   Analis data dan staf bisnis tidak memiliki izin untuk mengubah komentar kolom (`COMMENT ON COLUMN`) atau memodifikasi skema fisik database warehouse produksi. Mereka membutuhkan lapisan konteks fleksibel yang hidup di level percakapan (*chat session level*).
4. **Halusinasi pada Kolom Ambigu**:
   Ketika ada dua kolom bernama `delivery_date` dan `estimated_delivery_date`, agen sering kali memilih salah satu secara acak tanpa mengonfirmasi tujuan bisnis pengguna.

### 1.3 Solusi yang Ditetapkan
Membangun **Dynamic Session Business Context & Column Clarification Engine (FR-51)** yang memberikan kendali penuh kepada pengguna untuk mendefinisikan aturan bisnis dan kamus kolom per sesi chat, sekaligus memberdayakan agen untuk bertanya balik secara proaktif (*Human-in-the-Loop*) saat mendeteksi ambiguitas data:
- **Session-Scoped Semantic Layer**: Pengguna dapat menambahkan catatan arti kolom, pemetaan kode angka, atau formula metrik yang langsung diisolasi pada sesi chat aktif tanpa memengaruhi sesi lain atau skema fisik database.
- **Proactive Clarification Engine**: Agen secara otomatis memeriksa kejelasan nama kolom dan nilai unik berkardinalitas rendah. Jika terdeteksi kolom multitafsir, agen memunculkan kartu klarifikasi interaktif di antarmuka chat sebelum mengeksekusi kueri besar.
- **Dynamic Prompt & Catalog Injection**: Konteks sesi disuntikkan secara dinamis ke dalam system prompt dan tool description dengan alokasi token terukur (token budget cap maksimal 1.000 token) demi efisiensi biaya.
- **1-Click Promote to Global Glossary**: Jika sebuah definisi konteks ternyata merupakan aturan resmi perusahaan, pengguna dengan hak akses analis dapat mempromosikan aturan tersebut langsung ke kamus metrik global (`analytics.metric_glossary`).
- **Zero-Cost First**: Tidak memerlukan layanan pihak ketiga berbayar; semua metadata disimpan di PostgreSQL lokal dan diproses dalam prompt context window model gratis bawaan sistem.

---

## 2. Arsitektur & Alur Kerja Sistem

```
[Pengguna di Chat UI]
        │
        ├── 1. Ketik instruksi / input Context Drawer: "fld_st = 9 berarti Transaksi Sukses"
        ▼
[Backend: /v1/sessions/{id}/context]
        │
        ├── 2. Simpan terstruktur ke analytics.chat_sessions.custom_context (JSONB)
        ▼
[Agent Orchestration Loop]
        │
        ├── 3. Baca custom_context sesi aktif
        ├── 4. Rangkum & validasi panjang token (cap <= 1.000 token)
        ├── 5. Injeksi ke System Prompt & Deskripsi Skema run_sql
        ▼
[Analisis Pertanyaan Pengguna]
        │
        ├── 6. Deteksi kolom ambigu atau filter tak dikenal?
        │       ├── YA  -> Tampilkan Kartu Klarifikasi Proaktif di UI (Tunggu Konfirmasi)
        │       └── TIDAK -> Lanjut ke perumusan SQL
        ▼
[Generate SQL dengan Konteks Bisnis Akurat]
        │
        ├── Contoh: SELECT SUM(total_amount) FROM orders WHERE fld_st = 9;
        ▼
[Hasil & Rekomendasi Promosi]
        │
        └── 7. Opsi "Promosikan ke Kamus Metrik Global" (analytics.metric_glossary)
```

---

## 3. Detail Kebutuhan Fungsional

### 3.1 Penyimpanan Konteks Sesi (Session Context Storage)
1. Setiap sesi analitik (`analytics.chat_sessions`) memiliki atribut `custom_context` berformat `JSONB` yang menampung tiga kategori entri:
   - `column_mappings`: Pemetaan nama kolom atau kode status (misalnya: `fld_st: 9 = "completed", 3 = "canceled"`).
   - `custom_formulas`: Rumus metrik buatan pengguna (misalnya: `gross_margin = revenue - cogs`).
   - `business_rules`: Catatan bebas perilaku data (misalnya: `abaikan data sebelum tahun 2024 karena migrasi sistem`).
2. Konteks dapat diperbarui kapan saja di tengah percakapan tanpa menghapus riwayat pesan sebelumnya.

### 3.2 Injeksi Konteks Dinamis ke Prompt Agen (Dynamic Prompt Injection)
1. Sebelum agen memproses pertanyaan pengguna, subsistem prompt builder mengambil data `custom_context` dari sesi terkait.
2. Format injeksi disusun padat dan terstruktur dalam format Markdown di bawah blok `# SESSION-SPECIFIC BUSINESS CONTEXT & COLUMN RULES`.
3. Aturan alokasi token (*Token Budget Cap*):
   - Alokasi maksimal untuk konteks sesi adalah 1.000 token.
   - Jika teks yang dimasukkan melebihi batas, sistem melakukan pemotongan (*truncation*) berbasis prioritas: `column_mappings` > `custom_formulas` > `business_rules`, disertai peringatan di antarmuka.

### 3.3 Deteksi Ambiguitas & Klarifikasi Proaktif (Proactive Clarification)
1. Saat pengguna meminta analisis yang melibatkan kolom dengan nama ambigu (misalnya terdapat `order_date`, `payment_date`, `shipping_date`) atau kolom kategori dengan nilai kode integer tanpa metadata:
   - Agen tidak boleh menebak secara diam-diam.
   - Agen mengirimkan payload bertipe `CLARIFICATION_REQUIRED` dengan daftar opsi yang terdeteksi di database.
2. Antarmuka Web UI merender kartu interaktif (*Clarification Card*) dengan pilihan tombol klik cepat atau input bebas.
3. Jawaban pengguna secara otomatis disimpan ke `custom_context` sesi tersebut sehingga pertanyaan berikutnya tidak perlu menanyakan hal yang sama lagi.

### 3.4 Promosi 1-Klik ke Kamus Metrik Global (1-Click Promote to Glossary)
1. Pada setiap kartu konteks sesi atau hasil analisis, tersedia tombol "Jadikan Standar Global" (*Promote to Global Glossary*).
2. Ketika diklik, sistem membuka formulir konfirmasi ringkas dan menyalin definisi tersebut ke tabel `analytics.metric_glossary`.
3. Setelah dipromosikan, semua pengguna dan sesi lain di masa mendatang akan otomatis mewarisi definisi tersebut tanpa konfigurasi ulang.

---

## 4. Skema Database & Migrasi SQL

```sql
-- Tambah kolom custom_context ke tabel analytics.chat_sessions
ALTER TABLE analytics.chat_sessions
ADD COLUMN IF NOT EXISTS custom_context JSONB DEFAULT '{
  "column_mappings": {},
  "custom_formulas": {},
  "business_rules": []
}'::jsonb;

-- Indeks GIN untuk pencarian performa tinggi pada custom_context
CREATE INDEX IF NOT EXISTS idx_chat_sessions_custom_context 
ON analytics.chat_sessions USING gin (custom_context);

-- Contoh struktur data JSONB:
-- {
--   "column_mappings": {
--     "orders.fld_st": {
--       "description": "Status transaksi pesanan",
--       "values": {"9": "Selesai", "3": "Dibatalkan", "4": "Refund"}
--     }
--   },
--   "custom_formulas": {
--     "real_revenue": "sum(amount) - sum(discount_val)"
--   },
--   "business_rules": [
--     "Cabang JKT01 adalah kantor pusat dan mencakup transaksi B2B nasional."
--   ]
-- }
```

---

## 5. Spesifikasi API Backend

### 5.1 GET `/v1/sessions/{session_id}/context`
Mengambil seluruh konteks bisnis yang aktif pada sesi tersebut.
- **Respons (200 OK)**:
  ```json
  {
    "session_id": "sess_8943f2a",
    "custom_context": {
      "column_mappings": {
        "orders.fld_st": {
          "description": "Status transaksi",
          "values": {"9": "Sukses", "3": "Batal"}
        }
      },
      "custom_formulas": {
        "net_margin": "revenue - cogs"
      },
      "business_rules": [
        "Abaikan user id testing 9999"
      ]
    },
    "token_count_estimate": 145,
    "max_token_budget": 1000
  }
  ```

### 5.2 PUT `/v1/sessions/{session_id}/context`
Memperbarui atau menambahkan konteks bisnis pada sesi aktif.
- **Payload Request**:
  ```json
  {
    "custom_context": {
      "column_mappings": {
        "orders.fld_st": {
          "description": "Status transaksi",
          "values": {"9": "Sukses", "3": "Batal"}
        }
      },
      "custom_formulas": {
        "net_margin": "revenue - cogs"
      },
      "business_rules": [
        "Abaikan user id testing 9999"
      ]
    }
  }
  ```
- **Respons (200 OK)**: Konteks berhasil diperbarui dan diterapkan ke inferensi berikutnya.

### 5.3 POST `/v1/sessions/{session_id}/context/promote-glossary`
Mempromosikan salah satu entri konteks sesi menjadi metrik kamus global.
- **Payload Request**:
  ```json
  {
    "metric_name": "net_margin",
    "sql_formula": "revenue - cogs",
    "description": "Margin bersih disepakati tim operasional",
    "domain": "Finance"
  }
  ```
- **Respons (201 Created)**: Data tersimpan di `analytics.metric_glossary`.

---

## 6. Desain Antarmuka Pengguna (Web UI)

1. **Header Sesi Chat (Context Indicator Badge)**:
   - Menampilkan ikon buku catatan / pin kecil bertuliskan `"Konteks Sesi: 2 Aturan Aktif"` di sebelah judul sesi chat.
   - Mengklik badge ini akan membuka *Session Context Drawer* di sisi kanan layar.
2. **Session Context Drawer**:
   - Memiliki 3 tab: Pemetaan Kolom (*Column Mappings*), Rumus Kustom (*Formulas*), dan Catatan Bisnis (*Notes*).
   - Pengguna dapat menambah entri dengan format key-value sederhana tanpa perlu menulis format JSON mentah.
   - Disertai indikator progres penggunaan token (misalnya: `145 / 1.000 Token Terpakai`).
3. **Kartu Klarifikasi Proaktif di Thread Chat**:
   - Ketika agen mendeteksi kolom multitafsir, pesan chat agen menampilkan kartu berwarna amber dengan header: `"Klarifikasi Diperlukan: Kolom mana yang ingin Anda gunakan?"`.
   - Menampilkan tombol pill opsi (misalnya: `[ Tanggal Pemesanan ]`, `[ Tanggal Pengiriman ]`, `[ Tanggal Pembayaran ]`).
   - Setelah pengguna mengeklik salah satu pill, kueri langsung dijalankan tanpa perlu mengetik ulang seluruh prompt.

---

## 7. Keamanan, Guardrails, & Kontrol Biaya

1. **Pencegahan Prompt Injection**:
   - Semua teks konteks bisnis disanitasi dari karakter kontrol khusus (`<|im_start|>`, `<system>`, ````) sebelum disuntikkan ke prompt LLM.
   - Nilai konteks diperlakukan sebagai metadata deklaratif murni, bukan instruksi yang dapat mengeksekusi perintah shell atau DDL database.
2. **Batas Ukuran Data & Kuota Token**:
   - Maksimal 20 entri per sesi untuk mencegah pembengkakan context window.
   - Panjang total karakter dibatasi maksimal 4.000 karakter (~1.000 token).
3. **Zero-Cost Architecture**:
   - Penyimpanan berbasis PostgreSQL lokal.
   - Tidak ada overhead panggilan LLM tambahan selama proses penyimpanan konteks (hanya terjadi saat inferensi chat biasa).

---

## 8. Kriteria Penerimaan (Acceptance Criteria)

1. **AC-01 (Persistensi Sesi)**: Konteks bisnis yang ditambahkan pada Sesi A tersimpan di database dan tidak memengaruhi hasil kueri pada Sesi B.
2. **AC-02 (Akurasi Text-to-SQL)**: Ketika kolom `orders.fld_st = 9` didefinisikan sebagai "Pesanan Sukses", prompt "Berapa total pesanan sukses bulan ini?" menghasilkan SQL dengan klausul `WHERE fld_st = 9`.
3. **AC-03 (Klarifikasi Interaktif)**: Saat mendeteksi 2 kolom tanggal yang relevan pada pertanyaan berbasis waktu, agen memunculkan kartu pilihan dan menunda eksekusi SQL sampai ada pilihan dari pengguna.
4. **AC-04 (Promosi Metrik)**: Definisi rumus kustom dapat dipromosikan ke `analytics.metric_glossary` dalam 1 klik dan langsung terbaca oleh sesi chat baru lainnya.
5. **AC-05 (Batas Token)**: Upaya memasukkan konteks melebihi batas 1.000 token ditolak dengan pesan peringatan yang informatif dan jelas.
