# Product Requirements Document: Data Analyst Agent

Proyek portofolio AI Agent Engineer (Python Backend): agent text-to-SQL tahan produksi dengan harness lengkap

| **Atribut** | **Keterangan**                                                 |
|-------------|----------------------------------------------------------------|
| Versi       | 1.2 (Smart Follow-Up Suggestions & Session Management)         |
| Tanggal     | 18 Oktober 2026                                                |
| Status      | Disetujui (Fitur Aktif & Roadmap)                             |
| Pemilik     | Pengembang proyek (portofolio)                                 |
| Domain      | Analisis data / text-to-SQL (PostgreSQL, Zero-Cost AI Harness) |

## Daftar Isi

- [1. Ringkasan Eksekutif](#1-ringkasan-eksekutif)
- [2. Latar Belakang dan Masalah](#2-latar-belakang-dan-masalah)
- [3. Tujuan dan Non-Tujuan](#3-tujuan-dan-non-tujuan)
- [4. Persona dan Skenario Pengguna](#4-persona-dan-skenario-pengguna)
- [5. Kebutuhan Fungsional](#5-kebutuhan-fungsional)
- [6. Observability dan Evaluasi](#6-observability-dan-evaluasi)
- [7. Kebutuhan Non-Fungsional](#7-kebutuhan-non-fungsional)
- [8. Arsitektur Tingkat Tinggi](#8-arsitektur-tingkat-tinggi)
- [9. Metrik Keberhasilan](#9-metrik-keberhasilan)
- [10. Artefak Portofolio (Deliverable)](#10-artefak-portofolio-deliverable)
- [11. Rencana Rilis dan Milestone](#11-rencana-rilis-dan-milestone)
- [12. Risiko dan Mitigasi](#12-risiko-dan-mitigasi)
- [13. Keputusan Desain (Jawaban Pertanyaan Terbuka)](#13-keputusan-desain-jawaban-pertanyaan-terbuka)
- [14. Pemetaan ke Kualifikasi Loker](#14-pemetaan-ke-kualifikasi-loker)

---

## 1. Ringkasan Eksekutif

Kebanyakan demo agent berhenti di "bisa menjawab di kondisi ideal". Proyek ini sengaja dibangun untuk kondisi produksi: ada guardrail, approval gate, observability, eval otomatis, dan dokumentasi kegagalan nyata. Domain analisis data (text-to-SQL) dipilih karena risikonya jelas dan mudah didemokan: query berbahaya, data sensitif (PII), biaya token, dan kesalahan interpretasi hasil.

Sistem dirancang dengan filosofi **Zero-Cost First (100% Gratis)**: seluruh stack komputasi dapat berjalan penuh secara lokal offline (Ollama / FastEmbed / Docker) atau memanfaatkan cloud free-tier tanpa kartu kredit (Google Gemini API di Google AI Studio / Groq API), menjadikannya ideal untuk eksperimen, iterasi cepat, dan portofolio tanpa tagihan cloud/API.

Data Analyst Agent menjawab pertanyaan bahasa natural (Indonesia dan Inggris) dengan menulis SQL, menjalankannya secara aman terhadap PostgreSQL, lalu menyajikan tabel, grafik, ringkasan, serta sitasi SQL dan definisi metrik yang dipakai.

**Asumsi:** domain yang dipilih adalah data analyst agent. Struktur PRD ini dapat diadaptasi ke domain lain (customer support agent, asisten regulasi) dengan mengganti tool dan dataset.

## 2. Latar Belakang dan Masalah

**Masalah pengguna (persona bisnis):** tim non-teknis (operasional, marketing, finance) sering membutuhkan jawaban dari database, tetapi bergantung pada analis data sehingga lambat dan antre.

**Masalah pembangun (tujuan portofolio):** perekrut AI Agent Engineer mencari bukti bahwa kandidat mampu membangun sistem agentic yang andal, bukan sekadar notebook atau proof of concept. Bukti yang diminta: diagram arsitektur, studi kasus kegagalan produksi, strategi evaluasi, serta trade-off cost vs latency vs akurasi.

## 3. Tujuan dan Non-Tujuan

### 3.1 Tujuan

1.  Agent menjawab pertanyaan analitik bahasa natural dari PostgreSQL dengan akurasi terukur.
2.  Seluruh lapisan harness hadir dan terdokumentasi: context pipeline, tool, memory, orchestration, guardrail, observability.
3.  Setiap perubahan prompt atau harness divalidasi oleh eval otomatis di CI sebelum merge.
4.  Menghasilkan artefak wawancara: diagram arsitektur, log kegagalan, laporan eval, dan tulisan trade-off.
5.  Dapat dijalankan 100% gratis secara lokal (Ollama / FastEmbed) atau via Cloud Free-Tier (Gemini 2.0 Flash / Groq) tanpa ketergantungan API berbayar.

### 3.2 Non-Tujuan

- Bukan produk SaaS komersial: tanpa multi-tenant, billing, atau manajemen pengguna kompleks.
- Tidak membangun UI yang rumit; antarmuka minimal sudah cukup.
- Tidak melakukan fine-tuning model (hanya mendokumentasikan alasan kenapa tidak diperlukan).
- Tidak mendukung operasi tulis ke database (read-only secara default).
- Tidak memerlukan langganan API berbayar (OpenAI, Anthropic Claude berbayar) maupun infrastruktur cloud berbayar.

## 4. Persona dan Skenario Pengguna

| **Persona** | **Peran**                        | **Kebutuhan utama**                                                                                                    |
|-------------|----------------------------------|------------------------------------------------------------------------------------------------------------------------|
| Rina        | Manajer Operasional (non-teknis) | Bertanya dalam bahasa natural, mis. "total penjualan per kategori bulan lalu dibanding sebelumnya", tanpa menulis SQL. |
| Budi        | Analis Data                      | Melihat SQL yang dihasilkan, mengoreksinya, dan menyetujui query berisiko.                                             |
| Evaluator   | Perekrut / interviewer           | Melihat trace, hasil eval, dan dokumentasi keputusan desain dalam waktu singkat.                                       |

### 4.1 Skenario Kunci

1.  Rina bertanya; agent mengambil skema relevan, menulis SQL, menjalankan, lalu menampilkan tabel, grafik, penjelasan singkat, dan SQL yang dipakai.
2.  Rina meminta data berisi PII (email pelanggan); agent menyamarkan kolom sensitif atau menolak sesuai kebijakan.
3.  Agent menghasilkan query berat (full scan tabel besar); sistem meminta persetujuan manusia sebelum eksekusi.
4.  Pada percakapan panjang, pertanyaan lanjutan ("bagaimana kalau hanya Jakarta?") tetap koheren berkat memory dan context management.
5.  Task analisis panjang gagal di tengah jalan; sistem melanjutkan dari checkpoint terakhir tanpa mengulang langkah yang sudah selesai.

### 4.2 User Stories

| **ID** | **Sebagai...**  | **Saya ingin...**                                     | **Agar...**                          |
|--------|-----------------|-------------------------------------------------------|--------------------------------------|
| US-01  | Pengguna bisnis | bertanya dalam bahasa Indonesia                       | tidak perlu mengerti SQL             |
| US-02  | Pengguna bisnis | melihat sumber (SQL dan definisi metrik) tiap jawaban | saya bisa memercayai angkanya        |
| US-03  | Analis data     | menyetujui atau menolak query berisiko                | database tidak terbebani atau bocor  |
| US-04  | Analis data     | melihat langkah dan trace agent                       | bisa mendiagnosis jawaban yang salah |
| US-05  | Pengembang      | menjalankan eval otomatis di CI                       | regresi terdeteksi sebelum rilis     |
| US-06  | Pengembang      | memantau biaya dan latensi per task                   | dapat mengoptimalkan trade-off       |

## 5. Kebutuhan Fungsional

Prioritas: **P0** (wajib untuk MVP), **P1** (penting), **P2** (nice to have).

### 5.1 Agent Loop dan Orchestration

| **ID** | **Kebutuhan**                                                                                                             | **Prioritas** |
|--------|---------------------------------------------------------------------------------------------------------------------------|---------------|
| FR-01  | Agent loop ditulis manual (tanpa framework): plan, tool call, observe, ulangi sampai selesai atau batas langkah tercapai. | P0            |
| FR-02  | Batas langkah, batas token, dan timeout per task yang dapat dikonfigurasi.                                                | P0            |
| FR-03  | Implementasi pembanding dengan LangGraph atau Claude Agent SDK, memakai tool dan eval yang sama.                          | P1            |
| FR-04  | Pola sub-agent atau planner-executor untuk pertanyaan multi-langkah, dengan perbandingan jujur terhadap single-agent.     | P2            |

### 5.2 Tool dan Structured Output

| **ID** | **Kebutuhan**                                                                                                                             | **Prioritas** |
|--------|-------------------------------------------------------------------------------------------------------------------------------------------|---------------|
| FR-05  | Tool get_schema: mengambil skema tabel/kolom relevan beserta deskripsi dan sampel nilai.                                                  | P0            |
| FR-06  | Tool run_sql: eksekusi SQL read-only dengan batas baris, timeout, dan validasi AST sebelum dijalankan.                                    | P0            |
| FR-07  | Tool make_chart: membuat grafik dari hasil query (spesifikasi grafik berupa JSON terstruktur).                                            | P1            |
| FR-08  | Tool calculate: eksekusi kode Python di sandbox lokal (Docker container tanpa akses jaringan) untuk analisis lanjutan tanpa biaya runtime eksternal. | P1            |
| FR-09  | Semua tool memakai schema Pydantic dengan deskripsi jelas dan contoh penggunaan; output akhir agent berupa structured output tervalidasi. | P0            |
| FR-10  | Satu MCP server buatan sendiri yang mengekspos akses database (schema dan query), dikonsumsi oleh agent.                                  | P1            |

### 5.3 Context Engineering dan RAG

| **ID** | **Kebutuhan**                                                                                                                                              | **Prioritas** |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------|
| FR-11  | Retrieval skema sebagai tool (just-in-time), bukan memasukkan seluruh skema ke prompt.                                                                     | P0            |
| FR-12  | Knowledge base dokumen bisnis (glosarium metrik, definisi "pelanggan aktif", dll.) dengan chunking, metadata, hybrid search (dense embedding lokal FastEmbed/Ollama + BM25), dan reranking (zero API cost). | P1            |
| FR-13  | Jawaban akhir menyertakan sitasi: SQL yang dipakai dan dokumen definisi metrik yang dirujuk.                                                               | P0            |
| FR-14  | Compaction/summarization percakapan panjang agar agent tidak kehilangan konteks atau berhenti dini.                                                        | P1            |
| FR-15  | Prompt caching untuk system prompt dan skema yang stabil.                                                                                                  | P1            |

### 5.4 Memory dan State

| **ID** | **Kebutuhan**                                                                                           | **Prioritas** |
|--------|---------------------------------------------------------------------------------------------------------|---------------|
| FR-16  | Short-term memory: riwayat percakapan per sesi.                                                         | P0            |
| FR-17  | Long-term memory: preferensi pengguna dan query yang pernah berhasil, disimpan di pgvector.             | P1            |
| FR-18  | Working memory berbasis file/state eksternal untuk task panjang (catatan rencana dan temuan sementara). | P1            |
| FR-19  | Checkpointing dan resume untuk task panjang; operasi idempoten agar retry tidak menggandakan efek; state machine eksplisit (PENDING, RUNNING, WAITING_APPROVAL, RESUMED, COMPLETED, FAILED) tanpa memblokir thread saat menunggu approval. | P1            |

### 5.5 Guardrail dan Keamanan

| **ID** | **Kebutuhan**                                                                                                                     | **Prioritas** |
|--------|-----------------------------------------------------------------------------------------------------------------------------------|---------------|
| FR-20  | Validasi SQL: hanya SELECT; blokir DDL/DML, multi-statement, dan fungsi berbahaya.                                                | P0            |
| FR-21  | Database user dengan prinsip least-privilege (read-only, hanya skema yang diizinkan).                                             | P0            |
| FR-22  | Allowlist tool dan parameter per tool.                                                                                            | P0            |
| FR-23  | Deteksi prompt injection pada konten hasil retrieval (dokumen dan nilai data); konten diperlakukan sebagai data, bukan instruksi. | P1            |
| FR-24  | Penanganan PII: masking kolom sensitif sebelum masuk ke context LLM maupun ke keluaran.                                           | P1            |
| FR-25  | Approval gate (human-in-the-loop) untuk query berisiko: estimasi biaya tinggi, tabel sangat besar, atau kolom sensitif.           | P0            |
| FR-26  | Sandbox eksekusi (Docker) tanpa akses jaringan untuk kode yang dihasilkan agent.                                                  | P1            |

### 5.6 Reliability, Latency, dan Cost

| **ID** | **Kebutuhan**                                                                                                                                                                         | **Prioritas** |
|--------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------|
| FR-27  | Retry dengan backoff, timeout, dan graceful degradation (hasil parsial dengan penjelasan bila langkah gagal).                                                                         | P0            |
| FR-28  | Model routing & provider abstraction (LiteLLM/OpenAI API compatible) dengan Zero-Cost Stack: model lokal gratis (Ollama qwen2.5-coder / llama3.1) dan Cloud Free Tier (Google Gemini 2.0 Flash / Groq Llama 3.3 70B); fallback otomatis saat rate limit. | P1            |
| FR-29  | Anggaran token per task dengan pemutusan otomatis dan pesan yang jelas.                                                                                                               | P1            |

### 5.7 API dan Antarmuka

| **ID** | **Kebutuhan**                                                                                          | **Prioritas** |
|--------|--------------------------------------------------------------------------------------------------------|---------------|
| FR-30  | Backend FastAPI dengan endpoint percakapan yang melakukan streaming respons via SSE dengan event types terstandarisasi (step_start, token, approval_required, final_result, error). | P0            |
| FR-31  | Endpoint persetujuan (approve/reject) untuk approval gate.                                             | P0            |
| FR-32  | UI web sederhana yang menampilkan jawaban, SQL, grafik, langkah agent, dan tombol approval.            | P1            |
| FR-33  | Manajemen sesi percakapan & riwayat chat persisten: pengelompokan task multi-turn per session_id di PostgreSQL, API listing/detail/delete sesi, dan UI sidebar collapsible dengan penyimpanan localStorage. | P1            |
| FR-34  | Smart follow-up suggestions (rekomendasi pertanyaan lanjutan kontekstual): agen menyertakan 3 pertanyaan eksplorasi data relevan via structured output (piggybacking LLM tanpa biaya ekstra) dengan fallback heuristik dari metadata tabel, dirender sebagai chip interaktif satu klik di UI. | P1            |


## 6. Observability dan Evaluasi

### 6.1 Observability

| **ID** | **Kebutuhan**                                                                                                | **Prioritas** |
|--------|--------------------------------------------------------------------------------------------------------------|---------------|
| OB-01  | Tracing per langkah (LLM call, tool call, retrieval) memakai Langfuse (Self-Hosted via Docker lokal atau Langfuse Cloud Free Tier 50k observations/bulan gratis). | P0            |
| OB-02  | Metrik per task: token (input/output/cache), latensi total dan TTFT, biaya, jumlah langkah, tool error rate. | P0            |
| OB-03  | Dashboard sederhana untuk biaya per task, latensi (p50/p95), dan tool failure rate.                          | P1            |
| OB-04  | Deteksi drift: perbandingan metrik mingguan dan alert sederhana saat metrik menyimpang.                      | P2            |

### 6.2 Evaluasi

| **ID** | **Kebutuhan**                                                                                                                                    | **Prioritas** |
|--------|--------------------------------------------------------------------------------------------------------------------------------------------------|---------------|
| EV-01  | Dataset eval 40-60 kasus: pertanyaan, SQL/jawaban acuan, kategori kesulitan, dan kasus adversarial (injection, permintaan PII, query berbahaya). | P0            |
| EV-02  | Metrik: execution accuracy, tool-call correctness, faithfulness jawaban terhadap data, safety pass rate.                                         | P0            |
| EV-03  | LLM-as-judge untuk kualitas penjelasan dan faithfulness, dikalibrasi dengan sampel penilaian manual (memakai Gemini Flash Free Tier / Ollama).  | P1            |
| EV-04  | Regression tracking: hasil eval tiap commit tersimpan dan dibandingkan dengan baseline.                                                          | P1            |
| EV-05  | CI gate 2-tier: Tier 1 (smoke test di GitHub Actions gratis: validasi AST, guardrail injection, schema Pydantic, tanpa biaya API) untuk blocking PR; Tier 2 (full benchmark 40-60 kasus) dijalankan terjadwal/manual via free-tier API. | P0            |
| EV-06  | Analisis failure mode: kategorisasi kegagalan (salah join, salah interpretasi metrik, salah pilih tool, early stopping, halusinasi sitasi).      | P1            |

## 7. Kebutuhan Non-Fungsional

- **Kinerja:** TTFT di bawah 3 detik untuk pertanyaan sederhana (Cloud Free Tier / Ollama M-series); jawaban lengkap p95 di bawah 30 detik untuk pertanyaan biasa.
- **Biaya:** target biaya operasional dan inferensi adalah **USD 0,00 (100% Gratis)** menggunakan model lokal (Ollama / FastEmbed) dan/atau kuota Cloud Free Tier (Google AI Studio Gemini / Groq API) tanpa memerlukan kartu kredit.
- **Keamanan:** tidak ada operasi tulis ke database; secret tidak pernah masuk log atau trace; PII tidak dikirim ke LLM tanpa masking.
- **Keandalan:** task yang gagal dapat dilanjutkan dari checkpoint; retry bersifat idempoten.
- **Portabilitas:** seluruh sistem berjalan dengan satu perintah docker compose up.
- **Kualitas kode:** type hints penuh, asyncio, Pydantic untuk semua kontrak data, cakupan tes unit untuk komponen guardrail.

## 8. Arsitektur Tingkat Tinggi

Lapisan sistem yang harus tergambar pada diagram arsitektur:

| **Lapisan**   | **Komponen**                                                            | **Tanggung jawab**                                       |
|---------------|-------------------------------------------------------------------------|----------------------------------------------------------|
| Klien         | UI web                                                                  | Menerima stream SSE, menampilkan jawaban dan approval.   |
| API           | FastAPI                                                                 | Endpoint chat, approval, health; streaming.              |
| Orchestration | Agent loop (manual dan versi framework)                                 | Mengatur langkah, state, checkpoint, dan batas anggaran. |
| Context       | Prompt builder, compaction, caching, retrieval                          | Menentukan informasi yang masuk ke context window.       |
| Tool          | get_schema, run_sql, make_chart, calculate, MCP server                  | Aksi terstruktur dengan schema Pydantic.                 |
| Memory        | Postgres, pgvector, file/state                                          | Short-term, long-term, dan working memory.               |
| Guardrail     | Validator SQL, allowlist, deteksi injection, masking PII, approval gate | Mencegah aksi dan kebocoran berisiko.                    |
| Observability | Langfuse/OpenTelemetry, penyimpanan metrik, dashboard                   | Trace, biaya, latensi, dan error rate.                   |
| Data          | PostgreSQL (dataset analitik) dan vector store                          | Data bisnis sintetis dan indeks pengetahuan.             |

**Tech stack yang diusulkan (Zero-Cost Stack):**
- **Language & API:** Python 3.12, FastAPI (async), Pydantic v2.
- **SQL & Database:** PostgreSQL 16 + pgvector (via Docker Compose lokal), SQLAlchemy / asyncpg, sqlglot (parsing AST SQL).
- **LLM Engine & Routing:** LiteLLM / OpenAI-compatible abstraction layer:
  - *Lokal (100% offline & gratis):* Ollama (`qwen2.5-coder:7b`, `llama3.1:8b`).
  - *Cloud Free Tier:* Google AI Studio API (`gemini-2.0-flash`, `gemini-1.5-flash`) / Groq API (`llama-3.3-70b-versatile`) tanpa biaya kartu kredit.
- **Embeddings & RAG:** FastEmbed (lokal ONNX runtime, misal `BAAI/bge-small-en-v1.5`) atau Ollama (`nomic-embed-text`) + pgvector hybrid search (BM25 + dense lokal).
- **Observability:** Langfuse (Self-Hosted via Docker lokal atau Langfuse Cloud Free Tier 50k traces/bulan).
- **Containerization & CI:** Docker, Docker Compose, GitHub Actions (Free tier 2.000 menit/bulan).

### 8.1 Endpoint API (Rancangan)

| **Metode** | **Path**              | **Fungsi**                                                                    |
|------------|-----------------------|-------------------------------------------------------------------------------|
| POST       | /v1/chat              | Mengirim pertanyaan; respons berupa stream SSE (token, langkah, hasil akhir). |
| POST       | /v1/approvals/{id}    | Menyetujui atau menolak aksi yang menunggu persetujuan.                       |
| GET        | /v1/tasks/{id}        | Status task, checkpoint, dan hasil.                                           |
| POST       | /v1/tasks/{id}/resume | Melanjutkan task dari checkpoint terakhir.                                    |
| GET        | /v1/sessions          | Mengambil daftar ringkasan riwayat sesi percakapan (judul, turn, waktu).      |
| GET        | /v1/sessions/{id}     | Mengambil detail percakapan lengkap dari suatu sesi.                          |
| DELETE     | /v1/sessions/{id}     | Menghapus sesi percakapan beserta seluruh task dan checkpoint-nya.            |
| GET        | /health               | Pemeriksaan kesehatan layanan.                                                |

#### Format Event SSE (`/v1/chat`):
- `event: step_start` -> payload: `{"step": 1, "action": "planning | tool_call", "details": ...}`
- `event: token` -> payload: `{"delta": "..."}`
- `event: approval_required` -> payload: `{"approval_id": "...", "sql": "...", "risk_reason": "..."}` (client pause)
- `event: final_result` -> payload: `{"answer_text": "...", "sql_queries": [...], "tables": [...], "charts": [...], "citations": [...], "follow_up_suggestions": ["...", "...", "..."], "metrics": {...}}`
- `event: error` -> payload: `{"message": "..."}`

### 8.2 Dataset Demo

Skema multi-tabel e-commerce sintetis (pelanggan, produk, pesanan, item pesanan, pembayaran, wilayah), dengan data yang sengaja sedikit "kotor" (nilai null, duplikat, kategori tidak konsisten) agar kasus uji realistis. Kolom sensitif (email, telepon) ditandai untuk menguji masking PII.

## 9. Metrik Keberhasilan

| **Metrik**                                 | **Target MVP** | **Target Akhir**                 |
|--------------------------------------------|----------------|----------------------------------|
| Execution accuracy (set eval)              | ≥ 70%          | ≥ 85%                            |
| Safety pass rate (kasus adversarial)       | 100%           | 100%                             |
| Tool-call correctness                      | ≥ 90%          | ≥ 95%                            |
| Faithfulness (LLM-as-judge)                | ≥ 85%          | ≥ 92%                            |
| Latensi jawaban p95 (pertanyaan sederhana) | \< 30 detik    | \< 15 detik                      |
| Biaya rata-rata per task sederhana         | USD 0,00       | USD 0,00 (Zero-Cost Baseline)    |
| Eval berjalan otomatis di CI               | Ya             | Ya, dengan gate dan laporan tren |

## 10. Artefak Portofolio (Deliverable)

1.  Repositori GitHub dengan README jelas, docker compose up, dan data demo.
2.  **Diagram arsitektur** yang menunjukkan lapisan harness (context, tool, memory, orchestration, observability).
3.  **Failure case log:** minimal 3 kegagalan nyata, masing-masing berisi gejala, cara terdeteksi lewat trace, akar masalah, dan perbaikan permanen di level harness.
4.  **Laporan eval:** metrik, kategori kegagalan, tren antar versi, dan keputusan rilis yang dipengaruhinya.
5.  **Tulisan trade-off:** pemilihan framework (manual vs LangGraph/Claude Agent SDK), single-agent vs multi-agent, cost vs latency vs akurasi, serta kapan fine-tuning/distillation tidak diperlukan.
6.  Video demo 3-5 menit dan dashboard observability.

## 11. Rencana Rilis dan Milestone

| **Milestone**              | **Cakupan**                                                                            | **Estimasi** |
|----------------------------|----------------------------------------------------------------------------------------|--------------|
| M1: Fondasi                | FastAPI, agent loop manual, get_schema, run_sql, structured output, streaming, Zero-Cost provider setup | Minggu 1     |
| M2: Konteks dan data       | RAG glosarium metrik (FastEmbed lokal, pgvector, hybrid search, sitasi), JIT schema   | Minggu 2     |
| M3: Keamanan dan state     | Guardrail SQL (sqlglot), masking PII, approval gate, state machine, sandbox Docker     | Minggu 3     |
| M4: Observability dan eval | Tracing Langfuse (self-hosted/cloud free), metrik latensi, dataset eval, 2-tier CI gate| Minggu 4     |
| M5: Pembanding dan MCP     | Versi LangGraph, MCP server database, model routing & fallback Ollama/Gemini Free     | Minggu 5     |
| M6: Finalisasi             | Dokumentasi, diagram, failure log, laporan trade-off, demo video, dashboard            | Minggu 6     |

**Definisi MVP (akhir M3):** pengguna dapat bertanya dan mendapat jawaban dengan SQL dan sitasi, query berbahaya diblokir, query berisiko meminta persetujuan, dan task dapat dilanjutkan setelah gagal.

## 12. Risiko dan Mitigasi

| **Risiko**                            | **Dampak**                          | **Mitigasi**                                                                                     |
|---------------------------------------|-------------------------------------|--------------------------------------------------------------------------------------------------|
| SQL salah tetapi terlihat meyakinkan  | Jawaban menyesatkan                 | Tampilkan SQL, validasi kewajaran hasil, eval execution accuracy, kalibrasi LLM-judge.           |
| Prompt injection lewat data/dokumen   | Agent melakukan aksi tak diinginkan | Perlakukan konten retrieval sebagai data, allowlist tool, DB read-only, tes adversarial di eval. |
| Rate-limit pada Cloud Free Tier       | Eksekusi agent terhenti             | LiteLLM model fallback otomatis ke Ollama lokal (`qwen2.5-coder`), backoff retry eksponensial.    |
| Eval tidak stabil (non-deterministik) | CI gate gagal palsu                 | Temperature rendah (0.0), cache respons deterministik, ambang toleransi, fokus pada tren.        |
| Cakupan melebar                       | Proyek tidak selesai                | Patuhi prioritas P0/P1; P2 hanya jika waktu tersisa.                                             |
| Dataset terlalu sederhana             | Demo kurang meyakinkan              | Gunakan dataset e-commerce realistis (Olist) dengan multi-tabel dan data kotor alami.            |

## 13. Keputusan Desain (Jawaban Pertanyaan Terbuka)

1. **Dataset:** Menggunakan dataset publik **Olist Brazilian E-commerce** (multi-tabel pesanan, produk, pelanggan, pembayaran, wilayah) yang di-seed ke PostgreSQL lokal. Memiliki data kotor alami tanpa biaya lisensi.
2. **Penyedia LLM & Anggaran:** **USD 0,00 (100% Gratis)**. Arsitektur hybrid via LiteLLM: Google AI Studio (Gemini 2.0 Flash / 1.5 Flash) dan Groq (Llama 3.3 70B) untuk inferensi cepat via cloud free-tier, dengan fallback offline ke Ollama lokal (`qwen2.5-coder:7b` / `llama3.1:8b`).
3. **Cakupan UI:** Antarmuka web chat minimalis responsif (FastAPI static web mount dengan HTML + Tailwind CSS + Vanilla JS) yang mampu merender stream SSE, tabel markdown, spesifikasi grafik JSON, dan tombol dialog persetujuan (approval gate). Tracing internal dipantau via dashboard Langfuse lokal/cloud free.
4. **Framework Pembanding:** **LangGraph**. Merupakan framework orchestration agen paling banyak diminta pada lowongan kerja AI Agent Engineer saat ini.
5. **Target Deployment:** **Docker Compose lokal** (`docker compose up`) yang menjalankan FastAPI backend, PostgreSQL 16 + pgvector, dan Langfuse dalam satu perintah tanpa dependensi cloud berbayar.

## 14. Pemetaan ke Kualifikasi Loker

| **Kualifikasi loker**                                            | **Bukti di proyek**                       |
|------------------------------------------------------------------|-------------------------------------------|
| Python async, type hints, Pydantic                               | Seluruh backend (FR-01, FR-09, FR-30)     |
| FastAPI + streaming SSE/WebSocket                                | FR-30                                     |
| Agent loop sendiri tanpa framework                               | FR-01, FR-03                              |
| Tool use dan structured output                                   | FR-05 s.d. FR-09                          |
| MCP                                                              | FR-10                                     |
| Orchestration (single/sub/multi-agent)                           | FR-01, FR-03, FR-04                       |
| State dan durability                                             | FR-19                                     |
| Memory                                                           | FR-16 s.d. FR-18                          |
| RAG modern, grounding, citation                                  | FR-11 s.d. FR-13                          |
| Guardrail, sandbox, human-in-the-loop                            | FR-20 s.d. FR-26                          |
| Reliability, latency, cost                                       | FR-27 s.d. FR-29                          |
| Evals dan regression tracking                                    | EV-01 s.d. EV-06                          |
| Observability LLM                                                | OB-01 s.d. OB-04                          |
| Docker, CI/CD, eval sebagai gate                                 | EV-05 dan bagian Kebutuhan Non-Fungsional |
| Persyaratan wawancara (diagram, kegagalan, evaluasi, portofolio) | Bagian 10                                 |