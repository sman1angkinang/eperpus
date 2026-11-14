# QR Desk

Website statis untuk melihat data QR siswa dari Google Sheets dan mencatat waktu pemindaian. Dapat dipublikasikan melalui GitHub Pages dan terhubung ke Google Sheets melalui Google Apps Script.

## Login demo

- Nama pengguna: `admin`
- Kata sandi: `qrcode123`

## Jalankan lokal

Buka `index.html` di browser. Agar scanner kamera berfungsi, jalankan di `localhost` atau melalui HTTPS, lalu izinkan akses kamera. Pada halaman Data Siswa, klik gambar QR untuk melihat atau mengunduh versi PNG; isi QR harus sama dengan nilai pada kolom `Qrcode`.

## Siapkan Google Sheets

Spreadsheet sumber siswa: https://docs.google.com/spreadsheets/d/1lSKwdY7P2KXfxwD8SZQ24VJv4p_uYwINpQDpHO0WzKE/edit?gid=298938300#gid=298938300

1. Pastikan baris pertama tab sumber berisi header `Nama Lengkap`, `Kelas Terakhir`, `NISN`, `QRCode`, dan `Jenis Kelamin`. Apps Script hanya membaca lima kolom tersebut. Tab ditentukan oleh ID `298938300` pada `google-apps-script/Code.gs`.
2. Buka spreadsheet tersebut, lalu pilih **Extensions → Apps Script**.
3. Salin isi [`google-apps-script/Code.gs`](./google-apps-script/Code.gs) ke editor Apps Script.
4. Pilih fungsi `initializeQrDesk`, tekan **Run**, lalu berikan izin akses ke spreadsheet. Fungsi memeriksa header sumber, membuat tab **Riwayat Scan** bila belum tersedia, dan membuat API key. Data siswa di tab sumber tidak diubah.
5. Dari **Execution log**, salin hanya nilai key berupa 64 karakter heksadesimal setelah tanda titik dua; jangan salin label log-nya.
6. Pilih **Deploy → New deployment → Web app**. Atur **Execute as: Me** dan **Who has access: Anyone**, lalu deploy dan salin URL yang berakhiran `/exec`.
7. Di website, masuk dengan akun demo, klik **Hubungkan Spreadsheet**, lalu masukkan URL Web App dan API key. Ini hanya menyimpan koneksi di browser tersebut.
8. Agar semua pengunjung tidak perlu memasukkan koneksi, salin URL dan key itu ke `PUBLIC_SHEETS_CONFIG.url` dan `PUBLIC_SHEETS_CONFIG.apiKey` di bagian atas `app.js`, lalu unggah/deploy ulang GitHub Pages. Isi key berupa 64 karakter heksadesimal.

Data siswa dimuat ulang dari spreadsheet saat aplikasi dibuka; perubahan daftar siswa dilakukan pada spreadsheet sumber. Riwayat scan disimpan di tab **Riwayat Scan**. Jika sinkronisasi gagal, riwayat tetap disimpan lokal dan dicoba kembali. Username dan kata sandi login tidak dikirim ke spreadsheet. Jika muncul pesan API key berbeda, jalankan `initializeQrDesk` dari project yang sama dengan Web App, salin key terbaru dari Execution log, dan masukkan ulang di dashboard. Setelah mengubah kode Apps Script, deploy versi baru.

## Deploy ke GitHub Pages

1. Unggah file `index.html`, `styles.css`, `app.js`, folder `google-apps-script`, dan `README.md` ke repository GitHub.
2. Buka **Settings → Pages**.
3. Pada **Build and deployment**, pilih **Deploy from a branch**, pilih branch `main` dan folder `/ (root)`, lalu simpan.
4. Buka URL GitHub Pages yang ditampilkan setelah deployment selesai.

## Keamanan dan batasan

GitHub Pages hanya meng-host file statis. Login `admin / qrcode123` adalah login demo, bukan autentikasi aman. Dengan Web App **Anyone** dan koneksi otomatis, data siswa dapat dilihat siapa pun yang membuka situs; API key di JavaScript publik bukan perlindungan akses. Pengguna yang memiliki URL dan key juga dapat melihat catatan scan. Pastikan pembagian data ini memang diizinkan sebelum publikasi. Untuk akses terbatas, gunakan autentikasi dan backend yang sesuai. Bila key bocor, jalankan `rotateQrDeskApiKey` dari Apps Script, lalu perbarui key di `app.js` dan deploy ulang.

Jika browser belum dikonfigurasi atau Google Sheets sedang tidak tersedia, data tetap tersimpan di `localStorage` browser itu. Library QR dan scanner dimuat dari CDN; scanner kamera memerlukan HTTPS dan izin kamera.
