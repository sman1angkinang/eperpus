# QR Desk

Website statis untuk mengelola QR dummy, mencoba login demo, dan mencatat waktu pemindaian. Dapat dipublikasikan melalui GitHub Pages dan menggunakan Google Sheets sebagai database bersama melalui Google Apps Script.

## Login demo

- Nama pengguna: `admin`
- Kata sandi: `qrcode123`

## Jalankan lokal

Buka `index.html` di browser untuk mencoba fitur tanpa kamera. Scan QR yang terdaftar akan membunyikan nada konfirmasi singkat. Agar scanner kamera berfungsi, jalankan di `localhost` atau melalui HTTPS, lalu izinkan akses kamera. Pada halaman Data QR, klik gambar QR untuk melihat atau mengunduh versi PNG; nilai Kode / ID adalah isi QR yang dikenali scanner.

## Siapkan Google Sheets

Spreadsheet yang digunakan: https://docs.google.com/spreadsheets/d/1JNrQEaX_ERqZ3kIm875JddkC9U6nJ1Yq110RXXWSFOk/edit

1. Buka spreadsheet tersebut, lalu pilih **Extensions → Apps Script**.
2. Salin isi [`google-apps-script/Code.gs`](./google-apps-script/Code.gs) ke editor Apps Script.
3. Pilih fungsi `initializeQrDesk`, tekan **Run**, lalu berikan izin akses. Fungsi ini membuat tab **Data QR** dan **Riwayat Scan**, menyiapkan QR demo bila tab QR masih kosong, dan membuat API key.
4. Dari **Execution log**, salin hanya nilai key berupa 64 karakter heksadesimal setelah tanda titik dua; jangan salin label log-nya. Simpan key secara privat.
5. Pilih **Deploy → New deployment → Web app**. Atur **Execute as: Me** dan **Who has access: Anyone**, lalu deploy dan salin URL yang berakhiran `/exec`.
6. Di website, masuk dengan akun demo, klik **Hubungkan Spreadsheet**, lalu masukkan URL Web App dan API key. Ini hanya menyimpan koneksi di browser tersebut.
7. Agar semua pengunjung tidak perlu memasukkan koneksi, salin URL dan key itu ke `PUBLIC_SHEETS_CONFIG.url` dan `PUBLIC_SHEETS_CONFIG.apiKey` di bagian atas `app.js`, lalu unggah/deploy ulang GitHub Pages. Isi key berupa 64 karakter heksadesimal.

Saat pertama terhubung, QR dan riwayat lokal yang belum ada di spreadsheet akan diimpor. Selanjutnya pembuatan/penghapusan QR dan setiap scan akan disinkronkan otomatis. Jika sinkronisasi gagal, data tetap disimpan lokal dan perubahan masuk antrean untuk dicoba kembali. Username dan kata sandi login tidak dikirim ke spreadsheet. Jika muncul pesan API key berbeda, jalankan `initializeQrDesk` dari project yang sama dengan Web App, salin key terbaru dari Execution log, dan masukkan ulang di dashboard. Pastikan URL berasal dari deployment project tersebut; setelah mengubah kode Apps Script, deploy versi baru.

## Deploy ke GitHub Pages

1. Unggah file `index.html`, `styles.css`, `app.js`, folder `google-apps-script`, dan `README.md` ke repository GitHub.
2. Buka **Settings → Pages**.
3. Pada **Build and deployment**, pilih **Deploy from a branch**, pilih branch `main` dan folder `/ (root)`, lalu simpan.
4. Buka URL GitHub Pages yang ditampilkan setelah deployment selesai.

## Keamanan dan batasan

GitHub Pages hanya meng-host file statis. Login `admin / qrcode123` adalah login demo, bukan autentikasi aman. Apps Script Web App harus dapat diakses publik agar GitHub Pages bisa menghubunginya. Jika `PUBLIC_SHEETS_CONFIG` diisi untuk koneksi otomatis, URL dan API key berada dalam JavaScript publik dan siapa pun dapat melihatnya lalu membaca/mengubah spreadsheet. Jangan gunakan cara ini untuk data sensitif. Bila key bocor, jalankan `rotateQrDeskApiKey` dari Apps Script, lalu perbarui key di `app.js` dan deploy ulang. Untuk sistem produksi, gunakan autentikasi dan backend yang sesuai.

Jika browser belum dikonfigurasi atau Google Sheets sedang tidak tersedia, data tetap tersimpan di `localStorage` browser itu. Library QR dan scanner dimuat dari CDN; scanner kamera memerlukan HTTPS dan izin kamera.
