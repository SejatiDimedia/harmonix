# Harmonix: Platform Analitik Data Mandiri untuk Tim Bisnis

Asisten analitik data berbasis AI yang menerjemahkan pertanyaan bisnis sehari-hari menjadi analisis data yang akurat dan aman untuk para pengambil keputusan.

## Latar Belakang

Setiap kali tim bisnis butuh data cepat untuk mengambil keputusan, mereka biasanya harus antre ke tim data. Proses ini membuat operasional lambat. Di sisi lain, membiarkan tim non-teknis langsung mengakses database produksi punya risiko besar: data operasional bisa terhapus, data pribadi pelanggan bisa bocor, atau terjadi salah hitung karena AI mengarang angka.

## Tujuan Proyek

Membangun platform analitik mandiri yang bisa diajak berdiskusi memakai bahasa sehari-hari. Pengguna bisnis bisa langsung mendapatkan tabel, grafik, dan ringkasan data yang akurat, sementara tim IT tetap tenang karena database aman dari modifikasi, angka kalkulasi selalu diverifikasi, dan biaya servernya nol rupiah.

## Solusi Bisnis

### Tanya Data Pakai Bahasa Sehari-hari
Pengguna cukup mengetik pertanyaan seperti biasa, misalnya menanyakan tren penjualan atau perbandingan performa cabang. Sistem langsung menyajikan ringkasan temuan, tabel data yang rapi, dan grafik visual yang siap dipakai untuk bahan laporan.

### Perlindungan Database Tanpa Kompromi
Akses ke database dikunci hanya untuk membaca data. Jika ada perintah yang berpotensi mengubah, merusak, atau menghapus data, sistem langsung menolaknya secara otomatis sebelum sempat menyentuh database.

### Pengecekan Angka Ganda Anti-Salah Hitung
Sebelum jawaban tampil di layar, ada sistem auditor mandiri yang memeriksa logika kueri dan mencocokkan setiap angka di teks penjelasan dengan tabel hasil aslinya. Jadi, tidak ada cerita AI mengarang angka.

### Izin Khusus untuk Permintaan Berisiko
Ketika ada kueri yang membutuhkan data dalam jumlah sangat besar atau menyangkut informasi yang sensitif, sistem tidak langsung memprosesnya. Permintaan akan ditahan terlebih dahulu sampai disetujui oleh pengelola data yang berwenang.

### Sensor Otomatis untuk Data Pribadi Pelanggan
Informasi pribadi pelanggan seperti alamat email dan nomor telepon otomatis disamarkan sebelum jawabannya keluar, sehingga privasi pelanggan tetap terjaga dan perusahaan tetap patuh aturan tata kelola data.

### Dasbor Interaktif dan Mode Layar Penuh
Grafik dan tabel penting bisa langsung disematkan ke dasbor ringkasan eksekutif. Dasbor ini juga memiliki mode layar penuh yang pas untuk layar monitor ruang rapat atau display ruang kendali tanpa terpotong.

### Cek Kualitas Data Mandiri
Pengguna bisa mengunggah file spreadsheet Excel atau CSV sendiri. Sistem langsung memeriksa kelengkapan data, mendeteksi angka anomali, dan menghitung skor kesehatan datanya sebelum analisis dimulai.

### Pemantau Metrik Bisnis Otomatis
Sistem memantau indikator operasional secara berkala di latar belakang. Jika ada target yang anjlok atau ada tren yang mencurigakan, sistem otomatis mengirimkan peringatan beserta diagnosis awal penyebab masalahnya.

## Hasil

Berdasarkan pengujian menyeluruh pada puluhan skenario analitik dan keamanan:
- 100% aman dari upaya manipulasi database dan kebocoran data sensitif.
- 95,6% tepat dalam memilih fungsi dan langkah analitik.
- Akurasi eksekusi kueri mencapai 82,2% pada pengujian lingkungan terisolasi dan 91,1% pada pengujian model awan.
- 94,2% tingkat kesesuaian antara angka di narasi penjelasan dengan data aslinya.
- Biaya operasional inferensi nol rupiah berkat arsitektur hibrida yang memadukan model lokal dan alokasi layanan awan gratis.

## Teknologi

Python, FastAPI, PostgreSQL dengan pgvector, Apache ECharts, React, TypeScript, serta integrasi model bahasa lokal dan awan.

---

Tertarik menerapkan sistem analitik mandiri yang aman, akurat, dan hemat biaya ini di tim Anda? Mari diskusikan kebutuhan data perusahaan Anda bersama saya.
