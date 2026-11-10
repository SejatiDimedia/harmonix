# Ringkasan Proyek: Harmonix AI Data Analyst Platform

Format ringkas Situation, Task, Action, dan Result untuk kebutuhan resume, profil profesional, dan bahan wawancara kerja.

### Situation
Setiap kali tim bisnis butuh data cepat untuk mengambil keputusan, mereka harus antre panjang ke tim analis data. Di sisi lain, membiarkan tim non-teknis langsung mengakses database atau menghubungkan AI umum tanpa lapisan pengaman punya risiko fatal: data operasional bisa tidak sengaja terhapus, data pribadi pelanggan bisa bocor, dan angka keputusan bisa keliru besar karena AI mengarang data.

### Task
Membangun platform agen analitik data mandiri yang siap produksi untuk menerjemahkan pertanyaan bahasa sehari-hari menjadi kueri database dan grafik visual secara akurat, dengan jaminan keamanan akses murni membaca data (read-only), sensor otomatis data sensitif, verifikasi mandiri agar angka tidak meleset, serta biaya operasional server nol rupiah.

### Action
Merancang arsitektur backend berbasis Python dan FastAPI dengan sistem pengaman berlapis. Ini mencakup loop agen asinkron murni berlatensi rendah, validasi pohon sintaks (AST) memakai sqlglot untuk mencegat perintah manipulasi data atau injeksi kueri, sensor otomatis data sensitif, alur persetujuan manusia non-blocking untuk kueri berisiko, serta isolasi perhitungan Python di proses sistem operasi terpisah dengan sinyal pemutus paksa dari kernel. Menerapkan pola verifikasi Maker-Checker dengan agen Auditor independen untuk mencocokkan angka narasi dengan data aslinya, pencarian glosarium rumus bisnis hibrida lewat pgvector dan BM25, serta antarmuka web interaktif berbasis React dan Apache ECharts.

### Result
Meraih tingkat kelulusan keamanan 100% pada seluruh 15 skenario pengujian serangan, sukses mencegah manipulasi database dan kebocoran data pribadi. Mencatat ketepatan pemilihan fungsi 95,6%, kesesuaian angka faktual 94,2%, serta akurasi eksekusi kueri 82,2% pada pengujian lokal dan 91,1% pada pengujian model awan dengan waktu respon P95 di bawah 3,2 detik. Seluruh sistem tervalidasi melalui 196 pengujian otomatis dengan biaya operasional inferensi nol rupiah berkat pemanfaatan model bahasa lokal dan alokasi layanan awan gratis.
