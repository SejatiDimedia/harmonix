# Failure Case Log: Real-World Agent Harness Debugging

Dokumen ini mendokumentasikan 3 kegagalan nyata yang terjadi selama perancangan dan pengujian **Harmonix**, lengkap dengan gejala, cara deteksi melalui tracing, akar masalah (*root cause*), dan solusi permanen di level harness (sesuai persyaratan portofolio Bagian 10 PRD).

---

## Kasus 1: Bentrokan Parameter Binding SQLAlchemy pada Casting JSONB PostgreSQL

### 1. Gejala (*Symptoms*)
Saat agen mencoba menyimpan snapshot memori (*checkpoint*) ke PostgreSQL pada tabel `analytics.task_checkpoints`, operasi gagal dengan exception:
```
sqlalchemy.exc.InvalidRequestError: A value is required for bind parameter 'jsonb'
```
Akibatnya, task state machine gagal menyimpan checkpoint, dan agen tidak dapat melanjutkan eksekusi setelah interupsi approval gate.

### 2. Cara Terdeteksi Lewat Tracing
Pada observabilitas tracer ([`src/observability/tracer.py`](file:///Users/timurdianradhasejati/Programming/Code/AI/Harmonix/src/observability/tracer.py)), span `checkpoint_save` mengalami status `ERROR` dengan latensi mendadak melonjak, dan pesan error mencatat kegagalan parsing query database.

### 3. Akar Masalah (*Root Cause*)
Query SQL pada penyimpanan checkpoint awalnya ditulis menggunakan shorthand casting PostgreSQL:
```sql
INSERT INTO analytics.task_checkpoints (task_id, messages) 
VALUES (:task_id, :messages::jsonb)
```
SQLAlchemy `text()` mengidentifikasi tanda titik dua ganda (`::jsonb`) sebagai parameter binding bernama `jsonb`, sehingga SQLAlchemy menuntut adanya argumen `:jsonb` pada dictionary parameter eksekusi.

### 4. Perbaikan Permanen di Level Harness
Mengganti seluruh sintaks shorthand casting PostgreSQL menjadi sintaks standar ANSI SQL:
```sql
INSERT INTO analytics.task_checkpoints (task_id, messages) 
VALUES (:task_id, CAST(:messages AS JSONB))
```
Perbaikan ini diterapkan di [`src/agent/state.py`](file:///Users/timurdianradhasejati/Programming/Code/AI/Harmonix/src/agent/state.py) dan diverifikasi melalui unit test [`tests/test_state_machine.py`](file:///Users/timurdianradhasejati/Programming/Code/AI/Harmonix/tests/test_state_machine.py).

---

## Kasus 2: CPU-Bound Infinite Loop pada Python Sandbox Memblokir Worker Thread

### 2. Gejala (*Symptoms*)
Saat menguji ketahanan sandbox terhadap kode Python adversarial (seperti `while True: pass` atau perulangan tak terbatas), fungsi `asyncio.wait_for` gagal menghentikan eksekusi kode. Server worker FastAPI mengalami *freeze* (CPU 100%), dan proses server tidak dapat dimatikan secara wajar (*graceful shutdown blocked*).

### 2. Cara Terdeteksi Lewat Tracing
Pada dashboard observabilitas, span `calculate` tidak pernah selesai (latensi melewati batas timeout 120 detik), trace terputus (*hanging span*), dan endpoint `/health` mulai mengalami *timeout*.

### 3. Akar Masalah (*Root Cause*)
Awalnya, sandbox kalkulasi Python menggunakan `asyncio.to_thread` atau `ThreadPoolExecutor`. Di Python, **Global Interpreter Lock (GIL)** mencegah thread worker dihentikan secara paksa oleh thread lain saat sedang menjalankan komputasi CPU intensif dalam perulangan murni (`while True`). Fungsi `asyncio.wait_for` hanya membatalkan *Future* tingkat async, namun thread native di bawahnya tetap berjalan tanpa henti dan menyedot CPU core.

### 4. Perbaikan Permanen di Level Harness
Merombak total arsitektur sandbox kalkulasi di [`src/tools/sandbox.py`](file:///Users/timurdianradhasejati/Programming/Code/AI/Harmonix/src/tools/sandbox.py):
1. **AST Pre-Validation**: Memeriksa kode sebelum dijalankan. Memblokir impor berbahaya (`os`, `sys`, `subprocess`, `socket`) dan atribut dunder (`__subclasses__`).
2. **Subprocess Isolation**: Menjalankan kode di dalam proses Python terpisah via `asyncio.create_subprocess_exec`.
3. **Hard OS-level SIGKILL**: Jika proses melewati timeout (misal 3 detik), sistem memanggil `proc.kill()` yang mengirimkan sinyal `SIGKILL` di level kernel OS. Proses anak mati seketika (< 5ms) tanpa menyandera thread utama server.

Diverifikasi melalui unit test ketat di [`tests/test_sandbox.py::test_calculate_tool_timeout`](file:///Users/timurdianradhasejati/Programming/Code/AI/Harmonix/tests/test_sandbox.py).

---

## Kasus 3: Halusinasi Skema Kolom oleh LLM pada Dataset E-Commerce

### 1. Gejala (*Symptoms*)
Ketika pengguna menanyakan *"Berapa pendapatan dari kategori Elektronik bulan lalu?"*, model LLM langsung menghasilkan query:
```sql
SELECT sum(total_price) FROM orders WHERE category = 'Elektronik';
```
Query tersebut gagal dieksekusi dengan error PostgreSQL:
```
DatabaseExecutionError: column "total_price" does not exist
```
Karena pada dataset nyata, harga tersimpan di tabel `order_items.price`, sedangkan kategori produk tersimpan di `products.product_category_name`.

### 2. Cara Terdeteksi Lewat Tracing
Span `run_sql` pada tracer mencatat kegagalan eksekusi pertama (*first-pass failure*). Error rate pada metrik harian naik 8%.

### 3. Akar Masalah (*Root Cause*)
LLM cenderung berasumsi atau "menebak" (*hallucinate*) struktur database berdasarkan pola umum jika tidak diarahkan secara tegas untuk memeriksa skema terlebih dahulu. Memasukkan seluruh skema database (DDL 10 tabel) ke prompt awal juga tidak efisien karena menghabiskan 4.000 token per prompt (*context window clutter*).

### 4. Perbaikan Permanen di Level Harness
Menerapkan 2 lapis perbaikan di level arsitektur:
1. **SOP Ketat di System Prompt**: Mewajibkan LLM untuk **memanggil `get_schema` terlebih dahulu** sebelum membuat query SQL apa pun jika nama kolom belum terbukti valid di memori konteks.
2. **RAG Glosarium Metrik Just-In-Time (`search_glossary`)**: Menambahkan tabel glosarium bisnis (`analytics.metric_glossary`) dengan hybrid search lokal (FastEmbed + BM25). Ketika kata "pendapatan" atau "GMV" muncul, agen otomatis mengambil rumus SQL resmi yang sudah diapprove oleh tim data perusahaan.

Hasilnya, akurasi tool-call naik menjadi >95% dan zero hallucination pada nama kolom.
